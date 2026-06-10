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

import { reportServerError } from "../_shared/ops.ts";
import { b64url, sign } from "../_shared/token.ts";
import { clientIpFromHeaders } from "../_shared/ip.ts";

// Re-exported so this function's index.test.ts keeps pinning the exact
// implementations the token issue path uses (and so older imports of
// these helpers from auth keep working).
export { b64url, sign, clientIpFromHeaders };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN_TTL_MS  = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS  = 3;
const LOCKOUT_MS    = 24 * 60 * 60 * 1000;
export const WRONG_PASSWORD_DELAY_MS = 500;

const ADMIN_PWD    = Deno.env.get("APP_ADMIN_PWD") ?? "";
const RO_PWD       = Deno.env.get("APP_RO_PWD") ?? "";
const SECRET       = Deno.env.get("APP_AUTH_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// b64url / sign live in ../_shared/token.ts (imported + re-exported
// above) — the same module the verifying functions (data / trading212 /
// ops-error) now use, so issue and verify can't drift apart.

export async function makeToken(role: "admin" | "ro", secret = SECRET, ttlMs = TOKEN_TTL_MS): Promise<string> {
  const payload = b64url(JSON.stringify({ role, exp: Date.now() + ttlMs }));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

// clientIpFromHeaders lives in ../_shared/ip.ts (imported +
// re-exported above) so ops-error's error rows and this function's
// lockout key share one trust order — see that module for the full
// x-real-ip / last-XFF-entry / sentinel rationale.

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

// Per-IP key derivation. See `clientIpFromHeaders` above for the full
// rationale: prefer the gateway-trusted `x-real-ip`, then the LAST
// entry of `x-forwarded-for` (proxies append as they forward, so the
// last hop is the most-trusted; the FIRST entry is the client-supplied
// value an attacker can rotate to defeat the per-IP lockout), then a
// sentinel so a missing header still keys per-deploy rather than
// bypassing the limiter entirely. Aliased here (and exported above)
// for unit testing.
const clientIp = clientIpFromHeaders;

type LockoutCheck = { lockout_until: number | null };

// Cheap read-only check — used as a fast-path before validating the password.
// A stale value here is harmless: if the row was just locked by another
// request the bump RPC below will catch it; if the row was just unlocked
// we'll just hash an extra password.
async function getLockout(ip: string): Promise<number | null> {
  const url = `${SUPABASE_URL}/rest/v1/auth_attempts?ip=eq.${encodeURIComponent(ip)}&select=lockout_until`;
  const res = await fetch(url, { headers: SB_HEADERS, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return null;
  const rows = (await res.json()) as LockoutCheck[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0].lockout_until ?? null;
}

// Atomic increment-or-lockout via the bump_auth_attempt SQL function. Doing
// the read-modify-write in a single statement avoids the TOCTOU race that
// Codex flagged: if two wrong-password requests for the same IP land at the
// same time they each see the OTHER's increment, so the threshold can't
// be undercounted by parallel traffic.
type BumpResult = { attempts_out: number; lockout_until_out: number | null; locked_out: boolean };
async function bumpAttempt(ip: string, max: number, lockoutMs: number): Promise<BumpResult | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_auth_attempt`, {
    method: "POST",
    headers: SB_HEADERS,
    body: JSON.stringify({ _ip: ip, _max: max, _lockout_ms: lockoutMs }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as BumpResult[];
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function clearAttempts(ip: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/auth_attempts?ip=eq.${encodeURIComponent(ip)}`, {
    method: "DELETE",
    headers: SB_HEADERS,
    signal: AbortSignal.timeout(5_000),
  });
}

// Direct insert into public.ops_errors via the service-role key (RLS
// denies anon; service key bypasses). Used by the top-level try/catch
// wrap below so a runtime crash in this Edge Function becomes a row
// the admin ⚠ badge surfaces, instead of a silent 500 the user only
// notices when the page UX visibly breaks. 3 s timeout + swallowed
// failure: observability must never make a real error worse.
// reportServerError now lives in ../_shared/ops.ts (imported above).

// Guarded so tests can import the helpers above without spinning up
// the server. Supabase's runtime executes index.ts as the entry
// module, so `import.meta.main` is true in production.
if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST")    return json(405, { error: "method not allowed" });

    if (!SECRET || !ADMIN_PWD || !RO_PWD) {
      return json(500, { error: "auth not configured" });
    }

    const ip = clientIp(req);

    // Fast-path lockout check — saves a round-trip to the RPC if the caller
    // is already locked out. Stale reads are fine; bump_auth_attempt below
    // is the authoritative writer.
    const lockedUntil = await getLockout(ip);
    if (lockedUntil && lockedUntil > Date.now()) {
      return json(429, { error: "locked", lockoutUntil: lockedUntil });
    }

    let body: { password?: string };
    try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
    const pw = (body?.password ?? "").toString();

    let role: "admin" | "ro" | null = null;
    if (pw === ADMIN_PWD) role = "admin";
    else if (pw === RO_PWD) role = "ro";

    if (role) {
      // Successful login — wipe any failed-attempt counter for this IP.
      clearAttempts(ip).catch(() => {});
      const token = await makeToken(role);
      return json(200, { token, role });
    }

    // Wrong password → atomic increment via SQL function. The function
    // handles the threshold check in a single statement so concurrent
    // wrong-password requests can't race-read the same counter.
    //
    // Also pause ~500 ms before responding: with a 4-digit numeric
    // password (10⁴ keyspace) and IP-rotation defeating the per-IP
    // lockout, the throughput of a brute-force run is what slows the
    // attacker. 500 ms × 10000 = ~83 min minimum offline-ish; a real
    // user typing a wrong password notices nothing. Pin chosen at
    // 500ms by `WRONG_PASSWORD_DELAY_MS` so the test suite can assert
    // it stays on (regressions that drop the delay to 0 would silently
    // restore the brute-force window).
    await new Promise((r) => setTimeout(r, WRONG_PASSWORD_DELAY_MS));
    const result = await bumpAttempt(ip, MAX_ATTEMPTS, LOCKOUT_MS);
    if (result?.locked_out) {
      return json(429, { error: "locked", lockoutUntil: result.lockout_until_out ?? Date.now() + LOCKOUT_MS });
    }
    const attempts = result?.attempts_out ?? 0;
    return json(401, { error: "invalid", attempts, attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) });
  } catch (e) {
    // Unhandled exception — turn it into an ops_errors row so it's
    // visible in the admin badge, then return a generic 500.
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    await reportServerError("auth.unhandled", { message: msg });
    return json(500, { error: "internal" });
  }
});
