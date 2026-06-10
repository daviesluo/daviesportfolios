// Smoke test for the top-level App component. Two scenarios:
//   1. No app token in sessionStorage → renders the password gate.
//   2. A valid token present (ro role) → renders the read-only board.
//
// Anything beyond mount-without-throwing is left to the focused
// component tests (TickerChartModal / PerfChart) and the pure-helper
// tests (auth.test.js etc.). The bar here is "did a prop rename /
// import shuffle / hook reorder break the App's top-level path?"

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Mock heavy children + network calls so the smoke test doesn't
// pull the whole live-prices Edge chain into the test process.
vi.mock('./header_sidebar.jsx', () => ({
  Header: () => <header data-testid="header" />,
  Sidebar: () => <aside data-testid="sidebar" />,
  MarketConditions: () => <section data-testid="mc" />,
  PerfPanel: () => <div data-testid="perf-panel" />,
  SidebarFoot: () => <footer data-testid="foot" />,
  UpcomingEarnings: () => <div data-testid="earnings" />,
}));
vi.mock('./pitch.jsx', () => ({ Pitch: () => <div data-testid="pitch" /> }));
vi.mock('./heatmap.jsx', () => ({ Heatmap: () => <div data-testid="heatmap" /> }));
vi.mock('./modals.jsx', () => ({
  Modal: ({ children }) => <div>{children}</div>,
  PositionDrillModal: () => null,
  EditTickerModal: () => null,
  AddTickerModal: () => null,
  CashModal: () => null,
  useConfirm: () => ({ confirm: () => Promise.resolve(true), element: null }),
}));
vi.mock('./ticker_chart_modal.jsx', () => ({ TickerChartModal: () => null }));
vi.mock('./sw-banner.jsx', () => ({ ServiceWorkerBanner: () => null, default: () => null, SWBanner: () => null }));
vi.mock('./ops_error_badge.jsx', () => ({
  OpsErrorBadge: () => null,
  useIsDesktop: () => true,
}));

vi.mock('./historical.js', async () => {
  const actual = await vi.importActual('./historical.js');
  return {
    ...actual,
    fetchHistoricalBatch: vi.fn(() => Promise.resolve({})),
    fetchTodayRegularClose: vi.fn(() => Promise.resolve({})),
  };
});
vi.mock('./yahoo_fetch.js', async () => {
  const actual = await vi.importActual('./yahoo_fetch.js');
  return {
    ...actual,
    fetchTickers: vi.fn(() => Promise.resolve({})),
    refreshPrices: vi.fn(() => Promise.resolve({ updates: {}, source: 'live' })),
  };
});
vi.mock('./trading212.js', () => ({
  fetchTrading212Holdings: vi.fn(() => Promise.resolve(null)),
  applyTrading212: (h) => h,
  applyTrading212NightPrice: (h) => h,
}));
vi.mock('./portfolio_remote.js', () => ({
  loadPortfolioRemote: vi.fn(() => Promise.resolve(null)),
  savePortfolioRemote: vi.fn(() => Promise.resolve({ ok: true })),
  portfolioUserFingerprint: () => 'fingerprint',
  PORTFOLIO_BROADCAST_CHANNEL: 'dp.portfolio',
}));
vi.mock('./prefetch.js', () => ({ prefetchAllChartData: vi.fn() }));
// Force the overnight window so doRefresh exercises the overnight
// preload path; keep every other market-hours helper real.
vi.mock('./market_hours.js', async () => {
  const actual = await vi.importActual('./market_hours.js');
  return { ...actual, usMarketPhase: () => 'overnight' };
});
vi.mock('./overnight_intraday.js', () => ({
  fetchOvernightSeries: vi.fn(() => Promise.resolve({})),
  getOvernightSeries: () => [],
  mergeOvernightSeries: (s) => s,
  OVERNIGHT_FETCH_EVENT: 'overnight:fetched',
}));
vi.mock('./chart_store.js', () => ({
  hydrateAllChartStores: () => Promise.resolve(),
  ChartStore: { get: () => null, set: () => {}, keys: () => [], pruneOlderThan: () => {} },
  MaStore:    { get: () => null, set: () => {}, keys: () => [], pruneOlderThan: () => {} },
  YtdStore:   { get: () => null, set: () => {}, keys: () => [], pruneOlderThan: () => {} },
}));
vi.mock('./auth.js', async () => {
  const actual = await vi.importActual('./auth.js');
  return {
    ...actual,
    // Default: no token + no URL pwd → the in-page password form renders.
    // Individual tests override by stubbing sessionStorage directly.
    consumeUrlPassword: vi.fn(() => null),
    authenticate: vi.fn(() => Promise.resolve({ ok: false })),
  };
});

