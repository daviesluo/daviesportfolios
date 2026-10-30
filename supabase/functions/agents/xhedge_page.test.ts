// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" on the page across both venues (xhedge_page.ts; Davies, 2026-10-30: "…funded和deployed
// 资金按两个币所实际的来，盈利状况也一样"). Pins, worked by hand: FUNDED is both venues' funding, DEPLOYED the coin on both and the
// pounds resting in Revolut X bids, TODAY what both hold against the last minute before 00:00 (FUNDED on the first day, the trips
// closed today when 00:00 has no balances), the dollars at the view's rate, and each venue's line; then on the driver's own record.
import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { XH_VENUES, type XhOpenRow, type XhView, readXhedgePage, xhHeldAt, xhPageMoney } from "./xhedge_page.ts";
import { runXhedge, XH_ARMS, XH_BOOKS } from "./xhedge.ts";
import { memDb } from "./testing.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const DAY0 = Date.parse("2026-11-05T00:00:00Z");

// Revolut X: £1,000 and coin worth £225 (100 USDT at 0.75, 200 USDC at 0.75); Coinbase: £621.30 and coin worth £555 (400 USDT,
// 340 USDC at 0.75). Resting: a USDT bid of £100 (133.315557926 at 0.7501), a USDC bid of £75 (100 at 0.75), a USDT ask (coin,
// already counted). Both venues hold £1,000 + £225 + £621.30 + £555 = £2,401.30, the view's valueGbp.
const view = {
  capitalGbp: 2400, capitalUsd: 3120, valueGbp: 2401.3, todayGbp: 0.25, realisedGbp: 1.05, unrealisedGbp: 0.25,
  twin: { id: "xhedge", arm: "inside", name: "Stablecoin quotes RX↔Coinbase hedge", startedAt: iso(DAY0 - 2 * 86400e3), notes: [] },
  detail: {
    inventory: { at: iso(DAY0 + 600e3), assets: [
      { asset: "GBP · Revolut X", amount: 1000 }, { asset: "USDT · Revolut X", amount: 100, price: 0.75, gbp: 75 }, { asset: "USDC · Revolut X", amount: 200, price: 0.75, gbp: 150 },
      { asset: "GBP · Coinbase", amount: 621.3 }, { asset: "USDT · Coinbase", amount: 400, price: 0.75, gbp: 300 }, { asset: "USDC · Coinbase", amount: 340, price: 0.75, gbp: 255 },
    ] },
    orders: [
      { book: "USDT-GBP", side: "bid", price: 0.7501, base: 133.315557926 }, { book: "USDT-GBP", side: "ask", price: 0.7507, base: 133.2 },
      { book: "USDC-GBP", side: "bid", price: 0.75, base: 100 },
    ],
  },
} as unknown as XhView;

// At 23:59: USDT-GBP £500 + £300 and 800 coins at the mid 0.75 (£1,400); USDC-GBP £500 and 666 coins at 0.75 (£999.50): £2,399.50.
const open: XhOpenRow[] = [
  { book: "USDT-GBP", rx_bid: 0.7499, rx_ask: 0.7501, rx_gbp: 500, rx_coin: 400, cb_gbp: 300, cb_coin: 400 },
  { book: "USDC-GBP", rx_bid: 0.7495, rx_ask: 0.7505, rx_gbp: 500, rx_coin: 0, cb_gbp: 0, cb_coin: 666 },
];

Deno.test("FUNDED both venues' £1,200, DEPLOYED the coin on both and Revolut X's resting bids, TODAY against 23:59, in dollars at the view's rate", () => {
  const p = xhPageMoney(view, open, DAY0);
  assertEquals([p.capitalGbp, p.costGbp, p.venues], [2400, 2400, ["revx", "coinbase"]]);
  assertEquals(p.byVenue.map((x) => [x.id, x.capitalGbp]), [["revx", 1200], ["coinbase", 1200]]);
  // Revolut X: £225 of coin + £100 + £75 of bids = £400; Coinbase: £555 of coin, nothing resting. £955 in all.
  assertAlmostEquals(p.byVenue[0].deployedGbp, 400, 1e-6);
  assertAlmostEquals(p.byVenue[0].restingGbp, 175, 1e-6);
  assertEquals([p.byVenue[1].deployedGbp, p.byVenue[1].restingGbp, p.byVenue[1].gbp], [555, 0, 621.3]);
  assertAlmostEquals(p.valueGbp, 955, 1e-6);
  assertAlmostEquals(xhHeldAt(open)!, 2399.5, 1e-9);
  assertAlmostEquals(p.todayGbp, 1.8, 1e-9);                          // £2,401.30 − £2,399.50
  assertEquals([p.heldGbp, p.realisedGbp, p.unrealisedGbp], [2401.3, 1.05, 0.25]);   // the view's own, both legs of each trip
  assertAlmostEquals(p.capitalUsd, 3120, 1e-9);
  assertAlmostEquals(p.valueUsd, 1241.5, 1e-6);
  assertAlmostEquals(p.todayUsd, 2.34, 1e-9);
  assertEquals(p.twin.venueNotes, [
    "Revolut X: £1,200.00 funded, £400.00 deployed (coin £225.00, resting bids £175.00)",
    "Coinbase: £1,200.00 funded, £555.00 deployed (coin £555.00)",
  ]);
  assertEquals([...XH_VENUES], ["revx", "coinbase"]);
});

