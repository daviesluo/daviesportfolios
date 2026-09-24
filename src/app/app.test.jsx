// Smoke test for the top-level App component. Two scenarios:
//   1. No app token in sessionStorage → renders the password gate.
//   2. A valid token present (ro role) → renders the read-only board.
//
// Anything beyond mount-without-throwing is left to the focused
// component tests (TickerChartModal / PerfChart) and the pure-helper
// tests (auth.test.js etc.). The bar here is "did a prop rename /
// import shuffle / hook reorder break the App's top-level path?"

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Mock heavy children + network calls so the smoke test doesn't
// pull the whole live-prices Edge chain into the test process.
vi.mock('../board/header_sidebar.jsx', () => ({
  // Header and PerfPanel keep the props they were last drawn with, so a
  // test can read the numbers the page would show.
  Header: (p) => { /** @type {any} */ (globalThis).__headerProps = p; return <header data-testid="header" />; },
  Sidebar: () => <aside data-testid="sidebar" />,
  MarketConditions: () => <section data-testid="mc" />,
  PerfPanel: (p) => { /** @type {any} */ (globalThis).__perfProps = p; return <div data-testid="perf-panel" />; },
  SidebarFoot: () => <footer data-testid="foot" />,
  UpcomingEarnings: () => <div data-testid="earnings" />,
}));
vi.mock('../board/pitch.jsx', () => ({ Pitch: () => <div data-testid="pitch" /> }));
vi.mock('../board/heatmap.jsx', () => ({ Heatmap: () => <div data-testid="heatmap" /> }));
vi.mock('../board/modals.jsx', () => ({
  Modal: ({ children }) => <div>{children}</div>,
  PositionDrillModal: () => null,
  EditTickerModal: () => null,
  AddTickerModal: () => null,
  CashModal: () => null,
  useConfirm: () => ({ confirm: () => Promise.resolve(true), element: null }),
}));
vi.mock('../charts/ticker_chart_modal.jsx', () => ({ TickerChartModal: () => null }));
vi.mock('./sw-banner.jsx', () => ({ ServiceWorkerBanner: () => null, default: () => null, SWBanner: () => null }));
vi.mock('./ops_error_badge.jsx', () => ({
  OpsErrorBadge: () => null,
  useIsDesktop: () => true,
}));

