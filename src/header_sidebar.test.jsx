// Interaction coverage for the scoreboard's two header controls: the
// currency-cycle 💱 button and the hide-values eye. The cycle button
// alone went through ~5 rounds of preview-only iteration on its
// layout / formatting / FX math; a click test that asserts the
// rendered currency symbol cycles would have caught any of the
// format regressions at CI time instead. This file is that net.
//
// We mock the badge (matchMedia + a fetch on mount) and PerfPanel
// (pulls in the whole chart stack) so the test exercises only the
// Header's own scoreboard logic.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./ops_error_badge.jsx', () => ({
  OpsErrorBadge: () => null,
  // Desktop = true so the precision branch + any desktop-gated chrome
  // render deterministically (the cycle button itself shows on both).
  useIsDesktop: () => true,
}));
vi.mock('./perf_chart.jsx', () => ({
  PerfChart: () => null,
  PerfPanel: () => null,
}));

import { Header, Sidebar, UpcomingEarnings } from './header_sidebar.jsx';

// marketData with the FX pairs the cycle conversion reads:
//   GBPUSD=X = USD per GBP  → USD→GBP multiplier is 1/1.27
//   USDCNY=X = CNY per USD  → USD→CNY multiplier is 7.2 direct
const MARKET_DATA = {
  'GBPUSD=X': { lastPrice: 1.27 },
  'USDCNY=X': { lastPrice: 7.2 },
};

const METRICS = {
  marketValue: 100000,
  dayChange: 1500,
  dayPct: 1.52,
  unrlGL: 25000,
  unrlPct: 33.3,
  positions: {},
  fxMissingTickers: [],
};

function renderHeader(overrides = {}) {
  const props = {
    metrics: METRICS,
    marketData: MARKET_DATA,
    marketDataReady: true,
    source: 'live',
    lastUpdated: new Date(),
    isRefreshing: false,
    onRefresh: vi.fn(),
    editMode: false,
    setEditMode: vi.fn(),
    isReadOnly: false,
    extendedHours: false,
    onToggleExtended: vi.fn(),
    viewMode: 'pitch',
    onToggleView: vi.fn(),
    hideValues: false,
    onToggleHideValues: vi.fn(),
    onOpenHoldingsList: vi.fn(),
    onOpenSectorsList: vi.fn(),
    onOpenTransactionHistory: vi.fn(),
    ...overrides,
  };
  return render(<Header {...props} />);
}

