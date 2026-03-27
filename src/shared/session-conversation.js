import {
  looksLikeCodexSession,
  normalizeCodexLines,
  parseCodexAssistantLine,
  parseCodexUserLine,
  stripCodexAttachmentLines,
  splitCodexStatusLine,
} from './codex-ui.js';
import { inferShellKind } from './editing-context.js';
import { stripAnsi } from './session-preview.js';

const RAW_TERMINAL_COMMANDS = new Set(['vim', 'nvim', 'less', 'more', 'man', 'htop', 'top', 'fzf']);
const SHELL_COMMANDS = new Set(['bash', 'zsh', 'sh', 'fish', 'powershell.exe', 'powershell', 'pwsh', 'tmux']);

export function extractSessionConversation({
  kind,
  command,
  snapshot,
  pane,
  currentInput = '',
  promptAtStart = false,
  includeMetadata = false,
} = {}) {
  const withMetadata = Boolean(includeMetadata);
  const shellKind = inferShellKind({ kind, command });
  const currentCommand = `${pane?.currentCommand || ''}`.toLowerCase();
  const rawMode = Boolean(pane?.inMode) || (RAW_TERMINAL_COMMANDS.has(currentCommand) && !SHELL_COMMANDS.has(currentCommand));

  if (!snapshot || rawMode || shellKind === 'unknown') {
    return {
      mode: 'raw_terminal',
      items: [],
    };
  }

  const codexLines = normalizeCodexLines(snapshot);
  if (looksLikeCodexSession(codexLines)) {
    return extractCodexConversation(codexLines, {
      currentInput,
      promptAtStart,
      includeMetadata: withMetadata,
    });
  }

  const parser = shellKind === 'powershell' ? parsePowerShellPrompt : parsePosixPrompt;
  const lines = normalizeLines(snapshot, shellKind);
  const turns = [];
  let currentTurn = null;

  for (const line of lines) {
    const parsed = parser(line);
    if (parsed) {
      if (currentTurn && shouldKeepTurn(currentTurn, currentInput)) {
        turns.push(finalizeTurn(currentTurn));
      }
      currentTurn = {
        command: parsed.input,
        outputLines: [],
      };
      continue;
    }

    if (currentTurn) {
      currentTurn.outputLines.push(line);
    }
  }

  if (currentTurn && shouldKeepTurn(currentTurn, currentInput)) {
    turns.push(finalizeTurn(currentTurn));
  }

  const items = turns.flatMap((turn) => {
    const result = [];
    if (turn.command) {
      result.push({
        role: 'user',
        text: turn.command,
      });
    }
    if (turn.output) {
      result.push({
        role: 'assistant',
        text: turn.output,
      });
    }
    return result;
  });

  const conversation = {
    mode: 'chat',
    shellKind,
    items: attachStableItemMetadata(items),
  };
  return withMetadata ? conversation : stripConversationMetadata(conversation);
}

