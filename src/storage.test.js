// Pins for the persisted-state layer (storage.js). The cold-start
// correctness of the portfolio total + MC cards rides on
// loadMarketCache's validation / expiry / legacy-fallback, and the
// schema bump rule in CLAUDE.md rides on migrate() — both are pure
// (localStorage-only) so they're cheap to lock here. jsdom supplies a
// real localStorage; we clear it between cases.
import { describe, it, expect, beforeEach } from 'vitest';
import { Storage } from './storage.js';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
});

describe('Storage.migrate', () => {
  it('drops legacy keys, stamps the schema version, and is idempotent', () => {
    localStorage.setItem('dp.schema', '0');
    localStorage.setItem('auth_token', 'x');
    localStorage.setItem('auth_lockout_until', '123');
    localStorage.setItem('auth_attempts', '3');
    localStorage.setItem('ytd-perf-cache-v12', '[]');

    Storage.migrate();

    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('auth_lockout_until')).toBeNull();
    expect(localStorage.getItem('auth_attempts')).toBeNull();
    expect(localStorage.getItem('ytd-perf-cache-v12')).toBeNull();
    expect(localStorage.getItem('dp.schema')).toBe('1');

    // Second run is a no-op (and must not throw).
    Storage.migrate();
    expect(localStorage.getItem('dp.schema')).toBe('1');
  });

  it('treats a missing schema key as version 0 and migrates', () => {
    localStorage.setItem('ytd-perf-cache-v1', '[]');
    Storage.migrate();
    expect(localStorage.getItem('ytd-perf-cache-v1')).toBeNull();
    expect(localStorage.getItem('dp.schema')).toBe('1');
  });

  it('no-ops (early return) when already at the current version', () => {
    localStorage.setItem('dp.schema', '1');
    // A stray legacy key wouldn't normally survive to v1, but it lets us
    // prove the migration body is skipped rather than re-run.
    localStorage.setItem('auth_token', 'keep');
    Storage.migrate();
    expect(localStorage.getItem('auth_token')).toBe('keep');
  });
});

describe('Storage.loadMarketCache', () => {
  it('returns only entries with a usable (>0, finite) lastPrice', () => {
    localStorage.setItem('dp.marketCache', JSON.stringify({
      ts: Date.now(),
      data: {
        'GBPUSD=X': { lastPrice: 1.27 },
        ZERO: { lastPrice: 0 },
        NEG: { lastPrice: -5 },
        NAN: { lastPrice: 'oops' },
        NULLV: null,
      },
    }));
    const out = Storage.loadMarketCache();
    expect(out['GBPUSD=X']).toEqual({ lastPrice: 1.27 });
    expect(out.ZERO).toBeUndefined();
    expect(out.NEG).toBeUndefined();
    expect(out.NAN).toBeUndefined();
    expect(out.NULLV).toBeUndefined();
  });

  it('drops a row older than the 7-day horizon', () => {
    localStorage.setItem('dp.marketCache', JSON.stringify({
      ts: Date.now() - 8 * DAY,
      data: { 'GBPUSD=X': { lastPrice: 1.27 } },
    }));
    expect(Storage.loadMarketCache()).toEqual({});
  });

  it('keeps a row just inside the horizon', () => {
    localStorage.setItem('dp.marketCache', JSON.stringify({
      ts: Date.now() - 6 * DAY,
      data: { 'GBPUSD=X': { lastPrice: 1.27 } },
    }));
    expect(Storage.loadMarketCache()['GBPUSD=X']).toEqual({ lastPrice: 1.27 });
  });

  it('returns {} for unparseable or bad-shaped rows', () => {
    localStorage.setItem('dp.marketCache', 'not json');
    expect(Storage.loadMarketCache()).toEqual({});
    localStorage.setItem('dp.marketCache', JSON.stringify({ ts: 'nan', data: {} }));
    expect(Storage.loadMarketCache()).toEqual({});
  });

  it('falls back to the legacy dp.fxCache shape when dp.marketCache is absent', () => {
    localStorage.setItem('dp.fxCache', JSON.stringify({
      ts: Date.now(),
      rates: { 'GBPUSD=X': { lastPrice: 1.3 }, ZERO: { lastPrice: 0 } },
    }));
    const out = Storage.loadMarketCache();
    expect(out['GBPUSD=X']).toEqual({ lastPrice: 1.3 });
    expect(out.ZERO).toBeUndefined();
  });

  it('ignores a stale legacy dp.fxCache row', () => {
    localStorage.setItem('dp.fxCache', JSON.stringify({
      ts: Date.now() - 8 * DAY,
      rates: { 'GBPUSD=X': { lastPrice: 1.3 } },
    }));
    expect(Storage.loadMarketCache()).toEqual({});
  });
});

describe('Storage.saveMarketCache', () => {
  it('filters to usable entries and round-trips through loadMarketCache', () => {
    const ok = Storage.saveMarketCache({ NVDA: { lastPrice: 200 }, ZERO: { lastPrice: 0 } });
    expect(ok).toBe(true);
    const row = JSON.parse(localStorage.getItem('dp.marketCache') || '{}');
    expect(row.data.NVDA).toEqual({ lastPrice: 200 });
    expect(row.data.ZERO).toBeUndefined();
    expect(Storage.loadMarketCache().NVDA).toEqual({ lastPrice: 200 });
  });

  it('returns false and writes nothing when no entry has a usable price', () => {
    expect(Storage.saveMarketCache({ ZERO: { lastPrice: 0 } })).toBe(false);
    expect(localStorage.getItem('dp.marketCache')).toBeNull();
  });

  it('returns false on null / non-object input', () => {
    expect(Storage.saveMarketCache(null)).toBe(false);
    expect(Storage.saveMarketCache('nope')).toBe(false);
  });

  it('removes the legacy dp.fxCache row after a successful write', () => {
    localStorage.setItem('dp.fxCache', JSON.stringify({ ts: Date.now(), rates: {} }));
    Storage.saveMarketCache({ NVDA: { lastPrice: 200 } });
    expect(localStorage.getItem('dp.fxCache')).toBeNull();
  });
});
