// The ALLOCATION study: given that the whole set goes live together or not
// at all, what is the best configuration of the whole set — how much money
// per coin, how much per row, which venue runs what, which rulebooks earn
// their place — and is the answer good enough to run with real money?
// A study, not a rulebook. Run by hand:
//
//   deno run --allow-read --allow-write supabase/functions/agents/backtest_allocation.ts \
//       --data <dir with BTC-USD_1h_3y.json …> --out docs/agents/backtests
//
// Writes `<out>/allocation.json` (distilled numbers only; combined curves
// sampled monthly). `latest.json` and `summary.json` are NOT touched.
//
// It extends `backtest_portfolio.ts` (reference §3.10) and does not repeat
// it: the universe of §3.7 / §3.8 is not re-run, the regime filter is not
// re-tested, and every per-member number here is the same rule those
// studies priced. What is new is the MONEY: five ways of splitting a row's
// capital between its coins, seven ways of splitting the book between the
// rows, the venue arithmetic that says what a Kraken round trip has to
// earn, and one priced recommendation against the shipped set, against
// holding the majors, and against cash.
//
// ── what is imported, and what is copied ──────────────────────────────
//
// `backtest.ts`'s `run`, `runRotation`, `resample`, `COSTS`,
// `SHIPPED_STOPS`, `stopsForKind`, `spreadOf` and `buyHoldBasket`, and the
// live rulebooks in `_shared/agents_strategy.ts`, are IMPORTED, never
// re-implemented — so every sleeve below is charged the same fee, filled at
// the same touch, stopped by the same 8 % floor and 3×ATR trail read
// against each bar's low, and held back by the same two-bar cooldown as the
// rows the loop actually runs.
//
// **`runRotation` is called WITH the shipped stops here.** The portfolio
// study of §3.10 called it without them, so its rotation figures are §3.4's
// *bare rank rule* (window A, Revolut X: −14.4 %) rather than the rule the
// loop runs (−16.2 %). Every rotation number below is the shipped rule.
//
// Three things `run` cannot express are written here and COPIED FROM `run`
// LINE BY LINE, the way `backtest_ideas.ts` and `backtest_portfolio.ts`
// copy it, then CHECKED against it numerically (`fidelity` in the report:
// every shipped trend/momentum sleeve, both windows, the copy with its
// extras switched off against `run`, largest absolute difference in return,
// drawdown and trade count):
//   * per-entry position SIZING — `run` always deploys the whole sleeve;
//   * the per-TRADE log (entry bar, exit bar, raw prices, net prices),
//     which question 3's break-even arithmetic reads;
//   * the stop DISTANCE at each entry — min(8 %, 3×ATR/close) — which the
//     equal-risk arm sizes on.
// The copy's extras are recording only: with the weight switched off it
// must reproduce `run` to the digit, and the report says whether it did.
//
// Helpers that do arithmetic on OUTPUTS rather than on fills — `combine`,
// `dailyReturns`, `corr`, `plateauOf` — are copied from
// `backtest_portfolio.ts`, which does not export them; they touch no price
// and no fee.
//
// ── method, identical to §3.3a / §3.7 / §3.8 / §3.10 ──────────────────
//
//   * three years of Coinbase hourly candles → 4h / daily bars;
//   * TWO walk-forward windows, both reported, NEVER averaged:
//       A — parameters on the first two thirds, the LAST third out of
//           sample (2025-09 → 2026-09, a bear year);
//       B — parameters on the first third, the MIDDLE third out of sample
//           (2024-09 → 2025-09, a bull year);
//     each coin split on its OWN bar count, as §3.7 and §3.8 split it;
//   * the PLATEAU is the whole grid run out of sample: the share of it
//     positive. An edge has neighbours, a fit does not;
//   * the BAR is §3.7 / §4.15's, written before the numbers: positive out
//     of sample on Revolut X costs, drawdown < 35 %, at least half the grid
//     positive out of sample, positive on Kraken costs — on BOTH windows —
//     and a Revolut X UK book of at least $100k a day.
//
// ── the weighting rule that keeps the evidence arm honest ─────────────
//
// A slot weighted by a coin's own past is only a result if the past it is
// weighted on is not the window it is scored on. The PRIOR SEGMENT of a
// window is the third immediately before it — for window A the middle
// third, for window B the first third — so every evidence weight here is
// computed on data that ends before the scored window opens, which is what
// a live row would have had. For window A the prior segment IS window B's
// out-of-sample third, so "weighted on the other window" and "weighted on
// the preceding year" are the same arm. For window B they are not: the
// other window's out-of-sample third is the FUTURE, so that variant is
// reported separately and labelled as look-ahead — an upper bound on what
// weighting by past performance could ever have done, not a rule.
//
// Slot sizes are the live ones: `tick.ts` sizes an entry at
// `min(capital_usd / slots, agent_risk.max_order_usd = 20)`, slots being
// the symbol count for a per-coin rule and `topN` for the rotation. A
// sleeve's dollar P&L is its own fractional return applied to that FIXED
// slot — which is what a live row does, since it re-sizes every entry to
// the same dollars rather than compounding. An arm that gives one coin
// more than $20 needs `max_order_usd` raised, and the report says which
// arms do and by how much.

