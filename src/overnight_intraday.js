// Client read + cache layer for the server-side overnight intraday
// recorder. The recording happens on the server
// (supabase/functions/overnight-record on a pg_cron schedule — runs
// even when no browser tab is open). This module:
//   - fetches the recorded points from `overnight-fetch` each refresh,
//   - mirrors them into localStorage for instant first paint,
//   - exposes a pure merge helper that splices the overnight points
//     onto a Yahoo series so the chart draws a real overnight LINE
//     (20:00-04:00 ET) instead of the single "heartbeat dot".
//
// Why: Yahoo has no overnight bars and T212 returns only one realtime
// point per call. The recorder samples T212 every 5 min so there's an
// actual overnight trend; this module surfaces it in the modal.

import { SB_URL } from './supabase_config.js';
import { EDGE_ANON_KEY } from './yahoo_fetch.js';
import { hasOvernightSession } from './ticker_class.js';
import { getAppToken } from './auth.js';

const STORAGE_KEY = 'dp.overnight.cache';
const FETCH_URL = `${SB_URL}/functions/v1/overnight-fetch`;
const FETCH_EVENT = 'overnight:fetched';

/**
 * `volume` is optional so the recorded points (which carry `volume:0`)
 * and the Yahoo chart series (whose bars type `volume?`) are mutually
 * assignable — the merge splices one into the other.
 * @typedef {{ date: string, close: number, volume?: number }} Point
 * @typedef {{ ts: number, byTicker: Record<string, Point[]> }} Cache
 */

/** @returns {Cache | null} */
function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.byTicker !== 'object') return null;
    return parsed;
  } catch { return null; }
}

/** @param {Cache} cache */
function writeCache(cache) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); }
  catch { /* quota — next fetch retries */ }
}

/**
 * Hit `overnight-fetch` for the given tickers, mirror the response
 * into localStorage, and fire `overnight:fetched` so any open modal
 * re-reads. Returns the `byTicker` map, or null on failure (callers
 * fall back to whatever `getOvernightSeries` reads from cache).
 *
 * @param {string[]} tickers
 * @param {typeof fetch} [fetcher]  test injection
 */
