// Investment Performance — the account in dollars rather than percent:
// what the portfolio is worth against what was actually paid into it.
// The gap between the two lines is the money the account has made.
//
// Companion to PerfChart, which answers a different question (how the
// return compares with the S&P). Both live in the same panel slot and
// the header switches between them.
//
// Where the two lines come from:
//   - Stored 5-minute samples (`portfolio_snapshots`) wherever they
//     exist. A sold-out position leaves the board and the app stops
//     fetching its price history, so a recomputed past value would need
//     history for every symbol ever owned; a sample pins the number that
//     was actually on screen.
//   - Derived from the lot/sell ledger (`investmentPointAt`) for
//     everything older than the first sample — which, on a book that
//     predates this feature, is all of it.

import React from 'react';
import { fmtMoney, maskDigits } from './formatters.js';
import { RANGE_KEYS, investmentPointAt, computeAt, panelRangeLabel } from './ytd.js';
import { pointerToDataIndex, crosshairFormatFor } from './chart_geometry.js';

/** Window length per range, in ms. Mirrors the vs-S&P chart's ranges. */
const RANGE_SPAN_MS = {
  '1D':  24 * 3600_000,
  '1W':  7 * 24 * 3600_000,
  '1M':  30 * 24 * 3600_000,
  '3M':  91 * 24 * 3600_000,
  'YTD': 0,   // computed from Jan 1
};

/**
 * Start of the window for a range, epoch ms. YTD is measured from Jan 1
 * of the current year rather than a fixed span. Exported for tests.
 */
export function rangeStartMs(rangeKey, nowMs) {
  if (rangeKey === 'YTD') return new Date(new Date(nowMs).getUTCFullYear(), 0, 1).getTime();
  return nowMs - (RANGE_SPAN_MS[rangeKey] ?? RANGE_SPAN_MS['1M']);
}

/**
 * Merge stored samples with points derived from the ledger into one
 * series over `[startMs, nowMs]`.
 *
 * The OUTPUT timestamps are the derived grid — the same bars the vs-S&P
 * chart samples on. Stored samples win on VALUE wherever they exist
 * (they're what the scoreboard read at the time, and they cover tickers
 * whose price history is no longer fetched). A stored DEPOSIT is used
 * only when it agrees with the current accounting formula; rows written
 * during the T212 lot-wipe are rejected in favour of the derived amount.
 * Samples are overlaid onto those bars rather than appended as extra
 * x-slots. Concatenating the
 * 5-minute samples onto a daily/hourly axis is what stretched "today"
 * across half the 1W / 1M / 3M / YTD chart: index spacing gives every
 * point equal width, so seventeen samples on the last day occupied
 * seventeen times the space of every other day. vs-S&P never did that.
 *
 * Derived points fill everything before the first sample, so a book
 * that predates the sampler still charts its whole history. The
 * handover is one-way: every sample recorded pushes the boundary left.
 * Derived points carry `estimated: true`.
 *
 * When there is no derived grid (the history hasn't arrived yet), the
 * samples are returned as-is — better a 5-minute line than none.
 *
 * Exported for tests.
 *
 * @param {{ts:number, value:number, deposit:number}[]} snapshots ascending
 * @param {{ts:number, value:number, deposit:number}[]} derived   ascending
 * @param {number} startMs
 * @returns {{ts:number, value:number, deposit:number, estimated?:boolean}[]}
 */
export function mergeSeries(snapshots, derived, startMs) {
  const snaps = (snapshots || []).filter(p => p.ts >= startMs).slice().sort((a, b) => a.ts - b.ts);
  const grid = (derived || []).filter(p => p.ts >= startMs).slice().sort((a, b) => a.ts - b.ts);
  if (grid.length === 0) return snaps;
  if (snaps.length === 0) return grid.map(p => ({ ...p, estimated: true }));

  let si = 0;
  /** @type {{ts:number, value:number, deposit:number}|null} */
  let lastSnap = null;
  const out = [];
  for (const g of grid) {
    while (si < snaps.length && snaps[si].ts <= g.ts) {
      lastSnap = snaps[si];
      si++;
    }
    if (lastSnap) {
      const deposit = snapshotDepositMatches(lastSnap.deposit, g.deposit)
        ? lastSnap.deposit
        : g.deposit;
      out.push({ ts: g.ts, value: lastSnap.value, deposit });
    } else {
      out.push({ ...g, estimated: true });
    }
  }
  // Samples after the last bar still belong on the right edge — they
  // are the recorded "now" — but they must not become extra x-slots.
  if (out.length > 0 && si < snaps.length) {
    const latest = snaps[snaps.length - 1];
    const last = out[out.length - 1];
    const derivedLast = grid[grid.length - 1];
    const deposit = derivedLast && snapshotDepositMatches(latest.deposit, derivedLast.deposit)
      ? latest.deposit
      : (derivedLast?.deposit ?? last.deposit);
    out[out.length - 1] = { ts: last.ts, value: latest.value, deposit };
  }
  return out;
}