Deno.test("TODAY on the first day is against FUNDED; with no balances at 23:59 it is the trips closed today", () => {
  const first = { ...view, twin: { ...view.twin, startedAt: iso(DAY0) } } as XhView;
  assertAlmostEquals(xhPageMoney(first, [], DAY0).todayGbp, 1.3, 1e-9);           // £2,401.30 − £2,400
  assertEquals(xhPageMoney(view, [], DAY0).todayGbp, 0.25);
  assertEquals(xhPageMoney(view, open.slice(0, 1), DAY0).todayGbp, 0.25);        // one book's balances are not the arm's
  assertEquals(xhHeldAt([{ ...open[0], rx_bid: null }]), null);
  assertEquals(xhPageMoney(view, [{ ...open[0], rx_bid: null }, open[1]], DAY0).todayGbp, 0.25);
  // No rate yet: the dollars are 0, as the view's.
  assertEquals(xhPageMoney({ ...view, capitalUsd: 0 } as XhView, open, DAY0).valueUsd, 0);
});

Deno.test("on the driver's own record: both arms, FUNDED £2,400, DEPLOYED both venues' coin and the resting bids, TODAY what both hold less 23:59's", async () => {
  const T0 = DAY0 + 10 * 60 * M;
  const books = [], touch = [];
  for (const b of XH_BOOKS) for (let i = -10; i <= 12; i++) {
    books.push({ book: b, ts: iso(T0 + i * M - 20e3), seen_until: iso(T0 + i * M - 20e3), bids: [[0.75, 5000, 1]], asks: [[0.7505, 5000, 1]] });
    touch.push({ product: b, ts: iso(T0 + i * M + 600), bid: 0.7504, ask: 0.7505, bid_size: 1e4, ask_size: 1e4 });
  }
  const st = { lastMinute: T0 - M, startedAt: DAY0 - 86400e3, books: {}, orders: { day: null, n: 0 } };
  // 23:59's balances, a book each arm: £300 + £300 and 800 coins at 0.75025 (£1,200.20) a book.
  const minutes = XH_ARMS.flatMap((a) => XH_BOOKS.map((b) => ({ arm: a.arm, book: b, minute: iso(DAY0 - M), rx_bid: 0.75, rx_ask: 0.7505, rx_gbp: 300, rx_coin: 400, cb_gbp: 300, cb_coin: 400 })));
  const { db } = memDb({
    agent_locks: [{ name: "xhedge", lease_until: iso(0), holder: null }], agent_book_levels: books, cb_touch: touch,
    agent_quote_prints: [{ id: "s1", book: "USDT-GBP", ts: iso(T0 + 2 * M + 40e3), price: 0.7501, qty: 400, side: "sell" }],
    agent_quote_inputs: [{ kind: "fx", t: iso(T0), value: 1.3 }],
    agent_xhedge_state: XH_ARMS.map((a) => ({ arm: a.arm, state: structuredClone(st), last_minute: iso(T0 - M), updated_at: iso(0), last_error: null })),
    agent_xhedge_minutes: minutes, agent_xhedge_fills: [], agent_xhedge_trips: [], agent_xhedge_days: [],
  }, { now: () => T0 + 10 * M });
  await runXhedge({ db, now: T0 + 10 * M, holder: "h" });
  const pages = await readXhedgePage(db, T0 + 10 * M, DAY0);
  assertEquals(pages.map((p) => [p.twin.id, p.capitalGbp, p.venues]), [["xhedge", 2400, ["revx", "coinbase"]], ["xhedgebehind", 2400, ["revx", "coinbase"]]]);
  for (const p of pages) {
    assertAlmostEquals(p.valueGbp, p.byVenue[0].deployedGbp + p.byVenue[1].deployedGbp, 1e-9);
    assertAlmostEquals(p.todayGbp, p.heldGbp - 2 * 1200.2, 1e-6);
    assertAlmostEquals(p.byVenue[1].deployedGbp, p.byVenue[1].coinGbp, 1e-12);
  }
  // The behind arm rests a £100 bid on each book at 0.7496: Revolut X's deployed is its coin and those two bids.
  const behind = pages[1];
  assertAlmostEquals(behind.byVenue[0].restingGbp, 200, 1e-6);
});
