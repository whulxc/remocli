import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionPreferences } from '../src/gateway/session-preferences.js';

test('session preferences can rename stored ids', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-connect-prefs-'));
  const filePath = path.join(tempDir, 'session-preferences.json');
  const preferences = new SessionPreferences(filePath);

  preferences.setOrder(['agent:old-session', 'agent:other-session']);
  preferences.hide(['agent:old-session']);
  preferences.markCompletedUnread(['agent:old-session']);
  const next = preferences.renameSessionId('agent:old-session', 'agent:new-session');

  assert.deepEqual(next.order, ['agent:new-session', 'agent:other-session']);
  assert.deepEqual(next.hidden, ['agent:new-session']);
  assert.deepEqual(next.unreadCompleted, ['agent:new-session']);
});
