// ==UserScript==
// @name         FireMonkey Hub Backend
// @version      0.4
// @description  Persistent storage and network backend for FireMonkey Hub
// @author       cam-barts
// @match        *://*/*
// @run-at       document-start
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.openInTab
// @grant        GM.notification
// @grant        GM.registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub%20Backend.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub%20Backend.user.js
// ==/UserScript==

(async function () {
  'use strict';

  const STATE_KEY = 'fmhub.state.v1';

  const DEFAULT_STATE = {
    features: {},
    scripts: {},
    repo: {
      url: 'https://github.com/cam-barts/userscripts',
      branch: 'main',
      lastCheckedAt: null,
      lastEtag: null,
      knownPaths: [],
      ignored: [],
    },
    ui: { position: null, collapsed: true, lastTab: 0 },
    rateLimit: { dailyCap: 8, used: 0, windowStart: null },
  };

  async function loadState() {
    const raw = await GM.getValue(STATE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_STATE));
    try {
      const saved = JSON.parse(raw);
      return {
        features: saved.features || {},
        scripts: saved.scripts || {},
        repo: { ...DEFAULT_STATE.repo, ...(saved.repo || {}) },
        ui: { ...DEFAULT_STATE.ui, ...(saved.ui || {}) },
        rateLimit: { ...DEFAULT_STATE.rateLimit, ...(saved.rateLimit || {}) },
      };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
  }

  async function saveState(state) {
    await GM.setValue(STATE_KEY, JSON.stringify(state));
  }

  // Dispatch events to page context using unsafeWindow bridge
  function emit(type, data) {
    const detail = JSON.stringify(data ?? {});
    try {
      unsafeWindow.document.dispatchEvent(
        new unsafeWindow.CustomEvent('fmhub:' + type, { detail })
      );
    } catch {
      document.dispatchEvent(new CustomEvent('fmhub:' + type, { detail }));
    }
  }

  function respond(id, ok, data, error) {
    emit('response:' + id, { ok, data: data ?? null, error: error ?? null });
  }

  function checkRateLimit(state) {
    const now = Date.now();
    const ws = state.rateLimit.windowStart ? new Date(state.rateLimit.windowStart).getTime() : null;
    if (!ws || now - ws > 86400000) {
      state.rateLimit.used = 0;
      state.rateLimit.windowStart = new Date().toISOString();
      return false;
    }
    return state.rateLimit.used >= state.rateLimit.dailyCap;
  }

  function useRateSlot(state) {
    if (!state.rateLimit.windowStart) {
      state.rateLimit.windowStart = new Date().toISOString();
      state.rateLimit.used = 0;
    }
    state.rateLimit.used++;
  }

  function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: options.method || 'GET',
        url,
        headers: options.headers || {},
        onload(r) {
          const etagMatch = (r.responseHeaders || '').match(/\betag\s*:\s*([^\r\n]+)/i);
          resolve({
            status: r.status,
            responseText: r.responseText,
            responseHeaders: { etag: etagMatch ? etagMatch[1].trim() : null },
          });
        },
        onerror() { reject(new Error('Network error')); },
        ontimeout() { reject(new Error('Timeout')); },
      });
    });
  }

  function getResponseText(r) {
    return (r && typeof r.responseText === 'string') ? r.responseText : '';
  }

  async function checkUpdates(state, forceCheck = false) {
    if (!forceCheck && checkRateLimit(state)) return { rateLimited: true, results: [] };

    const entries = Object.entries(state.scripts);
    if (!entries.length) return { rateLimited: false, results: [] };

    useRateSlot(state);

    const results = [];
    await Promise.all(entries.map(async ([id, script]) => {
      if (!script.updateURL) return;
      try {
        const r = await gmFetch(script.updateURL);
        const text = getResponseText(r);
        if (!text) return;
        const metaEnd = text.search(/==\/UserScript==/i);
        const header = metaEnd > 0 ? text.slice(0, metaEnd + 20) : text.slice(0, 2000);
        const m = header.match(/^\/\/ @version\s+(\S+)/m);
        if (!m) return;
        const remoteVersion = m[1].trim();
        const hasUpdate = remoteVersion.localeCompare(
          script.version, undefined, { numeric: true, sensitivity: 'base' }
        ) > 0;
        if (!hasUpdate) return;
        if (state.scripts[id].dismissedUpdates?.includes(remoteVersion)) return;
        state.scripts[id].latestKnown = { version: remoteVersion, fetchedAt: new Date().toISOString() };
        results.push({ id, name: script.name, localVersion: script.version, remoteVersion, downloadURL: script.downloadURL });
      } catch { /* network errors are non-fatal */ }
    }));

    state.repo.lastCheckedAt = new Date().toISOString();
    await saveState(state);
    return { rateLimited: false, results };
  }

  async function discoverRepo(state) {
    if (checkRateLimit(state)) return { rateLimited: true, newScripts: [] };

    const repoPath = state.repo.url.replace('https://github.com/', '').replace(/\/$/, '');
    const apiUrl = `https://api.github.com/repos/${repoPath}/contents/scripts`;
    const headers = {};
    if (state.repo.lastEtag) headers['If-None-Match'] = state.repo.lastEtag;

    useRateSlot(state);

    try {
      const r = await gmFetch(apiUrl, { headers });
      const text = getResponseText(r);

      if (r?.status === 304) {
        state.repo.lastCheckedAt = new Date().toISOString();
        await saveState(state);
        return { rateLimited: false, newScripts: [] };
      }

      const etag = r?.responseHeaders?.etag || r?.headers?.etag;
      if (etag) state.repo.lastEtag = etag;

      let files;
      try { files = JSON.parse(text).filter(f => f.name.endsWith('.user.js')); }
      catch { return { rateLimited: false, newScripts: [], error: 'Failed to parse repo listing' }; }

      const knownPaths = new Set(state.repo.knownPaths);
      const installedURLs = new Set(Object.values(state.scripts).map(s => s.downloadURL).filter(Boolean));

      const newFiles = files.filter(f =>
        !knownPaths.has(f.path) &&
        !installedURLs.has(f.download_url) &&
        !state.repo.ignored.includes(f.path)
      );

      state.repo.knownPaths = [...new Set([...state.repo.knownPaths, ...files.map(f => f.path)])];
      state.repo.lastCheckedAt = new Date().toISOString();

      const newScripts = await Promise.all(newFiles.map(async (f) => {
        try {
          const r2 = await gmFetch(f.download_url, { headers: { Range: 'bytes=0-2047' } });
          const header = getResponseText(r2);
          const descMatch = header.match(/^\/\/ @description\s+(.+)/m);
          const nameMatch = header.match(/^\/\/ @name\s+(.+)/m);
          return {
            path: f.path,
            name: nameMatch?.[1]?.trim() || f.name.replace('.user.js', ''),
            description: descMatch?.[1]?.trim() || '',
            downloadURL: f.download_url,
          };
        } catch {
          return { path: f.path, name: f.name.replace('.user.js', ''), description: '', downloadURL: f.download_url };
        }
      }));

      await saveState(state);
      return { rateLimited: false, newScripts };
    } catch (err) {
      await saveState(state);
      return { rateLimited: false, newScripts: [], error: err.message };
    }
  }

  const state = await loadState();

  document.addEventListener('fmhub:request', async (e) => {
    let req;
    try { req = JSON.parse(e.detail); } catch { return; }
    const { id, type, payload = {} } = req;

    try {
      switch (type) {
        case 'getState':
          respond(id, true, state);
          break;

        case 'setFeatureEnabled': {
          const { featureId, enabled, scope, origin } = payload;
          if (!state.features[featureId]) {
            state.features[featureId] = { enabled: true, origins: {}, updatedAt: new Date().toISOString() };
          }
          if (scope === 'origin' && origin) {
            state.features[featureId].origins[origin] = enabled;
          } else {
            state.features[featureId].enabled = enabled;
          }
          state.features[featureId].updatedAt = new Date().toISOString();
          await saveState(state);
          respond(id, true, { featureId, enabled, scope, origin });
          emit('stateUpdate', { features: state.features });
          break;
        }

        case 'declareScript': {
          const { scriptId, name, version, updateURL, downloadURL, description, upstreamURL } = payload;
          const existing = state.scripts[scriptId];
          state.scripts[scriptId] = {
            name,
            version,
            updateURL: updateURL || '',
            downloadURL: downloadURL || '',
            description: description || '',
            upstreamURL: upstreamURL || null,
            lastSeen: new Date().toISOString(),
            latestKnown: existing?.latestKnown || null,
            dismissedUpdates: existing?.dismissedUpdates || [],
          };
          await saveState(state);
          respond(id, true, state.scripts[scriptId]);
          emit('stateUpdate', { scripts: state.scripts });
          break;
        }

        case 'checkUpdates': {
          const results = await checkUpdates(state, payload.force === true);
          respond(id, true, results);
          emit('stateUpdate', { scripts: state.scripts, repo: { lastCheckedAt: state.repo.lastCheckedAt } });
          break;
        }

        case 'discoverRepo': {
          const results = await discoverRepo(state);
          respond(id, true, results);
          emit('stateUpdate', { repo: state.repo });
          break;
        }

        case 'openInTab':
          GM.openInTab(payload.url, { active: payload.active !== false });
          respond(id, true, null);
          break;

        case 'setUI':
          Object.assign(state.ui, payload);
          await saveState(state);
          respond(id, true, state.ui);
          break;

        case 'setRepoConfig':
          Object.assign(state.repo, payload);
          await saveState(state);
          respond(id, true, state.repo);
          break;

        case 'ignoreRepoScript':
          if (!state.repo.ignored.includes(payload.path)) {
            state.repo.ignored.push(payload.path);
            await saveState(state);
          }
          respond(id, true, null);
          break;

        case 'dismissUpdate': {
          const s = state.scripts[payload.scriptId];
          if (s) {
            if (!s.dismissedUpdates) s.dismissedUpdates = [];
            if (!s.dismissedUpdates.includes(payload.version)) {
              s.dismissedUpdates.push(payload.version);
              await saveState(state);
            }
          }
          respond(id, true, null);
          break;
        }

        case 'resetState': {
          const fresh = JSON.parse(JSON.stringify(DEFAULT_STATE));
          Object.assign(state, fresh);
          await saveState(state);
          respond(id, true, state);
          emit('stateUpdate', state);
          break;
        }

        case 'ping':
          respond(id, true, 'pong');
          break;

        default:
          respond(id, false, null, `Unknown type: ${type}`);
      }
    } catch (err) {
      respond(id, false, null, err.message);
    }
  });

  GM.registerMenuCommand('FireMonkey Hub: Check for updates', async () => {
    const result = await checkUpdates(state, true);
    if (result.rateLimited) {
      GM.notification({ text: 'Rate limit reached. Try again tomorrow.' });
    } else if (result.results.length > 0) {
      GM.notification({ text: `${result.results.length} update(s) available. Open the Hub to update.` });
    } else {
      GM.notification({ text: 'All scripts are up to date.' });
    }
  });

  // Auto-check on init if stale (> 6 hours)
  const lastChecked = state.repo.lastCheckedAt ? new Date(state.repo.lastCheckedAt).getTime() : 0;
  if (Date.now() - lastChecked > 21600000 && Object.keys(state.scripts).length > 0) {
    setTimeout(() => checkUpdates(state), 3000);
  }

  emit('hello', { version: '0.1' });
})();
