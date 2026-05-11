// Pin tests for the portfolio math the scoreboard + heatmap + position
// cards read — `fxRateToUSD` / `fxToUSD` (native currency conversion)
// and `computeMetrics` (per-position rollup). Before this file these
// were the largest piece of on-screen logic without a vitest case
// guarding it; a regression here misreports the user's portfolio
// value silently, which is the worst class of bug for this app.

import { describe, it, expect } from 'vitest';
import { computeMetrics } from './metrics.js';
import { fxRateToUSD, fxToUSD } from './fx.js';

// --- fxRateToUSD --------------------------------------------------

describe('fxRateToUSD', () => {
  const md = {
    'GBPUSD=X': { lastPrice: 1.25 },
    'USDCNY=X': { lastPrice: 7.20 },
    'USDHKD=X': { lastPrice: 7.80 },
  };

  it('USD returns 1 with no fallback flag', () => {
    expect(fxRateToUSD('USD', md)).toEqual({ rate: 1, missing: false });
  });

  it('GBP uses GBPUSD=X directly', () => {
    expect(fxRateToUSD('GBP', md)).toEqual({ rate: 1.25, missing: false });
  });

  it('CNY inverts USDCNY=X', () => {
    expect(fxRateToUSD('CNY', md).rate).toBeCloseTo(1 / 7.20, 6);
    expect(fxRateToUSD('CNY', md).missing).toBe(false);
  });

  it('HKD inverts USDHKD=X', () => {
    expect(fxRateToUSD('HKD', md).rate).toBeCloseTo(1 / 7.80, 6);
    expect(fxRateToUSD('HKD', md).missing).toBe(false);
  });

  it('missing FX pair → rate 1, missing TRUE (the silent-error case)', () => {
    expect(fxRateToUSD('GBP', {})).toEqual({ rate: 1, missing: true });
    expect(fxRateToUSD('CNY', {})).toEqual({ rate: 1, missing: true });
    expect(fxRateToUSD('HKD', {})).toEqual({ rate: 1, missing: true });
  });

  it('zero / NaN / negative lastPrice → missing TRUE (treat as no data)', () => {
    expect(fxRateToUSD('GBP', { 'GBPUSD=X': { lastPrice: 0 } }).missing).toBe(true);
    expect(fxRateToUSD('CNY', { 'USDCNY=X': { lastPrice: NaN } }).missing).toBe(true);
    expect(fxRateToUSD('HKD', { 'USDHKD=X': { lastPrice: -1 } }).missing).toBe(true);
  });

  it('empty / null currency → rate 1 (treat as USD)', () => {
    expect(fxRateToUSD('',   md)).toEqual({ rate: 1, missing: false });
    expect(fxRateToUSD(null, md)).toEqual({ rate: 1, missing: false });
  });
});

describe('fxToUSD (back-compat shim)', () => {
  it('returns just the rate, silently falling back to 1 on missing pair', () => {
    expect(fxToUSD('GBP', { 'GBPUSD=X': { lastPrice: 1.25 } })).toBe(1.25);
    expect(fxToUSD('GBP', {})).toBe(1);  // the silent-fallback case
  });
});

// --- computeMetrics -----------------------------------------------

/** Minimal portfolio factory — keeps each test focused on its own delta. */
function pf(holdings, positions) {
  return { holdings, positions };
}

describe('computeMetrics — single-currency happy paths', () => {
  it('USD-only portfolio: marketValue = Σ shares × lastPrice; dayChange = mv − Σ shares × prevClose', () => {
    const m = computeMetrics(pf(
      {
        AAPL: { shares: 10, lastPrice: 100, prevClose: 90, cost: 80, currency: 'USD', dayPct:  11.11 },
        NVDA: { shares:  2, lastPrice: 500, prevClose: 480, cost: 400, currency: 'USD', dayPct: 4.17 },
      },
      { FWD: { role: 'FWD', tickers: ['AAPL', 'NVDA'], label: 'FWD' } },
    ));
    expect(m.marketValue).toBeCloseTo(10 * 100 + 2 * 500, 6);       // 2000
    expect(m.totalCost).toBeCloseTo(10 * 80 + 2 * 400, 6);          // 1600
    expect(m.dayChange).toBeCloseTo((1000 - 900) + (1000 - 960), 6); // 140
    expect(m.unrlGL).toBeCloseTo(2000 - 1600, 6);                   // 400
    expect(m.tickerCount).toBe(2);
    expect(m.fxMissingTickers).toEqual([]);
  });

  it('cash is held as a dollar amount: MV = lastPrice, no day change, no P/L', () => {
    const m = computeMetrics(pf(
      { CASH: { isCash: true, shares: 1, lastPrice: 5000, prevClose: 5000, cost: 5000, currency: 'USD' } },
      { GK: { role: 'GK', tickers: ['CASH'], label: 'GK' } },
    ));
    expect(m.marketValue).toBe(5000);
    expect(m.dayChange).toBe(0);
    expect(m.unrlGL).toBe(0);
    expect(m.tickerCount).toBe(0);                                   // cash doesn't count
  });
});

