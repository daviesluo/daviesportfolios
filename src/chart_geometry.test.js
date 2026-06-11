// Pins for the shared chart geometry helpers — same crosshair math
// previously lived inline in both perf_chart.jsx and
// ticker_chart_modal.jsx. Each fix to one had to be remembered in
// the other; extracting + pinning here means a regression in either
// chart now fails CI before deploy.

import { describe, expect, it } from 'vitest';
import { pointerToDataIndex, pointsToSvgPath, overnightTrailingGap, parseChartDateUTC, findRegularCloseIdx, findPrevSessionCloseIdx } from './chart_geometry.js';

// Fake an SVG element with just the surface the helper touches.
function fakeSvg(rect) {
  return { getBoundingClientRect: () => rect };
}

const GEOM_DEFAULT = { W: 100, H: 60, padL: 10, padR: 10, cW: 80 };

describe('pointerToDataIndex', () => {
  it('null svg → null', () => {
    expect(pointerToDataIndex({ clientX: 50 }, null, GEOM_DEFAULT, 10)).toBe(null);
  });

  it('zero-length data → null', () => {
    const svg = fakeSvg({ left: 0, width: 100, height: 60 });
    expect(pointerToDataIndex({ clientX: 50 }, svg, GEOM_DEFAULT, 0)).toBe(null);
  });

  it('no clientX or touches → null (synthetic event guard)', () => {
    const svg = fakeSvg({ left: 0, width: 100, height: 60 });
    expect(pointerToDataIndex({}, svg, GEOM_DEFAULT, 10)).toBe(null);
    expect(pointerToDataIndex(null, svg, GEOM_DEFAULT, 10)).toBe(null);
  });

  it('zero-width rect → null (chart not laid out yet)', () => {
    const svg = fakeSvg({ left: 0, width: 0, height: 0 });
    expect(pointerToDataIndex({ clientX: 50 }, svg, GEOM_DEFAULT, 10)).toBe(null);
  });

  it('exact viewBox aspect (no letterbox) — center cursor → middle index', () => {
    // rect aspect = 100/60 = viewBox aspect, so contentW = rect.width, offX = 0.
    const svg = fakeSvg({ left: 0, width: 100, height: 60 });
    // 10 points → indices 0..9. Cursor at chart-space x=50 lands at
    // frac = (50-10)/80 = 0.5, denom = 9, → round(4.5) = 5 (banker's rounding
    // off; Math.round in V8 rounds half-away-from-zero so 4.5 → 5).
    expect(pointerToDataIndex({ clientX: 50 }, svg, GEOM_DEFAULT, 10)).toBe(5);
  });

  it('cursor in left axis padding → pins to first point (index 0)', () => {
    const svg = fakeSvg({ left: 0, width: 100, height: 60 });
    // clientX=5 maps to sx=5; clamp to padL=10; frac=0; round(0)=0.
    expect(pointerToDataIndex({ clientX: 5 }, svg, GEOM_DEFAULT, 10)).toBe(0);
    // Also true exactly AT the padding edge.
    expect(pointerToDataIndex({ clientX: 0 }, svg, GEOM_DEFAULT, 10)).toBe(0);
  });

  it('cursor in right axis padding → pins to last point', () => {
    const svg = fakeSvg({ left: 0, width: 100, height: 60 });
    // clientX past W-padR=90 → clamp to 90; frac=80/80=1; round(9)=9.
    expect(pointerToDataIndex({ clientX: 95 }, svg, GEOM_DEFAULT, 10)).toBe(9);
    expect(pointerToDataIndex({ clientX: 100 }, svg, GEOM_DEFAULT, 10)).toBe(9);
  });

  it('single-point series → always returns 0 (no division by zero)', () => {
    const svg = fakeSvg({ left: 0, width: 100, height: 60 });
    expect(pointerToDataIndex({ clientX: 50 }, svg, GEOM_DEFAULT, 1)).toBe(0);
  });

  it('horizontal letterbox — wide element, cursor needs offX correction', () => {
    // viewBox 100/60 ≈ 1.667. Make element 200×60 → aspect 3.33 (wider).
    // contentH = 60, contentW = 60 * 1.667 = 100. offX = (200-100)/2 = 50.
    // Pointer at clientX=150 → sx = (150-0-50)/100 * 100 = 100 → clamps to 90 → last point.
    const svg = fakeSvg({ left: 0, width: 200, height: 60 });
    expect(pointerToDataIndex({ clientX: 150 }, svg, GEOM_DEFAULT, 10)).toBe(9);
    // Pointer at clientX=100 (middle of element, which is also middle of content
    // since the bars are symmetric) → sx = (100-50)/100 * 100 = 50 → mid index 5.
    expect(pointerToDataIndex({ clientX: 100 }, svg, GEOM_DEFAULT, 10)).toBe(5);
  });

  it('rect.left offset (chart scrolled into view) — subtracted correctly', () => {
    // Element starts at page-x = 200, width 100. Cursor clientX 250 → sx = 50.
    const svg = fakeSvg({ left: 200, width: 100, height: 60 });
    expect(pointerToDataIndex({ clientX: 250 }, svg, GEOM_DEFAULT, 10)).toBe(5);
  });

  it('touch event — reads from e.touches[0].clientX', () => {
    const svg = fakeSvg({ left: 0, width: 100, height: 60 });
    const touchEvent = { touches: [{ clientX: 50 }] };
    expect(pointerToDataIndex(touchEvent, svg, GEOM_DEFAULT, 10)).toBe(5);
  });

  it('mouse coords win over touches when both present (mouse-first)', () => {
    // React mouse events technically don't carry .touches but defensive paths
    // sometimes set both — pin the precedence so a future refactor doesn't
    // flip it silently.
    const svg = fakeSvg({ left: 0, width: 100, height: 60 });
    // touches takes precedence in the impl (touchEvent on mobile sometimes
    // also carries a clientX from coalesced events).
    const e = { clientX: 90, touches: [{ clientX: 10 }] };
    expect(pointerToDataIndex(e, svg, GEOM_DEFAULT, 10)).toBe(0);
  });
});

