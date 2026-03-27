import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionCommand,
  defaultSessionName,
  inferSessionKind,
  normalizeSessionKind,
  sessionKindLabel,
} from '../src/shared/session-kind.js';
import { previewFromSnapshot, stripAnsi } from '../src/shared/session-preview.js';

test('session kind helpers normalize and infer kinds', () => {
  assert.equal(normalizeSessionKind('powershell'), 'powershell');
  assert.equal(normalizeSessionKind('unknown'), 'wsl');
  assert.equal(inferSessionKind({ command: 'powershell.exe -NoLogo' }), 'powershell');
  assert.equal(inferSessionKind({ currentCommand: 'pwsh' }), 'powershell');
  assert.equal(
    inferSessionKind({
      previewText: 'mote_connect>',
      snapshot: [
        'PS Microsoft.PowerShell.Core\\FileSystem::\\\\wsl.localhost\\Ubuntu\\home\\lin\\code\\remote_connect>',
        'Write-Output inherited-ps-history',
      ].join('\n'),
    }),
    'powershell',
  );
  assert.equal(inferSessionKind({ command: 'bash -il' }), 'wsl');
  assert.equal(sessionKindLabel('powershell', { admin: true }), 'PowerShell 管理员');
});

test('session command builder uses defaults and admin wrapper', () => {
  assert.equal(buildSessionCommand({ sessionKind: 'wsl' }), 'bash -il');
  assert.equal(buildSessionCommand({ sessionKind: 'powershell' }), 'powershell.exe -NoLogo');
  assert.equal(
    buildSessionCommand({
      sessionKind: 'powershell',
      admin: true,
      powerShellAdminWrapper: 'gsudo.exe',
    }),
    'gsudo.exe powershell.exe -NoLogo',
  );
  assert.equal(defaultSessionName('powershell', '' ).startsWith('powershell-'), true);
});

test('session preview strips ansi and returns the last non-empty line', () => {
  const snapshot = '\u001b[32muser@host\u001b[0m$ pwd\n/home/demo/workspace/test\n\u001b[32muser@host\u001b[0m$';
  assert.equal(stripAnsi(snapshot).includes('\u001b['), false);
  assert.equal(previewFromSnapshot(snapshot), 'user@host$');
});