describe('computeMetrics — multi-currency', () => {
  const md = {
    'GBPUSD=X': { lastPrice: 1.25 },
    'USDCNY=X': { lastPrice: 7.20 },
  };

  it('GBP and CNY positions convert to USD with the live FX rate', () => {
    // £100 share × 10 shares = £1000 = $1250
    // ¥100 share × 100 shares = ¥10000 ≈ $1388.89
    const m = computeMetrics(pf(
      {
        'VUAG.L': { shares:  10, lastPrice: 100, prevClose: 100, cost: 100, currency: 'GBP', dayPct: 0 },
        '017731': { shares: 100, lastPrice: 100, prevClose: 100, cost: 100, currency: 'CNY', dayPct: 0 },
      },
      { FWD: { role: 'FWD', tickers: ['VUAG.L', '017731'], label: 'FWD' } },
    ), { marketData: md });
    expect(m.marketValue).toBeCloseTo(10 * 100 * 1.25 + 100 * 100 * (1 / 7.20), 4);
    expect(m.fxMissingTickers).toEqual([]);
  });

  it('FX pair MISSING from marketData → rate 1:1 and the ticker is flagged', () => {
    // Without the badge this is the silent ~20% under-report case.
    const m = computeMetrics(pf(
      { 'VUAG.L': { shares: 10, lastPrice: 100, prevClose: 100, cost: 100, currency: 'GBP', dayPct: 0 } },
      { FWD: { role: 'FWD', tickers: ['VUAG.L'], label: 'FWD' } },
    ), { marketData: {} });
    // 10 × 100 × 1 (fallback rate) = 1000, NOT the real ~1250.
    expect(m.marketValue).toBe(1000);
    expect(m.fxMissingTickers).toEqual(['VUAG.L']);
    expect(m.positions.FWD.players[0].fxMissing).toBe(true);
  });

  it('mixed: only the GBP holding flagged when GBPUSD=X is missing but USDCNY=X is present', () => {
    const m = computeMetrics(pf(
      {
        'VUAG.L': { shares:  10, lastPrice: 100, prevClose: 100, cost: 100, currency: 'GBP', dayPct: 0 },
        '017731': { shares: 100, lastPrice: 100, prevClose: 100, cost: 100, currency: 'CNY', dayPct: 0 },
      },
      { FWD: { role: 'FWD', tickers: ['VUAG.L', '017731'], label: 'FWD' } },
    ), { marketData: { 'USDCNY=X': { lastPrice: 7.20 } } });
    expect(m.fxMissingTickers).toEqual(['VUAG.L']);
  });
});

describe('computeMetrics — extended-hours toggle', () => {
  // ext-on:  uses extPrice if available; baseline is today's RTH lastPrice (= the
  //           previous regular close from this session) so day change = AH move
  //           since 16:00 ET.
  // ext-off: uses lastPrice; baseline is yesterday's prevClose so day change =
  //           full-session move since previous close.
  it('ext OFF: baseline = prevClose, day change = (lastPrice − prevClose) × shares', () => {
    const m = computeMetrics(pf(
      { NVDA: { shares: 10, lastPrice: 100, prevClose: 90, extPrice: 105, extDayPct: 5,
                cost: 80, currency: 'USD', dayPct: 11.11 } },
      { FWD: { role: 'FWD', tickers: ['NVDA'], label: 'FWD' } },
    ));
    expect(m.marketValue).toBe(1000);                  // 10 × 100
    expect(m.dayChange).toBeCloseTo(10 * (100 - 90));  // 100
  });

  it('ext ON: extPrice substitutes for lastPrice and baseline flips to today\'s RTH close', () => {
    const m = computeMetrics(pf(
      { NVDA: { shares: 10, lastPrice: 100, prevClose: 90, extPrice: 105, extDayPct: 5,
                cost: 80, currency: 'USD', dayPct: 11.11 } },
      { FWD: { role: 'FWD', tickers: ['NVDA'], label: 'FWD' } },
    ), { extended: true });
    // mv uses extPrice (105); baseline = today's RTH lastPrice (100).
    expect(m.marketValue).toBe(1050);                  // 10 × 105
    expect(m.dayChange).toBeCloseTo(10 * (105 - 100)); // 50 — the AH move only
  });

  it('ext ON but no extPrice available → falls back to lastPrice; day change = 0', () => {
    const m = computeMetrics(pf(
      { NVDA: { shares: 10, lastPrice: 100, prevClose: 90, cost: 80, currency: 'USD' } },
      { FWD: { role: 'FWD', tickers: ['NVDA'], label: 'FWD' } },
    ), { extended: true });
    // ext baseline is also lastPrice → 0 AH move shown
    expect(m.dayChange).toBe(0);
  });
});

describe('computeMetrics — degenerate inputs', () => {
  it('empty portfolio → zero everywhere, no NaN leaks', () => {
    const m = computeMetrics(pf({}, {}));
    expect(m.marketValue).toBe(0);
    expect(m.dayChange).toBe(0);
    expect(m.dayPct).toBe(0);
    expect(m.unrlGL).toBe(0);
    expect(m.unrlPct).toBe(0);
    expect(m.fxMissingTickers).toEqual([]);
  });

  it('position references a ticker that was deleted from holdings → silently skipped', () => {
    const m = computeMetrics(pf(
      { NVDA: { shares: 1, lastPrice: 100, prevClose: 100, cost: 100, currency: 'USD' } },
      { FWD: { role: 'FWD', tickers: ['NVDA', 'GHOST'], label: 'FWD' } },
    ));
    expect(m.positions.FWD.players.length).toBe(1);
    expect(m.marketValue).toBe(100);
  });

  it('all-cash portfolio: dayPct = 0, not NaN (was a /0 bug before the guard)', () => {
    const m = computeMetrics(pf(
      { CASH: { isCash: true, shares: 1, lastPrice: 1000, prevClose: 1000, cost: 1000, currency: 'USD' } },
      { GK: { role: 'GK', tickers: ['CASH'], label: 'GK' } },
    ));
    expect(m.dayPct).toBe(0);
    expect(m.unrlPct).toBe(0);
  });
});