describe('pointsToSvgPath', () => {
  it('empty / null input → empty path string', () => {
    expect(pointsToSvgPath(null, () => 0, () => 0)).toBe('');
    expect(pointsToSvgPath(undefined, () => 0, () => 0)).toBe('');
    expect(pointsToSvgPath([], () => 0, () => 0)).toBe('');
  });

  it('basic shape — single M + L-joined coords, 1-decimal precision', () => {
    const pts = [{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 }];
    const out = pointsToSvgPath(pts, (p) => p.x, (p) => p.y);
    expect(out).toBe('M10.0,20.0L30.0,40.0L50.0,60.0');
  });

  it('drops non-finite coords (NaN / Infinity) instead of polluting the path', () => {
    const pts = [{ x: 10, y: 20 }, { x: NaN, y: 40 }, { x: 50, y: 60 }];
    const out = pointsToSvgPath(pts, (p) => p.x, (p) => p.y);
    expect(out).toBe('M10.0,20.0L50.0,60.0');
  });

  it('all-non-finite input → empty path (caller can conditionally render)', () => {
    const pts = [{ x: NaN, y: 1 }, { x: 2, y: Infinity }];
    const out = pointsToSvgPath(pts, (p) => p.x, (p) => p.y);
    expect(out).toBe('');
  });

  it('xFn / yFn get index as second arg — enables i-indexed projection', () => {
    const pts = ['a', 'b', 'c'];
    const out = pointsToSvgPath(pts, (_p, i) => i * 10, () => 0);
    expect(out).toBe('M0.0,0.0L10.0,0.0L20.0,0.0');
  });
});

