// Supabase Edge Function: fundamentals
//
// Returns current TTM P/E + trailing EPS for a list of tickers from
// two sources, picked by symbol:
//
//   1. Individual stocks → Finnhub `/stock/metric` (free tier:
//      60 calls / minute, no payment info).
//
//   2. Four big US indices (^GSPC / ^NDX / ^RUT / ^SOX) → Alpha
//      Vantage `OVERVIEW` against ETF proxies (SPY / QQQ / IWM /
//      SOXX), with a 24 h server-side cache in
//      `index_fundamentals_cache`. AV's free tier enforces a hard
//      "1 request per second" pace plus a 25 / day total — so the
//      cache + serial dispatch (1.2 s between calls in this Edge
//      Function invocation) keep us comfortably inside both ceilings
//      with a 4-ETF working set.
//
// Layered fallback for index P/E (newest → oldest data):
//   a. Fresh cache (< 24 h)               — almost every request
//   b. Live Alpha Vantage                 — once per ETF per 24 h
//   c. Stale cache (any age, last-known)  — when AV is rate-limited
//   d. Hardcoded INDEX_PE_FALLBACK        — first deploy / total outage
//
// 3-year-average P/E is hardcoded since AV's free tier doesn't
// expose historical annuals; refresh ~yearly.
//
// Env:
//   FINNHUB_API_KEY            (individual-stock P/E)
//   ALPHAVANTAGE_API_KEY       (index P/E)
//   SUPABASE_URL               (auto-injected; cache layer)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected; cache layer)
//
// Call: GET /functions/v1/fundamentals?tickers=NVDA,GOOG,^GSPC
// Returns:
//   {
//     NVDA:  { pe: 40.16, eps: 4.90, pe3yAvg: 43.13 },
//     ^GSPC: { pe: 27.5,  eps: 0,    pe3yAvg: 25.0 }
//   }

const FINNHUB_API_KEY            = Deno.env.get("FINNHUB_API_KEY") ?? "";
const ALPHAVANTAGE_API_KEY       = Deno.env.get("ALPHAVANTAGE_API_KEY") ?? "";
const SUPABASE_URL               = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EpsHistoryPoint = { date: string; eps: number };
type Fundamentals = {
  /** Trailing P/E as published by Yahoo (ADR-currency-safe). */
  pe: number;
  /** 3-year average P/E from Finnhub annual series. */
  pe3yAvg: number | null;
  /**
   * Trading currency (USD for US-listed). When this matches
   * `financialCurrency` the underlying reports in USD too and the
   * P/E YTD historical chart can be drawn safely. When they
   * differ (ADRs), the frontend hides the P/E YTD button — we'd
   * need daily historical FX rates to do it right and we don't
   * have those.
   */
  currency: string | null;
  financialCurrency: string | null;
  /**
   * Quarter-end TTM-EPS history (USD), present only when
   * `currency === financialCurrency` so the modal can divide USD
   * prices by USD EPS without a unit mismatch. Absent for ADRs.
   */
  ttmEpsHistory?: EpsHistoryPoint[];
};

const INDEX_ETF_PROXY: Record<string, string> = {
  "^GSPC": "SPY",   // S&P 500
  "^NDX":  "QQQ",   // NASDAQ 100
  "^RUT":  "IWM",   // Russell 2000
  "^SOX":  "SOXX",  // PHLX Semiconductor
};

const INDEX_PE_3Y_AVG: Record<string, number> = {
  "^GSPC": 25.0,
  "^NDX":  30.0,
  "^RUT":  24.0,
  "^SOX":  35.0,
};

