import { describe, it, expect } from 'vitest';
import { isFresh, hasAnyNumericField, trimLru, RANGE_TTL_MS, tickerChartCacheKey } from './cache.js';

describe('tickerChartCacheKey — algorithm-version suffixes', () => {
  // The PE / PS keys carry an algorithm-version suffix so a breaking
  // change to the ratio-series math can evict every browser's cached
  // series in one push instead of waiting out the 12 h TTL. The
  // particular version numbers matter: a future shrug-and-rename
  // would silently invalidate every existing user's cache for no
  // reason. Pin them.
  it('PE rangeKey emits |PE|v5| (v4→v5 = YTD→1Y price window)', () => {
    expect(tickerChartCacheKey('NVDA', 'PE', false, 'regular')).toBe('NVDA|PE|v5|reg|regular');
  });
  it('PS rangeKey emits |PS|v3|', () => {
    // v1 -> v2 evicted the const-denominator P/S series (a 1:1
    // rescale of the price line); v2 -> v3 evicts the YTD-window
    // series after the ratio charts switched to a trailing-1Y price
    // window ("P/S YTD" → "P/S 1Y"), without waiting out the 12 h TTL.
    expect(tickerChartCacheKey('NBIS', 'PS', false, 'regular')).toBe('NBIS|PS|v3|reg|regular');
  });
  it('PE / PS share the variant + phase suffix shape (cross-toggle swap pattern)', () => {
    expect(tickerChartCacheKey('NVDA', 'PE', true,  'post')).toBe('NVDA|PE|v5|ext|post');
    expect(tickerChartCacheKey('NBIS', 'PS', true,  'post')).toBe('NBIS|PS|v3|ext|post');
  });
  it('non-ratio ranges leave the variant/phase off — same key across toggles', () => {
    expect(tickerChartCacheKey('NVDA', 'YTD', false, 'pre')).toBe('NVDA|YTD');
    expect(tickerChartCacheKey('NVDA', 'YTD', true,  'pre')).toBe('NVDA|YTD');
    // 1Y is a plain price range (modal-only) — same shape as YTD.
    expect(tickerChartCacheKey('NVDA', '1Y', false, 'pre')).toBe('NVDA|1Y');
  });
});

describe('isFresh', () => {
  it('rejects empty / missing / single-bar entries', () => {
    expect(isFresh(null, 1000)).toBe(false);
    expect(isFresh(undefined, 1000)).toBe(false);
    expect(isFresh({}, 1000)).toBe(false);
    expect(isFresh({ ts: Date.now(), data: [] }, 1000)).toBe(false);
    expect(isFresh({ ts: Date.now(), data: [{ x: 1 }] }, 1000)).toBe(false);
  });

  it('respects TTL', () => {
    const fresh = { ts: Date.now() - 1000, data: [1, 2] };
    const stale = { ts: Date.now() - 1000 * 1000, data: [1, 2] };
    expect(isFresh(fresh, 60_000)).toBe(true);
    expect(isFresh(stale, 60_000)).toBe(false);
  });

  it('honours an extra-validity predicate', () => {
    const entry = { ts: Date.now(), data: [{ close: 100 }, { close: 101 }] };
    expect(isFresh(entry, 60_000, hasAnyNumericField('volume'))).toBe(false);
    const entryWithVol = { ts: Date.now(), data: [{ close: 100 }, { close: 101, volume: 50 }] };
    expect(isFresh(entryWithVol, 60_000, hasAnyNumericField('volume'))).toBe(true);
  });

  it('exports a coherent RANGE_TTL_MS map', () => {
    expect(RANGE_TTL_MS['1D']).toBe(5 * 60 * 1000);
    expect(RANGE_TTL_MS['YTD']).toBe(12 * 60 * 60 * 1000);
    expect(RANGE_TTL_MS['1Y']).toBe(12 * 60 * 60 * 1000);
  });
});

describe('trimLru', () => {
  it('drops the oldest entries past the cap', () => {
    const store = {
      entries: {
        a: { ts: 100, data: [] },
        b: { ts: 200, data: [] },
        c: { ts: 300, data: [] },
        d: { ts: 50,  data: [] },
      },
    };
    trimLru(store, 2);
    // Keeps the two most-recent: c (300) and b (200).
    expect(Object.keys(store.entries).sort()).toEqual(['b', 'c']);
  });

  it('no-op when under the cap', () => {
    const store = { entries: { a: { ts: 100 }, b: { ts: 200 } } };
    trimLru(store, 5);
    expect(Object.keys(store.entries).sort()).toEqual(['a', 'b']);
  });

  it('tolerates undefined entries map', () => {
    const store = /** @type {any} */ ({});
    trimLru(store, 2);
    expect(store.entries).toEqual({});
  });
});
