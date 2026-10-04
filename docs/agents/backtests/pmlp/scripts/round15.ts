// Round 15: S2 when settled tokens hold capital until redeemed (Davies redeems by hand).
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S2: Variant = { id: "S2 (redeemed at once)", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 } };
const out = runAll(rec, [S2, { ...S2, id: "S2, redeemed after 24 h", redeemLagMin: 1440 }, { ...S2, id: "S2, redeemed after 72 h", redeemLagMin: 4320 }, { ...S2, id: "S2, never redeemed in the run", redeemLagMin: 1e7 }], "2026-09-30");
Deno.writeTextFileSync("results/round15.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 15: S2 when a settled market's payout holds capital until redeemed"));
