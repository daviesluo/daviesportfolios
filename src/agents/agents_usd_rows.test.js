// @vitest-environment jsdom
// The OKX and Coinbase stablecoin rows in DOLLARS (Davies, 2026-10-29: "C，coinbase的也是改用美元"): a row whose payload says
// `ccy` "USD" shows its dollars on TESTING and on its page (FUNDED $600 on an OKX book), its detail in dollars
// (`quotesDetailInCcy`), and every other stablecoin row stays in pounds.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import {
  fmtFeeIn4, fmtIn4, quotesCoinbaseRow, quotesDetailInCcy, quotesOkxRow, quotesTwinRow, rowMoney,
} from './agents.js';
import { QuoteDaysTable } from './agents.jsx';

/** A quote payload, cut to what the rows and pages read: an OKX book at $600 since Deviation 2 (£450.30 at 1.3324). */
const okx = {
  venue: 'okx', ccy: 'USD', running: true, lagMinutes: 1, lastError: null,
  capitalUsd: 600, costUsd: 100.2, valueUsd: 600.2, unrealisedUsd: 0.04, realisedUsd: 0.21, todayUsd: 0.11, feesUsd: 0,
  capitalGbp: 450.3, costGbp: 75.2, valueGbp: 450.45, unrealisedGbp: 0.03, realisedGbp: 0.1576, todayGbp: 0.0826, feesGbp: 0,
  heldRungs: 1, openOrders: 5,
  detail: {
    books: [{ book: 'USDG-EUR', realisedUsd: 0.21, realisedGbp: 0.1576, lastPrice: 0.8951, fair: 0.8951, trips: 2, won: 2 }],
    rungs: [{ book: 'USDG-EUR', side: 'bid', k: 0.001, order: null, held: { base: 100, avgEntry: 0.8941, costUsd: 100.2, unrealisedUsd: 0.04, costGbp: 75.2, unrealisedGbp: 0.03 } }],
    days: [{ day: '2026-10-29', orders: 3, fills: 1, trips: 1, won: 1, realisedUsd: 0.11, realisedGbp: 0.0826, today: true }],
    trips: [{ book: 'USDG-EUR', side: 'bid', k: 0.001, pnlUsd: 0.11, pnlGbp: 0.0826, feesUsd: 0, feesGbp: 0 }],
    orders: [], inventory: null,
  },
  twin: { id: 'okxusdg', name: 'Stablecoin quotes OKX USDG', startedAt: '2026-10-28T22:00:00.000Z', mode: 'running', lastTurn: '2026-10-29T10:00:00.000Z', converting: [] },
};
/** A Coinbase arm as `coinbaseInUsd` sends it: its pounds, its dollars at its own GBP/USD (1.32), `ccy` "USD". */
const cb = {
  venue: 'coinbase', ccy: 'USD', running: true, lagMinutes: 1, lastError: null,
  capitalGbp: 2250, costGbp: 0, valueGbp: 2250, unrealisedGbp: 0, realisedGbp: 1, todayGbp: 0.5, feesGbp: 0,
  capitalUsd: 2970, costUsd: 0, valueUsd: 2970, unrealisedUsd: 0, realisedUsd: 1.32, todayUsd: 0.66, feesUsd: 0,
  heldRungs: 0, openOrders: 24, detail: { books: [], rungs: [], days: [], trips: [], orders: [], inventory: null },
  twin: { id: 'coinbase', name: 'Stablecoin quotes with Euros', startedAt: null, mode: 'running', lastTurn: '2026-10-29T10:00:00.000Z', converting: [] },
};

describe('the stablecoin rows in dollars', () => {
  it('an OKX book reads FUNDED $600 and its P&L in dollars', () => {
    const x = rowMoney(quotesOkxRow(okx));
    expect([x.ccy, x.capital, x.value, x.realised, x.today, x.unrealised]).toEqual(['USD', 600, 600.2, 0.21, 0.11, 0.04]);
    expect(x.realisedPct).toBeCloseTo(0.035, 9);                                        // on $600, not on £450
  });

  it('a Coinbase arm in dollars reads its dollars; the same arm without `ccy` (a GBP payload) still reads pounds', () => {
    const usd = rowMoney(quotesCoinbaseRow(cb));
    expect([usd.ccy, usd.capital, usd.realised]).toEqual(['USD', 2970, 1.32]);
    const { ccy: _c, ...gbpPayload } = cb;
    const gbp = rowMoney(quotesCoinbaseRow(gbpPayload));
    expect([gbp.ccy, gbp.capital, gbp.realised]).toEqual(['GBP', 2250, 1]);
  });

  it('the twins and LIVE, which send no `ccy`, stay in pounds', () => {
    const tw = { ...cb, venue: 'revx', twin: { ...cb.twin, id: 'live600', name: 'Stablecoin quotes LIVE twin' } };
    const { ccy: _c, ...noCcy } = tw;
    expect(rowMoney(quotesTwinRow(noCcy)).ccy).toBe('GBP');
  });

  it("the page's detail draws the dollars for a dollar row and is untouched for a pound row", () => {
    const d = quotesDetailInCcy(okx).detail;
    expect([d.books[0].realisedGbp, d.rungs[0].held.unrealisedGbp, d.rungs[0].held.costGbp, d.days[0].realisedGbp, d.trips[0].pnlGbp])
      .toEqual([0.21, 0.04, 100.2, 0.11, 0.11]);
    expect([d.rungs[0].held.base, d.rungs[0].held.avgEntry]).toEqual([100, 0.8941]);    // sizes and prices as sent
    const { ccy: _c, ...gbpRow } = okx;
    expect(quotesDetailInCcy(gbpRow)).toBe(gbpRow);
    expect([fmtIn4(0.1234, 'USD'), fmtIn4(0.1234, 'GBP'), fmtFeeIn4(0.09, 'USD'), fmtFeeIn4(0.09, 'GBP'), fmtFeeIn4(0, 'USD')])
      .toEqual(['+$0.1234', '+£0.1234', '$0.0900', '£0.0900', '$0']);
  });

  it('DAYS writes a dollar row in dollars and a pound row in pounds', () => {
    const NOW = Date.parse('2026-10-29T12:00:00Z');
    const days = [{ day: '2026-10-29', orders: 3, fills: 1, trips: 1, won: 1, realisedGbp: 0.11, today: true }];
    const m = (/** @type {string} */ s) => s;
    const usd = render(React.createElement(QuoteDaysTable, { days, m, capitalGbp: 600, nowMs: NOW, ccy: 'USD' }));
    expect(usd.container.textContent).toContain('+$0.11');
    usd.unmount();
    const gbp = render(React.createElement(QuoteDaysTable, { days, m, capitalGbp: 600, nowMs: NOW }));
    expect(gbp.container.textContent).toContain('+£0.11');
  });
});
