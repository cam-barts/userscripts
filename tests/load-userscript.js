import { readFileSync } from "node:fs";

const METADATA_BLOCK = /\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n?/;

/**
 * Load a .user.js file for testing: strips the ==UserScript== metadata
 * block (which isn't valid to execute outside a userscript manager) and
 * runs the remaining body against the given window/document.
 *
 * @param {string} filePath - absolute or relative path to the .user.js file
 * @param {Window} [win] - defaults to the jsdom global `window`
 * @param {Document} [doc] - defaults to the jsdom global `document`
 */
export function loadUserscript(filePath, win = window, doc = document) {
  const src = readFileSync(filePath, "utf8");
  const body = src.replace(METADATA_BLOCK, "");
  new Function("window", "document", "unsafeWindow", body)(win, doc, win);
}
