// Pins the Target price page's column math and order (target_price.js), worked out by hand on a small book: the weight
// from the Holding list's own function, the low against the board's price, the 30-day fresh window, the three kinds of
// row, the default order (low vs price, largest first) with uncovered holdings last either way, and the "Updated" stamp.
import { describe, expect, it } from 'vitest';
import { buildTargetRows, DEFAULT_SORT, firstSortDir, fmtRange, freshTargets, kindTag, rangeDecimals, ratingWord, sortTargetRows, strategistTitle, TARGET_COLUMNS, unitFactor, updatedLabel } from './target_price.js';
import { buildHoldingsRows } from './holdings_list.jsx';

const NOW = Date.parse('2026-10-21T13:30:20Z');
const daysAgo = (n) => new Date(NOW - n * 86400e3).toISOString();

// A book of $1,000, cash $300 of it.
const player = (ticker, lastPrice, marketValue, currency = 'USD') => ({ ticker, lastPrice, marketValue, currency, shares: 1, cost: 1, fx: 1 });
const METRICS = {
  marketValue: 1000,
  positions: {
    A: { players: [player('RKLB', 50, 200), player('ORCL', 100, 300)] },
    B: { players: [player('BTC-USD', 100000, 100), player('VUAA.L', 100, 50), player('2DG.SG', 2, 50, 'EUR')] },
    C: { players: [{ ticker: 'CASH', isCash: true, marketValue: 300, lastPrice: 300 }] },
  },
};
const DATA = {
  slot: '2026-10-21T13:30:00.000Z', asOf: '2026-10-21T13:30:20.000Z',
  rows: {
    RKLB: { kind: 'consensus', currency: 'USD', refPrice: 51, mean: 100, low: 60, high: 150, rating: 1.6, analysts: 20,
      targets: [{ firm: 'A', target: 90, at: daysAgo(2) }, { firm: 'B', target: 120, at: daysAgo(10) }, { firm: 'C', target: 70, at: daysAgo(40) }] },
    ORCL: { kind: 'consensus', currency: 'USD', refPrice: 100, mean: 120, low: 80, high: 200, rating: 2.6, analysts: 40, targets: [] },
    'BTC-USD': { kind: 'strategist', currency: 'USD', refPrice: null, mean: 110666.6667, low: 82000, high: 150000, rating: null, analysts: 3,
      targets: [{ firm: 'Bernstein', target: 150000, at: '2026-08-26T00:00:00.000Z' }, { firm: 'Citi', target: 82000, at: '2026-07-01T00:00:00.000Z' }, { firm: 'Standard Chartered', target: 100000, at: '2026-02-12T00:00:00.000Z' }],
      sources: [{ firm: 'Citi', target: 82000, at: '2026-07-01', horizon: '12 months', url: 'https://x' }] },
    'VUAA.L': { kind: 'holdings', currency: 'USD', refPrice: 100, mean: 110, low: 90, high: 130, rating: null, analysts: 45, targets: [],
      fresh: { low: 95, high: 120, count: 4 }, coverage: { weight: 0.39, names: 10, source: "VUAA.L's top holdings (Yahoo)" } },
  },
};
const rows = buildTargetRows(METRICS, DATA, NOW);
const by = (t) => /** @type {any} */ (rows.find((r) => r.ticker === t));

