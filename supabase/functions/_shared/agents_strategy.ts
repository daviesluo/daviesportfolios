// The agents' strategy maths — ONE implementation, imported by the
// `agents` Edge Function (live and paper) and by the backtester. Every
// number the strategies act on is computed here, deterministically, from
// candles and fills. Nothing in this file calls the network, reads the
// clock, or asks the model: it turns data into a categorical state, a
// rulebook decision, and a risk verdict, and it is pinned by
// agents/index.test.ts.
//
// Why the split matters (docs/agents/reference.md §1.4 and §4): Jev, the
// decision model, is documented by its vendor as unable to reason about
// numbers or dates. So the model never sees a price. It sees the
// CategoricalState below — a dozen words — and answers typed questions
// about it; the rulebook decides; the risk gate has the last word; and
// what the model contributed is recorded on every decision so its value
// can be measured rather than assumed.

export type Candle = { start: number; open: number; high: number; low: number; close: number; volume: number };

// ---------------------------------------------------------------- indicators

/** Simple moving average of `values`, null until `n` values exist. */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Average true range over the last `n` candles ending at index `i`, or null. */
export function atrAt(candles: Candle[], i: number, n = 14): number | null {
  if (i < n) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const c = candles[k], p = candles[k - 1];
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  return sum / n;
}

/** Highest high / lowest low over the `n` candles BEFORE index `i` (prior window, so a breakout compares the close to what came before it). */
export function priorRange(candles: Candle[], i: number, n: number): { high: number; low: number } | null {
  if (i < n) return null;
  let high = -Infinity, low = Infinity;
  for (let k = i - n; k < i; k++) { high = Math.max(high, candles[k].high); low = Math.min(low, candles[k].low); }
  return { high, low };
}

/** Realised volatility of close-to-close log returns over the last `n` bars, annualised for `barsPerYear`. */
export function realisedVol(closes: number[], i: number, n: number, barsPerYear: number): number | null {
  if (i < n) return null;
  let s = 0, s2 = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const r = Math.log(closes[k] / closes[k - 1]);
    s += r; s2 += r * r;
  }
  const mean = s / n;
  const v = Math.max(0, s2 / n - mean * mean);
  return Math.sqrt(v) * Math.sqrt(barsPerYear);
}

// ------------------------------------------------------------- the position

export type Position = {
  /** Base units held (0 = flat). */
  base: number;
  /** Average cost per unit in quote (USD) of what is held. */
  avgCost: number;
  /** Realised P&L in USD banked so far, fees included. */
  realisedUsd: number;
  /** Fees paid in USD so far. */
  feesUsd: number;
  /** Epoch ms the current position was opened, null when flat. */
  openedAt: number | null;
  /** Highest mark seen while in the current position (for the trailing stop). */
  highWater: number | null;
};

export const FLAT: Position = { base: 0, avgCost: 0, realisedUsd: 0, feesUsd: 0, openedAt: null, highWater: null };

export type Fill = { ts: number; side: "buy" | "sell"; base: number; price: number; feeUsd: number };

/** Apply a fill to a position. Sells realise (price − avgCost) × base − fee; buys average in. */
export function applyFill(p: Position, f: Fill): Position {
  if (f.base <= 0 || f.price <= 0) return p;
  if (f.side === "buy") {
    const base = p.base + f.base;
    const avgCost = (p.base * p.avgCost + f.base * f.price) / base;
    return {
      base, avgCost,
      realisedUsd: p.realisedUsd - f.feeUsd,
      feesUsd: p.feesUsd + f.feeUsd,
      openedAt: p.base > 0 ? p.openedAt : f.ts,
      highWater: p.base > 0 ? Math.max(p.highWater ?? f.price, f.price) : f.price,
    };
  }
  const base = Math.max(0, p.base - f.base);
  const sold = Math.min(p.base, f.base);
  const realised = sold * (f.price - p.avgCost) - f.feeUsd;
  return {
    base,
    avgCost: base > 0 ? p.avgCost : 0,
    realisedUsd: p.realisedUsd + realised,
    feesUsd: p.feesUsd + f.feeUsd,
    openedAt: base > 0 ? p.openedAt : null,
    highWater: base > 0 ? p.highWater : null,
  };
}

export function positionFromFills(fills: Fill[]): Position {
  return fills.slice().sort((a, b) => a.ts - b.ts).reduce(applyFill, FLAT);
}

