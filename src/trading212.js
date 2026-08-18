// Client-side Trading 212 auto-sync helper.
//
// Calls the `trading212` Edge Function on every doRefresh tick and
// returns two things from the server-cached snapshot:
//   - `holdings`: shares/cost for the auto-sync allow-list (VUAA.L /
//     SAEM.L — USD-denominated UCITS ETFs on LSE the user DCAs into
//     via T212's cashback + Spare-Change auto-invest, both settling in
//     USD; previously VUAG.L / SEGM.L). Without it the user would have
//     to type every small buy into EditTickerModal.
//   - `prices`: the broker's live `currentPrice` (USD) for EVERY
//     recognised T212 holding. Two uses: (a) the regular-session
//     `lastPrice` for the allow-list LSE ETFs (see applyTrading212 —
//     Yahoo's free LSE feed lags ~15-20 min at the open, so the broker's
//     own quote is fresher and already in the right currency), and (b)
//     overnight ("night market") quotes for US equities the user also
//     holds (see applyTrading212NightPrice).
//
// The Edge Function does the rate-limited upstream call with 30 s
// caching + an atomic Postgres claim that lets only one worker per
// window hit T212 regardless of how many devices are refreshing, so
// this helper is safe to call on every visitor's auto-refresh.
//
// Best-effort: returns `null` on network error / upstream miss so the
// caller (doRefresh) falls through to the existing local lots + Yahoo
// price without breaking the refresh path. The user can still edit
// lots manually via EditTickerModal — the next T212 sync overwrites
// the manual edit on the next tick ("永远也可以手动编辑，api拉到最新
// 数据了再覆盖就行").

import { EDGE_TRADING212_URL, SB_ANON } from './supabase_config.js';
import { getAppToken } from './auth.js';
import { hasOvernightSession } from './ticker_class.js';

/**
 * Fetch the current T212 snapshot. Returns null on any failure
 * (network, non-2xx, malformed JSON, T212 disabled), otherwise
 * `{ holdings, prices }`:
 *   - `holdings`: `{ ticker: { shares, cost } }` for the allow-list.
 *     `cost` is per-share AC (same convention as `lot.cost` / `h.cost`
 *     — multiplied by shares to get total cost).
 *   - `prices`: `{ ticker: currentPrice }` (USD) for every recognised
 *     T212 holding — the broker's live quote, used for overnight pricing.
 *
 * Sends the same `x-app-token` the `data` function uses — the T212
 * function 401s anonymous callers so holdings aren't leaked via the
 * function URL. Both admin and ro tokens are accepted.
 *
 * @returns {Promise<{ holdings: Record<string, { shares: number, cost: number }>, prices: Record<string, number> } | null>}
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

    const holdings = /** @type {Record<string, { shares: number, cost: number }>} */ ({});
    const h = json.holdings;
    if (h && typeof h === 'object') {
      for (const [t, row] of Object.entries(h)) {
        if (!row || typeof row !== 'object') continue;
        const r = /** @type {{shares?: unknown, cost?: unknown}} */ (row);
        const shares = Number(r.shares);
        const cost   = Number(r.cost);
        if (!isFinite(shares) || shares <= 0) continue;
        if (!isFinite(cost)   || cost   < 0)  continue;
        holdings[t] = { shares, cost };
      }
    }

    const prices = /** @type {Record<string, number>} */ ({});
    const p = json.prices;
    if (p && typeof p === 'object') {
      for (const [t, v] of Object.entries(p)) {
        const price = Number(v);
        if (isFinite(price) && price > 0) prices[t] = price;
      }
    }

    return { holdings, prices };
  } catch {
    return null;
  }
}

