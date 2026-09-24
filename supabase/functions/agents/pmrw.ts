// The paper test of RW (reference §3.33; spec `reviews/2026-09-24-polymarket-rw-paper-spec.md`): minimum-size
// two-sided quotes for Polymarket's liquidity rewards, run forward on PAPER for fourteen days.
//
// It is a notebook. Every input is a keyless public read (`_shared/polymarket_public.ts`); nothing is placed, no key is
// read, and nothing of the strategy rows or the stablecoin quotes reads its tables (`0053`). Two actions drive it:
// `pmrw-select` picks the day's portfolio once a UTC day, and `pmrw` runs every minute — it reads the books of the
// markets it quotes or holds, and decides each minute two minutes after it starts, when the minute's prints are public.
//
// The rule is RW's (`reviews/2026-09-24-polymarket-fp4-prereg-rw-reward-quotes.md`), ported line for line from
// `docs/agents/backtests/polymarket/scripts/rw_test.py` and `rw_inputs.py`: `summarize` is `summary()`, `quote`,
// `othersOf`, `firstScore` and `stepRw` are `quote()`, `others_of()`, `first_score()` and one minute of
// `run_market()`. `pmrw.test.ts` replays RW's recorded day through them and must reproduce rw_test.py's numbers.

import { pmBooks, pmMarkets, pmPrints, pmRewardsCurrent, pmSimplifiedMarkets, type PmLevel, type PmMarket, type PmPrint, type PmPublicOpts } from "../_shared/polymarket_public.ts";
import type { Db } from "./db.ts";

const M = 60e3, DAY = 86400e3;
export const RW_BUDGET_USD = 300;                // the portfolio's capital at selection (whole markets, RW's primary)
export const RW_MIN_RATE = 10;                   // the universe: a daily pool of at least $10
export const RW_MIN_N = 5;                       // the venue's minimum order, in shares
export const RW_INV_CAP = 3;                     // a side stops quoting at 3N of inventory its way
export const RW_LEVEL_WINDOW = 0.10;             // levels kept within 10 ¢ of the touch, as RW recorded them
export const RW_DECIDE_LAG_MS = 2 * M;           // a minute is decided two minutes after it starts
export const RW_LEASE_MS = 55e3;
export const RW_SELECT_LEASE_MS = 290e3;
export const RW_MAX_MINUTES = 240;               // minutes decided in one run at most
export const RW_STATUS_EVERY_MS = 10 * M;        // how often a quoted or held market's settlement is checked
/** The fourteen days the spec's bar reads: 2026-09-25 00:00 → 2026-10-09 00:00 UTC. Earlier minutes are a warm-up. */
export const RW_RUN_START = Date.UTC(2026, 8, 25);
export const RW_RUN_END = Date.UTC(2026, 9, 9);

/** A minute's book as the rule reads it (rw_inputs.py's row): the touch, the size-adjusted touch, the others' scores. */
export type BookRow = [bb: number, ba: number, ab: number | null, aa: number | null, q1: number, q2: number];
export type Quote = { m: number; b: number; a: number; q1: number; q2: number };

// -------------------------------------------------------------------------------------------------- the rule

/** Python's `round(x, nd)`: the exact binary value, rounded half to even, read back as the nearest double. */
export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const neg = hi >>> 31 === 1, eb = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (eb === 0) e = -1074; else { mant |= 1n << 52n; e = eb - 1075; }
  let num = mant * 10n ** BigInt(nd), den = 1n;
  if (e >= 0) num <<= BigInt(e); else den <<= BigInt(-e);
  let q = num / den;
  const twice = 2n * (num - q * den);
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return Number(`${neg ? "-" : ""}${q}e-${nd}`);
}

