import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { TransactionHistoryModal, transactionRowsToMatrix, sortTransactionRows, nextSortState } from './transaction_history.jsx';
import { buildTransactionLog } from './transactions.js';

// EUR/USD = 1.1 so the cross-currency realized total can be checked.
const MARKET = { 'EURUSD=X': { lastPrice: 1.1 } };

const HOLDINGS = {
  NVDA: {
    currency: 'USD',
    lots: [{ date: '2026-01-10', shares: 10, cost: 100 }],
    sells: [{ date: '2026-03-05', shares: 4, price: 130 }], // realized +120 USD
  },
  'XFAB.PA': {
    currency: 'EUR',
    lots: [{ date: '2026-02-01', shares: 50, cost: 8 }],
  },
  CASH: { isCash: true, shares: 1, cost: 0 },
  // CLOSED holding (net 0, off the board, kept) still shows its history.
  OLDCO: {
    currency: 'USD', closed: true, shares: 0,
    lots: [{ date: '2026-01-02', shares: 5, cost: 50 }],
    sells: [{ date: '2026-02-20', shares: 5, price: 70 }], // realized +100 USD
  },
};

describe('TransactionHistoryModal', () => {
  beforeEach(() => cleanup());

  it('headlines total realized G/L in USD across holdings (incl. closed)', () => {
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    // NVDA +120 + OLDCO +100 = +220 (XFAB has no sells). USD.
    expect(screen.getByText('+$220.00')).toBeInTheDocument();
  });

  it('lists every buy + sell newest-first, with BUY/SELL badges and the closed holding', () => {
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    const bodyRows = screen.getAllByRole('row').slice(1); // drop the header row
    // Newest first: NVDA sell (03-05) is row 0.
    expect(within(bodyRows[0]).getByText('NVDA')).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText('SELL')).toBeInTheDocument();
    // 5 transactions total (2 NVDA, 1 XFAB, 2 OLDCO); CASH excluded.
    expect(bodyRows).toHaveLength(5);
    // The closed holding's records are present.
    expect(screen.getAllByText('OLDCO')).toHaveLength(2);
  });

  it('renders the EUR buy in its native symbol', () => {
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    // 50 × €8 = €400.00 amount.
    expect(screen.getByText('€400.00')).toBeInTheDocument();
  });

  it('empty state when there are no transactions', () => {
    render(<TransactionHistoryModal holdings={{ CASH: { isCash: true } }} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
  });

  it('renders the copy + download export buttons (shared with Holding list)', () => {
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Copy table including header')).toBeInTheDocument();
    expect(screen.getByLabelText('Download as Excel')).toBeInTheDocument();
  });
});

describe('transactionRowsToMatrix', () => {
  it('header + a row per transaction, native-currency price/amount', () => {
    const rows = buildTransactionLog(HOLDINGS);
    const matrix = transactionRowsToMatrix(rows);
    expect(matrix[0]).toEqual(['Type', 'Date', 'Symbol', 'Shares', 'Price', 'Amount', 'Avg Cost', 'Realised G/L']);
    expect(matrix).toHaveLength(rows.length + 1);
    // The EUR buy: 50 sh @ €8 → €400.00 amount, and the average cost it
    // leaves behind in the last column.
    const eur = matrix.find((r) => r[2] === 'XFAB.PA');
    expect(eur).toEqual(['BUY', '2026-02-01', 'XFAB.PA', '50', '€8.00', '€400.00', '€8.00', '']);
    // A SELL row carries the SELL label.
    expect(matrix.some((r) => r[2] === 'NVDA' && r[0] === 'SELL')).toBe(true);
  });
});