import {
  atrAt, applyFill, buildSnapshot, DEFAULT_ROTATION, DEFAULT_TREND, FLAT, precompute, ruleFor,
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

/**
 * Kraken 24 h quote volume — the §4.16 liquidity test for a Kraken-only
 * coin. Only the three majors were ever measured (reference §2b, probe
 * 2026-09-20 03:55 UTC); every other pair is `null`, which means UNMEASURED,
 * not thin. A coin with a null here cannot pass §4.16's book test, and the
 * report says so rather than guessing a number.
 */
const KRAKEN_BOOK_USD_PER_DAY: Record<string, number | null> = {
  "BTC/USD": 126_000_000, "ETH/USD": 73_000_000, "SOL/USD": 62_000_000,
};

/** Histories shorter than the three years everything else has (§3.8). */
const SHORT_HISTORY: Record<string, number> = { "HYPE/USD": 0.62, "TON/USD": 0.84, "BNB/USD": 0.91, "PEPE/USD": 1.85, "POL/USD": 2.05 };

/** `agent_risk` (migration 0037): the caps the loop enforces and the model cannot touch. */
const MAX_ORDER_USD = 20;
const MAX_EXPOSURE_USD_LIVE = 100;

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

/** The coins this study prices. §3.7 / §3.8's universe is NOT re-run; these are the shipped
 *  coins plus the two standing candidates the allocation work can bear on (POL — §3.10's
 *  Kraken-only candidate; LINK — the three-of-four watch and §3.9's one two-window pass). */
const STUDY_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD", "XRP/USD", "POL/USD", "LINK/USD"];

// ──────────────────────────────────────────────────────────────── the windows

/**
 * The two walk-forward windows of §4.15 on a series of `n` bars, each with
 * its PRIOR segment — the third immediately before the scored one, which is
 * the only past a live row would have had when the window opened — and the
 * OTHER window's out-of-sample third, which for B lies in the future and is
 * therefore reported as a look-ahead bound and nothing more.
 */
type Window = {
  name: "A" | "B"; isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  priorFrom: number; priorTo: number; otherFrom: number; otherTo: number; otherIsLookAhead: boolean;
};
function windowsFor(n: number): Window[] {
  const t1 = Math.floor(n / 3), t2 = Math.floor(n * 2 / 3);
  return [
    { name: "A", isFrom: 0, isTo: t2, oosFrom: t2, oosTo: n, priorFrom: t1, priorTo: t2, otherFrom: t1, otherTo: t2, otherIsLookAhead: false },
    { name: "B", isFrom: 0, isTo: t1, oosFrom: t1, oosTo: t2, priorFrom: 0, priorTo: t1, otherFrom: t2, otherTo: n, otherIsLookAhead: true },
  ];
}

// ─────────────────────────────────────────────── the sized / logged simulator

/** A decision at bar `i` with the position as it stands. Monotonic in `i`, so a decider may keep a cursor. */
type Decide = (i: number, pos: Position) => "enter" | "exit" | "hold";

/** One round trip, as the fills happened. `gross` is the raw price move the rule caught
 *  before any spread or fee; `net` is what the sleeve actually kept. */
type Trade = { entryBar: number; exitBar: number; holdBars: number; gross: number; net: number; stop: boolean };

type SizedResult = RunResult & {
  /** Σ of the weight of every fill (entry and exit each count once) — turnover in units of the slot. */
  tradedWeight: number;
  /** ATR(14) as a share of the close at each entry decision, in order. */
  entryAtrPct: number[];
  /** The BINDING stop distance at each entry: min(floor, atrStop × ATR / close). */
  entryStopPct: number[];
  /** Every closed round trip. An open position at the end of the window is not in here. */
  tradeLog: Trade[];
  /** [bar start, 1 when the sleeve held a position over that bar] — what the exposure cap sees. */
  openFlags: [number, number][];
};

/**
 * `backtest.ts`'s `run`, with the rulebook replaced by a callback, the
 * entry notional scaled by `weight(i)` ∈ (0, 1] with the rest left in cash,
 * and a per-trade log. Everything that costs money is COPIED FROM `run`
 * LINE BY LINE: the entry and rule exit at the next bar's open ± the
 * half-spread paying `fillFee`; the floor under average cost and the ATR
 * trail from the high since entry, read against the next bar's low and
 * filled at the level (or the open when the bar gaps through it); the
 * high-water mark advanced by each bar's high; the cooldown after ANY exit;
 * and the same return, drawdown, trade-count, exposure and day arithmetic.
 * With `weight` null it is `run` — the report's `fidelity` block is the
 * proof, not the claim.
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
  const entryAtrPct: number[] = [], entryStopPct: number[] = [];
  const tradeLog: Trade[] = [];
  let entryBar = -1, entryRaw = 0, entryNet = 0;       // bookkeeping only — no price, fee or level reads it
  const equity: [number, number][] = [], openFlags: [number, number][] = [];
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
        if (a != null) {
          entryAtrPct.push(a / bars[i].close);
          const trailPct = stops?.atrStop != null ? stops.atrStop * a / bars[i].close : Infinity;
          entryStopPct.push(Math.min(stops?.maxLossPct ?? SHIPPED_STOPS.maxLossPct, trailPct));
        }
        entryBar = i + 1; entryRaw = next.open; entryNet = price * (1 + fill);
      }
    } else if (action === "exit" && pos.base > 0) {
      const price = next.open * (1 - hs);
      const fee = pos.base * price * fill;
      cash += pos.base * price - fee;
      pos = applyFill(pos, { ts: next.start, side: "sell", base: pos.base, price, feeUsd: fee });
      trades++; tradedWeight += openWeight; lastExitBar = i + 1;
      tradeLog.push({ entryBar, exitBar: i + 1, holdBars: i + 1 - entryBar, gross: next.open / entryRaw - 1, net: price * (1 - fill) / entryNet - 1, stop: false });
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
        tradeLog.push({ entryBar, exitBar: i + 1, holdBars: i + 1 - entryBar, gross: Math.min(level, next.open) / entryRaw - 1, net: price * (1 - stopFee) / entryNet - 1, stop: true });
      }
    }
    if (pos.base > 0) { barsLong++; pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }; }
    const eq = cash + pos.base * next.close;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    equity.push([next.start, eq]);
    openFlags.push([next.start, pos.base > 0 ? 1 : 0]);
  }
  const eqEnd = cash + pos.base * bars[to - 1].close;
  const days = (bars[to - 1].start - bars[start].start) / 86400e3;
  return {
    ret: eqEnd - 1, maxDD, trades, days, exposure: barsLong / Math.max(1, to - from), equity,
    realised: pos.realisedUsd, fees: pos.feesUsd, stopsHit, tradedWeight, entryAtrPct, entryStopPct, tradeLog, openFlags,
  };
}

/**
 * The SHIPPED decision at each bar as a callback: `buildSnapshot` +
 * `ruleFor`, the pair `run` itself calls. The one difference from `run` is
 * bookkeeping, not arithmetic — the daily closes are pushed onto a growing
 * array instead of `daily.slice(0, dk)` per bar (same contents, no copy).
 * Copied from `backtest_ideas.ts` / `backtest_portfolio.ts`, which do not
 * export it.
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

// ───────────────────────────────────────────────────────── daily arithmetic
// (copied from backtest_portfolio.ts, which does not export them; none of
//  these touches a price, a fee or a fill.)

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

/** A day's flag per sleeve: 1 when it held a position at any point that day — what the exposure cap sees. */
function dailyOpen(flags: [number, number][]): Map<number, number> {
  const m = new Map<number, number>();
  for (const [t, f] of flags) {
    const d = Math.floor(t / 86400e3) * 86400e3;
    m.set(d, Math.max(m.get(d) ?? 0, f));
  }
  return m;
}

/** A sleeve without its slot: the rule's own record, which the arms then price differently. */
type Core = {
  id: string; rowId: string; rule: string; venue: "revx" | "kraken"; symbol: string | null;
  rets: Map<number, number>; open: Map<number, number>;
  ret: number; maxDD: number; trades: number; exposure: number; days: number;
  /** Traded notional per $1 of slot over the window — turnover before it is priced. */
  tradedPerSlot: number;
};
/** `slotUsd` is the sleeve's capital; `perOrderUsd` is what ONE order would be — the number `max_order_usd` caps. */
type Sleeve = Core & { slotUsd: number; perOrderUsd: number };

type PortfolioStats = {
  members: number; capitalUsd: number; pnlUsd: number; ret: number; retOnBook: number; maxDD: number; retOverDD: number;
  days: number; from: string; to: string; deployment: number; turnoverPerYear: number;
  bestDayUsd: number; worstDayUsd: number; maxOrderUsd: number;
  /** Open notional summed across sleeves, per day: what `agent_risk.max_exposure_usd` has to allow. */
  peakOpenUsd: number; p95OpenUsd: number; medianOpenUsd: number;
  curveMonthly: [string, number][];
};

/** The book the owner would otherwise have committed — every set's P&L is also reported on it. */
const BOOK_USD = 400;

/**
 * Combine sleeves at their slot sizes: each day's dollar P&L is the sum of
 * slot × that sleeve's fractional return, the equity curve is the capital
 * plus the running total, and the drawdown is read off it. A day a sleeve
 * has no mark for (a coin whose history starts later) contributes nothing —
 * which is what an idle row contributes.
 */
function combine(sleeves: Sleeve[]): PortfolioStats {
  const capital = sleeves.reduce((a, s) => a + s.slotUsd, 0);
  const days = [...new Set(sleeves.flatMap((s) => [...s.rets.keys()]))].sort((a, b) => a - b);
  if (!days.length) {
    return { members: 0, capitalUsd: 0, pnlUsd: 0, ret: 0, retOnBook: 0, maxDD: 0, retOverDD: 0, days: 0, from: "", to: "", deployment: 0, turnoverPerYear: 0, bestDayUsd: 0, worstDayUsd: 0, maxOrderUsd: 0, peakOpenUsd: 0, p95OpenUsd: 0, medianOpenUsd: 0, curveMonthly: [] };
  }
  let eq = capital, peak = capital, maxDD = 0, best = -Infinity, worst = Infinity;
  const opens: number[] = [];
  const curve: [string, number][] = [];
  let lastMonth = "";
  for (const d of days) {
    let pnl = 0, open = 0;
    for (const s of sleeves) { pnl += s.slotUsd * (s.rets.get(d) ?? 0); open += s.slotUsd * (s.open.get(d) ?? 0); }
    opens.push(open);
    eq += pnl;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak);
    best = Math.max(best, pnl); worst = Math.min(worst, pnl);
    const month = new Date(d).toISOString().slice(0, 7);
    if (month !== lastMonth) { curve.push([month, Number(eq.toFixed(2))]); lastMonth = month; }
  }
  const years = Math.max(1e-9, (days[days.length - 1] - days[0]) / 86400e3 / 365);
  const deployment = capital > 0 ? sleeves.reduce((a, s) => a + s.slotUsd * s.exposure, 0) / capital : 0;
  const ret = (eq - capital) / Math.max(1e-9, capital);
  return {
    members: sleeves.length, capitalUsd: Number(capital.toFixed(2)), pnlUsd: Number((eq - capital).toFixed(2)),
    ret: Number(ret.toFixed(4)), retOnBook: Number(((eq - capital) / BOOK_USD).toFixed(4)),
    maxDD: Number(maxDD.toFixed(4)), retOverDD: Number((ret / Math.max(0.05, maxDD)).toFixed(2)),
    days: days.length, from: new Date(days[0]).toISOString().slice(0, 10), to: new Date(days[days.length - 1]).toISOString().slice(0, 10),
    deployment: Number(deployment.toFixed(3)), turnoverPerYear: Number((sleeves.reduce((a, s) => a + s.tradedPerSlot * s.slotUsd, 0) / Math.max(1e-9, capital) / years).toFixed(2)),
    bestDayUsd: Number(best.toFixed(2)), worstDayUsd: Number(worst.toFixed(2)),
    maxOrderUsd: Number(Math.max(...sleeves.map((s) => s.perOrderUsd)).toFixed(2)),
    peakOpenUsd: Number(Math.max(...opens).toFixed(2)),
    p95OpenUsd: Number(opens.slice().sort((a, b) => a - b)[Math.floor(opens.length * 0.95)].toFixed(2)),
    medianOpenUsd: Number(median(opens).toFixed(2)),
    curveMonthly: curve,
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

/** §3.7's four tests on one segment: positive on this venue, drawdown < 35 %, half the grid positive, positive on the other venue. */
function barTests(ownRet: number, ownDD: number, plateauShare: number, otherRet: number): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!(ownRet > 0)) failed.push("own-venue return not positive");
  if (!(ownDD < 0.35)) failed.push("drawdown ≥ 35 %");
  if (!(plateauShare >= 0.5)) failed.push("plateau < 50 %");
  if (!(otherRet > 0)) failed.push("other-venue return not positive");
  return { pass: failed.length === 0, failed };
}

