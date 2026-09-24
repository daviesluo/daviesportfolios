// Persisted-state layer. All `dp.*` localStorage rows live here so a
// schema bump is a single migrate() step rather than scattered cache-
// key renames. Imported directly by the modules that need it (the old
// `utils.js` barrel that used to re-export it was retired in 2026-06).
//
// Chart-bulk caches (dp.tickerChart / dp.maCache / dp.ytd) moved out
// to IndexedDB (src/prices/chart_store.js). What stays in localStorage is
// what must be readable on the FIRST render, which IndexedDB never is:
// the schema version, auth lockout, prefs, the ops-error ack, and the
// copies a reload paints before anything answers — market data, the
// portfolio, the last-shown prices, the 24H chart's bars and the Agents
// page. The two larger ones are bounded (one chart window; a size cap).

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
  // Last-known FULL portfolio snapshot (positions + holdings), written
  // after every successful load/save. Hydrated as the initial value of
  // `portfolio` on mount so first paint shows the user's real board
  // immediately instead of a blank "Fetching board from cloud." screen —
  // the actual `loadPortfolioRemote()` call still runs in the background
  // and reconciles (overwrites) the instant it resolves. Never a demo
  // portfolio (savePortfolioCache refuses `_isDemo` rows), so a network
  // hiccup can't seed a stranger's data as if it were the user's own.
  portfolioCache: 'dp.portfolioCache', // { ts, data: Portfolio }
  // The price fields of every holding AS THE PAGE LAST SHOWED THEM —
  // written after each price refresh (see portfolio/shown_prices.js).
  // The portfolio cache above is written only when the book is loaded or
  // saved, so the prices inside it are the ones of the last load; a
  // reload painted those, then the server row's own (older again) ones,
  // then the live quotes — three sets of numbers in two seconds. These
  // are drawn over whichever book is on screen until the live quotes
  // land, and are never sent to the server.
  lastPrices:    'dp.lastPrices', // { ts, data: { ticker: { lastPrice, prevClose, dayPct, extPrice, extDayPct, extPriceTrusted } } }
  // The bars and recorded prints the vs-S&P panel's 24H window was last
  // drawn from, readable on the panel's FIRST render — IndexedDB, where
  // the chart store keeps them, answers only after it. See perf_chart.jsx.
  perfSeed:      'dp.perfSeed', // { ts, data: { rangeKey: '1D', variantKey, spSymbol, hist: { sym: [{date, close}] }, recorded: [{ts, prices}] } }
  // The Agents page as it last drew: the dashboard and the chart each
  // strategy opens on (agents/agents.js). Read on the page's first render —
  // straight after a reload too, when memory is empty — so it opens drawn
  // and refreshes behind. A key no earlier version wrote, so it needs no
  // schema step: a missing row reads as nothing kept.
  agentsCache:   'dp.agentsCache', // { ts, data: { at, dash, charts: { 'strategy|symbol': { at, chart } } } }
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
const CURRENT_SCHEMA_VERSION = 2;
// The IndexedDB database the chart caches used until schema v2. Only one
// of its three object stores ever existed (see chart_store.js), and the
// caches live in `dp-charts` now, so the v2 step deletes it.
const LEGACY_CHART_DB = 'daviesportfolios';
// Rows that are only ever a first-paint stand-in — last-seen prices, the
// 24H chart seed — are ignored past a week, like the market cache: past
// that, "what the page last showed" is too far from today to paint.
const LAST_SHOWN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// The Agents page's kept copy may take this many characters of the ~5 MB
// localStorage allows; past it the charts are dropped first, then the whole
// copy. A dashboard is tens of kilobytes and a chart a few more.
const AGENTS_CACHE_MAX_CHARS = 600_000;
// Market-cache freshness — accept rows up to 7 days old. FX moves
// <1 % over a typical week and index / futures levels move a few
// percent at most, so the cold-start render is still well within
// noise; older than that we'd rather fall back to the empty
// initial state than render values that could be several percent
// off (and trigger spurious FX MISSING / stale-price warnings).
const MARKET_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Portfolio-cache freshness — generous compared to the market cache
// because this row is ONLY ever used as a first-paint seed; the real
// loadPortfolioRemote() call that follows moments later is what actually
// governs correctness, so a stale portfolio cache costs nothing beyond
// "the pre-reconcile flash briefly shows an older snapshot." 30 days
// just keeps a truly ancient / abandoned row from seeding anything at
// all (e.g. a browser profile that hasn't opened the app in months).
const PORTFOLIO_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}

