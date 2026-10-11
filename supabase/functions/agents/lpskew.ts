// LP-SKEW-FT: a paper forward test of inventory-skewed quoting for "Reward quotes live-prep", pre-registered in
// `docs/agents/reviews/2026-10-11-lp-skew-ft-prereg.md` (frozen by the commit that adds this file; its sha256 is in that
// document). Davies, 2026-10-11 20:35 UTC: "同意，做 LP-SKEW-FT 纸面前向测试", and 20:37 UTC: "同意迁移，全部做 LP-SKEW-FT
// （独立模块 + 迁移）".
//
// What it is: three quoting arms replayed, minute by minute, on live-prep's OWN recorded minutes (`pm_lp_minutes`, the
// book live-prep read each minute: touch, adjusted touch, the others' scores). Only minutes in which live-prep itself
// rested a quote in that market are replayed, so all arms share live-prep's selection, pauses, TB1 skip and reward
// check. Each arm keeps its own paper inventory in YES-equivalent shares (a bid is a buy of YES at b, an ask a sale of
// YES at a; live-prep's buy of NO at 1 − a is the same exposure) and its own cash.
//   - base:  RW's prices (`quote`) at N = max(min size, 5) (`sizeN`), a side stops at 5N its way (live-prep's rule).
//   - cap40: base, a side stops at min(40, 5N) shares its way.
//   - skew:  cap40, and both prices shifted by −k·q (k = $0.001 a share), rounded away from the mid to the tick, never
//            through the raw touch.
// The fill rule (a touch model, the same for every arm): a bid of minute t fills in full when minute t+1's best ask
// or adjusted mid is at or under it; an ask when t+1's best bid or adjusted mid is at or over it. The reward is the
// Polymarket formula on the arm's own quotes against the others' recorded scores (`othersOf`), rate/1440 a minute.
// A settlement (`pm_lp_settlements`) books what an arm holds at its payout. An arm whose marked fills reach
// −LPSKEW_KILL_USD stops quoting for good (the kill). It reads `pm_lp_minutes` and `pm_lp_settlements` and writes only
// `pm_lpskew_state` and `pm_lpskew_days` (0117). No order, no venue, no live table written: nothing of the order path.
//
// What it cannot measure: news-driven adverse selection inside a minute (a one-minute snapshot does not see who traded
// or why), queue position, and whether an arm's different prices would have changed the others' behaviour.

import type { Db } from "./db.ts";
import { ceilTick, floorTick, othersOf, quote, scoreS, sizeN, type BookRow } from "./pmrw.ts";

export const LPSKEW_START = "2026-10-12T00:00:00.000Z";
export const LPSKEW_KILL_USD = 50;
export const LPSKEW_LEASE_MS = 55e3;
export const LPSKEW_MAX_MINUTES = 240;
export type LpSkewArm = { id: "base" | "cap40" | "skew"; capShares: number | null; k: number };
export const LPSKEW_ARMS: readonly LpSkewArm[] = [
  { id: "base", capShares: null, k: 0 },
  { id: "cap40", capShares: 40, k: 0 },
  { id: "skew", capShares: 40, k: 0.001 },
];
export type LpSkewRow = {
  minute: string; cond: string; rate: number | string; max_spread: number | string; min_size: number | string; tick: number | string;
  bb: number | string | null; ba: number | string | null; ab: number | string | null; aa: number | string | null;
  q1: number | string | null; q2: number | string | null; bid_price: number | string | null; ask_price: number | string | null;
};
type ArmState = { q: Record<string, number>; cash: Record<string, number>; mid: Record<string, number>; killed: string | null };
type DayAcc = { fills: number; buys: number; sells: number; cash: number; formula: number; settled: number; log: [string, string, string, number, number][] };
export type LpSkewState = { cursor: string | null; day: string | null; arms: Record<string, ArmState>; acc?: Record<string, DayAcc> };
export type LpSkewReport = { at: string; skipped?: string; minutes: number; errors: string[] };

const n = (x: unknown) => (x == null || x === "" ? null : Number(x));
const iso = (ms: number) => new Date(ms).toISOString();
const isoOf = (s: string) => iso(Date.parse(s));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const midOf = (r: LpSkewRow) => { const ab = n(r.ab), aa = n(r.aa); return ab !== null && aa !== null ? (ab + aa) / 2 : (Number(r.bb) + Number(r.ba)) / 2; };

