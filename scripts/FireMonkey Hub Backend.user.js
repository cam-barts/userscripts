// ==UserScript==
// @name         FireMonkey Hub Backend
// @version      0.7
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

  // Debug logger — toggle via window.__FMHUB_DEBUG__ in console.
  // Backend runs in isolated context; flag-check has to use unsafeWindow.
  function _dbg(...args) {
    try {
      const flag = (typeof unsafeWindow !== 'undefined') ? unsafeWindow.__FMHUB_DEBUG__ : true;
      if (flag === false) return;
      console.log('[fmhub:backend]', ...args);
    } catch { try { console.log('[fmhub:backend]', ...args); } catch { } }
  }
  _dbg('script starting at document-start, location=', location.href);

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
    let usedUnsafe = false;
    try {
      unsafeWindow.document.dispatchEvent(
        new unsafeWindow.CustomEvent('fmhub:' + type, { detail })
      );
      usedUnsafe = true;
    } catch (err) {
      _dbg('emit unsafeWindow path failed for', type, '— falling back', err && err.message);
      document.dispatchEvent(new CustomEvent('fmhub:' + type, { detail }));
    }
    if (type !== 'response:' + (type.split(':')[1] || '') || !type.startsWith('response:')) {
      _dbg('emit', type, usedUnsafe ? '(via unsafeWindow)' : '(fallback)');
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

  // Manually flag a repo script as installed without requiring it to declare
  // itself first. Fetches the script header to extract @name, @version, and
  // any inline scriptMeta id so the entry matches what the script will later
  // declare on its own. If the fetch fails, falls back to path-derived data.
  async function markInstalledOne(state, path, providedURL) {
    const repoBase = state.repo.url.replace('https://github.com/', '').replace(/\/$/, '');
    const branch = state.repo.branch || 'main';
    const downloadURL = providedURL || `https://raw.githubusercontent.com/${repoBase}/${branch}/${path}`;

    let name = path.split('/').pop().replace(/\.user\.js$/, '');
    let version = '0';
    let scriptId = `manual:${path}`;
    let description = '';

    try {
      const r = await gmFetch(downloadURL, { headers: { Range: 'bytes=0-4095' } });
      const text = getResponseText(r);
      const nameMatch = text.match(/^\/\/ @name\s+(.+)/m);
      const versionMatch = text.match(/^\/\/ @version\s+(\S+)/m);
      const descMatch = text.match(/^\/\/ @description\s+(.+)/m);
      const idMatch = text.match(/id:\s*['"]([^'"]+)['"]/);
      if (nameMatch) name = nameMatch[1].trim();
      if (versionMatch) version = versionMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
      if (idMatch) scriptId = idMatch[1];
    } catch { /* fall back to defaults */ }

    const existing = state.scripts[scriptId];
    state.scripts[scriptId] = {
      name,
      version,
      updateURL: downloadURL,
      downloadURL,
      description,
      upstreamURL: existing?.upstreamURL || null,
      lastSeen: new Date().toISOString(),
      latestKnown: existing?.latestKnown || null,
      dismissedUpdates: existing?.dismissedUpdates || [],
    };
    return state.scripts[scriptId];
  }

  const state = await loadState();
  _dbg('state loaded, scripts=', Object.keys(state.scripts).length, 'features=', Object.keys(state.features).length, 'knownPaths=', state.repo.knownPaths.length);

  // Self-declare so the Backend appears as installed in Updates/Discover.
  // Backend can't dispatch through the Hub registration flow; it owns state
  // directly, so just upsert into state.scripts.
  {
    const selfId = 'firemonkey-hub-backend';
    const selfURL = 'https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/FireMonkey%20Hub%20Backend.user.js';
    const existing = state.scripts[selfId];
    state.scripts[selfId] = {
      name: 'FireMonkey Hub Backend',
      version: '0.5',
      updateURL: selfURL,
      downloadURL: selfURL,
      description: 'Persistent storage and network backend for FireMonkey Hub',
      upstreamURL: null,
      lastSeen: new Date().toISOString(),
      latestKnown: existing?.latestKnown || null,
      dismissedUpdates: existing?.dismissedUpdates || [],
    };
    await saveState(state);
  }

  document.addEventListener('fmhub:request', async (e) => {
    let req;
    try { req = JSON.parse(e.detail); } catch (err) { _dbg('bad request payload', err); return; }
    const { id, type, payload = {} } = req;
    _dbg('request', type, 'id=', id);

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

        case 'markInstalled': {
          const entry = await markInstalledOne(state, payload.path, payload.downloadURL);
          await saveState(state);
          respond(id, true, entry);
          emit('stateUpdate', { scripts: state.scripts });
          break;
        }

        case 'markAllInstalled': {
          const paths = Array.isArray(payload.paths) ? payload.paths : [];
          const entries = [];
          for (const p of paths) {
            try { entries.push(await markInstalledOne(state, p, null)); }
            catch (err) { _dbg('markInstalled failed for', p, err && err.message); }
          }
          await saveState(state);
          respond(id, true, { count: entries.length });
          emit('stateUpdate', { scripts: state.scripts });
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

  emit('hello', { version: '0.7' });
})();
