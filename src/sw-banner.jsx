// Tiny banner that surfaces "new version available, reload?" prompts from
// the service worker (vite-plugin-pwa + Workbox). Sits as a fixed strip at
// the top of the viewport so it can't be hidden by other layout. Renders
// nothing when no update is pending and when the SW first goes offline-ready.
import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function ServiceWorkerBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Poll for updates every 30 minutes so a long-running tab eventually
      // catches the new build without needing a hard refresh.
      if (!registration) return;
      const POLL_MS = 30 * 60 * 1000;
      setInterval(() => registration.update().catch(() => {}), POLL_MS);
    },
  });

  // Track the "RELOAD pressed but page not yet refreshing" window so the
  // button can switch to "RELOADING…" and not look unresponsive on iOS.
  const [reloading, setReloading] = React.useState(false);

  // Suppress the banner for 5 min after the user clicks RELOAD. On
  // iOS Safari standalone-PWA mode the SW state transition is
  // unreliable enough that even with caches.delete + unregister
  // before reload, the next-page-mount useRegisterSW sometimes still
  // sees a waiting worker and re-shows the banner the user just
  // dismissed. Whether that's a fresh deploy in flight or stale iOS
  // SW bookkeeping, surfacing it to the user 2 s after their click
  // looks like the click did nothing. Stash a `dp.swReloadAt` row in
  // sessionStorage so the suppression survives the reload, then expire
  // after 5 min — long enough for the iOS bookkeeping to settle, short
  // enough that a genuinely-new build the user hasn't seen yet still
  // raises the banner on the next poll.
  const RELOAD_SUPPRESS_KEY = 'dp.swReloadAt';
  const RELOAD_SUPPRESS_MS  = 5 * 60 * 1000;
  const [suppressUntil, setSuppressUntil] = React.useState(() => {
    try {
      const v = Number(sessionStorage.getItem(RELOAD_SUPPRESS_KEY) || 0);
      return isFinite(v) && v > 0 ? v + RELOAD_SUPPRESS_MS : 0;
    } catch { return 0; }
  });
  React.useEffect(() => {
    const remaining = suppressUntil - Date.now();
    if (remaining <= 0) return undefined;
    const t = setTimeout(() => setSuppressUntil(0), remaining);
    return () => clearTimeout(t);
  }, [suppressUntil]);

  const handleReload = React.useCallback(async () => {
    if (reloading) return;
    setReloading(true);
    // Record the click timestamp BEFORE any of the async cleanup so
    // the next-page-mount useState initializer picks it up even if
    // the cleanup races against the navigation.
    try { sessionStorage.setItem(RELOAD_SUPPRESS_KEY, String(Date.now())); } catch { /* ignore */ }
    // Tell the waiting SW to activate. workbox-window registers a
    // `controllerchange` listener that's *supposed* to reload the page
    // once activation completes — but iOS Safari (and some Chrome
    // versions in standalone PWA mode) don't fire that event reliably,
    // so the click visually did nothing and the user had to refresh
    // manually. Belt-and-suspenders: kick off updateServiceWorker for
    // the standard path AND set our own fallback reload after 1500 ms,
    // well past typical activation time, so the page always refreshes.
    try { updateServiceWorker(true); } catch {}

    // iOS Safari fallback for the "reloaded but banner is still there"
    // case the user kept hitting: even after the 1500 ms reload, the
    // old SW was sometimes still the controller (SKIP_WAITING wasn't
    // honoured) and the new SW stayed in `waiting`, so the next
    // useRegisterSW mount saw needRefresh=true again and re-showed
    // the banner. Drop every Workbox cache + unregister all SWs so
    // the upcoming reload starts from a clean slate — the new SW
    // re-registers fresh on the next paint, never enters a waiting
    // state for this version, and the banner stays gone.
    try {
      if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    } catch { /* ignore — reload still proceeds */ }
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch { /* ignore — reload still proceeds */ }

    setTimeout(() => { window.location.reload(); }, 1500);
  }, [reloading, updateServiceWorker]);

  // Force-reload after the update has been pending for 24 h. `prompt`
  // mode means users have to click RELOAD or refresh manually to pick
  // up a new bundle — works fine for daily-active users but a
  // long-running tab (PWA on a laptop that goes to sleep, phone in
  // the background) can sit on a months-old version. Auto-skip after
  // 1 h gives the user a deliberately tight window to click manually
  // but guarantees no one is stuck on an old build for a workday.
  // The original `registerType: 'autoUpdate'` setting wiped the
  // `?pwd=…` URL mid-login (PR feedback in vite.config.js); the
  // 1 h timer skips that race entirely — by then the user already
  // has their auth token in sessionStorage so a reload doesn't
  // re-prompt.
  const AUTO_RELOAD_AFTER_MS = 60 * 60 * 1000;
  React.useEffect(() => {
    if (!needRefresh || reloading) return undefined;
    const t = setTimeout(() => { handleReload(); }, AUTO_RELOAD_AFTER_MS);
    return () => clearTimeout(t);
  }, [needRefresh, reloading, handleReload]);

  if (!needRefresh) return null;
  if (Date.now() < suppressUntil) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: '#1d4d3b', color: '#e8f6ec',
      // Match the main page's top inset so the banner doesn't crash
      // into the iOS status bar / notch on PWA — same expression as
      // the .app-shell rule in styles.css.
      paddingTop:    'max(10px, calc(env(safe-area-inset-top, 0px) + 4px))',
      paddingBottom: '10px',
      paddingLeft:   'max(14px, env(safe-area-inset-left, 0px))',
      paddingRight:  'max(14px, env(safe-area-inset-right, 0px))',
      fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.05em',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      <span>NEW VERSION AVAILABLE</span>
      <button
        onClick={handleReload}
        disabled={reloading}
        style={{
          background: '#2a805f', color: '#fff', border: '1px solid #3aa37a',
          padding: '4px 12px', cursor: reloading ? 'wait' : 'pointer',
          opacity: reloading ? 0.7 : 1,
          fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.1em',
          borderRadius: 3,
        }}
      >{reloading ? 'RELOADING…' : 'RELOAD'}</button>
      <button
        onClick={() => setNeedRefresh(false)}
        disabled={reloading}
        style={{
          background: 'transparent', color: '#9bb8aa', border: '1px solid #2a805f',
          padding: '4px 10px', cursor: reloading ? 'wait' : 'pointer',
          opacity: reloading ? 0.5 : 1,
          fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.1em',
          borderRadius: 3,
        }}
      >LATER</button>
    </div>
  );
}