describe('Target price rows', () => {
  it('one row per holding, cash left out, the weight the Holding list\'s Exposure itself', () => {
    expect(rows.map((r) => r.display)).toEqual(['RKLB', 'ORCL', 'BTC-USD', 'VUAA', 'SIVE']);
    const exposure = Object.fromEntries(buildHoldingsRows(METRICS).map((h) => [h.ticker, h.exposure]));
    for (const r of rows) expect(r.weight).toBe(exposure[r.ticker]);
    expect(rows.map((r) => r.weight)).toEqual([20, 30, 10, 5, 5]);
  });

  it('a stock: the board\'s price, not the job\'s; upside, low vs price, the range\'s width, the 30-day fresh window', () => {
    const r = by('RKLB');
    // price 50 (the board; the job read 51). mean 100 → +100 %; low 60 → +20 %; range (150 − 60) / 50 = 180 %.
    // Fresh: A's 90 (2 days) and B's 120 (10 days); C's 70 is 40 days old. Width (120 − 90) / 50 = 60 %.
    expect([r.kind, r.price, r.mean, r.low, r.high, r.analysts]).toEqual(['consensus', 50, 100, 60, 150, 20]);
    expect([r.avgVsPrice, r.lowVsPrice, r.rangeSpread, r.freshSpread]).toEqual([100, 20, 180, 60]);
    expect(r.fresh).toEqual({ low: 90, high: 120, count: 2 });
    expect([r.rating, r.ratingWord]).toEqual([1.6, 'Buy']);
    expect(by('ORCL').lowVsPrice).toBe(-20);
    expect(by('ORCL').fresh).toBe(null);
    expect(by('ORCL').ratingWord).toBe('Hold');
  });

  it('bitcoin: the hand-kept targets on the board\'s price, no rating, none of them fresh on 21 October', () => {
    const r = by('BTC-USD');
    // low 82,000 / 100,000 − 1 = −18 %; mean 110,666.67 → +10.67 %.
    expect([r.kind, r.low, r.high, r.analysts, r.rating, r.fresh]).toEqual(['strategist', 82000, 150000, 3, null, null]);
    expect(r.lowVsPrice).toBeCloseTo(-18, 10);
    expect(r.avgVsPrice).toBeCloseTo(10.666667, 5);
    expect(r.sources).toHaveLength(1);
  });

  it('a fund: its holdings-weighted targets and the job\'s own fresh window, with its coverage', () => {
    const r = by('VUAA.L');
    expect([r.kind, r.mean, r.low, r.high, r.lowVsPrice, r.fresh, r.coverage.weight]).toEqual(['holdings', 110, 90, 130, -10, { low: 95, high: 120, count: 4 }, 0.39]);
    expect(r.freshSpread).toBe(25);
  });

  it('a holding with no targets: every target figure null, and its risk note still there', () => {
    const r = by('2DG.SG');
    expect([r.kind, r.mean, r.low, r.lowVsPrice, r.rating, r.analysts, r.fresh]).toEqual([null, null, null, null, null, null, null]);
    expect(r.risks).toMatch(/^Only Redeye \(paid\) covers it; Ningi Research short report/);
    // No copy at all yet: the rows are there, every one uncovered.
    expect(buildTargetRows(METRICS, null, NOW).map((x) => x.kind)).toEqual([null, null, null, null, null]);
  });

  it('currencies: pence and pounds are matched; a currency the board does not use is measured on the job\'s own price', () => {
    expect([unitFactor('USD', 'USD'), unitFactor('GBp', 'GBP'), unitFactor('GBP', 'GBp'), unitFactor('SEK', 'EUR'), unitFactor(null, 'USD')]).toEqual([1, 0.01, 100, null, 1]);
    const m = { marketValue: 100, positions: { A: { players: [player('X.L', 2.5, 50, 'GBP'), player('Y.ST', 2, 50, 'EUR')] } } };
    const d = { rows: {
      'X.L': { kind: 'consensus', currency: 'GBp', refPrice: 250, mean: 300, low: 200, high: 400, targets: [] },
      'Y.ST': { kind: 'consensus', currency: 'SEK', refPrice: 24, mean: 30, low: 18, high: 36, targets: [] },
    } };
    const [x, y] = buildTargetRows(m, d, NOW);
    // 200p = £2.00 against £2.50: −20 %. SEK 18 against the job's SEK 24: −25 %, shown in SEK.
    expect([x.low, x.lowVsPrice, x.targetCurrency]).toEqual([2, -20, 'GBP']);
    expect([y.low, y.lowVsPrice, y.targetCurrency]).toEqual([18, -25, 'SEK']);
  });
});

