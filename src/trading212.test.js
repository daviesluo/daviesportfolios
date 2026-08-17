// Pin the lots-merge shape so a future change to applyTrading212
// can't silently break the VUAA.L / SAEM.L auto-sync. The
// fetchTrading212Holdings path is just a fetch wrapper — covered by
// the Edge Function's deno tests, not retested here.

import { describe, it, expect } from 'vitest';
import { applyTrading212, applyTrading212NightPrice } from './trading212.js';

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
    const out = applyTrading212(holdings, t212, undefined, '2026-05-15');
    // Shares + cost come from the broker, but the DATE is the one the
    // holding already carried. Re-stamping today's made the position
    // read as bought this morning, every morning — and anything
    // reconstructing the past from the ledger (the Investment
    // Performance chart's derived half, and the net-deposit figure the
    // sampler records) then saw the money arriving today.
    expect(out['VUAA.L'].lots).toEqual([{ date: '2024-01-01', shares: 12.3, cost: 105.5 }]);
    expect(out['VUAA.L'].shares).toBe(12.3);
    expect(out['VUAA.L'].cost).toBe(105.5);
    // No prices map passed → price fields stay untouched.
    expect(out['VUAA.L'].currency).toBe('USD');
    expect(out['VUAA.L'].lastPrice).toBe(110);
    expect(out['SAEM.L'].lots).toEqual([{ date: '2024-06-01', shares: 150, cost: 11.67 }]);
    // NVDA isn't in the T212 response — leave it exactly as it was.
    expect(out['NVDA']).toBe(holdings['NVDA']);
    expect(out['NVDA'].lots).toEqual([{ date: '2024-01-01', shares: 10, cost: 150 }]);
  });

  it('stamps today only on the FIRST sync, when there is nothing to preserve', () => {
    const out = applyTrading212(
      { 'VUAA.L': { currency: 'USD', lastPrice: 110 } },
      { 'VUAA.L': { shares: 1, cost: 100 } }, undefined, '2026-05-15',
    );
    expect(out['VUAA.L'].lots).toEqual([{ date: '2026-05-15', shares: 1, cost: 100 }]);
  });

  it('keeps the EARLIEST date when the holding carries several lots', () => {
    const out = applyTrading212(
      { 'VUAA.L': { lots: [
        { date: '2025-03-04', shares: 2, cost: 90 },
        { date: '2024-02-02', shares: 3, cost: 80 },
      ] } },
      { 'VUAA.L': { shares: 5, cost: 84 } }, undefined, '2026-05-15',
    );
    expect(out['VUAA.L'].lots[0].date).toBe('2024-02-02');
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
    applyTrading212(holdings, t212, undefined, '2026-05-15');
    expect(holdings['VUAA.L']).toBeUndefined();
    expect(holdings['NVDA']).toEqual({ lots: [], shares: 0, cost: 0 });
  });

  it('no prices map → price fields untouched (shares/cost only)', () => {
    const holdings = {
      'VUAA.L': {
        lastPrice: 100, prevClose: 98, dayPct: 2.04, extPrice: null,
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }], shares: 5, cost: 90,
      },
    };
    const t212 = { 'VUAA.L': { shares: 6, cost: 95 } };
    const out = applyTrading212(holdings, t212, undefined, '2026-05-21');
    expect(out['VUAA.L'].lastPrice).toBe(100);          // untouched
    expect(out['VUAA.L'].dayPct).toBeCloseTo(2.04, 6);  // untouched
    expect(out['VUAA.L'].shares).toBe(6);               // shares/cost synced
    expect(out['VUAA.L'].cost).toBe(95);
  });

  it('with a prices map → uses the T212 quote as lastPrice + recomputes dayPct vs prevClose (USD)', () => {
    const holdings = {
      'VUAA.L': {
        lastPrice: 144.46,   // stale Yahoo close
        prevClose: 144.46,   // yesterday's close (USD)
        dayPct: 0, extPrice: null, currency: 'USD',
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }], shares: 5, cost: 90,
      },
    };
    const t212   = { 'VUAA.L': { shares: 6, cost: 95 } };
    const prices = { 'VUAA.L': 145.08 };   // broker's live quote
    const out = applyTrading212(holdings, t212, prices, '2026-07-02');
    expect(out['VUAA.L'].lastPrice).toBe(145.08);           // T212 quote wins
    expect(out['VUAA.L'].currency).toBe('USD');             // pinned USD
    expect(out['VUAA.L'].dayPct).toBeCloseTo(0.4292, 3);    // (145.08-144.46)/144.46*100
    expect(out['VUAA.L'].shares).toBe(6);                   // shares/cost still synced
    expect(out['VUAA.L'].cost).toBe(95);
  });

  it('prices map without an entry for the ticker → that ticker keeps its Yahoo price', () => {
    const holdings = {
      'VUAA.L': { lastPrice: 110, prevClose: 108, dayPct: 1.85, currency: 'USD',
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }], shares: 5, cost: 90 },
    };
    const t212   = { 'VUAA.L': { shares: 6, cost: 95 } };
    const prices = { 'SAEM.L': 10.6 };   // no VUAA.L quote this tick
    const out = applyTrading212(holdings, t212, prices, '2026-07-02');
    expect(out['VUAA.L'].lastPrice).toBe(110);             // untouched (Yahoo fallback)
    expect(out['VUAA.L'].dayPct).toBeCloseTo(1.85, 6);
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
    expect(applyTrading212NightPrice(/** @type {any} */ (null), { AAPL: 1 }, true)).toBeNull();
    const h = { AAPL: usHolding() };
    expect(applyTrading212NightPrice(h, null, true)).toBe(h);
  });
});
