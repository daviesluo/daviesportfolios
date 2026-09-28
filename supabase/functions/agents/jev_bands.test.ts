// JEV-DRIFT's bands (jev_bands.ts) against the answer files they copy, and the check itself.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import answersV2 from "../../../docs/agents/backtests/jev_answers_v2.json" with { type: "json" };
import answersV2Other from "../../../docs/agents/backtests/jev_answers_v2_other.json" with { type: "json" };
import { JEV_ENTER_MIN } from "../_shared/agents_strategy.ts";
import { JEV_OPENROUTER_MODEL, JEV_TYPESAFE_MODEL } from "../_shared/jev.ts";
import {
  JEV_BANDS, JEV_CAUTION_FLAG, JEV_DRIFT_MARGIN, JEV_MEASURED_MODEL, JEV_MEASURED_PROVIDER, jevBandCheck, jevBandKey, jevDriftFlags, type JevBandKind,
} from "./jev_bands.ts";

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

Deno.test("no trend-4h or trend-1h band, widened, straddles JEV_ENTER_MIN: every flip of an entry by its healthy answer is flagged", () => {
  // The gate refuses an entry below JEV_ENTER_MIN. A band wholly on one side decides every in-band answer as measured, so
  // an answer that decides otherwise lies outside the band and is flagged. momentum-1d's bands do straddle (18 of 189):
  // its gate is in shadow (0059), and its flips can pass unflagged.
  for (const kind of ["trend-4h", "trend-1h"] as JevBandKind[]) {
    for (const [key, [lo, hi]] of Object.entries(JEV_BANDS[kind])) {
      const wLo = Math.round((lo - JEV_DRIFT_MARGIN) * 100) / 100, wHi = Math.round((hi + JEV_DRIFT_MARGIN) * 100) / 100;
      assert(wLo >= JEV_ENTER_MIN || wHi < JEV_ENTER_MIN, `${kind} ${key}: [${wLo}, ${wHi}] straddles ${JEV_ENTER_MIN}`);
    }
  }
  const straddling = Object.values(JEV_BANDS["momentum-1d"]).filter(([lo, hi]) =>
    Math.round((lo - JEV_DRIFT_MARGIN) * 100) / 100 < JEV_ENTER_MIN && Math.round((hi + JEV_DRIFT_MARGIN) * 100) / 100 >= JEV_ENTER_MIN);
  assertEquals(straddling.length, 18);
});

Deno.test("the measured transport and the caution flag agree with the answer files and the transports' own names", () => {
  assertEquals([answersV2.provenance.transport, answersV2.provenance.model], [JEV_MEASURED_PROVIDER, JEV_MEASURED_MODEL]);
  assertEquals([answersV2Other.provenance.transport, answersV2Other.provenance.model], [JEV_MEASURED_PROVIDER, JEV_MEASURED_MODEL]);
  assert(JEV_MEASURED_MODEL.startsWith(`${JEV_OPENROUTER_MODEL}-`), "OpenRouter resolves its alias to the dated snapshot");
  assert((JEV_MEASURED_MODEL as string) !== JEV_TYPESAFE_MODEL, "TypeSafe direct names another model: its answers are flagged");
  // Every caution reply measured, 1,665 of them, is below the flag, and the flag below the gate's veto (1.75).
  const cautions = [...(answersV2.states as unknown as Measured[]), ...(answersV2Other["trend-1h"] as unknown as Measured[]),
    ...(answersV2Other["momentum-1d"] as unknown as Measured[])].flatMap((s) => s.caution as number[]);
  assertEquals([cautions.length, Math.max(...cautions)], [1665, 1.02]);
  assert(JEV_CAUTION_FLAG > 1.02 && JEV_CAUTION_FLAG < 1.75);
});

Deno.test("jevDriftFlags: one flag per thing that differs from what was measured, and none when nothing does", () => {
  const st = { symbol: "SOL/USD", trend_strength: "strong", volatility: "high", momentum_30d: "positive" };
  const base = { kind: "trend-4h", version: "v2", band: jevBandCheck("trend-4h", st, 0.58), healthy: 0.58, caution: 0,
    provider: JEV_MEASURED_PROVIDER, model: JEV_MEASURED_MODEL };
  assertEquals(jevDriftFlags(base), []);
  assertEquals(jevDriftFlags({ ...base, band: jevBandCheck("trend-4h", st, 0.7), healthy: 0.7 }),
    ["healthy 0.7 is outside [0.56, 0.63] for SOL/USD|strong|high|positive"]);
  assertEquals(jevDriftFlags({ ...base, band: jevBandCheck("trend-4h", { ...st, symbol: "DOGE/USD" }, 0.58) }),
    ["healthy 0.58 is outside every measured band (a state never measured) for DOGE/USD|strong|high|positive"]);
  // A question the bands were not measured on is a flag in itself: the check would otherwise go quiet without a word.
  assertEquals(jevDriftFlags({ ...base, kind: "trend-1h", version: "v3-trend-1h", band: null }), ["no measured bands for question v3-trend-1h: the check cannot run"]);
  assertEquals(jevDriftFlags({ ...base, version: "v3", band: null }), ["no measured bands for question v3: the check cannot run"]);
  // A rule with no bands at all (rotation, dislocation) is not flagged for that.
  assertEquals(jevDriftFlags({ ...base, kind: "rotation-1d", band: null }), []);
  // Caution: 1.49 is quiet, 1.5 is flagged — below the gate's 1.75, which the flag exists to see coming.
  assertEquals(jevDriftFlags({ ...base, caution: 1.49 }), []);
  assertEquals(jevDriftFlags({ ...base, caution: 1.5 }), ["caution 1.5 ≥ 1.5 (measured at most 1.02; the gate vetoes at 1.75)"]);
  // Another snapshot through OpenRouter, or the fallback transport, is flagged with what answered.
  assertEquals(jevDriftFlags({ ...base, model: "typesafe/jev-1.14-20261101" }),
    ["answered by typesafe/jev-1.14-20261101 via openrouter, not the typesafe/jev-1.13-20260917 via openrouter the bands were measured on"]);
  assertEquals(jevDriftFlags({ ...base, provider: "typesafe", model: JEV_TYPESAFE_MODEL }),
    ["answered by jev-1.13.0 via typesafe, not the typesafe/jev-1.13-20260917 via openrouter the bands were measured on"]);
  // Everything at once: each is its own flag.
  assertEquals(jevDriftFlags({ ...base, band: jevBandCheck("trend-4h", st, 0.3), healthy: 0.3, caution: 1.8, provider: "typesafe", model: JEV_TYPESAFE_MODEL }).length, 3);
});
