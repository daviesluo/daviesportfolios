// The forward paper test of PR5's rule on Coinbase (cb_quotes.ts, 0112): PR5's own `stepMinute`, called unchanged, on a
// Coinbase book in its own currency (X = 1: £100 a rung on a GBP book, €100 on a EUR book, Deviation 1 of 2026-10-10),
// each round trip turned into pounds at the book's pounds per unit when it closes; USDT-EUR's 0.00001 step scaled into
// the rule's 0.0001 grid and back; the 24-hour stop moved to Coinbase's cost. Two round trips worked out by hand, one on
// a GBP book and one €100 rung on the EUR book with the finer step, run end to end through the driver on recorded prints.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CB_BOOK, CB_CAPITAL, CB_RUNG_USD, CB_TAKER, CB_USD_NOT_BEFORE, cbCapitalGbp, cbInUsd, cbMinuteInputs, cbMinuteRow, cbPrint, cbStopExit, cbTripInPounds, cbTripRow,
  cbUsdFactors, cbUsdSwitch, runCbQuotes, type CbQuoteState,
  CB_DEPEG, CB_LIVE_NOT_BEFORE, CB_USDT_KIND, cbCoinFair, cbIsLive, cbLiveSwitch, fetchCbUsdtUsd,
} from "./cb_quotes.ts";
import { CB_PRODUCTS, type CbCursor, type CbProduct } from "./cb_rec.ts";
import { QUOTE_FEE, QUOTE_HALF_SPREAD, quoteTicks, type Trip } from "./quotes.ts";
import { memDb, type Row } from "./testing.ts";
import { BLACKOUT_T0, blackoutPrints } from "./cb_blackout_world.ts";

const M = 60e3, H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("cbMinuteInputs: X is 1, the book's own currency, fairU / X its fair, xGbp its pounds per unit; a dark rate darkens the minute", () => {
  // GBP/USD 1.25, EUR/USD 1.10, the coin worth $1.00.
  const g = cbMinuteInputs("USDC-GBP", 1.25, 1.1, 1.0);
  assertEquals([g.x, g.xGbp], [1, 1]);
  assertAlmostEquals(g.fairU! / g.x!, 0.8, 1e-12);                       // £0.80 a USDC
  const e = cbMinuteInputs("USDC-EUR", 1.25, 1.1, 1.0);
  assertEquals(e.x, 1);                                                  // the rule's money is euros: €100 a rung
  assertAlmostEquals(e.xGbp!, 0.88, 1e-12);                              // £0.88 a euro
  assertAlmostEquals(e.fairU! / e.x!, 1 / 1.1, 1e-12);                   // €0.9091 a USDC
  const t = cbMinuteInputs("USDT-EUR", 1.25, 1.1, 1.0);
  assertAlmostEquals(t.fairU! / t.x!, 10 / 1.1, 1e-12);                  // the same fair, ×10 into the 0.0001 grid
  assertEquals(cbMinuteInputs("USDC-EUR", 1.25, null, 1.0), { x: null, fairU: null, xGbp: null });
  assertEquals(cbMinuteInputs("USDC-EUR", null, 1.1, 1.0), { x: null, fairU: null, xGbp: null });
  assertEquals(cbMinuteInputs("USDC-GBP", null, 1.1, 1.0), { x: null, fairU: null, xGbp: null });
  assertEquals(cbMinuteInputs("USDC-GBP", 1.25, null, null), { x: 1, fairU: null, xGbp: 1 });
  // The capital: £1,200 on the GBP books and €1,200 on the EUR books, £2,256 at £0.88 a euro.
  assertEquals([CB_CAPITAL.GBP, CB_CAPITAL.EUR], [1200, 1200]);
  assertAlmostEquals(cbCapitalGbp(0.88), 2256, 1e-9);
});

Deno.test("cbTripInPounds turns a trip into pounds at the book's rate when it closed, whatever X it was decided at", () => {
  // A €100 rung (X = 1): 110.11… coins at €0.90818, €0.10130 made; closed at £0.88 a euro, entered at £0.87.
  const t = { side: "bid", how: "maker", entry: 0.90818, exit: 0.9091, qty: 100 / 0.90818, nq: 100, notionalUsd: 100, pnlUsd: 100 * 0.00092 / 0.90818, xEntry: 1 } as Trip;
  const p = cbTripInPounds(t, 0.88, 0.87);
  assertAlmostEquals(p.notionalUsd, 88, 1e-9);
  assertAlmostEquals(p.pnlUsd, 0.88 * 100 * 0.00092 / 0.90818, 1e-12);
  assertEquals([p.xEntry, p.qty, p.entry, p.exit], [0.87, t.qty, t.entry, t.exit]);
  // A rung held from before Deviation 1, decided at X = £0.86 a euro (its notional and P&L already pounds at 0.86): the
  // same euros, turned into pounds at the rate it closed at.
  const old = { ...t, qty: 100 / 0.86 / 0.90818, nq: 100 / 0.86, notionalUsd: 100, pnlUsd: 0.86 * (100 / 0.86) * 0.00092 / 0.90818 } as Trip;
  assertAlmostEquals(cbTripInPounds(old, 0.88, 0.86).pnlUsd, 0.88 * (100 / 0.86) * 0.00092 / 0.90818, 1e-12);
  // A GBP book's trip is unchanged.
  const g = { ...t, entry: 0.7992, exit: 0.8, qty: 100 / 0.7992, nq: 100, notionalUsd: 100, pnlUsd: 0.1 } as Trip;
  assertEquals(cbTripInPounds(g, 1, 1), { ...g, xEntry: 1 });
});

