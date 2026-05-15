import { describe, it, expect } from 'vitest';
import {
  maBarsFor, maLabelDaysFor,
  rollingSma, computeMaSeries,
  vwapSessionResetFor, vwapSessionKeyOf, computeVwap,
  priceDividedByTtmEps,
  hasExtendedHoursBars, extPriceIsRealAh,
  isPriceAxis,
} from './indicators.js';

describe('maBarsFor / maLabelDaysFor', () => {
  it('intraday ranges scale by bars/day; daily ranges stay 1:1', () => {
    expect(maBarsFor('1W', false)).toBe(65);   // 5 days × 13 bars at 30m
    expect(maBarsFor('1M', false)).toBe(70);   // 10 days × 7 bars at 60m
    expect(maBarsFor('3M', false)).toBe(20);
    expect(maBarsFor('YTD', false)).toBe(50);
  });

  it('dailyOnly tickers (CN funds / .PVT) bypass the bars-per-day scaling', () => {
    expect(maBarsFor('1W', true)).toBe(5);
    expect(maBarsFor('1M', true)).toBe(10);
    expect(maBarsFor('3M', true)).toBe(20);
    expect(maBarsFor('YTD', true)).toBe(50);
  });

  it('unknown range = 0', () => {
    expect(maBarsFor('1D', false)).toBe(0);
    expect(maBarsFor('PE', false)).toBe(0);
  });

  it('label always shows day count', () => {
    expect(maLabelDaysFor('1W')).toBe(5);
    expect(maLabelDaysFor('YTD')).toBe(50);
    expect(maLabelDaysFor('1D')).toBe(0);
  });
});

describe('rollingSma', () => {
  it('first (N-1) entries null; rest are trailing averages', () => {
    const bars = [{date:'a', close:1}, {date:'b', close:2}, {date:'c', close:3}, {date:'d', close:4}];
    const ma = rollingSma(bars, 3);
    expect(ma).toEqual([null, null, 2, 3]); // (1+2+3)/3 = 2; (2+3+4)/3 = 3
  });

  it('zero / empty / window > length all return clean defaults', () => {
    expect(rollingSma([], 5)).toEqual([]);
    expect(rollingSma([{date:'a', close:1}], 0)).toEqual([]);
    expect(rollingSma([{date:'a', close:1}], 3)).toEqual([null]);
  });
});

describe('computeMaSeries (combined wider + display)', () => {
  it('uses wider history bars to populate MA at the leftmost display bar', () => {
    const wider   = [
      {date:'2026-05-01', close:1}, {date:'2026-05-02', close:2},
      {date:'2026-05-03', close:3}, {date:'2026-05-04', close:4},
    ];
    const display = [{date:'2026-05-05', close:5}, {date:'2026-05-06', close:6}];
    // 5-day MA on the combined stream of 6 bars:
    //   index 4 (display[0], '2026-05-05'): avg of bars 0..4 = 3
    //   index 5 (display[1], '2026-05-06'): avg of bars 1..5 = 4
    expect(computeMaSeries(display, wider, 5)).toEqual([3, 4]);
  });

  it('display value wins on duplicate timestamp (live-tail substitution)', () => {
    const wider   = [{date:'a', close:100}, {date:'b', close:100}];
    const display = [{date:'a', close: 50}, {date:'b', close: 50}];  // display's are "live"
    // Combined dedupes by date — display values used. With window 2:
    //   '2026-05-05' (idx 0): null (only 1 prior)
    //   '2026-05-06' (idx 1): (50+50)/2 = 50
    expect(computeMaSeries(display, wider, 2)).toEqual([null, 50]);
  });

  it('returns null for every display bar when combined is too short', () => {
    expect(computeMaSeries([{date:'a', close:1}], [], 5)).toEqual([null]);
  });
});

