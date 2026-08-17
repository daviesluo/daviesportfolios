// Investment Performance: the account in dollars — what the portfolio is
// worth against what was actually paid into it.
//
// The interesting logic is the merge. Stored 5-minute samples are the
// truth wherever they exist (they're what the scoreboard read at the
// time, and they cover tickers whose price history is no longer
// fetched); ledger-derived points fill everything older, so a book that
// predates the sampler still charts its whole history instead of
// starting the day the feature shipped.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InvestmentChart, mergeSeries, rangeStartMs, deriveSeries } from './investment_chart.jsx';

beforeEach(cleanup);

const pt = (ts, value, deposit) => ({ ts, value, deposit });

describe('mergeSeries', () => {
  it('prefers stored samples and fills only OLDER gaps from the ledger', () => {
    const snaps = [pt(500, 110, 100), pt(600, 120, 100)];
    const derived = [pt(300, 90, 100), pt(400, 95, 100), pt(550, 999, 999)];
    const out = mergeSeries(snaps, derived, 0);
    // The derived point at 550 sits INSIDE the sampled span and is
    // dropped — interleaving a recomputation with recorded figures makes
    // the line visibly jitter between two answers for the same moment.
    expect(out.map(p => p.ts)).toEqual([300, 400, 500, 600]);
    expect(out.map(p => p.value)).toEqual([90, 95, 110, 120]);
  });

  it('drops everything before the window start', () => {
    const out = mergeSeries([pt(500, 1, 1)], [pt(100, 1, 1)], 400);
    expect(out.map(p => p.ts)).toEqual([500]);
  });

  it('falls back to the derived series when nothing was ever sampled', () => {
    const derived = [pt(100, 90, 100), pt(200, 105, 100)];
    expect(mergeSeries([], derived, 0)).toEqual(derived);
  });

  it('is empty when neither source has anything in the window', () => {
    expect(mergeSeries([], [], 0)).toEqual([]);
  });
});

describe('rangeStartMs', () => {
  const now = Date.parse('2026-08-14T12:00:00Z');
  it('measures the fixed-span ranges back from now', () => {
    expect(now - rangeStartMs('1D', now)).toBe(24 * 3600_000);
    expect(now - rangeStartMs('1W', now)).toBe(7 * 24 * 3600_000);
  });
  it('measures YTD from Jan 1, not a fixed span', () => {
    expect(rangeStartMs('YTD', now)).toBe(new Date(2026, 0, 1).getTime());
  });
});

describe('deriveSeries', () => {
  it('turns ledger points into a timestamped value / deposit series', () => {
    const portfolio = { holdings: {
      NVDA: { currency: 'USD', lots: [{ date: '2026-01-05', shares: 10, cost: 100 }] },
    } };
    const tickerSeries = {
      NVDA: {
        series: [{ date: '2026-01-05', close: 100 }, { date: '2026-02-01', close: 130 }],
        map: { '2026-01-05': 100, '2026-02-01': 130 },
        janPrice: 100,
      },
    };
    const out = deriveSeries({
      portfolio, tickerSeries, marketData: {}, fxToUSD: () => 1,
      dates: ['2026-01-05', '2026-02-01'],
    });
    expect(out.map(p => p.value)).toEqual([1000, 1300]);
    expect(out.map(p => p.deposit)).toEqual([1000, 1000]);
    expect(out[0].ts).toBe(Date.parse('2026-01-05T00:00:00Z'));
  });
});

describe('InvestmentChart', () => {
  const series = [pt(1, 1000, 1000), pt(2, 1100, 1000), pt(3, 1250, 1000)];

  it('draws both lines and reports the gap as the gain', () => {
    const { container } = render(
      <InvestmentChart series={series} rangeKey="1M" setRangeKey={vi.fn()} />,
    );
    expect(container.querySelectorAll('path')).toHaveLength(2);
    // 1250 value − 1000 deposited = +250, i.e. +25% on what was paid in.
    expect(screen.getByText(/\+25\.00%/)).toBeInTheDocument();
  });

  it('shows the empty state rather than a one-point line', () => {
    render(<InvestmentChart series={[pt(1, 100, 100)]} rangeKey="1D" setRangeKey={vi.fn()} />);
    expect(screen.getByText(/Insufficient data/i)).toBeInTheDocument();
  });

  it('omits the percentage when nothing is deposited (profits exceed cash in)', () => {
    // Net deposit can legitimately reach 0 or go negative once realised
    // gains exceed everything ever paid in — a percentage of that is
    // meaningless, so only the dollar figure is shown.
    render(
      <InvestmentChart
        series={[pt(1, 500, 0), pt(2, 600, 0)]}
        rangeKey="1M" setRangeKey={vi.fn()}
      />,
    );
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('masks the figures when hideValues is on', () => {
    render(<InvestmentChart series={series} rangeKey="1M" setRangeKey={vi.fn()} hideValues />);
    expect(screen.queryByText(/1,250/)).not.toBeInTheDocument();
  });
});