Deno.test("cbPrint puts USDT-EUR's five-place prices on the rule's grid ×10 and its sizes ÷10: the money is the same", () => {
  const p = cbPrint("USDT-EUR", { trade_id: 7, ts: "2026-10-10T00:00:01.5Z", price: "0.90811", size: "100", side: "buy" });
  assertEquals([p.ticks, p.qty, p.side, p.id], [90811, 10, "buy", "7"]);
  assertAlmostEquals(p.ticks * 1e-4 * p.qty, 0.90811 * 100, 1e-9);
  const q = cbPrint("USDC-GBP", { trade_id: 8, ts: 0, price: 0.7556, size: 3, side: "sell" });
  assertEquals([q.ticks, q.qty], [7556, 3]);
});

Deno.test("cbMinuteRow keeps each aggressor side's lowest and highest print when a side printed more than once (the replay's bar)", () => {
  // `Array.reduce(Math.min)` hands Math.min the index and the array too, so a side with two prints or more came out NaN, stored
  // as null: 56 % of the first days' print minutes had no extremes, and the replay (bar 1) would have seen only their last print.
  const t = Date.UTC(2026, 9, 12, 10, 0);
  const row = (book: "USDC-GBP" | "USDT-EUR", prints: Array<[number, number, "buy" | "sell"]>) => {
    const ps = prints.map(([price, size, side], i) => cbPrint(book, { trade_id: i + 1, ts: t + i * 1000, price, size, side }));
    return cbMinuteRow(book, t, [t - M, 1.25], null, 24, { x: 1, fairU: 0.8, prints: ps }, 1);
  };
  const g = row("USDC-GBP", [[0.7990, 10, "sell"], [0.7985, 20, "sell"], [0.7995, 5, "sell"], [0.8001, 7, "buy"], [0.8010, 3, "buy"], [0.8004, 2, "buy"]]);
  assertEquals([g.sell_lo, g.sell_hi, g.buy_lo, g.buy_hi, g.last, g.last_side, g.prints_n], [0.7985, 0.7995, 0.8001, 0.801, 0.8004, "buy", 6]);
  // One print on a side, and none, as before.
  const one = row("USDC-GBP", [[0.7990, 10, "sell"], [0.8001, 7, "buy"], [0.8003, 7, "buy"]]);
  assertEquals([one.sell_lo, one.sell_hi, one.buy_lo, one.buy_hi], [0.799, 0.799, 0.8001, 0.8003]);
  const none = row("USDC-GBP", [[0.7990, 10, "sell"]]);
  assertEquals([none.sell_lo, none.sell_hi, none.buy_lo, none.buy_hi], [0.799, 0.799, null, null]);
  // USDT-EUR's finer step comes back in euros.
  const e = row("USDT-EUR", [[0.90811, 100, "sell"], [0.90805, 100, "sell"], [0.90822, 100, "buy"], [0.90830, 100, "buy"]]);
  assertEquals([e.sell_lo, e.sell_hi, e.buy_lo, e.buy_hi], [0.90805, 0.90811, 0.90822, 0.9083]);
});

Deno.test("cbStopExit moves a stopped trip from PR5's stop cost to Coinbase's, from the same last print", () => {
  const c = 0.8, pr5 = QUOTE_FEE + QUOTE_HALF_SPREAD, cb = CB_TAKER + CB_BOOK["USDC-GBP"].halfSpread;
  const trip = { side: "bid", how: "taker", exit: c * (1 - pr5), entry: 0.7992, qty: 125, nq: 100, notionalUsd: 100, pnlUsd: 125 * (c * (1 - pr5) - 0.7992) } as Trip;
  const moved = cbStopExit(trip, "USDC-GBP");
  assertAlmostEquals(moved.exit, c * (1 - cb), 1e-12);
  assertAlmostEquals(moved.pnlUsd, 125 * (c * (1 - cb) - 0.7992), 1e-12);
  const ask = cbStopExit({ ...trip, side: "ask", exit: c * (1 + pr5) } as Trip, "USDC-GBP");
  assertAlmostEquals(ask.exit, c * (1 + cb), 1e-12);
  assertEquals(cbStopExit({ ...trip, how: "maker" } as Trip, "USDC-GBP"), { ...trip, how: "maker" });
});

/** The driver's world at minute `t0`: rates and fair constant, every book's record covering five minutes, the prints given. */
function world(t0: number, prints: Array<{ book: CbProduct; id: number; at: number; price: string; size: string; side: "buy" | "sell" }>, span = 5) {
  const fx: Row[] = [], fair: Row[] = [], eur: Row[] = [];
  for (let t = t0 - 20 * M; t <= t0 + (span + 5) * M; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.25 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.1 }); }
  for (let h = t0 - 30 * H; h < t0; h += H) for (const k of ["fair:USDC-USD", "fair:USDT-USD"]) fair.push({ kind: k, t: iso(h), value: 1.0 });
  const cur = (b: CbProduct): CbCursor => ({ from: 1, fromTs: iso(t0 - M + 1000), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: t0 + span * M + 1000 });
  const { db, tables } = memDb({
    agent_locks: [{ name: "cb-quotes", lease_until: iso(0), holder: null }],
    agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: eur, cb_quote_state: [], cb_quote_events: [], cb_quote_trips: [], cb_quote_minutes: [],
    cb_trades: prints.map((p) => ({ product: p.book, trade_id: p.id, ts: iso(p.at), price: p.price, size: p.size, side: p.side })),
  }, { now: () => t0 });
  const rec = { cursors: Object.fromEntries(CB_PRODUCTS.map((b) => [b, cur(b)])) };
  // Yahoo's EURUSD=X answers nothing new: the stored minutes stand.
  const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } }), { status: 200 }))) as typeof fetch;
  return { db, tables, rec, fetchImpl };
}

