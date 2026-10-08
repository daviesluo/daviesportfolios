// Live-prep against itself: every change to its current rule (S2 + TB1's skip, "L1") on RW's record (14 days, RW's
// selection) and on the full-universe record built from pm-rec (10-05 -> 10-08, every candidate of $10 and over), under
// both fill models. Each arm's day changes are written whole.
// deno run --allow-read --allow-write --no-check lpgrid.ts rw|pr [--at-price]
import { loadPR, loadRW } from "./rec.ts";
import { simulate, type Variant } from "./sim2.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";

const which = Deno.args[0], atPrice = Deno.args.includes("--at-price");
const rec = which === "rw" ? await loadRW() : loadPR("data/pr_record.json");
// The current rule. On RW's record carried markets have no book once RW stops quoting them, so their exits are Phase A's
// passive model there (as RWC-OPT's S2); on the full universe every carried market's book is recorded, so they are the
// rule's own close-only quotes.
const L1: Variant = {
  id: "L1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5,
  stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 },
  ...(which === "rw" ? { exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } } : { exitCarried: true }),
};
const mods: Array<[string, Partial<Variant>]> = [
  ["L0 (no TB1)", { tight: undefined }],
  ["tb1-back", { tight: { mode: "back", maxTicks: 1 } }],
  ["tb2-skip", { tight: { mode: "skip", maxTicks: 2 } }],
  ["6 mkts $120", { budget: 120, maxMarkets: 6 }],
  ["8 mkts $160", { budget: 160, maxMarkets: 8 }],
  ["12 mkts $240", { budget: 240, maxMarkets: 12 }],
  ["15 mkts $300", { budget: 300, maxMarkets: 15 }],
  ["20 mkts $400", { budget: 400, maxMarkets: 20 }],
  ["rate >= $20", { rateMin: 20 }],
  ["rate >= $50", { rateMin: 50 }],
  ["formula >= $5", { minFormulaDay: 5 }],
  ["end horizon 48h", { horizonH: 48 }],
  ["size 2N", { k: 2 }],
  ["wide.9", { rest: { rule: "wide", from: 0, keep: 0.9 } }],
  ["lean", { rest: { rule: "lean", from: 0 } }],
  ["inv 3N", { invCap: 3 }],
  ["inv 8N", { invCap: 8 }],
  ["buy-only", { caps: { total: 320, market: 100, reduceFirst: false } }],
  ["no pause", { pause: undefined }],
  ["pause 8c/30", { pause: { cents: 8, minutes: 30 } }],
  ["pause 25c/60", { pause: { cents: 25, minutes: 60 } }],
  ["stop $50", { stops: { day: 1e9, total: 50, basis: "paid", R: 0.4 } }],
  ["no stop", { stops: undefined }],
  ["cap $60/mkt", { caps: { total: 320, market: 60, reduceFirst: true } }],
  ["cap $150/mkt", { caps: { total: 320, market: 150, reduceFirst: true } }],
  ["late cut 6h", { lateCutH: 6 }],
  ["late cut 24h", { lateCutH: 24 }],
  ["mid .05-.95", { midBand: [0.05, 0.95] }],
  ["mid .10-.90", { midBand: [0.10, 0.90] }],
  ["fill cooldown 5m", { fillCooldownMin: 5 }],
  ["fill cooldown 15m", { fillCooldownMin: 15 }],
  ["fill cooldown 30m", { fillCooldownMin: 30 }],
  ["imbalance .15-.85", { imbalance: [0.15, 0.85] }],
  ["imbalance .25-.75", { imbalance: [0.25, 0.75] }],
  ...(which === "rw"
    ? [["exits close-only", { exitPassiveModel: undefined, exitCarried: true }]] as Array<[string, Partial<Variant>]>
    : [["reselect 2h", { reselectEveryH: 2 }], ["reselect 6h", { reselectEveryH: 6 }], ["exits passive model", { exitCarried: undefined, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } }]] as Array<[string, Partial<Variant>]>),
];
const variants: Variant[] = [L1, ...mods.map(([n, m]) => ({ ...L1, ...m, id: n }))];
const out: Record<string, unknown> = {};
const t0 = performance.now();
for (const v0 of variants) {
  const o = simulate(rec, { ...v0, fillAtPrice: atPrice });
  let prev = { total: 0, stress: 0, reward: 0 };
  const daily = o.days.map((d) => { const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, comMax: d.committedMax, stop: d.stopDay || d.stopTotal }; prev = { total: d.total, stress: d.stress, reward: d.reward }; return r; });
  const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0);
  out[v0.id] = { daily, fills, end: o.end, chosenPerDay: Object.values(o.chosen).reduce((s, l) => s + l.length, 0) / Math.max(1, Object.keys(o.chosen).length) };
}
console.error(`${which}${atPrice ? " at-price" : ""}: ${variants.length} arms, ${(performance.now() - t0).toFixed(0)} ms`);
Deno.writeTextFileSync(`results/lp_${which}${atPrice ? "_atprice" : ""}.json`, JSON.stringify(out));
