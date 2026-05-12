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
