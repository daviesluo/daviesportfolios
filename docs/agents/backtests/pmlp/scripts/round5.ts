// Round 5: passive close-only exits against the taker exit where the record can price both (markets RW still quotes after a
// smaller arm drops them); the market cap with invCap 5; the R = 0.40 day stop; at the chosen structure.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
const rec = loadRW();
const SPLIT = "2026-09-30";
const caps = (market = 60) => ({ total: 320, market, reduceFirst: true });
const taker = { afterMin: 5, feeRate: 0.05 };
const V: Variant[] = [];
for (const [b, m] of [[80, 4], [120, 6]] as const) {
  V.push({ id: `${m}/$${b} hold`, budget: b, maxMarkets: m, caps: caps() });
  V.push({ id: `${m}/$${b} passive exit`, budget: b, maxMarkets: m, caps: caps(), exitCarried: true });
  V.push({ id: `${m}/$${b} taker exit 00:05`, budget: b, maxMarkets: m, caps: caps(), exitTaker: taker });
  V.push({ id: `${m}/$${b} passive, taker 06:00`, budget: b, maxMarkets: m, caps: caps(), exitCarried: true, exitTaker: { afterMin: 360, feeRate: 0.05 } });
}
const C = (id: string, x: Partial<Variant> = {}): Variant => ({ id, caps: caps(), invCap: 5, exitTaker: taker, ...x });
V.push(C("chosen: exit inv5 all"));
V.push(C("chosen, market cap 100", { caps: caps(100) }));
V.push(C("chosen, market cap 40", { caps: caps(40) }));
V.push(C("chosen, invCap 4", { invCap: 4 }));
V.push(C("chosen, invCap 7", { invCap: 7 }));
V.push(C("chosen + stop r40 total 75", { stops: { day: 1e9, total: 75, basis: "r40" } }));
V.push(C("chosen + stop r40 day 50 total 75", { stops: { day: 50, total: 75, basis: "r40" } }));
V.push(C("chosen + stop r40 day 35 total 75", { stops: { day: 35, total: 75, basis: "r40" } }));
V.push(C("chosen + fills stops 25/75 (path)", { stops: { day: 25, total: 75 } }));
V.push(C("chosen, buy-only", { caps: { total: 320, market: 60, reduceFirst: false } }));
V.push(C("chosen, 48h horizon", { horizonH: 48 }));
V.push(C("chosen, keep weather", { noWeatherFrom: null }));
V.push(C("chosen, keep same-day", { sameDayFrom: null }));
V.push(C("chosen, wide 0.9", { rest: { rule: "wide", from: 0, keep: 0.9 } }));
V.push(C("chosen, wide 0.6", { rest: { rule: "wide", from: 0, keep: 0.6 } }));
V.push(C("chosen, third (docs formula)", { third: true }));
V.push(C("chosen, k2 budget 320", { k: 2, budget: 320 }));
const out = runAll(rec, V, SPLIT);
Deno.writeTextFileSync("results/round5.json", JSON.stringify(out));
console.log(table(out.slice(0, 8), null, "ROUND 5a: passive close-only exits against the taker exit, where the record prices both"));
const ch = out.find((s) => s.id === "chosen: exit inv5 all")!;
console.log(table(out.slice(8), ch, "ROUND 5b: the chosen structure (x1's exclusions, all picks, caps $320/$60 rf, invCap 5, taker exit 00:05, no stops) and one change at a time"));
