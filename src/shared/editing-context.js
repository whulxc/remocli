import { normalizeSessionKind } from './session-kind.js';
import {
  hasCodexBackgroundTaskIndicator,
  looksLikeCodexSession,
  normalizeCodexLines,
  parseCodexUserBlock,
  stripCodexAttachmentLines,
  splitCodexStatusLine,
} from './codex-ui.js';
import { stripAnsi } from './session-preview.js';

const RAW_TERMINAL_COMMANDS = new Set(['vim', 'nvim', 'less', 'more', 'man', 'htop', 'top', 'fzf']);
const SHELL_COMMANDS = new Set(['bash', 'zsh', 'sh', 'fish', 'powershell.exe', 'powershell', 'pwsh', 'tmux']);

export function inferShellKind({ kind, command } = {}) {
  const rawKind = `${kind || ''}`.trim().toLowerCase();
  const normalizedKind = rawKind === 'wsl' || rawKind === 'powershell' ? normalizeSessionKind(rawKind) : '';
  const commandText = `${command || ''}`.toLowerCase();

  if (rawKind === 'powershell' || normalizedKind === 'powershell' || /\b(?:powershell|pwsh)(?:\.exe)?\b/.test(commandText)) {
    return 'powershell';
  }

  if (rawKind === 'wsl' || normalizedKind === 'wsl' || /\b(?:bash|zsh|fish|sh|codex)\b/.test(commandText)) {
    return 'posix';
  }

  return 'unknown';
}

export function extractEditingContext({ kind, command, visibleSnapshot, pane } = {}) {
  const shellKind = inferShellKind({ kind, command });
  const base = {
    mode: 'raw_terminal',
    shellKind,
    supportsLocalEditor: false,
    promptText: '',
    currentInput: '',
    cursorColumn: 0,
    cursorRow: null,
    hasBackgroundTask: false,
    currentCommand: `${pane?.currentCommand || ''}`,
    paneInMode: Boolean(pane?.inMode),
  };

  if (!visibleSnapshot) {
    return base;
  }

  const currentCommand = `${pane?.currentCommand || ''}`.toLowerCase();
  if (base.paneInMode || (RAW_TERMINAL_COMMANDS.has(currentCommand) && !SHELL_COMMANDS.has(currentCommand))) {
    return base;
  }

  const codexLines = normalizeCodexLines(visibleSnapshot);
  const fallbackRow = Math.max(codexLines.length - 1, 0);
  const cursorRow = clamp(Number(pane?.cursorY ?? fallbackRow), 0, fallbackRow);
  if (looksLikeCodexSession(codexLines)) {
    const hasBackgroundTask = hasCodexBackgroundTaskIndicator(codexLines);
    const parsedCodexPrompt = parseCodexPrompt(codexLines, cursorRow, Number.isFinite(pane?.cursorX) ? Number(pane.cursorX) : null);
    if (parsedCodexPrompt) {
      return {
        ...base,
        mode: 'prompt',
        supportsLocalEditor: true,
        promptText: parsedCodexPrompt.promptText,
        currentInput: parsedCodexPrompt.currentInput,
        cursorColumn: parsedCodexPrompt.cursorColumn,
        cursorRow: parsedCodexPrompt.cursorRow,
        hasBackgroundTask,
      };
    }
  }

  const lines = normalizeLines(visibleSnapshot, shellKind);
  const normalizedCursorRow = clamp(Number(pane?.cursorY ?? lines.length - 1), 0, Math.max(lines.length - 1, 0));
  const parser = shellKind === 'powershell' ? parsePowerShellPrompt : parsePosixPrompt;
  const parsed = parser(lines, normalizedCursorRow, Number.isFinite(pane?.cursorX) ? Number(pane.cursorX) : null);

  if (!parsed) {
    return base;
  }

  return {
    ...base,
    mode: 'prompt',
    supportsLocalEditor: true,
    promptText: parsed.promptText,
    currentInput: parsed.currentInput,
    cursorColumn: parsed.cursorColumn,
    cursorRow: parsed.cursorRow,
  };
}

export function derivePromptInputState(editingContext = {}) {
  const mode = `${editingContext?.mode || ''}`.trim().toLowerCase();
  const currentInput = `${editingContext?.currentInput || ''}`;
  const promptAtStart = mode === 'prompt' && Number(editingContext?.cursorColumn || 0) === 0;
  return {
    promptAtStart,
    readyForInput: promptAtStart && !currentInput.trim(),
    hasPendingUserInput: mode === 'prompt' && Boolean(currentInput.trim()),
  };
}

export function editorClearSequence(shellKind) {
  if (shellKind === 'posix' || shellKind === 'powershell') {
    return ['C-a', 'C-k'];
  }

  return [];
}

