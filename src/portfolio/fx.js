// Currency detection + native→USD FX conversion. Pulled out of the
// since-retired utils.js barrel so the FX-only callers (computeMetrics, the modal's
// header dollar conversion, the captain-MV ranker) can import a
// 100-line file instead of a 900-line dump. Same behaviour as
// before — fxRateToUSD returns the silent-fallback flag and
// fxToUSD is the back-compat shim.

import { isEuroExchange } from '../prices/ticker_class.js';


// Per-ticker overrides for tickers whose suffix doesn't match their
// settle currency. LSE lists both GBP-denominated ETFs (VUAG.L /
// SEGM.L) and USD-denominated UCITS ETFs (VUAA.L / SAEM.L); the
// suffix `.L` rule below would force both into GBP and the FX path
// would then mis-convert the USD-quoted price by ~1.27× (Yahoo
// reports the USD ETFs in USD natively — `prices/index.ts` skips
// the GBp → GBP pence-divide for them, so the holding's currency
// must agree). Add new mappings here when extending the T212 sync
// allow-list with another non-default-suffix ticker.
const TICKER_CURRENCY_OVERRIDES = /** @type {const} */ ({
  'VUAA.L': 'USD',
  'SAEM.L': 'USD',
  // iShares Core S&P 500 and WisdomTree's 3x Nasdaq 100 trade in dollars on
  // the LSE (Yahoo's currency for both, 2026-10-07): Trading 212 fills them
  // in USD, so their gains are USD, not GBP.
  'CSPX.L': 'USD',
  'QQQ3.L': 'USD',
});

/**
 * Each holding has a native currency. We store price + cost in that
 * native currency and convert to USD on the fly using FX rates from
 * marketData. Detection rules:
 *   1. explicit per-ticker override (TICKER_CURRENCY_OVERRIDES) for
 *      cases where suffix lies about settle currency
 *   2. ticker-pattern fallback (works without a live fetch):
 *        - 6-digit numeric → CNY (Chinese mutual fund)
 *        - ticker ends in .L → GBP (London Stock Exchange)
 *        - ticker ends in .HK → HKD (Hong Kong)
 *        - ticker ends in a euro-zone exchange suffix (.PA Paris, .AS
 *          Amsterdam, .DE XETRA, .MI Milan, .MC Madrid, …) → EUR
 *        - everything else → USD
 * @param {string} ticker
 */
export function detectCurrency(ticker) {
  if (ticker in TICKER_CURRENCY_OVERRIDES) {
    return TICKER_CURRENCY_OVERRIDES[/** @type {keyof typeof TICKER_CURRENCY_OVERRIDES} */ (ticker)];
  }
  if (/^\d{6}$/.test(ticker)) return "CNY";
  if (/\.L$/i.test(ticker))   return "GBP";
  if (/\.HK$/i.test(ticker))  return "HKD";
  // Euro-zone exchanges — see isEuroExchange for the suffix list (single
  // source) and why the non-euro European venues are excluded.
  if (isEuroExchange(ticker)) return "EUR";
  return "USD";
}

// Symbol + decimal rules for the avg-cost field (what the user typed).
// We keep 4 decimals for GBP/CNY so sub-penny precision isn't lost.
const CURRENCY_SYMBOLS = { USD: "$", GBP: "£", CNY: "¥", HKD: "HK$", EUR: "€" };

/** @param {string} cur */
export function currencySymbol(cur) { return CURRENCY_SYMBOLS[cur] || "$"; }

/**
 * FX rate: how many USD one unit of `currency` is worth, given current
 * market data. Yahoo's GBPUSD=X and EURUSD=X are quoted GBP→USD /
 * EUR→USD directly. USDCNY=X is USD→CNY (we invert). USDHKD=X same
 * inversion.
 *
 * Returns `{ rate, missing }` where `missing` is true when the live
 * FX pair couldn't be read and we fell back to 1:1. Callers MUST
 * check `missing` before treating the converted USD as accurate —
 * silently returning rate=1 was misreporting GBP portfolios by ~20%
 * during a brief Yahoo FX outage. `fxToUSD()` (back-compat shim
 * below) preserves the old number-only return for callers that only
 * need the rate.
 *
 * @param {string | null | undefined} currency
 * @param {Record<string, {lastPrice?: number}> | null | undefined} marketData
 * @returns {{ rate: number, missing: boolean }}
 */
export function fxRateToUSD(currency, marketData) {
  if (!currency || currency === "USD") return { rate: 1, missing: false };
  if (currency === "GBP") {
    const r = marketData?.["GBPUSD=X"]?.lastPrice;
    return (typeof r === "number" && r > 0)
      ? { rate: r, missing: false }
      : { rate: 1, missing: true };
  }
  if (currency === "EUR") {
    const r = marketData?.["EURUSD=X"]?.lastPrice;
    return (typeof r === "number" && r > 0)
      ? { rate: r, missing: false }
      : { rate: 1, missing: true };
  }
  if (currency === "CNY") {
    const r = marketData?.["USDCNY=X"]?.lastPrice;
    return (typeof r === "number" && r > 0)
      ? { rate: 1 / r, missing: false }
      : { rate: 1, missing: true };
  }
  if (currency === "HKD") {
    const r = marketData?.["USDHKD=X"]?.lastPrice;
    return (typeof r === "number" && r > 0)
      ? { rate: 1 / r, missing: false }
      : { rate: 1, missing: true };
  }
  return { rate: 1, missing: false };
}

/**
 * Whether a figure converted from `holdings` must wait for the exchange rates (the board's own rule is `fxPendingOf`
 * in metrics.js, over the holdings on the board). Before the first market data has landed (a first visit, or a market
 * cache over a week old) `fxRateToUSD` values a holding whose pair is missing at 1:1, a CNY fund at seven times its
 * size; so while that is so for any of `holdings`, cash aside, the figure shows a dash or its waiting state. Once the
 * market data has landed, a pair still missing is the FX MISSING badge's, as before. For what values more than the
 * board: the performance panel (every holding of the book, sold ones included) and the transaction history's total.
 * @param {Iterable<any>} holdings
 * @param {Record<string, {lastPrice?: number}> | null | undefined} marketData
 * @param {boolean} marketDataReady
 */
export function fxPendingFor(holdings, marketData, marketDataReady) {
  if (marketDataReady) return false;
  for (const h of holdings) {
    if (h && !h.isCash && fxRateToUSD(h.currency, marketData).missing) return true;
  }
  return false;
}

/**
 * Back-compat shim — callers that only want the rate. Prefer
 * `fxRateToUSD` so you can detect the silent-fallback case.
 * @param {string | null | undefined} currency
 * @param {any} marketData
 */
export function fxToUSD(currency, marketData) {
  return fxRateToUSD(currency, marketData).rate;
}
