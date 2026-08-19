// End-to-end harness for the fmhub:* CustomEvent protocol.
//
// No browser extension is involved: the Hub and one consumer userscript are
// injected into a single page in an order this harness controls explicitly
// (sequential addInitScript calls run in registration order). That determinism
// is the point: both hub bugs under test are ordering bugs.
import { test, expect } from '@playwright/test';
import {
  FIXTURE_URL,
  GM_SHIM,
  injectIdle,
  injectLate,
  readPersistedState,
  readEvents,
} from '../fixtures/inject.js';

const HUB = 'FireMonkey Hub.user.js';
const CONSUMER = 'Table to CSV.user.js';

const CONSUMER_SCRIPT_ID = 'table-to-csv';
const CONSUMER_COMMAND_NAME = 'Export Table to CSV';

/** Wait until an fmhub:* event of this type has been recorded. */
function waitForEvent(page, type) {
  return page.waitForFunction(
    (t) => (window.__FMHUB_EVENTS__ || []).some((e) => e.type === t),
    `fmhub:${type}`
  );
}

/** Wait until the Hub has persisted a script id (proves a full round-trip). */
function waitForPersistedScript(page, id) {
  return page.waitForFunction((scriptId) => {
    const raw = window.__GM_STORE__ && window.__GM_STORE__.get('fmhub.state.v1');
    if (!raw) return false;
    try { return !!JSON.parse(raw).scripts[scriptId]; } catch { return false; }
  }, id);
}

/** Read a shadow-rooted element's computed display. Returns null if absent. */
function shadowDisplay(page, hostSelector, innerSelector) {
  return page.evaluate(([host, inner]) => {
    const h = document.querySelector(host);
    if (!h || !h.shadowRoot) return null;
    const el = h.shadowRoot.querySelector(inner);
    if (!el) return null;
    return getComputedStyle(el).display;
  }, [hostSelector, innerSelector]);
}

