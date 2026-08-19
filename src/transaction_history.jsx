// Transaction History modal — a chronological ledger (most recent first)
// of every buy lot + sell record across ALL holdings, INCLUDING closed
// positions (net 0, taken off the board but kept in portfolio.holdings).
// Opened from the ☰ menu, directly below "Holding list". Headline: the
// total Realized G/L (USD) banked across every sale. Reads `holdings`
// straight off the portfolio (not `metrics`), so closed positions still
// show their history. Prices / amounts render in each holding's native
// currency; the masked-values toggle hides the money columns.
import React from 'react';
import { Modal } from './modals.jsx';
import { fmtMoney as fmtM, fmtSharesFor as fmtShFor, pctColor as pctClr, maskDigits } from './formatters.js';
import { currencySymbol, fxRateToUSD } from './fx.js';
import { buildTransactionLog, totalRealizedUsd } from './transactions.js';
import { TableExportButtons } from './table_export.jsx';

/** @param {number} n  native amount → 2dp with thousands separators (no symbol) */
const amt2 = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The ledger as a 2D string matrix (header + rows) for the copy / download
 * buttons — formatted exactly like the on-screen table (native-currency
 * price + amount). Real values; the hide-values mask is screen-only.
 * @param {import('./transactions.js').TxnRow[]} rows
 * @returns {string[][]}
 */
export function transactionRowsToMatrix(rows) {
  const body = (rows || []).map((r) => {
    const sym = currencySymbol(r.currency);
    return [
      r.kind === 'buy' ? 'BUY' : 'SELL',
      r.date,
      r.ticker,
      fmtShFor(r.shares, r.ticker),
      `${sym}${amt2(r.price)}`,
      `${sym}${amt2(r.shares * r.price)}`,
      avgCostText(r, sym),
      realizedText(r, sym),
    ];
  });
  return [['Type', 'Date', 'Symbol', 'Shares', 'Price', 'Amount', 'Avg Cost', 'Realised G/L'], ...body];
}

/**
 * What the position cost per share once this row had happened. A sale
 * changes it too — the cash it returns comes off the basis of what's
 * left — so the column reads for both kinds, which is the point of it.
 * Blank once a position is fully closed: nothing left to have a cost.
 * @param {import('./transactions.js').TxnRow} r
 * @param {string} sym
 */
export function avgCostText(r, sym) {
  return typeof r.acAfter === 'number' && r.acAfter > 0 ? `${sym}${amt2(r.acAfter)}` : '';
}

/**
 * What a sale banked, and the percent it made on what those shares cost.
 * Empty on a purchase — a buy realizes nothing.
 * @param {import('./transactions.js').TxnRow} r
 * @param {string} sym
 */
export function realizedText(r, sym) {
  if (r.kind !== 'sell' || typeof r.gain !== 'number') return '';
  const g = `${r.gain >= 0 ? '+' : '-'}${sym}${amt2(Math.abs(r.gain))}`;
  return typeof r.gainPct === 'number'
    ? `${g} (${r.gainPct >= 0 ? '+' : ''}${r.gainPct.toFixed(2)}%)`
    : g;
}

// Column order and how each one sorts. `key` reads the value to compare;
// a string key sorts lexically, a number key numerically.
const COLUMNS = [
  { id: 'type',    label: 'Type',     align: 'hl-left',  key: (/** @type {any} */ r) => r.kind },
  { id: 'date',    label: 'Date',     align: 'hl-left',  key: (/** @type {any} */ r) => `${r.date} ${String(r.ts ?? 0).padStart(16, '0')}` },
  { id: 'symbol',  label: 'Symbol',   align: 'hl-left',  key: (/** @type {any} */ r) => r.ticker },
  { id: 'shares',  label: 'Shares',   align: 'hl-right', key: (/** @type {any} */ r) => r.shares },
  { id: 'price',   label: 'Price',    align: 'hl-right', key: (/** @type {any} */ r) => r.price },
  { id: 'amount',  label: 'Amount',   align: 'hl-right', key: (/** @type {any} */ r) => r.shares * r.price },
  { id: 'avgcost', label: 'Avg Cost',     align: 'hl-right', key: (/** @type {any} */ r) => r.acAfter ?? 0 },
  // Purchases realize nothing, so they sort as zero and settle between
  // the profitable sales and the losing ones — which is where a row that
  // banked nothing belongs.
  { id: 'gain',    label: 'Realised G/L', align: 'hl-right', key: (/** @type {any} */ r) => (r.kind === 'sell' ? (r.gain ?? 0) : 0) },
];

