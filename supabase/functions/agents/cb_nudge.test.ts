// "Stablecoin quotes with Euros - 3" (cb_nudge.ts, 0168): "- 2"'s driver on USDC-GBP alone at $50 a rung, its fair nudged by
// Revolut X's recorded USDC-GBP book, as the REVX-FAIR §8 replay (cb_mirror.ts) defines it. Pins: (1) the mid as the replay read
// a snapshot (its own best bid and ask, a touch no wider than 1 %), only a snapshot stamped before the minute, none more than 5
// minutes past its `seen_until`; (2) the nudge worked by hand: g = RX − fair, the EMA's first value is g (d 0), a later one moves
// by 1 − 0.5^(minutes ÷ 1,440), d of 50 bps of fair or more is not applied, and with the scope "closures" nothing is applied
// outside PR5-W's FX closures (the EMA still moves); (3) with no Revolut X book this arm writes exactly "- 2"'s USDC-GBP rows (the
// nudge is the one difference); (4) inside a closure the fair it quotes and records is the nudged one, the minute keeping the
// un-nudged fair, RX, d, the EMA and the flag; on a weekday, with the row's scope, it is not; (5) the page: $300 funded, one
// book; (6) its call reads the recorder's state row. Checked once against the replay's own output (65 of 65 trips, every minute's
// RX; the ledger has the run), not pinned here because the replay's data is on its own commit.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CB_NUDGE_FRESH_MS, CB_NUDGE_HL_MIN, CB_NUDGE_ID, CB_NUDGE_MAX_DEV, CB_NUDGE_PRODUCTS, CB_NUDGE_ROW_NAME, CB_NUDGE_RUNG_USD, CB_NUDGE_SCOPE, CB_NUDGE_TABLES, CB_NUDGE_W,
  nudgeStep, runCbNudge, rxMid, rxMidAt, type RxSnapshot,
} from "./cb_nudge.ts";
import { CB_USDC_FACTOR_50, CB_USDC_PRODUCTS, cbUsdcNewState, cbUsdcView, runCbUsdc } from "./cb_usdc.ts";
import { readCoinbaseUsd } from "./cb_page.ts";
import { runCbNudgeAction } from "./index.ts";
import type { CbProduct } from "./cb_rec.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();
const snap = (ts: number, bid: number, ask: number, qty = 100, until = ts): RxSnapshot =>
  ({ ts: iso(ts), seen_until: iso(until), bids: [[bid, qty, 1], [bid - 0.0005, 5000, 1]], asks: [[ask, qty, 1], [ask + 0.0005, 5000, 1]] });

Deno.test("the mid: the snapshot's own best bid and ask, a touch no wider than 1 %, stamped before the minute, none 5 minutes past its sighting", () => {
  assertEquals(rxMid(snap(0, 0.7508, 0.7512)), (0.7508 + 0.7512) / 2);
  // Whatever the size of the top level (LIVE's resting orders included, as a reader of the table sees them).
  assertEquals(rxMid(snap(0, 0.7508, 0.7512, 10)), (0.7508 + 0.7512) / 2);
  assertEquals(rxMid({ ts: iso(0), seen_until: iso(0), bids: [[0.70, 100, 1]], asks: [[0.7512, 100, 1]] }), null);   // 7 % wide: emptied
  assertEquals(rxMid({ ts: iso(0), seen_until: iso(0), bids: [], asks: [[0.7512, 100, 1]] }), null);
  assertEquals(rxMid({ ts: iso(0), seen_until: iso(0), bids: [[0.7512, 100, 1]], asks: [[0.7512, 100, 1]] }), null);  // crossed or locked
  const t = Date.UTC(2026, 9, 30, 10, 0);
  const snaps = [snap(t - 20 * M, 0.7500, 0.7504, 100, t - 9 * M), snap(t - 2 * M, 0.7508, 0.7512), snap(t, 0.7600, 0.7604)];
  // At t: the snapshot of t − 2 (one stamped at t itself is not known yet).
  assertEquals(rxMidAt(snaps, t), { mid: 0.751, at: t - 2 * M });
  assertEquals(rxMidAt(snaps, t + 1)?.mid, 0.7602);
  // Up to 5 minutes past its last sighting, and no further.
  assertEquals(rxMidAt(snaps, t - 4 * M)?.mid, 0.7502);
  assertEquals(rxMidAt([snaps[0]], t - 9 * M + CB_NUDGE_FRESH_MS)?.mid, 0.7502);
  assertEquals(rxMidAt([snaps[0]], t - 9 * M + CB_NUDGE_FRESH_MS + 1), null);
  assertEquals(rxMidAt(snaps, t - 30 * M), null);
});

