import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionHistoryModal, transactionRowsToMatrix, sortTransactionRows, nextSortState } from './transaction_history.jsx';
import { buildTransactionLog } from '../portfolio/transactions.js';

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
    // A sale shows the average cost it was measured against (2026-10-07),
    // so its row checks by hand: 2,400 over 20 shares = 120, and
    // 5 × (200 − 120) = 400, its Realised G/L.
    const sale = matrix.find((r) => r[0] === 'SELL');
    expect(sale?.[6]).toBe('$120.00');
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

describe('layout', () => {
  // The table shares the Holding list's `.hl-*` scaffolding but not its
  // proportions: that one is a row per holding, this one is every trade
  // ever made. The defaults wrapped `2026-07-22` onto two lines, which
  // doubled every row and turned eighteen rows into eight on screen, and
  // ran 760px wide on a 356px phone.
  beforeEach(() => cleanup());

  it('marks each cell with its column so the phone can lay them out', () => {
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    const first = document.querySelector('.txn-table tbody tr');
    expect([...(first?.children || [])].map((c) => c.getAttribute('data-col'))).toEqual(
      ['type', 'date', 'symbol', 'shares', 'price', 'amount', 'avgcost', 'gain'],
    );
  });

  it('tags the row with its direction, for the colour rail', () => {
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    const rows = [...document.querySelectorAll('.txn-table tbody tr')];
    expect(rows.every((r) => r.className.includes('txn-row-buy') || r.className.includes('txn-row-sell'))).toBe(true);
  });

  it('offers the same sort cycle as chips, for the card layout', () => {
    // Card mode has no header row to click; CSS shows exactly one of
    // the two, so both have to exist in the markup.
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    const chips = [...document.querySelectorAll('.txn-sort-chip')].map((c) => c.textContent);
    expect(chips).toEqual(['Type', 'Date', 'Symbol', 'Shares', 'Price', 'Amount', 'Avg Cost', 'Realised G/L']);
  });
});

describe('closed positions and the clickable symbol', () => {
  beforeEach(() => cleanup());
  const FILLS = [
    { ticker: 'NFLX', executed_at: '2025-12-02T14:30:00.000Z', side: 'buy', shares: 3, price: 900 },
    { ticker: 'NFLX', executed_at: '2026-06-22T14:30:00.000Z', side: 'sell', shares: 3, price: 1100 },
  ];

  it('lists trades in a ticker the board no longer carries', () => {
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false}
             t212Orders={FILLS} onClose={vi.fn()} />);
    const syms = [...document.querySelectorAll('[data-col="symbol"]')].map((c) => c.textContent);
    expect(syms).toContain('NFLX');
  });

  it('opens the chart for a ticker still on the board', async () => {
    const user = userEvent.setup();
    const onTickerClick = vi.fn();
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false}
             t212Orders={FILLS} onTickerClick={onTickerClick} onClose={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: 'NVDA' })[0]);
    expect(onTickerClick).toHaveBeenCalledWith('NVDA');
  });

  it('leaves a closed ticker as plain text — its chart has no holding', () => {
    render(<TransactionHistoryModal holdings={HOLDINGS} marketData={MARKET} hideValues={false}
             t212Orders={FILLS} onTickerClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'NFLX' })).not.toBeInTheDocument();
  });
});

