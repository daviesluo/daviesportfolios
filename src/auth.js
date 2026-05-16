// Auth gate — collects the password, talks to the auth Edge Function,
// stashes the resulting HMAC-signed token in sessionStorage, and exposes
// helpers the rest of the app uses to read/decode/clear it.
//
// Two-stage flow:
//   1. collectPassword() (sync) reads ?pwd= or pops window.prompt
//   2. authenticate(pw) (async) POSTs to /functions/v1/auth, which
//      validates server-side and returns { token, role } on success.
//      Token format: `<base64url(payload)>.<base64url(sig)>` where
//      payload is `{ role: "admin" | "ro", exp: <ms> }`.
//
// `?pwd=7119` / typing 7119 → admin (full edit)
// `?pwd=8848` / typing 8848 → read-only (shareable view)
//
// Server-side IP-keyed lockout (3 wrong → 24 h) is handled inside the
// Edge Function — the client just relays its 401 / 429 verdicts.
import { SB_ANON, EDGE_AUTH_URL } from './supabase_config.js';
import { reportError } from './ops_error.js';

const APP_TOKEN_KEY = "dp.token"; // sessionStorage — wiped on tab close

export function getAppToken() {
  return sessionStorage.getItem(APP_TOKEN_KEY) || "";
}
export function setAppToken(t) {
  if (t) sessionStorage.setItem(APP_TOKEN_KEY, t);
  else   sessionStorage.removeItem(APP_TOKEN_KEY);
}

// Synchronous: collect the password and clean up the URL bar. Returns the
// raw string the user supplied, or null if they cancelled the prompt.
export function collectPassword() {
  const params = new URLSearchParams(window.location.search);
  const urlPwd = params.get("pwd");
  if (urlPwd != null) {
    params.delete("pwd");
    const newSearch = params.toString();
    history.replaceState(null, "",
      window.location.pathname + (newSearch ? "?" + newSearch : "") + window.location.hash);
    return urlPwd;
  }
  const typed = window.prompt("Enter password:");
  return typed; // may be null if user cancels
}

// Decode the HMAC-signed token's payload WITHOUT verifying the signature
// — verification still happens server-side on every data call. We only
// need the role + exp to decide whether to reuse a sessionStorage token
// across reloads (so a SW update / browser refresh doesn't re-prompt).
/** @returns {{role: 'admin'|'ro', exp: number} | null} */
export function decodeAppToken(token) {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (payload.role !== "admin" && payload.role !== "ro") return null;
    return payload;
  } catch { return null; }
}

// Async: hit the auth Edge Function. Resolves to:
//   { isReadOnly }                — successful login, token already stored
//   { locked: true, lockUntil }   — too many failed attempts
//   null                          — wrong password / network failure / cancelled prompt
export async function authenticate(pw) {
  if (pw == null || pw === "") return null;

  try {
    const res = await fetch(EDGE_AUTH_URL, {
      method: "POST",
      headers: {
        "apikey": SB_ANON,
        "Authorization": `Bearer ${SB_ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: pw }),
      // Auth has the 500ms wrong-password throttle baked in, plus a
      // 5s PostgREST timeout per Edge call. 10s here covers both
      // plus cold-start latency so the UI doesn't spin forever if
      // the Edge call hangs.
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const { token, role } = await res.json();
      if (token && role) {
        setAppToken(token);
        return { isReadOnly: role === "ro" };
      }
    }

    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const lockUntil = Number(body?.lockoutUntil) || (Date.now() + 24 * 60 * 60 * 1000);
      return { locked: true, lockUntil };
    }

    if (res.status === 401) return null;

    // 5xx, network blip — treat as transient, don't pretend to lock out.
    // reportError surfaces it in the badge / ops_errors; no console
    // noise needed alongside (DevTools is the wrong channel for this).
    reportError('auth.unexpected', { context: { status: res.status } });
    return null;
  } catch (e) {
    reportError('auth.network', { message: String(e?.message || e) });
    return null;
  }
}