Deno.test("the nudge worked by hand: g = RX − fair, weight ½, a 24-hour half-life, 50 bps of fair or more not applied, the scope a rule of the row", () => {
  assertEquals([CB_NUDGE_W, CB_NUDGE_HL_MIN, CB_NUDGE_MAX_DEV, CB_NUDGE_SCOPE], [0.5, 1440, 0.005, "closures"]);
  const sat = Date.UTC(2026, 9, 31, 10), mon = Date.UTC(2026, 10, 2, 10);
  for (const [t, scope] of [[sat, "closures"], [mon, "all"]] as const) {
    const n = { ema: null as number | null, last: null as number | null };
    // First: the EMA is g itself (RX 0.8004 over fair 0.8 is +£0.0004), so d is 0 and the fair is as it was.
    const a = nudgeStep(n, t, 0.8, 0.8004, scope);
    assertAlmostEquals(n.ema!, 0.0004, 1e-15);
    assertEquals([a.dev, a.nudged], [0, true]);
    // Sixty minutes later g is +£0.0008: the EMA moves 1 − 0.5^(60/1440) of the way, d is the rest, half of it is added.
    const b = nudgeStep(n, t + 60 * M, 0.8, 0.8008, scope);
    const w = 1 - 0.5 ** (60 / 1440), ema = 0.0004 + w * 0.0004, d = 0.0008 - ema;
    assertAlmostEquals(n.ema!, ema, 1e-15);
    assertAlmostEquals(b.dev!, d, 1e-15);
    assertAlmostEquals(b.fair!, 0.8 + 0.5 * d, 1e-15);
    // A jump of 100 bps is not applied, but the EMA still takes it.
    const c = nudgeStep(n, t + 61 * M, 0.8, 0.808, scope);
    assertEquals([c.fair, c.nudged], [0.8, false]);
    assert(c.dev! / 0.8 >= CB_NUDGE_MAX_DEV);
    // No RX, or no fair: nothing moves and the EMA is kept.
    const e0 = n.ema;
    assertEquals(nudgeStep(n, t + 62 * M, 0.8, null, scope), { fair: 0.8, dev: null, nudged: false });
    assertEquals(nudgeStep(n, t + 63 * M, null, 0.8, scope), { fair: null, dev: null, nudged: false });
    assertEquals(n.ema, e0);
  }
  // "closures": on a weekday nothing is applied, but the EMA moves as it would.
  const n = { ema: null as number | null, last: null as number | null };
  nudgeStep(n, mon, 0.8, 0.8004);
  const b = nudgeStep(n, mon + 60 * M, 0.8, 0.8008);
  assertEquals([b.fair, b.nudged], [0.8, false]);
  assertAlmostEquals(n.ema!, 0.0004 + (1 - 0.5 ** (60 / 1440)) * 0.0004, 1e-15);
  // Friday 21:00 to Sunday 21:00 UTC (PR5-W's closure), and a holiday.
  for (const [t, on] of [[Date.UTC(2026, 9, 30, 20, 59), false], [Date.UTC(2026, 9, 30, 21), true], [Date.UTC(2026, 10, 1, 20, 59), true], [Date.UTC(2026, 10, 1, 21), false], [Date.UTC(2026, 11, 25, 10), true]] as const) {
    const k = { ema: 0, last: t - M };
    assertEquals(nudgeStep(k, t, 0.8, 0.8004).nudged, on, new Date(t).toISOString());
  }
});

