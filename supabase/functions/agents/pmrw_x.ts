// Variants of RW-E replayed from RW's stored record (Davies, 2026-09-27: study the three ways to cut RW-E's stress, then
// track the ones worth it as TESTING rows). The same replay as RW-E's (pmrw_e.ts), with any number of arms, each one
// rule: RW-E's own (a market is not quoted on a day its scheduled end falls inside), an inventory cap below RW's 3N, a
// pause after the market's adjusted mid jumps, or categories left out. It reads `pm_rw_*` and changes nothing that runs.
//
// An arm follows RW minute for minute while it holds what RW holds and its rule would quote what RW quoted: then RW's
// recorded decision and fills are its own. Where it holds a different amount, or its cap stops a side RW still quoted,
// the minute is run through RW's own `stepRw` on the stored book and prints, and the market is named in its `diverged`.
// The `rw` arm is RW itself, the check that the replay is one.
//
// `researchRwx` runs the arms over RW's days before RW-E's twelve (2026-09-25 → 09-27 00:00, already read for RW-E's
// pre-registration) and never past them: a variant is chosen on those days and frozen before any minute it is judged on.

import { newAcc, RW_INV_CAP, RW_RUN_END, RW_RUN_START, sizeN, snapshot, stepRw, type Acc, type RwState } from "./pmrw.ts";
import { printOrder, type PmPrint } from "../_shared/polymarket_public.ts";
import {
  applyFill, bookRow, excludedByDay, metaFor, RWE_START,
  type RweDayRow, type RweFillRow, type RweInputs, type RweMinuteRow, type RwePrintRow, type RweSelRow, type RweSettlement,
} from "./pmrw_e.ts";
import type { Db } from "./db.ts";

const M = 60e3, DAY = 86400e3;

/** One arm's rule. Times are ms; before `from` the arm is RW (or RW-E, from `noSameDayFrom`). */
export type RwxSpec = {
  id: string;
  noSameDayFrom: number | null;               // RW-E's rule from this minute: not quoted on a day its scheduled end falls inside
  from: number;                               // the rules below apply from this minute
  noCats?: string[];                          // categories (the selection's `cat`) not quoted
  invCap?: number;                            // a side stops quoting at invCap × N of inventory its way (RW's is 3)
  pause?: { cents: number; minutes: number }; // after the adjusted mid moves `cents` or more between minutes, not quoted for `minutes`
};
export type RwxArmState = { acc: Record<string, Acc>; dayActive: string[]; diverged: string[]; pausedUntil: Record<string, number>; lastMid: Record<string, number> };
export type RwxState = { lastDecided: number; dayOf: number; arms: Record<string, RwxArmState>; checkMaxUsd: number };
export type RwxDayOut = { day: string; arm: string; total: number; stress_total: number; reward: number; fills: number; capital: number; markets: number; detail: Record<string, unknown> };

const iso = (ms: number) => new Date(ms).toISOString();
const dayStr = (ms: number) => iso(Math.floor(ms / DAY) * DAY).slice(0, 10);
const newArm = (): RwxArmState => ({ acc: {}, dayActive: [], diverged: [], pausedUntil: {}, lastMid: {} });

/** The fresh state: RW's start, nothing held, every arm RW. */
export const newRwxState = (specs: RwxSpec[]): RwxState => ({
  lastDecided: RW_RUN_START - M, dayOf: RW_RUN_START, checkMaxUsd: 0,
  arms: Object.fromEntries([["rw", newArm()], ...specs.map((s) => [s.id, newArm()])]),
});

/** Whether an arm quotes a market this minute, before its inventory is read: RW's decision, less what its rule leaves out. */
function armQuotes(spec: RwxSpec, a: RwxArmState, c: string, t: number, recordedQuoting: boolean, sameDayOut: boolean, cat: string | null, mid: number | null): boolean {
  let q = recordedQuoting;
  if (spec.noSameDayFrom !== null && t >= spec.noSameDayFrom && sameDayOut) q = false;
  if (t >= spec.from) {
    if (spec.noCats && cat !== null && spec.noCats.includes(cat)) q = false;
    if (spec.pause && mid !== null) {
      const prev = a.lastMid[c];
      if (prev !== undefined && Math.abs(mid - prev) * 100 >= spec.pause.cents - 1e-9) a.pausedUntil[c] = t + spec.pause.minutes * M;
      if ((a.pausedUntil[c] ?? 0) > t) q = false;
    }
  }
  if (mid !== null) a.lastMid[c] = mid;
  return q;
}

