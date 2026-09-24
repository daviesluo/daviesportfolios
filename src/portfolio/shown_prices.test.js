// Pins for the last-shown price overlay (shown_prices.js). The rule it
// carries: a reload paints the prices the page last showed, and nothing of
// them can reach the server — the overlay touches price fields only, and
// the save is decided on everything else.
import { describe, it, expect } from 'vitest';
import { SHOWN_PRICE_FIELDS, shownPricesOf, withShownPrices, withoutPriced } from './shown_prices.js';
import { portfolioUserFingerprint } from './portfolio_remote.js';

// The book as the server row holds it: its prices are the ones of the
// last save, not what the page showed.
const book = () => ({
  positions: { CM: { role: 'MID', label: 'CM', subtitle: '', tickers: ['ACME', 'SPAX.PVT'] }, GK: { role: 'GK', label: 'GK', subtitle: '', tickers: ['CASH'] } },
  holdings: {
    ACME: {
      shares: 6, cost: 200, currency: 'USD', lastPrice: 215, prevClose: 212, dayPct: 1.42,
      lots: [{ date: '2026-07-19', shares: 10, cost: 200 }], sells: [{ date: '2026-08-08', shares: 4, price: 230 }],
    },
    'SPAX.PVT': { shares: 10, cost: 50, currency: 'USD', lastPrice: 80, prevClose: 75, dayPct: 6.67, lots: [{ date: '2026-01-02', shares: 10, cost: 50 }] },
    CASH: { shares: 1, cost: 500, lastPrice: 500, dayPct: 0, isCash: true, currency: 'USD' },
  },
});
// What the page showed for ACME at its last tick.
const SHOWN = { ACME: { lastPrice: 240, prevClose: 238, dayPct: 0.84, extPrice: 247.2, extDayPct: 3, extPriceTrusted: true } };

describe('withShownPrices', () => {
  it('draws the last-shown prices over the book and leaves every field of the book as it was', () => {
    const p = book();
    const shown = withShownPrices(p, SHOWN);
    expect(shown.holdings.ACME).toEqual({ ...p.holdings.ACME, ...SHOWN.ACME });
    expect(shown.holdings.ACME.lots).toBe(p.holdings.ACME.lots);
    expect(shown.holdings.ACME.sells).toBe(p.holdings.ACME.sells);
    expect(shown.positions).toBe(p.positions);
  });

  it('never changes what a save is about: the fingerprint of the drawn book is the book\'s own', () => {
    const p = book();
    expect(portfolioUserFingerprint(withShownPrices(p, SHOWN))).toBe(portfolioUserFingerprint(p));
  });

  it('leaves the input untouched — the state the save sends is never the drawn copy', () => {
    const p = book();
    const before = JSON.stringify(p);
    withShownPrices(p, SHOWN);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('leaves cash and .PVT alone: their price is the book, and an edit elsewhere must show', () => {
    const p = book();
    const shown = withShownPrices(p, {
      CASH: { lastPrice: 999 }, 'SPAX.PVT': { lastPrice: 1, prevClose: 1, dayPct: 0 },
    });
    expect(shown).toBe(p);
  });

  it('hands back the same object when nothing applies, so a memo on it settles', () => {
    const p = book();
    expect(withShownPrices(p, {})).toBe(p);
    expect(withShownPrices(p, { GONE: SHOWN.ACME })).toBe(p);
    expect(withShownPrices(null, SHOWN)).toBeNull();
  });

  it('keeps a shown null (no after-hours quote was shown) and ignores a field that was never kept', () => {
    const p = book();
    const shown = withShownPrices(p, { ACME: { lastPrice: 240, extPrice: null } });
    expect(shown.holdings.ACME.extPrice).toBeNull();
    expect(shown.holdings.ACME.prevClose).toBe(212);
  });
});

describe('shownPricesOf', () => {
  it('keeps the six price fields of every market-priced holding, nulls included, and nothing of the book', () => {
    const p = withShownPrices(book(), { ACME: { ...SHOWN.ACME, extPrice: null } });
    const kept = shownPricesOf(p.holdings);
    expect(Object.keys(kept)).toEqual(['ACME']);
    expect(Object.keys(kept.ACME).sort()).toEqual([...SHOWN_PRICE_FIELDS].sort());
    expect(kept.ACME.extPrice).toBeNull();
  });

  it('skips a holding with no positive price — there is nothing worth showing', () => {
    const p = book();
    p.holdings.ACME.lastPrice = 0;
    expect(shownPricesOf(p.holdings)).toEqual({});
    expect(shownPricesOf(null)).toEqual({});
  });

  it('round-trips: what is kept draws back exactly what was shown', () => {
    const shownOnce = withShownPrices(book(), SHOWN);
    const again = withShownPrices(book(), shownPricesOf(shownOnce.holdings));
    expect(again.holdings.ACME).toEqual(shownOnce.holdings.ACME);
  });
});

describe('withoutPriced', () => {
  it('drops each ticker a tick priced, and only those', () => {
    const q = { ACME: SHOWN.ACME, NOVA: { lastPrice: 120 } };
    expect(withoutPriced(q, ['ACME'])).toEqual({ NOVA: { lastPrice: 120 } });
    expect(q.ACME).toBeDefined();
  });

  it('hands back the same object when the tick priced none of them', () => {
    const q = { ACME: SHOWN.ACME };
    expect(withoutPriced(q, ['NOVA'])).toBe(q);
    expect(withoutPriced(q, [])).toBe(q);
  });
});
