// The JEV-VETO study: every backtest in this repository prices the RULEBOOK,
// and the account runs `rule ∧ Jev`. §4.21 counted the gap in the live record
// — 20 % of entry signals vetoed, two of the three vetoes at P(healthy) = 0.59
// against `enterMin` = 0.60 — and nothing had ever priced it. This study does,
// on the four walk-forward windows, for the row that is recommended for live.
// Run by hand:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_jev.ts \
//     --replay  measured                                  (the default; what jev.json holds)
//     --answers docs/agents/backtests/jev_answers.json   (the REAL model's 450 replies)
//     --data    <dir with BTC-USD_1h_3y.json …>          (Coinbase Exchange hourly)
//     --ext     <dir with BTC-USD_1h_kraken.json …>      (Kraken quarterly bundle, hourly)
//     --ktape   <dir with BTC-USD_4h_kraken.json …>      (Kraken's own 4h tape, §3.16/§3.19)
//     --set2    docs/agents/backtests/set2.json          (the incumbent on all four evaluations)
//     --out     docs/agents/backtests
//     [--draws 2000] [--null-draws 1000]
//
//   --replay recorded — the EARLIER study (2026-09-22 afternoon, commit
//                       944c36d): twelve recorded answers mapped onto history,
//                       the other cells ASSUMED from the question's wording. Kept
//                       runnable and unchanged so its numbers stay reproducible:
//                       with --data and --ext it rewrites that study's jev.json
//                       byte for byte (sha256 2e3ec025…). Nothing reads it now.
//   --replay live     — ask the real Jev from this process; needs
//                       OPENROUTER_API_KEY or TYPESAFE_API_KEY and --allow-net
//                       --allow-env. Recorded-mode report shape.
//
// Writes `<out>/jev.json` and NOTHING else. The measured mode is documented
// where it starts, below the recorded study ("THE MEASURED REPLAY"); the
// sections between here and there describe the recorded study, and the
// measured one reuses their `runGated`, `combine` and window cuts unchanged.
//
// ── what the model actually gates ─────────────────────────────────────
//
// `tick.ts` asks Jev on ENTRIES ONLY, hands it `snap.state` — the ten-word
// `CategoricalState`, no number, no date — and turns the answer into a
// decision with `combineDecision`, which is IMPORTED here and not
// re-implemented. An entry becomes a hold when P(healthy) < `enterMin`
// (0.60 on every row), when caution ≥ 1.75, or when the model does not
// answer. Exits are never touched.
//
// So the model's whole influence lives in a very small space. At an entry
// the rulebook has already forced trend_4h = up, breakout_4h = above_range,
// momentum_30d ≠ negative and volatility ≠ extreme, and the position is flat,
// which forces unrealised = none, time_in_position = none and
// drawdown_from_high = none. What is left free is
//
//     symbol (5) × trend_strength (3) × volatility (3) × momentum_30d (2)
//
// — ninety states for the five-coin row, and the model sees no more than
// that. A replay is therefore not thousands of calls; it is at most ninety
// distinct questions, and the answers can be cached by state exactly,
// because `askJev` is a function of the state and nothing else.
//
// ── the transport, and why the default arm is not a live replay ───────
//
// Jev is reachable from this project only with a key, and the keys live in
// Supabase's Edge secret store. `pg_net` can call the deployed `agents`
// function from inside Postgres with the vault's `cron_secret`, which is how
// the probe runs and how Jev was confirmed up on 2026-09-22 15:17 UTC on
// BOTH transports — but `?action=probe` asks its own hard-coded trivial
// state, and the deployed function exposes no action that answers an
// arbitrary one. Reaching Jev with historical states therefore needs either
// a secret in this process or new code in production, and this study does
// neither.
//
// What it does instead is use Jev's OWN RECORDED ANSWERS. Every decision the
// loop has ever made is in `agent_decisions` with its state, its questions
// and its answers, and the entry rows are exactly the states Jev has been
// asked about. Twelve of them exist. They are pasted in below verbatim, and
// they turn out to cover the cells that matter, because the answers are
// almost a function of (trend_strength, volatility) alone and are repeatable
// to ±0.01. `--replay live` asks the real model instead and is the arm to
// run the day a key is in hand; the two are reported the same way.
//
// ── what is imported and what is copied ───────────────────────────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `spreadOf` and `stopsForKind`,
// and `_shared/agents_strategy.ts`'s `buildSnapshot`, `ruleFor`,
// `combineDecision`, `jevQuestions`, `precompute`, `applyFill`, `FLAT` and
// `atrAt`, are IMPORTED. The veto is `combineDecision`, the live function,
// called with the live thresholds.
//
// ONE copy exists, `runGated`, taken from `backtest_windows.ts` — which took
// it from `run` line by line and proved it. It is here for the one thing
// `run` cannot express: a decision callback (the rulebook AND the model) and
// a mark at every bar, which the sleeve arithmetic needs. With the shipped
// decider it IS `run`, and `fidelity.runGated` is the proof — every coin ×
// window, return, drawdown and trades, and `fidelity.publishedSleeve` checks
// the whole thing against `windows.json`'s published w2 sleeve as well.
//
// `windowsOn`, `indexAtOrAfter`, `shippedDecider`, `combine`, `dailyMarks`,
// `dailyReturns`, `pick` and `score` are copied from `backtest_windows.ts`,
// which does not export them; the first two touch the calendar and the rest
// do arithmetic on OUTPUTS, touching no price and no fee.
//
// ── determinism ───────────────────────────────────────────────────────
//
// There is no `ran_at` field. Re-running over the same two data directories
// with the same arm writes `jev.json` byte for byte identical. A live replay
// records the model id, the provider and every answer it got, so the run is
// reproducible from the file even though the model is not.

import {
  applyFill, atrAt, buildSnapshot, combineDecision, DEFAULT_TREND, FLAT, jevQuestions, precompute, ruleFor,
  type Action, type Candle, type CategoricalState, type JevView, type Position, type Precomputed, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import { askJev } from "../_shared/jev.ts";
import {
  COSTS, resample, run, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]

// ───────────────────────────────────────────────────────── facts, not guesses

/** The row this study prices: `agent_strategies` id `trend-4h`, read 2026-09-22. */
const LIVE_CANDIDATE = { row: "trend-4h", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100, slots: 5 };
/** `agent_risk.max_order_usd`, as `backtest_windows.ts` pins it. */
const MAX_ORDER_USD = 20;
/** The live row's thresholds. `enterMin` is `agent_strategies.params.enterMin` on all three rows; `cautionExit` is `tick.ts`'s literal. */
const SHIPPED_ENTER_MIN = 0.6;
const CAUTION_EXIT = 1.75;

/** `backtest_windows.ts`'s overlap thresholds and in-sample floor, unchanged, so the windows are the same windows. */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
const MIN_IN_SAMPLE_DAYS = 180;
const MAX_LOOKBACK = 301;

/**
 * Jev's answers, as the LIVE LOOP recorded them. Every row of
 * `agent_decisions` with `rule_action = 'enter'`, read 2026-09-22 with
 *
 *   select id, strategy_id, symbol, bar_start, provider, model,
 *          state->>'trend_strength', state->>'breakout_4h',
 *          state->>'volatility', state->>'momentum_30d',
 *          (answers->'healthy_trend'->>'probability')::numeric,
 *          (answers->'caution'->>'score')::numeric,
 *          answers->'_state'->>'choice'
 *   from agent_decisions where rule_action = 'enter' order by bar_start;
 *
 * All twelve are `provider = openrouter`, `model =
 * typesafe/jev-1.13-20260917`, every echo correct, every state
 * trend_4h = up / position = flat / unrealised = none / time_in_position =
 * none / drawdown_from_high = none. §4.21 counts fifteen; the other three
 * were on rows migration `0044` deleted with their decisions.
 */
type Recorded = {
  id: number; strategy: string; symbol: string; barStart: string;
  strength: string; breakout: string; volatility: string; momentum: string;
  healthy: number; caution: number; echo: string; finalAction: string;
};
const RECORDED: Recorded[] = [
  { id: 1, strategy: "momentum-1d", symbol: "BTC/USD", barStart: "2026-09-19T00:00:00Z", strength: "weak", breakout: "inside_range", volatility: "low", momentum: "positive", healthy: 0.15, caution: 0, echo: "BTC/USD", finalAction: "hold" },
  { id: 2, strategy: "momentum-1d", symbol: "ETH/USD", barStart: "2026-09-19T00:00:00Z", strength: "moderate", breakout: "inside_range", volatility: "normal", momentum: "positive", healthy: 0.92, caution: 0, echo: "ETH/USD", finalAction: "enter" },
  { id: 3, strategy: "momentum-1d", symbol: "SOL/USD", barStart: "2026-09-19T00:00:00Z", strength: "moderate", breakout: "inside_range", volatility: "normal", momentum: "positive", healthy: 0.93, caution: 0, echo: "SOL/USD", finalAction: "enter" },
  { id: 45, strategy: "momentum-1d", symbol: "BTC/USD", barStart: "2026-09-20T00:00:00Z", strength: "moderate", breakout: "inside_range", volatility: "low", momentum: "positive", healthy: 0.92, caution: 0, echo: "BTC/USD", finalAction: "enter" },
  { id: 69, strategy: "trend-1h", symbol: "ETH/USD", barStart: "2026-09-21T00:00:00Z", strength: "moderate", breakout: "above_range", volatility: "normal", momentum: "positive", healthy: 0.95, caution: 0, echo: "ETH/USD", finalAction: "enter" },
  { id: 83, strategy: "trend-4h", symbol: "ETH/USD", barStart: "2026-09-21T00:00:00Z", strength: "moderate", breakout: "above_range", volatility: "normal", momentum: "positive", healthy: 0.94, caution: 0, echo: "ETH/USD", finalAction: "enter" },
  { id: 106, strategy: "trend-1h", symbol: "BTC/USD", barStart: "2026-09-21T08:00:00Z", strength: "moderate", breakout: "above_range", volatility: "normal", momentum: "positive", healthy: 0.95, caution: 0, echo: "BTC/USD", finalAction: "enter" },
  { id: 108, strategy: "trend-1h", symbol: "SOL/USD", barStart: "2026-09-21T08:00:00Z", strength: "moderate", breakout: "above_range", volatility: "high", momentum: "positive", healthy: 0.59, caution: 1, echo: "SOL/USD", finalAction: "hold" },
  { id: 118, strategy: "trend-4h", symbol: "BTC/USD", barStart: "2026-09-21T08:00:00Z", strength: "moderate", breakout: "above_range", volatility: "normal", momentum: "positive", healthy: 0.95, caution: 0, echo: "BTC/USD", finalAction: "enter" },
  { id: 120, strategy: "trend-4h", symbol: "SOL/USD", barStart: "2026-09-21T08:00:00Z", strength: "strong", breakout: "above_range", volatility: "high", momentum: "positive", healthy: 0.61, caution: 1, echo: "SOL/USD", finalAction: "enter" },
  { id: 131, strategy: "trend-1h", symbol: "SOL/USD", barStart: "2026-09-21T13:00:00Z", strength: "moderate", breakout: "above_range", volatility: "high", momentum: "positive", healthy: 0.59, caution: 1, echo: "SOL/USD", finalAction: "hold" },
  { id: 174, strategy: "trend-1h", symbol: "SOL/USD", barStart: "2026-09-21T20:00:00Z", strength: "moderate", breakout: "above_range", volatility: "normal", momentum: "positive", healthy: 0.95, caution: 0, echo: "SOL/USD", finalAction: "enter" },
];

// ───────────────────────────────────────────── the response surface Jev shows

/** The free part of an entry state — everything else is forced by the rulebook and by being flat. */
type CellKey = { strength: string; volatility: string; momentum: string; breakout: string };
const cellId = (c: CellKey) => `${c.strength}|${c.volatility}|${c.momentum}|${c.breakout}`;
const looseId = (c: CellKey) => `${c.strength}|${c.volatility}|${c.momentum}`;

type Surface = {
  /** P(healthy) and the caution score for a state, plus where the number came from. */
  at(state: CategoricalState): { healthy: number; caution: number; source: "recorded" | "recorded-loose" | "specified"; n: number };
  id: string;
  describe(): Record<string, unknown>;
};

/**
 * The surface built from `RECORDED`, with an explicitly pre-registered rule
 * for the cells the live record has not reached. The order of resolution is
 * fixed here, BEFORE any window was scored:
 *
 *  1. an exact cell (strength, volatility, momentum, breakout) → the median
 *     of the recorded answers in it;
 *  2. the same cell ignoring `breakout_4h` → the median of those. Justified
 *     by `jevQuestions`, whose text treats above_range and inside_range
 *     identically ("above_range or inside_range (never below_range)"), and
 *     by the record: moderate / normal is 0.92–0.93 inside_range and
 *     0.94–0.95 above_range;
 *  3. otherwise the question AS WRITTEN, which is the only thing that can be
 *     said about a cell nobody has asked about:
 *       momentum ≠ positive           → 0.15  (the text requires positive)
 *       trend_strength = weak         → 0.15  (the text requires moderate or
 *                                       strong; 0.15 is what weak scored)
 *       volatility = high             → 0.60  (between the two recorded
 *                                       high-volatility answers)
 *       otherwise                     → 0.95
 *     with caution 1 when volatility is high and 0 otherwise — the two
 *     values the record contains, neither of which reaches `cautionExit`.
 *
 * `forceHighVol`, `forceWeak` and `unseen` exist because two inferences carry
 * almost the whole result and each has to be priced on its own:
 *
 *   * the record puts the high-volatility cells at 0.59 and 0.61 — one
 *     hundredth either side of `enterMin` — and the model is repeatable only
 *     to about that (the same state answered 0.94 and 0.95 on two rows,
 *     minutes apart). A single number there would be a coin flip dressed as a
 *     measurement, so both sides are run;
 *   * `weak` rests on ONE recorded answer (0.15, at weak / low), plus the
 *     question's own text, and it decides a third of all historical entry
 *     signals. `forceWeak` switches it off; `unseen: "pass"` switches off
 *     every inference at once and leaves only what the record literally says.
 *
 * Strength is resolved before volatility, so a weak / high state is a weak
 * state, never a high-volatility one.
 */
type SurfaceOpts = { id: string; unseen: "specified" | "pass"; forceHighVol: number | null; forceWeak: number | null };
function makeSurface(o: SurfaceOpts): Surface {
  const exact = new Map<string, number[]>(), loose = new Map<string, number[]>();
  const exactC = new Map<string, number[]>(), looseC = new Map<string, number[]>();
  for (const r of RECORDED) {
    const k: CellKey = { strength: r.strength, volatility: r.volatility, momentum: r.momentum, breakout: r.breakout };
    (exact.get(cellId(k)) ?? exact.set(cellId(k), []).get(cellId(k))!).push(r.healthy);
    (loose.get(looseId(k)) ?? loose.set(looseId(k), []).get(looseId(k))!).push(r.healthy);
    (exactC.get(cellId(k)) ?? exactC.set(cellId(k), []).get(cellId(k))!).push(r.caution);
    (looseC.get(looseId(k)) ?? looseC.set(looseId(k), []).get(looseId(k))!).push(r.caution);
  }
  const med = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const fromRecord = (k: CellKey): { healthy: number; caution: number; source: "recorded" | "recorded-loose"; n: number } | null => {
    const e = exact.get(cellId(k));
    if (e) return { healthy: med(e), caution: med(exactC.get(cellId(k))!), source: "recorded", n: e.length };
    const l = loose.get(looseId(k));
    if (l) return { healthy: med(l), caution: med(looseC.get(looseId(k))!), source: "recorded-loose", n: l.length };
    return null;
  };
  return {
    id: o.id,
    at(state) {
      const k: CellKey = { strength: state.trend_strength, volatility: state.volatility, momentum: state.momentum_30d, breakout: state.breakout_4h };
      const isHigh = state.volatility === "high";
      const caution = isHigh ? 1 : 0;
      if (state.trend_strength === "weak") {
        if (o.forceWeak != null) return { healthy: o.forceWeak, caution, source: "specified", n: 0 };
        const rec = fromRecord(k);
        if (rec) return rec;
        return { healthy: o.unseen === "pass" ? 0.95 : 0.15, caution, source: "specified", n: 0 };
      }
      if (isHigh && o.forceHighVol != null) return { healthy: o.forceHighVol, caution, source: "specified", n: 0 };
      const rec = fromRecord(k);
      if (rec) return rec;
      if (o.unseen === "pass") return { healthy: 0.95, caution, source: "specified", n: 0 };
      if (state.momentum_30d !== "positive") return { healthy: 0.15, caution, source: "specified", n: 0 };
      if (isHigh) return { healthy: 0.6, caution, source: "specified", n: 0 };
      return { healthy: 0.95, caution, source: "specified", n: 0 };
    },
    describe() {
      return {
        id: o.id, unseenCells: o.unseen, forceHighVol: o.forceHighVol, forceWeak: o.forceWeak,
        recordedCells: [...exact.entries()].map(([k, v]) => ({ cell: k, n: v.length, healthy: med(v), answers: v.slice().sort((a, b) => a - b) })).sort((a, b) => a.cell < b.cell ? -1 : 1),
      };
    },
  };
}

/** A surface backed by real answers from `askJev`, keyed by the exact state. Only built under `--replay live`. */
function surfaceFromLive(id: string, answers: Map<string, { healthy: number; caution: number; n: number }>, fallback: Surface): Surface {
  return {
    id,
    at(state) {
      const hit = answers.get(JSON.stringify(state));
      return hit ? { healthy: hit.healthy, caution: hit.caution, source: "recorded", n: hit.n } : fallback.at(state);
    },
    describe() { return { id, liveStates: answers.size, fallback: fallback.describe() }; },
  };
}

// ───────────────────────────────────────────────────────────── the simulator

/**
 * A decision at bar `i` with the position as it stands. Monotonic in `i`.
 * `coolingDown` is `run`'s own re-entry test for this bar, handed over so a
 * decider can do what `tick.ts` does — turn a cooling-down entry into a hold
 * BEFORE the model is asked (tick.ts, the `REENTRY_BARS` branch). The recorded
 * study's deciders ignore it, which changes none of their numbers: an entry
 * signalled while cooling down is refused by `runGated` either way.
 */
type Decide = (i: number, pos: Position, coolingDown: boolean) => "enter" | "exit" | "hold";

type GatedResult = RunResult & { tradedWeight: number; marks: [number, number][]; entries: number };

/**
 * `backtest.ts`'s `run` with the rulebook replaced by a callback and a mark
 * at every bar. COPIED FROM `backtest_windows.ts`, which copied it from `run`
 * line by line; the `gate` argument is dropped because this study's gate is
 * the model, and the model belongs inside the decision, exactly where
 * `tick.ts` puts it. Everything that costs money is `run`'s: the entry and
 * rule exit at the next bar's open ± the half-spread paying `fillFee`; the
 * floor under average cost and the ATR trail from the high since entry, read
 * against the next bar's low and filled at the level (or the open when the
 * bar gaps through it); the high-water mark advanced by each bar's high; the
 * two-bar cooldown after ANY exit; and the same return, drawdown, trade,
 * exposure and day arithmetic.
 */
function runGated(
  symbol: string, bars: Candle[], from: number, to: number, warmup: number,
  decide: Decide, costs: Costs, stops: StopParams | null,
): GatedResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  let tradedWeight = 0, entries = 0;
  const marks: [number, number][] = [];
  const start = Math.max(from, warmup);
  for (let i = start; i < to - 1; i++) {
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    const action = decide(i, pos, coolingDown);
    const next = bars[i + 1];
    if (action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);
      const base = cash / (price * (1 + fill));
      const fee = base * price * fill;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++; tradedWeight += 1; entries++;
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
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit, tradedWeight, marks, entries,
  };
}

