// Pin tests for portfolioUserFingerprint. The fingerprint is what
// the auto-save debounce uses to decide "did the user actually edit
// something?" — if it ever stops being stable across price refreshes
// or starts mis-detecting an edit as a no-op, we re-introduce the
// multi-tab silent-overwrite bug from the session that added this
// helper. Each `it` corresponds to one failure mode.

import { describe, it, expect } from 'vitest';
import { portfolioUserFingerprint } from './portfolio_remote.js';

const baseHolding = (over = {}) => ({
  shares: 10,
  cost: 100,
  currency: 'USD',
  lastPrice: 105,
  prevClose: 104,
  dayPct: 0.96,
  extPrice: 105.2,
  extDayPct: 0.19,
  lots: [{ date: '2025-01-01', shares: 10, cost: 100 }],
  ...over,
});

const basePortfolio = (over = {}) => ({
  positions: {
    GK: { role: 'GK', label: 'Cash', subtitle: '', tickers: ['CASH'] },
    ST: { role: 'FWD', label: 'Striker', subtitle: 'Growth', tickers: ['NVDA', 'AAPL'] },
  },
  holdings: {
    CASH: { ...baseHolding({ isCash: true, shares: 0, cost: 0, lots: [] }), currency: 'USD' },
    NVDA: baseHolding({ shares: 5, cost: 100 }),
    AAPL: baseHolding({ shares: 2, cost: 150 }),
  },
  ...over,
});

describe('portfolioUserFingerprint', () => {
  it('returns "" on null / non-object / missing-keys inputs', () => {
    expect(portfolioUserFingerprint(null)).toBe('');
    expect(portfolioUserFingerprint(undefined)).toBe('');
    expect(portfolioUserFingerprint(/** @type {any} */ ('junk'))).toBe('');
    expect(portfolioUserFingerprint(/** @type {any} */ ({}))).toBe('');
    expect(portfolioUserFingerprint(/** @type {any} */ ({ positions: {} }))).toBe('');
  });

  it('produces identical output for two structurally-equal portfolios', () => {
    const a = basePortfolio();
    const b = basePortfolio();
    expect(portfolioUserFingerprint(a)).toBe(portfolioUserFingerprint(b));
  });

  it('IGNORES every field the price-refresh loop mutates (this is the load-bearing case)', () => {
    // The bug this guards against: backgrounded Tab B's 30 s refresh
    // mutates lastPrice / prevClose / extPrice / dayPct / extDayPct
    // and would otherwise look like an "edit" to the debounced save
    // effect — triggering a write that overwrites Tab A's actual
    // edit. None of those fields should appear in the fingerprint.
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = /** @type {any} */ ({
      ...after.holdings.NVDA,
      lastPrice: 999,
      prevClose: 888,
      extPrice: 777,
      dayPct: -5,
      extDayPct: -2,
      todayRegularClose: 666,
    });
    expect(portfolioUserFingerprint(before)).toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when the user edits shares', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = { ...after.holdings.NVDA, shares: 6 };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when the user edits cost', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = { ...after.holdings.NVDA, cost: 101 };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when the user edits a lot', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = {
      ...after.holdings.NVDA,
      lots: [{ date: '2025-06-01', shares: 5, cost: 110 }],
    };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when the user adds a new lot', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = {
      ...after.holdings.NVDA,
      lots: [
        ...after.holdings.NVDA.lots,
        { date: '2025-06-01', shares: 3, cost: 120 },
      ],
    };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when a ticker is dragged between positions', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.positions = {
      ...after.positions,
      GK: { ...after.positions.GK, tickers: [...after.positions.GK.tickers, 'NVDA'] },
      ST: { ...after.positions.ST, tickers: ['AAPL'] },
    };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when a position subtitle is renamed', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.positions = {
      ...after.positions,
      ST: { ...after.positions.ST, subtitle: 'Speculative' },
    };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when a holding is added', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings = { ...after.holdings, GOOG: baseHolding({ shares: 1, cost: 180 }) };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when a holding is removed', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    const { NVDA: _drop, ...rest } = after.holdings;
    after.holdings = /** @type {any} */ (rest);
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('is stable across insertion-order shuffles (sort-keys invariance)', () => {
    const a = basePortfolio();
    const b = { ...a };
    // Reorder positions / holdings object keys — Object.keys preserves
    // insertion order, so a naïve JSON.stringify-based fingerprint would
    // diverge. Sorted-keys serialisation in portfolioUserFingerprint
    // protects against that.
    b.positions = { ST: a.positions.ST, GK: a.positions.GK };
    b.holdings = { AAPL: a.holdings.AAPL, NVDA: a.holdings.NVDA, CASH: a.holdings.CASH };
    expect(portfolioUserFingerprint(a)).toBe(portfolioUserFingerprint(b));
  });

  it('is stable across ticker-array shuffles within a position', () => {
    const a = basePortfolio();
    const b = basePortfolio();
    b.positions.ST = { ...b.positions.ST, tickers: ['AAPL', 'NVDA'] }; // a is ['NVDA','AAPL']
    expect(portfolioUserFingerprint(a)).toBe(portfolioUserFingerprint(b));
  });
});