beforeEach(() => {
  cleanup();
  // jsdom lacks matchMedia; some descendants probe it defensively.
  if (!window.matchMedia) {
    // @ts-ignore - test shim
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
});

describe('Header scoreboard — currency cycle', () => {
  it('defaults to USD ($) on mount', () => {
    renderHeader();
    // The PORTFOLIO value renders the $ figure by default.
    expect(screen.getByText(/^\$100,000$/)).toBeInTheDocument();
  });

  it('cycles USD → GBP → CNY → USD on each click, converting via marketData FX', async () => {
    const user = userEvent.setup();
    renderHeader();
    const cycle = screen.getByRole('button', { name: /Currency: USD/i });

    // USD → GBP: 100000 / 1.27 ≈ 78,740, prefixed £
    await user.click(cycle);
    expect(screen.getByText(/^£78,740$/)).toBeInTheDocument();

    // GBP → CNY: 100000 * 7.2 = 720,000, prefixed ¥ (compact:false so
    // it's full digits, not ¥720K / ¥0.72M)
    await user.click(screen.getByRole('button', { name: /Currency: GBP/i }));
    expect(screen.getByText(/^¥720,000$/)).toBeInTheDocument();

    // CNY → USD: back to $100,000
    await user.click(screen.getByRole('button', { name: /Currency: CNY/i }));
    expect(screen.getByText(/^\$100,000$/)).toBeInTheDocument();
  });

  it('falls back to USD-identity (£ symbol, unconverted digits) when the FX pair is missing', async () => {
    const user = userEvent.setup();
    renderHeader({ marketData: {} }); // no GBPUSD=X
    await user.click(screen.getByRole('button', { name: /Currency: USD/i }));
    // Symbol cycles to £ but the multiplier fell back to 1, so the
    // digits stay the USD figure — the documented missing-rate
    // behaviour (symbol cues the cycle, value waits for the rate).
    expect(screen.getByText(/^£100,000$/)).toBeInTheDocument();
  });
});

describe('Header scoreboard — hide-values eye', () => {
  it('fires onToggleHideValues when the eye is clicked', async () => {
    const user = userEvent.setup();
    const onToggleHideValues = vi.fn();
    renderHeader({ onToggleHideValues });
    await user.click(screen.getByRole('button', { name: /Hide values/i }));
    expect(onToggleHideValues).toHaveBeenCalledTimes(1);
  });

  it('masks the dollar figures when hideValues is true', () => {
    renderHeader({ hideValues: true });
    // The literal $100,000 must not be present when masked.
    expect(screen.queryByText(/^\$100,000$/)).not.toBeInTheDocument();
  });
});

describe('Header ☰ menu', () => {
  it('lists Sectors list between Holding list and Transaction history, and fires its callback', async () => {
    const user = userEvent.setup();
    const onOpenSectorsList = vi.fn();
    renderHeader({ onOpenSectorsList });
    await user.click(screen.getByRole('button', { name: /Menu/i }));
    const items = screen.getAllByRole('menuitem').map(b => b.textContent);
    expect(items).toEqual(['Holding list', 'Sectors list', 'Transaction history']);
    await user.click(screen.getByRole('menuitem', { name: 'Sectors list' }));
    expect(onOpenSectorsList).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar — Top Movers ranks only real movers', () => {
  const moversMetrics = (players) => ({
    marketValue: 200,
    positions: {
      P1: { label: 'FWD', marketValue: 120, unrlPct: 8.5, unrlGL: 800, players: players.slice(0, 2) },
      P2: { label: 'MID', marketValue: 80, unrlPct: 3.2, unrlGL: 200, players: players.slice(2) },
    },
  });
  const renderSidebar = (players) =>
    render(<Sidebar metrics={moversMetrics(players)} source="live" portfolio={{}}
      marketData={{}} extendedHours={true} phase="overnight" hideValues={false} />);

  it('excludes flat / suppressed 0% names from both columns', () => {
    renderSidebar([
      { ticker: 'NVDA',   dayPct: 5,  marketValue: 70 },
      { ticker: 'AAPL',   dayPct: -3, marketValue: 50 },
      { ticker: 'SFTBY',  dayPct: 0,  marketValue: 40 }, // suppressed overnight
      { ticker: '017731', dayPct: 0,  marketValue: 40 }, // suppressed overnight
    ]);
    // Real movers rank…
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    // …a name pinned at 0 never does (it used to pad LOSERS with 0.00%).
    expect(screen.queryByText('SFTBY')).not.toBeInTheDocument();
    expect(screen.queryByText('017731')).not.toBeInTheDocument();
  });

  it('never ranks a CN fund, even when its NAV moved', () => {
    // The panel is TOP MOVERS - TODAY. A CN fund quotes a NAV published
    // after its own close, so 017731's dayPct is a real number about a
    // DIFFERENT day; ranking it beside stocks measured against today's
    // tape compares two different things. Before this it was suppressed
    // only during extended hours, so it ranked all day on a figure that
    // was never today's market.
    renderSidebar([
      { ticker: 'NVDA',   dayPct: 5,   marketValue: 70 },
      { ticker: 'AAPL',   dayPct: -3,  marketValue: 50 },
      { ticker: '017731', dayPct: 9.9, marketValue: 40 },
      { ticker: 'MSFT',   dayPct: -1,  marketValue: 40 },
    ]);
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    // A +9.9% NAV print would have topped WINNERS outright.
    expect(screen.queryByText('017731')).not.toBeInTheDocument();
  });

  it('renders a — placeholder for a column with no movers', () => {
    renderSidebar([
      { ticker: 'NVDA',   dayPct: 5, marketValue: 70 },
      { ticker: 'AAPL',   dayPct: 2, marketValue: 50 },
      { ticker: 'SFTBY',  dayPct: 0, marketValue: 40 },
      { ticker: '017731', dayPct: 0, marketValue: 40 },
    ]);
    // Two winners, zero losers → the LOSERS column shows the em-dash.
    // Scoped to `.mover-row` — the sidebar footer also renders an em-dash
    // (the Quotes diagnostic reads "—" until the first tick lands), so a
    // bare getByText('—') matches two nodes.
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    const dashes = screen.getAllByText('—').filter(el => el.classList.contains('mover-row'));
    expect(dashes).toHaveLength(1);
  });
});

// UPCOMING EARNINGS is BOARD-scoped, not holdings-scoped. Selling a
// position out removes it from every position's `tickers` but KEEPS the
// holding row so its buy/sell ledger survives (`closed: true`), so
// keying the panel off `Object.keys(holdings)` kept listing earnings for
// stocks the user no longer owns.
vi.mock('./yahoo_fetch.js', () => ({
  // Both tickers have a future earnings date — only board scope should
  // decide which one renders.
  fetchFundamentals: vi.fn(async (tickers) => {
    const out = {};
    for (const t of tickers) {
      out[t] = { earningsDate: Math.floor(Date.now() / 1000) + 86400 * 3 };
      // Only NVDA carries a fiscal quarter — the suffix has to be
      // optional, since Yahoo doesn't publish the fiscal-calendar
      // inputs for every ticker.
      if (t === 'NVDA') out[t].fiscalQuarter = 'FY27Q2';
    }
    return out;
  }),
}));

describe('UpcomingEarnings — only current board holdings', () => {
  const portfolio = {
    holdings: {
      NVDA: { shares: 10, cost: 1 },
      // Fully sold: ledger kept, removed from the board.
      OLDCO: { shares: 0, cost: 1, closed: true },
      CASH: { isCash: true, lastPrice: 1000 },
    },
    positions: { ST: { role: 'FWD', tickers: ['NVDA', 'CASH'] } },
  };

  it('lists a held ticker and never a sold-out one', async () => {
    render(<UpcomingEarnings portfolio={/** @type {any} */ (portfolio)} />);
    expect(await screen.findByText('NVDA')).toBeInTheDocument();
    expect(screen.queryByText('OLDCO')).not.toBeInTheDocument();
  });

  it('does not request fundamentals for off-board tickers at all', async () => {
    const { fetchFundamentals } = await import('./yahoo_fetch.js');
    vi.mocked(fetchFundamentals).mockClear();
    render(<UpcomingEarnings portfolio={/** @type {any} */ (portfolio)} />);
    await screen.findByText('NVDA');
    const asked = vi.mocked(fetchFundamentals).mock.calls[0][0];
    expect(asked).toContain('NVDA');
    expect(asked).not.toContain('OLDCO');
    expect(asked).not.toContain('CASH');   // cash has no earnings
  });
});

describe('UpcomingEarnings — fiscal quarter beside the ticker', () => {
  const portfolio = {
    holdings: { NVDA: { shares: 1, cost: 1 }, RKLB: { shares: 1, cost: 1 } },
    positions: { ST: { role: 'FWD', tickers: ['NVDA', 'RKLB'] } },
  };

  it('renders the quarter when the server supplied one, and omits it otherwise', async () => {
    render(<UpcomingEarnings portfolio={/** @type {any} */ (portfolio)} />);
    const nvda = (await screen.findByText('NVDA')).closest('.earnings-ticker');
    expect(nvda?.textContent?.replace(/\s+/g, ' ').trim()).toBe('NVDA FY27Q2');
    // RKLB got no fiscalQuarter from the mock → ticker only, no stray gap.
    const rklb = screen.getByText('RKLB').closest('.earnings-ticker');
    expect(rklb?.textContent?.trim()).toBe('RKLB');
  });
});

// A report should stay listed for the WHOLE of its day. Comparing
// against the instant dropped it the moment the scheduled time passed,
// so a 21:00 print vanished at 21:00 — exactly when the numbers land
// and you most want to see the row.
describe('UpcomingEarnings — keeps today\'s report until the day is over', () => {
  const portfolio = {
    holdings: { TODAY: { shares: 1, cost: 1 }, PAST: { shares: 1, cost: 1 }, SOON: { shares: 1, cost: 1 } },
    positions: { ST: { role: 'FWD', tickers: ['TODAY', 'PAST', 'SOON'] } },
  };
  const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

  afterEach(() => vi.restoreAllMocks());

  it('shows a report from earlier today, drops one from yesterday', async () => {
    // Fixed "now": 2026-08-10 22:30 London (21:30Z, BST = UTC+1).
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-10T21:30:00Z'));
    const { fetchFundamentals } = await import('./yahoo_fetch.js');
    vi.mocked(fetchFundamentals).mockResolvedValueOnce({
      // 21:00 London TODAY — already passed, must still render.
      TODAY: { earningsDate: sec('2026-08-10T20:00:00Z') },
      // Same clock time YESTERDAY — its day is over, must go.
      PAST:  { earningsDate: sec('2026-08-09T20:00:00Z') },
      SOON:  { earningsDate: sec('2026-08-12T12:30:00Z') },
    });

    render(<UpcomingEarnings portfolio={/** @type {any} */ (portfolio)} />);
    expect(await screen.findByText('TODAY')).toBeInTheDocument();
    expect(screen.getByText('SOON')).toBeInTheDocument();
    expect(screen.queryByText('PAST')).not.toBeInTheDocument();
  });
});
