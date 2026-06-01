import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildHoldingsRows, sortHoldingsRows, HoldingsListModal } from './holdings_list.jsx';

// metrics-shaped fixture: two positions, three holdings + cash.
const METRICS = {
  marketValue: 10000,
  positions: {
    CM: {
      label: 'CM', players: [
        { ticker: 'NVDA', shares: 50, cost: 100, fx: 1, marketValue: 6000, dayChange: 300, dayPct: 5.0 },
        { ticker: 'AAPL', shares: 20, cost: 150, fx: 1, marketValue: 2000, dayChange: -40, dayPct: -2.0 },
      ],
    },
    GK: {
      label: 'GK', players: [
        { ticker: 'CASH', isCash: true, shares: 1, cost: 0, fx: 1, marketValue: 1000, dayChange: 0, dayPct: 0 },
      ],
    },
    LW: {
      label: 'LW', players: [
        { ticker: 'MSTR', shares: 10, cost: 120, fx: 1, marketValue: 1000, dayChange: 50, dayPct: 5.26 },
      ],
    },
  },
};

describe('buildHoldingsRows', () => {
  it('flattens players, excludes cash, computes exposure / cost / unrl', () => {
    const rows = buildHoldingsRows(METRICS, { NVDA: 'NVIDIA Corporation' });
    expect(rows.map(r => r.ticker).sort()).toEqual(['AAPL', 'MSTR', 'NVDA']); // no CASH
    const nvda = rows.find(r => r.ticker === 'NVDA');
    expect(nvda.exposure).toBeCloseTo(60, 4);      // 6000 / 10000
    expect(nvda.costBasis).toBeCloseTo(5000, 4);   // 50 * 100 * 1
    expect(nvda.unrlGL).toBeCloseTo(1000, 4);      // 6000 - 5000
    expect(nvda.unrlPct).toBeCloseTo(20, 4);       // 1000 / 5000
    expect(nvda.name).toBe('NVIDIA Corporation');
    expect(rows.find(r => r.ticker === 'AAPL').name).toBe('--'); // not in the map
  });

  it('handles empty / missing metrics', () => {
    expect(buildHoldingsRows(null)).toEqual([]);
    expect(buildHoldingsRows({})).toEqual([]);
    expect(buildHoldingsRows({ marketValue: 0, positions: {} })).toEqual([]);
  });
});

describe('sortHoldingsRows', () => {
  const rows = buildHoldingsRows(METRICS);
  it('sorts numerically desc / asc', () => {
    expect(sortHoldingsRows(rows, 'exposure', 'desc').map(r => r.ticker)).toEqual(['NVDA', 'AAPL', 'MSTR']);
    expect(sortHoldingsRows(rows, 'exposure', 'asc').map(r => r.ticker)).toEqual(['MSTR', 'AAPL', 'NVDA']);
    expect(sortHoldingsRows(rows, 'dayChange', 'desc')[0].ticker).toBe('NVDA');
    expect(sortHoldingsRows(rows, 'dayChange', 'asc')[0].ticker).toBe('AAPL');
  });
  it('sorts text lexically', () => {
    expect(sortHoldingsRows(rows, 'ticker', 'asc').map(r => r.ticker)).toEqual(['AAPL', 'MSTR', 'NVDA']);
  });
  it('does not mutate the input', () => {
    const before = rows.map(r => r.ticker);
    sortHoldingsRows(rows, 'exposure', 'asc');
    expect(rows.map(r => r.ticker)).toEqual(before);
  });
});

describe('HoldingsListModal', () => {
  beforeEach(() => cleanup());

  it('renders rows sorted by exposure desc by default + clicking a ticker fires onTickerClick', async () => {
    const user = userEvent.setup();
    const onTickerClick = vi.fn();
    render(<HoldingsListModal metrics={METRICS} hideValues={false} onTickerClick={onTickerClick} onClose={vi.fn()} />);
    const firstRow = screen.getAllByRole('row').slice(1)[0];
    expect(within(firstRow).getByText('NVDA')).toBeInTheDocument(); // exposure desc default
    await user.click(screen.getByText('NVDA')); // clicking the symbol → onTickerClick
    expect(onTickerClick).toHaveBeenCalledWith('NVDA');
  });

  it('clicking a column header re-sorts', async () => {
    const user = userEvent.setup();
    render(<HoldingsListModal metrics={METRICS} hideValues={false} onTickerClick={vi.fn()} onClose={vi.fn()} />);
    // Click "Day Change" → desc → NVDA (+300) first.
    await user.click(screen.getByText(/Day Change/));
    let first = screen.getAllByRole('row').slice(1)[0];
    expect(within(first).getByText('NVDA')).toBeInTheDocument();
    // Click again → asc → AAPL (-40) first.
    await user.click(screen.getByText(/Day Change/));
    first = screen.getAllByRole('row').slice(1)[0];
    expect(within(first).getByText('AAPL')).toBeInTheDocument();
  });
});
