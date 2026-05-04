// Supabase Edge Function: fundamentals
//
// Returns current TTM P/E + trailing EPS for a list of tickers via
// Finnhub's stock-metric endpoint. We tried Yahoo's v7/quote and
// v10/quoteSummary but both were crumb-gated to a degree the Deno
// Deploy egress IPs couldn't reliably bootstrap; Finnhub's free tier
// (60 calls / minute, no payment info) gives a stable shape.
//
// Env: FINNHUB_API_KEY (required). Set in Supabase Edge Functions →
// Settings → Secrets. If absent, the function returns {} for every
// request and the client treats every ticker as "no P/E available"
// (button stays hidden) — no errors thrown, just no feature.
//
// Used by the ticker chart modal's "P/E YTD" view: the client divides
// each YTD daily-close price by the EPS returned here to plot a P/E
// series. The approximation assumes EPS hasn't moved within YTD —
// fine for most stocks within a quarter, becomes inaccurate right
// after an earnings report.
//
// Tickers without meaningful fundamentals (futures, indices, ETFs,
// crypto, .PVT placeholders, 6-digit CN funds, loss-makers with
// negative EPS) are simply absent from the response.
//
// Call: GET /functions/v1/fundamentals?tickers=NVDA,GOOG,AAPL
// Returns: { NVDA: { pe: 30.5, eps: 6.5 }, GOOG: { pe: 25, eps: 8.2 } }

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Fundamentals = { pe: number; eps: number; pe3yAvg: number | null };

// Finnhub returns metric data shaped like:
//   { metric: { peTTM: 30.5, epsTTM: 6.5, ... },
//     series: { annual: { pe: [{period, v}, ...], ... },
//               quarterly: {...} } }
// We need peTTM + epsTTM (current) plus the most recent 3 annual PE
// values for the 3-year-average reference line on the YTD chart.
// Field-name fallbacks:
//   pe  → peTTM | peBasicExclExtraTTM | peNormalizedAnnual
//   eps → epsTTM | epsBasicExclExtraItemsTTM | epsNormalizedAnnual
// Three major indices use ETF proxies for the P/E lookup since
// Finnhub's /stock/metric is meant for individual companies — but the
// matching ETF (SPY for ^GSPC, QQQ for ^NDX, IWM for ^RUT) carries
// a published trailing P/E that's a reasonable stand-in for the
// underlying basket. The response is keyed back under the original
// `^GSPC` etc. so the client doesn't need to know about the alias.
const INDEX_ETF_PROXY: Record<string, string> = {
  "^GSPC": "SPY",
  "^NDX":  "QQQ",
  "^RUT":  "IWM",
};

async function fetchFinnhub(symbol: string): Promise<Fundamentals | null> {
  if (!FINNHUB_API_KEY) return null;
  const queriedSymbol = INDEX_ETF_PROXY[symbol] ?? symbol;
  const url =
    `https://finnhub.io/api/v1/stock/metric` +
    `?symbol=${encodeURIComponent(queriedSymbol)}&metric=all` +
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
    let   eps = Number(m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? m.epsNormalizedAnnual);
    if (!isFinite(pe) || pe <= 0) return null;
    // ETFs / index proxies (SPY/QQQ/IWM) typically don't carry an
    // aggregate epsTTM in Finnhub's free tier — only peTTM is
    // populated. Reject `eps <= 0` only for individual stocks; for
    // proxied symbols we send eps:0 and the client reconstructs an
    // implied EPS from the historical-close anchor (last_close / pe).
    // The chart's shape ends up identical either way; the y-axis
    // labels match the Finnhub-quoted P/E.
    const isProxiedIndex = symbol in INDEX_ETF_PROXY;
    if (!isProxiedIndex) {
      if (!isFinite(eps) || eps <= 0) return null;
    } else {
      if (!isFinite(eps) || eps <= 0) eps = 0;
    }

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
  if (tickers.length === 0 || !FINNHUB_API_KEY) {
    return new Response(JSON.stringify({}), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Free tier is 60 calls / minute → ~1 call / sec. Issuing N parallel
  // requests for a 30-ticker portfolio would burst over that ceiling
  // briefly; cap parallelism at 6 to stay under it for typical
  // refreshes.
  const out: Record<string, Fundamentals> = {};
  const queue = [...tickers];
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) break;
      const f = await fetchFinnhub(t);
      if (f) out[t] = f;
    }
  });
  await Promise.all(workers);

  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