// localStorage write. Returns false on any failure (including quota)
// so callers can fall back to a cold fetch rather than assume the
// write landed. The bulk chart caches (dp.tickerChart / dp.maCache /
// dp.ytd) moved to IndexedDB (chart_store.js); every row that passes
// through here is bounded (see the header). A quota error just means
// the write is skipped: each of these rows is a stand-in, never the
// only copy of anything.
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
  if (stored < 2) {
    // v1 → v2: the chart caches moved to their own IndexedDB database.
    // The old one held the ticker-modal store alone; its rows are a cache
    // the next prefetch refills, so it is dropped rather than copied.
    // Fire-and-forget: a tab still running the old code keeps the delete
    // waiting until it closes, and nothing here depends on it finishing.
    try {
      if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(LEGACY_CHART_DB);
    } catch { /* no IndexedDB here — nothing to delete */ }
  }
  // Future migrations: if (stored < 3) { ... }

  localStorage.setItem(STORAGE_KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION));
}

/**
 * A `{ date, close }` bar the chart can read. A seed that fails this is
 * dropped, not drawn: the chart sorts on `date` and would throw on the
 * first render, before anything could replace it.
 * @param {any} p
 */
const isBar = (p) => !!p && typeof p.date === 'string' && typeof p.close === 'number' && Number.isFinite(p.close);

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
  // Last-known full portfolio snapshot — the first-paint seed described
  // above STORAGE_KEYS.portfolioCache. Returns null (not `{}`) on a
  // missing / stale / malformed row so callers can tell "no cache" apart
  // from a genuinely-loaded empty-ish portfolio and keep today's
  // null-means-still-loading contract intact.
  /** @returns {import('./types').Portfolio | null} */
  loadPortfolioCache: () => {
    const row = readJSON(STORAGE_KEYS.portfolioCache, null);
    if (!row || typeof row !== 'object') return null;
    const ts = Number(row.ts);
    if (!isFinite(ts) || Date.now() - ts > PORTFOLIO_CACHE_MAX_AGE_MS) return null;
    const data = row.data;
    // Minimal shape guard — must look like a real Portfolio (holdings +
    // positions objects) and must NOT be the seeded demo book, in case
    // an old build ever wrote one before this guard existed.
    if (!data || typeof data !== 'object') return null;
    if (!data.holdings || typeof data.holdings !== 'object') return null;
    if (!data.positions || typeof data.positions !== 'object') return null;
    if (data._isDemo === true) return null;
    return data;
  },
  // Persist a full portfolio snapshot (post-load or post-save). Refuses
  // to cache the seeded demo portfolio — a network hiccup must never
  // seed a stranger's data as if it were the user's own on the next
  // cold start, and a real user's genuinely-cached snapshot (if any)
  // should survive a transient failure rather than being overwritten by
  // demo data. Deliberately untyped (like saveMarketCache) — callers pass
  // shapes ranging from a full `Portfolio` to `savePortfolioRemote`'s
  // narrower `{ holdings? }` param, and the guards below are the actual
  // source of truth for what's acceptable, not a static type.
  savePortfolioCache: (p) => {
    if (!p || typeof p !== 'object') return false;
    if (p._isDemo === true) return false;
    if (!p.holdings || typeof p.holdings !== 'object') return false;
    if (!p.positions || typeof p.positions !== 'object') return false;
    return writeJSON(STORAGE_KEYS.portfolioCache, { ts: Date.now(), data: p });
  },
  // Last-shown price fields per holding (see STORAGE_KEYS.lastPrices).
  // `{}` when there is no usable row; entries without a positive
  // lastPrice are dropped, as the market cache drops them.
  /** @returns {Record<string, Record<string, any>>} */
  loadLastPrices: () => {
    const row = readJSON(STORAGE_KEYS.lastPrices, null);
    if (!row || typeof row !== 'object') return {};
    const ts = Number(row.ts);
    if (!isFinite(ts) || Date.now() - ts > LAST_SHOWN_MAX_AGE_MS) return {};
    const data = row.data;
    if (!data || typeof data !== 'object') return {};
    /** @type {Record<string, Record<string, any>>} */
    const out = {};
    for (const [t, v] of Object.entries(data)) {
      if (!v || typeof v !== 'object') continue;
      const lp = Number(/** @type {any} */ (v).lastPrice);
      if (!isFinite(lp) || lp <= 0) continue;
      out[t] = /** @type {Record<string, any>} */ (v);
    }
    return out;
  },
  /** @param {Record<string, Record<string, any>>} prices */
  saveLastPrices: (prices) => {
    if (!prices || typeof prices !== 'object' || Object.keys(prices).length === 0) return false;
    return writeJSON(STORAGE_KEYS.lastPrices, { ts: Date.now(), data: prices });
  },
  // The 24H chart's last-drawn inputs (see STORAGE_KEYS.perfSeed), or
  // null. Every series and row is checked, because the chart reads the
  // seed on its first render and a malformed one would throw there.
  loadPerfSeed: () => {
    const row = readJSON(STORAGE_KEYS.perfSeed, null);
    if (!row || typeof row !== 'object') return null;
    const ts = Number(row.ts);
    if (!isFinite(ts) || Date.now() - ts > LAST_SHOWN_MAX_AGE_MS) return null;
    const d = row.data;
    if (!d || typeof d !== 'object') return null;
    if (d.rangeKey !== '1D' || typeof d.variantKey !== 'string' || typeof d.spSymbol !== 'string') return null;
    if (!d.hist || typeof d.hist !== 'object' || !Array.isArray(d.recorded)) return null;
    /** @type {Record<string, Array<{date: string, close: number}>>} */
    const hist = {};
    for (const [s, bars] of Object.entries(d.hist)) {
      if (Array.isArray(bars) && bars.length > 0 && bars.every(isBar)) hist[s] = bars;
    }
    if (!hist[d.spSymbol]) return null;
    const recorded = d.recorded.filter((r) => r && typeof r.ts === 'string' && r.prices && typeof r.prices === 'object');
    return { rangeKey: '1D', variantKey: d.variantKey, spSymbol: d.spSymbol, hist, recorded };
  },
  /** @param {{ rangeKey: string, variantKey: string, spSymbol: string, hist: Record<string, any[]>, recorded: any[] }} seed */
  savePerfSeed: (seed) => writeJSON(STORAGE_KEYS.perfSeed, { ts: Date.now(), data: seed }),
  // The Agents page's kept copy (see STORAGE_KEYS.agentsCache), or null.
  /** @returns {{ at: number, dash: any, charts: Record<string, { at: number, chart: any }> } | null} */
  loadAgentsCache: () => {
    const row = readJSON(STORAGE_KEYS.agentsCache, null);
    if (!row || typeof row !== 'object') return null;
    const ts = Number(row.ts);
    if (!isFinite(ts) || Date.now() - ts > LAST_SHOWN_MAX_AGE_MS) return null;
    const d = row.data;
    if (!d || typeof d !== 'object' || !d.dash || typeof d.dash !== 'object') return null;
    /** @type {Record<string, { at: number, chart: any }>} */
    const charts = {};
    for (const [k, v] of Object.entries(d.charts && typeof d.charts === 'object' ? d.charts : {})) {
      if (v && typeof v === 'object' && v.chart && typeof v.chart === 'object') charts[k] = { at: Number(v.at) || ts, chart: v.chart };
    }
    return { at: Number(d.at) || ts, dash: d.dash, charts };
  },
  /**
   * Keep the page as it drew, within AGENTS_CACHE_MAX_CHARS: the charts go
   * first, then the whole copy — a copy too big to keep is not worth a
   * quota error on every refresh.
   * @param {{ at: number, dash: any, charts?: Record<string, { at: number, chart: any }> }} copy
   */
  saveAgentsCache: (copy) => {
    if (!copy || !copy.dash || typeof copy.dash !== 'object') return false;
    try {
      let json = JSON.stringify({ ts: Date.now(), data: copy });
      if (json.length > AGENTS_CACHE_MAX_CHARS) json = JSON.stringify({ ts: Date.now(), data: { ...copy, charts: {} } });
      if (json.length > AGENTS_CACHE_MAX_CHARS) return false;
      localStorage.setItem(STORAGE_KEYS.agentsCache, json);
      return true;
    } catch {
      return false;
    }
  },
  // dp.tickerChart / dp.maCache / dp.ytd moved to IndexedDB
  // (chart_store.js — ChartStore / MaStore / YtdStore). See that
  // module for the read/write API. localStorage now only holds
  // small, low-churn rows: auth token + prefs + schema version,
  // staying well clear of the per-origin ~5 MB quota.
};
