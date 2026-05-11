// Pure indicator math for the ticker chart modal. Lifted out of
// ticker_chart_modal.jsx so the formulas can be pinned by vitest
// without spinning up React — the file was the single largest
// source of subtle math regressions in this session (VWAP reset
// anchors / MA staircases / PE const-EPS) and every fix risked
// silently breaking another ticker class because the conditions
// were tangled with rendering state.
//
// Every function takes plain arrays and returns plain arrays.
// No React, no DOM, no `fetch`. Importable from anywhere; the
// modal still owns the data pipelines that feed these.

import { isCrypto, isUsEquity } from './ticker_class.js';

/**
 * Bar window for a simple moving average overlay. Daily-only
 * tickers (CN funds / .PVT) get a plain N-day window; intraday
 * ranges scale by bars-per-day so a "5-day MA on a 30 m chart"
 * is actually 5 × 13 = 65 bars wide.
 *
 * @param {string} rangeKey
 * @param {boolean} dailyOnly
 */
export function maBarsFor(rangeKey, dailyOnly = false) {
  const days   = { '1W': 5, '1M': 10, '3M': 20, 'YTD': 50 }[rangeKey] ?? 0;
  if (!days) return 0;
  if (dailyOnly) return days;
  const barsPerDay = { '1W': 13, '1M': 7, '3M': 1, 'YTD': 1 }[rangeKey] ?? 1;
  return days * barsPerDay;
}

/**
 * User-facing day count for the MA label ("MA 5", "MA 10", etc.).
 * Always the day count regardless of bar interval.
 * @param {string} rangeKey
 */
export function maLabelDaysFor(rangeKey) {
  return { '1W': 5, '1M': 10, '3M': 20, 'YTD': 50 }[rangeKey] ?? 0;
}

/**
 * Trailing simple moving average over a chronological bar array.
 * Returns a parallel-length array of MA values (`null` for indices
 * where the window doesn't fit). O(N) via prefix-sum sliding window.
 *
 * @param {Array<{date: string, close: number}>} bars  ascending by date
 * @param {number} window  bars to include in each MA (inclusive of the bar)
 */
export function rollingSma(bars, window) {
  if (!Array.isArray(bars) || bars.length === 0 || window <= 0) return [];
  /** @type {(number|null)[]} */
  const out = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= window) sum -= bars[i - window].close;
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

/**
 * Compute a per-display-bar MA. Combines a wider history series with
 * the displayed series (display wins on duplicate timestamps so the
 * live-tail substitution remains in play) so the MA line spans the
 * full chart even when the wider-history cache lags the freshly-
 * fetched display data.
 *
 * @param {Array<{date: string, close: number}>} points     ascending display bars
 * @param {Array<{date: string, close: number}> | null | undefined} maHistory  ascending wider series, optional
 * @param {number} window  bar window (use maBarsFor() to pick)
 * @returns {Array<number|null>}  same length as `points`; null where no MA fits
 */
export function computeMaSeries(points, maHistory, window) {
  if (!Array.isArray(points) || points.length === 0 || window <= 0) return [];
  const combinedMap = new Map();
  if (Array.isArray(maHistory)) {
    for (const p of maHistory) combinedMap.set(p.date, p.close);
  }
  // Display wins on dupe — preserves the live-tail substitution.
  for (const p of points) combinedMap.set(p.date, p.close);
  const combined = Array.from(combinedMap.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (combined.length < window) return new Array(points.length).fill(null);
  const ma = rollingSma(combined, window);
  const byDate = new Map();
  for (let i = 0; i < combined.length; i++) byDate.set(combined[i].date, ma[i]);
  return points.map((p) => (byDate.has(p.date) ? /** @type {number|null} */ (byDate.get(p.date)) : null));
}

/**
 * VWAP session reset boundary for a ticker, in UTC minutes-of-day.
 *
 *   - Crypto (`-USD`): 00:00 UTC — anchored-VWAP convention for 24/7.
 *   - US equity, ext toggle OFF: 09:30 ET regular open (the open
 *     UTC time comes from `usMarketHoursUtc().{openHh, openMm}`).
 *   - US equity, ext toggle ON: 04:00 ET pre-market open so the
 *     VWAP spans pre / regular / AH as one ramp.
 *   - Everything else with per-bar volume (LSE / HK / =F futures):
 *     00:00 UTC — exchange hours fit inside a single UTC date for
 *     LSE / HK, and CME globex straddles midnight UTC naturally.
 *
 * @param {string} ticker
 * @param {boolean} extendedHours
 * @param {{ edt: boolean, openHh: number, openMm: number }} mh
 * @returns {{ resetMins: number, useUsOpenReset: boolean }}
 */
export function vwapSessionResetFor(ticker, extendedHours, mh) {
  if (isCrypto(ticker)) return { resetMins: 0, useUsOpenReset: false };
  if (!isUsEquity(ticker)) return { resetMins: 0, useUsOpenReset: false };
  const resetMins = extendedHours
    ? (4 + (mh.edt ? 4 : 5)) * 60   // 04:00 ET → 08:00 UTC EDT / 09:00 UTC EST
    : mh.openHh * 60 + mh.openMm;   // 09:30 ET
  return { resetMins, useUsOpenReset: true };
}

/**
 * Bucket a bar timestamp to a session-start UTC date so VWAP can
 * restart cleanly at the right anchor for the ticker.
 *
 * @param {string} dateStr  "YYYY-MM-DDTHH:MM"
 * @param {{ resetMins: number, useUsOpenReset: boolean }} cfg  from vwapSessionResetFor
 */
export function vwapSessionKeyOf(dateStr, cfg) {
  if (typeof dateStr !== 'string' || dateStr.length < 16) return '';
  const day = dateStr.slice(0, 10);
  if (!cfg.useUsOpenReset) return day;
  const hh = parseInt(dateStr.slice(11, 13), 10);
  const mm = parseInt(dateStr.slice(14, 16), 10);
  if (!isFinite(hh) || !isFinite(mm)) return '';
  if (hh * 60 + mm >= cfg.resetMins) return day;
  // Pre-reset hours belong to the previous UTC day's session.
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Strict cumulative VWAP per session, with sparse-volume forward-
 * fill so tickers Yahoo gives ~hourly non-zero volume for (BTC-USD)
 * stay smooth instead of stair-stepping. Returns null for bars
 * before any real volume has been seen — user explicitly rejected
 * a v=1 TWAP bootstrap.
 *
 * @param {Array<{date: string, close: number, volume?: number}>} points
 * @param {(date: string) => string} sessionKeyOf  bucket each bar to its session
 * @returns {Array<number|null>}  same length as `points`
 */
export function computeVwap(points, sessionKeyOf) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (!points.some(p => Number(p.volume) > 0)) return new Array(points.length).fill(null);
  /** @type {Array<number|null>} */
  const out = new Array(points.length).fill(null);
  let sumPV = 0, sumV = 0, currentSession = '', lastSeenVol = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const sk = sessionKeyOf(p.date);
    if (sk !== currentSession) {
      sumPV = 0; sumV = 0; currentSession = sk; lastSeenVol = 0;
    }
    const realV = Number(p.volume);
    const isReal = isFinite(realV) && realV > 0;
    if (isReal) lastSeenVol = realV;
    const v = isReal ? realV : lastSeenVol;
    sumPV += p.close * v;
    sumV  += v;
    out[i] = sumV > 0 ? sumPV / sumV : null;
  }
  return out;
}

