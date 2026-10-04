// Round 14: S2 = S1 + x2's pause (15c, 60 min, frozen 2026-09-27); its headline figures and the key levers again.
import { loadRW } from "./rec.ts";
import { boot, runAll, table } from "./exp.ts";
import { simulate, type Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const nMax20 = (m: { minSize: number }) => sizeN(m.minSize) > 20;
const S2: Variant = { id: "S2", skipMarket: nMax20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 } };
const S0: Variant = { id: "S0 path as built", noWeatherFrom: null, horizonH: 48, skipMarket: nMax20, budget: 160, maxMarkets: 8, caps: { total: 320, market: 60, reduceFirst: false }, stops: { day: 25, total: 75 } };
const V: Variant[] = [
  S2, S0,
  { ...S2, id: "no pause (= S1)", pause: undefined },
  { ...S2, id: "buy-only", caps: { total: 320, market: 100, reduceFirst: false } },
  { ...S2, id: "hold carried", exitPassiveModel: undefined },
  { ...S2, id: "invCap 3", invCap: 3 },
  { ...S2, id: "48h end horizon", horizonH: 48 },
  { ...S2, id: "keep same-day", sameDayFrom: null },
  { ...S2, id: "keep weather", noWeatherFrom: null },
  { ...S2, id: "8 / $160", budget: 160, maxMarkets: 8 },
  { ...S2, id: "market cap $60", caps: { total: 320, market: 60, reduceFirst: true } },
  { ...S2, id: "the path's fills stops", stops: { day: 25, total: 75 } },
  { ...S2, id: "at-price fills", fillAtPrice: true },
  { ...S2, id: "docs' one-sided third", third: true },
];
const out = runAll(rec, V, "2026-09-30");
Deno.writeTextFileSync("results/round14.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 14: S2 (S1 + x2's pause 15c/60m) and one change at a time; differences against S2"));
const days = (rec.last - rec.start) / 86400e3 + 1 / 1440;
for (const id of ["S2", "at-price fills"]) {
  const s = out.find((x) => x.id === id)!;
  const b1 = boot(s.daily.map((d) => d.tot)), b4 = boot(s.daily.map((d) => d.r04)), bs = boot(s.daily.map((d) => d.str));
  const p = (x: number) => (x / days).toFixed(1);
  console.log(`${id}: per day R=1 ${p(s.all.tot)} [${p(b1.p5)}, ${p(b1.p95)}]; R=0.4 ${p(s.all.r04)} [${p(b4.p5)}, ${p(b4.p95)}] (P>0 ${b4.pos}); stress ${p(s.all.str)} [${p(bs.p5)}, ${p(bs.p95)}]; break-even R ${(-s.all.fil / s.all.rew).toFixed(3)}, stress ${(-(s.all.str - 0.5 * s.all.rew) / s.all.rew).toFixed(3)}; worst day R=0.4 ${Math.min(...s.daily.map((d) => d.r04)).toFixed(2)}`);
}
const o = simulate(rec, S2);
const q = o.days.reduce((a, d) => ({ q: a.q + d.quotedMinutes, r: a.r + d.rewardMinutes }), { q: 0, r: 0 });
console.log(`S2 scoring share of quoted minutes ${(100 * q.r / q.q).toFixed(1)} %, by day ${o.days.map((d) => (100 * d.rewardMinutes / Math.max(1, d.quotedMinutes)).toFixed(0)).join(" ")}`);
const s2 = out[0], s0 = out[1];
const d1 = s2.daily.map((d, i) => d.tot - s0.daily[i].tot), d4 = s2.daily.map((d, i) => d.r04 - s0.daily[i].r04);
const b1 = boot(d1), b4 = boot(d4);
console.log(`S2 - S0: ${(s2.all.tot - s0.all.tot).toFixed(2)} [${b1.p5.toFixed(0)}, ${b1.p95.toFixed(0)}] P>0 ${b1.pos}; R0.4 ${(s2.all.r04 - s0.all.r04).toFixed(2)} [${b4.p5.toFixed(0)}, ${b4.p95.toFixed(0)}] P>0 ${b4.pos}`);
const pm = Object.entries(o.perMarket).map(([c, x]) => ({ c, tot: x.total, q: x.meta?.q ?? "" })).sort((a, b) => b.tot - a.tot);
const tot = pm.reduce((s, x) => s + x.tot, 0);
console.log(`S2 markets ${pm.length}; best ${pm[0].tot.toFixed(2)} (${(100 * pm[0].tot / tot).toFixed(1)} %), total without it ${(tot - pm[0].tot).toFixed(2)}`);
