// Scratch only, never committed: the three paper records (RW's pm_rw_*, mini-pool's pm_live_* + pm_prep_prints, mid-pool's
// pm_mid_* + pm_midprep_prints), dumped read-only, in one shape for the simulator.
import type { BookRow } from "../../../../../supabase/functions/agents/pmrw.ts";
import { printOrder, type PmPrint } from "../../../../../supabase/functions/_shared/polymarket_public.ts";

export const DIR = "data";
const M = 60e3, DAY = 86400e3;
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
  selection: Map<string, Meta[]>;        // day -> the record's selection that day (rank order)
  byMinute: Map<number, Row[]>;          // minute -> rows, sorted by cond
  prints: Map<string, PmPrint[]>;        // cond -> prints sorted (printOrder)
  settle: Map<number, Array<{ cond: string; payout: number }>>;   // minute after which a market is settled
  settleOf: Map<string, { payout: number; at: number }>;
  fills?: Array<{ cond: string; minute: string; side: "bid" | "ask"; price: number; size: number; print_id: string }>;
};
const dayStr = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);

function islands(p: Any, nf: number, each: (cond: string, minute: number, f: string[]) => void) {
  for (const line of (p.data as string).split(";")) {
    const i1 = line.indexOf(","), i2 = line.indexOf(",", i1 + 1), i3 = line.indexOf(",", i2 + 1);
    const ci = Number(line.slice(0, i1)), m0 = Number(line.slice(i1 + 1, i2)), n = Number(line.slice(i2 + 1, i3)), f = line.slice(i3 + 1).split("|");
    if (f.length !== nf) throw new Error(`bad row ${line.slice(0, 80)}`);
    for (let k = 0; k < n; k++) each(p.conds[ci], (m0 + k) * M, f);
  }
}
const toPrint = (p: Any): PmPrint => ({ id: p.id, ts: Date.parse(p.ts) / 1000, side: p.side, oi: Number(p.oi), price: Number(p.price), size: Number(p.size) });

export function loadRW(): Rec {
  const small = JSON.parse(Deno.readTextFileSync(`${DIR}/small.json`));
  const days = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  const byMinute = new Map<number, Row[]>();
  let last = 0;
  for (const d of days) {
    const p = JSON.parse(Deno.readTextFileSync(`${DIR}/min_${d}.json`));
    islands(p, 12, (cond, t, f) => {
      const bb = num(f[2]), ba = num(f[3]);
      const row: BookRow | null = bb === null || ba === null ? null : [bb, ba, num(f[4]), num(f[5]), Number(f[6] || 0), Number(f[7] || 0)];
      (byMinute.get(t) ?? byMinute.set(t, []).get(t)!).push({ cond, quoting: f[0] === "1", tick: Number(f[1]) || 0.01, row, rec: { m: num(f[8]), b: num(f[9]), a: num(f[10]), reward: num(f[11]) } });
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
  const fills = small.fills.filter((f: Any) => f.minute >= "2026-09-25").map((f: Any) => ({ cond: f.cond, minute: f.minute, side: f.side, price: Number(f.price), size: Number(f.size), print_id: f.print_id }));
  return { name: "RW", start: Date.UTC(2026, 8, 25), last, days, selection, byMinute, prints, settle, settleOf, fills };
}

/** Mini-pool's or mid-pool's record: the path's own minutes (dry-run), its selections and the layer's prints. */
export function loadPool(name: "mini" | "mid"): Rec {
  const p = JSON.parse(Deno.readTextFileSync(`${DIR}/${name}.json`));
  const selection = new Map<string, Meta[]>();
  for (const m of p.markets as Any[]) {
    if (m.reward_rate == null || m.max_spread == null) continue;      // 0074's placeholders
    const day = String(m.day).slice(0, 10);
    (selection.get(day) ?? selection.set(day, []).get(day)!).push({
      cond: m.cond, day, rate: Number(m.reward_rate), v: Number(m.max_spread), minSize: Number(m.min_size), tick: Number(m.tick), end: m.end_date ?? null,
      cat: null, q: String(m.question ?? ""), perDollarDay: m.per_dollar_day == null ? null : Number(m.per_dollar_day), capital: m.capital == null ? null : Number(m.capital), rank: Number(m.rank),
    });
  }
  for (const l of selection.values()) l.sort((a, b) => a.rank - b.rank);
  const inSel = (cond: string, t: number) => (selection.get(dayStr(t)) ?? []).some((s) => s.cond === cond);
  const byMinute = new Map<number, Row[]>();
  let start = Infinity, last = 0;
  islands(p, 17, (cond, t, f) => {
    const bb = num(f[4]), ba = num(f[5]);
    const row: BookRow | null = bb === null || ba === null ? null : [bb, ba, num(f[6]), num(f[7]), Number(f[8] || 0), Number(f[9] || 0)];
    (byMinute.get(t) ?? byMinute.set(t, []).get(t)!).push({ cond, quoting: inSel(cond, t), tick: Number(f[3]) || 0.01, row });
    if (t < start) start = t;
    if (t > last) last = t;
  });
  for (const l of byMinute.values()) l.sort((x, y) => (x.cond < y.cond ? -1 : x.cond > y.cond ? 1 : 0));
  const prints = new Map<string, PmPrint[]>();
  for (const x of p.prints ?? []) (prints.get(x.cond) ?? prints.set(x.cond, []).get(x.cond)!).push(toPrint(x));
  for (const l of prints.values()) l.sort(printOrder);
  const days = [...selection.keys()].filter((d) => Date.parse(`${d}T00:00:00Z`) + DAY > start).sort();
  return { name, start: Math.floor(start / M) * M, last, days, selection, byMinute, prints, settle: new Map(), settleOf: new Map() };
}
