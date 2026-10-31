// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" (xhedge.ts, 0184; docs/agents/reviews/2026-10-30-xhedge-prereg.md). Pins, each
// worked by hand on a made-up world: (1) the rule's numbers and its two arms; (2) the prices: the inside arm a tick inside, never
// crossing, never past Coinbase ± 2 bps; the behind arm 10 bps from Coinbase's mid, never better than Revolut X's touch, filled
// only through;
// (3) a fill and its hedge, to the penny; (4) no rebalancing: a side runs out and stops, and the other side's fill brings it back;
// (5) a stale Coinbase or Revolut X book quotes nothing; (6) a joined price fills only through, an inside one at its price;
// (7) a £0.10 print waits as dust until £1; (8) the order governor, both books together across midnight; (9) the driver on
// the database, both arms in one run, idempotent, starting at the next 00:00 UTC, reading a book that stood still for an hour;
// (10) the page's view, an arm each.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CbRead, type RxBook, type RxPrint, XH_BOOKS, XH_CB_FEE, XH_CB_STALE_MS, XH_HEDGE_DELAY_MS, XH_ID, XH_MARGIN, XH_MIN_HEDGE_GBP, XH_NAME, XH_ORDER_CAP_DAY,
  XH_ARMS, XH_BEHIND_BPS, XH_Q_GBP, XH_TABLES, XH_VENUE_GBP, xhBlock, xhNewBook, xhSettle, xhStart, xhStep, xhView, xhWant, xhWantBehind, readXhedge, runXhedge,
} from "./xhedge.ts";
import { memDb } from "./testing.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse("2026-11-03T10:00:00Z");
const rxAt = (at: number, bid: number, ask: number): RxBook => ({ at, seenUntil: at, bid, ask });
const cbAt = (at: number, bid: number, ask: number): CbRead => ({ at, bid, ask });
const pr = (id: string, ts: number, price: number, qty: number, side: "buy" | "sell"): RxPrint => ({ id, ts, price, qty, side });

Deno.test("the rule's numbers: £600 a venue a book, £100 an order, 2 bps under Coinbase, 0.45 bps, 30 s, 60 s stale", () => {
  assertEquals([XH_VENUE_GBP, XH_Q_GBP, XH_MARGIN, XH_CB_FEE, XH_HEDGE_DELAY_MS, XH_CB_STALE_MS, XH_MIN_HEDGE_GBP, XH_ORDER_CAP_DAY],
    [600, 100, 0.0002, 0.000045, 30e3, 60e3, 1, 2400]);
  assertEquals([XH_ID, XH_NAME, [...XH_BOOKS]], ["xhedge", "Stablecoin quotes RX↔Coinbase hedge", ["USDT-GBP", "USDC-GBP"]]);
  assertEquals(XH_TABLES, { state: "agent_xhedge_state", minutes: "agent_xhedge_minutes", fills: "agent_xhedge_fills", trips: "agent_xhedge_trips", days: "agent_xhedge_days" });
  assertEquals(XH_ARMS.map((a) => [a.arm, a.id, a.name, a.dBps]), [
    ["inside", "xhedge", "Stablecoin quotes RX↔Coinbase hedge", 0], ["behind", "xhedgebehind", "Stablecoin quotes RX↔Coinbase hedge - 1", 10],
  ]);
  assertEquals(XH_BEHIND_BPS, 10);
});

