// Investment Performance time series — the portfolio's USD value and the
// net amount deposited into it, sampled every 5 minutes.
//
// Both numbers are derivable from the lot/sell ledger (see
// `investmentPointAt` in ytd.js), and the chart still derives everything
// from before the first stored sample. Recording them is about the
// tickers you no longer hold: a sold-out position leaves the board and
// the app stops fetching its price history, so a truthful past value
// would otherwise mean re-fetching history for every symbol ever owned.
// A stored sample also pins the number that was actually on screen,
// rather than a later recomputation of it.
//
// Storage goes through the `data` Edge Function (service-role key) —
// `portfolio_snapshots` is RLS-denied, so the function is the only path.

import { EDGE_DATA_URL, SB_ANON } from './supabase_config.js';
import { getAppToken } from './auth.js';

/** Sampling cadence. Also the bucket the timestamp is floored to. */
export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Floor a timestamp to its 5-minute bucket.
 *
 * The bucket is the table's primary key, which is what makes writing
 * idempotent: a phone and a laptop both sampling at 14:32 land on the
 * same 14:30 row and upsert over each other instead of stacking two
 * near-identical points, and a retry after a flaky write can't
 * double-insert. Exported for tests.
 */
export function snapshotBucket(ms, intervalMs = SNAPSHOT_INTERVAL_MS) {
  return Math.floor(ms / intervalMs) * intervalMs;
}

function headers() {
  return {
    Authorization: `Bearer ${SB_ANON}`,
    apikey: SB_ANON,
    'X-App-Token': getAppToken(),
    'Content-Type': 'application/json',
  };
}

/**
 * Record one sample. Fire-and-forget by design — this is a background
 * observation of the board, never something the user is waiting on, so a
 * failure must not surface as an error or retry-storm. The next tick is
 * five minutes away and will carry an equally good number.
 *
 * @param {number} valueUsd   portfolio market value (cash included)
 * @param {number} depositUsd cumulative buys − sale proceeds + cash
 * @param {number} [nowMs]
 * @returns {Promise<boolean>} true when the row landed
 */
export async function saveSnapshot(valueUsd, depositUsd, nowMs = Date.now()) {
  if (!isFinite(valueUsd) || !isFinite(depositUsd)) return false;
  // A zero-value board means the portfolio hasn't loaded yet — recording
  // it would punch a hole in the chart at exactly the moment the user
  // opened the app.
  if (!(valueUsd > 0)) return false;
  try {
    const res = await fetch(`${EDGE_DATA_URL}?action=snapshot`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        ts: snapshotBucket(nowMs),
        valueUsd,
        depositUsd,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Stored samples from `sinceMs` to now, oldest first, as
 * `[{ ts, value, deposit }]` with `ts` in epoch ms. Empty on any
 * failure — the chart falls back to deriving the window from the
 * ledger, so an outage costs resolution, not the chart.
 *
 * @param {number} sinceMs
 */
export async function loadSnapshots(sinceMs) {
  if (!isFinite(sinceMs) || sinceMs <= 0) return [];
  try {
    const res = await fetch(`${EDGE_DATA_URL}?action=snapshots&since=${Math.floor(sinceMs)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const rows = Array.isArray(body?.snapshots) ? body.snapshots : [];
    // `Number(null)` is 0 and `isFinite(0)` is true, so coercing first
    // would turn a null column into a real-looking zero and punch a hole
    // in the chart. Require an actual number before converting.
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN);
    return rows
      .map((r) => ({
        ts: Date.parse(r?.ts),
        value: num(r?.value_usd),
        deposit: num(r?.deposit_usd),
      }))
      .filter((r) => isFinite(r.ts) && isFinite(r.value) && isFinite(r.deposit))
      .sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}
