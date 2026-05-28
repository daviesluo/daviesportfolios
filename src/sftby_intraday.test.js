// Pins for the SFTBY client-side intraday recorder. Bucketing,
// session-window gate, and the read/write round-trip have to stay
// stable — the modal trusts the localStorage shape directly.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isSftbySessionOpen,
  recordSftbyTick,
  getSftbyIntradaySeries,
  mergeSftbyToday,
  _testHooks,
} from './sftby_intraday.js';

// Minimal localStorage shim for the node test runner (vitest doesn't
// expose `window` by default for plain `.js` test files).
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

// 2026-05-28 is a Thursday (per CLAUDE.md's currentDate context). BST,
// so UK 13:00 = 12:00 UTC, UK 21:00 = 20:00 UTC.
const THU_BST_NOON   = Date.UTC(2026, 4, 28, 12, 0, 0); // UK 13:00
const THU_BST_3PM    = Date.UTC(2026, 4, 28, 14, 0, 0); // UK 15:00
const THU_BST_855PM  = Date.UTC(2026, 4, 28, 19, 55, 0); // UK 20:55 (last bar)
const THU_BST_9PM    = Date.UTC(2026, 4, 28, 20, 0, 0); // UK 21:00 (closed)
const THU_BST_11AM   = Date.UTC(2026, 4, 28, 10, 0, 0); // UK 11:00 (closed)
const SAT_BST_3PM    = Date.UTC(2026, 4, 30, 14, 0, 0); // UK 15:00 Saturday

describe('isSftbySessionOpen — UK 13:00-21:00 Mon-Fri only', () => {
  it('open at 13:00 BST on a weekday', () => {
    expect(isSftbySessionOpen(new Date(THU_BST_NOON))).toBe(true);
  });
  it('open at 15:00 BST on a weekday', () => {
    expect(isSftbySessionOpen(new Date(THU_BST_3PM))).toBe(true);
  });
  it('open at 20:55 BST on a weekday', () => {
    expect(isSftbySessionOpen(new Date(THU_BST_855PM))).toBe(true);
  });
  it('closed at 21:00 BST exactly (window is hh < 21)', () => {
    expect(isSftbySessionOpen(new Date(THU_BST_9PM))).toBe(false);
  });
  it('closed at 11:00 BST (pre-session)', () => {
    expect(isSftbySessionOpen(new Date(THU_BST_11AM))).toBe(false);
  });
  it('closed on Saturday during the window', () => {
    expect(isSftbySessionOpen(new Date(SAT_BST_3PM))).toBe(false);
  });
});

describe('recordSftbyTick — bucketing + session gate', () => {
  it('appends a new point when no prior data exists', () => {
    recordSftbyTick(22.85, THU_BST_NOON);
    const series = getSftbyIntradaySeries();
    expect(series.length).toBe(1);
    expect(series[0].close).toBe(22.85);
  });

  it('overwrites within the same 5-min bucket (live price update)', () => {
    recordSftbyTick(22.85, THU_BST_NOON);
    recordSftbyTick(22.90, THU_BST_NOON + 30_000); // +30s, same bucket
    recordSftbyTick(22.95, THU_BST_NOON + 60_000); // +60s, same bucket
    const series = getSftbyIntradaySeries();
    expect(series.length).toBe(1);
    expect(series[0].close).toBe(22.95);
  });

  it('appends a new point when crossing a 5-min boundary', () => {
    recordSftbyTick(22.85, THU_BST_NOON);
    recordSftbyTick(22.92, THU_BST_NOON + 5 * 60_000); // next bucket
    const series = getSftbyIntradaySeries();
    expect(series.length).toBe(2);
    expect(series[0].close).toBe(22.85);
    expect(series[1].close).toBe(22.92);
  });

  it('no-op outside the SFTBY session window (pre-13:00, post-21:00, weekends)', () => {
    recordSftbyTick(22.85, THU_BST_11AM);
    recordSftbyTick(22.85, THU_BST_9PM);
    recordSftbyTick(22.85, SAT_BST_3PM);
    expect(getSftbyIntradaySeries().length).toBe(0);
  });

  it('no-op for non-positive or non-finite prices', () => {
    recordSftbyTick(0, THU_BST_NOON);
    recordSftbyTick(-1, THU_BST_NOON);
    recordSftbyTick(/** @type {any} */ (NaN), THU_BST_NOON);
    recordSftbyTick(/** @type {any} */ (Infinity), THU_BST_NOON);
    recordSftbyTick(/** @type {any} */ (null), THU_BST_NOON);
    recordSftbyTick(/** @type {any} */ (undefined), THU_BST_NOON);
    expect(getSftbyIntradaySeries().length).toBe(0);
  });

  it('prunes points older than ~26 hours so the array stays bounded', () => {
    // Seed with a fake-old point directly, then record a fresh one and
    // verify the old one was dropped on write.
    /** @type {any} */(globalThis).localStorage.setItem(
      _testHooks.STORAGE_KEY,
      JSON.stringify([{ time: THU_BST_NOON - 30 * 3_600_000, price: 9.99 }]),
    );
    recordSftbyTick(22.85, THU_BST_NOON);
    const stored = _testHooks.read();
    expect(stored.length).toBe(1);
    expect(stored[0].price).toBe(22.85);
  });
});

describe('getSftbyIntradaySeries — chart-shape adapter', () => {
  it('formats each point as {date: YYYY-MM-DDTHH:MM, close, volume:0}', () => {
    recordSftbyTick(22.85, THU_BST_NOON);
    const [pt] = getSftbyIntradaySeries();
    expect(pt.date).toBe('2026-05-28T12:00');
    expect(pt.close).toBe(22.85);
    expect(pt.volume).toBe(0);
  });

  it('returns [] when nothing has been recorded yet', () => {
    expect(getSftbyIntradaySeries()).toEqual([]);
  });
});

describe('mergeSftbyToday — multi-day series with synthetic today', () => {
  // Record three 5-min points spanning the early SFTBY session.
  function seedThreeBuckets() {
    recordSftbyTick(22.50, THU_BST_NOON);                  // 12:00 UTC
    recordSftbyTick(22.55, THU_BST_NOON + 5 * 60_000);     // 12:05 UTC
    recordSftbyTick(22.60, THU_BST_NOON + 10 * 60_000);    // 12:10 UTC
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
      { date: '2026-05-27T13:30', close: 21.00 },        // yesterday — kept
      { date: '2026-05-28T13:30', close: 23.00 },        // today — replaced
    ];
    const out = mergeSftbyToday(yahoo, '1W', '2026-05-28');
    // Three 5-min points → at 30-min granularity (factor=6) collapse to
    // one bar (the most recent close in the bucket).
    expect(out.length).toBe(2);
    expect(out[0].date).toBe('2026-05-27T13:30'); // yesterday survived
    expect(out[1].close).toBe(22.60);              // today = last synth close
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
    const outYTD = mergeSftbyToday(yahoo, 'YTD', '2026-05-28');
    expect(outYTD.length).toBe(2);
    expect(outYTD[1]).toEqual({ date: '2026-05-28', close: 22.60, volume: 0 });
  });

  it('returns the yahoo series untouched when no synthetic data for today', () => {
    // Nothing recorded → no substitution.
    const yahoo = [{ date: '2026-05-28T13:30', close: 23.00 }];
    expect(mergeSftbyToday(yahoo, '1W', '2026-05-28')).toEqual(yahoo);
  });
});
