// Coinbase's order books (cb_books.ts, 0114): the level-2 answers as Coinbase served them (two readings a minute apart,
// recorded 2026-10-10), cut to ten levels a side on the book's grid, stored only when they change, read 30 s into the
// minute one book at a time, and a 429 ending the minute. Nothing but GETs to Coinbase's public host, and no credential.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../docs/agents/backtests/cbrec/books_2026-10-10.json" with { type: "json" };
import {
  CB_BOOK_LEVELS, CB_BOOK_SIZE_UNIT, CB_BOOK_TICK, CB_BOOKS_BUDGET_MS, CB_BOOKS_GAP_MS, CB_BOOKS_START_MS, cbBookOrder, cbBooksDelayMs,
  parseCbBook, runCbBooks, sameCbBook, type CbBook,
} from "./cb_books.ts";
import { CB_API, CB_PRODUCTS, CB_READS_UNTIL_MS, CB_TIMEOUT_MS, type CbProduct } from "./cb_rec.ts";
import { memDb, type Row } from "./testing.ts";

type Served = { bids: [string, string, number][]; asks: [string, string, number][]; sequence: number; time: string };
const readings = fixture.readings.map((r) => r.requests as unknown as Record<string, Served>);
const pathOf = (p: CbProduct) => `/products/${p}/book?level=2`;
const served = (i: number, p: CbProduct) => readings[i][pathOf(p)];

Deno.test("parseCbBook keeps each served book's ten best levels a side, on its own grid, and they read back as served", () => {
  for (const r of [0, 1]) {
    for (const p of CB_PRODUCTS) {
      const raw = served(r, p);
      const b = parseCbBook(raw, p);
      assertEquals(b.seq, raw.sequence);
      assertEquals(b.bookTs, raw.time);
      for (const [mine, theirs, desc] of [[b.bid, raw.bids, true], [b.ask, raw.asks, false]] as const) {
        const want = [...theirs].sort((x, y) => (desc ? Number(y[0]) - Number(x[0]) : Number(x[0]) - Number(y[0]))).slice(0, CB_BOOK_LEVELS);
        assertEquals(mine.px.length, Math.min(CB_BOOK_LEVELS, theirs.length));
        // Every stored level is the served one exactly: price in steps, size in hundredths, the order count.
        assertEquals(mine.px.map((k) => k * CB_BOOK_TICK[p]).map((x) => Number(x.toFixed(5))), want.map((l) => Number(l[0])));
        assertEquals(mine.sz.map((k) => Number((k * CB_BOOK_SIZE_UNIT).toFixed(2))), want.map((l) => Number(l[1])));
        assertEquals(mine.n, want.map((l) => l[2]));
        for (const xs of [mine.px, mine.sz, mine.n]) assert(xs.every(Number.isSafeInteger));
      }
      // Coinbase serves the best level first: the bid below the ask.
      assert(b.bid.px[0] < b.ask.px[0], `${p}`);
    }
  }
  // As served at 01:38:35: USDC-GBP's touch 0.7556 / 0.7557, USDT-EUR's 0.8925 / 0.89253 in its 0.00001 steps.
  const g = parseCbBook(served(0, "USDC-GBP"), "USDC-GBP"), e = parseCbBook(served(0, "USDT-EUR"), "USDT-EUR");
  assertEquals([g.bid.px[0], g.ask.px[0], g.bid.sz[0], g.bid.n[0]], [7556, 7557, 1136853, 2]);
  assertEquals([e.bid.px[0], e.ask.px[0]], [89250, 89253]);
  // Deeper than ten on every side but USDT-EUR's bids, which had ten.
  assertEquals(CB_PRODUCTS.map((p) => [served(0, p).bids.length, served(0, p).asks.length]), [[96, 177], [57, 61], [323, 154], [10, 15]]);
});

