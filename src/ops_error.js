// Lightweight client-side observability — POSTs failure events to the
// ops-error Edge Function so we can see in Supabase which fetches /
// proxies / endpoints are flaking without waiting for the user to
// notice and screenshot. Best-effort: never throws, never blocks the
// caller, and self-rate-limits per-kind so a noisy retry loop can't
// spam the table.

import { SB_ANON, SB_URL } from './supabase_config.js';

const ENDPOINT = `${SB_URL}/functions/v1/ops-error`;

// Per-(kind|symbol) cooldown so a 30-ticker batch flake reports once
// per kind, not 30× × 3-retry. Keys in this Map look like
// `fetch.histbatch|AAPL` or `auth.unexpected|`.
const RECENT = new Map();
const COOLDOWN_MS = 60_000; // 1 min per (kind, symbol)

// Hard cap on reports per page-load — if something's really broken
// we don't want to DDoS our own Edge Function.
const MAX_PER_LOAD = 50;
let _sentThisLoad = 0;

/**
 * @param {string} kind         — short identifier, e.g. 'fetch.histbatch'
 * @param {{ symbol?: string, message?: string, context?: object }} [opts]
 */
export function reportError(kind, opts = {}) {
  if (_sentThisLoad >= MAX_PER_LOAD) return;
  if (!kind) return;
  const symbol = opts.symbol || '';
  const dedupKey = `${kind}|${symbol}`;
  const last = RECENT.get(dedupKey);
  if (last != null && (Date.now() - last) < COOLDOWN_MS) return;
  RECENT.set(dedupKey, Date.now());
  _sentThisLoad++;

  const payload = {
    kind,
    symbol: opts.symbol,
    message: opts.message,
    context: {
      ...(opts.context || {}),
      ua: navigator.userAgent,
      ts: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.pathname : null,
    },
  };

  // Best-effort POST — swallow failures, this can't itself break the app.
  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'apikey': SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // keepalive lets the request survive a navigation / tab close —
      // useful for the render-crash path which tends to be followed by
      // the user clicking Reload.
      keepalive: true,
    }).catch(() => {});
  } catch { /* swallow */ }
}
