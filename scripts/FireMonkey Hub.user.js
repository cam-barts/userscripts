// ==UserScript==
// @name         FireMonkey Hub
// @version      0.8
// @description  Unified floating action hub for all FireMonkey userscripts
// @author       cam-barts
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ── Debug Logger ───────────────────────────────────────────────────
  if (typeof window.__FMHUB_DEBUG__ === 'undefined') window.__FMHUB_DEBUG__ = true;
  function _dbg(...args) {
    if (!window.__FMHUB_DEBUG__) return;
    try { console.log('[fmhub:hub]', ...args); } catch { }
  }
  _dbg('script loaded, location=', location.href);

  // ── Bridge to backend ──────────────────────────────────────────────

  let _reqId = 0;
  let _backendAlive = false;
  let _readyResolve;
  const _ready = new Promise(r => (_readyResolve = r));
  let _stateCache = null;
  const _localScripts = {};

  function _request(type, payload = {}) {
    const id = ++_reqId;
    _dbg('_request →', type, 'id=', id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        document.removeEventListener('fmhub:response:' + id, handler);
        _dbg('_request TIMEOUT', type, 'id=', id);
        reject(new Error(`fmhub timeout: ${type}`));
      }, 8000);
      function handler(e) {
        clearTimeout(timer);
        try {
          const { ok, data, error } = JSON.parse(e.detail);
          _dbg('_request ←', type, 'id=', id, 'ok=', ok, error ? ('err=' + error) : '');
          if (ok) resolve(data);
          else reject(new Error(error || 'request failed'));
        } catch (err) { _dbg('_request parse error', type, err); reject(new Error('parse error')); }
      }
      document.addEventListener('fmhub:response:' + id, handler, { once: true });
      document.dispatchEvent(new CustomEvent('fmhub:request', {
        detail: JSON.stringify({ id, type, payload })
      }));
    });
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

  function _featureEnabled(id) {
    const reg = _features.get(id);
    if (!reg) return true;
    if (!_stateCache) return reg.defaultEnabled !== false;
    const f = _stateCache.features[id];
    if (!f) return reg.defaultEnabled !== false;
    const host = location.hostname;
    if (reg.scope === 'origin' && host && f.origins && f.origins[host] !== undefined) {
      return f.origins[host];
    }
    return f.enabled !== undefined ? f.enabled : (reg.defaultEnabled !== false);
  }

  function _featureEnabledFromCache(id, featureCache) {
    const reg = _features.get(id);
    if (!reg) return true;
    const f = featureCache[id];
    if (!f) return reg.defaultEnabled !== false;
    const host = location.hostname;
    if (reg.scope === 'origin' && host && f.origins && f.origins[host] !== undefined) return f.origins[host];
    return f.enabled !== undefined ? f.enabled : (reg.defaultEnabled !== false);
  }

  function _broadcastFeature(id) {
    _emit('featureChanged', { id, enabled: _featureEnabled(id) });
  }

  // ── Internal handlers (used by both event listeners and same-realm API) ─

  function _internalDeclareScript(config) {
    if (!config || !config.id) return;
    _dbg('declareScript', config.id, 'v' + config.version);
    const prev = _localScripts[config.id] || {};
    _localScripts[config.id] = {
      name: config.name,
      version: config.version,
      updateURL: config.updateURL || '',
      downloadURL: config.downloadURL || '',
      description: config.description || '',
      upstreamURL: config.upstreamURL || null,
      lastSeen: new Date().toISOString(),
      latestKnown: prev.latestKnown || null,
      dismissedUpdates: prev.dismissedUpdates || [],
    };
    if (_backendAlive) {
      _request('declareScript', {
        scriptId: config.id,
        name: config.name,
        version: config.version,
        updateURL: config.updateURL,
        downloadURL: config.downloadURL,
        description: config.description || '',
        upstreamURL: config.upstreamURL || null,
      }).catch((err) => { _dbg('declareScript backend failed', config.id, err && err.message); });
    } else {
      _dbg('declareScript queued locally (backend not alive)', config.id);
    }
    _renderActiveTab();
  }

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

  function _internalSetFeatureEnabled(id, enabled, scope) {
    if (!_stateCache) _stateCache = { features: {}, scripts: {}, repo: {}, ui: {}, rateLimit: {} };
    if (!_stateCache.features[id]) _stateCache.features[id] = { enabled: true, origins: {} };
    const host = location.hostname;
    if (scope === 'origin') {
      _stateCache.features[id].origins = _stateCache.features[id].origins || {};
      _stateCache.features[id].origins[host] = enabled;
    } else {
      _stateCache.features[id].enabled = enabled;
    }
    _broadcastFeature(id);
    if (_backendAlive) {
      _request('setFeatureEnabled', { featureId: id, enabled, scope: scope || 'global', origin: host }).catch(() => {});
    }
    _renderActiveTab();
  }

  // ── Event listeners (cross-realm registration) ─────────────────────

  _onEvent('declareScript', (p) => _internalDeclareScript(p));
  _onEvent('registerCommand', (p) => {
    _internalRegisterCommand(p, () => _emit('invoke', { id: p.id }));
  });
  _onEvent('unregisterCommand', (p) => _internalUnregisterCommand(p.id));
  _onEvent('setCommandEnabled', (p) => _internalSetCommandEnabled(p.id, p.enabled));
  _onEvent('registerFeature', (p) => _internalRegisterFeature(p));
  _onEvent('setFeatureEnabled', (p) => _internalSetFeatureEnabled(p.id, p.enabled, p.scope || 'global'));

  // ── Same-realm API (kept minimal for diagnostic / direct access) ───
  // Cross-realm consumers must use the event protocol.

  window.FireMonkeyHub = {
    get ready() { return _ready; },
    declareScript: _internalDeclareScript,
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
        async setEnabled(val, scope = 'global') { _internalSetFeatureEnabled(config.id, val, scope); },
        onChange(cb) { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
      };
    },
    openHub() { _openPanel(); },
    closeHub() { _closePanel(); },
    toggleHub() { _panelOpen ? _closePanel() : _openPanel(); },
  };

  window.fmhubDiag = function () {
    const out = {
      backendAlive: _backendAlive,
      stateCacheLoaded: !!_stateCache,
      commandCount: _commands.size,
      commandIds: [..._commands.keys()],
      featureCount: _features.size,
      featureIds: [..._features.keys()],
      localScriptIds: Object.keys(_localScripts),
      backendScriptIds: Object.keys(_stateCache?.scripts || {}),
      knownPaths: _stateCache?.repo?.knownPaths || [],
      ignored: _stateCache?.repo?.ignored || [],
      panelOpen: _panelOpen,
      activeTab: TABS[_activeTab],
    };
    console.log('[fmhub:diag]', out);
    return out;
  };

  // ── UI ─────────────────────────────────────────────────────────────

  let _host, _shadow, _btnEl, _panelEl, _contentEl;
  let _panelOpen = false;
  let _activeTab = 0;
  let _dragging = false;
  let _dragOffX = 0, _dragOffY = 0;
  let _panelX = null, _panelY = null;
  let _btnX = null, _btnY = null;

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
    .no-backend{margin:8px;padding:8px 10px;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.3);border-radius:4px;color:#f85149;font-size:12px}
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
    _dragging = true;
    let moved = false;
    function onMove(e) {
      moved = true;
      const x = Math.max(0, Math.min(window.innerWidth - 44, e.clientX - _dragOffX));
      const y = Math.max(0, Math.min(window.innerHeight - 44, e.clientY - _dragOffY));
      _setBtnPos(x, y);
    }
    function onUp() {
      _dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (moved && _backendAlive) {
        const pos = { ...((_stateCache?.ui?.position) || {}), btnX: _btnX, btnY: _btnY };
        _request('setUI', { position: pos }).catch(() => {});
      }
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
      if (_backendAlive) {
        const pos = { ...((_stateCache?.ui?.position) || {}), panelX: _panelX, panelY: _panelY };
        _request('setUI', { position: pos }).catch(() => {});
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function _openPanel() {
    _panelOpen = true;
    _panelEl.classList.add('open');
    _renderActiveTab();
    if (_backendAlive) _request('setUI', { collapsed: false }).catch(() => {});
  }

  function _closePanel() {
    _panelOpen = false;
    _panelEl.classList.remove('open');
    if (_backendAlive) _request('setUI', { collapsed: true }).catch(() => {});
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
    if (save && _backendAlive) _request('setUI', { lastTab: i }).catch(() => {});
  }

  function _updateBadge() {
    if (!_stateCache) return;
    const hasUpdate = Object.values(_stateCache.scripts || {}).some(s =>
      s.latestKnown && !s.dismissedUpdates?.includes(s.latestKnown.version)
    );
    _btnEl.classList.toggle('has-updates', hasUpdate);
  }

  function _renderActiveTab() {
    if (!_panelEl || !_contentEl || !_panelOpen) return;
    _contentEl.innerHTML = '';
    if (!_backendAlive) {
      const warn = document.createElement('div');
      warn.className = 'no-backend';
      warn.textContent = 'Backend not detected — install FireMonkey Hub Backend.';
      _contentEl.appendChild(warn);
    }
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
      for (const [g, [id, cmd]] of disabled) {
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
      const toggle = _mkToggle(globalEnabled, (val) => {
        _internalSetFeatureEnabled(id, val, 'global');
      });
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
        const overrides = _stateCache?.features[id]?.origins || {};
        const siteVal = overrides[host];
        const siteRow = document.createElement('div');
        siteRow.className = 'feat-site';
        siteRow.textContent = host + ': ';
        const siteBtn = document.createElement('span');
        siteBtn.className = 'feat-site-val';
        if (siteVal === undefined) {
          siteBtn.textContent = 'inherits global';
        } else {
          siteBtn.textContent = siteVal ? 'ON (override)' : 'OFF (override)';
        }
        siteBtn.addEventListener('click', () => {
          if (!_stateCache) _stateCache = { features: {}, scripts: {}, repo: {}, ui: {}, rateLimit: {} };
          if (!_stateCache.features[id]) _stateCache.features[id] = { enabled: true, origins: {} };
          let newVal;
          if (siteVal === undefined) {
            newVal = !globalEnabled;
            _stateCache.features[id].origins[host] = newVal;
          } else if (siteVal !== globalEnabled) {
            delete _stateCache.features[id].origins[host];
            newVal = globalEnabled;
          } else {
            newVal = !siteVal;
            _stateCache.features[id].origins[host] = newVal;
          }
          _broadcastFeature(id);
          if (_backendAlive) {
            _request('setFeatureEnabled', { featureId: id, enabled: newVal, scope: 'origin', origin: host }).catch(() => {});
          }
          _renderActiveTab();
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

  function _allDeclaredScripts() {
    const merged = { ..._localScripts };
    const remote = _stateCache?.scripts || {};
    for (const [id, s] of Object.entries(remote)) {
      merged[id] = { ...(merged[id] || {}), ...s };
    }
    return merged;
  }

  function _normalizeRawURL(url) {
    if (!url) return '';
    const stripped = url.replace('/refs/heads/', '/');
    try { return decodeURIComponent(stripped); } catch { return stripped; }
  }

  function _renderUpdates() {
    const hdr = document.createElement('div');
    hdr.className = 'upd-hdr';
    const ts = _stateCache?.repo?.lastCheckedAt
      ? 'Checked: ' + new Date(_stateCache.repo.lastCheckedAt).toLocaleString()
      : 'Never checked';
    const tsEl = document.createElement('span');
    tsEl.className = 'upd-hdr-ts';
    tsEl.textContent = ts;
    const checkBtn = document.createElement('button');
    checkBtn.className = 'sbtn';
    checkBtn.textContent = 'Check now';
    checkBtn.addEventListener('click', async () => {
      checkBtn.textContent = '…';
      checkBtn.disabled = true;
      try {
        await _request('checkUpdates', { force: true });
      } catch { }
      checkBtn.textContent = 'Check now';
      checkBtn.disabled = false;
      _renderActiveTab();
    });
    hdr.appendChild(tsEl);
    hdr.appendChild(checkBtn);
    _contentEl.appendChild(hdr);

    const scripts = Object.entries(_allDeclaredScripts());
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
        ver.textContent = `v${script.version} — up to date`;
      }
      row.appendChild(name);
      row.appendChild(ver);
      if (hasUpdate) {
        const acts = document.createElement('div');
        acts.className = 'upd-acts';
        const updateBtn = document.createElement('button');
        updateBtn.className = 'sbtn primary';
        updateBtn.textContent = 'Update';
        updateBtn.addEventListener('click', () => {
          if (_backendAlive) _request('openInTab', { url: script.downloadURL }).catch(() => {});
        });
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'sbtn';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', () => {
          if (_backendAlive) _request('dismissUpdate', { scriptId: id, version: latest.version }).catch(() => {});
          if (_stateCache?.scripts[id]) {
            if (!_stateCache.scripts[id].dismissedUpdates) _stateCache.scripts[id].dismissedUpdates = [];
            _stateCache.scripts[id].dismissedUpdates.push(latest.version);
          }
          _renderActiveTab();
        });
        acts.appendChild(updateBtn);
        acts.appendChild(dismissBtn);
        row.appendChild(acts);
      }
      _contentEl.appendChild(row);
    }
    _updateBadge();
  }

  function _renderDiscover() {
    const hdr = document.createElement('div');
    hdr.className = 'upd-hdr';
    const ts = _stateCache?.repo?.lastCheckedAt
      ? 'Checked: ' + new Date(_stateCache.repo.lastCheckedAt).toLocaleString()
      : 'Never checked';
    const tsEl = document.createElement('span');
    tsEl.className = 'upd-hdr-ts';
    tsEl.textContent = ts;
    const checkBtn = document.createElement('button');
    checkBtn.className = 'sbtn';
    checkBtn.textContent = 'Refresh';
    checkBtn.addEventListener('click', async () => {
      checkBtn.textContent = '…';
      checkBtn.disabled = true;
      try { await _request('discoverRepo'); } catch { }
      checkBtn.textContent = 'Refresh';
      checkBtn.disabled = false;
      _renderActiveTab();
    });
    hdr.appendChild(tsEl);
    hdr.appendChild(checkBtn);
    _contentEl.appendChild(hdr);

    const allDeclared = _allDeclaredScripts();
    const installedURLs = new Set(
      Object.values(allDeclared).map(s => _normalizeRawURL(s.downloadURL)).filter(Boolean)
    );
    const ignored = new Set(_stateCache?.repo?.ignored || []);
    const knownPaths = _stateCache?.repo?.knownPaths || [];
    const repoBase = (_stateCache?.repo?.url || '').replace('https://github.com/', '');
    const branch = _stateCache?.repo?.branch || 'main';

    const discovered = knownPaths.filter(path => {
      if (ignored.has(path)) return false;
      const downloadURL = _normalizeRawURL(`https://raw.githubusercontent.com/${repoBase}/${branch}/${path}`);
      return !installedURLs.has(downloadURL);
    });

    if (!discovered.length) {
      const el = document.createElement('div');
      el.className = 'empty';
      el.textContent = 'No new scripts found. Click Refresh to check.';
      _contentEl.appendChild(el);
      return;
    }

    const bulkRow = document.createElement('div');
    bulkRow.className = 'upd-hdr';
    const bulkInfo = document.createElement('span');
    bulkInfo.className = 'upd-hdr-ts';
    bulkInfo.textContent = `${discovered.length} undeclared`;
    const markAllBtn = document.createElement('button');
    markAllBtn.className = 'sbtn';
    markAllBtn.textContent = 'Mark all installed';
    markAllBtn.addEventListener('click', async () => {
      if (!_backendAlive) return;
      markAllBtn.disabled = true;
      markAllBtn.textContent = '…';
      try { await _request('markAllInstalled', { paths: discovered }); }
      catch { }
      markAllBtn.disabled = false;
      markAllBtn.textContent = 'Mark all installed';
      _renderActiveTab();
    });
    bulkRow.appendChild(bulkInfo);
    bulkRow.appendChild(markAllBtn);
    _contentEl.appendChild(bulkRow);

    for (const path of discovered) {
      const downloadURL = `https://raw.githubusercontent.com/${repoBase}/${branch}/${path}`;
      const name = path.split('/').pop().replace('.user.js', '');
      const row = document.createElement('div');
      row.className = 'disc';
      const nameEl = document.createElement('div');
      nameEl.className = 'disc-name';
      nameEl.textContent = name;
      const acts = document.createElement('div');
      acts.className = 'disc-acts';
      const installBtn = document.createElement('button');
      installBtn.className = 'sbtn primary';
      installBtn.textContent = 'Install';
      installBtn.addEventListener('click', () => {
        if (_backendAlive) _request('openInTab', { url: downloadURL }).catch(() => {});
      });
      const markBtn = document.createElement('button');
      markBtn.className = 'sbtn';
      markBtn.textContent = 'Already installed';
      markBtn.title = 'I already have this — track it without re-installing';
      markBtn.addEventListener('click', async () => {
        if (!_backendAlive) return;
        markBtn.disabled = true;
        markBtn.textContent = '…';
        try { await _request('markInstalled', { path, downloadURL }); }
        catch { }
        _renderActiveTab();
      });
      const ignoreBtn = document.createElement('button');
      ignoreBtn.className = 'sbtn';
      ignoreBtn.textContent = 'Ignore';
      ignoreBtn.addEventListener('click', () => {
        if (_stateCache?.repo) {
          if (!_stateCache.repo.ignored) _stateCache.repo.ignored = [];
          _stateCache.repo.ignored.push(path);
        }
        if (_backendAlive) _request('ignoreRepoScript', { path }).catch(() => {});
        _renderActiveTab();
      });
      acts.appendChild(installBtn);
      acts.appendChild(markBtn);
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
    repoInput.value = _stateCache?.repo?.url || 'https://github.com/cam-barts/userscripts';

    const branchLabel = document.createElement('label');
    branchLabel.textContent = 'Branch';
    const branchInput = document.createElement('input');
    branchInput.type = 'text';
    branchInput.value = _stateCache?.repo?.branch || 'main';

    const capLabel = document.createElement('label');
    capLabel.textContent = 'Daily GitHub API cap';
    const capInput = document.createElement('input');
    capInput.type = 'number';
    capInput.value = _stateCache?.rateLimit?.dailyCap ?? 8;
    capInput.min = 1;
    capInput.max = 60;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-btn';
    saveBtn.textContent = 'Save settings';
    saveBtn.addEventListener('click', () => {
      if (_backendAlive) {
        _request('setRepoConfig', { url: repoInput.value.trim(), branch: branchInput.value.trim() }).catch(() => {});
        _request('setUI', { rateLimit: { ..._stateCache?.rateLimit, dailyCap: parseInt(capInput.value) || 8 } }).catch(() => {});
      }
      if (_stateCache) {
        _stateCache.repo.url = repoInput.value.trim();
        _stateCache.repo.branch = branchInput.value.trim();
        if (_stateCache.rateLimit) _stateCache.rateLimit.dailyCap = parseInt(capInput.value) || 8;
      }
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'settings-btn danger';
    resetBtn.textContent = 'Reset all Hub state';
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all FireMonkey Hub state? This clears feature toggles, update history, and repo tracking.')) {
        if (_backendAlive) _request('resetState').catch(() => {});
      }
    });

    wrap.appendChild(repoLabel);
    wrap.appendChild(repoInput);
    wrap.appendChild(branchLabel);
    wrap.appendChild(branchInput);
    wrap.appendChild(capLabel);
    wrap.appendChild(capInput);
    wrap.appendChild(saveBtn);
    wrap.appendChild(resetBtn);
    _contentEl.appendChild(wrap);
  }

  // ── Backend event listeners ─────────────────────────────────────────

  document.addEventListener('fmhub:hello', () => {
    _dbg('fmhub:hello received → backend alive');
    _backendAlive = true;
  });

  document.addEventListener('fmhub:stateUpdate', (e) => {
    _dbg('fmhub:stateUpdate received');
    try {
      const update = JSON.parse(e.detail);
      if (!_stateCache) _stateCache = { features: {}, scripts: {}, repo: {}, ui: {}, rateLimit: {} };
      if (update.features) {
        const prevFeatures = { ..._stateCache.features };
        Object.assign(_stateCache.features, update.features);
        for (const [id] of _features) {
          const wasEnabled = _featureEnabledFromCache(id, prevFeatures);
          const isEnabled = _featureEnabled(id);
          if (wasEnabled !== isEnabled) _broadcastFeature(id);
        }
      }
      if (update.scripts) Object.assign(_stateCache.scripts, update.scripts);
      if (update.repo) Object.assign(_stateCache.repo, update.repo);
      _updateBadge();
      _renderActiveTab();
    } catch { }
  });

  // ── SPA Nav Resilience ──────────────────────────────────────────────

  new MutationObserver(() => {
    if (_host && !document.body.contains(_host)) {
      document.body.appendChild(_host);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ── Init ────────────────────────────────────────────────────────────

  _createUI();
  _dbg('UI created, requesting state from backend');

  // Announce we're ready to accept registrations. Consumers that loaded
  // before us listen for this and re-emit their declarations.
  _emit('hubReady', { version: '0.8' });
  _dbg('dispatched fmhub:hubReady');

  _request('getState').then(state => {
    _dbg('getState resolved, scripts=', Object.keys(state?.scripts || {}).length, 'features=', Object.keys(state?.features || {}).length);
    _stateCache = state;
    _backendAlive = true;
    _applyStoredPosition();
    _updateBadge();
    _readyResolve();
    // Self-declare so the Hub appears as installed in Updates/Discover.
    _internalDeclareScript({
      id: 'firemonkey-hub',
      name: 'FireMonkey Hub',
      version: '0.6',
      updateURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub.user.js',
      downloadURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub.user.js',
      description: 'Unified floating action hub for all FireMonkey userscripts',
    });
    // Re-broadcast feature state for already-registered features now that
    // we know the persisted enabled state.
    for (const [id] of _features) _broadcastFeature(id);
    _renderActiveTab();
  }).catch((err) => {
    _dbg('getState FAILED → backend not reachable:', err && err.message);
    _backendAlive = false;
    _readyResolve();
    _renderActiveTab();
  });

  setTimeout(() => {
    if (!_backendAlive) _dbg('ready timeout — backend never responded');
    _readyResolve();
  }, 3000);
})();
