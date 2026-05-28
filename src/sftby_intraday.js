// SFTBY-only client-side intraday recorder. Yahoo's intraday tape for
// this OTC pink-sheet ADR is unreliable (the 21:00-BST close-print bar
// snaps to the day's open price; the actual T212 session is UK 13:00-
// 21:00 but Yahoo's first bar lands at 14:30 BST anyway). Instead, on
// every doRefresh tick during the SFTBY session, we record T212's
// `currentPrice` into localStorage. The modal's 1D chart reads from
// here directly — `prefetch`-equivalent paint (synchronous read, no
// network) and the rightmost point keeps updating live as the bucket
// price gets overwritten by subsequent ticks within the same 5-min
// window.
//
// Storage shape (localStorage `dp.sftby.intraday`):
//   [{ time: <ms epoch>, price: <number> }, ...]
// Points are auto-pruned to the last ~26 hours so the array stays
// small even after weeks of running (96 buckets / day × 1 day = 96
// entries, ~3 KB JSON).

import { londonTimeParts } from './market_hours.js';

const STORAGE_KEY = 'dp.sftby.intraday';
const BUCKET_MS   = 5 * 60_000;        // 5-min granularity
const MAX_AGE_MS  = 26 * 3_600_000;    // ~26h rolling window
const TICK_EVENT  = 'sftby:intraday:tick';

/**
 * SFTBY's T212 trading window: Mon-Fri 13:00-21:00 London time. Outside
 * this window T212's `currentPrice` is frozen at the last real trade
 * and there's no value in recording duplicates.
 *
 * @param {Date} [now]
 */
export function isSftbySessionOpen(now = new Date()) {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const parts = londonTimeParts(now);
  const hh = parseInt(parts.hh, 10);
  if (!isFinite(hh)) return false;
  return hh >= 13 && hh < 21;
}

/** @returns {Array<{time: number, price: number}>} */
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.time === 'number' && typeof p.price === 'number');
  } catch { return []; }
}

/** @param {Array<{time: number, price: number}>} points */
function writeStored(points) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(points)); }
  catch { /* quota — silently drop, next tick will retry */ }
}

/** @param {number} timeMs */
function bucketIdx(timeMs) { return Math.floor(timeMs / BUCKET_MS); }

/**
 * Record T212's currentPrice for SFTBY at `now`. Behaviour:
 *   - Outside the session window → no-op.
 *   - Within the same 5-min bucket as the last point → overwrite that
 *     point's price (so the chart's rightmost bar tracks the live
 *     price every refresh tick).
 *   - New bucket → append a fresh point.
 *   - Prune anything older than 26h.
 *
 * Fires a `sftby:intraday:tick` CustomEvent on `window` afterwards so
 * the modal can re-read without a polling loop.
 *
 * @param {number | null | undefined} price
 * @param {number} [now]  ms epoch (test injection)
 */
export function recordSftbyTick(price, now) {
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) return;
  const t = typeof now === 'number' ? now : Date.now();
  if (!isSftbySessionOpen(new Date(t))) return;

  const points = readStored();
  const last = points.length > 0 ? points[points.length - 1] : null;
  const nowBucket = bucketIdx(t);

  if (last && bucketIdx(last.time) === nowBucket) {
    last.price = price;
    last.time = t;
  } else {
    points.push({ time: t, price });
  }

  const cutoff = t - MAX_AGE_MS;
  const pruned = points.filter((p) => p.time >= cutoff);
  writeStored(pruned);

  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    try { window.dispatchEvent(new CustomEvent(TICK_EVENT)); } catch { /* ignore */ }
  }
}

/**
 * Return SFTBY's intraday series in the chart's standard format —
 * `[{date: 'YYYY-MM-DDTHH:MM', close, volume: 0}, ...]`. Empty array
 * when nothing's been recorded yet (cold cache, weekend, app's first
 * tick of the session, etc.).
 */
export function getSftbyIntradaySeries() {
  return readStored().map((p) => ({
    date: new Date(p.time).toISOString().slice(0, 16),
    close: p.price,
    volume: 0,
  }));
}

/**
 * Downsample a 5-min synthetic series to the given bar interval (in
 * minutes). Picks the LAST point in each bucket so the close prices
 * line up with what a brokerage's 30-min / 60-min OHLC bar would
 * report. `intervalMin === 5` is a no-op.
 *
 * @param {Array<{date: string, close: number, volume?: number}>} points
 * @param {number} intervalMin
 */
function aggregateToInterval(points, intervalMin) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const factor = Math.max(1, Math.round(intervalMin / 5));
  if (factor === 1) return points.slice();
  const out = [];
  for (let i = 0; i < points.length; i += factor) {
    const chunk = points.slice(i, i + factor);
    if (chunk.length === 0) continue;
    out.push({ ...chunk[chunk.length - 1] });
  }
  return out;
}

/**
 * Merge SFTBY's synthetic data into a Yahoo-sourced chart series for a
 * given rangeKey. For 1D this returns the synthetic series outright
 * (the 1D path goes through the modal's special-case branch and
 * doesn't call this). For 1W / 1M / 3M / YTD it drops Yahoo's bars
 * dated TODAY and substitutes the synthetic ones at the appropriate
 * downsample (30-min for 1W, 60-min for 1M, last-point-only for 3M
 * and YTD daily charts).
 *
 * Why: Yahoo's SFTBY tape starts at UK 14:30 (US RTH open) even though
 * the T212 session opens at UK 13:00 — every multi-day chart loses
 * 1.5h of every day. The synthetic recorder covers 13:00-21:00, so
 * replacing today's portion at the right granularity restores the
 * full session for the most recent day. Older days stay on Yahoo
 * because the synthetic recorder only keeps ~26h.
 *
 * @param {Array<{date: string, close: number, volume?: number}>} yahooSeries
 * @param {string} rangeKey  '1D' | '1W' | '1M' | '3M' | 'YTD' | etc.
 * @param {string} [todayIso]  YYYY-MM-DD; defaults to today's UTC date
 */
export function mergeSftbyToday(yahooSeries, rangeKey, todayIso) {
  if (rangeKey === '1D') return getSftbyIntradaySeries();
  if (!Array.isArray(yahooSeries)) yahooSeries = [];
  const today = todayIso || new Date().toISOString().slice(0, 10);

  const synthAll = getSftbyIntradaySeries();
  const synthToday = synthAll.filter((p) => p.date.startsWith(today));
  if (synthToday.length === 0) return yahooSeries; // nothing to substitute

  const olderDays = yahooSeries.filter((p) => p.date.slice(0, 10) !== today);
  let todayBars;
  if (rangeKey === '1W')      todayBars = aggregateToInterval(synthToday, 30);
  else if (rangeKey === '1M') todayBars = aggregateToInterval(synthToday, 60);
  else {
    // 3M / YTD / longer use daily bars — collapse today's synthetic to
    // a single bar at the latest close.
    const last = synthToday[synthToday.length - 1];
    todayBars = [{ date: today, close: last.close, volume: 0 }];
  }
  return [...olderDays, ...todayBars];
}

/**
 * The event name modal subscribes to so it re-reads after each tick.
 * Exported so the modal doesn't hard-code the string.
 */
export const SFTBY_INTRADAY_TICK_EVENT = TICK_EVENT;

// Test hooks — not part of the public runtime surface but exported so
// the unit tests can clear / inject without poking at localStorage.
export const _testHooks = {
  STORAGE_KEY,
  BUCKET_MS,
  MAX_AGE_MS,
  reset() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } },
  read: readStored,
};
