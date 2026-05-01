// Pin prefetch ↔ TickerChartModal cache-key alignment. A mismatch
// between the key prefetch writes and the key the modal reads ships
// silently — the chart still works, just always pays a cold fetch
// on first open even though prefetch supposedly warmed it. We hit
// that exact bug once already; this test guards against repeats.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Storage } from './utils.js';

// localStorage stub for a node test runner — vi.stubGlobal works
// around `localStorage` being a non-configurable getter in some node
// environments.
beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  });
  // fetchHistoricalBatch's underlying global fetch — stub a happy path
  // that returns 12 intraday bars in the last hour. Recent-enough that
  // filterToLast24h keeps them; >= 2 bars so prefetch's length guard
  // passes and the cache row actually gets written.
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/functions/v1/chart')) {
      const tickers = new URL(u).searchParams.get('tickers')?.split(',') ?? [];
      const out = {};
      const now = Date.now();
      for (const t of tickers) {
        out[t] = [];
        for (let i = 11; i >= 0; i--) {
          const ts = new Date(now - i * 5 * 60_000).toISOString().slice(0, 16);
          out[t].push({ date: ts, close: 100 + i });
        }
      }
      return /** @type {any} */ ({ ok: true, json: async () => out });
    }
    // PE-prefetch hits the fundamentals Edge Function after the
    // range loop. Return an empty {} so the PE pass short-circuits
    // (no usable EPS = no PE entries written) — the prefetch tests
    // care about the chart-data shape, not PE.
    if (u.includes('/functions/v1/fundamentals')) {
      return /** @type {any} */ ({ ok: true, json: async () => ({}) });
    }
    // Hang the proxy fallback so the Edge Function path always wins.
    return new Promise(() => {});
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prefetchAllChartData → TickerChartModal cache-key contract', () => {
  it('writes per-ticker entries the modal can read back under the same key', async () => {
    const { prefetchAllChartData } = await import('./prefetch.js');
    await prefetchAllChartData({
      tickers: ['NVDA', 'GOOG'],
      spSymbol: '^GSPC',
      extendedHours: false,
      phase: 'regular',
    });

    const tc = Storage.loadTickerChart();
    expect(tc?.entries).toBeTruthy();
    // Modal cache keys use this exact shape — see ticker_chart_modal.jsx
    // (`${ticker}|${rangeKey}|${useExt ? 'ext' : 'reg'}|${phase || ''}`).
    // useExt during regular hours is false, so the variant tag is 'reg'.
    expect(tc.entries['NVDA|YTD|reg|regular']).toBeTruthy();
    expect(tc.entries['NVDA|1D|reg|regular']).toBeTruthy();
    expect(tc.entries['GOOG|3M|reg|regular']).toBeTruthy();
  });

  it('writes spSymbol into the PerfChart cache (dp.ytd) under year + range:variant', async () => {
    const { prefetchAllChartData } = await import('./prefetch.js');
    await prefetchAllChartData({
      tickers: ['NVDA'],
      spSymbol: '^GSPC',
      extendedHours: false,
      phase: 'regular',
    });
    const ytd = Storage.loadYtd();
    const year = new Date().getFullYear();
    expect(ytd?.year).toBe(year);
    // Variant for 1D regular hours is 'reg'.
    expect(ytd.byRange['1D:reg']?.entries['^GSPC']).toBeTruthy();
    expect(ytd.byRange['1D:reg']?.entries['NVDA']).toBeTruthy();
    expect(ytd.byRange['YTD:std']?.entries['^GSPC']).toBeTruthy();
  });

  it('skips the daily-only ticker on the intraday batch (interval=1d split)', async () => {
    const seenIntervals = [];
    /** @type {any} */ (globalThis.fetch).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/functions/v1/chart')) {
        const params = new URL(u).searchParams;
        seenIntervals.push({
          tickers: params.get('tickers'),
          interval: params.get('interval'),
        });
        const tickers = params.get('tickers')?.split(',') ?? [];
        const out = {};
        for (const t of tickers) out[t] = [
          { date: '2026-04-28', close: 100 },
          { date: '2026-04-29', close: 101 },
        ];
        return /** @type {any} */ ({ ok: true, json: async () => out });
      }
      return new Promise(() => {});
    });

    const { prefetchAllChartData } = await import('./prefetch.js');
    await prefetchAllChartData({
      tickers: ['NVDA', '017731', 'SPAX.PVT'],
      spSymbol: '^GSPC',
      extendedHours: false,
      phase: 'regular',
    });

    // For each range the prefetch fires AT MOST two batches: an
    // intraday one (NVDA + ^GSPC) and a daily-only one (017731,
    // SPAX.PVT) with interval=1d. The 1D range still uses 5m for the
    // intraday set since fetchParamsFor's intraday default for 1D is
    // 5m, but the daily-only set always lands at interval=1d.
    const dailyOnlyCalls = seenIntervals.filter(c =>
      c.tickers && (c.tickers.includes('017731') || c.tickers.includes('SPAX.PVT'))
    );
    expect(dailyOnlyCalls.length).toBeGreaterThan(0);
    for (const c of dailyOnlyCalls) {
      expect(c.interval).toBe('1d');
    }
  });
});
