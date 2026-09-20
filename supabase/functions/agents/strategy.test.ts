// Pin tests for the agents' strategy maths (`_shared/agents_strategy.ts`).
// This module is the ONE implementation both the live/paper loop and the
// backtester run, so the numbers pinned here are the numbers the site will
// show. Every case is closed-form: the answer is worked by hand first.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyFill, atrAt, buildSnapshot, combineDecision, DEFAULT_TREND, FLAT, floorToStep, paperFill,
  positionFromFills, priorRange, realisedVol, riskGate, ruleDecision, sizeBase, sma, unrealisedUsd,
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

Deno.test("combineDecision — the model can veto an entry and advise an exit, never open one alone", () => {
  const enter = { action: "enter" as const, reason: "breakout" };
  const hold = { action: "hold" as const, reason: "in position" };
  const yes = { healthy: 0.9, caution: 0.2, echoOk: true, provider: "openrouter" };
  const no = { healthy: 0.2, caution: 0.2, echoOk: true, provider: "openrouter" };
  const none = { healthy: null, caution: null, echoOk: true, provider: "none" };
  assertEquals(combineDecision(enter, yes).action, "enter");
  assertEquals(combineDecision(enter, no).action, "hold");
  assertEquals(combineDecision(enter, none).action, "hold");        // no vote, no entry
  assertEquals(combineDecision(hold, no).action, "exit");           // advises out
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
  // An exit never adds exposure, so the size caps do not apply — but the pause and loss limit still do.
  assertEquals(riskGate("exit", 999, { ...ctx, exposureUsd: 100 }, limits).allowed, true);
  assertEquals(riskGate("exit", 1, { ...ctx, dayPnlUsd: -6 }, limits).allowed, false);
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
