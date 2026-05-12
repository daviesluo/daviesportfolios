// Admin-only "errors" pill in the Header — polls the ops-error
// summary endpoint every 60 s and lets the user click into a small
// modal with the byKind / bySymbol breakdown. Replaces "SSH into
// Supabase SQL Editor" for routine triage.
//
// Desktop-only. The mobile header layout has no room for an extra
// pill and the previous version (CSS-collapsed on mobile) still
// mounted, fetched and flashed for a couple of seconds before the
// layout shrunk it away. Gate the WHOLE component on a matchMedia
// hook so on phones the badge never mounts, never fetches, and
// never paints — only desktop viewers carry the polling weight.
//
// Hidden for read-only viewers too; the underlying GET ?action=
// summary endpoint also rejects ro tokens server-side, so this is
// belt + suspenders.

import React from 'react';
import { fetchOpsErrorSummary } from './ops_error.js';
import { Modal } from './modals.jsx';

const POLL_MS = 60 * 1000;
const SUMMARY_HOURS = 24;
// Match the same breakpoint the header CSS uses: at ≤ 760 px the
// header stacks vertically (styles.css `@media (max-width: 760px)`)
// and there's no room for the pill, so the badge stays unmounted
// below that. Above 761 px the desktop horizontal layout has room
// for it. The previous 1021 px value bled the badge into the
// 761–1020 tablet band where the desktop layout had already kicked
// in but the badge stayed hidden — visible discrepancy with the
// sibling LIVE pill that the user's bug report flagged.
const DESKTOP_MEDIA_QUERY = '(min-width: 761px)';

function useIsDesktop() {
  const match = () =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  const [isDesktop, setIsDesktop] = React.useState(match);
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handler = () => setIsDesktop(mql.matches);
    // addEventListener is the modern API; addListener is the
    // pre-2020 fallback iOS Safari kept around for a while.
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler);
    else if (typeof mql.addListener === 'function') mql.addListener(handler);
    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', handler);
      else if (typeof mql.removeListener === 'function') mql.removeListener(handler);
    };
  }, []);
  return isDesktop;
}

export function OpsErrorBadge({ isReadOnly }) {
  const isDesktop = useIsDesktop();
  const enabled = !isReadOnly && isDesktop;

  /** @type {[ Awaited<ReturnType<typeof fetchOpsErrorSummary>>, (s: any) => void ]} */
  const [summary, setSummary] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  // Single-flight guard so the periodic poll and an explicit open-click
  // don't race two concurrent fetches.
  const inFlight = React.useRef(false);

  const refresh = React.useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const s = await fetchOpsErrorSummary(SUMMARY_HOURS);
      setSummary(s);
    } finally { inFlight.current = false; }
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

  if (!enabled) return null;
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
        // No `border: none` — drop the UA outset border but let
        // `.live-pill` / `.live-pill.err` paint the same 1px line +
        // loss-red colour the non-button pills in the row use.
        style={{ cursor: 'pointer', font: 'inherit', color: 'inherit' }}
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
