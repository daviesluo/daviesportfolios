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
      r.date,
      r.ticker,
      r.kind === 'buy' ? 'BUY' : 'SELL',
      fmtShFor(r.shares, r.ticker),
      `${sym}${amt2(r.price)}`,
      `${sym}${amt2(r.shares * r.price)}`,
    ];
  });
  return [['Date', 'Symbol', 'Type', 'Shares', 'Price', 'Amount'], ...body];
}

function TransactionHistoryModal({ holdings, marketData, hideValues, onClose }) {
  const rows = React.useMemo(() => buildTransactionLog(holdings), [holdings]);
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
                <th className="hl-th hl-left">Date</th>
                <th className="hl-th hl-left">Symbol</th>
                <th className="hl-th hl-left">Type</th>
                <th className="hl-th hl-right">Shares</th>
                <th className="hl-th hl-right">Price</th>
                <th className="hl-th hl-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const sym = currencySymbol(r.currency);
                return (
                  <tr key={i}>
                    <td className="hl-left">{r.date}</td>
                    <td className="hl-left hl-sym"><span className="hl-ticker mono">{r.ticker}</span></td>
                    <td className="hl-left">
                      <span className={`txn-badge txn-${r.kind}`}>{r.kind === 'buy' ? 'BUY' : 'SELL'}</span>
                    </td>
                    <td className="hl-right">{fmtShFor(r.shares, r.ticker)}</td>
                    <td className="hl-right">{m(`${sym}${amt2(r.price)}`)}</td>
                    <td className="hl-right hl-strong">{m(`${sym}${amt2(r.shares * r.price)}`)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td className="hl-empty dim" colSpan={6}>No transactions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export { TransactionHistoryModal };
