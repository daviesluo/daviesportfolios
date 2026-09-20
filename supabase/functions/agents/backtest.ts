// Walk-forward backtest of the agents' rulebooks — the SAME functions the
// live loop runs (`_shared/agents_strategy.ts`), driven over history with
// the venue's costs. Run by hand:
//
//   deno run --allow-read --allow-write supabase/functions/agents/backtest.ts \
//       --data <dir with BTC-USD_1h_3y.json …> --out docs/agents/backtests
//
// Data: three years of hourly candles from Coinbase Exchange, resampled
// here to 4h and daily. Revolut X only serves one year of intraday
// history; over the year both cover, its 4h closes sit within a median
// 1.6–2.7 bps of Coinbase's (p95 6–13 bps), so Coinbase stands in for the
// venue's price. Costs are each venue's, and both are reported: Revolut X
// (0 % maker + half its measured spread per side for the resting limit
// orders the strategies use, 9 bps taker + half-spread for the exits that
// go to market — the stop) and Kraken (40 bps maker / 80 bps taker at the
// account's tier, read live from TradeVolume on 2026-09-20, half its far
// tighter spread). Parameters are chosen once, on Revolut X costs, and the
// same rule is then priced on both venues — so the two figures differ by
// costs alone.
//
// No look-ahead anywhere: a decision at bar i sees candles ≤ i and fills
// at bar i+1's open (the loop fills a resting order at the touch; open is
// the conservative stand-in). Walk-forward: parameters are chosen on the
// first two years and the third year is reported OUT of sample, plus the
// full-period figure with the same parameters, so an in-sample number is
// never the headline.
//
// The model is not in the backtest. Jev's contribution is measured live,
// in paper, by recording every decision with and without its vote; a
// backtest that pretended to know what it would have said would be
// exactly the kind of number this repository has learned not to trust.

import {
  atrAt,
  applyFill, buildSnapshot, DEFAULT_ROTATION, DEFAULT_TREND, FLAT, precompute, rotationTargets, ruleDecisionRotation, ruleFor,
  type Candle, type Position, type RotationParams, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";

/**
 * A venue's costs and, with them, HOW the live loop fills there: `fillFee`
 * is the fee an ordinary entry or exit pays. On Revolut X the loop takes
 * the touch (marketable, 9 bps) because a resting bid on a breakout fills
 * exactly when the breakout fails; on Kraken it rests post-only (40 bps),
 * because 80 bps a side is not worth the certainty at this size.
 */
export type Costs = { venue: string; makerBps: number; takerBps: number; fillFee: "maker" | "taker"; halfSpread: Record<string, number> };

/** Spreads measured 2026-09-20 (docs/agents/reference.md §2.2 and §2b); fees per venue at the account's tier. */
/** What the live loop runs (tick.ts): an 8 % floor under cost on every rule, the ATR trail on the trend rules. */
export const SHIPPED_STOPS: StopParams = { maxLossPct: 0.08, atrStop: 3, atrN: 14, reentryBars: 2 };
/** The stops as the loop applies them to a rulebook: the ATR trail belongs to the trend rules only. */
export function stopsForKind(kind: StrategyKind, p: TrendParams, base: StopParams = SHIPPED_STOPS): StopParams {
  return { ...base, atrStop: kind === "trend-4h" || kind === "trend-1h" ? p.atrStop : null };
}

export const COSTS: Record<string, Costs> = {
  revx: { venue: "revx", makerBps: 0, takerBps: 9, fillFee: "taker", halfSpread: { "BTC/USD": 0.75e-4, "ETH/USD": 1.05e-4, "SOL/USD": 1.55e-4, "XRP/USD": 2.9e-4 } },
  kraken: { venue: "kraken", makerBps: 40, takerBps: 80, fillFee: "maker", halfSpread: { "BTC/USD": 0.005e-4, "ETH/USD": 0.02e-4, "SOL/USD": 0.46e-4, "XRP/USD": 0.5e-4 } },
};

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v] (Coinbase)

