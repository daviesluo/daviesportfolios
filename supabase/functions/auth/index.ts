// Supabase Edge Function: auth
// Server-side password check. Replaces the client-side `if (pw === "7119")`
// so the actual password never ships in the browser bundle. On success
// returns a short-lived signed token that the `data` Edge Function trusts.
//
// POST /functions/v1/auth   body: { password: string }
//   200 OK  { token, role: "admin" | "ro" }
//   401 Unauthorized
//
// The token is HMAC-SHA256 over the payload with APP_AUTH_SECRET; format is
// `<base64url(payload)>.<base64url(sig)>`. `data/index.ts` re-derives the
// same HMAC and rejects anything where it doesn't match or where exp has
// passed. Lifetime is 24 h.
//
// REQUIRED secrets (set via Supabase Dashboard → Edge Functions → Secrets):
//   APP_ADMIN_PWD     — e.g. "7119"
//   APP_RO_PWD        — e.g. "8848"
//   APP_AUTH_SECRET   — long random string used to sign tokens

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const ADMIN_PWD = Deno.env.get("APP_ADMIN_PWD") ?? "";
const RO_PWD    = Deno.env.get("APP_RO_PWD") ?? "";
const SECRET    = Deno.env.get("APP_AUTH_SECRET") ?? "";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  let s = btoa(String.fromCharCode(...buf));
  return s.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sign(payload: string, secret: string): Promise<string> {
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

async function makeToken(role: "admin" | "ro"): Promise<string> {
  const payload = b64url(JSON.stringify({ role, exp: Date.now() + TOKEN_TTL_MS }));
  const signature = await sign(payload, SECRET);
  return `${payload}.${signature}`;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json(405, { error: "method not allowed" });

  if (!SECRET || !ADMIN_PWD || !RO_PWD) {
    // Refuse to issue tokens until the function has been provisioned.
    return json(500, { error: "auth not configured" });
  }

  let body: { password?: string };
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const pw = (body?.password ?? "").toString();

  let role: "admin" | "ro" | null = null;
  if (pw === ADMIN_PWD) role = "admin";
  else if (pw === RO_PWD) role = "ro";
  if (!role) return json(401, { error: "invalid" });

  const token = await makeToken(role);
  return json(200, { token, role });
});
