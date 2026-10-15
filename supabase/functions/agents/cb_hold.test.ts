// "Stablecoin quotes with Euros - 2" (cb_hold.ts, 0118): the Coinbase paper test with the interbank rates held through a closure.
// Pins: (1) the hold is `fxBarAt` with a longer lookback and nothing else; (2) a closure worked out by hand: the base test goes
// dark and fills nothing, this arm keeps its rung and makes the same round trip as the base test's own hand-worked one, across
// two calls (the second reads the held bar from the anchor row, not from 60 hours of bars); (3) the hold ends: a bar older than
// 60 hours is no bar; (4) with no closure the two arms write the same rows; (5) an empty record starts at the next 00:00 UTC and
// reads no print before it; (6) the browser test's fixture is this driver and the page's read run again, byte for byte; (7) the release
// blackout (Deviation 2, 2026-10-15): this arm sits out the scheduled releases as the base test does, and on a world with a release the two arms
// write the same rows, so their comparison is unaffected.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CB_HOLD_ID, CB_HOLD_MS, CB_HOLD_ROW_NAME, CB_HOLD_TABLES, cbHoldBarAt, cbHoldNewState, cbHoldStart, runCbHold } from "./cb_hold.ts";
import { runCbHoldAction } from "./index.ts";
import { runCbQuotes } from "./cb_quotes.ts";
import { CB_PRODUCTS, type CbCursor, type CbProduct } from "./cb_rec.ts";
import { fxBarAt, QUOTE_FX_LOOKBACK_MS } from "./quotes.ts";
import { coinbaseHoldPageFixture, memDb, type Row } from "./testing.ts";
import { BLACKOUT_T0, blackoutPrints } from "./cb_blackout_world.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("cbHoldBarAt with ten minutes is fxBarAt, bar for bar; with the hold it uses the newest bar for 60 hours and no longer", () => {
  // A grid of bar sets with gaps of every size, read at every few minutes: the two functions never differ.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 40; n++) {
    const bars: Array<[number, number]> = [];
    let t = 1_000_000 * M;
    for (let i = 0; i < 60; i++) { t += M * (rnd() < 0.8 ? 1 : 1 + Math.floor(rnd() * 40)); bars.push([t, 1 + rnd()]); }
    for (let q = bars[0][0] - 5 * M; q <= bars.at(-1)![0] + 30 * M; q += 3 * M) assertEquals(cbHoldBarAt(q, bars, QUOTE_FX_LOOKBACK_MS), fxBarAt(q, bars));
  }
  // The hold: Friday's last bar (21:59) is the bar from 22:00 to 60 hours after its start, never one that starts after the turn.
  const fri = Date.UTC(2026, 9, 9, 21, 59);
  const bars: Array<[number, number]> = [[fri - M, 1.31], [fri, 1.32]];
  assertEquals(cbHoldBarAt(fri + M, bars), [fri, 1.32]);                       // the next minute: as the base test
  assertEquals(cbHoldBarAt(fri + 11 * M, bars), [fri, 1.32]);                  // past the base test's ten minutes: held
  assertEquals(fxBarAt(fri + 11 * M, bars), null);                             // (the base test is dark here)
  assertEquals(cbHoldBarAt(fri + 49 * H, bars), [fri, 1.32]);                  // Sunday evening
  assertEquals(cbHoldBarAt(fri + CB_HOLD_MS, bars), [fri, 1.32]);              // the last minute the bar's start is 60 hours back
  assertEquals(cbHoldBarAt(fri + CB_HOLD_MS + M, bars), null);                 // one minute more: dark
  assertEquals(cbHoldBarAt(fri, bars), [fri - M, 1.31]);                       // a bar that starts at the turn is not read yet
  // A new bar replaces the held one at once.
  assertEquals(cbHoldBarAt(fri + 49 * H, [...bars, [fri + 49 * H - M, 1.3205]]), [fri + 49 * H - M, 1.3205]);
});

Deno.test("an empty record starts at the first 00:00 UTC strictly after the call", () => {
  assertEquals(cbHoldStart(Date.UTC(2026, 9, 13, 10, 5)), Date.UTC(2026, 9, 14));
  assertEquals(cbHoldStart(Date.UTC(2026, 9, 13, 23, 59, 59)), Date.UTC(2026, 9, 14));
  assertEquals(cbHoldStart(Date.UTC(2026, 9, 14)), Date.UTC(2026, 9, 15));    // at 00:00 itself it is the next one
});

