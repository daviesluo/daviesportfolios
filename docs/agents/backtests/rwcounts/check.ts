// Scratch only: does RW-X's own replay, run on the dumped record, reproduce production's pm_rw_x_days and pm_rw_x_state?
// And does the extended copy (pmrw_x_ext.ts, one hook added) reproduce the original bit for bit?
import { newRwxState, replayArms, RWX_SPECS } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw_x.ts";
import * as ext from "./pmrw_x_ext.ts";
import { load } from "./load.ts";

const t0 = performance.now();
const { inputs, xDays, xstate, L } = load();
console.log(`loaded rows ${inputs.rows.length} fills ${inputs.fills.length} prints ${inputs.prints.length} sel ${inputs.selection.length} settle ${inputs.settlements.length} to ${new Date(L).toISOString()} in ${(performance.now() - t0).toFixed(0)} ms`);

const st = newRwxState(RWX_SPECS);
const out = replayArms(st, L, structuredClone(inputs), RWX_SPECS);
console.log(`replayed ${out.minutes} minutes, ${out.days.length} day rows, checkMaxUsd ${st.checkMaxUsd}`);

// 1. day rows against production, every arm
let dayMax = 0, n = 0;
const prod = new Map(xDays.map((x: { day: string; arm: string }) => [`${String(x.day).slice(0, 10)}|${x.arm}`, x]));
for (const d of out.days) {
  const p = prod.get(`${d.day}|${d.arm}`) as Record<string, number> | undefined;
  if (!p) { console.log("no production row", d.day, d.arm); continue; }
  const g = Math.max(Math.abs(d.total - Number(p.total)), Math.abs(d.stress_total - Number(p.stress_total)), Math.abs(d.reward - Number(p.reward)), Math.abs(d.fills - Number(p.fills)), Math.abs(d.capital - Number(p.capital)), Math.abs(d.markets - Number(p.markets)));
  dayMax = Math.max(dayMax, g); n++;
}
console.log(`day rows compared ${n} of ${xDays.length} stored; largest gap $${dayMax}`);
for (const arm of ["x1", "x4", "x5"]) {
  const r = out.days.filter((d) => d.arm === arm).map((d) => `${d.day.slice(5)} ${d.total.toFixed(2)}`).join(" | ");
  console.log(arm, r);
}

// 2. the state at L against production's stored state, every arm, every market, every field
let accDiff = 0, fields = 0, missing = 0;
const diffs: string[] = [];
for (const [arm, a] of Object.entries(st.arms)) {
  const p = xstate.arms[arm];
  if (!p) { diffs.push(`arm ${arm} not stored`); continue; }
  const keys = new Set([...Object.keys(a.acc), ...Object.keys(p.acc)]);
  for (const c of keys) {
    const x = a.acc[c] as unknown as Record<string, number | null>, y = p.acc[c] as Record<string, number | null>;
    if (!x || !y) { missing++; diffs.push(`${arm} ${c.slice(0, 10)} only in ${x ? "replay" : "production"}`); continue; }
    for (const k of Object.keys(y)) {
      fields++;
      if (x[k] !== y[k]) {
        const g = typeof x[k] === "number" && typeof y[k] === "number" ? Math.abs((x[k] as number) - (y[k] as number)) : Infinity;
        accDiff = Math.max(accDiff, g);
        if (diffs.length < 20) diffs.push(`${arm} ${c.slice(0, 10)} ${k}: replay ${x[k]} production ${y[k]}`);
      }
    }
  }
  const eqSet = (u: string[], v: string[]) => u.length === v.length && [...u].sort().join() === [...v].sort().join();
  if (!eqSet(a.dayActive, p.dayActive)) diffs.push(`${arm} dayActive differs`);
  if (!eqSet(a.diverged, p.diverged)) diffs.push(`${arm} diverged differs: replay ${a.diverged.length} production ${p.diverged.length}`);
  if (a.base && p.base) {
    for (const c of Object.keys(p.base)) for (const k of Object.keys(p.base[c])) if ((a.base[c] as unknown as Record<string, unknown>)?.[k] !== p.base[c][k]) { diffs.push(`${arm} base ${c.slice(0, 10)} ${k}`); break; }
  } else if (!!a.base !== !!p.base) diffs.push(`${arm} base present: replay ${!!a.base} production ${!!p.base}`);
}
console.log(`state at L: lastDecided ${new Date(st.lastDecided).toISOString()} (production ${new Date(xstate.lastDecided).toISOString()}), dayOf equal ${st.dayOf === xstate.dayOf}; fields compared ${fields}, unequal max gap ${accDiff}, markets on one side only ${missing}`);
for (const d of diffs) console.log("  ", d);

// 3. the extended copy with RW-X's own specs: the same state and day rows, bit for bit
const st2 = ext.newRwxState(RWX_SPECS);
const out2 = ext.replayArms(st2, L, structuredClone(inputs), RWX_SPECS);
const same = JSON.stringify(st2) === JSON.stringify(st) && JSON.stringify(out2.days) === JSON.stringify(out.days);
console.log(`extended copy equal to RW-X's replay, state and day rows byte for byte: ${same}`);
console.log(`done in ${(performance.now() - t0).toFixed(0)} ms`);
