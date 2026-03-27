import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConversationSummary,
  extractSessionConversation,
  findConversationItemDetail,
} from '../src/shared/session-conversation.js';

test('session conversation parses wrapped powershell prompts and output', () => {
  const conversation = extractSessionConversation({
    kind: 'powershell',
    command: 'powershell.exe -NoLogo',
    snapshot: [
      'PS Microsoft.PowerShell.Core\\FileSystem::\\\\wsl.localhost\\Ubuntu\\home\\lin\\code\\re',
      'mote_connect> Get-Location',
      '',
      'Path',
      '----',
      'Microsoft.PowerShell.Core\\FileSystem::\\\\wsl.localhost\\Ubuntu\\home\\lin\\code\\remote_connect',
      '',
      'PS Microsoft.PowerShell.Core\\FileSystem::\\\\wsl.localhost\\Ubuntu\\home\\lin\\code\\re',
      'mote_connect>',
    ].join('\n'),
    pane: {
      currentCommand: 'init',
      inMode: false,
    },
  });

  assert.equal(conversation.mode, 'chat');
  assert.deepEqual(conversation.items, [
    {
      role: 'user',
      text: 'Get-Location',
    },
    {
      role: 'assistant',
      text: [
        'Path',
        '----',
        'Microsoft.PowerShell.Core\\FileSystem::\\\\wsl.localhost\\Ubuntu\\home\\lin\\code\\remote_connect',
      ].join('\n'),
    },
  ]);
});

test('session conversation parses codex prompts and strips the footer status line', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      'demo@host:~/workspace/remocli$ codex',
      '╭─────────────────────────────────────────────────────╮',
      '│ >_ OpenAI Codex (v0.114.0)                          │',
      '│                                                     │',
      '│ model:     gpt-5.4 medium   fast   /model to change │',
      '│ directory: ~/workspace/remocli                    │',
      '╰─────────────────────────────────────────────────────╯',
      '',
      '  Tip: New 2x rate limits until April 2nd.',
      '',
      '',
      '› hi',
      '',
      '',
      '• Hi.',
      '',
      '',
      '› hi',
      '',
      '',
      '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
    currentInput: 'hi',
  });

  assert.equal(conversation.mode, 'chat');
  assert.equal(conversation.appKind, 'codex');
  assert.equal(
    conversation.statusLine,
    'gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
  );
  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: [
        'demo@host:~/workspace/remocli$ codex',
        '╭─────────────────────────────────────────────────────╮',
        '│ >_ OpenAI Codex (v0.114.0)                          │',
        '│                                                     │',
        '│ model:     gpt-5.4 medium   fast   /model to change │',
        '│ directory: ~/workspace/remocli                    │',
        '╰─────────────────────────────────────────────────────╯',
        '',
        '  Tip: New 2x rate limits until April 2nd.',
      ].join('\n'),
      summary: '电脑执行：codex',
      collapsed: true,
    },
    {
      role: 'user',
      text: 'hi',
    },
    {
      role: 'assistant',
      text: 'Hi.',
    },
  ]);
});

test('session conversation keeps shell commands on the computer side after leaving codex', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      'demo@host:~/workspace/remocli$ codex',
      '╭─────────────────────────────────────────────────────╮',
      '│ >_ OpenAI Codex (v0.114.0)                          │',
      '╰─────────────────────────────────────────────────────╯',
      '',
      '› hi',
      '',
      '• Hi.',
      '',
      'Token usage: total=2,271 input=2,215 (+ 55,040 cached) output=56',
      'To continue this session, run codex resume 019cefe5-b29f-77e0-8bcf-d7d5e32dec1c',
      'demo@host:~/workspace/remocli$ hi',
      'hi: command not found',
      'demo@host:~/workspace/remocli$ ee',
      'ee: command not found',
      'demo@host:~/workspace/remocli$',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.deepEqual(conversation.items.slice(-1), [
    {
      role: 'assistant',
      text: [
        'Hi.',
        '',
        'Token usage: total=2,271 input=2,215 (+ 55,040 cached) output=56',
        'To continue this session, run codex resume 019cefe5-b29f-77e0-8bcf-d7d5e32dec1c',
        '',
        'demo@host:~/workspace/remocli$ hi',
        'hi: command not found',
        '',
        'demo@host:~/workspace/remocli$ ee',
        'ee: command not found',
        'demo@host:~/workspace/remocli$',
      ].join('\n'),
      summary: '',
      collapsed: true,
    },
  ]);
});

