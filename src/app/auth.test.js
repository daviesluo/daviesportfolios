// Pin the token-decoding helpers in auth.js. The base64url + payload
// shape contract is the same one the `data` Edge Function re-derives on
// the server side; if a future refactor breaks decoding the client will
// silently fall back to re-prompting for the password on every reload,
// which is exactly the bug we already shipped once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeAppToken, getAppToken, setAppToken } from './auth.js';

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