/**
 * Sort rows by one column, or hand back the default order untouched.
 *
 * Three states per header rather than two: descending, ascending, then
 * back to the chronological order the log is built in. Without the third
 * there is no way back to "most recent first" once you've sorted by
 * anything else, short of closing the modal.
 *
 * @template {Record<string, any>} T
 * @param {T[]} rows
 * @param {{col: string, dir: 'desc'|'asc'} | null} sort
 * @returns {T[]}
 */
export function sortTransactionRows(rows, sort) {
  if (!sort) return rows;
  const col = COLUMNS.find((c) => c.id === sort.col);
  if (!col) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const ka = col.key(a), kb = col.key(b);
    const cmp = typeof ka === 'number' && typeof kb === 'number'
      ? ka - kb
      : String(ka).localeCompare(String(kb));
    return cmp * sign;
  });
}

/** desc → asc → off, then round again. */
export function nextSortState(sort, colId) {
  if (!sort || sort.col !== colId) return { col: colId, dir: /** @type {const} */ ('desc') };
  if (sort.dir === 'desc') return { col: colId, dir: /** @type {const} */ ('asc') };
  return null;
}

function TransactionHistoryModal({ holdings, marketData, hideValues, onClose }) {
  const log = React.useMemo(() => buildTransactionLog(holdings), [holdings]);
  /** @type {[{col: string, dir: 'desc'|'asc'} | null, Function]} */
  const [sort, setSort] = React.useState(/** @type {any} */ (null));
  const rows = React.useMemo(() => sortTransactionRows(log, sort), [log, sort]);
  const realizedUsd = React.useMemo(
    () => totalRealizedUsd(holdings, (cur) => fxRateToUSD(cur, marketData).rate),
    [holdings, marketData],
  );
  const m = (s) => (hideValues ? maskDigits(s) : s);

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">TRANSACTIONS</div>
          <h2 className="modal-title mono">Transaction history</h2>
        </div>
        <div className="modal-head-actions">
          <TableExportButtons getMatrix={() => transactionRowsToMatrix(rows)} filenameBase="transactions" disabled={rows.length === 0} />
          <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>

      <div className="modal-body">
        <div className="txn-realized">
          <span className="lot-summary-label mono">TOTAL REALIZED G/L (USD)</span>
          <span className="txn-realized-val mono" style={{ color: pctClr(realizedUsd) }}>
            {m(fmtM(realizedUsd, { signed: true }))}
          </span>
        </div>

        <div className="hl-scroll">
          <table className="hl-table mono">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.id}
                    className={`hl-th ${c.align} hl-th-sortable`}
                    onClick={() => setSort(nextSortState(sort, c.id))}
                    title="Sort descending, ascending, then back to newest first"
                  >
                    {c.label}
                    <span className="hl-sort-arrow">
                      {sort?.col === c.id ? (sort.dir === 'desc' ? '▼' : '▲') : ''}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const sym = currencySymbol(r.currency);
                return (
                  <tr key={i}>
                    <td className="hl-left">
                      <span className={`txn-badge txn-${r.kind}`}>{r.kind === 'buy' ? 'BUY' : 'SELL'}</span>
                    </td>
                    <td className="hl-left">{r.date}</td>
                    <td className="hl-left hl-sym"><span className="hl-ticker mono">{r.ticker}</span></td>
                    <td className="hl-right">{fmtShFor(r.shares, r.ticker)}</td>
                    <td className="hl-right">{m(`${sym}${amt2(r.price)}`)}</td>
                    <td className="hl-right hl-strong">{m(`${sym}${amt2(r.shares * r.price)}`)}</td>
                    <td className="hl-right">{m(avgCostText(r, sym))}</td>
                    <td
                      className="hl-right"
                      style={r.kind === 'sell' ? { color: pctClr(r.gain ?? 0) } : undefined}
                    >{m(realizedText(r, sym))}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td className="hl-empty dim" colSpan={COLUMNS.length}>No transactions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export { TransactionHistoryModal };
