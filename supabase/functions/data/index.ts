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

    // ---- Investment Performance time series -------------------------
    // Both numbers are derivable from the ledger, and the chart still
    // derives everything from before the first stored row. Recording
    // them anyway is about the tickers you no longer hold: a sold-out
    // position leaves the board and the app stops fetching its price
    // history, so a truthful past value would otherwise mean re-fetching
    // history for every symbol ever owned.

    if (action === "snapshots" && req.method === "GET") {
      // Trailing window only — the chart never wants the whole table.
      const sinceRaw = url.searchParams.get("since") ?? "";
      const sinceMs = Number(sinceRaw);
      if (!Number.isFinite(sinceMs) || sinceMs <= 0) {
        return json(400, { error: "bad since" });
      }
      const sinceIso = new Date(sinceMs).toISOString();
      // Cap the row count so a very old `since` can't stream a year of
      // 5-minute samples into a phone. 5000 rows ≈ 17 days at full
      // density, and the daily ranges downsample anyway.
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/portfolio_snapshots` +
        `?ts=gte.${encodeURIComponent(sinceIso)}` +
        `&select=ts,value_usd,deposit_usd&order=ts.asc&limit=5000`,
        { headers: SB_HEADERS, signal: AbortSignal.timeout(5_000) },
      );
      if (!res.ok) return json(res.status, { error: "snapshots load failed" });
      const rows = await res.json();
      return json(200, { snapshots: Array.isArray(rows) ? rows : [] });
    }

    if (action === "snapshot" && req.method === "POST") {
      // Read-only viewers watch the same book; they must not write to it.
      if (verified.role !== "admin") return json(403, { error: "read-only" });
      let body: any;
      try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
      const tsMs = Number(body?.ts);
      const value = Number(body?.valueUsd);
      const deposit = Number(body?.depositUsd);
      if (!Number.isFinite(tsMs) || tsMs <= 0) return json(400, { error: "bad ts" });
      if (!Number.isFinite(value) || !Number.isFinite(deposit)) {
        return json(400, { error: "bad numbers" });
      }
      // `ts` is the client's 5-minute bucket and the table's primary
      // key, so merge-duplicates makes this idempotent: two devices
      // sampling in the same bucket overwrite one row instead of
      // stacking two near-identical points, and a retry can't double
      // insert.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/portfolio_snapshots`, {
        method: "POST",
        headers: {
          ...SB_HEADERS,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          ts: new Date(tsMs).toISOString(),
          value_usd: value,
          deposit_usd: deposit,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return json(res.status, { error: "snapshot save failed" });
      return json(200, { ok: true });
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
