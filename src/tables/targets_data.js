// The analyst targets behind the Target price page, read through the app's preload so the page opens drawn
// (Davies, 2026-10-21: no cold fetch, no empty or loading state on open).
//
// One GET to the `targets` Edge Function returns every holding's snapshot at once (the job writes them on its schedule,
// supabase/functions/targets). `prefetchTargets` is called by the app after its first paint, beside the split pages'
// code (app.jsx `prefetchModalChunks`): it never blocks the board, a failure leaves whatever copy is kept, and a request
// already out is joined rather than sent twice. The answer is kept in memory and in this browser
// (Storage.saveTargetsCache), so a reload paints the last copy at once; a copy younger than TARGETS_TTL_MS is not asked
// for again. The job writes at most three times a trading day, so hours lose nothing.

import { EDGE_PRICES_URL, edgeHeaders } from '../prices/yahoo_fetch.js';
import { Storage } from '../app/storage.js';

export const TARGETS_URL = EDGE_PRICES_URL.replace(/\/prices$/, '/targets');
/** How long a copy stands before the next preload or page open asks again. */
export const TARGETS_TTL_MS = 2 * 3600e3;
const TIMEOUT_MS = 10_000;

/** @type {{ at: number, data: any } | null} */
let cache = null;
let keptRead = false;
/** @type {Promise<any> | null} */
let inFlight = null;
/** @type {Set<() => void>} */
const listeners = new Set();

function readKept() {
  if (keptRead) return;
  keptRead = true;
  const kept = Storage.loadTargetsCache();
  if (kept && !cache) cache = kept;
}

/** The copy the page draws from, or null: memory, else the one kept in this browser. */
export function readTargetsCache() { readKept(); return cache; }

/** Called whenever a new copy lands, so an open page redraws with it. @param {() => void} fn */
export function onTargets(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/**
 * Ask the server for the targets, joining a request already out. Resolves to the copy, or null on any failure.
 * @param {typeof fetch} [fetchImpl] @param {() => number} [now]
 */
export function fetchTargets(fetchImpl = fetch, now = Date.now) {
  if (inFlight) return inFlight;
  const req = (async () => {
    try {
      const res = await fetchImpl(TARGETS_URL, { headers: edgeHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== 'object' || !data.rows || typeof data.rows !== 'object') return null;
      cache = { at: now(), data };
      Storage.saveTargetsCache(cache);
      for (const fn of listeners) { try { fn(); } catch { /* a listener's fault is its own */ } }
      return cache;
    } catch {
      return null;
    }
  })();
  inFlight = req;
  req.finally(() => { if (inFlight === req) inFlight = null; });
  return req;
}

/**
 * The preload: fetch unless a copy younger than the TTL is here. Never throws.
 * @param {typeof fetch} [fetchImpl] @param {() => number} [now]
 */
export function prefetchTargets(fetchImpl = fetch, now = Date.now) {
  readKept();
  if (cache && now() - cache.at < TARGETS_TTL_MS) return Promise.resolve(cache);
  return fetchTargets(fetchImpl, now);
}

/** Test hook: forget memory, as a reload would. */
export function _resetTargets() { cache = null; keptRead = false; inFlight = null; listeners.clear(); }
