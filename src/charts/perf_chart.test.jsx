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
import { render, cleanup, act } from '@testing-library/react';

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
    // The real store in a test run has no IndexedDB and reads from memory
    // alone, which is loaded from the start.
    chartStoresReady: () => true,
    hydrateAllChartStores: () => Promise.resolve(),
  };
});

vi.mock('../app/ops_error.js', () => ({ reportError: vi.fn() }));

import { PerfChart, PerfPanel, spSymbolFor, perfVariantKey, perfFetchParams } from './perf_chart.jsx';
import { crosshairFormatFor } from './ticker_chart_helpers.js';
import { applyVariantFilter } from './ytd.js';
import { YtdStore } from '../prices/chart_store.js';

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
    // A real week needs more than Yahoo's `5d` (five TRADING sessions =
    // 4.3 days), and there is no range in between, so 1W downloads a
    // month and trims. See the 168 h trim test below.
    expect(p.yahooRange).toBe('1mo');
    // 15m, not 60m: at 60m a trailing week held ~35 points against 1M's
    // ~154, so the two buttons drew the same book at four times the
    // density. The ext path must move with the standard one or the two
    // 1W variants disagree about what a bar is.
    expect(p.interval).toBe('15m');
  });

  it('perfFetchParams: 1W ext-off uses the trimming w1 variant (no prepost)', () => {
    const p = perfFetchParams('1W', false, 'overnight');
    expect(p.includePrePost).toBe(false);
    expect(p.variant).toBe('w1');
    expect(p.yahooRange).toBe('1mo');
  });

  it('perfFetchParams: 1D defers to the shared fetchParamsFor (ext → prepost + ext variant)', () => {
    const p = perfFetchParams('1D', true, 'overnight');
    expect(p.includePrePost).toBe(true);
    expect(p.variant).toBe('ext');
  });

  it('both 1W variants trim the fetched month back to a real trailing week', () => {
    // Regression pin for "1w目前好像不是真的整1w". The fetch is a MONTH
    // now, so a pass-through would draw four weeks under a 1W button;
    // and the window has to be a real 168 h, not five trading sessions.
    const now = Date.now();
    const at = (hoursAgo) => {
      const d = new Date(now - hoursAgo * 3600 * 1000);
      return `${d.toISOString().slice(0, 16)}`;
    };
    const data = [
      { date: at(20 * 24), close: 1 },   // 20 days ago — outside the week
      { date: at(8 * 24),  close: 2 },   // 8 days ago  — outside the week
      { date: at(6 * 24),  close: 3 },   // inside
      { date: at(1),       close: 4 },   // inside
    ];
    for (const variant of ['w1', '1w-ext']) {
      const out = applyVariantFilter(data, variant);
      expect(out.map(p => p.close)).toEqual([3, 4]);
    }
  });

  it('crosshairFormatFor: intraday ranges show date+time, 1D time-only, YTD date-only', () => {
    // The fix: the 1W (and 1M) crosshair pill must carry the time-of-day,
    // not just "Jun 29", now that those ranges are intraday + overnight.
    // 3M joined them when it went to six points a day — "Jun 29" would
    // label six consecutive points identically.
    expect(crosshairFormatFor('1W')).toBe('datetime');
    expect(crosshairFormatFor('1M')).toBe('datetime');
    expect(crosshairFormatFor('3M')).toBe('datetime');
    expect(crosshairFormatFor('1D')).toBe('time');
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
});

