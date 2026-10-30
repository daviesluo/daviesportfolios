// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" on the Agents page (xhedge.ts, xhedge_page.ts, 0184): their TESTING rows, where
// they sit, the page each opens, its lines, its ladder's one rung, its INVENTORY of two accounts, and its money by venue (Davies,
// 2026-10-30: "…在venue列两个币所都加上…", then "…VENUES不要把两个单独新开一个放一起，按实际两个币所的funded和deployed和营收分别放在两个各自的
// 里面去"): both badges in the venue cell; the row both venues' money summed, each percent on FUNDED; each venue's half on that
// venue's own card, and no card of their own.
import { describe, expect, it } from 'vitest';
import {
  paperTestRows, QUOTES_XHEDGE_ROW_PREFIX, quotesLiveInventory, quotesPageFor, quotesTwinLines, quotesXhedgeOf, quotesXhedgeRow, quoteRungLabel,
  rowMoney, venueHue, venueLabel, venueParts, venueRows, VENUE_HUES, xhedgeVenueSplit,
} from './agents.js';

// xhedge_page.test.ts's arm, as the dashboard sends it, the dollars at 1.3. Revolut X's half: FUNDED £1,200, DEPLOYED £400 (£225
// of coin, £175 of resting bids), REALIZED £1.0635 (its legs), UNREALIZED £23.9365, TODAY −£75. Coinbase's: FUNDED £1,200, DEPLOYED
// £555 (its coin), REALIZED −£0.0135 (the fees), UNREALIZED −£23.6865, TODAY +£76.80. The arm: £2,400, £955, £1.05, £0.25, +£1.80.
const q = {
  venue: 'revx', ccy: 'GBP', running: true, lagMinutes: 3, lastError: null,
  capitalGbp: 2400, costGbp: 2400, valueGbp: 955, heldGbp: 2401.3, unrealisedGbp: 0.25, realisedGbp: 1.05, todayGbp: 1.8, feesGbp: 0.0135,
  capitalUsd: 3120, costUsd: 3120, valueUsd: 1241.5, unrealisedUsd: 0.325, realisedUsd: 1.365, todayUsd: 2.34, feesUsd: 0.01755,
  heldRungs: 0, openOrders: 4, venues: ['revx', 'coinbase'],
  byVenue: [
    { id: 'revx', name: 'Revolut X', capitalGbp: 1200, gbp: 1000, coinGbp: 225, restingGbp: 175, deployedGbp: 400, heldGbp: 1225, realisedGbp: 1.0635, unrealisedGbp: 23.9365,
      todayGbp: -75, feesGbp: 0, capitalUsd: 1560, deployedUsd: 520, realisedUsd: 1.38255, unrealisedUsd: 31.11745, todayUsd: -97.5, feesUsd: 0 },
    { id: 'coinbase', name: 'Coinbase', capitalGbp: 1200, gbp: 621.3, coinGbp: 555, restingGbp: 0, deployedGbp: 555, heldGbp: 1176.3, realisedGbp: -0.0135, unrealisedGbp: -23.6865,
      todayGbp: 76.8, feesGbp: 0.0135, capitalUsd: 1560, deployedUsd: 721.5, realisedUsd: -0.01755, unrealisedUsd: -30.79245, todayUsd: 99.84, feesUsd: 0.01755 },
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
    venueNotes: [
      'Revolut X: £1,200.00 funded, £400.00 deployed (coin £225.00, resting bids £175.00); realised +£1.06, unrealised +£23.94, today −£75.00',
      'Coinbase: £1,200.00 funded, £555.00 deployed (coin £555.00); realised −£0.01, unrealised −£23.69, today +£76.80',
    ] },
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

  it("puts each venue's half on that venue's card and nothing else, with no card of its own; the halves sum to the row", () => {
    const rxTwin = { id: 'rx', venueId: 'revx', mode: 'paper', capitalUsd: 780, costUsd: 0, valueUsd: 100, unrealisedUsd: 0, realisedUsd: 2, todayUsd: 1, feesUsd: 0 };
    const cbArm = { id: 'cb', venueId: 'coinbase', mode: 'paper', capitalUsd: 600, costUsd: 0, valueUsd: 50, unrealisedUsd: 0, realisedUsd: 1, todayUsd: 0.5, feesUsd: 0 };
    const rows = [rxTwin, quotesXhedgeRow(q), quotesXhedgeRow(behind), cbArm];
    const cards = venueRows({ strategies: [], venues: [] }, 'testing', rows);
    expect(cards.map((c) => [c.id, c.label, c.tests])).toEqual([['revx', 'Revolut X', 3], ['coinbase', 'Coinbase', 3]]);
    const [rx, cb] = cards;
    // Revolut X's card: its twin's $780 and each arm's Revolut X half ($1,560 funded, $520 deployed, $1.38255 realised, −$97.50 today).
    expect([rx.capitalUsd, rx.valueUsd]).toEqual([780 + 2 * 1560, 100 + 2 * 520]);
    expect(rx.realisedUsd).toBeCloseTo(2 + 2 * 1.38255, 12);
    expect(rx.unrealisedUsd).toBeCloseTo(2 * 31.11745, 12);
    expect(rx.todayUsd).toBeCloseTo(1 - 2 * 97.5, 12);
    expect(rx.feesUsd).toBe(0);
    // Coinbase's card: its arm's $600 and each arm's Coinbase half ($1,560, $721.50, −$0.01755 realised, +$99.84 today, the fees).
    expect([cb.capitalUsd, cb.valueUsd]).toEqual([600 + 2 * 1560, 50 + 2 * 721.5]);
    expect(cb.realisedUsd).toBeCloseTo(1 - 2 * 0.01755, 12);
    expect(cb.unrealisedUsd).toBeCloseTo(-2 * 30.79245, 12);
    expect(cb.todayUsd).toBeCloseTo(0.5 + 2 * 99.84, 12);
    expect(cb.feesUsd).toBeCloseTo(2 * 0.01755, 12);
    // What the two cards took from the arms is the two rows, field by field.
    const row = quotesXhedgeRow(q);
    for (const [k, own] of /** @type {const} */ ([['capitalUsd', 780 + 600], ['valueUsd', 150], ['realisedUsd', 3], ['unrealisedUsd', 0], ['todayUsd', 1.5]])) {
      expect(rx[k] + cb[k] - own, k).toBeCloseTo(2 * Number(row?.[k]), 9);
    }
    // Each half, as its card reads it: its percent on its own FUNDED.
    const [hr, hc] = xhedgeVenueSplit(q);
    expect([hr.venueId, hc.venueId, hr.costUsd, hc.costUsd, hr.valueUsd, hc.valueUsd]).toEqual(['revx', 'coinbase', 1560, 1560, 520, 721.5]);
    expect(hr.unrealisedPct).toBeCloseTo((31.11745 / 1560) * 100, 12);
    expect(hc.unrealisedPct).toBeCloseTo((-30.79245 / 1560) * 100, 12);
    expect(hr.realisedUsd + hc.realisedUsd).toBeCloseTo(q.realisedUsd, 12);
    expect(hr.todayUsd + hc.todayUsd).toBeCloseTo(q.todayUsd, 12);
    expect(xhedgeVenueSplit({ twin: { id: 'x' } })).toEqual([]);
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
    expect(masked.slice(1)).toEqual([
      'Revolut X: £•,•••.•• funded, £•••.•• deployed (coin £•••.••, resting bids £•••.••); realised +£•.••, unrealised +£••.••, today −£••.••',
      'Coinbase: £•,•••.•• funded, £•••.•• deployed (coin £•••.••); realised −£•.••, unrealised −£••.••, today +£••.••',
    ]);
    expect(masked[0]).toBe(q.twin.notes[0]);
    expect(quoteRungLabel(0)).toBe('inside');
    expect(quoteRungLabel(0.001)).toBe('0.1 %');
    const inv = quotesLiveInventory(q, (s) => s, { minGbp: 0.1 });
    expect(inv?.rows.map((r) => [r.asset, r.amount, r.gbp])).toEqual([
      ['GBP · Revolut X', '£600.25', null], ['USDT · Revolut X', '400.00 USDT · Revolut X', '£300'], ['GBP · Coinbase', '£599.90', null],
    ]);                                                     // Coinbase's 0.05 USDT is dust under £0.10, left out
  });
});
