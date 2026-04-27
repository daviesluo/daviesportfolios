// Supabase Edge Function: chart
// Fetches YTD daily historical closes for a list of tickers from Yahoo Finance
// in parallel, server-side (no CORS proxies). Returns:
//   { "AAPL": [{date:"2026-01-02",close:245.12}, …], "NVDA": [...], ... }
// Tickers that fail to fetch are simply omitted from the response.
// Call: GET /functions/v1/chart?tickers=NVDA,AAPL,^GSPC&range=ytd&interval=1d

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Point = { date: string; close: number };

async function fetchOne(symbol: string, range: string, interval: string): Promise<Point[] | null> {
  const nonce = Date.now();
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&_=${nonce}`;

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
    const timestamps: number[] | undefined = result?.timestamp;
    const closes: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.close;
    if (!timestamps || !closes) return null;

    // London-listed securities are quoted in pence (GBp/GBX). Normalise to GBP
    // so the frontend can apply a single GBP→USD FX rate uniformly.
    const currency: string | null = result?.meta?.currency ?? null;
    const penceFactor = currency === "GBp" || currency === "GBX" ? 100 : 1;

    const points: Point[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      points.push({ date, close: c / penceFactor });
    }
    return points.length > 0 ? points : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const url = new URL(req.url);
  const param = url.searchParams.get("tickers") ?? "";
  const range = url.searchParams.get("range") ?? "ytd";
  const interval = url.searchParams.get("interval") ?? "1d";
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

  const entries = await Promise.all(
    tickers.map(async (t) => [t, await fetchOne(t, range, interval)] as const),
  );

  const out: Record<string, Point[]> = {};
  for (const [t, r] of entries) {
    if (r) out[t] = r;
  }

  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