/**
 * Merge the T212 allow-list holdings into an existing `holdings` object:
 * replace each matching ticker's lots with a single synthetic lot dated
 * today, set shares/cost, AND — when a live T212 `currentPrice` is passed
 * for that ticker — use it as `lastPrice` too (recomputing `dayPct` against
 * the stored prevClose and pinning currency USD). The allow-list ETFs
 * (VUAA.L / SAEM.L) are USD-settling and Yahoo's free LSE feed lags
 * ~15-20 min at the open, so the broker's own quote is both fresher and
 * already in USD — the user wants the price to update in lockstep with the
 * shares on every refresh instead of sitting on a stale Yahoo print.
 * (US-equity OVERNIGHT pricing stays with applyTrading212NightPrice, gated
 * on the overnight window; this is the regular-session price for the LSE
 * ETFs.) Mutates `holdings` in place and returns it.
 *
 * Pure-ish (Date.now-dependent for the date stamp), exported so the
 * vitest pin can assert the merge shape without spinning up React.
 *
 * @param {Record<string, any>} holdings  live portfolio map (mutated)
 * @param {Record<string, { shares: number, cost: number }> | null | undefined} t212Holdings  the `holdings` map from fetchTrading212Holdings
 * @param {Record<string, number> | null | undefined} [prices]  the `prices` map (broker currentPrice, USD)
 * @param {string} [today]  ISO date (YYYY-MM-DD) — defaults to today UTC
 * @returns {Record<string, any>}
 */
export function applyTrading212(holdings, t212Holdings, prices, today) {
  if (!t212Holdings || !holdings) return holdings;
  const date = today || new Date().toISOString().slice(0, 10);
  for (const [t, row] of Object.entries(t212Holdings)) {
    if (!holdings[t]) continue;
    const merged = {
      ...holdings[t],
      lots: [{ date, shares: row.shares, cost: row.cost }],
      shares: row.shares,
      cost: row.cost,
    };
    // Broker's live quote for the allow-list ETF (USD). Use it as the
    // regular-session lastPrice so these LSE names don't sit on Yahoo's
    // ~15-20 min-delayed feed. dayPct is recomputed against the stored
    // prevClose (also USD, from the Yahoo merge that ran just before) so
    // the per-ticker tile % agrees with the price; currency is pinned USD
    // (the allow-list is USD-settling). Falls back to the Yahoo lastPrice
    // when T212 has no live quote for the ticker.
    const px = prices && prices[t];
    if (typeof px === 'number' && px > 0) {
      merged.lastPrice = px;
      merged.currency = 'USD';
      const pc = merged.prevClose;
      if (typeof pc === 'number' && pc > 0) merged.dayPct = ((px - pc) / pc) * 100;
    }
    holdings[t] = merged;
  }
  return holdings;
}

/**
 * Overlay T212's live `currentPrice` as the OVERNIGHT ("night market")
 * quote for US equities the user also holds. Only runs when `active`
 * (the caller passes `extendedHours && usMarketPhase() === 'overnight'`)
 * — during regular / pre-market / after-hours the original Yahoo logic
 * is left untouched, per the user's spec.
 *
 * For each ticker present in BOTH the portfolio and the T212 `prices`
 * map that has an overnight session (`hasOvernightSession`), it writes
 * the T212 price into `extPrice` (+ marks `extPriceTrusted` so
 * metrics.js uses it under the ext toggle) and recomputes `extDayPct`
 * against today's RTH close (`lastPrice`, the baseline computeMetrics
 * uses for an extended-hours move). Tickers with no overnight session
 * (the LSE ETFs, CN funds, crypto, AND OTC ADRs like SFTBY) are
 * skipped — they have no live overnight print, so leaving them on
 * Yahoo avoids surfacing a stale close as a fake overnight quote.
 * Mutates `holdings` in place.
 *
 * Call AFTER the Yahoo merge in doRefresh so `lastPrice` (today's RTH
 * close) is populated for the baseline.
 *
 * @param {Record<string, any>} holdings  live portfolio map (mutated)
 * @param {Record<string, number> | null | undefined} prices  the `prices` map from fetchTrading212Holdings
 * @param {boolean} active  true only during the overnight window with ext toggle on
 * @returns {Record<string, any>}
 */
export function applyTrading212NightPrice(holdings, prices, active) {
  if (!active || !prices || !holdings) return holdings;
  for (const [t, price] of Object.entries(prices)) {
    if (!holdings[t]) continue;          // portfolio ∩ T212 only
    if (!hasOvernightSession(t)) continue; // US equities WITH a night session (LSE ETFs + OTC ADRs like SFTBY excluded)
    if (typeof price !== 'number' || price <= 0) continue;
    const rthClose = holdings[t].lastPrice; // today's regular close, the ext baseline
    holdings[t] = {
      ...holdings[t],
      extPrice: price,
      extPriceTrusted: true,             // T212 overnight quote is a real AH-equivalent print
      extDayPct: (typeof rthClose === 'number' && rthClose > 0)
        ? ((price - rthClose) / rthClose) * 100
        : null,
    };
  }
  return holdings;
}
