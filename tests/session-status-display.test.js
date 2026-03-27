import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSessionStatusDisplay } from '../src/shared/session-status-display.js';

test('session status shows running while the computer session is still busy', () => {
  const result = deriveSessionStatusDisplay(
    {
      id: 'agent-a:demo',
      state: 'running',
      readyForInput: false,
      hasPendingUserInput: false,
      hasBackgroundTask: false,
      activityAt: 100,
      contentSignature: 'same',
    },
    {
      seenActivityAt: 100,
      seenContentSignature: 'same',
    },
  );

  assert.deepEqual(result, {
    label: '运行中',
    tone: 'idle',
  });
});

test('session status shows running for codex sessions that still expose a working status line', () => {
  const result = deriveSessionStatusDisplay(
    {
      id: 'agent-a:demo',
      state: 'running',
      readyForInput: true,
      hasPendingUserInput: false,
      hasBackgroundTask: false,
      previewText: '• Working (54s • esc to interrupt)',
      activityAt: 100,
      contentSignature: 'same',
    },
    {
      seenActivityAt: 100,
      seenContentSignature: 'same',
    },
  );

  assert.deepEqual(result, {
    label: '运行中',
    tone: 'idle',
  });
});

test('session status keeps error sessions on an error badge even when a background task flag is present', () => {
  const result = deriveSessionStatusDisplay(
    {
      id: 'agent-a:demo',
      state: 'error',
      readyForInput: false,
      hasPendingUserInput: false,
      hasBackgroundTask: true,
      previewText: '• 根因我已经确认并绕开了。',
      activityAt: 100,
      contentSignature: 'same',
    },
    {
      seenActivityAt: 100,
      seenContentSignature: 'same',
    },
  );

  assert.deepEqual(result, {
    label: '异常',
    tone: 'error',
  });
});

test('session status can show running for the currently open session', () => {
  const result = deriveSessionStatusDisplay(
    {
      id: 'agent-a:demo',
      state: 'running',
      readyForInput: false,
      hasPendingUserInput: false,
      runtimeStatus: 'Working (11s • esc to interrupt)',
      activityAt: 100,
      contentSignature: 'same',
    },
    {
      currentSessionId: 'agent-a:demo',
      includeCurrentSession: true,
      seenActivityAt: 100,
      seenContentSignature: 'same',
    },
  );

  assert.deepEqual(result, {
    label: '运行中',
    tone: 'idle',
  });
});

test('session status hides the currently open session by default', () => {
  const result = deriveSessionStatusDisplay(
    {
      id: 'agent-a:demo',
      state: 'running',
      readyForInput: false,
      hasPendingUserInput: false,
    },
    {
      currentSessionId: 'agent-a:demo',
    },
  );

  assert.equal(result, null);
});

test('session status keeps completed badge for unseen ready sessions', () => {
  const result = deriveSessionStatusDisplay(
    {
      id: 'agent-a:demo',
      state: 'running',
      readyForInput: true,
      hasPendingUserInput: false,
      activityAt: 200,
      contentSignature: 'after',
    },
    {
      seenActivityAt: 100,
      seenContentSignature: 'before',
    },
  );

  assert.deepEqual(result, {
    label: '代办',
    tone: 'completed',
  });
});

test('session status prefers completed badge over background-task running once the prompt is ready', () => {
  const result = deriveSessionStatusDisplay(
    {
      id: 'agent-a:demo',
      state: 'running',
      readyForInput: true,
      hasPendingUserInput: false,
      hasBackgroundTask: true,
      activityAt: 200,
      contentSignature: 'after',
    },
    {
      seenActivityAt: 100,
      seenContentSignature: 'before',
    },
  );

  assert.deepEqual(result, {
    label: '代办',
    tone: 'completed',
  });
});
