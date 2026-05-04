// Supabase Edge Function: fundamentals
//
// Returns current TTM P/E + trailing EPS for a list of tickers from
// two data sources:
//   - Individual stocks → Finnhub `/stock/metric` (60 calls / minute,
//     no payment info on free tier). Yahoo's v7/quote and v10/
//     quoteSummary were crumb-gated to a degree Deno Deploy egress IPs
//     couldn't reliably bootstrap, so Finnhub it is.
//   - The three major US indices (^GSPC / ^NDX / ^RUT) → Financial
//     Modeling Prep `/v3/quote/{ETF}` + `/v3/key-metrics/{ETF}?period
//     =annual` against their ETF proxies (SPY / QQQ / IWM). Finnhub's
//     free tier confirmed empty for ETFs (returns 19 price-stats
//     fields and zero fundamentals — no peTTM, no epsTTM, no annual
//     series), so the proxy lookup MUST go to a different vendor.
//     FMP free tier = 250 calls / day, plenty for our ~10-call/day
//     usage on these three symbols.
//
// Env:
//   FINNHUB_API_KEY  (required for individual stocks)
//   FMP_API_KEY      (required for ^GSPC / ^NDX / ^RUT — register a
//                     free key at financialmodelingprep.com)
// If either is absent the corresponding tickers just don't appear in
// the response — no errors thrown, the client treats them as "no P/E".
//
// Used by the ticker chart modal's "P/E YTD" view: the client divides
// each YTD daily-close price by the EPS returned here to plot a P/E
// series. The approximation assumes EPS hasn't moved within YTD —
// fine for most stocks within a quarter, becomes inaccurate right
// after an earnings report. For ETF proxies (where FMP gives us a
// trailing P/E but no aggregate EPS), the client reconstructs an
// implied EPS from `lastClose / pe` so the y-axis still anchors at
// the published current P/E.
//
// Tickers without meaningful fundamentals (futures, non-major indices,
// crypto, .PVT placeholders, 6-digit CN funds, loss-makers with
// negative EPS) are simply absent from the response.
//
// Call: GET /functions/v1/fundamentals?tickers=NVDA,GOOG,^GSPC
// Returns:
//   {
//     NVDA:  { pe: 40.16, eps: 4.90, pe3yAvg: 43.13 },
//     ^GSPC: { pe: 22.50, eps: 0,    pe3yAvg: 24.10 }   // eps:0 → use implied
//   }

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
const FMP_API_KEY     = Deno.env.get("FMP_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Fundamentals = { pe: number; eps: number; pe3yAvg: number | null };

// Three major indices use ETF proxies for the P/E lookup because
// `/stock/metric` (Finnhub) and `/quote/{etf}` (FMP) are both
// company/security endpoints — they don't accept the index symbol
// itself. The ETF that tracks the index (SPY for ^GSPC, QQQ for ^NDX,
// IWM for ^RUT) publishes a trailing P/E that's a reasonable stand-in
// for the underlying basket. The response is keyed back under the
// original `^GSPC` etc. so the client doesn't need to know about the
// alias.
const INDEX_ETF_PROXY: Record<string, string> = {
  "^GSPC": "SPY",
  "^NDX":  "QQQ",
  "^RUT":  "IWM",
};

// Finnhub: individual stocks only. Free tier returns:
//   { metric: { peTTM: 30.5, epsTTM: 6.5, ... },
//     series: { annual: { pe: [{period, v}, ...], ... } } }
// Field-name fallbacks:
//   pe  → peTTM | peBasicExclExtraTTM | peNormalizedAnnual
//   eps → epsTTM | epsBasicExclExtraItemsTTM | epsNormalizedAnnual
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

    // 3-year-avg PE from the annual series. Pick the 3 most-recent
    // entries with a positive value so a single quirky year (loss-
    // maker turning around or a one-off charge) doesn't pin the
    // average to a meaningless number.
    let pe3yAvg: number | null = null;
    const annual = data?.series?.annual?.pe ?? [];
    if (Array.isArray(annual) && annual.length > 0) {
      const sorted = annual
        .map((p: any) => ({ period: String(p?.period ?? ""), v: Number(p?.v) }))
        .filter((p) => p.period && isFinite(p.v) && p.v > 0)
        .sort((a, b) => (a.period < b.period ? 1 : -1))
        .slice(0, 3);
      if (sorted.length > 0) {
        pe3yAvg = sorted.reduce((s, p) => s + p.v, 0) / sorted.length;
      }
    }

    return { pe, eps, pe3yAvg };
  } catch {
    return null;
  }
}