/** A world at minute `t0`: the coins worth $1.00, GBP/USD 1.25 and EUR/USD 1.1 until `ratesUntil`, the recorder covering to `coveredTo`. */
function world(t0: number, o: { ratesUntil: number; coveredTo: number; fairUntil?: number; prints: Array<{ book: CbProduct; id: number; at: number; price: string; size: string; side: "buy" | "sell" }>; holdStart?: number | null }) {
  const fx: Row[] = [], fair: Row[] = [], eur: Row[] = [];
  for (let t = t0 - 20 * M; t <= o.ratesUntil; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.25 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.1 }); }
  for (let h = t0 - 30 * H; h < (o.fairUntil ?? t0 + 2 * H); h += H) for (const k of ["fair:USDC-USD", "fair:USDT-USD"]) fair.push({ kind: k, t: iso(h), value: 1.0 });
  const zero = Object.fromEntries(CB_PRODUCTS.map((b) => [b, 0])) as Record<CbProduct, number>;
  const start = o.holdStart === undefined ? t0 : o.holdStart;
  const seed: Record<string, Row[]> = {
    agent_locks: [{ name: "cb-hold", lease_until: iso(0), holder: null }, { name: "cb-quotes", lease_until: iso(0), holder: null }],
    agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: eur,
    cb_hold_state: start == null ? [] : [{ id: 1, state: cbHoldNewState(start, zero), last_minute: iso(start - M), updated_at: iso(0), last_error: null }],
    cb_hold_events: [], cb_hold_trips: [], cb_hold_minutes: [],
    cb_quote_state: [], cb_quote_events: [], cb_quote_trips: [], cb_quote_minutes: [],
    cb_trades: o.prints.map((p) => ({ product: p.book, trade_id: p.id, ts: iso(p.at), price: p.price, size: p.size, side: p.side })),
  };
  const { db, tables } = memDb(seed, { now: () => t0 });
  const cur = (): CbCursor => ({ from: 1, fromTs: iso(t0 - M + 1000), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: o.coveredTo });
  const rec = { cursors: Object.fromEntries(CB_PRODUCTS.map((b) => [b, cur()])) };
  const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ chart: { result: [{ timestamp: [], indicators: { quote: [{ close: [] }] } }] } }), { status: 200 }))) as typeof fetch;
  return { db, tables, rec, fetchImpl };
}