describe('what each row did to the position', () => {
  // Buy 10 @ 100, buy 10 @ 140, sell 5 @ 200. Under the net-cash model
  // the AC after the second buy is 120, and the sale banks
  // 5 × (200 − 120) = 400, which is +66.67% on what those shares cost.
  const LEDGER = {
    X: {
      currency: 'USD',
      lots: [
        { date: '2026-01-01', shares: 10, cost: 100 },
        { date: '2026-02-01', shares: 10, cost: 140 },
      ],
      sells: [{ date: '2026-03-01', shares: 5, price: 200 }],
    },
  };

  it('annotates a purchase with the average cost it leaves behind', () => {
    const rows = buildTransactionLog(LEDGER);
    const second = rows.find((r) => r.date === '2026-02-01');
    expect(second?.acAfter).toBeCloseTo(120, 9);
    expect(second?.gain).toBeNull();
  });

  it("annotates a sale with what it banked, and the percent it made", () => {
    const sale = buildTransactionLog(LEDGER).find((r) => r.kind === 'sell');
    expect(sale?.gain).toBeCloseTo(400, 9);
    expect(sale?.gainPct).toBeCloseTo(66.6667, 4);
  });

  it('gives the average cost its own column, filled for buys AND sells', () => {
    const matrix = transactionRowsToMatrix(buildTransactionLog(LEDGER));
    const buy = matrix.find((r) => r[1] === '2026-02-01');
    expect(buy?.[6]).toBe('$120.00');
    // A sale changes the average cost too — the cash it returns comes
    // off the basis of what's left — so this column reads for both.
    // 2,400 of net cash behind 20 shares; the sale returns 1,000 and
    // takes 5 away, leaving 1,400 over 15 = 93.33.
    const sale = matrix.find((r) => r[0] === 'SELL');
    expect(sale?.[6]).toBe('$93.33');
  });

  it('puts the realized gain last, and leaves it blank on a purchase', () => {
    const matrix = transactionRowsToMatrix(buildTransactionLog(LEDGER));
    expect(matrix.find((r) => r[0] === 'SELL')?.[7]).toBe('+$400.00 (+66.67%)');
    expect(matrix.find((r) => r[1] === '2026-02-01')?.[7]).toBe('');
  });

  it('leaves the percentage off a sale out of a zero-cost position', () => {
    const rows = buildTransactionLog({
      Y: { currency: 'USD', lots: [{ date: '2026-01-01', shares: 5, cost: 0 }], sells: [{ date: '2026-02-01', shares: 5, price: 30 }] },
    });
    const sale = rows.find((r) => r.kind === 'sell');
    expect(sale?.gain).toBeCloseTo(150, 9);
    expect(sale?.gainPct).toBeNull();
    expect(transactionRowsToMatrix(rows).find((r) => r[0] === 'SELL')?.[7]).toBe('+$150.00');
  });
});

describe('sortTransactionRows / nextSortState', () => {
  const rows = [
    { kind: 'buy',  date: '2026-01-01', ticker: 'B', shares: 3, price: 10, acAfter: 10, gain: null },
    { kind: 'sell', date: '2026-03-01', ticker: 'A', shares: 1, price: 50, acAfter: 10, gain: 40 },
    { kind: 'buy',  date: '2026-02-01', ticker: 'C', shares: 2, price: 20, acAfter: 15, gain: null },
  ];

  it('hands back the default order untouched when nothing is sorted', () => {
    expect(sortTransactionRows(rows, null)).toBe(rows);
  });

  it('sorts by a column in both directions', () => {
    expect(sortTransactionRows(rows, { col: 'symbol', dir: 'asc' }).map((r) => r.ticker))
      .toEqual(['A', 'B', 'C']);
    expect(sortTransactionRows(rows, { col: 'shares', dir: 'desc' }).map((r) => r.shares))
      .toEqual([3, 2, 1]);
  });

  it('sorts the two outcome columns independently', () => {
    // Purchases realize nothing, so they sort as zero — between the
    // profitable sales and the losing ones, which is where they belong.
    expect(sortTransactionRows(rows, { col: 'gain', dir: 'desc' }).map((r) => r.ticker))
      .toEqual(['A', 'B', 'C']);
    expect(sortTransactionRows(rows, { col: 'avgcost', dir: 'desc' }).map((r) => r.ticker))
      .toEqual(['C', 'B', 'A']);
  });

  it('cycles a header desc → asc → back to the default', () => {
    const a = nextSortState(null, 'date');
    expect(a).toEqual({ col: 'date', dir: 'desc' });
    const b = nextSortState(a, 'date');
    expect(b).toEqual({ col: 'date', dir: 'asc' });
    expect(nextSortState(b, 'date')).toBeNull();
    // A different header starts its own cycle at descending.
    expect(nextSortState(b, 'price')).toEqual({ col: 'price', dir: 'desc' });
  });
});