Deno.test("a round trip worked out by hand on USDC-GBP and on USDT-EUR, through the driver on recorded prints, in pounds", async () => {
  const t0 = Date.UTC(2026, 9, 12, 10, 0);
  // GBP/USD 1.25 and the coins $1.00: USDC-GBP's fair is £0.8000, its 0.1 % bid £0.7992 (quoteTicks: 7992), its exit at
  // fair £0.8000. USDT-EUR's (EUR/USD 1.10) fair is €0.909091, its 0.1 % bid €0.90818, its exit €0.90910 (ceil).
  assertEquals(quoteTicks(0.8, 0.001, "bid"), 7992);
  assertEquals(quoteTicks(10 / 1.1, 0.001, "bid"), 90818);
  const { db, tables, rec, fetchImpl } = world(t0, [
    // t0: the rule places its quotes (live at t0+1). t0+1: a seller prints £0.7990, through the 0.1 % bid only, 2,000
    // coins (£1,598: 10 % is £159.80, so the rung's full £100 fills). t0+2: the exit is placed at fair (live at t0+3).
    // t0+3: a buyer prints £0.8001, through the exit.
    { book: "USDC-GBP", id: 7000001, at: t0 + M + 5000, price: "0.79900000", size: "2000.00", side: "sell" },
    { book: "USDC-GBP", id: 7000002, at: t0 + 3 * M + 5000, price: "0.80010000", size: "10.00", side: "buy" },
    // The same on USDT-EUR: €0.90810 through €0.90818 (10,000 coins: €9,081, 10 % is €908), then €0.90911 through €0.90910.
    { book: "USDT-EUR", id: 7000001, at: t0 + M + 7000, price: "0.90810", size: "10000.00", side: "sell" },
    { book: "USDT-EUR", id: 7000002, at: t0 + 3 * M + 7000, price: "0.90911", size: "10.00", side: "buy" },
  ]);
  const r = await runCbQuotes({ db, now: t0 + 6 * M, holder: "h", fetchImpl, rec });
  assertEquals(r.errors, []);
  assertEquals([r.from, r.to, r.minutes], [t0, t0 + 4 * M, 5]);
  assertEquals([r.fills, r.exits, r.stops], [2, 2, 0]);
  const trips = tables.cb_quote_trips.sort((a, b) => String(a.book).localeCompare(String(b.book)));
  assertEquals(trips.length, 2);
  const [gbp, eur] = trips[0].book === "USDC-GBP" ? trips : [trips[1], trips[0]];
  // USDC-GBP: £100 at £0.7992 is 125.1251… USDC; sold at £0.8000: 100 × 0.0008 / 0.7992 = £0.100100…
  assertEquals([gbp.side, gbp.k, gbp.how, gbp.fill_trade_id, gbp.exit_trade_id], ["bid", 0.001, "maker", 7000001, 7000002]);
  assertAlmostEquals(Number(gbp.entry), 0.7992, 1e-12);
  assertAlmostEquals(Number(gbp.exit), 0.8, 1e-12);
  assertAlmostEquals(Number(gbp.qty), 100 / 0.7992, 1e-9);
  assertAlmostEquals(Number(gbp.notional_gbp), 100, 1e-9);
  assertAlmostEquals(Number(gbp.pnl_gbp), 100 * 0.0008 / 0.7992, 1e-9);
  // USDT-EUR, one €100 rung (Deviation 1): €100 at €0.90818 is 110.1103… USDT; sold at €0.90910 the trip makes €0.00092
  // a coin, 100 × 0.00092 / 0.90818 = €0.101301…, × £0.88 a euro = £0.089145…; its notional €100 is £88. The prices and
  // size come back in euros and coins.
  assertAlmostEquals(Number(eur.entry), 0.90818, 1e-12);
  assertAlmostEquals(Number(eur.exit), 0.9091, 1e-12);
  assertAlmostEquals(Number(eur.qty), 100 / 0.90818, 1e-9);
  assertAlmostEquals(Number(eur.qty) * Number(eur.entry), 100, 1e-9);
  assertAlmostEquals(Number(eur.x_entry), 0.88, 1e-12);
  assertAlmostEquals(Number(eur.notional_gbp), 88, 1e-9);
  assertAlmostEquals(Number(eur.pnl_gbp), 0.88 * 100 * 0.00092 / 0.90818, 1e-9);
  assertAlmostEquals(Number(eur.pnl_gbp), 0.0891453, 1e-7);
  // The fill was €100 of the rule's money; the minute record keeps the book's pounds per euro, 0.88, not the rule's X.
  const fill = tables.cb_quote_events.find((e) => e.book === "USDT-EUR" && e.kind === "fill")!;
  assertAlmostEquals(Number((fill.detail as { usd: number }).usd), 100, 1e-12);
  assertAlmostEquals(Number(tables.cb_quote_minutes.find((x) => x.book === "USDT-EUR" && x.minute === iso(t0 + M))!.x), 0.88, 1e-12);
  assertEquals(tables.cb_quote_minutes.find((x) => x.book === "USDC-GBP" && x.minute === iso(t0 + M))!.x, 1);
  // The minute record keeps the bar, and the state where the next call starts.
  const m = tables.cb_quote_minutes.find((x) => x.book === "USDT-EUR" && x.minute === iso(t0 + M))!;
  assertEquals([m.prints_n, m.sell_lo, m.last, m.last_side], [1, 0.9081, 0.9081, "sell"]);
  assertAlmostEquals(Number(m.fair), 1 / 1.1, 1e-12);
  assertAlmostEquals(Number(m.vol), 9081, 1e-6);
  const st = tables.cb_quote_state[0];
  assertEquals(st.last_minute, iso(t0 + 4 * M));
  // A second call with nothing newly covered decides nothing.
  const again = await runCbQuotes({ db, now: t0 + 6 * M + 10e3, holder: "h2", fetchImpl, rec });
  assertEquals(again.skipped, "nothing new to decide");
  assertEquals(tables.cb_quote_trips.length, 2);
  // Each round trip's row, as written, is the trip `stepMinute` closed, scaled back.
  assertEquals(Object.keys(cbTripRow("USDC-GBP", { book: "USDC-GBP", side: "bid", k: 0.001, tEntry: 0, fillTs: 0, fillId: "1", entry: 1, qty: 1, nq: 1, xEntry: 1, fairEntry: null, entryOid: 1, tExit: 0, exit: 1, how: "maker", exitPrintId: null, exitOid: null, notionalUsd: 1, pnlUsd: 0 })).sort(),
    Object.keys(gbp).sort());
});

