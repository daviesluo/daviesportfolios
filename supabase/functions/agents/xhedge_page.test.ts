// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" on the page, each venue's half apart (xhedge_page.ts; Davies, 2026-10-30: "…按实际两个
// 币所的funded和deployed和营收分别放在两个各自的里面去"). Pins, worked by hand: each venue's FUNDED, DEPLOYED, REALIZED (Revolut X's leg
// the trip's P&L before Coinbase's fee, Coinbase's leg less the fee), UNREALIZED and TODAY, and Revolut X's half plus Coinbase's
// equal to the arm to the bit; TODAY on the first day and with no balances at 00:00; then on the driver's own record.
import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { XH_VENUES, type XhOpenRow, type XhTripMoney, type XhView, readXhedgePage, xhHeldAt, xhPageMoney, xhRealisedByVenue } from "./xhedge_page.ts";
import { runXhedge, XH_ARMS, XH_BOOKS } from "./xhedge.ts";
import { memDb } from "./testing.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const DAY0 = Date.parse("2026-11-05T00:00:00Z");

// Revolut X holds £1,000 and coin worth £225 (100 USDT and 200 USDC at 0.75): £1,225. Coinbase holds £621.30 and coin worth £555
// (400 USDT and 340 USDC at 0.75): £1,176.30. Resting on Revolut X: a USDT bid of £100 (133.315557926 at 0.7501) and a USDC bid
// of £75 (100 at 0.75); its USDT ask is coin, already counted.
const view = {
  capitalGbp: 2400, capitalUsd: 3120, valueGbp: 2401.3, todayGbp: 0.45, realisedGbp: 1.05, unrealisedGbp: 0.25, feesGbp: 0.0135,
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

// Two trips: £0.60 yesterday (fee £0.0045) and £0.45 today (fee £0.009). Revolut X's legs: £0.6045 + £0.459 = £1.0635; Coinbase's:
// −£0.0135. They sum to the trips' £1.05.
const trips: XhTripMoney[] = [
  { pnl_gbp: 0.6, fee_gbp: 0.0045, t_hedge: iso(DAY0 - 3600e3) },
  { pnl_gbp: 0.45, fee_gbp: 0.009, t_hedge: iso(DAY0 + 300e3) },
];

// At 23:59: USDT-GBP Revolut X £500 + 400 coins, Coinbase £300 + 400 coins; USDC-GBP Revolut X £500, Coinbase 666 coins; mids 0.75.
// Revolut X held £800 + £500 = £1,300; Coinbase £600 + £499.50 = £1,099.50.
const open: XhOpenRow[] = [
  { book: "USDT-GBP", rx_bid: 0.7499, rx_ask: 0.7501, rx_gbp: 500, rx_coin: 400, cb_gbp: 300, cb_coin: 400 },
  { book: "USDC-GBP", rx_bid: 0.7495, rx_ask: 0.7505, rx_gbp: 500, rx_coin: 0, cb_gbp: 0, cb_coin: 666 },
];

Deno.test("each venue's half: FUNDED £1,200, DEPLOYED its coin (and Revolut X's bids), REALIZED by leg, UNREALIZED and TODAY; the two sum to the arm", () => {
  const p = xhPageMoney(view, open, DAY0, trips);
  const [rx, cb] = p.byVenue;
  assertEquals([rx.id, cb.id, rx.capitalGbp, cb.capitalGbp, p.venues], ["revx", "coinbase", 1200, 1200, ["revx", "coinbase"]]);
  assertEquals([rx.heldGbp, cb.heldGbp], [1225, 1176.3]);
  assertAlmostEquals(rx.deployedGbp, 400, 1e-6);                  // £225 of coin + £100 + £75 of bids
  assertAlmostEquals(rx.restingGbp, 175, 1e-6);
  assertEquals([cb.deployedGbp, cb.restingGbp], [555, 0]);
  assertAlmostEquals(rx.realisedGbp, 1.0635, 1e-12);
  assertAlmostEquals(cb.realisedGbp, -0.0135, 1e-12);
  assertAlmostEquals(rx.unrealisedGbp, 23.9365, 1e-9);            // £1,225 − £1,200 − £1.0635
  assertAlmostEquals(cb.unrealisedGbp, -23.6865, 1e-9);           // £1,176.30 − £1,200 + £0.0135
  assertEquals([rx.todayGbp, cb.todayGbp], [1225 - 1300, 1176.3 - 1099.5]);   // −£75, +£76.80
  assertEquals(rx.feesGbp, 0);                                    // Revolut X's maker fee is 0 %
  assertAlmostEquals(cb.feesGbp, 0.0135, 1e-12);
  // The arm is the two halves summed, to the bit, and those are the arm's own figures: FUNDED £2,400, DEPLOYED £955, REALIZED
  // £1.05, UNREALIZED £0.25, TODAY £2,401.30 − £2,399.50 = £1.80.
  for (const [k, a, b] of [["capitalGbp", "capitalGbp", "capitalGbp"], ["valueGbp", "deployedGbp", "deployedGbp"], ["realisedGbp", "realisedGbp", "realisedGbp"],
    ["unrealisedGbp", "unrealisedGbp", "unrealisedGbp"], ["todayGbp", "todayGbp", "todayGbp"], ["feesGbp", "feesGbp", "feesGbp"], ["heldGbp", "heldGbp", "heldGbp"],
    ["capitalUsd", "capitalUsd", "capitalUsd"], ["valueUsd", "deployedUsd", "deployedUsd"], ["realisedUsd", "realisedUsd", "realisedUsd"],
    ["unrealisedUsd", "unrealisedUsd", "unrealisedUsd"], ["todayUsd", "todayUsd", "todayUsd"]] as const) {
    assertEquals((p as unknown as Record<string, number>)[k], (rx as unknown as Record<string, number>)[a] + (cb as unknown as Record<string, number>)[b], k);
  }
  assertEquals([p.capitalGbp, p.costGbp, p.heldGbp], [2400, 2400, 2401.3]);
  assertAlmostEquals(p.valueGbp, 955, 1e-6);
  assertAlmostEquals(p.realisedGbp, 1.05, 1e-12);
  assertAlmostEquals(p.unrealisedGbp, 0.25, 1e-9);
  assertAlmostEquals(p.todayGbp, 1.8, 1e-9);
  assertAlmostEquals(p.capitalUsd, 3120, 1e-9);
  assertAlmostEquals(rx.capitalUsd, 1560, 1e-9);
  assertAlmostEquals(p.valueUsd, 1241.5, 1e-6);
  assertEquals(p.twin.venueNotes, [
    "Revolut X: £1,200.00 funded, £400.00 deployed (coin £225.00, resting bids £175.00); realised +£1.06, unrealised +£23.94, today −£75.00",
    "Coinbase: £1,200.00 funded, £555.00 deployed (coin £555.00); realised −£0.01, unrealised −£23.69, today +£76.80",
  ]);
  assertEquals([...XH_VENUES], ["revx", "coinbase"]);
  assertEquals(xhHeldAt(open), { revx: 1300, coinbase: 1099.5 });
  assertEquals(xhRealisedByVenue([]), { revx: 0, coinbase: 0 });
});

Deno.test("TODAY: on the first day each venue against its FUNDED; with no balances at 23:59 the trips closed today, split by leg", () => {
  const first = xhPageMoney({ ...view, twin: { ...view.twin, startedAt: iso(DAY0) } } as XhView, [], DAY0, trips);
  assertEquals(first.byVenue.map((x) => x.todayGbp), [25, 1176.3 - 1200]);
  assertAlmostEquals(first.todayGbp, 1.3, 1e-9);
  const dark = xhPageMoney(view, [], DAY0, trips);
  assertAlmostEquals(dark.byVenue[0].todayGbp, 0.459, 1e-12);
  assertAlmostEquals(dark.byVenue[1].todayGbp, -0.009, 1e-12);
  assertAlmostEquals(dark.todayGbp, 0.45, 1e-12);               // the trip closed today
  assertAlmostEquals(xhPageMoney(view, open.slice(0, 1), DAY0, trips).todayGbp, 0.45, 1e-12);   // one book's balances are not the arm's
  assertEquals(xhHeldAt([{ ...open[0], rx_bid: null }]), null);
  // A book not open yet holds its funding on each venue.
  const one = { ...view, detail: { ...view.detail, inventory: { ...view.detail.inventory, assets: (view.detail.inventory.assets as Array<{ asset: string }>).filter((a) => !a.asset.startsWith("USDC")) } } } as XhView;
  assertEquals(xhPageMoney(one, [], DAY0, []).byVenue.map((x) => x.heldGbp), [1000 + 75 + 600, 621.3 + 300 + 600]);
  // No rate yet: the dollars are 0.
  assertEquals(xhPageMoney({ ...view, capitalUsd: 0 } as XhView, open, DAY0, trips).valueUsd, 0);
});

Deno.test("on the driver's own record: both arms, each venue £1,200, its halves summing to the arm, Coinbase's realised its fees", async () => {
  const T0 = DAY0 + 10 * 60 * M;
  const books = [], touch = [];
  for (const b of XH_BOOKS) for (let i = -10; i <= 12; i++) {
    books.push({ book: b, ts: iso(T0 + i * M - 20e3), seen_until: iso(T0 + i * M - 20e3), bids: [[0.75, 5000, 1]], asks: [[0.7505, 5000, 1]] });
    touch.push({ product: b, ts: iso(T0 + i * M + 600), bid: 0.7504, ask: 0.7505, bid_size: 1e4, ask_size: 1e4 });
  }
  const st = { lastMinute: T0 - M, startedAt: DAY0 - 86400e3, books: {}, orders: { day: null, n: 0 } };
  // 23:59's balances, a book each arm: Revolut X £300 + 400 coins, Coinbase the same, at 0.75025: £600.10 a venue a book.
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
  assertEquals(pages.map((p) => [p.twin.id, p.capitalGbp, p.byVenue.map((x) => x.capitalGbp)]), [["xhedge", 2400, [1200, 1200]], ["xhedgebehind", 2400, [1200, 1200]]]);
  for (const p of pages) {
    const [rx, cb] = p.byVenue;
    assertEquals([p.valueGbp, p.realisedGbp, p.unrealisedGbp, p.todayGbp], [rx.deployedGbp + cb.deployedGbp, rx.realisedGbp + cb.realisedGbp, rx.unrealisedGbp + cb.unrealisedGbp, rx.todayGbp + cb.todayGbp]);
    assertAlmostEquals(rx.todayGbp, rx.heldGbp - 1200.2, 1e-6);
    assertAlmostEquals(cb.todayGbp, cb.heldGbp - 1200.2, 1e-6);
    assertEquals(cb.deployedGbp, cb.coinGbp);
  }
  // The inside arm's one trip: bought 133.315557926 at 0.7501, sold at 0.7504 less 0.45 bps. Revolut X's leg made 3 ticks on it,
  // Coinbase's paid the fee.
  const q = 100 / 0.7501, fee = q * 0.7504 * 0.000045;
  assertAlmostEquals(pages[0].byVenue[0].realisedGbp, q * 0.7504 - 100, 1e-6);
  assertAlmostEquals(pages[0].byVenue[1].realisedGbp, -fee, 1e-9);
  assertAlmostEquals(pages[0].realisedGbp, q * 0.7504 - fee - 100, 1e-6);
  assertAlmostEquals(pages[1].byVenue[0].restingGbp, 200, 1e-6);    // the behind arm's two £100 bids at 0.7496
});
