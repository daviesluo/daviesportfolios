// GROKPM's pure helpers shared by its server (`grokpm/exec.ts`), its keyless recorder (`agents/grokpm_rec.ts`) and its page
// (`agents/grokpm_view.ts`), so they never hold different copies (the server may import nothing of `agents/` but the
// database client and live-prep's pure helpers: `src/grokpm_prereg.test.js`).
//
//   - The money limits as shares of the cap basis (Deviation D19, 2026-10-29; Davies: "把polymarket的策略里的钱全换成百分比，
//     这样的话可以有效实现盈利资金的再利用"): the agent's own equity at the start of the UTC day, so a cap holds still within a
//     day and grows or shrinks with the book from one day to the next.
//   - A resolution counts only at a final payout: 0, 1/2 or 1 (Deviation D14, 2026-10-24, the optimisation review's P4;
//     F1 already held the shadow forecasts' outcomes to it). Gamma can call a market closed while its price is still
//     short of the outcome (0.9995): such a market waits, unsettled, until a later read shows the payout.
//   - A market's last public trade at or before a moment, as one outcome token's price (F2's, now also the `market`
//     read's `last_trade`, Deviation D12).

/**
 * Deviation D19: each money limit of the pre-registration's §2 (and D15's, D18's) as a share of the cap basis. At a basis
 * of $100 they are §2's dollars exactly: $10 a market (an event under D17), $25 a theme, $30 of cash kept, D15's $5 and
 * D18's $10, and the day stop at −$10. The total stop is not here: it stays −$30 of the FUNDED $100, the test's FAIL.
 */
export const GROKPM_CAP_PCT = { market: 10, theme: 25, cashFloor: 30, thin: 5, thinBigEdge: 10, dayStop: 10 } as const;
/** D19's limits in dollars for one cap basis, and the basis they were taken from. */
export type GrokPmCaps = {
  basisUsd: number; marketCapUsd: number; themeCapUsd: number; cashFloorUsd: number; thinCapUsd: number; thinCapBigEdgeUsd: number; dayStopUsd: number;
};
/**
 * D19's limits for a cap basis (the agent's equity at the start of the UTC day; none under 0), to the cent and each the
 * careful way: a cap and the day stop's size are rounded down, the cash kept is rounded up. A basis that is not a number
 * gives every limit 0, so nothing opens on it.
 */
export function grokpmCaps(basisUsd: number): GrokPmCaps {
  const b = Number.isFinite(basisUsd) ? Math.max(0, basisUsd) : 0, P = GROKPM_CAP_PCT;
  // In cents, with a hair's room for binary fractions: 0.1 × 150 is 15.000000000000002, 0.3 × 107.37 is 32.211.
  const down = (pct: number) => Math.floor(b * pct + 1e-6) / 100, up = (pct: number) => Math.ceil(b * pct - 1e-6) / 100;
  return {
    basisUsd: r6(b), marketCapUsd: down(P.market), themeCapUsd: down(P.theme), cashFloorUsd: up(P.cashFloor), thinCapUsd: down(P.thin),
    thinCapBigEdgeUsd: down(P.thinBigEdge), dayStopUsd: down(P.dayStop),
  };
}

/** The payouts a resolution may carry: anything else is not an outcome yet. */
export const GROKPM_FINAL_PAYOUTS: readonly number[] = [0, 0.5, 1];
export const isFinalPayout = (p: unknown): boolean => typeof p === "number" && GROKPM_FINAL_PAYOUTS.includes(p);

/** Each token's payout from resolution rows (`grokpm_resolutions`: tokens, payouts), final payouts only (D14). */
export function finalPayouts(rows: Array<{ tokens: unknown; payouts: unknown }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const t = Array.isArray(r.tokens) ? r.tokens.map(String) : [], p = Array.isArray(r.payouts) ? r.payouts.map(Number) : [];
    t.forEach((tok, i) => { if (isFinalPayout(p[i])) out[tok] = p[i]; });
  }
  return out;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };

/** A taker trade as the data API serves it, reduced to what a last-trade read needs. */
export type GrokPmTape = { asset: string; side: string; price: number; size: number; timestamp: number };

/** The data API's `/trades` list as a tape; anything that is not a trade with an asset is dropped. */
export function tapeOf(raw: unknown): GrokPmTape[] {
  if (!Array.isArray(raw)) throw new Error("trades: not a list");
  return (raw as Array<Record<string, unknown>>).filter((t) => t && typeof t.asset === "string")
    .map((t) => ({ asset: String(t.asset), side: String(t.side ?? ""), price: Number(t.price), size: num(t.size), timestamp: num(t.timestamp) }));
}

/**
 * The last trade at or before `atMs` on a market's tape (newest first, `full` when the page was full), as the price of
 * `token`: a trade of the other outcome at q counts as 1 - q. Without one, why: the tape has nothing that old and the page
 * was not full (`none_before`: the market had not traded), or it was (`beyond_window`: the trade, if any, is older than
 * the page).
 */
export function lastTradeBefore(tape: GrokPmTape[], token: string, atMs: number, full: boolean) {
  let best: GrokPmTape | null = null;
  for (const t of tape) if (t.timestamp * 1000 <= atMs && Number.isFinite(t.price) && (!best || t.timestamp > best.timestamp)) best = t;
  if (!best) return { status: full ? "beyond_window" : "none_before", price: null, trade_at: null, trade_asset: null, trade_side: null, trade_size: null };
  return {
    status: "found", price: r6(best.asset === token ? best.price : 1 - best.price), trade_at: new Date(best.timestamp * 1000).toISOString(),
    trade_asset: best.asset, trade_side: best.side, trade_size: r6(best.size),
  };
}
