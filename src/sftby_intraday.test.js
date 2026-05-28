// Pins for the SFTBY client-side cache + merge helpers. The actual
// data recording lives server-side now (sftby-record Edge Function +
// pg_cron — see supabase/functions/sftby-record/index.ts); this file
// only covers the LOCALSTORAGE CACHE layer that the modal reads
// synchronously on first paint, plus the multi-day chart merge.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchSftbyServerData,
  getSftbyIntradaySeries,
  getSftbyPrevClose,
  mergeSftbyToday,
  SFTBY_FETCH_EVENT,
  _testHooks,
} from './sftby_intraday.js';

// Minimal localStorage shim for the node test runner.
if (typeof globalThis.localStorage === 'undefined') {
  /** @type {Map<string, string>} */
  const store = new Map();
  /** @type {any} */
  (globalThis).localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => { _testHooks.reset(); });

describe('fetchSftbyServerData — caches the server response in localStorage', () => {
  it('writes series + prevClose to the cache on a successful fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        series: [{ date: '2026-05-28T12:00', close: 22.80, volume: 0 }],
        prevClose: 24.72,
        prevCloseDate: '2026-05-27',
      }),
    });
    const out = await fetchSftbyServerData(/** @type {any} */ (mockFetch));
    expect(out).not.toBeNull();
    expect(out?.series.length).toBe(1);
    expect(out?.prevClose).toBe(24.72);
    expect(getSftbyIntradaySeries()).toEqual([
      { date: '2026-05-28T12:00', close: 22.80, volume: 0 },
    ]);
    expect(getSftbyPrevClose()).toBe(24.72);
  });

  it('returns null and leaves the cache untouched on network error', async () => {
    _testHooks.writeCache({ series: [{ date: 'x', close: 1, volume: 0 }], prevClose: 99, prevCloseDate: 'y', fetchedAt: 0 });
    const mockFetch = vi.fn().mockRejectedValue(new Error('network'));
    const out = await fetchSftbyServerData(/** @type {any} */ (mockFetch));
    expect(out).toBeNull();
    // Cache still holds the previous value.
    expect(getSftbyPrevClose()).toBe(99);
  });

  it('returns null when the response is not OK', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const out = await fetchSftbyServerData(/** @type {any} */ (mockFetch));
    expect(out).toBeNull();
  });

  it('returns null when the body is malformed (no series array)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ prevClose: 99 }) });
    expect(await fetchSftbyServerData(/** @type {any} */ (mockFetch))).toBeNull();
  });
});

describe('getSftbyIntradaySeries / getSftbyPrevClose — cache reads', () => {
  it('returns empty / null when the cache is missing', () => {
    expect(getSftbyIntradaySeries()).toEqual([]);
    expect(getSftbyPrevClose()).toBeNull();
  });

  it('round-trips a written cache row', () => {
    _testHooks.writeCache({
      series: [{ date: '2026-05-28T12:00', close: 22.80, volume: 0 }],
      prevClose: 24.72,
      prevCloseDate: '2026-05-27',
      fetchedAt: Date.now(),
    });
    expect(getSftbyIntradaySeries().length).toBe(1);
    expect(getSftbyPrevClose()).toBe(24.72);
  });
});

describe('mergeSftbyToday — multi-day series with synthetic today', () => {
  function seedThreeBuckets() {
    _testHooks.writeCache({
      series: [
        { date: '2026-05-28T12:00', close: 22.50, volume: 0 },
        { date: '2026-05-28T12:05', close: 22.55, volume: 0 },
        { date: '2026-05-28T12:10', close: 22.60, volume: 0 },
      ],
      prevClose: 24.72,
      prevCloseDate: '2026-05-27',
      fetchedAt: Date.now(),
    });
  }

  it('1D returns the full synthetic series regardless of yahooSeries', () => {
    seedThreeBuckets();
    const yahoo = [{ date: '2026-05-28T13:30', close: 23.00 }];
    const out = mergeSftbyToday(yahoo, '1D', '2026-05-28');
    expect(out.length).toBe(3);
    expect(out.every((p) => p.close < 23)).toBe(true);
  });

  it('1W swaps todays Yahoo bars for synthetic downsampled to 30-min', () => {
    seedThreeBuckets();
    const yahoo = [
      { date: '2026-05-27T13:30', close: 21.00 },
      { date: '2026-05-28T13:30', close: 23.00 },
    ];
    const out = mergeSftbyToday(yahoo, '1W', '2026-05-28');
    expect(out.length).toBe(2);
    expect(out[0].date).toBe('2026-05-27T13:30');
    expect(out[1].close).toBe(22.60);
  });

  it('1M downsamples todays synthetic to 60-min', () => {
    seedThreeBuckets();
    const yahoo = [{ date: '2026-05-28T13:30', close: 23.00 }];
    const out = mergeSftbyToday(yahoo, '1M', '2026-05-28');
    expect(out.length).toBe(1);
    expect(out[0].close).toBe(22.60);
  });

  it('3M and YTD collapse todays synthetic to one daily bar', () => {
    seedThreeBuckets();
    const yahoo = [
      { date: '2026-05-27', close: 21.00 },
      { date: '2026-05-28', close: 23.00 },
    ];
    const out3M = mergeSftbyToday(yahoo, '3M', '2026-05-28');
    expect(out3M.length).toBe(2);
    expect(out3M[1]).toEqual({ date: '2026-05-28', close: 22.60, volume: 0 });
  });

  it('returns the yahoo series untouched when no synthetic data for today', () => {
    const yahoo = [{ date: '2026-05-28T13:30', close: 23.00 }];
    expect(mergeSftbyToday(yahoo, '1W', '2026-05-28')).toEqual(yahoo);
  });
});

describe('SFTBY_FETCH_EVENT', () => {
  it('is exported as the expected string', () => {
    expect(SFTBY_FETCH_EVENT).toBe('sftby:server-fetched');
  });
});
