// The MAKER study: every rule this repository runs takes the touch on
// Revolut X (9 bps taker plus half the spread), and the venue's one property
// no other venue here has is a 0 % MAKER fee. This asks whether a rule whose
// entries AND exits are post-only resting limit orders — paying nothing, and
// exposed instead to orders that never fill and to fills that arrive exactly
// when the market moves through them — is viable on the tight majors where
// the taker version of the same kind of rule was rejected (§3.6). A study,
// not a rulebook. Pre-registered before any candidate arm ran (the session
// scratchpad's research_bd/prereg_maker.md, sha256 in the output).
// Run by hand:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_maker.ts \
//     --data   <dir with BTC-USD_1h_3y.json …>        (Coinbase Exchange hourly)
//     --ext    <dir with BTC-USD_1h_kraken.json …>    (Kraken quarterly bundle, hourly)
//     --ktape  <dir with BTC-USD_4h_kraken.json …>    (Kraken's own 4h tape)
//     --revx   <dir with BTC-USD_4h_revx.json …>      (Revolut X's public UK 4h candles; window A only)
//     --pairs  <revx_pairs.json>                      (Revolut X /public/configuration/pairs; the ticks are checked against it)
//     --prereg <prereg_maker.md>                      (hashed into the output)
//     --set2   docs/agents/backtests/set2.json        (the incumbent, for the reproduction)
//     --out    docs/agents/backtests
//     [--stage definitions | smoke | full]           (default full)
//
// Writes `<out>/maker.json` and NOTHING else, at stage `full`. `definitions`
// runs no candidate: it reproduces the incumbent against set2.json, proves
// this file's simulator against `run`, checks the fill rule on hand-built
// bars and prints the coverage — the facts the pre-registration needed.
// `smoke` runs the WHOLE pipeline on a seeded synthetic random walk laid on
// the real timestamps (every code path, no real price) and writes nothing;
// it exists so the candidate code could be debugged before the
// pre-registration was frozen without any candidate being run on real data.
//
// ── the fill model (the pre-registration's definitions) ───────────────
//
// A decision is taken at the close of bar i on data up to bar i. An order it
// places rests during bar i+1 only (its life is one bar); an unfilled order is
// cancelled at that bar's close and the rule decides again. The price is on
// Revolut X's tick grid (`quote_step`): a bid is floored and never above the
// touch bid at placement, open(i+1) × (1 − half-spread); an ask is ceiled and
// never below the touch ask, open(i+1) × (1 + half-spread) — so a post-only
// order is never marketable and is never rejected. A BID AT L FILLS ONLY IF
// THE BAR'S LOW TRADES AT OR BELOW L − ONE TICK (traded through, not merely
// touched); an ask at U only if the high trades at or above U + one tick.
// The fill price is the limit, the fee 0. A take-profit or exit ask is placed
// no earlier than the bar AFTER the fill bar (the order of the high and the
// low inside a bar is unknown). The protective stops are TAKER exits exactly
// as `run` prices them — min(level, open) × (1 − half-spread), 9 bps — and
// are read against the fill bar's own low as well (the fill is taken to come
// first), and against every later bar's low BEFORE any resting ask (when a bar
// could have filled both, the stop is assumed). The high-water mark starts at
// the fill price, takes the fill bar's CLOSE (the only price known to come
// after the fill) and then each later bar's high. After any exit the rule
// waits two of its own bars (`reentryBars`), as the loop does.
//
// Sensitivities, reported and never deciding: two ticks through (S1), and
// 10 bps through (S2: at Revolut X's ticks one tick is 0.001–1 bps, so the
// literal two-tick arm barely moves anything; 10 bps sits in §3.13's
// 10–20 bps break-even band for adverse selection).
//
// Arms on the SAME fills: the maker arm (0 % fee); the TAKER-COST arm — every
// entry and non-stop exit repriced at its reference price ± half the spread
// plus 9 bps, exactly as `run` prices a taker fill against its reference open,
// which isolates what the fee and the spread are worth; and a 10 bps arm
// (Binance's fee both ways, Revolut X's spread on the stops), descriptive.
//
// ── the family (three shapes, each on 1h and 4h bars) ─────────────────
//
//   rsi2  §3.6's RSI(2) pullback, its grid unchanged (36 points): flat, close
//         above SMA(N) and RSI(2) < E → a bid at the touch, re-placed each bar
//         while the signal holds; exit armed by RSI(2) > X, H bars held, or
//         the close under SMA(N) → an ask at the touch, re-placed until filled.
//   band  Bollinger reversion, no trend filter (12 points): flat → a bid at
//         SMA(n) − k·SD(n) every bar; exit ask at SMA(n), re-placed each bar;
//         after H bars the ask goes to the touch.
//   dip   a dip-limit in an uptrend (18 points): flat and close above SMA(N)
//         → a bid at close − a·ATR(14); exit ask at fill + b·ATR(14) (the ATR
//         the order was placed on); after 16 bars the ask goes to the touch.
//
// ── walk-forward, the null, the bar ───────────────────────────────────
//
// Windows A–D, the tapes and the four evaluations are `backtest_jev.ts`'s,
// imported (`loadMeasuredSeries`, `CONDITIONS`), mapped to hourly bars by
// timestamp. Per coin, window and evaluation the grid point with the best
// in-sample ret / max(0.05, maxDD) (`score`) is chosen and scored out of
// sample; the plateau is the share of the grid positive out of sample. The
// NULL keeps the arm's number of entries and its holding times (permuted) and
// throws away its timing: a touch bid at uniformly random decision bars, held
// for a drawn holding time, then an ask at the touch — the same fill model,
// the same stops — 1,000 draws. The bar (a candidate PASSES only if it holds
// on windows A AND B in EVERY evaluation priced there): the three-coin
// sleeve's return > 0, drawdown < 35 %, the null does as well or better in at
// most 5 % of draws, and ≥ 50 % of the grid positive. §4.15's per-coin form is
// reported with the count of two-window passes against the count chance gives
// (§3.12's coins × share(A) × share(B)).
//
// ── what is imported and what is not ──────────────────────────────────
//
// `run`, `COSTS`, `resample`, `spreadOf` from `backtest.ts`; the windows,
// tapes, evaluations, `runGated`, the flat-bar cache, the policies, the seeds
// and the sleeve arithmetic (`combine`, `dailyReturns`, `sleeveStatsOf`) from
// `backtest_jev.ts`; `atrAt`, `sma`, `DEFAULT_TREND` from the rulebook. The
// one new simulator is `simulate`: in `market` mode it is `run` (entries and
// rule exits at the next open, the stops, the cooldown, the marks) and
// `fidelity.simulatorVsRun` proves it field for field on every live coin ×
// window × evaluation; `maker` mode differs only in how an order fills, which
// `fidelity.fillRuleUnitChecks` pins on hand-built bars.
//
// ── determinism ───────────────────────────────────────────────────────
//
// No wall clock is written. Every draw comes from `mulberry32` seeded by
// `seedOf(purpose, candidate, evaluation, window, coin, draw)`; `backtest.ts`,
// the rulebook, `backtest_jev.ts` and this file are hashed at the start and
// the end and a run that straddles an edit throws; every input file is hashed
// into the output.

import { atrAt, DEFAULT_TREND, sma, type Candle, type Position } from "../_shared/agents_strategy.ts";
import { COSTS, resample, run, spreadOf, type StopParams } from "./backtest.ts";
import {
  atLeast, buildTrack, combine, CONDITIONS, dailyReturns, indexAtOrAfter, iso, LIVE_CANDIDATE, loadMeasuredSeries,
  mulberry32, PRIMARY, r3, r4, rulePolicy, runGated, score, seedOf, sleeveStatsOf, SLOT_USD, stopsOf, summarize,
  toCandles, trackDecider, WIN_NAMES,
  type Condition, type GatedResult, type MeasuredSeries, type Sleeve, type SleeveStats, type Tape, type Win, type WinName,
} from "./backtest_jev.ts";

// ───────────────────────────────────────────────────────── the fixed numbers

const DAY_MS = 86400e3;
const HOUR_MS = 3600e3;
/** Revolut X `quote_step`, `GET /1.0/public/configuration/pairs` (keyless; reference §2.1, §4 item 19). Checked against `--pairs`. */
const TICK: Record<string, number> = { "BTC/USD": 0.01, "ETH/USD": 0.01, "SOL/USD": 0.001, "AVAX/USD": 0.001 };
/** The candidate coins: the three majors decide; AVAX is the secondary, reported beside them. */
const COINS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD"] as const;
const DECIDING = ["BTC/USD", "ETH/USD", "SOL/USD"] as const;
/** A candidate slot: the live row's per-order cap. */
const SLOT = 20;
const NULL_DRAWS_DEFAULT = 1000;
const ALPHA = 0.05;
const DD_LIMIT = 0.35;
const PLATEAU_MIN = 0.5;
const BINANCE_BPS = 10;
const DIP_HOLD = 16;
/** Tolerance, in ticks, for comparisons on the tick grid (a price exactly one tick through must count). */
const EPS_T = 1e-9;
/** `backtest_jev.ts`'s widest lookback, used for the same coverage rule on the hourly Kraken tape. */
const MAX_LOOKBACK = 301;

type FillModel = { id: "1tick" | "2ticks" | "10bps"; ticks: number; bps: number };
const FILL_PRIMARY: FillModel = { id: "1tick", ticks: 1, bps: 0 };
const FILL_S1: FillModel = { id: "2ticks", ticks: 2, bps: 0 };
const FILL_S2: FillModel = { id: "10bps", ticks: 0, bps: 10 };

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function sha256(path: string | URL): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─────────────────────────────────────────────────────────────── bars and indicators

