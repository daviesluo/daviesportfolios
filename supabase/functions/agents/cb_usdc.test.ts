// "Stablecoin quotes with Euros - 2" (cb_usdc.ts, 0142): the weekend variant's rule on Coinbase's two USDC books at 25 a rung.
// Pins: (1) the size helpers: a print goes in × 4, a trip comes out ÷ 4, the capital is £25 × 6 + €25 × 6; (2) on one world, run
// beside the weekend variant ("with Euros - 1", cb_hold.ts) on the same prints and rates, it decides the same round trips on the
// USDC books (same entry minute, prices and exit) at 25 where that arm has 100, the same return per pound, and nothing on a USDT
// book; (3) the page's read: two books, its own capital, what its rungs hold at its size; (4) an empty record starts at the next
// 00:00 UTC, as the weekend variant's does; (5) its call reads the recorder's state as the weekend variant's does; (6) dollars (its
// Deviation 1, 2026-10-29): from the switch a rung is $25, and the page shows $300 funded.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CB_HOLD_TABLES, cbHoldNewState, runCbHold } from "./cb_hold.ts";
import {
  CB_USDC_FACTOR, CB_USDC_ID, CB_USDC_PRODUCTS, CB_USDC_ROW_NAME, CB_USDC_RUNG, CB_USDC_RUNG_USD, CB_USDC_TABLES, cbUsdcCapitalGbp, cbUsdcEventDetail, cbUsdcNewState, cbUsdcPrint,
  cbUsdcTrip, cbUsdcView, runCbUsdc,
} from "./cb_usdc.ts";
import { readCoinbaseArm, readCoinbaseUsd } from "./cb_page.ts";
import type { CbQuoteState } from "./cb_quotes.ts";
import { runCbUsdcAction } from "./index.ts";
import { CB_PRODUCTS, type CbProduct } from "./cb_rec.ts";
import type { Trip } from "./quotes.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse("2026-09-17T23:00:00Z"), T0 = NOW - 30 * H;

Deno.test("its size: a print goes in × 4, a trip and an event's sizes come out ÷ 4, and its capital is £25 × 6 + €25 × 6", () => {
  assertEquals([CB_USDC_RUNG, CB_USDC_FACTOR, [...CB_USDC_PRODUCTS]], [25, 4, ["USDC-GBP", "USDC-EUR"]]);
  const p = cbUsdcPrint("USDC-GBP", { trade_id: 7, ts: iso(T0), price: "0.75670", size: "2000", side: "sell" });
  assertEquals([p.qty, p.ticks], [8000, 7567]);
  const t = { qty: 132, nq: 100, notionalUsd: 100, pnlUsd: 0.12, entry: 0.7568, exit: 0.7576 } as unknown as Trip;
  const u = cbUsdcTrip(t);
  assertEquals([u.qty, u.nq, u.notionalUsd, u.pnlUsd, u.entry, u.exit], [33, 25, 25, 0.03, 0.7568, 0.7576]);
  assertEquals(cbUsdcEventDetail({ usd: 100, minuteGbp: 6000, print: { qty: 8000, ticks: 7567 }, fair: 0.7575 }), { usd: 25, minuteGbp: 1500, print: { qty: 2000, ticks: 7567 }, fair: 0.7575 });
  assertEquals(cbUsdcCapitalGbp(0.875), 25 * 6 + 25 * 6 * 0.875);              // £281.25
  assertEquals(cbUsdcCapitalGbp(0), 150);
});

/** The page fixture's world: GBP/USD 1.32 and EUR/USD 1.155 for half an hour then dark (a closure, held), coins at $1.00. */
const PRINTS: Array<[CbProduct, number, number, string, string, "buy" | "sell"]> = [
  ["USDC-GBP", 7000001, 60.1, "0.75670", "2000", "sell"],    // through the 0.1 % bid (£0.7568): a whole rung on both arms
  ["USDC-GBP", 7000002, 63.1, "0.75770", "10", "buy"],       // through its exit at fair (£0.7576)
  ["USDC-GBP", 7000003, 1700.1, "0.75850", "2000", "buy"],   // through the 0.1 % ask (£0.7584)
  ["USDC-GBP", 7000004, 1703.1, "0.75740", "10", "sell"],    // through its exit at fair (£0.7575)
  ["USDC-EUR", 7000001, 1500.1, "0.86480", "250", "sell"],   // through the 0.1 % bid: €216 printed, 10 % of it under 25 on both
  ["USDC-EUR", 7000002, 1503.1, "0.86600", "10", "buy"],     // through its exit
  ["USDT-EUR", 7000001, 1750.1, "0.86480", "2000", "sell"],  // a USDT book: the weekend variant fills, this arm never sees it
];

