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

const SECRET       = Deno.env.get("APP_AUTH_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  let s = btoa(String.fromCharCode(...buf));
  return s.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

export type Verified = { role: "admin" | "ro"; exp: number };

// Constant-time string equality. JS `!==` short-circuits on first
// byte mismatch, which leaks a timing side-channel an attacker can
// use to forge tokens byte-by-byte. Walking the full length and
// OR-ing the per-char xor keeps the comparison time independent of
// where (if anywhere) the mismatch is. Length mismatch short-circuits
// only the LENGTH check — not the per-byte content — which is the
// information we're already willing to leak (a 43-byte vs 44-byte
// signature isn't a useful guess for the attacker).
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyToken(token: string, secret = SECRET): Promise<Verified | null> {
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
    return obj as Verified;
  } catch { return null; }
}

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
