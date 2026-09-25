// The Agents detail chart — geometry only, no DOM.
//
// `agents.jsx` draws one strategy × symbol: the signal venue's closes as a
// line, its high–low as a wash behind them, the strategy's own fills as buy
// and sell marks, any resting order as a dashed segment at its price and the
// average cost as a dotted line. Every number the SVG needs is computed here
// so `agents.test.js` can pin it — the YTD bugs were all in maths that only a
// rendered chart could show.
//
// Time is UTC throughout, the way the rest of the Agents page reads it, and
// the x axis is a real time scale rather than an index: crypto trades every
// minute of the week, so there are no session gaps to close up.

import { dropDot00, MONTHS } from '../app/formatters.js';

/** Room for the y labels on the left and the x labels underneath. */
export const CHART_PAD = { padL: 54, padR: 14, padT: 14, padB: 26 };
/** The same, for a phone: shorter labels, less air. */
export const CHART_PAD_SM = { padL: 44, padR: 10, padT: 12, padB: 24 };

/** @param {number} v @param {number} lo @param {number} hi */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * A 1 / 2 / 5 step that gives about `want` gridlines over a range.
 * @param {number} range @param {number} [want]
 */
export function niceStep(range, want = 4) {
  if (!isFinite(range) || range <= 0) return 1;
  const raw = range / Math.max(1, want);
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / exp;
  return (n <= 1.5 ? 1 : n <= 3 ? 2 : n <= 7 ? 5 : 10) * exp;
}

/**
 * Gridline values inside [lo, hi] — never at the very edge of the plot, so a
 * label can't collide with the frame.
 * @param {number} lo @param {number} hi @param {number} [want]
 */
export function priceTicks(lo, hi, want = 4) {
  if (!isFinite(lo) || !isFinite(hi)) return [];
  if (hi <= lo) return [lo];
  const step = niceStep(hi - lo, want);
  const out = [];
  for (let k = Math.ceil(lo / step); k * step <= hi + step * 1e-9; k++) out.push(k * step);
  return out;
}

/**
 * A price for an axis label or a tooltip: as many decimals as the span on
 * screen needs and no more, so SOL at 110.25 and BTC at 86,000 both read.
 * @param {number | null | undefined} v @param {number} span
 */
export function fmtChartPrice(v, span) {
  if (v == null || !isFinite(v)) return '—';
  const d = span >= 200 ? 0 : span >= 20 ? 1 : span >= 2 ? 2 : span >= 0.2 ? 3 : 4;
  return dropDot00(v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
}

/** "14:03" on a minute chart, "18 Sep 14:00" on an hourly one, "18 Sep" on a 4-hour one. @param {number} ms @param {number} intervalMin */
/**
 * Every time this page prints is UK LOCAL time, the clock in the site's own
 * header — the loop thinks in UTC and the database stores UTC, but a person
 * reading "when did it buy" reads it against the clock they are looking at,
 * and two clocks on one screen is the bug. `Intl` resolves BST and GMT, so
 * this needs no DST table of its own. The month comes from the numeric part
 * the site's one table (`MONTHS` in formatters.js): `en-GB` abbreviates
 * September as "Sept", and no date on the site says that.
 * @param {number | string} ms
 * @returns {{ day: string, hh: string, mm: string } | null}
 */
export function londonParts(ms) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  const parts = LONDON_FMT.formatToParts(d);
  const at = (/** @type {string} */ type) => parts.find((x) => x.type === type)?.value ?? '';
  return { day: `${Number(at('day'))} ${MONTHS[Number(at('month')) - 1] ?? ''}`, hh: at('hour'), mm: at('minute') };
}
const LONDON_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function fmtChartTime(ms, intervalMin) {
  const t = londonParts(ms);
  if (!t) return '—';
  if (intervalMin <= 1) return `${t.hh}:${t.mm}`;
  if (intervalMin < 240) return `${t.day} ${t.hh}:${t.mm}`;
  return t.day;
}

