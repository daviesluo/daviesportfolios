// Five rule IDEAS, priced exactly the way the shipped backtester prices
// the shipped rules — a study, not a rulebook. Run by hand:
//
//   deno run --allow-read --allow-write supabase/functions/agents/backtest_ideas.ts \
//       --data <dir with BTC-USD_1h_3y.json …> --out docs/agents/backtests
//
// Writes `<out>/ideas.json` (distilled numbers only, no equity curves).
// Nothing else in the repo is touched: `backtest.ts`'s `run`, `resample`,
// `COSTS`, `SHIPPED_STOPS` and `stopsForKind`, and the live rulebook in
// `_shared/agents_strategy.ts`, are IMPORTED, never copied — so an idea is
// charged the same fee, filled at the same touch, stopped by the same
// floor and trail and held back by the same two-bar cooldown as the rule
// it is being compared with. Two of the five ideas cannot be expressed
// through `run`'s `kind` parameter (there is no Donchian and no pullback
// rulebook to name); those run through `runCustom` below, whose cost and
// stop mechanics are copied from `run` line by line and marked as such.
//
// Method, identical to §3.3a / §3.7 of docs/agents/reference.md:
//   * three years of Coinbase hourly candles → 4h / daily / weekly bars;
//   * the first two thirds choose the parameters (highest return over
//     drawdown, the same score `backtest.ts` uses), the last third — a
//     bear year — is reported OUT of sample and is the only headline;
//   * the PLATEAU is the whole grid run out of sample: the share of it
//     positive and its median. An edge has neighbours, a fit does not;
//   * every idea is priced on Revolut X costs (the parameters are chosen
//     there) and the chosen point is then re-priced on Kraken's, so the
//     two figures differ by costs alone;
//   * a symbol whose half-spread has not been measured on BOTH venues is
//     skipped, not guessed (`spreadOf` throws on purpose).
//
// The bar each idea/coin pair is held to is §3.7 / §4.15's, written down
// before the numbers: positive out of sample on Revolut X costs, drawdown
// under 35 %, at least half the grid positive out of sample, and positive
// on Kraken costs too.

import {
  atrAt, buildSnapshot, applyFill, DEFAULT_TREND, FLAT, precompute, priorRange, ruleFor, sma,
  type Action, type Candle, type Position, type TrendParams,
} from "../_shared/agents_strategy.ts";
import {
  COSTS, resample, run, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v] (Coinbase)

/** A decision at bar `i` with the position as it stands. Monotonic in `i`, so a decider may keep a cursor. */
type Decide = (i: number, pos: Position) => Action;

/** Fees and spread switched off, for the gross figure that says what the costs actually took. */
function freeCosts(symbols: string[]): Costs {
  return { venue: "none", makerBps: 0, takerBps: 0, fillFee: "maker", halfSpread: Object.fromEntries(symbols.map((s) => [s, 0])) };
}

/**
 * The same simulator as `backtest.ts`'s `run`, with the rulebook replaced
 * by a callback — for the two ideas that are not one of the shipped
 * `kind`s. Everything that costs money is COPIED FROM `run` LINE BY LINE:
 * the entry and rule exit at the next bar's open ± the half-spread paying
 * `fillFee`; the 8 % floor under average cost and the ATR trail from the
 * high since entry, read against the next bar's low and filled at the
 * level (or the open when the bar gaps through it); the high-water mark
 * advanced by each bar's high; the two-bar cooldown after ANY exit; and
 * the same return, drawdown, trade-count and exposure arithmetic.
 */
function runCustom(
  symbol: string, bars: Candle[], from: number, to: number, warmup: number,
  decide: Decide, costs: Costs, barHours: number, stops: StopParams | null,
): RunResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  const start = Math.max(from, warmup);
  for (let i = start; i < to - 1; i++) {
    const action = decide(i, pos);
    const next = bars[i + 1];
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);                    // the touch, at the next open
      const base = cash / (price * (1 + fill));              // the fee comes out of the same cash
      const fee = base * price * fill;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++;
    } else if (action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fill;
      cash = pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; lastExitBar = i + 1;
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
        trades++; stopsHit++; lastExitBar = i + 1;
      }
    }
    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }; }
    const eq = cash + pos.base * next.close;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
  }
  const eqEnd = cash + pos.base * bars[to - 1].close;
  const days = (bars[to - 1].start - bars[start].start) / 86400e3;
  return { ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity: [], realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit };
}