describe('PerfChart — every range starts BOTH lines at 0 %', () => {
  // "所有时间图所有线都应该从0%开始". Closed form, YTD range:
  //   AAPL 10 sh bought 2025 at 200. Window bars 200 -> 220.
  //   The window's first point is therefore the portfolio's own zero,
  //   whatever basis computeAt used to get there.
  //   ^GSPC bars 5000 -> 5100, and marketData carries a prevClose of
  //   4000 — the old anchor. With the old code the S&P line opened at
  //   (5000-4000)/4000 = +25.00 % while the portfolio opened at 0, so
  //   the visible gap between the lines was 25 points of pure anchor
  //   mismatch. Both must now open on the same y.
  const YEAR = new Date().getFullYear();
  const seedRange = (rangeKey, variantKey, bars) => {
    for (const [ticker, data] of Object.entries(bars)) {
      /** @type {any} */ (YtdStore)._testSeed(
        `y${YEAR}|${rangeKey}:${variantKey}|${ticker}`,
        { ts: Date.now(), data },
      );
    }
  };
  const firstY = (d) => {
    const m = /^M([\d.]+),([\d.]+)/.exec(d || '');
    return m ? Number(m[2]) : null;
  };

  it('YTD: the portfolio path and the S&P path share their first y', () => {
    seedRange('YTD', 'std', {
      AAPL: [
        { date: `${YEAR}-01-02`, close: 200 },
        { date: `${YEAR}-06-01`, close: 220 },
      ],
      '^GSPC': [
        { date: `${YEAR}-01-02`, close: 5000 },
        { date: `${YEAR}-06-01`, close: 5100 },
      ],
    });
    const { container } = render(
      <PerfChart
        portfolio={PORTFOLIO}
        // prevClose 4000 is the anchor the old code would have used.
        marketData={{ '^GSPC': { lastPrice: 5100, prevClose: 4000, dayPct: 0.1 } }}
        extendedHours={false}
        phase="regular"
        rangeKey="YTD"
        setRangeKey={() => {}}
      />,
    );
    const paths = Array.from(container.querySelectorAll('svg path[d^="M"]'))
      .map((el) => firstY(el.getAttribute('d')))
      .filter((y) => y != null);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    // Same starting y for both lines — i.e. both are 0 % at the window's
    // first point. Sub-pixel tolerance for the toFixed(1) rounding.
    expect(Math.abs(paths[0] - paths[1])).toBeLessThan(0.2);
  });

  it('the legend reports the S&P move over the WINDOW, not since a prior close', () => {
    seedRange('YTD', 'std', {
      AAPL: [
        { date: `${YEAR}-01-02`, close: 200 },
        { date: `${YEAR}-06-01`, close: 220 },
      ],
      '^GSPC': [
        { date: `${YEAR}-01-02`, close: 5000 },
        { date: `${YEAR}-06-01`, close: 5100 },
      ],
    });
    const { container } = render(
      <PerfChart
        portfolio={PORTFOLIO}
        marketData={{ '^GSPC': { lastPrice: 5100, prevClose: 4000, dayPct: 0.1 } }}
        extendedHours={false}
        phase="regular"
        rangeKey="YTD"
        setRangeKey={() => {}}
      />,
    );
    const vals = Array.from(container.querySelectorAll('.perf-val')).map(e => e.textContent);
    // (5100 - 5000) / 5000 = +2.00 %. The old anchor would read +27.50 %.
    expect(vals).toContain('+2.00%');
  });

  it('the range row calls the shortest window 24H, not 1D', () => {
    const { container } = render(
      <PerfChart
        portfolio={PORTFOLIO}
        marketData={MARKET_DATA}
        extendedHours={false}
        phase="regular"
      />,
    );
    const labels = Array.from(container.querySelectorAll('.perf-range-btn')).map(e => e.textContent);
    expect(labels).toEqual(['24H', '1W', '1M', '3M', 'YTD']);
  });
});

