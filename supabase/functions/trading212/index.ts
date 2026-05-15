// Supabase Edge Function: trading212
//
// Mirrors a small slice of the owner's Trading 212 portfolio — just
// `quantity` and `averagePrice` for a hard-coded allow-list of tickers
// the user DCAs through T212 (currently `VUAG.L` and `SEGM.L`, the
// two GBP-denominated ETFs the user buys daily). Lets the app pick
// up new T212 buys without the user typing each lot into the
// EditTickerModal.
//
//   GET /functions/v1/trading212
//     →  { holdings: { 'VUAG.L': { shares, cost }, 'SEGM.L': { ... } },
//          updatedAt: ISO-string,
//          source: 'cache' | 'live' | 'stale' | 'disabled' }
//
// `cost` is per-share average cost in the instrument's quote
// currency. T212's `/equity/portfolio` reports `averagePrice` in the
// account's settle currency for the instrument — for VUAG.L /
// SEGM.L (both GBP-denominated UCITS ETFs on LSE) that's GBP, NOT
// the GBp/pence figure Yahoo's quote feed publishes. So this
// function passes `averagePrice` through unchanged. `shares` is
// T212's `quantity`. The shape folds into
// `holding.lots = [{ date: today, shares, cost }]` — a single
// synthetic lot replacing whatever was there. lot.cost / h.cost is
// per-share AC everywhere in the app; metrics.js multiplies
// `h.shares * h.cost` for total cost.
//
// All visitors call this on every doRefresh, so the response is
// cached server-side at `public.trading212_cache` for 120 s. T212's
// rate limit is 1 req / 30 s on `/equity/portfolio`; with a 120 s
// TTL there's a 90 s margin on the steady-state rate. To kill the
// boundary race entirely — two workers racing past the freshness
// check on a stale row and both firing live T212 calls in the same
// rate-limit window — refresh is also gated by an atomic Postgres
// claim (`try_claim_t212_refresh` RPC, conditional UPSERT). Only
// the worker that successfully updates `updated_at` calls T212;
// losers serve whatever the winner already wrote.
//
// `T212_API_KEY` env var is required for live calls — T212's
// documented public API auth is a single key passed as the raw
// `Authorization` header value (no `Bearer ` prefix, no Basic
// encoding; see https://t212public-api-docs.redoc.ly/). The
// optional `T212_API_SECRET` is used as a fallback HTTP Basic Auth
// password in case the account / API version actually requires the
// two-key scheme. When `T212_API_KEY` is absent the function
// returns `source: 'disabled'` + empty holdings so the client can
// no-op. T212 errors fall back to stale cache up to STALE_OK_MS old.

// Yahoo ticker → T212 internal ticker. The T212 convention for LSE is
// `<TICKER>l_EQ` (lowercase 'l' exchange suffix + `_EQ`). The function
// fetches the full portfolio and picks out just the entries in this
// map; everything else is dropped.
const T212_TO_YAHOO: Record<string, string> = {
  "VUAGl_EQ": "VUAG.L",
  "SEGMl_EQ": "SEGM.L",
};

const CACHE_TTL_MS = 120_000;       // 120 s: 4× T212's 1-req-per-30-s window
const STALE_OK_MS  = 5 * 60_000;    // serve stale up to 5 min on upstream error

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "https://flmvxigozjuizpckllvk.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const T212_API_KEY    = Deno.env.get("T212_API_KEY") ?? "";
const T212_API_SECRET = Deno.env.get("T212_API_SECRET") ?? "";

const T212_PORTFOLIO_URL = "https://live.trading212.com/api/v0/equity/portfolio";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Pick out the allow-listed tickers from a raw T212 `/equity/portfolio`
 * response and normalize each row into the `{ shares, cost }` shape
 * the client expects. `averagePrice` is taken verbatim — for the
 * VUAG.L / SEGM.L allow-list (LSE-listed GBP ETFs) T212 reports in
 * GBP, not pence. `cost` is per-share AC (the value the lot editor /
 * computeMetrics multiply by `shares` to get position-level cost).
 *
 * Pure function so `index.test.ts` can pin the conversion math +
 * ticker filtering without needing the network.
 */
export function shapeT212Portfolio(
  positions: unknown,
): Record<string, { shares: number; cost: number }> {
  const out: Record<string, { shares: number; cost: number }> = {};
  if (!Array.isArray(positions)) return out;
  for (const p of positions) {
    if (!p || typeof p !== "object") continue;
    const t212Ticker = (p as { ticker?: unknown }).ticker;
    if (typeof t212Ticker !== "string") continue;
    const yahooTicker = T212_TO_YAHOO[t212Ticker];
    if (!yahooTicker) continue;
    const quantity = Number((p as { quantity?: unknown }).quantity);
    const averagePrice = Number((p as { averagePrice?: unknown }).averagePrice);
    if (!isFinite(quantity) || quantity <= 0) continue;
    if (!isFinite(averagePrice) || averagePrice <= 0) continue;
    out[yahooTicker] = {
      shares: quantity,
      cost: averagePrice,
    };
  }
  return out;
}

/**
 * Pure freshness predicate so the test suite can pin TTL behaviour
 * without faking Date. Returns true when the cache row was written
 * `ttlMs` or fewer ms ago.
 */
export function cacheIsFresh(updatedAt: string | null, nowMs: number, ttlMs: number): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (!isFinite(t)) return false;
  return nowMs - t < ttlMs;
}

