// Pin test for the heatmap tile's display-label helper. The label drops
// the Yahoo exchange suffix so tight tiles aren't cluttered by ".PA" /
// ".L"; the FULL symbol still rides on tile.ticker for clicks + the
// chart-open title, so this strip must never touch anything that would
// change which instrument the click resolves.

import { describe, it, expect } from 'vitest';
import { displayTicker, fitTicker, heatmapItems, treemap, STACK_MIN_RATIO, STACK_MAX_RATIO } from './heatmap.jsx';

describe('displayTicker', () => {
  it('strips the exchange suffix from foreign-listed tickers', () => {
    expect(displayTicker('XFAB.PA')).toBe('XFAB'); // Euronext Paris
    expect(displayTicker('VUAG.L')).toBe('VUAG');   // London
    expect(displayTicker('0700.HK')).toBe('0700');  // Hong Kong
    expect(displayTicker('ASML.AS')).toBe('ASML');  // Amsterdam
    expect(displayTicker('SAP.DE')).toBe('SAP');    // XETRA
  });

  it('leaves US equities, indices and bare fund codes untouched', () => {
    expect(displayTicker('NVDA')).toBe('NVDA');
    expect(displayTicker('^GSPC')).toBe('^GSPC');
    expect(displayTicker('017731')).toBe('017731'); // CN fund code
  });

  it('does not strip hyphenated symbols (no exchange dot)', () => {
    // The dot-suffix shape is what we strip — BRK-B / BTC-USD use a
    // hyphen, so the part after it is NOT an exchange and must stay.
    expect(displayTicker('BRK-B')).toBe('BRK-B');
    expect(displayTicker('BTC-USD')).toBe('BTC-USD');
  });

  it('maps aliased foreign-listing codes to the home-market symbol (2DG → SIVE)', () => {
    // Sivers Semiconductors' German listing — heatmap tiles show the
    // Stockholm home symbol. Applied after the suffix strip so every
    // listing variant maps; everywhere else in the app keeps 2DG.
    expect(displayTicker('2DG')).toBe('SIVE');
    expect(displayTicker('2DG.F')).toBe('SIVE');
    expect(displayTicker('2DG.DE')).toBe('SIVE');
  });
});

// displayTicker now lives in formatters.js because three surfaces label
// tickers the same way — heatmap tiles, tactics-board chips and Top
// Movers rows. The chart modal is deliberately the ONE place that keeps
// showing the true Yahoo symbol, so a tap still resolves the right
// instrument and the user can see which listing they actually hold.
describe('displayTicker — shared across heatmap / pitch / top movers', () => {
  it('maps every 2DG listing variant to SIVE, including .SG', () => {
    expect(displayTicker('2DG.SG')).toBe('SIVE'); // Stuttgart
    expect(displayTicker('2DG.F')).toBe('SIVE');  // Frankfurt
    expect(displayTicker('2DG.DE')).toBe('SIVE'); // XETRA
    expect(displayTicker('2DG')).toBe('SIVE');
  });

  it('is null/undefined-safe (chips render before data lands)', () => {
    expect(displayTicker(/** @type {any} */ (undefined))).toBe('');
    expect(displayTicker(/** @type {any} */ (null))).toBe('');
    expect(displayTicker('')).toBe('');
  });
});

