// The THIRD-WINDOW study: two walk-forward windows are two single draws, so
// this one goes and gets a third — and prices the live candidate, the coins
// that cleared exactly ONE of the existing two, and the two written-down
// rule candidates on all of them. A study, not a rulebook. Run by hand:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_windows.ts \
//     --data <dir with BTC-USD_1h_3y.json …> \
//     --ext  <dir with BTC-USD_1h_kraken.json …> \
//     --out  docs/agents/backtests
//
// Writes `<out>/windows.json` and NOTHING else; `latest.json`,
// `summary.json` and every other study's file are untouched.
//
// ── the question ──────────────────────────────────────────────────────
//
// §4.15: the bar admits a coin, it does not certify the ones already in —
// and §3.10 found that not one of the 21 shipped members clears it on both
// windows, so the live case rests on the five-coin sleeve. Davies' follow-up
// is the sharp one: if ONE window earns a coin a seat, a lot of other coins
// cleared one window too, so why aren't they all in? That is a question
// about whether "cleared one window" carries information, and two windows
// cannot answer it. This study extends the history backwards and asks a
// third (and, where the data reaches, a fourth).
//
// ── the data, and why it is a different source ────────────────────────
//
// The existing three years are Coinbase Exchange hourly candles
// (2023-09 → 2026-09). Kraken's free quarterly OHLCVT bundle
// (`assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full_2026Q2.zip`,
// §2b, never pulled before this study) carries every pair from its first
// trade to 2026-06-30 at 1/5/15/60/240/720/1440 minutes. Its 60-minute
// series is converted to the same `[t_s, o, h, l, c, v]` shape the
// backtester already reads and handed in as `--ext`.
//
// The two series are SPLICED, not mixed: Kraken's bars strictly before the
// Coinbase series' first bar, Coinbase's from there on — so windows A and B
// are priced on exactly the candles every published table used, and only
// the new history is Kraken's. Before the splice the two sources are
// compared bar for bar over everything they share (2.7 years, ~24k hourly
// bars a coin), and a coin whose overlap does not match is DROPPED rather
// than explained: the thresholds are written down below, before the numbers
// were looked at.
//
// ── the windows ───────────────────────────────────────────────────────
//
// Each coin's own Coinbase series is split in thirds exactly as §3.7 / §3.8
// / §3.10 / §3.11 split it, and the third window is the one those studies
// could not have: the FIRST third, scored with parameters chosen on the two
// years of extended history immediately before it. The three windows then
// tile the whole existing series, each with its parameters taken strictly
// from earlier data:
//
//   C — parameters on the 24 months before the series starts, the FIRST
//       third out of sample   (2023-09 → 2024-09 for a three-year coin)
//   B — parameters on the first third, the MIDDLE third out   (2024-09 → 2025-09)
//   A — parameters on the first two thirds, the LAST third out (2025-09 → 2026-09)
//   D — parameters on the 24 months before THAT, the 12 months before the
//       series out of sample  (2022-09 → 2023-09) — a fourth window,
//       reported separately and never folded into the three-window counts.
//       D's scored year sits INSIDE C's in-sample, which is what a rolling
//       walk-forward always does and is said here rather than hidden.
//
// Windows are NEVER averaged and an arm is ranked by the WORST window it
// has, which is §3.11's rule.
//
// ── what is imported and what is copied ───────────────────────────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `SHIPPED_STOPS`,
// `stopsForKind` and `spreadOf`, and the live rulebooks in
// `_shared/agents_strategy.ts`, are IMPORTED. `trend-4h-wide` needs no copy
// at all — it is `run` with wider `TrendParams`, which is how
// `backtest_kraken.ts` ran it.
//
// ONE copy exists, `runGated`, taken from `run` LINE BY LINE, and it adds
// two things `run` cannot express:
//   * an ENTRY GATE — §3.9's BTC-regime filter, which is cross-asset and so
//     cannot be a `StrategyKind`;
//   * a mark at EVERY bar plus the traded weight, which the sleeve
//     arithmetic (deployment, turnover, combined drawdown) reads. `run`
//     samples its curve every sixth bar, and which bar that is depends on
//     the array's start — which moves when the history is extended.
// With the gate off `runGated` IS `run`, and the report's `fidelity` block
// is the proof, not the claim: every coin × every window × both venues.
//
// `shippedDecider` and `regimeFiltered` are copied from
// `backtest_portfolio.ts` (which does not export them) unchanged, and
// `combine` / `dailyMarks` / `plateauOf` / `barTests` / `corr` are copied
// from the same file: they do arithmetic on OUTPUTS and touch no price and
// no fee.
//
// ── determinism ───────────────────────────────────────────────────────
//
// There is no `ran_at` field. Re-running over the same two data directories
// writes `windows.json` byte for byte identical; the run is recorded by the
// data provenance block (bar counts, first and last bar, byte sizes) rather
// than by a wall clock. Every map is written in a fixed order and the one
// place chance appears — the null distribution of §W3 — is computed exactly
// rather than sampled.

import {
  atrAt, applyFill, buildSnapshot, DEFAULT_TREND, FLAT, precompute, ruleFor, sma,
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

/**
 * Kraken 24 h quote volume — §3.12 measured all 27 for the first time
 * (`AssetPairs` once and `Ticker` eleven times 60 s apart, 20:47–20:57 UTC
 * on 2026-09-21; the median of the eleven rolling 24-hour quote volumes).
 * `kraken.json` → `krakenBook`.
 */
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

/** The live recommendation, §3.11 question 6 and `docs/agents/go-live.md`. */
const LIVE_CANDIDATE = { row: "trend-4h", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100, slots: 5 };

/**
 * §3.8's and §3.12's one-window cohort, which is Davies' actual question:
 * every coin that cleared exactly ONE of the two existing windows and sits
 * in no row (SOL and AVAX excepted — they are in one, and are listed so the
 * cohort is the whole shape rather than the part that flatters it).
 */
const COHORT: { symbol: string; venue: "revx" | "kraken"; clearedWindow: "A" | "B"; note: string }[] = [
  { symbol: "SOL/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — in trend-4h" },
  { symbol: "UNI/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — in no row" },
  { symbol: "AVAX/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — in trend-4h by 0039" },
  { symbol: "ICP/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — in no row" },
  { symbol: "BNB/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — 111 days of history" },
  { symbol: "AAVE/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — in no row ($54k book)" },
  { symbol: "LINK/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — three of four (Kraken)" },
  { symbol: "HBAR/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — three of four (Kraken)" },
  { symbol: "PEPE/USD", venue: "revx", clearedWindow: "A", note: "§3.8 — three of four (plateau)" },
  { symbol: "POL/USD", venue: "kraken", clearedWindow: "A", note: "§3.12 krakenOnlySeeded — UK book $11k" },
  { symbol: "BNB/USD", venue: "kraken", clearedWindow: "A", note: "§3.12 krakenOnlySeeded — UK book $19k" },
  { symbol: "ETC/USD", venue: "kraken", clearedWindow: "A", note: "§3.12 krakenOnlySeeded — UK book $8k" },
  { symbol: "TON/USD", venue: "kraken", clearedWindow: "B", note: "§3.12 krakenOnlySeeded — UK book $8k" },
  { symbol: "SHIB/USD", venue: "kraken", clearedWindow: "B", note: "§3.12 krakenOnlySeeded — UK book $11k" },
];

/** §3.8's two coins that cleared BOTH existing windows. */
const TWO_WINDOW_CLEARERS = ["SUI/USD", "POL/USD"];
/** §3.10 point 6: the regime filter cleared both windows on these four. */
const REGIME_TWO_WINDOW = ["LINK/USD", "NEAR/USD", "SUI/USD", "ALGO/USD"];
/** §3.12's one rulebook whose mean round trip clears a Kraken cost at t > 2. */
const WIDE_CANDIDATES = ["SOL/USD", "AVAX/USD"];

/**
 * Reference §3.8's own published table, typed in from the document, so the
 * harness proves it reproduces the study it is extending instead of asserting
 * it. Window A is that section's first table (chosen parameters' return out of
 * sample on Revolut X costs) for all 27; window B is its second table (the
 * middle third) for the eight coins that section ran there.
 */
const PUBLISHED_3_8_A: Record<string, number> = {
  "SOL/USD": 0.173, "UNI/USD": 0.468, "AVAX/USD": 0.403, "SUI/USD": 0.145, "ICP/USD": 0.124,
  "POL/USD": 0.094, "BNB/USD": 0.088, "AAVE/USD": 0.085, "LINK/USD": 0.043, "HBAR/USD": 0.016,
  "PEPE/USD": 0.026, "BTC/USD": -0.165, "ETH/USD": -0.010, "XRP/USD": -0.112, "DOGE/USD": -0.125,
  "ADA/USD": -0.094, "XLM/USD": -0.172, "NEAR/USD": -0.020, "BCH/USD": -0.263, "LTC/USD": -0.074,
  "DOT/USD": -0.000, "TON/USD": -0.056, "SHIB/USD": -0.048, "ETC/USD": -0.030, "ALGO/USD": -0.090,
  "ATOM/USD": -0.075, "HYPE/USD": -0.039,
};
const PUBLISHED_3_8_B: Record<string, number> = {
  "SOL/USD": 0.076, "UNI/USD": 0.090, "AVAX/USD": -0.115, "SUI/USD": 0.030,
  "ICP/USD": -0.132, "POL/USD": 0.176, "BNB/USD": -0.121, "AAVE/USD": -0.070,
};

/**
 * The overlap test, written down BEFORE the two sources were compared.
 * §3.12 measured Coinbase against Kraken on 4-hour closes over 710–719 bars
 * and found medians of 0.93–6.11 bps and p95s of 3.2–22.9. A coin whose
 * 2.7-year overlap is far outside that is not the same asset, or is a stale
 * book, and it is dropped rather than explained.
 */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;

/** A window is only scored when its in-sample has at least this many days to choose on. */
const MIN_IN_SAMPLE_DAYS = 180;

/**
 * The protective exits every window this study compares was computed with —
 * the 8 % floor under average cost and the 3×ATR(14) trail from the high
 * since entry — PINNED here rather than read from `backtest.ts`'s default.
 *
 * They are pinned because the default moved WHILE this study was running: a
 * concurrent session set `SHIPPED_STOPS.atrStop` to null and made
 * `stopsForKind` return the floor alone (its own finding: the rulebook's
 * close-based trail and the intra-bar one are two implementations of the
 * same idea and the intra-bar copy always fires first). That is a change to
 * the rule, not to this study's arithmetic, and a study whose windows A and
 * B no longer reproduce §3.8 cannot say anything about a third window. So
 * the headline numbers below are the rule as §3.7 / §3.8 / §3.10 / §3.11
 * priced it — `fidelity.publishedCrossCheck` is the evidence they are — and
 * `stopsSensitivity` re-runs the same three windows under whatever
 * `stopsForKind` returns at the moment of the run, so the verdict is
 * checked against both rules rather than tied to one.
 *
 * Nothing here re-implements a stop: these are four numbers handed to
 * `run`, which applies them.
 */
const PINNED_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };

