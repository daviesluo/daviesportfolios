// Yahoo Finance integration — the primary stock-fundamentals source.
// Three endpoints in here:
//
//   1. quoteSummary (modules summaryDetail / defaultKeyStatistics /
//      price / earningsTrend). The main shot — pe / eps / ps /
//      forwardPE / forward-growth / shares-outstanding / price.
//      Needs a crumb token (getYahooCrumb below).
//
//   2. The chart endpoint (v8/finance/chart) as a last-resort USD
//      price anchor when quoteSummary's price-ish fields are stripped
//      for anon callers on some ADRs.
//
//   3. fundamentals-timeseries for the TTM-EPS and quarterly-revenue
//      history that feed the P/E and P/S YTD charts.
//
// Crumb cache is module-scoped so the 6 parallel stock workers share
// one handshake per Edge Function worker lifetime — see getYahooCrumb.

import { computeForwardGrowth } from "./_math.ts";
import type { YahooQuoteSummary } from "./_shared.ts";

// ---- Yahoo crumb auth ----------------------------------------------
//
// Yahoo's `quoteSummary` endpoint started returning 401 "Invalid
// Crumb" for anon callers. The crumb workflow is Yahoo's own
// consumer-site auth mechanism: GET a session cookie from
// fc.yahoo.com, exchange it for a crumb token at
// /v1/test/getcrumb, then attach BOTH (cookie header + `?crumb=`
// param) to every quoteSummary request. The pair stays valid for
// the lifetime of an Edge Function worker, so we handshake once at
// first use and cache it in module scope. The single-flight guard
// keeps the 6 parallel stock workers from each kicking off their
// own handshake on a cold start.

export const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _yahooCrumb: { crumb: string; cookie: string } | null = null;
let _yahooCrumbInFlight: Promise<{ crumb: string; cookie: string } | null> | null = null;

export async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (_yahooCrumb) return _yahooCrumb;
  if (_yahooCrumbInFlight) return _yahooCrumbInFlight;
  _yahooCrumbInFlight = (async () => {
    try {
      // Step 1 — session cookie. fc.yahoo.com 404s but still sends
      // Set-Cookie; getSetCookie() returns each header separately so
      // the comma inside an `expires=` date doesn't get mis-split.
      const cookieRes = await fetch("https://fc.yahoo.com/", {
        headers: { "User-Agent": YAHOO_UA },
        signal: AbortSignal.timeout(8_000),
      });
      const setCookies = cookieRes.headers.getSetCookie?.() ?? [];
      const cookie = setCookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
      if (!cookie) return null;
      // Step 2 — exchange the cookie for a crumb token (plain text).
      const crumbRes = await fetch(
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
        {
          headers: { "User-Agent": YAHOO_UA, "Cookie": cookie },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!crumbRes.ok) return null;
      const crumb = (await crumbRes.text()).trim();
      // Real crumbs are short alphanumeric tokens; an HTML error page
      // would be much longer and contain '<'.
      if (!crumb || crumb.length > 64 || crumb.includes("<")) return null;
      _yahooCrumb = { crumb, cookie };
      return _yahooCrumb;
    } catch {
      return null;
    } finally {
      _yahooCrumbInFlight = null;
    }
  })();
  return _yahooCrumbInFlight;
}

// ---- Yahoo quoteSummary (primary individual-stock source) ----------
//
// Pre-computes trailingPE / trailingEps / priceToSales / forwardPE
// with every side on the same USD scale because the consumer-facing
// site has to show consistent numbers — so unlike Finnhub (whose
// `peTTM` divides the USD ADR price by the foreign-currency EPS,
// yielding TSM ~1.22 / SFTBY ~0.07) Yahoo's ratios are ADR-safe
// out of the box. Finnhub is only the fallback when Yahoo is
// unreachable or the crumb handshake fails.

