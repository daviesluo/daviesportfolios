// The EXECUTION study — how the live candidate's orders reach the book, and
// whether any of the four execution choices it makes by default is worth
// changing. The candidate is the one row §3.11 recommends for real money:
// `trend-4h` on Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots, $100.
// A study, not a rulebook. Run by hand:
//
//   deno run --allow-net --allow-read --allow-write \
//       supabase/functions/agents/backtest_execution.ts \
//       --data <dir with BTC-USD_1h_3y.json …> --out docs/agents/backtests
//
// Writes `<out>/execution.json` and nothing else. `latest.json`,
// `summary.json`, `allocation.json`, `portfolio.json` and `kraken.json` are
// NOT touched. The script reads no network — `--allow-net` is in the command
// line only because the brief names it; every input is a local candle file.
//
// **The file it writes is byte-for-byte reproducible.** There is no
// timestamp, no `Date.now()`, no map keyed on iteration order and no random
// number anywhere in its output; re-running it over the same candle files
// writes the same bytes. The wall-clock run time is printed to stdout and
// recorded in the report, not in the JSON.
//
// ── the five questions ───────────────────────────────────────────────
//
//   Q1  Maker-only execution. Every Revolut X order today is marketable at
//       the touch (9 bps taker). Could it rest instead (0 % maker) — and
//       does 0 % beat 9 bps once the entries that never fill are counted?
//   Q2  The re-entry cooldown, `SHIPPED_STOPS.reentryBars = 2`: grid
//       0,1,2,3,4,6,8. Plateau or spike, and where 2 ranks.
//   Q3  The stop surface: floor × trail × anchor × time stop, CHOSEN on one
//       window and SCORED on the other, both directions.
//   Q4  All-in / all-out against scaling in and out, with every tranche
//       checked against the venue's minimum order size.
//   Q5  The three together, against the shipped configuration.
//
// ── what is imported, and what is written here ───────────────────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `SHIPPED_STOPS`,
// `stopsForKind` and `spreadOf`, and the live rulebook in
// `_shared/agents_strategy.ts`, are IMPORTED, never re-implemented. Every
// number below is charged the same fees and the same half-spreads as the
// rows the loop runs.
//
// ONE variant is written here, `runExec`, because four things the study
// varies cannot be expressed through `run`'s arguments at all:
//
//   * how an order REACHES the book — resting at the touch against a
//     finer candle series, with a deadline, an optional re-quote, and
//     either a cancel or a cross to taker at the deadline (Q1);
//   * the trail's ANCHOR (the high since entry, or the entry price) and a
//     TIME stop, neither of which `StopParams` carries (Q3);
//   * entering and exiting in TRANCHES rather than one order each way (Q4);
//   * the per-fill bookkeeping the report needs — maker fills against taker
//     fills, fees split by kind, entries missed, entries crossed, and the
//     delay from signal to fill.
//
// Its body is `run`'s body, COPIED LINE BY LINE, with every new branch
// behind a flag. With the flags off — `exec: SHIPPED_EXEC`, `tranches:
// null`, the stop surface set to `SHIPPED_STOPS` with the high-water anchor
// and no time stop — it must reproduce `run` to the digit, and the
// `fidelity` block of the report is that check run and counted, not
// asserted: every study coin × both windows × both venues' costs × the
// three grid parameter points the rest of the study uses, reporting the
// largest absolute difference in return, drawdown and trade count. **A
// study whose fidelity check is not reported is unusable**, so it is the
// first thing the script prints and the first block in the JSON.
//
// `dailyMarks` / `dailyReturns` / `dailyOpen` / `combine` do arithmetic on
// OUTPUTS — they touch no price, no fee and no fill — and are copied from
// `backtest_allocation.ts` and `backtest_portfolio.ts`, which do not export
// them, the way those two copied them from each other. `windowsFor` is
// index arithmetic on a bar count, copied from `backtest_allocation.ts` for
// the same reason: the two windows must be the SAME two windows §3.10 and
// §3.11 scored, or nothing here is comparable to them.
//
// ── method, identical to §3.10 / §3.11 ───────────────────────────────
//
//   * three years of Coinbase hourly candles → 4h bars, and the HOURLY
//     series kept beside them, because Q1's fill question cannot be
//     answered at 4-hour resolution;
//   * TWO walk-forward windows, both reported, NEVER averaged:
//       A — the LAST third out of sample (2025-09 → 2026-09, a bear year);
//       B — the MIDDLE third out of sample (2024-09 → 2025-09, a bull year);
//     each coin split on its OWN bar count;
//   * every arm is ranked by the WORSE of its two windows;
//   * every search reports its multiple-comparisons control: how many arms
//     were looked at, how many beat the shipped configuration on BOTH
//     windows, and how many a null coin-flip would have given.
//
// ── the intrabar assumption, which decides Q1 ────────────────────────
//
// A resting bid at price P is filled in a candle whose LOW reaches P. That
// is the live loop's own `paperFill` (`_shared/agents_strategy.ts`), and it
// is OPTIMISTIC in one specific way that no candle series can fix: it
// ignores the QUEUE. On a book 1.5 bps wide the market printing at your
// price does not fill you — the orders already resting there are filled
// first, and you are filled only when the flow is big enough to clear them.
// So the study runs the same arms under three fill assumptions and reports
// all three:
//
//   `1h/0` — the loop's own rule on hourly candles: low ≤ P (headline);
//   `1h/1` — the low must trade a FULL SPREAD through P (one queue proxy);
//   `1h/2` — two full spreads through P (a harsher one);
//   `4h/0` — the loop's rule read on the 4-hour bar instead of the hourly
//            series, which is the resolution every other study in this
//            repository uses, kept so the two can be compared.
//
// The answer to Q1 moves under those assumptions, and the report says by
// how much rather than picking the flattering one.
//
// The model is not in the backtest, here as everywhere: Jev can only remove
// entries, so every figure is an upper bound on what the live row traded.

