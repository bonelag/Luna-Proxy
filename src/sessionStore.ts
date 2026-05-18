import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ProviderBinding } from './runtime/types';

export interface SessionMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  createdAt: number;
  tokenEstimate?: number;
  requestId?: string;
  runId?: string;
  providerId?: string;
  accountId?: string;
  workerId?: string;
  providerSessionId?: string;
}

export interface OverflowAnchor {
  fileName: string;
  localPath: string;
  uploadedFileId?: string;
  uploadedUrl?: string;
  activeTaskPreview?: string;
  createdAt: number;
  tokenEstimate?: number;
}

export interface StoredSession {
  id: string;
  source: string;
  workspace?: string;
  threadId: string;
  title?: string;
  model?: string;
  providerId: 'qwen-ai';
  providerSessionId?: string;
  summary?: string;
  mode?: 'persistent' | 'transient' | 'file-backed' | 'shared-default' | 'stateless';
  profileId?: string;
  fingerprint?: string;
  confidence?: 'high' | 'medium' | 'low';
  overflowChain?: OverflowAnchor[];
  providerBindings?: ProviderBinding[];
  activeRunIds?: string[];
  messages: SessionMessage[];
  compactedAt?: number;
  createdAt: number;
  updatedAt: number;
  lastRequestAt?: number;
  active: boolean;
  resolveReason?: string;
}

export interface SessionKey {
  source: string;
  workspace?: string;
  threadId: string;
}

export interface SessionIdentity {
  sessionId?: string;
  profileId?: string;
  clientType?: string;
  clientInstanceId?: string;
  workspace?: string;
  tabId?: string;
  threadId?: string;
  fingerprint?: string;
  activeTask?: string;
  visibleFiles?: string[];
  toolResultFilePaths?: string[];
}

export interface ConfidenceResult {
  score: number;
  level: 'high' | 'medium' | 'low';
}

type SessionData = Record<string, StoredSession>;

