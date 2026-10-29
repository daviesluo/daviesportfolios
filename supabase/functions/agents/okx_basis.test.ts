// "Stablecoin quotes USDG/EUR - 1" (okx_basis.ts, 0171; docs/agents/reviews/2026-10-29-okx-usdg-basis-prereg.md). Pins, each worked by
// hand on a made-up world: (1) the trailing basis: one value a minute (its last print), the 24-hour window, five minutes or par, a
// closure's par held; (2) the engine's inputs: fair = par × (1 + ½ b), the rung the USDG/EUR row's euros; (3) with b = 0 it is the
// USDG/EUR row's engine minute for minute; (4) the driver on the database, a round trip on the basis fair, and nothing of the OKX
// twins' own tables touched; (5) an empty record starts at the next 00:00 UTC; (6) the page's twin and its place in the OKX rows.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  OKX_BASIS_ID, OKX_BASIS_MIN_MINUTES, OKX_BASIS_NAME, OKX_BASIS_TABLES, OKX_BASIS_WEIGHT, OKX_BASIS_WINDOW_MS, okxBasisAt, okxBasisBarBefore, okxBasisInputs,
  okxBasisNewState, okxRowsWithBasis, readOkxBasis, runOkxBasis,
} from "./okx_basis.ts";
import { newOkxBookState, OKX_RUNG_USD, type OkxMinuteInputs, type OkxTapePrint, stepOkxMinute } from "./okx_quotes.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse("2026-11-03T10:00:00Z");     // a Tuesday
const EU = 1.25, GU = 1.3;                          // par 0.8 euros a USDG
const pr = (ts: number, price: number, qty: number, side: "buy" | "sell", id: number): OkxTapePrint => ({ ts, ticks: Math.round(price / 1e-4), qty, side, id });

Deno.test("the rule's numbers: half the basis, a 24-hour window, five minutes at least", () => {
  assertEquals([OKX_BASIS_WEIGHT, OKX_BASIS_WINDOW_MS, OKX_BASIS_MIN_MINUTES, OKX_RUNG_USD], [0.5, DAY, 5, 100]);
  assertEquals([OKX_BASIS_ID, OKX_BASIS_NAME], ["okxusdgb", "Stablecoin quotes USDG/EUR - 1"]);
  assertEquals(OKX_BASIS_TABLES, { state: "okx_basis_state", events: "okx_basis_events", trips: "okx_basis_trips", minutes: "okx_basis_minutes", days: "okx_basis_days" });
});

Deno.test("the trailing basis: each minute's last print over par, the median of the minutes in [t − 24 h, t − 1 min], else 0", () => {
  const bars: Array<[number, number]> = [[T0 - 2 * DAY, EU]];
  // print = 0.8 × (1 + v): v = 10, 20, 30, 40, 50 bps in five minutes
  const p = (ts: number, price: number, id: number) => ({ ts, price, id });
  const prints = [
    p(T0 - DAY - 1, 0.81, 1),                       // a millisecond before the window: out
    p(T0 - DAY, 0.8008, 2),                         // the window's first minute: 10 bps
    p(T0 - 5 * H, 0.9, 3), p(T0 - 5 * H + 10e3, 0.8016, 4),   // two prints in a minute: the later one, 20 bps
    p(T0 - 4 * H, 0.8024, 6), p(T0 - 4 * H, 0.7, 5),          // the same instant: the higher trade id, 30 bps
    p(T0 - 3 * H, 0.8032, 7),                       // 40 bps
    p(T0 - M + 59e3, 0.8040, 8),                    // the minute before t: 50 bps
    p(T0 + 1, 0.9, 9),                              // minute t itself: out
  ];
  const r = okxBasisAt(T0, prints, bars);
  assertEquals(r.n, 5);
  assertAlmostEquals(r.b, 0.003, 1e-12);          // the median, 30 bps
  // Four minutes: par (b 0), and how many it had.
  assertEquals(okxBasisAt(T0, prints.filter((x) => x.id !== 2), bars), { b: 0, n: 4 });
  // An even count: the mean of the middle two.
  assertAlmostEquals(okxBasisAt(T0, [...prints, p(T0 - 2 * H, 0.8048, 10)], bars).b, 0.0035, 1e-12);
  // A closure's par is the newest bar before the minute, however old: EUR/USD 1.25 until Friday, nothing after.
  const fri = Date.parse("2026-11-06T20:59:00Z");
  assertEquals([okxBasisBarBefore(fri + 30 * H, [[fri, 1.25]]), okxBasisBarBefore(fri, [[fri, 1.25]]), okxBasisBarBefore(fri + M, [[fri, 1.25]])], [1.25, null, 1.25]);
});

