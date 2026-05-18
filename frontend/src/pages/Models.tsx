import React, {useCallback, useEffect, useState} from 'react';

type ModelItem = {id: string; name: string};

export default function Models() {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      setModels(items);
      setUpdatedAt(data?.updatedAt || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load models');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  async function refreshModels() {
    setRefreshing(true);
    setMessage('Refreshing from chat.qwen.ai...');
    try {
      const res = await fetch('/api/models/refresh', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data?.error || 'Failed to refresh models');
        return;
      }
      setMessage(`Loaded ${data.count} models from Qwen AI`);
      await loadModels();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to refresh models');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section aria-labelledby="models-title" className="page-panel models-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Provider catalog</p>
          <h2 id="models-title">Models</h2>
        </div>
        <span className="status-pill status-alive">{models.length} models</span>
      </div>

      <div className="surface-card">
        <p className="muted">Provider: Qwen AI (International)</p>
        <div className="action-row">
        <button onClick={refreshModels} disabled={refreshing || loading}>
          {refreshing ? 'Refreshing...' : 'Refresh from provider'}
        </button>
        {updatedAt ? <span className="muted">Updated: {new Date(updatedAt).toLocaleString()}</span> : null}
        </div>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {loading ? <p className="muted">Loading models...</p> : null}
      {!loading && models.length === 0 ? <p className="muted">No models loaded yet.</p> : null}

      <ul className="model-grid">
        {models.map((m) => (
          <li key={m.id} className="model-item">
            <div className="model-name">{m.name}</div>
            <div className="model-meta muted">{m.id}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
