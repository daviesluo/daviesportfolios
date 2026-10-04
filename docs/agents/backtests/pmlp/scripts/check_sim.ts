import { loadRW } from "./rec.ts";
import { rwFullResim, simulate } from "./sim.ts";
import { accTotal } from "../../../../../supabase/functions/agents/pmrw.ts";
const t0 = performance.now();
const rec = loadRW();
console.log(`RW record: ${rec.byMinute.size} minutes to ${new Date(rec.last).toISOString()}, ${rec.prints.size} markets with prints, ${rec.settleOf.size} settlements, loaded in ${(performance.now() - t0).toFixed(0)} ms`);
const full = rwFullResim(rec);
console.log(`stepRw full re-sim (RW's rule, every quoting minute): total ${full.total.toFixed(2)} stress ${full.stress.toFixed(2)} rewards ${full.reward.toFixed(2)}`);
// the simulator with RW's settings: no exclusions, the whole selection, k 1, 3N, RW's min, no caps
const s = simulate(rec, { id: "rw", sameDayFrom: null, noWeatherFrom: null });
console.log(`simulator, RW's settings: total ${s.end.total.toFixed(2)} stress ${s.end.stress.toFixed(2)} rewards ${s.end.reward.toFixed(2)}`);
let gap = 0;
for (const [c, a] of full.accs) gap = Math.max(gap, Math.abs(accTotal(a) - s.perMarket[c].total));
console.log(`largest per-market gap simulator vs stepRw: ${gap}`);
// recorded RW (from the decided minutes): rewards in the record, and RW's own day rows
const small = JSON.parse(Deno.readTextFileSync("data/small.json"));
const rwDays = small.rwDays.filter((d: { day: string }) => d.day >= "2026-09-25");
let recReward = 0;
for (const rows of rec.byMinute.values()) for (const r of rows) if (r.rec?.reward) recReward += r.rec.reward;
console.log(`RW recorded: rewards in pm_rw_minutes ${recReward.toFixed(2)}; last closed day ${rwDays.at(-1).day} total ${Number(rwDays.at(-1).total).toFixed(2)}`);
const d03 = s.days.find((d) => d.day === "2026-10-03")!;
console.log(`simulator at the 10-03 close: total ${d03.total.toFixed(2)} stress ${d03.stress.toFixed(2)} rewards ${d03.reward.toFixed(2)} (RW's row: ${Number(rwDays.at(-1).total).toFixed(2)} / ${Number(rwDays.at(-1).stress_total).toFixed(2)} / ${Number(rwDays.at(-1).reward).toFixed(2)})`);
// fills: the re-sim's against the recorded fills
let recFills = 0; for (const f of rec.fills!) recFills++;
console.log(`recorded fills ${recFills}; done in ${(performance.now() - t0).toFixed(0)} ms`);