/** Text of every rendered command row in the Hub's Actions tab. */
function hubCommandNames(page) {
  return page.evaluate(() => {
    window.FireMonkeyHub.openHub();
    const h = document.querySelector('#fmhub-host');
    if (!h || !h.shadowRoot) return null;
    return [...h.shadowRoot.querySelectorAll('.cmd-name')].map((el) => el.textContent);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The consolidation fix: all fmhub:* listeners are registered synchronously
// before the Hub's first await, and fmhub:hubReady is broadcast only after
// state is loaded and self-declare has landed. A consumer that declared itself
// before the Hub existed re-declares during the hubReady dispatch, and that
// declaration must reach persisted state.scripts.
// ───────────────────────────────────────────────────────────────────────────
test('consumer declared before the Hub loads reaches persisted state', async ({ page }) => {
  await page.addInitScript({ path: GM_SHIM });
  await injectIdle(page, CONSUMER);   // consumer BEFORE hub
  await injectIdle(page, HUB);

  await page.goto(FIXTURE_URL);

  // Control: the Hub's own self-declare. If this times out the harness is
  // broken, not the hub.
  await waitForPersistedScript(page, 'firemonkey-hub');

  const events = await readEvents(page);
  const types = events.map((e) => e.type);
  // The consumer really did declare itself over the protocol...
  expect(types).toContain('fmhub:declareScript');

  await waitForPersistedScript(page, CONSUMER_SCRIPT_ID);
  const state = await readPersistedState(page);
  expect(Object.keys(state.scripts)).toContain(CONSUMER_SCRIPT_ID);

  // ...and what landed is the declaration the consumer actually emitted, not a
  // placeholder. (Replaces the old fmhubDiag().localScriptIds read: the Hub no
  // longer keeps an unflushed local queue, storage is the only copy.)
  const declared = events
    .filter((e) => e.type === 'fmhub:declareScript')
    .map((e) => JSON.parse(e.detail))
    .find((d) => d.id === CONSUMER_SCRIPT_ID);
  expect(declared).toBeTruthy();
  expect(state.scripts[CONSUMER_SCRIPT_ID]).toMatchObject({
    name: declared.name,
    version: declared.version,
    downloadURL: declared.downloadURL,
  });

  // The Hub's self-declare tracks GM.info, so it can never drift from @version.
  const hubMeta = await page.evaluate(() => window.GM.info.script);
  expect(state.scripts['firemonkey-hub']).toMatchObject({
    name: hubMeta.name,
    version: hubMeta.version,
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The Hub answers fmhub:ping with fmhub:hubReady, and FMHubClient.connect()
// emits that ping right after its initial registration. So a consumer loaded
// after the Hub still discovers it immediately, hubSeen() flips true before
// connect() even returns, and the standalone fallback button never renders.
// ───────────────────────────────────────────────────────────────────────────
test('consumer loaded after the Hub suppresses its standalone fallback UI', async ({ page }) => {
  await page.addInitScript({ path: GM_SHIM });
  await injectIdle(page, HUB);

  await page.goto(FIXTURE_URL);
  await waitForEvent(page, 'hubReady');

  // Hub is fully up before the consumer exists.
  await injectLate(page, CONSUMER);

  // Longer than the consumer's own visibility settle (500ms debounce) and any
  // reasonable hub-detection grace period.
  await page.waitForTimeout(2600);

  // The Hub's UI is present...
  expect(await shadowDisplay(page, '#fmhub-host', '.btn')).toBe('flex');
  // ...so the consumer's standalone fallback button must not be.
  expect(await shadowDisplay(page, '#table-to-csv-host', '.csv-btn')).toBe('none');
});

// ── Green sanity: the protocol itself behaves ──────────────────────────────
// The RPC envelope (fmhub:request / fmhub:response:N) is gone with the Backend,
// so this asserts the invariants that outlived it: every declaration reaches
// storage, hubReady is broadcast only once the Hub can act on what it triggers,
// and commands reach the rendered UI.
test('declarations all reach storage, and hubReady lands after listeners are live', async ({ page }) => {
  await page.addInitScript({ path: GM_SHIM });
  await injectIdle(page, CONSUMER);
  await injectIdle(page, HUB);

  await page.goto(FIXTURE_URL);
  await waitForPersistedScript(page, 'firemonkey-hub');
  await waitForPersistedScript(page, CONSUMER_SCRIPT_ID);

  const events = await readEvents(page);
  const state = await readPersistedState(page);

  // Every id ever declared over the protocol is in persisted state; nothing
  // is queued anywhere the user can't see.
  const declaredIds = [
    ...new Set(
      events
        .filter((e) => e.type === 'fmhub:declareScript')
        .map((e) => JSON.parse(e.detail).id)
    ),
  ];
  expect(declaredIds.length).toBeGreaterThan(0);
  expect(declaredIds.filter((id) => !state.scripts[id])).toEqual([]);

  // hubReady is broadcast after the Hub is wired: the consumer's re-declaration
  // fires during that dispatch and still lands (asserted above), and the Hub's
  // own self-declare is already persisted by then.
  // Compared by recorded index, not timestamp: Firefox coarsens
  // performance.now(), so same-tick events share a `t`.
  const hubReadyAt = events.findIndex((e) => e.type === 'fmhub:hubReady');
  expect(hubReadyAt).toBeGreaterThanOrEqual(0);
  const reDeclareAt = events.findLastIndex(
    (e) => e.type === 'fmhub:declareScript' && JSON.parse(e.detail).id === CONSUMER_SCRIPT_ID
  );
  expect(reDeclareAt).toBeGreaterThan(hubReadyAt);

  // The consumer's command reached the Hub's registry and its rendered UI.
  expect(await hubCommandNames(page)).toContain(CONSUMER_COMMAND_NAME);

  // Storage is the only authority; there is no separate backend to be alive.
  expect(await page.evaluate(() => window.__GM_STORE__.has('fmhub.state.v1'))).toBe(true);
});
