// ==UserScript==
// @name         Table to CSV
// @version      0.2
// @description  Detect tables on any page, let the user select one, and download it as CSV
// @author       cam-barts
// @match        *://*/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Table%20to%20CSV.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Table%20to%20CSV.user.js
// ==/UserScript==
(function () {
	"use strict";

	// ──── State ────
	let panelOpen = false;
	let currentHighlight = null;

	// ──── Shadow DOM host ────
	const host = document.createElement("div");
	host.id = "table-to-csv-host";
	const shadow = host.attachShadow({ mode: "closed" });

	// ──── Styles ────
	const style = document.createElement("style");
	style.textContent = `
		:host {
			all: initial;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			font-size: 14px;
			color: #333;
		}
		.csv-btn {
			position: fixed;
			bottom: 20px;
			right: 20px;
			z-index: 2147483647;
			width: 48px;
			height: 48px;
			border-radius: 50%;
			border: none;
			background: #2563eb;
			color: #fff;
			font-size: 18px;
			font-weight: bold;
			cursor: pointer;
			box-shadow: 0 2px 8px rgba(0,0,0,0.3);
			display: flex;
			align-items: center;
			justify-content: center;
			transition: background 0.2s;
		}
		.csv-btn:hover {
			background: #1d4ed8;
		}
		.csv-btn svg {
			width: 24px;
			height: 24px;
			fill: #fff;
		}
		.csv-panel {
			position: fixed;
			bottom: 78px;
			right: 20px;
			z-index: 2147483647;
			background: #fff;
			border: 1px solid #e5e7eb;
			border-radius: 8px;
			box-shadow: 0 4px 16px rgba(0,0,0,0.2);
			max-height: 320px;
			width: 280px;
			overflow-y: auto;
			padding: 8px 0;
		}
		.csv-panel-item {
			padding: 8px 16px;
			cursor: pointer;
			border: none;
			background: none;
			width: 100%;
			text-align: left;
			font-size: 13px;
			line-height: 1.4;
			color: #333;
			display: block;
			box-sizing: border-box;
		}
		.csv-panel-item:hover {
			background: #eff6ff;
		}
		.csv-panel-item .label {
			font-weight: 600;
		}
		.csv-panel-item .meta {
			color: #6b7280;
			font-size: 12px;
		}
	`;
	shadow.appendChild(style);

	// ──── Floating button ────
	const btn = document.createElement("button");
	btn.className = "csv-btn";
	btn.title = "Download table as CSV";
	btn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<path d="M4 4h6v2H6v3h4v2H6v3h4v2H4V4zm8 0h6v2h-4v3h4v2h-4v3h4v2h-6V4zm-1 14h6v2H11v-2zM5 20h4v2H5v-2zm14-16v12h-2V6h-1V4h3zM7 18l5 4 5-4h-3v-3h-4v3H7z"/>
	</svg>`;
	btn.style.display = "none";
	shadow.appendChild(btn);

	// ──── Panel ────
	const panel = document.createElement("div");
	panel.className = "csv-panel";
	panel.style.display = "none";
	shadow.appendChild(panel);

	document.body.appendChild(host);

	// ──── CSV conversion ────
	function escapeCsvValue(val) {
		if (val.includes(",") || val.includes('"') || val.includes("\n")) {
			return '"' + val.replace(/"/g, '""') + '"';
		}
		return val;
	}

	function tableToCsv(table) {
		const rows = [];
		for (const tr of table.rows) {
			const cells = [];
			for (const cell of tr.cells) {
				cells.push(escapeCsvValue(cell.textContent.trim()));
			}
			rows.push(cells.join(","));
		}
		return rows.join("\n");
	}

	// ──── Download helper ────
	function downloadCsv(csv, index) {
		const title = document.title.replace(/[^\w\s-]/g, "").trim() || "page";
		const filename = `${title} - Table ${index + 1}.csv`;
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.style.display = "none";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	// ──── Table summary ────
	function tableSummary(table, index) {
		const rows = table.rows.length;
		const cols = table.rows.length > 0 ? table.rows[0].cells.length : 0;
		let preview = "";
		const firstRow = table.rows[0];
		if (firstRow) {
			const texts = [];
			for (const cell of firstRow.cells) {
				const t = cell.textContent.trim();
				if (t) texts.push(t);
				if (texts.length >= 3) break;
			}
			preview = texts.join(", ");
			if (preview.length > 40) preview = preview.slice(0, 40) + "...";
		}
		return { rows, cols, preview };
	}

	// ──── Highlight helpers ────
	function highlightTable(table) {
		clearHighlight();
		currentHighlight = table;
		table.dataset.csvOriginalOutline = table.style.outline;
		table.style.outline = "3px solid #2563eb";
		table.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}

	function clearHighlight() {
		if (currentHighlight) {
			currentHighlight.style.outline =
				currentHighlight.dataset.csvOriginalOutline || "";
			delete currentHighlight.dataset.csvOriginalOutline;
			currentHighlight = null;
		}
	}

	// ──── Panel management ────
	function closePanel() {
		panel.style.display = "none";
		panel.innerHTML = "";
		panelOpen = false;
		clearHighlight();
	}

	function openPanel(tables) {
		panel.innerHTML = "";
		for (let i = 0; i < tables.length; i++) {
			const table = tables[i];
			const info = tableSummary(table, i);
			const item = document.createElement("button");
			item.className = "csv-panel-item";
			item.innerHTML = `<div class="label">Table ${i + 1}</div>
				<div class="meta">${info.rows} rows × ${info.cols} cols</div>
				${info.preview ? `<div class="meta">${info.preview}</div>` : ""}`;
			item.addEventListener("mouseenter", () => highlightTable(table));
			item.addEventListener("mouseleave", () => clearHighlight());
			item.addEventListener("click", () => {
				downloadCsv(tableToCsv(table), i);
				closePanel();
			});
			panel.appendChild(item);
		}
		panel.style.display = "block";
		panelOpen = true;
	}

	// ──── Button click handler ────
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		if (panelOpen) {
			closePanel();
			return;
		}
		const tables = document.querySelectorAll("table");
		if (tables.length === 0) return;
		if (tables.length === 1) {
			downloadCsv(tableToCsv(tables[0]), 0);
			return;
		}
		openPanel(tables);
	});

	// ──── Close panel on outside click / Escape ────
	document.addEventListener("click", () => {
		if (panelOpen) closePanel();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && panelOpen) closePanel();
	});

	// ──── Table detection & observation ────
	function updateButtonVisibility() {
		const tables = document.querySelectorAll("table");
		btn.style.display = tables.length > 0 ? "flex" : "none";
	}

	updateButtonVisibility();

	new MutationObserver(() => updateButtonVisibility()).observe(document.body, {
		childList: true,
		subtree: true,
	});
})();
