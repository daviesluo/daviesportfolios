// The "Target price" page's rows (Davies, 2026-10-21): every holding on the board beside its analyst targets, as the
// `targets` job last wrote them (supabase/functions/targets, migration 0134) and the app's preload read them
// (targets_data.js). Pure: the page (target_price.jsx) renders what these return, and the tests pin them.
//
// The columns, exactly:
//   Weight          the holding's share of the whole book, cash included: the Holding list's Exposure, from the same
//                   function (`buildHoldingsRows`), so the two pages can never disagree.                       LIVE
//   Price           the price the board shows (`player.lastPrice`, in the holding's own currency).              LIVE
//   Avg target      the mean of the current targets.
//   Avg rating      the mean recommendation on Yahoo's scale, 1 (strong buy) to 5 (sell), shown with its word.
//   Avg range       the lowest and highest of all current targets.
//   Analysts        how many analysts the mean is of.
//   Fresh range     the lowest and highest of the targets set in the last 30 days, and how many there are: each firm's
//                   latest target, counted only when it was set in the window.
//   Avg vs price    the mean target against the price: mean / price − 1. The default sort, largest first.    LIVE
//   Key risks       a short note per holding, kept by hand (target_risks.js).
//
// LIVE: worked out here from the board's own `metrics` on every render, so they move at the board's tick (Davies,
// 2026-10-21): the page re-renders with each new `metrics` and asks nothing of the server. Every other column is the
// job's snapshot and moves only at its scheduled runs; "Updated HH:MM ET" is the time of that run.
//
// A row's kind says where its targets come from: a stock's sell-side consensus ("consensus"), an ETF's targets weighted
// by its holdings ("holdings": no source publishes a consensus for a fund), or bitcoin's dated bank targets kept by hand
// ("strategist": no API serves them). A holding with none shows "—" in every target column and sorts last.

import { buildHoldingsRows } from './holdings_list.jsx';
import { displayTicker } from '../app/formatters.js';
import { risksFor } from './target_risks.js';
import { fmtMoney } from '../app/formatters.js';
import { currencyAffix } from '../portfolio/fx.js';

export const FRESH_DAYS = 30;
const DAY = 86400e3;

/**
 * The word for a mean rating on Yahoo's 1–5 scale, at its own boundaries (RKLB's 1.619 is Yahoo's "buy").
 * @param {number | null | undefined} r
 */
export function ratingWord(r) {
  if (r == null || !Number.isFinite(r) || r <= 0) return null;
  if (r < 1.5) return 'Strong Buy';
  if (r < 2.5) return 'Buy';
  if (r < 3.5) return 'Hold';
  if (r < 4.5) return 'Underperform';
  return 'Sell';
}

/**
 * Each firm's latest target set in the last `days` days (and not after `nowMs`).
 * @param {Array<{ firm: string, target: number, at: string }>} targets @param {number} nowMs @param {number} [days]
 */
export function freshTargets(targets, nowMs, days = FRESH_DAYS) {
  return (targets || []).filter((t) => {
    const at = Date.parse(t.at);
    return Number.isFinite(at) && at <= nowMs && nowMs - at <= days * DAY && t.target > 0;
  });
}

/**
 * How a target in `from` is put in `to`: 1 for the same currency, ×1/100 or ×100 between pence and pounds, null for
 * anything else (the row then measures against the job's own price in the target's currency).
 * @param {string | null | undefined} from @param {string | null | undefined} to
 */
export function unitFactor(from, to) {
  if (!from || !to || from === to) return 1;
  if (from === 'GBp' && to === 'GBP') return 0.01;
  if (from === 'GBP' && to === 'GBp') return 100;
  return null;
}

/** @param {number | null | undefined} x */
const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
/** A percentage to a millionth of a point: the page shows one decimal, and a figure worked out by hand compares equal. @param {number} x */
const pct6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * One row per holding (cash left out), in the Holding list's order.
 * @param {any} metrics  computeMetrics output
 * @param {{ rows?: Record<string, any> } | null | undefined} data  the `targets` GET (targets_data.js)
 * @param {number} nowMs
 */
