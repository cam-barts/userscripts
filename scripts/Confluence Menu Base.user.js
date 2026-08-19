// ==UserScript==
// @name         Confluence Menu Base
// @version      0.10
// @description  Add command menu to Confluence pages
// @author       cam-barts
// @match        https://*.atlassian.net/wiki/*
// @grant        none
// @require      FireMonkey Hub Client
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

  // ── Local command registry (drives the standalone fallback menu) ───

  const _cmds = new Map();

  // ── Hub registration via the shared client ──────────────────────────

  let _client = null;
  if (typeof window.FMHubClient !== 'undefined') {
    _client = window.FMHubClient.connect({
      id: 'confluence-menu-base',
      description: 'Add command menu to Confluence pages',
      updateURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Base.user.js',
      downloadURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Base.user.js',
    });
    // Hub took over: tear down standalone menu if it was rendered.
    _client.onHubSeen(function () {
      _log('hub seen - tearing down standalone menu');
      if (_standaloneMenu) { _standaloneMenu.remove(); _standaloneMenu = null; }
    });
  }

  function _hubRegisterCommand(c) {
    if (!c || !c.id) return { unregister() {}, setEnabled() {} };
    const meta = {
      name: c.name, tooltip: c.tooltip || '',
      color: c.color || '#4CAF50', group: c.group || 'Confluence',
      enabled: c.enabled !== false,
    };
    _cmds.set(c.id, { cb: c.callback, meta });
    if (!_client) {
      return {
        unregister() { _cmds.delete(c.id); },
        setEnabled(v) { const e = _cmds.get(c.id); if (e) e.meta.enabled = v; },
      };
    }
    const handle = _client.registerCommand({ id: c.id, ...meta, callback: c.callback });
    return {
      unregister() { _cmds.delete(c.id); handle.unregister(); },
      setEnabled(v) {
        const e = _cmds.get(c.id);
        if (e) e.meta.enabled = v;
        handle.setEnabled(v);
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
    if (!(_client && _client.hubSeen()) && _cmds.size > 0) {
      _log('Hub not detected after 2s - rendering standalone menu');
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
})();