async function bothArms() {
  const fx: Row[] = [], eur: Row[] = [], fair: Row[] = [];
  for (let t = T0 - 20 * M; t <= T0 + 30 * M; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.32 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.155 }); }
  for (let h = T0 - 30 * H; h < NOW; h += H) for (const k of ["fair:USDC-USD", "fair:USDT-USD"]) fair.push({ kind: k, t: iso(h), value: 1.0 });
  const zero = Object.fromEntries(CB_PRODUCTS.map((b) => [b, 0])) as Record<CbProduct, number>;
  const { db, tables } = memDb({
    agent_locks: [{ name: "cb-hold", lease_until: iso(0), holder: null }, { name: "cb-usdc", lease_until: iso(0), holder: null }],
    agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: eur,
    cb_hold_state: [{ id: 1, state: cbHoldNewState(T0, zero), last_minute: iso(T0 - M), updated_at: iso(0), last_error: null }],
    cb_hold_events: [], cb_hold_trips: [], cb_hold_minutes: [], cb_hold_days: [],
    cb_usdc_state: [{ id: 1, state: cbUsdcNewState(T0, { "USDC-GBP": 0, "USDC-EUR": 0 }), last_minute: iso(T0 - M), updated_at: iso(0), last_error: null }],
    cb_usdc_events: [], cb_usdc_trips: [], cb_usdc_minutes: [], cb_usdc_days: [],
    cb_trades: PRINTS.map(([book, id, min, price, size, side]) => ({ product: book, trade_id: id, ts: iso(T0 + min * M), price, size, side })),
  }, { now: () => NOW });
  const cur = { from: 1, fromTs: iso(T0 - M + 1000), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: NOW - 30e3 };
  const rec = { cursors: Object.fromEntries(CB_PRODUCTS.map((b) => [b, cur])) };
  for (let i = 0; i < 40; i++) {
    const a = await runCbHold({ db, now: NOW + i * 1000, holder: `a${i}`, rec });
    const b = await runCbUsdc({ db, now: NOW + i * 1000, holder: `b${i}`, rec });
    if (a.errors.length || b.errors.length) throw new Error([...a.errors, ...b.errors].join(" | "));
    if (a.skipped && b.skipped) break;
  }
  return { db, tables };
}

Deno.test("beside the weekend variant on one world: the same round trips on the USDC books at 25 a rung, the same return per pound, nothing on USDT", async () => {
  const { tables } = await bothArms();
  const key = (t: Row) => `${t.book}|${t.side}|${t.k}|${t.t_entry}`;
  const hold = new Map(tables.cb_hold_trips.filter((t) => String(t.book).startsWith("USDC")).map((t) => [key(t), t]));
  const mine = tables.cb_usdc_trips;
  assertEquals(mine.length, 3);
  assertEquals(new Set(mine.map(key)), new Set(hold.keys()));
  assert(tables.cb_hold_trips.some((t) => t.book === "USDT-EUR") || tables.cb_hold_events.some((e) => e.book === "USDT-EUR"));
  assertEquals([...tables.cb_usdc_trips, ...tables.cb_usdc_events, ...tables.cb_usdc_minutes].filter((r) => !String(r.book).startsWith("USDC")), []);
  for (const t of mine) {
    const h = hold.get(key(t))!;
    assertEquals([t.entry, t.exit, t.how, t.t_exit], [h.entry, h.exit, h.how, h.t_exit], key(t));
    // The same return per pound: P&L over notional is the same trip's.
    assertAlmostEquals(Number(t.pnl_gbp) / Number(t.notional_gbp), Number(h.pnl_gbp) / Number(h.notional_gbp), 1e-12, key(t));
    // Its notional is min(25, 10 % of the minute) of the book's currency where the weekend variant's is min(100, 10 %): so
    // min(25, that arm's), in pounds at the same pounds per unit.
    const xr = t.book === "USDC-EUR" ? 1.155 / 1.32 : 1;
    assertAlmostEquals(Number(t.notional_gbp) / xr, Math.min(CB_USDC_RUNG, Number(h.notional_gbp) / xr), 1e-9, key(t));
  }
  // Where 10 % of the minute is over £100 (2,000 coins printed), it is a quarter of the weekend variant's; where it is under 25
  // (USDC-EUR's 250 coins, €21.6), the two are the same.
  const gbp = mine.filter((t) => t.book === "USDC-GBP"), eurT = mine.filter((t) => t.book === "USDC-EUR");
  for (const t of gbp) assertAlmostEquals(Number(t.pnl_gbp) * 4, Number(hold.get(key(t))!.pnl_gbp), 1e-12);
  for (const t of eurT) assertAlmostEquals(Number(t.pnl_gbp), Number(hold.get(key(t))!.pnl_gbp), 1e-12);
});

