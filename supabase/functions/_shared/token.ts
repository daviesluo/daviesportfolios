// Shared HMAC app-token verification for the Edge Functions.
//
// This is the canonical copy of the token-verify helpers that `data`,
// `trading212`, and `ops-error` each carry inline today (and which have
// already drifted — ops-error parses the dot with indexOf, the others
// with split). New consumers (e.g. `overnight-fetch`) import from here so
// they don't add a fourth copy. Migrating the three existing critical
// functions onto this module is a deliberate, separate follow-up — their
// inline verify is on the load/save hot path and shouldn't be swapped
// blind, so this PR only introduces the shared module + a new consumer.
//
// Token format (issued by the `auth` function): `<b64url(payload)>.<b64url(sig)>`
// where payload is `{ role: "admin" | "ro", exp: <ms> }`, signed
// HMAC-SHA256 with APP_AUTH_SECRET.

const SECRET = Deno.env.get("APP_AUTH_SECRET") ?? "";
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  const s = btoa(String.fromCharCode(...buf));
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

// Constant-time string equality — see the data function's copy for the
// timing-side-channel rationale. Length mismatch short-circuits only the
// length check (already-leaked information), not the per-byte content.
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
  } catch {
    return null;
  }
}