describe('vwapSessionResetFor', () => {
  const mhEdt = { edt: true,  openHh: 13, openMm: 30 };
  const mhEst = { edt: false, openHh: 14, openMm: 30 };

  it('crypto resets at UTC midnight', () => {
    expect(vwapSessionResetFor('BTC-USD', true,  mhEdt)).toEqual({ resetMins: 0, useUsOpenReset: false });
    expect(vwapSessionResetFor('BTC-USD', false, mhEdt)).toEqual({ resetMins: 0, useUsOpenReset: false });
  });

  it('US equity in EDT: 09:30 ET when ext off, 04:00 ET when ext on', () => {
    expect(vwapSessionResetFor('NVDA', false, mhEdt)).toEqual({ resetMins: 13 * 60 + 30, useUsOpenReset: true });
    expect(vwapSessionResetFor('NVDA', true,  mhEdt)).toEqual({ resetMins: 8 * 60,       useUsOpenReset: true });
  });

  it('US equity in EST winter shifts by 1 hour', () => {
    expect(vwapSessionResetFor('NVDA', false, mhEst)).toEqual({ resetMins: 14 * 60 + 30, useUsOpenReset: true });
    expect(vwapSessionResetFor('NVDA', true,  mhEst)).toEqual({ resetMins: 9 * 60,       useUsOpenReset: true });
  });

  it('non-US equity (LSE / HK / =F / =X / ^index / CN fund / .PVT) → UTC midnight', () => {
    for (const t of ['VUAG.L', '0700.HK', 'ES=F', 'GBPUSD=X', '^GSPC', '017731', 'SPAX.PVT']) {
      expect(vwapSessionResetFor(t, true, mhEdt).useUsOpenReset).toBe(false);
    }
  });
});

describe('vwapSessionKeyOf', () => {
  const usCfg = { resetMins: 8 * 60, useUsOpenReset: true };       // 04:00 ET ext-on EDT
  const cryptoCfg = { resetMins: 0, useUsOpenReset: false };

  it('crypto: bucket = UTC date', () => {
    expect(vwapSessionKeyOf('2026-05-11T03:00', cryptoCfg)).toBe('2026-05-11');
    expect(vwapSessionKeyOf('2026-05-11T23:59', cryptoCfg)).toBe('2026-05-11');
  });

  it('US ext-on: bars at-or-after 08:00 UTC keep today; earlier roll back to yesterday', () => {
    expect(vwapSessionKeyOf('2026-05-11T08:00', usCfg)).toBe('2026-05-11');  // exactly 04:00 ET
    expect(vwapSessionKeyOf('2026-05-11T08:30', usCfg)).toBe('2026-05-11');
    expect(vwapSessionKeyOf('2026-05-11T07:55', usCfg)).toBe('2026-05-10');  // 03:55 ET overnight
    expect(vwapSessionKeyOf('2026-05-11T00:00', usCfg)).toBe('2026-05-10');  // 20:00 ET after-hours
  });
});

describe('computeVwap', () => {
  const cfg = { resetMins: 0, useUsOpenReset: false };
  const sk  = (d) => vwapSessionKeyOf(d, cfg);

  it('null for sessions with no volume at all', () => {
    const pts = [
      { date: '2026-05-11T13:30', close: 100 },
      { date: '2026-05-11T13:35', close: 101 },
    ];
    expect(computeVwap(pts, sk)).toEqual([null, null]);
  });

  it('cumulative weighted average within a session', () => {
    const pts = [
      { date: '2026-05-11T13:30', close: 100, volume: 100 },
      { date: '2026-05-11T13:35', close: 102, volume: 200 },
    ];
    // bar 1: 100×100/100 = 100
    // bar 2: (100×100 + 102×200)/(100+200) = 30400/300 = 101.333…
    const out = computeVwap(pts, sk);
    expect(out[0]).toBe(100);
    expect(out[1]).toBeCloseTo(101.333, 2);
  });

  it('forward-fills zero-volume bars with the most recent real volume', () => {
    const pts = [
      { date: '2026-05-11T13:30', close: 100, volume: 100 },
      { date: '2026-05-11T13:35', close: 110, volume: 0 },     // fwd-fill v=100
      { date: '2026-05-11T13:40', close: 120, volume: 0 },     // fwd-fill v=100
    ];
    const out = computeVwap(pts, sk);
    expect(out[0]).toBe(100);
    expect(out[1]).toBe(105); // (100+110)/2
    expect(out[2]).toBe(110); // (100+110+120)/3
  });

  it('resets on session boundary (cumulator restarts; no real volume yet → null)', () => {
    const cfg2 = { resetMins: 8 * 60, useUsOpenReset: true };
    const sk2 = (d) => vwapSessionKeyOf(d, cfg2);
    const pts = [
      { date: '2026-05-10T15:00', close: 100, volume: 1000 },  // yesterday session
      { date: '2026-05-11T08:00', close: 200, volume: 0    },  // today session opens; no volume yet
      { date: '2026-05-11T08:05', close: 201, volume: 500  },  // first real today vol
    ];
    const out = computeVwap(pts, sk2);
    expect(out[0]).toBe(100);
    expect(out[1]).toBeNull();    // today's first bar, vol=0, no prior real volume in this session
    expect(out[2]).toBe(201);     // today bar 2: VWAP = 201 (only one real bar in today's session)
  });

  it('returns empty array on empty input', () => {
    expect(computeVwap([], sk)).toEqual([]);
  });
});