/** Buy and hold entered as a taker on bar `from`, closed at `to − 1` — the line every idea is measured against. Copied from `backtest.ts`'s (unexported) `buyHold`. */
function buyHold(bars: Candle[], from: number, to: number, symbol: string, costs: Costs = COSTS.revx): number {
  const hs = spreadOf(costs, symbol);
  return bars[to - 1].close / (bars[from].open * (1 + hs + costs.takerBps / 1e4)) - 1;
}

/**
 * The SHIPPED trend-4h decision at each bar, as a callback: exactly
 * `buildSnapshot` + `ruleFor("trend-4h", …)`, the pair `run` itself calls.
 * The one difference from `run` is bookkeeping, not arithmetic: the daily
 * candles closed so far are pushed onto a growing array instead of
 * `daily.slice(0, dk)` per bar — the same contents, without copying a
 * thousand-element array six thousand times.
 */
function shippedTrend(symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, barHours: number): Decide {
  const pre = precompute(bars, p);
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos) => {
    const nowMs = bars[i].start + barHours * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    const snap = buildSnapshot(symbol, bars, i, closed, pos, nowMs, p, pre, (24 / barHours) * 365);
    return ruleFor("trend-4h", snap, pos, p).action;
  };
}

// ---------------------------------------------------------------- the ideas

/**
 * IDEA 1 — regime-filtered trend. WHY: the shipped trend rule is judged in
 * a bear year and loses on most coins there; the losses are entries taken
 * while the whole asset class was falling. If one cross-asset switch —
 * BTC's daily close above its N-day average, the crudest "is crypto in a
 * bull market" reading there is — blocks those entries, the same rule
 * should keep its winners and skip its worst window, at the price of
 * missing an alt that turns before BTC does. Exits are untouched: a
 * regime filter that also sells would be a different rule, and the point
 * is to isolate the entry gate.
 */
function regimeFiltered(symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, btc: BtcRegime, n: number, barHours: number): Decide {
  const base = shippedTrend(symbol, bars, daily, p, barHours);
  let j = -1;
  return (i, pos) => {
    const action = base(i, pos);
    const nowMs = bars[i].start + barHours * 3600e3;
    while (j + 1 < btc.daily.length && btc.daily[j + 1].start + 86400e3 <= nowMs) j++;
    if (action !== "enter") return action;
    if (j < 0) return action;                        // no BTC daily close yet
    const ma = btc.sma[n][j];
    if (ma == null) return action;                   // the average cannot be computed yet — it does not block
    return btc.daily[j].close > ma ? "enter" : "hold";
  };
}

/** BTC's daily closes and their SMAs, shared by every coin's regime-filtered run. */
type BtcRegime = { daily: Candle[]; sma: Record<number, (number | null)[]> };

/**
 * IDEA 2 — a plain Donchian channel on 4h bars, no moving-average
 * condition at all. WHY: the shipped rule is a breakout gated by an SMA
 * cross, 30-day momentum and a volatility regime. Each gate is a claim
 * that it removes more bad entries than good ones, and none of them was
 * ever tested on its own. Stripping the rule to its breakout answers the
 * question directly: if Donchian alone does as well, the gates are
 * decoration; if it does worse, the MA condition is earning its keep.
 */
function donchian(bars: Candle[], n: number, m: number): Decide {
  return (i, pos) => {
    if (pos.base > 0) {
      const r = priorRange(bars, i, m);
      return r && bars[i].close < r.low ? "exit" : "hold";
    }
    const r = priorRange(bars, i, n);
    return r && bars[i].close > r.high ? "enter" : "hold";
  };
}

/**
 * IDEA 3 — buy the pullback inside an uptrend, on 4h bars. WHY: §3.6 threw
 * out an RSI(2) pullback at 15 and 60 minutes, where it lost 16–67 % —
 * but that test also made 600 round trips, so what it proved is that the
 * fee wins below an hour, not that mean reversion is absent. The same
 * shape at four hours trades ten times less often, and it is the natural
 * complement to a breakout rule: one buys strength, the other buys the
 * dip in the same trend. Entry: fast SMA above slow (the shipped 20/100),
 * close within k×ATR(14) of the fast SMA or below it. Exit: a close above
 * the prior 20-bar high (the move it was waiting for), H bars elapsed, or
 * the shipped stops.
 */
