// The TESTING-SET study: what should still exist after the paper rows are
// judged on FOUR windows — and whether anything at all fixes the sideways
// year the live candidate loses in. A study, not a rulebook. Run by hand:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_testingset.ts \
//     --data <dir with BTC-USD_1h_3y.json …> \
//     --ext  <dir with BTC-USD_1h_kraken.json …> \
//     --out  docs/agents/backtests
//
// Writes `<out>/testingset.json` and NOTHING else; `latest.json`,
// `summary.json`, `windows.json` and every other study's file are untouched.
//
// ── the four questions ────────────────────────────────────────────────
//
// S1. §3.15 priced the live candidate on a fourth window — a SIDEWAYS year,
//     −5.8 % on the majors — and it is the only one of the four this rule
//     loses in (−7.8 %) and the one carrying its largest drawdown (15.5 %).
//     That is what a trend rule does when direction stops: it is whipsawed
//     in and out. So this study attacks that one window with entry gates
//     that could plausibly DETECT a directionless market and stand down —
//     an efficiency ratio over the rule's own lookback, a volatility band
//     against the coin's own recent history, a breakout that must clear the
//     prior high by a multiple of ATR rather than by a tick, a minimum
//     slope on the fast average, a longer confirmation, and §3.9's
//     BTC-regime gate at sleeve level. The test is whether window D
//     improves WITHOUT giving back A, B and C, under BOTH stop rules. Every
//     arm is counted and the chance control is stated exactly, because this
//     is a search and most of what a search finds on one window is that
//     window.
//
// S2. §3.14 gave each of the seven paper rows a verdict on TWO windows.
//     Two windows are two single draws (§3.15). Every row is re-priced here
//     on A, B, C and D, under both stop rules, at its own capital and slot
//     size, with its fills-per-90-days (a row kept for a MEASUREMENT job is
//     kept for that rate, not for a return), its median hold against its
//     venue's round-trip cost, and the full row × row correlation matrix (a
//     row whose P&L is another row's P&L is not a second measurement of
//     anything).
//
// S3. What is worth ADDING — each candidate with four windows, its plateau,
//     its chance control, and what paper would measure that a backtest
//     cannot. "Nothing" is a legitimate answer and the evidence is allowed
//     to give it.
//
// S4. The sets, priced: the shipped seven and every subset a verdict could
//     produce, against the caps in `agent_risk` (`max_order_usd` 20, live
//     exposure 100, paper exposure 300).
//
// ── what is imported and what is copied ───────────────────────────────
//
// `backtest.ts`'s `run`, `runRotation`, `resample`, `COSTS`,
// `SHIPPED_STOPS`, `stopsForKind` and `spreadOf`, and the live rulebooks in
// `_shared/agents_strategy.ts`, are IMPORTED. Nothing that costs money is
// re-implemented.
//
// ONE copy exists, `runGate`: `backtest_windows.ts`'s `runGated` with
// `backtest_kraken2.ts`'s trade log folded in — itself `run` line by line,
// with three things `run` cannot express:
//   * an ENTRY GATE, which is what S1 is about and what a cross-asset
//     filter (§3.9's BTC regime) needs;
//   * a mark at EVERY bar plus the traded weight and an open flag, which
//     the sleeve arithmetic reads (`run` samples its curve every sixth bar,
//     and which bar that is moves when the history is extended);
//   * a per-round-trip log, for the median hold a fee argument needs.
// With the gate null it IS `run`, and `fidelity.runGate` is the proof —
// every coin × every window × both venues × both stop rules. A second
// check, `fidelity.trivialGate`, runs the same thing through a gate that
// never refuses, so the gate PATH is checked and not only the branch around
// it. A third, `publishedSleeve`, reproduces `windows.json`'s own live
// sleeve on all four windows: this harness's arithmetic against the study
// it extends, reached by a different route.
//
// The window machinery is `backtest_windows.ts`'s, reused rather than
// re-invented: the same splice of Kraken's quarterly OHLCVT history before
// each coin's Coinbase series, the same overlap thresholds written down
// before the comparison, the same four windows (A last third, B middle
// third, C first third, D the year before the series), the same
// `MIN_IN_SAMPLE_DAYS` floor and the same exact hypergeometric null. Those
// functions are not exported from that file, so they are copied verbatim
// and named here; each of them does arithmetic on OUTPUTS or on calendars
// and none of them touches a fee, a fill or a stop.
//
// ── the rules of the study ────────────────────────────────────────────
//
// Four windows, never averaged; an arm is ranked by the WORST window it
// has. Parameters are chosen on data strictly BEFORE the window they are
// scored on. Every search reports how many arms it looked at and what a
// null with the same per-test pass rates expects, computed exactly rather
// than sampled. Both stop rules are priced and never averaged.
//
// ── determinism ───────────────────────────────────────────────────────
//
// There is no `ran_at` field and no wall-clock value anywhere in the
// output. Re-running over the same two data directories writes
// `testingset.json` byte for byte identical. `backtest.ts` is SHA-256'd at
// the start of the run and again at the end and its hash is written into
// the output, so a run that straddles an edit throws instead of writing
// half a result.

import {
  applyFill, atrAt, buildSnapshot, DEFAULT_ROTATION, DEFAULT_TREND, FLAT, precompute, priorRange, realisedVol, ruleFor, sma,
  type Action, type Candle, type Position, type RotationParams, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import {
  COSTS, resample, run, runRotation, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]

// ───────────────────────────────────────────────────────── facts, not guesses

/** Revolut X UK-book 24 h quote volume, reference §3.8 (medians of 21 samples a minute apart, 2026-09-21). */
const UK_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 3_600_000, "ETH/USD": 3_200_000, "SOL/USD": 3_300_000, "XRP/USD": 2_600_000,
  "AVAX/USD": 1_900_000, "SUI/USD": 942_000,
};
/** Kraken 24 h quote volume, reference §3.12 (`kraken.json` → `krakenBook`). */
const KRAKEN_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 415_926_026, "ETH/USD": 211_257_776, "SOL/USD": 89_808_255, "XRP/USD": 115_479_491,
  "AVAX/USD": 19_643_858, "SUI/USD": 36_150_670,
};
const MIN_BOOK_USD = 100_000;

/** `agent_risk` (migration 0037): the caps the final set has to fit. */
const RISK_CAPS = { maxOrderUsd: 20, maxExposureUsdLive: 100, paperExposureUsd: 300, dailyLossLimitUsd: 5, maxOrdersPerDay: 40 };

/** The live recommendation, §3.11 question 6 and `docs/agents/go-live.md`. */
const LIVE_CANDIDATE = { row: "trend-4h", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100, slots: 5 };

/**
 * `windows.json`'s own live-sleeve figures under the SHIPPED stop rule,
 * typed in from that file, so this harness proves it reproduces the study
 * it extends instead of asserting it. [return, maxDD, ret/DD].
 */
const PUBLISHED_WINDOWS_SLEEVE: Record<string, [number, number, number]> = {
  A: [0.0803, 0.1128, 0.71], B: [0.2008, 0.1047, 1.92], C: [0.5564, 0.0735, 7.57], D: [-0.0781, 0.1552, -0.50],
};

/**
 * §3.11's published per-row figures as `backtest_kraken2.ts` types them —
 * [A return, A drawdown, B return, B drawdown] — computed under the TRAIL
 * stop rule, which is what that study ran. A harness that cannot reproduce
 * the table it is arguing with has not earned its own numbers.
 */
const PUBLISHED_3_11: Record<string, [number, number, number, number]> = {
  "trend-4h·revx": [-0.003, 0.118, 0.126, 0.102],
  "trend-1h·revx": [0.005, 0.204, 0.040, 0.173],
  "momentum-1d·revx": [-0.081, 0.410, 0.624, 0.171],
  "momentum-1d·kraken": [-0.201, 0.513, 0.536, 0.194],
  "trend-4h·kraken": [-0.004, 0.143, 0.048, 0.117],
  "rotation-1d·revx": [-0.133, 0.370, 1.285, 0.225],
  "rotation-1w·kraken": [-0.098, 0.415, 0.770, 0.268],
};

/** §3.14's two-window verdicts, typed in so this study's four-window answer can be read against them. */
const VERDICTS_3_14: Record<string, string> = {
  "trend-4h·revx": "not judged in §3.14's K2 table — it is the row the others were measured against",
  "trend-1h·revx": "delete",
  "momentum-1d·revx": "keep, do not optimise",
  "momentum-1d·kraken": "delete",
  "trend-4h·kraken": "keep, stop reading its return",
  "rotation-1d·revx": "delete",
  "rotation-1w·kraken": "delete",
};

/** §3.11's measured median holds, the numbers a fee argument is read against. */
const SHIPPED_MEDIAN_HOLD_DAYS: Record<string, number> = { "trend-4h": 2.29, "momentum-1d": 3.42, "trend-1h": 0.60 };

/** The overlap test, §3.15's, written down there before the two sources were compared. */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
/** A window is only scored when its in-sample has at least this many days to choose on (§3.15's floor). */
const MIN_IN_SAMPLE_DAYS = 180;

/**
 * The stops as §3.7 / §3.8 / §3.10 / §3.11 computed them — the 8 % floor
 * plus the 3×ATR(14) INTRA-BAR trail removed on 2026-09-21 (§3.13). Pinned
 * here, not read from `backtest.ts`, because it is no longer any default:
 * every figure in this file is reported twice, under `shipped` (what
 * `tick.ts` runs) and under `trail`, and never averaged. Nothing here
 * re-implements a stop: these are four numbers handed to `run`, which
 * applies them. The trail belonged to the TREND rulebooks only — §3.3a:
 * "momentum and the rotation basket are unchanged, because neither ever
 * carried a trail" — so under `trail` those two rows keep the floor alone
 * and are identical under both rules, which is said here rather than left
 * to be noticed.
 */
const PINNED_TRAIL_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };

const YEAR_MS = 365 * 86400e3;
const WNAMES = ["A", "B", "C", "D"] as const;
type WName = typeof WNAMES[number];

// ───────────────────────────────────────────────────────────── the simulator

/** A decision at bar `i` with the position as it stands. Monotonic in `i`, so a decider may keep a cursor. */
type Decide = (i: number, pos: Position) => Action;

/** One round trip as the fills happened. `gross` is the raw price move before any spread or fee. */
type Trade = { entryBar: number; exitBar: number; holdBars: number; gross: number; net: number; stop: boolean };

type GateResult = RunResult & {
  /** Σ over fills of the notional traded in units of the slot (an entry and an exit each count once). */
  tradedWeight: number;
  /** The mark at EVERY bar, so a day's mark does not depend on where the array starts. */
  marks: [number, number][];
  /** [bar start, 1 when a position was held over that bar] — what an exposure cap sees. */
  openFlags: [number, number][];
  tradeLog: Trade[];
  /** Entries the gate refused (the rulebook said enter, the gate said no). */
  gateBlocked: number;
};

/**
 * `backtest.ts`'s `run`, with the rulebook replaced by a callback, an
 * optional ENTRY GATE, a mark at every bar and a per-round-trip log.
 * Everything that costs money is COPIED FROM `run` LINE BY LINE: the entry
 * and rule exit at the next bar's open ± the half-spread paying `fillFee`;
 * the floor under average cost and the ATR trail from the high since entry,
 * read against the next bar's low and filled at the level (or the open when
 * the bar gaps through it); the high-water mark advanced by each bar's
 * high; the cooldown after ANY exit; and the same return, drawdown, trade
 * count, exposure and day arithmetic.
 */