Deno.test("a closure worked out by hand: the base test goes dark and fills nothing; this arm keeps its rung and makes the base test's own round trip", async () => {
  const t0 = Date.UTC(2026, 9, 16, 21, 50);            // a Friday, ten minutes before the rates stop
  // The rates' last bar starts at t0 + 9 min (21:59). USDC-GBP: fair £0.8000, its 0.1 % bid £0.7992 (quoteTicks 7992), its exit
  // at £0.8000. A seller prints £0.7990 through the bid at t0 + 62 min and a buyer £0.8001 through the exit at t0 + 66 min, both
  // in the closure and the first in the SECOND call's minutes (a call decides 60 minutes at most). £100 at £0.7992 is 125.125
  // USDC; sold at £0.8000 the trip makes 100 × 0.0008 / 0.7992 = £0.1001001.
  const prints = [
    { book: "USDC-GBP" as CbProduct, id: 7000001, at: t0 + 62 * M + 5000, price: "0.79900000", size: "2000.00", side: "sell" as const },
    { book: "USDC-GBP" as CbProduct, id: 7000002, at: t0 + 66 * M + 5000, price: "0.80010000", size: "10.00", side: "buy" as const },
  ];
  const w = world(t0, { ratesUntil: t0 + 9 * M, coveredTo: t0 + 70 * M + 1000, prints });
  // The reads of the rate series are counted: none may reach back over the hold (the anchor row is one row).
  const reads: string[] = [], anchorReads: string[] = [];
  const selectAll = w.db.selectAll, select = w.db.select;
  w.db.selectAll = (table, query) => { if (table === "agent_quote_inputs" || table === "cb_quote_inputs") reads.push(`${table}?${query}`); return selectAll(table, query); };
  w.db.select = (table, query) => { if (table === "agent_quote_inputs" && query.includes("limit=1")) anchorReads.push(`${table}?${query}`); return select(table, query); };
  const now = t0 + 72 * M;
  const a = await runCbHold({ db: w.db, now, holder: "h1", rec: w.rec });
  assertEquals(a.errors, []);
  assertEquals([a.from, a.to, a.minutes], [t0, t0 + 59 * M, 60]);
  const b = await runCbHold({ db: w.db, now: now + 1000, holder: "h2", rec: w.rec });
  assertEquals(b.errors, []);
  assertEquals([b.from, b.to, b.minutes, b.fills, b.exits], [t0 + 60 * M, t0 + 69 * M, 10, 1, 1]);
  const gbp = w.tables.cb_hold_trips.filter((t) => t.book === "USDC-GBP");
  assertEquals(w.tables.cb_hold_trips.length, 1);
  assertEquals([gbp[0].side, gbp[0].k, gbp[0].how, gbp[0].fill_trade_id, gbp[0].exit_trade_id], ["bid", 0.001, "maker", 7000001, 7000002]);
  assertAlmostEquals(Number(gbp[0].entry), 0.7992, 1e-12);
  assertAlmostEquals(Number(gbp[0].qty), 100 / 0.7992, 1e-9);
  assertAlmostEquals(Number(gbp[0].pnl_gbp), 100 * 0.0008 / 0.7992, 1e-9);
  assertAlmostEquals(Number(gbp[0].pnl_gbp), 0.1001001, 1e-7);
  // Every minute of the closure was decided on Friday's bar: its start is the last bar's, hours old, and nothing was dark.
  const m = w.tables.cb_hold_minutes.find((x) => x.book === "USDC-GBP" && x.minute === iso(t0 + 62 * M))!;
  assertEquals([m.x, m.x_t], [1, iso(t0 + 9 * M)]);
  assertEquals(w.tables.cb_hold_minutes.filter((x) => x.x == null).length, 0);
  assertEquals(w.tables.cb_hold_minutes.length, 4 * 70);
  // The state and the reads: each call reads one rate series from its first minute less ten, and one anchor row from before it.
  assertEquals(w.tables.cb_hold_state[0].state && (w.tables.cb_hold_state[0] as Row).last_minute, iso(t0 + 69 * M));
  const fxReads = reads.filter((q) => q.startsWith("agent_quote_inputs?kind=eq.fx&"));
  assertEquals(fxReads.length, 2, `${reads.length} reads: ${reads.slice(0, 3).join(" ; ")}`);
  assert(fxReads.every((q, i) => Date.parse(decodeURIComponent(/t=gte\.([^&]+)/.exec(q)![1])) === t0 + (i === 0 ? -10 : 50) * M), fxReads.join(" | "));
  const anchors = anchorReads.filter((q) => q.startsWith("agent_quote_inputs?kind=eq.fx&") && q.includes("order=t.desc"));
  assertEquals(anchors.length, 2, anchorReads.join(" | "));
  assert(anchors.every((q) => q.includes("limit=1") && q.includes("order=t.desc")), anchors.join(" | "));
  // The base test on the same world: dark from ten minutes after the last bar, its rungs withdrawn, no fill, no trip.
  const base = await runCbQuotes({ db: w.db, now, holder: "b1", fetchImpl: w.fetchImpl, rec: w.rec });
  const base2 = await runCbQuotes({ db: w.db, now: now + 1000, holder: "b2", fetchImpl: w.fetchImpl, rec: w.rec });
  assertEquals([base.errors, base2.errors, base.fills, base2.fills], [[], [], 0, 0]);
  assertEquals(w.tables.cb_quote_trips.length, 0);
  assertEquals(w.tables.cb_quote_minutes.filter((x) => x.book === "USDC-GBP" && x.minute === iso(t0 + 62 * M))[0].x, null);
  assert(w.tables.cb_quote_events.some((e) => e.kind === "withdraw"));
});

Deno.test("the hold ends: a bar 60 hours old is no bar, and one just inside it still is", async () => {
  const t0 = Date.UTC(2026, 9, 16, 21, 50);
  const last = t0 + 9 * M;                                   // the last bar's start
  const mk = async (at: number) => {
    // Decisions begin at `at`; the fair hours reach it; the record covers the next few minutes.
    const w = world(t0, { ratesUntil: last, coveredTo: at + 6 * M + 1000, fairUntil: at + 2 * H, prints: [], holdStart: at });
    const r = await runCbHold({ db: w.db, now: at + 8 * M, holder: "h", rec: w.rec });
    assertEquals(r.errors, []);
    return w.tables.cb_hold_minutes.filter((x) => x.book === "USDC-GBP");
  };
  const inside = await mk(last + CB_HOLD_MS - 5 * M);        // five minutes before the hold runs out: lit
  assert(inside.length > 0 && inside.every((x) => x.x === 1), "lit just inside the hold");
  const outside = await mk(last + CB_HOLD_MS + 5 * M);       // five minutes after: dark
  assert(outside.length > 0 && outside.every((x) => x.x == null && x.fair == null), "dark past the hold");
});