// ───────────────────────────────────────────────────────────── the simulator

/** A decision at bar `i` with the position as it stands. Monotonic in `i`, so a decider may keep a cursor. */
type Decide = (i: number, pos: Position) => "enter" | "exit" | "hold";

type GatedResult = RunResult & {
  /** Σ over fills of the notional traded in units of the slot (an entry and an exit each count once). */
  tradedWeight: number;
  /** The mark at EVERY bar, so a day's mark does not depend on where the array starts. */
  marks: [number, number][];
};

/**
 * `backtest.ts`'s `run`, with the rulebook replaced by a callback, an
 * optional ENTRY GATE, and a mark recorded at every bar. Everything that
 * costs money is COPIED FROM `run` LINE BY LINE: the entry and rule exit at
 * the next bar's open ± the half-spread paying `fillFee`; the floor under
 * average cost and the ATR trail from the high since entry, read against the
 * next bar's low and filled at the level (or the open when the bar gaps
 * through it); the high-water mark advanced by each bar's high; the two-bar
 * cooldown after ANY exit; and the same return, drawdown, trade-count,
 * exposure and day arithmetic. With `gate` null it is `run` — the report's
 * `fidelity.runGated` block is the proof.
 */
function runGated(
  symbol: string, bars: Candle[], from: number, to: number, warmup: number,
  decide: Decide, costs: Costs, stops: StopParams | null, gate: ((i: number) => boolean) | null,
): GatedResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  let tradedWeight = 0;
  const marks: [number, number][] = [];
  const start = Math.max(from, warmup);
  for (let i = start; i < to - 1; i++) {
    const raw = decide(i, pos);
    const action = raw === "enter" && gate != null && !gate(i) ? "hold" : raw;
    const next = bars[i + 1];
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);                    // the touch, at the next open
      const base = cash / (price * (1 + fill));              // the fee comes out of the same cash
      const fee = base * price * fill;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++; tradedWeight += 1;
    } else if (action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fill;
      cash = pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; tradedWeight += 1; lastExitBar = i + 1;
    } else if (stops && pos.base > 0) {
      const hw = Math.max(pos.highWater ?? pos.avgCost, pos.avgCost);
      const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
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
  const eqEnd = cash + pos.base * bars[to - 1].close;
  const days = (bars[to - 1].start - bars[start].start) / 86400e3;
  return {
    ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity: marks,
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit, tradedWeight, marks,
  };
}

/**
 * The SHIPPED decision at each bar as a callback: `buildSnapshot` +
 * `ruleFor`, the pair `run` itself calls. Copied from
 * `backtest_portfolio.ts`, which does not export it. The one difference
 * from `run` is bookkeeping: the daily closes are pushed onto a growing
 * array instead of `daily.slice(0, dk)` per bar (same contents, no copy).
 */
function shippedDecider(kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, barHours: number): Decide {
  const pre = precompute(bars, p);
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos) => {
    const nowMs = bars[i].start + barHours * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    const snap = buildSnapshot(symbol, bars, i, closed, pos, nowMs, p, pre, (24 / barHours) * 365);
    return ruleFor(kind, snap, pos, p).action;
  };
}

/** BTC's daily closes and their SMAs, shared by every coin's regime-gated run (§3.9 idea 1). */
type BtcRegime = { daily: Candle[]; sma: Record<number, (number | null)[]> };

/**
 * §3.9's idea 1 as a GATE on entries only: BTC's last daily close above its
 * N-day average. Exits are untouched — a filter that also sold would be a
 * different rule. Copied from `backtest_portfolio.ts`.
 */
function regimeGate(bars: Candle[], btc: BtcRegime, n: number, barHours: number): (i: number) => boolean {
  let j = -1;
  return (i) => {
    const nowMs = bars[i].start + barHours * 3600e3;
    while (j + 1 < btc.daily.length && btc.daily[j + 1].start + 86400e3 <= nowMs) j++;
    if (j < 0) return true;                       // no BTC daily close yet — the gate does not block
    const ma = btc.sma[n][j];
    if (ma == null) return true;                  // the average cannot be computed yet
    return btc.daily[j].close > ma;
  };
}

// ─────────────────────────────────────────────────────── arithmetic on outputs

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
      members: sleeves.length, capitalUsd: Number(capital.toFixed(2)), pnlUsd: 0, ret: 0, maxDD: 0, retOverDD: 0,
      days: 0, from: "", to: "", deployment: 0, turnoverPerYear: 0, bestDayUsd: 0, worstDayUsd: 0, peakOpenUsd: Number(capital.toFixed(2)),
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
    members: sleeves.length, capitalUsd: Number(capital.toFixed(2)), pnlUsd: Number((eq - capital).toFixed(2)),
    ret: Number(ret.toFixed(4)), maxDD: Number(maxDD.toFixed(4)), retOverDD: Number((ret / Math.max(0.05, maxDD)).toFixed(2)),
    days: days.length, from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days[days.length - 1]).toISOString().slice(0, 10),
    deployment: Number(deployment.toFixed(3)), turnoverPerYear: Number((sleeves.reduce((a, s) => a + s.tradedUsd, 0) / capital / years).toFixed(2)),
    bestDayUsd: Number(best.toFixed(2)), worstDayUsd: Number(worst.toFixed(2)),
    peakOpenUsd: Number(sleeves.reduce((a, s) => a + s.slotUsd, 0).toFixed(2)),
  };
}

/** Pearson correlation over the pairs both series have. Copied from `backtest_portfolio.ts`. */
function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Spearman — Pearson on ranks, ties averaged. */
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
    positiveShare: Number((s.filter((r) => r > 0).length / s.length).toFixed(3)),
    median: Number(s[Math.floor(s.length / 2)].toFixed(4)),
    chosenRank: s.filter((r) => r > chosen).length + 1,
  };
}

/**
 * §3.7's four tests on ONE window, on ONE venue. `own` is the venue the row
 * would run on and whose costs chose nothing; `other` is the cross-venue
 * check (§4.16: a single-venue coin clears the four tests on THAT venue's
 * costs). Copied from `backtest_portfolio.ts`'s `barTests`, generalised to
 * either venue the way `backtest_kraken.ts` generalised it.
 */
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
    ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)), retOverDD: Number(score(r).toFixed(2)),
    trades: r.trades, days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)), stopsHit: r.stopsHit ?? 0,
  };
}
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

// ─────────────────────────────────────────────── the exact chance arithmetic

/** log C(n, k) — exact enough in doubles for n ≤ 27 and used only for the null below. */
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
/**
 * The exact distribution of how many of `n` coins clear ALL of the windows
 * whose pass counts are `ks`, when each window's clearers are an independent
 * uniform subset of that size. No sampling: the intersection of the first
 * two is hypergeometric, and each further window intersects that.
 */
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

// ──────────────────────────────────────────────────────── the data and splice

type Sources = {
  symbol: string;
  coinbase: { bars: number; first: string; last: string; bars4h: number };
  kraken: { pair: string; bars: number; first: string; last: string; bytes: number };
  spliceAtIso: string;
  overlap: {
    hourlyBars: number; hourlyMedianBps: number; hourlyP95Bps: number; hourlyMaxBps: number;
    bars4h: number; median4hBps: number; p954hBps: number; max4hBps: number;
  } | null;
  extension: { bars: number; first: string; last: string; years: number };
  combined: { barsHourly: number; bars4h: number; first: string; last: string };
  accepted: boolean; rejected: string[];
};

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const toCandles = (raw: Raw[]): Candle[] => raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));

/** The bar at or after `ts`, or the array length when there is none. */
function indexAtOrAfter(bars: Candle[], ts: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].start < ts) lo = mid + 1; else hi = mid; }
  return lo;
}

type Win = {
  name: "A" | "B" | "C" | "D";
  /**
   * Which series the PARAMETERS are chosen on. A and B choose on the
   * COINBASE-ONLY series from bar 0 — the literal call every published table
   * made, warts and all: at the very start of that array the 30 daily closes
   * the momentum gate needs do not exist yet, so the first weeks block
   * entries. C and D choose on the combined series, where that history is
   * real and present. The asymmetry is measured and reported
   * (`fidelity.warmupSensitivity`) rather than smoothed over, because
   * reproducing A and B exactly is what makes C comparable to them at all.
   */
  isSeries: "coinbase" | "combined";
  isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  isDays: number; oosDays: number; isFromIso: string; oosFromIso: string; oosToIso: string;
  scored: boolean; why: string;
};

const YEAR_MS = 365 * 86400e3;