Deno.test("the page's read: its two books, its own capital, its name and id, and what its rungs hold at its size", async () => {
  const { db, tables } = await bothArms();
  tables.cb_usdc_days = [];
  const v = await readCoinbaseArm(db, NOW, NOW - (NOW % (24 * H)), CB_USDC_TABLES, { id: CB_USDC_ID, name: CB_USDC_ROW_NAME });
  assert(v);
  const u = cbUsdcView(v);
  assertEquals([u.twin.id, u.twin.name], ["coinbaseusdc", "Stablecoin quotes with Euros - 2"]);
  assertEquals(u.detail.books.map((b: { book: string }) => b.book), ["USDC-GBP", "USDC-EUR"]);
  assert(u.detail.rungs.every((r: { book: string }) => r.book.startsWith("USDC")));
  assertAlmostEquals(u.capitalGbp, cbUsdcCapitalGbp(v.eurGbp ?? 0), 1e-12);
  assertAlmostEquals(u.capitalUsd / u.capitalGbp, v.capitalUsd / v.capitalGbp, 1e-12);
  // Realised is the trips table's, already at its size; what is held or quoting is the engine's ÷ 4.
  assertAlmostEquals(u.realisedGbp, tables.cb_usdc_trips.reduce((a, t) => a + Number(t.pnl_gbp), 0), 1e-12);
  assertAlmostEquals(u.valueGbp, v.valueGbp / 4, 1e-12);
});

Deno.test("an empty record starts at the first 00:00 UTC strictly after its first run, from the newest trade id each book had", async () => {
  const now = Date.UTC(2026, 9, 26, 10, 5);
  const { db, tables } = memDb({
    agent_locks: [{ name: "cb-usdc", lease_until: iso(0), holder: null }], agent_quote_inputs: [], cb_quote_inputs: [],
    cb_usdc_state: [], cb_usdc_events: [], cb_usdc_trips: [], cb_usdc_minutes: [],
    cb_trades: [{ product: "USDC-GBP", trade_id: 41, ts: iso(now - M), price: "0.75", size: "1", side: "buy" }, { product: "USDC-EUR", trade_id: 9, ts: iso(now - M), price: "0.86", size: "1", side: "buy" }],
  }, { now: () => now });
  const cur = { from: 1, fromTs: iso(now - H), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: now - 30e3 };
  const r = await runCbUsdc({ db, now, holder: "x", rec: { cursors: { "USDC-GBP": cur, "USDC-EUR": cur } } as never });
  assertEquals(r.skipped, "nothing new to decide");
  const st = tables.cb_usdc_state[0].state as { startedAt: number; lastMinute: number; fed: Record<string, number>; books: Record<string, unknown> };
  assertEquals([st.startedAt, st.lastMinute, st.fed, Object.keys(st.books)], [Date.UTC(2026, 9, 27), Date.UTC(2026, 9, 27) - M, { "USDC-GBP": 41, "USDC-EUR": 9 }, ["USDC-GBP", "USDC-EUR"]]);
});

