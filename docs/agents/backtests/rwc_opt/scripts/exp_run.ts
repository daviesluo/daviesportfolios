// EXPENSIVE-SIDE (2026-10-09, results/expensive_side.txt): live-prep's current rule L1 (S2 + TB1's skip + x2's pause +
// the paid stop, exactly as LPSELF's lpgrid.ts and tb1s_run.ts write it) against limits on BUYING a token priced at or
// over 0.95 / 0.90, on RW's record (carried markets by Phase A's passive model, as L1 was judged) and on LPSELF's
// full-universe record (close-only exits, as the live path runs them), under one fill model per run. Each arm's day
// changes, its exposure counters and the attribution of its fills P&L by the traded token's price are written whole
// (results/exp_<rec>[_atprice].json.gz, read by exp_analyse.py).
// From this folder:
//   npx --yes deno@1.46.3 run --allow-read --allow-write --no-check scripts/exp_run.ts rw [--at-price]
//   npx --yes deno@1.46.3 run --v8-flags=--max-old-space-size=6000 --allow-read --allow-write --no-check scripts/exp_run.ts pr <pr_record.json> [--at-price]
// (<pr_record.json>: LPSELF's built record, sha256 c855d12c…eaf2de9 in ../lpself/MANIFEST.json, not committed.)
import { loadRW } from "./rec.ts";
import { loadPR } from "../../lpself/scripts/rec.ts";
import { simulate, type Variant } from "./exp_sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import type { Rec } from "./rec.ts";

const which = Deno.args[0], atPrice = Deno.args.includes("--at-price");
if (which !== "rw" && which !== "pr") throw new Error("usage: exp_run.ts rw|pr [pr_record.json] [--at-price]");
const rec: Rec = which === "rw" ? await loadRW() : loadPR(Deno.args[1]) as unknown as Rec;
const L1: Variant = {
  id: "L1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5,
  stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 },
  ...(which === "rw" ? { exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } } : { exitCarried: true }),
};
const arms: Array<[string, Variant["exp"]]> = [];
for (const thr of [0.95, 0.90]) {
  const t = thr.toFixed(2);
  arms.push([`nobuy ${t}`, { thr, mode: "nobuy" }], [`skip ${t}`, { thr, mode: "skip" }]);
  for (const n of [1, 2, 3]) arms.push([`inv ${n}N ${t}`, { thr, mode: "inv", invN: n }]);
  for (const u of [25, 50]) arms.push([`usd ${u} ${t}`, { thr, mode: "usd", usd: u, basis: "cost" }]);
  arms.push([`usd 50 mark ${t}`, { thr, mode: "usd", usd: 50, basis: "mark" }]);
}
const variants: Variant[] = [L1, ...arms.map(([id, exp]) => ({ ...L1, id, exp }))];

// The fills P&L by the traded token's price: each fill marked to the market's end value V (its payout, or the record's
// last mid), in YES terms a bid fill earns size x (V - price), an ask fill size x (price - V); their sum is the arm's fills
// P&L exactly. The traded token is YES at the price for a bid buy / ask sell, NO at 1 - price for an ask buy / bid sell.
const bucket = (p: number) => (p >= 0.95 - 1e-9 ? ">=.95" : p >= 0.90 - 1e-9 ? ".90-.95" : "<.90");
function attribute(o: ReturnType<typeof simulate>) {
  const V = o.expo!.finalMark;
  const g: Record<string, { n: number; shares: number; usd: number; pnl: number }> = {};
  const add = (k: string, size: number, usd: number, pnl: number) => { const a = g[k] ?? (g[k] = { n: 0, shares: 0, usd: 0, pnl: 0 }); a.n++; a.shares += size; a.usd += usd; a.pnl += pnl; };
  for (const [c, , side, px, size, , isSell] of o.inv!.log) {
    const tokPx = side === "bid" ? (isSell ? 1 - px : px) : (isSell ? px : 1 - px);
    const pnl = side === "bid" ? size * (V[c] - px) : size * (px - V[c]);
    add(`${bucket(tokPx)} ${isSell ? "sell" : "buy"}`, size, size * tokPx, pnl);
  }
  for (const [c, , side, px, size] of o.expo!.elog) {
    const tokPx = side === "ask" ? px : 1 - px;
    add(`${bucket(tokPx)} exit`, size, size * tokPx, side === "bid" ? size * (V[c] - px) : size * (px - V[c]));
  }
  return g;
}
const out: Record<string, unknown> = {};
for (const v0 of variants) {
  const o = simulate(rec, { ...v0, fillAtPrice: atPrice });
  let prev = { total: 0, stress: 0, reward: 0 };
  const daily = o.days.map((d) => { const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, comMax: d.committedMax, stop: d.stopDay || d.stopTotal }; prev = { total: d.total, stress: d.stress, reward: d.reward }; return r; });
  const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0);
  const { log: _l, ...inv } = o.inv!;
  const { elog: _e, finalMark: _f, ...expo } = o.expo!;
  out[v0.id] = { daily, fills, end: o.end, inv, expo, attr: attribute(o), stops: o.days.filter((d) => d.stopTotal).map((d) => d.day) };
  console.error(`${v0.id}: total ${o.end.total.toFixed(2)} reward ${o.end.reward.toFixed(2)}`);
}
const f = `results/exp_${which}${atPrice ? "_atprice" : ""}.json`;
Deno.writeTextFileSync(f, JSON.stringify(out));
console.error(`${which}${atPrice ? " at-price" : ""}: ${variants.length} arms -> ${f}`);
