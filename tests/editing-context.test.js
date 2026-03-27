import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePromptInputState, editorClearSequence, extractEditingContext, inferShellKind } from '../src/shared/editing-context.js';

test('editing context parses a bash prompt line', () => {
  const context = extractEditingContext({
    kind: 'wsl',
    command: 'bash -il',
    visibleSnapshot: ['build output', 'demo@host:~/workspace/test-codex$ echo hello'].join('\n'),
    pane: {
      cursorX: 45,
      cursorY: 1,
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.shellKind, 'posix');
  assert.equal(context.promptText, 'demo@host:~/workspace/test-codex$ ');
  assert.equal(context.currentInput, 'echo hello');
  assert.equal(context.cursorColumn, 10);
  assert.equal(context.cursorRow, 1);
});

test('editing context parses a powershell prompt line', () => {
  const context = extractEditingContext({
    kind: 'powershell',
    command: 'powershell.exe -NoLogo',
    visibleSnapshot: 'PS C:\\Users\\Demo> Get-Process',
    pane: {
      cursorX: 28,
      cursorY: 0,
      currentCommand: 'powershell.exe',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.shellKind, 'powershell');
  assert.equal(context.promptText, 'PS C:\\Users\\Demo> ');
  assert.equal(context.currentInput, 'Get-Process');
  assert.equal(context.cursorColumn, 10);
});

test('editing context parses a wrapped powershell prompt line', () => {
  const context = extractEditingContext({
    kind: 'powershell',
    command: 'powershell.exe -NoLogo',
    visibleSnapshot: [
      'PS Microsoft.PowerShell.Core\\FileSystem::\\\\wsl.localhost\\Ubuntu\\home\\lin\\code\\re',
      'mote_connect> Get-Location',
    ].join('\n'),
    pane: {
      cursorX: 16,
      cursorY: 1,
      currentCommand: 'init',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.shellKind, 'powershell');
  assert.match(context.promptText, /^PS Microsoft\.PowerShell\.Core/);
  assert.equal(context.currentInput, 'Get-Location');
});

test('editing context parses a codex prompt line above the status bar', () => {
  const context = extractEditingContext({
    kind: 'wsl',
    command: 'bash -il',
    visibleSnapshot: [
      'demo@host:~/workspace/remocli$ codex',
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› hi',
      '',
      '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    ].join('\n'),
    pane: {
      cursorX: 4,
      cursorY: 5,
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.shellKind, 'posix');
  assert.equal(context.promptText, '› ');
  assert.equal(context.currentInput, 'hi');
});

test('editing context treats a codex prompt with the cursor back at the prompt as ready for input', () => {
  const context = extractEditingContext({
    kind: 'wsl',
    command: 'bash -il',
    visibleSnapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '• Summary complete',
      '',
      '› Summarize recent commits',
      '',
      '  gpt-5.4 xhigh fast · 91% left · ~/workspace/remocli · 5h 56% · weekly 3% · 48.7M used',
    ].join('\n'),
    pane: {
      cursorX: 2,
      cursorY: 4,
      currentCommand: 'node',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.promptText, '› ');
  assert.equal(context.currentInput, '');
  assert.equal(context.cursorColumn, 0);
  assert.deepEqual(derivePromptInputState(context), {
    promptAtStart: true,
    readyForInput: true,
    hasPendingUserInput: false,
  });
});

test('editing context keeps codex background-terminal info without blocking prompt readiness', () => {
  const context = extractEditingContext({
    kind: 'wsl',
    command: 'bash -il',
    visibleSnapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '• Waiting for background task',
      '',
      '  1 background terminal running · /ps to view · /stop to close',
      '',
      '› Explain this codebase',
      '',
      '  gpt-5.4 xhigh fast · 29% left · ~/code/AIforSmartwatch · 5h 92% · weekly 41% · 53.4M used',
    ].join('\n'),
    pane: {
      cursorX: 2,
      cursorY: 6,
      currentCommand: 'node',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.promptText, '› ');
  assert.equal(context.currentInput, '');
  assert.equal(context.hasBackgroundTask, true);
  assert.deepEqual(derivePromptInputState(context), {
    promptAtStart: true,
    readyForInput: true,
    hasPendingUserInput: false,
  });
});

test('editing context ignores attachment-only image paths in a codex prompt', () => {
  const context = extractEditingContext({
    kind: 'wsl',
    command: 'bash -il',
    visibleSnapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› C:\\Users\\Lin\\xwechat_files\\wxid_jp28yuti8moa22_a391\\temp\\RWTemp\\2026-03\\9e20f478899dc29eb19741386f9343c8\\db23e57c34cb9f4b3a3131b3f531e1e3.jpg',
      '',
      '  gpt-5.4 xhigh fast · 91% left · ~/workspace/remocli · 5h 56% · weekly 3% · 48.7M used',
    ].join('\n'),
    pane: {
      cursorX: 150,
      cursorY: 4,
      currentCommand: 'node',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.promptText, '› ');
  assert.equal(context.currentInput, '');
});

test('editing context keeps the typed request when a codex image attachment path appears above it', () => {
  const context = extractEditingContext({
    kind: 'wsl',
    command: 'bash -il',
    visibleSnapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› C:\\Users\\Lin\\xwechat_files\\wxid_jp28yuti8moa22_a391\\temp\\RWTemp\\2026-03\\9e20f478899dc29eb19741386f9343c8\\db23e57c34cb9f4b3a3131b3f531e1e3.jpg',
      'Describe the main contents of the image',
      '',
      '  gpt-5.4 xhigh fast · 91% left · ~/workspace/remocli · 5h 56% · weekly 3% · 48.7M used',
    ].join('\n'),
    pane: {
      cursorX: 35,
      cursorY: 3,
      currentCommand: 'node',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.promptText, '› ');
  assert.equal(context.currentInput, 'Describe the main contents of the image');
  assert.deepEqual(derivePromptInputState(context), {
    promptAtStart: false,
    readyForInput: false,
    hasPendingUserInput: true,
  });
});

test('editing context keeps multiline codex drafts as pending user input', () => {
  const context = extractEditingContext({
    kind: 'wsl',
    command: 'bash -il',
    visibleSnapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› 第一行',
      '第二行',
      '',
      '  gpt-5.4 xhigh fast · 91% left · ~/workspace/remocli · 5h 56% · weekly 3% · 48.7M used',
    ].join('\n'),
    pane: {
      cursorX: 4,
      cursorY: 3,
      currentCommand: 'node',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'prompt');
  assert.equal(context.currentInput, ['第一行', '第二行'].join('\n'));
  assert.deepEqual(derivePromptInputState(context), {
    promptAtStart: false,
    readyForInput: false,
    hasPendingUserInput: true,
  });
});

test('prompt input state stays running when the cursor is not back at the prompt start yet', () => {
  assert.deepEqual(derivePromptInputState({
    mode: 'prompt',
    cursorColumn: 5,
    currentInput: '',
  }), {
    promptAtStart: false,
    readyForInput: false,
    hasPendingUserInput: false,
  });
});

test('prompt input state detects unsent user drafts', () => {
  assert.deepEqual(derivePromptInputState({
    mode: 'prompt',
    cursorColumn: 12,
    currentInput: 'Explain this codebase',
  }), {
    promptAtStart: false,
    readyForInput: false,
    hasPendingUserInput: true,
  });
});

test('editing context falls back to raw terminal mode for full-screen programs', () => {
  const context = extractEditingContext({
    kind: 'wsl',
    command: 'bash -il',
    visibleSnapshot: '  GNU nano 7.2\n^G Help  ^O Write Out',
    pane: {
      cursorX: 0,
      cursorY: 0,
      currentCommand: 'nano',
      inMode: false,
    },
  });

  assert.equal(context.mode, 'raw_terminal');
  assert.equal(context.supportsLocalEditor, false);
});

test('editor clear sequence assumes readline-style bindings', () => {
  assert.deepEqual(editorClearSequence('posix'), ['C-a', 'C-k']);
  assert.deepEqual(editorClearSequence('powershell'), ['C-a', 'C-k']);
  assert.deepEqual(editorClearSequence('unknown'), []);
});

test('shell kind inference recognizes powershell and posix shells', () => {
  assert.equal(inferShellKind({ kind: 'powershell', command: 'powershell.exe -NoLogo' }), 'powershell');
  assert.equal(inferShellKind({ kind: 'wsl', command: 'bash -il' }), 'posix');
  assert.equal(inferShellKind({ kind: 'unknown', command: 'cmd.exe' }), 'unknown');
});
