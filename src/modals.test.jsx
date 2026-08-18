// Interaction coverage for EditTickerModal's "Move holding" flow — the
// two-step position picker that relocates a holding on the tactics
// board. Regression net for the picker's option set (excludes GK + the
// current slot) and the onMove callback wiring.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditTickerModal } from './modals.jsx';

const POSITIONS = {
  GK:  { label: 'GK',  subtitle: 'Cash',     role: 'GK',  tickers: ['CASH'] },
  CB2: { label: 'CB',  subtitle: 'BRK.B',    role: 'DEF', tickers: ['BRK-B'] },
  CAM: { label: 'CM',  subtitle: 'AI Infra', role: 'MID', tickers: ['AVGO', 'TSM'] },
  LW:  { label: 'LW',  subtitle: 'BTC',      role: 'FWD', tickers: ['MSTR'] },
};

const HOLDING = { shares: 18.5, cost: 172.62, currency: 'USD', lots: [{ date: '2025-04-01', shares: 18.5, cost: 172.62 }] };

function renderModal(over = {}) {
  const props = {
    ticker: 'AVGO',
    holding: HOLDING,
    positions: POSITIONS,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    ...over,
  };
  return { props, ...render(<EditTickerModal {...props} />) };
}

beforeEach(() => cleanup());

describe('EditTickerModal — Move holding', () => {
  it('shows a "Move holding" button next to Delete', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Move holding/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete holding/i })).toBeInTheDocument();
  });

  it('reveals the position picker on click; options exclude GK and the current slot', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /Move holding/i }));
    const select = screen.getByRole('combobox', { name: /Move holding to position/i });
    const optionLabels = within(select).getAllByRole('option').map((o) => o.textContent);
    // AVGO is in CAM → CAM excluded; GK (cash) excluded.
    expect(optionLabels).toEqual(expect.arrayContaining(['CB · BRK.B', 'LW · BTC']));
    expect(optionLabels).not.toContain('CM · AI Infra'); // current slot
    expect(optionLabels.some((l) => /Cash/.test(l ?? ''))).toBe(false); // GK
  });

  it('scrolls the revealed picker into view so a long lot list cant hide it below the fold', async () => {
    // The .move-row mounts at the bottom of the scrollable .modal-body
    // while its trigger sits in the fixed .modal-foot. For a holding with
    // a long lot/sell history the body already overflows, so without this
    // the picker reveals off-screen and the click reads as a no-op. Pin
    // that opening the picker pulls it into view.
    const spy = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByRole('button', { name: /Move holding/i }));
      expect(spy).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  it('fires onMove with the chosen position key, then nothing else', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    await user.click(screen.getByRole('button', { name: /Move holding/i }));
    const select = screen.getByRole('combobox', { name: /Move holding to position/i });
    await user.selectOptions(select, 'LW');
    await user.click(screen.getByRole('button', { name: /^Move$/i }));
    expect(props.onMove).toHaveBeenCalledTimes(1);
    expect(props.onMove).toHaveBeenCalledWith('LW');
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('hides the Move button when onMove is absent (read-only / no targets)', () => {
    renderModal({ onMove: undefined });
    expect(screen.queryByRole('button', { name: /Move holding/i })).not.toBeInTheDocument();
  });

  it('confirms discard before moving when lot edits are dirty', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    // Make the modal dirty: change a lot's shares field.
    const sharesInputs = screen.getAllByPlaceholderText('0');
    await user.clear(sharesInputs[0]);
    await user.type(sharesInputs[0], '99');

    await user.click(screen.getByRole('button', { name: /Move holding/i }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Move holding to position/i }),
      'LW',
    );

    // Move now pops the themed discard confirm (no native window.confirm).
    // Decline via the dialog's Cancel → move is aborted.
    await user.click(screen.getByRole('button', { name: /^Move$/i }));
    const dialog = /** @type {HTMLElement} */ (screen.getByText('Discard unsaved changes?').closest('.modal'));
    await user.click(within(dialog).getByRole('button', { name: /^Cancel$/i }));
    expect(props.onMove).not.toHaveBeenCalled();

    // Re-open the confirm and accept via Discard → move proceeds.
    await user.click(screen.getByRole('button', { name: /^Move$/i }));
    await user.click(screen.getByRole('button', { name: /^Discard$/i }));
    expect(props.onMove).toHaveBeenCalledWith('LW');
  });
});

describe('EditTickerModal — future-dated lot warning', () => {
  it('shows no warning when every lot is today or earlier', () => {
    renderModal();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns that a future-dated lot will be dropped on save', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    renderModal({
      holding: { ...HOLDING, lots: [...HOLDING.lots, { date: tomorrow, shares: 5, cost: 100 }] },
    });
    // cleanLots drops the row silently on save; the modal must say so
    // up front instead of letting the lot vanish with no feedback. (Wording
    // is "entry/entries" now that the warning also covers sell rows.)
    expect(screen.getByRole('alert').textContent).toMatch(/1 entry is dated in the future/);
  });

  it('pluralises for multiple future-dated lots', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    renderModal({
      holding: { ...HOLDING, lots: [
        ...HOLDING.lots,
        { date: tomorrow, shares: 5, cost: 100 },
        { date: nextWeek, shares: 2, cost: 50 },
      ] },
    });
    expect(screen.getByRole('alert').textContent).toMatch(/2 entries are dated in the future/);
  });
});

