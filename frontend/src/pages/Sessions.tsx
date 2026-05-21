import React, {useEffect, useMemo, useState} from 'react';

type SessionSummary = {
  id: string;
  source: string;
  workspace?: string;
  threadId: string;
  title?: string;
  model?: string;
  mode?: string;
  profileId?: string;
  fingerprint?: string;
  confidence?: string;
  providerSessionId?: string;
  messageCount: number;
  overflowChain?: Array<{fileName: string; createdAt: number}>;
  summary?: string;
  compactedAt?: number;
  createdAt: number;
  updatedAt: number;
  lastRequestAt?: number;
  active: boolean;
};
const LIST_BATCH_SIZE = 50;

type ProviderBinding = {
  providerId: string;
  accountId: string;
  providerSessionId?: string;
  purpose: string;
  workerId?: string;
  createdAt: number;
  updatedAt: number;
};

type SessionDetail = SessionSummary & {
  messages: Array<{id: string; role: string; content: any; createdAt: number; runId?: string; providerId?: string; accountId?: string}>;
  providerBindings?: ProviderBinding[];
  activeRunIds?: string[];
  activeRunDetails?: Array<{id: string; status: string; model: string; startedAt?: number}>;
};

type Diagnostics = {
  sessionEnabled: boolean;
  requireExplicitId: boolean;
  fallbackMode: string;
  totalSessions: number;
  fileBacked: number;
  persistent: number;
  transient: number;
  stats: {
    persistent: number;
    transient?: number;
    fileBacked?: number;
    indexed?: number;
    summarized?: number;
    statelessHint?: string;
  };
  dataFile: {
    path: string;
    exists: boolean;
    parseable: boolean;
  };
};