export async function fetchOvernightSeries(tickers, fetcher = fetch) {
  const list = Array.from(new Set((tickers || []).filter(Boolean)));
  if (list.length === 0) return null;
  try {
    const url = `${FETCH_URL}?tickers=${encodeURIComponent(list.join(','))}`;
    const res = await fetcher(url, {
      // overnight-fetch now requires the HMAC app token (the points
      // reveal held tickers — see migration 0018). Send it alongside the
      // anon key; a session without a token just gets back an empty
      // overnight series (the chart falls back to its single-dot path).
      headers: {
        Authorization: `Bearer ${EDGE_ANON_KEY}`,
        apikey: EDGE_ANON_KEY,
        'x-app-token': getAppToken(),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body !== 'object') return null;
    // Merge into the existing cache rather than replace — so a
    // single-ticker fetch (the modal fetching its own symbol on open)
    // doesn't drop the other tickers a prior batch fetch populated.
    const prev = readCache();
    const byTicker = { ...(prev && prev.byTicker), ...body };
    writeCache({ ts: Date.now(), byTicker });
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      try { window.dispatchEvent(new CustomEvent(FETCH_EVENT)); } catch { /* ignore */ }
    }
    return body;
  } catch { return null; }
}

/**
 * Synchronous read of one ticker's recorded overnight points from the
 * localStorage cache. Empty array when nothing recorded / cold cache.
 * Synchronous so the modal's useState initializer paints instantly.
 *
 * @param {string} ticker
 * @returns {Point[]}
 */
export function getOvernightSeries(ticker) {
  const cache = readCache();
  const pts = cache?.byTicker?.[ticker];
  return Array.isArray(pts) ? pts : [];
}

/**
 * Splice recorded overnight points onto a Yahoo series so the chart
 * draws a connected overnight LINE. Returns the SAME `series`
 * reference (no merge) unless ALL of:
 *   - extended-hours toggle on AND it's the overnight phase,
 *   - the ticker has a real overnight session (US equity, not SFTBY),
 *   - the range is 1D / 1W / 1M (the intraday-capable views),
 *   - there are >= 2 recorded points inside the chart's time window.
 *
 * Merge strategy: keep Yahoo bars dated BEFORE the first recorded
 * overnight point, then let the recorded 5-min samples OWN the
 * overnight window from there on. We do NOT cut at "the last Yahoo
 * bar" — Yahoo has started returning sparse overnight prints for the
 * most liquid names (NVDA, ORCL…) but not others (GOOG), so a
 * `> lastBarDate` filter dropped almost all recorded points for the
 * liquid ones (their last Yahoo bar was already deep in the overnight)
 * and the line only appeared for tickers Yahoo had NO overnight data
 * for. Owning the window from the first recorded point makes the line
 * consistent regardless of how much overnight data Yahoo happens to
 * have, and the recorded T212 series is the truth we want anyway.
 *
 * **Downsampling for 1W / 1M:** the recorded points are 5-min, but
 * 1W draws at a 30-min cadence and 1M at 60-min. Without sampling,
 * the ~130 overnight points dwarfed the per-day bar count and made
 * "today" occupy ~50% of 1W / ~25% of 1M on the index x-axis (the
 * "1W and 1M's most recent day looks oversized" report). Caller passes
 * `barIntervalMs` (= the chart's bar cadence); we take every
 * `round(barIntervalMs / 5 min)`-th recorded point and always append
 * the live tail so the line still ends at "now". 1D's cadence equals
 * the recorded interval → step 1 → no-op.
 *
 * `windowStart` scopes the recorded points to the visible chart window
 * (series[0].date) so a prior session's points (still in the 26h fetch)
 * can't leak in. Falls back (returns `series` unchanged) so the
 * caller's single-dot path runs with no regression when there are
 * 0-1 usable points.
 *
 * Date strings are UTC `YYYY-MM-DDTHH:MM` on both sides, so the
 * lexicographic comparisons are chronological.
 *
 * @param {Point[] | null} series          Yahoo bars
 * @param {Point[]} overnightPts           recorded overnight points (oldest-first)
 * @param {{ rangeKey: string, useExt: boolean, phase: string, ticker: string, barIntervalMs?: number }} ctx
 * @returns {Point[] | null}
 */
export function mergeOvernightSeries(series, overnightPts, ctx) {
  const { rangeKey, useExt, phase, ticker, barIntervalMs } = ctx || {};
  if (!useExt || phase !== 'overnight') return series;
  if (!hasOvernightSession(ticker)) return series;
  if (rangeKey !== '1D' && rangeKey !== '1W' && rangeKey !== '1M') return series;
  if (!Array.isArray(series) || series.length === 0) return series;
  if (!Array.isArray(overnightPts) || overnightPts.length < 2) return series;
  const windowStart = series[0].date;
  const rec = overnightPts.filter((p) => p && typeof p.date === 'string' && p.date >= windowStart
    && typeof p.close === 'number' && isFinite(p.close));
  if (rec.length < 2) return series;
  // Match the recorded-point density to the chart's bar cadence —
  // 1D (5 min) is a no-op; 1W (30 min) keeps every 6th; 1M (60 min)
  // every 12th. Always append the live tail so the line still ends
  // at the most recent quote, not at the last step-aligned bar.
  const RECORDED_INTERVAL_MS = 5 * 60_000;
  const step = Math.max(1, Math.round((barIntervalMs || RECORDED_INTERVAL_MS) / RECORDED_INTERVAL_MS));
  let sampled;
  if (step === 1) {
    sampled = rec;
  } else {
    sampled = [];
    for (let i = 0; i < rec.length; i += step) sampled.push(rec[i]);
    const last = rec[rec.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
  }
  if (sampled.length < 2) return series;
  const firstRec = sampled[0].date;
  // Yahoo bars before the recorded window's start; recorded samples own
  // everything from there (incl. any stray Yahoo overnight bars).
  const base = series.filter((p) => p.date < firstRec);
  return [...base, ...sampled];
}

/** Event the modal subscribes to so it re-reads after each fetch. */
export const OVERNIGHT_FETCH_EVENT = FETCH_EVENT;

// Test hooks.
export const _testHooks = {
  STORAGE_KEY,
  reset() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } },
  writeCache,
  readCache,
};
