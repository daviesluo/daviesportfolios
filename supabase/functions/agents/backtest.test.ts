// Pin tests for the backtester's rotation loop. The trend loop (`run`) has
// been pinned indirectly since 2026-09-20 by the reference's tables, which
// it reproduces to the digit; `runRotation` had no test at all, and the
// pre-live review found it ran neither the floor stop nor the cooldown the
// live rotation rows run (docs/agents/reviews/, S2). These fix both halves
// of that: with `stops: null` it is the bare rank rule it always was, and
// with the shipped stops it sells at the floor and waits before re-entering.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { COSTS, runRotation, SHIPPED_STOPS, stopsForKind } from "./backtest.ts";
import { DEFAULT_ROTATION, DEFAULT_TREND, type Candle } from "../_shared/agents_strategy.ts";

const DAY = 86400e3;
const FREE = { venue: "test", makerBps: 0, takerBps: 0, fillFee: "maker" as const, halfSpread: { "A/USD": 0, "B/USD": 0 } };

/** A daily series from closes; each day opens at the previous close and its low is `lowFrac` of the open. */
function seriesOf(closes: number[], lowFrac = 1): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return { start: i * DAY, open, high: Math.max(open, close), low: Math.min(open, close) * lowFrac, close, volume: 1 };
  });
}

Deno.test("the rotation stops are the loop's: a slot through its 8 % floor is sold, and not re-entered for two days", () => {
  // A: 200 days climbing (so it ranks first and sits above its 100-day average), then one day whose LOW is 15 % under the
  // entry — through the floor — and a close that recovers, so the rank rule itself never says exit. B never qualifies.
  const closes = Array.from({ length: 260 }, (_, i) => 100 * Math.pow(1.01, i));
  const a = seriesOf(closes);
  a[240] = { ...a[240], low: a[240].open * 0.8 };                       // the day that takes out the floor
  const b = seriesOf(Array.from({ length: 260 }, () => 50));            // flat: below its own average, never ranked in
  const p = { ...DEFAULT_ROTATION, topN: 1 };
  const bare = runRotation({ "A/USD": a, "B/USD": b }, 0, 260, p, FREE);
  const stopped = runRotation({ "A/USD": a, "B/USD": b }, 0, 260, p, FREE, SHIPPED_STOPS);
  assertEquals(bare.stopsHit ?? 0, 0);                                   // the rank rule alone never leaves a rising leader
  assertEquals(stopped.stopsHit, 1);
  assert(stopped.trades > bare.trades, `${stopped.trades} vs ${bare.trades}`);   // the stop and the re-entry after it
  // Selling a leader into a dip and buying it back two days higher costs return, which is the finding §3.4 reports.
  assert(stopped.ret < bare.ret, `${stopped.ret} vs ${bare.ret}`);
});

Deno.test("with no stops the rotation loop is the bare rank rule it has always been: same trades, same return", () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 * (1 + 0.4 * Math.sin(i / 17)));
  const basket = { "A/USD": seriesOf(closes), "B/USD": seriesOf(closes.map((c, i) => c * (1 + 0.1 * Math.cos(i / 9)))) };
  const a = runRotation(basket, 0, 300, DEFAULT_ROTATION, FREE);
  const b = runRotation(basket, 0, 300, DEFAULT_ROTATION, FREE, null);
  assertEquals([a.trades, a.stopsHit ?? 0], [b.trades, 0]);
  assertAlmostEquals(a.ret, b.ret, 1e-12);
});

Deno.test("the rotation rows get the floor and the cooldown but no ATR trail — the trail belongs to the trend rules", () => {
  assertEquals(stopsForKind("rotation-1d", DEFAULT_TREND), { ...SHIPPED_STOPS, atrStop: null });
  assertEquals(stopsForKind("momentum-1d", DEFAULT_TREND).atrStop, null);
  assertEquals(stopsForKind("trend-4h", DEFAULT_TREND).atrStop, DEFAULT_TREND.atrStop);
  assertEquals([SHIPPED_STOPS.maxLossPct, SHIPPED_STOPS.reentryBars], [0.08, 2]);
});

Deno.test("each venue's fills are its own: the same basket costs more on Kraken's 40 bps than on Revolut X's touch", () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 * (1 + 0.3 * Math.sin(i / 13)));
  const basket = { "BTC/USD": seriesOf(closes), "ETH/USD": seriesOf(closes.map((c, i) => c * (1 + 0.15 * Math.cos(i / 7)))) };
  const revx = runRotation(basket, 0, 300, DEFAULT_ROTATION, COSTS.revx, SHIPPED_STOPS);
  const kraken = runRotation(basket, 0, 300, DEFAULT_ROTATION, COSTS.kraken, SHIPPED_STOPS);
  assertEquals(revx.trades, kraken.trades);
  assert(kraken.ret < revx.ret, `kraken ${kraken.ret} revx ${revx.ret}`);
});
