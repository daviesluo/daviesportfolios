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
//
// The forward replay runs on RW-C's stored minutes too (`RWCX_REPLAY`, `0069`): the RW-NEXT pre-registration replays
// the same arms on RW-C's fourteen days with every "from" at RW-C's first minute (`RWCX_SPECS`).
//
// Two arms added on 2026-10-02 (`reviews/2026-10-02-polymarket-rw-rest-prereg.md`, Davies: two more variants on the
// best one so far, x1) move where the quotes rest (`RwxRest`): x4 rests both a whole number of ticks further from the
// mid while the minute keeps nine tenths of RW's reward, x5 moves the quote that would add to what it holds a tick out
// for every whole N it holds. Neither re-implements the rule: RW's own `quote` places the moved quotes, from a book whose
// raw touch is put a tick outside them (`restRow`), and RW's own `stepRw` scores, fills and books them. Until their rule
// starts they are x1, so a state that does not hold them yet starts them as a copy of x1 (`seed`).

import {
  newAcc, othersOf, quote, RW_DECIDE_LAG_MS, RW_INSTANCE, RW_INV_CAP, RW_RUN_END, RW_RUN_START, RWC_INSTANCE, RWC_RUN_START, scoreS, sizeN, snapshot, stepRw,
  type Acc, type BookRow, type Quote, type RwInstance, type RwState,
} from "/home/user/daviesportfolios/supabase/functions/agents/pmrw.ts";
import { printOrder, type PmPrint } from "/home/user/daviesportfolios/supabase/functions/_shared/polymarket_public.ts";
import {
  applyFill, bookRow, excludedByDay, metaFor, RWE_START,
  type RweDayRow, type RweFillRow, type RweInputs, type RweMinuteRow, type RwePrintRow, type RweSelRow, type RweSettlement,
} from "/home/user/daviesportfolios/supabase/functions/agents/pmrw_e.ts";
import type { Db } from "/home/user/daviesportfolios/supabase/functions/agents/db.ts";

const M = 60e3, DAY = 86400e3;

/** One arm's rule. Times are ms; before `from` the arm is RW (or RW-E, from `noSameDayFrom`). */
export type RwxSpec = {
  id: string;
  noSameDayFrom: number | null;               // RW-E's rule from this minute: not quoted on a day its scheduled end falls inside
  from: number;                               // the rules below apply from this minute
  noCats?: string[];                          // categories (the selection's `cat`) not quoted
  invCap?: number;                            // a side stops quoting at invCap × N of inventory its way (RW's is 3)
  pause?: { cents: number; minutes: number }; // after the adjusted mid moves `cents` or more between minutes, not quoted for `minutes`
  rest?: RwxRest;                             // where its quotes rest, from `rest.from`: RW's moved whole ticks out
  /**
   * An arm added to a running replay: until its own first minute (`rwxArmStart`) it is the arm named here, rule for
   * rule, so a stored state that does not hold it yet starts it as a copy of that arm, or not at all once that minute
   * has been replayed without it.
   */
  seed?: string;
  /** STUDY ONLY: a market this returns true for is not quoted from `from`, as noCats. */
  skip?: (cond: string, t: number) => boolean;
};
/**
 * Where an arm's quotes rest (pre-registration `reviews/2026-10-02-polymarket-rw-rest-prereg.md`), from `from`. `wide`:
 * both of RW's quotes move away from the adjusted mid by the most whole ticks that keep the minute's reward at least
 * `keep` of the reward at RW's own quotes (`wideTicks`). `lean`: the quote that would add to what the arm holds moves
 * one whole tick out for every whole N it holds (`leanTicks`). Before `from` the arm quotes where RW does.
 */
