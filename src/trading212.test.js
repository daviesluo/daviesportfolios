// Pin the lots-merge shape so a future change to applyTrading212
// can't silently break the VUAA.L / SAEM.L auto-sync. The
// fetchTrading212Holdings path is just a fetch wrapper — covered by
// the Edge Function's deno tests, not retested here.

import { describe, it, expect } from 'vitest';
import { applyTrading212 } from './trading212.js';

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

  it('applies T212 price as lastPrice + recomputes dayPct vs prevClose', () => {
    const holdings = {
      'VUAA.L': {
        currency: 'USD',
        lastPrice: 100,   // Yahoo's price, set earlier in the refresh
        prevClose: 100,   // Yahoo's last close — basis for dayPct
        dayPct: 0,
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }],
        shares: 5,
        cost: 90,
      },
    };
    const t212 = { 'VUAA.L': { shares: 6, cost: 95, price: 105 } };
    const out = applyTrading212(holdings, t212, '2026-05-21');
    expect(out['VUAA.L'].lastPrice).toBe(105);          // T212 quote wins
    expect(out['VUAA.L'].dayPct).toBeCloseTo(5, 6);     // (105-100)/100*100
    expect(out['VUAA.L'].shares).toBe(6);
    expect(out['VUAA.L'].cost).toBe(95);
    expect(out['VUAA.L'].lots).toEqual([{ date: '2026-05-21', shares: 6, cost: 95 }]);
  });

  it('no T212 price → lastPrice / dayPct untouched (Yahoo stays source)', () => {
    const holdings = {
      'VUAA.L': {
        lastPrice: 100, prevClose: 98, dayPct: 2.04,
        lots: [{ date: '2024-01-01', shares: 5, cost: 90 }], shares: 5, cost: 90,
      },
    };
    const t212 = { 'VUAA.L': { shares: 6, cost: 95 } }; // no price
    const out = applyTrading212(holdings, t212, '2026-05-21');
    expect(out['VUAA.L'].lastPrice).toBe(100);  // unchanged
    expect(out['VUAA.L'].dayPct).toBeCloseTo(2.04, 6);
    expect(out['VUAA.L'].shares).toBe(6);       // shares/cost still synced
    expect(out['VUAA.L'].cost).toBe(95);
  });

  it('T212 price but no usable prevClose → lastPrice set, dayPct left as-is', () => {
    const holdings = {
      'VUAA.L': {
        lastPrice: 100, prevClose: 0, dayPct: 1.5,
        lots: [], shares: 5, cost: 90,
      },
    };
    const t212 = { 'VUAA.L': { shares: 5, cost: 90, price: 110 } };
    const out = applyTrading212(holdings, t212, '2026-05-21');
    expect(out['VUAA.L'].lastPrice).toBe(110);
    expect(out['VUAA.L'].dayPct).toBe(1.5); // can't recompute without prevClose
  });
});
