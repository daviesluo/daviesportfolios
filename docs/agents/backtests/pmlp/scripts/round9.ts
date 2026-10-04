// Round 9: selection-time book filters on S1 (the day's first recorded book of each market).
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 } };
const V: Variant[] = [
  S1,
  { ...S1, id: "S1 + mid in [0.10, 0.90]", midBand: [0.10, 0.90] },
  { ...S1, id: "S1 + mid in [0.05, 0.95]", midBand: [0.05, 0.95] },
  { ...S1, id: "S1 + mid in [0.20, 0.80]", midBand: [0.20, 0.80] },
  { ...S1, id: "S1 + touch <= 2v", touchOverV: 2 },
  { ...S1, id: "S1 + touch <= 1v", touchOverV: 1 },
  { ...S1, id: "S1 + first-round formula >= $2.50", minFormulaDay: 2.5 },
  { ...S1, id: "S1 + first-round formula >= $10", minFormulaDay: 10 },
];
const out = runAll(rec, V, "2026-09-30");
Deno.writeTextFileSync("results/round9.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 9: selection-time book filters on S1 (RW's record), differences against S1"));