// FMP: ETF P/E for the three index proxies. Two requests per ETF —
//   /v3/quote/{ETF}                       → current trailing P/E
//   /v3/key-metrics/{ETF}?period=annual   → historical annual peRatio
// Returns eps:0 deliberately; the client reconstructs an implied EPS
// from lastClose / pe so the historical YTD price series can still
// be divided into P/E values.
async function fetchFmpEtf(etfSymbol: string): Promise<Fundamentals | { _debug: any } | null> {
  if (!FMP_API_KEY) return { _debug: { stage: 'no-key', etfSymbol } } as any;
  // Safe key fingerprint — length and first 4 chars — so we can tell
  // from the client whether the env var got mangled (whitespace,
  // truncation, etc.) without actually exposing the secret.
  const keyLen = FMP_API_KEY.length;
  const keyHead = FMP_API_KEY.slice(0, 4);
  const keyTail = FMP_API_KEY.slice(-2);
  const keyHasWhitespace = /\s/.test(FMP_API_KEY);
  const keyHasQuotes = /['"]/.test(FMP_API_KEY);
  const enc = encodeURIComponent(etfSymbol);
  try {
    const quoteUrl = `https://financialmodelingprep.com/api/v3/quote/${enc}?apikey=${encodeURIComponent(FMP_API_KEY)}`;
    const quoteRes = await fetch(
      quoteUrl,
      { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8_000) },
    );
    if (!quoteRes.ok) {
      const bodyText = await quoteRes.text().catch(() => '<read failed>');
      return { _debug: { stage: 'quote-not-ok', etfSymbol, status: quoteRes.status, body: bodyText.slice(0, 400), keyFingerprint: { len: keyLen, head: keyHead, tail: keyTail, hasWhitespace: keyHasWhitespace, hasQuotes: keyHasQuotes } } } as any;
    }
    const quoteArr = await quoteRes.json();
    const quote = Array.isArray(quoteArr) ? quoteArr[0] : null;
    const pe = Number(quote?.pe);
    if (!isFinite(pe) || pe <= 0) {
      return { _debug: { stage: 'no-usable-pe', etfSymbol, peRaw: quote?.pe, quoteKeys: quote ? Object.keys(quote) : null, sample: Array.isArray(quoteArr) ? quoteArr.slice(0, 1) : quoteArr } } as any;
    }

    let pe3yAvg: number | null = null;
    let kmDebug: any = null;
    try {
      const kmUrl = `https://financialmodelingprep.com/api/v3/key-metrics/${enc}?period=annual&limit=3&apikey=${encodeURIComponent(FMP_API_KEY)}`;
      const kmRes = await fetch(
        kmUrl,
        { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(8_000) },
      );
      if (!kmRes.ok) {
        kmDebug = { stage: 'km-not-ok', status: kmRes.status };
      } else {
        const km = await kmRes.json();
        if (Array.isArray(km)) {
          const peVals = km
            .map((r: any) => Number(r?.peRatio ?? r?.peRatioTTM))
            .filter((v) => isFinite(v) && v > 0);
          if (peVals.length > 0) {
            pe3yAvg = peVals.reduce((s, v) => s + v, 0) / peVals.length;
          } else {
            kmDebug = { stage: 'km-no-pe', sampleKey0: km[0] ? Object.keys(km[0]).slice(0, 20) : null };
          }
        } else {
          kmDebug = { stage: 'km-not-array', sample: km };
        }
      }
    } catch (e) {
      kmDebug = { stage: 'km-throw', err: String(e).slice(0, 200) };
    }

    // Annotate the success path with kmDebug too if 3Y avg failed —
    // this lets us see whether quote alone worked but km failed.
    if (pe3yAvg === null && kmDebug) {
      return { pe, eps: 0, pe3yAvg, _debug: kmDebug } as any;
    }
    return { pe, eps: 0, pe3yAvg };
  } catch (e) {
    return { _debug: { stage: 'fmp-throw', etfSymbol, err: String(e).slice(0, 200) } } as any;
  }
}

async function fetchFundamentals(symbol: string): Promise<Fundamentals | { _debug: any } | null> {
  const proxy = INDEX_ETF_PROXY[symbol];
  if (proxy) return fetchFmpEtf(proxy);
  return fetchFinnhub(symbol);
}

Deno.serve(async (req: Request) => {
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
  const tickers = param
    .split(",")
    .map((t) => t.trim())
    // Skip categories that never have meaningful P/E so we don't burn
    // a Finnhub request just to get null.
    .filter((t) =>
      !!t &&
      t !== "CASH" &&
      !/\.PVT$/i.test(t) &&
      !/^\d{6}$/.test(t) &&
      !/=F$/.test(t) &&             // futures
      // Indices: skip unless they have an ETF-proxy mapping (^GSPC,
      // ^NDX, ^RUT). Other ^-prefixed symbols (^VIX, ^SOX, ^TNX)
      // have no meaningful EPS so we drop them here to avoid a wasted
      // Finnhub call that always returns null.
      (!t.startsWith("^") || (t in INDEX_ETF_PROXY)) &&
      !/[-]USD$/i.test(t) &&         // crypto
      !/=X$/.test(t)                 // forex
    );
  // Need at least one provider key to do anything. Either is enough:
  //   - FINNHUB_API_KEY only → individual stocks work, indices don't
  //   - FMP_API_KEY only      → indices work, individual stocks don't
  if (tickers.length === 0 || (!FINNHUB_API_KEY && !FMP_API_KEY)) {
    return new Response(JSON.stringify({}), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Cap parallelism so we don't burst past either provider's per-second
  // rate limit (Finnhub free = 60/min ≈ 1/sec; FMP free = ~10/sec).
  // 6 in-flight is safe for both.
  const out: Record<string, Fundamentals | { _debug: any }> = {};
  const queue = [...tickers];
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) break;
      const f = await fetchFundamentals(t);
      if (f) out[t] = f;
    }
  });
  await Promise.all(workers);

  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
