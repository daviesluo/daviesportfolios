// "Stablecoin quotes OKX USDG" and "Stablecoin quotes OKX EURC" (okx_quotes.ts, 0150): a row each on TESTING after Coinbase's,
// on a card of OKX's own, opening the paper page Coinbase's arms open; prices in each book's own currency.
import { describe, it, expect } from 'vitest';
import {
  fmtQuotePrice, paperTestRows, QUOTES_OKX_ROW_PREFIX, quotesOkxOf, quotesOkxRow, quotesOkxRows, quotesPageFor, venueLabel, VENUE_HUES, venueRows,
} from './agents.js';

/** A twin as `okxBookView` sends it, cut to what the rows read. */
const twin = (id, name, over = {}) => ({
  venue: 'okx', running: true, lagMinutes: 1, lastError: null,
  capitalGbp: 251.3, costGbp: 0, valueGbp: 251.3, unrealisedGbp: 0, realisedGbp: 0.05, todayGbp: 0.05, feesGbp: 0,
  capitalUsd: 335.2, costUsd: 0, valueUsd: 335.2, unrealisedUsd: 0, realisedUsd: 0.07, todayUsd: 0.07, feesUsd: 0,
  heldRungs: 0, openOrders: 6, detail: { books: [], rungs: [], inventory: null, days: [], trips: [], tripCount: 1, tripsWon: 1, orders: [] },
  twin: { id, name, startedAt: '2026-10-29T00:00:00.000Z', mode: 'running', lastTurn: '2026-10-29T10:00:00.000Z', converting: [] },
  ...over,
});
const dash = { strategies: [], quotesTwins: [], quotesOkx: [twin('okxusdg', 'Stablecoin quotes OKX USDG'), twin('okxeurc', 'Stablecoin quotes OKX EURC', { running: false, lagMinutes: 12 })] };

describe('the OKX twins', () => {
  it('are a row each on TESTING, after the others, paper, on OKX', () => {
    const rows = quotesOkxRows(dash);
    expect(rows.map((r) => [r.id, r.name, r.venue, r.venueId, r.mode])).toEqual([
      [`${QUOTES_OKX_ROW_PREFIX}okxusdg`, 'Stablecoin quotes OKX USDG', 'OKX', 'okx', 'paper'],
      [`${QUOTES_OKX_ROW_PREFIX}okxeurc`, 'Stablecoin quotes OKX EURC', 'OKX', 'okx', 'paper'],
    ]);
    expect(rows[0].status.running).toBe(true);
    expect(rows[1].status).toMatchObject({ running: false, tone: 'stale', detail: 'its last decided minute was 12 min ago' });
    expect(paperTestRows(dash).map((r) => r.id).slice(-2)).toEqual(rows.map((r) => r.id));
    expect(quotesOkxRow(null)).toBe(null);
    expect(quotesOkxRows({})).toEqual([]);
  });

  it('open the paper page, each its own twin; a row whose twin is gone opens nothing', () => {
    expect(quotesPageFor(`${QUOTES_OKX_ROW_PREFIX}okxeurc`, dash)).toBe('okx');
    expect(quotesOkxOf(`${QUOTES_OKX_ROW_PREFIX}okxeurc`, dash).twin.name).toBe('Stablecoin quotes OKX EURC');
    expect(quotesPageFor(`${QUOTES_OKX_ROW_PREFIX}okxgone`, dash)).toBe(null);
    expect(quotesOkxOf('__quotes_coinbase', dash)).toBe(null);
  });

  it('have a card of their own on TESTING, both summed, paper', () => {
    const cards = venueRows(dash, 'testing', quotesOkxRows(dash));
    const okx = cards.find((c) => c.id === 'okx');
    expect(okx).toMatchObject({ label: 'OKX', paper: true, tests: 2 });
    expect(okx?.capitalUsd).toBeCloseTo(670.4, 6);
    expect([venueLabel('okx'), typeof VENUE_HUES.okx]).toEqual(['OKX', 'string']);
  });

  it('show each book in its own currency: euros on USDG-EUR, dollars on EURC-USDC, pounds as before', () => {
    expect([fmtQuotePrice(0.8941, 'USDG-EUR'), fmtQuotePrice(1.118, 'EURC-USDC'), fmtQuotePrice(0.7568, 'USDC-GBP'), fmtQuotePrice(0.75)])
      .toEqual(['€0.8941', '$1.1180', '£0.7568', '£0.7500']);
  });
});
