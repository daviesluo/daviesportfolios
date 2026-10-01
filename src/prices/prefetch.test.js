// Pin prefetch ↔ TickerChartModal cache-key alignment. A mismatch
// between the key prefetch writes and the key the modal reads ships
// silently — the chart still works, just always pays a cold fetch
// on first open even though prefetch supposedly warmed it. We hit
// that exact bug once already; this test guards against repeats.
//
// Caches are now IndexedDB-backed via chart_store.js. The store has
// a synchronous in-memory mirror that's the source of truth for
// reads; IDB writes are best-effort persistence. In a vitest node
// environment `indexedDB` is undefined so chart_store falls back to
// mem-only — that's fine, we read the same mirror via the same API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartStore, MaStore, YtdStore } from './chart_store.js';

beforeEach(async () => {
  // Drop any state left over from a previous test.
  await ChartStore._resetForTest();
  await MaStore._resetForTest();
  await YtdStore._resetForTest();
  // Minimal localStorage stub — Storage.migrate still touches it for
  // the schema-version row; nothing chart-related lives there now.
  const ls = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => { ls.set(k, String(v)); },
    removeItem: (k) => { ls.delete(k); },
    clear: () => { ls.clear(); },
    key: (i) => Array.from(ls.keys())[i] ?? null,
    get length() { return ls.size; },
  });
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
    if (u.includes('/functions/v1/fundamentals')) {
      return /** @type {any} */ ({ ok: true, json: async () => ({}) });
    }
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

    // Modal cache keys come from cache.js `tickerChartCacheKey()` — 1D
    // keeps variant+phase (its fetched window differs across them);
    // non-1D/non-PE drops both since `fetchParamsFor` returns
    // identical params for every (toggle, phase). Reads go through
    // ChartStore (chart_store.js, IDB-backed in prod, mem-only in
    // these tests).
    expect(ChartStore.get('NVDA|YTD')).toBeTruthy();
    expect(ChartStore.get('NVDA|1D|reg|regular')).toBeTruthy();
    expect(ChartStore.get('GOOG|3M')).toBeTruthy();
  });

  it('writes spSymbol into the PerfChart cache (dp.ytd) under year + range:variant', async () => {
    const { prefetchAllChartData } = await import('./prefetch.js');
    await prefetchAllChartData({
      tickers: ['NVDA'],
      spSymbol: '^GSPC',
      extendedHours: false,
      phase: 'regular',
    });
    const year = new Date().getFullYear();
    // YtdStore keys are flat: `y${year}|${rkey}|${ticker}`. Variant
    // for 1D regular hours is 'reg'; non-1D ranges use 'std'.
    expect(YtdStore.get(`y${year}|1D:reg|^GSPC`)).toBeTruthy();
    expect(YtdStore.get(`y${year}|1D:reg|NVDA`)).toBeTruthy();
    expect(YtdStore.get(`y${year}|YTD:std|^GSPC`)).toBeTruthy();
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
      // PE-prefetch hits the fundamentals Edge Function after the
      // chart loop. Match the suite-wide stub so the call doesn't
      // hang on the proxy-fallback Promise below.
      if (u.includes('/functions/v1/fundamentals')) {
        return /** @type {any} */ ({ ok: true, json: async () => ({}) });
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

// The browser sweep's perf-refresh/tick check (2026-10-01), failing about one run in ten under load: this prefetch's
// 24H batch, asked at 23:00, landed once the page's clock read 23:06 and was stamped 23:06, so the performance panel's
// refresh six minutes on found the window fresh and fetched nothing. A phone locked mid-refresh does the same.
describe('prefetchAllChartData stamps', () => {
  it('each row with when its fetch was asked, not when the answer landed', async () => {
    const t0 = Date.parse('2026-09-17T23:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    /** @type {Array<() => void>} */
    const held = [];
    let holding = true;
    /** @type {any} */ (globalThis.fetch).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/functions/v1/chart')) {
        if (holding) await new Promise((r) => { held.push(() => r(undefined)); });
        const tickers = new URL(u).searchParams.get('tickers')?.split(',') ?? [];
        const out = {};
        for (const t of tickers) {
          out[t] = [];
          for (let i = 11; i >= 0; i--) out[t].push({ date: new Date(t0 - i * 5 * 60_000).toISOString().slice(0, 16), close: 100 + i });
        }
        return /** @type {any} */ ({ ok: true, json: async () => out });
      }
      if (u.includes('/functions/v1/fundamentals')) return /** @type {any} */ ({ ok: true, json: async () => ({}) });
      return new Promise(() => {});
    });
    const { prefetchAllChartData } = await import('./prefetch.js');
    const done = prefetchAllChartData({ tickers: ['NVDA'], spSymbol: '^GSPC', extendedHours: false, phase: 'regular' });
    // Every range's batch is asked for at 23:00 (1D, 1W, 1M, 3M, YTD, 1Y)…
    await vi.waitFor(() => expect(held.length).toBe(6));
    // …and every answer lands once the clock reads 23:06.
    clock.mockReturnValue(t0 + 6 * 60e3);
    holding = false;
    for (const release of held.splice(0)) release();
    await done;
    const year = new Date().getFullYear();
    expect(YtdStore.get(`y${year}|1D:reg|^GSPC`)?.ts).toBe(t0);
    expect(YtdStore.get(`y${year}|1D:reg|NVDA`)?.ts).toBe(t0);
    expect(ChartStore.get('NVDA|1D|reg|regular')?.ts).toBe(t0);
    clock.mockRestore();
  });
});
