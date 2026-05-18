import type { ProviderWorker } from './types';
import { lockManager } from './locks';

export interface SelectWorkerParams {
  providerId: string;
  accountId?: string;
  networkProfileId?: string;
  workers: ProviderWorker[];
  requireVerified: boolean;
  directIp?: string;
  strictMode?: boolean;
}

export function selectWorker(params: SelectWorkerParams): ProviderWorker | undefined {
  const { providerId, accountId, networkProfileId, workers, requireVerified, directIp, strictMode } = params;

  let candidates = workers.filter(w => w.enabled !== false && w.providerId === providerId);

  if (networkProfileId) {
    candidates = candidates.filter(w => w.networkProfileId === networkProfileId);
  }

  if (accountId) {
    const exact = candidates.filter(w => w.accountId === accountId);
    if (exact.length > 0) candidates = exact;
  }

  candidates = candidates.filter(w => w.status === 'healthy' || !w.status);

  if (requireVerified) {
    candidates = candidates.filter(w => {
      if (!w.lastVerifiedIp) return false;
      if (w.expectedIp && w.lastVerifiedIp !== w.expectedIp) return false;
      if (strictMode && directIp && w.lastVerifiedIp === directIp && (!w.expectedIp || w.expectedIp === directIp)) {
        return false;
      }
      return true;
    });
  }

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => {
    const aInf = lockManager.currentCapacity(`worker:${a.id}`);
    const bInf = lockManager.currentCapacity(`worker:${b.id}`);
    return aInf - bInf;
  });

  return candidates[0];
}