// ---- A dividend received is a row of its own (Davies, 2026-10-07: "分红可以在Transaction history表中作为单独的行显示") ----
describe('dividend rows', () => {
  beforeEach(() => cleanup());
  const BOOK = {
    ABC: {
      currency: 'USD',
      lots: [{ date: '2026-01-05', shares: 10, cost: 100 }],
      sells: [{ date: '2026-03-01', shares: 10, price: 110 }],
    },
  };
  const DIVS = { ABC: [{ date: '2026-02-01', amount: 20, shares: 10, ts: Date.parse('2026-02-01T12:00:00Z') }] };

  it('a DIVS badge, the cash received, the Avg Cost after it, no Realised G/L; the sale it lowers checks by hand', () => {
    const matrix = transactionRowsToMatrix(buildTransactionLog(BOOK, DIVS));
    expect(matrix.slice(1)).toEqual([
      ['SELL', '2026-03-01', 'ABC', '10', '$110.00', '$1,100.00', '$98.00', '+$120.00 (+12.24%)'],
      ['DIVS', '2026-02-01', 'ABC', '10', '$2.00', '$20.00', '$98.00', ''],
      ['BUY', '2026-01-05', 'ABC', '10', '$100.00', '$1,000.00', '$100.00', ''],
    ]);
  });

  it('on screen: its own badge, the headline counts it, and hide-values masks its money', () => {
    render(<TransactionHistoryModal holdings={BOOK} dividends={DIVS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    expect(screen.getByText('+$120.00')).toBeInTheDocument();
    const div = /** @type {HTMLElement} */ (document.querySelector('.txn-row-div'));
    expect(within(div).getByText('DIVS')).toHaveClass('txn-badge', 'txn-div');
    expect(within(div).getByText('$20.00')).toBeInTheDocument();
    cleanup();
    render(<TransactionHistoryModal holdings={BOOK} dividends={DIVS} marketData={MARKET} hideValues onClose={vi.fn()} />);
    const row = /** @type {HTMLElement} */ (document.querySelector('.txn-row-div'));
    expect(row.querySelector('[data-col="amount"]')?.textContent).not.toMatch(/\d/);
    expect(row.querySelector('[data-col="avgcost"]')?.textContent).not.toMatch(/\d/);
  });

  it('sorts by Amount on the cash it brought in', () => {
    const rows = sortTransactionRows(buildTransactionLog(BOOK, DIVS), { col: 'amount', dir: 'asc' });
    expect(rows.map((r) => r.kind)).toEqual(['div', 'buy', 'sell']);
  });

  // Davies, 2026-10-08: one payment is one row, not one per Trading 212 account.
  const TWO_ACCOUNTS = { ABC: [
    { date: '2026-02-01', amount: 12, shares: 6, ts: Date.parse('2026-02-01T12:00:00Z') },
    { date: '2026-02-01', amount: 8, shares: 4, ts: Date.parse('2026-02-01T12:04:00Z') },
  ] };

  it('two accounts\' payment on one day is one DIVS row on screen and in the export, the headline unchanged', () => {
    const matrix = transactionRowsToMatrix(buildTransactionLog(BOOK, TWO_ACCOUNTS));
    expect(matrix.slice(1)).toEqual([
      ['SELL', '2026-03-01', 'ABC', '10', '$110.00', '$1,100.00', '$98.00', '+$120.00 (+12.24%)'],
      ['DIVS', '2026-02-01', 'ABC', '10', '$2.00', '$20.00', '$98.00', ''],
      ['BUY', '2026-01-05', 'ABC', '10', '$100.00', '$1,000.00', '$100.00', ''],
    ]);
    render(<TransactionHistoryModal holdings={BOOK} dividends={TWO_ACCOUNTS} marketData={MARKET} hideValues={false} onClose={vi.fn()} />);
    expect(document.querySelectorAll('.txn-row-div')).toHaveLength(1);
    expect(screen.getByText('+$120.00')).toBeInTheDocument();
    cleanup();
    render(<TransactionHistoryModal holdings={BOOK} dividends={TWO_ACCOUNTS} marketData={MARKET} hideValues onClose={vi.fn()} />);
    const row = /** @type {HTMLElement} */ (document.querySelector('.txn-row-div'));
    expect(within(row).getByText('DIVS')).toBeInTheDocument();
    expect(row.querySelector('[data-col="amount"]')?.textContent).not.toMatch(/\d/);
  });

  it('a dividend paid on an unknown quantity shows dashes for shares and price, and its amount', () => {
    const matrix = transactionRowsToMatrix(buildTransactionLog(BOOK, { ABC: [{ date: '2026-02-01', amount: 20 }] }));
    expect(matrix.find((r) => r[0] === 'DIVS')?.slice(3, 6)).toEqual(['—', '—', '$20.00']);
  });
});
