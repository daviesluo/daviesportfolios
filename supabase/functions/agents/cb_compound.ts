// The Coinbase paper arms' capital compounding (Davies, 2026-10-30: "另外再确认一下目前所有的live和testing的Stablecoin quotes都能有效做到
// 盈利金额再利用吗？如果不能请研究实现"; docs/agents/reviews/2026-10-30-compounding.md; recorded apart as a deviation of each arm's
// pre-registration, docs/agents/reviews/2026-10-30-compounding-deviation.md).
//
// Each arm sizes its rung from PR5's frozen `stepMinute`, whose rung is its 100: the driver gives it every print × a divisor and
// takes every size, notional and P&L back ÷ it, so the arm's rung is 100 ÷ the divisor ($50 for "- 1", "- 2" and the USDC/GBP LIVE
// twin). What an arm realises therefore never sized anything. With its rule here (`CB_COMPOUND_RULES`, by the arm's lease), from
// `from` (2026-10-31 00:00 UTC, the Revolut X twins' instant) the arm's capital is its funded dollars plus every round trip it has
// closed since, in dollars at its own size, fees and the stop's cost included, set at each UTC day's first minute: in whole units
// (a dollar a rung), between half and twice the funded, moved only a unit or more away (`compoundPlan`, quotes_compound.ts, LIVE's
// rule). The divisor is the arm's own ÷ capital / funded (`cbCompoundMult`), so the rung is the arm's × the same share.
//   * A rung held across a change keeps the coins it holds: the engine keeps its size × the divisor, so it is rescaled by the old
//     multiplier over the new, as the arms' own $50 switches rescaled theirs.
//   * The divisor changes only at a UTC day's first minute: a run never decides past 23:59 (`cbCompoundHorizon`), and the next run,
//     starting at 00:00, sets the day's capital before its first minute. A run is normally one minute; this splits a catch-up.
//   * The arm's state keeps the compounding (`compound`): its rule's numbers as they were written, the capital, the realised
//     dollars counted, the day it last set and each day's capital (`days`, what a reading divides that day's trips by). The page
//     shows FUNDED as put in, and each held rung at the divisor now.

import type { BookState, Trip } from "./quotes.ts";
import { compoundPlan } from "./quotes_compound.ts";

const M = 60e3, DAY = 86400e3;
const dayOf = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);

/** An arm's compounding rule: from when, its funded dollars, and its unit (a dollar a rung), floor and cap. */
export type CbCompoundRule = { from: number; base: number; unit: number; floor: number; cap: number };
/** What the arm's state keeps of it. */
export type CbCompoundState = CbCompoundRule & { capital: number; realisedUsd: number; onDay: string | null; last?: Record<string, unknown>; days?: Record<string, number> };
type WithCompound = { compound?: CbCompoundState; books: Record<string, BookState> };

/** 2026-10-31 00:00 UTC: the Revolut X twins' instant (0183), so every Stablecoin quotes test compounds from the same day. */
export const CB_COMPOUND_FROM = Date.UTC(2026, 9, 31);
const rule = (base: number, rungs: number): CbCompoundRule => ({ from: CB_COMPOUND_FROM, base, unit: rungs, floor: base / 2, cap: base * 2 });
/**
 * Each arm's rule, by its lease: the USDC/GBP LIVE twin (`cb-nudge`, $50 × 6 = $300), "- 1" (`cb-usdc`, $50 × 12 = $600) and "- 2"
 * (`cb-hold`, $50 × 24 = $1,200). The base test (`cb-quotes`, the weekend reading's control, off the page) has none.
 */
export const CB_COMPOUND_RULES: Record<string, CbCompoundRule> = {
  "cb-nudge": rule(300, 6),
  "cb-usdc": rule(600, 12),
  "cb-hold": rule(1200, 24),
};

/** The arm's capital over its funded at minute `t`: 1 before its start, or with no compounding. */
export function cbCompoundMult(st: { compound?: CbCompoundState } | null | undefined, t: number): number {
  const c = st?.compound;
  return c && t >= c.from ? c.capital / c.base : 1;
}
/** The multiplier the state's held rungs are kept at now (the page's divisor ÷ it). */
export const cbCompoundMultNow = (st: { compound?: CbCompoundState } | null | undefined): number => (st?.compound ? st.compound.capital / st.compound.base : 1);

/** A run's last minute under a rule: never past the 23:59 of the day it starts in, once the rule's start is that day or before. */
export function cbCompoundHorizon(lease: string, first: number, horizon: number): number {
  const r = CB_COMPOUND_RULES[lease];
  if (!r) return horizon;
  const nextDay = Math.floor(first / DAY) * DAY + DAY;
  return nextDay >= r.from ? Math.min(horizon, nextDay - M) : horizon;
}

/**
 * At a run's first minute `first`: the compounding written into the state once its start has come, and the day's capital set when
 * `first` is in a day it has not set yet, its held rungs on `products` rescaled to keep their coins. Returns the change, if any.
 */
export function cbCompoundAt(st: WithCompound, lease: string, first: number, products: readonly string[]): { from: number; to: number } | null {
  const r = CB_COMPOUND_RULES[lease];
  if (!r || first < r.from) return null;
  st.compound ??= { ...r, capital: r.base, realisedUsd: 0, onDay: null };
  const c = st.compound, day = dayOf(first);
  if (c.onDay && c.onDay >= day) return null;
  const plan = compoundPlan({ base: c.base, realised: c.realisedUsd, current: c.capital, cap: c.cap, floor: c.floor, step: c.unit, unit: c.unit });
  c.onDay = day;
  c.last = { day, equity: Math.round(plan.equity * 100) / 100, target: plan.target, from: c.capital, changed: plan.change, why: plan.why.replace(/£/g, "$") };
  // Each day's capital, as set: what a pre-registered reading divides the day's trips by to read them at the funded size.
  (c.days ??= {})[day] = plan.change ? plan.target : c.capital;
  if (!plan.change) return null;
  const k = c.capital / plan.target;                                         // the old multiplier over the new
  for (const b of products) for (const rr of st.books[b]?.rungs ?? []) {
    if (rr.mode !== "position") continue;
    if (rr.qty != null) rr.qty *= k;
    if (rr.nq != null) rr.nq *= k;
  }
  const out = { from: c.capital, to: plan.target };
  c.capital = plan.target;
  return out;
}

/** A closed round trip, at the arm's size and in dollars (its `pnlUsd`), counted from the start: what the next day's capital adds. */
export function cbCompoundTrip(st: { compound?: CbCompoundState }, t: Pick<Trip, "tExit" | "pnlUsd">): void {
  const c = st.compound;
  if (c && t.tExit >= c.from) c.realisedUsd += t.pnlUsd;
}