function pullback(bars: Candle[], p: TrendParams, k: number, holdBars: number): Decide {
  const pre = precompute(bars, p);
  let entryBar = -1;
  return (i, pos) => {
    if (pos.base > 0) {
      if (entryBar < 0) entryBar = i;                                  // first bar seen long = the fill bar
      const r = priorRange(bars, i, p.breakoutDown);
      if (r && bars[i].close > r.high) return "exit";                  // the bounce arrived
      if (i - entryBar >= holdBars) return "exit";                     // it did not
      return "hold";
    }
    entryBar = -1;
    const f = pre.fast[i], s = pre.slow[i], a = atrAt(bars, i, p.atrN);
    if (f == null || s == null || a == null || !(f > s)) return "hold";
    return bars[i].close <= f + k * a ? "enter" : "hold";
  };
}

/**
 * IDEA 4 — a stale-trend exit bolted onto the shipped rule. WHY: the
 * shipped rule leaves on a trend flip, a 20-bar breakdown or the ATR
 * trail, and every one of those waits for price to fall. A position that
 * simply stops going up pays exposure and spread for nothing, and in a
 * chop it is the position that later gets stopped out. This exit costs
 * nothing to test and either shortens the losers or cuts the winners
 * short — there is no third outcome, and the numbers say which.
 */
function staleExit(symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, staleBars: number, barHours: number): Decide {
  const base = shippedTrend(symbol, bars, daily, p, barHours);
  let lastNewHigh = -1;
  return (i, pos) => {
    const action = base(i, pos);
    if (pos.base === 0) { lastNewHigh = -1; return action; }
    if (lastNewHigh < 0) lastNewHigh = i;                              // the clock starts at the entry bar
    const r = priorRange(bars, i, p.breakoutDown);
    if (r && bars[i].high > r.high) lastNewHigh = i;                   // a fresh 20-bar high resets it
    if (action === "exit") return action;
    return i - lastNewHigh >= staleBars ? "exit" : action;
  };
}

// IDEA 5 — the shipped trend rule on WEEKLY bars. WHY: §3.6's finding
// pointed one way only ("below an hour the fee wins"), and the obvious
// test of it is the other end of the scale. A weekly bar closes 42 times
// less often than a 4-hour one, so the same rule should make a handful of
// trades a year and pay a handful of round trips — if the trend premium
// survives at that cadence, it is the cheapest version of it this account
// can trade. It runs through `run` itself with `barHours = 168`, no custom
// loop needed. Lookbacks are the conventional weekly ones rather than the
// 4-hour numbers rescaled, and the breakout windows keep the shipped
// rule's ratio to them.

// ------------------------------------------------------------- the machinery

/** The score `backtest.ts` chooses on: return over drawdown, with a floor under the denominator. */
function score(r: RunResult): number { return r.ret / Math.max(0.05, r.maxDD); }

type Plateau = {
  gridPoints: number; positiveShareOutOfSample: number; medianOutOfSample: number;
  worstOutOfSample: number; bestOutOfSample: number; chosenRankOutOfSample: number;
};

type IdeaResult = {
  chosen: Record<string, number>;
  inSample: ReturnType<typeof pick>;
  outOfSample: ReturnType<typeof pick>;
  kraken: ReturnType<typeof pick>;
  plateau: Plateau;
  grossOutOfSample: number;          // the same point with fees and spread switched off
  costDragOutOfSample: number;       // gross − net, in return points: what the venue took
  tradesPerYear: number;
  baselineOutOfSample: number;
  buyHoldOutOfSample: number;
  clearsBar: boolean;
  failed: string[];
  extra?: Record<string, unknown>;
};

/**
 * One idea on one coin: every grid point run in sample and out (the
 * out-of-sample pass is the plateau, so it costs nothing extra), the point
 * with the best in-sample return/drawdown taken as "chosen", and that
 * point re-priced on Kraken and at zero cost.
 */
