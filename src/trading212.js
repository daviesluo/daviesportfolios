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
 * Executed-fill history, oldest first, as
 * `[{ ticker, executed_at, side, shares, price, account }]`.
 *
 * This is the one thing `/equity/positions` cannot tell us: it reports a
 * POSITION — quantity and average price — with no dates, which is why
 * the synced tickers have only ever carried a single synthetic lot whose
 * date was a guess. Served from `t212_orders`, which the backfill fills
 * a page at a time; empty until that has run.
 *
 * @returns {Promise<Array<{ticker: string|null, executed_at: string, side: string, shares: number, price: number, account: string}>>}
 */
let ordersCache = /** @type {{ts: number, rows: any[]} | null} */ (null);
// Executed history is immutable — a fill from 2024 is never going to
// change — so this only needs re-reading often enough to notice a NEW
// fill. Ten minutes keeps it off the 30-second refresh tick entirely.
const ORDERS_TTL_MS = 10 * 60 * 1000;

export async function fetchTrading212Orders() {
  if (ordersCache && Date.now() - ordersCache.ts < ORDERS_TTL_MS) return ordersCache.rows;
  try {
    const res = await fetch(`${EDGE_TRADING212_URL}?action=orders`, {
      method: 'GET',
      headers: {
        'apikey': SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
        'X-App-Token': getAppToken(),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return ordersCache?.rows || [];
    const body = await res.json();
    const rows = Array.isArray(body?.orders) ? body.orders : [];
    // Never cache an empty read over a good one: empty is ambiguous
    // between "the backfill hasn't run" and "the request failed", and
    // caching it would drop every synced ticker back to its synthetic
    // lot for ten minutes.
    if (rows.length > 0 || !ordersCache) ordersCache = { ts: Date.now(), rows };
    return ordersCache.rows;
  } catch {
    return ordersCache?.rows || [];
  }
}

/** Drop the cached history — used after a backfill page lands. */
export function clearTrading212OrdersCache() {
  ordersCache = null;
}

/**
 * Advance the order-history backfill by one page per account.
 *
 * One page per call because the history endpoint is rate limited to a
 * handful of requests a minute — the caller keeps going until
 * `complete` comes back true. Admin only; a 403 with a `403` status on
 * an account means the API key authenticates but lacks T212's History
 * scope, which no amount of retrying will fix.
 *
 * @returns {Promise<{accounts: any[], complete: boolean} | null>}
 */
export async function syncTrading212Orders() {
  try {
    const res = await fetch(`${EDGE_TRADING212_URL}?action=orders-sync`, {
      method: 'GET',
      headers: {
        'apikey': SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
        'X-App-Token': getAppToken(),
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    clearTrading212OrdersCache();
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Rebuild one ticker's lot ledger from its executed fills.
 *
 * Returns `{ lots, sells }` in the shape the rest of the app already
 * uses, or null when there is nothing to rebuild from — the caller then
 * keeps whatever it had rather than replacing real data with an empty
 * ledger.
 *
 * Fills for the SAME ticker across both T212 accounts are merged: the
 * board has one row per ticker, and which account a share sits in isn't
 * something the ledger models. Same-day fills are kept as separate lots
 * rather than averaged — the cost basis is identical either way, and
 * keeping them means a partial sale can be reconciled against what
 * actually happened.
 *
 * @param {Array<{ticker?: string|null, executed_at?: string, side?: string, shares?: any, price?: any}>} orders
 * @param {string} ticker
 */
export function lotsFromOrders(orders, ticker) {
  if (!Array.isArray(orders) || !ticker) return null;
  const lots = [];
  const sells = [];
  for (const o of orders) {
    if (!o || o.ticker !== ticker) continue;
    const shares = Number(o.shares);
    const price = Number(o.price);
    const date = String(o.executed_at || '').slice(0, 10);
    if (!date || !isFinite(shares) || shares <= 0 || !isFinite(price) || price <= 0) continue;
    if (o.side === 'sell') sells.push({ date, shares, price });
    else lots.push({ date, shares, cost: price });
  }
  if (lots.length === 0) return null;
  lots.sort((a, b) => a.date.localeCompare(b.date));
  sells.sort((a, b) => a.date.localeCompare(b.date));
  return { lots, sells };
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
 * @param {Array<any> | null | undefined} [orders]  executed fills from fetchTrading212Orders
 * @returns {Record<string, any>}
 */
export function applyTrading212(holdings, t212Holdings, prices, today, orders) {
  if (!t212Holdings || !holdings) return holdings;
  const date = today || new Date().toISOString().slice(0, 10);
  for (const [t, row] of Object.entries(t212Holdings)) {
    if (!holdings[t]) continue;
    // Keep the EARLIEST date the holding already carried rather than
    // re-stamping today's. The broker reports a position, not a purchase
    // history, so the single synthetic lot can only ever be an
    // approximation — but re-dating it on every sync made the position
    // read as bought today, every day. Anything reconstructing the past
    // from the ledger (the Investment Performance chart's derived half,
    // and the net-deposit figure the sampler records) then saw the money
    // arriving this morning and drew the deposit line starting from
    // nothing. Today's date is only used the first time, when there is
    // genuinely nothing better to go on.
    const prior = (Array.isArray(holdings[t].lots) ? holdings[t].lots : [])
      .map(l => (typeof l?.date === 'string' ? l.date.slice(0, 10) : ''))
      .filter(Boolean)
      .sort()[0];
    // The real purchase history, when the order backfill has reached
    // this ticker. It supersedes the synthetic lot outright: every buy
    // on its own date at its own price is what the ledger was always
    // approximating, and it's what anything reconstructing the past
    // needs. Falls back to the single synthetic lot when there are no
    // fills for this ticker — an unfinished backfill must not empty a
    // position's ledger.
    const real = lotsFromOrders(orders || [], t);
    const merged = real
      ? { ...holdings[t], lots: real.lots, sells: real.sells, shares: row.shares, cost: row.cost }
      : {
          ...holdings[t],
          lots: [{ date: prior || date, shares: row.shares, cost: row.cost }],
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
