// Target price — every holding beside its analyst targets, opened from the header's ☰ menu after Sectors list
// (Davies, 2026-10-21). Laid out as the Holding list is (its `.hl-*` table, the Symbol column frozen while the table
// scrolls sideways), without the company's name. The rows and every figure come from target_price.js; the targets from
// the copy the app preloaded (targets_data.js), so the page opens drawn and refreshes behind if that copy is old.
// Nothing here is the owner's money but the Weight, which the Holding list shows unmasked too (its Exposure).
import React from 'react';
import { Modal } from '../board/modals.jsx';
import { dropDot00, fmtPct, fmtPrice, pctColor } from '../app/formatters.js';
import { buildTargetRows, DEFAULT_SORT, firstSortDir, fmtRange, kindTag, sortTargetRows, strategistTitle, TARGET_COLUMNS, updatedLabel } from './target_price.js';
import { fetchTargets, onTargets, readTargetsCache, TARGETS_TTL_MS } from './targets_data.js';

const DASH = '—';

/** A price or a target as the board writes one, less a trailing ".00" (targets are mostly round). @param {number} n */
const fig = (n) => dropDot00(fmtPrice(n));

/** A price or target, with its currency's code when it is not the dollar. @param {number | null} n @param {string | null} cur */
function money(n, cur) {
  if (n == null) return DASH;
  return <>{fig(n)}{cur && cur !== 'USD' ? <span className="tp-cur">{cur}</span> : null}</>;
}

/** The tag under a symbol whose targets are not a stock's consensus, with where they come from on hover. @param {{ row: any }} p */
function KindTag({ row }) {
  const t = kindTag(row);
  if (!t) return null;
  return (
    <span className="tp-tag-wrap" title={t.title}>
      <span className="tp-tag">{t.text}</span>
      {t.note ? <span className="tp-tag-note">{t.note}</span> : null}
    </span>
  );
}

/**
 * @param {{ metrics: any, onTickerClick: (t: string) => void, onClose: () => void }} props
 */
function TargetPriceModal({ metrics, onTickerClick, onClose }) {
  const [sort, setSort] = React.useState(DEFAULT_SORT);
  const [copy, setCopy] = React.useState(() => readTargetsCache());
  const [state, setState] = React.useState(/** @type {'idle' | 'reading' | 'failed'} */ ('idle'));

  // A new copy landing (the preload, or the refresh below) redraws the page; an old one is asked for again behind it.
  React.useEffect(() => {
    const off = onTargets(() => setCopy(readTargetsCache()));
    const have = readTargetsCache();
    if (have !== copy) setCopy(have);
    if (!have || Date.now() - have.at >= TARGETS_TTL_MS) {
      if (!have) setState('reading');
      fetchTargets().then((c) => { if (!c && !readTargetsCache()) setState('failed'); else setState('idle'); });
    }
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nowMs = Date.now();
  const rows = React.useMemo(() => buildTargetRows(metrics, copy?.data, nowMs), [metrics, copy]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = React.useMemo(() => sortTargetRows(rows, sort.key, sort.dir), [rows, sort]);
  const updated = updatedLabel(copy?.data?.asOf, nowMs);

  /** @param {typeof TARGET_COLUMNS[number]} col */
  const onHeader = (col) => {
    if (!col.sortKey) return;
    const key = /** @type {string} */ (col.sortKey);
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstSortDir(col) }));
  };

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <h2 className="modal-title mono">Target price</h2>
          <div className="tp-meta mono">
            {updated ? (<><span className="tp-updated" title="When the scheduled job last read the targets, ratings, ranges and analysts">{updated}</span>
              <span className="tp-live"> · Weight, Price and Avg vs price live</span></>)
              : state === 'failed' ? <span>Targets could not be read</span>
              : state === 'reading' ? <span>Reading targets…</span> : null}
          </div>
        </div>
        <div className="modal-head-actions">
          <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>

      <div className="modal-body">
        <div className="hl-scroll tp-scroll">
          <table className="hl-table tp-table mono">
            <thead>
              <tr>
                {TARGET_COLUMNS.map((col) => {
                  const on = col.sortKey === sort.key;
                  const sortable = !!col.sortKey;
                  return (
                    <th
                      key={col.key}
                      className={`hl-th hl-${col.align} tp-col-${col.key}${on ? ' hl-sorted' : ''}${sortable ? '' : ' tp-th-static'}`}
                      onClick={sortable ? () => onHeader(col) : undefined}
                      role={sortable ? 'button' : undefined}
                      tabIndex={sortable ? 0 : undefined}
                      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      onKeyDown={sortable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeader(col); } } : undefined}
                      title={col.title}
                    >{col.label}{on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.ticker} className={r.kind ? '' : 'tp-uncovered'} title={r.kind === 'strategist' ? strategistTitle(r) : undefined}>
                  <td className="hl-left hl-sym tp-sym">
                    <button className="hl-ticker-btn" onClick={() => onTickerClick(r.ticker)} title={`Open ${r.display}`}>
                      <span className="hl-ticker mono">{r.display}</span>
                    </button>
                    <KindTag row={r} />
                  </td>
                  <td className="hl-right hl-strong">{`${r.weight.toFixed(2)}%`}</td>
                  <td className="hl-right">{money(r.price, r.currency)}</td>
                  <td className="hl-right">
                    <div className="hl-strong">{money(r.mean, r.targetCurrency)}</div>
                  </td>
                  <td className="hl-right">
                    {r.rating != null ? (<><div>{r.rating.toFixed(2)}</div><div className="hl-sub tp-word">{r.ratingWord}</div></>) : <span className="dim">{DASH}</span>}
                  </td>
                  <td className="hl-right tp-range">{r.low != null && r.high != null ? fmtRange(r.low, r.high) : DASH}</td>
                  <td className="hl-right" title={r.kind === 'holdings' ? 'The median of the covered holdings\' analyst counts' : r.kind === 'strategist' ? 'Firms in the hand-kept table' : undefined}>
                    {r.analysts != null ? (r.kind === 'holdings' ? `~${r.analysts}` : r.analysts) : DASH}
                  </td>
                  <td className="hl-right tp-range">
                    {r.fresh ? (<><div>{fmtRange(r.fresh.low, r.fresh.high)}</div>
                      <div className="hl-sub tp-word">{r.fresh.count} {r.fresh.count === 1 ? 'target' : 'targets'}</div></>)
                      : r.kind === 'holdings' ? <span className="dim" title="The fund's holdings have no dated targets to read a 30-day window from">{DASH}</span>
                      : r.kind ? <span className="dim" title="No target set in the last 30 days">none in 30d</span> : DASH}
                  </td>
                  <td className="hl-right hl-strong" style={{ color: r.avgVsPrice != null ? pctColor(r.avgVsPrice) : undefined }}>
                    {r.avgVsPrice != null ? fmtPct(r.avgVsPrice, { precision: 1 }) : DASH}
                  </td>
                  <td className="hl-left tp-risks">{r.risks || ''}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td className="hl-empty dim" colSpan={TARGET_COLUMNS.length}>No holdings.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="tp-foot dim">
          Stocks: the analysts&apos; consensus as Yahoo Finance serves it. Funds: their largest holdings&apos; targets, weighted
          (hover the tag for the coverage). Bitcoin: bank targets kept by hand. Fresh range counts targets set in the last
          30 days. Weight, Price and Avg vs price move with the board; the other columns are refreshed at 04:00, 09:30 and
          the close ET on trading days, 09:30 ET on other days.
        </p>
      </div>
    </Modal>
  );
}

export { TargetPriceModal };