function runGate(
  symbol: string, bars: Candle[], from: number, to: number, warmup: number,
  decide: Decide, costs: Costs, stops: StopParams | null, gate: ((i: number) => boolean) | null,
): GateResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  let tradedWeight = 0, gateBlocked = 0;
  let entryBar = -1, entryRaw = 0, entryNet = 0;       // bookkeeping only — no price, fee or level reads it
  const marks: [number, number][] = [], openFlags: [number, number][] = [], tradeLog: Trade[] = [];
  const start = Math.max(from, warmup);
  for (let i = start; i < to - 1; i++) {
    const raw = decide(i, pos);
    const blocked = raw === "enter" && gate != null && !gate(i);
    if (blocked) gateBlocked++;
    const action: Action = blocked ? "hold" : raw;
    const next = bars[i + 1];
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);                    // the touch, at the next open
      const base = cash / (price * (1 + fill));              // the fee comes out of the same cash
      const fee = base * price * fill;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++; tradedWeight += 1;
      entryBar = i + 1; entryRaw = next.open; entryNet = price * (1 + fill);
    } else if (action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fill;
      cash = pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; tradedWeight += 1; lastExitBar = i + 1;
      tradeLog.push({ entryBar, exitBar: i + 1, holdBars: i + 1 - entryBar, gross: next.open / entryRaw - 1, net: price * (1 - fill) / entryNet - 1, stop: false });
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
        tradeLog.push({ entryBar, exitBar: i + 1, holdBars: i + 1 - entryBar, gross: Math.min(level, next.open) / entryRaw - 1, net: price * (1 - stopFee) / entryNet - 1, stop: true });
      }
    }
    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }; }
    const eq = cash + pos.base * next.close;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    marks.push([next.start, eq]);
    openFlags.push([next.start, pos.base > 0 ? 1 : 0]);
  }
  const eqEnd = cash + pos.base * bars[to - 1].close;
  const days = (bars[to - 1].start - bars[start].start) / 86400e3;
  return {
    ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity: marks,
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit, tradedWeight, marks, openFlags, tradeLog, gateBlocked,
  };
}

/**
 * The SHIPPED decision at each bar as a callback: `buildSnapshot` +
 * `ruleFor`, the pair `run` itself calls, with `lookbackDays` exposed.
 * Copied from `backtest_kraken2.ts`, which does not export it. The one
 * difference from `run` is bookkeeping: the daily closes are pushed onto a
 * growing array instead of `daily.slice(0, dk)` per bar (same contents, no
 * copy).
 */
function shippedDecider(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, barHours: number, lookbackDays = 30,
): Decide {
  const pre = precompute(bars, p);
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos) => {
    const nowMs = bars[i].start + barHours * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    const snap = buildSnapshot(symbol, bars, i, closed, pos, nowMs, p, pre, (24 / barHours) * 365, lookbackDays);
    return ruleFor(kind, snap, pos, p).action;
  };
}

// ───────────────────────────────────────────────── S1: the entry gates

/** Everything a gate may look at. `onCb` says which series it is being built on, so a cross-asset gate reads the matching one. */
type GateCtx = { symbol: string; bars: Candle[]; daily: Candle[]; p: TrendParams; barHours: number; onCb: boolean };

/**
 * A gate answers ONE question at bar `i`, from candles at or before `i`:
 * may an entry happen now? It never forces an entry and never causes an
 * exit — a filter that also sold would be a different rule, and the point
 * of S1 is to leave the rulebook alone and ask whether standing down in a
 * directionless market is worth anything.
 */
type GateSpec = { id: string; family: string; label: string; make: (ctx: GateCtx) => (i: number) => boolean };

/** BTC's daily closes and their SMAs, shared by every coin's regime-gated run (§3.9 idea 1). */
type BtcRegime = { daily: Candle[]; sma: Record<number, (number | null)[]> };

/** §3.9's idea 1 as a GATE on entries only. Copied from `backtest_windows.ts` / `backtest_portfolio.ts`. */
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

/**
 * Kaufman's efficiency ratio over `n` bars: the net move divided by the
 * path length. 1.0 is a straight line; 0 is a market that ended where it
 * started having travelled to get there. The most direct measure of
 * "directionless" there is, computed from the closes the rule already reads.
 */
function efficiencyRatioSeries(closes: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let path = 0;
  for (let i = 1; i < closes.length; i++) {
    path += Math.abs(closes[i] - closes[i - 1]);
    if (i > n) path -= Math.abs(closes[i - n] - closes[i - n - 1]);
    if (i >= n) out[i] = path > 0 ? Math.abs(closes[i] - closes[i - n]) / path : 0;
  }
  return out;
}

/** The share of the last `hist` values (ending at `i`) that are ≤ the value at `i`; null until `hist` values exist. */
function trailingPercentile(series: (number | null)[], i: number, hist: number): number | null {
  const v = series[i];
  if (v == null || i < hist) return null;
  let below = 0, seen = 0;
  for (let k = i - hist + 1; k <= i; k++) { const x = series[k]; if (x == null) continue; seen++; if (x <= v) below++; }
  return seen >= Math.floor(hist / 2) ? below / seen : null;
}

/** 90 days of 4-hour bars: the coin's own recent history, not a constant from somewhere else. */
const VOL_HIST_BARS = 540;

function buildGates(btcCombined: BtcRegime, btcCoinbase: BtcRegime): GateSpec[] {
  const gates: GateSpec[] = [];

  // ── family 1: the efficiency ratio over the rule's own lookback ──────
  for (const n of [55, 100]) {
    for (const t of [0.15, 0.25, 0.35]) {
      gates.push({
        id: `er-${n}-${t}`, family: "efficiency-ratio",
        label: `entry only when the ${n}-bar efficiency ratio (net move ÷ path length) is ≥ ${t}`,
        make: ({ bars }) => {
          const er = efficiencyRatioSeries(bars.map((c) => c.close), n);
          return (i) => { const v = er[i]; return v == null ? true : v >= t; };
        },
      });
    }
  }

  // ── family 2: the breakout must clear the prior high by k × ATR ──────
  for (const k of [0.25, 0.5, 0.75, 1.0, 1.5, 2.0]) {
    gates.push({
      id: `atrmargin-${k}`, family: "atr-breakout-margin",
      label: `entry only when the close clears the prior ${DEFAULT_TREND.breakoutUp}-bar high by ≥ ${k} × ATR(${DEFAULT_TREND.atrN}), not by a tick`,
      make: ({ bars, p }) => (i) => {
        const range = priorRange(bars, i, p.breakoutUp);
        const atr = atrAt(bars, i, p.atrN);
        if (!range || atr == null) return true;
        return bars[i].close >= range.high + k * atr;
      },
    });
  }

  // ── family 3: a minimum slope on the fast average ────────────────────
  for (const [n, s] of [[30, 0.0], [30, 0.01], [30, 0.02], [30, 0.04], [60, 0.02], [60, 0.05]] as [number, number][]) {
    gates.push({
      id: `slope-${n}-${s}`, family: "trend-slope",
      label: `entry only when the fast (${DEFAULT_TREND.fast}-bar) average has risen by ≥ ${(s * 100).toFixed(0)} % over the last ${n} bars`,
      make: ({ bars, p }) => {
        const fast = sma(bars.map((c) => c.close), p.fast);
        return (i) => {
          const a = fast[i], b = i >= n ? fast[i - n] : null;
          if (a == null || b == null || !(b > 0)) return true;
          return (a - b) / b >= s;
        };
      },
    });
  }

  // ── family 4: a volatility band against the coin's OWN recent history ─
  // (0, 1) is the inert point: the gate path with a condition that is
  // always true, which `fidelity.trivialGate` reads as such.
  for (const [lo, hi] of [[0, 1], [0.3, 1], [0.5, 1], [0, 0.8], [0.3, 0.8], [0, 0.6]] as [number, number][]) {
    gates.push({
      id: `volband-${lo}-${hi}`, family: "volatility-band",
      label: `entry only when realised volatility (${DEFAULT_TREND.volN} bars) sits between the ${(lo * 100).toFixed(0)}th and ${(hi * 100).toFixed(0)}th percentile of its own last ${VOL_HIST_BARS} bars`,
      make: ({ bars, p, barHours }) => {
        const closes = bars.map((c) => c.close);
        const vol: (number | null)[] = closes.map((_, i) => realisedVol(closes, i, p.volN, (24 / barHours) * 365));
        return (i) => {
          const pct = trailingPercentile(vol, i, VOL_HIST_BARS);
          if (pct == null) return true;
          return pct >= lo && pct <= hi;
        };
      },
    });
  }

  // ── family 5: a longer confirmation ──────────────────────────────────
  for (const k of [2, 3, 4, 5, 6, 8]) {
    gates.push({
      id: `confirm-${k}`, family: "confirmation-bars",
      label: `entry only when the close has been above its own prior ${DEFAULT_TREND.breakoutUp}-bar high on each of the last ${k} bars`,
      make: ({ bars, p }) => (i) => {
        for (let j = i - k + 1; j <= i; j++) {
          if (j < 0) return true;
          const r = priorRange(bars, j, p.breakoutUp);
          if (!r) return true;
          if (!(bars[j].close > r.high)) return false;
        }
        return true;
      },
    });
  }

  // ── family 6: §3.9's cross-asset BTC regime gate, at sleeve level ─────
  for (const n of [100, 150, 200]) {
    gates.push({
      id: `btcregime-${n}`, family: "btc-regime",
      label: `entry only when BTC's last daily close is above its own ${n}-day average (§3.9 idea 1, applied to the whole row)`,
      make: ({ bars, barHours, onCb }) => regimeGate(bars, onCb ? btcCoinbase : btcCombined, n, barHours),
    });
  }

  return gates;
}

// ─────────────────────────────────────────────── arithmetic on outputs

/** The last mark of each UTC day. Copied from `backtest_portfolio.ts` via `backtest_windows.ts`. */
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
/** A day's flag per sleeve: 1 when it held a position at any point that day. */
function dailyOpen(flags: [number, number][]): Map<number, number> {
  const m = new Map<number, number>();
  for (const [t, f] of flags) {
    const d = Math.floor(t / 86400e3) * 86400e3;
    m.set(d, Math.max(m.get(d) ?? 0, f));
  }
  return m;
}

type Sleeve = { id: string; slotUsd: number; exposure: number; rets: Map<number, number>; open: Map<number, number>; tradedPerSlot: number; fills: number };
type SetStats = {
  members: number; capitalUsd: number; pnlUsd: number; ret: number; maxDD: number; retOverDD: number;
  days: number; from: string; to: string; deployment: number; turnoverPerYear: number;
  bestDayUsd: number; worstDayUsd: number; peakOpenUsd: number; fills: number; fillsPer90Days: number;
};
/** Combine sleeves at their slot sizes (`backtest_allocation.ts`'s `combine` with the fill count added — `backtest_kraken2.ts`'s copy). */
function combine(sleeves: Sleeve[]): SetStats {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  if (!days.length) {
    return { members: 0, capitalUsd: 0, pnlUsd: 0, ret: 0, maxDD: 0, retOverDD: 0, days: 0, from: "", to: "", deployment: 0, turnoverPerYear: 0, bestDayUsd: 0, worstDayUsd: 0, peakOpenUsd: 0, fills: 0, fillsPer90Days: 0 };
  }
  let eq = capital, peak = capital, maxDD = 0, best = -Infinity, worst = Infinity;
  const opens: number[] = [];
  for (const d of days) {
    let pnl = 0, open = 0;
    for (const s of sleeves) { pnl += s.slotUsd * (s.rets.get(d) ?? 0); open += s.slotUsd * (s.open.get(d) ?? 0); }
    opens.push(open);
    eq += pnl;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    best = Math.max(best, pnl); worst = Math.min(worst, pnl);
  }
  const spanDays = Math.max(1, (days[days.length - 1] - days[0]) / 86400e3);
  const tradedUsd = sleeves.reduce((a, s) => a + s.tradedPerSlot * s.slotUsd, 0);
  const fills = sleeves.reduce((a, s) => a + s.fills, 0);
  const ret = (eq - capital) / Math.max(1e-9, capital);
  return {
    members: sleeves.length, capitalUsd: r2(capital), pnlUsd: r2(eq - capital), ret: r4(ret), maxDD: r4(maxDD),
    retOverDD: r2(ret / Math.max(0.05, maxDD)), days: days.length,
    from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days[days.length - 1]).toISOString().slice(0, 10),
    deployment: Number((capital > 0 ? sleeves.reduce((a, s) => a + s.slotUsd * s.exposure, 0) / capital : 0).toFixed(3)),
    turnoverPerYear: r2(tradedUsd / Math.max(1e-9, capital) / (spanDays / 365)),
    bestDayUsd: r2(best), worstDayUsd: r2(worst), peakOpenUsd: r2(Math.max(...opens)),
    fills, fillsPer90Days: r2(fills / spanDays * 90),
  };
}

