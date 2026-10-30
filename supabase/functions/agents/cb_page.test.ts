// A Coinbase arm's page in whole dollars (`coinbaseInUsd`, cb_page.ts; Davies, 2026-10-29: "C，coinbase的也是改用美元", then
// "Coinbase策略中funded数字怎么那么奇怪，都改成整数调整"): `ccy` "USD", FUNDED the rungs × the dollar rung, a whole number; what was
// entered before the switch × its book's factor (1 / GBP/USD on a GBP book, 1 / EUR/USD on a EUR book), what came after as it is;
// prices and counts unscaled; each pound field the dollar one ÷ GBP/USD.

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CB_HOLD_PAGE_NAME, CB_NUDGE_PAGE_NAME, CB_USDC_PAGE_NAME, coinbaseInUsd } from "./cb_page.ts";
import { booksAYear } from "./book_ratio.ts";
import { twinBookRatio } from "./index.ts";
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

// ---- 2026-10-30 (Davies: "…“Stablecoin quotes with Euros”改为“Stablecoin quotes with Euros - 2”放在-1之后并且改为每档50，-1和-2都像revolut那几个
// 一样在scoreboard底下加上不同币的performace对比"): the names, the weekend variant at $50, and each book's and coin's realised a year.

Deno.test("the Coinbase arms' page names since 2026-10-30: the LIVE twin, then \"with Euros - 1\" and \"- 2\"", () => {
  assertEquals([CB_NUDGE_PAGE_NAME, CB_USDC_PAGE_NAME, CB_HOLD_PAGE_NAME], ["Stablecoin quotes USDC/GBP LIVE twin", "Stablecoin quotes with Euros - 1", "Stablecoin quotes with Euros - 2"]);
});

Deno.test("coinbaseInUsd on two books or more: each book's and coin's realised a year on its share since the arm began, in dollars", () => {
  const from = Date.parse("2026-10-28T00:00:00Z"), now = Date.parse("2026-10-30T00:00:00Z"), years = 2 / 365;
  const st = { ...state, startedAt: from } as unknown as CbQuoteState;
  const v = { ...view(), twin: { id: "coinbaseusdc", name: CB_USDC_PAGE_NAME } };
  const u = coinbaseInUsd(v, { ...arm, state: st, rungUsd: 100, books: 2, nowMs: now });
  const r = u.twin.bookRatio;
  assertEquals([r.from, r.ccy, r.order, u.capitalUsd], ["2026-10-28T00:00:00.000Z", "USD", ["USDC-GBP", "USDC-EUR"], 1200]);
  // Each book's share is half the $1,200; its trips are the dollar ones above (before the switch × the book's factor).
  const gbp = 0.1 + 0.05 * G, eur = 0.08 * G / E;
  assertEquals([r.books["USDC-GBP"].trips, r.books["USDC-EUR"].trips, r.coins.USDC.trips], [2, 1, 3]);
  assertAlmostEquals(r.books["USDC-GBP"].pctYear, 100 * gbp / 600 / years, 1e-9);
  assertAlmostEquals(r.books["USDC-EUR"].pctYear, 100 * eur / 600 / years, 1e-9);
  assertAlmostEquals(r.coins.USDC.pctYear, 100 * (gbp + eur) / 1200 / years, 1e-9);
  assertEquals(r.usdtOverUsdc, null);
  // One book (the LIVE twin), no clock, or no start: no line.
  assertEquals(coinbaseInUsd({ ...v, detail: { ...v.detail, books: [v.detail.books[0]] } }, { ...arm, state: st, books: 1, nowMs: now }).twin.bookRatio, undefined);
  assertEquals(coinbaseInUsd(v, { ...arm, state: st, books: 2 }).twin.bookRatio, undefined);
  assertEquals(coinbaseInUsd(v, { ...arm, state, books: 2, nowMs: now }).twin.bookRatio, undefined);
});

Deno.test("booksAYear: USDT's over USDC's from each coin's books together; Revolut X's two-book reading is unchanged by it", () => {
  const from = Date.parse("2026-10-30T00:00:00Z"), now = from + 10 * 864e5, yr = 10 / 365;
  const t = (book: string, pnl: number, at = from + 864e5) => ({ book, tExit: new Date(at).toISOString(), pnl });
  const r = booksAYear([t("USDC-GBP", 1), t("USDC-EUR", 1), t("USDT-GBP", 3), t("USDT-EUR", 1), t("USDT-EUR", 9, from - 1)], { from, now, capital: 1200, books: ["USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"] })!;
  assertEquals(Object.keys(r.coins), ["USDC", "USDT"]);
  assertEquals([r.coins.USDC.trips, r.coins.USDT.trips, r.coins.USDC.share, r.books["USDT-EUR"].trips], [2, 2, 600, 1]);
  assertAlmostEquals(r.coins.USDC.pctYear!, 100 * 2 / 600 / yr, 1e-9);
  assertAlmostEquals(r.usdtOverUsdc!, 4 / 2, 1e-12);
  assertEquals(booksAYear([], { from, now: from, capital: 1, books: ["USDC-GBP"] }), null);
  // Revolut X's both-books twin, as `twinBookRatio` reads it: the payload's shape in pounds, its ratio the books' own.
  const x = twinBookRatio([{ book: "USDC-GBP", tExit: new Date(from + 864e5).toISOString(), pnlGbp: 2 }, { book: "USDT-GBP", tExit: new Date(from + 864e5).toISOString(), pnlGbp: 3 }],
    { from, book: { "USDC-GBP": 1, "USDT-GBP": 1 } }, 600, now)!;
  assertEquals(Object.keys(x.books["USDC-GBP"]).sort(), ["pctYear", "realisedGbp", "shareGbp", "trips"]);
  assertAlmostEquals(x.usdtOverUsdc!, x.books["USDT-GBP"].pctYear! / x.books["USDC-GBP"].pctYear!, 1e-12);
  assertEquals(x.from, "2026-10-30T00:00:00.000Z");
});

Deno.test("the weekend variant at $50 (its Deviation 7): FUNDED $1,200, what came before its switch × 1/2, after it as it is", () => {
  const R50 = Date.parse("2026-10-29T06:30:00Z");
  const st = { ...state, usd50From: R50, usd50Factor: 0.5 } as unknown as CbQuoteState;
  const u = coinbaseInUsd(view(), { ...arm, state: st, rungUsd: 50, books: 4, resizeFactor: 0.5 });
  assertEquals([u.capitalUsd, u.rungUsd, u.resizeFrom, u.resizeFactor], [1200, 50, "2026-10-29T06:30:00.000Z", 0.5]);
  // All three trips were entered before the resize: each × 1/2 on top of its dollar factor.
  assertAlmostEquals(u.realisedUsd, (0.1 + 0.08 * G / E + 0.05 * G) / 2, 1e-12);
  // Before the arm has switched, everything is shown × 1/2.
  const pre = coinbaseInUsd(view(), { ...arm, state, rungUsd: 50, books: 4, resizeFactor: 0.5 });
  assertAlmostEquals(pre.realisedUsd, u.realisedUsd, 1e-12);
});