export function buildTargetRows(metrics, data, nowMs) {
  const holdings = buildHoldingsRows(metrics);
  /** @type {Map<string, any>} */
  const players = new Map();
  for (const pos of Object.values(metrics?.positions || {})) for (const p of (/** @type {any} */ (pos).players || [])) players.set(p.ticker, p);
  const snaps = data?.rows || {};
  return holdings.map((h) => {
    const p = players.get(h.ticker) || {};
    const display = displayTicker(h.ticker);
    const s = snaps[h.ticker] || null;
    const boardPrice = num(p.lastPrice);
    const row = {
      ticker: h.ticker, display, weight: h.exposure, price: boardPrice, currency: p.currency || null,
      kind: /** @type {'consensus' | 'holdings' | 'strategist' | null} */ (null),
      mean: /** @type {number | null} */ (null), low: /** @type {number | null} */ (null), high: /** @type {number | null} */ (null),
      avgVsPrice: /** @type {number | null} */ (null), rating: /** @type {number | null} */ (null), ratingWord: /** @type {string | null} */ (null),
      analysts: /** @type {number | null} */ (null), rangeSpread: /** @type {number | null} */ (null),
      fresh: /** @type {{ low: number, high: number, count: number } | null} */ (null), freshSpread: /** @type {number | null} */ (null),
      lowVsPrice: /** @type {number | null} */ (null), targetCurrency: /** @type {string | null} */ (null),
      coverage: /** @type {any} */ (null), sources: /** @type {any[] | null} */ (null), asOf: /** @type {string | null} */ (null),
      risks: '',
    };
    if (s && num(s.mean)) {
      // The targets in the board's unit; when the two currencies cannot be matched, the percentages are taken against the
      // job's own price in the targets' currency, and the targets are shown in theirs.
      const k = unitFactor(s.currency, p.currency);
      const scale = k ?? 1;
      const basis = k !== null ? boardPrice : num(s.refPrice);
      row.kind = s.kind;
      row.targetCurrency = k !== null ? (p.currency || s.currency || null) : (s.currency || null);
      row.mean = s.mean * scale;
      row.low = num(s.low) !== null ? s.low * scale : null;
      row.high = num(s.high) !== null ? s.high * scale : null;
      row.rating = num(s.rating);
      row.ratingWord = ratingWord(row.rating);
      row.analysts = num(s.analysts);
      if (s.kind === 'holdings') {
        row.fresh = s.fresh && num(s.fresh.low) ? { low: s.fresh.low * scale, high: s.fresh.high * scale, count: s.fresh.count } : null;
      } else {
        const fr = freshTargets(s.targets || [], nowMs).map((t) => t.target * scale);
        row.fresh = fr.length ? { low: Math.min(...fr), high: Math.max(...fr), count: fr.length } : null;
      }
      if (basis) {
        row.avgVsPrice = pct6((row.mean / basis - 1) * 100);
        row.lowVsPrice = row.low !== null ? pct6((row.low / basis - 1) * 100) : null;
        row.rangeSpread = row.low !== null && row.high !== null ? pct6(((row.high - row.low) / basis) * 100) : null;
        row.freshSpread = row.fresh ? pct6(((row.fresh.high - row.fresh.low) / basis) * 100) : null;
      }
      row.coverage = s.coverage || null;
      row.sources = Array.isArray(s.sources) ? s.sources : null;
      row.asOf = s.asOf || null;
    }
    row.risks = risksFor(display, row, nowMs);
    return row;
  });
}

/**
 * The page's columns. `sortKey` is what a click sorts by: the ranges by their width against the price (how far the
 * analysts are apart); Key risks does not sort.
 */