export function resample(hourly: Candle[], hours: number): Candle[] {
  const out: Candle[] = [];
  const span = hours * 3600e3;
  let cur: Candle | null = null;
  for (const c of hourly) {
    const b = c.start - (c.start % span);
    if (!cur || cur.start !== b) {
      if (cur) out.push(cur);
      cur = { start: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      cur.high = Math.max(cur.high, c.high); cur.low = Math.min(cur.low, c.low); cur.close = c.close; cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** The half-spread a venue charges per side, or a loud failure: a symbol priced at a made-up spread is worse than none. */
export function spreadOf(costs: Costs, symbol: string): number {
  const hs = costs.halfSpread[symbol];
  if (hs == null) throw new Error(`no half-spread for ${symbol} on ${costs.venue}`);
  return hs;
}

/**
 * The protective exits the live loop checks every minute, read here
 * against each bar's low; and the loop's re-entry cooldown after ANY exit
 * (`reentryBars` of the rule's own bar), without which a floor stop under a
 * rule that is still "on" — momentum, rotation — sells and re-buys the
 * next bar, over and over.
 */
export type StopParams = { maxLossPct: number; atrStop: number | null; atrN: number; reentryBars: number };

export type RunResult = {
  ret: number; maxDD: number; trades: number; days: number; exposure: number;
  equity: [number, number][]; realised: number; fees: number; stopsHit?: number;
};

/**
 * Drive one rulebook over `c4h` with matching `daily`, from bar `from` to
 * `to` (exclusive), the way the live loop fills: an entry or a rule exit
 * at the next bar's open plus the half-spread, paying the venue's
 * `fillFee`; and, when `stops` is given, the protective exits the loop
 * checks every minute — the floor under cost and the ATR trail from the
 * high since entry — read against each bar's low, filled at the level (or
 * the open when the bar gaps through it) as a taker on Revolut X and a
 * maker on Kraken, where the stop rests at the ask. Capital is fully
 * deployed on entry (the live loop caps this in dollars; the backtest
 * measures the rule).
 */
export function run(
  kind: StrategyKind, symbol: string, c4h: Candle[], daily: Candle[], from: number, to: number, p: TrendParams,
  costs: Costs = COSTS.revx, barHours = 4, stops: StopParams | null = null,
): RunResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  const equity: [number, number][] = [];
  const pre = precompute(c4h, p);
  let dk = 0; // daily candles closed at or before the current 4h bar (moves forward only)
  for (let i = Math.max(from, p.slow + 1); i < to - 1; i++) {
    while (dk < daily.length && daily[dk].start + 86400e3 <= c4h[i].start + barHours * 3600e3) dk++;
    const snap = buildSnapshot(symbol, c4h, i, daily.slice(0, dk), pos, c4h[i].start + barHours * 3600e3, p, pre, (24 / barHours) * 365);
    const rule = ruleFor(kind, snap, pos, p);
    const next = c4h[i + 1];
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (rule.action === "enter" && pos.base === 0 && !coolingDown) {
      const price = next.open * (1 + hs);                    // the touch, at the next open
      const base = cash / (price * (1 + fill));              // the fee comes out of the same cash
      const fee = base * price * fill;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++;
    } else if (rule.action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fill;
      cash = pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; lastExitBar = i + 1;
    } else if (stops && pos.base > 0) {
      // Between bar closes: the loop's protective exits against the live mark, here against the bar's low.
      const hw = Math.max(pos.highWater ?? pos.avgCost, pos.avgCost);
      const atr = stops.atrStop != null ? atrAt(c4h, i, stops.atrN) : null;
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
    if (i % 6 === 0) equity.push([next.start, Number(eq.toFixed(5))]);
  }
  const eqEnd = cash + pos.base * c4h[to - 1].close;
  const days = (c4h[to - 1].start - c4h[Math.max(from, p.slow + 1)].start) / 86400e3;
  return { ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity, realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit };
}

export type RotationResult = RunResult & { turnover: number };

/**
 * The rotation rulebook over a basket, on daily candles aligned by start
 * (`from`..`to` are daily indices). At each close the cross-section is
 * ranked, each symbol decided, and fills happen at the next day's open at
 * the venue's half-spread and maker fee. Each held slot gets an equal share
 * of equity at entry. Turnover is traded notional over average equity per
 * year — the number that says what a venue's fee will cost.
 */
export function runRotation(
  daily: Record<string, Candle[]>, from: number, to: number, p: RotationParams, costs: Costs = COSTS.revx,
): RotationResult {
  const symbols = Object.keys(daily);
  const pos: Record<string, Position> = Object.fromEntries(symbols.map((s) => [s, FLAT]));
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, traded = 0, daysInvested = 0;
  const equity: [number, number][] = [];
  const maker = (costs.fillFee === "taker" ? costs.takerBps : costs.makerBps) / 1e4;   // the fee an ordinary fill pays on this venue
  const start = Math.max(from, p.slowDays + 1, p.lookbackDays + 1);
  for (let i = start; i < to - 1; i++) {
    const closed: Record<string, Candle[]> = Object.fromEntries(symbols.map((s) => [s, daily[s].slice(0, i + 1)]));
    const views = rotationTargets(closed, p);
    const nowMs = daily[symbols[0]][i].start + 86400e3;
    const eqNow = cash + symbols.reduce((a, s) => a + pos[s].base * daily[s][i].close, 0);
    for (const s of symbols) {
      const hs = spreadOf(costs, s);
      const next = daily[s][i + 1];
      const d = ruleDecisionRotation(views[s], pos[s], nowMs, p);
      if (d.action === "enter" && pos[s].base === 0 && cash > 0) {
        const slot = Math.min(cash, eqNow / p.topN);
        const price = next.open * (1 + hs);
        const base = slot / (price * (1 + maker));
        const fee = base * price * maker;
        pos[s] = applyFill(pos[s], { ts: next.start, side: "buy", base, price, feeUsd: fee });
        cash -= slot; trades++; traded += slot;
      } else if (d.action === "exit" && pos[s].base > 0) {
        const price = next.open * (1 - hs);
        const fee = pos[s].base * price * maker;
        const proceeds = pos[s].base * price - fee;
        pos[s] = applyFill(pos[s], { ts: next.start, side: "sell", base: pos[s].base, price, feeUsd: fee });
        cash += proceeds; trades++; traded += proceeds;
      }
    }
    const eq = cash + symbols.reduce((a, s) => a + pos[s].base * daily[s][i + 1].close, 0);
    if (eq < cash + 1e-9 === false) daysInvested++;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    equity.push([daily[symbols[0]][i + 1].start, Number(eq.toFixed(5))]);
  }
  const last = to - 1;
  const eqEnd = cash + symbols.reduce((a, s) => a + pos[s].base * daily[s][last].close, 0);
  const days = (daily[symbols[0]][last].start - daily[symbols[0]][start].start) / 86400e3;
  const realised = symbols.reduce((a, s) => a + pos[s].realisedUsd, 0), fees = symbols.reduce((a, s) => a + pos[s].feesUsd, 0);
  return { ret: eqEnd - 1, maxDD, trades, days, exposure: daysInvested / Math.max(1, last - start), equity, realised, fees, turnover: traded / Math.max(1, days / 365) };
}

/** Equal-weight buy and hold of the basket, entered as a taker on day `from`, for the comparison line. */
export function buyHoldBasket(daily: Record<string, Candle[]>, from: number, to: number, costs: Costs = COSTS.revx): number {
  const symbols = Object.keys(daily);
  let eq = 0;
  for (const s of symbols) {
    const hs = spreadOf(costs, s);
    eq += (1 / symbols.length) * daily[s][to - 1].close / (daily[s][from].open * (1 + hs + costs.takerBps / 1e4));
  }
  return eq - 1;
}

function buyHold(c4h: Candle[], from: number, to: number, symbol: string, costs: Costs = COSTS.revx): number {
  const hs = spreadOf(costs, symbol);
  return c4h[to - 1].close / (c4h[from].open * (1 + hs + costs.takerBps / 1e4)) - 1;
}

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = args.data, outDir = args.out ?? "docs/agents/backtests";
  await Deno.mkdir(outDir, { recursive: true });
  const symbols = ["BTC/USD", "ETH/USD", "SOL/USD"];
  const basketSymbols = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];
  const report: Record<string, unknown> = {
    ran_at: new Date().toISOString(),
    source: "Coinbase Exchange 1h → 4h/1d; parameters chosen on Revolut X costs, then the same rule priced on each venue the way the loop fills there: Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). Headline figures include the loop's protective exits (8 % floor under cost, 3×ATR(14) trail from the high since entry, read against each bar's low); `noStops` is the same rule without them",
    stops: SHIPPED_STOPS,
    costs: COSTS,
    results: {},
  };
  const stopsFor = (p: TrendParams, kind: StrategyKind = "trend-4h"): StopParams => stopsForKind(kind, p);
  const grid: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) grid.push({ ...DEFAULT_TREND, fast, slow, atrStop });

  for (const symbol of symbols) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${symbol.replace("/", "-")}_1h_3y.json`));
    const hourly: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    const c4h = resample(hourly, 4), daily = resample(hourly, 24);
    const n = c4h.length, split = Math.floor(n * 2 / 3);   // first two years in-sample, last year out
    const per: Record<string, unknown> = { bars4h: n, from: new Date(c4h[0].start).toISOString().slice(0, 10), split: new Date(c4h[split].start).toISOString().slice(0, 10), to: new Date(c4h[n - 1].start).toISOString().slice(0, 10) };

    // trend-4h: pick the grid point by in-sample return/drawdown, report it out of sample.
    let best: { p: TrendParams; score: number; is: RunResult } | null = null;
    for (const p of grid) {
      const r = run("trend-4h", symbol, c4h, daily, 0, split, p, COSTS.revx, 4, stopsFor(p));
      const score = r.ret / Math.max(0.05, r.maxDD);
      if (!best || score > best.score) best = { p, score, is: r };
    }
    const bp = best!.p, bs = stopsFor(bp), ds = stopsFor(DEFAULT_TREND), ms = stopsFor(DEFAULT_TREND, "momentum-1d");
    const oos = run("trend-4h", symbol, c4h, daily, split, n, bp, COSTS.revx, 4, bs);
    const full = run("trend-4h", symbol, c4h, daily, 0, n, bp, COSTS.revx, 4, bs);
    const dflt = run("trend-4h", symbol, c4h, daily, split, n, DEFAULT_TREND, COSTS.revx, 4, ds);
    per["trend-4h"] = {
      chosen: { fast: bp.fast, slow: bp.slow, atrStop: bp.atrStop },
      inSample: pick(best!.is), outOfSample: pick(oos), fullPeriod: pick(full),
      defaultParamsOutOfSample: pick(dflt),
      noStops: { outOfSample: pick(run("trend-4h", symbol, c4h, daily, split, n, bp)), fullPeriod: pick(run("trend-4h", symbol, c4h, daily, 0, n, bp)) },
      buyHoldOutOfSample: Number(buyHold(c4h, split, n, symbol).toFixed(4)),
      buyHoldFull: Number(buyHold(c4h, 0, n, symbol).toFixed(4)),
      equityOutOfSample: oos.equity,
    };
    const mo = run("momentum-1d", symbol, c4h, daily, split, n, DEFAULT_TREND, COSTS.revx, 4, ms);
    const moFull = run("momentum-1d", symbol, c4h, daily, 0, n, DEFAULT_TREND, COSTS.revx, 4, ms);
    per["momentum-1d"] = {
      outOfSample: pick(mo), fullPeriod: pick(moFull), equityOutOfSample: mo.equity,
      noStops: { outOfSample: pick(run("momentum-1d", symbol, c4h, daily, split, n, DEFAULT_TREND)), fullPeriod: pick(run("momentum-1d", symbol, c4h, daily, 0, n, DEFAULT_TREND)) },
    };
    // The same rules priced on Kraken: same parameters, that venue's fees and spread.
    const kt = run("trend-4h", symbol, c4h, daily, split, n, bp, COSTS.kraken, 4, bs);
    const ktFull = run("trend-4h", symbol, c4h, daily, 0, n, bp, COSTS.kraken, 4, bs);
    const km = run("momentum-1d", symbol, c4h, daily, split, n, DEFAULT_TREND, COSTS.kraken, 4, ms);
    const kmFull = run("momentum-1d", symbol, c4h, daily, 0, n, DEFAULT_TREND, COSTS.kraken, 4, ms);
    per["kraken"] = {
      "trend-4h": { outOfSample: pick(kt), fullPeriod: pick(ktFull), equityOutOfSample: kt.equity },
      "momentum-1d": { outOfSample: pick(km), fullPeriod: pick(kmFull), equityOutOfSample: km.equity },
      buyHoldOutOfSample: Number(buyHold(c4h, split, n, symbol, COSTS.kraken).toFixed(4)),
    };
    console.log(`${symbol}: on Kraken costs — trend-4h OOS ${fmt(kt)} | momentum-1d OOS ${fmt(km)}`);
    (report.results as Record<string, unknown>)[symbol] = per;
    console.log(`${symbol}: trend-4h chosen ${JSON.stringify((per["trend-4h"] as { chosen: unknown }).chosen)} | OOS ${fmt(oos)} | default-params OOS ${fmt(dflt)} | buy&hold OOS ${(buyHold(c4h, split, n, symbol) * 100).toFixed(1)}%`);
    console.log(`${symbol}: momentum-1d OOS ${fmt(mo)} | full ${fmt(moFull)}`);
  }
  // The rotation basket: daily candles for all four symbols aligned by day.
  const dailyBy: Record<string, Candle[]> = {};
  const hourlyBy: Record<string, Candle[]> = {};
  for (const symbol of basketSymbols) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${symbol.replace("/", "-")}_1h_3y.json`));
    hourlyBy[symbol] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    dailyBy[symbol] = resample(hourlyBy[symbol], 24);
  }
  const common = basketSymbols.map((s) => new Set(dailyBy[s].map((c) => c.start))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  for (const s of basketSymbols) dailyBy[s] = dailyBy[s].filter((c) => common.has(c.start));
  const nd = dailyBy[basketSymbols[0]].length, dsplit = Math.floor(nd * 2 / 3);
  const variants: Record<string, RotationParams> = {
    default: DEFAULT_ROTATION,
    noBearFilter: { ...DEFAULT_ROTATION, bearFilter: false },
    minHold7: { ...DEFAULT_ROTATION, minHoldDays: 7 },
    top1: { ...DEFAULT_ROTATION, topN: 1 },
    top3: { ...DEFAULT_ROTATION, topN: 3 },
    lookback60: { ...DEFAULT_ROTATION, lookbackDays: 60 },
  };
  const basket: Record<string, unknown> = {
    symbols: basketSymbols, days: nd, from: new Date(dailyBy[basketSymbols[0]][0].start).toISOString().slice(0, 10),
    split: new Date(dailyBy[basketSymbols[0]][dsplit].start).toISOString().slice(0, 10), to: new Date(dailyBy[basketSymbols[0]][nd - 1].start).toISOString().slice(0, 10),
    buyHoldEqualWeightOutOfSample: Number(buyHoldBasket(dailyBy, dsplit, nd).toFixed(4)),
    buyHoldEqualWeightFull: Number(buyHoldBasket(dailyBy, 0, nd).toFixed(4)),
  };
  for (const [name, p] of Object.entries(variants)) {
    const per: Record<string, unknown> = { params: p };
    for (const [venue, costs] of Object.entries(COSTS)) {
      const oos = runRotation(dailyBy, dsplit, nd, p, costs), full = runRotation(dailyBy, 0, nd, p, costs);
      per[venue] = { outOfSample: { ...pick(oos), turnover: Number(oos.turnover.toFixed(2)) }, fullPeriod: { ...pick(full), turnover: Number(full.turnover.toFixed(2)) }, equityOutOfSample: oos.equity };
      console.log(`rotation ${name} on ${venue}: OOS ${fmt(oos)} exposure ${(oos.exposure * 100).toFixed(0)}% turnover ${oos.turnover.toFixed(1)}×/y | full ${fmt(full)}`);
    }
    basket[name] = per;
  }
  console.log(`basket buy&hold equal-weight OOS ${(basket.buyHoldEqualWeightOutOfSample as number * 100).toFixed(1)}% | full ${(basket.buyHoldEqualWeightFull as number * 100).toFixed(1)}%`);
  (report.results as Record<string, unknown>)["basket"] = basket;

  // Would the trend rule on 1-hour candles have survived? (It decides four times as often.)
  const trend1h: Record<string, unknown> = {};
  for (const symbol of symbols) {
    const c1h = hourlyBy[symbol], daily = dailyBy[symbol];
    const n = c1h.length, split = Math.floor(n * 2 / 3);
    const r = run("trend-1h", symbol, c1h, daily, split, n, DEFAULT_TREND, COSTS.revx, 1, stopsFor(DEFAULT_TREND, "trend-1h"));
    const full = run("trend-1h", symbol, c1h, daily, 0, n, DEFAULT_TREND, COSTS.revx, 1, stopsFor(DEFAULT_TREND, "trend-1h"));
    trend1h[symbol] = {
      outOfSample: pick(r), fullPeriod: pick(full),
      noStops: { outOfSample: pick(run("trend-1h", symbol, c1h, daily, split, n, DEFAULT_TREND, COSTS.revx, 1)), fullPeriod: pick(run("trend-1h", symbol, c1h, daily, 0, n, DEFAULT_TREND, COSTS.revx, 1)) },
    };
    console.log(`${symbol}: the same trend rule on 1h candles, Revolut X costs, OOS ${fmt(r)}`);
  }
  (report.results as Record<string, unknown>)["trend-1h-check"] = trend1h;

  await Deno.writeTextFile(`${outDir}/latest.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/latest.json`);
  // The page's copy: no equity curves, each rule nested by venue, and the two studies the backtester does not
  // produce (the dislocation minutes, the pattern variants) carried over from the previous summary untouched.
  let previous: Record<string, unknown> = {};
  try { previous = JSON.parse(await Deno.readTextFile(`${outDir}/summary.json`)); } catch { /* first run */ }
  const summary = distill(report);
  for (const k of ["dislocation", "patterns"]) if (previous[k] != null) summary[k] = previous[k];
  await Deno.writeTextFile(`${outDir}/summary.json`, JSON.stringify(summary, null, 1));
  console.log(`wrote ${outDir}/summary.json`);
}