/** An arm's quote for one recorded minute at inventory q (YES-equivalent shares), or null when RW's rule quotes nothing. */
export function armQuote(arm: LpSkewArm, r: LpSkewRow, q: number): { m: number; b: number; a: number; nb: number; na: number } | null {
  const tick = Number(r.tick) || 0.01, bb = n(r.bb), ba = n(r.ba);
  if (bb === null || ba === null) return null;
  const row: BookRow = [bb, ba, n(r.ab), n(r.aa), Number(r.q1 ?? 0), Number(r.q2 ?? 0)];
  const qt = quote(row, tick);
  if (!qt) return null;
  const N = sizeN(Number(r.min_size) || 0);
  const cap = arm.capShares === null ? 5 * N : Math.min(arm.capShares, 5 * N);
  let b = qt.b, a = qt.a;
  if (arm.k) {
    const sh = arm.k * q;
    b = Math.min(floorTick(b - sh, tick), floorTick(ba - tick, tick));
    a = Math.max(ceilTick(a - sh, tick), ceilTick(bb + tick, tick));
  }
  b = Math.round(b * 1e6) / 1e6; a = Math.round(a * 1e6) / 1e6;
  const nb = b > 0 && q < cap - 1e-9 ? N : 0, na = a < 1 && q > -cap + 1e-9 ? N : 0;
  if (b >= a) return null;
  return { m: qt.m, b, a, nb, na };
}

/** Which of a quote's sides minute t+1's book fills (the touch rule), in shares. */
export function nextFills(qt: { b: number; a: number; nb: number; na: number }, nx: LpSkewRow): { buy: number; sell: number } {
  const m2 = midOf(nx), ba2 = Number(nx.ba), bb2 = Number(nx.bb);
  return {
    buy: qt.nb > 0 && (ba2 <= qt.b + 1e-9 || m2 <= qt.b + 1e-9) ? qt.nb : 0,
    sell: qt.na > 0 && (bb2 >= qt.a - 1e-9 || m2 >= qt.a - 1e-9) ? qt.na : 0,
  };
}

/** The arm's reward formula for one minute, $ (rate/1440 · ours/(ours + others)), RW's two-sided rule. */
function formulaOf(r: LpSkewRow, qt: { m: number; b: number; a: number; nb: number; na: number }): number {
  const v = Number(r.max_spread), m = qt.m;
  const sb = qt.nb ? scoreS(v, (m - qt.b) * 100) * qt.nb : 0, sa = qt.na ? scoreS(v, (qt.a - m) * 100) * qt.na : 0;
  const ours = 0.10 <= m && m <= 0.90 ? Math.max(Math.min(sb, sa), Math.max(sb, sa) / 3) : Math.min(sb, sa);
  if (ours <= 0) return 0;
  const others = othersOf(m, Number(r.q1 ?? 0), Number(r.q2 ?? 0));
  return Number(r.rate) / 1440 * ours / (ours + others);
}

const blankAcc = (): DayAcc => ({ fills: 0, buys: 0, sells: 0, cash: 0, formula: 0, settled: 0, log: [] });
const marked = (s: ArmState) => Object.keys({ ...s.q, ...s.cash }).reduce((t, c) => t + (s.cash[c] ?? 0) + (s.q[c] ?? 0) * (s.mid[c] ?? 0), 0);

