// ==UserScript==
// @name         FireMonkey Hub
// @version      0.9
// @description  Unified floating action hub for all FireMonkey userscripts
// @author       cam-barts
// @match        *://*/*
// @run-at       document-idle
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.openInTab
// @grant        GM.notification
// @grant        GM.registerMenuCommand
// @grant        GM.addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub.user.js
// ==/UserScript==

// Architecture
// ------------
// One script, one realm. The Hub owns both the UI and GM storage; there is no
// separate Backend and no request/response RPC. That removes the class of races
// the split design had (declarations queued against a backend that had not
// answered yet, a one-shot readiness latch, a tab-lifetime state cache).
//
//  * Storage is truth. `fmhub.state.v1` is the only authoritative copy. Every
//    mutation is read-modify-write through `withState()`, which serialises
//    writes WITHIN THIS TAB so concurrent declarations cannot clobber each
//    other. Cross-tab, a remote write landing inside another tab's
//    load→save window can still lose (last-writer-wins); the window is
//    milliseconds instead of the old tab-lifetime cache, and
//    GM.addValueChangeListener re-syncs the UI afterwards, but it is not
//    zero. `_stateCache` exists only so render functions can be synchronous.
//  * Symmetric handshake. Consumers loading first hear the startup
//    `fmhub:hubReady` broadcast; consumers loading later emit `fmhub:ping` and
//    get a `fmhub:hubReady` back. Re-declaration is a keyed upsert, so any
//    number of hubReady events converge on the same state.
//  * Ordering. All listeners are registered synchronously, before the first
//    await. State load, self-declare and the hubReady broadcast happen after,
//    so a declaration triggered by hubReady always reaches storage.
//
// Consumer protocol (JSON-string CustomEvent detail, cross-realm safe):
//   in : fmhub:declareScript, fmhub:registerCommand, fmhub:unregisterCommand,
//        fmhub:setCommandEnabled, fmhub:registerFeature, fmhub:setFeatureEnabled,
//        fmhub:ping
//   out: fmhub:hubReady, fmhub:featureChanged, fmhub:invoke

