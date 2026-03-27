import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { loadJsonConfig, parseCompositeSessionId, safeSessionId } from '../shared/config.js';
import { buildSessionCommand, normalizeSessionKind } from '../shared/session-kind.js';
import { GatewayState } from './state.js';
import { createAuth } from './auth.js';
import { GotifyNotifier } from './notifier.js';
import { AuditLog } from './audit-log.js';
import { HostLauncher } from './host-launcher.js';
import { buildSnapshotStreamFingerprint, resolveStreamIntervalMs } from './streaming.js';
import { renderBrowserAppRedirectPage } from './browser-handoff.js';
import { applyGatewaySecurityHeaders, buildBrowserHandoffContentSecurityPolicy } from './security-headers.js';

const { config, configPath } = loadJsonConfig('REMOTE_CONNECT_GATEWAY_CONFIG', 'config/gateway.example.json');
const notifier = new GotifyNotifier(config.notifications);
const state = new GatewayState(config, notifier);
const auth = createAuth(config);
const auditLog = new AuditLog(config.auditLogPath);
const hostLauncher = new HostLauncher(config);
const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const wsServer = new WebSocketServer({ noServer: true });

app.use(express.json({ limit: config.uploadBodyLimit || '25mb' }));
app.use(applyGatewaySecurityHeaders);
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader('cache-control', 'no-store');
  }
  next();
});
app.use(express.static(path.resolve(process.cwd(), 'public')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    configPath,
  });
});

app.get('/api/auth/policy', (req, res) => {
  const entryOrigin = `${req.protocol}://${req.get('host')}`;
  const policy = auth.policy(req);
  res.json({
    ...policy,
    publicBaseUrl: policy.publicMode ? config.publicBaseUrl || null : null,
    mobileDeepLinkBase: config.mobileDeepLinkBase || null,
    entryOrigin,
    apiOrigin: policy.publicMode ? config.publicBaseUrl || entryOrigin : entryOrigin,
    currentTrustedIdentity: config.auth?.trustedProxyHeader ? req.headers[`${config.auth.trustedProxyHeader}`.toLowerCase()] || null : null,
  });
});

