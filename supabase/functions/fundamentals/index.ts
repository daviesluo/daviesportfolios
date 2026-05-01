// Supabase Edge Function: fundamentals
//
// Returns current TTM P/E + trailing EPS for a list of tickers via
// Yahoo's v7/finance/quote endpoint. Yahoo started gating quote +
// quoteSummary on a "crumb" token in mid-2024, so the function
// performs a 2-step bootstrap on cold start:
//   1. GET fc.yahoo.com to receive a session B-cookie.
//   2. GET /v1/test/getcrumb with that cookie to get a crumb string.
// Both are cached in module-level state for an hour so warm
// invocations skip the bootstrap.
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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type Fundamentals = { pe: number; eps: number };

// Module-level credential cache. Edge Functions reuse the same isolate
// across invocations until cold restart, so a single bootstrap
// suffices for ~hours of warm traffic.
let cachedCookie: string | null = null;
let cachedCrumb:  string | null = null;
let cookieExpiresAt = 0;

async function getYahooCreds(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedCookie && cachedCrumb && Date.now() < cookieExpiresAt) {
    return { cookie: cachedCookie, crumb: cachedCrumb };
  }
  try {
    // Step 1: hit fc.yahoo.com to harvest the B cookie that gates
    // crumb issuance. We don't follow redirects so we can read the
    // Set-Cookie header from the initial response.
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA, "Accept": "*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    const setCookie = cookieRes.headers.get("set-cookie") ?? "";
    const bMatch = setCookie.match(/B=([^;]+)/);
    if (!bMatch) return null;
    const cookie = `B=${bMatch[1]}`;

    // Step 2: crumb endpoint expects the cookie; returns the bare
    // crumb string in the response body.
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, "Accept": "*/*", "Cookie": cookie },
      signal: AbortSignal.timeout(5_000),
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 50) return null; // sanity: real crumbs are <16 chars

    cachedCookie    = cookie;
    cachedCrumb     = crumb;
    cookieExpiresAt = Date.now() + 60 * 60 * 1000; // 1 h
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function fetchYahooBatch(symbols: string[]): Promise<Record<string, Fundamentals>> {
  if (symbols.length === 0) return {};
  const creds = await getYahooCreds();
  if (!creds) return {};
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&fields=trailingPE,epsTrailingTwelveMonths,quoteType` +
    `&crumb=${encodeURIComponent(creds.crumb)}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
        "Cookie": creds.cookie,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      // Crumb may have been rotated — drop the cache so the next
      // request bootstraps fresh credentials.
      if (res.status === 401 || res.status === 403) {
        cachedCookie = null;
        cachedCrumb  = null;
      }
      return {};
    }
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

