// The FILL study: the loop decides on one venue's candles and fills on another's,
// and until this file no table in this repository simulated that split. Every
// `agent_strategies` row has `signal_venue = 'kraken'` and `venue = 'revx'`
// (`0037`), so KRAKEN's 4-hour candles produce the signal and REVOLUT X's book
// produces the fill — while every backtest here, §3.16's included, prices signal
// AND fill on one series. §2c measured the cross-venue basis at ≤ 3 bps at the
// touch and called that small against 9 bps of taker fee. Suggests is not
// measures. Run by hand:
//
//   deno run --allow-read --allow-write --allow-net=0.0.0.0 \
//     supabase/functions/agents/backtest_fill.ts \
//     --data  <dir with BTC-USD_1h_3y.json …>      (Coinbase Exchange hourly)
//     --ext   <dir with BTC-USD_1h_kraken.json …>  (Kraken quarterly bundle, hourly)
//     --ktape <dir with BTC-USD_4h_kraken.json …>  (Kraken's own 4h tape, full span)
//     --rtape <dir with BTC-USD_4h_revx.json …>    (Revolut X's UK book, 4h)
//     --tape  docs/agents/backtests/tape.json      (optional cross-check)
//     --out   docs/agents/backtests
//
// Writes `<out>/fill.json` and NOTHING else. It places no order and needs no key.
//
// ── two claims in the reference are wrong, and this study rests on it ──
//
// §3.16 closed with "Revolut X's own tape needs a signed endpoint and is
// unreachable from a harness". That is false:
// `GET /1.0/public/candles/{SYM}?interval=240&region=UK` is PUBLIC and KEYLESS,
// and it was fetched from this harness. The signed call §6 probed is one way to
// reach the series, not the only one.
//
// §2.3 says daily candles reach three years and "hourly is available for the
// same span". The first half is right and the second is not. Measured here on
// the UK book, keyless, 2026-09-22, paging each interval to its wall:
//
//   daily   1,114 bars   2023-08-19 → 2026-09-21   three years   ✓ as §2.3 says
//   4-hour  2,257 bars   2025-09-11 → 2026-09-22   376 days      ✗ not three years
//   hourly  paged to the same 2025-09-11 boundary                ✗ not three years
//
// `backtest.ts`'s own header — "Revolut X only serves one year of intraday
// history" — was the correct one all along. Neither wrong claim is repeated
// anywhere in this file or its report.
//
// What that buys, and what it does not. **The real Revolut X tape covers window
// A and nothing else.** Window A's out-of-sample span is 2025-09-10 → 2026-09-20
// and the tape starts 2025-09-11: a one-day miss on a 375-day window, handled by
// the clip rule below and priced. Windows B, C and D are older than the venue
// serves, so arm (c) has no real entry there and a PROXY fill tape is used,
// labelled as such everywhere and never substituted silently. Window A is the
// bear year and the window the ranking is decided on, so it is also where the
// proxy can be CALIBRATED against the truth — `f2_threeArms.proxyCalibration`
// runs the proxy on window A beside the real tape and reports its error, which
// is worth more than the proxy itself.
//
// `region=UK` is not optional: without it the endpoint serves the EEA book
// (§2.2, found 2026-09-21), which this account cannot trade, and reading the
// wrong one is the mistake that produced the only trade the dislocation rule
// ever made (§3.5, §4.14). Every bar here was fetched with `region=UK` and the
// provenance records it. The two coins whose tape has holes — ETC (1 gap) and
// TON (2) — are not smoothed over: they go through the missing-bar rule below
// and every carried bar is counted.
//
// ── what is imported and what is copied ───────────────────────────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`
// and `spreadOf`, and the live rulebooks in `_shared/agents_strategy.ts`, are
// IMPORTED. ONE copy exists, `runSplit`, taken from `run` line by line; it takes
// a SIGNAL series and a FILL series instead of one, and it is `run` exactly when
// the two are the same array — `fidelity.runSplit` is the proof, on every coin ×
// window × venue × stop rule × tape, comparing return, drawdown, trades, days,
// exposure, realised, fees, stops hit AND the sampled equity curve point for
// point.
//
// `combine`, `dailyReturns`, `plateauOf`, `barTests`, `windowsOn`,
// `intersectionDistribution`, `signTest` and the correlation helpers are copied
// from `backtest_windows.ts` / `backtest_tape.ts` / `backtest_portfolio.ts`,
// which do not export them: they do arithmetic on OUTPUTS and touch no price and
// no fee.
//
// ── determinism ───────────────────────────────────────────────────────
//
// There is no `ran_at` field and no runtime field. Re-running over the same four
// data directories writes `fill.json` byte for byte identical. Every null is
// computed exactly, never sampled. `backtest.ts` is SHA-256'd at the start and
// the end of the run and a run that straddles an edit throws.

import {
  atrAt, applyFill, buildSnapshot, DEFAULT_TREND, FLAT, precompute, ruleFor,
  type Candle, type Position, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import {
  COSTS, resample, run, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]

// ───────────────────────────────────────────────────────── facts, not guesses

/** Revolut X UK-book 24 h quote volume, reference §3.8 (medians of 21 samples a minute apart, 2026-09-21). */
const UK_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 3_600_000, "ETH/USD": 3_200_000, "SOL/USD": 3_300_000, "XRP/USD": 2_600_000,
  "AAVE/USD": 54_000, "DOGE/USD": 199_000, "LINK/USD": 693_000, "UNI/USD": 159_000, "ADA/USD": 122_000,
  "LTC/USD": 44_000, "BNB/USD": 19_000, "AVAX/USD": 1_900_000, "HBAR/USD": 114_000, "SHIB/USD": 11_000,
  "XLM/USD": 176_000, "PEPE/USD": 102_000, "DOT/USD": 769_000, "ALGO/USD": 180_000, "BCH/USD": 928_000,
  "ATOM/USD": 17_000, "SUI/USD": 942_000, "HYPE/USD": 123_000, "NEAR/USD": 2_800_000, "ICP/USD": 171_000,
  "ETC/USD": 8_000, "POL/USD": 11_000, "TON/USD": 8_000,
};

/** Kraken 24 h quote volume, reference §3.12 (`kraken.json` → `krakenBook`, medians of eleven samples). */
const KRAKEN_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 415_926_026, "ETH/USD": 211_257_776, "SOL/USD": 89_808_255, "XRP/USD": 115_479_491,
  "DOGE/USD": 26_124_284, "LINK/USD": 13_164_095, "ADA/USD": 15_830_445, "AVAX/USD": 19_643_858,
  "BNB/USD": 2_563_680, "HYPE/USD": 18_493_063, "XLM/USD": 7_721_199, "UNI/USD": 14_812_551,
  "NEAR/USD": 35_996_883, "BCH/USD": 3_924_414, "LTC/USD": 13_486_524, "SUI/USD": 36_150_670,
  "DOT/USD": 1_422_526, "HBAR/USD": 3_495_175, "TON/USD": 1_200_158, "SHIB/USD": 1_771_678,
  "PEPE/USD": 15_044_906, "AAVE/USD": 5_518_518, "ETC/USD": 326_847, "ALGO/USD": 2_194_523,
  "ICP/USD": 2_156_769, "POL/USD": 2_300_203, "ATOM/USD": 665_938,
};
const MIN_BOOK_USD = 100_000;

/** `agent_risk` (migration 0037). */
const MAX_ORDER_USD = 20;

/** The live recommendation, reference §3.11 question 6 and `docs/agents/go-live.md`. */
const LIVE_CANDIDATE = { row: "trend-4h", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100, slots: 5 };

/** The overlap test `backtest_windows.ts` declared before it compared two sources, kept identical here. */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
/** A window is only scored when its in-sample has at least this many days to choose on. Same floor as §3.15. */
const MIN_IN_SAMPLE_DAYS = 180;
/** The floor plus the 3×ATR(14) intra-bar trail — what §3.7 / §3.8 / §3.10 / §3.11 were computed under. */
const PINNED_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };

/**
 * THE REVOLUT X COVERAGE RULE, written down before a single return was looked at.
 *
 * An arm whose FILL tape is Revolut X can price a window only over the span that
 * tape actually covers. The out-of-sample span is intersected with the tape's
 * own span, and the window is priced only when what is left is at least
 * `RX_MIN_DAYS` long AND at least `RX_MIN_SPAN_SHARE` of the window's original
 * out-of-sample days. When it is priced, the CLIPPED span is used on EVERY arm —
 * a comparison between two different calendars is not a comparison — and the
 * unclipped span is reported alongside on the arms that can see it, so what the
 * clip costs is visible rather than assumed.
 */
const RX_MIN_DAYS = 180;
const RX_MIN_SPAN_SHARE = 0.9;

/**
 * THE MISSING-FILL-BAR RULE, also written down first.
 *
 * The decision is taken on the signal series' bar `i`; the fill is priced on the
 * FILL series' bar with the same start timestamp. When the fill series has no
 * bar there, something must happen, and what happens is data rather than an edge
 * case to paper over.
 *
 * `carry` (the headline): the fill is priced on a flat synthetic bar at the fill
 * series' most recent earlier close, provided that bar is no more than
 * `MAX_CARRY_MS` old. That is what the account would actually see — a venue with
 * no print in an hour still has a last price, and a live book always quotes —
 * and it is conservative in the only direction that matters, because a flat bar
 * has no high and no low for a stop to reach through. Beyond the cap the fill is
 * REFUSED: no entry, no exit, no stop that bar, and the mark carries.
 * `skip`: every bar without an exact match is refused, with no carry at all.
 *
 * Both are implemented, every fill that landed on a carried bar is counted, and
 * the live candidate is reported under both so the policy's cost is a number.
 */
const MAX_CARRY_MS = 3 * 4 * 3600e3;   // three bars

// ───────────────────────────────────────────────────────────── the simulator

/** One fill, with the two venues' prices at that instant — the raw material of §F3. */
export type FillRecord = {
  ts: number;
  side: "buy" | "sell";
  reason: "entry" | "exit" | "stop";
  /** The price actually paid or received on the FILL tape, half-spread included. */
  price: number;
  /** The fill tape's own bar open at this timestamp (or the carried close). */
  fillRef: number;
  /** The signal tape's bar open at the same timestamp. */
  signalRef: number;
  /** (fillRef / signalRef − 1) × 1e4 — the basis, signed as the fill tape against the signal tape. */
  basisBps: number;
  /** The basis signed AGAINST the trade: positive means the fill tape was the worse place to do this trade. */
  adverseBps: number;
  /** True when this fill was priced on a carried bar rather than an exact timestamp match. */
  carried: boolean;
  /** Notional in units of the sleeve's slot — an entry and an exit each count 1. */
  weight: number;
};

export type SplitResult = RunResult & {
  /** Σ over fills of the notional traded in units of the slot. */
  tradedWeight: number;
  /** The mark at EVERY bar, so a day's mark does not depend on where the array starts. */
  marks: [number, number][];
  /** `run`'s own every-sixth-bar sampling, kept separately so the fidelity check can compare curves. */
  equitySampled: [number, number][];
  fills: FillRecord[];
  /** How the fill tape lined up with the signal tape over the scored span. */
  align: { bars: number; exact: number; carried: number; refused: number; fillsOnCarried: number; decisionsRefused: number };
};

/**
 * Line the FILL series up with the SIGNAL series by TIMESTAMP, never by index.
 * Returns one entry per signal bar: the fill tape's bar at that instant, a flat
 * carried bar, or null.
 */
export function alignFill(
  sig: Candle[], fill: Candle[], policy: "carry" | "skip", maxCarryMs = MAX_CARRY_MS,
): { aligned: (Candle | null)[]; carriedFlag: boolean[]; exact: number; carried: number; refused: number } {
  const byTs = new Map<number, Candle>();
  for (const c of fill) byTs.set(c.start, c);
  const aligned: (Candle | null)[] = new Array(sig.length).fill(null);
  const carriedFlag: boolean[] = new Array(sig.length).fill(false);
  let exact = 0, carried = 0, refused = 0;
  let j = 0, last: Candle | null = null;
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i].start;
    while (j < fill.length && fill[j].start <= t) { last = fill[j]; j++; }
    const hit = byTs.get(t);
    if (hit) { aligned[i] = hit; exact++; continue; }
    if (policy === "carry" && last && t - last.start <= maxCarryMs) {
      const c = last.close;
      aligned[i] = { start: t, open: c, high: c, low: c, close: c, volume: 0 };
      carriedFlag[i] = true; carried++; continue;
    }
    refused++;
  }
  return { aligned, carriedFlag, exact, carried, refused };
}

/**
 * `backtest.ts`'s `run` with the decision and the fill on DIFFERENT series.
 *
 * The split follows `tick.ts` line for line, and the division is NOT "signal
 * decides, fill does everything else" — the live loop is more mixed than that,
 * and copying the simpler story would have been wrong:
 *
 *  - Decisions read `sig`: `precompute`, `buildSnapshot`, `ruleFor`, the daily
 *    closes, the bar clock and the span arithmetic.
 *  - Prices PAID read the fill tape: the entry and the rule exit at the next
 *    bar's open ± the half-spread paying `fillFee`, and therefore `avgCost`,
 *    which is an average of prices actually paid.
 *  - The position's HIGH-WATER advances on the SIGNAL tape's highs, because
 *    that is what the loop does: `tick.ts` hands `ruleFor` a position through
 *    `trailed(pos, bars, forming)` and reads its stop level from
 *    `highWaterSince(pos, bars, i)` and `atrAt(bars, i, p.atrN)`, where `bars`
 *    is the SIGNAL venue's candles. Trailing it on the fill tape instead moves
 *    the rulebook's own close-based trail, which is a decision, not a fill —
 *    it changed AVAX's window A by 19 points before this was corrected.
 *  - The protective exit is checked against the fill tape's low, because the
 *    loop checks it against the EXECUTION venue's live mark. Its level is
 *    `max(floor, trail)` where the floor is fill-tape denominated (a fraction
 *    under `avgCost`) and the trail is signal-tape denominated (the signal
 *    high-water less a signal ATR). That mixes two venues' price units inside
 *    one comparison — and it does so because the loop does; under the shipped
 *    stop the trail is off and only the floor remains, so the headline is not
 *    exposed to it.
 *  - The mark, the drawdown and the closing equity read the fill tape: that is
 *    what the account is worth.
 *
 * The two-bar cooldown, the fee, the half-spread and the return, drawdown,
 * trade-count, exposure and day arithmetic are `run`'s, unchanged.
 *
 * With `fill === sig` it IS `run`, and `f1_fidelity.runSplit` is the proof.
 */
