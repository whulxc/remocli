export function deriveSessionStatusDisplay(session, options = {}) {
  const sessionId = `${session?.id || ''}`.trim();
  if (!sessionId) {
    return null;
  }

  const currentSessionId = `${options.currentSessionId || ''}`.trim();
  if (!options.includeCurrentSession && sessionId === currentSessionId) {
    return null;
  }

  if (session?.hasPendingUserInput) {
    return null;
  }

  const sessionState = `${session?.state || ''}`.trim();
  if (sessionState === 'error') {
    return {
      label: '异常',
      tone: 'error',
    };
  }

  if (isSessionActivelyRunning(session)) {
    return {
      label: '运行中',
      tone: 'idle',
    };
  }

  const activityAt = Number(session?.activityAt || 0);
  const seenActivityAt = Number(options.seenActivityAt || 0);
  const contentSignature = `${session?.contentSignature || ''}`.trim();
  const seenContentSignature = `${options.seenContentSignature || ''}`.trim();
  if (activityAt <= seenActivityAt && (!contentSignature || contentSignature === seenContentSignature)) {
    return null;
  }

  if (session?.readyForInput) {
    return {
      label: '代办',
      tone: 'completed',
    };
  }

  return null;
}

export function isSessionActivelyRunning(session) {
  const sessionState = `${session?.state || ''}`.trim();
  const hasWorkingIndicator =
    hasWorkingRuntimeIndicator(session?.runtimeStatus) || hasWorkingRuntimeIndicator(session?.previewText);

  if (!session?.readyForInput) {
    if (session?.hasBackgroundTask) {
      return true;
    }

    if (sessionState !== 'running') {
      return false;
    }

    return true;
  }

  if (sessionState !== 'running') {
    return false;
  }

  return hasWorkingIndicator;
}

function hasWorkingRuntimeIndicator(value) {
  const normalized = `${value || ''}`
    .replace(/^[\s•]+/u, '')
    .trim();
  if (!normalized) {
    return false;
  }

  return normalized.startsWith('Working (') || /esc to interrupt/i.test(normalized);
}
