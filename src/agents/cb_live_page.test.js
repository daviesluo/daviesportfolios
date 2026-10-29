// @vitest-environment jsdom
// "Stablecoin quotes USDC/GBP"'s page (Davies, 2026-10-29: "网页中live的coinbase策略子页面打不开，点了没反应"): its LIVE row opens
// PR5 LIVE's page on its own Coinbase book, from the dashboard's `cbLive` (the browser sweep's fixture, `cbLiveDetail`'s answer
// for a record worked by hand in supabase/functions/agents/cb_live_page.test.ts): LIVE, Coinbase, the row's scoreboard in pounds,
// BOOKS, INVENTORY (its pounds and USDC, its top-up there), DAYS with the 7-day figure, ROUND TRIPS, and ORDERS split into
// EXIT and ENTRY with no refused order, no conversion and no cancel that filled nothing.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { QuotesLiveDetail } from './agents.jsx';
import { CB_LIVE_ROW_ID, cbLiveRow, quotesPageFor, rowMoney } from './agents.js';
import fixture from '../e2e/cb_live_fixture.json';

afterEach(cleanup);

const NOW = Date.parse(fixture.now);
const c = /** @type {any} */ (fixture.output);
const m = (/** @type {string} */ s) => s;
const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const view = (/** @type {any} */ q = c) => render(React.createElement(QuotesLiveDetail, { q, m, at: fixture.now, nowMs: NOW, cbLive: true })).container;
/** @param {Element} root @param {string} sel */
const rows = (root, sel) => [...root.querySelectorAll(`${sel} tbody tr:not(.ag-ql-sub-row)`)].map((tr) => [...tr.querySelectorAll('td')].map(txt).join(' | '));

describe('the Coinbase live page', () => {
  it('its LIVE row opens it, once the row is on LIVE', () => {
    expect(quotesPageFor(CB_LIVE_ROW_ID, { cbLive: c })).toBe('cblive');
    expect(quotesPageFor(CB_LIVE_ROW_ID, { cbLive: { ...c, armed: false, tradedLive: false } })).toBeNull();
    expect(quotesPageFor(CB_LIVE_ROW_ID, {})).toBeNull();
  });

  it('DEPLOYED is what its quotes have at work, its coins at fair and its resting buys, as PR5 LIVE\'s', () => {
    const x = rowMoney(/** @type {any} */ (cbLiveRow(c)));
    expect(x.ccy).toBe('GBP');
    expect(x.capital).toBe(120);
    expect(x.value).toBeCloseTo(106.81 * 0.7477 + 26.84 * 0.7451, 9);
    // A payload without it (before this page): its capital and what it has made, as before.
    const old = rowMoney(/** @type {any} */ (cbLiveRow({ ...c, valueGbp: undefined })));
    expect(old.value).toBeCloseTo(120 + c.realisedGbp + c.unrealisedGbp, 9);
  });

  it('is PR5 LIVE\'s page on its Coinbase book, in pounds', () => {
    const root = view();
    const page = /** @type {HTMLElement} */ (root.querySelector('.ag-quotes-cblive-detail'));
    expect(page).toBeTruthy();
    expect(txt(page.querySelector('.ag-detail-head'))).toMatch(/^LIVE\s*Coinbase/);
    expect([...page.querySelectorAll('.ag-section-title')].map((e) => txt(e).replace(/ - 7-day.*$/, ''))).toEqual(['BOOKS', 'INVENTORY', 'DAYS', 'ROUND TRIPS', 'EXIT ORDERS', 'ENTRY ORDERS']);
    const sb = txt(page.querySelector('.ag-scoreboard'));
    expect(sb).toContain('£120');
    expect(sb).toContain('£99.86');
    expect(sb).toContain('(loss stop -£1.20)');
    expect(sb).toContain('(incl. fees £0.01)');
    // BOOKS: one card, USDC/GBP, its last trade and fair; a held rung at its entry, three quoting.
    expect([...page.querySelectorAll('.ag-quotes-card .ag-quotes-head')].map(txt)).toEqual(['USDC/GBPlast trade £0.7476 · fair £0.7477']);
    // INVENTORY: its pounds and its USDC (the top-up's 80 and the held 26.81) at fair with what they have made.
    const inv = txt(page.querySelector('.ag-ql-inventory'));
    expect(inv).toContain('GBP£40.21');
    expect(inv).toContain('USDC106.81 USDC · £79.86 at £0.7477 +£0.0803');
    // DAYS: the three days and the 7-day figure, 16 Sep's +£0.04017 over two closed days on £120, a year.
    expect(rows(page, '.ag-quote-days')).toEqual(['17 Sep · today | 8 | 1 | 1 · 0 % won | -£0.0500', '16 Sep | 4 | 2 | 1 · 100 % won | +£0.0402', '15 Sep | 5 | 0 | 0 | £0']);
    expect(txt(page.querySelector('.ag-quote-days-annual'))).toBe(`- 7-day realised, annualised +${((0.04017 / 120) * (365 / 2) * 100).toFixed(1)}%`);
    // ROUND TRIPS, newest first: the 24-hour stop, then the exit.
    expect(rows(page, '.ag-ql-trips').map((r) => r.replace(/^.*? \| USDC/, 'USDC'))).toEqual([
      'USDC/GBP | sold | 0.2 % | £0.7495 | £0.7510 | 26.68 USDC | £0.0100 | -£0.0500',
      'USDC/GBP | bought | 0.1 % | £0.7466 | £0.7481 | 26.78 USDC | £0 | +£0.0402',
    ]);
    // ORDERS: exits first, then entries; no 403, no refusal, no conversion, no cancel that filled nothing.
    expect(rows(page, '.ag-ql-exits').map((r) => r.replace(/^.*? \| USDC/, 'USDC'))).toEqual(['USDC/GBP | bid 0.2 % | sell | £0.7474 | 26.81 USDC | open']);
    expect(rows(page, '.ag-ql-entries').map((r) => r.replace(/^.*? \| USDC/, 'USDC'))).toEqual([
      'USDC/GBP | bid 0.3 % | buy | £0.7451 | 26.84 USDC | open', 'USDC/GBP | ask 0.3 % | sell | £0.7502 | 26.65 USDC | open',
      'USDC/GBP | ask 0.1 % | sell | £0.7487 | 26.71 USDC | open', 'USDC/GBP | bid 0.2 % | buy | £0.7459 | 26.81 USDC | filled',
    ]);
    expect(txt(page)).not.toMatch(/403|PERMISSION|refused|rejected|POST_ONLY/);
  });

  it('its first night as production has it: the top-up in INVENTORY, no order listed, no exit table', () => {
    const night = { ...c, detail: { ...c.detail, orders: [], trips: [], tripCount: 0, tripsWon: 0 } };
    const root = view(night);
    expect(root.querySelector('.ag-ql-exits')).toBeNull();
    expect(rows(root, '.ag-ql-entries')).toEqual(['No order yet.']);
    expect(rows(root, '.ag-ql-trips')).toEqual(['No round trip yet.']);
    expect(txt(root.querySelector('.ag-ql-inventory'))).toContain('USDC');
  });
});
