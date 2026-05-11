// Currency detection + native→USD FX conversion. Pulled out of
// utils.js so the FX-only callers (computeMetrics, the modal's
// header dollar conversion, the captain-MV ranker) can import a
// 100-line file instead of a 900-line dump. Same behaviour as
// before — fxRateToUSD returns the silent-fallback flag and
// fxToUSD is the back-compat shim.

/**
 * Each holding has a native currency. We store price + cost in that
 * native currency and convert to USD on the fly using FX rates from
 * marketData. Detection rules (ticker-pattern based so it works
 * without a live fetch):
 *   - 6-digit numeric → CNY (Chinese mutual fund)
 *   - ticker ends in .L → GBP (London Stock Exchange)
 *   - ticker ends in .HK → HKD (Hong Kong)
 *   - everything else → USD
 * @param {string} ticker
 */
export function detectCurrency(ticker) {
  if (/^\d{6}$/.test(ticker)) return "CNY";
  if (/\.L$/i.test(ticker))   return "GBP";
  if (/\.HK$/i.test(ticker))  return "HKD";
  return "USD";
}

// Symbol + decimal rules for the avg-cost field (what the user typed).
// We keep 4 decimals for GBP/CNY so sub-penny precision isn't lost.
const CURRENCY_SYMBOLS = { USD: "$", GBP: "£", CNY: "¥", HKD: "HK$" };

/** @param {string} cur */
export function currencySymbol(cur) { return CURRENCY_SYMBOLS[cur] || "$"; }

/**
 * FX rate: how many USD one unit of `currency` is worth, given current
 * market data. Yahoo's GBPUSD=X is quoted GBP→USD directly. USDCNY=X
 * is USD→CNY (we invert). USDHKD=X same inversion.
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
