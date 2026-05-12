// Supabase Edge Function: fundamentals (rev: PR #95 USD-anchor)
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
const FMP_API_KEY                = Deno.env.get("FMP_API_KEY") ?? "";
const SUPABASE_URL               = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EpsHistoryPoint = { date: string; eps: number };
type Fundamentals = {
  pe: number;
  eps: number;
  pe3yAvg: number | null;
  // Internal-only USD market price (from FMP or Yahoo) — used to
  // derive the USD anchor (price/pe) for normalizing ADR TTM-EPS
  // history. Stripped from the response before it goes over the
  // wire so the client API stays the same.
  price?: number;
  // Pre-summed TTM diluted EPS at each quarter end. Named explicitly
  // to avoid colliding with the previous `epsHistory` contract that
  // returned RAW quarterly EPS — a stale Edge Function or
  // SW-cached response would otherwise be misinterpreted as TTM by
  // the new client (yields P/E ~4x too low).
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
    return { pe: cached.pe, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null };
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
      return { pe: av.pe, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null };
    }
    if (av.rateLimited) avBlocked.value = true;
  }

  // (c) stale cache — better than the static fallback because it's
  // still real AV-sourced data, just possibly a few days old.
  if (cached) {
    return { pe: cached.pe, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null };
  }

  // (d) hardcoded fallback — only on first deploy or total outage.
  const fb = INDEX_PE_FALLBACK[indexSymbol];
  if (fb) {
    return { pe: fb, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null };
  }
  return null;
}

// ---- Financial Modeling Prep (primary, ADR-safe trailingPE) --------
//
// FMP's `/v3/quote/<symbols>` endpoint returns `pe` and `eps` in
// USD for the ADR / US-listed ticker — same currency as the
// reported price, so the values are sane out-of-box for ADRs
// (TSM ~30, SFTBY ~15, ASML ~33). One HTTP request handles the
// whole portfolio via comma-separated symbols. Free tier is
// 250 calls/day which is plenty: a typical refresh fires the
// fundamentals call once, so ~5-10 calls/day per browser session.
//
// Failure modes:
//   - FMP_API_KEY env var missing → return null, fall through
//   - Network / rate-limit / 401 → return null, fall through
//   - Symbol not in FMP's universe (rare for US-listed) → row absent
//
// Layers below this (Yahoo quoteSummary, Finnhub) handle anything
// FMP doesn't have. The ordering matters: FMP is the only one that
// gets ADR P/E correct without a crumb workflow.

export type FmpRow = { pe: number; eps: number; price: number };

