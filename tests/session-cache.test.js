import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionCacheScope,
  estimateCacheRecordSize,
  planSessionCachePrune,
} from '../src/frontend/session-cache.js';

test('session cache scope includes origin and client id', () => {
  assert.equal(
    buildSessionCacheScope('https://remocli.example.com', 'client-a'),
    'https://remocli.example.com::client-a::v3',
  );
});

test('estimate cache record size returns a positive byte count', () => {
  assert.ok(estimateCacheRecordSize({ text: 'hello world' }) > 0);
});

test('session cache prune removes the least recently used records first', () => {
  const result = planSessionCachePrune(
    [
      { key: 'a', sizeBytes: 40, lastAccessAt: 10, updatedAt: 10 },
      { key: 'b', sizeBytes: 40, lastAccessAt: 20, updatedAt: 20 },
      { key: 'c', sizeBytes: 40, lastAccessAt: 30, updatedAt: 30 },
    ],
    80,
  );

  assert.deepEqual(result.remove.map((record) => record.key), ['a']);
  assert.equal(result.totalBytes, 80);
});
