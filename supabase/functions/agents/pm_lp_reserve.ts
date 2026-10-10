// "Reward quotes live-prep"'s live reserve (Addendum 13, 2026-10-10): the candidates its refill takes a vacated slot
// from, kept ranked through the UTC day in a call of its own (`agents?action=pmlpreserve`, every minute, 0116), so the
// heavy reads never delay a quoting turn: the turn only reads the row this writes (`pm_lp_reserve`).
//
// Davies, 2026-10-10: "现在就做补选吧，不然资金利用率太低了，研究出一套最合理的机制", then "这个候补名单也要在当天中实时更新比如每分钟
// 之类的" and, of a day whose ten markets were all taken out by the reward check by 10:04 UTC, that the path must not sit
// "全部被…挡住了…拿不到任何奖励".
//
// Each run, after the day's selection has landed (`pm_lp_markets` holds the day):
//   - every `rerankEveryMin` minutes (and on a new UTC day), the FULL re-rank: the selection itself (`selectMarkets`,
//     the same reads and the same rules: the reward listing whole, Gamma's word, every candidate's book, RW's
//     `firstScore`, the formula floor, live-prep's candidate rules) with no market to choose and `reserveSize` kept
//     (`PmSelectOpts.reserve`), every market of the day's rows left out (`exclude`: never taken again);
//   - every run, the LIGHT refresh: the CLOB's programme of the first `refreshTop` candidates (as the reward check reads a
//     selected market's), each marked in the universe or not now (`programme.inUniverse`), which the turn's health
//     reading counts and its refill tries first.
// Keyless reads only (the order path's client without credentials: no key, no order, no POST but the public books'
// batch). Its own lease (`pm-lp-reserve`) and state row. A run that cannot rank keeps the last reserve and says why.

import type { Db } from "./db.ts";
import {
  inUniverse, type PmDeadline, type PmLiveInstance, type PmMarketRow, type PmOrderRow, type PmOwnOrder, rewardConfigOf, rewardRate, selectMarkets,
} from "./pm_live.ts";
import type { PmVenue } from "../_shared/polymarket_orders.ts";
import type { PmPublicOpts } from "../_shared/polymarket_public.ts";

const M = 60e3;
/** No read starts later than this into a run (the selection's own bound), so it ends inside its call's timeout. */
export const PM_LP_RESERVE_UNTIL_MS = 40e3;
export const PM_LP_RESERVE_LEASE_MS = 55e3;

