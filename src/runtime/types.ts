export type RunStatus = 'queued' | 'routing' | 'waiting_provider_chat' | 'streaming' | 'completed' | 'failed' | 'cancelled';

export interface RunContext {
  id: string;
  status: RunStatus;
  createdAt: number;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  sessionId?: string;
  providerId: string;
  accountId?: string;
  workerId?: string;
  networkProfileId?: string;
  outboundIp?: string;
  providerChatId?: string;
  model: string;
  stream: boolean;
  activeTaskPreview?: string;
  queueReason?: string;
  error?: string;
}

export interface ProviderBinding {
  providerId: string;
  accountId: string;
  providerSessionId?: string;
  purpose: 'main' | 'subagent' | 'overflow' | 'compact' | 'stateless';
  workerId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderAccount {
  id: string;
  providerId: string;
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  maxConcurrentRuns?: number;
  networkProfileId?: string;
  status?: 'active' | 'limited' | 'error' | 'disabled';
}

export interface ProviderWorker {
  id: string;
  providerId: string;
  accountId?: string;
  baseUrl: string;
  enabled: boolean;
  networkProfileId: string;
  maxConcurrentRuns: number;
  expectedIp?: string;
  lastVerifiedIp?: string;
  lastVerifiedAt?: number;
  status?: 'healthy' | 'offline' | 'ip-mismatch' | 'disabled';
}

export interface NetworkProfile {
  id: string;
  name: string;
  mode: 'worker-managed' | 'direct' | 'http-proxy' | 'https-proxy' | 'socks5' | 'local-address';
  proxyUrl?: string;
  localAddress?: string;
  expectedIp?: string;
  enabled: boolean;
  verifyIpUrl?: string;
  lastVerifiedIp?: string;
  lastVerifiedAt?: number;
}

export type LockKey = 
  | 'global'
  | `provider:${string}`
  | `account:${string}:${string}`
  | `provider-chat:${string}:${string}:${string}`
  | `session-write:${string}`
  | `session-binding:${string}`
  | `worker:${string}`;

export interface CapacitySlot {
  key: LockKey;
  acquired: boolean;
  acquiredAt?: number;
  priority: number;
}