/**
 * A snapshot and the current formula should be numerically identical
 * apart from rounding. A 1% tolerance accepts that noise while rejecting
 * the production 40%+ T212-ledger collapse.
 *
 * @param {number} sampled
 * @param {number} derived
 */
export function snapshotDepositMatches(sampled, derived) {
  if (!isFinite(sampled) || !isFinite(derived)) return false;
  return Math.abs(sampled - derived) <= Math.max(1, Math.max(Math.abs(sampled), Math.abs(derived)) * 0.01);
}

/**
 * Put the board's CURRENT figures on the right-hand end.
 *
 * Samples land every five minutes and derived points stop at the last
 * fetched bar, so the line's last point was up to five minutes stale
 * while the scoreboard beside it was live — the same account reading two
 * different numbers on one screen. This pins the right edge to exactly
 * what the scoreboard shows.
 *
 * Replaces the last point rather than appending when that point is
 * already inside the current sample bucket: it's the same observation,
 * just fresher, and appending would draw a second point a pixel away.
 *
 * Exported for tests.
 *
 * @param {{ts:number, value:number, deposit:number, estimated?:boolean}[]} series
 * @param {{marketValue:number, netDeposit:number}|null|undefined} live
 * @param {number} [nowMs]
 */
export function withLivePoint(series, live, nowMs = Date.now()) {
  const rows = series || [];
  if (!live || !isFinite(live.marketValue) || live.marketValue < 0 || !isFinite(live.netDeposit)) return rows;
  const last = rows[rows.length - 1];
  // Inherit the trailing stretch's provenance. Marking the live point as
  // recorded when everything before it is reconstructed would split the
  // line one point from its right edge: a one-vertex segment that draws
  // nothing, behind a handover rule sitting on the frame.
  const point = {
    ts: nowMs, value: live.marketValue, deposit: live.netDeposit,
    ...(last?.estimated ? { estimated: true } : {}),
  };
  if (last && nowMs - last.ts < 5 * 60 * 1000) return [...rows.slice(0, -1), point];
  return [...rows, point];
}

/**
 * Round axis bounds + ticks for a dollar range.
 *
 * The first version padded the data range by a flat 12 % and drew no
 * axis at all, which meant the vertical extent was whatever the data
 * happened to be — you could see the shape of the line but not read a
 * value off it. Snapping to a 1 / 2 / 2.5 / 5 × 10ⁿ step instead gives
 * gridlines on round numbers ($130k, $140k, …), which is what makes the
 * axis worth having: every label is a number a person would say out
 * loud.
 *
 * The 8 % pre-pad is what keeps the line off the frame — without it a
 * series whose maximum lands exactly on a tick draws along the top
 * gridline. A dead-flat series (a board that hasn't moved, or one
 * single deposit level across the window) has no range to snap, so it
 * gets a band manufactured around it and sits in the middle instead of
 * on the floor.
 *
 * Exported for tests.
 *
 * @param {number} min
 * @param {number} max
 * @param {number} [target] roughly how many gaps to aim for
 * @returns {{ticks:number[], step:number, min:number, max:number}}
 */