import App from './app.jsx';
import { refreshPrices } from './yahoo_fetch.js';
import { prefetchAllChartData } from './prefetch.js';
import { fetchOvernightSeries } from './overnight_intraday.js';
import { loadPortfolioRemote } from './portfolio_remote.js';

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('App — smoke render', () => {
  it('mounts without throwing when no token is present', () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it('renders the password gate copy in the unauthed state', () => {
    const { container } = render(<App />);
    // Unauthed body should at least render *something* (not be the
    // null-page). The auth gate's exact copy is checked separately
    // in auth.test.js — here we just verify the App produced output.
    expect(container.firstChild).toBeTruthy();
  });
});

// Integration test for the doRefresh orchestration — the most
// regression-prone code in the app (this session alone fixed the
// overnight-preload race + the ext-anchor + the prefetch coverage).
// The pure helpers are unit-tested; this mounts the real Board with a
// valid token + a fixture portfolio and asserts the on-mount refresh
// wiring end to end, with the clock forced into the overnight window.
describe('App — doRefresh on initial load (overnight window)', () => {
  // A decode-able read-only token (the `data` function still verifies
  // the HMAC server-side; the client only decodes role + exp to skip
  // the password prompt). base64url(JSON) + a throwaway signature.
  function setReadOnlyToken() {
    const payload = btoa(JSON.stringify({ role: 'ro', exp: Date.now() + 60 * 60 * 1000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('dp.token', `${payload}.sig`);
  }

  const PORTFOLIO = {
    holdings: {
      NVDA: { shares: 10, cost: 100, lastPrice: 120, prevClose: 118, currency: 'USD', lots: [{ date: '2025-01-01', shares: 10, cost: 100 }] },
      'VUAA.L': { shares: 3, cost: 80, lastPrice: 85, prevClose: 84, currency: 'USD', lots: [{ date: '2025-02-01', shares: 3, cost: 80 }] },
      CASH: { isCash: true, lastPrice: 1000 },
    },
    positions: { ST: { role: 'FWD', subtitle: '', tickers: ['NVDA', 'VUAA.L'] } },
  };

  it('fetches live prices, preloads the overnight line for US equities, and warms the chart prefetch', async () => {
    setReadOnlyToken();
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (PORTFOLIO));

    render(<App />);

    // doRefresh fires once the portfolio load resolves and flips the
    // refresh effect's `portfolio !== null` key.
    await waitFor(() => expect(refreshPrices).toHaveBeenCalled());

    // Overnight preload: only the US-equity holding (NVDA) is eligible —
    // VUAA.L is an LSE ETF (no overnight session) and CASH isn't a
    // tradeable, so the call must carry exactly ['NVDA']. This is the
    // exact behaviour the session's overnight-preload fix added.
    await waitFor(() => expect(fetchOvernightSeries).toHaveBeenCalledWith(['NVDA']));

    // Initial-load chart prefetch warms the modal/perf caches.
    await waitFor(() => expect(prefetchAllChartData).toHaveBeenCalled());
    const prefetchArg = vi.mocked(prefetchAllChartData).mock.calls[0][0];
    expect(prefetchArg.tickers).toEqual(expect.arrayContaining(['NVDA', 'VUAA.L']));
  });
});