/** mulberry32 — a seeded PRNG, so the null below is a fixed number and not a new one each run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * THE NULL. A veto that refuses the same SHARE of entry signals as the model
 * does, and chooses which ones at random. It is the right control because the
 * alternative on trial is not "does refusing entries change the return" —
 * refusing entries always changes the return, and at 8–17 % deployment it
 * changes it a lot — but "does the model refuse the RIGHT ones". A result
 * inside this distribution says the model's contribution is its refusal rate
 * and nothing else.
 */
function randomDecider(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, barHours: number,
  refuseProb: number, rnd: () => number, count: { signals: number; refused: number },
): Decide {
  const pre = precompute(bars, p);
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos) => {
    const nowMs = bars[i].start + barHours * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    const snap = buildSnapshot(symbol, bars, i, closed, pos, nowMs, p, pre, (24 / barHours) * 365);
    const rule = ruleFor(kind, snap, pos, p);
    if (rule.action !== "enter") return rule.action;
    count.signals++;
    if (rnd() < refuseProb) { count.refused++; return "hold"; }
    return "enter";
  };
}

/** An entry signal the rulebook produced, with the state the model would have been shown. */
type Signal = { bar: number; barStart: number; state: CategoricalState; healthy: number; caution: number; source: string; vetoed: boolean };

/**
 * The shipped decision at each bar — `buildSnapshot` + `ruleFor`, the pair
 * `run` itself calls — optionally with the model's vote applied through
 * `combineDecision`, exactly as `tick.ts` applies it. Copied from
 * `backtest_windows.ts`'s `shippedDecider` and extended with the model; with
 * `surface` null it IS `shippedDecider`.
 */
function decider(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, barHours: number,
  surface: Surface | null, enterMin: number, log: Signal[] | null,
): Decide {
  const pre = precompute(bars, p);
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos) => {
    const nowMs = bars[i].start + barHours * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    const snap = buildSnapshot(symbol, bars, i, closed, pos, nowMs, p, pre, (24 / barHours) * 365);
    const rule = ruleFor(kind, snap, pos, p);
    if (rule.action !== "enter") return rule.action;
    if (!surface) { if (log) log.push({ bar: i, barStart: bars[i].start, state: snap.state, healthy: NaN, caution: NaN, source: "not-asked", vetoed: false }); return "enter"; }
    const a = surface.at(snap.state);
    const view: JevView = { healthy: a.healthy, caution: a.caution, echoOk: true, provider: "openrouter" };
    const final = combineDecision(rule, view, { enterMin, cautionExit: CAUTION_EXIT });
    if (log) log.push({ bar: i, barStart: bars[i].start, state: snap.state, healthy: a.healthy, caution: a.caution, source: a.source, vetoed: final.action !== "enter" });
    return final.action;
  };
}

// ─────────────────────────────────────────────────────── arithmetic on outputs

/** The last mark of each UTC day. Copied from `backtest_windows.ts`. */
function dailyMarks(equity: [number, number][]): { day: number; eq: number }[] {
  const m = new Map<number, number>();
  for (const [t, e] of equity) m.set(Math.floor(t / 86400e3) * 86400e3, e);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, eq]) => ({ day, eq }));
}
/** A sleeve's daily FRACTIONAL returns. Copied from `backtest_windows.ts`. */
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

/** Combine sleeves at their slot sizes. Copied from `backtest_windows.ts`'s `combine`. */
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

function score(r: { ret: number; maxDD: number }): number { return r.ret / Math.max(0.05, r.maxDD); }
function pick(r: RunResult) {
  return {
    ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)), retOverDD: Number(score(r).toFixed(2)),
    trades: r.trades, days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)), stopsHit: r.stopsHit ?? 0,
  };
}

// ──────────────────────────────────────────────────────── the data and splice

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const toCandles = (raw: Raw[]): Candle[] => raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const quantile = (xs: number[], q: number) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

/** The bar at or after `ts`. Copied from `backtest_windows.ts`. */
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

/** The four windows on the COMBINED series. Copied from `backtest_windows.ts`'s `windowsOn`, unchanged. */
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

