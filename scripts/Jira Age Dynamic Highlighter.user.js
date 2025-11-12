// ==UserScript==
// @name         Jira: Issue‐Age Dynamic Highlighter
// @version      0.1
// @description  Color‐code Jira issue rows from green (new) to red (old) by table's oldest issue age
// @author       cam-barts
// @match        https://*.atlassian.net/jira/servicedesk/projects/*/queues/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Jira%20Age%20Dynamic%20Highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Jira%20Age%20Dynamic%20Highlighter.user.js
// ==/UserScript==
/**
 * Jira: Issue-Age Dynamic Highlighter
 *
 * Color-codes Jira issue rows in service desk queues based on their age.
 * Uses a gradient from green (newest) to red (oldest) relative to the
 * oldest issue currently visible in the queue.
 *
 * This provides visual priority cues - older issues stand out immediately.
 */
(function () {
  "use strict";

  // Milliseconds per day constant for age calculations
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  /**
   * Convert a fraction (0-1) to a color gradient from green to red
   * @param {number} frac - Value between 0 (newest/green) and 1 (oldest/red)
   * @returns {string} RGBA color string
   */
  function colorForFraction(frac) {
    // Clamp value to 0-1 range
    const t = Math.max(0, Math.min(1, frac));

    // Calculate RGB values: green (0,255,0) -> yellow (255,255,0) -> red (255,0,0)
    const r = Math.round(255 * t); // Red increases with age
    const g = Math.round(255 * (1 - t)); // Green decreases with age

    return `rgba(${r},${g},0,0.5)`; // 50% opacity to keep text readable
  }

  /**
   * Apply color highlighting to all issue rows based on relative age
   */
  function highlightAges() {
    const now = Date.now();

    // ──── STEP 1: Calculate ages for all visible issues ────
    const rows = Array.from(document.querySelectorAll('div[role="row"]'));

    // Extract creation timestamp from each row's <time> element
    const agesDays = rows
      .map((row) => {
        const timeEl = row.querySelector("time[datetime]");
        if (!timeEl) return NaN;

        const createdTs = Date.parse(timeEl.getAttribute("datetime"));
        if (isNaN(createdTs)) return NaN;

        // Convert milliseconds to days
        return (now - createdTs) / MS_PER_DAY;
      })
      .filter((d) => !isNaN(d)); // Remove rows without valid dates

    // Exit if no issues found
    if (agesDays.length === 0) return;

    // ──── STEP 2: Find the oldest issue age ────
    // This becomes our maximum (red) value for the gradient
    const maxAge = Math.max(...agesDays);

    // ──── STEP 3: Color each row based on its age relative to maxAge ────
    rows.forEach((row) => {
      const timeEl = row.querySelector("time[datetime]");
      if (!timeEl) return;

      const createdTs = Date.parse(timeEl.getAttribute("datetime"));
      if (isNaN(createdTs)) return;

      const ageDays = (now - createdTs) / MS_PER_DAY;

      // Calculate fraction: 0 = newest, 1 = oldest
      const fraction = ageDays / maxAge;
      row.style.backgroundColor = colorForFraction(fraction);
    });
  }

  /**
   * Debounce timer to prevent excessive highlighting on rapid DOM changes
   */
  let timer = null;

  /**
   * Queue a highlight operation (debounced)
   * Waits 150ms after last DOM change before running
   */
  function queueHighlight() {
    clearTimeout(timer);
    timer = setTimeout(highlightAges, 150);
  }

  // ──── Set up observers ────

  // Watch the issue table container for changes (sorting, filtering, pagination)
  const container =
    document.querySelector('[data-vc="issue-table-container"]') ||
    document.body;

  new MutationObserver(queueHighlight).observe(container, {
    childList: true, // Watch for added/removed rows
    subtree: true, // Watch entire container tree
  });

  // Run highlighting once on page load
  window.addEventListener("load", queueHighlight);
})();

