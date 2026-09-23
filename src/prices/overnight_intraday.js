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

import { SB_URL } from '../app/supabase_config.js';
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
 *   - the extended-hours toggle is on (NOT gated on the live overnight
 *     phase — last night's recorded curve stays visible all of the next
 *     trading day, since the server keeps a 26h window),
 *   - the ticker has a real overnight session (US equity, not SFTBY),
 *   - the range is 1D / 1W / 1M (the intraday-capable views),
 *   - there are >= 2 recorded points inside the chart's time window.
 *
 * Merge strategy: split the recorded points into contiguous overnight
 * SESSIONS (a >3h gap = a new night), let each session's [start,end]
 * span be OWNED by the recorded samples, and keep every Yahoo bar
 * OUTSIDE all spans — before the first session, in the daytime gaps
 * BETWEEN sessions, and after the last — then sort the union. We do NOT
 * cut at "the last Yahoo bar" — Yahoo has started returning sparse
 * overnight prints for the most liquid names (NVDA, ORCL…) but not
 * others (GOOG), so a `> lastBarDate` filter dropped almost all recorded
 * points for the liquid ones (their last Yahoo bar was already deep in
 * the overnight) and the line only appeared for tickers Yahoo had NO
 * overnight data for. Owning each session's span makes the line
 * consistent regardless of how much overnight data Yahoo happens to have.
 * The per-session clustering is what keeps the chart correct OUTSIDE the
 * live overnight: the 26h fetch can hold last night's tail AND tonight,
 * with a full RTH day between — a plain before/after splice around
 * [firstRec, lastRec] deleted that middle RTH (the "opening in the
 * overnight showed only the overnight, no RTH" bug); keeping the daytime
 * bars in the inter-session gap fixes it.
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
 * The recorded points are scoped to the chart's time window — the last
 * bar's time minus the range span, clamped no later than series[0] — so
 * a prior session's tail (still in the 26h fetch) can't leak in, while
 * last night's points are kept even when they predate series[0] (the
 * daytime case, where Yahoo's first bar is today's pre-market). Falls
 * back (returns `series` unchanged) so the caller's single-dot path runs
 * with no regression when there are 0-1 usable points.
 *
 * Date strings are UTC `YYYY-MM-DDTHH:MM` on both sides, so the
 * lexicographic comparisons are chronological.
 *
 * @param {Point[] | null} series          Yahoo bars
 * @param {Point[]} overnightPts           recorded overnight points (oldest-first)
 * @param {{ rangeKey: string, extendedHours: boolean, ticker: string, barIntervalMs?: number }} ctx
 * @returns {Point[] | null}
 */
export function mergeOvernightSeries(series, overnightPts, ctx) {
  const { rangeKey, extendedHours, ticker, barIntervalMs } = ctx || {};
  // Gate on the ext-hours TOGGLE only — NOT the live overnight phase.
  // The recorded points stay in the server's 26h window all of the next
  // trading day, so the chart draws last night's overnight curve during
  // regular / pre / after-hours too (the splice below keeps the session's
  // real bars on both sides of it). `extPrice`-anchoring and the live
  // heartbeat dot remain phase-gated in the callers; this is the LINE.
  if (!extendedHours) return series;
  if (!hasOvernightSession(ticker)) return series;
  if (rangeKey !== '1D' && rangeKey !== '1W' && rangeKey !== '1M') return series;
  if (!Array.isArray(series) || series.length === 0) return series;
  if (!Array.isArray(overnightPts) || overnightPts.length < 2) return series;
  // Lower bound for in-window recorded points. `series[0].date` is WRONG
  // during the day: Yahoo's first bar is then today's pre-market / RTH
  // (the overnight has no Yahoo bars), so last night's points sit BEFORE
  // series[0] and would ALL be dropped — the "flat 0% line until the open"
  // bug. Key off the window's true left edge instead: the last bar's time
  // minus the range's span, but never later than series[0] (the live-
  // overnight case already starts at the window edge). This still bounds
  // out a prior session's tail left over in the 26h fetch (e.g. a 1D chart
  // opened just after the overnight ends).
  const SPAN_MS = { '1D': 24 * 3_600_000, '1W': 5 * 24 * 3_600_000, '1M': 31 * 24 * 3_600_000 };
  const toMs = (d) => new Date(d + (typeof d === 'string' && d.length === 16 && d[10] === 'T' ? 'Z' : '')).getTime();
  const lastMs = toMs(series[series.length - 1].date);
  const startMs = Math.min(toMs(series[0].date), lastMs - (SPAN_MS[rangeKey] || SPAN_MS['1D']));
  const rec = overnightPts.filter((p) => p && typeof p.date === 'string'
    && Number.isFinite(toMs(p.date)) && toMs(p.date) >= startMs
    && typeof p.close === 'number' && isFinite(p.close));
  if (rec.length < 2) return series;
  // Frozen overnight = the market was CLOSED for this session (US holiday /
  // weekend / holiday-eve): the recorder keeps sampling T212's last close,
  // so every point is identical. A flat carry-forward line conveys nothing
  // and reads as "still trading", so don't splice it — let the chart end at
  // the last real bar. A genuinely trading overnight always has some
  // variation, so this only ever drops a dead-flat line.
  if (rec.every((p) => p.close === rec[0].close)) return series;
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
  // Split the recorded points into contiguous overnight SESSIONS (a gap
  // > 3 h between consecutive points = a new night). The server's 26h
  // fetch can hold LAST night's tail AND tonight — two clusters with a
  // full RTH day between them. Each cluster's [start,end] span is OWNED by
  // the recorded samples (Yahoo's sparse overnight prints inside are cut);
  // every Yahoo bar OUTSIDE all spans is kept — before the first cluster,
  // in the daytime gaps BETWEEN clusters (so the RTH session isn't dropped
  // — the "opening in the overnight shows ONLY the overnight" bug), and
  // after the last. A plain before/after splice around [firstRec,lastRec]
  // deleted that middle RTH. Cluster off the full-resolution `rec` so the
  // spans stay accurate regardless of the 1W/1M downsampling, then sort
  // the union chronologically (date strings sort in time order).
  const CLUSTER_GAP_MS = 3 * 3_600_000;
  /** @type {Array<[string, string]>} */
  const spans = [];
  let segStart = rec[0].date;
  let prevMs = toMs(rec[0].date);
  for (let i = 1; i < rec.length; i++) {
    const curMs = toMs(rec[i].date);
    if (curMs - prevMs > CLUSTER_GAP_MS) { spans.push([segStart, rec[i - 1].date]); segStart = rec[i].date; }
    prevMs = curMs;
  }
  spans.push([segStart, rec[rec.length - 1].date]);
  const kept = series.filter((p) =>
    p && typeof p.date === 'string' && !spans.some(([s, e]) => p.date >= s && p.date <= e));
  return [...kept, ...sampled].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
