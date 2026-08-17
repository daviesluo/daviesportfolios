// Investment Performance: the account in dollars — what the portfolio is
// worth against what was actually paid into it.
//
// The interesting logic is the merge. Stored 5-minute samples are the
// truth wherever they exist (they're what the scoreboard read at the
// time, and they cover tickers whose price history is no longer
// fetched); ledger-derived points fill everything older, so a book that
// predates the sampler still charts its whole history instead of
// starting the day the feature shipped.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  InvestmentChart, mergeSeries, rangeStartMs, deriveSeries,
  niceMoneyTicks, axisMoneyLabel,
} from './investment_chart.jsx';

beforeEach(cleanup);

const pt = (ts, value, deposit) => ({ ts, value, deposit });

describe('mergeSeries', () => {
  it('prefers stored samples and fills only OLDER gaps from the ledger', () => {
    const snaps = [pt(500, 110, 100), pt(600, 120, 100)];
    const derived = [pt(300, 90, 100), pt(400, 95, 100), pt(550, 999, 999)];
    const out = mergeSeries(snaps, derived, 0);
    // The derived point at 550 sits INSIDE the sampled span and is
    // dropped — interleaving a recomputation with recorded figures makes
    // the line visibly jitter between two answers for the same moment.
    expect(out.map(p => p.ts)).toEqual([300, 400, 500, 600]);
    expect(out.map(p => p.value)).toEqual([90, 95, 110, 120]);
  });

  it('drops everything before the window start', () => {
    const out = mergeSeries([pt(500, 1, 1)], [pt(100, 1, 1)], 400);
    expect(out.map(p => p.ts)).toEqual([500]);
  });

  it('falls back to the derived series when nothing was ever sampled', () => {
    const derived = [pt(100, 90, 100), pt(200, 105, 100)];
    expect(mergeSeries([], derived, 0))
      .toEqual(derived.map(p => ({ ...p, estimated: true })));
  });

  it('marks the reconstructed points and not the recorded ones', () => {
    // The handover is one-way: every sample recorded pushes the boundary
    // left, so the estimated stretch shrinks on its own until there is
    // none of it left. The chart needs to know which is which — a
    // reconstruction from the ledger must not read as a record of what
    // the account actually showed.
    const out = mergeSeries([pt(500, 110, 100)], [pt(300, 90, 100), pt(400, 95, 100)], 0);
    expect(out.map(p => !!p.estimated)).toEqual([true, true, false]);
  });

  it('is empty when neither source has anything in the window', () => {
    expect(mergeSeries([], [], 0)).toEqual([]);
  });
});

describe('rangeStartMs', () => {
  const now = Date.parse('2026-08-14T12:00:00Z');
  it('measures the fixed-span ranges back from now', () => {
    expect(now - rangeStartMs('1D', now)).toBe(24 * 3600_000);
    expect(now - rangeStartMs('1W', now)).toBe(7 * 24 * 3600_000);
  });
  it('measures YTD from Jan 1, not a fixed span', () => {
    expect(rangeStartMs('YTD', now)).toBe(new Date(2026, 0, 1).getTime());
  });
});

describe('deriveSeries', () => {
  it('turns ledger points into a timestamped value / deposit series', () => {
    const portfolio = { holdings: {
      // `shares` matters now that the value comes from computeAt: its
      // lotsFor swaps in a stand-in lot when the lots don't sum to it.
      NVDA: { currency: 'USD', shares: 10, lastPrice: 130,
              lots: [{ date: '2026-01-05', shares: 10, cost: 100 }] },
    } };
    const tickerSeries = {
      NVDA: {
        series: [{ date: '2026-01-05', close: 100 }, { date: '2026-02-01', close: 130 }],
        map: { '2026-01-05': 100, '2026-02-01': 130 },
        janPrice: 100,
      },
    };
    const out = deriveSeries({
      portfolio, tickerSeries, marketData: {}, fxToUSD: () => 1,
      dates: ['2026-01-05', '2026-02-01'],
    });
    expect(out.map(p => p.value)).toEqual([1000, 1300]);
    expect(out.map(p => p.deposit)).toEqual([1000, 1000]);
    expect(out[0].ts).toBe(Date.parse('2026-01-05T00:00:00Z'));
  });

  it('drops a point it cannot put a number on rather than blanking the chart', () => {
    // A holding whose `shares` never got filled in makes lotsFor produce
    // a NaN-share stand-in; one NaN in the series would take the whole
    // axis with it.
    const out = deriveSeries({
      portfolio: { holdings: { X: { currency: 'USD', lots: [] } } },
      tickerSeries: {}, marketData: {}, fxToUSD: () => 1,
      dates: ['2026-01-05', '2026-02-01'],
    });
    expect(out.every(p => isFinite(p.value) && isFinite(p.deposit))).toBe(true);
  });
});