import {
  atrAt, applyFill, buildSnapshot, DEFAULT_TREND, FLAT, precompute, ruleFor,
  type Candle, type Position, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import {
  COSTS, resample, run, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v] (Coinbase)

// ───────────────────────────────────────────────────────── facts, not guesses

/** The row §3.11 recommends for live money, and the only row this study is about. */
const STUDY_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"];
const SLOT_USD = 20;
const SLEEVE_USD = SLOT_USD * STUDY_SYMBOLS.length;   // $100

/**
 * Revolut X minimum order size in quote currency, `GET /1.0/public/configuration/pairs`
 * (reference §2.1, probe 2026-09-20). **Measured for the three majors only**: the probe
 * read BTC, ETH and SOL and every pair it read returned `min_order_size_quote` $0.10.
 * AVAX and SUI are marked `null` = UNMEASURED, and the report says so rather than
 * assuming the majors' number covers them.
 */
const REVX_MIN_QUOTE_USD: Record<string, number | null> = {
  "BTC/USD": 0.10, "ETH/USD": 0.10, "SOL/USD": 0.10, "AVAX/USD": null, "SUI/USD": null,
};
/** Kraken's floor for the same question (§2b, §3.12): `costmin` $0.50 everywhere, `ordermin` $2.53–$16.26 across the 27 coins. */
const KRAKEN_COSTMIN_USD = 0.50;
const KRAKEN_ORDERMIN_USD_RANGE: [number, number] = [2.53, 16.26];

/** `agent_risk` (migration 0037): the caps the loop enforces and the model cannot touch. */
const MAX_ORDER_USD = 20;
const MAX_EXPOSURE_USD_LIVE = 100;

/** The loop's own resting-order clock (`tick.ts`), for the arms that mirror it. */
const LIVE_MAX_ORDER_AGE_H = 1;          // MAX_ORDER_AGE_MS = 60 * 60e3
const LIVE_REQUOTE_AFTER_MIN = 3;        // REQUOTE_AFTER_MS
const LIVE_REQUOTE_MOVE_BPS = 5;         // REQUOTE_MOVE_BPS
const LIVE_MAX_REQUOTES = 5;             // MAX_REQUOTES

// ──────────────────────────────────────────────────────────────── the windows

/**
 * The two walk-forward windows of §4.15 on a series of `n` bars. Copied from
 * `backtest_allocation.ts` (index arithmetic on a bar count; it touches no
 * price and no fee) so that this study's A and B are the same A and B §3.10
 * and §3.11 scored.
 */
type Window = { name: "A" | "B"; isFrom: number; isTo: number; oosFrom: number; oosTo: number };
function windowsFor(n: number): Window[] {
  const t1 = Math.floor(n / 3), t2 = Math.floor(n * 2 / 3);
  return [
    { name: "A", isFrom: 0, isTo: t2, oosFrom: t2, oosTo: n },
    { name: "B", isFrom: 0, isTo: t1, oosFrom: t1, oosTo: t2 },
  ];
}

// ──────────────────────────────────────────────── the execution specification

/**
 * How ONE side reaches the book.
 *   `shipped` — what the loop does now: the order is marketable at the touch
 *               and fills at the next bar's open ± the half-spread, paying
 *               `costs.fillFee` (taker on Revolut X, maker on Kraken). This
 *               is `run`'s only behaviour.
 *   `rest`    — the order RESTS at the touch (a bid at the bid, an ask at the
 *               ask), pays the maker fee if it fills, and is worked hour by
 *               hour against the finer series for `hours` hours. `chase`
 *               re-quotes it to each hour's touch. At the deadline it is
 *               either cancelled (the entry is missed and the rule may
 *               re-signal on a later bar) or crossed to taker at the next
 *               hour's open.
 */
type SideExec =
  | { kind: "shipped" }
  | { kind: "rest"; hours: number; chase: boolean; onTimeout: "cancel" | "cross" };

/**
 * How a protective exit reaches the book. `shipped` is marketable against
 * the stop level, exactly as `run` fills it. `walk` rests the sale at the
 * ask and walks it down each hour — which is what the loop already does on
 * KRAKEN (§4.11), and what a literal "never pay a fee" policy would force on
 * Revolut X. A stop that rests above the market in a fall does not fill, so
 * this arm measures the cost of that honestly rather than assuming it away.
 */
type StopExec = "shipped" | "walk";

/** How a resting order's fill is decided — the assumption Q1's answer turns on. */
type FillRule = {
  /** `1h` works the order against the hourly series; `4h` reads the 4-hour bar the decision sits on. */
  res: "1h" | "4h";
  /** How far THROUGH the resting price the market must trade, in full spreads. 0 is the loop's own `paperFill`. */
  throughSpreads: number;
  /**
   * The same requirement in ABSOLUTE basis points, because a spread multiple
   * is nothing on a book 1.5 bps wide: one full spread through a BTC bid is
   * 1.5 bps, which any minute delivers. The binding margin is the larger of
   * the two. This is the only dial in the file that can express "the queue
   * ahead of me did not clear", and sweeping it is how Q1 finds the level of
   * adverse selection at which maker-only stops winning.
   */
  throughBps: number;
};

type ExecParams = { entry: SideExec; ruleExit: SideExec; stop: StopExec; fill: FillRule };

const SHIPPED_FILL: FillRule = { res: "1h", throughSpreads: 0, throughBps: 0 };
const SHIPPED_EXEC: ExecParams = { entry: { kind: "shipped" }, ruleExit: { kind: "shipped" }, stop: "shipped", fill: SHIPPED_FILL };

// ────────────────────────────────────────────────────────── the stop surface

/**
 * `StopParams` widened by the two things Q3 varies that it cannot carry: the
 * ANCHOR the trail hangs from, and a TIME stop. With `anchor: "high"`,
 * `timeStopBars: null` and the shipped floor and trail it is `SHIPPED_STOPS`,
 * and `runExec` computes exactly the levels `run` computes.
 */
type StopSurface = {
  maxLossPct: number | null;   // the hard floor under average cost; null = no floor
  atrStop: number | null;      // the ATR trail multiple; null = no trail
  atrN: number;
  anchor: "high" | "entry";    // the trail hangs from the high since entry, or from the entry price
  timeStopBars: number | null; // leave after this many bars in position, at a bar close
  reentryBars: number;
};

function surfaceOf(s: StopParams, over: Partial<StopSurface> = {}): StopSurface {
  return { maxLossPct: s.maxLossPct, atrStop: s.atrStop, atrN: s.atrN, anchor: "high", timeStopBars: null, reentryBars: s.reentryBars, ...over };
}
/** The shipped surface for `trend-4h`: the 8 % floor, the 3×ATR(14) trail from the high since entry, two bars' cooldown. */
const SHIPPED_SURFACE = surfaceOf(stopsForKind("trend-4h", DEFAULT_TREND));

// ─────────────────────────────────────────────────────────────── the tranches

/**
 * Q4's sizing. `entryFracs` sums to 1 and is spent out of the slot the entry
 * decision saw: the first tranche goes at the signal, the rest wait for a
 * trigger `triggerAtr` × ATR(14) below the first fill (`pullback` — scaling
 * into weakness) or above it (`breakout` — pyramiding a winner). `targetFrac`
 * of the position is sold when the price reaches `targetAtr` × ATR above the
 * first fill; the remainder leaves on the rule or a stop, as always.
 */
type Tranches = {
  entryFracs: number[];
  trigger: "pullback" | "breakout";
  triggerAtr: number;
  targetFrac: number | null;
  targetAtr: number | null;
};

// ──────────────────────────────────────────────────────── the sized simulator

type ExecResult = RunResult & {
  /** Every bar's mark, for the sleeve arithmetic — `run` samples every sixth. */
  bars: [number, number][];
  /** [bar start, 1 when the sleeve held a position over that bar] — what the exposure cap sees. */
  openFlags: [number, number][];
  /** Σ traded notional per $1 of slot, entries and exits alike — turnover before it is priced. */
  tradedWeight: number;
  makerFills: number; takerFills: number;
  makerFeeUsd: number; takerFeeUsd: number;   // per $1 of slot, like `fees`
  /** Resting entries cancelled at the deadline without a fill — the cost of not crossing. */
  missedEntries: number;
  /** Resting rule exits cancelled at the deadline without a fill. */
  missedExits: number;
  /** Resting orders that reached the deadline and crossed to taker. */
  crossedEntries: number; crossedExits: number;
  /** Hours from the signal to the entry fill, per filled entry, in order. */
  entryDelayH: number[];
  /** Protective stops that FIRED. A walked stop counts once when it fires, however long it then took to get out. */
  stopsFired: number;
  /** Hours a walked stop took to find a fill, per stop that filled. */
  stopDelayH: number[];
  /** The smallest order this arm placed, as a fraction of the slot — Q4's legality test reads it. */
  minOrderFrac: number;
};

/** A resting order in flight. `placedAt` / `deadline` are ms; `price` is the level it currently rests at. */
type Pending = {
  side: "buy" | "sell"; price: number; base: number | null; spend: number | null;
  placedAt: number; deadline: number; chase: boolean; onTimeout: "cancel" | "cross"; signalMs: number;
};

/**
 * `backtest.ts`'s `run`, copied line by line, with four things added behind
 * flags: resting execution against a finer series, the trail's anchor and a
 * time stop, entry/exit tranches, and the per-fill bookkeeping the report
 * needs. With `exec = SHIPPED_EXEC`, `tr = null` and `stops = SHIPPED_SURFACE`
 * it IS `run` — the report's `fidelity` block is the proof, not the claim.
 *
 * `hourAt` is the 1-hour series keyed by hour start, which resting orders are
 * worked against. Nothing on the shipped path reads it.
 */
function runExec(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], hourAt: Map<number, Candle>,
  from: number, to: number, p: TrendParams, costs: Costs, barHours: number,
  stops: StopSurface | null, xc: ExecParams, tr: Tranches | null,
): ExecResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  const shippedIsMaker = costs.fillFee === "maker";
  const barMs = barHours * 3600e3;
  /** How far THROUGH a resting price the market must trade, as a fraction of it — the larger of the two dials. */
  const through = Math.max(xc.fill.throughSpreads * 2 * hs, xc.fill.throughBps / 1e4);

  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  let tradedWeight = 0, makerFills = 0, takerFills = 0, makerFeeUsd = 0, takerFeeUsd = 0;
  let missedEntries = 0, missedExits = 0, crossedEntries = 0, crossedExits = 0, stopsFired = 0;
  let minOrderFrac = Infinity;
  const entryDelayH: number[] = [], stopDelayH: number[] = [];
  const equity: [number, number][] = [], allBars: [number, number][] = [], openFlags: [number, number][] = [];
  const pre = precompute(bars, p);
  let dk = 0;   // daily candles closed at or before the current bar (moves forward only), exactly as `run` keeps it

  // Tranche bookkeeping. `slotCash` is the equity the entry decision saw, so each tranche
  // is a fixed share of the same slot rather than of whatever happens to be left.
  let entryBar = -1, firstFill = 0, entryAtr = 0, slotCash = 0, trancheIdx = 0, targetTaken = false;
  /**
   * A protective stop that RESTS instead of crossing. `since` is when the level
   * was breached; `restFrom` is when the sale may first rest — the hour AFTER
   * the breach, never before it, because a stop cannot ask a price the market
   * had not yet fallen away from. Getting that wrong is what makes a resting
   * stop look better than a marketable one, and it is not.
   */
  let walkingStop: { since: number; restFrom: number } | null = null;
  let pending: Pending | null = null;

  /** Book a fill and charge its fee. `isMaker` decides which counter moves; the rate is passed in. */
  const book = (side: "buy" | "sell", ts: number, base: number, price: number, feeRate: number, isMaker: boolean): number => {
    const fee = base * price * feeRate;
    pos = applyFill(pos, { ts, side, base, price, feeUsd: fee });
    if (isMaker) { makerFills++; makerFeeUsd += fee; } else { takerFills++; takerFeeUsd += fee; }
    trades++;
    return fee;
  };
  const buy = (ts: number, spend: number, price: number, feeRate: number, isMaker: boolean) => {
    const base = spend / (price * (1 + feeRate));     // the fee comes out of the same cash
    minOrderFrac = Math.min(minOrderFrac, spend);
    book("buy", ts, base, price, feeRate, isMaker);
    cash -= spend; tradedWeight += spend;
  };
  const sell = (ts: number, base: number, price: number, feeRate: number, isMaker: boolean, barIdx: number) => {
    minOrderFrac = Math.min(minOrderFrac, base * price);
    const fee = book("sell", ts, base, price, feeRate, isMaker);
    cash += base * price - fee; tradedWeight += base * price;
    if (pos.base <= 0) lastExitBar = barIdx;
  };
  /** What an entry fill sets up: the reference price tranches measure from, and the ATR they measure in. */
  const openedAt = (price: number, barIdx: number, decideIdx: number) => {
    entryBar = barIdx; firstFill = price; entryAtr = atrAt(bars, decideIdx, stops?.atrN ?? SHIPPED_STOPS.atrN) ?? 0;
    trancheIdx = 1; targetTaken = false;
  };

  /** The candles of `bar` that lie in [lo, hi), at the study's fill resolution. */
  const candles = (bar: Candle, lo: number, hi: number): Candle[] => {
    if (xc.fill.res === "4h") return bar.start >= lo && bar.start < hi ? [bar] : [];
    const out: Candle[] = [];
    const first = Math.max(bar.start, Math.ceil(lo / 3600e3) * 3600e3);
    for (let t = first; t < Math.min(bar.start + barMs, hi); t += 3600e3) {
      const h = hourAt.get(t);
      if (h) out.push(h);
    }
    return out;
  };
  /** The candle a cross happens in: the hour at `ts`, or the bar itself at 4-hour resolution. */
  const candleAt = (ts: number, bar: Candle): Candle | null =>
    xc.fill.res === "4h" ? (ts >= bar.start && ts < bar.start + barMs ? bar : null) : (hourAt.get(Math.floor(ts / 3600e3) * 3600e3) ?? null);

  /**
   * Work the order in flight over one bar: fill it if the market comes to it,
   * then cancel or cross it if its deadline falls inside this bar. Returns
   * true when a FILL happened, which is what `run`'s if/else-if chain treats
   * as "this bar has traded".
   */
  const workPending = (next: Candle, i: number): boolean => {
    if (!pending) return false;
    if (pending.side === "sell" && pos.base <= 0) { pending = null; return false; }
    const lo = Math.max(pending.placedAt, next.start), hi = Math.min(next.start + barMs, pending.deadline);
    for (const h of candles(next, lo, hi)) {
      if (pending.chase) pending.price = h.open * (pending.side === "buy" ? 1 - hs : 1 + hs);
      const price = pending.price;
      const hit = pending.side === "buy" ? h.low <= price * (1 - through) : h.high >= price * (1 + through);
      if (!hit) continue;
      if (pending.side === "buy") {
        buy(h.start, pending.spend ?? 0, price, maker, true);
        openedAt(price, i + 1, i);
        entryDelayH.push((h.start - pending.signalMs) / 3600e3);
      } else {
        sell(h.start, Math.min(pending.base ?? pos.base, pos.base), price, maker, true, i + 1);
      }
      pending = null;
      return true;
    }
    if (pending.deadline >= next.start + barMs) return false;   // still alive: it carries into the next bar
    const c = candleAt(pending.deadline, next);
    if (pending.onTimeout === "cross" && c) {
      const price = c.open * (pending.side === "buy" ? 1 + hs : 1 - hs);
      if (pending.side === "buy") {
        buy(c.start, pending.spend ?? 0, price, taker, false);
        openedAt(price, i + 1, i);
        entryDelayH.push((c.start - pending.signalMs) / 3600e3);
        crossedEntries++;
      } else {
        sell(c.start, Math.min(pending.base ?? pos.base, pos.base), price, taker, false, i + 1);
        crossedExits++;
      }
      pending = null;
      return true;
    }
    if (pending.side === "buy") missedEntries++; else missedExits++;
    pending = null;
    return false;
  };

  for (let i = Math.max(from, p.slow + 1); i < to - 1; i++) {
    const next = bars[i + 1];
    let acted = false;   // a FILL happened this bar — `run` never checks a stop on a bar it traded

    // ── 0. an order still in flight from an earlier bar ──────────────────
    if (pending) acted = workPending(next, i);

    // ── 1. the rule, on the closed bar — skipped while an order is in flight (`inFlight`, tick.ts) ──
    if (!pending && !acted) {
      while (dk < daily.length && daily[dk].start + 86400e3 <= bars[i].start + barMs) dk++;
      const snap = buildSnapshot(symbol, bars, i, daily.slice(0, dk), pos, bars[i].start + barMs, p, pre, (24 / barHours) * 365);
      let action = ruleFor(kind, snap, pos, p).action;
      // A time stop is a bar-close decision, like any rule exit — never an intrabar level.
      if (stops?.timeStopBars != null && pos.base > 0 && action !== "exit" && entryBar >= 0 && i + 1 - entryBar >= stops.timeStopBars) action = "exit";
      const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;

      if (action === "enter" && pos.base === 0 && !coolingDown) {
        slotCash = cash;
        const spend = cash * (tr ? tr.entryFracs[0] : 1);
        if (xc.entry.kind === "shipped") {
          const price = next.open * (1 + hs);                    // the touch, at the next open
          buy(next.start, spend, price, fill, shippedIsMaker);
          openedAt(price, i + 1, i);
          entryDelayH.push(0);
          acted = true;
        } else {
          pending = {
            side: "buy", price: next.open * (1 - hs), base: null, spend,
            placedAt: next.start, deadline: next.start + xc.entry.hours * 3600e3,
            chase: xc.entry.chase, onTimeout: xc.entry.onTimeout, signalMs: next.start,
          };
          acted = workPending(next, i);
        }
      } else if (action === "exit" && pos.base > 0 && !walkingStop) {
        if (xc.ruleExit.kind === "shipped") {
          const price = next.open * (1 - hs);
          sell(next.start, pos.base, price, fill, shippedIsMaker, i + 1);
          acted = true;
        } else {
          pending = {
            side: "sell", price: next.open * (1 + hs), base: pos.base, spend: null,
            placedAt: next.start, deadline: next.start + xc.ruleExit.hours * 3600e3,
            chase: xc.ruleExit.chase, onTimeout: xc.ruleExit.onTimeout, signalMs: next.start,
          };
          acted = workPending(next, i);
        }
      }
    }

    // ── 2. the protective exits, read against the bar's low — and they outrank a resting sell (§4.11) ──
    if (stops && pos.base > 0 && !acted && !walkingStop) {
      const hw = stops.anchor === "high" ? Math.max(pos.highWater ?? pos.avgCost, pos.avgCost) : pos.avgCost;
      const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
      const floor = stops.maxLossPct != null ? pos.avgCost * (1 - stops.maxLossPct) : -Infinity;
      const trail = stops.atrStop != null && atr != null ? hw - stops.atrStop * atr : -Infinity;
      const level = Math.max(floor, trail);
      if (level > -Infinity && next.low <= level) {
        if (pending && pending.side === "sell") pending = null;   // the stop cancels the resting exit first
        stopsFired++;
        if (xc.stop === "shipped") {
          const price = Math.min(level, next.open) * (1 - hs);
          sell(next.start, pos.base, price, stopFee, shippedIsMaker, i + 1);
          stopsHit++; acted = true; stopDelayH.push(0);
        } else {
          // Rest the sale at the ask and let the re-quote walk it down — but only from the hour AFTER the
          // one the level was breached in, which the hourly series locates exactly.
          const hrs = candles(next, next.start, next.start + barMs);
          const breach = hrs.find((h) => h.low <= level) ?? hrs[hrs.length - 1] ?? next;
          walkingStop = { since: breach.start, restFrom: breach.start + (xc.fill.res === "4h" ? barMs : 3600e3) };
        }
      }
    }
    // A walked stop, worked hour by hour at that hour's ask until it fills. It never crosses — that is the arm.
    if (walkingStop && pos.base > 0 && !acted) {
      for (const h of candles(next, Math.max(next.start, walkingStop.restFrom), next.start + barMs)) {
        const price = h.open * (1 + hs);
        if (h.high < price * (1 + through)) continue;
        sell(h.start, pos.base, price, maker, true, i + 1);
        stopsHit++; acted = true;
        stopDelayH.push((h.start - walkingStop.since) / 3600e3);
        walkingStop = null;
        break;
      }
    }
    if (pos.base === 0) walkingStop = null;

    // ── 3. the tranches: the adds and the profit target, while long and nothing else happened ──
    if (tr && pos.base > 0 && !acted && !pending && !walkingStop) {
      if (trancheIdx < tr.entryFracs.length && entryAtr > 0) {
        const step = tr.triggerAtr * entryAtr * trancheIdx;
        const trigger = tr.trigger === "pullback" ? firstFill - step : firstFill + step;
        const hit = tr.trigger === "pullback" ? next.low <= trigger : next.high >= trigger;
        // A pullback add is a resting limit and is charged at its own level; a breakout add is a stop-buy
        // and takes `run`'s gap-through convention — the level, or the open when the bar gapped past it.
        const raw = tr.trigger === "pullback" ? trigger : Math.max(trigger, next.open);
        const spend = slotCash * tr.entryFracs[trancheIdx];
        if (hit && trigger > 0 && spend > 0 && spend <= cash + 1e-12) {
          buy(next.start, spend, raw * (1 + hs), fill, shippedIsMaker);
          trancheIdx++; acted = true;
        }
      }
      if (!acted && !targetTaken && tr.targetFrac != null && tr.targetAtr != null && entryAtr > 0) {
        const target = firstFill + tr.targetAtr * entryAtr;
        if (next.high >= target) {
          sell(next.start, pos.base * tr.targetFrac, target * (1 - hs), fill, shippedIsMaker, i + 1);
          targetTaken = true; acted = true;
        }
      }
    }

    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }; }
    const eq = cash + pos.base * next.close;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    if (i % 6 === 0) equity.push([next.start, Number(eq.toFixed(5))]);
    allBars.push([next.start, eq]);
    openFlags.push([next.start, pos.base > 0 ? 1 : 0]);
  }
  const startBar = Math.max(from, p.slow + 1);
  const eqEnd = cash + pos.base * bars[to - 1].close;
  const days = (bars[to - 1].start - bars[startBar].start) / 86400e3;
  return {
    ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity,
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit,
    bars: allBars, openFlags, tradedWeight, makerFills, takerFills, makerFeeUsd, takerFeeUsd,
    missedEntries, missedExits, crossedEntries, crossedExits, entryDelayH, stopsFired, stopDelayH,
    minOrderFrac: Number.isFinite(minOrderFrac) ? minOrderFrac : 0,
  };
}