test('session conversation coalesces consecutive codex computer updates into one collapsed block', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› fix it',
      '',
      '• I will inspect the current parser first.',
      '',
      'Explored',
      '  └ Read session-conversation.js',
      '',
      'demo@host:~/workspace/remocli$ npm test',
      'ok',
      '',
      '• I found the issue.',
      '',
      'demo@host:~/workspace/remocli$ git diff --stat',
      'src/shared/session-conversation.js | 42 +++++++++++++++++++',
      '',
      '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: '│ >_ OpenAI Codex (v0.114.0) │',
    },
    {
      role: 'user',
      text: 'fix it',
    },
    {
      role: 'assistant',
      text: [
        'I will inspect the current parser first.',
        '',
        'Explored',
        '  └ Read session-conversation.js',
        '',
        'demo@host:~/workspace/remocli$ npm test',
        'ok',
        '',
        'I found the issue.',
        '',
        'demo@host:~/workspace/remocli$ git diff --stat',
        'src/shared/session-conversation.js | 42 +++++++++++++++++++',
      ].join('\n'),
      summary: '',
      collapsed: true,
    },
  ]);
});

test('session conversation uses detail suffix for collapsed chat-only summaries', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› summarize it',
      '',
      '• I will inspect the parser flow first.',
      '',
      '• Then I will rewrite the summary output.',
      '',
      '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: '│ >_ OpenAI Codex (v0.114.0) │',
    },
    {
      role: 'user',
      text: 'summarize it',
    },
    {
      role: 'assistant',
      text: [
        'I will inspect the parser flow first.',
        '',
        'Then I will rewrite the summary output.',
      ].join('\n'),
      summary: '',
      collapsed: true,
    },
  ]);
});

test('session conversation prefers the last assistant section after a divider as the collapsed summary', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› ship it',
      '',
      '• I checked the parser and updated the summary rule.',
      '',
      'demo@host:~/workspace/remocli$ npm test',
      'ok',
      '',
      '• Work log',
      '---',
      'Final summary for the phone UI',
      '',
      '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: '│ >_ OpenAI Codex (v0.114.0) │',
    },
    {
      role: 'user',
      text: 'ship it',
    },
    {
      role: 'assistant',
      text: [
        'I checked the parser and updated the summary rule.',
        '',
        'demo@host:~/workspace/remocli$ npm test',
        'ok',
        '',
        'Work log',
        '---',
        'Final summary for the phone UI',
      ].join('\n'),
      summary: '• Final summary for the phone UI',
      collapsed: true,
    },
  ]);
});

test('session conversation keeps the full latest summary section in the collapsed title', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› summarize it fully',
      '',
      '• I checked the parser and updated the UI summary rule.',
      '',
      'demo@host:~/workspace/remocli$ npm test',
      'ok',
      '',
      '• Work log',
      '---',
      'Final summary line one that should stay fully visible in the collapsed card.',
      'Final summary line two should also stay visible before the user expands details.',
      '',
      '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: '│ >_ OpenAI Codex (v0.114.0) │',
    },
    {
      role: 'user',
      text: 'summarize it fully',
    },
    {
      role: 'assistant',
      text: [
        'I checked the parser and updated the UI summary rule.',
        '',
        'demo@host:~/workspace/remocli$ npm test',
        'ok',
        '',
        'Work log',
        '---',
        'Final summary line one that should stay fully visible in the collapsed card.',
        'Final summary line two should also stay visible before the user expands details.',
      ].join('\n'),
      summary: [
        '• Final summary line one that should stay fully visible in the collapsed card.',
        'Final summary line two should also stay visible before the user expands details.',
      ].join('\n'),
      collapsed: true,
    },
  ]);
});

