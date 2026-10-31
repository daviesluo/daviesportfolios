// "Crypto quotes XRP/GBP" on the Agents page (mm_paper.ts, mm_page.ts, 0192; Davies, 2026-10-31: "好 再研究下确保策略一切最优后就开做然后上
// testing"): its TESTING row on Revolut X, where it sits, the page it opens, and its money adding into Revolut X's card and TESTING.
import { describe, expect, it } from 'vitest';
import {
  paperTestRows, QUOTES_CRYPTO_ROW_PREFIX, quotesCryptoOf, quotesCryptoRow, quotesLiveInventory, quotesPageFor, quotesShowBook, quotesTwinLines,
  rowMoney, venueRows,
} from './agents.js';

// mm_page.test.ts's arm as the dashboard sends it, the dollars at 1.3: FUNDED £600, DEPLOYED £232.21 (100 XRP at £0.9301 and a
// £139.20 bid), REALIZED £4.50, UNREALIZED £0.01, TODAY £1.50.
const q = {
  venue: 'revx', ccy: 'GBP', running: true, lagMinutes: 2, lastError: null,
  capitalGbp: 600, costGbp: 93, valueGbp: 232.21, unrealisedGbp: 0.01, realisedGbp: 4.5, todayGbp: 1.5, feesGbp: 0,
  capitalUsd: 780, costUsd: 120.9, valueUsd: 301.873, unrealisedUsd: 0.013, realisedUsd: 5.85, todayUsd: 1.95, feesUsd: 0,
  heldRungs: 0, openOrders: 2, books: ['XRP-GBP'],
  detail: {
    books: [{ book: 'XRP-GBP', lastPrice: 0.93, fair: 0.9301, index: null, realisedGbp: 4.5, trips: 2, won: 2 }],
    rungs: [
      { book: 'XRP-GBP', side: 'bid', k: 0.0014, order: { price: 0.928, leg: 'entry', state: 'new' }, held: null },
      { book: 'XRP-GBP', side: 'ask', k: 0.0014, order: { price: 0.9312, leg: 'entry', state: 'new' }, held: null },
    ],
    inventory: { at: '2026-11-05T10:00:00.000Z', assets: [
      { asset: 'GBP', amount: 511.5 }, { asset: 'XRP', amount: 100, price: 0.9301, gbp: 93.01, priceFrom: 'fair', unrealisedGbp: 0.01 },
    ] },
    days: [{ day: '2026-11-05', orders: 900, fills: 12, trips: 1, won: 1, realisedGbp: 1.5, pnlGbp: 1.2, staleS: 4, today: true, realisedUsd: 1.95 }],
    trips: [{ book: 'XRP-GBP', side: 'bid', k: 0.0014, tEntry: '2026-11-05T09:45:00.000Z', tExit: '2026-11-05T09:50:00.000Z', entry: 0.92, exit: 0.935, qty: 100,
      how: 'maker', feesGbp: 0, pnlGbp: 1.5, feesUsd: 0, pnlUsd: 1.95 }],
    tripCount: 2, tripsWon: 2, orders: [],
  },
  twin: { id: 'xrpgbp', arm: 'p600', name: 'Crypto quotes XRP/GBP', startedAt: '2026-11-02T00:00:00.000Z', mode: 'running', lastTurn: '2026-11-05T10:00:00.000Z',
    converting: [], notes: ['Quoting since 2026-11-02 00:00 UTC'] },
};
const ID = `${QUOTES_CRYPTO_ROW_PREFIX}xrpgbp`;

describe("'Crypto quotes XRP/GBP'", () => {
  it('is a paper row in pounds on Revolut X, quoting once its start has passed', () => {
    const r = quotesCryptoRow(q);
    expect(r).toMatchObject({ id: ID, name: 'Crypto quotes XRP/GBP', venue: 'Revolut X', venueId: 'revx', mode: 'paper', ccy: 'GBP' });
    expect(r?.status).toMatchObject({ label: 'paper', running: true, tone: 'running' });
    expect(r?.status.detail).toMatch(/^quoting XRP\/GBP around Binance's price/);
    expect(quotesCryptoRow({ ...q, twin: { ...q.twin, startedAt: '2026-11-06T00:00:00.000Z' } })?.status.detail).toMatch(/^recording; it quotes from its start/);
    expect(quotesCryptoRow({ ...q, running: false })?.status).toMatchObject({ tone: 'stale' });
    expect(quotesCryptoRow(null)).toBeNull();
  });

  it('shows FUNDED, DEPLOYED, TODAY (DAYS\' today), UNREALIZED on the coin\'s cost and REALIZED on FUNDED', () => {
    const x = rowMoney(quotesCryptoRow(q));
    expect([x.ccy, x.capital, x.value, x.today, x.unrealised, x.realised]).toEqual(['GBP', 600, 232.21, 1.5, 0.01, 4.5]);
    expect(x.today).toBe(q.detail.days[0].realisedGbp);
    expect(x.realisedPct).toBeCloseTo(0.75, 12);
    expect(x.unrealisedPct).toBeCloseTo((0.01 / 93) * 100, 12);
  });

  it("adds into Revolut X's card and TESTING with the other rows, field for field", () => {
    const twin = { id: 'rx', venueId: 'revx', mode: 'paper', capitalUsd: 780, costUsd: 0, valueUsd: 100, unrealisedUsd: 0, realisedUsd: 2, todayUsd: 1, feesUsd: 0 };
    const row = quotesCryptoRow(q);
    const [rx] = venueRows({ strategies: [], venues: [] }, 'testing', [twin, row]);
    expect([rx.id, rx.tests]).toEqual(['revx', 2]);
    for (const k of /** @type {const} */ (['capitalUsd', 'valueUsd', 'realisedUsd', 'unrealisedUsd', 'todayUsd'])) {
      expect(rx[k], k).toBeCloseTo(Number(twin[k]) + Number(row?.[k]), 9);
    }
  });

  it('sits after Revolut X\'s other paper rows on TESTING and opens its own page', () => {
    const dash = { quotesCrypto: [q], quotesXhedge: [], quotesTwins: [] };
    expect(paperTestRows(dash).map((r) => r.id)).toEqual([ID]);
    expect(quotesPageFor(ID, dash)).toBe('crypto');
    expect(quotesCryptoOf(ID, dash)).toBe(q);
    expect(quotesPageFor(ID, {})).toBeNull();
    expect(quotesCryptoOf('__quotes_twin_pr5', dash)).toBeNull();
  });

  it('its page: one book, so no Book column; its lines; INVENTORY its pounds and its XRP at the fair', () => {
    expect(quotesShowBook(q, q.detail.trips)).toBe(false);
    expect(quotesTwinLines(q).waiting).toEqual(q.twin.notes);
    const inv = quotesLiveInventory(q, (s) => s, { minGbp: 0.1 });
    expect(inv?.rows.map((r) => [r.asset, r.amount, r.gbp, r.priceFrom])).toEqual([['GBP', '£511.50', null, null], ['XRP', '100.00 XRP', '£93.01', 'fair']]);
  });
});
