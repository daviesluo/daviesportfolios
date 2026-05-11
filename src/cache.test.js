import { describe, it, expect } from 'vitest';
import { isFresh, hasAnyNumericField, trimLru, RANGE_TTL_MS } from './cache.js';

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