export function niceMoneyTicks(min, max, target = 4) {
  if (!isFinite(min) || !isFinite(max)) return { ticks: [0, 1], step: 1, min: 0, max: 1 };
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  const dataLo = lo, dataHi = hi;
  if (hi - lo < Math.max(1e-9, Math.abs(hi) * 1e-9)) {
    const band = Math.max(Math.abs(hi) * 0.02, 1);
    lo -= band;
    hi += band;
  } else {
    const pad = (hi - lo) * 0.08;
    // Headroom must not invent a sign the account never had. An axis
    // that runs to −$100k because a $5k floor got padded down spends
    // half its height on money that was never owed, and squashes the
    // part that moved into the top corner.
    lo = dataLo >= 0 ? Math.max(0, lo - pad) : lo - pad;
    hi = dataHi <= 0 ? Math.min(0, hi + pad) : hi + pad;
  }
  // Pick the FINEST round step whose snapped bounds still fit inside the
  // tick budget. Rounding the ideal spacing to the nearest rung and
  // stopping there reads the padded range, not the snapped one, so it
  // overshoots: a $0–$216k window rounded up to a $100k step drew
  // $0/$100k/$200k/$300k and left a third of the height empty above the
  // data. Walking up from the finest rung instead lands on $50k — same
  // round labels, a third less waste.
  const maxTicks = Math.max(3, target + 2);
  const ideal = (hi - lo) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(ideal)));
  // Every rung divides into labels a person would say: 2, 2.5, 4, 5.
  const rungs = [1, 2, 2.5, 4, 5];
  const candidates = [mag, mag * 10, mag * 100]
    .flatMap(m => rungs.map(r => r * m))
    .sort((a, b) => a - b);
  const fits = (s) => Math.round((Math.ceil(hi / s) * s - Math.floor(lo / s) * s) / s) + 1 <= maxTicks;
  const step = candidates.find(fits) ?? candidates[candidates.length - 1];
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  // Multiply out rather than accumulate: repeated addition of a step
  // that isn't binary-exact drifts, which both drops the top tick
  // intermittently and lands the zero crossing on −1.4e-14 — labelled
  // "−$0". Anything within a rounding error of zero IS zero.
  const count = Math.round((last - first) / step);
  const ticks = [];
  for (let i = 0; i <= count; i++) {
    const t = first + i * step;
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return { ticks, step, min: first, max: ticks[ticks.length - 1] ?? last };
}

/**
 * Axis tick label — compact, because a full "$181,874" is wider than
 * the whole left gutter.
 *
 * The unit comes from the axis magnitude rather than each value, so
 * every label on the axis reads in the same scale ($130k / $140k, never
 * $950 / $1.0k), and the decimal count comes from the STEP, so adjacent
 * ticks can't collapse to the same string — a $2,500 step has to render
 * "$132.5k" or two rows both say "$132k". Exported for tests.
 *
 * @param {number} v
 * @param {number} step  the axis step, which decides the precision
 * @param {number} magnitude  largest absolute value on the axis
 */
export function axisMoneyLabel(v, step, magnitude) {
  // Zero carries no scale — "$0k" is just noise where "$0" is the line
  // that separates having money from owing it.
  if (v === 0) return '$0';
  const abs = Math.abs(magnitude);
  const div = abs >= 1e9 ? 1e9 : abs >= 1e6 ? 1e6 : abs >= 1e3 ? 1e3 : 1;
  const suffix = div === 1e9 ? 'B' : div === 1e6 ? 'M' : div === 1e3 ? 'k' : '';
  // Decimals are whatever it takes to render the STEP exactly in the
  // axis unit: a 2,500 step on a "k" axis has to read "$132.5k", because
  // at 0 decimals two neighbouring rows would both say "$132k".
  const scaled = Math.abs(step) / div;
  const whole = (n) => Math.abs(n - Math.round(n)) < 1e-9;
  const dp = whole(scaled) ? 0 : whole(scaled * 10) ? 1 : 2;
  // Minus U+2212 rather than a hyphen: it matches the digit width in the
  // mono face, so a negative label doesn't shift left of the others.
  return `${v < 0 ? '−' : ''}$${Math.abs(v / div).toFixed(dp)}${suffix}`;
}

function RangeButtons({ rangeKey, onChange }) {
  return (
    <div className="perf-range-row">
      {RANGE_KEYS.map(k => (
        <button
          key={k}
          type="button"
          className={`perf-range-btn mono${k === rangeKey ? ' on' : ''}`}
          onClick={() => onChange(k)}
        >{panelRangeLabel(k)}</button>
      ))}
    </div>
  );
}

/**
 * @param {{
 *   series: {ts:number, value:number, deposit:number, estimated?:boolean}[],
 *   rangeKey: string,
 *   setRangeKey: (k: string) => void,
 *   hideValues?: boolean,
 * }} props
 */