export function runSplit(
  kind: StrategyKind, symbol: string, sig: Candle[], fill: Candle[], daily: Candle[],
  from: number, to: number, p: TrendParams, costs: Costs, barHours: number, stops: StopParams | null,
  policy: "carry" | "skip" = "carry",
): SplitResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fillFee = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  const { aligned, carriedFlag } = fill === sig
    ? { aligned: sig as (Candle | null)[], carriedFlag: new Array<boolean>(sig.length).fill(false) }
    : alignFill(sig, fill, policy);
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  let tradedWeight = 0;
  const marks: [number, number][] = [];
  const equitySampled: [number, number][] = [];
  const fills: FillRecord[] = [];
  const pre = precompute(sig, p);
  let dk = 0; // daily candles closed at or before the current 4h bar (moves forward only)
  const start = Math.max(from, p.slow + 1);
  let bars = 0, exact = 0, carried = 0, refused = 0, fillsOnCarried = 0, decisionsRefused = 0;
  let lastEq = 1.0;
  const rec = (ts: number, side: "buy" | "sell", reason: FillRecord["reason"], price: number, fRef: number, sRef: number, isCarried: boolean) => {
    const basisBps = sRef > 0 ? (fRef / sRef - 1) * 1e4 : 0;
    fills.push({
      ts, side, reason, price, fillRef: fRef, signalRef: sRef,
      basisBps, adverseBps: side === "buy" ? basisBps : -basisBps,
      carried: isCarried, weight: 1,
    });
    if (isCarried) fillsOnCarried++;
  };
  for (let i = start; i < to - 1; i++) {
    while (dk < daily.length && daily[dk].start + 86400e3 <= sig[i].start + barHours * 3600e3) dk++;
    const snap = buildSnapshot(symbol, sig, i, daily.slice(0, dk), pos, sig[i].start + barHours * 3600e3, p, pre, (24 / barHours) * 365);
    const rule = ruleFor(kind, snap, pos, p);
    const nextSig = sig[i + 1];
    const next = aligned[i + 1];
    bars++;
    if (!next) { refused++; } else if (carriedFlag[i + 1]) { carried++; } else { exact++; }
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (!next) {
      // The fill tape has no price at this instant and none close enough to carry: nothing can be
      // executed, nothing can be marked. The decision is dropped for this bar and counted.
      if ((rule.action === "enter" && pos.base === 0 && !coolingDown) || (rule.action === "exit" && pos.base > 0)) decisionsRefused++;
      if (pos.base > 0) barsLong++;
      marks.push([nextSig.start, lastEq]);
      if (i % 6 === 0) equitySampled.push([nextSig.start, Number(lastEq.toFixed(5))]);
      continue;
    }
    if (rule.action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);                    // the touch, at the next open
      const base = cash / (price * (1 + fillFee));           // the fee comes out of the same cash
      const fee = base * price * fillFee;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++; tradedWeight += 1;
      rec(nextSig.start, "buy", "entry", price, next.open, nextSig.open, carriedFlag[i + 1]);
    } else if (rule.action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fillFee;
      cash = pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; tradedWeight += 1; lastExitBar = i + 1;
      rec(nextSig.start, "sell", "exit", price, next.open, nextSig.open, carriedFlag[i + 1]);
    } else if (stops && pos.base > 0) {
      const hw = Math.max(pos.highWater ?? pos.avgCost, pos.avgCost);
      const atr = stops.atrStop != null ? atrAt(sig, i, stops.atrN) : null;   // tick.ts reads the SIGNAL venue's ATR
      const floor = pos.avgCost * (1 - stops.maxLossPct);
      const trail = stops.atrStop != null && atr != null ? hw - stops.atrStop * atr : -Infinity;
      const level = Math.max(floor, trail);
      if (next.low <= level) {
        const price = Math.min(level, next.open) * (1 - hs);
        const fee = pos.base * price * stopFee;
        cash = pos.base * price - fee;
        pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
        trades++; stopsHit++; tradedWeight += 1; lastExitBar = i + 1;
        rec(nextSig.start, "sell", "stop", price, next.open, nextSig.open, carriedFlag[i + 1]);
      }
    }
    // The high-water trails the SIGNAL venue's bars, as `trailed(pos, bars, forming)` does in tick.ts.
    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? nextSig.high, nextSig.high) }; }
    const eq = cash + pos.base * next.close;
    lastEq = eq;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    marks.push([nextSig.start, eq]);
    if (i % 6 === 0) equitySampled.push([nextSig.start, Number(eq.toFixed(5))]);
  }
  // The closing mark: the fill tape's own close at the signal tape's last bar, or the last one it had.
  let endBar = aligned[to - 1];
  if (!endBar) for (let k = to - 2; k >= start && !endBar; k--) endBar = aligned[k];
  const eqEnd = cash + pos.base * (endBar ? endBar.close : 0);
  const days = (sig[to - 1].start - sig[start].start) / 86400e3;
  return {
    ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity: marks,
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit, tradedWeight, marks, equitySampled, fills,
    align: { bars, exact, carried, refused, fillsOnCarried, decisionsRefused },
  };
}

// ─────────────────────────────────────────────────────── arithmetic on outputs

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
const r4 = (x: number) => Number(x.toFixed(4));
const r3 = (x: number) => Number(x.toFixed(3));
const r2 = (x: number) => Number(x.toFixed(2));

/** Pearson correlation. Copied from `backtest_portfolio.ts`. */
function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
/** Spearman — Pearson on ranks, ties averaged. Copied from `backtest_windows.ts`. */
function spearman(xs: number[], ys: number[]): number | null {
  const rank = (v: number[]): number[] => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  return pearson(rank(xs), rank(ys));
}

type Plateau = { gridPoints: number; positiveShare: number; median: number; chosenRank: number };
function plateauOf(rets: number[], chosen: number): Plateau {
  const s = rets.slice().sort((a, b) => a - b);
  return {
    gridPoints: s.length,
    positiveShare: r3(s.filter((r) => r > 0).length / s.length),
    median: r4(s[Math.floor(s.length / 2)]),
    chosenRank: s.filter((r) => r > chosen).length + 1,
  };
}

/** §4.15's four tests on ONE window on ONE venue. Copied from `backtest_windows.ts`'s `barTests`. */
function barTests(own: RunResult, other: RunResult, plateau: Plateau): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!(own.ret > 0)) failed.push("own-venue return not positive");
  if (!(own.maxDD < 0.35)) failed.push("drawdown ≥ 35 %");
  if (!(plateau.positiveShare >= 0.5)) failed.push("plateau < 50 %");
  if (!(other.ret > 0)) failed.push("other-venue return not positive");
  return { pass: failed.length === 0, failed };
}

function score(r: RunResult): number { return r.ret / Math.max(0.05, r.maxDD); }
function pick(r: RunResult) {
  return {
    ret: r4(r.ret), maxDD: r4(r.maxDD), retOverDD: r2(score(r)),
    trades: r.trades, days: Math.round(r.days), exposure: r3(r.exposure), stopsHit: r.stopsHit ?? 0,
  };
}

/** The last mark of each UTC day. Copied from `backtest_portfolio.ts`. */
function dailyMarks(equity: [number, number][]): { day: number; eq: number }[] {
  const m = new Map<number, number>();
  for (const [t, e] of equity) m.set(Math.floor(t / 86400e3) * 86400e3, e);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, eq]) => ({ day, eq }));
}
/** A sleeve's daily FRACTIONAL returns — what a live row earns on a fixed slot. */
function dailyReturns(equity: [number, number][]): Map<number, number> {
  const out = new Map<number, number>();
  let prev = 1;
  for (const { day, eq } of dailyMarks(equity)) { out.set(day, prev > 0 ? eq / prev - 1 : 0); prev = eq; }
  return out;
}

type Sleeve = { id: string; symbol: string; slotUsd: number; rets: Map<number, number>; ret: number; maxDD: number; trades: number; exposure: number; tradedUsd: number };
type SleeveStats = {
  members: number; capitalUsd: number; pnlUsd: number; ret: number; maxDD: number; retOverDD: number;
  days: number; from: string; to: string; deployment: number; turnoverPerYear: number;
  bestDayUsd: number; worstDayUsd: number; peakOpenUsd: number;
};
/** Combine sleeves at their slot sizes. Copied from `backtest_portfolio.ts`'s `combine`. */
function combine(sleeves: Sleeve[]): SleeveStats {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  if (days.length === 0) {
    return {
      members: sleeves.length, capitalUsd: r2(capital), pnlUsd: 0, ret: 0, maxDD: 0, retOverDD: 0,
      days: 0, from: "", to: "", deployment: 0, turnoverPerYear: 0, bestDayUsd: 0, worstDayUsd: 0, peakOpenUsd: r2(capital),
    };
  }
  let eq = capital, peak = capital, maxDD = 0, best = -Infinity, worst = Infinity;
  for (const d of days) {
    let pnl = 0;
    for (const s of sleeves) pnl += s.slotUsd * (s.rets.get(d) ?? 0);
    eq += pnl;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    best = Math.max(best, pnl); worst = Math.min(worst, pnl);
  }
  const years = Math.max(1e-9, (days[days.length - 1] - days[0]) / 86400e3 / 365);
  const deployment = capital > 0 ? sleeves.reduce((a, s) => a + s.slotUsd * s.exposure, 0) / capital : 0;
  const ret = (eq - capital) / Math.max(1e-9, capital);
  return {
    members: sleeves.length, capitalUsd: r2(capital), pnlUsd: r2(eq - capital),
    ret: r4(ret), maxDD: r4(maxDD), retOverDD: r2(ret / Math.max(0.05, maxDD)),
    days: days.length, from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days[days.length - 1]).toISOString().slice(0, 10),
    deployment: r3(deployment), turnoverPerYear: r2(sleeves.reduce((a, s) => a + s.tradedUsd, 0) / capital / years),
    bestDayUsd: r2(best), worstDayUsd: r2(worst), peakOpenUsd: r2(sleeves.reduce((a, s) => a + s.slotUsd, 0)),
  };
}

// ─────────────────────────────────────────────── the exact chance arithmetic

/** log C(n, k). Copied from `backtest_windows.ts`. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
/** P(|S ∩ T| = j) when S (|S| = a) and T (|T| = b) are drawn uniformly from n items — hypergeometric. */
function hyper(n: number, a: number, b: number, j: number): number {
  if (j > Math.min(a, b) || j < Math.max(0, a + b - n)) return 0;
  return Math.exp(logChoose(a, j) + logChoose(n - a, b - j) - logChoose(n, b));
}
/** The exact distribution of how many of `n` coins clear ALL windows whose pass counts are `ks`. */
function intersectionDistribution(n: number, ks: number[]): number[] {
  let dist = new Array<number>(n + 1).fill(0);
  dist[ks[0]] = 1;
  for (let w = 1; w < ks.length; w++) {
    const next = new Array<number>(n + 1).fill(0);
    for (let cur = 0; cur <= n; cur++) {
      if (dist[cur] === 0) continue;
      for (let j = 0; j <= Math.min(cur, ks[w]); j++) next[j] += dist[cur] * hyper(n, cur, ks[w], j);
    }
    dist = next;
  }
  return dist;
}
/**
 * The exact two-sided sign test: under "the two fill tapes are exchangeable"
 * each non-zero difference is a fair coin, so the count of positives is
 * Binomial(m, ½) and the p-value is the total mass of outcomes no more likely
 * than the one observed. Computed exactly, never sampled.
 */
function signTest(pos: number, neg: number): { positives: number; negatives: number; pTwoSided: number } {
  const m = pos + neg;
  if (m === 0) return { positives: pos, negatives: neg, pTwoSided: 1 };
  const k = Math.min(pos, neg);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(m, i) - m * Math.LN2);
  return { positives: pos, negatives: neg, pTwoSided: Number(Math.min(1, 2 * tail).toFixed(6)) };
}

// ──────────────────────────────────────────────────────── the data and windows

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const toCandles = (raw: Raw[]): Candle[] => raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));

/** The bar at or after `ts`, or the array length when there is none. Copied from `backtest_windows.ts`. */
function indexAtOrAfter(bars: Candle[], ts: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].start < ts) lo = mid + 1; else hi = mid; }
  return lo;
}

type Win = {
  name: "A" | "B" | "C" | "D";
  isSeries: "coinbase" | "combined";
  isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  isDays: number; oosDays: number; isFromIso: string; oosFromIso: string; oosToIso: string;
  scored: boolean; why: string;
};

const YEAR_MS = 365 * 86400e3;

