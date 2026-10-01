// "Reward quotes live-prep" as the Agents page shows it (`pm_prep.ts`, 0077): a row of TESTING STRATEGIES on the
// Polymarket card and a page of its own. Every figure comes from the layer's own records through its own functions:
// the P&L is `paperPnl` (the order path's `tokenBooks` and `bookPnl`) on the fills the state has decided, and the
// rewards are the formula's as the engine summed them, beside the same at R = 0.40. Nothing is computed a second way.

import { paperPnl, PREP_R_BREAK_EVEN, type PrepFill, type PrepState } from "./pm_prep.ts";
import type { PmSettlement } from "./pm_live.ts";

const M = 60e3, DAY = 86400e3;
/** The newest fills the page lists. */
export const PREP_RECENT_FILLS = 25;
/** The layer decides each minute two minutes after it starts: a last decided minute older than this means it has stopped. */
export const PREP_STALE_MINUTES = 5;

export type PrepStateRow = { state: unknown; last_minute: string | null; last_error: string | null; updated_at?: string | null };
export type PrepDayRow = {
  day: string; reward: number | string; reward_r40: number | string; fills_pnl_day: number | string; fills_pnl_total: number | string; pnl_day_r40: number | string;
  held_value: number | string; fills: number | string; minutes_matched: number | string; minutes_dark: number | string; minutes_diverged: number | string;
  minutes_missing: number | string; stop_day: boolean; stop_total: boolean; markets: number | string;
};
export type PrepMinuteRow = {
  minute: string; cond: string; class: string; b: number | string | null; a: number | string | null; n: number | string | null; qb: boolean | null; qa: boolean | null;
  close_only: boolean | null; yes_held: number | string | null; no_held: number | string | null; mark: number | string | null;
};
export type PrepFillRow = {
  cond: string; minute: string; print_id: string; ts: string; side: "bid" | "ask"; price: number | string; size: number | string; token: string;
  token_side: "BUY" | "SELL"; token_price: number | string; close_only: boolean;
};
export type PrepMarketRow = { day: string; cond: string; question: string | null; reward_rate: number | string | null; rank: number | string; n_size: number | string | null };

const nz = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The dashboard's `prep`: null until the layer has a state. `capUsd` is the order path's total cap (`pm_live_config`),
 * the row's capital: the most the path may commit. Only what the state has decided is counted (the engine writes fills
 * before the state that counts them, so a read between the two sees fills of minutes not yet decided).
 */
