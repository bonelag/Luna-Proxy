import type {QwenAiAdapter} from '../main/proxy/adapters/qwen-ai';

export interface ChatCleanupConfig {
  enabled?: boolean;
  afterResponse?: boolean;
  scheduled?: {
    enabled?: boolean;
    mode?: 'proxy-created' | 'all';
    intervalHours?: number;
    maxAgeHours?: number;
  };
}

export class ChatCleanupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastResult: {deleted: number; failed: number; ranAt: number} | null = null;
  private cfg: ChatCleanupConfig = {};

  start(cfg: ChatCleanupConfig, getAdapter: () => QwenAiAdapter | null | undefined): void {
    this.stop();
    this.cfg = cfg || {};
    if (!cfg?.enabled || !cfg.scheduled?.enabled) return;
    const intervalMs = Math.max(Number(cfg.scheduled.intervalHours) || 1, 0.05) * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      const adapter = getAdapter();
      if (!adapter) return;
      this.runOnce(adapter).catch(err => console.error('[ChatCleanup] scheduled cleanup failed:', err));
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(adapter: QwenAiAdapter): Promise<{deleted: number; failed: number}> {
    const mode = this.cfg.scheduled?.mode || 'proxy-created';
    if (mode !== 'all') {
      const result = {deleted: 0, failed: 0, ranAt: Date.now()};
      this.lastResult = result;
      console.warn('[ChatCleanup] scheduled proxy-created cleanup skipped: adapter does not expose chat listing by title');
      return {deleted: 0, failed: 0};
    }
    const ok = await adapter.deleteAllChats();
    const result = {deleted: ok ? 1 : 0, failed: ok ? 0 : 1, ranAt: Date.now()};
    this.lastResult = result;
    return {deleted: result.deleted, failed: result.failed};
  }

  scheduleDeleteAfterResponse(chatId: string | undefined, adapter: QwenAiAdapter | null | undefined): void {
    if (!chatId || !adapter) return;
    setTimeout(() => {
      adapter.deleteChat(chatId).catch(err => console.error('[ChatCleanup] after-response delete failed:', err));
    }, 0);
  }

  status(): Record<string, any> {
    return {
      running: !!this.timer,
      lastResult: this.lastResult,
    };
  }
}

export const chatCleanupScheduler = new ChatCleanupScheduler();
