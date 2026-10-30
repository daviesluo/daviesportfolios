// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" on the Agents page (xhedge.ts, 0184): their TESTING rows, where they sit, the
// page each opens, its lines, its ladder's one rung and its INVENTORY of two accounts.
import { describe, expect, it } from 'vitest';
import {
  paperTestRows, QUOTES_XHEDGE_ROW_PREFIX, quotesLiveInventory, quotesPageFor, quotesTwinLines, quotesXhedgeOf, quotesXhedgeRow, quoteRungLabel,
} from './agents.js';

const q = {
  venue: 'revx', ccy: 'GBP', running: true, lagMinutes: 3, lastError: null,
  capitalGbp: 2400, costGbp: 2400, valueGbp: 2401.5, unrealisedGbp: 1.2, realisedGbp: 0.3, todayGbp: 0.1, feesGbp: 0.01,
  capitalUsd: 3120, costUsd: 3120, valueUsd: 3121.95, unrealisedUsd: 1.56, realisedUsd: 0.39, todayUsd: 0.13, feesUsd: 0.013,
  heldRungs: 0, openOrders: 4,
  detail: {
    books: [], rungs: [], days: [], trips: [], orders: [],
    inventory: { at: '2026-11-04T10:00:00.000Z', assets: [
      { asset: 'GBP · Revolut X', amount: 600.25 }, { asset: 'USDT · Revolut X', amount: 400, price: 0.75, gbp: 300, priceFrom: 'last' },
      { asset: 'GBP · Coinbase', amount: 599.9 }, { asset: 'USDT · Coinbase', amount: 0.05, price: 0.75, gbp: 0.0375, priceFrom: 'last' },
    ] },
  },
  twin: { id: 'xhedge', arm: 'inside', name: 'Stablecoin quotes RX↔Coinbase hedge', startedAt: '2026-11-04T00:00:00.000Z', mode: 'running', lastTurn: '2026-11-04T09:57:00.000Z',
    converting: [], notes: ['USDT/GBP: bid on, ask off (no pounds on Coinbase); today blocked 0 min bid, 12 min ask'] },
};

const behind = { ...q, twin: { ...q.twin, id: 'xhedgebehind', arm: 'behind', name: 'Stablecoin quotes RX↔Coinbase hedge - 1' } };
const A1 = `${QUOTES_XHEDGE_ROW_PREFIX}xhedge`, A2 = `${QUOTES_XHEDGE_ROW_PREFIX}xhedgebehind`;

describe("'Stablecoin quotes RX↔Coinbase hedge' and '… - 1'", () => {
  it('is a paper row in pounds on Revolut X\'s card, named for both venues', () => {
    const r = quotesXhedgeRow(q);
    expect(r).toMatchObject({ id: A1, name: 'Stablecoin quotes RX↔Coinbase hedge', venue: 'Revolut X + Coinbase', venueId: 'revx', mode: 'paper', ccy: 'GBP' });
    expect(r?.status.detail).toMatch(/^one tick inside Revolut X's other maker, hedged at Coinbase/);
    expect(quotesXhedgeRow(behind)).toMatchObject({ id: A2, name: 'Stablecoin quotes RX↔Coinbase hedge - 1' });
    expect(quotesXhedgeRow(behind)?.status.detail).toMatch(/^10 bps from Coinbase's mid, behind Revolut X's other maker/);
    expect(r?.gbp.capital).toBe(2400);
    expect(r?.status).toMatchObject({ label: 'paper', running: true, tone: 'running' });
    expect(quotesXhedgeRow(null)).toBeNull();
    expect(quotesXhedgeRow({ ...q, running: false })?.status).toMatchObject({ tone: 'stale' });
  });

  it('sit after Revolut X\'s twins on TESTING, the inside arm first, and each opens its own page', () => {
    const dash = { quotesXhedge: [q, behind], quotesTwins: [] };
    expect(paperTestRows(dash).map((r) => r.id)).toEqual([A1, A2]);
    expect(paperTestRows({ quotesXhedge: [q], quotesTwins: [] }).map((r) => r.id)).toEqual([A1]);
    expect(quotesPageFor(A1, dash)).toBe('xhedge');
    expect(quotesPageFor(A2, dash)).toBe('xhedge');
    expect(quotesXhedgeOf(A2, dash)).toBe(behind);
    expect(quotesPageFor(A1, {})).toBeNull();
    expect(quotesXhedgeOf('__quotes_twin_live600', dash)).toBeNull();
  });

  it("carries a line a book for its sides, its rung reads 'inside', and its INVENTORY is two accounts' pounds and coin", () => {
    expect(quotesTwinLines(q).waiting).toEqual(q.twin.notes);
    expect(quoteRungLabel(0)).toBe('inside');
    expect(quoteRungLabel(0.001)).toBe('0.1 %');
    const inv = quotesLiveInventory(q, (s) => s, { minGbp: 0.1 });
    expect(inv?.rows.map((r) => [r.asset, r.amount, r.gbp])).toEqual([
      ['GBP · Revolut X', '£600.25', null], ['USDT · Revolut X', '400.00 USDT · Revolut X', '£300'], ['GBP · Coinbase', '£599.90', null],
    ]);                                                     // Coinbase's 0.05 USDT is dust under £0.10, left out
  });
});