Deno.test("parseCbBook sorts what it is given, keeps a short or empty side, and refuses a level off the grid or unreadable", () => {
  const ok = { bids: [["0.7554", "1.5", 1], ["0.7556", "10", 2], ["0.7555", "0.01", 1]], asks: [], sequence: 7, time: "2026-10-10T00:00:00.123456789Z" };
  const b = parseCbBook(ok, "USDT-GBP");
  assertEquals(b, { seq: 7, bookTs: ok.time, bid: { px: [7556, 7555, 7554], sz: [1000, 1, 150], n: [2, 1, 1] }, ask: { px: [], sz: [], n: [] } });
  // A price between USDC-GBP's 0.0001 steps, or a size below a hundredth: the book is refused, never stored wrong.
  assertThrows(() => parseCbBook({ ...ok, bids: [["0.75555", "1", 1]] }, "USDC-GBP"), Error, "price off the 0.0001 grid");
  assertEquals(parseCbBook({ ...ok, bids: [["0.75555", "1", 1]] }, "USDT-EUR").bid.px, [75555]);
  assertThrows(() => parseCbBook({ ...ok, bids: [["0.7555", "1.005", 1]] }, "USDC-GBP"), Error, "size off the 0.01 grid");
  assertThrows(() => parseCbBook({ ...ok, bids: [["0.7555", "1"]] }, "USDC-GBP"), Error, "unreadable level");
  assertThrows(() => parseCbBook({ ...ok, bids: [["0.7555", "1", "many"]] }, "USDC-GBP"), Error, "unreadable order count");
  assertThrows(() => parseCbBook({ ...ok, bids: [["0", "1", 1]] }, "USDC-GBP"), Error, "price off");
  assertThrows(() => parseCbBook({ message: "NotFound" }, "USDC-GBP"), Error, "not a book");
  assertThrows(() => parseCbBook([], "USDC-GBP"), Error, "not a book");
  // No sequence or time it can read: kept as null, the levels still stored.
  assertEquals(parseCbBook({ bids: [], asks: [], sequence: "x", time: "never" }, "USDC-GBP").seq, null);
});

Deno.test("sameCbBook compares every level and nothing else: all four books changed between the two readings a minute apart", () => {
  for (const p of CB_PRODUCTS) {
    const a = parseCbBook(served(0, p), p), b = parseCbBook(served(1, p), p);
    const moved: CbBook = { ...a, seq: (a.seq ?? 0) + 99, bookTs: null };
    assert(sameCbBook(a, moved), p);
    assert(!sameCbBook(a, b), p);
    const c = structuredClone(a);
    c.ask.n[c.ask.n.length - 1]++;
    assert(!sameCbBook(a, c), `${p}: an order count`);
  }
});

Deno.test("the reads start 30 s into the minute, after the recorder's last can have ended, and turn the books each minute", () => {
  assertEquals(CB_BOOKS_START_MS, 30e3);
  // The recorder starts no read past 15 s and waits 8 s at most for one: done by 23 s.
  assert(CB_READS_UNTIL_MS + CB_TIMEOUT_MS < CB_BOOKS_START_MS);
  const m = Date.UTC(2026, 9, 10, 1, 38);
  assertEquals([cbBooksDelayMs(m), cbBooksDelayMs(m + 1_500), cbBooksDelayMs(m + 30e3), cbBooksDelayMs(m + 45e3)], [30e3, 28_500, 0, 0]);
  const orders = [0, 1, 2, 3, 4].map((k) => cbBookOrder(m + k * 60e3));
  for (const o of orders) assertEquals([...o].sort(), [...CB_PRODUCTS].sort());
  assertEquals(orders.map((o) => o[0]), [orders[0][0], orders[1][0], orders[2][0], orders[3][0], orders[0][0]]);
  assertEquals(new Set(orders.slice(0, 4).map((o) => o[0])).size, 4);
});

