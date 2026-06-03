// Chart-data cache layer backed by IndexedDB. localStorage's
// per-origin ~5 MB quota was the wall the user kept hitting after
// growing to ~30 tickers × multiple ranges × variants — the chart
// cache filled up and Storage.saveTickerChart silently dropped
// every subsequent write. IndexedDB allows 100+ MB and there's no
// realistic ceiling for our workload, so the prefetch can be as
// thorough as it wants without trim-thrashing.
//
// Public API mirrors what the modal + prefetch used to do against
// localStorage, with two changes:
//
//  1. Reads are SYNCHRONOUS — they go through an in-memory Map
//     mirror that's hydrated from IDB on boot. The modal's
//     useState initializer (the one that lets a warm-cache open
//     paint without a spinner flash) needs to read on the very
//     first render, before any await is possible.
//
//  2. Writes are async fire-and-forget — they update the in-memory
//     mirror SYNCHRONOUSLY (so subsequent reads see the value
//     immediately) and persist to IDB in the background. Failures
//     are swallowed silently; the in-memory copy survives the
//     session even if persistence fails.
//
// Three logical stores: tickerChart, maCache, ytd. Each gets its
// own IDB object store via idb-keyval's `createStore`. On first
// hydrate, each store also slurps any existing localStorage row of
// the same name and writes it into IDB, then deletes the
// localStorage row — that's the one-shot migration.

import { createStore, get, set, del, keys, entries } from 'idb-keyval';

const DB_NAME = 'daviesportfolios';

/**
 * @typedef {{ ts: number, data: any }} CacheEntry
 */

/**
 * @param {string} storeName
 * @param {string} legacyLocalStorageKey
 * @param {(parsedRow: any) => Iterable<[string, CacheEntry]>} migrateExtract
 *        How to pull (key, entry) pairs out of the legacy localStorage row.
 *        Differs per cache shape — tickerChart/maCache wrap entries in
 *        `{ entries: { k: { ts, data } } }`; ytd is `{ year, byRange: { rkey: { entries } } }`.
 */
function makeChartStore(storeName, legacyLocalStorageKey, migrateExtract) {
  // idb-keyval lazily opens DB on first call; instantiate the store
  // descriptor up front so we don't pay that lookup repeatedly.
  // Returns null in environments without `indexedDB` (vitest node
  // runner, private-mode iOS Safari, …) so all subsequent IDB ops
  // short-circuit cleanly to mem-only.
  /** @type {ReturnType<typeof createStore>|null} */
  let idbStore = null;
  const idbAvailable = typeof indexedDB !== 'undefined';
  const tryStore = () => {
    if (!idbAvailable) return null;
    if (idbStore) return idbStore;
    try {
      idbStore = createStore(DB_NAME, storeName);
      return idbStore;
    } catch { return null; }
  };
  // Wrap idb-keyval's `set`/`del` because their first call path
  // calls `indexedDB.open(...)` synchronously — a missing global
  // throws before the Promise is constructed, escaping a `.catch`.
  const safeSet = (k, v) => {
    try { return set(k, v, /** @type {any} */ (tryStore())).catch(() => {}); }
    catch { /* synchronous IDB-open failure — mem-only is fine */ }
    return undefined;
  };
  const safeDel = (k) => {
    try { return del(k, /** @type {any} */ (tryStore())).catch(() => {}); }
    catch { /* same as above */ }
    return undefined;
  };

  /** @type {Map<string, CacheEntry>} */
  const mem = new Map();
  let hydrationPromise = /** @type {Promise<void>|null} */ (null);

  function hydrate() {
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = (async () => {
      // Step 1 (one-shot): migrate any existing localStorage row.
      try {
        const raw = typeof localStorage !== 'undefined'
          ? localStorage.getItem(legacyLocalStorageKey)
          : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          const store = tryStore();
          for (const [k, v] of migrateExtract(parsed)) {
            if (!v || typeof v !== 'object') continue;
            mem.set(k, v);
            if (store) { try { await set(k, v, store); } catch { /* ignore */ } }
          }
          // Drop the localStorage row to free the quota for the
          // small things that still belong there (auth, prefs).
          try { localStorage.removeItem(legacyLocalStorageKey); } catch { /* ignore */ }
        }
      } catch { /* corrupted legacy row, leave it; IDB will populate fresh */ }
      // Step 2: hydrate in-memory mirror from IDB.
      try {
        const store = tryStore();
        if (!store) return;
        const all = await entries(store);
        for (const [k, v] of all) {
          if (typeof k === 'string' && v && typeof v === 'object') mem.set(k, v);
        }
      } catch { /* IDB unavailable (private mode, tests, etc) — mem-only */ }
    })();
    return hydrationPromise;
  }

  return {
    /** Returns a promise that resolves once hydration completes. */
    hydrate,
    /** @param {string} key */
    get(key) {
      return mem.get(key) || null;
    },
    /**
     * @param {string} key
     * @param {CacheEntry} value
     */
    set(key, value) {
      mem.set(key, value);
      safeSet(key, value);
    },
    /** @param {string} key */
    del(key) {
      mem.delete(key);
      safeDel(key);
    },
    /** Snapshot of all current keys (in-memory). */
    keys() { return Array.from(mem.keys()); },
    /** Drop entries whose ts is older than `cutoff`. */
    pruneOlderThan(cutoff) {
      for (const k of Array.from(mem.keys())) {
        if ((mem.get(k)?.ts || 0) < cutoff) {
          mem.delete(k);
          safeDel(k);
        }
      }
    },
    /** Test hook — wipe everything in-memory and IDB. */
    async _resetForTest() {
      mem.clear();
      const store = tryStore();
      if (!store) return;
      try {
        const allKeys = await keys(store);
        await Promise.all(allKeys.map(k => del(k, store)));
      } catch { /* ignore */ }
    },
  };
}

