// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" on the Agents page (xhedge.ts, xhedge_page.ts, 0184): their TESTING rows, where
// they sit, the page each opens, its lines, its ladder's one rung, its INVENTORY of two accounts, and its money across both venues
// (Davies, 2026-10-30: "…在venue列两个币所都加上，funded和deployed资金按两个币所实际的来，盈利状况也一样"): both venues in the venue column,
// a card of its own, FUNDED, DEPLOYED and the P&L both venues', each percent on FUNDED.
import { describe, expect, it } from 'vitest';
import {
  paperTestRows, QUOTES_XHEDGE_ROW_PREFIX, quotesLiveInventory, quotesPageFor, quotesTwinLines, quotesXhedgeOf, quotesXhedgeRow, quoteRungLabel,
  rowMoney, venueHue, venueLabel, venueParts, venueRows, VENUE_HUES,
} from './agents.js';

// xhedge_page.test.ts's arm, as the dashboard sends it: FUNDED £1,200 a venue, £2,400; DEPLOYED Revolut X's £225 of coin and £175
// of resting bids plus Coinbase's £555 of coin, £955; both venues hold £2,401.30, £2,399.50 at 23:59, so TODAY +£1.80; REALIZED
// £1.05 (both legs of every trip); UNREALIZED £2,401.30 − £2,400 − £1.05 = £0.25; the dollars at 1.3.
const q = {
  venue: 'revx', ccy: 'GBP', running: true, lagMinutes: 3, lastError: null,
  capitalGbp: 2400, costGbp: 2400, valueGbp: 955, heldGbp: 2401.3, unrealisedGbp: 0.25, realisedGbp: 1.05, todayGbp: 1.8, feesGbp: 0.0135,
  capitalUsd: 3120, costUsd: 3120, valueUsd: 1241.5, unrealisedUsd: 0.325, realisedUsd: 1.365, todayUsd: 2.34, feesUsd: 0.01755,
  heldRungs: 0, openOrders: 4, venues: ['revx', 'coinbase'],
  byVenue: [
    { id: 'revx', name: 'Revolut X', capitalGbp: 1200, gbp: 1000, coinGbp: 225, restingGbp: 175, deployedGbp: 400, capitalUsd: 1560, deployedUsd: 520 },
    { id: 'coinbase', name: 'Coinbase', capitalGbp: 1200, gbp: 621.3, coinGbp: 555, restingGbp: 0, deployedGbp: 555, capitalUsd: 1560, deployedUsd: 721.5 },
  ],
  detail: {
    books: [], rungs: [], days: [], trips: [], orders: [],
    inventory: { at: '2026-11-05T10:00:00.000Z', assets: [
      { asset: 'GBP · Revolut X', amount: 600.25 }, { asset: 'USDT · Revolut X', amount: 400, price: 0.75, gbp: 300, priceFrom: 'last' },
      { asset: 'GBP · Coinbase', amount: 599.9 }, { asset: 'USDT · Coinbase', amount: 0.05, price: 0.75, gbp: 0.0375, priceFrom: 'last' },
    ] },
  },
  twin: { id: 'xhedge', arm: 'inside', name: 'Stablecoin quotes RX↔Coinbase hedge', startedAt: '2026-11-04T00:00:00.000Z', mode: 'running', lastTurn: '2026-11-05T09:57:00.000Z',
    converting: [], notes: ['USDT/GBP: bid on, ask off (no pounds on Coinbase); today blocked 0 min bid, 12 min ask'],
    venueNotes: ['Revolut X: £1,200.00 funded, £400.00 deployed (coin £225.00, resting bids £175.00)', 'Coinbase: £1,200.00 funded, £555.00 deployed (coin £555.00)'] },
};

const behind = { ...q, twin: { ...q.twin, id: 'xhedgebehind', arm: 'behind', name: 'Stablecoin quotes RX↔Coinbase hedge - 1' } };
const A1 = `${QUOTES_XHEDGE_ROW_PREFIX}xhedge`, A2 = `${QUOTES_XHEDGE_ROW_PREFIX}xhedgebehind`;

