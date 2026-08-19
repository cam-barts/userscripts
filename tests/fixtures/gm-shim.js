// GM shim + fmhub event recorder. Installed via page.addInitScript BEFORE any
// userscript body, so it stands in for FireMonkey's greasemonkey APIs and the
// unsafeWindow bridge. No browser extension involved.
(() => {
  // FireMonkey scripts reach the page realm through unsafeWindow. In the
  // harness everything already shares one realm, so alias it.
  window.unsafeWindow = window;

  // Backing store, exposed so tests can read persisted state JSON directly.
  const store = new Map();
  window.__GM_STORE__ = store;
  const listeners = new Map(); // key -> [cb] for addValueChangeListener

  window.__GM_CALLS__ = { openInTab: [], notification: [], menu: [], xhr: [] };

  window.GM = {
    async getValue(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async setValue(key, value) {
      const old = store.get(key);
      store.set(key, value);
      // Remote-write simulation: FireMonkey fires listeners only for OTHER
      // tabs' writes, so same-tab setValue stays silent unless a test flips
      // __GM_SIMULATE_REMOTE__ before writing.
      if (window.__GM_SIMULATE_REMOTE__) {
        for (const l of listeners.get(key) || []) {
          try { l(key, old, value, true); } catch { /* caller's problem */ }
        }
      }
    },
    async deleteValue(key) {
      store.delete(key);
    },
    addValueChangeListener(key, cb) {
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(cb);
      return `${key}#${listeners.get(key).length}`;
    },
    openInTab(url, opts) {
      window.__GM_CALLS__.openInTab.push({ url, opts });
    },
    notification(opts) {
      window.__GM_CALLS__.notification.push(opts);
    },
    registerMenuCommand(name, fn) {
      window.__GM_CALLS__.menu.push({ name, fn });
    },
    // The Hub calls this with { method, url, headers, onload, onerror, ontimeout }
    // and reads r.status / r.responseText / r.responseHeaders (a raw header string).
    xmlHttpRequest(details) {
      window.__GM_CALLS__.xhr.push({ method: details.method, url: details.url });
      setTimeout(() => {
        try {
          details.onload && details.onload({
            status: 200,
            responseText: '[]',
            responseHeaders: 'content-type: application/json\r\n',
          });
        } catch { /* mirror GM: callback errors are the caller's problem */ }
      }, 0);
    },
  };

  // Table to CSV attaches a *closed* shadow root, which is unreachable from
  // test code by design. Force open so assertions can see its fallback button;
  // the scripts themselves cannot observe the difference.
  const _attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return _attach.call(this, { ...init, mode: 'open' });
  };

  // Record every fmhub:* CustomEvent dispatched on document; the Hub and
  // all consumers share this one patched method in the harness realm.
  const events = [];
  window.__FMHUB_EVENTS__ = events;
  const _dispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = function (ev) {
    if (ev && typeof ev.type === 'string' && ev.type.startsWith('fmhub:')) {
      events.push({ t: performance.now(), type: ev.type, detail: ev.detail });
    }
    return _dispatch(ev);
  };
})();