app.get('/api/auth/browser/start', (req, res) => {
  try {
    const origin = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    const callback = new URL('/api/auth/browser/callback', origin);
    for (const [key, value] of Object.entries(req.query || {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          callback.searchParams.append(key, `${item || ''}`);
        }
      } else if (value != null) {
        callback.searchParams.set(key, `${value}`);
      }
    }
    res.redirect(callback.toString());
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

app.get('/api/auth/browser/callback', (req, res) => {
  try {
    const grant = auth.createBrowserGrant(req, req.query || {});
    auditLog.write({
      event: 'browser_login_grant',
      trustedIdentity: grant.trustedIdentity,
      deviceId: req.query?.deviceId || null,
      deviceName: req.query?.deviceName || null,
    });
    res
      .status(200)
      .setHeader('Content-Security-Policy', buildBrowserHandoffContentSecurityPolicy())
      .setHeader('content-type', 'text/html; charset=utf-8')
      .send(renderBrowserAppRedirectPage(grant.redirectUrl));
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message,
    });
  }
});

app.post('/api/auth/browser/login', (req, res) => {
  auditLog.write({
    event: 'browser_login_attempt',
    clientId: req.body?.clientId || null,
    clientName: req.body?.clientName || null,
    trustedIdentity: config.auth?.trustedProxyHeader ? req.headers[`${config.auth.trustedProxyHeader}`.toLowerCase()] || null : null,
    ip: req.ip,
  });
  auth.browserLogin(req, res, req.body || {});
});

app.post('/api/auth/grant/exchange', (req, res) => {
  auditLog.write({
    event: 'browser_grant_exchange',
    deviceId: req.body?.deviceId || null,
    deviceName: req.body?.deviceName || null,
  });
  auth.exchangeGrant(req, res, req.body || {});
});

app.post('/api/auth/local-login', (req, res) => {
  auditLog.write({
    event: 'local_login_attempt',
    clientId: req.body?.clientId || req.body?.deviceId || null,
    clientName: req.body?.clientName || req.body?.deviceName || null,
    ip: req.ip,
  });
  auth.localLogin(req, res, req.body || {});
});

app.post('/api/auth/refresh', (req, res) => {
  auth.refresh(req, res, req.body || {});
});

app.post('/api/login', async (req, res) => {
  auditLog.write({
    event: 'login_attempt',
    clientId: req.body?.clientId || null,
    clientName: req.body?.clientName || null,
    ip: req.ip,
  });
  auth.login(req, res, req.body || {}, { requirePolicy: false });
});

app.post('/api/logout', auth.requireAuth, (req, res) => {
  auditLog.write({
    event: 'logout',
    actor: req.auth.clientId,
    deviceId: req.auth.deviceId || null,
  });
  auth.logout(res, req.auth);
});

app.post('/api/auth/logout', auth.requireAuth, (req, res) => {
  auditLog.write({
    event: 'auth_logout',
    actor: req.auth.clientId,
    deviceId: req.auth.deviceId || null,
  });
  auth.logout(res, req.auth);
});

app.post('/api/notifications/test', auth.requireAuth, async (req, res) => {
  const sessionId = req.body?.sessionId || null;
  const ok = await notifier.send({
    title: 'RemoCLI test',
    message: sessionId ? `Test notification for ${sessionId}` : 'RemoCLI notification path is working.',
    priority: 5,
    extras: state.buildNotificationExtras(sessionId),
  });
  auditLog.write({
    event: 'test_notification',
    actor: req.auth.clientId,
    clientName: req.auth.clientName,
    sessionId,
    delivered: ok,
  });
  res.json({
    ok,
  });
});

app.get('/api/me', auth.requireAuth, (req, res) => {
  res.json({
    clientId: req.auth.clientId,
    clientName: req.auth.clientName,
    trustedIdentity: req.auth.trustedIdentity,
    deviceId: req.auth.deviceId || null,
    authMethod: req.auth.authMethod || null,
  });
});

app.get('/api/devices', auth.requireAuth, (req, res) => {
  res.json({
    devices: auth.listDevices(req.auth.deviceId || ''),
  });
});

app.post('/api/devices/:deviceId/revoke', auth.requireAuth, (req, res) => {
  const revoked = auth.revokeDevice(req.params.deviceId);
  if (!revoked) {
    res.status(404).json({
      error: 'Unknown device',
    });
    return;
  }

  auditLog.write({
    event: 'revoke_device',
    actor: req.auth.clientId,
    deviceId: req.params.deviceId,
  });
  res.json({
    ok: true,
    device: revoked,
  });
});

app.get('/api/wsl', auth.requireAuth, (_req, res) => {
  res.json({
    agents: state.listAgents(),
  });
});

app.get('/api/sessions', auth.requireAuth, (_req, res) => {
  const workspacePath = `${_req.query.workspacePath || ''}`.trim();
  const includeHidden = `${_req.query.includeHidden || ''}` === 'true';
  const agentId = `${_req.query.agentId || ''}`.trim();
  res.json({
    sessions: state.listSessionsForWorkspace(workspacePath, { includeHidden, agentId }),
  });
});

app.post('/api/session-preferences/order', auth.requireAuth, (req, res) => {
  const sessionIds = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
  const nextPreferences = state.updateSessionOrder(sessionIds);
  res.json({
    ok: true,
    preferences: nextPreferences,
  });
});

app.post('/api/session-preferences/hide', auth.requireAuth, (req, res) => {
  const sessionIds = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
  const nextPreferences = state.hideSessions(sessionIds);
  res.json({
    ok: true,
    preferences: nextPreferences,
  });
});

app.post('/api/session-preferences/unhide', auth.requireAuth, (req, res) => {
  const sessionIds = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
  const nextPreferences = state.unhideSessions(sessionIds);
  res.json({
    ok: true,
    preferences: nextPreferences,
  });
});

app.post('/api/session-preferences/clear-completed-unread', auth.requireAuth, (req, res) => {
  const sessionIds = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
  const nextPreferences = state.clearCompletedUnread(sessionIds);
  res.json({
    ok: true,
    preferences: nextPreferences,
  });
});

app.get('/api/projects', auth.requireAuth, async (_req, res) => {
  const payload = await Promise.all(
    state.agents.map(async (agent) => {
      try {
        const response = await agent.client.listProjects();
        return {
          id: agent.id,
          label: agent.label || agent.id,
          distro: agent.distro || '',
          workspaceFlavor: response.workspaceFlavor || 'posix',
          rootPaths: response.rootPaths || [],
          projects: response.projects || [],
          lastError: null,
        };
      } catch (error) {
        return {
          id: agent.id,
          label: agent.label || agent.id,
          distro: agent.distro || '',
          workspaceFlavor: 'posix',
          rootPaths: [],
          projects: [],
          lastError: error.message,
        };
      }
    }),
  );

  res.json({
    agents: payload,
  });
});

app.get('/api/projects/suggest', auth.requireAuth, async (req, res) => {
  try {
    const agentId = `${req.query.agentId || ''}`.trim();
    if (!agentId) {
      res.status(400).json({
        error: 'agentId is required',
      });
      return;
    }

    const agent = state.findAgent(agentId);
    const payload = await agent.client.listProjectSuggestions({
      input: req.query.input || '',
      preferredRoot: req.query.preferredRoot || '',
    });
    res.json({
      agentId,
      ...payload,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message,
    });
  }
});

app.post('/api/sessions', auth.requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const agent = state.findAgent(body.wslId);
    const sessionTemplate = await resolveSessionTemplate(body);
    const response = await agent.client.startSession({
      ...body,
      kind: sessionTemplate.kind,
      admin: sessionTemplate.admin,
      command: sessionTemplate.command,
    });
    await state.refreshAgent(agent);
    const compositeId = safeSessionId(agent.id, response.session.name);
    let desktopLaunch = null;

    if (sessionTemplate.openDesktop !== false) {
      desktopLaunch = await tryOpenDesktopWindow({
        agent,
        session: response.session,
        asAdmin: sessionTemplate.admin,
      });
    }

    auditLog.write({
      event: 'start_session',
      actor: req.auth.clientId,
      clientName: req.auth.clientName,
      agentId: agent.id,
      sessionId: compositeId,
      kind: sessionTemplate.kind,
      command: sessionTemplate.command,
      requestedName: body.name || null,
      desktopLaunch: desktopLaunch?.ok ?? null,
    });
    res.status(201).json({
      ...response,
      desktopLaunch,
      session: {
        ...response.session,
        id: compositeId,
        agentId: agent.id,
        agentLabel: agent.label || agent.id,
        kind: response.session.kind || sessionTemplate.kind,
        admin: response.session.admin ?? sessionTemplate.admin,
      },
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: extractErrorMessage(error),
    });
  }
});

