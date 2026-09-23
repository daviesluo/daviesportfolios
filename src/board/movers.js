// Top Movers ranking — who moved, over which window, by which measure.
//
// Pure: no React, no DOM, no fetch. The panel owns the controls and
// where the prices come from; this owns what a "mover" IS, so the
// rules can be pinned by tests and so there is ONE answer to each of
// the three questions the panel asks — which names are eligible, what
// number is being ranked, and how wide its bar is drawn.
//
// The window is the interesting part. TODAY is the live day move the
// scoreboard and the heat map already publish (`dayPct` / `dayChange`
// off `computeMetrics`), so it is passed straight through — a second
// implementation of the day move is the last thing this repo needs.
// Every longer window is priced from the SAME per-range history the
// performance panel draws, anchored at the window's first bar by the
// same `buildTickerSeries(..., anchorAtWindowStart = true)` the chart
// uses. The panel hands the anchor price in; this module never reads
// a store.

import { isCnFund } from '../prices/ticker_class.js';
import { pctIsFlat } from '../app/formatters.js';
import { computeAt } from '../charts/ytd.js';

/**
 * Windows the panel offers, in order. `TODAY` is the live day move;
 * the rest name the chart ranges whose cached history prices them, so
 * the two panels in the sidebar speak one vocabulary.
 *
 * 3M is here only because the longer windows now measure the HOLDING
 * period rather than the stock's price: a quarter window on a position
 * opened five weeks ago shows five weeks, not a quarter. Without that
 * it was actively misleading and was removed once already. YTD stays
 * out — past a quarter this stops being "what moved" and becomes the
 * performance panel's question. A stored window outside this set falls
 * back to TODAY.
 * @type {readonly string[]}
 */
export const MOVER_WINDOWS = ['TODAY', '1W', '1M', '3M'];

/** The chart range key a window is priced from, or null for TODAY. */
export function rangeKeyForWindow(window) {
  return window === 'TODAY' ? null : (MOVER_WINDOWS.includes(window) ? window : null);
}

/**
 * One name's move over the window, in both measures.
 *
 * **Measured over the time the position was actually HELD, not over the
 * window.** A name bought two days ago shows two days of move on the
 * 1M list, not a month of the stock's price. Anything else credits the
 * book with a rise it was not in for — which is the whole reason the
 * longer windows were pulled from this panel once before.
 *
 * That rule is not implemented here. `computeAt` already applies it,
 * per lot, for the performance chart: a lot bought BEFORE the window
 * opens carries the window-start close as its basis, and a lot bought
 * inside it carries its own cost. Sales, FX, a missing price history
 * and a ticker with no series at all are all handled there too. So
 * this asks `computeAt` about ONE holding and reads the answer, rather
 * than writing a second version of the same arithmetic — the mistake
 * this repository has paid for more than any other.
 *
 * TODAY does not come through here at all: a day change is measured
 * against yesterday's close for every holding regardless of when it
 * was bought, which is what the heat map, the scoreboard and the
 * tactics chips all show. Re-basing it on purchase cost would put two
 * different numbers for one ticker on one screen.
 *
 * @param {any} player  a `computeMetrics` player (carries `lots`, `fx`,
 *                      and an ext-aware native `lastPrice`)
 * @param {{
 *   tickerSeries: Record<string, any>,
 *   anchorDate: string,
 *   todayDate: string,
 *   nowMs?: number,
 * }} ctx
 * @returns {{pct: number, usd: number} | null}
 */
export function holdingMoveOver(player, ctx) {
  if (!player || !ctx) return null;
  const { tickerSeries, anchorDate, todayDate, nowMs = Date.now() } = ctx;
  const { value, basis } = computeAt({
    date: todayDate,
    liveAnchorDate: todayDate,          // so the current price is used
    portfolio: { holdings: { [player.ticker]: player }, positions: {} },
    tickerSeries,
    marketData: {},                     // player.lastPrice is already live
    yearStart: anchorDate,
    yearStartDate: anchorDate,
    todayMs: nowMs,
    useExt: false,
    // metrics.js already resolved this holding's rate against the live
    // FX pairs; reusing it keeps the panel from disagreeing with the
    // scoreboard over what a GBP position is worth in dollars.
    fxToUSD: () => (Number.isFinite(player.fx) ? player.fx : 1),
  });
  if (!(basis > 0) || !Number.isFinite(value)) return null;
  return { pct: ((value - basis) / basis) * 100, usd: value - basis };
}

