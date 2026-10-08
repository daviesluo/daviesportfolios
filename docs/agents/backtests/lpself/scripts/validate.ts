import { loadPR } from "./rec.ts";
import { simulate, type Variant } from "./sim2.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const t0 = performance.now();
const rec = loadPR("data/pr_record.json");
console.log(`loaded ${rec.byMinute.size} minutes in ${(performance.now() - t0).toFixed(0)} ms`);
const aux = JSON.parse(Deno.readTextFileSync("data/aux.json"));
const S2: Variant = { id: "S2", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 } };
for (const v of [{ ...S2, id: "L0 exitCarried", exitCarried: true }, { ...S2, id: "L0 passive", exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } }, { ...S2, id: "L1 exitCarried+tb1", exitCarried: true, tight: { mode: "skip" as const, maxTicks: 1 } }] as Variant[]) {
  const t1 = performance.now();
  const o = simulate(rec, v);
  let prev = { total: 0, reward: 0 };
  const days = o.days.map((d) => { const r = { day: d.day, tot: d.total - prev.total, rew: d.reward - prev.reward }; prev = { total: d.total, reward: d.reward }; return r; });
  const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0);
  console.log(v.id, `${(performance.now() - t1).toFixed(0)} ms, fills ${fills}`, days.map((d) => `${d.day.slice(5)} R1 ${d.tot.toFixed(1)} rew ${d.rew.toFixed(1)} R.4 ${(d.tot - 0.6 * d.rew).toFixed(1)}`).join(" | "));
  for (const [day, list] of Object.entries(o.chosen)) {
    const real = new Set((aux.lp_markets as Array<{ day: string; cond: string }>).filter((x) => x.day === day).map((x) => x.cond));
    console.log(`  ${day}: chosen ${list.length}, live-prep's own ${real.size}, both ${list.filter((c) => real.has(c)).length}`);
  }
}
console.log("live-prep's paper (page definition) R1 10-05 63.97 | 10-06 103.90 | 10-07 150.26 | 10-08 ~131.8 to 22:47; rewards 82.92 / 157.37 / 76.64 / 185.49");
