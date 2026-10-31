// Capital compounding: what a Stablecoin quotes strategy realises is put back to work (Davies, 2026-10-27: "你再研究下策略如何能够
// 有效利用账户中赚的钱，我希望赚的钱也能利用起来，现在好像完全没用到", migration 0146, LIVE only, built OFF; then 2026-10-30: "另外再确认一下
// 目前所有的live和testing的Stablecoin quotes都能有效做到盈利金额再利用吗？如果不能请研究实现", migration 0183, every Revolut X executor and
// twin; docs/agents/reviews/2026-10-30-compounding.md).
//
// Every Revolut X executor and twin sizes its rungs from its config's `capital_gbp` (its rung weights' share of it, `rungGbpOf`),
// and its loss stop, conversion cap and asks' coin follow that number. Without compounding, what it realises sits in the account
// as idle pounds and coin. With it, once a UTC day the capital is set to what was put in plus what has been realised:
//   * equity = the base (the capital when it was turned on) + every rung's realised P&L, fees included, by the executor's own
//     walk (`rungBook`), and what each conversion that sold coin realised against the coins it sold, first in, first out
//     (`conversionSales`, the page's own REALIZED since 2026-10-30), over the fills from `from` to the day's 00:00 UTC. The coins'
//     marks are left out: an FX move does not resize the rungs;
//   * the target is equity in whole units, a pound a rung the strategy quotes (`compoundUnitOf` from 2026-11-01 00:00 UTC: LIVE's
//     six USDT-GBP rungs £6, the £120 USDC/GBP executor's four £4, each twin its own; before it LIVE's £12 of the twelve rungs it
//     was built with, and the stored units), held between a floor and a cap (LIVE's £300 and £1,200:
//     half and twice what it was put in at; every other target the same halves and doubles);
//   * it moves only when the target is at least `step` away (hysteresis), so a day's pennies never resize every rung.
// Its realised is counted up to the day's 00:00 UTC, so a twin and its live strategy, on the same rule from the same instant, set
// the same capital from the same record whenever each runs in the day's first minutes.
//
// Who runs it: LIVE and the Revolut X USDC/GBP executor in `runQuotesAction`, before their turns (0146's columns on LIVE's config,
// 0183's on the USDC/GBP executor's); every twin in `runQuotesTwinsAction`, before the twins' turns, from its row of
// `agent_quote_twin_compound` (0183), only once the twin's simulated account has turned into the day. Never in `quotes_live.ts`
// (the twins run that file, and its frozen twin `quotes_live_frozen.ts` pins it), and it never throws: a fault is one report.
// A deposit or a withdrawal is not realised P&L: the base is set again (the design doc has the statement).

import { type Db } from "./db.ts";
import { QUOTE_LIVE_INSTANCE, QUOTE_RXU_INSTANCE, retiredAt, rungBook, weightRetired, type QuoteLiveInstance, type RungFill } from "./quotes_live.ts";
import { QUOTE_BOOKS, type QuoteBook } from "./quotes.ts";

export const COMPOUND_CONFIG = "agent_quote_live_config";
export const COMPOUND_ORDERS = "agent_quote_live_orders";
/** LIVE's unit until COMPOUND_UNIT_RUNGS_FROM: twelve rungs, so the capital moved in whole £12, a pound a rung of the twelve it was built with. */
export const COMPOUND_UNIT_GBP = 12;
/**
 * From this instant every Revolut X executor's and twin's unit, and its step, is a pound a rung it quotes then (Davies, 2026-10-31
 * ~03:05 UTC, "c也改", on the audit's finding that LIVE moved in whole £12, £2 a rung, since it quotes USDT-GBP's six rungs alone,
 * and the question "live复利不仅是usdt吧，另外两个呢？"): `compoundUnitOf`, from the instance's own rungs and weights at the day's 00:00,
 * so a change of rungs can never leave the unit stale. The next 00:00 after the audit; before it, the stored units, as they ran.
 */