// The SAEM / VUAA bug: a four-character ticker on a narrow tile kept its
// 11px, overflowed, and `word-break: break-all` wrapped it 3 + 1 — a
// lone "M" under "SAE", with the % pressed against the bottom edge.
//
// Closed-form: a glyph costs 0.64 x fontSize (0.6em advance + 0.04em
// tracking) and `.hm-ticker` eats 2px of padding per side, so a label of
// `n` characters fits one line iff  n x 0.64 x fs <= tw - 4.
describe('fitTicker — a ticker fits its tile, or breaks in the middle', () => {
  const fitsOneLine = (label, tw, fs) => label.length * 0.64 * fs <= tw - 4;

  it('shrinks a 4-char ticker until it fits the tile on one line', () => {
    // The tile from the screenshot: ~62px wide. 11px would need
    // 4 x 0.64 x 11 = 28.2px — that fits, so the old size was fine here…
    expect(fitsOneLine('SAEM', 62, fitTicker('SAEM', 62, 62).fontSize)).toBe(true);
    // …but the narrow ones are where it broke. 30px wide leaves 26px:
    // 4 x 0.64 x 11 = 28.2 > 26, so 11px cannot work and the old code
    // used it anyway.
    const tight = fitTicker('SAEM', 30, 40);
    expect(tight.fontSize).toBeLessThan(11);
    expect(fitsOneLine('SAEM', 30, tight.fontSize)).toBe(true);
  });

  it('never orphans a single character — the only break is the midpoint', () => {
    expect(fitTicker('SAEM', 40, 40).mid).toBe(2);   // SA / EM
    expect(fitTicker('VUAA', 40, 40).mid).toBe(2);   // VU / AA
    expect(fitTicker('NVDA', 40, 40).mid).toBe(2);
    expect(fitTicker('BMNR', 40, 40).mid).toBe(2);
    expect(fitTicker('SIVE', 40, 40).mid).toBe(2);
    // Odd lengths lean the extra character to the TOP line, never
    // leaving one alone at the bottom.
    expect(fitTicker('CRWV1', 40, 40).mid).toBe(3);  // CRW / V1
    expect(fitTicker('MU', 40, 40).mid).toBe(1);
  });

  it('leaves a short ticker on a roomy tile at full size', () => {
    expect(fitTicker('MU', 90, 90).fontSize).toBe(11);
    expect(fitTicker('NVDA', 90, 90).fontSize).toBe(11);
  });

  it('reserves room under the ticker for the % line', () => {
    // A 22px-tall tile: (22 - 3) * 0.55 / 1.05 = 9.95 -> 9px, so the
    // ticker cannot eat the height the % needs. At 11px the two lines
    // would have been 11.55 + 3 + 10 = 24.5px inside a 22px tile.
    expect(fitTicker('MU', 90, 22).fontSize).toBe(9);
    expect(fitTicker('MU', 90, 60).fontSize).toBe(11);
  });

  it('fits a 4-char ticker on one line at EVERY width the tile shows one', () => {
    // `showTicker` renders the label from 22px up. The old sizing was
    // `max(8, min(11, floor(min(tw, th) / 3)))`, and that 8px floor is
    // the bug: below ~25px it stopped shrinking while the tile kept
    // getting narrower, so the label overflowed and `break-all` wrapped
    // it 3 + 1. Sweep the whole range rather than trusting one tile —
    // the squarify layout will not reliably hand you a 23px tile.
    const oldFs = (tw, th) => Math.max(8, Math.min(11, Math.floor(Math.min(tw, th) / 3)));
    const overflowed = [];
    for (let tw = 22; tw <= 60; tw++) {
      const fs = fitTicker('SAEM', tw, 80).fontSize;
      expect(fitsOneLine('SAEM', tw, fs)).toBe(true);
      if (!fitsOneLine('SAEM', tw, oldFs(tw, 80))) overflowed.push(tw);
    }
    // Measured, not predicted: the old sizing overflowed at 22, 23, 24
    // (the 8px floor) and again at 27, where floor(27/3) = 9 needs
    // 23.04px of a 23px line. Every one of those tiles wrapped 3 + 1.
    expect(overflowed).toEqual([22, 23, 24, 27]);
  });

  it('never goes below 7px, however small the tile', () => {
    expect(fitTicker('LONGEST', 24, 22).fontSize).toBe(7);
    expect(fitTicker('', 24, 22).fontSize).toBeGreaterThanOrEqual(7);
  });
});

describe('heatmapItems — no tile while the exchange rates are loading (review batch 5)', () => {
  // A tile's size is its share of the book: before the first market data, one GBP holding at 1:1 sizes every tile
  // wrong, so the map waits empty (its own empty state) until the rates land.
  const metrics = { positions: {
    CB: { players: [{ ticker: 'BRIT.L', marketValue: 250, dayPct: 4.17, fxMissing: true }] },
    CM: { players: [{ ticker: 'ACME', marketValue: 1440, dayPct: 0.84 }, { ticker: 'CASH', isCash: true, marketValue: 500 }] },
  } };

  it('draws nothing while pending', () => {
    expect(heatmapItems(metrics, true)).toEqual([]);
  });

  it('draws every non-cash holding, largest first, once the rates are in', () => {
    expect(heatmapItems(metrics).map((i) => [i.ticker, i.value, i.pct])).toEqual([['ACME', 1440, 0.84], ['BRIT.L', 250, 4.17]]);
  });
});

