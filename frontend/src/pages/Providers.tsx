import React, {useEffect, useState} from 'react';

type ProviderConfig = { id: string; name?: string; credentials?: Record<string,string>; oauth?: any };
type ProviderStatus = 'alive' | 'warn' | 'dead';

const builtinProviders = [
  { id: 'qwen-ai', name: 'Qwen AI (International)', loginUrl: 'https://chat.qwen.ai' },
];

export default function Providers() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'config'|'oauth'>('config');
  const [tokenValue, setTokenValue] = useState('');
  const [cookieValue, setCookieValue] = useState('');
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [oauthPolling, setOauthPolling] = useState(false);
  const [oauthConfig, setOauthConfig] = useState<any>(null);
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({});

  useEffect(() => { loadConfig(); }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const items = data.providers || [];
      setProviders(items);
      await Promise.all(
        items.map(async (p: ProviderConfig) => {
          try {
            const s = await fetch(`/api/provider/status?providerId=${encodeURIComponent(p.id)}`);
            const d = await s.json();
            if (d?.status) {
              setProviderStatus(prev => ({...prev, [p.id]: d.status as ProviderStatus}));
            }
          } catch {
            setProviderStatus(prev => ({...prev, [p.id]: 'warn'}));
          }
        }),
      );
    } catch (err) {
      console.error('Failed to load config', err);
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }

  const configured = providers.filter(p => p.credentials && Object.keys(p.credentials).length > 0);

  function openAdd() {
    setSelected(null);
    setTokenValue('');
    setCookieValue('');
    setActiveTab('config');
    setValidationMsg(null);
    setShowAdd(true);
  }

  function openEditorForProvider(p: ProviderConfig) {
    const built = builtinProviders.find(b => b.id === p.id) || {id: p.id, name: p.name || p.id, loginUrl: 'https://chat.qwen.ai'};
    setSelected(built);
    setTokenValue(p.credentials?.token || '');
    setCookieValue((p.credentials?.cookies || p.credentials?.cookie || ''));
    setActiveTab('config');
    setValidationMsg(null);
    setShowAdd(true);
  }

  function closeAdd() {
    setShowAdd(false);
  }

  function pickBuiltin(p: any) {
    setSelected(p);
    setActiveTab('config');
    setTokenValue('');
    setCookieValue('');
    setValidationMsg(null);
  }

  async function loadOauthConfig(providerId: string) {
    try {
      const resp = await fetch(`/api/provider/oauth-config?providerId=${encodeURIComponent(providerId)}`);
      if (!resp.ok) {
        setOauthConfig(null);
        return;
      }
      const data = await resp.json();
      setOauthConfig(data || null);
    } catch (err) {
      console.error('loadOauthConfig failed', err);
      setOauthConfig(null);
    }
  }

  function openLoginAndSwitch() {
    if (!selected) return;
    window.open(selected.loginUrl || 'https://chat.qwen.ai', '_blank');
    // Open login to retrieve cookie; keep user in Config so they can paste cookie
    setActiveTab('config');
  }

  async function startOAuth() {
    if (!selected) return;
    setValidationMsg(null);
    setOauthPolling(true);
    try {
      setValidationMsg('Opening Qwen AI login window. Complete login in Chromium...');
      const resp = await fetch('/api/provider/oauth/capture', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({providerId: selected.id, timeout: 300000}),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setValidationMsg(data.error || 'OAuth capture failed');
        return;
      }

      const creds = data.credentials || {};
      if (creds.token) setTokenValue(creds.token);
      if (creds.cookies) setCookieValue(creds.cookies);
      await loadConfig();
      setValidationMsg('OAuth credentials captured and validated');
    } catch (err) {
      console.error('startOAuth failed', err);
      setValidationMsg(err instanceof Error ? err.message : 'Failed to start OAuth');
    } finally {
      setOauthPolling(false);
    }
  }

  async function validate() {
    if (!selected) return;
    setValidationMsg('Checking...');
    const creds: any = {};
    const tokenKey = selected.id === 'qwen-ai' ? 'token' : 'ticket';
    const cookieKey = selected.id === 'qwen-ai' ? 'cookies' : 'cookie';

    if (tokenValue && tokenValue.trim().length > 0) {
      creds[tokenKey] = tokenValue.trim();
    }
    if (cookieValue && cookieValue.trim().length > 0) {
      creds[cookieKey] = cookieValue.trim();
    }
    if (Object.keys(creds).length === 0) {
      setValidationMsg(activeTab === 'oauth' ? 'Start OAuth first' : 'Provide token or cookie to validate');
      return;
    }

    try {
      const resp = await fetch('/api/provider/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selected.id, credentials: creds }),
      });
      const data = await resp.json();
      if (data && data.ok) setValidationMsg('Account valid');
      else setValidationMsg('Invalid account');
    } catch (err) {
      console.error(err);
      setValidationMsg('Validation failed');
    }
  }

  async function save() {
    if (!selected) return;
    try {
      const tokenKey = selected.id === 'qwen-ai' ? 'token' : 'ticket';
      const cookieKey = selected.id === 'qwen-ai' ? 'cookies' : 'cookie';

      const credentials: Record<string, string> = {};
      if (tokenValue && tokenValue.trim().length > 0) {
        credentials[tokenKey] = tokenValue.trim();
      }
      if (cookieValue && cookieValue.trim().length > 0) {
        credentials[cookieKey] = cookieValue.trim();
      }

      if (Object.keys(credentials).length > 0) {
        await fetch('/api/provider/token', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({providerId: selected.id, credentials}),
        });
      } else {
        setValidationMsg(activeTab === 'oauth' ? 'Start OAuth first' : 'Nothing to save — provide token or cookie');
        return;
      }
      await loadConfig();
      setShowAdd(false);
    } catch (err) {
      console.error('save failed', err);
    }
  }

  return (
    <section aria-labelledby="providers-title" className={`providers-section ${showAdd ? 'modal-open' : ''}`}>
      <h2 id="providers-title">Providers</h2>

      <div style={{display:'flex', justifyContent:'center', gap:16, marginBottom:16}}>
        <button className="add-button" onClick={openAdd}>Add Provider</button>
      </div>

      <div className={`providers-wrapper ${showAdd ? 'modal-open' : ''}`}>
        {loading ? <div>Loading…</div> : (
          configured.length === 0 ? <div className="muted">Chưa có provider</div> : (
            configured.map(p => (
              <button key={p.id} className="provider-card provider-card-button" onClick={() => openEditorForProvider(p)}>
                <div className="provider-card-head">
                  <div className="provider-name">{p.name || p.id}</div>
                  <span className={`provider-status-dot status-${providerStatus[p.id] || 'warn'}`} />
                </div>
                <div className="provider-credentials">{p.credentials ? Object.keys(p.credentials).map(k => `${k}: ${String(p.credentials![k]).slice(0,6)}...`).join(' • ') : ''}</div>
              </button>
            ))
          )
        )}
      </div>

      {showAdd && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <button aria-label="Close" className="modal-close-btn" onClick={closeAdd}>×</button>
            <div style={{display:'flex', flexDirection:'column', gap:16}}>
              <div className="available-list">
                <h3>Available</h3>
                <div className="available-items">
                  {builtinProviders.map(bp => (
                    <button
                      key={bp.id}
                      className={selected && selected.id === bp.id ? 'provider-select-btn selected' : 'provider-select-btn'}
                      onClick={() => pickBuiltin(bp)}
                    >
                      {bp.name}
                    </button>
                  ))}
                </div>

                {selected && (
                  <div className="provider-action-row">
                    <button className={activeTab === 'config' ? 'provider-action-btn active' : 'provider-action-btn'} onClick={() => setActiveTab('config')}>Config</button>
                    <button className={activeTab === 'oauth' ? 'provider-action-btn active' : 'provider-action-btn'} onClick={() => setActiveTab('oauth')}>OAuth</button>
                  </div>
                )}
              </div>

              <div className="provider-detail-center">
                {!selected ? (
                  <div className="muted">Select a provider to configure</div>
                ) : (
                  <div style={{textAlign:'left'}}>
                    <h3 style={{textAlign:'center'}}>{selected.name}</h3>

                    {activeTab === 'config' ? (
                      <div>
                        <div className="input-area">
                          <label>Token (paste here)</label>
                          <input value={tokenValue} onChange={(e) => setTokenValue(e.target.value)} style={{width:'100%'}} />
                          <p className="muted">Paste token if you have one. Alternatively paste cookie below after login.</p>
                        </div>

                        <div className="input-area" style={{marginTop:8}}>
                          <label>Cookie / Session (paste raw cookie string)</label>
                          <textarea value={cookieValue} onChange={(e)=>setCookieValue(e.target.value)} style={{width:'100%',height:120}} />
                        </div>

                        <div style={{marginTop:8}}>
                          <button onClick={openLoginAndSwitch} className="nav-link">Open login page</button>
                          <button onClick={startOAuth} className="nav-link" style={{marginLeft:8}}>Start OAuth</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{textAlign:'left'}}>
                        <p className="muted">Open the Qwen AI international login window. After login, Proxy-Luna captures the web token from Local Storage and validates it automatically.</p>
                        <div style={{display:'flex', justifyContent:'center', gap:8, marginTop:12}}>
                          <button onClick={startOAuth} disabled={oauthPolling} className="add-button">
                            {oauthPolling ? 'Waiting for login...' : 'Start OAuth'}
                          </button>
                        </div>
                        {(tokenValue || cookieValue) && (
                          <div style={{marginTop:12}}>
                            {tokenValue && <div className="provider-credentials">token: {tokenValue.slice(0, 12)}...</div>}
                            {cookieValue && <div className="provider-credentials">cookies: {cookieValue.slice(0, 12)}...</div>}
                          </div>
                        )}
                      </div>
                    )}

                    {validationMsg && <div style={{marginTop:8}} className="muted">{validationMsg}</div>}
                  </div>
                )}
              </div>

              {selected && (
                <div className="modal-actions" style={{display:'flex', gap:8, marginTop:12, justifyContent:'flex-end'}}>
                  <button onClick={validate} className="nav-link">Validate</button>
                  <button onClick={save} className="add-button">Save Provider</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
