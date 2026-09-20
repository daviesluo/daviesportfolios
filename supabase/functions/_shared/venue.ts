// The venue interface the tick trades through. Two implementations:
// `revxVenue` (revx.ts) and `krakenVenue` (kraken.ts). Every strategy row
// names its venue; the tick reads that venue's candles, quotes at its
// touch, sizes by its pair config, and settles against its order book —
// so a paper run on each venue is a fair rehearsal of a live run there,
// fee model included.

import type { Candle, PairConfig } from "./agents_strategy.ts";

export type VenueId = "revx" | "kraken";

export type Quote = { bid: number; ask: number };
export type VenueOrderState = "new" | "partially_filled" | "filled" | "cancelled" | "rejected";

export type PlaceResult =
  | { ok: true; venueOrderId: string; state: "new" | "filled"; response: unknown }
  | { ok: false; status: number; error: string; response: unknown };

export type OrderView = { state: VenueOrderState; filledBase: number; avgPrice: number | null; feeUsd: number; raw: unknown };

export type LimitOrder = { clientOrderId: string; symbol: string; side: "buy" | "sell"; base: string; price: string };

export type Venue = {
  id: VenueId;
  /** Credentials loaded — live orders possible. Public data works without. */
  canTrade: boolean;
  /** Basis points per side; paper fills charge `maker`. */
  feeBps: { maker: number; taker: number };
  candles(symbol: string, intervalMin: number, sinceMs: number, untilMs: number): Promise<Candle[]>;
  quotes(symbols: string[]): Promise<Record<string, Quote>>;
  pairs(symbols: string[]): Promise<Record<string, PairConfig>>;
  /** A resting post-only limit at `price`. */
  placeLimit(o: LimitOrder): Promise<PlaceResult>;
  cancel(venueOrderId: string): Promise<{ ok: boolean; error?: string }>;
  order(venueOrderId: string): Promise<{ ok: true; view: OrderView } | { ok: false; error: string }>;
  /** currency → total, e.g. { USD: 100, BTC: 0.0002 }. Empty without credentials. */
  balances(): Promise<Record<string, number>>;
};

/** Paper fee for a fill at the venue's maker rate. */
export function paperFeeUsd(base: number, price: number, feeBps: { maker: number }): number {
  return Math.round(base * price * feeBps.maker / 1e4 * 1e6) / 1e6;
}