/** Mark-to-market: unrealised P&L in USD at `mark`. */
export function unrealisedUsd(p: Position, mark: number): number {
  return p.base > 0 ? p.base * (mark - p.avgCost) : 0;
}

// ------------------------------------------------------- categorical state

export type Trend = "up" | "down" | "flat";
export type Strength = "weak" | "moderate" | "strong";
export type Breakout = "above_range" | "inside_range" | "below_range";
export type VolRegime = "low" | "normal" | "high" | "extreme";
export type Momentum = "positive" | "negative" | "unknown";
export type Unrealised = "none" | "small_gain" | "gain" | "small_loss" | "loss";
export type TimeIn = "none" | "hours" | "days" | "weeks";

/**
 * What the model is shown. Every field is a word from a closed set; the
 * numbers that produced it stay in `Snapshot.numbers` for the record and
 * for the rulebook, and are NEVER put in front of the model.
 */
export type CategoricalState = {
  symbol: string;
  trend_4h: Trend;
  trend_strength: Strength;
  breakout_4h: Breakout;
  volatility: VolRegime;
  momentum_30d: Momentum;
  position: "flat" | "long";
  unrealised: Unrealised;
  time_in_position: TimeIn;
  drawdown_from_high: "none" | "small" | "notable" | "large";
};

export type Snapshot = {
  state: CategoricalState;
  numbers: {
    close: number;
    smaFast: number | null;
    smaSlow: number | null;
    priorHigh: number | null;
    priorLow: number | null;
    atr: number | null;
    vol: number | null;
    ret30d: number | null;
  };
};

export type TrendParams = {
  fast: number;      // 4h SMA fast, default 20
  slow: number;      // 4h SMA slow, default 100
  breakoutUp: number;   // prior-window length for the entry breakout, default 55
  breakoutDown: number; // prior-window length for the exit breakdown, default 20
  atrN: number;      // 14
  atrStop: number;   // trailing stop distance in ATRs, default 3
  volN: number;      // realised-vol window in 4h bars, default 42 (one week)
};

export const DEFAULT_TREND: TrendParams = { fast: 20, slow: 100, breakoutUp: 55, breakoutDown: 20, atrN: 14, atrStop: 3, volN: 42 };

const BARS_4H_PER_YEAR = 6 * 365;

/**
 * Turn the last `i` 4h candles (and the daily closes for the 30-day
 * momentum) into the state the model and the rulebook read. `i` is the
 * index of the last CLOSED candle; nothing at or after it is looked at.
 */
export type Precomputed = { fast: (number | null)[]; slow: (number | null)[]; closes: number[] };

/** The two SMAs over a whole series, once — the backtester passes this in so a run is linear, not quadratic. */
export function precompute(c4h: Candle[], p: TrendParams = DEFAULT_TREND): Precomputed {
  const closes = c4h.map((c) => c.close);
  return { fast: sma(closes, p.fast), slow: sma(closes, p.slow), closes };
}

