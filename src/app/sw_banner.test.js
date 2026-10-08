// @vitest-environment jsdom
// Pin tests for the post-RELOAD suppression machinery in sw-banner.jsx.
// We can't render the React component without a DOM, so the testable
// surface is the trio of pure helpers the component leans on:
// readReloadSuppressAt / computeSuppressUntil / shouldShowBanner. Any
// regression on this path re-introduces the "banner spams the user
// after they click RELOAD" bug from PR #108 — these cases catch it.

import { describe, it, expect } from 'vitest';
import {
  SW_RELOAD_SUPPRESS_KEY,
  SW_RELOAD_SUPPRESS_MS,
  readReloadSuppressAt,
  computeSuppressUntil,
  shouldShowBanner,
  purgeForReload,
} from './sw-banner.jsx';

describe('readReloadSuppressAt', () => {
  it('returns 0 when the storage object is missing / unusable', () => {
    expect(readReloadSuppressAt(null)).toBe(0);
    expect(readReloadSuppressAt(undefined)).toBe(0);
    expect(readReloadSuppressAt(/** @type {any} */ ({}))).toBe(0);
  });

  it('reads the row using the canonical key', () => {
    let askedFor = '';
    const storage = { getItem: (k) => { askedFor = k; return null; } };
    readReloadSuppressAt(storage);
    expect(askedFor).toBe(SW_RELOAD_SUPPRESS_KEY);
    expect(SW_RELOAD_SUPPRESS_KEY).toBe('dp.swReloadAt');
  });

  it('returns the parsed timestamp when the row is a finite positive number', () => {
    const ts = 1_700_000_000_000;
    expect(readReloadSuppressAt({ getItem: () => String(ts) })).toBe(ts);
  });

  it('rejects malformed / non-positive / NaN rows', () => {
    expect(readReloadSuppressAt({ getItem: () => 'junk' })).toBe(0);
    expect(readReloadSuppressAt({ getItem: () => '-5' })).toBe(0);
    expect(readReloadSuppressAt({ getItem: () => '0' })).toBe(0);
    expect(readReloadSuppressAt({ getItem: () => null })).toBe(0);
  });

  it('returns 0 when storage.getItem throws (Safari private mode)', () => {
    expect(readReloadSuppressAt({ getItem: () => { throw new Error('quota'); } })).toBe(0);
  });
});

describe('computeSuppressUntil', () => {
  it('returns reloadAt + SUPPRESS_MS for a positive timestamp', () => {
    const ts = 1_700_000_000_000;
    expect(computeSuppressUntil(ts)).toBe(ts + SW_RELOAD_SUPPRESS_MS);
  });

  it('returns 0 when reloadAt is 0 (never clicked)', () => {
    expect(computeSuppressUntil(0)).toBe(0);
  });

  it('returns 0 for negative inputs (defensive)', () => {
    expect(computeSuppressUntil(-1)).toBe(0);
  });

  it('uses a 2-minute suppression window — matches the comment in sw-banner.jsx', () => {
    // Pin the window length so a future "tighten / loosen" change has to
    // update this test consciously instead of silently shrinking it to
    // zero and re-introducing the banner spam.
    expect(SW_RELOAD_SUPPRESS_MS).toBe(2 * 60 * 1000);
  });
});

describe('shouldShowBanner', () => {
  it('hides when needRefresh is false regardless of suppression state', () => {
    expect(shouldShowBanner(false, 0, 0)).toBe(false);
    expect(shouldShowBanner(false, 9999, 0)).toBe(false);
    expect(shouldShowBanner(false, 9999, 999999)).toBe(false);
  });

  it('shows when needRefresh and we are past the suppression deadline', () => {
    expect(shouldShowBanner(true, 1000, 999)).toBe(true);
    expect(shouldShowBanner(true, 1000, 0)).toBe(true);
  });

  it('hides during the active suppression window', () => {
    // Now < suppressUntil — still inside the 2-min mute period.
    expect(shouldShowBanner(true, 1000, 2000)).toBe(false);
  });

  it('flips back on at the exact instant the window ends', () => {
    expect(shouldShowBanner(true, 2000, 2000)).toBe(true);
  });
});

describe('purgeForReload', () => {
  // The reload path's freeze fix relies on the purge never REJECTING (a
  // throw would skip the post-purge reload) — each step is isolated in its
  // own try/catch. A hang is separately covered by handleReload's hard
  // timer, which can't be unit-tested without the SW hook.
  it('resolves even when a cache or service-worker API throws (steps stay isolated)', async () => {
    const g = /** @type {any} */ (globalThis);
    const hadCaches = 'caches' in g, origCaches = g.caches;
    const nav = /** @type {any} */ (globalThis.navigator);
    const hadSw = !!nav && 'serviceWorker' in nav;
    const origSw = hadSw ? nav.serviceWorker : undefined;
    g.caches = { keys: () => Promise.reject(new Error('blocked')) };
    if (nav) Object.defineProperty(nav, 'serviceWorker', { configurable: true, value: { getRegistrations: () => { throw new Error('denied'); } } });
    try {
      await expect(purgeForReload()).resolves.toBeUndefined();
    } finally {
      if (hadCaches) g.caches = origCaches; else delete g.caches;
      if (nav) {
        if (hadSw) Object.defineProperty(nav, 'serviceWorker', { configurable: true, value: origSw });
        else delete nav.serviceWorker;
      }
    }
  });

  // Davies (2026-09-28): the banner's reload was the one reload that still
  // painted old numbers first, then the live ones a second or two later. The
  // purge cleared localStorage, where every copy a reload paints from lives
  // (the book, the prices last shown, the 24H chart's bars), and with it
  // `dp.prefs` — hide-values switched itself off at every update.
  it('keeps every dp.* row a reload paints from, and the prefs', async () => {
    const rows = {
      'dp.schema': '7',
      'dp.prefs': JSON.stringify({ hideValues: true }),
      'dp.portfolioCache': JSON.stringify({ ts: 1, data: { holdings: {} } }),
      'dp.lastPrices': JSON.stringify({ ts: 1, data: { ACME: { lastPrice: 101 } } }),
      'dp.marketCache': JSON.stringify({ ts: 1, data: {} }),
      'dp.perfSeed': JSON.stringify({ ts: 1, data: {} }),
      'dp.agentsCache': JSON.stringify({ ts: 1, data: {} }),
      'dp.opsErrorAck': '123',
    };
    localStorage.clear();
    for (const [k, v] of Object.entries(rows)) localStorage.setItem(k, v);
    try {
      await purgeForReload();
      expect(Object.fromEntries(Object.keys(rows).map((k) => [k, localStorage.getItem(k)]))).toEqual(rows);
    } finally {
      localStorage.clear();
    }
  });
});