/** A world from `t0` for both arms: GBP/USD 1.25, EUR/USD 1.10, the coin $1.00 (USDC-GBP's fair £0.80), the prints and snapshots given. */
function world(t0: number, now: number, prints: Array<[CbProduct, number, number, string, string, "buy" | "sell"]>, book: RxSnapshot[]) {
  const fx: Row[] = [], eur: Row[] = [], fair: Row[] = [];
  for (let t = t0 - 20 * M; t <= t0 + 20 * M; t += M) { fx.push({ kind: "fx", t: iso(t), value: 1.25 }); eur.push({ kind: "fx:EURUSD", t: iso(t), value: 1.1 }); }
  for (let h = t0 - 30 * H; h < t0; h += H) fair.push({ kind: "fair:USDC-USD", t: iso(h), value: 1.0 });
  const st = (books: readonly string[]) => [{ id: 1, state: { ...cbUsdcNewState(t0, Object.fromEntries(books.map((b) => [b, 0]))), books: Object.fromEntries(Object.entries(cbUsdcNewState(t0, { "USDC-GBP": 0, "USDC-EUR": 0 }).books).filter(([b]) => books.includes(b))) }, last_minute: iso(t0 - M), updated_at: iso(0), last_error: null }];
  return memDb({
    agent_locks: [{ name: "cb-usdc", lease_until: iso(0), holder: null }, { name: "cb-nudge", lease_until: iso(0), holder: null }],
    agent_quote_inputs: [...fx, ...fair], cb_quote_inputs: eur,
    cb_usdc_state: st(CB_USDC_PRODUCTS), cb_usdc_events: [], cb_usdc_trips: [], cb_usdc_minutes: [], cb_usdc_days: [],
    cb_nudge_state: st(CB_NUDGE_PRODUCTS), cb_nudge_events: [], cb_nudge_trips: [], cb_nudge_minutes: [], cb_nudge_days: [],
    agent_book_levels: book.map((s) => ({ book: "USDC-GBP", ...s, reads: 1 })),
    cb_trades: prints.map(([b, id, at, price, size, side]) => ({ product: b, trade_id: id, ts: iso(at), price, size, side })),
  }, { now: () => now });
}
const cursors = (books: readonly CbProduct[], to: number) => ({ cursors: Object.fromEntries(books.map((b) => [b, { from: 1, fromTs: iso(0), hi: 1, top: 1, topAt: 0, hole: null, coveredTo: to }])) });
const PRINTS: Array<[CbProduct, number, number, string, string, "buy" | "sell"]> = [];
const T0 = Date.UTC(2026, 9, 30, 10, 0);
PRINTS.push(
  ["USDC-GBP", 1, T0 + M + 5000, "0.79900000", "2000.00", "sell"],       // through the 0.1 % bid (£0.7992)
  ["USDC-GBP", 2, T0 + 3 * M + 5000, "0.80010000", "10.00", "buy"],      // through its exit at fair (£0.8000)
  ["USDC-EUR", 1, T0 + M + 7000, "0.90810000", "2000.00", "sell"],       // "- 2"'s other book: "- 3" never sees it
);
const strip = (rows: Row[], drop: string[]) => rows.filter((r) => r.book === "USDC-GBP").map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
const NUDGE_COLS = ["fair_raw", "rx_mid", "rx_t", "dev", "ema", "nudged"];

Deno.test("with no Revolut X book it writes exactly \"- 2\"'s USDC-GBP rows: $50 a rung on both, the nudge the one difference", async () => {
  const now = T0 + 7 * M;
  const { db, tables } = world(T0, now, PRINTS, []);
  const rec = cursors(CB_USDC_PRODUCTS, T0 + 5 * M + 1000);
  const a = await runCbUsdc({ db, now, holder: "a", rec }), b = await runCbNudge({ db, now, holder: "b", rec });
  assertEquals([a.errors, b.errors, b.from, b.to], [[], [], T0, T0 + 4 * M]);
  assertEquals(strip(tables.cb_nudge_trips, []), strip(tables.cb_usdc_trips, []));
  assertEquals(strip(tables.cb_nudge_events, []), strip(tables.cb_usdc_events, []));
  assertEquals(strip(tables.cb_nudge_minutes, NUDGE_COLS), strip(tables.cb_usdc_minutes, []));
  assertEquals(tables.cb_nudge_trips.length, 1);
  assertAlmostEquals(Number(tables.cb_nudge_trips[0].notional_gbp), 40, 1e-9);           // $50 at $1.25 a pound
  assertEquals([...new Set(tables.cb_nudge_minutes.map((m) => m.nudged))], [false]);
  assertEquals([...new Set(tables.cb_nudge_minutes.map((m) => m.rx_mid))], [null]);
  assertEquals(new Set([...tables.cb_nudge_trips, ...tables.cb_nudge_events, ...tables.cb_nudge_minutes].map((r) => r.book)), new Set(["USDC-GBP"]));
});

