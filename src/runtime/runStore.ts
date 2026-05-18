import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { RunContext, RunStatus } from './types';

export class RunStore {
  private runs: RunContext[] = [];
  private filePath: string;
  private maxRuns = 2000;

  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'runs.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.runs = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch {}
  }

  private save() {
    try {
      const toSave = this.runs.slice(-this.maxRuns);
      const tmp = this.filePath + '.tmp.' + crypto.randomUUID().slice(0, 8);
      fs.writeFileSync(tmp, JSON.stringify(toSave, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch {}
  }

  createRun(props: Partial<RunContext> & { model: string; stream: boolean }): RunContext {
    const now = Date.now();
    const run: RunContext = {
      ...props,
      id: crypto.randomUUID(),
      status: props.status || 'queued',
      createdAt: now,
      queuedAt: now,
      providerId: props.providerId || 'qwen-ai',
      model: props.model,
      stream: props.stream,
    };
    this.runs.push(run);
    this.save();
    return run;
  }

  getRun(id: string): RunContext | undefined {
    return this.runs.find(r => r.id === id);
  }

  listRuns(limit = 200): RunContext[] {
    return this.runs.slice(-limit).reverse();
  }

  updateRun(runId: string, updates: Partial<RunContext>): RunContext | undefined {
    const run = this.getRun(runId);
    if (!run) return undefined;
    Object.assign(run, updates);
    if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
      run.completedAt = Date.now();
    }
    if (updates.status === 'streaming' && !run.startedAt) {
      run.startedAt = Date.now();
    }
    this.save();
    return run;
  }

  cancelRun(runId: string): RunContext | undefined {
    return this.updateRun(runId, { status: 'cancelled', completedAt: Date.now() });
  }

  getActiveRuns(): RunContext[] {
    const active: RunStatus[] = ['queued', 'routing', 'waiting_provider_chat', 'streaming'];
    return this.runs.filter(r => active.includes(r.status));
  }

  getRunsBySession(sessionId: string): RunContext[] {
    return this.runs.filter(r => r.sessionId === sessionId).slice(-50);
  }

  getRunsByProviderChat(providerId: string, accountId: string, chatId: string): RunContext[] {
    return this.runs.filter(r =>
      r.providerId === providerId && r.accountId === accountId && r.providerChatId === chatId
    );
  }
}

export const runStore = new RunStore();
export default runStore;
