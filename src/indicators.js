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
 * Apply a rolling TTM per-share series to a daily price series to
 * produce a ratio series — used for BOTH the P/E and P/S charts.
 * The history is what comes out of Yahoo's `fundamentals-timeseries`:
 * `trailingDilutedEPS` for P/E, revenue rescaled to sales-per-share
 * for P/S. The math is denominator-agnostic — each history entry's
 * `eps` field just carries whichever per-share figure applies. We
 * add a 45-day report lag to each quarter-end so the ratio only
 * steps when the market would actually have known the new figure,
 * then for each price date pick the latest reported TTM value ≤ that
 * date. Falls through to `fallbackEps` (the current TTM value) for
 * dates earlier than the first reported quarter — index proxies
 * (^GSPC etc.) stay on this fallback path since Finnhub returns no
 * aggregate EPS at the index level.
 *
 * @param {Array<{date: string, close: number}>} pricePoints
 * @param {Array<{date: string, eps: number}> | null | undefined} ttmEpsHistory  per-share TTM history, ascending by date
 * @param {number} fallbackEps  current TTM per-share value used when no reported TTM is in scope
 * @param {number} [reportLagMs] default 45 days
 */
export function priceDividedByTtmEps(pricePoints, ttmEpsHistory, fallbackEps, reportLagMs = 45 * 86400000) {
  if (!Array.isArray(pricePoints) || pricePoints.length === 0) return [];
  // ttmEpsHistory is expected to ALREADY be in USD — the
  // fundamentals Edge Function pre-rescales it via
  // `normalizeEpsHistoryToUsd` using FMP's price/pe as the USD
  // anchor (since FMP's eps field is in the underlying foreign
  // currency for ADRs). Doing a second rescale here using
  // `fallbackEps` would inject the client/server price-timing
  // mismatch into the chart even for already-correct US stocks
  // and ADRs — see Codex P2 on PR #94.
  // Parse both `e.date` (quarter end, always "YYYY-MM-DD") and `p.date`
  // (price bar, "YYYY-MM-DD" daily or "YYYY-MM-DDTHH:MM" intraday) as
  // UTC. `new Date("YYYY-MM-DDTHH:MM")` (no `Z`) parses as LOCAL time
  // — so for a user in UTC+8 the intraday bar's ms is 8 h earlier
  // than the equivalent UTC ms, while the quarter-end string parses
  // as UTC midnight. The boundary between "before report" and "after
  // report" then shifts ±12 h depending on the user's tz, producing a
  // one-bar step in the wrong place at the exact 45-day report-lag
  // boundary. Force both sides to UTC by appending `Z` when missing.
  const utcMs = (s) => new Date(typeof s === 'string' && s.length === 16 ? s + 'Z' : s).getTime();
  const reportEvents = Array.isArray(ttmEpsHistory) ? ttmEpsHistory
    .map(e => ({ ttm: Number(e.eps), reportMs: utcMs(e.date) + reportLagMs }))
    .filter(e => isFinite(e.ttm) && isFinite(e.reportMs) && e.ttm > 0)
    .sort((a, b) => a.reportMs - b.reportMs)
    : [];
  return pricePoints.map(p => {
    const dMs = utcMs(p.date);
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

/**
 * "Is `extPrice` a real extended-hours quote for this ticker?" — the
 * shared verdict behind both the chart modal's right-edge price and
 * the home page's position-card prices, so the two never disagree
 * (the CBRS card-vs-modal divergence).
 *
 * Two signals, both required:
 *   1. The intraday series has at least one pre/post-market bar.
 *      Yahoo includes AH-timestamped bars even for OTC ADRs like
 *      SFTBY (just pinned at the RTH close), so signal 1 alone isn't
 *      enough.
 *   2. `extPrice` tracks the latest bar within 3%. SFTBY's bogus
 *      postMarketPrice (Yahoo ships today's OPEN as the "AH" quote)
 *      diverges 5-10% from every real bar and fails here; a genuine
 *      AH mover — even a big one, a hot IPO or an earnings beat —
 *      lands within 3% of the last AH bar and passes.
 *
 * The ±5% quote-only heuristic (`extPriceLooksReal` in metrics.js)
 * can't tell SFTBY's bogus price from a real >5% AH move; this can,
 * because it has the intraday bars.
 *
 * @param {Array<{date: string, close?: number}>} series  intraday bars
 * @param {number | null | undefined} extPrice
 * @param {number} openMinsUtc
 * @param {number} closeMinsUtc
 */
export function extPriceIsRealAh(series, extPrice, openMinsUtc, closeMinsUtc) {
  if (typeof extPrice !== 'number' || !isFinite(extPrice) || extPrice <= 0) return false;
  if (!hasExtendedHoursBars(series, openMinsUtc, closeMinsUtc)) return false;
  const latest = Array.isArray(series) && series.length > 0
    ? series[series.length - 1] : null;
  if (!latest || typeof latest.close !== 'number' || latest.close <= 0) return false;
  return Math.abs(extPrice - latest.close) / latest.close < 0.03;
}

/**
 * "Is this chart range plotted on a price y-axis?" — true for every
 * actual price chart (1D / 1W / 1M / 3M / YTD), false for the ratio
 * charts (PE / PS) where the series has already been divided by
 * earnings or sales per share and the y-axis is in ratio units.
 *
 * Used by ticker_chart_modal.jsx's live-tail substitution: when the
 * chart axis is in dollars, swap in the live last price so the tail
 * tracks the rest of the app in real time. When the axis is in
 * ratio units (PE / PS), DON'T swap — the live price is in a
 * different unit and would draw a vertical cliff between the
 * second-to-last bar (the actual ratio) and today (the raw price).
 * That's the bug the user hit on NET / SATS / NVTS / SOUN after the
 * P/S YTD view shipped (only 'PE' was excluded from substitution; PS
 * fell through and corrupted the last bar).
 *
 * @param {string} rangeKey
 */
export function isPriceAxis(rangeKey) {
  return rangeKey !== 'PE' && rangeKey !== 'PS';
}

/**
 * Drop Yahoo's bogus "closing print" bar from a 1D intraday series.
 *
 * Background: Yahoo's /v8/chart for thin-volume OTC pink-sheet ADRs
 * (SFTBY is the canonical case) sometimes emits a last 5-min bar
 * whose close equals the day's OPEN price rather than the actual
 * last trade in the bar's window. Concretely, SFTBY's last real
 * trade lands around 20:58 BST (15:58 ET) at ~$22.85, but Yahoo's
 * 15:55-16:00 ET bar reports close = $23.30 — exactly the day's
 * open price. The chart then draws a misleading "snap to open"
 * spike at the right edge, and "since previous close" reads wrong.
 *
 * Pattern check (all three must hold): (a) last bar diverges from
 * the previous bar by > 1.5 %, AND (b) last bar matches the first
 * bar's close within 0.5 %, AND (c) the divergence direction
 * "returns to" the first bar (i.e. last close - first close has
 * the OPPOSITE sign of prev close - first close, OR prev close is
 * far from first close). A real legitimate close-print that just
 * happens to land at the open won't satisfy (a) — it'd have grown
 * into the value gradually.
 *
 * Returns the original array when the pattern doesn't match —
 * regular tickers with normal closing prints are unaffected.
 *
 * @param {Array<{date: string, close: number, volume?: number}>} data
 */
export function trimBogusCloseBar(data) {
  if (!Array.isArray(data) || data.length < 3) return data;
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const first = data[0];
  if (!last || !prev || !first) return data;
  if (typeof last.close !== 'number' || typeof prev.close !== 'number'
      || typeof first.close !== 'number') return data;
  if (prev.close <= 0 || first.close <= 0) return data;
  const divFromPrev = Math.abs(last.close - prev.close) / prev.close;
  const divFromFirst = Math.abs(last.close - first.close) / first.close;
  if (divFromPrev > 0.015 && divFromFirst < 0.005) {
    return data.slice(0, -1);
  }
  return data;
}
