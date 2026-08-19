// Rebuilding a holding's ledger from the broker's executed fills.
//
// Two records of the same trades exist and neither is a superset of the
// other. `t212_orders` is what Trading 212 actually executed, backfilled
// page by page by the Edge Function — every fill, both accounts, with
// the real dates and the real prices. `holding.lots` / `holding.sells`
// is what was typed in by hand, and for a holding bought anywhere other
// than Trading 212 it is the only record there is.
//
// The broker's copy wins wherever it exists. It is not a matter of
// taste: the board carried ONE lot of `59 @ 144.31` for SPCX, which is
// T212's average price and not a trade that ever happened — the twelve
// real fills ran from 165.58 down to 115.48 over a month. Reconciling
// row against row can't fix that, because the rows don't correspond.
// Replacing does.
//
// What is NOT the broker's to replace is marked `src: 'other'`: shares
// held at another platform, and anything typed into the lot editor. Two
// rules keep this safe:
//
//   1. A ticker is only rebuilt when it carries a `t212Shares` tag AND
//      the broker has fills for it. No tag, no fills, no rebuild — so a
//      CN fund or a cold wallet is never touched.
//   2. The rebuilt ledger must net to the board's OWN share count, to
//      float dust. If it doesn't — the backfill hasn't walked back far
//      enough yet, say — the holding is left exactly as it was.
//
// The board's share count is the source of truth for QUANTITY, and rule
// 2 is that sentence written as code: this module can change what the
// ledger SAYS, never what the position IS.

import { cleanLots } from './lots.js';
import { cleanSells, netPosition } from './transactions.js';
import { lotsFromOrders } from './trading212.js';

/** Rows the broker has no claim over: another platform's, or hand-typed. */
export const SRC_OTHER = 'other';

/** How far the rebuilt ledger may sit from the board before it's refused. */
const SHARE_EPS = 1e-6;

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

/** @param {any} row */
const isOther = (row) => row?.src === SRC_OTHER;

/** @param {any[]} rows */
const byDate = (rows) =>
  rows.slice().sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));

/**
 * One ticker's ledger rebuilt from the broker's fills, or null when it
 * must be left alone.
 *
 * Returns null — meaning "don't touch this holding" — when the ticker
 * isn't a Trading 212 position, when the broker has no fills for it yet,
 * or when the result wouldn't net to the board's share count. Callers
 * treat null as "keep what you have", never as "empty the ledger".
 *
 * @param {any} holding  a `portfolio.holdings[ticker]` row
 * @param {Array<any> | null | undefined} orders
 * @param {string} ticker
 * @returns {{lots: any[], sells: any[]} | null}
 */
export function rebuildLedgerFromFills(holding, orders, ticker) {
  if (!holding || !ticker) return null;
  // Rule 1: only a tagged T212 position, and only once fills exist.
  const t212Shares = Number(holding.t212Shares);
  if (!Number.isFinite(t212Shares)) return null;
  const broker = brokerLedgerFor(orders, ticker);
  if (broker.lots.length === 0 && broker.sells.length === 0) return null;

  const keptLots = cleanLots(holding.lots).filter(isOther);
  const keptSells = cleanSells(holding.sells).filter(isOther);
  const lots = byDate([...keptLots, ...broker.lots.map((l) => ({ ...l }))]);
  const sells = byDate([...keptSells, ...broker.sells.map((s) => ({ ...s }))]);

  // Rule 2: the board decides the quantity. A ledger that disagrees with
  // it is a ledger built from an incomplete backfill, not a correction.
  const boardShares = Number(holding.shares);
  if (!Number.isFinite(boardShares)) return null;
  if (Math.abs(netPosition(lots, sells).shares - boardShares) > SHARE_EPS) return null;

  return { lots, sells };
}

/**
 * Whether a rebuild would actually change anything. Rebuilding writes
 * into the portfolio, which dirties the save fingerprint — so an
 * unchanged ledger has to be recognised as unchanged, or every refresh
 * tick would queue a pointless write.
 *
 * @param {any} holding
 * @param {{lots: any[], sells: any[]}} next
 */
