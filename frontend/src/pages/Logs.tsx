import React, {useEffect, useMemo, useState} from 'react';

type LogItem = {level: string; message: string; timestamp: number};
type DetailTab = 'metrics' | 'requestHeaders' | 'responseHeaders' | 'response' | 'prompt';

function parseLog(log: LogItem): Record<string, any> {
  try {
    return JSON.parse(log.message);
  } catch {
    return {message: log.message};
  }
}

export default function Logs() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'info' | 'error'>('all');
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('metrics');
  const [selectedPromptRole, setSelectedPromptRole] = useState<string>('user');

  async function loadLogs() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/logs?limit=200');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLogs(await res.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }

  async function deleteLogs() {
    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/logs', {method: 'DELETE'});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLogs([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete logs');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  const visibleLogs = useMemo(
    () => logs.filter(log => filter === 'all' || log.level === filter),
    [logs, filter],
  );
  const selectedMeta = selectedLog ? parseLog(selectedLog) : null;

  useEffect(() => {
    if (!selectedMeta) return;
    const items = parsePromptMessages(selectedMeta);
    const roles = Array.from(new Set(items.map((p: any) => p.role)));
    const defaultRole = roles.includes('user') ? 'user' : (roles[0] || 'user');
    setSelectedPromptRole(defaultRole);
  }, [selectedMeta]);

  function openLog(log: LogItem) {
    setSelectedLog(log);
    setActiveTab('metrics');
  }

  function renderJsonBlock(value: unknown, emptyText: string) {
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)
    ) {
      return <p className="muted">{emptyText}</p>;
    }
    return <pre className="detail-pre">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
  }

  function parsePromptMessages(meta: Record<string, any>) {
    const raw = meta?.prompt_messages ?? meta?.prompt ?? meta?.requestBody ?? meta?.request?.body ?? meta?.message ?? null;
    try {
      if (!raw) return [{role: 'user', content: ''}];
      if (Array.isArray(raw)) {
        return raw.map((m: any, i: number) => {
          if (typeof m === 'string') return {role: 'user', content: m, index: i};
          const role = String(m.role || m.roleName || m.role_label || 'user').toLowerCase();
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? m, null, 2);
          return {role, content, index: i};
        });
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
          const parsed = JSON.parse(raw);
          return parsePromptMessages({prompt: parsed});
        }
        return [{role: 'user', content: raw}];
      }
      if (typeof raw === 'object') {
        if (Array.isArray(raw.messages)) return parsePromptMessages({prompt: raw.messages});
        const role = String(raw.role || 'user').toLowerCase();
        const content = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content ?? raw, null, 2);
        return [{role, content}];
      }
    } catch (e) {
      return [{role: 'user', content: String(raw)}];
    }
    return [{role: 'user', content: String(raw)}];
  }

  return (
    <section aria-labelledby="logs-title" className="page-panel logs-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Runtime events</p>
          <h2 id="logs-title">Logs</h2>
        </div>
        <div className="action-row">
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)} aria-label="Filter logs">
            <option value="all">All levels</option>
            <option value="info">Info</option>
            <option value="error">Error</option>
          </select>
          <button onClick={loadLogs} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
          <button className="danger" onClick={deleteLogs} disabled={deleting}>{deleting ? 'Deleting...' : 'Xóa'}</button>
        </div>
      </div>

      {message ? <p className="muted">{message}</p> : null}
      {!loading && visibleLogs.length === 0 ? <p className="muted">No logs found.</p> : null}

      <div className="table-wrap">
        <table className="data-table logs-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Path</th>
              <th>Status</th>
              <th>Model</th>
              <th>Prompt / Message</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {visibleLogs.map((log, index) => {
              const meta = parseLog(log);
              return (
                <tr
                  key={`${log.timestamp}-${index}`}
                  className="clickable-row"
                  onClick={() => openLog(log)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openLog(log);
                  }}
                >
                  <td>{new Date(log.timestamp).toLocaleString()}</td>
                  <td><span className={`status-pill status-${log.level === 'error' ? 'dead' : 'alive'}`}>{log.level}</span></td>
                  <td>{meta.path || '-'}</td>
                  <td>{meta.status || '-'}</td>
                  <td>{meta.model || '-'}</td>
                  <td className="log-message">{meta.prompt || meta.error || meta.message || log.message}</td>
                  <td>{typeof meta.durationMs === 'number' ? `${meta.durationMs}ms` : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedLog && selectedMeta ? (
        <div className="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="log-detail-title">
          <aside className="detail-panel">
            <button className="modal-close-btn" aria-label="Close log detail" onClick={() => setSelectedLog(null)}>×</button>
            <div className="detail-heading">
              <p className="eyebrow">Request detail</p>
              <h3 id="log-detail-title">{selectedMeta.path || selectedMeta.message || 'Log entry'}</h3>
              <p className="muted">{new Date(selectedLog.timestamp).toLocaleString()}</p>
            </div>

            <div className="detail-tabs" role="tablist" aria-label="Log detail tabs">
              <button className={activeTab === 'metrics' ? 'tab active' : 'tab'} onClick={() => setActiveTab('metrics')}>Thông số</button>
              <button className={activeTab === 'requestHeaders' ? 'tab active' : 'tab'} onClick={() => setActiveTab('requestHeaders')}>Request headers</button>
              <button className={activeTab === 'responseHeaders' ? 'tab active' : 'tab'} onClick={() => setActiveTab('responseHeaders')}>Response headers</button>
              <button className={activeTab === 'response' ? 'tab active' : 'tab'} onClick={() => setActiveTab('response')}>Response</button>
              <button className={activeTab === 'prompt' ? 'tab active' : 'tab'} onClick={() => setActiveTab('prompt')}>Prompt</button>
            </div>

            <div className="detail-content">
              {activeTab === 'metrics' ? (
                <dl className="detail-grid">
                  <dt>Level</dt><dd>{selectedLog.level}</dd>
                  <dt>Status</dt><dd>{selectedMeta.status || '-'}</dd>
                  <dt>Model</dt><dd>{selectedMeta.model || '-'}</dd>
                  <dt>Stream</dt><dd>{String(selectedMeta.stream ?? '-')}</dd>
                  <dt>Thinking mode</dt><dd>{selectedMeta.thinking_mode || '-'}</dd>
                  <dt>Reasoning effort</dt><dd>{selectedMeta.reasoning_effort || '-'}</dd>
                  <dt>Files</dt><dd>{selectedMeta.files ?? '-'}</dd>
                  <dt>Overflow</dt><dd>{String(selectedMeta.overflow ?? '-')}</dd>
                  <dt>Sanitized</dt><dd>{selectedMeta.sanitized === undefined ? '-' : String(selectedMeta.sanitized)}</dd>
                  <dt>Detected client</dt><dd>{selectedMeta.sanitizerMeta?.client || '-'}</dd>
                  <dt>Response contract</dt><dd>{selectedMeta.sanitizerMeta?.clientResponseContract || '-'}</dd>
                  <dt>Active task idx</dt><dd>{selectedMeta.sanitizerMeta?.activeTaskMessageIndex ?? '-'}</dd>
                  <dt>Active task preview</dt><dd>{selectedMeta.sanitizerMeta?.activeTask?.textPreview?.slice(0, 100) || '-'}</dd>
                  <dt>Active task source</dt><dd>{selectedMeta.sanitizerMeta?.activeTask?.source || '-'}</dd>
                  <dt>Active task part index</dt><dd>{selectedMeta.sanitizerMeta?.activeTask?.fromPartIndex ?? '-'}</dd>
                  <dt>Overflow file</dt><dd>{selectedMeta.sanitizerMeta?.overflowFile || '-'}</dd>
                  <dt>Kept / stripped</dt><dd>{selectedMeta.sanitizerMeta ? `${selectedMeta.sanitizerMeta.keptMessageCount} / ${selectedMeta.sanitizerMeta.strippedMessageCount}` : '-'}</dd>
                  <dt>Client retry detected</dt><dd>{selectedMeta.sanitizerMeta?.clientRetryDetected === undefined ? '-' : String(selectedMeta.sanitizerMeta.clientRetryDetected)}</dd>
                  <dt>Client retry source</dt><dd>{selectedMeta.sanitizerMeta?.clientRetrySource || '-'}</dd>
                  <dt>Snapshot included</dt><dd>{selectedMeta.sanitizerMeta?.projectSnapshotIncluded === undefined ? '-' : String(selectedMeta.sanitizerMeta.projectSnapshotIncluded)}</dd>
                  <dt>Removed container conf</dt><dd>{selectedMeta.sanitizerMeta?.removedCounts?.containerConfusion ?? '-'}</dd>
                  <dt>Removed auto reminder</dt><dd>{selectedMeta.sanitizerMeta?.removedCounts?.automatedReminder ?? '-'}</dd>
                  <dt>Removed partial reminder</dt><dd>{selectedMeta.sanitizerMeta?.removedCounts?.partialAutomatedReminder ?? '-'}</dd>
                  <dt>Removed assistant fail</dt><dd>{selectedMeta.sanitizerMeta?.removedCounts?.assistantFailureEcho ?? '-'}</dd>
                  <dt>Removed dup assistant</dt><dd>{selectedMeta.sanitizerMeta?.removedCounts?.duplicateAssistant ?? '-'}</dd>
                  <dt>Partial noise</dt><dd>{selectedMeta.sanitizerMeta?.partialNoise?.length ? selectedMeta.sanitizerMeta.partialNoise.map((p: any) => `msg[${p.messageIndex}]: ${p.reason}`).join('; ') : '-'}</dd>
                  <dt>Session mode</dt><dd>{selectedMeta.session?.mode || '-'}</dd>
                  <dt>Session resolve reason</dt><dd>{selectedMeta.session?.resolveReason || '-'}</dd>
                  <dt>Session explicit</dt><dd>{selectedMeta.session?.explicit === undefined ? '-' : String(selectedMeta.session.explicit)}</dd>
                  <dt>Session source</dt><dd>{selectedMeta.session?.source || '-'}</dd>
                  <dt>Session workspace</dt><dd>{selectedMeta.session?.workspace || '-'}</dd>
                  <dt>Session thread</dt><dd>{selectedMeta.session?.threadId || '-'}</dd>
                  <dt>Session provider ID</dt><dd>{selectedMeta.session?.providerSessionId || '-'}</dd>
                  <dt>Dedupe meta</dt><dd>{selectedMeta.sanitizerMeta?.persistSkipped ? `skipped=${selectedMeta.sanitizerMeta.persistSkipped.skipped} persisted=${selectedMeta.sanitizerMeta.persistSkipped.persisted}` : '-'}</dd>
                  <dt>Latency</dt><dd>{typeof selectedMeta.durationMs === 'number' ? `${selectedMeta.durationMs}ms` : '-'}</dd>
                  <dt>Prompt</dt><dd>{selectedMeta.prompt || selectedMeta.error || selectedMeta.message || selectedLog.message}</dd>
                </dl>
              ) : null}
              {activeTab === 'prompt' ? (
                (() => {
                  const promptItems = selectedMeta ? parsePromptMessages(selectedMeta) : [{role: 'user', content: ''}];
                  const roles = Array.from(new Set(promptItems.map((p: any) => p.role)));
                  if (!roles.includes('user')) roles.unshift('user');
                  const visible = promptItems.filter((p: any) => p.role === selectedPromptRole) || [];
                  return (
                    <div>
                      <div className="provider-action-row" style={{marginBottom: 12}}>
                        {roles.map((r: string) => (
                          <button
                            key={r}
                            className={`provider-action-btn ${selectedPromptRole === r ? 'active' : ''}`}
                            onClick={() => setSelectedPromptRole(r)}
                            aria-pressed={selectedPromptRole === r}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      {visible.length === 0 ? (
                        <p className="muted">No prompts for selected role.</p>
                      ) : visible.length === 1 ? (
                        <pre className="detail-pre">{visible[0].content}</pre>
                      ) : (
                        <div>
                          {visible.map((v: any, idx: number) => (
                            <div key={idx} style={{marginBottom: 12}}>
                              <div style={{fontSize: '0.9rem', color: 'var(--color-text-secondary)', marginBottom: 6}}>Message {v.index ?? idx}</div>
                              <pre className="detail-pre">{v.content}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : null}
              {activeTab === 'requestHeaders'
                ? renderJsonBlock(selectedMeta.requestHeaders || selectedMeta.request_headers, 'Chưa có request headers trong log hiện tại. Có thể bổ sung backend capture sau.')
                : null}
              {activeTab === 'responseHeaders'
                ? renderJsonBlock(selectedMeta.responseHeaders || selectedMeta.response_headers, 'Chưa có response headers trong log hiện tại. Có thể bổ sung backend capture sau.')
                : null}
              {activeTab === 'response'
                ? renderJsonBlock(selectedMeta.response || selectedMeta.responseBody || selectedMeta.error, 'Chưa có response body trong log hiện tại. Có thể bổ sung backend capture sau.')
                : null}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
