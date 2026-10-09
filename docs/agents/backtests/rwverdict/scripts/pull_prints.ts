// RW's verdict, step c (RW-NEXT Part 1.1, "(c) tests 'Timing'"): pull every quoted market's prints for the run again
// from the data API's `/v2/trades` with the engine's own reader (`pmPrints`), each market's read carrying a parameter no
// earlier read carried (`_`, a clock that never repeats), back to that market's first quoted minute; then compare, minute
// by quoted minute, the prints in (t, t + 60 s] with `pm_rw_prints`. Writes data/prints_full.json (every pulled print
// of a quoted minute, the stored ones' ids kept) and results/prints_check.json.
// deno run --allow-read --allow-write --allow-net --no-check scripts/pull_prints.ts
import { pmPrints, type PmPrint } from "../../../../../supabase/functions/_shared/polymarket_public.ts";
import { loadRecord } from "../../rwc_opt/scripts/rec.ts";

const M = 60e3;
const early = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"].map((d) => `../pmlp/data/min_${d}.json`);
const mid = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map((d) => `../rwc_opt/data/rw_min_${d}.json`);
const rec = await loadRecord({ name: "RW", start: Date.UTC(2026, 8, 25), end: Date.UTC(2026, 9, 9), minFiles: [...early, ...mid, "data/rw_min_2026-10-08.json"], recordFile: "data/rw_record.json" });
// Every market's quoted minutes.
const quoted = new Map<string, Set<number>>();
for (const [t, rows] of rec.byMinute) for (const r of rows) if (r.quoting) (quoted.get(r.cond) ?? quoted.set(r.cond, new Set()).get(r.cond)!).add(t);
let tick = Date.now();
const clock = () => ++tick;
const full: Array<PmPrint & { cond: string }> = [];
const perMarket: Record<string, { quotedMinutes: number; pulled: number; inQuoted: number; stored: number; missed: number; extra: number; complete: boolean }> = {};
let i = 0;
for (const [cond, mins] of [...quoted].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const first = Math.min(...mins);
  let got: { prints: PmPrint[]; complete: boolean } | null = null;
  for (let attempt = 0; attempt < 4 && !got; attempt++) {
    try { got = await pmPrints(cond, Math.floor(first / 1000) - 60, { maxPages: 400, clock, timeoutMs: 30_000 }); } catch (e) { console.error(`${cond.slice(0, 10)} attempt ${attempt}: ${(e as Error).message}`); await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); }
  }
  if (!got) throw new Error(`could not read ${cond}`);
  // A print at second s belongs to the quoted minute t when t < s <= t + 60: the minute floor((s - 1) / 60) of its second.
  const quotedPrint = (p: PmPrint) => mins.has(Math.floor((p.ts - 1) / 60) * M);
  const pulledQ = got.prints.filter(quotedPrint);
  const storedQ = (rec.prints.get(cond) ?? []).filter(quotedPrint);
  const storedIds = new Set(storedQ.map((p) => p.id)), pulledIds = new Set(pulledQ.map((p) => p.id));
  const missed = pulledQ.filter((p) => !storedIds.has(p.id)), extra = storedQ.filter((p) => !pulledIds.has(p.id));
  perMarket[cond] = { quotedMinutes: mins.size, pulled: got.prints.length, inQuoted: pulledQ.length, stored: storedQ.length, missed: missed.length, extra: extra.length, complete: got.complete };
  // The full set for the recomputation: every pulled print of a quoted minute, and any stored one the pull did not return.
  for (const p of pulledQ) full.push({ ...p, cond });
  for (const p of extra) full.push({ ...p, cond });
  if (++i % 20 === 0) console.error(`${i}/${quoted.size} markets`);
}
const tot = Object.values(perMarket).reduce((s, x) => ({ inQuoted: s.inQuoted + x.inQuoted, stored: s.stored + x.stored, missed: s.missed + x.missed, extra: s.extra + x.extra, incomplete: s.incomplete + (x.complete ? 0 : 1) }), { inQuoted: 0, stored: 0, missed: 0, extra: 0, incomplete: 0 });
const out = { pulledAt: new Date().toISOString(), markets: quoted.size, ...tot, perMarket };
Deno.writeTextFileSync("data/prints_full.json", JSON.stringify(full));
Deno.writeTextFileSync("results/prints_check.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, perMarket: Object.fromEntries(Object.entries(perMarket).filter(([, x]) => x.missed || x.extra || !x.complete)) }, null, 1));
