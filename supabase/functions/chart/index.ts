// Supabase Edge Function: chart
// Fetches daily historical closes for a list of tickers, server-side (no CORS
// proxies). Routes per ticker:
//   - 6-digit numeric (e.g. 017731) → eastmoney 天天基金 pingzhongdata.js
//   - Everything else (incl. .PVT)  → Yahoo Finance v8/chart
// Tickers that fail to fetch are simply omitted from the response.
// Returns: { "AAPL": [{date:"2026-01-02",close:245.12}, …], … }
// Call: GET /functions/v1/chart?tickers=NVDA,017731,SPAX.PVT,^GSPC&range=1y&interval=1d

import { reportServerError } from "../_shared/ops.ts";

// `x-app-token` is advertised here BEFORE anything requires it, on
// purpose. A custom request header makes the call non-simple, so the
// browser preflights, and a preflight that doesn't list the header
// blocks the request outright — the function never sees it. Any client
// that starts sending the token therefore needs this deployed FIRST,
// including a Cloudflare preview build, which always talks to the
// production functions. Accepting a header nobody requires yet costs
// nothing; rejecting one costs a release.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

// Auto-injected by the Supabase runtime — used only by the
// reportServerError helper at the bottom of this file to surface
// unhandled exceptions in the admin ⚠ badge. No new secrets required.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CN_FUND_RE = /^\d{6}$/;