describe('EditTickerModal — sell editor', () => {
  it('"+ Sell" adds a sale row and Save records lots + sells', async () => {
    const user = userEvent.setup();
    const { props } = renderModal(); // HOLDING = 18.5 sh @ 172.62, no sells
    await user.click(screen.getByRole('button', { name: /^\+ Sell$/ }));
    // The new sale row's inputs (date/shares/price). Buy row inputs come
    // first; the sale row's shares+price are the next two '0'-placeholders.
    const numInputs = screen.getAllByPlaceholderText('0');
    // [0]=buy shares, [1]=buy cost, [2]=sale shares, [3]=sale price
    await user.clear(numInputs[2]); await user.type(numInputs[2], '8');
    await user.clear(numInputs[3]); await user.type(numInputs[3], '200');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    const patch = props.onSave.mock.calls[0][0];
    expect(patch.lots).toHaveLength(1);
    expect(patch.sells).toHaveLength(1);
    expect(patch.sells[0]).toMatchObject({ shares: 8, price: 200 });
  });

  it('shows REALIZED G/L + NET SHARES once a holding has sells', () => {
    renderModal({
      holding: {
        ...HOLDING, shares: 10, cost: 100,
        lots: [{ date: '2025-01-01', shares: 10, cost: 100 }],
        sells: [{ date: '2025-06-01', shares: 4, price: 130 }],
      },
    });
    // NET SHARES = 10 − 4 = 6; REALIZED = 4 × (130 − 100) = +120.
    expect(screen.getByText('NET SHARES')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText(/REALIZED G\/L/)).toBeInTheDocument();
    expect(screen.getByText('+120.00')).toBeInTheDocument();
  });
});

describe('EditTickerModal — Trading 212 fills', () => {
  // What the backfill stores: one row per executed fill, both accounts.
  const ORDERS = [
    { ticker: 'AVGO', executed_at: '2025-04-01T13:45:00.000Z', side: 'buy', shares: 18.5, price: 172.62 },
    { ticker: 'AVGO', executed_at: '2026-08-18T13:45:00.000Z', side: 'buy', shares: 2, price: 340.5 },
    { ticker: 'TSM',  executed_at: '2026-08-18T13:45:00.000Z', side: 'buy', shares: 1, price: 300 },
  ];

  it('lists the broker\'s fills newest first and ticks the ones already recorded', () => {
    renderModal({ t212Orders: ORDERS });
    expect(screen.getByText('TRADING 212 FILLS')).toBeInTheDocument();
    // The 2025-04-01 fill is the lot already in HOLDING; the 2026-08-18
    // one is not. Another ticker's fill never appears.
    expect(screen.getByText('2026-08-18')).toBeInTheDocument();
    expect(screen.getByText('2025-04-01')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add 1 missing/ })).toBeInTheDocument();
  });

  it('says nothing is missing when the ledger already has every fill', () => {
    renderModal({ t212Orders: [ORDERS[0]] });
    expect(screen.getByText('All recorded above.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add \d+ missing/ })).not.toBeInTheDocument();
  });

  it('stays hidden for a ticker the broker never traded', () => {
    renderModal({ t212Orders: [ORDERS[2]] });
    expect(screen.queryByText('TRADING 212 FILLS')).not.toBeInTheDocument();
  });

  it('adds only the missing fills, keeping the rows already there', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ t212Orders: ORDERS });
    await user.click(screen.getByRole('button', { name: /Add 1 missing/ }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    const patch = props.onSave.mock.calls[0][0];
    expect(patch.lots).toEqual([
      { date: '2025-04-01', shares: 18.5, cost: 172.62 },
      { date: '2026-08-18', shares: 2, cost: 340.5 },
    ]);
  });

  it('never drops a lot the broker has no record of', async () => {
    // SPCX's real shape: 71 shares bought at another platform, 59 at
    // Trading 212. The broker's history mentions only its own 59.
    const user = userEvent.setup();
    const { props } = renderModal({
      ticker: 'SPCX',
      holding: {
        shares: 130, cost: 127.84, currency: 'USD',
        lots: [
          { date: '2026-04-19', shares: 50, cost: 105.4 },
          { date: '2026-06-12', shares: 21, cost: 135 },
        ],
      },
      t212Orders: [
        { ticker: 'SPCX', executed_at: '2026-06-22T13:45:00.000Z', side: 'buy', shares: 59, price: 144.31 },
      ],
    });
    await user.click(screen.getByRole('button', { name: /Add 1 missing/ }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    const patch = props.onSave.mock.calls[0][0];
    expect(patch.lots).toHaveLength(3);
    expect(patch.lots.reduce((n, l) => n + l.shares, 0)).toBe(130);
  });
});

describe('EditTickerModal — saving can shrink the position', () => {
  it('warns when the rows account for fewer shares than the board holds', () => {
    // RKLB: 160 on the board, 30 in the ledger. Save would delete 130.
    renderModal({
      ticker: 'RKLB',
      holding: {
        shares: 160, cost: 65.38, currency: 'USD',
        lots: [{ date: '2025-11-13', shares: 30, cost: 45 }],
      },
    });
    const warn = screen.getByRole('alert');
    expect(warn.textContent).toMatch(/board holds 160/);
    expect(warn.textContent).toMatch(/only account for 30/);
    expect(warn.textContent).toMatch(/drops the other 130/);
  });

  it('stays quiet when the ledger matches the board', () => {
    renderModal();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