export async function fetchYahooQuoteSummary(symbol: string): Promise<YahooQuoteSummary | null> {
  // quoteSummary now requires a crumb token — see getYahooCrumb().
  // `earningsTrend` is needed for the blended forward EPS growth
  // that pairs with `forwardPE` to produce PEG — see computePeg.
  const auth = await getYahooCrumb();
  if (!auth) return null;  // handshake failed → caller falls to Finnhub
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=summaryDetail,defaultKeyStatistics,price,earningsTrend,calendarEvents` +
    `&crumb=${encodeURIComponent(auth.crumb)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json,text/plain,*/*",
        "Cookie": auth.cookie,
      },
      signal: AbortSignal.timeout(8_000),
    });
    // A 401 means the crumb went stale mid-session — drop the cache
    // so the next call re-handshakes. This request still fails (the
    // caller falls through to Finnhub) but the worker recovers for
    // every subsequent symbol.
    if (res.status === 401) {
      _yahooCrumb = null;
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return null;
    const peRaw  = result?.summaryDetail?.trailingPE?.raw
                ?? result?.defaultKeyStatistics?.trailingPE?.raw;
    const epsRaw = result?.defaultKeyStatistics?.trailingEps?.raw;
    // Price-to-Sales TTM — used for the loss-maker P/S view. Yahoo
    // reports the ADR-side number directly so this is USD-correct
    // for ADRs (unlike Finnhub's ps which would inherit the EPS
    // currency mismatch). summaryDetail.priceToSalesTrailing12Months
    // is the canonical field; falls through to defaultKeyStatistics
    // for the (very rare) symbols where summaryDetail strips it.
    const psRaw  = result?.summaryDetail?.priceToSalesTrailing12Months?.raw
                ?? result?.defaultKeyStatistics?.priceToSalesTrailing12Months?.raw;
    // Yahoo's USD market price for the symbol — used as the anchor
    // (price/pe = implied USD EPS) when rescaling foreign-currency
    // TTM-EPS history for ADRs. `price.regularMarketPrice` is the
    // ideal field but Yahoo strips it from anon (no-crumb) callers
    // for some symbols, so we walk a fallback chain through
    // summaryDetail — all USD for US-listed ADRs, all guaranteed
    // present in the same response, no extra HTTP call. Each is a
    // few-day-stale price at worst; that's well inside the noise of
    // a P/E chart's FX rescale (single-digit % drift).
    const priceRaw =
      result?.price?.regularMarketPrice?.raw
      ?? result?.summaryDetail?.regularMarketPreviousClose?.raw
      ?? result?.summaryDetail?.previousClose?.raw
      ?? result?.summaryDetail?.fiftyDayAverage?.raw
      ?? result?.summaryDetail?.twoHundredDayAverage?.raw;
    // Market cap — for the modal header's live market-cap line. We
    // turn it into a share count (marketCap ÷ price, below) rather
    // than ship the snapshot, so the client can multiply by the live
    // price. Deriving shares this way — vs defaultKeyStatistics.
    // sharesOutstanding — keeps it price-consistent for ADRs: both
    // marketCap and price here are the USD ADR-side numbers.
    const marketCapRaw = result?.price?.marketCap?.raw
                      ?? result?.summaryDetail?.marketCap?.raw;
    // Forward P/E + blended forward EPS growth for PEG. Forward P/E
    // pairs with forward growth by convention — using trailing P/E
    // with forward growth (or vice versa) is the classic PEG misuse
    // since the market prices in expectations, not history. forwardPE
    // is optional (absent for brand-new IPOs, illiquid OTC, names
    // without analyst coverage); the growth denominator is derived
    // from `earningsTrend` by computeForwardGrowth.
    const fwdPeRaw = result?.summaryDetail?.forwardPE?.raw
                  ?? result?.defaultKeyStatistics?.forwardPE?.raw;
    const epsGrowthFwd = computeForwardGrowth(result?.earningsTrend?.trend);
    const currency = result?.price?.currency ?? null;
    // Next earnings date. Yahoo's calendarEvents.earnings.earningsDate
    // is an array of one or two entries — when a window is published
    // (estimated quarter end ± few days) it's [start, end]; when the
    // date is firm it's a single entry. Take the FIRST entry as the
    // "next" date — earliest-possible report time so the panel
    // reflects "you might hear from this company on or after this
    // date". `earningsCallTimeName` is "before market open" / "after
    // market close" / "time as supplied" when set; the client
    // translates to compact BMO / AMC labels.
    const earningsDates = result?.calendarEvents?.earnings?.earningsDate;
    const earningsDateRaw = Array.isArray(earningsDates) && earningsDates.length > 0
      ? Number(earningsDates[0]?.raw)
      : NaN;
    const earningsDateSec = isFinite(earningsDateRaw) && earningsDateRaw > 0 ? earningsDateRaw : 0;
    const earningsTimeName = result?.calendarEvents?.earnings?.earningsCallTimeName;
    const earningsTime = typeof earningsTimeName === 'string' && earningsTimeName.length > 0
      ? earningsTimeName
      : null;
    const pe    = Number(peRaw);
    const eps   = Number(epsRaw);
    const ps    = Number(psRaw);
    const fwdPe = Number(fwdPeRaw);
    const price = Number(priceRaw);
    const marketCap = Number(marketCapRaw);
    // Share count, price-consistent (see marketCapRaw). 0 when either
    // input is missing — the client then just omits the market-cap
    // line rather than rendering a wrong number.
    const sharesOutstanding =
      isFinite(marketCap) && marketCap > 0 && isFinite(price) && price > 0
        ? marketCap / price
        : 0;
    // Use 0 as the "no usable value" sentinel so the response shape
    // stays uniform and the caller can decide per-field whether to
    // show that view. Reject the whole call only when EVERY ratio is
    // missing — loss-makers have no pe/eps but do publish ps, and we
    // want to keep that row alive to back the new P/S YTD button.
    const pe2     = isFinite(pe)    && pe    > 0 ? pe    : 0;
    const eps2    = isFinite(eps)   && eps   > 0 ? eps   : 0;
    const ps2     = isFinite(ps)    && ps    > 0 ? ps    : 0;
    const fwdPe2  = isFinite(fwdPe) && fwdPe > 0 ? fwdPe : 0;
    if (pe2 === 0 && eps2 === 0 && ps2 === 0) return null;
    return {
      pe:  pe2,
      eps: eps2,
      ps:  ps2,
      forwardPE:    fwdPe2,
      epsGrowthFwd, // null | positive decimal — see computeForwardGrowth
      price: isFinite(price) && price > 0 ? price : 0,
      sharesOutstanding,
      currency: typeof currency === 'string' ? currency : null,
      earningsDateSec,
      earningsTime,
    };
  } catch {
    return null;
  }
}

/**
 * Yahoo's chart endpoint returns the last day's bars plus a `meta`
 * block containing `regularMarketPrice` as a plain USD number.
 * Unlike quoteSummary's `price` / `summaryDetail` blocks — which
 * Yahoo strips price-ish fields out of for unauthenticated callers
 * targeting ADRs (TSM / SFTBY / ASML all returned NULL for
 * regularMarketPrice / previousClose / fiftyDayAverage in prod) —
 * the chart endpoint is what Yahoo's own consumer site uses and it
 * answers anon callers reliably (no crumb needed). Used as the
 * last-resort USD anchor for the TTM-EPS rescale when quoteSummary
 * didn't supply a price.
 */
export async function fetchYahooChartPrice(symbol: string): Promise<number> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1d&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const price = Number(data?.chart?.result?.[0]?.meta?.regularMarketPrice);
    return isFinite(price) && price > 0 ? price : 0;
  } catch {
    return 0;
  }
}

