// Holdings list — a Yahoo-Finance-style sortable table of every
// holding, opened from the header's ☰ menu. Reads straight off the
// live `metrics` object (same source as the tactics board + heatmap),
// so it's always in sync and needs no fetch of its own — clicking a
// symbol opens the ticker chart modal (whose data is already
// prefetched). Columns: Symbol (+ company name), Exposure %, Cost
// Basis, Market Value, Day Change ($ / %), Unrealized G/L ($ / %).
import React from 'react';
import { Modal } from './modals.jsx';
import { fmtMoney as fmtM, fmtPct as fmtPc, pctColor as pctClr, maskDigits } from './formatters.js';
import { holdingsRowsToMatrix, matrixToTsv, matrixToXlsx } from './holdings_export.js';

// Monochrome inline icons (currentColor) for the header copy / download /
// done buttons — SVG rather than a Unicode glyph so they never render as
// tofu and match the chalk theme's stroke colour + hover states.
const ICON_SVG = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: /** @type {const} */ ('round'), strokeLinejoin: /** @type {const} */ ('round'), 'aria-hidden': true };
const IconCopy = () => (
  <svg {...ICON_SVG}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
const IconDownload = () => (
  <svg {...ICON_SVG}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);
const IconCheck = () => (
  <svg {...ICON_SVG}><polyline points="20 6 9 17 4 12" /></svg>
);

// Company names for the holdings table's secondary line. Static map —
// the app has no client-side name source for equities (Yahoo provides
// them but threading a name through the chart/fundamentals pipelines
// for one cosmetic column isn't worth the risk). Unknown tickers fall
// back to "--" (matching the Yahoo reference, where a name it lacks
// shows "--"). Extend this map as holdings change.
export const COMPANY_NAMES = {
  'NVDA': 'NVIDIA Corporation',
  'AVGO': 'Broadcom Inc.',
  'APLD': 'Applied Digital Corporation',
  'NBIS': 'Nebius Group',
  'GOOG': 'Alphabet Inc.',
  'SPAX.PVT': 'SpaceX',
  'ORCL': 'Oracle Corporation',
  'META': 'Meta Platforms, Inc.',
  'AAPL': 'Apple Inc.',
  'NFLX': 'Netflix, Inc.',
  'CEG': 'Constellation Energy',
  'MSFT': 'Microsoft Corporation',
  'MSTR': 'Strategy (MicroStrategy)',
  'AMZN': 'Amazon.com, Inc.',
  'BX': 'Blackstone Inc.',
  'RKLB': 'Rocket Lab Corporation',
  'SATS': 'EchoStar Corporation',
  'BTC-USD': 'Bitcoin',
  'CRWV': 'CoreWeave, Inc.',
  'TEM': 'Tempus AI, Inc.',
  'HOOD': 'Robinhood Markets',
  'TSM': 'Taiwan Semiconductor',
  'SOUN': 'SoundHound AI',
  'NVTS': 'Navitas Semiconductor',
  'MU': 'Micron Technology',
  'UBER': 'Uber Technologies',
  'NET': 'Cloudflare, Inc.',
  'IREN': 'IREN Limited',
  'ANET': 'Arista Networks',
  'TSLA': 'Tesla, Inc.',
  'BMNR': 'Bitmine Immersion',
  'VRT': 'Vertiv Holdings',
  'VST': 'Vistra Corp.',
  'BRK-B': 'Berkshire Hathaway',
};

/**
 * Flatten `metrics` into one row per holding (cash excluded). Each row
 * carries the pre-computed USD figures the table needs. `exposure` is
 * the holding's share of the TOTAL portfolio market value (incl. cash,
 * matching `metrics.marketValue`), so the column sums to <100% just
 * like the Yahoo reference.
 *
 * @param {any} metrics  computeMetrics output
 * @param {Record<string,string>} [names]  ticker → company name
 * @returns {Array<{ticker,name,exposure,costBasis,marketValue,dayChange,dayPct,unrlGL,unrlPct}>}
 */
export function buildHoldingsRows(metrics, names = COMPANY_NAMES) {
  if (!metrics || !metrics.positions) return [];
  const total = metrics.marketValue || 0;
  /** @type {any[]} */
  const rows = [];
  for (const pos of Object.values(metrics.positions)) {
    for (const p of (/** @type {any} */ (pos).players || [])) {
      if (p.isCash || p.ticker === 'CASH') continue;
      const mv = p.marketValue || 0;
      const costBasis = (typeof p.shares === 'number' && typeof p.cost === 'number')
        ? p.shares * p.cost * (p.fx || 1)
        : 0;
      rows.push({
        ticker: p.ticker,
        name: names[p.ticker] || '--',
        exposure: total > 0 ? (mv / total) * 100 : 0,
        costBasis,
        marketValue: mv,
        dayChange: p.dayChange || 0,
        dayPct: p.dayPct || 0,
        unrlGL: mv - costBasis,
        unrlPct: costBasis > 0 ? ((mv - costBasis) / costBasis) * 100 : 0,
      });
    }
  }
  return rows;
}

/**
 * Sort rows by a column key + direction. `ticker` / `name` sort
 * lexically; everything else numerically. Stable-ish (JS sort) — ties
 * keep input order which is position order. Returns a new array.
 *
 * @param {ReturnType<typeof buildHoldingsRows>} rows
 * @param {string} key
 * @param {'asc'|'desc'} dir
 */
export function sortHoldingsRows(rows, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  const isText = key === 'ticker' || key === 'name';
  return [...rows].sort((a, b) => {
    const av = /** @type {any} */ (a)[key], bv = /** @type {any} */ (b)[key];
    if (isText) return sign * String(av).localeCompare(String(bv));
    return sign * ((av || 0) - (bv || 0));
  });
}

// Column definitions: key + header label + numeric flag (drives the
// default sort direction when the column is first clicked).
const COLUMNS = [
  { key: 'ticker',      label: 'Symbol',          numeric: false, align: 'left' },
  { key: 'exposure',    label: 'Exposure',        numeric: true,  align: 'right' },
  { key: 'costBasis',   label: 'Cost Basis',      numeric: true,  align: 'right' },
  { key: 'marketValue', label: 'Market Value',    numeric: true,  align: 'right' },
  { key: 'dayChange',   label: 'Day Change',      numeric: true,  align: 'right' },
  { key: 'unrlGL',      label: 'Unrealized G/L',  numeric: true,  align: 'right' },
];

function HoldingsListModal({ metrics, hideValues, onTickerClick, onClose }) {
  // Default: exposure %, high → low.
  const [sortKey, setSortKey] = React.useState('exposure');
  const [sortDir, setSortDir] = React.useState(/** @type {'asc'|'desc'} */ ('desc'));

  const rows = React.useMemo(() => buildHoldingsRows(metrics), [metrics]);
  const sorted = React.useMemo(() => sortHoldingsRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  const onHeaderClick = (col) => {
    if (col.key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      // Numbers default to high→low (desc); text defaults to A→Z (asc).
      setSortDir(col.numeric ? 'desc' : 'asc');
    }
  };
  const arrow = (col) => (col.key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const money = (n, opts) => (hideValues ? maskDigits(fmtM(n, opts)) : fmtM(n, opts));

  // Copy / download export the table EXACTLY as displayed (header + every
  // row, current sort order) with real values — the hide-values mask is a
  // screen-only privacy overlay, not data. Disabled when there's nothing
  // to export.
  const [copied, setCopied] = React.useState(false);
  const canExport = sorted.length > 0;

  const onCopy = async () => {
    if (!canExport) return;
    const tsv = matrixToTsv(holdingsRowsToMatrix(sorted));
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(tsv); ok = true; } catch { /* fall through to legacy path */ }
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = tsv; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };

  const onDownload = () => {
    if (!canExport) return;
    const bytes = matrixToXlsx(holdingsRowsToMatrix(sorted));
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holdings-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">HOLDINGS</div>
          <h2 className="modal-title mono">Holding list</h2>
        </div>
        <div className="modal-head-actions">
          <button className="btn-ghost icon" onClick={onCopy} disabled={!canExport}
            aria-label="Copy table including header" title={copied ? 'Copied' : 'Copy table (incl. header)'}>
            {copied ? <IconCheck /> : <IconCopy />}
          </button>
          <button className="btn-ghost icon" onClick={onDownload} disabled={!canExport}
            aria-label="Download as Excel" title="Download as Excel (.xlsx)">
            <IconDownload />
          </button>
          <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>

      <div className="modal-body">
        <div className="hl-scroll">
          <table className="hl-table mono">
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={`hl-th hl-${col.align}${col.key === sortKey ? ' hl-sorted' : ''}`}
                    onClick={() => onHeaderClick(col)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeaderClick(col); } }}
                    title={`Sort by ${col.label}`}
                  >{col.label}{arrow(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.ticker}>
                  <td className="hl-left hl-sym">
                    <button className="hl-ticker-btn" onClick={() => onTickerClick(r.ticker)} title={`Open ${r.ticker}`}>
                      <span className="hl-ticker mono">{r.ticker}</span>
                      <span className="hl-name">{r.name}</span>
                    </button>
                  </td>
                  <td className="hl-right hl-strong">{r.exposure.toFixed(2)}%</td>
                  <td className="hl-right">{money(r.costBasis)}</td>
                  <td className="hl-right hl-strong">{money(r.marketValue)}</td>
                  <td className="hl-right" style={{ color: pctClr(r.dayPct) }}>
                    <div>{money(r.dayChange, { signed: true })}</div>
                    <div className="hl-sub">{fmtPc(r.dayPct)}</div>
                  </td>
                  <td className="hl-right" style={{ color: pctClr(r.unrlPct) }}>
                    <div>{money(r.unrlGL, { signed: true })}</div>
                    <div className="hl-sub">{fmtPc(r.unrlPct)}</div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td className="hl-empty dim" colSpan={COLUMNS.length}>No holdings.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export { HoldingsListModal };