/** A reserve candidate: its row as the selection would write it, and its programme as last read. */
export type LpReserveRow = PmMarketRow & { programme?: { rate: number; v: number | null; minSize: number | null; at: string; inUniverse: boolean } | null };
export type LpReserveReport = {
  at: string; skipped?: string; ranked: boolean; rankMs: number | null; reads: { listing: number; gamma: number; books: number; programmes: number };
  rows: number; inUniverse: number; errors: string[];
};

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** One run of the reserve. It never throws: what fails is in `errors`, and the lease is always given back. */
export async function runPmLpReserve(d: {
  db: Db; now: number; holder: string; venue: PmVenue; inst: PmLiveInstance; clock?: () => number; pm?: PmPublicOpts;
}): Promise<LpReserveReport> {
  const report: LpReserveReport = { at: iso(d.now), ranked: false, rankMs: null, reads: { listing: 0, gamma: 0, books: 0, programmes: 0 }, rows: 0, inUniverse: 0, errors: [] };
  const rf = d.inst.lp?.refill;
  if (!rf) return { ...report, skipped: "the instance keeps no reserve" };
  const T = d.inst.tables;
  const lock = `${d.inst.lock}-reserve`;
  let held: unknown[];
  try { held = await d.db.claim("agent_locks", `name=eq.${lock}&lease_until=lt.${encodeURIComponent(iso(d.now))}`, { lease_until: iso(d.now + PM_LP_RESERVE_LEASE_MS), holder: d.holder }); }
  catch (e) { return { ...report, skipped: `agent_locks: ${msg(e)}` }; }
  if (!held.length) return { ...report, skipped: `another run holds the ${lock} lease (or migration 0116 has not run)` };
  const clock = d.clock ?? (() => Date.now());
  const t0 = clock();
  const dl: PmDeadline = { clock, until: t0 + PM_LP_RESERVE_UNTIL_MS };
  try {
    const day = iso(d.now).slice(0, 10);
    const cfg = (await d.db.select<{ max_markets: number | string; select_budget_usd: number | string }>(T.config, "id=eq.1&select=max_markets,select_budget_usd"))[0];
    const todays = await d.db.select<PmMarketRow>(T.markets, `day=eq.${day}&select=cond&limit=1000`);
    if (!cfg || !todays.length) return { ...report, skipped: "the day's selection has not landed yet" };
    const prev = (await d.db.select<{ day: string; ranked_at: string | null; rows: unknown }>(rf.table, "id=eq.1&select=day,ranked_at,rows"))[0];
    let rows: LpReserveRow[] = prev && String(prev.day).slice(0, 10) === day && Array.isArray(prev.rows) ? prev.rows as LpReserveRow[] : [];
    let rankedAt = prev && String(prev.day).slice(0, 10) === day ? prev.ranked_at : null;
    let note: Record<string, unknown> | null = null;
    const exclude = new Set(todays.map((m) => m.cond));
    // The full re-rank, on the selection's own functions, every `rerankEveryMin` minutes.
    if (!rankedAt || d.now - Date.parse(rankedAt) >= rf.rerankEveryMin * M) {
      const open = await d.db.select<PmOrderRow>(T.orders, "mode=eq.live&state=eq.live&select=cond,outcome,side,price,size,size_matched&limit=1000");
      const own = new Map<string, PmOwnOrder[]>();
      for (const o of open) own.set(o.cond, [...(own.get(o.cond) ?? []), { outcome: o.outcome, side: o.side, price: Number(o.price), size: Math.max(0, Number(o.size) - Number(o.size_matched ?? 0)) }]);
      const began = clock();
      const sel = await selectMarkets(d.venue, day, {
        maxMarkets: 0, budget: Number(cfg.select_budget_usd) || 0, own, band: d.inst.band, pm: d.pm, reserve: rf.reserveSize,
        bookBatch: d.inst.bookBatch ? (tokens: string[]) => d.inst.bookBatch!(tokens, d.pm) : undefined, bookQuality: d.inst.bookQuality,
        ...(d.inst.lp ? { candidate: d.inst.lp.candidate } : {}),
      }, exclude, dl, d.now);
      report.rankMs = Math.round(clock() - began);
      const n = sel.note as { listing?: { pages?: number }; gammaReads?: number; booksRead?: number; error?: string };
      report.reads = { ...report.reads, listing: n.listing?.pages ?? 0, gamma: n.gammaReads ?? 0, books: n.booksRead ?? 0 };
      if (n.error) report.errors.push(`re-rank: ${n.error}; the last reserve stands`);
      else {
        const old = new Map(rows.map((r) => [r.cond, r.programme ?? null]));
        rows = (sel.reserve ?? []).map((r) => ({ ...r, programme: old.get(r.cond) ?? null }));
        rankedAt = iso(d.now);
        report.ranked = true;
        note = { ...sel.note, ms: report.rankMs };
      }
    }
    rows = rows.filter((r) => !exclude.has(r.cond));
    // The light refresh: the first `refreshTop` candidates' programmes, as the reward check reads a selected market's.
    const top = rows.slice(0, rf.refreshTop);
    if (top.length && clock() <= dl.until) {
      const spo = await d.venue.rewardsPage(true, "");
      const sponsored = new Map<string, number>();
      if (spo.ok) for (const r of Array.isArray(spo.data?.data) ? spo.data!.data! : []) { const c = String(r.condition_id ?? "").toLowerCase(); if (c) sponsored.set(c, rewardRate(r)); }
      await Promise.all(top.map(async (r) => {
        const pr = await d.venue.rewardMarket(r.cond);
        report.reads.programmes++;
        const c = pr.ok ? rewardConfigOf(pr.data, r.cond, day) : null;
        if (!c) return;                                                            // unread: the last reading stands
        const rate = Math.max(c.native, sponsored.get(r.cond) ?? 0);
        r.programme = { rate, v: c.v, minSize: c.minSize, at: iso(d.now), inUniverse: inUniverse({ rate, v: c.v ?? 0, minSize: c.minSize ?? 0 }, d.inst.band) };
      }));
    }
    report.rows = rows.length;
    report.inUniverse = rows.filter((r) => r.programme?.inUniverse === true).length;
    await d.db.upsert(rf.table, [{
      id: 1, day, ranked_at: rankedAt, refreshed_at: iso(d.now), rows,
      ...(note ? { note } : {}), report: { ...report, errors: report.errors.slice(0, 5) }, updated_at: iso(d.now),
    }], "id");
  } catch (e) {
    report.errors.push(msg(e));
  } finally {
    try { await d.db.update("agent_locks", `name=eq.${lock}&holder=eq.${encodeURIComponent(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires */ }
  }
  return report;
}
