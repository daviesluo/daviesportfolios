// Supabase Edge Function: fundamentals (rev: Yahoo-crumb)
//
// Returns current TTM P/E + trailing EPS (+ P/S, PEG, ttmEpsHistory)
// for a list of tickers from two sources, picked by symbol:
//
//   1. Individual stocks → Yahoo `quoteSummary` (primary; pe / eps /
//      ps / forwardPE / earningsTrend, all USD-correct for ADRs),
//      with Finnhub `/stock/metric` as the fallback when Yahoo is
//      unreachable. Yahoo's quoteSummary now requires a crumb token
//      — see getYahooCrumb() for the cookie→crumb handshake.
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
// FMP was the primary source for individual-stock P/E during the ADR
// currency-fix saga, but FMP retired its `/v3/` endpoints for
// post-2025-08-31 keys and paywalled the `/stable/` replacements, so
// the whole FMP layer was removed — Yahoo quoteSummary (with crumb)
// is the only remaining free source for ADR-correct ratios + PEG.
//
// Env:
//   FINNHUB_API_KEY            (individual-stock P/E fallback)
//   ALPHAVANTAGE_API_KEY       (index P/E)
//   SUPABASE_URL               (auto-injected; cache layer)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected; cache layer)
//
// Call: GET /functions/v1/fundamentals?tickers=NVDA,GOOG,^GSPC
// Returns:
//   {
//     NVDA:  { pe: 40.16, eps: 4.90, pe3yAvg: 43.13, peg: 1.4, ps: 25 },
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
  pe: number;
  eps: number;
  pe3yAvg: number | null;
  // PEG (Price/Earnings-to-Growth) — Yahoo's forward P/E divided by
  // the analyst-consensus 5y EPS-growth CAGR
  // (`earningsTrend.trend[+5y].growth.raw`). Forward over forward
  // by convention: trailing P/E paired with backward-looking growth
  // is the classic PEG misuse since the market prices in
  // expectations, not history. (A 3y horizon would suit cyclical
  // tech/semi names better, but FMP's analyst-estimates endpoint —
  // the only free 3y source — was paywalled, so +5y is what's
  // available.) Computed server-side via `computePeg` so the client
  // just reads a single number. Optional — null when Yahoo doesn't
  // publish forwardPE or no analyst consensus exists yet (brand-new
  // IPOs, illiquid OTC, etc.).
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
  // TEMP debug — see fetchYahooQuoteSummary's __pegDebug. Surfaces the
  // raw forwardPE / 5y-growth inputs on the wire so a prod fetch can
  // pinpoint why PEG is null. Remove once PEG is confirmed working.
  __pegDebug?: unknown;
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

const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _yahooCrumb: { crumb: string; cookie: string } | null = null;
let _yahooCrumbInFlight: Promise<{ crumb: string; cookie: string } | null> | null = null;

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
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

type YahooQuoteSummary = {
  pe: number;
  eps: number;
  ps: number;
  forwardPE: number;
  epsGrowth5y: number;   // analyst-consensus 5y CAGR, decimal (0.225 = 22.5 %)
  price: number;
  currency: string | null;
  // TEMP debug — raw PEG inputs surfaced so a prod fetch can show why
  // computePeg returns null. Remove once PEG is confirmed working.
  __pegDebug?: unknown;
};