export default function Sessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filterSource, setFilterSource] = useState<string>('all');
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [visibleCount, setVisibleCount] = useState(LIST_BATCH_SIZE);

  useEffect(() => {
    loadSessions();
    loadDiagnostics();
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  async function loadDiagnostics() {
    try {
      const res = await fetch('/api/sessions/diagnostics');
      if (res.ok) setDiagnostics(await res.json());
    } catch {
      // ignore
    }
  }

  async function loadSessions() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions(await res.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/sessions/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(await res.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load session detail');
    } finally {
      setDetailLoading(false);
    }
  }

  async function deleteSession(id: string) {
    if (!confirm('Delete this session?')) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, {method: 'DELETE'});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
      await loadSessions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete');
    }
  }

  async function clearSession(id: string) {
    if (!confirm('Clear history for this session?')) return;
    try {
      const res = await fetch(`/api/sessions/${id}/clear`, {method: 'POST'});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadDetail(id);
      await loadSessions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to clear');
    }
  }

  async function compactSession(id: string) {
    setMessage('Compacting...');
    try {
      const res = await fetch(`/api/sessions/${id}/compact`, {method: 'POST'});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('Compact complete');
      await loadDetail(id);
      await loadSessions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Compact failed');
    }
  }

  async function renameSession(id: string) {
    const title = prompt('New title:');
    if (!title) return;
    try {
      const res = await fetch(`/api/sessions/${id}/rename`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadSessions();
      if (selectedId === id) await loadDetail(id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Rename failed');
    }
  }

  const sources = Array.from(new Set(sessions.map(s => s.source)));
  const filtered = useMemo(
    () => filterSource === 'all'
      ? sessions
      : sessions.filter(s => s.source === filterSource),
    [filterSource, sessions],
  );
  const renderedSessions = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(LIST_BATCH_SIZE);
  }, [filterSource, sessions]);

  function handleListScroll(event: React.UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining < 160 && visibleCount < filtered.length) {
      setVisibleCount(count => Math.min(count + LIST_BATCH_SIZE, filtered.length));
    }
  }

  return (
    <section aria-labelledby="sessions-title" className="page-panel sessions-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Conversation sessions</p>
          <h2 id="sessions-title">Sessions</h2>
        </div>
        <div className="action-row">
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} aria-label="Filter by source">
            <option value="all">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={loadSessions} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
          <button className="danger" onClick={async () => {
            if (!confirm('Clear ALL sessions?')) return;
            await fetch('/api/sessions', {method: 'DELETE'});
            setSelectedId(null);
            setDetail(null);
            await loadSessions();
          }}>Xóa</button>
          <button onClick={async () => {
            await fetch('/api/sessions/reload', {method: 'POST'});
            await loadSessions();
            setMessage('Sessions reloaded from disk');
          }}>Reload</button>
        </div>
      </div>

      {message ? <p className="muted">{message}</p> : null}
      {!loading && filtered.length === 0 && diagnostics ? (
        <div className="surface-card" style={{marginBottom: 16, padding: 16}}>
          <h4 style={{marginBottom: 8}}>Why is this empty?</h4>
          {!diagnostics.sessionEnabled ? (
            <p className="muted">Session memory is disabled in Settings. Enable "Session Memory" to start tracking conversations.</p>
          ) : diagnostics.fallbackMode === 'stateless' ? (
            <div>
              <p className="muted">Session memory is in <strong>stateless</strong> mode. No sessions are stored unless the client sends an explicit session ID (<code>x-luna-session-id</code> header or <code>session_id</code> in the request body).</p>
              <p className="muted" style={{marginTop: 8}}>The API clients you are using may not provide session metadata. Try switching Settings → Session → Fallback Mode to <strong>file-backed</strong> to auto-create sessions when overflow files are generated.</p>
              <details style={{marginTop: 12}}>
                <summary style={{cursor: 'pointer', color: 'var(--color-text-secondary)'}}>Diagnostics</summary>
                <dl className="detail-grid" style={{marginTop: 8, fontSize: '0.85em'}}>
                  <dt>Config enabled</dt><dd>{String(diagnostics.sessionEnabled)}</dd>
                  <dt>Fallback mode</dt><dd>{diagnostics.fallbackMode}</dd>
                  <dt>Require explicit ID</dt><dd>{String(diagnostics.requireExplicitId)}</dd>
                  <dt>Total sessions on disk</dt><dd>{diagnostics.totalSessions}</dd>
                  <dt>Persistent</dt><dd>{diagnostics.persistent ?? diagnostics.stats?.persistent ?? '-'}</dd>
                  <dt>File-backed</dt><dd>{diagnostics.fileBacked ?? diagnostics.stats?.fileBacked ?? '-'}</dd>
                  <dt>Transient</dt><dd>{diagnostics.transient ?? diagnostics.stats?.transient ?? '-'}</dd>
                  <dt>Data file exists</dt><dd>{String(diagnostics.dataFile.exists)}</dd>
                  <dt>Data file parseable</dt><dd>{String(diagnostics.dataFile.parseable)}</dd>
                </dl>
              </details>
            </div>
          ) : diagnostics.fallbackMode === 'file-backed' ? (
            <div>
              <p className="muted">Session memory is in <strong>file-backed</strong> mode. Sessions are only created when overflow files are generated (i.e., when the conversation exceeds the token threshold). Before overflow, all requests are stateless.</p>
              <p className="muted" style={{marginTop: 8}}>If you have not seen any overflow files, no file-backed sessions will appear. Once a conversation triggers overflow, a file-backed session will be created and visible here.</p>
              <details style={{marginTop: 12}}>
                <summary style={{cursor: 'pointer', color: 'var(--color-text-secondary)'}}>Diagnostics</summary>
                <dl className="detail-grid" style={{marginTop: 8, fontSize: '0.85em'}}>
                  <dt>Config enabled</dt><dd>{String(diagnostics.sessionEnabled)}</dd>
                  <dt>Fallback mode</dt><dd>{diagnostics.fallbackMode}</dd>
                  <dt>Require explicit ID</dt><dd>{String(diagnostics.requireExplicitId)}</dd>
                  <dt>Total sessions on disk</dt><dd>{diagnostics.totalSessions}</dd>
                  <dt>File-backed</dt><dd>{diagnostics.fileBacked ?? diagnostics.stats?.fileBacked ?? '-'}</dd>
                  <dt>Persistent</dt><dd>{diagnostics.persistent ?? diagnostics.stats?.persistent ?? '-'}</dd>
                  <dt>Transient</dt><dd>{diagnostics.transient ?? diagnostics.stats?.transient ?? '-'}</dd>
                  <dt>Data file exists</dt><dd>{String(diagnostics.dataFile.exists)}</dd>
                  <dt>Data file parseable</dt><dd>{String(diagnostics.dataFile.parseable)}</dd>
                </dl>
              </details>
            </div>
          ) : (
            <p className="muted">No sessions found. Total on disk: {diagnostics.totalSessions}. File exists: {String(diagnostics.dataFile.exists)}.</p>
          )}
        </div>
      ) : null}

      <div className="table-wrap list-scroll" onScroll={handleListScroll}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Title / ID</th>
              <th>Mode</th>
              <th>Source</th>
              <th>Workspace</th>
              <th>Thread</th>
              <th>Model</th>
              <th>Messages</th>
              <th>Overflow</th>
              <th>Provider Chat</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {renderedSessions.map(s => (
              <tr
                key={s.id}
                className={`clickable-row ${selectedId === s.id ? 'selected-row' : ''}`}
                onClick={() => setSelectedId(s.id)}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(s.id); }}
              >
                <td>{s.title || s.id.slice(0, 8) + '...'}</td>
                <td><span className={`status-pill status-${s.mode === 'file-backed' ? 'warn' : s.mode === 'persistent' || !s.mode ? 'alive' : 'dead'}`}>{s.mode || 'persistent'}</span></td>
                <td>{s.source}</td>
                <td>{s.workspace || '-'}</td>
                <td>{s.threadId}</td>
                <td>{s.model || '-'}</td>
                <td>{s.messageCount}</td>
                <td>{s.overflowChain?.length ? s.overflowChain.length : '-'}</td>
                <td>{s.providerSessionId ? s.providerSessionId.slice(0, 8) + '...' : '-'}</td>
                <td>{new Date(s.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > renderedSessions.length ? (
        <p className="muted list-lazy-status">Showing {renderedSessions.length} of {filtered.length}. Scroll to load more.</p>
      ) : null}

      {detailLoading ? <p className="muted">Loading detail...</p> : null}

      {detail && !detailLoading ? (
        <div className="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="session-detail-title">
          <aside className="detail-panel">
          <button className="modal-close-btn" aria-label="Close session detail" onClick={() => { setSelectedId(null); setDetail(null); }}>×</button>
          <div className="detail-heading">
            <p className="eyebrow">Session detail</p>
            <h3 id="session-detail-title">{detail.title || detail.id.slice(0, 8) + '...'}</h3>
            <p className="muted">{new Date(detail.updatedAt).toLocaleString()}</p>
          </div>
          <div className="surface-card-head">
            <div className="action-row">
              <button onClick={() => renameSession(detail.id)}>Rename</button>
              <button onClick={() => compactSession(detail.id)}>Compact</button>
              <button onClick={() => clearSession(detail.id)}>Clear</button>
              <button onClick={async () => {
                const res = await fetch(`/api/sessions/${detail.id}/reset-provider`, {method: 'POST'});
                if (res.ok) { setMessage('Provider chat ID reset'); await loadDetail(detail.id); }
                else setMessage('Reset failed');
              }}>Reset Provider</button>
              <button className="danger" onClick={() => deleteSession(detail.id)}>Delete</button>
            </div>
          </div>
          <dl className="detail-grid">
            <dt>ID</dt><dd style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{detail.id}</dd>
            <dt>Mode</dt><dd>{detail.mode || 'persistent'}</dd>
            <dt>Source</dt><dd>{detail.source}</dd>
            <dt>Workspace</dt><dd>{detail.workspace || '-'}</dd>
            <dt>Thread</dt><dd>{detail.threadId}</dd>
            <dt>Model</dt><dd>{detail.model || '-'}</dd>
            <dt>Profile</dt><dd>{detail.profileId || '-'}</dd>
            <dt>Fingerprint</dt><dd style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{detail.fingerprint ? detail.fingerprint.slice(0, 16) + '...' : '-'}</dd>
            <dt>Confidence</dt><dd>{detail.confidence || '-'}</dd>
            <dt>Messages</dt><dd>{detail.messageCount}</dd>
            <dt>Provider Chat ID</dt><dd style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{detail.providerSessionId || '-'}</dd>
            <dt>Compacted</dt><dd>{detail.compactedAt ? new Date(detail.compactedAt).toLocaleString() : 'Never'}</dd>
            <dt>Created</dt><dd>{new Date(detail.createdAt).toLocaleString()}</dd>
            <dt>Updated</dt><dd>{new Date(detail.updatedAt).toLocaleString()}</dd>
          </dl>

          {detail.activeRunDetails && detail.activeRunDetails.length > 0 ? (
            <div style={{marginTop: 12}}>
              <h4>Active Runs ({detail.activeRunDetails.length})</h4>
              <div style={{maxHeight: 150, overflow: 'auto'}}>
                {detail.activeRunDetails.map(r => (
                  <div key={r.id} style={{marginBottom: 4, padding: '4px 8px', fontSize: '0.85em', background: 'var(--color-surface)', borderRadius: 4}}>
                    <span style={{fontFamily: 'monospace'}}>{r.id.slice(0, 8)}</span>
                    <span className={`status-pill`} style={{marginLeft: 8}}>{r.status}</span>
                    <span style={{marginLeft: 8, color: 'var(--color-text-secondary)'}}>{r.model}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {detail.providerBindings && detail.providerBindings.length > 0 ? (
            <div style={{marginTop: 12}}>
              <h4>Provider Bindings ({detail.providerBindings.length})</h4>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Account</th>
                      <th>Purpose</th>
                      <th>Chat ID</th>
                      <th>Worker</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.providerBindings.map((b, i) => (
                      <tr key={i}>
                        <td>{b.providerId}</td>
                        <td>{b.accountId}</td>
                        <td><span className={`status-pill`}>{b.purpose}</span></td>
                        <td style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{b.providerSessionId ? b.providerSessionId.slice(0, 12) + '...' : '-'}</td>
                        <td>{b.workerId || '-'}</td>
                        <td>{new Date(b.updatedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {detail.overflowChain && detail.overflowChain.length > 0 ? (
            <div style={{marginTop: 12}}>
              <h4>Overflow Chain ({detail.overflowChain.length})</h4>
              <div style={{maxHeight: 200, overflow: 'auto'}}>
                {detail.overflowChain.map((a, i) => (
                  <div key={i} style={{marginBottom: 4, padding: 4, fontSize: '0.85em', background: 'var(--color-surface)', borderRadius: 4}}>
                    <span style={{color: 'var(--color-text-secondary)'}}>[{i}]</span> {a.fileName}
                    <span style={{color: 'var(--color-text-secondary)', marginLeft: 8}}>{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {detail.summary ? (
            <div style={{marginTop: 12}}>
              <h4>Summary</h4>
              <pre className="detail-pre" style={{maxHeight: 200, overflow: 'auto'}}>{detail.summary}</pre>
            </div>
          ) : null}

          {detail.messages && detail.messages.length > 0 ? (
            <div style={{marginTop: 12}}>
              <h4>Recent Messages ({detail.messages.length})</h4>
              <div style={{maxHeight: 400, overflow: 'auto'}}>
                {detail.messages.slice(-20).map((m, i) => (
                  <div key={m.id || i} style={{marginBottom: 8, padding: 8, background: 'var(--color-surface)', borderRadius: 4}}>
                    <div style={{fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: 4}}>
                      [{m.role}] {new Date(m.createdAt).toLocaleTimeString()}
                      {m.runId ? <span style={{marginLeft: 8, fontFamily: 'monospace'}}>run: {m.runId.slice(0, 8)}</span> : null}
                      {m.providerId ? <span style={{marginLeft: 8}}>{m.providerId}</span> : null}
                    </div>
                    <pre className="detail-pre" style={{fontSize: '0.85em', maxHeight: 120, overflow: 'auto'}}>
                      {typeof m.content === 'string' ? m.content.slice(0, 1000) : JSON.stringify(m.content).slice(0, 1000)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