export const COMPOUND_UNIT_RUNGS_FROM = Date.parse("2026-11-01T00:00:00Z");
/**
 * £1 a rung the instance quotes at `at`: every book, side and distance whose weight is not 0 (`weightRetired`) and that is not
 * retired (`retiredAt`). LIVE on USDT-GBP alone: £6; the USDC/GBP executor's four: £4; a twin of both books' three rungs: £12.
 */
export function compoundUnitOf(inst: QuoteLiveInstance, at: number): number {
  let n = 0;
  for (const b of QUOTE_BOOKS) for (const side of ["bid", "ask"] as const) for (const k of inst.rungs) {
    if (!weightRetired(inst, at, b, side, k) && !retiredAt(inst, at).includes(k)) n++;
  }
  return n;
}
const DAY = 86400e3;

/** A live executor whose config carries the compounding columns (0146's on LIVE's, 0183's on the USDC/GBP executor's). */
export type CompoundTarget = { name: string; config: string; orders: string; instance: QuoteLiveInstance };
export const COMPOUND_LIVE: CompoundTarget = { name: "live", config: COMPOUND_CONFIG, orders: COMPOUND_ORDERS, instance: QUOTE_LIVE_INSTANCE };
export const COMPOUND_RXU: CompoundTarget = { name: "rxu", config: "agent_quote_rxu_config", orders: "agent_quote_rxu_orders", instance: QUOTE_RXU_INSTANCE };
/** The unit and step a day's compounding uses: from COMPOUND_UNIT_RUNGS_FROM a pound a rung the instance quotes, before it the stored ones. */
export function compoundUnitStep(stored: { unit: number; step: number }, inst: QuoteLiveInstance | undefined, dayStart: number): { unit: number; step: number } {
  if (!inst || dayStart < COMPOUND_UNIT_RUNGS_FROM) return stored;
  const unit = compoundUnitOf(inst, dayStart);
  return { unit, step: unit };
}

export type CompoundConfig = {
  capital_gbp: number | string; compound_mode: string | null; compound_base_gbp: number | string | null; compound_from: string | null;
  compound_cap_gbp: number | string | null; compound_floor_gbp: number | string | null; compound_step_gbp: number | string | null;
  compound_on: string | null; compound_unit_gbp?: number | string | null;
};
export type CompoundPlan = { equity: number; target: number; change: boolean; why: string };

/**
 * The day's capital from the base and what was realised since: equity floored to whole `unit`s, held between the floor and the
 * cap, and moved only when at least `step` away from the capital now.
 */
export function compoundPlan(o: { base: number; realised: number; current: number; cap: number; floor: number; step: number; unit?: number }): CompoundPlan {
  const unit = o.unit ?? COMPOUND_UNIT_GBP;
  const equity = o.base + o.realised;
  const whole = Math.floor((equity + 1e-9) / unit) * unit;
  const target = Math.min(o.cap, Math.max(o.floor, whole));
  const gap = Math.abs(target - o.current);
  const why = target === o.cap && whole > o.cap ? `held at the cap £${o.cap}`
    : target === o.floor && whole < o.floor ? `held at the floor £${o.floor}`
    : `equity £${equity.toFixed(2)} in whole £${unit}`;
  return { equity, target, change: gap > 1e-9 && gap + 1e-9 >= o.step, why };
}

/** An order as the compounding reads it: what filled, at what price and fee, on which rung or none (a conversion). */
export type CompoundOrder = {
  id: number; ts: string; leg: string; rung_side: string | null; book: string; k: number | string | null; side?: string | null; mode?: string;
  filled_base: number | string; price: number | string; avg_fill_price: number | string | null; fee_gbp: number | string | null; filled_at: string | null;
};

/** A conversion that sold coin (a rebook's sale, `isDrain`), realised against what the coins it sold cost (`conversionSales`). */
export type ConversionSale = { id: number; book: QuoteBook; at: number; realisedGbp: number };
/**
 * What each conversion that sold coin realised (Davies, 2026-10-30, LIVE's page after the USDT-only switch sold its USDC at
 * 23:34 UTC: "USDC [•] USDC · £[•] at £0.7470 -£[•]"). Each book's conversions are walked in the order they filled: one
 * that buys is a lot, at its price; one that sells takes its coins from the lots, first in, first out, and realises its pounds,
 * less its fee, less what those coins cost. Coins it sold beyond what the conversions bought (a rung's leftovers) are taken at the
 * sale's own price: they realise nothing here. A buy's fee is not a lot's cost: it stays in the coins' cost, less what closed
 * trips carry (`withConversionFees`, index.ts), as before. Before this, a sale only took its pounds off the cost, so what the
 * coins it sold made or lost stayed in the cost of the few left, as unrealised on about 0 coins. (It lived in index.ts until
 * 0183, which counts it in the compounding equity too.)
 */