Deno.test("the behind arm's prices: Coinbase's mid ∓ 10 bps, never better than Revolut X's own touch, never past Coinbase ± 2 bps", () => {
  // Coinbase 0.7504 / 0.7505, mid 0.75045: 0.75045 × 0.999 = 0.74969955 → 0.7496; × 1.001 = 0.75120045 → 0.7513. Both behind
  // Revolut X's 0.7500 / 0.7505.
  assertEquals(xhWantBehind({ bid: 0.75, ask: 0.7505 }, { bid: 0.7504, ask: 0.7505 }), { bid: 0.7496, ask: 0.7513 });
  // Revolut X far under Coinbase: 0.7496 would be inside its 0.7400 / 0.7410 book; it joins the bid instead, and the ask stays at 0.7513.
  assertEquals(xhWantBehind({ bid: 0.74, ask: 0.741 }, { bid: 0.7504, ask: 0.7505 }), { bid: 0.74, ask: 0.7513 });
  // Revolut X far over Coinbase: the ask joins Revolut X's 0.7505; the bid is Coinbase's mid less 10 bps (0.74005 × 0.999 → 0.7393).
  assertEquals(xhWantBehind({ bid: 0.75, ask: 0.7505 }, { bid: 0.74, ask: 0.7401 }), { bid: 0.7393, ask: 0.7505 });
  // The behind arm's bid at Revolut X's best fills only on a print through it; inside arm's one tick better fills at it.
  const behind = XH_ARMS[1];
  const rx = [rxAt(T0 - 20e3, 0.74, 0.741)], cb = [cbAt(T0 + 1e3, 0.7504, 0.7505)];
  const at = xhStep("USDT-GBP", xhNewBook(0.7405, 0.75045), { t: T0, rx, cb, prints: [pr("a", T0 + 40e3, 0.74, 500, "sell")], ordersToday: 0 }, behind);
  assertEquals([at.minute.arm, at.minute.our_bid, at.fills.length], ["behind", 0.74, 0]);
  const through = xhStep("USDT-GBP", xhNewBook(0.7405, 0.75045), { t: T0, rx, cb, prints: [pr("t", T0 + 40e3, 0.7399, 500, "sell")], ordersToday: 0 }, behind);
  assertEquals([through.fills.length, through.fills[0].inside, through.fills[0].price, through.fills[0].arm], [1, false, 0.74, "behind"]);
  const inside = xhStep("USDT-GBP", xhNewBook(0.7405, 0.75045), { t: T0, rx, cb, prints: [pr("i", T0 + 40e3, 0.7401, 500, "sell")], ordersToday: 0 });
  assertEquals([inside.minute.arm, inside.minute.our_bid, inside.fills.length, inside.fills[0].inside], ["inside", 0.7401, 1, true]);
});

Deno.test("the prices: a tick inside Revolut X's touch, never crossing it, never past Coinbase's touch ± 2 bps", () => {
  // Revolut X 0.7500 / 0.7505, Coinbase 0.7504 / 0.7505: the bid 0.7501 (inside; Coinbase's cap 0.7504 × 0.9998 = 0.75025 → 0.7502);
  // the ask can go no lower than 0.7505 × 1.0002 = 0.75065 → 0.7507, beyond Revolut X's ask: it rests there, behind the book.
  assertEquals(xhWant({ bid: 0.75, ask: 0.7505 }, { bid: 0.7504, ask: 0.7505 }), { bid: 0.7501, ask: 0.7507 });
  // Coinbase's bid low: the cap binds the bid (0.7500 × 0.9998 = 0.74985 → 0.7498), under Revolut X's own bid.
  assertEquals(xhWant({ bid: 0.75, ask: 0.7505 }, { bid: 0.75, ask: 0.7501 }).bid, 0.7498);
  // A one-tick book: never crossing, the bid joins the bid and the ask the ask.
  assertEquals(xhWant({ bid: 0.75, ask: 0.7501 }, { bid: 0.76, ask: 0.74 }), { bid: 0.75, ask: 0.7501 });
});

