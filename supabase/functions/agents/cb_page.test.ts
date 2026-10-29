// A Coinbase arm's page in dollars (`coinbaseInUsd`, cb_page.ts; Davies, 2026-10-29: "C，coinbase的也是改用美元"): `ccy` "USD",
// and each pounds figure of the detail given beside it in dollars at the view's own GBP/USD; sizes, prices and the pounds as
// they were.

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { coinbaseInUsd } from "./cb_page.ts";

Deno.test("coinbaseInUsd marks the arm in dollars and gives each detail figure in dollars at the view's own GBP/USD", () => {
  const v = {
    venue: "coinbase", capitalGbp: 2250, capitalUsd: 2970, realisedGbp: 1, realisedUsd: 1.32,           // GBP/USD 1.32
    detail: {
      books: [{ book: "USDC-EUR", realisedGbp: 0.5 }],
      rungs: [{ book: "USDC-EUR", held: { base: 132, avgEntry: 0.8649, costGbp: 100, unrealisedGbp: -0.25 } }, { book: "USDC-EUR", held: null }],
      days: [{ day: "2026-10-29", realisedGbp: 0.4 }],
      trips: [{ book: "USDC-EUR", pnlGbp: 0.2, feesGbp: 0 }],
      orders: [],
    },
  };
  const u = coinbaseInUsd(v);
  assertEquals([u.ccy, u.capitalUsd, u.capitalGbp, u.realisedUsd], ["USD", 2970, 2250, 1.32]);
  assertAlmostEquals(u.detail.books[0].realisedUsd, 0.66, 1e-12);
  assertAlmostEquals(u.detail.rungs[0].held.costUsd, 132, 1e-12);
  assertAlmostEquals(u.detail.rungs[0].held.unrealisedUsd, -0.33, 1e-12);
  assertEquals([u.detail.rungs[0].held.base, u.detail.rungs[0].held.avgEntry, u.detail.rungs[0].held.costGbp, u.detail.rungs[1].held], [132, 0.8649, 100, null]);
  assertAlmostEquals(u.detail.days[0].realisedUsd, 0.528, 1e-12);
  assertEquals([u.detail.trips[0].feesUsd, u.detail.trips[0].pnlGbp], [0, 0.2]);
  assertAlmostEquals(u.detail.trips[0].pnlUsd, 0.264, 1e-12);
  assertEquals(coinbaseInUsd(null), null);
});
