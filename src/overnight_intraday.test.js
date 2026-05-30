// Pins for the overnight intraday client layer: the cache round-trip,
// fetch-writes-cache + event, and the mergeOvernightSeries splice
// logic (the highest-risk part — it decides line-vs-dot and what gets
// appended to the Yahoo series).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchOvernightSeries,
  getOvernightSeries,
  mergeOvernightSeries,
  OVERNIGHT_FETCH_EVENT,
  _testHooks,
} from './overnight_intraday.js';

if (typeof globalThis.localStorage === 'undefined') {
  /** @type {Map<string,string>} */
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

const PT = (date, close) => ({ date, close, volume: 0 });

describe('fetchOvernightSeries — cache write + event', () => {
  it('writes the byTicker map to cache and returns it', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ NVDA: [PT('2026-05-29T01:00', 175)], AAPL: [PT('2026-05-29T01:00', 200)] }),
    });
    const out = await fetchOvernightSeries(['NVDA', 'AAPL'], /** @type {any} */ (mockFetch));
    expect(out?.NVDA?.[0].close).toBe(175);
    expect(getOvernightSeries('NVDA')).toEqual([PT('2026-05-29T01:00', 175)]);
    expect(getOvernightSeries('AAPL')).toEqual([PT('2026-05-29T01:00', 200)]);
  });

  it('returns null + leaves cache intact on a failed fetch', async () => {
    _testHooks.writeCache({ ts: 0, byTicker: { NVDA: [PT('2026-05-29T01:00', 99)] } });
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await fetchOvernightSeries(['NVDA'], /** @type {any} */ (mockFetch))).toBeNull();
    expect(getOvernightSeries('NVDA')).toEqual([PT('2026-05-29T01:00', 99)]);
  });

  it('no-ops (null) on an empty ticker list — no fetch call', async () => {
    const mockFetch = vi.fn();
    expect(await fetchOvernightSeries([], /** @type {any} */ (mockFetch))).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fires the OVERNIGHT_FETCH_EVENT on success', async () => {
    const handler = vi.fn();
    window.addEventListener(OVERNIGHT_FETCH_EVENT, handler);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ NVDA: [] }) });
    await fetchOvernightSeries(['NVDA'], /** @type {any} */ (mockFetch));
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(OVERNIGHT_FETCH_EVENT, handler);
  });
});

describe('getOvernightSeries — synchronous cache read', () => {
  it('returns [] for a missing ticker / cold cache', () => {
    expect(getOvernightSeries('NVDA')).toEqual([]);
  });
});

describe('mergeOvernightSeries — splice eligibility', () => {
  const YAHOO = [
    PT('2026-05-28T19:55', 170),   // last AH bar (≈ 15:55 ET... shape only)
    PT('2026-05-28T20:00', 171),   // 20:00 ET close = last Yahoo bar
  ];
  const ON = [
    PT('2026-05-28T20:05', 172),
    PT('2026-05-28T20:10', 173),
    PT('2026-05-28T20:15', 174),
  ];
  const ctx = (over = {}) => ({ rangeKey: '1D', useExt: true, phase: 'overnight', ticker: 'NVDA', ...over });

  it('appends overnight points after the last Yahoo bar when eligible', () => {
    const out = mergeOvernightSeries(YAHOO, ON, ctx());
    expect(out).not.toBe(YAHOO);                 // merged → new ref
    expect(out.length).toBe(5);
    expect(out.slice(-3)).toEqual(ON);
  });

  it('returns the SAME ref (no merge) when toggle off / not overnight / wrong range', () => {
    expect(mergeOvernightSeries(YAHOO, ON, ctx({ useExt: false }))).toBe(YAHOO);
    expect(mergeOvernightSeries(YAHOO, ON, ctx({ phase: 'afterhours' }))).toBe(YAHOO);
    expect(mergeOvernightSeries(YAHOO, ON, ctx({ rangeKey: '3M' })).length).toBe(YAHOO.length);
    expect(mergeOvernightSeries(YAHOO, ON, ctx({ rangeKey: '3M' }))).toBe(YAHOO);
  });

  it('does not merge for tickers without an overnight session (SFTBY, .L, index)', () => {
    expect(mergeOvernightSeries(YAHOO, ON, ctx({ ticker: 'SFTBY' }))).toBe(YAHOO);
    expect(mergeOvernightSeries(YAHOO, ON, ctx({ ticker: 'VUAA.L' }))).toBe(YAHOO);
    expect(mergeOvernightSeries(YAHOO, ON, ctx({ ticker: '^GSPC' }))).toBe(YAHOO);
  });

  it('falls back (no merge) with < 2 overnight points after the last bar', () => {
    expect(mergeOvernightSeries(YAHOO, [ON[0]], ctx())).toBe(YAHOO);    // 1 point
    expect(mergeOvernightSeries(YAHOO, [], ctx())).toBe(YAHOO);          // 0 points
  });

  it('only appends points strictly after the last Yahoo bar (drops overlap)', () => {
    const overlap = [
      PT('2026-05-28T19:55', 169),   // <= last Yahoo bar → dropped
      PT('2026-05-28T20:00', 171),   // == last Yahoo bar → dropped
      PT('2026-05-28T20:05', 172),
      PT('2026-05-28T20:10', 173),
    ];
    const out = mergeOvernightSeries(YAHOO, overlap, ctx());
    expect(out.length).toBe(4);                  // 2 Yahoo + 2 strictly-after
    expect(out.slice(-2).map((p) => p.date)).toEqual(['2026-05-28T20:05', '2026-05-28T20:10']);
  });

  it('handles null / empty series defensively', () => {
    expect(mergeOvernightSeries(null, ON, ctx())).toBe(null);
    expect(mergeOvernightSeries([], ON, ctx())).toEqual([]);
  });
});
