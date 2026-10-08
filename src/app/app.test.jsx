// @vitest-environment jsdom
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
import { render, cleanup, waitFor, act } from '@testing-library/react';

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
  fetchTrading212Dividends: vi.fn(() => Promise.resolve({ rows: [], complete: false })),
  syncTrading212History: vi.fn(() => Promise.resolve(null)),
  applyTrading212Answer: () => ({ zeroed: [], held: [] }),
  applyTrading212NightPrice: (h) => h,
  stripClosedFromPositions: (p) => p,
}));
vi.mock('../portfolio/portfolio_remote.js', () => ({
  loadPortfolioRemote: vi.fn(() => Promise.resolve(null)),
  savePortfolioRemote: vi.fn(() => Promise.resolve({ ok: true })),
  portfolioUserFingerprint: vi.fn(() => 'fingerprint'),
  knownPortfolioVersion: vi.fn(() => null),
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
import { noteAuthStatus } from './auth.js';
import { refreshPrices } from '../prices/yahoo_fetch.js';
import { prefetchAllChartData } from '../prices/prefetch.js';
import { fetchOvernightSeries } from '../prices/overnight_intraday.js';
import { fetchHistoricalBatch, fetchTodayRegularClose } from '../prices/historical.js';
import { syncTrading212History } from '../portfolio/trading212.js';
import { loadPortfolioRemote, savePortfolioRemote, portfolioUserFingerprint, knownPortfolioVersion } from '../portfolio/portfolio_remote.js';

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  // No test here reaches the network. The Agents prefetch was calling the
  // production function with the tests' made-up tokens, and since a 401 now
  // signs the app out (Davies, 2026-09-27) that reply unmounted the board a
  // test was reading. Anything not mocked above gets a 503.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"no network in tests"}', { status: 503 })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('App — smoke render', () => {
  it('mounts without throwing when no token is present', () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it('says the server is unavailable, never that the password is wrong, when the check got no answer', async () => {
    const auth = await import('./auth.js');
    vi.mocked(auth.consumeUrlPassword).mockReturnValueOnce('pw');
    vi.mocked(auth.authenticate).mockResolvedValueOnce({ unavailable: true, status: 500 });
    const { findByText, queryByText } = render(<App />);
    expect(await findByText('SERVER UNAVAILABLE')).toBeTruthy();
    expect(queryByText('Incorrect password.')).toBeNull();
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
    // The second argument is the band's second-opinion list (prices/quote_band.js).
    expect(refreshPrices).toHaveBeenCalledWith(
      expect.objectContaining({ holdings: expect.objectContaining({ ZZZZ: expect.anything() }) }),
      expect.objectContaining({ confirm: expect.any(Object) }),
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
      expect.objectContaining({ confirm: expect.any(Object) }),
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
      expect.objectContaining({ confirm: expect.any(Object) }),
    ));

    // Give the real (demo-resolving) load a tick to land and the effects
    // to settle.
    await new Promise((r) => setTimeout(r, 0));

    // The cached portfolio must have been kept — refreshPrices is never
    // called against the demo holdings.
    // Matched with or without the band's second argument, so the "never" cannot pass on a call shape alone.
    expect(refreshPrices).not.toHaveBeenCalledWith(
      expect.objectContaining({ holdings: expect.objectContaining({ DEMO: expect.anything() }) }),
      expect.anything(),
    );
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

// Signed out (Davies, 2026-09-27): the app goes back to its login form, never
// an error card inside the page — when the token lapses while the page is
// open, and when any call answers 401 to the token it holds.
describe('App — signed out', () => {
  function setToken(msFromNow) {
    const payload = btoa(JSON.stringify({ role: 'ro', exp: Date.now() + msFromNow }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('dp.token', `${payload}.sig`);
  }

  it('returns to the password form when the token lapses while the page is open', async () => {
    setToken(300);
    const { queryByPlaceholderText } = render(<App />);
    // Signed in: the token is good for 0.3 s, so the page is the app, not the form.
    expect(queryByPlaceholderText('Password')).toBeNull();
    await waitFor(() => expect(queryByPlaceholderText('Password')).not.toBeNull(), { timeout: 4000 });
    expect(sessionStorage.getItem('dp.token')).toBeNull();
  });

  it('returns to the password form when a call answers 401, and a 403 leaves it signed in', async () => {
    setToken(3600e3);
    const { queryByPlaceholderText } = render(<App />);
    expect(queryByPlaceholderText('Password')).toBeNull();
    act(() => noteAuthStatus(403));
    expect(queryByPlaceholderText('Password')).toBeNull();
    act(() => noteAuthStatus(401));
    await waitFor(() => expect(queryByPlaceholderText('Password')).not.toBeNull());
    expect(sessionStorage.getItem('dp.token')).toBeNull();
  });
});

// Two refreshes in flight at once (the 30 s tick and the Refresh button, say): until 2026-10-08 the one that answered
// LAST won, so an older answer arriving late wrote its older prices over the newer ones (review F18).
describe('App — overlapping refreshes', () => {
  function setAdminToken() {
    const payload = btoa(JSON.stringify({ role: 'admin', exp: Date.now() + 60 * 60 * 1000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('dp.token', `${payload}.sig`);
  }
  const SERVER_PORTFOLIO = {
    holdings: { NVDA: { shares: 10, cost: 100, lastPrice: 120, prevClose: 118, currency: 'USD', lots: [{ date: '2025-01-01', shares: 10, cost: 100 }] } },
    positions: { ST: { role: 'FWD', subtitle: '', tickers: ['NVDA'] } },
  };
  const answer = (lastPrice) => ({ updates: { NVDA: { lastPrice, prevClose: 118, dayPct: 0, extPrice: null, currency: 'USD' } }, source: 'live' });
  const header = () => /** @type {any} */ (globalThis).__headerProps;

  afterEach(() => {
    delete /** @type {any} */ (globalThis).__headerProps;
    vi.mocked(refreshPrices).mockResolvedValue(/** @type {any} */ ({ updates: {}, source: 'live' }));
  });

  it('an older refresh that answers after a newer one began is dropped: the newer prices stay, and so does the spinner until it ends', async () => {
    setAdminToken();
    /** @type {(v: any) => void} */ let answerFirst = () => {};
    /** @type {(v: any) => void} */ let answerSecond = () => {};
    vi.mocked(refreshPrices)
      .mockImplementationOnce(() => new Promise((r) => { answerFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { answerSecond = r; }));
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (structuredClone(SERVER_PORTFOLIO)));

    render(<App />);
    await waitFor(() => expect(refreshPrices).toHaveBeenCalledTimes(1));     // the load's refresh, still waiting
    await act(async () => { header().onRefresh(); });                       // the button: a second, newer refresh
    await waitFor(() => expect(refreshPrices).toHaveBeenCalledTimes(2));
    expect(header().isRefreshing).toBe(true);

    await act(async () => { answerSecond(answer(150)); });
    await waitFor(() => expect(header().metrics.marketValue).toBe(1500));
    expect(header().isRefreshing).toBe(false);

    // The first refresh's answer lands now, older than what the page shows.
    await act(async () => { answerFirst(answer(130)); });
    await new Promise((r) => setTimeout(r, 50));
    expect(header().metrics.marketValue).toBe(1500);
    expect(header().isRefreshing).toBe(false);
  }, 10000);
});

// A tab that reloads with an edit the server never took (it died, or its sign-in lapsed, before the save went through):
// until 2026-10-08 the edit was put back and saved over whatever the server held by then, so a change saved from
// another tab or device in between was overwritten without a word (review F20).
describe('App — an unsaved edit left by a tab that reloaded', () => {
  function setAdminToken() {
    const payload = btoa(JSON.stringify({ role: 'admin', exp: Date.now() + 60 * 60 * 1000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('dp.token', `${payload}.sig`);
  }
  const SERVER_PORTFOLIO = {
    holdings: { NVDA: { shares: 10, cost: 100, lastPrice: 120, prevClose: 118, currency: 'USD', lots: [{ date: '2025-01-01', shares: 10, cost: 100 }] } },
    positions: { ST: { role: 'FWD', subtitle: '', tickers: ['NVDA'] } },
  };
  // The edit: 12 shares, not 10.
  const draftBoard = () => {
    const d = structuredClone(SERVER_PORTFOLIO);
    d.holdings.NVDA.shares = 12;
    d.holdings.NVDA.lots = [{ date: '2025-01-01', shares: 12, cost: 100 }];
    return d;
  };
  const leaveDraft = (baseVersion) => sessionStorage.setItem('dp.pendingSave', JSON.stringify({ fp: 'shares-12', portfolio: draftBoard(), baseVersion, ts: Date.now() }));
  const header = () => /** @type {any} */ (globalThis).__headerProps;

  beforeEach(() => {
    // The price an earlier test's board last showed would be drawn instead of the row's own (`dp.lastPrices`).
    localStorage.removeItem('dp.lastPrices');
    vi.mocked(portfolioUserFingerprint).mockImplementation((p) => `shares-${/** @type {any} */ (p)?.holdings?.NVDA?.shares}`);
  });
  afterEach(() => {
    vi.mocked(portfolioUserFingerprint).mockImplementation(() => 'fingerprint');
    vi.mocked(knownPortfolioVersion).mockReturnValue(null);
    localStorage.removeItem('dp.lastPrices');
    delete /** @type {any} */ (globalThis).__headerProps;
  });

  it('another tab or device saved since: the edit is shown under the CONFLICT bar, and nothing is saved over theirs', async () => {
    setAdminToken();
    leaveDraft(6);
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (structuredClone(SERVER_PORTFOLIO)));
    vi.mocked(knownPortfolioVersion).mockReturnValue(7);

    const { findByText } = render(<App />);
    await findByText(/CONFLICT — another tab or device saved newer changes/, undefined, { timeout: 3000 });
    await waitFor(() => expect(header().metrics.marketValue).toBe(1440));   // the edit's 12 shares, as the tab left them
    await new Promise((r) => setTimeout(r, 1000));                          // past the save's 600 ms debounce
    expect(savePortfolioRemote).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('dp.pendingSave') || '{}').baseVersion).toBe(6);   // kept for the bar's choice
  }, 10000);

  it('nothing saved since: the edit is put back and saved, and its draft cleared', async () => {
    setAdminToken();
    leaveDraft(7);
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (structuredClone(SERVER_PORTFOLIO)));
    vi.mocked(knownPortfolioVersion).mockReturnValue(7);

    const { queryByText } = render(<App />);
    await waitFor(() => expect(savePortfolioRemote).toHaveBeenCalled(), { timeout: 3000 });
    expect(/** @type {any} */ (vi.mocked(savePortfolioRemote).mock.calls[0][0]).holdings.NVDA.shares).toBe(12);
    await waitFor(() => expect(sessionStorage.getItem('dp.pendingSave')).toBeNull());
    expect(queryByText(/CONFLICT/)).toBeNull();
  }, 10000);
});

// The Trading 212 history walk (review F17): the one-minute job runs it every ten minutes (0100), so a hidden tab no
// longer calls it every two minutes; it walks again once it is shown.
describe('App — the Trading 212 history walk', () => {
  function setAdminToken() {
    const payload = btoa(JSON.stringify({ role: 'admin', exp: Date.now() + 60 * 60 * 1000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('dp.token', `${payload}.sig`);
  }
  const SERVER_PORTFOLIO = {
    holdings: { NVDA: { shares: 10, cost: 100, lastPrice: 120, prevClose: 118, currency: 'USD', lots: [{ date: '2025-01-01', shares: 10, cost: 100 }] } },
    positions: { ST: { role: 'FWD', subtitle: '', tickers: ['NVDA'] } },
  };
  let visibility = 'hidden';
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });
  afterEach(() => {
    delete /** @type {any} */ (document).visibilityState;   // jsdom's own getter again
    vi.useRealTimers();
  });

  it('a hidden tab never calls the walk; once shown, it does within two minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    visibility = 'hidden';
    setAdminToken();
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (structuredClone(SERVER_PORTFOLIO)));
    render(<App />);
    await vi.advanceTimersByTimeAsync(9_000);                 // past the walk's first 8 s
    expect(syncTrading212History).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(syncTrading212History).not.toHaveBeenCalled();
    visibility = 'visible';
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(syncTrading212History).toHaveBeenCalledTimes(1);
  }, 20000);
});

// Outside the regular session each refresh asked for every US holding's 1d/5m bars again, every 30 s, sold-out
// holdings included (review F12). The 30 s tick now reuses them for two minutes; the first refresh and a Refresh by
// hand ask again; a holding with no shares is never asked for.
describe('App — the extended-hours bars outside the session', () => {
  function setAdminToken() {
    const payload = btoa(JSON.stringify({ role: 'admin', exp: Date.now() + 60 * 60 * 1000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem('dp.token', `${payload}.sig`);
  }
  const SERVER_PORTFOLIO = {
    holdings: {
      NVDA: { shares: 10, cost: 100, lastPrice: 120, prevClose: 118, currency: 'USD', lots: [{ date: '2025-01-01', shares: 10, cost: 100 }] },
      // Sold out: kept for its history, nothing to check a quote against.
      AMD: { shares: 0, cost: 0, lastPrice: 100, prevClose: 99, currency: 'USD', lots: [{ date: '2025-01-01', shares: 5, cost: 90 }], sells: [{ date: '2025-03-01', shares: 5, price: 110 }] },
    },
    positions: { ST: { role: 'FWD', subtitle: '', tickers: ['NVDA'] } },
  };
  const extCalls = () => vi.mocked(fetchHistoricalBatch).mock.calls.filter((c) => c[1] === '1d' && c[2] === '5m');
  const header = () => /** @type {any} */ (globalThis).__headerProps;

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fetchHistoricalBatch).mockResolvedValue({});
    delete /** @type {any} */ (globalThis).__headerProps;
  });

  it('the 30 s tick reuses the bars for two minutes, a Refresh by hand asks again, and a sold-out holding is never asked for', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setAdminToken();
    vi.mocked(fetchHistoricalBatch).mockResolvedValue({ NVDA: [{ t: Date.now() - 300e3, close: 120 }, { t: Date.now(), close: 121 }] });
    vi.mocked(loadPortfolioRemote).mockResolvedValueOnce(/** @type {any} */ (structuredClone(SERVER_PORTFOLIO)));
    render(<App />);
    await waitFor(() => expect(extCalls().length).toBe(1));
    expect(extCalls()[0][0]).toEqual(['NVDA']);
    await vi.advanceTimersByTimeAsync(30_000);                    // a tick: the bars of the first refresh
    await vi.advanceTimersByTimeAsync(30_000);                    // and the next
    expect(vi.mocked(refreshPrices).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(extCalls().length).toBe(1);
    await vi.advanceTimersByTimeAsync(90_000);                    // past two minutes: asked again
    await waitFor(() => expect(extCalls().length).toBe(2));
    await act(async () => { header().onRefresh(); });             // by hand: at once
    await waitFor(() => expect(extCalls().length).toBe(3));
    expect(extCalls().every((c) => JSON.stringify(c[0]) === '["NVDA"]')).toBe(true);
  }, 20000);
});
