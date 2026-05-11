// Shared cache plumbing — TTL constants, freshness predicate, soft
// LRU trim. Lifted out of `prefetch.js` / `ticker_chart_modal.jsx`
// because three caches (dp.ytd, dp.tickerChart, dp.maCache) all had
// near-identical hand-rolled copies that drifted (e.g. one of them
// forgot to check `entry.data.length >= 2`, another inlined a
// volume-presence check that should have been generic).

/** Per-range TTL for chart data — must match both modal + prefetch. */
export const RANGE_TTL_MS = {
  '1D':  5  * 60 * 1000,
  '1W':  30 * 60 * 1000,
  '1M':  60 * 60 * 1000,
  '3M':  12 * 60 * 60 * 1000,
  'YTD': 12 * 60 * 60 * 1000,
};

/** TTL for the MA overlay's wider-history fetch (dp.maCache). */
export const MA_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Soft LRU caps for the two ticker-shaped stores. Sized so the
 * prefetch's freshly-warmed (range × ticker × variant × phase) rows
 * don't get evicted by the modal's subsequent writes, and so a
 * multi-phase / multi-variant accumulation over several refreshes
 * has breathing room. Used by both prefetch.js and the modal's
 * cache writer — duplicating the cap value broke the prefetch once
 * (the modal's 200 trim halved the prefetch's 400 cap on the next
 * modal write).
 */
export const TICKER_CACHE_CAP = 400;
export const MA_CACHE_CAP     = 240;

/** TTL for the P/E modal's TTM EPS history fetch. */
export const PE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * "Is this cached entry usable right now?" — same answer modal and
 * prefetch must agree on. An optional `extraValid` predicate lets
 * callers add cache-row-shape requirements (e.g. "1D entries must
 * carry at least one bar with a numeric `volume` field" so the
 * VWAP overlay isn't suppressed by pre-volume-field cache rows
 * left over from before that Edge Function deploy).
 *
 * @param {{ts?: number, data?: any}|null|undefined} entry
 * @param {number} ttlMs
 * @param {((data: any) => boolean)} [extraValid]
 */
export function isFresh(entry, ttlMs, extraValid) {
  if (!entry || !Array.isArray(entry.data) || entry.data.length < 2) return false;
  if ((Date.now() - (entry.ts || 0)) >= ttlMs) return false;
  if (extraValid && !extraValid(entry.data)) return false;
  return true;
}

/**
 * Predicate factory: "the data array includes at least one row
 * where `field` is a number". Used by the prefetch's 1D check
 * to invalidate cache rows from before per-bar `volume` started
 * landing on intraday Yahoo responses.
 * @param {string} field
 */
export const hasAnyNumericField = (field) =>
  /** @param {any[]} data */
  (data) => Array.isArray(data) && data.some(p => typeof p?.[field] === 'number');

/**
 * Trim the slowest-N entries from an `{ entries: { [k]: { ts } } }`
 * map until the entry count fits under `cap`. Mutates and returns
 * the same object so callers can chain into `Storage.saveX(...)`.
 *
 * @param {{ entries?: Record<string, {ts?: number}> }} store
 * @param {number} cap
 */
export function trimLru(store, cap) {
  store.entries = store.entries || {};
  const keys = Object.keys(store.entries);
  if (keys.length <= cap) return store;
  const sorted = keys
    .map((k) => ({ k, ts: store.entries[k]?.ts || 0 }))
    .sort((a, b) => b.ts - a.ts);
  /** @type {Record<string, {ts?: number, data?: any}>} */
  const trimmed = {};
  for (let i = 0; i < cap; i++) trimmed[sorted[i].k] = store.entries[sorted[i].k];
  store.entries = trimmed;
  return store;
}
