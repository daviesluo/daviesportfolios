// RWC-OPT's arms, frozen by reviews/2026-10-09-rwc-optimised-arms-prereg.md. Every option is sim.ts's; nothing else.
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import type { Variant } from "./sim.ts";

/**
 * S2, live-prep's specification on a run's own selection, as Phase A's round 15 ran it (backtests/pmlp/scripts/round15.ts,
 * "S2 (redeemed at once)"): N <= 20; RW-E's same-day rule and no weather market from the record's first minute (the
 * simulator's defaults); ten markets within $200 of first-quote capital by first-round reward per dollar; caps $320 in
 * all and $100 a market on holdings at cost and resting buys, a sell of what is held before a buy; 5N; x2's pause, 15 cents
 * and 60 minutes; the -$75 stop on the fills plus 0.40 of the rewards of days before; no day stop; carried positions
 * worked off by the passive exit model (9.1 shares an hour at the mid less 1.8 cents).
 */
export const S2: Variant = {
  id: "S2", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true },
  exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 },
  pause: { cents: 15, minutes: 60 },
};
/** TB1's skip, one tick (reviews/2026-10-07-polymarket-rw-tb1-prereg.md, arm tb1-skip): no quote while the raw touch is <= 1 tick. */
const TB1_SKIP = { tight: { mode: "skip" as const, maxTicks: 1 } };
/** C1, primary: S2 with TB1's skip. Base: S2. */
export const C1: Variant = { ...S2, ...TB1_SKIP, id: "C1 S2+tb1-skip" };
/** C2, reported only: S2 and C1 with carried positions sold only by close-only quotes where the record holds prints. */
export const C2_S2: Variant = { ...S2, exitPassiveModel: undefined, exitCarried: true, id: "C2 S2 exitCarried" };
export const C2_C1: Variant = { ...C1, exitPassiveModel: undefined, exitCarried: true, id: "C2 C1 exitCarried" };
/** x1 with no account (RW-X's x1 from the record's first minute): the simulator's defaults. */
export const X1: Variant = { id: "x1" };
/** C3, secondary: x1 with x2's pause and TB1's skip (x3 plus TB1). Base: x1. */
export const C3: Variant = { ...X1, pause: { cents: 15, minutes: 60 }, ...TB1_SKIP, id: "C3 x1+pause+tb1-skip" };

/** The two paired tests the bar reads, each [arm, base]; C2's two arms are reported beside them. */
export const TESTS: Array<{ name: string; arm: Variant; base: Variant }> = [
  { name: "C1", arm: C1, base: S2 },
  { name: "C3", arm: C3, base: X1 },
];
export const REPORTED: Variant[] = [C2_S2, C2_C1];