export const TARGET_COLUMNS = [
  { key: 'ticker', label: 'Symbol', sortKey: 'display', numeric: false, align: 'left', title: 'Sort by symbol' },
  { key: 'weight', label: 'Weight', sortKey: 'weight', numeric: true, align: 'right', title: 'Share of the whole book, cash included (the Holding list\'s Exposure). Live with the board' },
  { key: 'price', label: 'Price', sortKey: 'price', numeric: true, align: 'right', title: 'The price the board shows. Live with the board' },
  { key: 'mean', label: 'Avg target', sortKey: 'mean', numeric: true, align: 'right', title: 'Mean of the current targets' },
  { key: 'rating', label: 'Avg rating', sortKey: 'rating', numeric: true, align: 'right', title: 'Mean recommendation, 1 Strong Buy to 5 Sell. Sorts by the number' },
  { key: 'range', label: 'Avg range', sortKey: 'rangeSpread', numeric: true, align: 'right', title: 'Lowest to highest current target. Sorts by its width against the price' },
  { key: 'analysts', label: 'Analysts', sortKey: 'analysts', numeric: true, align: 'right', title: 'How many analysts the mean is of' },
  { key: 'fresh', label: 'Fresh range', sortKey: 'freshSpread', numeric: true, align: 'right', title: 'Lowest to highest of the targets set in the last 30 days, with how many. Sorts by its width against the price' },
  { key: 'avgVsPrice', label: 'Avg vs price', sortKey: 'avgVsPrice', numeric: true, align: 'right', title: 'Mean target against the price: avg / price − 1. Live with the board' },
  { key: 'risks', label: 'Key risks', sortKey: null, numeric: false, align: 'left', title: 'Kept by hand' },
];

export const DEFAULT_SORT = /** @type {{ key: string, dir: 'asc' | 'desc' }} */ ({ key: 'avgVsPrice', dir: 'desc' });

/**
 * The direction a column sorts in on its first click: text A→Z, numbers largest first, the rating best first (1 is a
 * strong buy). A second click turns it round.
 * @param {{ key: string, numeric: boolean }} col
 * @returns {'asc' | 'desc'}
 */
export function firstSortDir(col) {
  if (!col.numeric || col.key === 'rating') return 'asc';
  return 'desc';
}

/**
 * Rows sorted by `key` (a row field) and `dir`. A row without the value sorts last whichever way; ties keep the
 * Holding list's order. Returns a new array.
 * @template {Record<string, any>} R
 * @param {R[]} rows @param {string} key @param {'asc' | 'desc'} dir
 * @returns {R[]}
 */
export function sortTargetRows(rows, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const av = a.r[key], bv = b.r[key];
    const an = av == null || av === '' || (typeof av === 'number' && !Number.isFinite(av));
    const bn = bv == null || bv === '' || (typeof bv === 'number' && !Number.isFinite(bv));
    if (an || bn) return an && bn ? a.i - b.i : an ? 1 : -1;
    const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return c ? sign * c : a.i - b.i;
  }).map((x) => x.r);
}

/**
 * "Updated 09:30 ET" for a run today in New York, "Updated Oct 20, 16:00 ET" for an older one; null with no run.
 * @param {string | null | undefined} iso @param {number} nowMs
 */
export function updatedLabel(iso, nowMs) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const tz = 'America/New_York';
  const day = (/** @type {number} */ ms) => new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  if (day(t) === day(nowMs)) return `Updated ${hm} ET`;
  const md = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(t);
  return `Updated ${md}, ${hm} ET`;
}

/**
 * The decimals both ends of a range are written with, from the larger end: two under 100, none from 100 up. One
 * number of decimals for the pair, so a range never reads "34 – 63.60".
 * @param {number} lo @param {number} hi
 */
export function rangeDecimals(lo, hi) {
  return Math.max(Math.abs(lo), Math.abs(hi)) < 100 ? 2 : 0;
}