export const floorTick = (x: number, t: number) => Math.floor(x / t + 1e-9) * t;
export const ceilTick = (x: number, t: number) => Math.ceil(x / t - 1e-9) * t;
/** The programme's score of an order `s` cents from the adjusted midpoint, when the maximum spread is `v`. */
export const scoreS = (v: number, s: number) => (0 <= s && s < v ? ((v - s) / v) ** 2 : 0);

/**
 * A book (best level first on both sides) as the rule reads it: the levels within 10 ¢ of the touch (RW's recorder),
 * the best levels holding at least `minSize` (the size-cutoff-adjusted touch), and the others' scores within `v` of
 * the adjusted midpoint, rounded as rw_inputs.py stored them. No bid or no ask: no book.
 */
export function summarize(bidsIn: PmLevel[], asksIn: PmLevel[], v: number, minSize: number): BookRow | null {
  if (!bidsIn.length || !asksIn.length) return null;
  const bb0 = bidsIn[0][0], ba0 = asksIn[0][0];
  const bids = bidsIn.filter(([p]) => p >= bb0 - RW_LEVEL_WINDOW - 1e-9), asks = asksIn.filter(([p]) => p <= ba0 + RW_LEVEL_WINDOW + 1e-9);
  const bb = bids[0][0], ba = asks[0][0];
  const ab = bids.find(([, s]) => s >= minSize)?.[0] ?? null, aa = asks.find(([, s]) => s >= minSize)?.[0] ?? null;
  if (ab === null || aa === null) return [bb, ba, null, null, 0, 0];
  const m = (ab + aa) / 2;
  let q1 = 0, q2 = 0;
  for (const [p, s] of bids) {
    const d = (m - p) * 100;
    if (s >= minSize && 0 <= d && d < v) q1 += ((v - d) / v) ** 2 * s;
  }
  for (const [p, s] of asks) {
    const d = (p - m) * 100;
    if (s >= minSize && 0 <= d && d < v) q2 += ((v - d) / v) ** 2 * s;
  }
  return [bb, ba, ab, aa, pyRound(q1, 4), pyRound(q2, 4)];
}

/** Our bid and ask from a minute's row: a tick inside the touch, no closer than half a tick to `m`, never through. */
export function quote(row: BookRow, tick: number): Quote | null {
  const [bb, ba, ab, aa, q1, q2] = row;
  if (ab === null || aa === null) return null;
  const m = (ab + aa) / 2;
  let b = floorTick(Math.min(bb + tick, m - tick / 2), tick);
  let a = ceilTick(Math.max(ba - tick, m + tick / 2), tick);
  if (b >= ba - 1e-12) b = floorTick(ba - tick, tick);
  if (a <= bb + 1e-12) a = ceilTick(bb + tick, tick);
  if (b <= 0 || a >= 1 || b >= a - 1e-12) return null;
  return { m, b, a, q1, q2 };
}

/** The others' score the pool is shared against: two-sided in full, a third one-sided, the smaller side outside [0.10, 0.90]. */
export const othersOf = (m: number, q1: number, q2: number) => (0.10 <= m && m <= 0.90 ? Math.max(Math.min(q1, q2), (q1 + q2) / 3) : Math.min(q1, q2));

export const sizeN = (minSize: number, mult = 1) => Math.max(minSize, RW_MIN_N) * mult;

/** RW's selection score: the expected reward per dollar of capital at one book, and that book's capital. */
export function firstScore(row: BookRow | null, tick: number, v: number, minSize: number, rate: number): { perDollar: number; cap: number } | null {
  if (!row) return null;
  const q = quote(row, tick || 0.01);
  if (!q) return null;
  const N = sizeN(minSize);
  const ours = Math.min(scoreS(v, (q.m - q.b) * 100) * N, scoreS(v, (q.a - q.m) * 100) * N);
  const cap = N * (q.b + 1 - q.a);
  if (ours <= 0 || cap <= 0) return null;
  return { perDollar: rate / 1440 * ours / (ours + othersOf(q.m, q.q1, q.q2)) / cap, cap };
}