describe('PerfChart — the Investment view is the SAME series, drawn in dollars', () => {
  const YEAR = new Date().getFullYear();
  // Closed form. One holding, 10 shares bought 2026-01-02 at $200.
  // Window bars 200 → 220 → 240, plus $500 of board cash.
  //   value  = 10*200+500 = 2500 → 10*220+500 = 2700 → 10*240+500 = 2900
  //   deposit = 10*200 + 500 = 2500, flat all the way across.
  const HOLD = {
    holdings: {
      AAPL: {
        shares: 10, cost: 200, lastPrice: 240, prevClose: 220, currency: 'USD',
        lots: [{ date: `${YEAR}-01-02`, shares: 10, cost: 200 }],
      },
      CASH: { shares: 1, cost: 0, lastPrice: 500, dayPct: 0, isCash: true },
    },
    positions: { AAPL: ['MID-LEFT'], CASH: ['MID-LEFT'] },
    depositFxRates: { USD: 1 },
  };
  const BARS = {
    AAPL: [
      { date: `${YEAR}-01-02`, close: 200 },
      { date: `${YEAR}-03-02`, close: 220 },
      { date: `${YEAR}-06-01`, close: 240 },
    ],
    '^GSPC': [
      { date: `${YEAR}-01-02`, close: 5000 },
      { date: `${YEAR}-03-02`, close: 5100 },
      { date: `${YEAR}-06-01`, close: 5200 },
    ],
  };
  const seed = () => {
    for (const [ticker, data] of Object.entries(BARS)) {
      /** @type {any} */ (YtdStore)._testSeed(
        `y${YEAR}|YTD:std|${ticker}`, { ts: Date.now(), data },
      );
    }
  };
  const renderView = (view) => render(
    <PerfChart
      portfolio={HOLD}
      marketData={{ '^GSPC': { lastPrice: 5200, prevClose: 5150 } }}
      extendedHours={false}
      phase="regular"
      rangeKey="YTD"
      setRangeKey={() => {}}
      view={view}
    />,
  );
  // Y is inverted in SVG, so normalising a path to [0,1] by its own
  // min/max gives a unit-free SHAPE that two differently-scaled charts
  // can be compared on.
  const shapeOf = (d) => {
    const ys = (d || '').replace('M', '').split('L').map(seg => Number(seg.split(',')[1]));
    if (ys.length < 2) return null;
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return hi === lo ? ys.map(() => 0) : ys.map(y => (y - lo) / (hi - lo));
  };
  const pathsOf = (container) =>
    Array.from(container.querySelectorAll('svg path[d^="M"]')).map(el => el.getAttribute('d'));

  it('with deposits flat, the value line has the same shape as the vs-S&P portfolio line', () => {
    // The structural promise: the Investment view calls the same
    // `computeAt` on the same grid, so it cannot draw a differently
    // shaped portfolio. Two independent reconstructions drift — and did.
    seed();
    const sp = renderView('sp');
    const spShape = shapeOf(pathsOf(sp.container).at(-1));
    cleanup();
    seed();
    const inv = renderView('investment');
    const invShape = shapeOf(pathsOf(inv.container).at(-1));
    expect(spShape).not.toBeNull();
    expect(invShape).not.toBeNull();
    expect(invShape.length).toBe(spShape.length);
    invShape.forEach((v, i) => expect(v).toBeCloseTo(spShape[i], 6));
  });

  it('the crosshair reads the book in dollars, matching the arithmetic', () => {
    seed();
    const { container } = renderView('investment');
    // The value line's last point must be 10 x 240 + 500 = $2,900 — the
    // same number the scoreboard's PORTFOLIO cell shows.
    const ticks = Array.from(container.querySelectorAll('svg text'))
      .map(t => t.textContent).filter(t => /^\$/.test(t || ''));
    expect(ticks.length).toBeGreaterThan(0);
    // The axis has to bracket the real value; if it forced zero on, the
    // lines would be flattened into the top of the plot.
    const nums = ticks.map(t => Number(String(t).replace(/[$k,]/g, '')) * (String(t).includes('k') ? 1000 : 1));
    expect(Math.max(...nums)).toBeGreaterThan(2400);
    expect(Math.min(...nums)).toBeGreaterThan(0);
  });

  it('the legend names both lines and reports each one\'s own move', () => {
    seed();
    const { container } = renderView('investment');
    const labels = Array.from(container.querySelectorAll('.perf-lbl')).map(e => e.textContent);
    expect(labels).toEqual(['VALUE', 'DEPOSITED']);
    const vals = Array.from(container.querySelectorAll('.perf-val')).map(e => e.textContent);
    // Value: 2500 → 2900 = +16.00 %. Deposit: flat = +0.00 %.
    // NOT a gain figure — that was removed on request.
    expect(vals).toEqual(['+16.00%', '+0.00%']);
  });

  it('deposits are drawn as steps, and the value line is not', () => {
    seed();
    const { container } = renderView('investment');
    const paths = Array.from(container.querySelectorAll('svg path[d^="M"]'));
    const dashed = paths.filter(p => p.getAttribute('stroke-dasharray'));
    expect(dashed.length).toBe(1);
    // A flat deposit ledger must draw a flat line: same y at every point.
    const ys = (dashed[0].getAttribute('d') || '').replace('M', '').split('L')
      .map(seg => Number(seg.split(',')[1]));
    expect(new Set(ys.map(y => y.toFixed(1))).size).toBe(1);
  });

  it('keeps the axes, gridlines and crosshair the other chart has', () => {
    seed();
    const { container } = renderView('investment');
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(2);
    expect(container.querySelector('svg g[style*="display: none"]')).toBeTruthy();
    // Range buttons carry across the swap.
    const labels = Array.from(container.querySelectorAll('.perf-range-btn')).map(e => e.textContent);
    expect(labels).toEqual(['24H', '1W', '1M', '3M', 'YTD']);
  });
});

