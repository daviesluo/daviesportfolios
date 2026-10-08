// RWC-OPT's loader (reviews/2026-10-09-rwc-optimised-arms-prereg.md): one run of RW's engine as the simulator reads it,
// from files pulled read-only out of that run's tables. RW's run (`pm_rw_*`, 2026-09-25 -> 10-09) and RW-C's run
// (`pm_rwc_*`, 2026-10-09 -> 10-23) have the same columns, so one loader serves both: `sql/pull_minutes.sql` writes a
// day's minutes as islands (one line per run of identical rows), `sql/pull_record.sql` the run's selections, prints,
// fills, settlements and day rows; `scripts/grab.py` and `scripts/grab_payload.py` cut them out of the connector's saved
// replies. The record starts flat at `start` (RW-C's warm-up day is not read) and ends at the last minute stored.
import type { BookRow } from "../../../../../supabase/functions/agents/pmrw.ts";
import { printOrder, type PmPrint } from "../../../../../supabase/functions/_shared/polymarket_public.ts";

const M = 60e3;
const num = (s: string) => (s === "" ? null : Number(s));
// deno-lint-ignore no-explicit-any
type Any = any;

/** A market as a day's selection took it. */
export type Meta = {
  cond: string; day: string; rate: number; v: number; minSize: number; tick: number; end: string | null; cat: string | null; q: string;
  perDollarDay: number | null; capital: number | null; rank: number;
};
/** One recorded market-minute: the book as RW's rule reads it, and whether the record's own selection quoted it. */
export type Row = { cond: string; quoting: boolean; tick: number; row: BookRow | null; rec?: { m: number | null; b: number | null; a: number | null; reward: number | null } };
export type Rec = {
  name: string; start: number; last: number;
  days: string[];
  selection: Map<string, Meta[]>;
  byMinute: Map<number, Row[]>;
  prints: Map<string, PmPrint[]>;
  settle: Map<number, Array<{ cond: string; payout: number }>>;
  settleOf: Map<string, { payout: number; at: number }>;
  fills?: Array<{ cond: string; minute: string; side: "bid" | "ask"; price: number; size: number; print_id: string }>;
  engineDays: Array<{ day: string; total: number; stress_total: number; reward: number; fills: number }>;
};

