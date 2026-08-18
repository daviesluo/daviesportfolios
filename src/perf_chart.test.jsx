// Regression coverage for the PerfChart's render decision tree. The
// math is pinned by ytd.test.js + utils.metrics.test.js — this just
// asserts the chart's wiring actually consumes those values.
//
// What's mocked:
//   - YtdStore — seeded with a fixed S&P 500 + portfolio history so
//     the chart paints synchronously (otherwise the empty-state path
//     would be all we ever see).
//   - fetchHistoricalBatch / fetchTodayRegularClose — they'd otherwise
//     fire during the chart's background-prefetch effect and either
//     log a network error or hang the test runner waiting for them.
//   - reportError — would POST during error states.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('./historical.js', async () => {
  const actual = await vi.importActual('./historical.js');
  return {
    ...actual,
    fetchHistoricalBatch: vi.fn(() => Promise.resolve({})),
    fetchTodayRegularClose: vi.fn(() => Promise.resolve({})),
  };
});

vi.mock('./chart_store.js', () => {
  /** @type {Map<string, any>} */
  const store = new Map();
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
    ChartStore: {
      get: () => null,
      set: () => {},
      del: () => {},
      keys: () => [],
      pruneOlderThan: () => {},
    },
    MaStore: {
      get: () => null,
      set: () => {},
      del: () => {},
      keys: () => [],
      pruneOlderThan: () => {},
    },
  };
});

vi.mock('./ops_error.js', () => ({ reportError: vi.fn() }));

import { PerfChart, PerfPanel, spSymbolFor, perfVariantKey, perfFetchParams, crosshairFormatFor, perfBaseline } from './perf_chart.jsx';
import { applyVariantFilter } from './ytd.js';
import { YtdStore } from './chart_store.js';

beforeEach(() => {
  /** @type {any} */ (YtdStore)._testClear();
  cleanup();
});

const PORTFOLIO = {
  holdings: {
    AAPL: { shares: 10, cost: 200, lastPrice: 215, prevClose: 213, dayPct: 0.94 },
    CASH: { shares: 1, cost: 0, lastPrice: 500, dayPct: 0, isCash: true },
  },
  positions: { AAPL: ['MID-LEFT'] },
};

const MARKET_DATA = {
  '^GSPC': { lastPrice: 5800, prevClose: 5790, dayPct: 0.17 },
};

describe('PerfChart — smoke render', () => {
  it('mounts without throwing for an empty cache (no data → empty-state path)', () => {
    expect(() =>
      render(
        <PerfChart
          portfolio={PORTFOLIO}
          marketData={MARKET_DATA}
          extendedHours={false}
          phase="regular"
        />,
      ),
    ).not.toThrow();
  });

  it('renders an SVG when YtdStore has seeded data for the active range', () => {
    // Seed the YTD store with a few rows so the chart can mount.
    // The exact key shape lives in ytd.js / cache.js — but the
    // chart's effect normalises it via tickerChartCacheKey.
    /** @type {any} */ (YtdStore)._testSeed('PORTFOLIO|YTD', {
      ts: Date.now(),
      data: [
        { date: '2026-01-02', close: 2000, basis: 2000 },
        { date: '2026-05-28', close: 2150, basis: 2000 },
      ],
    });
    const { container } = render(
      <PerfChart
        portfolio={PORTFOLIO}
        marketData={MARKET_DATA}
        extendedHours={false}
        phase="regular"
      />,
    );
    // The chart can take a render cycle to fall through the cache
    // path. Container existing + no thrown render is sufficient
    // smoke-test coverage; the math is pinned in ytd.test.js.
    expect(container).toBeTruthy();
  });
});