/**
 * Apply a rolling TTM-EPS series to a daily price series to produce
 * a P/E ratio series. The TTM history is what comes out of Yahoo's
 * `fundamentals-timeseries trailingDilutedEPS` — pre-summed TTM at
 * each quarter end. We add a 45-day report lag to each quarter-end
 * so the P/E only steps when the market would actually have known
 * the new EPS, then for each price date pick the latest reported
 * TTM EPS ≤ that date. Falls through to `fallbackEps` (the
 * current TTM EPS) for dates earlier than the first reported
 * quarter — index proxies (^GSPC etc.) stay on this fallback path
 * since Finnhub returns no aggregate EPS at the index level.
 *
 * @param {Array<{date: string, close: number}>} pricePoints
 * @param {Array<{date: string, eps: number}> | null | undefined} ttmEpsHistory  ascending by date
 * @param {number} fallbackEps  current TTM EPS used when no reported TTM is in scope
 * @param {number} [reportLagMs] default 45 days
 */
export function priceDividedByTtmEps(pricePoints, ttmEpsHistory, fallbackEps, reportLagMs = 45 * 86400000) {
  if (!Array.isArray(pricePoints) || pricePoints.length === 0) return [];
  const reportEvents = Array.isArray(ttmEpsHistory) ? ttmEpsHistory
    .map(e => ({ ttm: Number(e.eps), reportMs: new Date(e.date).getTime() + reportLagMs }))
    .filter(e => isFinite(e.ttm) && isFinite(e.reportMs) && e.ttm > 0)
    .sort((a, b) => a.reportMs - b.reportMs)
    : [];
  return pricePoints.map(p => {
    const dMs = new Date(p.date).getTime();
    let ttmEps = fallbackEps;
    for (let i = reportEvents.length - 1; i >= 0; i--) {
      if (reportEvents[i].reportMs <= dMs) { ttmEps = reportEvents[i].ttm; break; }
    }
    return { date: p.date, close: ttmEps > 0 ? p.close / ttmEps : 0 };
  });
}

/**
 * "Does this intraday series contain any bar OUTSIDE the regular
 * session window?" — pre-market or after-hours. Used by the modal
 * to decide whether `extPrice` from Yahoo is a real AH quote or a
 * stale/bogus value (OTC ADRs like SFTBY: Yahoo populates
 * postMarketPrice with today's open price). True iff at least one
 * bar's UTC HH:MM is < openMins or > closeMins.
 *
 * @param {Array<{date: string}>} series
 * @param {number} openMinsUtc
 * @param {number} closeMinsUtc
 */
export function hasExtendedHoursBars(series, openMinsUtc, closeMinsUtc) {
  if (!Array.isArray(series) || series.length === 0) return false;
  return series.some(p => {
    if (typeof p.date !== 'string' || p.date.length < 16) return false;
    const hh = parseInt(p.date.slice(11, 13), 10);
    const mm = parseInt(p.date.slice(14, 16), 10);
    if (!isFinite(hh) || !isFinite(mm)) return false;
    const mins = hh * 60 + mm;
    return mins < openMinsUtc || mins > closeMinsUtc;
  });
}
