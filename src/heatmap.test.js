// Pin test for the heatmap tile's display-label helper. The label drops
// the Yahoo exchange suffix so tight tiles aren't cluttered by ".PA" /
// ".L"; the FULL symbol still rides on tile.ticker for clicks + the
// chart-open title, so this strip must never touch anything that would
// change which instrument the click resolves.

import { describe, it, expect } from 'vitest';
import { displayTicker, fitTicker, treemap } from './heatmap.jsx';

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

// The layout has been wrong twice, in opposite directions, and these pin both
// halves of the fix.
//
// First it was a recursive binary split that cut where the running total
// passed half. For near-equal holdings that is the exact middle every time, so
// the biggest positions drew a grid of near-identical rectangles. Moving the
// cut off-centre broke the repetition and replaced it with a mess: seams that
// stop halfway and restart 70 px lower. "Varied but orderly" is a statement
// about SEAMS, so the layout is now bands that span the whole free space, and
// the variety is in how many holdings share one.
describe('treemap — bands across the box, area still proportional to value', () => {
  const book = (values) => values.map((value, i) => ({ ticker: 'T' + i, value }));
  // Eight leaders within a whisker of each other, then a decaying tail: the
  // book shape that produced the grid.
  const SCREENSHOT = [9.9, 9.4, 9.1, 8.8, 8.5, 8.2, 8.0, 7.7,
                      5.6, 4.4, 4.1, 3.0, 2.6, 1.9, 1.5, 1.2, 0.9, 0.7, 0.6, 0.4];
  // `.heatmap` is min(100%, 560px) wide by 640 / 840 tall, less 14px of
  // padding on each side. These are the only two canvases the app draws.
  const PHONE = [338, 612], DESKTOP = [532, 812];

  const bandAt = (tiles, y) => tiles.filter((t) => t.y === y).sort((a, b) => a.x - b.x);
  const aspect = (t) => Math.max(t.w / t.h, t.h / t.w);

  it('keeps every tile\'s area proportional to its value', () => {
    // The contract the whole view rests on; nothing above may bend it.
    for (const [W, H] of [PHONE, DESKTOP]) {
      const nodes = book(SCREENSHOT);
      const total = SCREENSHOT.reduce((s, x) => s + x, 0);
      for (const tile of treemap(nodes, 0, 0, W, H)) {
        const want = (nodes.find((n) => n.ticker === tile.ticker).value / total) * W * H;
        // 4 % covers the rounding each band does to land on whole pixels.
        expect(Math.abs(tile.w * tile.h - want) / want).toBeLessThan(0.04);
      }
    }
  });

  it('opens with bands that run the full width, edge to edge', () => {
    // This is the tidiness, stated exactly: a band's tiles share one top, one
    // bottom, and between them they span the box. The binary split could not
    // promise this at any depth — that is what made it look ragged.
    for (const [W, H] of [PHONE, DESKTOP]) {
      const tiles = treemap(book(SCREENSHOT), 0, 0, W, H);
      // Both canvases are taller than wide, so the opening bands run across.
      // Deeper down the leftover turns wide and the bands become columns,
      // which is the same promise rotated; the two at the top are the ones a
      // glance at the board actually reads.
      let y = 0;
      for (let band = 0; band < 2; band++) {
        const row = bandAt(tiles, y);
        expect(row.length).toBeGreaterThanOrEqual(2);
        expect(new Set(row.map((t) => t.h)).size).toBe(1);       // one thickness
        expect(row.reduce((s, t) => s + t.w, 0)).toBe(W);        // no gap, no overhang
        y += row[0].h;                                            // next band starts here
      }
    }
  });

  it('varies how many holdings share a band, so the top is not a grid', () => {
    // Bands of equal size at equal thickness IS the grid. The band shape asked
    // for walks a golden-ratio sequence, so consecutive bands differ.
    for (const [W, H] of [PHONE, DESKTOP]) {
      const tiles = treemap(book(SCREENSHOT), 0, 0, W, H);
      const sizes = [];
      let y = 0;
      for (let band = 0; band < 2; band++) {
        const row = bandAt(tiles, y);
        sizes.push(row.length);
        y += row[0].h;
      }
      // Measured: two at the top, then three. The old rule gave three, then
      // three, then two more of the same height — a grid by any other name.
      expect(new Set(sizes).size).toBeGreaterThan(1);
    }
  });

  it('stops eight near-equal holdings drawing the same rectangle eight times', () => {
    // Two tiles "look the same" if both sides are within 15 % — the tolerance
    // at which a run of them reads as a repeat. Measured on this book, the
    // original rule put all eight of the leaders in ONE such run on the phone
    // and six of eight on the desktop. Bands measure 5, which is what a book
    // whose top eight really are within 22 % of each other can honestly do:
    // equal areas and sane aspect ratios force similar shapes. The win is that
    // they now sit in bands of two and three rather than three to a row.
    const alike = (a, b) =>
      Math.abs(a.w - b.w) / Math.max(a.w, b.w) <= 0.15 &&
      Math.abs(a.h - b.h) / Math.max(a.h, b.h) <= 0.15;
    for (const [W, H] of [PHONE, DESKTOP]) {
      const top8 = treemap(book(SCREENSHOT), 0, 0, W, H).slice(0, 8);
      expect(Math.max(...top8.map((a) => top8.filter((b) => alike(a, b)).length)))
        .toBeLessThanOrEqual(5);
    }
  });

  it('tiles the box exactly — no gap, no overlap, nothing off the canvas', () => {
    const [W, H] = PHONE;
    const tiles = treemap(book(SCREENSHOT), 0, 0, W, H);
    expect(tiles).toHaveLength(SCREENSHOT.length);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(W);
      expect(t.y + t.h).toBeLessThanOrEqual(H);
    }
    const covered = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(Math.abs(covered - W * H) / (W * H)).toBeLessThan(0.01);
  });

  it('keeps every holding labelled, and off the 3:1 slivers', () => {
    // A band is only allowed to take a holding if the tile it gets can carry a
    // ticker, and only allowed to leave a strip another band can use. The
    // original rule had neither guard and left an 18px-wide tile on this book.
    for (const [W, H] of [PHONE, DESKTOP]) {
      const tiles = treemap(book(SCREENSHOT), 0, 0, W, H);
      for (const t of tiles) {
        expect(t.w - 3).toBeGreaterThanOrEqual(22);   // the ticker's own gate
        expect(t.h - 3).toBeGreaterThanOrEqual(16);
      }
      expect(Math.max(...tiles.map(aspect))).toBeLessThan(3.2);
    }
  });

  it('keeps the tiny, awkward holdings labelled — the handover\'s real job', () => {
    // The browser sweep's book: a 54 % position, a tail, and a CN fund worth
    // 1.1 % of it. A band can only span the full width, so that fund becomes a
    // sliver no label fits; the nesting split can give it a squarish corner
    // instead, which is why the tail hands over. Left to the bands it drew
    // 13 x 246, and the sweep went red on a check this work never touched.
    for (const [W, H] of [PHONE, DESKTOP]) {
      const fund = treemap(book([1440, 600, 312.5, 300, 30]), 0, 0, W, H)
        .find((t) => t.ticker === 'T4');
      expect(fund.w - 3).toBeGreaterThanOrEqual(22);
      expect(fund.h - 3).toBeGreaterThanOrEqual(16);
    }
  });

  it('still hands a dominant holding its own slab, and never a splinter', () => {
    const vals = [50, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1];
    const tiles = treemap(book(vals), 0, 0, 338, 612);
    expect(Math.max(...tiles.map(aspect))).toBeLessThan(3.0);
    const giant = tiles.find((t) => t.ticker === 'T0');
    expect(giant.w * giant.h).toBeGreaterThan(338 * 612 * 0.45);
  });

  it('draws the same map for the same book every time', () => {
    // The variety comes from a golden-ratio sequence over the bands, not from
    // randomness — a board that reshuffled on every render would be unusable.
    const a = treemap(book(SCREENSHOT), 0, 0, 338, 612);
    const b = treemap(book(SCREENSHOT), 0, 0, 338, 612);
    expect(b).toEqual(a);
  });

  it('degenerates gracefully: one holding, two holdings, none', () => {
    expect(treemap([], 0, 0, 300, 400)).toEqual([]);
    expect(treemap(book([1]), 0, 0, 300, 400))
      .toEqual([{ ticker: 'T0', value: 1, x: 0, y: 0, w: 300, h: 400 }]);
    // A handful of holdings goes straight to the nesting split — there is
    // nothing for a band to vary — so a pair splits at its value ratio.
    const pair = treemap(book([3, 1]), 0, 0, 400, 200);
    expect(pair.map((t) => t.w)).toEqual([300, 100]);
    expect(pair.every((t) => t.h === 200)).toBe(true);
  });
});
