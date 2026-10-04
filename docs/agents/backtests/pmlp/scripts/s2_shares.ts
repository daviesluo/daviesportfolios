import { loadRW } from "./rec.ts";
import { simulate, type Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S2", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 } };
const o = simulate(rec, S1);
let shares = 0, fills = 0;
// fillShares lives on the account; re-run to read it via perMarket is not exposed: count from the accounts directly
// deno-lint-ignore no-explicit-any
for (const x of Object.values(o.perMarket) as any[]) { fills += x.fills; shares += x.fillShares ?? 0; }
console.log(`S2 fills ${fills} (quotes; the modelled exits count one a minute), filled shares ${shares.toFixed(0)}; fills P&L ${o.end.fillsPnl.toFixed(2)}, ${(o.end.fillsPnl / shares).toFixed(4)} a share`);
