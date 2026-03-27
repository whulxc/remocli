import test from 'node:test';
import assert from 'node:assert/strict';
import { StableSessionCache } from '../src/agent/stable-session-cache.js';

test('stable session cache stores preview and detail snapshots independently', () => {
  const cache = new StableSessionCache();

  cache.setPreview('demo', {
    snapshot: 'preview',
    visibleSnapshot: 'visible',
    pane: { inMode: false },
  });
  cache.setDetail('demo', 3000, {
    snapshot: 'detail',
    snapshotLineCount: 2800,
    pane: { inMode: false },
  });

  assert.deepEqual(cache.getPreview('demo'), {
    snapshot: 'preview',
    visibleSnapshot: 'visible',
    pane: { inMode: false },
  });
  assert.deepEqual(cache.getDetail('demo', 3000), {
    snapshot: 'detail',
    snapshotLineCount: 2800,
    pane: { inMode: false },
  });
});

test('stable session cache renames and removes stored entries', () => {
  const cache = new StableSessionCache();
  cache.setPreview('before', { snapshot: 'preview' });
  cache.setDetail('before', 3000, { snapshot: 'detail' });

  cache.renameSession('before', 'after');
  assert.equal(cache.getPreview('before'), null);
  assert.deepEqual(cache.getPreview('after'), { snapshot: 'preview' });
  assert.deepEqual(cache.getDetail('after', 3000), { snapshot: 'detail' });

  cache.removeSession('after');
  assert.equal(cache.getPreview('after'), null);
  assert.equal(cache.getDetail('after', 3000), null);
});
