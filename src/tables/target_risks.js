// The "Target price" page's Key risks column: a few words per holding, kept by hand in this file (Davies, 2026-10-21,
// who gave the first five). Keyed by the ticker the page shows (`displayTicker`: SIVE, not 2DG.SG).
//
// Each note is a string, or a function of the row for a figure that must stay true as the price moves (RKLB's lowest
// target against its price is computed, never written down). A note tied to a date carries `until` (a New York date,
// YYYY-MM-DD): it is shown through that day and drops out after it, so an investor day or an earnings date never
// lingers once it has passed. To change a note, edit this file; the page has no editor.

/**
 * @typedef {{ low: number | null, price: number | null, lowVsPrice: number | null }} RiskRow
 * @typedef {{ text: string | ((row: RiskRow) => string | null), until?: string }} RiskNote
 */

/** @param {number} n */
const usd = (n) => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : Number(n.toFixed(2)).toString()}`;

/** @type {Record<string, RiskNote[]>} */
export const TARGET_RISKS = {
  ORCL: [
    { text: 'BBB− rated' },
    { text: 'net debt ~$132B' },
    { text: 'investor day 10/28', until: '2026-10-28' },
  ],
  RKLB: [
    { text: 'Net cash' },
    // Davies's words: "lowest target $67 still 21% above price", worked out from the row instead of written down.
    {
      text: (r) => {
        if (r.low == null || r.lowVsPrice == null) return null;
        const pct = Math.round(Math.abs(r.lowVsPrice));
        return r.lowVsPrice >= 0 ? `lowest target ${usd(r.low)} still ${pct}% above price` : `lowest target ${usd(r.low)} ${pct}% below price`;
      },
    },
    { text: 'earnings 11/9', until: '2026-11-09' },
  ],
  // The expiry starts on 10/22 and its shares come free from then; shown for a month after (a question for Davies:
  // whether it should stay longer).
  SPCX: [{ text: 'Lock-up expiry from 10/22: up to 1.31B shares', until: '2026-11-22' }],
  NBIS: [{ text: 'Average target inflated by stale targets' }, { text: 'convertible financing' }],
  SIVE: [{ text: 'Only Redeye (paid) covers it' }, { text: 'public short report' }],
};

/**
 * Today's date in New York, YYYY-MM-DD.
 * @param {number} nowMs
 */
export function nyDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowMs);
}

/**
 * The notes for one holding as shown on `nowMs`, joined with "; ", or "" when it has none.
 * @param {string} display @param {RiskRow} row @param {number} nowMs @param {Record<string, RiskNote[]>} [map]
 */
export function risksFor(display, row, nowMs, map = TARGET_RISKS) {
  const today = nyDate(nowMs);
  const parts = [];
  for (const n of map[display] || []) {
    if (n.until && today > n.until) continue;
    const t = typeof n.text === 'function' ? n.text(row) : n.text;
    if (t) parts.push(t);
  }
  return parts.join('; ');
}