/** The four windows, identical to `backtest_windows.ts`'s `windowsOn` — the same cuts, the same floor, the same names. */
function windowsOn(comb: Candle[], cb: Candle[], maxLookbackBars: number): Win[] {
  const nCb = cb.length, t1 = Math.floor(nCb / 3), t2 = Math.floor(nCb * 2 / 3);
  const z = indexAtOrAfter(comb, cb[0].start);
  const T1 = indexAtOrAfter(comb, cb[t1].start);
  const T2 = indexAtOrAfter(comb, cb[t2].start);
  const N = comb.length;
  const Zc = indexAtOrAfter(comb, cb[0].start - 2 * YEAR_MS);
  const Zd1 = indexAtOrAfter(comb, cb[0].start - 1 * YEAR_MS);
  const Zd3 = indexAtOrAfter(comb, cb[0].start - 3 * YEAR_MS);
  const days = (a: number, b: number) => b > a ? (comb[b - 1].start - comb[a].start) / 86400e3 : 0;
  const mk = (name: Win["name"], isSeries: Win["isSeries"], isFrom: number, isTo: number, oosFrom: number, oosTo: number): Win => {
    const arr = isSeries === "coinbase" ? cb : comb;
    const isDays = isTo > isFrom ? (arr[isTo - 1].start - arr[isFrom].start) / 86400e3 : 0;
    const oosDays = days(oosFrom, oosTo);
    let why = "";
    if (isTo - isFrom <= maxLookbackBars + 2) why = `in-sample is ${isTo - isFrom} bars, shorter than the widest lookback (${maxLookbackBars})`;
    else if (isDays < MIN_IN_SAMPLE_DAYS) why = `in-sample is ${isDays.toFixed(0)} days, under the ${MIN_IN_SAMPLE_DAYS}-day floor`;
    else if (oosTo - oosFrom <= maxLookbackBars + 2) why = `out-of-sample is ${oosTo - oosFrom} bars, shorter than the widest lookback`;
    return {
      name, isSeries, isFrom, isTo, oosFrom, oosTo,
      isDays: Number(isDays.toFixed(1)), oosDays: Number(oosDays.toFixed(1)),
      isFromIso: isTo > isFrom ? iso(arr[isFrom].start) : "", oosFromIso: oosTo > oosFrom ? iso(comb[oosFrom].start) : "",
      oosToIso: oosTo > oosFrom ? iso(comb[oosTo - 1].start) : "",
      scored: why === "", why,
    };
  };
  return [
    mk("A", "coinbase", 0, t2, T2, N), mk("B", "coinbase", 0, t1, T1, T2),
    mk("C", "combined", Zc, z, z, T1), mk("D", "combined", Zd3, Zd1, Zd1, z),
  ];
}

/** |Δclose| in bps between two series over every bar they share, plus the shared count. */
function tapeAgreement(a: Candle[], b: Candle[], fromTs: number, toTs: number) {
  const byTs = new Map(b.map((c) => [c.start, c]));
  const diffs: number[] = [];
  for (const c of a) {
    if (c.start < fromTs || c.start >= toTs) continue;
    const k = byTs.get(c.start);
    if (k && c.close > 0) diffs.push(Math.abs(k.close / c.close - 1) * 1e4);
  }
  return diffs.length
    ? { sharedBars: diffs.length, medianBps: Number(median(diffs).toFixed(3)), p95Bps: Number(quantile(diffs, 0.95).toFixed(3)), maxBps: Number(Math.max(...diffs).toFixed(3)) }
    : { sharedBars: 0, medianBps: null, p95Bps: null, maxBps: null };
}