/** The full stamp a tooltip or an order row carries: "18 Sep 15:03", UK local. @param {number | string} ms */
export function fmtChartStamp(ms) {
  const t = londonParts(ms);
  return t ? `${t.day} ${t.hh}:${t.mm}` : '—';
}

/** How the window reads in words, for the chart's subtitle. @param {number} intervalMin @param {number} spanMs */
export function windowText(intervalMin, spanMs) {
  const bar = intervalMin <= 1 ? '1-minute' : intervalMin < 240 ? '1-hour' : '4-hour';
  const hours = spanMs / 3600e3;
  const span = hours <= 36 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`;
  return `${bar} candles · last ${span}`;
}

/** An order still on the book is one the venue has not finished with. @param {{state?: string} | null | undefined} o */
export const isResting = (o) => o?.state === 'new' || o?.state === 'pending' || o?.state === 'partially_filled';

const EMPTY = {
  hasData: false, linePath: '', bandPath: '', yTicks: /** @type {any[]} */ ([]), xTicks: /** @type {any[]} */ ([]),
  fillMarks: /** @type {any[]} */ ([]), restingLines: /** @type {any[]} */ ([]), avgCost: /** @type {any} */ (null),
  points: /** @type {number[][]} */ ([]),
};

/**
 * Everything the SVG needs, in view-box units.
 *
 * @param {{
 *   candles?: number[][], fills?: any[], orders?: any[], position?: any,
 *   intervalMin?: number, width?: number, height?: number, nowMs?: number,
 *   pad?: {padL: number, padR: number, padT: number, padB: number},
 * }} args
 */
export function chartGeometry({
  candles = [], fills = [], orders = [], position = null,
  intervalMin = 60, width = 640, height = 220, nowMs = Date.now(), pad = CHART_PAD,
} = {}) {
  const { padL, padR, padT, padB } = pad;
  const x0 = padL, x1 = Math.max(padL + 20, width - padR);
  const y0 = padT, y1 = Math.max(padT + 20, height - padB);
  const frame = { width, height, x0, x1, y0, y1 };
  const pts = candles.filter((c) => Array.isArray(c) && c.length >= 5 && isFinite(c[0]) && isFinite(c[4]));
  const barMs = Math.max(60e3, intervalMin * 60e3);
  if (pts.length < 2) {
    return {
      ...EMPTY, ...frame, intervalMin, barMs, priceSpan: 0, t0: 0, t1: 0, p0: 0, p1: 0,
      last: /** @type {number | null} */ (null), xOf: (/** @type {number} */ _ms) => x0, yOf: (/** @type {number} */ _p) => y1,
    };
  }

  const lastT = pts[pts.length - 1][0];
  const t0 = pts[0][0];
  // The right edge: one bar past the last close, stretched to "now" when the
  // cache is current, but never more than three bars — a stale cache should
  // squeeze the line, not the whole window.
  const t1 = Math.max(t0 + barMs, Math.min(Math.max(lastT + barMs, nowMs), lastT + barMs * 3));

  const resting = (orders ?? []).filter(isResting);
  let lo = Infinity, hi = -Infinity;
  const see = (v) => { if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  for (const c of pts) { see(c[3]); see(c[2]); see(c[4]); }
  for (const f of fills ?? []) see(Number(f.price));
  for (const o of resting) see(Number(o.price));
  const inPosition = !!position && Number(position.base) > 0 && isFinite(Number(position.avgCost)) && Number(position.avgCost) > 0;
  if (inPosition) see(Number(position.avgCost));
  if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
  if (hi <= lo) { hi = lo + Math.abs(lo || 1) * 0.01; }
  const padY = (hi - lo) * 0.08;
  const p0 = lo - padY, p1 = hi + padY;

  const xOf = (ms) => x0 + ((clamp(ms, t0, t1) - t0) / (t1 - t0)) * (x1 - x0);
  const yOf = (p) => y1 - ((clamp(p, p0, p1) - p0) / (p1 - p0)) * (y1 - y0);

  let linePath = '';
  for (let i = 0; i < pts.length; i++) linePath += `${i ? 'L' : 'M'}${xOf(pts[i][0]).toFixed(1)} ${yOf(pts[i][4]).toFixed(1)}`;
  let up = '', down = '';
  for (let i = 0; i < pts.length; i++) {
    up += `${i ? 'L' : 'M'}${xOf(pts[i][0]).toFixed(1)} ${yOf(pts[i][2]).toFixed(1)}`;
    const j = pts.length - 1 - i;
    down += `L${xOf(pts[j][0]).toFixed(1)} ${yOf(pts[j][3]).toFixed(1)}`;
  }
  const bandPath = `${up}${down}Z`;

  const wantY = height >= 200 ? 4 : 3;
  const priceSpan = hi - lo;
  const yTicks = priceTicks(lo, hi, wantY).map((v) => ({ v, y: yOf(v), label: fmtChartPrice(v, priceSpan) }));
  const wantX = Math.max(2, Math.min(5, Math.floor((x1 - x0) / 100)));
  const xTicks = [];
  for (let k = 0; k < wantX; k++) {
    const i = wantX === 1 ? 0 : Math.round((k / (wantX - 1)) * (pts.length - 1));
    const t = pts[i][0];
    if (!xTicks.some((tk) => tk.t === t)) xTicks.push({ t, x: xOf(t), label: fmtChartTime(t, intervalMin) });
  }

  const fillMarks = (fills ?? []).map((f) => ({
    id: f.id, side: f.side, ts: f.ts, price: Number(f.price), base: Number(f.base), feeUsd: Number(f.feeUsd ?? 0),
    mode: f.mode, venue: f.venue, x: xOf(Date.parse(f.ts)), y: yOf(Number(f.price)),
  })).filter((f) => isFinite(f.x) && isFinite(f.y));

  const restingLines = resting.map((o) => ({
    id: o.id, side: o.side, price: Number(o.price), base: Number(o.base),
    xa: xOf(Date.parse(o.ts)), xb: x1, y: yOf(Number(o.price)),
  })).filter((o) => isFinite(o.xa) && isFinite(o.y));

  const avgCost = inPosition ? { price: Number(position.avgCost), y: yOf(Number(position.avgCost)) } : null;

  return {
    hasData: true, ...frame, intervalMin, barMs, t0, t1, p0, p1, priceSpan,
    points: pts, linePath, bandPath, yTicks, xTicks, fillMarks, restingLines, avgCost,
    last: /** @type {number | null} */ (pts[pts.length - 1][4]),
    xOf, yOf,
  };
}

/**
 * What the crosshair sits on for a pointer at `px` view-box units: the nearest
 * candle, and any fill close enough to it to be the one under the cursor.
 * @param {any} geo @param {number} px
 */
export function hoverPoint(geo, px) {
  if (!geo?.hasData || !isFinite(px)) return null;
  const { points, t0, t1, x0, x1 } = geo;
  const t = t0 + ((clamp(px, x0, x1) - x0) / (x1 - x0)) * (t1 - t0);
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < t) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1][0] - t) <= Math.abs(points[lo][0] - t)) lo--;
  const c = points[lo];
  const x = geo.xOf(c[0]);
  const near = geo.fillMarks.filter((f) => Math.abs(f.x - x) <= Math.max(4, (x1 - x0) / points.length / 2 + 3));
  return { i: lo, t: c[0], open: c[1], high: c[2], low: c[3], close: c[4], x, y: geo.yOf(c[4]), fills: near };
}

/**
 * Does a box cover any of these points? Used to keep the tooltip off the
 * fill marks and the average-cost label — the three things a reader opens
 * this chart to look at.
 * @param {{x: number, y: number, w: number, h: number}} box
 * @param {{x: number, y: number}[]} marks
 * @param {number} [pad]
 */
export function boxHitsMarks(box, marks, pad = 6) {
  return (marks ?? []).some((m) => m && isFinite(m.x) && isFinite(m.y)
    && m.x >= box.x - pad && m.x <= box.x + box.w + pad
    && m.y >= box.y - pad && m.y <= box.y + box.h + pad);
}

/**
 * The tooltip box: where it goes so it never leaves the plot, how wide it
 * has to be for the longest line it carries, and — given `avoid` — which of
 * the six places around the cursor leaves the marks visible. Preference
 * order is the one a reader expects (beside the cursor first, the side with
 * room first), so an empty `avoid` puts it exactly where it always was.
 * @param {any} geo @param {number} x @param {number} y @param {string[]} lines
 * @param {{x: number, y: number}[]} [avoid]
 */
export function tooltipBox(geo, x, y, lines, avoid = []) {
  const charW = 5.5, lineH = 12.5;
  const w = Math.max(74, Math.max(...lines.map((l) => l.length)) * charW + 14);
  const h = lines.length * lineH + 10;
  const top = geo.y0 + 1, bottom = geo.y1 - h - 1;
  const ys = [clamp(y - h / 2, top, bottom), clamp(y + 12, top, bottom), clamp(y - h - 12, top, bottom)];
  const xs = x + 10 + w <= geo.x1 ? [x + 10, x - 10 - w] : [x - 10 - w, x + 10];
  const cands = [];
  for (const bx of xs) {
    if (bx < geo.x0 || bx + w > geo.x1) continue;
    for (const by of ys) cands.push({ x: bx, y: by });
  }
  if (!cands.length) cands.push({ x: clamp(x + 10, geo.x0, Math.max(geo.x0, geo.x1 - w)), y: ys[0] });
  const pick = cands.find((c) => !boxHitsMarks({ ...c, w, h }, avoid)) ?? cands[0];
  return { x: pick.x, y: pick.y, w, h, lineH, textX: pick.x + 7, firstY: pick.y + 14 };
}

/**
 * Where an in-plot label sits so it does not read as part of the axis. The
 * average-cost label starts at the left edge of the plot, a few pixels from
 * the y-axis labels; when its baseline lands within `gap` of a gridline the
 * two collide into one line of text, so it drops half a line — and back up
 * if down would leave the plot.
 * @param {number} y the label's baseline
 * @param {{y: number}[]} ticks the y gridlines
 * @param {{gap?: number, nudge?: number, y0?: number, y1?: number}} [opts]
 */
export function plotLabelY(y, ticks, opts = {}) {
  const { gap = 10, nudge = 7, y0 = -Infinity, y1 = Infinity } = opts;
  const clash = (/** @type {number} */ yy) => (ticks ?? []).some((t) => t && isFinite(t.y) && Math.abs(t.y - yy) < gap);
  if (!clash(y)) return y;
  const down = y + nudge, up = y - nudge;
  if (down <= y1 && !clash(down)) return down;
  if (up >= y0 && !clash(up)) return up;
  return clamp(down, y0, y1);
}

/** The triangle a buy or a sell wears, centred on (x, y) at `r` half-height. @param {'buy'|'sell'|string} side @param {number} x @param {number} y @param {number} [r] */
export function markPath(side, x, y, r = 5) {
  const w = r * 1.15;
  return side === 'buy'
    ? `M${(x - w).toFixed(1)} ${(y + r).toFixed(1)}L${x.toFixed(1)} ${(y - r).toFixed(1)}L${(x + w).toFixed(1)} ${(y + r).toFixed(1)}Z`
    : `M${(x - w).toFixed(1)} ${(y - r).toFixed(1)}L${x.toFixed(1)} ${(y + r).toFixed(1)}L${(x + w).toFixed(1)} ${(y - r).toFixed(1)}Z`;
}
