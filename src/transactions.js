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
 * array sorted ascending by date. An optional `ts` (epoch ms, stamped when
 * the row was added in the editor) is preserved when present so the
 * Transaction History can order same-day rows by actual record time, and
 * `src` survives for the same reason it does on lots — see `cleanLots`.
 * @param {Array<{date?: any, shares?: any, price?: any, ts?: any, src?: any}>} sells
 * @returns {Array<{date: string, shares: number, price: number, ts?: number, src?: string}>}
 */
export function cleanSells(sells) {
  if (!Array.isArray(sells)) return [];
  /** @type {Array<{date: string, shares: number, price: number, ts?: number, src?: string}>} */
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
    const ts = Number(s?.ts);
    const src = typeof s?.src === 'string' && s.src ? { src: s.src } : {};
    out.push(Number.isFinite(ts) ? { date, shares, price, ts, ...src } : { date, shares, price, ...src });
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
  // Snap float dust to an exact 0. Fractional lots (T212 DCA — 0.1 + 0.2
  // style quantities) don't subtract cleanly in binary floats, so selling
  // EVERYTHING could net to ±5e-17 instead of 0 — the caller's
  // `np.shares <= 0` full-sale check then never fired, the holding was
  // never closed / taken off the board, and the header ticker count never
  // dropped. Real fractional holdings are ≥1e-8 shares; accumulated float
  // error is ≤~1e-12, so 1e-9 separates the two cleanly.
  const rawShares = buyShares - sellShares;
  const shares = Math.abs(rawShares) < 1e-9 ? 0 : rawShares;
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
 *   shares: number, price: number, currency: string, ts?: number,
 *   acAfter?: number, gain?: number | null, gainPct?: number | null }} TxnRow
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
/**
 * Walk one holding's ledger in order and say what each row DID.
 *
 * A sale's realized gain and a purchase's resulting average cost are the
 * same question asked from two sides — "what did this trade do to the
 * position?" — and neither can be read off the row itself: both depend
 * on every trade before it. Under the net-cash model a sale banks
 * `shares × (price − AC)` where AC is the running net cost at that
 * moment, and the cash it returns lowers what the remaining shares cost.
 *
 * Returns one entry per row, in date order, keyed by index into the
 * chronological sequence so the caller can attach them to its own rows.
 *
 * @param {Array<any>} lots
 * @param {Array<any>} sells
 * @returns {Array<{date: string, kind: 'buy'|'sell', shares: number, price: number, ts?: number,
 *                  acAfter: number, gain: number | null, gainPct: number | null}>}
 */
export function annotateLedger(lots, sells) {
  const txns = [
    ...cleanLots(lots).map((l) => ({ date: l.date, shares: l.shares, price: l.cost, ts: l.ts, kind: /** @type {const} */ ('buy') })),
    ...cleanSells(sells).map((sl) => ({ date: sl.date, shares: sl.shares, price: sl.price, ts: sl.ts, kind: /** @type {const} */ ('sell') })),
  ].sort((a, b) => a.date.localeCompare(b.date) || ((a.ts ?? 0) - (b.ts ?? 0)));
  let netCash = 0, shares = 0;
  const out = [];
  for (const t of txns) {
    if (t.kind === 'buy') {
      netCash += t.shares * t.price;
      shares += t.shares;
      out.push({ ...t, acAfter: shares > 0 ? netCash / shares : 0, gain: null, gainPct: null });
    } else {
      const ac = shares > 0 ? netCash / shares : 0;
      const gain = t.shares * (t.price - ac);
      netCash -= t.shares * t.price;
      shares -= t.shares;
      out.push({
        ...t,
        acAfter: shares > 1e-9 ? netCash / shares : 0,
        gain,
        // Against what the sold shares cost, which is the only basis the
        // percentage can mean. A sale out of a zero-cost position (a
        // spinoff, a fully banked round trip) has no percentage at all.
        gainPct: ac > 0 ? ((t.price - ac) / ac) * 100 : null,
      });
    }
  }
  return out;
}

