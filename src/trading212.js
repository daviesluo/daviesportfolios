// Client-side Trading 212 auto-sync helper.
//
// Calls the `trading212` Edge Function on every doRefresh tick and
// returns two things from the server-cached snapshot:
//   - `holdings`: shares/cost for the auto-sync allow-list (VUAA.L /
//     SAEM.L — USD-denominated UCITS ETFs on LSE the user DCAs into
//     via T212's cashback + Spare-Change auto-invest, both settling in
//     USD; previously VUAG.L / SEGM.L). Without it the user would have
//     to type every small buy into EditTickerModal.
//   - `prices`: the broker's live `currentPrice` for EVERY recognised
//     T212 holding, used as overnight ("night market") quotes for US
//     equities the user also holds (see applyTrading212NightPrice).
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
 * Merge the T212 allow-list holdings into an existing `holdings` object
 * by replacing each matching ticker's lots with a single synthetic lot
 * dated today + setting shares/cost. Mutates `holdings` in place and
 * returns it. Only shares/cost/lots — never touches price (that's the
 * job of applyTrading212NightPrice, gated on the overnight window).
 *
 * Pure-ish (Date.now-dependent for the date stamp), exported so the
 * vitest pin can assert the merge shape without spinning up React.
 *
 * @param {Record<string, any>} holdings  live portfolio map (mutated)
 * @param {Record<string, { shares: number, cost: number }> | null | undefined} t212Holdings  the `holdings` map from fetchTrading212Holdings
 * @param {string} [today]  ISO date (YYYY-MM-DD) — defaults to today UTC
 * @returns {Record<string, any>}
 */
export function applyTrading212(holdings, t212Holdings, today) {
  if (!t212Holdings || !holdings) return holdings;
  const date = today || new Date().toISOString().slice(0, 10);
  for (const [t, row] of Object.entries(t212Holdings)) {
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

/**
 * SFTBY-only override: replace Yahoo's `lastPrice` / `extPrice` with
 * T212's `currentPrice` at every refresh. Background: Yahoo's
 * `regularMarketPrice` for SFTBY (an OTC pink-sheet ADR with no
 * closing auction) stale-sticks at the day's OPEN price after the
 * regular session ends — user verified that Yahoo's own quote page
 * stops updating at 20:58 BST. The intraday chart got patched via
 * `trimBogusCloseBar` in indicators.js, but the live-price scoreboard
 * / position cards / heatmap / modal header all read
 * `holding.lastPrice`, which still came straight from Yahoo. This
 * function lifts T212 (which DOES freeze at the real last trade and
 * stays there) to the single source of truth for SFTBY's price.
 *
 * SFTBY has no real after-hours session — extPrice is pinned to
 * lastPrice so `extDayPct` is 0 % and `extPriceTrusted` is true, which
 * keeps metrics.js / extPriceLooksReal from falling back to a stale
 * Yahoo value. Other tickers are untouched.
 *
 * `serverPrevClose`: when provided (the `sftby-fetch` Edge Function
 * returns it on every doRefresh) it overrides Yahoo's
 * `regularMarketPreviousClose` so the "since previous close" pct is
 * computed against yesterday's real T212-frozen close rather than
 * Yahoo's possibly-stale snap-to-open figure. Falls back to the
 * existing `h.prevClose` (Yahoo) when null/undefined/non-positive.
 *
 * Mutates `holdings` in place.
 *
 * @param {Record<string, any>} holdings  live portfolio map (mutated)
 * @param {Record<string, number> | null | undefined} prices  T212 currentPrice map
 * @param {number | null | undefined} [serverPrevClose]  yesterday's last-bucket close
 * @returns {Record<string, any>}
 */
export function applyTrading212SftbyPrice(holdings, prices, serverPrevClose) {
  if (!holdings || !prices) return holdings;
  const t212Price = prices['SFTBY'];
  if (typeof t212Price !== 'number' || !isFinite(t212Price) || t212Price <= 0) return holdings;
  if (!holdings['SFTBY']) return holdings;
  const h = holdings['SFTBY'];
  const serverPrev = (typeof serverPrevClose === 'number' && isFinite(serverPrevClose) && serverPrevClose > 0)
    ? serverPrevClose
    : null;
  const prevClose = serverPrev
    ?? ((typeof h.prevClose === 'number' && h.prevClose > 0) ? h.prevClose : t212Price);
  const dayPct = ((t212Price - prevClose) / prevClose) * 100;
  holdings['SFTBY'] = {
    ...h,
    lastPrice: t212Price,
    extPrice: t212Price,
    prevClose,
    dayPct,
    extDayPct: 0,
    extPriceTrusted: true,
  };
  return holdings;
}
