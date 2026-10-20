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
import { Storage } from './storage.js';
import { Modal } from '../board/modals.jsx';

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
// Exported alongside isDesktopViewport so vitest can pin both the
// constant and the predicate without spinning up a DOM.
export const DESKTOP_MEDIA_QUERY = '(min-width: 761px)';

/**
 * Pure desktop-viewport predicate so the matchMedia check can be
 * tested without a DOM. Takes the matchMedia function in directly
 * (production: `window.matchMedia.bind(window)`; tests: a stub
 * returning `{ matches }`). Falls back to false on any failure —
 * private-mode iOS Safari, etc. — so the badge stays unmounted
 * rather than render erroneously.
 * @param {((q: string) => { matches: boolean }) | null | undefined} matchMediaFn
 */
export function isDesktopViewport(matchMediaFn) {
  if (typeof matchMediaFn !== 'function') return false;
  try { return matchMediaFn(DESKTOP_MEDIA_QUERY).matches === true; }
  catch { return false; }
}

/**
 * Newest error timestamp (ms epoch) in an ops-error summary. Prefers
 * the summary-level `latestAt` (computed server-side across ALL rows,
 * before `bySymbol` is sliced to the top 100); falls back to the max
 * over `bySymbol` for older Edge Function deploys that don't emit the
 * field yet. Drives the Acknowledge gate: the badge hides while every
 * error is at-or-before the acknowledged timestamp, and reappears the
 * moment a newer one lands. Returns 0 for an empty / missing /
 * unparseable summary — the badge then stays visible (fail toward
 * showing errors, not swallowing them).
 * @param {{ latestAt?: string, bySymbol?: any[] } | null | undefined} summary  ops-error summary (external API shape)
 */
export function latestErrorAt(summary) {
  if (!summary) return 0;
  // Prefer the unsliced, server-computed timestamp; bySymbol is the
  // top-100-by-count slice and can omit a newer one-off error.
  const direct = Date.parse(summary.latestAt ?? '');
  if (isFinite(direct)) return direct;
  const rows = Array.isArray(summary.bySymbol) ? summary.bySymbol : [];
  let max = 0;
  for (const r of rows) {
    const t = Date.parse(r?.latestAt);
    if (isFinite(t) && t > max) max = t;
  }
  return max;
}

/**
 * What the box shows (Davies, 2026-10-20: the box had hundreds of rows; no low-level errors that mean nothing). The
 * summary's `box` (`ops-error/noise.ts`): lines a person must act on, each the same message deduplicated with its count,
 * persistent noise as one line, and how many rows it leaves out as noise. Its badge counts LINES, and its Acknowledge
 * gate keys off the newest line. An older Edge deploy without `box` reads as before: every row.
 * @param {any} summary  ops-error summary (external API shape)
 * @returns {{ count: number, lines: any[] | null, hiddenRows: number, latestAt: number } | null}
 */
export function opsBoxView(summary) {
  if (!summary) return null;
  const box = summary.box;
  if (box && Array.isArray(box.lines)) {
    const t = Date.parse(box.latestAt ?? '');
    return { count: box.lines.length, lines: box.lines, hiddenRows: Number(box.hiddenRows) || 0, latestAt: isFinite(t) ? t : 0 };
  }
  return { count: Number(summary.total) || 0, lines: null, hiddenRows: 0, latestAt: latestErrorAt(summary) };
}

/**
 * One line of the box as it reads: the kind, and how many rows and since when it stands for.
 * @param {{ kind: string, count: number, firstAt: string, latestAt: string, persistent?: { ongoing: boolean } }} line
 */
export function opsLineMeta(line) {
  const hm = (/** @type {string} */ iso) => String(iso ?? '').slice(11, 16);
  if (line.persistent) return `${line.persistent.ongoing ? 'still failing' : 'stopped'} · ${hm(line.latestAt)} UTC`;
  return line.count > 1 ? `×${line.count} · ${hm(line.firstAt)}–${hm(line.latestAt)} UTC` : `${hm(line.latestAt)} UTC`;
}

