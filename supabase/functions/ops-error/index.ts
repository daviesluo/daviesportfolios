// Supabase Edge Function: ops-error
// Lightweight observability sink. The browser calls this with a JSON
// payload describing a client-side failure (fetch flake, auth issue,
// render crash). Inserts one row into public.ops_errors using the
// service-role key. Anon access to the table is RLS-denied so only this
// function can write.
//
// Anti-spam: reject payloads larger than 4 KB; cap fields with hard
// length limits before insert. No auth required — we want failures
// from logged-out browsers reportable too.
//
// Call: POST /functions/v1/ops-error
//   body: { kind: string, symbol?: string, message?: string, context?: object }

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "https://flmvxigozjuizpckllvk.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY_BYTES = 4_096;
const MAX_KIND       = 64;
const MAX_SYMBOL     = 32;
const MAX_MESSAGE    = 512;
const MAX_CONTEXT    = 2_048; // serialized

function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = String(s);
  return t.length <= max ? t : t.slice(0, max);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
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
