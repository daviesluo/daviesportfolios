// Pin the lots-merge shape so a future change to applyTrading212
// can't silently break the VUAA.L / SAEM.L auto-sync. The
// fetchTrading212Holdings path is just a fetch wrapper — covered by
// the Edge Function's deno tests, not retested here.

import { describe, it, expect } from 'vitest';
import { applyTrading212, applyTrading212NightPrice, applyTrading212SftbyPrice } from './trading212.js';

describe('applyTrading212', () => {
  it('replaces lots / shares / cost (per-share AC) for matching tickers; leaves others alone', () => {
    const holdings = {
      'VUAA.L': {
        currency: 'USD',
        lastPrice: 110,
        lots: [{ date: '2024-01-01', shares: 5, cost: 100 }],  // 100 USD/share AC
        shares: 5,
        cost: 100,
      },
      'SAEM.L': {
        currency: 'USD',
        lastPrice: 12,
        lots: [{ date: '2024-06-01', shares: 100, cost: 10 }], // 10 USD/share AC
        shares: 100,
        cost: 10,
      },
      'NVDA': {
        currency: 'USD',
        lastPrice: 200,
        lots: [{ date: '2024-01-01', shares: 10, cost: 150 }], // 150 USD/share AC
        shares: 10,
        cost: 150,
      },
    };
    // T212-shaped: per-share AC in the instrument's settle currency
    // (USD for both VUAA.L / SAEM.L — both USD-denominated UCITS
    // ETFs on LSE; matches what shapeT212Portfolio returns).
    const t212 = {
      'VUAA.L': { shares: 12.3, cost: 105.5 },
      'SAEM.L': { shares: 150,  cost: 11.67 },
    };
    const out = applyTrading212(holdings, t212, '2026-05-15');
    expect(out['VUAA.L'].lots).toEqual([{ date: '2026-05-15', shares: 12.3, cost: 105.5 }]);
    expect(out['VUAA.L'].shares).toBe(12.3);
    expect(out['VUAA.L'].cost).toBe(105.5);
    // Non-T212-managed fields stay untouched.
    expect(out['VUAA.L'].currency).toBe('USD');
    expect(out['VUAA.L'].lastPrice).toBe(110);
    expect(out['SAEM.L'].lots).toEqual([{ date: '2026-05-15', shares: 150, cost: 11.67 }]);
    // NVDA isn't in the T212 response — leave it exactly as it was.
    expect(out['NVDA']).toBe(holdings['NVDA']);
    expect(out['NVDA'].lots).toEqual([{ date: '2024-01-01', shares: 10, cost: 150 }]);
  });

  it('null T212 input → holdings untouched (network failure / API key absent)', () => {
    const holdings = {
      'VUAA.L': { lots: [{ date: '2024-01-01', shares: 5, cost: 100 }], shares: 5, cost: 100 },
    };
    const out = applyTrading212(holdings, null);
    expect(out).toBe(holdings);
    expect(out['VUAA.L'].lots).toEqual([{ date: '2024-01-01', shares: 5, cost: 100 }]);
  });

  it('T212 ticker not in holdings → ignored (no phantom holdings created)', () => {
    const holdings = { 'NVDA': { lots: [], shares: 0, cost: 0 } };
    const t212 = { 'VUAA.L': { shares: 5, cost: 100 } };
    applyTrading212(holdings, t212, '2026-05-15');
    expect(holdings['VUAA.L']).toBeUndefined();
    expect(holdings['NVDA']).toEqual({ lots: [], shares: 0, cost: 0 });
  });

  it('does NOT touch price fields (price is the night-overlay function\'s job)', () => {
    const holdings = {
      'VUAA.L': {
        lastPrice: 100, prevClose: 98, dayPct: 2.04, extPrice: null,
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }], shares: 5, cost: 90,
      },
    };
    const t212 = { 'VUAA.L': { shares: 6, cost: 95 } };
    const out = applyTrading212(holdings, t212, '2026-05-21');
    expect(out['VUAA.L'].lastPrice).toBe(100);          // untouched
    expect(out['VUAA.L'].dayPct).toBeCloseTo(2.04, 6);  // untouched
    expect(out['VUAA.L'].shares).toBe(6);               // shares/cost synced
    expect(out['VUAA.L'].cost).toBe(95);
  });
});