Deno.test("the engine's inputs: fair = par × (1 + ½ b), the rung $100 in euros at the real EUR/USD, a dark minute holds the last b", () => {
  const b = 0.003, i = okxBasisInputs(EU, b, 0);
  assertAlmostEquals(1 / i.x!, 0.8 * 1.0015, 1e-12);                 // the fair the engine prices USDG-EUR on (1 / its eurusd)
  assertAlmostEquals(i.rungUsd / i.x!, 100 / EU, 1e-9);              // €80: the USDG/EUR row's rung, $100 at 1.25
  const dark = okxBasisInputs(null, 0.01, b);
  assertEquals(dark.x, null);
  assertAlmostEquals(dark.rungUsd, 100 / 1.0015, 1e-12);            // with the held x' (EUR/USD / 1.0015) the same €80
  assertEquals(okxBasisInputs(EU, 0, 0), { x: EU, rungUsd: 100 });  // b = 0: the USDG/EUR row's own inputs
});

Deno.test("with b = 0 it is the USDG/EUR row's engine, minute for minute: the same orders, fills, exits and trips", () => {
  const a = newOkxBookState("USDG-EUR"), c = newOkxBookState("USDG-EUR");
  const world: Array<OkxTapePrint[]> = [[], [], [pr(T0 + 2 * M + 5e3, 0.7992, 300, "sell", 1)], [], [pr(T0 + 4 * M + 5e3, 0.8, 300, "buy", 2)], [pr(T0 + 5 * M, 0.8008, 50, "buy", 3)], []];
  world.forEach((prints, i) => {
    const t = T0 + i * M;
    const base: OkxMinuteInputs = { eurusd: EU, gbpusd: GU, prints, touchStart: null, touchEnd: null, rungUsd: OKX_RUNG_USD };
    const inp = okxBasisInputs(EU, 0, 0);
    const twin: OkxMinuteInputs = { ...base, eurusd: inp.x, rungUsd: inp.rungUsd };
    assertEquals(stepOkxMinute(c, t, twin), stepOkxMinute(a, t, base));
  });
  assertEquals(c, a);
});

Deno.test("with b = 30 bps the rungs sit round 0.8012, not par 0.8", () => {
  const s = newOkxBookState("USDG-EUR"), p = newOkxBookState("USDG-EUR");
  const inp = okxBasisInputs(EU, 0.003, 0);
  const tw = stepOkxMinute(s, T0, { eurusd: inp.x, gbpusd: GU, prints: [], touchStart: null, touchEnd: null, rungUsd: inp.rungUsd });
  const pa = stepOkxMinute(p, T0, { eurusd: EU, gbpusd: GU, prints: [], touchStart: null, touchEnd: null, rungUsd: OKX_RUNG_USD });
  const at = (out: typeof tw, side: string, k: number) => out.events.find((e) => e.side === side && e.k === k && e.kind === "order")!.ticks;
  assertEquals([at(tw, "bid", 0.001), at(tw, "ask", 0.001)], [8003, 8021]);   // floor(0.8012 × 0.999), ceil(0.8012 × 1.001)
  assertEquals([at(pa, "bid", 0.001), at(pa, "ask", 0.001)], [7992, 8008]);   // the USDG/EUR row's, round 0.8
  assertAlmostEquals(tw.fair!, 0.8012, 1e-12);
  // The same euros a rung: 80 ÷ the price, in whole lots.
  const q = (out: typeof tw) => out.events.find((e) => e.side === "bid" && e.k === 0.001)!.detail.qty;
  assertEquals([q(tw), q(pa)], [99.9625, 100.1001]);
});