/** The report in the shape `src/agents.js` reads: per symbol, per rule, per venue; the basket beside it; equity curves dropped. */
export function distill(report: Record<string, unknown>): Record<string, unknown> {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([k]) => k !== "equityOutOfSample").map(([k, v]) => [k, strip(v)]));
    return x;
  };
  const results = strip(report.results) as Record<string, Record<string, unknown>>;
  const trend1h = (results["trend-1h-check"] ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [symbol, per] of Object.entries(results)) {
    if (symbol === "basket" || symbol === "trend-1h-check") continue;
    const t = per["trend-4h"] as Record<string, unknown>, m = per["momentum-1d"] as Record<string, unknown>, k = per["kraken"] as Record<string, Record<string, unknown>>;
    const { chosen, buyHoldOutOfSample, buyHoldFull, ...trendRevx } = t;
    out[symbol] = {
      bars4h: per.bars4h, from: per.from, split: per.split, to: per.to, buyHoldOutOfSample, buyHoldFull,
      "trend-4h": { chosen, revx: trendRevx, kraken: k["trend-4h"] },
      "momentum-1d": { revx: m, kraken: k["momentum-1d"] },
      "trend-1h": { revx: trend1h[symbol] ?? null },
      krakenBuyHoldOutOfSample: k.buyHoldOutOfSample,
    };
  }
  return { ran_at: report.ran_at, source: report.source, stops: report.stops, costs: report.costs, results: out, basket: results.basket };
}

function pick(r: RunResult) {
  return { ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)), trades: r.trades, days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)), ...(r.stopsHit != null ? { stopsHit: r.stopsHit } : {}) };
}
function fmt(r: RunResult) {
  return `${(r.ret * 100).toFixed(1)}% (maxDD ${(r.maxDD * 100).toFixed(0)}%, ${r.trades} trades / ${Math.round(r.days)} d)`;
}
