// ==UserScript==
// @name         Readwise Auto-Tag Loop (Simple Reload)
// @namespace    http://tampermonkey.net/
// @version      0.6
// @description  Invoke Ghostreader & apply "ta" tag, then reload queue page until empty
// @author       cam-barts
// @match        https://read.readwise.io/filter/*
// @grant        none
// @require      FireMonkey Hub Client
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Readwise%20Auto-Tag%20Loop%20(Simple%20Reload).user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Readwise%20Auto-Tag%20Loop%20(Simple%20Reload).user.js
// ==/UserScript==

(function() {
  'use strict';

  const TAG = '[fmhub:readwise-auto-tag]';
  function _log() {
    if (window.__FMHUB_DEBUG__ === false) return;
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ──── CONFIGURATION ────
  const START_URL    = location.href;    // Save the current queue page URL for reloading
  const POLL_INT     = 1000;             // Check every 1 second for DOM elements
  const POLL_TIMEOUT = 10000;            // Stop checking after 10 seconds (queue is empty)
  const STEP_DELAY   = 3000;             // Wait 3 seconds between automation steps
  // ───────────────────────

  _log('🔁 Readwise Auto-Tag Loop starting on', START_URL);

  /**
   * Simulate a keyboard key press on the document body
   * @param {string} k - The key to press (e.g., 'm')
   */
  function sendKey(k) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: k,
      code: 'Key' + k.toUpperCase(),
      bubbles: true,      // Event propagates up the DOM tree
      cancelable: true    // Event can be cancelled
    }));
  }

  /**
   * Execute the 6-step automation flow to tag an item in Readwise
   * Steps: Click item -> Open menu -> Invoke Ghostreader -> Add tag -> Confirm -> Reload
   * @param {Element} firstLink - The link element of the first item in the queue
   * @returns {Promise<void>}
   */
  function doTagFlow(firstLink) {
    return new Promise(resolve => {
      _log('🔄 Starting tag flow…');

      // Step 1: Click the first queue item to open it (3 seconds)
      setTimeout(() => {
        _log('1️⃣ Clicking item:', firstLink);
        firstLink.click();
      }, STEP_DELAY * 1);

      // Step 2: Press 'm' to open the command menu (6 seconds)
      setTimeout(() => {
        _log('2️⃣ Sending key "m"');
        sendKey('m');
      }, STEP_DELAY * 2);

      // Step 3: Find and click the Ghostreader button (9 seconds)
      setTimeout(() => {
        _log('3️⃣ Finding "Invoke Ghostreader"');
        // Search all <span> elements for one containing "Invoke Ghostreader"
        const btn = Array.from(document.querySelectorAll('span'))
                         .find(s => s.textContent.includes('Invoke Ghostreader'));
        _log('   →', btn);
        if (btn) btn.click();
        else _log('   Ghostreader button not found');
      }, STEP_DELAY * 3);

      // Step 4: Enter "ta" tag in the command palette input (12 seconds)
      setTimeout(() => {
        _log('4️⃣ Filling tag input');
        const inp = document.querySelector('#cp-input');
        _log('   →', inp);
        if (inp) {
          inp.value = 'ta';
          // Trigger input event so Readwise's UI reacts to the change
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          _log('   #cp-input not found');
        }
      }, STEP_DELAY * 4);

      // Step 5: Click the action row to confirm the tag (15 seconds)
      setTimeout(() => {
        _log('5️⃣ Clicking .palette-action-row');
        const row = document.querySelector('.palette-action-row');
        _log('   →', row);
        if (row) row.click();
        else _log('   .palette-action-row not found');
      }, STEP_DELAY * 5);

      // Step 6: Reload the queue page to process next item (18 seconds)
      setTimeout(() => {
        _log('6️⃣ Flow complete – reloading queue page');
        window.location.href = START_URL;
        resolve();
      }, STEP_DELAY * 6);
    });
  }

  /**
   * Main execution: Wait for queue items and process them
   * If no items found within timeout, assume queue is empty and stop
   */
  (async function run() {
    _log('📋 Waiting for next item link…');
    // Poll for the first queue item to appear on page; give up after POLL_TIMEOUT
    // (means the queue is empty).
    const endTime = Date.now() + POLL_TIMEOUT;
    let firstLink = null;
    while (!firstLink && Date.now() <= endTime) {
      firstLink = document.querySelector('li > a');
      if (!firstLink) await new Promise((r) => setTimeout(r, POLL_INT));
    }
    if (!firstLink) {
      _log('✅ Queue empty (no li > a found)');
      return;
    }

    // Item found - begin the tagging automation
    _log('✅ Found an item – commencing tag flow.');
    await doTagFlow(firstLink);
  })();

  // Hub integration: declare via the shared client (no commands/features)
  if (typeof window.FMHubClient !== 'undefined') {
    window.FMHubClient.connect({
      id: 'readwise-auto-tag-loop',
      description: 'Invoke Ghostreader & apply "ta" tag, then reload queue page until empty',
      updateURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Readwise%20Auto-Tag%20Loop%20(Simple%20Reload).user.js',
      downloadURL: 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Readwise%20Auto-Tag%20Loop%20(Simple%20Reload).user.js',
    });
  }

})();