test('session conversation leaves the collapsed title empty when no explicit summary divider is present', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› summarize it fully again',
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
  });

  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: '│ >_ OpenAI Codex (v0.114.0) │',
    },
    {
      role: 'user',
      text: 'summarize it fully again',
    },
    {
      role: 'assistant',
      text: [
        'I checked the parser and updated the UI summary rule.',
        '',
        'Final summary line one should stay fully visible in the collapsed card.',
        'Final summary line two should also stay visible before the user expands details.',
      ].join('\n'),
      summary: '',
      collapsed: true,
    },
  ]);
});

test('session conversation keeps command output blocks inside assistant history instead of treating them as user prompts', () => {
  const snapshot = [
    '│ >_ OpenAI Codex (v0.114.0) │',
    '',
    '› Implement the plan.',
    '',
    '• Shared tests passed.',
    '',
    '• Ran npm run build',
    '  └',
    '    > remocli@0.1.0 build',
    '    > node scripts/build-front.js',
    '',
    '• Ran npm test',
    '  └',
    '    > remocli@0.1.0 test',
    '    … +106 lines',
    '    ℹ todo 0',
    '    ℹ duration_ms 559.459804',
    '',
    '• Done.',
    '',
    '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
  ].join('\n');
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot,
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: '│ >_ OpenAI Codex (v0.114.0) │',
    },
    {
      role: 'user',
      text: 'Implement the plan.',
    },
    {
      role: 'assistant',
      text: [
        'Shared tests passed.',
        '',
        'Ran npm run build',
        '  └',
        '    > remocli@0.1.0 build',
        '    > node scripts/build-front.js',
        '',
        'Ran npm test',
        '  └',
        '    > remocli@0.1.0 test',
        '    … +106 lines',
        '    ℹ todo 0',
        '    ℹ duration_ms 559.459804',
        '',
        'Done.',
      ].join('\n'),
      summary: '',
      collapsed: true,
    },
  ]);

  const metadataConversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot,
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
    includeMetadata: true,
  });

  assert.ok(
    !buildConversationSummary(metadataConversation).items.some((item) => (
      `${item?.role || ''}` === 'user'
      && /remote-connect@0\.1\.0 build|node scripts\/build-front\.js|remote-connect@0\.1\.0 test/u.test(`${item?.text || ''}`)
    )),
  );
});

test('session conversation drops a trailing codex prompt residue when the cursor is back at the prompt start', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› add tests',
      '',
      '• I added the tests.',
      '',
      '› Implement {feature}',
      '',
      '  gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
    currentInput: '',
    promptAtStart: true,
  });

  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: '│ >_ OpenAI Codex (v0.114.0) │',
    },
    {
      role: 'user',
      text: 'add tests',
    },
    {
      role: 'assistant',
      text: 'I added the tests.',
    },
  ]);
});

test('session conversation does not treat attachment-only image paths as user messages', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› C:\\Users\\Lin\\xwechat_files\\wxid_jp28yuti8moa22_a391\\temp\\RWTemp\\2026-03\\9e20f478899dc29eb19741386f9343c8\\db23e57c34cb9f4b3a3131b3f531e1e3.jpg',
      '',
      '• I will inspect the image.',
      '',
      '  gpt-5.4 xhigh fast · 91% left · ~/workspace/remocli · 5h 56% · weekly 3% · 48.7M used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.equal(conversation.items.some((item) => item.role === 'user'), false);
  assert.match(conversation.items[0]?.text || '', /I will inspect the image\./u);
});