Deno.test("a fill and its hedge: bought on Revolut X at 0.7501, sold at Coinbase's next read 30 s on at 0.7506 less 0.45 bps", () => {
  const s = xhNewBook(0.75025, 0.75045);
  assertEquals([s.rxGbp, s.cbGbp], [300, 300]);
  assertAlmostEquals(s.rxCoin, 300 / 0.75025, 1e-6);
  const rx = [rxAt(T0 - 20e3, 0.75, 0.7505)];
  const cb = [cbAt(T0 + 1e3, 0.7504, 0.7505), cbAt(T0 + 61e3, 0.7505, 0.7506), cbAt(T0 + 121e3, 0.7506, 0.7507)];
  const out = xhStep("USDT-GBP", s, { t: T0, rx, cb, prints: [pr("p1", T0 + 40e3, 0.7501, 1000, "sell")], ordersToday: 0 });
  assertEquals([out.minute.our_bid, out.minute.our_ask, out.placed, out.fills.length, out.fills[0].inside], [0.7501, 0.7507, 2, 1, true]);
  const q = Number((100 / 0.7501).toFixed(9));                 // the whole order: 133.315557926 coins for £100
  assertAlmostEquals(out.fills[0].qty, q, 1e-9);
  assertAlmostEquals(s.rxGbp, 200, 1e-6);
  // The fill at T0 + 40 s; its hedge's read is the first at or after T0 + 70 s: T0 + 121 s, bid 0.7506.
  const trips = xhSettle("USDT-GBP", s, cb, T0 + 3 * M);
  assertEquals(trips.length, 1);
  const gross = q * 0.7506, fee = gross * 0.000045;
  assertAlmostEquals(trips[0].pnl_gbp, gross - fee - 100, 1e-6);   // +£0.0622: 6.67 bps less 0.45 bps on £100
  assertAlmostEquals(trips[0].pnl_gbp, 0.06216, 1e-4);
  assertEquals([trips[0].cb_price, trips[0].t_hedge, trips[0].side], [0.7506, iso(T0 + 121e3), "bid"]);
  assertAlmostEquals(s.cbGbp, 300 + gross - fee, 1e-6);
  assertEquals(s.owed.length, 0);
  // Not yet a read 30 s on: the hedge waits.
  const s2 = xhNewBook(0.75025, 0.75045);
  xhStep("USDT-GBP", s2, { t: T0, rx, cb, prints: [pr("p1", T0 + 40e3, 0.7501, 1000, "sell")], ordersToday: 0 });
  assertEquals([xhSettle("USDT-GBP", s2, cb, T0 + 100e3).length, s2.owed.length], [0, 1]);
});

Deno.test("two prints of one instant, each a whole hedge, settle as one trip: the record's key holds (10-30 09:57, both arms stood still)", () => {
  const s = xhNewBook(0.75025, 0.75045);
  const rx = [rxAt(T0 - 20e3, 0.75, 0.7505)];
  const cb = [cbAt(T0 + 1e3, 0.7504, 0.7505), cbAt(T0 + 121e3, 0.7506, 0.7507)];
  // One taker's sell split in two prints at T0 + 40 s: £50 and £50 of our £100 bid, each over £1, so two hedges owed.
  const half = 50 / 0.7501;
  const out = xhStep("USDT-GBP", s, { t: T0, rx, cb, prints: [pr("p1", T0 + 40e3, 0.7501, half, "sell"), pr("p2", T0 + 40e3, 0.7501, half, "sell")], ordersToday: 0 });
  assertEquals([out.fills.length, s.owed.length, s.owed[0].firstFill === s.owed[1].firstFill], [2, 2, true]);
  const trips = xhSettle("USDT-GBP", s, cb, T0 + 3 * M);
  assertEquals(trips.length, 1);
  const q = out.fills[0].qty + out.fills[1].qty, gross = q * 0.7506, fee = gross * 0.000045;
  assertAlmostEquals(trips[0].qty, q, 1e-8);
  assertAlmostEquals(trips[0].rx_price, 0.7501, 1e-9);
  assertAlmostEquals(trips[0].fee_gbp, fee, 1e-8);
  assertAlmostEquals(trips[0].pnl_gbp, gross - fee - q * 0.7501, 1e-6);
  assertEquals([trips[0].fills, trips[0].cb_price, s.owed.length], [2, 0.7506, 0]);
});