/** Rank by expected reward per dollar (ties by condition id), then take whole markets in that order within the budget. */
export function choose<T extends { cond: string; perDollar: number; cap: number }>(scored: T[], budget = RW_BUDGET_USD): T[] {
  const sorted = scored.slice().sort((x, y) => (y.perDollar - x.perDollar) || (x.cond < y.cond ? -1 : x.cond > y.cond ? 1 : 0));
  const out: T[] = [];
  let used = 0;
  for (const s of sorted) if (used + s.cap <= budget + 1e-9) { out.push(s); used += s.cap; }
  return out;
}

/** One market's running account. `tickCost` is what the fills would have cost a tick worse (the stress arm). */
export type Acc = {
  net: number; cash: number; reward: number; fills: number; fillShares: number; tickCost: number;
  firstCap: number | null; maxInvCost: number; lastM: number | null; lastAb: number | null; lastAa: number | null;
  quotedMinutes: number; settled: number | null;
};
export const newAcc = (): Acc => ({
  net: 0, cash: 0, reward: 0, fills: 0, fillShares: 0, tickCost: 0, firstCap: null, maxInvCost: 0, lastM: null, lastAb: null, lastAa: null,
  quotedMinutes: 0, settled: null,
});
export type RwFill = { ts: number; side: "bid" | "ask"; price: number; size: number; minuteSec: number; printId: string };
export type RwDecision = { m: number; b: number; a: number; ours: number; others: number; reward: number; qb: boolean; qa: boolean };

/**
 * One minute of RW for one quoting market: `run_market`'s loop body. `tSec` is the minute in Unix seconds; `prints` are
 * the market's prints in (t, t + 60 s], in RW's order. `tickWorse` and the reward multiplier exist for the replay of
 * RW's stress arm; the paper engine runs the rule as written and derives its stress from `tickCost`.
 */
export function stepRw(acc: Acc, tSec: number, row: BookRow | null, tick: number, v: number, rate: number, N: number, prints: PmPrint[], tickWorse = 0): { decision: RwDecision | null; fills: RwFill[] } {
  const q = row ? quote(row, tick) : null;
  if (!q) return { decision: null, fills: [] };
  const { m, b, a, q1, q2 } = q;
  acc.lastM = m;
  acc.lastAb = row![2]; acc.lastAa = row![3];
  acc.quotedMinutes++;
  if (acc.firstCap === null) acc.firstCap = N * (b + 1 - a);
  const qb = acc.net < RW_INV_CAP * N, qa = acc.net > -RW_INV_CAP * N;
  const ours = Math.min(qb ? scoreS(v, (m - b) * 100) * N : 0, qa ? scoreS(v, (a - m) * 100) * N : 0);
  const others = othersOf(m, q1, q2);
  let r = 0;
  if (ours > 0) { r = rate / 1440 * ours / (ours + others); acc.reward += r; }
  let bidLeft = qb ? N : 0, askLeft = qa ? N : 0;
  const fills: RwFill[] = [];
  for (const p of prints) {
    if (!(p.ts > tSec && p.ts <= tSec + 60)) continue;
    let ypx: number, dirn: "BUY" | "SELL";
    if (p.oi === 0) { ypx = p.price; dirn = p.side; } else if (p.oi === 1) { ypx = 1 - p.price; dirn = p.side === "BUY" ? "SELL" : "BUY"; } else continue;
    if (dirn === "SELL" && bidLeft > 0 && ypx < b - 1e-12) {
      const qf = Math.min(bidLeft, p.size);
      bidLeft -= qf;
      const px = b + tickWorse * tick;
      acc.net += qf; acc.cash -= qf * px; acc.fills++; acc.fillShares += qf; acc.tickCost += qf * tick;
      fills.push({ ts: p.ts, side: "bid", price: px, size: qf, minuteSec: tSec, printId: p.id });
      acc.maxInvCost = Math.max(acc.maxInvCost, acc.net * px);
    } else if (dirn === "BUY" && askLeft > 0 && ypx > a + 1e-12) {
      const qf = Math.min(askLeft, p.size);
      askLeft -= qf;
      const px = a - tickWorse * tick;
      acc.net -= qf; acc.cash += qf * px; acc.fills++; acc.fillShares += qf; acc.tickCost += qf * tick;
      fills.push({ ts: p.ts, side: "ask", price: px, size: qf, minuteSec: tSec, printId: p.id });
      acc.maxInvCost = Math.max(acc.maxInvCost, -acc.net * (1 - px));
    }
  }
  return { decision: { m, b, a, ours, others, reward: r, qb, qa }, fills };
}

