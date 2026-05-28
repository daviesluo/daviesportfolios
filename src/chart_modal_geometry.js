// Pure geometry computation for the ticker chart modal. Replaces the
// ~200-line block in `ticker_chart_modal.jsx` that intermixes:
//   - anchorClose selection (the % calc's denominator)
//   - hasData gate
//   - x/y scale fns (xOfIdx, yOf)
//   - chartXDenom (the index-based x-scale denominator, also exposed
//     to the crosshair so click-to-data-index uses the same scale)
//   - y range + ticks (with PE/PS/MA/VWAP/overnight-dot containment)
//   - x ticks (index-spaced)
//
// Why extract: the modal had grown to 1500+ lines and every chart bug
// in PR #157 had to be fixed in 8 different spots inside this block
// because the data-path branches threaded through it. Pulling the
// math out into a pure function lets a single fix land here AND lets
// the geometry get pinned by unit tests instead of relying on a
// React render to catch a regression.
//
// Inputs:
//   - `series`  — the pre-substitution bars (used only for
//                 `series[regularCloseIdx].close` in the anchor
//                 selection, since regularCloseIdx is computed
//                 against the same array).
//   - `points`  — the post-substitution bars (last bar's close
//                 carries `liveLast` when the live-tail substitution
//                 fired). All x positioning + y range derive from
//                 these.
//   - `regularCloseIdx`  — index in `series` of today's regular-close
//                          bar, or -1 if none. Passed in (not
//                          recomputed) because the modal's existing
//                          search uses mh.closeHh/Mm/openHh/Mm which
//                          aren't really part of the geometry's
//                          concern.
//   - `dimensions`  — { padL, padR, padT, padB, cW, cH } from the
//                     modal's outer layout.
//   - `anchorRefs`  — bag of inputs the anchor + y-range need to
//                     reach without forcing the function to know
//                     about market data / fundamentals shapes:
//                       { lastPriceAny, prevCloseAny, pe3yAvg,
//                         ps3yAvg, maSeries, vwapSeries }.
//
// Outputs match what the inline block produced. Crucially `hasData`
// stays `points.length >= 2 && anchorClose`, which the existing
// render branches check.

const FALLBACK_X = (padL) => (_i) => padL;
const FALLBACK_Y = (padT, cH) => (_p) => padT + cH / 2;

/**
 * Pick a "nice" axis step that gives roughly 5 ticks over a range.
 * Standard 1/2/5 progression, scaled by the order of magnitude.
 * @param {number} r
 */
function niceStep(r) {
  if (!isFinite(r) || r <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(r)));
  const norm = r / exp;
  if (norm < 1.5) return 0.2 * exp;
  if (norm < 3)   return 0.5 * exp;
  if (norm < 7)   return 1   * exp;
  return                2   * exp;
}

/**
 * @typedef {{date: string, close: number, volume?: number}} Point
 *
 * @typedef {{padL: number, padR: number, padT: number, padB: number, cW: number, cH: number}} Dimensions
 *
 * @typedef {{price: number, gap: number, dateStr: string} | null} OvernightDot
 *
 * @typedef {{
 *   lastPriceAny: number | null,
 *   prevCloseAny: number | null,
 *   pe3yAvg?:     number | null,
 *   ps3yAvg?:     number | null,
 *   maSeries?:    Array<number | null> | null,
 *   vwapSeries?:  Array<number | null> | null,
 * }} AnchorRefs
 *
 * @typedef {{
 *   anchorClose: number | null,
 *   hasData: boolean,
 *   xOfIdx: (i: number) => number,
 *   yOf: (p: number) => number,
 *   yMin: number,
 *   yMax: number,
 *   ticksY: number[],
 *   ticksX: Array<{x: number, date: string}>,
 *   chartXDenom: number,
 * }} ChartGeometry
 *
 * @param {{
 *   series: Point[] | null,
 *   points: Point[],
 *   rangeKey: string,
 *   useExt: boolean,
 *   isRatioRange: boolean,
 *   overnightDot: OvernightDot,
 *   regularCloseIdx: number,
 *   dimensions: Dimensions,
 *   anchorRefs: AnchorRefs,
 * }} args
 * @returns {ChartGeometry}
 */
