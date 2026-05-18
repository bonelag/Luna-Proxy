import type { ProviderAccount, NetworkProfile } from './types';
import type { Provider, Account } from '../main/store/types';

export interface ProviderAdapter {
  chatCompletion(request: any): Promise<{ response: any; chatId?: string }>;
  mapModel?(model: string): string;
  getLastWireDebug?(): Record<string, any> | null;
}

interface CreateAdapterParams {
  providerId: string;
  account: ProviderAccount;
  settings?: Record<string, any>;
  networkProfile?: NetworkProfile;
}

export function createAdapter(params: CreateAdapterParams): ProviderAdapter {
  const { providerId, account, networkProfile } = params;

  if (networkProfile && networkProfile.mode !== 'direct' && networkProfile.mode !== 'worker-managed') {
    throw new Error(
      `Network profile mode "${networkProfile.mode}" is not supported in direct adapter yet. Use "direct" or "worker-managed".`,
    );
  }

  if (providerId === 'qwen-ai') {
    const provider: Provider = {
      id: 'qwen-ai',
      apiEndpoint: 'https://chat.qwen.ai',
      chatPath: '/api/v2/chat/completions',
    };
    const acc: Account = {
      id: account.id,
      providerId,
      name: account.name,
      credentials: account.credentials,
    };
    const mod = require('../main/proxy/adapters/qwen-ai');
    const adapter = new mod.QwenAiAdapter(provider, acc);
    return adapter as ProviderAdapter;
  }

  throw new Error(`No adapter available for provider: ${providerId}`);
}