Deno.test("with no closure this arm and the base test write the same rows", async () => {
  const t0 = Date.UTC(2026, 9, 12, 10, 0);
  // The base test's own hand-worked world (cb_quotes.test.ts): two round trips, USDC-GBP and USDT-EUR (€100 a rung).
  const prints = [
    { book: "USDC-GBP" as CbProduct, id: 7000001, at: t0 + M + 5000, price: "0.79900000", size: "2000.00", side: "sell" as const },
    { book: "USDC-GBP" as CbProduct, id: 7000002, at: t0 + 3 * M + 5000, price: "0.80010000", size: "10.00", side: "buy" as const },
    { book: "USDT-EUR" as CbProduct, id: 7000001, at: t0 + M + 7000, price: "0.90810", size: "10000.00", side: "sell" as const },
    { book: "USDT-EUR" as CbProduct, id: 7000002, at: t0 + 3 * M + 7000, price: "0.90911", size: "10.00", side: "buy" as const },
  ];
  const w = world(t0, { ratesUntil: t0 + 10 * M, coveredTo: t0 + 5 * M + 1000, prints });
  const hold = await runCbHold({ db: w.db, now: t0 + 6 * M, holder: "h", rec: w.rec });
  const base = await runCbQuotes({ db: w.db, now: t0 + 6 * M, holder: "b", fetchImpl: w.fetchImpl, rec: w.rec });
  assertEquals([hold.errors, base.errors], [[], []]);
  assertEquals(hold.fills, 2);
  const same = (a: string, b: string) => assertEquals(JSON.parse(JSON.stringify(w.tables[a])), JSON.parse(JSON.stringify(w.tables[b])), `${a} is ${b}`);
  same("cb_hold_trips", "cb_quote_trips"); same("cb_hold_events", "cb_quote_events"); same("cb_hold_minutes", "cb_quote_minutes");
  assertEquals(w.tables.cb_hold_trips.length, 2);
  for (const k of ["books", "fed", "xGbp", "xEntry", "lastMinute"] as const) assertEquals((w.tables.cb_hold_state[0].state as Row)[k], (w.tables.cb_quote_state[0].state as Row)[k], k);
});

Deno.test("an empty record starts at the next 00:00 UTC, remembers the newest trade id, and reads no print from before its window", async () => {
  const t0 = Date.UTC(2026, 9, 13, 10, 0);
  const start = Date.UTC(2026, 9, 14);
  const prints = [
    { book: "USDC-GBP" as CbProduct, id: 100, at: t0 - H, price: "0.79900000", size: "2000.00", side: "sell" as const },          // before the call: never read
    { book: "USDC-GBP" as CbProduct, id: 101, at: t0 + 5 * M, price: "0.79900000", size: "2000.00", side: "sell" as const },     // between the call and the window: not in it
  ];
  const inWindow = { product: "USDC-GBP", trade_id: 102, ts: iso(start + M + 5000), price: "0.79900000", size: "2000.00", side: "sell" };   // in the window
  const w = world(start, { ratesUntil: start + 10 * M, coveredTo: t0 + 5 * M, fairUntil: start + 2 * H, prints, holdStart: null });
  // 10:00 on the 13th: the record begins; nothing is decided.
  const first = await runCbHold({ db: w.db, now: t0, holder: "h1", rec: w.rec });
  assertEquals([first.skipped, first.errors], ["nothing new to decide", []]);
  const st = w.tables.cb_hold_state[0].state as Row;
  assertEquals([st.startedAt, st.lastMinute], [start, start - M]);
  assertEquals((st.fed as Row)["USDC-GBP"], 101);                                    // the newest id when it began
  assertEquals(w.tables.cb_hold_minutes.length, 0);
  // After midnight, with the recorder covering the new day: it decides from 00:00, and the print at id 102 (it came later) is the first it reads.
  w.tables.cb_trades.push(inWindow);
  const reads: string[] = [];
  const selectAll = w.db.selectAll;
  w.db.selectAll = (table, query) => { if (table === "cb_trades") reads.push(query); return selectAll(table, query); };
  for (const c of Object.values(w.rec.cursors)) c.coveredTo = start + 6 * M + 1000;
  const later = await runCbHold({ db: w.db, now: start + 8 * M, holder: "h2", rec: w.rec });
  assertEquals(later.errors, []);
  assertEquals([later.from, later.prints], [start, 1]);
  const mine = reads.filter((q) => q.startsWith("product=eq.USDC-GBP"));
  assertEquals(mine.length, 1);
  assert(mine.every((q) => q.includes("trade_id=gt.101") && q.includes(`ts=gte.${encodeURIComponent(iso(start))}`)), mine.join(" | "));
  assertEquals(w.tables.cb_hold_minutes[0].minute, iso(start));
  assertEquals((w.tables.cb_hold_state[0].state as Row).fed, { ...(st.fed as Row), "USDC-GBP": 102 });
});