/** Pearson correlation over the days both series have. Copied from `backtest_kraken2.ts`'s `corrOf`. */
function corrOf(a: Map<number, number>, b: Map<number, number>): number {
  const days = [...a.keys()].filter((d) => b.has(d)).sort((x, y) => x - y);
  if (days.length < 3) return NaN;
  const xs = days.map((d) => a.get(d)!), ys = days.map((d) => b.get(d)!);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : NaN; }
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
function score(r: { ret: number; maxDD: number }): number { return r.ret / Math.max(0.05, r.maxDD); }
function r4(x: number): number { return Number.isFinite(x) ? Number(x.toFixed(4)) : 0; }
function r2(x: number): number { return Number.isFinite(x) ? Number(x.toFixed(2)) : 0; }
function pick(r: RunResult) {
  return {
    ret: r4(r.ret), maxDD: r4(r.maxDD), retOverDD: r2(score(r)),
    trades: r.trades, days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)), stopsHit: r.stopsHit ?? 0,
  };
}

type Plateau = { gridPoints: number; positiveShare: number; median: number; chosenRank: number };
/**
 * The plateau, as every table in this reference reports it: the share of a
 * grid positive out of sample, the grid's median, and where the point being
 * judged ranks in it. Sensitivity is a spike, robustness is a plateau, and
 * both are measurable (§4.15). Copied from `backtest_kraken2.ts`.
 */
function plateauOf(rets: number[], chosen: number): Plateau {
  const s = rets.slice().sort((a, b) => a - b);
  return {
    gridPoints: s.length,
    positiveShare: Number((s.filter((r) => r > 0).length / Math.max(1, s.length)).toFixed(3)),
    median: r4(s[Math.floor(s.length / 2)]),
    chosenRank: s.filter((r) => r > chosen).length + 1,
  };
}

/** A venue's round-trip cost in bps for one symbol: two fills at `fillFee` plus two half-spreads. Copied from `backtest_kraken2.ts`. */
function roundTripBps(costs: Costs, symbol: string): number {
  const feeBps = costs.fillFee === "taker" ? costs.takerBps : costs.makerBps;
  return 2 * feeBps + 2 * spreadOf(costs, symbol) * 1e4;
}
/** The constant annual drift at which a median hold pays for one round trip. Copied from `backtest_kraken2.ts`. */
function breakEvenDriftPerYear(rtBps: number, holdDays: number): number {
  return holdDays > 0 ? (rtBps / 1e4) * 365 / holdDays : NaN;
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
/**
 * The exact distribution of how many of `n` arms pass ALL of the tests whose
 * pass counts are `ks`, when each test's passers are an independent uniform
 * subset of that size. No sampling. Copied from `backtest_windows.ts`.
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

/** The whole chance control for one search, in one object. */
function chanceControl(n: number, ks: number[], observed: number, note: string) {
  if (n === 0) return { arms: 0, passesPerTest: ks, observedAll: observed, expectedUnderNull: 0, probabilityAtLeastObserved: 1, nullHistogram: [] as number[], note };
  const dist = intersectionDistribution(n, ks);
  const p = ks.map((k) => k / n);
  return {
    arms: n, passesPerTest: ks, observedAll: observed,
    expectedUnderNull: Number((n * p.reduce((a, b) => a * b, 1)).toFixed(3)),
    probabilityAtLeastObserved: Number(dist.slice(Math.min(observed, n)).reduce((a, b) => a + b, 0).toFixed(4)),
    nullHistogram: dist.slice(0, 8).map((x) => Number(x.toFixed(4))),
    note,
  };
}

// ──────────────────────────────────────────────────────── the data and splice

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const toCandles = (raw: Raw[]): Candle[] => raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));

/** The bar at or after `ts`, or the array length when there is none. Copied from `backtest_windows.ts`. */
function indexAtOrAfter(bars: Candle[], ts: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].start < ts) lo = mid + 1; else hi = mid; }
  return lo;
}

type Win = {
  name: WName; isSeries: "coinbase" | "combined";
  isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  isDays: number; oosDays: number; isFromIso: string; oosFromIso: string; oosToIso: string;
  scored: boolean; why: string;
};

