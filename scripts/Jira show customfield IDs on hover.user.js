// ==UserScript==
// @name         Jira: show customfield IDs on hover
// @version      0.1
// @description  Hover a field label on a Jira issue to see its customfield_xxx ID.
// @author       cam-barts
// @match        https://*.atlassian.net/browse/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Jira%20show%20customfield%20IDs%20on%20hover.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Jira%20show%20customfield%20IDs%20on%20hover.user.js
// ==/UserScript==

;(function(){
  'use strict';

  // ──── STEP 1: Extract issue key from URL ────
  // Match pattern: /browse/PROJECT-123
  const m = window.location.pathname.match(/^\/browse\/([A-Z]+-\d+)/);
  if(!m) return; // Exit if not on a Jira issue page
  const issueKey = m[1]; // e.g., "PROJ-123"

  // ──── STEP 2: Fetch issue metadata from Jira API ────
  // The "expand=names" parameter returns field ID -> field label mappings
  fetch(`/rest/api/3/issue/${issueKey}?expand=names`, {
    credentials: 'include' // Include cookies for authentication
  })
  .then(r => {
    if(!r.ok) throw new Error(`Jira API returned ${r.status}`);
    return r.json();
  })
  .then(d => {
    // ──── STEP 3: Build reverse lookup map ────
    // API returns: { customfield_10001: "Team", customfield_10002: "Sprint", ... }
    const names = d.names || {};

    // Create reverse mapping: { "Team": "customfield_10001", ... }
    const labelToCf = {};
    Object.entries(names).forEach(([cfId, label]) => {
      labelToCf[label.trim()] = cfId;
    });

    /**
     * Add tooltip to a field heading showing its customfield ID
     * @param {Element} heading - The h2 or h3 element containing the field label
     */
    function annotate(heading){
      // Skip if already processed (prevent duplicate processing)
      if(heading._cfDone) return;
      heading._cfDone = true;

      const txt = heading.textContent.trim();
      const cfId = labelToCf[txt]; // Look up customfield ID by label text

      if(cfId){
        // Add tooltip: "customfield_10001: Team"
        heading.setAttribute('title', `${cfId}: ${txt}`);
      }
    }

    /**
     * Scan for all field headings and add tooltips
     * @param {Element} root - DOM element to search within (defaults to entire document)
     */
    function scan(root = document){
      root
        .querySelectorAll(
          // Target both multiline and single-line field headings
          'h2[data-component-selector="jira-issue-field-heading-multiline-field-heading-title"],' +
          'h3[data-component-selector="jira-issue-field-heading-field-heading-title"]'
        )
        .forEach(annotate);
    }

    // ──── STEP 4: Initial scan ────
    scan();

    // ──── STEP 5: Watch for dynamically added fields ────
    // Jira uses React which dynamically adds/removes DOM elements
    new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(node => {
          // Only scan element nodes (nodeType 1), not text nodes
          if(node.nodeType === 1) scan(node);
        });
      });
    }).observe(document.body, {
      childList: true,  // Watch for added/removed children
      subtree: true     // Watch entire DOM tree
    });

  })
  .catch(err => {
    console.error("Jira customfield tooltip script error:", err);
  });

})();