export type RwxRest = { rule: "wide"; from: number; keep: number } | { rule: "lean"; from: number };
/** The minute an arm's own record starts: its quotes' rule's when it has one, its other rules' otherwise. */
export const rwxArmStart = (spec: RwxSpec): number => spec.rest?.from ?? spec.from;
export type RwxArmState = {
  acc: Record<string, Acc>; dayActive: string[]; diverged: string[]; pausedUntil: Record<string, number>; lastMid: Record<string, number>;
  pauses?: Record<string, Array<[number, number]>>;   // bookkeeping for the page: each market's paused spans, [from, until) in ms
  base?: Record<string, Acc>;                         // bookkeeping for the page: the accounts at the arm's `from`, before it
};
export type RwxState = { lastDecided: number; dayOf: number; arms: Record<string, RwxArmState>; checkMaxUsd: number };
export type RwxDayOut = { day: string; arm: string; total: number; stress_total: number; reward: number; fills: number; capital: number; markets: number; detail: Record<string, unknown> };

const iso = (ms: number) => new Date(ms).toISOString();
const dayStr = (ms: number) => iso(Math.floor(ms / DAY) * DAY).slice(0, 10);
const newArm = (): RwxArmState => ({ acc: {}, dayActive: [], diverged: [], pausedUntil: {}, lastMid: {} });

/** The fresh state: the source's start (RW's unless `start` names another), nothing held, every arm the source. */
export const newRwxState = (specs: RwxSpec[], start = RW_RUN_START): RwxState => ({
  lastDecided: start - M, dayOf: start, checkMaxUsd: 0,
  arms: Object.fromEntries([["rw", newArm()], ...specs.map((s) => [s.id, newArm()])]),
});

/** Whether an arm quotes a market this minute, before its inventory is read: RW's decision, less what its rule leaves out. */
function armQuotes(spec: RwxSpec, a: RwxArmState, c: string, t: number, recordedQuoting: boolean, sameDayOut: boolean, cat: string | null, mid: number | null): boolean {
  let q = recordedQuoting;
  if (spec.noSameDayFrom !== null && t >= spec.noSameDayFrom && sameDayOut) q = false;
  if (t >= spec.from) {
    if (spec.noCats && cat !== null && spec.noCats.includes(cat)) q = false;
    if (spec.skip && spec.skip(c, t)) q = false;
    if (spec.pause && mid !== null) {
      const prev = a.lastMid[c];
      if (prev !== undefined && Math.abs(mid - prev) * 100 >= spec.pause.cents - 1e-9) {
        a.pausedUntil[c] = t + spec.pause.minutes * M;
        // The page's record of the span (a jump inside a pause extends the last span); the accounts never read it.
        const spans = ((a.pauses ??= {})[c] ??= []);
        const last = spans.at(-1);
        if (last && last[1] >= t) last[1] = a.pausedUntil[c];
        else spans.push([t, a.pausedUntil[c]]);
      }
      if ((a.pausedUntil[c] ?? 0) > t) q = false;
    }
  }
  if (mid !== null) a.lastMid[c] = mid;
  return q;
}

/** A price's index on the minute's tick grid: RW's quotes are whole ticks (`floorTick`, `ceilTick`). */
const onGrid = (price: number, tick: number) => Math.round(price / tick);
/**
 * Whether a quote `s` cents from the adjusted mid is inside a reward band of `v` cents. The band's edge scores zero
 * (`scoreS`), but a price on the tick grid reaches it through floating point a hair either side — 0.50 − 0.47 is
 * 0.02999…97 — and RW's `scoreS` then gives it a score of 1e-30 that would take the whole of an empty pool. A moved quote
 * must be inside by more than that rounding, never at the edge.
 */
const inBand = (v: number, s: number) => s >= 0 && s < v - 1e-9;

/**
 * The `wide` rule's move in one minute: the most whole ticks j by which both of RW's quotes (`b`, `a`) can move away from
 * the adjusted mid `m` while both stay inside (0, 1) and inside the reward band, and the minute's reward at them stays
 * at least `keep` of the reward at RW's own, both sides quoted and the others' score as RW reads it from the book
 * (`othersOf`; the pool's rate cancels). 0 when RW's quotes earn nothing.
 */
