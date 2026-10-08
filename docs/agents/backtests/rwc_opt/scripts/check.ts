// RWC-OPT's first check, run before the bar: the simulator at RW's own settings (the record's whole selection, no
// exclusion, no account) reproduces the engine's own day rows, day by day, to within $0.01 in total, stress and rewards.
// `deno run --allow-read --no-check scripts/check.ts rw|rwc` from this folder. Exit code 1 when it does not.
import { loadRW, loadRWC } from "./rec.ts";
import { simulate } from "./sim.ts";

const which = Deno.args[0];
const rec = which === "rw" ? await loadRW() : which === "rwc" ? await loadRWC() : (() => { throw new Error("usage: check.ts rw|rwc"); })();
const s = simulate(rec, { id: "engine", sameDayFrom: null, noWeatherFrom: null });
const own = new Map(rec.engineDays.map((d) => [d.day, d]));
let gap = 0, checked = 0;
for (const d of s.days) {
  const e = own.get(d.day);
  if (!e) { console.log(`${d.day} simulator ${d.total.toFixed(2)} engine row: none (open day)`); continue; }
  const g = Math.max(Math.abs(d.total - e.total), Math.abs(d.stress - e.stress_total), Math.abs(d.reward - e.reward));
  gap = Math.max(gap, g); checked++;
  console.log(`${d.day} simulator ${d.total.toFixed(2)} / ${d.stress.toFixed(2)} / ${d.reward.toFixed(2)}  engine ${e.total.toFixed(2)} / ${e.stress_total.toFixed(2)} / ${e.reward.toFixed(2)}`);
}
console.log(`${rec.name}: ${checked} closed days checked, largest gap $${gap.toExponential(2)}: ${gap < 0.01 ? "PASS" : "FAIL"}`);
if (gap >= 0.01) Deno.exit(1);
