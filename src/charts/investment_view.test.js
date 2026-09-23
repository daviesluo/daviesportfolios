import { describe, it, expect } from 'vitest';
import {
  niceStep, moneyTicks, fmtAxisMoney, fmtChipMoney, windowPct, provenanceSplitIndex,
} from './investment_view.js';

describe('niceStep', () => {
  it('rounds up to 1 / 2 / 2.5 / 5 times a power of ten', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(2.3)).toBe(2.5);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(3400)).toBe(5000);
    expect(niceStep(0)).toBe(1);
  });
});

describe('moneyTicks', () => {
  it('covers the range without forcing zero onto the axis', () => {
    // A $167k book against a $129k deposit line. Anchoring at $0 would
    // spend three quarters of the chart's height on empty space and
    // flatten both lines into the top edge.
    const ticks = moneyTicks(128000, 168000, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[0]).toBeGreaterThanOrEqual(128000);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(168000);
    expect(ticks).not.toContain(0);
  });

  it('handles a degenerate range without looping', () => {
    expect(moneyTicks(100, 100)).toEqual([100]);
    expect(moneyTicks(NaN, 5)).toEqual([]);
  });
});

describe('money formatting', () => {
  it('fmtAxisMoney is compact', () => {
    expect(fmtAxisMoney(167175)).toBe('$167k');
    expect(fmtAxisMoney(9500)).toBe('$9.5k');
    expect(fmtAxisMoney(950)).toBe('$950');
    expect(fmtAxisMoney(2_400_000)).toBe('$2.4M');
    expect(fmtAxisMoney(-1200)).toBe('-$1.2k');
  });

  it('fmtChipMoney is exact to the dollar', () => {
    expect(fmtChipMoney(167175.1067)).toBe('$167,175');
    expect(fmtChipMoney(-42.6)).toBe('-$43');
  });
});

describe('windowPct — what the legend reports for each line', () => {
  it('is the line\'s own move across the window it is drawn over', () => {
    expect(windowPct([{ v: 100 }, { v: 110 }])).toBeCloseTo(10, 9);
    expect(windowPct([{ v: 200 }, { v: 150 }])).toBeCloseTo(-25, 9);
  });

  it('declines rather than dividing by a zero start', () => {
    // A deposit line that starts at nothing — a percentage of zero
    // deposited is not a number anyone should be shown.
    expect(windowPct([{ v: 0 }, { v: 500 }])).toBe(null);
    expect(windowPct([{ v: 100 }])).toBe(null);
    expect(windowPct(/** @type {any} */ (null))).toBe(null);
  });
});

describe('provenanceSplitIndex — where recorded takes over from reconstructed', () => {
  const toMs = (d) => Date.parse(`${d}Z`);
  const series = [
    { date: '2026-08-18T10:00' },
    { date: '2026-08-18T11:00' },
    { date: '2026-08-18T12:00' },
  ];

  it('points at the first sample the recorder actually wrote', () => {
    expect(provenanceSplitIndex(series, Date.parse('2026-08-18T11:00Z'), toMs)).toBe(1);
  });

  it('-1 when nothing was recorded in the window', () => {
    expect(provenanceSplitIndex(series, null, toMs)).toBe(-1);
    expect(provenanceSplitIndex(series, Date.parse('2026-08-19T00:00Z'), toMs)).toBe(-1);
  });

  it('0 when the whole window is recorded — nothing to fade', () => {
    expect(provenanceSplitIndex(series, Date.parse('2026-08-01T00:00Z'), toMs)).toBe(0);
  });
});
