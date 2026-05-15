// Pin the lots-merge shape so a future change to applyTrading212
// can't silently break the VUAG.L / SEGM.L auto-sync. The
// fetchTrading212Holdings path is just a fetch wrapper — covered by
// the Edge Function's deno tests, not retested here.

import { describe, it, expect } from 'vitest';
import { applyTrading212 } from './trading212.js';

describe('applyTrading212', () => {
  it('replaces lots / shares / cost (per-share AC) for matching tickers; leaves others alone', () => {
    const holdings = {
      'VUAG.L': {
        currency: 'GBP',
        lastPrice: 110,
        lots: [{ date: '2024-01-01', shares: 5, cost: 100 }],  // 100 GBP/share AC
        shares: 5,
        cost: 100,
      },
      'SEGM.L': {
        currency: 'GBP',
        lastPrice: 12,
        lots: [{ date: '2024-06-01', shares: 100, cost: 10 }], // 10 GBP/share AC
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
    // T212-shaped: per-share AC (matching what shapeT212Portfolio
    // returns after the pence/GBX → GBP normalisation).
    const t212 = {
      'VUAG.L': { shares: 12.3, cost: 105.5 },
      'SEGM.L': { shares: 150,  cost: 11.67 },
    };
    const out = applyTrading212(holdings, t212, '2026-05-15');
    expect(out['VUAG.L'].lots).toEqual([{ date: '2026-05-15', shares: 12.3, cost: 105.5 }]);
    expect(out['VUAG.L'].shares).toBe(12.3);
    expect(out['VUAG.L'].cost).toBe(105.5);
    // Non-T212-managed fields stay untouched.
    expect(out['VUAG.L'].currency).toBe('GBP');
    expect(out['VUAG.L'].lastPrice).toBe(110);
    expect(out['SEGM.L'].lots).toEqual([{ date: '2026-05-15', shares: 150, cost: 11.67 }]);
    // NVDA isn't in the T212 response — leave it exactly as it was.
    expect(out['NVDA']).toBe(holdings['NVDA']);
    expect(out['NVDA'].lots).toEqual([{ date: '2024-01-01', shares: 10, cost: 150 }]);
  });

  it('null T212 input → holdings untouched (network failure / API key absent)', () => {
    const holdings = {
      'VUAG.L': { lots: [{ date: '2024-01-01', shares: 5, cost: 100 }], shares: 5, cost: 100 },
    };
    const out = applyTrading212(holdings, null);
    expect(out).toBe(holdings);
    expect(out['VUAG.L'].lots).toEqual([{ date: '2024-01-01', shares: 5, cost: 100 }]);
  });

  it('T212 ticker not in holdings → ignored (no phantom holdings created)', () => {
    const holdings = { 'NVDA': { lots: [], shares: 0, cost: 0 } };
    const t212 = { 'VUAG.L': { shares: 5, cost: 100 } };
    applyTrading212(holdings, t212, '2026-05-15');
    expect(holdings['VUAG.L']).toBeUndefined();
    expect(holdings['NVDA']).toEqual({ lots: [], shares: 0, cost: 0 });
  });
});
