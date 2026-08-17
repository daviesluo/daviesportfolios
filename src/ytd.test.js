// Unit tests for the YTD chart math. Pinning the formula's output for a
// handful of hand-crafted scenarios so refactors can't accidentally
// reintroduce the +80% / +21% / +9% misreports we hit during the original
// implementation.
import { describe, it, expect } from 'vitest';
import {
  buildTickerSeries, closeOn, lotsFor, computeAt, ytdPct,
  fetchParamsFor, maFetchParamsFor, RANGES, RANGE_KEYS,
  applyVariantFilter, windowSinceLastUsClose, windowBetweenLastTwoUsCloses,
  filterToLastHours, filterToLast24h, fillVenueSessionGrid,
} from './ytd.js';
import { isUsTradingDateStr } from './market_hours.js';

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

  it('1D regular mode: anchors at marketData.prevClose (yesterday close)', () => {
    const ts = buildTickerSeries({
      AAPL: [{ date: '2026-04-28T13:30', close: 200 }],
    }, '2026-04-28', '1D', { AAPL: { prevClose: 195, lastPrice: 198 } }, false);
    expect(ts.AAPL.janPrice).toBe(195);
  });

  it('1D ext mode: anchors at marketData.lastPrice (today regular close) so chart % matches scoreboard DAY CHANGE', () => {
    // In ext-on AH/PM the perf chart, MC futures cards, and ticker-drill
    // modal all anchor at "the most recent 16:00 ET close that has
    // occurred" = today's 16:00 ET close. Yahoo pins lastPrice to that
    // 16:00 ET print once the market closes, so using md.lastPrice
    // matches the perf chart's close-bar lookup and the card's
    // todayRegularClose lookup.
    const ts = buildTickerSeries({
      AAPL: [{ date: '2026-04-28T20:00', close: 198 }],
    }, '2026-04-28', '1D', { AAPL: { prevClose: 195, lastPrice: 198 } }, true);
    expect(ts.AAPL.janPrice).toBe(198);
  });

  it('1D ext mode falls back to prevClose when lastPrice is missing', () => {
    const ts = buildTickerSeries({
      AAPL: [{ date: '2026-04-28T13:30', close: 200 }],
    }, '2026-04-28', '1D', { AAPL: { prevClose: 195 } }, true);
    expect(ts.AAPL.janPrice).toBe(195);
  });

  it('1D regression: marketData missing the ticker entirely → janPrice null', () => {
    // Reproduces the bug where PerfChart passed marketData (indices/forex
    // only) into buildTickerSeries, so per-stock entries were undefined
    // and the chart silently flat-lined at 0%. With the holdings-merge
    // fix in PerfChart this should no longer happen — but the pin keeps
    // the function honest if a future caller forgets.
    const ts = buildTickerSeries({
      AAPL: [{ date: '2026-04-28T13:30', close: 200 }],
    }, '2026-04-28', '1D', /* marketData = */ { '^GSPC': { prevClose: 5000 } }, false);
    expect(ts.AAPL.janPrice).toBeNull();
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

describe('computeAt — cash dilutes the return (matches header DAY CHANGE)', () => {
  it('adds cash to BOTH value and basis so % reflects the whole account', () => {
    // 10 AAPL @ basis 245 (Jan-1) → today 270: invested gain $250 on
    // invested basis $2450 = +10.20% ex-cash. With $2450 of cash held,
    // the account basis is $4900 and the same $250 gain is only +5.10%
    // — the cash-in-denominator metric the scoreboard DAY CHANGE uses.
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
        CASH: { shares: 1, cost: 0, lastPrice: 2450, isCash: true, currency: 'USD' },
      },
    };
    const result = computeAt({
      ...baseOpts, date: liveAnchorDate, portfolio, tickerSeries,
      marketData: { AAPL: { lastPrice: 270 } },
    });
    expect(result.basis).toBeCloseTo(4900, 4);  // 2450 invested + 2450 cash
    expect(result.value).toBeCloseTo(5150, 4);  // 2700 invested + 2450 cash
    expect(ytdPct(result)).toBeCloseTo(5.1020, 3);
  });

  it('no cash holding → unchanged (additive, back-compat)', () => {
    const tickerSeries = buildTickerSeries({
      AAPL: [{ date: '2025-12-31', close: 245 }, { date: '2026-04-27', close: 270 }],
    }, yearStart, "YTD");
    const portfolio = {
      holdings: {
        AAPL: { shares: 10, cost: 100, lastPrice: 270, currency: 'USD',
                lots: [{ date: '2025-04-01', shares: 10, cost: 100 }] },
      },
    };
    const result = computeAt({
      ...baseOpts, date: liveAnchorDate, portfolio, tickerSeries,
      marketData: { AAPL: { lastPrice: 270 } },
    });
    expect(result.basis).toBeCloseTo(2450, 4);
    expect(ytdPct(result)).toBeCloseTo(10.2041, 3);
  });
});