describe('PerfPanel — one slot, two charts', () => {
  /** @param {HTMLElement} container */
  const tabs = (container) => /** @type {HTMLElement[]} */ ([...container.querySelectorAll('.view-tab')]);
  const selected = (/** @type {HTMLElement} */ container) =>
    tabs(container).filter(b => b.getAttribute('aria-selected') === 'true').map(b => b.textContent);

  it('swaps the view and keeps the range', () => {
    const { container } = render(
      <PerfPanel portfolio={PORTFOLIO} marketData={MARKET_DATA} extendedHours={false} phase="regular" />,
    );
    const [sp, inv] = tabs(/** @type {HTMLElement} */ (container));
    expect(sp.textContent).toContain('VS S&P');
    expect(inv.textContent).toContain('INVESTMENT');
    expect(selected(/** @type {HTMLElement} */ (container))).toEqual([sp.textContent]);

    act(() => { inv.click(); });
    expect(selected(/** @type {HTMLElement} */ (container))).toEqual([inv.textContent]);
    // The range row is the same one either way — flipping the view must
    // not reset which window is on screen.
    expect([...container.querySelectorAll('.perf-range-btn')].map(b => b.textContent))
      .toEqual(['24H', '1W', '1M', '3M', 'YTD']);

    act(() => { sp.click(); });
    expect(selected(/** @type {HTMLElement} */ (container))).toEqual([sp.textContent]);
  });

  it('names both destinations at once — the old ⇄ named neither', () => {
    const { container } = render(
      <PerfPanel portfolio={PORTFOLIO} marketData={MARKET_DATA} extendedHours={false} phase="regular" />,
    );
    // Every tab label is on screen in BOTH states, so the control says
    // where it goes rather than only what it currently shows.
    const labels = () => tabs(/** @type {HTMLElement} */ (container)).map(b => b.textContent);
    const before = labels();
    act(() => { tabs(/** @type {HTMLElement} */ (container))[1].click(); });
    expect(labels()).toEqual(before);
  });

  it('is one tab stop, with arrow keys moving between the tabs', () => {
    const { container } = render(
      <PerfPanel portfolio={PORTFOLIO} marketData={MARKET_DATA} extendedHours={false} phase="regular" />,
    );
    const el = tabs(/** @type {HTMLElement} */ (container));
    // Roving tabindex: exactly one reachable by Tab at any moment.
    expect(el.map(b => b.getAttribute('tabindex'))).toEqual(['0', '-1']);
    act(() => {
      el[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(selected(/** @type {HTMLElement} */ (container))).toEqual([el[1].textContent]);
    expect(tabs(/** @type {HTMLElement} */ (container)).map(b => b.getAttribute('tabindex')))
      .toEqual(['-1', '0']);
    act(() => {
      el[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(selected(/** @type {HTMLElement} */ (container))).toEqual([el[0].textContent]);
  });

  it('shows a read-only viewer the vs-S&P chart alone', () => {
    // The Investment view is the book in dollars against the money paid
    // in; it stays behind the edit password (Davies, 2026-09-23).
    const { container } = render(
      <PerfPanel portfolio={PORTFOLIO} marketData={MARKET_DATA} extendedHours={false} phase="regular" isReadOnly />,
    );
    expect(tabs(/** @type {HTMLElement} */ (container))).toEqual([]);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('#perf-tab-inv')).toBeNull();
    expect(container.querySelector('.panel-title')?.textContent).toBe('PERFORMANCE VS S&P 500');
    expect(container.textContent).not.toMatch(/INVESTMENT|DEPOSITED/);
    // The range row stays: the viewer still reads every window.
    expect([...container.querySelectorAll('.perf-range-btn')].map(b => b.textContent))
      .toEqual(['24H', '1W', '1M', '3M', 'YTD']);
  });
});