async function fetchYahooQuoteSummary(symbol: string): Promise<YahooQuoteSummary | null> {
  // quoteSummary now requires a crumb token — see getYahooCrumb().
  // `earningsTrend` is needed for the forward 5y EPS growth CAGR
  // that pairs with `forwardPE` to produce PEG — see computePeg.
  const auth = await getYahooCrumb();
  if (!auth) return null;  // handshake failed → caller falls to Finnhub
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=summaryDetail,defaultKeyStatistics,price,earningsTrend` +
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
    // Forward P/E + analyst-consensus 5y growth CAGR for PEG.
    // Forward P/E pairs with forward growth by convention — using
    // trailing P/E with forward growth (or vice versa) is the
    // classic PEG misuse since the market prices in expectations,
    // not history. `earningsTrend.trend` is an array of period
    // buckets; the one we want is `period === '+5y'`, whose
    // `growth.raw` is a decimal (0.225 = 22.5 %). Both fields are
    // optional — Yahoo doesn't publish them for brand-new IPOs,
    // illiquid OTC tickers, or names without analyst coverage.
    const fwdPeRaw = result?.summaryDetail?.forwardPE?.raw
                  ?? result?.defaultKeyStatistics?.forwardPE?.raw;
    /** @type {Array<{ period?: string, growth?: { raw?: number } }>} */
    const trend = Array.isArray(result?.earningsTrend?.trend) ? result.earningsTrend.trend : [];
    const fiveYr = trend.find((t: any) => t?.period === '+5y');
    const growth5yRaw = fiveYr?.growth?.raw;
    const currency = result?.price?.currency ?? null;
    const pe    = Number(peRaw);
    const eps   = Number(epsRaw);
    const ps    = Number(psRaw);
    const fwdPe = Number(fwdPeRaw);
    const g5y   = Number(growth5yRaw);
    const price = Number(priceRaw);
    // Use 0 as the "no usable value" sentinel so the response shape
    // stays uniform and the caller can decide per-field whether to
    // show that view. Reject the whole call only when EVERY ratio is
    // missing — loss-makers have no pe/eps but do publish ps, and we
    // want to keep that row alive to back the new P/S YTD button.
    const pe2     = isFinite(pe)    && pe    > 0 ? pe    : 0;
    const eps2    = isFinite(eps)   && eps   > 0 ? eps   : 0;
    const ps2     = isFinite(ps)    && ps    > 0 ? ps    : 0;
    const fwdPe2  = isFinite(fwdPe) && fwdPe > 0 ? fwdPe : 0;
    // Growth can legitimately be negative (analysts expect earnings
    // to shrink). Keep the sign — `computePeg` decides whether to
    // emit a value. A literal 0 % growth still means "no PEG" since
    // the math diverges.
    const g5y2    = isFinite(g5y) ? g5y : 0;
    if (pe2 === 0 && eps2 === 0 && ps2 === 0) return null;
    // TEMP debug — surfaces exactly which PEG input is missing from
    // the crumb-authed response: whether each module came back, the
    // raw forwardPE from both candidate locations, and every period
    // bucket present in earningsTrend.trend (so a missing '+5y' shows
    // up immediately).
    const __pegDebug = {
      hasSummaryDetail:    !!result?.summaryDetail,
      hasDefaultKeyStats:  !!result?.defaultKeyStatistics,
      hasEarningsTrend:    !!result?.earningsTrend,
      fwdPe_summaryDetail: result?.summaryDetail?.forwardPE?.raw ?? null,
      fwdPe_keyStats:      result?.defaultKeyStatistics?.forwardPE?.raw ?? null,
      trendPeriods:        trend.map((t: any) => String(t?.period ?? '?')),
      growth5yRaw:         growth5yRaw ?? null,
      parsed: { fwdPe2, g5y2 },
    };
    return {
      pe:  pe2,
      eps: eps2,
      ps:  ps2,
      forwardPE:    fwdPe2,
      epsGrowth5y:  g5y2,
      price: isFinite(price) && price > 0 ? price : 0,
      currency: typeof currency === 'string' ? currency : null,
      __pegDebug,
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
 * quoteSummary is the primary source for `pe` / `eps` / `ps` /
 * `forwardPE` / `epsGrowth5y` because it handles ADR currency
 * normalization correctly (TSM/SFTBY return sane ~26 / ~15 instead
 * of Finnhub's 1.22 / 0.07). Finnhub runs in parallel for
 * `pe3yAvg` / `ps3yAvg` (its `series.annual.*` is the only free
 * historical-annual data we have) and as the whole-row fallback
 * when Yahoo's crumb handshake fails or it's rate-limited — which
 * is fine for US-listed stocks where Finnhub doesn't have the
 * currency-mismatch bug.
 */
export async function fetchStockFundamentals(
  symbol: string,
): Promise<Fundamentals | null> {
  const [yahoo, finn] = await Promise.all([
    fetchYahooQuoteSummary(symbol),
    fetchFinnhub(symbol),
  ]);
  if (yahoo) {
    // pe / eps both = 0 → loss-maker / no-earnings case. Surface the
    // row anyway so the client can show the P/S YTD view (ps still
    // populated) instead of hiding the chart entirely. `pickPsFields`
    // cross-checks Yahoo vs Finnhub P/S and drops Finnhub's
    // `ps3yAvg` reference line when they disagree (ADR currency
    // mismatch). PEG = Yahoo's forwardPE ÷ its +5y analyst-consensus
    // growth — see computePeg.
    const { ps, ps3yAvg } = pickPsFields(yahoo.ps, finn?.ps, finn?.ps3yAvg);
    const peg = computePeg(yahoo.forwardPE, yahoo.epsGrowth5y);
    return {
      pe: yahoo.pe,
      eps: yahoo.eps,
      price: yahoo.price,
      pe3yAvg: finn?.pe3yAvg ?? null,
      ps,
      ps3yAvg,
      peg: peg ?? undefined,
      __pegDebug: yahoo.__pegDebug,
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
    const peRaw  = Number(m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual);
    const epsRaw = Number(m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? m.epsNormalizedAnnual);
    const psRaw  = Number(m.psTTM ?? m.psAnnual);
    const pe  = isFinite(peRaw)  && peRaw  > 0 ? peRaw  : 0;
    const eps = isFinite(epsRaw) && epsRaw > 0 ? epsRaw : 0;
    const ps  = isFinite(psRaw)  && psRaw  > 0 ? psRaw  : 0;
    // Surface the row whenever ANY ratio is usable. Loss-makers
    // typically have pe/eps absent but ps populated — without this
    // relaxation the function dropped them entirely and the new P/S
    // YTD view would have nothing to show.
    if (pe === 0 && eps === 0 && ps === 0) return null;
    const pe3yAvg = computePe3yAvg(data?.series?.annual?.pe ?? []);
    const ps3yAvg = computePe3yAvg(data?.series?.annual?.ps ?? []);
    return { pe, eps, ps, pe3yAvg, ps3yAvg };
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
 * PEG = forward P/E ÷ forward 5y EPS-growth CAGR (in percent).
 *
 * The "forward over forward" convention is the load-bearing detail:
 * the market prices in expectations, not history, so pairing
 * trailing P/E with forward growth (or vice versa) gives a
 * misleading number. Both inputs come from Yahoo's quoteSummary:
 * `summaryDetail.forwardPE.raw` (numerator) and
 * `earningsTrend.trend[+5y].growth.raw` (denominator). A 3y horizon
 * would suit cyclical tech/semi names better, but FMP's
 * analyst-estimates endpoint — the only free 3y source — was
 * paywalled, so +5y is what's available.
 *
 * Growth is a DECIMAL (0.225 = 22.5 %). To turn it into the
 * standard "PEG denominator" we multiply by 100, so PEG ends up
 * scaled the way Bloomberg / Yahoo / etc. display it (a fairly-
 * valued stock has PEG ≈ 1).
 *
 * Returns null whenever the formula doesn't have a meaningful
 * answer: forwardPE missing or ≤ 0, growth missing or ≤ 0
 * (negative growth makes PEG itself negative, and most data
 * vendors hide PEG in that case rather than try to interpret it).
 *
 * @param {number | undefined | null} forwardPE
 * @param {number | undefined | null} growth  decimal, e.g. 0.225
 */
export function computePeg(
  forwardPE: number | undefined | null,
  growth: number | undefined | null,
): number | null {
  const f = Number(forwardPE);
  const g = Number(growth);
  if (!isFinite(f) || f <= 0) return null;
  if (!isFinite(g) || g <= 0) return null;
  return f / (g * 100);
}

/**
 * Pick the P/S value and the 3-year-average reference value, guarding
 * against the ADR currency-mismatch that plagued Finnhub's `peTTM`
 * (USD ADR price ÷ foreign-currency reported EPS). Finnhub's
 * `psTTM` / `series.annual.ps` inherit the same bug — for an ADR
 * Finnhub divides USD market cap by foreign-currency revenue, so
 * the published ratios come out off by the FX rate. Yahoo's
 * `summaryDetail.priceToSalesTrailing12Months` is USD-correct
 * because the consumer-facing site has to display a coherent
 * number, so we always prefer it for the current value.
 *
 * The harder case is the 3-year average. Yahoo doesn't expose
 * historical annual P/S on the free tier, so the 3Y AVG dashed
 * reference line on the chart comes from Finnhub's annual series
 * regardless of source. We can still catch the ADR case
 * heuristically: when BOTH sources have a current P/S, compare
 * them. If they agree within 2× either way, currencies are
 * consistent and Finnhub's annual series is trustworthy. If they
 * disagree (Yahoo $TSM ps ~12, Finnhub $TSM psTTM ~360 because
 * of the TWD mismatch), drop Finnhub's `ps3yAvg` so the chart
 * doesn't paint a wildly off-scale reference line.
 *
 * @param {number | undefined | null} yahooPs   Yahoo's USD-USD P/S
 * @param {number | undefined | null} finnPs    Finnhub's possibly-mixed-unit P/S
 * @param {number | undefined | null} finnPs3y  Finnhub's annual 3Y avg P/S
 */
export function pickPsFields(
  yahooPs: number | undefined | null,
  finnPs: number | undefined | null,
  finnPs3y: number | undefined | null,
): { ps: number; ps3yAvg: number | null } {
  const ys = isFinite(Number(yahooPs)) && Number(yahooPs) > 0 ? Number(yahooPs) : 0;
  const fs = isFinite(Number(finnPs))  && Number(finnPs)  > 0 ? Number(finnPs)  : 0;
  const ps = ys > 0 ? ys : fs;
  // The annual 3Y avg only renders when sources cross-check. When
  // only one source has a current value the cross-check is
  // impossible — fall back to "no reference line", same as if
  // Finnhub had returned no annual series at all.
  let ps3yAvg: number | null = null;
  if (
    typeof finnPs3y === 'number' && isFinite(finnPs3y) && finnPs3y > 0
    && ys > 0 && fs > 0
  ) {
    const r = ys / fs;
    if (r > 0.5 && r < 2) ps3yAvg = finnPs3y;
  }
  return { ps, ps3yAvg };
}

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

// ---- TEMP: PEG data-source probe ------------------------------------
//
// `?tickers=AVGO&pegProbe=true` short-circuits the normal response and
// dumps, for the first ticker, the raw data behind two candidate
// multi-year-growth sources:
//
//   1. Yahoo `earningsTrend` requested ALONE, on both host mirrors
//      (query1 / query2) — to see whether module-bundling or the
//      mirror is what trims the '+5y' / '-5y' period buckets that
//      __pegDebug showed missing for AVGO.
//   2. Alpha Vantage `OVERVIEW` — it publishes its own `PEGRatio` +
//      `ForwardPE`; the full body is dumped so any multi-year growth
//      field is visible. AV's free tier is 25 calls/day, so this is
//      gated behind the flag rather than run on every request.
//
// Removed once the PEG source is settled.
async function runPegProbe(symbol: string): Promise<unknown> {
  const out: Record<string, unknown> = {};

  for (const host of ["query1", "query2"]) {
    try {
      const auth = await getYahooCrumb();
      const u =
        `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/` +
        `${encodeURIComponent(symbol)}?modules=earningsTrend` +
        (auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "");
      const res = await fetch(u, {
        headers: {
          "User-Agent": YAHOO_UA,
          "Accept": "application/json,text/plain,*/*",
          ...(auth ? { "Cookie": auth.cookie } : {}),
        },
        signal: AbortSignal.timeout(8_000),
      });
      let earningsTrend: unknown = null;
      if (res.ok) {
        const data = await res.json();
        earningsTrend =
          data?.quoteSummary?.result?.[0]?.earningsTrend ??
          data?.quoteSummary?.error ??
          "no earningsTrend in result";
      }
      out[`yahoo_${host}`] = { status: res.status, earningsTrend };
    } catch (e) {
      out[`yahoo_${host}`] = { error: String(e) };
    }
  }

  try {
    const u =
      `https://www.alphavantage.co/query?function=OVERVIEW` +
      `&symbol=${encodeURIComponent(symbol)}` +
      `&apikey=${encodeURIComponent(ALPHAVANTAGE_API_KEY)}`;
    const res = await fetch(u, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    let body: unknown = null;
    if (res.ok) body = await res.json();
    out.alphaVantage_OVERVIEW = {
      status: res.status,
      hasKey: !!ALPHAVANTAGE_API_KEY,
      body,
    };
  } catch (e) {
    out.alphaVantage_OVERVIEW = { error: String(e) };
  }

  return out;
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

  // TEMP — PEG data-source probe. See runPegProbe(). Short-circuits
  // the normal fetch so it never burns Alpha Vantage quota unless
  // explicitly asked for.
  if (url.searchParams.get("pegProbe") === "true") {
    const probe = await runPegProbe(tickers[0]);
    return new Response(JSON.stringify({ __probe: probe }, null, 2), {
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
    const queue = [...stockSymbols];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length > 0) {
        const t = queue.shift();
        if (!t) break;
        const f = await fetchStockFundamentals(t);
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
          //   1. Yahoo quoteSummary price/pe — both fields come from
          //      the same response, no timing skew. Yahoo's
          //      quoteSummary price-ish fields are USD-correct for
          //      ADRs (the consumer site has to show coherent
          //      numbers).
          //   2. Yahoo chart-endpoint price / quoteSummary pe —
          //      `meta.regularMarketPrice` on `/v8/finance/chart`
          //      needs no crumb and reliably answers anon callers
          //      including ADRs. One extra HTTP call only when (1)
          //      didn't supply a price.
          //   3. f.eps — only hit when the chart endpoint also fails
          //      or pe is 0; normalizeEpsHistoryToUsd's ratio guard
          //      then leaves the history unscaled.
          let usdAnchor = f.eps;
          if (f.price && f.price > 0 && f.pe > 0) {
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
