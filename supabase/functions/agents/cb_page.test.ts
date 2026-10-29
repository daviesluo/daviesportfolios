// A Coinbase arm's page in whole dollars (`coinbaseInUsd`, cb_page.ts; Davies, 2026-10-29: "C，coinbase的也是改用美元", then
// "Coinbase策略中funded数字怎么那么奇怪，都改成整数调整"): `ccy` "USD", FUNDED the rungs × the dollar rung, a whole number; what was
// entered before the switch × its book's factor (1 / GBP/USD on a GBP book, 1 / EUR/USD on a EUR book), what came after as it is;
// prices and counts unscaled; each pound field the dollar one ÷ GBP/USD.

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { coinbaseInUsd } from "./cb_page.ts";
import type { CbQuoteState } from "./cb_quotes.ts";

const SWITCH = Date.parse("2026-10-29T05:00:00Z"), G = 1.3324, E = 1.1152;
const state = { usdFrom: SWITCH, usdGbpusd: G, usdEurusd: E, usdFactor: { GBP: 1 / G, EUR: 1 / E } } as unknown as CbQuoteState;
// A GBP trip before the switch (£0.10), a EUR trip before it (£0.08), a GBP trip after it (£0.05); today from 00:00 on 10-29.
const trips = [
  { book: "USDC-GBP", side: "bid", k: 0.001, t_entry: "2026-10-28T10:00:00Z", t_exit: "2026-10-28T11:00:00Z", entry: 0.7992, exit: 0.8, qty: 125, how: "maker", pnl_gbp: 0.1 },
  { book: "USDC-EUR", side: "ask", k: 0.002, t_entry: "2026-10-29T04:00:00Z", t_exit: "2026-10-29T06:00:00Z", entry: 0.91, exit: 0.909, qty: 110, how: "maker", pnl_gbp: 0.08 },
  { book: "USDC-GBP", side: "bid", k: 0.001, t_entry: "2026-10-29T05:00:00Z", t_exit: "2026-10-29T07:00:00Z", entry: 0.7992, exit: 0.8, qty: 93.8, how: "maker", pnl_gbp: 0.05 },
];
const view = () => ({
  capitalGbp: 2204, capitalUsd: 2204 * G, openOrders: 21, heldRungs: 1,
  detail: {
    books: [{ book: "USDC-GBP", realisedGbp: 0.15 }, { book: "USDC-EUR", realisedGbp: 0.08 }],
    rungs: [
      { book: "USDC-EUR", side: "bid", k: 0.003, order: null, held: { base: 110, avgEntry: 0.906, since: "2026-10-29T03:00:00Z", costGbp: 84, unrealisedGbp: 0.2 } },
      { book: "USDC-GBP", side: "bid", k: 0.001, order: { price: 0.7992 }, held: null },
    ],
    days: [{ day: "2026-10-29", trips: 2, realisedGbp: 0.13 }, { day: "2026-10-28", trips: 1, realisedGbp: 0.1 }],
    trips: trips.slice().reverse().map((t) => ({ book: t.book, tEntry: t.t_entry, tExit: t.t_exit, entry: t.entry, exit: t.exit, qty: t.qty, pnlGbp: t.pnl_gbp, feesGbp: 0 })),
  },
});
const arm = { trips: trips as never, gbpusd: G, eurusd: 1.12, dayStartMs: Date.parse("2026-10-29T00:00:00Z"), rungUsd: 100, books: 4 };

Deno.test("coinbaseInUsd: FUNDED a whole number of dollars, what came before the switch × its book's factor, after it as it is", () => {
  const u = coinbaseInUsd(view(), { ...arm, state });
  assertEquals([u.ccy, u.capitalUsd, u.rungUsd, u.usdFrom], ["USD", 2400, 100, "2026-10-29T05:00:00.000Z"]);
  assertEquals(Number.isInteger(u.capitalUsd), true);
  assertAlmostEquals(u.capitalGbp, 2400 / G, 1e-9);
  // Each trip in dollars: £ × GBP/USD × the factor before the switch, × 1 from it.
  const gOld = 0.1 * G / G, eOld = 0.08 * G / E, gNew = 0.05 * G;
  assertAlmostEquals(u.realisedUsd, gOld + eOld + gNew, 1e-12);
  assertAlmostEquals(u.todayUsd, eOld + gNew, 1e-12);
  assertAlmostEquals(u.realisedGbp, (gOld + eOld + gNew) / G, 1e-12);
  assertEquals(u.detail.trips.map((t: { pnlUsd: number }) => Number(t.pnlUsd.toFixed(9))), [gNew, eOld, gOld].map((x) => Number(x.toFixed(9))));
  // Sizes scale, prices do not; an after-switch trip is untouched.
  assertAlmostEquals(u.detail.trips[2].qty, 125 / G, 1e-12);
  assertAlmostEquals(u.detail.trips[1].qty, 110 / E, 1e-12);
  assertEquals([u.detail.trips[0].qty, u.detail.trips[2].entry], [93.8, 0.7992]);
  // The books and days from the trips, by close day.
  assertAlmostEquals(u.detail.books[0].realisedUsd, gOld + gNew, 1e-12);
  assertAlmostEquals(u.detail.books[1].realisedUsd, eOld, 1e-12);
  assertAlmostEquals(u.detail.days[0].realisedUsd, eOld + gNew, 1e-12);
  assertAlmostEquals(u.detail.days[1].realisedUsd, gOld, 1e-12);
  // A rung held from before the switch: cost, P&L and size × the EUR factor; DEPLOYED its cost plus $100 a resting rung.
  const h = u.detail.rungs[0].held;
  assertAlmostEquals(h.costUsd, 84 * G / E, 1e-9);
  assertAlmostEquals(h.unrealisedUsd, 0.2 * G / E, 1e-12);
  assertAlmostEquals(h.base, 110 / E, 1e-12);
  assertAlmostEquals(u.valueUsd, 84 * G / E + 21 * 100, 1e-9);
  assertEquals(u.detail.rungs[1], view().detail.rungs[1]);
});

Deno.test("coinbaseInUsd before the arm has switched: everything is shown at the dollar size on the latest rates; null stays null", () => {
  const u = coinbaseInUsd(view(), { ...arm, state: {} as CbQuoteState });
  assertEquals([u.capitalUsd, u.usdFrom], [2400, null]);
  assertAlmostEquals(u.realisedUsd, 0.1 + 0.08 * G / 1.12 + 0.05, 1e-12);
  assertEquals(coinbaseInUsd(null, { ...arm, state }), null);
  // The USDC arm: $25 a rung on two books.
  assertEquals(coinbaseInUsd(view(), { ...arm, state, rungUsd: 25, books: 2 }).capitalUsd, 300);
});
