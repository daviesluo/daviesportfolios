// Round 4: a factorial of the levers that survived rounds 1-3, every cell reported; chosen on h1 (09-25..09-29), read on h2.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
const rec = loadRW();
const SPLIT = "2026-09-30";
const caps = { total: 320, market: 60, reduceFirst: true };
const V: Variant[] = [];
for (const exit of [false, true]) for (const invCap of [3, 5]) for (const wide of [false, true]) for (const size of ["8/160", "all"]) for (const band of ["all", "<100", "20-100"]) {
  const id = `${exit ? "exit" : "hold"} inv${invCap} ${wide ? "w.9" : "rw"} ${size} ${band}`;
  V.push({
    id, caps, invCap,
    ...(exit ? { exitTaker: { afterMin: 5, feeRate: 0.05 } } : {}),
    ...(wide ? { rest: { rule: "wide" as const, from: 0, keep: 0.9 } } : {}),
    ...(size === "8/160" ? { budget: 160, maxMarkets: 8 } : {}),
    ...(band === "<100" ? { rateMax: 100 } : band === "20-100" ? { rateMin: 20, rateMax: 100 } : {}),
  });
}
const out = runAll(rec, V, SPLIT);
Deno.writeTextFileSync("results/round4.json", JSON.stringify(out));
console.log(table(out, out[0], `ROUND 4 (factorial, ${V.length} cells) on RW's record; x1's exclusions, caps $320/$60 reduce-first, no stops; differences against "${out[0].id}"`));
