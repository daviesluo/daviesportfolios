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

import { isCnFund } from './ticker_class.js';
import { pctIsFlat } from './formatters.js';

/**
 * Windows the panel offers, in order. `TODAY` is the live day move;
 * the rest name the chart ranges whose cached history prices them, so
 * the two panels in the sidebar speak one vocabulary.
 *
 * Three, not five. These sit in the panel's TITLE row beside the
 * `%` / `$` switch, and a "what moved" list stops being a movers list
 * somewhere past a month — over a quarter it is really a performance
 * ranking, which is the other panel's job. A stored window outside
 * this set (one saved before it shrank) falls back to TODAY.
 * @type {readonly string[]}
 */
export const MOVER_WINDOWS = ['TODAY', '1W', '1M'];

/** The chart range key a window is priced from, or null for TODAY. */
export function rangeKeyForWindow(window) {
  return window === 'TODAY' ? null : (MOVER_WINDOWS.includes(window) ? window : null);
}

/**
 * One name's move over the window, in both measures.
 *
 * The dollar figure is the move valued on TODAY'S holding — shares now
 * x the price move across the window. That is the honest reading of
 * the question this panel asks ("what did this name's move do to me"),
 * and it is deliberately NOT a P/L attribution: a position opened
 * halfway through the window did not earn the whole window's move, and
 * the number that accounts for that is the performance panel's, which
 * walks the lot ledger. Percent is the primary measure here for that
 * reason.
 *
 * @param {any} player     a `computeMetrics` player (native `lastPrice`, USD `fx`)
 * @param {number|null} base  window-start close, native currency; null for TODAY
 * @returns {{pct: number, usd: number} | null}
 */
export function moveOver(player, base) {
  if (!player) return null;
  if (base == null) {
    return { pct: player.dayPct ?? 0, usd: player.dayChange ?? 0 };
  }
  const now = Number(player.lastPrice);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(now) || now <= 0) return null;
  const shares = Number(player.shares);
  const fx = Number(player.fx);
  const pct = ((now - base) / base) * 100;
  const usd = (Number.isFinite(shares) && Number.isFinite(fx)) ? shares * (now - base) * fx : 0;
  return { pct, usd };
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
 * `basePriceOf` returns the window-start close for a ticker, or null
 * when the cache has nothing for it yet; such a name simply doesn't
 * rank, rather than ranking off a price the panel had to invent.
 *
 * @param {any[]} players
 * @param {{
 *   window: string,
 *   metric: 'pct'|'usd',
 *   basePriceOf?: ((ticker: string) => number|null) | null,
 *   limit?: number,
 * }} opts
 * @returns {{winners: any[], losers: any[], scale: number, priced: number}}
 */
export function rankMovers(players, opts) {
  const { window, metric, basePriceOf, limit = 5 } = opts;
  const isToday = rangeKeyForWindow(window) === null;
  /** @type {any[]} */
  const rows = [];
  for (const p of players || []) {
    if (!p || p.isCash || p.ticker === 'CASH' || isCnFund(p.ticker)) continue;
    const base = isToday ? null : (basePriceOf ? basePriceOf(p.ticker) : null);
    if (!isToday && base == null) continue;
    const move = moveOver(p, base);
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
