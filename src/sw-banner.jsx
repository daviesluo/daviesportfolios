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

  const handleReload = React.useCallback(() => {
    if (reloading) return;
    setReloading(true);
    // Tell the waiting SW to activate. workbox-window registers a
    // `controllerchange` listener that's *supposed* to reload the page
    // once activation completes — but iOS Safari (and some Chrome
    // versions in standalone PWA mode) don't fire that event reliably,
    // so the click visually did nothing and the user had to refresh
    // manually. Belt-and-suspenders: kick off updateServiceWorker for
    // the standard path AND set our own fallback reload after 1500 ms,
    // well past typical activation time, so the page always refreshes.
    try { updateServiceWorker(true); } catch {}
    setTimeout(() => { window.location.reload(); }, 1500);
  }, [reloading, updateServiceWorker]);

  // Force-reload after the update has been pending for 24 h. `prompt`
  // mode means users have to click RELOAD or refresh manually to pick
  // up a new bundle — works fine for daily-active users but a
  // long-running tab (PWA on a laptop that goes to sleep, phone in
  // the background) can sit on a months-old version. Auto-skip after
  // 24 h gives the user a generous window to click manually but
  // guarantees no one is stuck on an old build forever. The original
  // `registerType: 'autoUpdate'` setting wiped the `?pwd=…` URL
  // mid-login (PR feedback in vite.config.js); the 24 h timer skips
  // that race entirely — by then the user already has their auth
  // token in sessionStorage so a reload doesn't re-prompt.
  const AUTO_RELOAD_AFTER_MS = 24 * 60 * 60 * 1000;
  React.useEffect(() => {
    if (!needRefresh || reloading) return undefined;
    const t = setTimeout(() => { handleReload(); }, AUTO_RELOAD_AFTER_MS);
    return () => clearTimeout(t);
  }, [needRefresh, reloading, handleReload]);

  if (!needRefresh) return null;

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
