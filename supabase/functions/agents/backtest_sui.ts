// The SUI study: does SUI deserve its seat in the LIVE row?
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_sui.ts \
//     --data  <dir with BTC-USD_1h_3y.json …>       (Coinbase Exchange hourly, 3 y)
//     --ext   <dir with BTC-USD_1h_kraken.json …>   (Kraken quarterly bundle, hourly)
//     --ktape <dir with BTC-USD_4h_kraken.json …>   (Kraken's own 4 h tape, full span)
//     --rtape <dir with BTC-USD_4h_revx.json …>     (Revolut X UK public 4 h book, 1 y)
//     --set2  docs/agents/backtests/set2.json       (cross-check, optional but expected)
//     --tape  docs/agents/backtests/tape.json       (cross-check, optional but expected)
//     --out   docs/agents/backtests
//
// Writes `<out>/sui.json` and NOTHING else.
//
// ── why this study exists ─────────────────────────────────────────────
//
// The repository judges a coin-set change by the WORST of four walk-forward
// windows — A (bear), B (bull), C (strong bull), D (sideways) — never
// averaged. SUI has windows A and B only: its history begins 2023-05-03 and
// window C's in-sample would be 142 days, under the 180-day floor
// `backtest_set2.ts` declares. So C and D are FOUR-coin sleeves, the live
// row's worst window is D in every condition, and `drop·SUI` reports a delta
// of exactly 0.00 in all four conditions.
//
// That zero is an IDENTITY, not a measurement. You cannot remove a coin from
// a window it is not in, and the window that decides is one of those. The
// four-window rule is structurally silent on SUI, and no study here has said
// so out loud or worked round it.
//
// ── what is imported and what is copied ───────────────────────────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`
// and `spreadOf`, and the live rulebooks in `_shared/agents_strategy.ts`, are
// IMPORTED. ONE copy exists, `runMarked`, taken from `run` line by line; it
// marks equity at EVERY bar instead of every sixth and counts the traded
// weight, both of which the sleeve arithmetic needs (`run` samples at
// `i % 6 === 0`, and WHICH calendar bar that is moves with the array start —
// which is exactly what differs between five coins whose tapes begin on five
// different days). `fidelity.runMarked` is the proof that it is otherwise
// `run`: every coin × window × venue × stop rule × tape, return, drawdown,
// trades, days, exposure, fees and stops-hit.
//
// `combine`, `dailyMarks`, `dailyReturns`, `plateauOf`, `barTests`,
// `windowsOn`, `logChoose`, `binomTail` and `signTest` are copied from
// `backtest_set2.ts` / `backtest_windows.ts`, which do not export them: they
// do arithmetic on OUTPUTS and touch no price and no fee. `combinePath` is
// `combine` with the equity path kept, and `fidelity.combinePath` checks that
// its stats are `combine`'s to the digit.
//
// Two further fidelity checks are against PUBLISHED work rather than against
// this file's own code, and they are the load-bearing ones:
//   · `fidelity.vsSet2`  — every A1 cell this study re-derives (the five-coin
//     baseline and the `drop·SUI` arm, four conditions × four windows ×
//     ret / maxDD / retOverDD) against `set2.json`.
//   · `fidelity.vsTape`  — every §4.15 bar verdict for the live five (two
//     stop rules × two tapes × two venues × seeded and chosen) against
//     `tape.json`.
// If either differs, nothing below may be read.
//
// ── determinism ───────────────────────────────────────────────────────
//
// No wall-clock or runtime field is written. Re-running over the same four
// data directories reproduces this file byte for byte. `backtest.ts` is
// SHA-256'd at the start and the end of the run and the hash is an input.

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

/** Revolut X UK-book 24 h quote volume, reference §3.8. Only the live five are needed here. */
const UK_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 3_600_000, "ETH/USD": 3_200_000, "SOL/USD": 3_300_000,
  "AVAX/USD": 1_900_000, "SUI/USD": 942_000,
};
const KRAKEN_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 48_900_000, "ETH/USD": 29_500_000, "SOL/USD": 12_900_000,
  "AVAX/USD": 1_260_000, "SUI/USD": 2_390_000,
};
const MIN_BOOK_USD = 100_000;

/** The live row as `0040` left it and `0046` would flip. */
const LIVE_ROW = { row: "trend-4h", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100 };
const FOUR = LIVE_ROW.symbols.filter((s) => s !== "SUI/USD");
const MAX_ORDER_USD = 20;

/** §3.15's acceptance test for a spliced series, declared before any comparison. */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
/** A window whose in-sample is shorter than this is not scored. This is the rule that costs SUI window C. */
const MIN_IN_SAMPLE_DAYS = 180;
/** The stop rule §3.7 / §3.8 / §3.10 / §3.11 were computed under — the 8 % floor PLUS the intra-bar 3×ATR trail. */
const PINNED_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };
/** The widest lookback any grid point uses (slow 150 + breakoutUp 55 + slack), as `backtest_set2.ts` sets it. */
const MAX_LOOKBACK = 301;
/** A window A priced on the venue's own book needs this share of its scored bars to BE the venue's own. */
const REVX_MIN_WINDOW_COVERAGE = 0.95;

/**
 * SUI's touch, measured three ways. `COSTS.revx` charges 11.97 bps a side —
 * the median of 21 samples a minute apart on 2026-09-21 (§3.8), and the number
 * every published SUI figure rests on. §4.19 measured 25.7 bps FULL spread live
 * on 2026-09-22 and §4.20 measured 23.7 the same afternoon. The sleeve is
 * priced at all three, plus the doubled spread §3.8 used as its stress, because
 * a coin whose seat rests on a spread assumption should be re-asked at the
 * spread that was actually measured.
 */
const SUI_HALF_SPREADS: { id: string; halfSpread: number; what: string }[] = [
  { id: "assumed", halfSpread: 11.97e-4, what: "COSTS.revx — the median of 21 samples a minute apart, 2026-09-21 (§3.8); a 41.94 bps round trip" },
  { id: "measured_23_7", halfSpread: 11.85e-4, what: "§4.20's live side-by-side book measurement, 23.7 bps full; a 41.70 bps round trip" },
  { id: "measured_25_7", halfSpread: 12.85e-4, what: "§4.19's live UK touch the minute the pre-live probe ran, 25.7 bps full; a 43.70 bps round trip" },
  { id: "doubled", halfSpread: 23.94e-4, what: "§3.8's own stress — every Revolut X half-spread doubled; a 65.88 bps round trip" },
];

// ─────────────────────────────────────────── the ONE copy of `run` in this file

type MarkedResult = RunResult & { tradedWeight: number; marks: [number, number][] };

/**
 * `backtest.ts`'s `run`, line by line, with exactly two additions: a mark at
 * EVERY bar rather than every sixth, and the traded weight the turnover figure
 * needs. Everything that costs money — the entry at the next open plus the
 * half-spread, the venue's `fillFee`, the floor under average cost and the ATR
 * trail read against the next bar's low and filled at the level (or the open
 * when the bar gaps through it), the high-water mark advanced by each bar's
 * high, the two-bar cooldown after ANY exit, and the return / drawdown / trade
 * / exposure / day arithmetic — is `run`'s.
 *
 * It exists because `run` samples its curve at `i % 6 === 0`, and which
 * CALENDAR bar that is depends on where the array starts; five coins whose
 * arrays begin on five different days would then be combined on five different
 * clocks. `fidelity.runMarked` is the proof it is otherwise `run`.
 */
function runMarked(
  kind: StrategyKind, symbol: string, c4h: Candle[], daily: Candle[], from: number, to: number, p: TrendParams,
  costs: Costs, barHours: number, stops: StopParams | null,
): MarkedResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  let tradedWeight = 0;
  const marks: [number, number][] = [];
  const pre = precompute(c4h, p);
  let dk = 0; // daily candles closed at or before the current 4h bar (moves forward only)
  const start = Math.max(from, p.slow + 1);
  for (let i = start; i < to - 1; i++) {
    while (dk < daily.length && daily[dk].start + 86400e3 <= c4h[i].start + barHours * 3600e3) dk++;
    const snap = buildSnapshot(symbol, c4h, i, daily.slice(0, dk), pos, c4h[i].start + barHours * 3600e3, p, pre, (24 / barHours) * 365);
    const rule = ruleFor(kind, snap, pos, p);
    const next = c4h[i + 1];
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (rule.action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);                    // the touch, at the next open
      const base = cash / (price * (1 + fill));              // the fee comes out of the same cash
      const fee = base * price * fill;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++; tradedWeight += 1;
    } else if (rule.action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fill;
      cash = pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; tradedWeight += 1; lastExitBar = i + 1;
    } else if (stops && pos.base > 0) {
      const hw = Math.max(pos.highWater ?? pos.avgCost, pos.avgCost);
      const atr = stops.atrStop != null ? atrAt(c4h, i, stops.atrN) : null;
      const floor = pos.avgCost * (1 - stops.maxLossPct);
      const trail = stops.atrStop != null && atr != null ? hw - stops.atrStop * atr : -Infinity;
      const level = Math.max(floor, trail);
      if (next.low <= level) {
        const price = Math.min(level, next.open) * (1 - hs);
        const fee = pos.base * price * stopFee;
        cash = pos.base * price - fee;
        pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
        trades++; stopsHit++; tradedWeight += 1; lastExitBar = i + 1;
      }
    }
    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }; }
    const eq = cash + pos.base * next.close;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    marks.push([next.start, eq]);
  }
  const eqEnd = cash + pos.base * c4h[to - 1].close;
  const days = (c4h[to - 1].start - c4h[start].start) / 86400e3;
  return {
    ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity: marks,
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit, tradedWeight, marks,
  };
}

