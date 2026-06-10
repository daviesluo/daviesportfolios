// Supabase Edge Function: ops-error
//
// Lightweight observability sink with two modes:
//
//   POST /functions/v1/ops-error
//     Header: x-app-token: <admin token>
//     body:   { kind, symbol?, message?, context? }
//     Inserts one row into public.ops_errors via the service-role key.
//     Anon access to the table is RLS-denied so only this function can
//     write. Token gate (added 2026-05): the previous "no auth" mode
//     let anyone with the Supabase URL spam the table — per-(kind,
//     symbol) cooldown + per-load cap on the client could be trivially
//     bypassed with random kinds. Now requires the same HMAC-signed
//     admin token the summary endpoint already uses. Anti-spam:
//     reject payloads larger than 4 KB and clip fields to length caps
//     before insert. Render crashes that fire BEFORE auth completes
//     (token not yet set) are no longer captured — the
//     observability tradeoff the user accepted on PR #106.
//
//   GET /functions/v1/ops-error?action=summary&hours=24
//     Header: x-app-token: <admin token>
//     Returns:
//       {
//         hours, total, latestAt,
//         byKind:  [{kind, count, latestMessage}, …],
//         bySymbol:[{symbol, kind, count, latestMessage, latestAt}, …]
//       }
//       `latestAt` is the newest error's timestamp across ALL rows —
//       computed before bySymbol is sliced to the top 100, so the
//       client's "acknowledge" gate can't miss a newer one-off error.
//     Token gate: must be a valid HMAC-signed app token AND role=admin
//     (same `${b64url(payload)}.${b64url(sig)}` format `auth` issues).
//     Lets a logged-in admin (or a Claude Code session with the token
//     in hand) triage the last N hours' failures without touching
//     Supabase dashboard.

import { constantTimeEqual, verifyToken } from "../_shared/token.ts";
import { clientIpFromHeaders } from "../_shared/ip.ts";

// Re-exported so this function's index.test.ts keeps pinning the exact
// equality the token gate relies on.
export { constantTimeEqual };

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_AUTH_SECRET = Deno.env.get("APP_AUTH_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};

const MAX_BODY_BYTES = 4_096;
const MAX_KIND       = 64;
const MAX_SYMBOL     = 32;
const MAX_MESSAGE    = 512;
const MAX_CONTEXT    = 2_048; // serialized

// Verify an HMAC-signed app token and return the payload's role on
// success; null for any failure (bad shape, bad signature, expired,
// unknown role). Thin wrapper over ../_shared/token.ts's verifyToken —
// the canonical copy this function used to mirror inline (and the
// inline copy had already drifted: it parsed the payload/sig boundary
// with indexOf while every other function used split).
export async function verifyAdminToken(token: string | null, secret = APP_AUTH_SECRET): Promise<"admin" | "ro" | null> {
  if (!token) return null;
  return (await verifyToken(token, secret))?.role ?? null;
}

export function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = String(s);
  return t.length <= max ? t : t.slice(0, max);
}

