import { describe, it, expect } from 'vitest';
import { cleanLots, totalShares, weightedAvgCost } from './lots.js';

describe('cleanLots', () => {
  it('passes through valid lots and sorts ascending by date', () => {
    expect(cleanLots([
      { date: '2026-03-01', shares: 5,  cost: 100 },
      { date: '2026-01-15', shares: 10, cost:  90 },
    ])).toEqual([
      { date: '2026-01-15', shares: 10, cost:  90 },
      { date: '2026-03-01', shares:  5, cost: 100 },
    ]);
  });

  it('coerces string inputs to finite numbers', () => {
    expect(cleanLots([{ date: '2026-01-15', shares: '10', cost: '90.5' }]))
      .toEqual([{ date: '2026-01-15', shares: 10, cost: 90.5 }]);
  });

  it('rejects shares ≤ 0 (zero shares = no holding)', () => {
    expect(cleanLots([
      { date: '2026-01-15', shares: 0,    cost: 100 },
      { date: '2026-01-16', shares: -5,   cost: 100 },
    ])).toEqual([]);
  });

  it('rejects negative cost (data corruption — was silently kept)', () => {
    // `Number("-50") || 0` evaluates to -50, not 0 — the previous
    // inline `Number(l.cost) || 0` let -50 through unchanged.
    expect(cleanLots([{ date: '2026-01-15', shares: 10, cost: -50 }])).toEqual([]);
  });

  it('allows cost = 0 (gifts / spinoffs / cost-basis-unknown lots)', () => {
    expect(cleanLots([{ date: '2026-01-15', shares: 10, cost: 0 }]))
      .toEqual([{ date: '2026-01-15', shares: 10, cost: 0 }]);
  });

  it('rejects NaN / Infinity / non-numeric inputs', () => {
    expect(cleanLots([
      { date: '2026-01-15', shares: NaN,         cost: 100 },
      { date: '2026-01-15', shares: 'abc',       cost: 100 },
      { date: '2026-01-15', shares: 10,          cost: NaN },
      { date: '2026-01-15', shares: Infinity,    cost: 100 },
      { date: '2026-01-15', shares: 10,          cost: Infinity },
    ])).toEqual([]);
  });

  it('rejects empty / malformed dates (must be YYYY-MM-DD)', () => {
    expect(cleanLots([
      { date: '',           shares: 10, cost: 100 },
      { date: '2026-1-15',  shares: 10, cost: 100 },  // missing zero pad
      { date: 'yesterday',  shares: 10, cost: 100 },
      { shares: 10, cost: 100 },                       // no date at all
    ])).toEqual([]);
  });

  it('non-array input → []', () => {
    expect(cleanLots(/** @type {any} */ (null))).toEqual([]);
    expect(cleanLots(/** @type {any} */ ('not-a-list'))).toEqual([]);
  });

  it('returns a fresh sorted copy — does not mutate the input', () => {
    const input = [
      { date: '2026-03-01', shares: 5, cost: 100 },
      { date: '2026-01-15', shares: 10, cost:  90 },
    ];
    const before = JSON.stringify(input);
    cleanLots(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('totalShares', () => {
  it('sums clean lot shares', () => {
    expect(totalShares([{ shares: 10 }, { shares: 5 }])).toBe(15);
  });

  it('empty → 0', () => {
    expect(totalShares([])).toBe(0);
  });
});

describe('weightedAvgCost', () => {
  it('share-weighted average of cost basis', () => {
    // (10 × 90 + 5 × 100) / 15 = 1400 / 15 = 93.333...
    expect(weightedAvgCost([
      { shares: 10, cost:  90 },
      { shares:  5, cost: 100 },
    ])).toBeCloseTo(1400 / 15, 6);
  });

  it('single lot — AC = cost', () => {
    expect(weightedAvgCost([{ shares: 10, cost: 100 }])).toBe(100);
  });

  it('no lots / zero shares → 0 (avoids /0 NaN)', () => {
    expect(weightedAvgCost([])).toBe(0);
  });
});
