// Pin tests for the momentum-1d rulebook and the `ruleFor` dispatch.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FLAT, ruleDecisionMomentum, ruleFor, type Position, type Snapshot } from "../_shared/agents_strategy.ts";

const snap = (over: Partial<Snapshot["state"]>): Snapshot => ({
  state: {
    symbol: "BTC/USD", trend_4h: "flat", trend_strength: "weak", breakout_4h: "inside_range", volatility: "normal",
    momentum_30d: "positive", position: "flat", unrealised: "none", time_in_position: "none", drawdown_from_high: "none",
    ...over,
  },
  numbers: { close: 100, smaFast: null, smaSlow: null, priorHigh: null, priorLow: null, atr: null, vol: null, ret30d: 0.1 },
});
const long: Position = { base: 1, avgCost: 90, realisedUsd: 0, feesUsd: 0, openedAt: 0, highWater: 100 };

Deno.test("momentum-1d — enters on positive momentum, not in extreme volatility or when unknown", () => {
  assertEquals(ruleDecisionMomentum(snap({}), FLAT).action, "enter");
  assertEquals(ruleDecisionMomentum(snap({ volatility: "extreme" }), FLAT).action, "hold");
  assertEquals(ruleDecisionMomentum(snap({ momentum_30d: "unknown" }), FLAT), { action: "hold", reason: "30-day momentum unknown" });
  assertEquals(ruleDecisionMomentum(snap({ momentum_30d: "negative" }), FLAT).action, "hold");
});

Deno.test("momentum-1d — holds a position while momentum is positive, exits when it turns", () => {
  assertEquals(ruleDecisionMomentum(snap({ position: "long" }), long).action, "hold");
  assertEquals(ruleDecisionMomentum(snap({ position: "long", momentum_30d: "negative" }), long).action, "exit");
  // Volatility is an entry filter only: it never throws a position out.
  assertEquals(ruleDecisionMomentum(snap({ position: "long", volatility: "extreme" }), long).action, "hold");
});

Deno.test("ruleFor — dispatches by strategy id; the trend rule needs a trend the momentum rule ignores", () => {
  assertEquals(ruleFor("momentum-1d", snap({}), FLAT).action, "enter");
  assertEquals(ruleFor("trend-4h", snap({}), FLAT).action, "hold");   // trend_4h is flat
});
