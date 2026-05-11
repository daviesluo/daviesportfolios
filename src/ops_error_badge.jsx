// Admin-only "errors" pill in the Header — polls the ops-error
// summary endpoint every 60 s and lets the user click into a small
// modal with the byKind / bySymbol breakdown. Replaces "SSH into
// Supabase SQL Editor" for routine triage.
//
// Hidden entirely for read-only viewers; the underlying GET ?action=
// summary endpoint also rejects ro tokens server-side, so this is
// belt + suspenders.

import React from 'react';
import { fetchOpsErrorSummary } from './ops_error.js';
import { Modal } from './modals.jsx';

const POLL_MS = 60 * 1000;
const SUMMARY_HOURS = 24;

export function OpsErrorBadge({ isReadOnly }) {
  /** @type {[ Awaited<ReturnType<typeof fetchOpsErrorSummary>>, (s: any) => void ]} */
  const [summary, setSummary] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  // Single-flight guard so the periodic poll and an explicit open-click
  // don't race two concurrent fetches.
  const inFlight = React.useRef(false);

  const refresh = React.useCallback(async () => {
    if (isReadOnly || inFlight.current) return;
    inFlight.current = true;
    try {
      const s = await fetchOpsErrorSummary(SUMMARY_HOURS);
      setSummary(s);
    } finally { inFlight.current = false; }
  }, [isReadOnly]);

  React.useEffect(() => {
    if (isReadOnly) return undefined;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [isReadOnly, refresh]);

  if (isReadOnly) return null;
  // Until the first poll resolves OR the endpoint says zero, render
  // nothing — we don't want to flash an empty badge during cold start.
  if (!summary || summary.total === 0) return null;

  return (
    <>
      <button
        type="button"
        className="live-pill err"
        title={`${summary.total} ops-error rows in the last ${summary.hours} h — click for breakdown`}
        onClick={() => { setOpen(true); refresh(); }}
        style={{ cursor: 'pointer', border: 'none', font: 'inherit', color: 'inherit' }}
      >
        <span className="live-dot err" />
        <div className="live-col">
          <span className="live-txt">⚠ {summary.total} ERRORS</span>
          <span className="live-ago mono">last {summary.hours}h</span>
        </div>
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} size="md">
          <header className="modal-head">
            <div>
              <div className="modal-eyebrow mono">OPS · LAST {summary.hours}H</div>
              <h2 className="modal-title mono">{summary.total} errors</h2>
            </div>
            <button className="btn-ghost icon" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </header>
          <div className="modal-body">
            <section style={{ marginBottom: 16 }}>
              <div className="modal-eyebrow mono" style={{ marginBottom: 6 }}>BY KIND</div>
              {summary.byKind.length === 0 ? (
                <div className="mono dim">—</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 12 }}>
                  <tbody>
                    {summary.byKind.map(row => (
                      <tr key={row.kind} style={{ borderBottom: '1px solid var(--rule)' }}>
                        <td style={{ padding: '4px 8px 4px 0', whiteSpace: 'nowrap' }}>{row.kind}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.count}</td>
                        <td style={{ padding: '4px 0', opacity: 0.7, fontSize: 11 }} title={row.latestMessage || ''}>
                          {(row.latestMessage || '').slice(0, 80)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section>
              <div className="modal-eyebrow mono" style={{ marginBottom: 6 }}>BY SYMBOL (top 50)</div>
              {summary.bySymbol.length === 0 ? (
                <div className="mono dim">—</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 12 }}>
                  <tbody>
                    {summary.bySymbol.slice(0, 50).map((row, i) => (
                      <tr key={`${row.symbol}|${row.kind}|${i}`} style={{ borderBottom: '1px solid var(--rule)' }}>
                        <td style={{ padding: '4px 8px 4px 0', whiteSpace: 'nowrap' }}>{row.symbol || '—'}</td>
                        <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', opacity: 0.7 }}>{row.kind}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.count}</td>
                        <td style={{ padding: '4px 0', opacity: 0.5, fontSize: 11 }}>
                          {new Date(row.latestAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </Modal>
      )}
    </>
  );
}