Deno.test("its call is the weekend variant's: it reads the recorder's state row, and with no coverage decides nothing", async () => {
  const now = Date.UTC(2026, 9, 26, 10, 5);
  const { db, tables } = memDb({ agent_locks: [{ name: "cb-usdc", lease_until: iso(0), holder: null }], cb_rec_state: [], cb_usdc_state: [] }, { now: () => now });
  const r = await runCbUsdcAction({ db, now }) as { skipped?: string; errors?: string[] };
  assertEquals([r.skipped, r.errors], ["the recorder has not covered every book yet", []]);
  assertEquals(tables.cb_usdc_state, []);
  assertEquals(CB_HOLD_TABLES.trips, "cb_hold_trips");
});

Deno.test("Deviation 1: from the switch on 2026-10-29 a rung is $25 (£20 at GBP/USD 1.25), and the page shows $300 funded", async () => {
  assertEquals(CB_USDC_RUNG_USD, 25);
  const t0 = Date.UTC(2026, 9, 29, 10, 0), now = t0 + 6 * M;
  const fx: Row[] = [], eur: Row[] = [], fair: Row[] = [];
  for (let t = t0 - 20 * M; t <= t0 + 10 * M; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.25 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.1 }); }
  for (let h = t0 - 30 * H; h < t0; h += H) fair.push({ kind: "fair:USDC-USD", t: iso(h), value: 1.0 });
  const { db, tables } = memDb({
    agent_locks: [{ name: "cb-usdc", lease_until: iso(0), holder: null }],
    agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: eur,
    cb_usdc_state: [{ id: 1, state: cbUsdcNewState(t0, { "USDC-GBP": 0, "USDC-EUR": 0 }), last_minute: iso(t0 - M), updated_at: iso(0), last_error: null }],
    cb_usdc_events: [], cb_usdc_trips: [], cb_usdc_minutes: [], cb_usdc_days: [],
    // A seller through USDC-GBP's 0.1 % bid (£0.7992; 10 % of the minute is £159.80, over the rung), then a buyer through its exit at £0.8000.
    cb_trades: [
      { product: "USDC-GBP", trade_id: 1, ts: iso(t0 + M + 5000), price: "0.79900000", size: "2000.00", side: "sell" },
      { product: "USDC-GBP", trade_id: 2, ts: iso(t0 + 3 * M + 5000), price: "0.80010000", size: "10.00", side: "buy" },
    ],
  }, { now: () => now });
  const cur = { from: 1, fromTs: iso(t0 - M + 1000), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: t0 + 5 * M + 1000 };
  const r = await runCbUsdc({ db, now, holder: "h", rec: { cursors: Object.fromEntries(CB_USDC_PRODUCTS.map((b) => [b, cur])) } });
  assertEquals(r.errors, []);
  assertEquals((tables.cb_usdc_state[0].state as CbQuoteState).usdFrom, t0);
  assertEquals(tables.cb_usdc_trips.length, 1);
  const t = tables.cb_usdc_trips[0];
  assertAlmostEquals(Number(t.notional_gbp), 20, 1e-9);                   // $25 at $1.25 a pound
  assertAlmostEquals(Number(t.qty), 20 / 0.7992, 1e-9);
  assertAlmostEquals(Number(t.pnl_gbp), 20 * 0.0008 / 0.7992, 1e-9);
  // The page: whole dollars, $25 × 6 × 2 funded; the trip from after the switch is not scaled.
  const u = await readCoinbaseUsd(db, now, Date.UTC(2026, 9, 29), CB_USDC_TABLES, { id: CB_USDC_ID, name: CB_USDC_ROW_NAME }, { rungUsd: CB_USDC_RUNG_USD, books: 2, shape: cbUsdcView });
  assert(u);
  assertEquals([u.ccy, u.capitalUsd, u.capitalGbp, u.twin.id], ["USD", 300, 240, "coinbaseusdc"]);
  assertAlmostEquals(u.realisedUsd, 25 * 0.0008 / 0.7992, 1e-9);
  assertEquals(u.detail.books.map((b: { book: string }) => b.book), ["USDC-GBP", "USDC-EUR"]);
  assertAlmostEquals(u.valueUsd, 25 * u.openOrders, 1e-9);
});