export function buildSnapshot(
  symbol: string,
  c4h: Candle[],
  i: number,
  daily: Candle[],
  position: Position,
  nowMs: number,
  p: TrendParams = DEFAULT_TREND,
  pre?: Precomputed,
  barsPerYear = BARS_4H_PER_YEAR,
): Snapshot {
  // The live loop hands in a short window and lets this compute; the
  // backtester precomputes once. Both read the same arithmetic.
  const closes = pre ? pre.closes : c4h.slice(0, i + 1).map((c) => c.close);
  const fast = pre ? pre.fast[i] : sma(closes, p.fast)[i];
  const slow = pre ? pre.slow[i] : sma(closes, p.slow)[i];
  const close = c4h[i].close;
  const range = priorRange(c4h, i, p.breakoutUp);
  const exitRange = priorRange(c4h, i, p.breakoutDown);
  const atr = atrAt(c4h, i, p.atrN);
  const vol = realisedVol(closes, i, p.volN, barsPerYear);
  // 30-day momentum from daily closes: the last daily close vs the one 30 days earlier.
  const d = daily.length;
  const ret30d = d > 30 ? daily[d - 1].close / daily[d - 31].close - 1 : null;

  let trend: Trend = "flat", strength: Strength = "weak";
  if (fast != null && slow != null) {
    const gap = (fast - slow) / slow;
    trend = gap > 0.002 ? "up" : gap < -0.002 ? "down" : "flat";
    const a = Math.abs(gap);
    strength = a > 0.05 ? "strong" : a > 0.015 ? "moderate" : "weak";
  }
  const breakout: Breakout = !range ? "inside_range"
    : close > range.high ? "above_range"
    : exitRange && close < exitRange.low ? "below_range" : "inside_range";
  const volatility: VolRegime = vol == null ? "normal" : vol < 0.35 ? "low" : vol < 0.65 ? "normal" : vol < 1.0 ? "high" : "extreme";
  const momentum: Momentum = ret30d == null ? "unknown" : ret30d > 0 ? "positive" : "negative";

  const unrl = position.base > 0 ? (close - position.avgCost) / position.avgCost : 0;
  const unrealised: Unrealised = position.base === 0 ? "none"
    : unrl >= 0.05 ? "gain" : unrl >= 0 ? "small_gain" : unrl > -0.05 ? "small_loss" : "loss";
  const held = position.openedAt != null ? nowMs - position.openedAt : 0;
  const time_in_position: TimeIn = position.base === 0 ? "none"
    : held < 24 * 3600e3 ? "hours" : held < 7 * 24 * 3600e3 ? "days" : "weeks";
  const dd = position.highWater ? (position.highWater - close) / position.highWater : 0;
  const drawdown_from_high = position.base === 0 || dd <= 0.01 ? "none" : dd < 0.05 ? "small" : dd < 0.12 ? "notable" : "large";

  return {
    state: {
      symbol, trend_4h: trend, trend_strength: strength, breakout_4h: breakout, volatility,
      momentum_30d: momentum, position: position.base > 0 ? "long" : "flat",
      unrealised, time_in_position, drawdown_from_high,
    },
    numbers: { close, smaFast: fast, smaSlow: slow, priorHigh: range?.high ?? null, priorLow: exitRange?.low ?? null, atr, vol, ret30d },
  };
}

// ------------------------------------------------------------- the rulebook

export type Action = "enter" | "exit" | "hold";

/**
 * The deterministic rule. Long-only, one position per symbol.
 *   enter: flat, 4h trend up, close above the prior 55-bar high, 30-day momentum
 *          not negative, volatility not extreme.
 *   exit:  long and (trend down | close below the prior 20-bar low |
 *          close under the ATR trailing stop from the high-water mark).
 * Everything else holds. The backtests in docs/agents/reference.md §3 are
 * the reason for the shape: slow trend rules on 4h bars kept their gross
 * return after costs, fast ones did not.
 */
export function ruleDecision(snap: Snapshot, position: Position, p: TrendParams = DEFAULT_TREND): { action: Action; reason: string } {
  const s = snap.state, n = snap.numbers;
  if (position.base > 0) {
    if (s.trend_4h === "down") return { action: "exit", reason: "4h trend turned down" };
    if (s.breakout_4h === "below_range") return { action: "exit", reason: `close below prior ${p.breakoutDown}-bar low` };
    if (n.atr != null && position.highWater != null && n.close < position.highWater - p.atrStop * n.atr) {
      return { action: "exit", reason: `ATR trailing stop (${p.atrStop}×ATR from high-water)` };
    }
    return { action: "hold", reason: "in position, no exit condition" };
  }
  if (s.trend_4h !== "up") return { action: "hold", reason: "4h trend not up" };
  if (s.breakout_4h !== "above_range") return { action: "hold", reason: `no close above prior ${p.breakoutUp}-bar high` };
  if (s.momentum_30d === "negative") return { action: "hold", reason: "30-day momentum negative" };
  if (s.volatility === "extreme") return { action: "hold", reason: "volatility extreme" };
  return { action: "enter", reason: "trend up, breakout, momentum positive" };
}

/**
 * The second strategy: time-series momentum, decided once a day on daily
 * closes. Long while the close is above its close `lookbackDays` earlier
 * (the state's `momentum_30d`), flat otherwise; an extreme-volatility
 * regime blocks a new entry. The slowest rule in the reference's table,
 * and the one that kept the most of its gross after costs.
 */
export function ruleDecisionMomentum(snap: Snapshot, position: Position): { action: Action; reason: string } {
  const s = snap.state;
  if (position.base > 0) {
    if (s.momentum_30d === "negative") return { action: "exit", reason: "30-day momentum turned negative" };
    return { action: "hold", reason: "in position, momentum still positive" };
  }
  if (s.momentum_30d !== "positive") return { action: "hold", reason: s.momentum_30d === "unknown" ? "30-day momentum unknown" : "30-day momentum negative" };
  if (s.volatility === "extreme") return { action: "hold", reason: "volatility extreme" };
  return { action: "enter", reason: "30-day momentum positive" };
}