function study<P>(
  grid: P[], label: (p: P) => Record<string, number>,
  inSample: (p: P) => RunResult, outOfSample: (p: P, costs: Costs) => RunResult,
  baselineOos: number, bh: number, free: Costs,
): IdeaResult {
  let bestIdx = 0, bestScore = -Infinity;
  const is: RunResult[] = [];
  for (let i = 0; i < grid.length; i++) {
    const r = inSample(grid[i]);
    is.push(r);
    const s = score(r);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  const oos = grid.map((p) => outOfSample(p, COSTS.revx));
  const rets = oos.map((r) => r.ret).slice().sort((a, b) => a - b);
  const chosenOos = oos[bestIdx];
  const plateau: Plateau = {
    gridPoints: grid.length,
    positiveShareOutOfSample: Number((rets.filter((r) => r > 0).length / rets.length).toFixed(3)),
    medianOutOfSample: Number(rets[Math.floor(rets.length / 2)].toFixed(4)),
    worstOutOfSample: Number(rets[0].toFixed(4)),
    bestOutOfSample: Number(rets[rets.length - 1].toFixed(4)),
    chosenRankOutOfSample: rets.filter((r) => r > chosenOos.ret).length + 1,
  };
  const kraken = outOfSample(grid[bestIdx], COSTS.kraken);
  const gross = outOfSample(grid[bestIdx], free);
  const failed: string[] = [];
  if (!(chosenOos.ret > 0)) failed.push("revx OOS not positive");
  if (!(chosenOos.maxDD < 0.35)) failed.push("drawdown ≥ 35 %");
  if (!(plateau.positiveShareOutOfSample >= 0.5)) failed.push("plateau < 50 %");
  if (!(kraken.ret > 0)) failed.push("kraken OOS not positive");
  return {
    chosen: label(grid[bestIdx]),
    inSample: pick(is[bestIdx]), outOfSample: pick(chosenOos), kraken: pick(kraken), plateau,
    grossOutOfSample: Number(gross.ret.toFixed(4)),
    costDragOutOfSample: Number((gross.ret - chosenOos.ret).toFixed(4)),
    tradesPerYear: Number((chosenOos.trades / Math.max(1e-9, chosenOos.days / 365)).toFixed(1)),
    baselineOutOfSample: Number(baselineOos.toFixed(4)),
    buyHoldOutOfSample: Number(bh.toFixed(4)),
    clearsBar: failed.length === 0, failed,
  };
}

function pick(r: RunResult) {
  return {
    ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)), trades: r.trades,
    days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)), stopsHit: r.stopsHit ?? 0,
  };
}
function fmt(r: { ret: number; maxDD: number; trades: number }) {
  return `${(r.ret * 100).toFixed(1)}% (DD ${(r.maxDD * 100).toFixed(0)}%, ${r.trades} fills)`;
}

