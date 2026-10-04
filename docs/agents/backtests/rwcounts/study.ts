// Scratch only, never committed. x1 (RW-X's "variant-2") less the count-market classes frozen in classes_frozen.json,
// replayed by RW-X's own code (pmrw_x_ext.ts: pmrw_x.ts plus one exclusion hook) on RW's stored record, read-only.
import * as X from "./pmrw_x_ext.ts";
import { accStress, accTotal, RW_RUN_START, type Acc } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw.ts";
import { metaFor } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw_e.ts";
import { load } from "./load.ts";

const H = 3600e3, M = 60e3, DAY = 86400e3;
const t0 = performance.now();
const { inputs, xstate, L } = load();
const frozen = JSON.parse(Deno.readTextFileSync("./classes_frozen.json"));

// ---- class membership: a market's latest selection row from RW's first day, as classes.py listed them
const latest = new Map<string, { q: string; cat: string | null }>();
for (const s of [...inputs.selection].sort((a, b) => String(a.day).localeCompare(String(b.day)))) {
  if (String(s.day).slice(0, 10) >= "2026-09-25") latest.set(s.cond, { q: String(s.q ?? ""), cat: s.cat ?? null });
}
const CL: Record<string, { q?: RegExp; cat?: string[] }> = {};
for (const [k, v] of Object.entries(frozen.classes as Record<string, { q?: string; cat?: string[] }>)) CL[k] = { q: v.q ? new RegExp(v.q, "i") : undefined, cat: v.cat };
const member = (cls: string, c: string) => {
  if (cls === "ALL") return true;
  const m = latest.get(c);
  if (!m) return false;
  const d = CL[cls];
  return (!!d.q && d.q.test(m.q)) || (!!d.cat && m.cat !== null && d.cat.includes(m.cat));
};
const classOf = (c: string) => ["P", "V", "C", "F", "G"].find((k) => member(k, c)) ?? (latest.get(c)?.cat === "weather_fees" ? "W" : "O");
// check the members against the frozen lists
for (const [cls, list] of Object.entries(frozen.members as Record<string, string[][]>)) {
  if (!CL[cls]) continue;
  const mine = [...latest.keys()].filter((c) => member(cls, c)).map((c) => c.slice(0, 10)).sort().join();
  if (mine !== list.map((x) => x[0]).sort().join()) throw new Error(`class ${cls} differs from the frozen list`);
}

// ---- the arms
const base = Object.fromEntries(X.RWX_SPECS.map((s) => [s.id, s]));
const strip = (s: X.RwxSpec): X.RwxSpec => { const { seed: _s, ...rest } = s; return rest; };
const skipOf = (classes: string[], lateH: number | null) => (c: string, t: number) => {
  if (!classes.some((k) => member(k, c))) return false;
  if (lateH === null) return true;
  const end = metaFor(inputs.selection, c, t)?.end_date;
  return end ? t >= Date.parse(end) - lateH * H : false;
};
const specs: X.RwxSpec[] = [
  strip(base.e), strip(base.x1), strip(base.x4), strip(base.x5),
];
const fam: Record<string, string> = { e: "e", x1: "x1", x4: "x4", x5: "x5" };   // arm -> reference arm
for (const [id, parts] of Object.entries({ ...(frozen.arms as Record<string, string[]>), ...(frozen.exploratory?.arms ?? {}) } as Record<string, string[]>)) {
  const classes = parts.filter((p) => !p.startsWith("late"));
  const late = parts.find((p) => p.startsWith("late"));
  const lateH = late ? Number(late.slice(4)) : null;
  const ref = id.split("-")[0];
  const s: X.RwxSpec = ref === "rw"
    ? { id, noSameDayFrom: null, from: RW_RUN_START }
    : { ...strip(base[ref]), id };
  s.skip = skipOf(classes, lateH);
  specs.push(s);
  fam[id] = ref;
}
for (const [id, keep] of Object.entries(frozen.x4_diagnostics.arms as Record<string, number>)) {
  const s = strip(base.x4);
  specs.push({ ...s, id, rest: { rule: "wide", from: X.RWX_REST_START, keep } });
  fam[id] = "x4";
}

