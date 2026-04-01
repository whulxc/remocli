import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { loadJsonConfig, ensureDir } from '../shared/config.js';
import {
  buildConversationSummary,
  extractSessionConversation,
  findConversationItemDetail,
} from '../shared/session-conversation.js';
import { derivePromptInputState, editorClearSequence, extractEditingContext } from '../shared/editing-context.js';
import { inferSessionKind, normalizeSessionKind, sessionKindLabel } from '../shared/session-kind.js';
import { previewFromConversation, previewFromSnapshot } from '../shared/session-preview.js';
import { detectSessionStateFromCapture } from '../shared/session-state.js';
import { normalizeWorkspaceFlavor, WORKSPACE_FLAVOR_POSIX, WORKSPACE_FLAVOR_WINDOWS, WORKSPACE_FLAVOR_WSL } from '../shared/workspace-paths.js';
import { listArtifacts, artifactContentType } from './artifacts.js';
import { configuredProjectRoots, listProjects, resolveSessionWorkspace, suggestWorkspacePaths } from './projects.js';
import { StableSessionCache } from './stable-session-cache.js';
import { SessionStore } from './session-store.js';
import {
  captureSession,
  captureSessionWindow,
  captureFullSession,
  captureVisiblePane,
  createSession,
  killSession,
  listSessions,
  paneInfo,
  renameSession as renameTmuxSession,
  renameWindow,
  sendKey,
  sendText,
  sessionExists,
} from './tmux.js';

const { config, configPath } = loadJsonConfig('REMOTE_CONNECT_AGENT_CONFIG', 'config/agent.example.json');
const app = express();
const dataDir = ensureDir(path.resolve(process.cwd(), config.dataDir || 'data/agent'));
const sessionStore = new SessionStore(path.join(dataDir, 'sessions'));
const workspacesRoot = path.resolve(config.workspacesRoot || path.join(dataDir, 'workspaces'));
const projectRoots = configuredProjectRoots(config, workspacesRoot);
const previewSnapshotLines = Number(config.previewSnapshotLines || config.snapshotLines || 220);
const defaultDetailSnapshotLines = Number(config.detailSnapshotLines || 3000);
const maxDetailSnapshotLines = Math.max(defaultDetailSnapshotLines, Number(config.maxDetailSnapshotLines || 30000));
const uploadBodyLimit = config.uploadBodyLimit || '25mb';
const workspaceFlavor = resolveWorkspaceFlavor(config);
const stableSessionCache = new StableSessionCache();

app.use(express.json({ limit: uploadBodyLimit }));

app.use((req, res, next) => {
  const token = req.headers['x-agent-token'];
  if (`${token || ''}` !== `${config.token}`) {
    res.status(401).json({
      error: 'Unauthorized',
    });
    return;
  }

  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    configPath,
  });
});