Deno.test("the driver waits for the recorder: no decision until every book is covered, and none past its coverage", async () => {
  const t0 = Date.UTC(2026, 9, 12, 11, 0);
  const { db, rec, fetchImpl } = world(t0, []);
  const partial = { cursors: { "USDC-GBP": rec.cursors["USDC-GBP"] } };
  assertEquals((await runCbQuotes({ db, now: t0 + 6 * M, holder: "h", fetchImpl, rec: partial })).skipped, "the recorder has not covered every book yet");
  // Coverage to t0+2:30 decides t0 and t0+1 only, even though the clock is far ahead.
  const short = { cursors: Object.fromEntries(CB_PRODUCTS.map((b) => [b, { ...rec.cursors[b], coveredTo: t0 + 2.5 * M }])) };
  const r = await runCbQuotes({ db, now: t0 + 60 * M, holder: "h", fetchImpl, rec: short });
  assertEquals([r.from, r.to], [t0, t0 + M]);
});

Deno.test("the page's view of the test: a twin's shape in pounds, its rungs in each book's currency, its days and trips", async () => {
  const { cbQuotesView } = await import("./cb_view.ts");
  const t0 = Date.UTC(2026, 9, 12, 12, 0);
  const { db, tables, rec, fetchImpl } = world(t0, [
    { book: "USDC-GBP", id: 7000001, at: t0 + M + 5000, price: "0.79900000", size: "2000.00", side: "sell" },
    { book: "USDC-GBP", id: 7000002, at: t0 + 3 * M + 5000, price: "0.80010000", size: "10.00", side: "buy" },
    { book: "USDT-EUR", id: 7000001, at: t0 + M + 7000, price: "0.90810", size: "10000.00", side: "sell" },
  ]);
  await runCbQuotes({ db, now: t0 + 6 * M, holder: "h", fetchImpl, rec });
  const st = tables.cb_quote_state[0] as never;
  const lastMinute = iso(t0 + 4 * M);
  const v = cbQuotesView({
    st, trips: tables.cb_quote_trips as never, events: [], nowMs: t0 + 6 * M, dayStartMs: Date.UTC(2026, 9, 12), gbpusd: 1.25,
    days: [{ day: "2026-10-12", orders: 30, fills: 2, trips: 1, won: 1, realised_gbp: tables.cb_quote_trips[0].pnl_gbp as number }],
    minutes: tables.cb_quote_minutes.filter((m) => m.minute === lastMinute) as never,
  })!;
  assertEquals([v.venue, v.twin.name, v.running, v.heldRungs], ["coinbase", "Stablecoin quotes with Euros", true, 1]);
  // £1,200 + €1,200 at £0.88 a euro.
  assertAlmostEquals(v.capitalGbp, 2256, 1e-9);
  assertAlmostEquals(v.eurGbp!, 0.88, 1e-12);
  assertAlmostEquals(v.realisedGbp, 100 * 0.0008 / 0.7992, 1e-9);
  assertAlmostEquals(v.capitalUsd, 2256 * 1.25, 1e-9);
  // USDT-EUR's 0.1 % bid filled €100 and holds 110.1103… USDT bought at €0.90818, its cost £88, marked at the last print
  // (€0.90810) at £0.88 a euro.
  const h = v.detail.rungs.find((r) => r.book === "USDT-EUR" && r.held) as { held: { avgEntry: number; base: number; costGbp: number; unrealisedGbp: number } };
  assertAlmostEquals(h.held.avgEntry, 0.90818, 1e-12);
  assertAlmostEquals(h.held.base, 100 / 0.90818, 1e-9);
  assertAlmostEquals(h.held.costGbp, 88, 1e-9);
  assertAlmostEquals(h.held.unrealisedGbp, (100 / 0.90818) * (0.9081 - 0.90818) * 0.88, 1e-9);
  // Deployed: the held rung's £88, and every other quoting rung's 100 of its book's currency in pounds: the GBP books' 11
  // at £100 (USDC-GBP's filled bid re-quotes once its exit closed) and the EUR books' 11 at £88.
  const quoting = v.detail.rungs.filter((r) => (r as { order: { leg: string } | null }).order?.leg === "entry") as Array<{ book: string }>;
  const gbpQ = quoting.filter((r) => r.book.endsWith("-GBP")).length, eurQ = quoting.length - gbpQ;
  assertAlmostEquals(v.valueGbp, 88 + gbpQ * 100 + eurQ * 88, 1e-9);
  // A weekend: every minute dark (Yahoo's FX closed), so no minute and no state holds a EUR rate; the capital's euros are
  // at the last stored EUR/USD over GBP/USD, not left out.
  const darkSt = { ...(st as { state: Record<string, unknown> }), state: { ...(st as { state: Record<string, unknown> }).state, xGbp: undefined } } as never;
  const books = (st as { state: { books: Record<string, { lastX: number | null }> } }).state.books;
  for (const b of Object.values(books)) b.lastX = null;
  const dark = cbQuotesView({
    st: darkSt, trips: [], events: [], days: [], nowMs: t0 + 6 * M, dayStartMs: Date.UTC(2026, 9, 12), gbpusd: 1.25, eurusd: 1.1,
    minutes: tables.cb_quote_minutes.filter((m) => m.minute === lastMinute).map((m) => ({ ...m, x: null })) as never,
  })!;
  assertAlmostEquals(dark.capitalGbp, 2256, 1e-9);
  assertAlmostEquals(cbQuotesView({ st: darkSt, trips: [], events: [], days: [], nowMs: t0, dayStartMs: t0, gbpusd: 1.25, eurusd: null, minutes: [] })!.capitalGbp, 1200, 1e-9);
  // A quoting rung's price is in its book's currency: USDT-EUR's 0.2 % bid is €0.90727.
  const q = v.detail.rungs.find((r) => r.book === "USDT-EUR" && r.side === "bid" && r.k === 0.002) as { order: { price: number } };
  assertAlmostEquals(q.order.price, 0.90727, 1e-12);
  assertEquals(v.detail.books.map((b) => b.book), ["USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"]);
  assertEquals([v.detail.days[0].today, v.detail.trips.length, v.detail.inventory], [true, 1, null]);
});

