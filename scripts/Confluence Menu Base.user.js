// ==UserScript==
// @name         Confluence Menu Base
// @version      0.10
// @description  Add command menu to Confluence pages
// @author       cam-barts
// @match        *://*/wiki/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Base.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Base.user.js
// ==/UserScript==

/**
 * Confluence Menu Base
 *
 * Exposes window.FireMonkeyMenu.registerCommand() for other Confluence
 * userscripts that @require this file. Internally uses the FireMonkey Hub
 * event protocol when Hub is installed, falls back to a standalone floating
 * menu when not.
 *
 * The Confluence Menu Base is in the SAME realm as its @require'd
 * extensions, so window.FireMonkeyMenu works for them. Hub registration
 * goes through the event protocol so it survives cross-realm sandboxing.
 */
(function () {
  'use strict';

  const TAG = '[fmhub:confluence-base]';
  function _log() {
    if (window.__FMHUB_DEBUG__ === false) return;
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {}
  }
  _log('script loaded');

  // ── FMHub event-protocol helper (inline, cross-realm safe) ─────────

  const _cmds = new Map();
  const _scripts = [];
  let _hubSeen = false;

  function _emit(t, p) {
    document.dispatchEvent(new CustomEvent('fmhub:' + t, {
      detail: JSON.stringify(p || {})
    }));
  }

  document.addEventListener('fmhub:invoke', function (e) {
    try {
      const { id } = JSON.parse(e.detail || '{}');
      const c = _cmds.get(id);
      if (c && typeof c.cb === 'function') {
        try { c.cb(); } catch (err) { console.error(TAG, 'callback error', err); }
      }
    } catch { }
  });

  document.addEventListener('fmhub:hubReady', function () {
    _log('fmhub:hubReady received — re-emitting registrations');
    _hubSeen = true;
    // Hub took over: tear down standalone menu if it was rendered.
    if (_standaloneMenu) { _standaloneMenu.remove(); _standaloneMenu = null; }
    for (const [id, c] of _cmds) _emit('registerCommand', { id, ...c.meta });
    for (const s of _scripts) _emit('declareScript', s);
  });

  function _hubDeclareScript(c) {
    if (!c || !c.id) return;
    const p = {
      id: c.id, name: c.name, version: c.version,
      updateURL: c.updateURL || '', downloadURL: c.downloadURL || '',
      description: c.description || '', upstreamURL: c.upstreamURL || null,
    };
    _scripts.push(p);
    _emit('declareScript', p);
  }

  function _hubRegisterCommand(c) {
    if (!c || !c.id) return { unregister() {}, setEnabled() {} };
    const meta = {
      name: c.name, tooltip: c.tooltip || '',
      color: c.color || '#4CAF50', group: c.group || 'Confluence',
      enabled: c.enabled !== false,
    };
    _cmds.set(c.id, { cb: c.callback, meta });
    _emit('registerCommand', { id: c.id, ...meta });
    return {
      unregister() { _cmds.delete(c.id); _emit('unregisterCommand', { id: c.id }); },
      setEnabled(v) {
        const e = _cmds.get(c.id);
        if (e) e.meta.enabled = v;
        _emit('setCommandEnabled', { id: c.id, enabled: v });
      },
    };
  }

  // ── Standalone floating menu (used only if Hub never loads) ────────

  let _standaloneMenu = null;
  const _standaloneHandles = new Map();

  function _createStandaloneMenu() {
    const el = document.createElement('div');
    el.id = 'confluence-fm-menu';
    el.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 5px;
      position: fixed;
      bottom: 50%;
      right: 20px;
      background: #1B1D23;
      border: 1px solid #ccc;
      padding: 10px;
      border-radius: 5px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      z-index: 99999;
    `;
    document.body.appendChild(el);
    return el;
  }

  function _renderStandalone() {
    if (_standaloneMenu) _standaloneMenu.remove();
    _standaloneMenu = _createStandaloneMenu();
    _standaloneHandles.clear();
    for (const [id, c] of _cmds) {
      if (!c.meta.enabled) continue;
      const btn = document.createElement('button');
      btn.textContent = c.meta.name;
      btn.title = c.meta.tooltip || '';
      btn.style.cssText = `
        padding: 6px 12px;
        background: ${c.meta.color || '#4CAF50'};
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        width: fit-content;
        min-width: 130px;
      `;
      btn.onclick = () => { try { c.cb && c.cb(); } catch (err) { console.error(TAG, err); } };
      _standaloneMenu.appendChild(btn);
      _standaloneHandles.set(id, btn);
    }
  }

  // After 2s, if Hub never announced itself, fall back to standalone DOM.
  setTimeout(function () {
    if (!_hubSeen && _cmds.size > 0) {
      _log('Hub not detected after 2s — rendering standalone menu');
      _renderStandalone();
    }
  }, 2000);

  // ── Public API for @require'd Confluence extension scripts ─────────

  window.FireMonkeyMenu = {
    registerCommand(config) {
      const id = 'confluence.' + (config.name || '').replace(/[^a-z0-9]/gi, '-').toLowerCase()
        + '.' + Math.random().toString(36).slice(2, 6);
      const handle = _hubRegisterCommand({
        id,
        name: config.name,
        tooltip: config.tooltip,
        color: config.color,
        group: 'Confluence',
        callback: config.callback,
        enabled: config.enabled !== false,
      });
      // If standalone menu is already rendered, refresh it to include this button.
      if (_standaloneMenu) _renderStandalone();
      return {
        unregister() { handle.unregister(); if (_standaloneMenu) _renderStandalone(); },
        setEnabled(val) { handle.setEnabled(val); if (_standaloneMenu) _renderStandalone(); },
      };
    },
  };

  // ── Self-declare to the Hub ────────────────────────────────────────

  _hubDeclareScript({
    id: 'confluence-menu-base',
    name: 'Confluence Menu Base',
    version: '0.10',
    updateURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Base.user.js',
    downloadURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Base.user.js',
    description: 'Add command menu to Confluence pages',
  });
})();
