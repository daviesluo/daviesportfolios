// The PORTFOLIO study: is the shipped set of strategy × coin × venue rows
// the best set, are the seeded parameters on a plateau in both windows,
// does §3.9's regime filter clear the two-window bar anywhere the baseline
// does not, is any coin a Kraken-only candidate, and what would
// volatility-scaled slots have done. A study, not a rulebook. Run by hand:
//
//   deno run --allow-read --allow-write supabase/functions/agents/backtest_portfolio.ts \
//       --data <dir with BTC-USD_1h_3y.json …> --out docs/agents/backtests
//
// Writes `<out>/portfolio.json` (distilled numbers only, no per-bar curves;
// the combined curves are sampled monthly). Nothing else in the repo is
// touched. `backtest.ts`'s `run`, `runRotation`, `resample`, `COSTS`,
// `SHIPPED_STOPS`, `stopsForKind` and `buyHoldBasket`, and the live
// rulebooks in `_shared/agents_strategy.ts`, are IMPORTED, never copied —
// so every sleeve below is charged the same fee, filled at the same touch,
// stopped by the same floor and trail and held back by the same two-bar
// cooldown as the rows the loop actually runs.
//
// Two things `run` cannot express are written here, and both are COPIED
// FROM `run` LINE BY LINE the way `backtest_ideas.ts` copies it, and then
// CHECKED against it numerically (`fidelity` in the report: every shipped
// sleeve, both windows, `runSized` with weight 1 against `run`, largest
// absolute difference in return / drawdown / trades):
//   * §3.9's BTC-regime entry gate (idea 1 of `backtest_ideas.ts`, which
//     does not export it), for question 3;
//   * per-entry position SIZING, for question 5 — `run` always deploys the
//     whole sleeve.
//
// Method, identical to §3.3a / §3.7 / §3.8 of docs/agents/reference.md:
//   * three years of Coinbase hourly candles → 4h / daily bars;
//   * TWO walk-forward windows, both reported, never averaged:
//       A — parameters on the first two thirds, the LAST third out of
//           sample (the bear year §3.3a–§3.8 report);
//       B — parameters on the first third, the MIDDLE third out of sample
//           (§3.8's second window, the one that failed AVAX);
//     each coin is split on its OWN bar count, as §3.7 and §3.8 split it;
//   * the PLATEAU is the whole grid run out of sample: the share of it
//     positive. An edge has neighbours, a fit does not;
//   * every rule is priced on Revolut X costs (where its parameters are
//     chosen) and then re-priced on Kraken's, so the two differ by costs;
//   * the BAR is §3.7 / §4.15's, written before the numbers: positive out
//     of sample on Revolut X costs, drawdown < 35 %, at least half the grid
//     positive out of sample, positive on Kraken costs — on BOTH windows —
//     and a Revolut X UK book of at least $100k a day.
//
// Slot sizes are the live ones: `tick.ts` sizes an entry at
// `min(capital_usd / slots, agent_risk.max_order_usd)`, slots being the
// symbol count for a per-coin rule and `topN` for the rotation, and
// `max_order_usd` is 20. A sleeve's dollar P&L is its own fractional
// return applied to that FIXED slot — which is what a live row does, since
// it re-sizes every entry to the same dollars rather than compounding.

import {
  atrAt, applyFill, buildSnapshot, DEFAULT_ROTATION, DEFAULT_TREND, FLAT, precompute, ruleFor, sma,
  type Candle, type Position, type RotationParams, type StrategyKind, type TrendParams,
} from "../_shared/agents_strategy.ts";
import {
  buyHoldBasket, COSTS, resample, run, runRotation, SHIPPED_STOPS, spreadOf, stopsForKind,
  type Costs, type RunResult, type StopParams,
} from "./backtest.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v] (Coinbase)

// ───────────────────────────────────────────────────────── facts, not guesses

/**
 * Revolut X UK-book 24 h quote volume, reference §3.8 (medians of 21
 * samples a minute apart, 13:35–13:55 UTC on 2026-09-21). §4.15's liquidity
 * test needs $100k a day, so that a $20 order is under 0.02 % of the day.
 */
const UK_BOOK_USD_PER_DAY: Record<string, number> = {
  "BTC/USD": 3_600_000, "ETH/USD": 3_200_000, "SOL/USD": 3_300_000, "XRP/USD": 2_600_000,
  "AAVE/USD": 54_000, "DOGE/USD": 199_000, "LINK/USD": 693_000, "UNI/USD": 159_000, "ADA/USD": 122_000,
  "LTC/USD": 44_000, "BNB/USD": 19_000, "AVAX/USD": 1_900_000, "HBAR/USD": 114_000, "SHIB/USD": 11_000,
  "XLM/USD": 176_000, "PEPE/USD": 102_000, "DOT/USD": 769_000, "ALGO/USD": 180_000, "BCH/USD": 928_000,
  "ATOM/USD": 17_000, "SUI/USD": 942_000, "HYPE/USD": 123_000, "NEAR/USD": 2_800_000, "ICP/USD": 171_000,
  "ETC/USD": 8_000, "POL/USD": 11_000, "TON/USD": 8_000,
};
const MIN_BOOK_USD = 100_000;

/** Histories shorter than the three years everything else has (§3.8) — flagged wherever their numbers appear. */
const SHORT_HISTORY: Record<string, number> = { "HYPE/USD": 0.62, "TON/USD": 0.84, "BNB/USD": 0.91, "PEPE/USD": 1.85, "POL/USD": 2.05 };

/** `agent_risk.max_order_usd` (migration 0037). Every slot is capped by it. */
const MAX_ORDER_USD = 20;

