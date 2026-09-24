// The price half of each holding, as the page last showed it.
//
// A holding carries two kinds of field. The BOOK — shares, cost, lots,
// sells, currency, closed — is the owner's: it lives in the server row and
// it is what `portfolioUserFingerprint` diffs to decide a save. The PRICE
// fields below are the market's: the refresh tick rewrites them every 30 s
// and no save is ever about them.
//
// A reload gets its book in two steps — the local cache of the last load,
// then the server row — and the prices inside BOTH are whatever they were
// when that row was last loaded or saved, not what this page showed a
// minute ago. So the scoreboard, the tiles and the chart's live point
// painted one set of old numbers, then another, then the live quotes: three
// readings in two seconds (measured: $2,872 → $2,934 → $3,183 on a fixture
// whose last shown total was $3,183).
//
// This module keeps what the page showed (Storage.saveLastPrices after
// every tick) and draws it over whichever book is on screen until the live
// quotes land, ticker by ticker. It is drawn over a COPY of the portfolio,
// for display: the portfolio state — the object the save effect sends —
// never holds it, so nothing here can reach the server.
//
// Cash and `.PVT` holdings are left out on both sides. Their `lastPrice` is
// the book (a balance, a valuation the owner typed in): the tick never
// prices them, so a shown copy would outlive an edit made on another device.

import { isPvt } from '../prices/ticker_class.js';

/** The fields the price tick writes, and the only ones this module touches. */
export const SHOWN_PRICE_FIELDS = /** @type {const} */ (
  ['lastPrice', 'prevClose', 'dayPct', 'extPrice', 'extDayPct', 'extPriceTrusted']);

/**
 * Whether a holding's price is the market's (priced by the tick) rather
 * than part of the book.
 * @param {string} ticker
 * @param {any} h
 */
function marketPriced(ticker, h) {
  return !!h && !h.isCash && ticker !== 'CASH' && !isPvt(ticker);
}

/**
 * The price fields of every market-priced holding, keyed by ticker — what
 * Storage.saveLastPrices keeps. A holding without a positive `lastPrice`
 * has nothing worth showing and is left out. `null` survives (an absent
 * after-hours quote is a thing that was shown); `undefined` does not.
 * @param {Record<string, any> | null | undefined} holdings
 * @returns {Record<string, Record<string, any>>}
 */
export function shownPricesOf(holdings) {
  /** @type {Record<string, Record<string, any>>} */
  const out = {};
  for (const [t, h] of Object.entries(holdings || {})) {
    if (!marketPriced(t, h)) continue;
    if (typeof h.lastPrice !== 'number' || !(h.lastPrice > 0)) continue;
    /** @type {Record<string, any>} */
    const p = {};
    for (const f of SHOWN_PRICE_FIELDS) if (h[f] !== undefined) p[f] = h[f];
    out[t] = p;
  }
  return out;
}

/**
 * `portfolio` with each market-priced holding's price fields taken from
 * `shown`, and every other field — the book — left exactly as it is.
 * Returns the SAME object when nothing applies, so a memo keyed on it does
 * not churn once the overlay is spent.
 * @template {{ holdings: Record<string, any> } | null | undefined} P
 * @param {P} portfolio
 * @param {Record<string, Record<string, any>> | null | undefined} shown
 * @returns {P}
 */
export function withShownPrices(portfolio, shown) {
  if (!portfolio || !shown) return portfolio;
  /** @type {Record<string, any> | null} */
  let holdings = null;
  for (const [t, p] of Object.entries(shown)) {
    const h = portfolio.holdings?.[t];
    if (!marketPriced(t, h) || !p || typeof p !== 'object') continue;
    const next = { ...h };
    for (const f of SHOWN_PRICE_FIELDS) if (f in p) next[f] = p[f];
    if (!holdings) holdings = { ...portfolio.holdings };
    holdings[t] = next;
  }
  return holdings ? /** @type {P} */ ({ ...portfolio, holdings }) : portfolio;
}

/**
 * `shown` without the tickers a tick has just priced: from then on each
 * shows its live quote. The same object back when none of them was in it.
 * @param {Record<string, Record<string, any>>} shown
 * @param {Iterable<string>} priced
 * @returns {Record<string, Record<string, any>>}
 */
export function withoutPriced(shown, priced) {
  /** @type {Record<string, Record<string, any>> | null} */
  let out = null;
  for (const t of priced) {
    if (!(t in shown)) continue;
    if (!out) out = { ...shown };
    delete out[t];
  }
  return out ?? shown;
}
