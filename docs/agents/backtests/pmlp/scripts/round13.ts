// Round 13: the pause after a jump — its plateau on S1, its splits, the x1 contrast without caps (RW-X's x3 vs x1), and
// under fills at our price.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 } };
const V: Variant[] = [S1];
for (const cents of [8, 10, 15, 20, 25]) for (const minutes of [15, 30, 60, 120]) V.push({ ...S1, id: `pause ${cents}c ${minutes}m`, pause: { cents, minutes } });
V.push({ id: "x1 rule, no caps" }, { id: "x1 + pause 15c 60m, no caps (x3)", pause: { cents: 15, minutes: 60 } });
V.push({ ...S1, id: "S1 at-price fills", fillAtPrice: true }, { ...S1, id: "S1 at-price + pause 15c 30m", fillAtPrice: true, pause: { cents: 15, minutes: 30 } }, { ...S1, id: "S1 at-price + pause 15c 60m", fillAtPrice: true, pause: { cents: 15, minutes: 60 } });
const out = runAll(rec, V, "2026-09-30");
Deno.writeTextFileSync("results/round13.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 13: the pause after a jump on S1 (plateau), x1 without caps with and without it, and at-price fills; differences against S1"));
const sp = (s: typeof out[0], f: (d: string) => boolean) => [s.daily.filter((d) => f(d.day)).reduce((a, d) => a + d.tot, 0), s.daily.filter((d) => f(d.day)).reduce((a, d) => a + d.r04, 0)];
const F = [(d: string) => d < "2026-09-30", (d: string) => d >= "2026-09-30", (d: string) => +d.slice(8) % 2 === 1, (d: string) => +d.slice(8) % 2 === 0];
for (const s of out.filter((x) => x.id.startsWith("pause 15c") || x.id.startsWith("pause 20c 30") || x.id.startsWith("pause 10c 30"))) {
  const cells = F.map((f) => { const [a1, a4] = sp(s, f), [b1, b4] = sp(out[0], f); return `${(a1 - b1).toFixed(1).padStart(7)}/${(a4 - b4).toFixed(1).padStart(7)}`; });
  console.log(`  ${s.id.padEnd(16)} h1 | h2 | odd | even (R=1 / R=0.4): ${cells.join(" | ")}`);
}
const x1 = out.find((s) => s.id === "x1 rule, no caps")!, x3 = out.find((s) => s.id.startsWith("x1 + pause"))!;
console.log(`x1 vs x1+pause without caps: total ${x1.all.tot.toFixed(2)} vs ${x3.all.tot.toFixed(2)}; R0.4 ${x1.all.r04.toFixed(2)} vs ${x3.all.r04.toFixed(2)}; from 09-28: ${x1.daily.filter((d) => d.day >= "2026-09-28").reduce((a, d) => a + d.tot, 0).toFixed(2)} vs ${x3.daily.filter((d) => d.day >= "2026-09-28").reduce((a, d) => a + d.tot, 0).toFixed(2)}`);
