const ANSI_PATTERN =
  // Covers CSI, OSC, and a few single-char escape sequences well enough for session previews.
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

export function stripAnsi(value) {
  return `${value || ''}`.replaceAll(ANSI_PATTERN, '');
}

export function previewFromSnapshot(snapshot) {
  const lines = stripAnsi(snapshot)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const filteredLines = lines.filter((line) => !isIgnorableCodexPreviewLine(line));

  if (filteredLines.length > 0) {
    return `${filteredLines.at(-1)}`.slice(0, 160);
  }

  if (lines.length === 0) {
    return 'No output yet.';
  }

  return `${lines.at(-1)}`.slice(0, 160);
}

export function previewFromConversation(conversation) {
  const items = Array.isArray(conversation?.items) ? conversation.items : [];
  const summaryOnly = Boolean(conversation?.summaryOnly);
  if (summaryOnly) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (`${item?.role || ''}` === 'user') {
        const normalizedUser = normalizePreviewText(item?.text || '');
        if (normalizedUser) {
          return normalizedUser.slice(0, 160);
        }
        continue;
      }
      const normalizedAssistant = previewFromSummaryOnlyItem(item);
      if (normalizedAssistant) {
        return normalizedAssistant.slice(0, 160);
      }
    }
    return '';
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (`${item?.role || ''}` === 'user') {
      continue;
    }
    const normalized = normalizePreviewText(item?.summary || item?.text || '');
    if (normalized) {
      return normalized.slice(0, 160);
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (`${item?.role || ''}` !== 'user') {
      continue;
    }
    const normalized = normalizePreviewText(item.text);
    if (normalized) {
      return normalized.slice(0, 160);
    }
  }

  return '';
}

function previewFromSummaryOnlyItem(item) {
  const summary = normalizePreviewText(item?.summary || '');
  if (summary) {
    return summary;
  }
  if (item?.expandable) {
    return '';
  }
  return normalizePreviewText(item?.text || '');
}

function isIgnorableCodexPreviewLine(line) {
  const normalized = `${line || ''}`.trim();
  if (!normalized) {
    return false;
  }
  return (
    /^[╭╰][─]+[╮╯]$/u.test(normalized)
    || /^│.*OpenAI Codex.*│$/u.test(normalized)
    || /^│.*(?:model:|directory:).*(?:│)?$/u.test(normalized)
    || /^Tip:/iu.test(normalized)
    || /^⚠\s*Heads up,/u.test(normalized)
    || (
      normalized.includes('·')
      && (
        /\b(?:left|used|weekly|daily)\b/i.test(normalized)
        || normalized.includes('~/')
        || normalized.includes('/home/')
        || normalized.includes('/code/')
      )
    )
  );
}

function normalizePreviewText(value) {
  return stripAnsi(`${value || ''}`)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find(Boolean) || '';
}