export class SessionStore {
  private filePath: string;
  private data: SessionData;
  private locks = new Map<string, Promise<void>>();
  private seenRequestIds = new Set<string>();

  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.join(dataDir, 'sessions.json');
    this.data = this.load();
  }

  async withSessionLock<T>(sessionId: string, fn: () => Promise<T> | T): Promise<T> {
    while (this.locks.has(sessionId)) {
      await this.locks.get(sessionId);
    }
    const prev = this.locks.get(sessionId);
    const promise = (async () => {
      if (prev) await prev;
      try {
        return await fn();
      } finally {
        this.locks.delete(sessionId);
      }
    })();
    this.locks.set(sessionId, promise.then(() => {}));
    return promise;
  }

  private atomicSave(data?: SessionData) {
    const toSave = data ?? this.data;
    const tmpPath = this.filePath + '.tmp.' + crypto.randomUUID().slice(0, 8);
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(toSave, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
      console.error('[SessionStore] atomicSave failed:', err);
    }
  }

  private load(): SessionData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(raw) as SessionData;
      }
    } catch (err) {
      console.error('[SessionStore] Failed to load sessions:', err);
    }
    return {};
  }

  reload() {
    this.data = this.load();
    console.log('[SessionStore] Reloaded from disk, sessions:', Object.keys(this.data).length);
  }

  save() {
    this.atomicSave();
  }

  clearAll() {
    this.data = {};
    this.save();
    console.log('[SessionStore] Cleared all sessions');
  }

  private keyFromSessionKey(input: SessionKey): string {
    return `${input.source}::${input.workspace || ''}::${input.threadId}`;
  }

  private keyFromIdentity(input: SessionIdentity): string {
    const parts: string[] = [];
    if (input.profileId) parts.push(`profile=${input.profileId}`);
    if (input.fingerprint) parts.push(`fingerprint=${input.fingerprint}`);
    if (input.clientType) parts.push(`client=${input.clientType}`);
    if (input.workspace) parts.push(`ws=${input.workspace}`);
    if (input.tabId) parts.push(`tab=${input.tabId}`);
    if (input.threadId) parts.push(`thread=${input.threadId}`);
    if (parts.length === 0) parts.push('unknown');
    return parts.join('::');
  }

  getKeyForSessionId(sessionId: string): string | undefined {
    for (const [key, s] of Object.entries(this.data)) {
      if (s.id === sessionId) return key;
    }
    return undefined;
  }

  updateSessionKey(sessionId: string, nextKey: SessionKey): Promise<StoredSession | undefined> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return undefined;
      const oldKey = this.getKeyForSessionId(sessionId);
      const newKeyStr = this.keyFromSessionKey(nextKey);
      if (oldKey === newKeyStr) {
        session.source = nextKey.source;
        if (nextKey.workspace !== undefined) session.workspace = nextKey.workspace;
        session.threadId = nextKey.threadId;
        session.updatedAt = Date.now();
        this.save();
        return session;
      }
      if (this.data[newKeyStr]) {
        console.warn('[SessionStore] updateSessionKey: target key already exists, merging', oldKey, '->', newKeyStr);
      }
      session.source = nextKey.source;
      if (nextKey.workspace !== undefined) session.workspace = nextKey.workspace;
      session.threadId = nextKey.threadId;
      session.updatedAt = Date.now();
      if (oldKey) delete this.data[oldKey];
      this.data[newKeyStr] = session;
      this.save();
      console.log('[SessionStore] Re-keyed session', sessionId, oldKey, '->', newKeyStr);
      return session;
    });
  }

  resolveSession(input: SessionKey, options?: {create?: boolean}): StoredSession | undefined {
    const key = this.keyFromSessionKey(input);
    const existing = this.data[key];
    if (existing) {
      existing.updatedAt = Date.now();
      this.save();
      return existing;
    }
    if (options?.create === false) return undefined;
    const session: StoredSession = {
      id: crypto.randomUUID(),
      source: input.source,
      workspace: input.workspace,
      threadId: input.threadId,
      providerId: 'qwen-ai',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
    };
    this.data[key] = session;
    this.save();
      console.log('[SessionStore] Created session:', session.id, 'for', key);
    return session;
  }

  private findFileBackedSessions(identity: SessionIdentity): StoredSession[] {
    const baseKey = this.keyFromIdentity(identity);
    const results: StoredSession[] = [];
    for (const [key, session] of Object.entries(this.data)) {
      if (key === baseKey || key.startsWith(baseKey + '::')) {
        results.push(session);
      }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  resolveFileBackedSession(
    identity: SessionIdentity,
    overflowAnchor: OverflowAnchor,
  ): StoredSession | undefined {
    const existing = this.findFileBackedSessions(identity);
    if (existing.length > 0) {
      const { level } = this.computeConfidence(identity, existing[0]);
      if (level === 'high' || level === 'medium') {
        const session = existing[0];
        session.updatedAt = Date.now();
        if (!session.overflowChain) session.overflowChain = [];
        session.overflowChain.push(overflowAnchor);
        session.confidence = level;
        session.fingerprint = identity.fingerprint || session.fingerprint;
        if (identity.profileId) session.profileId = identity.profileId;
        this.save();
        return session;
      }
    }
    const baseKey = this.keyFromIdentity(identity);
    const uniqueKey = identity.fingerprint
      ? `${baseKey}::${Date.now().toString(36)}`
      : baseKey;
    const session: StoredSession = {
      id: crypto.randomUUID(),
      source: identity.clientType || 'file-backed',
      workspace: identity.workspace,
      threadId: identity.threadId || 'auto',
      providerId: 'qwen-ai',
      mode: 'file-backed',
      profileId: identity.profileId,
      fingerprint: identity.fingerprint,
      confidence: 'medium',
      overflowChain: [overflowAnchor],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
      resolveReason: 'file-backed:medium',
    };
    this.data[uniqueKey] = session;
    this.save();
    console.log('[SessionStore] Created file-backed session:', session.id, 'medium', uniqueKey);
    return session;
  }

  private stringSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const normA = a.toLowerCase().trim();
    const normB = b.toLowerCase().trim();
    if (normA === normB) return 1;
    if (normA.length < 2 || normB.length < 2) {
      return normA.includes(normB) || normB.includes(normA) ? 0.5 : 0;
    }
    const toBigrams = (s: string): Set<string> => {
      const set = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const gramsA = toBigrams(normA);
    const gramsB = toBigrams(normB);
    let intersection = 0;
    for (const g of gramsA) { if (gramsB.has(g)) intersection++; }
    const union = gramsA.size + gramsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  computeConfidence(identity: SessionIdentity, existing?: StoredSession): ConfidenceResult {
    let score = 0;
    if (identity.profileId && existing?.profileId === identity.profileId) score += 50;
    if (identity.workspace && existing?.workspace === identity.workspace) score += 25;
    if (identity.clientType && existing?.source === identity.clientType) score += 10;
    if (identity.activeTask && existing?.overflowChain && existing.overflowChain.length > 0) {
      const lastTask = existing.overflowChain[existing.overflowChain.length - 1]?.activeTaskPreview;
      if (lastTask && this.stringSimilarity(identity.activeTask, lastTask) > 0.85) score += 20;
    }
    const level: 'high' | 'medium' | 'low' = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
    return { score, level };
  }

  cleanupExpired(maxAge?: number): number {
    const age = maxAge ?? 86400000 * 7;
    const now = Date.now();
    const toDelete: string[] = [];
    for (const [key, session] of Object.entries(this.data)) {
      const lastActive = Math.max(session.updatedAt, session.lastRequestAt ?? 0, session.createdAt);
      if (now - lastActive > age) toDelete.push(key);
    }
    for (const key of toDelete) delete this.data[key];
    if (toDelete.length > 0) this.save();
    return toDelete.length;
  }

  getSessionByFileBackedKey(identity: SessionIdentity): StoredSession | undefined {
    const key = this.keyFromIdentity(identity);
    return this.data[key];
  }

  resolveSessionWithIdentity(identity: SessionIdentity, options?: {create?: boolean}): StoredSession | undefined {
    if (identity.sessionId) {
      const byId = this.getSession(identity.sessionId);
      if (byId) return byId;
    }
    if (identity.profileId || identity.fingerprint) {
      const key = this.keyFromIdentity(identity);
      const existing = this.data[key];
      if (existing) {
        existing.updatedAt = Date.now();
        this.save();
        return existing;
      }
    }
    return undefined;
  }

  getSession(sessionId: string): StoredSession | undefined {
    return Object.values(this.data).find(s => s.id === sessionId);
  }

  getSessionByKey(key: SessionKey): StoredSession | undefined {
    return this.data[this.keyFromSessionKey(key)];
  }

  listSessions(): StoredSession[] {
    return Object.values(this.data).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSessionsByMode(mode: string): StoredSession[] {
    return Object.values(this.data).filter(s => s.mode === mode || (!s.mode && mode === 'persistent'));
  }

  deleteSession(sessionId: string): Promise<boolean> {
    return this.withSessionLock(sessionId, () => {
      const entries = Object.entries(this.data);
      const entry = entries.find(([, s]) => s.id === sessionId);
      if (!entry) return false;
      delete this.data[entry[0]];
      this.save();
      return true;
    });
  }

  clearSession(sessionId: string): Promise<boolean> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return false;
      session.messages = [];
      session.summary = undefined;
      session.compactedAt = undefined;
      session.providerSessionId = undefined;
      session.updatedAt = Date.now();
      this.save();
      return true;
    });
  }

  resetProviderSessionId(sessionId: string, purpose?: string): Promise<boolean> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return false;
      if (purpose) {
        if (session.providerBindings) {
          session.providerBindings = session.providerBindings.filter(b => b.purpose !== purpose);
        }
        if (purpose === 'main') session.providerSessionId = undefined;
      } else {
        session.providerBindings = [];
        session.providerSessionId = undefined;
      }
      session.updatedAt = Date.now();
      this.save();
      return true;
    });
  }

  renameSession(sessionId: string, title: string): Promise<boolean> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return false;
      session.title = title;
      session.updatedAt = Date.now();
      this.save();
      return true;
    });
  }

  appendMessages(sessionId: string, msgs: SessionMessage[]): Promise<void> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return;
      session.messages.push(...msgs);
      session.updatedAt = Date.now();
      this.save();
    });
  }

  setProviderSessionId(sessionId: string, chatId: string): Promise<void> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return;
      session.providerSessionId = chatId;
      session.updatedAt = Date.now();
      this.save();
    });
  }

  setSummary(sessionId: string, summary: string): Promise<void> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return;
      session.summary = summary;
      session.compactedAt = Date.now();
      session.updatedAt = Date.now();
      this.save();
    });
  }

  setModel(sessionId: string, model: string) {
    const session = this.getSession(sessionId);
    if (!session) return;
    session.model = model;
    this.save();
  }

  setSourceMetadata(sessionId: string, source: string, workspace?: string, threadId?: string) {
    const session = this.getSession(sessionId);
    if (!session) return;
    const oldKey = this.getKeyForSessionId(sessionId);
    session.source = source;
    if (workspace !== undefined) session.workspace = workspace;
    if (threadId !== undefined) session.threadId = threadId;
    const newKey = this.keyFromSessionKey({source, workspace: session.workspace, threadId: session.threadId});
    if (oldKey && oldKey !== newKey) {
      if (oldKey) delete this.data[oldKey];
      this.data[newKey] = session;
      console.log('[SessionStore] Re-keyed (setSourceMetadata)', sessionId, oldKey, '->', newKey);
    }
    session.updatedAt = Date.now();
    this.save();
  }

  async withProviderBindingLock<T>(sessionId: string, fn: () => Promise<T> | T): Promise<T> {
    return this.withSessionLock(sessionId, fn);
  }

  addProviderBinding(sessionId: string, binding: ProviderBinding): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    if (!session.providerBindings) session.providerBindings = [];
    const idx = session.providerBindings.findIndex(
      b => b.providerId === binding.providerId && b.accountId === binding.accountId && b.purpose === binding.purpose
    );
    if (idx >= 0) session.providerBindings[idx] = binding;
    else session.providerBindings.push(binding);
    if (binding.purpose === 'main') {
      session.providerSessionId = binding.providerSessionId;
    }
    session.updatedAt = Date.now();
    this.save();
  }

  async upsertProviderBinding(sessionId: string, binding: ProviderBinding): Promise<void> {
    return this.withProviderBindingLock(sessionId, () => {
      this.addProviderBinding(sessionId, binding);
    });
  }

  getProviderBinding(sessionId: string, providerId: string, accountId: string, purpose: string): ProviderBinding | undefined {
    const session = this.getSession(sessionId);
    return session?.providerBindings?.find(
      b => b.providerId === providerId && b.accountId === accountId && b.purpose === purpose
    );
  }

  clearProviderBindings(sessionId: string): Promise<void> {
    return this.withProviderBindingLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return;
      session.providerBindings = [];
      session.providerSessionId = undefined;
      session.updatedAt = Date.now();
      this.save();
    });
  }

  addActiveRunId(sessionId: string, runId: string): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    if (!session.activeRunIds) session.activeRunIds = [];
    if (!session.activeRunIds.includes(runId)) session.activeRunIds.push(runId);
    session.updatedAt = Date.now();
    this.save();
  }

  removeActiveRunId(sessionId: string, runId: string): void {
    const session = this.getSession(sessionId);
    if (!session || !session.activeRunIds) return;
    session.activeRunIds = session.activeRunIds.filter(id => id !== runId);
    session.updatedAt = Date.now();
    this.save();
  }

  trimHistory(sessionId: string, historyLimit: number): Promise<void> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return;
      if (session.messages.length > historyLimit) {
        session.messages = session.messages.slice(-historyLimit);
        session.updatedAt = Date.now();
        this.save();
      }
    });
  }

  setMode(sessionId: string, mode: 'persistent' | 'transient' | 'file-backed' | 'shared-default' | 'stateless'): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    session.mode = mode;
    session.updatedAt = Date.now();
    this.save();
  }

  appendOverflowAnchor(sessionId: string, anchor: OverflowAnchor): Promise<void> {
    return this.withSessionLock(sessionId, () => {
      const session = this.getSession(sessionId);
      if (!session) return;
      if (!session.overflowChain) session.overflowChain = [];
      const maxChain = 20;
      session.overflowChain.push(anchor);
      if (session.overflowChain.length > maxChain) {
        session.overflowChain = session.overflowChain.slice(-maxChain);
      }
      session.updatedAt = Date.now();
      this.save();
    });
  }

  getOverflowChain(sessionId: string): OverflowAnchor[] {
    const session = this.getSession(sessionId);
    return session?.overflowChain || [];
  }

  getRecentMessages(sessionId: string, count: number): SessionMessage[] {
    const session = this.getSession(sessionId);
    if (!session) return [];
    return session.messages.slice(-count);
  }

  getMessageCount(sessionId: string): number {
    const session = this.getSession(sessionId);
    return session ? session.messages.length : 0;
  }

  getDiagnostics(): Record<string, any> {
    const allSessions = this.listSessions();
    return {
      totalSessions: allSessions.length,
      persistent: allSessions.filter(s => s.mode === 'persistent' || (!s.mode)).length,
      fileBacked: allSessions.filter(s => s.mode === 'file-backed').length,
      transient: allSessions.filter(s => s.mode === 'transient').length,
      sharedDefault: allSessions.filter(s => s.mode === 'shared-default').length,
      sessionsWithOverflowChain: allSessions.filter(s => s.overflowChain && s.overflowChain.length > 0).length,
      dataFilePath: this.filePath,
    };
  }

  ingestRequestId(requestId: string): boolean {
    if (this.seenRequestIds.has(requestId)) return false;
    this.seenRequestIds.add(requestId);
    if (this.seenRequestIds.size > 10000) {
      const arr = Array.from(this.seenRequestIds);
      this.seenRequestIds = new Set(arr.slice(-5000));
    }
    return true;
  }

  startCleanupInterval(intervalMs?: number): void {
    setInterval(() => {
      const removed = this.cleanupExpired();
      if (removed > 0) {
        console.log(`[SessionStore] Cleaned up ${removed} expired sessions`);
      }
    }, intervalMs ?? 600000);
  }
}

export const sessionStore = new SessionStore();
export default sessionStore;
