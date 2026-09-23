import { describe, it, expect } from 'vitest';
import {
  recordedBarDate, mergeRecordedBars, recordedFromMs, rangeStartMs, RANGE_BUCKET_SECONDS,
} from './price_snapshots.js';
import { RANGES } from '../charts/ytd.js';

describe('recordedBarDate — recorded bars must sort against fetched ones', () => {
  const ts = Date.parse('2026-08-18T14:35:00Z');
  it('intraday ranges use Yahoo\'s YYYY-MM-DDTHH:MM UTC form', () => {
    expect(recordedBarDate(ts, '1D')).toBe('2026-08-18T14:35');
    expect(recordedBarDate(ts, '1W')).toBe('2026-08-18T14:30');
    expect(recordedBarDate(ts, '1M')).toBe('2026-08-18T14:00');
    expect(recordedBarDate(ts, '3M')).toBe('2026-08-18T14:35');
  });
  it('YTD uses YYYY-MM-DD', () => {
    // `closeOn` is a plain string comparison, so mixing a 16-char
    // recorded bar into a series of 10-char daily bars would sort it
    // after every same-day bar and break the lookup.
    expect(recordedBarDate(ts, 'YTD')).toBe('2026-08-18');
  });

  it('a drawn range snaps the sample onto its own bar grid', () => {
    // Yahoo labels a bar by its START and carries the price at its END,
    // and the last sample inside a bucket is exactly that price — so
    // flooring is the honest label, not a rounding convenience. It also
    // puts recorded bars on the same :00 / :15 / :30 / :45 instants
    // Yahoo's 15m bars use, instead of interleaving a second cadence.
    const at = (t) => Date.parse(`2026-09-17T${t}:00Z`);
    for (const [sample, bar] of [['13:30', '13:30'], ['13:40', '13:30'],
                                 ['13:44', '13:30'], ['13:45', '13:45']]) {
      expect(recordedBarDate(at(sample), '1W')).toBe(`2026-09-17T${bar}`);
    }
  });

  it('evens out the spacing the read bucket actually returns', () => {
    // These are the timestamps the live `price_snapshot_series(_, 900)`
    // RPC returned on 2026-09-18. The bucket guarantees one row per 15
    // minutes but hands it back at the moment it was WRITTEN, so a tick
    // near a boundary (or a missed one) drifts off the grid. That
    // raggedness is what showed on the 1W chart.
    const REAL = ['01:25', '01:30', '01:50', '02:05', '02:25', '02:40', '02:45',
                  '03:10', '03:25', '03:40', '03:55', '04:10', '04:25', '04:30'];
    const at = (t) => Date.parse(`2026-09-17T${t}:00Z`);
    const gaps = (list) => {
      const u = [...new Set(list)].sort((a, b) => a - b);
      return u.slice(1).map((v, i) => (v - u[i]) / 60_000);
    };
    // What the raw timestamps draw — the reported bug, verbatim.
    expect(gaps(REAL.map(at))).toEqual([5, 20, 15, 20, 15, 5, 25, 15, 15, 15, 15, 15, 5]);
    // What the snapped bars draw.
    const snapped = REAL.map(t => Date.parse(`${recordedBarDate(at(t), '1W')}:00Z`));
    expect(gaps(snapped)).toEqual([15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15]);
  });

  it('3M keeps the true instant, because its chart SAMPLES rather than draws', () => {
    // Its grid is `fourHourSlots` and `closeOn` reads a bar's date as
    // "the price at this moment". Flooring a 19:55 observation to a
    // 16:00 key would make it the 16:00 price — a four-hour lookahead.
    const t = Date.parse('2026-09-17T19:55:00Z');
    expect(recordedBarDate(t, '3M')).toBe('2026-09-17T19:55');
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
    expect(RANGE_BUCKET_SECONDS['1W']).toBe(900);
    expect(RANGE_BUCKET_SECONDS['1M']).toBe(3600);
    expect(RANGE_BUCKET_SECONDS['3M']).toBe(14400);
    expect(RANGE_BUCKET_SECONDS['YTD']).toBe(86400);
  });

  // The recorded stretch of a chart and its fetched stretch are the
  // same line, so a read bucket coarser than the bar interval draws the
  // left half at half the resolution of the right half and the seam
  // shows. 1W spent a while like that after moving to 15-minute bars.
  it('the minute-interval ranges derive their bucket from the interval', () => {
    for (const k of ['1D', '1W', '1M']) {
      const mins = Number(/^(\d+)m$/.exec(RANGES[k].interval)?.[1]);
      expect(RANGE_BUCKET_SECONDS[k]).toBe(mins * 60);
    }
  });

  it('the shortest window is a trailing 24 h, and YTD starts at Jan 1', () => {
    const now = Date.UTC(2026, 7, 18, 12, 0, 0);
    expect(rangeStartMs('1D', now)).toBe(now - 24 * 3600 * 1000);
    expect(rangeStartMs('1W', now)).toBe(now - 7 * 24 * 3600 * 1000);
    expect(rangeStartMs('YTD', now)).toBe(Date.UTC(2026, 0, 1));
  });
});