describe('applyTrading212NightPrice', () => {
  const usHolding = (over = {}) => ({
    currency: 'USD', lastPrice: 200, prevClose: 198, dayPct: 1.0,
    extPrice: null, extDayPct: null, shares: 10, cost: 150, ...over,
  });

  it('active → overrides extPrice + extPriceTrusted + extDayPct for US equities in the intersection', () => {
    const holdings = { AAPL: usHolding({ lastPrice: 200 }) };
    const prices = { AAPL: 206 };
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out.AAPL.extPrice).toBe(206);
    expect(out.AAPL.extPriceTrusted).toBe(true);
    expect(out.AAPL.extDayPct).toBeCloseTo(3, 6); // (206-200)/200*100
    // lastPrice (regular close) is left as the baseline.
    expect(out.AAPL.lastPrice).toBe(200);
  });

  it('inactive (not overnight / ext off) → no-op, original Yahoo logic preserved', () => {
    const holdings = { AAPL: usHolding({ extPrice: 201, extDayPct: 0.5 }) };
    const prices = { AAPL: 206 };
    const out = applyTrading212NightPrice(holdings, prices, false);
    expect(out.AAPL.extPrice).toBe(201);   // unchanged
    expect(out.AAPL.extDayPct).toBe(0.5);  // unchanged
  });

  it('skips non-US-equity tickers (LSE ETFs etc. have no US overnight session)', () => {
    const holdings = { 'VUAA.L': { lastPrice: 98, extPrice: null, currency: 'USD' } };
    const prices = { 'VUAA.L': 99 };
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out['VUAA.L'].extPrice).toBeNull(); // .L → not US equity → skipped
  });

  it('skips OTC ADRs with no overnight session (SFTBY) even though they are US-shaped', () => {
    // SFTBY passes isUsEquity (no suffix) but has no T212 night market —
    // its currentPrice is just the stale RTH/AH close, so we must NOT
    // surface it as a live overnight quote. Leave it on Yahoo.
    const holdings = { SFTBY: usHolding({ lastPrice: 25, extPrice: null }) };
    const prices = { SFTBY: 25.01 };
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out.SFTBY.extPrice).toBeNull();  // excluded by hasOvernightSession
  });

  it('skips tickers not held in the portfolio (T212-only, e.g. a T212 stock not on the board)', () => {
    const holdings = { AAPL: usHolding() };
    const prices = { TSLA: 412 }; // TSLA in T212 but not in local holdings
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out.TSLA).toBeUndefined();
    expect(out.AAPL.extPrice).toBeNull(); // AAPL has no T212 price → untouched
  });

  it('no usable lastPrice baseline → extDayPct null but extPrice still set', () => {
    const holdings = { AAPL: usHolding({ lastPrice: 0 }) };
    const prices = { AAPL: 206 };
    const out = applyTrading212NightPrice(holdings, prices, true);
    expect(out.AAPL.extPrice).toBe(206);
    expect(out.AAPL.extDayPct).toBeNull();
  });

  it('null prices / null holdings → no-op', () => {
    expect(applyTrading212NightPrice(null, { AAPL: 1 }, true)).toBeNull();
    const h = { AAPL: usHolding() };
    expect(applyTrading212NightPrice(h, null, true)).toBe(h);
  });
});

