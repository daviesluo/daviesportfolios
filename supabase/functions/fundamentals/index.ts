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

type Fundamentals = { pe: number; eps: number };

// Finnhub returns metric data shaped like:
//   { metric: { peTTM: 30.5, epsTTM: 6.5, ... }, metricType, series: {...} }
// We only need peTTM + epsTTM. Note: free tier sometimes returns
// `peBasicExcl…` / `epsExclExtra…` variants — we read the most
// straightforward TTM fields and fall back to alternates.
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
    // Field-name fallback chain — Finnhub uses slightly different
    // names depending on the company / how Yahoo reported.
    const pe  = Number(m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual);
    const eps = Number(m.epsTTM ?? m.epsBasicExclExtraItemsTTM ?? m.epsNormalizedAnnual);
    if (!isFinite(pe) || !isFinite(eps) || eps <= 0 || pe <= 0) return null;
    return { pe, eps };
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
      !t.startsWith("^") &&          // indices
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
