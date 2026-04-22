// Supabase Edge Function: prices
// Fetches Yahoo Finance prices server-side — no CORS proxies needed.
// Call: GET /functions/v1/prices?tickers=NVDA,AAPL,GOOG
// Returns: { "NVDA": { lastPrice, extPrice, prevClose, dayPct, extDayPct }, ... }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchPrice(symbol: string): Promise<{
  lastPrice: number;
  extPrice: number | null;
  prevClose: number;
  dayPct: number;
  extDayPct: number | null;
} | null> {
  const nonce = Date.now();
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&range=5d&includePrePost=false&_=${nonce}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta?.regularMarketPrice) return null;

    // Walk backwards through daily closes (skip today's bar) for a clean prev-close.
    let prevClose: number | null = null;
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 2; i >= 0; i--) {
      if (closes[i] != null) {
        prevClose = closes[i] as number;
        break;
      }
    }
    if (prevClose == null) {
      prevClose = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
    }

    const lastPrice: number = meta.regularMarketPrice;
    const pc = prevClose as number;
    const extPrice: number | null = meta.preMarketPrice ?? meta.postMarketPrice ?? null;
    return {
      lastPrice,
      extPrice,
      prevClose: pc,
      dayPct: pc > 0 ? ((lastPrice - pc) / pc) * 100 : 0,
      extDayPct: (extPrice != null && pc > 0) ? ((extPrice - pc) / pc) * 100 : null,
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const url = new URL(req.url);
  const param = url.searchParams.get("tickers") ?? "";
  const tickers = param
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !t.endsWith(".PVT") && t !== "CASH");

  if (!tickers.length) {
    return new Response(JSON.stringify({ error: "tickers required" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Fetch all tickers in parallel server-side.
  const entries = await Promise.all(
    tickers.map(async (t) => [t, await fetchPrice(t)] as const)
  );

  const out: Record<string, unknown> = {};
  for (const [t, r] of entries) {
    if (r) out[t] = r;
  }

  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
