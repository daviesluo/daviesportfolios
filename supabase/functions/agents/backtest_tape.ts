// The TAPE study: every published backtest in this repository prices a signal
// the live loop does not compute. `signal_venue` is `kraken` on every
// `agent_strategies` row (`0037`), so the loop reads KRAKEN's candles to decide
// and executes on Revolut X — and every table in `docs/agents/reference.md` is
// priced on COINBASE candles. §3.14 measured the gap on 36 comparisons (median
// 2.5 points, max 68, 2 sign flips) and stopped there. This study re-prices the
// load-bearing conclusions on the tape the loop actually reads. Run by hand:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_tape.ts \
//     --data    <dir with BTC-USD_1h_3y.json …>        (Coinbase Exchange hourly)
//     --ext     <dir with BTC-USD_1h_kraken.json …>    (Kraken quarterly bundle, hourly)
//     --ktape   <dir with BTC-USD_4h_kraken.json …>    (Kraken's own 4h tape, full span)
//     --windows docs/agents/backtests/windows.json     (optional cross-check)
//     --out     docs/agents/backtests
//
// Writes `<out>/tape.json` and NOTHING else.
//
// ── the two arms ──────────────────────────────────────────────────────
//
// Everything below is run TWICE over the same calendar, changing only the
// price series:
//
//   `coinbase` — exactly what `backtest_windows.ts` builds: Kraken's bundle
//                spliced strictly BEFORE the Coinbase series' first bar,
//                Coinbase's from there on. This is the tape every published
//                table used, and reproducing it is what makes the other arm
//                mean anything. `fidelity.publishedWindows` is the proof.
//   `kraken`    — Kraken's own 4-hour tape end to end: the same quarterly
//                bundle resampled to 4 h, plus the public keyless OHLC
//                endpoint for 2026-07-01 → 2026-09-21, which the bundle
//                predates. Over the 222 bars the two sources share they agree
//                to 0.0000 bps median AND max on all 27 coins — the same tape,
//                joined, not two tapes averaged.
//
// A consequence worth stating before any number: windows C and D are ALREADY
// Kraken-priced in part. C chooses its parameters on the extension (Kraken)
// and scores on the first Coinbase third; D is Kraken end to end. So only
// windows A, B and C's out-of-sample spans can differ between the arms at all,
// and window D must come out bit-identical — `fidelity.windowD` checks that it
// does, and a non-zero there would mean the harness is wrong.
//
// ── what is imported and what is copied ───────────────────────────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`
// and `spreadOf`, and the live rulebooks in `_shared/agents_strategy.ts`, are
// IMPORTED. ONE copy exists, `runMarked`, taken from `run` line by line; it
// adds a mark at EVERY bar and the traded weight, which the sleeve arithmetic
// needs (`run` samples its curve every sixth bar, and WHICH bar that is
// depends on where the array starts — which is exactly what changes between
// the two arms, so `run`'s own curve cannot be used to compare them).
// `runMarked` IS `run` otherwise, and `fidelity.runMarked` is the proof:
// every coin × window × venue × stop rule × ARM, return, drawdown and trades.
//
// `combine`, `dailyMarks`, `plateauOf`, `barTests`, `windowsOn`,
// `intersectionDistribution` and the correlation helpers are copied from
// `backtest_windows.ts` / `backtest_portfolio.ts`, which do not export them:
// they do arithmetic on OUTPUTS and touch no price and no fee.
//
// ── determinism ───────────────────────────────────────────────────────
//
// There is no `ran_at` field and no runtime field. Re-running over the same
// three data directories writes `tape.json` byte for byte identical. The one
// place chance appears — the null of §W3 — is computed exactly, never sampled.
// `backtest.ts` is SHA-256'd at the start and the end of the run, as
// `backtest_windows.ts` does, and a run that straddles an edit throws.

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

/** The overlap test `backtest_windows.ts` declared before it compared the two sources, kept identical here. */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
/** A window is only scored when its in-sample has at least this many days to choose on. Same floor as §3.15. */
const MIN_IN_SAMPLE_DAYS = 180;
/** The floor plus the 3×ATR(14) intra-bar trail — what §3.7 / §3.8 / §3.10 / §3.11 were computed under. */
const PINNED_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };

// ───────────────────────────────────────────────────────────── the simulator

type MarkedResult = RunResult & {
  /** Σ over fills of the notional traded in units of the slot (an entry and an exit each count once). */
  tradedWeight: number;
  /** The mark at EVERY bar, so a day's mark does not depend on where the array starts. */
  marks: [number, number][];
};

/**
 * `backtest.ts`'s `run`, with a mark recorded at every bar and the traded
 * weight accumulated. Everything that costs money is COPIED FROM `run` LINE BY
 * LINE: the entry and rule exit at the next bar's open ± the half-spread paying
 * `fillFee`; the floor under average cost and the ATR trail from the high since
 * entry, read against the next bar's low and filled at the level (or the open
 * when the bar gaps through it); the high-water mark advanced by each bar's
 * high; the two-bar cooldown after ANY exit; and the same return, drawdown,
 * trade-count, exposure and day arithmetic.
 *
 * It exists because `run` samples its equity curve at `i % 6 === 0`, and which
 * CALENDAR bar that is depends on where the array starts — which is precisely
 * what differs between this study's two arms. `fidelity.runMarked` is the proof
 * that it is otherwise `run`.
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
 * The exact two-sided sign test: under "the two tapes are exchangeable" each
 * non-zero difference is a fair coin, so the count of positives is Binomial(m,
 * ½) and the p-value is the total mass of outcomes no more likely than the one
 * observed. Computed exactly, never sampled.
 */
function signTest(pos: number, neg: number): { positives: number; negatives: number; ties: number; pTwoSided: number } {
  const m = pos + neg;
  if (m === 0) return { positives: pos, negatives: neg, ties: 0, pTwoSided: 1 };
  const k = Math.min(pos, neg);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(m, i) - m * Math.LN2);
  return { positives: pos, negatives: neg, ties: 0, pTwoSided: Number(Math.min(1, 2 * tail).toFixed(6)) };
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

