// ═════════════════════════════════════════════
// List Sync Service
// Auto-downloads changes from Trakt/MDBlists, updates stored
// chrono collections, and optionally queues missing items to Radarr.
// ═════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SAFETY_LIMITS = {
  MAX_PERCENT_REMOVED: 50,   // warn if more than half a list disappears
  MAX_BACKUPS: 5             // keep this many .bak snapshots
};

class ListSyncService {
  constructor(options) {
    this.dataDir = options.dataDir;
    this.logger = options.logger;
    this.embyUrl = options.embyUrl;
    this.embyToken = options.embyToken;
    this.embyUserId = options.embyUserId;

    this.chronoPath = path.join(this.dataDir, 'chrono-collections.json');
    this.credentialsPath = path.join(this.dataDir, 'sync-credentials.json');
    this.configPath = path.join(this.dataDir, 'sync-config.json');
    this.auditPath = path.join(this.dataDir, 'sync-audit.json');
    this.watchedStatePath = path.join(this.dataDir, 'watched-sync-state.json');
    this.publishStatePath = path.join(this.dataDir, 'smart-publish-state.json');
    this.backupDir = path.join(this.dataDir, 'backups');

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    this.timer = null;
    this.isSyncing = false;
  }

  // ═════════════════════════════════════════════
  // FILE HELPERS
  // ═════════════════════════════════════════════