function extractCodexConversation(lines, options = {}) {
  const currentInput = stripCodexAttachmentLines(`${options.currentInput || ''}`).trim();
  const promptAtStart = Boolean(options.promptAtStart);
  const includeMetadata = Boolean(options.includeMetadata);
  const { lines: bodyLines, statusLine } = splitCodexStatusLine(lines);
  const items = [];
  let assistantBuffer = [];
  let computerBuffer = [];
  let currentUserIndex = -1;
  let currentInputMode = '';

  const flushAssistant = () => {
    const text = cleanupText(assistantBuffer.join('\n'));
    assistantBuffer = [];
    if (!text) {
      return;
    }
    items.push({
      role: 'assistant',
      kind: 'reply',
      text,
    });
  };

  const flushComputer = () => {
    const text = cleanupText(computerBuffer.join('\n'));
    computerBuffer = [];
    if (!text) {
      return;
    }
    const lineCount = text.split(/\r?\n/).length;
    items.push({
      role: 'assistant',
      kind: 'computer',
      text,
      summary: summarizeComputerAction(text),
      collapsed: lineCount > 4 || text.length > 220,
    });
  };

  for (const line of bodyLines) {
    const shellPrompt = parsePosixPrompt(line);
    if (shellPrompt) {
      flushAssistant();
      const shellLine = formatShellPrompt(shellPrompt.prompt, shellPrompt.input);
      if (!`${shellPrompt.input || ''}`.trim()) {
        if (computerBuffer.length) {
          computerBuffer.push(shellLine);
        }
        currentUserIndex = -1;
        currentInputMode = '';
        continue;
      }
      flushComputer();
      computerBuffer.push(shellLine);
      currentUserIndex = -1;
      currentInputMode = '';
      continue;
    }

    const userPrompt = parseCodexUserLine(line);
    if (userPrompt) {
      flushAssistant();
      flushComputer();
      items.push({
        role: 'user',
        text: cleanupText(userPrompt.currentInput),
      });
      currentUserIndex = items.length - 1;
      currentInputMode = 'codex';
      continue;
    }

    const assistantLine = parseCodexAssistantLine(line);
    if (assistantLine !== null) {
      flushComputer();
      flushAssistant();
      assistantBuffer.push(assistantLine);
      currentUserIndex = -1;
      currentInputMode = '';
      continue;
    }

    if (computerBuffer.length) {
      computerBuffer.push(line);
      continue;
    }

    if (assistantBuffer.length) {
      assistantBuffer.push(line);
      continue;
    }

    if (currentInputMode === 'codex' && currentUserIndex >= 0 && items[currentUserIndex]?.role === 'user' && `${line || ''}`.trim()) {
      items[currentUserIndex].text = cleanupText(`${items[currentUserIndex].text}\n${line}`);
      continue;
    }

    currentUserIndex = -1;
    currentInputMode = '';
    assistantBuffer.push(line);
  }

  flushAssistant();
  flushComputer();

  const normalizedCurrentInput = normalizeComparableText(currentInput);
  if (normalizedCurrentInput) {
    const lastItem = items.at(-1);
    if (lastItem?.role === 'user' && normalizeComparableText(lastItem.text) === normalizedCurrentInput) {
      items.pop();
    }
  } else if (promptAtStart) {
    const lastItem = items.at(-1);
    if (lastItem?.role === 'user') {
      items.pop();
    }
  }

  return {
    mode: 'chat',
    shellKind: 'posix',
    appKind: 'codex',
    statusLine,
    items: finalizeConversationItems(
      items
        .map((item) => ({
          ...item,
          text: cleanupText(item.role === 'user' ? stripCodexAttachmentLines(item.text) : item.text),
        }))
        .filter((item) => item.text),
      {
        includeMetadata,
      },
    ),
  };
}

function finalizeConversationItems(items, options = {}) {
  const normalizedItems = attachStableItemMetadata(coalesceCodexAssistantItems(items, options));
  return options.includeMetadata ? normalizedItems : normalizedItems.map(stripConversationItemMetadata);
}

function formatShellPrompt(prompt, input) {
  const normalizedPrompt = `${prompt || ''}`;
  const normalizedInput = `${input || ''}`.trimEnd();
  if (!normalizedPrompt && !normalizedInput) {
    return '';
  }
  if (!normalizedInput) {
    return `${normalizedPrompt}`.trimEnd();
  }
  return `${normalizedPrompt}${normalizedInput}`.trimEnd();
}

function summarizeComputerAction(text) {
  const lines = `${text || ''}`.split(/\r?\n/).map((line) => `${line || ''}`.trim()).filter(Boolean);
  const actionLabel = extractComputerActionLabel(text);
  if (actionLabel) {
    return `电脑执行：${actionLabel.slice(0, 72)}`;
  }
  return `电脑输出（${lines.length || 1} 行）`;
}

function coalesceCodexAssistantItems(items, options = {}) {
  const result = [];
  let assistantGroup = [];

  const flushAssistantGroup = () => {
    if (!assistantGroup.length) {
      return;
    }
    result.push(buildCodexAssistantGroup(assistantGroup, options));
    assistantGroup = [];
  };

  for (const item of items) {
    if (item?.role === 'assistant') {
      assistantGroup.push(item);
      continue;
    }
    flushAssistantGroup();
    result.push(options.includeMetadata ? item : stripCodexItemKind(item));
  }

  flushAssistantGroup();
  return result;
}

function buildCodexAssistantGroup(group, options = {}) {
  const normalizedGroup = group.map((item) => (options.includeMetadata ? item : stripCodexItemKind(item)));
  if (normalizedGroup.length === 1) {
    return normalizedGroup[0];
  }

  const text = normalizedGroup.map((item) => item.text).filter(Boolean).join('\n\n');
  const collapsed =
    normalizedGroup.some((item) => item.collapsed)
    || normalizedGroup.length > 1
    || countNonEmptyLines(text) > 6
    || text.length > 280;

  return {
    role: 'assistant',
    text,
    summary: summarizeAssistantGroup(group, text),
    collapsed,
    kind: group.some((item) => `${item?.kind || ''}` === 'reply')
      ? 'reply'
      : uniqueValues(group.map((item) => item?.kind || '')).at(-1) || '',
  };
}

function summarizeAssistantGroup(group, text) {
  const latestReplySummary = summarizeLatestReply(group);
  if (latestReplySummary) {
    return latestReplySummary;
  }
  return '';
}

