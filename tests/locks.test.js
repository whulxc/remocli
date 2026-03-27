import test from 'node:test';
import assert from 'node:assert/strict';
import { LockManager } from '../src/shared/locks.js';

test('LockManager enforces ownership', () => {
  const manager = new LockManager(5_000);

  const first = manager.acquire('session-1', 'phone-a');
  assert.equal(first.ok, true);

  const second = manager.acquire('session-1', 'phone-b');
  assert.equal(second.ok, false);

  assert.equal(manager.release('session-1', 'phone-b'), false);
  assert.equal(manager.release('session-1', 'phone-a'), true);
});

test('LockManager expires stale locks', async () => {
  const manager = new LockManager(10);
  manager.acquire('session-1', 'phone-a');

  await new Promise((resolve) => setTimeout(resolve, 15));

  const second = manager.acquire('session-1', 'phone-b');
  assert.equal(second.ok, true);
});

test('LockManager forceAcquire replaces another owner', () => {
  const manager = new LockManager(5_000);
  manager.acquire('session-1', 'desktop-a');

  const next = manager.forceAcquire('session-1', 'phone-b');
  assert.equal(next.ok, true);
  assert.equal(next.replaced?.owner, 'desktop-a');
  assert.equal(manager.get('session-1')?.owner, 'phone-b');
});