// ---- replay in legs, the accounts snapshotted at every UTC day's end, at x4's first minute and at L
const cuts = new Set<number>();
for (let d = RW_RUN_START; d + DAY - M < L; d += DAY) cuts.add(d + DAY - M);
cuts.add(X.RWX_REST_START - M);
cuts.add(L);
const st = X.newRwxState(specs);
const snaps = new Map<number, Record<string, Record<string, Acc>>>();
for (const cut of [...cuts].sort((a, b) => a - b)) {
  X.replayArms(st, cut, inputs, specs);
  snaps.set(cut, Object.fromEntries(Object.entries(st.arms).map(([id, a]) => [id, structuredClone(a.acc)])));
}
console.error(`replayed ${specs.length + 1} arms to ${new Date(L).toISOString()} in ${(performance.now() - t0).toFixed(0)} ms`);
// the legged run must still be production's for x1, x4, x5, e and rw
for (const id of ["rw", "e", "x1", "x4", "x5"]) {
  const a = st.arms[id].acc, p = xstate.arms[id].acc;
  for (const c of new Set([...Object.keys(a), ...Object.keys(p)])) {
    for (const k of Object.keys(p[c] ?? {})) if ((a[c] as unknown as Record<string, unknown>)?.[k] !== p[c][k]) throw new Error(`${id} ${c} ${k} differs from production`);
  }
}

// ---- metrics
type Met = { tot: number; str: number; rew: number; fil: number; r04: number; s04: number };
const met = (a: Acc | undefined): Met => {
  if (!a) return { tot: 0, str: 0, rew: 0, fil: 0, r04: 0, s04: 0 };
  const tot = accTotal(a), str = accStress(a);
  return { tot, str, rew: a.reward, fil: tot - a.reward, r04: tot - 0.6 * a.reward, s04: str - 0.3 * a.reward };
};
const KEYS = ["tot", "str", "rew", "fil", "r04", "s04"] as const;
const sumMet = (accs: Record<string, Acc>, filter?: (c: string) => boolean): Met => {
  const s: Met = { tot: 0, str: 0, rew: 0, fil: 0, r04: 0, s04: 0 };
  for (const [c, a] of Object.entries(accs)) if (!filter || filter(c)) { const m = met(a); for (const k of KEYS) s[k] += m[k]; }
  return s;
};
const sub = (x: Met, y: Met): Met => Object.fromEntries(KEYS.map((k) => [k, x[k] - y[k]])) as Met;
const at = (cut: number, id: string) => snaps.get(cut)![id] ?? {};

// windows: x1's own record from 09-28 00:00; Test 1's reading of x4/x5 since the 10-02 row; RW's run from 09-25
const dayEnd = (d: string) => Date.parse(`${d}T00:00:00Z`) + DAY - M;
const WIN: Record<string, { from: number | null; label: string }> = {
  x1: { from: dayEnd("2026-09-27"), label: "09-28 00:00 → L" },
  e: { from: dayEnd("2026-09-27"), label: "09-28 00:00 → L" },
  x4: { from: dayEnd("2026-09-27"), label: "09-28 00:00 → L" },
  x5: { from: dayEnd("2026-09-27"), label: "09-28 00:00 → L" },
  rw: { from: null, label: "09-25 00:00 → L" },
};
const dayCuts = [...snaps.keys()].filter((c) => c === L || (c + M) % DAY === 0).sort((a, b) => a - b);

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const q = (sorted: number[], p: number) => { const h = (sorted.length - 1) * p, lo = Math.floor(h); return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (h - lo); };
function boot(d: number[]): { p5: number; p95: number; pos: number } {
  const rng = mulberry32(20261004), B = 2000, out: number[] = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let k = 0; k < d.length; k++) s += d[Math.floor(rng() * d.length)]; out.push(s); }
  out.sort((a, b) => a - b);
  return { p5: q(out, 0.05), p95: q(out, 0.95), pos: out.filter((x) => x > 0).length / B };
}

