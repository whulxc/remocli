import crypto from 'node:crypto';

const DEFAULT_STREAM_INTERVAL_MS = 1500;
const MIN_STREAM_INTERVAL_MS = 750;
const MAX_STREAM_INTERVAL_MS = 3000;

export function resolveStreamIntervalMs(value) {
  const parsed = Number.parseInt(`${value ?? ''}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STREAM_INTERVAL_MS;
  }
  return Math.max(MIN_STREAM_INTERVAL_MS, Math.min(parsed, MAX_STREAM_INTERVAL_MS));
}

export function buildSnapshotStreamFingerprint(payload = {}) {
  const conversationKey = (payload.conversation?.items || [])
    .map((item) =>
      [
        `${item?.id || ''}`,
        `${item?.role || ''}`,
        `${item?.text || ''}`,
        `${item?.summary || ''}`,
        `${Boolean(item?.collapsed)}`,
        `${Boolean(item?.expandable)}`,
      ].join(':'),
    )
    .join('|');
  const artifactKey = (payload.artifacts || [])
    .map((artifact) =>
      [
        `${artifact?.name || ''}`,
        `${artifact?.size || ''}`,
        `${artifact?.updatedAt || ''}`,
        `${artifact?.path || ''}`,
      ].join(':'),
    )
    .join('|');

  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        snapshot: `${payload.snapshot || ''}`,
        snapshotLineCount: Number(payload.snapshotLineCount || 0),
        requestedSnapshotLines: Number(payload.requestedSnapshotLines || 0),
        hasEarlierHistory: Boolean(payload.hasEarlierHistory),
        state: `${payload.state || ''}`,
        activityAt: Number(payload.activityAt || 0),
        readyForInput: Boolean(payload.readyForInput),
        hasBackgroundTask: Boolean(payload.hasBackgroundTask),
        hasPendingUserInput: Boolean(payload.hasPendingUserInput),
        promptAtStart: Boolean(payload.promptAtStart),
        contentSignature: `${payload.contentSignature || ''}`,
        runtimeStatus: `${payload.conversation?.statusLine || ''}`,
        conversationKey,
        promptText: `${payload.editingContext?.promptText || ''}`,
        currentInput: `${payload.editingContext?.currentInput || ''}`,
        lockOwner: `${payload.lock?.owner || ''}`,
        artifactKey,
      }),
    )
    .digest('hex');
}
