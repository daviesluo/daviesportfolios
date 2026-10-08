// @vitest-environment jsdom
// Davies, 2026-10-07: "在不开extended hours时只显示开盘后的，忽略了之前收盘到开盘时的变动，在这种情况下开始不需要从0%开始，
// 并且确保在盘中时和scoreboard里的实时变动一样". 24H with extended hours off is the latest regular session, measured
// from its previous close on both lines, on both tabs; extended hours on and every longer range are as they were.
//
// Closed form, Friday 2026-09-18 12:00 UTC (08:00 ET, before the open), so the latest session is Thursday's:
//
//   ACME 10 shares + $500 cash. Wednesday's close 220 (prevClose), Thursday's bars 230 / 225 / 238, close 240 (lastPrice)
//   book at the previous close  10 x 220 + 500 = 2700   (the scoreboard's DAY CHANGE basis)
//   Thursday 13:30   10 x 230 + 500 = 2800   -> +3.70 %   (the gap from Wednesday's close to the open)
//   Thursday 17:00   10 x 225 + 500 = 2750   -> +1.85 %
//   Thursday 19:55   10 x 240 + 500 = 2900   -> +7.41 %   (the last point, at the live price = DAY CHANGE)
//   ^GSPC previous close 5150 (the Market Conditions card's anchor); bars 5180 / 5100 / 5190, quote 5200
//                    +0.58 % / -0.97 % / +0.97 % (the last point is the card's price, so it reads the card's figure)
// Wednesday's bars are in the rows too (they keep five days now) and must not be drawn.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../prices/historical.js', async () => {
  const actual = await vi.importActual('../prices/historical.js');
  return {
    ...actual,
    fetchHistoricalBatch: vi.fn(() => Promise.resolve({})),
    fetchTodayRegularClose: vi.fn(() => Promise.resolve({})),
  };
});

vi.mock('../prices/chart_store.js', () => {
  /** @type {Map<string, any>} */
  const store = new Map();
  const empty = { get: () => null, set: () => {}, del: () => {}, keys: () => [], pruneOlderThan: () => {} };
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
    ChartStore: empty,
    MaStore: empty,
    chartStoresReady: () => true,
    hydrateAllChartStores: () => Promise.resolve(),
  };
});

vi.mock('../app/ops_error.js', () => ({ reportError: vi.fn() }));

