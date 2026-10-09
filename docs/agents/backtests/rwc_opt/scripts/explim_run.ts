// EXPENSIVE-LIMIT (2026-10-09, results/expensive_limit.txt): the best per-market limit on BUYING a near-certain token,
// as a SHARE OF THE PATH'S CAPITAL. Davies, 2026-10-09: "加上，但你研究下这个最多买的数值最优的设定后再加，并且以持仓比例来算不是硬
// 数值". The limit: a BUY of a token whose buy price is >= thr rests only while that token's holding in the market at the
// minute's mark, plus the order at its price, stays <= f x C, C the path's capital (its total cap). That is exp_sim.ts's
// `usd X mark` arm with X = f x C, so the simulator is EXPENSIVE-SIDE's exp_sim.ts as committed (7aaaf0f6), untouched.
// Arms: L1 (live-prep's rule today, reproduced exactly against results/exp_*.json first), then f x thr, at the path's
// capital today ($320, $100 a market, $200 of first quotes, 10 markets) and, to see whether the proportion holds as the
// capital grows, at C = $640 / $1,000 / $2,000 with the market cap, the selection budget and the market count scaled with
// C ("scaled"), and with only the total cap raised ("total only", the path's other limits as they are today).
// From this folder:
//   npx --yes deno@1.46.3 run --allow-read --allow-write --no-check scripts/explim_run.ts rw [--at-price]
//   npx --yes deno@1.46.3 run --v8-flags=--max-old-space-size=6000 --allow-read --allow-write --no-check scripts/explim_run.ts pr <pr_record.json> [--at-price]
// Each arm's day changes, totals, exposure counters and hourly holdings go to results/explim_<rec>[_atprice].json
// (read by explim_analyse.py).
import { loadRW } from "./rec.ts";
import { loadPR } from "../../lpself/scripts/rec.ts";
import { simulate, type Variant } from "./exp_sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import type { Rec } from "./rec.ts";

const which = Deno.args[0], atPrice = Deno.args.includes("--at-price");
if (which !== "rw" && which !== "pr") throw new Error("usage: explim_run.ts rw|pr [pr_record.json] [--at-price]");
const rec: Rec = which === "rw" ? await loadRW() : loadPR(Deno.args[1]) as unknown as Rec;
// L1 exactly as exp_run.ts writes it.
const L1: Variant = {
  id: "L1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5,
  stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 },
  ...(which === "rw" ? { exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } } : { exitCarried: true }),
};
/** The account at capital C: "scaled" grows the market cap, the selection budget, the market count and the total stop
 * with C (as a reinvested account would run, every limit a share of C); "total" raises the total cap alone. */
function at(C: number, how: "scaled" | "total"): Variant {
  const s = C / 320;
  if (how === "total") return { ...L1, caps: { total: C, market: 100, reduceFirst: true } };
  return { ...L1, budget: 200 * s, maxMarkets: Math.round(10 * s), caps: { total: C, market: 100 * s, reduceFirst: true }, stops: { ...L1.stops!, total: 75 * s } };
}
const FRACS = [0.03, 0.045, 0.0625, 0.08, 0.10, 0.125, 0.15, 0.20, 0.25];
const THRS = [0.93, 0.95, 0.97];
const variants: Variant[] = [L1];
for (const thr of THRS) for (const f of FRACS) variants.push({ ...L1, id: `f ${f} ${thr.toFixed(2)}`, exp: { thr, mode: "usd", usd: f * 320, basis: "mark" } });
// EXPENSIVE-SIDE's own "usd 50 mark 0.95" arm, to check this run reproduces it too
variants.push({ ...L1, id: "usd 50 mark 0.95", exp: { thr: 0.95, mode: "usd", usd: 50, basis: "mark" } });
// cost basis beside the mark, at the threshold the study chose
for (const f of [0.0625, 0.10, 0.125]) variants.push({ ...L1, id: `fcost ${f} 0.95`, exp: { thr: 0.95, mode: "usd", usd: f * 320, basis: "cost" } });
// larger capital: the base (no limit) and a few fractions at 0.95
for (const C of [640, 1000, 2000]) {
  for (const how of ["scaled", "total"] as const) {
    const base = at(C, how);
    variants.push({ ...base, id: `C${C} ${how} base` });
    for (const f of [0.03, 0.0625, 0.08, 0.10, 0.125, 0.20]) variants.push({ ...base, id: `C${C} ${how} f ${f} 0.95`, exp: { thr: 0.95, mode: "usd", usd: f * C, basis: "mark" } });
  }
}
const only = Deno.env.get("EXPLIM_ONLY");   // a comma list of arm ids, for a quick check
const out: Record<string, unknown> = {};
for (const v0 of variants) {
  if (only && !only.split(",").includes(v0.id)) continue;
  const o = simulate(rec, { ...v0, fillAtPrice: atPrice });
  let prev = { total: 0, stress: 0, reward: 0 };
  const daily = o.days.map((d) => { const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, comMax: d.committedMax, stop: d.stopDay || d.stopTotal }; prev = { total: d.total, stress: d.stress, reward: d.reward }; return r; });
  const { log: _l, ...inv } = o.inv!;
  const { elog: _e, finalMark: _f, ...expo } = o.expo!;
  out[v0.id] = { daily, end: o.end, inv, expo, cap: v0.caps, stops: o.days.filter((d) => d.stopTotal).map((d) => d.day) };
  console.error(`${v0.id}: total ${o.end.total.toFixed(2)} reward ${o.end.reward.toFixed(2)}`);
}
const f = `results/explim_${which}${atPrice ? "_atprice" : ""}${only ? "_check" : ""}.json`;
Deno.writeTextFileSync(f, JSON.stringify(out));
console.error(`${which}${atPrice ? " at-price" : ""}: ${Object.keys(out).length} arms -> ${f}`);
