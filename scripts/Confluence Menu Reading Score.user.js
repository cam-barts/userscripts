// ==UserScript==
// @name         Confluence Menu: Reading Score
// @version      0.1
// @description  Add command menu to Confluence pages
// @author       cam-barts
// @match        *://*/wiki/*
// @grant        none
// @require      Confluence Menu Base
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Reading%20Score.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Confluence%20Menu%20Reading%20Score.user.js
// ==/UserScript==

/**
 * Confluence Menu: Reading Score
 *
 * ⚠️  DEPENDENCY: This script requires "Confluence Menu Base" to function.
 *     Install the base script first to enable the menu system.
 *
 * Analyzes the readability of Confluence page content using multiple
 * industry-standard readability metrics.
 *
 * Usage: Click "Readability 📰" button in the floating menu
 */
(function() {
  'use strict';

  // Check if FireMonkeyMenu API is available from base script
  if (typeof window.FireMonkeyMenu === 'undefined') {
    console.error('Confluence Menu: Reading Score requires "Confluence Menu Base" script to be installed.');
    return;
  }

  /**
   * Count syllables in a word using phonetic patterns
   * @param {string} word - Word to analyze
   * @returns {number} Estimated syllable count
   */
  function syllable_count(word) {
    word = word.toLowerCase();

    // Short words typically have 1 syllable
    if (word.length <= 3) {
      return 1;
    }

    // Remove silent endings (e.g., "make" has 1 syllable, not 2)
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");

    // Remove leading 'y' if it acts as consonant (e.g., "yes")
    word = word.replace(/^y/, "");

    // Count vowel groups (each group = 1 syllable)
    try {
      return word.match(/[aeiouy]{1,2}/g).length;
    } catch (err) {
      // Fallback for edge cases
      return 2;
    }
  }

  /**
   * Calculate readability scores for the page
   */
  function calculateReadability() {
    // Extract all text content from Confluence page
    const text = document.getElementById("content").textContent;

    // Split into words and filter out empty strings
    const wordArray = text.split(" ").filter(word => word !== "");
    const wordCount = wordArray.length;

    // Count syllables and polysyllabic words (3+ syllables)
    let totalSyllables = 0;
    let polysyllabicWords = 0;

    // Fixed: Use 'of' instead of 'in' for array iteration
    for (let word of wordArray) {
      const syllables = syllable_count(word);
      totalSyllables += syllables;
      if (syllables >= 3) {
        polysyllabicWords += 1;
      }
    }

    // Count sentences (split by sentence-ending punctuation)
    const punctuation = /[.!?]/;
    const sentenceCount = text.split(punctuation).length;

    // Count non-whitespace characters
    const characterCount = text.replace(/\s/g, '').length;

    // ──── Calculate Readability Metrics ────

    // Automated Readability Index (ARI): Grade level
    const ari = 4.71 * (characterCount / wordCount) +
                0.5 * (wordCount / sentenceCount) - 21.43;

    // Coleman-Liau Index: Grade level
    const coleman = 0.0588 * ((characterCount / wordCount) * 100) -
                    0.296 * ((sentenceCount / wordCount) * 100) - 15.8;

    // Flesch Reading Ease: Higher = easier (60-70 = standard)
    const flesch = 206.835 -
                   1.015 * (wordCount / sentenceCount) -
                   84.6 * (totalSyllables / wordCount);

    // SMOG (Simple Measure of Gobbledygook): Grade level
    const smog = 3.1291 +
                 1.043 * Math.sqrt((polysyllabicWords || 0) * (30 / sentenceCount));

    // Display results
    const results = `
Readability Analysis
────────────────────

Automated Readability Index: ${ari.toFixed(1)} (Below 10 is Great)

Coleman-Liau Index: ${coleman.toFixed(1)} (Below 10 is Great)

Flesch Reading Ease: ${flesch.toFixed(1)} (Above 60 is Great)

SMOG Grade: ${smog.toFixed(1)} (Below 10 is Great)

────────────────────
Word Count: ${wordCount}
Sentence Count: ${sentenceCount}
    `.trim();

    alert(results);
  }

  // Register the command in the Confluence menu
  FireMonkeyMenu.registerCommand({
    enabled: true,
    name: 'Readability 📰',
    tooltip: 'Calculate readability scores for this page',
    color: '#2196F3',
    callback: calculateReadability
  });
})();