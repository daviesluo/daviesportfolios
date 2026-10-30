// The board's refresh, heard by the pages opened over it (Davies, 2026-10-30: "网页主页刷新时agent页和所有子策略页也同步刷新，agent页刷新时
// 所有子策略页也同步刷新"). The board's ↻, its `r` key and its own ticks announce each refresh here; the Agents page, and every
// strategy page opened over it (they read the one dashboard it holds), refreshes with it. The app's load and its error retry
// announce nothing: a page opened then has just asked (or joined the app's own ask), and a second ask was a second dashboard
// request on every open after a reload. A window event, so the board does not import the Agents page's code, which loads
// only when it opens.

export const BOARD_REFRESH_EVENT = 'dp:board-refresh';

/**
 * The board has begun a refresh: `manual` for its ↻ or `r` (the Agents page then asks anew, as its own ↻ does), else its
 * own tick (the Agents page then refreshes only when its answer is near its own minute, so no call is made twice).
 * @param {boolean} manual
 */
export function announceBoardRefresh(manual) {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BOARD_REFRESH_EVENT, { detail: { manual: !!manual } }));
  } catch { /* a page that cannot dispatch events refreshes on its own clock */ }
}

/**
 * Runs `fn` on each of the board's refreshes; returns the unsubscribe.
 * @param {(e: { manual: boolean }) => void} fn
 */
export function onBoardRefresh(fn) {
  if (typeof window === 'undefined') return () => {};
  const h = (/** @type {Event} */ e) => fn({ manual: !!(/** @type {CustomEvent} */ (e).detail?.manual) });
  window.addEventListener(BOARD_REFRESH_EVENT, h);
  return () => window.removeEventListener(BOARD_REFRESH_EVENT, h);
}
