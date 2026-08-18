// Currency detection + native→USD FX conversion. Pulled out of the
// since-retired utils.js barrel so the FX-only callers (computeMetrics, the modal's
// header dollar conversion, the captain-MV ranker) can import a
// 100-line file instead of a 900-line dump. Same behaviour as
// before — fxRateToUSD returns the silent-fallback flag and
// fxToUSD is the back-compat shim.

import { isEuroExchange } from './ticker_class.js';


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
 * Back-compat shim — callers that only want the rate. Prefer
 * `fxRateToUSD` so you can detect the silent-fallback case.
 * @param {string | null | undefined} currency
 * @param {any} marketData
 */
export function fxToUSD(currency, marketData) {
  return fxRateToUSD(currency, marketData).rate;
}

/**
 * Freeze deposit conversion rates once. Portfolio VALUE keeps using live
 * FX; historical money-in uses this persisted map so a past GBP deposit
 * does not move every time GBPUSD ticks.
 *
 * @param {Record<string, number> | null | undefined} existing
 * @param {Record<string, {lastPrice?: number}> | null | undefined} marketData
 */
export function freezeDepositFxRates(existing, marketData) {
  const out = /** @type {Record<string, number>} */ ({ USD: 1, ...(existing || {}) });
  for (const currency of ['GBP', 'EUR', 'CNY', 'HKD']) {
    if (typeof out[currency] === 'number' && out[currency] > 0) continue;
    const rate = fxRateToUSD(currency, marketData);
    if (!rate.missing && rate.rate > 0) out[currency] = rate.rate;
  }
  return out;
}

/**
 * @param {string | null | undefined} currency
 * @param {Record<string, number> | null | undefined} rates
 */
export function depositFxRate(currency, rates) {
  if (!currency || currency === 'USD') return 1;
  const rate = rates?.[currency];
  return typeof rate === 'number' && rate > 0 ? rate : 1;
}

/**
 * @param {{
 *   holdings?: Record<string, {isCash?: boolean, currency?: string}>,
 *   depositFxRates?: Record<string, number>,
 * } | null | undefined} portfolio
 */
export function depositFxMissing(portfolio) {
  for (const [ticker, holding] of Object.entries(portfolio?.holdings || {})) {
    if (holding?.isCash || ticker === 'CASH') continue;
    const currency = holding?.currency || detectCurrency(ticker);
    if (currency === 'USD') continue;
    const rate = portfolio?.depositFxRates?.[currency];
    if (!(typeof rate === 'number' && rate > 0)) return true;
  }
  return false;
}