/**
 * Build the HTTP Basic Auth header value for T212. T212's current
 * scheme uses two keys — API key id and secret — concatenated with
 * a colon and base64 encoded, same as standard HTTP Basic.
 *
 * Pure function so the test suite can pin the encoding without
 * exposing real secrets.
 */
export function basicAuthHeader(keyId: string, secret: string): string {
  return "Basic " + btoa(`${keyId}:${secret}`);
}

async function readCacheRow(): Promise<{ data: unknown; updated_at: string } | null> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/trading212_cache?id=eq.1&select=data,updated_at`, {
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  } catch {
    return null;
  }
}

/**
 * Atomic refresh claim. Returns true iff this worker won the right
 * to call T212 for this window. Implemented as a Postgres RPC
 * (`try_claim_t212_refresh`, added in migration 0008) that does a
 * conditional UPSERT — bumps `updated_at` only when the existing
 * row is older than ttl_ms (or no row exists), and returns whether
 * the row was actually written. `INSERT ... ON CONFLICT DO UPDATE
 * WHERE` is atomic, so two workers racing the call see at most one
 * true return value. RPC failures (network, missing migration, bad
 * permissions) log to Supabase Functions logs but don't surface in
 * the client response — the loser branch is the right behaviour
 * either way.
 */
async function claimRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/try_claim_t212_refresh`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl_ms: CACHE_TTL_MS }),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`T212 claim RPC ${res.status}: ${snippet}`);
      return false;
    }
    const body = await res.json();
    return body === true;
  } catch (e) {
    console.error("T212 claim RPC error:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function writeCacheRow(data: unknown): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/trading212_cache`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id: 1, data, updated_at: new Date().toISOString() }),
    });
  } catch {
    // Cache write failures are non-fatal — next visitor will refetch.
  }
}

async function fetchT212Portfolio(): Promise<unknown> {
  // Try T212's documented single-key auth first: the raw API key as
  // the Authorization header value, no prefix, no encoding. This is
  // what t212public-api-docs.redoc.ly specifies. If the account /
  // API version actually requires the two-key Basic Auth flavor a
  // user-side AI floated, fall back to that on 401 only — every
  // upstream call burns a 30s rate-limit slot, so the fallback is
  // gated behind an actual auth failure.
  let res = await fetch(T212_PORTFOLIO_URL, {
    headers: {
      authorization: T212_API_KEY,
      accept: "application/json",
    },
  });
  if (res.status === 401 && T212_API_SECRET) {
    res = await fetch(T212_PORTFOLIO_URL, {
      headers: {
        authorization: basicAuthHeader(T212_API_KEY, T212_API_SECRET),
        accept: "application/json",
      },
    });
  }
  if (!res.ok) {
    // Include a short body snippet so the catch-path's `error` field
    // can show what T212 actually said — without it `stale` is opaque
    // and you can't tell auth-fail from rate-limit from endpoint-404.
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`T212 ${res.status} ${res.statusText} :: ${snippet}`);
  }
  return await res.json();
}

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "method not allowed" }), {
        status: 405, headers: { ...CORS, "content-type": "application/json" },
      });
    }

    if (!T212_API_KEY) {
      return new Response(JSON.stringify({
        holdings: {},
        updatedAt: new Date().toISOString(),
        source: "disabled",
      }), { headers: { ...CORS, "content-type": "application/json" } });
    }

    const now = Date.now();
    const cached = await readCacheRow();
    if (cached && cacheIsFresh(cached.updated_at, now, CACHE_TTL_MS)) {
      return new Response(JSON.stringify({
        holdings: cached.data,
        updatedAt: cached.updated_at,
        source: "cache",
      }), { headers: { ...CORS, "content-type": "application/json" } });
    }

    // Stale (or cold). Atomically claim the right to refresh. Only the
    // winner calls T212; losers re-read the cache (winner may have
    // written between our SELECT and our claim attempt) and serve
    // whatever's there. Worst case for a loser on cold cache: empty
    // holdings for one tick until the winner's write lands.
    const claimed = await claimRefresh();
    if (!claimed) {
      const refreshed = await readCacheRow();
      const row = refreshed || cached;
      if (row) {
        return new Response(JSON.stringify({
          holdings: row.data,
          updatedAt: row.updated_at,
          source: "cache",
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        holdings: {},
        updatedAt: new Date().toISOString(),
        source: "stale",
      }), { headers: { ...CORS, "content-type": "application/json" } });
    }

    try {
      const raw = await fetchT212Portfolio();
      const holdings = shapeT212Portfolio(raw);
      await writeCacheRow(holdings);
      return new Response(JSON.stringify({
        holdings,
        updatedAt: new Date().toISOString(),
        source: "live",
      }), { headers: { ...CORS, "content-type": "application/json" } });
    } catch (e) {
      // T212 errored after we claimed the refresh slot. Log to
      // Supabase Functions logs for forensics, then serve stale
      // cache (within 5 min grace) so a transient 429 / 500 doesn't
      // blank the lots out client-side.
      console.error("T212 upstream error:", e instanceof Error ? e.message : e);
      if (cached && cacheIsFresh(cached.updated_at, now, STALE_OK_MS)) {
        return new Response(JSON.stringify({
          holdings: cached.data,
          updatedAt: cached.updated_at,
          source: "stale",
        }), { headers: { ...CORS, "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        holdings: {},
        updatedAt: new Date().toISOString(),
        source: "stale",
      }), { headers: { ...CORS, "content-type": "application/json" } });
    }
  });
}
