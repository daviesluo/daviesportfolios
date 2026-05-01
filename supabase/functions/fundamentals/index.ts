// Supabase Edge Function: fundamentals
//
// Returns current TTM P/E + trailing EPS for a list of tickers via
// Yahoo's quoteSummary endpoint. Used by the ticker chart modal's
// "P/E YTD" view: the client divides each YTD daily-close price by
// the EPS returned here to plot a P/E series. The approximation
// assumes EPS hasn't moved within YTD — fine for short ranges and
// most stocks, becomes inaccurate over longer windows or right after
// an earnings report.
//
// Tickers without meaningful fundamentals (futures, indices, ETFs,
// crypto, .PVT placeholders, 6-digit CN funds) are simply absent
// from the response.
//
// Call: GET /functions/v1/fundamentals?tickers=NVDA,GOOG,AAPL
// Returns: { NVDA: { pe: 30.5, eps: 6.5 }, GOOG: { pe: 25, eps: 8.2 } }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Fundamentals = { pe: number; eps: number };

async function fetchYahooQuoteSummary(symbol: string): Promise<Fundamentals | null> {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=summaryDetail,defaultKeyStatistics`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return null;

    // Yahoo returns numeric fields as `{ raw, fmt }`. Both shapes
    // crop up depending on the module — read either.
    const pickNum = (v: unknown): number | null => {
      if (typeof v === "number" && isFinite(v)) return v;
      if (v && typeof v === "object" && "raw" in (v as any)) {
        const raw = (v as any).raw;
        return typeof raw === "number" && isFinite(raw) ? raw : null;
      }
      return null;
    };

    const pe  = pickNum(result.summaryDetail?.trailingPE);
    const eps = pickNum(result.defaultKeyStatistics?.trailingEps);
    if (pe == null || eps == null || eps <= 0 || pe <= 0) return null;
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
    // a Yahoo request just to get null.
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

  const entries = await Promise.all(
    tickers.map(async (t) => [t, await fetchYahooQuoteSummary(t)] as const),
  );
  const out: Record<string, Fundamentals> = {};
  for (const [t, r] of entries) {
    if (r) out[t] = r;
  }
  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