describe('pointerToDataIndex — xDenom override (overnight gap view)', () => {
  const svg = fakeSvg({ left: 0, width: 100, height: 60 });

  it('with xDenom, bars compress left — the same clientX maps to a larger index', () => {
    // 10 bars (indices 0..9). Without xDenom, x=50 → frac 0.5 → index 5.
    // With xDenom=19 (gap of 10 reserved on the right), x=50 → 0.5*19 ≈ 9.5
    // → rounds to 9 then clamps to last bar (9). The far-right region is
    // the reserved gap → the trailing dot, never a bar.
    const geom = { ...GEOM_DEFAULT, xDenom: 19 };
    expect(pointerToDataIndex({ clientX: 50 }, svg, geom, 10)).toBe(9);
  });

  it('with xDenom, an early-x cursor still reaches the low bars', () => {
    // x=18 → frac (18-10)/80 = 0.1 → 0.1*19 = 1.9 → round 2.
    const geom = { ...GEOM_DEFAULT, xDenom: 19 };
    expect(pointerToDataIndex({ clientX: 18 }, svg, geom, 10)).toBe(2);
  });

  it('cursor dragged into the reserved gap clamps to the last real bar', () => {
    const geom = { ...GEOM_DEFAULT, xDenom: 19 };
    expect(pointerToDataIndex({ clientX: 95 }, svg, geom, 10)).toBe(9);
  });

  it('xDenom omitted → behaves exactly as dataLength-1 (back-compat)', () => {
    expect(pointerToDataIndex({ clientX: 50 }, svg, GEOM_DEFAULT, 10)).toBe(5);
  });
});

describe('pointerToDataIndex — hasLiveDot (overnight trailing dot selectable)', () => {
  const svg = fakeSvg({ left: 0, width: 100, height: 60 });
  // 10 bars (0..9) fill the left part; xDenom 19 reserves a gap of 10 on
  // the right whose far end (virtual index 19) is the live dot. Midpoint
  // of the gap is virtual index (9 + 19)/2 = 14 → chart-x where
  // rawI = 14: frac = 14/19 → clampedSx = padL + frac*cW = 10 + 0.7368*80
  // ≈ 68.9. So clientX ≈ 69 is the boundary.
  const geom = { ...GEOM_DEFAULT, xDenom: 19, hasLiveDot: true };

  it('pointer in the dot-half of the gap → returns dataLength (the dot)', () => {
    // clientX 90 → frac (90-10)/80 = 1 → rawI 19 > 14 → dot.
    expect(pointerToDataIndex({ clientX: 90 }, svg, geom, 10)).toBe(10);
  });

  it('pointer still over the bars → returns a bar index, not the dot', () => {
    // clientX 40 → frac 0.375 → rawI 7.125 → ≤ 14 → bar, round 7.
    expect(pointerToDataIndex({ clientX: 40 }, svg, geom, 10)).toBe(7);
  });

  it('without hasLiveDot, the gap clamps to the last bar (no dot)', () => {
    const noDot = { ...GEOM_DEFAULT, xDenom: 19 };
    expect(pointerToDataIndex({ clientX: 90 }, svg, noDot, 10)).toBe(9);
  });
});

describe('overnightTrailingGap', () => {
  const BAR = 5 * 60_000; // 5 m

  it('returns elapsed time in bar-interval units', () => {
    const last = 1_000_000_000_000;
    expect(overnightTrailingGap(last, last + 6 * BAR, BAR)).toBe(6);
    expect(overnightTrailingGap(last, last + 0.5 * BAR, BAR)).toBe(0.5);
  });

  it('clamps negative (now before last bar — clock skew) to 0', () => {
    const last = 1_000_000_000_000;
    expect(overnightTrailingGap(last, last - 10 * BAR, BAR)).toBe(0);
  });

  it('non-finite / non-positive inputs → 0', () => {
    expect(overnightTrailingGap(NaN, 1, BAR)).toBe(0);
    expect(overnightTrailingGap(1, NaN, BAR)).toBe(0);
    expect(overnightTrailingGap(1, 2, 0)).toBe(0);
    expect(overnightTrailingGap(1, 2, -5)).toBe(0);
  });
});

