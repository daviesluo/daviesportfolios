// Supabase Edge Function: trading212
//
// Mirrors a small slice of the owner's Trading 212 portfolio — just
// `quantity` and `averagePrice` for a hard-coded allow-list of tickers
// the user DCAs through T212 (currently `VUAA.L` and `SAEM.L`, the
// two USD-denominated UCITS ETFs the user buys daily — T212's
// cashback + Spare-Change auto-invest both settle in USD, which is
// why the previous GBP-denominated VUAG.L / SEGM.L were swapped out
// to avoid an avoidable round-trip FX hit on every micro-buy). Lets
// the app pick up new T212 buys without the user typing each lot
// into the EditTickerModal.
//
//   GET /functions/v1/trading212
//     →  { holdings: { 'VUAA.L': { shares, cost }, 'SAEM.L': { ... } },
//          updatedAt: ISO-string,
//          source: 'cache' | 'live' | 'stale' | 'disabled' }
//
// `cost` is per-share average cost in the instrument's quote
// currency. T212's `/equity/portfolio` reports `averagePrice` in the
// account's settle currency for the instrument — for VUAA.L /
// SAEM.L (both USD-denominated UCITS ETFs on LSE) that's USD, NOT
// the GBp/pence figure Yahoo's quote feed uses for the GBP-side
// LSE listings. So this function passes `averagePrice` through
// unchanged. `shares` is T212's `quantity`. The shape folds into
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
//
// Token-gated by the same HMAC-signed `x-app-token` the `data` /
// `ops-error` functions use — admin OR ro is accepted, since the
// read-only "screenshot" mode is supposed to see synced holdings
// the same way it sees the rest of the portfolio. Holdings are PII
// and an anonymous endpoint would leak the owner's share counts
// and average cost to anyone with the function URL. Requires the
// `APP_AUTH_SECRET` env var (same value as the `auth` function).

// Yahoo ticker → T212 internal ticker. The T212 convention for LSE is
// `<TICKER>l_EQ` (lowercase 'l' exchange suffix + `_EQ`). The function
// fetches the full portfolio and picks out just the entries in this
// map; everything else is dropped. Both entries below are
// USD-denominated UCITS ETFs on LSE — see fx.js TICKER_CURRENCY_OVERRIDES
// for the corresponding client-side currency override that prevents
// the suffix-based `detectCurrency` from mis-detecting them as GBP.
const T212_TO_YAHOO: Record<string, string> = {
  "VUAAl_EQ": "VUAA.L",
  "SAEMl_EQ": "SAEM.L",
};

const CACHE_TTL_MS = 120_000;       // 120 s: 4× T212's 1-req-per-30-s window
const STALE_OK_MS  = 5 * 60_000;    // serve stale up to 5 min on upstream error

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_AUTH_SECRET = Deno.env.get("APP_AUTH_SECRET") ?? "";
const T212_API_KEY    = Deno.env.get("T212_API_KEY") ?? "";
const T212_API_SECRET = Deno.env.get("T212_API_SECRET") ?? "";

const T212_PORTFOLIO_URL = "https://live.trading212.com/api/v0/equity/portfolio";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

// HMAC-signed token verification. Duplicates `data/index.ts`'s
// `verifyToken` because Supabase Edge Functions don't have a
// shared-module mechanism — pinned in this file's own
// `index.test.ts` so refactoring one without the other can't
// silently land.
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  return btoa(String.fromCharCode(...buf))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

// Constant-time string equality — see data/index.ts for the rationale.
// Duplicated across Edge Function modules because Supabase Deno doesn't
// share code across functions; the per-function vitest pins keep the
// copies from drifting.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyToken(
  token: string,
  secret = APP_AUTH_SECRET,
): Promise<{ role: "admin" | "ro"; exp: number } | null> {
  if (!secret) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;
  const expected = await sign(payloadB64, secret);
  if (!constantTimeEqual(expected, sigB64)) return null;
  try {
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "=".repeat((4 - padded.length % 4) % 4));
    const obj = JSON.parse(json);
    if (typeof obj?.exp !== "number" || obj.exp < Date.now()) return null;
    if (obj?.role !== "admin" && obj?.role !== "ro") return null;
    return obj;
  } catch { return null; }
}

