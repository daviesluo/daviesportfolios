// GROKPM's pure helpers shared by its server (`grokpm/exec.ts`) and its keyless recorder (`agents/grokpm_rec.ts`), so the
// two never hold different copies (the server may import nothing of `agents/` but the database client and live-prep's
// pure helpers: `src/grokpm_prereg.test.js`).
//
//   - A resolution counts only at a final payout: 0, 1/2 or 1 (Deviation D14, 2026-10-24, the optimisation review's P4;
//     F1 already held the shadow forecasts' outcomes to it). Gamma can call a market closed while its price is still
//     short of the outcome (0.9995): such a market waits, unsettled, until a later read shows the payout.
//   - A market's last public trade at or before a moment, as one outcome token's price (F2's, now also the `market`
//     read's `last_trade`, Deviation D12).

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
