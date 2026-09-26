// fp6 H4 — TREND-LS: the live trend rule with a SHORT leg on Binance USDⓈ-M perpetuals.
// Pre-registration: docs/agents/reviews/2026-09-26-fp6-prereg-trend-ls.md (its rule is this
// file's). A study, not a rulebook: nothing here is imported by the loop.
//
// This file holds the DECISIONS only — which bar a coin goes long, goes short, exits, or is
// stopped — for the four coins of `trend-4h-live` on the house's four evaluations (two tapes ×
// two stop rules) and windows A–D. It computes no price return, no fee and no funding: phase 1
// of fp6 reads only the counts it prints (the power check). Phase 2's scorer imports
// `simulate` from here, adds the accounting the pre-registration fixes, and must reproduce the
// incumbent's published entries and returns with the short leg switched off before it prices
// anything else.
//
//   deno run --allow-read docs/agents/backtests/fp6/trend_ls.ts \
//     --data <dir with BTC-USD_1h_3y.json …> --ext <dir with BTC-USD_1h_kraken.json …> \
//     --ktape <dir with BTC-USD_4h_kraken.json …> [--stage counts]
//
// ── the long leg ─────────────────────────────────────────────────────
// Exactly `backtest_jev.ts` `runGated` driven by the shipped rulebook (`ruleFor("trend-4h")`):
// an entry or a rule exit fills at the NEXT bar's open; while long and the rule holds, the
// floor 8 % under cost (and, in the `trail` evaluations, 3 × ATR(14) under the high-water
// mark) is read against the next bar's low; the high-water mark advances by each bar's high;
// after ANY exit no entry for two bars. With the short leg off, `simulate` must give the
// incumbent's entries bar for bar (the `counts` stage checks it against btc_regime.json).
//
// ── the short leg (the mirror) ───────────────────────────────────────
// Flat, not cooling down, and the long rule does not enter: SHORT when
//   the 4h trend is "down" (fast SMA 0.2 % under the slow one, the snapshot's own word),
//   the close is below the lowest low of the prior 55 bars (`priorRange(…, breakoutUp)`),
//   the 30-day momentum is not "positive" (negative or unknown — the mirror of the long rule's
//   "not negative"), and the volatility is not "extreme".
// Short: EXIT (at the next open) when the trend is "up", or the close is above the highest high
// of the prior 20 bars (`priorRange(…, breakoutDown)`), or the close is above the low-water mark
// plus 3 × ATR(14) (the rulebook's own close trail, mirrored). Between closes: the floor 8 %
// ABOVE the short's cost (and, in the `trail` evaluations, 3 × ATR(14) above the low-water mark)
// read against the next bar's HIGH. The low-water mark falls with each bar's low. The same
// two-bar cooldown after ANY exit, long or short. A coin is never long and short at once.

import {
  atrAt, buildSnapshot, DEFAULT_TREND, FLAT, precompute, priorRange, ruleFor,
  type Candle, type Position, type Snapshot, type TrendParams,
} from "../../../../supabase/functions/_shared/agents_strategy.ts";
import { COSTS, type StopParams } from "../../../../supabase/functions/agents/backtest.ts";
import {
  BAR_HOURS, BARS_PER_YEAR, CONDITIONS, loadMeasuredSeries, stopsOf,
  type Condition, type MeasuredSeries, type WinName,
} from "../../../../supabase/functions/agents/backtest_jev.ts";

export const SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD"] as const;
export const WINDOWS: WinName[] = ["A", "B", "C", "D"];
/**
 * Binance USDⓈ-M half-spreads (fractions of price) the perpetual legs fill at: the median of twenty
 * bookTicker samples, 60 s apart, 2026-09-26 21:09–21:28 UTC (fetch.py `books`, inputs/books.json.gz),
 * half the full spread — one tick on all four books: BTC 0.006, ETH 0.019, SOL 0.414, AVAX 0.467 bps.
 * Frozen with the pre-registration.
 */
export const PERP_HALF_SPREAD: Record<string, number> = { "BTC/USD": 0.006e-4, "ETH/USD": 0.019e-4, "SOL/USD": 0.414e-4, "AVAX/USD": 0.467e-4 };

