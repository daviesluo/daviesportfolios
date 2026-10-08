// RWC-OPT's runner: every arm of arms.ts on one run's record, under both fill models, each day's change and each
// market-day's change written whole (results/<run>_arms.json). `deno run --allow-read --allow-write --no-check
// scripts/run.ts rw|rwc` from this folder.
import { loadRW, loadRWC } from "./rec.ts";
import { simulate, type Variant } from "./sim.ts";
import { REPORTED, TESTS } from "./arms.ts";

const which = Deno.args[0];
if (which !== "rw" && which !== "rwc") throw new Error("usage: run.ts rw|rwc");
const rec = which === "rw" ? await loadRW() : await loadRWC();
const arms: Variant[] = [];
for (const t of TESTS) for (const v of [t.arm, t.base]) if (!arms.some((a) => a.id === v.id)) arms.push(v);
arms.push(...REPORTED);
const out: Record<string, unknown> = { run: rec.name, from: new Date(rec.start).toISOString(), last: new Date(rec.last).toISOString(), days: rec.days, arms: {} };
for (const fill of ["strict", "at-price"] as const) {
  for (const v0 of arms) {
    const o = simulate(rec, { ...v0, fillAtPrice: fill === "at-price" });
    let prev = { total: 0, stress: 0, reward: 0 };
    let prevM: Record<string, { total: number; reward: number }> = {};
    const days = o.days.map((d) => {
      const market: Record<string, { tot: number; rew: number }> = {};
      for (const [c, x] of Object.entries(d.perMarket)) {
        const p = prevM[c] ?? { total: 0, reward: 0 };
        const dt = x.total - p.total, dr = x.reward - p.reward;
        if (Math.abs(dt) > 1e-12 || Math.abs(dr) > 1e-12) market[c] = { tot: dt, rew: dr };
      }
      prevM = Object.fromEntries(Object.entries(d.perMarket).map(([c, x]) => [c, { total: x.total, reward: x.reward }]));
      const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, committedMax: d.committedMax, capitalRW: d.capitalRW, stop: d.stopDay || d.stopTotal, market };
      prev = { total: d.total, stress: d.stress, reward: d.reward };
      return r;
    });
    const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0);
    (out.arms as Record<string, unknown>)[`${v0.id} | ${fill}`] = { end: o.end, fills, days };
  }
}
Deno.writeTextFileSync(`results/${which}_arms.json`, JSON.stringify(out));
console.log(`${rec.name}: ${arms.length} arms x 2 fill models, ${rec.days.length} days to ${new Date(rec.last).toISOString()}`);
