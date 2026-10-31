// mm_paper.ts: the paper arm's recorder and driver. The driver's minutes on the committed slice give rule.py's fills (the
// engine's own pin is mm_core.test.ts); the recorder reads each venue once, keeps a print once, and its cursors move only on
// what it stored; a call decides two minutes behind the clock, an arm quotes only from its start, and a second call in the
// same minute changes nothing.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fx from "../../../docs/agents/backtests/cryptobooks/results/parity_XRP-GBP.json" with { type: "json" };
import { type MmPrint, mmNew } from "./mm_core.ts";
import {
  type ArmState, bnRows, fxReadsOf, decideArm, type Inputs, MM_ARMS, MM_PLANNED_START, MM_TABLES, mmParamsOf, mmStartFor, runMm, rxBookLevels, rxPrintRows,
} from "./mm_paper.ts";
import { memDb } from "./testing.ts";

const M = 60e3;
const iso = (ms: number) => new Date(ms).toISOString();

type Case = { fills: Array<[number, number, number, number, string]> };
const fixture = fx as unknown as { t0: number; n: number; bn: number[]; rates: Array<[number, number]>; prints: Array<[number, number, number, number]>;
  quote_from: number; to: number; cases: Record<string, Case> };

function fixtureInputs(): Inputs {
  const bn = new Map<number, Array<number | null>>();
  const usdt: Inputs["usdt"] = [], gbp: Inputs["gbp"] = [];
  for (let i = 0; i < fixture.n; i += 60) {
    const m = (fixture.t0 + i) * 1000;
    bn.set(m, fixture.bn.slice(i, i + 60).concat(Array(Math.max(0, i + 60 - fixture.n)).fill(null)));
    usdt.push({ at: m, v: fixture.rates[i / 60][0] });
    gbp.push({ at: m, mid: fixture.rates[i / 60][1] });
  }
  const prints = new Map<number, MmPrint[]>();
  for (const [ms, price, qty, side] of fixture.prints) {
    const s = Math.floor(ms / 1000);
    const a = prints.get(s) ?? [];
    a.push({ ms, price, qty, side: side > 0 ? 1 : -1 });
    prints.set(s, a);
  }
  return { bn, usdt, gbp, prints };
}

Deno.test("decideArm — the driver's minutes on the committed slice are rule.py's fills, its trips first in first out, its books adding up", () => {
  const arm = MM_ARMS[0];
  const st: ArmState = { core: mmNew(mmParamsOf(arm)), lots: [], lastMinute: fixture.t0 * 1000 - M, startAt: fixture.quote_from * 1000, lastFair: null };
  const inp = fixtureInputs();
  const lastMinute = Math.floor((fixture.to - 1) / 60) * 60 * 1000;
  const out = decideArm(arm, st, inp, fixture.t0 * 1000, lastMinute);
  const want = fixture.cases.card.fills;
  const got = out.fills.filter((f) => Date.parse(f.ts) / 1000 < fixture.to);
  assertEquals(got.length, want.length);
  want.forEach(([sec, side, qty, price, kind], i) => {
    const f = got[i];
    assertEquals([Date.parse(f.ts) / 1000, f.side, f.kind], [sec, side > 0 ? "bid" : "ask", kind]);
    assertAlmostEquals(f.qty, qty, 1e-9 * Math.max(1, qty));
    assertAlmostEquals(f.price, price, 1e-9 * price);
  });
  // Every sale is a trip; their P&L is the pounds made on the coin sold, and the pounds plus the coin's cost is the capital plus it.
  const realised = out.trips.reduce((a, t) => a + t.pnl_gbp, 0);
  const lotCost = st.lots.reduce((a, l) => a + l.qty * l.price, 0);
  assertAlmostEquals(st.core.cash + lotCost, arm.capGbp + realised, 1e-6);
  assertEquals(out.trips.length, out.fills.filter((f) => f.side === "ask").length);
  // A minute's row: the books at its end, equity marked at the fair it knew last.
  const last = out.minutes.at(-1)!;
  assertAlmostEquals(last.equity, st.core.cash + st.core.coin * (st.lastFair ?? 0), 1e-9);
  assertEquals(out.minutes.reduce((a, m) => a + m.fills, 0), out.fills.length);
  assertEquals(out.minutes.reduce((a, m) => a + m.placed, 0), st.core.placed);
});

