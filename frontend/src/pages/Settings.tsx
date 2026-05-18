import React, {useEffect, useState} from 'react';

export default function Settings() {
  const [overflowEnabled, setOverflowEnabled] = useState(true);
  const [threshold, setThreshold] = useState(10000);
  const [sanitizerEnabled, setSanitizerEnabled] = useState(true);
  const [sanitizerMode, setSanitizerMode] = useState('generic-plus-client-rules');
  const [stripClientToolProtocol, setStripClientToolProtocol] = useState(true);
  const [stripAutomatedClientErrors, setStripAutomatedClientErrors] = useState(true);
  const [stripAssistantToolFailureEcho, setStripAssistantToolFailureEcho] = useState(true);
  const [stripAssistantThinking, setStripAssistantThinking] = useState(true);
  const [stripAssistantContainerConfusion, setStripAssistantContainerConfusion] = useState(true);
  const [dedupeAssistantMessages, setDedupeAssistantMessages] = useState(true);
  const [assistantSimilarityThreshold, setAssistantSimilarityThreshold] = useState(0.85);
  const [maxAssistantMessages, setMaxAssistantMessages] = useState(1);
  const [prioritizeUserMessages, setPrioritizeUserMessages] = useState(true);
  const [includeProjectSnapshot, setIncludeProjectSnapshot] = useState(true);
  const [clientAwareResponseContract, setClientAwareResponseContract] = useState(true);
  const [clineUseAttemptCompletion, setClineUseAttemptCompletion] = useState(true);
  const [maxEnvironmentFileList, setMaxEnvironmentFileList] = useState(120);
  const [maxMessageChars, setMaxMessageChars] = useState(20000);
  const [maxToolResultChars, setMaxToolResultChars] = useState(12000);
  const [maxToolResultCount, setMaxToolResultCount] = useState(5);
  const [preserveRawDebugFile, setPreserveRawDebugFile] = useState(false);
  const [sessionEnabled, setSessionEnabled] = useState(true);
  const [requireExplicitId, setRequireExplicitId] = useState(true);
  const [fileBackedEnabled, setFileBackedEnabled] = useState(true);
  const [createOnOverflow, setCreateOnOverflow] = useState(true);
  const [fallbackMode, setFallbackMode] = useState('stateless');
  const [historyLimit, setHistoryLimit] = useState(10);
  const [autoCompact, setAutoCompact] = useState(true);
  const [compactAfterMessages, setCompactAfterMessages] = useState(40);
  const [compactKeepRecent, setCompactKeepRecent] = useState(5);
  const [compactModel, setCompactModel] = useState('Qwen3.6-Plus');
  const [mtEnabled, setMtEnabled] = useState(true);
  const [globalMaxConcurrent, setGlobalMaxConcurrent] = useState(20);
  const [providerMaxConcurrent, setProviderMaxConcurrent] = useState(5);
  const [accountMaxConcurrent, setAccountMaxConcurrent] = useState(2);
  const [queueTimeoutMs, setQueueTimeoutMs] = useState(120000);
  const [runTimeoutMs, setRunTimeoutMs] = useState(300000);
  const [egressEnabled, setEgressEnabled] = useState(false);
  const [egressStrict, setEgressStrict] = useState(true);
  const [egressFallback, setEgressFallback] = useState(false);
  const [egressVerify, setEgressVerify] = useState(true);
  const [directIp, setDirectIp] = useState('');
  const [directIpSource, setDirectIpSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      const toc = data?.settings?.tokenOverflow || {};
      setOverflowEnabled(toc.enabled !== false);
      setThreshold(Number(toc.threshold || 10000));
      const sc = toc.sanitizer || {};
      setSanitizerEnabled(sc.enabled !== false);
      setSanitizerMode(sc.mode || 'generic-plus-client-rules');
      setStripClientToolProtocol(sc.stripClientToolProtocol !== false);
      setStripAutomatedClientErrors(sc.stripAutomatedClientErrors !== false);
      setStripAssistantToolFailureEcho(sc.stripAssistantToolFailureEcho !== false);
      setStripAssistantThinking(sc.stripAssistantThinking !== false);
      setStripAssistantContainerConfusion(sc.stripAssistantContainerConfusion !== false);
      setDedupeAssistantMessages(sc.dedupeAssistantMessages !== false);
      setAssistantSimilarityThreshold(Number(sc.assistantSimilarityThreshold || 0.85));
      setMaxAssistantMessages(Number(sc.maxAssistantMessages || 1));
      setPrioritizeUserMessages(sc.prioritizeUserMessages !== false);
      setIncludeProjectSnapshot(sc.includeProjectSnapshot !== false);
      setClientAwareResponseContract(sc.clientAwareResponseContract !== false);
      setClineUseAttemptCompletion(sc.clineUseAttemptCompletion !== false);
      setMaxEnvironmentFileList(Number(sc.maxEnvironmentFileList || 120));
      setMaxMessageChars(Number(sc.maxMessageChars || 20000));
      setMaxToolResultChars(Number(sc.maxToolResultChars || 12000));
      setMaxToolResultCount(Number(sc.maxToolResultCount || 5));
      setPreserveRawDebugFile(!!sc.preserveRawDebugFile);
      const ssc = data?.settings?.session || {};
      setSessionEnabled(ssc.enabled !== false);
      setRequireExplicitId(ssc.requireExplicitId !== false);
      setFallbackMode(ssc.fallbackMode || 'file-backed');
      const fbc = ssc.fileBacked || {};
      setFileBackedEnabled(fbc.enabled !== false);
      setCreateOnOverflow(fbc.createOnOverflow !== false);
      setHistoryLimit(Number(ssc.historyLimit || 10));
      setAutoCompact(ssc.autoCompact !== false);
      setCompactAfterMessages(Number(ssc.compactAfterMessages || 40));
      setCompactKeepRecent(Number(ssc.compactKeepRecent || 5));
      setCompactModel(ssc.compactModel || 'Qwen3.6-Plus');
      const mt = data?.settings?.multiThread || {};
      setMtEnabled(mt.enabled !== false);
      setGlobalMaxConcurrent(Number(mt.globalMaxConcurrentRuns || 20));
      setProviderMaxConcurrent(Number(mt.defaultProviderMaxConcurrentRuns || 5));
      setAccountMaxConcurrent(Number(mt.defaultAccountMaxConcurrentRuns || 2));
      setQueueTimeoutMs(Number(mt.queueTimeoutMs || 120000));
      setRunTimeoutMs(Number(mt.runTimeoutMs || 300000));
      const ei = data?.settings?.egressIsolation || {};
      setEgressEnabled(!!ei.enabled);
      setEgressStrict(ei.strict !== false);
      setEgressFallback(!!ei.fallbackToDirect);
      setEgressVerify(ei.verifyBeforeUse !== false);
    } catch {}
    try {
      const ipRes = await fetch('/api/egress/direct-ip');
      const ipData = await ipRes.json();
      setDirectIp(ipData.ip || 'unknown');
      setDirectIpSource(ipData.source || 'unknown');
    } catch {}
  }

  async function saveSettings() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          settings: {
            tokenOverflow: {
              enabled: overflowEnabled,
              threshold: Number(threshold) || 10000,
              sanitizer: {
                enabled: sanitizerEnabled,
                mode: sanitizerMode,
                stripClientToolProtocol,
                stripAutomatedClientErrors,
                stripAssistantToolFailureEcho,
                stripAssistantThinking,
                stripAssistantContainerConfusion,
                dedupeAssistantMessages,
                assistantSimilarityThreshold: Number(assistantSimilarityThreshold) || 0.85,
                maxAssistantMessages: Number(maxAssistantMessages) || 1,
                maxToolResultChars: Number(maxToolResultChars) || 12000,
                maxToolResultCount: Number(maxToolResultCount) || 5,
                prioritizeUserMessages,
                includeProjectSnapshot,
                clientAwareResponseContract,
                clineUseAttemptCompletion,
                maxEnvironmentFileList: Number(maxEnvironmentFileList) || 120,
                maxMessageChars: Number(maxMessageChars) || 20000,
                preserveRawDebugFile,
              },
            },
            session: {
              enabled: sessionEnabled,
              requireExplicitId,
              fileBacked: {
                enabled: fileBackedEnabled,
                createOnOverflow,
              },
              fallbackMode,
              historyLimit: Number(historyLimit) || 10,
              autoCompact,
              compactAfterMessages: Number(compactAfterMessages) || 40,
              compactKeepRecent: Number(compactKeepRecent) || 5,
              compactModel: compactModel || 'Qwen3.6-Plus',
            },
            multiThread: {
              enabled: mtEnabled,
              globalMaxConcurrentRuns: Number(globalMaxConcurrent) || 20,
              defaultProviderMaxConcurrentRuns: Number(providerMaxConcurrent) || 5,
              defaultAccountMaxConcurrentRuns: Number(accountMaxConcurrent) || 2,
              queueTimeoutMs: Number(queueTimeoutMs) || 120000,
              runTimeoutMs: Number(runTimeoutMs) || 300000,
            },
            egressIsolation: {
              enabled: egressEnabled,
              strict: egressStrict,
              fallbackToDirect: egressFallback,
              verifyBeforeUse: egressVerify,
            },
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage('Settings saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="settings-title" className="page-panel settings-panel">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Runtime behavior</p>
          <h2 id="settings-title">Settings</h2>
        </div>
      </div>

      <div className="surface-card" style={{marginBottom: 16}}>
        <h3>Token Overflow</h3>
        <div className="settings-grid">
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={overflowEnabled}
              onChange={(e) => setOverflowEnabled(e.target.checked)}
            />
            <span>Enable token overflow to txt</span>
          </label>
          <label className="field">
            <span>Token threshold</span>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              min={1000}
              step={500}
            />
          </label>
        </div>

        <h4 style={{marginTop: 16, marginBottom: 8}}>Overflow Sanitizer</h4>
        <div className="settings-grid">
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={sanitizerEnabled}
              onChange={(e) => setSanitizerEnabled(e.target.checked)}
            />
            <span>Enable overflow sanitizer</span>
          </label>
          <label className="field">
            <span>Sanitizer mode</span>
            <select value={sanitizerMode} onChange={(e) => setSanitizerMode(e.target.value)}>
              <option value="generic-plus-client-rules">Generic + client rules</option>
              <option value="generic">Generic only</option>
            </select>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={stripClientToolProtocol}
              onChange={(e) => setStripClientToolProtocol(e.target.checked)}
            />
            <span>Strip client tool protocol</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={stripAutomatedClientErrors}
              onChange={(e) => setStripAutomatedClientErrors(e.target.checked)}
            />
            <span>Strip automated client errors</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={stripAssistantToolFailureEcho}
              onChange={(e) => setStripAssistantToolFailureEcho(e.target.checked)}
            />
            <span>Strip assistant tool failure echo</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={stripAssistantThinking}
              onChange={(e) => setStripAssistantThinking(e.target.checked)}
            />
            <span>Strip assistant thinking blocks</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={stripAssistantContainerConfusion}
              onChange={(e) => setStripAssistantContainerConfusion(e.target.checked)}
            />
            <span>Strip assistant container confusion</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={dedupeAssistantMessages}
              onChange={(e) => setDedupeAssistantMessages(e.target.checked)}
            />
            <span>Deduplicate assistant messages</span>
          </label>
          <label className="field">
            <span>Dedupe similarity threshold</span>
            <input
              type="number"
              value={assistantSimilarityThreshold}
              onChange={(e) => setAssistantSimilarityThreshold(Number(e.target.value))}
              min={0.5}
              max={1}
              step={0.01}
            />
          </label>
          <label className="field">
            <span>Max assistant messages to keep</span>
            <input
              type="number"
              value={maxAssistantMessages}
              onChange={(e) => setMaxAssistantMessages(Number(e.target.value))}
              min={1}
              max={20}
            />
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={prioritizeUserMessages}
              onChange={(e) => setPrioritizeUserMessages(e.target.checked)}
            />
            <span>Prioritize user messages over assistant</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={includeProjectSnapshot}
              onChange={(e) => setIncludeProjectSnapshot(e.target.checked)}
            />
            <span>Include project snapshot</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={clientAwareResponseContract}
              onChange={(e) => setClientAwareResponseContract(e.target.checked)}
            />
            <span>Client-aware response contract</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={clineUseAttemptCompletion}
              onChange={(e) => setClineUseAttemptCompletion(e.target.checked)}
            />
            <span>Cline use attempt_completion</span>
          </label>
          <label className="field">
            <span>Max environment file list</span>
            <input
              type="number"
              value={maxEnvironmentFileList}
              onChange={(e) => setMaxEnvironmentFileList(Number(e.target.value))}
              min={10}
              step={10}
            />
          </label>
          <label className="field">
            <span>Max message chars</span>
            <input
              type="number"
              value={maxMessageChars}
              onChange={(e) => setMaxMessageChars(Number(e.target.value))}
              min={1000}
              step={1000}
            />
          </label>
          <label className="field">
            <span>Max tool result chars</span>
            <input
              type="number"
              value={maxToolResultChars}
              onChange={(e) => setMaxToolResultChars(Number(e.target.value))}
              min={1000}
              step={1000}
            />
          </label>
          <label className="field">
            <span>Max tool result count</span>
            <input
              type="number"
              value={maxToolResultCount}
              onChange={(e) => setMaxToolResultCount(Number(e.target.value))}
              min={1}
              max={50}
            />
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={preserveRawDebugFile}
              onChange={(e) => setPreserveRawDebugFile(e.target.checked)}
            />
            <span>Preserve raw debug file locally</span>
          </label>
        </div>
      </div>

      <div className="surface-card" style={{marginBottom: 16}}>
        <h3>Session Memory</h3>
        <div className="settings-grid">
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={sessionEnabled}
              onChange={(e) => setSessionEnabled(e.target.checked)}
            />
            <span>Enable session memory</span>
          </label>
          <label className="field">
            <span>History limit (messages)</span>
            <select value={historyLimit} onChange={(e) => setHistoryLimit(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={autoCompact}
              onChange={(e) => setAutoCompact(e.target.checked)}
            />
            <span>Auto compact</span>
          </label>
          <label className="field">
            <span>Compact after N messages</span>
            <input
              type="number"
              value={compactAfterMessages}
              onChange={(e) => setCompactAfterMessages(Number(e.target.value))}
              min={10}
              step={5}
            />
          </label>
          <label className="field">
            <span>Compact keep recent</span>
            <input
              type="number"
              value={compactKeepRecent}
              onChange={(e) => setCompactKeepRecent(Number(e.target.value))}
              min={1}
              max={20}
            />
          </label>
          <label className="field">
            <span>Compact model</span>
            <input
              value={compactModel}
              onChange={(e) => setCompactModel(e.target.value)}
            />
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={requireExplicitId}
              onChange={(e) => setRequireExplicitId(e.target.checked)}
            />
            <span>Require explicit session ID</span>
          </label>
          <label className="toggle-field">
            <input type="checkbox" checked={fileBackedEnabled} onChange={(e) => setFileBackedEnabled(e.target.checked)} />
            <span>File-backed sessions (create on overflow)</span>
          </label>
          <label className="toggle-field">
            <input type="checkbox" checked={createOnOverflow} onChange={(e) => setCreateOnOverflow(e.target.checked)} />
            <span>Create on overflow</span>
          </label>
          <label className="field">
            <span>Fallback mode</span>
            <div>
              <select value={fallbackMode} onChange={(e) => setFallbackMode(e.target.value)}>
                <option value="file-backed">File-backed (create session on overflow)</option>
                <option value="stateless">Stateless (no persistent session)</option>
                <option value="transient">Transient (auto-create)</option>
                <option value="shared-default">Shared default</option>
              </select>
              <p className="field-hint" style={{marginTop: 4, fontSize: '0.85em', color: 'var(--color-text-secondary)'}}>
                {fallbackMode === 'file-backed'
                  ? 'Recommended. Sessions are created only when overflow files are generated (i.e., conversation exceeds token threshold). Before overflow, requests are stateless. Once an overflow file is created, a file-backed session anchors the conversation.'
                  : fallbackMode === 'stateless'
                    ? 'Sessions only exist if the client sends x-luna-session-id. The Sessions page will appear empty for clients without explicit session IDs. Best for stateless API usage.'
                    : fallbackMode === 'transient'
                      ? 'A session is auto-created for every request that lacks an explicit ID. Sessions page will show all conversations, but session grouping may not reflect actual logical threads. Best for debugging/diagnostics.'
                      : 'All requests without explicit session IDs share a single "default" session. Different sources/workspaces still create separate sessions. Use with caution as unrelated conversations mix.'}
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="surface-card" style={{marginBottom: 16}}>
        <h3>Multi-thread</h3>
        <div className="settings-grid">
          <label className="toggle-field">
            <input type="checkbox" checked={mtEnabled} onChange={(e) => setMtEnabled(e.target.checked)} />
            <span>Enable multi-thread scheduler</span>
          </label>
          <label className="field">
            <span>Global max concurrent runs</span>
            <input type="number" value={globalMaxConcurrent} onChange={(e) => setGlobalMaxConcurrent(Number(e.target.value))} min={1} />
          </label>
          <label className="field">
            <span>Provider max concurrent runs</span>
            <input type="number" value={providerMaxConcurrent} onChange={(e) => setProviderMaxConcurrent(Number(e.target.value))} min={1} />
          </label>
          <label className="field">
            <span>Account max concurrent runs</span>
            <input type="number" value={accountMaxConcurrent} onChange={(e) => setAccountMaxConcurrent(Number(e.target.value))} min={1} />
          </label>
          <label className="field">
            <span>Queue timeout (ms)</span>
            <input type="number" value={queueTimeoutMs} onChange={(e) => setQueueTimeoutMs(Number(e.target.value))} min={5000} step={5000} />
          </label>
          <label className="field">
            <span>Run timeout (ms)</span>
            <input type="number" value={runTimeoutMs} onChange={(e) => setRunTimeoutMs(Number(e.target.value))} min={10000} step={10000} />
          </label>
        </div>
      </div>

      <div className="surface-card" style={{marginBottom: 16}}>
        <h3>Provider IP Isolation</h3>
        <div className="settings-grid">
          <label className="toggle-field">
            <input type="checkbox" checked={egressEnabled} onChange={(e) => setEgressEnabled(e.target.checked)} />
            <span>Enable IP isolation</span>
          </label>
          {egressEnabled && (
            <>
              <label className="toggle-field">
                <input type="checkbox" checked={egressStrict} onChange={(e) => setEgressStrict(e.target.checked)} />
                <span>Strict mode (no fallback to direct)</span>
              </label>
              <label className="toggle-field">
                <input type="checkbox" checked={egressFallback} onChange={(e) => setEgressFallback(e.target.checked)} />
                <span>Allow fallback to direct</span>
              </label>
              <label className="toggle-field">
                <input type="checkbox" checked={egressVerify} onChange={(e) => setEgressVerify(e.target.checked)} />
                <span>Verify IP before use</span>
              </label>
            </>
          )}
        </div>
        <div className="detail-grid" style={{marginTop: 12}}>
          <dt>Direct IP</dt>
          <dd>{directIp || 'checking...'} <span className="muted">({directIpSource})</span></dd>
        </div>
        {egressEnabled && (
          <p style={{marginTop: 8, fontSize: '0.85em', padding: '8px 12px', background: 'var(--color-warning-bg)', borderRadius: 4}}>
            IP isolation requires workers running through VPN/proxy/network namespaces.
            If strict mode is enabled, Proxy-Luna will not call providers directly when no verified worker is available.
          </p>
        )}
      </div>

      <div className="action-row">
        <button onClick={saveSettings} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
