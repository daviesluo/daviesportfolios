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
import { render, screen, cleanup, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../app/ops_error_badge.jsx', () => ({
  OpsErrorBadge: () => null,
  // Desktop = true so the precision branch + any desktop-gated chrome
  // render deterministically (the cycle button itself shows on both).
  useIsDesktop: () => true,
}));
vi.mock('../charts/perf_chart.jsx', () => ({
  PerfChart: () => null,
  PerfPanel: () => null,
}));

import { Header, Sidebar, UpcomingEarnings } from './header_sidebar.jsx';
import { YtdStore } from '../prices/chart_store.js';
import { CHARTS_UPDATED_EVENT } from '../prices/cache.js';

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
    onOpenAgents: vi.fn(),
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
    expect(items).toEqual(['Holding list', 'Sectors list', 'Transaction history', 'Agents (beta)']);
    await user.click(screen.getByRole('menuitem', { name: 'Sectors list' }));
    expect(onOpenSectorsList).toHaveBeenCalledTimes(1);
  });

  it('leaves Transaction history out for a read-only viewer', async () => {
    // The viewer password is shared publicly; every buy and sell with its
    // date and price stays behind the edit password (Davies, 2026-09-23).
    const user = userEvent.setup();
    renderHeader({ isReadOnly: true });
    await user.click(screen.getByRole('button', { name: /Menu/i }));
    const items = screen.getAllByRole('menuitem').map(b => b.textContent);
    expect(items).toEqual(['Holding list', 'Sectors list', 'Agents (beta)']);
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

// TOP MOVERS · TODAY ranks the same names two ways, and the whole point
// is that the two answers DIFFER: percentage asks "what moved", dollars
// ask "what moved the book". The fixture below is built so the two
// orders are exact reverses of each other — a test that passed in both
// modes would prove nothing about which metric is driving the sort.
//
//   ticker   dayPct   dayChange     % rank      $ rank
//   SIVE     +7.94       +120       1st         3rd
//   APLD     +6.89       +284       2nd         2nd
//   ORCL     +5.55       +462       3rd         1st
//   CRWV     -3.68       -171       1st         2nd
//   NBIS     -1.20       -402       2nd         1st
describe('Sidebar — Top Movers % / $ ranking', () => {
  const MOVERS = [
    { ticker: '2DG.SG', dayPct: 7.94, dayChange: 120, marketValue: 1500 },
    { ticker: 'APLD',   dayPct: 6.89, dayChange: 284, marketValue: 4100 },
    { ticker: 'ORCL',   dayPct: 5.55, dayChange: 462, marketValue: 8300 },
    { ticker: 'CRWV',   dayPct: -3.68, dayChange: -171, marketValue: 4600 },
    { ticker: 'NBIS',   dayPct: -1.20, dayChange: -402, marketValue: 33500 },
  ];
  const metricsFor = (players) => ({
    marketValue: 52000,
    positions: {
      P1: { label: 'FWD', marketValue: 30000, unrlPct: 8.5, unrlGL: 800, players: players.slice(0, 3) },
      P2: { label: 'MID', marketValue: 22000, unrlPct: 3.2, unrlGL: 200, players: players.slice(3) },
    },
  });
  const renderSidebar = (players = MOVERS, hideValues = false) =>
    render(<Sidebar metrics={metricsFor(players)} source="live" portfolio={{}}
      marketData={{}} extendedHours={false} phase="regular" hideValues={hideValues} />);

  /** Tickers, in render order, from one of the two columns. */
  const columnTickers = (side) => {
    const col = document.querySelectorAll('.movers-grid > div')[side === 'gain' ? 0 : 1];
    return [...col.querySelectorAll('.mover-ticker')].map(el => el.textContent);
  };
  const columnValues = (side) => {
    const col = document.querySelectorAll('.movers-grid > div')[side === 'gain' ? 0 : 1];
    return [...col.querySelectorAll('.mover-val')].map(el => el.textContent);
  };
  const barWidths = (side) => {
    const col = document.querySelectorAll('.movers-grid > div')[side === 'gain' ? 0 : 1];
    return [...col.querySelectorAll('.mover-bar')].map(
      el => parseFloat(/** @type {HTMLElement} */ (el).style.width));
  };

  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('defaults to % and ranks by percentage, largest move first', () => {
    renderSidebar();
    // 2DG.SG renders as SIVE everywhere but the ticker-detail modal.
    expect(columnTickers('gain')).toEqual(['SIVE', 'APLD', 'ORCL']);
    expect(columnTickers('loss')).toEqual(['CRWV', 'NBIS']);
    expect(columnValues('gain')).toEqual(['+7.94%', '+6.89%', '+5.55%']);
  });

  it('ranks by dollars once $ is picked — the reverse order, and the reverse for losers too', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('tab', { name: /value change/i }));
    expect(columnTickers('gain')).toEqual(['ORCL', 'APLD', 'SIVE']);
    expect(columnTickers('loss')).toEqual(['NBIS', 'CRWV']);
    expect(columnValues('gain')).toEqual(['+$462', '+$284', '+$120']);
    expect(columnValues('loss')).toEqual(['-$402', '-$171']);
  });

  it('never prints a minus inside WINNERS — the column follows the sign of the figure being ranked', async () => {
    const user = userEvent.setup();
    renderSidebar();
    for (const v of columnValues('gain')) expect(v.startsWith('+')).toBe(true);
    for (const v of columnValues('loss')) expect(v.startsWith('-')).toBe(true);
    await user.click(screen.getByRole('tab', { name: /value change/i }));
    for (const v of columnValues('gain')) expect(v.startsWith('+')).toBe(true);
    for (const v of columnValues('loss')) expect(v.startsWith('-')).toBe(true);
  });

  it('scales every bar against the largest move across BOTH columns, not per column', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('tab', { name: /value change/i }));
    // Top winner is the day's biggest absolute move ($462) → full width.
    expect(barWidths('gain')[0]).toBeCloseTo(100, 5);
    // The top LOSER is -$402 against that same $462, not against its own
    // column's leader — per-column scaling would draw it at 100 too and
    // report a day whose winners led as an even one.
    expect(barWidths('loss')[0]).toBeCloseTo((402 / 462) * 100, 5);
    expect(barWidths('gain')[2]).toBeCloseTo((120 / 462) * 100, 5);
  });

  it('masks the dollar figures when hide-values is on, and leaves percentages alone', async () => {
    const user = userEvent.setup();
    renderSidebar(MOVERS, true);
    // Percentages are not a balance — they stay readable.
    expect(columnValues('gain')).toEqual(['+7.94%', '+6.89%', '+5.55%']);
    await user.click(screen.getByRole('tab', { name: /value change/i }));
    for (const v of columnValues('gain')) {
      expect(v).not.toMatch(/\d/);
      expect(v).toContain('$');
    }
  });

  it('remembers the chosen metric across a remount', async () => {
    const user = userEvent.setup();
    const first = renderSidebar();
    await user.click(screen.getByRole('tab', { name: /value change/i }));
    first.unmount();
    renderSidebar();
    expect(screen.getByRole('tab', { name: /value change/i })).toHaveAttribute('aria-selected', 'true');
    expect(columnTickers('gain')).toEqual(['ORCL', 'APLD', 'SIVE']);
  });

  it('keeps a sub-50¢ mover in the % list and out of the $ list', async () => {
    const user = userEvent.setup();
    // A real 6% move on a position so small it shifts 4 cents. The heat
    // map paints it green, so it must have a row in the percentage
    // list; "+$0" in the dollar list would read as a bug.
    renderSidebar([
      { ticker: 'TINY', dayPct: 6.0, dayChange: 0.04, marketValue: 0.7 },
      { ticker: 'ORCL', dayPct: 5.55, dayChange: 462, marketValue: 8300 },
      { ticker: 'CRWV', dayPct: -3.68, dayChange: -171, marketValue: 4600 },
    ]);
    expect(columnTickers('gain')).toEqual(['TINY', 'ORCL']);
    await user.click(screen.getByRole('tab', { name: /value change/i }));
    expect(columnTickers('gain')).toEqual(['ORCL']);
  });

  it('writes into the shared dp.prefs bag without dropping hideValues', async () => {
    // `moversMetric` lives in the same slot as the scoreboard's eye. A
    // bare savePrefs({moversMetric}) here would silently un-hide a
    // board the user had hidden — a new feature breaking a working one
    // through a shared key.
    localStorage.setItem('dp.prefs', JSON.stringify({ hideValues: true }));
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('tab', { name: /value change/i }));
    const prefs = JSON.parse(localStorage.getItem('dp.prefs') || '{}');
    expect(prefs).toEqual({ hideValues: true, moversMetric: 'usd' });
  });

  it('moves between the two tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const pct = screen.getByRole('tab', { name: /percent move/i });
    pct.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /value change/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /value change/i })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: /percent move/i })).toHaveAttribute('aria-selected', 'true');
  });
});