Deno.test("no rebalancing: the bids run Coinbase's coin down and stop; an ask fill brings them back", () => {
  const s = xhNewBook(0.75, 0.75);
  s.cbCoin = 150;                                            // £112.50 of coin left on Coinbase: room for one more bid
  assertEquals(xhBlock(s, "bid", 0.7501), null);
  s.cbCoin = 120;                                            // £90: not a whole order
  assertEquals(xhBlock(s, "bid", 0.7501), "cb-coin");
  s.cbCoin = 150; s.rxGbp = 99;
  assertEquals(xhBlock(s, "bid", 0.7501), "rx-gbp");
  s.rxGbp = 300; s.rxCoin = 100;                             // £75 of coin on Revolut X: no ask
  assertEquals(xhBlock(s, "ask", 0.7504), "rx-coin");
  s.rxCoin = 400; s.cbGbp = 50;
  assertEquals(xhBlock(s, "ask", 0.7504), "cb-gbp");
  // A hedge still owed counts: 140 coins owed to Coinbase from bids leave 10 of its 150.
  s.cbGbp = 300; s.owed = [{ side: "bid", qty: 140, rxGbp: 105, firstFill: T0, lastFill: T0, fills: 1 }];
  assertEquals(xhBlock(s, "bid", 0.7501), "cb-coin");
  // The walk: a book whose Coinbase coin covers one order. Minute 1 a seller fills the bid; minute 2 the bid is off; an ask
  // fill (a buyer through the ask) and its hedge bring Coinbase's coin back, and minute 4 the bid quotes again.
  const b = xhNewBook(0.75, 0.75);
  b.cbCoin = 140;
  const rx = [rxAt(T0 - 20e3, 0.75, 0.7505)];
  const cb = [0, 1, 2, 3, 4, 5].map((i) => cbAt(T0 + i * M + 1e3, 0.7504, 0.7505));
  const m1 = xhStep("USDT-GBP", b, { t: T0, rx, cb, prints: [pr("s1", T0 + 40e3, 0.7501, 500, "sell")], ordersToday: 0 });
  assertEquals([m1.fills.length, m1.minute.bid_block], [1, null]);
  xhSettle("USDT-GBP", b, cb, T0 + M);
  const m2 = xhStep("USDT-GBP", b, { t: T0 + M, rx: [rxAt(T0 + M - 20e3, 0.75, 0.7505)], cb, prints: [], ordersToday: 2 });
  assertEquals([m2.minute.bid_block, m2.minute.our_bid], ["cb-coin", null]);
  xhSettle("USDT-GBP", b, cb, T0 + 2 * M);
  const m3 = xhStep("USDT-GBP", b, { t: T0 + 2 * M, rx: [rxAt(T0 + 2 * M - 20e3, 0.75, 0.7505)], cb, prints: [pr("b1", T0 + 2 * M + 40e3, 0.7508, 500, "buy")], ordersToday: 2 });
  assertEquals([m3.fills.length, m3.fills[0]?.side, m3.fills[0]?.inside], [1, "ask", false]);
  xhSettle("USDT-GBP", b, cb, T0 + 5 * M);                   // the ask's hedge: the read at T0 + 4:01, the first after T0 + 3:10
  const m4 = xhStep("USDT-GBP", b, { t: T0 + 4 * M, rx: [rxAt(T0 + 4 * M - 20e3, 0.75, 0.7505)], cb, prints: [], ordersToday: 3 });
  assertEquals([m4.minute.bid_block, m4.minute.our_bid], [null, 0.7501]);
});

Deno.test("a stale book quotes nothing: Coinbase's touch over 60 s old, or Revolut X's book unseen for 75 s", () => {
  const s = xhNewBook(0.75, 0.75);
  const rx = [rxAt(T0 - 20e3, 0.75, 0.7505)];
  const old = xhStep("USDT-GBP", s, { t: T0, rx, cb: [cbAt(T0 - 31e3, 0.7504, 0.7505)], prints: [pr("p", T0 + 40e3, 0.75, 500, "sell")], ordersToday: 0 });
  assertEquals([old.minute.bid_block, old.minute.ask_block, old.minute.our_bid, old.fills.length], ["cb-stale", "cb-stale", null, 0]);
  const unseen = xhStep("USDT-GBP", s, { t: T0, rx: [rxAt(T0 - 50e3, 0.75, 0.7505)], cb: [cbAt(T0 + 1e3, 0.7504, 0.7505)], prints: [], ordersToday: 0 });
  assertEquals(unseen.minute.bid_block, "rx-stale");
  // 59 s old is fresh: the turn at T0 + 30 s, Coinbase read at T0 − 29 s.
  assertEquals(xhStep("USDT-GBP", s, { t: T0, rx, cb: [cbAt(T0 - 29e3, 0.7504, 0.7505)], prints: [], ordersToday: 0 }).minute.our_bid, 0.7501);
});