export function buildTransactionLog(holdings) {
  if (!holdings || typeof holdings !== 'object') return [];
  /** @type {TxnRow[]} */
  const rows = [];
  for (const [ticker, h] of Object.entries(holdings)) {
    if (!h || h.isCash || ticker === 'CASH' || AUTO_DCA_TICKERS.has(ticker)) continue;
    const currency = h.currency || 'USD';
    // `annotateLedger` walks this holding in order, so each row arrives
    // knowing what it did to the position: a sale's banked gain, a
    // purchase's resulting average cost.
    for (const t of annotateLedger(h.lots, h.sells)) {
      rows.push({
        ticker, kind: t.kind, date: t.date, shares: t.shares, price: t.price,
        currency, ts: t.ts, acAfter: t.acAfter, gain: t.gain, gainPct: t.gainPct,
      });
    }
  }
  // Most recent first. Same-day ties: order by actual record time (the `ts`
  // stamped when the row was added in the editor), newest entry first —
  // dates alone can't (lots/sells store only YYYY-MM-DD), which is why
  // same-day rows used to fall back to alphabetical-by-ticker. Rows with no
  // `ts` (legacy / the synthetic shares→lot seed) sort below the timestamped
  // ones, then keep the old stable sells-before-buys / ticker order.
  const tsOf = (/** @type {TxnRow} */ r) => (Number.isFinite(r.ts) ? /** @type {number} */ (r.ts) : 0);
  rows.sort((a, b) => (
    b.date.localeCompare(a.date)
    || (tsOf(b) - tsOf(a))
    || (a.kind === b.kind ? 0 : a.kind === 'sell' ? -1 : 1)
    || a.ticker.localeCompare(b.ticker)
  ));
  return rows;
}

/**
 * One holding's buys and sells as a SINGLE list, newest first.
 *
 * The lot editor used to show two grids — purchases, then sales below —
 * which reads fine on a hand-kept ledger of four rows and not at all on
 * a broker history of a hundred, where what you want is simply "what
 * happened, most recent at the top". Buys and sells are one story told
 * in date order.
 *
 * Values come back as STRINGS because they go straight into controlled
 * inputs; `fromLedgerRows` coerces them back. Same-day rows fall back to
 * `ts` (stamped when a row was added in the editor) so a pair typed
 * minutes apart keeps its order.
 *
 * @param {{lots?: any, sells?: any}} holding
 * @returns {Array<{kind: 'buy'|'sell', date: string, shares: string, price: string, ts?: number, src?: string}>}
 */
export function toLedgerRows(holding) {
  const rows = [
    ...(Array.isArray(holding?.lots) ? holding.lots : []).map((l) => ({
      kind: /** @type {const} */ ('buy'),
      date: String(l?.date || ''),
      shares: String(l?.shares ?? ''),
      price: String(l?.cost ?? ''),
      ...(Number.isFinite(Number(l?.ts)) ? { ts: Number(l.ts) } : {}),
      ...(typeof l?.src === 'string' && l.src ? { src: l.src } : {}),
    })),
    ...(Array.isArray(holding?.sells) ? holding.sells : []).map((s) => ({
      kind: /** @type {const} */ ('sell'),
      date: String(s?.date || ''),
      shares: String(s?.shares ?? ''),
      price: String(s?.price ?? ''),
      ...(Number.isFinite(Number(s?.ts)) ? { ts: Number(s.ts) } : {}),
      ...(typeof s?.src === 'string' && s.src ? { src: s.src } : {}),
    })),
  ];
  return rows.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.ts ?? 0) - (a.ts ?? 0);
  });
}

/**
 * The inverse: one editor list back into the `{ lots, sells }` the rest
 * of the app stores. Order within each side doesn't matter — `cleanLots`
 * / `cleanSells` sort by date on the way in — so this only has to split.
 *
 * @param {Array<{kind?: string, date?: any, shares?: any, price?: any, ts?: any, src?: any}> | null | undefined} rows
 * @returns {{lots: any[], sells: any[]}}
 */
export function fromLedgerRows(rows) {
  const lots = [];
  const sells = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const keep = {
      date: r?.date,
      shares: r?.shares,
      ...(Number.isFinite(Number(r?.ts)) ? { ts: Number(r.ts) } : {}),
      ...(typeof r?.src === 'string' && r.src ? { src: r.src } : {}),
    };
    if (r?.kind === 'sell') sells.push({ ...keep, price: r?.price });
    else lots.push({ ...keep, cost: r?.price });
  }
  return { lots, sells };
}