export type Side = "long" | "short";
export type Trade = {
  side: Side;
  /** The decision bar; the fill is at bars[entryBar + 1].open. */
  entryBar: number;
  /** The bar whose NEXT open fills the exit (rule exit), or whose next bar carried the stop. */
  exitBar: number;
  /** "rule" (next open), "stop" (the level inside the next bar, or its open when it gaps through), "end" (window closed). */
  how: "rule" | "stop" | "end";
  /** Bars held: from the fill bar to the exit fill bar. */
  bars: number;
};

/** The short rule's entry test, on a snapshot built flat. */
export function shortEntry(snap: Snapshot, bars: Candle[], i: number, p: TrendParams): boolean {
  const s = snap.state;
  if (s.trend_4h !== "down") return false;
  const r = priorRange(bars, i, p.breakoutUp);
  if (!r || !(snap.numbers.close < r.low)) return false;
  if (s.momentum_30d === "positive") return false;
  if (s.volatility === "extreme") return false;
  return true;
}

/** The short rule's exit test while short. `lowWater` is the lowest low since the fill. */
export function shortExit(snap: Snapshot, bars: Candle[], i: number, p: TrendParams, lowWater: number | null): boolean {
  if (snap.state.trend_4h === "up") return true;
  const r = priorRange(bars, i, p.breakoutDown);
  if (r && snap.numbers.close > r.high) return true;
  const atr = snap.numbers.atr;
  if (atr != null && lowWater != null && snap.numbers.close > lowWater + p.atrStop * atr) return true;
  return false;
}

/**
 * One coin, one window, one evaluation: the positions the rule takes, bar by bar. Prices are
 * read only to decide (closes, highs and lows against levels); nothing is priced.
 * `from`/`to` are the loader's out-of-sample span (to is exclusive), as `runGated` takes them.
 */
export function simulate(
  symbol: string, bars: Candle[], daily: Candle[], from: number, to: number,
  p: TrendParams, stops: StopParams, withShort: boolean,
  /** Half-spreads as fractions: the long fills at open × (1 + hsLong) (runGated's), the short at open × (1 − hsShort). */
  hsLong: number, hsShort: number,
): Trade[] {
  const pre = precompute(bars, p);
  const warmup = p.slow + 1;
  const start = Math.max(from, warmup);
  const trades: Trade[] = [];
  const closed: Candle[] = [];
  let dk = 0;
  let side: Side | null = null;
  let entryBar = -1, fillBar = -1;
  let avgCost = 0;                       // the fill's own price level (the next open) — the floor's anchor
  let highWater: number | null = null;   // long: runGated's pos.highWater
  let lowWater: number | null = null;    // short: the mirror
  let openedAt: number | null = null;
  let lastExitBar = -Infinity;
  const close = (how: Trade["how"], i: number, fill: number) => {
    trades.push({ side: side!, entryBar, exitBar: i, how, bars: fill - fillBar });
    side = null; highWater = null; lowWater = null; openedAt = null;
    lastExitBar = fill;
  };
  for (let i = start; i < to - 1; i++) {
    const nowMs = bars[i].start + BAR_HOURS * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    const coolingDown = i - lastExitBar < stops.reentryBars;
    const next = bars[i + 1];
    if (side === "long") {
      // runGated's long branch, with the position the rulebook sees (base > 0, cost, high-water, opened-at).
      const pos: Position = { ...FLAT, base: 1, avgCost, highWater, openedAt };
      const snap = buildSnapshot(symbol, bars, i, closed, pos, nowMs, p, pre, BARS_PER_YEAR);
      const act = ruleFor("trend-4h", snap, pos, p).action;
      if (act === "exit") {
        close("rule", i, i + 1);
      } else {
        const hw = Math.max(highWater ?? avgCost, avgCost);
        const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
        const floor = avgCost * (1 - stops.maxLossPct);
        const trail = stops.atrStop != null && atr != null ? hw - stops.atrStop * atr : -Infinity;
        const level = Math.max(floor, trail);
        if (next.low <= level) close("stop", i, i + 1);
      }
    } else if (side === "short") {
      const snap = buildSnapshot(symbol, bars, i, closed, FLAT, nowMs, p, pre, BARS_PER_YEAR);
      if (shortExit(snap, bars, i, p, lowWater)) {
        close("rule", i, i + 1);
      } else {
        const lw = Math.min(lowWater ?? avgCost, avgCost);
        const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
        const floor = avgCost * (1 + stops.maxLossPct);
        const trail = stops.atrStop != null && atr != null ? lw + stops.atrStop * atr : Infinity;
        const level = Math.min(floor, trail);
        if (next.high >= level) close("stop", i, i + 1);
      }
    } else if (!coolingDown) {
      const snap = buildSnapshot(symbol, bars, i, closed, FLAT, nowMs, p, pre, BARS_PER_YEAR);
      if (ruleFor("trend-4h", snap, FLAT, p).action === "enter") {
        // applyFill: avgCost is the fill price, and highWater starts at it.
        side = "long"; entryBar = i; fillBar = i + 1; avgCost = next.open * (1 + hsLong); openedAt = next.start;
        highWater = avgCost;
      } else if (withShort && shortEntry(snap, bars, i, p)) {
        side = "short"; entryBar = i; fillBar = i + 1; avgCost = next.open * (1 - hsShort); openedAt = next.start;
        lowWater = avgCost;
      }
    }
    // The water marks advance with the bar just traded through, as runGated advances highWater.
    if (side === "long") highWater = Math.max(highWater ?? next.high, next.high);
    if (side === "short") lowWater = Math.min(lowWater ?? next.low, next.low);
  }
  if (side !== null) trades.push({ side, entryBar, exitBar: to - 1, how: "end", bars: to - 1 - fillBar });
  return trades;
}