/** The live rows, migrations 0037 / 0039 / 0040. `slots` is what `tick.ts` divides `capital_usd` by. */
type Row = {
  id: string; kind: StrategyKind; venue: "revx" | "kraken"; symbols: string[];
  capitalUsd: number; slots: number; rotation?: RotationParams;
};
const LIVE_ROWS: Row[] = [
  { id: "trend-4h", kind: "trend-4h", venue: "revx", symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100, slots: 5 },
  { id: "trend-1h", kind: "trend-1h", venue: "revx", symbols: ["BTC/USD", "ETH/USD", "SOL/USD"], capitalUsd: 40, slots: 3 },
  { id: "momentum-1d", kind: "momentum-1d", venue: "revx", symbols: ["BTC/USD", "ETH/USD", "SOL/USD"], capitalUsd: 40, slots: 3 },
  { id: "rotation-1d", kind: "rotation-1d", venue: "revx", symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"], capitalUsd: 60, slots: 2, rotation: DEFAULT_ROTATION },
  { id: "trend-4h-kraken", kind: "trend-4h", venue: "kraken", symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"], capitalUsd: 100, slots: 5 },
  { id: "momentum-1d-kraken", kind: "momentum-1d", venue: "kraken", symbols: ["BTC/USD", "ETH/USD", "SOL/USD"], capitalUsd: 40, slots: 3 },
  { id: "rotation-1w-kraken", kind: "rotation-1d", venue: "kraken", symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"], capitalUsd: 60, slots: 2, rotation: { ...DEFAULT_ROTATION, minHoldDays: 7 } },
];

/** §3.8's eight coins that cleared the bar on the last third (window A) — the written-down candidates. */
const PASSERS_3_8 = ["SOL/USD", "UNI/USD", "AVAX/USD", "SUI/USD", "ICP/USD", "POL/USD", "BNB/USD", "AAVE/USD"];
/** §3.9's three coins on which the BTC-regime-filtered trend cleared the bar. */
const PASSERS_3_9 = ["SOL/USD", "LINK/USD", "AVAX/USD"];

// ──────────────────────────────────────────────────────────────── the windows

/**
 * The two walk-forward windows of §4.15 on a series of `n` bars. Each coin
 * is split on its own bar count, which is how §3.7 and §3.8 split it.
 */
type Window = { name: "A" | "B"; isFrom: number; isTo: number; oosFrom: number; oosTo: number };
function windowsFor(n: number): Window[] {
  const t1 = Math.floor(n / 3), t2 = Math.floor(n * 2 / 3);
  return [
    { name: "A", isFrom: 0, isTo: t2, oosFrom: t2, oosTo: n },
    { name: "B", isFrom: 0, isTo: t1, oosFrom: t1, oosTo: t2 },
  ];
}

// ─────────────────────────────────────────────── the sized / gated simulator

/** A decision at bar `i` with the position as it stands. Monotonic in `i`, so a decider may keep a cursor. */
type Decide = (i: number, pos: Position) => "enter" | "exit" | "hold";

type SizedResult = RunResult & {
  /** Σ of the weight of every fill (entry and exit each count once) — turnover in units of the slot. */
  tradedWeight: number;
  /** ATR(14) as a share of the close at each entry decision, in order. */
  entryAtrPct: number[];
};

/**
 * `backtest.ts`'s `run`, with the rulebook replaced by a callback and the
 * entry notional scaled by `weight(i)` ∈ (0, 1] with the rest left in cash.
 * Everything that costs money is COPIED FROM `run` LINE BY LINE: the entry
 * and rule exit at the next bar's open ± the half-spread paying `fillFee`;
 * the 8 % floor under average cost and the ATR trail from the high since
 * entry, read against the next bar's low and filled at the level (or the
 * open when the bar gaps through it); the high-water mark advanced by each
 * bar's high; the two-bar cooldown after ANY exit; and the same return,
 * drawdown, trade-count, exposure and day arithmetic. With `weight` null
 * it is `run` — the report's `fidelity` block is the proof.
 */
function runSized(
  symbol: string, bars: Candle[], from: number, to: number, warmup: number,
  decide: Decide, costs: Costs, stops: StopParams | null, weight: ((i: number) => number) | null,
): SizedResult {
  const hs = spreadOf(costs, symbol);
  const maker = costs.makerBps / 1e4, taker = costs.takerBps / 1e4;
  const fill = costs.fillFee === "taker" ? taker : maker;
  const stopFee = costs.fillFee === "taker" ? taker : maker;
  let pos: Position = FLAT;
  let cash = 1.0, trades = 0, peak = 1.0, maxDD = 0, barsLong = 0, stopsHit = 0, lastExitBar = -Infinity;
  let tradedWeight = 0, openWeight = 0;
  const entryAtrPct: number[] = [];
  const equity: [number, number][] = [];
  const start = Math.max(from, warmup);
  for (let i = start; i < to - 1; i++) {
    const action = decide(i, pos);
    const next = bars[i + 1];
    const coolingDown = stops != null && i - lastExitBar < stops.reentryBars;
    if (action === "enter" && pos.base === 0 && !coolingDown) {
      const w = weight ? Math.max(0, Math.min(1, weight(i))) : 1;
      const spend = cash * w;
      if (spend > 0) {
        const price = next.open * (1 + hs);                    // the touch, at the next open
        const base = spend / (price * (1 + fill));             // the fee comes out of the same cash
        const fee = base * price * fill;
        pos = applyFill(pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
        cash -= spend; trades++; tradedWeight += w; openWeight = w;
        const a = atrAt(bars, i, stops?.atrN ?? SHIPPED_STOPS.atrN);
        if (a != null) entryAtrPct.push(a / bars[i].close);
      }
    } else if (action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fill;
      cash += pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; tradedWeight += openWeight; lastExitBar = i + 1;
    } else if (stops && pos.base > 0) {
      const hw = Math.max(pos.highWater ?? pos.avgCost, pos.avgCost);
      const atr = stops.atrStop != null ? atrAt(bars, i, stops.atrN) : null;
      const floor = pos.avgCost * (1 - stops.maxLossPct);
      const trail = stops.atrStop != null && atr != null ? hw - stops.atrStop * atr : -Infinity;
      const level = Math.max(floor, trail);
      if (next.low <= level) {
        const price = Math.min(level, next.open) * (1 - hs);
        const fee = pos.base * price * stopFee;
        cash += pos.base * price - fee;
        pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
        trades++; stopsHit++; tradedWeight += openWeight; lastExitBar = i + 1;
      }
    }
    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }; }
    const eq = cash + pos.base * next.close;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    equity.push([next.start, eq]);
  }
  const eqEnd = cash + pos.base * bars[to - 1].close;
  const days = (bars[to - 1].start - bars[start].start) / 86400e3;
  return {
    ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity,
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit, tradedWeight, entryAtrPct,
  };
}

/**
 * The SHIPPED decision at each bar as a callback: `buildSnapshot` +
 * `ruleFor`, the pair `run` itself calls. The one difference from `run` is
 * bookkeeping, not arithmetic — the daily closes are pushed onto a growing
 * array instead of `daily.slice(0, dk)` per bar (same contents, no copy).
 * Copied from `backtest_ideas.ts`, which does not export it.
 */
function shippedDecider(kind: StrategyKind, symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, barHours: number): Decide {
  const pre = precompute(bars, p);
  const closed: Candle[] = [];
  let dk = 0;
  return (i, pos) => {
    const nowMs = bars[i].start + barHours * 3600e3;
    while (dk < daily.length && daily[dk].start + 86400e3 <= nowMs) { closed.push(daily[dk]); dk++; }
    const snap = buildSnapshot(symbol, bars, i, closed, pos, nowMs, p, pre, (24 / barHours) * 365);
    return ruleFor(kind, snap, pos, p).action;
  };
}

/** BTC's daily closes and their SMAs, shared by every coin's regime-filtered run (§3.9 idea 1). */
type BtcRegime = { daily: Candle[]; sma: Record<number, (number | null)[]> };

/**
 * §3.9's idea 1, copied from `backtest_ideas.ts` (which does not export it):
 * the shipped trend rule with every ENTRY gated by BTC's daily close being
 * above its N-day average. Exits are untouched — a filter that also sold
 * would be a different rule.
 */
function regimeFiltered(symbol: string, bars: Candle[], daily: Candle[], p: TrendParams, btc: BtcRegime, n: number, barHours: number): Decide {
  const base = shippedDecider("trend-4h", symbol, bars, daily, p, barHours);
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

// ───────────────────────────────────────────────────────── daily arithmetic

/** The last equity sample of each UTC day — a sleeve's daily mark. */
function dailyMarks(equity: [number, number][]): { day: number; eq: number }[] {
  const m = new Map<number, number>();
  for (const [t, e] of equity) m.set(Math.floor(t / 86400e3) * 86400e3, e);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, eq]) => ({ day, eq }));
}

/**
 * A sleeve's daily FRACTIONAL returns. Applied to a fixed slot in dollars
 * this is exactly what a live row earns: it re-sizes every entry to the
 * same dollars, so its P&L is the rule's return on a constant notional.
 */
function dailyReturns(equity: [number, number][]): Map<number, number> {
  const out = new Map<number, number>();
  let prev = 1;
  for (const { day, eq } of dailyMarks(equity)) { out.set(day, prev > 0 ? eq / prev - 1 : 0); prev = eq; }
  return out;
}

type Sleeve = {
  id: string; rule: string; venue: string; symbol: string | null; slotUsd: number;
  rets: Map<number, number>; ret: number; maxDD: number; trades: number; exposure: number;
  days: number; tradedUsd: number; shipped: boolean;
};

/** The calendar a sleeve actually covers. Each coin is split on its OWN bar count, so a coin whose
 *  history starts later has its thirds somewhere else on the calendar — two sleeves can be in "the
 *  same window" and share no days at all. A combination of those would be diversified by the
 *  calendar, not by the rules, so `overlap` below is what admits a sleeve to one. */
function span(s: Sleeve): [number, number] {
  const ks = [...s.rets.keys()];
  return [Math.min(...ks), Math.max(...ks)];
}
/** Share of the reference range a sleeve's own range covers. */
function overlap(s: Sleeve, ref: [number, number]): number {
  const [a, b] = span(s);
  return Math.max(0, Math.min(b, ref[1]) - Math.max(a, ref[0])) / Math.max(1, ref[1] - ref[0]);
}

type PortfolioStats = {
  members: number; capitalUsd: number; pnlUsd: number; ret: number; maxDD: number; retOverDD: number;
  days: number; from: string; to: string; exposure: number; turnoverPerYear: number;
  bestDayUsd: number; worstDayUsd: number; curveMonthly: [string, number][];
};

