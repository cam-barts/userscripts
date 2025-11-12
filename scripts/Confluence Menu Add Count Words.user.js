// ==UserScript==
// @name         Confluence Menu: Add Count Words
// @version      0.2
// @description  Add command menu to Confluence pages
// @author       cam-barts
// @match        *://*/wiki/*
// @grant        none
// @require      Confluence Menu Base
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Add%20Count%20Words.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Add%20Count%20Words.user.js
// ==/UserScript==

/**
 * Confluence Menu: Count Words
 *
 * ⚠️  DEPENDENCY: This script requires "Confluence Menu Base" to function.
 *     Install the base script first to enable the menu system.
 *
 * Simple word counter for Confluence page content.
 * Counts all words in the main content area.
 *
 * NOTE: This was originally a proof-of-concept for the menu button system.
 *       It demonstrates how to add custom commands to the Confluence menu.
 *
 * Usage: Click "Count Words 📘" button in the floating menu
 */
(function() {
  'use strict';

  // Check if FireMonkeyMenu API is available from base script
  if (typeof window.FireMonkeyMenu === 'undefined') {
    console.error('Confluence Menu: Count Words requires "Confluence Menu Base" script to be installed.');
    return;
  }

  /**
   * Count words on the current Confluence page
   */
  function countWords() {
    // Try to get Confluence content area first, fallback to full page
    const contentElement = document.getElementById("content") || document.body;
    const text = contentElement.innerText;

    // Split on whitespace (spaces, tabs, newlines)
    // Filter removes empty strings from consecutive whitespace
    const wordCount = text.trim().split(/\s+/).length;

    alert(`Word count: ${wordCount.toLocaleString()}`);
  }

  // Register the command in the Confluence menu
  FireMonkeyMenu.registerCommand({
    enabled: true,
    name: 'Count Words 📘',
    tooltip: 'Count words on this page',
    color: '#2196F3',
    callback: countWords
  });
})();