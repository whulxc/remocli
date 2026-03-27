import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayState } from '../src/gateway/state.js';

function createState() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-state-'));
  const filePath = path.join(tempDir, 'session-preferences.json');
  return new GatewayState(
    {
      agents: [],
      sessionPreferencesPath: filePath,
    },
    {
      send: async () => true,
    },
  );
}

test('gateway marks unread completion when content changes and session returns to prompt', async () => {
  const state = createState();

  await state.handleTransition(
    { id: 'agent-a', label: 'Agent A' },
    {
      name: 'demo',
      state: 'completed',
      artifactCount: 0,
      readyForInput: true,
      contentSignature: 'after',
    },
    {
      state: 'running',
      artifactCount: 0,
      readyForInput: false,
      contentSignature: 'before',
    },
  );

  assert.deepEqual(state.preferences.snapshot().unreadCompleted, ['agent-a:demo']);
});

test('gateway does not mark unread completion while a client lock is open', async () => {
  const state = createState();
  state.lockManager.acquire('agent-a:demo', 'client-a');

  await state.handleTransition(
    { id: 'agent-a', label: 'Agent A' },
    {
      name: 'demo',
      state: 'completed',
      artifactCount: 0,
      readyForInput: true,
      contentSignature: 'after',
    },
    {
      state: 'running',
      artifactCount: 0,
      readyForInput: false,
      contentSignature: 'before',
    },
  );

  assert.deepEqual(state.preferences.snapshot().unreadCompleted, []);
});

test('gateway does not mark unread completion while the session is still running', async () => {
  const state = createState();

  await state.handleTransition(
    { id: 'agent-a', label: 'Agent A' },
    {
      name: 'demo',
      state: 'running',
      artifactCount: 0,
      readyForInput: false,
      hasPendingUserInput: false,
      contentSignature: 'after',
    },
    {
      state: 'running',
      artifactCount: 0,
      readyForInput: false,
      hasPendingUserInput: false,
      contentSignature: 'before',
    },
  );

  assert.deepEqual(state.preferences.snapshot().unreadCompleted, []);
});

test('gateway marks unread completion when codex returns to an empty prompt even if tmux state still says running', async () => {
  const state = createState();

  await state.handleTransition(
    { id: 'agent-a', label: 'Agent A' },
    {
      name: 'demo',
      state: 'running',
      artifactCount: 0,
      readyForInput: true,
      hasPendingUserInput: false,
      contentSignature: 'after',
    },
    {
      state: 'running',
      artifactCount: 0,
      readyForInput: false,
      hasPendingUserInput: false,
      contentSignature: 'before',
    },
  );

  assert.deepEqual(state.preferences.snapshot().unreadCompleted, ['agent-a:demo']);
});

test('gateway does not mark unread completion while the session still shows a working indicator', async () => {
  const state = createState();

  await state.handleTransition(
    { id: 'agent-a', label: 'Agent A' },
    {
      name: 'demo',
      state: 'running',
      artifactCount: 0,
      readyForInput: true,
      hasPendingUserInput: false,
      contentSignature: 'after',
      previewText: '• Working (10s • esc to interrupt)',
    },
    {
      state: 'running',
      artifactCount: 0,
      readyForInput: false,
      hasPendingUserInput: false,
      contentSignature: 'before',
      previewText: '',
    },
  );

  assert.deepEqual(state.preferences.snapshot().unreadCompleted, []);
});

test('gateway does not mark unread completion while the user is typing at the prompt', async () => {
  const state = createState();

  await state.handleTransition(
    { id: 'agent-a', label: 'Agent A' },
    {
      name: 'demo',
      state: 'completed',
      artifactCount: 0,
      readyForInput: false,
      hasPendingUserInput: true,
      contentSignature: 'after',
    },
    {
      state: 'completed',
      artifactCount: 0,
      readyForInput: true,
      hasPendingUserInput: false,
      contentSignature: 'before',
    },
  );

  assert.deepEqual(state.preferences.snapshot().unreadCompleted, []);
});

test('gateway clears unread completion when the session starts running again', async () => {
  const state = createState();
  state.preferences.markCompletedUnread(['agent-a:demo']);

  await state.handleTransition(
    { id: 'agent-a', label: 'Agent A' },
    {
      name: 'demo',
      state: 'running',
      artifactCount: 0,
      readyForInput: false,
      hasPendingUserInput: false,
      contentSignature: 'after',
    },
    {
      state: 'running',
      artifactCount: 0,
      readyForInput: true,
      hasPendingUserInput: false,
      contentSignature: 'before',
    },
  );

  assert.deepEqual(state.preferences.snapshot().unreadCompleted, []);
});

test('gateway clears unread completion when the user starts typing on the computer', async () => {
  const state = createState();
  state.preferences.markCompletedUnread(['agent-a:demo']);

  await state.handleTransition(
    { id: 'agent-a', label: 'Agent A' },
    {
      name: 'demo',
      state: 'running',
      artifactCount: 0,
      readyForInput: false,
      hasPendingUserInput: true,
      contentSignature: 'after',
    },
    {
      state: 'running',
      artifactCount: 0,
      readyForInput: true,
      hasPendingUserInput: false,
      contentSignature: 'before',
    },
  );

  assert.deepEqual(state.preferences.snapshot().unreadCompleted, []);
});

test('gateway filters workspace sessions by agent id before matching paths', () => {
  const state = createState();
  state.agents = [
    {
      id: 'agent-a',
      sessions: [
        {
          id: 'agent-a:demo-a',
          workspace: '/home/demo/workspace/demo',
          currentPath: '/home/demo/workspace/demo',
        },
      ],
    },
    {
      id: 'agent-b',
      sessions: [
        {
          id: 'agent-b:demo-b',
          workspace: '/home/demo/workspace/demo',
          currentPath: '/home/demo/workspace/demo',
        },
      ],
    },
  ];

  const sessions = state.listSessionsForWorkspace('/home/demo/workspace/demo', {
    agentId: 'agent-b',
  });

  assert.deepEqual(
    sessions.map((session) => session.id),
    ['agent-b:demo-b'],
  );
});

test('gateway refreshAll de-duplicates overlapping refresh requests', async () => {
  const state = createState();
  let refreshCalls = 0;
  let releaseRefresh;
  const blockedRefresh = new Promise((resolve) => {
    releaseRefresh = resolve;
  });

  state.agents = [
    {
      id: 'agent-a',
      client: {},
      sessions: [],
    },
  ];

  state.refreshAgent = async () => {
    refreshCalls += 1;
    await blockedRefresh;
  };

  const first = state.refreshAll();
  const second = state.refreshAll();

  assert.equal(refreshCalls, 1);

  releaseRefresh();
  await Promise.all([first, second]);
  assert.equal(state.refreshAllPromise, null);
});
