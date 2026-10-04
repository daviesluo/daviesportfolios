// Scratch only, never committed: run a list of variants on a record and write every one's figures (no winner-only report).
import { loadPool, loadRW, type Rec } from "./rec.ts";
import { simulate, type SimOut, type Variant } from "./sim.ts";

const DAY = 86400e3;
export type Summary = {
  id: string; days: string[];
  daily: Array<{ day: string; tot: number; str: number; rew: number; fil: number; r04: number; s04: number; committedMax: number; capWithheld: number; invStopped: number; stopDay: boolean; stopTotal: boolean; markets: number; quotedMinutes: number }>;
  all: Agg; h1: Agg; h2: Agg; committedMax: number; committedMean: number; carriedMean: number; fillsLow: number; r40Low: number; capWithheld: number; invStopped: number; stops: number;
  perMarket: Array<{ cond: string; tot: number; rew: number; q: string; rate: number; cat: string | null }>;
  chosenPerDay: number; exits: number; exitCost: number; rebates: number;
};
type Agg = { tot: number; str: number; rew: number; fil: number; r04: number; s04: number; days: number };
const zero = (): Agg => ({ tot: 0, str: 0, rew: 0, fil: 0, r04: 0, s04: 0, days: 0 });

export function summarise(o: SimOut, split: string): Summary {
  const daily: Summary["daily"] = [];
  let prev = { total: 0, stress: 0, reward: 0 };
  for (const d of o.days) {
    const tot = d.total - prev.total, str = d.stress - prev.stress, rew = d.reward - prev.reward;
    daily.push({ day: d.day, tot, str, rew, fil: tot - rew, r04: tot - 0.6 * rew, s04: str - 0.3 * rew, committedMax: d.committedMax, capWithheld: d.capWithheld, invStopped: d.invStopped, stopDay: d.stopDay, stopTotal: d.stopTotal, markets: d.markets, quotedMinutes: d.quotedMinutes });
    prev = { total: d.total, stress: d.stress, reward: d.reward };
  }
  const agg = (f: (d: Summary["daily"][number]) => boolean) => daily.filter(f).reduce((a, d) => ({ tot: a.tot + d.tot, str: a.str + d.str, rew: a.rew + d.rew, fil: a.fil + d.fil, r04: a.r04 + d.r04, s04: a.s04 + d.s04, days: a.days + 1 }), zero());
  const perMarket = Object.entries(o.perMarket).map(([cond, x]) => ({ cond, tot: x.total, rew: x.reward, q: x.meta?.q ?? "", rate: x.meta?.rate ?? 0, cat: x.meta?.cat ?? null })).sort((a, b) => a.tot - b.tot);
  const nChosen = Object.values(o.chosen).map((x) => x.length);
  return {
    id: o.id, days: daily.map((d) => d.day), daily, all: agg(() => true), h1: agg((d) => d.day < split), h2: agg((d) => d.day >= split),
    committedMax: Math.max(...daily.map((d) => d.committedMax)), committedMean: o.days.reduce((s, d) => s + d.committedMean, 0) / o.days.length, carriedMean: o.days.reduce((s, d) => s + d.carriedMean, 0) / o.days.length,
    fillsLow: Math.min(...o.days.map((d) => d.fillsLow)), r40Low: Math.min(...o.days.map((d) => d.r40Low)), capWithheld: daily.reduce((s, d) => s + d.capWithheld, 0), invStopped: daily.reduce((s, d) => s + d.invStopped, 0),
    stops: daily.filter((d) => d.stopDay || d.stopTotal).length, perMarket, chosenPerDay: nChosen.reduce((s, x) => s + x, 0) / Math.max(1, nChosen.length),
    exits: o.exits?.n ?? 0, exitCost: o.exits?.cost ?? 0, rebates: o.rebates ?? 0,
  };
}