/**
 * Every caller goes through this name. `runExec` keeps all of its state in
 * locals, so it is re-entrant and this is a plain alias — kept only so the
 * call sites read as "exec(...)" beside `run(...)` in the fidelity check.
 */
const exec = runExec;

// ───────────────────────────────────────────── daily arithmetic (copied, no prices)
// (from backtest_allocation.ts / backtest_portfolio.ts, which do not export
//  them; none of these touches a price, a fee or a fill.)

function dailyMarks(marks: [number, number][]): { day: number; eq: number }[] {
  const m = new Map<number, number>();
  for (const [t, e] of marks) m.set(Math.floor(t / 86400e3) * 86400e3, e);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, eq]) => ({ day, eq }));
}
function dailyReturns(marks: [number, number][]): Map<number, number> {
  const out = new Map<number, number>();
  let prev = 1;
  for (const { day, eq } of dailyMarks(marks)) { out.set(day, prev > 0 ? eq / prev - 1 : 0); prev = eq; }
  return out;
}
function dailyOpen(flags: [number, number][]): Map<number, number> {
  const m = new Map<number, number>();
  for (const [t, f] of flags) {
    const d = Math.floor(t / 86400e3) * 86400e3;
    m.set(d, Math.max(m.get(d) ?? 0, f));
  }
  return m;
}

type SleeveStats = {
  ret: number; maxDD: number; retOverDD: number; pnlUsd: number; capitalUsd: number;
  trades: number; feesUsd: number; makerFeeUsd: number; takerFeeUsd: number; makerFills: number; takerFills: number;
  missedEntries: number; crossedEntries: number; stopsHit: number;
  deployment: number; turnoverPerYear: number; peakOpenUsd: number; days: number;
};

/**
 * The five coins at $20 each, combined the way a live row earns: each day's
 * dollar P&L is Σ slot × that coin's fractional return, and the drawdown is
 * read off the running equity. A live row re-sizes every entry to the same
 * dollars rather than compounding, which is exactly this sum.
 */
