// SFTBY's chart data source. The actual recording happens on the
// server (`supabase/functions/sftby-record/index.ts` on a pg_cron
// schedule — runs even when no client is open). This module is the
// CLIENT-SIDE READ + CACHE layer: it fetches the latest
// `series + prevClose` from the `sftby-fetch` Edge Function, mirrors
// it into localStorage for instant first-paint, and exposes accessors
// for the modal + the price-merge helpers.
//
// Why server-side: Yahoo's tape for this OTC pink-sheet ADR doesn't
// start until UK 14:30 (US RTH open) even though T212's trading
// window is UK 13:00-21:00, so every chart was missing the first
// 1.5 h of every session. The pg_cron-driven recorder fills the gap
// AND keeps recording while the user's browser is closed — which is
// also what makes a meaningful prevClose possible (yesterday's last
// bucket survives the page reload).

import { SB_URL } from './supabase_config.js';
import { EDGE_ANON_KEY } from './yahoo_fetch.js';

const STORAGE_KEY = 'dp.sftby.server-cache';
const SFTBY_FETCH_URL = `${SB_URL}/functions/v1/sftby-fetch`;
const TICK_EVENT  = 'sftby:server-fetched';

/**
 * @typedef {{
 *   date: string,        // 'YYYY-MM-DDTHH:MM' (UTC)
 *   close: number,
 *   volume: number,      // always 0 — synthetic series has no volume
 * }} Point
 *
 * @typedef {{
 *   series: Array<Point>,
 *   prevClose: number | null,
 *   prevCloseDate: string | null,
 *   fetchedAt: number,   // ms epoch — used to suppress stale-cache writes
 * }} CachedData
 */

/** @returns {CachedData | null} */
function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.series)) return null;
    return parsed;
  } catch { return null; }
}

/** @param {CachedData} data */
function writeCache(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch { /* quota — silently drop; next fetch retries */ }
}

/**
 * Hit `sftby-fetch` on the Edge, update localStorage, and fire the
 * server-fetched event so subscribed modals re-render with fresh
 * series + prevClose.
 *
 * Returns the freshly-fetched CachedData, or null on network failure
 * (callers should fall back to whatever readCache() returns).
 *
 * @param {typeof fetch} [fetcher]  test injection point
 */
export async function fetchSftbyServerData(fetcher = fetch) {
  try {
    const res = await fetcher(SFTBY_FETCH_URL, {
      headers: { Authorization: `Bearer ${EDGE_ANON_KEY}`, apikey: EDGE_ANON_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || !Array.isArray(body.series)) return null;
    /** @type {CachedData} */
    const data = {
      series: body.series,
      prevClose: typeof body.prevClose === 'number' ? body.prevClose : null,
      prevCloseDate: typeof body.prevCloseDate === 'string' ? body.prevCloseDate : null,
      fetchedAt: Date.now(),
    };
    writeCache(data);
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      try { window.dispatchEvent(new CustomEvent(TICK_EVENT)); } catch { /* ignore */ }
    }
    return data;
  } catch { return null; }
}

/**
 * Return TODAY's intraday series in the chart's standard format.
 * Reads synchronously from the localStorage cache (populated by
 * `fetchSftbyServerData`), so the modal's React.useState initialiser
 * gets data on the very first render — no Loading… flash even on
 * cold mount, as long as the cache holds a prior session.
 *
 * @returns {Array<Point>}
 */
export function getSftbyIntradaySeries() {
  const cached = readCache();
  return cached ? cached.series : [];
}

/**
 * Yesterday's last bucket's close, used as today's prevClose for the
 * "since previous close" pct. Server-computed so the client doesn't
 * have to skip weekends / holidays itself.
 */
export function getSftbyPrevClose() {
  const cached = readCache();
  return cached ? cached.prevClose : null;
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
 * The event name modal subscribes to so it re-reads after each server
 * fetch (or any other writer to the cache). Exported so the modal
 * doesn't hard-code the string.
 */
export const SFTBY_FETCH_EVENT = TICK_EVENT;

// Test hooks — not part of the public runtime surface but exported so
// the unit tests can clear / inspect without poking at localStorage.
export const _testHooks = {
  STORAGE_KEY,
  reset() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } },
  readCache,
  writeCache,
};