/** A simulated minute: a clock that moves only by the run's pauses and each request's 120 ms, and Coinbase's answers. */
function world(answer: (p: CbProduct, n: number) => { status: number; body: unknown }) {
  let t = 0;
  const calls: { url: string; method: string; headers: Record<string, string>; at: number }[] = [];
  const pauses: number[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string>) }, at: t });
    t += 120;
    const p = CB_PRODUCTS.find((x) => url === `${CB_API}${pathOf(x)}`);
    if (!p) return Promise.resolve(new Response("{}", { status: 404 }));
    const a = answer(p, calls.length);
    return Promise.resolve(new Response(JSON.stringify(a.body), { status: a.status }));
  }) as typeof fetch;
  return {
    calls, pauses, fetchImpl, clock: () => t,
    pause: (ms: number) => { pauses.push(ms); t += ms; return Promise.resolve(); },
    reset: () => { t = 0; calls.length = 0; pauses.length = 0; },
  };
}

Deno.test("runCbBooks stores each book that changed, extends the row of one that did not, and reads nothing but the four public books", async () => {
  const now0 = Date.UTC(2026, 9, 10, 1, 38, 30);
  const { db, tables } = memDb({ cb_book_state: [{ id: 1, state: {} } as Row], cb_book_levels: [] }, { now: () => now0 });
  let reading = 0;
  const w = world((p) => ({ status: 200, body: served(reading, p) }));
  const run = (now: number) => { w.reset(); return runCbBooks({ db, now, clock: w.clock, fetchImpl: w.fetchImpl, pause: w.pause }); };

  const r1 = await run(now0);
  assertEquals([r1.recorded, r1.unchanged, r1.errors, r1.skipped, r1.reached, r1.report], [4, 0, [], [], true, false]);
  // GETs only, to the four level-2 books in this minute's order, 250 ms apart, with no credential of any kind.
  assertEquals(w.calls.map((c) => c.url), cbBookOrder(now0).map((p) => `${CB_API}${pathOf(p)}`));
  assert(w.calls.every((c) => c.method === "GET" && Object.keys(c.headers).sort().join() === "accept,user-agent"));
  for (let i = 1; i < w.calls.length; i++) assertEquals(w.calls[i].at - w.calls[i - 1].at, CB_BOOKS_GAP_MS);
  const rows = tables.cb_book_levels;
  assertEquals(rows.length, 4);
  const g = rows.find((r) => r.product === "USDC-GBP")!;
  const want = parseCbBook(served(0, "USDC-GBP"), "USDC-GBP");
  assertEquals(
    [g.seq, g.book_ts, g.bid_px, g.bid_sz, g.bid_n, g.ask_px, g.ask_sz, g.ask_n, g.reads, g.seen_until === g.ts],
    [want.seq, want.bookTs, want.bid.px, want.bid.sz, want.bid.n, want.ask.px, want.ask.sz, want.ask.n, 1, true],
  );
  // Each row's instant is when its reading arrived, in the run's order.
  const ts = cbBookOrder(now0).map((p) => String(rows.find((r) => r.product === p)!.ts));
  assertEquals(ts, [...ts].sort());
  assertEquals(Date.parse(ts[0]), now0 + 120);

  // The same books a minute later: no row more, each row read twice and seen until the second reading.
  const r2 = await run(now0 + 60e3);
  assertEquals([r2.recorded, r2.unchanged], [0, 4]);
  assertEquals(tables.cb_book_levels.length, 4);
  for (const r of tables.cb_book_levels) {
    assertEquals(r.reads, 2);
    assert(Date.parse(String(r.seen_until)) >= now0 + 60e3, String(r.product));
  }
  // The second served reading, which changed every book: four rows more.
  reading = 1;
  const r3 = await run(now0 + 120e3);
  assertEquals([r3.recorded, r3.unchanged, r3.errors], [4, 0, []]);
  assertEquals(tables.cb_book_levels.length, 8);
  const st = tables.cb_book_state[0];
  assertEquals([st.state, st.last_error, (st.last_report as Record<string, unknown>).recorded], [{}, null, 4]);
});

