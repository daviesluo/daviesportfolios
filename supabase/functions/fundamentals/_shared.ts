// Shared types, env vars, constants, and tiny helpers used by every
// other `fundamentals/_*.ts` sibling. Kept import-only (no top-level
// side effects beyond `Deno.env.get(...)` reads) so the test file
// can pull pure helpers without standing up the HTTP server.

export const FINNHUB_API_KEY           = Deno.env.get("FINNHUB_API_KEY") ?? "";
export const ALPHAVANTAGE_API_KEY      = Deno.env.get("ALPHAVANTAGE_API_KEY") ?? "";
export const SUPABASE_URL              = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export type EpsHistoryPoint = { date: string; eps: number };

export type Fundamentals = {
  pe: number;
  eps: number;
  pe3yAvg: number | null;
  // PEG (Price/Earnings-to-Growth) — Yahoo's forward P/E divided by
  // a blended 2-year forward EPS-growth rate (the average of
  // `earningsTrend`'s `0y` and `+1y` bucket growth — see
  // computeForwardGrowth). Forward over forward by convention:
  // trailing P/E paired with backward-looking growth is the classic
  // PEG misuse since the market prices in expectations, not history.
  // Yahoo dropped its `+5y` analyst long-term-growth bucket, so the
  // two near-term annual buckets are blended instead — still
  // multi-year, and steadier than a single year for the cyclical
  // semi/tech names. Computed server-side via `computePeg` so the
  // client just reads a single number. Optional — null when Yahoo
  // doesn't publish forwardPE or has no usable forward growth
  // (brand-new IPOs, illiquid OTC, consensus down-cycle, etc.).
  peg?: number;
  // Price-to-Sales: paired with pe / eps so a single fundamentals
  // response covers both the profitable (P/E view) and loss-maker
  // (P/S view) cases. Sourced from Yahoo's
  // `summaryDetail.priceToSalesTrailing12Months` (primary; USD-correct
  // for ADRs since Yahoo reports the ADR-side number) with Finnhub's
  // `psTTM` as a fallback. `ps3yAvg` averages the 3 most recent
  // annual `series.annual.ps` rows from Finnhub. Both are optional —
  // some tickers (newly-listed ADRs, indices, etc.) have no usable
  // revenue ratio and just return undefined. Client gates the
  // P/S YTD button on `eps <= 0 && ps > 0`.
  ps?: number;
  ps3yAvg?: number | null;
  // Internal-only USD market price (from Yahoo) — used to derive the
  // USD anchor (price/pe) for normalizing ADR TTM-EPS history.
  // Stripped from the response before it goes over the wire so the
  // client API stays the same.
  price?: number;
  // Pre-summed TTM diluted EPS at each quarter end. Named explicitly
  // to avoid colliding with the previous `epsHistory` contract that
  // returned RAW quarterly EPS — a stale Edge Function or
  // SW-cached response would otherwise be misinterpreted as TTM by
  // the new client (yields P/E ~4x too low).
  ttmEpsHistory?: EpsHistoryPoint[];
  // TTM sales-per-share at each quarter end — the P/S analogue of
  // ttmEpsHistory. Each point's `eps` field carries sales-per-share
  // (USD), so the client's priceDividedByTtmEps divides price by it
  // exactly the way it does for EPS. Built by rolling Yahoo's
  // `quarterlyTotalRevenue` into a TTM series, then rescaling to the
  // current USD sales-per-share — see the handler. Without this the
  // P/S YTD chart used a constant denominator and was just the price
  // chart rescaled (no step on earnings).
  ttmSalesHistory?: EpsHistoryPoint[];
  // Shares outstanding, derived server-side as Yahoo's marketCap ÷
  // regularMarketPrice — NOT defaultKeyStatistics.sharesOutstanding,
  // which for ADRs is the underlying-share count that doesn't pair
  // with the USD ADR price. The client multiplies this by the live
  // price for a price-synced market cap in the modal header.
  // Optional — absent when Yahoo doesn't publish a market cap.
  sharesOutstanding?: number;
  // Next earnings date as Unix seconds (start of the estimate range
  // when Yahoo gives a window of dates). Drives the "UPCOMING EARNINGS"
  // panel in the sidebar / mobile strip. Absent when Yahoo has no
  // upcoming earnings on file — newly-listed names, indices, ETFs,
  // crypto pairs, etc.
  earningsDate?: number;
  // BMO ("before market open") / AMC ("after market close") /
  // TAS ("time as supplied") timestamp hint, when Yahoo provides
  // earningsCallTimeName. Used to render a friendlier time column
  // than a raw timestamp on the earnings panel — for a 09:30 ET
  // earningsDate the "BMO" label is more meaningful to a US trader
  // than the UTC-converted scoreboard time.
  earningsTime?: string;
};

export type AvResult =
  | { ok: true; pe: number }
  | { ok: false; rateLimited: boolean };

export type YahooQuoteSummary = {
  pe: number;
  eps: number;
  ps: number;
  forwardPE: number;
  // Blended 2y forward EPS growth (avg of earningsTrend `0y` / `+1y`
  // bucket growth), decimal — 0.63 = 63 %. null when Yahoo has no
  // usable forward growth. Pairs with forwardPE for PEG — see
  // computePeg / computeForwardGrowth.
  epsGrowthFwd: number | null;
  price: number;
  // marketCap ÷ price (price-consistent, ADR-safe) — see
  // fetchYahooQuoteSummary. 0 when Yahoo didn't publish a market cap.
  sharesOutstanding: number;
  currency: string | null;
  // Next earnings date, Unix seconds. From calendarEvents.earnings.
  // earningsDate[0]?.raw. 0 when Yahoo has no scheduled date (very
  // newly listed; ETF; indices use this module too but never have
  // earnings). Returned alongside the time hint so the client can
  // decide whether to render "BMO" / "AMC" or a HH:MM string.
  earningsDateSec: number;
  earningsTime: string | null;
};

export const INDEX_ETF_PROXY: Record<string, string> = {
  "^GSPC": "SPY",   // S&P 500
  "^NDX":  "QQQ",   // NASDAQ 100
  "^RUT":  "IWM",   // Russell 2000
  "^SOX":  "SOXX",  // PHLX Semiconductor
};

export const INDEX_PE_3Y_AVG: Record<string, number> = {
  "^GSPC": 25.0,
  "^NDX":  30.0,
  "^RUT":  24.0,
  "^SOX":  35.0,
};

export const INDEX_PE_FALLBACK: Record<string, number> = {
  "^GSPC": 27.5,
  "^NDX":  33.0,
  "^RUT":  28.0,
  "^SOX":  40.0,
};

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * "Is this ticker something the fundamentals function can fetch a P/E
 * for?" — strips CASH, .PVT placeholders, CN funds, futures, forex,
 * crypto, and indices we don't have ETF proxies for. The Edge
 * Function filters its inputs with this predicate so the Finnhub /
 * AV calls only fire for tickers where they'd be meaningful. Pure
 * predicate, kept in _shared.ts because it depends on INDEX_ETF_PROXY.
 */
export function isFundamentalsTicker(t: string): boolean {
  if (!t || t === "CASH") return false;
  if (/\.PVT$/i.test(t))  return false;   // private holdings
  if (/^\d{6}$/.test(t))  return false;   // CN mutual funds
  if (/=F$/.test(t))      return false;   // futures
  if (/=X$/.test(t))      return false;   // forex pairs
  if (/[-]USD$/i.test(t)) return false;   // crypto
  if (t.startsWith("^") && !(t in INDEX_ETF_PROXY)) return false;
  return true;
}