export function InvestmentChart({ series, rangeKey, setRangeKey, hideValues }) {
  // Crosshair refs + their effects run on EVERY render, including the
  // insufficient-data early return below, so React's hook count stays
  // stable across the empty → loaded transition. Getting this wrong is
  // minified error #310, which this app has shipped once already — keep
  // them above the early return.
  const svgRef      = React.useRef(/** @type {SVGSVGElement|null}   */ (null));
  const crossRef    = React.useRef(/** @type {SVGGElement|null}     */ (null));
  const cVlineRef   = React.useRef(/** @type {SVGLineElement|null}  */ (null));
  const cValDotRef  = React.useRef(/** @type {SVGCircleElement|null}*/ (null));
  const cDepDotRef  = React.useRef(/** @type {SVGCircleElement|null}*/ (null));
  const cDateRect   = React.useRef(/** @type {SVGRectElement|null}  */ (null));
  const cDateText   = React.useRef(/** @type {SVGTextElement|null}  */ (null));
  const cValRect    = React.useRef(/** @type {SVGRectElement|null}  */ (null));
  const cValText    = React.useRef(/** @type {SVGTextElement|null}  */ (null));
  const cDepRect    = React.useRef(/** @type {SVGRectElement|null}  */ (null));
  const cDepText    = React.useRef(/** @type {SVGTextElement|null}  */ (null));
  const rafRef        = React.useRef(0);
  const pendingIdxRef = React.useRef(/** @type {number|null} */ (null));
  React.useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);
  // A crosshair left pinned to index 40 of the old series would point at
  // an unrelated moment once the range changes under it.
  React.useEffect(() => {
    if (crossRef.current) crossRef.current.style.display = 'none';
  }, [rangeKey, series]);

  // Native non-passive touchmove, for the same reason PerfChart needs
  // one: React registers its synthetic onTouchMove passively at the
  // root, so preventDefault there is a no-op, and iOS Safari ignores
  // `touch-action` on an inline <svg> whose ancestor scrolls — which is
  // this chart's exact situation inside the sidebar. Without this a
  // finger drag scrolls the page instead of moving the crosshair.
  const handleMoveRef = React.useRef(/** @type {(e: any) => void} */ (() => {}));
  const touchCleanupRef = React.useRef(/** @type {(() => void) | null} */ (null));
  const setSvgNode = React.useCallback((/** @type {SVGSVGElement | null} */ node) => {
    if (touchCleanupRef.current) { touchCleanupRef.current(); touchCleanupRef.current = null; }
    svgRef.current = node;
    if (node) {
      const onTouchMove = (/** @type {TouchEvent} */ e) => {
        e.preventDefault();
        handleMoveRef.current(e);
      };
      node.addEventListener('touchmove', onTouchMove, { passive: false });
      touchCleanupRef.current = () => node.removeEventListener('touchmove', onTouchMove);
    }
  }, []);

  if (!Array.isArray(series) || series.length < 2) {
    return (
      <div className="perf-chart-wrap">
        <div className="sparkline-empty dim mono">Insufficient data</div>
        <RangeButtons rangeKey={rangeKey} onChange={setRangeKey} />
      </div>
    );
  }

  // Same SVG box, padding and index-based x spacing as PerfChart, so the
  // two views are interchangeable in the panel slot — swapping them
  // moves no chrome and the gridlines land in the same places. Index
  // spacing (rather than time) means weekend / overnight gaps draw no
  // empty stretches and a short window still fills the width.
  //
  // The left gutter is wider than PerfChart's 34: that axis labels
  // "+20%", this one "$182.5k".
  const W = 300, H = 106;
  const padL = 40, padR = 8, padT = 10, padB = 20;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  const denom = Math.max(1, series.length - 1);
  const xOf = (i) => padL + (i / denom) * cW;

  // Both lines share one axis — they're the same unit, and the whole
  // point of the chart is reading the gap between them.
  const vals = series.flatMap(p => [p.value, p.deposit]);
  const axis = niceMoneyTicks(Math.min(...vals), Math.max(...vals));
  const yRange = (axis.max - axis.min) || 1;
  const yOf = (v) => padT + ((axis.max - v) / yRange) * cH;
  const axisMagnitude = Math.max(Math.abs(axis.min), Math.abs(axis.max));

  const pathOf = (pick, from = 0, to = series.length - 1) => series
    .slice(from, to + 1)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(from + i).toFixed(1)},${yOf(pick(p)).toFixed(1)}`)
    .join(' ');

  // Where the recorded samples take over from the reconstruction. The
  // stretch to its left is derived from the lot ledger and today's price
  // history — a best effort at a past nobody was recording — and is
  // drawn faded so it doesn't read as a record of what the account
  // actually showed. Every sample the 5-minute sampler writes moves this
  // boundary left, so the faded stretch shrinks on its own until there
  // is none of it left. -1 (no recorded point in the window) means the
  // whole line is a reconstruction; 0 means all of it is recorded.
  const firstRecorded = series.findIndex(p => !p.estimated);
  const splitAt = firstRecorded === -1 ? series.length - 1 : firstRecorded;
  const hasEstimate = splitAt > 0;
  const allEstimated = firstRecorded === -1;
  // The band between the lines IS the money made, so it's worth seeing
  // as an area and not just as a distance to eyeball: value out, deposit
  // back. Tinted by where the account stands now — when the lines cross
  // mid-window the fill still marks the region between them.
  const bandPath = `${pathOf(p => p.value)} L${[...series].reverse()
    .map((p, i) => `${xOf(denom - i).toFixed(1)},${yOf(p.deposit).toFixed(1)}`)
    .join(' L')} Z`;

  const first = series[0];
  const last = series[series.length - 1];
  const gain = last.value - last.deposit;
  const money = (n) => (hideValues ? '••••' : fmtMoney(n));
  const gainColor = gain >= 0 ? 'var(--gain)' : 'var(--loss)';

  // Each line's move ACROSS THE WINDOW on screen, which is what the
  // range buttons select. Null from a zero or negative opening figure (a
  // YTD window that opens on an empty account): a percentage of nothing
  // isn't a number.
  const windowPct = (open, close) => (open > 0 ? ((close - open) / open) * 100 : null);
  // The VALUE figure has the window's deposits taken out of it first.
  // Paying $10k into a $30k account does not make it up 33 % — the
  // account got bigger, it did not perform — and reading it that way is
  // what put a wild number beside a week the vs-S&P view called +1.8 %.
  // Subtracting what came in over the window leaves the part that is
  // actually a result, which is the only half of this that belongs
  // beside a green or red sign. The deposit line's own percentage is
  // right there next to it, so the size change is still on screen.
  const netAdded = last.deposit - first.deposit;
  const valuePct = first.value > 0
    ? ((last.value - first.value - netAdded) / first.value) * 100
    : null;
  const depositPct = windowPct(first.deposit, last.deposit);
  const fmtP = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  // X labels: a handful of equally-spaced indices, the same sampling
  // PerfChart uses. Time-of-day for the intraday day, "Mon D" for the
  // multi-day intraday ranges (bar-level precision belongs on the
  // crosshair, not repeated six times along the axis), bare month for
  // the daily ones.
  const fmtAxisDate = (ts) => {
    const d = new Date(ts);
    if (rangeKey === '1D') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    // 3M joins 1W / 1M on "Mon D": six samples across a quarter land in
    // four calendar months, so bare month names come out as
    // "May Jun Jun Jul Aug Aug" — a repeat says nothing. YTD is long
    // enough that the months are genuinely distinct.
    if (rangeKey !== 'YTD') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleString('default', { month: 'short' });
  };
  /** @type {{x:number, anchor:'start'|'middle'|'end', grid:boolean, label:string}[]} */
  const xLabels = [];
  {
    const labelCount = rangeKey === '1D' ? 4 : 5;
    const seen = new Set();
    for (let i = 0; i <= labelCount; i++) {
      const idx = Math.max(0, Math.min(series.length - 1, Math.round(denom * (i / labelCount))));
      // A short series (day one, two samples) maps several sampled slots
      // onto the same point — draw it once.
      if (seen.has(idx)) continue;
      seen.add(idx);
      const x = xOf(idx);
      // The first and last labels bound the window, which is the most
      // useful thing the axis says, so they anchor inward instead of
      // being dropped for sitting on the edge. Only their own gridline
      // is skipped — it would just double the frame.
      const label = fmtAxisDate(series[idx].ts);
      // A repeat of the label already to its left adds nothing but ink.
      if (xLabels.length > 0 && xLabels[xLabels.length - 1].label === label) continue;
      const atStart = x <= padL + 12;
      const atEnd = x >= W - padR - 12;
      xLabels.push({
        x,
        anchor: atStart ? 'start' : atEnd ? 'end' : 'middle',
        grid: !atStart && !atEnd,
        label,
      });
    }
  }

  // Crosshair — DOM refs + setAttribute inside a rAF rather than React
  // state, because a state update per mousemove would reconcile a path
  // of up to ~290 points on every frame.
  const fmtCrosshairDate = (ts) => {
    const d = new Date(ts);
    const date = () => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = () => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const fmt = crosshairFormatFor(rangeKey);
    if (fmt === 'time') return time();
    if (fmt === 'datetime') return `${date()} ${time()}`;
    return date();
  };
  const CHIP_W = 46, CHIP_H = 11;
  function paintCrosshair() {
    rafRef.current = 0;
    const idx = pendingIdxRef.current;
    const g = crossRef.current;
    if (!g) return;
    const p = idx == null ? null : series[idx];
    if (!p) { g.style.display = 'none'; return; }
    g.style.display = '';
    const x = xOf(idx);
    const valY = yOf(p.value);
    const depY = yOf(p.deposit);
    if (cVlineRef.current) {
      cVlineRef.current.setAttribute('x1', x.toFixed(1));
      cVlineRef.current.setAttribute('x2', x.toFixed(1));
    }
    if (cValDotRef.current) {
      cValDotRef.current.setAttribute('cx', x.toFixed(1));
      cValDotRef.current.setAttribute('cy', valY.toFixed(1));
    }
    if (cDepDotRef.current) {
      cDepDotRef.current.setAttribute('cx', x.toFixed(1));
      cDepDotRef.current.setAttribute('cy', depY.toFixed(1));
    }
    // Date pill: wider for the ranges that show "MMM D HH:MM", and its
    // centre clamped so it never spills past either edge — at the live
    // point on the right it nudges inward instead of overflowing.
    const datePillW = crosshairFormatFor(rangeKey) === 'datetime' ? 80 : 44;
    const dpCx = Math.max(padL + datePillW / 2, Math.min(W - padR - datePillW / 2, x));
    if (cDateRect.current) {
      cDateRect.current.setAttribute('x', (dpCx - datePillW / 2).toFixed(1));
      cDateRect.current.setAttribute('width', String(datePillW));
    }
    if (cDateText.current) {
      cDateText.current.setAttribute('x', dpCx.toFixed(1));
      cDateText.current.textContent = fmtCrosshairDate(p.ts);
    }
    // Both chips ride the left gutter's inner edge and track their line
    // vertically. When the two lines nearly touch — the ordinary case
    // early in a window — the labels would stack on top of each other,
    // so the lower-value one is pushed clear.
    let valTop = valY - CHIP_H / 2;
    let depTop = depY - CHIP_H / 2;
    if (Math.abs(valTop - depTop) < CHIP_H + 1) {
      const mid = (valTop + depTop) / 2;
      const half = (CHIP_H + 1) / 2;
      valTop = valY <= depY ? mid - half : mid + half;
      depTop = valY <= depY ? mid + half : mid - half;
    }
    const place = (rect, text, top, label) => {
      if (!rect || !text) return;
      const clamped = Math.max(padT, Math.min(H - padB - CHIP_H, top));
      rect.setAttribute('y', clamped.toFixed(1));
      text.setAttribute('y', (clamped + CHIP_H / 2).toFixed(1));
      text.textContent = label;
    };
    // "~" on a reconstructed point: that figure was computed from the
    // ledger just now, not read off the board at the time.
    const mark = (n) => (p.estimated ? `~${money(n)}` : money(n));
    place(cValRect.current, cValText.current, valTop, mark(p.value));
    place(cDepRect.current, cDepText.current, depTop, mark(p.deposit));
  }
  function handleMove(e) {
    const idx = pointerToDataIndex(e, svgRef.current, { W, H, padL, padR, cW }, series.length);
    if (idx == null) return;
    pendingIdxRef.current = idx;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(paintCrosshair);
  }
  // Keep the native touchmove listener pointing at this render's closure
  // (and therefore this render's geometry) without re-binding it.
  handleMoveRef.current = handleMove;
  function handleLeave() {
    pendingIdxRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (crossRef.current) crossRef.current.style.display = 'none';
  }

  return (
    <div className="perf-chart-wrap">
      <div className="inv-legend mono">
        <span className="inv-legend-item">
          <span className="inv-dot" style={{ background: 'var(--chalk)' }} />
          Value {money(last.value)}
          {valuePct != null && (
            <span
              style={{ color: valuePct >= 0 ? 'var(--gain)' : 'var(--loss)' }}
              title="Return over this window, with anything paid in during it taken out"
            >{fmtP(valuePct)}</span>
          )}
        </span>
        <span className="inv-legend-item">
          <span className="inv-dot" style={{ background: 'var(--chalk-dim)' }} />
          Deposited {money(last.deposit)}
          {/* Deliberately NOT tinted green / red: more deposited is
              money moving in, not a result. Only the value line's move
              is a gain or a loss. */}
          {depositPct != null && <span>{fmtP(depositPct)}</span>}
        </span>
      </div>
      <svg
        ref={setSvgNode}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        // touchAction:none claims horizontal finger drags for the
        // crosshair rather than the browser's scroll gesture; the native
        // listener in setSvgNode is what makes that stick on iOS.
        style={{ display: 'block', touchAction: 'none' }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onTouchStart={handleMove}
      >
        {/* Y axis — gridline per round dollar step. The labels are
            masked (not dropped) under hideValues so the axis keeps its
            shape while the numbers stay private. */}
        {axis.ticks.map((t) => {
          const y = yOf(t);
          if (y < padT - 0.5 || y > H - padB + 0.5) return null;
          const label = axisMoneyLabel(t, axis.step, axisMagnitude);
          return (
            <g key={t}>
              <line x1={padL} y1={y.toFixed(1)} x2={W - padR} y2={y.toFixed(1)}
                    stroke="var(--line-2)" strokeWidth="0.5" strokeDasharray="2,3" />
              <text x={padL - 3} y={y.toFixed(1)} textAnchor="end" dominantBaseline="middle"
                    fontSize="7" fill="rgba(244,239,227,0.38)" fontFamily="var(--font-mono)">
                {hideValues ? maskDigits(label) : label}
              </text>
            </g>
          );
        })}
        {/* X axis — baseline plus a label every few points. */}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB}
              stroke="var(--line)" strokeWidth="0.8" />
        {xLabels.map((m, i) => (
          <g key={i}>
            {m.grid && (
              <line x1={m.x.toFixed(1)} y1={padT} x2={m.x.toFixed(1)} y2={H - padB}
                    stroke="var(--line-2)" strokeWidth="0.4" />
            )}
            <text x={m.x.toFixed(1)} y={H - padB + 9} textAnchor={m.anchor}
                  fontSize="7" fill="rgba(244,239,227,0.38)" fontFamily="var(--font-mono)">
              {m.label}
            </text>
          </g>
        ))}
        <path className="inv-band" d={bandPath} fill={gainColor} opacity="0.1" stroke="none" />
        {/* The reconstructed stretch, faded, plus a rule at the handover
            — left of it is computed from the ledger, right of it is what
            was actually recorded. */}
        {hasEstimate && (
          <>
            <path className="inv-line inv-line-est" d={pathOf(p => p.deposit, 0, splitAt)}
                  fill="none" stroke="var(--chalk-dim)" opacity="0.4"
                  strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            <path className="inv-line inv-line-est" d={pathOf(p => p.value, 0, splitAt)}
                  fill="none" stroke="var(--chalk)" opacity="0.4"
                  strokeWidth="1.5" vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round" strokeLinecap="round" />
            {!allEstimated && (
              <line className="inv-handover" x1={xOf(splitAt).toFixed(1)} y1={padT}
                    x2={xOf(splitAt).toFixed(1)} y2={H - padB}
                    stroke="var(--chalk-dim)" strokeWidth="0.5" strokeDasharray="1,2" />
            )}
          </>
        )}
        {/* Deposited sits underneath — it's the reference the value line
            is read against, so the value line stays on top and legible
            wherever they cross. */}
        {!allEstimated && (
          <>
            <path className="inv-line inv-line-deposit" d={pathOf(p => p.deposit, splitAt)}
                  fill="none" stroke="var(--chalk-dim)"
                  strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            <path className="inv-line inv-line-value" d={pathOf(p => p.value, splitAt)}
                  fill="none" stroke="var(--chalk)"
                  strokeWidth="1.5" vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
        {/* Live point */}
        <circle cx={xOf(series.length - 1).toFixed(1)} cy={yOf(last.value).toFixed(1)}
                r="2.5" fill="var(--chalk)" stroke="#0c1310" strokeWidth="1.2"
                opacity={allEstimated ? 0.4 : 1} />
        {/* Crosshair — hidden until the pointer enters, then updated
            imperatively. */}
        <g className="inv-crosshair" ref={crossRef} style={{ display: 'none' }}>
          <line ref={cVlineRef} x1={padL} y1={padT} x2={padL} y2={H - padB}
                stroke="rgba(244,239,227,0.5)" strokeWidth="0.6" strokeDasharray="2,2" />
          <circle ref={cValDotRef} cx={padL} cy={padT} r="2.5"
                  fill="var(--chalk)" stroke="#0c1310" strokeWidth="1" />
          <circle ref={cDepDotRef} cx={padL} cy={padT} r="2.5"
                  fill="var(--chalk-dim)" stroke="#0c1310" strokeWidth="1" />
          <rect ref={cDateRect} x={padL} y={H - padB + 1} width={44} height={CHIP_H}
                fill="#0c1310" stroke="var(--chalk-dim)" strokeWidth="0.5" />
          <text ref={cDateText} x={padL} y={H - padB + 9} textAnchor="middle"
                fontSize="7" fill="var(--chalk)" fontFamily="var(--font-mono)" />
          <rect ref={cValRect} x={padL + 4} y={padT} width={CHIP_W} height={CHIP_H} rx={1.5}
                fill="rgba(244,239,227,0.9)" />
          <text ref={cValText} x={padL + 4 + CHIP_W / 2} y={padT} dominantBaseline="middle"
                textAnchor="middle" fontSize="7" fill="#0c1310"
                fontFamily="var(--font-mono)" fontWeight="600" />
          <rect ref={cDepRect} x={padL + 4} y={padT} width={CHIP_W} height={CHIP_H} rx={1.5}
                fill="rgba(12,19,16,0.9)" stroke="var(--chalk-dim)" strokeWidth="0.5" />
          <text ref={cDepText} x={padL + 4 + CHIP_W / 2} y={padT} dominantBaseline="middle"
                textAnchor="middle" fontSize="7" fill="var(--chalk)"
                fontFamily="var(--font-mono)" />
        </g>
      </svg>
      <RangeButtons rangeKey={rangeKey} onChange={setRangeKey} />
    </div>
  );
}

/**
 * Derive the ledger-only series over a window. Used for everything older
 * than the first stored sample.
 *
 * The VALUE comes from `computeAt` — the very same call the vs-S&P chart
 * makes for its PORTFOLIO line, given the same inputs. That is the whole
 * point: this chart is that line in dollars, so it has no business
 * arriving at a different number for the same moment. Two independent
 * reconstructions of one quantity drift, and did: one priced a missing
 * bar by carrying the last close, the other by interpolating from lot
 * cost, and the two charts disagreed about the same week.
 *
 * The DEPOSIT still comes from `investmentPointAt`, which is a different
 * question — money in, not market value — and needs the sells that
 * `computeAt` has no reason to track.
 *
 * @param {{
 *   portfolio: any, tickerSeries: any, marketData: any,
 *   fxToUSD: any, dates: string[], useExt?: boolean, rangeKey?: string,
 *   t212Cash?: {transactions: any[], orders?: any[], complete: boolean}|null,
 * }} opts
 * @returns {{ts:number, value:number, deposit:number}[]}
 */
export function deriveSeries({ portfolio, tickerSeries, marketData, fxToUSD, dates, useExt = false, rangeKey = 'YTD', t212Cash }) {
  const out = [];
  const all = dates || [];
  if (all.length === 0) return out;
  const yearStart = all[0];
  const liveAnchorDate = all[all.length - 1];
  const todayMs = Date.now();
  for (const d of all) {
    const ts = Date.parse(d.length > 10 ? `${d}:00Z` : `${d}T00:00:00Z`);
    if (!isFinite(ts)) continue;
    const { value } = computeAt({
      portfolio, tickerSeries, marketData, fxToUSD, date: d,
      yearStart, yearStartDate: yearStart, todayMs, liveAnchorDate, useExt,
      // The vs-S&P line forces a prevClose basis on 1D so its right edge
      // equals the scoreboard's DAY CHANGE. That only moves the BASIS,
      // never the value, so it's irrelevant here — passed anyway so the
      // two calls stay literally identical.
      prevCloseBasis: rangeKey === '1D',
    });
    const { netDeposit } = investmentPointAt({
      portfolio, tickerSeries, date: d, marketData, fxToUSD, t212Cash,
    });
    // One NaN would take the whole axis with it — a holding whose
    // `shares` never got filled in is enough to produce one, via the
    // stand-in lot `lotsFor` swaps in. Drop the point instead.
    if (!isFinite(value) || !isFinite(netDeposit)) continue;
    out.push({ ts, value, deposit: netDeposit });
  }
  return out;
}
