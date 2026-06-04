// Shared SVG-chart geometry helpers used by both PerfChart and the
// TickerChartModal. Two near-identical copies of the same crosshair
// `handleMove` logic + path-builder existed in perf_chart.jsx and
// ticker_chart_modal.jsx; a fix in one (the 5-min slack on CLOSE
// marker, the OPEN-marker `lastDay` filter, etc.) had to be
// remembered in the other or the two would silently diverge again.
// Extracted here as pure functions so the bug shape can't recur.

/**
 * Map a pointer event's clientX to the index of the nearest data
 * point in a chart whose SVG viewBox is `[0, 0, W, H]` and whose
 * data axis spans `[padL, W - padR]` horizontally.
 *
 * Handles mouse + touch (touch coords live on `event.touches[0]`,
 * so the SVG can attach the same callback to both event families).
 * Accounts for SVG's default `preserveAspectRatio="xMidYMid meet"`
 * letterboxing — the rendered element's aspect ratio rarely matches
 * the viewBox exactly, so the math has to find the actual content-area
 * offset within the bounding rect or the crosshair drifts off the
 * data points near the edges of the chart.
 *
 * Clamps the cursor's chart-space x to `[padL, W - padR]` so dragging
 * the pointer into the axis padding pins the crosshair to the first /
 * last data point instead of snapping off.
 *
 * Returns `null` when:
 *   - `svgEl` is null (chart not mounted yet),
 *   - `dataLength <= 0` (no data to index into),
 *   - the event has no usable coords (synthetic event, blurred).
 *
 * @param {{ touches?: { clientX: number }[], clientX?: number } | null | undefined} event
 *   Mouse or touch event from React's onMouseMove / onTouchMove handlers.
 * @param {{ getBoundingClientRect: () => { left: number, width: number, height: number } } | null} svgEl
 *   The `<svg>` element ref (or any DOM node with the same surface — the test
 *   mocks it with just `getBoundingClientRect`).
 * @param {{ W: number, H: number, padL: number, padR: number, cW: number, xDenom?: number, hasLiveDot?: boolean }} geom
 *   Chart geometry: viewBox width/height, left/right axis padding, the
 *   pre-computed content width `cW = W - padL - padR`, an optional
 *   `xDenom` x-axis denominator override (see below), and an optional
 *   `hasLiveDot` flag — when set, returns `dataLength` (the live trailing
 *   dot) for pointers in the dot-half of the gap.
 * @param {number} dataLength
 *   Number of points in the series the crosshair is mapping to.
 * @returns {number | null}
 */
export function pointerToDataIndex(event, svgEl, geom, dataLength) {
  if (!svgEl || dataLength <= 0) return null;
  const clientX = event?.touches?.[0]?.clientX ?? event?.clientX;
  if (clientX == null) return null;
  const { W, H, padL, padR, cW } = geom;
  const rect = svgEl.getBoundingClientRect();
  if (!rect || !(rect.width > 0)) return null;
  const vbRatio = W / H;
  const elRatio = rect.width / rect.height;
  let contentW, offX;
  if (elRatio > vbRatio) {
    // Element is wider than viewBox → letterbox vertically; content is
    // horizontally centered with side bars of `(rect.width - contentW)/2`.
    const contentH = rect.height;
    contentW = contentH * vbRatio;
    offX = (rect.width - contentW) / 2;
  } else {
    // Element is taller than (or matches) viewBox aspect → full width,
    // letterbox top/bottom. No horizontal offset.
    contentW = rect.width;
    offX = 0;
  }
  // Map page-x → chart-space x (in viewBox units).
  const sx = ((clientX - rect.left - offX) / contentW) * W;
  const clampedSx = Math.max(padL, Math.min(W - padR, sx));
  // Index = round to nearest data slot. `geom.xDenom` lets a caller
  // override the x denominator when the bars don't fill the full
  // [padL, W-padR] span — e.g. the ticker modal's overnight view, which
  // reserves the right edge for the time-proportional gap + the live
  // trailing dot. Defaults to `dataLength - 1` (bars fill the width),
  // which is what PerfChart + the regular modal view pass. The final
  // clamp to [0, dataLength-1] means a pointer dragged into the gap
  // region pins to the last real bar rather than the trailing dot.
  const denom = (geom && typeof geom.xDenom === "number" && geom.xDenom > 0)
    ? geom.xDenom
    : Math.max(1, dataLength - 1);
  const frac = (clampedSx - padL) / cW;
  const rawI = frac * denom;
  // Live dot (overnight view): a single point sits at virtual index
  // `denom` (the far right), separated from the last bar (index
  // dataLength-1) by the time gap. When `geom.hasLiveDot` is set and the
  // pointer is past the midpoint of that gap, select the dot — signalled
  // by returning `dataLength` (one past the last bar) — so the crosshair
  // can snap onto the live point instead of clamping back to the last
  // bar. Callers without a dot don't pass the flag and never see it.
  if (geom && geom.hasLiveDot && rawI > (dataLength - 1 + denom) / 2) {
    return dataLength;
  }
  const i = Math.round(rawI);
  return Math.max(0, Math.min(dataLength - 1, i));
}

