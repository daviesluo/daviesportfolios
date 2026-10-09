// LPRESEL6's runner: the arms on the full-universe record (data/pr_record.json), both fill models, each day's change and
// each market-day's change written whole (results/<name>_arms.json), and each day's chosen markets.
// deno run --v8-flags=--max-old-space-size=8000 --allow-read --allow-write --no-check scripts/run.ts data/pr_record.json results/rwc_window_arms.json
import { loadPR } from "./rec.ts";
import { simulate } from "./sim2.ts";
import { L1, L1_PASSIVE, RESEL6, RESEL6_PASSIVE } from "./arms.ts";

const [file, outFile] = Deno.args;
const rec = loadPR(file);
const out: Record<string, unknown> = { from: new Date(rec.start).toISOString(), last: new Date(rec.last).toISOString(), days: rec.days, arms: {} };
for (const fill of ["strict", "at-price"] as const) {
  for (const v0 of [L1, RESEL6, L1_PASSIVE, RESEL6_PASSIVE]) {
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
      const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, committedMax: d.committedMax, stop: d.stopDay || d.stopTotal, market };
      prev = { total: d.total, stress: d.stress, reward: d.reward };
      return r;
    });
    const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0);
    (out.arms as Record<string, unknown>)[`${v0.id} | ${fill}`] = { end: o.end, fills, days, chosen: o.chosen };
  }
}
Deno.writeTextFileSync(outFile, JSON.stringify(out));
console.log(`${rec.days.length} days to ${new Date(rec.last).toISOString()}`);
