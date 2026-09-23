// Sectors list — the same Yahoo-Finance-style sortable table as the
// Holding list, but the rows are GROUPED by tactics-board position (its
// sector). Each group header shows the board position label + sector name
// and the sector's aggregate columns; the member holdings sit beneath it.
// Reads straight off the live `metrics` object (same source as the board /
// heatmap / Holding list), so it's always in sync. Opened from the ☰ menu,
// directly below "Holding list"; clicking a symbol opens the ticker chart.
//
// Sort: default exposure desc, applied at BOTH levels — the sectors order
// by the column AND the holdings inside each sector order by the same
// column. Switching columns (or toggling direction) re-sorts both levels.
import React from 'react';
import { Modal } from '../board/modals.jsx';
import { fmtMoney as fmtM, fmtPct as fmtPc, pctColor as pctClr, maskDigits } from '../app/formatters.js';
import { COMPANY_NAMES, COLUMNS } from './holdings_list.jsx';
import { sectorGroupsToMatrix } from './holdings_export.js';
import { TableExportButtons } from './table_export.jsx';

/**
 * Group `metrics` into one entry per tactics-board position (sector). Cash
 * is excluded (matching the Holding list), so a cash-only / empty position
 * produces no group. Each group's aggregate columns are summed from its
 * member rows so the header totals exactly equal the rows shown beneath it.
 *
 * @param {any} metrics  computeMetrics output
 * @param {Record<string,string>} [names]  ticker → company name
 * @returns {Array<{key:string,label:string,subtitle:string,role:string,agg:any,rows:any[]}>}
 */
export function buildSectorGroups(metrics, names = COMPANY_NAMES) {
  if (!metrics || !metrics.positions) return [];
  const total = metrics.marketValue || 0;
  /** @type {any[]} */
  const groups = [];
  for (const [key, posAny] of Object.entries(metrics.positions)) {
    const pos = /** @type {any} */ (posAny);
    /** @type {any[]} */
    const rows = [];
    for (const p of (pos.players || [])) {
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
    if (rows.length === 0) continue; // skip empty / cash-only positions
    /** @param {(r:any)=>number} f */
    const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
    const marketValue = sum(r => r.marketValue);
    const costBasis = sum(r => r.costBasis);
    const dayChange = sum(r => r.dayChange);
    const prevMV = marketValue - dayChange; // day-change baseline
    const unrlGL = marketValue - costBasis;
    groups.push({
      key,
      label: pos.label || key,
      subtitle: pos.subtitle || '',
      role: pos.role || '',
      agg: {
        exposure: total > 0 ? (marketValue / total) * 100 : 0,
        costBasis,
        marketValue,
        dayChange,
        dayPct: prevMV > 0 ? (dayChange / prevMV) * 100 : 0,
        unrlGL,
        unrlPct: costBasis > 0 ? (unrlGL / costBasis) * 100 : 0,
      },
      rows,
    });
  }
  return groups;
}

/**
 * Sort groups by a column + direction at BOTH levels: the sector order
 * (by the group's aggregate of that column) and the holdings inside each
 * sector (by the same column). The Symbol column sorts text — sectors by
 * "label subtitle", rows by ticker; every other column sorts numerically.
 * Returns a new array with new row arrays (never mutates the input).
 *
 * @param {ReturnType<typeof buildSectorGroups>} groups
 * @param {string} key
 * @param {'asc'|'desc'} dir
 */
export function sortSectorGroups(groups, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  const isText = key === 'ticker';
  const groupVal = (/** @type {any} */ g) => isText ? `${g.label} ${g.subtitle}` : (g.agg[key] || 0);
  const rowVal = (/** @type {any} */ r) => isText ? r.ticker : (r[key] || 0);
  const cmp = (/** @type {any} */ a, /** @type {any} */ b) => isText
    ? sign * String(a).localeCompare(String(b))
    : sign * ((a || 0) - (b || 0));
  return [...groups]
    .map(g => ({ ...g, rows: [...g.rows].sort((a, b) => cmp(rowVal(a), rowVal(b))) }))
    .sort((a, b) => cmp(groupVal(a), groupVal(b)));
}

function SectorsListModal({ metrics, hideValues, onTickerClick, onClose }) {
  // Default: exposure %, high → low — at both the sector and holding level.
  const [sortKey, setSortKey] = React.useState('exposure');
  const [sortDir, setSortDir] = React.useState(/** @type {'asc'|'desc'} */ ('desc'));

  const groups = React.useMemo(() => buildSectorGroups(metrics), [metrics]);
  const sorted = React.useMemo(() => sortSectorGroups(groups, sortKey, sortDir), [groups, sortKey, sortDir]);

  const onHeaderClick = (col) => {
    if (col.key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir(col.numeric ? 'desc' : 'asc');
    }
  };
  const arrow = (col) => (col.key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const money = (n, opts) => (hideValues ? maskDigits(fmtM(n, opts)) : fmtM(n, opts));

  // Export mirrors the Holding list (real values; the hide-values mask is a
  // screen-only overlay) — a flat table with a leading Sector column so the
  // xlsx column-header autofilter works across the grouping.
  const canExport = groups.length > 0;

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <h2 className="modal-title mono">Sectors list</h2>
        </div>
        <div className="modal-head-actions">
          <TableExportButtons getMatrix={() => sectorGroupsToMatrix(sorted)} filenameBase="sectors" disabled={!canExport} />
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
              {sorted.map(g => (
                <React.Fragment key={g.key}>
                  <tr className="hl-sector-row">
                    <td className="hl-left hl-sector-name">
                      <span className="hl-sector-pos mono">{g.label}</span>
                      {g.subtitle && <span className="hl-sector-sub"> · {g.subtitle}</span>}
                    </td>
                    <td className="hl-right hl-strong">{g.agg.exposure.toFixed(2)}%</td>
                    <td className="hl-right">{money(g.agg.costBasis)}</td>
                    <td className="hl-right hl-strong">{money(g.agg.marketValue)}</td>
                    <td className="hl-right" style={{ color: pctClr(g.agg.dayPct) }}>
                      <div>{money(g.agg.dayChange, { signed: true })}</div>
                      <div className="hl-sub">{fmtPc(g.agg.dayPct)}</div>
                    </td>
                    <td className="hl-right" style={{ color: pctClr(g.agg.unrlPct) }}>
                      <div>{money(g.agg.unrlGL, { signed: true })}</div>
                      <div className="hl-sub">{fmtPc(g.agg.unrlPct)}</div>
                    </td>
                  </tr>
                  {g.rows.map(r => (
                    <tr key={`${g.key}|${r.ticker}`} className="hl-sector-member">
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
                </React.Fragment>
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

export { SectorsListModal };
