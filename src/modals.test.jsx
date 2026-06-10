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
    // up front instead of letting the lot vanish with no feedback.
    expect(screen.getByRole('alert').textContent).toMatch(/1 lot is dated in the future/);
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
    expect(screen.getByRole('alert').textContent).toMatch(/2 lots are dated in the future/);
  });
});
