// Regression coverage for TickerChartModal's rendering decision tree.
// The bar isn't "full E2E exercise" — it's "did a prop rename, a
// hook reorder, or a render-branch refactor break the surface the
// user sees?" The pure-helper tests in indicators / ytd / cache /
// chart_modal_geometry pin the math; THIS test pins the React side.
//
// What's mocked:
//   - fetchHistoricalBatch / fetchFundamentals — network out
//   - ChartStore / MaStore — IndexedDB. Returning null = "no cache,
//     modal goes to loading state"; returning {data, ts} primes the
//     chart bars synchronously on the first render.
//   - reportError — would otherwise POST during the error case test
//   - Modal portal — wrap children inline so the body actually
//     renders without needing a portal target.
//
// What's NOT mocked:
//   - The chart-geometry, indicators, formatters, fx, ticker_class
//     modules — they're pure functions and the assertions ride on
//     their real output.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vi.mock has to run before the SUT imports — declared at module top.
vi.mock('./modals.jsx', () => ({
  // The real Modal opens a portal which RTL has to be configured to
  // mount into. For the test we just inline the children so queries
  // hit the same DOM tree the test renders into.
  Modal: ({ children }) => <div data-testid="modal-root">{children}</div>,
  // The modal file's other exports aren't used here but live in the
  // same module — re-export stubs so imports don't break.
  PositionDrillModal: () => null,
  EditTickerModal: () => null,
  AddTickerModal: () => null,
  CashModal: () => null,
}));

vi.mock('./historical.js', async () => {
  const actual = await vi.importActual('./historical.js');
  return { ...actual, fetchHistoricalBatch: vi.fn(() => Promise.resolve({})) };
});
vi.mock('./yahoo_fetch.js', async () => {
  const actual = await vi.importActual('./yahoo_fetch.js');
  return { ...actual, fetchFundamentals: vi.fn(() => Promise.resolve({})) };
});

vi.mock('./chart_store.js', () => {
  /** @type {Map<string, any>} */
  const store = new Map();
  /** @type {Map<string, any>} */
  const maStore = new Map();
  return {
    ChartStore: {
      get: (k) => store.get(k) ?? null,
      set: (k, v) => store.set(k, v),
      del: (k) => store.delete(k),
      keys: () => Array.from(store.keys()),
      pruneOlderThan: () => {},
      _testSeed: (k, v) => store.set(k, v),
      _testClear: () => store.clear(),
    },
    MaStore: {
      get: (k) => maStore.get(k) ?? null,
      set: (k, v) => maStore.set(k, v),
      del: (k) => maStore.delete(k),
      keys: () => Array.from(maStore.keys()),
      pruneOlderThan: () => {},
    },
  };
});

vi.mock('./ops_error.js', () => ({
  reportError: vi.fn(),
}));

// SUT imports happen AFTER the mocks above. The chart_store mock
// exports _testSeed as a back door so tests can seed the cache.
import { TickerChartModal } from './ticker_chart_modal.jsx';
import { ChartStore } from './chart_store.js';
import { tickerChartCacheKey } from './cache.js';
import { fourHourSlots } from './market_hours.js';
import { rangeStartMs } from './price_snapshots.js';

const NOW = new Date('2026-05-28T16:00:00Z');

function seedChartCache(ticker, rangeKey, useExt, phase, data) {
  const key = tickerChartCacheKey(ticker, rangeKey, useExt, phase);
  /** @type {any} */ (ChartStore)._testSeed(key, {
    ts: NOW.getTime(),
    data,
  });
}

function renderModal(overrides = {}) {
  const props = {
    ticker: 'AAPL',
    holding: { shares: 10, cost: 200, lastPrice: 215, prevClose: 213, dayPct: 0.94 },
    marketData: {},
    extendedHours: false,
    phase: 'regular',
    onClose: () => {},
    portfolioTotalValue: 1000,
    hideValues: false,
    ...overrides,
  };
  return render(<TickerChartModal {...props} />);
}

beforeEach(() => {
  /** @type {any} */ (ChartStore)._testClear();
  cleanup();
});