/** Where `now` sits against the spec's fourteen days: before them (the warm-up, counted nowhere), in them, or after. */
export const rwPhase = (now: number): RwReport["phase"] => (now < RW_RUN_START ? "warm-up" : now < RW_RUN_END ? "run" : "after");

/** A market's value: rewards, the cash of its fills, and its inventory at the payout once settled, else at the adjusted mid. */
export const accTotal = (a: Acc) => a.reward + a.cash + a.net * (a.settled ?? a.lastM ?? 0);
/** The stress arm: rewards halved, every fill a tick worse, inventory at the adjusted touch (a long at the bid, a short at the ask). */
export const accStress = (a: Acc) =>
  a.reward * 0.5 + a.cash - a.tickCost + a.net * (a.settled ?? (a.net > 0 ? a.lastAb : a.net < 0 ? a.lastAa : null) ?? a.lastM ?? 0);
export const accCapital = (a: Acc) => (a.firstCap ?? 0) + a.maxInvCost;

// ------------------------------------------------------------------------------------------------- the driver

export type RwMeta = { yes: string; v: number; minSize: number; rate: number; tick: number; q: string; cat: string | null; day: string };
export type RwState = {
  lastDecided: number;                       // ms: the last minute decided
  acc: Record<string, Acc>;
  meta: Record<string, RwMeta>;              // every market ever selected, from its latest selection
  statusAt: number;                          // ms: the last settlement check
  dayOf: number;                             // ms: the UTC day whose minutes are being decided
  dayActive: string[];                       // markets that quoted or held inventory in it
};
export type RwReport = {
  skipped?: string; phase: "warm-up" | "run" | "after"; recorded: number; minutes: number; from: number | null; to: number | null; prints: number; fills: number;
  reward: number; settled: number; days: number; errors: string[];
};
export type RwDeps = { db: Db; now: number; holder: string; pm?: PmPublicOpts };

type MinuteRow = { cond: string; minute: string; quoting: boolean; tick: number; bb: number | null; ba: number | null; ab: number | null; aa: number | null; q1: number | null; q2: number | null };
type SelRow = { day: string; cond: string; yes: string; tick: number; v: number; min_size: number; rate: number; q: string | null; cat: string | null };

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const minuteOf = (ms: number) => Math.floor(ms / M) * M;
const dayStr = (ms: number) => iso(Math.floor(ms / DAY) * DAY).slice(0, 10);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const nz = (x: unknown) => (x === null || x === undefined ? null : Number(x));

/** The day's portfolio. A UTC day is quoted only on its own selection, from the minute it lands. */
async function daySelection(db: Db, now: number): Promise<SelRow[]> {
  return await db.select<SelRow>("pm_rw_selection", `day=eq.${dayStr(now)}&select=day,cond,yes,tick,v,min_size,rate,q,cat&order=rank.asc`);
}

/** Every market's value, stress and capital now, and the snapshot a day row keeps. */
export function snapshot(st: RwState, active: string[]) {
  let total = 0, stress = 0, reward = 0, fills = 0;
  const perMarket: Record<string, { total: number; stress: number }> = {};
  for (const [c, a] of Object.entries(st.acc)) {
    const t = accTotal(a), s = accStress(a);
    total += t; stress += s; reward += a.reward; fills += a.fills;
    perMarket[c] = { total: t, stress: s };
  }
  const capital = active.reduce((sum, c) => sum + (st.acc[c] ? accCapital(st.acc[c]) : 0), 0);
  return { total, stress, reward, fills, capital, perMarket };
}

