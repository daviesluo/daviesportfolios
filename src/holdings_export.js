// Export helpers for the Holdings List modal — turn the on-screen rows
// into a clipboard-friendly TSV and a self-contained .xlsx workbook,
// both carrying the SAME header + formatted cells the table renders.
// Values are the real numbers formatted exactly as displayed; the
// hide-values mask is a screen-only privacy overlay, not data, so it's
// never exported. Pure + dependency-free — the .xlsx is a hand-rolled
// minimal OOXML zip (stored / no compression) so the lean prod bundle
// gains no spreadsheet library. Pinned by holdings_export.test.js.

import { fmtMoney, fmtPct } from './formatters.js';

// One header per column. Day Change / Unrealized G/L are split into their
// dollar + percent parts (the table stacks them in one cell) so every
// number lands in its own spreadsheet column — the faithful tabular form
// of "all the information in the table".
const EXPORT_HEADERS = [
  'Symbol', 'Name', 'Exposure', 'Cost Basis', 'Market Value',
  'Day Change', 'Day Change %', 'Unrealized G/L', 'Unrealized G/L %',
];

/**
 * Flatten the holdings rows into a 2D string matrix (header row first),
 * each cell formatted exactly as the table renders it (same fmtMoney /
 * fmtPct / exposure precision).
 * @param {Array<{ticker:string,name:string,exposure:number,costBasis:number,marketValue:number,dayChange:number,dayPct:number,unrlGL:number,unrlPct:number}>} rows
 * @returns {string[][]}
 */
export function holdingsRowsToMatrix(rows) {
  const body = (rows || []).map(r => [
    r.ticker,
    r.name,
    r.exposure.toFixed(2) + '%',
    fmtMoney(r.costBasis),
    fmtMoney(r.marketValue),
    fmtMoney(r.dayChange, { signed: true }),
    fmtPct(r.dayPct),
    fmtMoney(r.unrlGL, { signed: true }),
    fmtPct(r.unrlPct),
  ]);
  return [EXPORT_HEADERS.slice(), ...body];
}

/**
 * Tab-separated rendering for the clipboard — pastes into Excel / Google
 * Sheets as columns and reads cleanly as plain text. Tabs / newlines
 * can't appear in our formatted cells, so no escaping is needed.
 * @param {string[][]} matrix
 */
export function matrixToTsv(matrix) {
  return (matrix || []).map(row => row.join('\t')).join('\n');
}

// ---- Minimal .xlsx writer (OOXML, stored / no compression) ----------

/** @param {string} s */
const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// A1-style column letters (1 → A, 27 → AA). Only 9 columns are needed
// here but keep it general so a future column can't silently overflow.
/** @param {number} n */
function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

/** @param {string[][]} matrix */
function sheetXml(matrix) {
  const rows = matrix.map((row, ri) => {
    const cells = row.map((val, ci) => {
      const ref = colLetter(ci + 1) + (ri + 1);
      // inlineStr so the cell reads exactly like the table — no number /
      // date coercion, no sharedStrings table to maintain.
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetData>${rows}</sheetData></worksheet>`;
}

const CONTENT_TYPES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '</Types>';

const ROOT_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  + '</Relationships>';

const WORKBOOK_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + '<sheets><sheet name="Holdings" sheetId="1" r:id="rId1"/></sheets></workbook>';

const WORKBOOK_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  + '</Relationships>';

/** @type {Uint32Array | null} */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
/** @param {Uint8Array} bytes */
function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {Uint8Array[]} arrs */
function concatBytes(arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}

/**
 * Pack named byte blobs into a STORED (uncompressed) ZIP — just enough of
 * the spec for Excel to open the result: per-file local headers, a
 * central directory and the end-of-central-directory record, each with a
 * CRC32. DOS mod time/date are stamped 0 (Excel doesn't care).
 * @param {Array<{name:string, data:Uint8Array}>} files
 * @returns {Uint8Array<ArrayBuffer>}
 */
function zipStore(files) {
  const enc = new TextEncoder();
  /** @param {number} n */ const u16 = (n) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);
  /** @param {number} n */ const u32 = (n) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  /** @type {Uint8Array[]} */ const localParts = [];
  /** @type {Uint8Array[]} */ const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
    ]);
    localParts.push(localHeader, nameBytes, f.data);

    const centralHeader = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset),
    ]);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + size;
  }

  const centralBytes = concatBytes(centralParts);
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(centralBytes.length), u32(offset), u16(0),
  ]);

  return concatBytes([...localParts, centralBytes, eocd]);
}

/**
 * Build a minimal but valid .xlsx workbook (single "Holdings" sheet,
 * every cell an inline string so the export reads exactly like the
 * table). Returns the raw bytes; the caller wraps them in a Blob.
 * (`Uint8Array<ArrayBuffer>`, not bare `Uint8Array`: since the TS 5.7
 * TypedArray generics, the bare form means ArrayBufferLike — which
 * BlobPart rejects because it includes SharedArrayBuffer.)
 * @param {string[][]} matrix
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function matrixToXlsx(matrix) {
  const enc = new TextEncoder();
  const files = [
    { name: '[Content_Types].xml',          data: enc.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels',                   data: enc.encode(ROOT_RELS_XML) },
    { name: 'xl/workbook.xml',               data: enc.encode(WORKBOOK_XML) },
    { name: 'xl/_rels/workbook.xml.rels',    data: enc.encode(WORKBOOK_RELS_XML) },
    { name: 'xl/worksheets/sheet1.xml',      data: enc.encode(sheetXml(matrix || [])) },
  ];
  return zipStore(files);
}
