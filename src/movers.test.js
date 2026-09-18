// Top Movers ranking pins. Every number here is closed-form: these
// lists sit beside the heat map and the scoreboard, and the whole
// value of the panel is that the three agree about the same name.
import { describe, it, expect } from 'vitest';
import {
  MOVER_WINDOWS, rangeKeyForWindow, holdingMoveOver, dayMoveOf, rankMovers, barWidthPct,
} from './movers.js';
import { buildTickerSeries } from './ytd.js';

/** A `computeMetrics` player, trimmed to what the ranking reads. */
const player = (ticker, o = {}) => ({
  ticker, shares: 10, fx: 1, lastPrice: 110, dayPct: 1, dayChange: 100, ...o,
});

describe('windows', () => {
  it('TODAY is the live day move; the rest name chart ranges', () => {
    expect(MOVER_WINDOWS).toEqual(['TODAY', '1W', '1M', '3M']);
    expect(rangeKeyForWindow('TODAY')).toBe(null);
    expect(rangeKeyForWindow('1M')).toBe('1M');
    expect(rangeKeyForWindow('nonsense')).toBe(null);
    expect(rangeKeyForWindow('3M')).toBe('3M');
    // YTD is not offered, so a stored 'YTD' measures nothing and the
    // panel falls back to TODAY rather than ranking off a null answer.
    expect(rangeKeyForWindow('YTD')).toBe(null);
  });
});

describe('holdingMoveOver — the window is the HOLDING period', () => {
  // One month back from 2026-09-18. Every case below shares the same
  // price path for the stock: 110 at the window's open, 120 now. What
  // differs is when the shares were bought — and that, not the price
  // path, is what the panel must report.
  const ANCHOR = '2026-08-18';
  const TODAY = '2026-09-18';
  const SERIES = buildTickerSeries(
    { X: [{ date: '2026-08-17', close: 110 }, { date: '2026-09-17', close: 118 }] },
    ANCHOR, '1M', {}, false, true,
  );
  const ctx = { tickerSeries: SERIES, anchorDate: ANCHOR, todayDate: TODAY,
                nowMs: Date.parse(`${TODAY}T12:00:00Z`) };
  const holding = (lots, shares) => ({
    ticker: 'X', shares, fx: 1, currency: 'USD', lastPrice: 120, lots,
  });

  it('held since before the window: measured from the window-start close', () => {
    // 10 x 110 = 1100 basis, 10 x 120 = 1200 now. +$100 on 1100.
    const out = holdingMoveOver(holding([{ date: '2026-07-20', shares: 10, cost: 100 }], 10), ctx);
    expect(out?.usd).toBeCloseTo(100, 9);
    expect(out?.pct).toBeCloseTo(100 / 1100 * 100, 9);
  });

  it('bought INSIDE the window: measured from the purchase, not the window', () => {
    // THE POINT OF THIS PANEL'S LONGER WINDOWS. Same stock, same 110 ->
    // 120 month; these shares were bought two days ago at 115, so the
    // book made 5 a share, not 10. Reporting the price path here would
    // credit the position with a month it was not in for — which is
    // why these windows were pulled from the panel once before.
    const out = holdingMoveOver(holding([{ date: '2026-09-16', shares: 10, cost: 115 }], 10), ctx);
    expect(out?.usd).toBeCloseTo(50, 9);
    expect(out?.pct).toBeCloseTo(50 / 1150 * 100, 9);
    // And it is emphatically NOT the 9.09 % the stock itself did.
    expect(out?.pct).toBeLessThan(5);
  });

  it('added to inside the window: each lot on its own basis', () => {
    // 10 from before the window at 110, plus 5 bought at 118 two days
    // ago: basis 1100 + 590 = 1690 against 15 x 120 = 1800.
    const out = holdingMoveOver(holding([
      { date: '2026-07-20', shares: 10, cost: 100 },
      { date: '2026-09-16', shares: 5,  cost: 118 },
    ], 15), ctx);
    expect(out?.usd).toBeCloseTo(110, 9);
    expect(out?.pct).toBeCloseTo(110 / 1690 * 100, 9);
  });

  it('a non-USD holding reports dollars at the rate metrics.js resolved', () => {
    const hk = { ...holding([{ date: '2026-07-20', shares: 10, cost: 100 }], 10),
                 ticker: 'X', currency: 'HKD', fx: 0.128 };
    const out = holdingMoveOver(hk, ctx);
    expect(out?.usd).toBeCloseTo(100 * 0.128, 9);
    // The percentage is currency-free, so it is unchanged.
    expect(out?.pct).toBeCloseTo(100 / 1100 * 100, 9);
  });

  it('no usable basis returns null rather than a number', () => {
    expect(holdingMoveOver(null, ctx)).toBe(null);
    expect(holdingMoveOver(holding([], 0), ctx)).toBe(null);
  });
});