describe('Target price order', () => {
  it('opens on avg vs price, largest first, an uncovered holding last (Davies, 2026-10-21)', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'avgVsPrice', dir: 'desc' });
    // RKLB 100 / 50 = +100 %, ORCL 120 / 100 = +20 %, BTC 110,666.67 / 100,000 = +10.67 %, VUAA 110 / 100 = +10 %.
    expect(sortTargetRows(rows, 'avgVsPrice', 'desc').map((r) => r.display)).toEqual(['RKLB', 'ORCL', 'BTC-USD', 'VUAA', 'SIVE']);
    // Turned round, the uncovered holding is still last.
    expect(sortTargetRows(rows, 'avgVsPrice', 'asc').map((r) => r.display)).toEqual(['VUAA', 'BTC-USD', 'ORCL', 'RKLB', 'SIVE']);
  });

  it('every column but Key risks sorts both ways, nulls last; the first click goes the useful way', () => {
    expect(TARGET_COLUMNS.filter((c) => !c.sortKey).map((c) => c.label)).toEqual(['Key risks']);
    expect(TARGET_COLUMNS.map((c) => c.label)).toEqual(['Symbol', 'Weight', 'Price', 'Avg target', 'Avg rating', 'Avg range', 'Analysts', 'Fresh range', 'Avg vs price', 'Key risks']);
    for (const c of TARGET_COLUMNS.filter((x) => x.sortKey)) {
      for (const dir of /** @type {const} */ (['asc', 'desc'])) {
        const out = sortTargetRows(rows, /** @type {string} */ (c.sortKey), dir);
        const vals = out.map((r) => r[/** @type {string} */ (c.sortKey)]);
        const firstNull = vals.findIndex((v) => v == null);
        if (firstNull >= 0) expect(vals.slice(firstNull).every((v) => v == null), `${c.label} ${dir}`).toBe(true);
      }
    }
    expect(sortTargetRows(rows, 'rating', 'asc').map((r) => r.display)).toEqual(['RKLB', 'ORCL', 'BTC-USD', 'VUAA', 'SIVE']);
    expect(sortTargetRows(rows, 'freshSpread', 'desc').map((r) => r.display)).toEqual(['RKLB', 'VUAA', 'ORCL', 'BTC-USD', 'SIVE']);
    expect(sortTargetRows(rows, 'display', 'asc').map((r) => r.display)).toEqual(['BTC-USD', 'ORCL', 'RKLB', 'SIVE', 'VUAA']);
    expect(TARGET_COLUMNS.map((c) => firstSortDir(c))).toEqual(['asc', 'desc', 'desc', 'desc', 'asc', 'desc', 'desc', 'desc', 'desc', 'asc']);
  });
});

describe('Target price helpers', () => {
  it('rating words at Yahoo\'s boundaries', () => {
    expect([1, 1.49, 1.5, 1.619, 2.5, 3.49, 3.5, 4.5, 5, null, 0].map(ratingWord)).toEqual(['Strong Buy', 'Strong Buy', 'Buy', 'Buy', 'Hold', 'Hold', 'Underperform', 'Sell', 'Sell', null, null]);
  });

  it('the fresh window: the last 30 days, ending now', () => {
    const t = (at, target = 1) => ({ firm: at, target, at });
    const list = [t(new Date(NOW + 60e3).toISOString()), t(daysAgo(0)), t(daysAgo(30)), t(new Date(NOW - 30 * 86400e3 - 1000).toISOString()), t(daysAgo(1), 0)];
    expect(freshTargets(list, NOW).map((x) => x.at)).toEqual([daysAgo(0), daysAgo(30)]);
  });

  it('"Updated HH:MM ET", with the date when the run was not today in New York; across the November DST switch', () => {
    expect(updatedLabel('2026-10-21T13:30:20.000Z', NOW)).toBe('Updated 09:30 ET');
    expect(updatedLabel('2026-10-20T20:00:30.000Z', NOW)).toBe('Updated Oct 20, 16:00 ET');
    expect(updatedLabel('2026-11-02T14:30:05.000Z', Date.parse('2026-11-02T15:00:00Z'))).toBe('Updated 09:30 ET');
    expect(updatedLabel(null, NOW)).toBe(null);
  });
});