export type StrategyKind = "trend-4h" | "trend-1h" | "momentum-1d" | "rotation-1d" | "dislocation-1m";

// ---------------------------------------------------------- the rotation rule

/**
 * The third rulebook: relative-strength rotation, decided once a day on
 * daily closes across the strategy's symbols. Rank them by `lookbackDays`
 * return; hold the top `topN`, equal-weighted, and only those above their
 * `slowDays` moving average when the bear filter is on (dual momentum: the
 * relative leg picks what to hold, the absolute leg says whether to hold
 * anything). Capital is therefore deployed whenever at least one symbol
 * is trending — most of the time in a bull market, and not at all in a
 * broad bear, which is the whole point of the filter. `minHoldDays` damps
 * churn for the venue whose fees make churn expensive.
 */
export type RotationParams = { lookbackDays: number; topN: number; slowDays: number; bearFilter: boolean; minHoldDays: number };
export const DEFAULT_ROTATION: RotationParams = { lookbackDays: 30, topN: 2, slowDays: 100, bearFilter: true, minHoldDays: 0 };

export type RankView = { symbol: string; ret: number | null; aboveSlow: boolean | null; rank: number; inTop: boolean };

/**
 * The cross-section at one daily close. `daily` holds each symbol's CLOSED
 * daily candles, oldest first; the last one is the close being decided on.
 */
export function rotationTargets(daily: Record<string, Candle[]>, p: RotationParams = DEFAULT_ROTATION): Record<string, RankView> {
  const views: RankView[] = Object.entries(daily).map(([symbol, d]) => {
    const n = d.length;
    const ret = n > p.lookbackDays ? d[n - 1].close / d[n - 1 - p.lookbackDays].close - 1 : null;
    let aboveSlow: boolean | null = null;
    if (n >= p.slowDays) {
      let sum = 0;
      for (let k = n - p.slowDays; k < n; k++) sum += d[k].close;
      aboveSlow = d[n - 1].close > sum / p.slowDays;
    }
    return { symbol, ret, aboveSlow, rank: Infinity, inTop: false };
  });
  const ranked = views.filter((v) => v.ret != null).sort((a, b) => b.ret! - a.ret!);
  ranked.forEach((v, i) => { v.rank = i; });
  // The top N by return, each also above its slow average when the filter is on
  // (an average that cannot be computed yet does not block — there is nothing to compare).
  let taken = 0;
  for (const v of ranked) {
    if (taken >= p.topN) break;
    if (p.bearFilter && v.aboveSlow === false) continue;
    v.inTop = true; taken++;
  }
  return Object.fromEntries(views.map((v) => [v.symbol, v]));
}

export function ruleDecisionRotation(view: RankView, position: Position, nowMs: number, p: RotationParams = DEFAULT_ROTATION): { action: Action; reason: string } {
  if (position.base > 0) {
    if (view.inTop) return { action: "hold", reason: `in the top ${p.topN} by ${p.lookbackDays}-day return` };
    if (p.minHoldDays > 0 && position.openedAt != null && nowMs - position.openedAt < p.minHoldDays * 86400e3) {
      return { action: "hold", reason: `out of the top ${p.topN} but inside the ${p.minHoldDays}-day minimum hold` };
    }
    return { action: "exit", reason: view.aboveSlow === false ? `below the ${p.slowDays}-day average` : `dropped out of the top ${p.topN}` };
  }
  if (view.ret == null) return { action: "hold", reason: `fewer than ${p.lookbackDays + 1} daily closes` };
  if (!view.inTop) {
    return { action: "hold", reason: p.bearFilter && view.aboveSlow === false ? `below the ${p.slowDays}-day average` : `not in the top ${p.topN} (rank ${view.rank + 1})` };
  }
  return { action: "enter", reason: `rank ${view.rank + 1} by ${p.lookbackDays}-day return${p.bearFilter ? `, above the ${p.slowDays}-day average` : ""}` };
}

// ------------------------------------------------------ protective stops