// `volume` is included on intraday bars so the modal can render a
// VWAP overlay without a second fetch. Optional + non-breaking — old
// clients that destructure { date, close } simply ignore it; new
// clients that compute VWAP get it for free out of the same payload.
type Point = { date: string; close: number; volume?: number };

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
      // 8 s ceiling per ticker — well-behaved Yahoo responses land under
      // 1 s, but Yahoo occasionally takes 4-6 s under load and a tighter
      // cap caused chart fetches to flake out as "Couldn't load history".
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps: number[] | undefined = result?.timestamp;
    const closes: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.close;
    // Volume is per-bar in Yahoo's quote indicator; only meaningful on
    // intraday bars (daily volume is aggregated and rarely useful for
    // overlays we draw). Forex / yields / indices come back as 0 or
    // null; the client treats those as "no volume" and skips the
    // VWAP overlay automatically.
    const volumes: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.volume;
    if (!timestamps || !closes) return null;

    // London-listed securities are quoted in pence (GBp/GBX). Normalise to GBP
    // so the frontend can apply a single GBP→USD FX rate uniformly.
    const currency: string | null = result?.meta?.currency ?? null;
    const penceFactor = currency === "GBp" || currency === "GBX" ? 100 : 1;

    // Daily interval → YYYY-MM-DD (one point per day, key = date).
    // Intraday intervals (e.g. 5m, 15m) → keep precision down to the
    // minute so each candle has a unique sortable string. Truncating
    // intraday points to YYYY-MM-DD would collapse them all to one key.
    // Multi-digit counts on all three suffixes (`2wk` / `12mo` …) so a
    // future daily-ish range can't fall through to the intraday branch
    // (the old `^\dwk$|^\dmo$` matched a single leading digit only).
    const isIntraday = !/^\d+(d|wk|mo)$/.test(interval);
    const points: Point[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      const iso = new Date(timestamps[i] * 1000).toISOString();
      const date = isIntraday ? iso.slice(0, 16) : iso.slice(0, 10);
      const v = isIntraday ? volumes?.[i] : null;
      const point: Point = { date, close: c / penceFactor };
      if (typeof v === "number" && isFinite(v) && v >= 0) point.volume = v;
      points.push(point);
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
export function rangeCutoffMs(range: string): number {
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
    if (res.ok) {
      const json = await res.json();
      const list = json?.Data?.LSJZList;
      if (Array.isArray(list)) {
        // LSJZ rows: { FSRQ: "2026-04-23", DWJZ: "1.2345", … } — daily NAV.
        const points: Point[] = [];
        for (const row of list) {
          const close = parseFloat(row?.DWJZ);
          if (!isFinite(close) || close <= 0) continue;
          const date = String(row?.FSRQ ?? "").slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          points.push({ date, close });
        }
        if (points.length > 0) {
          points.sort((a, b) => a.date.localeCompare(b.date));
          const out = trimToRange(points, range);
          if (out.length > 0) return out;
        }
      }
    }
  } catch { /* fall through to danjuanapp */ }

  // ---- Path 3: danjuanapp.com (Snowball / 雪球-owned 蛋卷基金, JSON history)
  // Generally the most permissive of the three from non-CN egress IPs —
  // they don't gate on Referer/Cookie like the eastmoney CDN sometimes does.
  const djUrl =
    `https://danjuanapp.com/djapi/fund/nav/history/${encodeURIComponent(code)}` +
    `?size=500&page=1`;
  try {
    const res = await fetch(djUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json,*/*",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.data?.items;
    if (!Array.isArray(items)) return null;
    const points: Point[] = [];
    for (const row of items) {
      const close = parseFloat(row?.nav);
      if (!isFinite(close) || close <= 0) continue;
      const date = String(row?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      points.push({ date, close });
    }
    if (points.length === 0) return null;
    points.sort((a, b) => a.date.localeCompare(b.date));
    return trimToRange(points, range);
  } catch {
    return null;
  }
}

// Shared range trim — pingzhongdata returns multi-year, lsjz returns one page.
// Keep the part of the series that overlaps the requested range so the frontend
// doesn't carry around extra data.
export function trimToRange(points: Point[], range: string): Point[] {
  if (points.length === 0) return points;
  const cutoff = rangeCutoffMs(range);
  if (cutoff <= 0) return points;
  const filtered = points.filter((p) => new Date(p.date).getTime() >= cutoff);
  return filtered.length > 0 ? filtered : points;
}

// ---------------- Router ----------------
function fetchOne(symbol: string, range: string, interval: string, includePrePost: boolean): Promise<Point[] | null> {
  if (CN_FUND_RE.test(symbol)) return fetchEastmoneyHistorical(symbol, range);
  return fetchYahooWithPvtFallback(symbol, range, interval, includePrePost);
}

// `.PVT` suffix is the app's convention for private / un-listed
// holdings (e.g. SPAX.PVT). Yahoo doesn't recognise the literal
// suffix and returns 404, but the underlying ticker (`SPAX`) often
// has daily data. Try the literal first; if that returns nothing,
// retry stripped. CN funds bypass this since they go to eastmoney.
async function fetchYahooWithPvtFallback(
  symbol: string,
  range: string,
  interval: string,
  includePrePost: boolean,
): Promise<Point[] | null> {
  const direct = await fetchYahooHistorical(symbol, range, interval, includePrePost);
  if (direct && direct.length > 0) return direct;
  if (/\.PVT$/i.test(symbol)) {
    const stripped = symbol.replace(/\.PVT$/i, "");
    if (stripped && stripped !== symbol) {
      return await fetchYahooHistorical(stripped, range, interval, includePrePost);
    }
  }
  return null;
}

// Direct insert into public.ops_errors via the service-role key (RLS
// denies anon). Used by the top-level try/catch wrap so a runtime
// crash here becomes a row the admin ⚠ badge surfaces instead of a
// silent 500. Best-effort: never throws.
// reportServerError now lives in ../_shared/ops.ts (imported above).

// Guarded so tests can import the pure helpers above without
// spinning up the server. Supabase's runtime executes index.ts as
// the entry module, so `import.meta.main` is true in production.
if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS });
    }

    const url = new URL(req.url);
    const param = url.searchParams.get("tickers") ?? "";
    const range = url.searchParams.get("range") ?? "ytd";
    const interval = url.searchParams.get("interval") ?? "1d";
    const includePrePost = url.searchParams.get("includePrePost") === "true";
    // Cap the fan-out — one upstream fetch per ticker (see prices), so a
    // huge list could open hundreds of concurrent Yahoo connections.
    const MAX_TICKERS = 100;
    const tickers = param
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && t !== "CASH")
      .slice(0, MAX_TICKERS);

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
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    await reportServerError("chart.unhandled", { message: msg });
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