/** Annualised standard deviation of 4-hour log returns over a span — the volatility column of §T1. */
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
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const windowsPath = args.windows ? String(args.windows) : "";
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  if (!extDir) throw new Error("--ext <dir with BTC-USD_1h_kraken.json …> is required");
  if (!kDir) throw new Error("--ktape <dir with BTC-USD_4h_kraken.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  const sha = async (u: URL | string) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(u));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btPath = new URL("./backtest.ts", import.meta.url);
  const btHashStart = await sha(btPath);

  // Every coin with a MEASURED half-spread on BOTH venues and a file in all three directories.
  const priced = Object.keys(COSTS.revx.halfSpread).filter((s) => COSTS.kraken.halfSpread[s] != null).sort();
  const haveData = new Set<string>(), haveExt = new Set<string>(), haveK = new Set<string>();
  for await (const e of Deno.readDir(dataDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_3y\.json$/); if (m) haveData.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(extDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_kraken\.json$/); if (m) haveExt.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(kDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_4h_kraken\.json$/); if (m) haveK.add(`${m[1]}/USD`); }
  const candidates = priced.filter((s) => haveData.has(s) && haveExt.has(s) && haveK.has(s));
  const missingTape = priced.filter((s) => !haveK.has(s));
  console.log(`candidates (${candidates.length}): ${candidates.join(", ")}`);

  let extPairs: Record<string, string> = {};
  try {
    const pv = JSON.parse(await Deno.readTextFile(`${extDir}/provenance.json`)) as Record<string, { krakenPair: string }>;
    extPairs = Object.fromEntries(Object.entries(pv).map(([k, v]) => [k, v.krakenPair]));
  } catch { /* the pair name is cosmetic */ }
  let tapeProv: Record<string, Record<string, unknown>> = {};
  try { tapeProv = JSON.parse(await Deno.readTextFile(`${kDir}/provenance.json`)); } catch { /* optional */ }

  // ── build both arms ────────────────────────────────────────────────────
  type Arm = { c4h: Candle[]; daily: Candle[]; is4h: Candle[]; isDaily: Candle[] };
  type Series = {
    coinbase: Arm; kraken: Arm; cb4h: Candle[]; wins: Win[];
    krakenGapsInSpan: number; overlap: ReturnType<typeof tapeAgreement>;
    /** Per window: can the Kraken tape price this span at all? Written down before any number was looked at. */
    krakenCoverage: Record<string, { covered: boolean; why: string }>;
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
    const spliceAt = cbH[0].start;

    const cb4h = resample(cbH, 4);
    const combH = [...kH.filter((c) => c.start < spliceAt), ...cbH];
    const comb4h = resample(combH, 4), combDaily = resample(combH, 24);
    const cbDaily = resample(cbH, 24);
    // The Kraken arm's "in-sample series for windows A and B": the SAME cold start the published
    // tables used — the array begins at the Coinbase series' first bar, so the 30 daily closes the
    // momentum gate needs are absent for the first weeks exactly as they are on the other arm.
    const zK = indexAtOrAfter(kTape, spliceAt);
    const kIs4h = kTape.slice(zK);
    const kDaily = resample(kTape, 24);
    const kIsDaily = kDaily.filter((c) => c.start >= (kIs4h.length ? kIs4h[0].start : Infinity));

    const wins = windowsOn(comb4h, cb4h, MAX_LOOKBACK);
    // ── the Kraken-tape coverage rule, declared before the numbers ──────
    // A window is priced on the Kraken arm ONLY when Kraken's own tape spans
    // the whole of it — first bar at or before the in-sample start, last bar
    // at or after the out-of-sample end — and still leaves more bars than the
    // widest lookback at each end. A coin listed on Kraken AFTER its Coinbase
    // series began (HBAR, BNB, TON, HYPE) has windows the loop's own tape
    // simply cannot see, and those are dropped from BOTH arms rather than
    // priced on a shorter span: a comparison between two different calendars
    // is not a comparison. Every drop is recorded with its reason.
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
    // The same acceptance test the third-window study declared: a coin whose overlap does not match
    // is dropped rather than explained.
    const ov4h = tapeAgreement(cb4h, kTape, cb4h[0].start, cb4h[cb4h.length - 1].start + 4 * 3600e3);
    const rejected: string[] = [];
    if (!ov4h.sharedBars || ov4h.sharedBars < 100) rejected.push(`overlap is ${ov4h.sharedBars} 4h bars — too few to verify`);
    else {
      if ((ov4h.medianBps ?? 0) > OVERLAP_MEDIAN_MAX_BPS) rejected.push(`overlap median ${ov4h.medianBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`);
      if ((ov4h.p95Bps ?? 0) > OVERLAP_P95_MAX_BPS) rejected.push(`overlap p95 ${ov4h.p95Bps} bps > ${OVERLAP_P95_MAX_BPS}`);
    }
    let gaps = 0;
    for (let i = 1; i < kTape.length; i++) if (kTape[i].start >= cb4h[0].start && kTape[i].start - kTape[i - 1].start !== 4 * 3600e3) gaps++;

    series[symbol] = {
      coinbase: { c4h: comb4h, daily: combDaily, is4h: cb4h, isDaily: cbDaily },
      kraken: { c4h: kTape, daily: kDaily, is4h: kIs4h, isDaily: kIsDaily },
      cb4h, wins, krakenGapsInSpan: gaps, overlap: ov4h, krakenCoverage,
    };
    provenance.push({
      symbol, krakenPair: extPairs[symbol] ?? "", tape: tapeProv[symbol] ?? null,
      coinbase: { barsHourly: cbH.length, bars4h: cb4h.length, first: iso(cbH[0].start), last: iso(cbH[cbH.length - 1].start) },
      combined: { bars4h: comb4h.length, first: iso(comb4h[0].start), last: iso(comb4h[comb4h.length - 1].start) },
      krakenTape: { bars4h: kTape.length, first: iso(kTape[0].start), last: iso(kTape[kTape.length - 1].start), missingBarsOverCoinbaseSpan: gaps },
      overlapOverCoinbaseSpan: ov4h,
      accepted: rejected.length === 0, rejected,
      windowsOnPublishedArm: wins.filter((w) => w.scored).map((w) => w.name),
      windowsPricedHere: wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name),
      windowsDroppedForKrakenCoverage: wins.filter((w) => w.scored && !krakenCoverage[w.name].covered).map((w) => ({ window: w.name, why: krakenCoverage[w.name].why })),
    });
    if (rejected.length === 0) symbols.push(symbol);
    console.log(`${symbol.padEnd(9)} cb ${cb4h.length} 4h | kraken ${kTape.length} 4h (${gaps} missing in span) | overlap ${ov4h.sharedBars} bars median ${ov4h.medianBps} bps p95 ${ov4h.p95Bps} max ${ov4h.maxBps} | windows ${wins.filter((w) => w.scored).map((w) => w.name).join("") || "—"} → priced ${wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name).join("") || "—"}${rejected.length ? " REJECTED " + rejected.join("; ") : ""}`);
  }
  console.log(`accepted (${symbols.length}): ${symbols.join(", ")}`);

  // ── the grid ────────────────────────────────────────────────────────────
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const SEEDED_IDX = TREND_GRID.findIndex((p) => p.fast === DEFAULT_TREND.fast && p.slow === DEFAULT_TREND.slow && p.atrStop === DEFAULT_TREND.atrStop);
  const VENUES = ["revx", "kraken"] as const;
  const TAPES = ["coinbase", "kraken"] as const;
  type Tape = typeof TAPES[number];
  const other = (v: "revx" | "kraken") => v === "revx" ? "kraken" as const : "revx" as const;

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

  /** Choose in sample on one venue's costs, report the chosen point and the whole grid out of sample. Copied from `backtest_windows.ts`. */
  function studyVenue(
    venue: "revx" | "kraken",
    inSample: (p: TrendParams, c: Costs) => RunResult, outOfSample: (p: TrendParams, c: Costs) => RunResult,
  ): Cell {
    const own = COSTS[venue], oth = COSTS[other(venue)];
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < TREND_GRID.length; i++) { const s = score(inSample(TREND_GRID[i], own)); if (s > bestScore) { bestScore = s; bestIdx = i; } }
    const oosOwn = TREND_GRID.map((p) => outOfSample(p, own));
    const plateau = plateauOf(oosOwn.map((r) => r.ret), oosOwn[bestIdx].ret);
    const chosenOther = outOfSample(TREND_GRID[bestIdx], oth);
    const seededOther = outOfSample(TREND_GRID[SEEDED_IDX], oth);
    const chosen = barTests(oosOwn[bestIdx], chosenOther, plateau);
    const seeded = barTests(oosOwn[SEEDED_IDX], seededOther, plateau);
    return {
      chosen: { fast: TREND_GRID[bestIdx].fast, slow: TREND_GRID[bestIdx].slow, atrStop: TREND_GRID[bestIdx].atrStop },
      chosenOwn: pick(oosOwn[bestIdx]), chosenOther: pick(chosenOther),
      seededOwn: pick(oosOwn[SEEDED_IDX]), seededOther: pick(seededOther),
      plateau, chosenPass: chosen.pass, chosenFailed: chosen.failed, seededPass: seeded.pass, seededFailed: seeded.failed,
    };
  }

  /**
   * One window's calendar span, resolved onto whichever arm is being priced.
   * The spans are defined ONCE, on the published (`coinbase`) arm, and mapped
   * to the other arm by TIMESTAMP — never by bar index, because the two arms do
   * not have the same bars (Kraken has no candle for an hour in which its own
   * venue was down, which is a fact about the tape the loop reads, not an error
   * to paper over).
   */
  function spanOf(symbol: string, w: Win) {
    const { coinbase, cb4h } = series[symbol];
    const comb = coinbase.c4h;
    const isArr = w.isSeries === "coinbase" ? cb4h : comb;
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    return {
      isFromTs: isArr[w.isFrom].start, isToTs: endTs(isArr, w.isTo),
      oosFromTs: comb[w.oosFrom].start, oosToTs: endTs(comb, w.oosTo),
    };
  }

  // ── the whole per-coin study, once per (stop rule × tape) ───────────────
  type Tables = {
    trend: Record<string, Record<string, Record<string, Cell>>>;   // [symbol][window][venue]
    sleeve: Record<string, Record<string, MarkedResult>>;          // [symbol][window] — seeded, revx
    fidelity: { checks: number; worstAbsRetDiff: number; worstAbsMaxDDDiff: number; worstAbsTradeDiff: number };
    armsLookedAt: number;
  };

  function studyUnder(reg: Regime, tape: Tape): Tables {
    const st = reg.stops;
    const trend: Tables["trend"] = {}, sleeve: Tables["sleeve"] = {};
    let armsLookedAt = 0, mChecks = 0, mRet = 0, mDD = 0, mTrades = 0;
    for (const symbol of symbols) {
      const t0 = Date.now();
      const arm = series[symbol][tape];
      trend[symbol] = {}; sleeve[symbol] = {};
      for (const w of series[symbol].wins.filter((x) => x.scored && series[symbol].krakenCoverage[x.name].covered)) {
        const sp = spanOf(symbol, w);
        // The in-sample array: the cold-start array for A and B (it begins at the Coinbase series'
        // first bar on BOTH arms), the full array for C and D.
        const isArr = w.isSeries === "coinbase" ? arm.is4h : arm.c4h;
        const isDaily = w.isSeries === "coinbase" ? arm.isDaily : arm.daily;
        const isFrom = indexAtOrAfter(isArr, sp.isFromTs), isTo = indexAtOrAfter(isArr, sp.isToTs);
        const oosFrom = indexAtOrAfter(arm.c4h, sp.oosFromTs), oosTo = indexAtOrAfter(arm.c4h, sp.oosToTs);
        trend[symbol][w.name] = {};
        const isRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, isArr, isDaily, isFrom, isTo, p, c, 4, st(p));
        const oosRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, arm.c4h, arm.daily, oosFrom, oosTo, p, c, 4, st(p));
        for (const v of VENUES) {
          trend[symbol][w.name][v] = studyVenue(v, isRun, oosRun);
          armsLookedAt += TREND_GRID.length;
          // `runMarked` must BE `run`, on this arm, this window, this venue, this stop rule.
          const a = oosRun(DEFAULT_TREND, COSTS[v]);
          const b = runMarked("trend-4h", symbol, arm.c4h, arm.daily, oosFrom, oosTo, DEFAULT_TREND, COSTS[v], 4, st(DEFAULT_TREND));
          mChecks++; mRet = Math.max(mRet, Math.abs(a.ret - b.ret)); mDD = Math.max(mDD, Math.abs(a.maxDD - b.maxDD)); mTrades = Math.max(mTrades, Math.abs(a.trades - b.trades));
          if (v === "revx") sleeve[symbol][w.name] = b;
        }
      }
      const line = (n: string) => trend[symbol][n] ? `${n} ${(trend[symbol][n].revx.chosenOwn.ret * 100).toFixed(1)}%/${(trend[symbol][n].revx.seededOwn.ret * 100).toFixed(1)}%${trend[symbol][n].revx.seededPass ? "*" : ""}` : `${n} —`;
      console.log(`[${reg.id}·${tape}] ${symbol.padEnd(9)} ${["C", "B", "A", "D"].map(line).join("  ")} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    return { trend, sleeve, armsLookedAt, fidelity: { checks: mChecks, worstAbsRetDiff: mRet, worstAbsMaxDDDiff: mDD, worstAbsTradeDiff: mTrades } };
  }

  const tables: Record<string, Record<string, Tables>> = {};
  for (const reg of REGIMES) {
    tables[reg.id] = {};
    for (const tape of TAPES) {
      const t = Date.now();
      tables[reg.id][tape] = studyUnder(reg, tape);
      console.log(`[${reg.id}·${tape}] done in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    }
  }

  const report: Record<string, unknown> = {
    study: "the tape — every published backtest in this repository prices a signal the live loop does not compute, because `signal_venue` is `kraken` on every agent_strategies row while every table is priced on Coinbase candles. This re-prices the load-bearing conclusions on the tape the loop reads, and asks whether the disagreement is systematic or random.",
    source: "Two arms over the same calendar. `coinbase`: Kraken's quarterly OHLCVT bundle spliced strictly BEFORE the Coinbase Exchange series' first bar, Coinbase's from there — what backtest_windows.ts builds and what every published table used. `kraken`: Kraken's own 4-hour tape end to end (the same bundle resampled to 4 h, plus Kraken's public keyless OHLC endpoint for 2026-07-01 → 2026-09-21, which the bundle predates; the two sources agree to 0.0000 bps median and max over the 222 bars they share, on all 27 coins). Fills, fees, the protective exits and the two-bar cooldown are backtest.ts's own; Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). The model is not in the backtest.",
    determinism: "No wall-clock or runtime field is written. Re-running over the same three data directories reproduces this file byte for byte; every null is computed exactly rather than sampled.",
    windows: {
      note: "The window boundaries are defined ONCE, on the published arm — each coin's own Coinbase series cut in thirds, exactly as §3.7 / §3.8 / §3.10 / §3.11 / §3.15 cut it — and mapped onto the Kraken tape by TIMESTAMP, never by bar index. Both arms therefore price the same calendar.",
      A: "parameters on the first two thirds, the LAST third out of sample",
      B: "parameters on the first third, the MIDDLE third out of sample",
      C: "parameters on the 24 months of extended history before the series starts, the FIRST third out of sample",
      D: "parameters on the 24 months before that, the 12 months before the series out of sample — entirely inside the Kraken extension on BOTH arms, so it is identical by construction and is used here only as a check (`fidelity.windowD`)",
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
    data: { symbolsPriced: priced.length, symbolsWithNoKrakenTape: missingTape, perSymbol: provenance },
  };

  // ── fidelity ────────────────────────────────────────────────────────────
  const fid: Record<string, unknown> = {
    runMarked: {
      note: "`runMarked` (the one copy of `run` in this file) against `backtest.ts`'s `run`, seeded parameters, every accepted coin × every scored window × both venues × both stop rules × BOTH ARMS: largest absolute difference in return, drawdown and trade count. A non-zero anywhere would mean the copy is not the original and nothing below could be read.",
      perArm: Object.fromEntries(REGIMES.flatMap((reg) => TAPES.map((tape) => [`${reg.id}·${tape}`, tables[reg.id][tape].fidelity]))),
      checks: REGIMES.reduce((a, reg) => a + TAPES.reduce((b, tape) => b + tables[reg.id][tape].fidelity.checks, 0), 0),
      worstAbsRetDiff: Math.max(...REGIMES.flatMap((reg) => TAPES.map((tape) => tables[reg.id][tape].fidelity.worstAbsRetDiff))),
      worstAbsMaxDDDiff: Math.max(...REGIMES.flatMap((reg) => TAPES.map((tape) => tables[reg.id][tape].fidelity.worstAbsMaxDDDiff))),
      worstAbsTradeDiff: Math.max(...REGIMES.flatMap((reg) => TAPES.map((tape) => tables[reg.id][tape].fidelity.worstAbsTradeDiff))),
    },
  };

  // Window D is inside the Kraken extension on BOTH arms, so the two must agree bit for bit.
  {
    const per: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      let checks = 0, wr = 0, wd = 0, wt = 0;
      for (const s of symbols) {
        const cb = tables[reg.id].coinbase.trend[s].D, kr = tables[reg.id].kraken.trend[s].D;
        if (!cb || !kr) continue;
        for (const v of VENUES) {
          for (const k of ["chosenOwn", "seededOwn"] as const) {
            checks++;
            wr = Math.max(wr, Math.abs(cb[v][k].ret - kr[v][k].ret));
            wd = Math.max(wd, Math.abs(cb[v][k].maxDD - kr[v][k].maxDD));
            wt = Math.max(wt, Math.abs(cb[v][k].trades - kr[v][k].trades));
          }
        }
      }
      per[reg.id] = { checks, worstAbsRetDiff: r4(wr), worstAbsMaxDDDiff: r4(wd), worstAbsTradeDiff: wt };
    }
    fid.windowD = { note: "Window D's in-sample AND out-of-sample both sit before the splice, where both arms are the same Kraken bars. The two arms must therefore be identical there — a non-zero difference would mean the timestamp mapping is wrong.", perStopRule: per };
  }

  // Does the published arm reproduce windows.json, cell for cell?
  if (windowsPath) {
    const wj = JSON.parse(await Deno.readTextFile(windowsPath)) as Record<string, any>;
    const hash = await sha(windowsPath);
    const per: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const rows: { symbol: string; window: string; venue: string; field: string; published: number; here: number; delta: number }[] = [];
      let cells = 0;
      for (const s of symbols) {
        const pub = wj.perStopRule?.[reg.id]?.perCoin?.[s]?.["trend-4h"];
        if (!pub) continue;
        for (const wname of Object.keys(tables[reg.id].coinbase.trend[s])) {
          for (const v of VENUES) {
            const p = pub?.[wname]?.[v], h = tables[reg.id].coinbase.trend[s][wname][v];
            if (!p || !h) continue;
            for (const f of ["chosenOwn", "chosenOther", "seededOwn", "seededOther"] as const) {
              for (const k of ["ret", "maxDD"] as const) {
                cells++;
                const d = h[f][k] - p[f][k];
                if (Math.abs(d) > 1e-9) rows.push({ symbol: s, window: wname, venue: v, field: `${f}.${k}`, published: p[f][k], here: h[f][k], delta: r4(d) });
              }
              cells++;
              if (h[f].trades !== p[f].trades) rows.push({ symbol: s, window: wname, venue: v, field: `${f}.trades`, published: p[f].trades, here: h[f].trades, delta: h[f].trades - p[f].trades });
            }
          }
        }
      }
      per[reg.id] = {
        cellsCompared: cells, cellsThatDiffer: rows.length,
        worstAbsDelta: rows.length ? Math.max(...rows.map((r) => Math.abs(r.delta))) : 0,
        differences: rows.slice(0, 60),
      };
      console.log(`[${reg.id}] windows.json cross-check: ${cells} cells, ${rows.length} differ`);
    }
    fid.publishedWindows = {
      note: "This study's PUBLISHED arm against `docs/agents/backtests/windows.json` cell for cell — return, drawdown and trade count of the chosen and seeded points, own venue and other venue, every coin × window × venue × stop rule. The third-window study built the same series with the same splice and the same grid, so anything other than zero here means this harness is not reproducing the study it re-prices, and the Kraken arm would mean nothing.",
      file: windowsPath, sha256: hash, perStopRule: per,
    };
  }
  report.fidelity = fid;

  // ── T1: what the tape is worth ──────────────────────────────────────────
  type T1Cell = {
    symbol: string; window: string; venue: string; stopRule: string;
    spanFrom: string; spanTo: string; days: number;
    barsCoinbase: number; barsKraken: number;
    tapeSharedBars: number; tapeMedianBps: number | null; tapeP95Bps: number | null; tapeMaxBps: number | null;
    volAnnualised: number | null; halfSpreadBpsRevx: number; halfSpreadBpsKraken: number;
    ukBookUsdPerDay: number | null; krakenBookUsdPerDay: number | null;
    seeded: { kraken: ReturnType<typeof pick>; coinbase: ReturnType<typeof pick>; dRet: number; dMaxDD: number; dTrades: number; signFlip: boolean };
    chosen: { krakenParams: string; coinbaseParams: string; paramsMatch: boolean; kraken: ReturnType<typeof pick>; coinbase: ReturnType<typeof pick>; dRet: number; dMaxDD: number; dTrades: number; signFlip: boolean };
    bar: { seededKraken: boolean; seededCoinbase: boolean; chosenKraken: boolean; chosenCoinbase: boolean };
  };
  const t1cells: T1Cell[] = [];
  for (const reg of REGIMES) {
    for (const s of symbols) {
      for (const wname of ["A", "B", "C"]) {           // D is identical by construction; it is a check, not a comparison
        const w = series[s].wins.find((x) => x.name === wname);
        if (!w || !w.scored || !series[s].krakenCoverage[wname].covered) continue;
        const sp = spanOf(s, w);
        const ov = tapeAgreement(series[s].coinbase.c4h, series[s].kraken.c4h, sp.oosFromTs, sp.oosToTs);
        const vol = volOver(series[s].coinbase.c4h, sp.oosFromTs, sp.oosToTs);
        const barsCb = indexAtOrAfter(series[s].coinbase.c4h, sp.oosToTs) - indexAtOrAfter(series[s].coinbase.c4h, sp.oosFromTs);
        const barsKr = indexAtOrAfter(series[s].kraken.c4h, sp.oosToTs) - indexAtOrAfter(series[s].kraken.c4h, sp.oosFromTs);
        for (const v of VENUES) {
          const cb = tables[reg.id].coinbase.trend[s][wname][v], kr = tables[reg.id].kraken.trend[s][wname][v];
          const pstr = (p: { fast: number; slow: number; atrStop: number }) => `${p.fast}/${p.slow}/${p.atrStop}`;
          t1cells.push({
            symbol: s, window: wname, venue: v, stopRule: reg.id,
            spanFrom: iso(sp.oosFromTs), spanTo: iso(sp.oosToTs), days: Math.round((sp.oosToTs - sp.oosFromTs) / 86400e3),
            barsCoinbase: barsCb, barsKraken: barsKr,
            tapeSharedBars: ov.sharedBars, tapeMedianBps: ov.medianBps, tapeP95Bps: ov.p95Bps, tapeMaxBps: ov.maxBps,
            volAnnualised: vol,
            halfSpreadBpsRevx: Number((spreadOf(COSTS.revx, s) * 1e4).toFixed(3)),
            halfSpreadBpsKraken: Number((spreadOf(COSTS.kraken, s) * 1e4).toFixed(3)),
            ukBookUsdPerDay: UK_BOOK_USD_PER_DAY[s] ?? null, krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY[s] ?? null,
            seeded: {
              kraken: kr.seededOwn, coinbase: cb.seededOwn,
              dRet: r4(kr.seededOwn.ret - cb.seededOwn.ret), dMaxDD: r4(kr.seededOwn.maxDD - cb.seededOwn.maxDD),
              dTrades: kr.seededOwn.trades - cb.seededOwn.trades,
              signFlip: (kr.seededOwn.ret > 0) !== (cb.seededOwn.ret > 0),
            },
            chosen: {
              krakenParams: pstr(kr.chosen), coinbaseParams: pstr(cb.chosen), paramsMatch: pstr(kr.chosen) === pstr(cb.chosen),
              kraken: kr.chosenOwn, coinbase: cb.chosenOwn,
              dRet: r4(kr.chosenOwn.ret - cb.chosenOwn.ret), dMaxDD: r4(kr.chosenOwn.maxDD - cb.chosenOwn.maxDD),
              dTrades: kr.chosenOwn.trades - cb.chosenOwn.trades,
              signFlip: (kr.chosenOwn.ret > 0) !== (cb.chosenOwn.ret > 0),
            },
            bar: {
              seededKraken: kr.seededPass && (v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0)) >= MIN_BOOK_USD,
              seededCoinbase: cb.seededPass && (v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0)) >= MIN_BOOK_USD,
              chosenKraken: kr.chosenPass && (v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0)) >= MIN_BOOK_USD,
              chosenCoinbase: cb.chosenPass && (v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0)) >= MIN_BOOK_USD,
            },
          });
        }
      }
    }
  }

  const dist = (rows: T1Cell[], how: "seeded" | "chosen") => {
    const ds = rows.map((r) => r[how].dRet);
    const abs = ds.map(Math.abs);
    const pos = ds.filter((d) => d > 0).length, neg = ds.filter((d) => d < 0).length;
    return {
      comparisons: rows.length,
      medianAbsDRet: r4(median(abs)), p95AbsDRet: r4(quantile(abs, 0.95)), maxAbsDRet: r4(Math.max(0, ...abs)),
      meanDRet: r4(mean(ds)), medianDRet: r4(median(ds)),
      signFlips: rows.filter((r) => r[how].signFlip).length,
      signFlipRate: r3(rows.filter((r) => r[how].signFlip).length / Math.max(1, rows.length)),
      krakenHigher: pos, coinbaseHigher: neg, identical: rows.length - pos - neg,
      signTest: signTest(pos, neg),
      medianAbsDTrades: median(rows.map((r) => Math.abs(r[how].dTrades))),
      maxAbsDTrades: Math.max(0, ...rows.map((r) => Math.abs(r[how].dTrades))),
      medianAbsDMaxDD: r4(median(rows.map((r) => Math.abs(r[how].dMaxDD)))),
      maxAbsDMaxDD: r4(Math.max(0, ...rows.map((r) => Math.abs(r[how].dMaxDD)))),
      barVerdictFlips: rows.filter((r) => (how === "seeded" ? r.bar.seededKraken !== r.bar.seededCoinbase : r.bar.chosenKraken !== r.bar.chosenCoinbase)).length,
    };
  };
  const groupBy = (rows: T1Cell[], key: (r: T1Cell) => string, how: "seeded" | "chosen") => {
    const g: Record<string, T1Cell[]> = {};
    for (const r of rows) (g[key(r)] ??= []).push(r);
    return Object.fromEntries(Object.keys(g).sort().map((k) => [k, dist(g[k], how)]));
  };

  const PREDICTORS: { name: string; of: (r: T1Cell) => number | null }[] = [
    { name: "tapeDisagreementMedianBps", of: (r) => r.tapeMedianBps },
    { name: "tapeDisagreementP95Bps", of: (r) => r.tapeP95Bps },
    { name: "tapeDisagreementMaxBps", of: (r) => r.tapeMaxBps },
    { name: "missingKrakenBarsInSpan", of: (r) => r.barsCoinbase - r.barsKraken },
    { name: "halfSpreadBpsRevx", of: (r) => r.halfSpreadBpsRevx },
    { name: "halfSpreadBpsKraken", of: (r) => r.halfSpreadBpsKraken },
    { name: "ukBookUsdPerDay", of: (r) => r.ukBookUsdPerDay },
    { name: "krakenBookUsdPerDay", of: (r) => r.krakenBookUsdPerDay },
    { name: "volAnnualised", of: (r) => r.volAnnualised },
    { name: "tradesOnCoinbaseTape", of: (r) => null },   // filled per `how` below
  ];
  function correlate(rows: T1Cell[], how: "seeded" | "chosen") {
    const out: Record<string, unknown>[] = [];
    for (const p of PREDICTORS) {
      const xs: number[] = [], ys: number[] = [], zs: number[] = [];
      for (const r of rows) {
        const x = p.name === "tradesOnCoinbaseTape" ? r[how].coinbase.trades : p.of(r);
        if (x == null || !Number.isFinite(x)) continue;
        xs.push(x); ys.push(Math.abs(r[how].dRet)); zs.push(r[how].dRet);
      }
      out.push({
        predictor: p.name, n: xs.length,
        spearmanVsAbsDRet: xs.length >= 3 ? r3(spearman(xs, ys) ?? NaN) : null,
        pearsonVsAbsDRet: xs.length >= 3 ? r3(pearson(xs, ys) ?? NaN) : null,
        spearmanVsSignedDRet: xs.length >= 3 ? r3(spearman(xs, zs) ?? NaN) : null,
      });
    }
    return out;
  }

  const perCoinSignedIn = (how: "seeded" | "chosen", rows0: T1Cell[]) => {
    const rows = symbols.map((s) => {
      const mine = rows0.filter((r) => r.symbol === s);
      const ds = mine.map((r) => r[how].dRet);
      const pos = ds.filter((d) => d > 0).length, neg = ds.filter((d) => d < 0).length;
      return {
        symbol: s, cells: mine.length, medianDRet: r4(median(ds)), meanDRet: r4(mean(ds)),
        maxAbsDRet: r4(Math.max(0, ...ds.map(Math.abs))),
        krakenHigher: pos, coinbaseHigher: neg,
        tapeMedianBps: mine.length ? Number(median(mine.map((r) => r.tapeMedianBps ?? NaN)).toFixed(3)) : null,
        signFlips: mine.filter((r) => r[how].signFlip).length,
      };
    }).filter((r) => r.cells > 0).sort((a, b) => b.maxAbsDRet - a.maxAbsDRet);
    const up = rows.filter((r) => r.medianDRet > 0).length, dn = rows.filter((r) => r.medianDRet < 0).length;
    return { coins: rows.length, perCoin: rows, coinLevelSignTest: { ...signTest(up, dn), note: "one observation per coin (the median of that coin's cells), so the four near-duplicate cells inside a coin — two venues × two stop rules — cannot vote four times" } };
  };
  const perCoinSigned = (how: "seeded" | "chosen") => perCoinSignedIn(how, t1cells);

  report.t1_whatTheTapeIsWorth = {
    note: "The same rule over the same calendar on the two tapes. `seeded` holds the parameters fixed, so the difference is the tape and nothing else; `chosen` lets each tape pick its own grid point in sample, which is what a published table actually does, so it carries the tape's effect on the CHOICE as well. Windows A, B and C only: window D is the same bars on both arms and is a fidelity check, not a comparison.",
    cellsDefinition: "one coin × one window × one venue's costs × one stop rule. Both parameter sets are reported for every cell.",
    overall: { seeded: dist(t1cells, "seeded"), chosen: dist(t1cells, "chosen") },
    byWindow: { seeded: groupBy(t1cells, (r) => r.window, "seeded"), chosen: groupBy(t1cells, (r) => r.window, "chosen") },
    byVenue: { seeded: groupBy(t1cells, (r) => r.venue, "seeded"), chosen: groupBy(t1cells, (r) => r.venue, "chosen") },
    byStopRule: { seeded: groupBy(t1cells, (r) => r.stopRule, "seeded"), chosen: groupBy(t1cells, (r) => r.stopRule, "chosen") },
    systematicOrRandom: {
      note: "Three questions. (1) Does one tape win? — the sign test on the signed differences, at cell level and again at COIN level so the cells inside a coin cannot vote twice. (2) Is the size of the gap predictable? — Spearman and Pearson of |Δreturn| against the tape's own bar-level disagreement over the same span, the coin's two half-spreads, both books, the realised volatility and the trade count. (3) Does the parameter CHOICE move with the tape? — `chosenParamsAgreementRate`.",
      cellLevelSignTest: { seeded: dist(t1cells, "seeded").signTest, chosen: dist(t1cells, "chosen").signTest },
      coinLevel: { seeded: perCoinSigned("seeded"), chosen: perCoinSigned("chosen") },
      coinLevelByWindow: Object.fromEntries((["seeded", "chosen"] as const).map((how) => [how,
        Object.fromEntries(["A", "B", "C"].map((w) => {
          const b = perCoinSignedIn(how, t1cells.filter((r) => r.window === w));
          return [w, { coins: b.coins, coinLevelSignTest: b.coinLevelSignTest, perCoin: b.perCoin }];
        }))])),
      coinLevelByWindowNote: "The cell-level sign test inside one window counts each coin up to four times (two venues × two stop rules) and those four cells are near-duplicates, so its p-value is optimistic. This block is the same test with ONE observation per coin per window — the median of that coin's cells in that window — which is the number to read.",
      correlations: { seeded: correlate(t1cells, "seeded"), chosen: correlate(t1cells, "chosen") },
      chosenParamsAgreementRate: r3(t1cells.filter((r) => r.chosen.paramsMatch).length / Math.max(1, t1cells.length)),
      chosenParamsAgreementByWindow: Object.fromEntries(["A", "B", "C"].map((w) => {
        const rows = t1cells.filter((r) => r.window === w);
        return [w, { cells: rows.length, agree: rows.filter((r) => r.chosen.paramsMatch).length, rate: r3(rows.filter((r) => r.chosen.paramsMatch).length / Math.max(1, rows.length)) }];
      })),
      note2: "Window C's in-sample sits entirely before the splice, where the two arms are the SAME bars, so C's parameter choice is identical on both arms by construction and its Δ is a pure out-of-sample tape effect. A and B choose on different tapes as well as scoring on them.",
    },
    cells: t1cells,
  };

  // ── T2: the live candidate on the tape the loop reads ───────────────────
  const SLOT = Math.min(LIVE_CANDIDATE.capitalUsd / LIVE_CANDIDATE.slots, MAX_ORDER_USD);
  function sleeveBlock(reg: Regime, tape: Tape, wname: string) {
    const T = tables[reg.id][tape];
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
    return { members: members.length, memberSymbols: members, sleeve: whole, perCoin, leaveOneCoinOut };
  }

  const t2: Record<string, unknown> = {
    note: `${LIVE_CANDIDATE.row} · ${LIVE_CANDIDATE.venue} · ${LIVE_CANDIDATE.symbols.join(", ")} · $${LIVE_CANDIDATE.capitalUsd} · ${LIVE_CANDIDATE.slots} equal $${SLOT} slots · seeded parameters (fast ${DEFAULT_TREND.fast} / slow ${DEFAULT_TREND.slow} / ATR ${DEFAULT_TREND.atrStop}) · Revolut X costs. Leave-one-out re-splits the row's capital equally between the coins that remain, as allocation.json's question5_coinChanges does; a positive delta means the row's return over drawdown improved without that coin.`,
    perStopRule: {} as Record<string, unknown>,
  };
  for (const reg of REGIMES) {
    const per: Record<string, unknown> = {};
    for (const wname of ["A", "B", "C", "D"]) {
      const cb = sleeveBlock(reg, "coinbase", wname), kr = sleeveBlock(reg, "kraken", wname);
      if (!cb || !kr) { per[wname] = { scored: false, why: "no member has this window" }; continue; }
      per[wname] = {
        scored: true,
        window: series[LIVE_CANDIDATE.symbols.find((s) => tables[reg.id].coinbase.sleeve[s]?.[wname])!].wins.find((x) => x.name === wname),
        coinbase: cb, kraken: kr,
        delta: {
          ret: r4(kr.sleeve.ret - cb.sleeve.ret), maxDD: r4(kr.sleeve.maxDD - cb.sleeve.maxDD),
          retOverDD: r2(kr.sleeve.retOverDD - cb.sleeve.retOverDD),
          pnlUsd: r2(kr.sleeve.pnlUsd - cb.sleeve.pnlUsd),
          signFlip: (kr.sleeve.ret > 0) !== (cb.sleeve.ret > 0),
          perCoin: Object.fromEntries(LIVE_CANDIDATE.symbols.filter((s) => cb.perCoin.some((c) => c.symbol === s) && kr.perCoin.some((c) => c.symbol === s)).map((s) => {
            const a = kr.perCoin.find((c) => c.symbol === s)!, b = cb.perCoin.find((c) => c.symbol === s)!;
            return [s, { kraken: a.ret, coinbase: b.ret, dRet: r4(a.ret - b.ret), signFlip: (a.ret > 0) !== (b.ret > 0), dTrades: a.trades - b.trades }];
          })),
          leaveOneOutRankAgrees: JSON.stringify(kr.leaveOneCoinOut.map((x) => x.symbol)) === JSON.stringify(cb.leaveOneCoinOut.map((x) => x.symbol)),
          leaveOneOutSignAgrees: kr.leaveOneCoinOut.every((x) => {
            const y = cb.leaveOneCoinOut.find((z) => z.symbol === x.symbol);
            return y != null && (x.deltaRetOverDD > 0) === (y.deltaRetOverDD > 0);
          }),
        },
      };
      console.log(`[${reg.id}] T2 ${wname}: kraken ${(kr.sleeve.ret * 100).toFixed(1)}% (DD ${(kr.sleeve.maxDD * 100).toFixed(1)}%, ret/DD ${kr.sleeve.retOverDD}) vs coinbase ${(cb.sleeve.ret * 100).toFixed(1)}% (DD ${(cb.sleeve.maxDD * 100).toFixed(1)}%, ret/DD ${cb.sleeve.retOverDD})`);
    }
    (t2.perStopRule as Record<string, unknown>)[reg.id] = per;
  }
  report.t2_liveCandidate = t2;

  // ── T3: §4.15's bar, re-run on the tape the loop reads ──────────────────
  function membership(reg: Regime, tape: Tape, v: "revx" | "kraken", how: "chosen" | "seeded") {
    const T = tables[reg.id][tape].trend;
    const passOn = (s: string, w: string) => {
      const cell = T[s]?.[w]?.[v];
      if (!cell) return null;
      const book = v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0);
      return (how === "chosen" ? cell.chosenPass : cell.seededPass) && book >= MIN_BOOK_USD;
    };
    const scored = symbols.filter((s) => T[s].A?.[v] && T[s].B?.[v]);
    const per = scored.map((s) => ({ symbol: s, cleared: (["A", "B"] as const).filter((w) => passOn(s, w) === true) }));
    return {
      venue: v, parameters: how, coinsWithBothWindows: scored.length,
      twoWindow: per.filter((x) => x.cleared.length === 2).map((x) => x.symbol),
      oneWindowA: per.filter((x) => x.cleared.length === 1 && x.cleared[0] === "A").map((x) => x.symbol),
      oneWindowB: per.filter((x) => x.cleared.length === 1 && x.cleared[0] === "B").map((x) => x.symbol),
      neither: per.filter((x) => x.cleared.length === 0).map((x) => x.symbol),
      notScored: symbols.filter((s) => !(T[s].A?.[v] && T[s].B?.[v])),
      clearsC: symbols.filter((s) => T[s].C?.[v] && passOn(s, "C") === true),
    };
  }

  function chanceBlock(reg: Regime, tape: Tape, v: "revx" | "kraken", how: "chosen" | "seeded") {
    const T = tables[reg.id][tape].trend;
    const passOn = (s: string, w: string) => {
      const cell = T[s]?.[w]?.[v];
      if (!cell) return null;
      const book = v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0);
      return (how === "chosen" ? cell.chosenPass : cell.seededPass) && book >= MIN_BOOK_USD;
    };
    const pop = symbols.filter((s) => ["A", "B", "C"].every((w) => T[s][w]?.[v]));
    const n = pop.length;
    const ks = ["A", "B", "C"].map((w) => pop.filter((s) => passOn(s, w) === true).length);
    const observed = pop.filter((s) => ["A", "B", "C"].every((w) => passOn(s, w) === true));
    const d = intersectionDistribution(n, ks);
    const p = ks.map((k) => k / n);
    const hist = [0, 0, 0, 0];
    for (let mask = 0; mask < 8; mask++) {
      let q = 1, c = 0;
      for (let b = 0; b < 3; b++) { const on = (mask >> b) & 1; q *= on ? p[b] : 1 - p[b]; c += on; }
      hist[c] += q * n;
    }
    return {
      tape, venue: v, parameters: how, population: n, coins: pop,
      passesPerWindow: { A: ks[0], B: ks[1], C: ks[2] },
      observedAllThree: observed.length, which: observed,
      expectedAllThreeUnderNull: r2(n * p[0] * p[1] * p[2]),
      probabilityAtLeastObserved: r4(d.slice(observed.length).reduce((a, b) => a + b, 0)),
      nullDistribution: d.slice(0, 6).map(r4),
      windowsClearedHistogram: Object.fromEntries([0, 1, 2, 3].map((k) => [String(k), pop.filter((s) => ["A", "B", "C"].filter((w) => passOn(s, w) === true).length === k).length])),
      nullExpectedHistogram: Object.fromEntries([0, 1, 2, 3].map((k) => [String(k), r2(hist[k])])),
      note: "The null is: each window's clearers are an independent uniform subset of the population, of the size that window actually produced. The distribution is exact (hypergeometric intersections), not sampled.",
    };
  }

  function predictiveness(reg: Regime, tape: Tape, v: "revx" | "kraken", how: "chosen" | "seeded", requireAllThree = true) {
    const T = tables[reg.id][tape].trend;
    const passOn = (s: string, w: string) => {
      const cell = T[s]?.[w]?.[v];
      if (!cell) return null;
      const book = v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0);
      return (how === "chosen" ? cell.chosenPass : cell.seededPass) && book >= MIN_BOOK_USD;
    };
    const POP = requireAllThree ? symbols.filter((s) => ["A", "B", "C"].every((w) => T[s][w] != null)) : symbols;
    return ([{ a: "A", b: "B" }, { a: "A", b: "C" }, { a: "B", b: "C" }]).map(({ a, b }) => {
      const pop = POP.filter((s) => T[s][a]?.[v] && T[s][b]?.[v]);
      const key = how === "chosen" ? "chosenOwn" as const : "seededOwn" as const;
      const ax = pop.map((s) => T[s][a][v][key].ret), bx = pop.map((s) => T[s][b][v][key].ret);
      const cnt = { pp: 0, pf: 0, fp: 0, ff: 0 };
      for (const s of pop) {
        const pa = passOn(s, a) === true, pb = passOn(s, b) === true;
        if (pa && pb) cnt.pp++; else if (pa && !pb) cnt.pf++; else if (!pa && pb) cnt.fp++; else cnt.ff++;
      }
      const n = pop.length, r1 = cnt.pp + cnt.pf, c1 = cnt.pp + cnt.fp;
      let pFisher = 0;
      for (let x = cnt.pp; x <= Math.min(r1, c1); x++) pFisher += hyper(n, r1, c1, x);
      return {
        windows: `${a} → ${b}`, coins: n, parameters: how,
        pearsonReturns: r3(pearson(ax, bx) ?? NaN), spearmanReturns: r3(spearman(ax, bx) ?? NaN),
        barContingency: cnt, fisherOneSidedP: r4(pFisher),
        rateGivenPass: r1 > 0 ? r3(cnt.pp / r1) : null,
        rateGivenFail: (n - r1) > 0 ? r3(cnt.fp / (n - r1)) : null,
      };
    });
  }

  const t3: Record<string, unknown> = { note: "§4.15's four tests, per coin per window, as §3.8 applied them — re-run with the signal coming from the tape the loop actually reads. `membership` is directly comparable with windows.json's block of the same name; `chance` and `predictiveness` are §3.15's two central findings recomputed on Kraken's tape with the same EXACT (never sampled) null.", perStopRule: {} as Record<string, unknown> };
  for (const reg of REGIMES) {
    const arms: Record<string, unknown> = {};
    for (const v of VENUES) for (const how of ["chosen", "seeded"] as const) {
      const key = `${v}${how[0].toUpperCase()}${how.slice(1)}`;
      const cbM = membership(reg, "coinbase", v, how), krM = membership(reg, "kraken", v, how);
      arms[key] = {
        membership: { coinbase: cbM, kraken: krM,
          moved: {
            joinedTwoWindowOnKrakenTape: krM.twoWindow.filter((s) => !cbM.twoWindow.includes(s)),
            leftTwoWindowOnKrakenTape: cbM.twoWindow.filter((s) => !krM.twoWindow.includes(s)),
            windowAPassesCoinbase: cbM.twoWindow.length + cbM.oneWindowA.length, windowAPassesKraken: krM.twoWindow.length + krM.oneWindowA.length,
            windowBPassesCoinbase: cbM.twoWindow.length + cbM.oneWindowB.length, windowBPassesKraken: krM.twoWindow.length + krM.oneWindowB.length,
          },
        },
        chance: { coinbase: chanceBlock(reg, "coinbase", v, how), kraken: chanceBlock(reg, "kraken", v, how) },
        predictiveness: { coinbase: predictiveness(reg, "coinbase", v, how), kraken: predictiveness(reg, "kraken", v, how) },
        predictivenessOnPairPopulation: {
          note: "The same contingency on the population that has BOTH of the two windows, without also requiring the third — which is how reference §3.15's four-row table was read off the membership lists. It is the directly comparable number; the block above restricts to the three-window population, as windows.json's own block does.",
          coinbase: predictiveness(reg, "coinbase", v, how, false), kraken: predictiveness(reg, "kraken", v, how, false),
        },
      };
    }
    (t3.perStopRule as Record<string, unknown>)[reg.id] = arms;
  }
  // The bar verdict, coin by coin and window by window, on both tapes — the raw material of everything above.
  (t3 as Record<string, unknown>).perCoinVerdicts = Object.fromEntries(REGIMES.map((reg) => [reg.id,
    Object.fromEntries(symbols.map((s) => [s, Object.fromEntries((["A", "B", "C", "D"] as const).map((w) => {
      const cb = tables[reg.id].coinbase.trend[s][w], kr = tables[reg.id].kraken.trend[s][w];
      if (!cb || !kr) return [w, null];
      const book = (v: "revx" | "kraken") => v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0);
      return [w, Object.fromEntries(VENUES.map((v) => [v, {
        coinbase: { chosen: cb[v].chosen, chosenOwn: cb[v].chosenOwn, seededOwn: cb[v].seededOwn, plateau: cb[v].plateau.positiveShare, chosenPass: cb[v].chosenPass && book(v) >= MIN_BOOK_USD, seededPass: cb[v].seededPass && book(v) >= MIN_BOOK_USD, seededFailed: cb[v].seededFailed },
        kraken: { chosen: kr[v].chosen, chosenOwn: kr[v].chosenOwn, seededOwn: kr[v].seededOwn, plateau: kr[v].plateau.positiveShare, chosenPass: kr[v].chosenPass && book(v) >= MIN_BOOK_USD, seededPass: kr[v].seededPass && book(v) >= MIN_BOOK_USD, seededFailed: kr[v].seededFailed },
      }]))];
    })) ]))]));
  report.t3_theBar = t3;

  // ── the multiple-comparisons control ────────────────────────────────────
  const armsTotal = REGIMES.reduce((a, reg) => a + TAPES.reduce((b, tape) => b + tables[reg.id][tape].armsLookedAt, 0), 0);
  report.multipleComparisons = {
    armsLookedAt: armsTotal,
    note: `An "arm" is one parameter point run out of sample on one coin, one window, one venue's costs, one stop rule and one TAPE. ${armsTotal} of them were looked at. This study searches for nothing — it re-prices a fixed rule on a second tape — so the only place a chance control is load-bearing is §T3's three-window count, and that null is stated exactly inside each 'chance' block: each window's clearers are an independent uniform subset of the population, of the size that window actually produced, and the intersection distribution is hypergeometric. The sign tests in §T1 are exact binomials under "the two tapes are exchangeable", reported at cell level AND at coin level because the cells inside one coin are not independent draws.`,
    coinWindowsScored: REGIMES.reduce((a, reg) => a + TAPES.reduce((b, tape) => b + symbols.reduce((c, s) => c + Object.keys(tables[reg.id][tape].trend[s]).length, 0), 0), 0),
    windowsPerCoin: Object.fromEntries(symbols.map((s) => [s, series[s].wins.filter((w) => w.scored && series[s].krakenCoverage[w.name].covered).map((w) => w.name)])),
    windowsDroppedForKrakenCoverage: Object.fromEntries(symbols.map((s) => [s, series[s].wins.filter((w) => w.scored && !series[s].krakenCoverage[w.name].covered).map((w) => ({ window: w.name, why: series[s].krakenCoverage[w.name].why }))]).filter(([, v]) => (v as unknown[]).length)),
  };

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error(`backtest.ts changed during the run (${btHashStart.slice(0, 12)} → ${btHashEnd.slice(0, 12)}); re-run it`);
  report.sourceIntegrity = {
    backtestTsSha256: btHashStart, stableAcrossRun: true,
    note: "SHA-256 of `supabase/functions/agents/backtest.ts`, read at the start of the run and again at the end. This study imports its `run`, `COSTS`, `spreadOf` and `stopsForKind`, so that file is an input: the hash says which version produced these numbers, and a run that straddled an edit would have thrown rather than written this file.",
  };

  const path = `${outDir}/tape.json`;
  await Deno.writeTextFile(path, JSON.stringify(report, null, 1));
  console.log(`wrote ${path} in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
}
