// Pin the token-decoding helpers in auth.js. The base64url + payload
// shape contract is the same one the `data` Edge Function re-derives on
// the server side; if a future refactor breaks decoding the client will
// silently fall back to re-prompting for the password on every reload,
// which is exactly the bug we already shipped once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeAppToken, getAppToken, setAppToken, onSignOut, signOut, noteAuthStatus } from './auth.js';

// Browser-shaped sessionStorage stub — `vi.stubGlobal` works around
// `sessionStorage` being a non-configurable getter in some node envs.
beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

// base64url encoder (no padding, +/- vs /+) — same shape the auth
// Edge Function emits.
function b64url(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('decodeAppToken', () => {
  it('returns the payload when exp is in the future', () => {
    const payload = { role: 'admin', exp: Date.now() + 60_000 };
    const token = `${b64url(JSON.stringify(payload))}.fakesig`;
    const decoded = decodeAppToken(token);
    expect(decoded).toEqual(payload);
  });

  it('returns null when exp has already passed', () => {
    const payload = { role: 'admin', exp: Date.now() - 1 };
    const token = `${b64url(JSON.stringify(payload))}.fakesig`;
    expect(decodeAppToken(token)).toBeNull();
  });

  it('rejects unknown roles', () => {
    const payload = { role: 'superadmin', exp: Date.now() + 60_000 };
    const token = `${b64url(JSON.stringify(payload))}.fakesig`;
    expect(decodeAppToken(token)).toBeNull();
  });

  it('returns null for malformed inputs', () => {
    expect(decodeAppToken('')).toBeNull();
    expect(decodeAppToken(null)).toBeNull();
    expect(decodeAppToken(undefined)).toBeNull();
    expect(decodeAppToken('no-dot')).toBeNull();
    expect(decodeAppToken('not-base64.fakesig')).toBeNull();
  });

  it('rejects payloads where exp is missing or non-numeric', () => {
    const noExp   = `${b64url(JSON.stringify({ role: 'ro' }))}.fakesig`;
    const badExp  = `${b64url(JSON.stringify({ role: 'ro', exp: 'forever' }))}.fakesig`;
    expect(decodeAppToken(noExp)).toBeNull();
    expect(decodeAppToken(badExp)).toBeNull();
  });
});

describe('getAppToken / setAppToken', () => {
  it('round-trips a value through sessionStorage', () => {
    expect(getAppToken()).toBe('');
    setAppToken('abc.def');
    expect(getAppToken()).toBe('abc.def');
  });

  it('setAppToken with a falsy value clears the slot', () => {
    setAppToken('xyz');
    expect(getAppToken()).toBe('xyz');
    setAppToken('');
    expect(getAppToken()).toBe('');
    setAppToken('zzz');
    setAppToken(null);
    expect(getAppToken()).toBe('');
  });
});

// Signing out (Davies, 2026-09-27): a lapsed token returns the app to its
// login form instead of an error inside the page. The App side is pinned in
// app.test.jsx; these pin the module's half.
describe('signOut / noteAuthStatus', () => {
  it('forgets the token and tells every listener, and a listener that throws stops no other', () => {
    setAppToken('a.b');
    const seen = [];
    const offs = [onSignOut(() => seen.push(1)), onSignOut(() => { throw new Error('boom'); }), onSignOut(() => seen.push(3))];
    signOut();
    expect(getAppToken()).toBe('');
    expect(seen).toEqual([1, 3]);
    offs.forEach((off) => off());
    signOut();
    expect(seen).toEqual([1, 3]);
  });

  it('a 401 to a token this browser holds signs out; a 403, a 500, a 200 or no token does not', () => {
    setAppToken('a.b');
    const seen = [];
    const off = onSignOut(() => seen.push('out'));
    noteAuthStatus(403); noteAuthStatus(500); noteAuthStatus(200);
    expect([getAppToken(), seen]).toEqual(['a.b', []]);
    noteAuthStatus(401);
    expect([getAppToken(), seen]).toEqual(['', ['out']]);
    // Many calls failing at once: the first signs out, the rest find no token.
    noteAuthStatus(401); noteAuthStatus(401);
    expect(seen).toEqual(['out']);
    off();
  });
});