/**
 * The four windows on the COMBINED series. A and B keep the exact calendar
 * boundaries every published table used — the coin's own Coinbase series cut
 * in thirds — and C and D are the two the extension makes possible, each
 * with its parameters chosen on the 24 months immediately before the year it
 * scores. Nothing is ever chosen on data that the window then scores.
 */
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

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), outDir = String(args.out ?? "docs/agents/backtests");
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  if (!extDir) throw new Error("--ext <dir with BTC-USD_1h_kraken.json …> is required (Kraken's quarterly OHLCVT bundle, 60-minute series)");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  // `backtest.ts` is an input to this study, and it was edited by another session while the
  // study was being written. Its content is hashed at the start and again at the end, so a
  // run that straddles an edit fails loudly instead of writing half a result.
  const btPath = new URL("./backtest.ts", import.meta.url);
  const sha = async (u: URL) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(u));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btHashStart = await sha(btPath);

  // Every coin with a MEASURED half-spread on BOTH venues and a file in both directories (§3.7: a
  // guessed spread is a made-up number dressed as a result).
  const priced = Object.keys(COSTS.revx.halfSpread).filter((s) => COSTS.kraken.halfSpread[s] != null).sort();
  const haveData = new Set<string>(), haveExt = new Set<string>();
  for await (const e of Deno.readDir(dataDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_3y\.json$/); if (m) haveData.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(extDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_kraken\.json$/); if (m) haveExt.add(`${m[1]}/USD`); }
  const candidates = priced.filter((s) => haveData.has(s) && haveExt.has(s));
  console.log(`candidates (${candidates.length}): ${candidates.join(", ")}`);
  // The converter writes which Kraken pair each file came from, so the report can name it.
  let extPairs: Record<string, string> = {};
  try {
    const pv = JSON.parse(await Deno.readTextFile(`${extDir}/provenance.json`)) as Record<string, { krakenPair: string }>;
    extPairs = Object.fromEntries(Object.entries(pv).map(([k, v]) => [k, v.krakenPair]));
  } catch { /* the pair name is cosmetic */ }

  // ── splice and verify ───────────────────────────────────────────────────
  type Series = { c4h: Candle[]; daily: Candle[]; cb4h: Candle[]; cbDaily: Candle[]; wins: Win[] };
  const series: Record<string, Series> = {};
  const provenance: Sources[] = [];
  const symbols: string[] = [];
  const MAX_LOOKBACK = 301;   // the widest grid point below (slow 300) plus one

  for (const symbol of candidates) {
    const base = symbol.replace("/", "-");
    const cbRaw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${base}_1h_3y.json`));
    const kRaw: Raw[] = JSON.parse(await Deno.readTextFile(`${extDir}/${base}_1h_kraken.json`));
    const kBytes = (await Deno.stat(`${extDir}/${base}_1h_kraken.json`)).size;
    const cbH = toCandles(cbRaw), kH = toCandles(kRaw);
    const spliceAt = cbH[0].start;

    // The overlap: every hour both sources carry, from the Coinbase series' first bar to the
    // bundle's last. Differences are |Δclose| in basis points of the Coinbase close.
    const kByTs = new Map(kH.map((c) => [c.start, c]));
    const hourlyDiffs: number[] = [];
    for (const c of cbH) { const k = kByTs.get(c.start); if (k && c.close > 0) hourlyDiffs.push(Math.abs(k.close / c.close - 1) * 1e4); }
    const cb4hAll = resample(cbH, 4), k4hAll = resample(kH, 4);
    const k4hByTs = new Map(k4hAll.map((c) => [c.start, c]));
    const kLast = kH[kH.length - 1].start;
    const diffs4h: number[] = [];
    for (const c of cb4hAll) {
      if (c.start > kLast) continue;
      const k = k4hByTs.get(c.start);
      if (k && c.close > 0) diffs4h.push(Math.abs(k.close / c.close - 1) * 1e4);
    }
    const overlap = diffs4h.length >= 100 && hourlyDiffs.length >= 100
      ? {
        hourlyBars: hourlyDiffs.length, hourlyMedianBps: Number(median(hourlyDiffs).toFixed(2)),
        hourlyP95Bps: Number(quantile(hourlyDiffs, 0.95).toFixed(2)), hourlyMaxBps: Number(Math.max(...hourlyDiffs).toFixed(2)),
        bars4h: diffs4h.length, median4hBps: Number(median(diffs4h).toFixed(2)),
        p954hBps: Number(quantile(diffs4h, 0.95).toFixed(2)), max4hBps: Number(Math.max(...diffs4h).toFixed(2)),
      }
      : null;

    const extension = kH.filter((c) => c.start < spliceAt);
    const combH = [...extension, ...cbH];
    const comb4h = resample(combH, 4), combDaily = resample(combH, 24);
    const cbDaily = resample(cbH, 24);
    const wins = windowsOn(comb4h, cb4hAll, MAX_LOOKBACK);

    const rejected: string[] = [];
    if (!overlap) rejected.push(`overlap is ${diffs4h.length} 4h bars — too few to verify`);
    else {
      if (overlap.median4hBps > OVERLAP_MEDIAN_MAX_BPS) rejected.push(`overlap median ${overlap.median4hBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`);
      if (overlap.p954hBps > OVERLAP_P95_MAX_BPS) rejected.push(`overlap p95 ${overlap.p954hBps} bps > ${OVERLAP_P95_MAX_BPS}`);
    }
    // A coin whose overlap does not match is dropped. A coin whose extension is too short to
    // CHOOSE parameters on keeps its windows A and B — it stays in the 27-coin population the
    // null and the correlations are estimated from — and its window C is simply absent.

    provenance.push({
      symbol,
      coinbase: { bars: cbH.length, first: iso(cbH[0].start), last: iso(cbH[cbH.length - 1].start), bars4h: cb4hAll.length },
      kraken: { pair: extPairs[symbol] ?? "", bars: kH.length, first: iso(kH[0].start), last: iso(kH[kH.length - 1].start), bytes: kBytes },
      spliceAtIso: iso(spliceAt),
      overlap,
      extension: {
        bars: extension.length,
        first: extension.length ? iso(extension[0].start) : "",
        last: extension.length ? iso(extension[extension.length - 1].start) : "",
        years: Number((extension.length ? (spliceAt - extension[0].start) / YEAR_MS : 0).toFixed(2)),
      },
      combined: { barsHourly: combH.length, bars4h: comb4h.length, first: iso(combH[0].start), last: iso(combH[combH.length - 1].start) },
      accepted: rejected.length === 0, rejected,
    });
    series[symbol] = { c4h: comb4h, daily: combDaily, cb4h: cb4hAll, cbDaily, wins };
    if (rejected.length === 0) symbols.push(symbol);
    console.log(`${symbol.padEnd(9)} overlap ${overlap ? `${overlap.bars4h} 4h bars, median ${overlap.median4hBps} bps, p95 ${overlap.p954hBps}, max ${overlap.max4hBps}` : "none"} | extension ${provenance[provenance.length - 1].extension.years} y | windows ${wins.filter((w) => w.scored).map((w) => w.name).join("") || "—"} | ${rejected.length ? "REJECTED: " + rejected.join("; ") : "accepted"}`);
  }
  console.log(`accepted (${symbols.length}): ${symbols.join(", ")}`);

  // ── the grids ───────────────────────────────────────────────────────────
  // §3.7's 27 points, unchanged, so the plateau means what every other table
  // means by it; §3.12's eight wide points; §3.9's regime grid as
  // `backtest_portfolio.ts` ran it (the ATR trail stays at its default,
  // because the gate is the variable under test).
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const SEEDED_IDX = TREND_GRID.findIndex((p) => p.fast === DEFAULT_TREND.fast && p.slow === DEFAULT_TREND.slow && p.atrStop === DEFAULT_TREND.atrStop);
  const WIDE_GRID: TrendParams[] = [];
  for (const slow of [200, 300]) for (const breakoutUp of [100, 200]) for (const atrStop of [4, 6]) {
    WIDE_GRID.push({ ...DEFAULT_TREND, slow, breakoutUp, breakoutDown: Math.round(breakoutUp / 2.75), atrStop });
  }
  const REGIME_N = [100, 150, 200];
  const REGIME_GRID: { p: TrendParams; n: number }[] = [];
  for (const n of REGIME_N) for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) REGIME_GRID.push({ p: { ...DEFAULT_TREND, fast, slow }, n });

  const btcDaily = series["BTC/USD"].daily;
  const btcRegime: BtcRegime = { daily: btcDaily, sma: Object.fromEntries(REGIME_N.map((n) => [n, sma(btcDaily.map((c) => c.close), n)])) };
  // The same thing on the Coinbase-only series, for the windows whose parameters are chosen the way
  // §3.9 and §3.10 chose them.
  const btcDailyCb = series["BTC/USD"].cbDaily;
  const btcRegimeCb: BtcRegime = { daily: btcDailyCb, sma: Object.fromEntries(REGIME_N.map((n) => [n, sma(btcDailyCb.map((c) => c.close), n)])) };
  const VENUES = ["revx", "kraken"] as const;
  const other = (v: "revx" | "kraken") => v === "revx" ? "kraken" as const : "revx" as const;

  const report: Record<string, unknown> = {
    study: "the third window — a walk-forward window the two existing ones could not have, and the live candidate, the one-window cohort and the two written-down rule candidates scored on it",
    source: "Windows A and B are the coin's own Coinbase Exchange hourly candles cut in thirds exactly as §3.7 / §3.8 / §3.10 / §3.11 cut them. Window C (and D) use history from Kraken's free quarterly OHLCVT bundle (Kraken_OHLCVT_Full_2026Q2, 60-minute series), SPLICED before the Coinbase series' first bar and verified against Coinbase bar for bar over everything the two share. Fills, fees, the protective exits and the two-bar cooldown are backtest.ts's own; the exits are priced under BOTH stop rules (see `stopRules`): Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). The model is not in the backtest.",
    bar: "docs/agents/reference.md §3.7 / §4.15 / §4.16: positive out of sample on the venue the row would run on, max drawdown < 35 %, at least half the grid positive out of sample on that venue, positive on the other venue's costs — and a book on the running venue of at least $100k a day. Reported per window; 'clears' with no window named never means averaged.",
    windows: {
      note: "Each coin's own Coinbase series is cut in thirds on its OWN bar count, as every earlier study cut it. The three windows tile that series; D is a fourth, reported separately and never folded into a three-window count.",
      A: "parameters on the first two thirds, the LAST third out of sample",
      B: "parameters on the first third, the MIDDLE third out of sample",
      C: "parameters on the 24 months of extended history before the series starts, the FIRST third out of sample",
      D: "parameters on the 24 months before that, the 12 months before the series out of sample. D's scored year is inside C's in-sample — what a rolling walk-forward always does, said rather than hidden — so D is a fourth check on the same rules, never a fourth independent draw.",
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
    },
    determinism: "No wall-clock field is written. Re-running over the same two data directories reproduces this file byte for byte; the null distribution is computed exactly rather than sampled.",
    overlapTest: { medianMaxBps: OVERLAP_MEDIAN_MAX_BPS, p95MaxBps: OVERLAP_P95_MAX_BPS, minInSampleDays: MIN_IN_SAMPLE_DAYS, note: "written down before the two sources were compared; §3.12 measured 0.93–6.11 bps median and 3.2–22.9 p95 on eight coins over 120 days, so these are loose enough not to reject a good coin and tight enough to catch a different asset or a stale book" },
    caps: { maxOrderUsd: MAX_ORDER_USD, liveCandidate: LIVE_CANDIDATE },
    stopRules: {
      note: "EVERY figure in this file is reported twice, under `perStopRule.shipped` and `perStopRule.trail`, and is never averaged between them. The repository's protective exits changed while this study ran (reference §3.13): the intra-bar ATR trail duplicated the trail `ruleDecision` already applies to the close, so it was removed and the 8 % floor kept.",
      shipped: { stops: stopsForKind("trend-4h", DEFAULT_TREND), constant: { ...SHIPPED_STOPS }, what: "what backtest.ts ships at the moment of this run, and what tick.ts runs — the live decision is about this one" },
      trail: { stops: { ...PINNED_STOPS }, what: "the 8 % floor plus the 3×ATR(14) intra-bar trail — what §3.7 / §3.8 / §3.10 / §3.11 were computed under, and the only rule under which windows A and B are comparable to their published selves" },
    },
    costs: COSTS,
    ukBookUsdPerDay: UK_BOOK_USD_PER_DAY,
    krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY,
    minBookUsd: MIN_BOOK_USD,
    grids: {
      "trend-4h": { points: TREND_GRID.length, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [2, 3, 4], seeded: { fast: DEFAULT_TREND.fast, slow: DEFAULT_TREND.slow, atrStop: DEFAULT_TREND.atrStop } },
      "trend-4h-wide": { points: WIDE_GRID.length, slow: [200, 300], breakoutUp: [100, 200], breakoutDown: "round(breakoutUp / 2.75)", atrStop: [4, 6], seeded: null },
      "regime-trend-4h": { points: REGIME_GRID.length, btcSmaDays: REGIME_N, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [DEFAULT_TREND.atrStop], seeded: null },
    },
    data: { krakenBundle: "assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full_2026Q2.zip.part00-04 — 8,972,380,104 bytes in five parts, 12,037 CSV entries, every pair from its first trade to 2026-06-30 at 1/5/15/60/240/720/1440 minutes. The 60-minute USD series is what this study reads; POL's pre-rename history is Kraken's MATICUSD, which is checked against Coinbase's POL-USD on their seven-month overlap like every other coin.", perSymbol: provenance },
  };



  // ── the two stop rules this study prices everything under ───────────────
  //
  // The repository changed its protective exits while this study was running
  // (commit eff6ca8, reference §3.13): the intra-bar ATR trail duplicated the
  // trail `ruleDecision` already applies to the CLOSE — same high-water
  // anchor, same multiplier — and the per-minute copy always fired first, so
  // it was removed and the 8 % floor kept. That is a change to the rule, not
  // to this study's arithmetic, and it moves every number: the live sleeve's
  // window A goes from −0.3 % to +8.0 %. So BOTH rules are priced here, the
  // same grid, windows and bar under each:
  //
  //   `shipped` — what `stopsForKind` returns now, which is what `tick.ts`
  //               runs. This is the rule the live decision is about.
  //   `trail`   — the floor plus the 3×ATR intra-bar trail, which is what
  //               §3.7 / §3.8 / §3.10 / §3.11 were computed under. Windows A
  //               and B are only comparable to their published selves here,
  //               and `fidelity.publishedCrossCheck` proves it.
  //
  // Every block below exists twice, once per rule, and the report says which
  // is which. Nothing is averaged between them and no number is adjusted by
  // hand.
  type Regime = { id: "shipped" | "trail"; label: string; stops: (p: TrendParams) => StopParams };
  const REGIMES: Regime[] = [
    { id: "shipped", label: "the stops backtest.ts ships at the moment of this run — the 8 % floor alone, the intra-bar trail removed (reference §3.13)", stops: (p) => stopsForKind("trend-4h", p) },
    { id: "trail", label: "the 8 % floor and the 3×ATR(14) intra-bar trail — the pair §3.7 / §3.8 / §3.10 / §3.11 were computed under", stops: (p) => ({ ...PINNED_STOPS, atrStop: p.atrStop }) },
  ];

  type Cell = {
    chosen: { fast: number; slow: number; atrStop: number };
    chosenOwn: ReturnType<typeof pick>; chosenOther: ReturnType<typeof pick>;
    seededOwn: ReturnType<typeof pick>; seededOther: ReturnType<typeof pick>;
    plateau: Plateau; chosenPass: boolean; chosenFailed: string[]; seededPass: boolean; seededFailed: string[];
  };
  type CoinWindows = Record<string, Record<string, Cell>>;      // [window][venue]

  /** Choose in sample over `grid` on one venue's costs, report the chosen point and the whole grid out of sample. */
  function studyVenue(
    grid: TrendParams[], seededIdx: number, venue: "revx" | "kraken",
    inSample: (p: TrendParams, c: Costs) => RunResult, outOfSample: (p: TrendParams, c: Costs) => RunResult,
  ): Cell {
    const own = COSTS[venue], oth = COSTS[other(venue)];
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < grid.length; i++) { const s = score(inSample(grid[i], own)); if (s > bestScore) { bestScore = s; bestIdx = i; } }
    const oosOwn = grid.map((p) => outOfSample(p, own));
    const plateau = plateauOf(oosOwn.map((r) => r.ret), oosOwn[bestIdx].ret);
    const chosenOther = outOfSample(grid[bestIdx], oth);
    const seededOther = seededIdx >= 0 ? outOfSample(grid[seededIdx], oth) : chosenOther;
    const chosen = barTests(oosOwn[bestIdx], chosenOther, plateau);
    const seeded = seededIdx >= 0 ? barTests(oosOwn[seededIdx], seededOther, plateau) : { pass: false, failed: ["no seeded point in this grid"] };
    return {
      chosen: { fast: grid[bestIdx].fast, slow: grid[bestIdx].slow, atrStop: grid[bestIdx].atrStop },
      chosenOwn: pick(oosOwn[bestIdx]), chosenOther: pick(chosenOther),
      seededOwn: pick(oosOwn[seededIdx >= 0 ? seededIdx : bestIdx]), seededOther: pick(seededOther),
      plateau, chosenPass: chosen.pass, chosenFailed: chosen.failed, seededPass: seeded.pass, seededFailed: seeded.failed,
    };
  }

  type RegimeTables = {
    trend: Record<string, CoinWindows>;
    wide: Record<string, CoinWindows>;
    regimeFilter: Record<string, Record<string, Cell & { baselineOwn: number; entriesRemoved: number; btcSmaDays: number }>>;
    seededSleeve: Record<string, Record<string, GatedResult>>;
    warmupCells: { symbol: string; window: string; venue: string; publishedChosen: string; warmedChosen: string; publishedOos: number; warmedOos: number }[];
    fidelityGated: { checks: number; worstAbsRetDiff: number; worstAbsMaxDDDiff: number; worstAbsTradeDiff: number };
    armsLookedAt: number;
  };

  /** The whole per-coin study under one stop rule. */
  function studyUnder(reg: Regime): RegimeTables {
    const st = reg.stops;
    const trend: Record<string, CoinWindows> = {}, wide: Record<string, CoinWindows> = {};
    const regimeFilter: RegimeTables["regimeFilter"] = {};
    const seededSleeve: Record<string, Record<string, GatedResult>> = {};
    const warmupCells: RegimeTables["warmupCells"] = [];
    let armsLookedAt = 0;
    let gChecks = 0, gRet = 0, gDD = 0, gTrades = 0;
    for (const symbol of symbols) {
      const t0 = Date.now();
      const { c4h, daily, cb4h, cbDaily, wins } = series[symbol];
      trend[symbol] = {}; wide[symbol] = {}; regimeFilter[symbol] = {}; seededSleeve[symbol] = {};
      for (const w of wins.filter((x) => x.scored)) {
        trend[symbol][w.name] = {}; wide[symbol][w.name] = {};
        // Windows A and B choose their parameters with the exact call every published table made —
        // `run(..., cb4h, cbDaily, 0, isTo, …)` on the coin's own Coinbase series. C and D have no
        // published counterpart and choose on the combined series, where the warm-up is real.
        const onCb = w.isSeries === "coinbase";
        const isTrend = (p: TrendParams, c: Costs) => onCb
          ? run("trend-4h", symbol, cb4h, cbDaily, w.isFrom, w.isTo, p, c, 4, st(p))
          : run("trend-4h", symbol, c4h, daily, w.isFrom, w.isTo, p, c, 4, st(p));
        for (const v of VENUES) {
          trend[symbol][w.name][v] = studyVenue(TREND_GRID, SEEDED_IDX, v, isTrend,
            (p, c) => run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, p, c, 4, st(p)));
          wide[symbol][w.name][v] = studyVenue(WIDE_GRID, -1, v, isTrend,
            (p, c) => run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, p, c, 4, st(p)));
          armsLookedAt += TREND_GRID.length + WIDE_GRID.length;
          // `runGated` with the gate off must BE `run`, under this stop rule as under the other.
          {
            const a = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS[v], 4, st(DEFAULT_TREND));
            const b = runGated(symbol, c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1, shippedDecider("trend-4h", symbol, c4h, daily, DEFAULT_TREND, 4), COSTS[v], st(DEFAULT_TREND), null);
            gChecks++; gRet = Math.max(gRet, Math.abs(a.ret - b.ret)); gDD = Math.max(gDD, Math.abs(a.maxDD - b.maxDD)); gTrades = Math.max(gTrades, Math.abs(a.trades - b.trades));
          }
          if (onCb) {
            // The same window chosen with the warm-up the extension makes available, so the size of
            // the one methodological difference between A/B and C/D is a number rather than a worry.
            let bestIdx = 0, bestScore = -Infinity;
            const from = indexAtOrAfter(c4h, cb4h[0].start), to = indexAtOrAfter(c4h, cb4h[w.isTo].start);
            for (let i = 0; i < TREND_GRID.length; i++) {
              const sc = score(run("trend-4h", symbol, c4h, daily, from, to, TREND_GRID[i], COSTS[v], 4, st(TREND_GRID[i])));
              if (sc > bestScore) { bestScore = sc; bestIdx = i; }
            }
            const wp = TREND_GRID[bestIdx];
            const warmedOos = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, wp, COSTS[v], 4, st(wp));
            const ch = trend[symbol][w.name][v].chosen;
            warmupCells.push({
              symbol, window: w.name, venue: v,
              publishedChosen: `${ch.fast}/${ch.slow}/${ch.atrStop}`, warmedChosen: `${wp.fast}/${wp.slow}/${wp.atrStop}`,
              publishedOos: trend[symbol][w.name][v].chosenOwn.ret, warmedOos: Number(warmedOos.ret.toFixed(4)),
            });
            armsLookedAt += TREND_GRID.length;
          }
        }
        // §3.9's regime gate — Revolut X costs, with Kraken as the cross-venue test, which is where
        // §3.9 and §3.10 tested it.
        {
          let bestIdx = 0, bestScore = -Infinity;
          const isRun = (g: { p: TrendParams; n: number }, c: Costs) => onCb
            ? runGated(symbol, cb4h, w.isFrom, w.isTo, g.p.slow + 1, shippedDecider("trend-4h", symbol, cb4h, cbDaily, g.p, 4), c, st(g.p), regimeGate(cb4h, btcRegimeCb, g.n, 4))
            : runGated(symbol, c4h, w.isFrom, w.isTo, g.p.slow + 1, shippedDecider("trend-4h", symbol, c4h, daily, g.p, 4), c, st(g.p), regimeGate(c4h, btcRegime, g.n, 4));
          const oosRun = (g: { p: TrendParams; n: number }, c: Costs) => runGated(symbol, c4h, w.oosFrom, w.oosTo, g.p.slow + 1, shippedDecider("trend-4h", symbol, c4h, daily, g.p, 4), c, st(g.p), regimeGate(c4h, btcRegime, g.n, 4));
          for (let i = 0; i < REGIME_GRID.length; i++) { const sc = score(isRun(REGIME_GRID[i], COSTS.revx)); if (sc > bestScore) { bestScore = sc; bestIdx = i; } }
          const oosRevx = REGIME_GRID.map((g) => oosRun(g, COSTS.revx));
          const plateau = plateauOf(oosRevx.map((r) => r.ret), oosRevx[bestIdx].ret);
          const kr = oosRun(REGIME_GRID[bestIdx], COSTS.kraken);
          const tests = barTests(oosRevx[bestIdx], kr, plateau);
          const gp: TrendParams = { ...DEFAULT_TREND, fast: REGIME_GRID[bestIdx].p.fast, slow: REGIME_GRID[bestIdx].p.slow };
          const off = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, gp, COSTS.revx, 4, st(gp));
          regimeFilter[symbol][w.name] = {
            chosen: { fast: gp.fast, slow: gp.slow, atrStop: gp.atrStop }, btcSmaDays: REGIME_GRID[bestIdx].n,
            chosenOwn: pick(oosRevx[bestIdx]), chosenOther: pick(kr),
            seededOwn: pick(off), seededOther: pick(off),
            plateau, chosenPass: tests.pass, chosenFailed: tests.failed, seededPass: false, seededFailed: ["the regime rule does not ship, so it has no seeded point"],
            baselineOwn: trend[symbol][w.name].revx.chosenOwn.ret, entriesRemoved: off.trades - oosRevx[bestIdx].trades,
          };
          armsLookedAt += REGIME_GRID.length;
        }
        seededSleeve[symbol][w.name] = runGated(symbol, c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1,
          shippedDecider("trend-4h", symbol, c4h, daily, DEFAULT_TREND, 4), COSTS.revx, st(DEFAULT_TREND), null);
      }
      const line = (n: string) => trend[symbol][n] ? `${n} ${(trend[symbol][n].revx.chosenOwn.ret * 100).toFixed(1)}%/${(trend[symbol][n].revx.seededOwn.ret * 100).toFixed(1)}%${trend[symbol][n].revx.chosenPass ? "*" : ""}` : `${n} —`;
      console.log(`[${reg.id}] ${symbol.padEnd(9)} ${["C", "B", "A", "D"].map(line).join("  ")} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    return { trend, wide, regimeFilter, seededSleeve, warmupCells, armsLookedAt, fidelityGated: { checks: gChecks, worstAbsRetDiff: gRet, worstAbsMaxDDDiff: gDD, worstAbsTradeDiff: gTrades } };
  }

  // ── everything derived from one regime's tables ─────────────────────────
  const SLOT = Math.min(LIVE_CANDIDATE.capitalUsd / LIVE_CANDIDATE.slots, MAX_ORDER_USD);

  function derive(reg: Regime, T: RegimeTables): Record<string, unknown> {
    const { trend, wide, regimeFilter, seededSleeve } = T;
    const POP = symbols.filter((s) => ["A", "B", "C"].every((w) => trend[s][w] != null));
    const passOn = (s: string, w: string, v: "revx" | "kraken", how: "chosen" | "seeded"): boolean | null => {
      const cell = trend[s]?.[w]?.[v];
      if (!cell) return null;
      const book = v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0);
      return (how === "chosen" ? cell.chosenPass : cell.seededPass) && book >= MIN_BOOK_USD;
    };

    // ── W2: the live candidate on every window it has ─────────────────────
    const COMMON_MEMBERS = LIVE_CANDIDATE.symbols.filter((s) => ["A", "B", "C"].every((w) => seededSleeve[s]?.[w]));
    const sleeveOf = (syms: string[], wname: string, slot: number): Sleeve[] => syms.filter((s) => seededSleeve[s]?.[wname]).map((s) => {
      const r = seededSleeve[s][wname];
      return {
        id: `trend-4h·revx·${s.split("/")[0]}`, symbol: s, slotUsd: slot, rets: dailyReturns(r.marks),
        ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * slot,
      };
    });
    const w2: Record<string, unknown> = {
      note: `${LIVE_CANDIDATE.row} · ${LIVE_CANDIDATE.venue} · ${LIVE_CANDIDATE.symbols.join(", ")} · $${LIVE_CANDIDATE.capitalUsd} · ${LIVE_CANDIDATE.slots} equal $${SLOT} slots · seeded parameters (fast ${DEFAULT_TREND.fast} / slow ${DEFAULT_TREND.slow} / ATR ${DEFAULT_TREND.atrStop}). Leave-one-out re-splits the row's capital equally between the coins that remain, as allocation.json's question5_coinChanges does; a positive delta means the row's return over drawdown improved without that coin.`,
      commonMembers: COMMON_MEMBERS, perWindow: {} as Record<string, unknown>,
    };
    for (const wname of ["A", "B", "C", "D"]) {
      const members = LIVE_CANDIDATE.symbols.filter((s) => seededSleeve[s]?.[wname]);
      if (members.length === 0) { (w2.perWindow as Record<string, unknown>)[wname] = { scored: false, why: "no member has this window" }; continue; }
      const sleeves = sleeveOf(members, wname, SLOT);
      const whole = combine(sleeves);
      const perCoin = members.map((s) => {
        const r = seededSleeve[s][wname], cell = trend[s][wname].revx;
        const years = Math.max(1e-9, r.days / 365);
        return {
          symbol: s, ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)), retOverDD: Number(score(r).toFixed(2)),
          trades: r.trades, stopsHit: r.stopsHit ?? 0, deployment: Number(r.exposure.toFixed(3)),
          turnoverPerYear: Number((r.tradedWeight / years).toFixed(2)), days: Math.round(r.days),
          chosenParamsRet: cell.chosenOwn.ret, plateau: cell.plateau.positiveShare,
          clearsBarSeeded: passOn(s, wname, "revx", "seeded"), clearsBarChosen: passOn(s, wname, "revx", "chosen"),
        };
      }).sort((a, b) => b.ret - a.ret);
      const leaveOneCoinOut = (members.length < 2 ? [] : members).map((sym) => {
        const keep = sleeves.filter((s) => s.symbol !== sym);
        const slot = whole.capitalUsd / keep.length;
        const without = combine(keep.map((s) => ({ ...s, slotUsd: slot, tradedUsd: s.tradedUsd / SLOT * slot })));
        return {
          symbol: sym, ownRet: Number(sleeves.find((s) => s.symbol === sym)!.ret.toFixed(4)),
          rowRetWithout: without.ret, rowMaxDDWithout: without.maxDD, rowRetOverDDWithout: without.retOverDD,
          deltaRetOverDD: Number((without.retOverDD - whole.retOverDD).toFixed(2)),
        };
      }).sort((a, b) => b.deltaRetOverDD - a.deltaRetOverDD);
      const commonHere = COMMON_MEMBERS.filter((s) => seededSleeve[s]?.[wname]);
      (w2.perWindow as Record<string, unknown>)[wname] = {
        scored: true, window: series[members[0]].wins.find((x) => x.name === wname)!, members: members.length, memberSymbols: members,
        sleeve: whole, sleeveCommonMembers: commonHere.length ? combine(sleeveOf(commonHere, wname, SLOT)) : null,
        commonMemberSymbols: commonHere, perCoin, leaveOneCoinOut,
      };
      console.log(`[${reg.id}] W2 ${wname}: sleeve ${(whole.ret * 100).toFixed(1)}% (DD ${(whole.maxDD * 100).toFixed(1)}%, ret/DD ${whole.retOverDD}, deployment ${(whole.deployment * 100).toFixed(1)}%, turnover ${whole.turnoverPerYear}×/y), AVAX ${perCoin.find((c) => c.symbol === "AVAX/USD") ? ((perCoin.find((c) => c.symbol === "AVAX/USD")!.ret) * 100).toFixed(1) + "%" : "—"}`);
    }

    // ── membership: which coins clear ONE of A and B, and which clear both ──
    const membership = (v: "revx" | "kraken", how: "chosen" | "seeded") => {
      const scored = symbols.filter((s) => trend[s].A?.[v] && trend[s].B?.[v]);
      const per = scored.map((s) => ({ symbol: s, cleared: (["A", "B"] as const).filter((w) => passOn(s, w, v, how) === true) }));
      return {
        venue: v, parameters: how, coinsWithBothWindows: scored.length,
        twoWindow: per.filter((x) => x.cleared.length === 2).map((x) => x.symbol),
        oneWindowA: per.filter((x) => x.cleared.length === 1 && x.cleared[0] === "A").map((x) => x.symbol),
        oneWindowB: per.filter((x) => x.cleared.length === 1 && x.cleared[0] === "B").map((x) => x.symbol),
        neither: per.filter((x) => x.cleared.length === 0).map((x) => x.symbol),
        notScored: symbols.filter((s) => !(trend[s].A?.[v] && trend[s].B?.[v])),
      };
    };

    // ── W3: the cohort as recorded and as re-derived, and the chance control ──
    const cohortRow = (symbol: string, venue: "revx" | "kraken", extra: Record<string, unknown>) => {
      const per: Record<string, unknown> = {};
      for (const wname of ["A", "B", "C", "D"]) {
        const cell = trend[symbol]?.[wname]?.[venue];
        per[wname] = cell
          ? {
            chosen: cell.chosen, chosenOwn: cell.chosenOwn, chosenOther: cell.chosenOther,
            seededOwn: cell.seededOwn, seededOther: cell.seededOther, plateau: cell.plateau.positiveShare,
            chosenPass: passOn(symbol, wname, venue, "chosen"), chosenFailed: cell.chosenFailed,
            seededPass: passOn(symbol, wname, venue, "seeded"), seededFailed: cell.seededFailed,
          }
          : null;
      }
      const w3 = ["A", "B", "C"];
      return {
        symbol, venue, ...extra,
        bookUsdPerDay: venue === "revx" ? (UK_BOOK_USD_PER_DAY[symbol] ?? null) : (KRAKEN_BOOK_USD_PER_DAY[symbol] ?? null),
        windowsScored: w3.filter((w) => per[w] != null).length,
        windowsClearedChosen: w3.filter((w) => passOn(symbol, w, venue, "chosen") === true).length,
        windowsClearedSeeded: w3.filter((w) => passOn(symbol, w, venue, "seeded") === true).length,
        clearsAllThreeChosen: w3.every((w) => passOn(symbol, w, venue, "chosen") === true),
        clearsAllThreeSeeded: w3.every((w) => passOn(symbol, w, venue, "seeded") === true),
        perWindow: per,
      };
    };

    function chanceBlock(v: "revx" | "kraken", how: "chosen" | "seeded") {
      const pop = POP.filter((s) => trend[s].A?.[v] && trend[s].B?.[v] && trend[s].C?.[v]);
      const n = pop.length;
      const ks = ["A", "B", "C"].map((w) => pop.filter((s) => passOn(s, w, v, how) === true).length);
      const observed = pop.filter((s) => ["A", "B", "C"].every((w) => passOn(s, w, v, how) === true));
      const dist = intersectionDistribution(n, ks);
      const p = ks.map((k) => k / n);
      const hist = [0, 0, 0, 0];
      for (let mask = 0; mask < 8; mask++) {
        let q = 1, c = 0;
        for (let b = 0; b < 3; b++) { const on = (mask >> b) & 1; q *= on ? p[b] : 1 - p[b]; c += on; }
        hist[c] += q * n;
      }
      return {
        venue: v, parameters: how, population: n, coins: pop,
        passesPerWindow: { A: ks[0], B: ks[1], C: ks[2] },
        observedAllThree: observed.length, which: observed,
        expectedAllThreeUnderNull: Number((n * p[0] * p[1] * p[2]).toFixed(2)),
        probabilityAtLeastObserved: Number(dist.slice(observed.length).reduce((a, b) => a + b, 0).toFixed(4)),
        nullDistribution: dist.slice(0, 6).map((x) => Number(x.toFixed(4))),
        windowsClearedHistogram: Object.fromEntries([0, 1, 2, 3].map((k) => [String(k), pop.filter((s) => ["A", "B", "C"].filter((w) => passOn(s, w, v, how) === true).length === k).length])),
        nullExpectedHistogram: Object.fromEntries([0, 1, 2, 3].map((k) => [String(k), Number(hist[k].toFixed(2))])),
        note: "The null is: each window's clearers are an independent uniform subset of the population, of the size that window actually produced. The distribution is exact (hypergeometric intersections), not sampled. It is the right control because the alternative on trial is that clearing one window says something about the next.",
      };
    }

    function predictiveness(v: "revx" | "kraken") {
      return ([{ a: "A", b: "B" }, { a: "A", b: "C" }, { a: "B", b: "C" }]).map(({ a, b }) => {
        const pop = POP.filter((s) => trend[s][a]?.[v] && trend[s][b]?.[v]);
        const ax = pop.map((s) => trend[s][a][v].chosenOwn.ret), bx = pop.map((s) => trend[s][b][v].chosenOwn.ret);
        const as = pop.map((s) => trend[s][a][v].seededOwn.ret), bs = pop.map((s) => trend[s][b][v].seededOwn.ret);
        const cnt = { pp: 0, pf: 0, fp: 0, ff: 0 };
        for (const s of pop) {
          const pa = passOn(s, a, v, "chosen") === true, pb = passOn(s, b, v, "chosen") === true;
          if (pa && pb) cnt.pp++; else if (pa && !pb) cnt.pf++; else if (!pa && pb) cnt.fp++; else cnt.ff++;
        }
        const n = pop.length, r1 = cnt.pp + cnt.pf, c1 = cnt.pp + cnt.fp;
        let pFisher = 0;
        for (let x = cnt.pp; x <= Math.min(r1, c1); x++) pFisher += hyper(n, r1, c1, x);
        return {
          windows: `${a} → ${b}`, coins: n,
          pearsonChosenReturns: Number((pearson(ax, bx) ?? NaN).toFixed(3)),
          spearmanChosenReturns: Number((spearman(ax, bx) ?? NaN).toFixed(3)),
          pearsonSeededReturns: Number((pearson(as, bs) ?? NaN).toFixed(3)),
          spearmanSeededReturns: Number((spearman(as, bs) ?? NaN).toFixed(3)),
          barContingency: cnt, fisherOneSidedP: Number(pFisher.toFixed(4)),
          rateGivenPass: r1 > 0 ? Number((cnt.pp / r1).toFixed(3)) : null,
          rateGivenFail: (n - r1) > 0 ? Number((cnt.fp / (n - r1)).toFixed(3)) : null,
        };
      });
    }

    const recorded = COHORT.map((m) => cohortRow(m.symbol, m.venue, { recordedAs: m.clearedWindow, note: m.note }));
    const mem = { revxChosen: membership("revx", "chosen"), revxSeeded: membership("revx", "seeded"), krakenChosen: membership("kraken", "chosen"), krakenSeeded: membership("kraken", "seeded") };
    const rederived = Object.fromEntries((Object.entries(mem)).map(([k, m]) => [k, {
      ...m,
      oneWindowScoredOnC: [...m.oneWindowA, ...m.oneWindowB].map((s) => cohortRow(s, m.venue, { clearedOfAB: m.oneWindowA.includes(s) ? "A" : "B" })),
      twoWindowScoredOnC: m.twoWindow.map((s) => cohortRow(s, m.venue, { clearedOfAB: "AB" })),
    }]));

    const w3 = {
      note: "Two cohorts, because the shipped stop changed: `asRecorded` is §3.8 / §3.12's written-down list, scored here; `reDerived` is the list this run's own windows A and B produce under THIS stop rule. A coin that cleared exactly one of A and B cannot, by construction, clear all three — so the question the numbers answer is whether window C reverses that.",
      asRecorded: recorded,
      reDerived: rederived,
      countsOnWindowC: Object.fromEntries((["revx", "kraken"] as const).flatMap((v) => (["chosen", "seeded"] as const).map((how) => [`${v}${how[0].toUpperCase()}${how.slice(1)}`,
        symbols.filter((s) => trend[s].C?.[v] && passOn(s, "C", v, how) === true)]))),
      chance: { revxChosen: chanceBlock("revx", "chosen"), revxSeeded: chanceBlock("revx", "seeded"), krakenChosen: chanceBlock("kraken", "chosen"), krakenSeeded: chanceBlock("kraken", "seeded") },
      predictiveness: { revx: predictiveness("revx"), kraken: predictiveness("kraken") },
      twoWindowClearers: TWO_WINDOW_CLEARERS.map((s) => ({
        symbol: s, ukBookUsdPerDay: UK_BOOK_USD_PER_DAY[s] ?? null, krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY[s] ?? null,
        perWindow: Object.fromEntries(["A", "B", "C", "D"].map((w) => [w, trend[s]?.[w]
          ? {
            revx: { chosen: trend[s][w].revx.chosen, chosenOwn: trend[s][w].revx.chosenOwn, seededOwn: trend[s][w].revx.seededOwn, plateau: trend[s][w].revx.plateau.positiveShare, chosenPass: passOn(s, w, "revx", "chosen"), seededPass: passOn(s, w, "revx", "seeded"), chosenFailed: trend[s][w].revx.chosenFailed, seededFailed: trend[s][w].revx.seededFailed },
            kraken: { chosen: trend[s][w].kraken.chosen, chosenOwn: trend[s][w].kraken.chosenOwn, seededOwn: trend[s][w].kraken.seededOwn, plateau: trend[s][w].kraken.plateau.positiveShare, chosenPass: passOn(s, w, "kraken", "chosen"), seededPass: passOn(s, w, "kraken", "seeded") },
            window: series[s].wins.find((x) => x.name === w) ?? null,
          }
          : null])),
      })),
    };

    // ── W4: the two written-down candidates ───────────────────────────────
    function candidateBlock(table: Record<string, CoinWindows>, v: "revx" | "kraken", named: string[]) {
      const pop = POP.filter((s) => table[s]?.A && table[s]?.B && table[s]?.C);
      const passed = (s: string, w: string) => {
        const cell = table[s]?.[w]?.[v];
        if (!cell) return null;
        const book = v === "revx" ? (UK_BOOK_USD_PER_DAY[s] ?? 0) : (KRAKEN_BOOK_USD_PER_DAY[s] ?? 0);
        return cell.chosenPass && book >= MIN_BOOK_USD;
      };
      const ks = ["A", "B", "C"].map((w) => pop.filter((s) => passed(s, w) === true).length);
      const all3 = pop.filter((s) => ["A", "B", "C"].every((w) => passed(s, w) === true));
      const dist = pop.length ? intersectionDistribution(pop.length, ks) : [1];
      return {
        venue: v, population: pop.length, passesPerWindow: { A: ks[0], B: ks[1], C: ks[2] },
        clearsAllThree: all3,
        expectedUnderNull: Number((pop.length ? pop.length * (ks[0] / pop.length) * (ks[1] / pop.length) * (ks[2] / pop.length) : 0).toFixed(2)),
        probabilityAtLeastObserved: Number(dist.slice(all3.length).reduce((a, b) => a + b, 0).toFixed(4)),
        all: pop.map((s) => ({ symbol: s, windowsCleared: ["A", "B", "C"].filter((w) => passed(s, w) === true), A: table[s].A[v].chosenOwn.ret, B: table[s].B[v].chosenOwn.ret, C: table[s].C[v].chosenOwn.ret, D: table[s].D?.[v]?.chosenOwn.ret ?? null })),
        named: named.map((s) => ({
          symbol: s,
          perWindow: Object.fromEntries(["A", "B", "C", "D"].map((w) => [w, table[s]?.[w]?.[v]
            ? { chosen: table[s][w][v].chosen, chosenOwn: table[s][w][v].chosenOwn, chosenOther: table[s][w][v].chosenOther, plateau: table[s][w][v].plateau.positiveShare, pass: passed(s, w), failed: table[s][w][v].chosenFailed }
            : null])),
          clearsAllThree: ["A", "B", "C"].every((w) => passed(s, w) === true),
          windowsCleared: ["A", "B", "C"].filter((w) => passed(s, w) === true),
        })),
      };
    }
    const regimeBlock = (() => {
      const pop = POP.filter((s) => regimeFilter[s]?.A && regimeFilter[s]?.B && regimeFilter[s]?.C);
      const passed = (s: string, w: string) => regimeFilter[s]?.[w] ? regimeFilter[s][w].chosenPass && (UK_BOOK_USD_PER_DAY[s] ?? 0) >= MIN_BOOK_USD : null;
      const ks = ["A", "B", "C"].map((w) => pop.filter((s) => passed(s, w) === true).length);
      const all3 = pop.filter((s) => ["A", "B", "C"].every((w) => passed(s, w) === true));
      const dist = pop.length ? intersectionDistribution(pop.length, ks) : [1];
      return {
        venue: "revx", population: pop.length, passesPerWindow: { A: ks[0], B: ks[1], C: ks[2] }, clearsAllThree: all3,
        expectedUnderNull: Number((pop.length ? pop.length * (ks[0] / pop.length) * (ks[1] / pop.length) * (ks[2] / pop.length) : 0).toFixed(2)),
        probabilityAtLeastObserved: Number(dist.slice(all3.length).reduce((a, b) => a + b, 0).toFixed(4)),
        named: REGIME_TWO_WINDOW.map((s) => ({
          symbol: s,
          perWindow: Object.fromEntries(["A", "B", "C", "D"].map((w) => [w, regimeFilter[s]?.[w]
            ? { chosen: regimeFilter[s][w].chosen, btcSmaDays: regimeFilter[s][w].btcSmaDays, chosenOwn: regimeFilter[s][w].chosenOwn, chosenKraken: regimeFilter[s][w].chosenOther, plateau: regimeFilter[s][w].plateau.positiveShare, pass: passed(s, w), failed: regimeFilter[s][w].chosenFailed, baselineOwn: regimeFilter[s][w].baselineOwn, entriesRemoved: regimeFilter[s][w].entriesRemoved }
            : null])),
          clearsAllThree: ["A", "B", "C"].every((w) => passed(s, w) === true),
          windowsCleared: ["A", "B", "C"].filter((w) => passed(s, w) === true),
        })),
        all: pop.map((s) => ({ symbol: s, windowsCleared: ["A", "B", "C"].filter((w) => passed(s, w) === true), A: regimeFilter[s].A.chosenOwn.ret, B: regimeFilter[s].B.chosenOwn.ret, C: regimeFilter[s].C.chosenOwn.ret, baselineA: regimeFilter[s].A.baselineOwn, baselineB: regimeFilter[s].B.baselineOwn, baselineC: regimeFilter[s].C.baselineOwn })),
      };
    })();

    const moved = T.warmupCells.filter((c) => c.publishedChosen !== c.warmedChosen);
    const totalCells = symbols.reduce((a, s) => a + Object.keys(trend[s]).length, 0);
    return {
      stops: reg.stops(DEFAULT_TREND), stopsLabel: reg.label,
      fidelity: {
        runGated: { ...T.fidelityGated, note: "runGated with gate = null against backtest.ts's run, every accepted coin × every scored window × both venues, seeded parameters, under THIS stop rule: largest absolute difference in return, drawdown and trade count." },
        warmupSensitivity: {
          cells: T.warmupCells.length, cellsWhoseChosenPointMoved: moved.length,
          worstAbsRetDiff: Number(Math.max(0, ...T.warmupCells.map((c) => Math.abs(c.warmedOos - c.publishedOos))).toFixed(4)),
          medianAbsRetDiff: Number(median(T.warmupCells.map((c) => Math.abs(c.warmedOos - c.publishedOos))).toFixed(4)),
          moved: moved.sort((a, b) => Math.abs(b.warmedOos - b.publishedOos) - Math.abs(a.warmedOos - a.publishedOos)),
          note: "Windows A and B choose their parameters the way every published table chose them — on the coin's own Coinbase array from bar 0, where the first weeks have no 30 daily closes for the momentum gate and so block entries. Windows C and D choose on the combined series, where that history exists. This block measures the difference by re-choosing A and B WITH the warm-up: how many coin × window × venue cells pick a different grid point, and what that does to the out-of-sample return.",
        },
      },
      membership: mem,
      w2_liveCandidate: w2,
      w3_oneWindowCohort: w3,
      w4_candidates: {
        note: "§3.12's `trend-4h-wide` (slow 200/300, breakout 100/200, 4/6×ATR — the one rulebook whose mean round trip clears a Kraken cost at t > 2) and §3.9 / §3.10's BTC-regime entry gate (the one surviving idea, which cleared both existing windows on LINK, NEAR, SUI and ALGO). Both are scored on all three windows with parameters chosen per window, and both get the same chance control as W3.",
        "trend-4h-wide": { revx: candidateBlock(wide, "revx", WIDE_CANDIDATES), kraken: candidateBlock(wide, "kraken", WIDE_CANDIDATES) },
        "regime-trend-4h": regimeBlock,
      },
      perCoin: Object.fromEntries(symbols.map((s) => [s, {
        windows: series[s].wins,
        ukBookUsdPerDay: UK_BOOK_USD_PER_DAY[s] ?? null, krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY[s] ?? null,
        "trend-4h": trend[s], "trend-4h-wide": wide[s], "regime-trend-4h": regimeFilter[s],
      }])),
      multipleComparisons: {
        armsLookedAt: T.armsLookedAt, coinWindowsScored: totalCells,
        note: `An "arm" is one parameter point run out of sample on one coin, one window and one venue's costs. ${T.armsLookedAt} of them were looked at under this stop rule across ${totalCells} coin-windows; the chance columns inside w3 and w4 are the control that matters, because they ask how many coins a null would put through a four-part bar on three windows given how many cleared each window on its own. A study this wide always produces a handful of passes; the question is never whether there are any, it is whether there are more than chance gives.`,
        windowsPerCoin: Object.fromEntries(symbols.map((s) => [s, series[s].wins.filter((w) => w.scored).map((w) => w.name)])),
      },
    };
  }

  // ── run the study twice, once per stop rule ─────────────────────────────
  const tables: Record<string, RegimeTables> = {};
  const derived: Record<string, Record<string, unknown>> = {};
  for (const reg of REGIMES) {
    const t = Date.now();
    tables[reg.id] = studyUnder(reg);
    derived[reg.id] = derive(reg, tables[reg.id]);
    console.log(`[${reg.id}] done in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  // ── does this harness reproduce §3.8's published table? ─────────────────
  // Only the `trail` rule can: §3.8 was computed under it. The same comparison
  // under `shipped` is not a failure, it is the size of the stop change against
  // the published record, and it is reported as such.
  {
    const out: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const trend = tables[reg.id].trend;
      const rows: { symbol: string; window: string; published: number; here: number | null; delta: number | null; note: string }[] = [];
      for (const [wname, table] of [["A", PUBLISHED_3_8_A], ["B", PUBLISHED_3_8_B]] as const) {
        for (const [symbol, published] of Object.entries(table).sort()) {
          const cell = trend[symbol]?.[wname]?.revx;
          rows.push({
            symbol, window: wname, published,
            here: cell ? cell.chosenOwn.ret : null,
            delta: cell ? Number((cell.chosenOwn.ret - published).toFixed(4)) : null,
            note: cell ? "" : `not scored here: ${series[symbol]?.wins.find((w) => w.name === wname)?.why ?? "coin absent"}`,
          });
        }
      }
      const matched = rows.filter((r) => r.delta != null);
      out[reg.id] = {
        rows: rows.length, compared: matched.length,
        worstAbsDelta: Number(Math.max(0, ...matched.map((r) => Math.abs(r.delta!))).toFixed(4)),
        medianAbsDelta: Number(median(matched.map((r) => Math.abs(r.delta!))).toFixed(4)),
        withinOneTenthOfAPoint: matched.filter((r) => Math.abs(r.delta!) <= 0.001).length,
        table: rows,
      };
      console.log(`[${reg.id}] published cross-check: ${matched.length}/${rows.length} compared, worst |Δ| ${(out[reg.id] as { worstAbsDelta: number }).worstAbsDelta}`);
    }
    report.publishedCrossCheck = {
      note: "Reference §3.8's own published window-A and window-B returns (chosen parameters, Revolut X costs) against this harness's, under each stop rule. §3.8 rounds to one decimal place in the document, so a delta up to 0.0005 is the rounding and nothing else. Under `trail` this is the proof the harness reproduces the study it extends; under `shipped` the same deltas are the size of the stop change measured against the published record. Rows with `here: null` are windows this study does not score because its in-sample floor rejects them, and the reason is given.",
      perStopRule: out,
    };
  }

  // ── the splice changes nothing about windows A and B ────────────────────
  // (Run under both rules, because the claim has to hold for whichever one the
  // reader is looking at.)
  {
    const out: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      let checks = 0, worstRet = 0, worstDD = 0, worstTrades = 0;
      const moved: { symbol: string; window: string; venue: string; dRet: number }[] = [];
      for (const symbol of symbols) {
        const { c4h, daily, cb4h, cbDaily, wins } = series[symbol];
        const nCb = cb4h.length, t1 = Math.floor(nCb / 3), t2 = Math.floor(nCb * 2 / 3);
        const cbWins: Record<string, number[]> = { A: [t2, nCb], B: [t1, t2] };
        for (const name of ["A", "B"]) {
          const w = wins.find((x) => x.name === name)!;
          if (!w.scored) continue;
          for (const v of VENUES) {
            const a = run("trend-4h", symbol, cb4h, cbDaily, cbWins[name][0], cbWins[name][1], DEFAULT_TREND, COSTS[v], 4, reg.stops(DEFAULT_TREND));
            const b = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS[v], 4, reg.stops(DEFAULT_TREND));
            checks++;
            worstRet = Math.max(worstRet, Math.abs(a.ret - b.ret));
            worstDD = Math.max(worstDD, Math.abs(a.maxDD - b.maxDD));
            worstTrades = Math.max(worstTrades, Math.abs(a.trades - b.trades));
            if (Math.abs(a.ret - b.ret) > 1e-9) moved.push({ symbol, window: name, venue: v, dRet: Number((b.ret - a.ret).toFixed(6)) });
          }
        }
      }
      out[reg.id] = { checks, worstAbsRetDiff: Number(worstRet.toFixed(8)), worstAbsMaxDDDiff: Number(worstDD.toFixed(8)), worstAbsTradeDiff: worstTrades, cellsThatMoved: moved };
      console.log(`[${reg.id}] fidelity splice: ${checks} cells, worst |Δret| ${worstRet.toExponential(2)}, |Δtrades| ${worstTrades}`);
    }
    report.spliceFidelity = {
      note: "The seeded rule on windows A and B, priced on the COINBASE-ONLY series at the boundaries every published table used, against the same window on the SPLICED series at the boundaries this study uses. A difference here would mean the extension moved the two windows it is supposed to leave alone.",
      perStopRule: out,
    };
  }

  // ── the windows the in-sample floor rejects, priced anyway, counted nowhere ──
  {
    const out: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const st = reg.stops;
      const probes: Record<string, unknown>[] = [];
      for (const symbol of symbols) {
        const { c4h, daily, cb4h, cbDaily, wins } = series[symbol];
        for (const w of wins.filter((x) => !x.scored && x.why.includes("under the") && x.isDays >= 60)) {
          const onCb = w.isSeries === "coinbase";
          let bestIdx = 0, bestScore = -Infinity;
          for (let i = 0; i < TREND_GRID.length; i++) {
            const p = TREND_GRID[i];
            const r = onCb
              ? run("trend-4h", symbol, cb4h, cbDaily, w.isFrom, w.isTo, p, COSTS.revx, 4, st(p))
              : run("trend-4h", symbol, c4h, daily, w.isFrom, w.isTo, p, COSTS.revx, 4, st(p));
            const sc = score(r);
            if (sc > bestScore) { bestScore = sc; bestIdx = i; }
          }
          const oosAll = TREND_GRID.map((p) => run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, p, COSTS.revx, 4, st(p)));
          const plateau = plateauOf(oosAll.map((r) => r.ret), oosAll[bestIdx].ret);
          const kr = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, TREND_GRID[bestIdx], COSTS.kraken, 4, st(TREND_GRID[bestIdx]));
          const tests = barTests(oosAll[bestIdx], kr, plateau);
          const seededTests = barTests(oosAll[SEEDED_IDX], run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.kraken, 4, st(DEFAULT_TREND)), plateau);
          probes.push({
            symbol, window: w.name, inSampleDays: w.isDays, why: w.why,
            chosen: { fast: TREND_GRID[bestIdx].fast, slow: TREND_GRID[bestIdx].slow, atrStop: TREND_GRID[bestIdx].atrStop },
            chosenRevx: pick(oosAll[bestIdx]), chosenKraken: pick(kr), seededRevx: pick(oosAll[SEEDED_IDX]),
            plateau: plateau.positiveShare, wouldPassChosen: tests.pass, wouldFailChosen: tests.failed,
            wouldPassSeeded: seededTests.pass, wouldFailSeeded: seededTests.failed,
          });
        }
      }
      out[reg.id] = probes;
      console.log(`[${reg.id}] short-in-sample probe: ${probes.length} windows`);
    }
    report.shortInSampleProbe = {
      note: `Windows rejected ONLY because their in-sample is under the ${MIN_IN_SAMPLE_DAYS}-day floor this study declared before it ran, priced anyway so the gap is visible. These numbers are in NO count, NO null and NO correlation: a parameter chosen on four months of one coin is a coin-flip with a decimal point. They are here because the most important of them is SUI's — the coin that cleared both existing windows and whose third window does not exist, because the asset did not.`,
      perStopRule: out,
    };
  }

  // ── what each window's year actually did, so a regime is a number ───────
  {
    const majors = ["BTC/USD", "ETH/USD", "SOL/USD"].filter((s) => series[s]);
    const per: Record<string, unknown> = {};
    for (const wname of ["A", "B", "C", "D"]) {
      const moves: Record<string, number> = {};
      for (const s of majors) {
        const w = series[s].wins.find((x) => x.name === wname);
        if (!w || !w.scored) continue;
        const c = series[s].c4h;
        moves[s] = Number((c[w.oosTo - 1].close / c[w.oosFrom].open - 1).toFixed(4));
      }
      const vals = Object.values(moves);
      const ref = majors.map((s) => series[s].wins.find((x) => x.name === wname)).find((w) => w?.scored);
      per[wname] = {
        from: ref?.oosFromIso ?? "", to: ref?.oosToIso ?? "", buyHoldRaw: moves,
        equalWeight: vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4)) : null,
      };
    }
    report.regimes = {
      note: "Each window's out-of-sample span and what simply holding BTC, ETH and SOL did over it, close over open, no costs — so 'bear year' and 'bull year' are measurements rather than adjectives. Read the spans per coin in `perStopRule[…].perCoin[…].windows`: a coin with a shorter history has its thirds elsewhere on the calendar.",
      perWindow: per,
    };
    for (const wname of ["A", "B", "C", "D"]) console.log(`regime ${wname}: buy-and-hold ${JSON.stringify((per[wname] as { equalWeight: number | null }).equalWeight)}`);
  }

  report.perStopRule = derived;

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error(`backtest.ts changed during the run (${btHashStart.slice(0, 12)} → ${btHashEnd.slice(0, 12)}); re-run it`);
  report.sourceIntegrity = {
    backtestTsSha256: btHashStart, stableAcrossRun: true,
    note: "SHA-256 of `supabase/functions/agents/backtest.ts`, read at the start of the run and again at the end. This study imports its `run`, `COSTS`, `spreadOf` and `stopsForKind`, so that file is an input: the hash says which version produced these numbers, and a run that straddled an edit would have thrown rather than written this file.",
  };

  const path = `${outDir}/windows.json`;
  await Deno.writeTextFile(path, JSON.stringify(report, null, 1));
  console.log(`wrote ${path} in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
}