/**
 * The highest price seen since the position was opened: the entry fills
 * and every closed bar's high after them. `Position.highWater` from fills
 * alone never rises with the market, which would make a trailing stop
 * that never trails — this is the number the stop trails from.
 */
export function highWaterSince(position: Position, bars: Candle[], lastClosedIdx: number): number | null {
  if (position.base <= 0 || position.openedAt == null) return null;
  let hw = position.highWater ?? position.avgCost;
  for (let i = 0; i <= lastClosedIdx && i < bars.length; i++) if (bars[i].start >= position.openedAt) hw = Math.max(hw, bars[i].high);
  return hw;
}

export type StopParams = { atrStop: number | null; maxLossPct: number };

/**
 * Checked EVERY turn against the live mark, between bar closes: the ATR
 * trailing stop from the high-water mark (the trend rules) and a hard
 * floor under the average cost (every rule). Returns the reason to exit
 * now, or null. Entries never happen here — only the way out.
 */
export function protectiveExit(mark: number, position: Position, highWater: number | null, atr: number | null, p: StopParams): string | null {
  if (position.base <= 0 || !(mark > 0)) return null;
  const floor = position.avgCost * (1 - p.maxLossPct);
  if (mark < floor) return `protective floor: mark ${mark.toFixed(2)} < ${(100 * p.maxLossPct).toFixed(0)} % under cost ${position.avgCost.toFixed(2)}`;
  if (p.atrStop != null && atr != null && highWater != null && mark < highWater - p.atrStop * atr) {
    return `intra-bar ATR trailing stop: mark ${mark.toFixed(2)} < high ${highWater.toFixed(2)} − ${p.atrStop}×ATR ${atr.toFixed(2)}`;
  }
  return null;
}

// ------------------------------------------------ the dislocation rule

/**
 * Illiquidity events, the one thing the basis measurement (reference §2c)
 * left open: Revolut X's thin book prints away from Kraken's price for a
 * minute or two and snaps back. Decided every minute from both venues'
 * quotes, long only.
 *
 * The shape is what 30 days of 1-minute data supported (reference §3.5),
 * not what sounded cheapest: after Revolut X prints ≥ k bps under the
 * reference the next 15–60 minutes are positive on average, but a RESTING
 * bid only fills when the move keeps going and loses money (adverse
 * selection). So the entry lifts the ask at once and pays the taker fee;
 * the exit rests an ask at the reference once the gap has closed, at 0 %
 * maker. Bounded by a time stop and a loss stop, both taken at the bid;
 * never a hedge on Kraken, whose fee is why a hedged arbitrage does not
 * exist here. BTC and ETH only: on SOL and XRP Revolut X's own spread
 * (41 / 72 bps) is wider than the edge.
 */
export type DislocationParams = { entryBps: number; exitBps: number; maxHoldMin: number; stopBps: number; sharpMoveBps: number; cooldownMin: number };
export const DEFAULT_DISLOCATION: DislocationParams = { entryBps: 15, exitBps: -2, maxHoldMin: 30, stopBps: 40, sharpMoveBps: 15, cooldownMin: 3 };

export type DislocationState = {
  symbol: string;
  basis: "revx_cheap" | "fair" | "revx_rich";
  basis_size: "small" | "medium" | "large";
  reference_move_5m: "flat" | "up" | "down" | "sharp_up" | "sharp_down";
  position: "flat" | "long";
  time_in_position: "none" | "minutes" | "long";
};

export type DislocationView = { state: DislocationState; basisBps: number; fair: number };

export function dislocationState(
  symbol: string, revx: { bid: number; ask: number }, reference: { bid: number; ask: number }, refMove5mBps: number | null,
  position: Position, nowMs: number, p: DislocationParams = DEFAULT_DISLOCATION,
): DislocationView {
  const fair = (reference.bid + reference.ask) / 2;
  const basisBps = ((revx.bid + revx.ask) / 2 - fair) / fair * 1e4;
  const a = Math.abs(basisBps);
  const held = position.openedAt != null ? nowMs - position.openedAt : 0;
  const m = refMove5mBps ?? 0;
  return {
    basisBps,
    fair,
    state: {
      symbol,
      basis: basisBps <= -p.entryBps ? "revx_cheap" : basisBps >= p.entryBps ? "revx_rich" : "fair",
      basis_size: a < p.entryBps ? "small" : a < 2 * p.entryBps ? "medium" : "large",
      reference_move_5m: Math.abs(m) >= p.sharpMoveBps ? (m > 0 ? "sharp_up" : "sharp_down") : m > 3 ? "up" : m < -3 ? "down" : "flat",
      position: position.base > 0 ? "long" : "flat",
      time_in_position: position.base <= 0 ? "none" : held < p.maxHoldMin * 60e3 ? "minutes" : "long",
    },
  };
}

