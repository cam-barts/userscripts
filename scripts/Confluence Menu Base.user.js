// ==UserScript==
// @name         Confluence Menu Base
// @version      0.6
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
 * Exposes window.FireMonkeyMenu.registerCommand() for other scripts.
 * When FireMonkey Hub is installed, delegates to it (unified floating UI).
 * Otherwise, provides a standalone floating menu as a fallback.
 */
(function () {
  'use strict';

  let _standaloneMenu = null;

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

  function _standaloneRegister(config) {
    const menu = _standaloneMenu || (_standaloneMenu = document.getElementById('confluence-fm-menu') || _createStandaloneMenu());
    const btn = document.createElement('button');
    btn.textContent = config.name;
    btn.title = config.tooltip || '';
    btn.style.cssText = `
      padding: 6px 12px;
      background: ${config.color || '#4CAF50'};
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      width: fit-content;
      min-width: 130px;
    `;
    btn.onclick = () => typeof config.callback === 'function' && config.callback();
    if (config.enabled !== false) menu.appendChild(btn);
    return {
      unregister() { btn.remove(); },
      setEnabled(val) {
        if (val) menu.appendChild(btn);
        else btn.remove();
      },
    };
  }

  window.FireMonkeyMenu = {
    registerCommand(config) {
      if (typeof window.FireMonkeyHub !== 'undefined') {
        const id = 'confluence.' + (config.name || '').replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.' + Math.random().toString(36).slice(2, 6);
        return window.FireMonkeyHub.registerCommand({
          id,
          name: config.name,
          tooltip: config.tooltip,
          color: config.color,
          group: 'Confluence',
          callback: config.callback,
          enabled: config.enabled !== false,
        });
      }
      return _standaloneRegister(config);
    },
  };

  // Declare this script to the Hub for update tracking
  (function () {
    function _reg() {
      window.FireMonkeyHub.declareScript({
        id: 'confluence-menu-base',
        name: 'Confluence Menu Base',
        version: '0.4',
        updateURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Base.user.js',
        downloadURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Base.user.js',
        description: 'Add command menu to Confluence pages',
      });
    }
    if (typeof window.FireMonkeyHub !== 'undefined') { _reg(); }
    else { document.addEventListener('fmhub:loaded', _reg, { once: true }); }
  })();
})();
