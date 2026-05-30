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
      headers: { Authorization: `Bearer ${EDGE_ANON_KEY}`, apikey: EDGE_ANON_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body !== 'object') return null;
    writeCache({ ts: Date.now(), byTicker: body });
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
 *   - there are >= 2 recorded points dated strictly AFTER the last
 *     Yahoo bar (the 20:00 ET after-hours close) — i.e. an actual
 *     overnight trend, not just one stale point.
 * Appending only points after the last Yahoo bar keeps it to the
 * CURRENT overnight session (older sessions' points are already
 * before/within the Yahoo window or pruned). Falls back (returns
 * `series` unchanged) so the caller's existing single-dot path runs
 * with no regression when there's 0-1 overnight point.
 *
 * Date strings are UTC `YYYY-MM-DDTHH:MM` on both sides, so the
 * lexicographic `>` comparison is chronological.
 *
 * @param {Point[] | null} series          Yahoo bars
 * @param {Point[]} overnightPts           recorded overnight points (oldest-first)
 * @param {{ rangeKey: string, useExt: boolean, phase: string, ticker: string }} ctx
 * @returns {Point[] | null}
 */
export function mergeOvernightSeries(series, overnightPts, ctx) {
  const { rangeKey, useExt, phase, ticker } = ctx || {};
  if (!useExt || phase !== 'overnight') return series;
  if (!hasOvernightSession(ticker)) return series;
  if (rangeKey !== '1D' && rangeKey !== '1W' && rangeKey !== '1M') return series;
  if (!Array.isArray(series) || series.length === 0) return series;
  if (!Array.isArray(overnightPts) || overnightPts.length < 2) return series;
  const lastBarDate = series[series.length - 1].date;
  const tail = overnightPts.filter((p) => p && typeof p.date === 'string' && p.date > lastBarDate
    && typeof p.close === 'number' && isFinite(p.close));
  if (tail.length < 2) return series;
  return [...series, ...tail];
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
