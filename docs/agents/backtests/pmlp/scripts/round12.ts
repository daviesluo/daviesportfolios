// Round 12: x2's pause after a jump, and the count-market classes, on S1.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 } };
const P = /\b(posts?|tweets?|truth social)\b/i, Vw = /\bviews?\b/i;
const C = /\b(streams?|first week sales|transits?|tomatometer|app store|market share|committed|box office|livebench)\b/i;
const V: Variant[] = [
  S1,
  { ...S1, id: "pause 15c / 60 min (x2)", pause: { cents: 15, minutes: 60 } },
  { ...S1, id: "pause 10c / 60 min", pause: { cents: 10, minutes: 60 } },
  { ...S1, id: "pause 15c / 30 min", pause: { cents: 15, minutes: 30 } },
  { ...S1, id: "no post-count markets", skipMarket: (m) => sizeN(m.minSize) > 20 || P.test(m.q) },
  { ...S1, id: "no post- or view-count", skipMarket: (m) => sizeN(m.minSize) > 20 || P.test(m.q) || Vw.test(m.q) },
  { ...S1, id: "no live-counter markets", skipMarket: (m) => sizeN(m.minSize) > 20 || C.test(m.q) || m.cat === "mentions_fees" },
  { ...S1, id: "no finance_prices_fees", skipMarket: (m) => sizeN(m.minSize) > 20 || m.cat === "finance_prices_fees" },
];
const out = runAll(rec, V, "2026-09-30");
Deno.writeTextFileSync("results/round12.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 12: the pause after a jump (x2), and market classes, on S1; differences against S1"));
