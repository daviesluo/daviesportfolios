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

  it('keeps Yahoo bars before the first recorded point, then the recorded line', () => {
    const out = mergeOvernightSeries(YAHOO, ON, ctx());
    expect(out).not.toBe(YAHOO);                 // merged → new ref
    expect(out.length).toBe(5);                  // 2 Yahoo (< 20:05) + 3 recorded
    expect(out.slice(-3)).toEqual(ON);
  });

  it('owns the overnight window even when Yahoo has its own late overnight bars (the NVDA/ORCL bug)', () => {
    // Yahoo returns sparse overnight prints for liquid names, so its
    // last bar is LATER than the recorded points. The old
    // `> lastBarDate` filter dropped nearly all recorded points → no
    // line (only a dot). Now the recorded series owns from its first
    // point and Yahoo's stray overnight bars are cut.
    const yahooWithOvernight = [
      PT('2026-05-28T19:55', 170),
      PT('2026-05-28T20:00', 171),
      PT('2026-05-28T20:10', 999),   // stray Yahoo overnight bar
      PT('2026-05-28T20:30', 998),   // last Yahoo bar is LATE
    ];
    const out = mergeOvernightSeries(yahooWithOvernight, ON, ctx());
    expect(out).not.toBe(yahooWithOvernight);
    expect(out.map((p) => p.date)).toEqual([
      '2026-05-28T19:55', '2026-05-28T20:00',
      '2026-05-28T20:05', '2026-05-28T20:10', '2026-05-28T20:15',
    ]);
    // 20:10 is the RECORDED value (173), not Yahoo's stray 999.
    expect(out.find((p) => p.date === '2026-05-28T20:10').close).toBe(173);
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

  it('falls back (no merge) with < 2 usable recorded points', () => {
    expect(mergeOvernightSeries(YAHOO, [ON[0]], ctx())).toBe(YAHOO);    // 1 point
    expect(mergeOvernightSeries(YAHOO, [], ctx())).toBe(YAHOO);          // 0 points
  });

  it('drops recorded points before the chart window (a prior session in the 26h fetch)', () => {
    // windowStart = YAHOO[0].date = 2026-05-28T19:55. A leftover point
    // from the previous night is before it and must not leak in.
    const withStale = [
      PT('2026-05-27T22:00', 100),   // prior session — before window → dropped
      ...ON,
    ];
    const out = mergeOvernightSeries(YAHOO, withStale, ctx());
    expect(out.length).toBe(5);                  // stale point excluded
    expect(out.find((p) => p.date === '2026-05-27T22:00')).toBeUndefined();
  });

  it('recorded points own from their first timestamp; overlapping Yahoo bars are cut', () => {
    const overlap = [
      PT('2026-05-28T19:55', 169),   // recorded points start here (== windowStart)
      PT('2026-05-28T20:00', 171),
      PT('2026-05-28T20:05', 172),
      PT('2026-05-28T20:10', 173),
    ];
    const out = mergeOvernightSeries(YAHOO, overlap, ctx());
    // firstRec = 19:55 → no Yahoo bar is < 19:55 → recorded owns the whole window.
    expect(out.length).toBe(4);
    expect(out).toEqual(overlap);
    expect(out[0].close).toBe(169);              // recorded value, not Yahoo's 170
  });

  it('handles null / empty series defensively', () => {
    expect(mergeOvernightSeries(null, ON, ctx())).toBe(null);
    expect(mergeOvernightSeries([], ON, ctx())).toEqual([]);
  });

  it('1W (barIntervalMs=30m) keeps every 6th 5-min point AND the live tail', () => {
    // 12 recorded 5-min points (1 h). Step = 30m / 5m = 6 → indices 0
    // and 6 land in `sampled`; the loop's next i (12) exits, so the
    // tail at index 11 is appended explicitly so the line still ends
    // at "now". Combined with the YAHOO fixture (first rec date equals
    // YAHOO[1].date) base = [YAHOO[0]], result = 4 points.
    const ON12 = Array.from({ length: 12 }, (_, i) =>
      PT(`2026-05-28T20:${String(i * 5).padStart(2, '0')}`, 170 + i));
    const out = mergeOvernightSeries(YAHOO, ON12, ctx({ rangeKey: '1W', barIntervalMs: 30 * 60_000 }));
    expect(out.length).toBe(4);
    expect(out[1]).toBe(ON12[0]);    // step-aligned
    expect(out[2]).toBe(ON12[6]);    // step-aligned
    expect(out[3]).toBe(ON12[11]);   // live tail preserved
  });

  it('1M (barIntervalMs=60m) keeps every 12th — and skips the tail-append when the tail is already step-aligned', () => {
    // 25 recorded points. Step = 60m / 5m = 12 → indices 0, 12, 24.
    // The tail (24) equals the last sampled index → no extra append.
    const ON25 = Array.from({ length: 25 }, (_, i) => {
      const hh = 20 + Math.floor((i * 5) / 60);
      const mm = (i * 5) % 60;
      return PT(`2026-05-28T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, 170 + i);
    });
    const out = mergeOvernightSeries(YAHOO, ON25, ctx({ rangeKey: '1M', barIntervalMs: 60 * 60_000 }));
    expect(out.length).toBe(4);
    expect(out[1]).toBe(ON25[0]);
    expect(out[2]).toBe(ON25[12]);
    expect(out[3]).toBe(ON25[24]);
  });

  it('treats missing barIntervalMs as 5 min (= step 1, no downsample) — keeps the legacy 1D behaviour', () => {
    const out = mergeOvernightSeries(YAHOO, ON, ctx());   // no barIntervalMs
    expect(out.length).toBe(5);
    expect(out.slice(-3)).toEqual(ON);                    // every rec point kept
  });
});
