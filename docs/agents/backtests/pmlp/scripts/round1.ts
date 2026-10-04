// Round 1: the structure at the live account's size on RW's record — the capital problem, the band, the exclusions, the budget.
import { loadRW } from "./rec.ts";
import { runAll, table } from "./exp.ts";
import type { Variant } from "./sim.ts";
const rec = loadRW();
const SPLIT = "2026-09-30";
const caps = (reduceFirst: boolean) => ({ total: 320, market: 60, reduceFirst });
const stops = { day: 25, total: 75 };
const live = (id: string, x: Partial<Variant> = {}): Variant => ({ id, budget: 160, maxMarkets: 8, caps: caps(true), stops, ...x });
const V: Variant[] = [
  // the record's own arms, no account limits: RW, RW-E's rule and x1's rule applied from day 1
  { id: "RW (all, no caps)", sameDayFrom: null, noWeatherFrom: null },
  { id: "RW-E rule (no caps)", noWeatherFrom: null },
  { id: "x1 rule (no caps)" },
  // x1's rule, the whole of its daily selection, under the live caps
  { id: "x1 all, caps buy-only", caps: caps(false), stops },
  { id: "x1 all, caps reduce-first", caps: caps(true), stops },
  // at the path's size: 8 markets, $160 of first quotes
  live("x1 8/$160 buy-only", { caps: caps(false) }),
  live("x1 8/$160 reduce-first"),
  live("x1 8/$160 no caps", { caps: undefined, stops: undefined }),
  live("x1 8/$160 rf, no stops", { stops: undefined }),
  // the band, at the path's size
  live("band >=$20", { rateMin: 20 }),
  live("band >=$50", { rateMin: 50 }),
  live("band >=$100", { rateMin: 100 }),
  live("band $10-50", { rateMax: 50 }),
  live("band $10-20", { rateMax: 20 }),
  live("band $20-100", { rateMin: 20, rateMax: 100 }),
  // the exclusions, at the path's size
  live("8/$160 keep weather", { noWeatherFrom: null }),
  live("8/$160 keep same-day", { sameDayFrom: null }),
  live("8/$160 keep both", { noWeatherFrom: null, sameDayFrom: null }),
  live("8/$160 + 48h horizon", { horizonH: 48 }),
  // the number of markets and the budget
  live("4/$80", { budget: 80, maxMarkets: 4 }),
  live("6/$120", { budget: 120, maxMarkets: 6 }),
  live("10/$200", { budget: 200, maxMarkets: 10 }),
  live("12/$240", { budget: 240, maxMarkets: 12 }),
  live("16/$300", { budget: 300, maxMarkets: 16 }),
  live("all x1 picks", { budget: undefined, maxMarkets: undefined }),
];
const out = runAll(rec, V, SPLIT);
Deno.writeTextFileSync("results/round1.json", JSON.stringify(out));
const base = out.find((s) => s.id === "x1 8/$160 reduce-first")!;
console.log(table(out, base, `ROUND 1 on RW's record 09-25 00:00 → ${new Date(rec.last).toISOString()} (h1 = 09-25..09-29, h2 = 09-30..10-04); differences against "x1 8/$160 reduce-first"`));
