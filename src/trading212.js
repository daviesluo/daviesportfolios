// Client-side Trading 212 auto-sync helper.
//
// Calls the `trading212` Edge Function on every doRefresh tick and
// returns the server-cached portfolio snapshot for the allow-listed
// tickers (currently VUAA.L / SAEM.L — USD-denominated UCITS ETFs
// on LSE that the user DCAs into via T212's cashback + Spare-Change
// auto-invest, both of which settle in USD; previously VUAG.L /
// SEGM.L when the auto-invest was assumed GBP. Without the auto-sync
// the user would have to type every small buy into EditTickerModal).
// The Edge Function does the actual
// rate-limited upstream call to T212 with 120 s caching (4× T212's
// 1-req-per-30-s window) + an atomic Postgres claim that lets only
// one worker per window call live T212 regardless of how many
// devices are refreshing, so this helper is safe to call on every
// visitor's auto-refresh without punching through the rate limit.
//
// Best-effort: returns `null` on network error or upstream miss so
// the caller (doRefresh) can fall through to the existing local
// lots without breaking the refresh path. The user can still edit
// lots manually via EditTickerModal — the next T212 sync will
// just overwrite the manual edit on the next tick, which is the
// stated behaviour ("永远也可以手动编辑，api拉到最新数据了再覆盖就行").

import { EDGE_TRADING212_URL, SB_ANON } from './supabase_config.js';
import { getAppToken } from './auth.js';

/**
 * Fetch the current T212-mirrored holdings. Returns null on any
 * failure (network, non-2xx, malformed JSON, T212 disabled). `cost`
 * is per-share AC (the same convention as `lot.cost` / `h.cost`
 * elsewhere in the app — multiplied by shares to get total cost).
 * `price` (optional) is T212's live `currentPrice` for the ticker in
 * the same USD settle currency — present only when the Edge Function
 * got a positive quote; absent → caller keeps the Yahoo price.
 *
 * Sends the same `x-app-token` the `data` function uses — the T212
 * function 401s anonymous callers so holdings aren't leaked via
 * the function URL. Both admin and ro tokens are accepted.
 *
 * @returns {Promise<Record<string, { shares: number, cost: number, price?: number }> | null>}
 */
export async function fetchTrading212Holdings() {
  try {
    const res = await fetch(EDGE_TRADING212_URL, {
      method: 'GET',
      headers: {
        'apikey': SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
        'X-App-Token': getAppToken(),
      },
      // 10s is comfortable headroom over the function's own internal
      // timeouts (5s PostgREST + 8s T212 upstream); without it a
      // hung Edge cold-start would freeze doRefresh indefinitely.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object') return null;
    if (json.source === 'disabled') return null;
    const h = json.holdings;
    if (!h || typeof h !== 'object') return null;
    const out = /** @type {Record<string, { shares: number, cost: number, price?: number }>} */ ({});
    for (const [t, row] of Object.entries(h)) {
      if (!row || typeof row !== 'object') continue;
      const r = /** @type {{shares?: unknown, cost?: unknown, price?: unknown}} */ (row);
      const shares = Number(r.shares);
      const cost   = Number(r.cost);
      if (!isFinite(shares) || shares <= 0) continue;
      if (!isFinite(cost)   || cost   < 0)  continue;
      /** @type {{ shares: number, cost: number, price?: number }} */
      const entry = { shares, cost };
      const price = Number(r.price);
      if (isFinite(price) && price > 0) entry.price = price;
      out[t] = entry;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Merge a T212 holdings map into an existing `holdings` object by
 * replacing each matching ticker's lots with a single synthetic lot
 * dated today. Mutates `holdings` in place and returns it.
 *
 * When a T212 row carries a `price` (the broker's live `currentPrice`)
 * it also overrides the ticker's `lastPrice` with it and recomputes
 * `dayPct` against the holding's existing `prevClose` (Yahoo's last
 * close — T212 doesn't report a previous close). Call this AFTER the
 * Yahoo price merge in doRefresh so `prevClose` is already populated.
 * No `price` on the row → lastPrice / dayPct left untouched (Yahoo
 * stays the source for that ticker).
 *
 * Pure-ish (Date.now-dependent for the date stamp), exported so the
 * vitest pin can assert the merge shape without spinning up React.
 *
 * @param {Record<string, any>} holdings           live portfolio map (mutated)
 * @param {Record<string, { shares: number, cost: number, price?: number }> | null} t212  result of fetchTrading212Holdings
 * @param {string} [today]                          ISO date (YYYY-MM-DD) — defaults to today UTC
 * @returns {Record<string, any>}
 */
export function applyTrading212(holdings, t212, today) {
  if (!t212 || !holdings) return holdings;
  const date = today || new Date().toISOString().slice(0, 10);
  for (const [t, row] of Object.entries(t212)) {
    if (!holdings[t]) continue;
    const next = {
      ...holdings[t],
      lots: [{ date, shares: row.shares, cost: row.cost }],
      shares: row.shares,
      cost: row.cost,
    };
    if (typeof row.price === 'number' && row.price > 0) {
      next.lastPrice = row.price;
      const prevClose = holdings[t].prevClose;
      if (typeof prevClose === 'number' && prevClose > 0) {
        next.dayPct = ((row.price - prevClose) / prevClose) * 100;
      }
    }
    holdings[t] = next;
  }
  return holdings;
}