app.get('/api/sessions', async (_req, res) => {
  const tmuxSessions = await listSessions(config.sessionPrefix, {
    includeAll: config.discoverAllTmuxSessions ?? true,
  });
  const sessions = await Promise.all(
    tmuxSessions.map(async (session) => {
      const managed = session.sessionName.startsWith(config.sessionPrefix);
      const meta = sessionStore.read(session.sessionName) || {
        name: managed ? session.sessionName.replace(config.sessionPrefix, '') : session.sessionName,
        managed,
      };
      const { snapshot, visibleSnapshot, pane } = await captureStablePreview(session.sessionName);
      const artifacts = listArtifacts(meta.artifactDir);
      const kind = inferSessionKind({
        ...meta,
        currentCommand: pane.currentCommand,
        command: meta?.command || pane.currentCommand,
        previewText: previewFromSnapshot(snapshot),
        visibleSnapshot,
        snapshot,
      });
      const editingContext = extractEditingContext({
        kind,
        command: meta?.command || pane.currentCommand,
        visibleSnapshot,
        pane,
      });
      const promptState = derivePromptInputState(editingContext);
      const conversation = extractSessionConversation({
        kind,
        command: meta?.command,
        snapshot,
        pane,
        currentInput: editingContext.currentInput,
        promptAtStart: promptState.promptAtStart,
      });
      const previewConversation = conversation.mode === 'chat'
        ? buildConversationSummary(conversation)
        : conversation;
      const previewText = previewFromConversation(previewConversation) || previewFromSnapshot(snapshot);

      return {
        name: meta.name,
        tmuxSessionName: session.sessionName,
        managed: meta.managed ?? managed,
        kind,
        kindLabel: sessionKindLabel(kind, { admin: Boolean(meta.admin) }),
        admin: Boolean(meta.admin),
        workspace: meta.workspace || pane.currentPath || '',
        currentPath: pane.currentPath || '',
        artifactDir: meta.artifactDir,
        command: meta.command,
        previewText,
        contentSignature: digestContent(visibleSnapshot),
        createdAt: session.createdAt,
        activityAt: session.activityAt,
        attached: session.attached,
        state: detectSessionStateFromCapture({
          snapshot,
          visibleSnapshot,
          mode: conversation.mode,
          readyForInput: promptState.readyForInput,
          hasBackgroundTask: Boolean(editingContext.hasBackgroundTask),
        }, config.patterns || {}),
        hasBackgroundTask: Boolean(editingContext.hasBackgroundTask),
        promptAtStart: promptState.promptAtStart,
        readyForInput: promptState.readyForInput,
        hasPendingUserInput: promptState.hasPendingUserInput,
        artifactCount: artifacts.length,
        previewArtifact: artifacts[0] || null,
      };
    }),
  );

  res.json({
    sessions,
  });
});

function digestContent(value) {
  return crypto.createHash('sha1').update(`${value || ''}`).digest('hex');
}

app.get('/api/projects', async (_req, res) => {
  res.json({
    workspaceFlavor,
    rootPaths: projectRoots,
    projects: listProjects(projectRoots),
  });
});