import { PerfChart, perfSessionBasis, latestSessionBars, seedCut, _resetPerfSeedMemo } from './perf_chart.jsx';
import { applyVariantFilter, perfRowFilter, panelRangeLabel } from './ytd.js';
import { computeMetrics } from '../portfolio/metrics.js';
import { YtdStore } from '../prices/chart_store.js';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const Y = 2026;
const BOOK = {
  holdings: {
    ACME: {
      shares: 10, cost: 150, lastPrice: 240, prevClose: 220, dayPct: 9.09, currency: 'USD',
      lots: [{ date: `${Y}-01-02`, shares: 10, cost: 150 }],
    },
    CASH: { shares: 1, cost: 0, lastPrice: 500, dayPct: 0, isCash: true },
  },
  positions: { ST: { role: 'FWD', tickers: ['ACME', 'CASH'] } },
  depositFxRates: { USD: 1 },
};
const QUOTES = { '^GSPC': { lastPrice: 5200, prevClose: 5150, dayPct: 0.97 } };
const ROWS = {
  '^GSPC': [
    { date: '2026-09-16T13:30', close: 4900 }, { date: '2026-09-16T19:55', close: 5150 },
    { date: '2026-09-17T13:30', close: 5180 }, { date: '2026-09-17T17:00', close: 5100 },
    { date: '2026-09-17T19:55', close: 5190 },
  ],
  ACME: [
    { date: '2026-09-16T13:30', close: 190 }, { date: '2026-09-16T19:55', close: 220 },
    { date: '2026-09-17T13:30', close: 230 }, { date: '2026-09-17T17:00', close: 225 },
    { date: '2026-09-17T19:55', close: 238 },
  ],
  'ES=F': [
    { date: '2026-09-17T13:00', close: 5100 }, { date: '2026-09-17T20:00', close: 5150 },
    { date: '2026-09-18T11:55', close: 5202 },
  ],
};
/** @param {string} variant @param {string[]} symbols */
const seed = (variant, symbols) => {
  for (const s of symbols) {
    /** @type {any} */ (YtdStore)._testSeed(`y${Y}|1D:${variant}|${s}`, { ts: Date.now(), data: ROWS[s] });
  }
};
/** @param {Record<string, any>} [props] */
const chart = (props = {}) => (
  <PerfChart portfolio={BOOK} marketData={QUOTES} extendedHours={false} phase="premarket"
    rangeKey="1D" setRangeKey={() => {}} {...props} />
);
/** @param {Element} c */
const legend = (c) => Array.from(c.querySelectorAll('.perf-val')).map((e) => e.textContent);
/** @param {Element} c */
const pathsOf = (c) => Array.from(c.querySelectorAll('svg path[d^="M"]')).map((el) => el.getAttribute('d') || '');
/** @param {string} d */
const ysOf = (d) => d.replace('M', '').split('L').map((seg) => Number(seg.split(',')[1]));
/** A y on the chart's own scale as a %, read back from its printed % ticks. @param {Element} c @param {number} y */
const pctAt = (c, y) => {
  const ticks = Array.from(c.querySelectorAll('svg text'))
    .filter((t) => /^[+-]?\d+%$/.test(t.textContent || ''))
    .map((t) => ({ v: Number(String(t.textContent).replace('%', '')), y: Number(t.getAttribute('y')) }));
  const a = ticks[0], b = ticks[ticks.length - 1];
  return a.v + ((y - a.y) / (b.y - a.y)) * (b.v - a.v);
};

