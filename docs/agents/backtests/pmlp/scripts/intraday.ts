// RW's recorded reward by hour of the UTC day (its selection lands at 00:00): is the selection's promise spent early?
import { loadRW } from "./rec.ts";
const rec = loadRW();
const byHour = new Array(24).fill(0), quotedByHour = new Array(24).fill(0), zeroByHour = new Array(24).fill(0);
for (const [t, rows] of rec.byMinute) {
  if (t + 86400e3 > rec.last + 60e3 && new Date(t).toISOString().slice(0, 10) === new Date(rec.last).toISOString().slice(0, 10)) continue; // whole days only
  const h = new Date(t).getUTCHours();
  for (const r of rows) {
    if (!r.quoting || !r.rec || r.rec.b === null) continue;
    quotedByHour[h]++;
    byHour[h] += r.rec.reward ?? 0;
    if (!(r.rec.reward && r.rec.reward > 0)) zeroByHour[h]++;
  }
}
const tot = byHour.reduce((s, x) => s + x, 0);
console.log("hour  reward  share  quoted-minutes  zero-reward %");
for (let h = 0; h < 24; h++) console.log(`${String(h).padStart(2)}  ${byHour[h].toFixed(2).padStart(7)} ${(100 * byHour[h] / tot).toFixed(1).padStart(5)}% ${String(quotedByHour[h]).padStart(8)} ${(100 * zeroByHour[h] / quotedByHour[h]).toFixed(1).padStart(6)}%`);
