// The SUI study: does SUI deserve its seat in the LIVE row?
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_sui.ts \
//     --data  <dir with BTC-USD_1h_3y.json …>       (Coinbase Exchange hourly, 3 y)
//     --ext   <dir with BTC-USD_1h_kraken.json …>   (Kraken quarterly bundle, hourly)
//     --ktape <dir with BTC-USD_4h_kraken.json …>   (Kraken's own 4 h tape, full span)
//     --rtape <dir with BTC-USD_4h_revx.json …>     (Revolut X UK public 4 h book, 1 y)
//     --set2  docs/agents/backtests/set2.json       (cross-check)
//     --tape  docs/agents/backtests/tape.json       (cross-check, and the population base rate)
//     --windows docs/agents/backtests/windows.json  (cross-check of §3.15's window-C probe)
//     --jev   docs/agents/backtests/jev.json        (cross-check of the entry-state census)
//     --answers docs/agents/backtests/jev_answers.json (the model's measured replies, S7)
//     --out   docs/agents/backtests
//
// Writes `<out>/sui.json` and NOTHING else. Report:
// `docs/agents/reviews/2026-09-22-sui-study.md`.
//
// ── why this study exists ─────────────────────────────────────────────
//
// The repository judges a coin-set change by the WORST of four walk-forward
// windows — A (bear), B (bull), C (strong bull), D (sideways) — never
// averaged. SUI has windows A and B only: its history begins 2023-05-03, so
// window C's in-sample would be 142 days, under the 180-day floor, and D is
// earlier still. C and D are FOUR-coin sleeves whether or not SUI is in the
// row, the live row's worst window is D in every condition, and `drop·SUI`
// therefore reports a delta of exactly 0.00 in all four conditions. That zero
// is an IDENTITY, not a measurement: the ranking rule cannot see SUI.
//
// This study judges SUI on evidence the rule can see it in, and judges it the
// same way it judges the other four:
//
//   S0  SUI's own §4.15 record, and whether §3.8's admission reproduces under
//       the stop rule `tick.ts` runs.
//   S1  the windows SUI HAS (A, B), leave-one-out for ALL FIVE coins.
//   S2  the contiguous span where all five exist, one seeded run per coin.
//   S3  consecutive equal folds tiling that span (~6 months each): the
//       five-coin sleeve against the four-coin one, and SUI's RANK among the
//       five members, fold by fold, with an exact exchangeability null.
//   S4  what SUI does to drawdown, measured directly, beside what each of the
//       other four does.
//   S5  the spread SUI actually trades at.
//   S6  §3.15's window-C probe, reproduced under the same protest.
//   S7  the entry states SUI shows Jev — trend_strength × volatility — so the
//       interaction with the model's veto is visible. Jev is NOT called: its
//       measured replies (reference §4.21) are read from `jev_answers.json`.
//
// ── pre-registered, written before any number below was computed ─────
//
// PRIMARY test (the live seat): S3's exchangeability test on the cost of
// removing each member — Δ ret/DD of the sleeve without it, capital rescaled —
// under the SHIPPED stop, on BOTH backbone tapes. Under "SUI's seat is like
// any other member's" SUI's rank among the five is uniform in every fold; the
// null of the rank sum is enumerated exactly.
//   · p(worse) < 0.05 on both tapes  → the evidence says drop SUI from the live row
//   · p(better) < 0.05 on both tapes → the evidence supports the seat
//   · otherwise                      → the performance evidence cannot decide
// Everything else — S1, S2, the fold sign tests, S4, S5 — is secondary and is
// reported with its own arm count, never promoted to a verdict after the fact.
//
// Added AFTER the first full run had been read, and touching none of the
// above: window A cut at the calendar end every coin's file reaches (S0, S1 —
// the first run showed SUI's last window-A trade falls in hours only two of
// the five files have), S_oos cut at the same end, the `jev.json` census
// cross-check, the fold t-test's exact p, the S1 control's tails, and the
// measured book (S5). After the jev study replaced its recorded answers with
// the model's measured ones (2026-09-22 19:31 UTC): S7 reads those replies
// through `combineDecision` and the census cross-check follows that study's
// new layout; and S0 lists SUI's window-A fills per tape (`lastWindowATrades`),
// located from `run`'s own trade and stop counters. The primary test and its
// decision rule did not change.
//
// ── what is imported, what is copied, and what is NOT copied ──────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`
// and `spreadOf`, and the rulebook in `_shared/agents_strategy.ts`, are
// IMPORTED. Nothing that costs money is re-implemented, and NO copy of `run`
// exists in this file.
//
// The sleeve arithmetic needs the equity at the close of every UTC day, and
// `run` only samples its curve every sixth bar, at an index that moves with the
// array start. So `runDaily` asks `run` itself: `run(from, k + 1)` stops after
// bar k and returns the equity at bar k's close, because `run` is
// prefix-consistent — nothing in its loop reads `to` except the loop bound.
// One `run` per day-end. `fidelity.runDaily` checks that property against
// `run`'s own sampled curve on every priced cell, and `fidelity.vsSet2` checks
// the sleeves it produces against the published A1 cells, which were built by
// a different runner.
//
// `combine`, `dailyMarks`, `dailyReturns`, `plateauOf`, `barTests`, `pick`,
// `windowsOn`, `tapeAgreement`, `median`, `quantile`, `pearson`, `logChoose`,
// `binomTail` and `signTest` are copied VERBATIM from `backtest_set2.ts`, which
// does not export them: they do arithmetic on outputs and calendars and touch
// no price, fee or fill. The census reads the categorical state the loop shows
// Jev through the rulebook's own `buildSnapshot` / `ruleFor`, at the bars where
// `run`'s own trade count says an entry filled, and a measured reply vetoes an
// entry exactly when the rulebook's own `combineDecision` says it does.
//
// ── determinism ───────────────────────────────────────────────────────
//
// No wall-clock or runtime field is written. Re-running over the same four
// data directories reproduces this file byte for byte. `backtest.ts` is
// SHA-256'd at the start and the end of the run and the hash is an input.

import {
  buildSnapshot, combineDecision, DEFAULT_TREND, FLAT, precompute, ruleFor,
  type Candle, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import {
  COSTS, resample, run, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]

// ───────────────────────────────────────────────────────── facts, not guesses

/** Revolut X UK-book 24 h quote volume, reference §3.8 — the figures `set2.json` / `tape.json` carry. */
const UK_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 3_600_000, "ETH/USD": 3_200_000, "SOL/USD": 3_300_000, "AVAX/USD": 1_900_000, "SUI/USD": 942_000,
};
/** Kraken 24 h quote volume, reference §3.12 (`kraken.json` → `krakenBook`) — the figures `set2.json` / `tape.json` carry. */
const KRAKEN_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 415_926_026, "ETH/USD": 211_257_776, "SOL/USD": 89_808_255, "AVAX/USD": 19_643_858, "SUI/USD": 36_150_670,
};
const MIN_BOOK_USD = 100_000;

/** The live row as the go-live draft writes it. */
const LIVE_ROW = { row: "trend-4h", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100 };
const SUI = "SUI/USD";
const FOUR = LIVE_ROW.symbols.filter((s) => s !== SUI);
/** `agent_risk.max_order_usd` — the reason a four-coin row at $25 a slot is a parameter change and not a deletion. */
const MAX_ORDER_USD = 20;
const SLOT_USD = LIVE_ROW.capitalUsd / LIVE_ROW.symbols.length; // $20

/** The acceptance tests §3.15 declared before comparing the sources, and the floors set2 declared; identical here. */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
const MIN_IN_SAMPLE_DAYS = 180;
/** The stop rule §3.7 / §3.8 / §3.10 / §3.11 — and SUI's admission — were computed under: the floor PLUS the intra-bar 3×ATR trail. */
const PINNED_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };
const MAX_LOOKBACK = 301;
const REVX_MIN_WINDOW_COVERAGE = 0.95;
/** The fold length aimed at; the span is tiled by the whole number of folds nearest to it. */
const FOLD_TARGET_DAYS = 182;
/** `combineDecision`'s entry threshold and caution veto, as shipped (jev.json `thresholds`). */
const ENTER_MIN = 0.6;
const CAUTION_EXIT = 1.75;

/**
 * SUI's touch on Revolut X's UK book, per side. `COSTS.revx` charges 11.97 bps
 * a side (a 23.94 bps full spread — the median of 21 samples a minute apart on
 * 2026-09-21, §3.8), and every published SUI figure rests on it. §4.19 measured
 * 25.7 bps at the touch the minute the pre-live probe ran and 23.7 bps
 * side-by-side with Kraken the same afternoon. `sampled` is this study's own
 * measurement (see `SAMPLED_UK_BOOK`).
 */
const SUI_HALF_SPREADS: { id: string; halfSpread: number; what: string }[] = [
  { id: "assumed", halfSpread: 11.97e-4, what: "COSTS.revx — median of 21 samples a minute apart, 2026-09-21 (§3.8): 23.94 bps full" },
  { id: "measured_23_7", halfSpread: 11.85e-4, what: "reference §4.19, side-by-side with Kraken, 2026-09-22: 23.7 bps full" },
  { id: "measured_25_7", halfSpread: 12.85e-4, what: "reference §4.19, the UK touch the minute the pre-live probe ran, 2026-09-22: 25.7 bps full" },
  { id: "sampled", halfSpread: 0, what: "this study: the median of SAMPLED_UK_BOOK's SUI samples, halved" },
  { id: "doubled", halfSpread: 23.94e-4, what: "§3.8's own stress — the assumed half-spread doubled" },
];

/**
 * This study's own measurement of the five UK books: `GET
 * https://revx.revolut.com/api/1.0/public/tickers?symbols=…&region=UK` (public,
 * keyless, UK rows only), every 30 s, 60 samples, 2026-09-22 18:29:53 → 18:59:23
 * UTC, alongside Kraken's public Ticker. Full spread in bps: median / p10 / p90
 * / min / max across the samples (p10 / p90 by this file's `quantile`), the share
 * of samples at 20 bps or wider, and the venue's own 24 h quote volume as the
 * last sample reported it. One half-hour on one evening, like §3.8's twenty
 * minutes: a book is not one number. The raw samples are not committed.
 */
const SAMPLED_UK_BOOK: {
  window: string; samples: number;
  revx: Record<string, { median: number; p10: number; p90: number; min: number; max: number; shareAtOrOver20Bps: number; quoteVolume24hUsd: number }>;
  kraken: Record<string, { median: number }>;
} = {
  window: "2026-09-22 18:29:53 → 18:59:23 UTC",
  samples: 60,
  revx: {
    "BTC/USD": { median: 2.781, p10: 1.528, p90: 3.705, min: 1.021, max: 4.545, shareAtOrOver20Bps: 0, quoteVolume24hUsd: 7_704_668 },
    "ETH/USD": { median: 1.71, p10: 1.235, p90: 2.252, min: 0.872, max: 3.017, shareAtOrOver20Bps: 0, quoteVolume24hUsd: 887_890 },
    "SOL/USD": { median: 3.725, p10: 2.79, p90: 4.408, min: 2.199, max: 4.909, shareAtOrOver20Bps: 0, quoteVolume24hUsd: 3_159_180 },
    "AVAX/USD": { median: 9.1, p10: 8.186, p90: 10.011, min: 7.271, max: 10.037, shareAtOrOver20Bps: 0, quoteVolume24hUsd: 302_706 },
    "SUI/USD": { median: 14.877, p10: 1.985, p90: 23.793, min: 0.993, max: 38.635, shareAtOrOver20Bps: 0.35, quoteVolume24hUsd: 517_010 },
  },
  kraken: { "BTC/USD": { median: 0.012 }, "ETH/USD": { median: 0.036 }, "SOL/USD": { median: 0.848 }, "AVAX/USD": { median: 1.82 }, "SUI/USD": { median: 1.981 } },
};
SUI_HALF_SPREADS[3].halfSpread = SAMPLED_UK_BOOK.revx[SUI].median / 2 / 1e4;

// ───────────────────────────────────────── arithmetic on outputs (copied VERBATIM from backtest_set2.ts)

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

type Plateau = { gridPoints: number; positiveShare: number; median: number; chosenRank: number };
/** Copied from `backtest_tape.ts` / `backtest_windows.ts`. */
function plateauOf(rets: number[], chosen: number): Plateau {
  const s = rets.slice().sort((a, b) => a - b);
  return {
    gridPoints: s.length,
    positiveShare: r3(s.filter((r) => r > 0).length / s.length),
    median: r4(s[Math.floor(s.length / 2)]),
    chosenRank: s.filter((r) => r > chosen).length + 1,
  };
}

/** §4.15's four tests on ONE window on ONE venue. Copied from `backtest_tape.ts`'s `barTests`. */
function barTests(own: RunResult, other: RunResult, plateau: Plateau): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!(own.ret > 0)) failed.push("own-venue return not positive");
  if (!(own.maxDD < 0.35)) failed.push("drawdown ≥ 35 %");
  if (!(plateau.positiveShare >= 0.5)) failed.push("plateau < 50 %");
  if (!(other.ret > 0)) failed.push("other-venue return not positive");
  return { pass: failed.length === 0, failed };
}

function score(r: { ret: number; maxDD: number }): number { return r.ret / Math.max(0.05, r.maxDD); }
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
  bestDayUsd: number; worstDayUsd: number; peakOpenUsd: number; maxOrderUsd: number;
};
/** Combine sleeves at their slot sizes. Copied from `backtest_tape.ts` / `backtest_portfolio.ts`. */
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

/** log C(n, k). Copied from `backtest_windows.ts`. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}
/** P(X ≥ k) for X ~ Binomial(n, p). Copied from `backtest_execution.ts`. */
function binomTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  let tail = 0;
  for (let j = k; j <= n; j++) tail += Math.exp(logChoose(n, j) + j * Math.log(p) + (n - j) * Math.log(1 - p));
  return Math.min(1, tail);
}
/** The exact two-sided sign test. Copied from `backtest_tape.ts`. */
function signTest(pos: number, neg: number): { positives: number; negatives: number; pTwoSided: number } {
  const m = pos + neg;
  if (m === 0) return { positives: pos, negatives: neg, pTwoSided: 1 };
  const k = Math.min(pos, neg);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(m, i) - m * Math.LN2);
  return { positives: pos, negatives: neg, pTwoSided: Number(Math.min(1, 2 * tail).toPrecision(3)) };
}

// ─────────────────────────────────────────────── arithmetic this study adds (on outputs only)