// Fetches the rolling TTM diluted EPS at each quarter-end for the
// symbol, via Yahoo's `fundamentals-timeseries` API. Yahoo returns the
// already-summed TTM directly (= sum of last 4 quarterly EPS as of
// each quarter-end), with 5+ years of history per ticker on the free /
// public endpoint — much more than Finnhub's free `/stock/earnings`,
// which caps at 4 quarters and so can never give the client enough
// history to recompute a meaningful TTM at YTD start. Each entry is
// `{ date: "YYYY-MM-DD" (quarter end), eps: <TTM diluted EPS> }`.
// Returns null on any error or when the response is empty so the
// dispatcher cleanly falls back.
export async function fetchYahooTrailingEpsHistory(
  symbol: string,
): Promise<Array<{ date: string; eps: number }> | null> {
  // Attach the crumb + cookie defensively — fundamentals-timeseries
  // hasn't been confirmed to require auth, but quoteSummary on the
  // same host does now, and a crumb param is harmless on an endpoint
  // that ignores it. If the handshake fails we still try anon.
  const auth = await getYahooCrumb();
  const nowSec = Math.floor(Date.now() / 1000);
  const fiveYearsAgoSec = nowSec - 5 * 365 * 86400;
  const url =
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/` +
    `${encodeURIComponent(symbol)}?type=trailingDilutedEPS` +
    `&period1=${fiveYearsAgoSec}&period2=${nowSec}` +
    (auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "");
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json,text/plain,*/*",
        ...(auth ? { "Cookie": auth.cookie } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const arr = data?.timeseries?.result?.[0]?.trailingDilutedEPS;
    if (!Array.isArray(arr)) return null;
    const out = arr
      .map((p: any) => ({
        date: String(p?.asOfDate ?? ""),
        eps: Number(p?.reportedValue?.raw),
      }))
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isFinite(r.eps) && r.eps > 0)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

// Fetches the last ~5 quarters of total revenue for the symbol via
// Yahoo's `fundamentals-timeseries`. The revenue-side
// `trailingTotalRevenue` type only ships ~2 TTM points and which
// quarters they cover is inconsistent (the May-2026 probe found TEM
// got [Q2, Q4] — a usable mid-window step — while SOUN got [Q2,
// next-Q1], which left the YTD chart flat). `quarterlyTotalRevenue`
// ships ~5 RAW quarters instead; the caller runs
// `rollingTtmFromRawQuarterly` over them to build the TTM series, so
// the P/S chart steps reliably within a YTD window. Each entry is
// `{ date, eps: <quarterly total revenue> }` — the `eps` field name
// is reused so the shared rolling-sum / rescale helpers accept it
// unchanged. Returns null on any error or empty response so the
// caller cleanly falls back to the constant-denominator path.
export async function fetchYahooQuarterlyRevenue(
  symbol: string,
): Promise<Array<{ date: string; eps: number }> | null> {
  const auth = await getYahooCrumb();
  const nowSec = Math.floor(Date.now() / 1000);
  const fiveYearsAgoSec = nowSec - 5 * 365 * 86400;
  const url =
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/` +
    `${encodeURIComponent(symbol)}?type=quarterlyTotalRevenue` +
    `&period1=${fiveYearsAgoSec}&period2=${nowSec}` +
    (auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "");
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json,text/plain,*/*",
        ...(auth ? { "Cookie": auth.cookie } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const arr = data?.timeseries?.result?.[0]?.quarterlyTotalRevenue;
    if (!Array.isArray(arr)) return null;
    const out = arr
      .map((p: any) => ({
        date: String(p?.asOfDate ?? ""),
        eps: Number(p?.reportedValue?.raw),
      }))
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isFinite(r.eps) && r.eps > 0)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
