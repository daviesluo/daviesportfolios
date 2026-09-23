// Net deposited — the second line on the Investment Performance panel.
//
// This is NOT a second opinion on the portfolio's value. The value line
// is `computeAt(...).value`, the identical call the vs-S&P panel makes on
// the identical grid, so the two panels cannot disagree about what the
// book is worth. Money paid in is a genuinely different quantity — a sum
// of dated cash flows, not a mark-to-market — and it is the only thing
// this module computes.
//
// Three rules, each of which was a real complaint:
//
//   1. Deposits are STEPS. A step happens on the day of a buy or a sale
//      and nowhere else. Anything that makes this line wobble between
//      those dates is a bug in it.
//   2. It does NOT follow live FX. A pound spent in April bought a fixed
//      number of dollars; re-converting it at today's rate every render
//      makes the line move on days no money changed hands. The rate is
//      frozen per currency in `portfolio.depositFxRates`.
//   3. It covers the SAME holdings the value line covers — the board
//      scope `computeAt` uses. Money paid into a position that is on the
//      board sits under a value line that includes that position; if the
//      two scopes differed, the gap between the lines would be partly an
//      accounting artefact rather than profit.

import { detectCurrency } from '../portfolio/fx.js';

/**
 * The frozen native→USD rate for a currency.
 *
 * `rates` is `portfolio.depositFxRates`, a map written once per currency
 * (see `freezeDepositFxRates`) and never revalued. USD is 1 by
 * definition. A currency with no frozen rate yet returns null so the
 * caller can decline to draw rather than quietly using 1:1 — a CNY
 * position converted at 1.0 instead of ~0.14 is seven times its real
 * size, and that has already been written into a chart once.
 *
 * @param {string | undefined} currency
 * @param {Record<string, number> | undefined | null} rates
 * @returns {number | null}
 */