export function computeChartGeometry({
  series,
  points,
  rangeKey,
  useExt,
  // isRatioRange is accepted because the modal threads it through;
  // the current code only branches on `rangeKey === 'PE' | 'PS'`
  // explicitly, but keeping the input means future ratio-axis
  // additions (P/B, EV/EBITDA…) don't need to change the signature.
  isRatioRange: _isRatioRange,
  overnightDot,
  regularCloseIdx,
  dimensions,
  anchorRefs,
}) {
  const { padL, padR: _padR, padT, padB: _padB, cW, cH } = dimensions;
  const { lastPriceAny, prevCloseAny, pe3yAvg, ps3yAvg, maSeries, vwapSeries } = anchorRefs;

  // ----- 1. anchorClose
  // The headline %'s denominator. 1D anchor at today's regular close
  // when ext-on (so SFTBY / ^VIX / ^TNX read ~0% after-hours instead
  // of yesterday's stale move); otherwise prevClose for the standard
  // "since previous close" reading. Multi-day ranges anchor at the
  // leftmost bar so the line starts at 0%.
  let anchorClose = null;
  if (series && series.length > 0) {
    if (rangeKey === '1D') {
      if (useExt) {
        if (regularCloseIdx >= 0) {
          anchorClose = series[regularCloseIdx].close;
        } else if (lastPriceAny && lastPriceAny > 0) {
          anchorClose = lastPriceAny;
        } else if (prevCloseAny && prevCloseAny > 0) {
          anchorClose = prevCloseAny;
        } else {
          anchorClose = series[0].close;
        }
      } else if (prevCloseAny && prevCloseAny > 0) {
        anchorClose = prevCloseAny;
      } else {
        anchorClose = series[0].close;
      }
    } else {
      anchorClose = series[0].close;
    }
  }

  // ----- 2. hasData + chartXDenom
  // chartXDenom is hoisted out of the hasData branch because the
  // crosshair (pointerToDataIndex) needs it even when the chart's
  // showing the loading/empty state.
  let xOfIdx = FALLBACK_X(padL);
  let yOf    = FALLBACK_Y(padT, cH);
  let yMin = 0, yMax = 0;
  /** @type {number[]} */
  const ticksY = [];
  /** @type {Array<{x: number, date: string}>} */
  const ticksX = [];
  let chartXDenom = Math.max(1, points.length - 1);
  const hasData = points.length >= 2 && !!anchorClose;

  if (hasData) {
    chartXDenom = overnightDot
      ? Math.max(1, points.length - 1) + overnightDot.gap
      : Math.max(1, points.length - 1);
    const denom = chartXDenom;
    xOfIdx = (i) => padL + (i / denom) * cW;

    // y-range containment: bring everything we'll draw inside the
    // bounds so it doesn't clip off the top / bottom. Adds the
    // trailing dot price (overnight view), the dashed PE/PS 3-yr-avg
    // reference line, and the MA / VWAP overlay values.
    const allP = points.map((p) => p.close);
    if (overnightDot) allP.push(overnightDot.price);
    if (rangeKey === 'PE' && typeof pe3yAvg === 'number' && pe3yAvg > 0) allP.push(pe3yAvg);
    if (rangeKey === 'PS' && typeof ps3yAvg === 'number' && ps3yAvg > 0) allP.push(ps3yAvg);
    if (Array.isArray(maSeries)) {
      for (const v of maSeries) {
        if (typeof v === 'number' && isFinite(v)) allP.push(v);
      }
    }
    if (Array.isArray(vwapSeries)) {
      for (const v of vwapSeries) {
        if (typeof v === 'number' && isFinite(v)) allP.push(v);
      }
    }
    const rawMin = Math.min(...allP), rawMax = Math.max(...allP);
    const yPad = Math.max(0.001, (rawMax - rawMin) * 0.08);
    yMin = rawMin - yPad;
    yMax = rawMax + yPad;
    const yRange = yMax - yMin || 1;
    yOf = (p) => padT + ((yMax - p) / yRange) * cH;

    // y ticks at a 1/2/5 step that gives ~5 marks.
    const step = niceStep(yMax - yMin);
    if (step > 0 && isFinite(step)) {
      for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
        ticksY.push(v);
      }
    }

    // x ticks at equally-spaced indices (NOT times, so labels track
    // actual bars instead of calendar gaps).
    const ticksToShow = rangeKey === '1D' ? 5 : 4;
    for (let i = 0; i <= ticksToShow; i++) {
      const idx = Math.round((points.length - 1) * (i / ticksToShow));
      const safeIdx = Math.max(0, Math.min(points.length - 1, idx));
      ticksX.push({ x: xOfIdx(safeIdx), date: points[safeIdx].date });
    }
    // Overnight: the bar ticks above sit in the compressed left
    // portion; add one more at the live dot's true-time x (far right)
    // labelled with "now" so the axis under the heartbeat dot
    // reflects the current time and refreshes each poll.
    if (overnightDot) {
      ticksX.push({ x: padL + cW, date: overnightDot.dateStr });
    }
  }

  return {
    anchorClose,
    hasData,
    xOfIdx,
    yOf,
    yMin,
    yMax,
    ticksY,
    ticksX,
    chartXDenom,
  };
}