describe('Target price ranges and tags', () => {
  it('writes both ends of a range with the same decimals, by the larger end: two under 100, none from 100 up', () => {
    // BMNR's Avg range on 2026-10-21 was 34 – 63.6: it read "34 – 63.60" before.
    expect(fmtRange(34, 63.6)).toBe('34.00 – 63.60');
    expect(fmtRange(8, 21)).toBe('8.00 – 21.00');
    expect(fmtRange(11.5252, 25.8137)).toBe('11.53 – 25.81');
    expect(fmtRange(64, 150)).toBe('64 – 150');
    expect(fmtRange(99.5, 100)).toBe('100');           // the larger end decides: both rounded to whole numbers
    expect(fmtRange(440, 1000)).toBe('440 – 1,000');
    expect(fmtRange(82000, 150000)).toBe('82,000 – 150,000');
    expect(fmtRange(13, 13)).toBe('13.00');
    expect([rangeDecimals(1, 99.99), rangeDecimals(1, 100), rangeDecimals(500, 4700000)]).toEqual([2, 0, 0]);
    // Every range of the fixture: each one's two ends carry the same number of decimals.
    for (const r of buildTargetRows(METRICS, DATA, NOW)) {
      for (const [lo, hi] of [[r.low, r.high], [r.fresh?.low, r.fresh?.high]]) {
        if (lo == null || hi == null) continue;
        const ends = fmtRange(lo, hi).split(' – ').map((x) => (x.split('.')[1] || '').length);
        expect(new Set(ends).size, `${r.ticker} ${fmtRange(lo, hi)}`).toBe(1);
      }
    }
  });

  it("a fund's tag names its coverage and, when any, the holdings skipped as implausible", () => {
    const vuaa = /** @type {any} */ (by('VUAA.L'));
    expect(kindTag(vuaa)?.text).toBe('holdings-weighted · 39%');
    const saem = { kind: 'holdings', coverage: { weight: 0.2246, names: 7, source: "SAEM.L's top holdings (Yahoo)",
      skipped: [{ symbol: '005930.KQ', weight: 0.069, ratio: 2.1428 }, { symbol: '000660.KQ', weight: 0.0539, ratio: 2.3928 }, { symbol: '005935', weight: 0.0086, ratio: 2.1428 }] } };
    const t = kindTag(saem);
    expect([t?.text, t?.note]).toEqual(['holdings-weighted · 22%', '3 skipped']);
    expect(kindTag(vuaa)?.note).toBe('');
    expect(t?.title).toContain('005930.KQ 6.9% of the fund, 2.14×; 000660.KQ 5.4% of the fund, 2.39×; 005935 0.9% of the fund, 2.14×');
    expect(kindTag({ kind: 'consensus' })).toBe(null);
  });

  it("bitcoin's row says each target's horizon on hover", () => {
    const btc = { kind: 'strategist', sources: [
      { firm: 'Standard Chartered', target: 100000, at: '2026-02-12', horizon: 'end-2026' },
      { firm: 'Citi', target: 82000, at: '2026-07-01', horizon: '12 months' },
      { firm: 'Bernstein', target: 150000, at: '2026-08-26', horizon: 'mid-2027' },
    ] };
    expect(strategistTitle(btc).split('\n').slice(1)).toEqual([
      'Standard Chartered: 100,000, horizon end-2026 (published 2026-02-12)',
      'Citi: 82,000, horizon 12 months (published 2026-07-01)',
      'Bernstein: 150,000, horizon mid-2027 (published 2026-08-26)',
    ]);
    expect(kindTag(btc)?.text).toBe('strategist targets');
  });
});

