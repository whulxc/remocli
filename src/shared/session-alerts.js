import { isSessionActivelyRunning } from './session-status-display.js';

export function normalizeCompletionAlertSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled !== false,
    notify: source.notify !== false,
    sound: source.sound !== false,
    vibrate: source.vibrate !== false,
  };
}

export function normalizeSessionCompletionAlertOverrides(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([sessionId, enabled]) => [`${sessionId || ''}`.trim(), normalizeEnabledValue(enabled)])
      .filter(([sessionId, enabled]) => sessionId && enabled != null),
  );
}

export function resolveCompletionAlertEnabled({
  sessionId = '',
  completionAlertSettings = {},
  sessionCompletionAlertOverrides = {},
} = {}) {
  const normalizedSessionId = `${sessionId || ''}`.trim();
  const overrides = normalizeSessionCompletionAlertOverrides(sessionCompletionAlertOverrides);
  if (normalizedSessionId && Object.prototype.hasOwnProperty.call(overrides, normalizedSessionId)) {
    return overrides[normalizedSessionId];
  }
  return normalizeCompletionAlertSettings(completionAlertSettings).enabled;
}

export function resolveCompletionAlertDeliverySettings({
  sessionId = '',
  viewedSessionId = '',
  completionAlertSettings = {},
  sessionCompletionAlertOverrides = {},
} = {}) {
  const settings = normalizeCompletionAlertSettings(completionAlertSettings);
  const enabled = resolveCompletionAlertEnabled({
    sessionId,
    completionAlertSettings: settings,
    sessionCompletionAlertOverrides,
  });

  if (!enabled) {
    return {
      enabled: false,
      notify: false,
      sound: false,
      vibrate: false,
    };
  }

  const normalizedSessionId = `${sessionId || ''}`.trim();
  const normalizedViewedSessionId = `${viewedSessionId || ''}`.trim();
  if (normalizedSessionId && normalizedSessionId === normalizedViewedSessionId) {
    return {
      enabled: true,
      notify: false,
      sound: false,
      vibrate: false,
    };
  }

  return {
    enabled: true,
    notify: settings.notify,
    sound: settings.sound,
    vibrate: settings.vibrate,
  };
}

export function deriveCompletionIndicators({ previousSessions = [], nextSessions = [], unreadSessionIds = [], viewedSessionId = '' } = {}) {
  const previousById = new Map((Array.isArray(previousSessions) ? previousSessions : []).map((session) => [`${session?.id || ''}`, session]));
  const nextList = Array.isArray(nextSessions) ? nextSessions : [];
  const nextUnread = new Set(normalizeSessionIds(unreadSessionIds));
  const completedSessionIds = [];

  for (const session of nextList) {
    const sessionId = `${session?.id || ''}`;
    if (!sessionId) {
      continue;
    }

    if (sessionId === viewedSessionId) {
      nextUnread.delete(sessionId);
      continue;
    }

    const previous = previousById.get(sessionId);
    const nextReady = isReadyForNewInput(session);
    if (!nextReady) {
      nextUnread.delete(sessionId);
      continue;
    }

    if (!previous) {
      continue;
    }

    const nextActivityAt = Number(session.activityAt || 0);
    const previousActivityAt = Number(previous.activityAt || 0);
    if (nextActivityAt !== previousActivityAt) {
      nextUnread.add(sessionId);
      completedSessionIds.push(sessionId);
    }
  }

  return {
    unreadSessionIds: [...nextUnread],
    completedSessionIds,
  };
}

export function deriveCompletionNotificationSessionIds({
  previousSessions = [],
  nextSessions = [],
  previousUnreadSessionIds = [],
  nextUnreadSessionIds = [],
  viewedSessionId = '',
} = {}) {
  const previousById = new Map((Array.isArray(previousSessions) ? previousSessions : []).map((session) => [`${session?.id || ''}`, session]));
  const previousUnread = new Set(normalizeSessionIds(previousUnreadSessionIds));
  const nextUnread = new Set(normalizeSessionIds(nextUnreadSessionIds));
  const completedSessionIds = [];

  for (const session of Array.isArray(nextSessions) ? nextSessions : []) {
    const sessionId = `${session?.id || ''}`;
    if (!sessionId || sessionId === viewedSessionId || !nextUnread.has(sessionId) || !isReadyForNewInput(session)) {
      continue;
    }

    if (!previousUnread.has(sessionId)) {
      completedSessionIds.push(sessionId);
      continue;
    }

    const previous = previousById.get(sessionId);
    if (!previous) {
      continue;
    }

    const nextActivityAt = Number(session.activityAt || 0);
    const previousActivityAt = Number(previous.activityAt || 0);
    const nextContentSignature = `${session?.contentSignature || ''}`.trim();
    const previousContentSignature = `${previous?.contentSignature || ''}`.trim();
    if (nextActivityAt > previousActivityAt || nextContentSignature !== previousContentSignature) {
      completedSessionIds.push(sessionId);
    }
  }

  return completedSessionIds;
}

export function deriveSessionNotificationEvents({
  previousSessions = [],
  nextSessions = [],
  previousUnreadSessionIds = [],
  nextUnreadSessionIds = [],
  viewedSessionId = '',
} = {}) {
  const events = [];
  const seenSessionIds = new Set();

  for (const sessionId of deriveCompletionNotificationSessionIds({
    previousSessions,
    nextSessions,
    previousUnreadSessionIds,
    nextUnreadSessionIds,
    viewedSessionId,
  })) {
    if (seenSessionIds.has(sessionId)) {
      continue;
    }
    seenSessionIds.add(sessionId);
    events.push({
      sessionId,
      kind: 'needs_input',
    });
  }

  for (const sessionId of deriveErrorNotificationSessionIds({
    previousSessions,
    nextSessions,
    viewedSessionId,
  })) {
    if (seenSessionIds.has(sessionId)) {
      continue;
    }
    seenSessionIds.add(sessionId);
    events.push({
      sessionId,
      kind: 'error',
    });
  }

  return events;
}
function isReadyForNewInput(session) {
  return Boolean(session?.readyForInput) && !isSessionActivelyRunning(session);
}

function deriveErrorNotificationSessionIds({
  previousSessions = [],
  nextSessions = [],
  viewedSessionId = '',
} = {}) {
  const previousById = new Map((Array.isArray(previousSessions) ? previousSessions : []).map((session) => [`${session?.id || ''}`, session]));
  const errorSessionIds = [];

  for (const session of Array.isArray(nextSessions) ? nextSessions : []) {
    const sessionId = `${session?.id || ''}`;
    if (!sessionId || sessionId === viewedSessionId || `${session?.state || ''}` !== 'error') {
      continue;
    }

    const previous = previousById.get(sessionId);
    if (!previous) {
      continue;
    }

    const previousState = `${previous?.state || ''}`;
    const nextActivityAt = Number(session?.activityAt || 0);
    const previousActivityAt = Number(previous?.activityAt || 0);
    const nextContentSignature = `${session?.contentSignature || ''}`.trim();
    const previousContentSignature = `${previous?.contentSignature || ''}`.trim();

    if (previousState !== 'error' || nextActivityAt > previousActivityAt || nextContentSignature !== previousContentSignature) {
      errorSessionIds.push(sessionId);
    }
  }

  return errorSessionIds;
}

function normalizeSessionIds(values) {
  return [...new Set([...(Array.isArray(values) ? values : [])].map((value) => `${value || ''}`.trim()).filter(Boolean))];
}

function normalizeEnabledValue(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return null;
}
