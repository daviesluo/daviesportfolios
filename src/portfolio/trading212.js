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

import { EDGE_TRADING212_URL, SB_ANON } from '../app/supabase_config.js';
import { getAppToken } from '../app/auth.js';
import { hasOvernightSession } from '../prices/ticker_class.js';

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
 * @returns {Promise<{
 *   holdings: Record<string, {
 *     shares: number,
 *     cost: number,
 *     previousShares?: number,
 *     previousCost?: number,
 *   }>,
 *   prices: Record<string, number>,
 * } | null>}
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

    const holdings = /** @type {Record<string, {
     *   shares: number,
     *   cost: number,
     *   previousShares?: number,
     *   previousCost?: number,
     * }>} */ ({});
    const h = json.holdings;
    if (h && typeof h === 'object') {
      for (const [t, row] of Object.entries(h)) {
        if (!row || typeof row !== 'object') continue;
        const r = /** @type {{
         *   shares?: unknown,
         *   cost?: unknown,
         *   previousShares?: unknown,
         *   previousCost?: unknown,
         * }} */ (row);
        const shares = Number(r.shares);
        const cost   = Number(r.cost);
        if (!isFinite(shares) || shares < 0) continue;
        if (!isFinite(cost)   || cost   < 0)  continue;
        const previousShares = Number(r.previousShares);
        const previousCost = Number(r.previousCost);
        holdings[t] = {
          shares,
          cost,
          ...(isFinite(previousShares) && previousShares >= 0 ? { previousShares } : {}),
          ...(isFinite(previousCost) && previousCost >= 0 ? { previousCost } : {}),
        };
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
 * @returns {Promise<{
 *   rows: Array<{ticker: string|null, executed_at: string, side: string, shares: number, price: number, account: string}>,
 *   complete: boolean,
 * }>}
 */
let ordersCache = /** @type {{ts: number, rows: any[], complete: boolean} | null} */ (null);
// Executed history is immutable — a fill from 2024 is never going to
// change — so this only needs re-reading often enough to notice a NEW
// one. It reads our own `t212_orders` table, not Trading 212, so the
// cost is one Edge call; 60 s keeps it off most of the 30-second refresh
// ticks while letting a trade reach the board within a minute of the
// backfill storing it. `clearTrading212OrdersCache()` shortcuts even
// that whenever a sync page lands.
const ORDERS_TTL_MS = 60 * 1000;

export async function fetchTrading212Orders() {
  if (ordersCache && Date.now() - ordersCache.ts < ORDERS_TTL_MS) {
    return { rows: ordersCache.rows, complete: ordersCache.complete };
  }
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
    if (!res.ok) {
      return { rows: ordersCache?.rows || [], complete: ordersCache?.complete === true };
    }
    const body = await res.json();
    const rows = Array.isArray(body?.orders) ? body.orders : [];
    const complete = body?.complete === true;
    // Never cache an empty read over a good one: empty is ambiguous
    // between "the backfill hasn't run" and "the request failed", and
    // caching it would drop every synced ticker back to its synthetic
    // lot for ten minutes.
    ordersCache = {
      ts: Date.now(),
      rows: rows.length > 0 || !ordersCache ? rows : ordersCache.rows,
      // A successful response is authoritative in BOTH directions. A
      // reset migration must be able to downgrade a cached `true`.
      complete,
    };
    return { rows: ordersCache.rows, complete: ordersCache.complete };
  } catch {
    return { rows: ordersCache?.rows || [], complete: ordersCache?.complete === true };
  }
}

/** Drop the cached history — used after a backfill page lands. */
export function clearTrading212OrdersCache() {
  ordersCache = null;
}

/**
 * Advance the executed-order backfill by one page.
 *
 * Deposited uses filled quantity × price × timestamp, not cash/card
 * movements, so the client deliberately spends the rate-limited budget
 * on orders only. Admin only.
 *
 * @returns {Promise<{
 *   accounts: any[],
 *   complete: boolean,
 *   ordersComplete?: boolean,
 *   stream?: string,
 *   scopeDenied?: boolean,
 * } | null>}
 */
export async function syncTrading212History() {
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
    const raw = String(o.executed_at || '');
    const date = raw.slice(0, 10);
    if (!date || !isFinite(shares) || shares <= 0 || !isFinite(price) || price <= 0) continue;
    // Keep the moment as well as the day. A lot's `date` is YYYY-MM-DD
    // by contract — every comparison in the chart maths depends on that
    // — so the time goes in `ts`, the same epoch-ms field the editor
    // stamps, which the transaction history already sorts same-day rows
    // by. Without it a day's fills sit in whatever order the two
    // accounts happened to merge in: ORCL bought nineteen times on one
    // day and they read as an unordered heap.
    const ms = Date.parse(raw);
    const ts = Number.isFinite(ms) ? { ts: ms } : {};
    if (o.side === 'sell') sells.push({ date, shares, price, ...ts });
    else lots.push({ date, shares, cost: price, ...ts });
  }
  if (lots.length === 0 && sells.length === 0) return null;
  const chronological = (/** @type {any} */ a, /** @type {any} */ b) =>
    a.date.localeCompare(b.date) || ((a.ts ?? 0) - (b.ts ?? 0));
  lots.sort(chronological);
  sells.sort(chronological);
  return { lots, sells };
}

