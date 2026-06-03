// Pins the SFTBY-shape ext-price suppression: OTC ADRs that quote only
// their regular US session must never carry a Yahoo postMarketPrice, so
// the phantom "after-hours / overnight" move can't reach the UI. Tests
// the predicate directly + the end-to-end suppression through the public
// `fetchTickers` (Edge path).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { quotesRegularSessionOnly, fetchTickers } from './yahoo_fetch.js';

describe('quotesRegularSessionOnly', () => {
  it('is true only for US-shaped tickers with no overnight session (SFTBY)', () => {
    expect(quotesRegularSessionOnly('SFTBY')).toBe(true);
    expect(quotesRegularSessionOnly('sftby')).toBe(true); // case-insensitive
  });
  it('is false for normal US equities (they DO trade ext-hours)', () => {
    expect(quotesRegularSessionOnly('NVDA')).toBe(false);
    expect(quotesRegularSessionOnly('AAPL')).toBe(false);
  });
  it('is false for non-US shapes (handled by their own suffix rules)', () => {
    expect(quotesRegularSessionOnly('VUAG.L')).toBe(false);  // LSE
    expect(quotesRegularSessionOnly('BTC-USD')).toBe(false); // crypto
    expect(quotesRegularSessionOnly('600519')).toBe(false);  // CN fund
    expect(quotesRegularSessionOnly('ES=F')).toBe(false);    // futures
  });
});

describe('fetchTickers — SFTBY ext-price suppression (Edge path)', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  it('nulls SFTBY extPrice/extDayPct from the Edge reply but keeps NVDA’s', async () => {
    globalThis.fetch = /** @type {any} */ (vi.fn(async () => ({
      ok: true,
      json: async () => ({
        SFTBY: { lastPrice: 27.38, prevClose: 27.38, extPrice: 27.11, extDayPct: -0.99, dayPct: 0, currency: 'USD' },
        NVDA:  { lastPrice: 224.85, prevClose: 224.5, extPrice: 226.0, extDayPct: 0.51, dayPct: 0.16, currency: 'USD' },
      }),
    })));
    const out = await fetchTickers(['SFTBY', 'NVDA']);
    expect(out.SFTBY.extPrice).toBe(null);
    expect(out.SFTBY.extDayPct).toBe(null);
    expect(out.SFTBY.lastPrice).toBe(27.38);    // RTH price untouched
    // A real overnight-session equity keeps its ext quote.
    expect(out.NVDA.extPrice).toBe(226.0);
    expect(out.NVDA.extDayPct).toBe(0.51);
  });
});
