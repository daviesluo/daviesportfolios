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

describe('EditTickerModal — one list, newest first', () => {
  it('"+ Add sell" puts the new row at the TOP and Save splits it out', async () => {
    const user = userEvent.setup();
    const { props } = renderModal(); // HOLDING = 18.5 sh @ 172.62, no sells
    await user.click(screen.getByRole('button', { name: /^\+ Add sell$/ }));
    // Newest belongs at the top, so the fresh row's inputs come FIRST.
    const numInputs = screen.getAllByPlaceholderText('0');
    await user.clear(numInputs[0]); await user.type(numInputs[0], '8');
    await user.clear(numInputs[1]); await user.type(numInputs[1], '200');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    const patch = props.onSave.mock.calls[0][0];
    expect(patch.lots).toHaveLength(1);
    expect(patch.sells).toHaveLength(1);
    expect(patch.sells[0]).toMatchObject({ shares: 8, price: 200 });
  });

  it('shows buys and sells interleaved by date, most recent at the top', () => {
    renderModal({
      holding: {
        ...HOLDING, shares: 5,
        lots: [
          { date: '2025-01-02', shares: 10, cost: 100 },
          { date: '2026-03-04', shares: 2, cost: 300 },
        ],
        sells: [{ date: '2025-06-05', shares: 7, price: 200 }],
      },
    });
    const kinds = [...document.querySelectorAll('.lot-grid-row .kind-toggle')]
      .map((b) => b.textContent);
    const dates = [...document.querySelectorAll('.lot-grid-row input[type=date]')]
      .map((i) => /** @type {HTMLInputElement} */ (i).value);
    expect(dates).toEqual(['2026-03-04', '2025-06-05', '2025-01-02']);
    expect(kinds).toEqual(['BUY', 'SELL', 'BUY']);
  });

  it('flips a row between buy and sell in place', async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    await user.click(screen.getByRole('button', { name: /Buy — click to switch/ }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    const patch = props.onSave.mock.calls[0][0];
    expect(patch.lots).toHaveLength(0);
    expect(patch.sells).toHaveLength(1);
    expect(patch.sells[0]).toMatchObject({ shares: 18.5, price: 172.62 });
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

describe('EditTickerModal — where the rows came from', () => {
  // AVGO on the board: 18.5 shares, all of them at Trading 212.
  const SYNCED = {
    ...HOLDING, shares: 18.5, t212Shares: 18.5,
    lots: [
      { date: '2025-04-01', shares: 10, cost: 170 },
      { date: '2025-04-07', shares: 8.5, cost: 175.7 },
    ],
  };
  const FILLS = [
    { ticker: 'AVGO', executed_at: '2025-04-01T13:45:00.000Z', side: 'buy', shares: 10, price: 170 },
    { ticker: 'AVGO', executed_at: '2025-04-07T13:45:00.000Z', side: 'buy', shares: 8.5, price: 175.7 },
  ];

  it('says the rows are the broker\'s own trades once they are', () => {
    renderModal({ holding: SYNCED, t212Orders: FILLS });
    expect(screen.getByText(/Synced from Trading 212/)).toBeInTheDocument();
  });

  it('counts the ones bought elsewhere separately', () => {
    renderModal({
      holding: {
        ...SYNCED, shares: 20.5, t212Shares: 18.5,
        lots: [...SYNCED.lots, { date: '2025-01-02', shares: 2, cost: 150, src: 'other' }],
      },
      t212Orders: FILLS,
    });
    expect(screen.getByText(/plus your Robinhood buys/)).toBeInTheDocument();
  });

  it('says the history is still downloading when the fills do not cover the position', () => {
    // The board holds 60, the walk has reached 33.5. Nothing is rewritten
    // and the modal says why rather than showing a stale ledger silently.
    renderModal({
      ticker: 'NVDA',
      holding: { shares: 60, cost: 136.1, currency: 'USD', t212Shares: 60, lots: [{ date: '2025-01-01', shares: 60, cost: 136.1 }] },
      t212Orders: [{ ticker: 'NVDA', executed_at: '2026-03-27T13:45:00.000Z', side: 'buy', shares: 33.5, price: 157.19 }],
    });
    expect(screen.getByText(/Still loading from Trading 212/)).toBeInTheDocument();
  });

  it('stops saying that once the backfill has finished', () => {
    renderModal({
      ticker: 'NVDA',
      holding: { shares: 60, cost: 136.1, currency: 'USD', t212Shares: 60, lots: [{ date: '2025-01-01', shares: 60, cost: 136.1 }] },
      t212Orders: [{ ticker: 'NVDA', executed_at: '2026-03-27T13:45:00.000Z', side: 'buy', shares: 33.5, price: 157.19 }],
      t212OrdersComplete: true,
    });
    expect(screen.queryByText(/Still loading from Trading 212/)).not.toBeInTheDocument();
  });

  it('says nothing for a holding the broker never had', () => {
    renderModal({
      ticker: 'BTC-USD',
      holding: { shares: 0.075, cost: 65495, currency: 'USD', lots: [{ date: '2026-02-11', shares: 0.075, cost: 65495 }] },
      t212Orders: FILLS,
    });
    expect(screen.queryByText(/Trading 212/)).not.toBeInTheDocument();
  });

  it('marks a hand-added lot as the owner\'s so the sync cannot replace it', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ holding: SYNCED, t212Orders: FILLS });
    await user.click(screen.getByRole('button', { name: /\+ Add buy/ }));
    const nums = screen.getAllByPlaceholderText('0');   // new row is FIRST
    await user.type(nums[0], '3');
    await user.type(nums[1], '400');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    const added = props.onSave.mock.calls[0][0].lots.find((l) => l.shares === 3);
    expect(added.src).toBe('other');
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
    expect(warn.textContent).toMatch(/add up to 30 shares/);
    expect(warn.textContent).toMatch(/not the 160 you hold/);
    expect(warn.textContent).toMatch(/drops the other 130/);
  });

  it('stays quiet when the ledger matches the board', () => {
    renderModal();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
