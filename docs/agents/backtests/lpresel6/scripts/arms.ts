// LPRESEL6's arms, frozen by reviews/2026-10-09-lp-reselect6h-prereg.md. Every option is sim2.ts's (LPSELF's simulator).
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import type { Variant } from "./sim2.ts";

/**
 * L1, live-prep's rule as deployed (its pre-registration with Addenda 2-4): on the full universe's slots (rate >= $10,
 * N <= 20, accepting, not closed, no weather market, not ending that UTC day, no game within 48 h, a first-round formula
 * of $2.50 a day, by RW's firstScore), each UTC day ten markets within $200 of first-quote capital by first-round reward
 * per dollar; caps $320 in all and $100 a market on holdings at cost and resting buys, a sell of what is held before a
 * buy; 5N; x2's pause (15 cents, 60 minutes); TB1's skip of a one-tick raw touch; the -$75 stop on the fills plus 0.40
 * of the rewards of the days before, no day stop; carried markets worked off by the rule's own close-only quotes.
 */
export const L1: Variant = {
  id: "L1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5,
  stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 }, exitCarried: true,
};
/** RESEL6: L1, choosing its markets again at 06:00, 12:00 and 18:00 UTC from that slot's candidates; dropped markets become carried. */
export const RESEL6: Variant = { ...L1, reselectEveryH: 6, id: "RESEL6" };
/** Reported only: both with Phase A's passive exit model in place of the close-only quotes. */
export const L1_PASSIVE: Variant = { ...L1, exitCarried: undefined, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, id: "L1 passive" };
export const RESEL6_PASSIVE: Variant = { ...RESEL6, exitCarried: undefined, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, id: "RESEL6 passive" };
