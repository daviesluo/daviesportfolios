// RW-E beside RW (pre-registration `reviews/2026-09-26-polymarket-rw-end-prereg.md`, reference §4 item 36): RW without
// the markets that end on the day they are quoted, computed from what RW's engine stored and nothing else. It reads
// `pm_rw_*`, writes only `pm_rw_e_*`, and changes nothing that runs.
//
// Two arms walk RW's minutes in the engine's order. `rw` is RW itself: its day rows must equal `pm_rw_days`, and a gap
// of a cent is reported, because a replay that cannot reproduce RW cannot say what RW-E would have done. `e` is RW-E:
// on each UTC day D, a market in D's selection whose scheduled end is before D + 24 h is not quoted on D, and is on that
// day a market that left the selection — its inventory held, marked at the adjusted mid, settled at its payout.
//
// A minute is applied from what the engine recorded of it: its decision (`pm_rw_minutes`: the mid, the quotes, the
// reward) and the fills that decision made (`pm_rw_fills`, in the order of the prints that proved them). The stored
// inputs could not reproduce those exactly: a print published after the engine decided its minute is in
// `pm_rw_prints` all the same, and a minute decided at midnight was decided under whichever day's selection had landed
// by that second. A market is independent of every other, so while RW-E holds what RW holds in it, RW-E's minute is
// RW's minute. Where they hold different amounts (only after an exclusion, in a market quoted again later), the minute
// is run through RW's own `stepRw` on its stored book and prints instead, and the market is named in `diverged`.

import { newAcc, RW_RUN_END, RW_RUN_START, sizeN, snapshot, stepRw, type Acc, type BookRow, type RwState } from "./pmrw.ts";
import { printOrder, type PmPrint } from "../_shared/polymarket_public.ts";
import type { Db } from "./db.ts";

const M = 60e3, DAY = 86400e3;
/** The twelve days RW-E is judged on: 2026-09-27 00:00 → 2026-10-09 00:00 UTC. It replays from RW's start to enter them holding what RW held. */
export const RWE_START = Date.UTC(2026, 8, 27);
/** Minutes replayed in one run at most: a day's rows are ~16,000 and a day's prints ~800, well inside one request. */
export const RWE_MAX_MINUTES = 720;
/** A replayed day may differ from RW's own by this much before the check fails: less than a cent, or it is not a replay. */
export const RWE_CHECK_USD = 0.01;
export const RWE_LEASE_MS = 240e3;

export type RweArm = "rw" | "e";
export type RweArmState = { acc: Record<string, Acc>; dayActive: string[] };
export type RweState = {
  lastDecided: number;                       // ms: the last minute replayed
  dayOf: number;                             // ms: the UTC day being accumulated
  arms: Record<RweArm, RweArmState>;
  diverged: string[];                        // markets RW-E ran through stepRw, because it held a different amount from RW
  checkMaxUsd: number;                       // the largest gap between the rw arm's closed days and RW's own
};
export type RweReport = { skipped?: string; minutes: number; from: number | null; to: number | null; days: number; diverged: number; errors: string[] };
export type RweDeps = { db: Db; now: number; holder: string };

export type RweMinuteRow = {
  cond: string; minute: string; quoting: boolean; tick: number | string;
  bb: number | string | null; ba: number | string | null; ab: number | string | null; aa: number | string | null; q1: number | string | null; q2: number | string | null;
  m: number | string | null; b: number | string | null; a: number | string | null; reward: number | string | null;
};
export type RweFillRow = { cond: string; minute: string; ts: string; side: "bid" | "ask"; price: number | string; size: number | string; print_id: string };
export type RwePrintRow = { id: string; cond: string; ts: string; side: "BUY" | "SELL"; oi: number | string; price: number | string; size: number | string };
export type RweSelRow = { day: string; cond: string; tick: number | string; v: number | string; min_size: number | string; rate: number | string; end_date: string | null; q?: string | null; cat?: string | null };
export type RweSettlement = { cond: string; payout: number | string; settled_at: string };
export type RweDayRow = { day: string; total: number | string; stress_total: number | string; reward: number | string; fills: number | string };

