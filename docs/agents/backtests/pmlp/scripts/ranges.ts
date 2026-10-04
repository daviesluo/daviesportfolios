import { boot } from "./exp.ts";
const r11 = JSON.parse(Deno.readTextFileSync("results/round11.json"));
const days = 9.0 + (15 * 60 + 12) / 1440;   // 09-25 00:00 -> 10-04 15:12
for (const id of ["S1", "S1, fills at our price too"]) {
  const s = r11.find((x: { id: string }) => x.id === id);
  const d1 = s.daily.map((d: { tot: number }) => d.tot), d4 = s.daily.map((d: { r04: number }) => d.r04), ds = s.daily.map((d: { str: number }) => d.str);
  const b1 = boot(d1), b4 = boot(d4), bs = boot(ds);
  const per = (x: number) => (x / days).toFixed(1);
  console.log(`${id}: per day R=1 ${per(s.all.tot)} [${per(b1.p5)}, ${per(b1.p95)}]; R=0.4 ${per(s.all.r04)} [${per(b4.p5)}, ${per(b4.p95)}] P>0 ${b4.pos}; stress ${per(s.all.str)} [${per(bs.p5)}, ${per(bs.p95)}]; worst day R=0.4 ${Math.min(...d4).toFixed(2)}, best ${Math.max(...d4).toFixed(2)}`);
}
