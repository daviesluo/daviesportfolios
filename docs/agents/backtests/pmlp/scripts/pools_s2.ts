// S2's quoting and account rules on mini-pool's and mid-pool's own records (their selections fixed).
import { loadPool } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
for (const name of ["mini", "mid"] as const) {
  const rec = loadPool(name);
  const days = (rec.last - rec.start) / 86400e3;
  const R: Partial<Variant> = { sameDayFrom: null, noWeatherFrom: null };
  const V: Variant[] = [
    { id: `${name}: RW's rule as recorded (no caps)`, ...R },
    { id: `${name}: path as built (buy-only, 3N, 320/60, fills stops)`, ...R, caps: { total: 320, market: 60, reduceFirst: false }, stops: { day: 25, total: 75 } },
    { id: `${name}: S2's rules`, ...R, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 } },
  ];
  const out = runAll(rec, V, "2026-10-03");
  console.log(table(out, null, `${name}'s record (${days.toFixed(2)} days)`));
  for (const s of out) console.log(`   ${s.id}: per day R=1 ${(s.all.tot / days).toFixed(2)}, R=0.4 ${(s.all.r04 / days).toFixed(2)}`);
}