/**
 * Combine sleeves at their live slot sizes: each day's dollar P&L is the
 * sum of slot × that sleeve's fractional return, the equity curve is the
 * capital plus the running total, and the drawdown is read off it. A day a
 * sleeve has no mark for (a coin whose history starts later) contributes
 * nothing — which is what an idle row contributes.
 */
function combine(sleeves: Sleeve[]): PortfolioStats {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  let eq = capital, peak = capital, maxDD = 0, best = -Infinity, worst = Infinity;
  const curve: [string, number][] = [];
  let lastMonth = "";
  for (const d of days) {
    let pnl = 0;
    for (const s of sleeves) pnl += s.slotUsd * (s.rets.get(d) ?? 0);
    eq += pnl;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    best = Math.max(best, pnl); worst = Math.min(worst, pnl);
    const month = new Date(d).toISOString().slice(0, 7);
    if (month !== lastMonth) { curve.push([month, Number(eq.toFixed(2))]); lastMonth = month; }
  }
  const years = Math.max(1e-9, (days[days.length - 1] - days[0]) / 86400e3 / 365);
  const exposure = capital > 0 ? sleeves.reduce((a, s) => a + s.slotUsd * s.exposure, 0) / capital : 0;
  const ret = (eq - capital) / Math.max(1e-9, capital);
  return {
    members: sleeves.length, capitalUsd: Number(capital.toFixed(2)), pnlUsd: Number((eq - capital).toFixed(2)),
    ret: Number(ret.toFixed(4)), maxDD: Number(maxDD.toFixed(4)), retOverDD: Number((ret / Math.max(0.05, maxDD)).toFixed(2)),
    days: days.length, from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days[days.length - 1]).toISOString().slice(0, 10),
    exposure: Number(exposure.toFixed(3)), turnoverPerYear: Number((sleeves.reduce((a, s) => a + s.tradedUsd, 0) / capital / years).toFixed(2)),
    bestDayUsd: Number(best.toFixed(2)), worstDayUsd: Number(worst.toFixed(2)), curveMonthly: curve,
  };
}

/** Pearson correlation of two sleeves' daily returns over the days they share. */
function corr(a: Map<number, number>, b: Map<number, number>): number | null {
  const xs: number[] = [], ys: number[] = [];
  for (const [d, x] of a) { const y = b.get(d); if (y != null) { xs.push(x); ys.push(y); } }
  if (xs.length < 30) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// ─────────────────────────────────────────────────────────── the bar, per rule

type Plateau = { gridPoints: number; positiveShare: number; median: number; chosenRank: number };
function plateauOf(rets: number[], chosen: number): Plateau {
  const s = rets.slice().sort((a, b) => a - b);
  return {
    gridPoints: s.length,
    positiveShare: Number((s.filter((r) => r > 0).length / s.length).toFixed(3)),
    median: Number(s[Math.floor(s.length / 2)].toFixed(4)),
    chosenRank: s.filter((r) => r > chosen).length + 1,
  };
}

/** §3.7's four tests, on one window. The two-window bar is both windows' `pass` and the $100k book. */
function barTests(oos: RunResult, kraken: RunResult, plateau: Plateau): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!(oos.ret > 0)) failed.push("revx OOS not positive");
  if (!(oos.maxDD < 0.35)) failed.push("drawdown ≥ 35 %");
  if (!(plateau.positiveShare >= 0.5)) failed.push("plateau < 50 %");
  if (!(kraken.ret > 0)) failed.push("kraken OOS not positive");
  return { pass: failed.length === 0, failed };
}