/** One run. It never throws: what fails is in `errors`, and the lease is always given back. */
export async function runLpSkew(d: { db: Db; now: number; holder: string }): Promise<LpSkewReport> {
  const report: LpSkewReport = { at: iso(d.now), minutes: 0, errors: [] };
  let held: unknown[];
  try { held = await d.db.claim("agent_locks", `name=eq.pm-lpskew&lease_until=lt.${encodeURIComponent(iso(d.now))}`, { lease_until: iso(d.now + LPSKEW_LEASE_MS), holder: d.holder }); }
  catch (e) { return { ...report, skipped: `agent_locks: ${msg(e)}` }; }
  if (!held.length) return { ...report, skipped: "another run holds the pm-lpskew lease (or migration 0117 has not run)" };
  try {
    const prev = (await d.db.select<{ state: LpSkewState }>("pm_lpskew_state", "id=eq.1&select=state"))[0]?.state;
    const st: LpSkewState = prev ?? { cursor: null, day: null, arms: {} };
    for (const a of LPSKEW_ARMS) st.arms[a.id] ??= { q: {}, cash: {}, mid: {}, killed: null };
    st.acc ??= {};
    for (const a of LPSKEW_ARMS) st.acc[a.id] ??= blankAcc();
    const from = st.cursor ? isoOf(st.cursor) : iso(Date.parse(LPSKEW_START) - 1);
    const rows = await d.db.select<LpSkewRow>("pm_lp_minutes",
      `mode=eq.live&minute=gt.${encodeURIComponent(from)}&select=minute,cond,rate,max_spread,min_size,tick,bb,ba,ab,aa,q1,q2,bid_price,ask_price&order=minute.asc,cond.asc&limit=1000`);
    const sets = await d.db.select<{ cond: string; payout: number | string; settled_at: string }>("pm_lp_settlements", "select=cond,payout,settled_at");
    const byMin = new Map<string, LpSkewRow[]>();
    for (const r of rows) { const k = isoOf(r.minute); if (Date.parse(k) < Date.parse(LPSKEW_START)) continue; byMin.set(k, [...(byMin.get(k) ?? []), r]); }
    const mins = [...byMin.keys()].sort();
    // The last minute read waits for its successor, and so does a page cut by the limit (its last minute may be partial).
    const usable = rows.length >= 1000 ? mins.slice(0, -2) : mins.slice(0, -1);
    for (const t of usable.slice(0, LPSKEW_MAX_MINUTES)) {
      const day = t.slice(0, 10);
      if (st.day !== day) { st.day = day; for (const a of LPSKEW_ARMS) st.acc![a.id] = blankAcc(); }
      const nxtKey = mins[mins.indexOf(t) + 1];
      const nxt = nxtKey && Date.parse(nxtKey) - Date.parse(t) <= 120e3 ? new Map(byMin.get(nxtKey)!.map((r) => [r.cond, r])) : new Map<string, LpSkewRow>();
      for (const a of LPSKEW_ARMS) {
        const s = st.arms[a.id], acc = st.acc![a.id];
        for (const x of sets) {
          const q = s.q[x.cond] ?? 0;
          if (q !== 0 && Date.parse(x.settled_at) <= Date.parse(t)) {
            const cash = q * Number(x.payout);
            s.cash[x.cond] = (s.cash[x.cond] ?? 0) + cash; acc.cash += cash; s.q[x.cond] = 0; acc.settled++;
            s.mid[x.cond] = Number(x.payout);
          }
        }
        for (const r of byMin.get(t)!) s.mid[r.cond] = midOf(r);
        if (!s.killed && marked(s) <= -LPSKEW_KILL_USD) s.killed = t;
        if (s.killed) continue;
        for (const r of byMin.get(t)!) {
          if (r.bid_price == null && r.ask_price == null) continue;               // live-prep rested nothing here
          if (sets.some((x) => x.cond === r.cond && Date.parse(x.settled_at) <= Date.parse(t))) continue;
          const q = s.q[r.cond] ?? 0;
          const qt = armQuote(a, r, q);
          if (!qt) continue;
          acc.formula += formulaOf(r, qt);
          const nx = nxt.get(r.cond);
          if (!nx) continue;
          const f = nextFills(qt, nx);
          if (f.buy) { s.q[r.cond] = q + f.buy; s.cash[r.cond] = (s.cash[r.cond] ?? 0) - f.buy * qt.b; acc.cash -= f.buy * qt.b; acc.buys += f.buy; acc.fills++; acc.log.push([t, r.cond, "B", qt.b, f.buy]); }
          if (f.sell) { s.q[r.cond] = (s.q[r.cond] ?? 0) - f.sell; s.cash[r.cond] = (s.cash[r.cond] ?? 0) + f.sell * qt.a; acc.cash += f.sell * qt.a; acc.sells += f.sell; acc.fills++; acc.log.push([t, r.cond, "S", qt.a, f.sell]); }
        }
      }
      st.cursor = t;
      report.minutes++;
    }
    if (report.minutes) {
      await d.db.upsert("pm_lpskew_days", LPSKEW_ARMS.map((a) => {
        const s = st.arms[a.id], acc = st.acc![a.id];
        return {
          day: st.day, arm: a.id, fills: acc.fills, buys_shares: acc.buys, sells_shares: acc.sells, cash_usd: acc.cash, formula_usd: acc.formula,
          settled: acc.settled, held: Object.fromEntries(Object.entries(s.q).filter(([, v]) => Math.abs(v) > 1e-9)), marked_usd: marked(s),
          killed_at: s.killed, detail: { fills: acc.log }, updated_at: iso(d.now),
        };
      }), "day,arm");
    }
    await d.db.upsert("pm_lpskew_state", [{ id: 1, state: st, updated_at: iso(d.now) }], "id");
  } catch (e) {
    report.errors.push(msg(e));
  } finally {
    try { await d.db.update("agent_locks", `name=eq.pm-lpskew&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
  return report;
}