/** `combine`, plus the dollar path it walks, so drawdown can be measured in dollars and attributed to members. */
type SleevePath = {
  stats: SleeveStats; days: number[]; equityUsd: number[]; pnlUsd: number[]; perMemberPnlUsd: Record<string, number[]>;
  ddUsd: number; ddFraction: number; troughDay: string; peakDay: string; episodeLossBy: Record<string, number>;
};
function combinePath(sleeves: Sleeve[]): SleevePath {
  const stats = combine(sleeves);
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  const equityUsd: number[] = [], pnlUsd: number[] = [];
  const perMemberPnlUsd: Record<string, number[]> = Object.fromEntries(sleeves.map((s) => [s.symbol, [] as number[]]));
  let eq = capital, peak = capital, ddUsd = 0, ddFrac = 0, peakIdx = -1, bestPeakIdx = -1, troughIdx = -1;
  for (let i = 0; i < days.length; i++) {
    let p = 0;
    for (const s of sleeves) { const x = s.slotUsd * (s.rets.get(days[i]) ?? 0); p += x; perMemberPnlUsd[s.symbol].push(x); }
    eq += p; equityUsd.push(eq); pnlUsd.push(p);
    if (eq > peak) { peak = eq; peakIdx = i; }
    ddUsd = Math.max(ddUsd, peak - eq);
    const f = 1 - eq / peak;
    if (f > ddFrac) { ddFrac = f; troughIdx = i; bestPeakIdx = peakIdx; }
  }
  // Who lost the money between the peak and the trough of the deepest fractional drawdown.
  const episodeLossBy: Record<string, number> = {};
  if (troughIdx >= 0) for (const s of sleeves) {
    let sum = 0;
    for (let i = bestPeakIdx + 1; i <= troughIdx; i++) sum += perMemberPnlUsd[s.symbol][i];
    episodeLossBy[s.symbol] = r2(sum);
  }
  const dayIso = (i: number) => i >= 0 && i < days.length ? new Date(days[i]).toISOString().slice(0, 10) : "start";
  return { stats, days, equityUsd, pnlUsd, perMemberPnlUsd, ddUsd, ddFraction: ddFrac, troughDay: dayIso(troughIdx), peakDay: dayIso(bestPeakIdx), episodeLossBy };
}

/**
 * Two-sided P(|T| ≥ |t|) for Student's t with an integer number of degrees of
 * freedom, in closed form (the finite series for P(|T| < t) with θ = atan(|t|/√ν)),
 * so the fold error bar's p is exact rather than read off a table.
 */
function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df < 1) return NaN;
  const th = Math.atan(Math.abs(t) / Math.sqrt(df)), c2 = Math.cos(th) ** 2, sn = Math.sin(th);
  let inside: number;
  if (df % 2 === 0) {
    let term = 1, sum = 1;
    for (let k = 2; k <= df - 2; k += 2) { term *= (k - 1) / k * c2; sum += term; }
    inside = sn * sum;
  } else if (df === 1) {
    inside = 2 * th / Math.PI;
  } else {
    let term = 1, sum = 1;
    for (let k = 3; k <= df - 2; k += 2) { term *= (k - 1) / k * c2; sum += term; }
    inside = 2 / Math.PI * (th + sn * Math.cos(th) * sum);
  }
  return Math.min(1, Math.max(0, 1 - inside));
}

/** Mid-ranks, 1 = best for the sleeve; ties share the average rank. */
function midRanks(xs: number[], higherIsBetter: boolean): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => (higherIsBetter ? xs[b] - xs[a] : xs[a] - xs[b]) || a - b);
  const ranks = new Array<number>(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && Math.abs(xs[idx[j + 1]] - xs[idx[i]]) <= 1e-12) j++;
    for (let k = i; k <= j; k++) ranks[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}
/**
 * The exact exchangeability test for one member across independent units. Under
 * "this member's seat is like any other member's", its rank in each unit is
 * equally likely to be any of that unit's ranks, independently across units. The
 * null distribution of the rank SUM is enumerated exactly (mid-ranks doubled to
 * integers), so every p below is a probability and not a simulation. A HIGH sum
 * means the member is WORSE for the sleeve than the others.
 */
function rankSumTest(unitRanks: number[][], member: number) {
  let dist = new Map<number, number>([[0, 1]]);
  let obs = 0, expd = 0;
  for (const rs of unitRanks) {
    const next = new Map<number, number>();
    for (const [s, pr] of dist) for (const r of rs) { const k = s + Math.round(r * 2); next.set(k, (next.get(k) ?? 0) + pr / rs.length); }
    dist = next;
    obs += Math.round(rs[member] * 2);
    expd += rs.reduce((a, b) => a + b, 0) / rs.length * 2;
  }
  let worse = 0, better = 0, two = 0;
  for (const [s, pr] of dist) {
    if (s >= obs) worse += pr;
    if (s <= obs) better += pr;
    if (Math.abs(s - expd) >= Math.abs(obs - expd) - 1e-9) two += pr;
  }
  const n = unitRanks.length;
  return {
    units: n, ranks: unitRanks.map((rs) => rs[member]), meanRank: n ? r3(obs / 2 / n) : NaN, expectedMeanRank: n ? r3(expd / 2 / n) : NaN,
    pWorse: Number(Math.min(1, worse).toPrecision(4)), pBetter: Number(Math.min(1, better).toPrecision(4)), pTwoSided: Number(Math.min(1, two).toPrecision(4)),
    smallestAttainableOneSidedP: n ? Number(Math.pow(1 / 5, n).toPrecision(3)) : 1,
  };
}

// ───────────────────────────────────────────────────────────── tape plumbing (copied from backtest_set2.ts)

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const toCandles = (raw: Raw[]): Candle[] => raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));

/** The bar at or after `ts`, or the array length when there is none. Copied from `backtest_windows.ts`. */
function indexAtOrAfter(bars: Candle[], ts: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].start < ts) lo = mid + 1; else hi = mid; }
  return lo;
}

type WinName = "A" | "B" | "C" | "D";
type Win = {
  name: WinName;
  isSeries: "coinbase" | "combined";
  isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  isDays: number; oosDays: number; isFromIso: string; oosFromIso: string; oosToIso: string;
  scored: boolean; why: string;
};
const YEAR_MS = 365 * 86400e3;

/** The four windows, identical to `backtest_windows.ts` / `backtest_tape.ts` / `backtest_set2.ts`. */
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

/** |Δclose| in bps between two series over every bar they share. Copied from `backtest_tape.ts`. */
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

// ─────────────────────────────────────────── `run`, asked for a day's close — NOT a copy of it

type Mark = { t: number; eq: number; trades: number };
type DailyRun = { res: RunResult; marks: Mark[]; rets: Map<number, number>; from: number; to: number; start: number };

/**
 * `run`, asked for the equity at the close of every UTC day's last bar — one
 * `run` per day-end. `run(from, k + 1)` stops after bar k: its loop bound is the
 * only thing `to` changes, and its end-of-run equity is marked at bar k's close,
 * which is exactly the mark a per-bar copy of the loop would have pushed at k.
 * The trade count at each day-end comes free and brackets every fill to a day.
 * The mark set is the one `dailyMarks` keeps from a per-bar curve: the LAST bar
 * that starts on each UTC day, from the first bar `run` marks to the last.
 */
function runDaily(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], from: number, to: number,
  p: TrendParams, costs: Costs, stops: StopParams | null,
): DailyRun {
  const res = run(kind, symbol, bars, daily, from, to, p, costs, 4, stops);
  const start = Math.max(from, p.slow + 1);
  const marks: Mark[] = [];
  for (let k = start + 1; k <= to - 1; k++) {
    if (k < to - 1 && Math.floor(bars[k + 1].start / 86400e3) === Math.floor(bars[k].start / 86400e3)) continue;
    const r = k === to - 1 ? res : run(kind, symbol, bars, daily, from, k + 1, p, costs, 4, stops);
    marks.push({ t: bars[k].start, eq: 1 + r.ret, trades: r.trades });
  }
  return { res, marks, rets: dailyReturns(marks.map((m) => [m.t, m.eq] as [number, number])), from, to, start };
}

/**
 * The check `runDaily` owes: its marks against `run`'s OWN curve. `run` pushes
 * `[bar start, equity rounded to 5 dp]` every sixth bar; for evenly spaced
 * samples of that curve, `run` is asked again with `to` = that bar + 1, and the
 * two must agree to the rounding (≤ 5e-6). A property violation — anything in
 * `run` that read `to` — would show up here as a real difference.
 */
function prefixCheck(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], from: number, p: TrendParams, costs: Costs,
  stops: StopParams | null, res: RunResult, samples: number,
): { checks: number; worst: number } {
  const eqs = res.equity;
  if (!eqs.length) return { checks: 0, worst: 0 };
  let worst = 0, checks = 0;
  for (let s = 0; s < samples; s++) {
    const [t, e] = eqs[Math.min(eqs.length - 1, Math.floor((s + 0.5) * eqs.length / samples))];
    const k = indexAtOrAfter(bars, t);
    const r = run(kind, symbol, bars, daily, from, k + 1, p, costs, 4, stops);
    worst = Math.max(worst, Math.abs(1 + r.ret - e)); checks++;
  }
  return { checks, worst };
}

/**
 * The categorical state the loop would show Jev at every ENTRY `run` takes.
 * Fills are located from `run`'s own trade count: the day-end marks bracket each
 * fill to one day and a bisection on `to` finds the bar. All-in / all-out means
 * the odd fills are the entries. The state is the rulebook's own `buildSnapshot`
 * at the decision bar (flat, as every entry is), fed the daily candles CLOSED by
 * that bar's close; `ruleFor` must say "enter" there, and `mismatches` counts
 * where it does not.
 */
type EntryState = { decisionBarIso: string; strength: string; volatility: string; momentum: string; breakout: string; ruleSaysEnter: boolean };
function entryStates(
  symbol: string, bars: Candle[], daily: Candle[], dr: DailyRun, p: TrendParams, costs: Costs, stops: StopParams | null,
): EntryState[] {
  const out: EntryState[] = [];
  const pre = precompute(bars, p);
  for (let j = 1; j <= dr.res.trades; j += 2) {
    const m = dr.marks.findIndex((mk) => mk.trades >= j);
    if (m < 0) break;
    let lo = m > 0 ? indexAtOrAfter(bars, dr.marks[m - 1].t) + 1 : dr.start + 1;   // run(from, lo).trades < j
    let hi = indexAtOrAfter(bars, dr.marks[m].t) + 1;                               // run(from, hi).trades ≥ j
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (run("trend-4h", symbol, bars, daily, dr.from, mid, p, costs, 4, stops).trades >= j) hi = mid; else lo = mid;
    }
    const i = hi - 2;   // the fill is at bar hi − 1, decided on the close of the bar before it
    const cutoff = bars[i].start + 4 * 3600e3 - 86400e3;   // a daily candle is closed when its day has ended by this bar's close
    let dk = 0;
    { let a = 0, b = daily.length; while (a < b) { const md = (a + b) >> 1; if (daily[md].start <= cutoff) a = md + 1; else b = md; } dk = a; }
    const snap = buildSnapshot(symbol, bars, i, daily.slice(0, dk), FLAT, bars[i].start + 4 * 3600e3, p, pre, (24 / 4) * 365);
    out.push({
      decisionBarIso: iso(bars[i].start), strength: snap.state.trend_strength, volatility: snap.state.volatility,
      momentum: snap.state.momentum_30d, breakout: snap.state.breakout_4h,
      ruleSaysEnter: ruleFor("trend-4h", snap, FLAT, p).action === "enter",
    });
  }
  return out;
}

/**
 * Where an entry state sits for the model — the jev study's OWN partition
 * (`jev.json` `composition`), which its measurement confirmed (reference §4.21,
 * jev review §1): a weak trend is vetoed on every call, because the question the
 * model is asked says so in prose; moderate or strong at HIGH volatility is the
 * coin flip (P 0.55–0.64 against `enterMin` 0.60); moderate or strong at low or
 * normal volatility passes on every call. What the replies actually do to a
 * given coin's entries is `vetoShare`, read from the measured replies — this
 * only names the zone.
 */
function jevZone(strength: string, volatility: string): "weak" | "coinFlip" | "calm" {
  if (strength === "weak") return "weak";
  return volatility === "high" ? "coinFlip" : "calm";
}

/**
 * Every fill `run` makes, located from its own counters: fill j is at bar `hi − 1`
 * for the smallest `to` = hi with `run(from, hi).trades ≥ j`, it was a protective
 * stop when `stopsHit` steps up at that same `to`, and the equity at that bar's
 * close is `run`'s own. No price, fee or level is computed here.
 */
