// INVENTORY on the LIVE pages from the venue's own balances (Davies, 2026-10-29: "都加上吧，revolut也一样"): the shape every live
// executor's reader passes on, `balances: {at, ccy: {CODE: {available, hold}}}`. With it, each currency's total (available
// plus on hold), what is on hold in orders, a coin in pounds at the book's price, the book's own count beside it, a flag
// beyond £0.05, and when the venue was read; without it, the book's own count exactly as before. Invented numbers.
import { describe, expect, it } from 'vitest';
import { INVENTORY_DUST, INVENTORY_MISMATCH_GBP, quotesLiveInventory } from './agents.js';
import liveFixture from '../e2e/quotes_live_fixture.json';
import cbFixture from '../e2e/cb_live_fixture.json';

const q = liveFixture.live;
const BAL = { at: '2026-09-17T22:59:00.000Z', ccy: { GBP: { available: 200.7, hold: 400 }, USDC: { available: 131.64, hold: 132 }, USDT: { available: 528.64, hold: 0 }, EUR: { available: 0, hold: 0 } } };
const mask = (/** @type {string} */ s) => s.replace(/\d/g, '•');

describe("INVENTORY from the venue's balances", () => {
  it('shows each total with what is on hold, the book count beside it, and flags a difference worth more than £0.05', () => {
    const inv = quotesLiveInventory({ ...q, balances: BAL });
    expect(inv?.source).toBe('venue');
    expect(inv?.at).toBe('22:59 UTC');
    expect(inv?.rows.map((r) => [r.asset, r.amount, r.inOrders, r.gbp, r.price, r.book, r.mismatch])).toEqual([
      ['GBP', '£600.70', '£400', null, null, '£600.70', false],
      ['USDC', '263.64 USDC', '132.00 USDC', '£199.71', '£0.7575', '263.64 USDC', false],
      // 528.64 against 527.6436: 0.9964 × £0.7570 = £0.754, over £0.05.
      ['USDT', '528.64 USDT', null, '£400.18', '£0.7570', '527.64 USDT', true],
    ]);
    // EUR at zero, and in no book, is left out; the coins keep their unrealised against what the book paid.
    expect(inv?.rows[1].unrealisedGbp).toBeCloseTo(/** @type {number} */ (quotesLiveInventory(q)?.rows[1].unrealisedGbp), 12);
    expect(INVENTORY_MISMATCH_GBP).toBe(0.05);
    // Within the threshold: not flagged (USDT a twentieth of a coin apart, £0.038).
    const near = quotesLiveInventory({ ...q, balances: { ...BAL, ccy: { ...BAL.ccy, USDT: { available: 527.6936, hold: 0 } } } });
    expect(near?.rows.find((r) => r.asset === 'USDT')?.mismatch).toBe(false);
    // A currency the account holds and no book counts is shown, at no price; masked amounts stay masked.
    const eur = quotesLiveInventory({ ...q, balances: { ...BAL, ccy: { ...BAL.ccy, EUR: { available: 5, hold: 0 } } } }, mask);
    expect(eur?.rows.find((r) => r.asset === 'EUR')).toMatchObject({ amount: '•.•• EUR', gbp: null, book: null, mismatch: false });
    expect(eur?.rows.map((r) => r.asset)).toEqual(['GBP', 'EUR', 'USDC', 'USDT']);
    expect(eur?.rows.find((r) => r.asset === 'USDC')?.amount).toBe('•••.•• USDC');
  });

  it('without balances, the book count exactly as before', () => {
    const inv = quotesLiveInventory(q);
    expect(inv?.source).toBe('book');
    expect(inv?.rows.map((r) => [r.asset, r.amount, r.gbp, r.price, r.inOrders, r.book, r.mismatch])).toEqual([
      ['GBP', '£600.70', null, null, null, null, false], ['USDC', '263.64 USDC', '£199.71', '£0.7575', null, null, false], ['USDT', '527.64 USDT', '£399.43', '£0.7570', null, null, false],
    ]);
    expect(quotesLiveInventory({ ...q, balances: null })?.source).toBe('book');
    expect(quotesLiveInventory({ ...q, balances: { at: null, ccy: {} } })?.source).toBe('book');
  });

  it("the Coinbase page's fixture: Coinbase's reading agrees with its book, nothing flagged, priced at the paper's fair", () => {
    const inv = quotesLiveInventory(cbFixture.output);
    expect(inv?.rows.map((r) => [r.asset, r.amount, r.inOrders, r.gbp, r.price, r.priceFrom, r.book, r.mismatch])).toEqual([
      ['GBP', '£40.21', '£20', null, null, null, '£40.21', false],
      ['USDC', '106.81 USDC', '26.81 USDC', '£79.86', '£0.7477', 'fair', '106.81 USDC', false],
    ]);
  });

  it('a coin worth less than the venue\'s smallest order is not a row of its own, unless its balance and book differ (2026-10-30)', () => {
    // Davies, 2026-10-30, LIVE after its switch: "USDC 0.02 USDC · £0.02 …". Revolut X's smallest order is £0.10 of quote.
    const after = { ...BAL, ccy: { GBP: { available: 0.05, hold: 551.58 }, USDC: { available: 0.02, hold: 0 }, USDT: { available: 69.14, hold: 0 } } };
    const book = { ...q, detail: { ...q.detail, inventory: { ...q.detail.inventory, assets: q.detail.inventory.assets.map((/** @type {any} */ a) => ({ ...a, amount: a.asset === 'USDC' ? 0.02 : a.asset === 'USDT' ? 69.14 : a.amount })) } } };
    const revx = { minGbp: INVENTORY_DUST.revx.minGbp };
    expect(INVENTORY_DUST).toEqual({ revx: { minGbp: 0.1 }, coinbase: { minBase: 1 } });
    expect(quotesLiveInventory({ ...book, balances: after }, undefined, revx)?.rows.map((r) => r.asset)).toEqual(['GBP', 'USDT']);
    // Without the floor every coin shows, as before; pounds are never dust.
    expect(quotesLiveInventory({ ...book, balances: after })?.rows.map((r) => r.asset)).toEqual(['GBP', 'USDC', 'USDT']);
    expect(quotesLiveInventory({ ...book, balances: { ...after, ccy: { ...after.ccy, GBP: { available: 0.01, hold: 0 } } } }, undefined, revx)?.rows[0].asset).toBe('GBP');
    // 0.02 USDC on the venue and 0.2 in the book (£0.135 apart): flagged, so listed however small.
    const off = { ...book, detail: { ...book.detail, inventory: { ...book.detail.inventory, assets: book.detail.inventory.assets.map((/** @type {any} */ a) => (a.asset === 'USDC' ? { ...a, amount: 0.2 } : a)) } } };
    expect(quotesLiveInventory({ ...off, balances: after }, undefined, revx)?.rows.find((r) => r.asset === 'USDC')?.mismatch).toBe(true);
    // The book's own count without balances: the same floor.
    expect(quotesLiveInventory(book, undefined, revx)?.rows.map((r) => r.asset)).toEqual(['GBP', 'USDT']);
    // Coinbase: under its base minimum, 1 USDC.
    const cb = { ...cbFixture.output, balances: { ...cbFixture.output.balances, ccy: { ...cbFixture.output.balances.ccy, USDC: { available: 0.5, hold: 0 } } },
      detail: { ...cbFixture.output.detail, inventory: { ...cbFixture.output.detail.inventory, assets: cbFixture.output.detail.inventory.assets.map((a) => (a.asset === 'USDC' ? { ...a, amount: 0.5 } : a)) } } };
    expect(quotesLiveInventory(cb, undefined, { minBase: INVENTORY_DUST.coinbase.minBase })?.rows.map((r) => r.asset)).toEqual(['GBP']);
  });
});