Deno.test("a price we would only join fills when a print goes through it; one inside fills at it", () => {
  const rx = [rxAt(T0 - 20e3, 0.75, 0.7501)];                 // a one-tick book: our bid joins 0.7500, our ask 0.7501
  const cb = [cbAt(T0 + 1e3, 0.7504, 0.7505)];
  const at = xhStep("USDT-GBP", xhNewBook(0.75, 0.75), { t: T0, rx, cb, prints: [pr("a", T0 + 40e3, 0.75, 500, "sell")], ordersToday: 0 });
  assertEquals(at.fills.length, 0);
  const through = xhStep("USDT-GBP", xhNewBook(0.75, 0.75), { t: T0, rx, cb, prints: [pr("t", T0 + 40e3, 0.7499, 500, "sell")], ordersToday: 0 });
  assertEquals([through.fills.length, through.fills[0].inside, through.fills[0].price], [1, false, 0.75]);
  // A print before the turn or a minute after it is not ours.
  const early = xhStep("USDT-GBP", xhNewBook(0.75, 0.75), { t: T0, rx, cb, prints: [pr("e", T0 + 29e3, 0.7499, 500, "sell"), pr("l", T0 + 90e3, 0.7499, 500, "sell")], ordersToday: 0 });
  assertEquals(early.fills.length, 0);
});

Deno.test("a £0.10 print fills us but its hedge waits with others on its side until they reach £1", () => {
  const s = xhNewBook(0.75, 0.75);
  const rx = [rxAt(T0 - 20e3, 0.75, 0.7505)], cb = [cbAt(T0 + 1e3, 0.7504, 0.7505)];
  const ps = Array.from({ length: 10 }, (_, i) => pr(`d${i}`, T0 + 31e3 + i * 1e3, 0.7501, 0.1334, "sell"));
  const out = xhStep("USDT-GBP", s, { t: T0, rx, cb, prints: ps.slice(0, 9), ordersToday: 0 });
  assertEquals([out.fills.length, s.owed.length], [9, 0]);
  assert(s.dust.bid && s.dust.bid.rxGbp < 1);
  xhStep("USDT-GBP", s, { t: T0 + M, rx: [rxAt(T0 + M - 20e3, 0.75, 0.7505)], cb: [cbAt(T0 + M + 1e3, 0.7504, 0.7505)], prints: [pr("d9", T0 + M + 31e3, 0.7501, 0.1334, "sell")], ordersToday: 2 });
  assertEquals([s.owed.length, s.owed[0].fills, s.dust.bid], [1, 10, null]);  // ten prints of £0.1001, £1.0006 of coin, one hedge
});

Deno.test("the day's order governor: past the cap nothing new is placed", () => {
  const s = xhNewBook(0.75, 0.75);
  const out = xhStep("USDT-GBP", s, { t: T0, rx: [rxAt(T0 - 20e3, 0.75, 0.7505)], cb: [cbAt(T0 + 1e3, 0.7504, 0.7505)], prints: [], ordersToday: XH_ORDER_CAP_DAY });
  assertEquals([out.placed, out.minute.bid_block, out.minute.ask_block], [0, "order-cap", "order-cap"]);
  // A resting order at the same price is not a new placement.
  const s2 = xhNewBook(0.75, 0.75), rx = [rxAt(T0 - 20e3, 0.75, 0.7505)];
  xhStep("USDT-GBP", s2, { t: T0, rx, cb: [cbAt(T0 + 1e3, 0.7504, 0.7505)], prints: [], ordersToday: 0 });
  assertEquals(xhStep("USDT-GBP", s2, { t: T0 + M, rx, cb: [cbAt(T0 + M + 1e3, 0.7504, 0.7505)], prints: [], ordersToday: 2 }).placed, 0);
});

