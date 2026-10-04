// Round 7: the chosen specification S1 against the path as built (S0), on RW's universe, step by step; every step reported.
import { loadRW } from "./rec.ts";
import { boot, runAll, table } from "./exp.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import type { Variant } from "./sim.ts";
const rec = loadRW();
const nMax20 = (m: { minSize: number }) => sizeN(m.minSize) > 20;     // the path's N <= 20
const passive = { sharesPerMin: 9.1 / 60, costPerShare: 0.018 };
const S0: Variant = { id: "S0 path as built (RW-E rule, 48h, buy-only, fills stops 25/75, inv3, 320/60, 8/$160)", noWeatherFrom: null, horizonH: 48, skipMarket: nMax20, budget: 160, maxMarkets: 8, caps: { total: 320, market: 60, reduceFirst: false }, stops: { day: 25, total: 75 } };
const steps: Variant[] = [
  S0,
  { ...S0, id: "+ reduce-first orders", caps: { total: 320, market: 60, reduceFirst: true } },
  { ...S0, id: "+ stops on fills + R0.4 rewards, total 75, no day stop", caps: { total: 320, market: 60, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" } },
  { ...S0, id: "+ no weather (x1)", noWeatherFrom: undefined, caps: { total: 320, market: 60, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" } },
  { ...S0, id: "+ no 48h horizon (same-day only)", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 60, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" } },
  { ...S0, id: "+ passive exits of carried", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 60, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive },
  { ...S0, id: "+ invCap 5", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 60, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 5 },
  { ...S0, id: "+ market cap $100", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 100, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 5 },
  { ...S0, id: "S1 = + 10 markets / $200", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 100, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 5, budget: 200, maxMarkets: 10 },
  // S1's alternatives, one at a time
  { ...S0, id: "S1 with 8 / $160", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 100, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 5 },
  { ...S0, id: "S1 with wide 0.9", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 100, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 5, budget: 200, maxMarkets: 10, rest: { rule: "wide", from: 0, keep: 0.9 } },
  { ...S0, id: "S1 with invCap 3", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 100, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 3, budget: 200, maxMarkets: 10 },
  { ...S0, id: "S1 with the 48h horizon", noWeatherFrom: undefined, caps: { total: 320, market: 100, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 5, budget: 200, maxMarkets: 10 },
  { ...S0, id: "S1 without the N<=20 rule", noWeatherFrom: undefined, horizonH: undefined, skipMarket: undefined, caps: { total: 320, market: 100, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 5, budget: 200, maxMarkets: 10 },
  { ...S0, id: "S1, the docs' one-sided third", noWeatherFrom: undefined, horizonH: undefined, caps: { total: 320, market: 100, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "r40" }, exitPassiveModel: passive, invCap: 5, budget: 200, maxMarkets: 10, third: true },
];
const out = runAll(rec, steps, "2026-09-30");
Deno.writeTextFileSync("results/round7.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 7: S0 (the path as built, on RW's universe) and the steps to S1; differences against S0"));
// S1 against S0 and against "x1 rule at 8/$160 reduce-first, no stops": leave-one-market-out and halves
const s1 = out.find((s) => s.id.startsWith("S1 = "))!, s0 = out[0];
const pm = (s: typeof s1) => new Map(s.perMarket.map((m) => [m.cond, m]));
const a = pm(s1), b = pm(s0);
const diffs = [...new Set([...a.keys(), ...b.keys()])].map((c) => ({ c, q: (a.get(c) ?? b.get(c))!.q, d: (a.get(c)?.tot ?? 0) - (b.get(c)?.tot ?? 0), d4: ((a.get(c)?.tot ?? 0) - 0.6 * (a.get(c)?.rew ?? 0)) - ((b.get(c)?.tot ?? 0) - 0.6 * (b.get(c)?.rew ?? 0)) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
const D = s1.all.tot - s0.all.tot, D4 = s1.all.r04 - s0.all.r04;
console.log(`\nS1 - S0: total ${D.toFixed(2)}, R0.4 ${D4.toFixed(2)}; without the top market ${(D - diffs[0].d).toFixed(2)} / ${(D4 - diffs[0].d4).toFixed(2)}, without the top two ${(D - diffs[0].d - diffs[1].d).toFixed(2)} / ${(D4 - diffs[0].d4 - diffs[1].d4).toFixed(2)}`);
for (const x of diffs.slice(0, 8)) console.log(`   ${x.c.slice(0, 10)} ${x.d.toFixed(2).padStart(8)} ${x.d4.toFixed(2).padStart(8)} | ${x.q.slice(0, 70)}`);
console.log(`S1 per day: ${s1.daily.map((d) => `${d.day.slice(5)} ${d.tot.toFixed(0)}/${d.r04.toFixed(0)}`).join("  ")}`);
const b1 = boot(s1.daily.map((d) => d.tot)), b4 = boot(s1.daily.map((d) => d.r04)), bs = boot(s1.daily.map((d) => d.str));
console.log(`S1 total over the run, day-block bootstrap: R=1 [${b1.p5.toFixed(0)}, ${b1.p95.toFixed(0)}] P>0 ${b1.pos}; R=0.4 [${b4.p5.toFixed(0)}, ${b4.p95.toFixed(0)}] P>0 ${b4.pos}; stress [${bs.p5.toFixed(0)}, ${bs.p95.toFixed(0)}] P>0 ${bs.pos}`);