describe('priceDividedByTtmEps', () => {
  it('steps the P/E down when a higher TTM EPS gets reported', () => {
    const prices = [
      { date: '2026-04-01', close: 100 },
      { date: '2026-06-01', close: 100 },  // after Q1 reports (with 45d lag)
    ];
    // Quarter end 2026-03-31; reportMs = +45d ≈ 2026-05-15
    // Before that → fallback EPS (4); after that → TTM EPS (5)
    // Callers MUST pass USD-normalized history; this function does
    // NOT rescale ttmEpsHistory itself — the Edge Function's
    // normalizeEpsHistoryToUsd does the unit conversion using FMP's
    // price/pe anchor before the row reaches the client.
    const history = [{ date: '2026-03-31', eps: 5 }];
    const out = priceDividedByTtmEps(prices, history, 4);
    expect(out[0]).toEqual({ date: '2026-04-01', close: 25 });  // 100/4 fallback
    expect(out[1]).toEqual({ date: '2026-06-01', close: 20 });  // 100/5 from history
  });

  it('empty / missing history → fallback EPS for every bar', () => {
    const prices = [{ date: '2026-04-01', close: 100 }];
    expect(priceDividedByTtmEps(prices, null, 4)).toEqual([{ date: '2026-04-01', close: 25 }]);
    expect(priceDividedByTtmEps(prices, [],   4)).toEqual([{ date: '2026-04-01', close: 25 }]);
  });

  it('fallback ≤ 0 produces close 0 (degenerate but safe)', () => {
    const prices = [{ date: '2026-04-01', close: 100 }];
    expect(priceDividedByTtmEps(prices, null, 0)).toEqual([{ date: '2026-04-01', close: 0 }]);
  });

  it('steps the P/S the same way — the denominator is generic, not EPS-specific', () => {
    // Regression guard for the "P/S YTD == price YTD" bug: P/S used to
    // pass history=null (const denominator), so its chart was just the
    // price chart rescaled and reported an identical YTD %. With a
    // real sales-per-share history (Edge Function's ttmSalesHistory)
    // it steps on earnings exactly like P/E — `eps` here carries TTM
    // sales-per-share, the function is denominator-agnostic.
    const prices = [
      { date: '2026-04-01', close: 120 },
      { date: '2026-06-01', close: 120 },  // after Q1 reports (with 45d lag)
    ];
    const salesHistory = [{ date: '2026-03-31', eps: 12 }];  // TTM sales/share
    const out = priceDividedByTtmEps(prices, salesHistory, 10);
    expect(out[0]).toEqual({ date: '2026-04-01', close: 12 });  // 120/10 fallback
    expect(out[1]).toEqual({ date: '2026-06-01', close: 10 });  // 120/12 from history
  });
});

describe('hasExtendedHoursBars', () => {
  it('returns true if any bar is before openMins', () => {
    const series = [{ date: '2026-05-11T08:00' }];  // 04:00 ET pre-market
    expect(hasExtendedHoursBars(series, 13 * 60 + 30, 20 * 60)).toBe(true);
  });

  it('returns true if any bar is after closeMins', () => {
    const series = [{ date: '2026-05-11T21:00' }];  // 17:00 ET after-hours
    expect(hasExtendedHoursBars(series, 13 * 60 + 30, 20 * 60)).toBe(true);
  });

  it('returns false if every bar is inside the regular session', () => {
    const series = [
      { date: '2026-05-11T14:00' },  // 10:00 ET RTH
      { date: '2026-05-11T19:55' },  // 15:55 ET RTH
    ];
    expect(hasExtendedHoursBars(series, 13 * 60 + 30, 20 * 60)).toBe(false);
  });

  it('empty / non-array input → false', () => {
    expect(hasExtendedHoursBars([], 0, 0)).toBe(false);
    expect(hasExtendedHoursBars(/** @type {any} */ (null), 0, 0)).toBe(false);
  });
});

