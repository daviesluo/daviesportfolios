// The chosen rules on mini-pool's and mid-pool's own path records (their selections fixed: 8 markets a day in their bands).
import { loadPool } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
const caps = { total: 320, market: 60, reduceFirst: true };
for (const name of ["mini", "mid"] as const) {
  const rec = loadPool(name);
  const SPLIT = "2026-10-03";
  const V: Variant[] = [
    { id: `${name}: as recorded (RW rule, all 8)`, sameDayFrom: null, noWeatherFrom: null },
    { id: `${name}: chosen rules`, caps, invCap: 5, exitTaker: { afterMin: 5, feeRate: 0.05 } },
    { id: `${name}: chosen, invCap 3`, caps, exitTaker: { afterMin: 5, feeRate: 0.05 } },
    { id: `${name}: chosen, third`, caps, invCap: 5, exitTaker: { afterMin: 5, feeRate: 0.05 }, third: true },
  ];
  const out = runAll(rec, V, SPLIT);
  const days = (rec.last - rec.start) / 86400e3;
  console.log(table(out, null, `${name}: ${new Date(rec.start).toISOString()} → ${new Date(rec.last).toISOString()} (${days.toFixed(2)} days); its own selection; prints ${[...rec.prints.values()].reduce((s, l) => s + l.length, 0)}`));
  for (const s of out) console.log(`   ${s.id}: per day R=1 ${(s.all.tot / days).toFixed(2)}, R=0.4 ${(s.all.r04 / days).toFixed(2)}, rewards ${(s.all.rew / days).toFixed(2)}, fills ${(s.all.fil / days).toFixed(2)}`);
}