/**
 * A range for the Avg range and Fresh range columns, both ends alike ("$34.00 – $63.60", "$440 – $1,000"), each end
 * with the currency's symbol, so a range reads as money at either end and never as a count; one figure when the two
 * ends are the same. With `cur` left out, the bare numbers.
 * @param {number} lo @param {number} hi @param {string | null} [cur]
 */
export function fmtRange(lo, hi, cur) {
  const d = rangeDecimals(lo, hi);
  const { pre, post } = cur === undefined ? { pre: '', post: '' } : currencyAffix(cur);
  const f = (/** @type {number} */ n) => `${pre}${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}${post}`;
  return f(lo) === f(hi) ? f(lo) : `${f(lo)} – ${f(hi)}`;
}

/**
 * One price or target in its currency, as the Holding list writes money (`fmtMoney`: two decimals under 1,000, whole
 * numbers with separators from there): "$53.67", "$1,561", "€2.10", "£80.00"; "—" for none.
 * @param {number | null | undefined} n @param {string | null} cur
 */
export function fmtMoneyIn(n, cur) {
  if (n == null || !Number.isFinite(n)) return '—';
  const { pre, post } = currencyAffix(cur);
  return `${fmtMoney(n, { symbol: pre, compact: false })}${post}`;
}

/**
 * The tag under a fund's or bitcoin's symbol, and what hovering it says. A fund's names the share of its weight priced,
 * and, when any were left out, how many and why in plain words: a holding whose average target is under a fifth or over
 * five times its own price is taken for a data error (a target in another unit or for another listing).
 * @param {any} row
 * `mark` is what the cell shows, kept to a few characters so the frozen Symbol column stays as narrow as its longest
 * ticker (Davies, 2026-10-21: on a phone the full tag made the column half the screen): "HW 36%" for a fund's
 * holdings-weighted target with its coverage, "BANKS" for bitcoin's hand-kept bank targets. `text` says it in words.
 * @returns {{ mark: string, text: string, note: string, title: string } | null}
 */
export function kindTag(row) {
  if (row.kind === 'holdings') {
    const c = row.coverage;
    if (!c) return { mark: 'HW', text: 'holdings-weighted', note: '', title: 'Holdings-weighted target' };
    const skipped = Array.isArray(c.skipped) ? c.skipped : [];
    const skippedNote = skipped.length
      ? ` Left out as a likely data error, because the average target is under a fifth or over five times the holding's own price (a target in another unit or for another listing): ${skipped.map((/** @type {any} */ x) => `${x.symbol} (${(x.weight * 100).toFixed(1)}% of the fund, target ${Number(x.ratio).toFixed(2)}× its price)`).join('; ')}.`
      : '';
    return {
      mark: `HW ${(c.weight * 100).toFixed(0)}%`,
      text: `holdings-weighted · ${(c.weight * 100).toFixed(0)}%`,
      note: skipped.length ? `${skipped.length} skipped` : '',
      title: `Holdings-weighted target: the analyst targets of ${c.names} of the fund's holdings, ${(c.weight * 100).toFixed(0)}% of its weight, `
        + `each as a ratio to its own price and weighted by its share of the fund (${c.source}). No source publishes a consensus for a fund.${skippedNote}`,
    };
  }
  if (row.kind === 'strategist') return { mark: 'BANKS', text: 'strategist targets', note: '', title: strategistTitle(row) };
  return null;
}

/**
 * Each hand-kept target with its firm, date and horizon, one a line: the tooltip on bitcoin's row (its targets reach
 * different dates, end-2026 to mid-2027, and the average is of all of them).
 * @param {any} row
 */
export function strategistTitle(row) {
  const lines = (row.sources || []).map((/** @type {any} */ x) => `${x.firm}: $${Number(x.target).toLocaleString('en-US')}, horizon ${x.horizon} (published ${x.at})`);
  return `Strategist targets, kept by hand (no API serves them; a session refreshes the table):\n${lines.join('\n')}`;
}

