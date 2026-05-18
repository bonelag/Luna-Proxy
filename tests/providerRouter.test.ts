import { describe, it, assertEqual, assertTrue, printSummary, flushAsync } from './utils';

const router = require('../src/runtime/providerRouter');

describe('ProviderRouter — selectProvider', () => {
  it('selects provider from body', () => {
    const pid = router.selectProvider('Qwen2.5-72B', { provider: 'custom-provider' }, {});
    assertEqual(pid, 'custom-provider');
  });

  it('selects provider from header', () => {
    const pid = router.selectProvider('Qwen2.5-72B', {}, { 'x-luna-provider-id': 'header-provider' });
    assertEqual(pid, 'header-provider');
  });

  it('falls back to default when no explicit', () => {
    const pid = router.selectProvider('unknown-model');
    assertEqual(pid, 'qwen-ai');
  });

  it('matches model glob pattern', () => {
    const pid = router.selectProvider('Qwen3-120B');
    assertEqual(pid, 'qwen-ai');
  });

  it('respects availableProviders filter', () => {
    const pid = router.selectProvider('Qwen2.5-72B', {}, {}, ['other-provider']);
    assertEqual(pid, 'other-provider');
  });

  it('returns default from available list', () => {
    router.setRouterConfig({ defaultProviderId: 'qwen-ai', rules: [] });
    const pid = router.selectProvider('gpt-4', {}, {}, ['qwen-ai', 'gpt-fake']);
    assertEqual(pid, 'qwen-ai');
  });

  it('returns first available if default not in list', () => {
    const pid = router.selectProvider('gpt-4', {}, {}, ['gpt-fake', 'claude']);
    assertEqual(pid, 'gpt-fake');
  });
});

describe('ProviderRouter — selectAccount', () => {
  const accounts = [
    { id: 'acc-a', providerId: 'p1', name: 'A', enabled: true, credentials: {}, status: 'active' as const },
    { id: 'acc-b', providerId: 'p1', name: 'B', enabled: true, credentials: {}, status: 'error' as const },
    { id: 'acc-c', providerId: 'p1', name: 'C', enabled: false, credentials: {}, status: 'active' as const },
    { id: 'acc-d', providerId: 'p1', name: 'D', enabled: true, credentials: {}, status: 'active' as const },
    { id: 'acc-e', providerId: 'p2', name: 'E', enabled: true, credentials: {}, status: 'active' as const },
  ];

  it('filters by providerId and enabled', () => {
    const sel = router.selectAccount('p1', accounts);
    assertTrue(sel !== undefined);
    assertEqual(sel!.id, 'acc-a');
  });

  it('prefers non-error accounts', () => {
    const sel = router.selectAccount('p1', accounts, 'acc-b');
    assertTrue(sel !== undefined);
    assertEqual(sel!.id, 'acc-a', 'should skip error account even if preferred');
  });

  it('returns undefined when no enabled accounts', () => {
    const sel = router.selectAccount('p2', [{ id: 'x', providerId: 'p2', name: 'X', enabled: false, credentials: {}, status: 'disabled' as const }]);
    assertEqual(sel, undefined);
  });

  it('sorts by inflight ascending', () => {
    const sel = router.selectAccount('p1', accounts, undefined, (aid: string) => aid === 'acc-d' ? 0 : 10);
    assertEqual(sel!.id, 'acc-d', 'should pick lowest inflight');
  });

  it('returns preferred non-error account', () => {
    const sel = router.selectAccount('p1', accounts, 'acc-a');
    assertEqual(sel!.id, 'acc-a');
  });
});

describe('ProviderRouter — getAccountsFromProviderConf', () => {
  it('returns single account when no accounts array', () => {
    const conf = { id: 'p1', name: 'Test Provider', credentials: { apiKey: 'sk-123' } };
    const accounts = router.getAccountsFromProviderConf(conf);
    assertEqual(accounts.length, 1);
    assertEqual(accounts[0].id, 'local');
    assertEqual(accounts[0].providerId, 'p1');
  });

  it('returns mapped accounts when accounts array present', () => {
    const conf = {
      id: 'p1',
      accounts: [
        { id: 'acc-1', name: 'Account 1', credentials: { token: 't1' }, maxConcurrentRuns: 3 },
        { id: 'acc-2', credentials: { token: 't2' } },
      ],
    };
    const accounts = router.getAccountsFromProviderConf(conf);
    assertEqual(accounts.length, 2);
    assertEqual(accounts[0].id, 'acc-1');
    assertEqual(accounts[0].name, 'Account 1');
    assertEqual(accounts[0].credentials.token, 't1');
    assertEqual(accounts[0].maxConcurrentRuns, 3);
    assertEqual(accounts[1].id, 'acc-2');
    assertEqual(accounts[1].name, 'acc-2', 'should fallback to id');
  });
});

(async () => {
  await flushAsync();
  printSummary();
  process.exit(0);
})();
