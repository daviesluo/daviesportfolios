// Supabase Edge Function: chart
// Fetches daily historical closes for a list of tickers, server-side (no CORS
// proxies). Routes per ticker:
//   - 6-digit numeric (e.g. 017731) → eastmoney 天天基金 pingzhongdata.js
//   - Everything else (incl. .PVT)  → Yahoo Finance v8/chart
// Tickers that fail to fetch are simply omitted from the response.
// Returns: { "AAPL": [{date:"2026-01-02",close:245.12}, …], … }
// Call: GET /functions/v1/chart?tickers=NVDA,017731,SPAX.PVT,^GSPC&range=1y&interval=1d

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CN_FUND_RE = /^\d{6}$/;

type Point = { date: string; close: number };

// ---------------- Yahoo Finance ----------------
async function fetchYahooHistorical(
  symbol: string,
  range: string,
  interval: string,
  includePrePost: boolean,
): Promise<Point[] | null> {
  const nonce = Date.now();
  const ipp = includePrePost ? "&includePrePost=true" : "";
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}${ipp}&_=${nonce}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
      // 5 s ceiling per ticker. Fetching all portfolio tickers via
      // Promise.all means the slowest one gates the response, so trim
      // generously — well-behaved Yahoo responses land under 1 s.
      signal: AbortSignal.timeout(5_000),
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

    // Daily interval → YYYY-MM-DD (one point per day, key = date).
    // Intraday intervals (e.g. 5m, 15m) → keep precision down to the
    // minute so each candle has a unique sortable string. Truncating
    // intraday points to YYYY-MM-DD would collapse them all to one key.
    const isIntraday = !/^\d+d$|^\dwk$|^\dmo$/.test(interval);
    const points: Point[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      const iso = new Date(timestamps[i] * 1000).toISOString();
      const date = isIntraday ? iso.slice(0, 16) : iso.slice(0, 10);
      points.push({ date, close: c / penceFactor });
    }
    return points.length > 0 ? points : null;
  } catch {
    return null;
  }
}

// ---------------- Eastmoney 天天基金 (CN mutual funds) ----------------
// pingzhongdata returns a JS file with the fund's full NAV history in
//   var Data_netWorthTrend = [{"x":1640966400000,"y":1.2345,…}, …];
// where x = unix ms timestamp, y = unit NAV (单位净值). We extract this array
// and filter to the requested range. Note: CN funds publish ONE NAV per
// trading day after market close — there's no intraday history.
function rangeCutoffMs(range: string): number {
  const now = Date.now();
  if (range === "ytd") {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    return yearStart - 7 * 86_400_000; // small buffer so prior-year-end close is included
  }
  if (range === "1y" || range === "1Y")  return now - 380 * 86_400_000;
  if (range === "6mo")                    return now - 200 * 86_400_000;
  if (range === "3mo")                    return now - 100 * 86_400_000;
  if (range === "1mo")                    return now -  35 * 86_400_000;
  return 0; // unknown range → return everything
}

async function fetchEastmoneyHistorical(code: string, range: string): Promise<Point[] | null> {
  // Try the lighter pingzhongdata endpoint first; fall back to api.fund.eastmoney.com's
  // f10/lsjz JSON API if the JS file is unreachable (eastmoney has been redirecting
  // plain-HTTP requests to a CDN host that occasionally 403s on Deno Deploy IPs).
  const cdnUrl = `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js?v=${Date.now()}`;
  const apiUrl = `https://api.fund.eastmoney.com/f10/lsjz` +
    `?fundCode=${encodeURIComponent(code)}&pageIndex=1&pageSize=500&_=${Date.now()}`;

  // ---- Path 1: pingzhongdata (small, single fetch, has full multi-year history)
  try {
    const res = await fetch(cdnUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://fund.eastmoney.com/",
        "Accept": "*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const text = await res.text();
      const m = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/);
      if (m) {
        let arr: { x: number; y: number | string }[] = [];
        try {
          arr = JSON.parse(m[1]);
        } catch {
          const itemRe = /"x"\s*:\s*(\d+)\s*,\s*"y"\s*:\s*([\d.]+)/g;
          let im: RegExpExecArray | null;
          while ((im = itemRe.exec(m[1])) !== null) {
            arr.push({ x: parseInt(im[1], 10), y: parseFloat(im[2]) });
          }
        }
        if (arr.length > 0) {
          const out = trimToRange(
            arr.map((p) => {
              const close = typeof p.y === "number" ? p.y : parseFloat(String(p.y));
              return isFinite(close) && close > 0
                ? { date: new Date(p.x).toISOString().slice(0, 10), close }
                : null;
            }).filter((p): p is Point => p !== null),
            range,
          );
          if (out.length > 0) return out;
        }
      }
    }
  } catch { /* fall through to api.fund.eastmoney.com */ }

  // ---- Path 2: api.fund.eastmoney.com/f10/lsjz (JSON, requires Referer)
  try {
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://fundf10.eastmoney.com/",
        "Accept": "application/json,text/plain,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = json?.Data?.LSJZList;
    if (!Array.isArray(list)) return null;
    // LSJZ rows: { FSRQ: "2026-04-23", DWJZ: "1.2345", … } — daily NAV.
    const points: Point[] = [];
    for (const row of list) {
      const close = parseFloat(row?.DWJZ);
      if (!isFinite(close) || close <= 0) continue;
      const date = String(row?.FSRQ ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      points.push({ date, close });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return trimToRange(points, range);
  } catch {
    return null;
  }
}

// Shared range trim — pingzhongdata returns multi-year, lsjz returns one page.
// Keep the part of the series that overlaps the requested range so the frontend
// doesn't carry around extra data.
function trimToRange(points: Point[], range: string): Point[] {
  if (points.length === 0) return points;
  const cutoff = rangeCutoffMs(range);
  if (cutoff <= 0) return points;
  const filtered = points.filter((p) => new Date(p.date).getTime() >= cutoff);
  return filtered.length > 0 ? filtered : points;
}

// ---------------- Router ----------------
function fetchOne(symbol: string, range: string, interval: string, includePrePost: boolean): Promise<Point[] | null> {
  if (CN_FUND_RE.test(symbol)) return fetchEastmoneyHistorical(symbol, range);
  return fetchYahooHistorical(symbol, range, interval, includePrePost);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const url = new URL(req.url);
  const param = url.searchParams.get("tickers") ?? "";
  const range = url.searchParams.get("range") ?? "ytd";
  const interval = url.searchParams.get("interval") ?? "1d";
  const includePrePost = url.searchParams.get("includePrePost") === "true";
  const tickers = param
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && t !== "CASH");

  if (!tickers.length) {
    return new Response(JSON.stringify({ error: "tickers required" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const entries = await Promise.all(
    tickers.map(async (t) => [t, await fetchOne(t, range, interval, includePrePost)] as const),
  );

  const out: Record<string, Point[]> = {};
  for (const [t, r] of entries) {
    if (r) out[t] = r;
  }

  return new Response(JSON.stringify(out), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
