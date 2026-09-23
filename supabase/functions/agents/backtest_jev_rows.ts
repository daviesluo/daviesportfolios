// THE JEV GATE ON THE TWO PAPER ROWS, A WORDING AND A THRESHOLD PER ROW —
// trend-1h and momentum-1d, priced exactly as `backtest_jev_other.ts` prices
// them (`jev_v2_other.json`), except that each rule's gate may ask its own
// wording of the question and refuse at its own `enterMin`.
//
// `backtest_jev_other.ts` prices what runs since migration 0047 — the v2
// question at `JEV_ENTER_MIN` (0.45) on both rows — and is hard-wired to it: its
// answers loader refuses any file whose `provenance.question.version` is not
// "v2", and its threshold is not a flag. This file is a copy of it with the
// smallest changes that price a DIFFERENT wording per rule at a DIFFERENT
// threshold per rule. Everything else — the rows, the four windows, the four
// evaluations, 2,000 draws, 1,000 null draws, the null and its calibration, the
// seeds, momentum-1d at both the 4-hour and the daily cadence, the checks, the
// verdict and the bar — is that file's, line for line. With the defaults (v2 and
// 0.45 on both) it prices exactly what `jev_v2_other.json` records, and
// `--check-against` proves it cell by cell.
//
// What that file prices, and so this one: at every entry signal where `tick.ts`
// would ask the model (flat, the rulebook says enter, not cooling down) one of
// the replies the model gave to that exact state is drawn uniformly and put
// through the live `combineDecision`; the rulebook and the rulebook ∧ the gate
// run on the four walk-forward windows under the four evaluations §3.19
// requires; and each gate is judged against the episode null as §4.21 corrected
// it — a random veto calibrated to take the SAME NUMBER of entries.
//
// Run by hand, from the repository root:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_jev_rows.ts \
//     --data    <dir with BTC-USD_1h_3y.json …>          (Coinbase Exchange hourly)
//     --ext     <dir with BTC-USD_1h_kraken.json …>      (Kraken quarterly bundle, hourly)
//     --ktape   <dir with BTC-USD_4h_kraken.json …>      (Kraken's own 4h tape, §3.16/§3.19)
//     [--answers    docs/agents/backtests/jev_answers_v2_other.json]   (the default)
//     [--versions   trend-1h=v2,momentum-1d=v2]                        (the default)
//     [--enter-min  trend-1h=0.45,momentum-1d=0.45]                    (the default: JEV_ENTER_MIN)
//     [--prereg     <the pre-registration file>]                       (optional: hashed into the output)
//     [--check-against docs/agents/backtests/jev_v2_other.json]       (optional: see below)
//     [--set2       docs/agents/backtests/set2.json]                   (the published rows the
//     [--testingset docs/agents/backtests/testingset.json]              rule arms must equal)
//     [--out        docs/agents/backtests]                             (the default)
//     [--out-name   jev_rows.json]                                     (the default)
//     [--draws 2000] [--null-draws 1000]                               (the defaults)
//
// The three directories are the ones `backtest_jev.ts` reads: its
// `loadMeasuredSeries` cuts the windows for all five live-row coins, so they must
// hold AVAX's and SUI's files too, and this study prices BTC, ETH and SOL.
//
// Writes `<out>/<out-name>` and NOTHING else, in about fifteen minutes on one
// core. There is no wall clock in the output: two runs over the same inputs
// write the same bytes.
//
// ── what differs from backtest_jev_other.ts; nothing else does ────────
//
//   --versions      `kind=id,…`: the wording each rule's replies must be to.
//                   The answers loader reads, per kind,
//                   `provenance.question.byKind[kind]` when the file has it,
//                   else `provenance.question.version`, and refuses the file
//                   unless that is the id named here — before anything is
//                   priced. Every other check the loader makes is unchanged.
//   --enter-min     `kind=x,…`, each in (0, 1): a row is priced at its kind's
//                   threshold (both momentum-1d cadences share one) everywhere
//                   the old file used `JEV_ENTER_MIN` — the gate, the shadow's
//                   would-have-refused count, the veto shares, the states whose
//                   replies straddle it, `refusedSignals` and `atThreshold`. The
//                   threshold scan does not depend on it and is unchanged.
//                   A kind that either flag does not name keeps its default.
//                   An unknown flag, a flag with no value, an unknown kind or a
//                   malformed value throws, so a typo cannot price a default.
//   --prereg        recorded by path and SHA-256 (`preRegistration`), and
//                   hashed at both ends of the run like every other input.
//   --check-against a committed `jev_v2_other.json`, read before anything is
//                   priced. After the run every cell both outputs have — every
//                   number, boolean, string and null, and every array's length
//                   — is compared exactly, except the fields `CHECK_EXCLUDED`
//                   lists with its reasons (paths, hashes, provenance, and the
//                   prose that names this script or its wordings). Any
//                   difference throws, listing them, and nothing is written. The
//                   output records what was compared and excluded, and the
//                   paths only one side has.
//   --out-name      the file written in `--out`; the default is not the old
//                   study's, so a default run never overwrites it.
//   The output records each row's wording and threshold, the answers file and
//   its SHA-256, and the SHA-256 of every file in the module graph: the old
//   file's four with this script in place of that one, and `_shared/jev.ts`,
//   which `backtest_jev.ts` imports. The three caveats that stated facts about
//   the v2 answers (the model and time, the replies straddling 0.45, the 1,215
//   calls) are computed from the answers file instead, and the one about the
//   null names the run it read.
//
// ── why backtest_jev_other.ts is not modified ─────────────────────────
//
// Its SHA-256 is recorded by the committed `jev_v2_other.json`
// (`sourceIntegrity.backtestJevOtherTs`) and cited by its write-up
// (`docs/agents/reviews/2026-09-23-jev-gates-paper-rows.md` §9): edited, it
// would no longer be the script that wrote that file, and the study it prices —
// what runs — would lose its record. It exports nothing, so its machinery cannot
// be imported; hence a copy, whose default run reproduces it (`--check-against`).
//
// ── what is imported and what is not ──────────────────────────────────
//
// `backtest_jev.ts` is NOT modified by this study; its SHA-256 is recorded by
// the committed `sizing.json` and by this study's output. Its machinery is
// IMPORTED: `runGated` (the one copy of `backtest.ts`'s `run`, with a decision
// callback), `loadMeasuredSeries` (the splice, its acceptance test and the four
// windows on both tapes, so the 4-hour spans here ARE the live candidate's),
// `combine` / `dailyReturns` (the sleeve arithmetic), `episodeNullPolicy`,
// `seedOf` / `mulberry32`, `stopsOf`, `CONDITIONS`, `rulePolicy` and the
// statistics. The live `combineDecision`, `buildSnapshot`, `ruleFor` and
// `JEV_ENTER_MIN` come from the rulebook; `run`, `COSTS`, `resample` and
// `SHIPPED_STOPS` from `backtest.ts`.
//
// What is new here is only what the live-row study had no need of: a track and
// a decider for any rule, bar size and cadence (`backtest_jev.ts`'s are the
// trend-4h rule on 4-hour bars), the hourly bars trend-1h reads (loaded from the
// same files, and proved to resample to `loadMeasuredSeries`'s 4-hour and daily
// series candle for candle), the daily cadence's episode null, and the answer
// book of rules whose entry states vary more words. What `backtest_jev.ts` holds
// unexported is restated below with its source: the caution veto 1.75 (`tick.ts`'s
// literal), the widest lookback 301 and the state vocabulary.
//
// ── the rows, as migrations 0037 and 0047 leave them ──────────────────
//
// BTC / ETH / SOL on Revolut X, $40 in three equal slots, the seeded trend
// parameters, `lookbackDays` 30, the 8 % floor, `enterMin` 0.45 and the v2
// question (what `--enter-min` and `--versions` default to).
//
//   trend-1h           the trend rulebook on 1-hour bars, decided every hour with
//                      a two-bar cooldown: how `backtest.ts` and §3.17 price it
//                      and how `tick.ts` runs it (decision bar = state bar = 1 h).
//   momentum-1d        decided on every closed 4-hour bar with a two-bar (8-hour)
//                      cooldown: how every published table prices the row
//                      (`backtest.ts`, §3.17, `set2.json`), so its rulebook arm
//                      is checked against `set2.json` on all four evaluations.
//   momentum-1d·daily  how `tick.ts` runs it: the state on the last closed 4-hour
//                      bar (`stateBarMs`), the decision claimed once per DAILY
//                      candle (`decisionBarMs`) — so the model is asked at most
//                      once a day, on the 4-hour bar that closes at 00:00 UTC —
//                      and a two-day cooldown (`REENTRY_BARS` × one day = 12
//                      four-hour bars; exact after a protective exit, which fills
//                      inside a bar; after a rule exit the loop may re-enter at
//                      exactly 48 h, depending on seconds, and this waits the
//                      extra day). A refused entry is asked again a day later
//                      here and four hours later in the row above, which is most
//                      of what a gate on this rule does; hence both cadences.
//
// THE TAPES. momentum-1d reads the live row's two 4-hour arms. trend-1h needs
// hourly bars: the Coinbase-spliced hourly series (§3.17's) and Kraken's own
// hourly bundle, which ENDS 2026-06-30 — so trend-1h cannot be priced on Kraken's
// tape in window A (`set2.json` records the same limit), and on that tape its
// worst window is taken over B, C and D.
//
// THE TRAIL. Under the trail stop rule momentum-1d carries the 3×ATR(14)
// intra-bar trail, as `set2.json` priced the row. §3.17 (`testingset.json`) gave
// momentum the floor alone under both rules (§3.3a: it never carried a trail);
// on that reading its two trail evaluations are its shipped ones, and the verdict
// is also given on the shipped evaluations alone.
//
// ── the checks the run makes before it prices anything ────────────────
//
// `runGated` through the flat-bar cache against a decider that rebuilds the
// snapshot and the cadence on every bar (every field and every mark), and — on
// the rows decided every bar — against `backtest.ts`'s `run` (every field and
// every equity point it samples), on every row × evaluation × window × coin ×
// venue cost; the rule arms against `set2.json` and `testingset.json` wherever
// they publish the row (any difference throws); window D identical on both tapes;
// shadow mode (`combineDecision(…, gate = false)` with real draws) identical to
// the rulebook. Every input is hashed at both ends of the run, and a run that
// straddles an edit throws.

import {
  buildSnapshot, combineDecision, DEFAULT_TREND, FLAT, JEV_ENTER_MIN, precompute, ruleFor,
  type Action, type Candle, type CategoricalState, type JevView, type TrendParams,
} from "../_shared/agents_strategy.ts";
import { COSTS, resample, run, SHIPPED_STOPS, type Costs, type StopParams } from "./backtest.ts";
import {
  atLeast, atLeastPairs, combine, CONDITIONS, dailyReturns, episodeNullPolicy, indexAtOrAfter, iso, loadMeasuredSeries,
  MAX_ORDER_USD, meanOf, mulberry32, PRIMARY, r3, r4, rulePolicy, runGated, seedOf, stopsOf, summarize, toCandles, WIN_NAMES,
  type Condition, type Decide, type EntryPolicy, type GatedResult, type PolicyFor, type SleeveStats, type StopRule, type Tape,
  type Track, type WinName,
} from "./backtest_jev.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]

// ───────────────────────────────────────── restated from backtest_jev.ts, unexported there