vi.mock('../prices/historical.js', async () => {
  const actual = await vi.importActual('../prices/historical.js');
  return {
    ...actual,
    fetchHistoricalBatch: vi.fn(() => Promise.resolve({})),
    fetchTodayRegularClose: vi.fn(() => Promise.resolve({})),
  };
});
vi.mock('../prices/yahoo_fetch.js', async () => {
  const actual = await vi.importActual('../prices/yahoo_fetch.js');
  return {
    ...actual,
    fetchTickers: vi.fn(() => Promise.resolve({})),
    refreshPrices: vi.fn(() => Promise.resolve({ updates: {}, source: 'live' })),
  };
});
vi.mock('../portfolio/trading212.js', () => ({
  fetchTrading212Holdings: vi.fn(() => Promise.resolve(null)),
  // The executed-fill read and the backfill driver both run from Board
  // effects, so a mock that omits either throws inside a passive effect
  // — which vitest reports as an unhandled error rather than a failing
  // assertion, so it can hide behind a green-looking summary.
  fetchTrading212Orders: vi.fn(() => Promise.resolve({ rows: [], complete: false })),
  syncTrading212History: vi.fn(() => Promise.resolve(null)),
  applyTrading212: (h) => h,
  applyTrading212NightPrice: (h) => h,
}));
vi.mock('../portfolio/portfolio_remote.js', () => ({
  loadPortfolioRemote: vi.fn(() => Promise.resolve(null)),
  savePortfolioRemote: vi.fn(() => Promise.resolve({ ok: true })),
  portfolioUserFingerprint: vi.fn(() => 'fingerprint'),
  PORTFOLIO_BROADCAST_CHANNEL: 'dp.portfolio',
}));
vi.mock('../prices/prefetch.js', () => ({ prefetchAllChartData: vi.fn() }));
// Force the overnight window so doRefresh exercises the overnight
// preload path; keep every other market-hours helper real.
vi.mock('../prices/market_hours.js', async () => {
  const actual = await vi.importActual('../prices/market_hours.js');
  return { ...actual, usMarketPhase: () => 'overnight' };
});
vi.mock('../prices/overnight_intraday.js', () => ({
  fetchOvernightSeries: vi.fn(() => Promise.resolve({})),
  getOvernightSeries: () => [],
  mergeOvernightSeries: (s) => s,
  OVERNIGHT_FETCH_EVENT: 'overnight:fetched',
}));
vi.mock('../prices/chart_store.js', () => ({
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
import { refreshPrices } from '../prices/yahoo_fetch.js';
import { prefetchAllChartData } from '../prices/prefetch.js';
import { fetchOvernightSeries } from '../prices/overnight_intraday.js';
import { fetchTodayRegularClose } from '../prices/historical.js';
import { loadPortfolioRemote, savePortfolioRemote, portfolioUserFingerprint } from '../portfolio/portfolio_remote.js';

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

    // MC ext-anchor preload: the Market Conditions cards' ext-on anchor
    // (today's 16:00-ET close) must be fetched on this overnight refresh
    // even though the Extended Hours toggle defaults OFF here. It's gated
    // on the market PHASE, not the toggle — the toggle deliberately
    // doesn't trigger a refresh, so if this fetch were gated on the
    // toggle every MC card would read a flat 0.00 % from the instant ext
    // is switched on until the next 30 s tick (the reported bug). Phase-
    // gating warms the anchor before the toggle is ever touched.
    await waitFor(() => expect(fetchTodayRegularClose).toHaveBeenCalled());
  });
});

