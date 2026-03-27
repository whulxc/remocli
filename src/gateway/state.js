import { LockManager } from '../shared/locks.js';
import { safeSessionId } from '../shared/config.js';
import { buildGotifyExtras, buildNotificationClickUrl } from '../shared/deployment.js';
import { summarizeTransition } from '../shared/session-state.js';
import { isSessionActivelyRunning } from '../shared/session-status-display.js';
import { isWorkspaceWithinRoot, normalizeWorkspacePathLoose, workspacePathsEqual } from '../shared/workspace-paths.js';
import { AgentClient } from './agent-client.js';
import { SessionPreferences } from './session-preferences.js';

export class GatewayState {
  constructor(config, notifier) {
    this.config = config;
    this.notifier = notifier;
    this.lockManager = new LockManager(config.lockTtlMs || 15 * 60 * 1000);
    this.preferences = new SessionPreferences(config.sessionPreferencesPath || 'data/gateway/session-preferences.json');
    this.agents = config.agents.map((agent) => ({
      ...agent,
      client: new AgentClient(agent),
      lastHealth: null,
      lastError: null,
      sessions: [],
    }));
    this.sessionTransitions = new Map();
    this.refreshAllPromise = null;
  }

  async refreshAgent(agent) {
    try {
      const [health, payload] = await Promise.all([agent.client.health(), agent.client.listSessions()]);
      agent.lastHealth = health;
      agent.lastError = null;
      agent.sessions = (payload.sessions || []).map((session) => {
        const compositeId = safeSessionId(agent.id, session.name);
        const previous = this.sessionTransitions.get(compositeId);
        if (!previous || previous.state !== session.state || previous.artifactCount !== session.artifactCount) {
          this.handleTransition(agent, session, previous).catch(() => {});
          this.sessionTransitions.set(compositeId, {
            state: session.state,
            artifactCount: session.artifactCount,
            activityAt: session.activityAt,
            readyForInput: session.readyForInput,
            hasBackgroundTask: session.hasBackgroundTask,
            contentSignature: session.contentSignature,
          });
        } else if (
          previous.activityAt !== session.activityAt
          || previous.readyForInput !== session.readyForInput
          || previous.hasBackgroundTask !== session.hasBackgroundTask
          || previous.contentSignature !== session.contentSignature
        ) {
          this.handleTransition(agent, session, previous).catch(() => {});
          this.sessionTransitions.set(compositeId, {
            ...previous,
            activityAt: session.activityAt,
            readyForInput: session.readyForInput,
            hasBackgroundTask: session.hasBackgroundTask,
            contentSignature: session.contentSignature,
          });
        }

        return {
          ...session,
          id: compositeId,
          agentId: agent.id,
          agentLabel: agent.label || agent.id,
          lastError: null,
          lock: this.lockManager.get(compositeId),
        };
      });
    } catch (error) {
      agent.lastError = error.message;
      agent.sessions = [];
    }
  }

  async handleTransition(agent, session, previous) {
    const sessionId = safeSessionId(agent.id, session.name);
    const extras = this.buildNotificationExtras(sessionId);
    const message = summarizeTransition(previous?.state, session.state);
    const sessionIsOpen = Boolean(this.lockManager.get(sessionId));
    const shouldClearUnread = shouldClearCompletedUnread(session) || sessionIsOpen;
    if (shouldClearUnread) {
      this.preferences.clearCompletedUnread([sessionId]);
    }
    const completedUnread = shouldMarkCompletedUnread(previous, session) && !sessionIsOpen;
    if (completedUnread) {
      this.preferences.markCompletedUnread([sessionId]);
    }
    if (message && session.state !== 'completed') {
      await this.notifier.send({
        title: `${agent.label || agent.id} / ${session.name}`,
        message,
        priority: session.state === 'needs_input' ? 8 : 5,
        extras,
      });
    }

    if ((previous?.artifactCount || 0) < session.artifactCount) {
      await this.notifier.send({
        title: `${agent.label || agent.id} / ${session.name}`,
        message: `New image or artifact detected (${session.artifactCount})`,
        priority: 6,
        extras,
      });
    }
  }

  async refreshAll() {
    if (this.refreshAllPromise) {
      return this.refreshAllPromise;
    }

    this.refreshAllPromise = (async () => {
      try {
        await Promise.all(this.agents.map((agent) => this.refreshAgent(agent)));
      } finally {
        this.refreshAllPromise = null;
      }
    })();

    return this.refreshAllPromise;
  }

  listAgents() {
    return this.agents.map((agent) => ({
      id: agent.id,
      label: agent.label || agent.id,
      distro: agent.distro || '',
      baseUrl: agent.baseUrl,
      lastHealth: agent.lastHealth,
      lastError: agent.lastError,
      sessionCount: agent.sessions.length,
    }));
  }

  listSessions() {
    return this.listSessionsForWorkspace();
  }

  listSessionsForWorkspace(workspacePath = '', options = {}) {
    const includeHidden = Boolean(options.includeHidden);
    const agentId = `${options.agentId || ''}`.trim();
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
    const sessions = this.agents
      .filter((agent) => !agentId || agent.id === agentId)
      .flatMap((agent) => agent.sessions)
      .filter((session) => matchesWorkspace(session, normalizedWorkspacePath));
    return this.preferences.apply(sessions, { includeHidden });
  }

  updateSessionOrder(sessionIds) {
    return this.preferences.setOrder(sessionIds, this.agents.flatMap((agent) => agent.sessions.map((session) => session.id)));
  }

  hideSessions(sessionIds) {
    return this.preferences.hide(sessionIds);
  }

  unhideSessions(sessionIds) {
    return this.preferences.unhide(sessionIds);
  }

  clearCompletedUnread(sessionIds) {
    return this.preferences.clearCompletedUnread(sessionIds);
  }

  renameSessionId(previousId, nextId) {
    return this.preferences.renameSessionId(previousId, nextId);
  }

  findAgent(agentId) {
    const agent = this.agents.find((item) => item.id === agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    return agent;
  }

  findSession(sessionId) {
    const session = this.listSessions().find((item) => item.id === sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return session;
  }

  buildNotificationExtras(sessionId) {
    return buildGotifyExtras(buildNotificationClickUrl(this.config, sessionId));
  }
}

function shouldMarkCompletedUnread(previous, session) {
  if (!previous) {
    return false;
  }

  if (isSessionActivelyRunning(session)) {
    return false;
  }

  if (!session?.readyForInput) {
    return false;
  }

  if (session?.hasPendingUserInput) {
    return false;
  }

  return `${session.contentSignature || ''}` !== `${previous.contentSignature || ''}`;
}

function shouldClearCompletedUnread(session) {
  if (isSessionActivelyRunning(session)) {
    return true;
  }

  if (session?.hasPendingUserInput) {
    return true;
  }

  return !session?.readyForInput;
}

function normalizeWorkspacePath(workspacePath) {
  return normalizeWorkspacePathLoose(workspacePath);
}

function matchesWorkspace(session, workspacePath) {
  if (!workspacePath) {
    return true;
  }

  const currentPath = `${session.currentPath || session.workspace || ''}`.trim();
  if (!currentPath) {
    return false;
  }

  const normalizedCurrentPath = normalizeWorkspacePathLoose(currentPath);
  return workspacePathsEqual(normalizedCurrentPath, workspacePath) || isWorkspaceWithinRoot(normalizedCurrentPath, workspacePath);
}
