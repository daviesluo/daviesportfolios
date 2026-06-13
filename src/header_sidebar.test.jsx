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
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { Header } from './header_sidebar.jsx';

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