export function ledgerDiffers(holding, next) {
  const key = (/** @type {any[]} */ rows, /** @type {string} */ priceField) =>
    rows.map((r) => `${r?.date}|${Number(r?.shares)}|${Number(r?.[priceField])}|${r?.src || ''}`).join(';');
  return key(cleanLots(holding?.lots), 'cost') !== key(cleanLots(next.lots), 'cost')
    || key(cleanSells(holding?.sells), 'price') !== key(cleanSells(next.sells), 'price');
}

/**
 * Rebuild every holding the broker has a complete record of. Mutates
 * `holdings` in place and returns the tickers whose ledger actually
 * changed, so the caller can tell a real change from a no-op tick.
 *
 * `cost` follows the rebuilt ledger. The board's own figure comes from
 * T212's `averagePricePaid`, which is the average of what was BOUGHT and
 * says nothing about what was sold — while this app's cost basis is the
 * net-cash model the owner specified, where a sale's realized P&L folds
 * into the remaining basis. On a holding that was only ever bought the
 * two agree to the cent (eight of them do here); on ORCL, sold down from
 * 123 fills to 70 shares, they differ by $28.68 a share. Leaving the two
 * side by side would put a different average cost in the lot editor than
 * on the board, for the same holding, forever.
 *
 * `shares` is never touched: `rebuildLedgerFromFills` has already refused
 * anything that wouldn't net to the board's own count.
 *
 * @param {Record<string, any>} holdings
 * @param {Array<any> | null | undefined} orders
 * @returns {string[]}
 */
export function applyFillLedgers(holdings, orders) {
  if (!holdings || !Array.isArray(orders) || orders.length === 0) return [];
  /** @type {string[]} */ const changed = [];
  for (const [ticker, holding] of Object.entries(holdings)) {
    const next = rebuildLedgerFromFills(holding, orders, ticker);
    if (!next) continue;
    const differs = ledgerDiffers(holding, next);
    // Always re-apply the cost, even when the ledger is unchanged: the
    // T212 position sync runs first and writes its own average over it
    // on every tick, so skipping here would leave the two alternating.
    holdings[ticker] = {
      ...holding,
      lots: next.lots,
      sells: next.sells,
      cost: netPosition(next.lots, next.sells).avgCost,
    };
    if (differs) changed.push(ticker);
  }
  return changed;
}

/**
 * What the lot editor says about where a holding's rows came from —
 * enough for the owner to tell "this is the broker's full history" from
 * "the backfill hasn't reached this one yet" without reading code.
 *
 *   synced  — the rows below ARE the broker's fills (plus anything held
 *             elsewhere). Nothing is missing.
 *   pending — the broker's history for this ticker doesn't add up to the
 *             position yet, so the ledger is left as it was. The walk is
 *             still running; this resolves itself.
 *   manual  — not a Trading 212 position, or the walk finished without
 *             covering it. These rows are the owner's and stay his.
 *
 * @param {any} holding
 * @param {Array<any> | null | undefined} orders
 * @param {string} ticker
 * @param {boolean} [backfillComplete]
 * @returns {{state: 'synced'|'pending'|'manual', fills: number, other: number}}
 */
export function ledgerProvenance(holding, orders, ticker, backfillComplete) {
  const broker = brokerLedgerFor(orders, ticker);
  const fills = broker.lots.length + broker.sells.length;
  const other = cleanLots(holding?.lots).filter(isOther).length
    + cleanSells(holding?.sells).filter(isOther).length;
  if (!Number.isFinite(Number(holding?.t212Shares))) return { state: 'manual', fills, other };
  if (rebuildLedgerFromFills(holding, orders, ticker)) return { state: 'synced', fills, other };
  return { state: backfillComplete ? 'manual' : 'pending', fills, other };
}
