// The OKX paper twins' capital compounding ("Stablecoin quotes USDG/EUR", "EURC/USDC" and "USDG/EUR - 1"), from 2026-10-31 00:00 UTC
// as every other Stablecoin quotes test (0183, cb_compound.ts). Davies, 2026-10-30: "…你觉得需要做的话就做", on the audit's note that
// the OKX twins did not reuse their profit (docs/agents/reviews/2026-10-30-compounding.md §1); recorded apart as a deviation of their
// two pre-registrations (docs/agents/reviews/2026-10-30-okx-compounding-deviation.md).
//
// The OKX engine (`stepOkxMinute`, okx_quotes.ts) sizes each entry from the dollars a rung it is given (`rungUsd`, $100) and keeps
// a position in real coin, so nothing is rescaled: from the start each book is given its $100 × its capital over its funded $600,
// and its loss stop counts against the capital the same way. Each book (a row of the page) compounds on its own record: at the
// first minute of each UTC day its capital is its $600 plus every round trip it has closed since the start, in dollars (the
// trip's quote-currency P&L at the minute's EUR/USD for a euro book, as is for a USDC one), in whole $6 (a dollar a rung), between
// $300 and $1,200, moved only $6 or more away (`compoundPlan`, LIVE's rule). Each day's capital is kept (`days`): what a reading
// divides that day's trips by to read them at the frozen $600. An entry resting at the old size keeps it until it is re-priced,
// as a Revolut X order does on a capital change.

import { compoundPlan } from "./quotes_compound.ts";
import { CB_COMPOUND_FROM } from "./cb_compound.ts";

const DAY = 86400e3;
const dayOf = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);

/** The twins' instant (0183): every Stablecoin quotes test compounds from 2026-10-31 00:00 UTC. */
export const OKX_COMPOUND_FROM = CB_COMPOUND_FROM;
/** Each OKX book's rule: $600 funded (six $100 rungs), a dollar a rung, half to twice. */
export const OKX_COMPOUND_RULE = { from: OKX_COMPOUND_FROM, base: 600, unit: 6, floor: 300, cap: 1200 } as const;

export type OkxCompoundBook = {
  from: number; base: number; unit: number; floor: number; cap: number;
  capital: number; realisedUsd: number; onDay: string | null; last?: Record<string, unknown>; days?: Record<string, number>;
};
export type OkxCompound = Record<string, OkxCompoundBook>;

/**
 * At minute `t`, a book's compounding: written once the start has come, and the day's capital set when `t` is in a day it has not
 * set yet (the engine's books are decided minute by minute, all books a minute, so every trip of the day before is counted).
 * Returns the book's multiplier, its capital over its funded: 1 before the start.
 */
export function okxCompoundMinute(st: { compound?: OkxCompound }, book: string, t: number): number {
  if (t < OKX_COMPOUND_FROM) return 1;
  const c = ((st.compound ??= {})[book] ??= { ...OKX_COMPOUND_RULE, capital: OKX_COMPOUND_RULE.base, realisedUsd: 0, onDay: null });
  const day = dayOf(t);
  if (!c.onDay || c.onDay < day) {
    const plan = compoundPlan({ base: c.base, realised: c.realisedUsd, current: c.capital, cap: c.cap, floor: c.floor, step: c.unit, unit: c.unit });
    c.last = { day, equity: Math.round(plan.equity * 100) / 100, target: plan.target, from: c.capital, changed: plan.change, why: plan.why.replace(/£/g, "$") };
    if (plan.change) c.capital = plan.target;
    c.onDay = day;
    (c.days ??= {})[day] = c.capital;
  }
  return c.capital / c.base;
}

/** A book's multiplier now (the page and the loss stop): 1 with no compounding written yet. */
export const okxCompoundMult = (st: { compound?: OkxCompound } | null | undefined, book: string): number => {
  const c = st?.compound?.[book];
  return c ? c.capital / c.base : 1;
};

/** A closed round trip of `book`, in dollars, counted from the start: what the next day's capital adds. */
export function okxCompoundTrip(st: { compound?: OkxCompound }, book: string, tExit: number, pnlUsd: number): void {
  const c = st.compound?.[book];
  if (c && tExit >= c.from && Number.isFinite(pnlUsd)) c.realisedUsd += pnlUsd;
}
