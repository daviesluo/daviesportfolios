// Supabase Edge Function: ops-error
//
// Lightweight observability sink with two modes:
//
//   POST /functions/v1/ops-error  (no auth)
//     body: { kind, symbol?, message?, context? }
//     Inserts one row into public.ops_errors via the service-role key.
//     Anon access to the table is RLS-denied so only this function can
//     write. Anti-spam: reject payloads larger than 4 KB and clip
//     fields to length caps before insert. Logged-out browsers can
//     report freely so we capture render crashes that fire before
//     auth completes.
//
//   GET /functions/v1/ops-error?action=summary&hours=24
//     Header: x-app-token: <admin token>
//     Returns:
//       {
//         hours, total,
//         byKind:  [{kind, count, latestMessage}, …],
//         bySymbol:[{symbol, kind, count, latestMessage, latestAt}, …]
//       }
//     Token gate: must be a valid HMAC-signed app token AND role=admin
//     (same `${b64url(payload)}.${b64url(sig)}` format `auth` issues).
//     Lets a logged-in admin (or a Claude Code session with the token
//     in hand) triage the last N hours' failures without touching
//     Supabase dashboard.

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "https://flmvxigozjuizpckllvk.supabase.co";
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

// HMAC-SHA256 helper, mirrored from the `auth` function so we can
// re-derive a token's signature without sharing code across functions
// (Supabase Edge Functions don't have a shared-module mechanism).
async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  // base64url-encode the signature (no padding, +/- vs /+)
  let b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Verify an HMAC-signed app token and return the payload's role on
// success. Mirrors the `data` Edge Function's gate. Returns null for
// any failure (bad shape, bad signature, expired, unknown role).
async function verifyAdminToken(token: string | null): Promise<"admin" | "ro" | null> {
  if (!token || !APP_AUTH_SECRET) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig        = token.slice(dot + 1);
  const expected   = await hmacSign(payloadB64, APP_AUTH_SECRET);
  if (sig !== expected) return null;
  try {
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "=".repeat((4 - padded.length % 4) % 4));
    const payload = JSON.parse(json);
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (payload.role === "admin" || payload.role === "ro") return payload.role;
    return null;
  } catch { return null; }
}

function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = String(s);
  return t.length <= max ? t : t.slice(0, max);
}

Deno.serve(async (req: Request) => {
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

      return new Response(
        JSON.stringify({ hours, total: rows.length, byKind, bySymbol }),
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

  const ip =
    (req.headers.get("x-forwarded-for") ?? "")
      .split(",")[0]
      .trim() || "unknown";

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