// ------------------------------------------------------------------- the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });

  // Every coin in the data directory that has a MEASURED half-spread on both venues. A coin
  // priced at a guessed spread would be a made-up number dressed as a result (§3.7).
  const priced = Object.keys(COSTS.revx.halfSpread).filter((s) => COSTS.kraken.halfSpread[s] != null);
  const found = new Set<string>();
  for await (const e of Deno.readDir(dataDir)) {
    const m = e.name.match(/^([A-Z0-9]+)-USD_1h_3y\.json$/);
    if (m) found.add(`${m[1]}/USD`);
  }
  const symbols = priced.filter((s) => found.has(s));
  const skipped = [...found].filter((s) => !priced.includes(s)).sort();
  if (!symbols.length) throw new Error(`no priced symbols in ${dataDir}`);
  console.log(`symbols: ${symbols.join(", ")}${skipped.length ? `  |  skipped (no measured spread on both venues): ${skipped.join(", ")}` : ""}`);

  // Load every series once.
  type Series = { hourly: Candle[]; c4h: Candle[]; daily: Candle[]; weekly: Candle[] };
  const series: Record<string, Series> = {};
  for (const symbol of symbols) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${symbol.replace("/", "-")}_1h_3y.json`));
    const hourly: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    series[symbol] = { hourly, c4h: resample(hourly, 4), daily: resample(hourly, 24), weekly: resample(hourly, 168) };
  }
  const free = freeCosts(symbols);

  // BTC's daily closes and the three regime averages idea 1 switches on.
  const btcDaily = series["BTC/USD"]?.daily;
  if (!btcDaily) throw new Error("idea 1 needs BTC-USD_1h_3y.json for the cross-asset regime filter");
  const btcCloses = btcDaily.map((c) => c.close);
  const REGIME_N = [100, 150, 200];
  const btc: BtcRegime = { daily: btcDaily, sma: Object.fromEntries(REGIME_N.map((n) => [n, sma(btcCloses, n)])) };

  // The grids. Each is 12–27 points; each varies the idea's own parameter against enough of the
  // shipped rule's to show whether the result is a plateau or a spike.
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const REGIME_GRID: { p: TrendParams; n: number }[] = [];
  for (const n of REGIME_N) for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) REGIME_GRID.push({ p: { ...DEFAULT_TREND, fast, slow }, n });   // atrStop stays the shipped 3
  const DONCHIAN_GRID: { n: number; m: number; atrStop: number }[] = [];
  for (const n of [20, 55, 100]) for (const m of [10, 20]) for (const atrStop of [2, 3, 4]) DONCHIAN_GRID.push({ n, m, atrStop });
  const PULLBACK_GRID: { k: number; hold: number; atrStop: number }[] = [];
  for (const k of [0.5, 1.0]) for (const hold of [12, 24]) for (const atrStop of [2, 3, 4]) PULLBACK_GRID.push({ k, hold, atrStop });
  const STALE_GRID: { p: TrendParams; s: number }[] = [];
  for (const s of [12, 24, 48]) for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) STALE_GRID.push({ p: { ...DEFAULT_TREND, fast, slow }, s });
  const WEEKLY_GRID: TrendParams[] = [];
  for (const fast of [4, 8]) for (const slow of [13, 26]) for (const breakoutUp of [8, 13]) for (const atrStop of [2, 3, 4]) {
    WEEKLY_GRID.push({ ...DEFAULT_TREND, fast, slow, breakoutUp, breakoutDown: 4, atrStop });
  }

  const ideas: Record<string, Record<string, IdeaResult>> = {
    "regime-filtered-trend": {}, "donchian-4h": {}, "pullback-4h": {}, "stale-trend-exit": {}, "weekly-trend": {},
  };
  const baseline: Record<string, Record<string, unknown>> = {};

  for (const symbol of symbols) {
    const { c4h, daily, weekly } = series[symbol];
    const n = c4h.length, split = Math.floor(n * 2 / 3);
    const nw = weekly.length, wsplit = Math.floor(nw * 2 / 3);
    const bh = buyHold(c4h, split, n, symbol);
    const t0 = Date.now();

    // ---- the baseline: the shipped trend-4h rule, chosen exactly as backtest.ts chooses it.
    let bIdx = 0, bScore = -Infinity;
    const bIs: RunResult[] = TREND_GRID.map((p) => run("trend-4h", symbol, c4h, daily, 0, split, p, COSTS.revx, 4, stopsForKind("trend-4h", p)));
    bIs.forEach((r, i) => { const s = score(r); if (s > bScore) { bScore = s; bIdx = i; } });
    const bOosAll = TREND_GRID.map((p) => run("trend-4h", symbol, c4h, daily, split, n, p, COSTS.revx, 4, stopsForKind("trend-4h", p)));
    const bp = TREND_GRID[bIdx], bOos = bOosAll[bIdx];
    const bRets = bOosAll.map((r) => r.ret).slice().sort((a, b) => a - b);
    const bKraken = run("trend-4h", symbol, c4h, daily, split, n, bp, COSTS.kraken, 4, stopsForKind("trend-4h", bp));
    const bGross = run("trend-4h", symbol, c4h, daily, split, n, bp, free, 4, stopsForKind("trend-4h", bp));   // what the costs took off the baseline
    baseline[symbol] = {
      chosen: { fast: bp.fast, slow: bp.slow, atrStop: bp.atrStop },
      inSample: pick(bIs[bIdx]), outOfSample: pick(bOos), kraken: pick(bKraken),
      plateau: {
        gridPoints: TREND_GRID.length,
        positiveShareOutOfSample: Number((bRets.filter((r) => r > 0).length / bRets.length).toFixed(3)),
        medianOutOfSample: Number(bRets[Math.floor(bRets.length / 2)].toFixed(4)),
        worstOutOfSample: Number(bRets[0].toFixed(4)),
        bestOutOfSample: Number(bRets[bRets.length - 1].toFixed(4)),
        chosenRankOutOfSample: bRets.filter((r) => r > bOos.ret).length + 1,
      },
      grossOutOfSample: Number(bGross.ret.toFixed(4)),
      costDragOutOfSample: Number((bGross.ret - bOos.ret).toFixed(4)),
      tradesPerYear: Number((bOos.trades / Math.max(1e-9, bOos.days / 365)).toFixed(1)),
      buyHoldOutOfSample: Number(bh.toFixed(4)),
    };
    console.log(`${symbol}: BASELINE trend-4h ${JSON.stringify(baseline[symbol].chosen)} OOS ${fmt(bOos)} | kraken ${fmt(bKraken)} | buy&hold ${(bh * 100).toFixed(1)}%`);

    const trendStops = (p: TrendParams): StopParams => stopsForKind("trend-4h", p);

    // ---- idea 1: the same rule, entries gated by BTC's daily regime.
    ideas["regime-filtered-trend"][symbol] = study(
      REGIME_GRID, (g) => ({ btcSmaDays: g.n, fast: g.p.fast, slow: g.p.slow, atrStop: g.p.atrStop }),
      (g) => runCustom(symbol, c4h, 0, split, g.p.slow + 1, regimeFiltered(symbol, c4h, daily, g.p, btc, g.n, 4), COSTS.revx, 4, trendStops(g.p)),
      (g, costs) => runCustom(symbol, c4h, split, n, g.p.slow + 1, regimeFiltered(symbol, c4h, daily, g.p, btc, g.n, 4), costs, 4, trendStops(g.p)),
      bOos.ret, bh, free,
    );
    {
      // The filter's own effect, isolated: the SAME parameter point with and without it, out of sample.
      const r = ideas["regime-filtered-trend"][symbol];
      const p: TrendParams = { ...DEFAULT_TREND, fast: r.chosen.fast, slow: r.chosen.slow, atrStop: r.chosen.atrStop };
      const off = run("trend-4h", symbol, c4h, daily, split, n, p, COSTS.revx, 4, trendStops(p));
      r.extra = { unfilteredSameParamsOutOfSample: pick(off), tradesRemoved: off.trades - r.outOfSample.trades, drawdownChange: Number((r.outOfSample.maxDD - off.maxDD).toFixed(4)) };
      console.log(`${symbol}: regime-filtered ${JSON.stringify(r.chosen)} OOS ${fmt(r.outOfSample)} vs same params unfiltered ${fmt(off)} | plateau ${(r.plateau.positiveShareOutOfSample * 100).toFixed(0)}% / ${(r.plateau.medianOutOfSample * 100).toFixed(1)}%`);
    }

    // ---- idea 2: Donchian, no moving-average condition.
    ideas["donchian-4h"][symbol] = study(
      DONCHIAN_GRID, (g) => ({ entryN: g.n, exitM: g.m, atrStop: g.atrStop }),
      (g) => runCustom(symbol, c4h, 0, split, Math.max(g.n, g.m, SHIPPED_STOPS.atrN) + 1, donchian(c4h, g.n, g.m), COSTS.revx, 4, { ...SHIPPED_STOPS, atrStop: g.atrStop }),
      (g, costs) => runCustom(symbol, c4h, split, n, Math.max(g.n, g.m, SHIPPED_STOPS.atrN) + 1, donchian(c4h, g.n, g.m), costs, 4, { ...SHIPPED_STOPS, atrStop: g.atrStop }),
      bOos.ret, bh, free,
    );
    console.log(`${symbol}: donchian ${JSON.stringify(ideas["donchian-4h"][symbol].chosen)} OOS ${fmt(ideas["donchian-4h"][symbol].outOfSample)} | plateau ${(ideas["donchian-4h"][symbol].plateau.positiveShareOutOfSample * 100).toFixed(0)}% / ${(ideas["donchian-4h"][symbol].plateau.medianOutOfSample * 100).toFixed(1)}%`);

    // ---- idea 3: the pullback inside the shipped 20/100 uptrend.
    ideas["pullback-4h"][symbol] = study(
      PULLBACK_GRID, (g) => ({ kAtr: g.k, holdBars: g.hold, atrStop: g.atrStop }),
      (g) => runCustom(symbol, c4h, 0, split, DEFAULT_TREND.slow + 1, pullback(c4h, DEFAULT_TREND, g.k, g.hold), COSTS.revx, 4, { ...SHIPPED_STOPS, atrStop: g.atrStop }),
      (g, costs) => runCustom(symbol, c4h, split, n, DEFAULT_TREND.slow + 1, pullback(c4h, DEFAULT_TREND, g.k, g.hold), costs, 4, { ...SHIPPED_STOPS, atrStop: g.atrStop }),
      bOos.ret, bh, free,
    );
    console.log(`${symbol}: pullback ${JSON.stringify(ideas["pullback-4h"][symbol].chosen)} OOS ${fmt(ideas["pullback-4h"][symbol].outOfSample)} | plateau ${(ideas["pullback-4h"][symbol].plateau.positiveShareOutOfSample * 100).toFixed(0)}% / ${(ideas["pullback-4h"][symbol].plateau.medianOutOfSample * 100).toFixed(1)}%`);

    // ---- idea 4: the shipped rule plus the stale-trend exit.
    ideas["stale-trend-exit"][symbol] = study(
      STALE_GRID, (g) => ({ staleBars: g.s, fast: g.p.fast, slow: g.p.slow, atrStop: g.p.atrStop }),
      (g) => runCustom(symbol, c4h, 0, split, g.p.slow + 1, staleExit(symbol, c4h, daily, g.p, g.s, 4), COSTS.revx, 4, trendStops(g.p)),
      (g, costs) => runCustom(symbol, c4h, split, n, g.p.slow + 1, staleExit(symbol, c4h, daily, g.p, g.s, 4), costs, 4, trendStops(g.p)),
      bOos.ret, bh, free,
    );
    {
      const r = ideas["stale-trend-exit"][symbol];
      const p: TrendParams = { ...DEFAULT_TREND, fast: r.chosen.fast, slow: r.chosen.slow, atrStop: r.chosen.atrStop };
      const off = run("trend-4h", symbol, c4h, daily, split, n, p, COSTS.revx, 4, trendStops(p));
      r.extra = { withoutStaleExitSameParamsOutOfSample: pick(off), tradesAdded: r.outOfSample.trades - off.trades, drawdownChange: Number((r.outOfSample.maxDD - off.maxDD).toFixed(4)) };
      console.log(`${symbol}: stale-exit ${JSON.stringify(r.chosen)} OOS ${fmt(r.outOfSample)} vs same params without it ${fmt(off)} | plateau ${(r.plateau.positiveShareOutOfSample * 100).toFixed(0)}% / ${(r.plateau.medianOutOfSample * 100).toFixed(1)}%`);
    }

    // ---- idea 5: the shipped rule on weekly bars — through `run` itself.
    const wbh = buyHold(weekly, wsplit, nw, symbol);
    ideas["weekly-trend"][symbol] = study(
      WEEKLY_GRID, (p) => ({ fast: p.fast, slow: p.slow, breakoutUp: p.breakoutUp, breakoutDown: p.breakoutDown, atrStop: p.atrStop }),
      (p) => run("trend-4h", symbol, weekly, daily, 0, wsplit, p, COSTS.revx, 168, trendStops(p)),
      (p, costs) => run("trend-4h", symbol, weekly, daily, wsplit, nw, p, costs, 168, trendStops(p)),
      bOos.ret, wbh, free,
    );
    {
      const r = ideas["weekly-trend"][symbol];
      r.extra = { weeklyBars: nw, weeklySplit: new Date(weekly[wsplit].start).toISOString().slice(0, 10), costShareOfGross: Number((r.costDragOutOfSample / Math.max(1e-9, Math.abs(r.grossOutOfSample))).toFixed(3)) };
      console.log(`${symbol}: weekly ${JSON.stringify(r.chosen)} OOS ${fmt(r.outOfSample)} | ${r.tradesPerYear} fills/y, cost drag ${(r.costDragOutOfSample * 100).toFixed(2)} pts | plateau ${(r.plateau.positiveShareOutOfSample * 100).toFixed(0)}% / ${(r.plateau.medianOutOfSample * 100).toFixed(1)}%`);
    }
    console.log(`${symbol}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  // Which ideas clear the bar, and which beat the baseline out of sample on a majority of coins.
  const verdicts: Record<string, unknown> = {};
  for (const [name, per] of Object.entries(ideas)) {
    const clears = symbols.filter((s) => per[s].clearsBar);
    const beats = symbols.filter((s) => per[s].outOfSample.ret > per[s].baselineOutOfSample);
    verdicts[name] = {
      clearsBar: clears, clearsCount: clears.length,
      beatsBaselineOutOfSample: beats, beatsCount: beats.length,
      beatsBaselineOnMajority: beats.length * 2 > symbols.length,
      medianOutOfSample: Number(median(symbols.map((s) => per[s].outOfSample.ret)).toFixed(4)),
      medianPlateau: Number(median(symbols.map((s) => per[s].plateau.positiveShareOutOfSample)).toFixed(3)),
    };
  }
  const baseClears = symbols.filter((s) => {
    const b = baseline[s] as { outOfSample: { ret: number; maxDD: number }; kraken: { ret: number }; plateau: Plateau };
    return b.outOfSample.ret > 0 && b.outOfSample.maxDD < 0.35 && b.plateau.positiveShareOutOfSample >= 0.5 && b.kraken.ret > 0;
  });

  const report = {
    ran_at: new Date().toISOString(),
    study: "five rule ideas, walk-forward, against the shipped trend-4h rule",
    source: "Coinbase Exchange 1h → 4h / 1d / 1w. Parameters chosen on the first two thirds by return over drawdown, the last third reported out of sample; plateau = the whole grid run out of sample. Fills, fees, stops (8 % floor under cost, ATR trail from the high since entry, read against each bar's low) and the two-bar cooldown are backtest.ts's own: Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). The model is not in the backtest.",
    bar: "docs/agents/reference.md §3.7 / §4.15, written before the numbers: positive out of sample on Revolut X costs, max drawdown < 35 %, at least half the grid positive out of sample, and positive on Kraken costs.",
    stops: SHIPPED_STOPS,
    costs: COSTS,
    symbols, skippedNoMeasuredSpread: skipped,
    windows: Object.fromEntries(symbols.map((s) => {
      const { c4h, weekly } = series[s];
      const n = c4h.length, split = Math.floor(n * 2 / 3), nw = weekly.length;
      return [s, {
        bars4h: n, from: new Date(c4h[0].start).toISOString().slice(0, 10),
        split: new Date(c4h[split].start).toISOString().slice(0, 10), to: new Date(c4h[n - 1].start).toISOString().slice(0, 10),
        weeklyBars: nw,
      }];
    })),
    grids: {
      "regime-filtered-trend": { points: REGIME_GRID.length, btcSmaDays: REGIME_N, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [DEFAULT_TREND.atrStop] },
      "donchian-4h": { points: DONCHIAN_GRID.length, entryN: [20, 55, 100], exitM: [10, 20], atrStop: [2, 3, 4] },
      "pullback-4h": { points: PULLBACK_GRID.length, kAtr: [0.5, 1.0], holdBars: [12, 24], atrStop: [2, 3, 4], fast: DEFAULT_TREND.fast, slow: DEFAULT_TREND.slow },
      "stale-trend-exit": { points: STALE_GRID.length, staleBars: [12, 24, 48], fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [DEFAULT_TREND.atrStop] },
      "weekly-trend": { points: WEEKLY_GRID.length, fast: [4, 8], slow: [13, 26], breakoutUp: [8, 13], breakoutDown: 4, atrStop: [2, 3, 4] },
      baseline: { points: TREND_GRID.length, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [2, 3, 4] },
    },
    baseline, ideas, verdicts,
    baselineClearsBar: baseClears,
  };
  await Deno.writeTextFile(`${outDir}/ideas.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/ideas.json`);
  console.log(`baseline clears the bar on: ${baseClears.join(", ") || "no coin"}`);
  for (const [name, v] of Object.entries(verdicts)) {
    const x = v as { clearsBar: string[]; beatsBaselineOnMajority: boolean; beatsCount: number; medianOutOfSample: number; medianPlateau: number };
    console.log(`${name}: clears the bar on ${x.clearsBar.join(", ") || "no coin"} | beats the baseline on ${x.beatsCount}/${symbols.length} (majority: ${x.beatsBaselineOnMajority}) | median OOS ${(x.medianOutOfSample * 100).toFixed(1)}%, median plateau ${(x.medianPlateau * 100).toFixed(0)}%`);
  }
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
