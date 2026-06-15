// Pins for `computeChartGeometry`. Each test mirrors a scenario the
// modal's render path exercises:
//   - regular-hours non-PE                       → standard path
//   - PE/PS ratio range (3yAvg in y-range)       → containment branch
//   - overnight-dot live extension               → chartXDenom + extra x-tick
//   - single-point series (length 1, <2 minimum) → hasData=false fallback
//   - empty series                                → fallback geometry
//   - ext mode, official close present           → anchor from lastPrice
//   - ext mode, no lastPrice but close bar        → fallback to series bar
//
// These tests document the contract the modal's render path relies on
// (anchor selection, the hasData gate, x/y scale, tick generation).

import { describe, it, expect } from 'vitest';
import { computeChartGeometry } from './chart_modal_geometry.js';

const DIMS = { padL: 56, padR: 16, padT: 18, padB: 38, cW: 728, cH: 244 };

const NO_REFS = {
  lastPriceAny: null,
  prevCloseAny: null,
  pe3yAvg: null,
  ps3yAvg: null,
  maSeries: null,
  vwapSeries: null,
};

function intradayPoints() {
  return [
    { date: '2026-05-28T13:30', close: 100 },
    { date: '2026-05-28T14:00', close: 102 },
    { date: '2026-05-28T15:00', close: 101 },
    { date: '2026-05-28T20:00', close: 103 },
  ];
}

describe('computeChartGeometry — regular path', () => {
  it('1D non-ext with prevClose anchors at prevClose, fills xOfIdx + ticks', () => {
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: false,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, prevCloseAny: 99 },
    });
    expect(out.anchorClose).toBe(99);
    expect(out.hasData).toBe(true);
    expect(out.chartXDenom).toBe(3); // points.length - 1
    expect(out.xOfIdx(0)).toBe(56);                            // padL
    expect(out.xOfIdx(3)).toBeCloseTo(56 + 728, 3);            // padL + cW
    expect(out.ticksY.length).toBeGreaterThan(0);
    expect(out.ticksX.length).toBe(6); // 1D → ticksToShow=5 → 6 ticks
  });

  it('multi-day (1W) anchors at series[0]', () => {
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1W',
      useExt: false,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, prevCloseAny: 99 }, // ignored, multi-day uses series[0]
    });
    expect(out.anchorClose).toBe(100); // series[0].close
    expect(out.ticksX.length).toBe(5); // non-1D → ticksToShow=4 → 5 ticks
  });

  it('falls back to series[0] when neither prevClose nor a close-idx is available', () => {
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: false,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: NO_REFS,
    });
    expect(out.anchorClose).toBe(100);
  });
});

describe('computeChartGeometry — ext-mode anchor selection', () => {
  it('prefers lastPriceAny (official regular close) over the intraday close bar', () => {
    // The bug fix: even with the 20:00 ET close bar present
    // (regularCloseIdx: 3 → close 103), the headline % must anchor at
    // the official regularMarketPrice (lastPriceAny: 200) so it shares
    // computeMetrics' extDayPct denominator (h.lastPrice). Anchoring at
    // the 5-min bar missed the closing-auction cross → modal vs heatmap
    // disagreed by ~0.1-0.3%.
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: true,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: 3, // the 20:00 close bar is present but must NOT win
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, lastPriceAny: 200, prevCloseAny: 95 },
    });
    expect(out.anchorClose).toBe(200); // lastPriceAny, not points[3].close (103)
  });

  it('crypto ignores the ext branch and anchors at prevClose (rolling 24h)', () => {
    // Crypto has no regular close and the ext-hours toggle must not change
    // its basis. Even with useExt on AND a lastPriceAny present (which would
    // win for a stock), isCrypto routes to prevCloseAny so the modal's % ==
    // the board's rolling-24h day-change instead of a constant ~0%.
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: true,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: 3,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, isCrypto: true, lastPriceAny: 200, prevCloseAny: 95 },
    });
    expect(out.anchorClose).toBe(95); // prevCloseAny, NOT lastPriceAny (200)
  });

  it('uses the intraday close bar when no official lastPrice is available', () => {
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: true,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: 3, // = the 20:00 close bar above
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, lastPriceAny: 0, prevCloseAny: 95 },
    });
    expect(out.anchorClose).toBe(103); // points[3].close (lastPrice absent)
  });

  it('falls through past lastPrice to prevClose, then to series[0]', () => {
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: true,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, lastPriceAny: 0, prevCloseAny: 95 },
    });
    expect(out.anchorClose).toBe(95);
  });
});