function world(seedState: unknown) {
  const books = [];
  for (const b of XH_BOOKS) for (let i = -10; i <= 12; i++) books.push({ book: b, ts: iso(T0 + i * M - 20e3), seen_until: iso(T0 + i * M - 20e3), bids: [[0.75, 5000, 1]], asks: [[0.7505, 5000, 1]] });
  const touch = [];
  for (const b of XH_BOOKS) for (let i = -10; i <= 12; i++) touch.push({ product: b, ts: iso(T0 + i * M + 600), bid: 0.7504, ask: 0.7505, bid_size: 10000, ask_size: 10000 });
  const prints = [{ id: "s1", book: "USDT-GBP", ts: iso(T0 + 2 * M + 40e3), price: 0.7501, qty: 400, side: "sell" }];
  return memDb({
    agent_locks: [{ name: "xhedge", lease_until: iso(0), holder: null }],
    agent_book_levels: books, cb_touch: touch, agent_quote_prints: prints, agent_quote_inputs: [{ kind: "fx", t: iso(T0), value: 1.3 }],
    agent_xhedge_state: seedState ? XH_ARMS.map((a) => ({ arm: a.arm, state: structuredClone(seedState), last_minute: iso(T0 - M), updated_at: iso(0), last_error: null })) : [],
    agent_xhedge_minutes: [], agent_xhedge_fills: [], agent_xhedge_trips: [],
    agent_xhedge_days: [{ arm: "inside", book: "USDT-GBP", day: "2026-11-03", orders: 4, fills: 1, trips: 1, won: 1, realised_gbp: 0.05, bid_blocked: 0, ask_blocked: 0 }],
  }, { now: () => T0 + 10 * M });
}

Deno.test("the driver: both arms in one run, both books open at their mids, a fill and its hedge, three minutes behind the clock, idempotent", async () => {
  const st = { lastMinute: T0 - M, startedAt: T0, books: {}, orders: { day: null, n: 0 } };
  const { db, tables } = world(st);
  const r = await runXhedge({ db, now: T0 + 10 * M, holder: "h" });
  assertEquals([r.errors, r.from, r.to, r.fills, r.trips], [[], T0, T0 + 7 * M, 1, 1]);
  assertEquals(tables.agent_xhedge_minutes.length, 32);                     // 8 minutes × 2 books × 2 arms
  // The behind arm rests at 0.7496 / 0.7513: the seller at 0.7501 does not reach it.
  const behindRows = tables.agent_xhedge_minutes.filter((m) => m.arm === "behind");
  assertEquals([behindRows.length, behindRows.every((m) => m.our_bid === 0.7496 && m.our_ask === 0.7513)], [16, true]);
  assertEquals([tables.agent_xhedge_fills.length, tables.agent_xhedge_fills[0].arm, tables.agent_xhedge_trips.length], [1, "inside", 1]);
  const t = tables.agent_xhedge_trips[0];
  // Bought 133.315557926 at 0.7501 at T0 + 2:40; hedged at the read at T0 + 4:00.6 (the first at or after T0 + 3:10), bid 0.7504.
  assertEquals([t.book, t.side, t.rx_price, t.cb_price, t.t_hedge], ["USDT-GBP", "bid", 0.7501, 0.7504, iso(T0 + 4 * M + 600)]);
  assertAlmostEquals(Number(t.pnl_gbp), (100 / 0.7501) * 0.7504 * (1 - 0.000045) - 100, 1e-6);
  const stOf = (arm: string) => tables.agent_xhedge_state.find((r) => r.arm === arm)!.state as { lastMinute: number; orders: { n: number } };
  assertEquals([stOf("inside").lastMinute, stOf("behind").lastMinute], [T0 + 7 * M, T0 + 7 * M]);
  // Each arm counts its own placements: inside 4 to open its books, 1 to replace its filled bid; behind 4.
  assertEquals([stOf("inside").orders.n, stOf("behind").orders.n], [5, 4]);
  const again = await runXhedge({ db, now: T0 + 10 * M + 1e3, holder: "h2" });
  assertEquals([again.skipped, tables.agent_xhedge_trips.length, tables.agent_xhedge_minutes.length], ["nothing new to decide", 1, 32]);
});

