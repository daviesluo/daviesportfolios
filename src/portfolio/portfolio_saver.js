// The board's saves to the server, one request at a time (improvement plan item 4, 2026-09-30).
//
// Until 2026-09-30 the save effect marked a change saved BEFORE its request resolved, and a request that failed for any
// reason but a conflict was dropped without a word: the edit sat unsaved in the tab, until the next edit or a reload,
// while the board looked saved. Now a change counts as saved only once the server says so. A failed save is said on the
// page and tried again after a bounded backoff, and a newer edit takes over from it: the board it sends already holds
// the older change. A conflict (412) is never tried again, because the server's newer copy is the user's to choose, in
// the conflict banner. One request is in flight at a time and the newest board waits behind it, so an edit undone while
// its save is in flight is sent afterwards, and the server ends on what the board shows.

/** The waits before each retry of a failed save; after the last, the page offers a retry by hand. */
export const SAVE_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

/**
 * @typedef {{ ok: true, version?: number } | { ok: false, conflict?: boolean }} SaveResult
 * @typedef {{ fp: string, portfolio: any }} SaveJob
 * @typedef {{ attempt: number, retryInMs: number | null }} SaveFailing  what the page says: attempts so far, and the
 *   wait before the next (null: none, a retry is the user's)
 */

/**
 * @param {{
 *   save: (portfolio: any) => Promise<SaveResult>,
 *   onSaved: (fp: string) => void,
 *   onConflict: (fp: string) => void,
 *   onFailing: (state: SaveFailing | null) => void,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (id: any) => void,
 * }} deps
 */
export function createPortfolioSaver({ save, onSaved, onConflict, onFailing, setTimer = setTimeout, clearTimer = clearTimeout }) {
  /** @type {SaveJob | null} */
  let inflight = null;
  /** @type {SaveJob | null} */
  let next = null;
  /** @type {(SaveJob & { attempt: number, timer: any }) | null} */
  let waiting = null;
  // Bumped by reset(): a request sent before it no longer counts for anything.
  let gen = 0;

  const clearWaiting = () => {
    if (waiting && waiting.timer != null) clearTimer(waiting.timer);
    waiting = null;
  };

  /** @param {SaveJob} job @param {number} attempt */
  const send = (job, attempt) => {
    inflight = job;
    const mine = gen;
    Promise.resolve()
      .then(() => save(job.portfolio))
      .then((r) => r, () => /** @type {SaveResult} */ ({ ok: false }))
      .then((result) => {
        if (mine !== gen) return;
        inflight = null;
        const queued = next;
        next = null;
        if (result && result.ok === true) {
          onSaved(job.fp);
          onFailing(null);
          if (queued && queued.fp !== job.fp) send(queued, 1);
          return;
        }
        if (result && result.ok === false && result.conflict === true) {
          onConflict(job.fp);
          onFailing(null);
          if (queued && queued.fp !== job.fp) send(queued, 1);
          return;
        }
        // Failed. A newer board waiting behind this one carries this change too: send it instead.
        if (queued) { send(queued, 1); return; }
        const delay = SAVE_RETRY_DELAYS_MS[attempt - 1] ?? null;
        waiting = {
          ...job, attempt,
          timer: delay == null ? null : setTimer(() => {
            const w = waiting;
            waiting = null;
            if (w && mine === gen) send(w, attempt + 1);
          }, delay),
        };
        onFailing({ attempt, retryInMs: delay });
      });
  };

  return {
    /** The fingerprint the saves are heading for: the newest queued, in flight or waiting, else `confirmed`. */
    target(/** @type {string | null} */ confirmed) {
      return next?.fp ?? inflight?.fp ?? waiting?.fp ?? confirmed;
    },
    /** Save this board: now when nothing is in flight, else once the request in flight has answered. */
    request(/** @type {string} */ fp, /** @type {any} */ portfolio) {
      if (waiting) { clearWaiting(); onFailing(null); }
      if (inflight) { next = { fp, portfolio }; return; }
      send({ fp, portfolio }, 1);
    },
    /** The page's retry button: send a failed save now. */
    retryNow() {
      if (!waiting || inflight) return;
      const w = waiting;
      clearWaiting();
      send(w, 1);
    },
    /** The board was replaced (another tab's save, or the page going away): nothing queued, waiting or sent counts. */
    reset() {
      gen += 1;
      clearWaiting();
      inflight = null;
      next = null;
      onFailing(null);
    },
  };
}

// The pending-save draft (app.jsx's `dp.pendingSave` in sessionStorage): the board of an edit the server has not yet
// taken, written before its save is sent, so a tab that dies or is signed out first gets the edit back after it
// reloads. Until 2026-10-08 the reload replayed it onto whatever the server then held, and its save went out against
// that newer version and was taken: a change saved from another tab or device in between was overwritten without a word
// (review F20). Now the draft carries the version its own save would have gone out against (`baseVersion`, the
// `If-Match` of portfolio_remote.js), and the reload replays it only onto that version. Where the server has moved on,
// the draft's save would have met a 412, so the reload ends where that 412 would have left the tab: the draft on the
// board, the conflict bar up, and nothing saved until the user chooses.

/**
 * What a reload does with the pending-save draft, once the server's board has loaded.
 *
 * @param {any} pending  the parsed draft: `{ fp, portfolio, baseVersion?, ts }`
 * @param {string} loadedFp  the fingerprint (portfolioUserFingerprint) of the board the server answered
 * @param {number | null} loadedVersion  the version it answered with (null: a server that sends none)
 * @returns {'none' | 'replay' | 'conflict'}  nothing to replay; replay it, and its save goes out as it would have;
 *   or show it under the conflict bar, unsaved
 */
export function pendingDraftAction(pending, loadedFp, loadedVersion) {
  if (!pending || !pending.fp || !pending.portfolio || pending.fp === loadedFp) return 'none';
  // A draft written before drafts carried their version (the bundle before 2026-10-08), or a server that sends no
  // version, says nothing either way: replayed, as before.
  if (typeof pending.baseVersion !== 'number' || typeof loadedVersion !== 'number') return 'replay';
  return pending.baseVersion === loadedVersion ? 'replay' : 'conflict';
}

/**
 * The pending-save draft once the server has taken a save: gone when it held that change, else (a newer edit's, which
 * builds on the board just saved) kept with the version that save made, the one its own save will now go out against.
 *
 * @param {any} pending  the parsed draft, or null
 * @param {string} savedFp  the fingerprint the server just took
 * @param {number | null} version  the version this tab now builds on (knownPortfolioVersion), null when unknown
 * @returns {any | null}  the draft to keep, or null to remove it
 */
export function draftAfterSave(pending, savedFp, version) {
  if (!pending || pending.fp === savedFp) return null;
  return typeof version === 'number' ? { ...pending, baseVersion: version } : pending;
}
