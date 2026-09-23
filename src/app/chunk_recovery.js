// A lazily loaded page whose code does not arrive is a deployment event, not
// a crash. On 2026-09-21 Cloudflare Pages answered a chunk that did not exist
// yet with the HTML shell, status 200, and the assets' one-year `immutable`
// header; a browser that asked a moment before the deploy had propagated
// cached HTML under the chunk's name for a year, the service worker copied it
// into its precache at install, and every sub-page died until the next
// deploy while the home page (already loaded) worked. `src/public/_headers` and
// `404.html` stop the poisoning at the source; this module is the app's own
// way out for a browser that is already holding a bad copy: refresh the
// browser's copy of the chunk, drop every service worker and cache, reload
// once. A second failure inside the window is shown, not retried forever.
import React from 'react';
import { reportError } from './ops_error.js';

/** The messages browsers use for a module that failed to load (Chrome, Safari, Firefox, and the nosniff MIME refusal). */
export const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|not a valid JavaScript MIME type|Failed to load module script|Loading chunk \d+ failed|ChunkLoadError/i;

/** @param {unknown} err */
export function isChunkLoadError(err) {
  const e = /** @type {any} */ (err);
  return e?.name === 'ChunkLoadError' || CHUNK_ERROR_RE.test(String(e?.message ?? e ?? ''));
}

/** The failing chunk's URL when the browser put it in the message, else null. @param {unknown} err */
export function chunkUrlFromError(err) {
  const m = String(/** @type {any} */ (err)?.message ?? err ?? '').match(/https?:\/\/[^\s'"()]+\.js/);
  return m ? m[0] : null;
}

export const RECOVERY_KEY = 'dp.chunkRecovery';
export const RECOVERY_WINDOW_MS = 5 * 60e3;

/**
 * One heal per window: a reload that fails the same way again must show the
 * page's frame with the words, not loop.
 * @param {{ getItem: (k: string) => string | null }} storage
 * @param {number} nowMs
 */
export function shouldHeal(storage, nowMs, windowMs = RECOVERY_WINDOW_MS) {
  try {
    const last = Number(storage.getItem(RECOVERY_KEY) || 0);
    return !(last > 0 && nowMs - last < windowMs);
  } catch {
    return true;
  }
}

/**
 * Heal a browser that holds a bad copy of a chunk, then reload. Every step is
 * best-effort and independent: a browser without service workers, or with
 * caches blocked, still gets the reload.
 * @param {unknown} err
 * @param {{ storage?: any, nowMs?: number, fetchImpl?: ((url: string, init?: any) => Promise<unknown>) | null, sw?: any, cacheStore?: any, reload?: () => void, report?: (kind: string, opts: any) => void }} [deps]
 * @returns {Promise<'reloading' | 'gave-up'>}
 */
export async function healAndReload(err, deps = {}) {
  const storage = deps.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : { getItem: () => null, setItem: () => {} });
  const nowMs = deps.nowMs ?? Date.now();
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? /** @type {(url: string, init?: any) => Promise<unknown>} */ (fetch) : null);
  const sw = deps.sw ?? (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);
  const cacheStore = deps.cacheStore ?? (typeof caches !== 'undefined' ? caches : undefined);
  const reload = deps.reload ?? (() => { window.location.reload(); });
  const report = deps.report ?? reportError;
  if (!shouldHeal(storage, nowMs)) return 'gave-up';
  try { storage.setItem(RECOVERY_KEY, String(nowMs)); } catch { /* private mode: heal anyway, once per page life */ }
  const url = chunkUrlFromError(err);
  // 1. The browser's own copy of the chunk: `cache: 'reload'` goes past the stored response and stores the fresh one.
  if (url && fetchImpl) { try { await fetchImpl(url, { cache: 'reload' }); } catch { /* the reload below fetches a fresh shell anyway */ } }
  // 2. Every service worker and every cache it kept: a precache holding HTML under a chunk's name is worse than none.
  try {
    const regs = (await sw?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* no service worker support */ }
  try {
    const keys = (await cacheStore?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => cacheStore.delete(k)));
  } catch { /* caches blocked */ }
  try { report('chunk.load', { message: String(/** @type {any} */ (err)?.message ?? err), context: { url, healed: true } }); } catch { /* reporting is best-effort */ }
  reload();
  return 'reloading';
}

/**
 * `React.lazy` for a page chunk: a load failure heals and reloads instead of
 * throwing into the tree; while the page is going away the promise never
 * settles, so the Suspense fallback (the page's own frame) stays up. Inside
 * the window after a heal the error is thrown, and the page's boundary says
 * what happened.
 * @param {() => Promise<any>} factory
 * @param {(m: any) => { default: React.ComponentType<any> }} pick
 */
/**
 * The last way a poisoned chunk can reach a person: an unhandled rejection.
 * `lazyPage` catches the import it owns and the warm-up swallows its own,
 * but a browser holding a poisoned service-worker cache can still surface
 * one from a promise nothing is awaiting any more — React's own retry of a
 * lazy element, a preload that loses its handler when the page starts
 * reloading. Reported as `promise.unhandled` it reads as an application
 * bug; it is the same cache problem, so it heals the same way and is
 * reported under the same name as a click on a dead page.
 * @param {unknown} reason @param {any} [deps]
 * @returns {Promise<boolean>} true when this was a chunk failure and was handled here
 */
export async function healRejection(reason, deps = {}) {
  if (!isChunkLoadError(reason)) return false;
  await healAndReload(reason, deps);
  return true;
}

export function lazyPage(factory, pick) {
  return React.lazy(() => factory().then(pick).catch(async (err) => {
    if (!isChunkLoadError(err)) throw err;
    const outcome = await healAndReload(err);
    if (outcome === 'reloading') return new Promise(() => {});
    throw err;
  }));
}
