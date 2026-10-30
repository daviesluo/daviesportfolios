// @vitest-environment jsdom
// The Stablecoin quotes pages show only what the strategy quotes (Davies, 2026-10-30, on LIVE's "Stablecoin quotes USDC/GBP" on Revolut
// X: "这里不做0.3 %和usdt就删掉不显示，类似的策略也一样，INVENTORY中“ · 160.60 USDC in orders”什么意思？没什么用的话也删了，类似策略的页面里也一样"):
// BOOKS draws the books it trades and, on each, the rungs its weights quote (`books`, `rungsTraded`, from its instance); a rung it does
// not quote shows only while it holds coin or has an order resting; a book it no longer trades keeps its card while it has round
// trips to account for, without a rung table; INVENTORY says nothing of what is on hold in orders; and the Revolut X USDC/GBP page is
// under its own name, not LIVE's. Invented figures.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { QuotesLiveDetail } from './agents.jsx';
import { quotesLiveBooks } from './agents.js';

afterEach(cleanup);

const NOW = Date.parse('2026-10-30T12:00:00Z');
const m = (/** @type {string} */ s) => s;
const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const card = (/** @type {string} */ book, trips = 0) => ({ book, lastPrice: 0.757, fair: 0.7571, index: null, realisedGbp: trips ? 1.25 : 0, trips, won: trips });
const idle = (/** @type {string} */ book) => [0.001, 0.002, 0.003].flatMap((k) => ['bid', 'ask'].map((side) => ({ book, side, k, order: null, held: null })));
const q0 = (/** @type {any} */ extra, /** @type {any} */ detail = {}) => ({
  tradedLive: true, running: true, armed: true, armedAt: '2026-10-30T10:00:00Z', capitalGbp: 120, capitalUsd: 160, valueGbp: 0, realisedGbp: 0, todayGbp: 0, unrealisedGbp: 0,
  ...extra,
  detail: { books: [card('USDC-GBP'), card('USDT-GBP')], rungs: [...idle('USDC-GBP'), ...idle('USDT-GBP')], inventory: null, days: [], trips: [], tripCount: 0, tripsWon: 0, orders: [], ...detail },
});
const view = (/** @type {any} */ q, /** @type {any} */ extra = {}) => render(React.createElement(QuotesLiveDetail, { q, m, at: '2026-10-30T12:00:00Z', nowMs: NOW, ...extra })).container;
const cards = (/** @type {Element} */ root) => [...root.querySelectorAll('.ag-quote-books .ag-quotes-card')].map((c) => ({
  head: txt(c.querySelector('.ag-quotes-head .hl-strong')), ladder: [...c.querySelectorAll('.ag-ladder tbody tr')].map((tr) => txt(tr.querySelector('td'))),
  grid: [...c.querySelectorAll('.ag-quotes-grid > span')].map(txt).join(' | '),
}));

describe('a Stablecoin quotes page shows only what the strategy quotes', () => {
  it("Revolut X's USDC/GBP: its one book, its 0.1 % and 0.2 % rungs; no USDT/GBP card and no 0.3 % row", () => {
    const q = q0({ books: ['USDC-GBP'], rungsTraded: { 'USDC-GBP': [0.001, 0.002] } });
    expect(cards(view(q, { rxu: true }))).toEqual([{ head: 'USDC/GBP', ladder: ['0.1 %', '0.2 %'], grid: 'round trips | 0 | realised | £0' }]);
  });

  it('a rung it no longer quotes shows while it holds coin or has an order resting', () => {
    const rungs = [...idle('USDC-GBP'), ...idle('USDT-GBP')].map((r) => (r.book === 'USDC-GBP' && r.k === 0.003 && r.side === 'bid'
      ? { ...r, held: { avgEntry: 0.7548, since: '2026-10-30T09:00:00Z', unrealisedGbp: 0.01 } } : r));
    const b = quotesLiveBooks(q0({ books: ['USDC-GBP'], rungsTraded: { 'USDC-GBP': [0.001, 0.002] } }, { rungs }));
    expect(b.map((x) => [x.book, x.rungs.map((r) => `${r.side} ${r.k} ${r.mode}`)])).toEqual([
      ['USDC-GBP', ['bid 0.001 idle', 'ask 0.001 idle', 'bid 0.002 idle', 'ask 0.002 idle', 'bid 0.003 position']],
    ]);
  });

  it("LIVE after its USDT-only switch: USDC/GBP keeps its round trips and realised, so the page adds up, but no rung table", () => {
    const q = q0({ books: ['USDT-GBP'], rungsTraded: { 'USDT-GBP': [0.001, 0.002, 0.003] } }, { books: [card('USDC-GBP', 113), card('USDT-GBP', 4)] });
    expect(cards(view(q))).toEqual([
      { head: 'USDC/GBP', ladder: [], grid: 'round trips | 113 · 100 % won | realised | +£1.2500' },
      { head: 'USDT/GBP', ladder: ['0.1 %', '0.2 %', '0.3 %'], grid: 'round trips | 4 · 100 % won | realised | +£1.2500' },
    ]);
    // A book it no longer trades, with nothing to account for, is not shown at all.
    expect(quotesLiveBooks(q0({ books: ['USDT-GBP'], rungsTraded: { 'USDT-GBP': [0.001] } })).map((x) => x.book)).toEqual(['USDT-GBP']);
  });

  it('a payload that does not say what it quotes (Coinbase, OKX) draws every book and rung, as before', () => {
    expect(quotesLiveBooks(q0({})).map((x) => [x.book, x.rungs.length])).toEqual([['USDC-GBP', 6], ['USDT-GBP', 6]]);
  });

  it('INVENTORY says nothing of what is on hold in orders, on a coin or on pounds', () => {
    const q = q0({ books: ['USDC-GBP'], balances: { at: '2026-10-30T11:59:00Z', ccy: { GBP: { available: 50, hold: 30 }, USDC: { available: 100, hold: 60.6 } } } },
      { inventory: { assets: [{ asset: 'GBP', amount: 80, gbp: 80 }, { asset: 'USDC', amount: 160.6, gbp: 121.6, price: 0.757, priceFrom: 'index' }] } });
    const inv = txt(view(q, { rxu: true }).querySelector('.ag-ql-inventory'));
    expect(inv).toContain('£80');
    expect(inv).toContain('160.60 USDC');
    expect(inv).not.toMatch(/in orders|£30\b| 60\.60 USDC/);
  });

  it("Revolut X's USDC/GBP page is under its own name, LIVE's under LIVE's", () => {
    const q = q0({ books: ['USDC-GBP'] });
    expect(txt(view(q, { rxu: true }).querySelector('.ag-detail-title'))).toBe('Stablecoin quotes USDC/GBP');
    cleanup();
    expect(txt(view(q).querySelector('.ag-detail-title'))).toBe('Stablecoin quotes USDT/GBP');
  });
});