type Arr = {
  c: Candle[]; n: number;
  start: Float64Array; open: Float64Array; high: Float64Array; low: Float64Array; close: Float64Array;
  ind: Map<string, Float64Array>;
};
const ARRS = new WeakMap<Candle[], Arr>();
function arrOf(c: Candle[]): Arr {
  let a = ARRS.get(c);
  if (!a) {
    const n = c.length;
    a = {
      c, n, start: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n),
      ind: new Map(),
    };
    for (let i = 0; i < n; i++) { a.start[i] = c[i].start; a.open[i] = c[i].open; a.high[i] = c[i].high; a.low[i] = c[i].low; a.close[i] = c[i].close; }
    ARRS.set(c, a);
  }
  return a;
}
function cached(a: Arr, key: string, f: () => Float64Array): Float64Array {
  let v = a.ind.get(key);
  if (!v) { v = f(); a.ind.set(key, v); }
  return v;
}
/** The rulebook's own SMA, NaN where it is null. */
function smaA(a: Arr, n: number): Float64Array {
  return cached(a, `sma${n}`, () => Float64Array.from(sma(Array.from(a.close), n), (x) => x == null ? NaN : x));
}
/** Population standard deviation of the last n closes, two-pass per bar. */
function sdA(a: Arr, n: number): Float64Array {
  return cached(a, `sd${n}`, () => {
    const out = new Float64Array(a.n).fill(NaN);
    for (let i = n - 1; i < a.n; i++) {
      let s = 0;
      for (let k = i - n + 1; k <= i; k++) s += a.close[k];
      const m = s / n;
      let v = 0;
      for (let k = i - n + 1; k <= i; k++) v += (a.close[k] - m) ** 2;
      out[i] = Math.sqrt(v / n);
    }
    return out;
  });
}
/** §3.6's RSI(2) (`m15/freq_study.py`): sums of the last two up and down moves; no down move reads 100. */
function rsi2A(a: Arr): Float64Array {
  return cached(a, "rsi2", () => {
    const out = new Float64Array(a.n).fill(NaN);
    for (let i = 2; i < a.n; i++) {
      let g = 0, l = 0;
      for (let j = i - 1; j <= i; j++) { const d = a.close[j] - a.close[j - 1]; if (d > 0) g += d; else l -= d; }
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  });
}
/** The rulebook's `atrAt` at every bar, NaN where it is null. */
function atrA(a: Arr, n: number): Float64Array {
  return cached(a, `atr${n}`, () => {
    const out = new Float64Array(a.n);
    for (let i = 0; i < a.n; i++) { const v = atrAt(a.c, i, n); out[i] = v == null ? NaN : v; }
    return out;
  });
}

// ─────────────────────────────────────────────────────────────── the simulator

/** What a rule wants for the next bar: nothing, `run`'s next-open taker fill, a resting order at the touch, or at a level. */
type Intent = null | "market" | "touch" | number;
type Ctx = { fillBar: number; fillPrice: number; pos: Position };
type Spec = { entry: (i: number) => Intent; exit: (i: number, c: Ctx) => Intent; onFill?: (c: Ctx) => void };
type SimOpts = {
  hs: number; tick: number; fill: FillModel; stops: StopParams | null; mode: "maker" | "market";
  ledgers?: boolean; marks?: boolean; detail?: boolean; dayEq?: { base: number; out: Float64Array } | null;
};
type LedgerOut = { ret: number; maxDD: number; marks: [number, number][] | null };
type SimOut = {
  ret: number; maxDD: number; trades: number; entries: number; stopsHit: number; exitsTarget: number; exitsTouch: number;
  exposure: number; days: number; start: number; marks: [number, number][] | null;
  takerCost: LedgerOut | null; binance10: LedgerOut | null;
  entryPlacements: number; entryFills: number; exitPlacements: number; exitFills: number;
  holds: number[]; fillBars: number[]; fillPrices: number[]; orders: Map<number, number> | null;
};

function throughDown(low: number, priceT: number, price: number, tick: number, fm: FillModel): boolean {
  return fm.bps > 0 ? low <= price * (1 - fm.bps / 1e4) : low / tick <= priceT - fm.ticks + EPS_T;
}
function throughUp(high: number, priceT: number, price: number, tick: number, fm: FillModel): boolean {
  return fm.bps > 0 ? high >= price * (1 + fm.bps / 1e4) : high / tick >= priceT + fm.ticks - EPS_T;
}
const isOrder = (x: Intent): x is "touch" | number => x === "touch" || (typeof x === "number" && Number.isFinite(x) && x > 0);

/**
 * One slot, one coin, bars `from`..`to` (exclusive), decisions from max(from, warmup). In `market` mode this is
 * `run` line for line (the fidelity check proves it); in `maker` mode an order rests for the next bar and fills only
 * when traded through (see the header). Cash starts at 1; equity is marked at every bar's close.
 */
function simulate(a: Arr, from: number, to: number, warmup: number, spec: Spec, o: SimOpts): SimOut {
  const hs = o.hs, tick = o.tick, fm = o.fill, st = o.stops;
  const taker = COSTS.revx.takerBps / 1e4, bf = BINANCE_BPS / 1e4;
  const maker = o.mode === "maker";
  const atrS = st && st.atrStop != null ? atrA(a, st.atrN) : null;
  let cash = 1.0, base = 0, avgCost = 0, hw = 0, openedAt = 0;
  let trades = 0, entries = 0, stopsHit = 0, exitsTarget = 0, exitsTouch = 0, barsLong = 0, lastExitBar = -Infinity;
  let peak = 1.0, maxDD = 0, fillBar = -1, fillPrice = 0;
  let entryPlacements = 0, entryFills = 0, exitPlacements = 0, exitFills = 0;
  const L = o.ledgers === true;
  let cT = 1.0, bT = 0, pkT = 1.0, ddT = 0, cB = 1.0, bB = 0, pkB = 1.0, ddB = 0;
  const marks: [number, number][] | null = o.marks ? [] : null;
  const marksT: [number, number][] | null = o.marks && L ? [] : null;
  const marksB: [number, number][] | null = o.marks && L ? [] : null;
  const holds: number[] = [], fillBars: number[] = [], fillPrices: number[] = [];
  const orders = o.detail ? new Map<number, number>() : null;
  const count = (ts: number) => { if (orders) { const d = Math.floor(ts / DAY_MS); orders.set(d, (orders.get(d) ?? 0) + 1); } };
  const posNow = (): Position => ({ base, avgCost, realisedUsd: 0, feesUsd: 0, openedAt: base > 0 ? openedAt : null, highWater: base > 0 ? hw : null });
  /** `run`'s protective level at decision bar i: the floor under cost, and the ATR trail from the high-water where the stop rule has one. */
  const levelAt = (i: number): number => {
    const h = Math.max(hw, avgCost);
    const atr = atrS ? atrS[i] : NaN;
    const floor = avgCost * (1 - st!.maxLossPct);
    const trail = st!.atrStop != null && !Number.isNaN(atr) ? h - st!.atrStop * atr : -Infinity;
    return Math.max(floor, trail);
  };
  const start = Math.max(from, warmup);
  for (let i = start; i < to - 1; i++) {
    const n = i + 1;
    const nOpen = a.open[n], nHigh = a.high[n], nLow = a.low[n], nClose = a.close[n], nStart = a.start[n];
    const coolingDown = st != null && i - lastExitBar < st.reentryBars;
    const stopOut = (level: number) => {
      const price = Math.min(level, nOpen) * (1 - hs);
      const fee = base * price * taker;
      cash = base * price - fee;
      if (L) { cT = bT * price - bT * price * taker; bT = 0; cB = bB * price - bB * price * bf; bB = 0; }
      base = 0; trades++; stopsHit++; lastExitBar = i + 1; count(nStart); holds.push(n - fillBar);
    };
    if (base === 0) {
      if (!coolingDown) {
        const intent = spec.entry(i);
        if (intent === "market") {
          // `run`'s entry: the touch at the next open, the taker fee out of the same cash.
          const price = nOpen * (1 + hs);
          base = cash / (price * (1 + taker));
          cash = 0; avgCost = (0 * 0 + base * price) / base; hw = price; openedAt = nStart;   // applyFill's average, to the bit
          trades++; entries++; fillBar = n; fillPrice = price; count(nStart);
          spec.onFill?.({ fillBar, fillPrice, pos: posNow() });
        } else if (isOrder(intent)) {
          entryPlacements++; count(nStart);
          const touchT = Math.floor((nOpen * (1 - hs)) / tick + EPS_T);
          const wantT = intent === "touch" ? touchT : Math.min(Math.floor(intent / tick + EPS_T), touchT);
          const price = wantT * tick;
          if (wantT > 0 && throughDown(nLow, wantT, price, tick, fm)) {
            entryFills++;
            base = cash / price; cash = 0; avgCost = (0 * 0 + base * price) / base; hw = price; openedAt = nStart;
            trades++; entries++; fillBar = n; fillPrice = price; fillBars.push(n); fillPrices.push(price);
            if (L) { bT = cT / (price * (1 + hs) * (1 + taker)); cT = 0; bB = cB / (price * (1 + bf)); cB = 0; }
            spec.onFill?.({ fillBar, fillPrice, pos: posNow() });
            if (st) { const level = levelAt(i); if (nLow <= level) stopOut(level); }
          }
        }
      }
    } else {
      const intent = spec.exit(i, { fillBar, fillPrice, pos: posNow() });
      if (intent === "market") {
        // `run`'s rule exit at the next open.
        const price = nOpen * (1 - hs);
        const fee = base * price * taker;
        cash = base * price - fee;
        base = 0; trades++; lastExitBar = i + 1; count(nStart); holds.push(n - fillBar);
      } else {
        let stopped = false;
        if (st) { const level = levelAt(i); if (nLow <= level) { stopOut(level); stopped = true; } }
        if (!stopped && isOrder(intent)) {
          exitPlacements++; count(nStart);
          const touchT = Math.ceil((nOpen * (1 + hs)) / tick - EPS_T);
          const wantT = intent === "touch" ? touchT : Math.max(Math.ceil(intent / tick - EPS_T), touchT);
          const price = wantT * tick;
          if (throughUp(nHigh, wantT, price, tick, fm)) {
            exitFills++;
            if (intent === "touch") exitsTouch++; else exitsTarget++;
            cash = base * price;
            if (L) { const pT = price * (1 - hs); cT = bT * pT - bT * pT * taker; bT = 0; cB = bB * price - bB * price * bf; bB = 0; }
            base = 0; trades++; lastExitBar = i + 1; holds.push(n - fillBar);
          }
        }
      }
    }
    if (base > 0) {
      barsLong++;
      hw = maker && n === fillBar ? Math.max(hw, nClose) : Math.max(hw, nHigh);
    }
    const eq = cash + base * nClose;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    if (marks) marks.push([nStart, eq]);
    if (o.dayEq) o.dayEq.out[Math.floor(nStart / DAY_MS) - o.dayEq.base] = eq;
    if (L) {
      const eT = cT + bT * nClose, eB = cB + bB * nClose;
      pkT = Math.max(pkT, eT); ddT = Math.max(ddT, 1 - eT / pkT);
      pkB = Math.max(pkB, eB); ddB = Math.max(ddB, 1 - eB / pkB);
      if (marksT) marksT.push([nStart, eT]);
      if (marksB) marksB.push([nStart, eB]);
    }
  }
  if (base > 0) holds.push((to - 1) - fillBar);
  const last = a.close[to - 1];
  const eqEnd = cash + base * last;
  return {
    ret: eqEnd - 1, maxDD, trades, entries, stopsHit, exitsTarget, exitsTouch,
    exposure: barsLong / Math.max(1, to - from), days: (a.start[to - 1] - a.start[start]) / DAY_MS, start, marks,
    takerCost: L ? { ret: cT + bT * last - 1, maxDD: ddT, marks: marksT } : null,
    binance10: L ? { ret: cB + bB * last - 1, maxDD: ddB, marks: marksB } : null,
    entryPlacements, entryFills, exitPlacements, exitFills, holds, fillBars, fillPrices, orders,
  };
}

// ─────────────────────────────────────────────────────────────── the family

type ShapeId = "rsi2" | "band" | "dip";
type P = Record<string, number>;
type Shape = { id: ShapeId; what: string; grid: P[]; lookback: (p: P) => number; spec: (a: Arr, p: P) => Spec };

function gridOf(axes: Record<string, number[]>): P[] {
  let out: P[] = [{}];
  for (const [k, vs] of Object.entries(axes)) out = out.flatMap((p) => vs.map((v) => ({ ...p, [k]: v })));
  return out;
}

const SHAPES: Shape[] = [
  {
    id: "rsi2",
    what: "§3.6's RSI(2) pullback and its grid: flat, close > SMA(N) and RSI(2) < E → a bid at the touch, re-placed each bar while the signal holds; exit armed by RSI(2) > X, H bars held or close < SMA(N) → an ask at the touch, re-placed until filled",
    grid: gridOf({ N: [100, 200], E: [5, 10, 20], X: [60, 70, 80], H: [8, 16] }),
    lookback: (p) => p.N + 1,
    spec: (a, p) => {
      const m = smaA(a, p.N), r = rsi2A(a), c = a.close;
      let armed = false;
      return {
        entry: (i) => c[i] > m[i] && r[i] < p.E ? "touch" : null,
        exit: (i, x) => {
          if (!armed && (r[i] > p.X || i - x.fillBar + 1 >= p.H || c[i] < m[i])) armed = true;
          return armed ? "touch" : null;
        },
        onFill: () => { armed = false; },
      };
    },
  },
  {
    id: "band",
    what: "Bollinger reversion, no trend filter: flat → a bid at SMA(n) − k·SD(n), re-placed every bar; exit ask at SMA(n), re-placed every bar; after H bars held the ask goes to the touch",
    grid: gridOf({ n: [20, 50], k: [1.5, 2.0, 2.5], H: [12, 24] }),
    lookback: (p) => p.n + 1,
    spec: (a, p) => {
      const m = smaA(a, p.n), s = sdA(a, p.n);
      let armed = false;
      return {
        entry: (i) => Number.isFinite(m[i]) && Number.isFinite(s[i]) ? m[i] - p.k * s[i] : null,
        exit: (i, x) => {
          if (!armed && i - x.fillBar + 1 >= p.H) armed = true;
          return armed || !Number.isFinite(m[i]) ? "touch" : m[i];
        },
        onFill: () => { armed = false; },
      };
    },
  },
  {
    id: "dip",
    what: `a dip-limit in an uptrend: flat and close > SMA(N) → a bid at close − a·ATR(14), re-placed every bar; exit ask at the fill + b·ATR(14) of the bar the order was placed on; after ${DIP_HOLD} bars held the ask goes to the touch`,
    grid: gridOf({ N: [50, 200], a: [0.5, 1.0, 1.5], b: [0.5, 1.0, 2.0] }),
    lookback: (p) => Math.max(p.N, 15) + 1,
    spec: (a, p) => {
      const m = smaA(a, p.N), atr = atrA(a, 14), c = a.close;
      let armed = false, target = 0;
      return {
        entry: (i) => c[i] > m[i] && Number.isFinite(atr[i]) ? c[i] - p.a * atr[i] : null,
        exit: (i, x) => {
          if (!armed && i - x.fillBar + 1 >= DIP_HOLD) armed = true;
          return armed ? "touch" : target;
        },
        onFill: (x) => { armed = false; target = x.fillPrice + p.b * atr[x.fillBar - 1]; },
      };
    },
  },
];
type Candidate = { id: string; shape: Shape; barH: 1 | 4 };
const CANDIDATES: Candidate[] = SHAPES.flatMap((shape) => ([1, 4] as const).map((barH) => ({ id: `${shape.id}-${barH}h`, shape, barH })));
const pStr = (p: P) => Object.entries(p).map(([k, v]) => `${k}${v}`).join(" ");

/** THE NULL: the arm's entry count and holding times, at random decision bars; a touch bid, held, then an ask at the touch. */
function nullSpec(attempts: Int32Array, holdsPerm: Int32Array): Spec {
  let j = 0, target = 0;
  return {
    entry: (i) => j < attempts.length && i >= attempts[j] ? "touch" : null,
    exit: (i, x) => i >= x.fillBar + target - 1 ? "touch" : null,
    onFill: () => { target = holdsPerm[j]; j++; },
  };
}
function drawSchedule(rng: () => number, lo: number, hi: number, nEntries: number, holds: number[]): { attempts: Int32Array; holdsPerm: Int32Array } {
  // nEntries distinct decision bars, uniform on [lo, hi], sorted (Floyd's algorithm); the holds in a random order.
  const range = hi - lo + 1, k = Math.min(nEntries, Math.max(0, range));
  const chosen = new Set<number>();
  for (let j = range - k; j < range; j++) {
    const t = Math.floor(rng() * (j + 1));
    chosen.add(chosen.has(t) ? j : t);
  }
  const attempts = Int32Array.from([...chosen].map((x) => x + lo)).sort();
  const holdsPerm = Int32Array.from(holds);
  for (let j = holdsPerm.length - 1; j > 0; j--) { const t = Math.floor(rng() * (j + 1)); const x = holdsPerm[j]; holdsPerm[j] = holdsPerm[t]; holdsPerm[t] = x; }
  return { attempts, holdsPerm };
}

// ─────────────────────────────────────────────────────────────── sleeves

function sleeveOf(symbol: string, marks: [number, number][], slot: number, trades: number, exposure: number): Sleeve {
  return { id: `maker·${symbol}`, symbol, slotUsd: slot, rets: dailyReturns(marks), ret: 0, maxDD: 0, trades, exposure, tradedUsd: trades * slot };
}
/** Daily returns from a day-indexed equity array, as `dailyReturns` computes them from marks (NaN = no bar that day). */
function returnsOfDayEq(dayEq: Float64Array): Float64Array {
  const out = new Float64Array(dayEq.length).fill(NaN);
  let prev = 1;
  for (let d = 0; d < dayEq.length; d++) {
    const eq = dayEq[d];
    if (Number.isNaN(eq)) continue;
    out[d] = prev > 0 ? eq / prev - 1 : 0;
    prev = eq;
  }
  return out;
}
/** `combine`'s return and drawdown, on day-indexed arrays (a missing day adds 0, as `?? 0` does). Proven against `combine`. */
function combineArrays(rets: Float64Array[], slot: number): { ret: number; maxDD: number } {
  const capital = slot * rets.length;
  const nd = rets.length ? rets[0].length : 0;
  let eq = capital, peak = capital, maxDD = 0;
  for (let d = 0; d < nd; d++) {
    let pnl = 0, any = false;
    for (const r of rets) { const x = r[d]; if (!Number.isNaN(x)) { any = true; pnl += slot * x; } }
    if (!any) continue;
    eq += pnl;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
  }
  return { ret: Number(((eq - capital) / Math.max(1e-9, capital)).toFixed(4)), maxDD: Number(maxDD.toFixed(4)) };
}
function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
/** A sleeve's daily return series (P&L over capital), by `combine`'s arithmetic. */
function sleeveDaily(sleeves: Sleeve[]): Map<number, number> {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  const out = new Map<number, number>();
  for (const d of days) { let pnl = 0; for (const s of sleeves) pnl += s.slotUsd * (s.rets.get(d) ?? 0); out.set(d, pnl / capital); }
  return out;
}
const lite = (s: SleeveStats) => ({ ret: s.ret, maxDD: s.maxDD, retOverDD: s.retOverDD, members: s.members, capitalUsd: s.capitalUsd, deployment: s.deployment, turnoverPerYear: s.turnoverPerYear, from: s.from, to: s.to });

// ─────────────────────────────────────────────────────────────── the data

type CoinData = { symbol: string; ms: MeasuredSeries; cbH: Candle[]; kH: Candle[]; comb1h: Candle[]; kHCold: Candle[]; kTapeCold: Candle[]; revx: Candle[] | null; spliceAt: number };
type Span = { isFromTs: number; isToTs: number; oosFromTs: number; oosToTs: number };
type Leg = { a: Arr; from: number; to: number };
type Cell = { priced: true; is: Leg; oos: Leg } | { priced: false; why: string };

function spanOf(d: CoinData, w: Win): Span {
  const comb = d.ms.comb4h, cb = d.ms.cb4h;
  const isArr = w.isSeries === "coinbase" ? cb : comb;
  const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * HOUR_MS;
  return { isFromTs: isArr[w.isFrom].start, isToTs: endTs(isArr, w.isTo), oosFromTs: comb[w.oosFrom].start, oosToTs: endTs(comb, w.oosTo) };
}
/** The in-sample array starts cold (at the Coinbase series' first bar) for A and B, as every published table does; C and D use the whole tape. */
function cellOf(d: CoinData, tape: Tape, barH: 1 | 4, wn: WinName): Cell {
  const w = d.ms.wins.find((x) => x.name === wn);
  if (!w || !w.scored) return { priced: false, why: w ? w.why : "no such window" };
  const sp = spanOf(d, w);
  const cold = w.isSeries === "coinbase";
  let oosC: Candle[], isC: Candle[];
  if (barH === 4) {
    if (tape === "coinbase") { oosC = d.ms.comb4h; isC = cold ? d.ms.cb4h : d.ms.comb4h; }
    else {
      if (!d.ms.oos.kraken[wn]) return { priced: false, why: d.ms.krakenDropped[wn] ?? "not priced on Kraken's tape" };
      oosC = d.ms.kTape; isC = cold ? d.kTapeCold : d.ms.kTape;
    }
  } else {
    if (tape === "coinbase") { oosC = d.comb1h; isC = cold ? d.cbH : d.comb1h; }
    else {
      // backtest_jev.ts's rule for the second tape, on Kraken's hourly bundle.
      const k = d.kH, kIs = cold ? d.kHCold : d.kH;
      const isBars = indexAtOrAfter(kIs, sp.isToTs) - indexAtOrAfter(kIs, sp.isFromTs);
      const oosBars = indexAtOrAfter(k, sp.oosToTs) - indexAtOrAfter(k, sp.oosFromTs);
      let why = "";
      if (k[0].start > sp.isFromTs) why = `Kraken's hourly tape starts ${iso(k[0].start)}, after this window's in-sample begins`;
      else if (k[k.length - 1].start + HOUR_MS < sp.oosToTs) why = `Kraken's hourly tape ends ${iso(k[k.length - 1].start)}, before this window's out-of-sample ends (${iso(sp.oosToTs)})`;
      else if (isBars <= MAX_LOOKBACK + 2) why = `Kraken hourly in-sample is ${isBars} bars`;
      else if (oosBars <= MAX_LOOKBACK + 2) why = `Kraken hourly out-of-sample is ${oosBars} bars`;
      if (why) return { priced: false, why };
      oosC = k; isC = kIs;
    }
  }
  const oa = arrOf(oosC), ia = arrOf(isC);
  const oos = { a: oa, from: indexAtOrAfter(oosC, sp.oosFromTs), to: indexAtOrAfter(oosC, sp.oosToTs) };
  const is = { a: ia, from: indexAtOrAfter(isC, sp.isFromTs), to: indexAtOrAfter(isC, sp.isToTs) };
  if (barH === 4) {
    const ref = d.ms.oos[tape][wn];
    if (!ref || ref.from !== oos.from || ref.to !== oos.to) throw new Error(`${d.symbol} ${tape} ${wn}: the 4h span does not map onto backtest_jev.ts's (${ref?.from}..${ref?.to} vs ${oos.from}..${oos.to})`);
  }
  return { priced: true, is, oos };
}

/** SMOKE ONLY: generic price levels, so the synthetic walk sits on a realistic scale for each coin's tick. */
const SMOKE_LEVEL: Record<string, number> = { "BTC/USD": 30000, "ETH/USD": 2000, "SOL/USD": 50, "AVAX/USD": 25, "SUI/USD": 2 };
/** SMOKE ONLY: every price replaced by a seeded random walk on the same timestamps; the windows, which read timestamps alone, are unchanged. */
function synthesize(d: CoinData): void {
  const all = [d.cbH, d.kH, d.ms.kTape, ...(d.revx ? [d.revx] : [])];
  const t0 = Math.min(...all.map((x) => x[0].start)), t1 = Math.max(...all.map((x) => x[x.length - 1].start)) + 8 * HOUR_MS;
  const H = Math.round((t1 - t0) / HOUR_MS) + 1;
  const rng = mulberry32(seedOf("smoke", d.symbol));
  const P = new Float64Array(H + 1), up = new Float64Array(H), dn = new Float64Array(H);
  // A log random walk pulled back to a generic level (half-life 90 days) so a coin's tick stays a realistic share of its price.
  const level = Math.log(SMOKE_LEVEL[d.symbol] ?? 100), theta = Math.LN2 / (90 * 24);
  let x = level;
  P[0] = Math.exp(x);
  for (let k = 0; k < H; k++) {
    const z = (rng() + rng() + rng() + rng() - 2) * 1.73;   // ≈ N(0, 1)
    const jump = rng() < 0.0008 ? -0.09 : 0;
    x += 0.009 * z + jump - theta * (x - level);
    P[k + 1] = Math.exp(x);
    up[k] = rng() * 0.004; dn[k] = rng() * 0.004;
  }
  const hourAt = (t: number): Candle => {
    const k = Math.round((t - t0) / HOUR_MS);
    const o = P[k], c = P[k + 1];
    return { start: t, open: o, high: Math.max(o, c) * (1 + up[k]), low: Math.min(o, c) * (1 - dn[k]), close: c, volume: 1 };
  };
  const fourAt = (t: number): Candle => {
    const hs = [0, 1, 2, 3].map((j) => hourAt(t + j * HOUR_MS));
    return { start: t, open: hs[0].open, high: Math.max(...hs.map((h) => h.high)), low: Math.min(...hs.map((h) => h.low)), close: hs[3].close, volume: 4 };
  };
  const same = (x: Candle[], y: Candle[]) => x.length === y.length && x.every((c, i) => c.start === y[i].start);
  const cbH = d.cbH.map((c) => hourAt(c.start)), kH = d.kH.map((c) => hourAt(c.start));
  const comb1h = [...kH.filter((c) => c.start < d.spliceAt), ...cbH];
  const comb4h = resample(comb1h, 4), cb4h = resample(cbH, 4), kTape = d.ms.kTape.map((c) => fourAt(c.start));
  if (!same(comb4h, d.ms.comb4h) || !same(cb4h, d.ms.cb4h)) throw new Error(`smoke: ${d.symbol}'s synthetic 4h bars do not sit on the real timestamps`);
  d.cbH = cbH; d.kH = kH; d.comb1h = comb1h;
  d.ms.comb4h = comb4h; d.ms.cb4h = cb4h; d.ms.kTape = kTape;
  d.ms.combDaily = resample(comb1h, 24); d.ms.kDaily = resample(kTape, 24);
  d.kHCold = kH.slice(indexAtOrAfter(kH, d.spliceAt)); d.kTapeCold = kTape.slice(indexAtOrAfter(kTape, d.spliceAt));
  if (d.revx) d.revx = d.revx.map((c) => fourAt(c.start));
}

// ─────────────────────────────────────────────────────────────── the fill rule, on hand-built bars

function unitChecks(): { name: string; pass: boolean; got: string }[] {
  const out: { name: string; pass: boolean; got: string }[] = [];
  const bars = (rows: [number, number, number, number][]): Arr => arrOf(rows.map(([o, h, l, c], k) => ({ start: 1_700_000_000_000 + k * HOUR_MS, open: o, high: h, low: l, close: c, volume: 1 })));
  const floorOnly: StopParams = { maxLossPct: 0.08, atrStop: null, atrN: 14, reentryBars: 2 };
  const opts = (fill: FillModel, hs = 0): SimOpts => ({ hs, tick: 0.01, fill, stops: floorOnly, mode: "maker", ledgers: true });
  const once = (x: Intent): Spec => { let done = false; return { entry: () => { if (done) return null; done = true; return x; }, exit: () => null }; };
  const check = (name: string, pass: boolean, got: string) => out.push({ name, pass, got });
  const flat: [number, number, number, number] = [100, 100, 100, 100];

  let r = simulate(bars([flat, [100, 100.5, 100.0, 100.2], flat]), 0, 3, 0, once("touch"), opts(FILL_PRIMARY));
  check("a bid touched but not traded through does not fill", r.entryPlacements === 1 && r.entryFills === 0, `${r.entryPlacements} placed, ${r.entryFills} filled`);
  const near = (x: number | undefined, y: number) => x != null && Math.abs(x - y) < 1e-9;
  r = simulate(bars([flat, [100, 100.5, 99.99, 100.2], flat]), 0, 3, 0, once("touch"), opts(FILL_PRIMARY));
  check("a bid traded through by one tick fills at the bid", r.entryFills === 1 && near(r.fillPrices[0], 100), `${r.entryFills} filled at ${r.fillPrices[0]}`);
  r = simulate(bars([flat, [100, 100.5, 99.99, 100.2], flat]), 0, 3, 0, once("touch"), opts(FILL_S1));
  const r2 = simulate(bars([flat, [100, 100.5, 99.98, 100.2], flat]), 0, 3, 0, once("touch"), opts(FILL_S1));
  check("S1 needs two ticks through", r.entryFills === 0 && r2.entryFills === 1, `one tick: ${r.entryFills}, two ticks: ${r2.entryFills}`);
  r = simulate(bars([flat, [100, 100.5, 99.91, 100.2], flat]), 0, 3, 0, once("touch"), opts(FILL_S2));
  const r3b = simulate(bars([flat, [100, 100.5, 99.90, 100.2], flat]), 0, 3, 0, once("touch"), opts(FILL_S2));
  check("S2 needs 10 bps through", r.entryFills === 0 && r3b.entryFills === 1, `9 bps: ${r.entryFills}, 10 bps: ${r3b.entryFills}`);
  r = simulate(bars([flat, [100, 100.5, 99.99, 100.2], flat]), 0, 3, 0, once(150), opts(FILL_PRIMARY));
  check("a bid above the touch is placed AT the touch (post-only is never marketable)", r.entryFills === 1 && near(r.fillPrices[0], 100), `filled at ${r.fillPrices[0]}`);
  r = simulate(bars([flat, [100, 100.5, 99.99, 100.2], flat]), 0, 3, 0, once("touch"), opts(FILL_PRIMARY, 1e-4));
  const rHs = simulate(bars([flat, [100, 100.5, 99.98, 100.2], flat]), 0, 3, 0, once("touch"), opts(FILL_PRIMARY, 1e-4));
  check("the touch bid is open × (1 − half-spread), floored to the tick, and needs its own tick through", r.entryFills === 0 && rHs.entryFills === 1 && near(rHs.fillPrices[0], 99.99), `low 99.99: ${r.entryFills}; low 99.98: filled at ${rHs.fillPrices[0]}`);
  // A take-profit at 101 after a fill at 100: not in the fill bar (high 102 there), not at a touch of 101.00, filled at 101.01.
  const tp = (): Spec => { let done = false; return { entry: () => { if (done) return null; done = true; return "touch"; }, exit: () => 101 }; };
  r = simulate(bars([flat, [100, 102, 99.99, 100], [100, 101.0, 99.5, 100.5], [100.5, 101.01, 100.4, 101], [101, 101, 101, 101]]), 0, 5, 0, tp(), opts(FILL_PRIMARY));
  const takerRet = (() => { const bT = 1 / (100 * (1 + 9e-4)); const cT = bT * 101 - bT * 101 * 9e-4; return cT - 1; })();
  check("the take-profit never fills in the fill bar, needs a trade through, fills at the limit, fee 0",
    r.exitFills === 1 && r.holds[0] === 2 && Math.abs(r.ret - 0.01) < 1e-12 && r.takerCost !== null && Math.abs(r.takerCost.ret - takerRet) < 1e-12,
    `exit fills ${r.exitFills}, held ${r.holds[0]} bars, maker ${r.ret}, taker-cost ${r.takerCost?.ret} (expected ${takerRet})`);
  r = simulate(bars([flat, [100, 100.2, 91.9, 92.5], flat, flat]), 0, 4, 0, once("touch"), opts(FILL_PRIMARY));
  const floorRet = 92 * (1 - 9e-4) / 100 - 1;
  check("the fill bar's own low is read against the 8 % floor, a taker exit", r.stopsHit === 1 && Math.abs(r.ret - floorRet) < 1e-12, `stops ${r.stopsHit}, ret ${r.ret} (expected ${floorRet})`);
  r = simulate(bars([flat, [100, 100.5, 99.99, 100], [100, 101.5, 91.0, 95], flat]), 0, 4, 0, tp(), opts(FILL_PRIMARY));
  check("a bar that could fill the take-profit and the stop is the stop", r.stopsHit === 1 && r.exitFills === 0 && Math.abs(r.ret - floorRet) < 1e-12, `stops ${r.stopsHit}, exit fills ${r.exitFills}, ret ${r.ret}`);
  // The cooldown: after an exit filled in bar e, the next bid rests no earlier than bar e + 3.
  const always: Spec = { entry: () => "touch", exit: () => "touch" };
  const dip: [number, number, number, number] = [100, 100.5, 99.9, 100];
  r = simulate(bars([flat, dip, dip, dip, dip, dip, dip, dip]), 0, 8, 0, always, opts(FILL_PRIMARY));
  const gaps = r.fillBars.slice(1).map((b, k) => b - r.fillBars[k]);
  check("after an exit the next entry waits two bars (reentryBars)", r.fillBars[0] === 1 && gaps.every((g) => g >= 4), `fill bars ${r.fillBars.join(",")}`);
  return out;
}

// ─────────────────────────────────────────────────────────────── the run

async function main(args: Record<string, string>): Promise<void> {
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? ""), revxDir = String(args.revx ?? "");
  const pairsPath = String(args.pairs ?? ""), preregPath = String(args.prereg ?? "");
  const set2Path = String(args.set2 ?? "docs/agents/backtests/set2.json");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const stage = String(args.stage ?? "full");
  const NULL_DRAWS = Number(args["null-draws"] ?? NULL_DRAWS_DEFAULT);
  if (!["full", "definitions", "smoke"].includes(stage)) throw new Error(`--stage ${stage}: expected full, definitions or smoke`);
  if (!dataDir || !extDir || !kDir || !revxDir || !pairsPath) throw new Error("needs --data, --ext, --ktape, --revx and --pairs (see the header)");
  if (stage === "full" && !preregPath) throw new Error("--prereg is required at stage full: the output records which pre-registration it ran under");
  if (!(NULL_DRAWS >= 10)) throw new Error("--null-draws must be at least 10");
  const smoke = stage === "smoke";

  const srcUrls = {
    backtestTs: new URL("./backtest.ts", import.meta.url), agentsStrategyTs: new URL("../_shared/agents_strategy.ts", import.meta.url),
    backtestJevTs: new URL("./backtest_jev.ts", import.meta.url), backtestMakerTs: new URL(import.meta.url),
  };
  const hashSources = async () => Object.fromEntries(await Promise.all(Object.entries(srcUrls).map(async ([k, u]) => [k, await sha256(u)] as const)));
  const hashesStart = await hashSources();
  const t0 = Date.now();
  const say = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${m}`);

  // ── the ticks, against the venue's own pair list ──────────────────────
  const pairs = JSON.parse(await Deno.readTextFile(pairsPath)) as Record<string, { quote_step: string; status: string }>;
  for (const s of COINS) {
    const q = pairs[s];
    if (!q || Number(q.quote_step) !== TICK[s] || q.status !== "active") throw new Error(`${s}: quote_step ${q?.quote_step} / ${q?.status} does not match ${TICK[s]}`);
  }

  // ── data: the measured study's tapes and windows, by import, plus the hourly series they are built from ──
  const { series, dataRows, symbols } = await loadMeasuredSeries(dataDir, extDir, kDir);
  const inputFiles: Record<string, string> = {};
  const data: Record<string, CoinData> = {};
  for (const symbol of LIVE_CANDIDATE.symbols) {
    const b = symbol.replace("/", "-");
    const files = { cb: `${dataDir}/${b}_1h_3y.json`, ext: `${extDir}/${b}_1h_kraken.json`, ktape: `${kDir}/${b}_4h_kraken.json`, revx: `${revxDir}/${b}_4h_revx.json` };
    for (const [k, f] of Object.entries(files)) inputFiles[`${b}:${k}`] = await sha256(f);
    const cbH = toCandles(JSON.parse(await Deno.readTextFile(files.cb)));
    const kH = toCandles(JSON.parse(await Deno.readTextFile(files.ext)));
    const spliceAt = cbH[0].start;
    const comb1h = [...kH.filter((c) => c.start < spliceAt), ...cbH];
    const ms = series[symbol];
    if (resample(comb1h, 4).length !== ms.comb4h.length) throw new Error(`${symbol}: the hourly splice is not the one backtest_jev.ts resampled`);
    const revx = toCandles(JSON.parse(await Deno.readTextFile(files.revx)));
    data[symbol] = {
      symbol, ms, cbH, kH, comb1h, spliceAt, revx,
      kHCold: kH.slice(indexAtOrAfter(kH, spliceAt)), kTapeCold: ms.kTape.slice(indexAtOrAfter(ms.kTape, spliceAt)),
    };
    if (smoke) synthesize(data[symbol]);
  }
  inputFiles.set2Json = await sha256(set2Path);
  inputFiles.revxPairsJson = await sha256(pairsPath);
  say(`data${smoke ? " (SMOKE: synthetic prices on the real timestamps)" : ""}: ${symbols.join(" ")}`);

  // ── the incumbent, and the reproduction ───────────────────────────────
  type IncCell = { per: Record<string, GatedResult>; stats: SleeveStats; stats4: SleeveStats };
  const inc: Record<string, Partial<Record<WinName, IncCell>>> = {};
  let runChecks = 0, runMismatches = 0;
  for (const cond of CONDITIONS) {
    inc[cond.id] = {};
    for (const w of WIN_NAMES) {
      const per: Record<string, GatedResult> = {};
      for (const s of symbols) {
        const ms = data[s].ms, span = ms.oos[cond.tape][w];
        if (!span) continue;
        const bars = cond.tape === "coinbase" ? ms.comb4h : ms.kTape, daily = cond.tape === "coinbase" ? ms.combDaily : ms.kDaily;
        const t = buildTrack(s, bars, daily, DEFAULT_TREND, span.from, span.to);
        const st = stopsOf(cond.stopRule, DEFAULT_TREND);
        const g = runGated(s, bars, span.from, span.to, t.warmup, trackDecider(t, rulePolicy), COSTS.revx, st);
        const rr = run("trend-4h", s, bars, daily, span.from, span.to, DEFAULT_TREND, COSTS.revx, 4, st);
        runChecks++;
        if (rr.ret !== g.ret || rr.maxDD !== g.maxDD || rr.trades !== g.trades || rr.exposure !== g.exposure) runMismatches++;
        per[s] = g;
      }
      if (!Object.keys(per).length) continue;
      const four = Object.fromEntries(Object.entries(per).filter(([s]) => s !== "SUI/USD"));
      inc[cond.id][w] = { per, stats: sleeveStatsOf(per), stats4: sleeveStatsOf(four) };
    }
  }
  if (runMismatches) throw new Error(`runGated is not run on ${runMismatches} of ${runChecks} cells`);
  type Set2Rows = Record<string, { perWindow: Record<string, { ret: number; maxDD: number; members: number }> }>;
  const s2 = JSON.parse(await Deno.readTextFile(set2Path)) as { a2_theWeights: { rows: { arm: string; perCondition: Set2Rows }[] } };
  const set2Equal = s2.a2_theWeights.rows.find((r) => r.arm === "equal")?.perCondition;
  if (!set2Equal) throw new Error("set2.json has no `equal` row");
  let reproWorst = 0;
  const reproduction: Record<string, unknown> = {};
  for (const cond of CONDITIONS) {
    const perW: Record<string, unknown> = {};
    for (const w of WIN_NAMES) {
      const c = inc[cond.id][w], ref = set2Equal[cond.id]?.perWindow?.[w];
      if (!c || !ref) { if (c || ref) throw new Error(`${cond.id} ${w}: priced on one side only`); continue; }
      reproWorst = Math.max(reproWorst, Math.abs(c.stats.ret - ref.ret), Math.abs(c.stats.maxDD - ref.maxDD), c.stats.members !== ref.members ? 1 : 0);
      perW[w] = { here: { ret: c.stats.ret, maxDD: c.stats.maxDD, members: c.stats.members }, set2: { ret: ref.ret, maxDD: ref.maxDD, members: ref.members } };
    }
    reproduction[cond.id] = perW;
  }
  say(`incumbent: runGated ≡ run on ${runChecks} cells | against set2.json's equal row, all four evaluations: worst |Δ| ${reproWorst}`);
  for (const cond of CONDITIONS) say(`  ${cond.id}: ${WIN_NAMES.filter((w) => inc[cond.id][w]).map((w) => `${w} ${(inc[cond.id][w]!.stats.ret * 100).toFixed(2)}% (DD ${(inc[cond.id][w]!.stats.maxDD * 100).toFixed(2)}%)`).join(" | ")}`);
  if (!smoke && reproWorst !== 0) throw new Error(`the incumbent does not reproduce set2.json: worst |Δ| ${reproWorst}`);

  // ── this file's simulator, in market mode, against `run` ────────────────
  let simChecks = 0, simMismatches = 0, dayEqChecks = 0, dayEqMismatches = 0;
  for (const cond of CONDITIONS) for (const w of WIN_NAMES) for (const s of symbols) {
    const ms = data[s].ms, span = ms.oos[cond.tape][w];
    if (!span) continue;
    const bars = cond.tape === "coinbase" ? ms.comb4h : ms.kTape, daily = cond.tape === "coinbase" ? ms.combDaily : ms.kDaily;
    const st = stopsOf(cond.stopRule, DEFAULT_TREND);
    const t = buildTrack(s, bars, daily, DEFAULT_TREND, span.from, span.to);
    const decide = trackDecider(t, rulePolicy);
    const spec: Spec = {
      entry: (i) => decide(i, { base: 0, avgCost: 0, realisedUsd: 0, feesUsd: 0, openedAt: null, highWater: null }, false) === "enter" ? "market" : null,
      exit: (i, x) => decide(i, x.pos, false) === "exit" ? "market" : null,
    };
    const a = arrOf(bars);
    const nd = Math.floor(a.start[span.to - 1] / DAY_MS) - Math.floor(a.start[span.from] / DAY_MS) + 2;
    const dayEq = { base: Math.floor(a.start[span.from] / DAY_MS), out: new Float64Array(nd).fill(NaN) };
    const m = simulate(a, span.from, span.to, t.warmup, spec, { hs: spreadOf(COSTS.revx, s), tick: 0.01, fill: FILL_PRIMARY, stops: st, mode: "market", marks: true, dayEq });
    const rr = run("trend-4h", s, bars, daily, span.from, span.to, DEFAULT_TREND, COSTS.revx, 4, st);
    simChecks++;
    if (m.ret !== rr.ret || m.maxDD !== rr.maxDD || m.trades !== rr.trades || m.exposure !== rr.exposure || m.days !== rr.days || (m.stopsHit ?? 0) !== (rr.stopsHit ?? 0)) {
      simMismatches++;
      console.log(`  MISMATCH ${cond.id} ${w} ${s}: sim ${m.ret} ${m.maxDD} ${m.trades} ${m.exposure} | run ${rr.ret} ${rr.maxDD} ${rr.trades} ${rr.exposure}`);
    }
    // The day-indexed path the null uses, against `dailyReturns` on the marks.
    const viaMarks = dailyReturns(m.marks!), viaDays = returnsOfDayEq(dayEq.out);
    dayEqChecks++;
    let ok = viaMarks.size === [...viaDays].filter((x) => !Number.isNaN(x)).length;
    for (const [day, r] of viaMarks) if (viaDays[day / DAY_MS - dayEq.base] !== r) ok = false;
    if (!ok) dayEqMismatches++;
  }
  say(`simulator (market mode) ≡ run: ${simChecks - simMismatches}/${simChecks} cells identical in return, drawdown, trades, stops, exposure and days | day-indexed returns ≡ dailyReturns on ${dayEqChecks - dayEqMismatches}/${dayEqChecks}`);
  if (simMismatches || dayEqMismatches) throw new Error("the simulator is not run");

  const units = unitChecks();
  for (const u of units) say(`  unit: ${u.pass ? "ok  " : "FAIL"} ${u.name} — ${u.got}`);
  if (units.some((u) => !u.pass)) throw new Error("a fill-rule unit check failed");

  // ── coverage ───────────────────────────────────────────────────────────
  const coverage: Record<string, unknown> = {};
  for (const s of COINS) {
    const d = data[s];
    const perW: Record<string, unknown> = {};
    for (const wn of WIN_NAMES) {
      const w = d.ms.wins.find((x) => x.name === wn)!;
      const row: Record<string, unknown> = { scored: w.scored };
      if (w.scored) {
        const sp = spanOf(d, w);
        row.inSample = `${iso(sp.isFromTs)} → ${iso(sp.isToTs)}`; row.outOfSample = `${iso(sp.oosFromTs)} → ${iso(sp.oosToTs)}`;
      }
      for (const tape of ["coinbase", "kraken"] as Tape[]) for (const barH of [1, 4] as const) {
        const c = cellOf(d, tape, barH, wn);
        row[`${tape}·${barH}h`] = c.priced ? { isBars: c.is.to - c.is.from, oosBars: c.oos.to - c.oos.from } : { priced: false, why: c.why };
      }
      perW[wn] = row;
    }
    coverage[s] = perW;
  }
  const tickBps: Record<string, unknown> = {};
  for (const s of COINS) {
    // Over the bars the windows use: from the earliest in-sample start (window D's) to the end.
    const d = data[s], first = Math.min(...d.ms.wins.filter((w) => w.scored).map((w) => spanOf(d, w).isFromTs));
    const c = d.ms.comb4h.filter((x) => x.start >= first);
    const med = (xs: number[]) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    tickBps[s] = { tick: TICK[s], halfSpreadBps: r3(spreadOf(COSTS.revx, s) * 1e4), oneTickBpsAtMedianClose: r4((TICK[s] / med(c.map((x) => x.close))) * 1e4), oneTickBpsAtLowestClose: r4((TICK[s] / Math.min(...c.map((x) => x.close))) * 1e4), from: iso(first) };
  }
  if (stage === "definitions") {
    console.log(JSON.stringify({ coverage, tickBps }, null, 1));
    say("definitions stage: no candidate was run; nothing written");
    return;
  }

  // ── the candidates ─────────────────────────────────────────────────────
  type CoinRes = {
    chosen: P; chosenIndex: number; isScore: number; oos: SimOut; s1: SimOut; s2: SimOut;
    gridRets: number[]; gridDaily: Map<number, number>[]; nullRets: Float64Array; nullShort: number;
  };
  type WinRes = {
    priced: boolean; why?: string; coins: Record<string, CoinRes>;
    sleeve3?: Record<string, unknown>; sleeve4?: Record<string, unknown>; sleeve3Null?: Float64Array; sleeve4Null?: Float64Array;
    sleeve3Stats?: SleeveStats; sleeve3Sleeves?: Sleeve[];
  };
  const results: Record<string, Record<string, Partial<Record<WinName, WinRes>>>> = {};
  const hsOf = (s: string) => spreadOf(COSTS.revx, s);
  const sleevesOf = (coins: Record<string, CoinRes>, list: readonly string[], pick: (r: CoinRes) => { marks: [number, number][] | null; trades: number; exposure: number }, slot = SLOT): Sleeve[] =>
    list.filter((s) => coins[s]).map((s) => { const x = pick(coins[s]); return sleeveOf(s, x.marks!, slot, x.trades, x.exposure); });
  let combineChecks = 0;

  for (const cand of CANDIDATES) {
    results[cand.id] = {};
    for (const cond of CONDITIONS) {
      results[cand.id][cond.id] = {};
      const st = stopsOf(cond.stopRule, DEFAULT_TREND);
      for (const w of WIN_NAMES) {
        const cells = Object.fromEntries(COINS.map((s) => [s, cellOf(data[s], cond.tape, cand.barH, w)]));
        const pricedCoins = COINS.filter((s) => cells[s].priced);
        if (!DECIDING.every((s) => cells[s].priced)) {
          const why = COINS.map((s) => cells[s]).find((c) => !c.priced) as { why: string } | undefined;
          results[cand.id][cond.id][w] = { priced: false, why: why?.why ?? "not priced", coins: {} };
          continue;
        }
        const coins: Record<string, CoinRes> = {};
        // One day axis for the window's sleeve nulls.
        const dayLo = Math.min(...pricedCoins.map((s) => { const c = cells[s] as { oos: Leg }; return Math.floor(c.oos.a.start[c.oos.from] / DAY_MS); }));
        const dayHi = Math.max(...pricedCoins.map((s) => { const c = cells[s] as { oos: Leg }; return Math.floor(c.oos.a.start[c.oos.to - 1] / DAY_MS); }));
        const nDays = dayHi - dayLo + 2;
        const nullDaily: Record<string, Float64Array[]> = {};
        for (const s of pricedCoins) {
          const c = cells[s] as { is: Leg; oos: Leg };
          const base: SimOpts = { hs: hsOf(s), tick: TICK[s], fill: FILL_PRIMARY, stops: st, mode: "maker" };
          // In sample: choose.
          let best = 0, bestScore = -Infinity;
          cand.shape.grid.forEach((p, gi) => {
            const r = simulate(c.is.a, c.is.from, c.is.to, cand.shape.lookback(p), cand.shape.spec(c.is.a, p), base);
            const sc = score(r);
            if (sc > bestScore) { bestScore = sc; best = gi; }
          });
          // Out of sample: the whole grid (the plateau), then the chosen point in full.
          const gridRets: number[] = [], gridDaily: Map<number, number>[] = [];
          for (const p of cand.shape.grid) {
            const r = simulate(c.oos.a, c.oos.from, c.oos.to, cand.shape.lookback(p), cand.shape.spec(c.oos.a, p), { ...base, marks: true });
            gridRets.push(r.ret); gridDaily.push(dailyReturns(r.marks!));
          }
          const p = cand.shape.grid[best], lb = cand.shape.lookback(p);
          const oos = simulate(c.oos.a, c.oos.from, c.oos.to, lb, cand.shape.spec(c.oos.a, p), { ...base, marks: true, ledgers: true, detail: true });
          if (oos.ret !== gridRets[best]) throw new Error(`${cand.id} ${cond.id} ${w} ${s}: the chosen run is not the grid's`);
          const s1 = simulate(c.oos.a, c.oos.from, c.oos.to, lb, cand.shape.spec(c.oos.a, p), { ...base, fill: FILL_S1, marks: true });
          const s2r = simulate(c.oos.a, c.oos.from, c.oos.to, lb, cand.shape.spec(c.oos.a, p), { ...base, fill: FILL_S2, marks: true });
          // The null: the arm's entry count and holding times at random decision bars.
          const nullRets = new Float64Array(NULL_DRAWS);
          const daily: Float64Array[] = [];
          let short = 0;
          const lo = Math.max(c.oos.from, lb), hi = c.oos.to - 2;
          for (let dd = 0; dd < NULL_DRAWS; dd++) {
            const rng = mulberry32(seedOf("maker-null", cand.id, cond.id, w, s, dd));
            const { attempts, holdsPerm } = drawSchedule(rng, lo, hi, oos.entries, oos.holds);
            const dayEq = { base: dayLo, out: new Float64Array(nDays).fill(NaN) };
            const r = simulate(c.oos.a, c.oos.from, c.oos.to, lb, nullSpec(attempts, holdsPerm), { ...base, dayEq });
            nullRets[dd] = r4(r.ret);
            short += oos.entries - r.entries;
            daily.push(returnsOfDayEq(dayEq.out));
          }
          nullDaily[s] = daily;
          coins[s] = { chosen: p, chosenIndex: best, isScore: bestScore, oos, s1, s2: s2r, gridRets, gridDaily, nullRets, nullShort: short / NULL_DRAWS };
        }
        // Sleeves: the three deciding coins, and the four with AVAX.
        const wr: WinRes = { priced: true, coins };
        for (const [key, list] of [["sleeve3", DECIDING], ["sleeve4", COINS]] as const) {
          const members = list.filter((s) => coins[s]);
          const mk = (pick: (r: CoinRes) => { marks: [number, number][] | null; trades: number; exposure: number }) => combine(sleevesOf(coins, members, pick));
          const maker = mk((r) => r.oos);
          const takerCost = mk((r) => ({ marks: r.oos.takerCost!.marks, trades: r.oos.trades, exposure: r.oos.exposure }));
          const binance10 = mk((r) => ({ marks: r.oos.binance10!.marks, trades: r.oos.trades, exposure: r.oos.exposure }));
          const s1 = mk((r) => r.s1), s2x = mk((r) => r.s2);
          // The plateau: every grid point run on all the sleeve's coins at once.
          const gridN = cand.shape.grid.length;
          let positive = 0;
          const gridSleeve: number[] = [];
          for (let g = 0; g < gridN; g++) {
            const sl = members.map((s) => ({ id: s, symbol: s, slotUsd: SLOT, rets: coins[s].gridDaily[g], ret: 0, maxDD: 0, trades: 0, exposure: 0, tradedUsd: 0 }));
            const rr = combine(sl).ret;
            gridSleeve.push(rr);
            if (rr > 0) positive++;
          }
          // The sleeve null, draw by draw, and the proof that the array arithmetic is `combine`'s.
          const nulls = new Float64Array(NULL_DRAWS);
          for (let dd = 0; dd < NULL_DRAWS; dd++) nulls[dd] = combineArrays(members.map((s) => nullDaily[s][dd]), SLOT).ret;
          const armDays = members.map((s) => {
            const arr = new Float64Array(nDays).fill(NaN);
            for (const [day, r] of dailyReturns(coins[s].oos.marks!)) arr[day / DAY_MS - dayLo] = r;
            return arr;
          });
          const viaArrays = combineArrays(armDays, SLOT);
          combineChecks++;
          if (viaArrays.ret !== maker.ret || viaArrays.maxDD !== maker.maxDD) throw new Error(`${cand.id} ${cond.id} ${w} ${key}: combineArrays ${JSON.stringify(viaArrays)} is not combine ${maker.ret}/${maker.maxDD}`);
          const pNull = atLeast(nulls, maker.ret);
          const plateau = positive / gridN;
          const block = {
            members, maker: lite(maker), takerCost: lite(takerCost), binance10: lite(binance10), s1TwoTicks: lite(s1), s2TenBps: lite(s2x),
            plateau: { share: r3(plateau), positive, gridPoints: gridN, median: r4(gridSleeve.slice().sort((x, y) => x - y)[Math.floor(gridN / 2)]) },
            null: { ...summarize(nulls), pAtLeast: r4(pNull) },
            tests: { positive: maker.ret > 0, drawdownUnder35: maker.maxDD < DD_LIMIT, aboveNull95: pNull <= ALPHA, plateau50: plateau >= PLATEAU_MIN },
          };
          (block as Record<string, unknown>).passes = Object.values(block.tests).every(Boolean);
          wr[key] = block;
          if (key === "sleeve3") { wr.sleeve3Null = nulls; wr.sleeve3Stats = maker; wr.sleeve3Sleeves = sleevesOf(coins, members, (r) => r.oos); }
          else wr.sleeve4Null = nulls;
        }
        results[cand.id][cond.id][w] = wr;
        const s3 = wr.sleeve3 as { maker: { ret: number; maxDD: number }; takerCost: { ret: number }; null: { p95: number; pAtLeast: number }; plateau: { share: number } };
        say(`${cand.id.padEnd(8)} ${cond.id.padEnd(16)} ${w}: maker ${(s3.maker.ret * 100).toFixed(2)}% DD ${(s3.maker.maxDD * 100).toFixed(1)}% | taker-cost ${(s3.takerCost.ret * 100).toFixed(2)}% | null p95 ${(s3.null.p95 * 100).toFixed(2)}% P ${s3.null.pAtLeast} | plateau ${s3.plateau.share} | ${DECIDING.map((s) => `${s.split("/")[0]} ${pStr(coins[s].chosen)} ${(coins[s].oos.ret * 100).toFixed(1)}%/${coins[s].oos.entries}`).join(", ")}`);
      }
    }
  }

  // ── verdicts: the sleeve bar, §4.15 per coin, and the chance count ─────
  const JUDGED: WinName[] = ["A", "B"];
  const verdicts: Record<string, unknown> = {};
  const chanceRows: Record<string, unknown>[] = [];
  let observedBoth = 0, expectedBoth = 0;
  for (const cand of CANDIDATES) {
    const cells: Record<string, unknown>[] = [];
    let passes = true, pricedCells = 0;
    for (const cond of CONDITIONS) for (const w of JUDGED) {
      const wr = results[cand.id][cond.id][w]!;
      if (!wr.priced) { cells.push({ evaluation: cond.id, window: w, priced: false, why: wr.why }); continue; }
      pricedCells++;
      const b = wr.sleeve3 as { maker: { ret: number; maxDD: number }; null: { p95: number; pAtLeast: number }; plateau: { share: number }; tests: Record<string, boolean>; passes: boolean };
      cells.push({ evaluation: cond.id, window: w, priced: true, ret: b.maker.ret, maxDD: b.maker.maxDD, nullP95: b.null.p95, pNull: b.null.pAtLeast, plateau: b.plateau.share, tests: b.tests, passes: b.passes });
      if (!b.passes) passes = false;
    }
    for (const w of JUDGED) if (!CONDITIONS.some((c) => results[cand.id][c.id][w]!.priced)) passes = false;
    // §4.15 per coin, primary evaluation: return > 0, drawdown < 35 %, the coin's plateau ≥ 50 %, above the coin's null p95.
    const perCoin: Record<string, unknown> = {};
    const clears: Record<WinName, string[]> = { A: [], B: [], C: [], D: [] };
    for (const s of COINS) {
      const row: Record<string, unknown> = {};
      for (const w of WIN_NAMES) {
        const wr = results[cand.id][PRIMARY.id][w]!;
        const c = wr.priced ? wr.coins[s] : undefined;
        if (!c) { row[w] = { priced: false }; continue; }
        const plateau = c.gridRets.filter((x) => x > 0).length / c.gridRets.length;
        const retR = r4(c.oos.ret), pN = atLeast(c.nullRets, retR);
        const tests = { positive: c.oos.ret > 0, drawdownUnder35: c.oos.maxDD < DD_LIMIT, plateau50: plateau >= PLATEAU_MIN, aboveNull95: pN <= ALPHA };
        const ok = Object.values(tests).every(Boolean);
        if (ok) clears[w].push(s);
        row[w] = { chosen: pStr(c.chosen), ret: retR, maxDD: r4(c.oos.maxDD), entries: c.oos.entries, plateau: r3(plateau), nullP95: summarize(c.nullRets).p95, pNull: r4(pN), tests, clears: ok };
      }
      perCoin[s] = row;
    }
    const nUnits = COINS.length;
    const a = clears.A.length, b = clears.B.length;
    const both = clears.A.filter((s) => clears.B.includes(s));
    const expected = nUnits * (a / nUnits) * (b / nUnits);
    observedBoth += both.length; expectedBoth += expected;
    chanceRows.push({ candidate: cand.id, coins: nUnits, clearsA: clears.A, clearsB: clears.B, clearsBoth: both, expectedBothByChance: r3(expected) });
    verdicts[cand.id] = { passes, pricedJudgedCells: pricedCells, cells, perCoinPrimary: perCoin };
    say(`VERDICT ${cand.id}: ${passes ? "PASSES" : "fails"} the sleeve bar | §4.15 per coin: A ${clears.A.join(",") || "—"} · B ${clears.B.join(",") || "—"} · both ${both.join(",") || "—"} (chance ${expected.toFixed(2)})`);
  }
  say(`chance: ${observedBoth} two-window passes where chance gives ${expectedBoth.toFixed(2)}`);

  // ── the best candidate, and the combination with the incumbent ──────────
  const minAB = (id: string) => Math.min(...(["A", "B"] as WinName[]).map((w) => {
    const wr = results[id][PRIMARY.id][w]!;
    return wr.priced ? (wr.sleeve3 as { maker: { ret: number } }).maker.ret : -Infinity;
  }));
  let bestId = CANDIDATES[0].id;
  for (const c of CANDIDATES) if (minAB(c.id) > minAB(bestId)) bestId = c.id;
  const combination: Record<string, unknown> = {};
  for (const cand of CANDIDATES) {
    const perCond: Record<string, unknown> = {};
    for (const cond of CONDITIONS) {
      const perW: Record<string, unknown> = {};
      for (const w of WIN_NAMES) {
        const wr = results[cand.id][cond.id][w]!, ic = inc[cond.id][w];
        if (!wr.priced || !ic) { perW[w] = { priced: false }; continue; }
        const row: Record<string, unknown> = {};
        for (const [variant, keep] of [["live5", (_s: string) => true], ["four", (s: string) => s !== "SUI/USD"]] as const) {
          const incSleeves = (slot: number) => Object.entries(ic.per).filter(([s]) => keep(s)).map(([s, g]) => ({
            id: `trend-4h·${s}`, symbol: s, slotUsd: slot, rets: dailyReturns(g.marks), ret: g.ret, maxDD: g.maxDD, trades: g.trades, exposure: g.exposure, tradedUsd: g.tradedWeight * slot,
          }));
          const incAlone = incSleeves(SLOT_USD), capInc = incAlone.reduce((x, s) => x + s.slotUsd, 0);
          const candAlone = wr.sleeve3Sleeves!;
          const candHalf = candAlone.map((s) => ({ ...s, slotUsd: capInc / 2 / candAlone.length, tradedUsd: s.trades * (capInc / 2 / candAlone.length) }));
          const both = combine([...incSleeves(SLOT_USD / 2), ...candHalf]);
          const iDaily = sleeveDaily(incAlone), cDaily = sleeveDaily(candAlone);
          const common = [...iDaily.keys()].filter((d) => cDaily.has(d));
          const rho = pearson(common.map((d) => iDaily.get(d)!), common.map((d) => cDaily.get(d)!));
          row[variant] = { incumbent: lite(combine(incAlone)), candidate: lite(combine(candAlone)), combinedHalfEach: lite(both), dailyCorrelation: rho == null ? null : r3(rho), days: common.length };
        }
        perW[w] = row;
      }
      perCond[cond.id] = perW;
    }
    combination[cand.id] = perCond;
  }
  const bestComb = combination[bestId] as Record<string, Record<string, Record<string, { incumbent: { ret: number; maxDD: number }; candidate: { ret: number; maxDD: number }; combinedHalfEach: { ret: number; maxDD: number }; dailyCorrelation: number | null }>>>;
  for (const w of WIN_NAMES) {
    const r = bestComb[PRIMARY.id][w]?.live5;
    if (r) say(`combination (${bestId}, primary) ${w}: incumbent ${(r.incumbent.ret * 100).toFixed(2)}%/${(r.incumbent.maxDD * 100).toFixed(1)}% | candidate ${(r.candidate.ret * 100).toFixed(2)}%/${(r.candidate.maxDD * 100).toFixed(1)}% | half each ${(r.combinedHalfEach.ret * 100).toFixed(2)}%/${(r.combinedHalfEach.maxDD * 100).toFixed(1)}% | ρ ${r.dailyCorrelation}`);
  }

  // ── orders a day, fills and the adverse move after a fill (primary evaluation) ──
  const execution: Record<string, unknown> = {};
  let maxOrdersAny = 0;
  for (const cand of CANDIDATES) {
    const perW: Record<string, unknown> = {};
    for (const cond of CONDITIONS) for (const w of WIN_NAMES) {
      const wr = results[cand.id][cond.id][w]!;
      if (!wr.priced) continue;
      const sumDays = (list: readonly string[]) => {
        const m = new Map<number, number>();
        for (const s of list) { const o = wr.coins[s]?.oos.orders; if (o) for (const [d, k] of o) m.set(d, (m.get(d) ?? 0) + k); }
        let mx = 0, day = 0;
        for (const [d, k] of m) if (k > mx || (k === mx && d < day)) { mx = k; day = d; }
        return { max: mx, day: mx ? isoDay(day * DAY_MS) : null, meanPerDay: m.size ? r3([...m.values()].reduce((x, y) => x + y, 0) / m.size) : 0 };
      };
      const o3 = sumDays(DECIDING), o4 = sumDays(COINS);
      maxOrdersAny = Math.max(maxOrdersAny, o4.max);
      if (cond.id !== PRIMARY.id) continue;
      const m0: number[] = [], m1: number[] = [], m4: number[] = [];
      let ep = 0, ef = 0, xp = 0, xf = 0, stopsN = 0, tgt = 0, tch = 0, entries = 0;
      for (const s of DECIDING) {
        const r = wr.coins[s].oos, cl = (cellOf(data[s], cond.tape, cand.barH, w) as { oos: Leg }).oos;
        ep += r.entryPlacements; ef += r.entryFills; xp += r.exitPlacements; xf += r.exitFills; stopsN += r.stopsHit; tgt += r.exitsTarget; tch += r.exitsTouch; entries += r.entries;
        r.fillBars.forEach((f, k) => {
          const L = r.fillPrices[k];
          m0.push((cl.a.close[f] / L - 1) * 1e4);
          if (f + 1 < cl.to) m1.push((cl.a.close[f + 1] / L - 1) * 1e4);
          if (f + 4 < cl.to) m4.push((cl.a.close[f + 4] / L - 1) * 1e4);
        });
      }
      const st = (xs: number[]) => xs.length ? { n: xs.length, meanBps: r3(xs.reduce((x, y) => x + y, 0) / xs.length), medianBps: r3(xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)]) } : null;
      perW[w] = {
        ordersPerDay3: o3, ordersPerDay4: o4, entries,
        entryFillRate: ep ? r3(ef / ep) : null, exitFillRate: xp ? r3(xf / xp) : null,
        exits: { target: tgt, touch: tch, stops: stopsN },
        moveAfterEntryFill: { fillBarClose: st(m0), oneBarLater: st(m1), fourBarsLater: st(m4) },
      };
    }
    execution[cand.id] = perW;
  }
  say(`orders a day: the most any candidate placed in one UTC day across its four coins, any window or evaluation: ${maxOrdersAny} (the venue's cap is 1,000)`);

  // ── the venue's own book: window A on Revolut X's UK tape, the 4h candidates ──
  const thirdTape: Record<string, unknown> = {};
  const kr = CONDITIONS.find((c) => c.id === "shipped·kraken")!;
  for (const cand of CANDIDATES.filter((c) => c.barH === 4)) {
    const wrK = results[cand.id][kr.id].A!;
    if (!wrK.priced) { thirdTape[cand.id] = { priced: false, why: wrK.why }; continue; }
    const per: Record<string, unknown> = {};
    const sl: Sleeve[] = [], slT: Sleeve[] = [];
    for (const s of COINS) {
      const d = data[s];
      if (!d.revx || !wrK.coins[s]) continue;
      const w = d.ms.wins.find((x) => x.name === "A")!, sp = spanOf(d, w);
      const series3 = [...d.ms.kTape.filter((c) => c.start < d.revx![0].start), ...d.revx];
      const a = arrOf(series3), from = indexAtOrAfter(series3, sp.oosFromTs), to = indexAtOrAfter(series3, sp.oosToTs);
      const p = wrK.coins[s].chosen;
      const r = simulate(a, from, to, cand.shape.lookback(p), cand.shape.spec(a, p), { hs: hsOf(s), tick: TICK[s], fill: FILL_PRIMARY, stops: stopsOf("shipped", DEFAULT_TREND), mode: "maker", marks: true, ledgers: true });
      let fromKraken = 0;
      for (let k = from; k < to; k++) if (a.start[k] < d.revx[0].start) fromKraken++;
      per[s] = { chosen: pStr(p), maker: { ret: r4(r.ret), maxDD: r4(r.maxDD), entries: r.entries }, takerCost: { ret: r4(r.takerCost!.ret) }, krakenTapeSameParams: { ret: r4(wrK.coins[s].oos.ret), entries: wrK.coins[s].oos.entries }, scoredBars: to - from, barsFromKrakenWarmStart: fromKraken };
      if ((DECIDING as readonly string[]).includes(s)) {
        sl.push(sleeveOf(s, r.marks!, SLOT, r.trades, r.exposure));
        slT.push(sleeveOf(s, r.takerCost!.marks!, SLOT, r.trades, r.exposure));
      }
    }
    thirdTape[cand.id] = { perCoin: per, sleeve3: { maker: lite(combine(sl)), takerCost: lite(combine(slT)), krakenTape: (wrK.sleeve3 as { maker: unknown }).maker } };
  }

  const hashesEnd = await hashSources();
  if (JSON.stringify(hashesStart) !== JSON.stringify(hashesEnd)) throw new Error("a source file changed while the study ran");
  if (smoke) { say("smoke stage: the whole pipeline ran on synthetic prices; nothing written"); return; }

  // ── the report ───────────────────────────────────────────────────────
  const candOut: Record<string, unknown> = {};
  for (const cand of CANDIDATES) {
    const perCond: Record<string, unknown> = {};
    for (const cond of CONDITIONS) {
      const perW: Record<string, unknown> = {};
      for (const w of WIN_NAMES) {
        const wr = results[cand.id][cond.id][w]!;
        if (!wr.priced) { perW[w] = { priced: false, why: wr.why }; continue; }
        const coins: Record<string, unknown> = {};
        for (const [s, c] of Object.entries(wr.coins)) {
          const sorted = c.gridRets.slice().sort((x, y) => x - y);
          coins[s] = {
            chosen: pStr(c.chosen), inSampleScore: r3(c.isScore),
            maker: { ret: r4(c.oos.ret), maxDD: r4(c.oos.maxDD), entries: c.oos.entries, stops: c.oos.stopsHit, exposure: r3(c.oos.exposure), days: Math.round(c.oos.days) },
            takerCost: { ret: r4(c.oos.takerCost!.ret), maxDD: r4(c.oos.takerCost!.maxDD) }, binance10: { ret: r4(c.oos.binance10!.ret), maxDD: r4(c.oos.binance10!.maxDD) },
            s1TwoTicks: { ret: r4(c.s1.ret), entries: c.s1.entries }, s2TenBps: { ret: r4(c.s2.ret), entries: c.s2.entries },
            plateau: { share: r3(c.gridRets.filter((x) => x > 0).length / c.gridRets.length), median: r4(sorted[Math.floor(sorted.length / 2)]), chosenRank: sorted.filter((x) => x > c.gridRets[c.chosenIndex]).length + 1, gridPoints: c.gridRets.length },
            null: { ...summarize(c.nullRets), pAtLeast: r4(atLeast(c.nullRets, r4(c.oos.ret))), meanEntriesShort: r3(c.nullShort) },
          };
        }
        perW[w] = { priced: true, coins, sleeve3: wr.sleeve3, sleeve4: wr.sleeve4, incumbent: inc[cond.id][w] ? { live5: lite(inc[cond.id][w]!.stats), four: lite(inc[cond.id][w]!.stats4) } : null };
      }
      perCond[cond.id] = perW;
    }
    candOut[cand.id] = { shape: cand.shape.id, barHours: cand.barH, perCondition: perCond, execution: execution[cand.id] };
  }
  const incumbentOut = Object.fromEntries(CONDITIONS.map((c) => [c.id, Object.fromEntries(WIN_NAMES.filter((w) => inc[c.id][w]).map((w) => [w, { live5: lite(inc[c.id][w]!.stats), four: lite(inc[c.id][w]!.stats4) }]))]));
  const report = {
    study: "does a rule whose entries AND exits are post-only resting limit orders (0 % maker on Revolut X) become viable on BTC, ETH and SOL (AVAX secondary), where the taker version of the same kind of rule was rejected (§3.6)? Three pre-registered rule shapes on 1h and 4h bars, walk-forward on windows A–D under the four evaluations, against a random-timing null at the same fill model",
    preRegistration: { path: "docs/agents/reviews/2026-09-23-maker-only-prereg.md (frozen before any candidate arm ran)", sha256AtRun: await sha256(preregPath) },
    definitions: {
      fillModel: {
        decision: "at the close of bar i, on data up to bar i; an order rests during bar i+1 only (life one bar) and is cancelled unfilled at its close",
        price: "Revolut X's tick grid (quote_step); a bid floored and never above the touch bid open(i+1) × (1 − half-spread), an ask ceiled and never below the touch ask open(i+1) × (1 + half-spread): a post-only order is never marketable",
        fill: "a bid at L fills only if the bar's low ≤ L − one tick (traded through, not touched); an ask at U only if the high ≥ U + one tick; fill price the limit, fee 0",
        exits: "an exit ask is placed no earlier than the bar after the fill bar; the stops are taker exits priced as run prices them (min(level, open) × (1 − half-spread), 9 bps), read against the fill bar's own low and, on every later bar, before any resting ask",
        highWater: "the fill price, then the fill bar's close, then each later bar's high",
        cooldown: "two of the rule's own bars after any exit (reentryBars), as the loop",
        ticks: TICK, tickBps,
        sensitivities: { s1TwoTicks: "the same with two ticks through", s2TenBps: "the same with the low 10 bps through (§3.13's 10–20 bps adverse-selection band)" },
        sameFillArms: { takerCost: "every entry and non-stop exit repriced at its reference price ± half the spread plus 9 bps, as run prices a taker fill against its reference open — the fee and the spread, isolated", binance10: "10 bps on every fill (Binance's fee), Revolut X's half-spread on the stops; descriptive" },
      },
      shapes: Object.fromEntries(SHAPES.map((s) => [s.id, { what: s.what, grid: s.grid.map(pStr), gridPoints: s.grid.length }])),
      candidates: CANDIDATES.map((c) => c.id),
      coins: { deciding: DECIDING, secondary: ["AVAX/USD"], slotUsd: SLOT },
      walkForward: "per coin × window × evaluation, the grid point with the best in-sample ret / max(0.05, maxDD) (score), first in grid order on a tie; in-sample arrays start cold at the Coinbase series' first bar for A and B, the whole tape for C and D; out of sample on the full tape",
      windowsAndEvaluations: "backtest_jev.ts loadMeasuredSeries / windowsOn / CONDITIONS, unchanged; hourly bars mapped by timestamp; the hourly Kraken tape (the quarterly bundle) ends 2026-06-30, so the 1h candidates' Kraken evaluations cannot price window A",
      null: `per coin: the arm's entry count and its holding times (fill bar to exit bar, permuted); that many distinct decision bars drawn uniformly, sorted; at each, a touch bid re-placed each bar until it fills, held for the drawn time, then an ask at the touch; the same fill model and stops; ${NULL_DRAWS} draws; the sleeve's null combines the coins' draw k`,
      bar: `a candidate PASSES only if, on windows A and B, in every evaluation priced there: the three-coin sleeve's return > 0, drawdown < ${DD_LIMIT * 100} %, P(null ≥ arm) ≤ ${ALPHA} (ties against the arm), and ≥ ${PLATEAU_MIN * 100} % of the grid positive`,
      perCoinBar: "§4.15, primary evaluation: return > 0, drawdown < 35 %, the coin's plateau ≥ 50 %, above the coin's null p95 (in place of §4.15's Kraken-cost test, which a 0 %-maker question cannot use); every candidate coin's UK book clears $100k a day (set2.json ukBookUsdPerDay)",
      chance: "per candidate: coins × share clearing A × share clearing B (§3.12), summed",
      best: "the candidate with the highest min(A, B) three-coin sleeve return, primary evaluation, maker fill",
      combination: "the best candidate's three-coin sleeve against the incumbent (set2.json's equal row, and the four-coin BTC/ETH/SOL/AVAX variant): daily-return correlation, and a book of half each (incumbent slots halved; the candidate's three slots share the other half) against each alone",
      thirdTape: "the 4h candidates on window A over Revolut X's own UK 4h book (Kraken's tape spliced before its first bar for warm-up, as set2.json's third tape), parameters chosen on the shipped·kraken in-sample, the shipped stop; descriptive",
    },
    inputs: { tapes: dataRows, sha256: inputFiles },
    fidelity: {
      incumbentReproduction: { worstAbsDiff: reproWorst, perCondition: reproduction, what: "the incumbent sleeve against set2.json's equal row on all four evaluations and windows" },
      runGatedVsRun: { cells: runChecks, mismatches: runMismatches },
      simulatorVsRun: { cells: simChecks, mismatches: simMismatches, what: "this file's simulate in market mode, driven by the shipped rulebook through the flat-bar cache, against backtest.ts's run: return, drawdown, trades, stops, exposure and days identical, every live coin × window × evaluation" },
      dayIndexedReturns: { cells: dayEqChecks, mismatches: dayEqMismatches, what: "the day-indexed equity the null uses against dailyReturns on the marks" },
      combineArrays: { checks: combineChecks, mismatches: 0, what: "the sleeve null's array arithmetic lands on combine's return and drawdown for every arm sleeve" },
      fillRuleUnitChecks: units,
    },
    coverage,
    incumbent: incumbentOut,
    candidates: candOut,
    verdicts,
    chance: { rows: chanceRows, observedBoth, expectedBothByChance: r3(expectedBoth) },
    best: { candidate: bestId, minABSleeveReturn: r4(minAB(bestId)), all: Object.fromEntries(CANDIDATES.map((c) => [c.id, r4(minAB(c.id))])) },
    combination,
    ordersPerDay: { maxAnyCandidateFourCoins: maxOrdersAny, venueCap: 1000, note: "one placement per resting order per bar (a re-quote is a new order), plus each taker stop; cancels are not orders; the incumbent adds at most one order per coin per 4h bar" },
    thirdTape,
    multipleComparisons: { candidates: CANDIDATES.length, nominalAlpha: ALPHA, bonferroniAlpha: r4(ALPHA / CANDIDATES.length) },
    seeds: "mulberry32 seeded by seedOf(\"maker-null\", candidate, evaluation, window, coin, draw)",
    draws: { null: NULL_DRAWS, preregistered: NULL_DRAWS === NULL_DRAWS_DEFAULT },
    sourceIntegrity: { ...hashesStart, note: "SHA-256 at the start of the run; the run throws if any changed before it finished" },
  };
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(`${outDir}/maker.json`, JSON.stringify(report, null, 1));
  say(`wrote ${outDir}/maker.json`);
}

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length)) as Record<string, string>;
  await main(args);
}
