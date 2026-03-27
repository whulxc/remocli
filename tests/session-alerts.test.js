import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCompletionNotificationSessionIds,
  deriveCompletionIndicators,
  deriveSessionNotificationEvents,
  normalizeCompletionAlertSettings,
  normalizeSessionCompletionAlertOverrides,
  resolveCompletionAlertEnabled,
  resolveCompletionAlertDeliverySettings,
} from '../src/shared/session-alerts.js';

test('completion alerts default to enabled, notify, sound, and vibrate', () => {
  assert.deepEqual(normalizeCompletionAlertSettings(), {
    enabled: true,
    notify: true,
    sound: true,
    vibrate: true,
  });
});

test('completion alert overrides keep only explicit booleans', () => {
  assert.deepEqual(normalizeSessionCompletionAlertOverrides({
    '': true,
    alpha: true,
    beta: false,
    gamma: 'yes',
  }), {
    alpha: true,
    beta: false,
  });
});

test('session-specific completion reminder overrides global default', () => {
  assert.equal(resolveCompletionAlertEnabled({
    sessionId: 'alpha',
    completionAlertSettings: { enabled: false },
    sessionCompletionAlertOverrides: { alpha: true },
  }), true);
  assert.equal(resolveCompletionAlertEnabled({
    sessionId: 'beta',
    completionAlertSettings: { enabled: true },
    sessionCompletionAlertOverrides: { beta: false },
  }), false);
  assert.equal(resolveCompletionAlertEnabled({
    sessionId: 'gamma',
    completionAlertSettings: { enabled: false },
    sessionCompletionAlertOverrides: {},
  }), false);
});

test('viewed session reminders stay silent', () => {
  assert.deepEqual(resolveCompletionAlertDeliverySettings({
    sessionId: 'alpha',
    viewedSessionId: 'alpha',
    completionAlertSettings: {
      enabled: true,
      notify: true,
      sound: true,
      vibrate: true,
    },
    sessionCompletionAlertOverrides: {},
  }), {
    enabled: true,
    notify: false,
    sound: false,
    vibrate: false,
  });
});

test('disabled session reminders suppress notification, sound, and vibration together', () => {
  assert.deepEqual(resolveCompletionAlertDeliverySettings({
    sessionId: 'alpha',
    viewedSessionId: '',
    completionAlertSettings: {
      enabled: true,
      notify: true,
      sound: true,
      vibrate: true,
    },
    sessionCompletionAlertOverrides: {
      alpha: false,
    },
  }), {
    enabled: false,
    notify: false,
    sound: false,
    vibrate: false,
  });
});

test('deriveCompletionIndicators marks ready sessions with new activity as unread', () => {
  const result = deriveCompletionIndicators({
    previousSessions: [
      { id: 'a', activityAt: 100, readyForInput: false },
    ],
    nextSessions: [
      { id: 'a', activityAt: 200, readyForInput: true },
    ],
    unreadSessionIds: [],
    viewedSessionId: '',
  });

  assert.deepEqual(result.unreadSessionIds, ['a']);
  assert.deepEqual(result.completedSessionIds, ['a']);
});

test('deriveCompletionIndicators clears unread when the user opens the completed session', () => {
  const result = deriveCompletionIndicators({
    previousSessions: [
      { id: 'a', activityAt: 100, readyForInput: true },
    ],
    nextSessions: [
      { id: 'a', activityAt: 100, readyForInput: true },
    ],
    unreadSessionIds: ['a'],
    viewedSessionId: 'a',
  });

  assert.deepEqual(result.unreadSessionIds, []);
  assert.deepEqual(result.completedSessionIds, []);
});

test('deriveCompletionIndicators drops unread when the session starts running again', () => {
  const result = deriveCompletionIndicators({
    previousSessions: [
      { id: 'a', activityAt: 100, readyForInput: true },
    ],
    nextSessions: [
      { id: 'a', activityAt: 150, readyForInput: false },
    ],
    unreadSessionIds: ['a'],
    viewedSessionId: '',
  });

  assert.deepEqual(result.unreadSessionIds, []);
  assert.deepEqual(result.completedSessionIds, []);
});

test('deriveCompletionNotificationSessionIds notifies when a session becomes unread for the first time', () => {
  const result = deriveCompletionNotificationSessionIds({
    previousSessions: [
      { id: 'a', activityAt: 100, readyForInput: false, state: 'running' },
    ],
    nextSessions: [
      { id: 'a', activityAt: 200, readyForInput: true, state: 'completed' },
    ],
    previousUnreadSessionIds: [],
    nextUnreadSessionIds: ['a'],
    viewedSessionId: '',
  });

  assert.deepEqual(result, ['a']);
});

test('deriveCompletionNotificationSessionIds notifies again when an unread session gets a newer completion', () => {
  const result = deriveCompletionNotificationSessionIds({
    previousSessions: [
      { id: 'a', activityAt: 100, readyForInput: true, state: 'completed' },
    ],
    nextSessions: [
      { id: 'a', activityAt: 200, readyForInput: true, state: 'completed' },
    ],
    previousUnreadSessionIds: ['a'],
    nextUnreadSessionIds: ['a'],
    viewedSessionId: '',
  });

  assert.deepEqual(result, ['a']);
});