function world(seedState: unknown) {
  const eur: Row[] = [], fx: Row[] = [];
  for (let t = T0 - 26 * H; t <= T0 + 12 * M; t += M) eur.push({ kind: "fx:EURUSD", t: iso(t), value: EU });
  for (let t = T0 - 20 * M; t <= T0 + 12 * M; t += M) fx.push({ kind: "fx", t: iso(t), value: GU });
  const trades: Row[] = [];
  // Seven minutes of the previous day at 0.8024 (30 bps over par): the basis is 30 bps through the window
  for (let i = 1; i <= 7; i++) trades.push({ book: "USDG-EUR", trade_id: i, ts: iso(T0 - 20 * H + i * 10 * M), price: 0.8024, size: 10, side: "buy" });
  trades.push({ book: "USDG-EUR", trade_id: 8, ts: iso(T0 + 2 * M + 5e3), price: 0.8003, size: 200, side: "sell" });   // a seller at our 0.1 % bid
  trades.push({ book: "USDG-EUR", trade_id: 9, ts: iso(T0 + 4 * M + 5e3), price: 0.8012, size: 200, side: "buy" });    // a buyer at its exit
  const okxSeed = {
    okx_quote_state: [{ id: 1, state: { untouched: true }, last_minute: iso(T0), updated_at: iso(0), last_error: null }],
    okx_quote_events: [{ book: "USDG-EUR", minute: iso(T0), side: "bid", k: 0.001, kind: "order", ticks: 7992, detail: {} }],
    okx_quote_trips: [], okx_quote_minutes: [{ book: "USDG-EUR", minute: iso(T0), fair: 0.8 }],
  };
  const m = memDb({
    agent_locks: [{ name: "okx-basis", lease_until: iso(0), holder: null }, { name: "okx-quotes", lease_until: iso(0), holder: null }],
    agent_quote_inputs: fx, cb_quote_inputs: eur, okx_trades: trades, okx_books: [], ...okxSeed,
    okx_basis_state: seedState ? [{ id: 1, state: seedState, last_minute: iso(T0), updated_at: iso(0), last_error: null }] : [],
    okx_basis_events: [], okx_basis_trips: [], okx_basis_minutes: [], okx_basis_days: [],
  }, { now: () => T0 + 11 * M });
  return { ...m, okxSeed };
}
const rec = { cursors: { "USDG-EUR": { from: 1, hi: 9, top: 9, topAt: T0 + 10 * M, hole: null, coveredTo: T0 + 10 * M + 30e3 } } };