/**
 * Pick out the allow-listed tickers from a raw T212 `/equity/portfolio`
 * response and normalize each row into the `{ shares, cost }` shape
 * the client expects. `averagePrice` is taken verbatim — for the
 * VUAA.L / SAEM.L allow-list (LSE-listed USD-denominated UCITS ETFs)
 * T212 reports `averagePrice` in USD, not pence. `cost` is per-share
 * AC (the value the lot editor / computeMetrics multiply by `shares`
 * to get position-level cost).
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
      signal: AbortSignal.timeout(5_000),
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
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      // Loud detection of the two "missing migration" symptoms we've
      // hit before: 42P01 (relation does not exist → 0007 not applied)
      // and 42883 (function does not exist → 0008 not applied). Without
      // this hint the loser-branch silently swallows the cause and the
      // UI shows "T212 just stopped working" with no pointer.
      if (snippet.includes("42P01") || snippet.includes("42883")) {
        console.error(
          `T212 claim RPC ${res.status} — Postgres reports a missing table or function. ` +
          `Re-apply migrations 0007 (trading212_cache) and 0008 (try_claim_t212_refresh) ` +
          `via Supabase SQL Editor. Raw: ${snippet}`,
        );
      } else {
        console.error(`T212 claim RPC ${res.status}: ${snippet}`);
      }
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
    const res = await fetch(`${SB_URL}/rest/v1/trading212_cache`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id: 1, data, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5_000),
    });
    // Check the HTTP status too — previously only thrown errors (network /
    // timeout) hit the catch; a 4xx/5xx PostgREST response was silently
    // dropped. That's the scenario that walks into the T212 ban-storm: if
    // RLS / migration / quota fails the row never lands, every subsequent
    // visitor passes the staleness check, claims the refresh, and calls
    // T212 again — burning through the 1-req-per-30s rate limit.
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      // Loud detection of the missing-migration smell we hit during the T212
      // rollout — surfaces the specific Postgres error code in the function
      // logs so the maintainer can see which migration to re-apply.
      const hint = (snippet.includes("42P01") || snippet.includes("42883"))
        ? " — re-apply migration 0007 (trading212_cache table) and/or 0008 (try_claim_t212_refresh RPC) via Supabase SQL Editor."
        : "";
      console.error(`T212 cache write ${res.status} ${res.statusText}: ${snippet}${hint}`);
    }
  } catch (e) {
    // Cache write failures are non-fatal — next visitor will refetch.
    // Log so a chronic outage doesn't silently mean every refresh hits T212.
    console.error("T212 cache write failed:", e instanceof Error ? e.message : e);
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
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 && T212_API_SECRET) {
    res = await fetch(T212_PORTFOLIO_URL, {
      headers: {
        authorization: basicAuthHeader(T212_API_KEY, T212_API_SECRET),
        accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
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

// Direct insert into public.ops_errors via the service-role key (RLS
// denies anon). Used by the outer try/catch wrap so a runtime crash
// here becomes a row the admin ⚠ badge surfaces instead of a silent
// 500. Best-effort: never throws.
async function reportServerError(
  kind: string,
  opts: { message?: string; symbol?: string; context?: unknown } = {},
): Promise<void> {
  if (!SB_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/ops_errors`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        kind,
        symbol: opts.symbol ?? null,
        message: opts.message ? opts.message.slice(0, 512) : null,
        context: opts.context ?? null,
        ip: "edge",
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (e) {
    console.error("reportServerError failed:", String(e));
  }
}

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    try {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: CORS });
      }
      if (req.method !== "GET") {
        return new Response(JSON.stringify({ error: "method not allowed" }), {
          status: 405, headers: { ...CORS, "content-type": "application/json" },
        });
      }

      // Token gate. Either admin or ro is fine — read-only viewers
      // should see the synced holdings the same as the rest of the
      // portfolio. Anonymous callers get 401 so the holdings aren't
      // world-readable through the function URL.
      const verified = await verifyToken(req.headers.get("x-app-token") ?? "");
      if (!verified) {
        return new Response(JSON.stringify({ error: "invalid token" }), {
          status: 401, headers: { ...CORS, "content-type": "application/json" },
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
    } catch (e) {
      // The outer net — anything not caught by the upstream-error
      // branch above (token verification crash, cache RPC throw,
      // etc.). Same shape as the silent-500 the runtime would return
      // anyway, but now visible in ops_errors.
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
      await reportServerError("trading212.unhandled", { message: msg });
      return new Response(JSON.stringify({ error: "internal" }), {
        status: 500, headers: { ...CORS, "content-type": "application/json" },
      });
    }
  });
}