Deno.test("fxReadsOf — every TrueFX read and only Kraken's marked ones, by when each arrived", () => {
  const m = Date.UTC(2026, 10, 2, 9, 0);
  const reads = fxReadsOf([
    { source: "truefx", pair: "GBPUSD", minute: iso(m), recv_ms: [300, 1300], mid: [1300000, 1300100], fallback: [false, false] },
    { source: "kraken", pair: "GBPUSD", minute: iso(m), recv_ms: [500, 2500], mid: [1299000, 1299500], fallback: [false, true] },
    { source: "truefx", pair: "EURUSD", minute: iso(m), recv_ms: [400], mid: [1100000], fallback: [false] },
  ]);
  assertEquals(reads, [{ at: m + 300, mid: 1.3 }, { at: m + 1300, mid: 1.3001 }, { at: m + 2500, mid: 1.2995 }]);
});

Deno.test("the start: the first 00:00 UTC at or after 2026-11-01 with three hours of record before it", () => {
  assertEquals(mmStartFor(Date.UTC(2026, 9, 31, 13, 0)), MM_PLANNED_START);
  assertEquals(mmStartFor(Date.UTC(2026, 9, 31, 21, 30)), Date.UTC(2026, 10, 2));
  assertEquals(mmStartFor(Date.UTC(2026, 10, 3, 5, 0)), Date.UTC(2026, 10, 4));
});

Deno.test("the answers: Binance's seconds into minute rows, Revolut X's UK prints once each, its book five levels a side", () => {
  const t = Date.UTC(2026, 10, 2, 9, 0) / 1000;
  const rows = bnRows([[t * 1000, "1", "1", "1", "2.5", "3"], [(t + 61) * 1000, "1", "1", "1", "2.6", "0"]], t, t + 60);
  assertEquals(rows.map((r) => [r.minute, r.bn![0], r.bn![1], r.bn!.filter((x) => x != null).length]), [[iso(t * 1000), 2.5, null, 1], [iso((t + 60) * 1000), null, 2.6, 1]]);
  const p = rxPrintRows({ data: [
    { id: "a", price: "0.93", quantity: "5", timestamp: 1, region: "UK", side: "buy" },
    { id: "b", price: "0.93", quantity: "5", timestamp: 1, region: "EEA", side: "buy" },
    { id: "c", price: "0", quantity: "5", timestamp: 1, region: "UK", side: "sell" },
  ], metadata: { next_cursor: "x" } });
  assertEquals([p.rows.map((r) => r.id), p.cursor], [["a"], "x"]);
  const lv = rxBookLevels({ data: { bids: Array.from({ length: 7 }, (_, i) => ({ price: String(0.93 - i / 1e4), quantity: "1" })), asks: [{ price: "0.94", quantity: "2" }] } });
  assertEquals([lv!.bids.length, lv!.asks], [5, [[0.94, 2]]]);
});

const T0 = Date.UTC(2026, 10, 2, 9, 0);

function world(lease = iso(0)) {
  const fxRows = [];
  for (let i = -30; i <= 5; i++) fxRows.push({ source: "truefx", pair: "GBPUSD", minute: iso(T0 + i * M), recv_ms: [500], src_ms: [400], bid: [1299990], ask: [1300010], mid: [1300000], fallback: [false] });
  return memDb({
    agent_locks: [{ name: "mm", lease_until: lease, holder: null }], fx_ticks: fxRows, agent_quote_inputs: [{ kind: "fx", t: iso(T0), value: 1.3 }],
    agent_mm_inputs: [], agent_mm_prints: [], agent_mm_state: [], agent_mm_minutes: [], agent_mm_fills: [], agent_mm_trips: [],
  }, { now: () => T0 });
}