/** Each island of a day's file: `ci,m0,count,f1|…|f12` is `count` minutes of market `conds[ci]` from minute index m0. */
function islands(p: Any, nf: number, each: (cond: string, minute: number, f: string[]) => void) {
  for (const line of (p.data as string).split(";")) {
    const i1 = line.indexOf(","), i2 = line.indexOf(",", i1 + 1), i3 = line.indexOf(",", i2 + 1);
    const ci = Number(line.slice(0, i1)), m0 = Number(line.slice(i1 + 1, i2)), n = Number(line.slice(i2 + 1, i3)), f = line.slice(i3 + 1).split("|");
    if (f.length !== nf) throw new Error(`bad row ${line.slice(0, 80)}`);
    for (let k = 0; k < n; k++) each(p.conds[ci], (m0 + k) * M, f);
  }
}
/** A JSON input, from its file, or gzipped beside it (`<file>.gz`, as committed). */
async function readJson(f: string): Promise<Any> {
  try { return JSON.parse(Deno.readTextFileSync(f)); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  const file = await Deno.open(`${f}.gz`);
  return JSON.parse(await new Response(file.readable.pipeThrough(new DecompressionStream("gzip"))).text());
}
const toPrint = (p: Any): PmPrint => ({ id: p.id, ts: Date.parse(p.ts) / 1000, side: p.side, oi: Number(p.oi), price: Number(p.price), size: Number(p.size) });

/**
 * A run's record: `minFiles` (one per UTC day, any order), `recordFile` (selection, prints, fills, settlements, the
 * engine's day rows), every minute from `start` (inclusive) to `end` (exclusive) kept.
 */
export async function loadRecord(o: { name: string; start: number; end: number; minFiles: string[]; recordFile: string }): Promise<Rec> {
  const small = await readJson(o.recordFile);
  const byMinute = new Map<number, Row[]>();
  let last = 0;
  for (const f of o.minFiles) {
    const p = await readJson(f);
    islands(p, 12, (cond, t, x) => {
      if (t < o.start || t >= o.end) return;
      const bb = num(x[2]), ba = num(x[3]);
      const row: BookRow | null = bb === null || ba === null ? null : [bb, ba, num(x[4]), num(x[5]), Number(x[6] || 0), Number(x[7] || 0)];
      (byMinute.get(t) ?? byMinute.set(t, []).get(t)!).push({ cond, quoting: x[0] === "1", tick: Number(x[1]) || 0.01, row, rec: { m: num(x[8]), b: num(x[9]), a: num(x[10]), reward: num(x[11]) } });
      if (t > last) last = t;
    });
  }
  for (const l of byMinute.values()) l.sort((x, y) => (x.cond < y.cond ? -1 : x.cond > y.cond ? 1 : 0));
  const selection = new Map<string, Meta[]>();
  for (const s of [...small.selection].sort((a: Any, b: Any) => String(a.day).localeCompare(String(b.day)) || Number(a.rank) - Number(b.rank))) {
    const day = String(s.day).slice(0, 10);
    (selection.get(day) ?? selection.set(day, []).get(day)!).push({
      cond: s.cond, day, rate: Number(s.rate), v: Number(s.v), minSize: Number(s.min_size), tick: Number(s.tick), end: s.end_date ?? null, cat: s.cat ?? null,
      q: String(s.q ?? ""), perDollarDay: s.per_dollar_day == null ? null : Number(s.per_dollar_day), capital: s.capital == null ? null : Number(s.capital), rank: Number(s.rank),
    });
  }
  const prints = new Map<string, PmPrint[]>();
  for (const p of small.prints) (prints.get(p.cond) ?? prints.set(p.cond, []).get(p.cond)!).push(toPrint(p));
  for (const l of prints.values()) l.sort(printOrder);
  const settle = new Map<number, Array<{ cond: string; payout: number }>>(), settleOf = new Map<string, { payout: number; at: number }>();
  for (const s of small.settlements) {
    const t = Math.floor(Date.parse(s.settled_at) / M) * M - 2 * M;
    (settle.get(t) ?? settle.set(t, []).get(t)!).push({ cond: s.cond, payout: Number(s.payout) });
    settleOf.set(s.cond, { payout: Number(s.payout), at: t });
  }
  const startDay = new Date(o.start).toISOString().slice(0, 10);
  const fills = (small.fills ?? []).filter((f: Any) => String(f.minute).slice(0, 10) >= startDay)
    .map((f: Any) => ({ cond: f.cond, minute: f.minute, side: f.side, price: Number(f.price), size: Number(f.size), print_id: f.print_id }));
  const engineDays = (small.rwDays ?? []).filter((d: Any) => String(d.day).slice(0, 10) >= startDay)
    .map((d: Any) => ({ day: String(d.day).slice(0, 10), total: Number(d.total), stress_total: Number(d.stress_total), reward: Number(d.reward), fills: Number(d.fills) }));
  const days = [...new Set([...byMinute.keys()].map((t) => new Date(t).toISOString().slice(0, 10)))].sort();
  return { name: o.name, start: o.start, last, days, selection, byMinute, prints, settle, settleOf, fills, engineDays };
}

const PMLP = "../pmlp/data";
const DATA = "data";
/** RW's run, 2026-09-25 00:00 -> 10-08 23:10 UTC as pulled: 09-25 -> 10-03 from live-prep's committed inputs, the rest from here; each
 * read from its .json, or from the .json.gz committed beside it. Run from this folder. */
export function loadRW(): Promise<Rec> {
  const early = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"].map((d) => `${PMLP}/min_${d}.json`);
  const late = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) => `${DATA}/rw_min_${d}.json`);
  return loadRecord({ name: "RW", start: Date.UTC(2026, 8, 25), end: Date.UTC(2026, 9, 9), minFiles: [...early, ...late], recordFile: `${DATA}/rw_record.json` });
}
/** RW-C's run, 2026-10-09 00:00 -> 10-23 00:00 UTC, pulled by the same statements from `pm_rwc_*` into `data/rwc_*`. */
export function loadRWC(): Promise<Rec> {
  const days: string[] = [];
  for (let t = Date.UTC(2026, 9, 9); t < Date.UTC(2026, 9, 23); t += 86400e3) days.push(new Date(t).toISOString().slice(0, 10));
  return loadRecord({ name: "RW-C", start: Date.UTC(2026, 9, 9), end: Date.UTC(2026, 9, 23), minFiles: days.map((d) => `${DATA}/rwc_min_${d}.json`), recordFile: `${DATA}/rwc_record.json` });
}