describe('dayMoveOf — TODAY passes metrics.js straight through', () => {
  it('does not recompute the day move from prices', () => {
    // A day change is measured against yesterday's close for every
    // holding regardless of when it was bought, which is what the heat
    // map and the scoreboard show. Re-basing it on purchase cost would
    // put two numbers for one ticker on one screen.
    expect(dayMoveOf(player('NVDA', { dayPct: 7.94, dayChange: 462 })))
      .toEqual({ pct: 7.94, usd: 462 });
  });
});

describe('rankMovers — membership', () => {
  const move = () => ({ pct: 5, usd: 100 });

  it('cash and CN funds never rank, on any window', () => {
    const players = [
      player('CASH', { isCash: true, dayPct: 5 }),
      player('017731', { dayPct: 9.9 }),      // CN fund: a NAV, not a price
      player('NVDA', { dayPct: 5 }),
    ];
    for (const w of MOVER_WINDOWS) {
      const { winners } = rankMovers(players, { window: w, metric: 'pct', moveOf: move });
      expect(winners.map(r => r.ticker)).toEqual(['NVDA']);
    }
  });

  it('a name the heat map paints flat cannot rank here', () => {
    // -0.004 % is a neutral tile. A red "-0.00%" LOSERS row beside it
    // is two surfaces disagreeing about the same ticker.
    const players = [player('FLAT', { dayPct: -0.004, dayChange: -3 })];
    const { winners, losers } = rankMovers(players, { window: 'TODAY', metric: 'pct' });
    expect(winners).toEqual([]);
    expect(losers).toEqual([]);
  });

  it('a name with no cached history for the window does not rank', () => {
    // It ranks on TODAY, which needs no history at all.
    const players = [player('NEW', { dayPct: 5 })];
    const noHistory = () => null;
    expect(rankMovers(players, { window: '1M', metric: 'pct', moveOf: noHistory })
      .winners).toEqual([]);
    expect(rankMovers(players, { window: 'TODAY', metric: 'pct' })
      .winners.map(r => r.ticker)).toEqual(['NEW']);
  });

  it('`priced` counts what the window could price, so empty can be explained', () => {
    const players = [player('A', { dayPct: 5 }), player('B', { dayPct: -5 })];
    expect(rankMovers(players, { window: '1M', metric: 'pct', moveOf: () => null }).priced)
      .toBe(0);
    expect(rankMovers(players, { window: '1M', metric: 'pct', moveOf: move }).priced)
      .toBe(2);
  });
});

