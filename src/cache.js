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
  '1Y':  12 * 60 * 60 * 1000,
};

/** TTL for the MA overlay's wider-history fetch (dp.maCache). */
export const MA_TTL_MS = 12 * 60 * 60 * 1000;

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
 *   - PE: `${ticker}|PE|v5|${variant}|${phase}` — keep an
 *     algorithm-version suffix so old series don't get served
 *     across breaking changes. v1→v2 was the TTM-aware switch;
 *     v3→v4 invalidates the broken-anchor series the prefetch
 *     wrote while the fundamentals Edge Function was still
 *     dividing USD prices by foreign-currency EPS (TSM 1.22 /
 *     SFTBY 0.07 / ASML 63 bug); v4→v5 switches the price window
 *     from YTD to trailing-1Y ("P/E YTD" → "P/E 1Y"), so the old
 *     year-to-date series must not be served.
 *   - PS: `${ticker}|PS|v3|${variant}|${phase}` — v1→v2
 *     invalidates the const-denominator P/S series (a 1:1 rescale
 *     of the price line); v2 steps on earnings via the Edge
 *     Function's ttmSalesHistory, same as PE; v2→v3 is the same
 *     YTD→1Y window switch as PE v4→v5.
 *
 * @param {string} ticker
 * @param {string} rangeKey
 * @param {boolean} useExt
 * @param {string} phase
 */
export function tickerChartCacheKey(ticker, rangeKey, useExt, phase) {
  if (rangeKey === 'PE') return `${ticker}|PE|v5|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
  if (rangeKey === 'PS') return `${ticker}|PS|v3|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
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