export function prepSummary(input: {
  state: PrepStateRow | null; days: PrepDayRow[]; latest: PrepMinuteRow[]; fills: PrepFillRow[]; settlements: PmSettlement[];
  markets: PrepMarketRow[]; capUsd: number; nowMs: number;
}) {
  const st = input.state?.state as PrepState | undefined;
  if (!st || typeof st !== "object" || st.version !== 1 || !input.state?.last_minute) return null;
  const lagMinutes = Math.round((input.nowMs - Date.parse(input.state.last_minute)) / M);
  const todayStart = Math.floor(input.nowMs / DAY) * DAY;
  const fills = input.fills.filter((f) => Date.parse(f.minute) <= st.lastDecided).map((f): PrepFill => ({
    cond: f.cond, minute: Date.parse(f.minute), printId: f.print_id, ts: Date.parse(f.ts), side: f.side, price: Number(f.price), size: Number(f.size),
    token: f.token, tokenSide: f.token_side, tokenPrice: Number(f.token_price), closeOnly: !!f.close_only,
  }));
  const pnl = paperPnl(fills, input.settlements, st.tokens ?? {}, st.marks ?? {}, todayStart);
  let realisedFills = 0, cost = 0;
  for (const t of Object.values(pnl.books)) { realisedFills += t.realised; cost += t.held * t.avgCost; }
  const closed = input.days.filter((d) => Date.parse(d.day) < st.dayOf).sort((a, b) => a.day.localeCompare(b.day));
  const rewardToday = st.dayOf === todayStart ? st.day.reward : 0;
  // Every closed day's, and the day being accumulated (yesterday's, for the minute or two after midnight before it closes).
  const reward = closed.reduce((s, d) => s + Number(d.reward), 0) + st.day.reward;
  const heldBy = (cond: string) => {
    const tk = st.tokens?.[cond];
    return tk ? { yes: pnl.held[tk.yes] ?? 0, no: pnl.held[tk.no] ?? 0 } : { yes: 0, no: 0 };
  };
  const latest = new Map(input.latest.map((r) => [r.cond, r]));
  const today = input.markets.filter((m) => Date.parse(`${String(m.day).slice(0, 10)}T00:00:00Z`) === todayStart).sort((a, b) => Number(a.rank) - Number(b.rank));
  const markets: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const m of today) {
    const row = latest.get(m.cond), h = heldBy(m.cond);
    seen.add(m.cond);
    markets.push({
      cond: m.cond, q: m.question ?? "", rank: Number(m.rank), quoting: true, ratePerDay: nz(m.reward_rate), n: nz(m.n_size),
      cls: row?.class ?? null, bid: row && row.qb !== false && row.class === "matched" ? nz(row.b) : null, ask: row && row.qa !== false && row.class === "matched" ? nz(row.a) : null,
      closeOnly: !!row?.close_only, yes: h.yes, no: h.no, mark: st.marks?.[m.cond] ?? null,
    });
  }
  // Markets still held from an earlier day: marked, never quoted.
  for (const cond of Object.keys(st.tokens ?? {}).sort()) {
    const h = heldBy(cond);
    if (seen.has(cond) || h.yes + h.no <= 0) continue;
    markets.push({ cond, q: "", rank: null, quoting: false, ratePerDay: null, n: null, cls: null, bid: null, ask: null, closeOnly: false, yes: h.yes, no: h.no, mark: st.marks?.[cond] ?? null });
  }
  const open = markets.filter((x) => Number(x.yes) + Number(x.no) > 0).length;
  const qOf = new Map(input.markets.map((m) => [m.cond, m.question ?? ""]));
  const recent = fills.slice().sort((x, y) => y.ts - x.ts || y.minute - x.minute || (x.printId < y.printId ? 1 : -1)).slice(0, PREP_RECENT_FILLS).map((f) => ({
    ts: iso(f.ts), minute: iso(f.minute), cond: f.cond, q: qOf.get(f.cond) ?? "", side: f.side, price: f.price, size: f.size, tokenSide: f.tokenSide,
    outcome: st.tokens?.[f.cond]?.yes === f.token ? "yes" : "no", tokenPrice: f.tokenPrice, closeOnly: f.closeOnly,
  }));
  const dayOut = (d: PrepDayRow) => ({
    day: String(d.day).slice(0, 10), live: false, rewardUsd: Number(d.reward), rewardR40Usd: Number(d.reward_r40), fillsPnlUsd: Number(d.fills_pnl_day),
    pnlR40Usd: Number(d.pnl_day_r40), fills: Number(d.fills), matched: Number(d.minutes_matched), dark: Number(d.minutes_dark), diverged: Number(d.minutes_diverged),
    missing: Number(d.minutes_missing), stop: !!d.stop_day || !!d.stop_total,
  });
  const todayRow = st.dayOf === todayStart ? {
    day: iso(todayStart).slice(0, 10), live: true, rewardUsd: r6(rewardToday), rewardR40Usd: r6(rewardToday * PREP_R_BREAK_EVEN), fillsPnlUsd: pnl.day,
    pnlR40Usd: r6(pnl.day + rewardToday * PREP_R_BREAK_EVEN), fills: st.day.fills, matched: st.day.matched, dark: st.day.dark, diverged: st.day.diverged,
    missing: st.day.missing, stop: st.stopDay === iso(todayStart).slice(0, 10) || st.stopTotal !== null,
  } : null;
  return {
    lastMinute: input.state.last_minute, lagMinutes, running: lagMinutes <= PREP_STALE_MINUTES, lastError: input.state.last_error ?? null,
    startedAt: st.startedAt, capUsd: input.capUsd,
    rewardUsd: r6(reward), rewardR40Usd: r6(reward * PREP_R_BREAK_EVEN), fillsPnlUsd: pnl.total, heldUsd: pnl.heldValue, costUsd: r6(cost),
    realisedUsd: r6(reward + realisedFills), realisedFillsUsd: r6(realisedFills), unrealisedUsd: r6(pnl.total - realisedFills),
    totalUsd: r6(pnl.total + reward), totalR40Usd: r6(pnl.total + reward * PREP_R_BREAK_EVEN),
    todayUsd: r6(pnl.day + rewardToday), todayR40Usd: r6(pnl.day + rewardToday * PREP_R_BREAK_EVEN), todayRewardUsd: r6(rewardToday), todayFillsPnlUsd: pnl.day,
    stopDay: st.stopDay, stopTotal: st.stopTotal, open, quoting: today.length,
    markets, recent, days: [...(todayRow ? [todayRow] : []), ...closed.map(dayOut).reverse()],
  };
}
