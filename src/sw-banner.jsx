// Tiny banner that surfaces "new version available, reload?" prompts from
// the service worker (vite-plugin-pwa + Workbox). Sits as a fixed strip at
// the top of the viewport so it can't be hidden by other layout. Renders
// nothing when no update is pending and when the SW first goes offline-ready.
import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Suppress the banner for SW_RELOAD_SUPPRESS_MS after the user clicks
// RELOAD. On iOS Safari standalone-PWA mode the SW state transition
// is unreliable enough that the next-page-mount useRegisterSW
// sometimes still sees a waiting worker and re-shows the banner the
// user just dismissed. Storage key + window length + the read /
// compute helpers below are exported so the suppression behaviour
// can be pinned by vitest without a DOM.
export const SW_RELOAD_SUPPRESS_KEY = 'dp.swReloadAt';
export const SW_RELOAD_SUPPRESS_MS  = 2 * 60 * 1000;

/**
 * Read the most-recent RELOAD-click timestamp from a Storage-shaped
 * object (sessionStorage in prod, mocked in tests). Returns 0 when
 * the key is missing, malformed, non-positive, or the storage object
 * itself isn't usable (private-mode quirks, vitest node env without
 * jsdom, etc.).
 * @param {Pick<Storage, 'getItem'> | null | undefined} storage
 */
export function readReloadSuppressAt(storage) {
  if (!storage || typeof storage.getItem !== 'function') return 0;
  try {
    const v = Number(storage.getItem(SW_RELOAD_SUPPRESS_KEY) || 0);
    return isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

/**
 * Translate a stored reloadAt timestamp into the absolute "show the
 * banner again at this time" wall-clock deadline. 0 reloadAt → 0
 * deadline (never been clicked, banner can render whenever
 * needRefresh is true).
 * @param {number} reloadAt
 */
export function computeSuppressUntil(reloadAt) {
  return reloadAt > 0 ? reloadAt + SW_RELOAD_SUPPRESS_MS : 0;
}

/**
 * Render gate for the banner. Hide when there's nothing pending OR
 * when we're inside the post-reload suppression window.
 * @param {boolean} needRefresh
 * @param {number} now
 * @param {number} suppressUntil
 */
export function shouldShowBanner(needRefresh, now, suppressUntil) {
  if (!needRefresh) return false;
  return now >= suppressUntil;
}

/**
 * Clean-slate purge before a reload so the new SW mounts as if the page
 * were opened for the first time. Auth token lives in sessionStorage
 * (per-tab, survives reload) so the user isn't logged out. Cleared:
 * Workbox/runtime caches + every registered SW (so the new bundle's
 * assets load) and localStorage (dp.* schema / prefs / market cache).
 *
 * NOT cleared: the IndexedDB chart cache (chart_store — ChartStore /
 * MaStore / YtdStore). It's just price bars keyed by ticker + range with
 * a baked-in TTL and version suffixes (e.g. `|PE|v5|`), so a new version
 * either reuses fresh rows or evicts stale-shape ones by key — wiping it
 * gained nothing but made every chart open after a version reload a cold
 * 1-2 s fetch (the prefetch + boot-hydrate that warm it were thrown
 * away). Keeping it is what makes the individual-stock / Market
 * Conditions charts open instantly again.
 *
 * Each step is isolated so one failure can't skip the rest. Awaited
 * best-effort by handleReload, which force-reloads on a hard timer even
 * if this hangs.
 */
export async function purgeForReload() {
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
  try { localStorage.clear(); } catch { /* private mode etc. */ }
}

export function ServiceWorkerBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Poll for updates every 60 s so a desktop tab or a phone PWA
      // picks up a new deploy within ~1 min of the push landing, not
      // the previous 10 min. Combined with the visibility-change /
      // focus listeners below (which fire registration.update on
      // tab-resume), a backgrounded PWA gets a near-instant banner
      // when the user touches it.
      if (!registration) return;
      const POLL_MS = 60 * 1000;
      const checkNow = () => { registration.update().catch(() => {}); };
      const id = setInterval(checkNow, POLL_MS);
      // Also check whenever the tab regains visibility / focus — a
      // phone PWA spends 99% of its life backgrounded, and the
      // 60 s setInterval is throttled-to-minutes by mobile browsers
      // when the tab isn't foreground. visibilitychange + focus fire
      // synchronously the moment the user opens the app, so the
      // banner appears within seconds of the user looking at it
      // rather than after the next foreground tick.
      const onVisible = () => {
        if (typeof document !== 'undefined' && !document.hidden) checkNow();
      };
      try {
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
      } catch { /* SSR / non-browser env */ }
      // No cleanup return — useRegisterSW's callback fires once at
      // mount and the listeners should live for the tab's lifetime.
      // Returning would also conflict with vite-plugin-pwa's typed
      // signature.
      void id;
    },
  });

  // Track the "RELOAD pressed but page not yet refreshing" window so the
  // button can switch to "RELOADING…" and not look unresponsive on iOS.
  const [reloading, setReloading] = React.useState(false);

  // Suppression machinery: see SW_RELOAD_SUPPRESS_KEY +
  // readReloadSuppressAt / computeSuppressUntil at the top of the
  // file for the why. Initializer is wrapped in a try in case
  // sessionStorage itself throws (Safari private mode etc.).
  const [suppressUntil, setSuppressUntil] = React.useState(() => {
    try { return computeSuppressUntil(readReloadSuppressAt(sessionStorage)); }
    catch { return 0; }
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
    try { sessionStorage.setItem(SW_RELOAD_SUPPRESS_KEY, String(Date.now())); } catch { /* ignore */ }

    // Guarantee the page reloads even if the SW-activation event never
    // fires AND the purge below wedges (a blocked `indexedDB.deleteDatabase`
    // whose `onblocked` never resolves, a hung cache API, …). The reload
    // used to sit AFTER the whole await chain, so any one hung await left
    // the button stuck on "RELOADING…" forever and the page never
    // refreshed — the freeze this fixes. Now a hard timer owns the reload
    // and the purge merely races it: we reload at whichever lands first,
    // a completed purge or the 1500 ms deadline. `reloaded` guards against
    // a double reload.
    let reloaded = false;
    const doReload = () => {
      if (reloaded) return;
      reloaded = true;
      try { window.location.reload(); } catch { /* nothing else to do */ }
    };
    const hardTimer = setTimeout(doReload, 1500);

    // Tell the waiting SW to activate. workbox-window registers a
    // `controllerchange` listener that's *supposed* to reload the page
    // once activation completes — but iOS Safari (and some Chrome
    // versions in standalone PWA mode) don't fire that event reliably,
    // so on its own the click visually did nothing. The hard timer above
    // is the belt-and-suspenders fallback.
    try { updateServiceWorker(true); } catch {}

    // Best-effort clean-slate purge so the new SW mounts as if the page
    // were opened fresh. A throw can't skip the reload (wrapped), and a
    // hang can't either (the hard timer fires regardless).
    try { await purgeForReload(); } catch { /* ignore — reload still proceeds */ }

    // Re-stash the reload-suppress timestamp since the localStorage clear
    // inside the purge wiped sessionStorage in some browsers (Safari
    // ITP-like behaviour). Cheap insurance against a quirky purge order.
    try { sessionStorage.setItem(SW_RELOAD_SUPPRESS_KEY, String(Date.now())); } catch { /* ignore */ }

    // Purge finished within the window → reload now instead of waiting
    // out the rest of the hard-timer delay.
    clearTimeout(hardTimer);
    doReload();
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

  if (!shouldShowBanner(needRefresh, Date.now(), suppressUntil)) return null;

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