describe('extPriceIsRealAh (shared card/modal AH-trust verdict)', () => {
  const OPEN = 13 * 60 + 30, CLOSE = 20 * 60;  // 09:30 / 16:00 ET in UTC

  it('real AH mover: AH bars present AND extPrice tracks the last bar → true', () => {
    const series = [
      { date: '2026-05-11T19:55', close: 100 },  // 15:55 ET RTH
      { date: '2026-05-11T20:30', close: 104 },  // 16:30 ET — real AH bar
    ];
    // extPrice 104.5 is within 3% of the last AH bar (104).
    expect(extPriceIsRealAh(series, 104.5, OPEN, CLOSE)).toBe(true);
  });

  it('big AH move still tracked by the bars (CBRS-shape) → true', () => {
    // The ±5% quote-only heuristic (extPriceLooksReal) rejects this;
    // extPriceIsRealAh accepts it because the AH bars confirm the
    // move is real — the whole point of the card/modal unification.
    const series = [
      { date: '2026-05-11T19:55', close: 100 },  // RTH close
      { date: '2026-05-11T21:00', close: 168 },  // +68% AH bar
    ];
    expect(extPriceIsRealAh(series, 168, OPEN, CLOSE)).toBe(true);
  });

  it('SFTBY-shape: AH bars exist but extPrice diverges from them → false', () => {
    // Yahoo pads AH-timestamped bars at the RTH close for OTC ADRs,
    // then ships a bogus postMarketPrice (today's open). The bars say
    // ~18.65, the bogus extPrice says 20.15 (~8% off) → rejected.
    const series = [
      { date: '2026-05-11T19:55', close: 18.65 },  // RTH close
      { date: '2026-05-11T20:30', close: 18.65 },  // padded AH bar, flat
    ];
    expect(extPriceIsRealAh(series, 20.15, OPEN, CLOSE)).toBe(false);
  });

  it('no AH bars at all → false', () => {
    const series = [
      { date: '2026-05-11T14:00', close: 100 },  // 10:00 ET RTH
      { date: '2026-05-11T19:55', close: 101 },  // 15:55 ET RTH
    ];
    expect(extPriceIsRealAh(series, 101, OPEN, CLOSE)).toBe(false);
  });

  it('missing / non-positive extPrice → false', () => {
    const series = [{ date: '2026-05-11T20:30', close: 104 }];
    expect(extPriceIsRealAh(series, null, OPEN, CLOSE)).toBe(false);
    expect(extPriceIsRealAh(series, 0, OPEN, CLOSE)).toBe(false);
    expect(extPriceIsRealAh(series, -5, OPEN, CLOSE)).toBe(false);
    expect(extPriceIsRealAh(series, /** @type {any} */ (undefined), OPEN, CLOSE)).toBe(false);
  });

  it('empty / non-array series → false', () => {
    expect(extPriceIsRealAh([], 100, OPEN, CLOSE)).toBe(false);
    expect(extPriceIsRealAh(/** @type {any} */ (null), 100, OPEN, CLOSE)).toBe(false);
  });

  it('latest bar has no usable close → false', () => {
    const series = [
      { date: '2026-05-11T19:55', close: 100 },
      { date: '2026-05-11T20:30', close: 0 },  // AH bar but no real close
    ];
    expect(extPriceIsRealAh(series, 104, OPEN, CLOSE)).toBe(false);
  });
});

describe('isPriceAxis (live-tail substitution gate)', () => {
  // Critical bug pinning: when the y-axis is in ratio units (PE / PS),
  // the modal must NOT swap in the live raw price on the last bar.
  // The user reported a vertical cliff on the P/S chart of NET / SATS
  // / NVTS / SOUN because the original gate excluded only 'PE'; this
  // test locks in the corrected behaviour so a future change can't
  // silently revert it.
  it('every price-axis range substitutes the live tail', () => {
    for (const rk of ['1D', '1W', '1M', '3M', 'YTD']) {
      expect(isPriceAxis(rk)).toBe(true);
    }
  });
  it('every ratio-axis range skips the live tail', () => {
    expect(isPriceAxis('PE')).toBe(false);
    expect(isPriceAxis('PS')).toBe(false);
  });
  it('unknown rangeKey defaults to the price-axis branch (safe default)', () => {
    // Better to substitute when in doubt than render a stale tail —
    // the worst case there is one bar matching the rest of the price
    // line, not a cross-unit cliff.
    expect(isPriceAxis('UNKNOWN')).toBe(true);
    expect(isPriceAxis('')).toBe(true);
  });
});
