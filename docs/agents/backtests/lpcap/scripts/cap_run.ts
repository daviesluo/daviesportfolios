// LPCAP (2026-10-09): does live-prep's return on capital change with its size, and how much can it deploy? Davies,
// 2026-10-09: "另外也研究下不同本金的受益会有区别吗，最多能投入多少". Live-prep's current rule L1 (LPSELF's lpgrid.ts, word for
// word) first, checked byte for byte against LPSELF's committed result; then the same rule at total caps of $320 to
// $10,000 under four ways of using the capital, and L1 with the cap following its equity (a payout reinvested at once).
//   cap    only the total cap moves (and the stop with it): ten markets, $200 of first quotes, $100 a market, N-sized orders
//   mkts   more markets: ten x s of them (at most the 60 the full-universe record keeps a slot), $200 x s of first quotes
//   size   bigger orders: k = s (k x N shares an order), $200 x s of first quotes, $100 x s a market
//   both   k = sqrt(s) and ten x sqrt(s) markets, $200 x s of first quotes, $100 x sqrt(s) a market
// where s = cap / 320; the stop is 75 x s in every arm (the same fraction of the capital as today's $75 of $320).
// From this folder (docs/agents/backtests/lpcap):
//   npx --yes deno@1.46.3 run --allow-read --allow-write --no-check scripts/cap_run.ts rw [--at-price]
//   npx --yes deno@1.46.3 run --v8-flags=--max-old-space-size=6000 --allow-read --allow-write --no-check scripts/cap_run.ts pr <pr_record.json> [--at-price]
// (<pr_record.json>: LPSELF's built record, sha256 c855d12c…eaf2de9 in ../lpself/MANIFEST.json, not committed.)
import { loadRW } from "../../lpself/scripts/rec.ts";
import { loadPR } from "../../lpself/scripts/rec.ts";
import { simulate, type Variant } from "./cap_sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import type { Rec } from "../../lpself/scripts/rec.ts";

const which = Deno.args[0], atPrice = Deno.args.includes("--at-price");
if (which !== "rw" && which !== "pr") throw new Error("usage: cap_run.ts rw|pr [pr_record.json] [--at-price]");
const rec: Rec = which === "rw" ? await loadRW() : loadPR(Deno.args[1]) as unknown as Rec;
// L1 exactly as LPSELF's lpgrid.ts writes it.
const L1: Variant = {
  id: "L1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5,
  stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 },
  ...(which === "rw" ? { exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } } : { exitCarried: true }),
};
const lpgridOut = (o: ReturnType<typeof simulate>) => {
  let prev = { total: 0, stress: 0, reward: 0 };
  const daily = o.days.map((d) => { const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, comMax: d.committedMax, stop: d.stopDay || d.stopTotal }; prev = { total: d.total, stress: d.stress, reward: d.reward }; return r; });
  const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0);
  return { daily, fills, end: o.end, chosenPerDay: Object.values(o.chosen).reduce((s, l) => s + l.length, 0) / Math.max(1, Object.keys(o.chosen).length) };
};
// The check: L1 through this copy is LPSELF's committed L1, byte for byte.
const l1 = simulate(rec, { ...L1, fillAtPrice: atPrice });
const committed = JSON.parse(Deno.readTextFileSync(`../lpself/results/lp_${which}${atPrice ? "_atprice" : ""}.json`)).L1;
const same = JSON.stringify(lpgridOut(l1)) === JSON.stringify(committed);
console.error(`${which}${atPrice ? " at-price" : ""}: L1 ${same ? "reproduces" : "DOES NOT reproduce"} LPSELF's lp_${which}${atPrice ? "_atprice" : ""}.json byte for byte`);
if (!same) Deno.exit(1);

const CAPS = [320, 640, 1000, 2000, 5000, 10000];
const arms: Variant[] = [];
for (const C of CAPS) {
  const s = C / 320, r = Math.sqrt(s), stops = { day: 1e9, total: 75 * s, basis: "paid" as const, R: 0.4 };
  arms.push({ ...L1, id: `cap ${C}`, caps: { total: C, market: 100, reduceFirst: true }, stops });
  arms.push({ ...L1, id: `mkts ${C}`, caps: { total: C, market: 100, reduceFirst: true }, stops, maxMarkets: Math.min(60, Math.round(10 * s)), budget: 200 * s });
  arms.push({ ...L1, id: `size ${C}`, caps: { total: C, market: 100 * s, reduceFirst: true }, stops, k: s, budget: 200 * s });
  arms.push({ ...L1, id: `both ${C}`, caps: { total: C, market: 100 * r, reduceFirst: true }, stops, k: r, maxMarkets: Math.min(60, Math.round(10 * r)), budget: 200 * s });
}
arms.push({ ...L1, id: "L1 equity R.4", equity: { R: 0.4 } });
arms.push({ ...L1, id: "L1 equity R1", equity: { R: 1 } });
const out: Record<string, unknown> = {};
const write = (id: string, o: ReturnType<typeof simulate>) => {
  const base = lpgridOut(o);
  out[id] = {
    ...base,
    daily: base.daily.map((d, i) => ({ ...d, posts: o.days[i].posts, pool: o.days[i].pool, capTotal: o.days[i].capTotal, capWithheld: o.days[i].capWithheld, comMean: o.days[i].committedMean, markets: o.days[i].markets })),
    perMarketTop: Object.values(o.perMarket).map((x) => x.reward).sort((a, b) => b - a).slice(0, 5),
  };
};
write("L1", l1);
const t0 = performance.now();
for (const v of arms) { write(v.id, simulate(rec, { ...v, fillAtPrice: atPrice })); console.error(`  ${v.id} ${((performance.now() - t0) / 1000).toFixed(0)} s`); }
Deno.writeTextFileSync(`results/cap_${which}${atPrice ? "_atprice" : ""}.json`, JSON.stringify(out));
