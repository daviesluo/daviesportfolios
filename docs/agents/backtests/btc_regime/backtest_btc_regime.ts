// S1 — THE BTC-REGIME ENTRY FILTER on the row that is going live, re-tested on
// non-bear windows as reference §3.9 required. A study, not a rulebook.
// Pre-registration: docs/agents/reviews/2026-09-24-btc-regime-prereg.md (its
// definitions are this file's; the stage `definitions` printed the numbers it
// quotes before any arm existed). Run by hand, from the repository root:
//
//   deno run --allow-read --allow-write \
//     docs/agents/backtests/btc_regime/backtest_btc_regime.ts \
//     --data  <dir with BTC-USD_1h_3y.json …>        (Coinbase Exchange hourly)
//     --ext   <dir with BTC-USD_1h_kraken.json …>    (Kraken quarterly bundle, hourly)
//     --ktape <dir with BTC-USD_4h_kraken.json …>    (Kraken's own 4h tape)
//     --set2  docs/agents/backtests/set2.json
//     --sui   docs/agents/backtests/sui.json
//     --out   docs/agents/backtests/btc_regime
//     [--stage definitions | smoke | full]           (default full)
//
// `definitions` runs NO arm: it reproduces the four-coin incumbent against the
// committed results, cuts the windows (A–D, and the fresh windows E–H that no
// study has scored out of sample), prices buy-and-hold on each so the bear /
// non-bear label is fixed from the market alone, and reports where BTC's
// averages are defined. It writes nothing. `smoke` runs the whole arm, null and
// verdict machinery on a PLACEBO gate that has nothing to do with BTC (refuse
// an entry whose decision falls on an even UTC day of the year), with 50 kept
// null draws, and writes to --out/smoke.json — plumbing, not evidence. `full`
// writes <out>/btc_regime.json and nothing else.
//
// ── what is imported and what is not ─────────────────────────────────
//
// Everything that fills, charges, stops, cools down, cuts a window or adds a
// sleeve is IMPORTED: `run` and `COSTS` from backtest.ts; `sma` and the
// rulebook from agents_strategy.ts; `loadMeasuredSeries`, `buildTrack`,
// `trackDecider`, `runGated`, `episodeNullPolicy`, `counting`, `combine`,
// `dailyReturns`, `stopsOf`, `CONDITIONS`, `seedOf`, `mulberry32`, `atLeast`,
// `summarize`, `score` from backtest_jev.ts. What is written here is the
// gate (twelve lines), the window cuts for E–H (the same one-year steps
// `windowsOn` takes for C and D, continued backwards), the in-sample choice
// of N, and the verdict arithmetic.
//
// ── determinism ──────────────────────────────────────────────────────
//
// No wall clock is written. Draws come from mulberry32(seedOf(purpose,
// evaluation, window, coin, draw)). Source files are hashed at the start and
// the end and a run that straddles an edit throws.

import { DEFAULT_TREND, sma, type Candle } from "../../../../supabase/functions/_shared/agents_strategy.ts";
import { COSTS, run } from "../../../../supabase/functions/agents/backtest.ts";
import {
  atLeast, BAR_HOURS, buildTrack, combine, CONDITIONS, counting, dailyReturns, episodeNullPolicy, indexAtOrAfter, iso,
  loadMeasuredSeries, meanOf, mulberry32, PRIMARY, r3, r4, rulePolicy, runGated, score, seedOf, stopsOf, summarize,
  trackDecider,
  type Condition, type EntryPolicy, type GatedResult, type MeasuredSeries, type SleeveStats, type Tally, type Tape,
  type Track,
} from "../../../../supabase/functions/agents/backtest_jev.ts";

// ───────────────────────────────────────────────────────── the fixed numbers

/** The live row the draft creates (`go_live.sql.draft`): four coins, one equal slot each. */
const SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD"] as const;
const SLOT_USD = 25;
/** §3.9's grid for the regime average, in days. */
const N_GRID = [100, 150, 200] as const;
type N = typeof N_GRID[number];
/** The fresh windows run on the two coins whose history reaches every one of them and its in-sample span. */
const FRESH_SYMBOLS = ["BTC/USD", "ETH/USD"] as const;
const ALL_WINDOWS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
type W = typeof ALL_WINDOWS[number];
const PRIMARY_WINDOWS: W[] = ["A", "B", "C", "D"];
const FRESH_WINDOWS: W[] = ["E", "F", "G", "H"];
/** A window is BEAR when the equal-weight buy-and-hold of its coins over its out-of-sample span is below this. */
const BEAR_BELOW = -0.20;
const YEAR_MS = 365 * 86400e3;
const DAY_MS = 86400e3;
/** Pre-registered draw counts; the smoke stage uses fewer and says so. */
const NULL_DRAWS_DEFAULT = 1000, CAL_DRAWS = 100, CAL_ITERS = 10, MAX_ATTEMPTS = 50000;
const ALPHA = 0.05;
const EPS = 1e-12;

const sha256 = async (path: string | URL): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ───────────────────────────────────────────────────────────── the gate

