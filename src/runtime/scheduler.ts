import { lockManager } from './locks';
import { runStore } from './runStore';
import type { RunContext } from './types';
import type { LockKey } from './types';

export interface MultiThreadConfig {
  enabled: boolean;
  globalMaxConcurrentRuns: number;
  defaultProviderMaxConcurrentRuns: number;
  defaultAccountMaxConcurrentRuns: number;
  defaultWorkerMaxConcurrentRuns: number;
  sameProviderChatPolicy: 'queue';
  sameSessionWritePolicy: 'serialize';
  queueTimeoutMs: number;
  runTimeoutMs: number;
  subagentMode: string;
}

const DEFAULT_CONFIG: MultiThreadConfig = {
  enabled: true,
  globalMaxConcurrentRuns: 20,
  defaultProviderMaxConcurrentRuns: 5,
  defaultAccountMaxConcurrentRuns: 2,
  defaultWorkerMaxConcurrentRuns: 1,
  sameProviderChatPolicy: 'queue',
  sameSessionWritePolicy: 'serialize',
  queueTimeoutMs: 120000,
  runTimeoutMs: 300000,
  subagentMode: 'parallel-safe',
};

let config: MultiThreadConfig = { ...DEFAULT_CONFIG };
let timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setSchedulerConfig(cfg: Partial<MultiThreadConfig>) {
  config = { ...config, ...cfg };
}

export function getSchedulerConfig(): MultiThreadConfig {
  return { ...config };
}

interface CapacityAcquisition {
  key: string;
}

interface LockAcquisition {
  key: LockKey | string;
}

interface RunLease {
  runId: string;
  capacityKeys: string[];
  lockKeys: string[];
  released: boolean;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

const leases = new Map<string, RunLease>();

function getLease(runId: string): RunLease | undefined {
  return leases.get(runId);
}

function ensureLease(runId: string): RunLease {
  let lease = leases.get(runId);
  if (!lease) {
    lease = { runId, capacityKeys: [], lockKeys: [], released: false };
    leases.set(runId, lease);
  }
  return lease;
}

async function acquireCapacityWithLease(
  runId: string,
  key: string,
  max: number,
  timeoutMs: number,
): Promise<boolean> {
  const ok = await lockManager.acquireCapacityQueued(key, max, timeoutMs, { runId });
  if (ok) {
    const lease = ensureLease(runId);
    lease.capacityKeys.push(key);
  }
  return ok;
}

async function acquireLockWithLease(
  runId: string,
  key: LockKey | string,
  timeoutMs?: number,
): Promise<boolean> {
  const ok = await lockManager.acquireLock(key, runId, timeoutMs);
  if (ok) {
    const lease = ensureLease(runId);
    lease.lockKeys.push(key as string);
  }
  return ok;
}

export interface ScheduleOverrides {
  providerMax?: number;
  accountMax?: number;
  workerId?: string;
  workerMax?: number;
}

export async function scheduleRun(
  runId: string,
  providerId: string,
  accountId: string | undefined,
  providerChatId: string | undefined,
  configOverrides?: ScheduleOverrides,
): Promise<{ ok: boolean; reason?: string }> {
  if (!config.enabled) return { ok: true };

  const queueTimeout = config.queueTimeoutMs;

  const pMax = configOverrides?.providerMax ?? config.defaultProviderMaxConcurrentRuns;
  const aMax = configOverrides?.accountMax ?? config.defaultAccountMaxConcurrentRuns;
  const wMax = configOverrides?.workerMax ?? config.defaultWorkerMaxConcurrentRuns;

  const ok = await acquireCapacityWithLease(runId, 'global', config.globalMaxConcurrentRuns, queueTimeout);
  if (!ok) return { ok: false, reason: 'global_capacity_full' };

  const providerKey = `provider:${providerId}`;
  const okP = await acquireCapacityWithLease(runId, providerKey, pMax, queueTimeout);
  if (!okP) {
    await releaseRun(runId);
    return { ok: false, reason: `provider_capacity_full:${providerId}` };
  }

  if (accountId) {
    const accountKey = `account:${providerId}:${accountId}`;
    const okA = await acquireCapacityWithLease(runId, accountKey, aMax, queueTimeout);
    if (!okA) {
      await releaseRun(runId);
      return { ok: false, reason: `account_capacity_full:${accountId}` };
    }
  }

  if (configOverrides?.workerId) {
    const workerKey = `worker:${configOverrides.workerId}`;
    const okW = await acquireCapacityWithLease(runId, workerKey, wMax, queueTimeout);
    if (!okW) {
      await releaseRun(runId);
      return { ok: false, reason: `worker_capacity_full:${configOverrides.workerId}` };
    }
  }

  if (providerChatId && accountId && config.sameProviderChatPolicy === 'queue') {
    const chatKey = `provider-chat:${providerId}:${accountId}:${providerChatId}` as const;
    const okC = await acquireLockWithLease(runId, chatKey, config.queueTimeoutMs);
    if (!okC) {
      return { ok: false, reason: 'provider_chat_queue_timeout' };
    }
  }

  return { ok: true };
}

export async function releaseRun(runId: string): Promise<void> {
  const run = runStore.getRun(runId);
  const lease = getLease(runId);

  if (lease) {
    if (lease.released) return;
    lease.released = true;
    for (const ck of lease.capacityKeys) {
      lockManager.releaseCapacity(ck);
    }
    for (const lk of lease.lockKeys) {
      lockManager.releaseLock(lk, runId);
    }
    if (lease.timeoutTimer) {
      clearTimeout(lease.timeoutTimer);
    }
    leases.delete(runId);
  }

  if (timeoutTimers.has(runId)) {
    clearTimeout(timeoutTimers.get(runId)!);
    timeoutTimers.delete(runId);
  }

  if (run && run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') {
    const terminal = !lease?.released;
  }
}

export function startRunTimeout(runId: string): void {
  if (!config.enabled) return;
  const timer = setTimeout(() => {
    const run = runStore.getRun(runId);
    if (!run) return;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return;
    runStore.updateRun(runId, { status: 'failed', error: `Run timeout after ${config.runTimeoutMs}ms` });
    releaseRun(runId).catch(() => {});
  }, config.runTimeoutMs);
  timeoutTimers.set(runId, timer);
}

export async function acquireSessionWriteLock(sessionId: string): Promise<void> {
  if (!config.enabled || config.sameSessionWritePolicy !== 'serialize') return;
  await lockManager.acquireLock(`session-write:${sessionId}` as any, `session-write-${sessionId}`);
}

export function releaseSessionWriteLock(sessionId: string): void {
  if (!config.enabled) return;
  lockManager.releaseLock(`session-write:${sessionId}` as any, `session-write-${sessionId}`);
}

export async function acquireProviderBindingLock(sessionId: string): Promise<void> {
  if (!config.enabled) return;
  await lockManager.acquireLock(`session-binding:${sessionId}` as any, `session-binding-${sessionId}`);
}

export function releaseProviderBindingLock(sessionId: string): void {
  if (!config.enabled) return;
  lockManager.releaseLock(`session-binding:${sessionId}` as any, `session-binding-${sessionId}`);
}

export function getRuntimeDiagnostics(): Record<string, any> {
  const snapshot = lockManager.getSnapshot();
  return {
    config,
    locks: snapshot,
    activeRuns: runStore.getActiveRuns().length,
    leases: Array.from(leases.entries()).map(([id, l]) => ({
      runId: id,
      capacityKeys: l.capacityKeys,
      lockKeys: l.lockKeys,
      released: l.released,
    })),
  };
}