describe('rankMovers — order, sides and scale', () => {
  // One book, two questions. A 7.94 % pop on a small position tops the
  // percentage list; a 1.02 % drift on the largest holding owns the
  // dollar one. These are the numbers the panel exists to separate.
  const BOOK = [
    player('SMALL', { dayPct: 7.94, dayChange: 62 }),
    player('BIG',   { dayPct: 1.02, dayChange: 462 }),
    player('MID',   { dayPct: 3.10, dayChange: 120 }),
    player('DOWN',  { dayPct: -2.50, dayChange: -300 }),
    player('DUST',  { dayPct: 4.00, dayChange: 0.2 }),
  ];

  it('% ranks by percentage, $ by dollars, and they disagree', () => {
    const byPct = rankMovers(BOOK, { window: 'TODAY', metric: 'pct' });
    expect(byPct.winners.map(r => r.ticker)).toEqual(['SMALL', 'DUST', 'MID', 'BIG']);
    const byUsd = rankMovers(BOOK, { window: 'TODAY', metric: 'usd' });
    expect(byUsd.winners.map(r => r.ticker)).toEqual(['BIG', 'MID', 'SMALL']);
  });

  it('sub-50c of impact drops off the DOLLAR list only', () => {
    // It would print as "+$0"; on the percentage list a real 4 % move
    // on a small holding is a green heat-map tile and must show.
    expect(rankMovers(BOOK, { window: 'TODAY', metric: 'usd' })
      .winners.map(r => r.ticker)).not.toContain('DUST');
    expect(rankMovers(BOOK, { window: 'TODAY', metric: 'pct' })
      .winners.map(r => r.ticker)).toContain('DUST');
  });

  it('the column is always the sign of the ranked figure', () => {
    // So a row can never show a minus inside WINNERS — including when
    // the two measures disagree about the sign, which they can: a name
    // can be up on price while a stale FX makes its dollar figure
    // negative.
    for (const metric of /** @type {const} */ (['pct', 'usd'])) {
      const { winners, losers } = rankMovers(BOOK, { window: 'TODAY', metric });
      const v = (/** @type {any} */ r) => (metric === 'usd' ? r.moveUsd : r.movePct);
      expect(winners.every(r => v(r) > 0)).toBe(true);
      expect(losers.every(r => v(r) < 0)).toBe(true);
    }
  });

  it('one scale across BOTH columns, so the bars say which side owns it', () => {
    // Per-column scaling would draw the -$300 loser as wide as the
    // +$462 winner and flatly misreport the shape of the window.
    const { scale, winners, losers } = rankMovers(BOOK, { window: 'TODAY', metric: 'usd' });
    expect(scale).toBe(462);
    expect(barWidthPct(winners[0].moveUsd, scale)).toBe(100);
    expect(barWidthPct(losers[0].moveUsd, scale)).toBeCloseTo(300 / 462 * 100, 9);
  });

  it('the bar floors at 6 % so the smallest is a mark, not a sliver', () => {
    expect(barWidthPct(1, 10000)).toBe(6);
    expect(barWidthPct(-1, 10000)).toBe(6);
    expect(barWidthPct(5, 0)).toBe(0);
  });

  it('each column tops out at five', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      player(`T${i}`, { dayPct: i + 1, dayChange: (i + 1) * 100 }));
    const { winners } = rankMovers(many, { window: 'TODAY', metric: 'pct' });
    expect(winners.map(r => r.ticker)).toEqual(['T8', 'T7', 'T6', 'T5', 'T4']);
  });
});

describe('rankMovers — a longer window really is a different question', () => {
  it('the same book ranks differently over 1M than it does today', () => {
    // NVDA is today's winner and the month's laggard; BRIT.L the
    // reverse. A panel stuck on TODAY cannot show that at all.
    const players = [
      player('NVDA',   { dayPct: 5, dayChange: 500 }),
      player('BRIT.L', { dayPct: 1, dayChange: 100 }),
    ];
    const overMonth = (/** @type {any} */ p) => (p.ticker === 'NVDA'
      ? { pct: 5, usd: 500 } : { pct: 50, usd: 900 });
    const today = rankMovers(players, { window: 'TODAY', metric: 'pct' });
    expect(today.winners.map(r => r.ticker)).toEqual(['NVDA', 'BRIT.L']);
    const month = rankMovers(players, { window: '1M', metric: 'pct', moveOf: overMonth });
    expect(month.winners.map(r => r.ticker)).toEqual(['BRIT.L', 'NVDA']);
    expect(month.winners.map(r => r.movePct)).toEqual([50, 5]);
  });

  it('TODAY ignores moveOf entirely', () => {
    // Even handed a window measure, TODAY must publish metrics.js's own
    // day figures — the ones the heat map is painted from.
    const players = [player('NVDA', { dayPct: 5, dayChange: 500 })];
    const wrong = () => ({ pct: -99, usd: -9999 });
    const out = rankMovers(players, { window: 'TODAY', metric: 'pct', moveOf: wrong });
    expect(out.winners.map(r => r.movePct)).toEqual([5]);
    expect(out.losers).toEqual([]);
  });
});
