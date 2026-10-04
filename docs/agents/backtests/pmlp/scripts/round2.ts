// Round 2: the levers at the live size (x1's rule, 8 markets / $160 a day from RW's record), one at a time.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
const rec = loadRW();
const SPLIT = "2026-09-30";
const caps = (total = 320, market = 60, reduceFirst = true) => ({ total, market, reduceFirst });
const B = (id: string, x: Partial<Variant> = {}): Variant => ({ id, budget: 160, maxMarkets: 8, caps: caps(), ...x });
const V: Variant[] = [
  B("base: caps 320/60 rf, no stops"),
  B("no caps", { caps: undefined }),
  B("caps buy-only", { caps: caps(320, 60, false) }),
  B("caps 320/100", { caps: caps(320, 100) }),
  B("caps 400/80", { caps: caps(400, 80) }),
  B("caps 1000/200", { caps: caps(1000, 200) }),
  // stops
  B("stops fills 25/75 (path)", { stops: { day: 25, total: 75 } }),
  B("stops fills 50/150", { stops: { day: 50, total: 150 } }),
  B("stops r40 25/75", { stops: { day: 25, total: 75, basis: "r40" } }),
  B("stops r40 50/150", { stops: { day: 50, total: 150, basis: "r40" } }),
  // exits from carried positions
  B("exit carried", { exitCarried: true }),
  // inventory cap
  B("invCap 1", { invCap: 1 }), B("invCap 2", { invCap: 2 }), B("invCap 5", { invCap: 5 }), B("invCap 10", { invCap: 10 }), B("invCap none", { invCap: 1e9 }),
  B("invCap 2, no caps", { invCap: 2, caps: undefined }), B("invCap 5, no caps", { invCap: 5, caps: undefined }), B("invCap none, no caps", { invCap: 1e9, caps: undefined }),
  // size multiple
  B("k 2", { k: 2 }), B("k 2, budget 320", { k: 2, budget: 320 }), B("k 2, no caps", { k: 2, caps: undefined, budget: 320 }),
  B("k 0.5 (N/2)", { k: 0.5 }),
  // where the quotes rest
  B("wide keep 0.9", { rest: { rule: "wide", from: 0, keep: 0.9 } }),
  B("wide keep 0.7", { rest: { rule: "wide", from: 0, keep: 0.7 } }),
  B("wide keep 0.6", { rest: { rule: "wide", from: 0, keep: 0.6 } }),
  B("wide keep 0.5", { rest: { rule: "wide", from: 0, keep: 0.5 } }),
  B("lean", { rest: { rule: "lean", from: 0 } }),
  // horizon and late cut
  B("48h horizon", { horizonH: 48 }),
  B("late cut 24h", { lateCutH: 24 }),
  B("late cut 6h", { lateCutH: 6 }),
  // the docs' one-sided third (what the reward would be), base and invCap 2
  B("third (docs formula)", { third: true }),
  B("third, invCap 2", { third: true, invCap: 2 }),
];
const out = runAll(rec, V, SPLIT);
Deno.writeTextFileSync("results/round2.json", JSON.stringify(out));
console.log(table(out, out[0], `ROUND 2 on RW's record 09-25 → ${new Date(rec.last).toISOString()} (h1 09-25..09-29, h2 09-30..10-04); x1's rule, 8 markets / $160 a day; differences against the base`));
