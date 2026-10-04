// Round 10: one change away from S1 at a time (RW's record), every arm reported.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 } };
const V: Variant[] = [
  S1,
  { ...S1, id: "keep weather", noWeatherFrom: null },
  { ...S1, id: "keep same-day", sameDayFrom: null },
  { ...S1, id: "+ 48h end horizon", horizonH: 48 },
  { ...S1, id: "buy-only orders", caps: { total: 320, market: 100, reduceFirst: false } },
  { ...S1, id: "hold carried (no exits)", exitPassiveModel: undefined },
  { ...S1, id: "taker exit 00:05 instead", exitPassiveModel: undefined, exitTaker: { afterMin: 5, feeRate: 0.05 } },
  { ...S1, id: "invCap 3 (RW's)", invCap: 3 },
  { ...S1, id: "invCap 7", invCap: 7 },
  { ...S1, id: "invCap none", invCap: 1e9 },
  { ...S1, id: "market cap $60", caps: { total: 320, market: 60, reduceFirst: true } },
  { ...S1, id: "8 markets / $160", budget: 160, maxMarkets: 8 },
  { ...S1, id: "6 markets / $120", budget: 120, maxMarkets: 6 },
  { ...S1, id: "wide keep 0.9", rest: { rule: "wide", from: 0, keep: 0.9 } },
  { ...S1, id: "wide keep 0.6", rest: { rule: "wide", from: 0, keep: 0.6 } },
  { ...S1, id: "lean (x5)", rest: { rule: "lean", from: 0 } },
  { ...S1, id: "k 2 (2N), budget $320", k: 2, budget: 320 },
  { ...S1, id: "band >= $20", rateMin: 20 },
  { ...S1, id: "band $10-100", rateMax: 100 },
  { ...S1, id: "band >= $50", rateMin: 50 },
  { ...S1, id: "stops: the path's fills 25/75", stops: { day: 25, total: 75 } },
  { ...S1, id: "no stop at all", stops: undefined },
  { ...S1, id: "total cap $250", caps: { total: 250, market: 100, reduceFirst: true } },
  { ...S1, id: "total cap $400 (more funding)", caps: { total: 400, market: 100, reduceFirst: true }, budget: 250, maxMarkets: 12 },
];
const out = runAll(rec, V, "2026-09-30");
Deno.writeTextFileSync("results/round10.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 10: one change away from S1 at a time on RW's record (09-25 → 10-04 15:12); differences against S1"));
