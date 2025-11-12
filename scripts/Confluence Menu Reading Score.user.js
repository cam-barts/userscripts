// ==UserScript==
// @name         Confluence Menu: Reading Score
// @version      0.3
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
 * !  DEPENDENCY: This script requires "Confluence Menu Base" to function.
 *     Install the base script first to enable the menu system.
 *
 * Analyzes the readability of Confluence page content using multiple
 * industry-standard readability metrics. Features hemingwayapp.com-inspired
 * sentence highlighting to identify complex sentences.
 *
 * Usage:
 * - Click "Readability 📰" to see overall page scores
 * - Click "Highlight Sentences 🎨" to toggle sentence highlighting
 */
(function () {
	"use strict";
	// Check if FireMonkeyMenu API is available from base script
	if (typeof window.FireMonkeyMenu === "undefined") {
		console.error(
			'Confluence Menu: Reading Score requires "Confluence Menu Base" script to be installed.',
		);
		return;
	}
	// State management
	let highlightingEnabled = false;
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
		const wordArray = text.split(" ").filter((word) => word !== "");
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
		const characterCount = text.replace(/\s/g, "").length;
		// ──── Calculate Readability Metrics ────
		// Automated Readability Index (ARI): Grade level
		const ari =
			4.71 * (characterCount / wordCount) +
			0.5 * (wordCount / sentenceCount) -
			21.43;
		// Coleman-Liau Index: Grade level
		const coleman =
			0.0588 * ((characterCount / wordCount) * 100) -
			0.296 * ((sentenceCount / wordCount) * 100) -
			15.8;
		// Flesch Reading Ease: Higher = easier (60-70 = standard)
		const flesch =
			206.835 -
			1.015 * (wordCount / sentenceCount) -
			84.6 * (totalSyllables / wordCount);
		// SMOG (Simple Measure of Gobbledygook): Grade level
		const smog =
			3.1291 +
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
	/**
	 * Analyze a single sentence for readability
	 * @param {string} sentence - Sentence to analyze
	 * @returns {Object} Readability metrics for the sentence
	 */
	function analyzeSentence(sentence) {
		// Clean up the sentence
		sentence = sentence.trim();
		if (!sentence) {
			return null;
		}
		// Split into words and filter out empty strings
		const wordArray = sentence.split(/\s+/).filter((word) => word !== "");
		const wordCount = wordArray.length;
		// Count syllables and polysyllabic words
		let totalSyllables = 0;
		let polysyllabicWords = 0;
		for (let word of wordArray) {
			const syllables = syllable_count(word);
			totalSyllables += syllables;
			if (syllables >= 3) {
				polysyllabicWords += 1;
			}
		}
		// Count non-whitespace characters
		const characterCount = sentence.replace(/\s/g, "").length;
		// For single-sentence metrics, we treat it as 1 sentence
		const sentenceCount = 1;
		// Calculate all readability metrics
		// Automated Readability Index (ARI): Grade level
		const ari =
			wordCount > 0
				? 4.71 * (characterCount / wordCount) +
					0.5 * (wordCount / sentenceCount) -
					21.43
				: 0;
		// Coleman-Liau Index: Grade level
		const coleman =
			wordCount > 0
				? 0.0588 * ((characterCount / wordCount) * 100) -
					0.296 * ((sentenceCount / wordCount) * 100) -
					15.8
				: 0;
		// Flesch Reading Ease: Higher = easier (60-70 = standard)
		const flesch =
			wordCount > 0 && totalSyllables > 0
				? 206.835 -
					1.015 * (wordCount / sentenceCount) -
					84.6 * (totalSyllables / wordCount)
				: 100;
		// SMOG (Simple Measure of Gobbledygook): Grade level
		// Note: SMOG typically requires 30 sentences, so this is an approximation
		const smog = 3.1291 + 1.043 * Math.sqrt((polysyllabicWords || 0) * 30);
		return {
			wordCount,
			totalSyllables,
			polysyllabicWords,
			characterCount,
			ari,
			coleman,
			flesch,
			smog,
			text: sentence,
		};
	}
	/**
	 * Determine difficulty level based on sentence metrics
	 * @param {Object} metrics - Sentence readability metrics
	 * @returns {string} 'easy', 'moderate', 'hard', or 'very-hard'
	 */
	function getDifficultyLevel(metrics) {
		if (!metrics) return "easy";
		// hemingwayapp.com-inspired difficulty criteria:
		// - Very hard to read (red): Flesch < 30 OR word count > 30
		// - Hard to read (yellow): Flesch 30-50 OR word count > 20
		// - Moderate to easy: everything else
		if (metrics.flesch < 30 || metrics.wordCount > 30) {
			return "very-hard";
		} else if (metrics.flesch < 50 || metrics.wordCount > 20) {
			return "hard";
		}
		return "easy";
	}
	/**
	 * Inject CSS styles for highlighting and tooltips
	 */
	function injectStyles() {
		if (document.getElementById("confluence-readability-styles")) {
			return; // Styles already injected
		}
		const style = document.createElement("style");
		style.id = "confluence-readability-styles";
		style.textContent = `
      .readability-highlight {
        position: relative;
        border-radius: 2px;
        cursor: help;
        transition: opacity 0.2s;
      }
      .readability-highlight.hard {
        background-color: rgba(255, 193, 7, 0.3);
      }
      .readability-highlight.very-hard {
        background-color: rgba(244, 67, 54, 0.3);
      }
      .readability-highlight:hover {
        opacity: 0.8;
      }
      .readability-tooltip {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 8px;
        padding: 12px;
        background: #2c3e50;
        color: white;
        border-radius: 6px;
        font-size: 13px;
        line-height: 1.5;
        white-space: normal;
        min-width: 280px;
        max-width: 350px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .readability-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: #2c3e50;
      }
      .readability-highlight:hover .readability-tooltip {
        opacity: 1;
      }
      .readability-tooltip strong {
        color: #3498db;
      }
      .readability-tooltip .severity {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 3px;
        margin-left: 6px;
        font-weight: bold;
        font-size: 11px;
      }
      .readability-tooltip .severity.hard {
        background-color: #ff9800;
        color: #000;
      }
      .readability-tooltip .severity.very-hard {
        background-color: #f44336;
        color: #fff;
      }
    `;
		document.head.appendChild(style);
	}
	/**
	 * Create tooltip element for a sentence
	 * @param {Object} metrics - Sentence readability metrics
	 * @param {string} difficulty - Difficulty level
	 * @returns {HTMLElement} Tooltip element
	 */
	function createTooltip(metrics, difficulty) {
		const tooltip = document.createElement("div");
		tooltip.className = "readability-tooltip";
		const severityLabel =
			difficulty === "very-hard" ? "Very Hard to Read" : "Hard to Read";
		const severityClass = difficulty;
		// Helper function to format score with indicator
		const formatScore = (value, target, higherIsBetter = false) => {
			const isGood = higherIsBetter ? value >= target : value <= target;
			const color = isGood ? "#4caf50" : "#f44336";
			return `<span style="color: ${color}">${value.toFixed(1)}</span>`;
		};
		tooltip.innerHTML = `
      <div><strong>Readability Issue</strong> <span class="severity ${severityClass}">${severityLabel}</span></div>
      <div style="margin-top: 6px; font-size: 12px;">
        <div><strong>Words:</strong> ${metrics.wordCount}</div>
      </div>
      <div style="margin-top: 6px; font-size: 12px; border-top: 1px solid #34495e; padding-top: 6px;">
        <div style="margin-bottom: 3px;"><strong>Readability Scores:</strong></div>
        <div style="margin-left: 8px;">
          <div>ARI: ${formatScore(metrics.ari, 10, false)} (Target: ≤10)</div>
          <div>Coleman-Liau: ${formatScore(
						metrics.coleman,
						10,
						false,
					)} (Target: ≤10)</div>
          <div>Flesch: ${formatScore(
						metrics.flesch,
						60,
						true,
					)} (Target: ≥60)</div>
          <div>SMOG: ${formatScore(metrics.smog, 10, false)} (Target: ≤10)</div>
        </div>
      </div>
      <div style="font-size: 11px; color: #95a5a6; margin-top: 6px; border-top: 1px solid #34495e; padding-top: 4px;">${
				difficulty === "very-hard"
					? "This sentence is very complex. Consider splitting it."
					: "This sentence is complex. Consider simplifying."
			}</div>
    `;
		return tooltip;
	}
	/**
	 * Highlight difficult sentences in the content
	 */
	function highlightSentences() {
		const contentElement = document.getElementById("content");
		if (!contentElement) {
			alert("Could not find content element to analyze.");
			return;
		}
		// Inject styles first
		injectStyles();
		// Get all text nodes in the content
		const walker = document.createTreeWalker(
			contentElement,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: function (node) {
					// Skip script, style, and other non-content elements
					const parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;
					const tagName = parent.tagName.toLowerCase();
					if (["script", "style", "noscript", "iframe"].includes(tagName)) {
						return NodeFilter.FILTER_REJECT;
					}
					// Only process text nodes with actual content
					if (node.textContent.trim().length > 0) {
						return NodeFilter.FILTER_ACCEPT;
					}
					return NodeFilter.FILTER_REJECT;
				},
			},
		);
		const textNodes = [];
		let node;
		while ((node = walker.nextNode())) {
			textNodes.push(node);
		}
		// Process each text node
		textNodes.forEach((textNode) => {
			const text = textNode.textContent;
			// Split by sentence-ending punctuation
			const sentences = text.split(/([.!?]+(?:\s|$))/);
			if (sentences.length <= 1) {
				return; // No sentences to highlight
			}
			const fragment = document.createDocumentFragment();
			for (let i = 0; i < sentences.length; i += 2) {
				const sentence = sentences[i];
				const punctuation = sentences[i + 1] || "";
				const fullSentence = sentence + punctuation;
				if (!sentence.trim()) {
					fragment.appendChild(document.createTextNode(fullSentence));
					continue;
				}
				const metrics = analyzeSentence(sentence);
				// Skip very short sentences (3 words or less)
				if (!metrics || metrics.wordCount <= 3) {
					fragment.appendChild(document.createTextNode(fullSentence));
					continue;
				}
				const difficulty = getDifficultyLevel(metrics);
				if (difficulty === "hard" || difficulty === "very-hard") {
					const span = document.createElement("span");
					span.className = `readability-highlight ${difficulty}`;
					span.dataset.originalText = fullSentence; // Store original text
					span.textContent = fullSentence;
					const tooltip = createTooltip(metrics, difficulty);
					span.appendChild(tooltip);
					fragment.appendChild(span);
				} else {
					fragment.appendChild(document.createTextNode(fullSentence));
				}
			}
			textNode.parentNode.replaceChild(fragment, textNode);
		});
		highlightingEnabled = true;
	}
	/**
	 * Remove all sentence highlighting
	 */
	function removeHighlights() {
		const highlights = document.querySelectorAll(".readability-highlight");
		highlights.forEach((highlight) => {
			// Use the stored original text instead of textContent (which includes tooltip)
			const text = highlight.dataset.originalText || highlight.textContent;
			const textNode = document.createTextNode(text);
			highlight.parentNode.replaceChild(textNode, highlight);
		});
		highlightingEnabled = false;
		// Normalize text nodes to merge adjacent text nodes
		const contentElement = document.getElementById("content");
		if (contentElement) {
			contentElement.normalize();
		}
	}
	/**
	 * Toggle sentence highlighting on/off
	 */
	function toggleHighlighting() {
		if (highlightingEnabled) {
			removeHighlights();
		} else {
			highlightSentences();
		}
	}
	// Register commands in the Confluence menu
	FireMonkeyMenu.registerCommand({
		enabled: true,
		name: "Readability 📰",
		tooltip: "Calculate readability scores for this page",
		color: "#2196F3",
		callback: calculateReadability,
	});
	FireMonkeyMenu.registerCommand({
		enabled: true,
		name: "Highlight Sentences 🎨",
		tooltip: "Toggle hemingwayapp.com-inspired sentence highlighting",
		color: "#FF9800",
		callback: toggleHighlighting,
	});
})();
