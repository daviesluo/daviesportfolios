// LIVE's capital compounding (Davies, 2026-10-27: "你再研究下策略如何能够有效利用账户中赚的钱，我希望赚的钱也能利用起来，现在好像完全没用到";
// migration 0146; docs/agents/reviews/2026-10-26-stablecoin-quotes-review.md §9). OFF until Davies turns it on with 0146's one
// statement.
//
// The executor sizes every rung from `agent_quote_live_config.capital_gbp` (a twelfth of it), so what LIVE realises sits in the
// account unused. With `compound_mode` 'realised', the first quotes call of each UTC day sets the capital to what was put in
// plus what has been realised since:
//   * equity = `compound_base_gbp` (the capital when it was turned on) + every rung's realised P&L, fees included, since
//     `compound_from` (`rungBook`, the executor's own walk). The coins' marks are left out: an FX move does not resize the rungs,
//     and a conversion's fee is left out with them (under a penny a rung);
//   * the target is equity in whole £12 (so a rung is whole pounds), at most `compound_cap_gbp` (the per-pound cliff of the
//     size read: £1,200 until variant-1's reading says more) and at least `compound_floor_gbp`;
//   * the capital moves only when the target is at least `compound_step_gbp` away (hysteresis: £12, a pound a rung), so a day's
//     pennies never resize twelve rungs.
// Everything that follows the capital follows it the next turn: the rung size, the −1 % loss stop, the conversion cap, the asks'
// coin (a £12 step needs about £3 more of each coin, inside the £5 a book a day the executor tops up by itself). Resting orders
// keep their size until the paper engine re-prices them, as on any capital change. 0145's trigger records each change.
// A deposit or a withdrawal is not realised P&L: Davies sets the base again (0146's header has the statement).
//
// It runs in `runQuotesAction` before the live executor's turn, never in `quotes_live.ts` (the twins run that file, and its
// frozen twin `quotes_live_frozen.ts` pins it), and never throws: a fault is one `agents.quotes_compound` report.

import { type Db } from "./db.ts";
import { rungBook, type RungFill } from "./quotes_live.ts";

export const COMPOUND_CONFIG = "agent_quote_live_config";
export const COMPOUND_ORDERS = "agent_quote_live_orders";
/** Twelve rungs: the capital moves in whole £12 so that each rung is whole pounds. */
export const COMPOUND_UNIT_GBP = 12;
const DAY = 86400e3;

export type CompoundConfig = {
  capital_gbp: number | string; compound_mode: string | null; compound_base_gbp: number | string | null; compound_from: string | null;
  compound_cap_gbp: number | string | null; compound_floor_gbp: number | string | null; compound_step_gbp: number | string | null;
  compound_on: string | null;
};
export type CompoundPlan = { equity: number; target: number; change: boolean; why: string };

/**
 * The day's capital from the base and what was realised since: equity floored to whole £12, held between the floor and the cap,
 * and moved only when at least `step` away from the capital now.
 */
export function compoundPlan(o: { base: number; realised: number; current: number; cap: number; floor: number; step: number }): CompoundPlan {
  const equity = o.base + o.realised;
  const whole = Math.floor((equity + 1e-9) / COMPOUND_UNIT_GBP) * COMPOUND_UNIT_GBP;
  const target = Math.min(o.cap, Math.max(o.floor, whole));
  const gap = Math.abs(target - o.current);
  const why = target === o.cap && whole > o.cap ? `held at the cap £${o.cap}`
    : target === o.floor && whole < o.floor ? `held at the floor £${o.floor}`
    : `equity £${equity.toFixed(2)} in whole £${COMPOUND_UNIT_GBP}`;
  return { equity, target, change: gap > 1e-9 && gap + 1e-9 >= o.step, why };
}

type OrderRow = { id: number; ts: string; leg: string; rung_side: "bid" | "ask" | null; book: string; k: number | string | null;
  filled_base: number | string; price: number | string; avg_fill_price: number | string | null; fee_gbp: number | string | null; filled_at: string | null };

