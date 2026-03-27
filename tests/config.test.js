import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCompositeSessionId, safeSessionId } from '../src/shared/config.js';

test('session ids round-trip through the gateway format', () => {
  const compositeId = safeSessionId('ubuntu-codex-a', 'agent-review');
  assert.deepEqual(parseCompositeSessionId(compositeId), {
    agentId: 'ubuntu-codex-a',
    sessionName: 'agent-review',
  });
});