describe('applyTrading212SftbyPrice', () => {
  it('overrides SFTBY lastPrice + extPrice with T212 price, zeroes extDayPct', () => {
    const holdings = {
      SFTBY: {
        shares: 140, cost: 2593, lastPrice: 23.30, extPrice: 23.30,
        prevClose: 24.72, dayPct: -5.74, extDayPct: 0, extPriceTrusted: false,
      },
    };
    applyTrading212SftbyPrice(holdings, { SFTBY: 22.85 });
    expect(holdings.SFTBY.lastPrice).toBe(22.85);
    expect(holdings.SFTBY.extPrice).toBe(22.85);
    expect(holdings.SFTBY.dayPct).toBeCloseTo(-7.566, 2);
    expect(holdings.SFTBY.extDayPct).toBe(0);
    expect(holdings.SFTBY.extPriceTrusted).toBe(true);
    // prevClose left alone — keeps Yahoo's value until a follow-up
    // wires a T212-native prevClose source.
    expect(holdings.SFTBY.prevClose).toBe(24.72);
  });

  it('no-op when SFTBY missing from prices or holdings', () => {
    const holdings = { SFTBY: { lastPrice: 23.30, prevClose: 24.72 } };
    applyTrading212SftbyPrice(holdings, null);
    applyTrading212SftbyPrice(holdings, {});
    applyTrading212SftbyPrice(holdings, { AAPL: 200 });
    expect(holdings.SFTBY.lastPrice).toBe(23.30);
    expect(applyTrading212SftbyPrice({}, { SFTBY: 22.85 })).toEqual({});
  });

  it('no-op for non-positive or non-finite T212 prices', () => {
    const holdings = { SFTBY: { lastPrice: 23.30, prevClose: 24.72 } };
    applyTrading212SftbyPrice(holdings, { SFTBY: 0 });
    applyTrading212SftbyPrice(holdings, { SFTBY: -1 });
    applyTrading212SftbyPrice(holdings, { SFTBY: /** @type {any} */ (Infinity) });
    applyTrading212SftbyPrice(holdings, { SFTBY: /** @type {any} */ (NaN) });
    expect(holdings.SFTBY.lastPrice).toBe(23.30);
  });

  it('leaves non-SFTBY tickers untouched', () => {
    const holdings = {
      AAPL: { lastPrice: 200, extPrice: 201, prevClose: 199, dayPct: 0.5, extDayPct: 0.5 },
      SFTBY: { lastPrice: 23.30, prevClose: 24.72 },
    };
    applyTrading212SftbyPrice(holdings, { AAPL: 250, SFTBY: 22.85 });
    expect(holdings.AAPL.lastPrice).toBe(200);
    expect(holdings.AAPL.extPrice).toBe(201);
    expect(holdings.SFTBY.lastPrice).toBe(22.85);
  });

  it('serverPrevClose overrides Yahoo prevClose and re-anchors dayPct', () => {
    const holdings = {
      SFTBY: {
        shares: 140, cost: 2593, lastPrice: 23.30, extPrice: 23.30,
        prevClose: 99.99, dayPct: 0, extDayPct: 0, extPriceTrusted: false,
      },
    };
    applyTrading212SftbyPrice(holdings, { SFTBY: 22.85 }, 24.72);
    expect(holdings.SFTBY.lastPrice).toBe(22.85);
    expect(holdings.SFTBY.prevClose).toBe(24.72);
    expect(holdings.SFTBY.dayPct).toBeCloseTo(-7.566, 2);
  });

  it('ignores serverPrevClose when non-positive / non-finite (falls back to Yahoo prevClose)', () => {
    const holdings = { SFTBY: { lastPrice: 23.30, prevClose: 24.72 } };
    applyTrading212SftbyPrice(holdings, { SFTBY: 22.85 }, 0);
    expect(holdings.SFTBY.prevClose).toBe(24.72);
    applyTrading212SftbyPrice(holdings, { SFTBY: 22.85 }, /** @type {any} */ (NaN));
    expect(holdings.SFTBY.prevClose).toBe(24.72);
    applyTrading212SftbyPrice(holdings, { SFTBY: 22.85 }, null);
    expect(holdings.SFTBY.prevClose).toBe(24.72);
  });
});