test('session conversation keeps the typed request when an image attachment path appears above it', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› C:\\Users\\Lin\\xwechat_files\\wxid_jp28yuti8moa22_a391\\temp\\RWTemp\\2026-03\\9e20f478899dc29eb19741386f9343c8\\db23e57c34cb9f4b3a3131b3f531e1e3.jpg',
      'Describe the main contents of the image',
      '',
      '• I will describe it.',
      '',
      '  gpt-5.4 xhigh fast · 91% left · ~/workspace/remocli · 5h 56% · weekly 3% · 48.7M used',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
  });

  assert.deepEqual(conversation.items, [
    {
      role: 'assistant',
      text: '│ >_ OpenAI Codex (v0.114.0) │',
    },
    {
      role: 'user',
      text: 'Describe the main contents of the image',
    },
    {
      role: 'assistant',
      text: 'I will describe it.',
    },
  ]);
});

test('session conversation metadata keeps stable item ids when older history is prepended', () => {
  const tailConversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› ship it',
      '',
      '• Work log',
      '---',
      'Final summary for the phone UI',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
    includeMetadata: true,
  });

  const fullConversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› earlier request',
      '',
      '• Earlier answer.',
      '',
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› ship it',
      '',
      '• Work log',
      '---',
      'Final summary for the phone UI',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
    includeMetadata: true,
  });

  const tailSummaryItem = tailConversation.items.at(-1);
  const fullSummaryItem = fullConversation.items.at(-1);
  assert.equal(tailSummaryItem?.itemId, fullSummaryItem?.itemId);
});

test('conversation summary keeps user turns, simple assistant replies, and explicit summaries only', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      'lin@host:~/code$ codex',
      '',
      '› summarize it',
      '',
      '• I checked the parser.',
      '',
      'lin@host:~/code$ npm test',
      'ok',
      '',
      '• Work log',
      '---',
      'Final summary for the phone UI',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
    includeMetadata: true,
  });

  assert.deepEqual(buildConversationSummary(conversation), {
    mode: 'chat',
    shellKind: 'posix',
    appKind: 'codex',
    statusLine: '',
    summaryOnly: true,
    items: [
      {
        id: conversation.items[1].itemId,
        role: 'user',
        text: 'summarize it',
        collapsed: false,
        expandable: false,
      },
      {
        id: conversation.items[2].itemId,
        role: 'assistant',
        summary: '• Final summary for the phone UI',
        collapsed: true,
        expandable: true,
      },
    ],
  });
});

test('conversation summary keeps collapsed assistant replies addressable even when no explicit summary was extracted', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› summarize it fully again',
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

  assert.deepEqual(buildConversationSummary(conversation), {
    mode: 'chat',
    shellKind: 'posix',
    appKind: 'codex',
    statusLine: 'gpt-5.4 medium fast · 100% left · ~/workspace/remocli · 5h 80% · weekly 33% · 9.51K used',
    summaryOnly: true,
    items: [
      {
        id: conversation.items[0].itemId,
        role: 'assistant',
        text: '│ >_ OpenAI Codex (v0.114.0) │',
        collapsed: false,
        expandable: false,
      },
      {
        id: conversation.items[1].itemId,
        role: 'user',
        text: 'summarize it fully again',
        collapsed: false,
        expandable: false,
      },
      {
        id: conversation.items[2].itemId,
        role: 'assistant',
        summary: '',
        collapsed: true,
        expandable: true,
      },
    ],
  });
});

test('conversation item detail resolves by item id', () => {
  const conversation = extractSessionConversation({
    kind: 'wsl',
    command: 'bash -il',
    snapshot: [
      '│ >_ OpenAI Codex (v0.114.0) │',
      '',
      '› summarize it fully',
      '',
      '• Work log',
      '---',
      'Final summary line one.',
      'Final summary line two.',
    ].join('\n'),
    pane: {
      currentCommand: 'bash',
      inMode: false,
    },
    includeMetadata: true,
  });

  const detail = findConversationItemDetail(conversation, conversation.items.at(-1)?.itemId);
  assert.deepEqual(detail, {
    id: conversation.items.at(-1)?.itemId,
    role: 'assistant',
    text: ['Work log', '---', 'Final summary line one.', 'Final summary line two.'].join('\n'),
    summary: ['• Final summary line one.', 'Final summary line two.'].join('\n'),
    collapsed: true,
    expandable: true,
  });
});
