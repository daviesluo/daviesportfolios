// Round 11: S1 if live fills were more than paper's (a print AT our price fills us), against S0 the same way.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const nMax20 = (m: { minSize: number }) => sizeN(m.minSize) > 20;
const S1: Variant = { id: "S1", skipMarket: nMax20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 } };
const V: Variant[] = [
  S1,
  { ...S1, id: "S1, fills at our price too", fillAtPrice: true },
  { ...S1, id: "S1, fills at price, invCap 3", fillAtPrice: true, invCap: 3 },
  { ...S1, id: "S1, fills at price, wide 0.6", fillAtPrice: true, rest: { rule: "wide", from: 0, keep: 0.6 } },
  { ...S1, id: "S1, fills at price, keep same-day", fillAtPrice: true, sameDayFrom: null },
];
const out = runAll(rec, V, "2026-09-30");
Deno.writeTextFileSync("results/round11.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 11: fills at our price as well as through it (an upper bound on live fills)"));
for (const s of out) console.log(`  ${s.id}: break-even R = ${(-s.all.fil / s.all.rew).toFixed(3)}; stress break-even ${(-(s.all.str - 0.5 * s.all.rew) / s.all.rew).toFixed(3)}`);
