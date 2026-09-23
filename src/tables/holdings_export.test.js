// Pin tests for the Holdings List export helpers. The matrix carries the
// "same display logic" contract — every cell must format identically to
// the on-screen table — so it's asserted against the very fmtMoney /
// fmtPct the table renders with. The .xlsx path is a hand-rolled stored
// zip, so we assert the ZIP signatures and (because stored = no
// compression) that the cell text is embedded verbatim.

import { describe, it, expect } from 'vitest';
import { holdingsRowsToMatrix, matrixToTsv, matrixToXlsx } from './holdings_export.js';
import { fmtMoney, fmtPct } from '../app/formatters.js';

const rows = [
  { ticker: 'NVDA', name: 'NVIDIA Corporation', exposure: 12.3456, costBasis: 1000, marketValue: 1500, dayChange: 25, dayPct: 1.6667, unrlGL: 500, unrlPct: 50 },
  { ticker: 'XFAB.PA', name: '--', exposure: 3.2, costBasis: 80, marketValue: 60, dayChange: -2, dayPct: -3.2258, unrlGL: -20, unrlPct: -25 },
];

describe('holdingsRowsToMatrix', () => {
  it('first row is the 9-column header', () => {
    const m = holdingsRowsToMatrix(rows);
    expect(m[0]).toEqual([
      'Symbol', 'Name', 'Exposure', 'Cost Basis', 'Market Value',
      'Day Change', 'Day Change %', 'Unrealized G/L', 'Unrealized G/L %',
    ]);
  });

  it('formats each cell with the SAME formatters the table uses', () => {
    const m = holdingsRowsToMatrix(rows);
    // Row 1 (NVDA) — compared against the live formatters so the test
    // can't drift from the table and stays locale-independent.
    expect(m[1]).toEqual([
      'NVDA', 'NVIDIA Corporation', '12.35%',
      fmtMoney(1000), fmtMoney(1500),
      fmtMoney(25, { signed: true }), fmtPct(1.6667),
      fmtMoney(500, { signed: true }), fmtPct(50),
    ]);
    // Row 2 (XFAB.PA) — negative + sub-$1000 paths, "--" name passthrough.
    expect(m[2]).toEqual([
      'XFAB.PA', '--', '3.20%',
      '$80.00', '$60.00', '-$2.00', '-3.23%', '-$20.00', '-25.00%',
    ]);
  });

  it('empty / missing rows → header only', () => {
    expect(holdingsRowsToMatrix([])).toHaveLength(1);
    // @ts-expect-error exercising the nullish guard
    expect(holdingsRowsToMatrix(undefined)).toHaveLength(1);
  });
});

describe('matrixToTsv', () => {
  it('tab-joins columns and newline-joins rows', () => {
    const tsv = matrixToTsv([['a', 'b'], ['c', 'd']]);
    expect(tsv).toBe('a\tb\nc\td');
  });

  it('round-trips the holdings matrix with the header intact', () => {
    const tsv = matrixToTsv(holdingsRowsToMatrix(rows));
    const lines = tsv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0].split('\t')[0]).toBe('Symbol');
    expect(lines[1].split('\t')[0]).toBe('NVDA');
  });
});

describe('matrixToXlsx', () => {
  const bytes = matrixToXlsx(holdingsRowsToMatrix(rows));
  // Decode the raw bytes 1:1 (latin1) — the parts are STORED (no
  // compression), so the XML is present verbatim and searchable.
  const raw = new TextDecoder('latin1').decode(bytes);

  it('is a ZIP (local-file + central-dir + end-of-central-dir signatures)', () => {
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
    expect(raw.includes('PK\x01\x02')).toBe(true); // central directory
    expect(raw.includes('PK\x05\x06')).toBe(true); // end of central directory
  });

  it('embeds the required OOXML parts', () => {
    expect(raw.includes('[Content_Types].xml')).toBe(true);
    expect(raw.includes('xl/worksheets/sheet1.xml')).toBe(true);
    expect(raw.includes('xl/workbook.xml')).toBe(true);
  });

  it('embeds the header + cell values as inline strings', () => {
    expect(raw.includes('<t xml:space="preserve">Symbol</t>')).toBe(true);
    expect(raw.includes('<t xml:space="preserve">NVDA</t>')).toBe(true);
    expect(raw.includes('<t xml:space="preserve">NVIDIA Corporation</t>')).toBe(true);
    expect(raw.includes('<t xml:space="preserve">12.35%</t>')).toBe(true);
  });

  it('XML-escapes special characters in cell text', () => {
    const x = matrixToXlsx([['A & B <co>', 'plain']]);
    const r = new TextDecoder('latin1').decode(x);
    expect(r.includes('A &amp; B &lt;co&gt;')).toBe(true);
  });

  it('adds a column-header autofilter spanning the whole table (header + data)', () => {
    // 9 columns × (header + 2 rows) → A1:I3. This is what gives Excel the
    // sort / filter dropdowns on every header, matching the on-screen
    // sortable columns.
    expect(raw.includes('<autoFilter ref="A1:I3"/>')).toBe(true);
    // …positioned after the cell data (CT_Worksheet sequence).
    expect(raw.indexOf('</sheetData>')).toBeLessThan(raw.indexOf('<autoFilter'));
  });

  it('autofilter range tracks a single-column / header-only matrix', () => {
    const r = new TextDecoder('latin1').decode(matrixToXlsx([['Only']]));
    expect(r.includes('<autoFilter ref="A1:A1"/>')).toBe(true);
  });
});
