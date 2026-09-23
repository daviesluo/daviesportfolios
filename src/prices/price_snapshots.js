// Server-recorded 5-minute prices, read back and folded into the bars
// the performance charts already draw from.
//
// The recorder (`supabase/functions/snapshot-record`) writes one row per
// 5-minute bucket: `{ ticker → native-currency price }`. Nothing here
// computes a portfolio value — these rows go into the SAME
// `{ ticker: [{date, close}] }` shape Yahoo's history arrives in, and
// `computeAt` values them exactly as it values a Yahoo bar. That is the
// whole design: a recorded point and a fetched point are the same kind
// of thing, so "recorded data progressively replaces derived history"
// needs no merge of two portfolio series, and the two panels cannot
// drift apart because there is only ever one valuation.
//
// What the recorded rows add over Yahoo:
//   - 5-minute density beyond the single day Yahoo will serve at 5m
//   - anything at all overnight and at the weekend, for names whose
//     venue is shut but whose broker still prints
//   - bars for holdings Yahoo has no history for at all (CN funds,
//     `.PVT`), which otherwise sit flat across the whole window

import { SB_ANON, EDGE_DATA_URL } from '../app/supabase_config.js';
import { getAppToken } from '../app/auth.js';
import { YtdStore } from './chart_store.js';

/**
 * Read bucket per range, matching each range's bar cadence. Asking for
 * 5-minute rows over a YTD window would return ~60k of them to draw 250
 * points with.
 *
 * 1D / 1W / 1M are their `RANGES[k].interval` in seconds, and
 * `price_snapshots.test.js` derives them that way so a bar-interval
 * change drags the bucket with it. 3M is the odd one out on purpose:
 * its bars are 60m but it SAMPLES on a four-hour grid (see
 * `fourHourSlots`), and it is the sampling cadence a read bucket has to
 * match, not the bar interval.
 * @type {Record<string, number>}
 */
export const RANGE_BUCKET_SECONDS = {
  '1D': 300,
  '1W': 900,
  '1M': 3600,
  '3M': 14400,
  'YTD': 86400,
};

/** Window length per range, in ms. YTD is measured from Jan 1. */
export function rangeStartMs(rangeKey, nowMs = Date.now()) {
  const DAY = 24 * 3600 * 1000;
  if (rangeKey === '1D') return nowMs - DAY;
  if (rangeKey === '1W') return nowMs - 7 * DAY;
  if (rangeKey === '1M') return nowMs - 31 * DAY;
  if (rangeKey === '3M') return nowMs - 93 * DAY;
  return Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1);
}

/**
 * The bar date a recorded sample becomes.
 *
 * Intraday ranges use Yahoo's `YYYY-MM-DDTHH:MM` UTC form so a recorded
 * bar sorts and compares against a fetched one; YTD uses `YYYY-MM-DD`
 * for the same reason. Mixing the two in one series would break
 * `closeOn`, which is a plain string comparison.
 *
 * **The ranges that DRAW these points as bars snap them to the bar
 * grid.** The read bucket already guarantees at most one row per
 * bucket, but it returns that row at the moment it was WRITTEN, not at
 * the bucket's edge — so when the recorder's tick lands near a boundary
 * or misses one, consecutive rows drift off the grid. Measured on live
 * data at a 15-minute bucket: 15, 15, 15, 25, 5, 15, 20, 15, 20 — and
 * Yahoo's bars sit at :00 / :15 / :30 / :45 while those sit at :05 /
 * :25 / :50, so the merged 1W line had visibly uneven spacing on both
 * counts. Flooring to the bucket fixes both at once, and it is also the
 * honest label: Yahoo timestamps a bar by its START and carries the
 * price at its END, which is exactly what the last sample inside a
 * bucket is.
 *
 * **3M deliberately keeps the true instant.** Its chart does not draw
 * these as bars — it SAMPLES them with `closeOn` at the four-hour slot
 * grid, where a bar's date is read as "the price at this moment". A
 * 19:55 observation floored to a 16:00 key would be read as the 16:00
 * price: a four-hour lookahead. YTD keeps the day for the same reason
 * it always has — one bar a day, the day's last print.
 *
 * @param {number} tsMs
 * @param {string} rangeKey
 * @returns {string}
 */
export function recordedBarDate(tsMs, rangeKey) {
  if (rangeKey === 'YTD') return new Date(tsMs).toISOString().slice(0, 10);
  if (rangeKey === '3M')  return new Date(tsMs).toISOString().slice(0, 16);
  const bucketMs = (RANGE_BUCKET_SECONDS[rangeKey] ?? 300) * 1000;
  return new Date(Math.floor(tsMs / bucketMs) * bucketMs).toISOString().slice(0, 16);
}