/**
 * Replay the minutes (st.lastDecided, to] of RW's stored record in every arm. Pure: every read is in `inputs`, and the
 * day rows it closes are returned. RW-E's order: minute by minute, a day closed before its first minute past midnight,
 * the rows of a minute by market, and a settlement after the last minute its run decided.
 */
export function replayArms(st: RwxState, to: number, inputs: RweInputs, specs: RwxSpec[]): { days: RwxDayOut[]; minutes: number } {
  const from = st.lastDecided + M;
  const days: RwxDayOut[] = [];
  if (to < from) return { days, minutes: 0 };
  const excluded = excludedByDay(inputs.selection);
  const byMinute = new Map<number, RweMinuteRow[]>();
  for (const r of inputs.rows) {
    const t = Date.parse(r.minute);
    if (t < from || t > to) continue;
    (byMinute.get(t) ?? byMinute.set(t, []).get(t)!).push(r);
  }
  for (const list of byMinute.values()) list.sort((x, y) => (x.cond < y.cond ? -1 : x.cond > y.cond ? 1 : 0));
  const printOf = new Map(inputs.prints.map((p) => [p.id, p]));
  const toPrint = (p: RwePrintRow): PmPrint => ({ id: p.id, ts: Date.parse(p.ts) / 1000, side: p.side, oi: Number(p.oi), price: Number(p.price), size: Number(p.size) });
  const fillsOf = new Map<string, RweFillRow[]>();
  for (const f of inputs.fills) {
    const t = Date.parse(f.minute);
    if (t < from || t > to) continue;
    const k = `${f.cond}|${t}`;
    (fillsOf.get(k) ?? fillsOf.set(k, []).get(k)!).push(f);
  }
  for (const list of fillsOf.values()) {
    list.sort((x, y) => {
      const px = printOf.get(x.print_id), py = printOf.get(y.print_id);
      if (px && py) return printOrder(toPrint(px), toPrint(py));
      return Date.parse(x.ts) - Date.parse(y.ts) || (x.print_id < y.print_id ? -1 : x.print_id > y.print_id ? 1 : 0);
    });
  }
  const printsOf = new Map<string, PmPrint[]>();
  for (const p of inputs.prints) (printsOf.get(p.cond) ?? printsOf.set(p.cond, []).get(p.cond)!).push(toPrint(p));
  for (const list of printsOf.values()) list.sort(printOrder);
  const settleAfter = new Map<number, RweSettlement[]>();
  for (const s of inputs.settlements) {
    const t = Math.floor(Date.parse(s.settled_at) / M) * M - 2 * M;
    (settleAfter.get(t) ?? settleAfter.set(t, []).get(t)!).push(s);
  }
  const rwDay = new Map(inputs.rwDays.map((d) => [String(d.day).slice(0, 10), d]));
  const ids = ["rw", ...specs.map((s) => s.id)];
  const specOf = new Map(specs.map((s) => [s.id, s]));
  for (const id of ids) st.arms[id] ??= newArm();

  const closeDay = () => {
    const day = dayStr(st.dayOf);
    for (const id of ids) {
      const a = st.arms[id];
      const s = snapshot({ acc: a.acc } as unknown as RwState, a.dayActive);
      const detail: Record<string, unknown> = { perMarket: s.perMarket, active: a.dayActive };
      if (id === "rw") {
        const own = rwDay.get(day);
        if (own) {
          const gap = { total: s.total - Number(own.total), stress: s.stress - Number(own.stress_total), reward: s.reward - Number(own.reward), fills: s.fills - Number(own.fills) };
          detail.check = gap;
          st.checkMaxUsd = Math.max(st.checkMaxUsd, Math.abs(gap.total), Math.abs(gap.stress), Math.abs(gap.reward), Math.abs(gap.fills));
        } else detail.check = null;
      } else detail.diverged = [...st.arms[id].diverged].sort();
      days.push({ day, arm: id, total: s.total, stress_total: s.stress, reward: s.reward, fills: s.fills, capital: s.capital, markets: a.dayActive.length, detail });
    }
    st.dayOf += DAY;
    for (const id of ids) {
      const a = st.arms[id];
      a.dayActive = Object.entries(a.acc).filter(([, x]) => x.settled == null && x.net !== 0).map(([c]) => c);
    }
  };

  let minutes = 0;
  for (let t = from; t <= to; t += M) {
    if (t >= st.dayOf + DAY) closeDay();
    const dayExcluded = excluded.get(dayStr(t));
    for (const r of byMinute.get(t) ?? []) {
      const c = r.cond;
      const row = bookRow(r);
      const recorded = r.b !== null && r.b !== undefined;
      const fills = fillsOf.get(`${c}|${t}`) ?? [];
      const tick = Number(r.tick) || 0.01;
      const meta = metaFor(inputs.selection, c, t);
      const N = sizeN(Number(meta?.min_size ?? 0));
      const cat = meta?.cat ? String(meta.cat) : null;
      const mid = row && row[2] !== null && row[3] !== null ? (row[2] + row[3]) / 2 : null;
      // RW's inventory before this minute, which is the one its recorded decision was made on.
      const rwNetBefore = st.arms.rw.acc[c]?.net ?? 0;
      for (const id of ids) {
        const a = st.arms[id];
        const spec = specOf.get(id) ?? null;
        const quoting = spec ? armQuotes(spec, a, c, t, r.quoting, dayExcluded?.has(c) ?? false, cat, mid) : r.quoting;
        if (!quoting && !a.acc[c]) continue;
        const acc = (a.acc[c] ??= newAcc());
        if (acc.settled != null) continue;
        if (row && row[2] !== null && row[3] !== null) { acc.lastAb = row[2]; acc.lastAa = row[3]; }
        if (quoting) {
          const cap = spec && t >= spec.from ? (spec.invCap ?? RW_INV_CAP) : RW_INV_CAP;
          // RW's recorded decision is this arm's while it holds what RW held and its cap quotes the sides RW's did.
          const same = acc.net === rwNetBefore &&
            (acc.net < cap * N) === (acc.net < RW_INV_CAP * N) && (acc.net > -cap * N) === (acc.net > -RW_INV_CAP * N);
          if (spec && !same) {
            if (meta && row) {
              if (!a.diverged.includes(c)) a.diverged.push(c);
              stepRw(acc, t / 1000, row, tick, Number(meta.v), Number(meta.rate), N, printsOf.get(c) ?? [], 0, cap);
            }
          } else if (recorded) {
            acc.lastM = Number(r.m);
            acc.quotedMinutes++;
            if (acc.firstCap === null) acc.firstCap = sizeN(Number(meta?.min_size ?? 0)) * (Number(r.b) + 1 - Number(r.a));
            acc.reward += Number(r.reward ?? 0);
            for (const f of fills) applyFill(acc, { side: f.side, price: Number(f.price), size: Number(f.size) }, tick);
          }
          if (!a.dayActive.includes(c)) a.dayActive.push(c);
        } else if (row && row[2] !== null && row[3] !== null) {
          acc.lastM = (row[2] + row[3]) / 2;
          if (acc.net !== 0 && !a.dayActive.includes(c)) a.dayActive.push(c);
        }
      }
    }
    for (const s of settleAfter.get(t) ?? []) {
      for (const id of ids) {
        const acc = st.arms[id].acc[s.cond];
        if (acc && acc.settled == null) acc.settled = Number(s.payout);
      }
    }
    st.lastDecided = t;
    minutes++;
  }
  if (st.lastDecided === RW_RUN_END - M && st.dayOf < RW_RUN_END) closeDay();
  return { days, minutes };
}