describe('computeAt — prevCloseBasis (1D day-change uses prevClose, not lot.cost)', () => {
  it('a today-dated lot (e.g. T212 sync) uses prevClose as basis, not avgCost', () => {
    // VUAA.L-style: long-held but T212 re-stamps the synthetic lot to
    // `today` at the average cost (50). prevClose 100, now 102. The day
    // change must be +2% (vs prevClose), NOT +104% (vs the 50 cost) —
    // that leak is exactly the chart-vs-scoreboard bug.
    const ts = buildTickerSeries(
      { X: [{ date: '2026-04-27T15:55', close: 102 }] },
      '2026-04-27', '1D', { X: { prevClose: 100, lastPrice: 102 } }, false,
    );
    const portfolio = {
      holdings: {
        X: {
          shares: 10, cost: 50, lastPrice: 102, currency: 'USD', prevClose: 100,
          lots: [{ date: '2026-04-27', shares: 10, cost: 50 }], // dated "today"
        },
      },
    };
    const opts = {
      portfolio, tickerSeries: ts,
      marketData: { X: { prevClose: 100, lastPrice: 102 } },
      yearStart: '2026-04-27', yearStartDate: '2026-04-26', // anchorDay = yesterday
      todayMs: new Date('2026-04-27').getTime(),
      liveAnchorDate: '2026-04-27T15:55', useExt: false, fxToUSD: () => 1,
      date: '2026-04-27T15:55',
    };
    // Default (no flag): today-lot ≥ anchorDay → basis = cost (the bug).
    expect(computeAt(opts).basis).toBeCloseTo(500, 4);   // 10 × 50
    // prevCloseBasis: basis = prevClose for every held lot.
    const fixed = computeAt({ ...opts, prevCloseBasis: true });
    expect(fixed.basis).toBeCloseTo(1000, 4);            // 10 × 100
    expect(fixed.value).toBeCloseTo(1020, 4);            // 10 × 102
    expect(ytdPct(fixed)).toBeCloseTo(2, 6);             // +2% day change, matches scoreboard
  });

  it('prevCloseBasis includes a no-prevClose holding FLAT (in denominator, 0 day change)', () => {
    // SPAX.PVT-style: no prevClose → janPrice null. Must NOT be dropped;
    // instead counted flat (basis = current price) so it sits in the
    // denominator like the scoreboard does, rather than inflating the %.
    const ts = buildTickerSeries(
      { PVT: [] }, '2026-04-27', '1D', { PVT: {} }, false,
    );
    const portfolio = {
      holdings: {
        PVT: {
          shares: 4, cost: 0, lastPrice: 250, currency: 'USD',
          lots: [{ date: '2026-04-27', shares: 4, cost: 250 }],
        },
      },
    };
    const opts = {
      portfolio, tickerSeries: ts, marketData: { PVT: {} },
      yearStart: '2026-04-27', yearStartDate: '2026-04-26',
      todayMs: new Date('2026-04-27').getTime(),
      liveAnchorDate: '2026-04-27T15:55', useExt: false, fxToUSD: () => 1,
      date: '2026-04-27T15:55', prevCloseBasis: true,
    };
    const r = computeAt(opts);
    expect(r.value).toBeCloseTo(1000, 4);  // 4 × 250 (in denominator)
    expect(r.basis).toBeCloseTo(1000, 4);  // flat: basis = current price
    expect(ytdPct(r)).toBeCloseTo(0, 6);   // 0 day change, but counted
  });
});