describe('InvestmentChart', () => {
  const series = [pt(1, 1000, 1000), pt(2, 1100, 1000), pt(3, 1250, 1000)];

  it('draws both lines', () => {
    const { container } = render(
      <InvestmentChart series={series} rangeKey="1M" setRangeKey={vi.fn()} />,
    );
    expect(container.querySelectorAll('path.inv-line')).toHaveLength(2);
  });

  it('reports each line\'s move across the WINDOW, not its lifetime gain', () => {
    // Deposited $800 long ago, now worth $1,250 — a lifetime gain of
    // +56%. Over the window on screen the value rose 250 while 200 of
    // that was paid in, so the RESULT is 50 on an opening 1000 (+5.00%)
    // and the deposits grew 800 → 1000 (+25.00%). The range buttons
    // select the window, so that is what the legend answers.
    render(
      <InvestmentChart
        series={[pt(1, 1000, 800), pt(2, 1100, 800), pt(3, 1250, 1000)]}
        rangeKey="1M" setRangeKey={vi.fn()}
      />,
    );
    expect(screen.getByText(/Value/).textContent).toMatch(/\$1,250\+5\.00%/);
    expect(screen.getByText(/Deposited/).textContent).toMatch(/\$1,000\+25\.00%/);
    // The lifetime gain figure is gone from the legend — the band
    // between the lines shows the gap, and the crosshair gives both
    // numbers at any point.
    expect(screen.queryByText(/\+\$250/)).not.toBeInTheDocument();
  });

  it('tints only the value move — a deposit is not a result', () => {
    // Value 1000 → 900 while 200 was paid in: the account lost 300, i.e.
    // −30.00% of what it opened with, and separately grew 25% in size.
    const { container } = render(
      <InvestmentChart
        series={[pt(1, 1000, 800), pt(2, 900, 1000)]}
        rangeKey="1M" setRangeKey={vi.fn()}
      />,
    );
    const spans = [...container.querySelectorAll('.inv-legend-item span')];
    const valueMove = spans.find(s => s.textContent === '-30.00%');
    const depositMove = spans.find(s => s.textContent === '+25.00%');
    expect(valueMove?.getAttribute('style')).toContain('--loss');
    expect(depositMove?.getAttribute('style') || '').not.toContain('--gain');
  });

  it('does not read money paid in as a gain', () => {
    // $10,000 into a $30,000 account is not a 33% gain. Counting it as
    // one is what put +43% beside a window the vs-S&P view called +7.5%.
    render(
      <InvestmentChart
        series={[pt(1, 30_000, 19_000), pt(2, 40_000, 29_000)]}
        rangeKey="1W" setRangeKey={vi.fn()}
      />,
    );
    // Value grew 10,000, ALL of it paid in → flat.
    expect(screen.getByText(/Value/).textContent).toMatch(/\+0\.00%/);
    expect(screen.getByText(/Deposited/).textContent).toMatch(/\+52\.63%/);
  });

  it('omits a move it cannot compute rather than dividing by zero', () => {
    // A YTD window that opens on an empty account: a percentage of
    // nothing isn't a number.
    render(
      <InvestmentChart
        series={[pt(1, 0, 0), pt(2, 600, 500)]}
        rangeKey="YTD" setRangeKey={vi.fn()}
      />,
    );
    expect(screen.getByText(/Value/).textContent).not.toMatch(/%/);
    expect(screen.getByText(/Deposited/).textContent).not.toMatch(/%/);
  });

  it('fades the reconstructed stretch and rules off where recording starts', () => {
    // Left of the rule is computed from the lot ledger; right of it is
    // what the sampler actually recorded. Every sample moves the rule
    // left, so the faded stretch shrinks on its own.
    const mixed = [
      { ts: 1, value: 900, deposit: 800, estimated: true },
      { ts: 2, value: 950, deposit: 800, estimated: true },
      pt(3, 1000, 800),
      pt(4, 1100, 800),
    ];
    const { container } = render(
      <InvestmentChart series={mixed} rangeKey="1M" setRangeKey={vi.fn()} />,
    );
    expect(container.querySelectorAll('path.inv-line-est')).toHaveLength(2);
    expect(container.querySelectorAll('path.inv-line-value')).toHaveLength(1);
    expect(container.querySelector('line.inv-handover')).toBeTruthy();
    // The two stretches meet — the faded one runs THROUGH the first
    // recorded point, so the line has no gap at the handover.
    const est = container.querySelector('path.inv-line-est')?.getAttribute('d') || '';
    expect(est.split(/[ML]/).filter(Boolean)).toHaveLength(3);
  });

  it('draws no handover rule when nothing has been recorded yet', () => {
    const { container } = render(
      <InvestmentChart
        series={[{ ts: 1, value: 900, deposit: 800, estimated: true },
                 { ts: 2, value: 950, deposit: 800, estimated: true }]}
        rangeKey="YTD" setRangeKey={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('path.inv-line-est')).toHaveLength(2);
    expect(container.querySelectorAll('path.inv-line-value')).toHaveLength(0);
    expect(container.querySelector('line.inv-handover')).toBeNull();
  });

  it('fills the band between the lines, closed and tinted by the result', () => {
    const { container } = render(
      <InvestmentChart series={series} rangeKey="1M" setRangeKey={vi.fn()} />,
    );
    const band = container.querySelector('path.inv-band');
    // Out along value, back along deposited, closed — the enclosed area
    // is the money made, which is the one thing this chart is for.
    expect(band?.getAttribute('d')).toMatch(/Z$/);
    expect(band?.getAttribute('fill')).toBe('var(--gain)');
    cleanup();
    render(
      <InvestmentChart
        series={[pt(1, 900, 1000), pt(2, 800, 1000)]}
        rangeKey="1M" setRangeKey={vi.fn()}
      />,
    );
    expect(document.querySelector('path.inv-band')?.getAttribute('fill')).toBe('var(--loss)');
  });

  it('shows the empty state rather than a one-point line', () => {
    render(<InvestmentChart series={[pt(1, 100, 100)]} rangeKey="1D" setRangeKey={vi.fn()} />);
    expect(screen.getByText(/Insufficient data/i)).toBeInTheDocument();
  });

  it('still reports the value move when nothing is deposited', () => {
    // Net deposit can legitimately reach 0 or go negative once realised
    // gains exceed everything ever paid in. That kills the deposit
    // percentage, not the value one.
    render(
      <InvestmentChart
        series={[pt(1, 500, 0), pt(2, 600, 0)]}
        rangeKey="1M" setRangeKey={vi.fn()}
      />,
    );
    expect(screen.getByText(/Value/).textContent).toMatch(/\+20\.00%/);
    expect(screen.getByText(/Deposited/).textContent).not.toMatch(/%/);
    // …and with nothing deposited there is nothing to net out of it.
  });

  it('masks the figures when hideValues is on — the axis included', () => {
    const { container } = render(
      <InvestmentChart series={series} rangeKey="1M" setRangeKey={vi.fn()} hideValues />,
    );
    expect(screen.queryByText(/1,250/)).not.toBeInTheDocument();
    // The gridlines and the date axis stay so the chart keeps its shape
    // — it's the money that's private, and an axis labelled "$1.2k"
    // would hand straight back what the legend just hid.
    const labels = [...container.querySelectorAll('svg text')].map(t => t.textContent || '');
    expect(labels.some(t => /\$\s*\d/.test(t))).toBe(false);
    expect(labels.some(t => /\$/.test(t))).toBe(true);
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(2);
  });
});

describe('axes', () => {
  const series = [pt(Date.parse('2026-08-14T13:30:00Z'), 130_000, 120_000),
                  pt(Date.parse('2026-08-14T17:30:00Z'), 141_000, 120_000)];

  it('labels the y axis in round dollars and the x axis with times on 1D', () => {
    const { container } = render(
      <InvestmentChart series={series} rangeKey="1D" setRangeKey={vi.fn()} />,
    );
    const labels = [...container.querySelectorAll('svg text')].map(t => t.textContent || '');
    // Money labels are compact — "$130,000" is wider than the whole
    // left gutter.
    expect(labels.filter(t => /^\$\d+(\.\d+)?k$/.test(t)).length).toBeGreaterThanOrEqual(3);
    // …and 1D's x axis reads as clock time, not a date.
    expect(labels.some(t => /^\d{2}:\d{2}$/.test(t))).toBe(true);
  });

  it('reads zero as "$0" — the line between having money and owing it', () => {
    const { container } = render(
      <InvestmentChart
        series={[pt(1, 120_000, 100_000), pt(2, -40_000, 100_000)]}
        rangeKey="1D" setRangeKey={vi.fn()}
      />,
    );
    const labels = [...container.querySelectorAll('svg text')].map(t => t.textContent || '');
    expect(labels).toContain('$0');
    expect(labels.some(t => /^\$0[a-zA-Z]/.test(t))).toBe(false);
  });

  it('never repeats an x label — a duplicate says nothing', () => {
    // Six samples across a quarter land in four calendar months, which
    // as bare month names came out "May Jun Jun Jul Aug Aug".
    const day = 24 * 3600_000;
    const base = Date.parse('2026-05-20T00:00:00Z');
    const quarter = Array.from({ length: 40 }, (_, i) =>
      pt(base + i * 2.2 * day, 100_000 + i * 100, 100_000));
    const { container } = render(
      <InvestmentChart series={quarter} rangeKey="3M" setRangeKey={vi.fn()} />,
    );
    const x = [...container.querySelectorAll('svg text')]
      .map(t => t.textContent || '')
      // Drop the y-axis money and the crosshair's still-blank chips.
      .filter(t => t && !t.startsWith('$') && !t.startsWith('−'));
    expect(x.length).toBeGreaterThan(2);
    expect(new Set(x).size).toBe(x.length);
  });

  it('labels the x axis with dates on the daily ranges', () => {
    const { container } = render(
      <InvestmentChart series={series} rangeKey="YTD" setRangeKey={vi.fn()} />,
    );
    const labels = [...container.querySelectorAll('svg text')].map(t => t.textContent || '');
    expect(labels.some(t => /^\d{2}:\d{2}$/.test(t))).toBe(false);
    expect(labels.some(t => /^[A-Z][a-z]{2}$/.test(t))).toBe(true);
  });

  it('renders a crosshair group, hidden until the pointer arrives', () => {
    const { container } = render(
      <InvestmentChart series={series} rangeKey="1D" setRangeKey={vi.fn()} />,
    );
    const cross = container.querySelector('svg g.inv-crosshair');
    expect(cross).toBeTruthy();
    expect(/** @type {SVGGElement} */ (cross).style.display).toBe('none');
  });
});

describe('crosshair', () => {
  // jsdom has no layout, so the SVG is given the box it would have in a
  // browser; without it pointerToDataIndex correctly refuses to guess an
  // index from a zero-width rect and nothing paints.
  const threePt = [
    pt(Date.parse('2026-08-14T13:30:00Z'), 100_000, 90_000),
    pt(Date.parse('2026-08-14T15:00:00Z'), 110_000, 90_000),
    pt(Date.parse('2026-08-14T17:30:00Z'), 130_000, 95_000),
  ];

  // The paint is deferred to a frame, so the stub has to hand back an id
  // BEFORE running the callback — a stub that fires synchronously and
  // then returns lets the caller's `rafRef = rAF(...)` overwrite the 0
  // the callback just wrote, and every later move short-circuits.
  let queued = /** @type {any} */ (null);
  const frame = () => { const cb = queued; queued = null; if (cb) cb(); };

  /** Render with the box the SVG would have in a browser. */
  function mount(series = threePt, props = {}) {
    vi.stubGlobal('requestAnimationFrame', (/** @type {any} */ cb) => { queued = cb; return 1; });
    const { container } = render(
      <InvestmentChart series={series} rangeKey="1D" setRangeKey={vi.fn()} {...props} />,
    );
    const svg = /** @type {SVGSVGElement} */ (container.querySelector('svg'));
    // jsdom has no layout, so without this pointerToDataIndex correctly
    // refuses to guess an index from a zero-width rect.
    svg.getBoundingClientRect = () => /** @type {any} */ (
      { left: 0, top: 0, width: 300, height: 106 }
    );
    return { container, svg };
  }
  /** Move the pointer to a chart-space x and let the frame run. */
  const move = (svg, clientX) => { fireEvent.mouseMove(svg, { clientX }); frame(); };
  afterEach(() => { queued = null; vi.unstubAllGlobals(); });

  // Scoped to the crosshair group: the y-axis tick labels are also
  // <text> starting with "$", and a loose selector quietly folded them
  // into the assertions.
  const chips = (svg) => [...svg.querySelectorAll('g.inv-crosshair text')]
    .map(t => t.textContent || '')
    .filter(t => /^[~$•]/.test(t));

  it('reads the point under the pointer onto both chips', () => {
    const { svg } = mount();
    // x = 292 is the right edge of the plot area, i.e. the last point.
    move(svg, 292);
    expect(/** @type {any} */ (svg.querySelector('g.inv-crosshair')).style.display).toBe('');
    expect(chips(svg)).toEqual(expect.arrayContaining(['$130,000', '$95,000']));
    // …and the left edge is the first point, not a stale repaint.
    move(svg, 40);
    expect(chips(svg)).toEqual(expect.arrayContaining(['$100,000', '$90,000']));
  });

  it('moves the vertical line with the pointer', () => {
    const { svg } = mount();
    move(svg, 40);
    const left = svg.querySelector('g.inv-crosshair line')?.getAttribute('x1');
    move(svg, 292);
    const right = svg.querySelector('g.inv-crosshair line')?.getAttribute('x1');
    expect(Number(right)).toBeGreaterThan(Number(left));
  });

  it('hides again when the pointer leaves', () => {
    const { svg } = mount();
    move(svg, 200);
    fireEvent.mouseLeave(svg);
    const cross = /** @type {SVGGElement} */ (svg.querySelector('g.inv-crosshair'));
    expect(cross.style.display).toBe('none');
  });

  it('marks a reconstructed point so it does not read as a record', () => {
    const { svg } = mount([
      { ts: Date.parse('2026-08-14T13:30:00Z'), value: 100_000, deposit: 90_000, estimated: true },
      { ts: Date.parse('2026-08-14T17:30:00Z'), value: 130_000, deposit: 95_000 },
    ]);
    move(svg, 40);
    expect(chips(svg).every(t => t.startsWith('~'))).toBe(true);
    move(svg, 292);
    expect(chips(svg).some(t => t.startsWith('~'))).toBe(false);
  });

  it('keeps the chips masked under hideValues', () => {
    // The crosshair is the one place the exact dollar figure appears, so
    // it has to honour the privacy toggle too.
    const { svg } = mount(threePt, { hideValues: true });
    move(svg, 292);
    expect(chips(svg).every(t => !/\d/.test(t))).toBe(true);
  });

  it('pushes the two chips apart when the lines nearly touch', () => {
    // Value and deposit within a few dollars of each other is the
    // ordinary case early in a window; stacked labels would overprint.
    const { svg } = mount([pt(1, 100_000, 99_990), pt(2, 100_010, 100_000)]);
    move(svg, 292);
    const ys = [...svg.querySelectorAll('g.inv-crosshair rect')]
      .map(r => Number(r.getAttribute('y')))
      .filter(n => isFinite(n));
    const [a, b] = ys.slice(-2);
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(11);
  });
});

describe('niceMoneyTicks', () => {
  it('snaps to round steps so every gridline is a number you would say', () => {
    const { ticks, step, min, max } = niceMoneyTicks(132_358, 181_874);
    expect(step).toBe(20_000);
    expect(min % step).toBe(0);
    expect(ticks[0]).toBe(min);
    expect(ticks[ticks.length - 1]).toBe(max);
    // The data has to sit INSIDE the axis — a series whose maximum
    // landed on a tick used to draw along the top gridline.
    expect(min).toBeLessThan(132_358);
    expect(max).toBeGreaterThan(181_874);
  });

  it('does not pad an all-positive account below zero', () => {
    // A YTD window opens on cash-only ($5k) and ends at $185k. Padding
    // the floor down produced a −$100k gridline — half the height spent
    // on money that was never owed, with everything that moved squashed
    // into the top corner.
    const { min, ticks } = niceMoneyTicks(5_000, 185_000);
    expect(min).toBe(0);
    expect(ticks.every(t => t >= 0)).toBe(true);
  });

  it('still goes negative when the account actually is', () => {
    const { min } = niceMoneyTicks(-20_000, 50_000);
    expect(min).toBeLessThan(-20_000);
  });

  it('takes the finest step that fits rather than rounding the range up', () => {
    // A YTD window from cash-only to $200k: rounding the ideal spacing
    // up landed on a $100k step and drew $0/$100k/$200k/$300k, leaving a
    // third of the height empty above the data.
    const { step, max } = niceMoneyTicks(5_000, 200_132);
    expect(step).toBe(50_000);
    expect(max).toBe(250_000);
  });

  it('never draws more gaps than it was asked for', () => {
    // The plot is 76 units tall; eight gridlines is a grid, not a chart.
    for (const [lo, hi] of [[0, 1], [5_000, 185_000], [132_358, 181_874],
                            [100_000, 205_000], [-3_000, 9_000], [1e6, 4.4e6]]) {
      const { ticks } = niceMoneyTicks(lo, hi);
      expect(ticks.length - 1).toBeLessThanOrEqual(5);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps every tick on the step, with no float drift', () => {
    const { ticks, step } = niceMoneyTicks(0, 1);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 9);
    }
  });

  it('lands the zero crossing on exactly zero', () => {
    // A step that isn't binary-exact leaves it at −1.4e-14, which labels
    // as "−$0" — a minus sign on nothing.
    for (const [lo, hi] of [[-0.3, 0.9], [-30, 90], [-2_500, 7_500]]) {
      const { ticks } = niceMoneyTicks(lo, hi);
      const zero = ticks.find(t => Math.abs(t) < 1e-6);
      expect(zero).toBe(0);
      expect(Object.is(zero, -0)).toBe(false);
    }
  });

  it('manufactures a band for a dead-flat series instead of a zero range', () => {
    // A board that hasn't moved has nothing to snap to; without this the
    // line divides by a zero range and pins to the top of the frame.
    const { ticks, min, max } = niceMoneyTicks(50_000, 50_000);
    expect(max).toBeGreaterThan(min);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(min).toBeLessThanOrEqual(50_000);
    expect(max).toBeGreaterThanOrEqual(50_000);
  });

  it('survives a non-finite range rather than emitting NaN gridlines', () => {
    const out = niceMoneyTicks(NaN, 10);
    expect(out.ticks.every(t => isFinite(t))).toBe(true);
  });
});

describe('axisMoneyLabel', () => {
  it('scales every label off the axis, not off each value', () => {
    // Mixed units down one axis ("$950" above "$1.0k") make the column
    // unreadable, so the magnitude decides for all of them.
    expect(axisMoneyLabel(950, 1000, 5000)).toBe('$1k');
    expect(axisMoneyLabel(180_000, 20_000, 200_000)).toBe('$180k');
    expect(axisMoneyLabel(2_500_000, 500_000, 3e6)).toBe('$2.5M');
    expect(axisMoneyLabel(400, 100, 900)).toBe('$400');
  });

  it('takes its precision from the step so adjacent ticks stay distinct', () => {
    // A $2,500 step has to read "$132.5k" — at 0 decimals two rows would
    // both say "$132k".
    expect(axisMoneyLabel(132_500, 2_500, 140_000)).toBe('$132.5k');
    expect(axisMoneyLabel(130_000, 2_500, 140_000)).toBe('$130.0k');
  });

  it('marks a negative axis with a minus that matches the digit width', () => {
    expect(axisMoneyLabel(-5_000, 5_000, 20_000)).toBe('−$5k');
  });
});
