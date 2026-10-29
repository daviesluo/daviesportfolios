// @vitest-environment jsdom
// The Stablecoin quotes pages' conversions (Davies, 2026-10-29 23:12, LIVE after its USDT-only switch: INVENTORY showed 201.53
// USDC, "我没看正在挂售？testing的那几个要换的也一样"): a resting conversion is a line on its book's BOOKS card ("selling 201.51 USDC
// @ £0.7466 (switching to USDT)", "buying … (top-up)"), and CONVERSIONS lists the resting ones and the last that ended, newest
// first, so a switch can be followed end to end. The order tables still hold entries and exits alone.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { QuotesLiveDetail } from './agents.jsx';
import { QUOTE_CONVERSION_ROWS, quoteConversionLine, quoteConversions } from './agents.js';

afterEach(cleanup);

const NOW = Date.parse('2026-10-29T23:12:00Z');
const m = (/** @type {string} */ s) => s;
const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
let n = 100;
/** A live order as quotesLiveDetail lists it. @param {Record<string, unknown>} o */
const order = (o) => ({ id: n--, ts: '2026-10-29T23:01:00Z', book: 'USDC-GBP', side: null, k: null, leg: 'convert', venueSide: 'sell', price: 0.7466, base: 201.5116, state: 'new', filledBase: 0, avgPrice: null, reason: null, ...o });
const card = (/** @type {string} */ book) => ({ book, lastPrice: 0.7468, fair: 0.7467, index: null, realisedGbp: 0, trips: 0, won: 0 });
const orders = [
  order({ ts: '2026-10-29T23:05:00Z', book: 'USDT-GBP', venueSide: 'buy', price: 0.757, base: 66, state: 'partially_filled', filledBase: 12 }),
  order({}),
  order({ ts: '2026-10-29T22:31:00Z', base: 201.5116, state: 'cancelled', filledBase: 0.0216, reason: 'filled in part; the rest was cancelled' }),
  order({ ts: '2026-10-29T23:00:00Z', leg: 'entry', book: 'USDT-GBP', side: 'bid', k: 0.001, venueSide: 'buy', price: 0.7562, base: 66.1 }),
];
const live = {
  tradedLive: true, running: true, armed: true, armedAt: '2026-09-26T00:00:00Z', capitalGbp: 600, capitalUsd: 800, books: ['USDT-GBP'],
  detail: { books: [card('USDC-GBP'), card('USDT-GBP')], rungs: [], inventory: null, days: [], trips: [], tripCount: 0, tripsWon: 0, orders },
};
const rows = (/** @type {Element} */ root, /** @type {string} */ sel) => [...root.querySelectorAll(`${sel} tbody tr:not(.ag-ql-sub-row)`)].map((tr) => [...tr.querySelectorAll('td')].slice(1).map(txt).join(' | '));

describe('conversions on a Stablecoin quotes page', () => {
  it('says what each is for: a sell of a book it no longer quotes is its switch, any buy a top-up', () => {
    const c = quoteConversions(live);
    expect(c.map((x) => [x.purpose, x.to, x.resting])).toEqual([['top-up', null, true], ['switch', 'USDT', true], ['switch', 'USDT', false]]);
    expect(quoteConversionLine(c[1])).toBe('selling 201.51 USDC @ £0.7466 (switching to USDT)');
    expect(quoteConversionLine(c[0])).toBe('buying 66.00 USDT @ £0.7570 (top-up), 12.00 filled');
    // A sell of a book it still quotes sells a surplus; with no books going forward known, the same.
    expect(quoteConversions({ ...live, books: ['USDC-GBP', 'USDT-GBP'] })[1].purpose).toBe('surplus');
    expect(quoteConversions({ detail: live.detail })[1].purpose).toBe('surplus');
    // At most QUOTE_CONVERSION_ROWS, newest first as the payload gives them.
    const many = Array.from({ length: 12 }, (_, i) => order({ id: i, state: 'cancelled', filledBase: 1 }));
    expect(quoteConversions({ detail: { orders: many } })).toHaveLength(QUOTE_CONVERSION_ROWS);
  });

  it('BOOKS says what rests on each book, CONVERSIONS lists them and the last that ended, and the order tables keep entries alone', () => {
    const root = render(React.createElement(QuotesLiveDetail, { q: live, m, at: '2026-10-29T23:12:00Z', nowMs: NOW })).container;
    const cards = [...root.querySelectorAll('.ag-quotes-card')];
    expect(cards.map((c) => txt(c.querySelector('.ag-quotes-converting')))).toEqual(['selling 201.51 USDC @ £0.7466 (switching to USDT)', 'buying 66.00 USDT @ £0.7570 (top-up), 12.00 filled']);
    expect(rows(root, '.ag-ql-conversions')).toEqual([
      'top-up | buy | £0.7570 | 66.00 USDT | 12.00 | partially filled',
      'switch to USDT | sell | £0.7466 | 201.51 USDC | 0.00 | open',
      'switch to USDT | sell | £0.7466 | 201.51 USDC | 0.02 | cancelled',
    ]);
    expect(txt(root.querySelector('.ag-ql-conversions .ag-ql-sub'))).toBe('filled in part; the rest was cancelled');
    expect(rows(root, '.ag-ql-entries')).toHaveLength(1);
    expect(root.querySelector('.ag-ql-exits')).toBeNull();
    // CONVERSIONS comes before the order tables.
    expect([...root.querySelectorAll('.ag-section-title')].map(txt).slice(-3)).toEqual(['ROUND TRIPS', 'CONVERSIONS', 'ENTRY ORDERS']);
  });

  it('no conversion, no table and no line', () => {
    const root = render(React.createElement(QuotesLiveDetail, { q: { ...live, detail: { ...live.detail, orders: [orders[3]] } }, m, at: '2026-10-29T23:12:00Z', nowMs: NOW })).container;
    expect(root.querySelector('.ag-ql-conversions')).toBeNull();
    expect(root.querySelector('.ag-quotes-converting')).toBeNull();
  });
});
