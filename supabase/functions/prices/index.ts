// Supabase Edge Function: prices
// Fetches Yahoo Finance prices server-side — no CORS proxies needed.
// Call: GET /functions/v1/prices?tickers=NVDA,AAPL,GOOG
// Returns: { "NVDA": { lastPrice, extPrice, prevClose, dayPct, extDayPct }, ... }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
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

  const nonce = Date.now();
  const symbols = tickers.map(encodeURIComponent).join(",");
  const quoteUrl =
    `https://query1.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${symbols}` +
    `&fields=regularMarketPrice,regularMarketPreviousClose,chartPreviousClose,preMarketPrice,postMarketPrice` +
    `&_=${nonce}`;

  try {
    const res = await fetch(quoteUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(10_000),
    });

    const out: Record<string, unknown> = {};

    if (res.ok) {
      const data = await res.json();
      const quotes: any[] = data?.quoteResponse?.result ?? [];

      for (const quote of quotes) {
        const lastPrice: number | undefined = quote.regularMarketPrice;
        if (lastPrice == null) continue;

        const prevClose: number =
          quote.regularMarketPreviousClose ??
          quote.chartPreviousClose ??
          lastPrice;

        const extPrice: number | null =
          quote.preMarketPrice ?? quote.postMarketPrice ?? null;

        const pc = prevClose;
        out[quote.symbol] = {
          lastPrice,
          extPrice,
          prevClose: pc,
          dayPct: pc > 0 ? ((lastPrice - pc) / pc) * 100 : 0,
          extDayPct:
            extPrice != null && pc > 0
              ? ((extPrice - pc) / pc) * 100
              : null,
        };
      }
    }

    return new Response(JSON.stringify(out), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({}), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
