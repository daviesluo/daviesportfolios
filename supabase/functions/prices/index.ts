// Supabase Edge Function: prices
// Fetches Yahoo Finance prices server-side — no CORS proxies needed.
// Call: GET /functions/v1/prices?tickers=NVDA,AAPL,GOOG
// Returns: { "NVDA": { lastPrice, extPrice, prevClose, dayPct, extDayPct }, ... }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Regular session boundaries in exchange-local minutes-of-day
const MARKET_OPEN_MIN  = 9 * 60 + 30;  // 9:30 AM
const MARKET_CLOSE_MIN = 16 * 60;       // 4:00 PM

async function fetchPrice(symbol: string): Promise<{
  lastPrice: number;
  extPrice: number | null;
  prevClose: number;
  dayPct: number;
  extDayPct: number | null;
} | null> {
  const nonce = Date.now();
  // 5-minute candles for today with pre+post market — lets us read extended
  // hours prices directly from candle closes rather than unreliable meta fields.
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=5m&range=1d&includePrePost=true&_=${nonce}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta   = result?.meta;
    if (!meta?.regularMarketPrice) return null;

    const lastPrice: number = meta.regularMarketPrice;
    // regularMarketPreviousClose = most recent completed regular session close.
    // chartPreviousClose = session before the chart's range start — with range=1d
    // on a pre-market morning that can be two sessions back, so use it last.
    const prevClose: number =
      meta.regularMarketPreviousClose ??
      meta.previousClose ??
      meta.chartPreviousClose ??
      lastPrice;

    // gmtoffset is the exchange's offset from UTC in seconds (e.g. EDT = -14400).
    // We use it to convert each candle's UTC timestamp to local time-of-day so
    // we can tell whether it falls inside or outside the regular session.
    const gmtOffset: number = meta.gmtoffset ?? -14400;
    const timestamps: number[]       = result?.timestamp ?? [];
    const closes: (number | null)[]  = result?.indicators?.quote?.[0]?.close ?? [];

    // Walk backwards to find the most recent candle that sits outside regular
    // market hours — that is the current extended-hours price.
    let extPrice: number | null = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const close = closes[i];
      if (close == null) continue;
      // Convert UTC timestamp → local seconds-in-day (handles negative offsets)
      const localSecInDay = ((timestamps[i] + gmtOffset) % 86400 + 86400) % 86400;
      const localMin      = Math.floor(localSecInDay / 60);
      if (localMin < MARKET_OPEN_MIN || localMin >= MARKET_CLOSE_MIN) {
        extPrice = close;
        break;
      }
    }

    const pc = prevClose;
    return {
      lastPrice,
      extPrice,
      prevClose: pc,
      dayPct:    pc > 0 ? ((lastPrice  - pc) / pc) * 100 : 0,
      extDayPct: (extPrice != null && pc > 0) ? ((extPrice - pc) / pc) * 100 : null,
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const url   = new URL(req.url);
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

  // Fetch all tickers in parallel — same pattern as before, proven fast.
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