const cacheKey = (rangeKey) => `pxsnap|${rangeKey}`;

/**
 * Rows already in the chart store for this range, or null. Synchronous —
 * this is what lets the panel paint recorded density on its FIRST render
 * instead of after a round trip.
 *
 * @param {string} rangeKey
 * @returns {Array<{ts: string, prices: Record<string, number>}> | null}
 */
export function readCachedPriceSnapshots(rangeKey) {
  const entry = /** @type {any} */ (YtdStore.get(cacheKey(rangeKey)));
  return Array.isArray(entry?.data) ? entry.data : null;
}

/**
 * Fetch (and cache) the recorded rows for a range.
 *
 * Never caches an empty read over a non-empty one: empty is ambiguous
 * between "nothing recorded yet" and "the request failed", and letting
 * it win would drop the recorded stretch off the chart for a TTL.
 *
 * @param {string} rangeKey
 * @param {number} sinceMs
 * @returns {Promise<Array<{ts: string, prices: Record<string, number>}>>}
 */
export async function refreshPriceSnapshots(rangeKey, sinceMs) {
  const bucket = RANGE_BUCKET_SECONDS[rangeKey] ?? 300;
  try {
    const res = await fetch(
      `${EDGE_DATA_URL}?action=price-snapshots&since=${Math.floor(sinceMs)}&bucket=${bucket}`,
      {
        headers: {
          'apikey': SB_ANON,
          'Authorization': `Bearer ${SB_ANON}`,
          'X-App-Token': getAppToken(),
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return readCachedPriceSnapshots(rangeKey) || [];
    const body = await res.json();
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length > 0 || !readCachedPriceSnapshots(rangeKey)) {
      YtdStore.set(cacheKey(rangeKey), /** @type {any} */ ({ ts: Date.now(), data: rows }));
    }
    return rows.length > 0 ? rows : (readCachedPriceSnapshots(rangeKey) || []);
  } catch {
    return readCachedPriceSnapshots(rangeKey) || [];
  }
}

/**
 * Epoch-ms of the earliest recorded sample, or null when there are none.
 * Everything to the left of it on the chart is a reconstruction and is
 * drawn as one.
 *
 * @param {Array<{ts: string}>} rows
 * @returns {number | null}
 */
export function recordedFromMs(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let min = Infinity;
  for (const r of rows) {
    const t = Date.parse(r?.ts);
    if (Number.isFinite(t) && t < min) min = t;
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * Fold recorded prices into a `{ticker: [{date, close}]}` history map.
 *
 * A recorded bar WINS over a fetched bar at the same timestamp: it is
 * this account's own observation, not a vendor figure that can be
 * revised after the fact. Everything is re-sorted, because a recorded
 * bar can land before, between or after the fetched ones.
 *
 * Returns a NEW map; the input is not mutated (the caller's `hist` is
 * React state and is also what the chart cache holds).
 *
 * @param {Record<string, Array<{date: string, close: number}>>} hist
 * @param {Array<{ts: string, prices: Record<string, number>}>} rows
 * @param {string} rangeKey
 * @param {number} [startMs]  drop recorded bars older than the window
 * @returns {Record<string, Array<{date: string, close: number}>>}
 */
export function mergeRecordedBars(hist, rows, rangeKey, startMs = 0) {
  if (!Array.isArray(rows) || rows.length === 0) return hist;
  /** @type {Record<string, Map<string, number>>} */
  const recorded = {};
  for (const row of rows) {
    const t = Date.parse(row?.ts);
    if (!Number.isFinite(t) || t < startMs) continue;
    const date = recordedBarDate(t, rangeKey);
    for (const [ticker, price] of Object.entries(row?.prices || {})) {
      const px = Number(price);
      if (!Number.isFinite(px) || px <= 0) continue;
      if (!recorded[ticker]) recorded[ticker] = new Map();
      // A later sample in the same bar slot replaces an earlier one —
      // the daily ranges collapse a whole day into one bar, and the
      // day's LAST print is its close.
      recorded[ticker].set(date, px);
    }
  }
  if (Object.keys(recorded).length === 0) return hist;

  /** @type {Record<string, Array<{date: string, close: number}>>} */
  const out = { ...hist };
  for (const [ticker, byDate] of Object.entries(recorded)) {
    const base = Array.isArray(hist?.[ticker]) ? hist[ticker] : [];
    /** @type {Map<string, any>} */
    const merged = new Map();
    for (const bar of base) {
      if (bar && typeof bar.date === 'string') merged.set(bar.date, bar);
    }
    for (const [date, close] of byDate) merged.set(date, { date, close });
    out[ticker] = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}