Deno.test("the driver: a round trip on the basis fair, its minutes and state its own, and the OKX twins' tables untouched", async () => {
  const { db, tables, okxSeed } = world(okxBasisNewState(T0 + M, 7));
  const r = await runOkxBasis({ db, now: T0 + 11 * M, holder: "h", rec: rec as never });
  assertEquals([r.errors, r.from, r.to, r.prints], [[], T0 + M, T0 + 9 * M, 2]);
  // Bought 99.9625 USDG at 0.8003 (the 0.1 % bid round 0.8012), sold at the fair 0.8012: 99.9625 × 0.0009 euros.
  assertEquals(tables.okx_basis_trips.map((t) => [t.t_entry, t.side, t.k, t.entry, t.exit, t.qty, t.how]), [[iso(T0 + 2 * M), "bid", 0.001, 0.8003, 0.8012, 99.9625, "maker"]]);
  assertAlmostEquals(Number(tables.okx_basis_trips[0].pnl_quote), 99.9625 * 0.0009, 1e-9);
  const m1 = tables.okx_basis_minutes.find((m) => m.minute === iso(T0 + M))!;
  assertEquals([m1.x, m1.par, m1.basis_n], [EU, 0.8, 7]);
  assertAlmostEquals(Number(m1.basis), 0.003, 1e-12);
  assertAlmostEquals(Number(m1.fair), 0.8012, 1e-12);
  assertEquals(tables.okx_basis_minutes.length, 9);
  const st = tables.okx_basis_state[0].state as { lastMinute: number; fed: Record<string, number>; lastB: number; usdFrom: number };
  assertEquals([st.lastMinute, st.fed["USDG-EUR"], st.usdFrom], [T0 + 9 * M, 9, T0 + M]);
  assertAlmostEquals(st.lastB, 0.003, 1e-12);
  // Nothing of the USDG/EUR and EURC/USDC twins' own record moved, and their lease was never taken.
  for (const [k, v] of Object.entries(okxSeed)) assertEquals(tables[k], v, k);
  assertEquals(tables.agent_locks.find((l) => l.name === "okx-quotes"), { name: "okx-quotes", lease_until: iso(0), holder: null });
  // A second run in the minute decides nothing more and writes nothing twice.
  const again = await runOkxBasis({ db, now: T0 + 11 * M + 1e3, holder: "h2", rec: rec as never });   // a second run in the minute, once the first let its lease go
  assertEquals([again.skipped, tables.okx_basis_trips.length, tables.okx_basis_minutes.length], ["nothing new to decide", 1, 9]);
});

Deno.test("an empty record starts at the next 00:00 UTC, flat, from the newest trade id; nothing before the recorder covers the book", async () => {
  const { db, tables } = world(null);
  const r = await runOkxBasis({ db, now: T0 + 11 * M, holder: "h", rec: rec as never });
  assertEquals(r.skipped, "nothing new to decide");
  const st = tables.okx_basis_state[0].state as { startedAt: number; lastMinute: number; fed: Record<string, number>; usdFrom: number; usdFactor: number };
  const midnight = Date.parse("2026-11-04T00:00:00Z");
  assertEquals([st.startedAt, st.lastMinute, st.fed, st.usdFrom, st.usdFactor], [midnight, midnight - M, { "USDG-EUR": 9 }, midnight, 1]);
  const none = await runOkxBasis({ db, now: T0 + 12 * M, holder: "h", rec: { cursors: {} } });
  assertEquals(none.skipped, "the recorder has not covered the book yet");
});

Deno.test("the page: the USDG/EUR row's view of this record under its own id, $600, right after the USDG/EUR row", async () => {
  const { db, tables } = world(okxBasisNewState(T0 + M, 7));
  await runOkxBasis({ db, now: T0 + 11 * M, holder: "h", rec: rec as never });
  const v = await readOkxBasis(db, T0 + 11 * M, Date.parse("2026-11-03T00:00:00Z"));
  assert(v);
  assertEquals([v.venue, v.ccy, v.twin.id, v.twin.name, v.capitalUsd, v.detail.tripCount], ["okx", "USD", "okxusdgb", "Stablecoin quotes USDG/EUR - 1", 600, 1]);
  assertAlmostEquals(v.realisedUsd, 99.9625 * 0.0009 * EU, 1e-9);   // euros at the latest EUR/USD, nothing scaled
  assertEquals(tables.okx_basis_trips.length, 1);
  const rows = [{ twin: { id: "okxusdg" } }, { twin: { id: "okxeurc" } }];
  assertEquals(okxRowsWithBasis(rows, { twin: { id: "okxusdgb" } }).map((q) => q.twin.id), ["okxusdg", "okxusdgb", "okxeurc"]);
  assertEquals(okxRowsWithBasis(rows, null), rows);
  assertEquals(okxRowsWithBasis([], { twin: { id: "okxusdgb" } }).map((q) => q.twin.id), ["okxusdgb"]);
  assertEquals(await readOkxBasis(memDb({}, { now: () => 0 }).db, 0, 0), null);   // no tables: no row
});
