// Supabase Edge Function: fundamentals
//
// Returns current TTM P/E + trailing EPS for a list of tickers via
// Yahoo's v7/finance/quote endpoint (single batched request, no
// crumb-token gate — v10/quoteSummary started 401-ing on
// non-browser fetches, so we use the simpler shape that still works
// from Deno Deploy IPs).
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Fundamentals = { pe: number; eps: number };

async function fetchYahooBatch(symbols: string[]): Promise<Record<string, Fundamentals>> {
  if (symbols.length === 0) return {};
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&fields=trailingPE,epsTrailingTwelveMonths,quoteType`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const rows: any[] = data?.quoteResponse?.result ?? [];
    const out: Record<string, Fundamentals> = {};
    for (const row of rows) {
      const symbol = row?.symbol;
      // ETFs report `quoteType: "ETF"` and frequently have a synthetic
      // trailingPE that's the weighted average of holdings — not what
      // the user means by "P/E". Skip them so the button stays hidden.
      if (!symbol || row?.quoteType === "ETF" || row?.quoteType === "MUTUALFUND") continue;
      const pe  = Number(row?.trailingPE);
      const eps = Number(row?.epsTrailingTwelveMonths);
      if (!isFinite(pe) || !isFinite(eps) || eps <= 0 || pe <= 0) continue;
      out[symbol] = { pe, eps };
    }
    return out;
  } catch {
    return {};
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
    // a Yahoo request just to get null. The client also filters most
    // of these before calling, but defense in depth.
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
  if (tickers.length === 0) {
    return new Response(JSON.stringify({}), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const out = await fetchYahooBatch(tickers);
  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