/** `tick.ts`'s literal caution veto (`combineDecision(…, { cautionExit: 1.75 })`); `backtest_jev.ts`'s `CAUTION_EXIT`. */
const CAUTION_EXIT = 1.75;
/** `backtest_jev.ts`'s `MAX_LOOKBACK`: a span on Kraken's tape must be longer than this many bars plus two. */
const MAX_LOOKBACK = 301;
/** The state words an entry may vary in (`CategoricalState`), as `backtest_jev.ts` lists them. */
const STRENGTHS = ["weak", "moderate", "strong"] as const;
const VOLS = ["low", "normal", "high"] as const;
const MOMENTA = ["positive", "unknown"] as const;
/** One reply of the real model, exactly as `agents?action=jev` returned it. */
type Reply = { healthy: number; caution: number };
/** A flat bar where the rulebook says enter: its reason and the state the model would be shown (`Track.entries`). */
type FlatEntry = { action: Action; reason: string; state: CategoricalState };

// ─────────────────────────────────────────────────────────────────── the rows

type OtherKind = "trend-1h" | "momentum-1d";
type Cadence = "bar" | "daily";
type OtherRow = {
  id: string; row: string; kind: OtherKind; cadence: Cadence; barHours: number; reentryBars: number;
  symbols: string[]; capitalUsd: number; slots: number; what: string;
};
const PAPER_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD"];
/** The two paper rows as migrations 0037 and 0047 leave them, momentum-1d at both cadences (see the header). */
const OTHER_ROWS: readonly OtherRow[] = [
  {
    id: "trend-1h", row: "trend-1h", kind: "trend-1h", cadence: "bar", barHours: 1, reentryBars: SHIPPED_STOPS.reentryBars,
    symbols: PAPER_SYMBOLS, capitalUsd: 40, slots: 3,
    what: "the trend rulebook on 1-hour bars, decided every hour with a two-bar cooldown — how backtest.ts and §3.17 price it and how tick.ts runs it",
  },
  {
    id: "momentum-1d", row: "momentum-1d", kind: "momentum-1d", cadence: "bar", barHours: 4, reentryBars: SHIPPED_STOPS.reentryBars,
    symbols: PAPER_SYMBOLS, capitalUsd: 40, slots: 3,
    what: "decided on every closed 4-hour bar with a two-bar (8-hour) cooldown — how backtest.ts, §3.17 and set2.json price the row",
  },
  {
    id: "momentum-1d·daily", row: "momentum-1d", kind: "momentum-1d", cadence: "daily", barHours: 4, reentryBars: 12,
    symbols: PAPER_SYMBOLS, capitalUsd: 40, slots: 3,
    what: "how tick.ts runs the row: the state on the last closed 4-hour bar, the decision once a day on the bar that closes at 00:00 UTC, a two-day (12-bar) cooldown",
  },
];

// ──────────────────────────────────────────────────────────────── the answers

/** The six words an entry state of these rules is free to vary in; `FLAT_ON_ENTRY` holds the other four. */
type OtherWords = { symbol: string; trend_4h: string; trend_strength: string; breakout_4h: string; volatility: string; momentum_30d: string };
const otherKey = (s: OtherWords) => `${s.symbol}|${s.trend_4h}|${s.trend_strength}|${s.breakout_4h}|${s.volatility}|${s.momentum_30d}`;
const otherCell = (s: OtherWords) => `${s.trend_4h}|${s.trend_strength}|${s.breakout_4h}|${s.volatility}|${s.momentum_30d}`;
/** What being flat forces on every entry state, whatever the rule. */
const FLAT_ON_ENTRY: Record<string, string> = { position: "flat", unrealised: "none", time_in_position: "none", drawdown_from_high: "none" };
type OtherBook = { kind: OtherKind; bySymbol: Map<string, Reply[]>; words: Map<string, OtherWords>; replies: number };

/**
 * Every entry state a rule can show the model. trend-1h enters on the trend rule's words (trend up, breakout above the
 * range, momentum positive or unknown); momentum-1d on positive momentum whatever the 4-hour picture, so trend and
 * breakout are free too — and a flat trend is always weak (`buildSnapshot`). Volatility is never extreme on an entry.
 */
function otherEntrySpace(kind: OtherKind, symbols: readonly string[]): OtherWords[] {
  const out: OtherWords[] = [];
  for (const symbol of symbols) {
    if (kind === "trend-1h") {
      for (const trend_strength of STRENGTHS) for (const volatility of VOLS) for (const momentum_30d of MOMENTA) {
        out.push({ symbol, trend_4h: "up", trend_strength, breakout_4h: "above_range", volatility, momentum_30d });
      }
      continue;
    }
    for (const trend_4h of ["up", "down", "flat"]) for (const trend_strength of STRENGTHS) {
      if (trend_4h === "flat" && trend_strength !== "weak") continue;
      for (const breakout_4h of ["above_range", "inside_range", "below_range"]) for (const volatility of VOLS) {
        out.push({ symbol, trend_4h, trend_strength, breakout_4h, volatility, momentum_30d: "positive" });
      }
    }
  }
  return out;
}

/**
 * Read one rule's states from the answers file (`jev_answers_v2_other.json`'s shape), and refuse anything but its whole
 * entry space, echo-verified, to the wording `version`: the file's `provenance.question.byKind[kind]` when it has one,
 * else its `provenance.question.version`.
 */
function loadOtherAnswers(text: string, kind: OtherKind, symbols: readonly string[], version: string): OtherBook {
  const j = JSON.parse(text) as { provenance?: { question?: { version?: string; byKind?: Record<string, unknown> }; fixedOnEveryState?: Record<string, string> } } & Record<string, unknown>;
  const wording = j.provenance?.question?.byKind?.[kind] ?? j.provenance?.question?.version;
  if (wording !== version) throw new Error(`answers (${kind}): the wording is ${JSON.stringify(wording)}; --versions prices ${kind} at ${JSON.stringify(version)}`);
  const fixed = j.provenance?.fixedOnEveryState ?? {};
  for (const [k, v] of Object.entries(FLAT_ON_ENTRY)) {
    if (fixed[k] !== v) throw new Error(`answers: fixedOnEveryState.${k} is ${fixed[k]}, but being flat forces ${v}`);
  }
  const states = j[kind] as (OtherWords & { healthy: number[]; caution: number[]; echoOk: boolean })[] | undefined;
  if (!Array.isArray(states)) throw new Error(`answers: no "${kind}" states`);
  const space = new Set(otherEntrySpace(kind, symbols).map(otherKey));
  const bySymbol = new Map<string, Reply[]>(), words = new Map<string, OtherWords>();
  let replies = 0;
  for (const s of states) {
    const k = otherKey(s);
    if (!space.has(k)) throw new Error(`answers (${kind}): ${k} is not an entry state this rule can reach`);
    if (!s.echoOk) throw new Error(`answers (${kind}): an echo failed on ${k} — production reads that as no answer, a veto, and so must this`);
    if (s.healthy.length === 0 || s.healthy.length !== s.caution.length) throw new Error(`answers (${kind}): ${k} has ${s.healthy.length} P values and ${s.caution.length} caution values`);
    if (bySymbol.has(k)) throw new Error(`answers (${kind}): ${k} appears twice`);
    bySymbol.set(k, s.healthy.map((h, i) => ({ healthy: h, caution: s.caution[i] })));
    words.set(k, { symbol: s.symbol, trend_4h: s.trend_4h, trend_strength: s.trend_strength, breakout_4h: s.breakout_4h, volatility: s.volatility, momentum_30d: s.momentum_30d });
    replies += s.healthy.length;
  }
  for (const k of space) if (!bySymbol.has(k)) throw new Error(`answers (${kind}): ${k} was never measured`);
  return { kind, bySymbol, words, replies };
}

/** A state the model is consulted about must be inside the rule's measured space. */
function assertOtherEntryState(kind: OtherKind, s: CategoricalState): void {
  const rec = s as unknown as Record<string, string>;
  for (const [k, v] of Object.entries(FLAT_ON_ENTRY)) {
    if (rec[k] !== v) throw new Error(`a ${kind} entry state with ${k} = ${rec[k]} is outside the measured space (being flat forces ${v})`);
  }
  if (kind === "trend-1h" && (s.trend_4h !== "up" || s.breakout_4h !== "above_range")) throw new Error(`a trend-1h entry with trend ${s.trend_4h} and breakout ${s.breakout_4h} is outside the measured space`);
  if (kind === "momentum-1d" && s.momentum_30d !== "positive") throw new Error(`a momentum-1d entry with momentum ${s.momentum_30d} is outside the measured space`);
}

/** The share of a state's measured replies on which the live `combineDecision` refuses the entry. */
function vetoShare(rs: Reply[], enterMin: number): number {
  let v = 0;
  for (const r of rs) {
    const view: JevView = { healthy: r.healthy, caution: r.caution, echoOk: true, provider: "openrouter" };
    if (combineDecision({ action: "enter", reason: "" }, view, { enterMin, cautionExit: CAUTION_EXIT }).action !== "enter") v++;
  }
  return v / rs.length;
}

// ─────────────────────────────────────────────────────────────── the policies

/** `backtest_jev.ts`'s `jevPolicy` for these rows: one of the measured replies to THIS state, drawn uniformly, through the live `combineDecision`. */
function otherJevPolicy(kind: OtherKind, book: OtherBook, rng: () => number, enterMin: number, gate: boolean): EntryPolicy {
  return (_i, s, rule) => {
    assertOtherEntryState(kind, s);
    const rs = book.bySymbol.get(otherKey(s));
    if (!rs) throw new Error(`no measured ${kind} answer for ${otherKey(s)}`);
    const r = rs[Math.floor(rng() * rs.length)];
    const view: JevView = { healthy: r.healthy, caution: r.caution, echoOk: true, provider: "openrouter" };
    return combineDecision(rule, view, { enterMin, cautionExit: CAUTION_EXIT }, gate).action === "enter" ? "enter" : "hold";
  };
}

/**
 * The episode null at the rule's own decision stride. An episode is a run of consecutive DECISIONS on which the rulebook
 * wants in: consecutive bars — `backtest_jev.ts`'s `episodeNullPolicy`, imported — or, on the daily cadence, consecutive
 * days (every sixth 4-hour bar), where this is the same construction with `i - 1` read as `i - stride`.
 */
function episodeNullAt(stride: number, pEp: number, rng: () => number): EntryPolicy {
  if (stride === 1) return episodeNullPolicy(pEp, rng);
  let lastBar = -Infinity, refusing = false;
  return (i) => {
    if (refusing && lastBar === i - stride) { lastBar = i; return "hold"; }
    lastBar = i;
    refusing = rng() < pEp;
    return refusing ? "hold" : "enter";
  };
}

type OtherTally = { signals: number; refused: number; callByCall: number; callByCallRefused: number };
/** `backtest_jev.ts`'s `counting` for these rows: every consultation, every refusal, and those in states whose replies straddle the threshold. */
function countingOther(pol: EntryPolicy, c: OtherTally, straddling: Set<string>, states?: CategoricalState[]): EntryPolicy {
  return (i, s, r) => {
    const a = pol(i, s, r);
    c.signals++;
    if (a === "hold") c.refused++;
    if (straddling.has(otherKey(s))) { c.callByCall++; if (a === "hold") c.callByCallRefused++; }
    if (states) states.push(s);
    return a;
  };
}

// ───────────────────────────────────────────────────────── tracks and deciders

/** A `Track` for any of these rules and bar sizes, with the bars on which the rule is decided at all. */
type OtherTrack = Track & { kind: OtherKind; cadence: Cadence; barHours: number; decides: Uint8Array };

/** Is the bar starting at `startMs` one the rule is decided on? Every bar; or, daily, the bar that closes at a UTC midnight. */
const decidedOn = (cadence: Cadence, startMs: number, barHours: number) => cadence === "bar" || (startMs + barHours * 3600e3) % 86400e3 === 0;