Deno.test("the browser test's Coinbase fixture is the driver and the dashboard's view run again on its world, byte for byte", async () => {
  const { coinbasePageFixture } = await import("./testing.ts");
  const committed = (await import("../../../src/e2e/quotes_coinbase_fixture.json", { with: { type: "json" } })).default;
  assertEquals(JSON.parse(JSON.stringify(await coinbasePageFixture())), committed);
});

// Deviation 3 (2026-10-15): the blackout around the scheduled releases (cb_releases.ts), worked out by hand on USDC-GBP around the
// FOMC statement of 2026-10-28 18:00 UTC. The blackout minutes are 17:59 to 18:05 (T - 1 to T + 5). Fair 0.8000: the bids sit at
// 0.7992 / 0.7984 / 0.7976 (k = .1 / .2 / .3 %), the exits at 0.8000 (the prints are in cb_blackout_world.ts, shared with cb_hold.test.ts).
Deno.test("cbInBlackout is seven minutes a release: one before to five after, by the minute's start", async () => {
  const { cbInBlackout } = await import("./cb_releases.ts");
  const T = Date.UTC(2026, 9, 28, 18, 0), rel = [T, T + 24 * H];
  const at = (m: number) => cbInBlackout(T + m * M, rel);
  assertEquals([-2, -1, 0, 1, 5, 6].map(at), [false, true, true, true, true, false]);
  assertEquals([-2 * M - 1, -M, -M + 1, 0, 5 * M, 5 * M + 1].map((d) => cbInBlackout(T + d, rel)), [false, true, true, true, true, false]);
  assertEquals([T + 24 * H - M, T + 24 * H + 5 * M, T + 24 * H + 6 * M].map((t) => cbInBlackout(t, rel)), [true, true, false]);
  assertEquals(cbInBlackout(T, []), false);
  assertEquals(cbInBlackout(T - M, rel, 0, 5 * M), false);
});

Deno.test("the blackout: nothing new rests from a minute before a release to five minutes after, a held rung is not stranded, the record shows a null fair", async () => {
  const t0 = BLACKOUT_T0;
  const { db, tables, rec, fetchImpl } = world(t0, blackoutPrints(t0), 20);
  const r = await runCbQuotes({ db, now: t0 + 25 * M, holder: "h", fetchImpl, rec });
  assertEquals(r.errors, []);
  assertEquals([r.from, r.to, r.minutes], [t0, t0 + 19 * M, 20]);
  const hm = (v: unknown) => String(v).slice(11, 16);
  const gbp = (k: string) => tables.cb_quote_events.filter((e) => e.book === "USDC-GBP" && e.kind === k).map((e) => [hm(e.minute), e.k]);
  // Entry fills: the two before the window, and one after it. The .3 % rung (17:59:30) and the .1 % rung (18:03:30) found nothing resting.
  assertEquals(gbp("fill"), [["17:55", 0.001], ["17:58", 0.002], ["18:07", 0.001]]);
  // Exits: A's resting order fills inside the window (an exit already resting is left as it is); B was filled at 17:58, its exit
  // is due at the 17:59 turn, which is dark, so it is placed when the fair is back (18:06) and fills at 18:07: held, not stranded.
  assertEquals(gbp("exit"), [["18:00", 0.001], ["18:07", 0.002]]);
  assertEquals(tables.cb_quote_trips.filter((t) => t.book === "USDC-GBP").map((t) => [t.k, t.how, hm(t.t_exit)]).sort(), [[0.001, "maker", "18:00"], [0.002, "maker", "18:07"]]);
  // The record: the fair is null in the seven blackout minutes and nowhere else, X is kept.
  const rows = tables.cb_quote_minutes.filter((x) => x.book === "USDC-GBP").sort((a, b) => String(a.minute).localeCompare(String(b.minute)));
  assertEquals(rows.filter((x) => x.fair == null).map((x) => hm(x.minute)), ["17:59", "18:00", "18:01", "18:02", "18:03", "18:04", "18:05"]);
  assert(rows.every((x) => x.x === 1));
  assertAlmostEquals(Number(rows.find((x) => hm(x.minute) === "17:58")!.fair), 0.8, 1e-12);
  assertAlmostEquals(Number(rows.find((x) => hm(x.minute) === "18:06")!.fair), 0.8, 1e-12);
  // The same minutes are dark on every book.
  assert(tables.cb_quote_minutes.filter((x) => hm(x.minute) === "18:02").every((x) => x.fair == null));
  // The rungs were withdrawn at the first dark turn and placed again at the first lit one.
  assertEquals([...new Set(tables.cb_quote_events.filter((e) => e.book === "USDC-GBP" && e.kind === "withdraw").map((e) => hm(e.minute)))], ["17:59"]);
  const placed = tables.cb_quote_events.filter((e) => e.book === "USDC-GBP" && e.kind === "order" && hm(e.minute) === "18:06").map((e) => (e.detail as { leg: string }).leg);
  assert(placed.includes("exit"), "B's exit is placed at the first lit turn");
  assert(placed.includes("entry"), "entries are placed again at the first lit turn");
});

Deno.test("with no release near, the same prints fill what the unchanged rule fills", async () => {
  // The prints of the blackout test, moved to a Monday with no release: the .3 % rung fills at 17:59 and the .1 % one at 18:03.
  const t0 = Date.UTC(2026, 9, 26, 17, 54);
  const { db, tables, rec, fetchImpl } = world(t0, blackoutPrints(t0), 20);
  const r = await runCbQuotes({ db, now: t0 + 25 * M, holder: "h", fetchImpl, rec });
  assertEquals(r.errors, []);
  const fills = tables.cb_quote_events.filter((e) => e.book === "USDC-GBP" && e.kind === "fill").map((e) => [String(e.minute).slice(11, 16), e.k]);
  assertEquals(fills.slice(0, 3), [["17:55", 0.001], ["17:58", 0.002], ["17:59", 0.003]]);
  assert(fills.some((f) => f[0] === "18:03"));
  assertEquals(tables.cb_quote_minutes.filter((x) => x.fair == null).length, 0);
});