Deno.test("the governor counts both books together across midnight: the day's last placement goes, the next waits for 00:00", async () => {
  // 2,397 placed on 11-03 when the run starts at 23:58. 23:58: USDT-GBP places 2 (2,399), USDC-GBP its bid (2,400), its ask is
  // refused, and again at 23:59; at 00:00 the count is the new day's and the ask goes. A driver that ran one book's minutes and
  // then the other's reset the count when it went back to 23:58 for the second book, and placed past the cap.
  const Tm = Date.parse("2026-11-04T00:00:00Z");
  const books = [], touch = [];
  for (const b of XH_BOOKS) for (let i = -10; i <= 12; i++) {
    books.push({ book: b, ts: iso(Tm + i * M - 20e3), seen_until: iso(Tm + i * M - 20e3), bids: [[0.75, 5000, 1]], asks: [[0.7505, 5000, 1]] });
    touch.push({ product: b, ts: iso(Tm + i * M + 600), bid: 0.7504, ask: 0.7505, bid_size: 10000, ask_size: 10000 });
  }
  const st = { lastMinute: Tm - 3 * M, startedAt: Tm - 3 * M, books: {}, orders: { day: "2026-11-03", n: XH_ORDER_CAP_DAY - 3 } };
  const { db, tables } = memDb({
    agent_locks: [{ name: "xhedge", lease_until: iso(0), holder: null }], agent_book_levels: books, cb_touch: touch, agent_quote_prints: [],
    agent_xhedge_state: [{ arm: "inside", state: st, last_minute: iso(Tm - 3 * M), updated_at: iso(0), last_error: null }],
    agent_xhedge_minutes: [], agent_xhedge_fills: [], agent_xhedge_trips: [],
  }, { now: () => Tm + 4 * M });
  const r = await runXhedge({ db, now: Tm + 4 * M, holder: "h" });
  assertEquals([r.errors, r.from, r.to], [[], Tm - 2 * M, Tm + M]);
  const usdc = (t: number) => tables.agent_xhedge_minutes.find((m) => m.arm === "inside" && m.book === "USDC-GBP" && m.minute === iso(t))!;
  assertEquals([usdc(Tm - 2 * M).bid_block, usdc(Tm - 2 * M).ask_block, usdc(Tm - M).ask_block, usdc(Tm).ask_block, usdc(Tm).our_ask], [null, "order-cap", "order-cap", null, 0.7507]);
  assertEquals((tables.agent_xhedge_state.find((r) => r.arm === "inside")!.state as { orders: unknown }).orders, { day: "2026-11-04", n: 1 });
  // The behind arm had no record: it waits for its own start, the next 00:00 after this run.
  assertEquals((tables.agent_xhedge_state.find((r) => r.arm === "behind")!.state as { startedAt: number }).startedAt, Date.parse("2026-11-05T00:00:00Z"));
});

