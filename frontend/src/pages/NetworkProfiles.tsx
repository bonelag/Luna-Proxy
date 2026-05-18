import React, {useEffect, useState} from 'react';

type NetworkProfile = {
  id: string;
  name: string;
  mode: string;
  proxyUrl?: string;
  localAddress?: string;
  expectedIp?: string;
  enabled: boolean;
  verifyIpUrl?: string;
  lastVerifiedIp?: string;
  lastVerifiedAt?: number;
};

type ProviderWorker = {
  id: string;
  providerId: string;
  accountId?: string;
  baseUrl: string;
  enabled: boolean;
  networkProfileId: string;
  maxConcurrentRuns: number;
  expectedIp?: string;
  lastVerifiedIp?: string;
  lastVerifiedAt?: number;
  status?: string;
};

export default function NetworkProfiles() {
  const [profiles, setProfiles] = useState<NetworkProfile[]>([]);
  const [workers, setWorkers] = useState<ProviderWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProfile, setEditingProfile] = useState<NetworkProfile | null>(null);
  const [editingWorker, setEditingWorker] = useState<ProviderWorker | null>(null);
  const [directIp, setDirectIp] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.all([
      fetch('/api/network-profiles').then(r => r.json()).then(setProfiles).catch(() => {}),
      fetch('/api/workers').then(r => r.json()).then(setWorkers).catch(() => {}),
      fetch('/api/egress/direct-ip').then(r => r.json()).then(d => setDirectIp(d.ip || '')).catch(() => {}),
    ]);
    setLoading(false);
  }

  async function saveProfile(p: NetworkProfile) {
    const method = profiles.find(x => x.id === p.id) ? 'PUT' : 'POST';
    const url = method === 'PUT' ? `/api/network-profiles/${p.id}` : '/api/network-profiles';
    await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(p)});
    setEditingProfile(null);
    loadAll();
  }

  async function deleteProfile(id: string) {
    await fetch(`/api/network-profiles/${id}`, {method: 'DELETE'});
    loadAll();
  }

  async function saveWorker(w: ProviderWorker) {
    const method = workers.find(x => x.id === w.id) ? 'PUT' : 'POST';
    const url = method === 'PUT' ? `/api/workers/${w.id}` : '/api/workers';
    await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(w)});
    setEditingWorker(null);
    loadAll();
  }

  async function deleteWorker(id: string) {
    await fetch(`/api/workers/${id}`, {method: 'DELETE'});
    loadAll();
  }

  async function verifyWorker(id: string) {
    await fetch(`/api/workers/${id}/verify-ip`, {method: 'POST'});
    loadAll();
  }

  async function verifyAllWorkers() {
    await fetch('/api/workers/verify-all', {method: 'POST'});
    loadAll();
  }

  async function verifyProfile(id: string) {
    await fetch(`/api/network-profiles/${id}/verify`, {method: 'POST'});
    loadAll();
  }

  function statusClass(s?: string) {
    if (s === 'healthy' || s === 'active') return 'status-alive';
    if (s === 'offline' || s === 'ip-mismatch' || s === 'disabled' || s === 'error') return 'status-dead';
    return 'status-warn';
  }

  return (
    <section aria-labelledby="np-title" className="page-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Egress paths and remote workers</p>
          <h2 id="np-title">Network & Workers</h2>
        </div>
        <div className="action-row">
          <span className="muted" style={{fontSize: '0.85em', marginRight: 12}}>Direct IP: {directIp || '...'}</span>
          <button onClick={verifyAllWorkers}>Verify All Workers</button>
          <button onClick={loadAll}>Refresh</button>
        </div>
      </div>

      <div className="surface-card" style={{marginBottom: 16}}>
        <div className="surface-card-head">
          <h3>Network Profiles</h3>
          <button onClick={() => setEditingProfile({
            id: crypto.randomUUID().slice(0,8), name: '', mode: 'direct',
            enabled: true, maxConcurrentRuns: 5,
          } as any)}>Add Profile</button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Mode</th>
                <th>Enabled</th>
                <th>Expected IP</th>
                <th>Verified IP</th>
                <th>Last Verified</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => (
                <tr key={p.id}>
                  <td style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{p.id}</td>
                  <td>{p.name}</td>
                  <td>{p.mode}</td>
                  <td>{p.enabled ? 'Yes' : 'No'}</td>
                  <td>{p.expectedIp || '-'}</td>
                  <td>{p.lastVerifiedIp || '-'}</td>
                  <td>{p.lastVerifiedAt ? new Date(p.lastVerifiedAt).toLocaleString() : '-'}</td>
                  <td>
                    <button onClick={() => setEditingProfile({...p})} style={{fontSize: '0.8em', marginRight: 4}}>Edit</button>
                    <button onClick={() => verifyProfile(p.id)} style={{fontSize: '0.8em', marginRight: 4}}>Verify</button>
                    <button onClick={() => deleteProfile(p.id)} style={{fontSize: '0.8em'}}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="surface-card" style={{marginBottom: 16}}>
        <div className="surface-card-head">
          <h3>Workers</h3>
          <button onClick={() => setEditingWorker({
            id: crypto.randomUUID().slice(0,8), providerId: 'qwen-ai', baseUrl: '',
            enabled: true, networkProfileId: 'direct', maxConcurrentRuns: 5,
          } as ProviderWorker)}>Add Worker</button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Provider</th>
                <th>Account</th>
                <th>Base URL</th>
                <th>Status</th>
                <th>Profile</th>
                <th>Max Runs</th>
                <th>Expected IP</th>
                <th>Verified IP</th>
                <th>Last Verified</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {workers.map(w => (
                <tr key={w.id}>
                  <td style={{fontFamily: 'monospace', fontSize: '0.85em'}}>{w.id}</td>
                  <td>{w.providerId}</td>
                  <td>{w.accountId || 'any'}</td>
                  <td style={{fontSize: '0.85em'}}>{w.baseUrl}</td>
                  <td><span className={`status-pill ${statusClass(w.status)}`}>{w.status || 'unknown'}</span></td>
                  <td style={{fontSize: '0.85em'}}>{w.networkProfileId}</td>
                  <td>{w.maxConcurrentRuns}</td>
                  <td>{w.expectedIp || '-'}</td>
                  <td>{w.lastVerifiedIp || '-'}</td>
                  <td>{w.lastVerifiedAt ? new Date(w.lastVerifiedAt).toLocaleString() : '-'}</td>
                  <td>
                    <button onClick={() => setEditingWorker({...w})} style={{fontSize: '0.8em', marginRight: 4}}>Edit</button>
                    <button onClick={() => verifyWorker(w.id)} style={{fontSize: '0.8em', marginRight: 4}}>Verify IP</button>
                    <button onClick={() => deleteWorker(w.id)} style={{fontSize: '0.8em'}}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingProfile ? (
        <ProfileForm profile={editingProfile} onSave={saveProfile} onCancel={() => setEditingProfile(null)} />
      ) : null}
      {editingWorker ? (
        <WorkerForm worker={editingWorker} profiles={profiles} onSave={saveWorker} onCancel={() => setEditingWorker(null)} />
      ) : null}
    </section>
  );
}

function ProfileForm({profile, onSave, onCancel}: {
  profile: NetworkProfile;
  onSave: (p: NetworkProfile) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState(profile);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onCancel}>x</button>
        <h3>{profile.id ? 'Edit Network Profile' : 'Add Network Profile'}</h3>
        <div className="form-grid">
          <label className="field"><span>Name</span><input value={p.name} onChange={e => setP({...p, name: e.target.value})} /></label>
          <label className="field">
            <span>Mode</span>
            <select value={p.mode} onChange={e => setP({...p, mode: e.target.value})}>
              <option value="direct">Direct</option>
              <option value="worker-managed">Worker-managed</option>
              <option value="http-proxy">HTTP Proxy</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </label>
          <label className="field"><span>Expected IP</span><input value={p.expectedIp || ''} onChange={e => setP({...p, expectedIp: e.target.value})} /></label>
          <label className="field"><span>Proxy URL</span><input value={p.proxyUrl || ''} onChange={e => setP({...p, proxyUrl: e.target.value})} placeholder="http://..." /></label>
          <label className="field"><span>Verify IP URL</span><input value={p.verifyIpUrl || ''} onChange={e => setP({...p, verifyIpUrl: e.target.value})} placeholder="https://api.ipify.org?format=json" /></label>
          <label className="toggle-field">
            <input type="checkbox" checked={p.enabled} onChange={e => setP({...p, enabled: e.target.checked})} />
            <span>Enabled</span>
          </label>
        </div>
        <div className="action-row">
          <button onClick={() => onSave(p)}>Save</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function WorkerForm({worker, profiles, onSave, onCancel}: {
  worker: ProviderWorker;
  profiles: NetworkProfile[];
  onSave: (w: ProviderWorker) => void;
  onCancel: () => void;
}) {
  const [w, setW] = useState(worker);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onCancel}>x</button>
        <h3>{worker.id ? 'Edit Worker' : 'Add Worker'}</h3>
        <div className="form-grid">
          <label className="field"><span>Provider ID</span><input value={w.providerId} onChange={e => setW({...w, providerId: e.target.value})} /></label>
          <label className="field"><span>Account ID</span><input value={w.accountId || ''} onChange={e => setW({...w, accountId: e.target.value})} placeholder="optional" /></label>
          <label className="field"><span>Base URL</span><input value={w.baseUrl} onChange={e => setW({...w, baseUrl: e.target.value})} placeholder="http://localhost:3001" /></label>
          <label className="field">
            <span>Network Profile</span>
            <select value={w.networkProfileId} onChange={e => setW({...w, networkProfileId: e.target.value})}>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </select>
          </label>
          <label className="field"><span>Max Concurrent Runs</span><input type="number" value={w.maxConcurrentRuns} onChange={e => setW({...w, maxConcurrentRuns: Number(e.target.value)})} min={1} /></label>
          <label className="field"><span>Expected IP</span><input value={w.expectedIp || ''} onChange={e => setW({...w, expectedIp: e.target.value})} /></label>
          <label className="toggle-field">
            <input type="checkbox" checked={w.enabled} onChange={e => setW({...w, enabled: e.target.checked})} />
            <span>Enabled</span>
          </label>
        </div>
        <div className="action-row">
          <button onClick={() => onSave(w)}>Save</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
