// Supabase Edge Function: overnight-fetch
//
// Returns the recorded overnight intraday points for a set of tickers,
// grouped by ticker, in the chart's standard {date,close,volume}
// shape. The ticker chart modal calls this on every refresh to draw
// the overnight LINE (20:00-04:00 ET) for US-equity holdings.
//
// Call:  GET /functions/v1/overnight-fetch?tickers=NVDA,AAPL,GOOG
// Reply: { "NVDA": [{date:'YYYY-MM-DDTHH:MM', close, volume:0}, …],
//          "AAPL": [ … ], … }   // oldest-first, last ~26h only
//
// `tickers` is required and capped (defensive — anon endpoint). Each
// ticker's points are the rows within the last ~26h (today's
// overnight session + buffer for a cron-missed firing). Empty array
// for a ticker with no recorded points.
//
// Auth: anon-readable (the Supabase apikey check is enough — these
// are only price snapshots, the same surface other anon Edge
// Functions like `chart` expose).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Cap the ticker list so a crafted request can't ask for an unbounded
// IN() set. A portfolio is a few dozen names; 100 is generous.
const MAX_TICKERS = 100;

// ---------------- Pure helpers (test-pinned) ----------------

/** Parse + sanitise the `tickers` query param into a unique, capped list. */
export function parseTickers(param: string | null): string[] {
  if (!param) return [];
  const seen = new Set<string>();
  for (const raw of param.split(",")) {
    const t = raw.trim();
    // Allow the same shapes the chart serves: A-Z, digits, dot, dash,
    // caret. Drops anything weird before it reaches the DB filter.
    if (t && /^[A-Za-z0-9.\-^]+$/.test(t)) seen.add(t);
    if (seen.size >= MAX_TICKERS) break;
  }
  return Array.from(seen);
}

/**
 * Group flat DB rows (oldest-first, any ticker order) into
 * { ticker: [{date,close,volume:0}, …] } with each ticker's points
 * oldest-first. `date` is the bucket_time truncated to minute
 * (YYYY-MM-DDTHH:MM) to match the intraday series shape used
 * elsewhere. NUMERIC comes back from PostgREST as a string, so coerce.
 */
export function groupRows(
  rows: Array<{ ticker: string; bucket_time: string; price: number | string }>,
): Record<string, Array<{ date: string; close: number; volume: number }>> {
  const out: Record<string, Array<{ date: string; close: number; volume: number }>> = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!r || typeof r.ticker !== "string") continue;
    const close = typeof r.price === "number" ? r.price : parseFloat(String(r.price));
    if (!Number.isFinite(close)) continue;
    (out[r.ticker] ??= []).push({ date: String(r.bucket_time).slice(0, 16), close, volume: 0 });
  }
  return out;
}

// ---------------- I/O ----------------

async function readPoints(
  tickers: string[],
  cutoff: string,
): Promise<Array<{ ticker: string; bucket_time: string; price: number | string }>> {
  if (!SB_URL || !SERVICE_KEY || tickers.length === 0) return [];
  // PostgREST `in.(…)` list — values wrapped in double quotes to be
  // safe with dotted / caret tickers. parseTickers already restricts
  // the charset so this can't break out of the quoting.
  const inList = tickers.map((t) => `"${t}"`).join(",");
  const url = `${SB_URL}/rest/v1/overnight_intraday_points` +
    `?ticker=in.(${encodeURIComponent(inList)})` +
    `&bucket_time=gte.${encodeURIComponent(cutoff)}` +
    `&order=ticker.asc,bucket_time.asc` +
    `&select=ticker,bucket_time,price`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

// ---------------- Server ----------------

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const tickers = parseTickers(url.searchParams.get("tickers"));
    // 26h: today's overnight session + buffer for a cron-missed tick.
    const cutoff = new Date(Date.now() - 26 * 3_600_000).toISOString();
    let rows: Array<{ ticker: string; bucket_time: string; price: number | string }> = [];
    try { rows = await readPoints(tickers, cutoff); }
    catch { rows = []; }
    const body = groupRows(rows);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  });
}
