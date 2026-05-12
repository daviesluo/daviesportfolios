// Lightweight client-side observability — POSTs failure events to the
// ops-error Edge Function so we can see in Supabase which fetches /
// proxies / endpoints are flaking without waiting for the user to
// notice and screenshot. Best-effort: never throws, never blocks the
// caller, and self-rate-limits per-kind so a noisy retry loop can't
// spam the table.

import { SB_ANON, SB_URL } from './supabase_config.js';
import { getAppToken } from './auth.js';

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
  // Admin-token gate (Edge-Function side enforces; we also short-
  // circuit here to skip the network round-trip + drop noisy reports
  // from sessions that never authenticated). The client-side
  // cooldown / per-load cap is still defense in depth, but the real
  // guard is now server-side. Pre-auth render crashes from before
  // the user's typed-pwd → token round-trip are no longer captured
  // — accepted tradeoff (PR #106): a fully-anonymous POST endpoint
  // was trivially spammable.
  const token = getAppToken();
  if (!token) return;
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
        'x-app-token': token,
      },
      body: JSON.stringify(payload),
      // keepalive lets the request survive a navigation / tab close —
      // useful for the render-crash path which tends to be followed by
      // the user clicking Reload.
      keepalive: true,
    }).catch(() => {});
  } catch { /* swallow */ }
}

/**
 * Read the last N hours' aggregated ops-error rows. Backs the
 * admin-only ⚠ badge in the header so the user can triage failures
 * without opening Supabase dashboard. Requires an admin app token
 * (the Edge Function 401s read-only tokens).
 *
 * @param {number} [hours=24]   1..168, clipped server-side
 * @returns {Promise<{
 *   hours: number,
 *   total: number,
 *   byKind:   Array<{ kind: string, count: number, latestMessage: string | null }>,
 *   bySymbol: Array<{ symbol: string | null, kind: string, count: number, latestMessage: string | null, latestAt: string }>,
 * } | null>}  null on auth / network / parse failure
 */
export async function fetchOpsErrorSummary(hours = 24) {
  const token = getAppToken();
  if (!token) return null;
  try {
    const url = `${ENDPOINT}?action=summary&hours=${encodeURIComponent(String(hours))}`;
    const res = await fetch(url, {
      headers: {
        'apikey':       SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
        'x-app-token':  token,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object' || typeof data.total !== 'number') return null;
    return data;
  } catch { return null; }
}
