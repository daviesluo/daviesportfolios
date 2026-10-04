// Round 6: the passive exit (modelled) against the taker exit, on the chosen structure.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
const rec = loadRW();
const caps = (market = 60) => ({ total: 320, market, reduceFirst: true });
const C = (id: string, x: Partial<Variant> = {}): Variant => ({ id, caps: caps(), invCap: 5, ...x });
const V: Variant[] = [
  C("inv5 all, hold carried"),
  C("inv5 all, taker exit 00:05", { exitTaker: { afterMin: 5, feeRate: 0.05 } }),
  C("inv5 all, passive model 9.1/h, $0.018", { exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } }),
  C("inv5 all, passive model 4.5/h, $0.018", { exitPassiveModel: { sharesPerMin: 4.5 / 60, costPerShare: 0.018 } }),
  C("inv5 all, passive model 9.1/h, $0.04", { exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.04 } }),
  C("inv5 all, passive 9.1/h + taker 12:00", { exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, exitTaker: { afterMin: 720, feeRate: 0.05 } }),
  C("inv5 all cap100, passive 9.1/h", { caps: caps(100), exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 } }),
  C("inv5 all cap100, taker 00:05", { caps: caps(100), exitTaker: { afterMin: 5, feeRate: 0.05 } }),
];
const out = runAll(rec, V, "2026-09-30");
Deno.writeTextFileSync("results/round6.json", JSON.stringify(out));
console.log(table(out, out[0], "ROUND 6: carried positions held, sold by taker at 00:05, or worked off passively (a model: the measured reducing-fill rate and the record's average fill loss)"));
