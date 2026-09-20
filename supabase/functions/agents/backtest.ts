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
  applyFill, buildSnapshot, DEFAULT_TREND, FLAT, precompute, ruleFor, type Candle, type Position, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";

export type Costs = { venue: string; makerBps: number; takerBps: number; halfSpread: Record<string, number> };

/** Spreads measured 2026-09-20 (docs/agents/reference.md §2.2 and §2b); fees per venue at the account's tier. */
export const COSTS: Record<string, Costs> = {
  revx: { venue: "revx", makerBps: 0, takerBps: 9, halfSpread: { "BTC/USD": 0.75e-4, "ETH/USD": 1.05e-4, "SOL/USD": 1.55e-4 } },
  kraken: { venue: "kraken", makerBps: 40, takerBps: 80, halfSpread: { "BTC/USD": 0.005e-4, "ETH/USD": 0.02e-4, "SOL/USD": 0.46e-4 } },
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

export type RunResult = {
  ret: number; maxDD: number; trades: number; days: number; exposure: number;
  equity: [number, number][]; realised: number; fees: number;
};

/**
 * Drive one rulebook over `c4h` with matching `daily`, from bar `from` to
 * `to` (exclusive). Entry fills at the next bar's open as a maker; exits
 * fill at the next open, as a maker unless `reason` names the stop, which
 * goes to market. Capital is fully deployed on entry (the live loop caps
 * this in dollars; the backtest measures the rule).
 */
export function run(kind: StrategyKind, symbol: string, c4h: Candle[], daily: Candle[], from: number, to: number, p: TrendParams, costs: Costs = COSTS.revx): RunResult {
  const hs = costs.halfSpread[symbol] ?? 1e-4;
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0;
  const equity: [number, number][] = [];
  const pre = precompute(c4h, p);
  let dk = 0; // daily candles closed at or before the current 4h bar (moves forward only)
  for (let i = Math.max(from, p.slow + 1); i < to - 1; i++) {
    while (dk < daily.length && daily[dk].start + 86400e3 <= c4h[i].start + 4 * 3600e3) dk++;
    const snap = buildSnapshot(symbol, c4h, i, daily.slice(0, dk), pos, c4h[i].start + 4 * 3600e3, p, pre);
    const rule = ruleFor(kind, snap, pos, p);
    const next = c4h[i + 1];
    if (rule.action === "enter" && pos.base === 0) {
      const price = next.open * (1 + hs);                    // resting bid crossed to the touch
      const base = cash / (price * (1 + maker));             // the maker fee comes out of the same cash
      const fee = base * price * maker;
      pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
      cash = 0; trades++;
    } else if (rule.action === "exit" && pos.base > 0) {
      const market = rule.reason.startsWith("ATR trailing stop");
      const price = next.open * (1 - hs);
      const fee = pos.base * price * (market ? taker : maker);
      cash = pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++;
    }
    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }; }
    const eq = cash + pos.base * next.close;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    if (i % 6 === 0) equity.push([next.start, Number(eq.toFixed(5))]);
  }
  const eqEnd = cash + pos.base * c4h[to - 1].close;
  const days = (c4h[to - 1].start - c4h[Math.max(from, p.slow + 1)].start) / 86400e3;
  return { ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity, realised: pos.realisedUsd, fees: pos.feesUsd };
}

function buyHold(c4h: Candle[], from: number, to: number, symbol: string, costs: Costs = COSTS.revx): number {
  const hs = costs.halfSpread[symbol] ?? 1e-4;
  return c4h[to - 1].close / (c4h[from].open * (1 + hs + costs.takerBps / 1e4)) - 1;
}

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = args.data, outDir = args.out ?? "docs/agents/backtests";
  await Deno.mkdir(outDir, { recursive: true });
  const symbols = ["BTC/USD", "ETH/USD", "SOL/USD"];
  const report: Record<string, unknown> = {
    ran_at: new Date().toISOString(),
    source: "Coinbase Exchange 1h → 4h/1d; parameters chosen on Revolut X costs, then the same rule priced on each venue: Revolut X (maker 0 %, taker 9 bps, half-spread per side) and Kraken (maker 40 bps, taker 80 bps, half-spread per side)",
    costs: COSTS,
    results: {},
  };
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
      const r = run("trend-4h", symbol, c4h, daily, 0, split, p);
      const score = r.ret / Math.max(0.05, r.maxDD);
      if (!best || score > best.score) best = { p, score, is: r };
    }
    const oos = run("trend-4h", symbol, c4h, daily, split, n, best!.p);
    const full = run("trend-4h", symbol, c4h, daily, 0, n, best!.p);
    const dflt = run("trend-4h", symbol, c4h, daily, split, n, DEFAULT_TREND);
    per["trend-4h"] = {
      chosen: { fast: best!.p.fast, slow: best!.p.slow, atrStop: best!.p.atrStop },
      inSample: pick(best!.is), outOfSample: pick(oos), fullPeriod: pick(full),
      defaultParamsOutOfSample: pick(dflt),
      buyHoldOutOfSample: Number(buyHold(c4h, split, n, symbol).toFixed(4)),
      buyHoldFull: Number(buyHold(c4h, 0, n, symbol).toFixed(4)),
      equityOutOfSample: oos.equity,
    };
    const mo = run("momentum-1d", symbol, c4h, daily, split, n, DEFAULT_TREND);
    const moFull = run("momentum-1d", symbol, c4h, daily, 0, n, DEFAULT_TREND);
    per["momentum-1d"] = { outOfSample: pick(mo), fullPeriod: pick(moFull), equityOutOfSample: mo.equity };
    // The same rules priced on Kraken: same parameters, that venue's fees and spread.
    const kt = run("trend-4h", symbol, c4h, daily, split, n, best!.p, COSTS.kraken);
    const ktFull = run("trend-4h", symbol, c4h, daily, 0, n, best!.p, COSTS.kraken);
    const km = run("momentum-1d", symbol, c4h, daily, split, n, DEFAULT_TREND, COSTS.kraken);
    const kmFull = run("momentum-1d", symbol, c4h, daily, 0, n, DEFAULT_TREND, COSTS.kraken);
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
  await Deno.writeTextFile(`${outDir}/latest.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/latest.json`);
}

function pick(r: RunResult) {
  return { ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)), trades: r.trades, days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)) };
}
function fmt(r: RunResult) {
  return `${(r.ret * 100).toFixed(1)}% (maxDD ${(r.maxDD * 100).toFixed(0)}%, ${r.trades} trades / ${Math.round(r.days)} d)`;
}
