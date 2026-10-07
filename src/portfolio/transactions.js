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
// That basis is the classic average cost — what the held shares cost, which
// a sale does not change — NOT the net-cash average above: under net cash a
// sale's gain is already folded into what the remaining shares "cost", so
// pricing the next sale against it books the earlier gain a second time.
// Two sales of one position double-counted that way (2026-10-07: a position
// bought at 10 and sold in two halves at 20 read +150 for a +100 round
// trip). For a position sold out, realized is exactly proceeds − cost.
//
// Dividends received count as part of the return and come off the average
// cost (Davies, 2026-10-07: "分红的盈利也算起来，直接算在average cost里"). A
// dividend is a dated event `{ date, ts?, amount }`, `amount` the net cash
// received in the holding's currency: it lowers the net cash (the shown
// average) and the classic basis alike, so a later sale realizes the
// dividends received while it was held, and a position sold out realizes
// exactly proceeds − cost + dividends. A dividend paid while nothing is held
// (bought back after a sale, say, or paid after the last sale) is realized
// as it arrives. With no dividends every figure is what it was before.

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
 * Sanitise dividend events: a YYYY-MM-DD date no later than today, a finite
 * non-zero amount (a tax correction can be negative), an optional `ts`
 * (epoch ms, the time it was paid) and the `shares` it was paid on. Sorted by
 * date, then time.
 * @param {Array<{date?: any, ts?: any, amount?: any, shares?: any}> | null | undefined} divs
 * @returns {Array<{date: string, amount: number, ts?: number, shares?: number}>}
 */
