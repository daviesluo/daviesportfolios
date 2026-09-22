// The SET study — the live row's four settled choices, re-asked on FOUR
// windows and BOTH price series. A study, not a rulebook. Run by hand:
//
//   deno run --allow-read --allow-write \
//     supabase/functions/agents/backtest_set2.ts \
//     --data  <dir with BTC-USD_1h_3y.json …>      (Coinbase Exchange hourly)
//     --ext   <dir with BTC-USD_1h_kraken.json …>  (Kraken quarterly bundle, hourly)
//     --ktape <dir with BTC-USD_4h_kraken.json …>  (Kraken's own 4h tape, full span)
//     --rtape <dir with BTC-USD_4h_revx.json …>    (Revolut X's own UK book, one year)
//     --tape  docs/agents/backtests/tape.json      (optional cross-check)
//     --out   docs/agents/backtests
//
// Writes `<out>/set2.json` and NOTHING else; `latest.json`, `summary.json`,
// `windows.json`, `tape.json`, `testingset.json` and every other study's file
// are untouched.
//
// ── why it exists ─────────────────────────────────────────────────────
//
// Three of the live row's four defining choices were settled on TWO
// walk-forward windows and ONE price series:
//
//   * which coins        — §3.7, §3.8, §3.11 point 5's leave-one-out;
//   * equal slots        — §3.11 point 1, seven weighting arms;
//   * the mechanics      — §3.13, the cooldown, all-in/all-out, the stop surface;
//   * Kraken runs no real money — §3.11 point 3, §3.12, §3.14.
//
// There are now FOUR windows (§3.15: A bear, B bull, C stronger bull, D
// sideways) and a second price series (§3.16: Kraken's own tape, the one
// `signal_venue` makes the loop read). §3.16 is the reason to re-ask rather
// than to assume: swapping the tape moves a single coin's bear-year return by
// up to THIRTY points and flips §4.15's verdict on 5.9 % of coin-windows,
// while moving the five-coin sleeve by about one point — and every one of
// those settled answers was a per-coin or per-arm comparison, decided at
// exactly the level §3.16 showed is least stable.
//
// The prior is therefore that NOTHING changes, and the multiple-comparisons
// control on every search below is what defends it. This is a large search
// over choices that were already made.
//
// ── the four questions ────────────────────────────────────────────────
//
//   A1  the coins — leave-one-out on the live row, AND the add direction:
//       every coin in the priced universe with the history, added as a sixth
//       slot. A coin only counts as a change if it improves the sleeve on the
//       WORST window under BOTH tapes and BOTH stop rules.
//   A2  the weights — §3.11's seven arms on four windows and both tapes, plus
//       one arm §3.11 did not have: weighting by the number of windows a coin
//       clears, which is the natural thing to try and which §3.15 predicts
//       will fail.
//   A3  the mechanics — the re-entry cooldown (0–8), all-in/all-out against
//       tranches and pyramiding, and the stop surface (floor 6/8/10/12/15/none
//       now that the intra-bar ATR trail is gone, × a time stop). The question
//       is not "does anything fix window D" — §3.17 answered that, 0 of 33
//       gates — but "does any of these three settings look different once D is
//       in the ranking".
//   A4  the venue — asked ONE way only, because it has been asked three times
//       and answered no three times: is there ANY coin, on four windows and
//       both tapes, whose Kraken figure beats its Revolut X figure on the
//       worst window?
//
// ── the third tape, and where it is allowed to matter ─────────────────
//
// Revolut X's own UK book turns out to be PUBLIC and keyless
// (`GET /1.0/public/candles/{SYM}?interval=240&region=UK`; `region=UK` is
// §4.14's requirement — without it the endpoint serves the EEA book this
// account cannot trade) and it is ONE YEAR long: 2,257 four-hour bars from
// 2025-09-11. That corrects two claims in the reference — §2.3's "three years
// of hourly history" and §3.16's "unreachable from a harness" — and leaves
// `backtest.ts`'s own header, one year, right.
//
// One year reaches window A and nothing before it. So the two-tape backbone
// above is unchanged across all four windows, and the venue's own book is added
// as a THIRD tape on window A alone, wherever a verdict in the bear year is
// load-bearing: A1's leave-one-out and add-one-in, A2's weighting arms, A4's
// venue question. It is not applied to A3's mechanics and it is not a fourth
// dimension anywhere. §3.16 showed the per-coin verdict is unstable across tapes
// without being able to say which tape is RIGHT; on window A one of the three
// now IS the book the orders would meet, so a choice that survives on all three
// is a materially stronger statement — and a choice that does not is the more
// important finding and is reported as one. How the one-day shortfall at the
// start of the window, the ~100 bars of warm-up and the two coins with gaps are
// handled is in `a0_theThirdTape`, counted rather than waved through.
//
// ── what is imported and what is copied ───────────────────────────────
//
// `backtest.ts`'s `run`, `resample`, `COSTS`, `SHIPPED_STOPS`, `stopsForKind`
// and `spreadOf`, and the live rulebooks in `_shared/agents_strategy.ts`, are
// IMPORTED. Nothing that costs money is re-implemented.
//
// ONE copy exists, `runSet`, taken from `run` LINE BY LINE, and it adds four
// things `run` cannot express — each of them something a question above
// varies, and nothing else:
//
//   * a mark at EVERY bar, plus the traded weight and an open flag, which the
//     sleeve arithmetic reads. `run` samples its curve every sixth bar and
//     WHICH bar that is depends on where the array starts — which is exactly
//     what differs between the two tapes (§3.16's own reason for `runMarked`);
//   * a per-entry WEIGHT ∈ (0, 1], with the rest left in cash (A2's per-entry
//     volatility arm), and the entry ATR and binding stop distance the
//     inverse-volatility and equal-risk arms size on;
//   * TRANCHES — entering in pieces, pyramiding, and a partial profit target
//     (A3's sizing question), copied from `backtest_execution.ts`'s `runExec`;
//   * a NULLABLE floor and a TIME stop, neither of which `StopParams` carries
//     (A3's stop surface).
//
// With the weight null, the tranches null and the surface set to the stop rule
// being priced, `runSet` IS `run`. `fidelity.runSet` is the proof, and it is
// run THREE ways — the null branch, a weight function that always returns 1,
// and a one-tranche plan — because a study whose only check is the null branch
// has not checked the branch it actually uses.
//
// `combine`, `dailyMarks`, `dailyReturns`, `plateauOf`, `barTests`,
// `windowsOn`, `tapeAgreement`, `intersectionDistribution`, `signTest`,
// `binomTail` and the correlation helpers are copied from
// `backtest_tape.ts` / `backtest_windows.ts` / `backtest_portfolio.ts` /
// `backtest_execution.ts`, which do not export them: they do arithmetic on
// OUTPUTS or on calendars and touch no price, no fee and no fill.
//
// ── the rules of the study ────────────────────────────────────────────
//
// Four windows, never averaged; an arm is ranked by the WORST window it has.
// Parameters are chosen on data strictly BEFORE the window they are scored on.
// Both tapes and both stop rules are priced and never averaged. Every search
// reports how many arms it looked at and what a null expects, stated exactly
// rather than sampled.
//
// ── determinism ───────────────────────────────────────────────────────
//
// There is no `ran_at` field and no runtime field anywhere in the output.
// Re-running over the same three data directories writes `set2.json` byte for
// byte identical; the run is recorded by the data provenance block rather than
// by a wall clock. `backtest.ts` is SHA-256'd at the start and the end of the
// run and the hash is written into the output, so a run that straddles an edit
// throws.

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
/** The live row's exposure cap (`agent_risk.max_exposure_usd`). */
const MAX_EXPOSURE_USD_LIVE = 100;

/** The live recommendation, reference §3.11 question 6, §3.17 S4 and `docs/agents/go-live.md`. */
const LIVE_ROW = { row: "trend-4h", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100 };
/** The second Revolut X rulebook, kept in paper by `0043` — priced here on both tapes for A5. */
const MOMENTUM_ROW = { row: "momentum-1d", venue: "revx" as const, symbols: ["BTC/USD", "ETH/USD", "SOL/USD"], capitalUsd: 40 };

/** The overlap test `backtest_windows.ts` declared before it compared the two sources, kept identical here. */
const OVERLAP_MEDIAN_MAX_BPS = 25;
const OVERLAP_P95_MAX_BPS = 100;
/** A window is only scored when its in-sample has at least this many days to choose on. Same floor as §3.15 / §3.16. */
const MIN_IN_SAMPLE_DAYS = 180;
/** The floor plus the 3×ATR(14) intra-bar trail — what §3.7 / §3.8 / §3.10 / §3.11 were computed under. */
const PINNED_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };
/** The widest lookback any grid point uses (slow 150 + breakout 55 + slack), as §3.15 / §3.16 set it. */
const MAX_LOOKBACK = 301;
/**
 * The THIRD tape's acceptance rule, written down before any number on it was
 * looked at. Revolut X's own UK book is public and keyless
 * (`GET /1.0/public/candles/{SYM}?interval=240&region=UK` — `region=UK` is
 * §4.14's requirement; without it the endpoint serves the EEA book this account
 * cannot trade) and it is ONE YEAR long: 2,257 four-hour bars, 2025-09-11 →
 * 2026-09-22. That reaches window A and nothing else, so it is added as a third
 * tape on window A ONLY and is never a fourth dimension anywhere else.
 *
 * A coin's window A is priced on this tape only when at least this share of the
 * window's scored 4-hour bars comes from Revolut X's own tape rather than from
 * the Kraken bars spliced in front of it for warm-up.
 */
const REVX_MIN_WINDOW_COVERAGE = 0.95;

// ───────────────────────────────────────────────────────────── the simulator

/**
 * `StopParams` widened by the two things A3 varies that it cannot carry: a
 * NULLABLE floor and a TIME stop. With the floor and trail of the stop rule
 * being priced and `timeStopBars: null` it is that rule exactly, and `runSet`
 * computes the levels `run` computes.
 */
type Surface = {
  maxLossPct: number | null;   // the hard floor under average cost; null = no floor
  atrStop: number | null;      // the intra-bar ATR trail multiple; null = no trail (what tick.ts runs)
  atrN: number;
  timeStopBars: number | null; // leave after this many of the rule's own bars, at a bar close
  reentryBars: number;
};
function surfaceOf(s: StopParams, over: Partial<Surface> = {}): Surface {
  return { maxLossPct: s.maxLossPct, atrStop: s.atrStop, atrN: s.atrN, timeStopBars: null, reentryBars: s.reentryBars, ...over };
}

/**
 * A3's sizing, copied from `backtest_execution.ts`'s `Tranches`. `entryFracs`
 * sums to 1 and is spent out of the slot the entry decision saw: the first
 * tranche goes at the signal, the rest wait for a trigger `triggerAtr` × ATR(14)
 * below the first fill (`pullback` — scaling into weakness) or above it
 * (`breakout` — pyramiding a winner). `targetFrac` of the position is sold when
 * the price reaches `targetAtr` × ATR above the first fill; the remainder leaves
 * on the rule or a stop, as always.
 */
type Tranches = {
  entryFracs: number[];
  trigger: "pullback" | "breakout";
  triggerAtr: number;
  targetFrac: number | null;
  targetAtr: number | null;
};

type SetResult = RunResult & {
  /** The mark at EVERY bar, so a day's mark does not depend on where the array starts. */
  marks: [number, number][];
  /** [bar start, 1 when the sleeve held a position over that bar] — what the exposure cap sees. */
  openFlags: [number, number][];
  /** Σ over fills of the notional traded in units of the slot (an entry and an exit each count once at weight 1). */
  tradedWeight: number;
  /** ATR(14) as a share of the close at each entry decision, in order — the inverse-volatility arm sizes on this. */
  entryAtrPct: number[];
  /** The BINDING stop distance at each entry: min(floor, atrStop × ATR / close) — the equal-risk arm sizes on this. */
  entryStopPct: number[];
  /** The smallest order this arm placed, as a fraction of the slot — A3's legality test reads it. */
  minOrderFrac: number;
};

/**
 * `backtest.ts`'s `run`, copied line by line, with four things added behind
 * flags. Everything that costs money is `run`'s: the entry and rule exit at the
 * next bar's open ± the half-spread paying `fillFee`; the floor under average
 * cost and the ATR trail from the high since entry, read against the next bar's
 * low and filled at the level (or the open when the bar gaps through it); the
 * high-water mark advanced by each bar's high; the cooldown after ANY exit; and
 * the same return, drawdown, trade-count, exposure and day arithmetic.
 *
 * With `weight` null, `tr` null and `stops` the surface of the stop rule being
 * priced, it IS `run`, and `fidelity.runSet` is the proof, not the claim.
 */
