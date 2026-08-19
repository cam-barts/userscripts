// ==UserScript==
// @name         FireMonkey Hub Client
// @version      0.1
// @description  Shared hub-protocol client library, @require'd by consumer scripts
// @author       cam-barts
// @match        *://*/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub%20Client.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub%20Client.user.js
// ==/UserScript==

/**
 * FireMonkey Hub Client: shared event-protocol IIFE extracted out of every
 * consumer script, plus the fmhub:ping handshake that closes the
 * hub-loads-after-consumer race.
 *
 * window.FMHubClient is a singleton (guarded: redeclaring const/let across
 * sibling <script> tags in the shared page realm throws) holding only the
 * stateless connect() factory. Each connect() call gets its own
 * module-scoped registries, so multiple consumers' inlined copies of this
 * file coexisting on one page never share state.
 */
if (typeof window.FMHubClient === 'undefined') {
  window.FMHubClient = (function () {
    'use strict';

    function _log(tag) {
      if (window.__FMHUB_DEBUG__ === false) return;
      try { console.log.apply(console, [tag].concat([].slice.call(arguments, 1))); } catch (e) { /* noop */ }
    }

    function _emit(type, payload) {
      document.dispatchEvent(new CustomEvent('fmhub:' + type, {
        detail: JSON.stringify(payload == null ? {} : payload),
      }));
    }

    function connect(opts) {
      opts = opts || {};
      const TAG = '[fmhub:' + (opts.id || 'client') + ']';
      const info = (typeof GM !== 'undefined' && GM.info && GM.info.script) || {};
      const name = info.name || opts.id;
      const version = info.version || opts.version || '0';

      const _cmds = new Map();
      const _feats = new Map();
      const _featLast = new Map();
      let _hubSeen = false;
      const _hubSeenCbs = [];

      function _addCmd(c) {
        _cmds.set(c.id, {
          name: c.name || c.id, tooltip: c.tooltip || '', color: c.color || '#4CAF50',
          group: c.group || '', enabled: c.enabled !== false, cb: c.callback,
        });
      }
      (opts.commands || []).forEach(_addCmd);
      (opts.features || []).forEach((f) => _feats.set(f.id, {
        label: f.label || f.id, description: f.description || '',
        defaultEnabled: f.defaultEnabled !== false, scope: f.scope || 'global',
      }));

      function registerAll() {
        _emit('declareScript', {
          id: opts.id, name, version,
          updateURL: opts.updateURL || '', downloadURL: opts.downloadURL || '',
          description: opts.description || '', upstreamURL: opts.upstreamURL || null,
        });
        for (const [id, c] of _cmds) _emit('registerCommand', { id, name: c.name, tooltip: c.tooltip, color: c.color, group: c.group, enabled: c.enabled });
        for (const [id, f] of _feats) _emit('registerFeature', { id, ...f });
      }

      document.addEventListener('fmhub:invoke', (e) => {
        try {
          const { id } = JSON.parse(e.detail || '{}');
          const c = _cmds.get(id);
          if (c && typeof c.cb === 'function') { try { c.cb(); } catch (err) { console.error(TAG, 'command error', err); } return; }
          if (typeof opts.onInvoke === 'function') opts.onInvoke(id);
        } catch (err) { _log(TAG, 'invoke parse error', err && err.message); }
      });

      document.addEventListener('fmhub:featureChanged', (e) => {
        try {
          const { id, enabled } = JSON.parse(e.detail || '{}');
          if (!_feats.has(id) || _featLast.get(id) === enabled) return;
          _featLast.set(id, enabled);
          if (typeof opts.onFeatureChanged === 'function') opts.onFeatureChanged(id, enabled);
        } catch (err) { _log(TAG, 'featureChanged parse error', err && err.message); }
      });

      document.addEventListener('fmhub:hubReady', () => {
        _log(TAG, 'hubReady received - re-emitting registrations');
        const firstTime = !_hubSeen;
        _hubSeen = true;
        registerAll();
        if (typeof opts.onHubReady === 'function') opts.onHubReady();
        if (firstTime) _hubSeenCbs.splice(0).forEach((cb) => { try { cb(); } catch (err) { console.error(TAG, err); } });
      });

      registerAll();
      _emit('ping');

      return {
        hubSeen: () => _hubSeen,
        onHubSeen(cb) { if (_hubSeen) cb(); else _hubSeenCbs.push(cb); },
        setCommandEnabled(id, enabled) {
          const c = _cmds.get(id);
          if (c) c.enabled = !!enabled;
          _emit('setCommandEnabled', { id, enabled: !!enabled });
        },
        registerCommand(config) {
          _addCmd(config);
          const c = _cmds.get(config.id);
          _emit('registerCommand', { id: config.id, name: c.name, tooltip: c.tooltip, color: c.color, group: c.group, enabled: c.enabled });
          return {
            unregister() { _cmds.delete(config.id); _emit('unregisterCommand', { id: config.id }); },
            setEnabled(v) { const cc = _cmds.get(config.id); if (cc) cc.enabled = !!v; _emit('setCommandEnabled', { id: config.id, enabled: !!v }); },
          };
        },
      };
    }

    return { connect };
  })();
}

// Self-declare so the Hub's Updates tab covers this script too. Outside the
// singleton guard on purpose: an inlined copy may have claimed
// window.FMHubClient first, but only the STANDALONE run sees its own name in
// GM.info (inlined copies run in the consumer's context), so this fires at
// most once per page.
(function () {
  const info = (typeof GM !== 'undefined' && GM.info && GM.info.script) || {};
  if (info.name !== 'FireMonkey Hub Client') return;
  const URL = 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub%20Client.user.js';
  window.FMHubClient.connect({
    id: 'firemonkey-hub-client',
    description: 'Shared hub-protocol client library',
    updateURL: URL,
    downloadURL: URL,
  });
})();