/**
 * How far past the last bar the live "now" dot sits, expressed in
 * bar-interval units, for the ticker modal's overnight view. The chart
 * is otherwise index-based (one step per bar, non-trading gaps
 * collapsed); this is the ONE place real elapsed time is honoured —
 * the current overnight session (last after-hours bar → now) is drawn
 * as a proportional gap so the trailing heartbeat dot floats at its
 * true-time position instead of snapping next to the 20:00 bar.
 *
 * Returns the gap in bar-interval units (0 when inputs are unusable),
 * so the caller can set the x denominator to `(dataLength - 1) + gap`
 * and place the dot at virtual index `(dataLength - 1) + gap` (the far
 * right edge).
 *
 * @param {number} lastBarMs    epoch ms of the last real bar
 * @param {number} nowMs        epoch ms of "now"
 * @param {number} barIntervalMs  the chart's bar interval (5m/30m/60m)
 * @returns {number}
 */
export function overnightTrailingGap(lastBarMs, nowMs, barIntervalMs) {
  if (!isFinite(lastBarMs) || !isFinite(nowMs) || !(barIntervalMs > 0)) return 0;
  return Math.max(0, (nowMs - lastBarMs) / barIntervalMs);
}

/**
 * Build the `d` attribute for an SVG `<path>` from a series of data
 * points + projection functions to chart-space (x, y) coords.
 *
 * Both PerfChart and the ticker-modal chart had near-identical
 * `'M' + items.map(p => xFn(p),yFn(p)).join('L')` constructions —
 * easy to keep in sync until the first time someone adds a stroke
 * smoothing / NaN filter to one and forgets the other. Centralising
 * here also gives a single place to drop in a curve interpolator
 * later if desired.
 *
 * Empty / null input returns the empty string — `<path d="">` is a
 * no-op so the caller can render conditionally without special-
 * casing the empty series.
 *
 * @template T
 * @param {T[] | null | undefined} items
 * @param {(p: T, i: number) => number} xFn
 * @param {(p: T, i: number) => number} yFn
 */
export function pointsToSvgPath(items, xFn, yFn) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const segs = [];
  for (let i = 0; i < items.length; i++) {
    const x = xFn(items[i], i);
    const y = yFn(items[i], i);
    if (!isFinite(x) || !isFinite(y)) continue;
    segs.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  if (segs.length === 0) return '';
  return 'M' + segs.join('L');
}

// Parse a chart-series date string to a Date. Intraday bars are
// `YYYY-MM-DDTHH:MM` (16 chars, no zone) and must be read as UTC — an
// explicit `Z` is appended so they don't render an hour off for
// non-UTC users; daily `YYYY-MM-DD` and anything else go straight to
// `new Date`. Single source for what perf_chart + ticker_chart_modal
// both used to define inline (byte-identical) as parsePerfDate /
// parseChartDate.
export function parseChartDateUTC(d) {
  if (typeof d !== 'string') return new Date(d);
  if (d.length === 16 && d[10] === 'T') return new Date(d + 'Z');
  return new Date(d);
}
