export const DEFAULT_COMPOSER_ATTACHMENT_LIMIT = 6;

export function attachmentIdentity(attachment) {
  const path = `${attachment?.path || ''}`.trim();
  if (path) {
    return path;
  }
  const url = `${attachment?.url || ''}`.trim();
  if (url) {
    return url;
  }
  const name = `${attachment?.name || ''}`.trim();
  if (name) {
    return name;
  }
  return '';
}

export function mergeComposerAttachments(existing = [], incoming = [], limit = DEFAULT_COMPOSER_ATTACHMENT_LIMIT) {
  const merged = [];
  const seen = new Set();
  const normalizedLimit = Math.max(1, Number.parseInt(`${limit || DEFAULT_COMPOSER_ATTACHMENT_LIMIT}`, 10) || DEFAULT_COMPOSER_ATTACHMENT_LIMIT);
  for (const candidate of [...incoming, ...existing]) {
    if (!candidate) {
      continue;
    }
    const identity = attachmentIdentity(candidate);
    if (!identity || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    merged.push(candidate);
    if (merged.length >= normalizedLimit) {
      break;
    }
  }
  return merged;
}

export function buildComposerSubmissionText(text = '', attachments = []) {
  const attachmentPaths = attachments
    .map((attachment) => `${attachment?.path || ''}`.trim())
    .filter(Boolean);
  const normalizedText = `${text || ''}`.trim();
  if (!attachmentPaths.length) {
    return normalizedText;
  }
  if (!normalizedText) {
    return attachmentPaths.join('\n');
  }
  return `${attachmentPaths.join('\n')}\n${normalizedText}`;
}