function venues(log: string[], fail: string | null = null) {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input), u = new URL(url);
    log.push(`${u.host}${u.pathname}`);
    if (fail && u.host.includes(fail)) return new Response("down", { status: 503 });
    if (u.host === "data-api.binance.vision") {
      const a = Number(u.searchParams.get("startTime")), b = Number(u.searchParams.get("endTime")), rows = [];
      for (let t = a; t <= b; t += 1000) rows.push([t, "1.95", "1.95", "1.95", "1.95", "1", t + 999]);
      return new Response(JSON.stringify(rows));
    }
    if (u.host === "api.exchange.coinbase.com") return new Response(JSON.stringify({ price: "1.0002" }));
    if (u.pathname.includes("/public/trades/all")) {
      return new Response(JSON.stringify({ data: [
        { id: "p1", symbol: "XRP/GBP", price: "1.5", quantity: "10", timestamp: T0 - 3 * M + 5000, region: "UK", side: "buy" },
        { id: "p2", symbol: "XRP/GBP", price: "1.5", quantity: "10", timestamp: T0 - 3 * M + 5000, region: "EEA", side: "buy" },
      ], metadata: {} }));
    }
    if (u.pathname.includes("/order-book/")) return new Response(JSON.stringify({ data: { bids: [{ price: "1.49", quantity: "100" }], asks: [{ price: "1.51", quantity: "100" }] } }));
    return new Response("?", { status: 404 });
  }) as typeof fetch;
}

Deno.test("runMm — records each venue once, decides each arm two minutes behind the clock, then changes nothing on a second call", async () => {
  const { db, tables } = world();
  const log: string[] = [];
  const r = await runMm({ db, now: T0 + 12e3, holder: "h", fetchImpl: venues(log), sleep: () => Promise.resolve() });
  assertEquals(r.errors, []);
  assertEquals(log.sort(), ["api.exchange.coinbase.com/products/USDT-USD/ticker", "data-api.binance.vision/api/v3/klines",
    "revx.revolut.com/api/1.0/public/trades/all", "revx.revolut.com/api/2.0/public/order-book/XRP-GBP"]);
  // Ten minutes of Binance (the first call reaches back ten), this minute's book and USDT-USD in this minute's row.
  const inputs = tables[MM_TABLES.inputs];
  assertEquals(inputs.filter((x) => Array.isArray(x.bn)).length, 10);
  const cur = inputs.find((x) => x.minute === iso(T0))!;
  assertEquals([cur.usdt, cur.bids, cur.asks], [1.0002, [[1.49, 100]], [[1.51, 100]]]);
  assertEquals(tables[MM_TABLES.prints].map((p) => p.id), ["p1"]);
  const rec = tables[MM_TABLES.state].find((x) => x.arm === "rec")!.state as { bnNext: number; firstMinute: number; printsCovered: number };
  assertEquals([rec.bnNext * 1000, rec.firstMinute, rec.printsCovered], [T0, T0 - 10 * M, T0 + 12e3]);
  // Each arm: its record's minutes to two behind the clock; it quotes from 2026-11-03 00:00, so nothing rests and nothing is stale yet.
  for (const a of MM_ARMS) {
    const rows = tables[MM_TABLES.minutes].filter((m) => m.arm === a.arm);
    assertEquals([rows.length, rows[0].minute, rows.at(-1)!.minute], [9, iso(T0 - 10 * M), iso(T0 - 2 * M)]);
    assert(rows.every((m) => m.bid == null && m.ask == null && m.equity === a.capGbp && m.stale_s === 0 && m.placed === 0));
    const st = tables[MM_TABLES.state].find((x) => x.arm === a.arm)!.state as ArmState;
    assertEquals([st.lastMinute, st.startAt], [T0 - 2 * M, Date.UTC(2026, 10, 3)]);
  }
  assertEquals(r.decided.p600, { from: iso(T0 - 10 * M), to: iso(T0 - 2 * M), minutes: 9, fills: 0, trips: 0 });
  // The next minute: one more of each.
  const r2 = await runMm({ db, now: T0 + M + 12e3, holder: "h", fetchImpl: venues([]), sleep: () => Promise.resolve() });
  assertEquals([r2.errors, r2.decided.p600?.minutes, tables[MM_TABLES.minutes].length], [[], 1, 30]);
  // Again in the same minute: the record is upserted on its keys, and nothing new is decided.
  const r3 = await runMm({ db, now: T0 + M + 20e3, holder: "h2", fetchImpl: venues([]), sleep: () => Promise.resolve() });
  assertEquals([r3.skipped, tables[MM_TABLES.minutes].length, tables[MM_TABLES.prints].length], ["nothing new to decide", 30, 1]);
});