describe('parseChartDateUTC', () => {
  it('appends Z to the 16-char intraday shape so it reads as UTC', () => {
    // "YYYY-MM-DDTHH:MM" (no zone) must be treated as UTC, not local —
    // the BST-off-by-an-hour bug both charts hit before this was shared.
    const d = parseChartDateUTC('2026-06-04T13:30');
    expect(d.getTime()).toBe(Date.UTC(2026, 5, 4, 13, 30));
  });

  it('parses a plain YYYY-MM-DD daily date without forcing UTC time', () => {
    // No 'Z' appended for the 10-char shape — `new Date('2026-06-04')`
    // is already UTC-midnight by spec, so the value round-trips.
    const d = parseChartDateUTC('2026-06-04');
    expect(d.getTime()).toBe(Date.parse('2026-06-04'));
  });

  it('passes non-strings straight to new Date', () => {
    const ms = Date.UTC(2026, 0, 1);
    expect(parseChartDateUTC(ms).getTime()).toBe(ms);
  });

  it('does not append Z when the 11th char is not T (defensive)', () => {
    // 16 chars but not the intraday shape → left to new Date as-is.
    const s = '2026-06-04 13:30';
    expect(parseChartDateUTC(s).getTime()).toBe(new Date(s).getTime());
  });
});

describe('findRegularCloseIdx', () => {
  const mh = { closeHh: 20, closeMm: 0 }; // 20:00 UTC = 16:00 EDT close
  const series = [
    { date: '2026-06-03T19:30', close: 1 },
    { date: '2026-06-03T20:00', close: 2 }, // ← the close bar
    { date: '2026-06-03T20:30', close: 3 }, // after-hours
    { date: '2026-06-04T08:00', close: 4 }, // next-day premarket
  ];

  it('returns the index of the exact closeHh:closeMm bar', () => {
    expect(findRegularCloseIdx(series, mh)).toBe(1);
  });

  it('picks the LATEST matching close when several days are present', () => {
    const two = [...series, { date: '2026-06-04T20:00', close: 5 }];
    expect(findRegularCloseIdx(two, mh)).toBe(4);
  });

  it('returns -1 when no bar sits exactly on the close (strict match)', () => {
    // A 20:05 bar must NOT count — the +5min slack bug pinned the marker
    // to the wrong bar.
    const slack = [{ date: '2026-06-03T19:55', close: 1 }, { date: '2026-06-03T20:05', close: 2 }];
    expect(findRegularCloseIdx(slack, mh)).toBe(-1);
  });

  it('skips short / malformed date strings instead of NaN-matching', () => {
    const bad = [{ date: '2026-06-03' }, { date: '2026-06-03T20:00', close: 9 }];
    expect(findRegularCloseIdx(bad, mh)).toBe(1);
  });

  it('guards null series / mh', () => {
    expect(findRegularCloseIdx(null, mh)).toBe(-1);
    expect(findRegularCloseIdx(series, null)).toBe(-1);
  });
});

describe('findPrevSessionCloseIdx', () => {
  it('returns the last bar of the previous calendar day (market-agnostic)', () => {
    // LSE-style: a 16:30 close, no US-close-time bar. The previous
    // session is 2026-06-03; its last bar (16:30) is the prev close.
    const series = [
      { date: '2026-06-03T15:30', close: 1 },
      { date: '2026-06-03T16:30', close: 2 }, // ← LSE close (prev session)
      { date: '2026-06-04T08:00', close: 3 }, // today's open
      { date: '2026-06-04T09:00', close: 4 }, // today
    ];
    expect(findPrevSessionCloseIdx(series)).toBe(1);
  });

  it('lands on the most recent prior day when several days are present', () => {
    const series = [
      { date: '2026-06-02T16:30', close: 1 },
      { date: '2026-06-03T16:30', close: 2 }, // most recent prior day's close
      { date: '2026-06-04T09:00', close: 3 }, // today
    ];
    expect(findPrevSessionCloseIdx(series)).toBe(1);
  });

  it('returns -1 for a single-day series (no prior session to mark)', () => {
    expect(findPrevSessionCloseIdx([
      { date: '2026-06-04T08:00', close: 1 },
      { date: '2026-06-04T09:00', close: 2 },
    ])).toBe(-1);
  });

  it('guards empty / null / malformed', () => {
    expect(findPrevSessionCloseIdx(null)).toBe(-1);
    expect(findPrevSessionCloseIdx([])).toBe(-1);
    expect(findPrevSessionCloseIdx([{ date: '2026-06-04T09:00' }, { close: 1 }])).toBe(-1);
  });
});