// Deviation 4 (2026-10-29; Davies: "C，coinbase的也是改用美元", then "Coinbase策略中funded数字怎么那么奇怪，都改成整数调整"): $100 a rung
// from the switch, the first minute decided at or after 2026-10-29 00:00 UTC with both rates known. GBP/USD 1.25 and EUR/USD 1.10 in
// these worlds, so $100 is £80 on a GBP book and €90.909… on a EUR book; the factors are 1 / 1.25 = 0.8 and 1 / 1.1.
Deno.test("Deviation 4: in dollars X is the currency's dollar rate and fairU the coin's, the same fair; the switch is written once", () => {
  assertEquals(CB_RUNG_USD, 100);
  assertEquals(CB_USD_NOT_BEFORE, Date.parse("2026-10-29T00:00:00Z"));
  const g = cbMinuteInputs("USDC-GBP", 1.25, 1.1, 1.0, true);
  assertEquals([g.x, g.xGbp], [1.25, 1]);
  assertAlmostEquals(g.fairU! / g.x!, 0.8, 1e-12);                       // the same £0.80 a USDC
  const e = cbMinuteInputs("USDC-EUR", 1.25, 1.1, 1.0, true);
  assertAlmostEquals(e.x!, 1.1, 1e-12);
  assertAlmostEquals(e.xGbp!, 0.88, 1e-12);                              // the minute record's pounds per euro, unchanged
  assertAlmostEquals(e.fairU! / e.x!, 1 / 1.1, 1e-12);
  const t = cbMinuteInputs("USDT-EUR", 1.25, 1.1, 1.0, true);
  assertAlmostEquals(t.fairU! / t.x!, 10 / 1.1, 1e-12);
  assertEquals(cbMinuteInputs("USDC-EUR", 1.25, null, 1.0, true), { x: null, fairU: null, xGbp: null });
  const f = cbUsdFactors(1.25, 1.1);
  assertAlmostEquals(f.GBP, 0.8, 1e-12);
  assertAlmostEquals(f.EUR, 1 / 1.1, 1e-12);
  // The switch: not before 2026-10-29, not without both rates, and once.
  const st = { lastMinute: 0, startedAt: 0, books: {}, fed: {} } as unknown as CbQuoteState;
  cbUsdSwitch(st, CB_USD_NOT_BEFORE - M, 1.25, 1.1);
  assertEquals(st.usdFrom, undefined);
  cbUsdSwitch(st, CB_USD_NOT_BEFORE, 1.25, null);
  assertEquals(st.usdFrom, undefined);
  cbUsdSwitch(st, CB_USD_NOT_BEFORE + M, 1.25, 1.1);
  assertEquals([st.usdFrom, st.usdGbpusd, st.usdEurusd], [CB_USD_NOT_BEFORE + M, 1.25, 1.1]);
  cbUsdSwitch(st, CB_USD_NOT_BEFORE + 9 * M, 1.3, 1.2);
  assertEquals([st.usdFrom, st.usdGbpusd], [CB_USD_NOT_BEFORE + M, 1.25]);
  assertEquals([cbInUsd(st, CB_USD_NOT_BEFORE), cbInUsd(st, CB_USD_NOT_BEFORE + M)], [false, true]);
});

