// Client-side Trading 212 auto-sync helper.
//
// Calls the `trading212` Edge Function on every doRefresh tick and
// returns the server-cached portfolio snapshot for the allow-listed
// tickers (currently VUAG.L / SEGM.L — the user DCAs into those
// daily on T212, which would otherwise require typing every small
// buy into EditTickerModal). The Edge Function does the actual
// rate-limited upstream call to T212 with 60 s caching (T212 limits
// `/equity/portfolio` at 1 req / 30 s; 60 s gives a safety margin),
// so this helper is safe to call on every visitor's auto-refresh
// without punching through the rate limit.
//
// Best-effort: returns `null` on network error or upstream miss so
// the caller (doRefresh) can fall through to the existing local
// lots without breaking the refresh path. The user can still edit
// lots manually via EditTickerModal — the next T212 sync will
// just overwrite the manual edit on the next tick, which is the
// stated behaviour ("永远也可以手动编辑，api拉到最新数据了再覆盖就行").

import { EDGE_TRADING212_URL } from './supabase_config.js';

/**
 * Fetch the current T212-mirrored holdings. Returns null on any
 * failure (network, non-2xx, malformed JSON, T212 disabled). `cost`
 * is per-share AC (the same convention as `lot.cost` / `h.cost`
 * elsewhere in the app — multiplied by shares to get total cost).
 *
 * @returns {Promise<Record<string, { shares: number, cost: number }> | null>}
 */
export async function fetchTrading212Holdings() {
  try {
    const res = await fetch(EDGE_TRADING212_URL, { method: 'GET' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object') return null;
    if (json.source === 'disabled') return null;
    const h = json.holdings;
    if (!h || typeof h !== 'object') return null;
    const out = /** @type {Record<string, { shares: number, cost: number }>} */ ({});
    for (const [t, row] of Object.entries(h)) {
      if (!row || typeof row !== 'object') continue;
      const r = /** @type {{shares?: unknown, cost?: unknown}} */ (row);
      const shares = Number(r.shares);
      const cost   = Number(r.cost);
      if (!isFinite(shares) || shares <= 0) continue;
      if (!isFinite(cost)   || cost   < 0)  continue;
      out[t] = { shares, cost };
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
 * Pure-ish (Date.now-dependent for the date stamp), exported so the
 * vitest pin can assert the merge shape without spinning up React.
 *
 * @param {Record<string, any>} holdings           live portfolio map (mutated)
 * @param {Record<string, { shares: number, cost: number }> | null} t212  result of fetchTrading212Holdings
 * @param {string} [today]                          ISO date (YYYY-MM-DD) — defaults to today UTC
 * @returns {Record<string, any>}
 */
export function applyTrading212(holdings, t212, today) {
  if (!t212 || !holdings) return holdings;
  const date = today || new Date().toISOString().slice(0, 10);
  for (const [t, row] of Object.entries(t212)) {
    if (!holdings[t]) continue;
    holdings[t] = {
      ...holdings[t],
      lots: [{ date, shares: row.shares, cost: row.cost }],
      shares: row.shares,
      cost: row.cost,
    };
  }
  return holdings;
}
