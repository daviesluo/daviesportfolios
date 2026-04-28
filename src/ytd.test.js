// Unit tests for the YTD chart math. Pinning the formula's output for a
// handful of hand-crafted scenarios so refactors can't accidentally
// reintroduce the +80% / +21% / +9% misreports we hit during the original
// implementation.
import { describe, it, expect } from 'vitest';
import { buildTickerSeries, closeOn, lotsFor, computeAt, ytdPct } from './ytd.js';

const yearStart      = '2026-01-01';
const yearStartDate  = '2026-01-02';
const liveAnchorDate = '2026-04-27';
const todayMs        = new Date(liveAnchorDate).getTime();

const baseOpts = {
  yearStart,
  yearStartDate,
  todayMs,
  liveAnchorDate,
  useExt: false,
  fxToUSD: () => 1,
};

describe('buildTickerSeries', () => {
  it('uses prior-year-end close as the Jan-1 baseline (Yahoo convention)', () => {
    const ts = buildTickerSeries({
      AAPL: [
        { date: '2025-12-30', close: 250 },
        { date: '2025-12-31', close: 245 }, // ← this should be janPrice
        { date: '2026-01-02', close: 260 },
        { date: '2026-04-27', close: 270 },
      ],
    }, yearStart, "YTD");
    expect(ts.AAPL.janPrice).toBe(245);
  });

  it('falls back to the first YTD close when there is no prior-year data', () => {
    const ts = buildTickerSeries({
      NEW: [
        { date: '2026-01-15', close: 100 }, // ticker started trading mid-year
        { date: '2026-04-27', close: 120 },
      ],
    }, yearStart, "YTD");
    expect(ts.NEW.janPrice).toBe(100);
  });
});

describe('closeOn', () => {
  const ts = buildTickerSeries({
    AAPL: [
      { date: '2026-01-02', close: 260 },
      { date: '2026-01-05', close: 263 },
      { date: '2026-01-09', close: 268 },
    ],
  }, yearStart, "YTD");

  it('returns the exact close on a known date', () => {
    expect(closeOn(ts, 'AAPL', '2026-01-05')).toBe(263);
  });

  it('returns the most recent close ≤ date for non-trading days', () => {
    // 2026-01-07 isn't in the series; should pick 2026-01-05's 263.
    expect(closeOn(ts, 'AAPL', '2026-01-07')).toBe(263);
  });

  it('returns null for unknown tickers or dates before the series', () => {
    expect(closeOn(ts, 'WAT', '2026-01-05')).toBeNull();
    expect(closeOn(ts, 'AAPL', '2025-12-31')).toBeNull();
  });
});

describe('lotsFor', () => {
  it('returns h.lots verbatim when share totals match', () => {
    const lots = [
      { date: '2025-04-01', shares: 10, cost: 100 },
      { date: '2026-01-15', shares: 5,  cost: 110 },
    ];
    expect(lotsFor({ shares: 15, lots, lastPrice: 200 }, yearStart)).toBe(lots);
  });

  it('falls back to a single yearStart lot when h.lots is missing or stale', () => {
    const out = lotsFor({ shares: 8, lastPrice: 50 }, yearStart);
    expect(out).toEqual([{ date: yearStart, shares: 8, cost: 50 }]);
  });

  it('falls back when h.lots share total drifted from h.shares', () => {
    const out = lotsFor({
      shares: 10,
      lastPrice: 50,
      lots: [{ date: '2025-01-01', shares: 8, cost: 100 }], // mismatched
    }, yearStart);
    expect(out).toEqual([{ date: yearStart, shares: 10, cost: 50 }]);
  });
});

describe('computeAt — single pre-year lot', () => {
  it('attributes the move from Jan-1 close → today close to YTD', () => {
    // 10 shares of AAPL bought in 2025. Jan 1 close 245. Today's close 270.
    // YTD gain = 10 × (270 - 245) = $250 on a basis of $2450 → +10.20%.
    const tickerSeries = buildTickerSeries({
      AAPL: [
        { date: '2025-12-31', close: 245 },
        { date: '2026-04-27', close: 270 },
      ],
    }, yearStart, "YTD");
    const portfolio = {
      holdings: {
        AAPL: {
          shares: 10, cost: 100, lastPrice: 270, currency: 'USD',
          lots: [{ date: '2025-04-01', shares: 10, cost: 100 }],
        },
      },
    };
    const result = computeAt({
      ...baseOpts, date: liveAnchorDate, portfolio, tickerSeries,
      marketData: { AAPL: { lastPrice: 270 } },
    });
    expect(result.basis).toBeCloseTo(2450, 4);
    expect(result.value).toBeCloseTo(2700, 4);
    expect(ytdPct(result)).toBeCloseTo(10.2041, 3);
  });
});