app.post('/api/sessions/:sessionId/attach', auth.requireAuth, async (req, res) => {
  const owner = `${req.auth.clientId}`;
  try {
    const { agentId, sessionName } = parseCompositeSessionId(req.params.sessionId);
    const lockResult = state.lockManager.forceAcquire(req.params.sessionId, owner);
    const view = `${req.body?.view || req.query?.view || 'summary'}`.trim() === 'detail' ? 'detail' : 'summary';

    const agent = state.findAgent(agentId);
    const snapshot = await agent.client.snapshot(sessionName, {
      lines: req.body?.lines || req.query?.lines,
      view,
    });
    state.clearCompletedUnread([req.params.sessionId]);
    auditLog.write({
      event: 'attach_session',
      actor: req.auth.clientId,
      clientName: req.auth.clientName,
      agentId,
      sessionId: req.params.sessionId,
    });
    res.json({
      sessionId: req.params.sessionId,
      snapshot,
      wsPath: `/ws/sessions/${encodeURIComponent(req.params.sessionId)}`,
      lock: lockResult.lock,
      replacedLock: lockResult.replaced,
    });
  } catch (error) {
    state.lockManager.release(req.params.sessionId, owner);
    res.status(404).json({
      error: error.message,
    });
  }
});

app.post('/api/sessions/:sessionId/release', auth.requireAuth, (req, res) => {
  const released = state.lockManager.release(req.params.sessionId, `${req.auth.clientId}`);
  if (!released) {
    res.status(409).json({
      error: 'Lock is held by another client',
    });
    return;
  }

  auditLog.write({
    event: 'release_session',
    actor: req.auth.clientId,
    clientName: req.auth.clientName,
    sessionId: req.params.sessionId,
  });
  res.json({
    ok: true,
  });
});