export function conversionSales(orders: ReadonlyArray<CompoundOrder>): ConversionSale[] {
  const at = (o: CompoundOrder) => Date.parse(o.filled_at ?? o.ts);
  const conv = orders.filter((o) => (o.mode ?? "live") === "live" && o.leg === "convert" && Number(o.filled_base) > 0)
    .slice().sort((a, b) => at(a) - at(b) || a.id - b.id);
  const out: ConversionSale[] = [];
  for (const b of QUOTE_BOOKS) {
    const lots: { left: number; px: number }[] = [];
    for (const o of conv.filter((x) => x.book === b)) {
      const q = Number(o.filled_base), px = Number(o.avg_fill_price ?? o.price);
      if (o.side !== "sell") { lots.push({ left: q, px }); continue; }
      let need = q, cost = 0;
      for (const lot of lots) {
        if (need <= 0) break;
        const take = Math.min(lot.left, need);
        lot.left -= take; need -= take; cost += take * lot.px;
      }
      cost += need * px;
      out.push({ id: o.id, book: b, at: at(o), realisedGbp: q * px - Number(o.fee_gbp || 0) - cost });
    }
  }
  return out;
}

/**
 * The realised P&L the compounding counts, fees included: every rung's, by the executor's own walk (`rungBook`), from `fromMs`,
 * and every conversion sale's (`conversionSales`) from `fromMs`; only fills before `untilMs` (the day's 00:00 UTC). A trip
 * entered before `fromMs` and closed after it counts whole, as the executor's day does.
 */
export function realisedSince(orders: ReadonlyArray<CompoundOrder>, fromMs: number, untilMs = Infinity): number {
  const at = (o: CompoundOrder) => Date.parse(o.filled_at ?? o.ts);
  const upTo = orders.filter((o) => Number(o.filled_base) > 0 && at(o) < untilMs);
  const rungs = new Map<string, { side: "bid" | "ask"; fills: RungFill[] }>();
  for (const o of upTo) {
    if (!o.rung_side || o.k == null) continue;
    const key = `${o.book}|${o.rung_side}|${Number(o.k)}`;
    const r = rungs.get(key) ?? { side: o.rung_side as "bid" | "ask", fills: [] };
    r.fills.push({ id: o.id, ts: at(o), leg: o.leg as RungFill["leg"], base: Number(o.filled_base),
      price: Number(o.avg_fill_price ?? o.price), feeGbp: Number(o.fee_gbp || 0) });
    rungs.set(key, r);
  }
  let sum = 0;
  for (const r of rungs.values()) sum += rungBook(r.side, r.fills, fromMs).realisedTodayGbp;
  for (const s of conversionSales(upTo)) if (s.at >= fromMs) sum += s.realisedGbp;
  return sum;
}

/** The UTC day of `ms` and its 00:00. */
export const compoundDay = (ms: number) => {
  const start = Math.floor(ms / DAY) * DAY;
  return { day: new Date(start).toISOString().slice(0, 10), start };
};

/** The settings one compounding reads, whatever row they come from. */
export type CompoundSettings = { mode: string; base: number; fromMs: number; cap: number; floor: number; step: number; unit: number; on: string | null };
/** Why settings that say 'realised' cannot run, or null when they can. */
export function compoundRefusal(s: CompoundSettings): string | null {
  if (s.mode !== "realised") return `compound_mode '${s.mode}' is not one this knows: nothing changed`;
  if (!(s.base > 0) || !Number.isFinite(s.fromMs) || !(s.cap > 0) || !(s.floor > 0) || s.floor > s.cap || !(s.step > 0) || !(s.unit > 0)) {
    return "compounding is on without a base, a start, a cap over its floor, a step and a unit: nothing changed";
  }
  return null;
}