export function frozenFxRate(currency, rates) {
  if (!currency || currency === 'USD') return 1;
  const r = Number(rates?.[currency]);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * Which currencies this portfolio needs a frozen rate for, and doesn't
 * have one for yet.
 *
 * @param {any} portfolio
 * @returns {string[]}
 */
export function missingDepositFxCurrencies(portfolio) {
  /** @type {Set<string>} */
  const need = new Set();
  for (const [ticker, h] of Object.entries(portfolio?.holdings || {})) {
    const hh = /** @type {any} */ (h);
    if (hh?.isCash || ticker === 'CASH') continue;
    const cur = hh?.currency || detectCurrency(ticker);
    if (!cur || cur === 'USD') continue;
    if (frozenFxRate(cur, portfolio?.depositFxRates) == null) need.add(cur);
  }
  return [...need].sort();
}

/**
 * Fill in any missing frozen rate from the live FX map, returning a NEW
 * rates object (or the same reference when nothing changed, so callers
 * can skip a write). Existing rates are never overwritten — that is the
 * whole point of freezing them.
 *
 * A live rate that came back as an exact 1 for a non-USD currency is
 * refused: `fxRateToUSD` falls back to 1:1 when Yahoo didn't return the
 * pair, and freezing that fallback would make it permanent.
 *
 * @param {any} portfolio
 * @param {(currency: string|undefined, marketData: any) => number} fxToUSD
 * @param {any} marketData
 * @returns {Record<string, number>}
 */
export function freezeDepositFxRates(portfolio, fxToUSD, marketData) {
  const current = portfolio?.depositFxRates || {};
  let next = current;
  for (const cur of missingDepositFxCurrencies(portfolio)) {
    const live = Number(fxToUSD(cur, marketData));
    if (!Number.isFinite(live) || live <= 0 || live === 1) continue;
    if (next === current) next = { ...current };
    next[cur] = live;
  }
  return next;
}

/**
 * True when a ledger event happened strictly after a chart point.
 *
 * Lot and sell dates are plain `YYYY-MM-DD` and count for that whole
 * day; chart dates on an intraday range carry `THH:MM`. Comparing the
 * raw strings would read "2026-04-28" as BEFORE "2026-04-28T13:30" (10
 * chars sort under 16), so a lot bought today would count as not yet
 * owned on today's intraday points. Compare day-to-day, and only compare
 * minutes when BOTH sides carry them.
 *
 * @param {unknown} eventDate
 * @param {unknown} chartDate
 */
export function ledgerEventIsAfter(eventDate, chartDate) {
  const event = String(eventDate || '');
  const chart = String(chartDate || '');
  const eventDay = event.slice(0, 10);
  const chartDay = chart.slice(0, 10);
  if (!eventDay || !chartDay) return true;
  if (eventDay !== chartDay) return eventDay > chartDay;
  if (event.length >= 16 && chart.length >= 16) return event.slice(0, 16) > chart.slice(0, 16);
  return false;
}

/**
 * One ticker's real Trading 212 fills, as a `{lots, sells}` slice.
 *
 * `/equity/positions` reports a POSITION — quantity and average price,
 * with no dates — which is why a synced ticker could only ever carry a
 * lot whose date was a guess. `/equity/history/orders` has the actual
 * fills. Fills for the same ticker across both accounts are merged: the
 * board has one row per ticker and which account a share sits in isn't
 * something this ledger models.
 *
 * @param {Array<any> | null | undefined} orders
 * @param {string} ticker
 * @returns {{lots: Array<any>, sells: Array<any>} | null}
 */
export function t212FillsFor(orders, ticker) {
  if (!Array.isArray(orders) || !ticker) return null;
  const lots = [];
  const sells = [];
  for (const o of orders) {
    if (!o || o.ticker !== ticker) continue;
    const shares = Number(o.shares);
    const price = Number(o.price);
    // Keep the minute on T212 fills: on an intraday range a buy made at
    // 14:30 should step the line at 14:30, not at midnight.
    const raw = String(o.executed_at || '');
    const date = raw.length >= 16 ? raw.slice(0, 16) : raw.slice(0, 10);
    if (!date || !(shares > 0) || !(price > 0)) continue;
    if (o.side === 'sell') sells.push({ date, shares, price });
    else lots.push({ date, shares, cost: price });
  }
  if (lots.length === 0 && sells.length === 0) return null;
  lots.sort((a, b) => a.date.localeCompare(b.date));
  sells.sort((a, b) => a.date.localeCompare(b.date));
  return { lots, sells };
}

/** Net shares a `{lots, sells}` slice describes. */
function netOf(slice) {
  let n = 0;
  for (const l of slice.lots) n += Number(l.shares) || 0;
  for (const s of slice.sells) n -= Number(s.shares) || 0;
  return Math.abs(n) < 1e-9 ? 0 : n;
}

/**
 * The dated cash flows for one holding.
 *
 * Prefers the real ledger. A holding with no lots at all is "owned,
 * dates unknown" — it stands in as one lot at the board's average cost,
 * dated before every chart window, so the money is on the line at the
 * right level even though we can't say when it arrived. Inventing a
 * plausible-looking recent date instead would draw a deposit step that
 * never happened.
 *
 * When real T212 fills are available they refine the DATES of the
 * broker-synced slice, and only that slice. The user's own lots are
 * never overwritten — a board row can hold the same ticker at T212 and
 * at another broker, and replacing its ledger with machine history was
 * a production data-loss bug. So:
 *
 *   - a holding whose own lots already net to its board shares is the
 *     user's ledger, and is used as-is;
 *   - otherwise the fills are used for the part of the position they
 *     cover, and whatever the board holds beyond them stands in at
 *     board average cost, dated before every window.
 *
 * The stand-in absorbs exactly the residue, so the slice always nets to
 * the board's share count no matter how much of the history has been
 * walked. That is what makes a half-finished backfill safe to use: it
 * adds real dated steps without ever changing the total.
 *
 * @param {any} h
 * @param {{lots: Array<any>, sells: Array<any>} | null} [t212Fills]
 * @returns {{lots: Array<{date:string, shares:number, cost:number}>,
 *            sells: Array<{date:string, shares:number, price:number}>}}
 */
export function depositLedgerFor(h, t212Fills = null) {
  const lots = (Array.isArray(h?.lots) ? h.lots : [])
    .filter((l) => Number(l?.shares) > 0 && Number.isFinite(Number(l?.cost)));
  const sells = (Array.isArray(h?.sells) ? h.sells : [])
    .filter((s) => Number(s?.shares) > 0 && Number.isFinite(Number(s?.price)));
  const shares = Number(h?.shares);
  const cost = Number(h?.cost);
  const boardShares = Number.isFinite(shares) && shares > 0 ? shares : 0;
  const boardCost = Number.isFinite(cost) && cost > 0 ? cost : 0;

  if (t212Fills && (t212Fills.lots.length > 0 || t212Fills.sells.length > 0)) {
    // Is the on-board ledger the user's own, complete, hand-kept one?
    // Then it wins outright — the synthetic stand-in the sync writes is
    // tagged, and a tagged-only ledger is not the user's.
    const userAuthored = lots.length > 0
      && !lots.every((l) => l?.source === 't212-synthetic')
      && Math.abs(netOf({ lots, sells }) - boardShares) <= Math.max(1e-6, boardShares * 1e-6);
    if (!userAuthored) {
      const standIn = boardShares - netOf(t212Fills);
      return {
        lots: [
          ...(standIn > 1e-9
            ? [{ date: '1970-01-01', shares: standIn, cost: boardCost }]
            : []),
          ...t212Fills.lots,
        ],
        sells: t212Fills.sells,
      };
    }
  }

  // Reconcile the lot ledger against the board's share count, the same
  // way `lotsFor` does for the value line.
  //
  // Measured on the real book: 16 of 26 holdings have lots that do not
  // add up to their board shares, and always in the same direction —
  // BMNR carries 7 lot shares against 225 on the board, RKLB 30 against
  // 160, AMZN 2.5 against 42.5. Those are shares that were bought and
  // never written into the ledger, not shares that don't exist: the
  // board count is what the broker and the scoreboard agree on.
  //
  // Trusting the lots alone would have understated Deposited by the
  // whole un-lotted slice — thousands of dollars, silently, on most of
  // the book. The residue stands in at board average cost, dated before
  // every window: the money is on the line at the right level, and no
  // step is drawn on a day nothing happened.
  const known = netOf({ lots, sells });
  const standIn = boardShares - known;
  if (standIn > 1e-9) {
    return {
      lots: [{ date: '1970-01-01', shares: standIn, cost: boardCost }, ...lots],
      sells,
    };
  }
  if (lots.length > 0) return { lots, sells };
  if (boardShares <= 0) return { lots: [], sells };
  return { lots: [{ date: '1970-01-01', shares: boardShares, cost: boardCost }], sells };
}

/**
 * Net money paid in as of `date`, in USD.
 *
 * @param {{
 *   portfolio: any,
 *   date: string,
 *   fxRates?: Record<string, number> | null,
 *   t212Orders?: Array<any> | null,
 * }} opts
 * @returns {number | null}  null when a currency has no frozen rate yet
 */
export function depositAt({ portfolio, date, fxRates, t212Orders = null }) {
  const positioned = new Set();
  for (const pos of Object.values(portfolio?.positions || {})) {
    for (const t of (/** @type {any} */ (pos)?.tickers || [])) positioned.add(t);
  }
  // No positions at all (unit fixtures) → don't filter, the same escape
  // hatch `computeAt` uses so the two agree on scope in tests too.
  const scopeAll = positioned.size === 0;

  let deposit = 0;
  for (const [ticker, holding] of Object.entries(portfolio?.holdings || {})) {
    const h = /** @type {any} */ (holding);
    if (!scopeAll && !positioned.has(ticker)) continue;
    if (h?.isCash || ticker === 'CASH') {
      // Cash on the board was deposited too, and the value line counts
      // it, so it lifts both lines equally instead of reading as profit.
      // Carried back as a constant — we don't record past balances —
      // which is the same assumption `computeAt` already makes for it.
      const bal = Number(h?.lastPrice);
      if (Number.isFinite(bal) && bal > 0) deposit += bal;
      continue;
    }
    const currency = h?.currency || detectCurrency(ticker);
    const fx = frozenFxRate(currency, fxRates);
    if (fx == null) return null;
    const { lots, sells } = depositLedgerFor(h, t212FillsFor(t212Orders, ticker));
    for (const l of lots) {
      if (ledgerEventIsAfter(l.date, date)) continue;
      deposit += Number(l.shares) * Number(l.cost) * fx;
    }
    for (const s of sells) {
      if (ledgerEventIsAfter(s.date, date)) continue;
      deposit -= Number(s.shares) * Number(s.price) * fx;
    }
  }
  return deposit;
}

/**
 * `depositAt` over a whole grid. Returns null when any currency is
 * missing its frozen rate — a half-converted line is worse than none.
 *
 * @param {{portfolio: any, dates: string[], fxRates?: Record<string, number>|null,
 *   t212Orders?: Array<any>|null}} opts
 * @returns {Array<{date: string, v: number}> | null}
 */
export function depositSeries({ portfolio, dates, fxRates, t212Orders = null }) {
  /** @type {Array<{date: string, v: number}>} */
  const out = [];
  for (const date of dates) {
    const v = depositAt({ portfolio, date, fxRates, t212Orders });
    if (v == null) return null;
    out.push({ date, v });
  }
  return out;
}
