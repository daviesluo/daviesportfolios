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

  if (!needRefresh) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: '#1d4d3b', color: '#e8f6ec',
      padding: '10px 14px',
      fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.05em',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      <span>NEW VERSION AVAILABLE</span>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: '#2a805f', color: '#fff', border: '1px solid #3aa37a',
          padding: '4px 12px', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.1em',
          borderRadius: 3,
        }}
      >RELOAD</button>
      <button
        onClick={() => setNeedRefresh(false)}
        style={{
          background: 'transparent', color: '#9bb8aa', border: '1px solid #2a805f',
          padding: '4px 10px', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.1em',
          borderRadius: 3,
        }}
      >LATER</button>
    </div>
  );
}