export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** The day-block bootstrap of a daily series' sum: 2,000 draws, seed 20261004, the 5th and 95th percentiles and P(sum > 0). */
export function boot(d: number[], seed = 20261004, B = 2000) {
  const rng = mulberry32(seed), out: number[] = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let k = 0; k < d.length; k++) s += d[Math.floor(rng() * d.length)]; out.push(s); }
  out.sort((a, b) => a - b);
  const q = (p: number) => { const h = (out.length - 1) * p, lo = Math.floor(h); return out[lo] + (out[Math.min(lo + 1, out.length - 1)] - out[lo]) * (h - lo); };
  return { p5: q(0.05), p95: q(0.95), pos: out.filter((x) => x > 0).length / B };
}

export function loadRec(name: string): Rec { return name === "RW" ? loadRW() : loadPool(name as "mini" | "mid"); }

export function runAll(rec: Rec, variants: Variant[], split: string): Summary[] {
  const out: Summary[] = [];
  for (const v of variants) {
    const t0 = performance.now();
    const s = summarise(simulate(rec, v), split);
    out.push(s);
    console.error(`  ${v.id}: ${(performance.now() - t0).toFixed(0)} ms`);
  }
  return out;
}

export function table(rows: Summary[], base: Summary | null, title: string) {
  const f = (x: number, w = 8) => (Number.isFinite(x) ? x.toFixed(2) : "nan").padStart(w);
  const lines: string[] = [title];
  lines.push(`${"arm".padEnd(30)} ${"tot".padStart(8)} ${"R0.4".padStart(8)} ${"stress".padStart(8)} ${"rew".padStart(8)} ${"fills".padStart(8)} | ${"h1 tot".padStart(8)} ${"h1 R.4".padStart(8)} | ${"h2 tot".padStart(8)} ${"h2 R.4".padStart(8)} | ${"comMax".padStart(7)} ${"comAvg".padStart(7)} ${"carr".padStart(6)} ${"fLow".padStart(8)} ${"r4Low".padStart(8)} ${"capW".padStart(6)} ${"invS".padStart(6)} ${"stops".padStart(5)} ${"mkts".padStart(5)} ${"exits".padStart(5)} ${"exCost".padStart(7)} ${"rebate".padStart(7)}` + (base ? ` | ${"dTot".padStart(8)} ${"b5".padStart(8)} ${"b95".padStart(8)} ${"P>0".padStart(5)} | ${"dR.4".padStart(8)} ${"b5".padStart(8)} ${"b95".padStart(8)} ${"P>0".padStart(5)}` : ""));
  for (const r of rows) {
    let extra = "";
    if (base) {
      const dd = r.daily.map((d, i) => d.tot - (base.daily[i]?.tot ?? 0)), d4 = r.daily.map((d, i) => d.r04 - (base.daily[i]?.r04 ?? 0));
      const b1 = boot(dd), b4 = boot(d4);
      extra = ` | ${f(r.all.tot - base.all.tot)} ${f(b1.p5)} ${f(b1.p95)} ${b1.pos.toFixed(2).padStart(5)} | ${f(r.all.r04 - base.all.r04)} ${f(b4.p5)} ${f(b4.p95)} ${b4.pos.toFixed(2).padStart(5)}`;
    }
    lines.push(`${r.id.padEnd(30)} ${f(r.all.tot)} ${f(r.all.r04)} ${f(r.all.str)} ${f(r.all.rew)} ${f(r.all.fil)} | ${f(r.h1.tot)} ${f(r.h1.r04)} | ${f(r.h2.tot)} ${f(r.h2.r04)} | ${f(r.committedMax, 7)} ${f(r.committedMean, 7)} ${f(r.carriedMean, 6)} ${f(r.fillsLow)} ${f(r.r40Low)} ${String(r.capWithheld).padStart(6)} ${String(r.invStopped).padStart(6)} ${String(r.stops).padStart(5)} ${r.chosenPerDay.toFixed(1).padStart(5)} ${String(r.exits).padStart(5)} ${f(r.exitCost, 7)} ${f(r.rebates, 7)}${extra}`);
  }
  return lines.join("\n");
}
