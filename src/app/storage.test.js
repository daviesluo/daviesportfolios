// Pins for the persisted-state layer (storage.js). The cold-start
// correctness of the portfolio total + MC cards rides on
// loadMarketCache's validation / expiry / legacy-fallback, and the
// schema bump rule in CLAUDE.md rides on migrate() — both are pure
// (localStorage-only) so they're cheap to lock here. jsdom supplies a
// real localStorage; we clear it between cases.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    expect(localStorage.getItem('dp.schema')).toBe('2');

    // Second run is a no-op (and must not throw).
    Storage.migrate();
    expect(localStorage.getItem('dp.schema')).toBe('2');
  });

  it('treats a missing schema key as version 0 and migrates', () => {
    localStorage.setItem('ytd-perf-cache-v1', '[]');
    Storage.migrate();
    expect(localStorage.getItem('ytd-perf-cache-v1')).toBeNull();
    expect(localStorage.getItem('dp.schema')).toBe('2');
  });

  it('no-ops (early return) when already at the current version', () => {
    localStorage.setItem('dp.schema', '2');
    // A stray legacy key wouldn't normally survive to v1, but it lets us
    // prove the migration body is skipped rather than re-run.
    localStorage.setItem('auth_token', 'keep');
    Storage.migrate();
    expect(localStorage.getItem('auth_token')).toBe('keep');
  });

  describe('v1 -> v2: the chart caches left the shared IndexedDB database', () => {
    const had = 'indexedDB' in globalThis;
    const before = /** @type {any} */ (globalThis).indexedDB;
    /** @type {ReturnType<typeof vi.fn>} */
    let deleteDatabase;
    beforeEach(() => {
      deleteDatabase = vi.fn();
      /** @type {any} */ (globalThis).indexedDB = { deleteDatabase };
    });
    afterEach(() => {
      if (had) /** @type {any} */ (globalThis).indexedDB = before;
      else delete /** @type {any} */ (globalThis).indexedDB;
    });

    it('deletes the old database once — only one of its three stores ever existed — and leaves v1\'s keys alone', () => {
      localStorage.setItem('dp.schema', '1');
      localStorage.setItem('auth_token', 'keep');
      Storage.migrate();
      expect(deleteDatabase).toHaveBeenCalledTimes(1);
      expect(deleteDatabase).toHaveBeenCalledWith('daviesportfolios');
      expect(localStorage.getItem('auth_token')).toBe('keep');
      expect(localStorage.getItem('dp.schema')).toBe('2');
      Storage.migrate();
      expect(deleteDatabase).toHaveBeenCalledTimes(1);
    });

    it('never deletes the database the caches live in now', () => {
      localStorage.setItem('dp.schema', '0');
      Storage.migrate();
      expect(deleteDatabase.mock.calls.flat()).not.toContain('dp-charts');
    });
  });
});

describe('Storage last-shown prices (dp.lastPrices)', () => {
  const row = { lastPrice: 240, prevClose: 238, dayPct: 0.84, extPrice: null, extDayPct: null, extPriceTrusted: null };

  it('round-trips what the page showed, nulls included', () => {
    expect(Storage.saveLastPrices({ ACME: row })).toBe(true);
    expect(Storage.loadLastPrices()).toEqual({ ACME: row });
  });

  it('drops a ticker without a positive lastPrice, and writes nothing for an empty set', () => {
    localStorage.setItem('dp.lastPrices', JSON.stringify({ ts: Date.now(), data: { ACME: row, ZERO: { ...row, lastPrice: 0 }, BAD: null } }));
    expect(Object.keys(Storage.loadLastPrices())).toEqual(['ACME']);
    localStorage.clear();
    expect(Storage.saveLastPrices({})).toBe(false);
    expect(localStorage.getItem('dp.lastPrices')).toBeNull();
  });

  it('is ignored past a week — too far from today to be worth painting', () => {
    localStorage.setItem('dp.lastPrices', JSON.stringify({ ts: Date.now() - 8 * DAY, data: { ACME: row } }));
    expect(Storage.loadLastPrices()).toEqual({});
    localStorage.setItem('dp.lastPrices', JSON.stringify({ ts: Date.now() - 6 * DAY, data: { ACME: row } }));
    expect(Storage.loadLastPrices()).toEqual({ ACME: row });
  });

  it('reads a missing or malformed row as empty', () => {
    expect(Storage.loadLastPrices()).toEqual({});
    localStorage.setItem('dp.lastPrices', 'not json');
    expect(Storage.loadLastPrices()).toEqual({});
  });
});