// ── The desktop map's top four on the right: one column, as the phone draws them (Davies, 2026-10-20) ──────────────
//
// The weights are the tile areas measured off his desktop screenshot of that day, in px² of the 530 × 810 canvas
// (`.heatmap` 560 × 840 less its 14px padding and 1px border), so they are shares of the book, not amounts. Fed
// through the old split they reproduce that screenshot tile for tile: MSFT/NVDA over SPCX/AMZN on the left, PLTR/RKLB
// over MSTR/ORCL on the right (a 4 × 2 block), GOOG/NBIS/AAPL over META/BTC-USD/BE, TSM/BMNR beside APLD/HOOD, MU
// over CRWV, and NVTS over SIVE (2DG) beside SAEM over VUAA.
const OCT20 = [
  ['MSFT', 34484], ['NVDA', 33785], ['SPCX', 30450], ['AMZN', 29029], ['PLTR', 27816], ['RKLB', 26220],
  ['MSTR', 26208], ['ORCL', 23088], ['GOOG', 23000], ['NBIS', 21000], ['AAPL', 19000], ['META', 18759],
  ['BTC-USD', 16224], ['BE', 16055], ['TSM', 13334], ['BMNR', 12862], ['APLD', 12765], ['HOOD', 12765],
  ['MU', 11830], ['CRWV', 8300], ['NVTS', 8000], ['2DG', 5100], ['SAEM', 1400], ['VUAA', 1360],
].map(([ticker, value]) => ({ ticker: String(ticker), value: Number(value) }));
const DESKTOP = [530, 810];
const PHONE = [336, 610]; // a 390px-wide phone: `.heatmap` is 100% wide there and 640px tall

// The split as it was before 2026-10-20, kept here as the reference every other layout must still match.
function oldTreemap(nodes, x, y, w, h) {
  if (!nodes.length) return [];
  if (nodes.length === 1) return [{ ...nodes[0], x, y, w, h }];
  const total = nodes.reduce((s, n) => s + n.value, 0);
  let acc = 0, split = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    acc += nodes[i].value;
    split = i;
    if (acc * 2 >= total) break;
  }
  const g1 = nodes.slice(0, split + 1);
  const g2 = nodes.slice(split + 1);
  const frac = g1.reduce((s, n) => s + n.value, 0) / total;
  if (w >= h) {
    const w1 = Math.max(1, Math.round(w * frac));
    return [...oldTreemap(g1, x, y, w1, h), ...oldTreemap(g2, x + w1, y, w - w1, h)];
  }
  const h1 = Math.max(1, Math.round(h * frac));
  return [...oldTreemap(g1, x, y, w, h1), ...oldTreemap(g2, x, y + h1, w, h - h1)];
}
const rects = (tiles) => Object.fromEntries(tiles.map((t) => [t.ticker, [t.x, t.y, t.w, t.h]]));
const changed = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const RIGHT4 = ['PLTR', 'RKLB', 'MSTR', 'ORCL'];
/** @param {number[]} values */
const nodes = (values) => values.map((value, i) => ({ ticker: `T${i}`, value }));