export async function fetchFmpQuoteBatched(symbols: string[]): Promise<Record<string, FmpRow>> {
  if (!FMP_API_KEY || symbols.length === 0) return {};
  // FMP rejects URL-encoded commas inside the path segment, so
  // join raw and encodeURIComponent each symbol individually.
  const path = symbols.map(s => encodeURIComponent(s)).join(",");
  const url =
    `https://financialmodelingprep.com/api/v3/quote/${path}` +
    `?apikey=${encodeURIComponent(FMP_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (!Array.isArray(data)) return {};
    /** @type {Record<string, FmpRow>} */
    const out: Record<string, FmpRow> = {};
    for (const row of data) {
      const sym = String(row?.symbol ?? "");
      const pe    = Number(row?.pe);
      const eps   = Number(row?.eps);
      const price = Number(row?.price);
      if (!sym) continue;
      if (!isFinite(pe)  || pe  <= 0) continue;
      if (!isFinite(eps) || eps <= 0) continue;
      out[sym] = { pe, eps, price: isFinite(price) && price > 0 ? price : 0 };
    }
    return out;
  } catch {
    return {};
  }
}

// ---- Yahoo quoteSummary (secondary, used when FMP doesn't have it) --
//
// Finnhub's `peTTM` is broken for ADRs (TSM, SFTBY, etc.) — Finnhub
// returns the ADR's USD price but the EPS in the foreign reporting
// currency (TWD / JPY), so peTTM comes out as ~1.22 for TSM and
// ~0.07 for SFTBY. Yahoo's quoteSummary endpoint pre-computes
// trailingPE / trailingEps with both sides on the same USD scale
// because the consumer-facing site has to show consistent numbers,
// so we use Yahoo as the primary source and fall back to Finnhub
// only when Yahoo is unreachable / blocked.

type YahooQuoteSummary = { pe: number; eps: number; price: number; currency: string | null };

async function fetchYahooQuoteSummary(symbol: string): Promise<YahooQuoteSummary | null> {
  // quoteSummary doesn't require auth for most tickers (crumb is
  // only required on a few high-traffic endpoints). The chart Edge
  // Function uses the same query1 host without a crumb.
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=summaryDetail,defaultKeyStatistics,price`;
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
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return null;
    const peRaw  = result?.summaryDetail?.trailingPE?.raw
                ?? result?.defaultKeyStatistics?.trailingPE?.raw;
    const epsRaw = result?.defaultKeyStatistics?.trailingEps?.raw;
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
    const currency = result?.price?.currency ?? null;
    const pe    = Number(peRaw);
    const eps   = Number(epsRaw);
    const price = Number(priceRaw);
    if (!isFinite(pe)  || pe  <= 0) return null;
    if (!isFinite(eps) || eps <= 0) return null;
    return {
      pe,
      eps,
      price: isFinite(price) && price > 0 ? price : 0,
      currency: typeof currency === 'string' ? currency : null,
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
 * answers anon callers reliably. Used as the last-resort USD anchor
 * for the TTM-EPS rescale when neither FMP nor quoteSummary
 * supplies a price.
 */
async function fetchYahooChartPrice(symbol: string): Promise<number> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1d&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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

// ---- Finnhub --------------------------------------------------------

/**
 * Combined fundamentals for a single stock symbol. Yahoo's
 * quoteSummary is the primary source for `pe` + `eps` because it
 * handles ADR currency normalization correctly (TSM/SFTBY return
 * sane ~26 / ~15 instead of Finnhub's 1.22 / 0.07). Finnhub is still
 * the source of `pe3yAvg` (its `series.annual.pe` is the only free
 * historical-annual data we have access to) — fetched in parallel
 * so this combined call is no slower than fetchFinnhub used to be
 * for non-ADR stocks. If Yahoo fails (rate-limited, no PE published
 * for the symbol), the result falls back entirely to Finnhub —
 * which is correct for US-listed stocks where Finnhub doesn't have
 * the currency-mismatch bug.
 *
 * `fmpRow`, when passed, short-circuits both the Yahoo and Finnhub
 * `pe`/`eps` lookups — FMP already returned ADR-USD-normalized
 * values for this symbol in the caller's batched fetch, so we just
 * use them. Finnhub still runs for `pe3yAvg` regardless of FMP.
 */
export async function fetchStockFundamentals(
  symbol: string,
  fmpRow?: FmpRow | null,
): Promise<Fundamentals | null> {
  // When FMP gave us a clean pe/eps already, we still want the
  // Finnhub annual series for pe3yAvg — fire it in parallel with
  // nothing else, so this branch is as fast as one HTTP request.
  if (fmpRow) {
    const finn = await fetchFinnhub(symbol);
    return {
      pe: fmpRow.pe,
      eps: fmpRow.eps,
      price: fmpRow.price,
      pe3yAvg: finn?.pe3yAvg ?? null,
    };
  }
  const [yahoo, finn] = await Promise.all([
    fetchYahooQuoteSummary(symbol),
    fetchFinnhub(symbol),
  ]);
  if (yahoo) {
    return {
      pe: yahoo.pe,
      eps: yahoo.eps,
      price: yahoo.price,
      pe3yAvg: finn?.pe3yAvg ?? null,
    };
  }
  return finn;
}

async function fetchFinnhub(symbol: string): Promise<Fundamentals | null> {
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
    const m = data?.metric;
    if (!m) return null;
    const pe  = Number(m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual);
    const eps = Number(m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? m.epsNormalizedAnnual);
    if (!isFinite(pe) || !isFinite(eps) || eps <= 0 || pe <= 0) return null;

    const pe3yAvg = computePe3yAvg(data?.series?.annual?.pe ?? []);
    return { pe, eps, pe3yAvg };
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
 * Scale a TTM-EPS history series to USD using the ratio between the
 * authoritative USD eps (from Yahoo quoteSummary) and the latest
 * entry in the historical series. ADRs like TSM / SFTBY report
 * fundamentals in the underlying foreign currency (TWD / JPY) via
 * Yahoo's fundamentals-timeseries endpoint, while the ADR's market
 * price + trailingPE / trailingEps from quoteSummary are pre-
 * normalized to USD. Dividing USD prices by foreign-currency EPS
 * was the source of the TSM=1.22 / SFTBY=0.07 bug.
 *
 * The scaling assumes the FX rate has been approximately constant
 * over the historical window — true within ±5-10 % for USD/TWD,
 * USD/JPY over a typical 1y chart, which is acceptable for a "how
 * has the P/E moved this year?" visualization.
 *
 * For US-listed stocks where currencies already match, the ratio is
 * ≈ 1.0 so this is a near no-op (just a uniform multiply).
 *
 * @param history       latest-last EPS series, foreign-currency for ADRs
 * @param epsUsdLatest  authoritative USD trailing EPS (Yahoo quoteSummary)
 */
export function normalizeEpsHistoryToUsd(
  history: Array<{ date: string; eps: number }>,
  epsUsdLatest: number,
): Array<{ date: string; eps: number }> {
  if (!Array.isArray(history) || history.length === 0) return history;
  if (!isFinite(epsUsdLatest) || epsUsdLatest <= 0) return history;
  const latest = history[history.length - 1].eps;
  if (!isFinite(latest) || latest <= 0) return history;
  // If the latest historical EPS is already within ±20 % of the
  // authoritative USD value, currencies already match — return as-is
  // rather than apply a near-1.0 scale that could amplify noise.
  const ratio = epsUsdLatest / latest;
  if (ratio > 0.8 && ratio < 1.2) return history;
  return history.map((p) => ({ date: p.date, eps: p.eps * ratio }));
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
    // ONE batched FMP call for the whole stock list — FMP returns
    // ADR-currency-safe pe/eps natively (TSM ~30, SFTBY ~15,
    // ASML ~33). Symbols FMP doesn't cover fall through to the
    // Yahoo-quoteSummary + Finnhub layers inside
    // fetchStockFundamentals().
    const fmpByTicker = await fetchFmpQuoteBatched(stockSymbols);
    const queue = [...stockSymbols];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length > 0) {
        const t = queue.shift();
        if (!t) break;
        const f = await fetchStockFundamentals(t, fmpByTicker[t]);
        if (!f) continue;
        if (includeEpsHistory) {
          // Each entry's `eps` is TTM diluted EPS at that quarter end —
          // already summed by Yahoo, so the client can just look up
          // the latest entry whose date+lag is before the price date.
          // Falls back to Finnhub on Yahoo failure: Finnhub returns
          // *raw* quarterly EPS so we sum the last 4 to expose a single
          // TTM data point. 4 quarters is rarely enough to draw
          // earnings-day steps, but it keeps the response shape
          // consistent so the client doesn't need to know the source.
          let hist = await fetchYahooTrailingEpsHistory(t);
          if (!hist) {
            const raw = await fetchFinnhubEarningsHistory(t);
            if (raw) hist = rollingTtmFromRawQuarterly(raw);
          }
          // USD-anchor for rescaling foreign-currency TTM-EPS history.
          // Priority:
          //   1. FMP price/pe — same response, no timing skew. FMP's
          //      free tier doesn't cover every ADR though (TSM /
          //      SFTBY / ASML all return no row), so this only fires
          //      for the universe of US-listed stocks FMP supports.
          //   2. Yahoo quoteSummary price/pe — both fields come from
          //      the same response. In practice Yahoo strips every
          //      price-ish field from quoteSummary for anon callers
          //      targeting ADRs (regularMarketPrice / previousClose /
          //      fiftyDayAverage / twoHundredDayAverage all return
          //      null), so this branch rarely fires for the ADRs
          //      that actually need it.
          //   3. Yahoo chart-endpoint price / quoteSummary pe —
          //      `meta.regularMarketPrice` on `/v8/finance/chart`
          //      is what Yahoo's consumer site uses; reliably
          //      returned for anon callers including ADRs. One extra
          //      HTTP call only for tickers (1) and (2) missed.
          //   4. f.eps — only hit when the chart endpoint also fails
          //      or pe is 0; normalizeEpsHistoryToUsd's ratio guard
          //      then leaves the history unscaled.
          const fmpRow = fmpByTicker[t];
          let usdAnchor = f.eps;
          if (fmpRow && fmpRow.price > 0 && fmpRow.pe > 0) {
            usdAnchor = fmpRow.price / fmpRow.pe;
          } else if (f.price && f.price > 0 && f.pe > 0) {
            usdAnchor = f.price / f.pe;
          } else if (f.pe > 0) {
            const chartPrice = await fetchYahooChartPrice(t);
            if (chartPrice > 0) usdAnchor = chartPrice / f.pe;
          }
          if (hist) f.ttmEpsHistory = normalizeEpsHistoryToUsd(hist, usdAnchor);
        }
        // Strip the internal `price` field — used above as the USD
        // anchor source; not part of the public response contract.
        if ('price' in f) delete f.price;
        out[t] = f;
      }
    });
    await Promise.all(workers);
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