export function wideTicks(m: number, b: number, a: number, others: number, tick: number, v: number, N: number, keep: number): number {
  const kb = onGrid(b, tick), ka = onGrid(a, tick), top = onGrid(1, tick);
  const sb = (j: number) => (m - (kb - j) * tick) * 100, sa = (j: number) => ((ka + j) * tick - m) * 100;
  const share = (j: number) => {
    const ours = Math.min(scoreS(v, sb(j)) * N, scoreS(v, sa(j)) * N);
    return ours > 0 ? ours / (ours + others) : 0;
  };
  const r0 = share(0);
  if (!(r0 > 0)) return 0;
  let j = 0;
  while (kb - j - 1 >= 1 && ka + j + 1 <= top - 1 && inBand(v, sb(j + 1)) && inBand(v, sa(j + 1)) && share(j + 1) >= keep * r0) j++;
  return j;
}

/**
 * The `lean` rule's move in one minute: while the arm holds at least N, the quote that would add to it — the bid while
 * long, the ask while short — moves away from the adjusted mid one whole tick for every whole N held, as far as it stays
 * inside (0, 1) and inside the reward band. The other quote is RW's. `net` is what the arm holds as the minute begins.
 */
export function leanTicks(m: number, b: number, a: number, tick: number, v: number, N: number, net: number): { bid: number; ask: number } {
  const k = Math.floor(Math.abs(net) / N + 1e-9);
  const kb = onGrid(b, tick), ka = onGrid(a, tick), top = onGrid(1, tick);
  let j = 0;
  if (net > 0) {
    while (j < k && kb - j - 1 >= 1 && inBand(v, (m - (kb - j - 1) * tick) * 100)) j++;
    return { bid: j, ask: 0 };
  }
  if (net < 0) {
    while (j < k && ka + j + 1 <= top - 1 && inBand(v, ((ka + j + 1) * tick - m) * 100)) j++;
    return { bid: 0, ask: j };
  }
  return { bid: 0, ask: 0 };
}

/**
 * A minute's book with its raw touch one tick outside the quotes an arm's rule moved, so that RW's own `quote` rests
 * them there: RW's bid `out.bid` whole ticks lower and its ask `out.ask` higher, with the adjusted touch and the
 * others' scores as recorded, so the mid, the scores and the pool's split are RW's own. `q` is RW's `quote` of `row`.
 */
export function restRow(row: BookRow, q: Quote, tick: number, out: { bid: number; ask: number }): BookRow {
  return [(onGrid(q.b, tick) - out.bid - 1) * tick, (onGrid(q.a, tick) + out.ask + 1) * tick, row[2], row[3], row[4], row[5]];
}

/**
 * Each market's prints by the minute their second falls in, read back a minute at a time: the minute's bucket and the
 * next, which hold every print in (t, t + 60 s] — the ones `stepRw` keeps — in the order of the market's list. An arm that
 * runs the rule on every minute (x4, x5) then reads a minute's prints rather than the whole run's, which `stepRw` would
 * scan minute after minute. Measured 2026-10-02 in this repository's container on a 720-minute catch-up of 80 markets
 * with 108,352 prints (RW's last 720 minutes held 44 markets and 302): the replay took 1,046 ms with x4 and x5 reading
 * the whole run's prints, 676 ms reading the minute's, 392 ms before they existed — of the 2 s of CPU an Edge request has.
 */
export function minutePrints(printsOf: Map<string, PmPrint[]>): (cond: string, t: number) => PmPrint[] {
  const byMinute = new Map<string, PmPrint[]>();
  for (const [c, list] of printsOf) {
    for (const p of list) {
      const k = `${c}|${Math.floor(p.ts / 60)}`;
      (byMinute.get(k) ?? byMinute.set(k, []).get(k)!).push(p);
    }
  }
  return (cond, t) => {
    const k = Math.floor(t / M);
    return [...(byMinute.get(`${cond}|${k}`) ?? []), ...(byMinute.get(`${cond}|${k + 1}`) ?? [])];
  };
}

