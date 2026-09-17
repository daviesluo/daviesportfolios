// The per-bar portfolio build used to sit in PerfChart's render body: for
// every point on the window it calls `computeAt`, i.e. it values the
// whole book once per bar. On a 150-bar range one refresh tick re-ran
// 150 valuations four or five times, because the panel re-renders on the
// clock leaf, the flash set, hover state and the parent's own tick.
//
// The cache has to be a ref rather than a `useMemo`: the computation
// cannot run until after PerfChart's loading / error guards, and a hook
// placed after an early return is how this component shipped React error
// #310 once already. So the thing worth pinning is the observable
// behaviour — how many times the book gets valued — not the mechanism.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('./historical.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('./historical.js'));
  return { ...actual, fetchHistoricalBatch: vi.fn(async () => ({})) };
});
vi.mock('./chart_store.js', () => {
  /** @type {Map<string, any>} */
  const store = new Map();
  const noop = { get: () => null, set: () => {}, del: () => {}, keys: () => [], pruneOlderThan: () => {} };
  return {
    YtdStore: {
      get: (k) => store.get(k) ?? null,
      set: (k, v) => store.set(k, v),
      del: (k) => store.delete(k),
      keys: () => Array.from(store.keys()),
      pruneOlderThan: () => {},
      _testSeed: (k, v) => store.set(k, v),
      _testClear: () => store.clear(),
    },
    ChartStore: noop,
    MaStore: noop,
  };
});

vi.mock('./ops_error.js', () => ({ reportError: vi.fn() }));

// Count the valuations without changing any of them: the spy delegates
// to the real implementation, so every number this chart draws is still
// the production number.
const computeAtSpy = vi.fn();
vi.mock('./ytd.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('./ytd.js'));
  return {
    ...actual,
    computeAt: (/** @type {any} */ opts) => { computeAtSpy(); return actual.computeAt(opts); },
  };
});

import { PerfChart } from './perf_chart.jsx';
import { YtdStore } from './chart_store.js';

const YEAR = new Date().getFullYear();
const PORTFOLIO = {
  holdings: {
    AAPL: { shares: 10, cost: 200, lastPrice: 215, prevClose: 213, dayPct: 0.94 },
    CASH: { shares: 1, cost: 0, lastPrice: 500, dayPct: 0, isCash: true },
  },
  positions: { AAPL: ['MID-LEFT'] },
};
const MARKET_DATA = { '^GSPC': { lastPrice: 5100, prevClose: 4000, dayPct: 0.1 } };

const seed = () => {
  for (const [ticker, data] of Object.entries({
    AAPL: [
      { date: `${YEAR}-01-02`, close: 200 },
      { date: `${YEAR}-03-01`, close: 210 },
      { date: `${YEAR}-06-01`, close: 220 },
    ],
    '^GSPC': [
      { date: `${YEAR}-01-02`, close: 5000 },
      { date: `${YEAR}-03-01`, close: 5050 },
      { date: `${YEAR}-06-01`, close: 5100 },
    ],
  })) {
    /** @type {any} */ (YtdStore)._testSeed(`y${YEAR}|YTD:std|${ticker}`, { ts: Date.now(), data });
  }
};

const chart = (marketData = MARKET_DATA) => (
  <PerfChart
    portfolio={PORTFOLIO}
    marketData={marketData}
    extendedHours={false}
    phase="regular"
    rangeKey="YTD"
    setRangeKey={() => {}}
  />
);

describe('PerfChart — the book is valued once per data change, not once per render', () => {
  beforeEach(() => {
    /** @type {any} */ (YtdStore)._testClear();
    cleanup();
    computeAtSpy.mockClear();
  });

  it('re-rendering with the same inputs does not value the book again', () => {
    seed();
    const { rerender } = render(chart());
    const afterFirst = computeAtSpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Four more renders with byte-identical inputs — the shape of one
    // 30-second tick on this panel.
    for (let i = 0; i < 4; i++) rerender(chart());
    expect(computeAtSpy.mock.calls.length).toBe(afterFirst);
  });

  it('still re-values the book when the prices actually change', () => {
    // The other half: a cache that never invalidates is a staleness bug,
    // and this panel showing yesterday's book would be far worse than a
    // slow one.
    seed();
    const { rerender } = render(chart());
    const afterFirst = computeAtSpy.mock.calls.length;
    rerender(chart({ '^GSPC': { lastPrice: 5200, prevClose: 4000, dayPct: 0.2 } }));
    expect(computeAtSpy.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