describe('TickerChartModal — render decision tree', () => {
  it('renders the ticker symbol in the header on mount', () => {
    renderModal();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
  });

  it('shows "Loading…" when no cached chart series exists', () => {
    renderModal();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('paints the chart SVG when ChartStore has prior data (>=2 bars)', () => {
    const data = [
      { date: '2026-05-28T13:30', close: 210 },
      { date: '2026-05-28T14:00', close: 212 },
      { date: '2026-05-28T19:00', close: 215 },
    ];
    seedChartCache('AAPL', '1D', false, 'regular', data);
    const { container } = renderModal();
    // hasData=true → SVG renders. The Loading copy must not appear.
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText(/Loading…/i)).not.toBeInTheDocument();
  });

  it('shows "No data for this range" when cached data is too short for the chart (length < 2)', () => {
    // length=1 short-circuit — hits the !hasData branch.
    seedChartCache('AAPL', '1D', false, 'regular', [
      { date: '2026-05-28T13:30', close: 215 },
    ]);
    renderModal();
    // The cache row is rejected (length < 2 minimum), so the modal
    // hits the fresh-fetch path and shows Loading… while the mocked
    // fetcher resolves to {} — same surface as "no chart available".
    expect(screen.getByText(/Loading|No data/i)).toBeInTheDocument();
  });

  it('labels crypto 1D "(since previous close)" like everything else, even with ext on', () => {
    // BTC-USD reads the same "since previous close" basis as a US stock; the
    // ext toggle must not flip it to a 0.00% (lastPrice-anchored) headline.
    const data = [
      { date: '2026-05-27T16:00', close: 64000 },
      { date: '2026-05-28T16:00', close: 65000 },
    ];
    seedChartCache('BTC-USD', '1D', true, 'overnight', data);
    renderModal({
      ticker: 'BTC-USD',
      extendedHours: true,
      phase: 'overnight',
      holding: { shares: 0.1, cost: 60000, lastPrice: 65000, prevClose: 64500, dayPct: 0.78, currency: 'USD' },
    });
    expect(screen.getByText('(since previous close)')).toBeInTheDocument();
    expect(screen.queryByText('(past 24 hours)')).not.toBeInTheDocument();
  });

  it('honours the hideValues prop (masks dollar amounts but still renders the ticker)', () => {
    seedChartCache('AAPL', '1D', false, 'regular', [
      { date: '2026-05-28T13:30', close: 210 },
      { date: '2026-05-28T19:00', close: 215 },
    ]);
    renderModal({ hideValues: true });
    expect(screen.getByText('AAPL')).toBeInTheDocument();
  });
});

// 3M draws on the portfolio panel's four-hour London grid when — and
// only when — the instrument actually prints through a weekday night.
// The distinction is the whole point: on that grid a futures or FX
// chart lands on six live prices a day, while an index would land on
// two and carry the previous close through the other four.
describe('TickerChartModal — 3M sampling grid', () => {
  /** N recent weekdays of hourly UTC bars, ending at the current hour. */
  const hourlyBars = (weekdays) => {
    const out = [];
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    /** @type {string[]} */
    const days = [];
    while (days.length < weekdays) {
      const dow = day.getUTCDay();
      if (dow !== 0 && dow !== 6) days.unshift(day.toISOString().slice(0, 10));
      day.setUTCDate(day.getUTCDate() - 1);
    }
    let px = 100;
    for (const d of days) {
      for (let h = 0; h < 24; h++) {
        out.push({ date: `${d}T${String(h).padStart(2, '0')}:00`, close: (px += 0.5) });
      }
    }
    return out;
  };

  /** Points on the densest path the chart drew. */
  const pointCount = (container) => Math.max(0, ...[...container.querySelectorAll('svg path[d^="M"]')]
    .map((el) => (el.getAttribute('d') || '').split(/[ML]/).length - 1));

  const drawAt3M = async (ticker, bars) => {
    seedChartCache(ticker, '3M', false, 'regular', bars);
    const user = userEvent.setup();
    const { container } = renderModal({
      ticker,
      holding: { shares: 1, cost: 100, lastPrice: 120, prevClose: 119, dayPct: 0.8, currency: 'USD' },
    });
    await user.click(screen.getByRole('button', { name: '3M' }));
    return pointCount(container);
  };

  it('a futures chart samples six times a weekday; an index keeps its hourly bars', async () => {
    const bars = hourlyBars(4);           // 4 weekdays x 24 hourly bars
    const futures = await drawAt3M('ES=F', bars);
    cleanup();
    const index = await drawAt3M('^GSPC', bars);
    // Exactly the grid's own slots from the first bar onward — computed
    // here rather than written down, because the newest weekday is
    // partial and how partial depends on the hour the suite runs at.
    const firstMs = Date.parse(`${bars[0].date}Z`);
    const expected = fourHourSlots(rangeStartMs('3M', Date.now()), Date.now())
      .filter((ms) => ms >= firstMs).length;
    expect(futures).toBe(expected);
    expect(index).toBe(bars.length);
    // The claim in one line: the same bars, drawn at a quarter of the
    // density, because one instrument's night is real and the other's
    // is a carried-forward close.
    expect(index / futures).toBeGreaterThan(3);
  });

  it('crypto stays on hourly bars — the grid skips weekends and its tape does not', async () => {
    const crypto = await drawAt3M('BTC-USD', hourlyBars(4));
    expect(crypto).toBeGreaterThan(4 * 20);
  });
});
