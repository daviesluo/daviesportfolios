// Vite entry — imports App and mounts it. All cross-module wiring is now
// done via standard ES imports inside each module; the legacy `window.X`
// bridge (setup.js, side-effect imports) is gone.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './app.jsx';
import { reportError } from './ops_error.js';
import { healRejection } from './chunk_recovery.js';

// Catch async failures the React ErrorBoundary can't see — unhandled
// Promise rejections from `useEffect` fetches, JSON parse errors in
// `.then()` chains, etc. Without this they just `console.error` and
// vanish; routing through `reportError` puts them in the same
// ops_errors stream as render crashes so the badge surfaces them.
// keepalive on the report fetch survives a tab-close after the error.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e?.reason;
    const msg = reason?.message ?? String(reason ?? 'unhandledrejection');
    // A chunk that failed to load is not an application bug: it is a browser
    // holding a cached copy of the HTML shell under a script's name. Heal it
    // and report it as chunk.load, the same as a click on a dead page — see
    // chunk_recovery.js and the 2026-09-21 incident it was written for.
    healRejection(reason).then((healed) => {
      if (!healed) reportError('promise.unhandled', { message: msg });
    }).catch(() => reportError('promise.unhandled', { message: msg }));
  });
}

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
  // StrictMode double-renders effects in dev to surface missing-cleanup
  // bugs (most often in `useEffect` fetches). Prod builds run it once;
  // wrapping costs nothing there and surfaces issues during dev that
  // would otherwise only appear under load.
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