export type DislocationDecision = { action: Action; reason: string; marketable: boolean; price: number | null };

/**
 * Long: the loss stop and the time stop sell at the bid now (`marketable`);
 * once the basis is back within `exitBps` an ask rests at the reference
 * price, or at Revolut X's own ask if that is higher. Flat: enter only when
 * Revolut X is `entryBps` under the reference, the reference is not moving
 * sharply (a stale quote, not the front of a move) and the last exit is at
 * least `cooldownMin` old — lifting the ask, since a resting bid is the
 * losing version of the trade.
 */
export function ruleDecisionDislocation(
  view: DislocationView, revx: { bid: number; ask: number }, position: Position, nowMs: number,
  p: DislocationParams = DEFAULT_DISLOCATION, lastExitMs: number | null = null,
): DislocationDecision {
  const s = view.state;
  const mid = (revx.bid + revx.ask) / 2;
  const halfSpread = mid > 0 ? (revx.ask - revx.bid) / 2 / mid : 0;
  if (position.base > 0) {
    const pnlBps = (revx.bid / position.avgCost - 1) * 1e4;
    if (pnlBps <= -p.stopBps) return { action: "exit", reason: `dislocation stop: ${pnlBps.toFixed(0)} bps under cost, sell at the bid`, marketable: true, price: revx.bid };
    if (s.time_in_position === "long") return { action: "exit", reason: `time stop after ${p.maxHoldMin} min: sell at the bid`, marketable: true, price: revx.bid };
    if (view.basisBps >= p.exitBps) {
      const price = Math.max(revx.ask, view.fair * (1 + halfSpread));
      return { action: "exit", reason: `basis closed (${view.basisBps.toFixed(1)} bps): rest an ask at the reference`, marketable: false, price };
    }
    return { action: "hold", reason: `long, basis ${view.basisBps.toFixed(1)} bps, waiting for the snap-back`, marketable: false, price: null };
  }
  if (lastExitMs != null && nowMs - lastExitMs < p.cooldownMin * 60e3) return { action: "hold", reason: `cooling down for ${p.cooldownMin} min after the last exit`, marketable: false, price: null };
  if (s.basis !== "revx_cheap") return { action: "hold", reason: `basis ${view.basisBps.toFixed(1)} bps, no dislocation`, marketable: false, price: null };
  if (s.reference_move_5m === "sharp_down" || s.reference_move_5m === "sharp_up") return { action: "hold", reason: `reference moving sharply (${s.reference_move_5m}); not a stale quote`, marketable: false, price: null };
  return { action: "enter", reason: `Revolut X ${(-view.basisBps).toFixed(1)} bps under the reference: lift the ask`, marketable: true, price: revx.ask };
}

/** What Jev is asked about a dislocation: is this a stale quote worth buying, or the front of a move? */
export function dislocationQuestions(state: DislocationState) {
  return {
    healthy_trend: {
      type: "noul" as const,
      instructions:
        "The state describes one crypto pair quoted on two venues. Revolut X is the slower, thinner venue; the reference is the deeper one. " +
        "Answer yes only if buying on Revolut X now reads as a stale quote likely to snap back to the reference: basis is revx_cheap, " +
        "basis_size is medium or large, and reference_move_5m is flat, up or down — not sharp_down or sharp_up.",
      criteria: { true: "A stale, cheap quote on the slow venue worth buying now.", false: "Not a dislocation worth buying: fair, rich, or the reference is moving sharply." },
    },
    caution: {
      type: "score" as const,
      instructions: "How much caution does this call for? calm = reference flat and basis small or medium; elevated = reference up or down or basis large; extreme = reference moving sharply.",
      criteria: ["calm", "elevated", "extreme"],
    },
    _state: { type: "choice" as const, instructions: "Which symbol does the state describe?", criteria: { [state.symbol]: null, other: "Any other symbol or none." } },
  };
}

