import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildSectorGroups, sortSectorGroups, SectorsListModal } from './sectors_list.jsx';
import { sectorGroupsToMatrix } from './holdings_export.js';

// metrics-shaped fixture: two non-cash sectors + a cash-only GK + an empty
// position. label = board position, subtitle = sector name.
const METRICS = {
  marketValue: 10000,
  positions: {
    CM: {
      label: 'CM', subtitle: 'BIG 7', role: 'MID', players: [
        { ticker: 'NVDA', shares: 50, cost: 100, fx: 1, marketValue: 6000, dayChange: 300, dayPct: 5.0 },
        { ticker: 'AAPL', shares: 20, cost: 150, fx: 1, marketValue: 2000, dayChange: -40, dayPct: -2.0 },
      ],
    },
    LW: {
      label: 'LW', subtitle: 'BTC', role: 'FWD', players: [
        { ticker: 'MSTR', shares: 10, cost: 120, fx: 1, marketValue: 1000, dayChange: 50, dayPct: 5.26 },
      ],
    },
    GK: {
      label: 'GK', subtitle: 'Cash', role: 'GK', players: [
        { ticker: 'CASH', isCash: true, shares: 1, cost: 0, fx: 1, marketValue: 1000, dayChange: 0, dayPct: 0 },
      ],
    },
    CB1: { label: 'CB', subtitle: '', role: 'DEF', players: [] }, // empty → no group
  },
};

describe('buildSectorGroups', () => {
  it('groups by position, excludes cash + empty positions, aggregates from members', () => {
    const groups = buildSectorGroups(METRICS, { NVDA: 'NVIDIA Corporation' });
    expect(groups.map(g => g.key)).toEqual(['CM', 'LW']); // GK (cash) + CB1 (empty) dropped
    const cm = /** @type {any} */ (groups.find(g => g.key === 'CM'));
    expect(cm.label).toBe('CM');
    expect(cm.subtitle).toBe('BIG 7');
    expect(cm.rows.map(r => r.ticker).sort()).toEqual(['AAPL', 'NVDA']);
    // Aggregates summed from the members.
    expect(cm.agg.marketValue).toBeCloseTo(8000, 4);
    expect(cm.agg.exposure).toBeCloseTo(80, 4);      // 8000 / 10000
    expect(cm.agg.costBasis).toBeCloseTo(8000, 4);   // 5000 + 3000
    expect(cm.agg.dayChange).toBeCloseTo(260, 4);    // 300 - 40
    expect(cm.agg.unrlGL).toBeCloseTo(0, 4);         // 8000 - 8000
    // Member name falls back to '--' when not in the map.
    expect(/** @type {any} */ (cm.rows.find(r => r.ticker === 'AAPL')).name).toBe('--');
  });

  it('handles empty / missing metrics', () => {
    expect(buildSectorGroups(null)).toEqual([]);
    expect(buildSectorGroups({ marketValue: 0, positions: {} })).toEqual([]);
  });
});

describe('sortSectorGroups', () => {
  const groups = buildSectorGroups(METRICS);

  it('default exposure desc sorts sectors AND members high→low', () => {
    const out = sortSectorGroups(groups, 'exposure', 'desc');
    expect(out.map(g => g.key)).toEqual(['CM', 'LW']);          // 80% before 10%
    expect(out[0].rows.map(r => r.ticker)).toEqual(['NVDA', 'AAPL']); // 60% before 20%
  });

  it('exposure asc flips both levels', () => {
    const out = sortSectorGroups(groups, 'exposure', 'asc');
    expect(out.map(g => g.key)).toEqual(['LW', 'CM']);
    expect(out[1].rows.map(r => r.ticker)).toEqual(['AAPL', 'NVDA']);
  });

  it('dayChange desc ranks sectors by aggregate, members by their own', () => {
    const out = sortSectorGroups(groups, 'dayChange', 'desc');
    expect(out.map(g => g.key)).toEqual(['CM', 'LW']);          // +260 before +50
    expect(out[0].rows.map(r => r.ticker)).toEqual(['NVDA', 'AAPL']); // +300 before -40
  });

  it('Symbol (text) sorts sectors by name, members by ticker', () => {
    const out = sortSectorGroups(groups, 'ticker', 'asc');
    expect(out.map(g => g.key)).toEqual(['CM', 'LW']);          // "CM BIG 7" < "LW BTC"
    expect(out[0].rows.map(r => r.ticker)).toEqual(['AAPL', 'NVDA']);
  });

  it('does not mutate the input groups or their rows', () => {
    const before = groups.map(g => g.rows.map(r => r.ticker).join(','));
    sortSectorGroups(groups, 'exposure', 'asc');
    expect(groups.map(g => g.rows.map(r => r.ticker).join(','))).toEqual(before);
  });
});

describe('sectorGroupsToMatrix', () => {
  it('flat rows with a leading Sector column + the Holding-list headers', () => {
    const groups = sortSectorGroups(buildSectorGroups(METRICS), 'exposure', 'desc');
    const m = sectorGroupsToMatrix(groups);
    expect(m[0]).toEqual(['Sector', 'Symbol', 'Name', 'Exposure', 'Cost Basis', 'Market Value', 'Day Change', 'Day Change %', 'Unrealized G/L', 'Unrealized G/L %']);
    // 3 holdings across 2 sectors, no interleaved group rows.
    expect(m).toHaveLength(4);
    expect(m[1][0]).toBe('CM · BIG 7'); // sector label · name
    expect(m[1][1]).toBe('NVDA');
    expect(m.some(r => r[0] === 'LW · BTC' && r[1] === 'MSTR')).toBe(true);
  });
});

describe('SectorsListModal', () => {
  beforeEach(() => cleanup());

  it('renders sector headers (position + sector name) with members nested beneath', () => {
    render(<SectorsListModal metrics={METRICS} hideValues={false} onTickerClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('CM')).toBeInTheDocument();
    expect(screen.getByText(/BIG 7/)).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('MSTR')).toBeInTheDocument();
    // Cash never appears.
    expect(screen.queryByText('CASH')).not.toBeInTheDocument();
  });

  it('clicking a member symbol opens that ticker', async () => {
    const user = userEvent.setup();
    const onTickerClick = vi.fn();
    render(<SectorsListModal metrics={METRICS} hideValues={false} onTickerClick={onTickerClick} onClose={vi.fn()} />);
    await user.click(screen.getByText('NVDA'));
    expect(onTickerClick).toHaveBeenCalledWith('NVDA');
  });

  it('renders the shared copy + download export buttons', () => {
    render(<SectorsListModal metrics={METRICS} hideValues={false} onTickerClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Copy table including header')).toBeInTheDocument();
    expect(screen.getByLabelText('Download as Excel')).toBeInTheDocument();
  });
});