describe("'Stablecoin quotes RX↔Coinbase hedge' and '… - 1'", () => {
  it('is a paper row in pounds on both venues, Revolut X and Coinbase', () => {
    const r = quotesXhedgeRow(q);
    expect(r).toMatchObject({ id: A1, name: 'Stablecoin quotes RX↔Coinbase hedge', venue: 'Revolut X + Coinbase', venueId: 'revx-coinbase', mode: 'paper', ccy: 'GBP' });
    expect([venueParts('revx-coinbase'), venueParts('revx'), venueLabel('revx-coinbase'), venueHue('revx-coinbase')]).toEqual([['revx', 'coinbase'], ['revx'], 'Revolut X + Coinbase', VENUE_HUES.revx]);
    expect(r?.status.detail).toMatch(/^one tick inside Revolut X's other maker, hedged at Coinbase/);
    expect(quotesXhedgeRow(behind)).toMatchObject({ id: A2, name: 'Stablecoin quotes RX↔Coinbase hedge - 1', venueId: 'revx-coinbase' });
    expect(quotesXhedgeRow(behind)?.status.detail).toMatch(/^10 bps from Coinbase's mid, behind Revolut X's other maker/);
    expect(r?.status).toMatchObject({ label: 'paper', running: true, tone: 'running' });
    expect(quotesXhedgeRow(null)).toBeNull();
    expect(quotesXhedgeRow({ ...q, running: false })?.status).toMatchObject({ tone: 'stale' });
  });

  it('shows FUNDED, DEPLOYED, TODAY, UNREALIZED and REALIZED across both venues, each percent on FUNDED', () => {
    const x = rowMoney(quotesXhedgeRow(q));
    expect([x.ccy, x.capital, x.value, x.today, x.unrealised, x.realised, x.fees]).toEqual(['GBP', 2400, 955, 1.8, 0.25, 1.05, 0.0135]);
    expect(x.todayPct).toBeCloseTo(0.075, 12);              // £1.80 of £2,400
    expect(x.unrealisedPct).toBeCloseTo(0.25 / 24, 12);     // £0.25 of £2,400
    expect(x.realisedPct).toBeCloseTo(0.04375, 12);         // £1.05 of £2,400
    const r = quotesXhedgeRow(q);
    expect([r?.capitalUsd, r?.valueUsd, r?.todayUsd, r?.unrealisedBaseUsd]).toEqual([3120, 1241.5, 2.34, 3120]);
  });

  it('has a card of its own, "Revolut X + Coinbase", summing both arms; Revolut X\'s and Coinbase\'s cards keep only their own rows', () => {
    const rxTwin = { id: 'rx', venueId: 'revx', mode: 'paper', capitalUsd: 780, costUsd: 0, valueUsd: 100, unrealisedUsd: 0, realisedUsd: 2, todayUsd: 1, feesUsd: 0 };
    const cbArm = { id: 'cb', venueId: 'coinbase', mode: 'paper', capitalUsd: 600, costUsd: 0, valueUsd: 50, unrealisedUsd: 0, realisedUsd: 1, todayUsd: 0.5, feesUsd: 0 };
    const cards = venueRows({ strategies: [], venues: [] }, 'testing', [rxTwin, quotesXhedgeRow(q), quotesXhedgeRow(behind), cbArm]);
    expect(cards.map((c) => [c.id, c.label, c.capitalUsd, c.valueUsd, c.tests])).toEqual([
      ['revx', 'Revolut X', 780, 100, 1], ['revx-coinbase', 'Revolut X + Coinbase', 6240, 2483, 2], ['coinbase', 'Coinbase', 600, 50, 1],
    ]);
    const pair = cards[1];
    expect([pair.realisedUsd, pair.todayUsd]).toEqual([2.73, 4.68]);
    expect(pair.unrealisedPct).toBeCloseTo((0.65 / 6240) * 100, 12);
    expect(pair.realisedPct).toBeCloseTo((2.73 / 6240) * 100, 12);
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

  it("carries a line a book for its sides and a line a venue for its money (masked with the page), its rung reads 'inside', and its INVENTORY is two accounts' pounds and coin", () => {
    expect(quotesTwinLines(q).waiting).toEqual([...q.twin.notes, ...q.twin.venueNotes]);
    const masked = quotesTwinLines(q, (s) => s.replace(/\d/g, '•')).waiting;
    expect(masked.slice(1)).toEqual(['Revolut X: £•,•••.•• funded, £•••.•• deployed (coin £•••.••, resting bids £•••.••)', 'Coinbase: £•,•••.•• funded, £•••.•• deployed (coin £•••.••)']);
    expect(masked[0]).toBe(q.twin.notes[0]);
    expect(quoteRungLabel(0)).toBe('inside');
    expect(quoteRungLabel(0.001)).toBe('0.1 %');
    const inv = quotesLiveInventory(q, (s) => s, { minGbp: 0.1 });
    expect(inv?.rows.map((r) => [r.asset, r.amount, r.gbp])).toEqual([
      ['GBP · Revolut X', '£600.25', null], ['USDT · Revolut X', '400.00 USDT · Revolut X', '£300'], ['GBP · Coinbase', '£599.90', null],
    ]);                                                     // Coinbase's 0.05 USDT is dust under £0.10, left out
  });
});