function parsePosixPrompt(lines, cursorRow, cursorX) {
  const candidates = buildCandidateRows(lines, cursorRow);
  for (const row of candidates) {
    const line = lines[row];
    const match =
      line.match(/^(?<prompt>(?:\[[^\]]+\]\s*)?(?:\([^)]*\)\s*)?[^@\s]+@[^:\n]+:[^\n]*?[#$] ?)(?<input>.*)$/) ||
      line.match(/^(?<prompt>(?:\[[^\]]+\]\s*)?(?:\([^)]*\)\s*)?[^#$%\n]{1,120}[#$%] ?)(?<input>.*)$/);
    if (!match?.groups) {
      continue;
    }

    const promptText = match.groups.prompt;
    const currentInput = match.groups.input || '';
    return {
      promptText,
      currentInput,
      cursorRow: row,
      cursorColumn: resolveCursorColumn(promptText, currentInput, cursorX, row === cursorRow),
    };
  }

  return null;
}

function parsePowerShellPrompt(lines, cursorRow, cursorX) {
  const candidates = buildCandidateRows(lines, cursorRow);
  for (const row of candidates) {
    const line = lines[row];
    const match = line.match(/^(?<prompt>PS [^\n>]*> ?)(?<input>.*)$/);
    if (!match?.groups) {
      continue;
    }

    const promptText = match.groups.prompt;
    const currentInput = match.groups.input || '';
    return {
      promptText,
      currentInput,
      cursorRow: row,
      cursorColumn: resolveCursorColumn(promptText, currentInput, cursorX, row === cursorRow),
    };
  }

  return null;
}

function parseCodexPrompt(lines, cursorRow, cursorX) {
  const { lines: bodyLines } = splitCodexStatusLine(lines);
  const candidates = buildCandidateRows(bodyLines, cursorRow, 8);
  for (const row of candidates) {
    const parsed = parseCodexUserBlock(bodyLines, row);
    if (!parsed) {
      continue;
    }

    const currentInput = normalizeCodexCurrentInput(parsed, cursorRow, cursorX);
    return {
      promptText: parsed.promptText,
      currentInput,
      cursorRow: parsed.cursorRow,
      cursorColumn: resolveCodexCursorColumn(parsed, currentInput, cursorRow, cursorX),
    };
  }

  return null;
}

function buildCandidateRows(lines, cursorRow, limit = 4) {
  const rows = [];
  for (let row = clamp(cursorRow, 0, Math.max(lines.length - 1, 0)); row >= 0; row -= 1) {
    if (rows.length >= limit) {
      break;
    }
    rows.push(row);
  }
  return rows;
}

function normalizeLines(snapshot, shellKind = 'unknown') {
  const lines = stripAnsi(`${snapshot || ''}`)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\u0000/g, ''));
  return shellKind === 'powershell' ? mergeWrappedPowerShellPromptLines(lines) : lines;
}

function mergeWrappedPowerShellPromptLines(lines) {
  const merged = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    if (shouldMergeWrappedPowerShellPrompt(previous, line)) {
      merged[merged.length - 1] = `${previous}${line.trimStart()}`;
      continue;
    }
    merged.push(line);
  }
  return merged;
}

function shouldMergeWrappedPowerShellPrompt(previousLine, nextLine) {
  const previous = `${previousLine || ''}`.trimEnd();
  if (!previous.startsWith('PS ') || previous.includes('>')) {
    return false;
  }
  return Boolean(`${nextLine || ''}`.trim());
}

function resolveCursorColumn(promptText, currentInput, cursorX, cursorOnSameRow) {
  if (!cursorOnSameRow || cursorX === null) {
    return currentInput.length;
  }

  return clamp(cursorX - promptText.length, 0, currentInput.length);
}

function normalizeCodexCurrentInput(parsedPrompt, cursorRow, cursorX) {
  const currentInput = stripCodexAttachmentLines(`${parsedPrompt?.currentInput || ''}`).trim();
  if (
    cursorX !== null
    && cursorRow === Number(parsedPrompt?.cursorRow)
    && cursorX <= `${parsedPrompt?.promptText || ''}`.length
  ) {
    return '';
  }
  return currentInput;
}

function resolveCodexCursorColumn(parsedPrompt, currentInput, cursorRow, cursorX) {
  if (cursorX === null) {
    return currentInput.length;
  }

  if (cursorRow === Number(parsedPrompt?.cursorRow)) {
    if (cursorX <= `${parsedPrompt?.promptText || ''}`.length) {
      return 0;
    }
    const firstInputLine = `${currentInput || ''}`.split('\n')[0] || '';
    return clamp(cursorX - `${parsedPrompt?.promptText || ''}`.length, 0, firstInputLine.length);
  }

  if (cursorRow > Number(parsedPrompt?.cursorRow) && cursorRow <= Number(parsedPrompt?.endRow)) {
    return currentInput.length;
  }

  return currentInput.length;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