test('deriveCompletionNotificationSessionIds notifies again when an unread session gets a new content signature without an activity bump', () => {
  const result = deriveCompletionNotificationSessionIds({
    previousSessions: [
      { id: 'a', activityAt: 100, contentSignature: 'before', readyForInput: true, state: 'completed' },
    ],
    nextSessions: [
      { id: 'a', activityAt: 100, contentSignature: 'after', readyForInput: true, state: 'completed' },
    ],
    previousUnreadSessionIds: ['a'],
    nextUnreadSessionIds: ['a'],
    viewedSessionId: '',
  });

  assert.deepEqual(result, ['a']);
});

test('deriveCompletionNotificationSessionIds stays quiet for unchanged unread sessions', () => {
  const result = deriveCompletionNotificationSessionIds({
    previousSessions: [
      { id: 'a', activityAt: 100 },
    ],
    nextSessions: [
      { id: 'a', activityAt: 100 },
    ],
    previousUnreadSessionIds: ['a'],
    nextUnreadSessionIds: ['a'],
    viewedSessionId: '',
  });

  assert.deepEqual(result, []);
});

test('deriveCompletionNotificationSessionIds stays quiet for unread sessions that are still actively running', () => {
  const result = deriveCompletionNotificationSessionIds({
    previousSessions: [
      { id: 'a', activityAt: 100, readyForInput: true, contentSignature: 'before', state: 'completed' },
    ],
    nextSessions: [
      {
        id: 'a',
        activityAt: 200,
        readyForInput: true,
        contentSignature: 'after',
        state: 'running',
        previewText: '• Working (10s • esc to interrupt)',
        runtimeStatus: 'Working (10s • esc to interrupt)',
      },
    ],
    previousUnreadSessionIds: ['a'],
    nextUnreadSessionIds: ['a'],
    viewedSessionId: '',
  });

  assert.deepEqual(result, []);
});

test('deriveSessionNotificationEvents emits needs_input reminders for newly unread actionable sessions', () => {
  const result = deriveSessionNotificationEvents({
    previousSessions: [
      { id: 'a', activityAt: 100, readyForInput: false, state: 'running' },
    ],
    nextSessions: [
      { id: 'a', activityAt: 200, readyForInput: true, state: 'running' },
    ],
    previousUnreadSessionIds: [],
    nextUnreadSessionIds: ['a'],
    viewedSessionId: '',
  });

  assert.deepEqual(result, [
    { sessionId: 'a', kind: 'needs_input' },
  ]);
});

test('deriveSessionNotificationEvents keeps the currently viewed session quiet when it becomes ready', () => {
  const result = deriveSessionNotificationEvents({
    previousSessions: [
      { id: 'a', activityAt: 100, contentSignature: 'before', readyForInput: false, hasPendingUserInput: false, state: 'running' },
    ],
    nextSessions: [
      { id: 'a', activityAt: 200, contentSignature: 'after', readyForInput: true, hasPendingUserInput: false, state: 'running' },
    ],
    previousUnreadSessionIds: [],
    nextUnreadSessionIds: [],
    viewedSessionId: 'a',
  });

  assert.deepEqual(result, []);
});

test('deriveSessionNotificationEvents stays quiet while the viewed session still shows a working indicator', () => {
  const result = deriveSessionNotificationEvents({
    previousSessions: [
      { id: 'a', activityAt: 100, contentSignature: 'before', readyForInput: false, hasPendingUserInput: false, state: 'running' },
    ],
    nextSessions: [
      {
        id: 'a',
        activityAt: 200,
        contentSignature: 'after',
        readyForInput: true,
        hasPendingUserInput: false,
        state: 'running',
        previewText: '• Working (10s • esc to interrupt)',
        runtimeStatus: 'Working (10s • esc to interrupt)',
      },
    ],
    previousUnreadSessionIds: [],
    nextUnreadSessionIds: [],
    viewedSessionId: 'a',
  });

  assert.deepEqual(result, []);
});

test('deriveSessionNotificationEvents emits error reminders when a session enters error state', () => {
  const result = deriveSessionNotificationEvents({
    previousSessions: [
      { id: 'a', activityAt: 100, contentSignature: 'before', state: 'running' },
    ],
    nextSessions: [
      { id: 'a', activityAt: 200, contentSignature: 'after', state: 'error' },
    ],
    previousUnreadSessionIds: [],
    nextUnreadSessionIds: [],
    viewedSessionId: '',
  });

  assert.deepEqual(result, [
    { sessionId: 'a', kind: 'error' },
  ]);
});

test('deriveSessionNotificationEvents stays quiet for unchanged error sessions', () => {
  const result = deriveSessionNotificationEvents({
    previousSessions: [
      { id: 'a', activityAt: 200, contentSignature: 'same', state: 'error' },
    ],
    nextSessions: [
      { id: 'a', activityAt: 200, contentSignature: 'same', state: 'error' },
    ],
    previousUnreadSessionIds: [],
    nextUnreadSessionIds: [],
    viewedSessionId: '',
  });

  assert.deepEqual(result, []);
});
