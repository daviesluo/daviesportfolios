// Reconciling the broker's executed fills against the hand-kept ledger.
//
// Two records of the same trades exist and neither is a superset of the
// other. `holding.lots` / `holding.sells` are what the owner typed into
// EditTickerModal — the only record for a holding bought anywhere other
// than Trading 212. `t212_orders` is what the broker actually executed,
// backfilled page by page by the Edge Function, and the only record that
// carries real dates for everything bought since the ledger was last
// updated by hand.
//
// The board's share count is the source of truth for QUANTITY (16 of 26
// holdings carry lots that fall short of it), so nothing here touches
// `shares` or `cost`. This module only answers two questions:
//
//   1. Which broker fills is the ledger already carrying?
//   2. What would the ledger look like with the rest folded in?
//
// Both are pure, so a merge can be previewed before it is saved — the
// one thing missing when a sync last rewrote this book's history.

import { cleanLots } from './lots.js';
import { cleanSells } from './transactions.js';
import { lotsFromOrders } from './trading212.js';

// How close two records of the same trade have to be to be the same
// trade. Shares are exact to float dust: a fill of 0.5 shares is
// recorded as 0.5 either way. Price is looser — a hand-typed row rounds
// to the cent while the fill carries more digits, and some brokers
// report a price net of a sub-cent fee.
const SHARE_EPS = 1e-6;
const PRICE_ABS_EPS = 0.011;
const PRICE_REL_EPS = 0.005;

/** @param {number} a @param {number} b */
function samePrice(a, b) {
  const tol = Math.max(PRICE_ABS_EPS, Math.abs(b) * PRICE_REL_EPS);
  return Math.abs(a - b) <= tol;
}

/**
 * The broker's fills for one ticker, in the ledger's own shape.
 *
 * @param {Array<any> | null | undefined} orders  rows from fetchTrading212Orders
 * @param {string} ticker
 * @returns {{ lots: Array<{date: string, shares: number, cost: number}>,
 *             sells: Array<{date: string, shares: number, price: number}> }}
 */
export function brokerLedgerFor(orders, ticker) {
  const built = lotsFromOrders(Array.isArray(orders) ? orders : [], ticker);
  if (!built) return { lots: [], sells: [] };
  return { lots: built.lots, sells: built.sells };
}

/**
 * Split the broker's rows into the ones the ledger already records and
 * the ones it doesn't.
 *
 * Matching CONSUMES: two fills of 0.5 shares at the same price on the
 * same day need two ledger rows to both count as recorded. Without that,
 * a book with one such row would swallow both fills and quietly lose
 * half the position.
 *
 * @template {{date: string, shares: number}} T
 * @param {T[]} brokerRows
 * @param {T[]} ownRows
 * @param {(row: T) => number} priceOf
 * @returns {{ matched: T[], missing: T[] }}
 */
export function splitAgainstLedger(brokerRows, ownRows, priceOf) {
  const available = ownRows.map((r) => ({ row: r, taken: false }));
  /** @type {T[]} */ const matched = [];
  /** @type {T[]} */ const missing = [];
  for (const fill of brokerRows) {
    const hit = available.find((c) => !c.taken
      && c.row.date === fill.date
      && Math.abs(c.row.shares - fill.shares) <= SHARE_EPS
      && samePrice(priceOf(c.row), priceOf(fill)));
    if (hit) { hit.taken = true; matched.push(fill); }
    else missing.push(fill);
  }
  return { matched, missing };
}

/**
 * Everything the editor needs to show one ticker's broker history: each
 * fill newest first, flagged with whether the ledger already has it.
 *
 * @param {Array<any> | null | undefined} orders
 * @param {string} ticker
 * @param {{lots?: any, sells?: any} | null | undefined} holding
 * @returns {{
 *   rows: Array<{date: string, shares: number, price: number, kind: 'buy'|'sell', known: boolean}>,
 *   missingLots: Array<{date: string, shares: number, cost: number}>,
 *   missingSells: Array<{date: string, shares: number, price: number}>,
 * }}
 */
export function reconcileFills(orders, ticker, holding) {
  const broker = brokerLedgerFor(orders, ticker);
  const ownLots = cleanLots(holding?.lots);
  const ownSells = cleanSells(holding?.sells);
  const buys = splitAgainstLedger(broker.lots, ownLots, (r) => Number(r.cost));
  const sales = splitAgainstLedger(broker.sells, ownSells, (r) => Number(r.price));
  const known = new Set([...buys.matched, ...sales.matched]);
  const rows = [
    ...broker.lots.map((l) => ({
      date: l.date, shares: l.shares, price: l.cost,
      kind: /** @type {const} */ ('buy'), known: known.has(l),
    })),
    ...broker.sells.map((s) => ({
      date: s.date, shares: s.shares, price: s.price,
      kind: /** @type {const} */ ('sell'), known: known.has(s),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return { rows, missingLots: buys.missing, missingSells: sales.missing };
}

/**
 * The ledger with the broker rows it was missing folded in, sorted by
 * date. Purely additive — every row the ledger already had is still
 * there, in its original form, including holdings bought elsewhere.
 *
 * @param {{lots?: any, sells?: any} | null | undefined} holding
 * @param {Array<{date: string, shares: number, cost: number}>} missingLots
 * @param {Array<{date: string, shares: number, price: number}>} missingSells
 * @returns {{lots: Array<any>, sells: Array<any>}}
 */
export function withFillsApplied(holding, missingLots, missingSells) {
  const byDate = (/** @type {any} */ a, /** @type {any} */ b) =>
    String(a?.date || '').localeCompare(String(b?.date || ''));
  const lots = [...(Array.isArray(holding?.lots) ? holding.lots : []), ...missingLots].sort(byDate);
  const sells = [...(Array.isArray(holding?.sells) ? holding.sells : []), ...missingSells].sort(byDate);
  return { lots, sells };
}