describe('computeAt — single year lot', () => {
  it('uses lot.cost (not Jan-1 price) as the basis for in-year purchases', () => {
    // NET bought 5 @ 165 on Feb 23, 2026. Today 213.74. YTD gain on this
    // lot = 5 × (213.74 - 165) = 243.70 on basis 825 → +29.54%.
    // A naive implementation that used Jan-1 price as basis would mis-
    // attribute Net's Jan→Feb price drop as a YTD gain (the +21% bug).
    const tickerSeries = buildTickerSeries({
      NET: [
        { date: '2025-12-31', close: 130 },     // Jan-1 baseline (NOT used)
        { date: '2026-02-23', close: 165 },     // purchase day
        { date: '2026-04-27', close: 213.74 },
      ],
    }, yearStart, "YTD");
    const portfolio = {
      holdings: {
        NET: {
          shares: 5, cost: 165, lastPrice: 213.74, currency: 'USD',
          lots: [{ date: '2026-02-23', shares: 5, cost: 165 }],
        },
      },
    };
    const result = computeAt({
      ...baseOpts, date: liveAnchorDate, portfolio, tickerSeries,
      marketData: { NET: { lastPrice: 213.74 } },
    });
    expect(result.basis).toBeCloseTo(825, 4);
    expect(result.value).toBeCloseTo(1068.70, 2);
    expect(ytdPct(result)).toBeCloseTo(29.539, 2);
  });

  it('contributes 0 on the lot.date itself (basis = value at cost)', () => {
    const tickerSeries = buildTickerSeries({
      NET: [{ date: '2026-02-23', close: 165 }],
    }, yearStart, "YTD");
    const portfolio = {
      holdings: {
        NET: {
          shares: 5, cost: 165, lastPrice: 165, currency: 'USD',
          lots: [{ date: '2026-02-23', shares: 5, cost: 165 }],
        },
      },
    };
    const r = computeAt({
      ...baseOpts, date: '2026-02-23', portfolio, tickerSeries,
    });
    expect(r.value).toBeCloseTo(r.basis, 4);
  });
});

describe('computeAt — mixed pre-year + year lots in one ticker', () => {
  it('combines both bases correctly (the Yahoo +16.78% scenario in miniature)', () => {
    // AAPL: 10 shares pre-year (basis at Jan-1 = 245), 5 shares in-year
    // (basis at cost = 250). Today's close = 270.
    //   Pre-year contribution = 10 × (270 - 245) = $250 on basis $2450
    //   Year     contribution = 5  × (270 - 250) = $100 on basis $1250
    //   Total: $350 / $3700 = 9.459%
    const tickerSeries = buildTickerSeries({
      AAPL: [
        { date: '2025-12-31', close: 245 },
        { date: '2026-03-15', close: 250 },
        { date: '2026-04-27', close: 270 },
      ],
    }, yearStart, "YTD");
    const portfolio = {
      holdings: {
        AAPL: {
          shares: 15, cost: 246.67, lastPrice: 270, currency: 'USD',
          lots: [
            { date: '2025-04-01', shares: 10, cost: 100 },
            { date: '2026-03-15', shares: 5,  cost: 250 },
          ],
        },
      },
    };
    const r = computeAt({
      ...baseOpts, date: liveAnchorDate, portfolio, tickerSeries,
      marketData: { AAPL: { lastPrice: 270 } },
    });
    expect(r.basis).toBeCloseTo(3700, 4);
    expect(r.value).toBeCloseTo(4050, 4);
    expect(ytdPct(r)).toBeCloseTo(9.4595, 3);
  });
});

describe('computeAt — pre-year lot with no Jan-1 baseline is skipped', () => {
  it('contributes 0 to both numerator and denominator', () => {
    // Ticker has NO historical data → tickerSeries entry has janPrice=null.
    // Pre-year lot must be skipped (we can't make up a basis).
    const tickerSeries = buildTickerSeries({
      AAPL: [
        { date: '2025-12-31', close: 245 },
        { date: '2026-04-27', close: 270 },
      ],
      // 017731: no entry — simulating no Yahoo history for a CN fund
    }, yearStart, "YTD");
    const portfolio = {
      holdings: {
        AAPL: {
          shares: 10, cost: 100, lastPrice: 270, currency: 'USD',
          lots: [{ date: '2025-04-01', shares: 10, cost: 100 }],
        },
        '017731': {
          shares: 1000, cost: 1.5, lastPrice: 1.6, currency: 'CNY',
          lots: [{ date: '2024-06-01', shares: 1000, cost: 1.5 }],
        },
      },
    };
    const r = computeAt({
      ...baseOpts, date: liveAnchorDate, portfolio, tickerSeries,
      marketData: { AAPL: { lastPrice: 270 } },
    });
    // Only AAPL contributes; 017731's pre-year lot is silently dropped.
    expect(r.basis).toBeCloseTo(2450, 4);
    expect(r.value).toBeCloseTo(2700, 4);
  });
});

describe('computeAt — live endpoint uses marketData lastPrice', () => {
  it('overrides historical close with live marketData on the anchor date', () => {
    // Same setup as the basic case, but live price diverges from yesterday's
    // historical close. The chart's last point should track the live price.
    const tickerSeries = buildTickerSeries({
      AAPL: [
        { date: '2025-12-31', close: 245 },
        { date: '2026-04-27', close: 270 },     // historical
      ],
    }, yearStart, "YTD");
    const portfolio = {
      holdings: {
        AAPL: {
          shares: 10, cost: 100, lastPrice: 280, currency: 'USD',  // live ↑
          lots: [{ date: '2025-04-01', shares: 10, cost: 100 }],
        },
      },
    };
    const r = computeAt({
      ...baseOpts, date: liveAnchorDate, portfolio, tickerSeries,
      marketData: { AAPL: { lastPrice: 280 } },
    });
    // Should use 280 (live), not 270 (historical).
    expect(r.value).toBeCloseTo(2800, 4);
    expect(ytdPct(r)).toBeCloseTo(14.286, 2);
  });
});
