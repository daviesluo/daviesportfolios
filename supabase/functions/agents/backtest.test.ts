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
  // A climbs gently (so it ranks first and sits above its 100-day average), then one day whose LOW is far under the
  // entry — through the floor — and a close that recovers, so the rank rule itself never says exit. B never qualifies.
  //
  // The series used to compound at 1 % a day, which made the entry cost a fraction of the late price and put the 8 %
  // floor ~75 % below the market: the exit this test asserted was actually the ATR TRAIL, from `SHIPPED_STOPS` when it
  // still carried one. The test named the floor and measured the trail — which is the same confusion §3.13 found in the
  // loop itself. A gentle ramp keeps the floor within reach of the market, so the floor is what fires.
  const closes = Array.from({ length: 260 }, (_, i) => 100 * (1 + 0.001 * i));
  const a = seriesOf(closes);
  a[240] = { ...a[240], low: 95 };                                      // under any entry cost on this ramp × 0.92
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

Deno.test("no rulebook gets an intra-bar ATR trail: the floor and the cooldown are the whole protective layer", () => {
  // Until 2026-09-21 the trend rules carried `atrStop: p.atrStop` here, which duplicated the trail
  // `ruleDecision` already applies to the close, from the same anchor with the same multiplier — and
  // the intra-bar copy pre-empted it on all but one protective exit per window (reference §3.13).
  for (const kind of ["trend-4h", "trend-1h", "momentum-1d", "rotation-1d"] as const) {
    assertEquals(stopsForKind(kind, DEFAULT_TREND).atrStop, null, kind);
  }
  assertEquals(stopsForKind("rotation-1d", DEFAULT_TREND), { ...SHIPPED_STOPS, atrStop: null });
  assertEquals([SHIPPED_STOPS.maxLossPct, SHIPPED_STOPS.atrStop, SHIPPED_STOPS.reentryBars], [0.08, null, 2]);
  // The rulebook's own trail is untouched: it is DEFAULT_TREND's, read on the close, not on the wick.
  assertEquals(DEFAULT_TREND.atrStop, 3);
});

Deno.test("each venue's fills are its own: the same basket costs more on Kraken's 40 bps than on Revolut X's touch", () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 * (1 + 0.3 * Math.sin(i / 13)));
  const basket = { "BTC/USD": seriesOf(closes), "ETH/USD": seriesOf(closes.map((c, i) => c * (1 + 0.15 * Math.cos(i / 7)))) };
  const revx = runRotation(basket, 0, 300, DEFAULT_ROTATION, COSTS.revx, SHIPPED_STOPS);
  const kraken = runRotation(basket, 0, 300, DEFAULT_ROTATION, COSTS.kraken, SHIPPED_STOPS);
  assertEquals(revx.trades, kraken.trades);
  assert(kraken.ret < revx.ret, `kraken ${kraken.ret} revx ${revx.ret}`);
});