const iso = (ms: number) => new Date(ms).toISOString();
const dayStr = (ms: number) => iso(Math.floor(ms / DAY) * DAY).slice(0, 10);
const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** The fresh state: RW's start, nothing held, both arms identical. */
export const newRweState = (): RweState => ({
  lastDecided: RW_RUN_START - M, dayOf: RW_RUN_START, arms: { rw: { acc: {}, dayActive: [] }, e: { acc: {}, dayActive: [] } }, diverged: [], checkMaxUsd: 0,
});

/** The markets RW-E does not quote on each day: in that day's selection, with a scheduled end before the day's end. */
export function excludedByDay(selection: RweSelRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of selection) {
    if (!s.end_date) continue;
    const dayMs = Date.parse(`${String(s.day).slice(0, 10)}T00:00:00Z`);
    if (Date.parse(s.end_date) < dayMs + DAY) (out.get(String(s.day).slice(0, 10)) ?? out.set(String(s.day).slice(0, 10), new Set()).get(String(s.day).slice(0, 10))!).add(s.cond);
  }
  return out;
}

/** A market's parameters for a minute: its row in the latest selection of that day or before. */
function metaFor(selection: RweSelRow[], cond: string, t: number): RweSelRow | null {
  const day = dayStr(t);
  let best: RweSelRow | null = null;
  for (const s of selection) if (s.cond === cond && String(s.day).slice(0, 10) <= day && (!best || String(s.day) > String(best.day))) best = s;
  return best;
}

const bookRow = (r: RweMinuteRow): BookRow | null =>
  r.bb === null || r.ba === null ? null : [Number(r.bb), Number(r.ba), num(r.ab), num(r.aa), Number(r.q1 ?? 0), Number(r.q2 ?? 0)];

/** One recorded fill applied to a market's account, as `stepRw` applies it. */
function applyFill(acc: Acc, f: { side: "bid" | "ask"; price: number; size: number }, tick: number) {
  const q = f.size, px = f.price;
  if (f.side === "bid") {
    acc.net += q; acc.cash -= q * px; acc.fills++; acc.fillShares += q; acc.tickCost += q * tick;
    acc.maxInvCost = Math.max(acc.maxInvCost, acc.net * px);
  } else {
    acc.net -= q; acc.cash += q * px; acc.fills++; acc.fillShares += q; acc.tickCost += q * tick;
    acc.maxInvCost = Math.max(acc.maxInvCost, -acc.net * (1 - px));
  }
}

export type RweInputs = {
  rows: RweMinuteRow[]; fills: RweFillRow[]; prints: RwePrintRow[]; selection: RweSelRow[]; settlements: RweSettlement[]; rwDays: RweDayRow[];
};
export type RweDayOut = { day: string; arm: RweArm; total: number; stress_total: number; reward: number; fills: number; capital: number; markets: number; detail: Record<string, unknown> };

/**
 * Replay the minutes (st.lastDecided, to] of RW's stored record in both arms. Pure: every read is in `inputs`, and the
 * day rows it closes are returned. The engine's order: minute by minute, a day closed before its first minute past
 * midnight, the rows of a minute by market, and a settlement after the last minute its run decided.
 */