/**
 * Merge the T212 allow-list positions into an existing `holdings` object.
 *
 * The board can contain the SAME ticker at T212 and another broker. The
 * first implementation treated the T212 slice as the whole position:
 * it overwrote shares/cost/lots/sells, which both shrank PORTFOLIO and
 * destroyed the other broker's ledger. Keep the user ledger untouched.
 * `t212Shares` / `t212Cost` remember which slice came from T212 so later
 * refreshes apply only that slice's delta.
 *
 * When a live T212 `currentPrice` is passed for the ticker, use it as
 * `lastPrice` too (recomputing `dayPct` against the stored prevClose and
 * pinning currency USD). The allow-list ETFs
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
 * @param {Record<string, {
 *   shares: number,
 *   cost: number,
 *   previousShares?: number,
 *   previousCost?: number,
 * }> | null | undefined} t212Holdings  the `holdings` map from fetchTrading212Holdings
 * @param {Record<string, number> | null | undefined} [prices]  the `prices` map (broker currentPrice, USD)
 * @param {string} [today]  ISO date (YYYY-MM-DD) — defaults to today UTC
 * @param {Array<any> | null | undefined} [orders]  executed fills from fetchTrading212Orders
 * @returns {Record<string, any>}
 */
// The only tickers whose `lastPrice` the broker may overwrite: two
// USD-settling UCITS ETFs on the LSE, where Yahoo's free feed runs
// ~15-20 minutes behind and the broker's own quote is both fresher and
// already in the right currency. Everything else keeps Yahoo's.
const T212_LIVE_PRICE_TICKERS = new Set(['VUAA.L', 'SAEM.L']);

export function applyTrading212(holdings, t212Holdings, prices, today, orders) {
  if (!holdings) return holdings;
  const overlay = t212Holdings && typeof t212Holdings === 'object' ? t212Holdings : {};
  const date = today || new Date().toISOString().slice(0, 10);
  for (const [t, row] of Object.entries(overlay)) {
    if (!holdings[t]) continue;
    const current = holdings[t];
    const parsedShares = Number(current.shares);
    const parsedCost = Number(current.cost);
    const currentShares = isFinite(parsedShares) && parsedShares > 0 ? parsedShares : 0;
    const currentCost = isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : 0;
    const storedT212Shares = Number(current.t212Shares);
    const storedT212Cost = Number(current.t212Cost);
    const priorResponseShares = Number(row.previousShares);
    const priorResponseCost = Number(row.previousCost);
    const oldT212Shares = isFinite(storedT212Shares) && storedT212Shares >= 0
      ? storedT212Shares
      : priorResponseShares;
    const oldT212Cost = isFinite(storedT212Cost) && storedT212Cost >= 0
      ? storedT212Cost
      : priorResponseCost;
    const hasPriorSlice = isFinite(oldT212Shares) && oldT212Shares >= 0
      && isFinite(oldT212Cost) && oldT212Cost >= 0;

    // A board position LARGER than the broker's is another platform's
    // shares, and they are never taken away.
    //
    // This book holds SPCX, RKLB and HOOD at Trading 212 *and*
    // elsewhere: 130 / 160 / 50 on the board against 59 / 148.5 / 20 at
    // the broker. Taking the broker as the whole position on a ticker's
    // first sync — which this briefly did — deleted 71, 11.5 and 30
    // shares respectively. The excess is not stale data to be corrected;
    // it is the rest of the position.
    //
    // Nothing is lost by being conservative here. A holding the board
    // records as sold out (PLTR at 0 against 55 held) still comes back
    // in full, because `max(0, 0 - 55)` is 0 and the broker's slice is
    // the whole of it. From the second sync onward only the tagged
    // slice's DELTA moves, so the other platform's shares ride along
    // untouched forever after.
    const otherShares = hasPriorSlice
      ? Math.max(0, currentShares - oldT212Shares)
      : Math.max(0, currentShares - row.shares);
    let otherCash = 0;
    if (otherShares > 0 && isFinite(currentCost) && currentCost >= 0) {
      const totalCash = Math.max(0, currentShares * currentCost);
      const knownT212Cash = hasPriorSlice
        ? oldT212Shares * oldT212Cost
        : row.shares * row.cost;
      otherCash = Math.max(0, totalCash - knownT212Cash);
      // A legacy weighted average can be too small to subtract the new
      // T212 slice cleanly. Keeping the other shares at the board AC is
      // safer than turning their cost negative.
      if (!(otherCash > 0)) otherCash = otherShares * currentCost;
    }
    const shares = otherShares + row.shares;
    const totalCash = otherCash + row.shares * row.cost;
    const currentLots = Array.isArray(current.lots) ? current.lots : [];
    const currentSells = Array.isArray(current.sells) ? current.sells : [];
    const looksLikeLegacySynthetic = hasPriorSlice
      && currentLots.length === 1
      && currentSells.length === 0
      && Math.abs(Number(currentLots[0]?.shares) - oldT212Shares) <= 1e-6
      && Math.abs(Number(currentLots[0]?.cost) - oldT212Cost) <= 1e-6;
    const preservedLots = looksLikeLegacySynthetic
      ? [{ ...currentLots[0], source: 't212-synthetic' }]
      : currentLots;
    const merged = {
      ...current,
      // Never replace user lots/sells with machine history. T212 orders
      // already live in their own table and are passed separately to
      // the deposit calculation.
      lots: preservedLots.length > 0
        ? preservedLots
        : [{
            date,
            shares,
            cost: shares > 0 ? totalCash / shares : row.cost,
            source: 't212-synthetic',
          }],
      sells: currentSells,
      shares,
      cost: shares > 0 ? totalCash / shares : 0,
      t212Shares: row.shares,
      t212Cost: row.cost,
    };
    if (shares > 0) delete merged.closed;
    else merged.closed = true;
    // Broker's live quote for the allow-list ETF (USD). Use it as the
    // regular-session lastPrice so these LSE names don't sit on Yahoo's
    // ~15-20 min-delayed feed.
    //
    // ONLY those two. The sync used to cover just them, so this ran on
    // exactly the rows it was written for; widening the sync to every
    // reported position widened this with it, and quietly broke the
    // extended-hours board. `applyTrading212NightPrice` measures the
    // overnight move against `lastPrice` as today's regular close — so
    // once the broker's own quote WAS the lastPrice, the overnight
    // overlay compared that quote against itself and every US holding
    // read exactly 0.00 %. Yahoo is live for US equities; there was
    // never a reason to overwrite them here. dayPct is recomputed against the stored
    // prevClose (also USD, from the Yahoo merge that ran just before) so
    // the per-ticker tile % agrees with the price; currency is pinned USD
    // (the allow-list is USD-settling). Falls back to the Yahoo lastPrice
    // when T212 has no live quote for the ticker.
    const px = T212_LIVE_PRICE_TICKERS.has(t) ? (prices && prices[t]) : null;
    if (typeof px === 'number' && px > 0) {
      merged.lastPrice = px;
      merged.currency = 'USD';
      const pc = merged.prevClose;
      if (typeof pc === 'number' && pc > 0) merged.dayPct = ((px - pc) / pc) * 100;
    }
    holdings[t] = merged;
  }
  // `orders` deliberately does not mutate any other holding. Those
  // tickers can combine T212 with Robinhood / a hand-entered broker.
  // Replacing their ledger was the production data-loss bug.
  void orders;
  return holdings;
}