type Fill = { n: number; side: "buy" | "sell"; bar: number; barIso: string; stop: boolean; equityAfter: number };
function locateFills(
  symbol: string, bars: Candle[], daily: Candle[], dr: DailyRun, p: TrendParams, costs: Costs, stops: StopParams | null,
): Fill[] {
  const at = (to: number) => run("trend-4h", symbol, bars, daily, dr.from, to, p, costs, 4, stops);
  const out: Fill[] = [];
  let lo = dr.start + 1;   // at(lo).trades < 1
  for (let j = 1; j <= dr.res.trades; j++) {
    let hi = dr.to;        // at(hi).trades ≥ j
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (at(mid).trades >= j) hi = mid; else lo = mid; }
    const r = at(hi), before = at(hi - 1);
    out.push({ n: j, side: j % 2 ? "buy" : "sell", bar: hi - 1, barIso: iso(bars[hi - 1].start), stop: (r.stopsHit ?? 0) > (before.stopsHit ?? 0), equityAfter: r4(1 + r.ret) });
    lo = hi;               // one fill per bar, so at(hi).trades is exactly j
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? ""), rDir = String(args.rtape ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const set2Path = args.set2 ? String(args.set2) : "";
  const tapePath = args.tape ? String(args.tape) : "";
  const windowsPath = args.windows ? String(args.windows) : "";
  const jevPath = args.jev ? String(args.jev) : "";
  const answersPath = args.answers ? String(args.answers) : "";
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  if (!extDir) throw new Error("--ext <dir with BTC-USD_1h_kraken.json …> is required");
  if (!kDir) throw new Error("--ktape <dir with BTC-USD_4h_kraken.json …> is required");
  if (!rDir) throw new Error("--rtape <dir with BTC-USD_4h_revx.json …> is required");
  if (!(SAMPLED_UK_BOOK.revx[SUI].median > 0)) throw new Error("SAMPLED_UK_BOOK is not filled in");
  await Deno.mkdir(outDir, { recursive: true });
  const T0 = Date.now();
  const lap = (what: string) => console.log(`${what} — ${((Date.now() - T0) / 1000).toFixed(0)} s`);

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
    krakenCoverage: Record<string, { covered: boolean; why: string }>;
    revxCovered: boolean; revxFirst: number;
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

    const wins = windowsOn(comb4h, cb4h, MAX_LOOKBACK);
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    const krakenCoverage: Record<string, { covered: boolean; why: string }> = {};
    for (const w of wins) {
      if (!w.scored) { krakenCoverage[w.name] = { covered: false, why: `not scored on the published arm either: ${w.why}` }; continue; }
      const isArrCb = w.isSeries === "coinbase" ? cb4h : comb4h;
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
    const rejected: string[] = [];
    if (!ov4h.sharedBars || ov4h.sharedBars < 100) rejected.push(`overlap is ${ov4h.sharedBars} 4h bars — too few to verify`);
    else {
      if ((ov4h.medianBps ?? 0) > OVERLAP_MEDIAN_MAX_BPS) rejected.push(`overlap median ${ov4h.medianBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`);
      if ((ov4h.p95Bps ?? 0) > OVERLAP_P95_MAX_BPS) rejected.push(`overlap p95 ${ov4h.p95Bps} bps > ${OVERLAP_P95_MAX_BPS}`);
    }
    if (rejected.length) throw new Error(`${symbol}: the splice fails the acceptance test declared before the comparison — ${rejected.join("; ")}`);

    // The venue's own UK book, window A only, with set2's full acceptance rule.
    const rFirst = rTape.length ? rTape[0].start : Infinity;
    const rComb = [...kTape.filter((c) => c.start < rFirst), ...rTape];
    const rDaily = resample(rComb, 24);
    const revxArm: Arm = { c4h: rComb, daily: rDaily, is4h: rComb, isDaily: rDaily };
    const wA = wins.find((w) => w.name === "A")!;
    let revxWhy = "window A is not scored";
    let revxCoverage = 0, revxMedianVsCb: number | null = null;
    if (wA.scored) {
      const aFrom = comb4h[wA.oosFrom].start, aTo = endTs(comb4h, wA.oosTo);
      const scored = rComb.filter((c) => c.start >= aFrom && c.start < aTo);
      const fromRevx = scored.filter((c) => c.start >= rFirst).length;
      revxCoverage = scored.length ? fromRevx / scored.length : 0;
      const ovCb = tapeAgreement(cb4h, rTape, aFrom, aTo);
      revxMedianVsCb = ovCb.medianBps;
      revxWhy = "";
      if (!rTape.length) revxWhy = "no Revolut X tape for this pair";
      else if (rTape[rTape.length - 1].start + 4 * 3600e3 < aTo) revxWhy = `Revolut X's tape ends ${iso(rTape[rTape.length - 1].start)}, before window A's out-of-sample ends`;
      else if (revxCoverage < REVX_MIN_WINDOW_COVERAGE) revxWhy = `only ${(revxCoverage * 100).toFixed(1)} % of window A's scored bars are Revolut X's own`;
      else if (!ovCb.sharedBars || ovCb.sharedBars < 100) revxWhy = `overlap with Coinbase over window A is ${ovCb.sharedBars} bars — too few to verify`;
      else if ((ovCb.medianBps ?? 0) > OVERLAP_MEDIAN_MAX_BPS) revxWhy = `overlap median ${ovCb.medianBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`;
      else if ((ovCb.p95Bps ?? 0) > OVERLAP_P95_MAX_BPS) revxWhy = `overlap p95 ${ovCb.p95Bps} bps > ${OVERLAP_P95_MAX_BPS}`;
    }
    const revxCovered = revxWhy === "" && krakenCoverage.A?.covered === true;

    series[symbol] = {
      coinbase: { c4h: comb4h, daily: combDaily, is4h: cb4h, isDaily: cbDaily },
      kraken: { c4h: kTape, daily: kDaily, is4h: kIs4h, isDaily: kIsDaily },
      revx: revxArm, cb4h, wins, krakenCoverage, revxCovered, revxFirst: rFirst,
    };
    provenance.push({
      symbol,
      coinbase: { bars4h: cb4h.length, first: iso(cb4h[0].start), last: iso(cb4h[cb4h.length - 1].start) },
      combined: { bars4h: comb4h.length, first: iso(comb4h[0].start), last: iso(comb4h[comb4h.length - 1].start) },
      krakenTape: { bars4h: kTape.length, first: iso(kTape[0].start), last: iso(kTape[kTape.length - 1].start) },
      revxTape: { bars4h: rTape.length, first: rTape.length ? iso(rTape[0].start) : "", last: rTape.length ? iso(rTape[rTape.length - 1].start) : "", windowACoverage: r4(revxCoverage), medianBpsVsCoinbaseOverA: revxMedianVsCb, covered: revxCovered, why: revxWhy },
      overlapOverCoinbaseSpan: ov4h,
      windowsScored: wins.filter((w) => w.scored).map((w) => w.name),
      windowsPriced: wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name),
      windowsDropped: wins.filter((w) => !w.scored).map((w) => ({ window: w.name, why: w.why })),
      windowCalendar: wins.map((w) => ({ window: w.name, oosFrom: w.oosFromIso, oosTo: w.oosToIso, isDays: w.isDays, scored: w.scored })),
    });
    console.log(`${symbol.padEnd(9)} cb ${cb4h.length} | comb ${comb4h.length} (${isoDay(comb4h[0].start)}) | kraken ${kTape.length} | revx ${rTape.length} (A ${revxCovered ? "priced" : "dropped: " + revxWhy}) | windows ${wins.filter((w) => w.scored).map((w) => w.name).join("") || "—"}`);
  }

  /** Where the EARLIEST of the five coins' files ends — the last calendar point every member has. */
  const COMMON_END_TS = Math.min(...LIVE_ROW.symbols.map((s) => { const a = series[s].coinbase.c4h; return a[a.length - 1].start + 4 * 3600e3; }));

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
  const CONDITIONS: { reg: StopRule; tape: Tape; id: string }[] = STOP_RULES.flatMap((reg) => TAPES.map((tape) => ({ reg, tape, id: `${reg}·${tape}` })));
  const WINDOW_A_EXTRA: { reg: StopRule; tape: Tape; id: string }[] = STOP_RULES.map((reg) => ({ reg, tape: "revxuk" as Tape, id: `${reg}·revxuk` }));
  const armOf = (tape: Tape) => tape === "revxuk" ? "revx" as const : tape;
  const bookOf = (v: Venue, s: string) => (v === "revx" ? UK_BOOK_USD_PER_DAY[s] : KRAKEN_BOOK_USD_PER_DAY[s]) ?? 0;
  const LIVE_WINDOWS: WinName[] = ["A", "B", "C", "D"];

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
    if (tape === "revxuk") return s.revxCovered ? s.wins.filter((w) => w.name === "A" && w.scored) : [];
    return s.wins.filter((w) => w.scored && s.krakenCoverage[w.name].covered);
  }

  // ── `runDaily`, memoised, with its check against `run` on every cell ────
  const memo = new Map<string, DailyRun>();
  let prefixChecks = 0, prefixWorst = 0, runDailyCells = 0;
  function daily(symbol: string, tape: Tape, reg: StopRule, from: number, to: number, costs: Costs, costKey: string): DailyRun {
    const key = `${symbol}|${tape}|${reg}|${from}|${to}|${costKey}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const arm = series[symbol][armOf(tape)];
    const st = stopsOf(reg, DEFAULT_TREND);
    const dr = runDaily("trend-4h", symbol, arm.c4h, arm.daily, from, to, DEFAULT_TREND, costs, st);
    const pc = prefixCheck("trend-4h", symbol, arm.c4h, arm.daily, from, DEFAULT_TREND, costs, st, dr.res, 6);
    prefixChecks += pc.checks; prefixWorst = Math.max(prefixWorst, pc.worst); runDailyCells++;
    memo.set(key, dr);
    return dr;
  }
  function windowDaily(symbol: string, w: WinName, reg: StopRule, tape: Tape, costs: Costs = COSTS.revx, costKey = "revx"): DailyRun | null {
    const win = windowsPricedOn(symbol, tape).find((x) => x.name === w);
    if (!win) return null;
    const b = boundsOn(symbol, win, tape);
    return daily(symbol, tape, reg, b.oosFrom, b.oosTo, costs, costKey);
  }
  function spanDaily(symbol: string, tape: Tape, reg: StopRule, fromTs: number, toTs: number, costs: Costs = COSTS.revx, costKey = "revx"): DailyRun | null {
    const arm = series[symbol][armOf(tape)];
    const from = indexAtOrAfter(arm.c4h, fromTs), to = indexAtOrAfter(arm.c4h, toTs);
    if (to - from < 30) return null;
    return daily(symbol, tape, reg, from, to, costs, costKey);
  }

  // ── the per-coin grid and the §4.15 bar, per window ─────────────────────
  type Cell = {
    chosen: { fast: number; slow: number; atrStop: number };
    chosenOwn: ReturnType<typeof pick>; chosenOther: ReturnType<typeof pick>;
    seededOwn: ReturnType<typeof pick>; seededOther: ReturnType<typeof pick>;
    plateau: Plateau; chosenPass: boolean; seededPass: boolean; seededFailed: string[]; chosenFailed: string[];
    seededClears: boolean; chosenClears: boolean; chosenAvailable: boolean;
  };
  /** Copied from `backtest_set2.ts`'s `studyVenue`. */
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
      plateau, chosenPass: chosen.pass, seededPass: seeded.pass, seededFailed: seeded.failed, chosenFailed: chosen.failed,
      seededClears: seeded.pass && book, chosenClears: chosen.pass && book, chosenAvailable: inSample != null,
    };
  }

  const cells: Record<string, Record<string, Record<string, Record<string, Record<string, Cell>>>>> = {};
  let gridPoints = 0;
  for (const reg of STOP_RULES) {
    cells[reg] = {};
    for (const tape of TAPES_ALL) {
      cells[reg][tape] = {};
      for (const symbol of LIVE_ROW.symbols) {
        cells[reg][tape][symbol] = {};
        for (const w of windowsPricedOn(symbol, tape)) {
          const b = boundsOn(symbol, w, tape);
          const isRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.isArr, b.isDaily, b.isFrom, b.isTo, p, c, 4, stopsOf(reg, p));
          const oosRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, p, c, 4, stopsOf(reg, p));
          cells[reg][tape][symbol][w.name] = {};
          for (const v of VENUES) {
            cells[reg][tape][symbol][w.name][v] = studyVenue(symbol, v, tape === "revxuk" ? null : isRun, oosRun);
            gridPoints += TREND_GRID.length * (tape === "revxuk" ? 1 : 2);
          }
        }
      }
    }
  }
  lap("grid done");

  // ── the seeded cores the sleeves are built from: every coin × priced window × tape × stop rule, on Revolut X ──
  const cores: Record<string, Record<string, Record<string, Partial<Record<WinName, DailyRun>>>>> = {};
  for (const reg of STOP_RULES) {
    cores[reg] = {};
    for (const tape of TAPES_ALL) {
      cores[reg][tape] = {};
      for (const symbol of LIVE_ROW.symbols) {
        cores[reg][tape][symbol] = {};
        for (const w of windowsPricedOn(symbol, tape)) cores[reg][tape][symbol][w.name] = windowDaily(symbol, w.name, reg, tape) ?? undefined;
      }
    }
  }
  lap("window cores done");

  // ── sleeve helpers ─────────────────────────────────────────────────────
  const asSleeve = (symbol: string, dr: DailyRun, slotUsd: number): Sleeve => ({
    id: `trend-4h·revx·${symbol.split("/")[0]}`, symbol, slotUsd, rets: dr.rets,
    ret: dr.res.ret, maxDD: dr.res.maxDD, trades: dr.res.trades, exposure: dr.res.exposure,
    // Each fill counted at one slot of notional. Reported for scale only; no verdict reads it.
    tradedUsd: dr.res.trades * slotUsd,
  });
  /** A coin set's sleeve on one window at slots of capital ÷ |set| — set2's A1 arithmetic. */
  function windowSleeve(coinSet: string[], w: WinName, reg: StopRule, tape: Tape, slotUsd?: number): SleevePath | null {
    const members = coinSet.filter((s) => cores[reg][tape][s]?.[w]);
    if (members.length < 2) return null;
    const slot = slotUsd ?? LIVE_ROW.capitalUsd / coinSet.length;
    return combinePath(members.map((s) => asSleeve(s, cores[reg][tape][s][w]!, slot)));
  }
  function worstOf(per: Partial<Record<WinName, SleeveStats>>, only: WinName[] = LIVE_WINDOWS) {
    let best: { window: WinName | null; retOverDD: number; ret: number } = { window: null, retOverDD: Infinity, ret: Infinity };
    for (const w of only) { const s = per[w]; if (!s) continue; if (s.retOverDD < best.retOverDD) best = { window: w, retOverDD: s.retOverDD, ret: s.ret }; }
    return best.window == null ? { window: null, retOverDD: NaN, ret: NaN } : best;
  }
  function sleeveAcross(coinSet: string[], reg: StopRule, tape: Tape) {
    const per: Partial<Record<WinName, SleeveStats>> = {};
    for (const w of LIVE_WINDOWS) { const s = windowSleeve(coinSet, w, reg, tape); if (s) per[w] = s.stats; }
    return per;
  }
  /** Σ of a member's daily returns — its slot's P&L per dollar of slot, which is what it adds to the sleeve. */
  const contributionOf = (dr: DailyRun) => [...dr.rets.values()].reduce((a, b) => a + b, 0);

  /**
   * The five members of one unit (a window, a span or a fold) judged the same
   * way: what each adds (its slot P&L), what removing it does to the sleeve's
   * ret/DD at the SAME capital (slots rescaled from $20 to $25 — set2's A1
   * arithmetic), and what its $20 slot does to the dollar drawdown of the other
   * four at their own $20 (negative = it damps).
   */
  function judgeFive(runs: Record<string, DailyRun>) {
    const five = combinePath(LIVE_ROW.symbols.map((s) => asSleeve(s, runs[s], SLOT_USD)));
    const perCoin: Record<string, Record<string, unknown>> = {};
    const contrib: number[] = [], looDelta: number[] = [], marginalDD: number[] = [];
    for (const x of LIVE_ROW.symbols) {
      const others = LIVE_ROW.symbols.filter((s) => s !== x);
      const rescaled = combinePath(others.map((s) => asSleeve(s, runs[s], LIVE_ROW.capitalUsd / others.length)));
      const idle = combinePath(others.map((s) => asSleeve(s, runs[s], SLOT_USD)));
      const c = contributionOf(runs[x]);
      const d = rescaled.stats.retOverDD - five.stats.retOverDD;
      const m = five.ddUsd - idle.ddUsd;
      const mine = five.days.map((day) => SLOT_USD * (runs[x].rets.get(day) ?? 0));
      const othersOnFiveDays = five.days.map((day) => { let p = 0; for (const s of others) p += SLOT_USD * (runs[s].rets.get(day) ?? 0); return p; });
      contrib.push(c); looDelta.push(d); marginalDD.push(m);
      perCoin[x] = {
        own: pick(runs[x].res), slotPnlPerDollar: r4(c), slotPnlUsd: r2(c * SLOT_USD),
        withoutIt: { ret: rescaled.stats.ret, maxDD: rescaled.stats.maxDD, retOverDD: rescaled.stats.retOverDD, deltaRetOverDD: r2(d), deltaRet: r4(rescaled.stats.ret - five.stats.ret), deltaMaxDD: r4(rescaled.stats.maxDD - five.stats.maxDD) },
        theOtherFourAt20: { pnlUsd: idle.stats.pnlUsd, ddUsd: r2(idle.ddUsd) },
        marginalDollarDD: r2(m),
        correlationWithTheOtherFour: (() => { const c2 = pearson(mine, othersOnFiveDays); return c2 == null ? null : r3(c2); })(),
        shareOfTheFiveCoinWorstEpisode: five.episodeLossBy[x] ?? 0,
      };
    }
    const idx = LIVE_ROW.symbols.indexOf(SUI);
    const rank = { contribution: midRanks(contrib, true), looDeltaRetOverDD: midRanks(looDelta, false), marginalDollarDD: midRanks(marginalDD, false) };
    return {
      five, perCoin,
      fiveStats: { ret: five.stats.ret, maxDD: five.stats.maxDD, retOverDD: five.stats.retOverDD, pnlUsd: five.stats.pnlUsd, ddUsd: r2(five.ddUsd), worstEpisode: { peak: five.peakDay, trough: five.troughDay, lossByCoinUsd: five.episodeLossBy } },
      ranks: rank,
      suiRank: { contribution: rank.contribution[idx], looDeltaRetOverDD: rank.looDeltaRetOverDD[idx], marginalDollarDD: rank.marginalDollarDD[idx] },
      raw: { contrib, looDelta, marginalDD },
    };
  }

  // ─────────────────────────────────────────────────────────── the report shell
  const report: Record<string, unknown> = {
    study: "Does SUI deserve its seat in the LIVE `trend-4h` row? The four-window rule is structurally SILENT on it — SUI has windows A and B only, so C and D are four-coin sleeves whether or not SUI is in the row, the row's worst window is D in every condition, and `drop·SUI` reports a delta of exactly 0.00 in all four conditions: an identity, not a measurement. This study judges SUI where the evidence can see it, symmetrically with the other four members, and states every null exactly.",
    ownersQuestion: "SUI only passed window A — is it still worth including?",
    source: "The four data directories and the arm construction of `backtest_set2.ts`. `coinbase`: Kraken's quarterly bundle spliced strictly BEFORE the Coinbase series' first bar, Coinbase's from there — the tape every published table used. `kraken`: Kraken's own 4-hour tape end to end — what `signal_venue` makes the loop read. `revxuk`: Revolut X's public keyless UK book, one year, window A only. Fills, fees, the protective exits and the two-bar cooldown are `backtest.ts`'s `run`, called directly; this file holds no copy of it.",
    determinism: "No wall-clock or runtime field is written. Re-running over the same four data directories reproduces this file byte for byte; every null is enumerated exactly rather than sampled.",
    theQuestionTheFrameworkCannotAnswer: {
      rule: "an arm must beat the incumbent on the WORST of four walk-forward windows, in all four evaluations (2 tapes × 2 stop rules); windows are never averaged",
      whySilent: "SUI's combined tape begins 2023-05-03. Window C's in-sample would be the 142 days from there to the Coinbase series' first bar — under the 180-day floor — so C is not scored for SUI, and D's in-sample ends before SUI's tape begins, so D has nothing to fit on. C and D are FOUR-coin sleeves with or without SUI.",
      consequence: "the baseline's worst window is D in every condition, and `drop·SUI`'s delta there is 0 BY CONSTRUCTION. `set2.json` reports 0 / 0 / 0 / 0 and `conditionsImproved: 0`; neither number is evidence about SUI. `claimsChecked.dropSuiDeltaIsAnIdentity` recomputes it.",
    },
    preRegistered: {
      writtenBefore: "the primary test and its decision rule were written before any number in this file was computed, and did not change afterwards",
      addedAfterTheFirstRun: [
        "window A cut at the calendar end every coin's file reaches (s0 / s1 `windowAAtTheCommonEnd`) — the first run showed SUI's last window-A trade falls in hours only two of the five files have",
        "S_oos cut at the same common end",
        "the `jev.json` census cross-check (s7 `vsJevStudy`)",
        "the fold t-test's exact p, and the tails on S1's control",
        "the measured UK book (`sampledUkBook`) and the S5 arm priced on it",
        "S7 read against the model's MEASURED replies (`jev_answers.json`, reference §4.21) through `combineDecision`, and the census cross-check re-pointed at the jev study's measured-answers layout — that study replaced its recorded answers after this study's first run",
        "S0's `lastWindowATrades`: SUI's window-A fills on each tape, located from `run`'s own trade and stop counters",
      ],
      primary: "S3's exchangeability test on the COST OF REMOVING each member — Δ ret/DD of the sleeve without it, capital rescaled — under the SHIPPED stop, on BOTH backbone tapes. Under 'SUI's seat is like any other member's', SUI's rank among the five is uniform in every fold; the rank sum's null is enumerated exactly.",
      decision: {
        drop: "pWorse < 0.05 on BOTH tapes → the performance evidence says drop SUI from the live row",
        keepSupported: "pBetter < 0.05 on BOTH tapes → the performance evidence supports the seat",
        otherwise: "the performance evidence cannot decide, and the recommendation says so rather than choosing a side",
      },
      secondary: "S1 (the windows SUI has), S2 (the span where all five exist), S3's fold sign tests and contribution / damping ranks, S4 (drawdown), S5 (spread) — each reported with its arm count; none is promoted to a verdict after the fact.",
      paper: "a separate, lower bar: §4.15's admission test under the running stop rule, and whether a paper seat measures something no backtest can.",
    },
    windows: {
      A: "parameters on the first two thirds, the LAST third out of sample (bear, majors −39.4 %)",
      B: "parameters on the first third, the MIDDLE third out of sample (bull, +72.3 %)",
      C: "parameters on the 24 months of extended history before the series, the FIRST third out of sample (stronger bull, +243.0 %)",
      D: "parameters on the 24 months before that, the 12 months before the series out of sample (sideways, −5.8 %)",
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
      perCoinCalendars: "each coin's windows are cut on its OWN Coinbase bar count, as every published table cut them, so the five coins' windows differ by a few days at the edges; the sleeves union the days, exactly as set2's A1 did",
    },
    stopRules: {
      note: "EVERY figure in this file is reported under `shipped` and `trail`, never averaged between them.",
      shipped: { stops: stopsForKind("trend-4h", DEFAULT_TREND), constant: { ...SHIPPED_STOPS }, what: "what backtest.ts ships and tick.ts runs — the 8 % floor alone, the intra-bar trail removed 2026-09-21 (§3.13)" },
      trail: { stops: { ...PINNED_STOPS }, what: "the 8 % floor plus the 3×ATR(14) intra-bar trail — what §3.7 / §3.8 / §3.10 / §3.11, and SUI's admission, were computed under" },
    },
    conditions: { backbone: CONDITIONS.map((c) => c.id), windowAOnly: WINDOW_A_EXTRA.map((c) => c.id) },
    bar: "reference §3.7 / §4.15: positive out of sample on the running venue's costs, max drawdown < 35 %, at least half the grid positive out of sample, positive on the other venue's costs — on BOTH walk-forward windows — plus a Revolut X UK book of at least $100k a day.",
    costs: COSTS,
    suiSpreadArms: SUI_HALF_SPREADS.map((a) => ({ ...a, halfSpreadBps: r3(a.halfSpread * 1e4), roundTripBps: r2(2 * a.halfSpread * 1e4 + 2 * COSTS.revx.takerBps) })),
    sampledUkBook: SAMPLED_UK_BOOK,
    roundTripBpsAsCharged: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, r2(2 * spreadOf(COSTS.revx, s) * 1e4 + 2 * COSTS.revx.takerBps)])),
    ukBookUsdPerDay: UK_BOOK_USD_PER_DAY,
    krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY,
    minBookUsd: MIN_BOOK_USD,
    caps: { maxOrderUsd: MAX_ORDER_USD, slotUsd: SLOT_USD, liveRow: LIVE_ROW, fourCoinSet: FOUR, note: "dropping SUI and keeping $100 means four $25 slots, which needs `max_order_usd` raised from $20; dropping SUI and changing nothing else leaves four $20 slots and $20 idle. Both are priced." },
    grids: { "trend-4h": { points: TREND_GRID.length, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [2, 3, 4], seeded: { fast: DEFAULT_TREND.fast, slow: DEFAULT_TREND.slow, atrStop: DEFAULT_TREND.atrStop } } },
    data: { symbols: LIVE_ROW.symbols, perSymbol: provenance },
  };

  // ── fidelity ───────────────────────────────────────────────────────────
  const fid: Record<string, unknown> = {};
  {
    // `combinePath`'s stats are `combine`'s; its own path must reproduce the drawdown `combine` reports.
    let checks = 0, worstDD = 0;
    for (const c of [...CONDITIONS, ...WINDOW_A_EXTRA]) for (const w of LIVE_WINDOWS) {
      const p = windowSleeve(LIVE_ROW.symbols, w, c.reg, c.tape);
      if (!p) continue;
      checks++;
      worstDD = Math.max(worstDD, Math.abs(p.stats.maxDD - r4(p.ddFraction)));
    }
    fid.combinePath = { note: "`combinePath` returns `combine`'s own stats beside the dollar path; the path's own max drawdown must equal the one `combine` reports.", checks, worstAbsDrawdownDiff: worstDD };
  }

  const baselineByCond: Record<string, Partial<Record<WinName, SleeveStats>>> = {};
  const dropSuiByCond: Record<string, Partial<Record<WinName, SleeveStats>>> = {};
  for (const c of CONDITIONS) { baselineByCond[c.id] = sleeveAcross(LIVE_ROW.symbols, c.reg, c.tape); dropSuiByCond[c.id] = sleeveAcross(FOUR, c.reg, c.tape); }

  if (set2Path) {
    // deno-lint-ignore no-explicit-any
    const sj = JSON.parse(await Deno.readTextFile(set2Path)) as Record<string, any>;
    const rows: Record<string, unknown>[] = [];
    let compared = 0;
    const base = sj.a1_theCoins?.baseline?.perCondition ?? {};
    // deno-lint-ignore no-explicit-any
    const dropArm = (sj.a1_theCoins?.arms ?? []).find((a: any) => a.coin === SUI && a.kind === "drop");
    for (const c of CONDITIONS) for (const w of LIVE_WINDOWS) {
      const pub = base[c.id]?.perWindow?.[w], here = baselineByCond[c.id][w];
      if (pub && here) for (const f of ["ret", "maxDD", "retOverDD", "pnlUsd", "capitalUsd", "members"] as const) {
        compared++;
        const d = (here[f] as number) - (pub[f] as number);
        if (Math.abs(d) > 1e-9) rows.push({ arm: "baseline(5)", condition: c.id, window: w, field: f, published: pub[f], here: here[f], delta: r4(d) });
      }
      const pubD = dropArm?.perCondition?.[c.id]?.perWindow?.[w], hereD = dropSuiByCond[c.id][w];
      if (pubD && hereD) for (const f of ["ret", "maxDD", "retOverDD", "members"] as const) {
        compared++;
        const d = (hereD[f] as number) - (pubD[f] as number);
        if (Math.abs(d) > 1e-9) rows.push({ arm: "drop·SUI(4)", condition: c.id, window: w, field: f, published: pubD[f], here: hereD[f], delta: r4(d) });
      }
    }
    // Window A on the venue's own book, both arms.
    for (const c of WINDOW_A_EXTRA) {
      const pub = sj.a1_theCoins?.baseline?.windowAThreeTapes?.[c.id], here = windowSleeve(LIVE_ROW.symbols, "A", c.reg, c.tape)?.stats;
      if (pub && here) for (const f of ["ret", "maxDD", "retOverDD", "pnlUsd"] as const) {
        compared++;
        const d = (here[f] as number) - (pub[f] as number);
        if (Math.abs(d) > 1e-9) rows.push({ arm: "baseline(5)", condition: c.id, window: "A", field: f, published: pub[f], here: here[f], delta: r4(d) });
      }
      const pubD = dropArm?.windowAThreeTapes?.perCell?.[c.id], hereD = windowSleeve(FOUR, "A", c.reg, c.tape)?.stats;
      if (pubD && hereD) {
        compared++;
        const d = hereD.retOverDD - pubD.armRetOverDD;
        if (Math.abs(d) > 1e-9) rows.push({ arm: "drop·SUI(4)", condition: c.id, window: "A", field: "retOverDD", published: pubD.armRetOverDD, here: hereD.retOverDD, delta: r4(d) });
      }
    }
    fid.vsSet2 = { note: "every A1 cell this study re-derives — the five-coin baseline and the `drop·SUI` arm, four conditions × four windows, plus window A on the venue's own book — against the committed `set2.json`, which was built by a different runner (`runSet`, a copy of `run`). Zero differences means `runDaily` produces the published sleeves and every comparison below is the question being asked.", file: set2Path, sha256: await sha(set2Path), cellsCompared: compared, differences: rows.length, rows: rows.slice(0, 40) };
  }
  // deno-lint-ignore no-explicit-any
  let tapeJson: Record<string, any> | null = null;
  if (tapePath) {
    tapeJson = JSON.parse(await Deno.readTextFile(tapePath));
    const rows: Record<string, unknown>[] = [];
    let compared = 0;
    const pcv = tapeJson?.t3_theBar?.perCoinVerdicts ?? {};
    for (const reg of STOP_RULES) for (const symbol of LIVE_ROW.symbols) for (const w of LIVE_WINDOWS) for (const v of VENUES) for (const tape of TAPES) {
      const pub = pcv[reg]?.[symbol]?.[w]?.[v]?.[tape];
      const here = cells[reg][tape][symbol]?.[w]?.[v];
      if (!pub || !here) continue;
      const pairs: [string, unknown, unknown][] = [
        ["seededPass", pub.seededPass, here.seededPass], ["chosenPass", pub.chosenPass, here.chosenPass], ["plateau", pub.plateau, here.plateau.positiveShare],
        ["chosen.fast", pub.chosen?.fast, here.chosen.fast], ["chosen.slow", pub.chosen?.slow, here.chosen.slow], ["chosen.atrStop", pub.chosen?.atrStop, here.chosen.atrStop],
        ["seededOwn.ret", pub.seededOwn?.ret, here.seededOwn.ret], ["seededOwn.maxDD", pub.seededOwn?.maxDD, here.seededOwn.maxDD], ["seededOwn.trades", pub.seededOwn?.trades, here.seededOwn.trades],
        ["chosenOwn.ret", pub.chosenOwn?.ret, here.chosenOwn.ret], ["chosenOwn.maxDD", pub.chosenOwn?.maxDD, here.chosenOwn.maxDD], ["chosenOwn.trades", pub.chosenOwn?.trades, here.chosenOwn.trades],
      ];
      for (const [f, a, b] of pairs) {
        compared++;
        const differs = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-9 : a !== b;
        if (differs) rows.push({ stopRule: reg, symbol, window: w, venue: v, tape, field: f, published: a, here: b });
      }
    }
    fid.vsTape = { note: "every §4.15 cell for the live five in `tape.json`'s §T3 — two stop rules × two tapes × two venues × every priced window: both pass flags, the plateau share, the chosen point, and the seeded and chosen out-of-sample return / drawdown / trade count.", file: tapePath, sha256: await sha(tapePath), cellsCompared: compared, differences: rows.length, rows: rows.slice(0, 40) };
  }
  lap("fidelity done");

  // ── S0 — SUI's own record, and §3.8's verdict re-asked under the shipped stop ──
  {
    const perCoin: Record<string, unknown> = {};
    for (const symbol of LIVE_ROW.symbols) {
      const byCond: Record<string, unknown> = {};
      for (const reg of STOP_RULES) {
        const agree: Record<string, string[]> = {};
        for (const how of ["seeded", "chosen"] as const) {
          const perTape: Record<string, WinName[]> = {};
          for (const tape of TAPES) perTape[tape] = LIVE_WINDOWS.filter((w) => { const c = cells[reg][tape][symbol]?.[w]?.revx; return !!c && (how === "seeded" ? c.seededClears : c.chosenClears); });
          byCond[`${reg}·${how}`] = { ...perTape, windowsPriced: LIVE_WINDOWS.filter((w) => cells[reg].coinbase[symbol]?.[w]?.revx) };
          agree[how] = LIVE_WINDOWS.filter((w) => perTape.coinbase.includes(w) && perTape.kraken.includes(w));
        }
        byCond[`${reg}·bothTapesAgree`] = agree;
      }
      const revxA: Record<string, unknown> = {};
      for (const reg of STOP_RULES) { const c = cells[reg].revxuk[symbol]?.A?.revx; if (c) revxA[reg] = { seededOwn: c.seededOwn, seededPass: c.seededPass, seededFailed: c.seededFailed }; }
      perCoin[symbol] = { ...byCond, windowAOnTheVenuesOwnBook: revxA };
    }
    const cellOf = (reg: StopRule, tape: Tape, w: WinName) => cells[reg][tape][SUI]?.[w]?.revx;
    const detail = (reg: StopRule, tape: Tape, how: "seeded" | "chosen") => Object.fromEntries((["A", "B"] as WinName[]).map((w) => {
      const c = cellOf(reg, tape, w);
      if (!c) return [w, null];
      const own = how === "seeded" ? c.seededOwn : c.chosenOwn, oth = how === "seeded" ? c.seededOther : c.chosenOther;
      return [w, { clears: how === "seeded" ? c.seededClears : c.chosenClears, params: how === "seeded" ? { fast: 20, slow: 100, atrStop: 3 } : c.chosen, ownRet: own.ret, ownMaxDD: own.maxDD, trades: own.trades, plateau: c.plateau.positiveShare, otherVenueRet: oth.ret, failed: how === "seeded" ? c.seededFailed : c.chosenFailed }];
    }));
    const both = (reg: StopRule, tape: Tape, how: "seeded" | "chosen") => { const d = detail(reg, tape, how) as Record<string, { clears: boolean } | null>; return !!d.A?.clears && !!d.B?.clears; };
    const regimes: Record<string, unknown> = {};
    for (const reg of STOP_RULES) for (const tape of TAPES) for (const how of ["chosen", "seeded"] as const) regimes[`${reg}·${tape}·${how}`] = { clearsBothWalkForwardWindows: both(reg, tape, how), windows: detail(reg, tape, how) };
    // Window A ends where each coin's DATA ends, and the five files end 36 hours apart (BTC/ETH/SOL 2026-09-20 00:00,
    // AVAX/SUI 2026-09-21 12:00), so the published window A gives AVAX and SUI 36 hours the other three do not have.
    // The same §4.15 cell cut at the COMMON end for every coin, so a verdict is not an accident of when a file was
    // downloaded. In-sample, and therefore the chosen point, is unchanged.
    const commonEnd: Record<string, unknown> = {};
    for (const reg of STOP_RULES) for (const tape of TAPES_ALL) for (const symbol of LIVE_ROW.symbols) {
      const w = windowsPricedOn(symbol, tape).find((x) => x.name === "A");
      if (!w) continue;
      const b = boundsOn(symbol, w, tape);
      const oosTo = Math.min(b.oosTo, indexAtOrAfter(b.oosArr, COMMON_END_TS));
      const isRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.isArr, b.isDaily, b.isFrom, b.isTo, p, c, 4, stopsOf(reg, p));
      const oosRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, oosTo, p, c, 4, stopsOf(reg, p));
      const cut = oosTo === b.oosTo ? cells[reg][tape][symbol].A.revx : studyVenue(symbol, "revx", tape === "revxuk" ? null : isRun, oosRun);
      const pub = cells[reg][tape][symbol].A.revx;
      commonEnd[`${reg}·${tape}·${symbol}`] = {
        barsCut: b.oosTo - oosTo, lastBar: iso(b.oosArr[oosTo - 1].start),
        seeded: { ret: cut.seededOwn.ret, maxDD: cut.seededOwn.maxDD, trades: cut.seededOwn.trades, clears: cut.seededClears, publishedRet: pub.seededOwn.ret, publishedClears: pub.seededClears },
        chosen: tape === "revxuk" ? null : { ret: cut.chosenOwn.ret, clears: cut.chosenClears, publishedRet: pub.chosenOwn.ret, publishedClears: pub.chosenClears },
      };
    }
    // SUI's window-A fills on every tape under the running stop, located from `run`'s own counters, with the raw bars
    // from its last entry to the window's end — the evidence for the common-end note. No level is computed here.
    const lastWindowATrades: Record<string, unknown> = {};
    for (const tape of TAPES_ALL) {
      const dr = cores.shipped[tape][SUI]?.A;
      if (!dr) continue;
      const arm = series[SUI][armOf(tape)];
      const fills = locateFills(SUI, arm.c4h, arm.daily, dr, DEFAULT_TREND, COSTS.revx, stopsOf("shipped", DEFAULT_TREND));
      const trades: Record<string, unknown>[] = [];
      let eqBefore = 1;
      for (let k = 0; k < fills.length; k += 2) {
        const buy = fills[k], sell = fills[k + 1];
        const endEq = sell ? sell.equityAfter : r4(1 + dr.res.ret);
        trades.push({ entryBar: buy.barIso, exitBar: sell?.barIso ?? null, exitWasStop: sell ? sell.stop : null, ret: r4(endEq / eqBefore - 1), openAtWindowEnd: !sell });
        eqBefore = endEq;
      }
      const lastBuy = [...fills].reverse().find((f) => f.side === "buy");
      lastWindowATrades[tape] = {
        fills: fills.map((f) => ({ n: f.n, side: f.side, bar: f.barIso, stop: f.stop, equityAfter: f.equityAfter, open: arm.c4h[f.bar].open, low: arm.c4h[f.bar].low, afterCommonEnd: arm.c4h[f.bar].start >= COMMON_END_TS })),
        trades,
        barsFromTheLastEntry: lastBuy ? arm.c4h.slice(lastBuy.bar, dr.to).map((b) => ({ bar: iso(b.start), open: b.open, low: b.low, close: b.close, afterCommonEnd: b.start >= COMMON_END_TS })) : [],
        lastDayEndMarks: dr.marks.slice(-4).map((m) => ({ day: isoDay(m.t), equity: r4(m.eq) })),
        windowEndEquity: r4(1 + dr.res.ret),
      };
    }
    report.s0_suiOwnRecord = {
      question: "Does §3.8's admission of SUI — 'only SUI and POL cleared both windows' — reproduce under the stop rule `tick.ts` actually runs? And what does SUI's own §4.15 record say today?",
      method: "§4.15's four tests per window, the same 27-point grid, Revolut X costs, the UK-book test applied — every stop rule × tape × parameter point, never averaged. §3.8 itself was `trail · coinbase · chosen`.",
      suiAdmissionRegimes: regimes,
      reproducesSection38: both("trail", "coinbase", "chosen"),
      clearsTheBarUnderTheRunningRule: { seeded: { coinbase: both("shipped", "coinbase", "seeded"), kraken: both("shipped", "kraken", "seeded") }, chosen: { coinbase: both("shipped", "coinbase", "chosen"), kraken: both("shipped", "kraken", "chosen") } },
      windowAAtTheCommonEnd: {
        note: `window A cut at ${iso(COMMON_END_TS)} — where the EARLIEST of the five files ends — for every coin. For BTC, ETH and SOL nothing changes; AVAX and SUI lose the hours only their files have, which hold the end of SUI's last window-A trade (\`lastWindowATrades\` gives the fills and the bars).`,
        cells: commonEnd,
      },
      lastWindowATrades: {
        note: "SUI's window-A fills under the running stop on each tape — seeded, Revolut X costs — located from `run`'s own trade and stop counters: a fill is at the first bar where `run`'s trade count reaches it, and it was a protective stop when `run`'s stop count steps up at the same bar. `equityAfter` is `run`'s equity at that bar's close; a trade's `ret` is the ratio of the equities either side of it. The bars are the tape's own, from the last entry to the window's end.",
        commonEnd: iso(COMMON_END_TS),
        perTape: lastWindowATrades,
      },
      perCoin,
      reading: "a per-coin pass is not the argument for a live seat (§4.15): the bar ADMITS, the sleeve decides money. Its population base rate is in `multipleComparisons.barBaseRate`.",
    };
  }
  lap("S0 done");

  // ── S1 — the windows SUI has, all five coins judged the same way ───────
  const s1Units: { cond: string; reg: StopRule; tape: Tape; w: WinName; j: ReturnType<typeof judgeFive> }[] = [];
  {
    const byCondition: Record<string, unknown> = {};
    for (const c of [...CONDITIONS, ...WINDOW_A_EXTRA]) {
      const per: Record<string, unknown> = {};
      for (const w of (c.tape === "revxuk" ? ["A"] : ["A", "B"]) as WinName[]) {
        const runs: Record<string, DailyRun> = {};
        for (const s of LIVE_ROW.symbols) { const dr = cores[c.reg][c.tape][s]?.[w]; if (dr) runs[s] = dr; }
        if (Object.keys(runs).length !== LIVE_ROW.symbols.length) continue;
        const j = judgeFive(runs);
        s1Units.push({ cond: c.id, reg: c.reg, tape: c.tape, w, j });
        per[w] = { five: j.fiveStats, suiRank: j.suiRank, perCoin: j.perCoin, ranksOfAllFive: j.ranks };
      }
      // The shared-window ranking: the worst of {A, B} with and without each coin — the four-window rule restricted to the windows every member has.
      const shared: Record<string, unknown> = {};
      if (c.tape !== "revxuk") for (const x of LIVE_ROW.symbols) {
        const set = LIVE_ROW.symbols.filter((s) => s !== x);
        const arm = sleeveAcross(set, c.reg, c.tape), base = baselineByCond[c.id];
        const wa = worstOf(arm, ["A", "B"]), wb = worstOf(base, ["A", "B"]);
        const fa = worstOf(arm), fb = worstOf(base);
        shared[`drop·${x.split("/")[0]}`] = {
          worstOfAB: { window: wa.window, retOverDD: wa.retOverDD, baselineWindow: wb.window, baselineRetOverDD: wb.retOverDD, delta: r2(wa.retOverDD - wb.retOverDD), improves: wa.retOverDD > wb.retOverDD },
          worstOfFour: { window: fa.window, retOverDD: fa.retOverDD, baselineWindow: fb.window, baselineRetOverDD: fb.retOverDD, delta: r2(fa.retOverDD - fb.retOverDD), improves: fa.retOverDD > fb.retOverDD },
        };
      }
      byCondition[c.id] = { perWindow: per, leaveOneOutOnTheSharedWindows: shared };
    }
    // The same judgement on window A cut at the common end (see S0): AVAX's and SUI's extra 36 hours removed.
    const commonEndA: Record<string, unknown> = {};
    for (const c of [...CONDITIONS, ...WINDOW_A_EXTRA]) {
      const runs: Record<string, DailyRun> = {};
      for (const s of LIVE_ROW.symbols) {
        const w = windowsPricedOn(s, c.tape).find((x) => x.name === "A");
        if (!w) continue;
        const b = boundsOn(s, w, c.tape);
        runs[s] = daily(s, c.tape, c.reg, b.oosFrom, Math.min(b.oosTo, indexAtOrAfter(b.oosArr, COMMON_END_TS)), COSTS.revx, "revx");
      }
      if (Object.keys(runs).length !== LIVE_ROW.symbols.length) continue;
      const j = judgeFive(runs);
      const sui = j.perCoin[SUI] as { withoutIt: { ret: number; maxDD: number; retOverDD: number; deltaRetOverDD: number }; slotPnlPerDollar: number; marginalDollarDD: number };
      commonEndA[c.id] = { five: j.fiveStats, withoutSui: sui.withoutIt, suiSlotPnlPerDollar: sui.slotPnlPerDollar, suiMarginalDollarDD: sui.marginalDollarDD, suiRank: j.suiRank };
    }
    const armsPassing = LIVE_ROW.symbols.filter((x) => CONDITIONS.every((c) => {
      const s = (byCondition[c.id] as { leaveOneOutOnTheSharedWindows: Record<string, { worstOfAB: { improves: boolean } }> }).leaveOneOutOnTheSharedWindows[`drop·${x.split("/")[0]}`];
      return s?.worstOfAB.improves === true;
    }));
    const suiShipped = s1Units.filter((u) => u.reg === "shipped");
    report.s1_theWindowsSuiHas = {
      question: "Judge every member on the windows SUI has — A and B — the same way, so SUI is compared with the other four on identical evidence.",
      method: "the seeded sleeve on Revolut X costs, per window. For each coin: what its slot adds (Σ of its daily returns × $20), what removing it does to the sleeve's ret/DD with the capital rescaled to four $25 slots (set2's A1 arithmetic), and what its $20 slot does to the other four's DOLLAR drawdown at their own $20 (negative = it damps). Ranks: 1 = best for the sleeve. Plus the four-window rule restricted to {A, B} for every drop.",
      caveat: "restricting to {A, B} discards the two windows that carry most of the information about the OTHER four coins, and D is the window the live row loses in. This is a like-for-like comparison of the five members, not a replacement for the four-window rule, and a coin that wins it has not cleared §4.15's bar.",
      byCondition,
      windowAAtTheCommonEnd: { note: `window A cut at ${iso(COMMON_END_TS)} for every coin, so AVAX and SUI lose the 36 hours only their files have — including SUI's last trade (see S0).`, byCondition: commonEndA },
      control: {
        arms: LIVE_ROW.symbols.length, conditions: CONDITIONS.length,
        dropsImprovingTheSharedWorstInAllFourConditions: armsPassing,
        expectedByChanceIndependent: r3(LIVE_ROW.symbols.length * Math.pow(0.5, CONDITIONS.length)),
        expectedByChanceFullyCorrelated: r3(LIVE_ROW.symbols.length * 0.5),
        pAtLeastThatManyIndependent: Number(binomTail(LIVE_ROW.symbols.length, armsPassing.length, Math.pow(0.5, CONDITIONS.length)).toPrecision(3)),
        pAtLeastThatManyFullyCorrelated: Number(binomTail(LIVE_ROW.symbols.length, armsPassing.length, 0.5).toPrecision(3)),
        note: "five drop arms, four near-duplicate evaluations (2 tapes × 2 stop rules). The two nulls bracket the truth and the correlated one is the one to read — §3.19 measured the evaluations' agreement at 0.63–0.83, and §4.21 found the independent null unusable on the window that decides set2's A1.",
      },
      suiRanksUnderTheShippedStop: suiShipped.map((u) => ({ condition: u.cond, window: u.w, ...u.j.suiRank })),
    };
  }
  lap("S1 done");

  // ── the spans where all five exist ───────────────────────────────────────
  type SpanDef = { id: string; what: string; fromTs: number; toTs: number };
  const spans: SpanDef[] = [];
  {
    const starts = LIVE_ROW.symbols.map((s) => { const a = series[s].coinbase.c4h; return a[Math.min(a.length - 1, DEFAULT_TREND.slow + 1)].start; });
    const ends = LIVE_ROW.symbols.map((s) => { const a = series[s].coinbase.c4h; return a[a.length - 1].start; });
    const fromTs = Math.max(...starts), toTs = Math.min(...ends) + 4 * 3600e3;
    spans.push({ id: "S_full", what: `every bar on which the seeded rule can decide on all five coins: ${iso(fromTs)} → ${iso(toTs)}. SUI's tape is the binding constraint at the front.`, fromTs, toTs });
    const suiW = series[SUI].wins;
    const wA = suiW.find((w) => w.name === "A")!, wB = suiW.find((w) => w.name === "B")!;
    const comb = series[SUI].coinbase.c4h;
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    const oosEnd = Math.min(endTs(comb, wA.oosTo), COMMON_END_TS);
    spans.push({ id: "S_oos", what: `SUI's windows B and A joined — its two consecutive out-of-sample years priced as ONE equity curve, cut at the common end every coin's file reaches (see S0): ${iso(comb[wB.oosFrom].start)} → ${iso(oosEnd)}`, fromTs: comb[wB.oosFrom].start, toTs: oosEnd });
  }
  const sFull = spans[0];

  // ── S2 — the contiguous spans ─────────────────────────────────────────────
  {
    const out: Record<string, unknown> = {};
    for (const sp of spans) {
      const byCond: Record<string, unknown> = {};
      for (const c of CONDITIONS) {
        const runs: Record<string, DailyRun> = {};
        for (const s of LIVE_ROW.symbols) { const dr = spanDaily(s, c.tape, c.reg, sp.fromTs, sp.toTs); if (dr) runs[s] = dr; }
        if (Object.keys(runs).length !== LIVE_ROW.symbols.length) continue;
        const j = judgeFive(runs);
        const four25 = combinePath(FOUR.map((s) => asSleeve(s, runs[s], LIVE_ROW.capitalUsd / FOUR.length)));
        const four20 = combinePath(FOUR.map((s) => asSleeve(s, runs[s], SLOT_USD)));
        const acct = (p: SleevePath, idleUsd: number) => {
          const eqAcct = p.equityUsd.map((e) => e + idleUsd);
          let peak = LIVE_ROW.capitalUsd, dd = 0;
          for (const e of eqAcct) { peak = Math.max(peak, e); dd = Math.max(dd, 1 - e / peak); }
          const ret = p.stats.pnlUsd / LIVE_ROW.capitalUsd;
          return { pnlUsd: p.stats.pnlUsd, ret: r4(ret), maxDD: r4(dd), retOverDD: r2(ret / Math.max(0.05, dd)), ddUsd: r2(p.ddUsd) };
        };
        byCond[c.id] = {
          fiveAt20: acct(j.five, 0),
          fourAt25: { ...acct(four25, 0), note: "drop SUI and raise the slot to $25 — what set2's A1 arm prices; needs `max_order_usd` raised" },
          fourAt20: { ...acct(four20, LIVE_ROW.capitalUsd - FOUR.length * SLOT_USD), note: "drop SUI and change nothing else — $80 at risk, $20 idle; on the whole $100 account" },
          suiRank: j.suiRank, perCoin: j.perCoin,
        };
      }
      out[sp.id] = { what: sp.what, from: isoDay(sp.fromTs), to: isoDay(sp.toTs), years: r2((sp.toTs - sp.fromTs) / YEAR_MS), byCondition: byCond };
    }
    report.s2_theSpanWhereAllFiveExist = {
      question: "Over the exact span where all five coins exist, is the five-coin sleeve better or worse than the four-coin one?",
      method: "one continuous seeded run per coin over the span — nothing is chosen anywhere in it — combined at equal slots. Three allocations on the same $100 account: five $20 slots; four $25 slots (drop SUI, raise `max_order_usd`); four $20 slots and $20 idle (drop SUI, change nothing else).",
      caveat: "a span is ONE path: its return is one draw, and it overlaps windows A and B. The seeded point was fixed long before any of it, but it is the point every table already reports, so this is not an untouched hold-out. S3 splits the same span into folds to put an error bar on it.",
      spans: out,
    };
  }
  lap("S2 done");

  // ── S3 — consecutive folds tiling the SUI era ─────────────────────────────
  const foldSummaries: Record<string, Record<string, unknown>> = {};
  {
    const spanMs = sFull.toTs - sFull.fromTs;
    const K = Math.max(2, Math.round(spanMs / 86400e3 / FOLD_TARGET_DAYS));
    const foldMs = spanMs / K;
    const folds = [...Array(K)].map((_, k) => ({ id: k + 1, fromTs: sFull.fromTs + Math.round(k * foldMs), toTs: sFull.fromTs + Math.round((k + 1) * foldMs) }));
    const byCondition: Record<string, unknown> = {};
    for (const c of CONDITIONS) {
      const rows: Record<string, unknown>[] = [];
      const units: ReturnType<typeof judgeFive>[] = [];
      for (const f of folds) {
        const runs: Record<string, DailyRun> = {};
        for (const s of LIVE_ROW.symbols) { const dr = spanDaily(s, c.tape, c.reg, f.fromTs, f.toTs); if (dr) runs[s] = dr; }
        if (Object.keys(runs).length !== LIVE_ROW.symbols.length) continue;
        const j = judgeFive(runs);
        units.push(j);
        const without = j.perCoin[SUI] as { withoutIt: { ret: number; maxDD: number; retOverDD: number }; slotPnlPerDollar: number; own: { trades: number } };
        rows.push({
          fold: f.id, from: iso(f.fromTs), to: iso(f.toTs),
          five: { ret: j.fiveStats.ret, maxDD: j.fiveStats.maxDD, retOverDD: j.fiveStats.retOverDD, ddUsd: j.fiveStats.ddUsd },
          withoutSui: without.withoutIt,
          deltaRet: r4(without.withoutIt.ret - j.fiveStats.ret), deltaMaxDD: r4(without.withoutIt.maxDD - j.fiveStats.maxDD), deltaRetOverDD: r2(without.withoutIt.retOverDD - j.fiveStats.retOverDD),
          suiSlotPnlPerDollar: without.slotPnlPerDollar, suiTrades: without.own.trades,
          suiRank: j.suiRank,
          perCoin: Object.fromEntries(LIVE_ROW.symbols.map((s) => { const pc = j.perCoin[s] as { slotPnlPerDollar: number; withoutIt: { deltaRetOverDD: number }; marginalDollarDD: number; own: { trades: number } }; return [s, { slotPnlPerDollar: pc.slotPnlPerDollar, deltaRetOverDDWithoutIt: pc.withoutIt.deltaRetOverDD, marginalDollarDD: pc.marginalDollarDD, trades: pc.own.trades }]; })),
        });
      }
      const idx = LIVE_ROW.symbols.indexOf(SUI);
      const dRet = rows.map((r) => r.deltaRet as number), dDD = rows.map((r) => r.deltaMaxDD as number), dRD = rows.map((r) => r.deltaRetOverDD as number);
      const worstFive = Math.min(...units.map((u) => u.fiveStats.retOverDD));
      const worstWithout: Record<string, number> = {};
      for (const x of LIVE_ROW.symbols) worstWithout[x] = Math.min(...units.map((u) => (u.perCoin[x] as { withoutIt: { retOverDD: number } }).withoutIt.retOverDD));
      const n = dRet.length, m = mean(dRet), sd = n > 1 ? Math.sqrt(dRet.reduce((a, x) => a + (x - m) * (x - m), 0) / (n - 1)) : NaN;
      const rs = {
        looDeltaRetOverDD: rankSumTest(units.map((u) => u.ranks.looDeltaRetOverDD), idx),
        contribution: rankSumTest(units.map((u) => u.ranks.contribution), idx),
        marginalDollarDD: rankSumTest(units.map((u) => u.ranks.marginalDollarDD), idx),
      };
      const summary = {
        folds: rows.length,
        primary_exchangeability_looDeltaRetOverDD: rs.looDeltaRetOverDD,
        exchangeability_contribution: rs.contribution,
        exchangeability_marginalDollarDD: rs.marginalDollarDD,
        dropSuiBetterOnReturn: signTest(dRet.filter((x) => x > 0).length, dRet.filter((x) => x < 0).length),
        dropSuiLowerDrawdown: signTest(dDD.filter((x) => x < 0).length, dDD.filter((x) => x > 0).length),
        dropSuiBetterOnRetOverDD: signTest(dRD.filter((x) => x > 0).length, dRD.filter((x) => x < 0).length),
        suiSlotPositiveFolds: signTest(rows.filter((r) => (r.suiSlotPnlPerDollar as number) > 0).length, rows.filter((r) => (r.suiSlotPnlPerDollar as number) < 0).length),
        errorBarOnTheReturnDelta: { meanDeltaRet: r4(m), sdAcrossFolds: r4(sd), standardError: r4(sd / Math.sqrt(Math.max(1, n))), tStatistic: r2(m / (sd / Math.sqrt(Math.max(1, n)))), degreesOfFreedom: n - 1, pTwoSided: Number(tTwoSidedP(m / (sd / Math.sqrt(Math.max(1, n))), n - 1).toPrecision(3)), note: `Δ = (four at $25) − (five at $20), per fold: what dropping SUI and raising the slot does to the return per dollar. A parametric test on ${n} folds — the sign test beside it is the assumption-free version.` },
        worstFoldRule: {
          note: "the four-window rule's own logic applied to folds, where SUI IS present: an arm is ranked by its worst fold's ret/DD.",
          fiveWorstRetOverDD: worstFive,
          withoutEachCoinWorstRetOverDD: worstWithout,
          dropsThatImproveTheWorstFold: LIVE_ROW.symbols.filter((x) => worstWithout[x] > worstFive),
        },
      };
      foldSummaries[c.id] = summary;
      byCondition[c.id] = { folds: rows, summary };
    }
    // The venue's own book reaches the last folds only; priced where ≥ 95 % of a fold's scored bars are its own.
    const revxFolds: Record<string, unknown>[] = [];
    for (const f of folds) {
      const cov = Math.min(...LIVE_ROW.symbols.map((s) => {
        const arr = series[s].revx.c4h, sc = arr.filter((b) => b.start >= f.fromTs && b.start < f.toTs);
        return sc.length ? sc.filter((b) => b.start >= series[s].revxFirst).length / sc.length : 0;
      }));
      if (cov < REVX_MIN_WINDOW_COVERAGE) continue;
      for (const c of WINDOW_A_EXTRA) {
        const runs: Record<string, DailyRun> = {};
        for (const s of LIVE_ROW.symbols) { const dr = spanDaily(s, "revxuk", c.reg, f.fromTs, f.toTs); if (dr) runs[s] = dr; }
        if (Object.keys(runs).length !== LIVE_ROW.symbols.length) continue;
        const j = judgeFive(runs);
        const w = j.perCoin[SUI] as { withoutIt: { retOverDD: number; ret: number }; slotPnlPerDollar: number };
        revxFolds.push({ condition: c.id, fold: f.id, coverage: r4(cov), five: j.fiveStats.retOverDD, withoutSui: w.withoutIt.retOverDD, deltaRetOverDD: r2(w.withoutIt.retOverDD - j.fiveStats.retOverDD), suiSlotPnlPerDollar: w.slotPnlPerDollar, suiRank: j.suiRank });
      }
    }
    report.s3_folds = {
      question: "Finer-grained than two windows: consecutive folds tiling SUI's whole history, with the five members judged the same way in every fold.",
      method: `the span S_full cut into ${K} equal consecutive folds (${(spanMs / K / 86400e3).toFixed(1)} days each — the whole number of folds nearest ${FOLD_TARGET_DAYS}-day ones, so the span is tiled end to end and neither SUI's first months nor the most recent ones are dropped). Each fold is its own seeded run per coin, starting FLAT with the indicators already warm (\`run\` is handed the whole tape and a \`from\` inside the fold). Per fold, per coin: the three judgements of S1. The exchangeability tests are exact.`,
      caveat: "the folds are consecutive and non-overlapping, so they are as independent as this data gets — but it is the SAME five coins in a market that moved together, so a fold is not a fresh draw, and the rank null's independence across folds is an approximation. Every fold starts flat, which costs whichever member was holding across a boundary.",
      foldCount: K, foldDays: r2(spanMs / K / 86400e3),
      folds: folds.map((f) => ({ id: f.id, from: iso(f.fromTs), to: iso(f.toTs) })),
      byCondition,
      onTheVenuesOwnBook: { note: "Revolut X's own UK book only reaches the last folds; priced where ≥ 95 % of every coin's scored bars are its own. Reported, not tested — too few folds.", rows: revxFolds },
    };
  }
  lap("S3 done");

  // ── S4 — what SUI does to drawdown, beside what each other member does ──
  {
    const rows: Record<string, unknown>[] = [];
    for (const u of s1Units) {
      rows.push({
        unit: `window ${u.w}`, condition: u.cond,
        fiveMaxDD: u.j.fiveStats.maxDD, fiveDDUsd: u.j.fiveStats.ddUsd,
        marginalDollarDD: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, (u.j.perCoin[s] as { marginalDollarDD: number }).marginalDollarDD])),
        correlationWithTheOtherFour: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, (u.j.perCoin[s] as { correlationWithTheOtherFour: number | null }).correlationWithTheOtherFour])),
        worstEpisode: u.j.fiveStats.worstEpisode,
        suiRankOnDamping: u.j.suiRank.marginalDollarDD,
      });
    }
    const s2 = report.s2_theSpanWhereAllFiveExist as { spans: Record<string, { byCondition: Record<string, { perCoin: Record<string, { marginalDollarDD: number; correlationWithTheOtherFour: number | null }>; suiRank: { marginalDollarDD: number } }> }> };
    for (const [sid, sp] of Object.entries(s2.spans)) for (const [cid, bc] of Object.entries(sp.byCondition)) {
      rows.push({
        unit: sid, condition: cid,
        marginalDollarDD: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, bc.perCoin[s].marginalDollarDD])),
        correlationWithTheOtherFour: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, bc.perCoin[s].correlationWithTheOtherFour])),
        suiRankOnDamping: bc.suiRank.marginalDollarDD,
      });
    }
    report.s4_drawdown = {
      question: "If SUI's contribution is damping rather than return, measure the damping directly — and measure it for every member, because adding ANY fifth slot that is not perfectly correlated damps something.",
      method: "`marginalDollarDD`: the five-coin sleeve's dollar drawdown minus the other four's at their own $20 slots — the change from adding that member's $20 (negative = the drawdown got SMALLER although money was added). `correlationWithTheOtherFour`: of the member's daily slot P&L with the other four's summed. `worstEpisode`: who lost the money between the peak and the trough of the sleeve's deepest drawdown. Fold-level damping ranks and their exact test are in S3.",
      rows,
    };
  }
  lap("S4 done");

  // ── S5 — the spread SUI actually trades at ─────────────────────────────
  {
    const out: Record<string, unknown> = {};
    const units: { id: string; get: (s: string, c: { reg: StopRule; tape: Tape }, costs: Costs, key: string) => DailyRun | null }[] = [
      { id: "window A", get: (s, c, costs, key) => windowDaily(s, "A", c.reg, c.tape, costs, key) },
      { id: "window B", get: (s, c, costs, key) => windowDaily(s, "B", c.reg, c.tape, costs, key) },
      { id: "S_oos", get: (s, c, costs, key) => spanDaily(s, c.tape, c.reg, spans[1].fromTs, spans[1].toTs, costs, key) },
      { id: "S_full", get: (s, c, costs, key) => spanDaily(s, c.tape, c.reg, sFull.fromTs, sFull.toTs, costs, key) },
    ];
    for (const u of units) {
      const byCond: Record<string, unknown> = {};
      for (const c of CONDITIONS) {
        const arms: Record<string, unknown> = {};
        const four = FOUR.map((s) => u.get(s, c, COSTS.revx, "revx"));
        if (four.some((x) => !x)) continue;
        const fourPath = combinePath(FOUR.map((s, i) => asSleeve(s, four[i]!, LIVE_ROW.capitalUsd / FOUR.length)));
        for (const hs of SUI_HALF_SPREADS) {
          const costs: Costs = { ...COSTS.revx, halfSpread: { ...COSTS.revx.halfSpread, [SUI]: hs.halfSpread } };
          const key = hs.id === "assumed" ? "revx" : `sui-hs:${hs.halfSpread}`;
          const sui = u.get(SUI, c, costs, key);
          if (!sui) continue;
          const five = combinePath([...FOUR.map((s, i) => asSleeve(s, four[i]!, SLOT_USD)), asSleeve(SUI, sui, SLOT_USD)]);
          arms[hs.id] = {
            roundTripBps: r2(2 * hs.halfSpread * 1e4 + 2 * COSTS.revx.takerBps),
            five: { ret: five.stats.ret, maxDD: five.stats.maxDD, retOverDD: five.stats.retOverDD },
            suiOwn: pick(sui.res), suiSlotPnlPerDollar: r4(contributionOf(sui)),
            dropSuiDelta: { ret: r4(fourPath.stats.ret - five.stats.ret), retOverDD: r2(fourPath.stats.retOverDD - five.stats.retOverDD) },
          };
        }
        byCond[c.id] = arms;
      }
      out[u.id] = byCond;
    }
    report.s5_theSpreadSuiTradesAt = {
      question: "Every published SUI figure charges a 23.94 bps full spread. §4.19 measured 23.7 and 25.7; this study sampled the book itself. Does the answer move with the spread?",
      method: "the five-coin sleeve re-priced with ONLY SUI's half-spread changed; the other four keep `COSTS.revx`, so the four-coin comparison is unchanged by construction and every delta is SUI's cost.",
      units: out,
    };
  }
  lap("S5 done");

  // ── S6 — the window SUI does not have, probed below the floor ──────────
  {
    const out: Record<string, unknown> = {};
    for (const reg of STOP_RULES) for (const tape of TAPES) {
      const s = series[SUI];
      const comb = s.coinbase.c4h, cb = s.cb4h;
      const nCb = cb.length, t1 = Math.floor(nCb / 3);
      const z = indexAtOrAfter(comb, cb[0].start), T1 = indexAtOrAfter(comb, cb[t1].start);
      const Zc = indexAtOrAfter(comb, cb[0].start - 2 * YEAR_MS);   // clamps to 0: SUI's tape is younger than two years before the series
      const isDays = z > Zc ? (comb[z - 1].start - comb[Zc].start) / 86400e3 : 0;
      const arm = series[SUI][armOf(tape)];
      const isFrom = indexAtOrAfter(arm.c4h, comb[Zc].start), isTo = indexAtOrAfter(arm.c4h, comb[z].start);
      const oosFrom = indexAtOrAfter(arm.c4h, comb[z].start), oosTo = indexAtOrAfter(arm.c4h, comb[T1].start);
      const isRun = (p: TrendParams, c: Costs) => run("trend-4h", SUI, arm.c4h, arm.daily, isFrom, isTo, p, c, 4, stopsOf(reg, p));
      const oosRun = (p: TrendParams, c: Costs) => run("trend-4h", SUI, arm.c4h, arm.daily, oosFrom, oosTo, p, c, 4, stopsOf(reg, p));
      const cell = studyVenue(SUI, "revx", isRun, oosRun);
      out[`${reg}·${tape}`] = {
        inSampleDays: Number(isDays.toFixed(1)), inSampleBars: isTo - isFrom, floorDays: MIN_IN_SAMPLE_DAYS,
        oosFrom: iso(arm.c4h[oosFrom].start), oosTo: iso(arm.c4h[Math.min(arm.c4h.length - 1, oosTo - 1)].start),
        chosen: cell.chosen, chosenOwn: cell.chosenOwn, chosenOther: cell.chosenOther, seededOwn: cell.seededOwn,
        plateauPositiveShare: cell.plateau.positiveShare, chosenPass: cell.chosenPass, seededPass: cell.seededPass, seededFailed: cell.seededFailed,
      };
    }
    // deno-lint-ignore no-explicit-any
    let published: any = null;
    if (windowsPath) {
      const wj = JSON.parse(await Deno.readTextFile(windowsPath));
      // deno-lint-ignore no-explicit-any
      published = { file: windowsPath, sha256: await sha(windowsPath), ...Object.fromEntries(STOP_RULES.map((reg) => [reg, ((wj.shortInSampleProbe?.perStopRule?.[reg] ?? []) as any[]).find((r) => r.symbol === SUI && r.window === "C") ?? null])) };
    }
    report.s6_theWindowSuiDoesNotHave = {
      question: "§3.15 says SUI's window C, probed below the 180-day in-sample floor, reads −17.2 % on a 0 % plateau. Does that reproduce?",
      protest: "this is a PROBE, not a window. The in-sample is under the declared floor, which exists because a rule with a 100-bar slow average and a 55-bar breakout cannot be honestly fitted on it. A pass here would not admit SUI and a failure here does not convict it. Window D is impossible at any floor: its in-sample — the two years to 2022-09-22 — ends seven months before SUI's tape begins (2023-05-03), so there is nothing to fit on, and its out-of-sample would be SUI's first 142 days.",
      perCondition: out,
      publishedInWindowsJson: published,
    };
  }
  lap("S6 done");

  // ── S7 — what SUI shows Jev at its entries ─────────────────────────────
  {
    const scopes: { id: string; get: (s: string, tape: Tape) => DailyRun | null }[] = [
      { id: "window A", get: (s, tape) => windowDaily(s, "A", "shipped", tape) },
      { id: "window B", get: (s, tape) => windowDaily(s, "B", "shipped", tape) },
      { id: "S_full", get: (s, tape) => spanDaily(s, tape, "shipped", sFull.fromTs, sFull.toTs) },
    ];
    // The model's own replies, five per state, as the jev study saved them (reference §4.21). A reply vetoes an entry
    // exactly when the rulebook's own `combineDecision`, gate on, turns the entry into a hold.
    type Reply = { healthy: number; caution: number; echoOk: boolean };
    const replies = new Map<string, Reply[]>();
    let answersSource: Record<string, unknown> = { note: "jev_answers.json not supplied; no measured veto is reported" };
    if (answersPath) {
      const aj = JSON.parse(await Deno.readTextFile(answersPath)) as {
        provenance?: { model?: string; requestedAt?: string; calls?: number; repeats?: number };
        states: { symbol: string; trend_strength: string; volatility: string; momentum_30d: string; healthy: number[]; caution: number[]; echoOk: boolean }[];
      };
      for (const st of aj.states) replies.set(`${st.symbol}|${st.trend_strength}|${st.volatility}|${st.momentum_30d}`, st.healthy.map((h, i) => ({ healthy: h, caution: st.caution[i], echoOk: st.echoOk })));
      answersSource = { file: answersPath, sha256: await sha(answersPath), model: aj.provenance?.model ?? null, requestedAt: aj.provenance?.requestedAt ?? null, states: aj.states.length, calls: aj.provenance?.calls ?? null };
    }
    const repliesOf = (symbol: string, strength: string, volatility: string, momentum: string): Reply[] => {
      const rs = replies.get(`${symbol}|${strength}|${volatility}|${momentum}`);
      if (!rs || !rs.length) throw new Error(`no measured replies for ${symbol} ${strength}|${volatility}|${momentum}`);
      return rs;
    };
    const vetoes = (rs: Reply[]) => rs.filter((r) => combineDecision({ action: "enter", reason: "" }, { healthy: r.healthy, caution: r.caution, echoOk: r.echoOk, provider: "openrouter" }, { enterMin: ENTER_MIN, cautionExit: CAUTION_EXIT }).action !== "enter").length;
    const vetoShare = (symbol: string, e: EntryState) => { const rs = repliesOf(symbol, e.strength, e.volatility, e.momentum); return vetoes(rs) / rs.length; };

    const out: Record<string, unknown> = {};
    type Tally = { entries: number; weak: number; coinFlip: number; calm: number; momentumUnknown: number; vetoSum: number; cells: Record<string, number> };
    const tallies: Record<string, Record<string, Tally>> = {};
    const suiCells = new Set<string>();
    let mismatches = 0, located = 0;
    for (const sc of scopes) for (const tape of TAPES) {
      const perCoin: Record<string, unknown> = {};
      const scopeId = `${sc.id} · ${tape}`;
      tallies[scopeId] = {};
      for (const s of LIVE_ROW.symbols) {
        const dr = sc.get(s, tape);
        if (!dr) continue;
        const arm = series[s][armOf(tape)];
        const es = entryStates(s, arm.c4h, arm.daily, dr, DEFAULT_TREND, COSTS.revx, stopsOf("shipped", DEFAULT_TREND));
        located += es.length; mismatches += es.filter((e) => !e.ruleSaysEnter).length;
        const t: Tally = { entries: es.length, weak: 0, coinFlip: 0, calm: 0, momentumUnknown: 0, vetoSum: 0, cells: {} };
        let high = 0;
        for (const e of es) {
          const k = `${e.strength}|${e.volatility}|${e.momentum}`;
          t.cells[k] = (t.cells[k] ?? 0) + 1;
          if (s === SUI) suiCells.add(k);
          t[jevZone(e.strength, e.volatility)]++;
          if (e.momentum !== "positive") t.momentumUnknown++;
          if (e.volatility === "high") high++;
          if (replies.size) t.vetoSum += vetoShare(s, e);
        }
        tallies[scopeId][s] = t;
        const grid: Record<string, Record<string, number>> = {};
        for (const st of ["weak", "moderate", "strong"]) { grid[st] = {}; for (const v of ["low", "normal", "high", "extreme"]) grid[st][v] = es.filter((e) => e.strength === st && e.volatility === v).length; }
        perCoin[s] = {
          entries: es.length, strengthByVolatility: grid, cells: t.cells,
          weak: t.weak, high, shareWeak: es.length ? r3(t.weak / es.length) : null, shareHighVol: es.length ? r3(high / es.length) : null,
          composition: { weak: t.weak, coinFlip: t.coinFlip, calm: t.calm, momentumUnknown: t.momentumUnknown },
          measuredVeto: replies.size ? { expectedVetoes: r2(t.vetoSum), expectedVetoShare: es.length ? r3(t.vetoSum / es.length) : null, expectedEntriesTaken: r2(es.length - t.vetoSum) } : null,
          ...(s === SUI ? { entryList: es.map((e) => ({ ...e, measuredVetoShare: replies.size ? r3(vetoShare(s, e)) : null })) } : {}),
        };
      }
      out[scopeId] = perCoin;
    }

    // What the model said, state by state: SUI's own entry states, and the two high-volatility states for every coin.
    const measuredStates: Record<string, unknown> = {};
    if (replies.size) {
      const describe = (symbol: string, cell: string) => {
        const [st, v, m] = cell.split("|");
        const rs = repliesOf(symbol, st, v, m), hs = rs.map((r) => r.healthy);
        return { meanP: r3(mean(hs)), minP: Math.min(...hs), maxP: Math.max(...hs), replies: rs.length, vetoes: vetoes(rs) };
      };
      measuredStates.suiEntryStates = Object.fromEntries([...suiCells].sort().map((c) => [c, describe(SUI, c)]));
      measuredStates.highVolatilityByCoin = Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, Object.fromEntries(["moderate|high|positive", "strong|high|positive"].map((c) => [c, describe(s, c)]))]));
    }

    // Cross-check against the jev study (a different runner, `runGated`), which counted the rulebook's entries on the
    // COINBASE tape under the shipped stop over each coin's scored windows — for SUI, exactly windows A and B. Since
    // that study's re-run on the measured answers (2026-09-22 19:31 UTC) its census is pooled over the five coins, so
    // the check is pooled too, on the windows every member has: every cell, every coin's entry count, the partition,
    // and the expected veto share on the measured replies.
    // deno-lint-ignore no-explicit-any
    let vsJev: Record<string, any> = { note: "jev.json not supplied" };
    if (jevPath) {
      // deno-lint-ignore no-explicit-any
      const jj = JSON.parse(await Deno.readTextFile(jevPath)) as Record<string, any>;
      const comp = jj.composition, census = jj.earlierStudy?.census;
      if (!comp || !census) {
        vsJev = { note: "this jev.json carries no per-window composition (its layout before 2026-09-22 19:31 UTC); nothing compared", file: jevPath, sha256: await sha(jevPath) };
      } else {
        const rows: Record<string, unknown>[] = [];
        let compared = 0;
        const cmp = (what: string, window: string, key: string, published: unknown, here: unknown) => {
          compared++;
          const differs = typeof published === "number" && typeof here === "number" ? Math.abs(published - here) > 1e-9 : published !== here;
          if (differs) rows.push({ what, window, key, published: published ?? null, here: here ?? null });
        };
        for (const w of ["A", "B"] as const) {
          const ts = tallies[`window ${w} · coinbase`];
          const pooled: Tally = { entries: 0, weak: 0, coinFlip: 0, calm: 0, momentumUnknown: 0, vetoSum: 0, cells: {} };
          for (const s of LIVE_ROW.symbols) {
            const t = ts[s];
            pooled.entries += t.entries; pooled.weak += t.weak; pooled.coinFlip += t.coinFlip; pooled.calm += t.calm;
            pooled.momentumUnknown += t.momentumUnknown; pooled.vetoSum += t.vetoSum;
            for (const [k, n] of Object.entries(t.cells)) pooled.cells[k] = (pooled.cells[k] ?? 0) + n;
            // deno-lint-ignore no-explicit-any
            cmp("entries", w, s, ((census.entriesVsRun ?? []) as any[]).find((r) => r.symbol === s && r.window === w)?.entries, t.entries);
          }
          const pubCells = (census.actionableByCellAndWindow ?? {}) as Record<string, Record<string, number>>;
          for (const k of [...new Set([...Object.keys(pubCells), ...Object.keys(pooled.cells)])].sort()) cmp("cell", w, k, pubCells[k]?.[w] ?? 0, pooled.cells[k] ?? 0);
          for (const f of ["weak", "coinFlip", "calm", "momentumUnknown"] as const) cmp("composition", w, f, comp[w]?.[f], pooled[f]);
          cmp("composition", w, "ruleEntries", comp[w]?.ruleEntries, pooled.entries);
          if (replies.size) cmp("composition", w, "expectedVetoShareUnderII", comp[w]?.expectedVetoShareUnderII, r3(pooled.vetoSum / pooled.entries));
        }
        vsJev = {
          note: "the five coins' entries over windows A and B on the Coinbase tape, shipped stop, against `jev.json` (a different runner, `runGated`): every coin's entry count (`earlierStudy.census.entriesVsRun`), every cell pooled over the five (`actionableByCellAndWindow`), the weak / coin-flip / calm partition and the expected veto share on the measured replies (`composition`). Zero differences means the locator finds the entries, and the states, the jev study found.",
          file: jevPath, sha256: await sha(jevPath), compared, differences: rows.length, rows,
        };
      }
    }
    report.s7_whatSuiShowsJev = {
      vsJevStudy: vsJev,
      question: "The model was asked every entry state five times (reference §4.21): it vetoes every weak-trend state — the question it is asked says so in prose — and answers the high-volatility states AT the threshold (P 0.55–0.64 against enterMin 0.60). Which of those zones do SUI's entries fall in, beside the other four's, and how many would the measured replies veto?",
      method: "every ENTRY the seeded rule takes under the shipped stop, located from `run`'s own trade count, and the categorical state the loop would show Jev at its decision bar, from the rulebook's own `buildSnapshot`. Both backbone tapes; windows A and B and the whole SUI era. Jev is NOT called: `composition` is the jev study's own partition, and `measuredVeto` is, per entry, the share of the model's five recorded replies for that coin and state on which the rulebook's own `combineDecision` refuses it — the gate as it runs when it is on. Whether the live row gates on the model at all is the jev study's recommendation, not this study's.",
      thresholds: { enterMin: ENTER_MIN, cautionExit: CAUTION_EXIT },
      answers: answersSource,
      measuredStates,
      locator: { entriesLocated: located, stateMismatches: mismatches, note: "at every located entry the rulebook's own `ruleFor` must say 'enter' on the state built there; `stateMismatches` counts where it does not" },
      scopes: out,
    };
  }
  lap("S7 done");

  // ── claims the brief asked to have checked ─────────────────────────────
  {
    const s = (c: string, w: WinName) => baselineByCond[c][w]!, d = (c: string, w: WinName) => dropSuiByCond[c][w]!;
    const perCond: Record<string, unknown> = {};
    for (const c of CONDITIONS) {
      const suiLowersReturn = (["A", "B"] as WinName[]).every((w) => d(c.id, w).ret > s(c.id, w).ret);
      perCond[c.id] = {
        A: { five: { ret: s(c.id, "A").ret, maxDD: s(c.id, "A").maxDD, retOverDD: s(c.id, "A").retOverDD }, dropSui: { ret: d(c.id, "A").ret, maxDD: d(c.id, "A").maxDD, retOverDD: d(c.id, "A").retOverDD } },
        B: { five: { ret: s(c.id, "B").ret, maxDD: s(c.id, "B").maxDD, retOverDD: s(c.id, "B").retOverDD }, dropSui: { ret: d(c.id, "B").ret, maxDD: d(c.id, "B").maxDD, retOverDD: d(c.id, "B").retOverDD } },
        suiLowersReturnPerDollarInBothWindows: suiLowersReturn,
        suiDampsDrawdownInA: d(c.id, "A").maxDD > s(c.id, "A").maxDD,
        fourWindowWorstDelta: r2(worstOf(dropSuiByCond[c.id]).retOverDD - worstOf(baselineByCond[c.id]).retOverDD),
      };
    }
    const s0 = report.s0_suiOwnRecord as { suiAdmissionRegimes: Record<string, { clearsBothWalkForwardWindows: boolean }>; perCoin: Record<string, Record<string, Record<string, string[]>>> };
    report.claimsChecked = {
      priorAuditFigures: { claim: "dropping SUI gives A +8.5 % (0.54) vs five +8.0 % (0.71); B +25.0 % (2.19) vs +20.1 % (1.92) — SUI lowers return in both windows it is in and damps drawdown in A", perCondition: perCond },
      dropSuiDeltaIsAnIdentity: { claim: "`drop·SUI` reports exactly 0.00 on the four-window worst in every condition", perCondition: Object.fromEntries(CONDITIONS.map((c) => [c.id, (perCond[c.id] as { fourWindowWorstDelta: number }).fourWindowWorstDelta])) },
      suiClearsAOnly: { claim: "shipped · Revolut X · seeded · both tapes agreeing: SUI clears §4.15's bar on window A only", bothTapesAgree: s0.perCoin[SUI]["shipped·bothTapesAgree"] },
      section38Admission: { claim: "§3.8 admitted SUI for clearing both windows under an older stop rule and tape", underTrailCoinbaseChosen: s0.suiAdmissionRegimes["trail·coinbase·chosen"]?.clearsBothWalkForwardWindows, underShippedCoinbaseChosen: s0.suiAdmissionRegimes["shipped·coinbase·chosen"]?.clearsBothWalkForwardWindows, underShippedKrakenChosen: s0.suiAdmissionRegimes["shipped·kraken·chosen"]?.clearsBothWalkForwardWindows, underShippedSeeded: { coinbase: s0.suiAdmissionRegimes["shipped·coinbase·seeded"]?.clearsBothWalkForwardWindows, kraken: s0.suiAdmissionRegimes["shipped·kraken·seeded"]?.clearsBothWalkForwardWindows } },
      suiBook: {
        claim: "SUI's book is the widest of the five: 23.7–25.7 bps measured live, ~42–44 bps a round trip against the majors' ~20",
        sampled: SAMPLED_UK_BOOK.window,
        fullSpreadBps: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, SAMPLED_UK_BOOK.revx[s]])),
        roundTripAtTheMedianBps: Object.fromEntries(LIVE_ROW.symbols.map((s) => [s, r2(SAMPLED_UK_BOOK.revx[s].median + 2 * COSTS.revx.takerBps)])),
        suiRoundTripAtP90Bps: r2(SAMPLED_UK_BOOK.revx[SUI].p90 + 2 * COSTS.revx.takerBps),
        widestOfTheFive: LIVE_ROW.symbols.every((s) => s === SUI || SAMPLED_UK_BOOK.revx[s].median < SAMPLED_UK_BOOK.revx[SUI].median),
        bookFloorAtTheSample: { minBookUsd: MIN_BOOK_USD, allFiveClear: LIVE_ROW.symbols.every((s) => SAMPLED_UK_BOOK.revx[s].quoteVolume24hUsd >= MIN_BOOK_USD), thinnest: [...LIVE_ROW.symbols].sort((a, b) => SAMPLED_UK_BOOK.revx[a].quoteVolume24hUsd - SAMPLED_UK_BOOK.revx[b].quoteVolume24hUsd)[0], atAdmission: UK_BOOK_USD_PER_DAY },
        reading: `widest of the five by median; but SUI's sampled median is ${SAMPLED_UK_BOOK.revx[SUI].median} bps (p10 ${SAMPLED_UK_BOOK.revx[SUI].p10}, p90 ${SAMPLED_UK_BOOK.revx[SUI].p90}, max ${SAMPLED_UK_BOOK.revx[SUI].max}), so 23.7–25.7 bps is the wide end of its book, not its typical touch`,
      },
      avaxOppositeDirection: { claim: "AVAX fails under the retired rule and clears A, B, C under the running one", shippedSeededBothTapes: s0.perCoin["AVAX/USD"]["shipped·bothTapesAgree"], trailSeededBothTapes: s0.perCoin["AVAX/USD"]["trail·bothTapesAgree"] },
    };
  }

  // ── the control ────────────────────────────────────────────────────────
  {
    // The bar's population base rate, read from `tape.json` §T3 (27 coins; the live five's cells are recomputed above and match).
    let barBaseRate: Record<string, unknown> = { note: "tape.json not supplied" };
    if (tapeJson) {
      const pcv = tapeJson.t3_theBar?.perCoinVerdicts?.shipped ?? {};
      const book = tapeJson.ukBookUsdPerDay ?? {};
      let n = 0, clear = 0;
      for (const [sym, ws] of Object.entries(pcv as Record<string, Record<string, Record<string, Record<string, { seededPass: boolean } | null>> | null>>)) {
        for (const v of Object.values(ws ?? {})) {
          const r = v?.revx;
          if (!r?.coinbase || !r?.kraken) continue;
          n++;
          if (r.coinbase.seededPass && r.kraken.seededPass && (book[sym] ?? 0) >= MIN_BOOK_USD) clear++;
        }
      }
      const p = clear / Math.max(1, n);
      barBaseRate = {
        source: "tape.json §T3 — shipped · Revolut X · seeded · both tapes agreeing · UK book ≥ $100k; the live five's cells are recomputed in this run and match (fidelity.vsTape)",
        cells: n, clear, perWindowPassRate: r3(p),
        pClearAtLeastOneOfTwo: r3(1 - Math.pow(1 - p, 2)), pClearExactlyOneOfTwo: r3(2 * p * (1 - p)), pClearBoth: r3(p * p),
        reading: "clearing exactly one of two windows is what chance gives a coin about four times in ten. SUI's one pass is not evidence for its seat and its one failure is not evidence against it — §3.15 measured that a one-window pass does not even predict the next window.",
      };
    }
    const primary = Object.fromEntries(TAPES.map((t) => [t, (foldSummaries[`shipped·${t}`]?.primary_exchangeability_looDeltaRetOverDD ?? null)]));
    const secondaryTests: { id: string; p: number }[] = [];
    for (const c of CONDITIONS) {
      const sm = foldSummaries[c.id] as Record<string, { pTwoSided: number }>;
      for (const k of ["primary_exchangeability_looDeltaRetOverDD", "exchangeability_contribution", "exchangeability_marginalDollarDD", "dropSuiBetterOnReturn", "dropSuiLowerDrawdown", "dropSuiBetterOnRetOverDD", "suiSlotPositiveFolds", "errorBarOnTheReturnDelta"]) {
        if (c.reg === "shipped" && k === "primary_exchangeability_looDeltaRetOverDD") continue;
        if (sm?.[k]) secondaryTests.push({ id: `${c.id}·${k}`, p: sm[k].pTwoSided });
      }
    }
    const nSec = secondaryTests.length;
    report.multipleComparisons = {
      note: "This study compares two FIXED coin sets and ranks five FIXED members. Nothing is chosen by a result: no parameter, no coin, no fold boundary. The looks are counted anyway, and the primary test was fixed before any number existed.",
      primary: { test: "S3 exchangeability of SUI's rank on Δ ret/DD without it, shipped stop", perTape: primary, rule: "pWorse < 0.05 on BOTH tapes → drop; pBetter < 0.05 on BOTH → seat supported; otherwise undecided. Two tapes that agree to a few bps are near-duplicates, so requiring both is a conservative AND, not a Bonferroni split." },
      secondary: {
        tests: nSec,
        smallestTwoSidedP: nSec ? Math.min(...secondaryTests.map((t) => t.p)) : null,
        atOrBelow005: secondaryTests.filter((t) => t.p <= 0.05).map((t) => t.id),
        expectedAtOrBelow005ByChanceIfIndependent: r2(nSec * 0.05),
        note: "each fold test is two-sided and exact; the conditions are near-duplicates and the metrics overlap, so the independent expectation is an upper bound on how many 'hits' chance produces, and ONE hit is not a finding.",
      },
      s1: { arms: LIVE_ROW.symbols.length, conditions: CONDITIONS.length, expectedPassesIndependent: r3(LIVE_ROW.symbols.length / 16), expectedPassesCorrelated: r3(LIVE_ROW.symbols.length / 2) },
      gridPointsEvaluated: gridPoints,
      barBaseRate,
    };
  }

  // ── the verdict the pre-registered rule produces ──────────────────────
  {
    const pr = TAPES.map((t) => foldSummaries[`shipped·${t}`]?.primary_exchangeability_looDeltaRetOverDD as { pWorse: number; pBetter: number; meanRank: number; units: number } | undefined);
    const worseBoth = pr.every((x) => x != null && x.pWorse < 0.05);
    const betterBoth = pr.every((x) => x != null && x.pBetter < 0.05);
    const s0 = report.s0_suiOwnRecord as { clearsTheBarUnderTheRunningRule: { seeded: Record<string, boolean> } };
    // How many folds a rank test would need to see an effect of the size observed, if it were real (one-sided α 0.05, power 0.8).
    const obsMean = mean(pr.filter((x): x is NonNullable<typeof x> => x != null).map((x) => x.meanRank));
    const effect = Math.abs(obsMean - 3);
    const foldsNeeded = effect > 0 ? Math.ceil(Math.pow((1.645 + 0.8416) * Math.SQRT2 / effect, 2)) : null;
    const foldYears = (report.s3_folds as { foldDays: number }).foldDays / 365;
    // The secondary evidence, side by side, read from the blocks above — so a reader sees both directions at once.
    const s1 = report.s1_theWindowsSuiHas as { windowAAtTheCommonEnd: { byCondition: Record<string, { withoutSui: { deltaRetOverDD: number } }> } };
    const secondaryPicture = Object.fromEntries(TAPES.map((t) => {
      const sm = foldSummaries[`shipped·${t}`] as Record<string, Record<string, unknown>>;
      const wf = sm.worstFoldRule as { fiveWorstRetOverDD: number; withoutEachCoinWorstRetOverDD: Record<string, number>; dropsThatImproveTheWorstFold: string[] };
      return [t, {
        returnSide: { suiContributionMeanRank: sm.exchangeability_contribution.meanRank, pWorse: sm.exchangeability_contribution.pWorse, dropSuiRaisesReturnFolds: sm.dropSuiBetterOnReturn, returnDeltaT: sm.errorBarOnTheReturnDelta },
        drawdownSide: { suiDampingMeanRank: sm.exchangeability_marginalDollarDD.meanRank, pBetter: sm.exchangeability_marginalDollarDD.pBetter, dropSuiLowersDrawdownFolds: sm.dropSuiLowerDrawdown },
        worstFold: { five: wf.fiveWorstRetOverDD, withoutSui: wf.withoutEachCoinWorstRetOverDD[SUI], dropsThatImproveIt: wf.dropsThatImproveTheWorstFold },
        windowAAtTheCommonEnd_deltaRetOverDDWithoutSui: s1.windowAAtTheCommonEnd.byCondition[`shipped·${t}`]?.withoutSui.deltaRetOverDD ?? null,
      }];
    }));
    report.verdict = {
      live: worseBoth ? "drop — the pre-registered test says SUI is a worse member than the other four" : betterBoth ? "keep — the pre-registered test supports the seat" : "undecided — the pre-registered test cannot tell SUI's seat from any other member's",
      primaryPerTape: Object.fromEntries(TAPES.map((t, i) => [t, pr[i] ? { meanRank: pr[i]!.meanRank, pWorse: pr[i]!.pWorse, pBetter: pr[i]!.pBetter, folds: pr[i]!.units } : null])),
      paperBar: { clearsSection415UnderTheRunningRule: s0.clearsTheBarUnderTheRunningRule.seeded, note: "the bar as a NEW coin would face it today; §4.15 says the bar admits and does not certify the ones already in" },
      power: {
        observedMeanRankAcrossTapes: r3(obsMean), nullMeanRank: 3, rankSD: r3(Math.SQRT2),
        foldsNeededToDetectThisEffectIfReal: foldsNeeded,
        yearsOfFoldsThatIs: foldsNeeded != null ? r2(foldsNeeded * foldYears) : null,
        note: "a normal approximation to the rank-sum test: n = ((z₀.₉₅ + z₀.₈) × √2 / |mean rank − 3|)². It says how long the SAME measurement would take to decide, if the effect seen here were the true one.",
      },
      secondaryPicture,
    };
  }

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error("backtest.ts changed during the run — every number above is from two different files");
  report.fidelity = {
    runDaily: {
      note: "`runDaily` holds no copy of `run`: every mark IS a `run`. The property it relies on — `run(from, k + 1)` equals the loop's equity at bar k's close — is checked on every memoised cell against `run`'s OWN sampled curve (rounded to 5 dp there, so agreement is ≤ 5e-6).",
      cells: runDailyCells, checks: prefixChecks, worstAbsDiff: Number(prefixWorst.toPrecision(3)), tolerance: 5e-6, pass: prefixWorst <= 5.0000001e-6,
    },
    ...fid,
  };
  report.sourceIntegrity = { backtestTsSha256: btHashStart, stableAcrossRun: true, note: "`backtest.ts` is hashed at the start and the end of the run; a run that straddles an edit throws rather than publishing a mixture." };

  // Key order in the file: the question and the verdict before the evidence.
  const order = ["study", "ownersQuestion", "verdict", "preRegistered", "claimsChecked", "theQuestionTheFrameworkCannotAnswer", "fidelity", "s0_suiOwnRecord", "s1_theWindowsSuiHas", "s2_theSpanWhereAllFiveExist", "s3_folds", "s4_drawdown", "s5_theSpreadSuiTradesAt", "s6_theWindowSuiDoesNotHave", "s7_whatSuiShowsJev", "multipleComparisons"];
  const ordered: Record<string, unknown> = {};
  for (const k of order) if (k in report) ordered[k] = report[k];
  for (const [k, v] of Object.entries(report)) if (!(k in ordered)) ordered[k] = v;
  await Deno.writeTextFile(`${outDir}/sui.json`, JSON.stringify(ordered, null, 1));
  lap(`wrote ${outDir}/sui.json`);
}