function score(r: RunResult): number { return r.ret / Math.max(0.05, r.maxDD); }
function pick(r: RunResult) {
  return {
    ret: Number(r.ret.toFixed(4)), maxDD: Number(r.maxDD.toFixed(4)), retOverDD: Number(score(r).toFixed(2)),
    trades: r.trades, days: Math.round(r.days), exposure: Number(r.exposure.toFixed(3)), stopsHit: r.stopsHit ?? 0,
  };
}
function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  // Every coin in the data directory with a MEASURED half-spread on BOTH venues (§3.7: a guessed
  // spread is a made-up number dressed as a result).
  const priced = Object.keys(COSTS.revx.halfSpread).filter((s) => COSTS.kraken.halfSpread[s] != null);
  const found = new Set<string>();
  for await (const e of Deno.readDir(dataDir)) {
    const m = e.name.match(/^([A-Z0-9]+)-USD_1h_3y\.json$/);
    if (m) found.add(`${m[1]}/USD`);
  }
  const symbols = priced.filter((s) => found.has(s));
  console.log(`symbols (${symbols.length}): ${symbols.join(", ")}`);

  type Series = { hourly: Candle[]; c4h: Candle[]; daily: Candle[] };
  const series: Record<string, Series> = {};
  for (const symbol of symbols) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${symbol.replace("/", "-")}_1h_3y.json`));
    const hourly: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    series[symbol] = { hourly, c4h: resample(hourly, 4), daily: resample(hourly, 24) };
  }
  const btcDaily = series["BTC/USD"].daily;
  const REGIME_N = [100, 150, 200];
  const btcRegime: BtcRegime = { daily: btcDaily, sma: Object.fromEntries(REGIME_N.map((n) => [n, sma(btcDaily.map((c) => c.close), n)])) };

  // The grids. The trend grid is §3.7's 27 points; the others are the knobs each shipped rule
  // actually exposes, and are named in the report so nobody has to guess what "plateau" means.
  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const REGIME_GRID: { p: TrendParams; n: number }[] = [];
  for (const n of REGIME_N) for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) REGIME_GRID.push({ p: { ...DEFAULT_TREND, fast, slow }, n });
  // momentum-1d has no free parameter in the shipped code path — `buildSnapshot` hard-codes the
  // 30-day lookback — so its neighbourhood is the only thing the loop can vary: the floor and the cooldown.
  const MOMENTUM_GRID: StopParams[] = [];
  for (const maxLossPct of [0.06, 0.08, 0.10, 0.12]) for (const reentryBars of [1, 2, 3]) MOMENTUM_GRID.push({ ...SHIPPED_STOPS, atrStop: null, maxLossPct, reentryBars });
  const ROTATION_GRID: RotationParams[] = [];
  for (const lookbackDays of [20, 30, 60]) for (const topN of [1, 2, 3]) for (const slowDays of [50, 100, 150]) ROTATION_GRID.push({ ...DEFAULT_ROTATION, lookbackDays, topN, slowDays });
  // Question 2's stop grid: the 8 % floor and the 3×ATR trail against their neighbours.
  const STOP_GRID: { maxLossPct: number; atrStop: number | null }[] = [];
  for (const maxLossPct of [0.06, 0.08, 0.10, 0.12]) for (const atrStop of [2, 3, 4, null]) STOP_GRID.push({ maxLossPct, atrStop });

  const report: Record<string, unknown> = {
    ran_at: new Date().toISOString(),
    study: "portfolio — is the shipped set the best set; parameter stability; §3.9's regime filter on the second window; Kraken-only candidates; equal vs volatility-scaled slots",
    source: "Coinbase Exchange 1h → 4h / 1d. Two walk-forward windows (A: parameters on the first two thirds, last third out; B: parameters on the first third, middle third out), each coin split on its own bar count. Fills, fees, stops (8 % floor under cost, 3×ATR(14) trail from the high since entry, read against each bar's low) and the two-bar cooldown are backtest.ts's own: Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). The model is not in the backtest.",
    bar: "docs/agents/reference.md §3.7 / §4.15: positive out of sample on Revolut X costs, max drawdown < 35 %, at least half the grid positive out of sample, positive on Kraken costs — on BOTH windows — and a Revolut X UK book of at least $100k a day.",
    slotSizing: "tick.ts: min(capital_usd / slots, agent_risk.max_order_usd = 20); slots = symbol count, or topN for the rotation. A sleeve's dollar P&L is its fractional return on that fixed slot.",
    stops: SHIPPED_STOPS, costs: COSTS, shortHistoryYears: SHORT_HISTORY, ukBookUsdPerDay: UK_BOOK_USD_PER_DAY, minBookUsd: MIN_BOOK_USD,
    grids: {
      "trend-4h / trend-1h": { points: TREND_GRID.length, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [2, 3, 4] },
      "momentum-1d": { points: MOMENTUM_GRID.length, note: "the 30-day lookback is hard-coded in buildSnapshot; the rule's only knobs are the floor and the cooldown", maxLossPct: [0.06, 0.08, 0.10, 0.12], reentryBars: [1, 2, 3] },
      "rotation-1d": { points: ROTATION_GRID.length, lookbackDays: [20, 30, 60], topN: [1, 2, 3], slowDays: [50, 100, 150] },
      "regime-filtered trend-4h": { points: REGIME_GRID.length, btcSmaDays: REGIME_N, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [DEFAULT_TREND.atrStop] },
      "stops (question 2)": { points: STOP_GRID.length, maxLossPct: [0.06, 0.08, 0.10, 0.12], atrStop: [2, 3, 4, null] },
    },
  };

  // ── fidelity: runSized with weight 1 IS run. Checked, not asserted. ──────
  const fid: { worstRet: number; worstDD: number; worstTrades: number; checks: number } = { worstRet: 0, worstDD: 0, worstTrades: 0, checks: 0 };
  for (const symbol of ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"]) {
    const { c4h, daily } = series[symbol];
    for (const w of windowsFor(c4h.length)) {
      for (const kind of ["trend-4h", "momentum-1d"] as StrategyKind[]) {
        const st = stopsForKind(kind, DEFAULT_TREND);
        const a = run(kind, symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 4, st);
        const b = runSized(symbol, c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1, shippedDecider(kind, symbol, c4h, daily, DEFAULT_TREND, 4), COSTS.revx, st, null);
        fid.worstRet = Math.max(fid.worstRet, Math.abs(a.ret - b.ret));
        fid.worstDD = Math.max(fid.worstDD, Math.abs(a.maxDD - b.maxDD));
        fid.worstTrades = Math.max(fid.worstTrades, Math.abs(a.trades - b.trades));
        fid.checks++;
      }
    }
  }
  report.fidelity = { ...fid, note: "runSized(weight = null) against backtest.ts's run, every shipped trend/momentum sleeve, both windows: largest absolute difference in return, drawdown and trade count" };
  console.log(`fidelity: ${fid.checks} checks, worst |Δret| ${fid.worstRet.toExponential(2)}, |ΔmaxDD| ${fid.worstDD.toExponential(2)}, |Δtrades| ${fid.worstTrades}`);

  // ── per-coin, per-window: trend-4h chosen + seeded + plateau + Kraken ────
  type CoinWindow = {
    chosen: { fast: number; slow: number; atrStop: number };
    chosenOos: ReturnType<typeof pick>; chosenKraken: ReturnType<typeof pick>;
    seededOos: ReturnType<typeof pick>; seededKraken: ReturnType<typeof pick>;
    plateau: Plateau; pass: boolean; failed: string[];
  };
  const trend4h: Record<string, Record<string, CoinWindow>> = {};
  const trend1h: Record<string, Record<string, CoinWindow>> = {};
  const momentum: Record<string, Record<string, CoinWindow>> = {};
  const regime: Record<string, Record<string, CoinWindow & { baselineOos: number; entriesRemoved: number }>> = {};

  /** One rule, one coin, one window: choose in sample over `grid`, report the chosen point and the whole grid out of sample. */
  function studyGrid<P>(
    grid: P[], label: (p: P) => { fast: number; slow: number; atrStop: number },
    inSample: (p: P) => RunResult, outOfSample: (p: P, costs: Costs) => RunResult,
    seeded: { revx: RunResult; kraken: RunResult },
  ): CoinWindow {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < grid.length; i++) { const s = score(inSample(grid[i])); if (s > bestScore) { bestScore = s; bestIdx = i; } }
    const oosAll = grid.map((p) => outOfSample(p, COSTS.revx));
    const chosenOos = oosAll[bestIdx];
    const plateau = plateauOf(oosAll.map((r) => r.ret), chosenOos.ret);
    const kraken = outOfSample(grid[bestIdx], COSTS.kraken);
    const { pass, failed } = barTests(chosenOos, kraken, plateau);
    return {
      chosen: label(grid[bestIdx]), chosenOos: pick(chosenOos), chosenKraken: pick(kraken),
      seededOos: pick(seeded.revx), seededKraken: pick(seeded.kraken), plateau, pass, failed,
    };
  }

  for (const symbol of symbols) {
    const t0 = Date.now();
    const { hourly, c4h, daily } = series[symbol];
    trend4h[symbol] = {}; trend1h[symbol] = {}; momentum[symbol] = {}; regime[symbol] = {};
    const st = (p: TrendParams) => stopsForKind("trend-4h", p);
    const ms = stopsForKind("momentum-1d", DEFAULT_TREND);

    for (const w of windowsFor(c4h.length)) {
      // trend-4h — §3.7's own test, both windows.
      trend4h[symbol][w.name] = studyGrid(
        TREND_GRID, (p) => ({ fast: p.fast, slow: p.slow, atrStop: p.atrStop }),
        (p) => run("trend-4h", symbol, c4h, daily, w.isFrom, w.isTo, p, COSTS.revx, 4, st(p)),
        (p, costs) => run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, p, costs, 4, st(p)),
        {
          revx: run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 4, st(DEFAULT_TREND)),
          kraken: run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.kraken, 4, st(DEFAULT_TREND)),
        },
      );
      // momentum-1d — the floor/cooldown neighbourhood, the only one it has.
      const mSeededRevx = run("momentum-1d", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 4, ms);
      momentum[symbol][w.name] = studyGrid(
        MOMENTUM_GRID, () => ({ fast: DEFAULT_TREND.fast, slow: DEFAULT_TREND.slow, atrStop: 0 }),
        (s) => run("momentum-1d", symbol, c4h, daily, w.isFrom, w.isTo, DEFAULT_TREND, COSTS.revx, 4, s),
        (s, costs) => run("momentum-1d", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, costs, 4, s),
        { revx: mSeededRevx, kraken: run("momentum-1d", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.kraken, 4, ms) },
      );
      // §3.9's regime filter — all 27 coins, both windows (question 3).
      const r = studyGrid(
        REGIME_GRID, (g) => ({ fast: g.p.fast, slow: g.p.slow, atrStop: g.n }),
        (g) => runSized(symbol, c4h, w.isFrom, w.isTo, g.p.slow + 1, regimeFiltered(symbol, c4h, daily, g.p, btcRegime, g.n, 4), COSTS.revx, st(g.p), null),
        (g, costs) => runSized(symbol, c4h, w.oosFrom, w.oosTo, g.p.slow + 1, regimeFiltered(symbol, c4h, daily, g.p, btcRegime, g.n, 4), costs, st(g.p), null),
        {
          revx: run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 4, st(DEFAULT_TREND)),
          kraken: run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.kraken, 4, st(DEFAULT_TREND)),
        },
      );
      // The filter's own effect: the SAME chosen fast/slow with the gate off.
      const gp: TrendParams = { ...DEFAULT_TREND, fast: r.chosen.fast, slow: r.chosen.slow };
      const off = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, gp, COSTS.revx, 4, st(gp));
      regime[symbol][w.name] = { ...r, baselineOos: trend4h[symbol][w.name].chosenOos.ret, entriesRemoved: off.trades - r.chosenOos.trades };
    }
    // trend-1h on its own bar count (1-hour candles), both windows.
    for (const w of windowsFor(hourly.length)) {
      const s1 = (p: TrendParams) => stopsForKind("trend-1h", p);
      trend1h[symbol][w.name] = studyGrid(
        TREND_GRID, (p) => ({ fast: p.fast, slow: p.slow, atrStop: p.atrStop }),
        (p) => run("trend-1h", symbol, hourly, daily, w.isFrom, w.isTo, p, COSTS.revx, 1, s1(p)),
        (p, costs) => run("trend-1h", symbol, hourly, daily, w.oosFrom, w.oosTo, p, costs, 1, s1(p)),
        {
          revx: run("trend-1h", symbol, hourly, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 1, s1(DEFAULT_TREND)),
          kraken: run("trend-1h", symbol, hourly, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.kraken, 1, s1(DEFAULT_TREND)),
        },
      );
    }
    console.log(`${symbol}: trend-4h A ${(trend4h[symbol].A.chosenOos.ret * 100).toFixed(1)}% (seeded ${(trend4h[symbol].A.seededOos.ret * 100).toFixed(1)}%, plateau ${(trend4h[symbol].A.plateau.positiveShare * 100).toFixed(0)}%) | B ${(trend4h[symbol].B.chosenOos.ret * 100).toFixed(1)}% (seeded ${(trend4h[symbol].B.seededOos.ret * 100).toFixed(1)}%, plateau ${(trend4h[symbol].B.plateau.positiveShare * 100).toFixed(0)}%) | regime A ${(regime[symbol].A.chosenOos.ret * 100).toFixed(1)}% B ${(regime[symbol].B.chosenOos.ret * 100).toFixed(1)}% | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  // ── the rotation basket, both windows, both venues, with its plateau ────
  const basketSymbols = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];
  const basketDaily: Record<string, Candle[]> = {};
  {
    const common = basketSymbols.map((s) => new Set(series[s].daily.map((c) => c.start))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    for (const s of basketSymbols) basketDaily[s] = series[s].daily.filter((c) => common.has(c.start));
  }
  const nd = basketDaily[basketSymbols[0]].length;
  const rotation: Record<string, Record<string, unknown>> = {};
  for (const w of windowsFor(nd)) {
    const per: Record<string, unknown> = {};
    for (const [venue, costs] of Object.entries(COSTS)) {
      const seededP: RotationParams = venue === "kraken" ? { ...DEFAULT_ROTATION, minHoldDays: 7 } : DEFAULT_ROTATION;
      const seeded = runRotation(basketDaily, w.oosFrom, w.oosTo, seededP, costs);
      const oosAll = ROTATION_GRID.map((p) => runRotation(basketDaily, w.oosFrom, w.oosTo, { ...p, minHoldDays: seededP.minHoldDays }, costs));
      let bestIdx = 0, bestScore = -Infinity;
      ROTATION_GRID.forEach((p, i) => { const s = score(runRotation(basketDaily, w.isFrom, w.isTo, { ...p, minHoldDays: seededP.minHoldDays }, costs)); if (s > bestScore) { bestScore = s; bestIdx = i; } });
      const seededIdx = ROTATION_GRID.findIndex((p) => p.lookbackDays === seededP.lookbackDays && p.topN === seededP.topN && p.slowDays === seededP.slowDays);
      per[venue] = {
        seededParams: seededP, seeded: { ...pick(seeded), turnoverPerYear: Number(seeded.turnover.toFixed(2)) },
        chosenParams: ROTATION_GRID[bestIdx], chosen: { ...pick(oosAll[bestIdx]), turnoverPerYear: Number(oosAll[bestIdx].turnover.toFixed(2)) },
        plateauSeeded: plateauOf(oosAll.map((r) => r.ret), oosAll[seededIdx].ret),
        plateauChosen: plateauOf(oosAll.map((r) => r.ret), oosAll[bestIdx].ret),
        buyHoldEqualWeight: Number(buyHoldBasket(basketDaily, w.oosFrom, w.oosTo, costs).toFixed(4)),
      };
    }
    rotation[w.name] = per;
    console.log(`rotation ${w.name}: revx seeded ${JSON.stringify((per.revx as Record<string, ReturnType<typeof pick>>).seeded.ret)} | kraken seeded ${JSON.stringify((per.kraken as Record<string, ReturnType<typeof pick>>).seeded.ret)}`);
  }

  // ── question 2's stop grid: the 8 % floor and the 3×ATR trail ───────────
  const stopStudy: Record<string, Record<string, unknown>> = {};
  for (const symbol of LIVE_ROWS[0].symbols) {
    const { c4h, daily } = series[symbol];
    stopStudy[symbol] = {};
    for (const w of windowsFor(c4h.length)) {
      const pts = STOP_GRID.map((g) => ({
        g, ret: run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 4, { ...SHIPPED_STOPS, maxLossPct: g.maxLossPct, atrStop: g.atrStop }).ret,
      }));
      const shipped = pts.find((x) => x.g.maxLossPct === 0.08 && x.g.atrStop === 3)!;
      stopStudy[symbol][w.name] = {
        shippedPair: { maxLossPct: 0.08, atrStop: 3, ret: Number(shipped.ret.toFixed(4)) },
        plateau: plateauOf(pts.map((x) => x.ret), shipped.ret),
        best: (() => { const b = pts.slice().sort((a, c) => c.ret - a.ret)[0]; return { ...b.g, ret: Number(b.ret.toFixed(4)) }; })(),
        grid: pts.map((x) => ({ floor: x.g.maxLossPct, atrStop: x.g.atrStop, ret: Number(x.ret.toFixed(4)) })),
      };
    }
  }

  // ── the sleeves: every live member and every candidate, both windows ────
  type SleeveSpec = { id: string; rule: string; venue: "revx" | "kraken"; symbol: string | null; slotUsd: number; shipped: boolean; note?: string };
  const specs: SleeveSpec[] = [];
  for (const row of LIVE_ROWS) {
    const slot = Math.min(row.capitalUsd / row.slots, MAX_ORDER_USD);
    if (row.kind === "rotation-1d") specs.push({ id: `${row.id}·${row.venue}`, rule: row.id, venue: row.venue, symbol: null, slotUsd: slot * row.slots, shipped: true, note: `topN ${row.slots} × $${slot.toFixed(2)}; the row's capital is $${row.capitalUsd} but max_order_usd caps what it can deploy at $${(slot * row.slots).toFixed(2)}` });
    else for (const s of row.symbols) specs.push({ id: `${row.kind}·${row.venue}·${s.split("/")[0]}`, rule: row.kind, venue: row.venue, symbol: s, slotUsd: slot, shipped: true });
  }
  // Candidates: §3.8's eight one-window passers on trend-4h (Revolut X, $20 slot — the trend-4h slot);
  // trend-1h wherever it was positive out of sample on window A with the seeded parameters;
  // §3.9's regime filter on its three passers.
  const trend1hPositive = symbols.filter((s) => trend1h[s].A.seededOos.ret > 0);
  const shippedIds = new Set(specs.map((s) => s.id));
  for (const s of PASSERS_3_8.filter((x) => symbols.includes(x))) {
    const id = `trend-4h·revx·${s.split("/")[0]}`;
    if (!shippedIds.has(id)) specs.push({ id, rule: "trend-4h", venue: "revx", symbol: s, slotUsd: MAX_ORDER_USD, shipped: false, note: "§3.8 one-window passer" });
  }
  for (const s of trend1hPositive) {
    const id = `trend-1h·revx·${s.split("/")[0]}`;
    if (!shippedIds.has(id)) specs.push({ id, rule: "trend-1h", venue: "revx", symbol: s, slotUsd: 40 / 3, shipped: false, note: "trend-1h positive OOS on window A with the seeded parameters" });
  }
  for (const s of PASSERS_3_9.filter((x) => symbols.includes(x))) specs.push({ id: `regime-trend-4h·revx·${s.split("/")[0]}`, rule: "regime-trend-4h", venue: "revx", symbol: s, slotUsd: MAX_ORDER_USD, shipped: false, note: "§3.9 passer; parameters (BTC SMA N, fast, slow) chosen IN SAMPLE — there is no seeded set for a rule that does not ship" });

  /** `run` vs the `runSized` pass that supplies the sleeve's daily marks — recorded, not assumed. */
  const sleeveDrift = { worstRet: 0, worstDD: 0, worstTrades: 0, checks: 0 };
  /** Build one sleeve on one window: the seeded rulebook, that venue's costs, the live slot. */
  function buildSleeve(spec: SleeveSpec, wname: "A" | "B"): Sleeve | null {
    const costs = COSTS[spec.venue];
    if (spec.symbol == null) {
      const w = windowsFor(nd).find((x) => x.name === wname)!;
      const p: RotationParams = spec.venue === "kraken" ? { ...DEFAULT_ROTATION, minHoldDays: 7 } : DEFAULT_ROTATION;
      const r = runRotation(basketDaily, w.oosFrom, w.oosTo, p, costs);
      return {
        id: spec.id, rule: spec.rule, venue: spec.venue, symbol: null, slotUsd: spec.slotUsd, shipped: spec.shipped,
        rets: dailyReturns(r.equity), ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure,
        days: r.days, tradedUsd: r.turnover * spec.slotUsd * Math.max(1e-9, r.days / 365),
      };
    }
    const { hourly, c4h, daily } = series[spec.symbol];
    const bars = spec.rule === "trend-1h" ? hourly : c4h;
    const w = windowsFor(bars.length).find((x) => x.name === wname)!;
    let r: RunResult;
    if (spec.rule === "regime-trend-4h") {
      const ch = regime[spec.symbol][wname].chosen;
      const p: TrendParams = { ...DEFAULT_TREND, fast: ch.fast, slow: ch.slow };
      r = runSized(spec.symbol, c4h, w.oosFrom, w.oosTo, p.slow + 1, regimeFiltered(spec.symbol, c4h, daily, p, btcRegime, ch.atrStop, 4), costs, stopsForKind("trend-4h", p), null);
    } else {
      const kind = spec.rule as StrategyKind;
      const st = stopsForKind(kind, DEFAULT_TREND);
      const barHours = spec.rule === "trend-1h" ? 1 : 4;
      r = run(kind, spec.symbol, bars, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, costs, barHours, st);
      // `run` samples its equity every sixth bar, which is a daily mark on 4h bars and a six-hourly one
      // on 1h bars; the portfolio needs the SAME daily grid for every sleeve, so the marks come from the
      // identical `runSized` pass (fidelity above: zero difference) while `run` stays the source of the
      // headline numbers. Any drift between the two is recorded rather than assumed away.
      const marks = runSized(spec.symbol, bars, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1,
        shippedDecider(kind, spec.symbol, bars, daily, DEFAULT_TREND, barHours), costs, st, null);
      sleeveDrift.worstRet = Math.max(sleeveDrift.worstRet, Math.abs(marks.ret - r.ret));
      sleeveDrift.worstDD = Math.max(sleeveDrift.worstDD, Math.abs(marks.maxDD - r.maxDD));
      sleeveDrift.worstTrades = Math.max(sleeveDrift.worstTrades, Math.abs(marks.trades - r.trades));
      sleeveDrift.checks++;
      r = { ...r, equity: marks.equity };
    }
    return {
      id: spec.id, rule: spec.rule, venue: spec.venue, symbol: spec.symbol, slotUsd: spec.slotUsd, shipped: spec.shipped,
      rets: dailyReturns(r.equity), ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure,
      days: r.days, tradedUsd: r.trades * spec.slotUsd,
    };
  }

  /** The bar, for a sleeve, on one window — read off the per-coin studies above. */
  function barFor(spec: SleeveSpec, wname: "A" | "B"): { pass: boolean; failed: string[]; plateau: number | null } {
    if (spec.symbol == null) {
      const v = (rotation[wname][spec.venue] as Record<string, unknown>);
      const seeded = v.seeded as ReturnType<typeof pick>;
      const pl = v.plateauSeeded as Plateau;
      const other = (rotation[wname][spec.venue === "revx" ? "kraken" : "revx"] as Record<string, unknown>).seeded as ReturnType<typeof pick>;
      const failed: string[] = [];
      if (!(seeded.ret > 0)) failed.push("revx OOS not positive");
      if (!(seeded.maxDD < 0.35)) failed.push("drawdown ≥ 35 %");
      if (!(pl.positiveShare >= 0.5)) failed.push("plateau < 50 %");
      if (!(other.ret > 0)) failed.push("other venue OOS not positive");
      return { pass: failed.length === 0, failed, plateau: pl.positiveShare };
    }
    const table = spec.rule === "trend-1h" ? trend1h : spec.rule === "momentum-1d" ? momentum : spec.rule === "regime-trend-4h" ? regime : trend4h;
    const cw = table[spec.symbol][wname];
    // The shipped rows run the SEEDED parameters, so a shipped sleeve is judged on those; a candidate is
    // judged the way §3.7 judges one, on the parameters chosen in sample. Both numbers are in the report.
    const oosRet = spec.shipped ? cw.seededOos.ret : cw.chosenOos.ret;
    const oosDD = spec.shipped ? cw.seededOos.maxDD : cw.chosenOos.maxDD;
    const krakenRet = spec.shipped ? cw.seededKraken.ret : cw.chosenKraken.ret;
    const failed: string[] = [];
    if (!(oosRet > 0)) failed.push("revx OOS not positive");
    if (!(oosDD < 0.35)) failed.push("drawdown ≥ 35 %");
    if (!(cw.plateau.positiveShare >= 0.5)) failed.push("plateau < 50 %");
    if (!(krakenRet > 0)) failed.push("kraken OOS not positive");
    if ((UK_BOOK_USD_PER_DAY[spec.symbol] ?? 0) < MIN_BOOK_USD) failed.push(`UK book $${Math.round((UK_BOOK_USD_PER_DAY[spec.symbol] ?? 0) / 1000)}k/day < $100k`);
    return { pass: failed.length === 0, failed, plateau: cw.plateau.positiveShare };
  }

  const sleeves: Record<string, Sleeve[]> = { A: [], B: [] };
  const memberRows: Record<string, unknown>[] = [];
  for (const spec of specs) {
    const row: Record<string, unknown> = { id: spec.id, rule: spec.rule, venue: spec.venue, symbol: spec.symbol, slotUsd: Number(spec.slotUsd.toFixed(2)), shipped: spec.shipped, note: spec.note ?? null };
    if (spec.symbol && SHORT_HISTORY[spec.symbol]) row.shortHistoryYears = SHORT_HISTORY[spec.symbol];
    if (spec.symbol) row.ukBookUsdPerDay = UK_BOOK_USD_PER_DAY[spec.symbol] ?? null;
    for (const wname of ["A", "B"] as const) {
      const sl = buildSleeve(spec, wname);
      if (!sl) continue;
      sleeves[wname].push(sl);
      const bar = barFor(spec, wname);
      row[wname] = {
        ret: Number(sl.ret.toFixed(4)), maxDD: Number(sl.maxDD.toFixed(4)),
        retOverDD: Number((sl.ret / Math.max(0.05, sl.maxDD)).toFixed(2)),
        pnlUsd: Number((sl.slotUsd * sl.ret).toFixed(2)), trades: sl.trades,
        exposure: Number(sl.exposure.toFixed(3)), days: Math.round(sl.days),
        from: new Date(span(sl)[0]).toISOString().slice(0, 10), to: new Date(span(sl)[1]).toISOString().slice(0, 10),
        plateau: bar.plateau, clearsBar: bar.pass, failed: bar.failed,
      };
    }
    row.clearsBothWindows = Boolean((row.A as { clearsBar: boolean } | undefined)?.clearsBar && (row.B as { clearsBar: boolean } | undefined)?.clearsBar);
    memberRows.push(row);
  }

  // ── question 1: the shipped set, the best set under the bar, redundancy ─
  const q1: Record<string, unknown> = {};
  for (const wname of ["A", "B"] as const) {
    const all = sleeves[wname];
    const shipped = all.filter((s) => s.shipped);
    const byId = new Map(all.map((s) => [s.id, s]));
    const clears = memberRows.filter((r) => (r[wname] as { clearsBar: boolean } | undefined)?.clearsBar).map((r) => String(r.id));
    const clearsBoth = memberRows.filter((r) => r.clearsBothWindows).map((r) => String(r.id));

    // (c) redundancy: pairwise correlation, leave-one-out contribution.
    const pairs: { a: string; b: string; corr: number }[] = [];
    for (let i = 0; i < shipped.length; i++) {
      for (let j = i + 1; j < shipped.length; j++) {
        const c = corr(shipped[i].rets, shipped[j].rets);
        if (c != null) pairs.push({ a: shipped[i].id, b: shipped[j].id, corr: Number(c.toFixed(3)) });
      }
    }
    const whole = combine(shipped);
    const leaveOneOut = shipped.map((s) => {
      const without = combine(shipped.filter((x) => x.id !== s.id));
      return {
        id: s.id, pnlUsd: Number((s.slotUsd * s.ret).toFixed(2)),
        setRetOverDDWithout: without.retOverDD, deltaRetOverDD: Number((whole.retOverDD - without.retOverDD).toFixed(2)),
        setPnlWithout: without.pnlUsd, deltaPnlUsd: Number((whole.pnlUsd - without.pnlUsd).toFixed(2)),
        setMaxDDWithout: without.maxDD,
      };
    }).sort((a, b) => a.deltaRetOverDD - b.deltaRetOverDD);

    // (b) the best combination of bar-clearing members by return/drawdown. Exhaustive when the set is
    // small enough to enumerate, greedy forward selection otherwise; both are reported.
    const ref: [number, number] = [Date.parse(whole.from), Date.parse(whole.to)];
    const eligible = all.filter((s) => clears.includes(s.id) && overlap(s, ref) >= 0.75);
    const excludedForCalendar = all.filter((s) => clears.includes(s.id) && overlap(s, ref) < 0.75)
      .map((s) => ({ id: s.id, from: new Date(span(s)[0]).toISOString().slice(0, 10), to: new Date(span(s)[1]).toISOString().slice(0, 10), overlapWithSet: Number(overlap(s, ref).toFixed(2)) }));
    const pool = eligible;
    let bestSubset: { ids: string[]; stats: PortfolioStats } | null = null;
    if (pool.length > 0 && pool.length <= 16) {
      for (let mask = 1; mask < (1 << pool.length); mask++) {
        const pick_: Sleeve[] = [];
        for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) pick_.push(pool[i]);
        const st = combine(pick_);
        if (!bestSubset || st.retOverDD > bestSubset.stats.retOverDD) bestSubset = { ids: pick_.map((x) => x.id), stats: st };
      }
    } else if (pool.length) {
      const chosen: Sleeve[] = [];
      let cur = -Infinity;
      for (;;) {
        let bestAdd: Sleeve | null = null, bestStat = cur;
        for (const c of pool) {
          if (chosen.includes(c)) continue;
          const st = combine([...chosen, c]);
          if (st.retOverDD > bestStat) { bestStat = st.retOverDD; bestAdd = c; }
        }
        if (!bestAdd) break;
        chosen.push(bestAdd); cur = bestStat;
      }
      bestSubset = { ids: chosen.map((x) => x.id), stats: combine(chosen) };
    }

    // The specific redundancy questions: trend-1h vs trend-4h, momentum vs trend-4h, the Kraken twins.
    const sameCoin = (rule: string, other: string) => shipped.filter((s) => s.rule === rule && s.venue === "revx" && s.symbol).map((s) => {
      const t = byId.get(`${other}·revx·${s.symbol!.split("/")[0]}`);
      return t ? { pair: `${s.id} vs ${t.id}`, corr: Number((corr(s.rets, t.rets) ?? NaN).toFixed(3)), pnlUsd: Number((s.slotUsd * s.ret).toFixed(2)), otherPnlUsd: Number((t.slotUsd * t.ret).toFixed(2)) } : null;
    }).filter((x): x is NonNullable<typeof x> => x != null);
    const krakenTwins = shipped.filter((s) => s.venue === "kraken").map((s) => {
      const tid = s.symbol ? `${s.rule}·revx·${s.symbol.split("/")[0]}` : `${s.rule.replace("-1w-kraken", "-1d").replace("-kraken", "")}·revx`;
      const t = byId.get(tid) ?? byId.get("rotation-1d·revx");
      return { id: s.id, twin: t?.id ?? null, corr: t ? Number((corr(s.rets, t.rets) ?? NaN).toFixed(3)) : null, pnlUsd: Number((s.slotUsd * s.ret).toFixed(2)), twinPnlUsd: t ? Number((t.slotUsd * t.ret).toFixed(2)) : null };
    });
    const revxOnly = combine(shipped.filter((s) => s.venue === "revx"));

    q1[wname] = {
      shippedSet: whole,
      shippedSetRevxOnly: revxOnly,
      shippedSetKrakenOnly: combine(shipped.filter((s) => s.venue === "kraken")),
      membersClearingBar: clears, membersClearingBothWindows: clearsBoth,
      setCalendar: { from: whole.from, to: whole.to },
      barClearersExcludedFromCombinations: excludedForCalendar,
      bestCombinationUnderBar: bestSubset ? { memberIds: bestSubset.ids, ...bestSubset.stats } : null,
      allBarClearersEqualSlots: pool.length ? combine(pool) : null,
      correlationsShipped: pairs.sort((a, b) => b.corr - a.corr),
      correlatedAbove0_9: pairs.filter((p) => p.corr > 0.9),
      leaveOneOut,
      negativeContributors: shipped.filter((s) => s.ret < 0).map((s) => ({ id: s.id, pnlUsd: Number((s.slotUsd * s.ret).toFixed(2)) })).sort((a, b) => a.pnlUsd - b.pnlUsd),
      trend1hVsTrend4h: sameCoin("trend-1h", "trend-4h"),
      momentumVsTrend4h: sameCoin("momentum-1d", "trend-4h"),
      krakenTwins,
      krakenContribution: { setWithKraken: whole.retOverDD, setRevxOnly: revxOnly.retOverDD, deltaPnlUsd: Number((whole.pnlUsd - revxOnly.pnlUsd).toFixed(2)) },
    };
  }

  // ── question 3: the regime filter's verdict, both windows, 27 coins ─────
  const regimeVerdict = symbols.map((s) => ({
    symbol: s, shortHistoryYears: SHORT_HISTORY[s] ?? null, ukBookUsdPerDay: UK_BOOK_USD_PER_DAY[s] ?? null,
    A: { ...regime[s].A.chosenOos, chosen: regime[s].A.chosen, plateau: regime[s].A.plateau.positiveShare, kraken: regime[s].A.chosenKraken.ret, pass: regime[s].A.pass, failed: regime[s].A.failed, baseline: regime[s].A.baselineOos },
    B: { ...regime[s].B.chosenOos, chosen: regime[s].B.chosen, plateau: regime[s].B.plateau.positiveShare, kraken: regime[s].B.chosenKraken.ret, pass: regime[s].B.pass, failed: regime[s].B.failed, baseline: regime[s].B.baselineOos },
    clearsBothWindows: regime[s].A.pass && regime[s].B.pass && (UK_BOOK_USD_PER_DAY[s] ?? 0) >= MIN_BOOK_USD,
    baselineClearsBothWindows: trend4h[s].A.pass && trend4h[s].B.pass && (UK_BOOK_USD_PER_DAY[s] ?? 0) >= MIN_BOOK_USD,
  }));

  // ── question 4: Kraken-only candidates ─────────────────────────────────
  const krakenOnly = symbols.map((s) => {
    const kPass = (w: "A" | "B") => {
      const cw = trend4h[s][w];
      const failed: string[] = [];
      if (!(cw.chosenKraken.ret > 0)) failed.push("kraken OOS not positive");
      if (!(cw.chosenKraken.maxDD < 0.35)) failed.push("kraken drawdown ≥ 35 %");
      if (!(cw.plateau.positiveShare >= 0.5)) failed.push("plateau < 50 %");
      return { pass: failed.length === 0, failed };
    };
    const revxTwoWindow = trend4h[s].A.pass && trend4h[s].B.pass;
    const book = UK_BOOK_USD_PER_DAY[s] ?? 0;
    const kBoth = kPass("A").pass && kPass("B").pass;
    return {
      symbol: s, shortHistoryYears: SHORT_HISTORY[s] ?? null, ukBookUsdPerDay: book,
      krakenA: trend4h[s].A.chosenKraken, krakenB: trend4h[s].B.chosenKraken,
      revxA: trend4h[s].A.chosenOos, revxB: trend4h[s].B.chosenOos,
      plateauA: trend4h[s].A.plateau.positiveShare, plateauB: trend4h[s].B.plateau.positiveShare,
      krakenClearsBothWindows: kBoth, revxClearsBothWindows: revxTwoWindow, bookUnder100k: book < MIN_BOOK_USD,
      krakenOnlyCandidate: kBoth && (!revxTwoWindow || book < MIN_BOOK_USD),
    };
  }).filter((r) => r.krakenClearsBothWindows || r.krakenOnlyCandidate);

  // ── question 5: equal slots vs volatility-scaled slots ─────────────────
  const sizing: Record<string, unknown> = {};
  for (const wname of ["A", "B"] as const) {
    // The target is the MEDIAN ATR(14)/close at the in-sample entries of the per-coin shipped sleeves —
    // computed on the in-sample segment only, so nothing out of sample is looked at.
    const inSampleAtr: number[] = [];
    const perCoin = specs.filter((s) => s.shipped && s.symbol && s.rule !== "rotation-1d");
    for (const spec of perCoin) {
      const { hourly, c4h, daily } = series[spec.symbol!];
      const bars = spec.rule === "trend-1h" ? hourly : c4h;
      const w = windowsFor(bars.length).find((x) => x.name === wname)!;
      const kind = spec.rule as StrategyKind;
      const r = runSized(spec.symbol!, bars, w.isFrom, w.isTo, DEFAULT_TREND.slow + 1,
        shippedDecider(kind, spec.symbol!, bars, daily, DEFAULT_TREND, spec.rule === "trend-1h" ? 1 : 4),
        COSTS[spec.venue], stopsForKind(kind, DEFAULT_TREND), null);
      inSampleAtr.push(...r.entryAtrPct);
    }
    const targetAtrPct = median(inSampleAtr);
    const arms: Record<string, { sleeves: Sleeve[]; sizes: { id: string; meanWeight: number }[] }> = {
      equal: { sleeves: [], sizes: [] }, volScaled: { sleeves: [], sizes: [] },
    };
    for (const spec of specs.filter((s) => s.shipped)) {
      if (spec.symbol == null) {                                   // the rotation is a basket decision; the
        const sl = buildSleeve(spec, wname);                       // same sleeve sits in both arms, and says so
        if (sl) { arms.equal.sleeves.push(sl); arms.volScaled.sleeves.push(sl); }
        continue;
      }
      const { hourly, c4h, daily } = series[spec.symbol];
      const bars = spec.rule === "trend-1h" ? hourly : c4h;
      const w = windowsFor(bars.length).find((x) => x.name === wname)!;
      const kind = spec.rule as StrategyKind;
      const st = stopsForKind(kind, DEFAULT_TREND);
      const barHours = spec.rule === "trend-1h" ? 1 : 4;
      for (const [arm, weight] of [["equal", null], ["volScaled", (i: number) => {
        const a = atrAt(bars, i, SHIPPED_STOPS.atrN);
        if (a == null) return 1;
        return Math.min(1, targetAtrPct / (a / bars[i].close));
      }]] as [string, ((i: number) => number) | null][]) {
        const r = runSized(spec.symbol, bars, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1,
          shippedDecider(kind, spec.symbol, bars, daily, DEFAULT_TREND, barHours), COSTS[spec.venue], st, weight);
        arms[arm].sleeves.push({
          id: spec.id, rule: spec.rule, venue: spec.venue, symbol: spec.symbol, slotUsd: spec.slotUsd, shipped: true,
          rets: dailyReturns(r.equity), ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure,
          days: r.days, tradedUsd: r.tradedWeight * spec.slotUsd,
        });
        arms[arm].sizes.push({ id: spec.id, meanWeight: Number((r.trades > 0 ? r.tradedWeight / r.trades : 1).toFixed(3)) });
      }
    }
    sizing[wname] = {
      targetAtrPctAtEntry: Number(targetAtrPct.toFixed(5)),
      inSampleEntries: inSampleAtr.length,
      note: "volatility-scaled slot = min(slot, slot × targetAtrPct / ATR(14)-at-entry / close): the same dollar volatility per position, capped at the slot, so it can only ever deploy LESS. The target is the median ATR% at the in-sample entries of that window. The rotation sleeve is identical in both arms — it is a basket decision and its slot is already capped at $20 by max_order_usd.",
      equal: combine(arms.equal.sleeves),
      volScaled: combine(arms.volScaled.sleeves),
      meanWeightVolScaled: arms.volScaled.sizes,
    };
  }

  (report.fidelity as Record<string, unknown>).sleeveMarks = { ...sleeveDrift, note: "each per-coin sleeve's daily marks come from runSized; this is its largest disagreement with the run() result it is reported beside" };
  report.members = memberRows;
  report.question1_portfolio = q1;
  report.question2_stability = {
    "trend-4h": Object.fromEntries(symbols.map((s) => [s, { A: { plateau: trend4h[s].A.plateau, seededOos: trend4h[s].A.seededOos, seededKraken: trend4h[s].A.seededKraken, chosen: trend4h[s].A.chosen, chosenOos: trend4h[s].A.chosenOos, chosenKraken: trend4h[s].A.chosenKraken, pass: trend4h[s].A.pass }, B: { plateau: trend4h[s].B.plateau, seededOos: trend4h[s].B.seededOos, seededKraken: trend4h[s].B.seededKraken, chosen: trend4h[s].B.chosen, chosenOos: trend4h[s].B.chosenOos, chosenKraken: trend4h[s].B.chosenKraken, pass: trend4h[s].B.pass } }])),
    "trend-1h": Object.fromEntries(symbols.map((s) => [s, { A: { plateau: trend1h[s].A.plateau, seededOos: trend1h[s].A.seededOos, chosen: trend1h[s].A.chosen, chosenOos: trend1h[s].A.chosenOos, chosenKraken: trend1h[s].A.chosenKraken, pass: trend1h[s].A.pass }, B: { plateau: trend1h[s].B.plateau, seededOos: trend1h[s].B.seededOos, chosen: trend1h[s].B.chosen, chosenOos: trend1h[s].B.chosenOos, chosenKraken: trend1h[s].B.chosenKraken, pass: trend1h[s].B.pass } }])),
    "momentum-1d": Object.fromEntries(symbols.map((s) => [s, { A: { plateau: momentum[s].A.plateau, seededOos: momentum[s].A.seededOos, seededKraken: momentum[s].A.seededKraken, pass: momentum[s].A.pass }, B: { plateau: momentum[s].B.plateau, seededOos: momentum[s].B.seededOos, seededKraken: momentum[s].B.seededKraken, pass: momentum[s].B.pass } }])),
    "rotation-1d": rotation,
    stops: stopStudy,
  };
  report.question3_regimeFilter = {
    definition: "§3.9 idea 1: the shipped trend-4h rule with every ENTRY gated by BTC's daily close being above its N-day average (N ∈ {100, 150, 200}); exits untouched. 27 grid points (N × fast × slow), atrStop fixed at the shipped 3.",
    perCoin: regimeVerdict,
    clearsBothWindows: regimeVerdict.filter((r) => r.clearsBothWindows).map((r) => r.symbol),
    baselineClearsBothWindows: regimeVerdict.filter((r) => r.baselineClearsBothWindows).map((r) => r.symbol),
    clearsWhereBaselineDoesNot: regimeVerdict.filter((r) => r.clearsBothWindows && !r.baselineClearsBothWindows).map((r) => r.symbol),
  };
  report.question4_krakenOnly = krakenOnly;
  report.question5_sizing = sizing;

  await Deno.writeTextFile(`${outDir}/portfolio.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/portfolio.json in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
  for (const wname of ["A", "B"] as const) {
    const q = q1[wname] as Record<string, PortfolioStats | string[]>;
    const w = q.shippedSet as PortfolioStats;
    console.log(`window ${wname}: shipped set $${w.capitalUsd} → P&L $${w.pnlUsd} (${(w.ret * 100).toFixed(1)}%, DD ${(w.maxDD * 100).toFixed(1)}%, ret/DD ${w.retOverDD}) | clears the bar: ${(q.membersClearingBar as string[]).join(", ") || "nothing"}`);
  }
  console.log(`regime filter clears both windows on: ${(report.question3_regimeFilter as { clearsBothWindows: string[] }).clearsBothWindows.join(", ") || "no coin"}`);
}