/**
 * The four windows on the COMBINED series — `backtest_windows.ts`'s
 * `windowsOn`, copied verbatim. A and B keep the exact calendar boundaries
 * every published table used (the coin's own Coinbase series cut in
 * thirds); C and D are the two the Kraken extension makes possible, each
 * with its parameters chosen on the 24 months immediately before the year
 * it scores. Nothing is ever chosen on data that the window then scores.
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
  const mk = (name: WName, isSeries: Win["isSeries"], isFrom: number, isTo: number, oosFrom: number, oosTo: number): Win => {
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

  // `backtest.ts` is an input to this study: hashed at the start and again at the end.
  const btPath = new URL("./backtest.ts", import.meta.url);
  const sha = async (u: URL) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(u));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btHashStart = await sha(btPath);

  // ── the coins: every symbol any of the seven rows runs ─────────────────
  const SYMBOLS = ["AVAX/USD", "BTC/USD", "ETH/USD", "SOL/USD", "SUI/USD", "XRP/USD"];
  const BASKET = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];
  const MAX_LOOKBACK = 201;   // the widest lookback any rule here reads, plus a margin

  type Series = { hourly: Candle[]; c4h: Candle[]; daily: Candle[]; cb4h: Candle[]; cbDaily: Candle[]; wins: Win[] };
  const series: Record<string, Series> = {};
  const provenance: Record<string, unknown>[] = [];

  for (const symbol of SYMBOLS) {
    const base = symbol.replace("/", "-");
    const cbRaw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${base}_1h_3y.json`));
    const kRaw: Raw[] = JSON.parse(await Deno.readTextFile(`${extDir}/${base}_1h_kraken.json`));
    const cbH = toCandles(cbRaw), kH = toCandles(kRaw);
    const spliceAt = cbH[0].start;

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
        hourlyBars: hourlyDiffs.length, hourlyMedianBps: Number(median(hourlyDiffs).toFixed(2)), hourlyP95Bps: Number(quantile(hourlyDiffs, 0.95).toFixed(2)),
        bars4h: diffs4h.length, median4hBps: Number(median(diffs4h).toFixed(2)), p954hBps: Number(quantile(diffs4h, 0.95).toFixed(2)), max4hBps: Number(Math.max(...diffs4h).toFixed(2)),
      }
      : null;
    const rejected: string[] = [];
    if (!overlap) rejected.push(`overlap is ${diffs4h.length} 4h bars — too few to verify`);
    else {
      if (overlap.median4hBps > OVERLAP_MEDIAN_MAX_BPS) rejected.push(`overlap median ${overlap.median4hBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`);
      if (overlap.p954hBps > OVERLAP_P95_MAX_BPS) rejected.push(`overlap p95 ${overlap.p954hBps} bps > ${OVERLAP_P95_MAX_BPS}`);
    }
    if (rejected.length) throw new Error(`${symbol} fails §3.15's splice check: ${rejected.join("; ")} — every row in this study needs it`);

    const extension = kH.filter((c) => c.start < spliceAt);
    const combH = [...extension, ...cbH];
    const comb4h = resample(combH, 4), combDaily = resample(combH, 24);
    const wins = windowsOn(comb4h, cb4hAll, MAX_LOOKBACK);
    series[symbol] = { hourly: combH, c4h: comb4h, daily: combDaily, cb4h: cb4hAll, cbDaily: resample(cbH, 24), wins };
    provenance.push({
      symbol,
      coinbase: { barsHourly: cbH.length, first: iso(cbH[0].start), last: iso(cbH[cbH.length - 1].start), bars4h: cb4hAll.length },
      krakenExtension: { barsHourly: extension.length, first: extension.length ? iso(extension[0].start) : "", last: extension.length ? iso(extension[extension.length - 1].start) : "", years: Number((extension.length ? (spliceAt - extension[0].start) / YEAR_MS : 0).toFixed(2)) },
      spliceAtIso: iso(spliceAt), overlap, accepted: true,
      combined: { barsHourly: combH.length, bars4h: comb4h.length, first: iso(combH[0].start), last: iso(combH[combH.length - 1].start) },
      windows: wins,
    });
    console.log(`${symbol.padEnd(9)} overlap ${overlap ? `median ${overlap.median4hBps} bps / p95 ${overlap.p954hBps}` : "none"} | extension ${extension.length} h | windows ${wins.filter((w) => w.scored).map((w) => w.name).join("") || "—"}`);
  }

  // The rotation basket: daily candles aligned across its four members, on
  // the combined series and on the Coinbase-only one, so the basket's own
  // windows are cut exactly as `backtest.ts` and §3.4 cut them.
  const basketCombined: Record<string, Candle[]> = {}, basketCoinbase: Record<string, Candle[]> = {};
  {
    const commonComb = BASKET.map((s) => new Set(series[s].daily.map((c) => c.start))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    const commonCb = BASKET.map((s) => new Set(series[s].cbDaily.map((c) => c.start))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    for (const s of BASKET) {
      basketCombined[s] = series[s].daily.filter((c) => commonComb.has(c.start));
      basketCoinbase[s] = series[s].cbDaily.filter((c) => commonCb.has(c.start));
    }
  }
  const basketWins = windowsOn(basketCombined[BASKET[0]], basketCoinbase[BASKET[0]], DEFAULT_ROTATION.slowDays + 1);
  console.log(`basket: ${basketCombined[BASKET[0]].length} aligned days combined, ${basketCoinbase[BASKET[0]].length} on Coinbase; windows ${basketWins.filter((w) => w.scored).map((w) => w.name).join("")}`);

  const btcCombined: BtcRegime = { daily: series["BTC/USD"].daily, sma: Object.fromEntries([100, 150, 200].map((n) => [n, sma(series["BTC/USD"].daily.map((c) => c.close), n)])) };
  const btcCoinbase: BtcRegime = { daily: series["BTC/USD"].cbDaily, sma: Object.fromEntries([100, 150, 200].map((n) => [n, sma(series["BTC/USD"].cbDaily.map((c) => c.close), n)])) };
  const GATES: GateSpec[] = buildGates(btcCombined, btcCoinbase);

  // ── the two stop rules everything is priced under ──────────────────────
  // The intra-bar trail belonged to the TREND rulebooks only (§3.3a), so
  // `stopsFor` gives momentum and rotation the floor alone under both rules.
  type Regime = { id: "shipped" | "trail"; label: string };
  const REGIMES: Regime[] = [
    { id: "shipped", label: "the stops backtest.ts ships and tick.ts runs — the 8 % floor alone, the intra-bar trail removed (§3.13)" },
    { id: "trail", label: "the 8 % floor and the 3×ATR(14) intra-bar trail on the TREND rulebooks — what §3.7 / §3.8 / §3.10 / §3.11 were computed under (momentum and rotation never carried it, §3.3a)" },
  ];
  const stopsFor = (reg: Regime, kind: StrategyKind, p: TrendParams): StopParams =>
    reg.id === "trail" && (kind === "trend-4h" || kind === "trend-1h")
      ? { ...PINNED_TRAIL_STOPS, atrStop: p.atrStop }
      : stopsForKind(kind, p);

  const report: Record<string, unknown> = {
    study: "the testing set — the seven paper rows judged on four walk-forward windows, an attack on the sideways year the live rule loses in, and the set that should exist afterwards",
    source: "Windows A and B are each coin's own Coinbase Exchange hourly candles cut in thirds exactly as §3.7 / §3.8 / §3.10 / §3.11 / §3.14 cut them. Windows C and D use Kraken's free quarterly OHLCVT history (Kraken_OHLCVT_Full_2026Q2, 60-minute series) spliced strictly BEFORE each coin's Coinbase series and verified against it bar for bar over everything the two share, as §3.15 did. Fills, fees, the protective exits and the cooldown are backtest.ts's own, priced under BOTH stop rules and never averaged: Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). The model is not in the backtest.",
    windows: {
      A: "parameters on the first two thirds, the LAST third out of sample — the bear year, majors −39.4 %",
      B: "parameters on the first third, the MIDDLE third out — the bull year, +72.3 %",
      C: "parameters on the 24 months of extended history before the series starts, the FIRST third out — the stronger bull, +243.0 %",
      D: "parameters on the 24 months before that, the 12 months before the series out — the SIDEWAYS year, −5.8 %. D's scored year sits inside C's in-sample, which is what a rolling walk-forward always does and is said here rather than hidden, so D is a fourth check on the same rules and never a fourth independent draw.",
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
    },
    determinism: "No wall-clock field is written. Re-running over the same two data directories reproduces this file byte for byte; every null is computed exactly rather than sampled.",
    caps: RISK_CAPS,
    liveCandidate: LIVE_CANDIDATE,
    costs: COSTS,
    stopRules: {
      shipped: { trendStops: stopsFor(REGIMES[0], "trend-4h", DEFAULT_TREND), otherStops: stopsForKind("momentum-1d", DEFAULT_TREND), constant: { ...SHIPPED_STOPS } },
      trail: { trendStops: stopsFor(REGIMES[1], "trend-4h", DEFAULT_TREND), otherStops: stopsForKind("momentum-1d", DEFAULT_TREND) },
      note: "Every figure in this file exists under both and is never averaged between them. `shipped` is the headline because it is what tick.ts runs. Momentum and rotation never carried the intra-bar trail (§3.3a), so those rows are identical under the two rules — that is a fact about the rules, not a copy-paste.",
    },
    ukBookUsdPerDay: UK_BOOK_USD_PER_DAY, krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY, minBookUsd: MIN_BOOK_USD,
    overlapTest: { medianMaxBps: OVERLAP_MEDIAN_MAX_BPS, p95MaxBps: OVERLAP_P95_MAX_BPS, minInSampleDays: MIN_IN_SAMPLE_DAYS, note: "§3.15's thresholds, written down there before the two sources were compared, reused unchanged" },
    data: { perSymbol: provenance, basket: { symbols: BASKET, alignedDaysCombined: basketCombined[BASKET[0]].length, alignedDaysCoinbase: basketCoinbase[BASKET[0]].length, windows: basketWins } },
  };

  // ── fidelity, before anything is claimed ───────────────────────────────
  {
    const perRule: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      let checks = 0, wRet = 0, wDD = 0, wTr = 0, tChecks = 0, tRet = 0, tDD = 0, tTr = 0;
      for (const symbol of SYMBOLS) {
        const { c4h, daily, wins } = series[symbol];
        for (const w of wins.filter((x) => x.scored)) {
          for (const v of ["revx", "kraken"] as const) {
            const st = stopsFor(reg, "trend-4h", DEFAULT_TREND);
            const a = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS[v], 4, st);
            const b = runGate(symbol, c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1, shippedDecider("trend-4h", symbol, c4h, daily, DEFAULT_TREND, 4), COSTS[v], st, null);
            checks++; wRet = Math.max(wRet, Math.abs(a.ret - b.ret)); wDD = Math.max(wDD, Math.abs(a.maxDD - b.maxDD)); wTr = Math.max(wTr, Math.abs(a.trades - b.trades));
            const c = runGate(symbol, c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1, shippedDecider("trend-4h", symbol, c4h, daily, DEFAULT_TREND, 4), COSTS[v], st, () => true);
            tChecks++; tRet = Math.max(tRet, Math.abs(a.ret - c.ret)); tDD = Math.max(tDD, Math.abs(a.maxDD - c.maxDD)); tTr = Math.max(tTr, Math.abs(a.trades - c.trades));
          }
        }
      }
      perRule[reg.id] = {
        runGate: { cellsCompared: checks, worstAbsRetDiff: wRet, worstAbsMaxDDDiff: wDD, worstAbsTradeDiff: wTr },
        trivialGate: { cellsCompared: tChecks, worstAbsRetDiff: tRet, worstAbsMaxDDDiff: tDD, worstAbsTradeDiff: tTr },
      };
      console.log(`[${reg.id}] fidelity: runGate ${checks} cells worst |Δret| ${wRet.toExponential(2)} |Δtrades| ${wTr}; trivial gate ${tChecks} cells worst |Δret| ${tRet.toExponential(2)}`);
    }
    report.fidelity = {
      note: "The one copy in this study is `runGate`. (1) `runGate` with `gate = null` against backtest.ts's `run`, every coin × every scored window × both venues × both stop rules. (2) The same with a gate that always returns true, so the gate branch itself is checked rather than only the path around it. (3) `publishedSleeve` at the end of this file: the live row's four windows against `windows.json`'s own.",
      perStopRule: perRule,
    };
  }

  // ── the live sleeve, gated or not ──────────────────────────────────────
  const SLOT = Math.min(LIVE_CANDIDATE.capitalUsd / LIVE_CANDIDATE.slots, RISK_CAPS.maxOrderUsd);
  const membersOf = (wname: WName) => LIVE_CANDIDATE.symbols.filter((s) => series[s].wins.find((w) => w.name === wname)?.scored);
  const winOf = (symbol: string, wname: WName) => series[symbol].wins.find((w) => w.name === wname)!;

  function liveSleeve(wname: WName, seg: "is" | "oos", reg: Regime, spec: GateSpec | null, members: string[], p: TrendParams = DEFAULT_TREND, costs: Costs = COSTS.revx): { stats: SetStats; blocked: number } {
    let blocked = 0;
    const sleeves = members.map((sym) => {
      const s = series[sym];
      const w = winOf(sym, wname);
      const onCb = seg === "is" && w.isSeries === "coinbase";
      const bars = onCb ? s.cb4h : s.c4h, daily = onCb ? s.cbDaily : s.daily;
      const from = seg === "is" ? w.isFrom : w.oosFrom, to = seg === "is" ? w.isTo : w.oosTo;
      const g = spec ? spec.make({ symbol: sym, bars, daily, p, barHours: 4, onCb }) : null;
      const r = runGate(sym, bars, from, to, p.slow + 1, shippedDecider("trend-4h", sym, bars, daily, p, 4), costs, stopsFor(reg, "trend-4h", p), g);
      blocked += r.gateBlocked;
      return { id: sym, slotUsd: SLOT, exposure: r.exposure, rets: dailyReturns(r.marks), open: dailyOpen(r.openFlags), tradedPerSlot: r.tradedWeight, fills: r.trades } as Sleeve;
    });
    return { stats: combine(sleeves), blocked };
  }

  // ── S1 ─────────────────────────────────────────────────────────────────
  type ArmWindow = { ret: number; maxDD: number; retOverDD: number; fills: number; deployment: number; turnoverPerYear: number; entriesBlocked: number; dRet: number; dRetOverDD: number };
  type ArmRow = { id: string; family: string; label: string; perWindow: Record<string, ArmWindow | null>; improvesD: boolean; keepsABC: boolean; dominates: boolean; worstWindowRetOverDD: number };
  const s1PerRule: Record<string, unknown> = {};
  const armsByRule: Record<string, ArmRow[]> = {};
  for (const reg of REGIMES) {
    const baseline: Record<string, SetStats> = {};
    for (const wname of WNAMES) {
      const members = membersOf(wname);
      if (!members.length) continue;
      baseline[wname] = liveSleeve(wname, "oos", reg, null, members).stats;
    }
    const arms: ArmRow[] = GATES.map((spec) => {
      const perWindow: Record<string, ArmWindow | null> = {};
      for (const wname of WNAMES) {
        const members = membersOf(wname);
        if (!members.length || !baseline[wname]) { perWindow[wname] = null; continue; }
        const { stats, blocked } = liveSleeve(wname, "oos", reg, spec, members);
        perWindow[wname] = {
          ret: stats.ret, maxDD: stats.maxDD, retOverDD: stats.retOverDD, fills: stats.fills,
          deployment: stats.deployment, turnoverPerYear: stats.turnoverPerYear, entriesBlocked: blocked,
          dRet: r4(stats.ret - baseline[wname].ret), dRetOverDD: r2(stats.retOverDD - baseline[wname].retOverDD),
        };
      }
      const d = perWindow.D, abc = ["A", "B", "C"].map((w) => perWindow[w]);
      const improvesD = !!d && d.dRet > 0;
      const keepsABC = abc.every((x) => !!x && x.dRet >= 0);
      const rets = WNAMES.map((w) => perWindow[w]?.retOverDD).filter((x): x is number => x != null);
      return { id: spec.id, family: spec.family, label: spec.label, perWindow, improvesD, keepsABC, dominates: improvesD && keepsABC, worstWindowRetOverDD: rets.length ? r2(Math.min(...rets)) : 0 };
    });
    armsByRule[reg.id] = arms;
    const n = arms.length;
    const ks = [
      arms.filter((a) => (a.perWindow.A?.dRet ?? -1) >= 0).length,
      arms.filter((a) => (a.perWindow.B?.dRet ?? -1) >= 0).length,
      arms.filter((a) => (a.perWindow.C?.dRet ?? -1) >= 0).length,
      arms.filter((a) => (a.perWindow.D?.dRet ?? -1) > 0).length,
    ];
    const observed = arms.filter((a) => a.dominates).length;

    // The honest walk-forward: one point per FAMILY per window, chosen by
    // in-sample sleeve return over drawdown on data strictly before the
    // window, then scored out of sample.
    const families = [...new Set(GATES.map((g) => g.family))];
    const chosen = families.map((fam) => {
      const per: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        const members = membersOf(wname);
        if (!members.length || !baseline[wname]) { per[wname] = null; continue; }
        const pool = GATES.filter((g) => g.family === fam);
        let best = pool[0], bestScore = -Infinity;
        for (const g of pool) {
          const sc = liveSleeve(wname, "is", reg, g, members).stats.retOverDD;
          if (sc > bestScore) { bestScore = sc; best = g; }
        }
        const out = liveSleeve(wname, "oos", reg, best, members).stats;
        per[wname] = {
          chosen: best.id, inSampleRetOverDD: r2(bestScore), ret: out.ret, maxDD: out.maxDD, retOverDD: out.retOverDD,
          dRet: r4(out.ret - baseline[wname].ret), dRetOverDD: r2(out.retOverDD - baseline[wname].retOverDD), fills: out.fills, deployment: out.deployment,
        };
      }
      const ds = WNAMES.map((w) => (per[w] as { dRet: number } | null)?.dRet).filter((x): x is number => x != null);
      const rds = WNAMES.map((w) => (per[w] as { retOverDD: number } | null)?.retOverDD).filter((x): x is number => x != null);
      const points = [...new Set(WNAMES.map((w) => (per[w] as { chosen: string } | null)?.chosen).filter((x): x is string => x != null))];
      return {
        family: fam, perWindow: per, windowsImproved: ds.filter((x) => x > 0).length, windowsScored: ds.length,
        worstWindowRetOverDD: rds.length ? r2(Math.min(...rds)) : 0,
        distinctPointsChosen: points.length, pointsChosen: points,
      };
    });

    // The plateau of each family: of its points, how many leave each window
    // positive, and how many improve D. A family whose single best point
    // helps D while the rest do not is a spike, not a finding.
    const familyPlateau = families.map((fam) => {
      const pool = arms.filter((a) => a.family === fam);
      const per: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        const rets = pool.map((a) => a.perWindow[wname]?.ret).filter((x): x is number => x != null);
        const ds = pool.map((a) => a.perWindow[wname]?.dRet).filter((x): x is number => x != null);
        per[wname] = rets.length
          ? { points: rets.length, positiveShare: Number((rets.filter((r) => r > 0).length / rets.length).toFixed(3)), medianRet: r4(median(rets)), improvedShare: Number((ds.filter((x) => x > 0).length / ds.length).toFixed(3)), medianDRet: r4(median(ds)) }
          : null;
      }
      return { family: fam, points: pool.length, dominators: pool.filter((a) => a.dominates).map((a) => a.id), perWindow: per };
    });

    // The MECHANISM, because it is the whole answer: an arm that improves
    // the sideways year by blocking entries also blocks the entries that
    // made the trending years. If that is what is happening, ΔD and ΔC move
    // opposite ways across the arms and both scale with how much the gate
    // refuses. Both are measured rather than asserted.
    const dD = arms.map((a) => a.perWindow.D?.dRet ?? 0);
    const dC = arms.map((a) => a.perWindow.C?.dRet ?? 0);
    const dB = arms.map((a) => a.perWindow.B?.dRet ?? 0);
    const blockedShare = arms.map((a) => {
      const blk = WNAMES.reduce((s, w) => s + (a.perWindow[w]?.entriesBlocked ?? 0), 0);
      const fills = WNAMES.reduce((s, w) => s + (a.perWindow[w]?.fills ?? 0), 0);
      return blk / Math.max(1, blk + fills / 2);
    });
    const asMap = (xs: number[]) => new Map(xs.map((v, i) => [i, v]));
    const worstBaseline = Math.min(...WNAMES.map((w) => baseline[w]?.retOverDD ?? Infinity).filter((x) => Number.isFinite(x)));
    const improvesWorst = arms.filter((a) => a.improvesD && a.worstWindowRetOverDD > worstBaseline).length;
    const ksWorst = [
      arms.filter((a) => (a.perWindow.D?.dRet ?? -1) > 0).length,
      arms.filter((a) => a.worstWindowRetOverDD > worstBaseline).length,
    ];

    s1PerRule[reg.id] = {
      stopsLabel: reg.label,
      baseline: Object.fromEntries(WNAMES.map((w) => [w, baseline[w] ?? null])),
      baselineMembers: Object.fromEntries(WNAMES.map((w) => [w, membersOf(w)])),
      baselineWorstWindowRetOverDD: r2(worstBaseline),
      arms: arms.slice().sort((a, b) => (b.perWindow.D?.dRet ?? -9) - (a.perWindow.D?.dRet ?? -9)),
      dominators: arms.filter((a) => a.dominates).map((a) => a.id),
      armsImprovingDOnly: arms.filter((a) => a.improvesD && !a.keepsABC).length,
      chance: chanceControl(n, ks, observed, "An arm is one gate point run on all four windows at sleeve level. The four tests are: leaves window A no worse than the ungated rule (Δret ≥ 0), the same for B, the same for C, and improves window D (Δret > 0). The null is that each test's passers are an independent uniform subset of the arms of the size that test actually produced, and the distribution is the exact hypergeometric intersection rather than a sample. It is the right control because the alternative on trial is that a gate which helps the sideways year is something other than a gate which simply trades less."),
      secondaryCriterion: {
        what: "a weaker bar than domination, and the one the repository's own ranking rule implies: improve window D AND leave the WORST of the four windows better than the ungated rule's worst (return over drawdown), since §3.11 ranks an arm by its worst window.",
        observed: improvesWorst,
        chance: chanceControl(n, ksWorst, improvesWorst, "Two tests: improves D, and has a better worst window. The exact null treats them as independent AND THEY ARE NOT — D is the ungated rule's worst window under both stop rules, so an arm that improves D improves the worst window unless some other window falls below D's new level. Its p-value is therefore not evidence of anything and is printed only so nobody quotes it as if it were. The number worth reading is the pair: this many arms improve the worst window, and none of them does it without giving back A, B or C."),
      },
      rankedByWorstWindow: arms.slice().sort((a, b) => b.worstWindowRetOverDD - a.worstWindowRetOverDD).slice(0, 8).map((a) => ({
        id: a.id, worstWindowRetOverDD: a.worstWindowRetOverDD, positiveInAllFour: WNAMES.every((w) => (a.perWindow[w]?.ret ?? -1) > 0),
        perWindow: Object.fromEntries(WNAMES.map((w) => [w, a.perWindow[w] ? { ret: a.perWindow[w]!.ret, retOverDD: a.perWindow[w]!.retOverDD, dRet: a.perWindow[w]!.dRet } : null])),
      })),
      positiveInAllFour: {
        what: "arms whose sleeve return is positive out of sample in every window — the test the live row itself fails, on D. This is the right chance control for any claim that a particular gate 'works on all four'.",
        which: arms.filter((a) => WNAMES.every((w) => (a.perWindow[w]?.ret ?? -1) > 0)).map((a) => a.id),
        chance: chanceControl(n, WNAMES.map((w) => arms.filter((a) => (a.perWindow[w]?.ret ?? -1) > 0).length), arms.filter((a) => WNAMES.every((w) => (a.perWindow[w]?.ret ?? -1) > 0)).length, "each window's positive arms are an independent uniform subset of the arms, of the size that window actually produced; exact hypergeometric intersection"),
      },
      mechanism: {
        note: "If a gate helps the sideways year by being out of the market, then across the arms ΔD and ΔC (the strongest bull) move opposite ways, and both scale with how much the gate refuses. These are Pearson correlations across the arms themselves, not across time.",
        pearson_dD_vs_dC: r4(corrOf(asMap(dD), asMap(dC))),
        pearson_dD_vs_dB: r4(corrOf(asMap(dD), asMap(dB))),
        pearson_blockedShare_vs_dD: r4(corrOf(asMap(blockedShare), asMap(dD))),
        pearson_blockedShare_vs_dC: r4(corrOf(asMap(blockedShare), asMap(dC))),
        armsImprovingBothDandC: arms.filter((a) => (a.perWindow.D?.dRet ?? -1) > 0 && (a.perWindow.C?.dRet ?? -1) >= 0).length,
        medianDCamongArmsImprovingD: r4(median(arms.filter((a) => (a.perWindow.D?.dRet ?? -1) > 0).map((a) => a.perWindow.C?.dRet ?? 0))),
        medianDeploymentDropInC: r4(median(arms.map((a) => (baseline.C?.deployment ?? 0) - (a.perWindow.C?.deployment ?? 0)))),
      },
      familyPlateau, chosenPerFamily: chosen,
      note: "Every arm uses the SEEDED trend parameters (fast 20 / slow 100 / 3×ATR) and the live row's coins and $20 slots, so the gate is the only variable. `arms` is the full grid — the plateau of each idea. `chosenPerFamily` is the walk-forward version: the family's best point by IN-SAMPLE sleeve return over drawdown on data strictly before the scored window.",
    };
    console.log(`[${reg.id}] S1: ${observed} of ${n} arms improve D without costing A, B or C; ${ks[3]} improve D at all (null expects ${chanceControl(n, ks, observed, "").expectedUnderNull} dominators)`);
  }
  report.s1_sidewaysYear = {
    question: "Window D is the only window the live rule loses in (−7.8 %) and it carries the rule's largest drawdown (15.5 %). Does anything detect a directionless market and stand down — and does it do that WITHOUT giving back windows A, B and C, under both stop rules?",
    method: "Six families of ENTRY GATE, 33 points in all, each run over the live row's five coins at their $20 slots on all four windows under both stop rules. A gate may only refuse an entry: it never forces one and never causes an exit, so the rulebook, the stops and the cooldown are untouched and the gate is the only variable. Reported as the full grid (each idea's plateau) and as a walk-forward choice per family per window (the point chosen on in-sample data strictly before the window it is scored on).",
    families: [...new Set(GATES.map((g) => g.family))],
    gates: GATES.map((g) => ({ id: g.id, family: g.family, label: g.label })),
    crossStopRule: (() => {
      const a = armsByRule.shipped, b = armsByRule.trail;
      const bothD = a.filter((x) => x.improvesD && b.find((y) => y.id === x.id)?.improvesD).map((x) => x.id);
      const bothDom = a.filter((x) => x.dominates && b.find((y) => y.id === x.id)?.dominates).map((x) => x.id);
      const ks = [a.filter((x) => x.improvesD).length, b.filter((x) => x.improvesD).length];
      return {
        note: "A gate that only works under one stop rule is a gate that works with one stop rule's artefacts. Which arms improve window D under BOTH, and which dominate under both.",
        improveDUnderBoth: bothD, dominateUnderBoth: bothDom,
        chance: chanceControl(a.length, ks, bothD.length, "Two tests: improves D under `shipped`, improves D under `trail`. The exact null is the same construction, and it is deliberately weak here — the two rules share the same candles, so agreement between them is expected and is not evidence of an edge."),
      };
    })(),
    perStopRule: s1PerRule,
  };

  // ── S2: the seven rows on four windows ─────────────────────────────────
  type RowSpec = {
    id: string; dbId: string; label: string; kind: StrategyKind; venue: "revx" | "kraken"; costs: Costs; barHours: number;
    symbols: string[]; capitalUsd: number; slotUsd: number; rotation: RotationParams | null; twin: string | null; job: string;
  };
  const K = COSTS.kraken, R = COSTS.revx;
  const ROWS: RowSpec[] = [
    { id: "trend-4h·revx", dbId: "trend-4h", label: "Trend 4h · Revolut X", kind: "trend-4h", venue: "revx", costs: R, barHours: 4, symbols: LIVE_CANDIDATE.symbols, capitalUsd: 100, slotUsd: 20, rotation: null, twin: "trend-4h·kraken", job: "the recommended live row (§3.11, go-live.md)" },
    { id: "trend-1h·revx", dbId: "trend-1h", label: "Trend 1h · Revolut X", kind: "trend-1h", venue: "revx", costs: R, barHours: 1, symbols: ["BTC/USD", "ETH/USD", "SOL/USD"], capitalUsd: 40, slotUsd: 40 / 3, rotation: null, twin: null, job: "feedback speed: fills fast enough to judge the loop in days rather than weeks" },
    { id: "momentum-1d·revx", dbId: "momentum-1d", label: "Momentum 30d · Revolut X", kind: "momentum-1d", venue: "revx", costs: R, barHours: 4, symbols: ["BTC/USD", "ETH/USD", "SOL/USD"], capitalUsd: 40, slotUsd: 40 / 3, rotation: null, twin: "momentum-1d·kraken", job: "a second, slower rulebook on the same coins" },
    { id: "momentum-1d·kraken", dbId: "momentum-1d-kraken", label: "Momentum 30d · Kraken", kind: "momentum-1d", venue: "kraken", costs: K, barHours: 4, symbols: ["BTC/USD", "ETH/USD", "SOL/USD"], capitalUsd: 40, slotUsd: 40 / 3, rotation: null, twin: "momentum-1d·revx", job: "measuring Kraken's post-only FILL behaviour on a slow rule, not its return" },
    { id: "trend-4h·kraken", dbId: "trend-4h-kraken", label: "Trend 4h · Kraken", kind: "trend-4h", venue: "kraken", costs: K, barHours: 4, symbols: LIVE_CANDIDATE.symbols, capitalUsd: 100, slotUsd: 20, rotation: null, twin: "trend-4h·revx", job: "measuring Kraken's post-only FILL behaviour on the LIVE rulebook, not its return" },
    { id: "rotation-1d·revx", dbId: "rotation-1d", label: "Rotation · Revolut X", kind: "rotation-1d", venue: "revx", costs: R, barHours: 24, symbols: BASKET, capitalUsd: 60, slotUsd: 40, rotation: DEFAULT_ROTATION, twin: "rotation-1w·kraken", job: "the only cross-sectional rule in the set" },
    { id: "rotation-1w·kraken", dbId: "rotation-1w-kraken", label: "Rotation · Kraken (7-day minimum hold)", kind: "rotation-1d", venue: "kraken", costs: K, barHours: 24, symbols: BASKET, capitalUsd: 60, slotUsd: 40, rotation: { ...DEFAULT_ROTATION, minHoldDays: 7 }, twin: "rotation-1d·revx", job: "the damped rotation twin on the expensive venue" },
  ];

  function barsFor(symbol: string, barHours: number): Candle[] {
    const s = series[symbol];
    return barHours === 1 ? s.hourly : barHours === 4 ? s.c4h : s.daily;
  }
  /** One window mapped onto a row's own bar size by CALENDAR, so every row's window A is the same year. */
  function windowOnSeries(symbol: string, wname: WName, barHours: number): { from: number; to: number } | null {
    const w = series[symbol].wins.find((x) => x.name === wname);
    if (!w || !w.scored) return null;
    const bars = barsFor(symbol, barHours);
    if (barHours === 4) return { from: w.oosFrom, to: w.oosTo };
    const c4h = series[symbol].c4h;
    return { from: indexAtOrAfter(bars, c4h[w.oosFrom].start), to: indexAtOrAfter(bars, c4h[w.oosTo - 1].start + 4 * 3600e3) };
  }

  type RowWindow = { stats: SetStats; pnl: Map<number, number>; medianHoldDays: number; roundTrips: number; stops: number; capitalDeployedUsd: number; perCoin: Record<string, unknown> };
  /** A row's variation: the trend parameters, the momentum lookback and the floor under cost — the three §3.14 searched. */
  type RowVariant = { p: TrendParams; lookbackDays: number; floorPct: number; rotation?: RotationParams };
  const SEEDED_VARIANT: RowVariant = { p: DEFAULT_TREND, lookbackDays: 30, floorPct: SHIPPED_STOPS.maxLossPct };
  function priceRow(row: RowSpec, wname: WName, reg: Regime, v: RowVariant = SEEDED_VARIANT): RowWindow | null {
    const rot = v.rotation ?? row.rotation;
    if (rot) {
      const w = basketWins.find((x) => x.name === wname);
      if (!w || !w.scored) return null;
      const r = runRotation(basketCombined, w.oosFrom, w.oosTo, rot, row.costs, { ...stopsFor(reg, "rotation-1d", DEFAULT_TREND), maxLossPct: v.floorPct });
      const rets = dailyReturns(r.equity);
      const marks = dailyMarks(r.equity);
      const open = new Map<number, number>();
      for (let i = 1; i < marks.length; i++) open.set(marks[i].day, marks[i].eq !== marks[i - 1].eq ? 1 : 0);   // a proxy, as §3.11's and §3.14's is
      const stats = combine([{ id: row.id, slotUsd: row.slotUsd, exposure: r.exposure, rets, open, tradedPerSlot: r.turnover * Math.max(1e-9, r.days / 365), fills: r.trades }]);
      const pnl = new Map<number, number>();
      for (const [d, x] of rets) pnl.set(d, row.slotUsd * x);
      return { stats, pnl, medianHoldDays: NaN, roundTrips: Math.floor(r.trades / 2), stops: r.stopsHit ?? 0, capitalDeployedUsd: row.slotUsd, perCoin: {} };
    }
    const sleeves: Sleeve[] = [];
    const pnl = new Map<number, number>();
    const holds: number[] = [];
    const perCoin: Record<string, unknown> = {};
    let roundTrips = 0, stops = 0;
    const slot = Math.min(row.capitalUsd / row.symbols.length, RISK_CAPS.maxOrderUsd);
    for (const symbol of row.symbols) {
      const span = windowOnSeries(symbol, wname, row.barHours);
      if (!span) continue;
      const bars = barsFor(symbol, row.barHours);
      const stops1 = { ...stopsFor(reg, row.kind, v.p), maxLossPct: v.floorPct };
      const r = runGate(symbol, bars, span.from, span.to, v.p.slow + 1, shippedDecider(row.kind, symbol, bars, series[symbol].daily, v.p, row.barHours, v.lookbackDays), row.costs, stops1, null);
      const rets = dailyReturns(r.marks);
      sleeves.push({ id: `${row.id}·${symbol}`, slotUsd: slot, exposure: r.exposure, rets, open: dailyOpen(r.openFlags), tradedPerSlot: r.tradedWeight, fills: r.trades });
      for (const [d, x] of rets) pnl.set(d, (pnl.get(d) ?? 0) + slot * x);
      for (const t of r.tradeLog) holds.push(t.holdBars * row.barHours / 24);
      roundTrips += r.tradeLog.length; stops += r.stopsHit ?? 0;
      perCoin[symbol] = { ...pick(r), medianHoldDays: r.tradeLog.length ? r2(median(r.tradeLog.map((t) => t.holdBars * row.barHours / 24))) : null };
    }
    if (!sleeves.length) return null;
    return { stats: combine(sleeves), pnl, medianHoldDays: holds.length ? r2(median(holds)) : NaN, roundTrips, stops, capitalDeployedUsd: sleeves.length * slot, perCoin };
  }

  const pricedByRule: Record<string, Record<string, Record<string, RowWindow | null>>> = {};
  const s2PerRule: Record<string, unknown> = {};
  for (const reg of REGIMES) {
    const priced: Record<string, Record<string, RowWindow | null>> = {};
    for (const row of ROWS) {
      priced[row.id] = {};
      for (const wname of WNAMES) priced[row.id][wname] = priceRow(row, wname, reg);
    }
    pricedByRule[reg.id] = priced;
    const rows = ROWS.map((row) => {
      const per: Record<string, unknown> = {};
      const scored: number[] = [];
      for (const wname of WNAMES) {
        const x = priced[row.id][wname];
        if (!x) { per[wname] = null; continue; }
        per[wname] = { ...x.stats, medianHoldDays: Number.isFinite(x.medianHoldDays) ? x.medianHoldDays : null, roundTrips: x.roundTrips, stopsHit: x.stops, perCoin: x.perCoin };
        scored.push(x.stats.retOverDD);
      }
      const rtBps = median(row.symbols.map((s) => roundTripBps(row.costs, s)));
      const holds = WNAMES.map((w) => priced[row.id][w]?.medianHoldDays).filter((x): x is number => x != null && Number.isFinite(x));
      const fills90 = WNAMES.map((w) => priced[row.id][w]?.stats.fillsPer90Days).filter((x): x is number => x != null);
      return {
        id: row.id, dbId: row.dbId, label: row.label, venue: row.venue, kind: row.kind, symbols: row.symbols,
        capitalUsd: row.capitalUsd, slotUsd: r2(Math.min(row.capitalUsd / row.symbols.length, RISK_CAPS.maxOrderUsd)),
        statedJob: row.job, twin: row.twin, verdict_3_14: VERDICTS_3_14[row.id] ?? null,
        perWindow: per,
        worstWindowRetOverDD: scored.length ? r2(Math.min(...scored)) : 0,
        windowsScored: WNAMES.filter((w) => priced[row.id][w] != null),
        windowsPositive: WNAMES.filter((w) => (priced[row.id][w]?.stats.ret ?? -1) > 0),
        windowsOverDrawdownLimit: WNAMES.filter((w) => (priced[row.id][w]?.stats.maxDD ?? 0) >= 0.35),
        medianRoundTripBps: r2(rtBps),
        medianHoldDays: holds.length ? r2(median(holds)) : null,
        breakEvenDriftPerYear: holds.length ? r2(breakEvenDriftPerYear(rtBps, median(holds))) : null,
        publishedMedianHoldDays: SHIPPED_MEDIAN_HOLD_DAYS[row.kind] ?? null,
        fillsPer90DaysRange: fills90.length ? [Math.min(...fills90), Math.max(...fills90)] : [],
        daysToTenFills: fills90.length ? [r2(900 / Math.max(1e-9, Math.max(...fills90))), r2(900 / Math.max(1e-9, Math.min(...fills90)))] : [],
      };
    });
    const correlations = WNAMES.map((wname) => ({
      window: wname,
      pairs: ROWS.flatMap((x, i) => ROWS.slice(i + 1).map((y) => {
        const a = priced[x.id][wname], b = priced[y.id][wname];
        return { a: x.id, b: y.id, correlation: a && b ? r4(corrOf(a.pnl, b.pnl)) : null };
      })).sort((m, n2) => (n2.correlation ?? -2) - (m.correlation ?? -2)),
    }));
    const maxCorrWithAnother = Object.fromEntries(ROWS.map((row) => {
      const all = correlations.flatMap((c) => c.pairs.filter((p) => p.a === row.id || p.b === row.id).map((p) => ({ other: p.a === row.id ? p.b : p.a, correlation: p.correlation })));
      const vals = all.filter((x) => x.correlation != null).map((x) => x.correlation!);
      const nonTwin = all.filter((x) => x.correlation != null && x.other !== row.twin).map((x) => x.correlation!);
      return [row.id, {
        maxAny: vals.length ? r4(Math.max(...vals)) : null,
        maxNonTwin: nonTwin.length ? r4(Math.max(...nonTwin)) : null,
        twin: row.twin,
        note: "the maximum over all four windows; `maxNonTwin` excludes the row's own venue twin, which is the same signal priced at another fee and is a duplicate by construction",
      }];
    }));

    // The row's own parameter plateau, at ROW level: the same grid §3.14
    // searched, run out of sample on every window. A row whose seeded point
    // is the only good one in its grid was fitted; a row on a plateau was
    // found. Sensitivity is a spike, robustness is a plateau, and both are
    // measurable (§4.15).
    const TREND_GRID: TrendParams[] = [];
    for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
    const MOMENTUM_GRID: RowVariant[] = [];
    for (const lookbackDays of [20, 30, 60, 90]) for (const floorPct of [0.08, 0.20]) MOMENTUM_GRID.push({ p: DEFAULT_TREND, lookbackDays, floorPct });
    const ROTATION_GRID: RowVariant[] = [];
    for (const lookbackDays of [30, 60, 90]) for (const topN of [1, 2, 3]) for (const minHoldDays of [0, 7, 30]) {
      ROTATION_GRID.push({ p: DEFAULT_TREND, lookbackDays, floorPct: SHIPPED_STOPS.maxLossPct, rotation: { ...DEFAULT_ROTATION, lookbackDays, topN, minHoldDays } });
    }
    const plateaus = ROWS.map((row) => {
      const grid: RowVariant[] = row.rotation
        ? ROTATION_GRID
        : row.kind === "momentum-1d" ? MOMENTUM_GRID : TREND_GRID.map((p) => ({ p, lookbackDays: 30, floorPct: SHIPPED_STOPS.maxLossPct }));
      const seededIdx = row.rotation
        ? grid.findIndex((g) => g.rotation!.lookbackDays === row.rotation!.lookbackDays && g.rotation!.topN === row.rotation!.topN && g.rotation!.minHoldDays === row.rotation!.minHoldDays)
        : row.kind === "momentum-1d" ? grid.findIndex((g) => g.lookbackDays === 30 && g.floorPct === SHIPPED_STOPS.maxLossPct)
        : grid.findIndex((g) => g.p.fast === DEFAULT_TREND.fast && g.p.slow === DEFAULT_TREND.slow && g.p.atrStop === DEFAULT_TREND.atrStop);
      const per: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        if (!priced[row.id][wname]) { per[wname] = null; continue; }
        const rets = grid.map((g) => priceRow(row, wname, reg, g)?.stats.ret ?? 0);
        const seeded = seededIdx >= 0 ? rets[seededIdx] : NaN;
        per[wname] = { ...plateauOf(rets, seeded), seededRet: r4(seeded), best: r4(Math.max(...rets)), worst: r4(Math.min(...rets)) };
      }
      return { id: row.id, gridPoints: grid.length, gridIs: row.rotation ? "lookback 30/60/90 × top 1/2/3 × minimum hold 0/7/30" : row.kind === "momentum-1d" ? "lookback 20/30/60/90 days × floor 8 %/20 %" : "fast 10/20/30 × slow 50/100/150 × ATR stop 2/3/4 (§3.7's 27 points)", perWindow: per };
    });

    // Seven rows against four windows is itself a search, even though
    // nothing was chosen here: ask how many rows a null with these
    // per-window rates puts through all four, before reading a row that
    // does as a discovery.
    const posPerWindow = WNAMES.map((w) => ROWS.filter((row) => (priced[row.id][w]?.stats.ret ?? -1) > 0).length);
    const allFourPositive = ROWS.filter((row) => WNAMES.every((w) => (priced[row.id][w]?.stats.ret ?? -1) > 0)).map((r) => r.id);
    const platPerWindow = WNAMES.map((w) => plateaus.filter((p) => ((p.perWindow as Record<string, Plateau | null>)[w]?.positiveShare ?? 0) >= 0.5).length);
    const allFourPlateau = plateaus.filter((p) => WNAMES.every((w) => ((p.perWindow as Record<string, Plateau | null>)[w]?.positiveShare ?? 0) >= 0.5)).map((p) => p.id);

    // What a mis-measured spread would do. Every spread in COSTS is ONE
    // snapshot (§3.7's own caveat), and a row that turns over 60×/y pays
    // that number 60 times. First-order: each fill costs its slot × the
    // extra basis points, so the row's return falls by fills × slot × bps
    // over the row's capital. Compounding is ignored, which is stated
    // rather than hidden.
    const costSensitivity = ROWS.map((row) => {
      const per: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        const x = priced[row.id][wname];
        if (!x) { per[wname] = null; continue; }
        const slot = row.rotation ? row.slotUsd : Math.min(row.capitalUsd / row.symbols.length, RISK_CAPS.maxOrderUsd);
        const capital = x.capitalDeployedUsd;
        const drop = (bps: number) => r4(x.stats.ret - x.stats.fills * slot * (bps / 1e4) / Math.max(1e-9, capital));
        per[wname] = { ret: x.stats.ret, retAtPlus5BpsPerFill: drop(5), retAtPlus10BpsPerFill: drop(10), fills: x.stats.fills };
      }
      return { id: row.id, perWindow: per };
    });

    s2PerRule[reg.id] = {
      stopsLabel: reg.label, rows, correlations, maxCorrelationWithAnotherRow: maxCorrWithAnother, plateaus, costSensitivity,
      chance: {
        note: "Seven rows, four windows. Nothing was CHOSEN here — these are the rows that already exist — but reading 'this row cleared all four' as a discovery still needs the control, because with seven rows and these per-window rates a null produces some. The null is the same exact hypergeometric construction as §3.15's.",
        positive: { perWindow: Object.fromEntries(WNAMES.map((w, i) => [w, posPerWindow[i]])), allFour: allFourPositive, ...chanceControl(ROWS.length, posPerWindow, allFourPositive.length, "a row is positive out of sample in that window") },
        plateauAtLeastHalf: { perWindow: Object.fromEntries(WNAMES.map((w, i) => [w, platPerWindow[i]])), allFour: allFourPlateau, ...chanceControl(ROWS.length, platPerWindow, allFourPlateau.length, "at least half of the row's own parameter grid is positive out of sample in that window") },
      },
    };
    for (const p of plateaus) console.log(`[${reg.id}] plateau ${p.id.padEnd(20)} ${WNAMES.map((w) => { const x = (p.perWindow as Record<string, { positiveShare: number; chosenRank: number } | null>)[w]; return `${w} ${x ? (x.positiveShare * 100).toFixed(0) + "%/#" + x.chosenRank : "—"}`; }).join(" ")}`);
    for (const r of rows) {
      console.log(`[${reg.id}] ${r.id.padEnd(20)} ${WNAMES.map((w) => { const x = (r.perWindow as Record<string, SetStats | null>)[w]; return `${w} ${x ? (x.ret * 100).toFixed(1).padStart(6) + "%" : "     —"}`; }).join(" ")} | worst ret/DD ${String(r.worstWindowRetOverDD).padStart(6)} | fills/90d ${JSON.stringify(r.fillsPer90DaysRange)}`);
    }
  }

  report.s2_publishedRowCrossCheck = {
    note: "§3.11's own published per-row table (as `backtest_kraken2.ts` types it) against this harness's, under the TRAIL stop rule, which is what that study ran. A study that cannot reproduce the table it is arguing with has not earned its own numbers. The same rows under `shipped` are §3.14's own figures — `trend-1h·revx` reads $1.51 and $4.08 on $40 there, which is +3.8 % and +10.2 %.",
    rows: ROWS.map((row) => {
      const pub = PUBLISHED_3_11[row.id];
      const a = pricedByRule.trail[row.id].A, b = pricedByRule.trail[row.id].B;
      return {
        id: row.id, publishedA: pub[0], computedA: a ? a.stats.ret : null, dA: a ? r4(a.stats.ret - pub[0]) : null,
        publishedMaxDDA: pub[1], computedMaxDDA: a ? a.stats.maxDD : null,
        publishedB: pub[2], computedB: b ? b.stats.ret : null, dB: b ? r4(b.stats.ret - pub[2]) : null,
        publishedMaxDDB: pub[3], computedMaxDDB: b ? b.stats.maxDD : null,
      };
    }),
    worstAbsDelta: r4(Math.max(...ROWS.flatMap((row) => {
      const pub = PUBLISHED_3_11[row.id];
      const a = pricedByRule.trail[row.id].A, b = pricedByRule.trail[row.id].B;
      return [a ? Math.abs(a.stats.ret - pub[0]) : 0, b ? Math.abs(b.stats.ret - pub[2]) : 0];
    }))),
  };

  report.s2_rows = {
    question: "§3.14 gave each row a verdict on two windows. What do four say?",
    method: "Each row at its own capital, its own coins and its own bar, seeded parameters, over the SAME calendar windows as the live row (each coin's four-hour windows, mapped onto that row's bar size), so every row's window A is the same year. Sleeves combine at fixed slots capped by `max_order_usd`, the way a live row earns. §3.14 measured that not one row's optimisation earns its search — the three that stayed positive out of sample were still worse than the seeded row they came from — so only the seeded point is priced here.",
    rowsUnderTest: ROWS.map((r) => ({ id: r.id, dbId: r.dbId, venue: r.venue, kind: r.kind, symbols: r.symbols, capitalUsd: r.capitalUsd, statedJob: r.job, verdict_3_14: VERDICTS_3_14[r.id] ?? null })),
    perStopRule: s2PerRule,
  };

  // The rotation variants — §3.4's six, on four windows and both venues.
  {
    const rotationVariants: Record<string, RotationParams> = {
      default: DEFAULT_ROTATION,
      noBearFilter: { ...DEFAULT_ROTATION, bearFilter: false },
      minHold7: { ...DEFAULT_ROTATION, minHoldDays: 7 },
      top1: { ...DEFAULT_ROTATION, topN: 1 },
      top3: { ...DEFAULT_ROTATION, topN: 3 },
      lookback60: { ...DEFAULT_ROTATION, lookbackDays: 60 },
    };
    const perVariant: Record<string, unknown> = {};
    for (const [name, p] of Object.entries(rotationVariants)) {
      const perVenue: Record<string, unknown> = {};
      for (const v of ["revx", "kraken"] as const) {
        const per: Record<string, unknown> = {};
        for (const wname of WNAMES) {
          const w = basketWins.find((x) => x.name === wname);
          if (!w || !w.scored) { per[wname] = null; continue; }
          const r = runRotation(basketCombined, w.oosFrom, w.oosTo, p, COSTS[v], stopsForKind("rotation-1d", DEFAULT_TREND));
          per[wname] = { ...pick(r), turnoverPerYear: r2(r.turnover) };
        }
        perVenue[v] = per;
      }
      perVariant[name] = { params: p, ...perVenue };
    }
    report.s2_rotationVariants = {
      note: "§3.4's six variants on the aligned four-coin basket, four windows, both venues, with the loop's floor and cooldown. The rotation rulebook never carried the intra-bar trail (§3.3a), so there is one table rather than two. Returns are the rule's own compounding curve (runRotation's), not a fixed-slot sleeve, which is why they are not the row table's numbers.",
      windows: basketWins, perVariant,
    };
    console.log(`rotation variants: 6 × 2 venues × ${basketWins.filter((w) => w.scored).length} windows`);
  }

  // ── S3: what is worth adding ───────────────────────────────────────────
  {
    const makerRevx: Costs = { ...COSTS.revx, venue: "revx-maker", fillFee: "maker" };
    const WIDE: TrendParams = { ...DEFAULT_TREND, slow: 200, breakoutUp: 100, breakoutDown: 36, atrStop: 4 };
    const out: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const maker: Record<string, unknown> = {}, wide: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        const members = membersOf(wname);
        if (!members.length) { maker[wname] = null; wide[wname] = null; continue; }
        const base = liveSleeve(wname, "oos", reg, null, members).stats;
        const mk = liveSleeve(wname, "oos", reg, null, members, DEFAULT_TREND, makerRevx).stats;
        const wd = liveSleeve(wname, "oos", reg, null, members, WIDE, COSTS.revx).stats;
        maker[wname] = { ...mk, dRet: r4(mk.ret - base.ret), dRetOverDD: r2(mk.retOverDD - base.retOverDD) };
        wide[wname] = { ...wd, dRet: r4(wd.ret - base.ret), dRetOverDD: r2(wd.retOverDD - base.retOverDD) };
      }
      out[reg.id] = { makerExecution: maker, trendWideSleeve: wide };
    }
    // `trend-4h-wide` is not one point: §3.12 and §3.15 searched an
    // eight-point grid, so judging it on the single point above would be
    // the same selection this study is trying not to make. The whole grid
    // is run at sleeve level, out of sample on every window, with its
    // plateau, and separately with the point CHOSEN in sample on data
    // strictly before each window.
    const WIDE_GRID: TrendParams[] = [];
    for (const slow of [200, 300]) for (const breakoutUp of [100, 200]) for (const atrStop of [4, 6]) {
      WIDE_GRID.push({ ...DEFAULT_TREND, slow, breakoutUp, breakoutDown: Math.round(breakoutUp / 2.75), atrStop });
    }
    const wideGrid: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const per: Record<string, unknown> = {};
      for (const wname of WNAMES) {
        const members = membersOf(wname);
        if (!members.length) { per[wname] = null; continue; }
        const base = liveSleeve(wname, "oos", reg, null, members).stats;
        const oos = WIDE_GRID.map((p) => liveSleeve(wname, "oos", reg, null, members, p, COSTS.revx).stats);
        let bestIdx = 0, bestScore = -Infinity;
        for (let i = 0; i < WIDE_GRID.length; i++) {
          const sc = liveSleeve(wname, "is", reg, null, members, WIDE_GRID[i], COSTS.revx).stats.retOverDD;
          if (sc > bestScore) { bestScore = sc; bestIdx = i; }
        }
        const namedIdx = WIDE_GRID.findIndex((p) => p.slow === WIDE.slow && p.breakoutUp === WIDE.breakoutUp && p.atrStop === WIDE.atrStop);
        per[wname] = {
          baselineRet: base.ret,
          plateau: plateauOf(oos.map((r) => r.ret), oos[namedIdx].ret),
          chosenInSample: { params: { slow: WIDE_GRID[bestIdx].slow, breakoutUp: WIDE_GRID[bestIdx].breakoutUp, atrStop: WIDE_GRID[bestIdx].atrStop }, inSampleRetOverDD: r2(bestScore), ret: oos[bestIdx].ret, maxDD: oos[bestIdx].maxDD, retOverDD: oos[bestIdx].retOverDD, dRet: r4(oos[bestIdx].ret - base.ret), fills: oos[bestIdx].fills },
          namedPoint: { params: { slow: WIDE.slow, breakoutUp: WIDE.breakoutUp, atrStop: WIDE.atrStop }, ret: oos[namedIdx].ret, maxDD: oos[namedIdx].maxDD, retOverDD: oos[namedIdx].retOverDD, dRet: r4(oos[namedIdx].ret - base.ret), fills: oos[namedIdx].fills },
          gridRets: oos.map((r) => r.ret),
        };
      }
      const chosenRets = WNAMES.map((w) => (per[w] as { chosenInSample: { ret: number } } | null)?.chosenInSample.ret).filter((x): x is number => x != null);
      const chosenRDD = WNAMES.map((w) => (per[w] as { chosenInSample: { retOverDD: number } } | null)?.chosenInSample.retOverDD).filter((x): x is number => x != null);
      // The chance control for the only claim this block could support:
      // how many of the eight points beat the SEEDED sleeve in every window?
      const cells = WNAMES.map((w) => per[w] as { baselineRet: number; gridRets: number[] } | null);
      const beatsPerWindow = cells.map((c) => c ? c.gridRets.filter((r) => r > c.baselineRet).length : 0).filter((_, i) => cells[i] != null);
      const beatsAll = WIDE_GRID.map((_, i) => cells.every((c) => c == null || c.gridRets[i] > c.baselineRet)).filter(Boolean).length;
      wideGrid[reg.id] = {
        perWindow: per,
        chosenPositiveInAllFour: chosenRets.every((x) => x > 0), chosenWorstWindowRetOverDD: chosenRDD.length ? r2(Math.min(...chosenRDD)) : 0,
        pointsMovedAcrossWindows: new Set(WNAMES.map((w) => JSON.stringify((per[w] as { chosenInSample: { params: unknown } } | null)?.chosenInSample.params ?? null))).size,
        beatsSeededInEveryWindow: beatsAll,
        chance: chanceControl(WIDE_GRID.length, beatsPerWindow, beatsAll, "of the eight wide points, how many beat the SEEDED sleeve's return in every window. The exact null treats each window's winners as an independent uniform subset of the eight, which is generous to the grid: eight points sharing two parameters are nowhere near independent, so a null built this way UNDERSTATES how easily a grid produces a clean sweep."),
      };
    }
    report.s3_wideGrid = {
      note: "§3.12 / §3.15's eight-point wide grid (slow 200/300 × breakout 100/200 × 4/6×ATR) at SLEEVE level on the live row's coins and slots. `namedPoint` is the point §3.14 proposed; `chosenInSample` is the point a walk-forward choice would actually have picked on each window, which is the only version that is not hindsight. `pointsMovedAcrossWindows` says how many distinct points that choice produced: a rule whose best point is a different point every year has not been found, it has been fitted each time.",
      grid: WIDE_GRID.map((p) => ({ slow: p.slow, breakoutUp: p.breakoutUp, breakoutDown: p.breakoutDown, atrStop: p.atrStop })),
      perStopRule: wideGrid,
    };

    report.s3_candidatesPriced = {
      note: "Two candidates outside S1's gates. (1) MAKER EXECUTION: the same rule, coins and stops with Revolut X's 0 % maker fee instead of the 9 bps taker — a cost schedule `run` takes directly, no new rule and no code change. §3.13 measured it as a one-window win once the duplicated stop was removed and said the result reverses if a filled bid needs 10–20 bps of adverse move, which a Coinbase-candle backtest cannot see; migration 0042's `agent_maker_probes` already measures exactly that on the live book at no cost. (2) `trend-4h-wide` at SLEEVE level (slow 200, breakout 100/36, 4×ATR): §3.15 killed it per coin on window D, and this is what it does to the row as a whole.",
      makerCosts: makerRevx, wideParams: WIDE, perStopRule: out,
    };
  }

  // ── S4: the sets, priced ───────────────────────────────────────────────
  {
    const SETS: { id: string; rows: string[]; what: string }[] = [
      { id: "shippedSeven", rows: ROWS.map((r) => r.id), what: "what runs today: seven paper rows, $440 of row capital and $400 deployable once the $20 order cap is applied to the rotations" },
      { id: "liveRowOnly", rows: ["trend-4h·revx"], what: "the go-live brief's row alone" },
      { id: "liveRowPlusKrakenTwin", rows: ["trend-4h·revx", "trend-4h·kraken"], what: "the live row and the one twin measuring the same rulebook's fills on the second venue" },
      { id: "liveRowPlusMomentum", rows: ["trend-4h·revx", "momentum-1d·revx"], what: "the live row and the only rule whose P&L is not a restatement of another row's" },
      { id: "recommended", rows: ["trend-4h·revx", "momentum-1d·revx", "trend-4h·kraken"], what: "the live row, the uncorrelated second rulebook, and the Kraken fill probe" },
      { id: "finalTestingSet", rows: ["trend-4h·revx", "trend-1h·revx", "momentum-1d·revx", "trend-4h·kraken"], what: "THIS STUDY'S ANSWER: the live row plus the three paper rows that keep a measurement job the others duplicate — both rotations and the Kraken momentum twin deleted" },
      { id: "finalTestingSetPaperOnly", rows: ["trend-1h·revx", "momentum-1d·revx", "trend-4h·kraken"], what: "the same set without the live row, because live capital and paper capital are separate caps and this is what the paper book would be" },
      { id: "dropRotationsAndTrend1h", rows: ["trend-4h·revx", "momentum-1d·revx", "momentum-1d·kraken", "trend-4h·kraken"], what: "§3.14's deletions applied to the rotations and the hourly row only" },
      { id: "revxOnly", rows: ["trend-4h·revx", "trend-1h·revx", "momentum-1d·revx", "rotation-1d·revx"], what: "everything on the cheap venue" },
    ];
    const perRule: Record<string, unknown> = {};
    for (const reg of REGIMES) {
      const priced = pricedByRule[reg.id];
      // A row's deployable capital in a window is the slots that window
      // actually has: SUI has no window C or D, so the live row carries $80
      // there, not $100. Dividing the same P&L by capital the window never
      // held would understate every figure in the table.
      const deployable = (id: string, wname: WName) => priced[id][wname]?.capitalDeployedUsd ?? 0;
      const deployableMax = (id: string) => Math.max(...WNAMES.map((w) => deployable(id, w)));
      const sets = SETS.map((set) => {
        const per: Record<string, unknown> = {};
        const scored: number[] = [];
        for (const wname of WNAMES) {
          const members = set.rows.filter((id) => priced[id][wname]);
          if (!members.length) { per[wname] = null; continue; }
          const capital = members.reduce((a, id) => a + deployable(id, wname), 0);
          const days = [...new Set(members.flatMap((id) => [...priced[id][wname]!.pnl.keys()]))].sort((a, b) => a - b);
          let eq = capital, peak = capital, maxDD = 0;
          for (const d of days) {
            for (const id of members) eq += priced[id][wname]!.pnl.get(d) ?? 0;
            peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
          }
          const ret = (eq - capital) / capital;
          const fills = members.reduce((a, id) => a + priced[id][wname]!.stats.fills, 0);
          const spanDays = Math.max(1, (days[days.length - 1] - days[0]) / 86400e3);
          per[wname] = {
            rows: members.length, capitalDeployableUsd: r2(capital), ret: r4(ret), maxDD: r4(maxDD),
            retOverDD: r2(ret / Math.max(0.05, maxDD)), pnlUsd: r2(eq - capital), fills, fillsPer90Days: r2(fills / spanDays * 90), days: days.length,
          };
          scored.push(r2(ret / Math.max(0.05, maxDD)));
        }
        const capRevx = set.rows.filter((id) => ROWS.find((r) => r.id === id)!.venue === "revx").reduce((a, id) => a + deployableMax(id), 0);
        const capKraken = set.rows.filter((id) => ROWS.find((r) => r.id === id)!.venue === "kraken").reduce((a, id) => a + deployableMax(id), 0);
        return {
          id: set.id, what: set.what, rows: set.rows, perWindow: per,
          worstWindowRetOverDD: scored.length ? Math.min(...scored) : 0,
          deployableUsd: { revx: r2(capRevx), kraken: r2(capKraken), total: r2(capRevx + capKraken) },
          fitsPaperCap: capRevx <= RISK_CAPS.paperExposureUsd && capKraken <= RISK_CAPS.paperExposureUsd,
        };
      }).sort((a, b) => b.worstWindowRetOverDD - a.worstWindowRetOverDD);
      perRule[reg.id] = { stopsLabel: reg.label, sets };
      for (const s of sets) console.log(`[${reg.id}] set ${s.id.padEnd(24)} worst ret/DD ${String(s.worstWindowRetOverDD).padStart(6)} | ${WNAMES.map((w) => { const x = (s.perWindow as Record<string, { ret: number } | null>)[w]; return `${w} ${x ? (x.ret * 100).toFixed(1) + "%" : "—"}`; }).join(" ")}`);
    }
    report.s4_sets = {
      note: "Sets combined from the SAME per-row daily dollar P&L the row table reports, at each row's deployable capital (a rotation row's $60 carries only $40 of deployable slots under the $20 order cap, which is where §3.10's $440 row capital and $400 deployable come from). Ranked by the WORST window, never averaged. `fitsPaperCap` reads `agent_risk.paper_exposure_usd`, which is per venue.",
      caps: RISK_CAPS, perStopRule: perRule,
    };
  }

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error(`backtest.ts changed during the run (${btHashStart.slice(0, 12)} → ${btHashEnd.slice(0, 12)}); re-run it`);
  report.sourceIntegrity = {
    backtestTsSha256: btHashStart, stableAcrossRun: true,
    note: "SHA-256 of `supabase/functions/agents/backtest.ts`, read at the start of the run and again at the end. This study imports its `run`, `runRotation`, `COSTS`, `spreadOf` and `stopsForKind`, so that file is an input: the hash says which version produced these numbers, and a run that straddled an edit would have thrown rather than written this file.",
  };
  report.publishedSleeve = {
    note: "`windows.json`'s own live-sleeve figures (shipped stop rule) against this harness's, window by window. This harness reaches them by a different route — calendar-mapped windows, a `runGate` that also logs trades, and a `combine` that also counts fills — so agreement is evidence that the arithmetic is the same rather than that the same code ran twice.",
    published: PUBLISHED_WINDOWS_SLEEVE,
    here: Object.fromEntries(WNAMES.map((w) => {
      const x = pricedByRule.shipped["trend-4h·revx"][w];
      return [w, x ? { ret: x.stats.ret, maxDD: x.stats.maxDD, retOverDD: x.stats.retOverDD } : null];
    })),
    deltas: Object.fromEntries(WNAMES.map((w) => {
      const x = pricedByRule.shipped["trend-4h·revx"][w], pub = PUBLISHED_WINDOWS_SLEEVE[w];
      return [w, x ? { dRet: r4(x.stats.ret - pub[0]), dMaxDD: r4(x.stats.maxDD - pub[1]), dRetOverDD: r2(x.stats.retOverDD - pub[2]) } : null];
    })),
  };

  const path = `${outDir}/testingset.json`;
  await Deno.writeTextFile(path, JSON.stringify(report, null, 1));
  console.log(`wrote ${path} in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
}