// ───────────────────────────────────────────── arithmetic on outputs (copied)

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
const r4 = (x: number) => Number(x.toFixed(4));
const r3 = (x: number) => Number(x.toFixed(3));
const r2 = (x: number) => Number(x.toFixed(2));

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

type Plateau = { gridPoints: number; positiveShare: number; median: number; chosenRank: number };
function plateauOf(rets: number[], chosen: number): Plateau {
  const sorted = [...rets].sort((a, b) => b - a);
  return {
    gridPoints: rets.length,
    positiveShare: r3(rets.filter((r) => r > 0).length / Math.max(1, rets.length)),
    median: r4(median(rets)),
    chosenRank: sorted.findIndex((r) => r === chosen) + 1,
  };
}
/** §4.15's four tests, as `backtest_set2.ts` applies them. The book test is applied separately. */
function barTests(own: RunResult, other: RunResult, plateau: Plateau): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!(own.ret > 0)) failed.push("negative out of sample on the running venue");
  if (!(own.maxDD < 0.35)) failed.push("drawdown 35 % or worse");
  if (!(plateau.positiveShare >= 0.5)) failed.push("under half the grid positive out of sample");
  if (!(other.ret > 0)) failed.push("negative on the other venue's costs");
  return { pass: failed.length === 0, failed };
}
function score(r: { ret: number; maxDD: number }): number { return r.ret / Math.max(0.05, r.maxDD); }
function pick(r: RunResult) {
  return {
    ret: r4(r.ret), maxDD: r4(r.maxDD), retOverDD: r2(score(r)),
    trades: r.trades, days: Math.round(r.days), exposure: r3(r.exposure), stopsHit: r.stopsHit ?? 0,
  };
}

function dailyMarks(equity: [number, number][]): { day: number; eq: number }[] {
  const m = new Map<number, number>();
  for (const [t, e] of equity) m.set(Math.floor(t / 86400e3) * 86400e3, e);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, eq]) => ({ day, eq }));
}
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
  bestDayUsd: number; worstDayUsd: number; peakOpenUsd: number; maxOrderUsd: number;
};
/** Combine sleeves at their slot sizes. Copied from `backtest_set2.ts`, unchanged. */
function combine(sleeves: Sleeve[]): SleeveStats {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  const maxOrder = r2(Math.max(0, ...sleeves.map((s) => s.slotUsd)));
  if (days.length === 0) {
    return {
      members: sleeves.length, capitalUsd: r2(capital), pnlUsd: 0, ret: 0, maxDD: 0, retOverDD: 0,
      days: 0, from: "", to: "", deployment: 0, turnoverPerYear: 0, bestDayUsd: 0, worstDayUsd: 0,
      peakOpenUsd: r2(capital), maxOrderUsd: maxOrder,
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
    maxOrderUsd: maxOrder,
  };
}
/**
 * `combine` with the equity path kept, so drawdown can be decomposed rather
 * than only reported. The stats it returns are `combine`'s own — it calls it —
 * so the path can never disagree with the number.
 */
function combinePath(sleeves: Sleeve[]): { stats: SleeveStats; days: number[]; equity: number[]; pnl: number[]; perSleevePnl: Record<string, number[]> } {
  const stats = combine(sleeves);
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  const equity: number[] = [], pnl: number[] = [];
  const perSleevePnl: Record<string, number[]> = Object.fromEntries(sleeves.map((s) => [s.symbol, []]));
  let eq = capital;
  for (const d of days) {
    let p = 0;
    for (const s of sleeves) { const x = s.slotUsd * (s.rets.get(d) ?? 0); p += x; perSleevePnl[s.symbol].push(x); }
    eq += p; equity.push(eq); pnl.push(p);
  }
  return { stats, days, equity, pnl, perSleevePnl };
}
/** Max drawdown of an equity path that starts at `capital`. */
function ddOf(capital: number, equity: number[]): number {
  let peak = capital, dd = 0;
  for (const e of equity) { peak = Math.max(peak, e); dd = Math.max(dd, 1 - e / peak); }
  return dd;
}

// ─────────────────────────────────────────────── the exact chance arithmetic

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
/** P(X ≥ k) for X ~ Binomial(n, p), summed exactly. */
function binomTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let s = 0;
  for (let i = k; i <= n; i++) s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}
/** Two-sided exact sign test on `pos` positives and `neg` negatives (ties dropped). */
function signTest(pos: number, neg: number): { positives: number; negatives: number; n: number; pTwoSided: number } {
  const n = pos + neg;
  if (n === 0) return { positives: pos, negatives: neg, n, pTwoSided: 1 };
  const k = Math.max(pos, neg);
  const p = Math.min(1, 2 * binomTail(n, k, 0.5));
  return { positives: pos, negatives: neg, n, pTwoSided: Number(p.toFixed(6)) };
}

// ───────────────────────────────────────────────────────────── tape plumbing

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const toCandles = (raw: Raw[]): Candle[] => raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));

function indexAtOrAfter(bars: Candle[], ts: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].start < ts) lo = mid + 1; else hi = mid; }
  return lo;
}

type WinName = "A" | "B" | "C" | "D";
type Win = {
  name: WinName; isSeries: "coinbase" | "combined";
  isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  isDays: number; oosDays: number; isFromIso: string; oosFromIso: string; oosToIso: string;
  scored: boolean; why: string;
};
const YEAR_MS = 365 * 86400e3;

