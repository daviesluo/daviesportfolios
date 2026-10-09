// What Polymarket charges a fill, and what it pays a maker back, as the Reward quotes pages estimate it (Davies,
// 2026-10-09: "testing页面中VENUES里的polymarket中应该也像live一样加入fees行，每个Reward quotes子页面的scoreboard里也一样", then
// "按照实际情况估算").
//
// The rule, from Polymarket's docs and its official client:
//   - trading/fees (docs.polymarket.com/trading/fees): "fee = C × feeRate × p × (1 - p)", C shares at price p, charged in
//     USDC at match time, "rounded to 5 decimal places" (0.00001 the smallest; less rounds to zero). "Makers are never
//     charged fees." Its own example: Crypto, 100 shares at $0.50, rate 0.07: 100 × 0.07 × 0.50 × 0.50 = $1.75.
//   - the client (github.com/Polymarket/clob-client-v2, `calculatePlatformFee`, read at 8046a89e): a market's schedule is
//     `{ rate, exponent }` (`fd.r`, `fd.e`), and the fee per share is rate × (p × (1 − p))^exponent; every production
//     schedule has exponent 1, which is the docs' formula.
//   - market-makers/maker-rebates (docs.polymarket.com/market-makers/maker-rebates): a market's makers share a pool of
//     its taker fees, the category's `rebateRate` of them (20 % crypto, 15 % sports, 25 % the rest, none for
//     geopolitics), each by "fee_equivalent = C × feeRate × p × (1 - p)" over the market's total, paid daily in pUSD once
//     $1 has accrued. Every trade has one maker side and one taker side, so the makers' fee-equivalent summed over a
//     market's fee-paying trades is its taker fees: a maker's rebate is the rebate rate times its own fee-equivalent.
//     That is the estimate made here; it is not counted in any P&L, and the $1 threshold only delays a payout.
//
// Each market's schedule is its fee type (Gamma's `feeType`, which RW's selection keeps as `cat` and the book recorder as
// `fee_type`), read through `PM_FEE_TYPES`. A market with no fee type is fee-free (geopolitics, or no schedule at all,
// §2d); a market none of the records names is unknown, and its fills are counted apart (`unknownFills`), never guessed.

/** A market's fee schedule: the taker rate and the exponent of p × (1 − p), and the share of taker fees its makers get back. */
export type PmFeeSchedule = { rate: number; exponent: number; rebateRate: number };

/**
 * Each fee type's schedule. The rates are Gamma's `feeSchedule.rate` as read on 2026-10-04 over the markets the Reward
 * quotes tests quoted (`docs/agents/backtests/rwexit/base_rw.sql`; sports_fees_v2 is 0.03 there, below the docs' 0.05 for
 * the category); the rebate rates are the docs' by category. Exponent 1 everywhere, as every production schedule has.
 */
export const PM_FEE_TYPES: Readonly<Record<string, PmFeeSchedule>> = {
  crypto_fees_v2: { rate: 0.07, exponent: 1, rebateRate: 0.2 },
  sports_fees_v2: { rate: 0.03, exponent: 1, rebateRate: 0.15 },
  sports_fees_v3: { rate: 0.05, exponent: 1, rebateRate: 0.15 },
  culture_fees: { rate: 0.05, exponent: 1, rebateRate: 0.25 },
  economics_fees: { rate: 0.05, exponent: 1, rebateRate: 0.25 },
  weather_fees: { rate: 0.05, exponent: 1, rebateRate: 0.25 },
  general_fees: { rate: 0.05, exponent: 1, rebateRate: 0.25 },
  finance_prices_fees: { rate: 0.04, exponent: 1, rebateRate: 0.25 },
  politics_fees: { rate: 0.04, exponent: 1, rebateRate: 0.25 },
  mentions_fees: { rate: 0.04, exponent: 1, rebateRate: 0.25 },
  tech_fees: { rate: 0.04, exponent: 1, rebateRate: 0.25 },
};
/** A market with no fee type pays and earns nothing. */
export const PM_FEE_FREE: PmFeeSchedule = { rate: 0, exponent: 1, rebateRate: 0 };
/**
 * A recorded fee type's schedule: none recorded is fee-free; a type this table does not know is the docs' "Other /
 * General" (0.05, 25 %), the default for an unlisted category.
 */
export function pmFeeSchedule(feeType: string | null | undefined): PmFeeSchedule {
  if (feeType == null || feeType === "") return PM_FEE_FREE;
  return PM_FEE_TYPES[feeType] ?? PM_FEE_TYPES.general_fees;
}

/** Rounded as Polymarket rounds a fee: to 5 decimal places. */
const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** The fee-equivalent of `size` shares at `price` under a schedule: size × rate × (p × (1 − p))^exponent, unrounded. */
export function pmFeeEquivalent(size: number, price: number, s: PmFeeSchedule): number {
  if (!(size > 0) || !(price > 0 && price < 1) || !(s.rate > 0)) return 0;
  return size * s.rate * Math.pow(price * (1 - price), s.exponent);
}

/** What a fill pays: a taker its fee-equivalent rounded to 5 dp; a maker nothing ("Makers are never charged fees"). */
export function pmFillFee(size: number, price: number, s: PmFeeSchedule, taker: boolean): number {
  return taker ? round5(pmFeeEquivalent(size, price, s)) : 0;
}

/** A maker fill's share of its market's rebate pool, estimated as the rebate rate of its fee-equivalent. A taker earns none. */
export function pmMakerRebate(size: number, price: number, s: PmFeeSchedule, taker: boolean): number {
  return taker ? 0 : s.rebateRate * pmFeeEquivalent(size, price, s);
}

export type PmFeeFill = { cond: string; price: number; size: number; taker: boolean };
export type PmFeeTotals = { feesUsd: number; rebatesEstUsd: number; makerFills: number; takerFills: number; unknownFills: number };

/**
 * A paper record's fees and estimated maker rebates: each fill priced by its market's schedule (`scheduleOf`; null for a
 * market no record names, whose fill is counted in `unknownFills` and priced at nothing).
 */
export function pmPaperFees(fills: PmFeeFill[], scheduleOf: (cond: string) => PmFeeSchedule | null): PmFeeTotals {
  let fees = 0, rebates = 0, maker = 0, taker = 0, unknown = 0;
  for (const f of fills) {
    if (f.taker) taker++; else maker++;
    const s = scheduleOf(f.cond);
    if (!s) { unknown++; continue; }
    fees += pmFillFee(f.size, f.price, s, f.taker);
    rebates += pmMakerRebate(f.size, f.price, s, f.taker);
  }
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { feesUsd: r6(fees), rebatesEstUsd: r6(rebates), makerFills: maker, takerFills: taker, unknownFills: unknown };
}

/**
 * A live fill's actual fee, from its trade record: we pay only on a trade where we were the TAKER (`trader_side`), at
 * the rate the record names (`fee_rate_bps`, basis points of the schedule's rate), as the docs' formula prices it. A
 * maker fill, the only kind a post-only order makes, pays nothing.
 */
export function pmLiveFillFee(size: number, price: number, traderSide: string | null | undefined, feeRateBps: string | number | null | undefined): number {
  if (String(traderSide ?? "").toUpperCase() !== "TAKER") return 0;
  const bps = Number(feeRateBps);
  return Number.isFinite(bps) && bps > 0 ? pmFillFee(size, price, { rate: bps / 1e4, exponent: 1, rebateRate: 0 }, true) : 0;
}