/** Every rung's realised P&L, fees included, from `fromMs` on: the executor's own walk (`rungBook`), conversions left out. */
export function realisedSince(orders: OrderRow[], fromMs: number): number {
  const rungs = new Map<string, { side: "bid" | "ask"; fills: RungFill[] }>();
  for (const o of orders) {
    if (!o.rung_side || o.k == null || !(Number(o.filled_base) > 0)) continue;
    const key = `${o.book}|${o.rung_side}|${Number(o.k)}`;
    const r = rungs.get(key) ?? { side: o.rung_side, fills: [] };
    r.fills.push({ id: o.id, ts: Date.parse(o.filled_at ?? o.ts), leg: o.leg as RungFill["leg"], base: Number(o.filled_base),
      price: Number(o.avg_fill_price ?? o.price), feeGbp: Number(o.fee_gbp || 0) });
    rungs.set(key, r);
  }
  let sum = 0;
  for (const r of rungs.values()) sum += rungBook(r.side, r.fills, fromMs).realisedTodayGbp;
  return sum;
}

export type CompoundReport = { skipped?: string; day?: string; plan?: CompoundPlan; from?: number; to?: number; error?: string };

/** Once a UTC day, LIVE's capital from what it realised (see the header). Never throws. */
export async function runLiveCompound(db: Db, nowMs: number): Promise<CompoundReport> {
  const day = new Date(Math.floor(nowMs / DAY) * DAY).toISOString().slice(0, 10);
  try {
    let cfg: CompoundConfig | undefined;
    try {
      cfg = (await db.select<CompoundConfig>(COMPOUND_CONFIG,
        "id=eq.1&select=capital_gbp,compound_mode,compound_base_gbp,compound_from,compound_cap_gbp,compound_floor_gbp,compound_step_gbp,compound_on"))[0];
    } catch (e) {
      // Before 0146 has run, the columns are not there: off, not an error.
      if (/42703|PGRST204|column .* does not exist/i.test(e instanceof Error ? e.message : String(e))) return { skipped: "0146 has not run" };
      throw e;
    }
    if (!cfg || (cfg.compound_mode ?? "off") === "off") return { skipped: "off" };
    if (cfg.compound_mode !== "realised") return { error: `compound_mode '${cfg.compound_mode}' is not one this knows: nothing changed` };
    if (cfg.compound_on && cfg.compound_on >= day) return { skipped: `done for ${day}` };
    const base = Number(cfg.compound_base_gbp), fromMs = cfg.compound_from ? Date.parse(cfg.compound_from) : NaN;
    const current = Number(cfg.capital_gbp), cap = Number(cfg.compound_cap_gbp), floor = Number(cfg.compound_floor_gbp), step = Number(cfg.compound_step_gbp);
    if (!(base > 0) || !Number.isFinite(fromMs) || !(cap > 0) || !(floor > 0) || floor > cap || !(step > 0)) {
      return { error: "compounding is on without a base, a start, a cap over its floor and a step: nothing changed" };
    }
    const orders = await db.selectAll<OrderRow>(COMPOUND_ORDERS,
      "mode=eq.live&state=in.(filled,partially_filled)&select=id,ts,leg,rung_side,book,k,filled_base,price,avg_fill_price,fee_gbp,filled_at&order=id.asc");
    const plan = compoundPlan({ base, realised: realisedSince(orders, fromMs), current, cap, floor, step });
    const last = { day, at: new Date(nowMs).toISOString(), equity: Math.round(plan.equity * 100) / 100, target: plan.target, from: current, changed: plan.change, why: plan.why };
    await db.update(COMPOUND_CONFIG, "id=eq.1", plan.change
      ? { capital_gbp: plan.target, compound_on: day, compound_last: last, updated_at: new Date(nowMs).toISOString() }
      : { compound_on: day, compound_last: last });
    return { day, plan, from: current, to: plan.change ? plan.target : current };
  } catch (e) {
    return { day, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}