function summarizeLatestReply(group) {
  const latestReply = [...(group || [])]
    .reverse()
    .find((item) => item?.kind === 'reply' && cleanupText(item.text));
  if (!latestReply) {
    return '';
  }

  const latestSection = extractLatestSummarySection(latestReply.text);
  const normalizedSection = cleanupText(latestSection);
  if (!normalizedSection) {
    return '';
  }

  return `• ${normalizedSection}`;
}

function extractLatestSummarySection(text) {
  const sections = [];
  let currentLines = [];
  let hasDivider = false;
  for (const line of cleanupText(text).split(/\r?\n/)) {
    if (isSummaryDividerLine(line)) {
      hasDivider = true;
      const section = cleanupText(currentLines.join('\n'));
      if (section) {
        sections.push(section);
      }
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }

  const tailSection = cleanupText(currentLines.join('\n'));
  if (tailSection) {
    sections.push(tailSection);
  }

  if (hasDivider) {
    return sections.at(-1) || cleanupText(text);
  }

  return '';
}

function isSummaryDividerLine(line) {
  return /^\s*(?:[-=*_]{3,}|[─━]{3,})\s*$/u.test(`${line || ''}`);
}

function normalizeComputerSummary(summary) {
  return `${summary || ''}`.replace(/^电脑(?:执行|过程)：/u, '').trim();
}

function normalizeSummaryCommand(command) {
  return `${command || ''}`
    .replace(/^['"`]+|['"`]+$/gu, '')
    .replace(/[,'"`;:.]+$/gu, '')
    .trim();
}

function extractComputerActionLabel(text) {
  const lines = `${text || ''}`.split(/\r?\n/).map((line) => stripSummaryPrefix(line).trim()).filter(Boolean);
  for (const line of lines) {
    const posixPrompt = parsePosixPrompt(line);
    if (posixPrompt && looksLikeSummaryShellPrompt(posixPrompt.prompt)) {
      const shellInput = normalizeSummaryCommand(posixPrompt.input || '');
      if (shellInput) {
        return shellInput;
      }
    }

    const powerShellPrompt = parsePowerShellPrompt(line);
    if (powerShellPrompt) {
      const shellInput = normalizeSummaryCommand(powerShellPrompt.input || '');
      if (shellInput) {
        return shellInput;
      }
    }

    const activity = parseComputerActivityLabel(line);
    if (activity) {
      return activity;
    }
  }
  return '';
}

function parseComputerActivityLabel(line) {
  const normalized = `${line || ''}`.trim();
  if (!normalized || normalized.startsWith('Working (')) {
    return '';
  }

  const commandMatch = normalized.match(/^(?:Ran|Executed)\s+(?<command>.+)$/iu);
  if (commandMatch?.groups?.command) {
    return normalizeSummaryCommand(commandMatch.groups.command);
  }

  const verbMatch = normalized.match(/^(?<verb>Read|Search(?:ed)?|Edited|Updated|Created|Deleted|Added|Applied)\s+(?<target>.+)$/iu);
  if (verbMatch?.groups) {
    const target = normalizeSummaryCommand(verbMatch.groups.target);
    if (!target) {
      return '';
    }
    return `${capitalizeAscii(verbMatch.groups.verb)} ${target}`;
  }

  return '';
}

function stripSummaryPrefix(line) {
  return `${line || ''}`.replace(/^[\s│└├─>•]+/u, '');
}

function looksLikeSummaryShellPrompt(prompt) {
  const normalized = `${prompt || ''}`.trim();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes('@')
    || normalized.includes('~/')
    || normalized.includes('/')
    || normalized.includes('\\')
  );
}

function capitalizeAscii(value) {
  const text = `${value || ''}`;
  if (!text) {
    return '';
  }
  return text[0].toUpperCase() + text.slice(1);
}

function stripCodexItemKind(item) {
  if (!item || typeof item !== 'object' || !('kind' in item)) {
    return item;
  }
  const { kind: _kind, ...rest } = item;
  return rest;
}

function uniqueValues(values) {
  return [...new Set((values || []).map((value) => `${value || ''}`.trim()).filter(Boolean))];
}

function parsePosixPrompt(line) {
  const match =
    line.match(/^(?<prompt>(?:\[[^\]]+\]\s*)?(?:\([^)]*\)\s*)?[^@\s]+@[^:\n]+:[^\n]*?[#$] ?)(?<input>.*)$/) ||
    line.match(/^(?<prompt>(?:\[[^\]]+\]\s*)?(?:\([^)]*\)\s*)?[^#$%\n]{1,120}[#$%] ?)(?<input>.*)$/);

  if (!match?.groups) {
    return null;
  }

  return {
    prompt: match.groups.prompt,
    input: `${match.groups.input || ''}`.trim(),
  };
}

function parsePowerShellPrompt(line) {
  const match = line.match(/^(?<prompt>PS [^\n>]*> ?)(?<input>.*)$/);
  if (!match?.groups) {
    return null;
  }

  return {
    prompt: match.groups.prompt,
    input: `${match.groups.input || ''}`.trim(),
  };
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

function shouldKeepTurn(turn, currentInput) {
  const command = `${turn.command || ''}`.trim();
  const normalizedCurrentInput = `${currentInput || ''}`.trim();
  const output = cleanupText(turn.outputLines.join('\n'));

  if (!command && !output) {
    return false;
  }

  if (command && !output && normalizedCurrentInput && command === normalizedCurrentInput) {
    return false;
  }

  return true;
}

function finalizeTurn(turn) {
  return {
    command: `${turn.command || ''}`.trim(),
    output: cleanupText(turn.outputLines.join('\n')),
  };
}

function cleanupText(value) {
  return `${value || ''}`
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/^\n+/g, '')
    .replace(/\n+$/g, '')
    .trim();
}

function normalizeComparableText(value) {
  return cleanupText(value).replace(/\s+/g, ' ').trim();
}

function countNonEmptyLines(text) {
  return `${text || ''}`.split(/\r?\n/).filter((line) => `${line || ''}`.trim()).length;
}

function attachStableItemMetadata(items) {
  const duplicateCounts = new Map();
  const normalized = (items || []).map((item) => ({
    ...item,
    text: cleanupText(item?.text),
    summary: cleanupText(item?.summary),
  }));

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const item = normalized[index];
    const baseKey = JSON.stringify([
      `${item?.role || ''}`,
      `${item?.kind || ''}`,
      `${item?.text || ''}`,
      `${item?.summary || ''}`,
      Boolean(item?.collapsed),
    ]);
    const occurrence = (duplicateCounts.get(baseKey) || 0) + 1;
    duplicateCounts.set(baseKey, occurrence);
    normalized[index] = {
      ...item,
      itemId: `itm_${hashText(`${baseKey}:${occurrence}`)}`,
    };
  }

  return normalized;
}

function stripConversationMetadata(conversation) {
  return {
    ...conversation,
    items: (conversation?.items || []).map(stripConversationItemMetadata),
  };
}

function stripConversationItemMetadata(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const { kind: _kind, itemId: _itemId, summary, ...rest } = item;
  if (rest.collapsed && summary !== undefined) {
    return {
      ...rest,
      summary: `${summary || ''}`,
    };
  }
  if (`${summary || ''}`.trim()) {
    return {
      ...rest,
      summary,
    };
  }
  return rest;
}

function hashText(value) {
  let hash = 2166136261;
  const text = `${value || ''}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildConversationSummary(conversation = {}) {
  if (`${conversation?.mode || ''}` !== 'chat') {
    return {
      ...conversation,
      summaryOnly: false,
    };
  }

  const items = [];
  for (const item of conversation.items || []) {
    if (`${item?.role || ''}` === 'user') {
      items.push({
        id: item.itemId,
        role: 'user',
        text: item.text,
        collapsed: false,
        expandable: false,
      });
      continue;
    }

    if (`${item?.kind || ''}` === 'computer') {
      continue;
    }

    const resolvedSummary = resolveConversationItemSummary(item);
    if (!item?.collapsed && !resolvedSummary) {
      items.push({
        id: item.itemId,
        role: 'assistant',
        text: item.text,
        collapsed: false,
        expandable: false,
      });
      continue;
    }

    if (`${resolvedSummary || ''}`.trim() || item?.collapsed) {
      items.push({
        id: item.itemId,
        role: 'assistant',
        summary: resolvedSummary,
        collapsed: true,
        expandable: true,
      });
    }
  }

  return {
    mode: conversation.mode,
    shellKind: conversation.shellKind,
    appKind: conversation.appKind,
    statusLine: conversation.statusLine || '',
    summaryOnly: true,
    items,
  };
}

export function findConversationItemDetail(conversation = {}, itemId = '') {
  const match = (conversation.items || []).find((item) => `${item?.itemId || ''}` === `${itemId || ''}`);
  if (!match) {
    return null;
  }
  const resolvedSummary = resolveConversationItemSummary(match);

  return {
    id: match.itemId,
    role: match.role,
    text: match.text,
    summary: resolvedSummary,
    collapsed: Boolean(match.collapsed || resolvedSummary),
    expandable: Boolean(match.collapsed || resolvedSummary),
  };
}

function resolveConversationItemSummary(item) {
  if (`${item?.summary || ''}`.trim()) {
    return item.summary;
  }
  if (`${item?.role || ''}` !== 'assistant' || `${item?.kind || ''}` === 'computer') {
    return '';
  }
  return summarizeLatestReply([item]);
}
