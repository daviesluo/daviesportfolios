// Shared HMAC app-token verification for the Edge Functions: the one copy.
//
// Every function that checks the app token imports `verifyToken` from here
// (`data`, `trading212`, `ops-error`, `prices`, `chart`, `fundamentals`,
// `agents`, `overnight-fetch`), `auth` and `snapshot-record` sign with
// `sign`/`b64url`, and the cron-bearer checks use `constantTimeEqual`. The
// inline copies `data`, `trading212` and `ops-error` once carried, which
// had drifted apart, are gone; don't add another.
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

// Constant-time string equality: a secret compared byte by byte with an
// early exit tells a caller, by how long the answer takes, how much of a
// guess was right. A length mismatch short-circuits only the length check
// (already-leaked information), not the per-byte content.
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
