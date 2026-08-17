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
import { fmtMoney } from './formatters.js';
import { RANGES, RANGE_KEYS, investmentPointAt } from './ytd.js';

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
 * Stored samples win wherever they exist: they're what the scoreboard
 * actually read at the time, and they cover tickers whose price history
 * is no longer fetched. Derived points fill everything before the
 * earliest sample, so a book that predates the sampler still charts its
 * whole history instead of starting at the day the feature shipped.
 *
 * Exported for tests.
 *
 * @param {{ts:number, value:number, deposit:number}[]} snapshots ascending
 * @param {{ts:number, value:number, deposit:number}[]} derived   ascending
 * @param {number} startMs
 */
export function mergeSeries(snapshots, derived, startMs) {
  const snaps = (snapshots || []).filter(p => p.ts >= startMs);
  const firstSnapTs = snaps.length > 0 ? snaps[0].ts : Infinity;
  // Only the derived points OLDER than the first sample — otherwise the
  // two sources would interleave and the line would visibly jitter
  // between a recomputation and the recorded figure.
  const older = (derived || []).filter(p => p.ts >= startMs && p.ts < firstSnapTs);
  return [...older, ...snaps];
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
        >{RANGES[k].label}</button>
      ))}
    </div>
  );
}

/**
 * @param {{
 *   series: {ts:number, value:number, deposit:number}[],
 *   rangeKey: string,
 *   setRangeKey: (k: string) => void,
 *   hideValues?: boolean,
 * }} props
 */
export function InvestmentChart({ series, rangeKey, setRangeKey, hideValues }) {
  if (!Array.isArray(series) || series.length < 2) {
    return (
      <div className="perf-chart-wrap">
        <div className="sparkline-empty dim mono">Insufficient data</div>
        <RangeButtons rangeKey={rangeKey} onChange={setRangeKey} />
      </div>
    );
  }

  // Same SVG box and index-based x spacing as PerfChart, so the two
  // panels line up when the header swaps them: weekend / overnight gaps
  // don't draw empty stretches, and a short window still fills the width.
  const W = 300, H = 106;
  const padL = 44, padR = 8, padT = 10, padB = 20;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  const xOf = (i) => padL + (i / Math.max(1, series.length - 1)) * cW;

  // Both lines share one axis — they're the same unit, and the whole
  // point is reading the gap between them.
  const vals = series.flatMap(p => [p.value, p.deposit]);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const pad = Math.max(1, (rawMax - rawMin) * 0.12);
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const yRange = (yMax - yMin) || 1;
  const yOf = (v) => padT + ((yMax - v) / yRange) * cH;

  const pathOf = (pick) => series
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(pick(p)).toFixed(1)}`)
    .join(' ');

  const last = series[series.length - 1];
  const gain = last.value - last.deposit;
  // Return on what was actually paid in. Guarded because net deposit can
  // legitimately reach zero or go negative once realised profits exceed
  // the cash ever put in — at which point a percentage stops meaning
  // anything and only the dollar figure is shown.
  const gainPct = last.deposit > 0 ? (gain / last.deposit) * 100 : null;
  const money = (n) => (hideValues ? '••••' : fmtMoney(n));

  return (
    <div className="perf-chart-wrap">
      <div className="perf-legend mono">
        <span className="perf-legend-item">
          <span className="perf-dot" style={{ background: 'var(--chalk)' }} />
          Value {money(last.value)}
        </span>
        <span className="perf-legend-item">
          <span className="perf-dot" style={{ background: 'var(--chalk-dim)' }} />
          Deposited {money(last.deposit)}
        </span>
        <span className="perf-legend-item" style={{ color: gain >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
          {gain >= 0 ? '+' : '−'}{money(Math.abs(gain))}
          {gainPct != null && ` (${gain >= 0 ? '+' : ''}${gainPct.toFixed(2)}%)`}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="perf-svg" preserveAspectRatio="none">
        {/* Deposited sits underneath — it's the reference the value line
            is read against, so the value line stays on top and legible
            wherever they cross. */}
        <path d={pathOf(p => p.deposit)} fill="none" stroke="var(--chalk-dim)"
              strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        <path d={pathOf(p => p.value)} fill="none" stroke="var(--chalk)"
              strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <RangeButtons rangeKey={rangeKey} onChange={setRangeKey} />
    </div>
  );
}

/**
 * Derive the ledger-only series over a window. Used for everything older
 * than the first stored sample.
 *
 * @param {{
 *   portfolio: any, tickerSeries: any, marketData: any,
 *   fxToUSD: any, dates: string[],
 * }} opts
 * @returns {{ts:number, value:number, deposit:number}[]}
 */
export function deriveSeries({ portfolio, tickerSeries, marketData, fxToUSD, dates }) {
  const out = [];
  for (const d of (dates || [])) {
    const ts = Date.parse(d.length > 10 ? `${d}:00Z` : `${d}T00:00:00Z`);
    if (!isFinite(ts)) continue;
    const { value, netDeposit } = investmentPointAt({
      portfolio, tickerSeries, date: d, marketData, fxToUSD,
    });
    out.push({ ts, value, deposit: netDeposit });
  }
  return out;
}