export function replayMinutes(st: RweState, to: number, inputs: RweInputs): { days: RweDayOut[]; minutes: number } {
  const from = st.lastDecided + M;
  const days: RweDayOut[] = [];
  if (to < from) return { days, minutes: 0 };
  const excluded = excludedByDay(inputs.selection);
  const byMinute = new Map<number, RweMinuteRow[]>();
  for (const r of inputs.rows) {
    const t = Date.parse(r.minute);
    if (t < from || t > to) continue;
    (byMinute.get(t) ?? byMinute.set(t, []).get(t)!).push(r);
  }
  for (const list of byMinute.values()) list.sort((x, y) => (x.cond < y.cond ? -1 : x.cond > y.cond ? 1 : 0));
  // A minute's fills in the order of the prints that proved them.
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
  // The run that settled a market had decided up to two minutes before its own minute.
  const settleAfter = new Map<number, RweSettlement[]>();
  for (const s of inputs.settlements) {
    const t = Math.floor(Date.parse(s.settled_at) / M) * M - 2 * M;
    (settleAfter.get(t) ?? settleAfter.set(t, []).get(t)!).push(s);
  }
  const rwDay = new Map(inputs.rwDays.map((d) => [String(d.day).slice(0, 10), d]));

  const closeDay = () => {
    const day = dayStr(st.dayOf);
    for (const arm of ["rw", "e"] as const) {
      const a = st.arms[arm];
      const s = snapshot({ acc: a.acc } as unknown as RwState, a.dayActive);
      const detail: Record<string, unknown> = { perMarket: s.perMarket, active: a.dayActive };
      if (arm === "e") detail.excluded = [...(excluded.get(day) ?? [])].sort();
      if (arm === "rw") {
        const own = rwDay.get(day);
        if (own) {
          const gap = { total: s.total - Number(own.total), stress: s.stress - Number(own.stress_total), reward: s.reward - Number(own.reward), fills: s.fills - Number(own.fills) };
          detail.check = gap;
          st.checkMaxUsd = Math.max(st.checkMaxUsd, Math.abs(gap.total), Math.abs(gap.stress), Math.abs(gap.reward), Math.abs(gap.fills));
        } else detail.check = null;
      }
      days.push({ day, arm, total: s.total, stress_total: s.stress, reward: s.reward, fills: s.fills, capital: s.capital, markets: a.dayActive.length, detail });
    }
    st.dayOf += DAY;
    for (const arm of ["rw", "e"] as const) {
      const a = st.arms[arm];
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
      // The rw arm's inventory before this minute, which is the one the recorded decision was made on.
      const rwNetBefore = st.arms.rw.acc[c]?.net ?? 0;
      for (const arm of ["rw", "e"] as const) {
        const a = st.arms[arm];
        const quoting = r.quoting && !(arm === "e" && dayExcluded?.has(c));
        if (!quoting && !a.acc[c]) continue;
        const acc = (a.acc[c] ??= newAcc());
        if (acc.settled != null) continue;
        if (row && row[2] !== null && row[3] !== null) { acc.lastAb = row[2]; acc.lastAa = row[3]; }
        if (quoting) {
          if (arm === "e" && acc.net !== rwNetBefore) {
            // RW-E holds a different amount from RW here: the recorded decision is not RW-E's. Run the rule itself.
            const meta = metaFor(inputs.selection, c, t);
            if (meta && row) {
              if (!st.diverged.includes(c)) st.diverged.push(c);
              stepRw(acc, t / 1000, row, tick, Number(meta.v), Number(meta.rate), sizeN(Number(meta.min_size)), printsOf.get(c) ?? []);
            }
          } else if (recorded) {
            acc.lastM = Number(r.m);
            acc.quotedMinutes++;
            if (acc.firstCap === null) {
              const meta = metaFor(inputs.selection, c, t);
              acc.firstCap = sizeN(Number(meta?.min_size ?? 0)) * (Number(r.b) + 1 - Number(r.a));
            }
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
      for (const arm of ["rw", "e"] as const) {
        const acc = st.arms[arm].acc[s.cond];
        if (acc && acc.settled == null) acc.settled = Number(s.payout);
      }
    }
    st.lastDecided = t;
    minutes++;
  }
  if (st.lastDecided === RW_RUN_END - M && st.dayOf < RW_RUN_END) closeDay();
  return { days, minutes };
}

/**
 * One run: take the lease, replay what RW has decided since the last run (at most `RWE_MAX_MINUTES`), write the days it
 * closed and the state. It never runs ahead of RW, whose minutes are final only once decided.
 */
export async function runPmrwE(d: RweDeps): Promise<RweReport> {
  const report: RweReport = { minutes: 0, from: null, to: null, days: 0, diverged: 0, errors: [] };
  const held = await d.db.claim("agent_locks", `name=eq.pmrw-e&lease_until=lt.${encodeURIComponent(iso(d.now))}`, { lease_until: iso(d.now + RWE_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the pmrw-e lease" };
  try {
    const [own] = await d.db.select<{ state: RweState | Record<string, never> }>("pm_rw_e_state", "id=eq.1&select=state");
    const st: RweState = own?.state && "arms" in own.state ? own.state as RweState : newRweState();
    if (st.dayOf >= RW_RUN_END) return { ...report, skipped: "the fourteen days are over" };
    const [rw] = await d.db.select<{ last_minute: string | null }>("pm_rw_state", "id=eq.1&select=last_minute");
    const rwLast = rw?.last_minute ? Date.parse(rw.last_minute) : NaN;
    if (!Number.isFinite(rwLast)) return { ...report, skipped: "RW has decided nothing yet" };
    const from = st.lastDecided + M;
    const to = Math.min(rwLast, from + (RWE_MAX_MINUTES - 1) * M, RW_RUN_END - M);
    if (to < from) return { ...report, skipped: "nothing new from RW" };
    const lo = encodeURIComponent(iso(from)), hi = encodeURIComponent(iso(to)), hiPrints = encodeURIComponent(iso(to + M));
    const [rows, fills, prints, selection, settlements, rwDays] = await Promise.all([
      d.db.selectAll<RweMinuteRow>("pm_rw_minutes", `minute=gte.${lo}&minute=lte.${hi}&select=cond,minute,quoting,tick,bb,ba,ab,aa,q1,q2,m,b,a,reward&order=minute.asc,cond.asc`),
      d.db.selectAll<RweFillRow>("pm_rw_fills", `minute=gte.${lo}&minute=lte.${hi}&select=cond,minute,ts,side,price,size,print_id&order=cond.asc,minute.asc,print_id.asc`),
      d.db.selectAll<RwePrintRow>("pm_rw_prints", `ts=gte.${lo}&ts=lte.${hiPrints}&select=id,cond,ts,side,oi,price,size&order=ts.asc,id.asc`),
      d.db.select<RweSelRow>("pm_rw_selection", `day=lte.${dayStr(to)}&select=day,cond,tick,v,min_size,rate,end_date,q,cat&order=day.asc,cond.asc&limit=1000`),
      d.db.select<RweSettlement>("pm_rw_settlements", "select=cond,payout,settled_at&order=cond.asc&limit=1000"),
      d.db.select<RweDayRow>("pm_rw_days", "select=day,total,stress_total,reward,fills&order=day.asc&limit=100"),
    ]);
    const diverged0 = st.diverged.length;
    const out = replayMinutes(st, to, { rows, fills, prints, selection, settlements, rwDays });
    if (out.days.length) await d.db.upsert("pm_rw_e_days", out.days.map((x) => ({ ...x, closed_at: iso(d.now) })), "day,arm");
    await d.db.upsert("pm_rw_e_state", [{ id: 1, state: st, last_minute: iso(st.lastDecided), updated_at: iso(d.now), last_error: null }], "id");
    return { ...report, minutes: out.minutes, from, to, days: out.days.length, diverged: st.diverged.length - diverged0 };
  } catch (e) {
    report.errors.push(msg(e));
    try { await d.db.update("pm_rw_e_state", "id=eq.1", { last_error: msg(e), updated_at: iso(d.now) }); } catch { /* the error is in the report */ }
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.pmrw-e&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* the lease expires on its own */ }
  }
}
