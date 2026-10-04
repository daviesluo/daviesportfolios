// Scratch only, never committed: RW's stored record (read-only dumps of pm_rw_* and pm_rw_x_*) as RW-X's replay reads it.
import type { RweDayRow, RweFillRow, RweInputs, RweMinuteRow, RwePrintRow, RweSelRow, RweSettlement } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw_e.ts";

const DIR = "/tmp/claude-0/-home-user-daviesportfolios/66f2e96b-1f9a-594f-8046-5bffba951be8/scratchpad/rw_counts/data";
const DAYS = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
const num = (s: string) => (s === "" ? null : Number(s));

// deno-lint-ignore no-explicit-any
type Any = any;
export type Loaded = { inputs: RweInputs; xDays: Any[]; eDays: Any[]; xstate: Any; L: number };

export function load(): Loaded {
  const small = JSON.parse(Deno.readTextFileSync(`${DIR}/small.json`));
  const rows: RweMinuteRow[] = [];
  let last: Any = null;
  for (const d of DAYS) {
    const p = JSON.parse(Deno.readTextFileSync(`${DIR}/min_${d}.json`));
    if (d === "2026-10-04") last = p;
    for (const line of (p.data as string).split(";")) {
      const [ci, m0, n, t] = [line.slice(0, line.indexOf(",")), ...line.slice(line.indexOf(",") + 1).split(",", 3)];
      const f = t.split("|");
      if (f.length !== 12) throw new Error(`bad row ${line}`);
      const cond = p.conds[Number(ci)];
      for (let k = 0; k < Number(n); k++) {
        rows.push({
          cond, minute: new Date((Number(m0) + k) * 60e3).toISOString(), quoting: f[0] === "1", tick: Number(f[1]),
          bb: num(f[2]), ba: num(f[3]), ab: num(f[4]), aa: num(f[5]), q1: num(f[6]), q2: num(f[7]), m: num(f[8]), b: num(f[9]), a: num(f[10]), reward: num(f[11]),
        });
      }
    }
  }
  // fills and prints: the full dump, plus what the last chunk read after it (deduplicated by key)
  const fills = new Map<string, RweFillRow>();
  for (const f of [...small.fills, ...(last.fills ?? [])]) fills.set(`${f.cond}|${f.minute}|${f.print_id}`, f);
  const prints = new Map<string, RwePrintRow>();
  for (const p of [...small.prints, ...(last.prints ?? [])]) prints.set(p.id, p);
  const L = Date.parse(last.xstate.last_minute);
  return {
    inputs: {
      rows, fills: [...fills.values()], prints: [...prints.values()], selection: small.selection as RweSelRow[],
      settlements: last.settlements as RweSettlement[], rwDays: small.rwDays as RweDayRow[],
    },
    xDays: last.xDays, eDays: small.eDays, xstate: last.xstate.state, L,
  };
}