/**
 * TODAY's move: metrics.js's own day figures, passed straight through.
 * @param {any} player
 * @returns {{pct: number, usd: number} | null}
 */
export function dayMoveOf(player) {
  if (!player) return null;
  return { pct: player.dayPct ?? 0, usd: player.dayChange ?? 0 };
}

/**
 * Rank one window into two columns and the shared bar scale.
 *
 * Eligibility is the same on every window and in both measures: never
 * cash, never a CN fund (its quote is a NAV published after its own
 * close — a real number about a different day), and only names that
 * actually moved, by the same `pctIsFlat` predicate the heat map uses
 * to paint a neutral tile. A name the heat map calls flat must not
 * simultaneously rank here.
 *
 * `moveOf` answers the window for one player, or null when it cannot
 * — no cached history yet, or a holding whose ledger does not
 * reconcile. Such a name simply doesn't rank, rather than ranking off
 * a number the panel had to invent.
 *
 * @param {any[]} players
 * @param {{
 *   window: string,
 *   metric: 'pct'|'usd',
 *   moveOf?: ((player: any) => {pct: number, usd: number}|null) | null,
 *   limit?: number,
 * }} opts
 * @returns {{winners: any[], losers: any[], scale: number, priced: number}}
 */
export function rankMovers(players, opts) {
  const { window, metric, moveOf, limit = 5 } = opts;
  const isToday = rangeKeyForWindow(window) === null;
  /** @type {any[]} */
  const rows = [];
  for (const p of players || []) {
    if (!p || p.isCash || p.ticker === 'CASH' || isCnFund(p.ticker)) continue;
    const move = isToday ? dayMoveOf(p) : (moveOf ? moveOf(p) : null);
    if (!move || pctIsFlat(move.pct)) continue;
    rows.push({ ...p, movePct: move.pct, moveUsd: move.usd });
  }
  const priced = rows.length;
  const valueOf = (/** @type {any} */ r) => (metric === 'usd' ? r.moveUsd : r.movePct);
  // Sub-50c of impact is noise on a book this size and would print as
  // "+$0", so the DOLLAR list drops it. The percentage list keeps it: a
  // small holding that really moved 6 % is a green tile on the heat
  // map, and a name the heat map paints green with no row here is the
  // same two-surfaces-disagree bug the flat gate above prevents. The
  // epsilon belongs to the metric, not to membership.
  const ranked = metric === 'usd' ? rows.filter(r => Math.abs(r.moveUsd) >= 0.5) : rows;
  const winners = ranked.filter(r => valueOf(r) > 0)
    .sort((a, b) => valueOf(b) - valueOf(a)).slice(0, limit);
  const losers = ranked.filter(r => valueOf(r) < 0)
    .sort((a, b) => valueOf(a) - valueOf(b)).slice(0, limit);
  // ONE scale across both columns, not one per column. Normalising
  // each side to its own leader would draw a -$50 top loser as wide as
  // a +$462 top winner and flatly misreport the shape of the window;
  // shared, the bars say which side actually owns it.
  const scale = Math.max(
    0, ...winners.map(r => Math.abs(valueOf(r))), ...losers.map(r => Math.abs(valueOf(r))));
  return { winners, losers, scale, priced };
}

/**
 * Bar width as a percentage of the row. Floored at 6 % so the smallest
 * bar is still a mark rather than a sliver that reads as "no bar".
 * @param {number} value
 * @param {number} scale
 */
export function barWidthPct(value, scale) {
  if (!(scale > 0)) return 0;
  return Math.max(6, (Math.abs(value) / scale) * 100);
}
