// Helpers for loading real .user.js bodies into a Playwright page without a
// browser extension. Injection ORDER is the whole point of this harness, so it
// is always explicit at the call site.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '../..');
export const FIXTURE_URL = pathToFileURL(path.join(here, 'page-with-table.html')).href;
export const GM_SHIM = path.join(here, 'gm-shim.js');

const META = /\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/;
const CLIENT = 'FireMonkey Hub Client.user.js';
const REQUIRES_CLIENT = /^\/\/ @require\s+FireMonkey Hub Client\s*$/m;

function readScript(name) {
  return fs.readFileSync(path.join(REPO, 'scripts', name), 'utf8');
}

/** Read a userscript and strip its ==UserScript== metadata block. */
export function scriptBody(name) {
  return readScript(name).replace(META, '');
}

/**
 * FireMonkey inlines @require'd code before the requiring script's own body.
 * Mirror that here: if the script declares `@require FireMonkey Hub Client`,
 * prepend the client's body (also metadata-stripped) to its own.
 */
function bodyWithRequires(name) {
  const body = scriptBody(name);
  return REQUIRES_CLIENT.test(readScript(name)) ? scriptBody(CLIENT) + '\n' + body : body;
}

/**
 * FireMonkey exposes GM.info (no @grant needed) built from the metadata block;
 * the shim can't know which script is running, so each injection stamps its own
 * GM.info immediately before its body. Every consumer that reads GM.info (now
 * most of them, via FMHubClient) gets its own correct stamp; only the order
 * of successive injections into the same page could make a later one win.
 */
function gmInfo(name) {
  const meta = (readScript(name).match(META) || [''])[0];
  const field = (key) => {
    const m = meta.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const script = { name: field('name'), version: field('version'), description: field('description') };
  return `if (window.GM) window.GM.info = { script: ${JSON.stringify(script)} };\n`;
}

/**
 * @run-at document-start: body runs immediately, before the DOM is parsed.
 */
export function injectStart(page, name) {
  return page.addInitScript(gmInfo(name) + bodyWithRequires(name));
}

/**
 * @run-at document-idle: body runs after DOMContentLoaded, because these
 * scripts append to document.body at top level. addInitScript still guarantees
 * the *registration* order, so DOMContentLoaded replays it faithfully.
 */
export function injectIdle(page, name) {
  return page.addInitScript(
    `document.addEventListener('DOMContentLoaded', function () {\n${gmInfo(name)}${bodyWithRequires(name)}\n});`
  );
}

/** Inject a document-idle script into an already-loaded page (post-hubReady). */
export function injectLate(page, name) {
  return page.addScriptTag({ content: gmInfo(name) + bodyWithRequires(name) });
}

export const STATE_KEY = 'fmhub.state.v1';

/** Parse the Hub's persisted state out of the GM store. */
export function readPersistedState(page) {
  return page.evaluate((key) => {
    const raw = window.__GM_STORE__.get(key);
    return raw ? JSON.parse(raw) : null;
  }, STATE_KEY);
}

export function readEvents(page) {
  return page.evaluate(() => window.__FMHUB_EVENTS__);
}