  readJSON(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw || !raw.trim()) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      this.logger.warn(`List sync: could not read ${path.basename(file)}: ${e.message}`);
      return fallback;
    }
  }

  writeJSONAtomic(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // atomic on POSIX
  }

  loadCollections() { return this.readJSON(this.chronoPath, []); }

  loadCredentials() {
    return this.readJSON(this.credentialsPath, { trakt: null, radarrServers: [], mdblistApiKey: null });
  }

  loadConfig() {
    return this.readJSON(this.configPath, {
      enabled: false,
      intervalHours: 24,
      lastSync: null,
      nextSync: null,
      autoRadarr: false,
      radarrServerId: null,
      watchedSyncEnabled: false
    });
  }

  loadAudit() { return this.readJSON(this.auditPath, { syncs: [] }); }

  loadWatchedState() {
    return this.readJSON(this.watchedStatePath, { pushed: {} });
    // pushed: { "imdb:tt0372784": { trakt: "2026-06-22T...", mdblist: "2026-06-22T..." } }
  }

  saveWatchedState(state) {
    this.writeJSONAtomic(this.watchedStatePath, state);
  }

  loadPublishState() {
    return this.readJSON(this.publishStatePath, {});
    // shape: { [scheduleId]: { trakt: { listId, pushedIds: [...] }, mdblist: { listId, pushedIds: [...] } } }
  }

  savePublishState(state) {
    this.writeJSONAtomic(this.publishStatePath, state);
  }

  // ═════════════════════════════════════════════
  // CREDENTIALS (synced from frontend — Trakt token, Radarr servers)
  // ═════════════════════════════════════════════

  saveCredentials(partial) {
    const current = this.loadCredentials();
    const updated = { ...current, ...partial };
    this.writeJSONAtomic(this.credentialsPath, updated);
    this.logger.info('🔑 Sync credentials updated (Trakt/Radarr)');
    return updated;
  }

  // ═════════════════════════════════════════════
  // SETTINGS
  // ═════════════════════════════════════════════

  saveConfig(updates) {
    const current = this.loadConfig();
    const updated = { ...current, ...updates };
    this.writeJSONAtomic(this.configPath, updated);
    this.restart();
    return updated;
  }

  appendAudit(entry) {
    const audit = this.loadAudit();
    audit.syncs.unshift(entry); // newest first
    audit.syncs = audit.syncs.slice(0, 500); // keep last 500 runs — enough for a meaningful timeline
    this.writeJSONAtomic(this.auditPath, audit);
  }

  // ═════════════════════════════════════════════
  // BACKUP (always snapshot before writing changes)
  // ═════════════════════════════════════════════

  backupCollections() {
    try {
      if (!fs.existsSync(this.chronoPath)) return;
      const backupFile = path.join(this.backupDir, `chrono-collections.${Date.now()}.bak`);
      fs.copyFileSync(this.chronoPath, backupFile);

      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('chrono-collections.') && f.endsWith('.bak'))
        .sort();
      while (files.length > SAFETY_LIMITS.MAX_BACKUPS) {
        fs.unlinkSync(path.join(this.backupDir, files.shift()));
      }
    } catch (e) {
      this.logger.warn('List sync: backup failed - ' + e.message);
    }
  }

  // ═════════════════════════════════════════════
  // FETCH FROM SOURCE
  // ═════════════════════════════════════════════

  async fetchTraktList(coll, creds) {
    if (!creds || !creds.trakt || !creds.trakt.accessToken) {
      throw new Error('Trakt not connected (connect it in the app first)');
    }

    const headers = {
      'Authorization': 'Bearer ' + creds.trakt.accessToken,
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': creds.trakt.clientId || '',
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    };

    const isWatchlist = coll.sourceListId === 'watchlist';
    const isOtherUser = coll.sourceUsername
      && coll.sourceUsername !== 'unknown'
      && coll.sourceUsername !== creds.trakt.username;

    const buildUrl = (listId) => {
      if (isWatchlist) return 'https://api.trakt.tv/users/me/watchlist/movies';
      if (coll.sourceListIsLiked) return `https://api.trakt.tv/lists/${listId}/items/movies`;
      if (isOtherUser) return `https://api.trakt.tv/users/${encodeURIComponent(coll.sourceUsername)}/lists/${encodeURIComponent(listId)}/items/movies`;
      return `https://api.trakt.tv/users/me/lists/${listId}/items/movies`;
    };

    const url = buildUrl(coll.sourceListId);

    try {
      const response = await axios.get(url, { headers, timeout: 15000 });
      const items = response.data || [];
      return items.map(i => (i.movie ? i.movie.title : i.title)).filter(Boolean);
    } catch (e) {
      const status = e.response ? e.response.status : '???';

      // Self-heal: "liked" lists are sometimes saved with their slug, but Trakt's
      // generic /lists/{id} endpoint requires the numeric ID for non-personal lists.
      // Look the list up by name in the user's liked lists and retry once.
      if (coll.sourceListIsLiked && status === 400) {
        this.logger.warn(`Trakt 400 on liked list "${coll.name}" — attempting to resolve the numeric list ID...`);
        try {
          const likedRes = await axios.get('https://api.trakt.tv/users/likes/lists', { headers, timeout: 15000 });
          const likedLists = (likedRes.data || []).map(item => item.list || item);
          const match = likedLists.find(l =>
            l.name === (coll.sourceListName || coll.name) ||
            (l.ids && (l.ids.slug === coll.sourceListId || String(l.ids.trakt) === String(coll.sourceListId)))
          );

          if (match && match.ids && match.ids.trakt) {
            const retryRes = await axios.get(buildUrl(match.ids.trakt), { headers, timeout: 15000 });
            const items = retryRes.data || [];

            // Persist the working numeric ID so future syncs — and the app's own
            // manual refresh button — stop hitting this bug
            coll.sourceListId = match.ids.trakt;
            coll._idHealed = true;
            this.logger.info(`   ✓ Resolved "${coll.name}" to numeric list ID ${match.ids.trakt} — saved for future syncs`);

            return items.map(i => (i.movie ? i.movie.title : i.title)).filter(Boolean);
          } else {
            this.logger.warn(`   Could not find "${coll.name}" in your liked lists — it may have been unliked on Trakt`);
          }
        } catch (recoveryError) {
          this.logger.warn(`   Recovery attempt failed: ${recoveryError.message}`);
        }
      }

      const body = e.response ? JSON.stringify(e.response.data).slice(0, 200) : e.message;
      this.logger.warn(`Trakt fetch failed [${status}] for "${coll.name}" → ${url}`);
      this.logger.warn(`  Response: ${body}`);
      throw new Error(`Trakt HTTP ${status}`);
    }
  }

  async fetchMDBlistsList(coll) {
    if (!coll.sourceListApiKey) {
      throw new Error('No MDBlists API key stored for this collection');
    }

    const isWatchlist = coll.sourceListId === '_watchlist' || coll.isWatchlist === true;

    try {
      if (isWatchlist) {
        const [movies, shows] = await Promise.all([
          axios.get(`https://api.mdblist.com/watchlist/items/?mediatype=movie&apikey=${coll.sourceListApiKey}`, { timeout: 15000 }),
          axios.get(`https://api.mdblist.com/watchlist/items/?mediatype=show&apikey=${coll.sourceListApiKey}`, { timeout: 15000 }).catch(() => ({ data: {} }))
        ]);

        const titles = [];
        (movies.data.movies || []).forEach(m => m.title && titles.push(m.title));
        (movies.data.shows || []).forEach(s => s.title && titles.push(s.title));
        (shows.data.movies || []).forEach(m => m.title && titles.push(m.title));
        (shows.data.shows || []).forEach(s => s.title && titles.push(s.title));
        return titles;
      }

      const url = `https://api.mdblist.com/lists/${coll.sourceListId}/items?apikey=${coll.sourceListApiKey}`;
      const response = await axios.get(url, { timeout: 15000 });
      const data = response.data || {};

      const titles = [];
      (data.movies || []).forEach(m => m.title && titles.push(m.title));
      (data.shows || []).forEach(s => s.title && titles.push(s.title));
      (data.episodes || []).forEach(e => e.title && titles.push(e.title));
      return titles;

    } catch (e) {
      const status = e.response ? e.response.status : '???';
      this.logger.warn(`MDBlists fetch failed [${status}] for "${coll.name}" (listId: ${coll.sourceListId})`);
      throw new Error(`MDBlists HTTP ${status}`);
    }
  }

  async fetchLatestTitles(coll, creds) {
    if (coll.source === 'Trakt') return this.fetchTraktList(coll, creds);
    if (coll.source === 'MDBlists') return this.fetchMDBlistsList(coll);
    return null; // e.g. 'import' — no remote source to sync against
  }

  // ═════════════════════════════════════════════
  // EMBY LIBRARY SNAPSHOT (one call, reused for every collection)
  // ═════════════════════════════════════════════

  async fetchLibraryItems() {
    const url = `${this.embyUrl}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=Id,Name&Limit=10000&UserId=${this.embyUserId}&api_key=${this.embyToken}`;
    const response = await axios.get(url, { timeout: 20000 });
    return (response.data && response.data.Items) || [];
  }

  async fetchCollectionItems(embyId) {
    const url = `${this.embyUrl}/Items?ParentId=${embyId}&IncludeItemTypes=Movie&Recursive=true&Fields=Id,Name,ProviderIds,UserData&Limit=2000&UserId=${this.embyUserId}&api_key=${this.embyToken}`;
    const response = await axios.get(url, { timeout: 15000 });
    return (response.data && response.data.Items) || [];
  }

  // Same exact-then-year-stripped matching used by /api/refresh-all-collections
  matchTitleToLibrary(title, libraryItems) {
    const exact = libraryItems.find(m => m.Name === title);
    if (exact) return exact;

    const tClean = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    return libraryItems.find(m => {
      const movClean = (m.Name || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
      return movClean === tClean;
    }) || null;
  }

  async addItemsToEmbyCollection(embyId, movieIds) {
    const url = `${this.embyUrl}/Collections/${embyId}/Items?Ids=${movieIds.join(',')}&api_key=${this.embyToken}`;
    await axios.post(url, {});
  }

  async removeItemsFromEmbyCollection(embyId, movieIds) {
    const url = `${this.embyUrl}/Collections/${embyId}/Items?Ids=${movieIds.join(',')}&api_key=${this.embyToken}`;
    await axios.delete(url);
  }

  // ═════════════════════════════════════════════
  // SAFETY VALIDATION
  // ═════════════════════════════════════════════

  validateChanges(oldCount, newCount) {
    const warnings = [];

    if (oldCount > 0 && newCount === 0) {
      warnings.push('New list came back empty — skipping update to avoid wiping the collection');
      return { safe: false, warnings };
    }

    if (oldCount > 0) {
      const removedPct = ((oldCount - newCount) / oldCount) * 100;
      if (removedPct > SAFETY_LIMITS.MAX_PERCENT_REMOVED) {
        warnings.push(`${removedPct.toFixed(0)}% of items would be removed — check the source list`);
      }
    }

    return { safe: true, warnings };
  }

  // ═════════════════════════════════════════════
  // RADARR (mirrors the frontend's sendToRadarrSilent)
  // ═════════════════════════════════════════════

  async sendToRadarr(title, radarrServer) {
    try {
      const base = radarrServer.url.replace(/\/$/, '');
      const headers = { 'X-Api-Key': radarrServer.apiKey };

      const lookupRes = await axios.get(`${base}/api/v3/movie/lookup`, {
        headers, params: { term: title }, timeout: 10000
      });
      const results = lookupRes.data || [];
      if (!results.length) return { status: 'not_found', title };

      const [rfRes, qpRes] = await Promise.all([
        axios.get(`${base}/api/v3/rootfolder`, { headers, timeout: 10000 }).catch(() => ({ data: [] })),
        axios.get(`${base}/api/v3/qualityprofile`, { headers, timeout: 10000 }).catch(() => ({ data: [] }))
      ]);

      const rootPath = (rfRes.data[0] && rfRes.data[0].path) || '/movies';
      const qualityId = (qpRes.data[0] && qpRes.data[0].id) || 1;
      const movie = results[0];

      const payload = {
        title: movie.title,
        qualityProfileId: qualityId,
        titleSlug: movie.titleSlug,
        images: movie.images || [],
        tmdbId: movie.tmdbId,
        year: movie.year,
        rootFolderPath: rootPath,
        monitored: true,
        addOptions: { searchForMovie: true }
      };

      const addRes = await axios.post(`${base}/api/v3/movie`, payload, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true
      });

      if (addRes.status === 201 || addRes.status === 200) return { status: 'sent', title };
      if (addRes.status === 400) return { status: 'already_exists', title };
      return { status: 'failed', title, error: `HTTP ${addRes.status}` };

    } catch (e) {
      return { status: 'failed', title, error: e.message };
    }
  }

  // ═════════════════════════════════════════════
  // WATCHED SYNC (Emby → Trakt / MDBlists)
  // Pushes movies marked Played in Emby back to the source service.
  // ═════════════════════════════════════════════

  // Batched single call — Trakt accepts an array, no need for one request per movie
  async pushWatchedToTrakt(movies, creds) {
    if (!movies.length) return { succeeded: [], notFound: [], error: null };
    if (!creds || !creds.trakt || !creds.trakt.accessToken) {
      return { succeeded: [], notFound: [], error: 'Trakt not connected' };
    }

    const headers = {
      'Authorization': 'Bearer ' + creds.trakt.accessToken,
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': creds.trakt.clientId || ''
    };

    try {
      const response = await axios.post('https://api.trakt.tv/sync/history', {
        movies: movies.map(m => ({
          ids: m.imdb ? { imdb: m.imdb } : { tmdb: parseInt(m.tmdb, 10) },
          watched_at: m.watchedAt
        }))
      }, { headers, timeout: 15000 });

      const notFoundKeys = new Set((response.data.not_found.movies || []).map(m =>
        (m.ids && (m.ids.imdb || m.ids.tmdb)) || ''
      ));

      const succeeded = movies.filter(m => !notFoundKeys.has(m.imdb || String(m.tmdb)));
      const notFound = movies.filter(m => notFoundKeys.has(m.imdb || String(m.tmdb)));

      return { succeeded, notFound, error: null, raw: response.data };
    } catch (e) {
      const status = e.response ? e.response.status : '???';
      this.logger.warn(`Trakt watched-sync failed [${status}]: ${e.message}`);
      return { succeeded: [], notFound: [], error: `Trakt HTTP ${status}` };
    }
  }

  // Batched per API key — each MDBlists-sourced collection may use a different key
  async pushWatchedToMDBList(movies, apiKey) {
    if (!movies.length) return { succeeded: [], notFound: [], error: null };
    if (!apiKey) return { succeeded: [], notFound: [], error: 'No MDBlists API key' };

    try {
      const response = await axios.post(
        `https://api.mdblist.com/sync/watched?apikey=${apiKey}`,
        {
          movies: movies.map(m => ({
            ids: m.imdb ? { imdb: m.imdb, tmdb: m.tmdb ? parseInt(m.tmdb, 10) : undefined }
                        : { tmdb: parseInt(m.tmdb, 10) },
            watched_at: m.watchedAt
          }))
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
      );

      const notFoundKeys = new Set((response.data.not_found.movies || []).map(m =>
        (m.ids && (m.ids.imdb || m.ids.tmdb)) || ''
      ));

      const succeeded = movies.filter(m => !notFoundKeys.has(m.imdb || String(m.tmdb)));
      const notFound = movies.filter(m => notFoundKeys.has(m.imdb || String(m.tmdb)));

      return { succeeded, notFound, error: null, raw: response.data };
    } catch (e) {
      const status = e.response ? e.response.status : '???';
      this.logger.warn(`MDBlists watched-sync failed [${status}]: ${e.message}`);
      return { succeeded: [], notFound: [], error: `MDBlists HTTP ${status}` };
    }
  }

  // Collect newly-Played movies from every tracked Trakt/MDBlists collection,
  // skip anything already pushed (per-service), then batch-push.
  async syncWatchedStatus(options = {}) {
    const dryRun = !!options.dryRun;
    const collections = this.loadCollections();
    const creds = this.loadCredentials();
    const watchedState = this.loadWatchedState();

    const result = {
      success: true,
      dryRun,
      traktPushed: [],
      traktNotFound: [],
      mdblistPushed: [],
      mdblistNotFound: [],
      skippedNoId: [],
      errors: []
    };

    // ---- Trakt: one combined batch across all Trakt-sourced collections ----
    const traktCollections = collections.filter(c => c.source === 'Trakt');
    const traktCandidates = [];

    for (const coll of traktCollections) {
      let items = [];
      try {
        items = await this.fetchCollectionItems(coll.embyId);
      } catch (e) {
        result.errors.push({ collection: coll.name, error: e.message });
        continue;
      }

      const watched = items.filter(i => i.UserData && i.UserData.Played);
      for (const item of watched) {
        const imdb = item.ProviderIds && (item.ProviderIds.Imdb || item.ProviderIds.IMDB);
        const tmdb = item.ProviderIds && (item.ProviderIds.Tmdb || item.ProviderIds.TMDB);
        if (!imdb && !tmdb) { result.skippedNoId.push(item.Name); continue; }

        const key = 'trakt:' + (imdb || tmdb);
        if (watchedState.pushed[key]) continue; // already pushed in a previous run

        traktCandidates.push({
          name: item.Name,
          imdb: imdb || null,
          tmdb: tmdb || null,
          watchedAt: item.UserData.LastPlayedDate || new Date().toISOString(),
          _key: key
        });
      }
    }

    if (traktCandidates.length) {
      if (dryRun) {
        result.traktPushed = traktCandidates.map(m => ({ name: m.name, imdb: m.imdb, tmdb: m.tmdb }));
      } else {
        const pushResult = await this.pushWatchedToTrakt(traktCandidates, creds);
        if (pushResult.error) {
          result.errors.push({ service: 'trakt', error: pushResult.error });
        } else {
          pushResult.succeeded.forEach(m => { watchedState.pushed[m._key] = { ...(watchedState.pushed[m._key]||{}), trakt: new Date().toISOString() }; });
          result.traktPushed = pushResult.succeeded.map(m => ({ name: m.name, imdb: m.imdb, tmdb: m.tmdb }));
          result.traktNotFound = pushResult.notFound.map(m => m.name);
        }
      }
    }

    // ---- MDBlists: grouped per API key, since different collections may use different keys ----
    const mdblistCollections = collections.filter(c => c.source === 'MDBlists' && c.sourceListApiKey);
    const byApiKey = new Map();
    for (const coll of mdblistCollections) {
      if (!byApiKey.has(coll.sourceListApiKey)) byApiKey.set(coll.sourceListApiKey, []);
      byApiKey.get(coll.sourceListApiKey).push(coll);
    }

    for (const [apiKey, colls] of byApiKey.entries()) {
      const mdbCandidates = [];

      for (const coll of colls) {
        let items = [];
        try {
          items = await this.fetchCollectionItems(coll.embyId);
        } catch (e) {
          result.errors.push({ collection: coll.name, error: e.message });
          continue;
        }

        const watched = items.filter(i => i.UserData && i.UserData.Played);
        for (const item of watched) {
          const imdb = item.ProviderIds && (item.ProviderIds.Imdb || item.ProviderIds.IMDB);
          const tmdb = item.ProviderIds && (item.ProviderIds.Tmdb || item.ProviderIds.TMDB);
          if (!imdb && !tmdb) continue; // already counted in skippedNoId via Trakt pass if shared; avoid double-count otherwise

          const key = 'mdblist:' + (imdb || tmdb) + ':' + apiKey.slice(-6);
          if (watchedState.pushed[key]) continue;

          mdbCandidates.push({
            name: item.Name,
            imdb: imdb || null,
            tmdb: tmdb || null,
            watchedAt: item.UserData.LastPlayedDate || new Date().toISOString(),
            _key: key
          });
        }
      }

      if (!mdbCandidates.length) continue;

      if (dryRun) {
        result.mdblistPushed.push(...mdbCandidates.map(m => ({ name: m.name, imdb: m.imdb, tmdb: m.tmdb })));
      } else {
        const pushResult = await this.pushWatchedToMDBList(mdbCandidates, apiKey);
        if (pushResult.error) {
          result.errors.push({ service: 'mdblist', error: pushResult.error });
        } else {
          pushResult.succeeded.forEach(m => { watchedState.pushed[m._key] = { ...(watchedState.pushed[m._key]||{}), mdblist: new Date().toISOString() }; });
          result.mdblistPushed.push(...pushResult.succeeded.map(m => ({ name: m.name, imdb: m.imdb, tmdb: m.tmdb })));
          result.mdblistNotFound.push(...pushResult.notFound.map(m => m.name));
        }
      }
    }

    if (!dryRun) this.saveWatchedState(watchedState);

    if (result.traktPushed.length || result.mdblistPushed.length) {
      this.logger.info(`✅ [WATCHED SYNC] Trakt: ${result.traktPushed.length} pushed, MDBlists: ${result.mdblistPushed.length} pushed${dryRun ? ' (dry run)' : ''}`);
    } else {
      this.logger.info(`✅ [WATCHED SYNC] Nothing new to push`);
    }

    return result;
  }

  // Webhook-driven single-item push — fires on Emby's item.markplayed event.
  // Reuses the same state file as syncWatchedStatus() so neither path double-pushes
  // work the other already did. Title match is in-memory only, no Emby API calls.
  async pushWatchedSingleItem({ name, imdb, tmdb, watchedAt }) {
    const collections = this.loadCollections();
    const creds = this.loadCredentials();
    const watchedState = this.loadWatchedState();
    const idKey = imdb || tmdb;
    const movie = { name, imdb, tmdb, watchedAt: watchedAt || new Date().toISOString() };

    const result = { traktPushed: false, mdblistPushed: [] };

    const inTraktList = collections.some(c =>
      c.source === 'Trakt' && (c.importedTitles || c.originalTitles || []).includes(name)
    );

    if (inTraktList) {
      const key = 'trakt:' + idKey;
      if (!watchedState.pushed[key]) {
        const r = await this.pushWatchedToTrakt([movie], creds);
        if (r.error) {
          this.logger.warn(`   Webhook watched-push to Trakt failed: ${r.error}`);
        } else if (r.succeeded.length) {
          watchedState.pushed[key] = { ...(watchedState.pushed[key] || {}), trakt: movie.watchedAt };
          result.traktPushed = true;
        }
      }
    }

    const mdblistKeys = new Set(
      collections
        .filter(c => c.source === 'MDBlists' && c.sourceListApiKey && (c.importedTitles || c.originalTitles || []).includes(name))
        .map(c => c.sourceListApiKey)
    );

    for (const apiKey of mdblistKeys) {
      const key = 'mdblist:' + idKey + ':' + apiKey.slice(-6); // distinct per key, in case of multiple MDBlists accounts
      if (watchedState.pushed[key]) continue;

      const r = await this.pushWatchedToMDBList([movie], apiKey);
      if (r.error) {
        this.logger.warn(`   Webhook watched-push to MDBlists failed: ${r.error}`);
      } else if (r.succeeded.length) {
        watchedState.pushed[key] = { ...(watchedState.pushed[key] || {}), mdblist: movie.watchedAt };
        result.mdblistPushed.push(apiKey);
      }
    }

    this.saveWatchedState(watchedState);
    return result;
  }

  // ═════════════════════════════════════════════
  // SMART LIST PUBLISHING (Emby Smart Collection → Trakt / MDBlists)
  // Publishes a locally-built Smart Collection out as a real list on each
  // service, then keeps it in sync as the rule's matched items change.
  // ═════════════════════════════════════════════

  // Cheap existence checks — used to detect a list that was deleted externally,
  // since trusting a stored listId/pushedKeys forever would otherwise mean a
  // deleted list is never recreated (an empty diff never even attempts an API call).
  async traktListExists(listId, creds) {
    try {
      const headers = {
        'Authorization': 'Bearer ' + creds.trakt.accessToken,
        'trakt-api-version': '2',
        'trakt-api-key': creds.trakt.clientId || ''
      };
      await axios.get(`https://api.trakt.tv/users/me/lists/${listId}`, { headers, timeout: 10000 });
      return true;
    } catch (e) {
      if (e.response && e.response.status === 404) return false;
      throw e; // network/auth errors shouldn't be treated as "list doesn't exist"
    }
  }

  async mdblistExists(listId, apiKey) {
    try {
      await axios.get(`https://api.mdblist.com/lists/${listId}/items?apikey=${apiKey}`, { timeout: 10000 });
      return true;
    } catch (e) {
      if (e.response && e.response.status === 404) return false;
      throw e;
    }
  }

  async createTraktList(name, description, creds) {
    const headers = {
      'Authorization': 'Bearer ' + creds.trakt.accessToken,
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': creds.trakt.clientId || ''
    };
    const response = await axios.post('https://api.trakt.tv/users/me/lists', {
      name, description: description || '', privacy: 'private'
    }, { headers, timeout: 15000 });

    return response.data; // includes ids.trakt, ids.slug
  }

  async addItemsToTraktList(listId, movies, creds) {
    const headers = {
      'Authorization': 'Bearer ' + creds.trakt.accessToken,
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': creds.trakt.clientId || ''
    };
    const response = await axios.post(`https://api.trakt.tv/users/me/lists/${listId}/items`, {
      movies: movies.map(m => ({ ids: m.imdb ? { imdb: m.imdb } : { tmdb: parseInt(m.tmdb, 10) } }))
    }, { headers, timeout: 15000 });

    return response.data; // {added:{movies}, existing:{movies}, not_found:{movies:[]}}
  }

  async removeItemsFromTraktList(listId, movies, creds) {
    const headers = {
      'Authorization': 'Bearer ' + creds.trakt.accessToken,
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': creds.trakt.clientId || ''
    };
    const response = await axios.post(`https://api.trakt.tv/users/me/lists/${listId}/items/remove`, {
      movies: movies.map(m => ({ ids: m.imdb ? { imdb: m.imdb } : { tmdb: parseInt(m.tmdb, 10) } }))
    }, { headers, timeout: 15000 });

    return response.data;
  }

  async createMDBList(name, apiKey) {
    const response = await axios.post(
      `https://api.mdblist.com/lists/user/add?apikey=${apiKey}`,
      { name, private: true },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return response.data; // {id, slug, url}
  }

  async addItemsToMDBList(listId, movies, apiKey) {
    // Flat shape confirmed working: {tmdb, imdb} directly on each item, no ids{} wrapper
    const response = await axios.post(
      `https://api.mdblist.com/lists/${listId}/items/add?apikey=${apiKey}`,
      { movies: movies.map(m => ({ tmdb: m.tmdb ? parseInt(m.tmdb, 10) : undefined, imdb: m.imdb || undefined })) },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return response.data; // {added:{movies}, existing:{movies}, not_found:{movies}}
  }

  async removeItemsFromMDBList(listId, movies, apiKey) {
    // Mirrors addItemsToMDBList's confirmed-working flat shape — unconfirmed for remove
    // specifically, so callers should treat a surprising not_found count as suspect
    // rather than assume the removal genuinely failed.
    const response = await axios.post(
      `https://api.mdblist.com/lists/${listId}/items/remove?apikey=${apiKey}`,
      { movies: movies.map(m => ({ tmdb: m.tmdb ? parseInt(m.tmdb, 10) : undefined, imdb: m.imdb || undefined })) },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return response.data;
  }

  // Orchestrator — called every time a Smart Collection's schedule runs (manual or cron).
  // items: the CURRENT full set of rule-matched movies, as {name, imdb, tmdb}.
  async publishSmartList(schedule, items, options = {}) {
    const dryRun = !!options.dryRun;
    const creds = this.loadCredentials();
    const publishState = this.loadPublishState();
    const scheduleId = schedule.id;

    if (!publishState[scheduleId]) {
      publishState[scheduleId] = { trakt: { listId: schedule.traktListId || null, listUrl: schedule.traktListUrl || null, pushedKeys: [] }, mdblist: { listId: schedule.mdblistListId || null, listUrl: schedule.mdblistListUrl || null, pushedKeys: [] } };
    }
    const state = publishState[scheduleId];
    if (schedule.traktListId && !state.trakt.listId) state.trakt.listId = schedule.traktListId;
    if (schedule.mdblistListId && !state.mdblist.listId) state.mdblist.listId = schedule.mdblistListId;

    const currentKeys = new Set(items.map(i => i.imdb || String(i.tmdb)));
    const itemsByKey = new Map(items.map(i => [i.imdb || String(i.tmdb), i]));

    const result = { traktListId: null, traktListUrl: null, traktAdded: 0, traktRemoved: 0, mdblistListId: null, mdblistListUrl: null, mdblistAdded: 0, mdblistRemoved: 0, errors: [] };

    // ---- Trakt ----
    if (schedule.publishToTrakt) {
      try {
        // Verify a previously-created list still actually exists. Without this,
        // a deleted list sits forever with an empty diff (everything already in
        // pushedKeys), so we'd never even attempt an API call that could reveal
        // it's gone — silently doing nothing instead of recreating it.
        let traktListId = state.trakt.listId;
        let traktListUrl = state.trakt.listUrl;
        let traktPushedKeys = state.trakt.pushedKeys;

        if (traktListId) {
          const exists = await this.traktListExists(traktListId, creds);
          if (!exists) {
            this.logger.warn(`   Trakt list ${traktListId} no longer exists (deleted externally?) — will recreate`);
            traktListId = null;
            traktListUrl = null;
            traktPushedKeys = [];
          }
        }

        if (!traktListId) {
          if (dryRun) {
            result.traktListId = 'would-create';
          } else {
            const created = await this.createTraktList(schedule.playlistName, schedule.description, creds);
            traktListId = created.ids.trakt;
            traktListUrl = `https://trakt.tv/users/${creds.trakt.username}/lists/${created.ids.slug}`;
            traktPushedKeys = [];
            result.traktListId = traktListId;
            result.traktListUrl = traktListUrl;
            this.logger.info(`   ✓ Created Trakt list "${schedule.playlistName}" (id ${traktListId}) — ${traktListUrl}`);
          }
        } else if (!traktListUrl && !dryRun) {
          // Self-heal: a list created before this fix has an id but no correct URL stored.
          try {
            const headers = {
              'Authorization': 'Bearer ' + creds.trakt.accessToken,
              'trakt-api-version': '2',
              'trakt-api-key': creds.trakt.clientId || ''
            };
            const listInfo = await axios.get(`https://api.trakt.tv/users/me/lists/${traktListId}`, { headers, timeout: 10000 });
            traktListUrl = `https://trakt.tv/users/${creds.trakt.username}/lists/${listInfo.data.ids.slug}`;
            result.traktListUrl = traktListUrl;
            this.logger.info(`   ✓ Recovered Trakt list URL — ${traktListUrl}`);
          } catch (e) {
            this.logger.warn(`   Could not recover Trakt list URL: ${e.message}`);
          }
        } else {
          result.traktListUrl = traktListUrl;
        }

        // Compute the diff even in dry-run-before-creation, when there's no real
        // listId yet — prevKeys is simply empty for a brand new (or recreated) list,
        // so this still gives an accurate "everything would be added" count.
        if (traktListId || dryRun) {
          const prevKeys = new Set(traktPushedKeys);
          const toAdd = items.filter(i => !prevKeys.has(i.imdb || String(i.tmdb)));
          const toRemoveKeys = traktPushedKeys.filter(k => !currentKeys.has(k));

          if (toAdd.length && !dryRun) {
            const addResp = await this.addItemsToTraktList(traktListId, toAdd, creds);
            const notFoundKeys = new Set((addResp.not_found && addResp.not_found.movies || []).map(m =>
              (m.ids && (m.ids.imdb || m.ids.tmdb)) || ''
            ));
            const actuallyAdded = toAdd.filter(i => !notFoundKeys.has(i.imdb || String(i.tmdb)));
            actuallyAdded.forEach(i => traktPushedKeys.push(i.imdb || String(i.tmdb)));
            if (actuallyAdded.length < toAdd.length) {
              this.logger.warn(`   Trakt rejected ${toAdd.length - actuallyAdded.length} item(s) as not_found — will retry next run, not marked as pushed`);
            }
            result.traktAdded = actuallyAdded.length;
          } else {
            result.traktAdded = toAdd.length;
          }

          if (toRemoveKeys.length && !dryRun) {
            const toRemoveItems = toRemoveKeys.map(k => ({ imdb: k.startsWith('tt') ? k : null, tmdb: k.startsWith('tt') ? null : k }));
            await this.removeItemsFromTraktList(traktListId, toRemoveItems, creds);
            // Unlike add, a not_found response here actually confirms the desired end state
            // (the item isn't on the list) just as much as a "removed" response would — so as
            // long as the call itself didn't throw, clearing pushedKeys is correct either way.
            traktPushedKeys = traktPushedKeys.filter(k => !toRemoveKeys.includes(k));
          }
          result.traktRemoved = toRemoveKeys.length;
        }

        // Commit the local working values back onto persisted state — only for real runs
        if (!dryRun) {
          state.trakt.listId = traktListId;
          state.trakt.listUrl = traktListUrl;
          state.trakt.pushedKeys = traktPushedKeys;
        }
      } catch (e) {
        const status = e.response ? e.response.status : '???';
        this.logger.warn(`   Trakt publish failed for "${schedule.playlistName}" [${status}]: ${e.message}`);
        result.errors.push({ service: 'trakt', error: e.message });
      }
    }

    // ---- MDBlists ----
    const mdblistApiKey = schedule.mdblistApiKey || creds.mdblistApiKey;

    if (schedule.publishToMDBlists && mdblistApiKey) {
      try {
        let mdblistListId = state.mdblist.listId;
        let mdblistListUrl = state.mdblist.listUrl;
        let mdblistPushedKeys = state.mdblist.pushedKeys;

        if (mdblistListId) {
          const exists = await this.mdblistExists(mdblistListId, mdblistApiKey);
          if (!exists) {
            this.logger.warn(`   MDBlists list ${mdblistListId} no longer exists (deleted externally?) — will recreate`);
            mdblistListId = null;
            mdblistListUrl = null;
            mdblistPushedKeys = [];
          }
        }

        if (!mdblistListId) {
          if (dryRun) {
            result.mdblistListId = 'would-create';
          } else {
            const created = await this.createMDBList(schedule.playlistName, mdblistApiKey);
            mdblistListId = created.id;
            mdblistListUrl = created.url;
            mdblistPushedKeys = [];
            result.mdblistListId = created.id;
            result.mdblistListUrl = created.url;
            this.logger.info(`   ✓ Created MDBlists list "${schedule.playlistName}" (id ${created.id}, ${created.url})`);
          }
        } else {
          result.mdblistListUrl = mdblistListUrl;
        }

        if (mdblistListId || dryRun) {
          const prevKeys = new Set(mdblistPushedKeys);
          const toAdd = items.filter(i => !prevKeys.has(i.imdb || String(i.tmdb)));
          const toRemoveKeys = mdblistPushedKeys.filter(k => !currentKeys.has(k));

          if (toAdd.length && !dryRun) {
            const addResp = await this.addItemsToMDBList(mdblistListId, toAdd, mdblistApiKey);
            const failedCount = (addResp.not_found && addResp.not_found.movies) || 0;
            if (failedCount > 0) {
              // MDBlists only reports a count, not which items — can't isolate the failure,
              // so mark none as pushed and retry the whole batch next run (safe: re-adding
              // already-successful items is a no-op per MDBlists' own "existing" field)
              this.logger.warn(`   MDBlists reported ${failedCount} not_found of ${toAdd.length} — none marked as pushed, will retry full batch next run`);
              result.mdblistAdded = 0;
            } else {
              toAdd.forEach(i => mdblistPushedKeys.push(i.imdb || String(i.tmdb)));
              result.mdblistAdded = toAdd.length;
            }
          } else {
            result.mdblistAdded = toAdd.length;
          }

          if (toRemoveKeys.length && !dryRun) {
            const toRemoveItems = toRemoveKeys.map(k => ({ imdb: k.startsWith('tt') ? k : null, tmdb: k.startsWith('tt') ? null : k }));
            const removeResp = await this.removeItemsFromMDBList(mdblistListId, toRemoveItems, mdblistApiKey);
            if (removeResp.not_found && removeResp.not_found.movies > 0) {
              this.logger.warn(`   MDBlists remove reported ${removeResp.not_found.movies} not_found — list state may be out of sync, treat with caution`);
            }
            mdblistPushedKeys = mdblistPushedKeys.filter(k => !toRemoveKeys.includes(k));
          }
          result.mdblistRemoved = toRemoveKeys.length;
        }

        // Commit the local working values back onto persisted state — only for real runs
        if (!dryRun) {
          state.mdblist.listId = mdblistListId;
          state.mdblist.listUrl = mdblistListUrl;
          state.mdblist.pushedKeys = mdblistPushedKeys;
        }
      } catch (e) {
        const status = e.response ? e.response.status : '???';
        this.logger.warn(`   MDBlists publish failed for "${schedule.playlistName}" [${status}]: ${e.message}`);
        result.errors.push({ service: 'mdblist', error: e.message });
      }
    }

    if (!dryRun) this.savePublishState(publishState);
    return result;
  }

  // ═════════════════════════════════════════════
  // PER-COLLECTION SYNC
  // ═════════════════════════════════════════════

  async syncCollection(coll, creds, libraryItems, options) {
    const result = {
      id: coll.embyId,
      name: coll.name,
      source: coll.source,
      changed: false,
      idHealed: false,
      skipped: false,
      error: null,
      warnings: [],
      added: [],
      removed: [],
      missingFromLibrary: [],
      addedToEmby: [],
      removedFromEmby: [],
      radarrQueued: [],
      radarrWouldSend: false
    };

    try {
      const newTitles = await this.fetchLatestTitles(coll, creds);

      if (coll._idHealed) {
        result.idHealed = true;
        delete coll._idHealed;
      }

      if (newTitles === null) {
        result.skipped = true;
        return result;
      }

      const uniqueNew = Array.from(new Set(newTitles.filter(Boolean)));
      const oldTitles = coll.importedTitles || coll.originalTitles || [];

      const validation = this.validateChanges(oldTitles.length, uniqueNew.length);
      result.warnings = validation.warnings;
      if (!validation.safe) {
        result.error = validation.warnings.join('; ');
        return result;
      }

      const oldSet = new Set(oldTitles);
      const newSet = new Set(uniqueNew);

      result.added = uniqueNew.filter(t => !oldSet.has(t));
      result.removed = oldTitles.filter(t => !newSet.has(t));
      result.changed = result.added.length > 0 || result.removed.length > 0;

      // Find any title in the latest list that's matchable in the library but
      // not yet in the actual Emby collection — then add it, same as the
      // import flow and /api/refresh-all-collections do.
      if (!options.dryRun) {
        let currentItems = [];
        try {
          currentItems = await this.fetchCollectionItems(coll.embyId);
        } catch (e) {
          this.logger.warn(`   Could not read current Emby items for "${coll.name}": ${e.message}`);
        }
        const currentIds = new Set(currentItems.map(m => m.Id));
        const currentNames = new Set(currentItems.map(m => m.Name));

        const toAdd = [];
        const stillMissing = [];

        for (const title of uniqueNew) {
          if (currentNames.has(title)) continue; // already in the Emby collection

          const match = this.matchTitleToLibrary(title, libraryItems);
          if (match && !currentIds.has(match.Id)) {
            toAdd.push(match);
          } else if (!match) {
            stillMissing.push(title);
          }
        }

        if (toAdd.length > 0) {
          try {
            await this.addItemsToEmbyCollection(coll.embyId, toAdd.map(m => m.Id));
            result.addedToEmby = toAdd.map(m => m.Name);
            result.changed = true;
          } catch (e) {
            this.logger.warn(`   Failed to add items to Emby collection "${coll.name}": ${e.message}`);
          }
        }

        // Anything that fell off the source list AND is still physically in the
        // Emby collection gets removed too — same safety net as above already
        // validated this via validateChanges()'s >50%-removed guard.
        const toRemove = result.removed
          .filter(title => currentNames.has(title))
          .map(title => currentItems.find(m => m.Name === title))
          .filter(Boolean);

        if (toRemove.length > 0) {
          try {
            await this.removeItemsFromEmbyCollection(coll.embyId, toRemove.map(m => m.Id));
            result.removedFromEmby = toRemove.map(m => m.Name);
            result.changed = true;
          } catch (e) {
            this.logger.warn(`   Failed to remove items from Emby collection "${coll.name}": ${e.message}`);
          }
        }

        result.missingFromLibrary = stillMissing;

        // Persist the full picture onto the collection record itself —
        // embyId stays the consistent key the rest of the app already uses
        coll.importedTitles = uniqueNew;
        coll.originalTitles = uniqueNew;
        coll.missingTitles = stillMissing;
        coll.lastSourceFetch = new Date().toISOString();
      } else {
        // Dry run — just report what's missing against the library snapshot
        const libNames = new Set(libraryItems.map(m => m.Name));
        result.missingFromLibrary = uniqueNew.filter(t => !libNames.has(t));
      }

      // Send everything still missing to Radarr if this collection has it enabled,
      // OR if the global "auto-send all list updates" setting is on
      // (mirrors the existing manual-refresh behaviour — Radarr no-ops on dupes)
      const radarrEnabled = !!coll.radarrAutoSend || !!options.globalRadarr;
      const radarrServerId = (coll.radarrAutoSend && coll.radarrServerId !== undefined && coll.radarrServerId !== null)
        ? coll.radarrServerId
        : options.globalRadarrServerId;
      const radarrServer = creds.radarrServers && creds.radarrServers[radarrServerId];
      result.radarrWouldSend = !!(radarrEnabled && result.missingFromLibrary.length > 0 && radarrServer && radarrServer.url && radarrServer.apiKey);

      if (!options.dryRun && radarrEnabled && result.missingFromLibrary.length > 0 && radarrServer && radarrServer.url && radarrServer.apiKey) {
        for (const title of result.missingFromLibrary) {
          const sent = await this.sendToRadarr(title, radarrServer);
          if (sent.status === 'sent') result.radarrQueued.push(title);
        }
      }

    } catch (e) {
      result.error = e.message;
      this.logger.warn(`List sync: "${coll.name}" failed - ${e.message}`);
    }

    return result;
  }

  // ═════════════════════════════════════════════
  // FULL SYNC (all Trakt/MDBlists collections)
  // ═════════════════════════════════════════════

  async syncAll(options = {}) {
    if (this.isSyncing) {
      return { success: false, error: 'A sync is already running' };
    }
    this.isSyncing = true;

    const startTime = Date.now();
    const dryRun = !!options.dryRun;

    const summary = {
      timestamp: new Date().toISOString(),
      dryRun,
      success: false,
      collectionsChecked: 0,
      collectionsChanged: 0,
      collectionsSkipped: 0,
      collectionsFailed: 0,
      totalAdded: 0,
      totalRemoved: 0,
      totalAddedToEmby: 0,
      totalRemovedFromEmby: 0,
      totalRadarrQueued: 0,
      collections: [],
      errors: []
    };

    try {
      const collections = this.loadCollections();
      const creds = this.loadCredentials();
      const config = this.loadConfig();
      const syncable = collections.filter(c => c.source === 'Trakt' || c.source === 'MDBlists');

      if (syncable.length === 0) {
        summary.success = true;
        summary.message = 'No Trakt/MDBlists collections to sync';
        return summary;
      }

      this.logger.info(`🔄 [LIST SYNC] Checking ${syncable.length} list(s) for updates${dryRun ? ' (dry run)' : ''}...`);

      let libraryItems = [];
      try {
        libraryItems = await this.fetchLibraryItems();
      } catch (e) {
        this.logger.warn('List sync: could not fetch Emby library - ' + e.message);
      }

      if (!dryRun) this.backupCollections();

      let anyIdHealed = false;
      let anyProcessed = false;

      for (const coll of syncable) {
        summary.collectionsChecked++;
        const result = await this.syncCollection(coll, creds, libraryItems, {
          dryRun,
          globalRadarr: !!config.autoRadarr,
          globalRadarrServerId: config.radarrServerId
        });

        if (result.idHealed) anyIdHealed = true;

        if (result.skipped) {
          summary.collectionsSkipped++;
          this.logger.info(`   • ${coll.name} (${coll.source}): skipped — not a syncable source`);
          continue;
        }

        if (result.error) {
          summary.collectionsFailed++;
          summary.errors.push({ name: coll.name, error: result.error });
          this.logger.warn(`   • ${coll.name} (${coll.source}): FAILED — ${result.error}`);
          continue;
        }

        anyProcessed = true;
        this.logger.info(`   • ${coll.name} (${coll.source}): +${result.added.length} / -${result.removed.length}${result.addedToEmby.length ? `, ${result.addedToEmby.length} added to Emby collection` : ''}${result.removedFromEmby.length ? `, ${result.removedFromEmby.length} removed from Emby collection` : ''}${result.missingFromLibrary.length ? `, ${result.missingFromLibrary.length} missing from library` : ''}`);

        if (result.changed) {
          summary.collectionsChanged++;
          summary.totalAdded += result.added.length;
          summary.totalRemoved += result.removed.length;
        }
        summary.totalAddedToEmby += result.addedToEmby.length;
        summary.totalRemovedFromEmby += result.removedFromEmby.length;
        summary.totalRadarrQueued += result.radarrQueued.length;

        if (dryRun || result.changed || result.radarrQueued.length > 0 || result.idHealed) {
          summary.collections.push({
            id: result.id,
            name: result.name,
            source: result.source,
            added: result.added,
            removed: result.removed,
            addedToEmby: result.addedToEmby,
            removedFromEmby: result.removedFromEmby,
            missingFromLibrary: result.missingFromLibrary,
            radarrQueued: result.radarrQueued,
            radarrWouldSend: result.radarrWouldSend,
            idHealed: result.idHealed
          });
        }
      }

      // Always persist after a real (non-dry-run) pass — missingTitles/originalTitles
      // get refreshed on every collection regardless of whether the title-diff
      // itself changed, so the file needs to stay in step every run.
      if (!dryRun && anyProcessed) {
        this.writeJSONAtomic(this.chronoPath, collections);
      }

      // Watched-status push (Emby → Trakt/MDBlists) — opt-in, runs as part of the same cycle
      if (config.watchedSyncEnabled) {
        try {
          const watchedResult = await this.syncWatchedStatus({ dryRun });
          summary.watchedSync = {
            traktPushed: watchedResult.traktPushed,
            mdblistPushed: watchedResult.mdblistPushed,
            skippedNoId: watchedResult.skippedNoId,
            errors: watchedResult.errors
          };
        } catch (e) {
          this.logger.warn('Watched sync step failed: ' + e.message);
          summary.watchedSync = { error: e.message };
        }
      }

      if (summary.collectionsChanged > 0 || summary.totalAddedToEmby > 0 || summary.totalRemovedFromEmby > 0) {
        this.logger.info(`✅ [LIST SYNC] ${summary.collectionsChanged} list(s) updated — +${summary.totalAdded} / -${summary.totalRemoved}${summary.totalAddedToEmby ? `, ${summary.totalAddedToEmby} added to Emby` : ''}${summary.totalRemovedFromEmby ? `, ${summary.totalRemovedFromEmby} removed from Emby` : ''}${summary.totalRadarrQueued ? `, ${summary.totalRadarrQueued} sent to Radarr` : ''}`);
      } else {
        this.logger.info(`✅ [LIST SYNC] Complete — no changes detected`);
      }

      summary.durationMs = Date.now() - startTime;
      summary.success = true;

      if (!dryRun) {
        this.appendAudit(summary);
        const config = this.loadConfig();
        config.lastSync = summary.timestamp;
        config.nextSync = config.enabled
          ? new Date(Date.now() + config.intervalHours * 60 * 60 * 1000).toISOString()
          : null;
        this.writeJSONAtomic(this.configPath, config);
      }

      return summary;

    } catch (error) {
      this.logger.error('List sync failed', error);
      summary.error = error.message;
      return summary;
    } finally {
      this.isSyncing = false;
    }
  }

  // ═════════════════════════════════════════════
  // SCHEDULING (simple interval timer, no cron needed)
  // ═════════════════════════════════════════════

  start() {
    const config = this.loadConfig();
    if (config.enabled) {
      this.scheduleNext(config.intervalHours);
      this.logger.info(`List sync scheduler started (every ${config.intervalHours}h)`);
    }
  }

  scheduleNext(intervalHours) {
    if (this.timer) clearTimeout(this.timer);
    const ms = Math.max(1, intervalHours) * 60 * 60 * 1000;
    this.timer = setTimeout(async () => {
      await this.syncAll({ dryRun: false });
      const config = this.loadConfig();
      if (config.enabled) this.scheduleNext(config.intervalHours);
    }, ms);
  }

  restart() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.start();
  }

  // ═════════════════════════════════════════════
  // STATUS
  // ═════════════════════════════════════════════

  getStatus() {
    const config = this.loadConfig();
    const audit = this.loadAudit();
    return {
      ...config,
      isSyncing: this.isSyncing,
      lastResult: audit.syncs[0] || null,
      history: audit.syncs.slice(0, 10)
    };
  }
}

module.exports = ListSyncService;
