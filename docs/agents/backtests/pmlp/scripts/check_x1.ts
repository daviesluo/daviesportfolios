import { loadRW } from "./rec.ts";
import { simulate } from "./sim.ts";
const rec = loadRW();
const x1 = simulate(rec, { id: "x1", sameDayFrom: Date.UTC(2026, 8, 27), noWeatherFrom: Date.UTC(2026, 8, 28) });
const e = simulate(rec, { id: "e", sameDayFrom: Date.UTC(2026, 8, 27), noWeatherFrom: null });
const prod: Record<string, number> = { "2026-09-25": 148.09, "2026-09-26": 219.72, "2026-09-27": 235.69, "2026-09-28": 396.86, "2026-09-29": 406.13, "2026-09-30": 673.87, "2026-10-01": 877.07, "2026-10-02": 918.06, "2026-10-03": 976.75 };
for (const d of x1.days) console.log(d.day, "x1 sim", d.total.toFixed(2), "prod", prod[d.day]?.toFixed(2) ?? "-", "| e sim", e.days.find((x) => x.day === d.day)!.total.toFixed(2));
