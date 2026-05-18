import type { LockKey } from './types';

interface LockEntry {
  ownerId: string;
  done: Promise<void>;
  release: () => void;
}

interface CapacityWaiter {
  resolve: (ok: boolean) => void;
  timer?: ReturnType<typeof setTimeout>;
  runId?: string;
  reason?: string;
}

interface CapacityState {
  active: number;
  max: number;
  waiters: CapacityWaiter[];
}

export class LockManager {
  private locks = new Map<string, LockEntry>();
  private capacityStates = new Map<string, CapacityState>();

  async acquireLock(key: LockKey | string, ownerId: string, timeoutMs?: number): Promise<boolean> {
    const deadline = timeoutMs ? Date.now() + timeoutMs : 0;
    while (this.locks.has(key)) {
      const prev = this.locks.get(key)!;
      if (deadline && Date.now() > deadline) return false;
      await Promise.race([
        prev.done,
        deadline ? new Promise(r => setTimeout(r, deadline - Date.now())) : prev.done,
      ]);
    }
    let release: () => void;
    const done = new Promise<void>(r => { release = r; });
    this.locks.set(key, { ownerId, done, release: release! });
    return true;
  }

  releaseLock(key: LockKey | string, ownerId: string): void {
    const entry = this.locks.get(key);
    if (!entry) return;
    if (entry.ownerId !== ownerId) return;
    this.locks.delete(key);
    entry.release();
  }

  isLocked(key: LockKey | string): boolean {
    return this.locks.has(key);
  }

  getLockOwner(key: LockKey | string): string | undefined {
    return this.locks.get(key)?.ownerId;
  }

  async acquireCapacityQueued(
    key: string,
    max: number,
    timeoutMs: number,
    meta?: { runId?: string; reason?: string },
  ): Promise<boolean> {
    let state = this.capacityStates.get(key);
    if (!state) {
      state = { active: 0, max, waiters: [] };
      this.capacityStates.set(key, state);
    }
    state.max = max;
    if (state.active < max) {
      state.active++;
      return true;
    }
    return new Promise<boolean>(resolve => {
      const waiter: CapacityWaiter = { resolve, runId: meta?.runId, reason: meta?.reason };
      if (timeoutMs > 0 && timeoutMs < Infinity) {
        waiter.timer = setTimeout(() => {
          const idx = state!.waiters.indexOf(waiter);
          if (idx >= 0) state!.waiters.splice(idx, 1);
          resolve(false);
        }, timeoutMs);
      }
      state!.waiters.push(waiter);
    });
  }

  releaseCapacity(key: string, count = 1): void {
    const state = this.capacityStates.get(key);
    if (!state) return;
    state.active = Math.max(0, state.active - count);
    while (state.waiters.length > 0 && state.active < state.max) {
      const waiter = state.waiters.shift()!;
      if (waiter.timer) clearTimeout(waiter.timer);
      state.active++;
      waiter.resolve(true);
    }
    if (state.active === 0 && state.waiters.length === 0) {
      this.capacityStates.delete(key);
    }
  }

  currentCapacity(key: string): number {
    return this.capacityStates.get(key)?.active ?? 0;
  }

  currentCapacityMax(key: string): number {
    return this.capacityStates.get(key)?.max ?? 0;
  }

  getSnapshot(): Record<string, { locked: boolean; ownerId?: string; capacity: number; capacityMax: number; queued: number }> {
    const snapshot: Record<string, any> = {};
    for (const [key, entry] of this.locks) {
      snapshot[key] = { locked: true, ownerId: entry.ownerId, capacity: 0, capacityMax: 0, queued: 0 };
    }
    for (const [key, state] of this.capacityStates) {
      const existing = snapshot[key] || {};
      snapshot[key] = { ...existing, capacity: state.active, capacityMax: state.max, queued: state.waiters.length };
    }
    return snapshot;
  }
}

export const lockManager = new LockManager();
export default lockManager;