/** A research arm's spec as the request gives it, checked: an id, numbers in range, at most twelve arms. */
export function parseRwxSpecs(body: unknown): RwxSpec[] {
  const list = (body as { specs?: unknown })?.specs;
  if (!Array.isArray(list) || list.length === 0 || list.length > 12) throw new Error("specs: 1 to 12 arms");
  const ids = new Set<string>(["rw"]);
  return list.map((x) => {
    const s = x as Record<string, unknown>;
    const id = String(s.id ?? "");
    if (!/^[a-z0-9-]{1,20}$/.test(id) || ids.has(id)) throw new Error(`spec id '${id}' is not a new short name`);
    ids.add(id);
    const out: RwxSpec = { id, noSameDayFrom: s.noSameDay === false ? null : RW_RUN_START, from: RW_RUN_START };
    if (s.invCap !== undefined) {
      const k = Number(s.invCap);
      if (!(k >= 1 && k <= 3)) throw new Error(`${id}: invCap 1 to 3`);
      out.invCap = k;
    }
    if (s.pause !== undefined) {
      const p = s.pause as Record<string, unknown>;
      const cents = Number(p?.cents), minutes = Number(p?.minutes);
      if (!(cents >= 1 && cents <= 50) || !(minutes >= 1 && minutes <= 1440)) throw new Error(`${id}: pause cents 1-50, minutes 1-1440`);
      out.pause = { cents, minutes };
    }
    if (s.noCats !== undefined) {
      if (!Array.isArray(s.noCats) || s.noCats.some((c) => typeof c !== "string" || !/^[a-z_]{1,40}$/.test(c))) throw new Error(`${id}: noCats`);
      out.noCats = s.noCats as string[];
    }
    return out;
  });
}

