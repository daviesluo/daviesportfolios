// S1 on RW's record: what the pre-registration's day-1 bars should expect.
import { loadRW } from "./rec.ts";
import { simulate, type Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 } };
const o = simulate(rec, S1);
let prev = { total: 0, reward: 0, stress: 0 };
console.log("day         quoted-min  scoring%  R=1 day  R=0.4 day  stress day  comMax  comAvg  carried  capW");
for (const d of o.days) {
  const tot = d.total - prev.total, rew = d.reward - prev.reward, st = d.stress - prev.stress;
  console.log(`${d.day}  ${String(d.quotedMinutes).padStart(9)}  ${(100 * d.rewardMinutes / Math.max(1, d.quotedMinutes)).toFixed(1).padStart(7)}  ${tot.toFixed(2).padStart(8)}  ${(tot - 0.6 * rew).toFixed(2).padStart(9)}  ${st.toFixed(2).padStart(10)}  ${d.committedMax.toFixed(0).padStart(6)}  ${d.committedMean.toFixed(0).padStart(6)}  ${d.carriedMean.toFixed(0).padStart(7)}  ${String(d.capWithheld).padStart(5)}`);
  prev = { total: d.total, reward: d.reward, stress: d.stress };
}
const all = o.days.reduce((s, d) => ({ q: s.q + d.quotedMinutes, r: s.r + d.rewardMinutes }), { q: 0, r: 0 });
console.log(`all days: quoted minutes ${all.q}, scoring ${(100 * all.r / all.q).toFixed(1)} %; markets per day ${(Object.values(o.chosen).reduce((s, l) => s + l.length, 0) / Object.keys(o.chosen).length).toFixed(1)}`);
const pm = Object.entries(o.perMarket).map(([c, x]) => ({ c, tot: x.total, q: x.meta?.q ?? "" })).sort((a, b) => b.tot - a.tot);
const tot = pm.reduce((s, x) => s + x.tot, 0);
console.log(`markets ${pm.length}; best market ${pm[0].tot.toFixed(2)} (${(100 * pm[0].tot / tot).toFixed(1)} % of the total) ${pm[0].q.slice(0, 60)}; total without it ${(tot - pm[0].tot).toFixed(2)}; worst ${pm.at(-1)!.tot.toFixed(2)} ${pm.at(-1)!.q.slice(0, 60)}`);