function combineEqual(rs: ExecResult[], slotUsd = SLOT_USD): SleeveStats {
  const rets = rs.map((r) => dailyReturns(r.bars));
  const opens = rs.map((r) => dailyOpen(r.openFlags));
  const days = [...new Set(rs.flatMap((r) => [...dailyReturns(r.bars).keys()]))].sort((a, b) => a - b);
  const capital = slotUsd * rs.length;
  let eq = capital, peak = capital, maxDD = 0, peakOpen = 0;
  for (const d of days) {
    let pnl = 0, open = 0;
    for (let k = 0; k < rs.length; k++) { pnl += slotUsd * (rets[k].get(d) ?? 0); open += slotUsd * (opens[k].get(d) ?? 0); }
    eq += pnl; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    peakOpen = Math.max(peakOpen, open);
  }
  const years = Math.max(1e-9, (days[days.length - 1] - days[0]) / 86400e3 / 365);
  const ret = (eq - capital) / capital;
  const sum = (f: (r: ExecResult) => number) => rs.reduce((a, r) => a + f(r), 0);
  return {
    ret: Number(ret.toFixed(4)), maxDD: Number(maxDD.toFixed(4)), retOverDD: Number((ret / Math.max(0.05, maxDD)).toFixed(2)),
    pnlUsd: Number((eq - capital).toFixed(2)), capitalUsd: capital,
    trades: sum((r) => r.trades),
    feesUsd: Number((sum((r) => r.fees) * slotUsd).toFixed(4)),
    makerFeeUsd: Number((sum((r) => r.makerFeeUsd) * slotUsd).toFixed(4)),
    takerFeeUsd: Number((sum((r) => r.takerFeeUsd) * slotUsd).toFixed(4)),
    makerFills: sum((r) => r.makerFills), takerFills: sum((r) => r.takerFills),
    missedEntries: sum((r) => r.missedEntries), crossedEntries: sum((r) => r.crossedEntries),
    stopsHit: sum((r) => r.stopsHit ?? 0),
    deployment: Number((sum((r) => r.exposure) / rs.length).toFixed(3)),
    turnoverPerYear: Number((sum((r) => r.tradedWeight) / rs.length / years).toFixed(2)),
    peakOpenUsd: Number(peakOpen.toFixed(2)), days: days.length,
  };
}

// ───────────────────────────────────────────── the multiple-comparisons control

/** P(X ≥ k) for X ~ Binomial(n, p) — exact, by summation. */
function binomTail(n: number, k: number, p: number): number {
  let tail = 0;
  for (let j = k; j <= n; j++) {
    let logc = 0;
    for (let t = 0; t < j; t++) logc += Math.log(n - t) - Math.log(t + 1);
    tail += Math.exp(logc + j * Math.log(p) + (n - j) * Math.log(1 - p));
  }
  return Math.min(1, tail);
}

type Control = { armsLookedAt: number; passedBothWindows: number; expectedByChance: number; pAtLeastThatMany: number; note: string };
/**
 * The control every search in this file reports. An arm "passes" when it
 * beats the shipped configuration on BOTH windows. Under the null that an
 * arm is a coin flip against the baseline in each window, the EXPECTED number
 * of passes is `arms × 0.25` exactly — linearity of expectation holds however
 * correlated the arms are. The tail probability additionally assumes the arms
 * are INDEPENDENT, which variants of one rule are not, so it is a floor on
 * the real probability and not a p-value.
 */
function control(arms: number, passed: number): Control {
  return {
    armsLookedAt: arms, passedBothWindows: passed,
    expectedByChance: Number((arms * 0.25).toFixed(2)),
    pAtLeastThatMany: Number(binomTail(arms, passed, 0.25).toPrecision(3)),
    note: "an arm passes only by beating the shipped configuration on BOTH windows; expected count is arms × 0.25 under a coin-flip null, which is exact however correlated the arms are; the tail probability assumes independent arms, which variants of one rule are not, so it is a floor",
  };
}

// ──────────────────────────────────────────────────────────────── small helpers