/** BTC's daily closes on one tape and the three averages §3.9 switches on. */
type BtcBook = { daily: Candle[]; starts: number[]; sma: Record<N, (number | null)[]> };
function btcBook(daily: Candle[]): BtcBook {
  const closes = daily.map((c) => c.close);
  return { daily, starts: daily.map((c) => c.start), sma: { 100: sma(closes, 100), 150: sma(closes, 150), 200: sma(closes, 200) } };
}
/**
 * §3.9's idea 1, exactly as `backtest_ideas.ts` `regimeFiltered` reads it: at the close of a 4h bar, the last BTC daily
 * candle that has CLOSED (start + 1 day ≤ decision time); the entry is allowed when that close is strictly above the
 * N-day simple average ending on it, and allowed when no close or no average exists yet. Exits are never touched.
 */
function regimeAllows(b: BtcBook, n: N, decisionMs: number): boolean {
  let lo = 0, hi = b.starts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (b.starts[mid] + DAY_MS <= decisionMs) lo = mid + 1; else hi = mid; }
  const j = lo - 1;
  if (j < 0) return true;
  const ma = b.sma[n][j];
  if (ma == null) return true;
  return b.daily[j].close > ma;
}
const decisionMs = (t: Track, i: number) => t.bars[i].start + BAR_HOURS * 3600e3;
const regimePolicy = (b: BtcBook, n: N, t: Track): EntryPolicy => (i) => regimeAllows(b, n, decisionMs(t, i)) ? "enter" : "hold";
/** The smoke stage's placebo: nothing to do with BTC, deterministic, refuses about half the entry bars. */
const placeboPolicy = (t: Track): EntryPolicy => (i) => {
  const d = new Date(decisionMs(t, i));
  const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS);
  return doy % 2 === 0 ? "hold" : "enter";
};

// ─────────────────────────────────────────────────────────── the windows

type Span = { from: number; to: number };
type WinCut = {
  name: W; symbols: string[];
  oosFromTs: number; oosToTs: number; isFromTs: number; isToTs: number;
  oos: Record<Tape, Record<string, Span>>; is: Record<Tape, Record<string, Span>>;
  dropped: Record<string, string>;
};

/** The end timestamp of index `idx` of a bar array, as backtest_jev.ts's loader takes it. */
const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;

/**
 * A–D: the loader's own out-of-sample spans (both tapes), and the in-sample timestamps `windowsOn` cut. E–H: the same
 * one-year steps `windowsOn` takes for C (two years of in-sample before the Coinbase start) and D (one year before it),
 * continued backwards from each coin's Coinbase start — E = [cb0 − 2y, cb0 − 1y) with in-sample [cb0 − 4y, cb0 − 2y),
 * F one year earlier, and so on — on the combined series and on Kraken's tape, for BTC and ETH.
 */