const INDEX_PE_FALLBACK: Record<string, number> = {
  "^GSPC": 27.5,
  "^NDX":  33.0,
  "^RUT":  28.0,
  "^SOX":  40.0,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Inter-request delay enforced by AV's free tier. The header allowance
// is 1 req / sec; 1.2 s gives a 20% safety margin so back-to-back
// queries never trip the throttle even when network jitter is
// counted as request time on AV's side.
const AV_INTER_REQUEST_MS = 1_200;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Cache layer ----------------------------------------------------

async function readCachedPe(etfSymbol: string): Promise<{ pe: number; ageMs: number } | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/index_fundamentals_cache` +
      `?symbol=eq.${encodeURIComponent(etfSymbol)}&select=pe,fetched_at`;
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    const fetchedAt = new Date(row?.fetched_at).getTime();
    if (!isFinite(fetchedAt)) return null;
    const pe = Number(row?.pe);
    if (!isFinite(pe) || pe <= 0) return null;
    return { pe, ageMs: Date.now() - fetchedAt };
  } catch {
    return null;
  }
}

async function writeCachedPe(etfSymbol: string, pe: number): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const url = `${SUPABASE_URL}/rest/v1/index_fundamentals_cache`;
    await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        symbol: etfSymbol,
        pe,
        fetched_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch { /* best effort */ }
}

// ---- Alpha Vantage --------------------------------------------------

type AvResult =
  | { ok: true; pe: number }
  | { ok: false; rateLimited: boolean };

async function fetchAlphaVantageEtfPe(etfSymbol: string): Promise<AvResult> {
  if (!ALPHAVANTAGE_API_KEY) return { ok: false, rateLimited: false };
  const url = `https://www.alphavantage.co/query?function=OVERVIEW` +
    `&symbol=${encodeURIComponent(etfSymbol)}` +
    `&apikey=${encodeURIComponent(ALPHAVANTAGE_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, rateLimited: false };
    const data = await res.json();
    // AV signals throttle / quota issues by returning a JSON envelope
    // with `Information` (per-second rate hint) or `Note` (daily
    // quota). Bail loudly so the caller can stop pounding AV with the
    // remaining ETFs in the same batch.
    if (data?.Information || data?.Note) {
      return { ok: false, rateLimited: true };
    }
    const pe = Number(data?.PERatio);
    if (isFinite(pe) && pe > 0) return { ok: true, pe };
    // Empty `{}` shape on free tier when bursts overlap — also treat
    // as rate-limit so we don't keep firing.
    if (!data || Object.keys(data).length === 0) {
      return { ok: false, rateLimited: true };
    }
    return { ok: false, rateLimited: false };
  } catch {
    return { ok: false, rateLimited: false };
  }
}

// ---- Index dispatcher (sequential to respect AV rate cap) ----------

async function resolveIndexPe(
  indexSymbol: string,
  avBlocked: { value: boolean },
  isFirstAvCall: { value: boolean },
): Promise<Fundamentals | null> {
  const etf = INDEX_ETF_PROXY[indexSymbol];
  if (!etf) return null;

  const cached = await readCachedPe(etf);
  if (cached && cached.ageMs < CACHE_TTL_MS) {
    // (a) fresh cache
    return { pe: cached.pe, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null, currency: "USD", financialCurrency: "USD" };
  }

  // Stale or missing — try AV unless the batch already saw a rate
  // limit (any further calls would just compound the problem and burn
  // daily quota for nothing).
  if (!avBlocked.value && ALPHAVANTAGE_API_KEY) {
    if (!isFirstAvCall.value) {
      // Pace consecutive AV calls to honour the free-tier 1 req/s cap.
      await sleep(AV_INTER_REQUEST_MS);
    }
    isFirstAvCall.value = false;
    const av = await fetchAlphaVantageEtfPe(etf);
    if (av.ok) {
      // (b) live AV — write back and use.
      await writeCachedPe(etf, av.pe);
      return { pe: av.pe, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null, currency: "USD", financialCurrency: "USD" };
    }
    if (av.rateLimited) avBlocked.value = true;
  }

  // (c) stale cache — better than the static fallback because it's
  // still real AV-sourced data, just possibly a few days old.
  if (cached) {
    return { pe: cached.pe, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null, currency: "USD", financialCurrency: "USD" };
  }

  // (d) hardcoded fallback — only on first deploy or total outage.
  const fb = INDEX_PE_FALLBACK[indexSymbol];
  if (fb) {
    return { pe: fb, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null, currency: "USD", financialCurrency: "USD" };
  }
  return null;
}

// ---- Yahoo quote (only source of truth for trailingPE) -------------
//
// We exclusively use Yahoo's own `trailingPE` field — never compute
// P/E ourselves. Finnhub's peTTM is broken for ADRs (USD price ÷
// foreign-currency EPS = e.g. TSM 1.22, SFTBY 0.07, ASML 63 vs the
// real ~26 / ~15 / ~33), and even with sanity gates that's a bad
// answer to a question we shouldn't have asked. Yahoo handles ADR
// currency normalization correctly on the consumer site, so
// `trailingPE` from quote IS the official answer.
//
// Yahoo's modern quote endpoints (/v7, /v10) require a crumb +
// cookie pair. Workflow:
//   1. GET https://fc.yahoo.com  → response sets A1/A3 cookies
//   2. GET https://query1.finance.yahoo.com/v1/test/getcrumb
//      with that cookie → returns the crumb string
//   3. /v7/finance/quote?symbols=...&crumb=...  with the cookie
//
// The crumb+cookie is cached at module scope for ~1 h so a 30-ticker
// portfolio refresh only pays the auth handshake once per warm Edge
// Function instance.

const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type YahooAuth = { crumb: string; cookie: string; expiresAt: number };
let cachedYahooAuth: YahooAuth | null = null;
const YAHOO_AUTH_TTL_MS = 60 * 60 * 1000;

async function getYahooAuth(): Promise<{ crumb: string; cookie: string } | null> {
  if (cachedYahooAuth && cachedYahooAuth.expiresAt > Date.now()) {
    return { crumb: cachedYahooAuth.crumb, cookie: cachedYahooAuth.cookie };
  }
  try {
    const init = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": YAHOO_UA, "Accept": "text/html,*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    // Deno exposes set-cookie via the .getSetCookie() method on Headers
    // (per the WhatWG fetch spec). Fall back to the raw header join in
    // case it's missing.
    /** @type {string[]} */
    const rawSetCookies =
      (typeof (init.headers as any).getSetCookie === "function"
        ? (init.headers as any).getSetCookie()
        : []) as string[];
    const cookies: string[] = rawSetCookies.length > 0
      ? rawSetCookies
      : (init.headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_]+=)/);
    const cookieHeader = cookies
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    if (!cookieHeader) return null;

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": YAHOO_UA, "Accept": "*/*", "Cookie": cookieHeader },
      signal: AbortSignal.timeout(8_000),
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb) return null;

    cachedYahooAuth = {
      crumb,
      cookie: cookieHeader,
      expiresAt: Date.now() + YAHOO_AUTH_TTL_MS,
    };
    return { crumb, cookie: cookieHeader };
  } catch {
    return null;
  }
}

type YahooQuoteRow = {
  pe: number;
  /** Trading currency of the symbol (USD for ADRs). */
  currency: string | null;
  /**
   * Underlying financial reporting currency. Differs from `currency`
   * for ADRs (TSM = TWD, SFTBY = JPY, ASML = EUR). The frontend uses
   * `currency !== financialCurrency` to detect "we don't have daily
   * historical FX rates → don't try to draw P/E YTD".
   */
  financialCurrency: string | null;
};

/**
 * Batched Yahoo quote fetch. Returns `{ symbol: { pe, currency,
 * financialCurrency } }` for every symbol where Yahoo has a valid
 * `trailingPE`; symbols without are simply absent from the result.
 * Single HTTP request for the whole list (Yahoo v7 quote supports
 * comma-separated symbols).
 */
async function fetchYahooQuoteBatched(symbols: string[]): Promise<Record<string, YahooQuoteRow>> {
  if (symbols.length === 0) return {};
  const auth = await getYahooAuth();
  if (!auth) return {};
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&crumb=${encodeURIComponent(auth.crumb)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_UA,
        "Accept": "application/json",
        "Cookie": auth.cookie,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      // 401 → crumb stale; bust the cache so the next call re-auths.
      if (res.status === 401) cachedYahooAuth = null;
      return {};
    }
    const data = await res.json();
    const arr = data?.quoteResponse?.result;
    if (!Array.isArray(arr)) return {};
    const out: Record<string, YahooQuoteRow> = {};
    for (const row of arr) {
      const pe = Number(row?.trailingPE);
      if (!isFinite(pe) || pe <= 0) continue;
      out[String(row?.symbol ?? "")] = {
        pe,
        currency: typeof row?.currency === "string" ? row.currency : null,
        financialCurrency: typeof row?.financialCurrency === "string" ? row.financialCurrency : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

// ---- Finnhub --------------------------------------------------------

/**
 * Finnhub call kept only for `pe3yAvg` — Yahoo doesn't expose
 * historical-annual P/E in a stable shape, and the annual series
 * is unaffected by the ADR currency-mismatch bug. The `pe` / `eps`
 * fields on Finnhub's `/stock/metric` response are NOT used here
 * because they're broken for ADRs.
 */
async function fetchFinnhubPe3y(symbol: string): Promise<number | null> {
  if (!FINNHUB_API_KEY) return null;
  const url =
    `https://finnhub.io/api/v1/stock/metric` +
    `?symbol=${encodeURIComponent(symbol)}&metric=all` +
    `&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return computePe3yAvg(data?.series?.annual?.pe ?? []);
  } catch {
    return null;
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
async function fetchYahooTrailingEpsHistory(
  symbol: string,
): Promise<Array<{ date: string; eps: number }> | null> {
  const nowSec = Math.floor(Date.now() / 1000);
  const fiveYearsAgoSec = nowSec - 5 * 365 * 86400;
  const url =
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/` +
    `${encodeURIComponent(symbol)}?type=trailingDilutedEPS` +
    `&period1=${fiveYearsAgoSec}&period2=${nowSec}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
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

// Fetches the last ~12 quarters of reported EPS so the client can build
// a rolling TTM-EPS series. The default P/E modal logic divides every
// historical price by a single CURRENT EPS, which made the P/E chart
// just a 1:1 scale of the price chart — earnings revisions never
// showed up. With this list the client can recompute TTM EPS at each
// price date (sum of the latest 4 reports whose period+lag <= date)
// so the P/E line genuinely steps when a new quarter prints.
//
// Each entry is { date: "YYYY-MM-DD" (quarter end), eps: <actual EPS>}.
// Free Finnhub returns up to 12 quarters which covers ~3 years —
// plenty for the modal's YTD window. Returns null on any error or
// when the response is empty so the client cleanly falls back.
async function fetchFinnhubEarningsHistory(
  symbol: string,
): Promise<Array<{ date: string; eps: number }> | null> {
  if (!FINNHUB_API_KEY) return null;
  const url =
    `https://finnhub.io/api/v1/stock/earnings` +
    `?symbol=${encodeURIComponent(symbol)}&limit=12` +
    `&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr)) return null;
    const out = arr
      .map((r: any) => ({
        date: String(r?.period ?? ""),
        eps:  Number(r?.actual),
      }))
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && isFinite(r.eps))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

// ---- Pure helpers exposed for tests ---------------------------------

/**
 * "Is this ticker something the fundamentals function can fetch a P/E
 * for?" — strips CASH, .PVT placeholders, CN funds, futures, forex,
 * crypto, and indices we don't have ETF proxies for. The Edge
 * Function filters its inputs with this predicate so the Finnhub /
 * AV calls only fire for tickers where they'd be meaningful.
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

/**
 * Build a TTM EPS history from raw quarterly Finnhub EPS by summing
 * each rolling window of 4 quarters. Used as the fallback when
 * Yahoo's trailingDilutedEPS endpoint fails. Returns null if there
 * aren't enough quarters to form a single TTM point.
 */
export function rollingTtmFromRawQuarterly(
  raw: Array<{ date: string; eps: number }>,
): Array<{ date: string; eps: number }> | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const out: Array<{ date: string; eps: number }> = [];
  for (let i = 3; i < raw.length; i++) {
    out.push({
      date: raw[i].date,
      eps:  raw[i].eps + raw[i - 1].eps + raw[i - 2].eps + raw[i - 3].eps,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Compute the 3-year average P/E from Finnhub's `series.annual.pe`
 * (or any similarly-shaped { period, v } array). Takes the 3 most
 * recent valid years.
 */
export function computePe3yAvg(
  annualSeries: Array<{ period?: unknown; v?: unknown }>,
): number | null {
  if (!Array.isArray(annualSeries) || annualSeries.length === 0) return null;
  const sorted = annualSeries
    .map((p) => ({ period: String(p?.period ?? ""), v: Number(p?.v) }))
    .filter((p) => p.period && isFinite(p.v) && p.v > 0)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .slice(0, 3);
  if (sorted.length === 0) return null;
  return sorted.reduce((s, p) => s + p.v, 0) / sorted.length;
}

// ---- HTTP entry -----------------------------------------------------

// Guarded so tests can import the helpers above without spinning up
// the server. Supabase's runtime executes index.ts as the entry
// module, so `import.meta.main` is true in production.
if (import.meta.main) Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const param = url.searchParams.get("tickers") ?? "";
  // Opt-in flag — when "true" each entry also gets a `ttmEpsHistory`
  // array (Yahoo trailingDilutedEPS, 5+ yrs). Off by default since
  // every other caller (heatmap badges, etc.) just needs the current
  // TTM P/E and shouldn't pay the extra round-trip per ticker. The
  // flag name is intentionally distinct from #64's `epsHistory` so a
  // mixed-version state (new client + old Edge Function, or vice
  // versa, or a SW-cached old response) cleanly degrades to const-EPS
  // instead of mixing raw-quarterly and TTM semantics.
  const includeEpsHistory = url.searchParams.get("ttmEpsHistory") === "true";
  const tickers = param
    .split(",")
    .map((t) => t.trim())
    .filter(isFundamentalsTicker);
  if (tickers.length === 0) {
    return new Response(JSON.stringify({}), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Split into stocks (Finnhub, can run with parallelism 6) and
  // indices (AV, must be serial). Run them concurrently with each
  // other — they hit different vendors with independent rate caps.
  const indexSymbols = tickers.filter((t) => t in INDEX_ETF_PROXY);
  const stockSymbols = tickers.filter((t) => !(t in INDEX_ETF_PROXY));
  const out: Record<string, Fundamentals> = {};

  const stocksTask = (async () => {
    // ONE batched call to Yahoo for trailingPE + currency
    // information across every stock symbol. Yahoo's published
    // trailingPE is the single source of truth — we don't compute
    // it ourselves anywhere. Finnhub is only consulted for
    // `pe3yAvg` (annual P/E series, which doesn't have the
    // currency-mismatch bug because both numerator and denominator
    // are reported in the same currency at any point in time).
    const yahooByTicker = await fetchYahooQuoteBatched(stockSymbols);
    await Promise.all(stockSymbols.map(async (t) => {
      const y = yahooByTicker[t];
      if (!y) return;  // No trailingPE published — skip the ticker
      // ADR detection: when Yahoo's trading currency differs from
      // the underlying financial reporting currency (TSM USD vs
      // TWD, ASML USD vs EUR, SFTBY USD vs JPY), we DON'T have
      // daily historical FX rates to do a proper P/E YTD series.
      // Don't even attempt it — frontend hides the chart button
      // based on `currency !== financialCurrency` so the user gets
      // a clean "not available" rather than a wrong chart.
      const isAdr = !!(y.financialCurrency && y.currency
        && y.financialCurrency !== y.currency);
      const [pe3yAvg, hist] = await Promise.all([
        fetchFinnhubPe3y(t),
        includeEpsHistory && !isAdr ? fetchYahooTrailingEpsHistory(t) : Promise.resolve(null),
      ]);
      const row: Fundamentals = {
        pe: y.pe,
        pe3yAvg,
        currency: y.currency,
        financialCurrency: y.financialCurrency,
      };
      if (hist && hist.length > 0) row.ttmEpsHistory = hist;
      out[t] = row;
    }));
  })();

  const indicesTask = (async () => {
    const avBlocked = { value: false };
    const isFirstAvCall = { value: true };
    for (const t of indexSymbols) {
      const f = await resolveIndexPe(t, avBlocked, isFirstAvCall);
      if (f) out[t] = f;
    }
  })();

  await Promise.all([stocksTask, indicesTask]);

  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
