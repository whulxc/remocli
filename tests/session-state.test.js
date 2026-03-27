import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSessionState, detectSessionStateFromCapture, summarizeTransition } from '../src/shared/session-state.js';

test('detectSessionState prioritizes completion before attention', () => {
  const state = detectSessionState('Task completed\nApprove?', {
    attentionPatterns: ['approve'],
    completionPatterns: ['task completed'],
  });

  assert.equal(state, 'completed');
});

test('detectSessionState identifies attention and errors', () => {
  assert.equal(
    detectSessionState('Waiting for user confirmation', {
      attentionPatterns: ['waiting for user'],
    }),
    'needs_input',
  );

  assert.equal(
    detectSessionState('ERROR: action failed', {
      errorPatterns: ['error:'],
    }),
    'error',
  );
});

test('detectSessionStateFromCapture prefers the visible pane over older scrollback history', () => {
  assert.equal(
    detectSessionStateFromCapture({
      snapshot: 'Earlier log:\nERROR: action failed',
      visibleSnapshot: 'All good now\nWaiting for user confirmation',
    }, {
      attentionPatterns: ['waiting for user'],
      errorPatterns: ['error:'],
    }),
    'needs_input',
  );
});

test('detectSessionStateFromCapture ignores chat prose that only talks about failures', () => {
  assert.equal(
    detectSessionStateFromCapture({
      mode: 'chat',
      readyForInput: true,
      hasBackgroundTask: false,
      visibleSnapshot: '• 我继续往下查了，state: error。\n  这只是对 failed 的误判，不是真错误。\n• Working complete',
    }, {
      errorPatterns: ['error:', 'failed'],
    }),
    'completed',
  );
});

test('detectSessionStateFromCapture keeps chat sessions on error when tool output actually fails', () => {
  assert.equal(
    detectSessionStateFromCapture({
      mode: 'chat',
      readyForInput: true,
      hasBackgroundTask: false,
      visibleSnapshot: '• Ran curl https://example.com\n  └ Error: request failed',
    }, {
      errorPatterns: ['error:', 'failed'],
    }),
    'error',
  );
});

test('detectSessionStateFromCapture prefers completed for chat sessions back at the prompt even with background tasks', () => {
  assert.equal(
    detectSessionStateFromCapture({
      mode: 'chat',
      readyForInput: true,
      hasBackgroundTask: true,
      visibleSnapshot: '• 已经返回提示符。\n  1 background terminal running · /ps to view · /stop to close',
    }, {
      errorPatterns: ['error:', 'failed'],
    }),
    'completed',
  );
});

test('detectSessionStateFromCapture keeps chat sessions running while codex still shows a working indicator', () => {
  assert.equal(
    detectSessionStateFromCapture({
      mode: 'chat',
      readyForInput: true,
      hasBackgroundTask: false,
      visibleSnapshot: '• 正在继续处理。\n\n  Working (10s • esc to interrupt)',
    }, {
      errorPatterns: ['error:', 'failed'],
    }),
    'running',
  );
});

test('summarizeTransition only emits on meaningful changes', () => {
  assert.equal(summarizeTransition('running', 'running'), null);
  assert.equal(summarizeTransition('running', 'needs_input'), '会话正在等待你的输入');
});
