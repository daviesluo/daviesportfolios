// RWC-OPT's search, disclosed by its pre-registration: 65 arms (28 without an account beside x1, 35 with live-prep's
// account beside S2, and the two bases) on RW's record, each day's change written whole (no winner-only report).
// `deno run --allow-read --allow-write --no-check scripts/grid.ts [--at-price]` from this folder.
import { loadRW } from "./rec.ts";
import { simulate, type Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = await loadRW();
const atPrice = Deno.args.includes("--at-price");
const A0: Variant = { id: "A:x1" };   // x1 from the first day: RW-E's same-day rule, no weather, no account (RW-C's replay family)
const S2: Variant = { id: "B:S2", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 } };
const mods: Array<[string, Partial<Variant>]> = [
  ["tb1-skip", { tight: { mode: "skip", maxTicks: 1 } }],
  ["tb1-back", { tight: { mode: "back", maxTicks: 1 } }],
  ["tb2-skip", { tight: { mode: "skip", maxTicks: 2 } }],
  ["tb2-back", { tight: { mode: "back", maxTicks: 2 } }],
  ["pause15/60", { pause: { cents: 15, minutes: 60 } }],
  ["nopause", { pause: undefined }],
  ["pause8/30", { pause: { cents: 8, minutes: 30 } }],
  ["wide.9", { rest: { rule: "wide", from: 0, keep: 0.9 } }],
  ["lean", { rest: { rule: "lean", from: 0 } }],
  ["inv2", { invCap: 2 }],
  ["inv3", { invCap: 3 }],
  ["inv5", { invCap: 5 }],
  ["inv8", { invCap: 8 }],
  ["k2", { k: 2 }],
  ["late6h", { lateCutH: 6 }],
  ["late24h", { lateCutH: 24 }],
  ["mid.10-.90", { midBand: [0.10, 0.90] }],
  ["mid.05-.95", { midBand: [0.05, 0.95] }],
  ["touch<=.5v", { touchOverV: 0.5 }],
  ["top5", { maxMarkets: 5 }],
  ["top10", { maxMarkets: 10 }],
  ["top15", { maxMarkets: 15 }],
  ["formula>=5", { minFormulaDay: 5 }],
  ["h48", { horizonH: 48 }],
  ["weather-in", { noWeatherFrom: null }],
  ["tb1-skip+pause", { tight: { mode: "skip", maxTicks: 1 }, pause: { cents: 15, minutes: 60 } }],
  ["tb1-skip+mid.10-.90", { tight: { mode: "skip", maxTicks: 1 }, midBand: [0.10, 0.90] }],
  ["tb1-skip+late24h", { tight: { mode: "skip", maxTicks: 1 }, lateCutH: 24 }],
];
const modsB: Array<[string, Partial<Variant>]> = [
  ["budget120/6", { budget: 120, maxMarkets: 6 }],
  ["budget300/15", { budget: 300, maxMarkets: 15 }],
  ["cap mkt 60", { caps: { total: 320, market: 60, reduceFirst: true } }],
  ["exitCarried", { exitPassiveModel: undefined, exitCarried: true }],
  ["no exit model", { exitPassiveModel: undefined }],
  ["no stop", { stops: undefined }],
  ["tb1-skip+exitCarried", { tight: { mode: "skip", maxTicks: 1 }, exitPassiveModel: undefined, exitCarried: true }],
];
const variants: Variant[] = [A0, ...mods.map(([n, m]) => ({ ...A0, ...m, id: `A:${n}` })), S2, ...[...mods, ...modsB].map(([n, m]) => ({ ...S2, ...m, id: `B:${n}` }))];
const out: Record<string, unknown> = {};
const t0 = performance.now();
for (const v0 of variants) {
  const v = atPrice ? { ...v0, fillAtPrice: true } : v0;
  const o = simulate(rec, v);
  let prev = { total: 0, stress: 0, reward: 0 };
  const daily = o.days.map((d) => { const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, capRW: d.capitalRW, comMax: d.committedMax, stop: d.stopDay || d.stopTotal }; prev = { total: d.total, stress: d.stress, reward: d.reward }; return r; });
  const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0);
  const pm = Object.entries(o.perMarket).map(([c, x]) => ({ c, tot: x.total, rew: x.reward, q: x.meta?.q ?? "" }));
  out[v0.id] = { daily, fills, end: o.end, chosenPerDay: Object.values(o.chosen).reduce((s, l) => s + l.length, 0) / Object.keys(o.chosen).length, pm };
}
console.error(`${variants.length} arms, ${(performance.now() - t0).toFixed(0)} ms, to ${new Date(rec.last).toISOString()}`);
Deno.writeTextFileSync(atPrice ? "results/rw_grid_atprice.json" : "results/rw_grid.json", JSON.stringify(out));