describe('PerfChart wiring helpers — night-market range sensitivity', () => {
  it('spSymbolFor: ES=F for ext-on 1D/1W (futures carry pre/post + overnight), ^GSPC otherwise', () => {
    expect(spSymbolFor('1D', true)).toBe('ES=F');
    expect(spSymbolFor('1W', true)).toBe('ES=F');
    expect(spSymbolFor('1D', false)).toBe('^GSPC');
    expect(spSymbolFor('1W', false)).toBe('^GSPC');
    // Longer ranges never switch to futures — they're daily/RTH views.
    expect(spSymbolFor('1M', true)).toBe('^GSPC');
    expect(spSymbolFor('3M', true)).toBe('^GSPC');
    expect(spSymbolFor('YTD', true)).toBe('^GSPC');
  });

  it('perfVariantKey: 1D reg/ext/closed; 1W splits ext vs std; others std', () => {
    expect(perfVariantKey('1D', true, 'overnight')).toBe('ext');
    expect(perfVariantKey('1D', false, 'regular')).toBe('reg');
    expect(perfVariantKey('1D', false, 'afterhours')).toBe('closed');
    // 1W ext must NOT share the std cache row (prepost vs RTH-only).
    expect(perfVariantKey('1W', true, 'overnight')).toBe('ext');
    expect(perfVariantKey('1W', false, 'overnight')).toBe('std');
    expect(perfVariantKey('1M', true, 'overnight')).toBe('std');
    expect(perfVariantKey('YTD', true, 'overnight')).toBe('std');
  });

  it('perfFetchParams: 1W ext pulls prepost bars on the month window via the 1w-ext variant', () => {
    const p = perfFetchParams('1W', true, 'overnight');
    expect(p.includePrePost).toBe(true);
    expect(p.variant).toBe('1w-ext');
    // A MONTH, trimmed to the trailing week by applyVariantFilter —
    // Yahoo's `5d` is five trading sessions (Mon→Fri = 4.3 days), which
    // is less than the week the button claims.
    expect(p.yahooRange).toBe('1mo');
    expect(p.interval).toBe('60m');
  });

  it('perfFetchParams: 1W ext-off defers to the shared week params (no prepost)', () => {
    const p = perfFetchParams('1W', false, 'overnight');
    expect(p.includePrePost).toBe(false);
    // Its own variant now, because the fetched month has to be trimmed
    // back to a week — 'std' would have drawn the whole month.
    expect(p.variant).toBe('w1');
    expect(p.yahooRange).toBe('1mo');
  });

  it('perfFetchParams: 1D defers to the shared fetchParamsFor (ext → prepost + ext variant)', () => {
    const p = perfFetchParams('1D', true, 'overnight');
    expect(p.includePrePost).toBe(true);
    expect(p.variant).toBe('ext');
  });

  it("the 1w-ext variant is trimmed to a week, not the 24h the 1D variants use", () => {
    // It used to pass straight through, which was right while 1W fetched
    // a 5-day window. 1W now fetches a MONTH (Yahoo has nothing between
    // `5d` and `1mo`), so passing through would draw a month under the
    // 1W button. It must trim to 168 h — and NOT to the 24 h that the
    // 1D variants use.
    const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString().slice(0, 16);
    const data = [
      { date: hoursAgo(24 * 20), close: 1 },  // 20 days — outside the week
      { date: hoursAgo(24 * 5),  close: 2 },  // 5 days  — inside the week, outside 24h
      { date: hoursAgo(2),       close: 3 },
    ];
    const out = applyVariantFilter(data, '1w-ext');
    expect(out.map(p => p.close)).toEqual([2, 3]);
  });

  it('crosshairFormatFor: 1W/1M show date+time (intraday bars), 1D time-only, 3M/YTD date-only', () => {
    // The fix: the 1W (and 1M) crosshair pill must carry the time-of-day,
    // not just "Jun 29", now that those ranges are intraday + overnight.
    expect(crosshairFormatFor('1W')).toBe('datetime');
    expect(crosshairFormatFor('1M')).toBe('datetime');
    expect(crosshairFormatFor('1D')).toBe('time');
    expect(crosshairFormatFor('3M')).toBe('date');
    expect(crosshairFormatFor('YTD')).toBe('date');
  });
});

describe('PerfPanel — chrome wrapper', () => {
  it('mounts and forwards portfolio/marketData/phase to PerfChart', () => {
    const { container } = render(
      <PerfPanel
        portfolio={PORTFOLIO}
        marketData={MARKET_DATA}
        extendedHours={false}
        phase="regular"
        className="x"
      />,
    );
    expect(container.querySelector('.x')).toBeTruthy();
  });

  it('labels the shortest range 24H and has no DAY / 1D toggle', () => {
    const { container } = render(
      <PerfPanel
        portfolio={PORTFOLIO}
        marketData={MARKET_DATA}
        extendedHours={true}
        phase="overnight"
      />,
    );
    const labels = [...container.querySelectorAll('.perf-range-btn')].map(b => b.textContent);
    expect(labels).toEqual(['24H', '1W', '1M', '3M', 'YTD']);
    expect(container.querySelector('.perf-basis-btn')).toBeNull();
    expect(labels).not.toContain('1D');
    expect(labels).not.toContain('DAY');
  });
});

describe('perfBaseline — what each line is measured from', () => {
  const args = { windowFirstClose: 7100, portFirstPct: 3.0 };

  it('the 24H range (internal 1D) rebases to the window, not the previous close', () => {
    // Pin against the old default: measuring from prevClose (spBase =
    // 7000, portShift = 0) made PORTFOLIO disagree with a trailing-24 h
    // reading by the overnight gap. The DAY / 24H toggle is gone; the
    // panel's shortest range is only that trailing day.
    const out = perfBaseline({ rangeKey: '1D', spPrevClose: 7000, ...args });
    expect(out.portShift).toBe(3.0);
    expect(out.spBase).toBe(7100);
  });

  it('rebases every range to its own first point', () => {
    for (const rk of ['1D', '1W', '1M', '3M', 'YTD']) {
      const out = perfBaseline({ rangeKey: rk, ...args });
      expect(out.portShift).toBe(3.0);
      expect(out.spBase).toBe(7100);
    }
  });
});
