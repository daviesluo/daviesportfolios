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
 * Soft LRU caps for the two ticker-shaped stores. Originally bumped
 * to 400 to give multi-phase accumulation breathing room, but the
 * user hit localStorage quota (~5-10 MB total per origin): 400
 * entries × ~10 KB avg per entry = ~4 MB just for dp.tickerChart,
 * plus dp.maCache + dp.ytd + the FUND/PE rows = often over quota.
 * Once full, every Storage.saveTickerChart silently failed — no
 * cache writes landed. Dropped back to 200 (~2 MB worst case),
 * which fits with comfortable headroom; the writeJSON quota
 * handler in utils.js does an emergency halving on QuotaExceededError
 * as a backstop.
 */
export const TICKER_CACHE_CAP = 200;
export const MA_CACHE_CAP     = 160;

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
 * Cache key for a (ticker × range) chart in dp.tickerChart. Shared
 * by the prefetch and the modal so the two sites can't drift in a
 * way that produces silent cache misses.
 *
 *   - 1D: `${ticker}|1D|${variant}|${phase}` — the fetched data
 *     differs by (extendedHours, phase): includePrePost on/off,
 *     range/interval pinned. Both axes participate in the key so
 *     a phase or toggle flip can't serve the wrong-window cache.
 *   - 1W/1M/3M/YTD: `${ticker}|${rangeKey}` — `fetchParamsFor`
 *     returns the SAME (range, interval, includePrePost=false) for
 *     all phase/toggle combos here, so adding variant/phase to the
 *     key would just split the cache between phases and force a
 *     cold fetch every time the clock crosses 16:00 ET (which was
 *     happening — the user reported "刷新完等一段时间所有图都还要
 *     loading" after a phase transition).
 *   - PE: `${ticker}|PE|v3|${variant}|${phase}` — keep the v3
 *     algorithm-version suffix so old const-EPS series don't get
 *     served after the TTM-aware switch.
 *
 * @param {string} ticker
 * @param {string} rangeKey
 * @param {boolean} useExt
 * @param {string} phase
 */
export function tickerChartCacheKey(ticker, rangeKey, useExt, phase) {
  if (rangeKey === 'PE') return `${ticker}|PE|v3|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
  if (rangeKey === '1D') return `${ticker}|1D|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
  return `${ticker}|${rangeKey}`;
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
