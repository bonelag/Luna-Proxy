import React, {useEffect, useState} from 'react';

type RunContext = {
  id: string;
  status: string;
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
};

export default function Runs() {
  const [runs, setRuns] = useState<RunContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunContext | null>(null);

  useEffect(() => { loadRuns(); }, []);

  async function loadRuns() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/runs?limit=200');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRuns(await res.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }

  async function cancelRun(runId: string) {
    try {
      await fetch(`/api/runs/${runId}/cancel`, {method: 'POST'});
      loadRuns();
    } catch {}
  }

  function statusClass(status: string) {
    if (status === 'completed') return 'status-alive';
    if (status === 'streaming') return 'status-alive';
    if (status === 'failed' || status === 'cancelled') return 'status-dead';
    return 'status-warn';
  }

  return (
    <section aria-labelledby="runs-title" className="page-panel runs-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Request runs (including stateless)</p>
          <h2 id="runs-title">Runs</h2>
        </div>
        <div className="action-row">
          <button onClick={loadRuns} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        </div>
      </div>

      {message ? <p className="muted">{message}</p> : null}
      {!loading && runs.length === 0 ? (
        <div className="surface-card" style={{marginBottom: 16, padding: 16}}>
          <h4 style={{marginBottom: 8}}>No runs recorded yet</h4>
          <p className="muted">Send a request via /v1/chat/completions to create a run record.</p>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Account</th>
              <th>Model</th>
              <th>Session</th>
              <th>Chat ID</th>
              <th>Queue Reason</th>
              <th>Task</th>
              <th>Duration</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.id} className="clickable-row"
                onClick={() => setSelectedRun(selectedRun?.id === r.id ? null : r)}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedRun(selectedRun?.id === r.id ? null : r); }}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td><span className={`status-pill ${statusClass(r.status)}`}>{r.status}</span></td>
                <td style={{fontSize: '0.85em'}}>{r.providerId}</td>
                <td style={{fontSize: '0.85em'}}>{r.accountId || '-'}</td>
                <td style={{fontSize: '0.85em'}}>{r.model}</td>
                <td style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{r.sessionId ? r.sessionId.slice(0, 8) + '...' : '-'}</td>
                <td style={{fontSize: '0.85em'}}>{r.providerChatId ? r.providerChatId.slice(0, 8) + '...' : '-'}</td>
                <td style={{fontSize: '0.85em'}}>{r.queueReason || '-'}</td>
                <td className="log-message">{r.activeTaskPreview || '-'}</td>
                <td>{typeof r.completedAt === 'number' && typeof r.startedAt === 'number' ? `${r.completedAt - r.startedAt}ms` : '-'}</td>
                <td>
                  {r.status === 'streaming' || r.status === 'queued' || r.status === 'routing' ? (
                    <button onClick={(e) => { e.stopPropagation(); cancelRun(r.id); }} style={{fontSize: '0.8em', padding: '2px 8px'}}>Cancel</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRun ? (
        <div className="surface-card" style={{marginTop: 16}}>
          <div className="surface-card-head">
            <h3>Run Detail</h3>
            <button onClick={() => setSelectedRun(null)}>Close</button>
          </div>
          <dl className="detail-grid">
            <dt>ID</dt><dd style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{selectedRun.id}</dd>
            <dt>Status</dt><dd><span className={`status-pill ${statusClass(selectedRun.status)}`}>{selectedRun.status}</span></dd>
            <dt>Created</dt><dd>{new Date(selectedRun.createdAt).toLocaleString()}</dd>
            <dt>Queued</dt><dd>{new Date(selectedRun.queuedAt).toLocaleString()}</dd>
            <dt>Started</dt><dd>{selectedRun.startedAt ? new Date(selectedRun.startedAt).toLocaleString() : '-'}</dd>
            <dt>Completed</dt><dd>{selectedRun.completedAt ? new Date(selectedRun.completedAt).toLocaleString() : '-'}</dd>
            <dt>Provider</dt><dd>{selectedRun.providerId}</dd>
            <dt>Account</dt><dd>{selectedRun.accountId || '-'}</dd>
            <dt>Worker</dt><dd>{selectedRun.workerId || '-'}</dd>
            <dt>Network Profile</dt><dd>{selectedRun.networkProfileId || '-'}</dd>
            <dt>Outbound IP</dt><dd>{selectedRun.outboundIp || '-'}</dd>
            <dt>Provider Chat</dt><dd style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{selectedRun.providerChatId || '-'}</dd>
            <dt>Session ID</dt><dd style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{selectedRun.sessionId || '-'}</dd>
            <dt>Model</dt><dd>{selectedRun.model}</dd>
            <dt>Stream</dt><dd>{selectedRun.stream ? 'Yes' : 'No'}</dd>
            <dt>Queue Reason</dt><dd>{selectedRun.queueReason || '-'}</dd>
            <dt>Error</dt><dd style={{color: 'var(--color-danger)'}}>{selectedRun.error || '-'}</dd>
            <dt>Task</dt><dd>{selectedRun.activeTaskPreview || '-'}</dd>
            <dt>Duration</dt><dd>{typeof selectedRun.completedAt === 'number' && typeof selectedRun.startedAt === 'number' ? `${selectedRun.completedAt - selectedRun.startedAt}ms` : '-'}</dd>
          </dl>
        </div>
      ) : null}
    </section>
  );
}
