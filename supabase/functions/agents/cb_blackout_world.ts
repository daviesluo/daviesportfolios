// The hand-worked world of the release blackout's pins (cb_quotes.test.ts, cb_hold.test.ts): USDC-GBP around the FOMC statement of
// 2026-10-28 18:00 UTC (cb_releases.ts), a test helper and nothing the engine imports. Fair £0.8000 (GBP/USD 1.25, the coin $1.00):
// the bids sit at £0.7992 / £0.7984 / £0.7976 (k = .1 / .2 / .3 %), the exits at £0.8000. The blackout minutes are 17:59 to 18:05
// (T − 1 to T + 5); the world starts at 17:54 and the first lit turn after the window is 18:06.

import type { CbProduct } from "./cb_rec.ts";

const M = 60e3;
export const BLACKOUT_T0 = Date.UTC(2026, 9, 28, 17, 54);

export function blackoutPrints(t0: number) {
  const p = (id: number, min: number, sec: number, price: string, size: string, side: "buy" | "sell") =>
    ({ book: "USDC-GBP" as CbProduct, id: 7100000 + id, at: t0 + min * M + sec * 1000, price, size, side });
  return [
    p(1, 1, 5, "0.79910000", "2000.00", "sell"),    // 17:55:05 through the .1 % bid only: rung A fills (before the window)
    p(2, 4, 5, "0.79830000", "2000.00", "sell"),    // 17:58:05 through the .2 % bid: rung B fills (the minute before the window)
    p(3, 5, 30, "0.79700000", "2000.00", "sell"),   // 17:59:30 through every bid: the .3 % rung would fill, but the window has begun (T − 1)
    p(4, 6, 5, "0.80010000", "10.00", "buy"),       // 18:00:05 (T) through the exits: A's resting exit fills, in the window
    p(5, 9, 30, "0.79700000", "2000.00", "sell"),   // 18:03:30 through the bids again: nothing rests (in the window)
    p(6, 11, 30, "0.79960000", "10.00", "buy"),     // 18:05:30 (T + 5) inside the spread: it only moves the last print
    p(7, 13, 5, "0.80010000", "10.00", "buy"),      // 18:07:05 through the exit B was given when the fair came back
    p(8, 13, 30, "0.79900000", "2000.00", "sell"),  // 18:07:30 through the .1 % bid, re-placed when the fair came back
  ];
}