// Pins the cold-start-latency fix: a cache-primed `portfolio` lets the
// FIRST price refresh start immediately (using last-known holdings)
// instead of waiting on loadPortfolioRemote's own network round trip —
// this IS the actual "first refresh after opening the app is slow"
// symptom the fix targets. Uses a manually-controlled promise (not
// mockResolvedValueOnce) so the assertion below runs in the window
// BEFORE the real load resolves, which is exactly the window that
// matters here.
describe('App — cache-primed first paint (Storage.loadPortfolioCache)', () => {
  function setAdminToken() {
    const payload = btoa(JSON.stringify({ role: 'admin', exp: Date.now() + 60 * 60 * 1000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('dp.token', `${payload}.sig`);
  }

  const CACHED_PORTFOLIO = {
    holdings: {
      ZZZZ: { shares: 7, cost: 50, lastPrice: 55, prevClose: 54, currency: 'USD', lots: [{ date: '2025-03-01', shares: 7, cost: 50 }] },
    },
    positions: { ST: { role: 'FWD', subtitle: '', tickers: ['ZZZZ'] } },
  };
  const SERVER_PORTFOLIO = {
    holdings: {
      NVDA: { shares: 10, cost: 100, lastPrice: 120, prevClose: 118, currency: 'USD', lots: [{ date: '2025-01-01', shares: 10, cost: 100 }] },
    },
    positions: { ST: { role: 'FWD', subtitle: '', tickers: ['NVDA'] } },
  };

  afterEach(() => localStorage.removeItem('dp.portfolioCache'));

  it('doRefresh fires off the CACHED portfolio before loadPortfolioRemote resolves, and the save effect stays a no-op until it does', async () => {
    localStorage.setItem('dp.portfolioCache', JSON.stringify({ ts: Date.now(), data: CACHED_PORTFOLIO }));
    setAdminToken();

    /** @type {(p: any) => void} */
    let resolveLoad = () => {};
    vi.mocked(loadPortfolioRemote).mockReturnValueOnce(
      new Promise((resolve) => { resolveLoad = resolve; }),
    );

    render(<App />);

    // The mount-effect's doRefresh already ran against the cache-primed
    // portfolio — refreshPrices fired with the CACHED ticker, well before
    // the still-pending loadPortfolioRemote() promise ever settles.
    await waitFor(() => expect(refreshPrices).toHaveBeenCalled());
    expect(refreshPrices).toHaveBeenCalledWith(
      expect.objectContaining({ holdings: expect.objectContaining({ ZZZZ: expect.anything() }) }),
    );
    // The debounced auto-save effect must NOT have fired yet — it's
    // gated on hasRealLoadRef, which only flips once the real load
    // resolves. Without that gate, the cache-primed data racing the
    // effect's fingerprint-seed logic is exactly the "phantom edit"
    // risk this test would catch.
    expect(savePortfolioRemote).not.toHaveBeenCalled();

    // Now let the real load land with different (server) holdings.
    resolveLoad(/** @type {any} */ (SERVER_PORTFOLIO));
    await waitFor(() => expect(refreshPrices).toHaveBeenCalledWith(
      expect.objectContaining({ holdings: expect.objectContaining({ NVDA: expect.anything() }) }),
    ));
    // Still no save — nothing about the reconcile itself constitutes a
    // user edit (portfolioUserFingerprint is mocked constant here, so a
    // real fingerprint mismatch can't fire a save in this harness either
    // way; this asserts the gate didn't itself trigger one).
    expect(savePortfolioRemote).not.toHaveBeenCalled();
  });

  // Codex #201 P1: a real load that resolves to the demo fallback while
  // a real cache-primed portfolio is already on screen must keep the
  // cached data AND leave the save gate closed. Before the fix,
  // hasRealLoadRef.current was set unconditionally in this branch even
  // though the failed load never touched portfolio_remote's
  // lastKnownVersion — a subsequent save would have skipped If-Match
  // and could silently overwrite newer data from another device.
  it('keeps the cached portfolio and never opens the save gate when the real load falls back to demo', async () => {
    localStorage.setItem('dp.portfolioCache', JSON.stringify({ ts: Date.now(), data: CACHED_PORTFOLIO }));
    setAdminToken();

    const DEMO_PORTFOLIO = {
      holdings: {
        DEMO: { shares: 1, cost: 1, lastPrice: 1, prevClose: 1, currency: 'USD', lots: [{ date: '2025-01-01', shares: 1, cost: 1 }] },
      },
      positions: { ST: { role: 'FWD', subtitle: '', tickers: ['DEMO'] } },
      _isDemo: true,
    };

    // A fingerprint that changes on every call would, if the save gate
    // had wrongly opened, eventually fire a save once the 600 ms
    // debounce elapses — used here to prove the gate actually stayed
    // shut, not just that no real edit happened to trigger it.
    let fpCounter = 0;
    vi.mocked(portfolioUserFingerprint).mockImplementation(() => `fp-${fpCounter++}`);
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (DEMO_PORTFOLIO));

    render(<App />);

    // doRefresh fires off the cached (ZZZZ) portfolio immediately.
    await waitFor(() => expect(refreshPrices).toHaveBeenCalledWith(
      expect.objectContaining({ holdings: expect.objectContaining({ ZZZZ: expect.anything() }) }),
    ));

    // Give the real (demo-resolving) load a tick to land and the effects
    // to settle.
    await new Promise((r) => setTimeout(r, 0));

    // The cached portfolio must have been kept — refreshPrices is never
    // called against the demo holdings.
    expect(refreshPrices).not.toHaveBeenCalledWith(
      expect.objectContaining({ holdings: expect.objectContaining({ DEMO: expect.anything() }) }),
    );

    // Past the 600 ms debounce window, still no save — proves
    // hasRealLoadRef.current stayed false rather than being flipped by
    // the discarded demo load.
    await new Promise((r) => setTimeout(r, 700));
    expect(savePortfolioRemote).not.toHaveBeenCalled();

    vi.mocked(portfolioUserFingerprint).mockImplementation(() => 'fingerprint');
  }, 10000);
});

// A reload paints the prices the page last showed (dp.lastPrices) over the
// book until the live quotes land — and the book the save effect sends is
// never the drawn copy. Measured in the real bundle before this: the
// scoreboard read the cache's prices, then the server row's, then the
// live ones, in the first two seconds after every reload.
describe('App — the last-shown prices on a reload', () => {
  function setAdminToken() {
    const payload = btoa(JSON.stringify({ role: 'admin', exp: Date.now() + 60 * 60 * 1000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('dp.token', `${payload}.sig`);
  }
  // The server row's prices are whatever they were at its last save.
  const SERVER_PORTFOLIO = {
    holdings: {
      NVDA: { shares: 10, cost: 100, lastPrice: 120, prevClose: 118, dayPct: 1.69, currency: 'USD', lots: [{ date: '2025-01-01', shares: 10, cost: 100 }] },
    },
    positions: { ST: { role: 'FWD', subtitle: '', tickers: ['NVDA'] } },
  };
  const SHOWN = { NVDA: { lastPrice: 130, prevClose: 128, dayPct: 1.56, extPrice: null, extDayPct: null, extPriceTrusted: null } };
  const lastPriceOf = (p) => p?.portfolio?.holdings?.NVDA?.lastPrice;

  afterEach(() => {
    localStorage.removeItem('dp.lastPrices');
    delete /** @type {any} */ (globalThis).__perfProps;
    delete /** @type {any} */ (globalThis).__headerProps;
  });

  it('draws the last-shown price until a tick prices the holding, and never saves it', async () => {
    localStorage.setItem('dp.lastPrices', JSON.stringify({ ts: Date.now(), data: SHOWN }));
    setAdminToken();
    // No quote this time: the overlay has to hold through the server row
    // landing — and a save fired meanwhile must carry the row's own price.
    vi.mocked(refreshPrices).mockResolvedValue(/** @type {any} */ ({ updates: {}, source: 'live' }));
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (structuredClone(SERVER_PORTFOLIO)));
    let fp = 0;
    vi.mocked(portfolioUserFingerprint).mockImplementation(() => `fp-${fp++}`);

    render(<App />);
    await waitFor(() => expect(lastPriceOf(/** @type {any} */ (globalThis).__perfProps)).toBe(130));
    const header = /** @type {any} */ (globalThis).__headerProps;
    expect(header.metrics.marketValue).toBe(1300);

    await waitFor(() => expect(savePortfolioRemote).toHaveBeenCalled(), { timeout: 3000 });
    for (const [saved] of vi.mocked(savePortfolioRemote).mock.calls) {
      expect(/** @type {any} */ (saved).holdings.NVDA.lastPrice).toBe(120);
      expect(/** @type {any} */ (saved).holdings.NVDA.prevClose).toBe(118);
    }
    vi.mocked(portfolioUserFingerprint).mockImplementation(() => 'fingerprint');
    vi.mocked(refreshPrices).mockResolvedValue(/** @type {any} */ ({ updates: {}, source: 'live' }));
  }, 10000);

  it('shows the live quote once a tick prices the holding, and keeps THAT for the next reload', async () => {
    localStorage.setItem('dp.lastPrices', JSON.stringify({ ts: Date.now(), data: SHOWN }));
    setAdminToken();
    vi.mocked(refreshPrices).mockResolvedValue(/** @type {any} */ ({
      updates: { NVDA: { lastPrice: 141, prevClose: 128, dayPct: 10.16, extPrice: null, currency: 'USD' } }, source: 'live',
    }));
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (structuredClone(SERVER_PORTFOLIO)));

    render(<App />);
    await waitFor(() => expect(lastPriceOf(/** @type {any} */ (globalThis).__perfProps)).toBe(141));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dp.lastPrices') || '{}').data?.NVDA?.lastPrice).toBe(141));
    vi.mocked(refreshPrices).mockResolvedValue(/** @type {any} */ ({ updates: {}, source: 'live' }));
  }, 10000);
});
