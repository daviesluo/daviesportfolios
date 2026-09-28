// JEV-DRIFT's bands (jev_bands.ts) against the answer files they copy, and the check itself.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import answersV2 from "../../../docs/agents/backtests/jev_answers_v2.json" with { type: "json" };
import answersV2Other from "../../../docs/agents/backtests/jev_answers_v2_other.json" with { type: "json" };
import { JEV_BANDS, JEV_DRIFT_MARGIN, jevBandCheck, jevBandKey, type JevBandKind } from "./jev_bands.ts";

type Measured = Record<string, string | number[] | boolean | number> & { healthy: number[] };

Deno.test("the bands are exactly the measured replies' lowest and highest, state for state, for all three rules", () => {
  const files: Record<JevBandKind, Measured[]> = {
    "trend-4h": answersV2.states as unknown as Measured[],
    "trend-1h": answersV2Other["trend-1h"] as unknown as Measured[],
    "momentum-1d": answersV2Other["momentum-1d"] as unknown as Measured[],
  };
  for (const kind of Object.keys(files) as JevBandKind[]) {
    const rebuilt = Object.fromEntries(files[kind].map((s) => [jevBandKey(kind, s), [Math.min(...s.healthy), Math.max(...s.healthy)]]));
    assertEquals(Object.keys(rebuilt).length, files[kind].length, `${kind}: one band per measured state`);
    assertEquals(Object.fromEntries(Object.entries(JEV_BANDS[kind]).map(([k, v]) => [k, [...v]])), rebuilt, kind);
  }
  assertEquals([90, 54, 189], (["trend-4h", "trend-1h", "momentum-1d"] as JevBandKind[]).map((k) => Object.keys(JEV_BANDS[k]).length));
});

Deno.test("jevBandCheck: inside the band widened by the margin is quiet, outside or unmeasured is a flag, other rules are not checked", () => {
  const st = { symbol: "SOL/USD", trend_strength: "strong", volatility: "high", momentum_30d: "positive" };
  const [lo, hi] = JEV_BANDS["trend-4h"]["SOL/USD|strong|high|positive"];
  assertEquals([lo, hi], [0.58, 0.61]);                                           // the live row's SOL entry of 2026-09-25 answered 0.58
  const at = (p: number) => jevBandCheck("trend-4h", st, p)!;
  assertEquals(at(0.58), { key: "SOL/USD|strong|high|positive", min: 0.56, max: 0.63, inBand: true });
  assert(at(lo - JEV_DRIFT_MARGIN).inBand && at(hi + JEV_DRIFT_MARGIN).inBand);   // the margin's edges are in
  assert(!at(0.55).inBand && !at(0.64).inBand);
  assertEquals(jevBandCheck("trend-4h", { ...st, symbol: "DOGE/USD" }, 0.6), { key: "DOGE/USD|strong|high|positive", min: null, max: null, inBand: false });
  assertEquals(jevBandCheck("rotation-1d", st, 0.6), null);
  // trend-1h's key carries the 4-hour trend and breakout words as well.
  const st1 = { symbol: "SOL/USD", trend_4h: "up", trend_strength: "moderate", breakout_4h: "above_range", volatility: "normal", momentum_30d: "positive" };
  assertEquals(jevBandCheck("trend-1h", st1, 0.74)!.inBand, true);               // the shadow entry of 2026-09-27 answered 0.74
});