/** `backtest_jev.ts`'s `buildTrack` for any rule, bar size and cadence: the flat decision on every bar, and which bars are decided. */
function buildOtherTrack(kind: OtherKind, cadence: Cadence, symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, from: number, to: number, barHours: number): OtherTrack {
  const pre = precompute(bars, p);
  const warmup = p.slow + 1, start = Math.max(from, warmup), n = Math.max(0, to - 1 - start);
  const flatEnter = new Uint8Array(n), dkAt = new Int32Array(n), decides = new Uint8Array(n);
  const entries = new Map<number, FlatEntry>();
  const closed: Candle[] = [];
  const barMs = barHours * 3600e3, perYear = (24 / barHours) * 365;
  let dk = 0;
  for (let i = start; i < to - 1; i++) {
    const nowMs = bars[i].start + barMs;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    dkAt[i - start] = dk;
    decides[i - start] = decidedOn(cadence, bars[i].start, barHours) ? 1 : 0;
    const snap = buildSnapshot(symbol, bars, i, closed, FLAT, nowMs, p, pre, perYear);
    const rule = ruleFor(kind, snap, FLAT, p);
    if (rule.action === "exit") throw new Error(`${symbol} bar ${i}: the ${kind} rulebook said exit while flat`);
    if (rule.action === "enter") {
      flatEnter[i - start] = 1;
      entries.set(i - start, { action: rule.action, reason: rule.reason, state: snap.state });
    }
  }
  return { symbol, bars, daily, p, from, to, warmup, start, pre, flatEnter, entries, dkAt, kind, cadence, barHours, decides };
}

/** `backtest_jev.ts`'s `trackDecider` for these rows: no bar decision off the cadence (the stops still run, in `runGated`), the flat cache on it. */
function otherTrackDecider(t: OtherTrack, policy: EntryPolicy): Decide {
  const closed: Candle[] = [];
  let dk = 0;
  const barMs = t.barHours * 3600e3, perYear = (24 / t.barHours) * 365;
  return (i, pos, coolingDown) => {
    const k = i - t.start;
    if (t.decides[k] === 0) return "hold";
    if (pos.base === 0) {
      if (t.flatEnter[k] === 0) return "hold";
      if (coolingDown) return "enter";   // refused by runGated; tick.ts holds before asking the model
      const f = t.entries.get(k)!;
      return policy(i, f.state, f);
    }
    const want = t.dkAt[k];
    while (dk < want) { closed.push(t.daily[dk]); dk++; }
    const snap = buildSnapshot(t.symbol, t.bars, i, closed, pos, t.bars[i].start + barMs, t.p, t.pre, perYear);
    return ruleFor(t.kind, snap, pos, t.p).action;
  };
}

/** The same decision WITHOUT the cache — `buildSnapshot` on every bar, the cadence recomputed — comparing each flat bar with the cache. */
function otherCheckedDecider(t: OtherTrack, policy: EntryPolicy, tally: { flatBars: number; mismatches: number }): Decide {
  const closed: Candle[] = [];
  let dk = 0;
  const barMs = t.barHours * 3600e3, perYear = (24 / t.barHours) * 365;
  return (i, pos, coolingDown) => {
    const nowMs = t.bars[i].start + barMs;
    while (dk < t.daily.length && t.daily[dk].start + 86400e3 <= nowMs) { closed.push(t.daily[dk]); dk++; }
    const snap = buildSnapshot(t.symbol, t.bars, i, closed, pos, nowMs, t.p, t.pre, perYear);
    const rule = ruleFor(t.kind, snap, pos, t.p);
    const k = i - t.start;
    const decides = t.cadence === "bar" || nowMs % 86400e3 === 0;
    if (pos.base === 0) {
      tally.flatBars++;
      const cached = t.flatEnter[k] === 1 ? t.entries.get(k) ?? null : null;
      const same = dk === t.dkAt[k] && (t.decides[k] === 1) === decides && (cached
        ? rule.action === "enter" && cached.reason === rule.reason && JSON.stringify(cached.state) === JSON.stringify(snap.state)
        : rule.action === "hold");
      if (!same) tally.mismatches++;
    }
    if (!decides) return "hold";
    if (rule.action !== "enter" || coolingDown) return rule.action;
    return policy(i, snap.state, rule);
  };
}

/** `backtest_jev.ts`'s `sleeveStatsOf` at the row's own slot. */
function otherSleeveStats(row: OtherRow, per: Record<string, GatedResult>): SleeveStats {
  const slot = Math.min(row.capitalUsd / row.slots, MAX_ORDER_USD);
  return combine(Object.entries(per).map(([s, r]) => ({
    id: `${row.id}·revx·${s.split("/")[0]}`, symbol: s, slotUsd: slot, rets: dailyReturns(r.marks),
    ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * slot,
  })));
}

// ──────────────────────────────────────────── the flags this copy adds, and the check

/** Every flag the study reads. Any other throws, so that a misspelt `--enter-min` cannot price the default in silence. */
const KNOWN_FLAGS = ["data", "ext", "ktape", "answers", "versions", "enter-min", "prereg", "check-against", "set2", "testingset", "out", "out-name", "draws", "null-draws"];

/** `trend-1h=a,momentum-1d=b` → a value per kind. A kind the flag does not name keeps its default; anything malformed throws. */
function perKind<T>(flag: string | undefined, name: string, defaults: Record<OtherKind, T>, parse: (v: string) => T): Record<OtherKind, T> {
  const out = { ...defaults };
  if (flag == null) return out;
  const named = new Set<string>();
  for (const part of flag.split(",")) {
    const eq = part.indexOf("="), kind = part.slice(0, eq).trim(), value = part.slice(eq + 1).trim();
    if (eq < 0 || !value) throw new Error(`${name}: "${part}" is not kind=value`);
    if (!Object.hasOwn(defaults, kind)) throw new Error(`${name}: "${kind}" is not a rule here (${Object.keys(defaults).join(", ")})`);
    if (named.has(kind)) throw new Error(`${name}: ${kind} is named twice`);
    named.add(kind);
    out[kind as OtherKind] = parse(value);
  }
  return out;
}

/**
 * What `--check-against` does not compare, and why: each field differs from a `jev_v2_other.json` by construction — a
 * path, a hash, the answers file's provenance copied, or prose that names this script or its wordings — never by what
 * was priced. Every other cell both outputs have is compared exactly.
 */
const CHECK_EXCLUDED: Record<string, string> = {
  study: "prose naming the wording and threshold priced per rule",
  script: "prose naming the script",
  "thresholds.source": "prose saying where the thresholds come from",
  caveats: "prose; the sentences about the answers file are computed from it here",
  "answers.file": "a path",
  "answers.sha256": "an input's hash",
  "answers.provenance": "the answers file's own provenance, copied",
  preRegistration: "a path and a hash",
  checkAgainst: "this comparison's own record",
  sourceIntegrity: "the sources' hashes: this script is not backtest_jev_other.ts",
};
/** The sections a reference must share cells in, so that a wrong file cannot pass by sharing nothing. */
const CHECK_SECTIONS = ["rows", "answers", "fidelity", "refusedSignals", "switchedOff", "configurations", "perCoinPrimary", "verdict"];
type CheckResult = {
  compared: { numbers: number; booleans: number; strings: number; nulls: number; arrayLengths: number; bySection: Record<string, number> };
  differences: { path: string; here: unknown; there: unknown }[];
  onlyHere: string[]; onlyThere: string[];
};

/** Walk two outputs together: every cell both have is compared exactly, except under `excluded`; a change of type is a difference. */
function compareReports(here: unknown, there: unknown, excluded: Record<string, string>): CheckResult {
  const out: CheckResult = { compared: { numbers: 0, booleans: 0, strings: 0, nulls: 0, arrayLengths: 0, bySection: {} }, differences: [], onlyHere: [], onlyThere: [] };
  const typeOf = (v: unknown) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  const counted = (path: string) => { const s = path.split(/[.[]/)[0]; out.compared.bySection[s] = (out.compared.bySection[s] ?? 0) + 1; };
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Object.hasOwn(excluded, path)) return;
    const ta = typeOf(a), tb = typeOf(b);
    if (ta !== tb) { counted(path); out.differences.push({ path, here: a, there: b }); return; }
    if (ta === "array") {
      const xa = a as unknown[], xb = b as unknown[];
      out.compared.arrayLengths++; counted(path);
      if (xa.length !== xb.length) out.differences.push({ path: `${path}.length`, here: xa.length, there: xb.length });
      for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
        if (i >= xb.length) out.onlyHere.push(`${path}[${i}]`);
        else if (i >= xa.length) out.onlyThere.push(`${path}[${i}]`);
        else walk(xa[i], xb[i], `${path}[${i}]`);
      }
      return;
    }
    if (ta === "object") {
      const oa = a as Record<string, unknown>, ob = b as Record<string, unknown>;
      const at = (k: string) => path ? `${path}.${k}` : k;
      for (const k of Object.keys(oa)) if (!Object.hasOwn(ob, k) && !Object.hasOwn(excluded, at(k))) out.onlyHere.push(at(k));
      for (const k of Object.keys(ob)) if (!Object.hasOwn(oa, k) && !Object.hasOwn(excluded, at(k))) out.onlyThere.push(at(k));
      for (const k of Object.keys(oa)) if (Object.hasOwn(ob, k)) walk(oa[k], ob[k], at(k));
      return;
    }
    if (ta === "number") out.compared.numbers++;
    else if (ta === "boolean") out.compared.booleans++;
    else if (ta === "string") out.compared.strings++;
    else out.compared.nulls++;
    counted(path);
    if (a !== b) out.differences.push({ path, here: a, there: b });
  };
  walk(here, there, "");
  return out;
}

// ───────────────────────────────────────────────────────────────── the study

