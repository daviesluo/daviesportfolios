import { describe, it, expect } from 'vitest';
import {
  recordedBarDate, mergeRecordedBars, recordedFromMs, rangeStartMs, RANGE_BUCKET_SECONDS,
} from './price_snapshots.js';

describe('recordedBarDate — recorded bars must sort against fetched ones', () => {
  const ts = Date.parse('2026-08-18T14:35:00Z');
  it('intraday ranges use Yahoo\'s YYYY-MM-DDTHH:MM UTC form', () => {
    expect(recordedBarDate(ts, '1D')).toBe('2026-08-18T14:35');
    expect(recordedBarDate(ts, '1W')).toBe('2026-08-18T14:35');
    expect(recordedBarDate(ts, '1M')).toBe('2026-08-18T14:35');
  });
  it('daily ranges use YYYY-MM-DD', () => {
    // `closeOn` is a plain string comparison, so mixing a 16-char
    // recorded bar into a series of 10-char daily bars would sort it
    // after every same-day bar and break the lookup.
    expect(recordedBarDate(ts, '3M')).toBe('2026-08-18');
    expect(recordedBarDate(ts, 'YTD')).toBe('2026-08-18');
  });
});

describe('mergeRecordedBars', () => {
  /** @type {Array<{ts: string, prices: Record<string, number>}>} */
  const rows = [
    { ts: '2026-08-18T14:00:00Z', prices: { AAPL: 230, PVT: 12 } },
    { ts: '2026-08-18T14:05:00Z', prices: { AAPL: 231 } },
  ];

  it('adds recorded bars into the per-ticker history, in order', () => {
    const hist = { AAPL: [{ date: '2026-08-18T13:55', close: 229 }] };
    const out = mergeRecordedBars(hist, rows, '1D', 0);
    expect(out.AAPL.map(b => [b.date, b.close])).toEqual([
      ['2026-08-18T13:55', 229],
      ['2026-08-18T14:00', 230],
      ['2026-08-18T14:05', 231],
    ]);
  });

  it('gives a ticker Yahoo has no history for a series of its own', () => {
    // A CN fund or a `.PVT` holding: without recorded bars it sits flat
    // across the whole window because there is nothing to price it with.
    const out = mergeRecordedBars({}, rows, '1D', 0);
    expect(out.PVT).toEqual([{ date: '2026-08-18T14:00', close: 12 }]);
  });

  it('a recorded bar wins a tie with a fetched one', () => {
    // Ours is an observation of the tape; the vendor's can be revised
    // after the fact.
    const hist = { AAPL: [{ date: '2026-08-18T14:00', close: 999 }] };
    const out = mergeRecordedBars(hist, rows, '1D', 0);
    expect(out.AAPL[0]).toEqual({ date: '2026-08-18T14:00', close: 230 });
  });

  it('collapses a day to its LAST print on the daily ranges', () => {
    const out = mergeRecordedBars({}, rows, 'YTD', 0);
    expect(out.AAPL).toEqual([{ date: '2026-08-18', close: 231 }]);
  });

  it('drops samples older than the window, and never mutates the input', () => {
    const hist = { AAPL: [{ date: '2026-08-18T13:55', close: 229 }] };
    const frozen = JSON.stringify(hist);
    const out = mergeRecordedBars(hist, rows, '1D', Date.parse('2026-08-18T14:03:00Z'));
    expect(out.AAPL.map(b => b.date)).toEqual(['2026-08-18T13:55', '2026-08-18T14:05']);
    expect(JSON.stringify(hist)).toBe(frozen);
  });

  it('is a no-op for an empty read', () => {
    const hist = { AAPL: [] };
    expect(mergeRecordedBars(hist, [], '1D', 0)).toBe(hist);
    expect(mergeRecordedBars(hist, [{ ts: 'x', prices: {} }], '1D', 0)).toBe(hist);
  });

  it('ignores non-positive prices', () => {
    const out = mergeRecordedBars({}, [{ ts: '2026-08-18T14:00:00Z', prices: { A: 0, B: -1, C: 5 } }], '1D', 0);
    expect(Object.keys(out)).toEqual(['C']);
  });
});

describe('recordedFromMs', () => {
  it('is the earliest recorded sample — everything left of it is a reconstruction', () => {
    expect(recordedFromMs([
      { ts: '2026-08-18T14:05:00Z' },
      { ts: '2026-08-18T14:00:00Z' },
    ])).toBe(Date.parse('2026-08-18T14:00:00Z'));
    expect(recordedFromMs([])).toBe(null);
    expect(recordedFromMs(/** @type {any} */ (null))).toBe(null);
  });
});

describe('range windows', () => {
  it('reads at each range\'s own bar cadence', () => {
    // Asking for 5-minute rows over a YTD window would return ~60k of
    // them to draw a couple of hundred points with.
    expect(RANGE_BUCKET_SECONDS['1D']).toBe(300);
    expect(RANGE_BUCKET_SECONDS['YTD']).toBe(86400);
  });

  it('the shortest window is a trailing 24 h, and YTD starts at Jan 1', () => {
    const now = Date.UTC(2026, 7, 18, 12, 0, 0);
    expect(rangeStartMs('1D', now)).toBe(now - 24 * 3600 * 1000);
    expect(rangeStartMs('1W', now)).toBe(now - 7 * 24 * 3600 * 1000);
    expect(rangeStartMs('YTD', now)).toBe(Date.UTC(2026, 0, 1));
  });
});
