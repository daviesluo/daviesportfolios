// Supabase Edge Function: data
// Proxies board_data reads/writes through the Edge runtime so the browser
// never gets the Supabase service-role key and the `board_data` table can
// be locked down to "service role only" via RLS. Every call carries an
// X-App-Token issued by the `auth` function; we re-derive the HMAC with
// APP_AUTH_SECRET and reject any request whose signature is invalid or
// whose `exp` claim has passed.
//
//   GET  /functions/v1/data?action=load            → { data | null }
//   POST /functions/v1/data?action=save  body=portfolio
//   GET  /functions/v1/data?action=price-snapshots&since=<ms>&bucket=<sec>
//                                                  → { rows: [{ts, prices}] }
//        (admin role required; read-only tokens are 403'd here)
//
// REQUIRED secret: APP_AUTH_SECRET (same value as in `auth/index.ts`).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
// runtime and never need to be set manually.

import { reportServerError } from "../_shared/ops.ts";
import { verifyToken } from "../_shared/token.ts";

// Re-exported so this function's index.test.ts (and auth's cross-check
// test, which verifies an auth-issued token against this module) keep
// pinning the exact implementation the gate below trusts.
export { b64url, constantTimeEqual, sign, verifyToken } from "../_shared/token.ts";
export type { Verified } from "../_shared/token.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // `if-match` is included so the browser's CORS preflight doesn't
  // block saves once the client starts attaching the optimistic-
  // concurrency header (per migration 0013). It's not a safelisted
  // request header — without it listed here, every cross-origin POST
  // that carries an `If-Match` fails preflight before this handler
  // even sees the request, and the user's saves silently stop
  // working as soon as `lastKnownVersion` is cached.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token, if-match",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Token verification (b64url / sign / constantTimeEqual / verifyToken)
// lives in ../_shared/token.ts — the canonical copy this function used
// to carry inline. The shared module reads APP_AUTH_SECRET itself.

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const SB_HEADERS = {
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// Direct insert into public.ops_errors via the service-role key (RLS
// denies anon). Used by the top-level try/catch wrap so a runtime
// crash here becomes a row the admin ⚠ badge surfaces instead of a
// silent 500. Best-effort: never throws.
// reportServerError now lives in ../_shared/ops.ts (imported above).

// Guarded so tests can import the helpers above without spinning up
// the server. Supabase's runtime executes index.ts as the entry
// module, so `import.meta.main` is true in production.
//
// Missing-secret check: verifyToken fails closed (every request 401s)
// when APP_AUTH_SECRET is unset, which is the safe direction but a
// silent one — without this log line the only symptom is a wall of
// 401s with nothing in the function logs to say why.
if (import.meta.main && !Deno.env.get("APP_AUTH_SECRET")) {
  console.error(
    "[data] APP_AUTH_SECRET is not set — every request will be rejected " +
    "with 401. Set it in Supabase Dashboard → Edge Functions → Secrets.",
  );
}
if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";

    const token = req.headers.get("x-app-token") ?? "";
    const verified = await verifyToken(token);
    if (!verified) return json(401, { error: "invalid token" });

    if (action === "load" && req.method === "GET") {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/board_data?id=eq.1&select=data,version`,
        { headers: SB_HEADERS, signal: AbortSignal.timeout(5_000) },
      );
      if (!res.ok) return json(res.status, { error: "load failed" });
      const rows = await res.json();
      // Cold project (no row yet) → null data + version 0 so the
      // client's optimistic-concurrency state has a starting point
      // (an If-Match of 0 will succeed on the first save).
      if (!Array.isArray(rows) || rows.length === 0) {
        return json(200, { data: null, version: 0 });
      }
      return json(200, {
        data: rows[0].data,
        version: typeof rows[0].version === "number" ? rows[0].version : 0,
      });
    }

    // Server-recorded 5-minute prices for the performance charts.
    //
    // Goes through the bucketed RPC rather than a raw table read: at
    // 5-minute sampling a YTD window is ~60k rows, and a plain ascending
    // LIMIT returns January and drops everything recent — which is
    // exactly how an earlier version of this read ended up drawing a
    // chart made entirely of the oldest samples it had.
    //
    // Read is allowed for BOTH roles: a read-only viewer sees the same
    // charts. The rows still never leave the token gate, because their
    // keys enumerate the holdings.
    if (action === "price-snapshots" && req.method === "GET") {
      const sinceMs = Number(url.searchParams.get("since"));
      const since = Number.isFinite(sinceMs) && sinceMs > 0
        ? new Date(sinceMs).toISOString()
        // No `since` → the trailing 24 h, the shortest window a chart
        // asks for. Never "everything": that is the 60k-row read.
        : new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const bucketRaw = Number(url.searchParams.get("bucket"));
      // Clamped to [1 min, 1 day]: below a minute the bucket is finer
      // than the sampling rate and buys nothing, above a day it collapses
      // a YTD window into a handful of points.
      const bucket = Number.isFinite(bucketRaw)
        ? Math.min(86_400, Math.max(60, Math.floor(bucketRaw)))
        : 300;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/price_snapshot_series`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ _since: since, _bucket_seconds: bucket }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return json(res.status, { error: "price snapshots failed" });
      const rows = await res.json();
      return json(200, { rows: Array.isArray(rows) ? rows : [] });
    }

    if (action === "save" && req.method === "POST") {
      if (verified.role !== "admin") return json(403, { error: "read-only" });
      // Body size guard — the portfolio JSON is tens of KB even for a
      // large book, so reject anything absurd before parsing: an oversized
      // save bloats the single board_data row that every load then pays to
      // read back. 512 KB is ~10× the largest realistic portfolio. Mirrors
      // the ops-error function's content-length guard.
      const MAX_BODY_BYTES = 512 * 1024;
      const cl = req.headers.get("content-length");
      if (cl && Number(cl) > MAX_BODY_BYTES) return json(413, { error: "payload too large" });
      let body: unknown;
      try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }

      // Optional If-Match header. Treated as the client's
      // last-known version; the save_board_data RPC rejects with
      // 412 if it doesn't match the row's current version (another
      // tab / device saved in between). A missing header skips the
      // check — backward-compatible so old clients still work.
      const ifMatchRaw = req.headers.get("if-match");
      let ifMatch: number | null = null;
      if (ifMatchRaw != null) {
        const parsed = Number(ifMatchRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return json(400, { error: "bad if-match" });
        }
        ifMatch = parsed;
      }

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/save_board_data`,
        {
          method: "POST",
          headers: SB_HEADERS,
          body: JSON.stringify({ _data: body, _if_match: ifMatch }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!res.ok) {
        // 42P01 (table missing) / 42883 (function missing) → migration
        // 0013 not applied. Log loudly so the maintainer sees the
        // missing-migration symptom instead of guessing at intermittent
        // saves silently dropping the optimistic-concurrency guard.
        const snippet = (await res.text().catch(() => "")).slice(0, 200);
        if (snippet.includes("42883") || snippet.includes("42P01")) {
          console.error(
            `save_board_data RPC ${res.status} — re-apply migration 0013 ` +
            `(board_data.version + save_board_data RPC). Raw: ${snippet}`,
          );
        }
        return json(res.status, { error: "save failed" });
      }
      const result = await res.json();
      if (result?.ok === false && result?.conflict === true) {
        return json(412, {
          error: "conflict",
          currentVersion: result.current_version,
        });
      }
      return json(200, { ok: true, version: result?.version });
    }

    return json(400, { error: "unknown action" });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    await reportServerError("data.unhandled", { message: msg });
    return json(500, { error: "internal" });
  }
});
