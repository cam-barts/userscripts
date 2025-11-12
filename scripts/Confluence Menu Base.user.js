// ==UserScript==
// @name         Confluence Menu Base
// @version      0.4
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
 * This script creates a global API that allows other userscripts to register
 * custom commands in a floating menu on Confluence pages.
 *
 * Architecture:
 * - Exposes window.FireMonkeyMenu.registerCommand() for other scripts
 * - Creates a single shared menu container (lazy-loaded on first use)
 * - Each registered command appears as a button in the menu
 */
(function() {
  'use strict';

  /**
   * Global API: FireMonkeyMenu
   * Available to all scripts running on the page
   */
  window.FireMonkeyMenu = {
    /**
     * Register a new command button in the menu
     * @param {Object} config - Command configuration
     * @param {string} config.name - Button text
     * @param {string} [config.tooltip] - Hover tooltip
     * @param {string} [config.color] - Background color (default: #4CAF50)
     * @param {Function} config.callback - Function to execute when clicked
     * @param {boolean} config.enabled - Whether to show this button
     */
    registerCommand: function(config) {
      // Get existing menu or create it if this is the first command
      const menu = document.getElementById('confluence-fm-menu') || createMenu();

      // Create the command button
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

      // Attach click handler
      btn.onclick = () => {
        if (typeof config.callback === 'function') {
          config.callback();
        }
      };

      // Only add button if explicitly enabled
      if (config.enabled) {
        menu.appendChild(btn);
      }
    }
  };

  /**
   * Create the floating menu container
   * Called once on first registerCommand() call
   * @returns {HTMLElement} The menu container element
   */
  function createMenu() {
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
})();