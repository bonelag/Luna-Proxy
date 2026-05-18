import path from 'path';
import fs from 'fs';
import os from 'os';
import { describe, it, assertEqual, assertTrue, assertFalse, printSummary } from './utils';

const originalCwd = process.cwd();
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-test-'));
const dataDir = path.join(testDir, 'data');
fs.mkdirSync(dataDir, {recursive: true});
// Change cwd AFTER creating data/ dir so module-level singleton uses testDir
process.chdir(testDir);

const mod = require('../src/sessionStore');
const SessionStore = mod.SessionStore;

describe('Section 14.2.1 — Stateless no identity', () => {
  it('does not create session when no identity provided', () => {
    const local = new SessionStore();
    const result = local.resolveSession(
      { source: 'unknown', threadId: 'stateless-test' },
      { create: false }
    );
    assertEqual(result, undefined, 'no session should be created');
    assertEqual(local.listSessions().length, 0);
  });
});

describe('Section 14.2.2 — Explicit session id', () => {
  it('creates and retrieves a persistent session by key', () => {
    const local = new SessionStore();
    const session = local.resolveSession(
      { source: 'test-client', workspace: '/test-ws', threadId: 'tab-1' },
      { create: true }
    );
    assertTrue(session !== undefined, 'session should be created');
    assertEqual(session.mode, undefined, 'persistent mode by default');
    assertTrue(!!session.id, 'session should have an id');
    const found = local.getSession(session.id);
    assertTrue(found !== undefined, 'session should be retrievable by id');
  });
});

describe('Section 14.2.3 — Source/workspace/thread identity', () => {
  it('same source+workspace+thread resolves to same session', () => {
    const local = new SessionStore();
    const s1 = local.resolveSession({ source: 'cline', workspace: '/ws1', threadId: 'thread-1' }, { create: true });
    const s2 = local.resolveSession({ source: 'cline', workspace: '/ws1', threadId: 'thread-1' }, { create: true });
    assertEqual(s1.id, s2.id, 'same key should return same session');
  });

  it('different source creates different session', () => {
    const local = new SessionStore();
    const s1 = local.resolveSession({ source: 'client-a', workspace: '/ws', threadId: 't1' }, { create: true });
    const s2 = local.resolveSession({ source: 'client-b', workspace: '/ws', threadId: 't1' }, { create: true });
    assertFalse(s1.id === s2.id, 'different source should create different sessions');
  });
});

describe('Section 14.2.4 — File-backed on overflow', () => {
  it('creates file-backed session on overflow with medium confidence', () => {
    const local = new SessionStore();
    const identity = {
      clientType: 'cline',
      workspace: '/workspace',
      fingerprint: 'test-fingerprint-1',
      activeTask: 'implement session feature',
    };
    const anchor = {
      fileName: 'overflow-test-1.txt',
      localPath: '/tmp/overflow-test-1.txt',
      createdAt: Date.now(),
      activeTaskPreview: 'implement session feature',
    };
    const session = local.resolveFileBackedSession(identity, anchor);
    assertTrue(session !== undefined, 'file-backed session should be created');
    assertEqual(session.mode, 'file-backed');
    assertEqual(session.confidence, 'medium');
  });

  it('same fingerprint with matching identity appends to existing session', () => {
    const local = new SessionStore();
    const identity = {
      clientType: 'cline',
      workspace: '/workspace',
      fingerprint: 'test-fingerprint-2',
      activeTask: 'build feature',
    };
    const anchor1 = {
      fileName: 'overflow-2a.txt',
      localPath: '/tmp/overflow-2a.txt',
      createdAt: Date.now(),
      activeTaskPreview: 'build feature',
    };
    const anchor2 = {
      fileName: 'overflow-2b.txt',
      localPath: '/tmp/overflow-2b.txt',
      createdAt: Date.now(),
      activeTaskPreview: 'build feature',
    };
    const s1 = local.resolveFileBackedSession(identity, anchor1);
    const s2 = local.resolveFileBackedSession(identity, anchor2);
    assertEqual(s1.id, s2.id, 'same fingerprint+workspace+clientType should reuse session');
    assertEqual(s1.overflowChain.length, 2, 'overflowChain should have 2 anchors');
  });
});

describe('Section 14.2.5 — Unassigned run for low confidence', () => {
  it('creates file-backed session when no existing identity', () => {
    const local = new SessionStore();
    const identity = {
      clientType: 'unknown',
      workspace: '/different-ws',
      fingerprint: 'unmatched-fingerprint',
      activeTask: 'something unrelated',
    };
    const anchor = {
      fileName: 'overflow-low.txt',
      localPath: '/tmp/overflow-low.txt',
      createdAt: Date.now(),
      activeTaskPreview: 'something unrelated',
    };
    const session = local.resolveFileBackedSession(identity, anchor);
    assertTrue(session !== undefined, 'should create new file-backed session');
    assertEqual(session.mode, 'file-backed');
  });
});

describe('Section 14.2.6 — Session diagnostics', () => {
  it('returns correct diagnostics counts', () => {
    const local = new SessionStore();
    local.resolveSession({ source: 'diag-client', workspace: '/diag', threadId: 't1' }, { create: true });
    const identity = { clientType: 'diag-client', workspace: '/diag', fingerprint: 'diag-fp', activeTask: 'test' };
    local.resolveFileBackedSession(identity, {
      fileName: 'diag-overflow.txt',
      localPath: '/tmp/diag-overflow.txt',
      createdAt: Date.now(),
      activeTaskPreview: 'test',
    });
    const diag = local.getDiagnostics();
    assertTrue(diag.totalSessions >= 2, 'should have at least 2 sessions');
    assertTrue(diag.fileBacked >= 1, 'should have at least 1 file-backed session');
  });
});

describe('Section 14.2.7 — Concurrent append with locking', () => {
  it('can append messages in parallel without corruption', async () => {
    const local = new SessionStore();
    const session = local.resolveSession({ source: 'lock-test', workspace: '/lock', threadId: 't1' }, { create: true });
    const promises = [
      local.appendMessages(session.id, [{ id: 'a', role: 'user', content: 'msg1', createdAt: Date.now() }]),
      local.appendMessages(session.id, [{ id: 'b', role: 'user', content: 'msg2', createdAt: Date.now() }]),
    ];
    await Promise.all(promises);
    const count = local.getMessageCount(session.id);
    assertEqual(count, 2, 'both messages should be appended');
  });
});

(async () => {
  printSummary();
  await new Promise(r => setTimeout(r, 100));
  process.chdir(originalCwd);
  try { fs.rmSync(testDir, {recursive: true, force: true}); } catch {}
  process.exit(0);
})();