describe('computeChartGeometry — PE/PS ratio range', () => {
  it('PE includes pe3yAvg in the y-range so the dashed marker stays on-screen', () => {
    const points = [
      { date: '2026-01-02', close: 20 },
      { date: '2026-02-02', close: 21 },
      { date: '2026-03-02', close: 22 },
    ];
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: 'PE',
      useExt: false,
      isRatioRange: true,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, pe3yAvg: 50 }, // way above the close range
    });
    expect(out.hasData).toBe(true);
    // Without containment yMax would land around 22 + padding; with
    // pe3yAvg pushed in, yMax must rise to include 50.
    expect(out.yMax).toBeGreaterThanOrEqual(50);
  });

  it('PS includes ps3yAvg the same way', () => {
    const points = [
      { date: '2026-01-02', close: 3 },
      { date: '2026-02-02', close: 4 },
    ];
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: 'PS',
      useExt: false,
      isRatioRange: true,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, ps3yAvg: 10 },
    });
    expect(out.yMax).toBeGreaterThanOrEqual(10);
  });
});

describe('computeChartGeometry — overnight live dot', () => {
  it('extends chartXDenom by overnightDot.gap and appends a "now" x-tick', () => {
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: true,
      isRatioRange: false,
      overnightDot: { price: 105, gap: 2.5, dateStr: '2026-05-29T02:30' },
      regularCloseIdx: 3,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, prevCloseAny: 99 },
    });
    expect(out.chartXDenom).toBeCloseTo(3 + 2.5, 3); // base + gap
    // Last x-tick is the "now" marker at the far right (padL + cW).
    const last = out.ticksX[out.ticksX.length - 1];
    expect(last.x).toBe(DIMS.padL + DIMS.cW);
    expect(last.date).toBe('2026-05-29T02:30');
  });

  it('keeps the dot price inside y-range so it cant clip off the chart', () => {
    const points = intradayPoints();
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: true,
      isRatioRange: false,
      overnightDot: { price: 999, gap: 1, dateStr: '2026-05-29T01:00' }, // way above
      regularCloseIdx: 3,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, prevCloseAny: 99 },
    });
    expect(out.yMax).toBeGreaterThanOrEqual(999);
  });
});

describe('computeChartGeometry — empty / single-point fallbacks', () => {
  it('empty points → fallback functions, hasData=false', () => {
    const out = computeChartGeometry({
      series: [],
      points: [],
      rangeKey: '1D',
      useExt: false,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: NO_REFS,
    });
    expect(out.hasData).toBe(false);
    expect(out.anchorClose).toBeNull();
    expect(out.ticksX).toEqual([]);
    expect(out.xOfIdx(0)).toBe(DIMS.padL);
    expect(out.yOf(123)).toBe(DIMS.padT + DIMS.cH / 2);
  });

  it('single-point series stays hasData=false because the modal requires >=2', () => {
    const points = [{ date: '2026-05-28T13:30', close: 100 }];
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1D',
      useExt: false,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, prevCloseAny: 99 },
    });
    expect(out.hasData).toBe(false);
    expect(out.anchorClose).toBe(99); // anchorClose computed; gate is the >=2 check
  });

  it('MA / VWAP overlays expand y-range when they push outside the price range', () => {
    const points = [
      { date: '2026-01-02', close: 100 },
      { date: '2026-01-03', close: 102 },
      { date: '2026-01-04', close: 101 },
    ];
    const out = computeChartGeometry({
      series: points,
      points,
      rangeKey: '1M',
      useExt: false,
      isRatioRange: false,
      overnightDot: null,
      regularCloseIdx: -1,
      dimensions: DIMS,
      anchorRefs: { ...NO_REFS, maSeries: [null, 50, 60], vwapSeries: [null, null, 200] },
    });
    expect(out.yMin).toBeLessThanOrEqual(50);
    expect(out.yMax).toBeGreaterThanOrEqual(200);
  });
});