/** One entry point for the rulebooks, keyed by the strategy row's kind. Rotation needs the cross-section (`extra.rank`). */
export function ruleFor(
  kind: StrategyKind, snap: Snapshot, position: Position, p: TrendParams = DEFAULT_TREND,
  extra: { rank?: RankView; nowMs?: number; rotation?: RotationParams } = {},
) {
  if (kind === "rotation-1d") {
    if (!extra.rank) return { action: "hold" as Action, reason: "no cross-section for the rotation rule" };
    return ruleDecisionRotation(extra.rank, position, extra.nowMs ?? Date.now(), extra.rotation ?? DEFAULT_ROTATION);
  }
  return kind === "momentum-1d" ? ruleDecisionMomentum(snap, position) : ruleDecision(snap, position, p);   // trend-4h and trend-1h share the rule
}

// ------------------------------------------------------- the model's questions

/**
 * What Jev is asked about a state. Two questions, both about the WORDS in
 * the state, never a number: whether the state reads as a healthy trend
 * worth being long, and how much caution the regime calls for. The
 * instructions spell out the boundary cases because the vendor says the
 * model answers the question written, not the one meant.
 */
export function jevQuestions(state: CategoricalState) {
  return {
    healthy_trend: {
      type: "noul" as const,
      instructions:
        "The state describes one crypto pair on 4-hour candles. Answer yes only if it reads as a healthy, established uptrend " +
        "that a trend-following rule should be long in: trend_4h is up, trend_strength is moderate or strong, breakout_4h is " +
        "above_range or inside_range (never below_range), momentum_30d is positive, and volatility is not extreme. " +
        "A flat trend, a below_range breakout, negative momentum, or extreme volatility means no.",
      criteria: {
        true: "A healthy established uptrend a trend-follower should be long in.",
        false: "Not a healthy uptrend: flat or down trend, breakdown, negative momentum, or extreme volatility.",
      },
    },
    caution: {
      type: "score" as const,
      instructions:
        "How much caution does this regime call for? Use volatility, drawdown_from_high and unrealised together: " +
        "calm = low or normal volatility and no notable drawdown; elevated = high volatility or a notable drawdown or a loss; " +
        "extreme = extreme volatility or a large drawdown.",
      criteria: ["calm", "elevated", "extreme"],
    },
    _state: {
      // Echo question: the model restates which symbol it was shown. A wrong
      // echo means the state and the answers cannot be trusted together.
      type: "choice" as const,
      instructions: "Which symbol does the state describe?",
      criteria: { [state.symbol]: null, other: "Any other symbol or none." },
    },
  };
}

export type JevView = { healthy: number | null; caution: number | null; echoOk: boolean; provider: string };

/**
 * The rulebook and the model combined. The model can VETO an entry or
 * ADVISE an exit; it can never open a position the rule would not, and
 * with no model answer (`provider: none`) the rule alone decides — for an
 * entry that means hold, since the vote required to enter is missing.
 */
export function combineDecision(
  rule: { action: Action; reason: string },
  jev: JevView,
  thresholds = { enterMin: 0.6, exitMax: 0.3, cautionExit: 1.75 },
): { action: Action; reason: string; jevSaid: string } {
  const said = jev.healthy == null ? `${jev.provider}: no answer`
    : `healthy=${jev.healthy.toFixed(2)} caution=${jev.caution?.toFixed(2) ?? "?"}${jev.echoOk ? "" : " ECHO-MISMATCH"}`;
  if (!jev.echoOk && jev.healthy != null) {
    // The model answered about something else; treat as no answer.
    jev = { ...jev, healthy: null, caution: null };
  }
  if (rule.action === "enter") {
    if (jev.healthy == null) return { action: "hold", reason: `${rule.reason}; entry needs the model's vote and it is unavailable`, jevSaid: said };
    if (jev.healthy < thresholds.enterMin) return { action: "hold", reason: `${rule.reason}; model vetoed (P(healthy)=${jev.healthy.toFixed(2)} < ${thresholds.enterMin})`, jevSaid: said };
    if ((jev.caution ?? 0) >= thresholds.cautionExit) return { action: "hold", reason: `${rule.reason}; model rates caution extreme`, jevSaid: said };
    return { action: "enter", reason: `${rule.reason}; model agrees (P=${jev.healthy.toFixed(2)})`, jevSaid: said };
  }
  if (rule.action === "hold" && jev.healthy != null && jev.healthy <= thresholds.exitMax) {
    // Only meaningful when long: the rule said hold-in-position but the
    // model reads the state as clearly unhealthy.
    return { action: "exit", reason: `model advises exit (P(healthy)=${jev.healthy.toFixed(2)} ≤ ${thresholds.exitMax})`, jevSaid: said };
  }
  return { ...rule, jevSaid: said };
}