Deno.test("a 429 ends the minute's reads; a fault is reported when it appears and at most hourly while it lasts", async () => {
  const now0 = Date.UTC(2026, 9, 10, 2, 0, 30);
  const { db, tables } = memDb({ cb_book_state: [{ id: 1, state: {} } as Row], cb_book_levels: [] }, { now: () => now0 });
  const w = world((p, n) => (n === 2 ? { status: 429, body: { message: "Public rate limit exceeded" } } : { status: 200, body: served(0, p) }));
  const run = (now: number) => { w.reset(); return runCbBooks({ db, now, clock: w.clock, fetchImpl: w.fetchImpl, pause: w.pause }); };
  const order = cbBookOrder(now0);
  const r1 = await run(now0);
  assertEquals(w.calls.length, 2);
  assertEquals([r1.recorded, r1.errors, r1.skipped, r1.report], [1, ["429 at read 2"], order.slice(2), true]);
  assertEquals(tables.cb_book_levels.map((r) => r.product), [order[0]]);
  assertEquals((tables.cb_book_state[0].state as { fault: { at: number } }).fault.at, now0);
  // The same limit a minute later, on another book (the order turns), is the same fault: reported again an hour later,
  // not in between.
  const r2 = await run(now0 + 60e3);
  assertEquals([r2.errors.length, r2.report], [1, false]);
  assertEquals((await run(now0 + 3_600e3)).report, true);
  // A minute with no fault clears it.
  const ok = world((p) => ({ status: 200, body: served(0, p) }));
  const r4 = await runCbBooks({ db, now: now0 + 3_660e3, clock: ok.clock, fetchImpl: ok.fetchImpl, pause: ok.pause });
  assertEquals([r4.errors, r4.report, tables.cb_book_state[0].state, tables.cb_book_state[0].last_error], [[], false, {}, null]);
});

Deno.test("a book that cannot be read is skipped and named; the rest are stored; nothing starts past the budget", async () => {
  const now0 = Date.UTC(2026, 9, 10, 3, 0, 30);
  const { db, tables } = memDb({ cb_book_state: [{ id: 1, state: {} } as Row], cb_book_levels: [] }, { now: () => now0 });
  const odd = cbBookOrder(now0)[1];
  const w = world((p) => (p === odd ? { status: 200, body: { ...served(0, p), bids: [["0.755555", "1", 1]] } } : { status: 200, body: served(0, p) }));
  const r = await runCbBooks({ db, now: now0, clock: w.clock, fetchImpl: w.fetchImpl, pause: w.pause });
  assertEquals(r.recorded, 3);
  assertEquals(r.errors.length, 1);
  assert(r.errors[0].startsWith(`${odd}: price off the`), r.errors[0]);
  assertEquals(tables.cb_book_levels.length, 3);
  // A slow host: each answer takes 5 s, so the third read would start past the 12 s budget and it and the fourth wait.
  const slow = world((p) => ({ status: 200, body: served(0, p) }));
  const f = slow.fetchImpl;
  const slowFetch = ((u: string, i?: RequestInit) => { slow.pause(4_880); slow.pauses.pop(); return f(u, i); }) as typeof fetch;
  const r2 = await runCbBooks({ db, now: now0 + 60e3, clock: slow.clock, fetchImpl: slowFetch, pause: slow.pause });
  const order = cbBookOrder(now0 + 60e3);
  assertEquals(slow.calls.length, 3);
  assert(slow.calls[2].at - slow.calls[0].at <= CB_BOOKS_BUDGET_MS);
  assertEquals(r2.skipped, order.slice(3));
  // An answer that is not JSON, and a host that refuses: named, nothing stored for those books.
  const bad = world((p) => (p === order[0] ? { status: 503, body: "busy" } : { status: 200, body: served(0, p) }));
  const r3 = await runCbBooks({ db, now: now0 + 60e3, clock: bad.clock, fetchImpl: bad.fetchImpl, pause: bad.pause });
  assert(r3.errors.some((e) => e.startsWith(`${order[0]}: 503`)), r3.errors.join());
});
