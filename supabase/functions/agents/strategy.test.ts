// Pin tests for the agents' strategy maths (`_shared/agents_strategy.ts`).
// This module is the ONE implementation both the live/paper loop and the
// backtester run, so the numbers pinned here are the numbers the site will
// show. Every case is closed-form: the answer is worked by hand first.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyFill, atrAt, buildSnapshot, ceilToStep, combineDecision, DEFAULT_TREND, FLAT, floorToStep, paperFill,
  positionFromFills, priorRange, realisedVol, riskGate, ruleDecision, sizeBase, sma, stepDecimals, unrealisedUsd,
  type Candle, type Position, type Snapshot,
} from "../_shared/agents_strategy.ts";

const H4 = 4 * 3600e3;
const bar = (i: number, close: number, spread = 1): Candle =>
  ({ start: i * H4, open: close, high: close + spread, low: close - spread, close, volume: 1 });

Deno.test("sma — null until n values, then the plain average", () => {
  assertEquals(sma([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assertEquals(sma([10, 10, 10], 1), [10, 10, 10]);
});

Deno.test("atrAt — true range uses the previous close", () => {
  // Bar 1: high 12, low 8, prev close 5 → TR = max(4, 7, 3) = 7. Bar 2: high 12, low 8, prev close 10 → 4.
  const c: Candle[] = [
    { start: 0, open: 5, high: 6, low: 4, close: 5, volume: 1 },
    { start: 1, open: 10, high: 12, low: 8, close: 10, volume: 1 },
    { start: 2, open: 10, high: 12, low: 8, close: 10, volume: 1 },
  ];
  assertEquals(atrAt(c, 2, 2), (7 + 4) / 2);
  assertEquals(atrAt(c, 1, 2), null);
});

Deno.test("priorRange — the window BEFORE i, never including bar i", () => {
  const c = [bar(0, 10), bar(1, 20), bar(2, 30), bar(3, 5)];
  // Prior 2 bars to index 3 are bars 1 and 2: high 31, low 19.
  assertEquals(priorRange(c, 3, 2), { high: 31, low: 19 });
  assertEquals(priorRange(c, 1, 2), null);
});

Deno.test("realisedVol — zero for a flat series, positive for a moving one", () => {
  assertEquals(realisedVol([1, 1, 1, 1, 1], 4, 4, 100), 0);
  const v = realisedVol([1, 1.1, 1, 1.1, 1], 4, 4, 100);
  assert(v != null && v > 0);
});

Deno.test("applyFill — buys average in, sells realise against the average", () => {
  let p: Position = FLAT;
  p = applyFill(p, { ts: 1, side: "buy", base: 1, price: 100, feeUsd: 0 });
  p = applyFill(p, { ts: 2, side: "buy", base: 1, price: 120, feeUsd: 0.1 });
  assertEquals(p.base, 2);
  assertEquals(p.avgCost, 110);
  assertEquals(p.feesUsd, 0.1);
  assertEquals(p.openedAt, 1);
  // Sell one at 130: realised = 1 × (130 − 110) − fee 0.05 = 19.95, on top of the −0.1 buy fee.
  p = applyFill(p, { ts: 3, side: "sell", base: 1, price: 130, feeUsd: 0.05 });
  assertEquals(p.base, 1);
  assertEquals(Math.round(p.realisedUsd * 100) / 100, 19.85);
  assertEquals(p.avgCost, 110);
  // Selling the rest closes: flat, cost cleared, openedAt cleared.
  p = applyFill(p, { ts: 4, side: "sell", base: 1, price: 100, feeUsd: 0 });
  assertEquals(p.base, 0);
  assertEquals(p.avgCost, 0);
  assertEquals(p.openedAt, null);
  assertEquals(Math.round(p.realisedUsd * 100) / 100, 9.85); // + (100 − 110)
});

Deno.test("positionFromFills — order-independent, and unrealised marks against avgCost", () => {
  const p = positionFromFills([
    { ts: 2, side: "buy", base: 1, price: 120, feeUsd: 0 },
    { ts: 1, side: "buy", base: 1, price: 100, feeUsd: 0 },
  ]);
  assertEquals(p.avgCost, 110);
  assertEquals(unrealisedUsd(p, 115), 10);
  assertEquals(unrealisedUsd(FLAT, 115), 0);
});

/** 130 bars: 100 flat at 100, then a steady climb — enough history for SMA 100 and the 55-bar range. */
function uptrend(): Candle[] {
  const c: Candle[] = [];
  for (let i = 0; i < 100; i++) c.push(bar(i, 100, 0.5));
  for (let i = 100; i < 130; i++) c.push(bar(i, 100 + (i - 99) * 1.5, 0.5));
  return c;
}
// 40 daily closes: the first TEN at 100, the rest at 100 × (1 + ret30), so the
// close 30 days before the last (index 9) is still 100 and the 30-day return
// is exactly `ret30`. (The first draft flipped index 9 too and measured 0.)
const daily = (ret30: number): Candle[] => Array.from({ length: 40 }, (_, i) => bar(i, i < 10 ? 100 : 100 * (1 + ret30)));

Deno.test("buildSnapshot — a fresh breakout in a rising market reads up / above_range / positive", () => {
  const c = uptrend();
  const snap = buildSnapshot("BTC/USD", c, c.length - 1, daily(0.1), FLAT, c[c.length - 1].start);
  assertEquals(snap.state.trend_4h, "up");
  assertEquals(snap.state.breakout_4h, "above_range");
  assertEquals(snap.state.momentum_30d, "positive");
  assertEquals(snap.state.position, "flat");
  assertEquals(snap.state.unrealised, "none");
  assert(snap.numbers.smaFast != null && snap.numbers.smaSlow != null && snap.numbers.smaFast > snap.numbers.smaSlow);
  // The model never sees a number: every state value is a word.
  for (const v of Object.values(snap.state)) assertEquals(typeof v, "string");
});

Deno.test("ruleDecision — enter on the breakout, hold without momentum, exit on the trailing stop", () => {
  const c = uptrend();
  const i = c.length - 1;
  const enter = ruleDecision(buildSnapshot("BTC/USD", c, i, daily(0.1), FLAT, c[i].start), FLAT);
  assertEquals(enter.action, "enter");
  const noMo = ruleDecision(buildSnapshot("BTC/USD", c, i, daily(-0.1), FLAT, c[i].start), FLAT);
  assertEquals(noMo.action, "hold");
  assertEquals(noMo.reason, "30-day momentum negative");
  // In the climb every bar's true range is 2 (high − previous close: 145.5 − 143.5),
  // so ATR(14) = 2 and the 3×ATR stop sits 6 under the high-water mark. Long from
  // 120 with a high-water of 152: the stop is at 146 and the close is 145 → out.
  const long: Position = { base: 0.1, avgCost: 120, realisedUsd: 0, feesUsd: 0, openedAt: 0, highWater: 152 };
  const snap = buildSnapshot("BTC/USD", c, i, daily(0.1), long, c[i].start);
  const exit = ruleDecision(snap, long);
  assertEquals(exit.action, "exit");
  assert(exit.reason.startsWith("ATR trailing stop"));
  // Same position, high-water at the close: no stop, no breakdown → hold.
  const calm: Position = { ...long, highWater: snap.numbers.close };
  assertEquals(ruleDecision(snap, calm).action, "hold");
});

Deno.test("combineDecision — the model can veto an entry and nothing else: a hold passes through whatever it thinks, and it never opens one alone", () => {
  const enter = { action: "enter" as const, reason: "breakout" };
  const hold = { action: "hold" as const, reason: "in position" };
  const yes = { healthy: 0.9, caution: 0.2, echoOk: true, provider: "openrouter" };
  const no = { healthy: 0.2, caution: 0.2, echoOk: true, provider: "openrouter" };
  const none = { healthy: null, caution: null, echoOk: true, provider: "none" };
  assertEquals(combineDecision(enter, yes).action, "enter");
  assertEquals(combineDecision(enter, no).action, "hold");
  assertEquals(combineDecision(enter, none).action, "hold");        // no vote, no entry
  assertEquals(combineDecision(hold, no).action, "hold");           // exits are the rule's and the stops' alone (reference §4.13) — the model is never asked on a hold, and could not move one if it were
  assertEquals(combineDecision(hold, yes).action, "hold");
  assertEquals(combineDecision(hold, none).action, "hold");
  // Caution "extreme" (score ≥ 1.75) blocks an entry the rule and P(healthy) both like.
  assertEquals(combineDecision(enter, { ...yes, caution: 1.9 }).action, "hold");
  // A wrong echo means the answers are about something else: treated as no answer.
  assertEquals(combineDecision(enter, { ...yes, echoOk: false }).action, "hold");
  assertEquals(combineDecision(hold, { ...no, echoOk: false }).action, "hold");
});

Deno.test("riskGate — every limit blocks, holds always pass, exits ignore the size caps", () => {
  const limits = { maxOrderUsd: 20, maxExposureUsd: 100, dailyLossLimitUsd: 5, maxOrdersPerDay: 40, globalPause: false };
  const ctx = { exposureUsd: 0, ordersToday: 0, dayPnlUsd: 0, mode: "paper" as const };
  assertEquals(riskGate("enter", 20, ctx, limits).allowed, true);
  assertEquals(riskGate("enter", 20.01, ctx, limits).allowed, false);
  assertEquals(riskGate("enter", 20, { ...ctx, exposureUsd: 85 }, limits).allowed, false);
  assertEquals(riskGate("enter", 20, { ...ctx, ordersToday: 40 }, limits).allowed, false);
  assertEquals(riskGate("enter", 20, { ...ctx, dayPnlUsd: -5 }, limits).allowed, false);
  assertEquals(riskGate("enter", 20, { ...ctx, mode: "paused" }, limits).allowed, false);
  assertEquals(riskGate("enter", 20, ctx, { ...limits, globalPause: true }).allowed, false);
  assertEquals(riskGate("hold", 999, { ...ctx, mode: "paused" }, { ...limits, globalPause: true }).allowed, true);
  // An exit never adds exposure, so neither the size caps nor the daily loss limit apply — and since
  // 2026-09-22 nor does a PAUSED strategy: `0043` retired three rows that were still long, and under the
  // old order of these tests their positions had no way out at all. Only the global pause, which is a
  // person's emergency switch, still outranks an exit.
  assertEquals(riskGate("exit", 999, { ...ctx, exposureUsd: 100 }, limits).allowed, true);
  assertEquals(riskGate("exit", 1, { ...ctx, dayPnlUsd: -6 }, limits).allowed, true);
  assertEquals(riskGate("exit", 1, { ...ctx, mode: "paused" }, limits).allowed, true);
  assertEquals(riskGate("enter", 1, { ...ctx, mode: "paused" }, limits).allowed, false);
  assertEquals(riskGate("exit", 1, { ...ctx, mode: "paused" }, { ...limits, globalPause: true }).allowed, false);
});

Deno.test("floorToStep / sizeBase — floors to the venue step and refuses sub-minimum orders", () => {
  assertEquals(floorToStep(0.123456789, "0.00000001"), "0.12345678");
  assertEquals(floorToStep(1.23456, "0.001"), "1.234");
  assertEquals(floorToStep(5, "1"), "5");
  const btc = { base_step: "0.00000001", quote_step: "0.01", min_order_size: "0.00000001", min_order_size_quote: "0.1" };
  // $20 at 80,000 → 0.00025 BTC exactly.
  assertEquals(sizeBase(20, 80_000, btc), "0.00025000");
  // $0.05 is under the $0.10 minimum notional → no order.
  assertEquals(sizeBase(0.05, 80_000, btc), null);
  assertEquals(sizeBase(20, 0, btc), null);
});

Deno.test("paperFill — a resting buy fills only when the candle trades through its price", () => {
  const buy = { side: "buy" as const, price: 100, base: 1, placedAt: 0 };
  assertEquals(paperFill(buy, { start: 5, open: 102, high: 103, low: 101, close: 102, volume: 1 }), null);
  const f = paperFill(buy, { start: 5, open: 102, high: 103, low: 99.5, close: 102, volume: 1 });
  assertEquals(f, { ts: 5, side: "buy", base: 1, price: 100, feeUsd: 0 });
  const sell = { side: "sell" as const, price: 110, base: 1, placedAt: 0 };
  assertEquals(paperFill(sell, { start: 6, open: 105, high: 109, low: 104, close: 105, volume: 1 }), null);
  assert(paperFill(sell, { start: 6, open: 105, high: 111, low: 104, close: 105, volume: 1 }) != null);
});

Deno.test("DEFAULT_TREND is the backtested shape: 20/100 on 4h, 55/20 breakout, 3×ATR(14) stop", () => {
  assertEquals(DEFAULT_TREND, { fast: 20, slow: 100, breakoutUp: 55, breakoutDown: 20, atrN: 14, atrStop: 3, volN: 42 });
  const _typeCheck: Snapshot | null = null;
  assertEquals(_typeCheck, null);
});

// ── rotation and the gate's exit rule ──────────────────────────────────

import { riskGate as gate, rotationTargets, ruleDecisionRotation, DEFAULT_ROTATION, FLAT as FLAT_POS, type Candle as C } from "../_shared/agents_strategy.ts";

function dailyRun(rate: number, n = 130, start = 0): C[] {
  const out: C[] = [];
  for (let i = 0; i < n; i++) { const close = 100 * Math.pow(rate, i); out.push({ start: start + i * 86400e3, open: close / rate, high: close * 1.001, low: close / rate * 0.999, close, volume: 1 }); }
  return out;
}

Deno.test("rotationTargets ranks by lookback return and drops what sits below its slow average", () => {
  const up = dailyRun(1.01), flat = dailyRun(1.0005), down = dailyRun(0.995);
  const t = rotationTargets({ "BTC/USD": up, "ETH/USD": flat, "SOL/USD": down }, DEFAULT_ROTATION);
  assertEquals([t["BTC/USD"].rank, t["ETH/USD"].rank, t["SOL/USD"].rank], [0, 1, 2]);
  assertEquals([t["BTC/USD"].inTop, t["ETH/USD"].inTop, t["SOL/USD"].inTop], [true, true, false]);
  assertEquals(t["SOL/USD"].aboveSlow, false);
  // Without the filter the top two are the top two, whatever the average says.
  const nf = rotationTargets({ "BTC/USD": down, "ETH/USD": dailyRun(0.99) }, { ...DEFAULT_ROTATION, bearFilter: false });
  assertEquals([nf["BTC/USD"].inTop, nf["ETH/USD"].inTop], [true, true]);
  // A symbol below its average is skipped and the slot goes to the next one.
  const skip = rotationTargets({ "BTC/USD": down, "ETH/USD": flat, "SOL/USD": dailyRun(1.002) }, { ...DEFAULT_ROTATION, topN: 1 });
  assertEquals([skip["BTC/USD"].inTop, skip["ETH/USD"].inTop, skip["SOL/USD"].inTop], [false, false, true]);
  // Too little history: no return, nothing held.
  const short = rotationTargets({ "BTC/USD": dailyRun(1.01, 20) }, DEFAULT_ROTATION);
  assertEquals([short["BTC/USD"].ret, short["BTC/USD"].inTop], [null, false]);
});

Deno.test("ruleDecisionRotation: enter the top, exit what drops out, hold inside the minimum hold", () => {
  const inTop = { symbol: "BTC/USD", ret: 0.3, aboveSlow: true, rank: 0, inTop: true };
  const out = { ...inTop, rank: 2, inTop: false };
  const below = { ...out, aboveSlow: false };
  const long = { ...FLAT_POS, base: 1, avgCost: 100, openedAt: Date.parse("2026-09-15T00:00:00Z") };
  const now = Date.parse("2026-09-20T00:00:00Z");
  assertEquals(ruleDecisionRotation(inTop, FLAT_POS, now).action, "enter");
  assertEquals(ruleDecisionRotation(out, FLAT_POS, now).action, "hold");
  assertEquals(ruleDecisionRotation(inTop, long, now).action, "hold");
  assertEquals(ruleDecisionRotation(out, long, now), { action: "exit", reason: "dropped out of the top 2" });
  assertEquals(ruleDecisionRotation(below, long, now).reason, "below the 100-day average");
  assertEquals(ruleDecisionRotation(out, long, now, { ...DEFAULT_ROTATION, minHoldDays: 7 }).action, "hold");
  assertEquals(ruleDecisionRotation(out, long, now + 3 * 86400e3, { ...DEFAULT_ROTATION, minHoldDays: 7 }).action, "exit");
});

Deno.test("the exposure cap is marked to market, so it tightens on a winning book: the last slot fits at exactly the cap and not a cent past it", () => {
  const limits = { maxOrderUsd: 20, maxExposureUsd: 100, dailyLossLimitUsd: 5, maxOrdersPerDay: 40, globalPause: false };
  const ctx = { exposureUsd: 0, ordersToday: 0, dayPnlUsd: 0, mode: "live" as const };
  // Five $20 slots against a $100 cap: four at cost leave room for the fifth, exactly, because the test is `>`.
  assertEquals(riskGate("enter", 20, { ...ctx, exposureUsd: 80 }, limits).allowed, true);
  assertEquals(riskGate("enter", 20, { ...ctx, exposureUsd: 80.01 }, limits).allowed, false);
  // But `exposureUsd` is the book's MARK, not what was paid for it (tick.ts derives it as base × mark), so
  // four slots up 6 % shut the fifth out — the cap tightens exactly when the rulebook is working and loosens
  // after a drawdown. It can never let more than five × $20 of CAPITAL in: the rulebook does not pyramid.
  assertEquals(riskGate("enter", 20, { ...ctx, exposureUsd: 84.8 }, limits).allowed, false);
  assertEquals(riskGate("enter", 20, { ...ctx, exposureUsd: 84.8 }, { ...limits, maxExposureUsd: 150 }).allowed, true);
});

Deno.test("riskGate: the daily loss limit blocks new risk, never an exit; the pauses block everything", () => {
  const limits = { maxOrderUsd: 20, maxExposureUsd: 100, dailyLossLimitUsd: 5, maxOrdersPerDay: 40, globalPause: false };
  const bad = { exposureUsd: 40, ordersToday: 3, dayPnlUsd: -6, mode: "live" as const };
  assertEquals(gate("enter", 20, bad, limits).allowed, false);
  assertEquals(gate("exit", 20, bad, limits).allowed, true);
  assertEquals(gate("exit", 20, bad, { ...limits, globalPause: true }).allowed, false);
  assertEquals(gate("exit", 20, { ...bad, mode: "paused" }, limits).allowed, true);      // a paused row can still get OUT (2026-09-22)
  assertEquals(gate("enter", 20, { ...bad, mode: "paused" }, limits).allowed, false);
});

// ---- protective stops and the dislocation rule (the one-minute loop) -----
import {
  DEFAULT_DISLOCATION, dislocationState, highWaterSince, protectiveExit, ruleDecisionDislocation, type Position as P,
} from "../_shared/agents_strategy.ts";

const longPos = (avgCost: number, openedAt: number, highWater: number | null = null): P => ({ base: 0.1, avgCost, realisedUsd: 0, feesUsd: 0, openedAt, highWater });

Deno.test("highWaterSince trails the closed bars' highs from the entry on; flat means null", () => {
  const bars: C[] = [bar(0, 100), bar(1, 105), bar(2, 110), bar(3, 120), bar(4, 90)];
  assertEquals(highWaterSince(FLAT_POS, bars, 4), null);
  const pos = longPos(100, bars[1].start, 101);
  assertEquals(highWaterSince(pos, bars, 3), bars[3].high);               // bar 0 is before the entry and does not count
  assertEquals(highWaterSince(pos, bars, 2), bars[2].high);               // only CLOSED bars: index 3 is still forming here
  assertEquals(highWaterSince(longPos(100, bars[4].start + 1, 130), bars, 4), 130);   // nothing closed since entry: the fills' own high
});

Deno.test("protectiveExit: the floor under cost for every rule, the ATR trail from the high for the trend rules", () => {
  const pos = longPos(100, 0, 100);
  assertEquals(protectiveExit(93, pos, 98, 2, { atrStop: 3, maxLossPct: 0.08 }), null);             // −7 %: above the floor, inside 3×ATR of the high
  assert(protectiveExit(91.9, pos, 98, 2, { atrStop: 3, maxLossPct: 0.08 })?.startsWith("protective floor"));
  assert(protectiveExit(105, pos, 112, 2, { atrStop: 3, maxLossPct: 0.08 })?.includes("ATR trailing stop"));   // 112 − 6 = 106 > 105
  assertEquals(protectiveExit(105, pos, 112, 2, { atrStop: null, maxLossPct: 0.08 }), null);        // the daily rules have no ATR trail
  assertEquals(protectiveExit(105, FLAT_POS, 112, 2, { atrStop: 3, maxLossPct: 0.08 }), null);      // flat: nothing to protect
  assertEquals(protectiveExit(0, pos, 112, 2, { atrStop: 3, maxLossPct: 0.08 }), null);             // no mark, no verdict
});

Deno.test("dislocationState reads the basis against the reference mid and classifies the reference's own move", () => {
  const ref = { bid: 100, ask: 100.1 };                                     // mid 100.05
  const cheap = dislocationState("BTC/USD", { bid: 99.8, ask: 99.9 }, ref, 0, FLAT_POS, 0);
  assert(Math.abs(cheap.basisBps - (99.85 / 100.05 - 1) * 1e4) < 1e-9);
  assertEquals(cheap.fair, 100.05);
  assertEquals([cheap.state.basis, cheap.state.basis_size, cheap.state.reference_move_5m, cheap.state.position, cheap.state.time_in_position], ["revx_cheap", "medium", "flat", "flat", "none"]);
  assertEquals(dislocationState("BTC/USD", { bid: 99.5, ask: 99.6 }, ref, -20, FLAT_POS, 0).state.basis_size, "large");
  assertEquals(dislocationState("BTC/USD", { bid: 99.5, ask: 99.6 }, ref, -20, FLAT_POS, 0).state.reference_move_5m, "sharp_down");
  assertEquals(dislocationState("BTC/USD", { bid: 100.3, ask: 100.4 }, ref, 5, FLAT_POS, 0).state.basis, "revx_rich");
  assertEquals(dislocationState("BTC/USD", { bid: 100.3, ask: 100.4 }, ref, 5, FLAT_POS, 0).state.reference_move_5m, "up");
  assertEquals(dislocationState("BTC/USD", ref, ref, null, FLAT_POS, 0).state.basis, "fair");
  const held = dislocationState("BTC/USD", ref, ref, 0, longPos(100, 0), 31 * 60e3);
  assertEquals([held.state.position, held.state.time_in_position], ["long", "long"]);
  assertEquals(dislocationState("BTC/USD", ref, ref, 0, longPos(100, 0), 5 * 60e3).state.time_in_position, "minutes");
});

Deno.test("ruleDecisionDislocation: lift the ask on a cheap print, rest the exit at the reference, stops sell at the bid, cooldown holds", () => {
  const ref = { bid: 100, ask: 100.1 };
  const p = DEFAULT_DISLOCATION;
  const cheapQ = { bid: 99.8, ask: 99.9 };
  const enter = ruleDecisionDislocation(dislocationState("BTC/USD", cheapQ, ref, 0, FLAT_POS, 0), cheapQ, FLAT_POS, 0, p);
  assertEquals([enter.action, enter.marketable, enter.price], ["enter", true, 99.9]);
  // The same print while the reference is moving sharply, or within the cooldown: hold.
  assertEquals(ruleDecisionDislocation(dislocationState("BTC/USD", cheapQ, ref, 20, FLAT_POS, 0), cheapQ, FLAT_POS, 0, p).action, "hold");
  assertEquals(ruleDecisionDislocation(dislocationState("BTC/USD", cheapQ, ref, 0, FLAT_POS, 0), cheapQ, FLAT_POS, 120e3, p, 0).action, "hold");
  assertEquals(ruleDecisionDislocation(dislocationState("BTC/USD", cheapQ, ref, 0, FLAT_POS, 0), cheapQ, FLAT_POS, 181e3, p, 0).action, "enter");
  // A fair print: nothing to do.
  assertEquals(ruleDecisionDislocation(dislocationState("BTC/USD", ref, ref, 0, FLAT_POS, 0), ref, FLAT_POS, 0, p).action, "hold");
  // Long from 99.9, the basis back to fair: rest an ask at max(own ask, fair + half spread) — a maker order.
  const pos = longPos(99.9, 0);
  const back = { bid: 100.02, ask: 100.12 };
  const exit = ruleDecisionDislocation(dislocationState("BTC/USD", back, ref, 0, pos, 5 * 60e3), back, pos, 5 * 60e3, p);
  const hs = (back.ask - back.bid) / 2 / ((back.ask + back.bid) / 2);
  assertEquals([exit.action, exit.marketable], ["exit", false]);
  assertEquals(exit.price, Math.max(back.ask, 100.05 * (1 + hs)));
  // Still cheap and young: wait.
  assertEquals(ruleDecisionDislocation(dislocationState("BTC/USD", cheapQ, ref, 0, pos, 5 * 60e3), cheapQ, pos, 5 * 60e3, p).action, "hold");
  // 40 bps under cost: sell at the bid now.
  const down = { bid: 99.49, ask: 99.59 };
  const stop = ruleDecisionDislocation(dislocationState("BTC/USD", down, ref, 0, pos, 5 * 60e3), down, pos, 5 * 60e3, p);
  assertEquals([stop.action, stop.marketable, stop.price], ["exit", true, 99.49]);
  assert(stop.reason.includes("dislocation stop"));
  // Past the time stop, still cheap: sell at the bid now.
  const timed = ruleDecisionDislocation(dislocationState("BTC/USD", cheapQ, ref, 0, pos, 31 * 60e3), cheapQ, pos, 31 * 60e3, p);
  assertEquals([timed.action, timed.marketable, timed.price], ["exit", true, 99.8]);
  assert(timed.reason.includes("time stop"));
});

Deno.test("DEFAULT_DISLOCATION is the shape the 1-minute data supported: 15 bps in, back within 2, 30 minutes, 40 bps stop", () => {
  assertEquals(DEFAULT_DISLOCATION, { entryBps: 15, exitBps: -2, maxHoldMin: 30, stopBps: 40, sharpMoveBps: 15, cooldownMin: 3 });
});

Deno.test("stepDecimals reads an exponential step: a venue that writes 1e-8 must not round half a coin up to one", () => {
  assertEquals(stepDecimals("0.001"), 3);
  assertEquals(stepDecimals("0.00000001"), 8);
  assertEquals(stepDecimals("1e-8"), 8);
  assertEquals(stepDecimals("1E-2"), 2);
  assertEquals(stepDecimals("1"), 0);
  // The failure it prevents: `split(".")` finds no fraction in "1e-8", so the old code did toFixed(0).
  assertEquals(floorToStep(0.5, "1e-8"), "0.50000000");
  assertEquals(ceilToStep(0.5, "1e-2"), "0.50");
  // Both venues send decimal strings today, so this is a guard rather than a fix to live behaviour.
  assertEquals(floorToStep(0.5, "0.00000001"), "0.50000000");
});

Deno.test("positionFromFills is a TOTAL order: two fills stamped the same instant apply buy-first, so a tie cannot destroy a position", () => {
  const f = (ts: number, side: "buy" | "sell", base: number, price: number) => ({ ts, side, base, price, feeUsd: 0 });
  const buy = f(1000, "buy", 1, 100), sell = f(1000, "sell", 1, 110);
  // Same timestamp, opposite input order — one implementation, one answer.
  assertEquals(positionFromFills([buy, sell]), positionFromFills([sell, buy]));
  assertEquals(positionFromFills([sell, buy]).realisedUsd, 10);
  assertEquals(positionFromFills([sell, buy]).base, 0);
});