/** How far an arm's rule moves RW's quotes in a minute, in whole ticks out on each side; null when RW's book quotes nothing. */
export function restTicks(rest: RwxRest, row: BookRow, tick: number, v: number, N: number, net: number): { q: Quote; out: { bid: number; ask: number } } | null {
  const q = quote(row, tick);
  if (!q) return null;
  if (rest.rule === "wide") {
    const j = wideTicks(q.m, q.b, q.a, othersOf(q.m, q.q1, q.q2), tick, v, N, rest.keep);
    return { q, out: { bid: j, ask: j } };
  }
  return { q, out: leanTicks(q.m, q.b, q.a, tick, v, N, net) };
}

/**
 * Replay the minutes (st.lastDecided, to] of RW's stored record in every arm. Pure: every read is in `inputs`, and the
 * day rows it closes are returned. RW-E's order: minute by minute, a day closed before its first minute past midnight,
 * the rows of a minute by market, and a settlement after the last minute its run decided. `end` is where the source's
 * fourteen days end (RW's unless it names another run's).
 */
export function replayArms(st: RwxState, to: number, inputs: RweInputs, specs: RwxSpec[], end = RW_RUN_END): { days: RwxDayOut[]; minutes: number } {
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
  const printsAt = minutePrints(printsOf);
  const settleAfter = new Map<number, RweSettlement[]>();
  for (const s of inputs.settlements) {
    const t = Math.floor(Date.parse(s.settled_at) / M) * M - 2 * M;
    (settleAfter.get(t) ?? settleAfter.set(t, []).get(t)!).push(s);
  }
  const rwDay = new Map(inputs.rwDays.map((d) => [String(d.day).slice(0, 10), d]));
  // An arm added to a running replay is its seed until its own first minute, so a state that does not hold it yet starts
  // it as a copy of the seed, the page's base left to that minute. Once that minute is replayed without it, it cannot be
  // started, and it is left out of every minute after (its pre-registration's slip rule).
  for (const s of specs) {
    const seed = s.seed && !st.arms[s.id] ? st.arms[s.seed] : undefined;
    if (seed && st.lastDecided < rwxArmStart(s)) {
      const copy = structuredClone(seed);
      delete copy.base;
      st.arms[s.id] = copy;
    }
  }
  const live = specs.filter((s) => !s.seed || st.arms[s.id]);
  const ids = ["rw", ...live.map((s) => s.id)];
  const specOf = new Map(live.map((s) => [s.id, s]));
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
    // The page shows an arm only from its own first minute (Davies, 2026-09-27), against what it held as that began.
    for (const spec of live) if (t === rwxArmStart(spec)) st.arms[spec.id].base = structuredClone(st.arms[spec.id].acc);
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
          // Where the arm's own rule rests its quotes from its minute, in whole ticks out from RW's (on what it holds now).
          const rest = spec?.rest && t >= spec.rest.from && meta && row ? restTicks(spec.rest, row, tick, Number(meta.v), N, acc.net) : null;
          const moved = rest !== null && (rest.out.bid > 0 || rest.out.ask > 0);
          // RW's recorded decision is this arm's while it holds what RW held, its cap quotes the sides RW's did, and its
          // quotes rest where RW's did.
          const same = !moved && acc.net === rwNetBefore &&
            (acc.net < cap * N) === (acc.net < RW_INV_CAP * N) && (acc.net > -cap * N) === (acc.net > -RW_INV_CAP * N);
          if (spec && !same) {
            if (meta && row) {
              if (!a.diverged.includes(c)) a.diverged.push(c);
              // An arm with a rule of where it rests reads the minute's prints alone (`minutePrints`: the same fills).
              const prints = spec.rest ? printsAt(c, t) : printsOf.get(c) ?? [];
              stepRw(acc, t / 1000, moved ? restRow(row, rest!.q, tick, rest!.out) : row, tick, Number(meta.v), Number(meta.rate), N, prints, 0, cap);
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
  if (st.lastDecided === end - M && st.dayOf < end) closeDay();
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

/** RW-X's first minute: 2026-09-28 00:00 UTC, the first its pre-registration judges. */
export const RWX_START = Date.UTC(2026, 8, 28);
/**
 * The first minute of x4's and x5's own rules: 2026-10-02 20:00 UTC, moved forward from 2026-10-03 00:00 by the
 * pre-registration's Addendum 1 on Davies' word ("Reward quotes variant-3和4现在就开始测试 不要等"), written before it.
 * Test 1 still judges 10-03 → 10-08 from the 10-02 rows; the four hours before are a run-in the page shows.
 */
export const RWX_REST_START = Date.UTC(2026, 9, 2, 20);
/** The `wide` rule keeps at least nine tenths of the reward RW's own quotes earn in each minute (x4). */
export const RWX_WIDE_KEEP = 0.9;
/**
 * The arms the forward replay runs. The first four are frozen by `reviews/2026-09-27-polymarket-rw-variants-prereg.md`:
 * `e` is RW-E (its rule from RW-E's first minute), the second check; `x1`–`x3` are RW-E plus each rule from RW-X's first
 * minute. `x4` and `x5`, frozen by `reviews/2026-10-02-polymarket-rw-rest-prereg.md`, are x1 exactly plus where their
 * quotes rest from `RWX_REST_START` (its Addendum 1), and were added to the running replay as copies of x1 (`seed`).
 */
export const RWX_SPECS: RwxSpec[] = [
  { id: "e", noSameDayFrom: RWE_START, from: RWE_START },
  { id: "x1", noSameDayFrom: RWE_START, from: RWX_START, noCats: ["weather_fees"] },
  { id: "x2", noSameDayFrom: RWE_START, from: RWX_START, pause: { cents: 15, minutes: 60 } },
  { id: "x3", noSameDayFrom: RWE_START, from: RWX_START, noCats: ["weather_fees"], pause: { cents: 15, minutes: 60 } },
  { id: "x4", noSameDayFrom: RWE_START, from: RWX_START, noCats: ["weather_fees"], rest: { rule: "wide", from: RWX_REST_START, keep: RWX_WIDE_KEEP }, seed: "x1" },
  { id: "x5", noSameDayFrom: RWE_START, from: RWX_START, noCats: ["weather_fees"], rest: { rule: "lean", from: RWX_REST_START }, seed: "x1" },
];
/**
 * The page's names (Davies), numbered after RW-E's "Reward quotes variant-1", one line each, the rule not shown on the
 * site. x1 (no weather) is variant-2 since 2026-09-27. variant-3 and variant-4 were x2 (a pause after a jump) and x3
 * (both) until 2026-10-02, when Davies took the pause off the page and asked for two more variants on x1, numbered from
 * variant-3: x4 (wider) and x5 (leaning against what it holds). x2 and x3 have no page name: the replay still runs them.
 */
export const RWX_NAMES: Record<string, string> = {
  x1: "Reward quotes variant-2", x4: "Reward quotes variant-3", x5: "Reward quotes variant-4",
};
/**
 * The replay's rule version: a stored state of another is replayed again from RW's start. 2 (2026-09-27, the same
 * rules): each arm keeps its accounts at its own first minute (`base`), which a version-1 state had passed for `e`.
 */
export const RWX_STATE_VERSION = 2;
/** Minutes replayed in one run at most, as RW-E's. */
export const RWX_MAX_MINUTES = 720;
export const RWX_LEASE_MS = 240e3;

/**
 * One forward replay of the arms: the engine run whose stored minutes it reads (`source`), its own state and day tables,
 * its `agent_locks` row, the arms, and the day table of RW-E's own replay of the same run (`eDays`, the second check).
 * Before `quietUntil` a call returns at once and reads nothing.
 */
export type RwxReplay = {
  source: RwInstance; tables: { state: string; days: string }; lock: string; specs: RwxSpec[]; eDays: string; quietUntil: number | null;
};
/** The variants beside RW-E on RW's minutes (0064): exactly the names and arms the replay had before it took a replay. */
export const RWX_REPLAY: RwxReplay = {
  source: RW_INSTANCE, tables: { state: "pm_rw_x_state", days: "pm_rw_x_days" }, lock: "pmrw-x", specs: RWX_SPECS, eDays: "pm_rw_e_days",
  quietUntil: null,
};
/**
 * The same arms on RW-C's fourteen days (the RW-NEXT pre-registration, part 2): each frozen rule unchanged, with every
 * "from" — RW-E's, the variant's own and, for x4 and x5, their quotes' (their pre-registration's forward window) — at
 * RW-C's first minute.
 */
export const RWCX_SPECS: RwxSpec[] = RWX_SPECS.map((s) => ({
  ...s, noSameDayFrom: RWC_RUN_START, from: RWC_RUN_START, ...(s.rest ? { rest: { ...s.rest, from: RWC_RUN_START } } : {}),
}));
/** RW-C's (0069): its minutes, its own tables and lease; checked against RW-E's replay of RW-C (`pm_rwc_e_days`). */
export const RWCX_REPLAY: RwxReplay = {
  source: RWC_INSTANCE, tables: { state: "pm_rwc_x_state", days: "pm_rwc_x_days" }, lock: "pmrwc-x", specs: RWCX_SPECS, eDays: "pm_rwc_e_days",
  quietUntil: RWC_RUN_START + RW_DECIDE_LAG_MS,
};

export type RwxStored = RwxState & { version: number; checkEMaxUsd: number; checkEDays?: number };
export type RwxReport = { skipped?: string; minutes: number; from: number | null; to: number | null; days: number; errors: string[] };

/**
 * One run of the forward replay: take the lease, replay what RW has decided since the last run (at most
 * `RWX_MAX_MINUTES`), write the days it closed and the state. Its `e` arm's closed days are checked against RW-E's own
 * (`pm_rw_e_days`, arm `e`), the pre-registration's second check, on every run and over every day both have closed:
 * RW-E's replay runs beside this one and may close a day a minute later. The `rw` arm is checked against RW's days
 * inside the replay, which RW has always closed first. `d.replay` names another run to replay, RW-C's (`RWCX_REPLAY`).
 */
export async function runPmrwX(d: { db: Db; now: number; holder: string; replay?: RwxReplay }): Promise<RwxReport> {
  const replay = d.replay ?? RWX_REPLAY, src = replay.source, S = src.tables;
  const report: RwxReport = { minutes: 0, from: null, to: null, days: 0, errors: [] };
  if (replay.quietUntil !== null && d.now < replay.quietUntil) return { ...report, skipped: `before ${src.name}'s first minute is decided` };
  const held = await d.db.claim("agent_locks", `name=eq.${replay.lock}&lease_until=lt.${encodeURIComponent(iso(d.now))}`, { lease_until: iso(d.now + RWX_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: `another run holds the ${replay.lock} lease` };
  try {
    const [own] = await d.db.select<{ state: RwxStored | Record<string, never> }>(replay.tables.state, "id=eq.1&select=state");
    const stored = own?.state && "arms" in own.state ? own.state as RwxStored : null;
    const st: RwxStored = stored && stored.version === RWX_STATE_VERSION ? stored : { ...newRwxState(replay.specs, src.runStart), version: RWX_STATE_VERSION, checkEMaxUsd: 0 };
    if (st.dayOf >= src.runEnd) return { ...report, skipped: "the fourteen days are over" };
    const [rw] = await d.db.select<{ last_minute: string | null }>(S.state, "id=eq.1&select=last_minute");
    const rwLast = rw?.last_minute ? Date.parse(rw.last_minute) : NaN;
    if (!Number.isFinite(rwLast)) return { ...report, skipped: `${src.name} has decided nothing yet` };
    const from = st.lastDecided + M;
    const to = Math.min(rwLast, from + (RWX_MAX_MINUTES - 1) * M, src.runEnd - M);
    if (to < from) return { ...report, skipped: `nothing new from ${src.name}` };
    const lo = encodeURIComponent(iso(from)), hi = encodeURIComponent(iso(to)), hiPrints = encodeURIComponent(iso(to + M));
    const [rows, fills, prints, selection, settlements, rwDays, eDays, xeDays] = await Promise.all([
      d.db.selectAll<RweMinuteRow>(S.minutes, `minute=gte.${lo}&minute=lte.${hi}&select=cond,minute,quoting,tick,bb,ba,ab,aa,q1,q2,m,b,a,reward&order=minute.asc,cond.asc`),
      d.db.selectAll<RweFillRow>(S.fills, `minute=gte.${lo}&minute=lte.${hi}&select=cond,minute,ts,side,price,size,print_id&order=cond.asc,minute.asc,print_id.asc`),
      d.db.selectAll<RwePrintRow>(S.prints, `ts=gte.${lo}&ts=lte.${hiPrints}&select=id,cond,ts,side,oi,price,size&order=ts.asc,id.asc`),
      d.db.select<RweSelRow>(S.selection, `day=lte.${dayStr(to)}&select=day,cond,tick,v,min_size,rate,end_date,q,cat&order=day.asc,cond.asc&limit=1000`),
      d.db.select<RweSettlement>(S.settlements, "select=cond,payout,settled_at&order=cond.asc&limit=1000"),
      d.db.select<RweDayRow>(S.days, "select=day,total,stress_total,reward,fills&order=day.asc&limit=100"),
      d.db.select<RweDayRow & { arm: string }>(replay.eDays, "arm=eq.e&select=day,arm,total,stress_total,reward,fills&order=day.asc&limit=100"),
      d.db.select<RweDayRow>(replay.tables.days, "arm=eq.e&select=day,total,stress_total,reward,fills&order=day.asc&limit=100"),
    ]);
    const out = replayArms(st, to, { rows, fills, prints, selection, settlements, rwDays }, replay.specs, src.runEnd);
    // The second check: the e arm is RW-E, day for day, over every day both have closed. A row of a day this state has
    // not closed is an older version's, and is not read.
    const eOwn = new Map(eDays.map((x) => [String(x.day).slice(0, 10), x]));
    const mine = new Map<string, { total: number | string; stress_total: number | string; reward: number | string; fills: number | string }>();
    for (const x of xeDays) if (Date.parse(`${String(x.day).slice(0, 10)}T00:00:00Z`) < st.dayOf) mine.set(String(x.day).slice(0, 10), x);
    for (const x of out.days) if (x.arm === "e") mine.set(x.day, x);
    const gapOf = (x: { total: number | string; stress_total: number | string; reward: number | string; fills: number | string }, own: RweDayRow) => ({
      total: Number(x.total) - Number(own.total), stress: Number(x.stress_total) - Number(own.stress_total),
      reward: Number(x.reward) - Number(own.reward), fills: Number(x.fills) - Number(own.fills),
    });
    let eMax = 0, eDaysChecked = 0;
    for (const [day, x] of mine) {
      const own = eOwn.get(day);
      if (!own) continue;
      const g = gapOf(x, own);
      eMax = Math.max(eMax, Math.abs(g.total), Math.abs(g.stress), Math.abs(g.reward), Math.abs(g.fills));
      eDaysChecked++;
    }
    for (const x of out.days) if (x.arm === "e") { const own = eOwn.get(x.day); x.detail.checkE = own ? gapOf(x, own) : null; }
    st.checkEMaxUsd = eMax;
    st.checkEDays = eDaysChecked;
    if (out.days.length) await d.db.upsert(replay.tables.days, out.days.map((x) => ({ ...x, closed_at: iso(d.now) })), "day,arm");
    await d.db.upsert(replay.tables.state, [{ id: 1, state: st, last_minute: iso(st.lastDecided), updated_at: iso(d.now), last_error: null }], "id");
    return { ...report, minutes: out.minutes, from, to, days: out.days.length };
  } catch (e) {
    const m = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    report.errors.push(m);
    try { await d.db.update(replay.tables.state, "id=eq.1", { last_error: m, updated_at: iso(d.now) }); } catch { /* the error is in the report */ }
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${replay.lock}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* the lease expires on its own */ }
  }
}
