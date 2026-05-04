// Supabase Edge Function: fundamentals
//
// Returns current TTM P/E + trailing EPS for a list of tickers from
// two sources:
//
//   1. Individual stocks → Finnhub `/stock/metric` (free tier:
//      60 calls / minute, no payment info). Yahoo's v7/quote and
//      v10/quoteSummary were crumb-gated to a degree Deno Deploy
//      egress IPs couldn't reliably bootstrap.
//
//   2. Three big US indices (^GSPC / ^NDX / ^RUT) → hardcoded values
//      below (INDEX_PE_HARDCODED). We tried in order: Finnhub free
//      (returns 19 price-stat fields and zero fundamentals for ETFs);
//      FMP free (post-2025 stable endpoints either return no `pe`
//      field for SPY or 402-paywall QQQ/IWM); Yahoo /v8/chart meta
//      (25 fields, none of them P/E). With every free API exhausted,
//      hardcoding the indices' current trailing P/E + 3-year-average
//      P/E and refreshing the constants quarterly is the cleanest
//      path. Manual refresh: visit multpl.com / siblingnindexes for
//      current values, edit the table below, redeploy. Indices move
//      slowly (S&P 500 P/E ~+1.5 / quarter on average) so a 3-month
//      cadence is enough.
//
// Env:
//   FINNHUB_API_KEY  (required for individual-stock P/E; without it
//                     stocks just don't appear in the response)
// (No env var is needed for index P/E — values are baked in.)
//
// Tickers without meaningful fundamentals (futures, non-major indices,
// crypto, .PVT placeholders, 6-digit CN funds, loss-makers with
// negative EPS) are simply absent from the response.
//
// Used by the ticker chart modal's "P/E YTD" view. Stocks divide each
// YTD daily-close by the EPS returned here. Indices return eps:0 and
// the client reconstructs an implied EPS from `lastClose / pe` so the
// historical price series can still be divided into P/E values.
//
// Call: GET /functions/v1/fundamentals?tickers=NVDA,GOOG,^GSPC
// Returns:
//   {
//     NVDA:  { pe: 40.16, eps: 4.90, pe3yAvg: 43.13 },
//     ^GSPC: { pe: 27.5,  eps: 0,    pe3yAvg: 25.0 }
//   }

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Fundamentals = { pe: number; eps: number; pe3yAvg: number | null };

// Hardcoded P/E values for the three big US indices. Refresh
// quarterly. Sources used the last time these were updated:
//   ^GSPC → multpl.com/s-p-500-pe-ratio
//   ^NDX  → wsj.com/market-data/quotes/index/US/XNAS/NDX/key-stats
//   ^RUT  → wsj.com/market-data/quotes/index/US/RUT/key-stats
// 3Y AVG = mean of the last 3 fiscal-year-end P/E values. Move slowly,
// so refreshing once a year is also fine.
//
// LAST REFRESHED: 2026-05-04. Values approximate — refresh whenever
// the printed P/E in the modal feels off.
const INDEX_PE_HARDCODED: Record<string, { pe: number; pe3yAvg: number }> = {
  "^GSPC": { pe: 27.5, pe3yAvg: 25.0 },
  "^NDX":  { pe: 33.0, pe3yAvg: 30.0 },
  "^RUT":  { pe: 28.0, pe3yAvg: 24.0 },
};

// Finnhub: individual stocks only. Free tier returns:
//   { metric: { peTTM, epsTTM, ... },
//     series: { annual: { pe: [{period, v}, ...] } } }
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

async function fetchFundamentals(symbol: string): Promise<Fundamentals | null> {
  const hard = INDEX_PE_HARDCODED[symbol];
  if (hard) return { pe: hard.pe, eps: 0, pe3yAvg: hard.pe3yAvg };
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
    // a Finnhub request just to get null. Indices are kept iff they're
    // in the hardcoded table — that's where the proxy mapping
    // implicitly lives now.
    .filter((t) =>
      !!t &&
      t !== "CASH" &&
      !/\.PVT$/i.test(t) &&
      !/^\d{6}$/.test(t) &&
      !/=F$/.test(t) &&             // futures
      (!t.startsWith("^") || (t in INDEX_PE_HARDCODED)) &&
      !/[-]USD$/i.test(t) &&         // crypto
      !/=X$/.test(t)                 // forex
    );
  if (tickers.length === 0) {
    return new Response(JSON.stringify({}), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Cap parallelism so we don't burst past Finnhub's per-second rate
  // limit (free = 60/min ≈ 1/sec). Hardcoded indices are sync, no
  // network — they finish instantly.
  const out: Record<string, Fundamentals> = {};
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