app.post('/api/sessions/:sessionId/input', auth.requireAuth, async (req, res) => {
  const owner = `${req.auth.clientId}`;
  const lock = state.lockManager.get(req.params.sessionId);
  if (!lock || lock.owner !== owner) {
    res.status(409).json({
      error: 'Acquire control before sending input',
      lock,
    });
    return;
  }

  const body = req.body || {};
  const { agentId, sessionName } = parseCompositeSessionId(req.params.sessionId);
  const agent = state.findAgent(agentId);
  const result = await agent.client.sendInput(sessionName, body);
  state.lockManager.acquire(req.params.sessionId, owner);
  auditLog.write({
    event: 'session_input',
    actor: req.auth.clientId,
    clientName: req.auth.clientName,
    sessionId: req.params.sessionId,
    textLength: body.text ? `${body.text}`.length : 0,
    key: body.key || null,
    editorAction: body.editorAction?.type || null,
  });
  res.json(result);
});

app.delete('/api/sessions/:sessionId', auth.requireAuth, async (req, res) => {
  const owner = `${req.auth.clientId}`;
  const lock = state.lockManager.get(req.params.sessionId);
  if (lock && lock.owner !== owner) {
    res.status(409).json({
      error: 'Release or acquire the session before closing it',
      lock,
    });
    return;
  }

  const { agentId, sessionName } = parseCompositeSessionId(req.params.sessionId);
  const agent = state.findAgent(agentId);
  await agent.client.closeSession(sessionName);
  state.lockManager.release(req.params.sessionId, owner);
  state.clearCompletedUnread([req.params.sessionId]);
  auditLog.write({
    event: 'close_session',
    actor: req.auth.clientId,
    clientName: req.auth.clientName,
    agentId,
    sessionId: req.params.sessionId,
  });
  await state.refreshAgent(agent);
  res.json({
    ok: true,
  });
});

app.post('/api/sessions/bulk-delete', auth.requireAuth, async (req, res) => {
  const sessionIds = [...new Set((Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : []).map((value) => `${value || ''}`.trim()).filter(Boolean))];
  if (!sessionIds.length) {
    res.status(400).json({
      error: 'Select at least one session',
    });
    return;
  }

  const sessions = sessionIds.map((sessionId) => state.findSession(sessionId));
  const groupedByAgent = new Map();
  for (const session of sessions) {
    const currentGroup = groupedByAgent.get(session.agentId) || [];
    currentGroup.push(session);
    groupedByAgent.set(session.agentId, currentGroup);
  }

  for (const session of sessions) {
    const owner = `${req.auth.clientId}`;
    const lock = state.lockManager.get(session.id);
    if (lock && lock.owner !== owner) {
      res.status(409).json({
        error: `Release or acquire ${session.name} before deleting it`,
        sessionId: session.id,
        lock,
      });
      return;
    }
  }

  for (const session of sessions) {
    const { agentId, sessionName } = parseCompositeSessionId(session.id);
    const agent = state.findAgent(agentId);
    await agent.client.closeSession(sessionName);
    state.lockManager.release(session.id, `${req.auth.clientId}`);
    state.clearCompletedUnread([session.id]);
    auditLog.write({
      event: 'bulk_delete_session',
      actor: req.auth.clientId,
      clientName: req.auth.clientName,
      agentId,
      sessionId: session.id,
    });
  }

  for (const [agentId] of groupedByAgent) {
    await state.refreshAgent(state.findAgent(agentId));
  }

  res.json({
    ok: true,
    deletedSessionIds: sessionIds,
  });
});

