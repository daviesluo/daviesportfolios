// Scratch: x1's own record by class, quoted after 09-28 vs only carried in; and the same for rw over its run.
import * as X from "./pmrw_x_ext.ts";
import { accStress, accTotal, RW_RUN_START, type Acc } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw.ts";
import { load } from "./load.ts";
const DAY = 86400e3, M = 60e3;
const { inputs, L } = load();
const frozen = JSON.parse(Deno.readTextFileSync("./classes_frozen.json"));
const latest = new Map<string, { q: string; cat: string | null }>();
for (const s of [...inputs.selection].sort((a, b) => String(a.day).localeCompare(String(b.day)))) if (String(s.day) >= "2026-09-25") latest.set(s.cond, { q: String(s.q ?? ""), cat: s.cat ?? null });
const re: Record<string, RegExp | null> = {}, cats: Record<string, string[]> = {};
for (const [k, v] of Object.entries(frozen.classes as Record<string, { q?: string; cat?: string[] }>)) { re[k] = v.q ? new RegExp(v.q, "i") : null; cats[k] = v.cat ?? []; }
const classOf = (c: string) => {
  const m = latest.get(c)!;
  for (const k of ["P", "V", "C", "F", "G"]) if ((re[k] && re[k]!.test(m.q)) || (m.cat !== null && cats[k].includes(m.cat))) return k;
  return m.cat === "weather_fees" ? "W" : "O";
};
const specs = X.RWX_SPECS.filter((s) => s.id === "x1").map((s) => ({ ...s }));
const st = X.newRwxState(specs);
X.replayArms(st, Date.parse("2026-09-27T23:59:00Z"), inputs, specs);
const at0928 = structuredClone(st.arms);
X.replayArms(st, L, inputs, specs);
type Row = { n: number; quoted: number; carried: number; tot: number; rew: number; fil: number; str: number; r04: number };
const agg = (id: string, base: Record<string, Acc>, quotedSince: (c: string) => boolean) => {
  const out: Record<string, Row> = {};
  for (const [c, a] of Object.entries(st.arms[id].acc)) {
    const b = base[c];
    if (b?.settled != null) continue;
    const k = classOf(c);
    const r = (out[k] ??= { n: 0, quoted: 0, carried: 0, tot: 0, rew: 0, fil: 0, str: 0, r04: 0 });
    const tot = accTotal(a) - (b ? accTotal(b) : 0), rew = a.reward - (b?.reward ?? 0);
    if (Math.abs(tot) < 1e-12 && Math.abs(accStress(a) - (b ? accStress(b) : 0)) < 1e-12) continue;
    r.n++; if (quotedSince(c)) r.quoted++; else r.carried++;
    r.tot += tot; r.rew += rew; r.fil += tot - rew; r.str += accStress(a) - (b ? accStress(b) : 0); r.r04 += tot - 0.6 * rew;
  }
  return out;
};
const qm = (id: string, base: Record<string, Acc>) => (c: string) => st.arms[id].acc[c].quotedMinutes > (base[c]?.quotedMinutes ?? 0);
const print = (title: string, o: Record<string, Row>) => {
  console.log(title);
  let T = { tot: 0, rew: 0, fil: 0, str: 0, r04: 0 };
  for (const k of ["P", "V", "C", "F", "G", "O", "W"]) {
    const r = o[k]; if (!r) continue;
    console.log(`  ${k}  markets ${String(r.n).padStart(3)} (quoted ${String(r.quoted).padStart(3)}, carried only ${String(r.carried).padStart(2)})  total ${r.tot.toFixed(2).padStart(9)}  rewards ${r.rew.toFixed(2).padStart(8)}  fills ${r.fil.toFixed(2).padStart(9)}  stress ${r.str.toFixed(2).padStart(8)}  R=0.4 ${r.r04.toFixed(2).padStart(8)}`);
    T = { tot: T.tot + r.tot, rew: T.rew + r.rew, fil: T.fil + r.fil, str: T.str + r.str, r04: T.r04 + r.r04 };
  }
  console.log(`  all total ${T.tot.toFixed(2)} rewards ${T.rew.toFixed(2)} fills ${T.fil.toFixed(2)} stress ${T.str.toFixed(2)} R=0.4 ${T.r04.toFixed(2)}`);
};
print(`x1, its own record 09-28 00:00 → ${new Date(L).toISOString()} (carried in at the 09-28 00:00 mark)`, agg("x1", at0928.x1.acc, qm("x1", at0928.x1.acc)));
print(`rw, its run 09-25 00:00 → L`, agg("rw", {}, qm("rw", {})));
// x1's carried-only markets, with their figures
console.log("x1's markets carried in at 09-28 and never quoted again, and every V market:");
for (const [c, a] of Object.entries(st.arms.x1.acc)) {
  const b = at0928.x1.acc[c];
  const k = classOf(c);
  const carriedOnly = b && b.settled == null && a.quotedMinutes === b.quotedMinutes;
  if (!(carriedOnly && (b.net !== 0)) && k !== "V") continue;
  const tot = accTotal(a) - (b ? accTotal(b) : 0);
  console.log(`  ${c.slice(0, 10)} ${k} net@0928 ${b ? b.net.toFixed(2) : "-"} settled ${a.settled} total since ${tot.toFixed(2)} | ${latest.get(c)!.q.slice(0, 80)}`);
}