/** The loader's bars, dailies and span for a coin on an evaluation's tape. */
export function spanOf(s: MeasuredSeries, cond: Condition, w: WinName) {
  const span = s.oos[cond.tape][w];
  if (!span) return null;
  return cond.tape === "coinbase"
    ? { bars: s.comb4h, daily: s.combDaily, from: span.from, to: span.to }
    : { bars: s.kTape, daily: s.kDaily, from: span.from, to: span.to };
}

// ───────────────────────────────────────────────────────────── counts (phase 1)

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const stage = String(args.stage ?? "counts");
  if (stage !== "counts") throw new Error("phase 1 runs the counts stage only");
  const { series } = await loadMeasuredSeries(String(args.data), String(args.ext), String(args.ktape));
  const regime = JSON.parse(await Deno.readTextFile("docs/agents/backtests/btc_regime/btc_regime.json"));
  const out: Record<string, unknown> = {};
  let mismatches = 0;
  for (const cond of CONDITIONS) {
    const stops = stopsOf(cond.stopRule, DEFAULT_TREND);
    const perW: Record<string, unknown> = {};
    for (const w of WINDOWS) {
      const perCoin: Record<string, unknown> = {};
      let longOnlyEntries = 0;
      for (const sym of SYMBOLS) {
        const sp = spanOf(series[sym], cond, w);
        if (!sp) continue;
        const hsL = COSTS.revx.halfSpread[sym], hsS = PERP_HALF_SPREAD[sym];
        const inc = simulate(sym, sp.bars, sp.daily, sp.from, sp.to, DEFAULT_TREND, stops, false, hsL, hsS);
        const ls = simulate(sym, sp.bars, sp.daily, sp.from, sp.to, DEFAULT_TREND, stops, true, hsL, hsS);
        const shorts = ls.filter((t) => t.side === "short");
        const longs = ls.filter((t) => t.side === "long");
        longOnlyEntries += inc.length;
        const published = regime.perCondition?.[cond.id]?.[w]?.incumbent?.entriesByCoin?.[sym];
        if (published != null && published !== inc.length) mismatches++;
        // The unconditional 4h volatility over the scored span (no rule involved), for the power check.
        const lo = Math.max(sp.from, DEFAULT_TREND.slow + 1);
        const rets: number[] = [];
        for (let k = lo + 1; k < sp.to; k++) rets.push(Math.log(sp.bars[k].close / sp.bars[k - 1].close));
        const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
        const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1));
        perCoin[sym] = {
          sd4h: Number(sd.toFixed(6)),
          scoredBars: sp.to - 1 - Math.max(sp.from, DEFAULT_TREND.slow + 1),
          incumbentEntries: inc.length, incumbentEntriesPublished: published ?? null,
          lsLongEntries: longs.length, lsShortEntries: shorts.length,
          shortBarsHeld: shorts.reduce((a, t) => a + t.bars, 0),
          shortStops: shorts.filter((t) => t.how === "stop").length,
          shortLengthsBars: shorts.map((t) => t.bars),
        };
      }
      perW[w] = { longOnlyEntries, perCoin };
    }
    out[cond.id] = perW;
  }
  console.log(JSON.stringify({ stage, mismatchesAgainstPublishedIncumbentEntries: mismatches, counts: out }, null, 1));
}
