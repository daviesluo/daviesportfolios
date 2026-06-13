// Transaction-ledger helpers — the buy lots + sell records that drive the
// Transaction History modal, the net position math, and realized G/L.
//
// A holding carries:
//   - `lots`  : buy batches   `{ date, shares, cost }`  (cost = price paid)
//   - `sells` : sell records   `{ date, shares, price }` (price = price sold)
//
// Position accounting uses the NET-CASH model the user specified: a sale's
// realized P&L is folded into the remaining cost basis rather than tracked
// off to the side. So selling above your average cost LOWERS the average
// cost of the shares you keep (you've "banked" the gain), and buying back
// lower after selling high carries that gain into the new basis. Concretely
// the running cost basis is the net cash you've put in:
//   netCash   = Σ(buy.shares · buy.cost) − Σ(sell.shares · sell.price)
//   netShares = Σ buy.shares − Σ sell.shares
//   avgCost   = netShares > 0 ? netCash / netShares : 0
// `realizedGain` reports the gain banked at each sale separately for the
// history's headline figure (sale proceeds − basis of the sold shares).

import { cleanLots } from './lots.js';

// Holdings the user auto-DCAs into via the Trading 212 daily sync. Their
// lots are machine-written each day (applyTrading212 in trading212.js
// replaces the lot with a synthetic one every sync), so they aren't real
// user transactions — the Transaction History is for the user's own
// buys / sells. Hidden from both the ledger and the realized total. Keep
// in sync with the T212 auto-sync allow-list (trading212.js).
const AUTO_DCA_TICKERS = new Set(['VUAA.L', 'SAEM.L']);

/**
 * Sanitise sell rows the same way `cleanLots` does buy rows: drop
 * unfinishable / non-sensical / future-dated entries and coerce to finite
 * numbers (shares > 0, price ≥ 0, YYYY-MM-DD date ≤ today). Returns a fresh
 * array sorted ascending by date.
 * @param {Array<{date?: any, shares?: any, price?: any}>} sells
 * @returns {Array<{date: string, shares: number, price: number}>}
 */
export function cleanSells(sells) {
  if (!Array.isArray(sells)) return [];
  /** @type {Array<{date: string, shares: number, price: number}>} */
  const out = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const s of sells) {
    const date = typeof s?.date === 'string' ? s.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date > today) continue;
    const shares = Number(s?.shares);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    const price = Number(s?.price);
    if (!Number.isFinite(price) || price < 0) continue;
    out.push({ date, shares, price });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Net position from buy lots + sell records under the net-cash model.
 * `shares` can hit 0 (fully sold) or go negative (over-sold — a data
 * error the caller can flag); `avgCost` is 0 whenever shares ≤ 0 so the
 * /0 fallback is part of the contract. Cleans its inputs, so raw
 * editor rows are fine.
 * @param {Array<{date?: any, shares?: any, cost?: any}>} lots
 * @param {Array<{date?: any, shares?: any, price?: any}>} sells
 * @returns {{ shares: number, netCash: number, avgCost: number }}
 */
export function netPosition(lots, sells) {
  const bl = cleanLots(lots);
  const sl = cleanSells(sells);
  let buyShares = 0, buyCash = 0;
  for (const l of bl) { buyShares += l.shares; buyCash += l.shares * l.cost; }
  let sellShares = 0, sellCash = 0;
  for (const s of sl) { sellShares += s.shares; sellCash += s.shares * s.price; }
  const shares = buyShares - sellShares;
  const netCash = buyCash - sellCash;
  return { shares, netCash, avgCost: shares > 0 ? netCash / shares : 0 };
}

/**
 * Realized gain (in the holding's native currency) banked across all
 * sales. Processes buys + sells chronologically; each sale realizes
 * `shares · (sellPrice − avgCostAtSale)`, where the average cost evolves
 * under the net-cash model. Returns 0 for a holding that never sold.
 * @param {Array<{date?: any, shares?: any, cost?: any}>} lots
 * @param {Array<{date?: any, shares?: any, price?: any}>} sells
 * @returns {number}
 */
export function realizedGain(lots, sells) {
  const txns = [
    ...cleanLots(lots).map((l) => ({ date: l.date, shares: l.shares, price: l.cost, kind: /** @type {const} */ ('buy') })),
    ...cleanSells(sells).map((s) => ({ date: s.date, shares: s.shares, price: s.price, kind: /** @type {const} */ ('sell') })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let netCash = 0, shares = 0, realized = 0;
  for (const t of txns) {
    if (t.kind === 'buy') {
      netCash += t.shares * t.price;
      shares += t.shares;
    } else {
      const ac = shares > 0 ? netCash / shares : 0;
      realized += t.shares * (t.price - ac);
      netCash -= t.shares * t.price;
      shares -= t.shares;
    }
  }
  return realized;
}

/**
 * Total realized G/L across every holding, converted to USD — the headline
 * figure at the top of the Transaction History. Each holding's realized
 * gain is in its native currency; `fxRate(currency)` returns how many USD
 * one unit of that currency is worth (1 for USD). Includes CLOSED holdings.
 * @param {Record<string, any> | null | undefined} holdings
 * @param {(currency: string) => number} fxRate
 * @returns {number}
 */
export function totalRealizedUsd(holdings, fxRate) {
  if (!holdings || typeof holdings !== 'object') return 0;
  let usd = 0;
  for (const [ticker, h] of Object.entries(holdings)) {
    if (!h || h.isCash || ticker === 'CASH' || AUTO_DCA_TICKERS.has(ticker)) continue;
    const r = realizedGain(h.lots, h.sells);
    if (!r) continue;
    const rate = fxRate(h.currency || 'USD');
    usd += r * (Number.isFinite(rate) ? rate : 1);
  }
  return usd;
}

/**
 * @typedef {{ ticker: string, kind: 'buy'|'sell', date: string,
 *   shares: number, price: number, currency: string }} TxnRow
 */

/**
 * Flatten EVERY holding's buy lots + sell records into one chronological
 * ledger (most recent first) for the Transaction History modal. Reads
 * `holdings` directly (not `metrics`), so CLOSED holdings — net 0, taken
 * off the board but kept in `portfolio.holdings` — still contribute their
 * history. Cash is excluded.
 * @param {Record<string, any> | null | undefined} holdings
 * @returns {TxnRow[]}
 */
export function buildTransactionLog(holdings) {
  if (!holdings || typeof holdings !== 'object') return [];
  /** @type {TxnRow[]} */
  const rows = [];
  for (const [ticker, h] of Object.entries(holdings)) {
    if (!h || h.isCash || ticker === 'CASH' || AUTO_DCA_TICKERS.has(ticker)) continue;
    const currency = h.currency || 'USD';
    for (const l of cleanLots(h.lots)) {
      rows.push({ ticker, kind: 'buy', date: l.date, shares: l.shares, price: l.cost, currency });
    }
    for (const s of cleanSells(h.sells)) {
      rows.push({ ticker, kind: 'sell', date: s.date, shares: s.shares, price: s.price, currency });
    }
  }
  // Most recent first; ties broken by sells-after-buys then ticker so the
  // order is stable across renders.
  rows.sort((a, b) => (
    b.date.localeCompare(a.date)
    || (a.kind === b.kind ? 0 : a.kind === 'sell' ? -1 : 1)
    || a.ticker.localeCompare(b.ticker)
  ));
  return rows;
}