// ───────────────────────────────────────────────────────────────────── the run

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
  const dataDir = String(args.data ?? "");
  const outDir = String(args.out ?? "docs/agents/backtests");
  if (!dataDir) throw new Error("--data <dir with BTC-USD_1h_3y.json …> is required");
  await Deno.mkdir(outDir, { recursive: true });
  const t00 = Date.now();

  type Series = { hourly: Candle[]; c4h: Candle[]; daily: Candle[] };
  const series: Record<string, Series> = {};
  for (const symbol of STUDY_SYMBOLS) {
    const raw: Raw[] = JSON.parse(await Deno.readTextFile(`${dataDir}/${symbol.replace("/", "-")}_1h_3y.json`));
    const hourly: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
    series[symbol] = { hourly, c4h: resample(hourly, 4), daily: resample(hourly, 24) };
  }
  console.log(`symbols (${STUDY_SYMBOLS.length}): ${STUDY_SYMBOLS.join(", ")}`);

  const TREND_GRID: TrendParams[] = [];
  for (const fast of [10, 20, 30]) for (const slow of [50, 100, 150]) for (const atrStop of [2, 3, 4]) TREND_GRID.push({ ...DEFAULT_TREND, fast, slow, atrStop });
  const MOMENTUM_GRID: StopParams[] = [];
  for (const maxLossPct of [0.06, 0.08, 0.10, 0.12]) for (const reentryBars of [1, 2, 3]) MOMENTUM_GRID.push({ ...SHIPPED_STOPS, atrStop: null, maxLossPct, reentryBars });
  const ROTATION_GRID: RotationParams[] = [];
  for (const lookbackDays of [20, 30, 60]) for (const topN of [1, 2, 3]) for (const slowDays of [50, 100, 150]) ROTATION_GRID.push({ ...DEFAULT_ROTATION, lookbackDays, topN, slowDays });

  const report: Record<string, unknown> = {
    ran_at: new Date().toISOString(),
    study: "allocation — capital per coin, capital per row, the venue split, which rulebooks earn their place, and one priced recommendation for the whole set",
    source: "Coinbase Exchange 1h → 4h / 1d. Two walk-forward windows (A: parameters on the first two thirds, last third out; B: parameters on the first third, middle third out), each coin split on its own bar count. Fills, fees, stops (8 % floor under cost, 3×ATR(14) trail from the high since entry, read against each bar's low) and the two-bar cooldown are backtest.ts's own: Revolut X takes the touch (9 bps taker + half-spread per side), Kraken rests post-only (40 bps maker + half-spread). runRotation is called WITH the shipped stops, which backtest_portfolio.ts did not do. The model is not in the backtest.",
    bar: "docs/agents/reference.md §3.7 / §4.15: positive out of sample on that venue's costs, max drawdown < 35 %, at least half the grid positive out of sample, positive on the other venue's costs — on BOTH windows — and a book on the venue it would run on of at least $100k a day.",
    weighting: "Every evidence weight is computed on the PRIOR SEGMENT — the third immediately before the scored window (A: the middle third, B: the first third) — which is the only past a live row would have had. For window A that segment is window B's own out-of-sample third, so 'the other window' and 'the preceding year' are the same arm; for window B the other window's third is the FUTURE and that variant is reported separately as look-ahead.",
    caps: { maxOrderUsd: MAX_ORDER_USD, maxExposureUsdLive: MAX_EXPOSURE_USD_LIVE, bookUsd: BOOK_USD },
    stops: SHIPPED_STOPS, costs: COSTS, shortHistoryYears: SHORT_HISTORY,
    ukBookUsdPerDay: UK_BOOK_USD_PER_DAY, krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY, minBookUsd: MIN_BOOK_USD,
    grids: {
      "trend-4h / trend-1h": { points: TREND_GRID.length, fast: [10, 20, 30], slow: [50, 100, 150], atrStop: [2, 3, 4] },
      "momentum-1d": { points: MOMENTUM_GRID.length, note: "the 30-day lookback is hard-coded in buildSnapshot; the rule's only knobs are the floor and the cooldown", maxLossPct: [0.06, 0.08, 0.10, 0.12], reentryBars: [1, 2, 3] },
      "rotation-1d": { points: ROTATION_GRID.length, lookbackDays: [20, 30, 60], topN: [1, 2, 3], slowDays: [50, 100, 150] },
    },
  };

  // ── fidelity: the copy with its extras off IS run. Checked, not asserted. ──
  const fid = { worstRet: 0, worstDD: 0, worstTrades: 0, checks: 0 };
  for (const symbol of ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"]) {
    const { c4h, daily } = series[symbol];
    for (const w of windowsFor(c4h.length)) {
      for (const kind of ["trend-4h", "momentum-1d"] as StrategyKind[]) {
        for (const costs of [COSTS.revx, COSTS.kraken]) {
          const st = stopsForKind(kind, DEFAULT_TREND);
          const a = run(kind, symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, costs, 4, st);
          const b = runSized(symbol, c4h, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1, shippedDecider(kind, symbol, c4h, daily, DEFAULT_TREND, 4), costs, st, null);
          fid.worstRet = Math.max(fid.worstRet, Math.abs(a.ret - b.ret));
          fid.worstDD = Math.max(fid.worstDD, Math.abs(a.maxDD - b.maxDD));
          fid.worstTrades = Math.max(fid.worstTrades, Math.abs(a.trades - b.trades));
          fid.checks++;
        }
      }
    }
  }
  report.fidelity = { ...fid, note: "runSized(weight = null), the copy that carries the trade log and the stop-distance recorder, against backtest.ts's run: every shipped trend/momentum sleeve, both windows, both venues' costs; largest absolute difference in return, drawdown and trade count" };
  console.log(`fidelity: ${fid.checks} checks, worst |Δret| ${fid.worstRet.toExponential(2)}, |ΔmaxDD| ${fid.worstDD.toExponential(2)}, |Δtrades| ${fid.worstTrades}`);

  // ── per (rule, coin, window): the seeded record out of sample, on the prior
  //    segment and on the other window's third, each with its own plateau ────

  /**
   * One rulebook's seeded parameters over one segment, priced on BOTH
   * venues with a plateau on each, and §3.7's four tests applied from each
   * venue's point of view (`passRevx` reads Revolut X as the own venue and
   * Kraken as the other; `passKraken` the reverse) — because a Kraken row
   * is judged on Kraken's costs, not on its twin's.
   */
  type SegmentRecord = {
    ret: number; maxDD: number; trades: number; retOverDD: number;
    krakenRet: number; krakenMaxDD: number;
    plateau: number; plateauKraken: number;
    passRevx: boolean; failedRevx: string[]; passKraken: boolean; failedKraken: string[];
  };
  type CoinRule = {
    rule: string; symbol: string;
    oos: SegmentRecord; prior: SegmentRecord; other: SegmentRecord;
    chosen: { fast: number; slow: number; atrStop: number } | null; chosenOos: ReturnType<typeof pick> | null;
    atrPctAtEntry: number; stopPctAtEntry: number; entriesInSample: number;
    tradeStats: {
      count: number; meanGross: number; medianGross: number; meanNet: number; winRateGross: number;
      medianHoldBars: number; medianHoldDays: number; shareGrossOver: Record<string, number>;
    } | null;
  };

  function segmentRecord(rule: string, symbol: string, from: number, to: number): SegmentRecord {
    const { hourly, c4h, daily } = series[symbol];
    const bars = rule === "trend-1h" ? hourly : c4h;
    const barHours = rule === "trend-1h" ? 1 : 4;
    const kind = rule as StrategyKind;
    const st = stopsForKind(kind, DEFAULT_TREND);
    const own = run(kind, symbol, bars, daily, from, to, DEFAULT_TREND, COSTS.revx, barHours, st);
    const kra = run(kind, symbol, bars, daily, from, to, DEFAULT_TREND, COSTS.kraken, barHours, st);
    const gridRet = (costs: Costs) => kind === "momentum-1d"
      ? MOMENTUM_GRID.map((s) => run(kind, symbol, bars, daily, from, to, DEFAULT_TREND, costs, barHours, s).ret)
      : TREND_GRID.map((p) => run(kind, symbol, bars, daily, from, to, p, costs, barHours, stopsForKind(kind, p)).ret);
    const pl = plateauOf(gridRet(COSTS.revx), own.ret);
    const plK = plateauOf(gridRet(COSTS.kraken), kra.ret);
    const r = barTests(own.ret, own.maxDD, pl.positiveShare, kra.ret);
    const k = barTests(kra.ret, kra.maxDD, plK.positiveShare, own.ret);
    return {
      ret: Number(own.ret.toFixed(4)), maxDD: Number(own.maxDD.toFixed(4)), trades: own.trades,
      retOverDD: Number(score(own).toFixed(2)), krakenRet: Number(kra.ret.toFixed(4)), krakenMaxDD: Number(kra.maxDD.toFixed(4)),
      plateau: pl.positiveShare, plateauKraken: plK.positiveShare,
      passRevx: r.pass, failedRevx: r.failed, passKraken: k.pass, failedKraken: k.failed,
    };
  }

  const coinRules: Record<string, Record<string, CoinRule>> = { A: {}, B: {} };   // window → "rule·SYM" → record
  const ruleSymbols: Record<string, string[]> = {
    "trend-4h": ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "SUI/USD"],
    "trend-1h": ["BTC/USD", "ETH/USD", "SOL/USD"],
    "momentum-1d": ["BTC/USD", "ETH/USD", "SOL/USD"],
  };
  for (const [rule, syms] of Object.entries(ruleSymbols)) {
    for (const symbol of syms) {
      const { hourly, c4h, daily } = series[symbol];
      const bars = rule === "trend-1h" ? hourly : c4h;
      const barHours = rule === "trend-1h" ? 1 : 4;
      const kind = rule as StrategyKind;
      const st = stopsForKind(kind, DEFAULT_TREND);
      for (const w of windowsFor(bars.length)) {
        const oos = segmentRecord(rule, symbol, w.oosFrom, w.oosTo);
        const prior = segmentRecord(rule, symbol, w.priorFrom, w.priorTo);
        const other = w.otherIsLookAhead ? segmentRecord(rule, symbol, w.otherFrom, w.otherTo) : prior;
        // the in-sample entry volatility and binding stop distance — what the vol and risk arms size on
        const insample = runSized(symbol, bars, w.isFrom, w.isTo, DEFAULT_TREND.slow + 1, shippedDecider(kind, symbol, bars, daily, DEFAULT_TREND, barHours), COSTS.revx, st, null);
        // the grid chosen in sample, for the record (§3.7's own way of judging a candidate)
        let bestIdx = 0, bestScore = -Infinity;
        if (kind !== "momentum-1d") {
          TREND_GRID.forEach((p, i) => {
            const s = score(run(kind, symbol, bars, daily, w.isFrom, w.isTo, p, COSTS.revx, barHours, stopsForKind(kind, p)));
            if (s > bestScore) { bestScore = s; bestIdx = i; }
          });
        }
        const chosenP = TREND_GRID[bestIdx];
        const chosenOos = kind === "momentum-1d" ? null : run(kind, symbol, bars, daily, w.oosFrom, w.oosTo, chosenP, COSTS.revx, barHours, stopsForKind(kind, chosenP));
        // per-trade statistics out of sample, on the venue the row runs
        const tl = runSized(symbol, bars, w.oosFrom, w.oosTo, DEFAULT_TREND.slow + 1, shippedDecider(kind, symbol, bars, daily, DEFAULT_TREND, barHours), COSTS.revx, st, null).tradeLog;
        const gross = tl.map((t) => t.gross);
        coinRules[w.name][`${rule}·${symbol}`] = {
          rule, symbol, oos, prior, other,
          chosen: kind === "momentum-1d" ? null : { fast: chosenP.fast, slow: chosenP.slow, atrStop: chosenP.atrStop },
          chosenOos: chosenOos ? pick(chosenOos) : null,
          atrPctAtEntry: Number(median(insample.entryAtrPct).toFixed(5)),
          stopPctAtEntry: Number(median(insample.entryStopPct).toFixed(5)),
          entriesInSample: insample.entryAtrPct.length,
          tradeStats: tl.length
            ? {
              count: tl.length,
              meanGross: Number((gross.reduce((a, g) => a + g, 0) / gross.length).toFixed(4)),
              medianGross: Number(median(gross).toFixed(4)),
              meanNet: Number((tl.reduce((a, t) => a + t.net, 0) / tl.length).toFixed(4)),
              winRateGross: Number((gross.filter((g) => g > 0).length / gross.length).toFixed(3)),
              medianHoldBars: Number(median(tl.map((t) => t.holdBars)).toFixed(1)),
              medianHoldDays: Number((median(tl.map((t) => t.holdBars)) * barHours / 24).toFixed(2)),
              shareGrossOver: {
                "0.0020": Number((gross.filter((g) => g > 0.0020).length / gross.length).toFixed(3)),
                "0.0082": Number((gross.filter((g) => g > 0.0082).length / gross.length).toFixed(3)),
                "0.0200": Number((gross.filter((g) => g > 0.0200).length / gross.length).toFixed(3)),
              },
            }
            : null,
        };
      }
      console.log(`${rule} ${symbol}: A oos ${(coinRules.A[`${rule}·${symbol}`].oos.ret * 100).toFixed(1)}% prior ${(coinRules.A[`${rule}·${symbol}`].prior.ret * 100).toFixed(1)}% | B oos ${(coinRules.B[`${rule}·${symbol}`].oos.ret * 100).toFixed(1)}% prior ${(coinRules.B[`${rule}·${symbol}`].prior.ret * 100).toFixed(1)}%`);
    }
  }

  // ── the rotation basket, both windows, both venues, WITH the shipped stops ──
  const basketSymbols = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"];
  const basketDaily: Record<string, Candle[]> = {};
  {
    const common = basketSymbols.map((s) => new Set(series[s].daily.map((c) => c.start))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    for (const s of basketSymbols) basketDaily[s] = series[s].daily.filter((c) => common.has(c.start));
  }
  const nd = basketDaily[basketSymbols[0]].length;
  const rotStops = stopsForKind("rotation-1d", DEFAULT_TREND);
  const rotation: Record<string, Record<string, unknown>> = {};
  for (const w of windowsFor(nd)) {
    const per: Record<string, unknown> = {};
    for (const [venue, costs] of Object.entries(COSTS)) {
      const seededP: RotationParams = venue === "kraken" ? { ...DEFAULT_ROTATION, minHoldDays: 7 } : DEFAULT_ROTATION;
      const seeded = runRotation(basketDaily, w.oosFrom, w.oosTo, seededP, costs, rotStops);
      const bare = runRotation(basketDaily, w.oosFrom, w.oosTo, seededP, costs);
      const prior = runRotation(basketDaily, w.priorFrom, w.priorTo, seededP, costs, rotStops);
      const gridOos = ROTATION_GRID.map((p) => runRotation(basketDaily, w.oosFrom, w.oosTo, { ...p, minHoldDays: seededP.minHoldDays }, costs, rotStops).ret);
      const other = runRotation(basketDaily, w.oosFrom, w.oosTo, seededP, COSTS[venue === "revx" ? "kraken" : "revx"], rotStops);
      const pl = plateauOf(gridOos, seeded.ret);
      const { pass, failed } = barTests(seeded.ret, seeded.maxDD, pl.positiveShare, other.ret);
      per[venue] = {
        seededParams: seededP,
        shipped: { ...pick(seeded), turnoverPerYear: Number(seeded.turnover.toFixed(2)) },
        bareRankRule: { ...pick(bare), turnoverPerYear: Number(bare.turnover.toFixed(2)) },
        priorSegment: { ...pick(prior), turnoverPerYear: Number(prior.turnover.toFixed(2)) },
        plateau: pl, pass, failed,
        buyHoldEqualWeight: Number(buyHoldBasket(basketDaily, w.oosFrom, w.oosTo, costs).toFixed(4)),
      };
      console.log(`rotation ${w.name} ${venue}: shipped ${(seeded.ret * 100).toFixed(1)}% (bare rank rule ${(bare.ret * 100).toFixed(1)}%), prior segment ${(prior.ret * 100).toFixed(1)}%`);
    }
    rotation[w.name] = per;
  }

  // ── the cores: one per live member per window, at weight 1 ──────────────
  type Spec = { id: string; rowId: string; rule: string; venue: "revx" | "kraken"; symbol: string | null; rowDeployable: number; symbolsInRow: number };
  const specs: Spec[] = [];
  for (const row of LIVE_ROWS) {
    const slot = Math.min(row.capitalUsd / row.slots, MAX_ORDER_USD);
    const deployable = slot * row.slots;
    if (row.kind === "rotation-1d") specs.push({ id: `${row.id}·${row.venue}`, rowId: row.id, rule: "rotation-1d", venue: row.venue, symbol: null, rowDeployable: deployable, symbolsInRow: 1 });
    else for (const s of row.symbols) specs.push({ id: `${row.kind}·${row.venue}·${s.split("/")[0]}`, rowId: row.id, rule: row.kind, venue: row.venue, symbol: s, rowDeployable: deployable, symbolsInRow: row.symbols.length });
  }

  function buildCore(spec: Spec, wname: "A" | "B", weight: ((i: number) => number) | null = null, segment: "oos" | "prior" = "oos"): Core {
    const costs = COSTS[spec.venue];
    if (spec.symbol == null) {
      const w = windowsFor(nd).find((x) => x.name === wname)!;
      const [from, to] = segment === "oos" ? [w.oosFrom, w.oosTo] : [w.priorFrom, w.priorTo];
      const p: RotationParams = spec.venue === "kraken" ? { ...DEFAULT_ROTATION, minHoldDays: 7 } : DEFAULT_ROTATION;
      const r = runRotation(basketDaily, from, to, p, costs, rotStops);
      const rets = dailyReturns(r.equity);
      // The basket's invested days, from `runRotation`'s own curve: a day whose equity moved is a day it held
      // something (fully in cash the curve is flat). A proxy, named as one — the per-coin sleeves are exact.
      return {
        id: spec.id, rowId: spec.rowId, rule: spec.rule, venue: spec.venue, symbol: null,
        rets, open: new Map([...rets].map(([d, x]) => [d, x !== 0 ? 1 : 0])),
        ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure,
        days: r.days, tradedPerSlot: r.turnover * Math.max(1e-9, r.days / 365),
      };
    }
    const { hourly, c4h, daily } = series[spec.symbol];
    const bars = spec.rule === "trend-1h" ? hourly : c4h;
    const barHours = spec.rule === "trend-1h" ? 1 : 4;
    const w = windowsFor(bars.length).find((x) => x.name === wname)!;
    const [from, to] = segment === "oos" ? [w.oosFrom, w.oosTo] : [w.priorFrom, w.priorTo];
    const kind = spec.rule as StrategyKind;
    const st = stopsForKind(kind, DEFAULT_TREND);
    const r = runSized(spec.symbol, bars, from, to, DEFAULT_TREND.slow + 1,
      shippedDecider(kind, spec.symbol, bars, daily, DEFAULT_TREND, barHours), costs, st, weight);
    return {
      id: spec.id, rowId: spec.rowId, rule: spec.rule, venue: spec.venue, symbol: spec.symbol,
      rets: dailyReturns(r.equity), open: dailyOpen(r.openFlags),
      ret: r.ret, maxDD: r.maxDD, trades: r.trades, exposure: r.exposure,
      days: r.days, tradedPerSlot: weight ? r.tradedWeight : r.trades,
    };
  }

  const cores: Record<"A" | "B", Core[]> = { A: [], B: [] };
  const priorCores: Record<"A" | "B", Core[]> = { A: [], B: [] };
  for (const wname of ["A", "B"] as const) {
    for (const spec of specs) {
      cores[wname].push(buildCore(spec, wname));
      priorCores[wname].push(buildCore(spec, wname, null, "prior"));
    }
  }

  // ── the row plans: how the book is split between the rows (question 2) ──
  //
  // Named plans, priced identically on both windows. `_sameBook` plans keep
  // the whole $400 at work by scaling the rows that remain; the plain ones
  // drop a row and leave its money in cash, which is what "drop it" really
  // means when nothing else has earned the capital. `retOnBook` is every
  // plan's P&L over the $400 the owner would otherwise have committed, so a
  // smaller book is not flattered by a smaller denominator.

  type RowPlan = { name: string; capital: Record<string, number>; note: string };
  const shippedCapital: Record<string, number> = Object.fromEntries(LIVE_ROWS.map((r) => [r.id, specs.find((s) => s.rowId === r.id)!.rowDeployable]));
  const zeroCapital: Record<string, number> = Object.fromEntries(LIVE_ROWS.map((r) => [r.id, 0]));
  /** A plan from a list of rows: their shipped proportions, scaled to `book` (or left alone when `book` is null). */
  function planOf(name: string, rows: string[], book: number | null, note: string): RowPlan {
    const base = rows.reduce((a, id) => a + shippedCapital[id], 0);
    const k = book == null ? 1 : book / base;
    return { name, capital: { ...zeroCapital, ...Object.fromEntries(rows.map((id) => [id, Number((shippedCapital[id] * k).toFixed(2))])) }, note };
  }
  const REVX_ROWS = LIVE_ROWS.filter((r) => r.venue === "revx").map((r) => r.id);
  const rowPlans: RowPlan[] = [
    { name: "shipped", capital: { ...shippedCapital }, note: "what the rows carry today — $400 deployable of $440 of row capital" },
    planOf("revxOnly_sameBook", REVX_ROWS, BOOK_USD, "the Kraken rows' $180 moved to the Revolut X rows in their existing proportions; the same $400 at work"),
    planOf("revxOnly_smallerBook", REVX_ROWS, null, "the Kraken rows dropped and their money NOT redeployed — $220 at work, $180 in cash"),
    planOf("dropRotation", ["trend-4h", "trend-1h", "momentum-1d", "trend-4h-kraken", "momentum-1d-kraken"], null, "both rotation rows dropped, nothing redeployed"),
    planOf("revxNoRotation", ["trend-4h", "trend-1h", "momentum-1d"], null, "Revolut X only, no rotation — $180 at work"),
    planOf("revxNoRotation_sameBook", ["trend-4h", "trend-1h", "momentum-1d"], BOOK_USD, "the same three rows scaled to the whole $400"),
    planOf("trend4hPlusMomentum", ["trend-4h", "momentum-1d"], null, "the two Revolut X rules with the most evidence behind them — $140 at work"),
    planOf("trend4hPlusMomentum_sameBook", ["trend-4h", "momentum-1d"], BOOK_USD, "the same two rows scaled to the whole $400"),
    planOf("trend4hOnly", ["trend-4h"], null, "go-live.md's recommendation: one row, five $20 slots"),
    planOf("trend4hOnly_sameBook", ["trend-4h"], BOOK_USD, "the one row at four times the size — $80 a slot, which needs max_order_usd and max_exposure_usd raised"),
    planOf("trend4hBothVenues", ["trend-4h", "trend-4h-kraken"], null, "the same rule on both venues, to price the twin"),
    planOf("krakenOnly", LIVE_ROWS.filter((r) => r.venue === "kraken").map((r) => r.id), null, "the Kraken rows alone — $180 at work"),
  ];
  /** The row-level evidence plan, one per window: $400 split between the rows in proportion to what each
   *  earned per unit of drawdown on its PRIOR segment — the same honest weighting question 1 applies to
   *  coins, applied to rows. A row that lost on the prior segment gets nothing. */
  const rowEvidencePlan: Record<"A" | "B", RowPlan> = { A: rowPlans[0], B: rowPlans[0] };
  for (const wname of ["A", "B"] as const) {
    const sc: Record<string, number> = {};
    for (const r of LIVE_ROWS) {
      const mine = priorCores[wname].filter((c) => c.rowId === r.id)
        .map((c) => ({ ...c, slotUsd: shippedCapital[r.id] / (c.symbol == null ? 1 : r.symbols.length), perOrderUsd: 0 }));
      const st = combine(mine);
      sc[r.id] = Math.max(0, st.retOverDD);
    }
    const tot = Object.values(sc).reduce((a, x) => a + x, 0);
    rowEvidencePlan[wname] = {
      name: "rowEvidencePrior",
      capital: tot > 0
        ? Object.fromEntries(LIVE_ROWS.map((r) => [r.id, Number((BOOK_USD * sc[r.id] / tot).toFixed(2))]))
        : { ...shippedCapital },
      note: `$400 split between the rows by each row's return over drawdown on the prior segment (${JSON.stringify(Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, Number(v.toFixed(2))])))}); a row negative there gets nothing`,
    };
  }

  /** Price a row plan on one window, splitting each row's capital between its coins by `arm`. */
  function planSleeves(plan: RowPlan, arm: ArmName, wname: "A" | "B"): Sleeve[] {
    const out: Sleeve[] = [];
    for (const row of LIVE_ROWS) {
      const cap = plan.capital[row.id] ?? 0;
      if (cap <= 0) continue;
      const rowSpecs = specs.filter((s) => s.rowId === row.id);
      if (row.kind === "rotation-1d") { out.push({ ...cores[wname].find((x) => x.id === rowSpecs[0].id)!, slotUsd: cap, perOrderUsd: cap / row.slots }); continue; }
      const w = weightsFor(arm, wname, row);
      for (const spec of rowSpecs) {
        const c = arm === "volScaledPerEntry" ? volCores[wname].find((x) => x.id === spec.id)! : cores[wname].find((x) => x.id === spec.id)!;
        out.push({ ...c, slotUsd: cap * w[spec.symbol!], perOrderUsd: cap * w[spec.symbol!] });
      }
    }
    return out;
  }

  /** The live slot: a row's deployable capital split equally between its coins (the rotation's is the whole row). */
  const shippedSleeves = (wname: "A" | "B"): Sleeve[] => planSleeves(rowPlans[0], "equal", wname);

  // ── question 1: how a row's capital is split between its coins ──────────
  //
  // Five arms plus the look-ahead bound. Every arm keeps each ROW's
  // deployable capital exactly where it is and moves money only between the
  // coins inside it, so question 1 and question 2 do not confound.

  type ArmName = "equal" | "invVolSlots" | "volScaledPerEntry" | "evidencePrior" | "concentrated" | "equalRisk" | "evidenceOtherWindowLookAhead";
  const ARMS: ArmName[] = ["equal", "invVolSlots", "volScaledPerEntry", "evidencePrior", "concentrated", "equalRisk", "evidenceOtherWindowLookAhead"];

  /** Normalise raw weights to 1 within a row; all-zero falls back to equal, and says so. */
  function normalise(raw: Record<string, number>): { w: Record<string, number>; fellBack: boolean } {
    const keys = Object.keys(raw);
    const total = keys.reduce((a, k) => a + Math.max(0, raw[k]), 0);
    if (!(total > 0)) return { w: Object.fromEntries(keys.map((k) => [k, 1 / keys.length])), fellBack: true };
    return { w: Object.fromEntries(keys.map((k) => [k, Math.max(0, raw[k]) / total])), fellBack: false };
  }

  const weightsReport: Record<string, Record<string, Record<string, unknown>>> = { A: {}, B: {} };

  // the per-entry volatility-scaled cores (§3.10's arm, kept for continuity: it can only deploy LESS)
  const volCores: Record<"A" | "B", Core[]> = { A: [], B: [] };
  for (const wname of ["A", "B"] as const) {
    for (const spec of specs) {
      if (spec.symbol == null) { volCores[wname].push(cores[wname].find((x) => x.id === spec.id)!); continue; }
      const target = coinRules[wname][`${spec.rule}·${spec.symbol}`].atrPctAtEntry;
      const { hourly, c4h } = series[spec.symbol];
      const bars = spec.rule === "trend-1h" ? hourly : c4h;
      volCores[wname].push(buildCore(spec, wname, (i: number) => {
        const a = atrAt(bars, i, SHIPPED_STOPS.atrN);
        if (a == null) return 1;
        return Math.min(1, target / (a / bars[i].close));
      }));
    }
  }

  function weightsFor(arm: ArmName, wname: "A" | "B", row: Row): Record<string, number> {
    const keyed = (f: (sym: string) => number) => Object.fromEntries(row.symbols.map((s) => [s, f(s)]));
    const rec = (s: string) => coinRules[wname][`${row.kind}·${s}`];
    if (arm === "equal" || arm === "volScaledPerEntry") return keyed(() => 1 / row.symbols.length);
    if (arm === "invVolSlots") return normalise(keyed((s) => { const a = rec(s).atrPctAtEntry; return a > 0 ? 1 / a : 0; })).w;
    if (arm === "equalRisk") return normalise(keyed((s) => { const d = rec(s).stopPctAtEntry; return d > 0 ? 1 / d : 0; })).w;
    if (arm === "evidencePrior") {
      return normalise(keyed((s) => Math.max(0, row.venue === "kraken" ? rec(s).prior.krakenRet : rec(s).prior.ret))).w;
    }
    if (arm === "evidenceOtherWindowLookAhead") {
      return normalise(keyed((s) => Math.max(0, row.venue === "kraken" ? rec(s).other.krakenRet : rec(s).other.ret))).w;
    }
    // concentrated: only the coins that clear the four tests on the PRIOR segment, on the row's own venue
    return normalise(keyed((s) => ((row.venue === "kraken" ? rec(s).prior.passKraken : rec(s).prior.passRevx) ? 1 : 0))).w;
  }

  /** The sleeves of one arm on one window: each row's deployable split by that arm's weights. */
  function sleevesFor(arm: ArmName, wname: "A" | "B"): Sleeve[] {
    return planSleeves({ name: "shipped", capital: shippedCapital, note: "" }, arm, wname);
  }

  const q1: Record<string, unknown> = {};
  for (const wname of ["A", "B"] as const) {
    const arms: Record<string, unknown> = {};
    for (const arm of ARMS) {
      const sl = sleevesFor(arm, wname);
      const st = combine(sl);
      arms[arm] = {
        ...st,
        needsMaxOrderRaisedTo: Number(Math.max(MAX_ORDER_USD, st.maxOrderUsd).toFixed(2)),
        perRow: Object.fromEntries(LIVE_ROWS.map((r) => [r.id, combine(sl.filter((s) => s.rowId === r.id))])),
      };
    }
    for (const row of LIVE_ROWS.filter((r) => r.kind !== "rotation-1d")) {
      weightsReport[wname][row.id] = Object.fromEntries(ARMS.map((arm) => [arm, weightsFor(arm, wname, row)]));
    }
    q1[wname] = {
      arms,
      weights: weightsReport[wname],
      note: "Every arm keeps each row's deployable capital where it is and splits it differently between that row's coins; the rotation sleeve is a basket decision and is identical in every arm (its slot is already capped at $20 by max_order_usd), so the arms understate any effect a per-coin weight would have on the basket rule.",
    };
  }
  report.question1_capitalPerCoin = q1;

  const q2: Record<string, unknown> = {};
  for (const wname of ["A", "B"] as const) {
    const all = shippedSleeves(wname);
    const whole = combine(all);
    const perRow = Object.fromEntries(LIVE_ROWS.map((r) => [r.id, combine(all.filter((s) => s.rowId === r.id))]));
    const leaveOneRowOut = LIVE_ROWS.map((r) => {
      const without = combine(all.filter((s) => s.rowId !== r.id));
      return {
        rowId: r.id, ownPnlUsd: perRow[r.id].pnlUsd,
        setRetOverDDWithout: without.retOverDD, deltaRetOverDD: Number((whole.retOverDD - without.retOverDD).toFixed(2)),
        setPnlWithout: without.pnlUsd, setMaxDDWithout: without.maxDD,
        setRetOnBookWithout: without.retOnBook,
      };
    }).sort((a, b) => a.deltaRetOverDD - b.deltaRetOverDD);
    // row-level correlations: each row's own daily P&L per $1 of row capital
    const rowRets: Record<string, Map<number, number>> = {};
    for (const r of LIVE_ROWS) {
      const mine = all.filter((s) => s.rowId === r.id);
      const cap = mine.reduce((a, s) => a + s.slotUsd, 0);
      const m = new Map<number, number>();
      for (const day of new Set(mine.flatMap((s) => [...s.rets.keys()]))) {
        let pnl = 0;
        for (const s of mine) pnl += s.slotUsd * (s.rets.get(day) ?? 0);
        m.set(day, pnl / Math.max(1e-9, cap));
      }
      rowRets[r.id] = m;
    }
    const rowCorr: { a: string; b: string; corr: number }[] = [];
    for (let i = 0; i < LIVE_ROWS.length; i++) {
      for (let j = i + 1; j < LIVE_ROWS.length; j++) {
        const c = corr(rowRets[LIVE_ROWS[i].id], rowRets[LIVE_ROWS[j].id]);
        if (c != null) rowCorr.push({ a: LIVE_ROWS[i].id, b: LIVE_ROWS[j].id, corr: Number(c.toFixed(3)) });
      }
    }
    q2[wname] = {
      perRow, leaveOneRowOut, rowCorrelations: rowCorr.sort((a, b) => b.corr - a.corr),
      plans: Object.fromEntries([...rowPlans, rowEvidencePlan[wname]].map((p) => [p.name, { capital: p.capital, note: p.note, equalSlots: combine(planSleeves(p, "equal", wname)) }])),
    };
  }
  report.question2_capitalPerRow = q2;

  // ── question 5: does the allocation work drop or add a coin? ────────────
  //
  // Leave one coin out of a row and price the row without it, both windows.
  // A coin whose removal improves the row on BOTH windows is a coin the
  // allocation work is asking about; one that improves it on one and hurts
  // it on the other is the two windows disagreeing again, which is not a
  // reason to touch a seeded row.
  const q5: Record<string, unknown> = {};
  for (const row of LIVE_ROWS.filter((r) => r.kind !== "rotation-1d")) {
    const per: Record<string, unknown> = {};
    for (const wname of ["A", "B"] as const) {
      const all = planSleeves(rowPlans[0], "equal", wname).filter((s) => s.rowId === row.id);
      const whole = combine(all);
      per[wname] = {
        whole,
        leaveOneCoinOut: row.symbols.map((sym) => {
          // the row's capital stays put: the remaining coins split it equally, as `tick.ts` would
          const keep = all.filter((s) => s.symbol !== sym);
          const slot = whole.capitalUsd / keep.length;
          const without = combine(keep.map((s) => ({ ...s, slotUsd: slot, perOrderUsd: slot })));
          return {
            symbol: sym, ownRet: Number((all.find((s) => s.symbol === sym)!.ret).toFixed(4)),
            rowRetWithout: without.ret, rowMaxDDWithout: without.maxDD, rowRetOverDDWithout: without.retOverDD,
            deltaRetOverDD: Number((without.retOverDD - whole.retOverDD).toFixed(2)),
          };
        }).sort((a, b) => b.deltaRetOverDD - a.deltaRetOverDD),
      };
    }
    q5[row.id] = per;
  }
  report.question5_coinChanges = {
    note: "Leave-one-coin-out inside each row, the row's capital re-split equally between the coins that remain — what tick.ts does when a symbol leaves a row. A positive delta means the row's return over drawdown improved without that coin.",
    perRow: q5,
    krakenOnlyCandidates: "see question3_venueSplit.krakenOnlyCandidates — POL and LINK on Kraken's costs with the SEEDED parameters, both windows, with §4.16's liquidity test",
  };

  // ── question 3: the venue split, in arithmetic and then in backtest ─────

  const venueArithmetic = STUDY_SYMBOLS.map((s) => {
    const revxRt = 2 * (COSTS.revx.takerBps + spreadOf(COSTS.revx, s) * 1e4);
    const krakenRt = 2 * (COSTS.kraken.makerBps + spreadOf(COSTS.kraken, s) * 1e4);
    return {
      symbol: s,
      revxRoundTripBps: Number(revxRt.toFixed(2)), krakenRoundTripBps: Number(krakenRt.toFixed(2)),
      extraBpsPerRoundTrip: Number((krakenRt - revxRt).toFixed(2)),
      krakenNeedsGrossMovePct: Number((krakenRt / 1e4 * 100).toFixed(3)),
    };
  });
  const perRuleTrades: Record<string, unknown> = {};
  for (const [rule, syms] of Object.entries(ruleSymbols)) {
    for (const symbol of syms) {
      for (const wname of ["A", "B"] as const) {
        const cr = coinRules[wname][`${rule}·${symbol}`];
        if (cr.tradeStats) perRuleTrades[`${rule}·${symbol}·${wname}`] = cr.tradeStats;
      }
    }
  }
  const q3: Record<string, unknown> = {
    arithmetic: {
      note: "A round trip costs, per venue: Revolut X 2 × (9 bps taker + half-spread), Kraken 2 × (40 bps maker + half-spread). The extra column is what a Kraken round trip must earn over a Revolut X one before it is worth taking. Kraken's own spread is 100× tighter, so nearly all of it is fee.",
      perSymbol: venueArithmetic,
    },
    perTradeGross: {
      note: "The raw price move each closed round trip caught before any spread or fee, out of sample, from the trade log. `shareGrossOver` is the share of round trips whose gross move beat 20 bps (a Revolut X round trip on a major), 82 bps (a Kraken one) and 200 bps.",
      stats: perRuleTrades,
    },
    breakEven: {
      note: "Per rulebook, across its coin-windows: the MEAN gross move a round trip caught, against what a round trip costs on each venue. A rule is worth running on a venue only where the mean gross exceeds that venue's round trip — the median never does, on any rule, in either window, because trend following pays for many small losses with a few large wins.",
      perRule: Object.fromEntries(Object.keys(ruleSymbols).map((rule) => {
        const keys = Object.keys(perRuleTrades).filter((k) => k.startsWith(`${rule}·`));
        const means = keys.map((k) => (perRuleTrades[k] as { meanGross: number }).meanGross);
        const meds = keys.map((k) => (perRuleTrades[k] as { medianGross: number }).medianGross);
        const holds = keys.map((k) => (perRuleTrades[k] as { medianHoldDays: number }).medianHoldDays);
        return [rule, {
          coinWindows: keys.length,
          meanGrossMedianAcrossCoinWindows: Number(median(means).toFixed(4)),
          medianGrossMedianAcrossCoinWindows: Number(median(meds).toFixed(4)),
          medianHoldDays: Number(median(holds).toFixed(2)),
          coinWindowsWithMeanGrossOverRevxRoundTrip: means.filter((m) => m > 0.00195).length,
          coinWindowsWithMeanGrossOverKrakenRoundTrip: means.filter((m) => m > 0.0082).length,
        }];
      })),
    },
  };
  for (const wname of ["A", "B"] as const) {
    const all = shippedSleeves(wname);
    const twins = all.filter((s) => s.venue === "kraken").map((s) => {
      const tid = s.symbol ? `${s.rule}·revx·${s.symbol.split("/")[0]}` : "rotation-1d·revx";
      const t = all.find((x) => x.id === tid);
      return {
        id: s.id, twin: t?.id ?? null, corr: t ? Number((corr(s.rets, t.rets) ?? NaN).toFixed(3)) : null,
        krakenRet: Number(s.ret.toFixed(4)), twinRet: t ? Number(t.ret.toFixed(4)) : null,
        costDragPoints: t ? Number(((t.ret - s.ret) * 100).toFixed(2)) : null,
        krakenPnlUsd: Number((s.slotUsd * s.ret).toFixed(2)), twinPnlUsd: t ? Number((t.slotUsd * t.ret).toFixed(2)) : null,
      };
    });
    (q3 as Record<string, unknown>)[wname] = {
      krakenTwins: twins,
      krakenRowsOnly: combine(all.filter((s) => s.venue === "kraken")),
      revxRowsOnly: combine(all.filter((s) => s.venue === "revx")),
      krakenTrend4hOnly: combine(all.filter((s) => s.rowId === "trend-4h-kraken")),
      krakenSlowestOnly: combine(all.filter((s) => s.rowId === "trend-4h-kraken" || s.rowId === "rotation-1w-kraken")),
    };
  }
  // A Kraken-only coin: POL on Kraken costs, both windows, with the plateau and the book test.
  const krakenOnly: Record<string, unknown> = {};
  for (const symbol of ["POL/USD", "LINK/USD"]) {
    const { c4h, daily } = series[symbol];
    const per: Record<string, unknown> = {};
    for (const w of windowsFor(c4h.length)) {
      const st = stopsForKind("trend-4h", DEFAULT_TREND);
      const kr = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.kraken, 4, st);
      const rx = run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, DEFAULT_TREND, COSTS.revx, 4, st);
      const gridK = TREND_GRID.map((p) => run("trend-4h", symbol, c4h, daily, w.oosFrom, w.oosTo, p, COSTS.kraken, 4, stopsForKind("trend-4h", p)).ret);
      const pl = plateauOf(gridK, kr.ret);
      const { pass, failed } = barTests(kr.ret, kr.maxDD, pl.positiveShare, rx.ret);
      if (KRAKEN_BOOK_USD_PER_DAY[symbol] == null) failed.push("Kraken 24 h book never measured — §4.16's liquidity test cannot be applied");
      per[w.name] = { krakenSeeded: pick(kr), revxSeeded: pick(rx), plateauOnKraken: pl, passesNumbers: pass, failed, ukBookUsdPerDay: UK_BOOK_USD_PER_DAY[symbol] ?? null, krakenBookUsdPerDay: KRAKEN_BOOK_USD_PER_DAY[symbol] ?? null };
    }
    krakenOnly[symbol] = { ...per, shortHistoryYears: SHORT_HISTORY[symbol] ?? null };
  }
  (q3 as Record<string, unknown>).krakenOnlyCandidates = krakenOnly;
  report.question3_venueSplit = q3;

  // ── question 4: which rulebooks earn their place ────────────────────────
  const q4: Record<string, unknown> = {
    perCoinRule: coinRules,
    rotation,
    feedbackSpeed: Object.fromEntries(["A", "B"].map((wname) => [wname, LIVE_ROWS.map((r) => {
      const mine = cores[wname as "A" | "B"].filter((c) => c.rowId === r.id);
      const fills = mine.reduce((a, c) => a + c.trades, 0);
      const days = Math.max(1, Math.max(...mine.map((c) => c.days)));
      return { rowId: r.id, fills, days: Math.round(days), fillsPer30Days: Number((fills / days * 30).toFixed(1)), daysToTenFills: Number((10 / Math.max(1e-9, fills / days)).toFixed(0)) };
    })])),
  };
  report.question4_rulebooks = q4;

  // ── question 6: the recommended set, priced against the alternatives ────
  //
  // Every candidate set is priced with the SAME machinery on both windows,
  // against the shipped set, against holding BTC/ETH/SOL/XRP equally, and
  // against cash. The recommendation is whichever of these the report argues
  // for; the table is here so the argument can be checked.

  const q6: Record<string, unknown> = {};
  for (const wname of ["A", "B"] as const) {
    const candidateSets: { name: string; plan: RowPlan; arm: ArmName }[] = [];
    for (const plan of [...rowPlans, rowEvidencePlan[wname]]) for (const arm of ["equal", "evidencePrior", "concentrated", "invVolSlots", "equalRisk"] as ArmName[]) {
      candidateSets.push({ name: `${plan.name}·${arm}`, plan, arm });
    }
    const w = windowsFor(nd).find((x) => x.name === wname)!;
    const bh = buyHoldBasket(basketDaily, w.oosFrom, w.oosTo, COSTS.revx);
    const rows: Record<string, unknown> = {};
    for (const c of candidateSets) rows[c.name] = combine(planSleeves(c.plan, c.arm, wname));
    q6[wname] = {
      sets: rows,
      buyHoldEqualWeightMajors: { ret: Number(bh.toFixed(4)), note: "BTC/ETH/SOL/XRP equal-weight, entered as a taker on Revolut X at the window's first open" },
      cash: { ret: 0, maxDD: 0, note: "the alternative that cannot lose money" },
    };
  }
  report.question6_recommendedSet = q6;

  // The recommended configuration, named in the data so the report's table can be checked against it.
  const RECOMMENDED = { plan: rowPlans.find((p) => p.name === "trend4hOnly")!, arm: "equal" as ArmName };
  const ALTERNATE = { plan: rowPlans.find((p) => p.name === "trend4hPlusMomentum")!, arm: "equal" as ArmName };
  report.recommendation = {
    chosen: "trend-4h on Revolut X only — BTC / ETH / SOL / AVAX / SUI, five equal $20 slots, $100 of row capital. Every other row paper.",
    reason: "It is the configuration with the best WORSE window of everything priced here: its return over drawdown is −0.03 in the bear year and +1.24 in the bull, and nothing that adds a row or re-weights a coin improves both. Equal slots because no weighting arm beat equal slots on both windows, and the two that look best in one window (inverse volatility, equal risk) are beaten by it in the other.",
    alternate: "trend-4h + momentum-1d on Revolut X ($140): the one addition the two windows support on balance (bull ret/DD 1.24 → 3.31) at the cost of the bear year (−0.03 → −0.14) and of the drawdown (11.8 % → 18.7 %).",
    caps: {
      maxOrderUsd: MAX_ORDER_USD, maxExposureUsdLive: MAX_EXPOSURE_USD_LIVE,
      note: "the recommendation fits both caps exactly as they stand: $20 a slot and $100 of open notional at the peak. The alternate needs max_exposure_usd raised from $100 to $140.",
    },
    windows: Object.fromEntries(["A", "B"].map((wname) => [wname, {
      recommended: combine(planSleeves(RECOMMENDED.plan, RECOMMENDED.arm, wname as "A" | "B")),
      alternate: combine(planSleeves(ALTERNATE.plan, ALTERNATE.arm, wname as "A" | "B")),
      shipped: combine(planSleeves(rowPlans[0], "equal", wname as "A" | "B")),
    }])),
  };

  await Deno.writeTextFile(`${outDir}/allocation.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${outDir}/allocation.json in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
  for (const wname of ["A", "B"] as const) {
    const arms = (q1[wname] as Record<string, Record<string, PortfolioStats>>).arms;
    for (const arm of ARMS) {
      const a = arms[arm];
      console.log(`window ${wname} ${arm.padEnd(30)} $${a.capitalUsd} → $${a.pnlUsd} (${(a.ret * 100).toFixed(1)}%, DD ${(a.maxDD * 100).toFixed(1)}%, ret/DD ${a.retOverDD}, turnover ${a.turnoverPerYear}×/y, worst day $${a.worstDayUsd})`);
    }
  }
}
