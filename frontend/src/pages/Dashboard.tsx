import React, {useEffect, useMemo, useRef, useState} from 'react';

type ConfigData = {
  providers?: Array<{id: string; name?: string; credentials?: Record<string, string>}>;
  proxy?: {host?: string; port?: number; key?: string};
  models?: Array<{id: string; name: string}>;
  modelsUpdatedAt?: number;
  settings?: Record<string, any>;
};

type LogItem = {level: string; message: string; timestamp: number};
type LogStats = {total: number; errors: number; chatRequests: number};

function parseLog(log: LogItem): Record<string, any> {
  try {
    return JSON.parse(log.message);
  } catch {
    return {message: log.message};
  }
}

export default function Dashboard() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logStats, setLogStats] = useState<LogStats>({total: 0, errors: 0, chatRequests: 0});
  const [health, setHealth] = useState<'online' | 'offline' | 'checking'>('checking');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const requestInFlight = useRef(false);

  async function loadDashboard(initial = false) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (initial) setLoading(true);
    try {
      const [configRes, logsRes, statsRes, healthRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/logs?limit=20'),
        fetch('/api/logs/stats'),
        fetch('/health'),
      ]);
      if (configRes.ok) setConfig(await configRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
      if (statsRes.ok) setLogStats(await statsRes.json());
      setHealth(healthRes.ok ? 'online' : 'offline');
      setLastUpdated(Date.now());
    } catch {
      setHealth('offline');
    } finally {
      if (initial) setLoading(false);
      requestInFlight.current = false;
    }
  }

  useEffect(() => {
    let active = true;
    const tick = async () => {
      if (!active) return;
      await loadDashboard(true);
    };
    void tick();
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const stats = useMemo(() => {
    const providers = config?.providers || [];
    const configuredProviders = providers.filter(p => p.credentials && Object.keys(p.credentials).length > 0);
    return {
      providers: configuredProviders.length,
      threads: 0,
      requests: logStats.chatRequests,
      errors: logStats.errors,
    };
  }, [config, logStats]);

  return (
    <section aria-labelledby="dashboard-title" className="page-panel dashboard-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Local control plane</p>
          <h2 id="dashboard-title">Dashboard</h2>
          <p className="muted">Auto-updating every 5 seconds.</p>
        </div>
        <span className={`status-pill status-${health === 'online' ? 'alive' : health === 'offline' ? 'dead' : 'warn'}`}>
          {health}
        </span>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <span className={`status-pill status-${health === 'online' ? 'alive' : health === 'offline' ? 'dead' : 'warn'}`}>
            {health}
          </span>
          <h3>Proxy health</h3>
          <p className="metric-value">{health === 'online' ? 'Ready' : health === 'offline' ? 'Down' : 'Checking'}</p>
        </article>
        <article className="metric-card">
          <h3>Configured providers</h3>
          <p className="metric-value">{stats.providers}</p>
        </article>
        <article className="metric-card">
          <h3>Threads</h3>
          <p className="metric-value">{stats.threads}</p>
          <p className="muted">Mocked until thread tracking is implemented.</p>
        </article>
        <article className="metric-card">
          <h3>Recent requests</h3>
          <p className="metric-value">{stats.requests}</p>
        </article>
        <article className="metric-card">
          <h3>Recent errors</h3>
          <p className="metric-value">{stats.errors}</p>
        </article>
      </div>

      <section className="surface-card" aria-labelledby="recent-title">
        <div className="surface-card-head">
          <h3 id="recent-title">Recent requests</h3>
          {lastUpdated ? <span className="muted">Updated {new Date(lastUpdated).toLocaleTimeString()}</span> : null}
        </div>
        {logs.length === 0 ? (
          <p className="muted">No request logs yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Path</th>
                  <th>Model</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 20).map((log, index) => {
                  const meta = parseLog(log);
                  return (
                    <tr key={`${log.timestamp}-${index}`}>
                      <td>{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td><span className={`status-pill status-${log.level === 'error' ? 'dead' : 'alive'}`}>{log.level}</span></td>
                      <td>{meta.path || '-'}</td>
                      <td>{meta.model || '-'}</td>
                      <td>{meta.status || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