Deno.test("a book that stood still for an hour is one snapshot an hour old, seen until now: it quotes; a recorder that stopped does not", async () => {
  const run = async (seenUntil: number) => {
    const books = XH_BOOKS.map((b) => ({ book: b, ts: iso(T0 - 60 * M), seen_until: iso(seenUntil), bids: [[0.75, 5000, 1]], asks: [[0.7505, 5000, 1]] }));
    const touch = [];
    for (const b of XH_BOOKS) for (let i = -10; i <= 12; i++) touch.push({ product: b, ts: iso(T0 + i * M + 600), bid: 0.7504, ask: 0.7505, bid_size: 1e4, ask_size: 1e4 });
    const { db, tables } = memDb({
      agent_locks: [{ name: "xhedge", lease_until: iso(0), holder: null }], agent_book_levels: books, cb_touch: touch, agent_quote_prints: [],
      agent_xhedge_state: [{ arm: "inside", state: { lastMinute: T0 - M, startedAt: T0, books: {}, orders: { day: null, n: 0 } }, last_minute: iso(T0 - M), updated_at: iso(0), last_error: null }],
      agent_xhedge_minutes: [], agent_xhedge_fills: [], agent_xhedge_trips: [],
    }, { now: () => T0 + 10 * M });
    await runXhedge({ db, now: T0 + 10 * M, holder: "h" });
    return tables.agent_xhedge_minutes;
  };
  const still = await run(T0 + 9 * M);
  assertEquals([still.length, still.every((m) => m.our_bid === 0.7501 && m.our_ask === 0.7507 && m.bid_block === null)], [16, true]);
  const dead = await run(T0 - 59 * M);
  assertEquals([dead.length, dead.every((m) => m.bid_block === "rx-stale" && m.ask_block === "rx-stale" && m.our_bid === null)], [16, true]);
});

Deno.test("an empty record waits for the next 00:00 UTC", async () => {
  const { db, tables } = world(null);
  const r = await runXhedge({ db, now: T0 + 10 * M, holder: "h" });
  assertEquals(r.skipped, "waiting for its start");
  assertEquals(tables.agent_xhedge_state.map((r) => r.arm), ["inside", "behind"]);
  for (const r of tables.agent_xhedge_state) {
    const st = r.state as { startedAt: number; lastMinute: number };
    assertEquals([st.startedAt, st.lastMinute, xhStart(T0 + 10 * M)], [Date.parse("2026-11-04T00:00:00Z"), Date.parse("2026-11-04T00:00:00Z") - M, Date.parse("2026-11-04T00:00:00Z")]);
  }
});

Deno.test("the page: an arm each, £2,400 funded, a book card each, INVENTORY a venue and a coin, a round trip, the sides' notes", async () => {
  const st = { lastMinute: T0 - M, startedAt: T0, books: {}, orders: { day: null, n: 0 } };
  const { db } = world(st);
  await runXhedge({ db, now: T0 + 10 * M, holder: "h" });
  const views = await readXhedge(db, T0 + 10 * M, Date.parse("2026-11-03T00:00:00Z"));
  assertEquals(views.map((x) => [x.twin.id, x.twin.arm, x.twin.name, x.detail.tripCount, x.detail.rungs[0].k]), [
    ["xhedge", "inside", XH_NAME, 1, 0], ["xhedgebehind", "behind", "Stablecoin quotes RX↔Coinbase hedge - 1", 0, 0.001],
  ]);
  const v = views[0];
  assertEquals([v.venue, v.ccy, v.capitalGbp, v.twin.id, v.twin.name, v.detail.tripCount, v.detail.books.length], ["revx", "GBP", 2400, "xhedge", XH_NAME, 1, 2]);
  assertEquals(v.detail.inventory.assets.map((a) => a.asset), ["GBP · Revolut X", "USDT · Revolut X", "USDC · Revolut X", "GBP · Coinbase", "USDT · Coinbase", "USDC · Coinbase"]);
  assertAlmostEquals(v.realisedGbp, (100 / 0.7501) * 0.7504 * (1 - 0.000045) - 100, 1e-6);
  assertEquals(v.detail.trips[0].k, 0);
  assertEquals(v.twin.notes.length, 2);
  assert(v.twin.notes[0].startsWith("USDT/GBP: bid on, ask on"));
  assertEquals(views[1].realisedGbp, 0);
  assertEquals(await readXhedge(memDb({}, { now: () => 0 }).db, 0, 0), []);
  assertEquals(xhView({ st: null, trips: [], days: [], last: [], lastPrints: {}, nowMs: 0, dayStartMs: 0, gbpusd: null }), null);
});