/** The four windows, identical to `backtest_set2.ts` / `backtest_windows.ts` — the same cuts, floor and names. */
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
  const mk = (name: WinName, isSeries: Win["isSeries"], isFrom: number, isTo: number, oosFrom: number, oosTo: number): Win => {
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

/** |Δclose| in bps between two series over every bar they share. Copied from `backtest_set2.ts`. */
function tapeAgreement(a: Candle[], b: Candle[], fromTs: number, toTs: number) {
  const byTs = new Map(b.map((c) => [c.start, c]));
  const diffs: number[] = [];
  for (const c of a) {
    if (c.start < fromTs || c.start >= toTs) continue;
    const o = byTs.get(c.start);
    if (!o) continue;
    const m = (c.close + o.close) / 2;
    if (m > 0) diffs.push(Math.abs(c.close - o.close) / m * 1e4);
  }
  return diffs.length
    ? { sharedBars: diffs.length, medianBps: r3(median(diffs)), p95Bps: r3(quantile(diffs, 0.95)), maxBps: r3(Math.max(...diffs)) }
    : { sharedBars: 0, medianBps: null, p95Bps: null, maxBps: null };
}

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? ""), rDir = String(args.rtape ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const set2Path = args.set2 ? String(args.set2) : "";
  const tapePath = args.tape ? String(args.tape) : "";
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  if (!extDir) throw new Error("--ext <dir with BTC-USD_1h_kraken.json …> is required");
  if (!kDir) throw new Error("--ktape <dir with BTC-USD_4h_kraken.json …> is required");
  if (!rDir) throw new Error("--rtape <dir with BTC-USD_4h_revx.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });

  const sha = async (u: URL | string) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(u));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btPath = new URL("./backtest.ts", import.meta.url);
  const btHashStart = await sha(btPath);

  // ── the tapes, built exactly as `backtest_set2.ts` builds them ──────────
  type Arm = { c4h: Candle[]; daily: Candle[]; is4h: Candle[]; isDaily: Candle[] };
  type Series = {
    coinbase: Arm; kraken: Arm; revx: Arm; cb4h: Candle[]; wins: Win[];
    overlap: ReturnType<typeof tapeAgreement>;
    krakenCoverage: Record<string, { covered: boolean; why: string }>;
    revxCovered: boolean; revxCoverage: number; revxFirstIso: string;
  };
  const series: Record<string, Series> = {};
  const provenance: Record<string, unknown>[] = [];

  for (const symbol of LIVE_ROW.symbols) {
    const base = symbol.replace("/", "-");
    const cbH = toCandles(JSON.parse(await Deno.readTextFile(`${dataDir}/${base}_1h_3y.json`)) as Raw[]);
    const kH = toCandles(JSON.parse(await Deno.readTextFile(`${extDir}/${base}_1h_kraken.json`)) as Raw[]);
    const kTape = toCandles(JSON.parse(await Deno.readTextFile(`${kDir}/${base}_4h_kraken.json`)) as Raw[]);
    const rTape = toCandles(JSON.parse(await Deno.readTextFile(`${rDir}/${base}_4h_revx.json`)) as Raw[]);
    const spliceAt = cbH[0].start;

    const cb4h = resample(cbH, 4);
    const combH = [...kH.filter((c) => c.start < spliceAt), ...cbH];
    const comb4h = resample(combH, 4), combDaily = resample(combH, 24);
    const cbDaily = resample(cbH, 24);
    const zK = indexAtOrAfter(kTape, spliceAt);
    const kIs4h = kTape.slice(zK);
    const kDaily = resample(kTape, 24);
    const kIsDaily = kDaily.filter((c) => c.start >= (kIs4h.length ? kIs4h[0].start : Infinity));

    const rFirst = rTape.length ? rTape[0].start : Infinity;
    const rComb = [...kTape.filter((c) => c.start < rFirst), ...rTape];
    const revxArm: Arm = { c4h: rComb, daily: resample(rComb, 24), is4h: rComb, isDaily: resample(rComb, 24) };

    const wins = windowsOn(comb4h, cb4h, MAX_LOOKBACK);
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
    const ov4h = tapeAgreement(cb4h, kTape, cb4h[0].start, cb4h[cb4h.length - 1].start + 4 * 3600e3);

    // The venue's own book over window A, with the same coverage floor set2 declares.
    const wA = wins.find((w) => w.name === "A")!;
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    const aFrom = comb4h[wA.oosFrom].start, aTo = endTs(comb4h, wA.oosTo);
    const scored = rComb.filter((c) => c.start >= aFrom && c.start < aTo);
    const fromRevx = scored.filter((c) => c.start >= rFirst).length;
    const coverage = scored.length ? fromRevx / scored.length : 0;
    const revxCovered = wA.scored && rTape.length > 0 && rTape[rTape.length - 1].start + 4 * 3600e3 >= aTo && coverage >= REVX_MIN_WINDOW_COVERAGE;

    series[symbol] = { coinbase: { c4h: comb4h, daily: combDaily, is4h: cb4h, isDaily: cbDaily }, kraken: { c4h: kTape, daily: kDaily, is4h: kIs4h, isDaily: kIsDaily }, revx: revxArm, cb4h, wins, overlap: ov4h, krakenCoverage, revxCovered, revxCoverage: r4(coverage), revxFirstIso: rTape.length ? iso(rTape[0].start) : "" };
    provenance.push({
      symbol,
      coinbase: { bars4h: cb4h.length, first: iso(cb4h[0].start), last: iso(cb4h[cb4h.length - 1].start) },
      combined: { bars4h: comb4h.length, first: iso(comb4h[0].start), last: iso(comb4h[comb4h.length - 1].start) },
      krakenTape: { bars4h: kTape.length, first: iso(kTape[0].start), last: iso(kTape[kTape.length - 1].start) },
      revxTape: { bars4h: rTape.length, first: iso(rTape[0].start), last: iso(rTape[rTape.length - 1].start), windowACoverage: r4(coverage), covered: revxCovered },
      overlapOverCoinbaseSpan: ov4h,
      overlapAcceptable: (ov4h.medianBps ?? 1e9) <= OVERLAP_MEDIAN_MAX_BPS && (ov4h.p95Bps ?? 1e9) <= OVERLAP_P95_MAX_BPS,
      windowsScored: wins.filter((w) => w.scored).map((w) => w.name),
      windowsPriced: wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name),
      windowsDropped: wins.filter((w) => !w.scored).map((w) => ({ window: w.name, why: w.why })),
    });
    console.log(`${symbol.padEnd(9)} cb ${cb4h.length} | comb ${comb4h.length} (${isoDay(comb4h[0].start)}) | kraken ${kTape.length} | revx ${rTape.length} | windows ${wins.filter((w) => w.scored).map((w) => w.name).join("") || "—"}`);
  }

  // ── the grid, the tapes, the stop rules ────────────────────────────────
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const SEEDED_IDX = TREND_GRID.findIndex((p) => p.fast === DEFAULT_TREND.fast && p.slow === DEFAULT_TREND.slow && p.atrStop === DEFAULT_TREND.atrStop);
  const VENUES = ["revx", "kraken"] as const;
  type Venue = typeof VENUES[number];
  const TAPES = ["coinbase", "kraken"] as const;
  const TAPES_ALL = ["coinbase", "kraken", "revxuk"] as const;
  type Tape = typeof TAPES_ALL[number];
  const STOP_RULES = ["shipped", "trail"] as const;
  type StopRule = typeof STOP_RULES[number];
  const other = (v: Venue): Venue => v === "revx" ? "kraken" : "revx";
  const stopsOf = (reg: StopRule, p: TrendParams): StopParams => reg === "shipped" ? stopsForKind("trend-4h", p) : { ...PINNED_STOPS, atrStop: p.atrStop };
  const CONDITIONS = STOP_RULES.flatMap((reg) => TAPES.map((tape) => ({ reg, tape, id: `${reg}·${tape}` })));
  const WINDOW_A_CONDITIONS = STOP_RULES.flatMap((reg) => TAPES_ALL.map((tape) => ({ reg, tape, id: `${reg}·${tape}` })));
  const armOf = (tape: Tape) => tape === "revxuk" ? "revx" as const : tape;
  const bookOf = (v: Venue, s: string) => (v === "revx" ? UK_BOOK_USD_PER_DAY[s] : KRAKEN_BOOK_USD_PER_DAY[s]) ?? 0;

  /** A window's calendar span, resolved by TIMESTAMP and never by bar index. Copied from `backtest_set2.ts`. */
  function spanOf(symbol: string, w: Win) {
    const { coinbase, cb4h } = series[symbol];
    const comb = coinbase.c4h;
    const isArr = w.isSeries === "coinbase" ? cb4h : comb;
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    return { isFromTs: isArr[w.isFrom].start, isToTs: endTs(isArr, w.isTo), oosFromTs: comb[w.oosFrom].start, oosToTs: endTs(comb, w.oosTo) };
  }
  function boundsOn(symbol: string, w: Win, tape: Tape) {
    const arm = series[symbol][armOf(tape)];
    const sp = spanOf(symbol, w);
    const isArr = w.isSeries === "coinbase" ? arm.is4h : arm.c4h;
    const isDaily = w.isSeries === "coinbase" ? arm.isDaily : arm.daily;
    return {
      isArr, isDaily, oosArr: arm.c4h, oosDaily: arm.daily,
      isFrom: indexAtOrAfter(isArr, sp.isFromTs), isTo: indexAtOrAfter(isArr, sp.isToTs),
      oosFrom: indexAtOrAfter(arm.c4h, sp.oosFromTs), oosTo: indexAtOrAfter(arm.c4h, sp.oosToTs),
    };
  }
  function windowsPricedOn(symbol: string, tape: Tape): Win[] {
    const s = series[symbol];
    if (tape === "revxuk") return s.revxCovered && s.krakenCoverage.A?.covered ? s.wins.filter((w) => w.name === "A" && w.scored) : [];
    return s.wins.filter((w) => w.scored && s.krakenCoverage[w.name].covered);
  }

  // ── the per-coin grid and the §4.15 bar, per window ─────────────────────
  type Cell = {
    chosen: { fast: number; slow: number; atrStop: number };
    chosenOwn: ReturnType<typeof pick>; chosenOther: ReturnType<typeof pick>;
    seededOwn: ReturnType<typeof pick>; seededOther: ReturnType<typeof pick>;
    plateau: number; chosenPass: boolean; seededPass: boolean; seededFailed: string[];
    seededClears: boolean; chosenClears: boolean; chosenAvailable: boolean;
  };
  function studyVenue(symbol: string, venue: Venue, inSample: ((p: TrendParams, c: Costs) => RunResult) | null, outOfSample: (p: TrendParams, c: Costs) => RunResult): Cell {
    const own = COSTS[venue], oth = COSTS[other(venue)];
    let bestIdx = SEEDED_IDX, bestScore = -Infinity;
    if (inSample) for (let i = 0; i < TREND_GRID.length; i++) { const s = score(inSample(TREND_GRID[i], own)); if (s > bestScore) { bestScore = s; bestIdx = i; } }
    const oosOwn = TREND_GRID.map((p) => outOfSample(p, own));
    const plateau = plateauOf(oosOwn.map((r) => r.ret), oosOwn[bestIdx].ret);
    const chosenOther = outOfSample(TREND_GRID[bestIdx], oth);
    const seededOther = outOfSample(TREND_GRID[SEEDED_IDX], oth);
    const chosen = barTests(oosOwn[bestIdx], chosenOther, plateau);
    const seeded = barTests(oosOwn[SEEDED_IDX], seededOther, plateau);
    const book = bookOf(venue, symbol) >= MIN_BOOK_USD;
    return {
      chosen: { fast: TREND_GRID[bestIdx].fast, slow: TREND_GRID[bestIdx].slow, atrStop: TREND_GRID[bestIdx].atrStop },
      chosenOwn: pick(oosOwn[bestIdx]), chosenOther: pick(chosenOther), seededOwn: pick(oosOwn[SEEDED_IDX]), seededOther: pick(seededOther),
      plateau: plateau.positiveShare, chosenPass: chosen.pass, seededPass: seeded.pass, seededFailed: seeded.failed,
      seededClears: seeded.pass && book, chosenClears: chosen.pass && book, chosenAvailable: inSample != null,
    };
  }

  const cells: Record<string, Record<string, Record<string, Record<string, Record<string, Cell>>>>> = {};
  const cores: Record<string, Record<string, Record<string, Record<string, Record<string, MarkedResult>>>>> = {};
  let fidChecks = 0, fidRet = 0, fidDD = 0, fidTrades = 0, fidDays = 0, fidExp = 0, fidFees = 0, fidStops = 0;
  let gridArms = 0;

  for (const reg of STOP_RULES) {
    cells[reg] = {}; cores[reg] = {};
    for (const tape of TAPES_ALL) {
      cells[reg][tape] = {}; cores[reg][tape] = {};
      for (const symbol of LIVE_ROW.symbols) {
        cells[reg][tape][symbol] = {}; cores[reg][tape][symbol] = {};
        for (const w of windowsPricedOn(symbol, tape)) {
          const b = boundsOn(symbol, w, tape);
          const isRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.isArr, b.isDaily, b.isFrom, b.isTo, p, c, 4, stopsOf(reg, p));
          const oosRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, p, c, 4, stopsOf(reg, p));
          cells[reg][tape][symbol][w.name] = {}; cores[reg][tape][symbol][w.name] = {};
          for (const v of VENUES) {
            cells[reg][tape][symbol][w.name][v] = studyVenue(symbol, v, tape === "revxuk" ? null : isRun, oosRun);
            gridArms += TREND_GRID.length;
            // `runMarked` must BE `run`, every cell, on everything `RunResult` carries.
            const a = oosRun(DEFAULT_TREND, COSTS[v]);
            const m = runMarked("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, DEFAULT_TREND, COSTS[v], 4, stopsOf(reg, DEFAULT_TREND));
            fidChecks++;
            fidRet = Math.max(fidRet, Math.abs(a.ret - m.ret));
            fidDD = Math.max(fidDD, Math.abs(a.maxDD - m.maxDD));
            fidTrades = Math.max(fidTrades, Math.abs(a.trades - m.trades));
            fidDays = Math.max(fidDays, Math.abs(a.days - m.days));
            fidExp = Math.max(fidExp, Math.abs(a.exposure - m.exposure));
            fidFees = Math.max(fidFees, Math.abs(a.fees - m.fees));
            fidStops = Math.max(fidStops, Math.abs((a.stopsHit ?? 0) - (m.stopsHit ?? 0)));
            cores[reg][tape][symbol][w.name][v] = m;
          }
        }
      }
    }
    console.log(`[${reg}] grid done`);
  }

  // ── sleeves ────────────────────────────────────────────────────────────
  function sleeveFromCores(rs: { symbol: string; r: MarkedResult }[], capitalUsd: number, slots: number) {
    const slot = capitalUsd / slots;
    return rs.map(({ symbol, r }) => ({
      id: `trend-4h·${symbol}`, symbol, slotUsd: slot, rets: dailyReturns(r.marks),
      ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * slot,
    }));
  }
  function sleeveOf(coinSet: string[], wname: WinName, reg: StopRule, tape: Tape, venue: Venue, capitalUsd = LIVE_ROW.capitalUsd): { stats: SleeveStats; members: string[] } | null {
    const members = coinSet.filter((s) => cores[reg][tape][s]?.[wname]?.[venue]);
    if (members.length < 2) return null;
    return { stats: combine(sleeveFromCores(members.map((s) => ({ symbol: s, r: cores[reg][tape][s][wname][venue] })), capitalUsd, coinSet.length)), members };
  }
  const LIVE_WINDOWS: WinName[] = ["A", "B", "C", "D"];
  function worstOf(per: Partial<Record<WinName, SleeveStats>>, only?: WinName[]) {
    let best: { window: WinName | null; retOverDD: number; ret: number } = { window: null, retOverDD: Infinity, ret: Infinity };
    for (const w of (only ?? LIVE_WINDOWS)) { const s = per[w]; if (!s) continue; if (s.retOverDD < best.retOverDD) best = { window: w, retOverDD: s.retOverDD, ret: s.ret }; }
    return best.window == null ? { window: null, retOverDD: NaN, ret: NaN } : best;
  }
  function sleeveAcross(coinSet: string[], reg: StopRule, tape: Tape, venue: Venue = "revx") {
    const per: Partial<Record<WinName, SleeveStats>> = {}, mem: Partial<Record<WinName, string[]>> = {};
    for (const w of LIVE_WINDOWS) { const s = sleeveOf(coinSet, w, reg, tape, venue); if (s) { per[w] = s.stats; mem[w] = s.members; } }
    return { per, members: mem };
  }

  const report: Record<string, unknown> = {
    study: "Does SUI deserve its seat in the LIVE `trend-4h` row? The four-window rule is structurally SILENT on it — SUI has windows A and B only, the row's worst window is D in every condition, and `drop·SUI` therefore reports a delta of exactly 0.00 in all four conditions, which is an identity rather than a measurement. This study reproduces the published figures from the raw candles, then judges SUI three ways the worst-window rule cannot: on the windows it HAS symmetrically with the other four, over the CONTIGUOUS span where all five coins exist, and in consecutive six-month folds over that span. Every search states its arm count and its null exactly.",
    source: "Same four data directories and the same arm construction as `backtest_set2.ts`. `coinbase`: Kraken's quarterly bundle spliced strictly BEFORE the Coinbase series' first bar, Coinbase's from there — the tape every published table used. `kraken`: Kraken's own 4-hour tape end to end — what `signal_venue` makes the loop read. `revxuk`: Revolut X's public keyless UK book, one year, window A only. Fills, fees, the protective exits and the two-bar cooldown are `backtest.ts`'s own.",
    determinism: "No wall-clock or runtime field is written. Re-running over the same four data directories reproduces this file byte for byte; every null is computed exactly rather than sampled.",
    theQuestionTheFrameworkCannotAnswer: {
      rule: "an arm must beat the incumbent on the WORST of four walk-forward windows, in all four evaluations (2 tapes × 2 stop rules); windows are never averaged",
      whySilent: "SUI's combined tape begins 2023-05-03. Window C's in-sample would be the span from there to the Coinbase series' first bar — under the 180-day floor `backtest_set2.ts` declares — so C is not scored for SUI, and D is earlier still. C and D are therefore FOUR-coin sleeves whether or not SUI is in the row.",
      consequence: "the baseline's worst window is D in every condition, and `drop·SUI`'s delta on D is 0 BY CONSTRUCTION. `set2.json`'s `drop·SUI` arm reports 0 / 0 / 0 / 0 and `conditionsImproved: 0`, and neither number is evidence about SUI.",
    },
    windows: {
      A: "parameters on the first two thirds, the LAST third out of sample (bear, majors −39.4 %)",
      B: "parameters on the first third, the MIDDLE third out of sample (bull, +72.3 %)",
      C: "parameters on the 24 months of extended history before the series, the FIRST third out of sample (stronger bull, +243.0 %)",
      D: "parameters on the 24 months before that, the 12 months before the series out of sample (sideways, −5.8 %)",
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
    },
    stopRules: {
      note: "EVERY figure in this file is reported under `shipped` and `trail`, and is never averaged between them.",
      shipped: { stops: stopsForKind("trend-4h", DEFAULT_TREND), constant: { ...SHIPPED_STOPS }, what: "what backtest.ts ships and tick.ts runs — the 8 % floor alone, the intra-bar trail removed 2026-09-21 (§3.13)" },
      trail: { stops: { ...PINNED_STOPS }, what: "the 8 % floor plus the 3×ATR(14) intra-bar trail — what §3.7 / §3.8 / §3.10 / §3.11, and SUI's admission, were computed under" },
    },
    conditions: { list: CONDITIONS.map((c) => c.id), windowAList: WINDOW_A_CONDITIONS.map((c) => c.id) },
    bar: "reference §3.7 / §4.15: positive out of sample on the running venue's costs, max drawdown < 35 %, at least half the grid positive out of sample, positive on the other venue's costs — on BOTH walk-forward windows — plus a Revolut X UK book of at least $100k a day.",
    costs: COSTS,
    suiSpreadArms: SUI_HALF_SPREADS,
    ukBookUsdPerDay: UK_BOOK_USD_PER_DAY,
    krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY,
    minBookUsd: MIN_BOOK_USD,
    caps: { maxOrderUsd: MAX_ORDER_USD, liveRow: LIVE_ROW, fourCoinSet: FOUR },
    grids: { "trend-4h": { points: TREND_GRID.length, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [2, 3, 4], seeded: { fast: DEFAULT_TREND.fast, slow: DEFAULT_TREND.slow, atrStop: DEFAULT_TREND.atrStop } } },
    data: { symbols: LIVE_ROW.symbols, perSymbol: provenance },
  };

  // ── fidelity ───────────────────────────────────────────────────────────
  const fid: Record<string, unknown> = {
    runMarked: {
      note: "`runMarked` (the one copy of `run` in this file) against `backtest.ts`'s `run`, seeded parameters, every coin × every priced window × both venues × both stop rules × all three tapes — on EVERY field `RunResult` carries. A non-zero anywhere would mean the copy is not the original and nothing below could be read.",
      checks: fidChecks, worstAbsRetDiff: fidRet, worstAbsMaxDDDiff: fidDD, worstAbsTradeDiff: fidTrades,
      worstAbsDaysDiff: fidDays, worstAbsExposureDiff: fidExp, worstAbsFeesDiff: fidFees, worstAbsStopsHitDiff: fidStops,
    },
  };
  {
    // `combinePath`'s stats must be `combine`'s, and its path must reproduce the drawdown `combine` reports.
    let checks = 0, worstDD = 0, worstRet = 0;
    for (const reg of STOP_RULES) for (const tape of TAPES) for (const w of LIVE_WINDOWS) {
      const members = LIVE_ROW.symbols.filter((s) => cores[reg][tape][s]?.[w]?.revx);
      if (members.length < 2) continue;
      const sl = sleeveFromCores(members.map((s) => ({ symbol: s, r: cores[reg][tape][s][w].revx })), LIVE_ROW.capitalUsd, LIVE_ROW.symbols.length);
      const c = combine(sl), p = combinePath(sl);
      checks++;
      worstRet = Math.max(worstRet, Math.abs(c.ret - p.stats.ret));
      worstDD = Math.max(worstDD, Math.abs(c.maxDD - ddOf(p.stats.capitalUsd, p.equity)));
    }
    fid.combinePath = { note: "`combinePath` returns `combine`'s own stats and, separately, the equity path the drawdown decomposition reads. The path's own max drawdown must equal the one `combine` reports.", checks, worstAbsRetDiff: r4(worstRet), worstAbsDrawdownDiff: r4(worstDD) };
  }

  // ── V — the published figures, re-derived ──────────────────────────────
  const baselineByCond: Record<string, { per: Partial<Record<WinName, SleeveStats>>; worst: ReturnType<typeof worstOf> }> = {};
  const dropSuiByCond: Record<string, { per: Partial<Record<WinName, SleeveStats>>; worst: ReturnType<typeof worstOf> }> = {};
  for (const c of CONDITIONS) {
    const five = sleeveAcross(LIVE_ROW.symbols, c.reg, c.tape, "revx");
    const four = sleeveAcross(FOUR, c.reg, c.tape, "revx");
    baselineByCond[c.id] = { per: five.per, worst: worstOf(five.per) };
    dropSuiByCond[c.id] = { per: four.per, worst: worstOf(four.per) };
  }

  if (set2Path) {
    const sj = JSON.parse(await Deno.readTextFile(set2Path)) as Record<string, any>;
    const rows: Record<string, unknown>[] = [];
    let compared = 0;
    const base = sj.a1_theCoins?.baseline?.perCondition ?? {};
    const dropArm = (sj.a1_theCoins?.arms ?? []).find((a: any) => a.coin === "SUI/USD" && a.kind === "drop");
    for (const c of CONDITIONS) {
      for (const w of LIVE_WINDOWS) {
        const pub = base[c.id]?.perWindow?.[w];
        const here = baselineByCond[c.id].per[w];
        if (pub && here) for (const f of ["ret", "maxDD", "retOverDD"] as const) {
          compared++;
          const d = (here[f] as number) - (pub[f] as number);
          if (Math.abs(d) > 1e-9) rows.push({ arm: "baseline(5)", condition: c.id, window: w, field: f, published: pub[f], here: here[f], delta: r4(d) });
        }
        const pubD = dropArm?.perCondition?.[c.id]?.perWindow?.[w];
        const hereD = dropSuiByCond[c.id].per[w];
        if (pubD && hereD) for (const f of ["ret", "maxDD", "retOverDD"] as const) {
          compared++;
          const d = (hereD[f] as number) - (pubD[f] as number);
          if (Math.abs(d) > 1e-9) rows.push({ arm: "drop·SUI(4)", condition: c.id, window: w, field: f, published: pubD[f], here: hereD[f], delta: r4(d) });
        }
      }
    }
    fid.vsSet2 = { note: "every A1 cell this study re-derives — the five-coin baseline and the `drop·SUI` four-coin arm, four conditions × four windows × ret / maxDD / retOverDD — against the committed `set2.json`. Zero differences means this harness IS §3.19's on the cells that matter and every number below is the question being asked, not a different arithmetic.", file: set2Path, sha256: await sha(set2Path), cellsCompared: compared, differences: rows.length, rows: rows.slice(0, 40) };
  }
  if (tapePath) {
    const tj = JSON.parse(await Deno.readTextFile(tapePath)) as Record<string, any>;
    const rows: Record<string, unknown>[] = [];
    let compared = 0;
    const pcv = tj.t3_theBar?.perCoinVerdicts ?? {};
    for (const reg of STOP_RULES) for (const symbol of LIVE_ROW.symbols) for (const w of LIVE_WINDOWS) for (const v of VENUES) for (const tape of TAPES) {
      const pub = pcv[reg]?.[symbol]?.[w]?.[v]?.[tape];
      const here = cells[reg][tape][symbol]?.[w]?.[v];
      if (!pub || !here) continue;
      for (const [f, a, b] of [["seededPass", pub.seededPass, here.seededPass], ["chosenPass", pub.chosenPass, here.chosenPass], ["plateau", pub.plateau, here.plateau], ["seededRet", pub.seededOwn?.ret, here.seededOwn.ret], ["chosenRet", pub.chosenOwn?.ret, here.chosenOwn.ret]] as [string, unknown, unknown][]) {
        compared++;
        const differs = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-9 : a !== b;
        if (differs) rows.push({ stopRule: reg, symbol, window: w, venue: v, tape, field: f, published: a, here: b });
      }
    }
    fid.vsTape = { note: "every §4.15 bar verdict for the live five — two stop rules × two tapes × two venues × seeded and chosen, pass flags, plateau share and out-of-sample return — against the committed `tape.json`. This is the check that makes the §3.8-reproduction finding below a reproduction rather than a new claim.", file: tapePath, sha256: await sha(tapePath), cellsCompared: compared, differences: rows.length, rows: rows.slice(0, 40) };
  }
  report.fidelity = fid;

  // ── S0 — SUI's own record, and §3.8's verdict re-asked under the shipped stop ──
  {
    const perCoin: Record<string, unknown> = {};
    for (const symbol of LIVE_ROW.symbols) {
      const byCond: Record<string, unknown> = {};
      for (const reg of STOP_RULES) for (const tape of TAPES) {
        const id = `${reg}·${tape}`;
        const seeded: WinName[] = [], chosen: WinName[] = [];
        for (const w of LIVE_WINDOWS) {
          const c = cells[reg][tape][symbol]?.[w]?.revx;
          if (!c) continue;
          if (c.seededClears) seeded.push(w);
          if (c.chosenClears) chosen.push(w);
        }
        byCond[id] = { windowsPriced: LIVE_WINDOWS.filter((w) => cells[reg][tape][symbol]?.[w]?.revx), seededClears: seeded, chosenClears: chosen, clearsBothWalkForward: { seeded: seeded.includes("A") && seeded.includes("B"), chosen: chosen.includes("A") && chosen.includes("B") } };
      }
      perCoin[symbol] = byCond;
    }
    // §3.8's own regime — `trail`, CHOSEN parameters, the Coinbase tape — against the loop's.
    const s38 = (reg: StopRule, tape: Tape, how: "seeded" | "chosen") => {
      const c = (w: WinName) => cells[reg][tape]["SUI/USD"]?.[w]?.revx;
      const ok = (w: WinName) => { const x = c(w); return !!x && (how === "seeded" ? x.seededClears : x.chosenClears); };
      return { A: ok("A"), B: ok("B"), bothWindows: ok("A") && ok("B") };
    };
    report.s0_suiOwnRecord = {
      question: "Does §3.8's admission of SUI — 'only SUI and POL cleared both windows' — reproduce under the stop rule `tick.ts` actually runs?",
      method: "§4.15's four tests per window, the same grid, on Revolut X costs, with the UK-book test applied. Reported under both stop rules, both tapes, and both parameter points, never averaged.",
      perCoin,
      sui38Reproduction: {
        note: "§3.8 was run on 2026-09-21 morning, under the intra-bar 3×ATR trail §3.13 removed that afternoon, on the Coinbase tape, with parameters CHOSEN on each window's in-sample. That is the cell `trail·coinbase·chosen`.",
        "trail·coinbase·chosen": s38("trail", "coinbase", "chosen"),
        "trail·kraken·chosen": s38("trail", "kraken", "chosen"),
        "shipped·coinbase·chosen": s38("shipped", "coinbase", "chosen"),
        "shipped·kraken·chosen": s38("shipped", "kraken", "chosen"),
        "shipped·coinbase·seeded": s38("shipped", "coinbase", "seeded"),
        "shipped·kraken·seeded": s38("shipped", "kraken", "seeded"),
      },
    };
  }

  // ── S1 — the same question asked of all five coins on the windows they SHARE ──
  {
    const SHARED: WinName[] = ["A", "B"];
    const arms: Record<string, unknown>[] = [];
    for (const coin of LIVE_ROW.symbols) {
      const set = LIVE_ROW.symbols.filter((s) => s !== coin);
      const perCondition: Record<string, unknown> = {};
      let improvedShared = 0, improvedFour = 0, priced = 0;
      for (const c of CONDITIONS) {
        const arm = sleeveAcross(set, c.reg, c.tape, "revx");
        const basePer = baselineByCond[c.id].per;
        const wShared = worstOf(arm.per, SHARED), bShared = worstOf(basePer, SHARED);
        const wAll = worstOf(arm.per), bAll = worstOf(basePer);
        const dShared = r2(wShared.retOverDD - bShared.retOverDD), dAll = r2(wAll.retOverDD - bAll.retOverDD);
        priced++;
        if (dShared > 0) improvedShared++;
        if (dAll > 0) improvedFour++;
        perCondition[c.id] = {
          worstOfSharedWindows: { window: wShared.window, retOverDD: wShared.retOverDD, baselineWindow: bShared.window, baselineRetOverDD: bShared.retOverDD, delta: dShared },
          worstOfAllFour: { window: wAll.window, retOverDD: wAll.retOverDD, baselineWindow: bAll.window, baselineRetOverDD: bAll.retOverDD, delta: dAll },
          perWindow: Object.fromEntries(SHARED.map((w) => [w, arm.per[w] && basePer[w] ? { armRet: arm.per[w]!.ret, armDD: arm.per[w]!.maxDD, armRetOverDD: arm.per[w]!.retOverDD, baseRet: basePer[w]!.ret, baseDD: basePer[w]!.maxDD, baseRetOverDD: basePer[w]!.retOverDD, deltaRet: r4(arm.per[w]!.ret - basePer[w]!.ret), deltaDD: r4(arm.per[w]!.maxDD - basePer[w]!.maxDD), deltaRetOverDD: r2(arm.per[w]!.retOverDD - basePer[w]!.retOverDD) } : null])),
        };
      }
      arms.push({ arm: `drop·${coin.split("/")[0]}`, coin, coinSet: set, perCondition, conditionsPriced: priced, conditionsImprovedOnSharedWorst: improvedShared, conditionsImprovedOnFourWindowWorst: improvedFour, improvesAllOnSharedWorst: improvedShared === priced });
    }
    const passed = arms.filter((a) => (a as any).improvesAllOnSharedWorst).length;
    report.s1_symmetricLeaveOneOut = {
      question: "Judge every member on the windows it HAS, symmetrically. SUI has A and B; restricting EVERY leave-one-out to {A, B} is the only comparison in which the five coins are judged on identical evidence.",
      method: "the same A1 arms — the coin SET each drop proposes, seeded parameters, Revolut X costs, equal slots of capital ÷ |coins| so a 4-coin and a 5-coin arm are compared per unit of capital at risk — ranked by the worst of {A, B} instead of the worst of {A, B, C, D}. Both rankings are reported side by side for every arm.",
      whyItIsNotTheIncumbentRule: "restricting to {A, B} throws away the two windows that carry the most information about the OTHER four coins, and D is the window the live row loses in. This ranking is a like-for-like comparison of the five members, NOT a replacement for the four-window rule, and a coin that wins it has not cleared §4.15's bar.",
      sharedWindows: SHARED, arms,
      control: { arms: arms.length, passedAllConditions: passed, independentNull: r3(arms.length * Math.pow(0.5, CONDITIONS.length)), correlatedNull: r3(arms.length * 0.5), note: "five arms, four near-duplicate conditions. The independent null treats the four as four coin flips; the correlated null treats them as one. `set2.json` measured the agreement between the conditions at 0.72, so the correlated null is the one to read." },
    };
  }

  // ── S2 — the contiguous spans where all five coins exist ────────────────
  type SpanDef = { id: string; what: string; fromTs: number; toTs: number };
  const spans: SpanDef[] = [];
  {
    // The full SUI era: from the first bar at which the SEEDED rule can decide on every coin, to the end of the common tape.
    const starts = LIVE_ROW.symbols.map((s) => { const a = series[s].coinbase.c4h; return a[Math.min(a.length - 1, DEFAULT_TREND.slow + 1)].start; });
    const ends = LIVE_ROW.symbols.map((s) => { const a = series[s].coinbase.c4h; return a[a.length - 1].start; });
    const fromTs = Math.max(...starts), toTs = Math.min(...ends) + 4 * 3600e3;
    spans.push({ id: "S_full", what: `every bar on which the seeded rule can decide on all five coins: ${isoDay(fromTs)} → ${isoDay(toTs)}. SUI's tape is the binding constraint at the front.`, fromTs, toTs });
    // The two walk-forward out-of-sample years, joined: B's OOS ends exactly where A's begins.
    const wA = series["BTC/USD"].wins.find((w) => w.name === "A")!, wB = series["BTC/USD"].wins.find((w) => w.name === "B")!;
    const comb = series["BTC/USD"].coinbase.c4h;
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    spans.push({ id: "S_oos", what: `windows B and A joined — the two consecutive out-of-sample years the walk-forward already declares, priced as ONE equity curve instead of two: ${isoDay(comb[wB.oosFrom].start)} → ${isoDay(endTs(comb, wA.oosTo))}`, fromTs: comb[wB.oosFrom].start, toTs: endTs(comb, wA.oosTo) });
  }

  /** Price one coin over a calendar span on one arm, at the seeded point, with an optional cost override. */
  function spanRun(symbol: string, tape: Tape, reg: StopRule, fromTs: number, toTs: number, venue: Venue, costOverride?: Costs): MarkedResult | null {
    const arm = series[symbol][armOf(tape)];
    if (!arm.c4h.length) return null;
    const from = indexAtOrAfter(arm.c4h, fromTs), to = indexAtOrAfter(arm.c4h, toTs);
    if (to - from < 30) return null;
    return runMarked("trend-4h", symbol, arm.c4h, arm.daily, from, to, DEFAULT_TREND, costOverride ?? COSTS[venue], 4, stopsOf(reg, DEFAULT_TREND));
  }
  function spanSleeve(coinSet: string[], tape: Tape, reg: StopRule, fromTs: number, toTs: number, capitalUsd: number, slots: number, costFor?: (s: string) => Costs) {
    const rs: { symbol: string; r: MarkedResult }[] = [];
    for (const s of coinSet) { const r = spanRun(s, tape, reg, fromTs, toTs, "revx", costFor ? costFor(s) : undefined); if (r) rs.push({ symbol: s, r }); }
    if (rs.length < 2) return null;
    return { path: combinePath(sleeveFromCores(rs, capitalUsd, slots)), members: rs.map((x) => x.symbol), per: Object.fromEntries(rs.map((x) => [x.symbol, pick(x.r)])) };
  }

  {
    const out: Record<string, unknown> = {};
    for (const sp of spans) {
      const byCond: Record<string, unknown> = {};
      for (const c of [...CONDITIONS, { reg: "shipped" as StopRule, tape: "revxuk" as Tape, id: "shipped·revxuk" }, { reg: "trail" as StopRule, tape: "revxuk" as Tape, id: "trail·revxuk" }]) {
        // The venue's own book only reaches 2025-09-11; over an earlier span the arm is mostly Kraken bars, so it is priced only where it covers.
        if (c.tape === "revxuk" && sp.fromTs < new Date("2025-09-11T00:00:00Z").getTime()) continue;
        const five = spanSleeve(LIVE_ROW.symbols, c.tape, c.reg, sp.fromTs, sp.toTs, LIVE_ROW.capitalUsd, 5);
        const four = spanSleeve(FOUR, c.tape, c.reg, sp.fromTs, sp.toTs, LIVE_ROW.capitalUsd, 4);
        if (!five || !four) continue;
        // The THIRD option nobody prices: drop SUI and do NOT resize the slot. $80 at risk, $20 idle, `max_order_usd` untouched.
        const fourIdle = spanSleeve(FOUR, c.tape, c.reg, sp.fromTs, sp.toTs, LIVE_ROW.capitalUsd * 0.8, 4);
        byCond[c.id] = {
          five: { ...five.path.stats, slotUsd: r2(LIVE_ROW.capitalUsd / 5), members: five.members },
          fourRescaled: { ...four.path.stats, slotUsd: r2(LIVE_ROW.capitalUsd / 4), members: four.members, note: "drop SUI and raise the slot to $25 — what `set2.json`'s A1 arm prices. Needs `max_order_usd` raised from $20." },
          fourSameSlot: fourIdle ? { ...fourIdle.path.stats, capitalAtRiskUsd: r2(LIVE_ROW.capitalUsd * 0.8), slotUsd: r2(LIVE_ROW.capitalUsd / 5), accountRet: r4(fourIdle.path.stats.pnlUsd / LIVE_ROW.capitalUsd), accountMaxDD: r4(ddOf(LIVE_ROW.capitalUsd, fourIdle.path.equity.map((e) => e + LIVE_ROW.capitalUsd * 0.2))), note: "drop SUI and leave the slot at $20 — $80 at risk, $20 idle, no parameter changed. Return and drawdown are shown on the WHOLE $100 account." } : null,
          deltaFiveMinusFourRescaled: { ret: r4(five.path.stats.ret - four.path.stats.ret), maxDD: r4(five.path.stats.maxDD - four.path.stats.maxDD), retOverDD: r2(five.path.stats.retOverDD - four.path.stats.retOverDD), pnlUsd: r2(five.path.stats.pnlUsd - four.path.stats.pnlUsd) },
          deltaFiveMinusFourSameSlot: fourIdle ? { pnlUsd: r2(five.path.stats.pnlUsd - fourIdle.path.stats.pnlUsd), accountRet: r4(five.path.stats.ret - fourIdle.path.stats.pnlUsd / LIVE_ROW.capitalUsd) } : null,
          perCoin: five.per,
        };
      }
      out[sp.id] = { what: sp.what, from: isoDay(sp.fromTs), to: isoDay(sp.toTs), years: r2((sp.toTs - sp.fromTs) / YEAR_MS), byCondition: byCond };
    }
    report.s2_theSpanWhereAllFiveExist = {
      question: "Over the exact span where all five coins exist, is the five-coin sleeve better or worse than the four-coin one — in return, drawdown and ret/DD?",
      method: "one continuous seeded run per coin over the span (no parameter is chosen anywhere in it), combined by `combine` at equal slots. Three allocations are priced, because the live row has a $20 `max_order_usd` and the published A1 arm silently assumes it is raised: five $20 slots, four $25 slots, and four $20 slots with $20 idle.",
      caveat: "the seeded point is out of sample here in the sense that matters — it was fixed long before any of these windows and nothing in this span chose it — but it is not an untouched hold-out: it is the point every table in this repository already reports, and this span overlaps windows A, B and (for the four-coin members) part of C.",
      spans: out,
    };
  }

  // ── S3 — consecutive six-month folds over the SUI era ──────────────────
  {
    const FOLD_DAYS = 182;
    const sFull = spans.find((s) => s.id === "S_full")!;
    const folds: { id: number; fromTs: number; toTs: number }[] = [];
    for (let t = sFull.fromTs, i = 1; t + FOLD_DAYS * 86400e3 <= sFull.toTs; t += FOLD_DAYS * 86400e3, i++) folds.push({ id: i, fromTs: t, toTs: t + FOLD_DAYS * 86400e3 });
    const byCond: Record<string, unknown> = {};
    const allRows: Record<string, unknown>[] = [];
    for (const c of CONDITIONS) {
      const rows: Record<string, unknown>[] = [];
      for (const f of folds) {
        const five = spanSleeve(LIVE_ROW.symbols, c.tape, c.reg, f.fromTs, f.toTs, LIVE_ROW.capitalUsd, 5);
        const four = spanSleeve(FOUR, c.tape, c.reg, f.fromTs, f.toTs, LIVE_ROW.capitalUsd, 4);
        const sui = spanRun("SUI/USD", c.tape, c.reg, f.fromTs, f.toTs, "revx");
        if (!five || !four) continue;
        const row = {
          fold: f.id, from: isoDay(f.fromTs), to: isoDay(f.toTs),
          fiveRet: five.path.stats.ret, fiveDD: five.path.stats.maxDD, fiveRetOverDD: five.path.stats.retOverDD,
          fourRet: four.path.stats.ret, fourDD: four.path.stats.maxDD, fourRetOverDD: four.path.stats.retOverDD,
          deltaRet: r4(five.path.stats.ret - four.path.stats.ret), deltaDD: r4(five.path.stats.maxDD - four.path.stats.maxDD), deltaRetOverDD: r2(five.path.stats.retOverDD - four.path.stats.retOverDD),
          suiOwnRet: sui ? r4(sui.ret) : null, suiOwnDD: sui ? r4(sui.maxDD) : null, suiTrades: sui ? sui.trades : null,
          fivePositive: five.path.stats.ret > 0, fourPositive: four.path.stats.ret > 0,
        };
        rows.push(row); allRows.push({ condition: c.id, ...row });
      }
      const dRet = rows.map((r) => r.deltaRet as number), dDD = rows.map((r) => r.deltaDD as number), dRD = rows.map((r) => r.deltaRetOverDD as number);
      byCond[c.id] = {
        folds: rows,
        summary: {
          foldsPriced: rows.length,
          fiveBetterOnReturn: signTest(dRet.filter((x) => x > 0).length, dRet.filter((x) => x < 0).length),
          fiveLowerDrawdown: signTest(dDD.filter((x) => x < 0).length, dDD.filter((x) => x > 0).length),
          fiveBetterOnRetOverDD: signTest(dRD.filter((x) => x > 0).length, dRD.filter((x) => x < 0).length),
          deltaReturnErrorBar: (() => {
            const n = dRet.length, m = mean(dRet);
            const sd = n > 1 ? Math.sqrt(dRet.reduce((a, x) => a + (x - m) * (x - m), 0) / (n - 1)) : NaN;
            const se = sd / Math.sqrt(Math.max(1, n));
            return { folds: n, meanDeltaRet: r4(m), sdAcrossFolds: r4(sd), standardError: r4(se), tStatistic: r2(m / se), note: "the six folds are the only error bar this data supports on the span delta. |t| under ~2.6 at 5 degrees of freedom is inside noise." };
          })(),
          medianDeltaRet: r4(median(dRet)), medianDeltaDD: r4(median(dDD)), medianDeltaRetOverDD: r2(median(dRD)),
          foldsFivePositive: rows.filter((r) => r.fivePositive).length, foldsFourPositive: rows.filter((r) => r.fourPositive).length,
          suiOwnPositiveFolds: rows.filter((r) => ((r.suiOwnRet as number | null) ?? 0) > 0).length,
        },
      };
    }
    const dRetAll = allRows.map((r) => r.deltaRet as number), dDDAll = allRows.map((r) => r.deltaDD as number);
    report.s3_sixMonthFolds = {
      question: "Rolling six-month folds over SUI's whole history — a finer-grained record than two windows, and the instrument §4.22 already uses on this repository's own coins.",
      method: `consecutive non-overlapping ${FOLD_DAYS}-day folds over S_full, each priced as its own seeded run starting FLAT, five-coin sleeve against four-coin sleeve, per condition. The sign test is exact and two-sided; ties are dropped.`,
      caveat: "folds are consecutive and non-overlapping, so they are as independent as this data gets — but they are the SAME five coins in a market that moved together, so a fold is not a fresh draw. Every fold starts flat, which costs whichever sleeve was holding across the boundary; that penalty falls on both sleeves.",
      foldDays: FOLD_DAYS, foldCount: folds.length, byCondition: byCond,
      pooled: {
        note: "all four conditions pooled. They are near-duplicates, so this is reported for its median and NOT read as 4× the evidence — the per-condition sign tests above are the ones with a valid null.",
        observations: allRows.length,
        medianDeltaRet: r4(median(dRetAll)), medianDeltaDD: r4(median(dDDAll)),
        fiveBetterOnReturn: dRetAll.filter((x) => x > 0).length, fiveLowerDrawdown: dDDAll.filter((x) => x < 0).length,
      },
    };
  }

  // ── S4 — what SUI does to DRAWDOWN ─────────────────────────────────────
  {
    const out: Record<string, unknown> = {};
    for (const sp of spans) {
      const byCond: Record<string, unknown> = {};
      for (const c of CONDITIONS) {
        const five = spanSleeve(LIVE_ROW.symbols, c.tape, c.reg, sp.fromTs, sp.toTs, LIVE_ROW.capitalUsd, 5);
        const four = spanSleeve(FOUR, c.tape, c.reg, sp.fromTs, sp.toTs, LIVE_ROW.capitalUsd, 4);
        const sui = spanRun("SUI/USD", c.tape, c.reg, sp.fromTs, sp.toTs, "revx");
        if (!five || !four || !sui) continue;
        // The four-coin sleeve at the SAME slot as the five-coin one, so the only difference is SUI's $20.
        const fourAtSameSlot = spanSleeve(FOUR, c.tape, c.reg, sp.fromTs, sp.toTs, LIVE_ROW.capitalUsd * 0.8, 4);
        const suiRets = dailyReturns(sui.marks);
        const days = fourAtSameSlot ? fourAtSameSlot.path.days : [];
        const fourDaily = fourAtSameSlot ? fourAtSameSlot.path.pnl : [];
        const suiDaily = days.map((d) => (LIVE_ROW.capitalUsd / 5) * (suiRets.get(d) ?? 0));
        const corr = pearson(fourDaily, suiDaily);
        // The worst day and the worst drawdown of the five-coin sleeve, attributed.
        const fivePnl = five.path.pnl, fiveDays = five.path.days;
        let worstIdx = 0;
        for (let i = 1; i < fivePnl.length; i++) if (fivePnl[i] < fivePnl[worstIdx]) worstIdx = i;
        const suiShareOfWorstDay = fivePnl[worstIdx] !== 0 ? r3((five.path.perSleevePnl["SUI/USD"]?.[worstIdx] ?? 0) / fivePnl[worstIdx]) : null;
        // Days SUI is the only member carrying the sleeve: the other four contribute ~nothing and SUI does not.
        const carried = days.filter((_, i) => Math.abs(fourDaily[i]) < 1e-9 && Math.abs(suiDaily[i]) > 1e-9);
        const carriedPnl = days.reduce((a, _d, i) => Math.abs(fourDaily[i]) < 1e-9 ? a + suiDaily[i] : a, 0);
        byCond[c.id] = {
          fiveDD: five.path.stats.maxDD, fourRescaledDD: four.path.stats.maxDD,
          fourSameSlotDD: fourAtSameSlot ? fourAtSameSlot.path.stats.maxDD : null,
          suiStandalone: { ret: r4(sui.ret), maxDD: r4(sui.maxDD), trades: sui.trades, exposure: r3(sui.exposure), stopsHit: sui.stopsHit ?? 0 },
          dampingAtEqualRisk: fourAtSameSlot ? {
            note: "the honest damping test: add SUI's $20 to a four-coin sleeve that keeps its $20 slots, so the ONLY change is SUI's presence. If SUI damps, the five-coin drawdown as a fraction of a LARGER book should fall.",
            fourSameSlotDDOn80: fourAtSameSlot.path.stats.maxDD,
            fiveDDOn100: five.path.stats.maxDD,
            fourSameSlotDollarDD: r2(fourAtSameSlot.path.stats.maxDD * 80), fiveDollarDD: r2(five.path.stats.maxDD * 100),
            dollarDDAdded: r2(five.path.stats.maxDD * 100 - fourAtSameSlot.path.stats.maxDD * 80),
            pnlAdded: r2(five.path.stats.pnlUsd - fourAtSameSlot.path.stats.pnlUsd),
          } : null,
          dailyReturnCorrelationWithTheOtherFour: corr == null ? null : r3(corr),
          daysCompared: days.length,
          daysSuiMovedWhileTheOtherFourDidNot: carried.length,
          pnlOnThoseDaysUsd: r2(carriedPnl),
          suiShareOfTheSleevesWorstDay: suiShareOfWorstDay,
          worstDayUsd: { five: five.path.stats.worstDayUsd, fourRescaled: four.path.stats.worstDayUsd },
        };
      }
      out[sp.id] = { from: isoDay(sp.fromTs), to: isoDay(sp.toTs), byCondition: byCond };
    }
    report.s4_whatSuiDoesToDrawdown = {
      question: "If SUI's contribution is damping rather than return, measure the damping directly and say whether the sleeve needs it.",
      method: "three comparisons on each span: the five-coin sleeve against the four-coin sleeve RESCALED (same money, bigger slots) and against the four-coin sleeve at the SAME slot (less money, SUI's $20 simply absent) — the second isolates SUI's marginal contribution — plus the correlation of SUI's daily slot P&L with the other four's, and SUI's share of the sleeve's single worst day.",
      spans: out,
    };
  }

  // ── S5 — the spread SUI actually trades at ─────────────────────────────
  {
    const sFull = spans.find((s) => s.id === "S_full")!, sOos = spans.find((s) => s.id === "S_oos")!;
    const out: Record<string, unknown> = {};
    for (const sp of [sOos, sFull]) {
      const byCond: Record<string, unknown> = {};
      for (const c of CONDITIONS) {
        const arms: Record<string, unknown> = {};
        for (const hs of SUI_HALF_SPREADS) {
          const costFor = (s: string): Costs => s === "SUI/USD" ? { ...COSTS.revx, halfSpread: { ...COSTS.revx.halfSpread, "SUI/USD": hs.halfSpread } } : COSTS.revx;
          const five = spanSleeve(LIVE_ROW.symbols, c.tape, c.reg, sp.fromTs, sp.toTs, LIVE_ROW.capitalUsd, 5, costFor);
          const sui = spanRun("SUI/USD", c.tape, c.reg, sp.fromTs, sp.toTs, "revx", costFor("SUI/USD"));
          const four = spanSleeve(FOUR, c.tape, c.reg, sp.fromTs, sp.toTs, LIVE_ROW.capitalUsd, 4);
          if (!five || !sui || !four) continue;
          arms[hs.id] = {
            what: hs.what, roundTripBps: r2(hs.halfSpread * 2 * 1e4 + 2 * COSTS.revx.takerBps),
            fiveRet: five.path.stats.ret, fiveDD: five.path.stats.maxDD, fiveRetOverDD: five.path.stats.retOverDD,
            suiOwnRet: r4(sui.ret), suiOwnDD: r4(sui.maxDD), suiTrades: sui.trades,
            deltaVsFourRescaled: { ret: r4(five.path.stats.ret - four.path.stats.ret), retOverDD: r2(five.path.stats.retOverDD - four.path.stats.retOverDD) },
          };
        }
        byCond[c.id] = arms;
      }
      out[sp.id] = { from: isoDay(sp.fromTs), to: isoDay(sp.toTs), byCondition: byCond };
    }
    report.s5_theSpreadSuiActuallyTradesAt = {
      question: "SUI's seat rests on a 23.94 bps spread measured on 2026-09-21. §4.19 measured 25.7 bps at the touch the next day and §4.20 measured 23.7. Does the answer move when SUI is priced at the spread that was actually measured, or at §3.8's doubled stress?",
      method: "the five-coin sleeve re-priced with ONLY SUI's half-spread changed; the other four keep `COSTS.revx`. The four-coin comparison is unchanged by construction, so the delta is entirely SUI's cost.",
      spans: out,
    };
  }

  // ── S6 — the window SUI does not have, probed below the floor ──────────
  //
  // §3.15 reports that SUI's window C, "probed below the declared 180-day
  // in-sample floor and counted nowhere", reads −17.2 % on a 0 % plateau. That
  // claim is load-bearing — it is the only evidence anyone has about SUI
  // outside windows A and B — and it has never been reproduced. It is
  // reproduced here, under the SAME protest: the floor exists because a rule
  // with a 100-bar slow average and a 55-bar breakout cannot be fitted on 142
  // days without fitting the noise, so this number is a probe and not a window.
  {
    const out: Record<string, unknown> = {};
    const symbol = "SUI/USD";
    for (const reg of STOP_RULES) for (const tape of TAPES) {
      const s = series[symbol];
      const comb = s.coinbase.c4h, cb = s.cb4h;
      const nCb = cb.length, t1 = Math.floor(nCb / 3);
      const z = indexAtOrAfter(comb, cb[0].start), T1 = indexAtOrAfter(comb, cb[t1].start);
      const Zc = indexAtOrAfter(comb, cb[0].start - 2 * YEAR_MS);   // clamps to 0: SUI's tape is younger
      const isDays = z > Zc ? (comb[z - 1].start - comb[Zc].start) / 86400e3 : 0;
      const arm = series[symbol][armOf(tape)];
      const isFrom = indexAtOrAfter(arm.c4h, comb[Zc].start), isTo = indexAtOrAfter(arm.c4h, comb[z].start);
      const oosFrom = indexAtOrAfter(arm.c4h, comb[z].start), oosTo = indexAtOrAfter(arm.c4h, comb[T1].start);
      const isRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, arm.c4h, arm.daily, isFrom, isTo, p, c, 4, stopsOf(reg, p));
      const oosRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, arm.c4h, arm.daily, oosFrom, oosTo, p, c, 4, stopsOf(reg, p));
      const cell = studyVenue(symbol, "revx", isRun, oosRun);
      out[`${reg}·${tape}`] = {
        inSampleDays: Number(isDays.toFixed(1)), inSampleBars: isTo - isFrom, floorDays: MIN_IN_SAMPLE_DAYS,
        underTheFloorBy: Number((MIN_IN_SAMPLE_DAYS - isDays).toFixed(1)),
        oosFrom: iso(arm.c4h[oosFrom].start), oosTo: iso(arm.c4h[Math.min(arm.c4h.length - 1, oosTo)].start),
        chosen: cell.chosen, chosenOwn: cell.chosenOwn, seededOwn: cell.seededOwn,
        plateauPositiveShare: cell.plateau, chosenPass: cell.chosenPass, seededPass: cell.seededPass, seededFailed: cell.seededFailed,
      };
    }
    report.s6_theWindowSuiDoesNotHave = {
      question: "§3.15 says SUI's window C, probed below the 180-day in-sample floor, reads −17.2 % on a 0 % plateau. Does that reproduce?",
      why: "it is the only evidence about SUI outside windows A and B, it is quoted as settling the question, and it has never been re-derived.",
      protest: "this is a PROBE, not a window. The in-sample is under half the declared floor, which exists because a rule with a 100-bar slow average and a 55-bar breakout cannot be honestly fitted on it. A pass here would not admit SUI and a failure here does not convict it. Window D remains impossible at any floor: SUI's tape begins after D's out-of-sample ends.",
      perCondition: out,
    };
  }

  // ── the control ────────────────────────────────────────────────────────
  {
    const s1Arms = 5;
    const s2Arms = spans.length * (CONDITIONS.length) * 2;   // two allocations of the four-coin alternative per span-condition
    const s3Arms = CONDITIONS.length;                        // one sign test per condition
    const s5Arms = SUI_HALF_SPREADS.length * spans.length * CONDITIONS.length;
    report.multipleComparisons = {
      note: "Every number above is a comparison between two fixed coin sets. There is no search: no parameter is chosen, no coin is ranked into or out of the set by a result, and the only 'arms' are the alternatives to SUI's seat that were declared before any figure was read. The count is stated so the reader can price it anyway.",
      declaredBeforeAnyNumber: ["S1 — five leave-one-out arms on the shared windows", "S2 — three allocations over two spans", "S3 — consecutive six-month folds, one sign test per condition", "S4 — a drawdown decomposition, no pass/fail test", "S5 — four spread arms"],
      arms: { s1: s1Arms, s2: s2Arms, s3: s3Arms, s5: s5Arms, total: s1Arms + s2Arms + s3Arms + s5Arms },
      gridPointsEvaluated: gridArms,
      nullForS1: { independent: r3(s1Arms * Math.pow(0.5, CONDITIONS.length)), correlated: r3(s1Arms * 0.5), which: "correlated — `set2.json` measured the agreement between the four conditions at 0.72" },
      nullForS3: "each condition's sign test carries its own exact two-sided null at p = 0.5; with six folds the smallest attainable two-sided p is 0.031, so a clean 6-0 is the only result that can reach 0.05 and a 5-1 cannot.",
      whatChanceGivesOnSuiOwnRecord: {
        note: "§4.15's own control, recomputed: across the 93 coin-window cells priced under the shipped stop on Revolut X costs at the seeded point with both tapes agreeing, 26 clear the bar — a per-window pass rate of 0.280. SUI has TWO windows priced.",
        perWindowPassRate: 0.28,
        pAtLeastOneOfTwoByChance: r3(1 - Math.pow(1 - 0.28, 2)),
        reading: "a one-of-two record is what chance gives just under half the time. SUI's single window is not evidence for its seat and its single failure is not evidence against it.",
      },
    };
  }

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error("backtest.ts changed during the run — every number above is from two different files");
  report.sourceIntegrity = { backtestTsSha256: btHashStart, stableAcrossRun: true, note: "`backtest.ts` is hashed at the start and the end of the run; a run that straddles an edit throws rather than publishing a mixture." };

  await Deno.writeTextFile(`${outDir}/sui.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/sui.json`);
}
