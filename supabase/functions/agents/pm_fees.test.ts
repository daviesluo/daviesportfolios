// Polymarket's fees and maker rebates as the Reward quotes pages estimate them (pm_fees.ts), against the docs' own
// example and cases worked by hand.

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PM_FEE_FREE, PM_FEE_TYPES, pmFeeEquivalent, pmFeeSchedule, pmFillFee, pmLiveFillFee, pmMakerRebate, pmPaperFees } from "./pm_fees.ts";

const near = (x: number, want: number, what: string) => assertAlmostEquals(x, want, 1e-9, what);

Deno.test("the taker fee is the docs' formula, rounded to five places; a maker pays nothing", () => {
  const crypto = PM_FEE_TYPES.crypto_fees_v2;
  // docs.polymarket.com/trading/fees: Crypto, 100 shares at $0.50, rate 0.07 → $1.75.
  assertEquals(pmFillFee(100, 0.5, crypto, true), 1.75);
  // By hand at two prices: 100 at 0.10 → 100 × 0.07 × 0.10 × 0.90 = 0.63; 37 at 0.83, politics 0.04 → 0.208828 → 0.20883.
  assertEquals(pmFillFee(100, 0.1, crypto, true), 0.63);
  assertEquals(pmFillFee(37, 0.83, PM_FEE_TYPES.politics_fees, true), 0.20883);
  // The same fills as a maker's: nothing ("Makers are never charged fees").
  assertEquals([pmFillFee(100, 0.5, crypto, false), pmFillFee(37, 0.83, PM_FEE_TYPES.politics_fees, false)], [0, 0]);
  // Below the smallest fee it rounds to nothing; a fee-free market or a price at an edge pays nothing.
  assertEquals([pmFillFee(0.0001, 0.5, crypto, true), pmFillFee(100, 0.5, PM_FEE_FREE, true), pmFeeEquivalent(100, 1, crypto)], [0, 0, 0]);
  // The client's exponent (clob-client-v2 `calculatePlatformFee`): rate × (p(1 − p))^e; e = 2 squares it.
  near(pmFeeEquivalent(100, 0.5, { rate: 0.07, exponent: 2, rebateRate: 0 }), 100 * 0.07 * 0.0625, "exponent 2");
});

Deno.test("a maker's rebate is its share of the market's pool: the rebate rate of its fee-equivalent; a taker earns none", () => {
  // 100 at 0.50 in crypto: fee-equivalent 1.75, 20 % of it 0.35; in sports v3 (0.05, 15 %) 100 × 0.05 × 0.25 × 0.15 = 0.1875.
  near(pmMakerRebate(100, 0.5, PM_FEE_TYPES.crypto_fees_v2, false), 0.35, "crypto");
  near(pmMakerRebate(100, 0.5, PM_FEE_TYPES.sports_fees_v3, false), 0.1875, "sports");
  assertEquals(pmMakerRebate(100, 0.5, PM_FEE_TYPES.crypto_fees_v2, true), 0);
});

Deno.test("a fee type's schedule: none is fee-free, an unlisted one the docs' Other / General", () => {
  assertEquals([pmFeeSchedule(null), pmFeeSchedule("")], [PM_FEE_FREE, PM_FEE_FREE]);
  assertEquals(pmFeeSchedule("politics_fees"), { rate: 0.04, exponent: 1, rebateRate: 0.25 });
  assertEquals(pmFeeSchedule("a_new_fees"), PM_FEE_TYPES.general_fees);
});

Deno.test("a paper record's fees and rebates: every fill priced by its market, an unknown market counted apart", () => {
  const out = pmPaperFees([
    { cond: "a", price: 0.4, size: 20, taker: false },   // politics: 0.25 × 0.04 × 20 × 0.24 = 0.048
    { cond: "b", price: 0.3, size: 10, taker: true },    // crypto taker: 10 × 0.07 × 0.21 = 0.147, no rebate
    { cond: "c", price: 0.5, size: 10, taker: false },   // fee-free: nothing
    { cond: "x", price: 0.5, size: 10, taker: false },   // no record: unknown
  ], (c) => (c === "a" ? PM_FEE_TYPES.politics_fees : c === "b" ? PM_FEE_TYPES.crypto_fees_v2 : c === "c" ? PM_FEE_FREE : null));
  assertEquals(out, { feesUsd: 0.147, rebatesEstUsd: 0.048, makerFills: 3, takerFills: 1, unknownFills: 1 });
});

Deno.test("a live fill's fee from its trade record: a TAKER at its fee_rate_bps, a MAKER nothing", () => {
  assertEquals(pmLiveFillFee(31.538462, 0.39, "MAKER", "0"), 0);
  assertEquals(pmLiveFillFee(100, 0.5, "TAKER", "700"), 1.75);
  assertEquals([pmLiveFillFee(100, 0.5, "TAKER", "0"), pmLiveFillFee(100, 0.5, null, "700"), pmLiveFillFee(100, 0.5, "TAKER", "")], [0, 0, 0]);
});

Deno.test("RW's paper fills priced by their selection's fee types: makers', the newest day's type, an unlisted market unknown", async () => {
  const { rwFeeTypes, rwPaperFees } = await import("./pmrw_view.ts");
  const types = rwFeeTypes([{ cond: "a", cat: "crypto_fees_v2" }, { cond: "b", cat: null }, { cond: "a", cat: "politics_fees" }]);
  assertEquals(types, { a: "politics_fees", b: null });
  // a: 20 at 0.40, politics: 0.25 × 0.04 × 20 × 0.24 = 0.048; b fee-free; c on no selection.
  assertEquals(rwPaperFees([{ cond: "a", price: "0.4", size: "20" }, { cond: "b", price: 0.5, size: 10 }, { cond: "c", price: 0.5, size: 10 }], types),
    { feesUsd: 0, rebatesEstUsd: 0.048, makerFills: 3, takerFills: 0, unknownFills: 1 });
});
