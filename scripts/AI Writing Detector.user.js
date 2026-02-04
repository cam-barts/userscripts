// ==UserScript==
// @name         AI Writing Detector
// @version      0.2
// @description  Highlights signs of AI-generated writing based on Wikipedia's Signs of AI writing
// @author       cam-barts
// @match        *://*/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/AI%20Writing%20Detector.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/AI%20Writing%20Detector.user.js
// ==/UserScript==
/**
 * AI Writing Detector
 *
 * Inspired by:
 *   - Wikipedia: Signs of AI writing
 *     https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
 *   - humanizer by blader
 *     https://github.com/blader/humanizer
 */
(function () {
	"use strict";

	// ──── State ────
	let highlightingEnabled = false;

	// ──── Wikipedia base URL ────
	const WIKI_BASE =
		"https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing#";

	// ──── Category colors ────
	const CATEGORY_COLORS = {
		Content: "rgba(244, 67, 54, 0.3)",
		Language: "rgba(255, 152, 0, 0.3)",
		Style: "rgba(156, 39, 176, 0.3)",
		Communication: "rgba(33, 150, 243, 0.3)",
	};

	// ──── Detection rules ────
	const RULES = [
		// ── Content Patterns (red) ──
		{
			id: "significance-inflation",
			pattern:
				/\b(marking a pivotal moment|a testament to|is a reminder of|a (?:vital|significant|crucial|pivotal|key) role|underscores its importance|highlights its significance|reflects broader|symbolizing its ongoing|contributing to the|setting the stage for|marking the|shaping the|represents a shift|marks a shift|key turning point|evolving landscape|focal point|indelible mark|deeply rooted|enduring legacy|transformative power|rich cultural heritage)\b/gi,
			category: "Content",
			name: "Significance Inflation",
			description:
				"Undue emphasis on significance, legacy, and broader trends.",
			wikiAnchor:
				"Undue_emphasis_on_significance,_legacy,_and_broader_trends",
		},
		{
			id: "notability-emphasis",
			pattern:
				/\b(independent coverage|media outlets|active social media presence|digital presence|profiled in|featured in|has been cited in)\b/gi,
			category: "Content",
			name: "Notability Emphasis",
			description:
				"Undue emphasis on notability, attribution, and media coverage.",
			wikiAnchor:
				"Undue_emphasis_on_notability,_attribution,_and_media_coverage",
		},
		{
			id: "superficial-analyses",
			pattern:
				/(?:, (?:highlighting|underscoring|emphasizing|ensuring|reflecting|symbolizing|contributing to|cultivating|fostering|encompassing|showcasing)\b|\b(?:valuable insights|align with|resonate with)\b)/gi,
			category: "Content",
			name: "Superficial Analyses",
			description:
				"Trailing participial phrases that add shallow analysis.",
			wikiAnchor: "Superficial_analyses",
		},
		{
			id: "promotional-language",
			pattern:
				/\b(breathtaking|stunning|nestled|renowned|world-class|cutting-edge|state-of-the-art|unparalleled|groundbreaking|trailblazing)\b/gi,
			category: "Content",
			name: "Promotional Language",
			description: "Advertisement-like or promotional wording.",
			wikiAnchor: "Promotional_and_advertisement-like_language",
		},
		{
			id: "vague-attributions",
			pattern:
				/\b(experts argue|experts believe|observers note|industry reports suggest|many believe|some argue|critics argue|widely regarded|generally considered)\b/gi,
			category: "Content",
			name: "Vague Attributions",
			description:
				"Vague attributions and overgeneralization of opinions.",
			wikiAnchor:
				"Vague_attributions_and_overgeneralization_of_opinions",
		},
		{
			id: "formulaic-challenges",
			pattern:
				/\b(despite challenges|continues to thrive|continues to evolve|remains to be seen|only time will tell|shaping the future|challenges and opportunities|paving the way)\b/gi,
			category: "Content",
			name: "Formulaic Challenges",
			description:
				"Outline-like conclusions about challenges and future prospects.",
			wikiAnchor:
				"Outline-like_conclusions_about_challenges_and_future_prospects",
		},

		// ── Language Patterns (orange) ──
		{
			id: "ai-vocabulary",
			pattern:
				/\b(crucial|delves?|delving|emphasizing|enduring|enhance|fostering|garnered?|interplay|intricacies?|intricate|pivotal|showcas(?:e|ing|ed)|tapestry|testament|underscor(?:e|ed|ing)|valuable|vibrant|multifaceted|nuanced|moreover|furthermore|noteworthy|paramount|realm)\b/gi,
			category: "Language",
			name: "AI Vocabulary",
			description:
				'Overused "AI vocabulary" words rarely found in natural human writing.',
			wikiAnchor: "Overused_.22AI_vocabulary.22_words",
		},
		{
			id: "copula-avoidance",
			pattern:
				/\b(serves as a|stands as a|marks a|represents a|boasts a|features a|offers a)\b/gi,
			category: "Language",
			name: "Copula Avoidance",
			description:
				'Avoidance of basic "is"/"are" phrases in favor of elaborate substitutes.',
			wikiAnchor:
				"Avoidance_of_basic_copulatives_(%22is%22/%22are%22_phrases)",
		},
		{
			id: "negative-parallelisms",
			pattern:
				/\b(not only\b.{1,40}\bbut\b|it's not just\b.{1,40}\bit's\b|not merely\b.{1,40}\bbut\b|rather, it)\b/gi,
			category: "Language",
			name: "Negative Parallelisms",
			description:
				'Formulaic "not only...but" and similar parallel constructions.',
			wikiAnchor: "Negative_parallelisms",
		},
		{
			id: "false-ranges",
			pattern: /\bfrom\s+\w+(?:\s+\w+){0,3}\s+to\s+\w+(?:\s+\w+){0,3}\b/gi,
			category: "Language",
			name: "False Ranges",
			description:
				'"From X to Y" constructions that create artificial breadth. Flag for review.',
			wikiAnchor: "False_ranges",
		},

		// ── Style Patterns (purple) ──
		{
			id: "em-dash-overuse",
			pattern: /\u2014/g,
			category: "Style",
			name: "Em Dash Overuse",
			description:
				"Overuse of em dashes is a common marker of AI-generated text.",
			wikiAnchor: "Overuse_of_em_dashes",
		},
		{
			id: "curly-quotes",
			pattern: /[\u201c\u201d\u2018\u2019]/g,
			category: "Style",
			name: "Curly Quotes",
			description:
				"Curly quotation marks and apostrophes uncommon in web-typed text.",
			wikiAnchor: "Curly_quotation_marks_and_apostrophes",
		},

		// ── Communication Patterns (blue) ──
		{
			id: "chatbot-artifacts",
			pattern:
				/\b(I hope this helps|Of course!|Certainly!|You're absolutely right|Would you like|is there anything else|let me know|here is a|more detailed breakdown|feel free to)\b/gi,
			category: "Communication",
			name: "Chatbot Artifacts",
			description:
				"Collaborative communication phrases typical of chatbot output.",
			wikiAnchor: "Collaborative_communication",
		},
		{
			id: "knowledge-cutoff",
			pattern:
				/\b(as of my last|up to my last training|as of my last knowledge update|specific details are limited|specific details are scarce|not widely available|not widely documented|not widely disclosed|in the provided sources|in the available sources|based on available information|in the search results)\b/gi,
			category: "Communication",
			name: "Knowledge-Cutoff Disclaimers",
			description:
				"Disclaimers about training data cutoffs or source limitations.",
			wikiAnchor:
				"Knowledge-cutoff_disclaimers_and_speculation_about_gaps_in_sources",
		},
	];

	// ──── CSS Injection ────
	function injectStyles() {
		if (document.getElementById("ai-detect-styles")) {
			return;
		}
		const style = document.createElement("style");
		style.id = "ai-detect-styles";
		style.textContent = `
      .ai-detect-highlight {
        position: relative;
        border-radius: 2px;
        cursor: help;
        transition: opacity 0.2s;
      }
      .ai-detect-highlight.cat-Content {
        background-color: ${CATEGORY_COLORS.Content};
      }
      .ai-detect-highlight.cat-Language {
        background-color: ${CATEGORY_COLORS.Language};
      }
      .ai-detect-highlight.cat-Style {
        background-color: ${CATEGORY_COLORS.Style};
      }
      .ai-detect-highlight.cat-Communication {
        background-color: ${CATEGORY_COLORS.Communication};
      }
      .ai-detect-highlight:hover {
        opacity: 0.85;
      }
      .ai-detect-tooltip {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 8px;
        padding: 10px 12px;
        background: #2c3e50;
        color: #ecf0f1;
        border-radius: 6px;
        font-size: 13px;
        line-height: 1.5;
        white-space: normal;
        min-width: 260px;
        max-width: 340px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 100000;
        pointer-events: auto;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .ai-detect-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: #2c3e50;
      }
      .ai-detect-highlight:hover .ai-detect-tooltip {
        opacity: 1;
        visibility: visible;
      }
      .ai-detect-tooltip .ai-cat-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 3px;
        font-weight: bold;
        font-size: 11px;
        color: #fff;
        margin-right: 6px;
      }
      .ai-detect-tooltip .ai-cat-badge.cat-Content { background: #f44336; }
      .ai-detect-tooltip .ai-cat-badge.cat-Language { background: #ff9800; }
      .ai-detect-tooltip .ai-cat-badge.cat-Style { background: #9c27b0; }
      .ai-detect-tooltip .ai-cat-badge.cat-Communication { background: #2196f3; }
      .ai-detect-tooltip .ai-detect-link {
        display: inline-block;
        margin-top: 6px;
        color: #3498db;
        text-decoration: underline;
        font-size: 12px;
        cursor: pointer;
      }
      .ai-detect-tooltip .ai-detect-link:hover {
        color: #5dade2;
      }
      #ai-detect-toggle {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #1B1D23;
        color: #ccc;
        border: 2px solid #555;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        transition: border-color 0.3s, color 0.3s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #ai-detect-toggle:hover {
        border-color: #888;
        color: #fff;
      }
      #ai-detect-toggle.active {
        border-color: #f44336;
        color: #f44336;
      }
      #ai-detect-summary {
        position: fixed;
        bottom: 72px;
        right: 20px;
        background: #1B1D23;
        color: #ecf0f1;
        border: 1px solid #555;
        border-radius: 8px;
        padding: 10px 14px;
        font-size: 12px;
        line-height: 1.6;
        z-index: 99999;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
        min-width: 180px;
      }
      #ai-detect-toggle:hover + #ai-detect-summary,
      #ai-detect-summary:hover {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
    `;
		document.head.appendChild(style);
	}

	// ──── Tooltip creation ────
	function createTooltip(rule) {
		const tooltip = document.createElement("div");
		tooltip.className = "ai-detect-tooltip";
		tooltip.innerHTML =
			'<div><span class="ai-cat-badge cat-' +
			rule.category +
			'">' +
			rule.category +
			"</span><strong>" +
			rule.name +
			"</strong></div>" +
			'<div style="margin-top:4px;font-size:12px;color:#bdc3c7;">' +
			rule.description +
			"</div>" +
			'<a class="ai-detect-link" href="' +
			WIKI_BASE +
			rule.wikiAnchor +
			'" target="_blank" rel="noopener">Learn more on Wikipedia</a>';
		return tooltip;
	}

	// ──── DOM traversal & highlighting ────
	function highlightPatterns() {
		injectStyles();

		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: function (node) {
					const parent = node.parentElement;
					if (!parent) return NodeFilter.FILTER_REJECT;
					const tag = parent.tagName.toLowerCase();
					if (
						[
							"script",
							"style",
							"noscript",
							"iframe",
							"textarea",
							"input",
							"code",
							"pre",
						].includes(tag)
					) {
						return NodeFilter.FILTER_REJECT;
					}
					// Skip our own UI elements
					if (
						parent.closest(
							"#ai-detect-toggle, #ai-detect-summary, .ai-detect-tooltip",
						)
					) {
						return NodeFilter.FILTER_REJECT;
					}
					if (parent.classList.contains("ai-detect-highlight")) {
						return NodeFilter.FILTER_REJECT;
					}
					if (node.textContent.trim().length > 0) {
						return NodeFilter.FILTER_ACCEPT;
					}
					return NodeFilter.FILTER_REJECT;
				},
			},
		);

		const textNodes = [];
		let n;
		while ((n = walker.nextNode())) {
			textNodes.push(n);
		}

		let totalMatches = 0;
		const categoryCounts = { Content: 0, Language: 0, Style: 0, Communication: 0 };

		textNodes.forEach((textNode) => {
			const text = textNode.textContent;
			// Collect all matches across all rules
			const matches = [];
			for (const rule of RULES) {
				rule.pattern.lastIndex = 0; // reset regex state
				let m;
				while ((m = rule.pattern.exec(text)) !== null) {
					matches.push({
						start: m.index,
						end: m.index + m[0].length,
						matchText: m[0],
						rule: rule,
					});
				}
			}

			if (matches.length === 0) return;

			// Sort by start position
			matches.sort((a, b) => a.start - b.start);

			// Remove overlapping matches (keep earlier/longer)
			const filtered = [];
			for (const match of matches) {
				if (
					filtered.length === 0 ||
					match.start >= filtered[filtered.length - 1].end
				) {
					filtered.push(match);
				}
			}

			if (filtered.length === 0) return;

			// Build replacement fragment (process forward)
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;

			for (const match of filtered) {
				// Text before this match
				if (match.start > lastIndex) {
					fragment.appendChild(
						document.createTextNode(text.slice(lastIndex, match.start)),
					);
				}

				// Highlighted span
				const span = document.createElement("span");
				span.className =
					"ai-detect-highlight cat-" + match.rule.category;
				span.dataset.originalText = match.matchText;
				span.textContent = match.matchText;
				span.appendChild(createTooltip(match.rule));
				fragment.appendChild(span);

				totalMatches++;
				categoryCounts[match.rule.category]++;

				lastIndex = match.end;
			}

			// Remaining text after last match
			if (lastIndex < text.length) {
				fragment.appendChild(
					document.createTextNode(text.slice(lastIndex)),
				);
			}

			textNode.parentNode.replaceChild(fragment, textNode);
		});

		highlightingEnabled = true;
		updateSummary(totalMatches, categoryCounts);
		updateButtonState();
	}

	// ──── Remove highlights ────
	function removeHighlights() {
		const highlights = document.querySelectorAll(".ai-detect-highlight");
		highlights.forEach((highlight) => {
			const text =
				highlight.dataset.originalText || highlight.firstChild.textContent;
			const textNode = document.createTextNode(text);
			highlight.parentNode.replaceChild(textNode, highlight);
		});
		highlightingEnabled = false;
		document.body.normalize();
		updateSummary(0, null);
		updateButtonState();
	}

	// ──── Toggle ────
	function toggleHighlighting() {
		if (highlightingEnabled) {
			removeHighlights();
		} else {
			highlightPatterns();
		}
	}

	// ──── Summary panel ────
	function updateSummary(total, counts) {
		const summary = document.getElementById("ai-detect-summary");
		if (!summary) return;
		if (!highlightingEnabled || total === 0) {
			summary.innerHTML =
				'<div style="color:#95a5a6;">Click to scan page for AI writing signals</div>';
			return;
		}
		let html = "<div><strong>" + total + " signals found</strong></div>";
		for (const [cat, count] of Object.entries(counts)) {
			if (count > 0) {
				html +=
					'<div style="margin-top:2px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
					CATEGORY_COLORS[cat] +
					';margin-right:6px;vertical-align:middle;border:1px solid rgba(255,255,255,0.3);"></span>' +
					cat +
					": " +
					count +
					"</div>";
			}
		}
		summary.innerHTML = html;
	}

	// ──── Button state ────
	function updateButtonState() {
		const btn = document.getElementById("ai-detect-toggle");
		if (!btn) return;
		if (highlightingEnabled) {
			btn.classList.add("active");
		} else {
			btn.classList.remove("active");
		}
	}

	// ──── Create toggle button ────
	function createToggleButton() {
		injectStyles();

		const btn = document.createElement("button");
		btn.id = "ai-detect-toggle";
		btn.textContent = "AI";
		btn.title = "Toggle AI writing detection";
		btn.addEventListener("click", toggleHighlighting);

		const summary = document.createElement("div");
		summary.id = "ai-detect-summary";
		summary.innerHTML =
			'<div style="color:#95a5a6;">Click to scan page for AI writing signals</div>';

		document.body.appendChild(btn);
		document.body.appendChild(summary);
	}

	// ──── Initialize ────
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", createToggleButton);
	} else {
		createToggleButton();
	}
})();