Deno.test("runMm — a venue that fails is an error and holds its cursor; the others go on; a held lease skips the call", async () => {
  const { db, tables } = world();
  const r = await runMm({ db, now: T0 + 12e3, holder: "h", fetchImpl: venues([], "binance"), sleep: () => Promise.resolve() });
  assert(r.errors.some((e) => e.startsWith("binance: data-api.binance.vision 503")));
  assertEquals(r.skipped, "nothing recorded yet");
  const rec = tables[MM_TABLES.state].find((x) => x.arm === "rec")!;
  assertEquals([(rec.state as { bnNext?: number }).bnNext, tables[MM_TABLES.prints].length], [undefined, 1]);
  assert(String(rec.last_error).includes("binance"));
  // Revolut X down after a first good call: Binance goes on, and no minute is decided past the prints recorded.
  const w = world();
  await runMm({ db: w.db, now: T0 + 12e3, holder: "h", fetchImpl: venues([]), sleep: () => Promise.resolve() });
  const r3 = await runMm({ db: w.db, now: T0 + 5 * M + 12e3, holder: "h", fetchImpl: venues([], "revx"), sleep: () => Promise.resolve() });
  assert(r3.errors.some((e) => e.startsWith("revolut x prints:")));
  // The first call covered the prints to T0 + 12 s: T0 − 1 min is the last minute they cover whole, and it goes no further.
  assertEquals(w.tables[MM_TABLES.minutes].filter((m) => m.arm === "p600").at(-1)!.minute, iso(T0 - M));
  const r4 = await runMm({ db: w.db, now: T0 + 6 * M + 12e3, holder: "h", fetchImpl: venues([], "revx"), sleep: () => Promise.resolve() });
  assertEquals(r4.skipped, "nothing new to decide");
  const held = world(iso(T0 + 60e3));
  const r2 = await runMm({ db: held.db, now: T0 + 12e3, holder: "h", fetchImpl: venues([]), sleep: () => Promise.resolve() });
  assertEquals(r2.skipped, "another run holds the lease");
});

Deno.test("runMm — an arm past its start quotes on the recorded fair: £200 bid 14 bps under it", async () => {
  const { db, tables } = world();
  const log: string[] = [];
  await runMm({ db, now: T0 + 12e3, holder: "h", fetchImpl: venues(log), sleep: () => Promise.resolve() });
  // Pretend the start has passed and the basis is known: the next minute quotes (USDT-USD known from T0).
  for (const row of tables[MM_TABLES.state]) {
    if (row.arm === "rec") continue;
    const st = row.state as ArmState;
    st.startAt = T0 - 60 * M;
    st.core.c = 0; st.core.firstStep = (T0 - 60 * M) / 1000;
  }
  await runMm({ db, now: T0 + 3 * M + 12e3, holder: "h", fetchImpl: venues([]), sleep: () => Promise.resolve() });
  const m = tables[MM_TABLES.minutes].find((x) => x.arm === "p600" && x.minute === iso(T0 + M))!;
  const fair = 1.95 * (1.0002 / 1.3);
  assertAlmostEquals(Number(m.fair), fair, 1e-12);
  assertAlmostEquals(Number(m.bid), fair * (1 - 14 / 1e4), 1e-12);
  // Its first second is stale: the fair it knows is the second before's, the last of a minute with no USDT-USD yet.
  assertEquals([m.ask, m.placed, m.stale_s], [null, 1, 1]);
  // The minutes before had no USDT-USD read made by their start (the first was made 12 s into T0): every second stale.
  for (const t of [T0 - M, T0]) {
    const before = tables[MM_TABLES.minutes].find((x) => x.arm === "p600" && x.minute === iso(t))!;
    assertEquals([before.stale_s, before.bid], [60, null]);
  }
});
