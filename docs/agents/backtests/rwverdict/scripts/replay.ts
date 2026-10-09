// RW's verdict, step b (the ledger's item 2; RW-NEXT Part 1.1, "(b) tests 'The rule'"): replay the stored `pm_rw_minutes`
// with the stored `pm_rw_prints` through the frozen rule, `stepRw` in `agents/pmrw.ts`, minute by minute in the engine's
// order (rows by market, settlement where the engine settled), and compare with the record: `pm_rw_fills` fill for fill,
// and each day's rewards with `pm_rw_days` to within $0.01. `stepRw` alone decides whether RW is void.
// With `--prints <file>` the prints are that file's (step c's full pull) instead of `pm_rw_prints`: the recomputation.
// deno run --allow-read --allow-write --no-check scripts/replay.ts [--prints data/prints_full.json] [--out results/x.json]
import { accStress, accTotal, newAcc, sizeN, stepRw, type Acc } from "../../../../../supabase/functions/agents/pmrw.ts";
import { printOrder, type PmPrint } from "../../../../../supabase/functions/_shared/polymarket_public.ts";
import { loadRecord, type Meta } from "../../rwc_opt/scripts/rec.ts";

const M = 60e3, DAY = 86400e3;
const arg = (n: string) => { const i = Deno.args.indexOf(n); return i < 0 ? null : Deno.args[i + 1]; };
const printsFile = arg("--prints"), outFile = arg("--out");
const early = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"].map((d) => `../pmlp/data/min_${d}.json`);
const mid = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map((d) => `../rwc_opt/data/rw_min_${d}.json`);
const rec = await loadRecord({ name: "RW", start: Date.UTC(2026, 8, 25), end: Date.UTC(2026, 9, 9), minFiles: [...early, ...mid, "data/rw_min_2026-10-08.json"], recordFile: "data/rw_record.json" });
if (printsFile) {
  // deno-lint-ignore no-explicit-any
  const full = JSON.parse(Deno.readTextFileSync(printsFile)) as any[];
  rec.prints = new Map();
  for (const p of full) (rec.prints.get(p.cond) ?? rec.prints.set(p.cond, []).get(p.cond)!).push({ id: p.id, ts: Number(p.ts), side: p.side, oi: Number(p.oi), price: Number(p.price), size: Number(p.size) } as PmPrint);
  for (const l of rec.prints.values()) l.sort(printOrder);
}
// Prints by minute bucket, read back as (t, t + 60 s], each market's in its own order (the engine's `minutePrints`).
const idx = new Map<string, PmPrint[]>();
for (const [c, l] of rec.prints) for (const p of l) { const k = `${c}|${Math.floor(p.ts / 60)}`; (idx.get(k) ?? idx.set(k, []).get(k)!).push(p); }
const printsAt = (c: string, t: number) => { const k = Math.floor(t / M); return [...(idx.get(`${c}|${k}`) ?? []), ...(idx.get(`${c}|${k + 1}`) ?? [])]; };

const accs = new Map<string, Acc>(), meta = new Map<string, Meta>();
const fills: Array<{ cond: string; minute: string; side: string; price: number; size: number; print_id: string }> = [];
const days: Array<{ day: string; total: number; stress: number; reward: number; fills: number }> = [];
const snap = (day: string) => {
  let total = 0, stress = 0, reward = 0, n = 0;
  for (const a of accs.values()) { total += accTotal(a); stress += accStress(a); reward += a.reward; n += a.fills; }
  days.push({ day, total, stress, reward, fills: n });
};
for (let t = rec.start; t <= rec.last; t += M) {
  if (t % DAY === 0 && t > rec.start) snap(new Date(t - DAY).toISOString().slice(0, 10));
  const day = new Date(Math.floor(t / DAY) * DAY).toISOString().slice(0, 10);
  if (t % DAY === 0) for (const m of rec.selection.get(day) ?? []) meta.set(m.cond, m);
  for (const r of rec.byMinute.get(t) ?? []) {
    const c = r.cond;
    if (!r.quoting && !accs.has(c)) continue;
    const acc = accs.get(c) ?? accs.set(c, newAcc()).get(c)!;
    if (acc.settled != null) continue;
    if (r.row && r.row[2] !== null && r.row[3] !== null) { acc.lastAb = r.row[2]; acc.lastAa = r.row[3]; }
    const mt = (rec.selection.get(day) ?? []).find((x) => x.cond === c) ?? meta.get(c);
    if (r.quoting && mt) {
      const out = stepRw(acc, t / 1000, r.row, r.tick, mt.v, mt.rate, sizeN(mt.minSize), printsAt(c, t));
      for (const f of out.fills) fills.push({ cond: c, minute: new Date(t).toISOString(), side: f.side, price: f.price, size: f.size, print_id: f.printId });
    } else if (r.row && r.row[2] !== null && r.row[3] !== null) acc.lastM = (r.row[2] + r.row[3]) / 2;
  }
  for (const x of rec.settle.get(t) ?? []) { const a = accs.get(x.cond); if (a && a.settled == null) a.settled = x.payout; }
}
snap(new Date(Math.floor(rec.last / DAY) * DAY).toISOString().slice(0, 10));