// Guarded so tests can import the helpers above without spinning up
// the server. Supabase's runtime executes index.ts as the entry
// module, so `import.meta.main` is true in production.
//
// Missing-secret check: verifyAdminToken fails closed (every request
// 401s) when APP_AUTH_SECRET is unset — safe, but silent. Log loudly
// so the wall of 401s is explainable from the function logs.
if (import.meta.main && !APP_AUTH_SECRET) {
  console.error(
    "[ops-error] APP_AUTH_SECRET is not set — every request will be " +
    "rejected with 401. Set it in Supabase Dashboard → Edge Functions → Secrets.",
  );
}
if (import.meta.main) Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // GET ?action=summary — admin-token-gated read endpoint that
  // returns aggregated stats over the last N hours so a Claude Code
  // session can triage failures without prying open Supabase's
  // dashboard.
  const reqUrl = new URL(req.url);
  if (req.method === "GET" && reqUrl.searchParams.get("action") === "summary") {
    const role = await verifyAdminToken(req.headers.get("x-app-token"));
    if (role !== "admin") {
      return new Response(JSON.stringify({ error: "admin token required" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    // hours param: 1..168 (1 week max), default 24.
    const hoursRaw = parseInt(reqUrl.searchParams.get("hours") ?? "24", 10);
    const hours = Number.isFinite(hoursRaw) ? Math.min(168, Math.max(1, hoursRaw)) : 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
      // Pull the rows with PostgREST. RLS is denied for anon, but the
      // service-role key bypasses it.
      const url = `${SB_URL}/rest/v1/ops_errors?created_at=gte.${encodeURIComponent(since)}` +
        `&select=kind,symbol,message,created_at&order=created_at.desc&limit=2000`;
      const res = await fetch(url, {
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("[ops-error/summary] read failed:", res.status, text);
        return new Response(JSON.stringify({ error: "read failed" }), {
          status: 500, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      /** @type {Array<{kind:string,symbol:string|null,message:string|null,created_at:string}>} */
      const rows: Array<{ kind: string; symbol: string | null; message: string | null; created_at: string }> = await res.json();

      // Aggregate two ways: by kind (rolled up across symbols) and by
      // (symbol, kind) for the per-ticker triage view.
      const byKindMap   = new Map<string, { kind: string; count: number; latestMessage: string | null }>();
      const bySymbolMap = new Map<string, { symbol: string | null; kind: string; count: number; latestMessage: string | null; latestAt: string }>();

      for (const r of rows) {
        const k = r.kind;
        const symKey = `${r.symbol ?? ""}|${k}`;
        const bk = byKindMap.get(k);
        if (bk) bk.count++;
        else byKindMap.set(k, { kind: k, count: 1, latestMessage: r.message });
        const bs = bySymbolMap.get(symKey);
        if (bs) bs.count++;
        else bySymbolMap.set(symKey, {
          symbol: r.symbol, kind: k, count: 1,
          latestMessage: r.message, latestAt: r.created_at,
        });
      }

      const byKind   = [...byKindMap.values()].sort((a, b) => b.count - a.count);
      const bySymbol = [...bySymbolMap.values()].sort((a, b) => b.count - a.count).slice(0, 100);
      // Newest error timestamp across ALL rows. `rows` is ordered
      // created_at.desc (see the query above) so rows[0] is the most
      // recent. Exposed at the summary level rather than derived
      // client-side from bySymbol, because bySymbol is sliced to the
      // top-100-by-count — a newer one-off error can fall outside it,
      // and the client's Acknowledge gate keys off this timestamp so
      // it must reflect every row.
      const latestAt = rows.length > 0 ? rows[0].created_at : null;

      return new Response(
        JSON.stringify({ hours, total: rows.length, latestAt, byKind, bySymbol }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    } catch (e) {
      console.error("[ops-error/summary] threw:", String(e));
      return new Response(JSON.stringify({ error: "summary error" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Admin token gate. Reject anything that isn't a valid signed admin
  // token before we even look at the body — keeps the spam surface
  // tight without needing IP rate-limiting infrastructure.
  const postRole = await verifyAdminToken(req.headers.get("x-app-token"));
  if (postRole !== "admin") {
    return new Response(JSON.stringify({ error: "admin token required" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Body size guard — also avoids blocking if a misconfigured client streams forever.
  const cl = req.headers.get("content-length");
  if (cl && Number(cl) > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "payload too large" }), {
      status: 413, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const kind = clip(body?.kind, MAX_KIND);
  if (!kind) {
    return new Response(JSON.stringify({ error: "kind required" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Shared extraction (x-real-ip, then LAST x-forwarded-for entry) —
  // the previous inline parse took the FIRST entry, which is the
  // client-supplied value and trivially spoofable. Only a log field
  // here (the POST is already admin-token-gated), but a forged IP in
  // an error row misleads triage, and auth/index.ts documents why
  // first-entry parsing is wrong.
  const ip = clientIpFromHeaders(req);

  let context: unknown = body?.context ?? null;
  if (context != null) {
    try {
      const s = JSON.stringify(context);
      if (s.length > MAX_CONTEXT) context = { _truncated: true };
    } catch { context = { _unserializable: true }; }
  }

  const row = {
    kind,
    symbol:  clip(body?.symbol, MAX_SYMBOL),
    message: clip(body?.message, MAX_MESSAGE),
    context,
    ip:      clip(ip, 64),
  };

  try {
    const res = await fetch(`${SB_URL}/rest/v1/ops_errors`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[ops-error] insert failed:", res.status, text);
      return new Response(JSON.stringify({ error: "insert failed" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("[ops-error] insert threw:", String(e));
    return new Response(JSON.stringify({ error: "insert error" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 202, headers: { ...CORS, "Content-Type": "application/json" },
  });
});
