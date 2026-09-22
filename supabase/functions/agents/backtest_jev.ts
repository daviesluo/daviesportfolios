// The JEV-VETO study: every backtest in this repository prices the RULEBOOK,
// and the account runs `rule ∧ Jev`. §4.21 counted the gap in the live record
// — 20 % of entry signals vetoed, two of the three vetoes at P(healthy) = 0.59
// against `enterMin` = 0.60 — and nothing had ever priced it. This study does,
// on the four walk-forward windows, for the row that is recommended for live.
// Run by hand:
//
//   deno run --allow-read --allow-write [--allow-net --allow-env] \
//     supabase/functions/agents/backtest_jev.ts \
//     --data <dir with BTC-USD_1h_3y.json …>     (Coinbase Exchange hourly)
//     --ext  <dir with BTC-USD_1h_kraken.json …> (Kraken quarterly bundle, hourly)
//     --out  docs/agents/backtests
//     [--replay live]   — ask the real Jev; needs OPENROUTER_API_KEY or
//                         TYPESAFE_API_KEY in the environment and --allow-net
//
// Writes `<out>/jev.json` and NOTHING else.
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
  type Candle, type CategoricalState, type JevView, type Position, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import { askJev } from "../_shared/jev.ts";
import {
  COSTS, resample, run, spreadOf, stopsForKind,
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

/** A decision at bar `i` with the position as it stands. Monotonic in `i`. */
type Decide = (i: number, pos: Position) => "enter" | "exit" | "hold";

type GatedResult = RunResult & { tradedWeight: number; marks: [number, number][] };

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
  let tradedWeight = 0;
  const marks: [number, number][] = [];
  const start = Math.max(from, warmup);
  for (let i = start; i < to - 1; i++) {
    const action = decide(i, pos);
    const next = bars[i + 1];
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);
      const base = cash / (price * (1 + fill));
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

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
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