// Fill for fill: the record's against the replay's, keyed by market, minute and print, with side, price and size.
const key = (f: { cond: string; minute: string; print_id: string }) => `${f.cond}|${Date.parse(f.minute)}|${f.print_id}`;
const mine = new Map(fills.map((f) => [key(f), f]));
const theirs = new Map(rec.fills!.map((f) => [key(f), f]));
let same = 0, differ = 0;
const onlyRecord: string[] = [], onlyReplay: string[] = [], differing: string[] = [];
for (const [k, f] of theirs) {
  const g = mine.get(k);
  if (!g) { onlyRecord.push(k); continue; }
  if (g.side === f.side && Math.abs(g.price - f.price) < 1e-9 && Math.abs(g.size - f.size) < 1e-9) same++;
  else { differ++; differing.push(`${k}: record ${f.side} ${f.price} x ${f.size}, replay ${g.side} ${g.price} x ${g.size}`); }
}
for (const k of mine.keys()) if (!theirs.has(k)) onlyReplay.push(k);
const engine = new Map(JSON.parse(Deno.readTextFileSync("data/rw_record.json")).rwDays.map((d: { day: string }) => [String(d.day).slice(0, 10), d]));
let prev = { total: 0, reward: 0 }, prevE = { total: 0, reward: 0 }, worst = 0;
const dayLines: string[] = [];
for (const d of days) {
  // deno-lint-ignore no-explicit-any
  const e = engine.get(d.day) as any;
  if (!e) continue;
  const rewDay = d.reward - prev.reward, rewDayE = Number(e.reward) - prevE.reward;
  const gaps = [Math.abs(d.total - Number(e.total)), Math.abs(d.stress - Number(e.stress_total)), Math.abs(d.reward - Number(e.reward)), Math.abs(d.fills - Number(e.fills)), Math.abs(rewDay - rewDayE)];
  worst = Math.max(worst, ...gaps);
  dayLines.push(`${d.day} replay total ${d.total.toFixed(4)} stress ${d.stress.toFixed(4)} rewards ${d.reward.toFixed(4)} (day ${rewDay.toFixed(4)}) fills ${d.fills} | engine ${Number(e.total).toFixed(4)} ${Number(e.stress_total).toFixed(4)} ${Number(e.reward).toFixed(4)} (day ${rewDayE.toFixed(4)}) ${e.fills}`);
  prev = { total: d.total, reward: d.reward }; prevE = { total: Number(e.total), reward: Number(e.reward) };
}
const report = {
  prints: printsFile ?? "pm_rw_prints", minutes: rec.byMinute.size, last: new Date(rec.last).toISOString(),
  fills: { record: theirs.size, replay: mine.size, same, differ, onlyRecord: onlyRecord.length, onlyReplay: onlyReplay.length, examples: { onlyRecord: onlyRecord.slice(0, 10), onlyReplay: onlyReplay.slice(0, 10), differing: differing.slice(0, 10) } },
  daysWorstGapUsd: worst, days: dayLines, replayDays: days,
};
console.log(JSON.stringify({ ...report, replayDays: undefined }, null, 1));
if (outFile) Deno.writeTextFileSync(outFile, JSON.stringify(report, null, 1));