async function otherRowsStudy(args: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(args)) {
    if (!KNOWN_FLAGS.includes(k)) throw new Error(`unknown flag --${k} (see the header)`);
    if (v == null) throw new Error(`--${k} needs a value`);
  }
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? "");
  const answersPath = String(args.answers ?? "docs/agents/backtests/jev_answers_v2_other.json");
  const set2Path = String(args.set2 ?? "docs/agents/backtests/set2.json");
  const testingSetPath = String(args.testingset ?? "docs/agents/backtests/testingset.json");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const OUT_NAME = String(args["out-name"] ?? "jev_rows.json");
  const preregPath = String(args.prereg ?? ""), checkPath = String(args["check-against"] ?? "");
  const DRAWS = Number(args.draws ?? 2000), NULL_DRAWS = Number(args["null-draws"] ?? 1000);
  /**
   * Each rule's wording and threshold: `--versions` and `--enter-min`, per kind (both momentum-1d cadences share
   * momentum-1d's). The defaults are what the rows run since migration 0047 — the v2 question at `JEV_ENTER_MIN`.
   */
  const VERSIONS = perKind(args.versions, "--versions", { "trend-1h": "v2", "momentum-1d": "v2" }, (v) => v);
  const ENTER_MINS = perKind(args["enter-min"], "--enter-min", { "trend-1h": JEV_ENTER_MIN, "momentum-1d": JEV_ENTER_MIN }, Number);
  /** `backtest_jev.ts`'s measured replay's calibration and shadow settings, unchanged. */
  const CAL_DRAWS = 100, CAL_ITERS = 10, SHADOW_DRAWS = 20;
  const rows = OTHER_ROWS;
  if (!dataDir || !extDir || !kDir) throw new Error("needs --data, --ext and --ktape (see the header)");
  if (!(DRAWS >= 10 && NULL_DRAWS >= 10)) throw new Error("--draws and --null-draws must be at least 10");
  for (const [k, em] of Object.entries(ENTER_MINS)) if (!(em > 0 && em < 1)) throw new Error(`--enter-min: ${k} is ${em}; it must be in (0, 1)`);
  if (/[/\\]/.test(OUT_NAME) || OUT_NAME === "." || OUT_NAME === "..") throw new Error(`--out-name is a file name, not a path: ${OUT_NAME}`);
  await Deno.mkdir(outDir, { recursive: true });

  const sha = async (path: string | URL) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btUrl = new URL("./backtest.ts", import.meta.url), jevUrl = new URL("./backtest_jev.ts", import.meta.url);
  const rbUrl = new URL("../_shared/agents_strategy.ts", import.meta.url), selfUrl = new URL(import.meta.url);
  const jevClientUrl = new URL("../_shared/jev.ts", import.meta.url);
  const hashNow = async () => ({
    backtestTs: await sha(btUrl), backtestJevTs: await sha(jevUrl), backtestJevRowsTs: await sha(selfUrl),
    agentsStrategyTs: await sha(rbUrl), sharedJevTs: await sha(jevClientUrl),
    answersJson: await sha(answersPath), set2Json: await sha(set2Path), testingSetJson: await sha(testingSetPath),
    ...(preregPath ? { preRegistration: await sha(preregPath) } : {}),
  });
  const hashesStart = await hashNow();
  const answersText = await Deno.readTextFile(answersPath);
  const answersProvenance = (JSON.parse(answersText) as { provenance: Record<string, unknown> }).provenance;
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const books: Partial<Record<OtherKind, OtherBook>> = {};
  for (const k of kinds) books[k] = loadOtherAnswers(answersText, k, PAPER_SYMBOLS, VERSIONS[k]);
  const bookOf = (kind: OtherKind) => books[kind]!;
  // The output `--check-against` compares with, read now, so that a wrong file fails before the pricing does.
  let reference: { path: string; sha256: string; json: Record<string, unknown> } | null = null;
  if (checkPath) {
    reference = { path: checkPath, sha256: await sha(checkPath), json: JSON.parse(await Deno.readTextFile(checkPath)) };
    const missing = CHECK_SECTIONS.filter((s) => reference!.json[s] == null);
    if (missing.length) throw new Error(`--check-against ${checkPath}: no ${missing.join(", ")} — not a jev_v2_other.json`);
  }
  // The share of each state's replies that refuse at its rule's threshold, and the states whose replies straddle it.
  const qAt: Partial<Record<OtherKind, Map<string, number>>> = {}, straddling: Partial<Record<OtherKind, Set<string>>> = {};
  for (const k of kinds) {
    qAt[k] = new Map([...bookOf(k).bySymbol.entries()].map(([key, rs]) => [key, vetoShare(rs, ENTER_MINS[k])]));
    straddling[k] = new Set([...qAt[k]!.entries()].filter(([, q]) => q > 0 && q < 1).map(([key]) => key));
  }
  const qOf = (kind: OtherKind, s: OtherWords) => {
    const q = qAt[kind]!.get(otherKey(s));
    if (q == null) throw new Error(`no measured ${kind} answer for ${otherKey(s)}`);
    return q;
  };
  const t0 = Date.now();
  const say = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${m}`);
  say(`priced: ${kinds.map((k) => `${k} ${VERSIONS[k]} at ${ENTER_MINS[k]}`).join(", ")}${checkPath ? ` | checked against ${checkPath}` : ""}${preregPath ? ` | pre-registration ${preregPath}` : ""}`);

  // ── the data: `loadMeasuredSeries`'s windows and 4-hour arms, plus the hourly arms trend-1h reads ──
  type HSpan = { from: number; to: number };
  type OSeries = {
    comb4h: Candle[]; combDaily: Candle[]; combH: Candle[]; kTape: Candle[]; kDaily4: Candle[]; kH: Candle[]; kDailyH: Candle[];
    spans: Record<"h1" | "h4", Record<Tape, Partial<Record<WinName, HSpan>>>>;
    dropped: Record<"h1" | "h4", Partial<Record<WinName, string>>>;
  };
  const { series: measured, dataRows: measuredRows } = await loadMeasuredSeries(dataDir, extDir, kDir);
  const sameCandles = (a: Candle[], b: Candle[]) => a.length === b.length && a.every((c, i) =>
    c.start === b[i].start && c.open === b[i].open && c.high === b[i].high && c.low === b[i].low && c.close === b[i].close && c.volume === b[i].volume);
  const series: Record<string, OSeries> = {};
  const dataRows: Record<string, unknown>[] = [];
  for (const symbol of PAPER_SYMBOLS) {
    const m = measured[symbol];
    if (!m) throw new Error(`loadMeasuredSeries has no ${symbol}`);
    const base = symbol.replace("/", "-");
    const cbH = toCandles(JSON.parse(await Deno.readTextFile(`${dataDir}/${base}_1h_3y.json`)) as Raw[]);
    const kH = toCandles(JSON.parse(await Deno.readTextFile(`${extDir}/${base}_1h_kraken.json`)) as Raw[]);
    const spliceAt = cbH[0].start;
    const combH = [...kH.filter((c) => c.start < spliceAt), ...cbH];
    // The hourly series the four windows were cut from: resampled, it IS loadMeasuredSeries's 4-hour and daily series.
    const resamplesTo4h = sameCandles(resample(combH, 4), m.comb4h), resamplesToDaily = sameCandles(resample(combH, 24), m.combDaily);
    if (!resamplesTo4h || !resamplesToDaily) throw new Error(`${symbol}: the hourly splice does not resample to loadMeasuredSeries's series (4h ${resamplesTo4h}, daily ${resamplesToDaily})`);
    const { comb4h, cb4h, kTape, wins } = m;
    const kDailyH = resample(kH, 24);
    const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
    const spans: OSeries["spans"] = { h1: { coinbase: {}, kraken: {} }, h4: { coinbase: { ...m.oos.coinbase }, kraken: { ...m.oos.kraken } } };
    const dropped: OSeries["dropped"] = { h1: {}, h4: { ...m.krakenDropped } };
    for (const w of wins) {
      if (!w.scored) continue;
      // 1-hour rows: the same calendar on hourly bars, mapped as §3.17's `windowOnSeries` maps it — on the spliced
      // series, and on Kraken's hourly bundle under the rule `loadMeasuredSeries` applies to Kraken's 4-hour tape.
      const isArr = w.isSeries === "coinbase" ? cb4h : comb4h;
      const isFromTs = isArr[w.isFrom].start, isToTs = endTs(isArr, w.isTo);
      const hFromTs = comb4h[w.oosFrom].start, hToTs = comb4h[w.oosTo - 1].start + 4 * 3600e3;
      spans.h1.coinbase[w.name] = { from: indexAtOrAfter(combH, hFromTs), to: indexAtOrAfter(combH, hToTs) };
      // The in-sample's first HOURLY bar: a 4-hour bucket can open before the first hour it holds (SOL's series starts
      // at 15:00 inside the 12:00 bucket), and that is not a gap in the tape.
      const isArrH = w.isSeries === "coinbase" ? cbH : combH;
      const isFromTsH = isArrH[Math.min(isArrH.length - 1, indexAtOrAfter(isArrH, isFromTs))].start;
      const kIsArrH = w.isSeries === "coinbase" ? kH.slice(indexAtOrAfter(kH, spliceAt)) : kH;
      const kIsBarsH = indexAtOrAfter(kIsArrH, isToTs) - indexAtOrAfter(kIsArrH, isFromTsH);
      const hkFrom = indexAtOrAfter(kH, hFromTs), hkTo = indexAtOrAfter(kH, hToTs);
      let whyH = "";
      if (kH[0].start > isFromTsH) whyH = `Kraken's hourly bundle starts ${iso(kH[0].start)}, after this window's in-sample begins`;
      else if (kH[kH.length - 1].start + 3600e3 < hToTs) whyH = `Kraken's hourly bundle ends ${iso(kH[kH.length - 1].start)}, before this window's out-of-sample ends (${iso(hToTs)})`;
      else if (kIsBarsH <= MAX_LOOKBACK + 2) whyH = `Kraken hourly in-sample is ${kIsBarsH} bars`;
      else if (hkTo - hkFrom <= MAX_LOOKBACK + 2) whyH = `Kraken hourly out-of-sample is ${hkTo - hkFrom} bars`;
      if (whyH) dropped.h1[w.name] = whyH;
      else spans.h1.kraken[w.name] = { from: hkFrom, to: hkTo };
    }
    series[symbol] = { comb4h, combDaily: m.combDaily, combH, kTape, kDaily4: m.kDaily, kH, kDailyH, spans, dropped };
    const spanIso = (arr: Candle[], sp: HSpan | undefined, barMs: number) => sp ? { from: iso(arr[sp.from].start), to: iso(arr[sp.to - 1].start + barMs), bars: sp.to - sp.from } : null;
    dataRows.push({
      symbol,
      loadMeasuredSeries: measuredRows.find((r) => r.symbol === symbol) ?? null,
      hourly: {
        coinbaseSplice: { bars1h: combH.length, first: iso(combH[0].start), last: iso(combH[combH.length - 1].start), spliceAt: iso(spliceAt), resamplesTo4h, resamplesToDaily },
        krakenBundle: { bars: kH.length, first: iso(kH[0].start), last: iso(kH[kH.length - 1].start) },
      },
      outOfSample: Object.fromEntries(wins.filter((w) => w.scored).map((w) => [w.name, {
        h4: { coinbase: spanIso(comb4h, spans.h4.coinbase[w.name], 4 * 3600e3), kraken: spanIso(kTape, spans.h4.kraken[w.name], 4 * 3600e3) },
        h1: { coinbase: spanIso(combH, spans.h1.coinbase[w.name], 3600e3), kraken: spanIso(kH, spans.h1.kraken[w.name], 3600e3) },
      }])),
      dropped,
    });
  }
  say(`data: ${PAPER_SYMBOLS.join(" ")} | 4h kraken ${WIN_NAMES.map((w) => `${w}${PAPER_SYMBOLS.filter((s) => series[s].spans.h4.kraken[w]).length}`).join(" ")} | 1h kraken ${WIN_NAMES.map((w) => `${w}${PAPER_SYMBOLS.filter((s) => series[s].spans.h1.kraken[w]).length}`).join(" ")}`);

  // ── tracks and the arm runner ─────────────────────────────────────────
  const hKey = (row: OtherRow) => row.barHours === 1 ? "h1" as const : "h4" as const;
  const spanOf = (row: OtherRow, tape: Tape, symbol: string, w: WinName) => series[symbol].spans[hKey(row)][tape][w];
  const priced = (row: OtherRow, tape: Tape, w: WinName) => row.symbols.filter((s) => spanOf(row, tape, s, w) != null);
  const scoredWindows = (row: OtherRow, cond: Condition) => WIN_NAMES.filter((w) => priced(row, cond.tape, w).length > 0);
  const barsOf = (row: OtherRow, tape: Tape, symbol: string) => {
    const s = series[symbol];
    if (row.barHours === 1) return tape === "coinbase" ? { bars: s.combH, daily: s.combDaily } : { bars: s.kH, daily: s.kDailyH };
    return tape === "coinbase" ? { bars: s.comb4h, daily: s.combDaily } : { bars: s.kTape, daily: s.kDaily4 };
  };
  const trackCache = new Map<string, OtherTrack>();
  const trackOf = (row: OtherRow, tape: Tape, symbol: string, w: WinName): OtherTrack => {
    const key = `${row.kind}|${row.cadence}|${row.barHours}|${tape}|${symbol}|${w}`;
    let t = trackCache.get(key);
    if (!t) {
      const span = spanOf(row, tape, symbol, w);
      if (!span) throw new Error(`${row.id} ${symbol} ${w} is not priced on the ${tape} tape`);
      const { bars, daily } = barsOf(row, tape, symbol);
      t = buildOtherTrack(row.kind, row.cadence, symbol, bars, daily, DEFAULT_TREND, span.from, span.to, row.barHours);
      trackCache.set(key, t);
    }
    return t;
  };
  const stopsFor = (row: OtherRow, rule: StopRule): StopParams => ({ ...stopsOf(rule, DEFAULT_TREND), reentryBars: row.reentryBars });
  const strideOf = (row: OtherRow) => row.cadence === "daily" ? 24 / row.barHours : 1;
  type OArm = { stats: SleeveStats; entries: number; tally: OtherTally; per: Record<string, GatedResult> };
  type OArmOpts = { costs?: Costs; checked?: { flatBars: number; mismatches: number }; states?: CategoricalState[] };
  function runArm(row: OtherRow, cond: Condition, w: WinName, policyFor: PolicyFor, o: OArmOpts = {}): OArm | null {
    const syms = priced(row, cond.tape, w);
    if (!syms.length) return null;
    const per: Record<string, GatedResult> = {};
    const tally: OtherTally = { signals: 0, refused: 0, callByCall: 0, callByCallRefused: 0 };
    let entries = 0;
    for (const symbol of syms) {
      const t = trackOf(row, cond.tape, symbol, w);
      const pol = countingOther(policyFor(symbol), tally, straddling[row.kind]!, o.states);
      const d = o.checked ? otherCheckedDecider(t, pol, o.checked) : otherTrackDecider(t, pol);
      const r = runGated(symbol, t.bars, t.from, t.to, t.warmup, d, o.costs ?? COSTS.revx, stopsFor(row, cond.stopRule));
      per[symbol] = r;
      entries += r.entries;
    }
    return { stats: otherSleeveStats(row, per), entries, tally, per };
  }
  const sleeveRow = (a: OArm) => ({
    ret: a.stats.ret, maxDD: a.stats.maxDD, retOverDD: a.stats.retOverDD, pnlUsd: a.stats.pnlUsd, capitalUsd: a.stats.capitalUsd,
    members: a.stats.members, deployment: a.stats.deployment, entries: a.entries, signals: a.tally.signals, refused: a.tally.refused,
  });

  // ── fidelity: the cache and the copy are `run`, and the cadence is what it says ──
  const FIELDS = ["ret", "maxDD", "trades", "days", "exposure", "realised", "fees", "stopsHit"] as const;
  const fid = {
    cells: 0, fieldMismatches: 0, markPoints: 0, markMismatches: 0, flatBarsChecked: 0, flatBarMismatches: 0,
    runCells: 0, runEquityPoints: 0, runEquityMismatches: 0, mismatchCells: [] as string[],
  };
  for (const row of rows) for (const cond of CONDITIONS) for (const w of WIN_NAMES) for (const symbol of priced(row, cond.tape, w)) for (const venue of ["revx", "kraken"] as const) {
    const t = trackOf(row, cond.tape, symbol, w);
    const stops = stopsFor(row, cond.stopRule);
    const g = runGated(symbol, t.bars, t.from, t.to, t.warmup, otherTrackDecider(t, rulePolicy), COSTS[venue], stops);
    const tally = { flatBars: 0, mismatches: 0 };
    const gs = runGated(symbol, t.bars, t.from, t.to, t.warmup, otherCheckedDecider(t, rulePolicy, tally), COSTS[venue], stops);
    fid.cells++;
    fid.flatBarsChecked += tally.flatBars; fid.flatBarMismatches += tally.mismatches;
    let bad = 0;
    for (const f of FIELDS) if ((g[f] ?? 0) !== (gs[f] ?? 0)) bad++;
    for (let m = 0; m < Math.max(g.marks.length, gs.marks.length); m++) {
      fid.markPoints++;
      const a = g.marks[m], b = gs.marks[m];
      if (!a || !b || a[0] !== b[0] || a[1] !== b[1]) fid.markMismatches++;
    }
    if (row.cadence === "bar") {
      // Decided on every bar, the copy through the cache IS backtest.ts's `run`: every field and every equity point it samples.
      const r = run(row.kind, symbol, t.bars, t.daily, t.from, t.to, t.p, COSTS[venue], row.barHours, stops);
      fid.runCells++;
      for (const f of FIELDS) if ((r[f] ?? 0) !== (g[f] ?? 0)) bad++;
      const marks = new Map(g.marks.map(([ts, e]) => [ts, e]));
      for (const [ts, e] of r.equity) {
        fid.runEquityPoints++;
        const mk = marks.get(ts);
        if (mk == null || Number(mk.toFixed(5)) !== e) fid.runEquityMismatches++;
      }
    }
    if (bad) { fid.fieldMismatches += bad; fid.mismatchCells.push(`${row.id} ${cond.id} ${w} ${symbol} ${venue}`); }
  }
  say(`fidelity: ${fid.cells} cells (${fid.runCells} against run), ${fid.fieldMismatches} field mismatches, ${fid.runEquityMismatches}/${fid.runEquityPoints} run equity points off, ${fid.markMismatches}/${fid.markPoints} marks off the rebuilt decider, ${fid.flatBarMismatches}/${fid.flatBarsChecked} flat bars off the cache`);
  if (fid.fieldMismatches || fid.markMismatches || fid.runEquityMismatches || fid.flatBarMismatches) throw new Error(`fidelity failed: ${JSON.stringify(fid)}`);
  // The daily cadence, counted: one decision bar per UTC day, and the days a missing bar leaves undecided.
  const cadence: Record<string, unknown> = {};
  for (const row of rows.filter((r) => r.cadence === "daily")) {
    const per: Record<string, unknown> = {};
    for (const tape of ["coinbase", "kraken"] as const) for (const w of WIN_NAMES) for (const symbol of priced(row, tape, w)) {
      const t = trackOf(row, tape, symbol, w);
      const days = new Set<number>(), decided = new Set<number>();
      for (let k = 0; k < t.decides.length; k++) {
        const day = Math.floor(t.bars[t.start + k].start / 86400e3);
        days.add(day);
        if (t.decides[k] === 1) decided.add(day);
      }
      per[`${tape}·${w}·${symbol}`] = { days: days.size, decisionBars: t.decides.reduce((a, b) => a + b, 0), daysWithoutADecision: days.size - decided.size };
    }
    cadence[row.id] = per;
  }

  // ── (i) the rulebook, and the published rows it must reproduce ────────
  const ruleArm: Record<string, Record<string, Partial<Record<WinName, OArm>>>> = {};
  const ruleStates: Record<string, Record<string, Partial<Record<WinName, CategoricalState[]>>>> = {};
  for (const row of rows) {
    ruleArm[row.id] = {}; ruleStates[row.id] = {};
    for (const cond of CONDITIONS) {
      ruleArm[row.id][cond.id] = {}; ruleStates[row.id][cond.id] = {};
      for (const w of scoredWindows(row, cond)) {
        const states: CategoricalState[] = [];
        ruleArm[row.id][cond.id][w] = runArm(row, cond, w, () => rulePolicy, { states })!;
        ruleStates[row.id][cond.id][w] = states;
      }
    }
  }
  type Ref = { ret: number; maxDD: number; members?: number } | null;
  const s2 = JSON.parse(await Deno.readTextFile(set2Path)) as { a5_theSet: { rows: { row: string; perCondition: Record<string, { perWindow: Record<string, Ref> }> }[] } };
  const set2Momentum = s2.a5_theSet.rows.find((r) => r.row === "momentum-1d·revx (paper)")?.perCondition;
  if (!set2Momentum) throw new Error(`${set2Path}: no "momentum-1d·revx (paper)" row in a5_theSet`);
  const ts = JSON.parse(await Deno.readTextFile(testingSetPath)) as { s2_rows: { perStopRule: Record<string, { rows: { id: string; perWindow: Record<string, Ref> }[] }> } };
  const testingRows = Object.fromEntries(Object.entries(ts.s2_rows.perStopRule).map(([reg, v]) => [reg, Object.fromEntries(v.rows.map((r) => [r.id, r.perWindow]))]));
  const incumbent: Record<string, unknown> = {};
  let incumbentCells = 0, incumbentMissing = 0, incumbentWorstDiff = 0;
  for (const row of rows) {
    const perCond: Record<string, unknown> = {};
    for (const cond of CONDITIONS) {
      const perW: Record<string, unknown> = {};
      for (const w of scoredWindows(row, cond)) {
        const s = ruleArm[row.id][cond.id][w]!.stats;
        const refs: Record<string, Ref> = {};
        if (row.id === "momentum-1d") refs.set2 = set2Momentum[cond.id]?.perWindow?.[w] ?? null;
        if (row.id === "momentum-1d" && cond.stopRule === "shipped" && cond.tape === "coinbase") refs.testingSet = testingRows.shipped?.["momentum-1d·revx"]?.[w] ?? null;
        if (row.id === "trend-1h" && cond.tape === "coinbase") refs.testingSet = testingRows[cond.stopRule]?.["trend-1h·revx"]?.[w] ?? null;
        for (const ref of Object.values(refs)) {
          if (!ref) { incumbentMissing++; continue; }
          incumbentCells++;
          incumbentWorstDiff = Math.max(incumbentWorstDiff, Math.abs(s.ret - ref.ret), Math.abs(s.maxDD - ref.maxDD));
        }
        perW[w] = { here: { ret: s.ret, maxDD: s.maxDD, members: s.members }, ...Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v ? { ret: v.ret, maxDD: v.maxDD } : null])) };
      }
      perCond[cond.id] = perW;
    }
    incumbent[row.id] = perCond;
  }
  say(`rule arms against the published rows: ${incumbentCells} cells, ${incumbentMissing} missing, worst |Δ| ${r4(incumbentWorstDiff)}`);
  if (incumbentMissing || incumbentWorstDiff !== 0) throw new Error("the rule arms are not the published rows — this would price something else");
  // Window D lies wholly inside Kraken's bundle, so the two tapes must price it identically, every coin.
  let windowDCells = 0, windowDDiffs = 0;
  for (const row of rows) for (const stopRule of ["shipped", "trail"] as const) {
    const a = ruleArm[row.id][`${stopRule}·coinbase`]?.D, b = ruleArm[row.id][`${stopRule}·kraken`]?.D;
    if (!a || !b) continue;
    windowDCells++;
    if (a.stats.ret !== b.stats.ret || a.stats.maxDD !== b.stats.maxDD || a.entries !== b.entries || a.stats.members !== b.stats.members) windowDDiffs++;
    for (const s of Object.keys(a.per)) if (!b.per[s] || a.per[s].ret !== b.per[s].ret || a.per[s].trades !== b.per[s].trades) windowDDiffs++;
  }
  say(`window D on the two tapes: ${windowDCells} row × stop-rule pairs, ${windowDDiffs} differences`);
  if (windowDDiffs) throw new Error("window D differs between the tapes");

  // (i) shadow: the model asked with real draws, `gate = false` — must BE the rulebook.
  let shadowCells = 0, shadowDiffs = 0, shadowShown = 0, shadowWould = 0;
  for (const row of rows) for (const cond of CONDITIONS) for (const w of scoredWindows(row, cond)) for (let k = 0; k < SHADOW_DRAWS; k++) {
    const counter = { would: 0, asked: 0 };
    const a = runArm(row, cond, w, (sym) => {
      const gated = otherJevPolicy(row.kind, bookOf(row.kind), mulberry32(seedOf("shadow-would", row.id, cond.id, w, sym, k)), ENTER_MINS[row.kind], true);
      const shadow = otherJevPolicy(row.kind, bookOf(row.kind), mulberry32(seedOf("shadow", row.id, cond.id, w, sym, k)), ENTER_MINS[row.kind], false);
      return (i, s, r) => { counter.asked++; if (gated(i, s, r) === "hold") counter.would++; return shadow(i, s, r); };
    })!;
    const b = ruleArm[row.id][cond.id][w]!;
    shadowCells++;
    if (a.stats.ret !== b.stats.ret || a.stats.maxDD !== b.stats.maxDD || a.entries !== b.entries) shadowDiffs++;
    for (const s of Object.keys(b.per)) if (a.per[s].ret !== b.per[s].ret || a.per[s].trades !== b.per[s].trades) shadowDiffs++;
    shadowShown += counter.asked; shadowWould += counter.would;
  }
  say(`shadow ≡ rule: ${shadowCells} row-evaluation-windows × draws, ${shadowDiffs} differences; the gate would have refused ${shadowWould} of ${shadowShown} entries it was shown`);
  if (shadowDiffs) throw new Error("shadow mode is not the rulebook");

  // ── (ii) the gate, and its null ───────────────────────────────────────
  type OMc = {
    ret: Float64Array; dd: Float64Array; entries: Float64Array; refused: Float64Array; signals: Float64Array; dep: Float64Array;
    callByCall: Float64Array; callByCallRefused: Float64Array; perCoinRet: Record<string, number>; perCoinEntries: Record<string, number>;
  };
  const mcRun = (row: OtherRow, cond: Condition, w: WinName, n: number, policyAt: (sym: string, k: number) => EntryPolicy): OMc => {
    const m: OMc = {
      ret: new Float64Array(n), dd: new Float64Array(n), entries: new Float64Array(n), refused: new Float64Array(n), signals: new Float64Array(n),
      dep: new Float64Array(n), callByCall: new Float64Array(n), callByCallRefused: new Float64Array(n), perCoinRet: {}, perCoinEntries: {},
    };
    for (let k = 0; k < n; k++) {
      const a = runArm(row, cond, w, (sym) => policyAt(sym, k))!;
      m.ret[k] = a.stats.ret; m.dd[k] = a.stats.maxDD; m.entries[k] = a.entries; m.refused[k] = a.tally.refused; m.signals[k] = a.tally.signals;
      m.dep[k] = a.stats.deployment; m.callByCall[k] = a.tally.callByCall; m.callByCallRefused[k] = a.tally.callByCallRefused;
      for (const [s, r] of Object.entries(a.per)) {
        m.perCoinRet[s] = (m.perCoinRet[s] ?? 0) + r.ret / n;
        m.perCoinEntries[s] = (m.perCoinEntries[s] ?? 0) + r.entries / n;
      }
    }
    return m;
  };
  const mcRow = (m: OMc) => ({
    ret: summarize(m.ret), pNegative: r3(Array.from(m.ret).filter((x) => x < 0).length / m.ret.length), maxDDMean: r4(meanOf(m.dd)), deploymentMean: r3(meanOf(m.dep)),
    entriesMean: r3(meanOf(m.entries)), signalsMean: r3(meanOf(m.signals)), refusedMean: r3(meanOf(m.refused)),
    callByCallSignalsMean: r3(meanOf(m.callByCall)), callByCallRefusedMean: r3(meanOf(m.callByCallRefused)),
  });
  /** The measured replay's `calibrate`, at the row's stride: bisection on the episode-refusal probability until the null takes the gate's entries. */
  function calibrate(row: OtherRow, cond: Condition, w: WinName, baseEntries: number, target: number, tag: string) {
    const path: { pEp: number; meanEntries: number }[] = [];
    if (target >= baseEntries) return { pEp: 0, path, note: "the gate takes at least as many entries as the rulebook; the null is the rulebook itself" };
    const meanAt = (pEp: number) => {
      let tot = 0;
      for (let k = 0; k < CAL_DRAWS; k++) tot += runArm(row, cond, w, (sym) => episodeNullAt(strideOf(row), pEp, mulberry32(seedOf("cal", tag, row.id, cond.id, w, sym, k))))!.entries;
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
  type ONull = { pEp: number; calibration: ReturnType<typeof calibrate>; target: number; m: OMc };
  const mcII: Record<string, Record<string, Partial<Record<WinName, OMc>>>> = {};
  const nulls: Record<string, Record<string, Partial<Record<WinName, ONull>>>> = {};
  for (const row of rows) {
    mcII[row.id] = {}; nulls[row.id] = {};
    for (const cond of CONDITIONS) {
      mcII[row.id][cond.id] = {}; nulls[row.id][cond.id] = {};
      for (const w of scoredWindows(row, cond)) {
        const ii = mcRun(row, cond, w, DRAWS, (sym, k) => otherJevPolicy(row.kind, bookOf(row.kind), mulberry32(seedOf("ii", row.id, cond.id, w, sym, k)), ENTER_MINS[row.kind], true));
        mcII[row.id][cond.id][w] = ii;
        const target = meanOf(ii.entries);
        const calibration = calibrate(row, cond, w, ruleArm[row.id][cond.id][w]!.entries, target, "ii");
        const m = mcRun(row, cond, w, NULL_DRAWS, (sym, k) => episodeNullAt(strideOf(row), calibration.pEp, mulberry32(seedOf("null", "ii", row.id, cond.id, w, sym, k))));
        nulls[row.id][cond.id][w] = { pEp: calibration.pEp, calibration, target, m };
      }
      say(`${row.id} ${cond.id}: ${scoredWindows(row, cond).map((w) => {
        const r = ruleArm[row.id][cond.id][w]!, ii = mcII[row.id][cond.id][w]!, n = nulls[row.id][cond.id][w]!;
        return `${w} rule ${(r.stats.ret * 100).toFixed(1)}% (${r.entries}) | gate ${(meanOf(ii.ret) * 100).toFixed(1)}% (${meanOf(ii.entries).toFixed(1)}) | null p=${n.pEp.toFixed(3)} P≥${atLeastPairs(n.m.ret, ii.ret).toFixed(3)}`;
      }).join(" ; ")}`);
    }
  }

  // ── the table the decision is made from ───────────────────────────────
  const worstOf = (vals: Partial<Record<WinName, number>>) => {
    let wn: WinName | null = null, v = Infinity;
    for (const w of WIN_NAMES) { const x = vals[w]; if (x != null && x < v) { v = x; wn = w; } }
    return { window: wn, ret: r4(v) };
  };
  const sc = (ret: number, dd: number) => ret / Math.max(0.05, dd);
  type Verdict = {
    beatsIncumbentWorst: boolean; doesNotLowerIncumbentWorst: boolean; beatsNullOnWorst: boolean; pNull: number;
    doesNotLowerIncumbentWorstOnTheMeanOfEachDrawsWorst: boolean;
    onRetOverDD: { beatsIncumbentWorst: boolean; doesNotLowerIncumbentWorst: boolean; beatsNullOnWorst: boolean; pNull: number };
  };
  const configurations: Record<string, unknown> = {};
  const verdict: Record<string, unknown> = {};
  for (const row of rows) {
    const perCond: Record<string, unknown> = {};
    const rowV: Record<string, Verdict> = {};
    for (const cond of CONDITIONS) {
      const ws = scoredWindows(row, cond);
      const rule = ruleArm[row.id][cond.id], ii = mcII[row.id][cond.id], nl = nulls[row.id][cond.id];
      const ruleWorst = worstOf(Object.fromEntries(ws.map((w) => [w, rule[w]!.stats.ret])) as Partial<Record<WinName, number>>);
      const iiWorstOfMeans = worstOf(Object.fromEntries(ws.map((w) => [w, meanOf(ii[w]!.ret)])) as Partial<Record<WinName, number>>);
      // The gate's worst window draw by draw, and the null's, each null calibrated per window.
      const iiWorstPerDraw = new Float64Array(DRAWS);
      for (let k = 0; k < DRAWS; k++) iiWorstPerDraw[k] = Math.min(...ws.map((w) => ii[w]!.ret[k]));
      const nullWorst = new Float64Array(NULL_DRAWS);
      for (let k = 0; k < NULL_DRAWS; k++) nullWorst[k] = Math.min(...ws.map((w) => nl[w]!.m.ret[k]));
      const ruleScoreWorst = worstOf(Object.fromEntries(ws.map((w) => [w, sc(rule[w]!.stats.ret, rule[w]!.stats.maxDD)])) as Partial<Record<WinName, number>>);
      const iiScoreWorstPerDraw = new Float64Array(DRAWS);
      for (let k = 0; k < DRAWS; k++) iiScoreWorstPerDraw[k] = Math.min(...ws.map((w) => sc(ii[w]!.ret[k], ii[w]!.dd[k])));
      const nullScoreWorst = new Float64Array(NULL_DRAWS);
      for (let k = 0; k < NULL_DRAWS; k++) nullScoreWorst[k] = Math.min(...ws.map((w) => sc(nl[w]!.m.ret[k], nl[w]!.m.dd[k])));
      const iiScoreWorstMean = r4(meanOf(iiScoreWorstPerDraw));
      const iiWorstMeanOverDraws = r4(meanOf(iiWorstPerDraw));
      const perWindow: Record<string, unknown> = {};
      for (const w of ws) {
        const n = nl[w]!, m = ii[w]!, r = rule[w]!;
        perWindow[w] = {
          i_rulebook: sleeveRow(r),
          ii_gate: { ...mcRow(m), entriesRemovedMean: r3(r.entries - meanOf(m.entries)), pAtLeastRule: r3(atLeast(m.ret, r.stats.ret)) },
          null: {
            pEp: r4(n.pEp), targetEntries: r3(n.target), nullEntriesMean: r3(meanOf(n.m.entries)), nullDeploymentMean: r3(meanOf(n.m.dep)),
            gateDeploymentMean: r3(meanOf(m.dep)), ret: summarize(n.m.ret), maxDDMean: r4(meanOf(n.m.dd)),
            pNullAtLeastArm: r3(atLeastPairs(n.m.ret, m.ret)), calibration: n.calibration.path, ...(n.calibration.note ? { note: n.calibration.note } : {}),
          },
        };
      }
      const iiRow = {
        worstOfMeans: iiWorstOfMeans, worstPerDraw: summarize(iiWorstPerDraw),
        beatsIncumbentWorst: iiWorstOfMeans.ret > ruleWorst.ret, doesNotLowerIncumbentWorst: iiWorstOfMeans.ret >= ruleWorst.ret,
        onTheMeanOfEachDrawsWorst: { ret: iiWorstMeanOverDraws, beatsIncumbentWorst: iiWorstMeanOverDraws > ruleWorst.ret, doesNotLowerIncumbentWorst: iiWorstMeanOverDraws >= ruleWorst.ret },
        pWorstAboveIncumbentWorst: r3(Array.from(iiWorstPerDraw).filter((x) => x > ruleWorst.ret).length / DRAWS),
        nullWorst: summarize(nullWorst), pNullWorstAtLeastArmWorst: r3(atLeastPairs(nullWorst, iiWorstPerDraw)),
      };
      const retOverDD = {
        incumbentWorst: ruleScoreWorst,
        ii: {
          worstMeanOverDraws: iiScoreWorstMean, beatsIncumbentWorst: iiScoreWorstMean > ruleScoreWorst.ret, doesNotLowerIncumbentWorst: iiScoreWorstMean >= ruleScoreWorst.ret,
          pNullWorstAtLeastArmWorst: r3(atLeastPairs(nullScoreWorst, iiScoreWorstPerDraw)),
        },
      };
      perCond[cond.id] = { windowsPriced: ws, incumbentWorst: ruleWorst, ii: iiRow, retOverDD, perWindow };
      rowV[cond.id] = {
        beatsIncumbentWorst: iiRow.beatsIncumbentWorst, doesNotLowerIncumbentWorst: iiRow.doesNotLowerIncumbentWorst,
        beatsNullOnWorst: iiRow.pNullWorstAtLeastArmWorst <= 0.05, pNull: iiRow.pNullWorstAtLeastArmWorst,
        doesNotLowerIncumbentWorstOnTheMeanOfEachDrawsWorst: iiRow.onTheMeanOfEachDrawsWorst.doesNotLowerIncumbentWorst,
        onRetOverDD: {
          beatsIncumbentWorst: retOverDD.ii.beatsIncumbentWorst, doesNotLowerIncumbentWorst: retOverDD.ii.doesNotLowerIncumbentWorst,
          beatsNullOnWorst: retOverDD.ii.pNullWorstAtLeastArmWorst <= 0.05, pNull: retOverDD.ii.pNullWorstAtLeastArmWorst,
        },
      };
    }
    configurations[row.id] = perCond;
    const every = (pred: (v: Verdict) => boolean, conds: readonly Condition[] = CONDITIONS) => conds.every((c) => pred(rowV[c.id]));
    const shippedOnly = CONDITIONS.filter((c) => c.stopRule === "shipped");
    verdict[row.id] = {
      perCondition: rowV,
      passesTheBar: every((v) => v.doesNotLowerIncumbentWorst && v.beatsNullOnWorst),
      passesTheBarOnRetOverDD: every((v) => v.onRetOverDD.doesNotLowerIncumbentWorst && v.onRetOverDD.beatsNullOnWorst),
      passesTheStricterReading: every((v) => v.beatsIncumbentWorst && v.beatsNullOnWorst),
      lowersTheWorstWindowIn: CONDITIONS.filter((c) => !rowV[c.id].doesNotLowerIncumbentWorst).map((c) => c.id),
      lowersTheWorstWindowOnTheMeanOfEachDrawsWorstIn: CONDITIONS.filter((c) => !rowV[c.id].doesNotLowerIncumbentWorstOnTheMeanOfEachDrawsWorst).map((c) => c.id),
      beatsTheNullOnTheWorstWindowIn: CONDITIONS.filter((c) => rowV[c.id].beatsNullOnWorst).map((c) => c.id),
      ...(row.kind === "momentum-1d" ? {
        onTheShippedEvaluationsOnly: {
          note: "§3.17's reading: momentum never carried the intra-bar trail (§3.3a), so its trail evaluations ARE its shipped ones and the bar is judged on these two",
          passesTheBar: every((v) => v.doesNotLowerIncumbentWorst && v.beatsNullOnWorst, shippedOnly),
          passesTheBarOnRetOverDD: every((v) => v.onRetOverDD.doesNotLowerIncumbentWorst && v.onRetOverDD.beatsNullOnWorst, shippedOnly),
          passesTheStricterReading: every((v) => v.beatsIncumbentWorst && v.beatsNullOnWorst, shippedOnly),
        },
      } : {}),
    };
    say(`${row.id} bar: ${JSON.stringify(verdict[row.id])}`);
  }

  // ── what the gate refuses of the rulebook's OWN entry signals ─────────
  // Every signal on the rulebook's own path where tick.ts would ask (flat, the rule says enter, not cooling down) —
  // on that path each one is an entry — weighted by how often its state occurs, not counted once per state.
  const groupOf = (kind: OtherKind, s: OtherWords) => kind === "momentum-1d" ? `${s.trend_4h}|${s.breakout_4h}` : `${s.trend_strength}|${s.volatility}`;
  const refusedSignals: Record<string, unknown> = {};
  for (const row of rows) {
    const perCond: Record<string, unknown> = {};
    for (const cond of CONDITIONS) {
      const perW: Record<string, unknown> = {};
      const pooled = { signals: 0, expectedRefused: 0, refusedEveryCall: 0, callByCall: 0, passedEveryCall: 0 };
      const pooledGroups: Record<string, { signals: number; expectedRefused: number }> = {};
      for (const w of scoredWindows(row, cond)) {
        const states = ruleStates[row.id][cond.id][w]!;
        const out = { signals: 0, expectedRefused: 0, refusedEveryCall: 0, callByCall: 0, passedEveryCall: 0 };
        const cells: Record<string, { signals: number; vetoShare: number }> = {};
        const groups: Record<string, { signals: number; expectedRefused: number }> = {};
        for (const s of states) {
          const q = qOf(row.kind, s);
          out.signals++; out.expectedRefused += q;
          if (q === 1) out.refusedEveryCall++; else if (q === 0) out.passedEveryCall++; else out.callByCall++;
          const c = otherCell(s);
          cells[c] ??= { signals: 0, vetoShare: 0 };
          cells[c].vetoShare = (cells[c].vetoShare * cells[c].signals + q) / (cells[c].signals + 1);
          cells[c].signals++;
          const g = groupOf(row.kind, s);
          groups[g] ??= { signals: 0, expectedRefused: 0 };
          groups[g].signals++; groups[g].expectedRefused += q;
          pooledGroups[g] ??= { signals: 0, expectedRefused: 0 };
          pooledGroups[g].signals++; pooledGroups[g].expectedRefused += q;
        }
        for (const k of Object.keys(pooled) as (keyof typeof pooled)[]) pooled[k] += out[k];
        perW[w] = {
          ...out, expectedRefused: r3(out.expectedRefused), refusedShare: r3(out.expectedRefused / Math.max(1, out.signals)),
          ruleEntries: ruleArm[row.id][cond.id][w]!.entries,
          byGroup: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].signals - a[1].signals).map(([g, v]) => [g, { signals: v.signals, refusedShare: r3(v.expectedRefused / v.signals) }])),
          byCell: Object.fromEntries(Object.entries(cells).sort((a, b) => b[1].signals - a[1].signals).map(([c, v]) => [c, { signals: v.signals, vetoShare: r3(v.vetoShare) }])),
        };
      }
      perCond[cond.id] = {
        perWindow: perW,
        pooled: { ...pooled, expectedRefused: r3(pooled.expectedRefused), refusedShare: r3(pooled.expectedRefused / Math.max(1, pooled.signals)) },
        pooledByGroup: Object.fromEntries(Object.entries(pooledGroups).sort((a, b) => b[1].signals - a[1].signals).map(([g, v]) => [g, { signals: v.signals, refusedShare: r3(v.expectedRefused / v.signals) }])),
      };
    }
    refusedSignals[row.id] = {
      groupedBy: row.kind === "momentum-1d" ? "trend_4h|breakout_4h — the 4-hour picture the question is about" : "trend_strength|volatility",
      perCondition: perCond,
    };
  }

  // ── does the gate switch the row off? ────────────────────────────────
  const switchedOff: Record<string, unknown> = {};
  for (const row of rows) {
    const perCond: Record<string, unknown> = {};
    for (const cond of CONDITIONS) {
      perCond[cond.id] = Object.fromEntries(scoredWindows(row, cond).map((w) => {
        const r = ruleArm[row.id][cond.id][w]!, m = mcII[row.id][cond.id][w]!;
        return [w, {
          ruleEntries: r.entries, gateEntriesMean: r3(meanOf(m.entries)), entriesKept: r3(meanOf(m.entries) / Math.max(1, r.entries)),
          ruleDeployment: r.stats.deployment, gateDeploymentMean: r3(meanOf(m.dep)), deploymentKept: r3(meanOf(m.dep) / Math.max(1e-9, r.stats.deployment)),
          gateAsksRefusedMean: r3(meanOf(m.refused)), gateAsksMean: r3(meanOf(m.signals)),
        }];
      }));
    }
    switchedOff[row.id] = perCond;
  }

  const perCoinPrimary = Object.fromEntries(rows.map((row) => [row.id, Object.fromEntries(scoredWindows(row, PRIMARY).map((w) => [w, Object.fromEntries(priced(row, PRIMARY.tape, w).map((s) => [s, {
    rule: { ret: r4(ruleArm[row.id][PRIMARY.id][w]!.per[s].ret), entries: ruleArm[row.id][PRIMARY.id][w]!.per[s].entries },
    gate: { retMean: r4(mcII[row.id][PRIMARY.id][w]!.perCoinRet[s]), entriesMean: r3(mcII[row.id][PRIMARY.id][w]!.perCoinEntries[s]) },
  }]))]))]));

  // ── the answers, read on their own: what each rule's threshold does to each state, and every other threshold ──
  const answersAtThreshold = Object.fromEntries(kinds.map((kind) => {
    const book = bookOf(kind);
    const qs = qAt[kind]!;
    const cellsWhere = (pred: (q: number) => boolean) => [...new Set([...qs.entries()].filter(([, q]) => pred(q)).map(([k]) => otherCell(book.words.get(k)!)))].sort();
    return [kind, {
      version: VERSIONS[kind], enterMin: ENTER_MINS[kind],
      states: book.bySymbol.size, replies: book.replies,
      refusedEveryCall: [...qs.values()].filter((q) => q === 1).length, callByCall: [...qs.values()].filter((q) => q > 0 && q < 1).length, passedEveryCall: [...qs.values()].filter((q) => q === 0).length,
      callByCallStates: [...qs.entries()].filter(([, q]) => q > 0 && q < 1).map(([k, q]) => ({ state: k, replies: book.bySymbol.get(k)!.map((r) => r.healthy), vetoShare: r3(q) })),
      cellsRefusedEveryCallOnSomeCoin: cellsWhere((q) => q === 1),
      cellsPassedEveryCallOnSomeCoin: cellsWhere((q) => q === 0),
    }];
  }));
  const thresholdScan = Object.fromEntries(kinds.map((kind) => {
    const book = bookOf(kind);
    const scan: { enterMin: number; refusedEveryCall: number; callByCall: number; passedEveryCall: number }[] = [];
    for (let c = 30; c <= 85; c++) {
      const em = c / 100;
      const out = { enterMin: em, refusedEveryCall: 0, callByCall: 0, passedEveryCall: 0 };
      for (const rs of book.bySymbol.values()) { const q = vetoShare(rs, em); if (q === 1) out.refusedEveryCall++; else if (q === 0) out.passedEveryCall++; else out.callByCall++; }
      scan.push(out);
    }
    return [kind, { deterministic: scan.filter((r) => r.callByCall === 0).map((r) => r.enterMin), rows: scan }];
  }));

  // ── inputs unchanged for the whole run ─────────────────────────────────
  const hashesEnd = await hashNow();
  if (JSON.stringify(hashesEnd) !== JSON.stringify(hashesStart)) throw new Error("an input changed while this study ran — rerun it");

  // The caveats that state facts about the answers are read off the answers file, not written for one file.
  const prov = answersProvenance as { model?: string; transport?: string; requestedAt?: string; noAnswers?: number; echoFailures?: number };
  const repliesPerState = (kind: OtherKind) => [...new Set([...bookOf(kind).bySymbol.values()].map((rs) => rs.length))].sort((a, b) => a - b).join(" or ");
  const decidedAt = (kind: OtherKind) => {
    const n = bookOf(kind).bySymbol.size, k = straddling[kind]!.size, em = ENTER_MINS[kind];
    return k === 0 ? `at ${em} ${kind}'s ${n} states are all decided the same way on every call` : `at ${em} ${kind} has ${k} states of ${n} whose replies straddle ${em}, drawn call by call`;
  };
  const allReplies = kinds.flatMap((k) => [...bookOf(k).bySymbol.values()].flat());
  const answerCaveats = [
    `The answers are the model's replies as the answers file records them (${prov.model ?? "model not recorded"} through ${prov.transport ?? "a transport not recorded"}, requested ${prov.requestedAt ?? "at a time not recorded"}; ${kinds.map((k) => `the ${VERSIONS[k]} wording for ${k}`).join(", ")}). Asking it about a state computed from 2022 candles is legitimate — the state is ten categorical words and carries no date — but it is what the model says NOW.`,
    `Replies per state: ${kinds.map((k) => `${k} ${repliesPerState(k)}`).join(", ")}. ${kinds.map(decidedAt).join("; ").replace(/^at/, "At")}.`,
    `${allReplies.length.toLocaleString("en-US")} replies are priced, ${allReplies.filter((r) => r.healthy == null).length} of them missing (a missing reply is drawn as a veto, as production reads it); a failed echo makes the loader refuse the file. The answers file's provenance records ${prov.noAnswers ?? "no count of"} missing answers and ${prov.echoFailures ?? "no count of"} echo failures.`,
  ];

  const report = {
    study: `the Jev gate on the two PAPER rows at a wording and a threshold per rule — trend-1h: ${VERSIONS["trend-1h"]} at enterMin ${ENTER_MINS["trend-1h"]}; momentum-1d: ${VERSIONS["momentum-1d"]} at enterMin ${ENTER_MINS["momentum-1d"]} — the rulebook against the rulebook ∧ the gate on four windows × the four evaluations §3.19 requires, each gate against a random veto that takes the same number of entries`,
    script: "supabase/functions/agents/backtest_jev_rows.ts — backtest_jev_other.ts, which it does not modify, with a wording and a threshold per rule (--versions, --enter-min); imports runGated, loadMeasuredSeries, combine, episodeNullPolicy, seedOf, mulberry32 and the statistics from backtest_jev.ts, which it does not modify",
    rows: rows.map((r) => ({ ...r, slotUsd: Number(Math.min(r.capitalUsd / r.slots, MAX_ORDER_USD).toFixed(2)), version: VERSIONS[r.kind], enterMin: ENTER_MINS[r.kind] })),
    thresholds: { enterMinByKind: ENTER_MINS, cautionExit: CAUTION_EXIT, source: "--enter-min, per rule (both momentum-1d cadences take momentum-1d's); the default on both is JEV_ENTER_MIN in agents_strategy.ts — agent_strategies.params.enterMin on trend-1h and momentum-1d since migration 0047; cautionExit is tick.ts's literal" },
    answers: { file: answersPath, sha256: hashesStart.answersJson, versionByKind: VERSIONS, provenance: answersProvenance, atThreshold: answersAtThreshold, thresholdScan: { note: "per threshold, from the answers alone: states whose five replies are ALL under it (refused every call), SOME (call by call) and NONE (never refused); combineDecision refuses when P < enterMin. Nothing here chooses a threshold.", ...thresholdScan } },
    preRegistration: preregPath ? { file: preregPath, sha256: hashesStart.preRegistration } : { note: "not supplied" },
    replay: {
      draw: "at every entry signal where tick.ts would ask the model (flat, the rulebook says enter, not cooling down, and — daily cadence — the bar that closes at 00:00 UTC), one of the five replies the real model gave to that exact state, uniformly, through the live combineDecision",
      draws: DRAWS, nullDraws: NULL_DRAWS, calibration: { drawsPerStep: CAL_DRAWS, bisectionSteps: CAL_ITERS }, shadowDraws: SHADOW_DRAWS,
      null: "the measured replay's episode null (backtest_jev.ts's episodeNullPolicy): a run of consecutive decisions on which the rulebook wants in is refused as a whole with probability pEp, decided on its first decision; pEp calibrated by bisection so the null takes the gate's mean number of entries. An episode is consecutive bars, or consecutive days on the daily cadence.",
      seeds: "mulberry32, seeded by FNV-1a of (purpose, row, evaluation, window, coin, draw) — backtest_jev.ts's seedOf",
    },
    caveats: [
      ...answerCaveats,
      "momentum-1d is priced at two cadences because the published tables decide it on every 4-hour bar and tick.ts decides it once a day; a refused entry is asked again four hours later in the first and a day later in the second.",
      "trend-1h cannot be priced on Kraken's own tape in window A: the hourly bundle ends 2026-06-30 (set2.json records the same limit). Its Kraken-tape evaluations take the worst window over B, C and D.",
      "Under the trail stop rule momentum-1d carries the 3×ATR(14) intra-bar trail, as set2.json priced it; §3.17 gave momentum the floor alone under both rules, and on that reading the trail evaluations are the shipped ones.",
      "The four evaluations are near-duplicates, not four independent tests (§3.19), and window D is the same on both tapes.",
      "The null is matched on ENTRIES, not on time in the market: compare null.nullDeploymentMean with null.gateDeploymentMean before reading a per-window P. With the v2 wording at 0.45 on both rules (jev_v2_other.json), on momentum-1d under the shipped stop a refused null episode is a whole stretch of positive momentum, while the gate mostly delays an entry until the 4-hour picture turns, so the null holds the coins less of the time than the gate: its per-window comparison there mixes selection with exposure, favouring the gate in rising windows and the null in falling ones. On trend-1h and under the trail the two are matched much more closely. Another wording is read off those two fields, not assumed.",
      "Fills are the next bar's open at the touch plus Revolut X's 9 bps; nothing here measures execution.",
    ],
    windows: {
      A: "parameters on the first two thirds, the LAST third out of sample (bear)", B: "parameters on the first third, the MIDDLE third out of sample (bull)",
      C: "the first third out of sample after 24 months of extended history (strong bull)", D: "the 12 months before the series out of sample (sideways)",
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
    },
    conditions: { list: CONDITIONS.map((c) => c.id), primary: PRIMARY.id, stopRules: { shipped: stopsOf("shipped", DEFAULT_TREND), trail: stopsOf("trail", DEFAULT_TREND) }, note: "§3.19: a change must beat the incumbent on its WORST window in all four evaluations; they are near-duplicates, and window D is identical on both tapes. Each row's reentryBars replaces the stop rule's (rows)." },
    data: dataRows,
    fidelity: {
      cacheAndCopyVsRun: { ...fid, fields: FIELDS, what: "runGated through the flat-bar cache against runGated through a decider that rebuilds the snapshot and the cadence on every bar (every field and every mark), and — on the rows decided every bar — against backtest.ts's run (every field and every equity point it samples): every row × evaluation × priced window × coin × venue cost" },
      dailyCadence: { what: "per tape · window · coin: UTC days in the window, bars on which the daily row decides (one per day, the bar closing at 00:00 UTC), and days a missing bar leaves undecided", perRow: cadence },
      windowDIsTheSameOnBothTapes: { rowStopRulePairs: windowDCells, differences: windowDDiffs, what: "the rulebook arm in window D on the Coinbase-spliced tape against Kraken's own, every coin's return and trades — D lies wholly inside Kraken's bundle, so the tape dimension is degenerate there (§4.21)" },
      incumbent: { cells: incumbentCells, missing: incumbentMissing, worstAbsDiff: r4(incumbentWorstDiff), perRow: incumbent, what: "the rulebook arm's sleeve against the published rows: momentum-1d (every 4-hour bar) against set2.json's `momentum-1d·revx (paper)` on all four evaluations and against testingset.json's under the shipped stop on the Coinbase tape; trend-1h against testingset.json's `trend-1h·revx` on the Coinbase tape under both stop rules. The daily-cadence row has no published counterpart. Any difference throws." },
      shadowIsTheRulebook: { rowEvaluationWindowDraws: shadowCells, differences: shadowDiffs, entriesTheModelWasShown: shadowShown, wouldHaveRefused: shadowWould, what: `combineDecision(…, gate = false) with real draws, ${SHADOW_DRAWS} per row × evaluation × window, against the rulebook on sleeve return, drawdown, entries and every coin's return and trades` },
    },
    refusedSignals: {
      what: "the rulebook's OWN entry signals — on its own path every signal where tick.ts would ask the model is an entry — and the share the gate at this threshold refuses, weighted by how often each state occurs (a state refused on k of its five replies counts k/5)",
      perRow: refusedSignals,
    },
    switchedOff: {
      what: "the gate's entries and deployment as a share of the rulebook's, per evaluation and window (means over the draws); gateAsks counts every time the model is asked on the gate's own path, a refused entry being asked again at the next decision",
      perRow: switchedOff,
    },
    configurations,
    perCoinPrimary,
    verdict: {
      standard: "the bar: the gate must not lower the rulebook's WORST window in any of the four evaluations AND must beat a random veto that takes the same number of entries there (the null does as well or better on the worst window in ≤ 5 % of draws) — `passesTheBar`. The gate's worst window is the worst of its per-window means over the draws, as backtest_jev.ts's measured replay reads it; `lowersTheWorstWindowOnTheMeanOfEachDrawsWorstIn` gives the other reading (the mean over draws of each draw's worst). The null is compared draw by draw, each draw's worst against each null draw's worst. `passesTheStricterReading` also requires the worst window to rise, the reading jev_v2.json reports. Judged on return and, separately, on return over drawdown (the mean over draws of each draw's worst score).",
      perRow: verdict,
    },
    checkAgainst: { note: "not requested" } as Record<string, unknown>,
    sourceIntegrity: { ...hashesStart, note: "SHA-256 of every source file this script's module graph holds — backtest.ts, backtest_jev.ts (imported, unmodified), this script, agents_strategy.ts and _shared/jev.ts (imported by backtest_jev.ts; nothing here calls it) — and of the answers file, the two published files the rule arms are checked against and, when supplied, the pre-registration, at the start of the run; the run throws if any changed before it finished" },
  };

  // ── --check-against: the same study as a committed output, cell by cell ──
  if (reference) {
    const cmp = compareReports(JSON.parse(JSON.stringify(report)), reference.json, CHECK_EXCLUDED);
    const c = cmp.compared, total = c.numbers + c.booleans + c.strings + c.nulls + c.arrayLengths;
    const empty = CHECK_SECTIONS.filter((s) => !(c.bySection[s] > 0));
    if (empty.length) throw new Error(`--check-against ${reference.path}: no cell compared in ${empty.join(", ")}`);
    if (cmp.differences.length) {
      const bySection: Record<string, number> = {};
      for (const d of cmp.differences) { const s = d.path.split(/[.[]/)[0]; bySection[s] = (bySection[s] ?? 0) + 1; }
      const shown = (v: unknown) => { const t = JSON.stringify(v) ?? String(v); return t.length > 80 ? `${t.slice(0, 77)}…` : t; };
      const SHOW = 80;
      throw new Error([
        `--check-against ${reference.path}: ${cmp.differences.length} of ${total} compared cells differ (${Object.entries(bySection).map(([s, n]) => `${s} ${n}`).join(", ")}); nothing was written`,
        ...cmp.differences.slice(0, SHOW).map((d) => `  ${d.path}: here ${shown(d.here)}, there ${shown(d.there)}`),
        ...(cmp.differences.length > SHOW ? [`  … and ${cmp.differences.length - SHOW} more`] : []),
      ].join("\n"));
    }
    report.checkAgainst = {
      file: reference.path, sha256: reference.sha256,
      what: "every cell both outputs have — every number, boolean, string and null, and every array's length — compared exactly (this output after its own JSON round trip); any difference throws and nothing is written",
      compared: { total, ...c }, differences: 0, excluded: CHECK_EXCLUDED, onlyHere: cmp.onlyHere, onlyThere: cmp.onlyThere,
    };
    say(`checked against ${reference.path}: ${total} cells (${c.numbers} numbers, ${c.booleans} booleans, ${c.strings} strings, ${c.nulls} nulls, ${c.arrayLengths} array lengths), 0 differences | excluded: ${Object.keys(CHECK_EXCLUDED).join(", ")} | only here: ${cmp.onlyHere.join(", ") || "none"} | only there: ${cmp.onlyThere.join(", ") || "none"}`);
  }

  await Deno.writeTextFile(`${outDir}/${OUT_NAME}`, JSON.stringify(report, null, 1));
  say(`wrote ${outDir}/${OUT_NAME}`);
}

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length)) as Record<string, string>;
  await otherRowsStudy(args);
}