describe('computeAt — board scope (only positioned holdings count, like the scoreboard)', () => {
  it('skips a holding that is in holdings but not referenced by any position', () => {
    const ts = buildTickerSeries(
      {
        A: [{ date: '2026-04-27T15:55', close: 110 }],
        ORPH: [{ date: '2026-04-27T15:55', close: 300 }],
      },
      '2026-04-27', '1D',
      { A: { prevClose: 100, lastPrice: 110 }, ORPH: { prevClose: 100, lastPrice: 300 } },
      false,
    );
    const portfolio = {
      positions: { ST: { tickers: ['A'] } },              // ORPH not on the board
      holdings: {
        A:    { shares: 10, cost: 50, lastPrice: 110, prevClose: 100, currency: 'USD', lots: [{ date: '2026-01-01', shares: 10, cost: 50 }] },
        ORPH: { shares: 10, cost: 50, lastPrice: 300, prevClose: 100, currency: 'USD', lots: [{ date: '2026-01-01', shares: 10, cost: 50 }] },
      },
    };
    const opts = {
      portfolio, tickerSeries: ts,
      marketData: { A: { prevClose: 100, lastPrice: 110 }, ORPH: { prevClose: 100, lastPrice: 300 } },
      yearStart: '2026-04-27', yearStartDate: '2026-04-26',
      todayMs: new Date('2026-04-27').getTime(),
      liveAnchorDate: '2026-04-27T15:55', useExt: false, fxToUSD: () => 1,
      date: '2026-04-27T15:55', prevCloseBasis: true,
    };
    const r = computeAt(opts);
    // Only A counts: basis 10×100 = 1000, value 10×110 = 1100 → +10%.
    // ORPH (the huge +200% mover) is excluded because it's not on the board.
    expect(r.basis).toBeCloseTo(1000, 4);
    expect(r.value).toBeCloseTo(1100, 4);
    expect(ytdPct(r)).toBeCloseTo(10, 6);
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

describe('computeAt — 1D intraday date comparison (Codex #43 regression)', () => {
  it("treats a lot bought today as in-anchor (basis = cost) even when the chart's date is a YYYY-MM-DDTHH:MM intraday string", () => {
    // Ticker series uses intraday timestamps. anchorDate / yearStartDate
    // are intraday strings too. A lot dated "2026-04-28" must NOT be
    // classified as pre-anchor (which would use prevClose as basis); it
    // should use lot.cost.
    const tickerSeries = buildTickerSeries({
      AAPL: [
        { date: '2026-04-28T13:30', close: 200 },
        { date: '2026-04-28T15:00', close: 210 },
        { date: '2026-04-28T19:55', close: 215 },
      ],
    }, '2026-04-28', '1D', { AAPL: { prevClose: 195 } });

    const portfolio = {
      holdings: {
        AAPL: {
          shares: 10, cost: 200, lastPrice: 215, currency: 'USD',
          // Lot bought TODAY at $200/share.
          lots: [{ date: '2026-04-28', shares: 10, cost: 200 }],
        },
      },
    };
    const r = computeAt({
      ...baseOpts,
      yearStart: '2026-04-28',
      yearStartDate: '2026-04-28T13:30',          // ← intraday format
      liveAnchorDate: '2026-04-28T19:55',
      date: '2026-04-28T19:55',
      portfolio, tickerSeries,
      marketData: { AAPL: { lastPrice: 215, prevClose: 195 } },
    });
    // Basis must be 10 × 200 = $2000 (lot.cost), NOT 10 × 195 = $1950
    // (prevClose). The bug Codex flagged would compute the latter.
    expect(r.basis).toBeCloseTo(2000, 4);
    expect(r.value).toBeCloseTo(2150, 4);
    expect(ytdPct(r)).toBeCloseTo(7.5, 3);
  });
});

describe('1Y range (ticker-modal-only)', () => {
  it('RANGES carries a 1Y entry: 1y daily bars', () => {
    expect(RANGES['1Y']).toEqual({ yahooRange: '1y', interval: '1d', label: '1Y' });
  });
  it('RANGE_KEYS stays the 5 PerfChart ranges — 1Y is NOT one of them', () => {
    // The PerfChart maps RANGE_KEYS for its buttons + its Jan-1-basis
    // math has no trailing-12-month model, so 1Y must stay out of it.
    expect(RANGE_KEYS).toEqual(['1D', '1W', '1M', '3M', 'YTD']);
    expect(RANGE_KEYS).not.toContain('1Y');
  });
  it('fetchParamsFor("1Y") → 1y / 1d / no pre-post, std variant', () => {
    expect(fetchParamsFor('1Y', false, 'regular')).toEqual({
      yahooRange: '1y', interval: '1d', includePrePost: false, variant: 'std',
    });
    // Toggle/phase don't change a non-1D daily range.
    expect(fetchParamsFor('1Y', true, 'overnight')).toEqual({
      yahooRange: '1y', interval: '1d', includePrePost: false, variant: 'std',
    });
  });
  it('maFetchParamsFor("1Y") pulls 2y of daily bars so the 50-day MA is seeded at the left edge', () => {
    expect(maFetchParamsFor('1Y')).toEqual({ range: '2y', interval: '1d' });
  });
});

describe('applyVariantFilter', () => {
  // Two days of intraday bars; the trailing one is "now-ish" so the
  // 24h / latest-day windows have something to keep.
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const series = [
    { date: `${yest}T14:00`, close: 1 },
    { date: `${yest}T15:00`, close: 2 },
    { date: `${today}T14:00`, close: 3 },
    { date: `${today}T15:00`, close: 4 },
  ];

  it("'closed' trims to the trailing 24h, same as 'reg' / 'ext'", () => {
    // It used to keep only the latest CALENDAR day, so with the Extended
    // Hours toggle off the 1D window's length changed with the phase — a
    // couple of hours just after the open, a full session later — and
    // disagreed with what the same button showed with the toggle on.
    // Every 1D variant is one trailing 24 h now; only the benchmark and
    // whether pre/post bars are fetched still follow the toggle.
    const stale = [{ date: '2020-01-01T01:00', close: 0 }, ...series];
    expect(applyVariantFilter(stale, 'closed')).toEqual(applyVariantFilter(stale, 'reg'));
    // …and the >24h-old bar is gone.
    expect(applyVariantFilter(stale, 'closed').some(p => p.date.startsWith('2020'))).toBe(false);
  });

  it("'w1' / '1w-ext' cut the trailing week out of the fetched month", () => {
    // 1W fetches a MONTH (Yahoo has no range between 5d and 1mo) so the
    // window has to be trimmed back to a real week; leaving '1w-ext'
    // untrimmed would have drawn a month under the 1W button.
    const monthAgo = new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 16);
    const wide = [{ date: monthAgo, close: 0 }, ...series];
    for (const v of ['w1', '1w-ext']) {
      const out = applyVariantFilter(wide, v);
      expect(out.some(p => p.date === monthAgo)).toBe(false);
      expect(out.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("'reg' and 'ext' trim to the trailing 24h", () => {
    // Both route through filterToLast24h, so a bar > 24h old is dropped.
    // The stale bar uses a FIXED far-past date (not `yest`): `${yest}T01:00`
    // is only ~23h old when the suite happens to run in the 00:00-01:00 UTC
    // window, so it slips inside the 24h cutoff and the bar isn't trimmed —
    // a time-of-day flake. A fixed old date is unambiguously >24h old always.
    const old = [{ date: '2020-01-01T01:00', close: 0 }, ...series];
    expect(applyVariantFilter(old, 'reg').length).toBeLessThan(old.length);
    expect(applyVariantFilter(old, 'ext')).toEqual(applyVariantFilter(old, 'reg'));
  });

  it('an unrecognised variant (daily range) returns the series unchanged', () => {
    expect(applyVariantFilter(series, 'std')).toBe(series);
    expect(applyVariantFilter(series, undefined)).toBe(series);
  });

  it('falsy data passes straight through (no per-caller guard needed)', () => {
    expect(applyVariantFilter(null, 'closed')).toBeNull();
    expect(applyVariantFilter(undefined, 'reg')).toBeUndefined();
  });
});

describe('windowSinceLastUsClose (crypto 1D ext-off, market-OPEN window)', () => {
  const mh = { closeHh: 20, closeMm: 0 }; // 16:00 EDT = 20:00 UTC

  it('slices from the most recent 16:00-ET (20:00 UTC) close bar to the end', () => {
    const pts = [
      { date: '2026-06-15T18:00', close: 1 },   // before the close (dropped)
      { date: '2026-06-15T20:00', close: 2 },   // ← the close bar
      { date: '2026-06-15T22:00', close: 3 },   // after-hours
      { date: '2026-06-16T01:00', close: 4 },   // overnight
    ];
    expect(windowSinceLastUsClose(pts, mh)).toEqual([
      { date: '2026-06-15T20:00', close: 2 },
      { date: '2026-06-15T22:00', close: 3 },
      { date: '2026-06-16T01:00', close: 4 },
    ]);
  });

  it('picks the LATEST close bar when two sessions are present', () => {
    const pts = [
      { date: '2026-06-15T20:00', close: 1 },   // prev close
      { date: '2026-06-16T14:00', close: 2 },
      { date: '2026-06-16T20:00', close: 3 },   // ← latest close bar
      { date: '2026-06-16T22:00', close: 4 },
    ];
    expect((windowSinceLastUsClose(pts, mh) || []).map((p) => p.date))
      .toEqual(['2026-06-16T20:00', '2026-06-16T22:00']);
  });

  it('returns the input unchanged when there is no exact-close bar / no mh / empty', () => {
    const pts = [{ date: '2026-06-15T19:55', close: 1 }, { date: '2026-06-15T20:05', close: 2 }];
    expect(windowSinceLastUsClose(pts, mh)).toBe(pts);   // no 20:00 bar
    expect(windowSinceLastUsClose(pts, null)).toBe(pts);
    expect(windowSinceLastUsClose([], mh)).toEqual([]);
  });
});

describe('windowBetweenLastTwoUsCloses (crypto 1D ext-off, market-CLOSED window)', () => {
  const mh = { closeHh: 20, closeMm: 0 }; // 16:00 EDT = 20:00 UTC

  it('slices the last COMPLETE close-to-close day (prev close → last close, inclusive)', () => {
    const pts = [
      { date: '2026-06-14T20:00', close: 1 },   // older close (ignored)
      { date: '2026-06-15T14:00', close: 2 },
      { date: '2026-06-15T20:00', close: 3 },   // ← prev close (window start)
      { date: '2026-06-15T22:00', close: 4 },   // overnight inside the day
      { date: '2026-06-16T14:00', close: 5 },
      { date: '2026-06-16T20:00', close: 6 },   // ← last close (window end)
      { date: '2026-06-16T22:00', close: 7 },   // after the last close (dropped)
    ];
    expect((windowBetweenLastTwoUsCloses(pts, mh) || []).map((p) => p.date))
      .toEqual([
        '2026-06-15T20:00',
        '2026-06-15T22:00',
        '2026-06-16T14:00',
        '2026-06-16T20:00',
      ]);
  });

  it('ends AT the last close — bars after it are dropped (ext-off hides the overnight move)', () => {
    const pts = [
      { date: '2026-06-15T20:00', close: 1 },   // prev close
      { date: '2026-06-16T20:00', close: 2 },   // last close
      { date: '2026-06-16T23:00', close: 3 },   // overnight after the last close
    ];
    expect((windowBetweenLastTwoUsCloses(pts, mh) || []).map((p) => p.date))
      .toEqual(['2026-06-15T20:00', '2026-06-16T20:00']);
  });

  it('falls back to start→close when only one close bar is present', () => {
    const pts = [
      { date: '2026-06-16T14:00', close: 1 },
      { date: '2026-06-16T20:00', close: 2 },   // the only close
      { date: '2026-06-16T22:00', close: 3 },   // dropped (after the close)
    ];
    expect((windowBetweenLastTwoUsCloses(pts, mh) || []).map((p) => p.date))
      .toEqual(['2026-06-16T14:00', '2026-06-16T20:00']);
  });

  it('returns the input unchanged with no close bar / no mh / empty', () => {
    const pts = [{ date: '2026-06-15T19:55', close: 1 }, { date: '2026-06-15T21:05', close: 2 }];
    expect(windowBetweenLastTwoUsCloses(pts, mh)).toBe(pts);
    expect(windowBetweenLastTwoUsCloses(pts, null)).toBe(pts);
    expect(windowBetweenLastTwoUsCloses([], mh)).toEqual([]);
  });

  it('with isTradingDay: skips weekend / holiday 16:00 bars, keys off real US closes (long Jul-4 weekend)', () => {
    // A 24/7 crypto has a 16:00-ET bar every day. Over the Jul-3-2026
    // Independence-Day weekend (Fri holiday + Sat + Sun) the last two "closes"
    // would be Sat/Sun bars without the filter; with the real calendar the
    // window is the Wed→Thu (Jul 1→2) close-to-close trading day.
    const pts = [
      { date: '2026-07-01T20:00', close: 100 },  // Wed close (trading) ← prev
      { date: '2026-07-02T14:00', close: 105 },
      { date: '2026-07-02T20:00', close: 110 },  // Thu close (trading) ← last
      { date: '2026-07-03T20:00', close: 120 },  // Fri 16:00 — Independence Day, skip
      { date: '2026-07-04T20:00', close: 130 },  // Sat 16:00 — weekend, skip
      { date: '2026-07-05T20:00', close: 125 },  // Sun 16:00 — weekend, skip
      { date: '2026-07-05T22:00', close: 128 },  // after
    ];
    expect((windowBetweenLastTwoUsCloses(pts, mh, isUsTradingDateStr) || []).map((p) => p.date))
      .toEqual(['2026-07-01T20:00', '2026-07-02T14:00', '2026-07-02T20:00']);
  });
});

describe('windowSinceLastUsClose with isTradingDay', () => {
  const mh = { closeHh: 20, closeMm: 0 };
  it('slices from the most recent TRADING-day close, skipping weekend/holiday bars', () => {
    const pts = [
      { date: '2026-07-02T20:00', close: 110 },  // Thu close (trading) ← real close
      { date: '2026-07-03T20:00', close: 120 },  // Fri 16:00 — holiday, skip
      { date: '2026-07-04T20:00', close: 130 },  // Sat 16:00 — weekend, skip
      { date: '2026-07-05T12:00', close: 125 },  // Sun midday
    ];
    expect((windowSinceLastUsClose(pts, mh, isUsTradingDateStr) || []).map((p) => p.date))
      .toEqual(['2026-07-02T20:00', '2026-07-03T20:00', '2026-07-04T20:00', '2026-07-05T12:00']);
  });
});

describe('filterToLastHours', () => {
  it('keeps only bars inside the trailing window; filterToLast24h is the 24 h case', () => {
    const now = Date.now();
    const iso = (hAgo) => new Date(now - hAgo * 3600 * 1000).toISOString().slice(0, 16);
    const pts = [
      { date: iso(50), close: 1 },  // 50 h old
      { date: iso(40), close: 2 },  // 40 h old
      { date: iso(2),  close: 3 },  // 2 h old
      { date: iso(1),  close: 4 },  // 1 h old
    ];
    // 48 h window keeps 40/2/1 h, drops the 50 h bar.
    expect(filterToLastHours(pts, 48).map((p) => p.close)).toEqual([2, 3, 4]);
    // 24 h delegates identically to filterToLast24h (keeps only 2/1 h).
    expect(filterToLast24h(pts)).toEqual(filterToLastHours(pts, 24));
    expect(filterToLast24h(pts).map((p) => p.close)).toEqual([3, 4]);
  });
});

describe('fillVenueSessionGrid (sparse-tape venue listing → fixed 07:00–21:00 frame)', () => {
  const SESSION = { tz: 'Europe/London', startMin: 7 * 60, endMin: 21 * 60 };
  const P = (date, close, volume = 100) => ({ date, close, volume });

  it('BST day: grid spans 06:00Z–20:00Z (07:00–21:00 UK), gaps carry the last close flat', () => {
    // Sparse tape: prints at 07:00, 07:20 and 17:30 UK only.
    const pts = [
      P('2026-07-15T06:00', 3.9),
      P('2026-07-15T06:20', 4.0),
      P('2026-07-15T16:30', 3.8),
    ];
    const now = new Date('2026-07-15T22:00:00Z').getTime();   // after the close
    const out = fillVenueSessionGrid(pts, SESSION, now) || [];
    // 06:00Z → 20:00Z inclusive at 5-min steps = 169 slots.
    expect(out.length).toBe(169);
    expect(out[0]).toEqual(P('2026-07-15T06:00', 3.9));          // real bar passes through
    expect(out[1]).toEqual({ date: '2026-07-15T06:05', close: 3.9, volume: 0 });  // flat gap
    expect(out[4]).toEqual(P('2026-07-15T06:20', 4.0));          // next real bar
    // The tail runs flat at the 17:30-UK print all the way to 21:00 UK.
    expect(out[out.length - 1]).toEqual({ date: '2026-07-15T20:00', close: 3.8, volume: 0 });
    expect(out.every((p) => p.date <= '2026-07-15T20:00' && p.date >= '2026-07-15T06:00')).toBe(true);
  });

  it('LIVE day: the grid is capped at the last completed 5-min slot, not future-flat to 21:00', () => {
    const pts = [P('2026-07-15T06:00', 3.9)];
    const now = new Date('2026-07-15T10:03:00Z').getTime();
    const out = fillVenueSessionGrid(pts, SESSION, now) || [];
    expect(out[out.length - 1].date).toBe('2026-07-15T10:00');
    expect(out.length).toBe(49);   // 06:00 → 10:00 inclusive
  });

  it('leading slots before the first print backfill flat at the first close', () => {
    const pts = [P('2026-07-15T06:20', 4.0)];
    const now = new Date('2026-07-15T07:00:00Z').getTime();
    const out = fillVenueSessionGrid(pts, SESSION, now) || [];
    expect(out[0]).toEqual({ date: '2026-07-15T06:00', close: 4.0, volume: 0 });
    expect(out[4]).toEqual(P('2026-07-15T06:20', 4.0));
  });

  it('GMT (winter) day: 07:00–21:00 UK = 07:00Z–21:00Z', () => {
    const pts = [P('2026-01-14T07:00', 3.5), P('2026-01-14T12:00', 3.6)];
    const now = new Date('2026-01-14T22:00:00Z').getTime();
    const out = fillVenueSessionGrid(pts, SESSION, now) || [];
    expect(out[0].date).toBe('2026-01-14T07:00');
    expect(out[out.length - 1]).toEqual({ date: '2026-01-14T21:00', close: 3.6, volume: 0 });
  });

  it('out-of-frame prints are dropped; empty/malformed input passes through', () => {
    const pts = [P('2026-07-15T05:00', 9.9), P('2026-07-15T06:00', 3.9), P('2026-07-15T06:05', 3.95)];
    const now = new Date('2026-07-15T06:10:00Z').getTime();
    const out = fillVenueSessionGrid(pts, SESSION, now) || [];
    // 05:00Z (06:00 UK — pre-frame) never appears; frame starts 06:00Z.
    expect(out.every((p) => p.date >= '2026-07-15T06:00')).toBe(true);
    expect(fillVenueSessionGrid([], SESSION)).toEqual([]);
    expect(fillVenueSessionGrid(null, SESSION)).toBeNull();
    const noSession = [P('2026-07-15T06:00', 1)];
    expect(fillVenueSessionGrid(noSession, null)).toBe(noSession);
  });
});

// Every range's chart is an INDEXED comparison: both lines are rebased to
// 0 % at the window's first point, so the left edge is a common origin
// and "who is ahead over this window" is readable directly. They used to
// be measured against a basis OUTSIDE the window — the S&P against the
// last close before it, the portfolio against cost / prevClose — so a
// chart of "the last week" opened at whatever the move happened to be
// and the two lines started at different heights.
describe('PerfChart rebasing — both series start at 0%', () => {
  // The two transforms perf_chart.jsx applies, kept here as executable
  // documentation of the contract the component has to satisfy.
  const rebasePort = (pts) => pts.map(p => ({ ...p, pct: p.pct - pts[0].pct }));
  const rebaseSp = (pts) => pts.map(p => ({ ...p, pct: ((p.close - pts[0].close) / pts[0].close) * 100 }));

  it('the portfolio line starts at exactly 0 and keeps its shape', () => {
    const raw = [{ date: 'a', pct: 12.5 }, { date: 'b', pct: 14.5 }, { date: 'c', pct: 11.5 }];
    const out = rebasePort(raw);
    expect(out[0].pct).toBe(0);
    // A shift, not a reshape: every gap between points is unchanged, so
    // the underlying basis maths (including how in-period buys are
    // folded into the basis) still drives the curve.
    expect(out[1].pct - out[0].pct).toBeCloseTo(raw[1].pct - raw[0].pct, 12);
    expect(out[2].pct - out[1].pct).toBeCloseTo(raw[2].pct - raw[1].pct, 12);
  });

  it('the S&P line starts at exactly 0 and reads as a return over the window', () => {
    const raw = [{ date: 'a', close: 200 }, { date: 'b', close: 210 }, { date: 'c', close: 190 }];
    const out = rebaseSp(raw);
    expect(out[0].pct).toBe(0);
    expect(out[1].pct).toBeCloseTo(5, 12);    // 200 → 210
    expect(out[2].pct).toBeCloseTo(-5, 12);   // 200 → 190
  });

  it('both lines share the origin, whatever their pre-window basis was', () => {
    const port = rebasePort([{ date: 'a', pct: -3.2 }, { date: 'b', pct: 1.1 }]);
    const sp = rebaseSp([{ date: 'a', close: 5000 }, { date: 'b', close: 5100 }]);
    expect(port[0].pct).toBe(0);
    expect(sp[0].pct).toBe(0);
  });
});
