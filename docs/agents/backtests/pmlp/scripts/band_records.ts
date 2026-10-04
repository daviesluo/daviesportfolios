// Per market of S1's run on RW's record, by rate band: rewards, fills and capital-days.
import { loadRW } from "./rec.ts";
import { simulate, type Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 } };
const o = simulate(rec, S1);
const B: Record<string, { n: number; rew: number; fil: number; cap: number }> = {};
for (const x of Object.values(o.perMarket)) {
  const r = x.meta?.rate ?? 0;
  const k = r < 50 ? "$10-50" : r < 100 ? "$50-100" : r < 200 ? "$100-200" : "$200+";
  const b = (B[k] ??= { n: 0, rew: 0, fil: 0, cap: 0 }); b.n++; b.rew += x.reward; b.fil += x.total - x.reward; b.cap += x.capDays;
}
console.log("S1 on RW's record, by the market's rate: markets, rewards, fills, capital-days, rewards and fills per capital-day");
for (const [k, b] of Object.entries(B)) console.log(`  ${k.padEnd(9)} ${String(b.n).padStart(3)}  rewards ${b.rew.toFixed(2).padStart(8)}  fills ${b.fil.toFixed(2).padStart(8)}  cap-days ${b.cap.toFixed(1).padStart(7)}  rew/capday ${(b.rew / b.cap).toFixed(3)}  fills/capday ${(b.fil / b.cap).toFixed(3)}`);
