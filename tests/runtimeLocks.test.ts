import { describe, it, assertEqual, assertTrue, assertFalse, printSummary, flushAsync } from './utils';

const mod = require('../src/runtime/locks');
const LockManager = mod.LockManager;

describe('LockManager — Basic lock acquire/release', () => {
  it('acquires and releases a lock on a key', async () => {
    const lm = new LockManager();
    const ok = await lm.acquireLock('test-key', 'owner-1');
    assertTrue(ok, 'should acquire lock');
    assertTrue(lm.isLocked('test-key'), 'key should be locked');
    assertEqual(lm.getLockOwner('test-key'), 'owner-1');
    lm.releaseLock('test-key', 'owner-1');
    assertFalse(lm.isLocked('test-key'), 'key should be unlocked after release');
  });

  it('prevents concurrent acquisition of same key', async () => {
    const lm = new LockManager();
    await lm.acquireLock('key', 'owner-a');
    const acquired = await lm.acquireLock('key', 'owner-b', 50);
    assertFalse(acquired, 'second acquire should timeout');
  });

  it('allows next owner after release', async () => {
    const lm = new LockManager();
    await lm.acquireLock('key', 'owner-a');
    setTimeout(() => lm.releaseLock('key', 'owner-a'), 30);
    const acquired = await lm.acquireLock('key', 'owner-b', 100);
    assertTrue(acquired, 'should acquire after release');
    assertEqual(lm.getLockOwner('key'), 'owner-b');
  });

  it('releaseLock with wrong ownerId does not unlock', async () => {
    const lm = new LockManager();
    await lm.acquireLock('key', 'owner-1');
    lm.releaseLock('key', 'wrong-owner');
    assertTrue(lm.isLocked('key'), 'key should remain locked');
    lm.releaseLock('key', 'owner-1');
    assertFalse(lm.isLocked('key'));
  });

  it('isLocked returns false for unknown key', () => {
    const lm = new LockManager();
    assertFalse(lm.isLocked('nonexistent'));
  });

  it('getLockOwner returns undefined for unknown key', () => {
    const lm = new LockManager();
    assertEqual(lm.getLockOwner('nonexistent'), undefined);
  });
});

describe('LockManager — Capacity queue', () => {
  it('acquires capacity immediately when under max', async () => {
    const lm = new LockManager();
    const ok = await lm.acquireCapacityQueued('cap-key', 5, 100);
    assertTrue(ok, 'should acquire immediately');
    assertEqual(lm.currentCapacity('cap-key'), 1);
  });

  it('queues when at capacity and resolves on release', async () => {
    const lm = new LockManager();
    await lm.acquireCapacityQueued('cap-key', 1, 500);
    const p = lm.acquireCapacityQueued('cap-key', 1, 500);
    await new Promise(r => setTimeout(r, 10));
    assertEqual(lm.currentCapacity('cap-key'), 1, 'capacity should still be 1');
    lm.releaseCapacity('cap-key');
    const ok = await p;
    assertTrue(ok, 'queued acquisition should resolve after release');
    assertEqual(lm.currentCapacity('cap-key'), 1, 'capacity should be 1 again');
  });

  it('times out queued acquisition', async () => {
    const lm = new LockManager();
    await lm.acquireCapacityQueued('cap-key', 1, 200);
    const ok = await lm.acquireCapacityQueued('cap-key', 1, 50);
    assertFalse(ok, 'should timeout when capacity full');
  });

  it('releases capacity correctly with count', async () => {
    const lm = new LockManager();
    await lm.acquireCapacityQueued('cap-key', 10, 100);
    await lm.acquireCapacityQueued('cap-key', 10, 100);
    await lm.acquireCapacityQueued('cap-key', 10, 100);
    assertEqual(lm.currentCapacity('cap-key'), 3);
    lm.releaseCapacity('cap-key', 2);
    assertEqual(lm.currentCapacity('cap-key'), 1);
  });

  it('releaseCapacity does not go below zero', () => {
    const lm = new LockManager();
    lm.releaseCapacity('nonexistent');
    assertEqual(lm.currentCapacity('nonexistent'), 0);
    lm.releaseCapacity('nonexistent', 5);
    assertEqual(lm.currentCapacity('nonexistent'), 0);
  });

  it('capacityFIFO — waiter order preserved', async () => {
    const lm = new LockManager();
    await lm.acquireCapacityQueued('fifo-key', 1, 500);
    const order: number[] = [];
    const p1: Promise<boolean> = lm.acquireCapacityQueued('fifo-key', 1, 500).then(ok => { order.push(1); return ok; });
    const p2: Promise<boolean> = lm.acquireCapacityQueued('fifo-key', 1, 500).then(ok => { order.push(2); return ok; });
    await new Promise(r => setTimeout(r, 10));
    lm.releaseCapacity('fifo-key');
    await new Promise(r => setTimeout(r, 10));
    assertEqual(order, [1], 'first waiter should get capacity');
    assertEqual(lm.currentCapacity('fifo-key'), 1);
    lm.releaseCapacity('fifo-key');
    await new Promise(r => setTimeout(r, 10));
    assertEqual(order, [1, 2], 'second waiter should get capacity');
  });
});

describe('LockManager — Snapshot', () => {
  it('getSnapshot returns locked and capacity state', async () => {
    const lm = new LockManager();
    await lm.acquireLock('lk1', 'o1');
    await lm.acquireCapacityQueued('cap1', 3, 100);
    await lm.acquireCapacityQueued('cap1', 3, 100);
    const snap = lm.getSnapshot();
    assertTrue(snap['lk1']?.locked);
    assertEqual(snap['lk1']?.ownerId, 'o1');
    assertEqual(snap['cap1']?.capacity, 2);
    assertEqual(snap['cap1']?.capacityMax, 3);
  });
});

(async () => {
  await flushAsync();
  printSummary();
  process.exit(0);
})();
