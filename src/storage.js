// Persisted-state layer. All `dp.*` localStorage rows live here so a
// schema bump is a single migrate() step rather than scattered cache-
// key renames. Imported directly by the modules that need it (the old
// `utils.js` barrel that used to re-export it was retired in 2026-06).
//
// Chart-bulk caches (dp.tickerChart / dp.maCache / dp.ytd) moved out
// to IndexedDB (src/chart_store.js) so localStorage now only carries
// small / low-churn rows: schema version, auth lockout, prefs, the
// market-data seed, and the ops-error ack timestamp.

// -------- localStorage schema -----------------------------------------
// All persisted state lives under the `dp.` namespace and is gated on a
// single integer schema version. Bumping CURRENT_SCHEMA_VERSION + adding
// a migration step inside migrateStorage() lets us evolve the on-disk
// format without scattering versioned cache keys (e.g. `ytd-perf-cache-v12`)
// around the codebase. Call `migrateStorage()` exactly once on app startup
// before reading any persisted state.
const STORAGE_KEYS = {
  schemaVersion: 'dp.schema',
  auth:          'dp.auth',   // { lockoutUntil, attempts }
  prefs:         'dp.prefs',  // { hideValues: boolean, ... }
  // Last-known market-data snapshot from the live `fetchTickers`
  // reply. Hydrated on app mount as the initial value of
  // `marketData` so the first metrics compute uses real cross-rates
  // (~yesterday's, well within a percent of live) instead of the
  // silent 1:1 USD fallback that was inflating CNY-denominated
  // holdings by ~7x for ~500 ms during cold start. Also covers MC
  // cards (^GSPC / ^VIX / BZ=F / etc.) so they no longer flash
  // "Loading…" on cold start — they paint the last-known values
  // immediately and refresh once the live tick lands.
  marketCache:   'dp.marketCache', // { ts, data: { ticker: { lastPrice, prevClose?, dayPct?, ... }, ... } }
  // Timestamp (ms epoch) of the newest ops-error the admin has
  // acknowledged via the error-triage badge — the badge stays hidden
  // until a newer error is reported. Admin-only single scalar; no
  // migration needed (a missing key reads as 0 = "nothing acked").
  opsErrorAck:   'dp.opsErrorAck', // number (ms epoch)
  // Chart caches (dp.tickerChart / dp.maCache / dp.ytd) live in
  // IndexedDB now (chart_store.js). chart_store's hydrate() owns
  // the legacy-localStorage migration so these names are referenced
  // there, not here.
};
const CURRENT_SCHEMA_VERSION = 1;
// Market-cache freshness — accept rows up to 7 days old. FX moves
// <1 % over a typical week and index / futures levels move a few
// percent at most, so the cold-start render is still well within
// noise; older than that we'd rather fall back to the empty
// initial state than render values that could be several percent
// off (and trigger spurious FX MISSING / stale-price warnings).
const MARKET_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}

// localStorage write. Returns false on any failure (including quota)
// so callers can fall back to a cold fetch rather than assume the
// write landed. The bulk chart caches (dp.tickerChart / dp.maCache /
// dp.ytd) moved to IndexedDB (chart_store.js), so the rows that pass
// through here now are all small + bounded (auth, prefs, the single
// market-data snapshot, the ops-error ack scalar). The old
// QuotaExceededError fallback used to halve the chart cache rows to
// free space; with those gone there's nothing large left in
// localStorage to trim, so a quota error just means we skip the write.
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function migrateStorage() {
  // Chart caches now live in IndexedDB (chart_store.js). Their
  // module's hydrate() handles a one-shot localStorage→IDB migration
  // for any legacy dp.tickerChart / dp.maCache / dp.ytd rows the
  // user still has from older deploys. Pruning lives there too,
  // since IDB's quota is so much higher (100+ MB) that the trim is
  // bounded by a soft cap rather than browser quota pressure.
  const stored = parseInt(localStorage.getItem(STORAGE_KEYS.schemaVersion) || '0', 10);
  if (stored === CURRENT_SCHEMA_VERSION) return;

  if (stored < 1) {
    // v0 → v1: drop the per-feature keys that pre-date the unified schema.
    // Auth state and YTD cache will rebuild themselves on first use; we
    // don't try to preserve them since the auth state is short-lived and
    // the YTD cache is just a fetch optimisation.
    const legacy = ['auth_token', 'auth_lockout_until', 'auth_attempts'];
    // Old per-version YTD cache keys (we got up to v12 before the rewrite).
    for (let i = 1; i <= 20; i++) legacy.push('ytd-perf-cache-v' + i);
    legacy.push('ytd-perf-cache-v2'); // alias kept for safety
    for (const k of legacy) localStorage.removeItem(k);
  }
  // Future migrations: if (stored < 2) { ... }

  localStorage.setItem(STORAGE_KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION));
}

