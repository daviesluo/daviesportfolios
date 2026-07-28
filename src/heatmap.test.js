// Pin test for the heatmap tile's display-label helper. The label drops
// the Yahoo exchange suffix so tight tiles aren't cluttered by ".PA" /
// ".L"; the FULL symbol still rides on tile.ticker for clicks + the
// chart-open title, so this strip must never touch anything that would
// change which instrument the click resolves.

import { describe, it, expect } from 'vitest';
import { displayTicker, treemap } from './heatmap.jsx';

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

// Pins the three-tile layout special case. The generic binary split
// turned a 3-tile region into a lopsided "two-beside-one" (two
// side-by-side tiles whose sizes could differ a lot, plus one spanning
// tile) — the MU / NET / 017731 arrangement the user flagged as looking
// unbalanced. A 3-tile region now lays out as three proportional strips
// along the region's longer axis: rows in a tall/square region, columns
// in a wide one.
describe('treemap — three-tile strip layout', () => {
  const N = (ticker, value) => ({ ticker, value, pct: 0 });
  const nodes = [N('A', 60), N('B', 30), N('C', 10)]; // sorted desc, total 100

  it('a tall (portrait) region stacks the 3 tiles as full-width rows, largest on top', () => {
    const tiles = treemap(nodes, 0, 0, 90, 300);
    expect(tiles.map(t => t.ticker)).toEqual(['A', 'B', 'C']);
    // Every tile spans the full width — never two side by side.
    for (const t of tiles) { expect(t.x).toBe(0); expect(t.w).toBe(90); }
    // Heights are proportional to value; rows stack top → bottom.
    expect(tiles.map(t => t.y)).toEqual([0, 180, 270]);
    expect(tiles.map(t => t.h)).toEqual([180, 90, 30]);
    // Exact fill — the last strip's remainder leaves no gap / overlap.
    const last = tiles[2];
    expect(last.y + last.h).toBe(300);
  });

  it('a wide (landscape) region splits the 3 tiles into full-height columns', () => {
    const tiles = treemap(nodes, 0, 0, 300, 90);
    expect(tiles.map(t => t.ticker)).toEqual(['A', 'B', 'C']);
    for (const t of tiles) { expect(t.y).toBe(0); expect(t.h).toBe(90); }
    expect(tiles.map(t => t.x)).toEqual([0, 180, 270]);
    expect(tiles.map(t => t.w)).toEqual([180, 90, 30]);
    const last = tiles[2];
    expect(last.x + last.w).toBe(300);
  });

  it('a square region stacks as rows (ties go to horizontal)', () => {
    const tiles = treemap(nodes, 0, 0, 120, 120);
    for (const t of tiles) expect(t.w).toBe(120); // full width → rows, not columns
  });

  it('leaves 1- and 2-tile regions on their original split', () => {
    // Single tile fills the region.
    expect(treemap([N('A', 10)], 0, 0, 50, 50))
      .toEqual([{ ticker: 'A', value: 10, pct: 0, x: 0, y: 0, w: 50, h: 50 }]);
    // Two tiles still binary-split — here a portrait box stacks them.
    const two = treemap([N('A', 60), N('B', 40)], 0, 0, 40, 100);
    expect(two).toHaveLength(2);
    expect(two.map(t => t.ticker)).toEqual(['A', 'B']);
  });
});
