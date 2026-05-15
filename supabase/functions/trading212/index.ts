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
// `cost` is total cost in the instrument's native currency (GBP for
// LSE listings — T212 reports LSE in pence/GBX, this function divides
// by 100 before returning to match the rest of the app's GBP
// convention). `shares` is T212's `quantity`. The shape is what the
// client folds into `holding.lots = [{ date: today, shares, cost }]`
// — a single synthetic lot replacing whatever was there.
//
// All visitors call this on every doRefresh, so the response is
// cached server-side at `public.trading212_cache` for 60 s (T212's
// rate limit is 1 req / 30 s; 60 s gives a 30 s safety margin in
// case two Edge Function workers race past the freshness check at
// the same instant). With the cache, N concurrent visitors share
// a single upstream call per window — without it, two visitors
// refreshing simultaneously would blow through the rate limit on
// `/equity/portfolio`.
//
// `TRADING212_API_KEY` env var is required for live calls; when
// absent the function returns `source: 'disabled'` and an empty
// holdings map so the client can no-op gracefully. T212 errors fall
// back to stale cache up to STALE_OK_MS old.

// Yahoo ticker → T212 internal ticker. The T212 convention for LSE is
// `<TICKER>l_EQ` (lowercase 'l' exchange suffix + `_EQ`). The function
// fetches the full portfolio and picks out just the entries in this
// map; everything else is dropped.
const T212_TO_YAHOO: Record<string, string> = {
  "VUAGl_EQ": "VUAG.L",
  "SEGMl_EQ": "SEGM.L",
};

// LSE-listed instruments — T212 reports prices in pence (GBX), so the
// function divides averagePrice by 100 before returning to match the
// rest of the app's GBP convention (utils.js does the same /100 to
// Yahoo's GBp meta currency).
const PENCE_DENOMINATED = new Set([".L"]);

function isPenceDenominated(yahooTicker: string): boolean {
  for (const suffix of PENCE_DENOMINATED) {
    if (yahooTicker.endsWith(suffix)) return true;
  }
  return false;
}

// 60 s TTL — comfortably under T212's `1 req / 30 s` rate limit on
// `/equity/portfolio` (1 req / 60 s leaves a 30 s safety margin in case
// two Edge Function workers race past the cache check at the same
// instant). T212 data lags client-displayed prices a little but DCA
// activity isn't time-sensitive enough to need 30 s freshness.
const CACHE_TTL_MS = 60_000;
const STALE_OK_MS  = 5 * 60_000;    // serve stale up to 5 min on upstream error

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "https://flmvxigozjuizpckllvk.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const T212_API_KEY = Deno.env.get("TRADING212_API_KEY") ?? "";

const T212_PORTFOLIO_URL = "https://live.trading212.com/api/v0/equity/portfolio";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Pick out the allow-listed tickers from a raw T212 `/equity/portfolio`
 * response and normalize each row into the `{ shares, cost }` shape
 * the client expects. Pence/GBX prices for LSE rows are divided by
 * 100 so the cost lands in GBP, matching the rest of the app.
 *
 * Pure function so the `index.test.ts` can pin the conversion math
 * + ticker filtering without needing the network.
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
    const priceNative = isPenceDenominated(yahooTicker) ? averagePrice / 100 : averagePrice;
    out[yahooTicker] = {
      shares: quantity,
      cost: quantity * priceNative,
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
  const res = await fetch(T212_PORTFOLIO_URL, {
    headers: {
      authorization: T212_API_KEY,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`T212 ${res.status}`);
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

    try {
      const raw = await fetchT212Portfolio();
      const holdings = shapeT212Portfolio(raw);
      await writeCacheRow(holdings);
      return new Response(JSON.stringify({
        holdings,
        updatedAt: new Date().toISOString(),
        source: "live",
      }), { headers: { ...CORS, "content-type": "application/json" } });
    } catch {
      // Upstream failed — serve stale cache if it's still within the
      // grace window, otherwise return empty so the client falls back
      // to whatever it has locally.
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
