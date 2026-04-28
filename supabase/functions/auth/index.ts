// Supabase Edge Function: auth
// Server-side password check + IP-rate-limited lockout. Replaces the
// client-side password compare so the actual passwords never ship in the
// browser bundle. On success returns a short-lived signed token that the
// `data` Edge Function trusts.
//
// POST /functions/v1/auth   body: { password: string }
//   200 OK  { token, role: "admin" | "ro" }
//   401 Unauthorized
//   429 Too Many Requests   { lockoutUntil: number }
//
// Lockout state lives in `public.auth_attempts` (ip primary key, attempts
// counter, lockout_until unix ms). Anon role has NO access — we only read
// and write via the auto-injected SUPABASE_SERVICE_ROLE_KEY. Three wrong
// passwords from the same IP triggers a 24h lockout.
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
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_TTL_MS  = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS  = 3;
const LOCKOUT_MS    = 24 * 60 * 60 * 1000;

const ADMIN_PWD    = Deno.env.get("APP_ADMIN_PWD") ?? "";
const RO_PWD       = Deno.env.get("APP_RO_PWD") ?? "";
const SECRET       = Deno.env.get("APP_AUTH_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

// ---------------- IP-keyed lockout state ----------------
const SB_HEADERS = {
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

function clientIp(req: Request): string {
  // Cloudflare → cf-connecting-ip; Supabase Edge → x-forwarded-for.
  // First IP in x-forwarded-for is the original client. Fall back to a
  // sentinel so a missing header still keys per-deploy rather than
  // bypassing the limiter entirely.
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

type AttemptRow = { ip: string; attempts: number; lockout_until: number | null };

async function loadAttempts(ip: string): Promise<AttemptRow | null> {
  const url = `${SUPABASE_URL}/rest/v1/auth_attempts?ip=eq.${encodeURIComponent(ip)}&select=ip,attempts,lockout_until`;
  const res = await fetch(url, { headers: SB_HEADERS });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function saveAttempts(row: AttemptRow): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/auth_attempts`, {
    method: "POST",
    headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

async function clearAttempts(ip: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/auth_attempts?ip=eq.${encodeURIComponent(ip)}`, {
    method: "DELETE",
    headers: SB_HEADERS,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json(405, { error: "method not allowed" });

  if (!SECRET || !ADMIN_PWD || !RO_PWD) {
    return json(500, { error: "auth not configured" });
  }

  const ip = clientIp(req);
  const existing = await loadAttempts(ip);

  // Locked out → bail before even hashing the password.
  if (existing?.lockout_until && existing.lockout_until > Date.now()) {
    return json(429, { error: "locked", lockoutUntil: existing.lockout_until });
  }

  let body: { password?: string };
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const pw = (body?.password ?? "").toString();

  let role: "admin" | "ro" | null = null;
  if (pw === ADMIN_PWD) role = "admin";
  else if (pw === RO_PWD) role = "ro";

  if (role) {
    // Successful login — wipe any failed-attempt counter for this IP.
    if (existing) clearAttempts(ip).catch(() => {});
    const token = await makeToken(role);
    return json(200, { token, role });
  }

  // Wrong password — bump attempts, lock if at threshold.
  const attempts = (existing?.attempts ?? 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const lockoutUntil = Date.now() + LOCKOUT_MS;
    await saveAttempts({ ip, attempts: 0, lockout_until: lockoutUntil });
    return json(429, { error: "locked", lockoutUntil });
  }
  await saveAttempts({ ip, attempts, lockout_until: null });
  return json(401, { error: "invalid", attempts, attemptsLeft: MAX_ATTEMPTS - attempts });
});