beforeEach(() => {
  /** @type {any} */ (YtdStore)._testClear();
  localStorage.clear();
  _resetPerfSeedMemo();
  cleanup();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => { vi.useRealTimers(); });

describe('PerfChart — 24H with extended hours off is the latest session, from its previous close', () => {
  it("the portfolio ends on the scoreboard's DAY CHANGE and the S&P on the Market Conditions card", () => {
    seed('closed', ['^GSPC', 'ACME']);
    const { container } = render(chart());
    // DAY CHANGE: (2900 - 2700) / 2700 = +7.41 %; the card: (5200 - 5150) / 5150 = +0.97 %.
    expect(legend(container)).toEqual(['+7.41%', '+0.97%']);
    // …and that IS the scoreboard's own figure for this book.
    const m = computeMetrics(BOOK, { extended: false, marketData: QUOTES });
    expect(m.dayPct.toFixed(2)).toBe('7.41');
  });

  it("draws Thursday's session alone, and its first point is the gap from Wednesday's close, not 0 %", () => {
    seed('closed', ['^GSPC', 'ACME']);
    const { container } = render(chart());
    const [sp, port] = pathsOf(container);
    expect(ysOf(port).length).toBe(3);
    expect(ysOf(sp).length).toBe(3);
    expect(pctAt(container, ysOf(port)[0])).toBeCloseTo(3.70, 1);
    expect(pctAt(container, ysOf(port)[1])).toBeCloseTo(1.85, 1);
    expect(pctAt(container, ysOf(sp)[0])).toBeCloseTo(0.58, 1);
    expect(pctAt(container, ysOf(sp)[1])).toBeCloseTo(-0.97, 1);
  });

  it('the INVESTMENT tab reads the value against the previous-close value, and the deposits as before', () => {
    seed('closed', ['^GSPC', 'ACME']);
    const { container } = render(chart({ view: 'investment' }));
    expect(legend(container)).toEqual(['+7.41%', '+0.00%']);
  });

  it("without the card's quote it draws the session rebased, both lines from 0 % together", () => {
    seed('closed', ['^GSPC', 'ACME']);
    const { container } = render(chart({ marketData: {} }));
    const [sp, port] = pathsOf(container);
    expect(Math.abs(ysOf(sp)[0] - ysOf(port)[0])).toBeLessThan(0.2);
  });

  it('extended hours on is as it was: the trailing 24 h on the futures, both lines from 0 % together', () => {
    seed('ext', ['ES=F', 'ACME']);
    const { container } = render(chart({ extendedHours: true }));
    expect(Array.from(container.querySelectorAll('.perf-lbl')).map((e) => e.textContent)).toEqual(['PORTFOLIO', 'S&P 500 FUTURES']);
    const [sp, port] = pathsOf(container);
    expect(Math.abs(ysOf(sp)[0] - ysOf(port)[0])).toBeLessThan(0.2);
    // ES=F 5100 -> 5202 over the window: +2.00 %.
    expect(legend(container)[1]).toBe('+2.00%');
  });
});

describe('the 24H ext-off rows and the seed', () => {
  it('perfRowFilter keeps the whole fetch on 24H with extended hours off, and trims everything else as before', () => {
    const now = Date.now();
    const bars = [90, 60, 30, 0].map((h) => ({ date: new Date(now - h * 3600_000).toISOString().slice(0, 16), close: h }));
    expect(perfRowFilter(bars, '1D', false, 'closed')).toEqual(bars);
    expect(perfRowFilter(bars, '1D', false, 'reg')).toEqual(bars);
    // Extended hours on in the session: the fetch's variant is `reg`, and the
    // window is still the trailing 24 h (found by the session matrix: five days
    // of futures read +8.85 % where +6.92 % was right).
    expect(perfRowFilter(bars, '1D', true, 'reg')).toEqual(applyVariantFilter(bars, 'reg'));
    expect(perfRowFilter(bars, '1D', true, 'reg').length).toBeLessThan(bars.length);
    expect(perfRowFilter(bars, '1D', true, 'ext')).toEqual(applyVariantFilter(bars, 'ext'));
    expect(perfRowFilter(bars, '1W', false, 'w1')).toEqual(applyVariantFilter(bars, 'w1'));
  });

  it('latestSessionBars keeps the last UTC day; perfSessionBasis is 24H with extended hours off only', () => {
    const bars = [{ date: '2026-09-16T19:55' }, { date: '2026-09-17T13:30' }, { date: '2026-09-17T19:55' }];
    expect(latestSessionBars(bars).map((b) => b.date)).toEqual(['2026-09-17T13:30', '2026-09-17T19:55']);
    expect(perfSessionBasis('1D', false)).toBe(true);
    expect(perfSessionBasis('1D', true)).toBe(false);
    expect(perfSessionBasis('1W', false)).toBe(false);
  });

  it('seedCut keeps the bars from the cut and the last one before it', () => {
    const bars = [{ date: '2026-09-15' }, { date: '2026-09-16T19:55' }, { date: '2026-09-17T13:30' }];
    expect(seedCut(bars, '2026-09-16T20:00').map((b) => b.date)).toEqual(['2026-09-16T19:55', '2026-09-17T13:30']);
    expect(seedCut(bars, '2026-09-18T00:00').map((b) => b.date)).toEqual(['2026-09-17T13:30']);
  });
});

// Davies, 2026-10-07: "24H改为1D吧，extended hours的那个实际就是24小时不用改".
describe('the shortest range button names what it shows', () => {
  it('reads 1D with extended hours off (the latest session) and 24H with them on (a trailing 24 hours)', () => {
    expect(panelRangeLabel('1D', false)).toBe('1D');
    expect(panelRangeLabel('1D', true)).toBe('24H');
    expect(['1W', '1M', '3M', 'YTD'].map((k) => [panelRangeLabel(k, false), panelRangeLabel(k, true)]))
      .toEqual([['1W', '1W'], ['1M', '1M'], ['3M', '3M'], ['YTD', 'YTD']]);
  });
});