function runSet(
  kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], from: number, to: number,
  p: TrendParams, costs: Costs, barHours: number,
  stops: Surface | null, weight: ((i: number) => number) | null, tr: Tranches | null,
): SetResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  const barMs = barHours * 3600e3;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  let tradedWeight = 0, minOrderFrac = Infinity;
  const entryAtrPct: number[] = [], entryStopPct: number[] = [];
  const marks: [number, number][] = [], openFlags: [number, number][] = [];
  const pre = precompute(bars, p);
  let dk = 0; // daily candles closed at or before the current bar (moves forward only), exactly as `run` keeps it
  // Tranche bookkeeping, copied from `runExec`. `slotCash` is the equity the entry decision saw, so each
  // tranche is a fixed share of the same slot rather than of whatever happens to be left.
  let entryBar = -1, firstFill = 0, entryAtr = 0, slotCash = 0, trancheIdx = 0, targetTaken = false;

  const buy = (ts: number, spend: number, price: number, feeRate: number) => {
    const base = spend / (price * (1 + feeRate));     // the fee comes out of the same cash
    const fee = base * price * feeRate;
    minOrderFrac = Math.min(minOrderFrac, spend);
    pos = applyFill(pos, { ts, side: "buy", base, price, feeUsd: fee });
    cash -= spend; trades++; tradedWeight += spend;
  };
  const sell = (ts: number, base: number, price: number, feeRate: number, barIdx: number) => {
    const fee = base * price * feeRate;
    minOrderFrac = Math.min(minOrderFrac, base * price);
    cash += base * price - fee;
    pos = applyFill(pos, { ts, side: "sell", base, price, feeUsd: fee });
    trades++; tradedWeight += base * price;
    if (pos.base <= 0) lastExitBar = barIdx;
  };

  const start = Math.max(from, p.slow + 1);
  for (let i = start; i < to - 1; i++) {
    const next = bars[i + 1];
    let acted = false;   // a FILL happened this bar — `run` never checks a stop on a bar it traded

    // ── 1. the rule, on the closed bar ───────────────────────────────────
    while (dk < daily.length && daily[dk].start + 86400e3 <= bars[i].start + barMs) dk++;
    const snap = buildSnapshot(symbol, bars, i, daily.slice(0, dk), pos, bars[i].start + barMs, p, pre, (24 / barHours) * 365);
    let action = ruleFor(kind, snap, pos, p).action;
    // A time stop is a bar-close decision, like any rule exit — never an intrabar level.
    if (stops?.timeStopBars != null && pos.base > 0 && action !== "exit" && entryBar >= 0 && i + 1 - entryBar >= stops.timeStopBars) action = "exit";
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;

    if (action === "enter" && pos.base === 0 && !coolingDown) {
      const w = weight ? Math.max(0, Math.min(1, weight(i))) : 1;
      slotCash = cash * w;
      const spend = slotCash * (tr ? tr.entryFracs[0] : 1);
      if (spend > 0) {
        const price = next.open * (1 + hs);                    // the touch, at the next open
        buy(next.start, spend, price, fill);
        const a = atrAt(bars, i, stops?.atrN ?? SHIPPED_STOPS.atrN);
        if (a != null) {
          entryAtrPct.push(a / bars[i].close);
          const trailPct = stops?.atrStop != null ? stops.atrStop * a / bars[i].close : Infinity;
          entryStopPct.push(Math.min(stops?.maxLossPct ?? SHIPPED_STOPS.maxLossPct, trailPct));
        }
        entryBar = i + 1; firstFill = price; entryAtr = a ?? 0; trancheIdx = 1; targetTaken = false;
        acted = true;
      }
    } else if (action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      sell(next.start, pos.base, price, fill, i + 1);
      acted = true;
    }

    // ── 2. the protective exits, read against the bar's low ──────────────
    if (stops && pos.base > 0 && !acted) {
      const hw = Math.max(pos.highWater ?? pos.avgCost, pos.avgCost);
      const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
      const floor = stops.maxLossPct != null ? pos.avgCost * (1 - stops.maxLossPct) : -Infinity;
      const trail = stops.atrStop != null && atr != null ? hw - stops.atrStop * atr : -Infinity;
      const level = Math.max(floor, trail);
      if (level > -Infinity && next.low <= level) {
        const price = Math.min(level, next.open) * (1 - hs);
        sell(next.start, pos.base, price, stopFee, i + 1);
        stopsHit++; acted = true;
      }
    }

    // ── 3. the tranches: the adds and the profit target, while long and nothing else happened ──
    if (tr && pos.base > 0 && !acted) {
      if (trancheIdx < tr.entryFracs.length && entryAtr > 0) {
        const step = tr.triggerAtr * entryAtr * trancheIdx;
        const trigger = tr.trigger === "pullback" ? firstFill - step : firstFill + step;
        const hit = tr.trigger === "pullback" ? next.low <= trigger : next.high >= trigger;
        // A pullback add is a resting limit and is charged at its own level; a breakout add is a stop-buy
        // and takes `run`'s gap-through convention — the level, or the open when the bar gapped past it.
        const raw = tr.trigger === "pullback" ? trigger : Math.max(trigger, next.open);
        const spend = slotCash * tr.entryFracs[trancheIdx];
        if (hit && trigger > 0 && spend > 0 && spend <= cash + 1e-12) {
          buy(next.start, spend, raw * (1 + hs), fill);
          trancheIdx++; acted = true;
        }
      }
      if (!acted && !targetTaken && tr.targetFrac != null && tr.targetAtr != null && entryAtr > 0) {
        const target = firstFill + tr.targetAtr * entryAtr;
        if (next.high >= target) {
          sell(next.start, pos.base * tr.targetFrac, target * (1 - hs), fill, i + 1);
          targetTaken = true; acted = true;
        }
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
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit,
    marks, openFlags, tradedWeight, entryAtrPct, entryStopPct,
    minOrderFrac: Number.isFinite(minOrderFrac) ? minOrderFrac : 0,
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

// ─────────────────────────────────────────────── the exact chance arithmetic

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
/**
 * The exact two-sided sign test: under "the two arms are exchangeable" each
 * non-zero difference is a fair coin, so the count of positives is
 * Binomial(m, ½) and the p-value is the total mass of outcomes no more likely
 * than the one observed. Copied from `backtest_tape.ts`; computed exactly.
 */
function signTest(pos: number, neg: number): { positives: number; negatives: number; pTwoSided: number } {
  const m = pos + neg;
  if (m === 0) return { positives: pos, negatives: neg, pTwoSided: 1 };
  const k = Math.min(pos, neg);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(m, i) - m * Math.LN2);
  // One deviation from the copy: three significant figures rather than six decimals, so a p of 1e-100 is
  // reported as 1e-100 rather than as 0. Deterministic either way.
  return { positives: pos, negatives: neg, pTwoSided: Number(Math.min(1, 2 * tail).toPrecision(3)) };
}

/**
 * The control every search in this file reports. An arm "passes" when it beats
 * the incumbent on the WORST window in every one of `conditions` near-duplicate
 * evaluations (here: two tapes × two stop rules = 4).
 *
 * Two nulls are stated, and the truth is between them, because the four
 * evaluations are neither independent nor identical:
 *   * `independent` — each evaluation is a fair coin, so E[passes] = arms × ½^k
 *     and the tail is Binomial(arms, ½^k). This is the OPTIMISTIC null: it
 *     treats four near-duplicate scorings as four separate tests, so it makes a
 *     pass look rarer than it is.
 *   * `fullyCorrelated` — the four evaluations move together, so passing all
 *     four is one coin flip: E[passes] = arms × ½. This is the CONSERVATIVE
 *     null and the one to quote when nothing passes, because it is the hardest
 *     for "nothing changed" to clear.
 * Expectations are exact under each null however correlated the ARMS are
 * (linearity); the tails additionally assume the arms are independent, which
 * variants of one row are not, so a tail is a floor and not a p-value.
 */
type Control = {
  armsLookedAt: number; passed: number; conditions: number;
  expectedByChanceIndependent: number; expectedByChanceFullyCorrelated: number;
  pAtLeastThatManyIndependent: number; pAtLeastThatManyFullyCorrelated: number;
  note: string;
};
function control(arms: number, passed: number, conditions: number): Control {
  const pi = Math.pow(0.5, conditions);
  return {
    armsLookedAt: arms, passed, conditions,
    expectedByChanceIndependent: Number((arms * pi).toFixed(3)),
    expectedByChanceFullyCorrelated: Number((arms * 0.5).toFixed(3)),
    pAtLeastThatManyIndependent: Number(binomTail(arms, passed, pi).toPrecision(3)),
    pAtLeastThatManyFullyCorrelated: Number(binomTail(arms, passed, 0.5).toPrecision(3)),
    note: `an arm passes only by beating the incumbent on the WORST window in all ${conditions} evaluations (tape × stop rule); the two expectations bracket the truth because those ${conditions} evaluations are near-duplicates, not independent tests; tails assume independent ARMS, which variants of one row are not, so they are floors`,
  };
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

type WinName = "A" | "B" | "C" | "D";
type Win = {
  name: WinName;
  isSeries: "coinbase" | "combined";
  isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  isDays: number; oosDays: number; isFromIso: string; oosFromIso: string; oosToIso: string;
  scored: boolean; why: string;
};

const YEAR_MS = 365 * 86400e3;

/** The four windows, identical to `backtest_windows.ts` / `backtest_tape.ts` — the same cuts, floor and names. */
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

/**
 * Calendar order of the four windows, OLDEST first — D (the year before the
 * series), C (the first third), B (the middle third), A (the last third). Every
 * "prior evidence" arm in A2 reads this and nothing else, so no weight is ever
 * computed on data the scored window had not yet produced.
 */
const CALENDAR_ORDER: WinName[] = ["D", "C", "B", "A"];
const priorWindowsOf = (w: WinName): WinName[] => CALENDAR_ORDER.slice(0, CALENDAR_ORDER.indexOf(w));

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? ""), extDir = String(args.ext ?? ""), kDir = String(args.ktape ?? "");
  const rDir = String(args.rtape ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  const tapePath = args.tape ? String(args.tape) : "";
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  if (!extDir) throw new Error("--ext <dir with BTC-USD_1h_kraken.json …> is required");
  if (!kDir) throw new Error("--ktape <dir with BTC-USD_4h_kraken.json …> is required");
  if (!rDir) throw new Error("--rtape <dir with BTC-USD_4h_revx.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  const sha = async (u: URL | string) => {
    const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(u));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const btPath = new URL("./backtest.ts", import.meta.url);
  const btHashStart = await sha(btPath);

  // ── the coins: a measured half-spread on BOTH venues and a file in all three directories ──
  const priced = Object.keys(COSTS.revx.halfSpread).filter((s) => COSTS.kraken.halfSpread[s] != null).sort();
  const haveData = new Set<string>(), haveExt = new Set<string>(), haveK = new Set<string>(), haveR = new Set<string>();
  for await (const e of Deno.readDir(dataDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_3y\.json$/); if (m) haveData.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(extDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_1h_kraken\.json$/); if (m) haveExt.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(kDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_4h_kraken\.json$/); if (m) haveK.add(`${m[1]}/USD`); }
  for await (const e of Deno.readDir(rDir)) { const m = e.name.match(/^([A-Z0-9]+)-USD_4h_revx\.json$/); if (m) haveR.add(`${m[1]}/USD`); }
  const candidates = priced.filter((s) => haveData.has(s) && haveExt.has(s) && haveK.has(s));

  let extPairs: Record<string, string> = {};
  try {
    const pv = JSON.parse(await Deno.readTextFile(`${extDir}/provenance.json`)) as Record<string, { krakenPair: string }>;
    extPairs = Object.fromEntries(Object.entries(pv).map(([k, v]) => [k, v.krakenPair]));
  } catch { /* the pair name is cosmetic */ }

  type Arm = { c4h: Candle[]; daily: Candle[]; is4h: Candle[]; isDaily: Candle[] };
  type RevxCoverage = {
    covered: boolean; why: string;
    scoredBars: number; barsFromRevx: number; barsFromKrakenWarmStart: number; coverage: number;
    missingBarsInSpan: number; firstBarIso: string; lastBarIso: string;
    overlapVsCoinbase: ReturnType<typeof tapeAgreement>; overlapVsKraken: ReturnType<typeof tapeAgreement>;
  };
  type Series = {
    coinbase: Arm; kraken: Arm; revx: Arm; cb4h: Candle[]; wins: Win[];
    overlap: ReturnType<typeof tapeAgreement>;
    krakenCoverage: Record<string, { covered: boolean; why: string }>;
    revxCoverage: RevxCoverage | null;
  };
  const series: Record<string, Series> = {};
  const provenance: Record<string, unknown>[] = [];
  const symbols: string[] = [];

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
    // The Kraken arm's "in-sample series for windows A and B": the SAME cold start the published tables
    // used — the array begins at the Coinbase series' first bar on BOTH arms.
    const zK = indexAtOrAfter(kTape, spliceAt);
    const kIs4h = kTape.slice(zK);
    const kDaily = resample(kTape, 24);
    const kIsDaily = kDaily.filter((c) => c.start >= (kIs4h.length ? kIs4h[0].start : Infinity));

    const wins = windowsOn(comb4h, cb4h, MAX_LOOKBACK);
    // The Kraken-tape coverage rule, identical to `backtest_tape.ts`'s and declared before the numbers:
    // a window is priced only when Kraken's own tape spans the whole of it with more bars than the widest
    // lookback at each end. A window Kraken's tape cannot see is dropped from BOTH arms, because a
    // comparison between two different calendars is not a comparison.
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
    // The same acceptance test §3.15 declared before it compared the sources.
    const ov4h = tapeAgreement(cb4h, kTape, cb4h[0].start, cb4h[cb4h.length - 1].start + 4 * 3600e3);
    const rejected: string[] = [];
    if (!ov4h.sharedBars || ov4h.sharedBars < 100) rejected.push(`overlap is ${ov4h.sharedBars} 4h bars — too few to verify`);
    else {
      if ((ov4h.medianBps ?? 0) > OVERLAP_MEDIAN_MAX_BPS) rejected.push(`overlap median ${ov4h.medianBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`);
      if ((ov4h.p95Bps ?? 0) > OVERLAP_P95_MAX_BPS) rejected.push(`overlap p95 ${ov4h.p95Bps} bps > ${OVERLAP_P95_MAX_BPS}`);
    }

    // ── the THIRD tape: Revolut X's own UK book, window A only ────────────
    //
    // The venue's tape is one year long and window A's out-of-sample opens a day
    // or so before it starts, so two things are supplied by the Kraken tape and
    // both are COUNTED rather than waved through: the ~100 bars of warm-up the
    // SMAs and the ATR need before the scored span opens (the array would
    // otherwise begin at the window's first bar and the rule would not decide
    // for another 17 days, which is a bigger distortion than the splice), and at
    // most the first day of the scored span itself. Kraken's bars are spliced
    // strictly BEFORE the venue's first bar — the same technique §3.15 used to
    // build windows C and D — and the share of SCORED bars that are Revolut X's
    // own is reported per coin against a threshold written down first.
    let revxArm: Arm = { c4h: [], daily: [], is4h: [], isDaily: [] };
    let revxCoverage: RevxCoverage | null = null;
    if (haveR.has(symbol)) {
      const rTape = toCandles(JSON.parse(await Deno.readTextFile(`${rDir}/${base}_4h_revx.json`)) as Raw[]);
      const rFirst = rTape.length ? rTape[0].start : Infinity;
      const rComb = [...kTape.filter((c) => c.start < rFirst), ...rTape];
      revxArm = { c4h: rComb, daily: resample(rComb, 24), is4h: rComb, isDaily: resample(rComb, 24) };
      const wA = wins.find((w) => w.name === "A")!;
      if (!wA.scored) revxCoverage = null;
      else {
        const endTs = (arr: Candle[], idx: number) => idx < arr.length ? arr[idx].start : arr[arr.length - 1].start + 4 * 3600e3;
        const oosFromTs = comb4h[wA.oosFrom].start, oosToTs = endTs(comb4h, wA.oosTo);
        const scored = rComb.filter((c) => c.start >= oosFromTs && c.start < oosToTs);
        const fromRevx = scored.filter((c) => c.start >= rFirst).length;
        const coverage = scored.length ? fromRevx / scored.length : 0;
        // A 4-hour series over the span should have (oosToTs − oosFromTs) / 4 h bars; what is short is missing.
        const expected = Math.round((oosToTs - oosFromTs) / (4 * 3600e3));
        const ovCb = tapeAgreement(cb4h, rTape, oosFromTs, oosToTs);
        const ovKr = tapeAgreement(kTape, rTape, oosFromTs, oosToTs);
        let why = "";
        if (!rTape.length) why = "no Revolut X tape for this pair";
        else if (rTape[rTape.length - 1].start + 4 * 3600e3 < oosToTs) why = `Revolut X's tape ends ${iso(rTape[rTape.length - 1].start)}, before window A's out-of-sample ends (${iso(oosToTs)})`;
        else if (coverage < REVX_MIN_WINDOW_COVERAGE) why = `only ${(coverage * 100).toFixed(1)} % of window A's scored bars are Revolut X's own, under the ${(REVX_MIN_WINDOW_COVERAGE * 100).toFixed(0)} % floor written down first`;
        else if (!ovCb.sharedBars || ovCb.sharedBars < 100) why = `overlap with Coinbase over window A is ${ovCb.sharedBars} bars — too few to verify`;
        else if ((ovCb.medianBps ?? 0) > OVERLAP_MEDIAN_MAX_BPS) why = `overlap median ${ovCb.medianBps} bps > ${OVERLAP_MEDIAN_MAX_BPS}`;
        else if ((ovCb.p95Bps ?? 0) > OVERLAP_P95_MAX_BPS) why = `overlap p95 ${ovCb.p95Bps} bps > ${OVERLAP_P95_MAX_BPS}`;
        revxCoverage = {
          covered: why === "", why,
          scoredBars: scored.length, barsFromRevx: fromRevx, barsFromKrakenWarmStart: scored.length - fromRevx,
          coverage: r4(coverage), missingBarsInSpan: Math.max(0, expected - scored.length),
          firstBarIso: rTape.length ? iso(rTape[0].start) : "", lastBarIso: rTape.length ? iso(rTape[rTape.length - 1].start) : "",
          overlapVsCoinbase: ovCb, overlapVsKraken: ovKr,
        };
      }
    }

    series[symbol] = {
      coinbase: { c4h: comb4h, daily: combDaily, is4h: cb4h, isDaily: cbDaily },
      kraken: { c4h: kTape, daily: kDaily, is4h: kIs4h, isDaily: kIsDaily },
      revx: revxArm,
      cb4h, wins, overlap: ov4h, krakenCoverage, revxCoverage,
    };
    provenance.push({
      symbol, krakenPair: extPairs[symbol] ?? "",
      coinbase: { barsHourly: cbH.length, bars4h: cb4h.length, first: iso(cbH[0].start), last: iso(cbH[cbH.length - 1].start) },
      combined: { bars4h: comb4h.length, first: iso(comb4h[0].start), last: iso(comb4h[comb4h.length - 1].start) },
      krakenTape: { bars4h: kTape.length, first: iso(kTape[0].start), last: iso(kTape[kTape.length - 1].start) },
      revxTape: revxCoverage,
      overlapOverCoinbaseSpan: ov4h,
      accepted: rejected.length === 0, rejected,
      windowsScored: wins.filter((w) => w.scored).map((w) => w.name),
      windowsPricedHere: wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name),
      windowsDropped: wins.filter((w) => w.scored && !krakenCoverage[w.name].covered).map((w) => ({ window: w.name, why: krakenCoverage[w.name].why })),
    });
    if (rejected.length === 0) symbols.push(symbol);
    console.log(`${symbol.padEnd(9)} cb ${cb4h.length} 4h | kraken ${kTape.length} 4h | overlap ${ov4h.sharedBars} bars median ${ov4h.medianBps} p95 ${ov4h.p95Bps} | windows ${wins.filter((w) => w.scored).map((w) => w.name).join("") || "—"} → priced ${wins.filter((w) => w.scored && krakenCoverage[w.name].covered).map((w) => w.name).join("") || "—"} | revx A ${revxCoverage ? (revxCoverage.covered ? `${(revxCoverage.coverage * 100).toFixed(1)} % own, median ${revxCoverage.overlapVsCoinbase.medianBps} bps` : "dropped: " + revxCoverage.why) : "—"}${rejected.length ? " REJECTED " + rejected.join("; ") : ""}`);
  }
  console.log(`accepted (${symbols.length}): ${symbols.join(", ")}`);

  // ── the grid, the venues, the tapes, the stop rules ─────────────────────
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const SEEDED_IDX = TREND_GRID.findIndex((p) => p.fast === DEFAULT_TREND.fast && p.slow === DEFAULT_TREND.slow && p.atrStop === DEFAULT_TREND.atrStop);
  const VENUES = ["revx", "kraken"] as const;
  type Venue = typeof VENUES[number];
  /** The backbone: two tapes across all four windows. §3.16's two arms, unchanged. */
  const TAPES = ["coinbase", "kraken"] as const;
  /** Plus the venue's own UK book, which reaches window A and nothing else. */
  const TAPES_ALL = ["coinbase", "kraken", "revxuk"] as const;
  type Tape = typeof TAPES_ALL[number];
  const STOP_RULES = ["shipped", "trail"] as const;
  type StopRule = typeof STOP_RULES[number];
  const other = (v: Venue): Venue => v === "revx" ? "kraken" : "revx";
  const stopsOf = (reg: StopRule, p: TrendParams): StopParams =>
    reg === "shipped" ? stopsForKind("trend-4h", p) : { ...PINNED_STOPS, atrStop: p.atrStop };
  /** Every (stop rule × backbone tape) pair — the four near-duplicate evaluations every A1/A2/A3 arm must survive. */
  const CONDITIONS: { reg: StopRule; tape: Tape; id: string }[] = STOP_RULES.flatMap((reg) => TAPES.map((tape) => ({ reg, tape, id: `${reg}·${tape}` })));
  /** Window A only: the same two stop rules against all THREE tapes — six cells, the bear year on the venue's own book included. */
  const WINDOW_A_CONDITIONS: { reg: StopRule; tape: Tape; id: string }[] = STOP_RULES.flatMap((reg) => TAPES_ALL.map((tape) => ({ reg, tape, id: `${reg}·${tape}` })));
  /** The array key each tape's candles live under on a `Series`. */
  const armOf = (tape: Tape) => tape === "revxuk" ? "revx" as const : tape;

  const bookOf = (v: Venue, s: string) => (v === "revx" ? UK_BOOK_USD_PER_DAY[s] : KRAKEN_BOOK_USD_PER_DAY[s]) ?? 0;

  /** One window's calendar span, resolved onto whichever arm is priced — by TIMESTAMP, never by bar index. */
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
  /** The index pair a window's in-sample and out-of-sample occupy on one arm. */
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
  /** The windows a coin is priced on, per tape. The venue's own tape reaches window A and nothing else. */
  function windowsPricedOn(symbol: string, tape: Tape): Win[] {
    const s = series[symbol];
    if (tape === "revxuk") return s.revxCoverage?.covered ? s.wins.filter((w) => w.name === "A" && w.scored && s.krakenCoverage.A.covered) : [];
    return s.wins.filter((w) => w.scored && s.krakenCoverage[w.name].covered);
  }
  const windowsPriced = (symbol: string): Win[] => windowsPricedOn(symbol, "coinbase");

  // ── the per-coin grid: choose in sample, score the whole grid out of sample ──
  type Cell = {
    chosen: { fast: number; slow: number; atrStop: number };
    chosenOwn: ReturnType<typeof pick>; chosenOther: ReturnType<typeof pick>;
    seededOwn: ReturnType<typeof pick>; seededOther: ReturnType<typeof pick>;
    plateau: Plateau; chosenPass: boolean; seededPass: boolean; seededFailed: string[];
    /** §4.15 in full: the four tests AND the venue's book. */
    seededClears: boolean; chosenClears: boolean;
    /**
     * False on the venue's own tape: Revolut X's book begins in 2025-09 and
     * window A's in-sample is the two years before it, so NO parameter can be
     * chosen on that tape. The seeded point is what the loop runs and was fixed
     * long before this window, so the seeded column is a real out-of-sample
     * figure; the chosen column is simply absent, and mirrors the seeded one so
     * nothing downstream reads a number that does not exist.
     */
    chosenAvailable: boolean;
  };
  /** Copied from `backtest_tape.ts`'s `studyVenue`, with the in-sample made optional (see `chosenAvailable`). */
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
      chosenOwn: pick(oosOwn[bestIdx]), chosenOther: pick(chosenOther),
      seededOwn: pick(oosOwn[SEEDED_IDX]), seededOther: pick(seededOther),
      plateau, chosenPass: chosen.pass, seededPass: seeded.pass, seededFailed: seeded.failed,
      seededClears: seeded.pass && book, chosenClears: chosen.pass && book,
      chosenAvailable: inSample != null,
    };
  }

  /** `[stopRule][tape][symbol][window][venue]` — the grid; and the seeded marked core beside it. */
  const cells: Record<string, Record<string, Record<string, Record<string, Record<string, Cell>>>>> = {};
  const cores: Record<string, Record<string, Record<string, Record<string, Record<string, SetResult>>>>> = {};
  /** In-sample entry statistics, per coin per window — what A2's volatility and risk arms size on. */
  const entryStats: Record<string, Record<string, Record<string, Record<string, { atrPct: number; stopPct: number; entries: number }>>>> = {};
  let fidChecks = 0, fidRet = 0, fidDD = 0, fidTrades = 0;
  let fidWeightChecks = 0, fidWeightRet = 0, fidWeightDD = 0, fidWeightTrades = 0;
  let fidTrChecks = 0, fidTrRet = 0, fidTrDD = 0, fidTrTrades = 0;
  let gridArms = 0;

  for (const reg of STOP_RULES) {
    cells[reg] = {}; cores[reg] = {}; entryStats[reg] = {};
    for (const tape of TAPES_ALL) {
      const t0 = Date.now();
      cells[reg][tape] = {}; cores[reg][tape] = {}; entryStats[reg][tape] = {};
      for (const symbol of symbols) {
        cells[reg][tape][symbol] = {}; cores[reg][tape][symbol] = {}; entryStats[reg][tape][symbol] = {};
        for (const w of windowsPricedOn(symbol, tape)) {
          const b = boundsOn(symbol, w, tape);
          const isRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.isArr, b.isDaily, b.isFrom, b.isTo, p, c, 4, stopsOf(reg, p));
          const oosRun = (p: TrendParams, c: Costs) => run("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, p, c, 4, stopsOf(reg, p));
          cells[reg][tape][symbol][w.name] = {}; cores[reg][tape][symbol][w.name] = {};
          for (const v of VENUES) {
            cells[reg][tape][symbol][w.name][v] = studyVenue(symbol, v, tape === "revxuk" ? null : isRun, oosRun);
            gridArms += TREND_GRID.length;
            const st = stopsOf(reg, DEFAULT_TREND);
            const sf = surfaceOf(st);
            // `runSet` must BE `run` — three ways: the null branch, the weight path and the tranche path.
            const a = oosRun(DEFAULT_TREND, COSTS[v]);
            const b0 = runSet("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, DEFAULT_TREND, COSTS[v], 4, sf, null, null);
            fidChecks++; fidRet = Math.max(fidRet, Math.abs(a.ret - b0.ret)); fidDD = Math.max(fidDD, Math.abs(a.maxDD - b0.maxDD)); fidTrades = Math.max(fidTrades, Math.abs(a.trades - b0.trades));
            const b1 = runSet("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, DEFAULT_TREND, COSTS[v], 4, sf, () => 1, null);
            fidWeightChecks++; fidWeightRet = Math.max(fidWeightRet, Math.abs(a.ret - b1.ret)); fidWeightDD = Math.max(fidWeightDD, Math.abs(a.maxDD - b1.maxDD)); fidWeightTrades = Math.max(fidWeightTrades, Math.abs(a.trades - b1.trades));
            const b2 = runSet("trend-4h", symbol, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, DEFAULT_TREND, COSTS[v], 4, sf, null, { entryFracs: [1], trigger: "pullback", triggerAtr: 1, targetFrac: null, targetAtr: null });
            fidTrChecks++; fidTrRet = Math.max(fidTrRet, Math.abs(a.ret - b2.ret)); fidTrDD = Math.max(fidTrDD, Math.abs(a.maxDD - b2.maxDD)); fidTrTrades = Math.max(fidTrTrades, Math.abs(a.trades - b2.trades));
            cores[reg][tape][symbol][w.name][v] = b0;
          }
          // The in-sample entry statistics, on the venue the live row runs. Not computed on the venue's own
          // tape: window A's in-sample is the two years BEFORE Revolut X's book begins, so there is nothing
          // to measure there. A2's volatility and risk arms read Kraken's in-sample statistics for that arm —
          // the series `signal_venue` would in fact have given the row — and say so.
          if (tape !== "revxuk") {
            const ins = runSet("trend-4h", symbol, b.isArr, b.isDaily, b.isFrom, b.isTo, DEFAULT_TREND, COSTS.revx, 4, surfaceOf(stopsOf(reg, DEFAULT_TREND)), null, null);
            entryStats[reg][tape][symbol][w.name] = {
              atrPct: Number(median(ins.entryAtrPct).toFixed(5)),
              stopPct: Number(median(ins.entryStopPct).toFixed(5)),
              entries: ins.entryAtrPct.length,
            };
          }
        }
      }
      console.log(`[${reg}·${tape}] grid done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  }

  // ─────────────────────────────────────────────────────────── the report shell

  const report: Record<string, unknown> = {
    study: "the live row's four settled choices — which coins, equal slots, the mechanics, and the venue — re-asked on FOUR windows and BOTH price series. Three of the four were settled on two windows and one tape, and §3.16 measured that a per-coin comparison is exactly where the tape matters most (up to 30 points on one coin's bear year, a §4.15 verdict flip on 5.9 % of coin-windows) while the sleeve moves about a point. The prior is that nothing changes; the multiple-comparisons control on every search is what defends it.",
    source: "Two arms over the same calendar are the backbone, as `backtest_tape.ts` builds them. `coinbase`: Kraken's quarterly OHLCVT bundle spliced strictly BEFORE the Coinbase Exchange series' first bar, Coinbase's from there — the tape every published table used. `kraken`: Kraken's own 4-hour tape end to end — the tape `signal_venue` makes the loop read. A THIRD arm, `revxuk`, is Revolut X's own public UK book (keyless, `region=UK`, 2,257 four-hour bars from 2025-09-11): one year long, so it reaches window A and nothing before it, and it is used on window A alone — see `a0_theThirdTape`. Fills, fees, the protective exits and the two-bar cooldown are `backtest.ts`'s own; Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). The model is not in the backtest.",
    determinism: "No wall-clock or runtime field is written. Re-running over the same three data directories reproduces this file byte for byte; every null is computed exactly rather than sampled.",
    windows: {
      A: "parameters on the first two thirds, the LAST third out of sample (bear, majors −39.4 %)",
      B: "parameters on the first third, the MIDDLE third out of sample (bull, +72.3 %)",
      C: "parameters on the 24 months of extended history before the series, the FIRST third out of sample (stronger bull, +243.0 %)",
      D: "parameters on the 24 months before that, the 12 months before the series out of sample (sideways, −5.8 %) — entirely inside the Kraken extension on BOTH arms, so it is identical across tapes by construction and `fidelity.windowD` checks that it is",
      calendarOrder: CALENDAR_ORDER,
      ranking: "an arm is ranked by the WORST window it has; windows are never averaged (§3.11)",
      priorEvidence: "every 'prior evidence' weight in A2 is computed on windows strictly EARLIER in the calendar than the one being scored, which is the only past a live row would have had; the look-ahead variants are labelled as bounds, never as rules",
    },
    stopRules: {
      note: "EVERY figure in this file is reported under `shipped` and `trail`, and is never averaged between them.",
      shipped: { stops: stopsForKind("trend-4h", DEFAULT_TREND), constant: { ...SHIPPED_STOPS }, what: "what backtest.ts ships and tick.ts runs — the 8 % floor alone, the intra-bar trail removed (§3.13)" },
      trail: { stops: { ...PINNED_STOPS }, what: "the 8 % floor plus the 3×ATR(14) intra-bar trail — what §3.7 / §3.8 / §3.10 / §3.11 were computed under" },
    },
    conditions: {
      list: CONDITIONS.map((c) => c.id),
      note: "the four near-duplicate evaluations an arm must survive to count as a change: two tapes × two stop rules, all four windows, ranked by the worst. They are near-duplicates, not independent tests, and every control states both bounding nulls.",
      windowAList: WINDOW_A_CONDITIONS.map((c) => c.id),
      windowANote: "window A alone, on all THREE tapes × two stop rules — six cells, reported separately for A1, A2 and A4 because that is where a verdict is load-bearing and where the venue's own book exists. It is one extra tape on one window, not a fourth dimension: A3's mechanics are priced on the backbone two.",
    },
    bar: "reference §3.7 / §4.15 / §4.16: positive out of sample on the venue the row would run on, max drawdown < 35 %, at least half the grid positive out of sample on that venue, positive on the other venue's costs — and a book on the running venue of at least $100k a day.",
    costs: COSTS,
    ukBookUsdPerDay: UK_BOOK_USD_PER_DAY,
    krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY,
    minBookUsd: MIN_BOOK_USD,
    caps: { maxOrderUsd: MAX_ORDER_USD, maxExposureUsdLive: MAX_EXPOSURE_USD_LIVE, liveRow: LIVE_ROW, momentumRow: MOMENTUM_ROW },
    grids: { "trend-4h": { points: TREND_GRID.length, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [2, 3, 4], seeded: { fast: DEFAULT_TREND.fast, slow: DEFAULT_TREND.slow, atrStop: DEFAULT_TREND.atrStop } } },
    data: { symbolsPriced: priced.length, symbolsAccepted: symbols.length, perSymbol: provenance },
  };

  // ── fidelity ────────────────────────────────────────────────────────────
  const fid: Record<string, unknown> = {
    runSet: {
      note: "`runSet` (the one copy of `run` in this file) against `backtest.ts`'s `run`, seeded parameters, every accepted coin × every priced window × both venues × both stop rules × BOTH TAPES. Three checks, not one: the NULL branch (weight null, tranches null), the WEIGHT path (a weight function that always returns 1) and the TRANCHE path (a one-tranche plan with no target). A study whose only check is the null branch has not checked the branch it uses.",
      nullBranch: { checks: fidChecks, worstAbsRetDiff: fidRet, worstAbsMaxDDDiff: fidDD, worstAbsTradeDiff: fidTrades },
      weightPath: { checks: fidWeightChecks, worstAbsRetDiff: fidWeightRet, worstAbsMaxDDDiff: fidWeightDD, worstAbsTradeDiff: fidWeightTrades },
      tranchePath: { checks: fidTrChecks, worstAbsRetDiff: fidTrRet, worstAbsMaxDDDiff: fidTrDD, worstAbsTradeDiff: fidTrTrades },
    },
  };

  // Window D is inside the Kraken extension on BOTH arms, so the two tapes must agree bit for bit there.
  {
    const per: Record<string, unknown> = {};
    for (const reg of STOP_RULES) {
      let checks = 0, wr = 0, wd = 0, wt = 0;
      for (const s of symbols) {
        const cb = cells[reg].coinbase[s]?.D, kr = cells[reg].kraken[s]?.D;
        if (!cb || !kr) continue;
        for (const v of VENUES) for (const k of ["chosenOwn", "seededOwn"] as const) {
          checks++;
          wr = Math.max(wr, Math.abs(cb[v][k].ret - kr[v][k].ret));
          wd = Math.max(wd, Math.abs(cb[v][k].maxDD - kr[v][k].maxDD));
          wt = Math.max(wt, Math.abs(cb[v][k].trades - kr[v][k].trades));
        }
      }
      per[reg] = { checks, worstAbsRetDiff: r4(wr), worstAbsMaxDDDiff: r4(wd), worstAbsTradeDiff: wt };
    }
    fid.windowD = { note: "Window D's in-sample AND out-of-sample both sit before the splice, where both arms are the same Kraken bars. A non-zero difference here would mean the timestamp mapping is wrong.", perStopRule: per };
  }

  // Does this harness reproduce `tape.json` — §3.16's own cells — on both tapes?
  if (tapePath) {
    const tj = JSON.parse(await Deno.readTextFile(tapePath)) as Record<string, any>;
    const hash = await sha(tapePath);
    const rows: Record<string, unknown>[] = [];
    let compared = 0;
    for (const c of (tj.t1_whatTheTapeIsWorth?.cells ?? []) as Record<string, any>[]) {
      for (const tape of TAPES) {
        const h = cells[c.stopRule]?.[tape]?.[c.symbol]?.[c.window]?.[c.venue];
        if (!h) continue;
        for (const how of ["seeded", "chosen"] as const) {
          const pubSide = c[how][tape];
          const hereSide = how === "seeded" ? h.seededOwn : h.chosenOwn;
          for (const f of ["ret", "maxDD", "trades"] as const) {
            compared++;
            const d = (hereSide[f] as number) - (pubSide[f] as number);
            if (Math.abs(d) > 1e-9) rows.push({ symbol: c.symbol, window: c.window, venue: c.venue, stopRule: c.stopRule, tape, field: `${how}.${f}`, published: pubSide[f], here: hereSide[f], delta: r4(d) });
          }
        }
      }
    }
    fid.publishedTape = {
      note: "Every cell of `tape.json`'s §T1 — coin × window × venue × stop rule, both tapes, seeded and chosen, return / drawdown / trade count — recomputed here by a different runner and compared. Agreement means this harness IS §3.16, so every comparison below is the choice and nothing else.",
      file: tapePath, sha256: hash,
      cellsCompared: compared, cellsThatDiffer: rows.length,
      worstAbsDelta: rows.length ? Math.max(...rows.map((r) => Math.abs(r.delta as number))) : 0,
      differences: rows.slice(0, 60),
    };
    console.log(`tape.json cross-check: ${compared} cells, ${rows.length} differ`);
  }
  // The published four-window row table, typed in from reference §3.17's §S2 (shipped stops, Coinbase tape,
  // each row's worst return over drawdown), so the harness proves it reproduces the study it extends rather
  // than asserting it. It reaches those numbers by a different route — calendar-mapped windows, a different
  // runner, a `combine` that also counts fills — so agreement is evidence about the arithmetic.
  const PUBLISHED_3_17_WORST: Record<string, number> = {
    "trend-4h·revx (live)": -0.50,
    "trend-4h·kraken (paper twin)": -0.66,
    "momentum-1d·revx (paper)": -0.26,
  };
  report.fidelity = fid;

  // ══════════════════════════════════════════ A0 — the third tape, and what it costs to use

  {
    const covered = symbols.filter((s) => series[s].revxCoverage?.covered);
    const dropped = symbols.filter((s) => !series[s].revxCoverage?.covered);
    const cov = covered.map((s) => series[s].revxCoverage!);
    const perCoin = covered.map((s) => {
      const c = series[s].revxCoverage!;
      return {
        symbol: s, coverage: c.coverage, scoredBars: c.scoredBars, barsFromRevx: c.barsFromRevx,
        barsFromKrakenWarmStart: c.barsFromKrakenWarmStart, missingBarsInSpan: c.missingBarsInSpan,
        medianBpsVsCoinbase: c.overlapVsCoinbase.medianBps, p95BpsVsCoinbase: c.overlapVsCoinbase.p95Bps, maxBpsVsCoinbase: c.overlapVsCoinbase.maxBps,
        medianBpsVsKraken: c.overlapVsKraken.medianBps, p95BpsVsKraken: c.overlapVsKraken.p95Bps, maxBpsVsKraken: c.overlapVsKraken.maxBps,
      };
    }).sort((a, b) => (b.medianBpsVsCoinbase ?? 0) - (a.medianBpsVsCoinbase ?? 0));
    report.a0_theThirdTape = {
      note: "Revolut X's own UK book is public and keyless (`GET /1.0/public/candles/{SYM}?interval=240&region=UK`; `region=UK` is §4.14's requirement — without it the endpoint serves the EEA book this account cannot trade) and it is ONE YEAR long, not three. It reaches window A and nothing before it, so it is a third tape on window A ONLY. This corrects two claims in the reference: §2.3's 'three years of hourly history' and §3.16's 'Revolut X's own tape needs a signed endpoint and is unreachable from a harness'. `backtest.ts`'s own header — one year — was right.",
      whyItMatters: "§3.16 measured that the per-coin verdict is unstable across tapes without being able to say which tape is right. In window A one of the three tapes IS the book the orders would meet, so a choice that survives on all three in the bear year is a materially stronger statement than one that survives on two — and a choice that does not is the more important finding.",
      howTheShortfallWasHandled: `Window A's out-of-sample opens a day or so before the venue's tape starts (2025-09-11), and the rule needs ~100 bars of warm-up for its slow average before it can decide at all. Kraken's 4-hour tape is spliced strictly BEFORE the venue's first bar — the same technique §3.15 used to build windows C and D — so the warm-up and at most the first day of the scored span are Kraken's and everything after is Revolut X's own. The share of SCORED bars that are the venue's own is counted per coin against a floor of ${(REVX_MIN_WINDOW_COVERAGE * 100).toFixed(0)} %, written down before any number on this tape was looked at, and a coin under it is dropped from this arm with its reason. Parameters are NOT chosen on this tape — window A's in-sample is the two years before the venue's book begins — so only the seeded point, which the loop runs and which was fixed long before this window, is priced here.`,
      floor: REVX_MIN_WINDOW_COVERAGE,
      coinsWithATape: symbols.filter((s) => series[s].revxCoverage != null).length,
      coinsPriced: covered.length,
      coinsDropped: dropped.map((s) => ({
        symbol: s,
        why: series[s].revxCoverage?.why
          ?? (!haveR.has(s) ? "no Revolut X tape for this pair"
            : !series[s].wins.find((w) => w.name === "A")?.scored ? "window A is not scored for this coin on any tape, so there is nothing for a third tape to price"
              : "no coverage record"),
      })),
      coverage: cov.length ? { min: Math.min(...cov.map((c) => c.coverage)), median: r4(median(cov.map((c) => c.coverage))), max: Math.max(...cov.map((c) => c.coverage)) } : null,
      barsFromKrakenWarmStart: { total: cov.reduce((a, c) => a + c.barsFromKrakenWarmStart, 0), worstCoin: cov.length ? Math.max(...cov.map((c) => c.barsFromKrakenWarmStart)) : 0, note: "scored 4-hour bars in window A supplied by Kraken because the venue's tape had not begun — one day at most" },
      missingBarsInSpan: { total: cov.reduce((a, c) => a + c.missingBarsInSpan, 0), perCoin: perCoin.filter((p) => p.missingBarsInSpan > 0).map((p) => ({ symbol: p.symbol, missing: p.missingBarsInSpan })), note: "gaps in the venue's own tape over window A; left in rather than filled, as §3.16 left Kraken's" },
      returnDisagreementOverWindowA: (() => {
        // §3.16's T1, extended to three tapes on the one window that has three. Seeded parameters, Revolut X
        // costs: the same rule over the same calendar, three price series, one of which is the venue's own book.
        const rows: Record<string, unknown>[] = [];
        for (const s of covered) for (const reg of STOP_RULES) {
          const c = cells[reg].coinbase[s]?.A?.revx, k = cells[reg].kraken[s]?.A?.revx, r = cells[reg].revxuk[s]?.A?.revx;
          if (!c || !k || !r) continue;
          const rets = { coinbase: c.seededOwn.ret, kraken: k.seededOwn.ret, revxuk: r.seededOwn.ret };
          const vals = [rets.coinbase, rets.kraken, rets.revxuk];
          const verdicts = { coinbase: c.seededClears, kraken: k.seededClears, revxuk: r.seededClears };
          rows.push({
            symbol: s, stopRule: reg, returns: rets,
            maxPairwiseAbsDelta: r4(Math.max(...vals) - Math.min(...vals)),
            deltaRevxVsCoinbase: r4(rets.revxuk - rets.coinbase), deltaRevxVsKraken: r4(rets.revxuk - rets.kraken),
            signsAgree: new Set(vals.map((v) => v > 0)).size === 1,
            verdicts, verdictsAgree: new Set(Object.values(verdicts)).size === 1,
            trades: { coinbase: c.seededOwn.trades, kraken: k.seededOwn.trades, revxuk: r.seededOwn.trades },
          });
        }
        const spreads = rows.map((x) => x.maxPairwiseAbsDelta as number);
        const dRC = rows.map((x) => x.deltaRevxVsCoinbase as number), dRK = rows.map((x) => x.deltaRevxVsKraken as number);
        // §3.16 caught itself in exactly this trap and named it: a cell-level sign test counts the same coin
        // once per stop rule, and the two cells of a coin are near-duplicates, so its p-value is optimistic.
        // ONE observation per coin — the median of that coin's cells — is the number to read.
        const byCoin = covered.map((s) => {
          const mine = rows.filter((x) => x.symbol === s);
          return {
            symbol: s, cells: mine.length,
            medianDeltaRevxVsCoinbase: r4(median(mine.map((x) => x.deltaRevxVsCoinbase as number))),
            medianDeltaRevxVsKraken: r4(median(mine.map((x) => x.deltaRevxVsKraken as number))),
            maxPairwiseAbsDelta: r4(Math.max(...mine.map((x) => x.maxPairwiseAbsDelta as number))),
            inLiveRow: LIVE_ROW.symbols.includes(s),
          };
        }).filter((x) => x.cells > 0);
        const coinLevel = (pickd: (x: typeof byCoin[number]) => number) => {
          const up = byCoin.filter((x) => pickd(x) > 0).length, dn = byCoin.filter((x) => pickd(x) < 0).length;
          return { coins: byCoin.length, higherOnRevxTape: up, lowerOnRevxTape: dn, median: r4(median(byCoin.map(pickd))), signTest: signTest(up, dn) };
        };
        const live = byCoin.filter((x) => x.inLiveRow);
        return {
          note: "The same seeded rule at Revolut X's costs over window A, priced on all three tapes: how far apart the three RETURNS land, and whether §4.15's verdict is the same on all three. This is §3.16's T1 (two tapes, median 4.03 / p95 31.3 / max 70.4 points, 5.9 % verdict flips) with the venue's own book added on the one window that has it.",
          cells: rows.length,
          maxPairwiseAbsDelta: spreads.length ? { median: r4(median(spreads)), p95: r4(quantile(spreads, 0.95)), max: r4(Math.max(...spreads)) } : null,
          revxVsCoinbase: dRC.length ? { median: r4(median(dRC)), higherOnRevxTape: dRC.filter((d) => d > 0).length, higherOnCoinbase: dRC.filter((d) => d < 0).length, signTest: signTest(dRC.filter((d) => d > 0).length, dRC.filter((d) => d < 0).length) } : null,
          revxVsKraken: dRK.length ? { median: r4(median(dRK)), higherOnRevxTape: dRK.filter((d) => d > 0).length, higherOnKraken: dRK.filter((d) => d < 0).length, signTest: signTest(dRK.filter((d) => d > 0).length, dRK.filter((d) => d < 0).length) } : null,
          cellsWhereTheThreeSignsDisagree: rows.filter((x) => !x.signsAgree).length,
          cellsWhereTheThreeBarVerdictsDisagree: rows.filter((x) => !x.verdictsAgree).length,
          coinLevel: {
            note: "ONE observation per coin — the median of that coin's two stop-rule cells — so the two near-duplicate cells inside a coin cannot vote twice. This is the number to read; the cell-level test above is pseudo-replicated, which is the trap §3.16 caught itself in.",
            revxVsCoinbase: coinLevel((x) => x.medianDeltaRevxVsCoinbase),
            revxVsKraken: coinLevel((x) => x.medianDeltaRevxVsKraken),
          },
          liveRowCoinsOnly: {
            note: "the five coins the live row runs, one row each — the sleeve's own members, which is what the recommendation depends on",
            perCoin: live,
            meanDeltaRevxVsCoinbase: r4(mean(live.map((x) => x.medianDeltaRevxVsCoinbase))),
            meanDeltaRevxVsKraken: r4(mean(live.map((x) => x.medianDeltaRevxVsKraken))),
            higherOnRevxTape: live.filter((x) => x.medianDeltaRevxVsCoinbase > 0).length,
          },
          perCoin: byCoin,
          perCell: rows,
        };
      })(),
      agreementOverWindowA: {
        note: "|Δclose| in bps, bar for bar, over window A's scored span. This is §3.16's T1 measurement extended to the third tape — and the first time this repository can say how far the venue's own prints sit from the two series every table is built on.",
        vsCoinbase: cov.length ? { medianOfMedians: r3(median(cov.map((c) => c.overlapVsCoinbase.medianBps ?? NaN))), worstMedian: Math.max(...cov.map((c) => c.overlapVsCoinbase.medianBps ?? 0)), worstP95: Math.max(...cov.map((c) => c.overlapVsCoinbase.p95Bps ?? 0)) } : null,
        vsKraken: cov.length ? { medianOfMedians: r3(median(cov.map((c) => c.overlapVsKraken.medianBps ?? NaN))), worstMedian: Math.max(...cov.map((c) => c.overlapVsKraken.medianBps ?? 0)), worstP95: Math.max(...cov.map((c) => c.overlapVsKraken.p95Bps ?? 0)) } : null,
        perCoin,
      },
    };
    console.log(`A0: third tape priced on ${covered.length} coins, dropped ${dropped.length}`);
  }

  // ─────────────────────────────────────────────────── sleeve machinery (A1–A3)

  const SLOT_BASE = Math.min(LIVE_ROW.capitalUsd / LIVE_ROW.symbols.length, MAX_ORDER_USD);   // $20

  /**
   * A sleeve over a coin set on one window, each member at an equal slot of
   * `capital / |coins|`. Members absent from a window are simply absent — and
   * because `combine`'s return is P&L over Σ slots, an EQUAL-weight sleeve's
   * return and drawdown do not depend on the slot size at all, so a 4-coin arm
   * and a 6-coin arm are compared on the same money per unit of risk. The slot
   * is reported so `max_order_usd` can be checked.
   */
  function sleeveOf(coinSet: string[], wname: WinName, reg: StopRule, tape: Tape, venue: Venue, capitalUsd = LIVE_ROW.capitalUsd, weights?: Record<string, number>): { stats: SleeveStats; members: string[] } | null {
    const members = coinSet.filter((s) => cores[reg][tape][s]?.[wname]?.[venue]);
    if (members.length < 2) return null;
    const equal = 1 / coinSet.length;
    const sleeves: Sleeve[] = members.map((s) => {
      const r = cores[reg][tape][s][wname][venue];
      const slot = capitalUsd * (weights ? (weights[s] ?? 0) : equal);
      return {
        id: `trend-4h·${venue}·${s.split("/")[0]}`, symbol: s, slotUsd: slot, rets: dailyReturns(r.marks),
        ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * slot,
      };
    });
    return { stats: combine(sleeves), members };
  }
  /** The same, from cores supplied directly — used where an arm's cores are not the seeded ones (A2's vol arm, A3). */
  function sleeveFrom(rs: Record<string, SetResult>, capitalUsd: number, weights?: Record<string, number>): SleeveStats {
    const members = Object.keys(rs).sort();
    const equal = 1 / members.length;
    return combine(members.map((s) => {
      const r = rs[s];
      const slot = capitalUsd * (weights ? (weights[s] ?? 0) : equal);
      return { id: s, symbol: s, slotUsd: slot, rets: dailyReturns(r.marks), ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure, tradedUsd: r.tradedWeight * slot };
    }));
  }

  const LIVE_WINDOWS: WinName[] = ["A", "B", "C", "D"];
  /** The worst window an arm has, by return over drawdown — §3.11's ranking rule. */
  function worstOf(per: Partial<Record<WinName, SleeveStats>>): { window: WinName | null; retOverDD: number; ret: number } {
    let best: { window: WinName | null; retOverDD: number; ret: number } = { window: null, retOverDD: Infinity, ret: Infinity };
    for (const w of LIVE_WINDOWS) {
      const s = per[w];
      if (!s) continue;
      if (s.retOverDD < best.retOverDD) best = { window: w, retOverDD: s.retOverDD, ret: s.ret };
    }
    return best.window == null ? { window: null, retOverDD: NaN, ret: NaN } : best;
  }
  function sleeveAcross(coinSet: string[], reg: StopRule, tape: Tape, venue: Venue = "revx"): { per: Partial<Record<WinName, SleeveStats>>; members: Partial<Record<WinName, string[]>> } {
    const per: Partial<Record<WinName, SleeveStats>> = {}, mem: Partial<Record<WinName, string[]>> = {};
    for (const w of LIVE_WINDOWS) {
      const s = sleeveOf(coinSet, w, reg, tape, venue);
      if (s) { per[w] = s.stats; mem[w] = s.members; }
    }
    return { per, members: mem };
  }

  // ════════════════════════════════════════════════════════════ A1 — the coins

  const baselineByCond: Record<string, { per: Partial<Record<WinName, SleeveStats>>; worst: ReturnType<typeof worstOf> }> = {};
  for (const c of CONDITIONS) {
    const s = sleeveAcross(LIVE_ROW.symbols, c.reg, c.tape);
    baselineByCond[c.id] = { per: s.per, worst: worstOf(s.per) };
  }
  /** Window A alone, on all THREE tapes — the bear year, including the book the orders would actually meet. */
  const baselineWindowA: Record<string, SleeveStats | null> = {};
  for (const c of WINDOW_A_CONDITIONS) {
    const s = sleeveOf(LIVE_ROW.symbols, "A", c.reg, c.tape, "revx");
    baselineWindowA[c.id] = s ? s.stats : null;
  }

  type CoinArm = {
    arm: string; kind: "drop" | "add"; coin: string; coinSet: string[];
    perCondition: Record<string, { worstWindow: WinName | null; worstRetOverDD: number; baselineWorstWindow: WinName | null; baselineWorstRetOverDD: number; delta: number; improves: boolean; perWindow: Record<string, { retOverDD: number; ret: number; maxDD: number; members: number; baselineRetOverDD: number; delta: number }> }>;
    improvesAllConditions: boolean; conditionsImproved: number;
    improvesWhereTheCandidateTrades: boolean;
    windowsPresent: string[];
    barVerdictSeeded: Record<string, string[]>;   // condition → windows whose §4.15 verdict the coin clears on revx
    ukBookUsdPerDay: number | null; slotUsdIfAdopted: number;
    /** Window A on all three tapes — the bear year, the venue's own book included. */
    windowAThreeTapes: { perCell: Record<string, { baselineRetOverDD: number | null; armRetOverDD: number | null; delta: number | null; improves: boolean }>; cellsImproved: number; cellsPriced: number; improvesOnAllThree: boolean };
    /**
     * §4.15's admission test as §3.8 tightened it: the four tests on BOTH walk-forward windows (A and B) on
     * the row's venue, plus a UK book of at least $100k a day. This is what ADMITS a coin; the sleeve
     * comparison above is what decides money. Neither is evidence for the other.
     */
    clearsTheBar: { bothWalkForwardWindowsEveryCondition: boolean; bookClears: boolean; admitted: boolean };
  };
  const coinArms: CoinArm[] = [];

  const addCandidates = symbols.filter((s) => !LIVE_ROW.symbols.includes(s) && windowsPriced(s).length > 0 && bookOf("revx", s) > 0);

  function priceCoinArm(kind: "drop" | "add", coin: string): CoinArm {
    const coinSet = kind === "drop" ? LIVE_ROW.symbols.filter((s) => s !== coin) : [...LIVE_ROW.symbols, coin];
    const perCondition: CoinArm["perCondition"] = {};
    let improvedAll = true, improvedCount = 0, improvedWhereTrades = true;
    const barVerdict: Record<string, string[]> = {};
    for (const c of CONDITIONS) {
      const s = sleeveAcross(coinSet, c.reg, c.tape);
      const base = baselineByCond[c.id];
      const w = worstOf(s.per);
      const perWindow: Record<string, { retOverDD: number; ret: number; maxDD: number; members: number; baselineRetOverDD: number; delta: number }> = {};
      for (const wn of LIVE_WINDOWS) {
        const a = s.per[wn], b = base.per[wn];
        if (!a || !b) continue;
        perWindow[wn] = { retOverDD: a.retOverDD, ret: a.ret, maxDD: a.maxDD, members: a.members, baselineRetOverDD: b.retOverDD, delta: r2(a.retOverDD - b.retOverDD) };
      }
      const improves = Number.isFinite(w.retOverDD) && Number.isFinite(base.worst.retOverDD) && w.retOverDD > base.worst.retOverDD;
      if (improves) improvedCount++; else improvedAll = false;
      perCondition[c.id] = {
        worstWindow: w.window, worstRetOverDD: Number.isFinite(w.retOverDD) ? w.retOverDD : NaN,
        baselineWorstWindow: base.worst.window, baselineWorstRetOverDD: base.worst.retOverDD,
        delta: r2(w.retOverDD - base.worst.retOverDD), improves, perWindow,
      };
      // the weaker test: the worst window among the windows the CANDIDATE ITSELF trades in — the windows
      // where an add or a drop is anything other than a no-op.
      const present = windowsPriced(coin).map((x) => x.name);
      let wp = Infinity, bp = Infinity;
      for (const wn of present) { const a = s.per[wn], b = base.per[wn]; if (a) wp = Math.min(wp, a.retOverDD); if (b) bp = Math.min(bp, b.retOverDD); }
      if (!(Number.isFinite(wp) && Number.isFinite(bp) && wp > bp)) improvedWhereTrades = false;
      barVerdict[c.id] = windowsPriced(coin).filter((x) => cells[c.reg][c.tape][coin]?.[x.name]?.revx?.seededClears).map((x) => x.name);
    }
    const bothWF = CONDITIONS.every((c) => barVerdict[c.id].includes("A") && barVerdict[c.id].includes("B"));
    // Window A on all three tapes.
    const perCell: CoinArm["windowAThreeTapes"]["perCell"] = {};
    let cellsImproved = 0, cellsPriced = 0;
    for (const c of WINDOW_A_CONDITIONS) {
      const b = baselineWindowA[c.id];
      const a = sleeveOf(coinSet, "A", c.reg, c.tape, "revx");
      if (!b || !a) { perCell[c.id] = { baselineRetOverDD: b ? b.retOverDD : null, armRetOverDD: a ? a.stats.retOverDD : null, delta: null, improves: false }; continue; }
      cellsPriced++;
      const improves = a.stats.retOverDD > b.retOverDD;
      if (improves) cellsImproved++;
      perCell[c.id] = { baselineRetOverDD: b.retOverDD, armRetOverDD: a.stats.retOverDD, delta: r2(a.stats.retOverDD - b.retOverDD), improves };
    }
    return {
      arm: `${kind}·${coin.split("/")[0]}`, kind, coin, coinSet,
      perCondition, improvesAllConditions: improvedAll, conditionsImproved: improvedCount,
      improvesWhereTheCandidateTrades: improvedWhereTrades,
      windowsPresent: windowsPriced(coin).map((x) => x.name),
      barVerdictSeeded: barVerdict,
      ukBookUsdPerDay: UK_BOOK_USD_PER_DAY[coin] ?? null,
      slotUsdIfAdopted: Number((LIVE_ROW.capitalUsd / coinSet.length).toFixed(2)),
      windowAThreeTapes: { perCell, cellsImproved, cellsPriced, improvesOnAllThree: cellsPriced === WINDOW_A_CONDITIONS.length && cellsImproved === cellsPriced },
      clearsTheBar: {
        bothWalkForwardWindowsEveryCondition: bothWF,
        bookClears: (UK_BOOK_USD_PER_DAY[coin] ?? 0) >= MIN_BOOK_USD,
        admitted: bothWF && (UK_BOOK_USD_PER_DAY[coin] ?? 0) >= MIN_BOOK_USD,
      },
    };
  }

  for (const coin of LIVE_ROW.symbols) coinArms.push(priceCoinArm("drop", coin));
  for (const coin of addCandidates) coinArms.push(priceCoinArm("add", coin));

  const a1Passed = coinArms.filter((a) => a.improvesAllConditions).length;
  const a1PassedWeak = coinArms.filter((a) => a.improvesWhereTheCandidateTrades).length;
  const a1PassedWindowA = coinArms.filter((a) => a.windowAThreeTapes.improvesOnAllThree).length;
  // How near-duplicate are the four conditions? The share of arms on which all four agree.
  const a1Agreement = r3(coinArms.filter((a) => a.conditionsImproved === 0 || a.conditionsImproved === CONDITIONS.length).length / Math.max(1, coinArms.length));
  const a1AgreementWindowA = r3(coinArms.filter((a) => a.windowAThreeTapes.cellsImproved === 0 || a.windowAThreeTapes.cellsImproved === a.windowAThreeTapes.cellsPriced).length / Math.max(1, coinArms.length));

  report.a1_theCoins = {
    question: "Does the live row's coin set change? Leave-one-coin-out on all four windows and both tapes, and the ADD direction: every priced coin with the history, added as a sixth slot. A coin counts as a change only if it improves the sleeve on the WORST window under BOTH tapes and BOTH stop rules.",
    method: `Each arm is the coin SET it proposes, priced as the live row: seeded parameters, Revolut X costs, equal slots of capital / |coins| (capped by max_order_usd at adoption). A window's sleeve is the arm's members that HAVE that window; an equal-weight sleeve's return and drawdown are independent of the slot size, so a 4-coin arm, the 5-coin incumbent and a 6-coin arm are compared per unit of capital at risk rather than per dollar deployed. Ranked by the WORST window (§3.11), never averaged.`,
    baseline: {
      note: "the live five, by condition: the worst window and the whole four-window row",
      perCondition: Object.fromEntries(CONDITIONS.map((c) => [c.id, { worstWindow: baselineByCond[c.id].worst.window, worstRetOverDD: baselineByCond[c.id].worst.retOverDD, perWindow: baselineByCond[c.id].per }])),
      windowAThreeTapes: Object.fromEntries(WINDOW_A_CONDITIONS.map((c) => [c.id, baselineWindowA[c.id]])),
    },
    addCandidates: { count: addCandidates.length, symbols: addCandidates, note: "every accepted coin outside the live five with at least one priced window and a measured Revolut X UK book" },
    arms: coinArms,
    verdict: {
      armsLookedAt: coinArms.length,
      passedAllFourConditions: a1Passed,
      passedTheWeakerTest: a1PassedWeak,
      passedWindowAOnAllThreeTapes: a1PassedWindowA,
      conditionAgreementRate: a1Agreement,
      windowAThreeTapeAgreementRate: a1AgreementWindowA,
      addCandidatesAdmittedByTheBar: coinArms.filter((a) => a.kind === "add" && a.clearsTheBar.admitted).map((a) => a.coin),
      changed: coinArms.filter((a) => a.improvesAllConditions).map((a) => a.arm),
      changedInWindowAOnThreeTapes: coinArms.filter((a) => a.windowAThreeTapes.improvesOnAllThree).map((a) => a.arm),
      answer: a1Passed === 0 ? "no change" : "see `changed`",
    },
    control: control(coinArms.length, a1Passed, CONDITIONS.length),
    controlWeaker: control(coinArms.length, a1PassedWeak, CONDITIONS.length),
    controlWindowAThreeTapes: control(coinArms.length, a1PassedWindowA, WINDOW_A_CONDITIONS.length),
  };
  console.log(`A1: ${coinArms.length} arms, ${a1Passed} improve the worst window in all four conditions (weaker test: ${a1PassedWeak}; window A on three tapes: ${a1PassedWindowA})`);

  // ══════════════════════════════════════════════════════════ A2 — the weights

  type ArmName =
    | "equal" | "invVolSlots" | "equalRisk" | "volScaledPerEntry"
    | "evidencePrior" | "concentrated" | "windowsCleared"
    | "evidenceScoredWindowLookAhead" | "windowsClearedLookAhead";
  const ARMS: ArmName[] = ["equal", "invVolSlots", "equalRisk", "volScaledPerEntry", "evidencePrior", "concentrated", "windowsCleared", "evidenceScoredWindowLookAhead", "windowsClearedLookAhead"];
  const LOOK_AHEAD: ArmName[] = ["evidenceScoredWindowLookAhead", "windowsClearedLookAhead"];

  /** Normalise raw weights to 1 over the members present; all-zero falls back to equal, and says so. */
  function normalise(raw: Record<string, number>): { w: Record<string, number>; fellBack: boolean } {
    const keys = Object.keys(raw);
    const total = keys.reduce((a, k) => a + Math.max(0, raw[k]), 0);
    if (!(total > 0)) return { w: Object.fromEntries(keys.map((k) => [k, 1 / keys.length])), fellBack: true };
    return { w: Object.fromEntries(keys.map((k) => [k, Math.max(0, raw[k]) / total])), fellBack: false };
  }

  /** The per-entry volatility-scaled cores: §3.10 / §3.11's arm, which can only deploy LESS. */
  const volCores: Record<string, Record<string, Record<string, Partial<Record<WinName, SetResult>>>>> = {};
  for (const reg of STOP_RULES) {
    volCores[reg] = {};
    for (const tape of TAPES_ALL) {
      volCores[reg][tape] = {};
      for (const s of LIVE_ROW.symbols) {
        volCores[reg][tape][s] = {};
        for (const w of windowsPricedOn(s, tape)) {
          const b = boundsOn(s, w, tape);
          const target = (entryStats[reg][tape][s]?.[w.name] ?? entryStats[reg].kraken[s]?.[w.name])!.atrPct;
          const bars = b.oosArr;
          volCores[reg][tape][s][w.name] = runSet("trend-4h", s, bars, b.oosDaily, b.oosFrom, b.oosTo, DEFAULT_TREND, COSTS.revx, 4,
            surfaceOf(stopsOf(reg, DEFAULT_TREND)), (i: number) => {
              const a = atrAt(bars, i, SHIPPED_STOPS.atrN);
              if (a == null || !(a > 0)) return 1;
              return Math.min(1, target / (a / bars[i].close));
            }, null);
        }
      }
    }
  }

  function weightsFor(arm: ArmName, wname: WinName, reg: StopRule, tape: Tape, members: string[]): { w: Record<string, number>; fellBack: boolean; raw: Record<string, number> } {
    const keyed = (f: (sym: string) => number) => Object.fromEntries(members.map((s) => [s, f(s)]));
    // The venue's own tape reaches window A and nothing before it, so every weight computed on the PAST —
    // the in-sample entry volatility, the prior window's record, the windows-cleared count — is read from
    // KRAKEN's arm there: that is the series `signal_venue` gives the row, and it is the only past that
    // exists. The scored window's own numbers are read from the tape being priced.
    const past: Tape = tape === "revxuk" ? "kraken" : tape;
    const cell = (s: string, wn: WinName) => (wn === wname ? cells[reg][tape][s]?.[wn]?.revx : undefined) ?? cells[reg][past][s]?.[wn]?.revx;
    if (arm === "equal" || arm === "volScaledPerEntry") { const w = keyed(() => 1 / members.length); return { w, fellBack: false, raw: w }; }
    let raw: Record<string, number>;
    if (arm === "invVolSlots") raw = keyed((s) => { const a = entryStats[reg][past][s]?.[wname]?.atrPct ?? 0; return a > 0 ? 1 / a : 0; });
    else if (arm === "equalRisk") raw = keyed((s) => { const d = entryStats[reg][past][s]?.[wname]?.stopPct ?? 0; return d > 0 ? 1 / d : 0; });
    else if (arm === "evidencePrior") {
      const prior = priorWindowsOf(wname);
      const p = prior.length ? prior[prior.length - 1] : null;   // the window immediately before this one
      raw = keyed((s) => p ? Math.max(0, cell(s, p)?.seededOwn.ret ?? 0) : 0);
    } else if (arm === "concentrated") {
      const prior = priorWindowsOf(wname);
      const p = prior.length ? prior[prior.length - 1] : null;
      raw = keyed((s) => p && cell(s, p)?.seededClears ? 1 : 0);
    } else if (arm === "windowsCleared") {
      raw = keyed((s) => priorWindowsOf(wname).filter((wn) => cell(s, wn)?.seededClears).length);
    } else if (arm === "evidenceScoredWindowLookAhead") {
      raw = keyed((s) => Math.max(0, cell(s, wname)?.seededOwn.ret ?? 0));
    } else {
      raw = keyed((s) => LIVE_WINDOWS.filter((wn) => cell(s, wn)?.seededClears).length);
    }
    const n = normalise(raw);
    return { w: n.w, fellBack: n.fellBack, raw };
  }

  type WeightArmRow = {
    arm: ArmName; lookAhead: boolean;
    perCondition: Record<string, { perWindow: Partial<Record<WinName, SleeveStats & { weights: Record<string, number>; fellBack: boolean }>>; worstWindow: WinName | null; worstRetOverDD: number; delta: number; improves: boolean; maxOrderUsd: number }>;
    improvesAllConditions: boolean; conditionsImproved: number;
    windowAThreeTapes: { perCell: Record<string, { baselineRetOverDD: number | null; armRetOverDD: number | null; delta: number | null; improves: boolean; weights: Record<string, number> }>; cellsImproved: number; cellsPriced: number; beatsEqualOnAllThree: boolean };
  };

  /** One arm's sleeve on one window under one condition — the shared body of the four-window and window-A passes. */
  function weightedSleeve(arm: ArmName, wn: WinName, reg: StopRule, tape: Tape): { stats: SleeveStats; weights: Record<string, number>; fellBack: boolean } | null {
    const members = LIVE_ROW.symbols.filter((s) => cores[reg][tape][s]?.[wn]?.revx);
    if (members.length < 2) return null;
    const { w, fellBack } = weightsFor(arm, wn, reg, tape, members);
    // the sleeve's capital is the members' share of the row's $100 — the same money every arm splits
    const capital = LIVE_ROW.capitalUsd * members.length / LIVE_ROW.symbols.length;
    const rs: Record<string, SetResult> = {};
    for (const s of members) rs[s] = (arm === "volScaledPerEntry" ? volCores[reg][tape][s][wn] : cores[reg][tape][s][wn].revx)!;
    return { stats: sleeveFrom(rs, capital, w), weights: w, fellBack };
  }

  const weightArms: WeightArmRow[] = [];
  for (const arm of ARMS) {
    const perCondition: WeightArmRow["perCondition"] = {};
    let all = true, count = 0;
    for (const c of CONDITIONS) {
      const perWindow: WeightArmRow["perCondition"][string]["perWindow"] = {};
      let maxOrder = 0;
      for (const wn of LIVE_WINDOWS) {
        const s = weightedSleeve(arm, wn, c.reg, c.tape);
        if (!s) continue;
        maxOrder = Math.max(maxOrder, s.stats.maxOrderUsd);
        perWindow[wn] = { ...s.stats, weights: Object.fromEntries(Object.entries(s.weights).map(([k, v]) => [k, r3(v)])), fellBack: s.fellBack };
      }
      const worst = worstOf(perWindow as Partial<Record<WinName, SleeveStats>>);
      const base = baselineByCond[c.id].worst;
      const improves = Number.isFinite(worst.retOverDD) && worst.retOverDD > base.retOverDD;
      if (arm !== "equal") { if (improves) count++; else all = false; }
      perCondition[c.id] = { perWindow, worstWindow: worst.window, worstRetOverDD: worst.retOverDD, delta: r2(worst.retOverDD - base.retOverDD), improves, maxOrderUsd: r2(maxOrder) };
    }
    // Window A on all three tapes — the bear year, the venue's own book included.
    const perCell: WeightArmRow["windowAThreeTapes"]["perCell"] = {};
    let cellsImproved = 0, cellsPriced = 0;
    for (const c of WINDOW_A_CONDITIONS) {
      const b = baselineWindowA[c.id];
      const s = weightedSleeve(arm, "A", c.reg, c.tape);
      if (!b || !s) { perCell[c.id] = { baselineRetOverDD: b ? b.retOverDD : null, armRetOverDD: s ? s.stats.retOverDD : null, delta: null, improves: false, weights: {} }; continue; }
      cellsPriced++;
      const improves = s.stats.retOverDD > b.retOverDD;
      if (improves) cellsImproved++;
      perCell[c.id] = { baselineRetOverDD: b.retOverDD, armRetOverDD: s.stats.retOverDD, delta: r2(s.stats.retOverDD - b.retOverDD), improves, weights: Object.fromEntries(Object.entries(s.weights).map(([k, v]) => [k, r3(v)])) };
    }
    weightArms.push({
      arm, lookAhead: LOOK_AHEAD.includes(arm),
      improvesAllConditions: arm === "equal" ? false : all, conditionsImproved: arm === "equal" ? 0 : count, perCondition,
      windowAThreeTapes: { perCell, cellsImproved, cellsPriced, beatsEqualOnAllThree: arm !== "equal" && cellsPriced === WINDOW_A_CONDITIONS.length && cellsImproved === cellsPriced },
    });
  }
  // The `equal` arm reaches the incumbent by a different code path (explicit weights over the members present,
  // rather than A1's coin-set split), so it must reproduce A1's baseline to the digit or the two are not
  // comparable and nothing in A2 can be read against A1.
  {
    const eq = weightArms.find((a) => a.arm === "equal")!;
    let checks = 0, worst = 0;
    for (const c of CONDITIONS) for (const wn of LIVE_WINDOWS) {
      const a = eq.perCondition[c.id].perWindow[wn], b = baselineByCond[c.id].per[wn];
      if (!a || !b) continue;
      checks++;
      worst = Math.max(worst, Math.abs(a.ret - b.ret), Math.abs(a.maxDD - b.maxDD), Math.abs(a.capitalUsd - b.capitalUsd));
    }
    fid.equalArmVsBaseline = { note: "A2's `equal` arm against A1's baseline sleeve: same money, same members, two different code paths. Return, drawdown and capital, every condition × every window.", checks, worstAbsDiff: worst };
  }

  const a2Searched = weightArms.filter((a) => a.arm !== "equal" && !a.lookAhead);
  const a2Passed = a2Searched.filter((a) => a.improvesAllConditions).length;
  const a2PassedWindowA = a2Searched.filter((a) => a.windowAThreeTapes.beatsEqualOnAllThree).length;
  const a2Agreement = r3(a2Searched.filter((a) => a.conditionsImproved === 0 || a.conditionsImproved === CONDITIONS.length).length / Math.max(1, a2Searched.length));
  const a2AgreementWindowA = r3(a2Searched.filter((a) => a.windowAThreeTapes.cellsImproved === 0 || a.windowAThreeTapes.cellsImproved === a.windowAThreeTapes.cellsPriced).length / Math.max(1, a2Searched.length));

  report.a2_theWeights = {
    question: "Equal slots won on two windows by being the null nothing beat. Does anything beat it on four, under both tapes? Plus the arm §3.11 did not have: weighting by the number of windows a coin clears.",
    arms: {
      equal: "the null: each coin gets the same dollars",
      invVolSlots: "inverse volatility — 1 / median ATR(14) as a share of close at the in-sample entries",
      equalRisk: "1 / the BINDING stop distance at the in-sample entries, min(floor, atrStop × ATR / close). Under the shipped stop rule the binding distance is the 8 % floor for every entry, so this arm IS equal slots to the digit — a fact about the stop, not a coincidence (§3.11 point 1 said the same on two windows)",
      volScaledPerEntry: "the SLOT is equal but each ENTRY is scaled to the in-sample median ATR, capped at 1 — it can only deploy less",
      evidencePrior: "weighted by each coin's seeded return in the window immediately BEFORE this one in the calendar (D → C → B → A); a coin negative there gets nothing",
      concentrated: "only the coins that clear §4.15 on that same prior window, equally",
      windowsCleared: "NEW — weighted by how many strictly EARLIER windows the coin clears §4.15 on. §3.15 predicts this fails: across all four of its arms a coin that cleared window A was LESS likely to clear window B than a coin that failed it",
      evidenceScoredWindowLookAhead: "CONTROL, not a rule — weighted by the coin's return in the window being scored. An upper bound on what weighting by a coin's own record could ever do",
      windowsClearedLookAhead: "CONTROL — the windows-cleared count over ALL FOUR windows, including the one being scored",
    },
    method: "Every arm splits the SAME money — the row's $100, scaled to the members a window has — between the coins of the live five, on seeded parameters and Revolut X costs. Ranked by the WORST of the four windows, never averaged. The two look-ahead arms are bounds and are excluded from the control's arm count.",
    rows: weightArms,
    verdict: {
      armsSearched: a2Searched.length, armsIncludingControls: weightArms.length - 1,
      passedAllFourConditions: a2Passed,
      passedWindowAOnAllThreeTapes: a2PassedWindowA,
      conditionAgreementRate: a2Agreement,
      windowAThreeTapeAgreementRate: a2AgreementWindowA,
      beatsEqual: a2Searched.filter((a) => a.improvesAllConditions).map((a) => a.arm),
      beatsEqualInWindowAOnThreeTapes: a2Searched.filter((a) => a.windowAThreeTapes.beatsEqualOnAllThree).map((a) => a.arm),
      lookAheadBounds: Object.fromEntries(weightArms.filter((a) => a.lookAhead).map((a) => [a.arm, Object.fromEntries(CONDITIONS.map((c) => [c.id, a.perCondition[c.id].delta]))])),
      answer: a2Passed === 0 ? "equal slots stands" : "see `beatsEqual`",
    },
    control: control(a2Searched.length, a2Passed, CONDITIONS.length),
    controlWindowAThreeTapes: control(a2Searched.length, a2PassedWindowA, WINDOW_A_CONDITIONS.length),
  };
  console.log(`A2: ${a2Searched.length} searched arms (+2 look-ahead controls), ${a2Passed} beat equal slots in all four conditions (window A on three tapes: ${a2PassedWindowA})`);

  // ═══════════════════════════════════════════════════════ A3 — the mechanics

  /** The live five's sleeve under one mechanical setting, on one window and one condition. */
  function mechSleeve(wname: WinName, c: { reg: StopRule; tape: Tape }, surface: (p: TrendParams) => Surface, tr: Tranches | null): { stats: SleeveStats; smallestOrderFrac: number } | null {
    const members = LIVE_ROW.symbols.filter((s) => cores[c.reg][c.tape][s]?.[wname]?.revx);
    if (members.length < 2) return null;
    const rs: Record<string, SetResult> = {};
    let smallest = Infinity;
    for (const s of members) {
      const w = series[s].wins.find((x) => x.name === wname)!;
      const b = boundsOn(s, w, c.tape);
      const r = runSet("trend-4h", s, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, DEFAULT_TREND, COSTS.revx, 4, surface(DEFAULT_TREND), null, tr);
      rs[s] = r;
      if (r.minOrderFrac > 0) smallest = Math.min(smallest, r.minOrderFrac);
    }
    const capital = LIVE_ROW.capitalUsd * members.length / LIVE_ROW.symbols.length;
    return { stats: sleeveFrom(rs, capital), smallestOrderFrac: Number.isFinite(smallest) ? smallest : 0 };
  }

  type MechRow = {
    id: string; what: string;
    perCondition: Record<string, { perWindow: Partial<Record<WinName, SleeveStats>>; worstOfFour: number; worstWindowOfFour: WinName | null; worstOfTwoAB: number; worstWindowOfTwo: WinName | null; rankOfFour: number; rankOfTwo: number }>;
    improvesAllConditions: boolean; conditionsImproved: number;
    /** The STRONG test: better than the shipped setting on EVERY window, in every condition — not just on the worst one. */
    improvesEveryWindowAllConditions: boolean;
    smallestOrderUsd?: number; legality?: Record<string, unknown>;
  };

  function priceMechanics(name: string, rows: { id: string; what: string; surface: (p: TrendParams, reg: StopRule) => Surface; tr: Tranches | null; shipped: boolean }[]): { rows: MechRow[]; passed: number; passedEveryWindow: number; agreement: number; tradeOff: Record<string, unknown> } {
    const out: MechRow[] = rows.map((r) => ({ id: r.id, what: r.what, perCondition: {}, improvesAllConditions: true, conditionsImproved: 0, improvesEveryWindowAllConditions: true }));
    /** Per condition: how a setting's gain in the sideways year trades against its gain in the strong bull and in A/B. */
    const tradeOff: Record<string, unknown> = {};
    for (const c of CONDITIONS) {
      const per: { perWindow: Partial<Record<WinName, SleeveStats>>; worstOfFour: number; worstWindowOfFour: WinName | null; worstOfTwoAB: number; worstWindowOfTwo: WinName | null; smallest: number }[] = [];
      for (const r of rows) {
        const perWindow: Partial<Record<WinName, SleeveStats>> = {};
        let smallest = Infinity;
        for (const wn of LIVE_WINDOWS) {
          const s = mechSleeve(wn, c, (p) => r.surface(p, c.reg), r.tr);
          if (s) { perWindow[wn] = s.stats; if (s.smallestOrderFrac > 0) smallest = Math.min(smallest, s.smallestOrderFrac); }
        }
        const w4 = worstOf(perWindow);
        const ab: Partial<Record<WinName, SleeveStats>> = {};
        if (perWindow.A) ab.A = perWindow.A;
        if (perWindow.B) ab.B = perWindow.B;
        const w2 = worstOf(ab);
        per.push({ perWindow, worstOfFour: w4.retOverDD, worstWindowOfFour: w4.window, worstOfTwoAB: w2.retOverDD, worstWindowOfTwo: w2.window, smallest: Number.isFinite(smallest) ? smallest : 0 });
      }
      const order4 = per.map((p, i) => [p.worstOfFour, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
      const order2 = per.map((p, i) => [p.worstOfTwoAB, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
      const shippedIdx = rows.findIndex((r) => r.shipped);
      for (let i = 0; i < rows.length; i++) {
        out[i].perCondition[c.id] = {
          perWindow: per[i].perWindow, worstOfFour: per[i].worstOfFour, worstWindowOfFour: per[i].worstWindowOfFour,
          worstOfTwoAB: per[i].worstOfTwoAB, worstWindowOfTwo: per[i].worstWindowOfTwo,
          rankOfFour: order4.indexOf(i) + 1, rankOfTwo: order2.indexOf(i) + 1,
        };
        if (per[i].smallest > 0) out[i].smallestOrderUsd = Number((per[i].smallest * SLOT_BASE).toFixed(4));
        if (!rows[i].shipped) {
          const improves = per[i].worstOfFour > per[shippedIdx].worstOfFour;
          if (improves) out[i].conditionsImproved++; else out[i].improvesAllConditions = false;
          const everyWindow = LIVE_WINDOWS.every((wn) => {
            const a = per[i].perWindow[wn], b = per[shippedIdx].perWindow[wn];
            return !a || !b ? true : a.retOverDD > b.retOverDD;
          });
          if (!everyWindow) out[i].improvesEveryWindowAllConditions = false;
        }
      }
      // §3.17's S1 diagnostic, applied to the mechanics: a setting that helps the sideways year — does it pay
      // for it in the strong bull and in the two windows §3.13 chose on? Pearson over the settings of this search.
      const dOf = (wn: WinName, i: number) => {
        const a = per[i].perWindow[wn], b = per[shippedIdx].perWindow[wn];
        return a && b ? a.retOverDD - b.retOverDD : null;
      };
      const idx = rows.map((_, i) => i).filter((i) => i !== shippedIdx);
      const pairs = (x: WinName, y: WinName) => {
        const xs: number[] = [], ys: number[] = [];
        for (const i of idx) { const a = dOf(x, i), b = dOf(y, i); if (a != null && b != null) { xs.push(a); ys.push(b); } }
        return xs.length >= 3 ? r3(pearson(xs, ys) ?? NaN) : null;
      };
      const worstABd = idx.map((i) => {
        const a = per[i].worstOfTwoAB - per[shippedIdx].worstOfTwoAB, b = dOf("D", i);
        return b == null ? null : [b, a] as const;
      }).filter((x): x is readonly [number, number] => x != null);
      tradeOff[c.id] = {
        pearsonDeltaDvsDeltaC: pairs("D", "C"),
        pearsonDeltaDvsDeltaA: pairs("D", "A"),
        pearsonDeltaDvsDeltaB: pairs("D", "B"),
        pearsonDeltaDvsDeltaWorstOfAB: worstABd.length >= 3 ? r3(pearson(worstABd.map((p) => p[0]), worstABd.map((p) => p[1])) ?? NaN) : null,
        settings: idx.length,
      };
    }
    for (let i = 0; i < rows.length; i++) if (rows[i].shipped) { out[i].improvesAllConditions = false; out[i].conditionsImproved = 0; out[i].improvesEveryWindowAllConditions = false; }
    const searched = out.filter((_, i) => !rows[i].shipped);
    const passed = searched.filter((r) => r.improvesAllConditions).length;
    const passedEveryWindow = searched.filter((r) => r.improvesEveryWindowAllConditions).length;
    const agreement = r3(searched.filter((r) => r.conditionsImproved === 0 || r.conditionsImproved === CONDITIONS.length).length / Math.max(1, searched.length));
    console.log(`A3 ${name}: ${searched.length} arms, ${passed} beat the shipped setting on the worst of FOUR windows in all four conditions; ${passedEveryWindow} beat it on EVERY window`);
    return { rows: out, passed, passedEveryWindow, agreement, tradeOff };
  }

  // A3a — the re-entry cooldown, grid 0–8
  const COOLDOWNS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const a3a = priceMechanics("cooldown", COOLDOWNS.map((k) => ({
    id: `reentryBars=${k}`, what: k === SHIPPED_STOPS.reentryBars ? "what tick.ts runs" : "",
    surface: (p: TrendParams, reg: StopRule) => surfaceOf(stopsOf(reg, p), { reentryBars: k }), tr: null,
    shipped: k === SHIPPED_STOPS.reentryBars,
  })));

  // A3b — all-in / all-out against tranches and pyramiding (§3.13 Q4's variants)
  const TRANCHE_VARIANTS: { id: string; what: string; tr: Tranches | null }[] = [
    { id: "all-in / all-out (shipped)", what: "one order in, one order out", tr: null },
    { id: "in 2 on pullback 0.5×ATR", what: "half at the signal, half if it comes back half an ATR", tr: { entryFracs: [0.5, 0.5], trigger: "pullback", triggerAtr: 0.5, targetFrac: null, targetAtr: null } },
    { id: "in 2 on pullback 1×ATR", what: "half at the signal, half one ATR lower", tr: { entryFracs: [0.5, 0.5], trigger: "pullback", triggerAtr: 1, targetFrac: null, targetAtr: null } },
    { id: "in 3 on pullback 0.5×ATR", what: "thirds, each half an ATR lower", tr: { entryFracs: [1 / 3, 1 / 3, 1 / 3], trigger: "pullback", triggerAtr: 0.5, targetFrac: null, targetAtr: null } },
    { id: "in 2 on breakout 1×ATR (pyramid)", what: "half at the signal, half added one ATR higher", tr: { entryFracs: [0.5, 0.5], trigger: "breakout", triggerAtr: 1, targetFrac: null, targetAtr: null } },
    { id: "in 3 on breakout 1×ATR (pyramid)", what: "thirds, each an ATR higher", tr: { entryFracs: [1 / 3, 1 / 3, 1 / 3], trigger: "breakout", triggerAtr: 1, targetFrac: null, targetAtr: null } },
    { id: "in 3 on breakout 0.5×ATR (pyramid)", what: "thirds, each half an ATR higher", tr: { entryFracs: [1 / 3, 1 / 3, 1 / 3], trigger: "breakout", triggerAtr: 0.5, targetFrac: null, targetAtr: null } },
    { id: "in 1, out half at 2×ATR", what: "half out at a two-ATR profit target, the rest on the rule", tr: { entryFracs: [1], trigger: "pullback", triggerAtr: 1, targetFrac: 0.5, targetAtr: 2 } },
    { id: "in 1, out half at 3×ATR", what: "half out at three ATR", tr: { entryFracs: [1], trigger: "pullback", triggerAtr: 1, targetFrac: 0.5, targetAtr: 3 } },
    { id: "in 1, out a third at 2×ATR", what: "a third out at two ATR", tr: { entryFracs: [1], trigger: "pullback", triggerAtr: 1, targetFrac: 1 / 3, targetAtr: 2 } },
    { id: "in 2 pullback 0.5, out half at 2×ATR", what: "scaled both ways", tr: { entryFracs: [0.5, 0.5], trigger: "pullback", triggerAtr: 0.5, targetFrac: 0.5, targetAtr: 2 } },
    { id: "in 2 breakout 1, out half at 3×ATR", what: "pyramid in, scale out", tr: { entryFracs: [0.5, 0.5], trigger: "breakout", triggerAtr: 1, targetFrac: 0.5, targetAtr: 3 } },
  ];
  const a3b = priceMechanics("sizing", TRANCHE_VARIANTS.map((v) => ({
    id: v.id, what: v.what, surface: (p: TrendParams, reg: StopRule) => surfaceOf(stopsOf(reg, p)), tr: v.tr, shipped: v.tr == null,
  })));
  for (let i = 0; i < a3b.rows.length; i++) {
    const v = TRANCHE_VARIANTS[i];
    const planned = v.tr ? Math.min(...v.tr.entryFracs, ...(v.tr.targetFrac != null ? [v.tr.targetFrac, 1 - v.tr.targetFrac] : [1])) : 1;
    a3b.rows[i].legality = {
      smallestPlannedOrderUsd: Number((planned * SLOT_BASE).toFixed(4)),
      revxLegalMajors: planned * SLOT_BASE >= 0.10,
      revxLegalAvaxSui: "unmeasured — §2.1 read min_order_size_quote for BTC/ETH/SOL only",
    };
  }

  // A3c — the stop surface: the floor grid × a time stop, under each stop rule's own trail
  const FLOORS: (number | null)[] = [0.06, 0.08, 0.10, 0.12, 0.15, null];
  const TIMESTOPS: (number | null)[] = [null, 10, 20, 40];
  const surfaceRows: { id: string; what: string; f: number | null; ts: number | null }[] = [];
  for (const f of FLOORS) for (const ts of TIMESTOPS) {
    surfaceRows.push({ id: `floor=${f == null ? "none" : (f * 100).toFixed(0) + "%"}|time=${ts == null ? "none" : ts}`, what: "", f, ts });
  }
  const SHIPPED_SURFACE_ID = "floor=8%|time=none";
  const a3c = priceMechanics("stop surface", surfaceRows.map((r) => ({
    id: r.id, what: r.id === SHIPPED_SURFACE_ID ? "what tick.ts runs under the shipped stop rule" : "",
    surface: (p: TrendParams, reg: StopRule) => surfaceOf(stopsOf(reg, p), { maxLossPct: r.f, timeStopBars: r.ts }), tr: null,
    shipped: r.id === SHIPPED_SURFACE_ID,
  })));

  const a3Arms = (a3a.rows.length - 1) + (a3b.rows.length - 1) + (a3c.rows.length - 1);
  const a3Passed = a3a.passed + a3b.passed + a3c.passed;

  /** Does the ranking MOVE once window D is in it? The shipped setting's rank on the worst of four against the worst of A and B. */
  function rankShift(rows: MechRow[], shippedId: string) {
    const per = Object.fromEntries(CONDITIONS.map((c) => {
      const s = rows.find((r) => r.id === shippedId)!.perCondition[c.id];
      const bestFour = rows.slice().sort((a, b) => b.perCondition[c.id].worstOfFour - a.perCondition[c.id].worstOfFour)[0];
      const bestTwo = rows.slice().sort((a, b) => b.perCondition[c.id].worstOfTwoAB - a.perCondition[c.id].worstOfTwoAB)[0];
      return [c.id, {
        shippedRankOnFour: s.rankOfFour, shippedRankOnTwo: s.rankOfTwo, of: rows.length,
        bestOnFour: bestFour.id, bestOnTwo: bestTwo.id, sameWinner: bestFour.id === bestTwo.id,
        shippedWorstOfFour: s.worstOfFour, shippedWorstWindowOfFour: s.worstWindowOfFour,
      }];
    }));
    const spearmanOfRanks = Object.fromEntries(CONDITIONS.map((c) => {
      const xs = rows.map((r) => r.perCondition[c.id].rankOfFour), ys = rows.map((r) => r.perCondition[c.id].rankOfTwo);
      return [c.id, xs.length >= 3 ? r3(pearson(xs, ys) ?? NaN) : null];
    }));
    return { perCondition: per, rankCorrelationFourVsTwo: spearmanOfRanks };
  }

  report.a3_theMechanics = {
    question: "§3.13 settled the cooldown, all-in/all-out and the stop surface on TWO windows. Window D — the sideways year — was never available when they were chosen. The question is not whether anything fixes D (§3.17: nothing does, 0 of 33 gates) but whether any of these three settings LOOKS DIFFERENT once D is in the ranking.",
    method: "Every setting is priced as the live row: the five coins, seeded parameters, Revolut X costs, equal $20 slots, all four windows on both tapes under both stop rules. Each row carries its rank by the worst of FOUR windows and by the worst of A and B alone — the ranking §3.13 used — so the effect of adding D is readable directly.",
    cooldown: {
      grid: COOLDOWNS, shipped: SHIPPED_STOPS.reentryBars,
      rows: a3a.rows, passed: a3a.passed, passedOnEveryWindow: a3a.passedEveryWindow, conditionAgreementRate: a3a.agreement,
      rankShift: rankShift(a3a.rows, `reentryBars=${SHIPPED_STOPS.reentryBars}`),
      sidewaysTradeOff: a3a.tradeOff,
      control: control(a3a.rows.length - 1, a3a.passed, CONDITIONS.length),
    },
    sizing: {
      shipped: "all-in / all-out",
      rows: a3b.rows, passed: a3b.passed, passedOnEveryWindow: a3b.passedEveryWindow, conditionAgreementRate: a3b.agreement,
      rankShift: rankShift(a3b.rows, "all-in / all-out (shipped)"),
      sidewaysTradeOff: a3b.tradeOff,
      control: control(a3b.rows.length - 1, a3b.passed, CONDITIONS.length),
    },
    stopSurface: {
      grid: { floors: FLOORS, timeStopBars: TIMESTOPS, settings: surfaceRows.length, note: "the floor under average cost × a bar-close time stop, under each stop rule's OWN trail (none under `shipped`, 3×ATR(14) under `trail`); the intra-bar ATR trail is not re-litigated here — §3.13 owns it and tick.ts already dropped it" },
      shipped: SHIPPED_SURFACE_ID,
      rows: a3c.rows, passed: a3c.passed, passedOnEveryWindow: a3c.passedEveryWindow, conditionAgreementRate: a3c.agreement,
      rankShift: rankShift(a3c.rows, SHIPPED_SURFACE_ID),
      sidewaysTradeOff: a3c.tradeOff,
      control: control(a3c.rows.length - 1, a3c.passed, CONDITIONS.length),
    },
    verdict: {
      armsLookedAt: a3Arms, passedAllFourConditions: a3Passed,
      passedOnEveryWindow: a3a.passedEveryWindow + a3b.passedEveryWindow + a3c.passedEveryWindow,
      changed: [...a3a.rows, ...a3b.rows, ...a3c.rows].filter((r) => r.improvesAllConditions).map((r) => r.id),
      changedOnEveryWindow: [...a3a.rows, ...a3b.rows, ...a3c.rows].filter((r) => r.improvesEveryWindowAllConditions).map((r) => r.id),
      answer: a3Passed === 0 ? "no change to any of the three" : "see `changed` — and read `passedOnEveryWindow` beside it: an arm that wins only the worst window has BOUGHT it somewhere else, and `sidewaysTradeOff` prices that trade",
    },
    control: control(a3Arms, a3Passed, CONDITIONS.length),
  };

  // ═══════════════════════════════════════════════════════════ A4 — the venue

  type VenueRow = {
    symbol: string; windows: string[];
    perCondition: Record<string, { perWindow: Record<string, { revx: number; kraken: number; dRetOverDD: number; revxRet: number; krakenRet: number; dRet: number }>; worstWindow: string | null; revxWorst: number; krakenWorst: number; krakenBeatsRevxOnWorst: boolean }>;
    krakenBeatsInAnyCondition: boolean; conditionsKrakenWins: number; conditionsKrakenWinsUnderShipped: number;
    roundTripBpsRevx: number; roundTripBpsKraken: number;
    /** Window A on the venue's OWN book: the most realistic cell in this repository for the bear year. */
    windowAOnRevxTape: Record<string, { revxRetOverDD: number; krakenRetOverDD: number; revxRet: number; krakenRet: number; krakenBeats: boolean } | null>;
  };
  const venueRows: VenueRow[] = [];
  let a4Cells = 0, a4KrakenWinsCell = 0, a4Ties = 0;
  let a4RevxTapeCells = 0, a4RevxTapeKrakenWins = 0;
  for (const s of symbols) {
    const wins = windowsPriced(s).map((w) => w.name);
    if (!wins.length) continue;
    const perCondition: VenueRow["perCondition"] = {};
    let anyWin = false, winCount = 0;
    for (const c of CONDITIONS) {
      const perWindow: Record<string, { revx: number; kraken: number; dRetOverDD: number; revxRet: number; krakenRet: number; dRet: number }> = {};
      let revxWorst = Infinity, krakenWorst = Infinity, worstWindow: string | null = null;
      for (const wn of wins) {
        const cell = cells[c.reg][c.tape][s]?.[wn];
        if (!cell) continue;
        const rv = cell.revx.seededOwn, kr = cell.kraken.seededOwn;
        perWindow[wn] = { revx: rv.retOverDD, kraken: kr.retOverDD, dRetOverDD: r2(kr.retOverDD - rv.retOverDD), revxRet: rv.ret, krakenRet: kr.ret, dRet: r4(kr.ret - rv.ret) };
        a4Cells++;
        if (kr.ret > rv.ret) a4KrakenWinsCell++; else if (kr.ret === rv.ret) a4Ties++;
        if (rv.retOverDD < revxWorst) { revxWorst = rv.retOverDD; worstWindow = wn; }
        krakenWorst = Math.min(krakenWorst, kr.retOverDD);
      }
      const beats = Number.isFinite(krakenWorst) && Number.isFinite(revxWorst) && krakenWorst > revxWorst;
      if (beats) { anyWin = true; winCount++; }
      perCondition[c.id] = { perWindow, worstWindow, revxWorst, krakenWorst, krakenBeatsRevxOnWorst: beats };
    }
    const windowAOnRevxTape: VenueRow["windowAOnRevxTape"] = {};
    for (const reg of STOP_RULES) {
      const cell = cells[reg].revxuk[s]?.A;
      if (!cell) { windowAOnRevxTape[reg] = null; continue; }
      const rv = cell.revx.seededOwn, kr = cell.kraken.seededOwn;
      a4RevxTapeCells++;
      if (kr.ret > rv.ret) a4RevxTapeKrakenWins++;
      windowAOnRevxTape[reg] = { revxRetOverDD: rv.retOverDD, krakenRetOverDD: kr.retOverDD, revxRet: rv.ret, krakenRet: kr.ret, krakenBeats: kr.retOverDD > rv.retOverDD };
    }
    venueRows.push({
      symbol: s, windows: wins, perCondition,
      krakenBeatsInAnyCondition: anyWin, conditionsKrakenWins: winCount,
      conditionsKrakenWinsUnderShipped: CONDITIONS.filter((c) => c.reg === "shipped" && perCondition[c.id].krakenBeatsRevxOnWorst).length,
      roundTripBpsRevx: Number((2 * (COSTS.revx.takerBps + spreadOf(COSTS.revx, s) * 1e4)).toFixed(2)),
      roundTripBpsKraken: Number((2 * (COSTS.kraken.makerBps + spreadOf(COSTS.kraken, s) * 1e4)).toFixed(2)),
      windowAOnRevxTape,
    });
  }
  const a4Winners = venueRows.filter((r) => r.krakenBeatsInAnyCondition);
  report.a4_theVenue = {
    question: "Asked ONE way only, because it has been asked three times and answered no three times (§3.11 point 3, §3.12, §3.14 — 952 coin-window cells, Kraken never beat the same rule at Revolut X's fees): is there ANY coin, on four windows and both tapes, whose KRAKEN figure beats its Revolut X figure on the WORST window?",
    method: "Same rule, same tape, same calendar, same seeded parameters — only the cost schedule changes (Revolut X: 9 bps taker + half its spread per side; Kraken: 40 bps maker + half its spread). Ranked by the worst of the coin's priced windows, under both tapes and both stop rules. This is the venue's cost, not its signal: the signal is Kraken's on the `kraken` tape in both columns.",
    coins: venueRows.length,
    rows: venueRows,
    cellLevel: {
      note: "one coin × one window × one condition, seeded, return: how often does the Kraken column beat the Revolut X one at all?",
      cells: a4Cells, krakenHigher: a4KrakenWinsCell, revxHigher: a4Cells - a4KrakenWinsCell - a4Ties, identical: a4Ties,
      signTest: signTest(a4KrakenWinsCell, a4Cells - a4KrakenWinsCell - a4Ties),
    },
    windowAOnTheVenuesOwnTape: {
      note: "The same question in the bear year on Revolut X's OWN UK book — the tape the orders would actually meet. Seeded parameters; the venue's tape cannot reach window A's in-sample so no parameter is chosen on it, which is stated rather than worked around.",
      coinsPriced: venueRows.filter((r) => r.windowAOnRevxTape.shipped != null).length,
      cells: a4RevxTapeCells, krakenHigherReturn: a4RevxTapeKrakenWins, revxHigherReturn: a4RevxTapeCells - a4RevxTapeKrakenWins,
      coinsWhereKrakenBeats: venueRows.filter((r) => STOP_RULES.some((reg) => r.windowAOnRevxTape[reg]?.krakenBeats)).map((r) => r.symbol),
    },
    roundTripSpread: {
      note: "Revolut X is cheaper than Kraken on a round trip for EVERY priced coin — the largest Revolut X round trip is still under the smallest Kraken one — which is why this question has one answer and will keep having it until a fee tier moves",
      worstRevx: Math.max(...venueRows.map((r) => r.roundTripBpsRevx)),
      bestKraken: Math.min(...venueRows.map((r) => r.roundTripBpsKraken)),
    },
    verdict: {
      coinsWhereKrakenBeatsRevxOnTheWorstWindowInAnyCondition: a4Winners.map((r) => ({ symbol: r.symbol, conditions: r.conditionsKrakenWins, underTheShippedStopRule: r.conditionsKrakenWinsUnderShipped })),
      coinsUnderTheShippedStopRule: venueRows.filter((r) => r.conditionsKrakenWinsUnderShipped > 0).map((r) => r.symbol),
      answer: a4Winners.length === 0
        ? "No. Settled — and the question should stop being asked: Kraken's cost schedule is strictly worse than Revolut X's on every priced coin, so the only way this answer changes is a fee tier, not a backtest."
        : "see the list",
    },
    control: control(venueRows.length, a4Winners.length, CONDITIONS.length),
  };
  console.log(`A4: ${venueRows.length} coins, ${a4Winners.length} where Kraken beats Revolut X on the worst window in any condition`);

  // ═══════════════════════════════════════════════════════ A5 — the set that follows

  // The momentum row, priced on both tapes for the first time — §3.17 priced it on one.
  const momentumCores: Record<string, Record<string, Record<string, Partial<Record<WinName, SetResult>>>>> = {};
  for (const reg of STOP_RULES) {
    momentumCores[reg] = {};
    for (const tape of TAPES) {
      momentumCores[reg][tape] = {};
      for (const s of MOMENTUM_ROW.symbols) {
        momentumCores[reg][tape][s] = {};
        for (const w of windowsPriced(s)) {
          const b = boundsOn(s, w, tape);
          momentumCores[reg][tape][s][w.name] = runSet("momentum-1d", s, b.oosArr, b.oosDaily, b.oosFrom, b.oosTo, DEFAULT_TREND, COSTS.revx, 4, surfaceOf(stopsOf(reg, DEFAULT_TREND)), null, null);
        }
      }
    }
  }
  function rowBlock(label: string, syms: string[], capital: number, venue: Venue, pick2: (reg: StopRule, tape: Tape, s: string, wn: WinName) => SetResult | undefined) {
    const per: Record<string, unknown> = {};
    for (const c of CONDITIONS) {
      const w4: Partial<Record<WinName, SleeveStats>> = {};
      for (const wn of LIVE_WINDOWS) {
        const rs: Record<string, SetResult> = {};
        for (const s of syms) { const r = pick2(c.reg, c.tape, s, wn); if (r) rs[s] = r; }
        if (Object.keys(rs).length < 2) continue;
        w4[wn] = sleeveFrom(rs, capital * Object.keys(rs).length / syms.length);
      }
      const worst = worstOf(w4);
      per[c.id] = { perWindow: w4, worstWindow: worst.window, worstRetOverDD: worst.retOverDD, worstRet: worst.ret };
    }
    return { row: label, venue, symbols: syms, capitalUsd: capital, slotUsd: Number((capital / syms.length).toFixed(2)), perCondition: per };
  }

  const a5Rows = [
    rowBlock("trend-4h·revx (live)", LIVE_ROW.symbols, LIVE_ROW.capitalUsd, "revx", (reg, tape, s, wn) => cores[reg][tape][s]?.[wn]?.revx),
    rowBlock("trend-4h·kraken (paper twin)", LIVE_ROW.symbols, LIVE_ROW.capitalUsd, "kraken", (reg, tape, s, wn) => cores[reg][tape][s]?.[wn]?.kraken),
    rowBlock("momentum-1d·revx (paper)", MOMENTUM_ROW.symbols, MOMENTUM_ROW.capitalUsd, "revx", (reg, tape, s, wn) => momentumCores[reg][tape][s]?.[wn]),
  ];

  {
    const rows = a5Rows.map((r) => {
      const here = (r.perCondition["shipped·coinbase"] as { worstRetOverDD: number } | undefined)?.worstRetOverDD ?? NaN;
      const pub = PUBLISHED_3_17_WORST[r.row];
      return { row: r.row, published: pub, here, delta: r4(here - pub) };
    });
    fid.publishedTestingSet = {
      note: "Reference §3.17's §S2 table — each row's worst-window return over drawdown under the shipped stops on the Coinbase tape — typed in from the document and recomputed here. §3.17 rounds to two decimals, so anything at or under 0.005 is that rounding.",
      rows, worstAbsDelta: Math.max(...rows.map((r) => Math.abs(r.delta))),
    };
    console.log(`§3.17 row cross-check: worst |Δ| ${Math.max(...rows.map((r) => Math.abs(r.delta)))}`);
  }

  report.a5_theSet = {
    question: "The rows, coins, weights, capital and mechanics this evidence supports, against what runs today (§3.17 S4, migration 0043: live `trend-4h·revx` $100; paper `trend-4h-kraken` $100, `momentum-1d·revx` $40, `trend-1h·revx` $40).",
    supported: {
      row: LIVE_ROW.row, venue: LIVE_ROW.venue, coins: LIVE_ROW.symbols,
      weights: "equal slots", capitalUsd: LIVE_ROW.capitalUsd, slotUsd: SLOT_BASE,
      mechanics: { reentryBars: SHIPPED_STOPS.reentryBars, sizing: "all-in / all-out", floorPct: SHIPPED_STOPS.maxLossPct, intraBarTrail: null, timeStop: null },
      note: "identical to what runs today in every field — this study changes nothing, and the margins by which each choice survives are the result",
    },
    rows: a5Rows,
    notPricedHere: {
      "trend-1h·revx": "the Kraken tape supplied to this study is 4-hourly, and Kraken's hourly bundle ends 2026-06-30, so the 1-hour row cannot be priced on the tape the loop reads over window A. §3.17's four-window pricing on the Coinbase tape stands and is not re-asked here.",
      rows: "which ROWS exist was settled by §3.17 on four windows two days before this run; this study re-asks the live row's own definition, not the row list",
    },
  };

  // ══════════════════════════════════════════════ the study-wide control

  const totalArms = coinArms.length + a2Searched.length + a3Arms + venueRows.length;
  const totalPassed = a1Passed + a2Passed + a3Passed + a4Winners.length;
  report.multipleComparisons = {
    note: "Every search in this file, added up. An arm passes only by beating the incumbent on the WORST of its four windows in ALL FOUR evaluations (two tapes × two stop rules). The two nulls bracket the truth: the four evaluations are near-duplicates of one another, not independent tests, so the fully-correlated column is the one to quote when nothing passes — it is the hardest for 'nothing changed' to clear.",
    perSearch: {
      a1_coins: { arms: coinArms.length, passed: a1Passed, control: control(coinArms.length, a1Passed, CONDITIONS.length) },
      a2_weights: { arms: a2Searched.length, passed: a2Passed, control: control(a2Searched.length, a2Passed, CONDITIONS.length) },
      a3_cooldown: { arms: a3a.rows.length - 1, passed: a3a.passed, control: control(a3a.rows.length - 1, a3a.passed, CONDITIONS.length) },
      a3_sizing: { arms: a3b.rows.length - 1, passed: a3b.passed, control: control(a3b.rows.length - 1, a3b.passed, CONDITIONS.length) },
      a3_stopSurface: { arms: a3c.rows.length - 1, passed: a3c.passed, control: control(a3c.rows.length - 1, a3c.passed, CONDITIONS.length) },
      a4_venue: { arms: venueRows.length, passed: a4Winners.length, control: control(venueRows.length, a4Winners.length, CONDITIONS.length) },
    },
    whole: control(totalArms, totalPassed, CONDITIONS.length),
    gridPointsEvaluated: gridArms,
    caution: "The stop-surface grid is ONE idea in 24 forms and the sizing grid is one idea in 12; counting them as 34 independent arms overstates the search, exactly as §3.13's own report said of its 262. The searches whose arms genuinely differ are the coin set and the weighting, and those are the two to read the control on.",
  };

  // ── integrity and write ─────────────────────────────────────────────────
  const btHashEnd = await sha(btPath);
  if (btHashEnd !== btHashStart) throw new Error(`backtest.ts changed during the run (${btHashStart} → ${btHashEnd}); the output would mix two rulebooks`);
  report.sourceIntegrity = {
    note: "`backtest.ts` is SHA-256'd at the start and the end of the run; a run that straddles an edit throws rather than writing a file that mixes two rulebooks.",
    backtestTsSha256: btHashStart,
  };

  await Deno.writeTextFile(`${outDir}/set2.json`, JSON.stringify(report, null, 1) + "\n");
  console.log(`wrote ${outDir}/set2.json in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
}