Deno.test("the call: it reads the recorder's state row, decides what it covers, and a missing state decides nothing", async () => {
  const t0 = Date.UTC(2026, 9, 12, 10, 0);
  const w = world(t0, { ratesUntil: t0 + 10 * M, coveredTo: t0 + 5 * M + 1000, prints: [] });
  w.tables.cb_rec_state = [{ id: 1, state: {} }];
  assertEquals((await runCbHoldAction({ db: w.db, now: t0 + 6 * M }) as { skipped?: string }).skipped, "the recorder has not covered every book yet");
  w.tables.cb_rec_state = [{ id: 1, state: w.rec }];
  const r = await runCbHoldAction({ db: w.db, now: t0 + 7 * M }) as { minutes: number; errors: string[] };
  assertEquals([r.errors, r.minutes], [[], 5]);
});

Deno.test("the browser test's weekend-variant fixture is the driver and the page's read run again on its world, byte for byte", async () => {
  const committed = (await import("../../../src/e2e/quotes_coinbase_hold_fixture.json", { with: { type: "json" } })).default;
  const built = JSON.parse(JSON.stringify(await coinbaseHoldPageFixture()));
  assertEquals(built, committed);
  // The base fixture's world with a closure in it: the same figures, under its own name and id.
  const base = (await import("../../../src/e2e/quotes_coinbase_fixture.json", { with: { type: "json" } })).default.quotesCoinbase;
  const hold = built.quotesCoinbaseHold;
  assertEquals([hold.twin.id, hold.twin.name], [CB_HOLD_ID, CB_HOLD_ROW_NAME]);
  assertEquals(CB_HOLD_ROW_NAME, "Stablecoin quotes with Euros - 2");
  for (const k of ["capitalGbp", "realisedGbp", "heldRungs", "openOrders", "valueGbp", "unrealisedGbp", "todayGbp"] as const) assertEquals(hold[k], base[k], k);
  assertEquals(hold.detail.tripCount, base.detail.tripCount);
  assertEquals(Object.values(CB_HOLD_TABLES).every((t) => t.startsWith("cb_hold_")), true);
  assertEquals(DAY, 86400e3);
});

Deno.test("the release blackout: this arm withholds the fair around a release exactly as the base test does, and the two arms write the same rows", async () => {
  const t0 = BLACKOUT_T0;
  const hm = (v: unknown) => String(v).slice(11, 16);
  const w = world(t0, { ratesUntil: t0 + 25 * M, coveredTo: t0 + 20 * M + 1000, prints: blackoutPrints(t0) });
  const hold = await runCbHold({ db: w.db, now: t0 + 25 * M, holder: "h", rec: w.rec });
  const base = await runCbQuotes({ db: w.db, now: t0 + 25 * M, holder: "b", fetchImpl: w.fetchImpl, rec: w.rec });
  assertEquals([hold.errors, base.errors], [[], []]);
  // The hand-worked result of cb_quotes.test.ts, in this arm's tables: three fills and two exits, none in the window.
  const ev = (kind: string) => w.tables.cb_hold_events.filter((e) => e.book === "USDC-GBP" && e.kind === kind).map((e) => [hm(e.minute), e.k]);
  assertEquals(ev("fill"), [["17:55", 0.001], ["17:58", 0.002], ["18:07", 0.001]]);
  assertEquals(ev("exit"), [["18:00", 0.001], ["18:07", 0.002]]);
  const rows = w.tables.cb_hold_minutes.filter((x) => x.book === "USDC-GBP");
  assertEquals(rows.filter((x) => x.fair == null).map((x) => hm(x.minute)).sort(), ["17:59", "18:00", "18:01", "18:02", "18:03", "18:04", "18:05"]);
  assert(rows.every((x) => x.x === 1));
  // Both arms: the same trips, events and minutes (no closure in the world, so the hold changes nothing; the blackout is in both).
  const same = (a: string, b: string) => assertEquals(JSON.parse(JSON.stringify(w.tables[a])), JSON.parse(JSON.stringify(w.tables[b])), `${a} is ${b}`);
  same("cb_hold_trips", "cb_quote_trips"); same("cb_hold_events", "cb_quote_events"); same("cb_hold_minutes", "cb_quote_minutes");
  assertEquals(w.tables.cb_hold_trips.length, 2);
});
