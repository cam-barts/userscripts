// ADVERSARIAL PROBE - added by review, not part of the remediation.
//
// Gap this closes: the committed suite tests exactly two orders, each with
// exactly ONE consumer:
//   1. consumer-then-Hub  -> asserts persistence only (no fallback-UI assertion)
//   2. Hub-then-consumer  -> asserts fallback suppression only
//
// Nothing covers the order the SB report calls the "minor fifth" failure mode:
// the Hub is document-idle, so on a heavy page it can inject AFTER a consumer's
// 2s fallback timer has already fired and painted standalone UI. Suppression is
// not enough there: the consumer has to TEAR DOWN UI it already built. And
// nothing anywhere puts two consumers on one page at once, so the
// window.FMHubClient singleton guard (copy 2 skips its own definition and reuses
// copy 1's) and the ping -> hubReady broadcast fan-out are both unexercised.
//
// This test forces: two consumers at document-idle, Hub injected at t=2.6s.
import { test, expect } from '@playwright/test';
import {
  FIXTURE_URL,
  GM_SHIM,
  injectIdle,
  injectLate,
  readPersistedState,
} from '../fixtures/inject.js';

const HUB = 'FireMonkey Hub.user.js';
const CONSUMER_A = 'Table to CSV.user.js';          // shadow-root fallback button
const CONSUMER_B = 'AI Writing Detector.user.js';   // light-DOM fallback button

function shadowDisplay(page, hostSelector, innerSelector) {
  return page.evaluate(([host, inner]) => {
    const h = document.querySelector(host);
    if (!h || !h.shadowRoot) return null;
    const el = h.shadowRoot.querySelector(inner);
    if (!el) return null;
    return getComputedStyle(el).display;
  }, [hostSelector, innerSelector]);
}

function hubCommandNames(page) {
  return page.evaluate(() => {
    window.FireMonkeyHub.openHub();
    const h = document.querySelector('#fmhub-host');
    if (!h || !h.shadowRoot) return null;
    return [...h.shadowRoot.querySelectorAll('.cmd-name')].map((el) => el.textContent);
  });
}

test('a Hub arriving after both consumers already painted fallback UI tears it down', async ({ page }) => {
  test.setTimeout(30000);

  await page.addInitScript({ path: GM_SHIM });
  await injectIdle(page, CONSUMER_A);
  await injectIdle(page, CONSUMER_B);   // second copy of the client: singleton guard path

  await page.goto(FIXTURE_URL);

  // ── Control: both fallbacks must actually be up before the Hub arrives.
  // Without this the teardown assertions below could pass vacuously.
  await page.waitForTimeout(2300);
  expect(await shadowDisplay(page, '#table-to-csv-host', '.csv-btn')).toBe('flex');
  expect(await page.locator('#ai-detect-toggle').count()).toBe(1);
  expect(await page.locator('#ai-detect-summary').count()).toBe(1);

  // ── The Hub finally injects (heavy page / slow document-idle).
  await injectLate(page, HUB);
  await page.waitForFunction(() =>
    (window.__FMHUB_EVENTS__ || []).some((e) => e.type === 'fmhub:hubReady'));
  await page.waitForTimeout(500);

  // 1. The Hub's own UI is up (guards against a vacuous pass where nothing rendered).
  expect(await shadowDisplay(page, '#fmhub-host', '.btn')).toBe('flex');

  // 2. Both consumers' late re-declarations reached storage.
  const state = await readPersistedState(page);
  expect(Object.keys(state.scripts).sort()).toEqual(
    ['ai-writing-detector', 'firemonkey-hub', 'table-to-csv']
  );

  // 3. Neither consumer's declared version is the client's '0' fallback
  //    (i.e. GM.info really drove the self-declare, failure mode #4).
  expect(state.scripts['table-to-csv'].version).not.toBe('0');
  expect(state.scripts['ai-writing-detector'].version).not.toBe('0');

  // 4. Every already-painted fallback is gone: no duplicate UI alongside the Hub.
  expect(await shadowDisplay(page, '#table-to-csv-host', '.csv-btn')).toBe('none');
  expect(await page.locator('#ai-detect-toggle').count()).toBe(0);
  expect(await page.locator('#ai-detect-summary').count()).toBe(0);

  // 5. The ping/hubReady fan-out (2 consumers -> N hubReady broadcasts -> N
  //    registerAll each) must not duplicate rows in the Hub UI.
  const names = await hubCommandNames(page);
  expect(names).toContain('Export Table to CSV');
  expect(names).toContain('AI: Toggle Highlighting');
  expect(names.length).toBe(new Set(names).size);
});