export type RwxResearch = {
  until: string; minutes: number; checkMaxUsd: number;
  arms: Record<string, { total: number; stress: number; reward: number; fills: number; capital: number; diverged: number; days: Array<{ day: string; total: number; stress: number }> }>;
};

/**
 * Every arm over RW's days before RW-E's twelve: from RW's start to `until`, never past 2026-09-27 00:00. A day at a time,
 * the arms' running accounts carried over, nothing written. The figures are running totals at `until`.
 */
export async function researchRwx(db: Db, specs: RwxSpec[], untilMs?: number): Promise<RwxResearch> {
  const until = Math.min(untilMs ?? RWE_START, RWE_START);
  const st = newRwxState(specs);
  const days: RwxDayOut[] = [];
  let minutes = 0;
  for (let lo = RW_RUN_START; lo < until; lo += DAY) {
    const hi = Math.min(lo + DAY, until) - M;
    const qLo = encodeURIComponent(iso(lo)), qHi = encodeURIComponent(iso(hi)), qPrints = encodeURIComponent(iso(hi + M)), qUntil = encodeURIComponent(iso(until));
    const [rows, fills, prints, selection, settlements, rwDays] = await Promise.all([
      db.selectAll<RweMinuteRow>("pm_rw_minutes", `minute=gte.${qLo}&minute=lte.${qHi}&select=cond,minute,quoting,tick,bb,ba,ab,aa,q1,q2,m,b,a,reward&order=minute.asc,cond.asc`),
      db.selectAll<RweFillRow>("pm_rw_fills", `minute=gte.${qLo}&minute=lte.${qHi}&select=cond,minute,ts,side,price,size,print_id&order=cond.asc,minute.asc,print_id.asc`),
      db.selectAll<RwePrintRow>("pm_rw_prints", `ts=gte.${qLo}&ts=lte.${qPrints}&select=id,cond,ts,side,oi,price,size&order=ts.asc,id.asc`),
      db.select<RweSelRow>("pm_rw_selection", `day=lte.${dayStr(hi)}&select=day,cond,tick,v,min_size,rate,end_date,q,cat&order=day.asc,cond.asc&limit=1000`),
      db.select<RweSettlement>("pm_rw_settlements", `settled_at=lte.${qUntil}&select=cond,payout,settled_at&order=cond.asc&limit=1000`),
      db.select<RweDayRow>("pm_rw_days", `day=lt.${dayStr(until)}&select=day,total,stress_total,reward,fills&order=day.asc&limit=100`),
    ]);
    const out = replayArms(st, hi, { rows, fills, prints, selection, settlements, rwDays }, specs);
    days.push(...out.days);
    minutes += out.minutes;
  }
  const arms: RwxResearch["arms"] = {};
  for (const id of ["rw", ...specs.map((s) => s.id)]) {
    const a = st.arms[id];
    const s = snapshot({ acc: a.acc } as unknown as RwState, a.dayActive);
    arms[id] = {
      total: s.total, stress: s.stress, reward: s.reward, fills: s.fills, capital: s.capital, diverged: a.diverged.length,
      days: days.filter((d) => d.arm === id).map((d) => ({ day: d.day, total: d.total, stress: d.stress_total })),
    };
  }
  return { until: iso(until), minutes, checkMaxUsd: st.checkMaxUsd, arms };
}