function pick(r: ExecResult) {
  return {
    ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)),
    retOverDD: Number((r.ret / Math.max(0.05, r.maxDD)).toFixed(2)),
    trades: r.trades, stopsHit: r.stopsHit ?? 0, exposure: Number(r.exposure.toFixed(3)),
    feesPct: Number((r.fees * 100).toFixed(3)), makerFills: r.makerFills, takerFills: r.takerFills,
    missedEntries: r.missedEntries, missedExits: r.missedExits, crossedEntries: r.crossedEntries,
    medianEntryDelayH: r.entryDelayH.length ? Number(median(r.entryDelayH).toFixed(2)) : null,
  };
}
function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function worse(a: number, b: number): number { return Math.min(a, b); }
function r4(x: number): number { return Number(x.toFixed(4)); }

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  type Series = { hourly: Candle[]; c4h: Candle[]; daily: Candle[]; hourAt: Map<number, Candle> };
  const series: Record<string, Series> = {};
  for (const symbol of STUDY_SYMBOLS) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${symbol.replace("/", "-")}_1h_3y.json`));
    const hourly: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    const hourAt = new Map<number, Candle>();
    for (const h of hourly) hourAt.set(h.start, h);
    series[symbol] = { hourly, c4h: resample(hourly, 4), daily: resample(hourly, 24), hourAt };
  }

  const KIND: StrategyKind = "trend-4h";
  const P = DEFAULT_TREND;
  const REVX = COSTS.revx;

  const report: Record<string, unknown> = {
    study: "execution — maker-only fills, the re-entry cooldown, the stop surface, scaling in and out, and the four together, against the row recommended for live money",
    deterministic: "this file carries no timestamp and no random number; re-running the script over the same candle files writes it byte for byte. The run time is in docs/agents/reviews/2026-09-21-execution-study.md.",
    subject: { row: "trend-4h · revx", symbols: STUDY_SYMBOLS, slotUsd: SLOT_USD, sleeveUsd: SLEEVE_USD, params: P },
    source: "Coinbase Exchange 1h → 4h bars, with the HOURLY series kept beside them because Q1's fill question cannot be answered at 4-hour resolution. Two walk-forward windows (A: the last third out of sample, a bear year; B: the middle third out, a bull year), each coin split on its own bar count, never averaged. Fills, fees, the 8 % floor, the 3×ATR(14) trail and the two-bar cooldown are backtest.ts's own; Revolut X takes the touch at 9 bps taker + half-spread per side unless an arm says otherwise. The model is not in the backtest.",
    intrabarAssumption: "A resting bid at P fills in a candle whose low reaches P — the live loop's own paperFill. It ignores the QUEUE: on a book 1.5 bps wide the market printing at your price does not fill you. Every Q1 arm is therefore also run with the low required to trade one and two FULL SPREADS through P, and at 4-hour resolution, and all four assumptions are reported.",
    caps: { maxOrderUsd: MAX_ORDER_USD, maxExposureUsdLive: MAX_EXPOSURE_USD_LIVE },
    venueMinimums: { revxMinQuoteUsd: REVX_MIN_QUOTE_USD, revxNote: "measured for BTC/ETH/SOL only (§2.1); AVAX and SUI are UNMEASURED and marked null", krakenCostminUsd: KRAKEN_COSTMIN_USD, krakenOrderminUsdRange: KRAKEN_ORDERMIN_USD_RANGE },
    liveRestingClock: { maxOrderAgeHours: LIVE_MAX_ORDER_AGE_H, requoteAfterMinutes: LIVE_REQUOTE_AFTER_MIN, requoteMoveBps: LIVE_REQUOTE_MOVE_BPS, maxRequotes: LIVE_MAX_REQUOTES },
    shippedStops: SHIPPED_STOPS, costs: { revx: COSTS.revx, kraken: COSTS.kraken },
  };

  // The per-coin windows, in dates, so the report can say what was scored.
  const windows: Record<string, unknown> = {};
  for (const s of STUDY_SYMBOLS) {
    const c = series[s].c4h;
    windows[s] = {
      bars4h: c.length, hours: series[s].hourly.length,
      ...Object.fromEntries(windowsFor(c.length).map((w) => [w.name, {
        oosFrom: new Date(c[w.oosFrom].start).toISOString().slice(0, 10),
        oosTo: new Date(c[w.oosTo - 1].start).toISOString().slice(0, 10), bars: w.oosTo - w.oosFrom,
      }])),
    };
  }
  report.windows = windows;

  // ══════════════════════════════════════════════════════ fidelity, first
  // `runExec` with every new branch switched off, against backtest.ts's `run`.
  {
    const fid = { checks: 0, worstRet: 0, worstDD: 0, worstTrades: 0, worstExposure: 0, worstFees: 0 };
    const grid: TrendParams[] = [P, { ...P, fast: 10, slow: 50, atrStop: 2 }, { ...P, fast: 30, slow: 150, atrStop: 4 }];
    for (const symbol of STUDY_SYMBOLS) {
      const { c4h, daily, hourAt } = series[symbol];
      for (const w of windowsFor(c4h.length)) {
        for (const costs of [COSTS.revx, COSTS.kraken]) {
          for (const p of grid) {
            const st = stopsForKind(KIND, p);
            const a = run(KIND, symbol, c4h, daily, w.oosFrom, w.oosTo, p, costs, 4, st);
            const b = exec(KIND, symbol, c4h, daily, hourAt, w.oosFrom, w.oosTo, p, costs, 4, surfaceOf(st), SHIPPED_EXEC, null);
            fid.worstRet = Math.max(fid.worstRet, Math.abs(a.ret - b.ret));
            fid.worstDD = Math.max(fid.worstDD, Math.abs(a.maxDD - b.maxDD));
            fid.worstTrades = Math.max(fid.worstTrades, Math.abs(a.trades - b.trades));
            fid.worstExposure = Math.max(fid.worstExposure, Math.abs(a.exposure - b.exposure));
            fid.worstFees = Math.max(fid.worstFees, Math.abs(a.fees - b.fees));
            fid.checks++;
          }
        }
      }
    }
    report.fidelity = {
      ...fid,
      note: "runExec with exec = SHIPPED_EXEC, tranches = null and the stop surface set to SHIPPED_STOPS (high-water anchor, no time stop), against backtest.ts's run: five coins × two windows × both venues' costs × three parameter points. Largest absolute difference in return, drawdown, trade count, exposure and fees. Anything but zero means the variant is not the shipped rule and nothing else in this file can be trusted.",
    };
    console.log(`fidelity: ${fid.checks} checks | worst |Δret| ${fid.worstRet.toExponential(2)} | |ΔmaxDD| ${fid.worstDD.toExponential(2)} | |Δtrades| ${fid.worstTrades} | |Δexposure| ${fid.worstExposure.toExponential(2)} | |Δfees| ${fid.worstFees.toExponential(2)}`);
    if (fid.worstRet > 0 || fid.worstTrades > 0) console.log("FIDELITY FAILED — the numbers below do not describe the shipped rule");
  }

  // ═══════════════════════════════════════════════════════════════ Q1 — maker
  const restArm = (hours: number, onTimeout: "cancel" | "cross", chase: boolean): SideExec => ({ kind: "rest", hours, chase, onTimeout });
  type Q1Arm = { name: string; exec: ExecParams; what: string };
  const q1Arms = (fill: FillRule): Q1Arm[] => [
    { name: "taker (shipped)", exec: { ...SHIPPED_EXEC, fill }, what: "every order marketable at the touch, 9 bps" },
    { name: "rest-1h-cancel", exec: { entry: restArm(1, "cancel", false), ruleExit: restArm(1, "cancel", false), stop: "shipped", fill }, what: "rest at the touch for the loop's own MAX_ORDER_AGE, then cancel; stops stay marketable" },
    { name: "rest-2h-cancel", exec: { entry: restArm(2, "cancel", false), ruleExit: restArm(2, "cancel", false), stop: "shipped", fill }, what: "rest two hours, then cancel" },
    { name: "rest-4h-cancel", exec: { entry: restArm(4, "cancel", false), ruleExit: restArm(4, "cancel", false), stop: "shipped", fill }, what: "rest one whole bar, then cancel" },
    { name: "rest-8h-cancel", exec: { entry: restArm(8, "cancel", false), ruleExit: restArm(8, "cancel", false), stop: "shipped", fill }, what: "rest two bars, then cancel" },
    { name: "rest-1h-cross", exec: { entry: restArm(1, "cross", false), ruleExit: restArm(1, "cross", false), stop: "shipped", fill }, what: "rest one hour, then cross to taker" },
    { name: "rest-2h-cross", exec: { entry: restArm(2, "cross", false), ruleExit: restArm(2, "cross", false), stop: "shipped", fill }, what: "rest two hours, then cross" },
    { name: "rest-4h-cross", exec: { entry: restArm(4, "cross", false), ruleExit: restArm(4, "cross", false), stop: "shipped", fill }, what: "rest one bar, then cross" },
    { name: "rest-8h-cross", exec: { entry: restArm(8, "cross", false), ruleExit: restArm(8, "cross", false), stop: "shipped", fill }, what: "rest two bars, then cross" },
    { name: "rest-1h-cancel-chase", exec: { entry: restArm(1, "cancel", true), ruleExit: restArm(1, "cancel", true), stop: "shipped", fill }, what: "re-quote to each hour's touch, then cancel" },
    { name: "rest-4h-cancel-chase", exec: { entry: restArm(4, "cancel", true), ruleExit: restArm(4, "cancel", true), stop: "shipped", fill }, what: "re-quote hourly for a bar, then cancel" },
    { name: "rest-4h-cross-chase", exec: { entry: restArm(4, "cross", true), ruleExit: restArm(4, "cross", true), stop: "shipped", fill }, what: "re-quote hourly for a bar, then cross" },
    { name: "rest-4h-cancel-entryOnly", exec: { entry: restArm(4, "cancel", false), ruleExit: { kind: "shipped" }, stop: "shipped", fill }, what: "maker entries, taker rule exits" },
    { name: "rest-4h-cancel-exitOnly", exec: { entry: { kind: "shipped" }, ruleExit: restArm(4, "cancel", false), stop: "shipped", fill }, what: "taker entries, maker rule exits" },
    { name: "rest-1h-cancel-makerStop", exec: { entry: restArm(1, "cancel", false), ruleExit: restArm(1, "cancel", false), stop: "walk", fill }, what: "no fee ever paid: the stop rests at the ask and is walked down" },
    { name: "rest-4h-cancel-makerStop", exec: { entry: restArm(4, "cancel", false), ruleExit: restArm(4, "cancel", false), stop: "walk", fill }, what: "the same, resting a whole bar" },
  ];

  const q1Run = (arm: Q1Arm, wname: "A" | "B") => {
    const per: Record<string, ReturnType<typeof pick>> = {};
    const rs: ExecResult[] = [];
    for (const s of STUDY_SYMBOLS) {
      const { c4h, daily, hourAt } = series[s];
      const w = windowsFor(c4h.length).find((x) => x.name === wname)!;
      const r = exec(KIND, s, c4h, daily, hourAt, w.oosFrom, w.oosTo, P, REVX, 4, SHIPPED_SURFACE, arm.exec, null);
      per[s] = pick(r); rs.push(r);
    }
    return { sleeve: combineEqual(rs), perCoin: per };
  };

  const q1: Record<string, unknown> = { question: "Could every Revolut X order rest as a maker order so no fee is ever paid — once the entries that never fill are counted?" };
  const q1Headline: Record<string, { A: ReturnType<typeof q1Run>; B: ReturnType<typeof q1Run> }> = {};
  for (const arm of q1Arms(SHIPPED_FILL)) {
    q1Headline[arm.name] = { A: q1Run(arm, "A"), B: q1Run(arm, "B") };
    const a = q1Headline[arm.name].A.sleeve, b = q1Headline[arm.name].B.sleeve;
    console.log(`Q1 ${arm.name.padEnd(26)} A ${(a.ret * 100).toFixed(2)}% (DD ${(a.maxDD * 100).toFixed(1)}%, ${a.trades} fills, missed ${a.missedEntries}, fees $${a.feesUsd.toFixed(3)}) | B ${(b.ret * 100).toFixed(2)}% (DD ${(b.maxDD * 100).toFixed(1)}%, ${b.trades} fills, missed ${b.missedEntries}, fees $${b.feesUsd.toFixed(3)})`);
  }
  const base1A = q1Headline["taker (shipped)"].A.sleeve, base1B = q1Headline["taker (shipped)"].B.sleeve;
  const q1Table = q1Arms(SHIPPED_FILL).map((arm) => {
    const a = q1Headline[arm.name].A.sleeve, b = q1Headline[arm.name].B.sleeve;
    return {
      arm: arm.name, what: arm.what,
      A: a, B: b,
      dRetA: r4(a.ret - base1A.ret), dRetB: r4(b.ret - base1B.ret),
      feesSavedUsdA: r4(base1A.feesUsd - a.feesUsd), feesSavedUsdB: r4(base1B.feesUsd - b.feesUsd),
      worseWindowRetOverDD: worse(a.retOverDD, b.retOverDD),
      beatsShippedBothWindows: a.ret > base1A.ret && b.ret > base1B.ret,
    };
  });
  q1.arms = q1Table;
  q1.perCoin = Object.fromEntries(q1Arms(SHIPPED_FILL).map((arm) => [arm.name, { A: q1Headline[arm.name].A.perCoin, B: q1Headline[arm.name].B.perCoin }]));
  q1.control = control(q1Table.length - 1, q1Table.filter((x) => x.arm !== "taker (shipped)" && x.beatsShippedBothWindows).length);

  // ── the fill assumption, swept: the answer to Q1 turns entirely on it ──
  // `q1Run` takes a venue so the decomposition below can price the same arm on
  // a synthetic Revolut X whose maker fee is 9 bps — which separates what a
  // resting order earns from the SPREAD from what it saves in FEES.
  const SENS: { name: string; fill: FillRule }[] = [
    { name: "1h/0 — the loop's own paperFill (low reaches the bid)", fill: { res: "1h", throughSpreads: 0, throughBps: 0 } },
    { name: "1h/1 spread — the low trades one full spread through the bid", fill: { res: "1h", throughSpreads: 1, throughBps: 0 } },
    { name: "1h/2 spreads", fill: { res: "1h", throughSpreads: 2, throughBps: 0 } },
    { name: "1h/+2 bps through", fill: { res: "1h", throughSpreads: 0, throughBps: 2 } },
    { name: "1h/+5 bps through", fill: { res: "1h", throughSpreads: 0, throughBps: 5 } },
    { name: "1h/+10 bps through", fill: { res: "1h", throughSpreads: 0, throughBps: 10 } },
    { name: "1h/+20 bps through", fill: { res: "1h", throughSpreads: 0, throughBps: 20 } },
    { name: "1h/+50 bps through", fill: { res: "1h", throughSpreads: 0, throughBps: 50 } },
    { name: "4h/0 — the loop's rule on the 4-hour bar", fill: { res: "4h", throughSpreads: 0, throughBps: 0 } },
  ];
  const SENS_ARMS = ["taker (shipped)", "rest-1h-cancel", "rest-4h-cancel", "rest-1h-cross", "rest-4h-cross", "rest-4h-cancel-makerStop"];
  const sens: Record<string, unknown> = {};
  for (const sv of SENS) {
    const arms = q1Arms(sv.fill).filter((a) => SENS_ARMS.includes(a.name));
    const rows: Record<string, unknown> = {};
    let bA = 0, bB = 0;
    for (const arm of arms) {
      const a = q1Run(arm, "A").sleeve, b = q1Run(arm, "B").sleeve;
      if (arm.name === "taker (shipped)") { bA = a.ret; bB = b.ret; }
      rows[arm.name] = {
        A: { ret: a.ret, maxDD: a.maxDD, retOverDD: a.retOverDD, trades: a.trades, missedEntries: a.missedEntries, makerFills: a.makerFills, takerFills: a.takerFills, feesUsd: a.feesUsd },
        B: { ret: b.ret, maxDD: b.maxDD, retOverDD: b.retOverDD, trades: b.trades, missedEntries: b.missedEntries, makerFills: b.makerFills, takerFills: b.takerFills, feesUsd: b.feesUsd },
        dRetA: r4(a.ret - bA), dRetB: r4(b.ret - bB),
        stillBeatsTakerBothWindows: a.ret > bA && b.ret > bB,
      };
      console.log(`Q1-sens ${sv.name} · ${arm.name.padEnd(26)} A ${(a.ret * 100).toFixed(2)}% | B ${(b.ret * 100).toFixed(2)}% | maker fills ${a.makerFills}/${a.trades}, missed ${a.missedEntries}`);
    }
    sens[sv.name] = rows;
  }

  // ── where the maker edge comes from: the SPREAD, or the FEE ───────────
  // The same arm on a synthetic Revolut X whose MAKER fee is 9 bps: a resting
  // order still buys the bid and sells the ask, but saves nothing in fees. The
  // difference from the taker baseline is then spread capture alone, and what
  // the real 0 % maker adds on top of it is the fee.
  const REVX_MAKER9: Costs = { ...COSTS.revx, makerBps: 9 };
  const decomp: Record<string, unknown> = {};
  for (const name of ["rest-1h-cancel", "rest-4h-cancel", "rest-4h-cross"]) {
    const arm = q1Arms(SHIPPED_FILL).find((a) => a.name === name)!;
    const row: Record<string, unknown> = {};
    for (const wname of ["A", "B"] as const) {
      const rs: ExecResult[] = [], rs9: ExecResult[] = [];
      for (const sym of STUDY_SYMBOLS) {
        const { c4h, daily, hourAt } = series[sym];
        const w = windowsFor(c4h.length).find((x) => x.name === wname)!;
        rs.push(exec(KIND, sym, c4h, daily, hourAt, w.oosFrom, w.oosTo, P, REVX, 4, SHIPPED_SURFACE, arm.exec, null));
        rs9.push(exec(KIND, sym, c4h, daily, hourAt, w.oosFrom, w.oosTo, P, REVX_MAKER9, 4, SHIPPED_SURFACE, arm.exec, null));
      }
      const full = combineEqual(rs), spreadOnly = combineEqual(rs9);
      const base = wname === "A" ? base1A : base1B;
      row[wname] = {
        takerBaselineRet: base.ret, makerRet: full.ret, makerAt9bpsFeeRet: spreadOnly.ret,
        spreadCapturePoints: r4(spreadOnly.ret - base.ret), feeSavingPoints: r4(full.ret - spreadOnly.ret),
        totalPoints: r4(full.ret - base.ret),
      };
    }
    decomp[name] = row;
    console.log(`Q1-decomp ${name}: A spread ${(row.A as Record<string, number>).spreadCapturePoints} + fee ${(row.A as Record<string, number>).feeSavingPoints} | B spread ${(row.B as Record<string, number>).spreadCapturePoints} + fee ${(row.B as Record<string, number>).feeSavingPoints}`);
  }
  q1.decomposition = { note: "the same arm on a synthetic Revolut X whose maker fee is 9 bps instead of 0: the difference from the taker baseline is then the SPREAD a resting order captures (it buys the bid instead of lifting the ask), and what the real 0 % maker adds on top is the FEE. Per side a resting order is worth 2 × half-spread + 9 bps — 10.5 bps on BTC, 11.1 on ETH, 12.1 on SOL, 18.6 on AVAX and 32.9 on SUI.", rows: decomp };
  q1.perSideEdgeBps = Object.fromEntries(STUDY_SYMBOLS.map((s) => [s, Number((2 * spreadOf(REVX, s) * 1e4 + REVX.takerBps).toFixed(2))]));
  q1.sensitivity = sens;
  report.q1 = q1;

  // ══════════════════════════════════════════════════════ Q2 — the cooldown
  const COOLDOWNS = [0, 1, 2, 3, 4, 6, 8];
  const q2Rows = COOLDOWNS.map((k) => {
    const out: Record<string, unknown> = { reentryBars: k };
    for (const wname of ["A", "B"] as const) {
      const rs: ExecResult[] = [], per: Record<string, ReturnType<typeof pick>> = {};
      for (const s of STUDY_SYMBOLS) {
        const { c4h, daily, hourAt } = series[s];
        const w = windowsFor(c4h.length).find((x) => x.name === wname)!;
        const r = exec(KIND, s, c4h, daily, hourAt, w.oosFrom, w.oosTo, P, REVX, 4, { ...SHIPPED_SURFACE, reentryBars: k }, SHIPPED_EXEC, null);
        rs.push(r); per[s] = pick(r);
      }
      out[wname] = combineEqual(rs); out[`perCoin${wname}`] = per;
    }
    return out;
  });
  const q2A = q2Rows.map((r) => (r.A as SleeveStats).retOverDD), q2B = q2Rows.map((r) => (r.B as SleeveStats).retOverDD);
  const shippedIdx = COOLDOWNS.indexOf(2);
  const rankOf = (xs: number[], i: number) => xs.filter((v) => v > xs[i]).length + 1;
  const q2Passed = q2Rows.filter((r, i) => i !== shippedIdx && (r.A as SleeveStats).ret > (q2Rows[shippedIdx].A as SleeveStats).ret && (r.B as SleeveStats).ret > (q2Rows[shippedIdx].B as SleeveStats).ret).length;
  report.q2 = {
    question: "SHIPPED_STOPS.reentryBars = 2 — after ANY exit the rule waits two of its own bars (8 hours on trend-4h). Plateau or spike, and where does 2 rank?",
    grid: COOLDOWNS, rows: q2Rows,
    shipped: { reentryBars: 2, rankByRetOverDD: { A: rankOf(q2A, shippedIdx), B: rankOf(q2B, shippedIdx), of: COOLDOWNS.length } },
    worseWindow: COOLDOWNS.map((k, i) => ({ reentryBars: k, worseRetOverDD: worse(q2A[i], q2B[i]), A: q2A[i], B: q2B[i] })),
    plateau: {
      positiveBothWindows: COOLDOWNS.filter((_, i) => (q2Rows[i].A as SleeveStats).ret > 0 && (q2Rows[i].B as SleeveStats).ret > 0),
      spreadAcrossGridA: r4(Math.max(...q2A) - Math.min(...q2A)), spreadAcrossGridB: r4(Math.max(...q2B) - Math.min(...q2B)),
    },
    control: control(COOLDOWNS.length - 1, q2Passed),
  };
  for (const r of q2Rows) console.log(`Q2 reentryBars ${r.reentryBars}: A ${((r.A as SleeveStats).ret * 100).toFixed(2)}% / ${(r.A as SleeveStats).retOverDD} | B ${((r.B as SleeveStats).ret * 100).toFixed(2)}% / ${(r.B as SleeveStats).retOverDD}`);

  // ═════════════════════════════════════════════════════ Q3 — the stop surface
  const FLOORS: (number | null)[] = [0.06, 0.08, 0.10, 0.12, 0.15, null];
  const TRAILS: (number | null)[] = [2, 3, 4, 6, null];
  const ANCHORS: ("high" | "entry")[] = ["high", "entry"];
  const TIMESTOPS: (number | null)[] = [null, 10, 20, 40];
  const surfaces: { id: string; s: StopSurface }[] = [];
  for (const f of FLOORS) for (const t of TRAILS) for (const a of ANCHORS) for (const ts of TIMESTOPS) {
    if (t == null && a === "entry") continue;   // with no trail the anchor is meaningless — one setting, not two
    surfaces.push({
      id: `floor=${f == null ? "none" : (f * 100).toFixed(0) + "%"}|trail=${t == null ? "none" : t + "x"}|anchor=${t == null ? "—" : a}|time=${ts == null ? "none" : ts}`,
      s: { maxLossPct: f, atrStop: t, atrN: SHIPPED_STOPS.atrN, anchor: a, timeStopBars: ts, reentryBars: SHIPPED_STOPS.reentryBars },
    });
  }
  const shippedId = `floor=8%|trail=3x|anchor=high|time=none`;
  type Q3Row = { id: string; A: SleeveStats; B: SleeveStats; perCoinA: Record<string, number>; perCoinB: Record<string, number> };
  const q3Rows: Q3Row[] = [];
  for (const { id, s } of surfaces) {
    const out: Partial<Q3Row> = { id };
    for (const wname of ["A", "B"] as const) {
      const rs: ExecResult[] = [], per: Record<string, number> = {};
      for (const sym of STUDY_SYMBOLS) {
        const { c4h, daily, hourAt } = series[sym];
        const w = windowsFor(c4h.length).find((x) => x.name === wname)!;
        const r = exec(KIND, sym, c4h, daily, hourAt, w.oosFrom, w.oosTo, P, REVX, 4, s, SHIPPED_EXEC, null);
        rs.push(r); per[sym] = r4(r.ret);
      }
      if (wname === "A") { out.A = combineEqual(rs); out.perCoinA = per; } else { out.B = combineEqual(rs); out.perCoinB = per; }
    }
    q3Rows.push(out as Q3Row);
  }
  const byId = new Map(q3Rows.map((r) => [r.id, r]));
  const shipped3 = byId.get(shippedId)!;
  const rankIn = (rows: Q3Row[], w: "A" | "B", id: string) => rows.filter((r) => r[w].retOverDD > byId.get(id)![w].retOverDD).length + 1;
  // Choose on one window, score on the other — both directions, and by ret/DD as every prior study ranks.
  const bestOn = (w: "A" | "B") => q3Rows.slice().sort((x, y) => y[w].retOverDD - x[w].retOverDD)[0];
  const chosenOnB = bestOn("B"), chosenOnA = bestOn("A");
  const q3Passed = q3Rows.filter((r) => r.id !== shippedId && r.A.ret > shipped3.A.ret && r.B.ret > shipped3.B.ret).length;
  // The plateau: settings that beat the shipped pair on BOTH windows, and whether the shipped pair is
  // inside the neighbourhood of the ones that survive being chosen out of sample.
  const survivors = q3Rows.filter((r) => r.A.retOverDD > shipped3.A.retOverDD && r.B.retOverDD > shipped3.B.retOverDD).map((r) => r.id);
  // Choosing the single best setting on one window is one draw. The top-k on
  // the choosing window, each scored on the other, says whether the whole
  // NEIGHBOURHOOD survives or only its luckiest member.
  const topK = (chooseOn: "A" | "B", k: number) => {
    const scoreOn = chooseOn === "A" ? "B" : "A";
    const top = q3Rows.slice().sort((x, y) => y[chooseOn].retOverDD - x[chooseOn].retOverDD).slice(0, k);
    const scored = top.map((r) => r[scoreOn].retOverDD);
    return {
      k, ids: top.map((r) => r.id),
      medianScored: Number(median(scored).toFixed(2)), minScored: Math.min(...scored), maxScored: Math.max(...scored),
      allBeatShipped: scored.every((v) => v > shipped3[scoreOn].retOverDD),
      shippedOnScoredWindow: shipped3[scoreOn].retOverDD,
    };
  };
  const medOf = (w: "A" | "B", f: (r: Q3Row) => number) => Number(median(q3Rows.map(f)).toFixed(4));
  // One change at a time from the shipped pair — the ablation the report reads.
  const ABLATE = [
    "floor=8%|trail=3x|anchor=high|time=none", "floor=none|trail=3x|anchor=high|time=none",
    "floor=8%|trail=none|anchor=—|time=none", "floor=8%|trail=3x|anchor=entry|time=none",
    "floor=none|trail=none|anchor=—|time=none", "floor=10%|trail=none|anchor=—|time=none",
    "floor=8%|trail=4x|anchor=high|time=none", "floor=8%|trail=3x|anchor=high|time=10",
  ];
  const noStops = byId.get("floor=none|trail=none|anchor=—|time=none")!;
  report.q3 = {
    question: "floor × trail × anchor × time stop, CHOSEN on one window and SCORED on the other, both directions: does ANY setting survive, and is the shipped pair inside the plateau of the ones that do?",
    whatTheRulebookAlreadyDoes: "ruleDecision (_shared/agents_strategy.ts) ALREADY exits when the close falls below highWater − atrStop × ATR — a 3×ATR trail from the high since entry, evaluated at each bar CLOSE. The protective layer this question grids is therefore a SECOND copy of that trail, read against the bar's LOW instead of its close. That is the mechanism every number below is about: the shipped pair does not add protection the rule lacks, it adds a wick-sensitive version of protection the rule already has.",
    gridMedians: { A: { ret: medOf("A", (r) => r.A.ret), retOverDD: medOf("A", (r) => r.A.retOverDD) }, B: { ret: medOf("B", (r) => r.B.ret), retOverDD: medOf("B", (r) => r.B.retOverDD) } },
    shareOfGridBeatingShipped: {
      A: Number((q3Rows.filter((r) => r.A.retOverDD > shipped3.A.retOverDD).length / q3Rows.length).toFixed(3)),
      B: Number((q3Rows.filter((r) => r.B.retOverDD > shipped3.B.retOverDD).length / q3Rows.length).toFixed(3)),
    },
    maxDrawdownAnywhereInGrid: { A: Math.max(...q3Rows.map((r) => r.A.maxDD)), B: Math.max(...q3Rows.map((r) => r.B.maxDD)), barIs: 0.35 },
    ablation: ABLATE.map((id) => { const r = byId.get(id)!; return { id, retA: r.A.ret, ddA: r.A.maxDD, rdA: r.A.retOverDD, tradesA: r.A.trades, stopsA: r.A.stopsHit, retB: r.B.ret, ddB: r.B.maxDD, rdB: r.B.retOverDD, tradesB: r.B.trades, stopsB: r.B.stopsHit }; }),
    outOfSampleNeighbourhood: {
      note: "window B is the MIDDLE third and window A the LAST third, so choosing on B and scoring on A is a real walk-forward — B's data existed before A began. Choosing on A and scoring on B is the reverse and is LOOK-AHEAD; it is reported as a bound, not as a test.",
      chosenOnB_scoredOnA_walkForward: [1, 3, 5, 10].map((k) => topK("B", k)),
      chosenOnA_scoredOnB_lookAhead: [1, 3, 5, 10].map((k) => topK("A", k)),
    },
    perCoinNoProtectiveStops: { A: noStops.perCoinA, B: noStops.perCoinB },
    coinWindowsImprovedByDroppingProtectiveStops: {
      of: STUDY_SYMBOLS.length * 2,
      improved: STUDY_SYMBOLS.filter((sym) => noStops.perCoinA[sym] > shipped3.perCoinA[sym]).length
        + STUDY_SYMBOLS.filter((sym) => noStops.perCoinB[sym] > shipped3.perCoinB[sym]).length,
      worseIn: [
        ...STUDY_SYMBOLS.filter((sym) => noStops.perCoinA[sym] <= shipped3.perCoinA[sym]).map((sym) => `${sym} · A`),
        ...STUDY_SYMBOLS.filter((sym) => noStops.perCoinB[sym] <= shipped3.perCoinB[sym]).map((sym) => `${sym} · B`),
      ],
      note: "the shipped pair against no protective layer at all, coin by coin and window by window — a count, so that one coin cannot carry the finding",
    },
    grid: { floorsPct: FLOORS, trails: TRAILS, anchors: ANCHORS, timeStopBars: TIMESTOPS, settings: surfaces.length, note: "with no trail the anchor is meaningless, so those duplicates are dropped: 6 floors × (4 trails × 2 anchors + no trail) × 4 time stops" },
    shipped: {
      id: shippedId, A: shipped3.A, B: shipped3.B,
      rankByRetOverDD: { A: rankIn(q3Rows, "A", shippedId), B: rankIn(q3Rows, "B", shippedId), of: q3Rows.length },
      worseWindowRetOverDD: worse(shipped3.A.retOverDD, shipped3.B.retOverDD),
    },
    chosenOnBScoredOnA: {
      id: chosenOnB.id, chosenWindowRetOverDD: chosenOnB.B.retOverDD, scoredWindowRetOverDD: chosenOnB.A.retOverDD,
      scoredWindowRet: chosenOnB.A.ret, scoredWindowMaxDD: chosenOnB.A.maxDD,
      beatsShippedOnScoredWindow: chosenOnB.A.retOverDD > shipped3.A.retOverDD,
      rankOnScoredWindow: rankIn(q3Rows, "A", chosenOnB.id),
    },
    chosenOnAScoredOnB: {
      id: chosenOnA.id, chosenWindowRetOverDD: chosenOnA.A.retOverDD, scoredWindowRetOverDD: chosenOnA.B.retOverDD,
      scoredWindowRet: chosenOnA.B.ret, scoredWindowMaxDD: chosenOnA.B.maxDD,
      beatsShippedOnScoredWindow: chosenOnA.B.retOverDD > shipped3.B.retOverDD,
      rankOnScoredWindow: rankIn(q3Rows, "B", chosenOnA.id),
    },
    bestByWorseWindow: q3Rows.slice().sort((x, y) => worse(y.A.retOverDD, y.B.retOverDD) - worse(x.A.retOverDD, x.B.retOverDD)).slice(0, 12)
      .map((r) => ({ id: r.id, A: r.A.retOverDD, B: r.B.retOverDD, worse: worse(r.A.retOverDD, r.B.retOverDD), retA: r.A.ret, retB: r.B.ret, ddA: r.A.maxDD, ddB: r.B.maxDD, tradesA: r.A.trades, tradesB: r.B.trades })),
    survivorsBothWindows: { count: survivors.length, ids: survivors },
    all: q3Rows.map((r) => ({ id: r.id, retA: r.A.ret, ddA: r.A.maxDD, rdA: r.A.retOverDD, tradesA: r.A.trades, retB: r.B.ret, ddB: r.B.maxDD, rdB: r.B.retOverDD, tradesB: r.B.trades })),
    perCoinShipped: { A: shipped3.perCoinA, B: shipped3.perCoinB },
    perCoinChosenOnB: { A: chosenOnB.perCoinA, B: chosenOnB.perCoinB },
    control: control(q3Rows.length - 1, q3Passed),
  };
  console.log(`Q3: ${q3Rows.length} settings | shipped ranks ${rankIn(q3Rows, "A", shippedId)}/${q3Rows.length} in A and ${rankIn(q3Rows, "B", shippedId)}/${q3Rows.length} in B | chosen on B → A ${chosenOnB.A.retOverDD} (${chosenOnB.id}) | chosen on A → B ${chosenOnA.B.retOverDD} (${chosenOnA.id}) | ${q3Passed} beat the shipped pair on both`);

  // ═══════════════════════════════════════════════════ Q4 — scaling in and out
  type Q4Variant = { name: string; tr: Tranches | null; what: string };
  const q4Variants: Q4Variant[] = [
    { name: "all-in / all-out (shipped)", tr: null, what: "one order in, one order out" },
    { name: "in 2 on pullback 0.5×ATR", tr: { entryFracs: [0.5, 0.5], trigger: "pullback", triggerAtr: 0.5, targetFrac: null, targetAtr: null }, what: "half at the signal, half if it comes back half an ATR" },
    { name: "in 2 on pullback 1×ATR", tr: { entryFracs: [0.5, 0.5], trigger: "pullback", triggerAtr: 1, targetFrac: null, targetAtr: null }, what: "half at the signal, half one ATR lower" },
    { name: "in 3 on pullback 0.5×ATR", tr: { entryFracs: [1 / 3, 1 / 3, 1 / 3], trigger: "pullback", triggerAtr: 0.5, targetFrac: null, targetAtr: null }, what: "thirds, each half an ATR lower" },
    { name: "in 2 on breakout 1×ATR (pyramid)", tr: { entryFracs: [0.5, 0.5], trigger: "breakout", triggerAtr: 1, targetFrac: null, targetAtr: null }, what: "half at the signal, half added one ATR higher — adding to a winner" },
    { name: "in 3 on breakout 1×ATR (pyramid)", tr: { entryFracs: [1 / 3, 1 / 3, 1 / 3], trigger: "breakout", triggerAtr: 1, targetFrac: null, targetAtr: null }, what: "thirds, each an ATR higher" },
    { name: "in 3 on breakout 0.5×ATR (pyramid)", tr: { entryFracs: [1 / 3, 1 / 3, 1 / 3], trigger: "breakout", triggerAtr: 0.5, targetFrac: null, targetAtr: null }, what: "thirds, each half an ATR higher" },
    { name: "in 1, out half at 2×ATR", tr: { entryFracs: [1], trigger: "pullback", triggerAtr: 1, targetFrac: 0.5, targetAtr: 2 }, what: "one order in; half out at a two-ATR profit target, the rest on the rule" },
    { name: "in 1, out half at 3×ATR", tr: { entryFracs: [1], trigger: "pullback", triggerAtr: 1, targetFrac: 0.5, targetAtr: 3 }, what: "half out at three ATR" },
    { name: "in 1, out a third at 2×ATR", tr: { entryFracs: [1], trigger: "pullback", triggerAtr: 1, targetFrac: 1 / 3, targetAtr: 2 }, what: "a third out at two ATR" },
    { name: "in 2 pullback 0.5, out half at 2×ATR", tr: { entryFracs: [0.5, 0.5], trigger: "pullback", triggerAtr: 0.5, targetFrac: 0.5, targetAtr: 2 }, what: "scaled both ways" },
    { name: "in 2 breakout 1, out half at 3×ATR", tr: { entryFracs: [0.5, 0.5], trigger: "breakout", triggerAtr: 1, targetFrac: 0.5, targetAtr: 3 }, what: "pyramid in, scale out" },
  ];
  const q4Rows = q4Variants.map((v) => {
    const out: Record<string, unknown> = { variant: v.name, what: v.what, tranches: v.tr };
    let smallest = Infinity;
    for (const wname of ["A", "B"] as const) {
      const rs: ExecResult[] = [], per: Record<string, ReturnType<typeof pick>> = {};
      for (const s of STUDY_SYMBOLS) {
        const { c4h, daily, hourAt } = series[s];
        const w = windowsFor(c4h.length).find((x) => x.name === wname)!;
        const r = exec(KIND, s, c4h, daily, hourAt, w.oosFrom, w.oosTo, P, REVX, 4, SHIPPED_SURFACE, SHIPPED_EXEC, v.tr);
        rs.push(r); per[s] = pick(r);
        if (r.minOrderFrac > 0) smallest = Math.min(smallest, r.minOrderFrac);
      }
      out[wname] = combineEqual(rs); out[`perCoin${wname}`] = per;
    }
    // Legality: the smallest ORDER this variant places, as a share of the slot, in dollars at $20.
    const smallestUsd = Number((Number.isFinite(smallest) ? smallest : 0) * SLOT_USD).toFixed(4);
    const planned = v.tr ? Math.min(...v.tr.entryFracs, ...(v.tr.targetFrac != null ? [v.tr.targetFrac, 1 - v.tr.targetFrac] : [1])) : 1;
    out.legality = {
      smallestPlannedOrderUsd: Number((planned * SLOT_USD).toFixed(4)),
      smallestObservedOrderUsd: Number(smallestUsd),
      revxLegalMajors: planned * SLOT_USD >= 0.10,
      revxLegalAvaxSui: "unmeasured — §2.1 read min_order_size_quote for BTC/ETH/SOL only",
      krakenLegalCostmin: planned * SLOT_USD >= KRAKEN_COSTMIN_USD,
      krakenLegalOrderminWorstCase: planned * SLOT_USD >= KRAKEN_ORDERMIN_USD_RANGE[1],
    };
    return out;
  });
  const base4A = (q4Rows[0].A as SleeveStats), base4B = (q4Rows[0].B as SleeveStats);
  const q4Passed = q4Rows.slice(1).filter((r) => (r.A as SleeveStats).ret > base4A.ret && (r.B as SleeveStats).ret > base4B.ret).length;
  report.q4 = {
    question: "Each coin's $20 slot goes in as one order and out as one order. Does entering or exiting in tranches, or pyramiding a winner, beat that on the worse window — and is each tranche a legal order at this size?",
    rows: q4Rows,
    rankedByWorseWindow: q4Rows.map((r) => ({ variant: r.variant, A: (r.A as SleeveStats).retOverDD, B: (r.B as SleeveStats).retOverDD, worse: worse((r.A as SleeveStats).retOverDD, (r.B as SleeveStats).retOverDD), turnoverA: (r.A as SleeveStats).turnoverPerYear, turnoverB: (r.B as SleeveStats).turnoverPerYear, feesA: (r.A as SleeveStats).feesUsd, feesB: (r.B as SleeveStats).feesUsd }))
      .sort((a, b) => b.worse - a.worse),
    control: control(q4Rows.length - 1, q4Passed),
  };
  for (const r of q4Rows) console.log(`Q4 ${String(r.variant).padEnd(34)} A ${((r.A as SleeveStats).ret * 100).toFixed(2)}% / ${(r.A as SleeveStats).retOverDD} | B ${((r.B as SleeveStats).ret * 100).toFixed(2)}% / ${(r.B as SleeveStats).retOverDD} | fees $${(r.A as SleeveStats).feesUsd.toFixed(3)} / $${(r.B as SleeveStats).feesUsd.toFixed(3)}`);

  // ═══════════════════════════════════════════════════════ Q5 — the interaction
  // The best answer to each question by the WORSE of its two windows, then the
  // combinations, scored against the shipped configuration on both windows.
  const bestCooldown = report.q2 as Record<string, unknown>;
  const q2Worse = (bestCooldown.worseWindow as { reentryBars: number; worseRetOverDD: number }[]).slice().sort((a, b) => b.worseRetOverDD - a.worseRetOverDD)[0];
  const q3Worse = (report.q3 as Record<string, unknown>).bestByWorseWindow as { id: string; worse: number }[];
  const q3Best = surfaces.find((x) => x.id === q3Worse[0].id)!;
  const q4Ranked = (report.q4 as Record<string, unknown>).rankedByWorseWindow as { variant: string; worse: number }[];
  const q4Best = q4Variants.find((v) => v.name === q4Ranked[0].variant)!;
  const q1Ranked = q1Table.slice().filter((x) => x.arm !== "taker (shipped)").sort((a, b) => b.worseWindowRetOverDD - a.worseWindowRetOverDD)[0];
  const q1BestArm = q1Arms(SHIPPED_FILL).find((a) => a.name === q1Ranked.arm)!;

  type Combo = { name: string; ex: ExecParams; s: StopSurface; tr: Tranches | null };
  /** The conservative reading of Q3: a floor kept as the disaster brake, the intrabar trail dropped. */
  const CONSERVATIVE: StopSurface = { ...SHIPPED_SURFACE, maxLossPct: 0.10, atrStop: null };
  const combos: Combo[] = [
    { name: "shipped", ex: SHIPPED_EXEC, s: SHIPPED_SURFACE, tr: null },
    { name: `Q2 best (reentryBars=${q2Worse.reentryBars})`, ex: SHIPPED_EXEC, s: { ...SHIPPED_SURFACE, reentryBars: q2Worse.reentryBars }, tr: null },
    { name: `Q3 best (${q3Best.id})`, ex: SHIPPED_EXEC, s: q3Best.s, tr: null },
    { name: `Q4 best (${q4Best.name})`, ex: SHIPPED_EXEC, s: SHIPPED_SURFACE, tr: q4Best.tr },
    { name: `Q1 best (${q1BestArm.name})`, ex: q1BestArm.exec, s: SHIPPED_SURFACE, tr: null },
    { name: "Q2+Q3", ex: SHIPPED_EXEC, s: { ...q3Best.s, reentryBars: q2Worse.reentryBars }, tr: null },
    { name: "Q2+Q4", ex: SHIPPED_EXEC, s: { ...SHIPPED_SURFACE, reentryBars: q2Worse.reentryBars }, tr: q4Best.tr },
    { name: "Q3+Q4", ex: SHIPPED_EXEC, s: q3Best.s, tr: q4Best.tr },
    { name: "Q2+Q3+Q4", ex: SHIPPED_EXEC, s: { ...q3Best.s, reentryBars: q2Worse.reentryBars }, tr: q4Best.tr },
    { name: "Q1+Q2+Q3+Q4 (everything)", ex: q1BestArm.exec, s: { ...q3Best.s, reentryBars: q2Worse.reentryBars }, tr: q4Best.tr },
    // The one combination chosen WITHOUT looking at window A: the stop surface picked on
    // window B alone, everything else left exactly as it ships. Window A is then a genuine
    // out-of-sample score for it, which no other row in this table can claim.
    { name: "Q3 chosen on window B only (walk-forward), rest shipped", ex: SHIPPED_EXEC, s: surfaces.find((x) => x.id === chosenOnB.id)!.s, tr: null },
    // And the conservative reading of Q3: keep a floor as the disaster brake, drop the
    // intrabar trail the rulebook already duplicates at the close.
    { name: "conservative: 10 % floor, no intrabar trail, rest shipped", ex: SHIPPED_EXEC, s: CONSERVATIVE, tr: null },
    // Q1 ON TOP of that — the interaction that matters most. Most of the maker arms' window-A
    // gain is a lower entry price keeping the position out of a pathological stop; once the stop
    // is fixed, what is LEFT of the maker edge is the honest answer to Q1.
    { name: "conservative + maker entries and rule exits (rest-1h-cancel)", ex: q1Arms(SHIPPED_FILL).find((a) => a.name === "rest-1h-cancel")!.exec, s: CONSERVATIVE, tr: null },
    { name: "conservative + maker everything including the stop", ex: q1Arms(SHIPPED_FILL).find((a) => a.name === "rest-1h-cancel-makerStop")!.exec, s: CONSERVATIVE, tr: null },
    { name: "conservative + pyramid (Q4 best)", ex: SHIPPED_EXEC, s: CONSERVATIVE, tr: q4Best.tr },
    { name: `conservative + reentryBars=${q2Worse.reentryBars}`, ex: SHIPPED_EXEC, s: { ...CONSERVATIVE, reentryBars: q2Worse.reentryBars }, tr: null },
  ];
  const q5Rows = combos.map((c) => {
    const out: Record<string, unknown> = { combo: c.name };
    for (const wname of ["A", "B"] as const) {
      const rs: ExecResult[] = [], per: Record<string, ReturnType<typeof pick>> = {};
      for (const s of STUDY_SYMBOLS) {
        const { c4h, daily, hourAt } = series[s];
        const w = windowsFor(c4h.length).find((x) => x.name === wname)!;
        const r = exec(KIND, s, c4h, daily, hourAt, w.oosFrom, w.oosTo, P, REVX, 4, c.s, c.ex, c.tr);
        rs.push(r); per[s] = pick(r);
      }
      out[wname] = combineEqual(rs); out[`perCoin${wname}`] = per;
    }
    return out;
  });
  const base5A = q5Rows[0].A as SleeveStats, base5B = q5Rows[0].B as SleeveStats;
  const q5Passed = q5Rows.slice(1).filter((r) => (r.A as SleeveStats).ret > base5A.ret && (r.B as SleeveStats).ret > base5B.ret).length;
  // The control for the WHOLE study: every arm looked at anywhere in it.
  const totalArms = (q1Table.length - 1) + (COOLDOWNS.length - 1) + (q3Rows.length - 1) + (q4Rows.length - 1) + (q5Rows.length - 1);
  const totalPassed = (q1.control as Control).passedBothWindows + q2Passed + q3Passed + q4Passed + q5Passed;
  report.q5 = {
    question: "The best answers to Q2, Q3 and Q4 are not independent. Does the combination beat the shipped configuration on both windows, and does it survive the multiple-comparisons control?",
    chosenFromEachQuestion: { q1: q1BestArm.name, q2: q2Worse.reentryBars, q3: q3Best.id, q4: q4Best.name, note: "each is the arm with the best WORSE window in its own search — and each was chosen on the same two windows it is scored on here, which is what the control below exists to price" },
    rows: q5Rows,
    rankedByWorseWindow: q5Rows.map((r) => ({ combo: r.combo, A: (r.A as SleeveStats).retOverDD, B: (r.B as SleeveStats).retOverDD, worse: worse((r.A as SleeveStats).retOverDD, (r.B as SleeveStats).retOverDD), retA: (r.A as SleeveStats).ret, retB: (r.B as SleeveStats).ret, ddA: (r.A as SleeveStats).maxDD, ddB: (r.B as SleeveStats).maxDD }))
      .sort((a, b) => b.worse - a.worse),
    control: control(q5Rows.length - 1, q5Passed),
    studyWideControl: { ...control(totalArms, totalPassed), note: "every arm looked at anywhere in this study — Q1's execution arms, Q2's cooldowns, Q3's stop surfaces, Q4's tranche variants and Q5's combinations — against the shipped configuration on both windows. This is the number that decides whether anything here is a finding or a search artefact." },
  };
  for (const r of q5Rows) console.log(`Q5 ${String(r.combo).padEnd(40)} A ${((r.A as SleeveStats).ret * 100).toFixed(2)}% / ${(r.A as SleeveStats).retOverDD} | B ${((r.B as SleeveStats).ret * 100).toFixed(2)}% / ${(r.B as SleeveStats).retOverDD}`);
  console.log(`study-wide control: ${totalPassed} of ${totalArms} arms beat the shipped configuration on both windows; a coin-flip null gives ${(totalArms * 0.25).toFixed(1)}`);

  await Deno.writeTextFile(`${outDir}/execution.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/execution.json in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
}