describe('Storage 24H chart seed (dp.perfSeed)', () => {
  const bars = (base) => [{ date: '2026-09-17T14:00', close: base }, { date: '2026-09-17T19:55', close: base + 1 }];
  const seed = () => ({
    rangeKey: '1D', variantKey: 'closed', spSymbol: '^GSPC',
    hist: { '^GSPC': bars(5000), ACME: bars(200) },
    recorded: [{ ts: '2026-09-17T13:55:00.000Z', prices: { ACME: 200 } }],
  });

  it('round-trips the bars and the recorded rows', () => {
    expect(Storage.savePerfSeed(seed())).toBe(true);
    expect(Storage.loadPerfSeed()).toEqual(seed());
  });

  it('drops a series with a malformed bar rather than hand the chart something that throws on its first render', () => {
    const s = seed();
    s.hist.ACME = [{ date: '2026-09-17T14:00', close: 200 }, /** @type {any} */ ({ close: 201 })];
    Storage.savePerfSeed(s);
    const back = Storage.loadPerfSeed();
    expect(Object.keys(back?.hist || {})).toEqual(['^GSPC']);
  });

  it('is no seed at all without the benchmark, off the 24H window, past a week, or malformed', () => {
    const noSp = seed();
    delete /** @type {any} */ (noSp.hist)['^GSPC'];
    Storage.savePerfSeed(noSp);
    expect(Storage.loadPerfSeed()).toBeNull();
    Storage.savePerfSeed({ ...seed(), rangeKey: '1W' });
    expect(Storage.loadPerfSeed()).toBeNull();
    localStorage.setItem('dp.perfSeed', JSON.stringify({ ts: Date.now() - 8 * DAY, data: seed() }));
    expect(Storage.loadPerfSeed()).toBeNull();
    localStorage.setItem('dp.perfSeed', JSON.stringify({ ts: Date.now(), data: { ...seed(), recorded: 'x' } }));
    expect(Storage.loadPerfSeed()).toBeNull();
    localStorage.setItem('dp.perfSeed', '{');
    expect(Storage.loadPerfSeed()).toBeNull();
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

// A minimal but shape-valid portfolio for round-trip / rejection tests —
// doesn't need to satisfy computeMetrics, just Storage's own guards
// (holdings + positions objects present, no `_isDemo`).
const realPortfolio = () => ({
  positions: { ST: { role: 'FWD', label: 'ST', tickers: ['NVDA'] } },
  holdings: { NVDA: { shares: 5, cost: 100, lastPrice: 200, currency: 'USD' } },
});

describe('Storage.savePortfolioCache / loadPortfolioCache', () => {
  it('round-trips a real portfolio', () => {
    const p = realPortfolio();
    expect(Storage.savePortfolioCache(p)).toBe(true);
    expect(Storage.loadPortfolioCache()).toEqual(p);
  });

  it('refuses to save a demo portfolio (_isDemo: true) — write is a no-op', () => {
    const demo = { ...realPortfolio(), _isDemo: true };
    expect(Storage.savePortfolioCache(demo)).toBe(false);
    expect(localStorage.getItem('dp.portfolioCache')).toBeNull();
  });

  it('a prior real cache survives a later failed (demo) save attempt', () => {
    const p = realPortfolio();
    Storage.savePortfolioCache(p);
    Storage.savePortfolioCache({ ...realPortfolio(), _isDemo: true }); // refused, no-op
    expect(Storage.loadPortfolioCache()).toEqual(p); // untouched
  });

  it('refuses null / non-object / missing-holdings / missing-positions input', () => {
    expect(Storage.savePortfolioCache(null)).toBe(false);
    expect(Storage.savePortfolioCache(/** @type {any} */ ('nope'))).toBe(false);
    expect(Storage.savePortfolioCache(/** @type {any} */ ({ positions: {} }))).toBe(false); // no holdings
    expect(Storage.savePortfolioCache(/** @type {any} */ ({ holdings: {} }))).toBe(false);  // no positions
  });

  it('load returns null on a missing row (cold browser / private mode)', () => {
    expect(Storage.loadPortfolioCache()).toBeNull();
  });

  it('load returns null past the 30-day staleness cap, and null exactly at the boundary tick', () => {
    const p = realPortfolio();
    localStorage.setItem('dp.portfolioCache', JSON.stringify({ ts: Date.now() - 30 * DAY - 1, data: p }));
    expect(Storage.loadPortfolioCache()).toBeNull();
    localStorage.setItem('dp.portfolioCache', JSON.stringify({ ts: Date.now() - 29 * DAY, data: p }));
    expect(Storage.loadPortfolioCache()).toEqual(p);
  });

  it('load returns null on a malformed row (bad JSON, missing data, non-finite ts)', () => {
    localStorage.setItem('dp.portfolioCache', 'not json');
    expect(Storage.loadPortfolioCache()).toBeNull();
    localStorage.setItem('dp.portfolioCache', JSON.stringify({ ts: 'nope', data: realPortfolio() }));
    expect(Storage.loadPortfolioCache()).toBeNull();
    localStorage.setItem('dp.portfolioCache', JSON.stringify({ ts: Date.now(), data: null }));
    expect(Storage.loadPortfolioCache()).toBeNull();
    localStorage.setItem('dp.portfolioCache', JSON.stringify({ ts: Date.now(), data: { holdings: {} } })); // no positions
    expect(Storage.loadPortfolioCache()).toBeNull();
  });

  it('load returns null for a demo row even if one somehow got written (belt-and-suspenders)', () => {
    localStorage.setItem('dp.portfolioCache', JSON.stringify({ ts: Date.now(), data: { ...realPortfolio(), _isDemo: true } }));
    expect(Storage.loadPortfolioCache()).toBeNull();
  });
});

describe('Storage Agents page (dp.agentsCache)', () => {
  const dash = { at: '2026-09-17T23:00:00.000Z', strategies: [{ id: 's1' }] };
  const chart = { candles: [[1, 2, 3, 0, 2]] };

  it('round-trips the dashboard and the charts it keeps', () => {
    expect(Storage.saveAgentsCache({ at: 5, dash, charts: { 's1|BTC/USD': { at: 6, chart } } })).toBe(true);
    expect(Storage.loadAgentsCache()).toEqual({ at: 5, dash, charts: { 's1|BTC/USD': { at: 6, chart } } });
  });

  it('drops the charts before the dashboard, and keeps nothing rather than a copy too big to keep', () => {
    const big = 'x'.repeat(700_000);
    expect(Storage.saveAgentsCache({ at: 5, dash, charts: { 's1|BTC/USD': { at: 6, chart: { big } } } })).toBe(true);
    expect(Storage.loadAgentsCache()?.charts).toEqual({});
    expect(Storage.loadAgentsCache()?.dash).toEqual(dash);
    localStorage.clear();
    expect(Storage.saveAgentsCache({ at: 5, dash: { big }, charts: {} })).toBe(false);
    expect(localStorage.getItem('dp.agentsCache')).toBeNull();
  });

  it('is nothing past a week, without a dashboard, or malformed', () => {
    localStorage.setItem('dp.agentsCache', JSON.stringify({ ts: Date.now() - 8 * DAY, data: { at: 1, dash, charts: {} } }));
    expect(Storage.loadAgentsCache()).toBeNull();
    localStorage.setItem('dp.agentsCache', JSON.stringify({ ts: Date.now(), data: { at: 1, charts: {} } }));
    expect(Storage.loadAgentsCache()).toBeNull();
    localStorage.setItem('dp.agentsCache', '{');
    expect(Storage.loadAgentsCache()).toBeNull();
    localStorage.setItem('dp.agentsCache', JSON.stringify({ ts: Date.now(), data: { at: 1, dash, charts: { bad: null, ok: { at: 2, chart } } } }));
    expect(Object.keys(Storage.loadAgentsCache()?.charts || {})).toEqual(['ok']);
  });
});
