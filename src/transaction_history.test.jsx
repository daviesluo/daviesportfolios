import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { TransactionHistoryModal } from './transaction_history.jsx';

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
});
