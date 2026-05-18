import type { ProviderAccount } from './types';
import { lockManager } from './locks';

interface RoutingRule {
  matchModel?: string;
  providerId: string;
}

interface RouterConfig {
  defaultProviderId: string;
  rules: RoutingRule[];
}

const DEFAULT_CONFIG: RouterConfig = {
  defaultProviderId: 'qwen-ai',
  rules: [{ matchModel: 'Qwen*', providerId: 'qwen-ai' }],
};

let routerConfig: RouterConfig = { ...DEFAULT_CONFIG };

export function setRouterConfig(cfg: Partial<RouterConfig>) {
  routerConfig = { ...routerConfig, ...cfg };
}

export function selectProvider(
  model: string,
  body?: Record<string, any>,
  headers?: Record<string, string>,
  availableProviders?: string[],
): string {
  const explicitFromBody = body?.provider || body?.metadata?.provider_id;
  if (explicitFromBody && (!availableProviders || availableProviders.includes(explicitFromBody))) {
    return explicitFromBody;
  }
  const explicitFromHeader = headers?.['x-luna-provider-id'];
  if (explicitFromHeader && (!availableProviders || availableProviders.includes(explicitFromHeader))) {
    return explicitFromHeader;
  }
  for (const rule of routerConfig.rules) {
    if (rule.matchModel) {
      const pattern = rule.matchModel.replace(/\*/g, '.*');
      if (new RegExp(`^${pattern}$`, 'i').test(model)) {
        if (!availableProviders || availableProviders.includes(rule.providerId)) {
          return rule.providerId;
        }
      }
    }
  }
  if (availableProviders && availableProviders.includes(routerConfig.defaultProviderId)) {
    return routerConfig.defaultProviderId;
  }
  return availableProviders?.[0] || routerConfig.defaultProviderId;
}

export function selectAccount(
  providerId: string,
  accounts: ProviderAccount[],
  preferredAccountId?: string,
  inflightByAccount?: (accountId: string) => number,
): ProviderAccount | undefined {
  const enabled = accounts.filter(a => a.providerId === providerId && a.enabled !== false && a.status !== 'disabled');
  if (enabled.length === 0) return undefined;

  if (preferredAccountId) {
    const pref = enabled.find(a => a.id === preferredAccountId);
    if (pref && pref.status !== 'error') return pref;
  }

  const scored = enabled.map(a => ({
    account: a,
    errorScore: a.status === 'error' ? 1 : 0,
    inflight: inflightByAccount ? inflightByAccount(a.id) : 0,
  }));

  scored.sort((a, b) => {
    if (a.errorScore !== b.errorScore) return a.errorScore - b.errorScore;
    if (a.inflight !== b.inflight) return a.inflight - b.inflight;
    return a.account.id.localeCompare(b.account.id);
  });

  return scored[0].account;
}

export function getAccountsFromProviderConf(providerConf: any): ProviderAccount[] {
  if (Array.isArray(providerConf.accounts) && providerConf.accounts.length > 0) {
    return providerConf.accounts.map((acc: any, i: number) => ({
      id: acc.id || `${providerConf.id}-${i}`,
      providerId: providerConf.id,
      name: acc.name || acc.id || `Account ${i + 1}`,
      enabled: acc.enabled !== false,
      credentials: acc.credentials || {},
      maxConcurrentRuns: acc.maxConcurrentRuns,
      networkProfileId: acc.networkProfileId,
      status: acc.status || 'active',
    }));
  }
  return [{
    id: providerConf.accountId || 'local',
    providerId: providerConf.id,
    name: providerConf.name || 'local',
    enabled: true,
    credentials: providerConf.credentials || {},
    maxConcurrentRuns: providerConf.maxConcurrentRuns,
    networkProfileId: providerConf.networkProfileId,
    status: 'active' as const,
  }];
}
