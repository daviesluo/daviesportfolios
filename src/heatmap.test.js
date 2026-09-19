// Pin test for the heatmap tile's display-label helper. The label drops
// the Yahoo exchange suffix so tight tiles aren't cluttered by ".PA" /
// ".L"; the FULL symbol still rides on tile.ticker for clicks + the
// chart-open title, so this strip must never touch anything that would
// change which instrument the click resolves.

import { describe, it, expect } from 'vitest';
import { displayTicker, fitTicker } from './heatmap.jsx';

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
