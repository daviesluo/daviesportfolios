// Target price — every holding beside its analyst targets, opened from the header's ☰ menu after Sectors list
// (Davies, 2026-10-21). Laid out as the Holding list is (its `.hl-*` table, the Symbol column frozen while the table
// scrolls sideways), without the company's name. The rows and every figure come from target_price.js; the targets from
// the copy the app preloaded (targets_data.js), so the page opens drawn and refreshes behind if that copy is old.
// Nothing here is the owner's money but the Weight, which the Holding list shows unmasked too (its Exposure).
import React from 'react';
import { Modal } from '../board/modals.jsx';
import { fmtPct, pctColor } from '../app/formatters.js';
import { buildTargetRows, DEFAULT_SORT, firstSortDir, fmtMoneyIn, fmtRange, kindTag, sortTargetRows, strategistTitle, TARGET_COLUMNS, updatedLabel } from './target_price.js';
import { fetchTargets, onTargets, readTargetsCache, targetsFresh } from './targets_data.js';

const DASH = '—';

/**
 * The small mark under a symbol whose targets are not a stock's consensus ("HW 36%", "BANKS"). Hovering it says where
 * the targets come from; tapping it (a phone has no hover) opens the same words in a line under the row, and closes it.
 * @param {{ row: any, open: boolean, onToggle: () => void }} p
 */
function KindTag({ row, open, onToggle }) {
  const t = kindTag(row);
  if (!t) return null;
  return (
    <span className="tp-tag-wrap">
      <button type="button" className={`tp-tag${open ? ' on' : ''}`} title={t.title} aria-label={`${t.text}: ${t.title}`} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}>{t.mark}</button>
      {t.note ? <span className="tp-tag-note">{t.note}</span> : null}
    </span>
  );
}

/**
 * @param {{ metrics: any, onTickerClick: (t: string) => void, onClose: () => void }} props
 */
function TargetPriceModal({ metrics, onTickerClick, onClose }) {
  const [sort, setSort] = React.useState(DEFAULT_SORT);
  /** The row whose mark was tapped open, if any. */
  const [detail, setDetail] = React.useState(/** @type {string | null} */ (null));
  const [copy, setCopy] = React.useState(() => readTargetsCache());
  const [state, setState] = React.useState(/** @type {'idle' | 'reading' | 'failed'} */ ('idle'));

  // A new copy landing (the preload, or the refresh below) redraws the page; an old one is asked for again behind it.
  React.useEffect(() => {
    const off = onTargets(() => setCopy(readTargetsCache()));
    const have = readTargetsCache();
    if (have !== copy) setCopy(have);
    if (!targetsFresh(have, Date.now())) {
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
                <React.Fragment key={r.ticker}>
                <tr className={r.kind ? '' : 'tp-uncovered'} title={r.kind === 'strategist' ? strategistTitle(r) : undefined}>
                  <td className="hl-left hl-sym tp-sym">
                    <button className="hl-ticker-btn" onClick={() => onTickerClick(r.ticker)} title={`Open ${r.display}`}>
                      <span className="hl-ticker mono">{r.display}</span>
                    </button>
                    <KindTag row={r} open={detail === r.ticker} onToggle={() => setDetail((d) => (d === r.ticker ? null : r.ticker))} />
                  </td>
                  <td className="hl-right hl-strong">{`${r.weight.toFixed(2)}%`}</td>
                  <td className="hl-right">{fmtMoneyIn(r.price, r.currency)}</td>
                  <td className="hl-right">
                    <div className="hl-strong">{fmtMoneyIn(r.mean, r.targetCurrency)}</div>
                  </td>
                  <td className="hl-right">
                    {r.rating != null ? (<><div>{r.rating.toFixed(2)}</div><div className="hl-sub tp-word">{r.ratingWord}</div></>) : <span className="dim">{DASH}</span>}
                  </td>
                  <td className="hl-right tp-range">{r.low != null && r.high != null ? fmtRange(r.low, r.high, r.targetCurrency) : DASH}</td>
                  <td className="hl-right" title={r.kind === 'holdings' ? 'The median of the covered holdings\' analyst counts' : r.kind === 'strategist' ? 'Firms in the hand-kept table' : undefined}>
                    {r.analysts != null ? (r.kind === 'holdings' ? `~${r.analysts}` : r.analysts) : DASH}
                  </td>
                  <td className="hl-right tp-range">
                    {r.fresh ? (<><div>{fmtRange(r.fresh.low, r.fresh.high, r.targetCurrency)}</div>
                      <div className="hl-sub tp-word">{r.fresh.count} {r.fresh.count === 1 ? 'target' : 'targets'}</div></>)
                      : r.kind === 'holdings' ? <span className="dim" title="The fund's holdings have no dated targets to read a 30-day window from">{DASH}</span>
                      : r.kind ? <span className="dim" title="No target set in the last 30 days">none in 30d</span> : DASH}
                  </td>
                  <td className="hl-right hl-strong" style={{ color: r.avgVsPrice != null ? pctColor(r.avgVsPrice) : undefined }}>
                    {r.avgVsPrice != null ? fmtPct(r.avgVsPrice, { precision: 1 }) : DASH}
                  </td>
                  <td className="hl-left tp-risks">{r.risks || ''}</td>
                </tr>
                {detail === r.ticker && (
                  <tr className="tp-detail-row">
                    <td colSpan={TARGET_COLUMNS.length}>
                      <div className="tp-detail">{(kindTag(r)?.title || '').split('\n').map((line, i) => <div key={i}>{line}</div>)}</div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
              {sorted.length === 0 && (
                <tr><td className="hl-empty dim" colSpan={TARGET_COLUMNS.length}>No holdings.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export { TargetPriceModal };