export type CompoundReport = { skipped?: string; day?: string; plan?: CompoundPlan; from?: number; to?: number; error?: string };

const ORDER_COLUMNS = "id,ts,leg,side,rung_side,book,k,filled_base,price,avg_fill_price,fee_gbp,filled_at";

/**
 * Once a UTC day, a live executor's capital from what it realised (see the header): LIVE's by default, or the USDC/GBP
 * executor's (`COMPOUND_RXU`). Never throws.
 */
export async function runLiveCompound(db: Db, nowMs: number, target: CompoundTarget = COMPOUND_LIVE): Promise<CompoundReport> {
  const { day, start } = compoundDay(nowMs);
  try {
    let cfg: CompoundConfig | undefined;
    try {
      cfg = (await db.select<CompoundConfig>(target.config,
        `id=eq.1&select=capital_gbp,compound_mode,compound_base_gbp,compound_from,compound_cap_gbp,compound_floor_gbp,compound_step_gbp,compound_on${target === COMPOUND_LIVE ? "" : ",compound_unit_gbp"}`))[0];
    } catch (e) {
      // Before its migration has run, the columns are not there: off, not an error.
      if (/42703|PGRST204|PGRST205|42P01|column .* does not exist/i.test(e instanceof Error ? e.message : String(e))) return { skipped: `${target.name === "live" ? "0146" : "0183"} has not run` };
      throw e;
    }
    if (!cfg || (cfg.compound_mode ?? "off") === "off") return { skipped: "off" };
    if (cfg.compound_on && cfg.compound_on >= day) return { skipped: `done for ${day}` };
    const s: CompoundSettings = {
      mode: String(cfg.compound_mode), base: Number(cfg.compound_base_gbp), fromMs: cfg.compound_from ? Date.parse(cfg.compound_from) : NaN,
      cap: Number(cfg.compound_cap_gbp), floor: Number(cfg.compound_floor_gbp), step: Number(cfg.compound_step_gbp),
      unit: cfg.compound_unit_gbp == null ? COMPOUND_UNIT_GBP : Number(cfg.compound_unit_gbp), on: cfg.compound_on,
    };
    Object.assign(s, compoundUnitStep(s, target.instance, start));
    const refused = compoundRefusal(s);
    if (refused) return { error: refused };
    const orders = await db.selectAll<CompoundOrder>(target.orders, `mode=eq.live&state=in.(filled,partially_filled)&select=${ORDER_COLUMNS}&order=id.asc`);
    const current = Number(cfg.capital_gbp);
    const plan = compoundPlan({ base: s.base, realised: realisedSince(orders, s.fromMs, start), current, cap: s.cap, floor: s.floor, step: s.step, unit: s.unit });
    const last = { day, at: new Date(nowMs).toISOString(), equity: Math.round(plan.equity * 100) / 100, target: plan.target, from: current, changed: plan.change, why: plan.why };
    await db.update(target.config, "id=eq.1", plan.change
      ? { capital_gbp: plan.target, compound_on: day, compound_last: last, updated_at: new Date(nowMs).toISOString() }
      : { compound_on: day, compound_last: last });
    return { day, plan, from: current, to: plan.change ? plan.target : current };
  } catch (e) {
    return { day, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

// ------------------------------------------------------------------------------------------------------------ the twins

/** The twins' compounding rows (0183): one a twin, its settings beside the twin's own config, which it sets. */
export const TWIN_COMPOUND_TABLE = "agent_quote_twin_compound";
export type TwinCompoundRow = {
  twin_id: string; mode: string; base_gbp: number | string | null; from_at: string | null; cap_gbp: number | string | null; floor_gbp: number | string | null;
  step_gbp: number | string | null; unit_gbp: number | string | null; on_day: string | null; last?: unknown;
  /** Each UTC day's capital, as set that day: what a pre-registered reading divides the day's trips by to read them at the funded size. */
  days?: Record<string, number> | null;
};
/** A twin as its compounding needs it: its config and orders, its simulated account's row (its last turn). */
export type TwinCompoundSpec = { id: string; config: string; orders: string; sim: string; instance?: QuoteLiveInstance };
/** A twin compounds a day only once its simulated account has turned this close to the day's 00:00 or later (it turns at :25). */
export const TWIN_COMPOUND_CAUGHT_UP_MS = 5 * 60e3;

/**
 * Once a UTC day, each twin that has a row on: its capital set by the same rule as its live strategy's, from its own record, before
 * its turns of the day. A twin still catching up (its last turn more than five minutes before the day's 00:00) waits, so its
 * day's turns are not sized from a day it has not reached. Never throws: each twin's fault is its report's.
 */
export async function runTwinsCompound(db: Db, nowMs: number, specs: ReadonlyArray<TwinCompoundSpec>): Promise<Array<CompoundReport & { twin: string }>> {
  const { day, start } = compoundDay(nowMs);
  let rows: TwinCompoundRow[];
  try {
    rows = await db.select<TwinCompoundRow>(TWIN_COMPOUND_TABLE, "mode=eq.realised&select=*&order=twin_id.asc");
  } catch (e) {
    if (/PGRST205|42P01|does not exist|Could not find the table/i.test(e instanceof Error ? e.message : String(e))) return [];
    return [{ twin: "*", day, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }];
  }
  const out: Array<CompoundReport & { twin: string }> = [];
  for (const r of rows) {
    const spec = specs.find((x) => x.id === r.twin_id);
    if (!spec) continue;                                                        // an off or unknown twin: nothing to size
    try {
      if (r.on_day && r.on_day >= day) continue;
      const s: CompoundSettings = {
        mode: r.mode, base: Number(r.base_gbp), fromMs: r.from_at ? Date.parse(r.from_at) : NaN, cap: Number(r.cap_gbp), floor: Number(r.floor_gbp),
        step: Number(r.step_gbp), unit: Number(r.unit_gbp), on: r.on_day,
      };
      Object.assign(s, compoundUnitStep(s, spec.instance, start));
      const refused = compoundRefusal(s);
      if (refused) { out.push({ twin: r.twin_id, day, error: refused }); continue; }
      if (start < s.fromMs) continue;                                           // not yet: its first day is the one its start opens
      const sim = (await db.select<{ state: { venue?: { lastTurnAt?: number | null } } }>(spec.sim, "id=eq.1&select=state"))[0];
      const lastTurn = sim?.state?.venue?.lastTurnAt ?? null;
      if (lastTurn == null || lastTurn < start - TWIN_COMPOUND_CAUGHT_UP_MS) { out.push({ twin: r.twin_id, day, skipped: "its account has not turned into the day yet" }); continue; }
      const cfg = (await db.select<{ capital_gbp: number | string }>(spec.config, "id=eq.1&select=capital_gbp"))[0];
      if (!cfg) { out.push({ twin: r.twin_id, day, skipped: "no config row yet" }); continue; }
      const orders = await db.selectAll<CompoundOrder>(spec.orders, `mode=eq.live&state=in.(filled,partially_filled)&select=${ORDER_COLUMNS}&order=id.asc`);
      const current = Number(cfg.capital_gbp);
      const plan = compoundPlan({ base: s.base, realised: realisedSince(orders, s.fromMs, start), current, cap: s.cap, floor: s.floor, step: s.step, unit: s.unit });
      const last = { day, at: new Date(nowMs).toISOString(), equity: Math.round(plan.equity * 100) / 100, target: plan.target, from: current, changed: plan.change, why: plan.why };
      if (plan.change) await db.update(spec.config, "id=eq.1", { capital_gbp: plan.target, updated_at: new Date(nowMs).toISOString() });
      await db.update(TWIN_COMPOUND_TABLE, `twin_id=eq.${encodeURIComponent(r.twin_id)}`, { on_day: day, last, days: { ...(r.days ?? {}), [day]: plan.change ? plan.target : current } });
      out.push({ twin: r.twin_id, day, plan, from: current, to: plan.change ? plan.target : current });
    } catch (e) {
      out.push({ twin: r.twin_id, day, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    }
  }
  return out;
}