function cutWindows(series: Record<string, MeasuredSeries>): WinCut[] {
  const out: WinCut[] = [];
  for (const name of ALL_WINDOWS) {
    const fresh = FRESH_WINDOWS.includes(name);
    const symbols = fresh ? [...FRESH_SYMBOLS] : [...SYMBOLS];
    const cut: WinCut = { name, symbols: [], oosFromTs: Infinity, oosToTs: -Infinity, isFromTs: Infinity, isToTs: -Infinity, oos: { coinbase: {}, kraken: {} }, is: { coinbase: {}, kraken: {} }, dropped: {} };
    for (const s of symbols) {
      const m = series[s];
      let isFromTs: number, isToTs: number, oosFromTs: number, oosToTs: number;
      if (!fresh) {
        const w = m.wins.find((x) => x.name === name);
        if (!w || !w.scored) { cut.dropped[s] = `window ${name} not scored for ${s}`; continue; }
        const isArr = w.isSeries === "coinbase" ? m.cb4h : m.comb4h;
        isFromTs = isArr[w.isFrom].start; isToTs = endTs(isArr, w.isTo);
        oosFromTs = m.comb4h[w.oosFrom].start; oosToTs = endTs(m.comb4h, w.oosTo);
      } else {
        const k = FRESH_WINDOWS.indexOf(name) + 2;          // E is two years back, F three, …
        const cb0 = m.cb4h[0].start;
        oosFromTs = m.comb4h[indexAtOrAfter(m.comb4h, cb0 - k * YEAR_MS)].start;
        oosToTs = m.comb4h[indexAtOrAfter(m.comb4h, cb0 - (k - 1) * YEAR_MS)].start;
        isFromTs = m.comb4h[indexAtOrAfter(m.comb4h, cb0 - (k + 2) * YEAR_MS)].start;
        isToTs = oosFromTs;
      }
      const tapes: Record<Tape, Candle[]> = { coinbase: m.comb4h, kraken: m.kTape };
      let ok = true;
      for (const tape of ["coinbase", "kraken"] as Tape[]) {
        const bars = tapes[tape];
        if (!fresh && tape === "coinbase") {
          const span = m.oos.coinbase[name as "A" | "B" | "C" | "D"];
          if (!span) { ok = false; cut.dropped[s] = `no coinbase span for ${name}`; break; }
          cut.oos.coinbase[s] = span;
        } else if (!fresh && tape === "kraken") {
          const span = m.oos.kraken[name as "A" | "B" | "C" | "D"];
          if (!span) { ok = false; cut.dropped[s] = `no kraken span for ${name}: ${m.krakenDropped[name as "A" | "B" | "C" | "D"] ?? "?"}`; break; }
          cut.oos.kraken[s] = span;
        } else {
          if (bars[0].start > isFromTs - (DEFAULT_TREND.slow + 1) * 4 * 3600e3) { ok = false; cut.dropped[s] = `${tape} tape starts ${iso(bars[0].start)}, too late for window ${name}'s in-sample`; break; }
          cut.oos[tape][s] = { from: indexAtOrAfter(bars, oosFromTs), to: indexAtOrAfter(bars, oosToTs) };
        }
        cut.is[tape][s] = { from: indexAtOrAfter(bars, isFromTs), to: indexAtOrAfter(bars, isToTs) };
      }
      if (!ok) { delete cut.oos.coinbase[s]; delete cut.oos.kraken[s]; delete cut.is.coinbase[s]; delete cut.is.kraken[s]; continue; }
      cut.symbols.push(s);
      cut.oosFromTs = Math.min(cut.oosFromTs, oosFromTs); cut.oosToTs = Math.max(cut.oosToTs, oosToTs);
      cut.isFromTs = Math.min(cut.isFromTs, isFromTs); cut.isToTs = Math.max(cut.isToTs, isToTs);
    }
    out.push(cut);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── the run

async function main(args: Record<string, string>): Promise<void> {
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? "");
  const set2Path = String(args.set2 ?? "docs/agents/backtests/set2.json");
  const suiPath = String(args.sui ?? "docs/agents/backtests/sui.json");
  const outDir = String(args.out ?? "docs/agents/backtests/btc_regime");
  const stage = String(args.stage ?? "full");
  if (!["definitions", "smoke", "full"].includes(stage)) throw new Error(`--stage ${stage}`);
  if (!dataDir || !extDir || !kDir) throw new Error("needs --data, --ext and --ktape (see the header)");
  const NULL_DRAWS = stage === "smoke" ? 50 : Number(args["null-draws"] ?? NULL_DRAWS_DEFAULT);
  const preregisteredDraws = NULL_DRAWS === NULL_DRAWS_DEFAULT;

  const srcUrls = {
    backtestTs: new URL("../../../../supabase/functions/agents/backtest.ts", import.meta.url),
    agentsStrategyTs: new URL("../../../../supabase/functions/_shared/agents_strategy.ts", import.meta.url),
    backtestJevTs: new URL("../../../../supabase/functions/agents/backtest_jev.ts", import.meta.url),
    thisScript: new URL(import.meta.url),
  };
  const hashSources = async () => ({
    backtestTs: await sha256(srcUrls.backtestTs), agentsStrategyTs: await sha256(srcUrls.agentsStrategyTs),
    backtestJevTs: await sha256(srcUrls.backtestJevTs), thisScript: await sha256(srcUrls.thisScript),
  });
  const hashesStart = await hashSources();
  const t0 = Date.now();
  const say = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${m}`);

  // ── the data: the measured study's tapes, by import ─────────────────
  const { series, dataRows, symbols } = await loadMeasuredSeries(dataDir, extDir, kDir);
  for (const s of SYMBOLS) if (!symbols.includes(s)) throw new Error(`${s} failed the loader's splice test`);
  const tapeHashes: Record<string, string> = {};
  for (const s of SYMBOLS) {
    const b = s.replace("/", "-");
    tapeHashes[`data/${b}_1h_3y.json`] = await sha256(`${dataDir}/${b}_1h_3y.json`);
    tapeHashes[`ext/${b}_1h_kraken.json`] = await sha256(`${extDir}/${b}_1h_kraken.json`);
    tapeHashes[`ktape/${b}_4h_kraken.json`] = await sha256(`${kDir}/${b}_4h_kraken.json`);
  }
  const cuts = cutWindows(series);
  const cutOf = (w: W) => cuts.find((c) => c.name === w)!;
  const barsOf = (s: string, tape: Tape) => tape === "coinbase" ? { bars: series[s].comb4h, daily: series[s].combDaily } : { bars: series[s].kTape, daily: series[s].kDaily };
  const btc: Record<Tape, BtcBook> = { coinbase: btcBook(series["BTC/USD"].combDaily), kraken: btcBook(series["BTC/USD"].kDaily) };

  const trackCache = new Map<string, Track>();
  const track = (tape: Tape, s: string, w: W, part: "oos" | "is"): Track => {
    const key = `${part}|${tape}|${s}|${w}`;
    let t = trackCache.get(key);
    if (!t) {
      const span = cutOf(w)[part][tape][s];
      if (!span) throw new Error(`${s} ${w} ${part} not priced on ${tape}`);
      const { bars, daily } = barsOf(s, tape);
      t = buildTrack(s, bars, daily, DEFAULT_TREND, span.from, span.to);
      trackCache.set(key, t);
    }
    return t;
  };
  const coinsIn = (w: W, tape: Tape, part: "oos" | "is" = "oos") =>
    cutOf(w).symbols.filter((s) => { const sp = cutOf(w)[part][tape][s]; return sp && sp.to - Math.max(sp.from, DEFAULT_TREND.slow + 1) > 2; });

  // ── sleeves ─────────────────────────────────────────────────────────
  const sleeveOf = (per: Record<string, GatedResult>): SleeveStats => combine(Object.entries(per).map(([s, r]) => ({
    id: `trend-4h-live·revx·${s.split("/")[0]}`, symbol: s, slotUsd: SLOT_USD, rets: dailyReturns(r.marks),
    ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * SLOT_USD,
  })));
  type PolicyAt = (s: string, t: Track) => EntryPolicy;
  type ArmRun = { per: Record<string, GatedResult>; stats: SleeveStats; entries: number; signals: number; refused: number; entriesByCoin: Record<string, number> };
  const runArm = (cond: Condition, w: W, part: "oos" | "is", policyAt: PolicyAt): ArmRun => {
    const per: Record<string, GatedResult> = {};
    let entries = 0, signals = 0, refused = 0;
    const entriesByCoin: Record<string, number> = {};
    for (const s of coinsIn(w, cond.tape, part)) {
      const t = track(cond.tape, s, w, part);
      const tally: Tally = { signals: 0, refused: 0, coinFlip: 0, coinFlipRefused: 0 };
      const g = runGated(s, t.bars, t.from, t.to, t.warmup, trackDecider(t, counting(policyAt(s, t), tally)), COSTS.revx, stopsOf(cond.stopRule, t.p));
      per[s] = g; entries += g.entries; signals += tally.signals; refused += tally.refused; entriesByCoin[s] = g.entries;
    }
    return { per, stats: sleeveOf(per), entries, signals, refused, entriesByCoin };
  };
  const runLight = (cond: Condition, w: W, policyAt: PolicyAt): { ret: number; maxDD: number; entries: number } => {
    const per: Record<string, GatedResult> = {};
    let entries = 0;
    for (const s of coinsIn(w, cond.tape)) {
      const t = track(cond.tape, s, w, "oos");
      const g = runGated(s, t.bars, t.from, t.to, t.warmup, trackDecider(t, policyAt(s, t)), COSTS.revx, stopsOf(cond.stopRule, t.p));
      per[s] = g; entries += g.entries;
    }
    const st = sleeveOf(per);
    return { ret: st.ret, maxDD: st.maxDD, entries };
  };

  // ── the incumbent, and its reproduction ─────────────────────────────
  const inc: Record<string, Partial<Record<W, ArmRun>>> = {};
  let runChecks = 0, runMismatches = 0;
  for (const cond of CONDITIONS) {
    inc[cond.id] = {};
    for (const w of ALL_WINDOWS) {
      if (coinsIn(w, cond.tape).length === 0) continue;
      const a = runArm(cond, w, "oos", () => rulePolicy);
      inc[cond.id][w] = a;
      for (const [s, g] of Object.entries(a.per)) {
        const t = track(cond.tape, s, w, "oos");
        const rr = run("trend-4h", s, t.bars, t.daily, t.from, t.to, t.p, COSTS.revx, BAR_HOURS, stopsOf(cond.stopRule, t.p));
        runChecks++;
        if (rr.ret !== g.ret || rr.maxDD !== g.maxDD || rr.trades !== g.trades || rr.exposure !== g.exposure) runMismatches++;
      }
    }
  }
  if (runMismatches) throw new Error(`runGated is not run on ${runMismatches} of ${runChecks} cells`);
  // Four coins on A and B: sui.json's "without SUI" sleeve (four $25 slots). C and D: SUI has no data there, so the
  // four-coin sleeve IS set2.json's `equal` row.
  type Set2Rows = Record<string, { perWindow: Record<string, { ret: number; maxDD: number; members: number }> }>;
  const s2 = JSON.parse(await Deno.readTextFile(set2Path)) as { a2_theWeights: { rows: { arm: string; perCondition: Set2Rows }[] } };
  const set2Equal = s2.a2_theWeights.rows.find((r) => r.arm === "equal")!.perCondition;
  const sui = JSON.parse(await Deno.readTextFile(suiPath)) as { s1_theWindowsSuiHas: { byCondition: Record<string, { perWindow: Record<string, { perCoin: Record<string, { withoutIt: { ret: number; maxDD: number } }> }> }> } };
  let reproWorst = 0;
  const reproduction: Record<string, unknown> = {};
  for (const cond of CONDITIONS) {
    const perW: Record<string, unknown> = {};
    for (const w of PRIMARY_WINDOWS) {
      const st = inc[cond.id][w]!.stats;
      const ref = w === "A" || w === "B"
        ? sui.s1_theWindowsSuiHas.byCondition[cond.id].perWindow[w].perCoin["SUI/USD"].withoutIt
        : set2Equal[cond.id].perWindow[w];
      reproWorst = Math.max(reproWorst, Math.abs(st.ret - ref.ret), Math.abs(st.maxDD - ref.maxDD));
      perW[w] = { here: { ret: st.ret, maxDD: st.maxDD, members: st.members }, committed: { ret: ref.ret, maxDD: ref.maxDD, from: w === "A" || w === "B" ? "sui.json withoutIt(SUI)" : "set2.json equal" } };
    }
    reproduction[cond.id] = perW;
  }
  say(`incumbent (four coins, $${SLOT_USD} slots): runGated ≡ run on ${runChecks} cells | against sui.json (A, B) and set2.json (C, D): worst |Δ| ${reproWorst}`);
  for (const cond of CONDITIONS) say(`  ${cond.id}: ${ALL_WINDOWS.filter((w) => inc[cond.id][w]).map((w) => `${w} ${(inc[cond.id][w]!.stats.ret * 100).toFixed(2)}% (DD ${(inc[cond.id][w]!.stats.maxDD * 100).toFixed(2)}%, ${inc[cond.id][w]!.entries} entries)`).join(" | ")}`);
  if (reproWorst !== 0) throw new Error(`the four-coin incumbent does not reproduce: worst |Δ| ${reproWorst}`);

  // ── the windows' regimes, from the market alone ─────────────────────
  const regimes: Record<string, unknown> = {};
  for (const c of cuts) {
    const perCoin: Record<string, number> = {};
    for (const s of c.symbols) {
      const span = c.oos.coinbase[s];
      const bars = series[s].comb4h;
      perCoin[s] = r4(bars[span.to - 1].close / bars[Math.max(span.from, 1) - 1].close - 1);
    }
    const ew = meanOf(Object.values(perCoin));
    regimes[c.name] = {
      coins: c.symbols, dropped: c.dropped,
      oos: `${iso(c.oosFromTs)} → ${iso(c.oosToTs)}`, inSample: `${iso(c.isFromTs)} → ${iso(c.isToTs)}`,
      buyAndHoldByCoin: perCoin, equalWeightBuyAndHold: r4(ew), bear: ew < BEAR_BELOW,
    };
    say(`window ${c.name}: ${c.symbols.map((s) => s.split("/")[0]).join("/")} OOS ${iso(c.oosFromTs)} → ${iso(c.oosToTs)} | IS from ${iso(c.isFromTs)} | buy-and-hold ${Object.entries(perCoin).map(([s, v]) => `${s.split("/")[0]} ${(v * 100).toFixed(1)}%`).join(", ")} → equal weight ${(ew * 100).toFixed(1)}% → ${ew < BEAR_BELOW ? "BEAR" : "not bear"}${Object.keys(c.dropped).length ? ` (dropped: ${JSON.stringify(c.dropped)})` : ""}`);
  }
  const avgFrom = (b: BtcBook, n: N) => { const j = b.sma[n].findIndex((v) => v != null); return j >= 0 ? isoDay(b.daily[j].start) : "never"; };
  const btcDefined = Object.fromEntries((["coinbase", "kraken"] as Tape[]).map((tape) => [tape, { firstDaily: isoDay(btc[tape].daily[0].start), lastDaily: isoDay(btc[tape].daily[btc[tape].daily.length - 1].start), smaDefinedFrom: Object.fromEntries(N_GRID.map((n) => [n, avgFrom(btc[tape], n)])) }]));
  say(`BTC daily averages defined from: ${JSON.stringify(btcDefined)}`);
  for (const c of cuts) {
    for (const tape of ["coinbase", "kraken"] as Tape[]) {
      const first = Math.min(...Object.entries(c.is[tape]).map(([s, sp]) => barsOf(s, tape).bars[sp.from].start));
      const undefinedAt = N_GRID.filter((n) => { const j = btc[tape].sma[n].findIndex((v) => v != null); return j < 0 || btc[tape].daily[j].start + DAY_MS > first; });
      if (undefinedAt.length) say(`  note: window ${c.name} on ${tape}: BTC's ${undefinedAt.join("/")}-day average is not yet defined at the in-sample start (${iso(first)}) — the gate allows there, as §3.9's does`);
    }
  }
  if (stage === "definitions") { say("definitions stage: no arm was run and nothing was written"); return; }

  // ══════════════════════════════════════════════════════════ the arms
  // The primary arm: N chosen per evaluation × window on that window's IN-SAMPLE span by the gated four-coin (or, for
  // E–H, two-coin) sleeve's return over drawdown, ties to the larger N. The three fixed-N arms are reported beside it.
  const gatePolicy = (cond: Condition, n: N): PolicyAt => stage === "smoke" ? (_s, t) => placeboPolicy(t) : (_s, t) => regimePolicy(btc[cond.tape], n, t);
  const chosenN: Record<string, Partial<Record<W, { n: N; inSample: Record<string, { ret: number; maxDD: number; score: number; entries: number; coins: number }> }>>> = {};
  const arms: Record<string, Partial<Record<W, { chosen: ArmRun; fixed: Record<string, ArmRun> }>>> = {};
  for (const cond of CONDITIONS) {
    chosenN[cond.id] = {}; arms[cond.id] = {};
    for (const w of ALL_WINDOWS) {
      if (!inc[cond.id][w]) continue;
      const isScores: Record<string, { ret: number; maxDD: number; score: number; entries: number; coins: number }> = {};
      let best: N = N_GRID[0], bestScore = -Infinity;
      for (const n of N_GRID) {
        const a = runArm(cond, w, "is", gatePolicy(cond, n));
        const sc = score(a.stats);
        isScores[n] = { ret: a.stats.ret, maxDD: a.stats.maxDD, score: r4(sc), entries: a.entries, coins: a.stats.members };
        if (sc > bestScore - EPS) { if (sc > bestScore + EPS || n > best) best = n; bestScore = Math.max(bestScore, sc); }
      }
      chosenN[cond.id][w] = { n: best, inSample: isScores };
      const fixed: Record<string, ArmRun> = {};
      for (const n of N_GRID) fixed[n] = runArm(cond, w, "oos", gatePolicy(cond, n));
      arms[cond.id][w] = { chosen: fixed[best], fixed };
    }
    say(`${cond.id}: chosen N ${ALL_WINDOWS.filter((w) => chosenN[cond.id][w]).map((w) => `${w} ${chosenN[cond.id][w]!.n}`).join(" · ")}`);
  }

  // ── the null for the primary arm: the same number of entries refused at random, whole episodes ──
  type NullOut = { rets: Float64Array; dds: Float64Array; pEp: number; kept: number; attempts: number; calibration: { pEp: number; meanEntries: number }[]; note: string };
  const nulls: Record<string, Partial<Record<W, NullOut>>> = {};
  for (const cond of CONDITIONS) {
    nulls[cond.id] = {};
    for (const w of ALL_WINDOWS) {
      const a = arms[cond.id][w];
      if (!a) continue;
      const target = a.chosen.entries, baseEntries = inc[cond.id][w]!.entries;
      let lo = 0, hi = 1;
      const calibration: { pEp: number; meanEntries: number }[] = [];
      if (target < baseEntries) {
        for (let it = 0; it < CAL_ITERS; it++) {
          const mid = (lo + hi) / 2;
          let tot = 0;
          for (let k = 0; k < CAL_DRAWS; k++) tot += runLight(cond, w, (s) => episodeNullPolicy(mid, mulberry32(seedOf("cal", cond.id, w, s, k)))).entries;
          calibration.push({ pEp: r4(mid), meanEntries: r3(tot / CAL_DRAWS) });
          if (tot / CAL_DRAWS > target) lo = mid; else hi = mid;
        }
      }
      const pEp = target < baseEntries ? (lo + hi) / 2 : 0;
      const rs: number[] = [], ds: number[] = [];
      let attempts = 0;
      if (target <= baseEntries) {
        while (rs.length < NULL_DRAWS && attempts < MAX_ATTEMPTS) {
          const o = runLight(cond, w, (s) => episodeNullPolicy(pEp, mulberry32(seedOf("null", cond.id, w, s, attempts))));
          attempts++;
          if (o.entries === target) { rs.push(o.ret); ds.push(o.maxDD); }
        }
      }
      const note = target > baseEntries ? "the arm takes MORE entries than the incumbent; no refusal can match it — counts against the arm"
        : target === baseEntries ? "the arm takes as many entries as the incumbent; the null is the incumbent itself"
        : rs.length < NULL_DRAWS ? `only ${rs.length} draws landed on the count in ${attempts} attempts` : "";
      nulls[cond.id][w] = { rets: Float64Array.from(rs), dds: Float64Array.from(ds), pEp, kept: rs.length, attempts, calibration, note };
      say(`null ${cond.id} ${w}: inc ${(inc[cond.id][w]!.stats.ret * 100).toFixed(2)}% (${baseEntries}) | arm N=${chosenN[cond.id][w]!.n} ${(a.chosen.stats.ret * 100).toFixed(2)}% (${target}, ${a.chosen.refused} signals refused) | null p05/p50/p95 ${rs.length ? `${(summarize(rs).p05 * 100).toFixed(2)}/${(summarize(rs).p50 * 100).toFixed(2)}/${(summarize(rs).p95 * 100).toFixed(2)}` : "—"}% (pEp ${pEp.toFixed(3)}, kept ${rs.length}/${attempts})`);
    }
  }

  // ── the verdict, per evaluation ─────────────────────────────────────
  // C1 the arm's worst window beats the incumbent's worst window (strictly, on combine's rounding).
  // C2 the null's worst window (draws paired across windows by index) does as well or better in at most 5 % of draws.
  // C3 no other window is COSTED beyond chance: where the arm is below the incumbent, at least 5 % of the null's draws
  //    must be strictly below the arm (ties count against the arm); a window whose null cannot be built counts against it.
  const worstOf = (ws: W[], f: (w: W) => number) => { let wn = ws[0], v = Infinity; for (const w of ws) { const x = f(w); if (x < v) { v = x; wn = w; } } return { window: wn, value: v }; };
  const verdictFor = (cond: Condition, ws: W[]) => {
    const incW = worstOf(ws, (w) => inc[cond.id][w]!.stats.ret);
    const armW = worstOf(ws, (w) => arms[cond.id][w]!.chosen.stats.ret);
    const nullOk = ws.every((w) => nulls[cond.id][w]!.kept > 0);
    let pC2 = 1;
    let nullWorst: ReturnType<typeof summarize> | null = null;
    if (nullOk) {
      const n = Math.min(...ws.map((w) => nulls[cond.id][w]!.kept));
      const nw = new Float64Array(n);
      for (let k = 0; k < n; k++) nw[k] = Math.min(...ws.map((w) => nulls[cond.id][w]!.rets[k]));
      pC2 = atLeast(nw, armW.value);
      nullWorst = summarize(nw);
    }
    const c1 = armW.value > incW.value;
    const c2 = nullOk && pC2 <= ALPHA;
    const others: Record<string, unknown> = {};
    let c3 = true;
    for (const w of ws) {
      if (w === incW.window) continue;
      const a = arms[cond.id][w]!.chosen.stats.ret, b = inc[cond.id][w]!.stats.ret, nl = nulls[cond.id][w]!;
      let pBelow: number | null = null, ok = true;
      if (a < b) {
        if (nl.kept === 0) ok = false;
        else { let c = 0; for (let k = 0; k < nl.kept; k++) if (nl.rets[k] < a - EPS) c++; pBelow = c / nl.kept; ok = pBelow >= ALPHA; }
      }
      if (!ok) c3 = false;
      others[w] = { incumbent: b, arm: a, delta: r4(a - b), pNullStrictlyBelowArm: pBelow == null ? null : r3(pBelow), costsBeyondChance: !ok };
    }
    // Return over drawdown, the same C1/C2 — reported, never decides.
    const incS = worstOf(ws, (w) => score(inc[cond.id][w]!.stats)), armS = worstOf(ws, (w) => score(arms[cond.id][w]!.chosen.stats));
    return {
      windows: ws,
      c1_improvesTheWorstWindow: { incumbentWorst: { window: incW.window, ret: r4(incW.value) }, armWorst: { window: armW.window, ret: r4(armW.value) }, holds: c1 },
      c2_beatsChanceOnTheWorstWindow: { pNullWorstAtLeastArmWorst: nullOk ? r3(pC2) : null, nullWorst, holds: c2 },
      c3_costsNoOtherWindowBeyondChance: { perWindow: others, holds: c3 },
      onRetOverDD: { incumbentWorst: { window: incS.window, score: r3(incS.value) }, armWorst: { window: armS.window, score: r3(armS.value) }, beatsIncumbentWorst: armS.value > incS.value },
    };
  };
  const primaryVerdicts = Object.fromEntries(CONDITIONS.map((c) => [c.id, verdictFor(c, PRIMARY_WINDOWS)]));
  // The fresh windows: C3 in each NON-BEAR fresh window, judged against its own incumbent and null (they cannot upgrade).
  const freshNonBear = FRESH_WINDOWS.filter((w) => !(regimes[w] as { bear: boolean }).bear && CONDITIONS.every((c) => inc[c.id][w]));
  const freshC3: Record<string, Record<string, unknown>> = {};
  let freshCosts = false;
  for (const cond of CONDITIONS) {
    freshC3[cond.id] = {};
    for (const w of freshNonBear) {
      const a = arms[cond.id][w]!.chosen.stats.ret, b = inc[cond.id][w]!.stats.ret, nl = nulls[cond.id][w]!;
      let pBelow: number | null = null, ok = true;
      if (a < b) {
        if (nl.kept === 0) ok = false;
        else { let c = 0; for (let k = 0; k < nl.kept; k++) if (nl.rets[k] < a - EPS) c++; pBelow = c / nl.kept; ok = pBelow >= ALPHA; }
      }
      if (!ok) freshCosts = true;
      freshC3[cond.id][w] = { incumbent: b, arm: a, delta: r4(a - b), pNullStrictlyBelowArm: pBelow == null ? null : r3(pBelow), costsBeyondChance: !ok };
    }
  }
  const all = (k: "c1_improvesTheWorstWindow" | "c2_beatsChanceOnTheWorstWindow" | "c3_costsNoOtherWindowBeyondChance") => CONDITIONS.every((c) => primaryVerdicts[c.id][k].holds);
  const allC1 = all("c1_improvesTheWorstWindow"), allC2 = all("c2_beatsChanceOnTheWorstWindow"), allC3 = all("c3_costsNoOtherWindowBeyondChance");
  const verdict = !allC1 || !allC3 ? "REJECT" : !allC2 || freshCosts ? "INCONCLUSIVE" : "ADOPT";
  say(`VERDICT: ${verdict} — C1 ${CONDITIONS.map((c) => primaryVerdicts[c.id].c1_improvesTheWorstWindow.holds ? "✓" : "✗").join("")} C2 ${CONDITIONS.map((c) => primaryVerdicts[c.id].c2_beatsChanceOnTheWorstWindow.holds ? "✓" : "✗").join("")} C3 ${CONDITIONS.map((c) => primaryVerdicts[c.id].c3_costsNoOtherWindowBeyondChance.holds ? "✓" : "✗").join("")} | fresh non-bear windows ${freshNonBear.join("") || "none"} ${freshCosts ? "COST beyond chance somewhere" : "cost nothing beyond chance"}`);
  for (const c of CONDITIONS) {
    const v = primaryVerdicts[c.id];
    say(`  ${c.id}: worst inc ${v.c1_improvesTheWorstWindow.incumbentWorst.window} ${(v.c1_improvesTheWorstWindow.incumbentWorst.ret * 100).toFixed(2)}% → arm ${v.c1_improvesTheWorstWindow.armWorst.window} ${(v.c1_improvesTheWorstWindow.armWorst.ret * 100).toFixed(2)}%, P(null ≥) ${v.c2_beatsChanceOnTheWorstWindow.pNullWorstAtLeastArmWorst}; others ${JSON.stringify(v.c3_costsNoOtherWindowBeyondChance.perWindow)}`);
  }

  // ── the report ───────────────────────────────────────────────────────
  const row = (a: ArmRun) => ({ ret: a.stats.ret, maxDD: a.stats.maxDD, retOverDD: a.stats.retOverDD, entries: a.entries, entriesByCoin: a.entriesByCoin, signalsSeen: a.signals, signalsRefused: a.refused, deployment: a.stats.deployment, turnoverPerYear: a.stats.turnoverPerYear, from: a.stats.from, to: a.stats.to, members: a.stats.members });
  const allowShare = (cond: Condition, w: W, n: N) => {
    let on = 0, tot = 0;
    for (const s of coinsIn(w, cond.tape)) { const t = track(cond.tape, s, w, "oos"); for (let i = t.start; i < t.to - 1; i++) { tot++; if (regimeAllows(btc[cond.tape], n, decisionMs(t, i))) on++; } }
    return tot ? r3(on / tot) : null;
  };
  const perCondition: Record<string, unknown> = {};
  for (const cond of CONDITIONS) {
    const perWindow: Record<string, unknown> = {};
    for (const w of ALL_WINDOWS) {
      const a = arms[cond.id][w];
      if (!a) continue;
      const nl = nulls[cond.id][w]!;
      perWindow[w] = {
        incumbent: row(inc[cond.id][w]!),
        chosenN: chosenN[cond.id][w],
        arm: row(a.chosen),
        fixedN: Object.fromEntries(N_GRID.map((n) => [n, { ...row(a.fixed[n]), allowShareOfDecisionBars: stage === "smoke" ? null : allowShare(cond, w, n) }])),
        null: { ret: nl.kept ? summarize(nl.rets) : null, maxDD: nl.kept ? summarize(nl.dds) : null, pNullAtLeastArm: nl.kept ? r3(atLeast(nl.rets, a.chosen.stats.ret)) : null, pEpisodeRefusal: r4(nl.pEp), kept: nl.kept, attempts: nl.attempts, calibration: nl.calibration, note: nl.note },
      };
    }
    perCondition[cond.id] = perWindow;
  }

  const hashesEnd = await hashSources();
  if (JSON.stringify(hashesStart) !== JSON.stringify(hashesEnd)) throw new Error("a source file changed while the study ran");
  const report = {
    study: "S1 (2026-09-24): §3.9's BTC-regime entry filter on the live row trend-4h-live (Revolut X, BTC/ETH/SOL/AVAX, four $25 slots, seeded parameters), re-tested on non-bear windows — the house's four windows and four evaluations, plus four fresh windows (E–H, BTC and ETH) that no study has scored out of sample",
    stage,
    preRegistration: "docs/agents/reviews/2026-09-24-btc-regime-prereg.md — committed before any arm ran; the definitions below are its definitions",
    definitions: {
      incumbent: { symbols: SYMBOLS, slotUsd: SLOT_USD, params: DEFAULT_TREND, costs: "Revolut X: the touch (half the measured spread) plus 9 bps taker per fill (backtest.ts COSTS.revx)", evaluations: CONDITIONS.map((c) => c.id), primary: PRIMARY.id },
      gate: "an entry the rulebook wants (flat, signal, not cooling down) is refused unless BTC's last CLOSED daily close (day start + 1 day ≤ the 4h bar's close) is strictly above its N-day simple average ending on that day; allowed where no close or no average exists; exits, stops and the cooldown untouched (backtest_ideas.ts regimeFiltered, §3.9). BTC's daily series is the evaluated tape's: the Coinbase-spliced dailies on the coinbase evaluations, Kraken's 4h tape's dailies on the kraken ones",
      primaryArm: `N chosen from {${N_GRID.join(", ")}} per evaluation × window on the window's in-sample span (the timestamps backtest_jev.ts windowsOn cuts for A–D; two years before the window for E–H), run on the evaluated tape with warm-up bars from before the span, by the gated sleeve's return over max(0.05, drawdown); ties to the larger N. The fixed-N arms are reported and never decide`,
      windows: "A–D as backtest_jev.ts loadMeasuredSeries cuts them (four coins); E–H one year apart before D (E = [cb0 − 2y, cb0 − 1y), in-sample the two years before), BTC and ETH only, both tapes",
      bearRule: `a window is BEAR when the equal-weight buy-and-hold of its coins over its out-of-sample span is below ${BEAR_BELOW * 100} %`,
      null: `per evaluation × window: whole breakout episodes refused at random (backtest_jev.ts episodeNullPolicy), the episode probability bisected (${CAL_ITERS} × ${CAL_DRAWS} draws) so the mean entries match the primary arm's, then only draws whose entries over the window's coins EQUAL the arm's are kept, up to ${NULL_DRAWS} (at most ${MAX_ATTEMPTS} attempts)`,
      bar: "C1 in each evaluation the arm's worst-window return (A–D) is strictly above the incumbent's; C2 the null's worst window does as well or better in at most 5 % of draws (ties against the arm); C3 in every other window where the arm is below the incumbent, at least 5 % of null draws are strictly below the arm (ties against the arm; an unbuildable null counts against it). ADOPT = C1, C2, C3 in all four evaluations and no non-bear fresh window costed beyond chance (C3's test); REJECT = C1 or C3 fails in any evaluation; INCONCLUSIVE otherwise",
    },
    inputs: { tapes: dataRows.filter((r) => SYMBOLS.includes((r as { symbol: string }).symbol as typeof SYMBOLS[number])), tapeSha256: tapeHashes, set2Sha256: await sha256(set2Path), suiSha256: await sha256(suiPath) },
    windows: regimes,
    btcAverages: btcDefined,
    fidelity: {
      runGatedVsRun: { cells: runChecks, mismatches: runMismatches, what: "the incumbent through the flat-bar cache against backtest.ts's run: return, drawdown, trades and exposure on every coin × window × evaluation, fresh windows included" },
      incumbentReproduction: { worstAbsDiff: reproWorst, perCondition: reproduction },
    },
    perCondition,
    verdicts: { perCondition: primaryVerdicts, freshNonBearWindows: freshNonBear, freshC3, freshCostsBeyondChance: freshCosts, verdict },
    draws: { nullKept: NULL_DRAWS, calibration: `${CAL_ITERS} × ${CAL_DRAWS}`, maxAttempts: MAX_ATTEMPTS, preregistered: preregisteredDraws },
    seeds: "mulberry32 seeded by seedOf(purpose, evaluation, window, coin, draw) — purposes cal, null",
    sourceIntegrity: { ...hashesStart, note: "SHA-256 at the start of the run; the run throws if any changed before it finished" },
  };
  await Deno.mkdir(outDir, { recursive: true });
  const outFile = stage === "smoke" ? `${outDir}/smoke.json` : `${outDir}/btc_regime.json`;
  await Deno.writeTextFile(outFile, JSON.stringify(report, null, 1) + "\n");
  say(`wrote ${outFile}`);
}

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length)) as Record<string, string>;
  await main(args);
}
