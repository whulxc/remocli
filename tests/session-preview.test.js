import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConversationSummary, extractSessionConversation } from '../src/shared/session-conversation.js';
import { previewFromConversation, previewFromSnapshot } from '../src/shared/session-preview.js';

test('session preview prefers the latest computer-side message from the conversation', () => {
  const preview = previewFromConversation({
    items: [
      {
        role: 'assistant',
        text: '电脑执行了若干命令',
      },
      {
        role: 'user',
        text: '请把当前会话里的预览改成最新消息开头',
      },
      {
        role: 'assistant',
        text: '已经开始修改。',
      },
    ],
  });

  assert.equal(preview, '已经开始修改。');
});

test('session preview falls back to the latest user message when no computer-side item exists', () => {
  const preview = previewFromConversation({
    items: [
      {
        role: 'user',
        text: 'Implement {feature}',
      },
    ],
  });

  assert.equal(preview, 'Implement {feature}');
});

test('session preview ignores collapsed assistant detail bodies in summary-only conversations', () => {
  const preview = previewFromConversation({
    summaryOnly: true,
    items: [
      {
        role: 'user',
        text: '请修一下会话列表的预览。',
      },
      {
        role: 'assistant',
        summary: '',
        text: '628 + pane',
        expandable: true,
      },
    ],
  });

  assert.equal(preview, '请修一下会话列表的预览。');
});

test('session preview still uses visible assistant text in summary-only conversations', () => {
  const preview = previewFromConversation({
    summaryOnly: true,
    items: [
      {
        role: 'assistant',
        text: '已经完成修复。',
        expandable: false,
      },
    ],
  });

  assert.equal(preview, '已经完成修复。');
});

test('session preview for codex list cards uses the summary projection instead of collapsed detail text', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› 请修一下会话列表的预览。',
      '',
      '• I checked the parser and updated the UI summary rule.',
      '',
      '• Final summary line one should stay fully visible in the collapsed card.',
      'Final summary line two should also stay visible before the user expands details.',
      '',
      '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
    includeMetadata: true,
  });

  assert.equal(
    previewFromConversation(buildConversationSummary(conversation)),
    '请修一下会话列表的预览。',
  );
});

test('session preview falls back to the latest visible snapshot line', () => {
  assert.equal(
    previewFromSnapshot([
      'OpenAI Codex',
      'gpt-5.4 xhigh fast',
      '最新可见的一行',
    ].join('\n')),
    '最新可见的一行',
  );
});

test('session preview ignores codex footer noise in snapshot fallbacks', () => {
  assert.equal(
    previewFromSnapshot([
      '• 已完成这次修复。',
      '',
      'gpt-5.4 xhigh · 57% left · ~/workspace/remocli · 5h 96% · weekly 12% · 94M used',
    ].join('\n')),
    '• 已完成这次修复。',
  );
});
