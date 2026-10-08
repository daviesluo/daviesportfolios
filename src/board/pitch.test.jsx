// @vitest-environment jsdom
// The tactics board's position cards while the exchange rates are still loading (review batch 5). Before the first
// market data lands, a holding priced in another currency is valued at 1:1 (metrics.js's `fxPendingOf`): the browser
// sweep's centre-back card read $790 for a $642.50 position. Such a card waits with a dash, as the scoreboard does
// since 2026-10-08; a card of dollar holdings reads at once.
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { Pitch } from './pitch.jsx';

const metricsWith = (cbValue) => ({
  marketValue: cbValue + 1440,
  positions: {
    CB1: {
      label: 'CB', subtitle: 'London', role: 'DEF', tickers: ['BRIT.L'], marketValue: cbValue, dayPct: 4.17,
      players: [{ ticker: 'BRIT.L', marketValue: cbValue, dayPct: 4.17, fxMissing: true }],
    },
    CM: {
      label: 'CM', subtitle: 'Dollars', role: 'MID', tickers: ['ACME'], marketValue: 1440, dayPct: 0.84,
      players: [{ ticker: 'ACME', marketValue: 1440, dayPct: 0.84, fxMissing: false }],
    },
  },
});

const renderPitch = (fxPending, cbValue = 790) => render(
  <Pitch metrics={metricsWith(cbValue)} captainTicker={null} hotMoverTicker={null} hotMoverPosKey={null} flashTickers={{}}
    editMode={false} isReadOnly={false} onOpenPosition={() => {}} onAddToPosition={() => {}} onUpdatePosition={() => {}}
    onSwapPositions={() => {}} hideValues={false} fxPending={fxPending} />,
);
/** Each card's value and day move, with the move's colour class. */
const cards = () => Object.fromEntries([...document.querySelectorAll('.pos-chip[data-poskey]')].map((el) => [
  el.getAttribute('data-poskey'),
  [el.querySelector('.chip-mv')?.textContent, el.querySelector('.chip-pct')?.textContent,
    [...(el.querySelector('.chip-pct')?.classList ?? [])].find((c) => ['gain', 'loss', 'flat'].includes(c))],
]));

describe('Pitch — a card holding something at 1:1 waits for the exchange rates', () => {
  beforeEach(() => cleanup());

  it('dashes the value and the move, without colour, until the rates are in; a dollar card reads at once', () => {
    renderPitch(true);
    expect(cards()).toEqual({ CB1: ['—', '—', 'flat'], CM: ['$1,440', '+0.84%', 'gain'] });
    expect(document.body.textContent).not.toContain('$790');
  });

  it('reads the converted value once the rates are in', () => {
    renderPitch(false, 642.5);
    expect(cards()).toEqual({ CB1: ['$642.50', '+4.17%', 'gain'], CM: ['$1,440', '+0.84%', 'gain'] });
  });
});