app.post('/api/sessions/:sessionId/open-local', auth.requireAuth, async (req, res) => {
  try {
    const { agentId } = parseCompositeSessionId(req.params.sessionId);
    const agent = state.findAgent(agentId);
    await state.refreshAgent(agent);
    const session = state.findSession(req.params.sessionId);
    const desktopLaunch = await tryOpenDesktopWindow({
      agent,
      session,
      asAdmin: Boolean(session.admin),
    });
    await state.refreshAgent(agent);

    auditLog.write({
      event: 'open_local_terminal',
      actor: req.auth.clientId,
      clientName: req.auth.clientName,
      agentId: agent.id,
      sessionId: req.params.sessionId,
      desktopLaunch: desktopLaunch?.ok ?? null,
    });

    res.json({
      ok: desktopLaunch?.ok ?? false,
      desktopLaunch,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

app.post('/api/sessions/:sessionId/rename', auth.requireAuth, async (req, res) => {
  try {
    const currentSession = state.findSession(req.params.sessionId);
    const agent = state.findAgent(currentSession.agentId);
    const response = await agent.client.renameSession(currentSession.tmuxSessionName || currentSession.name, {
      name: req.body?.name,
    });
    const previousLock = state.lockManager.get(req.params.sessionId);

    await state.refreshAgent(agent);

    const nextSession = state.agents
      .flatMap((item) => item.sessions)
      .find((session) => session.agentId === agent.id && session.tmuxSessionName === response.session.tmuxSessionName);

    if (!nextSession) {
      throw new Error('Renamed session could not be found after refresh');
    }

    if (previousLock) {
      state.lockManager.release(req.params.sessionId, previousLock.owner);
      state.lockManager.forceAcquire(nextSession.id, previousLock.owner);
    }

    state.renameSessionId(req.params.sessionId, nextSession.id);

    auditLog.write({
      event: 'rename_session',
      actor: req.auth.clientId,
      clientName: req.auth.clientName,
      agentId: agent.id,
      previousSessionId: req.params.sessionId,
      nextSessionId: nextSession.id,
      nextName: nextSession.name,
    });

    res.json({
      ok: true,
      session: nextSession,
      lock: state.lockManager.get(nextSession.id),
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: extractErrorMessage(error),
    });
  }
});

app.get('/api/sessions/:sessionId/snapshot', auth.requireAuth, async (req, res) => {
  const { agentId, sessionName } = parseCompositeSessionId(req.params.sessionId);
  const agent = state.findAgent(agentId);
  res.json(
    await agent.client.snapshot(sessionName, {
      lines: req.query?.lines,
      view: req.query?.view,
    }),
  );
});

app.get('/api/sessions/:sessionId/conversation/items/:itemId', auth.requireAuth, async (req, res) => {
  try {
    const { agentId, sessionName } = parseCompositeSessionId(req.params.sessionId);
    const agent = state.findAgent(agentId);
    res.json(
      await agent.client.conversationItem(sessionName, decodeURIComponent(req.params.itemId), {
        lines: req.query?.lines,
      }),
    );
  } catch (error) {
    res.status(error.statusCode || 404).json({
      error: extractErrorMessage(error),
    });
  }
});

app.get('/api/sessions/:sessionId/history', auth.requireAuth, async (req, res) => {
  const { agentId, sessionName } = parseCompositeSessionId(req.params.sessionId);
  const agent = state.findAgent(agentId);
  const result = await agent.client.history(sessionName);
  auditLog.write({
    event: 'view_session_history',
    actor: req.auth.clientId,
    clientName: req.auth.clientName,
    agentId,
    sessionId: req.params.sessionId,
  });
  res.json(result);
});

app.get('/api/sessions/:sessionId/artifacts', auth.requireAuth, async (req, res) => {
  const { agentId, sessionName } = parseCompositeSessionId(req.params.sessionId);
  const agent = state.findAgent(agentId);
  const result = await agent.client.listArtifacts(sessionName);
  res.json({
    ...result,
    artifacts: (result.artifacts || []).map((artifact) => ({
      ...artifact,
      url: `/api/artifacts/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionName)}/${encodeURIComponent(
        artifact.name,
      )}`,
    })),
  });
});

app.post('/api/sessions/:sessionId/pasted-images', auth.requireAuth, async (req, res) => {
  try {
    const owner = `${req.auth.clientId}`;
    const lock = state.lockManager.get(req.params.sessionId);
    if (!lock || lock.owner !== owner) {
      res.status(409).json({
        error: 'Acquire control before uploading an image',
        lock,
      });
      return;
    }

    const { agentId, sessionName } = parseCompositeSessionId(req.params.sessionId);
    const agent = state.findAgent(agentId);
    const result = await agent.client.uploadPastedImage(sessionName, req.body || {});
    auditLog.write({
      event: 'upload_pasted_image',
      actor: req.auth.clientId,
      clientName: req.auth.clientName,
      sessionId: req.params.sessionId,
      fileName: result.artifact?.name || null,
      contentType: result.artifact?.contentType || req.body?.contentType || null,
    });
    res.status(201).json({
      ...result,
      artifact: result.artifact
        ? {
            ...result.artifact,
            url: `/api/artifacts/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionName)}/${encodeURIComponent(
              result.artifact.name,
            )}`,
          }
        : null,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

app.get('/api/artifacts/:agentId/:sessionName/:artifactName', auth.requireAuth, async (req, res) => {
  const agent = state.findAgent(decodeURIComponent(req.params.agentId));
  const response = await agent.client.fetchArtifact(
    decodeURIComponent(req.params.sessionName),
    decodeURIComponent(req.params.artifactName),
  );

  if (!response.ok) {
    res.status(response.status).send(await response.text());
    return;
  }

  res.status(response.status);
  res.setHeader('content-type', response.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('cache-control', 'private, max-age=30');
  const arrayBuffer = await response.arrayBuffer();
  res.send(Buffer.from(arrayBuffer));
});

server.on('upgrade', (req, socket, head) => {
  const session = auth.parseRequest(req);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wsServer.handleUpgrade(req, socket, head, (ws) => {
    ws.clientSession = session;
    wsServer.emit('connection', ws, req);
  });
});

wsServer.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  const match = requestUrl.pathname.match(/^\/ws\/sessions\/(.+)$/);
  if (!match) {
    ws.close(1008, 'Unknown stream');
    return;
  }

  const sessionId = decodeURIComponent(match[1]);
  const owner = `${ws.clientSession.clientId}`;
  const requestedSnapshotLines = `${requestUrl.searchParams.get('lines') || ''}`.trim();
  const requestedView = `${requestUrl.searchParams.get('view') || 'summary'}`.trim() === 'detail' ? 'detail' : 'summary';
  let stopped = false;
  let lastStreamFingerprint = '';

  const sendSnapshot = async () => {
    if (stopped) {
      return;
    }

    try {
      const { agentId, sessionName } = parseCompositeSessionId(sessionId);
      const agent = state.findAgent(agentId);
      const [snapshot, artifacts] = await Promise.all([
        agent.client.snapshot(sessionName, {
          lines: requestedSnapshotLines,
          view: requestedView,
        }),
        agent.client.listArtifacts(sessionName),
      ]);
      const payload = {
        ...snapshot,
        artifacts: artifacts.artifacts || [],
        lock: state.lockManager.get(sessionId),
        viewer: owner,
      };
      const nextFingerprint = buildSnapshotStreamFingerprint(payload);
      if (nextFingerprint === lastStreamFingerprint) {
        return;
      }
      lastStreamFingerprint = nextFingerprint;
      ws.send(
        JSON.stringify({
          type: 'snapshot',
          payload,
        }),
      );
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: 'error',
          payload: {
            message: error.message,
          },
        }),
      );
    }
  };

  const streamIntervalMs = resolveStreamIntervalMs(config.streamIntervalMs);
  const interval = setInterval(sendSnapshot, streamIntervalMs);
  sendSnapshot().catch(() => {});

  ws.on('message', async (raw) => {
    const message = JSON.parse(raw.toString('utf8'));
    if (message.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (message.type === 'acquire') {
      ws.send(
        JSON.stringify({
          type: 'lock',
          payload: state.lockManager.acquire(sessionId, owner),
        }),
      );
      return;
    }

    if (message.type === 'release') {
      ws.send(
        JSON.stringify({
          type: 'lock',
          payload: {
            ok: state.lockManager.release(sessionId, owner),
            lock: state.lockManager.get(sessionId),
          },
        }),
      );
      return;
    }

    if (message.type === 'input') {
      const lock = state.lockManager.get(sessionId);
      if (!lock || lock.owner !== owner) {
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: {
              message: 'Acquire control before sending input',
            },
          }),
        );
        return;
      }

      try {
        const { agentId, sessionName } = parseCompositeSessionId(sessionId);
        const agent = state.findAgent(agentId);
        await forwardTerminalData(agent, sessionName, `${message.payload?.data || ''}`);
        await sendSnapshot();
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: {
              message: error.message,
            },
          }),
        );
      }
    }
  });

  ws.on('close', () => {
    stopped = true;
    clearInterval(interval);
  });
});

async function boot() {
  await state.refreshAll();
  setInterval(() => {
    state.refreshAll().catch(() => {});
  }, config.pollIntervalMs || 3000);

  server.listen(config.listen.port, config.listen.host, () => {
    console.log(
      `[gateway] listening on http://${config.listen.host}:${config.listen.port} using ${configPath} (${crypto
        .createHash('sha1')
        .update(configPath)
        .digest('hex')
        .slice(0, 8)})`,
    );
  });
}

boot().catch((error) => {
  console.error('[gateway] boot failed');
  console.error(error);
  process.exitCode = 1;
});

async function forwardTerminalData(agent, sessionName, data) {
  let textBuffer = '';

  async function flushText() {
    if (!textBuffer) {
      return;
    }
    await agent.client.sendInput(sessionName, { text: textBuffer });
    textBuffer = '';
  }

  for (const character of data) {
    if (character === '\r') {
      await flushText();
      await agent.client.sendInput(sessionName, { key: 'enter' });
      continue;
    }

    if (character === '\u007f') {
      await flushText();
      await agent.client.sendInput(sessionName, { key: 'backspace' });
      continue;
    }

    if (character === '\u0003') {
      await flushText();
      await agent.client.sendInput(sessionName, { key: 'ctrl-c' });
      continue;
    }

    if (character === '\t') {
      await flushText();
      await agent.client.sendInput(sessionName, { key: 'tab' });
      continue;
    }

    if (character === '\u001b') {
      await flushText();
      await agent.client.sendInput(sessionName, { key: 'escape' });
      continue;
    }

    textBuffer += character;
  }

  await flushText();
}

async function resolveSessionTemplate(body) {
  const kind = normalizeSessionKind(body.kind);
  const admin = kind === 'powershell' && Boolean(body.admin);
  const configuredWrapper = `${config.windows?.powerShellAdminWrapper || ''}`.trim();
  let powerShellAdminWrapper = configuredWrapper;

  if (admin && !powerShellAdminWrapper && (await hostLauncher.commandAvailable('gsudo.exe'))) {
    powerShellAdminWrapper = 'gsudo.exe';
  }

  return {
    kind,
    admin,
    openDesktop: body.openDesktop !== false,
    command: buildSessionCommand({
      sessionKind: kind,
      command: body.command,
      admin,
      powerShellAdminWrapper,
    }),
  };
}

async function tryOpenDesktopWindow({ agent, session, asAdmin }) {
  try {
    const launch = await hostLauncher.openTmuxSessionWindow({
      agentDistro: agent.distro || config.gatewayDistro || 'Ubuntu',
      sessionName: session.tmuxSessionName || session.name,
      windowTitle: session.name,
      asAdmin,
    });

    return {
      ok: true,
      ...launch,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

function extractErrorMessage(error) {
  if (error?.responseText) {
    try {
      const payload = JSON.parse(error.responseText);
      if (payload?.error) {
        return payload.error;
      }
    } catch {
      // Fall through to the generic message.
    }
  }

  return error?.message || 'Unknown error';
}