Deno.test("Deviation 4 through the driver: a rung filled before the switch keeps its £100, one filled after it is $100; pounds and the record as before", async () => {
  // 23:58 on 10-28. The first call is covered to 23:59 and decides 23:58 and 23:59 by the old rule; the second decides from
  // 00:00 on 10-29, so it writes the switch at 00:00.
  const t0 = Date.UTC(2026, 9, 28, 23, 58);
  const { db, tables, rec, fetchImpl } = world(t0, [
    // 23:59: a seller through USDC-GBP's 0.1 % bid (£0.7992): its £100 rung fills before the switch. 00:01: a buyer through its exit at £0.8000.
    { book: "USDC-GBP", id: 7000001, at: t0 + M + 5000, price: "0.79900000", size: "2000.00", side: "sell" },
    { book: "USDC-GBP", id: 7000002, at: t0 + 3 * M + 5000, price: "0.80010000", size: "10.00", side: "buy" },
    // 00:01: a seller through USDT-EUR's 0.1 % bid (€0.90818), after the switch: $100, €90.909… (10 % of the minute is $998.9).
    { book: "USDT-EUR", id: 7000001, at: t0 + 3 * M + 7000, price: "0.90810", size: "10000.00", side: "sell" },
  ]);
  const short = { cursors: Object.fromEntries(CB_PRODUCTS.map((b) => [b, { ...rec.cursors[b], coveredTo: t0 + 2.5 * M }])) };
  const r1 = await runCbQuotes({ db, now: t0 + 6 * M, holder: "h", fetchImpl, rec: short });
  assertEquals([r1.errors, r1.from, r1.to], [[], t0, t0 + M]);
  assertEquals((tables.cb_quote_state[0].state as CbQuoteState).usdFrom, undefined);
  const r2 = await runCbQuotes({ db, now: t0 + 6 * M + 10e3, holder: "h2", fetchImpl, rec });
  assertEquals([r2.errors, r2.from, r2.to], [[], t0 + 2 * M, t0 + 4 * M]);
  const st = tables.cb_quote_state[0].state as CbQuoteState;
  assertEquals([st.usdFrom, st.usdGbpusd, st.usdEurusd], [t0 + 2 * M, 1.25, 1.1]);
  assertAlmostEquals(st.usdFactor!.GBP, 0.8, 1e-12);
  assertAlmostEquals(st.usdFactor!.EUR, 1 / 1.1, 1e-12);
  // The GBP trip: filled at 23:59 (X = 1, £100), closed at 00:01 (X = 1.25): in pounds exactly as the old rule's.
  const [gbp] = tables.cb_quote_trips.filter((t) => t.book === "USDC-GBP");
  assertEquals(tables.cb_quote_trips.length, 1);
  assertAlmostEquals(Number(gbp.qty), 100 / 0.7992, 1e-9);
  assertAlmostEquals(Number(gbp.notional_gbp), 100, 1e-9);
  assertAlmostEquals(Number(gbp.pnl_gbp), 100 * 0.0008 / 0.7992, 1e-9);
  // The EUR fill after the switch: $100 of the rule's money, €90.909…, held at the end; the minute record keeps £0.88 a euro and the fair.
  const fill = tables.cb_quote_events.find((e) => e.book === "USDT-EUR" && e.kind === "fill")!;
  assertAlmostEquals(Number((fill.detail as { usd: number }).usd), 100, 1e-12);
  const held = st.books["USDT-EUR"].rungs.find((x) => x.mode === "position")!;
  assertAlmostEquals(held.nq!, 100 / 1.1, 1e-9);
  assertAlmostEquals(held.qty! * 10, (100 / 1.1) / 0.90818, 1e-9);
  const m = tables.cb_quote_minutes.find((x) => x.book === "USDT-EUR" && x.minute === iso(t0 + 3 * M))!;
  assertAlmostEquals(Number(m.x), 0.88, 1e-12);
  assertAlmostEquals(Number(m.fair), 1 / 1.1, 1e-12);
  // No order was re-priced at the switch: the fair is the same number.
  assertEquals(tables.cb_quote_events.filter((e) => e.kind === "order" && (e.detail as { what: string }).what === "reprice").length, 0);

  // The page in whole dollars (cb_page.ts): $2,400 funded; the trip from before the switch × 0.8 (its £100 rung at $100 is £80);
  // the EUR rung held from after it at its own cost, $100; prices unscaled.
  const { cbQuotesView } = await import("./cb_view.ts");
  const { coinbaseInUsd } = await import("./cb_page.ts");
  const day = Date.UTC(2026, 9, 29);
  const v = cbQuotesView({
    st: tables.cb_quote_state[0] as never, trips: tables.cb_quote_trips as never, events: [], nowMs: t0 + 6 * M, dayStartMs: day, gbpusd: 1.25, eurusd: 1.1,
    days: [{ day: "2026-10-29", orders: 30, fills: 2, trips: 1, won: 1, realised_gbp: Number(gbp.pnl_gbp) }],
    minutes: tables.cb_quote_minutes.filter((x) => x.minute === iso(t0 + 4 * M)) as never,
  })!;
  const u = coinbaseInUsd(v, { state: st, trips: tables.cb_quote_trips as never, gbpusd: 1.25, eurusd: 1.1, dayStartMs: day, rungUsd: CB_RUNG_USD, books: 4 });
  assertEquals([u.ccy, u.capitalUsd, u.capitalGbp, u.rungUsd, u.usdFrom], ["USD", 2400, 1920, 100, iso(t0 + 2 * M)]);
  const want = 100 * 0.0008 / 0.7992;                                    // £0.1001 × $1.25 × 0.8: the $100 rung's dollars
  assertAlmostEquals(u.realisedUsd, want, 1e-9);
  assertAlmostEquals(u.todayUsd, want, 1e-9);
  assertAlmostEquals(u.realisedGbp!, want / 1.25, 1e-9);
  const trip = u.detail.trips[0];
  assertAlmostEquals(trip.pnlUsd!, want, 1e-9);
  assertAlmostEquals(trip.qty, 0.8 * 100 / 0.7992, 1e-9);
  assertAlmostEquals(trip.entry, 0.7992, 1e-12);
  assertAlmostEquals(u.detail.days[0].realisedUsd, want, 1e-9);
  assertAlmostEquals(u.detail.books.find((b: { book: string }) => b.book === "USDC-GBP").realisedUsd, want, 1e-9);
  const rung = u.detail.rungs.find((x: { held: unknown }) => x.held);
  assertAlmostEquals(rung.held.costUsd, 100, 1e-9);
  assertAlmostEquals(rung.held.base, (100 / 1.1) / 0.90818, 1e-9);
  assertAlmostEquals(u.costUsd, 100, 1e-9);
  assertAlmostEquals(u.valueUsd - u.costUsd, 100 * v.openOrders, 1e-9);
});