app.get('/api/projects/suggest', async (req, res) => {
  try {
    res.json(
      suggestWorkspacePaths(config, workspacesRoot, req.query?.input || '', {
        preferredRoot: req.query?.preferredRoot || '',
        flavor: workspaceFlavor,
      }),
    );
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const body = req.body || {};
    const requestedWorkspace = `${body.workspace || ''}`.trim();
    const inferredName = requestedWorkspace ? path.basename(requestedWorkspace.replace(/[\\/]+$/, '')) : '';
    const requestedName = `${body.name || ''}`.trim();
    const name = sanitizeName(requestedName || inferredName || `codex-${Date.now()}`);
    const sessionName = `${config.sessionPrefix}${name}`;
    const createNamedSubdirectory = Boolean(requestedWorkspace) && Boolean(requestedName) && name !== inferredName;
    if (await sessionExists(sessionName)) {
      res.status(409).json({
        error: `Session already exists: ${name}. Use 开启原有会话，或换一个名字。`,
        sessionName,
        displayName: name,
      });
      return;
    }
    const workspace = resolveSessionWorkspace(config, workspacesRoot, name, requestedWorkspace || null, {
      createIfMissing: Boolean(body.createIfMissing),
      preferredRoot: body.workspaceRoot || '',
      createNamedSubdirectory,
    });
    const artifactDir = ensureDir(
      path.resolve(config.artifactsRoot || path.join(dataDir, 'artifacts'), body.artifactDir || name),
    );
    const command = body.command || config.defaultCommand || 'codex';
    const kind = normalizeSessionKind(body.kind);

    await createSession(sessionName, command, workspace, {
      REMOTE_CONNECT_SESSION: name,
      REMOTE_CONNECT_ARTIFACT_DIR: artifactDir,
    });
    await renameWindow(sessionName, name);

    const session = {
      name,
      tmuxSessionName: sessionName,
      managed: true,
      kind,
      kindLabel: sessionKindLabel(kind, { admin: Boolean(body.admin) }),
      admin: Boolean(body.admin),
      workspace,
      artifactDir,
      command,
      createdAt: Date.now(),
    };

    sessionStore.save(sessionName, session);
    res.status(201).json({
      session,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

function resolveWorkspaceFlavor(config) {
  const configuredFlavor = normalizeWorkspaceFlavor(config.workspaceFlavor);
  if (configuredFlavor) {
    return configuredFlavor;
  }
  if (process.platform === 'win32') {
    return WORKSPACE_FLAVOR_WINDOWS;
  }
  if (process.platform === 'linux') {
    try {
      if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) {
        return WORKSPACE_FLAVOR_WSL;
      }
      const version = fs.readFileSync('/proc/version', 'utf8');
      if (/microsoft/i.test(version)) {
        return WORKSPACE_FLAVOR_WSL;
      }
    } catch {
      // Ignore and fall back to POSIX.
    }
  }
  return WORKSPACE_FLAVOR_POSIX;
}

app.get('/api/sessions/:sessionName/snapshot', async (req, res) => {
  try {
    const sessionName = await resolveTmuxSessionName(req.params.sessionName);
    const meta = sessionStore.read(sessionName);
    const sessionPayload = await buildSessionSnapshot(sessionName, meta, {
      lines: req.query?.lines,
      view: req.query?.view,
    });
    const artifacts = listArtifacts(meta?.artifactDir);
    res.json({
      name: meta?.name || req.params.sessionName,
      ...sessionPayload,
      artifactCount: artifacts.length,
      previewArtifact: artifacts[0] || null,
      updatedAt: Date.now(),
    });
  } catch (error) {
    res.status(error.statusCode || 404).json({
      error: error.message,
    });
  }
});

app.get('/api/sessions/:sessionName/conversation/items/:itemId', async (req, res) => {
  try {
    const sessionName = await resolveTmuxSessionName(req.params.sessionName);
    const meta = sessionStore.read(sessionName);
    const item = await buildConversationItemDetail(sessionName, meta, req.params.itemId, {
      lines: req.query?.lines,
    });
    res.json({
      name: meta?.name || req.params.sessionName,
      item,
      updatedAt: Date.now(),
    });
  } catch (error) {
    res.status(error.statusCode || 404).json({
      error: error.message,
    });
  }
});

app.get('/api/sessions/:sessionName/history', async (req, res) => {
  try {
    const sessionName = await resolveTmuxSessionName(req.params.sessionName);
    const meta = sessionStore.read(sessionName);
    const snapshot = await captureFullSession(sessionName);
    res.json({
      name: meta?.name || req.params.sessionName,
      snapshot,
      lineCount: countSnapshotLines(snapshot),
      updatedAt: Date.now(),
    });
  } catch (error) {
    res.status(error.statusCode || 404).json({
      error: error.message,
    });
  }
});

app.post('/api/sessions/:sessionName/input', async (req, res) => {
  try {
    const sessionName = await resolveTmuxSessionName(req.params.sessionName);
    const body = req.body || {};

    if (body.editorAction?.type === 'apply_draft') {
      try {
        const result = await applyEditorDraft(sessionName, body.editorAction);
        res.json(result);
      } catch (error) {
        const statusCode = error.statusCode || 400;
        res.status(statusCode).json({
          error: error.message,
          editingContext: error.editingContext || null,
        });
      }
      return;
    }

    if (body.text) {
      await sendText(sessionName, `${body.text}`);
    }

    if (body.key) {
      await sendKey(sessionName, normalizeKey(body.key));
    }

    res.json({
      ok: true,
    });
  } catch (error) {
    res.status(error.statusCode || 404).json({
      error: error.message,
    });
  }
});

app.delete('/api/sessions/:sessionName', async (req, res) => {
  try {
    const sessionName = await resolveTmuxSessionName(req.params.sessionName);
    await killSession(sessionName);
    stableSessionCache.removeSession(sessionName);
    sessionStore.remove(sessionName);
    res.json({
      ok: true,
    });
  } catch (error) {
    res.status(error.statusCode || 404).json({
      error: error.message,
    });
  }
});

app.post('/api/sessions/:sessionName/rename', async (req, res) => {
  try {
    const currentTmuxSessionName = await resolveTmuxSessionName(req.params.sessionName);
    const requestedName = sanitizeName(req.body?.name || '');
    if (!requestedName) {
      res.status(400).json({
        error: 'Session name is required',
      });
      return;
    }

    const currentMeta = sessionStore.read(currentTmuxSessionName);
    const managed = currentMeta?.managed ?? currentTmuxSessionName.startsWith(config.sessionPrefix);
    const nextTmuxSessionName = managed ? `${config.sessionPrefix}${requestedName}` : requestedName;

    if (nextTmuxSessionName !== currentTmuxSessionName && await sessionExists(nextTmuxSessionName)) {
      res.status(409).json({
        error: `Session already exists: ${requestedName}`,
      });
      return;
    }

    if (nextTmuxSessionName !== currentTmuxSessionName) {
      await renameTmuxSession(currentTmuxSessionName, nextTmuxSessionName);
    }
    await renameWindow(nextTmuxSessionName, requestedName);

    const pane = await paneInfo(nextTmuxSessionName);
    const nextMeta = {
      ...(currentMeta || {}),
      name: requestedName,
      tmuxSessionName: nextTmuxSessionName,
      managed,
      workspace: currentMeta?.workspace || pane.currentPath || '',
      command: currentMeta?.command || pane.currentCommand || '',
      createdAt: currentMeta?.createdAt || Date.now(),
    };
    nextMeta.kind = inferSessionKind({
      ...nextMeta,
      currentCommand: pane.currentCommand,
      command: nextMeta.command,
    });
    nextMeta.kindLabel = sessionKindLabel(nextMeta.kind, { admin: Boolean(nextMeta.admin) });

    if (nextTmuxSessionName !== currentTmuxSessionName) {
      stableSessionCache.renameSession(currentTmuxSessionName, nextTmuxSessionName);
      sessionStore.remove(currentTmuxSessionName);
    }
    sessionStore.save(nextTmuxSessionName, nextMeta);

    res.json({
      ok: true,
      session: nextMeta,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message,
    });
  }
});

app.get('/api/sessions/:sessionName/artifacts', async (req, res) => {
  try {
    const sessionName = await resolveTmuxSessionName(req.params.sessionName);
    const meta = sessionStore.read(sessionName);
    const artifacts = listArtifacts(meta?.artifactDir);
    res.json({
      sessionName: req.params.sessionName,
      artifacts,
    });
  } catch (error) {
    res.status(error.statusCode || 404).json({
      error: error.message,
    });
  }
});

app.get('/api/sessions/:sessionName/artifacts/:artifactName', async (req, res) => {
  try {
    const sessionName = await resolveTmuxSessionName(req.params.sessionName);
    const meta = sessionStore.read(sessionName);
    const filePath = path.join(meta?.artifactDir || '', path.basename(req.params.artifactName));

    if (!filePath.startsWith(meta?.artifactDir || '') || !fs.existsSync(filePath)) {
      res.status(404).json({
        error: 'Artifact not found',
      });
      return;
    }

    res.setHeader('content-type', artifactContentType(filePath));
    res.sendFile(filePath);
  } catch (error) {
    res.status(error.statusCode || 404).json({
      error: error.message,
    });
  }
});

app.post('/api/sessions/:sessionName/pasted-images', async (req, res) => {
  try {
    const sessionName = await resolveTmuxSessionName(req.params.sessionName);
    const meta = ensureSessionArtifactDir(sessionName);
    if (!meta?.artifactDir) {
      res.status(400).json({
        error: 'Session does not have an artifact directory',
      });
      return;
    }

    const body = req.body || {};
    const image = writePastedImage(meta.artifactDir, body);
    res.status(201).json({
      ok: true,
      artifact: image,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message,
    });
  }
});

app.listen(config.listen.port, config.listen.host, () => {
  console.log(`[agent] listening on http://${config.listen.host}:${config.listen.port} using ${configPath}`);
});

function sanitizeName(value) {
  return `${value}`.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function ensureSessionArtifactDir(sessionName) {
  const currentMeta = sessionStore.read(sessionName);
  const displayName = sanitizeName(currentMeta?.name || sessionName.replace(config.sessionPrefix, '') || sessionName);
  const artifactDir = ensureDir(
    path.resolve(config.artifactsRoot || path.join(dataDir, 'artifacts'), displayName || sessionName),
  );
  if (currentMeta && `${currentMeta.artifactDir || ''}`.trim()) {
    return currentMeta;
  }

  const nextMeta = {
    name: displayName,
    tmuxSessionName: sessionName,
    managed: sessionName.startsWith(config.sessionPrefix),
    workspace: currentMeta?.workspace || '',
    command: currentMeta?.command || config.defaultCommand || 'bash -il',
    kind: currentMeta?.kind || inferSessionKind(config.defaultCommand || 'bash -il'),
    createdAt: currentMeta?.createdAt || Date.now(),
    ...currentMeta,
    artifactDir,
  };
  sessionStore.save(sessionName, nextMeta);
  return nextMeta;
}

function prefixedName(sessionName) {
  return `${config.sessionPrefix}${sanitizeName(sessionName)}`;
}

async function resolveTmuxSessionName(sessionName) {
  const exact = sanitizeName(sessionName);
  const prefixed = prefixedName(sessionName);

  if (await sessionExists(exact)) {
    return exact;
  }

  if (await sessionExists(prefixed)) {
    return prefixed;
  }

  const error = new Error(`Unknown tmux session: ${sessionName}`);
  error.statusCode = 404;
  throw error;
}

function normalizeKey(key) {
  const normalized = `${key}`.toLowerCase();
  if (normalized === 'enter') return 'Enter';
  if (normalized === 'ctrl-c') return 'C-c';
  if (normalized === 'ctrl-a') return 'C-a';
  if (normalized === 'ctrl-k') return 'C-k';
  if (normalized === 'backspace') return 'BSpace';
  if (normalized === 'tab') return 'Tab';
  if (normalized === 'escape') return 'Escape';
  return key;
}

async function buildSessionSnapshot(sessionName, meta, options = {}) {
  const view = normalizeConversationView(options.view);
  const sessionInfo = await describeSessionConversation(sessionName, meta, {
    lines: options.lines,
    includeMetadata: view === 'summary',
  });
  return {
    snapshot: view === 'summary' && sessionInfo.conversation.mode === 'chat' ? '' : sessionInfo.snapshot,
    snapshotLineCount: view === 'summary' && sessionInfo.conversation.mode === 'chat' ? 0 : sessionInfo.snapshotLineCount,
    requestedSnapshotLines: sessionInfo.requestedSnapshotLines,
    hasEarlierHistory: sessionInfo.hasEarlierHistory,
    activityAt: Number(meta?.activityAt || 0),
    contentSignature: sessionInfo.contentSignature,
    state: sessionInfo.state,
    editingContext: sessionInfo.editingContext,
    hasBackgroundTask: sessionInfo.hasBackgroundTask,
    promptAtStart: sessionInfo.promptState.promptAtStart,
    readyForInput: sessionInfo.promptState.readyForInput,
    hasPendingUserInput: sessionInfo.promptState.hasPendingUserInput,
    conversation: view === 'summary' && sessionInfo.conversation.mode === 'chat'
      ? buildConversationSummary(sessionInfo.conversation)
      : sessionInfo.conversation,
  };
}

async function buildConversationItemDetail(sessionName, meta, itemId, options = {}) {
  const requestedItemId = `${itemId || ''}`.trim();
  if (!requestedItemId) {
    const error = new Error('Missing conversation item id');
    error.statusCode = 400;
    throw error;
  }

  const sessionInfo = await describeSessionConversation(sessionName, meta, {
    lines: options.lines,
    includeMetadata: true,
  });
  let detail = findConversationItemDetail(sessionInfo.conversation, requestedItemId);
  if (!detail) {
    const fullHistoryInfo = await describeSessionConversation(sessionName, meta, {
      includeMetadata: true,
      fullHistory: true,
    });
    detail = findConversationItemDetail(fullHistoryInfo.conversation, requestedItemId);
  }

  if (!detail) {
    const error = new Error(`Unknown conversation item: ${requestedItemId}`);
    error.statusCode = 404;
    throw error;
  }

  return detail;
}

async function describeSessionConversation(sessionName, meta, options = {}) {
  const includeMetadata = Boolean(options.includeMetadata);
  const fullHistory = Boolean(options.fullHistory);
  const requestedSnapshotLines = resolveDetailSnapshotLines(options.lines);
  let snapshot = '';
  let snapshotLineCount = 0;
  let hasEarlierHistory = false;
  let visibleSnapshot = '';
  let pane = null;

  if (fullHistory) {
    [snapshot, visibleSnapshot, pane] = await Promise.all([
      captureFullSession(sessionName),
      captureVisiblePane(sessionName),
      paneInfo(sessionName),
    ]);
    snapshotLineCount = countSnapshotLines(snapshot);
  } else {
    const detail = await captureStableDetail(sessionName, requestedSnapshotLines);
    snapshot = detail.snapshotWindow.snapshot;
    snapshotLineCount = detail.snapshotWindow.lineCount;
    hasEarlierHistory = detail.snapshotWindow.hasEarlierHistory;
    visibleSnapshot = detail.visibleSnapshot;
    pane = detail.pane;
  }

  const effectiveKind = inferSessionKind({
    ...meta,
    currentCommand: pane.currentCommand,
    command: meta?.command || pane.currentCommand,
    visibleSnapshot,
    snapshot,
  });
  const editingContext = extractEditingContext({
    kind: effectiveKind,
    command: meta?.command,
    visibleSnapshot,
    pane,
  });
  const promptState = derivePromptInputState(editingContext);

  const conversation = extractSessionConversation({
    kind: effectiveKind,
    command: meta?.command,
    snapshot,
    pane,
    currentInput: editingContext.currentInput,
    promptAtStart: promptState.promptAtStart,
    includeMetadata,
  });

  return {
    snapshot,
    snapshotLineCount,
    requestedSnapshotLines,
    hasEarlierHistory,
    contentSignature: digestContent(visibleSnapshot),
    state: detectSessionStateFromCapture({
      snapshot,
      visibleSnapshot,
      mode: conversation.mode,
      readyForInput: promptState.readyForInput,
      hasBackgroundTask: Boolean(editingContext.hasBackgroundTask),
    }, config.patterns || {}),
    editingContext,
    hasBackgroundTask: Boolean(editingContext.hasBackgroundTask),
    promptState,
    conversation,
  };
}

function normalizeConversationView(value) {
  return `${value || ''}`.trim() === 'detail' ? 'detail' : 'summary';
}

async function captureStablePreview(sessionName) {
  const pane = await paneInfo(sessionName);
  if (pane.inMode) {
    const cached = stableSessionCache.getPreview(sessionName);
    if (cached) {
      return {
        snapshot: cached.snapshot,
        visibleSnapshot: cached.visibleSnapshot,
        pane: mergeFrozenPane(cached.pane, pane),
      };
    }
  }

  const [snapshot, visibleSnapshot] = await Promise.all([
    captureSession(sessionName, previewSnapshotLines),
    captureVisiblePane(sessionName),
  ]);
  stableSessionCache.setPreview(sessionName, {
    snapshot,
    visibleSnapshot,
    pane,
  });
  return {
    snapshot,
    visibleSnapshot,
    pane,
  };
}

async function captureStableDetail(sessionName, requestedSnapshotLines) {
  const pane = await paneInfo(sessionName);
  if (pane.inMode) {
    const cached = stableSessionCache.getDetail(sessionName, requestedSnapshotLines);
    if (cached) {
      return {
        snapshotWindow: cached.snapshotWindow,
        visibleSnapshot: cached.visibleSnapshot,
        pane: mergeFrozenPane(cached.pane, pane),
      };
    }
  }

  const [snapshotWindow, visibleSnapshot] = await Promise.all([
    captureSessionWindow(sessionName, requestedSnapshotLines),
    captureVisiblePane(sessionName),
  ]);
  stableSessionCache.setDetail(sessionName, requestedSnapshotLines, {
    snapshotWindow,
    visibleSnapshot,
    pane,
  });
  return {
    snapshotWindow,
    visibleSnapshot,
    pane,
  };
}

function mergeFrozenPane(cachedPane = {}, livePane = {}) {
  return {
    ...cachedPane,
    currentCommand: `${livePane.currentCommand || cachedPane.currentCommand || ''}`,
    currentPath: `${livePane.currentPath || cachedPane.currentPath || ''}`,
    inMode: false,
  };
}

function resolveDetailSnapshotLines(value) {
  const parsed = Number.parseInt(`${value ?? ''}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultDetailSnapshotLines;
  }
  return Math.min(parsed, maxDetailSnapshotLines);
}

function countSnapshotLines(snapshot) {
  if (!`${snapshot || ''}`.trim()) {
    return 0;
  }
  return `${snapshot}`.split(/\r?\n/).length;
}

async function applyEditorDraft(sessionName, editorAction) {
  const meta = sessionStore.read(sessionName);
  const sessionPayload = await buildSessionSnapshot(sessionName, meta);
  const editingContext = sessionPayload.editingContext;
  const shellKind = `${editorAction.shellKind || editingContext.shellKind || ''}`;

  if (editingContext.mode !== 'prompt' || !editingContext.supportsLocalEditor) {
    const error = new Error('Current program does not support local line editing');
    error.statusCode = 409;
    error.editingContext = editingContext;
    throw error;
  }

  const expectedRemoteInput = `${editorAction.expectedRemoteInput ?? ''}`;
  if (expectedRemoteInput !== `${editingContext.currentInput || ''}`) {
    const error = new Error('Remote input changed before the draft was applied');
    error.statusCode = 409;
    error.editingContext = editingContext;
    throw error;
  }

  for (const key of editorClearSequence(shellKind)) {
    await sendKey(sessionName, key);
  }

  if (editorAction.draft) {
    await sendText(sessionName, `${editorAction.draft}`);
  }

  if (editorAction.submit) {
    await sendKey(sessionName, 'Enter');
  }

  return {
    ok: true,
  };
}

function writePastedImage(artifactDir, body) {
  const contentType = `${body.contentType || ''}`.toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new Error('Only image uploads are supported');
  }

  const extension = imageExtension(contentType, body.fileName);
  const fileName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extension}`;
  const filePath = path.join(artifactDir, fileName);
  const dataBase64 = `${body.dataBase64 || ''}`.trim();
  if (!dataBase64) {
    throw new Error('Image payload is missing');
  }

  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.length) {
    throw new Error('Image payload is empty');
  }

  fs.writeFileSync(filePath, buffer);
  const stats = fs.statSync(filePath);
  return {
    name: fileName,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    path: filePath,
    contentType,
  };
}

function imageExtension(contentType, fileName) {
  const ext = path.extname(`${fileName || ''}`).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp' || ext === '.svg') {
    return ext;
  }

  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/svg+xml') return '.svg';
  return '.png';
}