type ArmOut = {
  id: string; ref: string; window: string; days: string[]; total: Met; ref_total: Met; diff: Met; daily: { day: string; arm: Met; ref: Met; diff: Met }[];
  boot: Record<string, { p5: number; p95: number; pos: number }>; markets: { c: string; cls: string; q: string; arm: Met; ref: Met; diff: Met }[];
  loo: { top: string[]; diff_wo1: Met; diff_wo2: Met };
};
function report(name: string, ref: string, from: number | null, label: string): ArmOut {
  const id = name.split("@")[0];
  const cutsIn = dayCuts.filter((c) => from === null || c > from);
  const days: string[] = [], daily: ArmOut["daily"] = [];
  let prevA = from === null ? sumMet({}) : sumMet(at(from, id)), prevR = from === null ? sumMet({}) : sumMet(at(from, ref));
  for (const c of cutsIn) {
    const A = sumMet(at(c, id)), R = sumMet(at(c, ref));
    const day = new Date(c === L ? Math.floor(L / DAY) * DAY : c - DAY + M).toISOString().slice(0, 10) + (c === L ? "*" : "");
    days.push(day);
    daily.push({ day, arm: sub(A, prevA), ref: sub(R, prevR), diff: sub(sub(A, prevA), sub(R, prevR)) });
    prevA = A; prevR = R;
  }
  const endA = at(L, id), endR = at(L, ref), stA = from === null ? {} : at(from, id), stR = from === null ? {} : at(from, ref);
  const total = sub(sumMet(endA), sumMet(stA)), ref_total = sub(sumMet(endR), sumMet(stR));
  const conds = new Set([...Object.keys(endA), ...Object.keys(endR)]);
  const markets: ArmOut["markets"] = [];
  for (const c of conds) {
    const a = sub(met(endA[c]), met(stA[c])), r = sub(met(endR[c]), met(stR[c]));
    markets.push({ c, cls: classOf(c), q: latest.get(c)?.q ?? "", arm: a, ref: r, diff: sub(a, r) });
  }
  markets.sort((x, y) => Math.abs(y.diff.tot) - Math.abs(x.diff.tot));
  const diff = sub(total, ref_total);
  const b: ArmOut["boot"] = {};
  for (const k of ["tot", "str", "r04"] as const) b[k] = boot(daily.map((d) => d.diff[k]));
  const top = markets.slice(0, 2);
  const wo = (n: number) => sub(diff, top.slice(0, n).reduce((s, m) => ({ tot: s.tot + m.diff.tot, str: s.str + m.diff.str, rew: s.rew + m.diff.rew, fil: s.fil + m.diff.fil, r04: s.r04 + m.diff.r04, s04: s.s04 + m.diff.s04 }), sumMet({})));
  return { id: name, ref, window: label, days, total, ref_total, diff, daily, boot: b, markets, loo: { top: top.map((m) => m.c), diff_wo1: wo(1), diff_wo2: wo(2) } };
}

const outs: ArmOut[] = [];
for (const s of specs) {
  const ref = fam[s.id];
  if (s.id === ref) continue;
  const w = WIN[ref];
  outs.push(report(s.id, ref, w.from, w.label));
  // x4/x5 families: also Test 1's reading, since the 10-02 row
  if (ref === "x4" || ref === "x5") outs.push(report(`${s.id}@1002`, ref, dayEnd("2026-10-02"), "10-03 00:00 → L"));
}
// references themselves: x1, x4, x5 against x1 (since 09-28 and since the 10-02 row), e and rw for context
const refsOut = [report("x4", "x1", WIN.x1.from, WIN.x1.label), report("x5", "x1", WIN.x1.from, WIN.x1.label),
  report("x4@1002", "x1", dayEnd("2026-10-02"), "10-03 00:00 → L"), report("x5@1002", "x1", dayEnd("2026-10-02"), "10-03 00:00 → L"),
  report("x1", "e", WIN.x1.from, WIN.x1.label), report("x1", "rw", WIN.x1.from, WIN.x1.label)];

const absolute = (id: string, from: number | null) => sub(sumMet(at(L, id)), from === null ? sumMet({}) : sumMet(at(from, id)));
const result = {
  L: new Date(L).toISOString(), arms: specs.map((s) => s.id),
  absolute: Object.fromEntries(["rw", "e", "x1", "x4", "x5"].map((id) => [id, { since0928: absolute(id, dayEnd("2026-09-27")), since1002: absolute(id, dayEnd("2026-10-02")), sinceRun: absolute(id, null) }])),
  outs, refsOut,
  snapsDays: dayCuts.map((c) => new Date(c).toISOString()),
};
Deno.writeTextFileSync("./study_out.json", JSON.stringify(result, null, 1));
console.error(`done in ${(performance.now() - t0).toFixed(0)} ms`);
