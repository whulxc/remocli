const LIST_ITEM_PATTERN = /^(?<indent>\s*)(?<marker>(?:[-*•]|(?:\d+|[A-Za-z])\.) )(?<content>.+)$/u;
const TREE_ITEM_PATTERN = /^(?<indent>\s*)(?<marker>[└├│])\s*(?<content>.+)$/u;
const CJK_CHAR_PATTERN = /\p{Script=Han}/u;

export function formatConversationSummaryDisplayText(value = '') {
  const normalized = `${value || ''}`
    .replace(/\r/g, '')
    .trim();
  if (!normalized) {
    return '';
  }

  const blocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => formatSummaryBlock(block))
    .filter(Boolean);
  return blocks.join('\n\n');
}

export function formatConversationDetailDisplayText(value = '') {
  return formatConversationSummaryDisplayText(value);
}

function formatSummaryBlock(block) {
  const lines = `${block || ''}`
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => `${line || ''}`.trim());
  if (!lines.length) {
    return '';
  }

  const parts = [];
  let paragraph = [];
  let listItem = '';

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    parts.push(paragraph.reduce(joinWrappedSummarySegments));
    paragraph = [];
  };

  const flushListItem = () => {
    if (!listItem) {
      return;
    }
    parts.push(listItem);
    listItem = '';
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const listMatch = parseSummaryListItem(trimmed);
    if (listMatch) {
      flushParagraph();
      flushListItem();
      listItem = `${listMatch.marker}${listMatch.content}`;
      continue;
    }

    if (listItem) {
      listItem = joinWrappedSummarySegments(listItem, trimmed);
      continue;
    }

    if (isStandaloneSummaryLine(trimmed)) {
      flushParagraph();
      flushListItem();
      parts.push(trimmed);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushListItem();
  return parts.join('\n');
}

function parseSummaryListItem(line) {
  const normalized = `${line || ''}`;
  const listMatch = normalized.match(LIST_ITEM_PATTERN);
  if (listMatch?.groups) {
    return {
      marker: `${listMatch.groups.marker || ''}`,
      content: `${listMatch.groups.content || ''}`.trim(),
    };
  }

  const treeMatch = normalized.match(TREE_ITEM_PATTERN);
  if (treeMatch?.groups) {
    return {
      marker: `${treeMatch.groups.marker || ''} `,
      content: `${treeMatch.groups.content || ''}`.trim(),
    };
  }
  return null;
}

function isStandaloneSummaryLine(line) {
  const normalized = `${line || ''}`.trim();
  if (!normalized) {
    return false;
  }
  if (/[:：]$/u.test(normalized)) {
    return true;
  }
  return (
    normalized === 'Explored'
    || normalized === 'Worked for'
    || normalized === 'Proposed Plan'
    || normalized.startsWith('Questions ')
    || normalized.startsWith('Permissions updated')
    || normalized.startsWith('Model changed')
  );
}

function joinWrappedSummarySegments(left = '', right = '') {
  const normalizedLeft = `${left || ''}`.trimEnd();
  const normalizedRight = `${right || ''}`.trimStart();
  if (!normalizedLeft) {
    return normalizedRight;
  }
  if (!normalizedRight) {
    return normalizedLeft;
  }

  const lastChar = normalizedLeft.at(-1) || '';
  const firstChar = normalizedRight[0] || '';
  if (shouldJoinWithoutSpace(lastChar, firstChar)) {
    return `${normalizedLeft}${normalizedRight}`;
  }
  return `${normalizedLeft} ${normalizedRight}`;
}

function shouldJoinWithoutSpace(lastChar, firstChar) {
  if (!lastChar || !firstChar) {
    return false;
  }
  if (CJK_CHAR_PATTERN.test(lastChar) || CJK_CHAR_PATTERN.test(firstChar)) {
    return true;
  }
  if (/[（([【“"'<\/-]$/u.test(lastChar)) {
    return true;
  }
  if (/^[）)\]】”"',.;:!?%/]/u.test(firstChar)) {
    return true;
  }
  return false;
}
