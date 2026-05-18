import React, {useEffect, useMemo, useState} from 'react';

export default function ProxyPage() {
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(8080);
  const [proxyKey, setProxyKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<'online' | 'offline' | 'checking'>('checking');

  const baseUrl = useMemo(() => `http://${host}:${port}`, [host, port]);

  useEffect(() => {
    loadConfig();
    checkHealth();
  }, []);

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (data?.proxy?.host) setHost(data.proxy.host);
      if (data?.proxy?.port) setPort(Number(data.proxy.port));
      setProxyKey(String(data?.proxy?.key || ''));
    } catch {
      // ignore initial load errors
    }
  }

  async function saveProxyConfig() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({proxy: {host, port, key: proxyKey}}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('Proxy config saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save proxy config');
    } finally {
      setSaving(false);
    }
  }

  async function checkHealth() {
    setHealth('checking');
    try {
      const res = await fetch('/health');
      setHealth(res.ok ? 'online' : 'offline');
    } catch {
      setHealth('offline');
    }
  }

  return (
    <section aria-labelledby="proxy-title" className="page-panel proxy-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OpenAI compatible gateway</p>
          <h2 id="proxy-title">Proxy</h2>
        </div>
        <span className={`status-pill status-${health === 'online' ? 'alive' : health === 'offline' ? 'dead' : 'warn'}`}>
          {health === 'online' ? 'Online' : health === 'offline' ? 'Offline' : 'Checking'}
        </span>
      </div>

      <form className="surface-card form-grid" onSubmit={(e) => e.preventDefault()} aria-label="Proxy config">
        <label className="field">
          <span>Host</span>
          <input value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="field">
          <span>Port</span>
          <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} min={1} max={65535} />
        </label>
        <label className="field field-wide">
          <span>Proxy Key</span>
          <input type="password" value={proxyKey} onChange={(e) => setProxyKey(e.target.value)} placeholder="Set proxy password/key" />
        </label>
        <div className="action-row field-wide">
          <button type="button" onClick={saveProxyConfig} disabled={saving}>{saving ? 'Saving...' : 'Save Proxy Config'}</button>
          <button type="button" onClick={checkHealth}>Check Health</button>
        </div>
      </form>

      <div className="surface-card endpoint-card">
        <h3>Connection</h3>
        <p className="muted">Base URL: <code>{baseUrl}</code></p>
        <p className="muted">OpenAI Endpoint: <code>{baseUrl}/v1/chat/completions</code></p>
        <p className="muted">Auth Header: <code>Authorization: Bearer &lt;proxy-key&gt;</code> or <code>X-Proxy-Key</code></p>
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
