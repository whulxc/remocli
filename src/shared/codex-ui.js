import { stripAnsi } from './session-preview.js';

const IMAGE_ATTACHMENT_PATH_PATTERN =
  /^(?:[A-Za-z]:[\\/]|\/|~\/|\\\\|file:\/\/).+\.(?:png|jpe?g|gif|webp|svg|bmp|heic|heif)(?:[?#].*)?$/iu;

export function normalizeCodexLines(snapshot) {
  return stripAnsi(`${snapshot || ''}`)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\u0000/g, ''));
}

export function parseCodexUserLine(line) {
  const match = `${line || ''}`.match(/^(?<indent>\s*)(?<prompt>[›>])(?<space>\s?)(?<input>.*)$/);
  if (!match?.groups) {
    return null;
  }

  const indent = `${match.groups.indent || ''}`;
  const prompt = `${match.groups.prompt || ''}`;
  const space = `${match.groups.space || ''}`;
  if (prompt === '>') {
    // Command output blocks under "Ran ... / └" often render as indented "> ..."
    // lines. Keep supporting an ASCII prompt fallback, but only at the top level.
    if (indent.length > 1 || space !== ' ') {
      return null;
    }
  }

  return {
    promptText: `${prompt}${space}` || '› ',
    currentInput: `${match.groups.input || ''}`.trimEnd(),
  };
}

export function parseCodexUserBlock(lines, startRow) {
  const source = Array.isArray(lines) ? lines : [];
  const row = Number.parseInt(`${startRow ?? ''}`, 10);
  if (!Number.isFinite(row) || row < 0 || row >= source.length) {
    return null;
  }

  const firstLine = parseCodexUserLine(source[row]);
  if (!firstLine) {
    return null;
  }

  const inputLines = [firstLine.currentInput];
  let endRow = row;
  for (let index = row + 1; index < source.length; index += 1) {
    const line = `${source[index] || ''}`;
    if (!line.trim()) {
      break;
    }
    if (parseCodexUserLine(line) || parseCodexAssistantLine(line) !== null || isCodexStatusLine(line)) {
      break;
    }
    inputLines.push(line.trimEnd());
    endRow = index;
  }

  return {
    promptText: firstLine.promptText,
    currentInput: inputLines.join('\n').trimEnd(),
    cursorRow: row,
    endRow,
  };
}

export function parseCodexAssistantLine(line) {
  const match = `${line || ''}`.match(/^\s*•\s?(?<text>.*)$/);
  if (!match?.groups) {
    return null;
  }

  return `${match.groups.text || ''}`.trimEnd();
}

export function stripCodexAttachmentLines(value) {
  return `${value || ''}`
    .split('\n')
    .filter((line) => !isCodexAttachmentLine(line))
    .join('\n');
}

export function isCodexStatusLine(line) {
  const normalized = `${line || ''}`.trim();
  if (!normalized || !normalized.includes('·')) {
    return false;
  }

  return (
    /\b(?:left|used|weekly|daily)\b/i.test(normalized) ||
    normalized.includes('~/') ||
    normalized.includes('/home/') ||
    normalized.includes('/code/')
  );
}

export function splitCodexStatusLine(lines) {
  const nextLines = [...(lines || [])];
  while (nextLines.length && !`${nextLines.at(-1) || ''}`.trim()) {
    nextLines.pop();
  }

  const lastLine = `${nextLines.at(-1) || ''}`.trim();
  if (!isCodexStatusLine(lastLine)) {
    return {
      lines: nextLines,
      statusLine: '',
    };
  }

  nextLines.pop();
  while (nextLines.length && !`${nextLines.at(-1) || ''}`.trim()) {
    nextLines.pop();
  }

  return {
    lines: nextLines,
    statusLine: lastLine,
  };
}

export function hasCodexBackgroundTaskIndicator(snapshotOrLines) {
  const lines = Array.isArray(snapshotOrLines) ? snapshotOrLines : normalizeCodexLines(snapshotOrLines);
  return lines.some((line) => {
    const normalized = `${line || ''}`.trim();
    if (!normalized) {
      return false;
    }
    return (
      /\b\d+\s+background terminal(?:s)? running\b/i.test(normalized) ||
      /\bbackground terminal(?:s)? running\b/i.test(normalized) ||
      normalized.includes('/ps to view') ||
      normalized.includes('/stop to close')
    );
  });
}

export function looksLikeCodexSession(snapshotOrLines) {
  const lines = Array.isArray(snapshotOrLines) ? snapshotOrLines : normalizeCodexLines(snapshotOrLines);
  const hasBanner = lines.some((line) => `${line || ''}`.includes('OpenAI Codex'));
  const hasPrompt = lines.some((line) => Boolean(parseCodexUserLine(line)));
  const hasAssistant = lines.some((line) => Boolean(parseCodexAssistantLine(line)));
  const hasStatus = lines.some((line) => isCodexStatusLine(line));
  return hasBanner || hasStatus || (hasPrompt && hasAssistant);
}

function isCodexAttachmentLine(line) {
  const normalized = `${line || ''}`.trim().replace(/^['"`]+|['"`]+$/gu, '');
  if (!normalized) {
    return false;
  }
  return IMAGE_ATTACHMENT_PATH_PATTERN.test(normalized);
}