/** The EARLIER study, unchanged: `--replay recorded` (and `--replay live`). Rewrites commit 944c36d's jev.json byte for byte. */
async function recordedStudy(args: Record<string, string>): Promise<void> {
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), outDir = String(args.out ?? "docs/agents/backtests");
  const replayLive = String(args.replay ?? "") === "live";
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  if (!extDir) throw new Error("--ext <dir with BTC-USD_1h_kraken.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });

  const btPath = new URL("./backtest.ts", import.meta.url);
  const sha = async (u: URL) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(u));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btHashStart = await sha(btPath);
  const stops = stopsForKind("trend-4h", DEFAULT_TREND);   // what tick.ts runs today: the 8 % floor, no intra-bar trail

  // ── splice, verify, cut the windows ────────────────────────────────────
  type Series = { c4h: Candle[]; daily: Candle[]; cb4h: Candle[]; cbDaily: Candle[]; wins: Win[] };
  const series: Record<string, Series> = {};
  const provenance: Record<string, unknown>[] = [];
  const symbols: string[] = [];
  for (const symbol of LIVE_CANDIDATE.symbols) {
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
    for (const c of cb4hAll) { if (c.start > kLast) continue; const k = k4hByTs.get(c.start); if (k && c.close > 0) diffs4h.push(Math.abs(k.close / c.close - 1) * 1e4); }
    const overlap = diffs4h.length >= 100 && hourlyDiffs.length >= 100
      ? { bars4h: diffs4h.length, median4hBps: Number(median(diffs4h).toFixed(2)), p954hBps: Number(quantile(diffs4h, 0.95).toFixed(2)), max4hBps: Number(Math.max(...diffs4h).toFixed(2)) }
      : null;
    const extension = kH.filter((c) => c.start < spliceAt);
    const combH = [...extension, ...cbH];
    const comb4h = resample(combH, 4), combDaily = resample(combH, 24), cbDaily = resample(cbH, 24);
    const wins = windowsOn(comb4h, cb4hAll, MAX_LOOKBACK);
    const rejected: string[] = [];
    if (!overlap) rejected.push(`overlap is ${diffs4h.length} 4h bars — too few to verify`);
    else {
      if (overlap.median4hBps > OVERLAP_MEDIAN_MAX_BPS) rejected.push(`overlap median ${overlap.median4hBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`);
      if (overlap.p954hBps > OVERLAP_P95_MAX_BPS) rejected.push(`overlap p95 ${overlap.p954hBps} bps > ${OVERLAP_P95_MAX_BPS}`);
    }
    provenance.push({
      symbol, coinbase: { bars: cbH.length, first: iso(cbH[0].start), last: iso(cbH[cbH.length - 1].start), bars4h: cb4hAll.length },
      spliceAtIso: iso(spliceAt), overlap,
      extension: { bars: extension.length, first: extension.length ? iso(extension[0].start) : "", years: Number((extension.length ? (spliceAt - extension[0].start) / YEAR_MS : 0).toFixed(2)) },
      combined: { bars4h: comb4h.length, first: iso(combH[0].start), last: iso(combH[combH.length - 1].start) },
      windowsScored: wins.filter((w) => w.scored).map((w) => w.name), accepted: rejected.length === 0, rejected,
    });
    series[symbol] = { c4h: comb4h, daily: combDaily, cb4h: cb4hAll, cbDaily, wins };
    if (rejected.length === 0) symbols.push(symbol);
    console.log(`${symbol.padEnd(9)} overlap ${overlap ? `${overlap.bars4h} 4h bars, median ${overlap.median4hBps} bps` : "none"} | windows ${wins.filter((w) => w.scored).map((w) => w.name).join("") || "—"} | ${rejected.length ? "REJECTED" : "accepted"}`);
  }

  // ── the surfaces, and (optionally) the live replay ─────────────────────
  const central = makeSurface({ id: "central", unseen: "specified", forceHighVol: null, forceWeak: null });
  const highVeto = makeSurface({ id: "highvol-vetoed", unseen: "specified", forceHighVol: 0.59, forceWeak: null });
  const highPass = makeSurface({ id: "highvol-passed", unseen: "specified", forceHighVol: 0.61, forceWeak: null });
  // Attribution: the two inferences that carry the result, each switched off in turn.
  const weakOnly = makeSurface({ id: "weak-veto-only", unseen: "specified", forceHighVol: 0.95, forceWeak: null });
  const highOnly = makeSurface({ id: "highvol-veto-only", unseen: "specified", forceHighVol: null, forceWeak: 0.95 });
  const recordedOnly = makeSurface({ id: "recorded-cells-only", unseen: "pass", forceHighVol: null, forceWeak: null });

  // Every entry state the five-coin row can reach. The rulebook forces four of the
  // ten fields and being flat forces three more, so this is the WHOLE space the
  // model is ever shown on an entry — ninety states, which is what a live replay
  // would have to ask and no more.
  const ENTRY_SPACE: CategoricalState[] = [];
  for (const symbol of LIVE_CANDIDATE.symbols) {
    for (const trend_strength of ["weak", "moderate", "strong"] as const) {
      for (const volatility of ["low", "normal", "high"] as const) {
        for (const momentum_30d of ["positive", "unknown"] as const) {
          ENTRY_SPACE.push({
            symbol, trend_4h: "up", trend_strength, breakout_4h: "above_range", volatility,
            momentum_30d, position: "flat", unrealised: "none", time_in_position: "none", drawdown_from_high: "none",
          });
        }
      }
    }
  }

  let surface: Surface = central;
  const replay: Record<string, unknown> = { mode: replayLive ? "live" : "recorded", entryStateSpace: ENTRY_SPACE.length, calls: 0, distinctStates: 0 };
  if (replayLive) {
    const env = { openrouterKey: Deno.env.get("OPENROUTER_API_KEY") ?? Deno.env.get("openrouter_api_key") ?? undefined, typesafeKey: Deno.env.get("TYPESAFE_API_KEY") ?? Deno.env.get("typesafe_API_KEY") ?? undefined };
    if (!env.openrouterKey && !env.typesafeKey) throw new Error("--replay live needs OPENROUTER_API_KEY or TYPESAFE_API_KEY in the environment");
    const REPEATS = 5;   // the model is repeatable only to about ±0.01; the spread is measured, not assumed
    const live = new Map<string, { healthy: number; caution: number; n: number }>();
    const raw: Record<string, unknown>[] = [];
    let calls = 0, cost = 0;
    for (const state of ENTRY_SPACE) {
      const hs: number[] = [], cs: number[] = []; let echoBad = 0, provider = "", model = "";
      for (let k = 0; k < REPEATS; k++) {
        const r = await askJev(state as unknown as Record<string, unknown>, jevQuestions(state), env);
        calls++; cost += r.costUsd; provider = r.provider; model = r.model ?? "";
        const a = r.answers;
        const h = a.healthy_trend?.type === "noul" ? a.healthy_trend.probability : null;
        const c = a.caution?.type === "score" ? a.caution.score : null;
        const echoOk = a._state?.type === "choice" ? a._state.choice === state.symbol : false;
        if (!echoOk) echoBad++;
        if (h != null && echoOk) { hs.push(h); cs.push(c ?? 0); }
      }
      if (hs.length) live.set(JSON.stringify(state), { healthy: median(hs), caution: median(cs), n: hs.length });
      raw.push({ state, answers: hs, caution: cs, echoMismatches: echoBad, provider, model });
    }
    surface = surfaceFromLive("live-replay", live, central);
    replay.calls = calls; replay.distinctStates = live.size; replay.repeats = REPEATS;
    replay.costUsd = Number(cost.toFixed(6)); replay.raw = raw;
  }

  // ── fidelity: the copy is `run`, and the rule arm is the published sleeve ──
  const fidelity: Record<string, unknown> = {};
  let fChecks = 0, fRet = 0, fDD = 0, fTrades = 0;
  const ruleResult: Record<string, Record<string, GatedResult>> = {};
  const ruleSignals: Record<string, Record<string, Signal[]>> = {};
  for (const symbol of symbols) {
    const { c4h, daily, wins } = series[symbol];
    ruleResult[symbol] = {}; ruleSignals[symbol] = {};
    for (const w of wins.filter((x) => x.scored)) {
      const log: Signal[] = [];
      const g = runGated(symbol, c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1,
        decider("trend-4h", symbol, c4h, daily, DEFAULT_TREND, 4, null, SHIPPED_ENTER_MIN, log), COSTS.revx, stops);
      const r = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 4, stops);
      fChecks++;
      fRet = Math.max(fRet, Math.abs(g.ret - r.ret)); fDD = Math.max(fDD, Math.abs(g.maxDD - r.maxDD)); fTrades = Math.max(fTrades, Math.abs(g.trades - r.trades));
      ruleResult[symbol][w.name] = g; ruleSignals[symbol][w.name] = log;
    }
  }
  fidelity.runGated = { checks: fChecks, worstAbsRetDiff: fRet, worstAbsMaxDDDiff: fDD, worstAbsTradeDiff: fTrades, what: "runGated with the shipped decider against backtest.ts's `run`, every coin × window, seeded parameters, Revolut X costs, the shipped stop rule" };

  // ── the sleeve, per window, per arm ────────────────────────────────────
  const SLOT = Math.min(LIVE_CANDIDATE.capitalUsd / LIVE_CANDIDATE.slots, MAX_ORDER_USD);
  const WINDOWS = ["A", "B", "C", "D"] as const;

  type ArmRun = { per: Record<string, GatedResult>; signals: Record<string, Signal[]> };
  const armCache = new Map<string, ArmRun>();
  function runArm(key: string, wname: string, surf: Surface | null, enterMin: number): ArmRun {
    const ck = `${key}|${wname}`;
    const hit = armCache.get(ck);
    if (hit) return hit;
    const per: Record<string, GatedResult> = {}, signals: Record<string, Signal[]> = {};
    for (const symbol of symbols) {
      const { c4h, daily, wins } = series[symbol];
      const w = wins.find((x) => x.name === wname && x.scored);
      if (!w) continue;
      if (surf == null) { per[symbol] = ruleResult[symbol][wname]; signals[symbol] = ruleSignals[symbol][wname]; continue; }
      const log: Signal[] = [];
      per[symbol] = runGated(symbol, c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1,
        decider("trend-4h", symbol, c4h, daily, DEFAULT_TREND, 4, surf, enterMin, log), COSTS.revx, stops);
      signals[symbol] = log;
    }
    const out = { per, signals };
    armCache.set(ck, out);
    return out;
  }

  const sleeveOf = (per: Record<string, GatedResult>): SleeveStats => combine(Object.entries(per).map(([s, r]) => ({
    id: `trend-4h·revx·${s.split("/")[0]}`, symbol: s, slotUsd: SLOT, rets: dailyReturns(r.marks),
    ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * SLOT,
  })));

  // The rule arm first, and the published sleeve beside it.
  const PUBLISHED: Record<string, { ret: number; maxDD: number; capitalUsd: number }> = {
    A: { ret: 0.0803, maxDD: 0.1128, capitalUsd: 100 }, B: { ret: 0.2008, maxDD: 0.1047, capitalUsd: 100 },
    C: { ret: 0.5564, maxDD: 0.0735, capitalUsd: 80 }, D: { ret: -0.0781, maxDD: 0.1552, capitalUsd: 80 },
  };
  const publishedCheck: Record<string, unknown> = {};
  const ruleSleeve: Record<string, SleeveStats> = {};
  for (const w of WINDOWS) {
    const arm = runArm("rule", w, null, SHIPPED_ENTER_MIN);
    if (!Object.keys(arm.per).length) continue;
    const s = sleeveOf(arm.per);
    ruleSleeve[w] = s;
    publishedCheck[w] = { published: PUBLISHED[w], here: { ret: s.ret, maxDD: s.maxDD, capitalUsd: s.capitalUsd }, absRetDiff: Number(Math.abs(s.ret - PUBLISHED[w].ret).toFixed(6)), absMaxDDDiff: Number(Math.abs(s.maxDD - PUBLISHED[w].maxDD).toFixed(6)) };
  }
  fidelity.publishedSleeve = { what: "the rule arm's sleeve against windows.json's perStopRule.shipped.w2_liveCandidate, which is what go-live.md §4 quotes", perWindow: publishedCheck };

  // ── (a) the veto rate on the RULE's own entry signals ──────────────────
  // The live measurement's analogue: take the path the rulebook takes on its
  // own, and count how many of its entry signals the model would refuse. The
  // sleeve arithmetic below is a different question, because a refused entry
  // moves everything after it.
  const vetoRate: Record<string, unknown> = {};
  for (const arm of [central, highVeto, highPass, weakOnly, highOnly, recordedOnly]) {
    const perWindow: Record<string, unknown> = {};
    for (const w of WINDOWS) {
      const perCoin: Record<string, unknown> = {};
      let n = 0, v = 0, spec = 0;
      for (const symbol of symbols) {
        const sigs = ruleSignals[symbol][w];
        if (!sigs) continue;
        let cn = 0, cv = 0, cs = 0;
        const cells: Record<string, { n: number; vetoed: number; healthy: number; source: string }> = {};
        for (const s of sigs) {
          const a = arm.at(s.state);
          const view: JevView = { healthy: a.healthy, caution: a.caution, echoOk: true, provider: "openrouter" };
          const vetoed = combineDecision({ action: "enter", reason: "" }, view, { enterMin: SHIPPED_ENTER_MIN, cautionExit: CAUTION_EXIT }).action !== "enter";
          const key = `${s.state.trend_strength}|${s.state.volatility}|${s.state.momentum_30d}`;
          cells[key] ??= { n: 0, vetoed: 0, healthy: a.healthy, source: a.source };
          cells[key].n++; if (vetoed) cells[key].vetoed++;
          cn++; if (vetoed) cv++; if (a.source === "specified") cs++;
        }
        if (cn) perCoin[symbol] = { signals: cn, vetoed: cv, vetoRate: Number((cv / cn).toFixed(3)), onSpecifiedCell: cs, cells };
        n += cn; v += cv; spec += cs;
      }
      perWindow[w] = n ? { signals: n, vetoed: v, vetoRate: Number((v / n).toFixed(3)), onSpecifiedCell: spec, perCoin } : { signals: 0 };
    }
    (vetoRate as Record<string, unknown>)[arm.id] = perWindow;
  }

  // ── (b) rule vs rule ∧ Jev, per window, never averaged ─────────────────
  const arms: { id: string; surf: Surface | null; enterMin: number }[] = [
    { id: "rule", surf: null, enterMin: SHIPPED_ENTER_MIN },
    { id: `rule∧Jev(${surface.id})`, surf: surface, enterMin: SHIPPED_ENTER_MIN },
    { id: "rule∧Jev(highvol-vetoed)", surf: highVeto, enterMin: SHIPPED_ENTER_MIN },
    { id: "rule∧Jev(highvol-passed)", surf: highPass, enterMin: SHIPPED_ENTER_MIN },
    { id: "rule∧Jev(weak-veto-only)", surf: weakOnly, enterMin: SHIPPED_ENTER_MIN },
    { id: "rule∧Jev(highvol-veto-only)", surf: highOnly, enterMin: SHIPPED_ENTER_MIN },
    { id: "rule∧Jev(recorded-cells-only)", surf: recordedOnly, enterMin: SHIPPED_ENTER_MIN },
  ];
  const headline: Record<string, unknown> = {};
  for (const a of arms) {
    const perWindow: Record<string, unknown> = {};
    for (const w of WINDOWS) {
      const arm = runArm(a.id, w, a.surf, a.enterMin);
      if (!Object.keys(arm.per).length) { perWindow[w] = { scored: false }; continue; }
      const s = sleeveOf(arm.per);
      const base = ruleSleeve[w];
      perWindow[w] = {
        sleeve: s,
        deltaRet: Number((s.ret - base.ret).toFixed(4)),
        deltaPnlUsd: Number((s.pnlUsd - base.pnlUsd).toFixed(2)),
        deltaMaxDD: Number((s.maxDD - base.maxDD).toFixed(4)),
        deltaRetOverDD: Number((s.retOverDD - base.retOverDD).toFixed(2)),
        perCoin: Object.fromEntries(symbols.filter((x) => arm.per[x]).map((x) => [x, {
          ...pick(arm.per[x]),
          entriesRefused: (arm.signals[x] ?? []).filter((g) => g.vetoed).length,
          entrySignals: (arm.signals[x] ?? []).length,
          ruleRet: Number(ruleResult[x][w].ret.toFixed(4)),
          deltaRet: Number((arm.per[x].ret - ruleResult[x][w].ret).toFixed(4)),
        }])),
      };
    }
    const scored = WINDOWS.filter((w) => (perWindow[w] as { sleeve?: SleeveStats }).sleeve);
    const worst = scored.length ? Math.min(...scored.map((w) => (perWindow[w] as { sleeve: SleeveStats }).sleeve.ret)) : null;
    headline[a.id] = { perWindow, worstWindowRet: worst, worstWindow: scored.find((w) => (perWindow[w] as { sleeve: SleeveStats }).sleeve.ret === worst) ?? null };
  }

  // ── the null: the same refusal rate, chosen at random ──────────────────
  const DRAWS = 400;
  const nullBlock: Record<string, unknown> = {
    what: `${DRAWS} draws per window of a veto that refuses each entry signal independently with the probability the model's own veto rate implies on that window (measured on the rulebook's own path, the same number reported in vetoRateOnRuleSignals.central), seeded so the figures are fixed`,
    draws: DRAWS, perWindow: {} as Record<string, unknown>,
  };
  for (const w of WINDOWS) {
    const rate = (vetoRate as Record<string, Record<string, { vetoRate?: number; signals: number }>>)["central"][w];
    if (!rate.signals) continue;
    const p = rate.vetoRate ?? 0;
    const rets: number[] = [];
    let sigSum = 0, refSum = 0;
    for (let k = 0; k < DRAWS; k++) {
      const per: Record<string, GatedResult> = {};
      for (const symbol of symbols) {
        const { c4h, daily, wins } = series[symbol];
        const win = wins.find((x) => x.name === w && x.scored);
        if (!win) continue;
        const count = { signals: 0, refused: 0 };
        const rnd = mulberry32(0x5eed0000 + k * 1000 + symbols.indexOf(symbol) * 7 + w.charCodeAt(0));
        per[symbol] = runGated(symbol, c4h, win.oosFrom, win.oosTo, DEFAULT_TREND.slow + 1,
          randomDecider("trend-4h", symbol, c4h, daily, DEFAULT_TREND, 4, p, rnd, count), COSTS.revx, stops);
        sigSum += count.signals; refSum += count.refused;
      }
      rets.push(sleeveOf(per).ret);
    }
    const sorted = rets.slice().sort((a, b) => a - b);
    const jevRet = (headline[`rule∧Jev(${surface.id})`] as { perWindow: Record<string, { sleeve?: SleeveStats }> }).perWindow[w].sleeve!.ret;
    const below = sorted.filter((r) => r < jevRet).length;
    (nullBlock.perWindow as Record<string, unknown>)[w] = {
      refuseProb: Number(p.toFixed(3)),
      realisedRefusalShare: Number((refSum / Math.max(1, sigSum)).toFixed(3)),
      ruleRet: ruleSleeve[w].ret, jevRet: Number(jevRet.toFixed(4)),
      nullMean: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(4)),
      nullMedian: Number(sorted[Math.floor(sorted.length / 2)].toFixed(4)),
      nullP05: Number(sorted[Math.floor(0.05 * sorted.length)].toFixed(4)),
      nullP95: Number(sorted[Math.floor(0.95 * sorted.length)].toFixed(4)),
      nullMin: Number(sorted[0].toFixed(4)), nullMax: Number(sorted[sorted.length - 1].toFixed(4)),
      jevPercentile: Number((below / sorted.length).toFixed(3)),
      verdict: below / sorted.length <= 0.05 ? "the model's refusals are WORSE than random at the 5 % tail"
        : below / sorted.length >= 0.95 ? "the model's refusals are BETTER than random at the 5 % tail"
        : "inside the null — the refusal RATE explains it, the choice of which signals does not",
    };
    console.log(`null ${w}: rule ${(ruleSleeve[w].ret * 100).toFixed(1)}% | Jev ${(jevRet * 100).toFixed(1)}% | random veto median ${(sorted[Math.floor(sorted.length / 2)] * 100).toFixed(1)}% [p05 ${(sorted[Math.floor(0.05 * sorted.length)] * 100).toFixed(1)}%, p95 ${(sorted[Math.floor(0.95 * sorted.length)] * 100).toFixed(1)}%] → percentile ${(below / sorted.length * 100).toFixed(0)}`);
  }

  // ── (c) the enterMin surface ───────────────────────────────────────────
  // PRE-REGISTERED, written before any of it was scored: this is a SURFACE,
  // not a search. Nothing is recommended from it. The out-of-sample test
  // below is the only thing that could recommend anything, and its protocol
  // is fixed here: choose the enterMin with the best WORST window among
  // B, C and D; score that choice on window A alone — the most recent year,
  // and the one every published table already reports — and require it to
  // beat enterMin = 0.60's window A by more than the noise the model itself
  // shows (±0.01 on P, which moves nothing unless a cell crosses).
  const SCAN = [0.0, 0.5, 0.55, 0.6, 0.65, 0.7];
  const scanRows: Record<string, unknown>[] = [];
  for (const em of SCAN) {
    const per: Record<string, unknown> = {};
    for (const w of WINDOWS) {
      const arm = runArm(`scan${em}`, w, surface, em);
      if (!Object.keys(arm.per).length) { per[w] = null; continue; }
      const s = sleeveOf(arm.per);
      const sigs = symbols.flatMap((x) => arm.signals[x] ?? []);
      per[w] = { ret: s.ret, maxDD: s.maxDD, retOverDD: s.retOverDD, pnlUsd: s.pnlUsd, capitalUsd: s.capitalUsd, entrySignals: sigs.length, refused: sigs.filter((g) => g.vetoed).length };
    }
    const vals = WINDOWS.map((w) => per[w] as { ret: number } | null).filter((x): x is { ret: number } => x != null).map((x) => x.ret);
    scanRows.push({ enterMin: em, perWindow: per, worstWindowRet: vals.length ? Math.min(...vals) : null, worstWindow: WINDOWS.find((w) => per[w] && (per[w] as { ret: number }).ret === Math.min(...vals)) ?? null });
  }
  const choiceOn = (ws: readonly string[]) => {
    let best: { enterMin: number; worst: number } | null = null;
    for (const r of scanRows) {
      const vals = ws.map((w) => (r.perWindow as Record<string, { ret: number } | null>)[w]).filter((x): x is { ret: number } => x != null).map((x) => x.ret);
      if (!vals.length) continue;
      const worst = Math.min(...vals);
      if (!best || worst > best.worst) best = { enterMin: r.enterMin as number, worst };
    }
    return best;
  };
  const chosenBCD = choiceOn(["B", "C", "D"]);
  const rowFor = (em: number) => scanRows.find((r) => r.enterMin === em)!;
  const oosA = chosenBCD ? {
    protocol: "chosen on windows B, C and D by best WORST window; scored on window A alone, which the choice never saw. Fixed before the scan was run.",
    chosenEnterMin: chosenBCD.enterMin, chosenWorstOnBCD: Number(chosenBCD.worst.toFixed(4)),
    windowA_chosen: (rowFor(chosenBCD.enterMin).perWindow as Record<string, unknown>).A,
    windowA_shipped: (rowFor(SHIPPED_ENTER_MIN).perWindow as Record<string, unknown>).A,
    beatsShippedOnA: (() => {
      const a = (rowFor(chosenBCD.enterMin).perWindow as Record<string, { ret: number } | null>).A;
      const b = (rowFor(SHIPPED_ENTER_MIN).perWindow as Record<string, { ret: number } | null>).A;
      return a && b ? a.ret > b.ret : null;
    })(),
  } : null;

  // ── the entry-state census: what the model is actually shown ───────────
  const census: Record<string, { n: number; windows: Record<string, number>; coins: Record<string, number>; healthy: number; source: string }> = {};
  for (const symbol of symbols) {
    for (const w of WINDOWS) {
      for (const s of ruleSignals[symbol][w] ?? []) {
        const key = `${s.state.trend_strength}|${s.state.volatility}|${s.state.momentum_30d}`;
        const a = central.at(s.state);
        census[key] ??= { n: 0, windows: {}, coins: {}, healthy: a.healthy, source: a.source };
        census[key].n++;
        census[key].windows[w] = (census[key].windows[w] ?? 0) + 1;
        census[key].coins[symbol] = (census[key].coins[symbol] ?? 0) + 1;
      }
    }
  }

  // ── is the live 20–25 % consistent with the historical mix? ────────────
  // The live record is four days of a trending September: one of its twelve
  // entry states was weak-strength, where the historical entry mix is a third
  // weak. Both tails are reported rather than asserted, because "the live row
  // is 0 of 3" is the sentence §4.21 warns against reading as evidence.
  const totalSignals = Object.values(census).reduce((a, c) => a + c.n, 0);
  const weakShare = Object.entries(census).filter(([k]) => k.startsWith("weak|")).reduce((a, [, c]) => a + c.n, 0) / Math.max(1, totalSignals);
  const histVetoShare = Object.entries(census).filter(([, c]) => c.healthy < SHIPPED_ENTER_MIN).reduce((a, [, c]) => a + c.n, 0) / Math.max(1, totalSignals);
  const lnFact = (n: number) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const binomCdf = (k: number, n: number, p: number) => {
    let s = 0;
    for (let i = 0; i <= k; i++) s += Math.exp(lnFact(n) - lnFact(i) - lnFact(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
    return s;
  };
  const liveVeto = RECORDED.filter((r) => r.finalAction !== "enter").length;
  const liveWeak = RECORDED.filter((r) => r.strength === "weak").length;
  const liveVsHistorical = {
    historicalEntrySignals: totalSignals,
    historicalVetoShareAtShippedThreshold: Number(histVetoShare.toFixed(3)),
    historicalWeakShare: Number(weakShare.toFixed(3)),
    liveSignals: RECORDED.length, liveVetoed: liveVeto, liveWeakStates: liveWeak,
    pLiveVetoesAtMostThisFew: Number(binomCdf(liveVeto, RECORDED.length, histVetoShare).toFixed(4)),
    pLiveWeakStatesAtMostThisFew: Number(binomCdf(liveWeak, RECORDED.length, weakShare).toFixed(4)),
    reading: "the live record's low veto rate is what a four-day trending sample looks like: it contained almost no weak-strength entry states, and weak-strength is what the model refuses. Neither tail is small enough to call the live rate wrong; both are small enough that the live rate must not be projected forward.",
  };

  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error("backtest.ts changed while this study was running — rerun it");

  const report = {
    study: "the Jev veto, priced — `rule` against `rule ∧ Jev` for the row recommended for live, on four walk-forward windows, never averaged",
    row: LIVE_CANDIDATE,
    thresholds: { enterMin: SHIPPED_ENTER_MIN, cautionExit: CAUTION_EXIT, source: "agent_strategies.params.enterMin on all three live rows, read 2026-09-22; cautionExit is tick.ts's literal" },
    stops: { ...stops, what: "what stopsForKind returns at the moment of this run — the 8 % floor under average cost and no intra-bar ATR trail (reference §3.13)" },
    caveats: [
      "Jev was released 2026-09-17/18. It is in no historical data, and it has no memory. Asking today's model about a state computed from 2023 candles is legitimate — the state is ten categorical words, and the model cannot see a date — but it is NOT what the model would have said then, and nothing here should be read as if it were.",
      "The default arm does not call Jev. It replays the model's OWN RECORDED ANSWERS from `agent_decisions` (twelve entry rows, 2026-09-19 → 2026-09-21, provider openrouter, model typesafe/jev-1.13-20260917), resolved onto historical states by the pre-registered rule in `surfaceFromRecord`. `--replay live` asks the real model and is the arm to run when a key is in hand.",
      "`enterMin` is scanned to show the SURFACE. Choosing a threshold on the windows that scored it is in-sample optimisation, which §3.11 and §3.19 have already measured to be worse than the seeded point. The only thing here that could justify a move is `enterMinScan.outOfSample`, whose protocol was fixed before the scan ran.",
      "The model is repeatable to about ±0.01 (the same state answered 0.94 and 0.95 on two rows minutes apart), and the recorded high-volatility cells sit at 0.59 and 0.61 — one hundredth either side of enterMin. The `highvol-vetoed` and `highvol-passed` arms bracket that, and the bracket is the honest answer for a high-volatility regime.",
    ],
    windows: {
      note: "The same four windows `backtest_windows.ts` cuts, from the same splice: Kraken's hourly bundle strictly before the Coinbase series, Coinbase's from there on. A and B keep the exact calendar every published table used.",
      A: "parameters on the first two thirds, the LAST third out of sample (bear)",
      B: "parameters on the first third, the MIDDLE third out of sample (bull)",
      C: "parameters on the 24 months of extended history before the series, the FIRST third out of sample (strong bull)",
      D: "parameters on the 24 months before that, the 12 months before the series out of sample (sideways). D's scored year sits inside C's in-sample.",
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
    },
    liveRecord: {
      what: "every agent_decisions row with rule_action = 'enter', read 2026-09-22",
      rows: RECORDED.length, vetoed: RECORDED.filter((r) => r.finalAction !== "enter").length,
      vetoRate: Number((RECORDED.filter((r) => r.finalAction !== "enter").length / RECORDED.length).toFixed(3)),
      note: "§4.21 counts 15 signals and 3 vetoes (20 %); migration 0044 has since deleted three of those rows with their strategies, so the surviving record is 12 and 3.",
      byRow: Object.fromEntries([...new Set(RECORDED.map((r) => r.strategy))].map((s) => {
        const rs = RECORDED.filter((r) => r.strategy === s);
        return [s, { signals: rs.length, vetoed: rs.filter((r) => r.finalAction !== "enter").length }];
      })),
      answers: RECORDED,
    },
    surfaces: {
      central: central.describe(), highVolVetoed: highVeto.describe(), highVolPassed: highPass.describe(),
      weakVetoOnly: weakOnly.describe(), highVolVetoOnly: highOnly.describe(), recordedCellsOnly: recordedOnly.describe(),
    },
    entryStateSpace: { size: ENTRY_SPACE.length, why: "the rulebook forces trend_4h = up, breakout_4h = above_range, momentum_30d ≠ negative and volatility ≠ extreme on an entry, and a flat position forces unrealised, time_in_position and drawdown_from_high to none — so the model is only ever shown symbol × trend_strength × volatility × momentum_30d" },
    replay,
    data: provenance,
    fidelity,
    vetoRateOnRuleSignals: vetoRate,
    entryStateCensus: census,
    liveVsHistorical,
    sleeve: headline,
    randomVetoNull: nullBlock,
    armsLookedAt: {
      sleeveArms: arms.length, enterMinPoints: SCAN.length,
      distinctDecisionRules: "eight: the rulebook alone (= enterMin 0), the central surface at 0.5/0.55 (identical), at 0.6, at 0.65/0.7 (identical), and the four attribution surfaces at 0.6",
      note: "nothing here is adopted, so there is nothing to correct for multiplicity: the PRIMARY comparison is one pre-specified pair — the rulebook against the rulebook ∧ the model at the threshold the three live rows actually carry. The scan is reported as a surface and its only decision-shaped output, `enterMinScan.outOfSample`, follows a protocol fixed before it ran. The null for the primary comparison is `randomVetoNull`.",
    },
    enterMinScan: { note: "a surface, not a search — read `caveats`", scanned: SCAN, rows: scanRows, outOfSample: oosA },
    sourceIntegrity: { backtestTsSha256: btHashStart },
  };

  await Deno.writeTextFile(`${outDir}/jev.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/jev.json`);
  for (const w of WINDOWS) {
    const base = ruleSleeve[w];
    if (!base) continue;
    const line = arms.map((a) => {
      const p = (headline[a.id] as { perWindow: Record<string, { sleeve?: SleeveStats }> }).perWindow[w];
      return p.sleeve ? `${a.id} ${(p.sleeve.ret * 100).toFixed(1)}%` : `${a.id} —`;
    }).join(" | ");
    console.log(`${w}: ${line}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// THE MEASURED REPLAY — `--replay measured`, what `jev.json` holds from the
// evening of 2026-09-22
// ══════════════════════════════════════════════════════════════════════════════
//
// The model was ASKED. At 18:29 UTC on 2026-09-22 the read-only
// `POST agents?action=jev` put every one of the ninety entry states to the real
// model (OpenRouter, `typesafe/jev-1.13-20260917`) five times: 450 replies, no
// missing answer, no echo failure, saved verbatim in `jev_answers.json` with the
// md5 of their canonical form, computed once in SQL over the raw responses and
// again over the file. So nothing below maps twelve answers onto history or
// reads an answer off the question's wording. At every historical entry signal
// the model's answer is a DRAW from the five replies the real model gave to that
// exact state, and the entry goes through `combineDecision` — the live
// function — at the live thresholds. Where all five replies sit on one side of
// the threshold the draw is deterministic; where they straddle it (the
// high-volatility states, measured at 0.55–0.64) the draw IS the model's
// behaviour, and the result is a distribution and is reported as one.
//
// THE THREE CONFIGURATIONS the go-live decision chooses between:
//   (i)   the rulebook with the model in SHADOW — asked and recorded, never
//         gating: `combineDecision(…, gate = false)`, the branch `tick.ts` runs
//         when `params.jevGate === false`. Run WITH real draws and verified
//         identical to the rulebook, cell for cell;
//   (ii)  rule ∧ the model as it runs today (`enterMin` 0.60) — the Monte Carlo;
//   (iii) the rulebook plus the prompt's weak-trend clause written as CODE:
//         enter only when trend_strength ≠ weak. The prompt's momentum clause
//         is priced beside it and changes nothing, because momentum is never
//         `unknown` on a historical entry.
// Each on the four windows under the four evaluations §3.19 requires of a
// change — the Coinbase-spliced tape and Kraken's own 4h tape × the shipped
// stop (the 8 % floor) and the 3×ATR(14) intra-bar trail — never averaged.
//
// THE NULLS. Refusing entries always changes the return, so the question is
// whether a veto refuses the RIGHT ones. The earlier study's null refused each
// entry SIGNAL independently at the model's rate; but a refused signal leaves
// the row flat, and the rulebook fires again on the next bar whenever the
// breakout still holds, so that null mostly DELAYS entries by a bar where the
// model's weak-trend veto — sticky, because trend strength moves slowly —
// removes them. The two are not the same intensity; `earlierStudy.null`
// counts the difference. The null read here refuses whole breakout EPISODES (a
// maximal run of consecutive entry signals) at random, with the episode-refusal
// probability calibrated by bisection so that the null takes, on average, the
// same number of entries as the arm it controls. The old construction is kept
// beside it (`signalNull`). "Beats its null" means the null does as well or
// better in at most 5 % of draws — per window, and on the WORST window, which
// is how §3.11 ranks an arm.
//
// WHAT IS IMPORTED AND WHAT IS NOT. `run`, `COSTS`, `SHIPPED_STOPS`,
// `stopsForKind`, `resample` and `spreadOf` come from `backtest.ts`;
// `buildSnapshot`, `ruleFor`, `combineDecision`, `precompute`, `applyFill` and
// `FLAT` from the rulebook. The one copy of `run` is still `runGated`, and the
// one new piece of machinery is a CACHE: while the row is flat, `buildSnapshot`
// and `ruleFor` are functions of the bar alone (a flat position forces
// unrealised, time_in_position and drawdown_from_high to none, and
// `ruleDecision` reads nothing else when flat), so each bar's flat decision is
// computed once per track and reused, while a long bar still calls both
// functions fresh with the position as it stands. It is checked on every coin ×
// window × evaluation × venue: `runGated` through the cache against `run`,
// field for field (return, drawdown, trades, days, exposure, realised, fees,
// stops, and every equity point `run` samples); and a second decider that calls
// `buildSnapshot` on EVERY bar and compares each flat bar with the cache.
//
// DETERMINISM. Every draw comes from a mulberry32 stream seeded by a hash of
// (purpose, evaluation, window, coin, draw), so a re-run over the same inputs
// writes `jev.json` byte for byte. No wall clock is written.

const BAR_HOURS = 4;
const BARS_PER_YEAR = (24 / BAR_HOURS) * 365;
type WinName = Win["name"];
const WIN_NAMES: readonly WinName[] = ["A", "B", "C", "D"];
const r4 = (x: number) => Number(x.toFixed(4));
const r3 = (x: number) => Number(x.toFixed(3));

/** FNV-1a over the joined parts: one seed per (purpose, evaluation, window, coin, draw). */
function seedOf(...parts: (string | number)[]): number {
  const s = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// ─────────────────────────────────────────────────────────────── the answers

/** One reply of the real model, exactly as `agents?action=jev` returned it. */
type Reply = { healthy: number; caution: number };
/** The four words an entry state is free to vary in. The other six are forced (`FORCED_ON_ENTRY`). */
type Words = { symbol: string; trend_strength: string; volatility: string; momentum_30d: string };
const stateKey = (s: Words) => `${s.symbol}|${s.trend_strength}|${s.volatility}|${s.momentum_30d}`;
const cellKey = (s: Words) => `${s.trend_strength}|${s.volatility}|${s.momentum_30d}`;
const STRENGTHS = ["weak", "moderate", "strong"] as const;
const VOLS = ["low", "normal", "high"] as const;
const MOMENTA = ["positive", "unknown"] as const;
/** What an entry forces: the rulebook (trend up, breakout above the range) and being flat (the other four). */
const FORCED_ON_ENTRY: Record<string, string> = {
  trend_4h: "up", breakout_4h: "above_range", position: "flat", unrealised: "none", time_in_position: "none", drawdown_from_high: "none",
};

type AnswerBook = {
  bySymbol: Map<string, Reply[]>;
  pooled: Map<string, Reply[]>;
  words: Map<string, Words>;
  provenance: Record<string, unknown>;
  replies: number;
};

/** Read `jev_answers.json` and refuse anything that is not exactly the ninety states, five echo-verified replies each. */
function loadAnswers(text: string): AnswerBook {
  const j = JSON.parse(text) as {
    provenance: Record<string, unknown>;
    states: (Words & { healthy: number[]; caution: number[]; echoOk: boolean })[];
  };
  const fixed = (j.provenance?.fixedFields ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(FORCED_ON_ENTRY)) {
    if (fixed[k] !== v) throw new Error(`answers: fixedFields.${k} is ${fixed[k]}, but an entry forces ${v}`);
  }
  const bySymbol = new Map<string, Reply[]>(), pooled = new Map<string, Reply[]>(), words = new Map<string, Words>();
  let replies = 0;
  for (const s of j.states) {
    if (!LIVE_CANDIDATE.symbols.includes(s.symbol)) throw new Error(`answers: ${s.symbol} is not on the live row`);
    if (!s.echoOk) throw new Error(`answers: an echo failed on ${stateKey(s)} — production reads that as no answer, a veto, and so must this`);
    if (s.healthy.length === 0 || s.healthy.length !== s.caution.length) throw new Error(`answers: ${stateKey(s)} has ${s.healthy.length} P values and ${s.caution.length} caution values`);
    const k = stateKey(s);
    if (bySymbol.has(k)) throw new Error(`answers: ${k} appears twice`);
    const rs = s.healthy.map((h, i) => ({ healthy: h, caution: s.caution[i] }));
    bySymbol.set(k, rs);
    words.set(k, { symbol: s.symbol, trend_strength: s.trend_strength, volatility: s.volatility, momentum_30d: s.momentum_30d });
    const c = cellKey(s);
    pooled.set(c, [...(pooled.get(c) ?? []), ...rs]);
    replies += rs.length;
  }
  for (const symbol of LIVE_CANDIDATE.symbols) {
    for (const st of STRENGTHS) for (const v of VOLS) for (const m of MOMENTA) {
      if (!bySymbol.has(`${symbol}|${st}|${v}|${m}`)) throw new Error(`answers: ${symbol}|${st}|${v}|${m} was never measured`);
    }
  }
  return { bySymbol, pooled, words, provenance: j.provenance, replies };
}

/** A state the model is consulted about must be inside the measured space, or the replay would be reading an answer nobody gave. */
function assertEntryState(s: CategoricalState): void {
  const rec = s as unknown as Record<string, string>;
  for (const [k, v] of Object.entries(FORCED_ON_ENTRY)) {
    if (rec[k] !== v) throw new Error(`an entry state with ${k} = ${rec[k]} is outside the measured space (an entry forces ${v})`);
  }
}

// ─────────────────────────────────────────────────── evaluations and tracks

type Tape = "coinbase" | "kraken";
type StopRule = "shipped" | "trail";
type Condition = { id: string; tape: Tape; stopRule: StopRule };
/** §3.19's four evaluations; the first is the one every published number uses. */
const CONDITIONS: readonly Condition[] = [
  { id: "shipped·coinbase", tape: "coinbase", stopRule: "shipped" },
  { id: "shipped·kraken", tape: "kraken", stopRule: "shipped" },
  { id: "trail·coinbase", tape: "coinbase", stopRule: "trail" },
  { id: "trail·kraken", tape: "kraken", stopRule: "trail" },
];
const PRIMARY = CONDITIONS[0];
/** `backtest_set2.ts`'s two stop rules: what `tick.ts` runs, and the floor plus the 3×ATR(14) intra-bar trail it ran until 2026-09-21. */
const stopsOf = (rule: StopRule, p: TrendParams): StopParams =>
  rule === "shipped" ? stopsForKind("trend-4h", p) : { ...SHIPPED_STOPS, atrStop: p.atrStop };

/** A flat bar where the rulebook says enter: its reason and the state the model would be shown. */
type FlatEntry = { action: Action; reason: string; state: CategoricalState };
/**
 * One coin × window × tape × parameter set, with the flat-bar cache: for every
 * scored bar, whether the rulebook enters when flat, the entry's state, and
 * how many daily candles had closed (so a long bar can rebuild the snapshot).
 */
type Track = {
  symbol: string; bars: Candle[]; daily: Candle[]; p: TrendParams;
  from: number; to: number; warmup: number; start: number; pre: Precomputed;
  flatEnter: Uint8Array; entries: Map<number, FlatEntry>; dkAt: Int32Array;
};

function buildTrack(symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, from: number, to: number): Track {
  const pre = precompute(bars, p);
  const warmup = p.slow + 1, start = Math.max(from, warmup), n = Math.max(0, to - 1 - start);
  const flatEnter = new Uint8Array(n), dkAt = new Int32Array(n);
  const entries = new Map<number, FlatEntry>();
  const closed: Candle[] = [];
  let dk = 0;
  for (let i = start; i < to - 1; i++) {
    const nowMs = bars[i].start + BAR_HOURS * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    dkAt[i - start] = dk;
    const snap = buildSnapshot(symbol, bars, i, closed, FLAT, nowMs, p, pre, BARS_PER_YEAR);
    const rule = ruleFor("trend-4h", snap, FLAT, p);
    if (rule.action === "exit") throw new Error(`${symbol} bar ${i}: the rulebook said exit while flat`);
    if (rule.action === "enter") {
      flatEnter[i - start] = 1;
      entries.set(i - start, { action: rule.action, reason: rule.reason, state: snap.state });
    }
  }
  return { symbol, bars, daily, p, from, to, warmup, start, pre, flatEnter, entries, dkAt };
}

type Rule = { action: Action; reason: string };
/** What happens to an entry the rulebook wants, at bar `i`, in state `state`. Consulted only where `tick.ts` would ask the model. */
type EntryPolicy = (i: number, state: CategoricalState, rule: Rule) => "enter" | "hold";
type PolicyFor = (symbol: string) => EntryPolicy;

/** The shipped decision through the cache. A long bar calls `buildSnapshot` + `ruleFor` fresh, with the real position. */
function trackDecider(t: Track, policy: EntryPolicy): Decide {
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos, coolingDown) => {
    const k = i - t.start;
    if (pos.base === 0) {
      if (t.flatEnter[k] === 0) return "hold";
      if (coolingDown) return "enter";   // refused by runGated; tick.ts holds before asking the model
      const f = t.entries.get(k)!;
      return policy(i, f.state, f);
    }
    const want = t.dkAt[k];
    while (dk < want) { closed.push(t.daily[dk]); dk++; }
    const snap = buildSnapshot(t.symbol, t.bars, i, closed, pos, t.bars[i].start + BAR_HOURS * 3600e3, t.p, t.pre, BARS_PER_YEAR);
    return ruleFor("trend-4h", snap, pos, t.p).action;
  };
}

/** The same decision WITHOUT the cache — `buildSnapshot` on every bar — comparing each flat bar with what the cache holds. */
function checkedDecider(t: Track, policy: EntryPolicy, tally: { flatBars: number; mismatches: number }): Decide {
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos, coolingDown) => {
    const nowMs = t.bars[i].start + BAR_HOURS * 3600e3;
    while (dk < t.daily.length && t.daily[dk].start + 86400e3 <= nowMs) { closed.push(t.daily[dk]); dk++; }
    const snap = buildSnapshot(t.symbol, t.bars, i, closed, pos, nowMs, t.p, t.pre, BARS_PER_YEAR);
    const rule = ruleFor("trend-4h", snap, pos, t.p);
    if (pos.base === 0) {
      const k = i - t.start;
      tally.flatBars++;
      const cached = t.flatEnter[k] === 1 ? t.entries.get(k) ?? null : null;
      const same = dk === t.dkAt[k] && (cached
        ? rule.action === "enter" && cached.reason === rule.reason && JSON.stringify(cached.state) === JSON.stringify(snap.state)
        : rule.action === "hold");
      if (!same) tally.mismatches++;
    }
    if (rule.action !== "enter" || coolingDown) return rule.action;
    return policy(i, snap.state, rule);
  };
}

// ─────────────────────────────────────────────────────────────── the policies

/** (i) and the rulebook: every entry the rulebook wants. */
const rulePolicy: EntryPolicy = () => "enter";
/** (iii): the prompt's clause as code — `trend_strength` moderate or strong, and optionally `momentum_30d` positive. */
function clausePolicy(withMomentum: boolean): EntryPolicy {
  return (_i, s) => s.trend_strength === "weak" || (withMomentum && s.momentum_30d !== "positive") ? "hold" : "enter";
}
/** The deterministic band above the coin flip, as code: weak trend or high volatility refused. */
const clauseHighVolPolicy: EntryPolicy = (_i, s) => s.trend_strength === "weak" || s.volatility === "high" ? "hold" : "enter";
/**
 * (ii) and (i): one of the model's measured replies to THIS state, drawn
 * uniformly, through the live `combineDecision`. `gate = false` is shadow mode.
 */
function jevPolicy(book: Map<string, Reply[]>, keyOf: (s: Words) => string, rng: () => number, enterMin: number, gate: boolean): EntryPolicy {
  return (_i, s, rule) => {
    assertEntryState(s);
    const rs = book.get(keyOf(s));
    if (!rs) throw new Error(`no measured answer for ${keyOf(s)}`);
    const r = rs[Math.floor(rng() * rs.length)];
    const view: JevView = { healthy: r.healthy, caution: r.caution, echoOk: true, provider: "openrouter" };
    return combineDecision(rule, view, { enterMin, cautionExit: CAUTION_EXIT }, gate).action === "enter" ? "enter" : "hold";
  };
}
/**
 * THE NULL read here: a breakout EPISODE — consecutive bars on which the
 * rulebook wants in — is refused as a whole with probability `pEp`, decided on
 * its first bar and held to its last, independent of anything the market does.
 */
function episodeNullPolicy(pEp: number, rng: () => number): EntryPolicy {
  let lastBar = -Infinity, refusing = false;
  return (i) => {
    if (refusing && lastBar === i - 1) { lastBar = i; return "hold"; }
    lastBar = i;
    refusing = rng() < pEp;
    return refusing ? "hold" : "enter";
  };
}
/** The EARLIER study's null: every entry signal refused independently with probability `p` (asked again next bar). */
function signalNullPolicy(p: number, rng: () => number): EntryPolicy {
  return () => rng() < p ? "hold" : "enter";
}
/** `b` is consulted only where `a` lets the entry through. */
function both(a: EntryPolicy, b: EntryPolicy): EntryPolicy {
  return (i, s, r) => a(i, s, r) === "hold" ? "hold" : b(i, s, r);
}
type Tally = { signals: number; refused: number; coinFlip: number; coinFlipRefused: number };
function counting(pol: EntryPolicy, c: Tally, log?: Map<number, "enter" | "hold">, states?: CategoricalState[]): EntryPolicy {
  return (i, s, r) => {
    const a = pol(i, s, r);
    c.signals++;
    if (a === "hold") c.refused++;
    if (s.volatility === "high" && s.trend_strength !== "weak" && s.momentum_30d === "positive") { c.coinFlip++; if (a === "hold") c.coinFlipRefused++; }
    if (log) log.set(i, a);
    if (states) states.push(s);
    return a;
  };
}

// ──────────────────────────────────────────────────────── arithmetic on draws

const SLOT_USD = Math.min(LIVE_CANDIDATE.capitalUsd / LIVE_CANDIDATE.slots, MAX_ORDER_USD);
/** The recorded study's `sleeveOf`, lifted out of its closure unchanged. */
function sleeveStatsOf(per: Record<string, GatedResult>): SleeveStats {
  return combine(Object.entries(per).map(([s, r]) => ({
    id: `trend-4h·revx·${s.split("/")[0]}`, symbol: s, slotUsd: SLOT_USD, rets: dailyReturns(r.marks),
    ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * SLOT_USD,
  })));
}
function summarize(xs: ArrayLike<number>) {
  const s = Array.from(xs).sort((a, b) => a - b), n = s.length;
  const q = (p: number) => s[Math.min(n - 1, Math.floor(p * n))];
  return { n, mean: r4(s.reduce((a, b) => a + b, 0) / n), p05: r4(q(0.05)), p50: r4(q(0.5)), p95: r4(q(0.95)), min: r4(s[0]), max: r4(s[n - 1]) };
}
const meanOf = (xs: ArrayLike<number>) => { let t = 0; for (let i = 0; i < xs.length; i++) t += xs[i]; return xs.length ? t / xs.length : 0; };
/** Share of `nulls` at or above `v` — ties count AGAINST the arm. */
function atLeast(nulls: ArrayLike<number>, v: number): number {
  let c = 0;
  for (let i = 0; i < nulls.length; i++) if (nulls[i] >= v - 1e-12) c++;
  return nulls.length ? c / nulls.length : NaN;
}
/** P(null ≥ arm) for two independent samples, every pair counted. */
function atLeastPairs(nulls: ArrayLike<number>, arms: ArrayLike<number>): number {
  const s = Float64Array.from(nulls).sort();
  let tot = 0;
  for (let j = 0; j < arms.length; j++) {
    const v = arms[j] - 1e-12;
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid] < v) lo = mid + 1; else hi = mid; }
    tot += (s.length - lo) / s.length;
  }
  return arms.length ? tot / arms.length : NaN;
}

// ─────────────────────────────────────────────── the earlier study's numbers

/** What the EARLIER study published (jev.json at 944c36d, sha256 2e3ec025…); re-derived below from its own code. */
const EARLIER = {
  jevJsonSha256: "2e3ec025eb6b2061b1fd0b35c522888ec875ed9e2a4b791fb9929cb9f21c50ba",
  centralRet: { A: -0.0247, B: 0.1577, C: 0.5241, D: -0.0145 } as Record<WinName, number>,
  census: {
    "moderate|normal|positive": 44, "weak|normal|positive": 37, "moderate|high|positive": 26, "strong|high|positive": 21,
    "weak|low|positive": 14, "moderate|low|positive": 13, "strong|normal|positive": 13, "weak|high|positive": 9, "strong|low|positive": 3,
  } as Record<string, number>,
  censusByWindow: { A: 43, B: 58, C: 47, D: 32 } as Record<WinName, number>,
  nullRefuseProb: { A: 0.535, B: 0.5, C: 0.426, D: 0.438 } as Record<WinName, number>,
  nullMean: { A: 0.0551, B: 0.1836, C: 0.4747, D: -0.0357 } as Record<WinName, number>,
  jevPercentile: { A: 0.048, B: 0.292, C: 0.823, D: 0.762 } as Record<WinName, number>,
};

// ─────────────────────────────────────────────────────────────── the study

async function measuredStudy(args: Record<string, string>): Promise<void> {
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? "");
  const answersPath = String(args.answers ?? "docs/agents/backtests/jev_answers.json");
  const set2Path = String(args.set2 ?? "docs/agents/backtests/set2.json");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const DRAWS = Number(args.draws ?? 2000), NULL_DRAWS = Number(args["null-draws"] ?? 1000);
  // Configuration (ii) gates at the rows' 0.60 — unless a wording measured later is priced at its own threshold
  // (`--enter-min`, with that wording's answers in `--answers`); the output then goes to `--out-name`. With neither
  // flag the run is the 2026-09-22 study, unchanged.
  const ENTER_MIN_II = args["enter-min"] != null ? Number(args["enter-min"]) : SHIPPED_ENTER_MIN;
  if (!(ENTER_MIN_II > 0 && ENTER_MIN_II < 1)) throw new Error("--enter-min must be in (0, 1)");
  const OUT_NAME = String(args["out-name"] ?? "jev.json");
  /** Bisection draws and steps for the null's calibration; draws per grid point for (ii)'s plateau; draws for side arms. */
  const CAL_DRAWS = 100, CAL_ITERS = 10, PLATEAU_DRAWS = 100, SIDE_DRAWS = 500, SHADOW_DRAWS = 20, OLD_NULL_DRAWS = 400;
  if (!dataDir || !extDir || !kDir) throw new Error("--replay measured needs --data, --ext and --ktape (see the header)");
  if (!(DRAWS >= 10 && NULL_DRAWS >= 10)) throw new Error("--draws and --null-draws must be at least 10");
  await Deno.mkdir(outDir, { recursive: true });

  const sha = async (path: string | URL) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btUrl = new URL("./backtest.ts", import.meta.url), rbUrl = new URL("../_shared/agents_strategy.ts", import.meta.url);
  const hashesStart = { backtestTs: await sha(btUrl), agentsStrategyTs: await sha(rbUrl), answersJson: await sha(answersPath) };
  const book = loadAnswers(await Deno.readTextFile(answersPath));
  const t0 = Date.now();
  const say = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${m}`);

  // ── the data: the recorded study's splice, plus Kraken's own 4h tape ───
  type Series = {
    comb4h: Candle[]; combDaily: Candle[]; cb4h: Candle[]; kTape: Candle[]; kDaily: Candle[]; wins: Win[];
    oos: Record<Tape, Partial<Record<WinName, { from: number; to: number }>>>;
    krakenDropped: Partial<Record<WinName, string>>;
  };
  const series: Record<string, Series> = {};
  const dataRows: Record<string, unknown>[] = [];
  const symbols: string[] = [];
  for (const symbol of LIVE_CANDIDATE.symbols) {
    const base = symbol.replace("/", "-");
    const cbH = toCandles(JSON.parse(await Deno.readTextFile(`${dataDir}/${base}_1h_3y.json`)) as Raw[]);
    const kH = toCandles(JSON.parse(await Deno.readTextFile(`${extDir}/${base}_1h_kraken.json`)) as Raw[]);
    const kTape = toCandles(JSON.parse(await Deno.readTextFile(`${kDir}/${base}_4h_kraken.json`)) as Raw[]);
    const spliceAt = cbH[0].start;
    const cb4h = resample(cbH, 4);
    const combH = [...kH.filter((c) => c.start < spliceAt), ...cbH];
    const comb4h = resample(combH, 4), combDaily = resample(combH, 24), kDaily = resample(kTape, 24);
    const wins = windowsOn(comb4h, cb4h, MAX_LOOKBACK);
    // The recorded study's acceptance test on the splice, unchanged.
    const kByTs = new Map(kH.map((c) => [c.start, c]));
    let hourly = 0;
    for (const c of cbH) if (kByTs.has(c.start) && c.close > 0) hourly++;
    const k4hByTs = new Map(resample(kH, 4).map((c) => [c.start, c])), kLast = kH[kH.length - 1].start;
    const diffs4h: number[] = [];
    for (const c of cb4h) { if (c.start > kLast) continue; const k = k4hByTs.get(c.start); if (k && c.close > 0) diffs4h.push(Math.abs(k.close / c.close - 1) * 1e4); }
    const accepted = hourly >= 100 && diffs4h.length >= 100 && median(diffs4h) <= OVERLAP_MEDIAN_MAX_BPS && quantile(diffs4h, 0.95) <= OVERLAP_P95_MAX_BPS;
    // `backtest_set2.ts`'s rule for the second tape, unchanged: a window is priced on Kraken's tape only when
    // the tape spans its in-sample and its out-of-sample, both longer than the widest lookback.
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    const oos: Series["oos"] = { coinbase: {}, kraken: {} };
    const krakenDropped: Series["krakenDropped"] = {};
    for (const w of wins) {
      if (!w.scored) continue;
      oos.coinbase[w.name] = { from: w.oosFrom, to: w.oosTo };
      const isArr = w.isSeries === "coinbase" ? cb4h : comb4h;
      const isFromTs = isArr[w.isFrom].start, isToTs = endTs(isArr, w.isTo);
      const oosFromTs = comb4h[w.oosFrom].start, oosToTs = endTs(comb4h, w.oosTo);
      const kIsArr = w.isSeries === "coinbase" ? kTape.slice(indexAtOrAfter(kTape, spliceAt)) : kTape;
      const kIsBars = indexAtOrAfter(kIsArr, isToTs) - indexAtOrAfter(kIsArr, isFromTs);
      const kFrom = indexAtOrAfter(kTape, oosFromTs), kTo = indexAtOrAfter(kTape, oosToTs);
      let why = "";
      if (kTape[0].start > isFromTs) why = `Kraken's tape starts ${iso(kTape[0].start)}, after this window's in-sample begins`;
      else if (kTape[kTape.length - 1].start + 4 * 3600e3 < oosToTs) why = `Kraken's tape ends ${iso(kTape[kTape.length - 1].start)}, before this window's out-of-sample ends`;
      else if (kIsBars <= MAX_LOOKBACK + 2) why = `Kraken in-sample is ${kIsBars} bars`;
      else if (kTo - kFrom <= MAX_LOOKBACK + 2) why = `Kraken out-of-sample is ${kTo - kFrom} bars`;
      if (why) krakenDropped[w.name] = why;
      else oos.kraken[w.name] = { from: kFrom, to: kTo };
    }
    series[symbol] = { comb4h, combDaily, cb4h, kTape, kDaily, wins, oos, krakenDropped };
    if (accepted) symbols.push(symbol);
    dataRows.push({
      symbol, accepted,
      coinbaseSplice: { bars4h: comb4h.length, first: iso(comb4h[0].start), last: iso(comb4h[comb4h.length - 1].start), spliceAt: iso(spliceAt), overlapMedian4hBps: r3(median(diffs4h)), overlapP95_4hBps: r3(quantile(diffs4h, 0.95)) },
      krakenTape: { bars4h: kTape.length, first: iso(kTape[0].start), last: iso(kTape[kTape.length - 1].start) },
      windows: Object.fromEntries(wins.map((w) => [w.name, { scored: w.scored, oosFrom: w.oosFromIso, oosTo: w.oosToIso, oosDays: w.oosDays }])),
      pricedOn: { coinbase: WIN_NAMES.filter((w) => oos.coinbase[w]), kraken: WIN_NAMES.filter((w) => oos.kraken[w]) },
      krakenDropped,
    });
  }
  if (symbols.length !== LIVE_CANDIDATE.symbols.length) throw new Error(`a coin failed the splice test: ${LIVE_CANDIDATE.symbols.filter((s) => !symbols.includes(s)).join(", ")}`);
  const priced = (tape: Tape, w: WinName) => symbols.filter((s) => series[s].oos[tape][w] != null);
  say(`data: ${symbols.join(" ")} | coinbase ${WIN_NAMES.map((w) => `${w}${priced("coinbase", w).length}`).join(" ")} | kraken ${WIN_NAMES.map((w) => `${w}${priced("kraken", w).length}`).join(" ")}`);

  // ── tracks and the arm runner ─────────────────────────────────────────
  const trackCache = new Map<string, Track>();
  const pKey = (p: TrendParams) => `${p.fast}/${p.slow}/${p.atrStop}/${p.breakoutUp}/${p.breakoutDown}/${p.atrN}/${p.volN}`;
  function track(tape: Tape, symbol: string, w: WinName, p: TrendParams = DEFAULT_TREND, cache: Map<string, Track> = trackCache): Track {
    const key = `${tape}|${symbol}|${w}|${pKey(p)}`;
    let t = cache.get(key);
    if (!t) {
      const s = series[symbol], span = s.oos[tape][w];
      if (!span) throw new Error(`${symbol} ${w} is not priced on the ${tape} tape`);
      t = tape === "coinbase" ? buildTrack(symbol, s.comb4h, s.combDaily, p, span.from, span.to) : buildTrack(symbol, s.kTape, s.kDaily, p, span.from, span.to);
      cache.set(key, t);
    }
    return t;
  }
  type ArmOut = { stats: SleeveStats; entries: number; tally: Tally; per: Record<string, GatedResult> };
  type ArmOpts = {
    costs?: Costs; p?: TrendParams; cache?: Map<string, Track>; checked?: { flatBars: number; mismatches: number };
    logs?: Record<string, Map<number, "enter" | "hold">>; states?: CategoricalState[];
  };
  function runArm(cond: Condition, w: WinName, policyFor: PolicyFor, o: ArmOpts = {}): ArmOut | null {
    const syms = priced(cond.tape, w);
    if (!syms.length) return null;
    const per: Record<string, GatedResult> = {};
    const tally: Tally = { signals: 0, refused: 0, coinFlip: 0, coinFlipRefused: 0 };
    let entries = 0;
    for (const symbol of syms) {
      const t = track(cond.tape, symbol, w, o.p ?? DEFAULT_TREND, o.cache ?? trackCache);
      const log = o.logs ? (o.logs[symbol] = new Map()) : undefined;
      const pol = counting(policyFor(symbol), tally, log, o.states);
      const d = o.checked ? checkedDecider(t, pol, o.checked) : trackDecider(t, pol);
      const r = runGated(symbol, t.bars, t.from, t.to, t.warmup, d, o.costs ?? COSTS.revx, stopsOf(cond.stopRule, t.p));
      per[symbol] = r;
      entries += r.entries;
    }
    return { stats: sleeveStatsOf(per), entries, tally, per };
  }
  const scoredWindows = (cond: Condition) => WIN_NAMES.filter((w) => priced(cond.tape, w).length > 0);
  const sleeveRow = (a: ArmOut) => ({
    ret: a.stats.ret, maxDD: a.stats.maxDD, retOverDD: a.stats.retOverDD, pnlUsd: a.stats.pnlUsd, capitalUsd: a.stats.capitalUsd,
    deployment: a.stats.deployment, entries: a.entries, signals: a.tally.signals, refused: a.tally.refused,
  });

  // ── fidelity: the cache and the copy are `run`, on every cell ──────────
  const fid = { cells: 0, fieldMismatches: 0, equityPoints: 0, equityMismatches: 0, flatBarsChecked: 0, flatBarMismatches: 0, mismatchCells: [] as string[] };
  const FIELDS = ["ret", "maxDD", "trades", "days", "exposure", "realised", "fees", "stopsHit"] as const;
  for (const cond of CONDITIONS) for (const w of WIN_NAMES) for (const symbol of priced(cond.tape, w)) for (const venue of ["revx", "kraken"] as const) {
    const t = track(cond.tape, symbol, w);
    const stops = stopsOf(cond.stopRule, t.p);
    const r = run("trend-4h", symbol, t.bars, t.daily, t.from, t.to, t.p, COSTS[venue], BAR_HOURS, stops);
    const g = runGated(symbol, t.bars, t.from, t.to, t.warmup, trackDecider(t, rulePolicy), COSTS[venue], stops);
    const tally = { flatBars: 0, mismatches: 0 };
    const gs = runGated(symbol, t.bars, t.from, t.to, t.warmup, checkedDecider(t, rulePolicy, tally), COSTS[venue], stops);
    fid.cells++;
    fid.flatBarsChecked += tally.flatBars; fid.flatBarMismatches += tally.mismatches;
    let bad = 0;
    for (const f of FIELDS) { if ((r[f] ?? 0) !== (g[f] ?? 0)) bad++; if ((r[f] ?? 0) !== (gs[f] ?? 0)) bad++; }
    const marks = new Map(g.marks.map(([ts, e]) => [ts, e]));
    for (const [ts, e] of r.equity) {
      fid.equityPoints++;
      const m = marks.get(ts);
      if (m == null || Number(m.toFixed(5)) !== e) fid.equityMismatches++;
    }
    if (bad) { fid.fieldMismatches += bad; fid.mismatchCells.push(`${cond.id} ${w} ${symbol} ${venue}`); }
  }
  say(`fidelity: ${fid.cells} cells, ${fid.fieldMismatches} field mismatches, ${fid.equityMismatches}/${fid.equityPoints} equity points off, ${fid.flatBarMismatches}/${fid.flatBarsChecked} flat bars off the cache`);
  if (fid.fieldMismatches || fid.equityMismatches || fid.flatBarMismatches) throw new Error(`fidelity failed: ${JSON.stringify(fid)}`);

  // ── (i) the rulebook, per evaluation, and the incumbent from set2.json ─
  const ruleArm: Record<string, Partial<Record<WinName, ArmOut>>> = {};
  for (const cond of CONDITIONS) {
    ruleArm[cond.id] = {};
    for (const w of scoredWindows(cond)) ruleArm[cond.id][w] = runArm(cond, w, () => rulePolicy)!;
  }
  const PUBLISHED: Record<WinName, { ret: number; maxDD: number }> = {
    A: { ret: 0.0803, maxDD: 0.1128 }, B: { ret: 0.2008, maxDD: 0.1047 }, C: { ret: 0.5564, maxDD: 0.0735 }, D: { ret: -0.0781, maxDD: 0.1552 },
  };
  type Set2Rows = Record<string, { perWindow: Record<string, { ret: number; maxDD: number; members: number }> }>;
  let set2Rows: Set2Rows | null = null;
  try {
    const s2 = JSON.parse(await Deno.readTextFile(set2Path)) as { a2_theWeights: { rows: { arm: string; perCondition: Set2Rows }[] } };
    set2Rows = s2.a2_theWeights.rows.find((r) => r.arm === "equal")?.perCondition ?? null;
  } catch { set2Rows = null; }
  const incumbentCheck: Record<string, unknown> = {};
  let incumbentWorstDiff = 0;
  for (const cond of CONDITIONS) {
    const perW: Record<string, unknown> = {};
    for (const w of scoredWindows(cond)) {
      const s = ruleArm[cond.id][w]!.stats;
      const ref = set2Rows?.[cond.id]?.perWindow?.[w];
      const pub = cond.id === PRIMARY.id ? PUBLISHED[w] : null;
      const dRet = ref ? Math.abs(s.ret - ref.ret) : NaN, dDD = ref ? Math.abs(s.maxDD - ref.maxDD) : NaN;
      if (ref) incumbentWorstDiff = Math.max(incumbentWorstDiff, dRet, dDD);
      if (pub) incumbentWorstDiff = Math.max(incumbentWorstDiff, Math.abs(s.ret - pub.ret), Math.abs(s.maxDD - pub.maxDD));
      perW[w] = { here: { ret: s.ret, maxDD: s.maxDD, members: s.members }, set2: ref ? { ret: ref.ret, maxDD: ref.maxDD, members: ref.members } : null, published: pub };
    }
    incumbentCheck[cond.id] = perW;
  }
  say(`rule arm vs set2.json's incumbent and the published sleeve: worst |Δ| ${incumbentWorstDiff}${set2Rows ? "" : " (set2.json not found)"}`);

  // (i) shadow: the model asked with real draws, `gate = false` — must BE the rulebook.
  let shadowCells = 0, shadowDiffs = 0, shadowConsulted = 0, shadowWouldVeto = 0;
  for (const cond of CONDITIONS) for (const w of scoredWindows(cond)) for (let k = 0; k < SHADOW_DRAWS; k++) {
    const counter = { would: 0, asked: 0 };
    const a = runArm(cond, w, (sym) => {
      const rng = mulberry32(seedOf("shadow", cond.id, w, sym, k));
      const gated = jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf("shadow-would", cond.id, w, sym, k)), ENTER_MIN_II, true);
      const shadow = jevPolicy(book.bySymbol, stateKey, rng, SHIPPED_ENTER_MIN, false);
      return (i, s, r) => { counter.asked++; if (gated(i, s, r) === "hold") counter.would++; return shadow(i, s, r); };
    })!;
    const b = ruleArm[cond.id][w]!;
    shadowCells++;
    if (a.stats.ret !== b.stats.ret || a.stats.maxDD !== b.stats.maxDD || a.entries !== b.entries) shadowDiffs++;
    for (const s of Object.keys(b.per)) if (a.per[s].ret !== b.per[s].ret || a.per[s].trades !== b.per[s].trades) shadowDiffs++;
    shadowConsulted += counter.asked; shadowWouldVeto += counter.would;
  }
  say(`shadow ≡ rule: ${shadowCells} evaluation-windows × draws, ${shadowDiffs} differences; the gate would have vetoed ${shadowWouldVeto} of ${shadowConsulted} entries it was shown`);
  if (shadowDiffs) throw new Error("shadow mode is not the rulebook");

  // ── the earlier study, re-derived from its own code ───────────────────
  const stopsShipped = stopsOf("shipped", DEFAULT_TREND);
  const central = makeSurface({ id: "central", unseen: "specified", forceHighVol: null, forceWeak: null });
  const oldSignals: Record<WinName, Signal[]> = { A: [], B: [], C: [], D: [] };
  const censusOld: Record<string, number> = {};
  const censusOldByWindow: Record<string, number> = {};
  const censusActionable: Record<string, Record<string, number>> = {};
  const entriesVsRun: { symbol: string; window: WinName; actionableSignals: number; entries: number; ceilHalfRunTrades: number }[] = [];
  for (const w of WIN_NAMES) {
    for (const symbol of priced("coinbase", w)) {
      const s = series[symbol], span = s.oos.coinbase[w]!;
      const log: Signal[] = [];
      runGated(symbol, s.comb4h, span.from, span.to, DEFAULT_TREND.slow + 1, decider("trend-4h", symbol, s.comb4h, s.combDaily, DEFAULT_TREND, 4, null, SHIPPED_ENTER_MIN, log), COSTS.revx, stopsShipped);
      oldSignals[w].push(...log);
      for (const g of log) { const k = cellKey(g.state); censusOld[k] = (censusOld[k] ?? 0) + 1; }
      censusOldByWindow[w] = (censusOldByWindow[w] ?? 0) + log.length;
      const t = track("coinbase", symbol, w);
      const rr = run("trend-4h", symbol, t.bars, t.daily, t.from, t.to, t.p, COSTS.revx, BAR_HOURS, stopsShipped);
      const mine: CategoricalState[] = [];
      const g = runGated(symbol, t.bars, t.from, t.to, t.warmup, trackDecider(t, counting(rulePolicy, { signals: 0, refused: 0, coinFlip: 0, coinFlipRefused: 0 }, undefined, mine)), COSTS.revx, stopsShipped);
      for (const st of mine) { const k = cellKey(st); censusActionable[k] ??= {}; censusActionable[k][w] = (censusActionable[k][w] ?? 0) + 1; }
      entriesVsRun.push({ symbol, window: w, actionableSignals: mine.length, entries: g.entries, ceilHalfRunTrades: Math.ceil(rr.trades / 2) });
    }
  }
  const censusMatches = Object.keys(EARLIER.census).every((k) => censusOld[k] === EARLIER.census[k]) && Object.keys(censusOld).every((k) => EARLIER.census[k] === censusOld[k])
    && WIN_NAMES.every((w) => censusOldByWindow[w] === EARLIER.censusByWindow[w]);
  const actionableTotal = Object.values(censusActionable).reduce((a, m) => a + Object.values(m).reduce((x, y) => x + y, 0), 0);
  const entriesAgree = entriesVsRun.every((e) => e.actionableSignals === e.entries && e.entries === e.ceilHalfRunTrades);
  say(`census: the earlier count (every flat rulebook entry, cooling down or not) ${Object.values(censusOld).reduce((a, b) => a + b, 0)} — ${censusMatches ? "matches" : "DOES NOT match"} the published 180; actionable ${actionableTotal}; entries = actionable = ⌈run.trades / 2⌉ on every coin-window: ${entriesAgree}`);

  // The earlier null and the central arm, re-run with the earlier code and seeds, now with their ENTRIES counted.
  const earlierNull: Record<string, unknown> = {};
  let earlierReproduced = true;
  for (const w of WIN_NAMES) {
    const sigs = oldSignals[w];
    const vetoedCentral = sigs.filter((g) => {
      const a = central.at(g.state);
      return combineDecision({ action: "enter", reason: "" }, { healthy: a.healthy, caution: a.caution, echoOk: true, provider: "openrouter" }, { enterMin: SHIPPED_ENTER_MIN, cautionExit: CAUTION_EXIT }).action !== "enter";
    }).length;
    const p = Number((vetoedCentral / sigs.length).toFixed(3));   // the earlier code's own rounding
    const perCentral: Record<string, GatedResult> = {}, perRule: Record<string, GatedResult> = {};
    for (const symbol of priced("coinbase", w)) {
      const s = series[symbol], span = s.oos.coinbase[w]!;
      perCentral[symbol] = runGated(symbol, s.comb4h, span.from, span.to, DEFAULT_TREND.slow + 1, decider("trend-4h", symbol, s.comb4h, s.combDaily, DEFAULT_TREND, 4, central, SHIPPED_ENTER_MIN, null), COSTS.revx, stopsShipped);
      perRule[symbol] = ruleArm[PRIMARY.id][w]!.per[symbol];
    }
    const centralRet = sleeveStatsOf(perCentral).ret;
    const centralEntries = Object.values(perCentral).reduce((a, r) => a + r.entries, 0);
    const ruleEntries = Object.values(perRule).reduce((a, r) => a + r.entries, 0);
    const rets: number[] = [], ents: number[] = [];
    for (let k = 0; k < OLD_NULL_DRAWS; k++) {
      const per: Record<string, GatedResult> = {};
      for (const symbol of symbols) {
        const s = series[symbol], span = s.oos.coinbase[w];
        if (!span) continue;
        const rnd = mulberry32(0x5eed0000 + k * 1000 + symbols.indexOf(symbol) * 7 + w.charCodeAt(0));
        per[symbol] = runGated(symbol, s.comb4h, span.from, span.to, DEFAULT_TREND.slow + 1,
          randomDecider("trend-4h", symbol, s.comb4h, s.combDaily, DEFAULT_TREND, 4, p, rnd, { signals: 0, refused: 0 }), COSTS.revx, stopsShipped);
      }
      rets.push(sleeveStatsOf(per).ret);
      ents.push(Object.values(per).reduce((a, r) => a + r.entries, 0));
    }
    const sorted = rets.slice().sort((a, b) => a - b);
    const nullMean = r4(sorted.reduce((a, b) => a + b, 0) / sorted.length);   // summed as the earlier code summed it
    const pct = r3(sorted.filter((r) => r < centralRet).length / sorted.length);
    const ok = p === EARLIER.nullRefuseProb[w] && nullMean === EARLIER.nullMean[w] && pct === EARLIER.jevPercentile[w] && centralRet === EARLIER.centralRet[w];
    if (!ok) earlierReproduced = false;
    earlierNull[w] = {
      reproduced: ok, refuseProbPerSignal: p, centralArmRet: centralRet, nullMean, centralPercentileInNull: pct,
      entries: { rule: ruleEntries, centralArm: centralEntries, earlierNullMean: r3(meanOf(ents)) },
      entriesRemoved: { centralArm: ruleEntries - centralEntries, earlierNullMean: r3(ruleEntries - meanOf(ents)) },
    };
  }
  say(`the earlier null and central arm re-run from their own code: ${earlierReproduced ? "reproduced exactly" : "NOT reproduced"}`);

  // ── the measured surface: veto probabilities and the threshold's bands ─
  const vetoProb = (s: Words, enterMin: number, pooledBook = false): number => {
    const rs = pooledBook ? book.pooled.get(cellKey(s))! : book.bySymbol.get(stateKey(s))!;
    const v = rs.filter((r) => combineDecision({ action: "enter", reason: "" }, { healthy: r.healthy, caution: r.caution, echoOk: true, provider: "openrouter" }, { enterMin, cautionExit: CAUTION_EXIT }).action !== "enter").length;
    return v / rs.length;
  };
  const surfaceCells: Record<string, unknown> = {};
  for (const st of STRENGTHS) for (const v of VOLS) for (const m of MOMENTA) {
    const c = `${st}|${v}|${m}`;
    const rs = book.pooled.get(c)!;
    const hs = rs.map((r) => r.healthy), cs = rs.map((r) => r.caution);
    surfaceCells[c] = {
      replies: rs.length, meanP: r3(meanOf(hs)), minP: Math.min(...hs), maxP: Math.max(...hs), caution: [Math.min(...cs), Math.max(...cs)],
      vetoProbAt060: r3(vetoProb({ symbol: "", trend_strength: st, volatility: v, momentum_30d: m }, SHIPPED_ENTER_MIN, true)),
      perSymbolVetoesOf5: Object.fromEntries(LIVE_CANDIDATE.symbols.map((sym) => [sym.split("/")[0], Math.round(5 * vetoProb({ symbol: sym, trend_strength: st, volatility: v, momentum_30d: m }, SHIPPED_ENTER_MIN))])),
    };
  }
  const repliesWhere = (pred: (w: Words) => boolean) => [...book.bySymbol.entries()].filter(([k]) => pred(book.words.get(k)!)).flatMap(([, rs]) => rs.map((r) => r.healthy));
  const weakOrUnknown = repliesWhere((w) => w.trend_strength === "weak" || w.momentum_30d !== "positive");
  const weakPositive = repliesWhere((w) => w.trend_strength === "weak" && w.momentum_30d === "positive");
  const highVol = repliesWhere((w) => w.trend_strength !== "weak" && w.momentum_30d === "positive" && w.volatility === "high");
  const calm = repliesWhere((w) => w.trend_strength !== "weak" && w.momentum_30d === "positive" && w.volatility !== "high");
  const all = repliesWhere(() => true);
  const edge = {
    allMin: Math.min(...all), weakOrUnknownMax: Math.max(...weakOrUnknown), weakPositiveMin: Math.min(...weakPositive), weakPositiveMax: Math.max(...weakPositive),
    highVolMin: Math.min(...highVol), highVolMax: Math.max(...highVol), calmMin: Math.min(...calm), calmMax: Math.max(...calm),
    cautionMax: Math.max(...[...book.bySymbol.values()].flatMap((rs) => rs.map((r) => r.caution))),
  };
  /** Is `enterMin` deterministic on every state in `keys` — all five replies on one side of it? */
  const deterministicAt = (enterMin: number, onlyPositive: boolean) => [...book.bySymbol.keys()]
    .filter((k) => !onlyPositive || book.words.get(k)!.momentum_30d === "positive")
    .every((k) => { const q = vetoProb(book.words.get(k)!, enterMin); return q === 0 || q === 1; });
  const bands = [
    { band: `[0, ${edge.allMin}]`, onAllStates: "nothing vetoed — the rulebook", historical: `[0, ${edge.weakPositiveMin}] on the states history reaches (momentum is always positive there)` },
    { band: `(${edge.allMin}, ${edge.weakOrUnknownMax}]`, onAllStates: "part of the weak / unknown replies vetoed", historical: `(${edge.weakPositiveMin}, ${edge.weakPositiveMax}] is the stochastic part on history` },
    { band: `(${edge.weakOrUnknownMax}, ${edge.highVolMin}]`, onAllStates: "DETERMINISTIC: every weak and every unknown-momentum state vetoed, everything else passes — identical to (iii)", historical: `(${edge.weakPositiveMax}, ${edge.highVolMin}] on history` },
    { band: `(${edge.highVolMin}, ${edge.highVolMax}]`, onAllStates: "THE COIN FLIP: weak / unknown vetoed, the high-volatility states vetoed call by call", historical: "same" },
    { band: `(${edge.highVolMax}, ${edge.calmMin}]`, onAllStates: "DETERMINISTIC: weak, unknown and every high-volatility state vetoed; low / normal volatility passes", historical: "same" },
    { band: `(${edge.calmMin}, ${edge.calmMax}]`, onAllStates: "part of the low / normal-volatility replies vetoed as well", historical: "same" },
    { band: `(${edge.calmMax}, 1]`, onAllStates: "everything vetoed — no entries", historical: "same" },
  ];
  say(`bands: ${bands.map((b) => b.band).join(" ")} | 0.60 deterministic on history: ${deterministicAt(0.6, true)}`);

  // ── (ii) the Monte Carlo, and (iii), on every evaluation ───────────────
  type Mc = { ret: Float64Array; dd: Float64Array; entries: Float64Array; refused: Float64Array; signals: Float64Array; dep: Float64Array; coinFlip: Float64Array; coinFlipRefused: Float64Array; perCoin: Record<string, number> };
  const mcRun = (cond: Condition, w: WinName, n: number, policyAt: (sym: string, k: number) => EntryPolicy, o: ArmOpts = {}): Mc => {
    const m: Mc = {
      ret: new Float64Array(n), dd: new Float64Array(n), entries: new Float64Array(n), refused: new Float64Array(n), signals: new Float64Array(n),
      dep: new Float64Array(n), coinFlip: new Float64Array(n), coinFlipRefused: new Float64Array(n), perCoin: {},
    };
    for (let k = 0; k < n; k++) {
      const a = runArm(cond, w, (sym) => policyAt(sym, k), o)!;
      m.ret[k] = a.stats.ret; m.dd[k] = a.stats.maxDD; m.entries[k] = a.entries; m.refused[k] = a.tally.refused; m.signals[k] = a.tally.signals;
      m.dep[k] = a.stats.deployment; m.coinFlip[k] = a.tally.coinFlip; m.coinFlipRefused[k] = a.tally.coinFlipRefused;
      for (const [s, r] of Object.entries(a.per)) m.perCoin[s] = (m.perCoin[s] ?? 0) + r.ret / n;
    }
    return m;
  };
  const mcRow = (m: Mc) => ({
    ret: summarize(m.ret), pNegative: r3(Array.from(m.ret).filter((x) => x < 0).length / m.ret.length), maxDDMean: r4(meanOf(m.dd)), deploymentMean: r3(meanOf(m.dep)),
    entriesMean: r3(meanOf(m.entries)), signalsMean: r3(meanOf(m.signals)), refusedMean: r3(meanOf(m.refused)),
    coinFlipSignalsMean: r3(meanOf(m.coinFlip)), coinFlipRefusedMean: r3(meanOf(m.coinFlipRefused)),
  });
  const iiPolicy = (cond: Condition, w: WinName, tag = "ii") => (sym: string, k: number) =>
    jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf(tag, cond.id, w, sym, k)), ENTER_MIN_II, true);
  const mcII: Record<string, Partial<Record<WinName, Mc>>> = {};
  const armIII: Record<string, Partial<Record<WinName, ArmOut>>> = {};
  let clauseMomentumDiffs = 0;
  for (const cond of CONDITIONS) {
    mcII[cond.id] = {}; armIII[cond.id] = {};
    for (const w of scoredWindows(cond)) {
      mcII[cond.id][w] = mcRun(cond, w, DRAWS, iiPolicy(cond, w));
      const a = runArm(cond, w, () => clausePolicy(false))!, b = runArm(cond, w, () => clausePolicy(true))!;
      armIII[cond.id][w] = a;
      if (a.stats.ret !== b.stats.ret || a.entries !== b.entries || a.stats.maxDD !== b.stats.maxDD) clauseMomentumDiffs++;
    }
    say(`(ii) Monte Carlo and (iii) on ${cond.id}: ${scoredWindows(cond).map((w) => `${w} rule ${(ruleArm[cond.id][w]!.stats.ret * 100).toFixed(1)} | ii ${(meanOf(mcII[cond.id][w]!.ret) * 100).toFixed(1)} | iii ${(armIII[cond.id][w]!.stats.ret * 100).toFixed(1)}`).join(" ; ")}`);
  }

  // ── the nulls ─────────────────────────────────────────────────────────
  function calibrate(cond: Condition, w: WinName, base: PolicyFor | null, baseEntries: number, target: number, tag: string) {
    const path: { pEp: number; meanEntries: number }[] = [];
    if (target >= baseEntries) return { pEp: 0, path, note: "the arm takes at least as many entries as its base; the null is the base itself" };
    const meanAt = (pEp: number) => {
      let tot = 0;
      for (let k = 0; k < CAL_DRAWS; k++) {
        tot += runArm(cond, w, (sym) => {
          const nul = episodeNullPolicy(pEp, mulberry32(seedOf("cal", tag, cond.id, w, sym, k)));
          return base ? both(base(sym), nul) : nul;
        })!.entries;
      }
      return tot / CAL_DRAWS;
    };
    let lo = 0, hi = 1;
    for (let it = 0; it < CAL_ITERS; it++) {
      const mid = (lo + hi) / 2, m = meanAt(mid);
      path.push({ pEp: r4(mid), meanEntries: r3(m) });
      if (m > target) lo = mid; else hi = mid;
    }
    return { pEp: (lo + hi) / 2, path, note: "" };
  }
  type NullOut = { pEp: number; calibration: ReturnType<typeof calibrate>; target: number; m: Mc };
  const runEpisodeNull = (cond: Condition, w: WinName, base: PolicyFor | null, baseEntries: number, target: number, tag: string): NullOut => {
    const calibration = calibrate(cond, w, base, baseEntries, target, tag);
    const m = mcRun(cond, w, NULL_DRAWS, (sym, k) => {
      const nul = episodeNullPolicy(calibration.pEp, mulberry32(seedOf("null", tag, cond.id, w, sym, k)));
      return base ? both(base(sym), nul) : nul;
    });
    return { pEp: calibration.pEp, calibration, target, m };
  };
  const nulls: Record<string, Partial<Record<WinName, { iii: NullOut; ii: NullOut; step: NullOut }>>> = {};
  for (const cond of CONDITIONS) {
    nulls[cond.id] = {};
    for (const w of scoredWindows(cond)) {
      const ruleEntries = ruleArm[cond.id][w]!.entries, iiiEntries = armIII[cond.id][w]!.entries;
      const iiTarget = meanOf(mcII[cond.id][w]!.entries);
      nulls[cond.id][w] = {
        iii: runEpisodeNull(cond, w, null, ruleEntries, iiiEntries, "iii"),
        ii: runEpisodeNull(cond, w, null, ruleEntries, iiTarget, "ii"),
        step: runEpisodeNull(cond, w, () => clausePolicy(false), iiiEntries, iiTarget, "step"),
      };
    }
    say(`episode nulls on ${cond.id}: ${scoredWindows(cond).map((w) => { const n = nulls[cond.id][w]!; return `${w} iii p=${n.iii.pEp.toFixed(3)} P≥${atLeast(n.iii.m.ret, armIII[cond.id][w]!.stats.ret).toFixed(3)} | ii p=${n.ii.pEp.toFixed(3)} P≥${atLeastPairs(n.ii.m.ret, mcII[cond.id][w]!.ret).toFixed(3)}`; }).join(" ; ")}`);
  }

  // The EARLIER construction on the measured rates (primary evaluation): every signal refused independently.
  const signalNull: Record<string, unknown> = {};
  for (const w of scoredWindows(PRIMARY)) {
    const states: CategoricalState[] = [];
    runArm(PRIMARY, w, () => rulePolicy, { states });
    const pIII = states.filter((s) => s.trend_strength === "weak").length / states.length;
    const pII = meanOf(states.map((s) => vetoProb(s, ENTER_MIN_II)));
    const mIII = mcRun(PRIMARY, w, NULL_DRAWS, (sym, k) => signalNullPolicy(pIII, mulberry32(seedOf("signal-null", "iii", w, sym, k))));
    const mII = mcRun(PRIMARY, w, NULL_DRAWS, (sym, k) => signalNullPolicy(pII, mulberry32(seedOf("signal-null", "ii", w, sym, k))));
    signalNull[w] = {
      iii: { refuseProbPerSignal: r3(pIII), entriesMean: r3(meanOf(mIII.entries)), armEntries: armIII[PRIMARY.id][w]!.entries, ret: summarize(mIII.ret), pNullAtLeastArm: r3(atLeast(mIII.ret, armIII[PRIMARY.id][w]!.stats.ret)) },
      ii: { refuseProbPerSignal: r3(pII), entriesMean: r3(meanOf(mII.entries)), armEntriesMean: r3(meanOf(mcII[PRIMARY.id][w]!.entries)), ret: summarize(mII.ret), pNullAtLeastArm: r3(atLeastPairs(mII.ret, mcII[PRIMARY.id][w]!.ret)) },
      ruleEntries: ruleArm[PRIMARY.id][w]!.entries,
    };
  }
  say("the earlier null's construction, re-priced on the measured rates");

  // ── the table the decision is made from ───────────────────────────────
  const worstOf = (vals: Partial<Record<WinName, number>>) => {
    let wn: WinName | null = null, v = Infinity;
    for (const w of WIN_NAMES) { const x = vals[w]; if (x != null && x < v) { v = x; wn = w; } }
    return { window: wn, ret: r4(v) };
  };
  const configurations: Record<string, unknown> = {};
  const verdictRows: Record<string, Record<string, unknown>> = { ii: {}, iii: {} };
  for (const cond of CONDITIONS) {
    const ws = scoredWindows(cond);
    const ruleRet = Object.fromEntries(ws.map((w) => [w, ruleArm[cond.id][w]!.stats.ret])) as Partial<Record<WinName, number>>;
    const iiiRet = Object.fromEntries(ws.map((w) => [w, armIII[cond.id][w]!.stats.ret])) as Partial<Record<WinName, number>>;
    const iiMean = Object.fromEntries(ws.map((w) => [w, meanOf(mcII[cond.id][w]!.ret)])) as Partial<Record<WinName, number>>;
    const ruleWorst = worstOf(ruleRet), iiiWorst = worstOf(iiiRet), iiWorstOfMeans = worstOf(iiMean);
    // (ii)'s worst window, draw by draw (the four windows' draws are independent streams, paired by index).
    const iiWorstPerDraw = new Float64Array(DRAWS);
    for (let k = 0; k < DRAWS; k++) iiWorstPerDraw[k] = Math.min(...ws.map((w) => mcII[cond.id][w]!.ret[k]));
    // The nulls' worst windows, draw by draw, each null calibrated per window.
    const nullWorst = (which: "ii" | "iii" | "step") => {
      const out = new Float64Array(NULL_DRAWS);
      for (let k = 0; k < NULL_DRAWS; k++) out[k] = Math.min(...ws.map((w) => nulls[cond.id][w]![which].m.ret[k]));
      return out;
    };
    const nwIII = nullWorst("iii"), nwII = nullWorst("ii"), nwStep = nullWorst("step");
    // The same test on return over drawdown (`score`, the metric §3.19's set study ranks worst windows by).
    const sc = (ret: number, dd: number) => ret / Math.max(0.05, dd);
    const ruleScoreWorst = worstOf(Object.fromEntries(ws.map((w) => [w, sc(ruleArm[cond.id][w]!.stats.ret, ruleArm[cond.id][w]!.stats.maxDD)])) as Partial<Record<WinName, number>>);
    const iiiScoreWorst = worstOf(Object.fromEntries(ws.map((w) => [w, sc(armIII[cond.id][w]!.stats.ret, armIII[cond.id][w]!.stats.maxDD)])) as Partial<Record<WinName, number>>);
    const iiScoreWorstPerDraw = new Float64Array(DRAWS);
    for (let k = 0; k < DRAWS; k++) iiScoreWorstPerDraw[k] = Math.min(...ws.map((w) => sc(mcII[cond.id][w]!.ret[k], mcII[cond.id][w]!.dd[k])));
    const nullScoreWorst = (which: "ii" | "iii") => {
      const out = new Float64Array(NULL_DRAWS);
      for (let k = 0; k < NULL_DRAWS; k++) out[k] = Math.min(...ws.map((w) => sc(nulls[cond.id][w]![which].m.ret[k], nulls[cond.id][w]![which].m.dd[k])));
      return out;
    };
    const nsIII = nullScoreWorst("iii"), nsII = nullScoreWorst("ii");
    const iiScoreWorstMean = r4(meanOf(iiScoreWorstPerDraw));
    const retOverDD = {
      incumbentWorst: ruleScoreWorst,
      ii: { worstMeanOverDraws: iiScoreWorstMean, beatsIncumbentWorst: iiScoreWorstMean > ruleScoreWorst.ret, pNullWorstAtLeastArmWorst: r3(atLeastPairs(nsII, iiScoreWorstPerDraw)) },
      iii: { worst: iiiScoreWorst, beatsIncumbentWorst: iiiScoreWorst.ret > ruleScoreWorst.ret, pNullWorstAtLeastArmWorst: r3(atLeast(nsIII, iiiScoreWorst.ret)) },
    };
    const perWindow: Record<string, unknown> = {};
    for (const w of ws) {
      const n = nulls[cond.id][w]!;
      const ii = mcII[cond.id][w]!;
      const iii = armIII[cond.id][w]!;
      perWindow[w] = {
        i_shadow: sleeveRow(ruleArm[cond.id][w]!),
        ii_gate: { ...mcRow(ii), pAtLeastRule: r3(atLeast(ii.ret, ruleRet[w]!)), pAtLeastIII: r3(atLeast(ii.ret, iiiRet[w]!)) },
        iii_clause: sleeveRow(iii),
        nulls: {
          iii: { pEp: r4(n.iii.pEp), targetEntries: n.iii.target, nullEntriesMean: r3(meanOf(n.iii.m.entries)), nullDeploymentMean: r3(meanOf(n.iii.m.dep)), armDeployment: iii.stats.deployment, ret: summarize(n.iii.m.ret), pNullAtLeastArm: r3(atLeast(n.iii.m.ret, iii.stats.ret)) },
          ii: { pEp: r4(n.ii.pEp), targetEntries: r3(n.ii.target), nullEntriesMean: r3(meanOf(n.ii.m.entries)), nullDeploymentMean: r3(meanOf(n.ii.m.dep)), armDeploymentMean: r3(meanOf(ii.dep)), ret: summarize(n.ii.m.ret), pNullAtLeastArm: r3(atLeastPairs(n.ii.m.ret, ii.ret)) },
          stepIIIToII: { what: "a random episode veto ON TOP OF (iii), calibrated to (ii)'s entries: is the high-volatility coin flip better than refusing the same number of (iii)'s entries at random?", pEp: r4(n.step.pEp), targetEntries: r3(n.step.target), nullEntriesMean: r3(meanOf(n.step.m.entries)), ret: summarize(n.step.m.ret), pNullAtLeastArm: r3(atLeastPairs(n.step.m.ret, ii.ret)) },
        },
      };
    }
    const beats = (armWorst: number) => armWorst > ruleWorst.ret;
    const iiRow = {
      worstOfMeans: iiWorstOfMeans, worstPerDraw: summarize(iiWorstPerDraw),
      beatsIncumbentWorst: beats(iiWorstOfMeans.ret), pWorstAboveIncumbentWorst: r3(Array.from(iiWorstPerDraw).filter((x) => x > ruleWorst.ret).length / DRAWS),
      nullWorst: summarize(nwII), pNullWorstAtLeastArmWorst: r3(atLeastPairs(nwII, iiWorstPerDraw)),
      stepNullWorst: summarize(nwStep), pStepNullWorstAtLeastArmWorst: r3(atLeastPairs(nwStep, iiWorstPerDraw)),
    };
    const iiiRow = {
      worst: iiiWorst, beatsIncumbentWorst: beats(iiiWorst.ret),
      nullWorst: summarize(nwIII), pNullWorstAtLeastArmWorst: r3(atLeast(nwIII, iiiWorst.ret)),
    };
    configurations[cond.id] = { incumbentWorst: ruleWorst, ii: iiRow, iii: iiiRow, retOverDD, perWindow };
    verdictRows.ii[cond.id] = {
      beatsIncumbentWorst: iiRow.beatsIncumbentWorst, beatsNullOnWorst: iiRow.pNullWorstAtLeastArmWorst <= 0.05, pNull: iiRow.pNullWorstAtLeastArmWorst,
      onRetOverDD: { beatsIncumbentWorst: retOverDD.ii.beatsIncumbentWorst, beatsNullOnWorst: retOverDD.ii.pNullWorstAtLeastArmWorst <= 0.05, pNull: retOverDD.ii.pNullWorstAtLeastArmWorst },
    };
    verdictRows.iii[cond.id] = {
      beatsIncumbentWorst: iiiRow.beatsIncumbentWorst, beatsNullOnWorst: iiiRow.pNullWorstAtLeastArmWorst <= 0.05, pNull: iiiRow.pNullWorstAtLeastArmWorst,
      onRetOverDD: { beatsIncumbentWorst: retOverDD.iii.beatsIncumbentWorst, beatsNullOnWorst: retOverDD.iii.pNullWorstAtLeastArmWorst <= 0.05, pNull: retOverDD.iii.pNullWorstAtLeastArmWorst },
    };
  }
  const passes = (x: Record<string, unknown>) => CONDITIONS.every((c) => { const v = x[c.id] as { beatsIncumbentWorst: boolean; beatsNullOnWorst: boolean }; return v.beatsIncumbentWorst && v.beatsNullOnWorst; });
  const passesRetOverDD = (x: Record<string, unknown>) => CONDITIONS.every((c) => { const v = (x[c.id] as { onRetOverDD: { beatsIncumbentWorst: boolean; beatsNullOnWorst: boolean } }).onRetOverDD; return v.beatsIncumbentWorst && v.beatsNullOnWorst; });
  say(`bar (return | return over drawdown): (ii) ${passes(verdictRows.ii) ? "PASSES" : "fails"} | ${passesRetOverDD(verdictRows.ii) ? "PASSES" : "fails"} ; (iii) ${passes(verdictRows.iii) ? "PASSES" : "fails"} | ${passesRetOverDD(verdictRows.iii) ? "PASSES" : "fails"} — ${JSON.stringify(verdictRows)}`);

  // ── sensitivity: the replies pooled across coins ───────────────────────
  const pooledSens: Record<string, unknown> = {};
  for (const w of scoredWindows(PRIMARY)) {
    const m = mcRun(PRIMARY, w, DRAWS, (sym, k) => jevPolicy(book.pooled, cellKey, mulberry32(seedOf("ii-pooled", PRIMARY.id, w, sym, k)), ENTER_MIN_II, true));
    pooledSens[w] = { pooled: mcRow(m), perSymbol: mcRow(mcII[PRIMARY.id][w]!) };
  }
  say("pooled-reply sensitivity done");

  // ── the threshold, as a structure (primary evaluation) ─────────────────
  const THRESHOLDS = [0, 0.1, 0.12, 0.4, 0.6, 0.62, 0.8, 0.95, 0.98];
  if (!THRESHOLDS.includes(ENTER_MIN_II)) { THRESHOLDS.push(ENTER_MIN_II); THRESHOLDS.sort((a, b) => a - b); }
  const thresholdRows: Record<string, unknown>[] = [];
  let equivalences = 0, equivalenceFailures = 0;
  for (const em of THRESHOLDS) {
    const det = deterministicAt(em, true);
    const perW: Record<string, unknown> = {};
    for (const w of scoredWindows(PRIMARY)) {
      if (det) {
        const a = runArm(PRIMARY, w, (sym) => jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf("th", em, w, sym, 0)), em, true))!;
        const b = runArm(PRIMARY, w, (sym) => jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf("th", em, w, sym, 1)), em, true))!;
        if (a.stats.ret !== b.stats.ret || a.entries !== b.entries) throw new Error(`enterMin ${em} was declared deterministic and two draws differ`);
        const code = em < edge.weakPositiveMin ? ruleArm[PRIMARY.id][w]! : em > edge.weakPositiveMax && em <= edge.highVolMin ? armIII[PRIMARY.id][w]!
          : em > edge.highVolMax && em <= edge.calmMin ? runArm(PRIMARY, w, () => clauseHighVolPolicy)! : null;
        if (code) { equivalences++; if (code.stats.ret !== a.stats.ret || code.entries !== a.entries || code.stats.maxDD !== a.stats.maxDD) equivalenceFailures++; }
        perW[w] = { deterministic: true, ...sleeveRow(a), identicalToCodeArm: code ? code.stats.ret === a.stats.ret && code.entries === a.entries : null };
      } else {
        const m = em === ENTER_MIN_II ? mcII[PRIMARY.id][w]! : mcRun(PRIMARY, w, SIDE_DRAWS, (sym, k) => jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf("th", em, w, sym, k)), em, true));
        perW[w] = { deterministic: false, ...mcRow(m) };
      }
    }
    const worstVals = Object.fromEntries(scoredWindows(PRIMARY).map((w) => { const x = perW[w] as { ret: number | { mean: number } }; return [w, typeof x.ret === "number" ? x.ret : x.ret.mean]; })) as Partial<Record<WinName, number>>;
    thresholdRows.push({ enterMin: em, deterministicOnHistoricalStates: det, deterministicOnAll90: deterministicAt(em, false), perWindow: perW, worst: worstOf(worstVals) });
  }
  say(`thresholds: ${equivalences} band ≡ code-arm checks, ${equivalenceFailures} failures`);
  if (equivalenceFailures) throw new Error("a deterministic band is not the code arm it should equal");

  // ── §4.15's four tests at sleeve level (primary evaluation) ────────────
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const gridCache = new Map<string, Track>();
  const barTests: Record<string, unknown> = {};
  for (const w of scoredWindows(PRIMARY)) {
    const grid = { i: [] as number[], ii: [] as number[], iii: [] as number[] };
    for (let g = 0; g < TREND_GRID.length; g++) {
      const p = TREND_GRID[g];
      grid.i.push(runArm(PRIMARY, w, () => rulePolicy, { p, cache: gridCache })!.stats.ret);
      grid.iii.push(runArm(PRIMARY, w, () => clausePolicy(false), { p, cache: gridCache })!.stats.ret);
      let tot = 0;
      for (let k = 0; k < PLATEAU_DRAWS; k++) tot += runArm(PRIMARY, w, (sym) => jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf("plateau", g, w, sym, k)), ENTER_MIN_II, true), { p, cache: gridCache })!.stats.ret;
      grid.ii.push(tot / PLATEAU_DRAWS);
    }
    gridCache.clear();
    const krI = runArm(PRIMARY, w, () => rulePolicy, { costs: COSTS.kraken })!.stats;
    const krIII = runArm(PRIMARY, w, () => clausePolicy(false), { costs: COSTS.kraken })!.stats;
    const krII = mcRun(PRIMARY, w, SIDE_DRAWS, (sym, k) => jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf("kraken-costs", w, sym, k)), ENTER_MIN_II, true), { costs: COSTS.kraken });
    const test = (ret: number, dd: number, plateau: number[], other: number) => {
      const share = plateau.filter((x) => x > 0).length / plateau.length;
      const failed: string[] = [];
      if (!(ret > 0)) failed.push("Revolut X return not positive");
      if (!(dd < 0.35)) failed.push("drawdown ≥ 35 %");
      if (!(share >= 0.5)) failed.push("plateau < 50 %");
      if (!(other > 0)) failed.push("Kraken-cost return not positive");
      return { revxRet: r4(ret), maxDD: r4(dd), plateauPositiveShare: r3(share), plateauMedian: r4(median(plateau)), krakenCostRet: r4(other), clears: failed.length === 0, failed };
    };
    barTests[w] = {
      i_shadow: test(ruleArm[PRIMARY.id][w]!.stats.ret, ruleArm[PRIMARY.id][w]!.stats.maxDD, grid.i, krI.ret),
      ii_gate: test(meanOf(mcII[PRIMARY.id][w]!.ret), meanOf(mcII[PRIMARY.id][w]!.dd), grid.ii, meanOf(krII.ret)),
      iii_clause: test(armIII[PRIMARY.id][w]!.stats.ret, armIII[PRIMARY.id][w]!.stats.maxDD, grid.iii, krIII.ret),
    };
  }
  say("sleeve-level bar tests done");

  // ── the live record, against the measured replies ──────────────────────
  const liveCheck = RECORDED.map((r) => {
    const state: CategoricalState = {
      symbol: r.symbol, trend_4h: "up", trend_strength: r.strength as CategoricalState["trend_strength"], breakout_4h: r.breakout as CategoricalState["breakout_4h"],
      volatility: r.volatility as CategoricalState["volatility"], momentum_30d: r.momentum as CategoricalState["momentum_30d"],
      position: "flat", unrealised: "none", time_in_position: "none", drawdown_from_high: "none",
    };
    const view: JevView = { healthy: r.healthy, caution: r.caution, echoOk: r.echo === r.symbol, provider: "openrouter" };
    const recomputed = combineDecision({ action: "enter", reason: "" }, view, { enterMin: SHIPPED_ENTER_MIN, cautionExit: CAUTION_EXIT }).action;
    const inSpace = r.breakout === "above_range";
    const rs = book.bySymbol.get(stateKey(state));
    const hs = rs ? rs.map((x) => x.healthy) : [];
    return {
      id: r.id, strategy: r.strategy, symbol: r.symbol, barStart: r.barStart, state: `${r.strength}|${r.volatility}|${r.momentum}|${r.breakout}`,
      liveP: r.healthy, liveCaution: r.caution, recordedAction: r.finalAction, recomputedAction: recomputed, recomputeMatches: (recomputed === "enter") === (r.finalAction === "enter"),
      inMeasuredSpace: inSpace, measuredReplies: hs, measuredRange: hs.length ? [Math.min(...hs), Math.max(...hs)] : null,
      liveInsideMeasuredRange: hs.length ? r.healthy >= Math.min(...hs) - 1e-9 && r.healthy <= Math.max(...hs) + 1e-9 : null,
      liveMinusMeasuredMean: hs.length ? r4(r.healthy - meanOf(hs)) : null,
      measuredVetoProbAt060: rs ? r3(vetoProb(state, SHIPPED_ENTER_MIN)) : null,
      note: inSpace ? "" : "breakout inside_range (momentum-1d enters without a breakout): the measured replies are the SAME words with above_range, shown for comparison, not as the same state",
    };
  });
  say(`live record: ${liveCheck.filter((c) => c.recomputeMatches).length}/${liveCheck.length} decisions recomputed; ${liveCheck.filter((c) => c.inMeasuredSpace && c.liveInsideMeasuredRange).length}/${liveCheck.filter((c) => c.inMeasuredSpace).length} in-space P values inside the measured range`);

  // ── the live row and its paper control, both gating: how often they part ─
  const CTRL_DRAWS = NULL_DRAWS;
  const control: Record<string, unknown> = {};
  for (const w of scoredWindows(PRIMARY)) {
    let joint = 0, disagree = 0, jointCoinFlip = 0, disagreeCoinFlip = 0, liveEntries = 0, matched = 0, expectedCoinFlipDisagree = 0;
    const absDiff = new Float64Array(CTRL_DRAWS);
    let differentSleeve = 0;
    for (let k = 0; k < CTRL_DRAWS; k++) {
      const logsL: Record<string, Map<number, "enter" | "hold">> = {}, logsC: Record<string, Map<number, "enter" | "hold">> = {};
      const L = runArm(PRIMARY, w, (sym) => jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf("live", w, sym, k)), ENTER_MIN_II, true), { logs: logsL })!;
      const C = runArm(PRIMARY, w, (sym) => jevPolicy(book.bySymbol, stateKey, mulberry32(seedOf("control", w, sym, k)), ENTER_MIN_II, true), { logs: logsC })!;
      for (const sym of Object.keys(logsL)) {
        const t = track("coinbase", sym, w);
        for (const [bar, a] of logsL[sym]) {
          const c = logsC[sym]?.get(bar);
          if (a === "enter") { liveEntries++; if (c === "enter") matched++; }
          if (c == null) continue;
          joint++;
          const st = t.entries.get(bar - t.start)!.state;
          const flip = st.volatility === "high" && st.trend_strength !== "weak";
          if (flip) { jointCoinFlip++; const q = vetoProb(st, ENTER_MIN_II); expectedCoinFlipDisagree += 2 * q * (1 - q); }
          if (c !== a) { disagree++; if (flip) disagreeCoinFlip++; }
        }
      }
      absDiff[k] = Math.abs(L.stats.ret - C.stats.ret);
      if (L.stats.ret !== C.stats.ret) differentSleeve++;
    }
    control[w] = {
      jointSignals: joint, disagreements: disagree, disagreementShare: r3(disagree / Math.max(1, joint)),
      jointCoinFlipSignals: jointCoinFlip, coinFlipDisagreementShare: r3(disagreeCoinFlip / Math.max(1, jointCoinFlip)),
      coinFlipDisagreementClosedForm: r3(expectedCoinFlipDisagree / Math.max(1, jointCoinFlip)),
      liveEntriesWithoutASameBarControlEntry: r3(1 - matched / Math.max(1, liveEntries)),
      sleevesDifferInShareOfDraws: r3(differentSleeve / CTRL_DRAWS), absSleeveRetGap: summarize(absDiff),
    };
  }
  say("control divergence done");

  // ── composition of the rulebook's own entries (primary evaluation) ────
  const composition: Record<string, unknown> = {};
  for (const w of scoredWindows(PRIMARY)) {
    const states: CategoricalState[] = [];
    runArm(PRIMARY, w, () => rulePolicy, { states });
    const by = (pred: (s: CategoricalState) => boolean) => states.filter(pred).length;
    composition[w] = {
      ruleEntries: states.length, weak: by((s) => s.trend_strength === "weak"),
      coinFlip: by((s) => s.trend_strength !== "weak" && s.volatility === "high"), calm: by((s) => s.trend_strength !== "weak" && s.volatility !== "high"),
      momentumUnknown: by((s) => s.momentum_30d !== "positive"),
      expectedVetoShareUnderII: r3(meanOf(states.map((s) => vetoProb(s, ENTER_MIN_II)))),
      oosYears: r3((ruleArm[PRIMARY.id][w]!.stats.days) / 365),
    };
  }

  // ── inputs unchanged for the whole run ─────────────────────────────────
  const hashesEnd = { backtestTs: await sha(btUrl), agentsStrategyTs: await sha(rbUrl), answersJson: await sha(answersPath) };
  if (JSON.stringify(hashesEnd) !== JSON.stringify(hashesStart)) throw new Error("an input changed while this study ran — rerun it");

  // Which wording the answers are to (their provenance says, from v2 on), and — for any wording but v1, whose bands
  // are described in words above — every threshold from 0.30 to 0.85 read straight off the answers: how many of the
  // states history reaches (momentum positive) and of all ninety are vetoed on every reply, on some, or on none.
  const questionVersion = String((book.provenance?.question as { version?: string } | undefined)?.version ?? "v1");
  const thresholdScan = (() => {
    const rows: { enterMin: number; historical: { vetoed: number; straddle: number; passed: number }; all: { vetoed: number; straddle: number; passed: number }; vetoedCells: string[]; straddleCells: string[] }[] = [];
    for (let c = 30; c <= 85; c++) {
      const em = c / 100;
      const count = (onlyPositive: boolean) => {
        const out = { vetoed: 0, straddle: 0, passed: 0 };
        for (const k of book.bySymbol.keys()) {
          const wds = book.words.get(k)!;
          if (onlyPositive && wds.momentum_30d !== "positive") continue;
          const q = vetoProb(wds, em);
          if (q === 1) out.vetoed++; else if (q === 0) out.passed++; else out.straddle++;
        }
        return out;
      };
      const cells = (pred: (q: number) => boolean) => [...new Set([...book.bySymbol.keys()].filter((k) => pred(vetoProb(book.words.get(k)!, em))).map((k) => cellKey(book.words.get(k)!)))].sort();
      rows.push({ enterMin: em, historical: count(true), all: count(false), vetoedCells: cells((q) => q === 1), straddleCells: cells((q) => q > 0 && q < 1) });
    }
    const deterministic = rows.filter((r) => r.all.straddle === 0).map((r) => r.enterMin);
    return { note: "per threshold: states whose five replies are ALL under it (vetoed every time), SOME under it (a coin flip) and NONE under it (never vetoed); combineDecision vetoes when P < enterMin", deterministicOnAll90: deterministic, rows };
  })();

  const perCoinPrimary = Object.fromEntries(scoredWindows(PRIMARY).map((w) => [w, Object.fromEntries(priced("coinbase", w).map((s) => [s, {
    i_shadow: r4(ruleArm[PRIMARY.id][w]!.per[s].ret), ii_gateMean: r4(mcII[PRIMARY.id][w]!.perCoin[s]), iii_clause: r4(armIII[PRIMARY.id][w]!.per[s].ret),
    entries: { rule: ruleArm[PRIMARY.id][w]!.per[s].entries, iii: armIII[PRIMARY.id][w]!.per[s].entries },
  }]))]));

  const report = {
    study: "the Jev veto on MEASURED answers — the live row's three possible configurations, (i) rule with the model in shadow, (ii) rule ∧ the model as it runs, (iii) rule + the prompt's weak-trend clause as code, on four windows × the four evaluations §3.19 requires, each against a random veto at the same rate",
    row: LIVE_CANDIDATE,
    thresholds: { enterMin: ENTER_MIN_II, cautionExit: CAUTION_EXIT, source: ENTER_MIN_II === SHIPPED_ENTER_MIN ? "agent_strategies.params.enterMin on every row and in the go-live draft; cautionExit is tick.ts's literal" : `--enter-min ${ENTER_MIN_II}: the threshold configuration (ii) is priced at for the wording in --answers (${questionVersion}); cautionExit is tick.ts's literal` },
    ...(questionVersion !== "v1" ? { wording: { version: questionVersion, note: "The band descriptions under measuredSurface.bands, the caveats and liveRecord were written for the v1 wording and its 0.60; for this wording read thresholdScan, which is computed from these answers alone. (iii) is v1's weak-trend clause as code, kept as a reference arm." }, thresholdScan } : {}),
    replay: {
      mode: "measured", answersFile: answersPath, answersSha256: hashesStart.answersJson, answersProvenance: book.provenance,
      states: book.bySymbol.size, replies: book.replies,
      draw: "at every entry signal where tick.ts would ask the model (flat, rulebook says enter, not cooling down), one of the five replies the real model gave to that exact state, uniformly, through the live combineDecision",
      draws: DRAWS, nullDraws: NULL_DRAWS, calibration: { drawsPerStep: CAL_DRAWS, bisectionSteps: CAL_ITERS }, plateauDrawsPerGridPoint: PLATEAU_DRAWS, sideArmDraws: SIDE_DRAWS,
      seeds: "mulberry32, seeded by FNV-1a of (purpose, evaluation, window, coin, draw) — see seedOf",
    },
    caveats: [
      "The answers are today's model (typesafe/jev-1.13-20260917 through OpenRouter, measured 2026-09-22 18:29 UTC). Asking it about a state computed from 2023 candles is legitimate — the state is ten categorical words and carries no date — but it is what the model says NOW, not what it would have said then, and an alias move changes it.",
      "Five replies per state. Where they straddle 0.60 (the high-volatility states) a coin's veto probability is known to within a fifth; `sensitivity.pooledReplies` re-runs (ii) with the 25 replies of each (strength, volatility, momentum) pooled across coins, and the verdict does not rest on the per-coin split.",
      "Repeated calls are treated as independent draws, which is what the measurement shows (the same state flipped across calls seconds apart). If the provider cached answers per state, consecutive bars would be correlated and (ii) would behave more like a deterministic rule on each episode.",
      "No missing answer and no echo failure was measured in 450 calls, and none is modelled; each would be a veto in production (§4.19 counted none in 137 live decisions).",
      "The Kraken-tape and trail evaluations are near-duplicates of the primary one, not independent tests (§3.19); window D is the same on both tapes.",
      "Fills are the next bar's open at the touch plus Revolut X's 9 bps; nothing here measures execution (the maker probe does).",
    ],
    windows: {
      A: "parameters on the first two thirds, the LAST third out of sample (bear)", B: "parameters on the first third, the MIDDLE third out of sample (bull)",
      C: "the first third out of sample after 24 months of extended history (strong bull)", D: "the 12 months before the series out of sample (sideways)",
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
    },
    conditions: { list: CONDITIONS.map((c) => c.id), primary: PRIMARY.id, stopRules: { shipped: stopsOf("shipped", DEFAULT_TREND), trail: stopsOf("trail", DEFAULT_TREND) }, note: "§3.19: a change must beat the incumbent on its WORST window in all four evaluations; they are near-duplicates, and window D is identical on both tapes" },
    data: dataRows,
    fidelity: {
      runGatedThroughTheCacheVsRun: { ...fid, fields: FIELDS, what: "runGated through the flat-bar cache AND through a decider that rebuilds the snapshot every bar, against backtest.ts's run: every coin × priced window × evaluation × venue (Revolut X and Kraken costs), every field and every equity point run samples" },
      incumbent: { worstAbsDiff: r4(incumbentWorstDiff), perCondition: incumbentCheck, what: "the rule arm's sleeve against set2.json's `equal` row (the incumbent) on all four evaluations, and against the published go-live sleeve on the primary one" },
      shadowIsTheRulebook: { evaluationWindowDraws: shadowCells, differences: shadowDiffs, entriesTheModelWasShown: shadowConsulted, wouldHaveVetoed: shadowWouldVeto, what: `configuration (i): combineDecision(…, gate = false) with real draws, ${SHADOW_DRAWS} draws per evaluation × window, compared with the rulebook on sleeve return, drawdown, entries and every coin's return and trades` },
      prosaMomentumClauseChangesNothing: { differences: clauseMomentumDiffs, what: "(iii) with and without the prompt's `momentum_30d is positive` clause, every evaluation × window" },
      thresholdBandsAreTheCodeArms: { checks: equivalences, failures: equivalenceFailures },
    },
    earlierStudy: {
      reproducedByteForByte: { sha256: EARLIER.jevJsonSha256, how: "`--replay recorded` over the same --data/--ext rewrote the committed jev.json with an identical SHA-256, before this file replaced it" },
      census: {
        earlierCount: censusOld, earlierByWindow: censusOldByWindow, matchesPublished: censusMatches,
        actionableByCellAndWindow: censusActionable, actionableTotal,
        entriesVsRun, entriesAgree,
        note: "the earlier census counted every bar on which the rulebook wanted in while flat, including bars inside the re-entry cooldown, where tick.ts never asks the model; the actionable count is what the model is actually shown, and on the rulebook's own path it equals the rulebook's entries and ⌈run's trades / 2⌉",
      },
      null: { perWindow: earlierNull, reproduced: earlierReproduced, finding: "the earlier null refused each SIGNAL with the model's per-signal rate; because a refused signal is asked again on the next bar, it removes far fewer ENTRIES than the arm it was compared with — see entriesRemoved" },
      assumedVsMeasured: Object.fromEntries(Object.keys(EARLIER.census).map((c) => {
        const [st, v, m] = c.split("|");
        const oldP = central.at({ symbol: "BTC/USD", trend_4h: "up", trend_strength: st as CategoricalState["trend_strength"], breakout_4h: "above_range", volatility: v as CategoricalState["volatility"], momentum_30d: m as CategoricalState["momentum_30d"], position: "flat", unrealised: "none", time_in_position: "none", drawdown_from_high: "none" });
        return [c, { earlierP: oldP.healthy, earlierSource: oldP.source, earlierVetoedAt060: oldP.healthy < SHIPPED_ENTER_MIN, measured: surfaceCells[c] }];
      })),
    },
    measuredSurface: { cells: surfaceCells, edges: edge, bands, strictLessThan: "combineDecision vetoes when P < enterMin, so a reply equal to enterMin passes: every band's upper edge is inclusive" },
    composition,
    configurations,
    signalNull,
    sensitivity: { pooledReplies: pooledSens },
    enterMinStructure: { note: "a structure, not a search: nothing is chosen here, because a threshold chosen on the windows that score it is in-sample optimisation (§3.11, §3.19, and the earlier study's own out-of-sample test)", rows: thresholdRows },
    barTests: { what: "§4.15's four tests applied to the SLEEVE on the primary evaluation: Revolut X return > 0, drawdown < 35 %, ≥ 50 % of §3.7's 27-point grid positive (for (ii) the grid point's mean over draws), Kraken-cost return > 0. The book test (≥ $100k a day) is a property of the coins, which all five pass, and is not re-applied.", perWindow: barTests },
    liveRecord: { what: "every agent_decisions row with rule_action = 'enter' (12, read 2026-09-22 18:45 UTC; the loop's last decision 18:19 UTC), recomputed through combineDecision from its recorded answers and set against the measured replies for its state", rows: liveCheck },
    controlDivergence: { what: `the live row and its paper control (trend-4h) both gating on the model, each asking it separately (tick.ts has no answer cache): ${CTRL_DRAWS} paired runs per window on the primary evaluation. Under (i) or (iii) both rows are deterministic and never part.`, perWindow: control },
    perCoinPrimary,
    verdict: {
      standard: "an arm must beat the incumbent (the rulebook, configuration (i)) on its WORST window in all four evaluations AND beat a random veto at the same rate on that worst window (the null does as well or better in ≤ 5 % of draws). Judged on return (the earlier study's metric) and, separately, on return over drawdown (the set study's); for (ii) the worst window is the mean over draws of each draw's worst.",
      ii: { perCondition: verdictRows.ii, passes: passes(verdictRows.ii), passesOnRetOverDD: passesRetOverDD(verdictRows.ii) },
      iii: { perCondition: verdictRows.iii, passes: passes(verdictRows.iii), passesOnRetOverDD: passesRetOverDD(verdictRows.iii) },
    },
    sourceIntegrity: { ...hashesStart, note: "SHA-256 of backtest.ts, agents_strategy.ts and jev_answers.json at the start of the run; the run throws if any changed before it finished" },
  };

  await Deno.writeTextFile(`${outDir}/${OUT_NAME}`, JSON.stringify(report, null, 1));
  say(`wrote ${outDir}/${OUT_NAME}`);
}

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length)) as Record<string, string>;
  const mode = String(args.replay ?? "measured");
  if (mode === "measured") await measuredStudy(args);
  else if (mode === "recorded" || mode === "live") await recordedStudy(args);
  else throw new Error(`--replay ${mode}: expected measured, recorded or live`);
}
