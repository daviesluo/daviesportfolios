// The forward paper test of PR5's rule on Coinbase (cb_quotes.ts, 0112): PR5's own `stepMinute`, called unchanged, on a
// Coinbase book in its own currency (X = 1: £100 a rung on a GBP book, €100 on a EUR book, Deviation 1 of 2026-10-10),
// each round trip turned into pounds at the book's pounds per unit when it closes; USDT-EUR's 0.00001 step scaled into
// the rule's 0.0001 grid and back; the 24-hour stop moved to Coinbase's cost. Two round trips worked out by hand, one on
// a GBP book and one €100 rung on the EUR book with the finer step, run end to end through the driver on recorded prints.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CB_BOOK, CB_CAPITAL, CB_TAKER, cbCapitalGbp, cbMinuteInputs, cbPrint, cbStopExit, cbTripInPounds, cbTripRow, runCbQuotes,
} from "./cb_quotes.ts";
import { CB_PRODUCTS, type CbCursor, type CbProduct } from "./cb_rec.ts";
import { QUOTE_FEE, QUOTE_HALF_SPREAD, quoteTicks, type Trip } from "./quotes.ts";
import { memDb, type Row } from "./testing.ts";

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
function world(t0: number, prints: Array<{ book: CbProduct; id: number; at: number; price: string; size: string; side: "buy" | "sell" }>) {
  const fx: Row[] = [], fair: Row[] = [], eur: Row[] = [];
  for (let t = t0 - 20 * M; t <= t0 + 10 * M; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.25 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.1 }); }
  for (let h = t0 - 30 * H; h < t0; h += H) for (const k of ["fair:USDC-USD", "fair:USDT-USD"]) fair.push({ kind: k, t: iso(h), value: 1.0 });
  const cur = (b: CbProduct): CbCursor => ({ from: 1, fromTs: iso(t0 - M + 1000), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: t0 + 5 * M + 1000 });
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
