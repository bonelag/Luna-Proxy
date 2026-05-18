import type { ProviderWorker } from '../runtime/types';

let workersState: ProviderWorker[] = [];

export function setWorkers(workers: ProviderWorker[]): void {
  workersState = workers;
}

export function getWorkers(): ProviderWorker[] {
  return [...workersState];
}

export function upsertWorker(w: ProviderWorker): ProviderWorker {
  const idx = workersState.findIndex(x => x.id === w.id);
  if (idx >= 0) workersState[idx] = w;
  else workersState.push(w);
  return w;
}

export function deleteWorker(id: string): boolean {
  const idx = workersState.findIndex(x => x.id === id);
  if (idx < 0) return false;
  workersState.splice(idx, 1);
  return true;
}

export async function verifyWorkerIp(workerId: string): Promise<{ workerId: string; ip: string; expectedIp?: string; match: boolean } | null> {
  const w = workersState.find(x => x.id === workerId);
  if (!w) return null;
  try {
    const resp = await fetch(`${w.baseUrl}/egress-ip`);
    const data = await resp.json() as any;
    const ip = data?.ip || 'unknown';
    const match = w.expectedIp ? ip === w.expectedIp : true;
    w.lastVerifiedIp = ip;
    w.lastVerifiedAt = Date.now();
    w.status = match ? 'healthy' : 'ip-mismatch';
    return { workerId, ip, expectedIp: w.expectedIp, match };
  } catch {
    w.status = 'offline';
    return { workerId, ip: 'unreachable', expectedIp: w.expectedIp, match: false };
  }
}