(async function () {
  'use strict';

  // ── Debug Logger ───────────────────────────────────────────────────
  if (typeof window.__FMHUB_DEBUG__ === 'undefined') window.__FMHUB_DEBUG__ = true;
  function _dbg(...args) {
    if (!window.__FMHUB_DEBUG__) return;
    try { console.log('[fmhub]', ...args); } catch { }
  }
  _dbg('script loaded, location=', location.href);

  // ── State shape ────────────────────────────────────────────────────

  const STATE_KEY = 'fmhub.state.v1';
  const SELF_ID = 'firemonkey-hub';
  const SELF_URL = 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub.user.js';
  const STALE_MS = 21600000;   // 6h before an automatic update check is worth it

  const DEFAULT_STATE = {
    features: {},
    scripts: {},
    repo: {
      url: 'https://github.com/cam-barts/userscripts',
      branch: 'main',
      lastCheckedAt: null,
      lastDiscoveredAt: null,
      knownPaths: [],
      ignored: [],
    },
    ui: { position: null, collapsed: true, lastTab: 0 },
  };

  // UI-only mirror of storage. Never authoritative: read it to render, never to
  // decide what to persist.
  let _stateCache = null;

  let _readyResolve;
  const _ready = new Promise(r => (_readyResolve = r));

  // UI handles, declared early so event handlers can never hit the TDZ.
  let _host, _shadow, _btnEl, _panelEl, _contentEl;
  let _panelOpen = false;
  let _activeTab = 0;
  let _dragOffX = 0, _dragOffY = 0;
  let _panelX = null, _panelY = null;
  let _btnX = null, _btnY = null;

  // ── Storage ────────────────────────────────────────────────────────

  async function loadState() {
    const raw = await GM.getValue(STATE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    try {
      const saved = JSON.parse(raw);
      return {
        features: saved.features || {},
        scripts: saved.scripts || {},
        repo: { ...DEFAULT_STATE.repo, ...(saved.repo || {}) },
        ui: { ...DEFAULT_STATE.ui, ...(saved.ui || {}) },
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  async function saveState(state) {
    await GM.setValue(STATE_KEY, JSON.stringify(state));
  }

  // Serialised read-modify-write. `fn(state)` mutates in place; returning false
  // means "nothing changed, skip the write". Serialisation matters: several
  // consumers declare themselves within the same tick and an unqueued
  // load/save pair would drop all but the last.
  let _writeChain = Promise.resolve();
  function withState(fn) {
    _writeChain = _writeChain.then(async () => {
      const s = await loadState();
      const changed = await fn(s);
      if (changed !== false) await saveState(s);
      _stateCache = s;
    }).catch((err) => { _dbg('state write failed:', err && err.message); });
    return _writeChain;
  }

  // ── Event protocol (cross-realm safe; JSON-string detail only) ─────

  function _emit(type, payload) {
    document.dispatchEvent(new CustomEvent('fmhub:' + type, {
      detail: JSON.stringify(payload == null ? {} : payload)
    }));
  }

  function _onEvent(type, handler) {
    document.addEventListener('fmhub:' + type, function (e) {
      try { handler(JSON.parse(e.detail || '{}')); }
      catch (err) { _dbg('event parse error', type, err && err.message); }
    });
  }

  // ── Registries ─────────────────────────────────────────────────────

  const _commands = new Map();
  const _features = new Map();

  // `cache` lets callers evaluate against a snapshot (used to diff before/after
  // a state refresh); omit it to use the live UI cache.
  function _featureEnabled(id, cache) {
    const reg = _features.get(id);
    if (!reg) return true;
    const src = cache || _stateCache?.features;
    const f = src && src[id];
    if (!f) return reg.defaultEnabled !== false;
    const host = location.hostname;
    if (reg.scope === 'origin' && host && f.origins && f.origins[host] !== undefined) return f.origins[host];
    return f.enabled !== undefined ? f.enabled : (reg.defaultEnabled !== false);
  }

  function _broadcastFeature(id) {
    _emit('featureChanged', { id, enabled: _featureEnabled(id) });
  }

  // ── State mutations (all read-modify-write) ────────────────────────

  // Keyed upsert. Returns false when the stored entry is already identical, so
  // a script re-declaring itself on every page load costs zero writes.
  function _upsertScript(state, id, config) {
    const prev = state.scripts[id] || {};
    const next = {
      name: config.name,
      version: config.version,
      updateURL: config.updateURL || '',
      downloadURL: config.downloadURL || '',
      description: config.description || '',
      upstreamURL: config.upstreamURL || null,
      latestKnown: prev.latestKnown || null,
      dismissedUpdates: prev.dismissedUpdates || [],
    };
    if (JSON.stringify(prev) === JSON.stringify(next)) return false;
    state.scripts[id] = next;
    return true;
  }

  function declareScript(config) {
    if (!config || !config.id) return Promise.resolve();
    _dbg('declareScript', config.id, 'v' + config.version);
    return withState((s) => _upsertScript(s, config.id, config)).then(() => {
      _updateBadge();
      _renderActiveTab();
    });
  }

  function setFeatureEnabled(id, enabled, scope) {
    return withState((s) => {
      if (!s.features[id]) s.features[id] = { enabled: true, origins: {} };
      const f = s.features[id];
      if (scope === 'origin') {
        f.origins = f.origins || {};
        f.origins[location.hostname] = enabled;
      } else {
        f.enabled = enabled;
      }
      f.updatedAt = new Date().toISOString();
    }).then(() => {
      _broadcastFeature(id);
      _renderActiveTab();
    });
  }

  function clearFeatureOrigin(id) {
    return withState((s) => {
      const f = s.features[id];
      if (!f || !f.origins || f.origins[location.hostname] === undefined) return false;
      delete f.origins[location.hostname];
    }).then(() => {
      _broadcastFeature(id);
      _renderActiveTab();
    });
  }

  function setUI(patch) {
    return withState((s) => { Object.assign(s.ui, patch); });
  }

  function dismissUpdate(id, version) {
    return withState((s) => {
      const script = s.scripts[id];
      if (!script) return false;
      if (!script.dismissedUpdates) script.dismissedUpdates = [];
      if (script.dismissedUpdates.includes(version)) return false;
      script.dismissedUpdates.push(version);
    }).then(() => { _updateBadge(); _renderActiveTab(); });
  }

  function ignoreRepoScript(path) {
    return withState((s) => {
      if (s.repo.ignored.includes(path)) return false;
      s.repo.ignored.push(path);
    }).then(_renderActiveTab);
  }

  function setRepoConfig(url, branch) {
    return withState((s) => { s.repo.url = url; s.repo.branch = branch; });
  }

  function resetState() {
    return withState((s) => { Object.assign(s, structuredClone(DEFAULT_STATE)); })
      .then(() => { _updateBadge(); _renderActiveTab(); });
  }

  // ── Network ────────────────────────────────────────────────────────

  function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: options.method || 'GET',
        url,
        headers: options.headers || {},
        onload(r) { resolve({ status: r.status, responseText: r.responseText }); },
        onerror() { reject(new Error('Network error')); },
        ontimeout() { reject(new Error('Timeout')); },
      });
    });
  }

  function getResponseText(r) {
    return (r && typeof r.responseText === 'string') ? r.responseText : '';
  }

  // Fetches each declared script's @updateURL (raw.githubusercontent.com, not
  // the rate-limited API) and records any newer @version.
  async function checkUpdates() {
    const snapshot = await loadState();
    const entries = Object.entries(snapshot.scripts);
    if (!entries.length) return [];

    const found = new Map();
    await Promise.all(entries.map(async ([id, script]) => {
      if (!script.updateURL) return;
      try {
        const text = getResponseText(await gmFetch(script.updateURL));
        if (!text) return;
        const metaEnd = text.search(/==\/UserScript==/i);
        const header = metaEnd > 0 ? text.slice(0, metaEnd + 20) : text.slice(0, 2000);
        const m = header.match(/^\/\/ @version\s+(\S+)/m);
        if (!m) return;
        const remoteVersion = m[1].trim();
        const newer = remoteVersion.localeCompare(
          script.version, undefined, { numeric: true, sensitivity: 'base' }
        ) > 0;
        if (!newer) return;
        found.set(id, { version: remoteVersion, fetchedAt: new Date().toISOString() });
      } catch { /* network errors are non-fatal */ }
    }));

    const results = [];
    await withState((s) => {
      for (const [id, latest] of found) {
        const script = s.scripts[id];
        if (!script || script.dismissedUpdates?.includes(latest.version)) continue;
        script.latestKnown = latest;
        results.push({ id, name: script.name, localVersion: script.version, remoteVersion: latest.version });
      }
      s.repo.lastCheckedAt = new Date().toISOString();
    });
    _updateBadge();
    _renderActiveTab();
    return results;
  }

  // Manual only: this is the GitHub API call, so it never runs unprompted.
  async function discoverRepo() {
    const snapshot = await loadState();
    const repoPath = snapshot.repo.url.replace('https://github.com/', '').replace(/\/$/, '');
    const r = await gmFetch(`https://api.github.com/repos/${repoPath}/contents/scripts`);
    let paths;
    try {
      paths = JSON.parse(getResponseText(r)).filter(f => f.name.endsWith('.user.js')).map(f => f.path);
    } catch { _dbg('discoverRepo: unparseable listing'); return; }
    await withState((s) => {
      s.repo.knownPaths = paths;
      s.repo.lastDiscoveredAt = new Date().toISOString();
    });
    _renderActiveTab();
  }

  // ── Internal handlers ──────────────────────────────────────────────

  // invokeFn is what runs when the user clicks "Run".
  // For cross-realm consumers, it dispatches fmhub:invoke; the consumer's
  // local listener runs the actual callback.
  function _internalRegisterCommand(config, invokeFn) {
    if (!config || !config.id) return;
    _dbg('registerCommand', config.id, 'group=', config.group || '(none)');
    _commands.set(config.id, {
      name: config.name || config.id,
      tooltip: config.tooltip || '',
      color: config.color || '#4CAF50',
      group: config.group || '',
      enabled: config.enabled !== false,
      invoke: invokeFn,
    });
    _renderActiveTab();
  }

  function _internalUnregisterCommand(id) {
    _commands.delete(id);
    _renderActiveTab();
  }

  function _internalSetCommandEnabled(id, enabled) {
    const c = _commands.get(id);
    if (!c) return;
    c.enabled = !!enabled;
    _renderActiveTab();
  }

  function _internalRegisterFeature(config) {
    if (!config || !config.id) return;
    _dbg('registerFeature', config.id, 'scope=', config.scope || 'global');
    _features.set(config.id, {
      label: config.label || config.id,
      description: config.description || '',
      defaultEnabled: config.defaultEnabled !== false,
      scope: config.scope || 'global',
    });
    // Once state is loaded, push initial state to the consumer so onEnable/onDisable run.
    _ready.then(() => {
      _broadcastFeature(config.id);
      _renderActiveTab();
    });
  }

  // ── Event listeners (registered before any await - see Architecture) ─

  _onEvent('declareScript', (p) => declareScript(p));
  _onEvent('registerCommand', (p) => {
    _internalRegisterCommand(p, () => _emit('invoke', { id: p.id }));
  });
  _onEvent('unregisterCommand', (p) => _internalUnregisterCommand(p.id));
  _onEvent('setCommandEnabled', (p) => _internalSetCommandEnabled(p.id, p.enabled));
  _onEvent('registerFeature', (p) => _internalRegisterFeature(p));
  _onEvent('setFeatureEnabled', (p) => setFeatureEnabled(p.id, p.enabled, p.scope || 'global'));
  // Symmetric handshake: consumers that load after the Hub ask, and get the
  // same hubReady the early ones were broadcast. Idempotent: every
  // re-declaration is a keyed upsert.
  _onEvent('ping', () => _emit('hubReady'));

  // ── Same-realm API (kept minimal for diagnostic / direct access) ───
  // Cross-realm consumers must use the event protocol.

  window.FireMonkeyHub = {
    get ready() { return _ready; },
    declareScript,
    registerCommand(config) {
      if (!config || !config.id) return { unregister() {}, setEnabled() {} };
      _internalRegisterCommand(config, () => {
        try { typeof config.callback === 'function' && config.callback(); }
        catch (err) { console.error('[fmhub] cmd error:', err); }
      });
      return {
        unregister() { _internalUnregisterCommand(config.id); },
        setEnabled(val) { _internalSetCommandEnabled(config.id, val); },
      };
    },
    registerFeature(config) {
      if (!config || !config.id) return { isEnabled: () => true, setEnabled: async () => {}, onChange: () => () => {} };
      const listeners = [];
      _internalRegisterFeature(config);
      // Same-realm callers: bridge featureChanged events back to onEnable/onDisable/listeners.
      let lastEnabled = null;
      document.addEventListener('fmhub:featureChanged', function (e) {
        try {
          const data = JSON.parse(e.detail || '{}');
          if (data.id !== config.id) return;
          if (lastEnabled === data.enabled) return;
          lastEnabled = data.enabled;
          if (data.enabled && typeof config.onEnable === 'function') { try { config.onEnable(); } catch (err) { console.error('[fmhub] onEnable:', err); } }
          if (!data.enabled && typeof config.onDisable === 'function') { try { config.onDisable(); } catch (err) { console.error('[fmhub] onDisable:', err); } }
          for (const cb of listeners) { try { cb(data.enabled); } catch {} }
        } catch {}
      });
      return {
        isEnabled() { return _featureEnabled(config.id); },
        async setEnabled(val, scope = 'global') { await setFeatureEnabled(config.id, val, scope); },
        onChange(cb) { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
      };
    },
    openHub() { _openPanel(); },
    closeHub() { _closePanel(); },
    toggleHub() { _panelOpen ? _closePanel() : _openPanel(); },
  };

  // ── UI ─────────────────────────────────────────────────────────────

  const TABS = ['Actions', 'Features', 'Updates', 'Discover', 'Settings'];
  const CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    :host{all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px}
    .btn{position:fixed;bottom:20px;right:20px;width:44px;height:44px;border-radius:50%;background:#1B1D23;border:1.5px solid #444;color:#e6edf3;cursor:pointer;z-index:2147483600;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,.5);transition:border-color .2s,background .2s;user-select:none}
    .btn:hover{border-color:#58a6ff;background:#22252d}
    .btn.has-updates{border-color:#e3b341}
    .badge{position:absolute;top:1px;right:1px;width:11px;height:11px;background:#e3b341;border-radius:50%;border:2px solid #1B1D23;display:none}
    .btn.has-updates .badge{display:block}
    .panel{position:fixed;bottom:72px;right:20px;width:300px;background:#1B1D23;border:1px solid #30363d;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.6);z-index:2147483600;display:none;flex-direction:column;max-height:480px;overflow:hidden}
    .panel.open{display:flex}
    .hdr{display:flex;align-items:center;padding:10px 12px;background:#22252d;border-bottom:1px solid #30363d;cursor:grab;border-radius:8px 8px 0 0;gap:8px}
    .hdr:active{cursor:grabbing}
    .hdr-icon{font-size:16px}
    .hdr-title{flex:1;font-weight:600;color:#e6edf3;font-size:13px}
    .hdr-close{background:none;border:none;color:#8b949e;cursor:pointer;font-size:18px;line-height:1;padding:0 2px}
    .hdr-close:hover{color:#e6edf3}
    .tabs{display:flex;border-bottom:1px solid #30363d;background:#22252d}
    .tab{flex:1;padding:7px 2px;background:none;border:none;color:#8b949e;cursor:pointer;font-size:11px;text-align:center;border-bottom:2px solid transparent;transition:color .15s}
    .tab:hover{color:#e6edf3}
    .tab.active{color:#58a6ff;border-bottom-color:#58a6ff}
    .cnt{overflow-y:auto;flex:1}
    .cnt::-webkit-scrollbar{width:4px}
    .cnt::-webkit-scrollbar-thumb{background:#30363d;border-radius:2px}
    .section{padding:6px 12px 2px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#555;font-weight:600}
    .cmd{display:flex;align-items:center;padding:8px 12px;gap:8px;cursor:pointer}
    .cmd:hover{background:#22252d}
    .cmd.off{opacity:.4;cursor:default}
    .cmd-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .cmd-name{flex:1;color:#e6edf3;font-size:13px}
    .cmd-run{background:#22252d;border:1px solid #30363d;color:#e6edf3;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer}
    .cmd-run:hover{background:#2d3139}
    .disclosure-hdr{display:flex;align-items:center;padding:5px 12px;cursor:pointer;font-size:11px;color:#555;gap:4px}
    .disclosure-hdr:hover{color:#8b949e}
    .disclosure-body{display:none}
    .disclosure-body.open{display:block}
    .feat{padding:8px 12px;border-bottom:1px solid #1e2128}
    .feat-row{display:flex;align-items:center;gap:8px}
    .feat-label{flex:1;color:#e6edf3;font-size:13px}
    .feat-desc{font-size:11px;color:#8b949e;margin-top:2px}
    .feat-site{margin-top:4px;font-size:11px;color:#8b949e;display:flex;align-items:center;gap:6px}
    .tw{position:relative;width:34px;height:18px;flex-shrink:0}
    .tw input{opacity:0;width:0;height:0;position:absolute}
    .ts{position:absolute;inset:0;background:#30363d;border-radius:9px;cursor:pointer;transition:background .2s}
    .ts::before{content:'';position:absolute;width:12px;height:12px;left:3px;top:3px;background:#e6edf3;border-radius:50%;transition:transform .2s}
    .tw input:checked+.ts{background:#238636}
    .tw input:checked+.ts::before{transform:translateX(16px)}
    .upd-hdr{display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #1e2128;gap:8px}
    .upd-hdr-ts{flex:1;font-size:11px;color:#555}
    .upd{padding:8px 12px;border-bottom:1px solid #1e2128}
    .upd-name{color:#e6edf3;font-size:13px;font-weight:500}
    .upd-ver{font-size:11px;color:#8b949e;margin-top:1px}
    .upd-ver .new{color:#56d364}
    .upd-acts{display:flex;gap:6px;margin-top:4px}
    .disc{padding:8px 12px;border-bottom:1px solid #1e2128}
    .disc-name{color:#e6edf3;font-size:13px;font-weight:500}
    .disc-desc{font-size:11px;color:#8b949e;margin-top:1px}
    .disc-acts{display:flex;gap:6px;margin-top:4px}
    .sbtn{padding:3px 10px;border-radius:4px;font-size:11px;cursor:pointer;border:1px solid #30363d;background:#22252d;color:#e6edf3}
    .sbtn:hover{background:#2d3139}
    .sbtn.primary{background:#238636;border-color:#238636;color:#fff}
    .sbtn.primary:hover{background:#2ea043}
    .settings{padding:10px 12px}
    .settings label{display:block;color:#8b949e;font-size:11px;margin-bottom:3px;margin-top:10px}
    .settings label:first-of-type{margin-top:0}
    .settings input{width:100%;background:#22252d;border:1px solid #30363d;border-radius:4px;color:#e6edf3;padding:5px 8px;font-size:12px}
    .settings input:focus{outline:1px solid #58a6ff;outline-offset:0}
    .settings-btn{margin-top:10px;padding:5px 12px;border-radius:4px;font-size:12px;cursor:pointer;border:1px solid #30363d;background:#22252d;color:#e6edf3}
    .settings-btn:hover{background:#2d3139}
    .settings-btn.danger{color:#f85149}
    .empty{padding:20px 12px;text-align:center;color:#8b949e;font-size:12px}
  `;

  function _createUI() {
    _host = document.createElement('div');
    _host.id = 'fmhub-host';
    _shadow = _host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    _shadow.appendChild(style);

    _btnEl = document.createElement('button');
    _btnEl.className = 'btn';
    _btnEl.title = 'FireMonkey Hub';
    _btnEl.innerHTML = '⚙<span class="badge"></span>';
    _btnEl.addEventListener('click', () => _togglePanel());
    _btnEl.addEventListener('mousedown', _startBtnDrag);
    _shadow.appendChild(_btnEl);

    _panelEl = document.createElement('div');
    _panelEl.className = 'panel';

    const hdr = document.createElement('div');
    hdr.className = 'hdr';
    hdr.innerHTML = '<span class="hdr-icon">⚙</span><span class="hdr-title">FireMonkey Hub</span>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'hdr-close';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', _closePanel);
    hdr.appendChild(closeBtn);
    hdr.addEventListener('mousedown', _startPanelDrag);
    _panelEl.appendChild(hdr);

    const tabBar = document.createElement('div');
    tabBar.className = 'tabs';
    TABS.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'tab' + (i === _activeTab ? ' active' : '');
      btn.textContent = name;
      btn.dataset.tab = i;
      btn.addEventListener('click', () => _switchTab(i));
      tabBar.appendChild(btn);
    });
    _panelEl.appendChild(tabBar);

    _contentEl = document.createElement('div');
    _contentEl.className = 'cnt';
    _panelEl.appendChild(_contentEl);

    _shadow.appendChild(_panelEl);
    document.body.appendChild(_host);

    _applyStoredPosition();
    _renderActiveTab();
  }

  function _applyStoredPosition() {
    if (_stateCache?.ui?.position) {
      const pos = _stateCache.ui.position;
      _setBtnPos(pos.btnX, pos.btnY);
      if (pos.panelX !== null && pos.panelY !== null) {
        _setPanelPos(pos.panelX, pos.panelY);
      }
    }
    if (_stateCache?.ui?.collapsed === false) {
      _openPanel();
    }
    if (_stateCache?.ui?.lastTab !== undefined) {
      _switchTab(_stateCache.ui.lastTab, false);
    }
  }

  function _setBtnPos(x, y) {
    if (x === null || y === null) return;
    _btnX = x; _btnY = y;
    _btnEl.style.left = x + 'px';
    _btnEl.style.top = y + 'px';
    _btnEl.style.right = '';
    _btnEl.style.bottom = '';
  }

  function _setPanelPos(x, y) {
    if (x === null || y === null) return;
    _panelX = x; _panelY = y;
    _panelEl.style.left = x + 'px';
    _panelEl.style.top = y + 'px';
    _panelEl.style.right = '';
    _panelEl.style.bottom = '';
  }

  function _startBtnDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = _btnEl.getBoundingClientRect();
    _dragOffX = e.clientX - rect.left;
    _dragOffY = e.clientY - rect.top;
    let moved = false;
    function onMove(e) {
      moved = true;
      const x = Math.max(0, Math.min(window.innerWidth - 44, e.clientX - _dragOffX));
      const y = Math.max(0, Math.min(window.innerHeight - 44, e.clientY - _dragOffY));
      _setBtnPos(x, y);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (moved) setUI({ position: { ...((_stateCache?.ui?.position) || {}), btnX: _btnX, btnY: _btnY } });
      if (!moved) _togglePanel();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function _startPanelDrag(e) {
    if (e.button !== 0) return;
    const rect = _panelEl.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    function onMove(e) {
      const x = Math.max(0, Math.min(window.innerWidth - 300, e.clientX - offX));
      const y = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - offY));
      _setPanelPos(x, y);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setUI({ position: { ...((_stateCache?.ui?.position) || {}), panelX: _panelX, panelY: _panelY } });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function _openPanel() {
    _panelOpen = true;
    _panelEl.classList.add('open');
    _renderActiveTab();
    setUI({ collapsed: false });
  }

  function _closePanel() {
    _panelOpen = false;
    _panelEl.classList.remove('open');
    setUI({ collapsed: true });
  }

  function _togglePanel() {
    _panelOpen ? _closePanel() : _openPanel();
  }

  function _switchTab(i, save = true) {
    _activeTab = i;
    _shadow.querySelectorAll('.tab').forEach((btn, j) => {
      btn.classList.toggle('active', j === i);
    });
    _renderActiveTab();
    if (save) setUI({ lastTab: i });
  }

  function _updateBadge() {
    if (!_stateCache || !_btnEl) return;
    const hasUpdate = Object.values(_stateCache.scripts || {}).some(s =>
      s.latestKnown && !s.dismissedUpdates?.includes(s.latestKnown.version)
    );
    _btnEl.classList.toggle('has-updates', hasUpdate);
  }

  function _renderActiveTab() {
    if (!_panelEl || !_contentEl || !_panelOpen) return;
    _contentEl.innerHTML = '';
    const renders = [_renderActions, _renderFeatures, _renderUpdates, _renderDiscover, _renderSettings];
    renders[_activeTab]?.();
  }

  function _renderActions() {
    const cmds = [..._commands.entries()];
    if (!cmds.length) {
      const el = document.createElement('div');
      el.className = 'empty';
      el.textContent = 'No actions registered.';
      _contentEl.appendChild(el);
      return;
    }
    const groups = new Map();
    for (const [id, cmd] of cmds) {
      const g = cmd.group || '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push([id, cmd]);
    }
    const enabled = [];
    const disabled = [];
    for (const [g, list] of groups) {
      for (const entry of list) {
        (entry[1].enabled ? enabled : disabled).push([g, entry]);
      }
    }
    let lastGroup = null;
    for (const [g, [id, cmd]] of enabled) {
      if (g && g !== lastGroup) {
        const sec = document.createElement('div');
        sec.className = 'section';
        sec.textContent = g;
        _contentEl.appendChild(sec);
        lastGroup = g;
      }
      _contentEl.appendChild(_cmdRow(id, cmd, true));
    }
    if (disabled.length) {
      const disc = document.createElement('div');
      disc.innerHTML = `<div class="disclosure-hdr">▸ Disabled (${disabled.length})</div><div class="disclosure-body"></div>`;
      disc.querySelector('.disclosure-hdr').addEventListener('click', (e) => {
        const body = disc.querySelector('.disclosure-body');
        body.classList.toggle('open');
        e.currentTarget.textContent = body.classList.contains('open')
          ? `▾ Disabled (${disabled.length})` : `▸ Disabled (${disabled.length})`;
      });
      for (const [, [id, cmd]] of disabled) {
        disc.querySelector('.disclosure-body').appendChild(_cmdRow(id, cmd, false));
      }
      _contentEl.appendChild(disc);
    }
  }

  function _cmdRow(id, cmd, enabled) {
    const row = document.createElement('div');
    row.className = 'cmd' + (enabled ? '' : ' off');
    const dot = document.createElement('span');
    dot.className = 'cmd-dot';
    dot.style.background = cmd.color;
    const name = document.createElement('span');
    name.className = 'cmd-name';
    name.textContent = cmd.name;
    if (cmd.tooltip) name.title = cmd.tooltip;
    row.appendChild(dot);
    row.appendChild(name);
    if (enabled && typeof cmd.invoke === 'function') {
      const runBtn = document.createElement('button');
      runBtn.className = 'cmd-run';
      runBtn.textContent = 'Run';
      runBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { cmd.invoke(); } catch (err) { console.error('[fmhub] invoke error:', err); }
      });
      row.appendChild(runBtn);
      row.addEventListener('click', () => { try { cmd.invoke(); } catch { } });
    }
    return row;
  }

  function _renderFeatures() {
    const feats = [..._features.entries()];
    if (!feats.length) {
      const el = document.createElement('div');
      el.className = 'empty';
      el.textContent = 'No features registered.';
      _contentEl.appendChild(el);
      return;
    }
    for (const [id, feat] of feats) {
      const row = document.createElement('div');
      row.className = 'feat';
      const globalEnabled = _stateCache?.features[id]?.enabled ?? feat.defaultEnabled;
      const toggle = _mkToggle(globalEnabled, (val) => setFeatureEnabled(id, val, 'global'));
      const label = document.createElement('span');
      label.className = 'feat-label';
      label.textContent = feat.label;
      const top = document.createElement('div');
      top.className = 'feat-row';
      top.appendChild(toggle);
      top.appendChild(label);
      row.appendChild(top);
      if (feat.description) {
        const desc = document.createElement('div');
        desc.className = 'feat-desc';
        desc.textContent = feat.description;
        row.appendChild(desc);
      }
      if (feat.scope === 'origin') {
        const host = location.hostname;
        const siteVal = (_stateCache?.features[id]?.origins || {})[host];
        const siteRow = document.createElement('div');
        siteRow.className = 'feat-site';
        siteRow.textContent = host + ': ';
        const siteBtn = document.createElement('span');
        siteBtn.className = 'feat-site-val';
        siteBtn.textContent = siteVal === undefined
          ? 'inherits global'
          : (siteVal ? 'ON (override)' : 'OFF (override)');
        // Cycle: inherit → opposite of global → back to inherit.
        siteBtn.addEventListener('click', () => {
          if (siteVal === undefined) setFeatureEnabled(id, !globalEnabled, 'origin');
          else if (siteVal !== globalEnabled) clearFeatureOrigin(id);
          else setFeatureEnabled(id, !siteVal, 'origin');
        });
        siteRow.appendChild(siteBtn);
        row.appendChild(siteRow);
      }
      _contentEl.appendChild(row);
    }
  }

  function _mkToggle(checked, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'tw';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const slider = document.createElement('span');
    slider.className = 'ts';
    wrap.appendChild(input);
    wrap.appendChild(slider);
    return wrap;
  }

  function _normalizeRawURL(url) {
    if (!url) return '';
    const stripped = url.replace('/refs/heads/', '/');
    try { return decodeURIComponent(stripped); } catch { return stripped; }
  }

  function _tsHeader(iso, btnLabel, onClick) {
    const hdr = document.createElement('div');
    hdr.className = 'upd-hdr';
    const tsEl = document.createElement('span');
    tsEl.className = 'upd-hdr-ts';
    tsEl.textContent = iso ? 'Checked: ' + new Date(iso).toLocaleString() : 'Never checked';
    const btn = document.createElement('button');
    btn.className = 'sbtn';
    btn.textContent = btnLabel;
    btn.addEventListener('click', async () => {
      btn.textContent = '…';
      btn.disabled = true;
      try { await onClick(); } catch { }
      btn.textContent = btnLabel;
      btn.disabled = false;
      _renderActiveTab();
    });
    hdr.appendChild(tsEl);
    hdr.appendChild(btn);
    return hdr;
  }

  function _renderUpdates() {
    _contentEl.appendChild(_tsHeader(_stateCache?.repo?.lastCheckedAt, 'Check now', checkUpdates));

    const scripts = Object.entries(_stateCache?.scripts || {});
    if (!scripts.length) {
      const el = document.createElement('div');
      el.className = 'empty';
      el.textContent = 'No scripts declared yet.';
      _contentEl.appendChild(el);
      return;
    }
    for (const [id, script] of scripts) {
      const latest = script.latestKnown;
      const hasUpdate = latest && !script.dismissedUpdates?.includes(latest.version);
      const row = document.createElement('div');
      row.className = 'upd';
      const name = document.createElement('div');
      name.className = 'upd-name';
      name.textContent = script.name;
      const ver = document.createElement('div');
      ver.className = 'upd-ver';
      if (hasUpdate) {
        ver.innerHTML = `v${script.version} → <span class="new">v${latest.version} available</span>`;
      } else {
        ver.textContent = `v${script.version} - up to date`;
      }
      row.appendChild(name);
      row.appendChild(ver);
      if (hasUpdate) {
        const acts = document.createElement('div');
        acts.className = 'upd-acts';
        const updateBtn = document.createElement('button');
        updateBtn.className = 'sbtn primary';
        updateBtn.textContent = 'Update';
        updateBtn.addEventListener('click', () => GM.openInTab(script.downloadURL, { active: true }));
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'sbtn';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', () => dismissUpdate(id, latest.version));
        acts.appendChild(updateBtn);
        acts.appendChild(dismissBtn);
        row.appendChild(acts);
      }
      _contentEl.appendChild(row);
    }
    _updateBadge();
  }

  function _renderDiscover() {
    _contentEl.appendChild(_tsHeader(_stateCache?.repo?.lastDiscoveredAt, 'Refresh', discoverRepo));

    const installedURLs = new Set(
      Object.values(_stateCache?.scripts || {}).map(s => _normalizeRawURL(s.downloadURL)).filter(Boolean)
    );
    const ignored = new Set(_stateCache?.repo?.ignored || []);
    const repoBase = (_stateCache?.repo?.url || '').replace('https://github.com/', '');
    const branch = _stateCache?.repo?.branch || 'main';

    const discovered = (_stateCache?.repo?.knownPaths || []).filter(path =>
      !ignored.has(path) &&
      !installedURLs.has(_normalizeRawURL(`https://raw.githubusercontent.com/${repoBase}/${branch}/${path}`))
    );

    if (!discovered.length) {
      const el = document.createElement('div');
      el.className = 'empty';
      el.textContent = 'No new scripts found. Click Refresh to check.';
      _contentEl.appendChild(el);
      return;
    }

    for (const path of discovered) {
      const downloadURL = `https://raw.githubusercontent.com/${repoBase}/${branch}/${path}`;
      const row = document.createElement('div');
      row.className = 'disc';
      const nameEl = document.createElement('div');
      nameEl.className = 'disc-name';
      nameEl.textContent = path.split('/').pop().replace('.user.js', '');
      const acts = document.createElement('div');
      acts.className = 'disc-acts';
      const installBtn = document.createElement('button');
      installBtn.className = 'sbtn primary';
      installBtn.textContent = 'Install';
      installBtn.addEventListener('click', () => GM.openInTab(downloadURL, { active: true }));
      const ignoreBtn = document.createElement('button');
      ignoreBtn.className = 'sbtn';
      ignoreBtn.textContent = 'Ignore';
      ignoreBtn.addEventListener('click', () => ignoreRepoScript(path));
      acts.appendChild(installBtn);
      acts.appendChild(ignoreBtn);
      row.appendChild(nameEl);
      row.appendChild(acts);
      _contentEl.appendChild(row);
    }
  }

  function _renderSettings() {
    const wrap = document.createElement('div');
    wrap.className = 'settings';

    const repoLabel = document.createElement('label');
    repoLabel.textContent = 'Repo URL';
    const repoInput = document.createElement('input');
    repoInput.type = 'text';
    repoInput.value = _stateCache?.repo?.url || DEFAULT_STATE.repo.url;

    const branchLabel = document.createElement('label');
    branchLabel.textContent = 'Branch';
    const branchInput = document.createElement('input');
    branchInput.type = 'text';
    branchInput.value = _stateCache?.repo?.branch || DEFAULT_STATE.repo.branch;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-btn';
    saveBtn.textContent = 'Save settings';
    saveBtn.addEventListener('click', () => {
      setRepoConfig(repoInput.value.trim(), branchInput.value.trim());
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'settings-btn danger';
    resetBtn.textContent = 'Reset all Hub state';
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all FireMonkey Hub state? This clears feature toggles, update history, and repo tracking.')) {
        resetState();
      }
    });

    wrap.appendChild(repoLabel);
    wrap.appendChild(repoInput);
    wrap.appendChild(branchLabel);
    wrap.appendChild(branchInput);
    wrap.appendChild(saveBtn);
    wrap.appendChild(resetBtn);
    _contentEl.appendChild(wrap);
  }

  // ── SPA Nav Resilience ──────────────────────────────────────────────

  new MutationObserver(() => {
    if (_host && !document.body.contains(_host)) {
      document.body.appendChild(_host);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ── Init ────────────────────────────────────────────────────────────
  // Listeners above are live already. Everything below awaits, so any
  // declaration that arrives from here on is handled by a fully wired Hub.

  _stateCache = await loadState();
  _dbg('state loaded, scripts=', Object.keys(_stateCache.scripts).length,
    'features=', Object.keys(_stateCache.features).length);

  _createUI();
  _updateBadge();

  // Self-declare from GM.info (available without @grant) so the entry can never
  // drift from the metadata block. _upsertScript no-ops when nothing changed.
  await declareScript({
    id: SELF_ID,
    name: GM.info.script.name,
    version: GM.info.script.version,
    updateURL: SELF_URL,
    downloadURL: SELF_URL,
    description: GM.info.script.description || '',
  });

  _readyResolve();
  for (const [id] of _features) _broadcastFeature(id);
  _renderActiveTab();

  // Consumers that loaded before us listen for this and re-declare.
  _emit('hubReady');
  _dbg('dispatched fmhub:hubReady');

  // Cross-tab awareness. FireMonkey does not fire this for same-tab writes, so
  // there is no feedback loop with our own saveState.
  if (typeof GM.addValueChangeListener === 'function') {
    GM.addValueChangeListener(STATE_KEY, async () => {
      _stateCache = await loadState();
      _updateBadge();
      _renderActiveTab();
    });
  }

  GM.registerMenuCommand('FireMonkey Hub: Check for updates', async () => {
    const results = await checkUpdates();
    GM.notification({
      text: results.length
        ? `${results.length} update(s) available. Open the Hub to update.`
        : 'All scripts are up to date.',
    });
  });

  // Auto-check when stale. The jitter, plus re-reading lastCheckedAt after it,
  // stops N restored tabs from stampeding the same check.
  setTimeout(async () => {
    const s = await loadState();
    const last = s.repo.lastCheckedAt ? new Date(s.repo.lastCheckedAt).getTime() : 0;
    if (Date.now() - last > STALE_MS && Object.keys(s.scripts).length) checkUpdates();
  }, Math.random() * 10000);
})();