/**
 * One run of the paper test: take the lease; read the current minute's books for every market quoted or held and store
 * them (a minute already stored is never rewritten); decide every recorded minute at least two minutes old, reading each
 * quoting market's prints; close each UTC day with a snapshot; every ten minutes, settle markets Gamma shows resolved.
 * The warm-up's book is closed at its marks when the fourteen days begin, so they start flat; after their last minute is
 * decided and their last day closed, a run does nothing.
 */
export async function runPmrw(d: RwDeps): Promise<RwReport> {
  const report: RwReport = { phase: rwPhase(d.now), recorded: 0, minutes: 0, from: null, to: null, prints: 0, fills: 0, reward: 0, settled: 0, days: 0, errors: [] };
  const held = await d.db.claim("agent_locks", `name=eq.pmrw&lease_until=lt.${encodeURIComponent(iso(d.now))}`, { lease_until: iso(d.now + RW_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another run holds the pmrw lease" };
  try {
    const nowMinute = minuteOf(d.now);
    const rows = await d.db.select<{ state: RwState | Record<string, never> }>("pm_rw_state", "id=eq.1&select=state");
    let st = rows[0]?.state as RwState | undefined;
    if (st && "acc" in st && st.dayOf >= RW_RUN_END) return { ...report, skipped: "the fourteen days are over" };
    const sel = await daySelection(d.db, d.now);
    if (!st || !("acc" in st)) {
      if (!sel.length) return { ...report, skipped: "no selection yet" };
      st = { lastDecided: nowMinute - M, acc: {}, meta: {}, statusAt: 0, dayOf: Math.floor(d.now / DAY) * DAY, dayActive: [] };
    }
    for (const s of sel) {
      st.meta[s.cond] = { yes: s.yes, v: Number(s.v), minSize: Number(s.min_size), rate: Number(s.rate), tick: Number(s.tick), q: s.q ?? "", cat: s.cat, day: s.day };
    }
    const quoting = new Set(sel.map((s) => s.cond).filter((c) => st!.acc[c]?.settled == null));
    const holding = Object.entries(st.acc).filter(([c, a]) => a.settled == null && a.net !== 0 && !quoting.has(c)).map(([c]) => c);

    // 1. This minute's books, once.
    const watch = [...quoting, ...holding];
    if (watch.length && nowMinute < RW_RUN_END) {
      const have = await d.db.select("pm_rw_minutes", `minute=eq.${encodeURIComponent(iso(nowMinute))}&select=cond&limit=1`);
      if (!have.length) {
        try {
          const books = await pmBooks(watch.map((c) => st!.meta[c].yes), d.pm);
          const out: MinuteRow[] = [];
          for (const c of watch) {
            const mt = st.meta[c], bk = books.get(mt.yes);
            if (!bk) continue;
            const row = summarize(bk.bids, bk.asks, mt.v, mt.minSize);
            if (!row) continue;
            out.push({ cond: c, minute: iso(nowMinute), quoting: quoting.has(c), tick: bk.tick ?? mt.tick, bb: row[0], ba: row[1], ab: row[2], aa: row[3], q1: row[4], q2: row[5] });
          }
          if (out.length) await d.db.upsert("pm_rw_minutes", out, "cond,minute");
          report.recorded = out.length;
        } catch (e) { report.errors.push(`books: ${msg(e)}`); }
      }
    }

    // 2. Decide every minute at least two minutes old.
    const from = st.lastDecided + M, to = Math.min(nowMinute - RW_DECIDE_LAG_MS, from + (RW_MAX_MINUTES - 1) * M, RW_RUN_END - M);
    if (to >= from) {
      const mrows = await d.db.selectAll<MinuteRow>("pm_rw_minutes", `minute=gte.${encodeURIComponent(iso(from))}&minute=lte.${encodeURIComponent(iso(to))}&select=cond,minute,quoting,tick,bb,ba,ab,aa,q1,q2&order=minute.asc,cond.asc`);
      const prints = new Map<string, PmPrint[]>();
      let ok = true;
      for (const c of new Set(mrows.filter((r) => r.quoting).map((r) => r.cond))) {
        try {
          const got = await pmPrints(c, Math.floor(from / 1000), d.pm);
          if (!got.complete) throw new Error("prints not complete");
          prints.set(c, got.prints);
          report.prints += got.prints.length;
          if (got.prints.length) await d.db.upsert("pm_rw_prints", got.prints.map((p) => ({ id: p.id, cond: c, ts: iso(p.ts * 1000), side: p.side, oi: p.oi, price: p.price, size: p.size })), "id");
        } catch (e) { ok = false; report.errors.push(`prints ${c.slice(0, 10)}: ${msg(e)}`); }
      }
      if (!ok) {
        // A minute is never decided without its prints: stop here, and the next run decides from the same place.
        await saveState(d, st, report.errors.join(" | "));
        return report;
      }
      const byMinute = new Map<number, MinuteRow[]>();
      for (const r of mrows) {
        const t = msOf(r.minute);
        (byMinute.get(t) ?? byMinute.set(t, []).get(t)!).push(r);
      }
      const decided: Record<string, unknown>[] = [], fills: Record<string, unknown>[] = [];
      for (let t = from; t <= to; t += M) {
        if (t >= st.dayOf + DAY) {
          await closeDays(d, st, t, report);
        }
        for (const r of byMinute.get(t) ?? []) {
          const c = r.cond, mt = st.meta[c];
          if (!mt || (!r.quoting && !st.acc[c])) continue;   // a holding the run's flat start closed
          const acc = (st.acc[c] ??= newAcc());
          if (acc.settled != null) continue;
          const row: BookRow | null = r.bb === null || r.ba === null ? null : [Number(r.bb), Number(r.ba), nz(r.ab), nz(r.aa), Number(r.q1 ?? 0), Number(r.q2 ?? 0)];
          if (row && row[2] !== null && row[3] !== null) { acc.lastAb = row[2]; acc.lastAa = row[3]; }
          if (r.quoting) {
            const tick = Number(r.tick) || mt.tick || 0.01;
            const out = stepRw(acc, t / 1000, row, tick, mt.v, mt.rate, sizeN(mt.minSize), prints.get(c) ?? []);
            if (out.decision) {
              decided.push({ cond: c, minute: r.minute, quoting: r.quoting, tick: r.tick, ...out.decision });
              report.reward += out.decision.reward;
            }
            for (const f of out.fills) fills.push({ cond: c, minute: r.minute, ts: iso(f.ts * 1000), side: f.side, price: f.price, size: f.size, print_id: f.printId });
            if (!st.dayActive.includes(c)) st.dayActive.push(c);
          } else if (row && row[2] !== null && row[3] !== null) {
            acc.lastM = (row[2] + row[3]) / 2;
            if (acc.net !== 0 && !st.dayActive.includes(c)) st.dayActive.push(c);
          }
        }
      }
      if (decided.length) await d.db.upsert("pm_rw_minutes", decided, "cond,minute");
      if (fills.length) await d.db.upsert("pm_rw_fills", fills, "cond,minute,print_id");
      report.fills = fills.length;
      report.minutes = (to - from) / M + 1; report.from = from; report.to = to;
      st.lastDecided = to;
      if (to === RW_RUN_END - M) await closeDays(d, st, RW_RUN_END, report);
    }

    // 3. Settlements.
    if (d.now - st.statusAt >= RW_STATUS_EVERY_MS) {
      const check = Object.entries(st.acc).filter(([, a]) => a.settled == null).map(([c]) => c);
      if (check.length) {
        try {
          for (const m of await pmMarkets(check, true, d.pm)) {
            const a = st.acc[m.cond];
            if (!a || a.settled != null || m.payout === null) continue;
            a.settled = m.payout;
            await d.db.upsert("pm_rw_settlements", [{ cond: m.cond, closed_time: m.closedTime, payout: m.payout, net: a.net, cash: a.cash, settled_at: iso(d.now) }], "cond");
            report.settled++;
          }
          st.statusAt = d.now;
        } catch (e) { report.errors.push(`settlements: ${msg(e)}`); }
      }
    }
    await saveState(d, st, report.errors.length ? report.errors.join(" | ").slice(0, 500) : null);
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.pmrw&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* the lease expires on its own */ }
  }
}

/**
 * Close every UTC day that ended before minute `t`: one row with the running totals as they stood at its end. When the
 * day closed is the warm-up's last, its book is closed at those marks and the fourteen days start flat, so the run's
 * totals and capital are its own.
 */
async function closeDays(d: RwDeps, st: RwState, t: number, report: RwReport) {
  while (t >= st.dayOf + DAY && st.dayOf < RW_RUN_END) {
    const s = snapshot(st, st.dayActive);
    await d.db.upsert("pm_rw_days", [{
      day: dayStr(st.dayOf), total: s.total, stress_total: s.stress, reward: s.reward, fills: s.fills, capital: s.capital,
      markets: st.dayActive.length, detail: { phase: rwPhase(st.dayOf), perMarket: s.perMarket, active: st.dayActive }, closed_at: iso(d.now),
    }], "day");
    report.days++;
    st.dayOf += DAY;
    if (st.dayOf === RW_RUN_START) st.acc = {};
    // A market still holding inventory is active in the new day from its first minute.
    st.dayActive = Object.entries(st.acc).filter(([, a]) => a.settled == null && a.net !== 0).map(([c]) => c);
  }
}

async function saveState(d: RwDeps, st: RwState, lastError: string | null = null) {
  await d.db.upsert("pm_rw_state", [{ id: 1, state: st, last_minute: iso(st.lastDecided), updated_at: iso(d.now), last_error: lastError }], "id");
}

// ---------------------------------------------------------------------------------------------- the selection

export type RwSelectReport = {
  skipped?: string; day: string; rewarded: number; booked: number; scored: number; checked: number; refused: number; mismatched: number; chosen: number; capital: number;
  errors: string[];
};

/**
 * The day's portfolio (the spec's "re-selected daily"): every rewarded market with a pool of at least $10 and a maximum
 * spread, accepting orders with two tokens, ranked by RW's first-round reward per dollar from one book read now; whole
 * markets in that order until $300. Once per UTC day: the cron job calls it every five minutes and a selected day skips,
 * so a failed selection is tried again five minutes later. It is written in one request, so a day is selected whole or
 * not at all, and never twice.
 *
 * Gamma, whose word decides "accepting orders", sends 7,900 bytes a market, and reading all 3,000-odd rewarded markets
 * from it cost 0.66 s of the 2 s of CPU an Edge request may use (1.22 s in all, measured 2026-09-24). So the tokens come
 * from the CLOB's short list, and Gamma is asked only about the markets `choose` takes: one it shows not accepting is
 * dropped and `choose` runs again, until every market taken is one Gamma accepts. That is `choose` over the accepting
 * markets exactly — dropping a market `choose` did not take never changes what it takes.
 */
export async function runPmrwSelect(d: RwDeps): Promise<RwSelectReport> {
  const day = dayStr(d.now);
  const report: RwSelectReport = { day, rewarded: 0, booked: 0, scored: 0, checked: 0, refused: 0, mismatched: 0, chosen: 0, capital: 0, errors: [] };
  if (d.now >= RW_RUN_END) return { ...report, skipped: "the fourteen days are over" };
  const held = await d.db.claim("agent_locks", `name=eq.pmrw-select&lease_until=lt.${encodeURIComponent(iso(d.now))}`, { lease_until: iso(d.now + RW_SELECT_LEASE_MS), holder: d.holder });
  if (!held.length) return { ...report, skipped: "another selection holds the lease" };
  try {
    const have = await d.db.select("pm_rw_selection", `day=eq.${day}&select=cond&limit=1`);
    if (have.length) return { ...report, skipped: "already selected today" };
    const rewards = (await pmRewardsCurrent(d.pm)).filter((r) => r.rate >= RW_MIN_RATE && r.v > 0);
    report.rewarded = rewards.length;
    const byCond = new Map(rewards.map((r) => [r.cond, r]));
    // Every market's YES token: the CLOB's short list, and Gamma for the few it does not carry.
    const gamma = new Map<string, PmMarket>();
    const gammaRead = async (conds: string[]) => { for (const m of await pmMarkets(conds, false, d.pm)) gamma.set(m.cond, m); };
    const simple = await pmSimplifiedMarkets(d.pm);
    const absent = rewards.filter((r) => !simple.has(r.cond)).map((r) => r.cond);
    if (absent.length) await gammaRead(absent);
    const yesOf = new Map<string, string>();
    for (const r of rewards) {
      const yes = simple.get(r.cond)?.yes ?? gamma.get(r.cond)?.yes;
      if (yes) yesOf.set(r.cond, yes);
    }
    const books = await pmBooks([...yesOf.values()], d.pm);
    report.booked = books.size;
    const scored: Array<{ cond: string; perDollar: number; cap: number; tick: number }> = [];
    for (const [cond, yes] of yesOf) {
      const r = byCond.get(cond)!, bk = books.get(yes);
      if (!bk) continue;
      const tick = bk.tick ?? gamma.get(cond)?.tick ?? 0.01;
      const fs = firstScore(summarize(bk.bids, bk.asks, r.v, r.minSize), tick, r.v, r.minSize, r.rate);
      if (fs) scored.push({ cond, ...fs, tick });
    }
    report.scored = scored.length;
    // `choose` over the markets Gamma accepts, asking Gamma only about the ones it takes.
    const out = new Set<string>();
    let chosen = choose(scored);
    for (;;) {
      const ask = chosen.map((x) => x.cond).filter((c) => !gamma.has(c) && !out.has(c));
      if (ask.length) { await gammaRead(ask); report.checked += ask.length; }
      const drop = chosen.filter((x) => {
        const m = gamma.get(x.cond);
        if (!m || !m.accepting) { report.refused++; return true; }
        if (m.yes !== yesOf.get(x.cond)) { report.mismatched++; return true; }
        return false;
      });
      if (!drop.length) break;
      for (const x of drop) out.add(x.cond);
      chosen = choose(scored.filter((x) => !out.has(x.cond)));
    }
    report.chosen = chosen.length;
    report.capital = chosen.reduce((s, x) => s + x.cap, 0);
    if (!chosen.length) return { ...report, skipped: "nothing scored" };
    await d.db.upsert("pm_rw_selection", chosen.map((x, i) => {
      const r = byCond.get(x.cond)!, m = gamma.get(x.cond)!;
      return {
        day, cond: x.cond, rank: i + 1, yes: m.yes, tick: x.tick, v: r.v, min_size: r.minSize, rate: r.rate,
        per_dollar_day: x.perDollar * 1440, capital: x.cap, q: m.q, cat: m.cat, end_date: m.end, selected_at: iso(d.now),
      };
    }), "day,cond");
    return report;
  } catch (e) {
    report.errors.push(msg(e));
    return report;
  } finally {
    try { await d.db.update("agent_locks", `name=eq.pmrw-select&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* expires */ }
  }
}

