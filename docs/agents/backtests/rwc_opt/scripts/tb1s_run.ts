// TB1-SELLS (2026-10-09, results/tb1_sells.txt): live-prep's current rule L1 (S2 + TB1's skip, LPSELF's L1 = RWC-OPT's
// C1) against the same rule with TB1's `skip-buys` (in a one-tick minute the sells of held tokens still rest), on RW's
// record and on LPSELF's full-universe record, under one fill model per run. Each arm's day changes and its inventory
// counters are written whole (results/tb1s_<rec>[_atprice].json, not committed: tb1s_analyse.py reads them).
// From this folder:
//   npx --yes deno@1.46.3 run --allow-read --allow-write --no-check scripts/tb1s_run.ts rw [--at-price]
//   npx --yes deno@1.46.3 run --v8-flags=--max-old-space-size=6000 --allow-read --allow-write --no-check scripts/tb1s_run.ts pr <pr_record.json> [--at-price]
// (<pr_record.json>: LPSELF's built record, sha256 c855d12c…eaf2de9 in ../lpself/MANIFEST.json.)
import { loadRW } from "./rec.ts";
import { loadPR } from "../../lpself/scripts/rec.ts";
import { simulate, type Variant } from "./tb1s_sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import type { Rec } from "./rec.ts";

const which = Deno.args[0], atPrice = Deno.args.includes("--at-price");
if (which !== "rw" && which !== "pr") throw new Error("usage: tb1s_run.ts rw|pr [pr_record.json] [--at-price]");
const rec: Rec = which === "rw" ? await loadRW() : loadPR(Deno.args[1]) as unknown as Rec;
// L1 exactly as LPSELF's lpgrid.ts writes it (on RW's record the carried markets' exits are Phase A's passive model; on
// the full universe they are the rule's own close-only quotes, as the live path runs them).
const L1: Variant = {
  id: "L1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5,
  stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 },
  ...(which === "rw" ? { exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } } : { exitCarried: true }),
};
const SB = { tight: { mode: "skip-buys" as const, maxTicks: 1 } };
const variants: Variant[] = [
  L1,
  { ...L1, ...SB, id: "L1 skip-buys" },
  { ...L1, tight: undefined, id: "L0 (no TB1)" },
  // on RW's record also with close-only exits (RWC-OPT's C2), where the record holds the carried market's book
  ...(which === "rw" ? [{ ...L1, exitPassiveModel: undefined, exitCarried: true, id: "L1 exitCarried" }, { ...L1, ...SB, exitPassiveModel: undefined, exitCarried: true, id: "L1 skip-buys exitCarried" }] : []),
];
// Mark-outs of the resting fills, from the record's own books: the adjusted mid H minutes later (the first row of the
// market within ten minutes after), or the payout when the market settled first; in YES terms, a bid fill (long YES, or a
// NO sold) earns mid - b, an ask fill (short YES, or a YES sold) a - mid, in cents a share, weighted by size.
const midsOf = new Map<string, Array<[number, number]>>();
for (const [t, rows] of [...rec.byMinute.entries()].sort((x, y) => x[0] - y[0])) for (const r of rows) {
  if (!r.row || r.row[2] === null || r.row[3] === null) continue;
  (midsOf.get(r.cond) ?? midsOf.set(r.cond, []).get(r.cond)!).push([t, (r.row[2] + r.row[3]) / 2]);
}
function midAt(c: string, t: number): number | null {
  const st = rec.settleOf.get(c);
  if (st && st.at <= t) return st.payout;
  const l = midsOf.get(c); if (!l) return null;
  let lo = 0, hi = l.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (l[m][0] < t) lo = m + 1; else hi = m; }
  return lo < l.length && l[lo][0] <= t + 10 * 60e3 ? l[lo][1] : null;
}
type Agg = { n: number; shares: number; mo15: number; mo60: number; w15: number; w60: number };
function markouts(log: NonNullable<ReturnType<typeof simulate>["inv"]>["log"]) {
  const g: Record<string, Agg> = {};
  for (const [c, t, side, px, size, tight, isSell] of log) {
    const k = tight ? "sell, tight minute" : isSell ? "sell, other minute" : "buy, other minute";
    const a = g[k] ?? (g[k] = { n: 0, shares: 0, mo15: 0, mo60: 0, w15: 0, w60: 0 });
    a.n++; a.shares += size;
    for (const [H, key, w] of [[15, "mo15", "w15"], [60, "mo60", "w60"]] as const) {
      const m = midAt(c, t + H * 60e3);
      if (m === null) continue;
      a[key] += size * 100 * (side === "bid" ? m - px : px - m); a[w] += size;
    }
  }
  for (const a of Object.values(g)) { a.mo15 = a.w15 ? a.mo15 / a.w15 : NaN; a.mo60 = a.w60 ? a.mo60 / a.w60 : NaN; }
  return g;
}
const out: Record<string, unknown> = {};
for (const v0 of variants) {
  const o = simulate(rec, { ...v0, fillAtPrice: atPrice });
  let prev = { total: 0, stress: 0, reward: 0 };
  const daily = o.days.map((d) => { const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, comMax: d.committedMax, stop: d.stopDay || d.stopTotal }; prev = { total: d.total, stress: d.stress, reward: d.reward }; return r; });
  const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0);
  const { log, ...inv } = o.inv!;
  out[v0.id] = { daily, fills, end: o.end, inv, markouts: markouts(log) };
}
Deno.writeTextFileSync(`results/tb1s_${which}${atPrice ? "_atprice" : ""}.json`, JSON.stringify(out));
console.error(`${which}${atPrice ? " at-price" : ""}: ${variants.length} arms`);
