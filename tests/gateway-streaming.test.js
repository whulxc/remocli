import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshotStreamFingerprint, resolveStreamIntervalMs } from '../src/gateway/streaming.js';

test('resolveStreamIntervalMs keeps the configured default instead of forcing 500ms', () => {
  assert.equal(resolveStreamIntervalMs(undefined), 1500);
  assert.equal(resolveStreamIntervalMs(1500), 1500);
});

test('resolveStreamIntervalMs clamps too-low and too-high values', () => {
  assert.equal(resolveStreamIntervalMs(100), 750);
  assert.equal(resolveStreamIntervalMs(9000), 3000);
});

test('buildSnapshotStreamFingerprint stays stable for identical payloads', () => {
  const payload = {
    snapshot: 'line 1\nline 2',
    snapshotLineCount: 2,
    requestedSnapshotLines: 1000,
    hasEarlierHistory: false,
    state: 'running',
    editingContext: {
      promptText: '>',
      currentInput: '',
    },
    conversation: {
      statusLine: 'Working (3s)',
    },
    lock: {
      owner: 'client-a',
    },
    artifacts: [{ name: 'a.png', size: 12, updatedAt: 34 }],
  };

  assert.equal(buildSnapshotStreamFingerprint(payload), buildSnapshotStreamFingerprint({ ...payload }));
});

test('buildSnapshotStreamFingerprint changes when snapshot content changes', () => {
  const basePayload = {
    snapshot: 'line 1\nline 2',
    snapshotLineCount: 2,
    requestedSnapshotLines: 1000,
    hasEarlierHistory: false,
    state: 'running',
    editingContext: {
      promptText: '>',
      currentInput: '',
    },
    conversation: {
      statusLine: 'Working (3s)',
    },
    lock: {
      owner: 'client-a',
    },
    artifacts: [],
  };

  const nextPayload = {
    ...basePayload,
    snapshot: 'line 1\nline 2\nline 3',
    snapshotLineCount: 3,
  };

  assert.notEqual(buildSnapshotStreamFingerprint(basePayload), buildSnapshotStreamFingerprint(nextPayload));
});

test('buildSnapshotStreamFingerprint changes when summary conversation items change without a snapshot body', () => {
  const basePayload = {
    snapshot: '',
    snapshotLineCount: 0,
    requestedSnapshotLines: 1000,
    hasEarlierHistory: false,
    state: 'running',
    editingContext: {
      promptText: '>',
      currentInput: '',
    },
    conversation: {
      statusLine: 'Working (3s)',
      items: [
        {
          id: 'itm_1',
          role: 'user',
          text: 'ship it',
        },
      ],
    },
    lock: {
      owner: 'client-a',
    },
    artifacts: [],
  };

  const nextPayload = {
    ...basePayload,
    conversation: {
      ...basePayload.conversation,
      items: [
        ...basePayload.conversation.items,
        {
          id: 'itm_2',
          role: 'assistant',
          summary: '• Final summary',
          collapsed: true,
          expandable: true,
        },
      ],
    },
  };

  assert.notEqual(buildSnapshotStreamFingerprint(basePayload), buildSnapshotStreamFingerprint(nextPayload));
});

test('buildSnapshotStreamFingerprint changes when summary history availability changes', () => {
  const basePayload = {
    snapshot: '',
    snapshotLineCount: 0,
    requestedSnapshotLines: 1000,
    hasEarlierHistory: false,
    state: 'ready',
    editingContext: {
      promptText: '› ',
      currentInput: '',
    },
    conversation: {
      statusLine: '',
      items: [
        {
          id: 'itm_1',
          role: 'user',
          text: 'summarize it',
        },
        {
          id: 'itm_2',
          role: 'assistant',
          summary: '• Final summary',
          collapsed: true,
          expandable: true,
        },
      ],
    },
    lock: null,
    artifacts: [],
  };

  const nextPayload = {
    ...basePayload,
    hasEarlierHistory: true,
  };

  assert.notEqual(buildSnapshotStreamFingerprint(basePayload), buildSnapshotStreamFingerprint(nextPayload));
});

test('buildSnapshotStreamFingerprint changes when a running session becomes ready without new summary text', () => {
  const basePayload = {
    snapshot: '',
    snapshotLineCount: 0,
    requestedSnapshotLines: 1000,
    hasEarlierHistory: false,
    state: 'running',
    activityAt: 100,
    readyForInput: false,
    hasBackgroundTask: false,
    hasPendingUserInput: false,
    promptAtStart: false,
    contentSignature: 'before',
    editingContext: {
      promptText: '› ',
      currentInput: 'working',
    },
    conversation: {
      statusLine: '',
      items: [
        {
          id: 'itm_1',
          role: 'user',
          text: 'continue',
        },
      ],
    },
    lock: null,
    artifacts: [],
  };

  const nextPayload = {
    ...basePayload,
    readyForInput: true,
    contentSignature: 'after',
    editingContext: {
      promptText: '› ',
      currentInput: '',
    },
  };

  assert.notEqual(buildSnapshotStreamFingerprint(basePayload), buildSnapshotStreamFingerprint(nextPayload));
});