describe('treemap — a 2×2 beside a 2×2 stacks its right half into one column (2026-10-20)', () => {
  it('reproduces the old desktop shape first: PLTR/RKLB over MSTR/ORCL, a 2×2 on the right', () => {
    const old = rects(oldTreemap(OCT20, 0, 0, DESKTOP[0], DESKTOP[1]));
    expect(RIGHT4.map((t) => old[t])).toEqual([
      [293, 0, 122, 226], [415, 0, 115, 226],
      [293, 226, 126, 206], [419, 226, 111, 206],
    ]);
  });

  it('stacks PLTR, RKLB, MSTR, ORCL in one column on the desktop map, as the phone does', () => {
    const now = rects(treemap(OCT20, 0, 0, DESKTOP[0], DESKTOP[1]));
    expect(RIGHT4.map((t) => now[t])).toEqual([
      [293, 0, 237, 116],
      [293, 116, 237, 110],
      [293, 226, 237, 110],
      [293, 336, 237, 96],
    ]);
    // The column fills exactly the block the 2×2 filled: x 293..530, y 0..432.
    // Each tile as drawn (3px gap off each side) is wider than tall and no flatter than 3 : 1: 2.52 at most (ORCL).
    for (const t of RIGHT4) {
      const [, , w, h] = now[t];
      expect((w - 3) / (h - 3)).toBeGreaterThanOrEqual(STACK_MIN_RATIO);
      expect((w - 3) / (h - 3)).toBeLessThanOrEqual(STACK_MAX_RATIO);
    }
  });

  it('leaves every other tile of that map where it was', () => {
    const now = rects(treemap(OCT20, 0, 0, DESKTOP[0], DESKTOP[1]));
    const old = rects(oldTreemap(OCT20, 0, 0, DESKTOP[0], DESKTOP[1]));
    expect(changed(now, old)).toEqual(RIGHT4);
  });

  it('changes nothing on the phone, which already stacks them', () => {
    for (let n = 1; n <= OCT20.length; n++) {
      const set = OCT20.slice(0, n);
      expect(treemap(set, 0, 0, PHONE[0], PHONE[1])).toEqual(oldTreemap(set, 0, 0, PHONE[0], PHONE[1]));
    }
    expect(rects(treemap(OCT20, 0, 0, PHONE[0], PHONE[1])).ORCL).toEqual([186, 253, 150, 73]);
  });

  it('changes only that case across the book\'s every prefix at five canvas sizes', () => {
    const differs = [];
    for (let n = 1; n <= OCT20.length; n++) {
      for (const [w, h] of [DESKTOP, PHONE, [530, 610], [400, 810], [300, 610]]) {
        const set = OCT20.slice(0, n);
        const d = changed(rects(treemap(set, 0, 0, w, h)), rects(oldTreemap(set, 0, 0, w, h)));
        if (d.length) differs.push(`${n}@${w}x${h}: ${d.join(' ')}`);
      }
    }
    // 20 to 24 holdings: the top block as above. 14 holdings: the same shape one level down, AAPL/META over
    // BTC-USD/BE beside MSTR/ORCL over GOOG/NBIS, now AAPL, META, BTC-USD, BE in one column (227 wide, 88 to 104 tall).
    expect(differs).toEqual([
      '14@530x810: AAPL META BTC-USD BE',
      ...[20, 21, 22, 23, 24].map((n) => `${n}@530x810: ${RIGHT4.join(' ')}`),
    ]);
  });

  it('leaves other books alone: equal weights, a steep book, one dominant holding — all but sixteen equal tiles', () => {
    const books = [
      nodes([1, 1, 1, 1]), nodes([1, 1, 1, 1, 1, 1, 1, 1]), nodes(Array(16).fill(1)),
      nodes(Array.from({ length: 12 }, (_, i) => 100 * 0.8 ** i)),
      nodes([60, 10, 9, 8, 7, 6]),
    ];
    const differs = [];
    books.forEach((book, i) => {
      for (const [w, h] of [DESKTOP, PHONE, [530, 610], [800, 400]]) {
        const d = changed(rects(treemap(book, 0, 0, w, h)), rects(oldTreemap(book, 0, 0, w, h)));
        if (d.length) differs.push(`${i}@${w}x${h}: ${d.join(' ')}`);
      }
    });
    // Sixteen equal holdings are the one book here with the same shape: a 4 × 4 grid is two 2×2 pairs per half,
    // and each right-hand 2×2 now stacks (T4-T7, T12-T15), at the desktop and phone sizes and the wide one alike.
    expect(differs).toEqual(['2@530x810', '2@336x610', '2@800x400'].map((k) => `${k}: T4 T5 T6 T7 T12 T13 T14 T15`));
  });

  it('keeps the 2×2 when stacking would flatten a tile past 3 : 1', () => {
    // Left and right are each 70 × 100, cut 60 / 40 into pairs 70 wide: both 2×2. Stacked, the right's 10 would
    // be 70 × 10 (7 : 1), so it stays put; with near-equal weights the column reads 2.7 to 2.9 : 1 and stacks.
    const flat = nodes([30, 30, 30, 10, 30, 30, 30, 10]);
    expect(treemap(flat, 0, 0, 140, 100)).toEqual(oldTreemap(flat, 0, 0, 140, 100));
    const even = nodes([26, 25, 25, 24, 26, 25, 25, 24]);
    expect(rects(treemap(even, 0, 0, 140, 100))).toMatchObject({
      T4: [70, 0, 70, 26], T5: [70, 26, 70, 25], T6: [70, 51, 70, 25], T7: [70, 76, 70, 24],
    });
    // The book's own boundary: at h 810 the column's ORCL would pass 3 : 1 from a 648px-wide canvas on, and the
    // 2×2 stays. (`.heatmap` caps at 560px, a 530px canvas, so the desktop map never gets there.)
    expect(rects(treemap(OCT20, 0, 0, 647, 810)).ORCL[2]).toBe(647 - 358);
    expect(treemap(OCT20, 0, 0, 648, 810)).toEqual(oldTreemap(OCT20, 0, 0, 648, 810));
  });

  it('keeps the right 2×2 when the left half is not a 2×2 as well', () => {
    // Seven tiles: the left half is three (35, 35, 30), so the right four keep the split's own 2×2.
    const book = nodes([35, 35, 30, 26, 25, 25, 24]);
    expect(treemap(book, 0, 0, 140, 100)).toEqual(oldTreemap(book, 0, 0, 140, 100));
  });
});

