// @vitest-environment jsdom
// The Stablecoin quotes pages' Book column (Davies, 2026-10-29: "另外更新后所有live/testing的Stablecoin quotes的子页面里，如果这个策略只有
// 一个币种，就把页面里的tables中的book列删了"): a strategy that quotes one book going forward, every row shown of that book, has no
// Book column in ROUND TRIPS, EXIT ORDERS or ENTRY ORDERS; a strategy of two books keeps it, and so does a one-book strategy while
// a row of another book is still listed (LIVE's USDC trips from before its USDT-only switch), so no row hides its coin.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { QuotesLiveDetail } from './agents.jsx';
import { quotesShowBook } from './agents.js';

afterEach(cleanup);

const NOW = Date.parse('2026-10-30T12:00:00Z');
const m = (/** @type {string} */ s) => s;
const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const trip = (/** @type {string} */ book) => ({ book, side: 'bid', k: 0.001, tEntry: '2026-10-30T09:00:00Z', tExit: '2026-10-30T10:00:00Z', entry: 0.7565, exit: 0.758, qty: 66, how: 'exit', feesGbp: 0, pnlGbp: 0.099 });
const order = (/** @type {number} */ id, /** @type {string} */ book, /** @type {string} */ leg) => ({ id, ts: '2026-10-30T11:00:00Z', book, side: 'bid', k: 0.001, leg, venueSide: leg === 'exit' ? 'sell' : 'buy', price: 0.7565, base: 66, state: 'new', filledBase: 0, avgPrice: null, reason: null });
const card = (/** @type {string} */ book) => ({ book, lastPrice: 0.757, fair: 0.7571, index: null, realisedGbp: 0, trips: 0, won: 0 });
/** PR5 LIVE's payload: `books` its books going forward, BOOKS its cards, the rows its tables list. */
const live = (/** @type {string[] | undefined} */ books, /** @type {any[]} */ trips, /** @type {any[]} */ orders) => ({
  tradedLive: true, running: true, armed: true, armedAt: '2026-09-26T00:00:00Z', capitalGbp: 600, capitalUsd: 800, valueGbp: 0, realisedGbp: 0, todayGbp: 0, unrealisedGbp: 0,
  ...(books ? { books } : {}),
  detail: { books: [card('USDC-GBP'), card('USDT-GBP')], rungs: [], inventory: null, days: [], trips, tripCount: trips.length, tripsWon: 0, orders },
});
const view = (/** @type {any} */ q, /** @type {any} */ extra = {}) => render(React.createElement(QuotesLiveDetail, { q, m, at: '2026-10-30T12:00:00Z', nowMs: NOW, ...extra })).container;
/** Each table's headers, by its section. @param {Element} root */
const heads = (root) => Object.fromEntries(['.ag-ql-trips', '.ag-ql-exits', '.ag-ql-entries'].map((sel) => [sel, [...root.querySelectorAll(`${sel} thead th`)].map(txt)]));
const hasBook = (/** @type {Element} */ root) => Object.values(heads(root)).map((h) => h.includes('Book'));

describe("the Book column on a Stablecoin quotes page", () => {
  it('a one-book strategy with every row of that book has none, and its cells line up with the headers', () => {
    const root = view(live(['USDT-GBP'], [trip('USDT-GBP')], [order(1, 'USDT-GBP', 'exit'), order(2, 'USDT-GBP', 'entry')]));
    expect(hasBook(root)).toEqual([false, false, false]);
    for (const sel of ['.ag-ql-trips', '.ag-ql-exits', '.ag-ql-entries']) {
      const tr = root.querySelector(`${sel} tbody tr`);
      expect(tr?.querySelectorAll('td').length).toBe(root.querySelectorAll(`${sel} thead th`).length);
    }
    expect(txt(root.querySelector('.ag-ql-trips tbody tr'))).not.toContain('USDT/GBP');
  });

  it('a two-book strategy keeps it, even when every row shown is of one book', () => {
    expect(hasBook(view(live(undefined, [trip('USDT-GBP')], [order(1, 'USDT-GBP', 'exit'), order(2, 'USDT-GBP', 'entry')])))).toEqual([true, true, true]);
    cleanup();
    expect(hasBook(view(live(['USDC-GBP', 'USDT-GBP'], [trip('USDC-GBP'), trip('USDT-GBP')], [order(1, 'USDT-GBP', 'entry')])))).toEqual([true, false, true]);
  });

  it("a one-book strategy keeps it while a row of another book is listed: no row hides its coin", () => {
    // LIVE after its USDT-only switch, a USDC round trip from before it still among the newest.
    const root = view(live(['USDT-GBP'], [trip('USDT-GBP'), trip('USDC-GBP')], [order(2, 'USDT-GBP', 'entry')]));
    expect(hasBook(root)).toEqual([true, false, true]);
    expect([...root.querySelectorAll('.ag-ql-trips tbody tr')].map((tr) => txt(tr.querySelectorAll('td')[1]))).toEqual(['USDT/GBP', 'USDC/GBP']);
  });

  it('decides from the books going forward, else from the page\'s BOOKS cards; never from the rows alone', () => {
    const one = { detail: { books: [card('USDC-GBP')] } };
    expect([quotesShowBook(one, []), quotesShowBook(one, [{ book: 'USDC-GBP' }]), quotesShowBook(one, [{ book: 'USDC-EUR' }])]).toEqual([false, false, true]);
    // `books` wins over the cards (LIVE's two cards, USDT-GBP alone going forward).
    expect(quotesShowBook({ books: ['USDT-GBP'], detail: { books: [card('USDC-GBP'), card('USDT-GBP')] } }, [{ book: 'USDT-GBP' }])).toBe(false);
    // Two books going forward, or none known: the column stays, whatever the rows.
    expect([quotesShowBook({ books: ['USDC-GBP', 'USDT-GBP'] }, [{ book: 'USDT-GBP' }]), quotesShowBook({}, [{ book: 'USDT-GBP' }]), quotesShowBook(null, [])]).toEqual([true, true, true]);
  });
});
