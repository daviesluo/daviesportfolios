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
  // ext-on:  uses extPrice when it's a trusted AH quote (the verdict
  //           `extPriceTrusted`, else the ±5% quote heuristic).
  //           Baseline is today's RTH close, so day change = the AH
  //           move since 16:00 ET — and a US name that didn't trade
  //           AH reads 0 (not a stale regular-session number).
  // ext-off: uses lastPrice; baseline is yesterday's prevClose so day
  //           change = full-session move since previous close.
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
    // 3 % AH move — under the 5 % EXT_PRICE_MAX_DIVERGENCE gate so
    // extPrice is trusted; the SFTBY-style 8 %+ divergence is
    // separately pinned in the OTC ADR test below.
    const m = computeMetrics(pf(
      { NVDA: { shares: 10, lastPrice: 100, prevClose: 90, extPrice: 103, extDayPct: 3,
                cost: 80, currency: 'USD', dayPct: 11.11 } },
      { FWD: { role: 'FWD', tickers: ['NVDA'], label: 'FWD' } },
    ), { extended: true });
    // mv uses extPrice (103); baseline = today's RTH lastPrice (100).
    expect(m.marketValue).toBe(1030);                  // 10 × 103
    expect(m.dayChange).toBeCloseTo(10 * (103 - 100)); // 30 — the AH move only
  });

  it('ext ON but no extPrice → anchors at today\'s RTH close → reads flat (0), not the stale regular-session move', () => {
    const m = computeMetrics(pf(
      { NVDA: { shares: 10, lastPrice: 100, prevClose: 90, cost: 80, currency: 'USD' } },
      { FWD: { role: 'FWD', tickers: ['NVDA'], label: 'FWD' } },
    ), { extended: true });
    // No extPrice → not trusted → in ext mode the baseline is today's
    // RTH close (lastPrice), so a name that didn't trade AH reads
    // flat. (Previously this fell back to prevClose and showed the
    // full regular-session move — a stale number once the US market
    // has closed for the day.)
    expect(m.dayChange).toBe(0);
    expect(m.positions.FWD.players[0].dayPct).toBe(0);
  });

  it('OTC ADR bogus extPrice (SFTBY): rejected, and in ext mode the card reads flat (0) — not the bogus spike, not a stale regular-session move', () => {
    // SFTBY-shape input: today's regular close $18.65, Yahoo's bogus
    // postMarketPrice $20.15 (= today's open). SFTBY is an OTC ADR
    // with no real AH session — once the US market has closed it
    // genuinely hasn't moved, so the card should read $0 / 0%.
    const m = computeMetrics(pf(
      { SFTBY: {
          shares: 50, lastPrice: 18.65, prevClose: 20.15,
          extPrice: 20.15, extDayPct: 0,
          cost: 18.58, currency: 'USD', dayPct: -7.45,
        }
      },
      { FWD: { role: 'FWD', tickers: ['SFTBY'], label: 'FWD' } },
    ), { extended: true });
    expect(m.positions.FWD.players[0].lastPrice).toBe(18.65);   // not $20.15
    expect(m.dayChange).toBe(0);                                 // flat since the close
    expect(m.positions.FWD.players[0].dayPct).toBe(0);
  });

  it('Real AH move within 5 % of lastPrice (NVDA +2 %) is trusted', () => {
    const m = computeMetrics(pf(
      { NVDA: {
          shares: 10, lastPrice: 100, prevClose: 90,
          extPrice: 102, extDayPct: 13.33,
          cost: 80, currency: 'USD', dayPct: 11.11,
        }
      },
      { FWD: { role: 'FWD', tickers: ['NVDA'], label: 'FWD' } },
    ), { extended: true });
    expect(m.positions.FWD.players[0].lastPrice).toBe(102);
    // ext baseline = today's RTH close (100) → AH-only delta of 10×(102−100) = 20.
    expect(m.dayChange).toBeCloseTo(20);
  });

  it('extPriceTrusted=true overrides the ±5 % heuristic — a big real AH move is trusted (CBRS-shape)', () => {
    // Hot IPO up huge in AH. extPrice diverges far more than 5 % from
    // the RTH close, so the quote-only heuristic would reject it —
    // but the app's intraday validation set extPriceTrusted=true (the
    // pre/post bars confirm the move). The card must match the chart
    // modal and show the real AH price + the AH move.
    const m = computeMetrics(pf(
      { CBRS: {
          shares: 7, lastPrice: 185, prevClose: 185,
          extPrice: 311, extDayPct: 68.1, extPriceTrusted: true,
          cost: 100, currency: 'USD', dayPct: 0,
        }
      },
      { FWD: { role: 'FWD', tickers: ['CBRS'], label: 'FWD' } },
    ), { extended: true });
    expect(m.positions.FWD.players[0].lastPrice).toBe(311);      // the real AH price
    expect(m.dayChange).toBeCloseTo(7 * (311 - 185));            // AH move vs today's close
    expect(m.positions.FWD.players[0].dayPct).toBe(68.1);
  });

  it('extPriceTrusted=false overrides the ±5 % heuristic — a tracking-but-rejected extPrice is NOT trusted', () => {
    // extPrice is within 5 % of lastPrice (the heuristic alone would
    // accept it), but the app's intraday validation found no real AH
    // bars and set extPriceTrusted=false. The verdict wins → the card
    // reads flat, matching what the modal shows.
    const m = computeMetrics(pf(
      { FOO: {
          shares: 10, lastPrice: 100, prevClose: 90,
          extPrice: 102, extDayPct: 2, extPriceTrusted: false,
          cost: 80, currency: 'USD', dayPct: 11.11,
        }
      },
      { FWD: { role: 'FWD', tickers: ['FOO'], label: 'FWD' } },
    ), { extended: true });
    expect(m.positions.FWD.players[0].lastPrice).toBe(100);     // lastPrice, not 102
    expect(m.dayChange).toBe(0);                                 // flat since the close
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

  // .L tickers (LSE) have no US-style ext-hours session. When the
  // ext-hours toggle is on AND LSE itself is closed, the row must
  // read 0 % — not the stale "today's LSE dayPct" the previous
  // implementation surfaced. When LSE is open (e.g. during US
  // pre-market), the toggle reverts to showing the live LSE
  // intraday pct.
  //
  // metrics.js's `lseSuppress` reads the live wall clock, so these
  // tests stash/restore `Date` to deterministically place the test
  // inside an LSE-closed window (UTC 02:00 = UK 02:00 GMT / 03:00 BST,
  // both safely before the 08:00 open) and an LSE-open window
  // (UTC 12:00 = UK 12:00 / 13:00, both inside 08:00-16:30).
  describe('LSE ticker + ext-hours toggle', () => {
    const realDate = globalThis.Date;
    function freezeAt(iso) {
      class FrozenDate extends realDate {
        constructor(arg) {
          if (arg === undefined) { super(iso); return; }
          super(arg);
        }
        static now() { return realDate.parse(iso); }
      }
      // @ts-expect-error overriding global Date in this scope
      globalThis.Date = FrozenDate;
    }
    function unfreezeDate() { globalThis.Date = realDate; }

    const holdings = {
      'VUAG.L': {
        shares: 10, lastPrice: 100, prevClose: 95, cost: 90,
        currency: 'GBP', dayPct: 5.26, // 100 vs 95
      },
    };
    const positions = { CB1: { role: 'DEF', tickers: ['VUAG.L'], label: 'CB1' } };
    // GBP/USD = 1 keeps the test arithmetic clean; the LSE gate
    // doesn't touch currency conversion.
    const md = { 'GBPUSD=X': { lastPrice: 1 } };

    it('ext OFF: shows the normal LSE dayPct regardless of LSE-clock', () => {
      freezeAt('2026-01-15T02:00:00Z'); // UK 02:00 → LSE closed
      try {
        const m = computeMetrics(pf(holdings, positions), { extended: false, marketData: md });
        // dayPct propagates from the holding; no suppression when toggle is off.
        expect(m.positions.CB1.players[0].dayPct).toBeCloseTo(5.26, 4);
      } finally { unfreezeDate(); }
    });

    it('ext ON, LSE closed (UK 02:00): dayPct suppressed to 0', () => {
      freezeAt('2026-01-15T02:00:00Z'); // UK 02:00 → LSE closed
      try {
        const m = computeMetrics(pf(holdings, positions), { extended: true, marketData: md });
        expect(m.positions.CB1.players[0].dayPct).toBe(0);
        // dayChange also zeroed via baselinePrice = priceNative.
        expect(m.positions.CB1.players[0].dayChange).toBe(0);
      } finally { unfreezeDate(); }
    });

    it('ext ON, LSE open (UK 12:00): dayPct shows the live LSE intraday pct', () => {
      freezeAt('2026-01-15T12:00:00Z'); // UK 12:00 → LSE open
      try {
        const m = computeMetrics(pf(holdings, positions), { extended: true, marketData: md });
        expect(m.positions.CB1.players[0].dayPct).toBeCloseTo(5.26, 4);
      } finally { unfreezeDate(); }
    });

    it('ext ON, LSE just-closed (UK 16:35): suppressed to 0', () => {
      freezeAt('2026-01-15T16:35:00Z'); // UK 16:35 → 5 min past close
      try {
        const m = computeMetrics(pf(holdings, positions), { extended: true, marketData: md });
        expect(m.positions.CB1.players[0].dayPct).toBe(0);
      } finally { unfreezeDate(); }
    });
  });
});
