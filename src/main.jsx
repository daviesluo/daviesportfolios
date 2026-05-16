// Vite entry — imports App and mounts it. All cross-module wiring is now
// done via standard ES imports inside each module; the legacy `window.X`
// bridge (setup.js, side-effect imports) is gone.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './app.jsx';
import { reportError } from './ops_error.js';

// Catch async failures the React ErrorBoundary can't see — unhandled
// Promise rejections from `useEffect` fetches, JSON parse errors in
// `.then()` chains, etc. Without this they just `console.error` and
// vanish; routing through `reportError` puts them in the same
// ops_errors stream as render crashes so the badge surfaces them.
// keepalive on the report fetch survives a tab-close after the error.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e?.reason?.message ?? String(e?.reason ?? 'unhandledrejection');
    reportError('promise.unhandled', { message: msg });
  });
}

createRoot(document.getElementById('root')).render(
  // StrictMode double-renders effects in dev to surface missing-cleanup
  // bugs (most often in `useEffect` fetches). Prod builds run it once;
  // wrapping costs nothing there and surfaces issues during dev that
  // would otherwise only appear under load.
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