export const ChartStore = makeChartStore(
  'tickerChart',
  'dp.tickerChart',
  function* (parsed) {
    const ents = parsed?.entries || {};
    for (const [k, v] of Object.entries(ents)) yield [k, /** @type {CacheEntry} */ (v)];
  },
);

export const MaStore = makeChartStore(
  'maCache',
  'dp.maCache',
  function* (parsed) {
    const ents = parsed?.entries || {};
    for (const [k, v] of Object.entries(ents)) yield [k, /** @type {CacheEntry} */ (v)];
  },
);

// dp.ytd has a nested shape — year/byRange/<rkey>/entries/<ticker> —
// so the IDB-backed wrapper flattens it: each (rkey, ticker) becomes
// one IDB entry under key `${rkey}|${ticker}`. Restored on read by
// rebuilding the nested shape so `Storage.loadYtd()`'s callers don't
// have to change.
export const YtdStore = makeChartStore(
  'ytd',
  'dp.ytd',
  function* (parsed) {
    const byRange = parsed?.byRange;
    if (!byRange || typeof byRange !== 'object') return;
    const year = parsed?.year;
    for (const [rkey, blob] of Object.entries(byRange)) {
      const ents = (/** @type {any} */ (blob))?.entries || {};
      for (const [ticker, entry] of Object.entries(ents)) {
        yield [
          `y${year}|${rkey}|${ticker}`,
          /** @type {CacheEntry} */ (entry),
        ];
      }
    }
  },
);

/** Rebuild dp.ytd's nested shape from the flat IDB entries. */
export function ytdSnapshot() {
  /** @type {{year: number|null, byRange: Record<string, {entries: Record<string, any>}>}} */
  const out = { year: null, byRange: {} };
  for (const k of YtdStore.keys()) {
    const m = /^y(\d+)\|([^|]+)\|(.+)$/.exec(k);
    if (!m) continue;
    const year = parseInt(m[1], 10);
    const rkey = m[2];
    const ticker = m[3];
    const v = YtdStore.get(k);
    if (!v) continue;
    if (out.year == null) out.year = year;
    if (!out.byRange[rkey]) out.byRange[rkey] = { entries: {} };
    out.byRange[rkey].entries[ticker] = v;
  }
  return out;
}

/**
 * Hydrate all chart stores in parallel. Idempotent — each store's
 * `hydrate()` caches its promise, so this can be called multiple
 * times safely. Auto-fired at module load (see below) so the
 * in-memory mirror is populated before the first user interaction;
 * also exposed so prefetchAllChartData can `await` it explicitly
 * before its synchronous staleness checks read the mirror.
 */
export function hydrateAllChartStores() {
  return Promise.all([
    ChartStore.hydrate(),
    MaStore.hydrate(),
    YtdStore.hydrate(),
  ]);
}

// Retention for the IDB-backed chart caches. Entries are TTL-checked
// on read (5 m … 12 h per range in cache.js), so anything older than a
// few days is already refetched on use — pruning past this horizon
// just evicts entries nothing reads anymore: delisted tickers, stale
// phase/variant permutations, ranges the user stopped opening. Without
// it the three IDB stores grow unbounded across months of use (the
// old localStorage path had a soft LRU cap; the IDB rewrite dropped it
// and `pruneOlderThan` was defined but never wired up). 30 days is
// generous headroom over every range's TTL while still bounding growth.
const PRUNE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Drop entries older than `maxAgeMs` from every chart store (in-memory
 * + IDB). Cheap — iterates the in-memory mirror. Called once after the
 * module-load hydrate, and again at the tail of each prefetch pass, so
 * a long-lived session stays bounded without a dedicated timer.
 * @param {number} [maxAgeMs]
 */
export function pruneAllChartStores(maxAgeMs = PRUNE_MAX_AGE_MS) {
  const cutoff = Date.now() - maxAgeMs;
  ChartStore.pruneOlderThan(cutoff);
  MaStore.pruneOlderThan(cutoff);
  YtdStore.pruneOlderThan(cutoff);
}

// Kick off hydration as soon as this module imports — the modal's
// useState initializer (synchronous) relies on the in-memory mirror
// being populated to skip the spinner on warm-cache opens, and any
// awaitable code path in prefetchAllChartData explicitly waits via
// hydrateAllChartStores() before touching the mirror. Prune once
// hydration lands so accumulated cruft from prior sessions is evicted.
if (typeof indexedDB !== 'undefined') {
  hydrateAllChartStores()
    .then(() => pruneAllChartStores())
    .catch(() => { /* IDB unavailable — mem-only fallback */ });
}
