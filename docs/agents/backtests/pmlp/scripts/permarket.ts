// Per market: P&L and capital-days (holdings at cost + resting buys, minute by minute), x1's rule at 8/$160 without caps.
import { loadRW } from "./rec.ts";
import { simulate } from "./sim.ts";
const rec = loadRW();
const o = simulate(rec, { id: "x1 8/160 nocaps", budget: 160, maxMarkets: 8 });
const rows = Object.entries(o.perMarket).map(([c, x]) => {
  const m = x.meta!;
  const first = x.firstDay ? Date.parse(`${x.firstDay}T00:00:00Z`) : NaN;
  const daysToEnd = m.end ? (Date.parse(m.end) - first) / 86400e3 : null;
  return { c: c.slice(0, 10), q: m.q.slice(0, 60), cat: m.cat, rate: m.rate, v: m.v, tick: m.tick, per: m.perDollarDay, daysToEnd, tot: x.total, rew: x.reward, fil: x.total - x.reward, r04: x.total - 0.6 * x.reward, capDays: x.capDays, carriedDays: x.carriedDays, fills: x.fills, settled: rec.settleOf.has(c) };
});
Deno.writeTextFileSync("results/permarket_x1_8_160_nocaps.json", JSON.stringify(rows));
const tot = rows.reduce((s, r) => ({ tot: s.tot + r.tot, r04: s.r04 + r.r04, cap: s.cap + r.capDays, car: s.car + r.carriedDays }), { tot: 0, r04: 0, cap: 0, car: 0 });
console.log(`markets ${rows.length}; total ${tot.tot.toFixed(2)}, R0.4 ${tot.r04.toFixed(2)}; capital-days ${tot.cap.toFixed(0)} (carried ${tot.car.toFixed(0)}); return per capital-day ${(tot.tot / tot.cap).toFixed(4)} (R0.4 ${(tot.r04 / tot.cap).toFixed(4)})`);
