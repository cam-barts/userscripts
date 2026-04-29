// ==UserScript==
// @name         FireMonkey Hub
// @version      0.2
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

  // ── Bridge ─────────────────────────────────────────────────────────

  let _reqId = 0;
  let _backendAlive = false;
  let _readyResolve;
  const _ready = new Promise(r => (_readyResolve = r));
  let _stateCache = null;

  function _request(type, payload = {}) {
    const id = ++_reqId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        document.removeEventListener('fmhub:response:' + id, handler);
        reject(new Error(`fmhub timeout: ${type}`));
      }, 8000);
      function handler(e) {
        clearTimeout(timer);
        try {
          const { ok, data, error } = JSON.parse(e.detail);
          if (ok) resolve(data);
          else reject(new Error(error || 'request failed'));
        } catch { reject(new Error('parse error')); }
      }
      document.addEventListener('fmhub:response:' + id, handler, { once: true });
      document.dispatchEvent(new CustomEvent('fmhub:request', {
        detail: JSON.stringify({ id, type, payload })
      }));
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

  function _applyFeature(id, enabled) {
    const reg = _features.get(id);
    if (!reg) return;
    try {
      if (enabled && typeof reg.onEnable === 'function') reg.onEnable();
      if (!enabled && typeof reg.onDisable === 'function') reg.onDisable();
    } catch (err) {
      console.error('[fmhub] feature callback error:', err);
    }
    for (const cb of reg.listeners) { try { cb(enabled); } catch { } }
  }

  // ── window.FireMonkeyHub API ────────────────────────────────────────

  window.FireMonkeyHub = {
    get ready() { return _ready; },

    registerCommand(config) {
      if (!config.id) { console.warn('[fmhub] registerCommand missing id'); return { unregister() {}, setEnabled() {} }; }
      const entry = {
        name: config.name || config.id,
        tooltip: config.tooltip || '',
        color: config.color || '#4CAF50',
        group: config.group || '',
        callback: config.callback,
        enabled: config.enabled !== false,
      };
      _commands.set(config.id, entry);
      _renderActiveTab();
      return {
        unregister() { _commands.delete(config.id); _renderActiveTab(); },
        setEnabled(val) { entry.enabled = val; _renderActiveTab(); },
      };
    },

    registerFeature(config) {
      if (!config.id) { console.warn('[fmhub] registerFeature missing id'); return { isEnabled: () => true, setEnabled: async () => {}, onChange: () => () => {} }; }
      const listeners = [];
      const entry = {
        label: config.label || config.id,
        description: config.description || '',
        defaultEnabled: config.defaultEnabled !== false,
        scope: config.scope || 'global',
        onEnable: config.onEnable,
        onDisable: config.onDisable,
        listeners,
      };
      _features.set(config.id, entry);
      _ready.then(() => {
        const enabled = _featureEnabled(config.id);
        if (enabled && typeof config.onEnable === 'function') {
          try { config.onEnable(); } catch { }
        } else if (!enabled && typeof config.onDisable === 'function') {
          try { config.onDisable(); } catch { }
        }
        _renderActiveTab();
      });
      const handle = {
        isEnabled() { return _featureEnabled(config.id); },
        async setEnabled(val, scope = 'global') {
          if (!_stateCache) { _stateCache = { features: {}, scripts: {}, repo: {}, ui: {}, rateLimit: {} }; }
          if (!_stateCache.features[config.id]) _stateCache.features[config.id] = { enabled: true, origins: {} };
          const host = location.hostname;
          if (scope === 'origin') {
            _stateCache.features[config.id].origins = _stateCache.features[config.id].origins || {};
            _stateCache.features[config.id].origins[host] = val;
          } else {
            _stateCache.features[config.id].enabled = val;
          }
          _applyFeature(config.id, _featureEnabled(config.id));
          _renderActiveTab();
          if (_backendAlive) {
            await _request('setFeatureEnabled', { featureId: config.id, enabled: val, scope, origin: host });
          }
        },
        onChange(cb) {
          listeners.push(cb);
          return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
        },
      };
      return handle;
    },

    declareScript(config) {
      if (!config.id) return;
      _ready.then(() => {
        if (_backendAlive) {
          _request('declareScript', {
            scriptId: config.id,
            name: config.name,
            version: config.version,
            updateURL: config.updateURL,
            downloadURL: config.downloadURL,
            description: config.description || '',
            upstreamURL: config.upstreamURL || null,
          }).catch(() => {});
        }
      });
    },

    openHub() { _openPanel(); },
    closeHub() { _closePanel(); },
    toggleHub() { _panelOpen ? _closePanel() : _openPanel(); },

    async notify({ title, body, level } = {}) {
      if (_backendAlive) {
        await _request('openInTab', { url: 'data:text/plain,' }).catch(() => {});
      }
      console.log(`[fmhub] ${level || 'info'}: ${title} — ${body}`);
    },
  };

  // ── FireMonkeyMenu back-compat ──────────────────────────────────────

  window.FireMonkeyMenu = {
    registerCommand(config) {
      const id = 'confluence.' + (config.name || '').replace(/\s+/g, '-').toLowerCase() + '.' + Math.random().toString(36).slice(2, 7);
      return window.FireMonkeyHub.registerCommand({
        id,
        name: config.name,
        tooltip: config.tooltip,
        color: config.color,
        group: 'Confluence',
        callback: config.callback,
        enabled: config.enabled !== false,
      });
    },
  };

  // Signal to consumers that the Hub API is ready
  document.dispatchEvent(new CustomEvent('fmhub:loaded'));

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
    if (enabled && typeof cmd.callback === 'function') {
      const runBtn = document.createElement('button');
      runBtn.className = 'cmd-run';
      runBtn.textContent = 'Run';
      runBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { cmd.callback(); } catch (err) { console.error('[fmhub] cmd error:', err); }
      });
      row.appendChild(runBtn);
      row.addEventListener('click', () => { try { cmd.callback(); } catch { } });
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
        const handle = window.FireMonkeyHub.registerFeature; // won't use; use direct
        if (!_stateCache) _stateCache = { features: {}, scripts: {}, repo: {}, ui: {}, rateLimit: {} };
        if (!_stateCache.features[id]) _stateCache.features[id] = { enabled: true, origins: {} };
        _stateCache.features[id].enabled = val;
        _applyFeature(id, _featureEnabled(id));
        if (_backendAlive) _request('setFeatureEnabled', { featureId: id, enabled: val, scope: 'global', origin: location.hostname }).catch(() => {});
        _renderActiveTab();
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
          if (siteVal === undefined) {
            _stateCache.features[id].origins[host] = !globalEnabled;
          } else if (siteVal !== globalEnabled) {
            delete _stateCache.features[id].origins[host];
          } else {
            _stateCache.features[id].origins[host] = !siteVal;
          }
          _applyFeature(id, _featureEnabled(id));
          if (_backendAlive) {
            const newVal = _stateCache.features[id].origins[host];
            if (newVal !== undefined) {
              _request('setFeatureEnabled', { featureId: id, enabled: newVal, scope: 'origin', origin: host }).catch(() => {});
            } else {
              _request('setFeatureEnabled', { featureId: id, enabled: globalEnabled, scope: 'origin', origin: host }).catch(() => {});
            }
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
    let _pendingNewScripts = null;
    checkBtn.addEventListener('click', async () => {
      checkBtn.textContent = '…';
      checkBtn.disabled = true;
      try {
        const result = await _request('discoverRepo');
        _pendingNewScripts = result.newScripts;
      } catch { }
      checkBtn.textContent = 'Refresh';
      checkBtn.disabled = false;
      _renderActiveTab();
    });
    hdr.appendChild(tsEl);
    hdr.appendChild(checkBtn);
    _contentEl.appendChild(hdr);

    const installedURLs = new Set(Object.values(_stateCache?.scripts || {}).map(s => s.downloadURL));
    const ignored = new Set(_stateCache?.repo?.ignored || []);
    const knownPaths = _stateCache?.repo?.knownPaths || [];
    const allScripts = _stateCache?.repo?.knownPaths || [];

    // Only show scripts that are in knownPaths but not installed and not ignored
    const discovered = knownPaths.filter(path => {
      if (ignored.has(path)) return false;
      const downloadURL = `https://raw.githubusercontent.com/${(_stateCache?.repo?.url || '').replace('https://github.com/', '')}/refs/heads/${_stateCache?.repo?.branch || 'main'}/${path}`;
      return !installedURLs.has(downloadURL);
    });

    if (!discovered.length) {
      const el = document.createElement('div');
      el.className = 'empty';
      el.textContent = 'No new scripts found. Click Refresh to check.';
      _contentEl.appendChild(el);
      return;
    }
    const repoBase = (_stateCache?.repo?.url || '').replace('https://github.com/', '');
    const branch = _stateCache?.repo?.branch || 'main';
    for (const path of discovered) {
      const downloadURL = `https://raw.githubusercontent.com/${repoBase}/refs/heads/${branch}/${path}`;
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
    _backendAlive = true;
  });

  document.addEventListener('fmhub:stateUpdate', (e) => {
    try {
      const update = JSON.parse(e.detail);
      if (!_stateCache) _stateCache = { features: {}, scripts: {}, repo: {}, ui: {}, rateLimit: {} };
      if (update.features) {
        const prevFeatures = { ..._stateCache.features };
        Object.assign(_stateCache.features, update.features);
        for (const [id] of _features) {
          const wasEnabled = _featureEnabledFromCache(id, prevFeatures);
          const isEnabled = _featureEnabled(id);
          if (wasEnabled !== isEnabled) _applyFeature(id, isEnabled);
        }
      }
      if (update.scripts) Object.assign(_stateCache.scripts, update.scripts);
      if (update.repo) Object.assign(_stateCache.repo, update.repo);
      _updateBadge();
      _renderActiveTab();
    } catch { }
  });

  function _featureEnabledFromCache(id, featureCache) {
    const reg = _features.get(id);
    if (!reg) return true;
    const f = featureCache[id];
    if (!f) return reg.defaultEnabled !== false;
    const host = location.hostname;
    if (reg.scope === 'origin' && host && f.origins && f.origins[host] !== undefined) return f.origins[host];
    return f.enabled !== undefined ? f.enabled : (reg.defaultEnabled !== false);
  }

  // ── SPA Nav Resilience ──────────────────────────────────────────────

  new MutationObserver(() => {
    if (_host && !document.body.contains(_host)) {
      document.body.appendChild(_host);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ── Init ────────────────────────────────────────────────────────────

  _createUI();

  // Request state from backend; timeout gracefully
  _request('getState').then(state => {
    _stateCache = state;
    _backendAlive = true;
    _applyStoredPosition();
    _updateBadge();
    _readyResolve();
    _renderActiveTab();
  }).catch(() => {
    _backendAlive = false;
    _readyResolve();
    _renderActiveTab();
  });

  // Timeout fallback: resolve ready even without backend
  setTimeout(() => { _readyResolve(); }, 3000);
})();