/** Annualised standard deviation of 4-hour log returns over a span. */
function volOver(bars: Candle[], fromTs: number, toTs: number): number | null {
  const rs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].start < fromTs || bars[i].start >= toTs) continue;
    if (bars[i - 1].close > 0 && bars[i].close > 0) rs.push(Math.log(bars[i].close / bars[i - 1].close));
  }
  if (rs.length < 30) return null;
  const m = mean(rs);
  const v = rs.reduce((a, x) => a + (x - m) * (x - m), 0) / (rs.length - 1);
  return Number((Math.sqrt(v) * Math.sqrt(6 * 365)).toFixed(4));
}

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? ""), rDir = String(args.rtape ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const tapePath = args.tape ? String(args.tape) : "";
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  if (!extDir) throw new Error("--ext <dir with BTC-USD_1h_kraken.json …> is required");
  if (!kDir) throw new Error("--ktape <dir with BTC-USD_4h_kraken.json …> is required");
  if (!rDir) throw new Error("--rtape <dir with BTC-USD_4h_revx.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  const sha = async (u: URL | string) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(u));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btPath = new URL("./backtest.ts", import.meta.url);
  const btHashStart = await sha(btPath);

  // Every coin with a MEASURED half-spread on BOTH venues and a file in all four directories.
  const priced = Object.keys(COSTS.revx.halfSpread).filter((s) => COSTS.kraken.halfSpread[s] != null).sort();
  const haveData = new Set<string>(), haveExt = new Set<string>(), haveK = new Set<string>(), haveR = new Set<string>();
  for await (const e of Deno.readDir(dataDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_3y\.json$/); if (m) haveData.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(extDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_kraken\.json$/); if (m) haveExt.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(kDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_4h_kraken\.json$/); if (m) haveK.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(rDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_4h_revx\.json$/); if (m) haveR.add(`${m[1]}/USD`); }
  const candidates = priced.filter((s) => haveData.has(s) && haveExt.has(s) && haveK.has(s));
  console.log(`candidates (${candidates.length}): ${candidates.join(", ")}`);

  let tapeProv: Record<string, Record<string, unknown>> = {};
  try { tapeProv = JSON.parse(await Deno.readTextFile(`${kDir}/provenance.json`)); } catch { /* optional */ }
  let rProv: Record<string, Record<string, unknown>> = {};
  try { rProv = JSON.parse(await Deno.readTextFile(`${rDir}/provenance.json`)); } catch { /* optional */ }

  // ── build the three tapes ──────────────────────────────────────────────
  type Arm = { c4h: Candle[]; daily: Candle[]; is4h: Candle[]; isDaily: Candle[] };
  type Cover = { covered: boolean; why: string; clipFromTs: number; clipToTs: number; clipDays: number; share: number };
  type Series = {
    coinbase: Arm; kraken: Arm; cb4h: Candle[]; revx: Candle[] | null; wins: Win[];
    krakenCoverage: Record<string, { covered: boolean; why: string }>;
    revxCoverage: Record<string, Cover>;
    overlapK: ReturnType<typeof tapeAgreement>;
    overlapRxCb: ReturnType<typeof tapeAgreement>;
    overlapRxK: ReturnType<typeof tapeAgreement>;
    krakenGapsInSpan: number;
  };
  const series: Record<string, Series> = {};
  const provenance: Record<string, unknown>[] = [];
  const symbols: string[] = [];
  const MAX_LOOKBACK = 301;

  for (const symbol of candidates) {
    const base = symbol.replace("/", "-");
    const cbH = toCandles(JSON.parse(await Deno.readTextFile(`${dataDir}/${base}_1h_3y.json`)) as Raw[]);
    const kH = toCandles(JSON.parse(await Deno.readTextFile(`${extDir}/${base}_1h_kraken.json`)) as Raw[]);
    const kTape = toCandles(JSON.parse(await Deno.readTextFile(`${kDir}/${base}_4h_kraken.json`)) as Raw[]);
    const rTape = haveR.has(symbol) ? toCandles(JSON.parse(await Deno.readTextFile(`${rDir}/${base}_4h_revx.json`)) as Raw[]) : null;
    const spliceAt = cbH[0].start;

    const cb4h = resample(cbH, 4);
    const combH = [...kH.filter((c) => c.start < spliceAt), ...cbH];
    const comb4h = resample(combH, 4), combDaily = resample(combH, 24);
    const cbDaily = resample(cbH, 24);
    const zK = indexAtOrAfter(kTape, spliceAt);
    const kIs4h = kTape.slice(zK);
    const kDaily = resample(kTape, 24);
    const kIsDaily = kDaily.filter((c) => c.start >= (kIs4h.length ? kIs4h[0].start : Infinity));

    const wins = windowsOn(comb4h, cb4h, MAX_LOOKBACK);
    // The Kraken-tape coverage rule, identical to `backtest_tape.ts`'s.
    const krakenCoverage: Record<string, { covered: boolean; why: string }> = {};
    for (const w of wins) {
      if (!w.scored) { krakenCoverage[w.name] = { covered: false, why: `not scored on the published arm either: ${w.why}` }; continue; }
      const isArrCb = w.isSeries === "coinbase" ? cb4h : comb4h;
      const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
      const isFromTs = isArrCb[w.isFrom].start, isToTs = endTs(isArrCb, w.isTo);
      const oosFromTs = comb4h[w.oosFrom].start, oosToTs = endTs(comb4h, w.oosTo);
      const kIsArr = w.isSeries === "coinbase" ? kTape.slice(indexAtOrAfter(kTape, spliceAt)) : kTape;
      const kIsBars = indexAtOrAfter(kIsArr, isToTs) - indexAtOrAfter(kIsArr, isFromTs);
      const kOosBars = indexAtOrAfter(kTape, oosToTs) - indexAtOrAfter(kTape, oosFromTs);
      let why = "";
      if (kTape[0].start > isFromTs) why = `Kraken's tape starts ${iso(kTape[0].start)}, after this window's in-sample begins (${iso(isFromTs)})`;
      else if (kTape[kTape.length - 1].start + 4 * 3600e3 < oosToTs) why = `Kraken's tape ends ${iso(kTape[kTape.length - 1].start)}, before this window's out-of-sample ends (${iso(oosToTs)})`;
      else if (kIsBars <= MAX_LOOKBACK + 2) why = `Kraken in-sample is ${kIsBars} bars, shorter than the widest lookback (${MAX_LOOKBACK})`;
      else if (kOosBars <= MAX_LOOKBACK + 2) why = `Kraken out-of-sample is ${kOosBars} bars, shorter than the widest lookback (${MAX_LOOKBACK})`;
      krakenCoverage[w.name] = { covered: why === "", why };
    }
    // The Revolut X coverage rule, declared at the head of this file.
    const revxCoverage: Record<string, Cover> = {};
    for (const w of wins) {
      const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
      const oosFromTs = comb4h[w.oosFrom].start, oosToTs = endTs(comb4h, w.oosTo);
      const oosDays = (oosToTs - oosFromTs) / 86400e3;
      if (!w.scored || !krakenCoverage[w.name].covered) {
        revxCoverage[w.name] = { covered: false, why: "the window is not priced on the Kraken arm either", clipFromTs: 0, clipToTs: 0, clipDays: 0, share: 0 };
        continue;
      }
      if (!rTape || !rTape.length) {
        revxCoverage[w.name] = { covered: false, why: "no Revolut X UK tape for this symbol", clipFromTs: 0, clipToTs: 0, clipDays: 0, share: 0 };
        continue;
      }
      const from = Math.max(oosFromTs, rTape[0].start);
      const to = Math.min(oosToTs, rTape[rTape.length - 1].start + 4 * 3600e3);
      const clipDays = Math.max(0, (to - from) / 86400e3);
      const share = oosDays > 0 ? clipDays / oosDays : 0;
      let why = "";
      if (clipDays < RX_MIN_DAYS) why = `Revolut X covers ${clipDays.toFixed(0)} of this window's ${oosDays.toFixed(0)} out-of-sample days, under the ${RX_MIN_DAYS}-day floor`;
      else if (share < RX_MIN_SPAN_SHARE) why = `Revolut X covers ${(share * 100).toFixed(1)} % of the window, under the ${(RX_MIN_SPAN_SHARE * 100).toFixed(0)} % floor`;
      revxCoverage[w.name] = { covered: why === "", why, clipFromTs: from, clipToTs: to, clipDays: Number(clipDays.toFixed(1)), share: r3(share) };
    }

    const ov4h = tapeAgreement(cb4h, kTape, cb4h[0].start, cb4h[cb4h.length - 1].start + 4 * 3600e3);
    const rejected: string[] = [];
    if (!ov4h.sharedBars || ov4h.sharedBars < 100) rejected.push(`overlap is ${ov4h.sharedBars} 4h bars — too few to verify`);
    else {
      if ((ov4h.medianBps ?? 0) > OVERLAP_MEDIAN_MAX_BPS) rejected.push(`overlap median ${ov4h.medianBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`);
      if ((ov4h.p95Bps ?? 0) > OVERLAP_P95_MAX_BPS) rejected.push(`overlap p95 ${ov4h.p95Bps} bps > ${OVERLAP_P95_MAX_BPS}`);
    }
    const rxSpan = rTape && rTape.length ? { from: rTape[0].start, to: rTape[rTape.length - 1].start + 4 * 3600e3 } : null;
    const ovRxCb = rxSpan ? tapeAgreement(cb4h, rTape!, rxSpan.from, rxSpan.to) : { sharedBars: 0, medianBps: null, p95Bps: null, maxBps: null };
    const ovRxK = rxSpan ? tapeAgreement(kTape, rTape!, rxSpan.from, rxSpan.to) : { sharedBars: 0, medianBps: null, p95Bps: null, maxBps: null };
    let gaps = 0;
    for (let i = 1; i < kTape.length; i++) if (kTape[i].start >= cb4h[0].start && kTape[i].start - kTape[i - 1].start !== 4 * 3600e3) gaps++;

    series[symbol] = {
      coinbase: { c4h: comb4h, daily: combDaily, is4h: cb4h, isDaily: cbDaily },
      kraken: { c4h: kTape, daily: kDaily, is4h: kIs4h, isDaily: kIsDaily },
      cb4h, revx: rTape, wins, krakenCoverage, revxCoverage,
      overlapK: ov4h, overlapRxCb: ovRxCb, overlapRxK: ovRxK, krakenGapsInSpan: gaps,
    };
    provenance.push({
      symbol,
      coinbase: { bars4h: cb4h.length, first: iso(cb4h[0].start), last: iso(cb4h[cb4h.length - 1].start) },
      krakenTape: { bars4h: kTape.length, first: iso(kTape[0].start), last: iso(kTape[kTape.length - 1].start), missingBarsOverCoinbaseSpan: gaps, source: tapeProv[symbol] ?? null },
      revxTape: rTape && rTape.length
        ? {
          bars4h: rTape.length, first: iso(rTape[0].start), last: iso(rTape[rTape.length - 1].start),
          days: Number(((rTape[rTape.length - 1].start - rTape[0].start) / 86400e3).toFixed(1)),
          /** Bars the venue's own series is missing inside its span — ETC and TON have them; they go through the carry rule and are counted at every fill. */
          gapBars: rTape.reduce((a, _c, i) => a + (i > 0 && rTape[i].start - rTape[i - 1].start !== 4 * 3600e3 ? 1 : 0), 0),
          source: rProv[symbol.replace("/", "-")] ?? rProv[symbol] ?? null,
        }
        : null,
      overlapKrakenVsCoinbase: ov4h,
      overlapRevxVsCoinbase: ovRxCb,
      overlapRevxVsKraken: ovRxK,
      accepted: rejected.length === 0, rejected,
      windowsOnPublishedArm: wins.filter((w) => w.scored).map((w) => w.name),
      windowsPricedOnKraken: wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name),
      windowsPricedOnRevxFill: wins.filter((w) => revxCoverage[w.name].covered).map((w) => ({ window: w.name, clipDays: revxCoverage[w.name].clipDays, share: revxCoverage[w.name].share })),
      windowsWithoutRevxFill: wins.filter((w) => w.scored && krakenCoverage[w.name].covered && !revxCoverage[w.name].covered).map((w) => ({ window: w.name, why: revxCoverage[w.name].why })),
    });
    if (rejected.length === 0) symbols.push(symbol);
    console.log(`${symbol.padEnd(9)} cb ${cb4h.length} | kraken ${kTape.length} | revx ${rTape?.length ?? 0} | rx-vs-cb ${ovRxCb.medianBps ?? "—"}/${ovRxCb.p95Bps ?? "—"} bps, rx-vs-k ${ovRxK.medianBps ?? "—"}/${ovRxK.p95Bps ?? "—"} | windows ${wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name).join("") || "—"} → revx-fill ${wins.filter((w) => revxCoverage[w.name].covered).map((w) => w.name).join("") || "—"}${rejected.length ? " REJECTED " + rejected.join("; ") : ""}`);
  }
  console.log(`accepted (${symbols.length}): ${symbols.join(", ")}`);

  // ── the grid and the arms ───────────────────────────────────────────────
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const SEEDED_IDX = TREND_GRID.findIndex((p) => p.fast === DEFAULT_TREND.fast && p.slow === DEFAULT_TREND.slow && p.atrStop === DEFAULT_TREND.atrStop);
  const VENUES = ["revx", "kraken"] as const;
  const other = (v: "revx" | "kraken") => v === "revx" ? "kraken" as const : "revx" as const;

  type TapeId = "coinbase" | "kraken" | "revx";
  /**
   * An ARM is a (signal tape, fill tape) pair. `a`, `b` and `c` are the three
   * §F2 asks for; `bc` and `cb_rx` are the other two cells of §F3's 2 × 2.
   */
  type ArmDef = { id: string; signal: TapeId; fill: TapeId; label: string; needsRx: boolean; full: boolean };
  const ARMS: ArmDef[] = [
    { id: "b_cb_cb", signal: "coinbase", fill: "coinbase", label: "(b) signal Coinbase + fill Coinbase — the published arm (§3.15 / §3.16's `coinbase`)", needsRx: false, full: true },
    { id: "a_kr_kr", signal: "kraken", fill: "kraken", label: "(a) signal Kraken + fill Kraken — §3.16's Kraken arm", needsRx: false, full: true },
    { id: "c_kr_rx", signal: "kraken", fill: "revx", label: "(c) signal Kraken + fill Revolut X UK — WHAT THE LOOP ACTUALLY DOES", needsRx: true, full: true },
    { id: "p_kr_cb", signal: "kraken", fill: "coinbase", label: "signal Kraken + fill Coinbase — the proxy for (c) where Revolut X's tape does not reach, and the 2×2's third cell", needsRx: false, full: true },
    { id: "q_cb_rx", signal: "coinbase", fill: "revx", label: "signal Coinbase + fill Revolut X UK — the 2×2's fourth cell (fill changed alone)", needsRx: true, full: false },
  ];

  type Regime = { id: "shipped" | "trail"; label: string; stops: (p: TrendParams) => StopParams };
  const REGIMES: Regime[] = [
    { id: "shipped", label: "the stops backtest.ts ships at the moment of this run — the 8 % floor alone, the intra-bar trail removed (reference §3.13); what tick.ts runs", stops: (p) => stopsForKind("trend-4h", p) },
    { id: "trail", label: "the 8 % floor and the 3×ATR(14) intra-bar trail — the pair §3.7 / §3.8 / §3.10 / §3.11 were computed under", stops: (p) => ({ ...PINNED_STOPS, atrStop: p.atrStop }) },
  ];

  type Cell = {
    chosen: { fast: number; slow: number; atrStop: number };
    chosenOwn: ReturnType<typeof pick>; chosenOther: ReturnType<typeof pick>;
    seededOwn: ReturnType<typeof pick>; seededOther: ReturnType<typeof pick>;
    plateau: Plateau; chosenPass: boolean; chosenFailed: string[]; seededPass: boolean; seededFailed: string[];
  };

  const tapeOf = (symbol: string, t: TapeId): Arm | null => {
    const s = series[symbol];
    if (t === "coinbase") return s.coinbase;
    if (t === "kraken") return s.kraken;
    return s.revx ? { c4h: s.revx, daily: resample(s.revx, 24), is4h: s.revx, isDaily: resample(s.revx, 24) } : null;
  };

  /**
   * The spans, resolved onto whichever tape is being priced. Defined ONCE on the
   * published arm and mapped by TIMESTAMP, never by bar index. `clip` is the
   * Revolut X coverage clip, applied to EVERY arm of a window that has one.
   */
  function spanOf(symbol: string, w: Win, clip: { from: number; to: number } | null) {
    const { coinbase, cb4h } = series[symbol];
    const comb = coinbase.c4h;
    const isArr = w.isSeries === "coinbase" ? cb4h : comb;
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    const oosFromTs = clip ? Math.max(comb[w.oosFrom].start, clip.from) : comb[w.oosFrom].start;
    const oosToTs = clip ? Math.min(endTs(comb, w.oosTo), clip.to) : endTs(comb, w.oosTo);
    return { isFromTs: isArr[w.isFrom].start, isToTs: endTs(isArr, w.isTo), oosFromTs, oosToTs };
  }

  /**
   * Choose in sample on one venue's costs, report the chosen point and the whole
   * grid out of sample. Copied from `backtest_windows.ts`'s `studyVenue`.
   *
   * ONE rule is added and it is declared here: the in-sample choice is always
   * made with fill = signal, on the arm's SIGNAL tape. It has to be — Revolut
   * X's tape is ~376 days deep and does not reach any window's in-sample — and
   * it is also right: the parameters a live row would carry were chosen from the
   * history it had, which is the signal venue's. The consequence is that the
   * chosen point is identical across every arm that shares a signal tape, so any
   * difference between those arms is the FILL and nothing else.
   */
  function studyVenue(
    venue: "revx" | "kraken",
    inSample: (p: TrendParams, c: Costs) => RunResult, outOfSample: (p: TrendParams, c: Costs) => RunResult,
    chosenIdx?: number,
  ): Cell & { bestIdx: number } {
    const own = COSTS[venue], oth = COSTS[other(venue)];
    let bestIdx = chosenIdx ?? 0, bestScore = -Infinity;
    if (chosenIdx == null) {
      for (let i = 0; i < TREND_GRID.length; i++) { const s = score(inSample(TREND_GRID[i], own)); if (s > bestScore) { bestScore = s; bestIdx = i; } }
    }
    const oosOwn = TREND_GRID.map((p) => outOfSample(p, own));
    const plateau = plateauOf(oosOwn.map((r) => r.ret), oosOwn[bestIdx].ret);
    const chosenOther = outOfSample(TREND_GRID[bestIdx], oth);
    const seededOther = outOfSample(TREND_GRID[SEEDED_IDX], oth);
    const chosen = barTests(oosOwn[bestIdx], chosenOther, plateau);
    const seeded = barTests(oosOwn[SEEDED_IDX], seededOther, plateau);
    return {
      bestIdx,
      chosen: { fast: TREND_GRID[bestIdx].fast, slow: TREND_GRID[bestIdx].slow, atrStop: TREND_GRID[bestIdx].atrStop },
      chosenOwn: pick(oosOwn[bestIdx]), chosenOther: pick(chosenOther),
      seededOwn: pick(oosOwn[SEEDED_IDX]), seededOther: pick(seededOther),
      plateau, chosenPass: chosen.pass, chosenFailed: chosen.failed, seededPass: seeded.pass, seededFailed: seeded.failed,
    };
  }

  // ── the whole per-coin study, once per (stop rule × arm) ────────────────
  type Tables = {
    trend: Record<string, Record<string, Record<string, Cell>>>;   // [symbol][window][venue]
    sleeve: Record<string, Record<string, SplitResult>>;           // [symbol][window] — seeded, revx costs
    fidelity: { checks: number; worstAbsRetDiff: number; worstAbsMaxDDDiff: number; worstAbsTradeDiff: number; worstAbsDaysDiff: number; worstAbsExposureDiff: number; worstAbsFeesDiff: number; curvePoints: number; worstAbsCurveDiff: number; curveLengthMismatches: number };
    align: { bars: number; exact: number; carried: number; refused: number; fillsOnCarried: number; decisionsRefused: number };
    armsLookedAt: number;
  };
  const emptyFidelity = () => ({ checks: 0, worstAbsRetDiff: 0, worstAbsMaxDDDiff: 0, worstAbsTradeDiff: 0, worstAbsDaysDiff: 0, worstAbsExposureDiff: 0, worstAbsFeesDiff: 0, curvePoints: 0, worstAbsCurveDiff: 0, curveLengthMismatches: 0 });

  /** The in-sample choice depends only on (symbol, window, venue, stop rule, SIGNAL tape) — so it is computed once. */
  const chosenCache = new Map<string, number>();

  function studyUnder(reg: Regime, arm: ArmDef, policy: "carry" | "skip" = "carry"): Tables {
    const st = reg.stops;
    const trend: Tables["trend"] = {}, sleeve: Tables["sleeve"] = {};
    let armsLookedAt = 0;
    const fid = emptyFidelity();
    const al = { bars: 0, exact: 0, carried: 0, refused: 0, fillsOnCarried: 0, decisionsRefused: 0 };
    for (const symbol of symbols) {
      const t0 = Date.now();
      const sArm = tapeOf(symbol, arm.signal), fArm = tapeOf(symbol, arm.fill);
      trend[symbol] = {}; sleeve[symbol] = {};
      if (!sArm || !fArm) continue;
      for (const w of series[symbol].wins) {
        if (!w.scored || !series[symbol].krakenCoverage[w.name].covered) continue;
        const cov = series[symbol].revxCoverage[w.name];
        // A window with a Revolut X clip is priced on the CLIPPED span on EVERY arm.
        const clip = cov.covered ? { from: cov.clipFromTs, to: cov.clipToTs } : null;
        if (arm.needsRx && !cov.covered) continue;
        const sp = spanOf(symbol, w, clip);
        const isArr = w.isSeries === "coinbase" ? sArm.is4h : sArm.c4h;
        const isDaily = w.isSeries === "coinbase" ? sArm.isDaily : sArm.daily;
        const isFrom = indexAtOrAfter(isArr, sp.isFromTs), isTo = indexAtOrAfter(isArr, sp.isToTs);
        const oosFrom = indexAtOrAfter(sArm.c4h, sp.oosFromTs), oosTo = indexAtOrAfter(sArm.c4h, sp.oosToTs);
        if (oosTo - oosFrom <= MAX_LOOKBACK + 2 || isTo - isFrom <= MAX_LOOKBACK + 2) continue;
        trend[symbol][w.name] = {};
        const isRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, isArr, isDaily, isFrom, isTo, p, c, 4, st(p));
        const oosRun = (p: TrendParams, c: Costs) =>
          runSplit("trend-4h", symbol, sArm.c4h, fArm.c4h, sArm.daily, oosFrom, oosTo, p, c, 4, st(p), policy);
        for (const v of VENUES) {
          const ck = `${symbol}|${w.name}|${v}|${reg.id}|${arm.signal}|${clip ? "clip" : "full"}`;
          const cached = chosenCache.get(ck);
          const cell = studyVenue(v, isRun, oosRun, cached);
          if (cached == null) chosenCache.set(ck, cell.bestIdx);
          else armsLookedAt -= 0;
          armsLookedAt += TREND_GRID.length + (cached == null ? TREND_GRID.length : 0);
          const { bestIdx: _drop, ...rest } = cell;
          trend[symbol][w.name][v] = rest;
          // `runSplit` must BE `run` when the fill series carries the same bars as the signal series —
          // checked TWICE. Once with the same array object, which takes the identity fast path; and once
          // with a CLONE, which does not, so `alignFill` and the whole split path are exercised and must
          // still land on `run` to the digit. The second is the one that proves the machinery.
          const a = run("trend-4h", symbol, sArm.c4h, sArm.daily, oosFrom, oosTo, DEFAULT_TREND, COSTS[v], 4, st(DEFAULT_TREND));
          const clone = sArm.c4h.map((c) => ({ ...c }));
          for (const b of [
            runSplit("trend-4h", symbol, sArm.c4h, sArm.c4h, sArm.daily, oosFrom, oosTo, DEFAULT_TREND, COSTS[v], 4, st(DEFAULT_TREND), policy),
            runSplit("trend-4h", symbol, sArm.c4h, clone, sArm.daily, oosFrom, oosTo, DEFAULT_TREND, COSTS[v], 4, st(DEFAULT_TREND), policy),
          ]) {
            fid.checks++;
            fid.worstAbsRetDiff = Math.max(fid.worstAbsRetDiff, Math.abs(a.ret - b.ret));
            fid.worstAbsMaxDDDiff = Math.max(fid.worstAbsMaxDDDiff, Math.abs(a.maxDD - b.maxDD));
            fid.worstAbsTradeDiff = Math.max(fid.worstAbsTradeDiff, Math.abs(a.trades - b.trades));
            fid.worstAbsDaysDiff = Math.max(fid.worstAbsDaysDiff, Math.abs(a.days - b.days));
            fid.worstAbsExposureDiff = Math.max(fid.worstAbsExposureDiff, Math.abs(a.exposure - b.exposure));
            fid.worstAbsFeesDiff = Math.max(fid.worstAbsFeesDiff, Math.abs(a.fees - b.fees));
            if (a.equity.length !== b.equitySampled.length) fid.curveLengthMismatches++;
            const n = Math.min(a.equity.length, b.equitySampled.length);
            for (let q = 0; q < n; q++) {
              fid.curvePoints++;
              fid.worstAbsCurveDiff = Math.max(fid.worstAbsCurveDiff, Math.abs(a.equity[q][1] - b.equitySampled[q][1]), Math.abs(a.equity[q][0] - b.equitySampled[q][0]));
            }
          }
          if (v === "revx") {
            const seeded = oosRun(DEFAULT_TREND, COSTS.revx);
            sleeve[symbol][w.name] = seeded;
            al.bars += seeded.align.bars; al.exact += seeded.align.exact; al.carried += seeded.align.carried;
            al.refused += seeded.align.refused; al.fillsOnCarried += seeded.align.fillsOnCarried; al.decisionsRefused += seeded.align.decisionsRefused;
          }
        }
      }
      const line = (n: string) => trend[symbol][n] ? `${n} ${(trend[symbol][n].revx.seededOwn.ret * 100).toFixed(1)}%${trend[symbol][n].revx.seededPass ? "*" : ""}` : `${n} —`;
      console.log(`[${reg.id}·${arm.id}] ${symbol.padEnd(9)} ${["C", "B", "A", "D"].map(line).join("  ")} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    return { trend, sleeve, armsLookedAt, fidelity: fid, align: al };
  }

  const tables: Record<string, Record<string, Tables>> = {};
  for (const reg of REGIMES) {
    tables[reg.id] = {};
    for (const arm of ARMS) {
      const t = Date.now();
      tables[reg.id][arm.id] = studyUnder(reg, arm);
      console.log(`[${reg.id}·${arm.id}] done in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    }
  }

  const report: Record<string, unknown> = {
    study: "the FILL — the loop decides on Kraken's candles (`signal_venue`) and fills on Revolut X's book (`venue`), and no table in this repository simulated that split. §3.16 measured what changes when the SIGNAL tape is swapped, but both of its arms still filled on their own tape. This prices the live candidate with the decision on one series and the fill on another, on Revolut X's OWN UK-book candles where they reach, and decomposes the error into the signal tape, the fill tape and their interaction.",
    source: "Three tapes. `coinbase`: Kraken's quarterly OHLCVT bundle spliced strictly BEFORE the Coinbase Exchange series' first bar, Coinbase's from there — what every published table used. `kraken`: Kraken's own 4-hour tape end to end (quarterly bundle plus the keyless public OHLC endpoint for 2026-07-01 →). `revx`: Revolut X's UK book, `GET /1.0/public/candles/{SYM}?interval=240&region=UK` — PUBLIC and KEYLESS, fetched from this harness on 2026-09-22; `region=UK` is not optional (§2.2 / §4.14: without it the endpoint serves the EEA book, which this account cannot trade). Fills, fees, the protective exits and the two-bar cooldown are backtest.ts's own; Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). The model is not in the backtest.",
    correctionsToTheReference: {
      note: "Two claims in `docs/agents/reference.md` are contradicted by measurement here, on the UK book, keyless, paging each interval to its wall on 2026-09-22. They are recorded because this study rests on them being wrong.",
      "§3.16": { claimed: "Revolut X's own tape needs a signed endpoint and is unreachable from a harness", measured: "the candles endpoint is public and keyless and was fetched from this harness; the signed call §6 probed is one way to reach it, not the only one", verdict: "false" },
      "§2.3": { claimed: "daily paginates back three years, and hourly is available for the same span", measured: { daily: "1,114 bars, 2023-08-19 → 2026-09-21 — three years, as claimed", fourHour: "2,257 bars, 2025-09-11 → 2026-09-22 — 376 days", hourly: "pages back to the same 2025-09-11 boundary" }, verdict: "the daily half is right; the intraday half is wrong — `backtest.ts`'s own header (\"Revolut X only serves one year of intraday history\") was correct all along" },
    },
    determinism: "No wall-clock or runtime field is written. Re-running over the same four data directories reproduces this file byte for byte; every null is computed exactly rather than sampled.",
    arms: ARMS.map((a) => ({ id: a.id, signal: a.signal, fill: a.fill, label: a.label })),
    parameterChoice: "The in-sample choice is always made with fill = signal, on the arm's SIGNAL tape, because Revolut X's tape is ~376 days deep and reaches no window's in-sample. The consequence is stated rather than hidden: the chosen point is identical across arms that share a signal tape, so every difference between those arms is the FILL and nothing else. The headline is the SEEDED point, which needs no choice at all.",
    coverage: {
      revxRule: `An arm whose fill tape is Revolut X prices a window only over the intersection of the window's out-of-sample span with that tape, and only when what is left is at least ${RX_MIN_DAYS} days AND at least ${(RX_MIN_SPAN_SHARE * 100).toFixed(0)} % of the window's out-of-sample days. When a window is clipped, the CLIPPED span is priced on EVERY arm — a comparison between two calendars is not a comparison — and the unclipped span is reported beside it.`,
      missingFillBarRule: `The decision is taken on the signal series' bar and the fill is priced on the fill series' bar with the same start timestamp. Where the fill series has no bar there, the headline policy is \`carry\`: a flat synthetic bar at the fill tape's most recent earlier close, provided it is no more than ${MAX_CARRY_MS / 3600e3} hours old — what an account actually sees, and conservative, because a flat bar has no high and no low for a stop to reach through. Beyond that the fill is REFUSED: no entry, no exit, no stop that bar, and the mark carries. Every carried bar, every refused bar, every FILL that landed on a carried bar and every decision a refusal dropped is counted, per arm, and \`f1_fidelity.missingBarPolicy\` prices the alternative (\`skip\`, no carry at all) on the live candidate.`,
    },
    windows: {
      note: "The window boundaries are defined ONCE, on the published arm — each coin's own Coinbase series cut in thirds, exactly as §3.7 / §3.8 / §3.10 / §3.11 / §3.15 / §3.16 cut it — and mapped onto the other tapes by TIMESTAMP, never by bar index.",
      A: "parameters on the first two thirds, the LAST third out of sample",
      B: "parameters on the first third, the MIDDLE third out of sample",
      C: "parameters on the 24 months of extended history before the series starts, the FIRST third out of sample",
      D: "parameters on the 24 months before that, the 12 months before the series out of sample",
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
    },
    stopRules: {
      note: "EVERY figure in this file is reported twice, under `shipped` and `trail`, and is never averaged between them.",
      shipped: { stops: stopsForKind("trend-4h", DEFAULT_TREND), constant: { ...SHIPPED_STOPS }, what: "what backtest.ts ships at the moment of this run, and what tick.ts runs — the live decision is about this one" },
      trail: { stops: { ...PINNED_STOPS }, what: "the 8 % floor plus the 3×ATR(14) intra-bar trail — what the published tables were computed under" },
    },
    bar: "reference §3.7 / §4.15 / §4.16: positive out of sample on the venue the row would run on, max drawdown < 35 %, at least half the grid positive out of sample on that venue, positive on the other venue's costs — and a book on the running venue of at least $100k a day.",
    costs: COSTS,
    ukBookUsdPerDay: UK_BOOK_USD_PER_DAY,
    krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY,
    minBookUsd: MIN_BOOK_USD,
    caps: { maxOrderUsd: MAX_ORDER_USD, liveCandidate: LIVE_CANDIDATE },
    grids: { "trend-4h": { points: TREND_GRID.length, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [2, 3, 4], seeded: { fast: DEFAULT_TREND.fast, slow: DEFAULT_TREND.slow, atrStop: DEFAULT_TREND.atrStop } } },
    data: {
      symbolsPriced: priced.length, symbolsWithRevxTape: [...haveR].sort(), perSymbol: provenance,
      revxTapeSummary: {
        note: "The Revolut X UK 4-hour tape as fetched. `gapBars` are bars the venue's own series does not have inside its span; they are NOT smoothed over — they go through the carry rule and every fill that lands on one is counted in `f3_decomposition.basisAtEveryFill.all.onCarriedBars`.",
        coinsWithTape: [...haveR].length,
        coinsWithGaps: Object.fromEntries(provenance
          .filter((p) => ((p.revxTape as { gapBars?: number } | null)?.gapBars ?? 0) > 0)
          .map((p) => [p.symbol as string, (p.revxTape as { gapBars: number }).gapBars])),
        shortfallAgainstWindowA: "The tape starts 2025-09-11 and window A's out-of-sample begins 2025-09-10 on BTC/ETH/SOL — a one-day miss on a 375-day window. It is handled by the clip rule, not ignored: the window is priced on the intersection, the SAME clipped span is used on every arm so the comparison stays like-for-like, and `f2_threeArms.clipCost` runs the published arm over both spans so what the clip costs is a measured number. AVAX and SUI need no clip at all — their window A begins 2025-09-21.",
      },
    },
  };

  // ── F1: fidelity ────────────────────────────────────────────────────────
  const fid: Record<string, unknown> = {
    runSplit: {
      note: "`runSplit` (the one copy of `run` in this file) against `backtest.ts`'s `run`, with the fill series carrying the same bars as the signal series, seeded parameters, every accepted coin × every priced window × both venues × both stop rules × every arm. Run TWICE per cell: once with the same array object, which takes the identity fast path, and once with a CLONE of it, which does not — so `alignFill` and the entire split path are exercised and must still reproduce `run` to the digit. Compared: return, drawdown, trade count, days, exposure, fees — and `run`'s own every-sixth-bar equity curve, point for point, timestamp and value. A non-zero anywhere would mean the copy is not the original and nothing below could be read.",
      perArm: Object.fromEntries(REGIMES.flatMap((reg) => ARMS.map((a) => [`${reg.id}·${a.id}`, tables[reg.id][a.id].fidelity]))),
      checks: REGIMES.reduce((x, reg) => x + ARMS.reduce((y, a) => y + tables[reg.id][a.id].fidelity.checks, 0), 0),
      curvePoints: REGIMES.reduce((x, reg) => x + ARMS.reduce((y, a) => y + tables[reg.id][a.id].fidelity.curvePoints, 0), 0),
      worstAbsRetDiff: Math.max(...REGIMES.flatMap((reg) => ARMS.map((a) => tables[reg.id][a.id].fidelity.worstAbsRetDiff))),
      worstAbsMaxDDDiff: Math.max(...REGIMES.flatMap((reg) => ARMS.map((a) => tables[reg.id][a.id].fidelity.worstAbsMaxDDDiff))),
      worstAbsTradeDiff: Math.max(...REGIMES.flatMap((reg) => ARMS.map((a) => tables[reg.id][a.id].fidelity.worstAbsTradeDiff))),
      worstAbsDaysDiff: Math.max(...REGIMES.flatMap((reg) => ARMS.map((a) => tables[reg.id][a.id].fidelity.worstAbsDaysDiff))),
      worstAbsExposureDiff: Math.max(...REGIMES.flatMap((reg) => ARMS.map((a) => tables[reg.id][a.id].fidelity.worstAbsExposureDiff))),
      worstAbsFeesDiff: Math.max(...REGIMES.flatMap((reg) => ARMS.map((a) => tables[reg.id][a.id].fidelity.worstAbsFeesDiff))),
      worstAbsCurveDiff: Math.max(...REGIMES.flatMap((reg) => ARMS.map((a) => tables[reg.id][a.id].fidelity.worstAbsCurveDiff))),
      curveLengthMismatches: REGIMES.reduce((x, reg) => x + ARMS.reduce((y, a) => y + tables[reg.id][a.id].fidelity.curveLengthMismatches, 0), 0),
    },
    alignment: {
      note: "How the fill tape lined up with the signal tape, summed over every seeded Revolut X-costs run in each arm. `refused` bars are bars on which no fill could be priced at all; `decisionsRefused` is the number of those bars on which the rulebook actually wanted to trade — the only count that changes a result.",
      perArm: Object.fromEntries(REGIMES.flatMap((reg) => ARMS.map((a) => [`${reg.id}·${a.id}`, tables[reg.id][a.id].align]))),
    },
  };

  // Does this harness reproduce `tape.json`, cell for cell, on the two arms it shares with it?
  if (tapePath) {
    const tj = JSON.parse(await Deno.readTextFile(tapePath)) as Record<string, any>;
    const hash = await sha(tapePath);
    const per: Record<string, unknown> = {};
    const MAP: Record<string, string> = { b_cb_cb: "coinbase", a_kr_kr: "kraken" };
    for (const reg of REGIMES) {
      const rows: { symbol: string; window: string; venue: string; arm: string; field: string; published: number; here: number; delta: number }[] = [];
      let cells = 0;
      for (const [armId, tapeArm] of Object.entries(MAP)) {
        for (const s of symbols) {
          const here = tables[reg.id][armId].trend[s];
          if (!here) continue;
          for (const wname of Object.keys(here)) {
            // A window this study clipped for Revolut X coverage is a different span from tape.json's; skip it here and
            // report the clip's own cost separately.
            if (series[s].revxCoverage[wname]?.covered && series[s].revxCoverage[wname].share < 1) continue;
            const pub = tj.t3_theBar?.perCoinVerdicts?.[reg.id]?.[s]?.[wname];
            if (!pub) continue;
            for (const v of VENUES) {
              const p = pub?.[v]?.[tapeArm], h = here[wname][v];
              if (!p || !h) continue;
              for (const f of ["chosenOwn", "seededOwn"] as const) {
                for (const k of ["ret", "maxDD"] as const) {
                  cells++;
                  const d = h[f][k] - p[f][k];
                  if (Math.abs(d) > 1e-9) rows.push({ symbol: s, window: wname, venue: v, arm: armId, field: `${f}.${k}`, published: p[f][k], here: h[f][k], delta: r4(d) });
                }
                cells++;
                if (h[f].trades !== p[f].trades) rows.push({ symbol: s, window: wname, venue: v, arm: armId, field: `${f}.trades`, published: p[f].trades, here: h[f].trades, delta: h[f].trades - p[f].trades });
              }
              cells++;
              if (`${h.chosen.fast}/${h.chosen.slow}/${h.chosen.atrStop}` !== `${p.chosen.fast}/${p.chosen.slow}/${p.chosen.atrStop}`) {
                rows.push({ symbol: s, window: wname, venue: v, arm: armId, field: "chosen", published: 0, here: 0, delta: 1 });
              }
            }
          }
        }
      }
      per[reg.id] = {
        cellsCompared: cells, cellsThatDiffer: rows.length,
        worstAbsDelta: rows.length ? Math.max(...rows.map((r) => Math.abs(r.delta))) : 0,
        differences: rows.slice(0, 60),
      };
      console.log(`[${reg.id}] tape.json cross-check: ${cells} cells, ${rows.length} differ`);
    }
    fid.publishedTape = {
      note: "This study's arms (a) and (b) against `docs/agents/backtests/tape.json`'s `kraken` and `coinbase` arms, cell for cell — chosen parameters, and the return, drawdown and trade count of the chosen and seeded points, own venue and other venue, every coin × window × venue × stop rule. tape.json's `coinbase` arm was itself checked against `windows.json` at 4,464 cells, zero differing, so a zero here chains this study to §3.15 and §3.16. Windows this study CLIPPED for Revolut X coverage are excluded from the comparison, because a clipped span is a different span; their cost is reported in `f2_threeArms.clipCost`.",
      file: tapePath, sha256: hash, perStopRule: per,
    };
  }
  report.f1_fidelity = fid;

  // ── F2: the three arms, side by side ────────────────────────────────────
  const SLOT = Math.min(LIVE_CANDIDATE.capitalUsd / LIVE_CANDIDATE.slots, MAX_ORDER_USD);
  function sleeveBlock(reg: Regime, armId: string, wname: string) {
    const T = tables[reg.id][armId];
    if (!T) return null;
    const members = LIVE_CANDIDATE.symbols.filter((s) => T.sleeve[s]?.[wname]);
    if (!members.length) return null;
    const sleeves: Sleeve[] = members.map((s) => {
      const r = T.sleeve[s][wname];
      return {
        id: `trend-4h·revx·${s.split("/")[0]}`, symbol: s, slotUsd: SLOT, rets: dailyReturns(r.marks),
        ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * SLOT,
      };
    });
    const whole = combine(sleeves);
    const perCoin = members.map((s) => {
      const r = T.sleeve[s][wname], cell = T.trend[s][wname].revx;
      const years = Math.max(1e-9, r.days / 365);
      return {
        symbol: s, ret: r4(r.ret), maxDD: r4(r.maxDD), retOverDD: r2(score(r)),
        trades: r.trades, stopsHit: r.stopsHit ?? 0, deployment: r3(r.exposure),
        turnoverPerYear: r2(r.tradedWeight / years), days: Math.round(r.days),
        chosenParamsRet: cell.chosenOwn.ret, plateau: cell.plateau.positiveShare,
        clearsBarSeeded: cell.seededPass && (UK_BOOK_USD_PER_DAY[s] ?? 0) >= MIN_BOOK_USD,
        clearsBarChosen: cell.chosenPass && (UK_BOOK_USD_PER_DAY[s] ?? 0) >= MIN_BOOK_USD,
        fillsOnCarriedBars: r.align.fillsOnCarried, decisionsRefused: r.align.decisionsRefused,
      };
    }).sort((a, b) => b.ret - a.ret);
    const leaveOneCoinOut = (members.length < 2 ? [] : members).map((sym) => {
      const keep = sleeves.filter((s) => s.symbol !== sym);
      const slot = whole.capitalUsd / keep.length;
      const without = combine(keep.map((s) => ({ ...s, slotUsd: slot, tradedUsd: s.tradedUsd / SLOT * slot })));
      return {
        symbol: sym, ownRet: r4(sleeves.find((s) => s.symbol === sym)!.ret),
        rowRetWithout: without.ret, rowMaxDDWithout: without.maxDD, rowRetOverDDWithout: without.retOverDD,
        deltaRetOverDD: r2(without.retOverDD - whole.retOverDD),
      };
    }).sort((a, b) => b.deltaRetOverDD - a.deltaRetOverDD);
    return { members: members.length, memberSymbols: members, sleeve: whole, perCoin, leaveOneCoinOut, sleevesRaw: sleeves };
  }

  const WNAMES = ["A", "B", "C", "D"] as const;
  const f2: Record<string, unknown> = {
    note: `${LIVE_CANDIDATE.row} · ${LIVE_CANDIDATE.venue} · ${LIVE_CANDIDATE.symbols.join(", ")} · $${LIVE_CANDIDATE.capitalUsd} · ${LIVE_CANDIDATE.slots} equal $${SLOT} slots · seeded parameters (fast ${DEFAULT_TREND.fast} / slow ${DEFAULT_TREND.slow} / ATR ${DEFAULT_TREND.atrStop}) · Revolut X costs. Arm (c) is the loop: decide on Kraken, fill on Revolut X's UK book. Where Revolut X's tape does not reach — windows B, C and D — arm (c) has no entry and the proxy \`p_kr_cb\` is what is available; it is labelled, never substituted silently.`,
    perStopRule: {} as Record<string, unknown>,
  };
  for (const reg of REGIMES) {
    const per: Record<string, unknown> = {};
    for (const wname of WNAMES) {
      const blocks: Record<string, ReturnType<typeof sleeveBlock>> = {};
      for (const a of ARMS) blocks[a.id] = sleeveBlock(reg, a.id, wname);
      const b = blocks.b_cb_cb, a = blocks.a_kr_kr, c = blocks.c_kr_rx, prox = blocks.p_kr_cb;
      if (!b || !a) { per[wname] = { scored: false, why: "no member has this window on both reference arms" }; continue; }
      const anySym = LIVE_CANDIDATE.symbols.find((s) => tables[reg.id].b_cb_cb.sleeve[s]?.[wname])!;
      const cov = series[anySym].revxCoverage[wname];
      per[wname] = {
        scored: true,
        window: series[anySym].wins.find((x) => x.name === wname),
        revxCoverage: cov,
        arms: Object.fromEntries(ARMS.filter((x) => blocks[x.id]).map((x) => [x.id, { label: x.label, signal: x.signal, fill: x.fill, sleeve: blocks[x.id]!.sleeve, perCoin: blocks[x.id]!.perCoin, leaveOneCoinOut: blocks[x.id]!.leaveOneCoinOut }])),
        headline: {
          b_published: b.sleeve, a_kraken: a.sleeve,
          c_loop: c ? c.sleeve : null,
          c_proxy_when_no_revx_tape: c ? null : (prox ? prox.sleeve : null),
          cMinusB: c ? { ret: r4(c.sleeve.ret - b.sleeve.ret), maxDD: r4(c.sleeve.maxDD - b.sleeve.maxDD), retOverDD: r2(c.sleeve.retOverDD - b.sleeve.retOverDD), pnlUsd: r2(c.sleeve.pnlUsd - b.sleeve.pnlUsd), signFlip: (c.sleeve.ret > 0) !== (b.sleeve.ret > 0) } : null,
          cMinusA: c ? { ret: r4(c.sleeve.ret - a.sleeve.ret), maxDD: r4(c.sleeve.maxDD - a.sleeve.maxDD), retOverDD: r2(c.sleeve.retOverDD - a.sleeve.retOverDD), pnlUsd: r2(c.sleeve.pnlUsd - a.sleeve.pnlUsd), signFlip: (c.sleeve.ret > 0) !== (a.sleeve.ret > 0) } : null,
          aMinusB: { ret: r4(a.sleeve.ret - b.sleeve.ret), maxDD: r4(a.sleeve.maxDD - b.sleeve.maxDD), retOverDD: r2(a.sleeve.retOverDD - b.sleeve.retOverDD), pnlUsd: r2(a.sleeve.pnlUsd - b.sleeve.pnlUsd) },
          proxyMinusC: c && prox ? { ret: r4(prox.sleeve.ret - c.sleeve.ret), retOverDD: r2(prox.sleeve.retOverDD - c.sleeve.retOverDD), note: "how far the best available proxy is from the real thing, where both exist — the number that says how much windows B, C and D's proxy can be trusted" } : null,
        },
        perCoinAcrossArms: Object.fromEntries(LIVE_CANDIDATE.symbols.map((s) => [s, Object.fromEntries(ARMS.filter((x) => blocks[x.id]?.perCoin.some((pc) => pc.symbol === s)).map((x) => [x.id, blocks[x.id]!.perCoin.find((pc) => pc.symbol === s)!.ret]))])),
      };
      const fmt = (x: ReturnType<typeof sleeveBlock>) => x ? `${(x.sleeve.ret * 100).toFixed(1)}%/${x.sleeve.retOverDD}` : "—";
      console.log(`[${reg.id}] F2 ${wname}: b ${fmt(b)} | a ${fmt(a)} | c ${fmt(c)} | proxy ${fmt(prox)}`);
    }
    (f2.perStopRule as Record<string, unknown>)[reg.id] = per;
  }
  // ── the proxy, calibrated against the truth on the one window that has both ──
  // Windows B, C and D have no real Revolut X tape, so arm (c) there is a proxy.
  // Window A has BOTH, which makes it the only place the proxy's error is a
  // measurement rather than an assumption. Every proxy is run on window A beside
  // the real-tape arm and its error is reported — sleeve and per coin.
  {
    const PROXIES = [
      { id: "p_kr_cb", label: "signal Kraken + fill Coinbase — a real third venue's tape on the fill side, at Revolut X's fee and half-spread" },
      { id: "a_kr_kr", label: "signal Kraken + fill Kraken — the zero-basis proxy: assume Revolut X's price IS the signal venue's, and charge only Revolut X's fee and half-spread (this is §3.16's Kraken arm)" },
    ];
    const per: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const byWindow: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        const truth = sleeveBlock(reg, "c_kr_rx", wname);
        if (!truth) continue;                       // only windows the real tape can price
        const rows: Record<string, unknown>[] = [];
        for (const px of PROXIES) {
          const p = sleeveBlock(reg, px.id, wname);
          if (!p) continue;
          const perCoin = truth.perCoin.map((tc) => {
            const pc = p.perCoin.find((x) => x.symbol === tc.symbol);
            return pc ? { symbol: tc.symbol, truth: tc.ret, proxy: pc.ret, error: r4(pc.ret - tc.ret), signFlip: (pc.ret > 0) !== (tc.ret > 0), dTrades: pc.trades - tc.trades } : null;
          }).filter((x): x is NonNullable<typeof x> => x != null);
          const errs = perCoin.map((x) => Math.abs(x.error));
          rows.push({
            proxy: px.id, label: px.label,
            sleeve: { truth: truth.sleeve.ret, proxy: p.sleeve.ret, error: r4(p.sleeve.ret - truth.sleeve.ret), retOverDDError: r2(p.sleeve.retOverDD - truth.sleeve.retOverDD), pnlUsdError: r2(p.sleeve.pnlUsd - truth.sleeve.pnlUsd) },
            perCoin,
            perCoinAbsError: errs.length ? { median: r4(median(errs)), max: r4(Math.max(...errs)) } : null,
            signFlips: perCoin.filter((x) => x.signFlip).length,
            leaveOneOutRankAgrees: JSON.stringify(p.leaveOneCoinOut.map((x) => x.symbol)) === JSON.stringify(truth.leaveOneCoinOut.map((x) => x.symbol)),
          });
        }
        // The same thing over EVERY coin, not just the sleeve's five.
        const wide: Record<string, unknown> = {};
        for (const px of PROXIES) {
          const errs: number[] = [];
          let flips = 0, n = 0;
          for (const s of symbols) {
            const t = tables[reg.id].c_kr_rx?.sleeve?.[s]?.[wname], q = tables[reg.id][px.id]?.sleeve?.[s]?.[wname];
            if (!t || !q) continue;
            n++; errs.push(Math.abs(q.ret - t.ret));
            if ((q.ret > 0) !== (t.ret > 0)) flips++;
          }
          wide[px.id] = n ? { coins: n, absErrorMedian: r4(median(errs)), absErrorP95: r4(quantile(errs, 0.95)), absErrorMax: r4(Math.max(...errs)), signFlips: flips } : null;
        }
        byWindow[wname] = { liveCandidate: rows, everyCoin: wide };
      }
      per[reg.id] = byWindow;
    }
    (f2 as Record<string, unknown>).proxyCalibration = {
      note: "Windows B, C and D have no real Revolut X tape and arm (c) there is a proxy. Window A has both, so this is the proxy's error MEASURED rather than assumed — and it is the number that says how far B, C and D's proxy figures can be trusted. Two proxies are priced: fill on Coinbase (a real independent venue's tape) and fill on Kraken (the zero-basis assumption, which is §3.16's Kraken arm). A proxy whose error on window A is small next to the differences it is being used to detect is usable there; one whose error is the size of the effect is not, and the report says which.",
      perStopRule: per,
    };
  }

  // What the Revolut X clip costs, measured on the arms that can see both spans.
  {
    const rows: Record<string, unknown>[] = [];
    for (const reg of REGIMES) {
      for (const s of symbols) {
        for (const wname of WNAMES) {
          const cov = series[s].revxCoverage[wname];
          if (!cov.covered || cov.share >= 1) continue;
          const w = series[s].wins.find((x) => x.name === wname)!;
          const sArm = tapeOf(s, "coinbase")!;
          const spFull = spanOf(s, w, null), spClip = spanOf(s, w, { from: cov.clipFromTs, to: cov.clipToTs });
          const idx = (sp: { oosFromTs: number; oosToTs: number }) => [indexAtOrAfter(sArm.c4h, sp.oosFromTs), indexAtOrAfter(sArm.c4h, sp.oosToTs)] as const;
          const [f1, t1] = idx(spFull), [f2i, t2i] = idx(spClip);
          const full = run("trend-4h", s, sArm.c4h, sArm.daily, f1, t1, DEFAULT_TREND, COSTS.revx, 4, reg.stops(DEFAULT_TREND));
          const clip = run("trend-4h", s, sArm.c4h, sArm.daily, f2i, t2i, DEFAULT_TREND, COSTS.revx, 4, reg.stops(DEFAULT_TREND));
          rows.push({ stopRule: reg.id, symbol: s, window: wname, clipDays: cov.clipDays, share: cov.share, fullSpan: pick(full), clippedSpan: pick(clip), dRet: r4(clip.ret - full.ret), dTrades: clip.trades - full.trades });
        }
      }
    }
    (f2 as Record<string, unknown>).clipCost = {
      note: "Every window this study clipped so the Revolut X tape could price it, run on the PUBLISHED arm over the full span and over the clipped span. The difference is what the clip costs and is the reason it can be quoted as small rather than assumed to be.",
      rows, worstAbsDRet: rows.length ? r4(Math.max(...rows.map((r) => Math.abs(r.dRet as number)))) : 0,
      medianAbsDRet: rows.length ? r4(median(rows.map((r) => Math.abs(r.dRet as number)))) : 0,
    };
  }
  report.f2_threeArms = f2;

  // ── F3: decompose the error, and price the basis at every fill ──────────
  /** The 2 × 2: signal ∈ {coinbase, kraken} × fill ∈ {coinbase, revx}. */
  function decompose(reg: Regime, wname: string, getter: (armId: string) => number | null) {
    const bb = getter("b_cb_cb"), kb = getter("p_kr_cb"), br = getter("q_cb_rx"), kr = getter("c_kr_rx");
    if (bb == null || kb == null || br == null || kr == null) return null;
    return {
      cells: { cb_cb: r4(bb), kr_cb: r4(kb), cb_rx: r4(br), kr_rx: r4(kr) },
      total_cMinusB: r4(kr - bb),
      signalEffect: r4(((kb - bb) + (kr - br)) / 2),
      fillEffect: r4(((br - bb) + (kr - kb)) / 2),
      interaction: r4(kr - kb - br + bb),
      checkSum: r4(((kb - bb) + (kr - br)) / 2 + ((br - bb) + (kr - kb)) / 2 + (kr - kb - br + bb) - (kr - bb)),
    };
  }
  const f3: Record<string, unknown> = {
    note: "The gap between (c) and (b) split into the signal tape, the fill tape and their interaction, on the 2 × 2 of signal ∈ {Coinbase, Kraken} × fill ∈ {Coinbase, Revolut X UK}. Main effects are the average of the two orderings; the interaction is the second difference. The three sum to (c) − (b) exactly, and `checkSum` is that identity evaluated — it is 0 by construction and is printed so the reader does not have to take it on trust.",
    perStopRule: {} as Record<string, unknown>,
  };
  for (const reg of REGIMES) {
    const per: Record<string, unknown> = {};
    for (const wname of WNAMES) {
      const sleeveRet = (armId: string) => { const b = sleeveBlock(reg, armId, wname); return b ? b.sleeve.ret : null; };
      const sleeveRoDD = (armId: string) => { const b = sleeveBlock(reg, armId, wname); return b ? b.sleeve.retOverDD : null; };
      const d = decompose(reg, wname, sleeveRet);
      if (!d) { per[wname] = { scored: false, why: "the 2 × 2 is not complete on this window — Revolut X's tape does not reach it" }; continue; }
      per[wname] = {
        scored: true,
        sleeveReturn: d,
        sleeveRetOverDD: decompose(reg, wname, sleeveRoDD),
        perCoin: Object.fromEntries(LIVE_CANDIDATE.symbols.map((s) => [s, decompose(reg, wname, (armId) => {
          const r = tables[reg.id][armId]?.sleeve?.[s]?.[wname];
          return r ? r.ret : null;
        })]).filter(([, v]) => v != null)),
        perCoinAllSymbols: Object.fromEntries(symbols.map((s) => [s, decompose(reg, wname, (armId) => {
          const r = tables[reg.id][armId]?.sleeve?.[s]?.[wname];
          return r ? r.ret : null;
        })]).filter(([, v]) => v != null)),
      };
    }
    (f3.perStopRule as Record<string, unknown>)[reg.id] = per;
  }

  // The basis AT EVERY FILL — the number this repository has never had.
  {
    const all: FillRecord[] = [];
    const perSymbol: Record<string, FillRecord[]> = {};
    for (const reg of REGIMES) {
      for (const s of symbols) {
        for (const wname of WNAMES) {
          const r = tables[reg.id].c_kr_rx?.sleeve?.[s]?.[wname];
          if (!r) continue;
          // One stop rule only, so a fill is not counted twice: `shipped` is what the loop runs.
          if (reg.id !== "shipped") continue;
          for (const f of r.fills) { all.push(f); (perSymbol[s] ??= []).push(f); }
        }
      }
    }
    const distOf = (rows: FillRecord[]) => {
      if (!rows.length) return null;
      const basis = rows.map((f) => f.basisBps), abs = basis.map(Math.abs), adv = rows.map((f) => f.adverseBps);
      const pos = adv.filter((x) => x > 0).length, neg = adv.filter((x) => x < 0).length;
      return {
        fills: rows.length,
        buys: rows.filter((f) => f.side === "buy").length, sells: rows.filter((f) => f.side === "sell").length,
        stops: rows.filter((f) => f.reason === "stop").length,
        onCarriedBars: rows.filter((f) => f.carried).length,
        absBasisBps: { median: r3(median(abs)), p95: r3(quantile(abs, 0.95)), max: r3(Math.max(...abs)) },
        signedBasisBps: { median: r3(median(basis)), mean: r3(mean(basis)), p05: r3(quantile(basis, 0.05)), p95: r3(quantile(basis, 0.95)) },
        adverseBps: { median: r3(median(adv)), mean: r3(mean(adv)), p95: r3(quantile(adv, 0.95)), max: r3(Math.max(...adv)), min: r3(Math.min(...adv)) },
        adverseFills: pos, favourableFills: neg, neutral: rows.length - pos - neg,
        signTest: signTest(pos, neg),
        meanAdverseCostPerRoundTripBps: r3(mean(adv) * 2),
      };
    };
    const takerBps = COSTS.revx.takerBps;
    report.f3_decomposition = {
      ...f3,
      basisAtEveryFill: {
        note: "Every fill the live arm (c) made — entry, rule exit and protective stop — with the two venues' own prices at that timestamp. `basisBps` is (Revolut X's bar open / Kraken's bar open − 1) × 1e4. `adverseBps` is that basis signed AGAINST the trade: positive means Revolut X was the worse place to do this trade than the signal tape implied, which is a COST the published backtests do not charge. One stop rule only (`shipped`, what tick.ts runs), so no fill is counted twice.",
        comparators: {
          revxTakerBps: takerBps,
          revxHalfSpreadBps: Object.fromEntries(Object.entries(COSTS.revx.halfSpread).map(([k, v]) => [k, Number((v * 1e4).toFixed(3))])),
          roundTripTakerPlusSpreadBps: Object.fromEntries(LIVE_CANDIDATE.symbols.map((s) => [s, Number((2 * (takerBps + spreadOf(COSTS.revx, s) * 1e4)).toFixed(3))])),
          reference2c: "§2c measured |basis| at the touch at p50 0.36–0.94 bps and max 1.83–3.11 bps on BTC/ETH/SOL/XRP over 149 samples in ten minutes, and at 5-minute closes over 60 h p95 6–16 bps, p99 10–28, max 18–49. This block is the same quantity over three years of real fills rather than one Sunday.",
        },
        all: distOf(all),
        perSymbol: Object.fromEntries(Object.entries(perSymbol).map(([s, rows]) => [s, distOf(rows)])),
        byReason: Object.fromEntries((["entry", "exit", "stop"] as const).map((k) => [k, distOf(all.filter((f) => f.reason === k))])),
        bySide: Object.fromEntries((["buy", "sell"] as const).map((k) => [k, distOf(all.filter((f) => f.side === k))])),
        liveCandidateFills: Object.fromEntries(LIVE_CANDIDATE.symbols.filter((s) => perSymbol[s]).map((s) => [s, perSymbol[s].map((f) => ({
          ts: iso(f.ts), side: f.side, reason: f.reason, price: Number(f.price.toFixed(6)),
          revx: Number(f.fillRef.toFixed(6)), kraken: Number(f.signalRef.toFixed(6)),
          basisBps: r3(f.basisBps), adverseBps: r3(f.adverseBps), carried: f.carried,
        }))])),
      },
    };
  }

  // ── F4: does it change any decision? ────────────────────────────────────
  function membership(reg: Regime, armId: string, v: "revx" | "kraken", how: "chosen" | "seeded") {
    const T = tables[reg.id][armId]?.trend ?? {};
    const out: Record<string, string[]> = {};
    for (const s of Object.keys(T)) {
      for (const w of Object.keys(T[s])) {
        const cell = T[s][w];
        const book = v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0);
        const pass = (how === "chosen" ? cell[v].chosenPass : cell[v].seededPass) && book >= MIN_BOOK_USD;
        if (pass) (out[w] ??= []).push(s);
      }
    }
    for (const w of Object.keys(out)) out[w].sort();
    return out;
  }

  const f4: Record<string, unknown> = {
    note: "Three decisions re-run in arm (c) — §4.15's bar per coin per window, the five-coin leave-one-out, and where the recommendation ranks. A verdict that moves is named with the number that moved it.",
    perStopRule: {} as Record<string, unknown>,
  };
  for (const reg of REGIMES) {
    const arms: Record<string, unknown> = {};
    for (const v of VENUES) {
      for (const how of ["seeded", "chosen"] as const) {
        const mb = membership(reg, "b_cb_cb", v, how), ma = membership(reg, "a_kr_kr", v, how), mc = membership(reg, "c_kr_rx", v, how);
        const wlist = [...new Set([...Object.keys(mb), ...Object.keys(ma), ...Object.keys(mc)])].sort();
        const flips: Record<string, unknown>[] = [];
        for (const w of wlist) {
          const allCoins = [...new Set([...(mb[w] ?? []), ...(ma[w] ?? []), ...(mc[w] ?? [])])];
          const pool = symbols.filter((s) => tables[reg.id].c_kr_rx?.trend?.[s]?.[w]);
          for (const s of new Set([...allCoins, ...pool])) {
            const inB = (mb[w] ?? []).includes(s), inC = (mc[w] ?? []).includes(s), inA = (ma[w] ?? []).includes(s);
            const cellB = tables[reg.id].b_cb_cb.trend[s]?.[w], cellC = tables[reg.id].c_kr_rx?.trend?.[s]?.[w];
            if (!cellB || !cellC) continue;
            if (inB !== inC) {
              flips.push({
                symbol: s, window: w, publishedPasses: inB, loopPasses: inC, krakenArmPasses: inA,
                publishedRet: how === "chosen" ? cellB[v].chosenOwn.ret : cellB[v].seededOwn.ret,
                loopRet: how === "chosen" ? cellC[v].chosenOwn.ret : cellC[v].seededOwn.ret,
                dRet: r4((how === "chosen" ? cellC[v].chosenOwn.ret : cellC[v].seededOwn.ret) - (how === "chosen" ? cellB[v].chosenOwn.ret : cellB[v].seededOwn.ret)),
                publishedFailed: how === "chosen" ? cellB[v].chosenFailed : cellB[v].seededFailed,
                loopFailed: how === "chosen" ? cellC[v].chosenFailed : cellC[v].seededFailed,
              });
            }
          }
        }
        const scoredCells = wlist.reduce((acc, w) => acc + symbols.filter((s) => tables[reg.id].c_kr_rx?.trend?.[s]?.[w] && tables[reg.id].b_cb_cb.trend[s]?.[w]).length, 0);
        arms[`${v}·${how}`] = {
          published_b: mb, kraken_a: ma, loop_c: mc,
          coinWindowsComparable: scoredCells,
          barVerdictFlips: flips.length,
          barVerdictFlipRate: r3(flips.length / Math.max(1, scoredCells)),
          flips,
        };
      }
    }
    (f4.perStopRule as Record<string, unknown>)[reg.id] = arms;
  }

  // The weighting question (§3.11 point 1) and the row-plan ranking (§3.11 point 2), re-run in arm (c).
  {
    type Plan = { id: string; label: string; weights: (sl: Sleeve[], isStats: Record<string, { ret: number; vol: number }>) => number[] };
    const vol = (s: Sleeve) => {
      const xs = [...s.rets.values()];
      if (xs.length < 5) return 1;
      const m = mean(xs);
      return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1)) || 1;
    };
    const PLANS: Plan[] = [
      { id: "equalSlots", label: "five equal $20 slots — what §3.11 recommends", weights: (sl) => sl.map(() => 1 / sl.length) },
      { id: "inverseVolatility", label: "weight ∝ 1 / the coin's in-sample daily volatility", weights: (sl, is) => { const w = sl.map((s) => 1 / Math.max(1e-9, is[s.symbol]?.vol ?? 1)); const t = w.reduce((a, b) => a + b, 0); return w.map((x) => x / t); } },
      { id: "evidenceByReturn", label: "weight ∝ the coin's own IN-SAMPLE return, floored at zero (§3.11's 'evidence' arm)", weights: (sl, is) => { const w = sl.map((s) => Math.max(0, is[s.symbol]?.ret ?? 0)); const t = w.reduce((a, b) => a + b, 0); return t > 0 ? w.map((x) => x / t) : sl.map(() => 1 / sl.length); } },
      { id: "concentrateBest", label: "everything on the single best coin in sample", weights: (sl, is) => { let bi = 0; for (let i = 1; i < sl.length; i++) if ((is[sl[i].symbol]?.ret ?? -Infinity) > (is[sl[bi].symbol]?.ret ?? -Infinity)) bi = i; return sl.map((_, i) => i === bi ? 1 : 0); } },
    ];
    const per: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const byWindow: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        const armOut: Record<string, unknown> = {};
        for (const armId of ["b_cb_cb", "a_kr_kr", "c_kr_rx", "p_kr_cb"]) {
          const blk = sleeveBlock(reg, armId, wname);
          if (!blk) continue;
          // In-sample statistics for the weights: the arm's signal tape, the window's OWN in-sample span, fill = signal.
          const isStats: Record<string, { ret: number; vol: number }> = {};
          for (const s of blk.memberSymbols) {
            const armDef = ARMS.find((x) => x.id === armId)!;
            const sArm = tapeOf(s, armDef.signal)!;
            const w = series[s].wins.find((x) => x.name === wname)!;
            const sp = spanOf(s, w, null);
            const isArr = w.isSeries === "coinbase" ? sArm.is4h : sArm.c4h;
            const isDaily = w.isSeries === "coinbase" ? sArm.isDaily : sArm.daily;
            const f = indexAtOrAfter(isArr, sp.isFromTs), t = indexAtOrAfter(isArr, sp.isToTs);
            const r = runSplit("trend-4h", s, isArr, isArr, isDaily, f, t, DEFAULT_TREND, COSTS.revx, 4, reg.stops(DEFAULT_TREND));
            const rr = [...dailyReturns(r.marks).values()];
            const m = mean(rr);
            isStats[s] = { ret: r.ret, vol: rr.length > 4 ? Math.sqrt(rr.reduce((a, x) => a + (x - m) * (x - m), 0) / (rr.length - 1)) : vol({ ...blk.sleevesRaw[0], rets: dailyReturns(r.marks) } as Sleeve) };
          }
          const plans: Record<string, unknown> = {};
          for (const p of PLANS) {
            const ws = p.weights(blk.sleevesRaw, isStats);
            const sized = blk.sleevesRaw.map((s, i) => ({ ...s, slotUsd: LIVE_CANDIDATE.capitalUsd * ws[i], tradedUsd: s.tradedUsd / SLOT * (LIVE_CANDIDATE.capitalUsd * ws[i]) }));
            plans[p.id] = { label: p.label, weights: Object.fromEntries(blk.sleevesRaw.map((s, i) => [s.symbol, r3(ws[i])])), result: combine(sized) };
          }
          armOut[armId] = plans;
        }
        byWindow[wname] = armOut;
      }
      per[reg.id] = byWindow;
    }
    (f4 as Record<string, unknown>).weightings = {
      note: "§3.11 point 1, re-run on each arm: does anything beat equal slots on BOTH windows? Weights are computed on the window's OWN in-sample span, with fill = signal (Revolut X's tape does not reach any in-sample), and applied out of sample. A plan wins only by beating equal slots on every window it is priced on.",
      perStopRule: per,
    };

    // §3.11 point 2, restricted to the row plans this harness can price with `run`'s rulebooks.
    const rowPer: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const byWindow: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        const armOut: Record<string, unknown> = {};
        for (const armId of ["b_cb_cb", "a_kr_kr", "c_kr_rx", "p_kr_cb"]) {
          const armDef = ARMS.find((x) => x.id === armId)!;
          const trendRevx = sleeveBlock(reg, armId, wname);
          if (!trendRevx) continue;
          const mk = (kind: StrategyKind, costs: Costs, slot: number, tag: string): Sleeve[] =>
            trendRevx.memberSymbols.map((s) => {
              const sArm = tapeOf(s, armDef.signal)!, fArm = tapeOf(s, armDef.fill)!;
              const w = series[s].wins.find((x) => x.name === wname)!;
              const cov = series[s].revxCoverage[wname];
              const clip = cov.covered ? { from: cov.clipFromTs, to: cov.clipToTs } : null;
              const sp = spanOf(s, w, clip);
              const f = indexAtOrAfter(sArm.c4h, sp.oosFromTs), t = indexAtOrAfter(sArm.c4h, sp.oosToTs);
              const r = runSplit(kind, s, sArm.c4h, fArm.c4h, sArm.daily, f, t, DEFAULT_TREND, costs, 4, reg.stops(DEFAULT_TREND));
              return { id: `${tag}·${s}`, symbol: s, slotUsd: slot, rets: dailyReturns(r.marks), ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * slot };
            });
          const trendKraken = mk("trend-4h", COSTS.kraken, SLOT, "trend-4h·kraken");
          const momentumRevx = mk("momentum-1d", COSTS.revx, 40 / trendRevx.memberSymbols.length, "momentum-1d·revx");
          armOut[armId] = {
            "trend-4h alone ($100)": combine(trendRevx.sleevesRaw),
            "trend-4h on both venues ($200)": combine([...trendRevx.sleevesRaw, ...trendKraken]),
            "trend-4h + momentum-1d ($140)": combine([...trendRevx.sleevesRaw, ...momentumRevx]),
          };
        }
        byWindow[wname] = armOut;
      }
      rowPer[reg.id] = byWindow;
    }
    (f4 as Record<string, unknown>).rowPlans = {
      note: "§3.11 point 2's ranking, restricted to the plans this harness can price: the rotation rows need `runRotation`, which is a basket simulator and has no split-fill twin here, and `trend-1h` needs hourly bars the Revolut X tape is not fetched at. The three priced are the top of §3.11's own table. `trend-4h on both venues` runs the Kraken twin on the SAME fill tape as the arm, at Kraken's costs — the twin is a paper row and this is the cost comparison, not a second venue's book.",
      perStopRule: rowPer,
    };
  }
  report.f4_decisions = f4;

  // ── the missing-bar policy, priced ─────────────────────────────────────
  {
    const rows: Record<string, unknown>[] = [];
    for (const reg of REGIMES) {
      for (const s of LIVE_CANDIDATE.symbols) {
        for (const wname of WNAMES) {
          const cov = series[s]?.revxCoverage?.[wname];
          if (!cov?.covered) continue;
          const sArm = tapeOf(s, "kraken")!, fArm = tapeOf(s, "revx");
          if (!fArm) continue;
          const w = series[s].wins.find((x) => x.name === wname)!;
          const sp = spanOf(s, w, { from: cov.clipFromTs, to: cov.clipToTs });
          const f = indexAtOrAfter(sArm.c4h, sp.oosFromTs), t = indexAtOrAfter(sArm.c4h, sp.oosToTs);
          const carry = runSplit("trend-4h", s, sArm.c4h, fArm.c4h, sArm.daily, f, t, DEFAULT_TREND, COSTS.revx, 4, reg.stops(DEFAULT_TREND), "carry");
          const skip = runSplit("trend-4h", s, sArm.c4h, fArm.c4h, sArm.daily, f, t, DEFAULT_TREND, COSTS.revx, 4, reg.stops(DEFAULT_TREND), "skip");
          rows.push({
            stopRule: reg.id, symbol: s, window: wname,
            carry: { ...pick(carry), align: carry.align }, skip: { ...pick(skip), align: skip.align },
            dRet: r4(skip.ret - carry.ret), dTrades: skip.trades - carry.trades,
          });
        }
      }
    }
    (report.f1_fidelity as Record<string, unknown>).missingBarPolicy = {
      note: "The live candidate under both missing-fill-bar policies. `carry` is the headline; `skip` refuses every bar the fill tape has no exact match for. A zero difference means the policy never mattered on this data; a non-zero one is the size of the choice.",
      rows,
      worstAbsDRet: rows.length ? r4(Math.max(...rows.map((r) => Math.abs(r.dRet as number)))) : 0,
      cellsWithAnyCarriedFill: rows.filter((r) => ((r.carry as { align: { fillsOnCarried: number } }).align.fillsOnCarried) > 0).length,
    };
  }

  // ── what predicts the gap ───────────────────────────────────────────────
  {
    const xs: Record<string, number[]> = {}, ys: number[] = [];
    const push = (k: string, v: number | null) => { if (v != null && Number.isFinite(v)) (xs[k] ??= []).push(v); };
    const rows: { symbol: string; window: string; stopRule: string; dRet: number; basisMedian: number; basisP95: number; adverseMean: number; trades: number; vol: number | null; halfSpread: number; book: number | null }[] = [];
    for (const reg of REGIMES) {
      for (const s of symbols) {
        for (const wname of WNAMES) {
          const c = tables[reg.id].c_kr_rx?.sleeve?.[s]?.[wname], b = tables[reg.id].p_kr_cb?.sleeve?.[s]?.[wname];
          if (!c || !b) continue;
          const adv = c.fills.map((f) => f.adverseBps), abs = c.fills.map((f) => Math.abs(f.basisBps));
          const cov = series[s].revxCoverage[wname];
          rows.push({
            symbol: s, window: wname, stopRule: reg.id, dRet: c.ret - b.ret,
            basisMedian: abs.length ? median(abs) : 0, basisP95: abs.length ? quantile(abs, 0.95) : 0,
            adverseMean: adv.length ? mean(adv) : 0, trades: c.trades,
            vol: volOver(series[s].kraken.c4h, cov.clipFromTs, cov.clipToTs),
            halfSpread: spreadOf(COSTS.revx, s) * 1e4, book: UK_BOOK_USD_PER_DAY[s] ?? null,
          });
        }
      }
    }
    for (const r of rows) {
      ys.push(r.dRet);
      push("absBasisMedianBps", r.basisMedian); push("absBasisP95Bps", r.basisP95);
      push("meanAdverseBps", r.adverseMean); push("trades", r.trades);
      push("volAnnualised", r.vol); push("halfSpreadBpsRevx", r.halfSpread); push("ukBookUsdPerDay", r.book);
    }
    report.whatPredictsTheFillGap = {
      note: "Spearman rank correlation between the fill gap (arm (c) minus the same signal tape filled on Coinbase, per coin × window × stop rule) and things that might explain it. Correlations on outputs, no search: the list was written before it was run and every entry is reported whatever it says.",
      comparisons: rows.length,
      spearman: Object.fromEntries(Object.entries(xs).map(([k, v]) => [k, v.length === ys.length ? r3(spearman(v, ys) ?? NaN) : null])),
      rows: rows.map((r) => ({ ...r, dRet: r4(r.dRet), basisMedian: r3(r.basisMedian), basisP95: r3(r.basisP95), adverseMean: r3(r.adverseMean) })),
    };
  }

  // ── the multiple-comparisons control ────────────────────────────────────
  const armsTotal = REGIMES.reduce((x, reg) => x + ARMS.reduce((y, a) => y + tables[reg.id][a.id].armsLookedAt, 0), 0);
  report.multipleComparisons = {
    armsLookedAt: armsTotal,
    note: `An "arm" here is one parameter point run out of sample on one coin, one window, one venue's costs, one stop rule and one (signal, fill) tape pair. ${armsTotal} of them were looked at. This study SEARCHES FOR NOTHING — it re-prices one fixed rule with the fill moved onto a second tape — so there is no best-of-N to correct: the headline is the SEEDED point, chosen before any of this existed, and every window and every stop rule is reported, never the best of them. Where a count of passes appears (§F4's bar), the null is stated exactly and never sampled: each window's clearers are an independent uniform subset of the population of the size that window actually produced, and the intersection distribution is hypergeometric. The sign tests are exact binomials under "the two tapes are exchangeable at a fill", reported at fill level AND at coin level because the fills inside one coin are not independent draws.`,
    windowsPerCoin: Object.fromEntries(symbols.map((s) => [s, series[s].wins.filter((w) => w.scored && series[s].krakenCoverage[w.name].covered).map((w) => w.name)])),
    windowsWithRevxFill: Object.fromEntries(symbols.map((s) => [s, series[s].wins.filter((w) => series[s].revxCoverage[w.name].covered).map((w) => w.name)])),
  };

  // The exact hypergeometric null for §F4's bar counts, on the windows arm (c) can see.
  {
    const per: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const arms: Record<string, unknown> = {};
      for (const v of VENUES) {
        for (const how of ["seeded", "chosen"] as const) {
          const m = membership(reg, "c_kr_rx", v, how);
          const ws = Object.keys(m).sort();
          const pool = symbols.filter((s) => ws.every((w) => tables[reg.id].c_kr_rx?.trend?.[s]?.[w]));
          const n = pool.length;
          if (!n || ws.length < 2) { arms[`${v}·${how}`] = { windows: ws, population: n, note: "fewer than two windows have a Revolut X fill — no intersection to test" }; continue; }
          const ks = ws.map((w) => (m[w] ?? []).filter((s) => pool.includes(s)).length);
          const dist = intersectionDistribution(n, ks);
          const observed = pool.filter((s) => ws.every((w) => (m[w] ?? []).includes(s))).length;
          arms[`${v}·${how}`] = {
            windows: ws, population: n, clearersPerWindow: Object.fromEntries(ws.map((w, i) => [w, ks[i]])),
            observedClearingAll: observed,
            expectedByChance: r3(dist.reduce((a, p, j) => a + p * j, 0)),
            pAtLeastObserved: r3(dist.slice(observed).reduce((a, b) => a + b, 0)),
          };
        }
      }
      per[reg.id] = arms;
    }
    (report.f4_decisions as Record<string, unknown>).chanceOnTheLoopArm = {
      note: "The exact null for §F4's counts on arm (c): each window's clearers are an independent uniform subset of the population of the size that window produced, and the intersection distribution is hypergeometric. Not sampled.",
      perStopRule: per,
    };
  }

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error(`backtest.ts changed during the run (${btHashStart.slice(0, 12)} → ${btHashEnd.slice(0, 12)}); re-run it`);
  report.sourceIntegrity = {
    backtestTsSha256: btHashStart, stableAcrossRun: true,
    note: "SHA-256 of `supabase/functions/agents/backtest.ts`, read at the start of the run and again at the end. This study imports its `run`, `COSTS`, `spreadOf` and `stopsForKind`, so that file is an input: the hash says which version produced these numbers, and a run that straddled an edit would have thrown rather than written this file.",
  };

  const path = `${outDir}/fill.json`;
  await Deno.writeTextFile(path, JSON.stringify(report, null, 1));
  console.log(`wrote ${path} in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
}
