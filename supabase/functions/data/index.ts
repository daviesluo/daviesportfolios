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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
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

export async function verifyToken(token: string, secret = SECRET): Promise<Verified | null> {
  if (!secret) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;
  const expected = await sign(payloadB64, secret);
  if (expected !== sigB64) return null;
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

// Guarded so tests can import the helpers above without spinning up
// the server. Supabase's runtime executes index.ts as the entry
// module, so `import.meta.main` is true in production.
if (import.meta.main) Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "";

  const token = req.headers.get("x-app-token") ?? "";
  const verified = await verifyToken(token);
  if (!verified) return json(401, { error: "invalid token" });

  if (action === "load" && req.method === "GET") {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/board_data?id=eq.1&select=data`,
      { headers: SB_HEADERS, signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return json(res.status, { error: "load failed" });
    const rows = await res.json();
    const data = Array.isArray(rows) && rows.length > 0 ? rows[0].data : null;
    return json(200, { data });
  }

  if (action === "save" && req.method === "POST") {
    if (verified.role !== "admin") return json(403, { error: "read-only" });
    let body: unknown;
    try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/board_data`,
      {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: 1, data: body }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) return json(res.status, { error: "save failed" });
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown action" });
});