// UPCOMING EARNINGS is BOARD-scoped, not holdings-scoped. Selling a
// position out removes it from every position's `tickers` but KEEPS the
// holding row so its buy/sell ledger survives (`closed: true`), so
// keying the panel off `Object.keys(holdings)` kept listing earnings for
// stocks the user no longer owns.
vi.mock('../prices/yahoo_fetch.js', () => ({
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
    const { fetchFundamentals } = await import('../prices/yahoo_fetch.js');
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

  it('writes the month the way the rest of the site does: 30 Sep, not the Sept en-GB Intl writes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-22T12:00:00Z'));
    const { fetchFundamentals } = await import('../prices/yahoo_fetch.js');
    vi.mocked(fetchFundamentals).mockResolvedValueOnce({ SOON: { earningsDate: sec('2026-09-30T12:30:00Z') } });
    const { container } = render(<UpcomingEarnings portfolio={/** @type {any} */ (portfolio)} />);
    expect(await screen.findByText('30 Sep')).toBeInTheDocument();
    expect(container.textContent).not.toContain('Sept');
  });

  it('shows a report from earlier today, drops one from yesterday', async () => {
    // Fixed "now": 2026-08-10 22:30 London (21:30Z, BST = UTC+1).
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-10T21:30:00Z'));
    const { fetchFundamentals } = await import('../prices/yahoo_fetch.js');
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

// The window row: the panel used to answer one question ("what moved
// TODAY") and the same book ranks differently over a month. The
// fixture below is built so the two orders are exact reverses, for the
// same reason the % / $ fixture above is: a test that passed on both
// windows would prove nothing about which window is driving the sort.
//
//   ticker    today %     1M base   1M %
//   NVDA      +5.00       100       +5.00    (1st today, 2nd over 1M)
//   BRIT.L    +1.00       100       +50.00   (2nd today, 1st over 1M)
describe('Sidebar — Top Movers window', () => {
  const dAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  // Both held since long before any window opens, so a longer window
  // measures them from its own opening close (100, seeded below).
  // OLDBUY is the third case: same stock path, bought two days ago.
  const WINDOW_MOVERS = [
    { ticker: 'NVDA',   dayPct: 5, dayChange: 50,  marketValue: 1050,
      shares: 10, fx: 1,   currency: 'USD', lastPrice: 105,
      lots: [{ date: dAgo(60), shares: 10, cost: 50 }] },
    { ticker: 'BRIT.L', dayPct: 1, dayChange: 13,  marketValue: 1950,
      shares: 10, fx: 1.3, currency: 'GBP', lastPrice: 150,
      lots: [{ date: dAgo(60), shares: 10, cost: 50 }] },
  ];
  const metricsFor = (players) => ({
    marketValue: 3000,
    positions: {
      P1: { label: 'FWD', marketValue: 3000, unrlPct: 8.5, unrlGL: 800, players },
    },
  });
  const renderSidebar = () =>
    render(<Sidebar metrics={metricsFor(WINDOW_MOVERS)} source="live" portfolio={{}}
      marketData={{}} extendedHours={false} phase="regular" hideValues={false} />);
  const columnTickers = (side) => {
    const col = document.querySelectorAll('.movers-grid > div')[side === 'gain' ? 0 : 1];
    return [...col.querySelectorAll('.mover-ticker')].map(el => el.textContent);
  };
  const columnValues = (side) => {
    const col = document.querySelectorAll('.movers-grid > div')[side === 'gain' ? 0 : 1];
    return [...col.querySelectorAll('.mover-val')].map(el => el.textContent);
  };

  /** Seed the same per-(year, range) rows the performance panel writes. */
  const seedMonthHistory = (closes) => {
    const year = new Date().getFullYear();
    const before = new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10);
    for (const [ticker, close] of Object.entries(closes)) {
      YtdStore.set(`y${year}|1M:std|${ticker}`, /** @type {any} */ ({
        ts: Date.now(), data: [{ date: before, close }],
      }));
    }
  };

  beforeEach(() => { for (const k of YtdStore.keys()) YtdStore.del(k); });

  it('offers four windows in the title row and starts on TODAY', () => {
    renderSidebar();
    expect([...document.querySelectorAll('.movers-window .view-tab')]
      .map(b => b.textContent)).toEqual(['TODAY', '1W', '1M', '3M']);
    // The selected tab IS the label, so the heading stays a name.
    expect(screen.getByText('TOP MOVERS')).toBeInTheDocument();
    expect(document.querySelector('.movers-window .view-tab.is-on')?.textContent).toBe('TODAY');
  });

  it('a longer window re-ranks the same book off the cached history', async () => {
    seedMonthHistory({ NVDA: 100, 'BRIT.L': 100 });
    const user = userEvent.setup();
    renderSidebar();
    expect(columnTickers('gain')).toEqual(['NVDA', 'BRIT']);   // displayTicker drops .L
    await user.click(screen.getByRole('tab', { name: /Rank movers over 1M/i }));
    expect(document.querySelector('.movers-window .view-tab.is-on')?.textContent).toBe('1M');
    // 100 -> 150 beats 100 -> 105, which is the reverse of today.
    expect(columnTickers('gain')).toEqual(['BRIT', 'NVDA']);
  });

  it('a holding bought inside the window shows only its move SINCE the buy', async () => {
    // The requirement, end to end. All three tickers opened the month
    // at 100. NVDA and BRIT.L have been held throughout, so they are
    // measured from there. FRESH was bought two days ago at 140 and is
    // now 150 — the book made 10 a share, not 50, and the row has to
    // say so. A panel measuring the STOCK rather than the HOLDING would
    // print +50.00% here, identical to BRIT.L.
    seedMonthHistory({ NVDA: 100, 'BRIT.L': 100, FRESH: 100 });
    const user = userEvent.setup();
    render(<Sidebar metrics={metricsFor([...WINDOW_MOVERS, {
      ticker: 'FRESH', dayPct: 2, dayChange: 20, marketValue: 1500,
      shares: 10, fx: 1, currency: 'USD', lastPrice: 150,
      lots: [{ date: dAgo(2), shares: 10, cost: 140 }],
    }])} source="live" portfolio={{}} marketData={{}}
      extendedHours={false} phase="regular" hideValues={false} />);
    await user.click(screen.getByRole('tab', { name: /Rank movers over 1M/i }));
    expect(columnTickers('gain')).toEqual(['BRIT', 'FRESH', 'NVDA']);
    //            1300 -> 1950     1400 -> 1500     1000 -> 1050
    expect(columnValues('gain')).toEqual(['+50.00%', '+7.14%', '+5.00%']);
  });

  it('says it is waiting rather than claiming nothing moved', async () => {
    // No seeded history: the window can price nothing. "—" would read
    // as "a quiet month", which is a different and wrong statement.
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('tab', { name: /Rank movers over 1M/i }));
    expect(columnTickers('gain')).toEqual([]);
    expect(screen.getAllByText('loading…')).toHaveLength(2);
  });

  it('remembers the window without dropping the rest of dp.prefs', async () => {
    localStorage.setItem('dp.prefs', JSON.stringify({ hideValues: true, moversMetric: 'usd' }));
    seedMonthHistory({ NVDA: 100, 'BRIT.L': 100 });
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('tab', { name: /Rank movers over 1M/i }));
    expect(JSON.parse(localStorage.getItem('dp.prefs') || '{}'))
      .toEqual({ hideValues: true, moversMetric: 'usd', moversWindow: '1M' });
  });

  it('fills the moment a background prefetch lands, not on the next refresh', async () => {
    // The panel has no fetch of its own — without the event it would
    // sit empty until something else re-rendered the sidebar.
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('tab', { name: /Rank movers over 1M/i }));
    expect(columnTickers('gain')).toEqual([]);
    await act(async () => {
      seedMonthHistory({ NVDA: 100, 'BRIT.L': 100 });
      window.dispatchEvent(new CustomEvent(CHARTS_UPDATED_EVENT));
    });
    expect(columnTickers('gain')).toEqual(['BRIT', 'NVDA']);
  });
});