/**
 * React hook returning whether the viewport currently matches the
 * desktop breakpoint (≥761 px wide). Updates on resize / orientation
 * change. Exported so callers other than OpsErrorBadge (e.g.
 * MarketConditions, which had two render trees being hidden via CSS)
 * can mount one viewport's tree instead of both.
 */
export function useIsDesktop() {
  const match = () =>
    typeof window !== 'undefined'
    && isDesktopViewport(typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null);
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
  const [summary, setSummary] = React.useState(/** @type {{ hours: number, total: number, byKind: any[], bySymbol: any[] } | null} */ (null));
  const [open, setOpen] = React.useState(false);
  // Single-flight guard so the periodic poll and an explicit open-click
  // don't race two concurrent fetches.
  const inFlight = React.useRef(false);
  // Newest ops-error timestamp the admin has acknowledged — the badge
  // stays hidden until something newer is reported.
  const [ackAt, setAckAt] = React.useState(() => Storage.loadOpsErrorAck());

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
  // Until the first poll resolves OR there is nothing to act on, render
  // nothing — we don't want to flash an empty badge during cold start.
  const view = opsBoxView(summary);
  if (!summary || !view || view.count === 0) return null;
  // "Acknowledge" hides the badge until something newer than the
  // acknowledged timestamp lands. latestAt 0 (no parseable rows) →
  // don't suppress, so errors are never silently swallowed.
  const latestAt = view.latestAt;
  if (latestAt > 0 && latestAt <= ackAt) return null;

  return (
    <>
      <button
        type="button"
        className="live-pill err"
        title={`${view.count} to look at in the last ${summary.hours} h (${summary.total} rows, ${view.hiddenRows} of them transient noise) — click for the list`}
        onClick={() => { setOpen(true); refresh(); }}
        // No `border: none` — drop the UA outset border but let
        // `.live-pill` / `.live-pill.err` paint the same 1px line +
        // loss-red colour the non-button pills in the row use.
        style={{ cursor: 'pointer', font: 'inherit', color: 'inherit' }}
      >
        <span className="live-dot err" />
        <div className="live-col">
          <span className="live-txt">{view.count} ERRORS</span>
          <span className="live-ago mono">last {summary.hours}h</span>
        </div>
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} size="md">
          <header className="modal-head">
            <div>
              <div className="modal-eyebrow mono">OPS · LAST {summary.hours}H</div>
              <h2 className="modal-title mono">{view.count} errors</h2>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="btn-ghost"
                style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                title="Hide the errors badge until a newer error is reported"
                onClick={() => {
                  // Mark every error in the current summary as seen;
                  // the badge re-appears only when a newer one lands.
                  if (latestAt > 0) { Storage.saveOpsErrorAck(latestAt); setAckAt(latestAt); }
                  setOpen(false);
                }}
              >Acknowledge</button>
              <button className="btn-ghost icon" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
          </header>
          <div className="modal-body">
            {view.lines && (
              <section className="ops-lines" style={{ marginBottom: 16 }}>
                <div className="modal-eyebrow mono" style={{ marginBottom: 6 }}>TO LOOK AT</div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {view.lines.map((/** @type {any} */ l, i) => (
                    <li key={`${l.kind}|${i}`} className="ops-line" style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)', fontSize: 12 }}>
                      <div className="mono" style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                        <span>{l.kind}</span>
                        <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }}>{opsLineMeta(l)}</span>
                      </div>
                      <div style={{ opacity: 0.8, overflowWrap: 'anywhere' }}>{l.message}</div>
                    </li>
                  ))}
                </ul>
                {view.hiddenRows > 0 && (
                  <div className="mono dim ops-hidden" style={{ marginTop: 6, fontSize: 11 }}>
                    {view.hiddenRows} rows of transient noise hidden (timeouts, 5xx, a recorder&apos;s single failed run); kept in the table
                  </div>
                )}
              </section>
            )}
            <section style={{ marginBottom: 16 }}>
              <div className="modal-eyebrow mono" style={{ marginBottom: 6 }}>{view.lines ? 'ALL ROWS BY KIND' : 'BY KIND'}</div>
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
