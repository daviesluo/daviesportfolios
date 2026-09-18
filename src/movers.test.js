// Top Movers ranking pins. Every number here is closed-form: these
// lists sit beside the heat map and the scoreboard, and the whole
// value of the panel is that the three agree about the same name.
import { describe, it, expect } from 'vitest';
import {
  MOVER_WINDOWS, rangeKeyForWindow, moveOver, rankMovers, barWidthPct,
} from './movers.js';

/** A `computeMetrics` player, trimmed to what the ranking reads. */
const player = (ticker, o = {}) => ({
  ticker, shares: 10, fx: 1, lastPrice: 110, dayPct: 1, dayChange: 100, ...o,
});

describe('windows', () => {
  it('TODAY is the live day move; the rest name chart ranges', () => {
    expect(MOVER_WINDOWS).toEqual(['TODAY', '1W', '1M', '3M', 'YTD']);
    expect(rangeKeyForWindow('TODAY')).toBe(null);
    expect(rangeKeyForWindow('1M')).toBe('1M');
    expect(rangeKeyForWindow('nonsense')).toBe(null);
  });
});

describe('moveOver', () => {
  it('TODAY passes metrics.js\'s own day figures straight through', () => {
    // Not recomputed from prices: a second implementation of the day
    // move is what makes the heat map and this panel disagree.
    const p = player('NVDA', { dayPct: 7.94, dayChange: 462 });
    expect(moveOver(p, null)).toEqual({ pct: 7.94, usd: 462 });
  });

  it('a longer window measures price against the window-start close', () => {
    // 10 shares, 100 -> 110 native, FX 1: +10.00 %, +$100.
    expect(moveOver(player('NVDA'), 100)).toEqual({ pct: 10, usd: 100 });
    // Same move in a non-USD book: the percentage is currency-free,
    // the dollar figure is not.
    expect(moveOver(player('0700.HK', { fx: 0.128 }), 100))
      .toEqual({ pct: 10, usd: 12.8 });
  });

  it('a down window is negative in both measures', () => {
    const out = moveOver(player('X', { lastPrice: 90 }), 100);
    expect(out?.pct).toBeCloseTo(-10, 9);
    expect(out?.usd).toBeCloseTo(-100, 9);
  });

  it('refuses to invent a move from a missing or absurd price', () => {
    expect(moveOver(player('X'), 0)).toBe(null);
    expect(moveOver(player('X'), -5)).toBe(null);
    expect(moveOver(player('X', { lastPrice: 0 }), 100)).toBe(null);
    expect(moveOver(null, 100)).toBe(null);
  });
});

describe('rankMovers — membership', () => {
  const base = () => 100;

  it('cash and CN funds never rank, on any window', () => {
    const players = [
      player('CASH', { isCash: true, dayPct: 5 }),
      player('017731', { dayPct: 9.9 }),      // CN fund: a NAV, not a price
      player('NVDA', { dayPct: 5 }),
    ];
    for (const w of MOVER_WINDOWS) {
      const { winners } = rankMovers(players, { window: w, metric: 'pct', basePriceOf: base });
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
    expect(rankMovers(players, { window: '1M', metric: 'pct', basePriceOf: noHistory })
      .winners).toEqual([]);
    expect(rankMovers(players, { window: 'TODAY', metric: 'pct' })
      .winners.map(r => r.ticker)).toEqual(['NEW']);
  });

  it('`priced` counts what the window could price, so empty can be explained', () => {
    const players = [player('A', { dayPct: 5 }), player('B', { dayPct: -5 })];
    expect(rankMovers(players, { window: '1M', metric: 'pct', basePriceOf: () => null }).priced)
      .toBe(0);
    expect(rankMovers(players, { window: '1M', metric: 'pct', basePriceOf: base }).priced)
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
      player('NVDA',   { dayPct: 5, dayChange: 500, lastPrice: 105 }),
      player('BRIT.L', { dayPct: 1, dayChange: 100, lastPrice: 150 }),
    ];
    const monthBase = (/** @type {string} */ t) => (t === 'NVDA' ? 100 : 100);
    const today = rankMovers(players, { window: 'TODAY', metric: 'pct' });
    expect(today.winners.map(r => r.ticker)).toEqual(['NVDA', 'BRIT.L']);
    const month = rankMovers(players, { window: '1M', metric: 'pct', basePriceOf: monthBase });
    expect(month.winners.map(r => r.ticker)).toEqual(['BRIT.L', 'NVDA']);
    expect(month.winners.map(r => Math.round(r.movePct))).toEqual([50, 5]);
  });
});