/**
 * Remove closed holdings from every tactics-board slot. Returns the
 * original object when nothing changes.
 *
 * @param {any} portfolio
 */
export function stripClosedFromPositions(portfolio) {
  if (!portfolio?.holdings || !portfolio?.positions) return portfolio;
  const closed = new Set(Object.entries(portfolio.holdings)
    .filter(([, holding]) => holding?.closed === true)
    .map(([ticker]) => ticker));
  let positionsChanged = false;
  let holdingsChanged = false;
  let holdings = portfolio.holdings;
  const positions = Object.fromEntries(
    Object.entries(portfolio.positions).map(([key, position]) => {
      for (const ticker of position.tickers) {
        if (!closed.has(ticker)) continue;
        const holding = holdings[ticker];
        if (holding && holding.t212PositionKey !== key) {
          if (!holdingsChanged) holdings = { ...holdings };
          holdings[ticker] = { ...holding, t212PositionKey: key };
          holdingsChanged = true;
        }
      }
      const tickers = position.tickers.filter((ticker) => !closed.has(ticker));
      const positionChanged = tickers.length !== position.tickers.length;
      if (positionChanged) positionsChanged = true;
      return [key, positionChanged ? { ...position, tickers } : position];
    }),
  );

  const positioned = new Set(
    Object.values(positions).flatMap((position) => position.tickers),
  );
  for (const [ticker, holding] of Object.entries(holdings)) {
    if (holding?.closed || !(Number(holding?.shares) > 0)) continue;
    const key = holding?.t212PositionKey;
    if (!key || !positions[key] || positioned.has(ticker)) continue;
    positions[key] = {
      ...positions[key],
      tickers: [...positions[key].tickers, ticker],
    };
    if (!holdingsChanged) holdings = { ...holdings };
    const restored = { ...holding };
    delete restored.t212PositionKey;
    holdings[ticker] = restored;
    holdingsChanged = true;
    positioned.add(ticker);
    positionsChanged = true;
  }
  return positionsChanged || holdingsChanged
    ? { ...portfolio, holdings, positions }
    : portfolio;
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