Deno.test("inside a closure the fair is nudged: quoted and recorded as fair + ½ d, the minute keeping both fairs, RX, d and the EMA; on a weekday it is not", async () => {
  const sat = Date.UTC(2026, 9, 31, 10, 0);
  const prints: typeof PRINTS = [
    ["USDC-GBP", 1, sat + M + 5000, "0.79900000", "2000.00", "sell"],
    ["USDC-GBP", 2, sat + 3 * M + 5000, "0.80010000", "10.00", "buy"],
  ];
  // RX: +£0.0004 over the fair from before the start, +£0.0008 from 10:01:30: the EMA starts at +£0.0004, d is then ≈ +£0.0004.
  const book = (t0: number) => [snap(t0 - 2 * M, 0.8002, 0.8006, 100, t0 - 30e3), snap(t0 + M + 30e3, 0.8006, 0.8010, 100, t0 + 5 * M)];
  const { db, tables } = world(sat, sat + 7 * M, prints, book(sat));
  const r = await runCbNudge({ db, now: sat + 7 * M, holder: "b", rec: cursors(CB_NUDGE_PRODUCTS, sat + 5 * M + 1000) });
  assertEquals(r.errors, []);
  const rows = tables.cb_nudge_minutes.sort((a, b) => String(a.minute).localeCompare(String(b.minute)));
  const [m0, m1, m2] = rows;
  assertAlmostEquals(Number(m0.rx_mid), 0.8004, 1e-12);
  assertEquals([m0.rx_t, m0.nudged, Number(m0.dev), Number(m1.dev)], [iso(sat - 2 * M), true, 0, 0]);
  assertAlmostEquals(Number(m0.fair), 0.8, 1e-12);
  const w = 1 - 0.5 ** (1 / 1440), ema = 0.0004 + w * 0.0004, d = 0.0008 - ema;
  assertAlmostEquals(Number(m2.rx_mid), 0.8008, 1e-12);
  assertAlmostEquals(Number(m2.ema), ema, 1e-12);
  assertAlmostEquals(Number(m2.dev), d, 1e-12);
  assertAlmostEquals(Number(m2.fair), 0.8 + 0.5 * d, 1e-12);
  assertAlmostEquals(Number(m2.fair_raw), 0.8, 1e-12);
  assertEquals((tables.cb_nudge_state[0].state as { nudge: { last: number } }).nudge.last, sat + 4 * M);
  // The exit placed at 10:02 rests at the nudged fair (£0.80020 on the grid), so the 0.8001 print at 10:03 no longer fills it,
  // where "- 2"'s exit at £0.8000 filled.
  const exitOrder = tables.cb_nudge_events.find((e) => e.kind === "order" && (e.detail as { leg: string }).leg === "exit")!;
  assertEquals([exitOrder.minute, exitOrder.ticks], [iso(sat + 2 * M), 8002]);
  assertEquals(tables.cb_nudge_trips.length, 0);
  // The same world on a weekday: the EMA and d are recorded as they are, nothing is applied, the trip is "- 2"'s.
  const fri = Date.UTC(2026, 9, 30, 10, 0);
  const wk = world(fri, fri + 7 * M, PRINTS, book(fri));
  await runCbNudge({ db: wk.db, now: fri + 7 * M, holder: "c", rec: cursors(CB_NUDGE_PRODUCTS, fri + 5 * M + 1000) });
  const k2 = wk.tables.cb_nudge_minutes.find((m) => m.minute === iso(fri + 2 * M))!;
  assertAlmostEquals(Number(k2.dev), d, 1e-12);
  assertEquals(k2.nudged, false);
  assertAlmostEquals(Number(k2.fair), 0.8, 1e-12);
  assertEquals(wk.tables.cb_nudge_trips.length, 1);
});

Deno.test("the page: \"Stablecoin quotes with Euros - 3\", $300 funded on its one book, and its call reads the recorder's state row", async () => {
  assertEquals([CB_NUDGE_ROW_NAME, CB_NUDGE_ID, CB_NUDGE_RUNG_USD, CB_USDC_FACTOR_50], ["Stablecoin quotes with Euros - 3", "coinbasenudge", 50, 2]);
  const now = T0 + 7 * M;
  const { db } = world(T0, now, PRINTS, []);
  await runCbNudge({ db, now, holder: "b", rec: cursors(CB_NUDGE_PRODUCTS, T0 + 5 * M + 1000) });
  const u = await readCoinbaseUsd(db, now, Date.UTC(2026, 9, 30), CB_NUDGE_TABLES, { id: CB_NUDGE_ID, name: CB_NUDGE_ROW_NAME },
    { rungUsd: CB_NUDGE_RUNG_USD, books: 1, shape: (v) => cbUsdcView(v, { factor: CB_USDC_FACTOR_50, products: CB_NUDGE_PRODUCTS }) });
  assert(u);
  assertEquals([u.ccy, u.capitalUsd, u.twin.id, u.twin.name], ["USD", 300, "coinbasenudge", "Stablecoin quotes with Euros - 3"]);
  assertEquals(u.detail.books.map((b: { book: string }) => b.book), ["USDC-GBP"]);
  assertAlmostEquals(u.realisedUsd, 50 * 0.0008 / 0.7992, 1e-9);
  assert(u.detail.rungs.every((r: { book: string }) => r.book === "USDC-GBP"));
  // The call: no recorder state, nothing decided.
  const w = memDb({ agent_locks: [{ name: "cb-nudge", lease_until: iso(0), holder: null }], cb_rec_state: [], cb_nudge_state: [] }, { now: () => now });
  const r = await runCbNudgeAction({ db: w.db, now }) as { skipped?: string; errors?: string[] };
  assertEquals([r.skipped, r.errors], ["the recorder has not covered every book yet", []]);
});
