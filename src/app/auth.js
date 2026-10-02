// Auth gate — collects the password, talks to the auth Edge Function,
// stashes the resulting HMAC-signed token in sessionStorage, and exposes
// helpers the rest of the app uses to read/decode/clear it.
//
// Two-stage flow:
//   1. consumeUrlPassword() (sync) reads ?pwd= from the URL (or null);
//      no URL pwd → App renders the themed <PasswordPrompt> form
//   2. authenticate(pw) (async) POSTs to /functions/v1/auth, which
//      validates server-side and returns { token, role } on success.
//      Token format: `<base64url(payload)>.<base64url(sig)>` where
//      payload is `{ role: "admin" | "ro", exp: <ms> }`.
//
// Two roles, two secrets — both validated server-side in the `auth`
// Edge Function (see `APP_ADMIN_PWD` / `APP_RO_PWD` env vars there); the
// actual values intentionally don't appear in this client bundle:
//   `?pwd=<admin-secret>`     / typing it → admin (full edit)
//   `?pwd=<read-only-secret>` / typing it → read-only (shareable view)
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

// Signing out (Davies, 2026-09-27: a signed-out page goes back to the login
// form, never an error inside the page). The token lapses 24 h after it was
// issued (the `auth` function's TOKEN_TTL_MS) and dies with the tab. App
// returns to the form the moment it lapses, and any call that answers 401 to
// a token this browser still holds signs it out the same way.
/** @type {Set<() => void>} */
const signOutListeners = new Set();

/** Forget the token and tell the app, which shows the password form. The next 401 finds no token and does nothing. */
export function signOut() {
  setAppToken("");
  for (const fn of [...signOutListeners]) {
    try { fn(); } catch { /* one listener failing keeps no one signed in */ }
  }
}

/** Run `fn` when this browser signs out; returns the unsubscribe. @param {() => void} fn */
export function onSignOut(fn) {
  signOutListeners.add(fn);
  return () => { signOutListeners.delete(fn); };
}

/** A reply to a call made with the app token: 401 means the token is no longer good. @param {number} status */
export function noteAuthStatus(status) {
  if (status === 401 && getAppToken()) signOut();
}

// Synchronous: pull the `?pwd=` out of the URL and strip it from history
// (so it never lingers in the browser bar / back-stack), returning the raw
// password or null when absent. The old collectPassword() also popped a
// raw `window.prompt` when there was no URL pwd — that's gone; App now
// renders a themed in-page password form instead (the native prompt over a
// blank page was jarring, unstyled, and especially clunky in the iOS PWA).
export function consumeUrlPassword() {
  const params = new URLSearchParams(window.location.search);
  const urlPwd = params.get("pwd");
  if (urlPwd == null) return null;
  params.delete("pwd");
  const newSearch = params.toString();
  history.replaceState(null, "",
    window.location.pathname + (newSearch ? "?" + newSearch : "") + window.location.hash);
  return urlPwd;
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
//   { unavailable: true, status } — the server never judged the password: a 5xx, a
//                                   timeout or no network (status 0). Shown as such,
//                                   never as a wrong password (2026-10-02: the database
//                                   stalled for two hours and every right password read
//                                   "Incorrect password").
//   null                          — wrong password (401) / cancelled prompt
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

    // 5xx, network blip — transient: neither a lockout nor a wrong password,
    // and the page says which. reportError surfaces it in the badge /
    // ops_errors; no console noise needed alongside (DevTools is the wrong
    // channel for this).
    reportError('auth.unexpected', { context: { status: res.status } });
    return { unavailable: true, status: res.status };
  } catch (e) {
    reportError('auth.network', { message: String(e?.message || e) });
    return { unavailable: true, status: 0 };
  }
}
