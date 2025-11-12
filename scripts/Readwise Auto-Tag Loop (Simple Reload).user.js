// ==UserScript==
// @name         Readwise Auto-Tag Loop (Simple Reload)
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Invoke Ghostreader & apply "ta" tag, then reload queue page until empty
// @author       cam-barts
// @match        https://read.readwise.io/filter/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Readwise%20Auto-Tag%20Loop%20(Simple%20Reload).user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Readwise%20Auto-Tag%20Loop%20(Simple%20Reload).user.js
// ==/UserScript==

(function() {
  'use strict';

  // ──── CONFIGURATION ────
  const START_URL    = location.href;    // Save the current queue page URL for reloading
  const POLL_INT     = 1000;             // Check every 1 second for DOM elements
  const POLL_TIMEOUT = 10000;            // Stop checking after 10 seconds (queue is empty)
  const STEP_DELAY   = 3000;             // Wait 3 seconds between automation steps
  // ───────────────────────

  console.clear();
  console.log('🔁 Readwise Auto-Tag Loop starting on', START_URL);

  /**
   * Wait for a DOM element to appear on the page
   * @param {string} selector - CSS selector to look for
   * @param {number} interval - How often to check (milliseconds)
   * @param {number} timeout - When to give up waiting (milliseconds)
   * @returns {Promise<Element>} - Resolves with the found element or rejects on timeout
   */
  function waitFor(selector, interval = POLL_INT, timeout = POLL_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const endTime = Date.now() + timeout;
      const iv = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(iv);
          resolve(el);
        }
        else if (Date.now() > endTime) {
          clearInterval(iv);
          reject(`Timeout waiting for "${selector}"`);
        }
      }, interval);
    });
  }

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
      console.log('🔄 Starting tag flow…');

      // Step 1: Click the first queue item to open it (3 seconds)
      setTimeout(() => {
        console.log('1️⃣ Clicking item:', firstLink);
        firstLink.click();
      }, STEP_DELAY * 1);

      // Step 2: Press 'm' to open the command menu (6 seconds)
      setTimeout(() => {
        console.log('2️⃣ Sending key "m"');
        sendKey('m');
      }, STEP_DELAY * 2);

      // Step 3: Find and click the Ghostreader button (9 seconds)
      setTimeout(() => {
        console.log('3️⃣ Finding "Invoke Ghostreader"');
        // Search all <span> elements for one containing "Invoke Ghostreader"
        const btn = Array.from(document.querySelectorAll('span'))
                         .find(s => s.textContent.includes('Invoke Ghostreader'));
        console.log('   →', btn);
        if (btn) btn.click();
        else console.warn('   Ghostreader button not found');
      }, STEP_DELAY * 3);

      // Step 4: Enter "ta" tag in the command palette input (12 seconds)
      setTimeout(() => {
        console.log('4️⃣ Filling tag input');
        const inp = document.querySelector('#cp-input');
        console.log('   →', inp);
        if (inp) {
          inp.value = 'ta';
          // Trigger input event so Readwise's UI reacts to the change
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          console.warn('   #cp-input not found');
        }
      }, STEP_DELAY * 4);

      // Step 5: Click the action row to confirm the tag (15 seconds)
      setTimeout(() => {
        console.log('5️⃣ Clicking .palette-action-row');
        const row = document.querySelector('.palette-action-row');
        console.log('   →', row);
        if (row) row.click();
        else console.warn('   .palette-action-row not found');
      }, STEP_DELAY * 5);

      // Step 6: Reload the queue page to process next item (18 seconds)
      setTimeout(() => {
        console.log('6️⃣ Flow complete – reloading queue page');
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
    let firstLink;
    try {
      console.log('📋 Waiting for next item link…');
      // Wait for the first queue item to appear on page
      firstLink = await waitFor('li > a');
    }
    catch (err) {
      // Timeout means no items found - queue is empty
      console.log('✅ Queue empty (no li > a found):', err);
      return;
    }

    // Item found - begin the tagging automation
    console.log('✅ Found an item – commencing tag flow.');
    await doTagFlow(firstLink);
  })();

})();