// Deviation 5 (2026-10-29; Davies: "目前coinbase的测试策略全部直接改用coinbase自己的币价而不是revolutx的"): from the switch the coin's
// dollar value is the CB/OKX fair-price study's `cb_live` (USDC 1, USDT Coinbase USDT-USD's latest one-minute close of a candle that
// started in [t − 10, t − 1]), under a de-peg guard against Revolut X's F3 (50 bps). Revolut X's rows are untouched: quotes.ts is
// not changed (its sha256 is held by docs/agents/backtests/cbwk/MANIFEST.json and the USDC and nudge pre-registrations).
Deno.test("Deviation 5: cb_live, USDC at 1 and USDT at Coinbase's last minute, under a 50 bps de-peg guard against Revolut X's F3", () => {
  assertEquals([CB_LIVE_NOT_BEFORE, CB_DEPEG, CB_USDT_KIND], [Date.UTC(2026, 9, 29, 8), 0.005, "cb:USDT-USD"]);
  const t = Date.UTC(2026, 9, 29, 10, 0);
  const st = { lastMinute: 0, startedAt: 0, books: {}, fed: {} } as unknown as CbQuoteState;
  const usdt: Array<[number, number]> = [[t - 12 * M, 0.9990], [t - 3 * M, 1.0004], [t, 1.0010]];
  // Before the switch: Revolut X's F3, whatever Coinbase says.
  assertEquals(cbCoinFair(st, t, "USDT", 0.9995, usdt), { fairU: 0.9995, live: false, depeg: false });
  cbLiveSwitch(st, CB_LIVE_NOT_BEFORE - M);
  assertEquals(st.liveFrom, undefined);
  cbLiveSwitch(st, t);
  cbLiveSwitch(st, t + 9 * M);
  assertEquals([st.liveFrom, cbIsLive(st, t - M), cbIsLive(st, t)], [t, false, true]);
  // From it: USDC 1; USDT the candle of t − 3 (the one of t is not complete before t).
  assertEquals(cbCoinFair(st, t, "USDC", 0.9998, usdt), { fairU: 1, live: true, depeg: false });
  assertEquals(cbCoinFair(st, t, "USDT", 0.9995, usdt), { fairU: 1.0004, live: true, depeg: false });
  // No candle that started in the last ten minutes: dark.
  assertEquals(cbCoinFair(st, t, "USDT", 0.9995, [[t - 11 * M, 1.0]]).fairU, null);
  // The guard: 49 bps from Revolut X's F3 is quoted, 51 bps is not, and no reference is not.
  assertEquals(cbCoinFair(st, t, "USDT", 1.0004 / 1.0049, usdt).depeg, false);
  assertEquals(cbCoinFair(st, t, "USDT", 1.0004 / 1.0051, usdt), { fairU: null, live: true, depeg: true });
  assertEquals(cbCoinFair(st, t, "USDC", 1 / 0.9940, usdt), { fairU: null, live: true, depeg: true });
  assertEquals(cbCoinFair(st, t, "USDC", null, usdt), { fairU: null, live: true, depeg: true });
});

Deno.test("fetchCbUsdtUsd reads Coinbase's public USDT-USD candles: [time, low, high, open, close, volume], completed minutes, oldest first", async () => {
  const now = Date.UTC(2026, 9, 29, 10, 0, 30), m = (k: number) => (Date.UTC(2026, 9, 29, 10, 0) + k * M) / 1000;
  let asked = "";
  const f = ((url: string) => { asked = String(url); return Promise.resolve(new Response(JSON.stringify([[m(0), 1, 1, 1, 1.0001, 5], [m(-1), 1, 1, 1, 1.0003, 7], [m(-2), 1, 1, 1, 0, 1]]), { status: 200 })); }) as unknown as typeof fetch;
  assertEquals(await fetchCbUsdtUsd(now, f), [[m(-1) * 1000, 1.0003]]);         // the forming minute and a zero close are left out
  assertEquals(asked, "https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=60");
  const bad = (() => Promise.resolve(new Response("{}", { status: 200 }))) as unknown as typeof fetch;
  let thrown = "";
  try { await fetchCbUsdtUsd(now, bad); } catch (e) { thrown = String(e); }
  assert(thrown.includes("not a list"));
});

Deno.test("Deviation 5 through the driver: from 08:00 the USDT books price on Coinbase's own USDT-USD, the USDC books at 1, a de-peg darkens", async () => {
  const t0 = Date.UTC(2026, 9, 29, 10, 0);
  const run = async (usdtUsd: number | null) => {
    const w = world(t0, []);
    // Revolut X's F3 for USDT at 0.9995 (the old value), Coinbase's USDT-USD as given; Coinbase's candle list is what the call stores.
    w.tables.agent_quote_inputs = w.tables.agent_quote_inputs.map((r) => (r.kind === "fair:USDT-USD" ? { ...r, value: 0.9995 } : r));
    const candles = usdtUsd == null ? [] : Array.from({ length: 30 }, (_, i) => [(t0 - 20 * M + i * M) / 1000, 1, 1, 1, usdtUsd, 10]);
    const fetchImpl = ((url: string) => Promise.resolve(new Response(String(url).includes("/candles") ? JSON.stringify(candles)
      : JSON.stringify({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } }), { status: 200 }))) as unknown as typeof fetch;
    const r = await runCbQuotes({ db: w.db, now: t0 + 6 * M, holder: "h", fetchImpl, rec: w.rec });
    assertEquals(r.errors, []);
    const fair = (b: string) => w.tables.cb_quote_minutes.find((x) => x.book === b && x.minute === iso(t0 + 2 * M))!.fair;
    return { w, fair, st: w.tables.cb_quote_state[0].state as CbQuoteState };
  };
  // 4 bps over Revolut X's F3 for USDT (1.0004 / 0.9995 − 1 = 9 bps): quoted on Coinbase's value.
  const a = await run(1.0004);
  assertEquals(a.st.liveFrom, t0);
  assertAlmostEquals(Number(a.fair("USDT-GBP")), 1.0004 / 1.25, 1e-12);
  assertAlmostEquals(Number(a.fair("USDT-EUR")), 1.0004 / 1.1, 1e-12);
  assertAlmostEquals(Number(a.fair("USDC-GBP")), 1 / 1.25, 1e-12);
  // The 26 completed by the call (10:06): 09:40 to 10:05; the forming minutes are not stored.
  assertEquals(a.w.tables.cb_quote_inputs.filter((x) => x.kind === CB_USDT_KIND).length, 26);
  // 65 bps over it: the USDT books are dark (no entry rests), the USDC books quote on.
  const b = await run(1.0060);
  assertEquals([b.fair("USDT-GBP"), b.fair("USDT-EUR")], [null, null]);
  assertAlmostEquals(Number(b.fair("USDC-EUR")), 1 / 1.1, 1e-12);
  const placed = (book: string) => b.w.tables.cb_quote_events.filter((e) => e.book === book && e.kind === "order").length;
  assertEquals([placed("USDT-GBP"), placed("USDT-EUR")], [0, 0]);
  assert(placed("USDC-GBP") > 0 && placed("USDC-EUR") > 0);
  // No Coinbase USDT-USD at all: the USDT books are dark too.
  const c = await run(null);
  assertEquals(c.fair("USDT-GBP"), null);
  assertAlmostEquals(Number(c.fair("USDC-GBP")), 1 / 1.25, 1e-12);
});