export function cleanDividends(divs) {
  if (!Array.isArray(divs)) return [];
  /** @type {Array<{date: string, amount: number, ts?: number, shares?: number}>} */
  const out = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const d of divs) {
    const date = typeof d?.date === 'string' ? d.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) continue;
    const amount = Number(d?.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const ts = Number(d?.ts);
    const shares = Number(d?.shares);
    out.push({
      date, amount,
      ...(Number.isFinite(ts) ? { ts } : {}),
      ...(Number.isFinite(shares) && shares > 0 ? { shares } : {}),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || ((a.ts ?? 0) - (b.ts ?? 0)));
}

/**
 * Net position from buy lots + sell records under the net-cash model.
 * `shares` can hit 0 (fully sold) or go negative (over-sold — a data
 * error the caller can flag); `avgCost` is 0 whenever shares ≤ 0 so the
 * /0 fallback is part of the contract. Cleans its inputs, so raw
 * editor rows are fine.
 * Dividends received (`divs`, optional) come off the net cash, so the
 * average cost is what the shares cost less what they have paid.
 * @param {Array<{date?: any, shares?: any, cost?: any}>} lots
 * @param {Array<{date?: any, shares?: any, price?: any}>} sells
 * @param {Array<{date?: any, amount?: any}> | null} [divs]
 * @returns {{ shares: number, netCash: number, avgCost: number }}
 */
export function netPosition(lots, sells, divs = null) {
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
  let divCash = 0;
  for (const d of cleanDividends(divs)) divCash += d.amount;
  const netCash = buyCash - sellCash - divCash;
  return { shares, netCash, avgCost: shares > 0 ? netCash / shares : 0 };
}

/**
 * Realized gain (in the holding's native currency) banked across all
 * sales. Processes buys + sells chronologically; each sale realizes
 * `shares · (sellPrice − avgCostAtSale)`, where the average cost evolves
 * under the net-cash model. Returns 0 for a holding that never sold.
 * Dividends (`divs`) are events in the same walk: one received while shares
 * are held comes off the basis, one received while none are is realized.
 * @param {Array<{date?: any, shares?: any, cost?: any}>} lots
 * @param {Array<{date?: any, shares?: any, price?: any}>} sells
 * @param {Array<{date?: any, amount?: any, ts?: any}> | null} [divs]
 * @returns {number}
 */
export function realizedGain(lots, sells, divs = null) {
  let realized = 0;
  for (const t of annotateLedger(lots, sells, divs)) realized += t.gain ?? 0;
  return realized;
}

/**
 * One holding's buys, sales and dividends as a single walk, in date order
 * (same-day rows by `ts`; with neither, buys before sales before dividends,
 * the order the arrays are concatenated in).
 * @param {Array<any>} lots
 * @param {Array<any>} sells
 * @param {Array<any> | null | undefined} divs
 */
function ledgerEvents(lots, sells, divs) {
  return [
    ...cleanLots(lots).map((l) => ({ date: l.date, shares: l.shares, price: l.cost, ts: l.ts, kind: /** @type {'buy'|'sell'|'div'} */ ('buy'), amount: l.shares * l.cost })),
    ...cleanSells(sells).map((sl) => ({ date: sl.date, shares: sl.shares, price: sl.price, ts: sl.ts, kind: /** @type {'buy'|'sell'|'div'} */ ('sell'), amount: sl.shares * sl.price })),
    ...cleanDividends(divs).map((d) => ({
      date: d.date, shares: d.shares ?? 0, price: d.shares ? d.amount / d.shares : 0, ts: d.ts,
      kind: /** @type {'buy'|'sell'|'div'} */ ('div'), amount: d.amount,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || ((a.ts ?? 0) - (b.ts ?? 0)));
}

/**
 * Total realized G/L across every holding, converted to USD — the headline
 * figure at the top of the Transaction History. Each holding's realized
 * gain is in its native currency; `fxRate(currency)` returns how many USD
 * one unit of that currency is worth (1 for USD). Includes CLOSED holdings.
 * `divsByTicker` holds each ticker's dividends in its holding's currency
 * (`dividendEventsByTicker`, t212_fills.js); a dividend is part of what a
 * position realized.
 * @param {Record<string, any> | null | undefined} holdings
 * @param {(currency: string) => number} fxRate
 * @param {Record<string, any[]> | null} [divsByTicker]
 * @returns {number}
 */
export function totalRealizedUsd(holdings, fxRate, divsByTicker = null) {
  if (!holdings || typeof holdings !== 'object') return 0;
  let usd = 0;
  for (const [ticker, h] of Object.entries(holdings)) {
    if (!h || h.isCash || ticker === 'CASH' || AUTO_DCA_TICKERS.has(ticker)) continue;
    const r = realizedGain(h.lots, h.sells, divsByTicker?.[ticker]);
    if (!r) continue;
    const rate = fxRate(h.currency || 'USD');
    usd += r * (Number.isFinite(rate) ? rate : 1);
  }
  return usd;
}

/**
 * A row of the history. `kind` 'div' is a dividend received: `amount` the
 * net cash in the holding's currency, `shares` what it was paid on (0 when
 * unknown) and `price` the amount per share.
 * @typedef {{ ticker: string, kind: 'buy'|'sell'|'div', date: string,
 *   shares: number, price: number, amount: number, currency: string, ts?: number,
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
 * A dividend (`divs`) is a row of its own: it comes off the net cash and
 * the classic basis, its `acAfter` is the net-cash average after it, and it
 * realizes nothing unless nothing is held when it arrives (then all of it).
 *
 * @param {Array<any>} lots
 * @param {Array<any>} sells
 * @param {Array<any> | null} [divs]
 * @returns {Array<{date: string, kind: 'buy'|'sell'|'div', shares: number, price: number, amount: number, ts?: number,
 *                  acAfter: number, gain: number | null, gainPct: number | null}>}
 */
export function annotateLedger(lots, sells, divs = null) {
  const txns = ledgerEvents(lots, sells, divs);
  // A purchase's `acAfter` is the net-cash average the position view shows
  // once it has happened. A sale's is the classic average cost (`basis`) it
  // was measured against, the one `realizedGain` books, so a sale row checks
  // by hand — Realised G/L = shares × (price − Avg Cost) — a closing sale
  // included (Davies, 2026-10-07: sell rows read blank once a position
  // closed). The rows' gains add up to the headline.
  let netCash = 0, shares = 0, basis = 0, held = 0;
  const out = [];
  for (const t of txns) {
    if (t.kind === 'buy') {
      netCash += t.shares * t.price;
      shares += t.shares;
      basis += t.shares * t.price;
      held += t.shares;
      out.push({ ...t, acAfter: shares > 0 ? netCash / shares : 0, gain: null, gainPct: null });
    } else if (t.kind === 'div') {
      netCash -= t.amount;
      const holding = held > 1e-9;
      if (holding) basis -= t.amount;
      out.push({
        ...t,
        acAfter: shares > 1e-9 ? netCash / shares : 0,
        gain: holding ? null : t.amount,
        gainPct: null,
      });
    } else {
      const ac = held > 0 ? basis / held : 0;
      const gain = t.shares * (t.price - ac);
      netCash -= t.shares * t.price;
      shares -= t.shares;
      basis -= Math.min(t.shares, Math.max(held, 0)) * ac;
      held -= t.shares;
      if (held <= 1e-9) { held = 0; basis = 0; }
      out.push({
        ...t,
        acAfter: ac,
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

/** Same-day rows without a time, newest first: dividends, then sales, then buys. */
const KIND_ORDER = { div: 0, sell: 1, buy: 2 };

/**
 * @param {Record<string, any> | null | undefined} holdings
 * @param {Record<string, any[]> | null} [divsByTicker]  each ticker's dividends (see `totalRealizedUsd`)
 * @returns {TxnRow[]}
 */
export function buildTransactionLog(holdings, divsByTicker = null) {
  if (!holdings || typeof holdings !== 'object') return [];
  /** @type {TxnRow[]} */
  const rows = [];
  for (const [ticker, h] of Object.entries(holdings)) {
    if (!h || h.isCash || ticker === 'CASH' || AUTO_DCA_TICKERS.has(ticker)) continue;
    const currency = h.currency || 'USD';
    // `annotateLedger` walks this holding in order, so each row arrives
    // knowing what it did to the position: a sale's banked gain, a
    // purchase's resulting average cost.
    for (const t of annotateLedger(h.lots, h.sells, divsByTicker?.[ticker])) {
      rows.push({
        ticker, kind: t.kind, date: t.date, shares: t.shares, price: t.price, amount: t.amount,
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
    || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
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