// Typed helpers — call these instead of touching localStorage directly so
// the keys stay centralised and migrations stay possible.
export const Storage = {
  migrate: migrateStorage,
  loadAuth:  () => readJSON(STORAGE_KEYS.auth, { lockoutUntil: 0, attempts: 0 }),
  saveAuth:  (s) => writeJSON(STORAGE_KEYS.auth, s),
  clearAuth: () => { try { localStorage.removeItem(STORAGE_KEYS.auth); } catch (_) {} },
  loadPrefs: () => readJSON(STORAGE_KEYS.prefs, { hideValues: false }),
  savePrefs: (p) => writeJSON(STORAGE_KEYS.prefs, p),
  // Newest acknowledged ops-error timestamp (ms epoch); 0 when the
  // admin has never acknowledged. See OpsErrorBadge.
  loadOpsErrorAck: () => readJSON(STORAGE_KEYS.opsErrorAck, 0),
  saveOpsErrorAck: (ts) => writeJSON(STORAGE_KEYS.opsErrorAck, ts),
  // Market-data seed: returns a marketData-shaped object containing
  // every ticker from the most recent successful live tick. Initial
  // render uses these for both (a) FX-conversion in metrics (so CNY
  // / GBP / HKD holdings get correct USD conversions instead of
  // the silent 1:1 fallback that briefly inflated/deflated the
  // portfolio total) and (b) MC card display (so ^GSPC / ^VIX /
  // BZ=F / GBPUSD=X paint last-known values instead of "Loading…").
  // Returns `{}` when the cache is missing, older than 7 days, or
  // malformed. Entries with non-positive lastPrice are dropped to
  // keep the seed clean.
  loadMarketCache: () => {
    const row = readJSON(STORAGE_KEYS.marketCache, null);
    if (row && typeof row === 'object') {
      const ts = Number(row.ts);
      if (!isFinite(ts) || Date.now() - ts > MARKET_CACHE_MAX_AGE_MS) return {};
      const data = row.data;
      if (!data || typeof data !== 'object') return {};
      /** @type {Record<string, any>} */
      const out = {};
      for (const [t, v] of Object.entries(data)) {
        if (!v || typeof v !== 'object') continue;
        const lp = Number(/** @type {any} */ (v).lastPrice);
        if (!isFinite(lp) || lp <= 0) continue;
        out[t] = v;
      }
      return out;
    }
    // One-shot back-compat: the previous storage key was `dp.fxCache`
    // (PR #105 — FX subset only, shape `{ts, rates}`). A browser that
    // upgraded across the rename has no `dp.marketCache` row yet but
    // still carries the older fxCache from yesterday, so reading it
    // as a fallback keeps the cold-start flash suppressed during
    // the first post-deploy paint. saveMarketCache deletes the
    // legacy key after a successful write, so this branch only
    // fires once per browser.
    const legacy = readJSON('dp.fxCache', null);
    if (!legacy || typeof legacy !== 'object') return {};
    const lts = Number(legacy.ts);
    if (!isFinite(lts) || Date.now() - lts > MARKET_CACHE_MAX_AGE_MS) return {};
    const rates = legacy.rates;
    if (!rates || typeof rates !== 'object') return {};
    /** @type {Record<string, any>} */
    const out = {};
    for (const [t, v] of Object.entries(rates)) {
      if (!v || typeof v !== 'object') continue;
      const lp = Number(/** @type {any} */ (v).lastPrice);
      if (!isFinite(lp) || lp <= 0) continue;
      out[t] = v;
    }
    return out;
  },
  // Persist a fresh marketData tick (filtered to entries with a
  // usable lastPrice). Called after every successful setMarketData
  // so the next cold start has a recent snapshot to seed with.
  saveMarketCache: (marketData) => {
    if (!marketData || typeof marketData !== 'object') return false;
    /** @type {Record<string, any>} */
    const data = {};
    for (const [t, v] of Object.entries(marketData)) {
      if (!v || typeof v !== 'object') continue;
      const lp = Number(/** @type {any} */ (v).lastPrice);
      if (!isFinite(lp) || lp <= 0) continue;
      data[t] = v;
    }
    if (Object.keys(data).length === 0) return false;
    const ok = writeJSON(STORAGE_KEYS.marketCache, { ts: Date.now(), data });
    // Clean up the legacy `dp.fxCache` row once the new cache has at
    // least one fresh write — keeps localStorage tidy and ensures
    // the loadMarketCache back-compat branch doesn't keep firing
    // off increasingly-stale data.
    if (ok) {
      try { localStorage.removeItem('dp.fxCache'); } catch { /* ignore */ }
    }
    return ok;
  },
  // dp.tickerChart / dp.maCache / dp.ytd moved to IndexedDB
  // (chart_store.js — ChartStore / MaStore / YtdStore). See that
  // module for the read/write API. localStorage now only holds
  // small, low-churn rows: auth token + prefs + schema version,
  // staying well clear of the per-origin ~5 MB quota.
};