// -------------------------------------------------------------- risk gate

export type RiskLimits = {
  maxOrderUsd: number;        // per order
  maxExposureUsd: number;     // per venue account and mode
  dailyLossLimitUsd: number;  // today's realised + change in unrealised, per venue account and mode
  maxOrdersPerDay: number;    // per venue account and mode, well under Revolut X's 1,000
  globalPause: boolean;
};

export type RiskContext = {
  exposureUsd: number;   // open notional on this venue in this mode
  ordersToday: number;
  dayPnlUsd: number;     // today's realised + change in unrealised since the day's open
  mode: "paper" | "live" | "paused";
};

/**
 * The last word. Anything but "allow" turns the action into a hold, with
 * the reason recorded. The daily loss limit and the exposure cap stop NEW
 * risk only: an exit reduces risk, and a gate that refused exits once the
 * day was already bad would lock a losing position in — the opposite of
 * what a loss limit is for. The pause switches stop everything; they are
 * explicit, and a paused book is the operator's to unwind.
 */
export function riskGate(action: Action, orderUsd: number, ctx: RiskContext, limits: RiskLimits): { allowed: boolean; reason: string } {
  if (action === "hold") return { allowed: true, reason: "hold" };
  if (ctx.mode === "paused") return { allowed: false, reason: "strategy paused" };
  if (limits.globalPause) return { allowed: false, reason: "global pause" };
  if (ctx.ordersToday >= limits.maxOrdersPerDay) return { allowed: false, reason: `orders today ${ctx.ordersToday} ≥ ${limits.maxOrdersPerDay}` };
  if (action === "enter") {
    if (ctx.dayPnlUsd <= -limits.dailyLossLimitUsd) return { allowed: false, reason: `daily loss limit hit (${ctx.dayPnlUsd.toFixed(2)} ≤ -${limits.dailyLossLimitUsd}); no new risk today` };
    if (orderUsd > limits.maxOrderUsd) return { allowed: false, reason: `order ${orderUsd.toFixed(2)} > max ${limits.maxOrderUsd}` };
    if (ctx.exposureUsd + orderUsd > limits.maxExposureUsd) return { allowed: false, reason: `exposure ${(ctx.exposureUsd + orderUsd).toFixed(2)} > max ${limits.maxExposureUsd}` };
  }
  return { allowed: true, reason: "within limits" };
}

// ------------------------------------------------------------------ sizing

export type PairConfig = { base_step: string; quote_step: string; min_order_size: string; min_order_size_quote: string };

/** Floor `x` to a multiple of `step` (both decimal strings from the venue), returned as a string with the step's precision. */
export function floorToStep(x: number, step: string): string {
  const decimals = (step.split(".")[1] ?? "").length;
  const s = Number(step);
  if (!(s > 0)) return x.toFixed(decimals);
  const units = Math.floor(x / s + 1e-9);
  return (units * s).toFixed(decimals);
}

/**
 * Base size for `usd` of notional at `price`, floored to the venue's step.
 * Returns null when it would be under the venue's minimums — a size the
 * venue rejects is not an order.
 */
export function sizeBase(usd: number, price: number, cfg: PairConfig): string | null {
  if (!(usd > 0) || !(price > 0)) return null;
  const base = floorToStep(usd / price, cfg.base_step);
  const b = Number(base);
  if (!(b >= Number(cfg.min_order_size))) return null;
  if (!(b * price >= Number(cfg.min_order_size_quote))) return null;
  return base;
}

// -------------------------------------------------------------- paper fills

export type PaperOrder = { side: "buy" | "sell"; price: number; base: number; placedAt: number };

/**
 * Would a resting limit order have filled during `candle`? A buy fills if the
 * candle traded at or below its price, a sell if at or above. Maker fee is
 * 0 % on this venue, so the paper fee is zero; the half-spread the order
 * crossed to rest at the touch is already in the price.
 */
export function paperFill(o: PaperOrder, candle: Candle): Fill | null {
  const hit = o.side === "buy" ? candle.low <= o.price : candle.high >= o.price;
  if (!hit) return null;
  return { ts: candle.start, side: o.side, base: o.base, price: o.price, feeUsd: 0 };
}
