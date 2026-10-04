// Round 3: freeing the carried capital (taker exits), the stops redesigned, on x1's rule at 8 / $160 under the $320 cap.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
const rec = loadRW();
const SPLIT = "2026-09-30";
const caps = (total = 320, market = 60, reduceFirst = true) => ({ total, market, reduceFirst });
const ex = (afterMin = 5, h?: number) => ({ afterMin, feeRate: 0.05, ...(h !== undefined ? { onlyEndingWithinH: h } : {}) });
const B = (id: string, x: Partial<Variant> = {}): Variant => ({ id, budget: 160, maxMarkets: 8, caps: caps(), ...x });
const V: Variant[] = [
  B("base: caps 320/60 rf, no stops"),
  B("exit carried 00:05", { exitTaker: ex() }),
  B("exit carried 00:05, ending <24h only", { exitTaker: ex(5, 24) }),
  B("exit carried 00:05, ending <48h only", { exitTaker: ex(5, 48) }),
  B("exit carried 06:00", { exitTaker: ex(360) }),
  B("exit, no caps", { exitTaker: ex(), caps: undefined }),
  B("no caps (ref)", { caps: undefined }),
  B("exit + wide 0.9", { exitTaker: ex(), rest: { rule: "wide", from: 0, keep: 0.9 } }),
  B("exit + invCap 2", { exitTaker: ex(), invCap: 2 }),
  B("exit + invCap 5", { exitTaker: ex(), invCap: 5 }),
  B("exit + 48h horizon", { exitTaker: ex(), horizonH: 48 }),
  B("exit + keep weather", { exitTaker: ex(), noWeatherFrom: null }),
  B("exit + keep same-day", { exitTaker: ex(), sameDayFrom: null }),
  B("exit + all picks (no 8/$160)", { exitTaker: ex(), budget: undefined, maxMarkets: undefined }),
  B("exit + 6/$120", { exitTaker: ex(), budget: 120, maxMarkets: 6 }),
  B("exit + 4/$80", { exitTaker: ex(), budget: 80, maxMarkets: 4 }),
  B("exit + k2 $320", { exitTaker: ex(), k: 2, budget: 320 }),
  // stops, with the exit
  B("exit + stops fills 25/75 (path)", { exitTaker: ex(), stops: { day: 25, total: 75 } }),
  B("exit + stops fills total 150 only", { exitTaker: ex(), stops: { day: 1e9, total: 150 } }),
  B("exit + stops r40 total 75 only", { exitTaker: ex(), stops: { day: 1e9, total: 75, basis: "r40" } }),
  B("exit + stops r40 50/75", { exitTaker: ex(), stops: { day: 50, total: 75, basis: "r40" } }),
  B("exit + stops r40 25/75", { exitTaker: ex(), stops: { day: 25, total: 75, basis: "r40" } }),
  B("exit + third (docs formula)", { exitTaker: ex(), third: true }),
];
const out = runAll(rec, V, SPLIT);
Deno.writeTextFileSync("results/round3.json", JSON.stringify(out));
console.log(table(out, out[0], `ROUND 3 on RW's record 09-25 → ${new Date(rec.last).toISOString()}; x1's rule, 8 / $160, caps $320 / $60 reduce-first; differences against the base (no exit, no stops)`));
