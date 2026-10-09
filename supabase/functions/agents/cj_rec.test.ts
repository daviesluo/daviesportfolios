// The CoinJar recorder (cj_rec.ts, 0110): CoinJar's public payloads read as served (a fixture recorded 2026-10-09), every
// print stored once by its trade id, the cursor that pages forward without a gap or a loop, and the book kept near its
// touch, stored only when it changed. Nothing but GETs to CoinJar's public data host, and no credential.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../docs/agents/backtests/cjrec/fixture_2026-10-09.json" with { type: "json" };
import {
  CJ_BOOK_BAND, CJ_BOOK_LEVELS, CJ_DATA, CJ_FROM_ISO, CJ_PAGE, CJ_PAGES_MAX, CJ_PRODUCTS, CJ_READS_UNTIL_MS, type CjPrint, type CjProduct,
  newPrints, nextCursor, parseBook, parseTrades, runCjRec, sameCjBook, secondOf,
} from "./cj_rec.ts";
import { memDb, type Row } from "./testing.ts";

const served = fixture.requests as Record<string, unknown>;
const S_USDC = "/products/USDCGBP/trades?after=1791504000&limit=1000";
const S_USDT = "/products/USDTGBP/trades?after=1791504000&limit=1000";

Deno.test("parseTrades reads CoinJar's served page oldest first, every field, the time as served", () => {
  const raw = served[S_USDC] as Array<Record<string, unknown>>;
  const got = parseTrades(raw, "USDCGBP")!;
  assertEquals(got.dropped, 0);
  assertEquals(got.prints.length, raw.length);
  assertEquals(got.prints.length, 27);
  for (let i = 1; i < got.prints.length; i++) assert(Date.parse(got.prints[i].ts) >= Date.parse(got.prints[i - 1].ts));
  const r = raw[0];
  assertEquals(got.prints[0], {
    product: "USDCGBP", tid: r.tid, ts: r.timestamp, price: Number(r.price), size: Number(r.size), value: Number(r.value), taker_side: r.taker_side,
  });
  // Every print of the page falls in the second `after` named or later (it is inclusive), and its value is price × size
  // to about a penny (41 of the fixture's 42 to the nearest penny; tid 37747275's £120.4114 is served as £120.42).
  for (const p of got.prints) {
    assert(secondOf(p.ts) >= 1791504000);
    assert(Math.abs(p.price * p.size - p.value) <= 0.0101, `${p.tid}`);
  }
  assertEquals(parseTrades(served[S_USDT], "USDTGBP")!.prints.length, 12);
  // The book's first prints, from `after=0`: CoinJar's history pages back to 2020.
  assertEquals((parseTrades(served["/products/USDCGBP/trades?after=0&limit=3"], "USDCGBP")!.prints)[0].ts.slice(0, 10), "2020-04-02");
});

Deno.test("parseTrades drops what it cannot store and counts it; a page that is not a list is null", () => {
  const ok = { tid: 5, price: "0.758", size: "10.5", value: "7.96", taker_side: "auction", timestamp: "2026-10-09T12:00:00.000001Z" };
  const bad = [
    { ...ok, tid: "5" }, { ...ok, tid: 0 }, { ...ok, price: "0" }, { ...ok, size: "" }, { ...ok, value: "x" },
    { ...ok, taker_side: "maker" }, { ...ok, timestamp: "never" }, null,
  ];
  const got = parseTrades([...bad, ok], "USDTGBP")!;
  assertEquals(got.dropped, bad.length);
  assertEquals(got.prints, [{ product: "USDTGBP", tid: 5, ts: ok.timestamp, price: 0.758, size: 10.5, value: 7.96, taker_side: "auction" }]);
  assertEquals(parseTrades({ error_type: "NOT_FOUND" }, "USDCGBP"), null);
  assertEquals(parseTrades([], "USDCGBP"), { prints: [], dropped: 0 });
});

Deno.test("secondOf is the unix second the endpoint's inclusive `after` takes", () => {
  // Measured 2026-10-09: the print at 17:24:51.686837 came back for after=1791566691 and not for 1791566692.
  assertEquals(secondOf("2026-10-09T17:24:51.686837Z"), 1791566691);
  assertEquals(secondOf("2026-10-09T17:24:51.686837+00:00"), 1791566691);
  assertEquals(secondOf(CJ_FROM_ISO), Date.UTC(2026, 8, 1) / 1000);
});

const print = (tid: number, s: number, frac = 0.5): CjPrint => ({
  product: "USDCGBP", tid, ts: new Date(s * 1000 + frac * 1000).toISOString(), price: 0.758, size: 1, value: 0.76, taker_side: "buy",
});

Deno.test("newPrints keeps each trade id once: those stored and those repeated in the page are dropped", () => {
  const page = [print(1, 100), print(2, 100), print(2, 100), print(3, 101)];
  assertEquals(newPrints(page, new Set([1])).map((p) => p.tid), [2, 3]);
  assertEquals(newPrints(page, new Set()).map((p) => p.tid), [1, 2, 3]);
  assertEquals(newPrints([], new Set([1])), []);
});

Deno.test("nextCursor moves to the newest print's second; a full page asks again; a full second moves on one", () => {
  assertEquals(nextCursor([], 100), { cursorS: 100, more: false, skipped: false });
  assertEquals(nextCursor([print(1, 100), print(2, 130)], 100), { cursorS: 130, more: false, skipped: false });
  const full = Array.from({ length: CJ_PAGE }, (_, i) => print(i + 1, 100 + Math.floor(i / 10)));
  assertEquals(nextCursor(full, 100), { cursorS: 100 + (CJ_PAGE - 1) / 10 | 0, more: true, skipped: false });
  const oneSecond = Array.from({ length: CJ_PAGE }, (_, i) => print(i + 1, 100));
  assertEquals(nextCursor(oneSecond, 100), { cursorS: 101, more: true, skipped: true });
  // It never goes back.
  assertEquals(nextCursor([print(1, 90)], 100).cursorS, 100);
});

Deno.test("parseBook keeps each side's levels within 40 bps of the mid, best first, the best always", () => {
  for (const p of CJ_PRODUCTS) {
    const raw = served[`/products/${p}/book?level=2`] as { bids: string[][]; asks: string[][] };
    assertEquals([raw.bids.length, raw.asks.length], [40, 40]);   // level 2 serves 40 a side (its docs say 20)
    const b = parseBook(raw)!;
    const bb = Number(raw.bids[0][0]), ba = Number(raw.asks[0][0]), mid = (bb + ba) / 2;
    const want = (side: string[][], desc: boolean) => side.map((l) => [Number(l[0]), Number(l[1])])
      .sort((x, y) => (desc ? y[0] - x[0] : x[0] - y[0]))
      .filter((l, i) => i === 0 || (desc ? l[0] >= mid * (1 - CJ_BOOK_BAND) : l[0] <= mid * (1 + CJ_BOOK_BAND))).slice(0, CJ_BOOK_LEVELS);
    assertEquals(b, { bids: want(raw.bids, true), asks: want(raw.asks, false) });
    assertEquals(b.bids[0][0], bb);
    assertEquals(b.asks[0][0], ba);
    assert(b.bids.length >= 5 && b.bids.length < 40 && b.asks.length >= 5 && b.asks.length < 40, `${p}: ${b.bids.length}/${b.asks.length}`);
    for (const l of [...b.bids, ...b.asks]) assert(Math.abs(l[0] / mid - 1) <= CJ_BOOK_BAND || l[0] === bb || l[0] === ba);
  }
});

Deno.test("parseBook: a wide book keeps its bests, an empty side is empty, a snapshot of another shape is null", () => {
  assertEquals(parseBook({ bids: [["0.70", "5"], ["0.69", "5"]], asks: [["0.80", "7"]] }), { bids: [[0.7, 5]], asks: [[0.8, 7]] });
  assertEquals(parseBook({ bids: [], asks: [["0.758", "7"], ["0.7581", "1"], ["0.80", "1"]] }), { bids: [], asks: [[0.758, 7], [0.7581, 1]] });
  assertEquals(parseBook({ bids: [["0.7555", "0"]], asks: [] }), null);
  assertEquals(parseBook({ bids: [], asks: [] }), null);
  assertEquals(parseBook({ error_type: "NOT_FOUND" }), null);
  assertEquals(parseBook(null), null);
  assertEquals(parseBook({ bids: Array.from({ length: 40 }, () => ["0.7555", "1"]), asks: [["0.7556", "1"]] })!.bids.length, CJ_BOOK_LEVELS);
  const a = parseBook({ bids: [["0.7555", "1"]], asks: [["0.7576", "2"]] });
  assertEquals(sameCjBook(a, { bids: [[0.7555, 1]], asks: [[0.7576, 2]] }), true);
  assertEquals(sameCjBook(a, { bids: [[0.7555, 1]], asks: [[0.7576, 2.5]] }), false);
  assertEquals(sameCjBook(a, null), false);
});

// ------------------------------------------------------------------------------------------------------- the minute

/**
 * CoinJar's data host on a fake clock: each book's history of prints served by `after` (inclusive, ascending, a thousand
 * at most) and its book, as the real host does; `fail` makes a product's requests answer 500. It records every request.
 */
function coinjar(t0: number) {
  let t = t0;
  const hist: Record<string, CjPrint[]> = { USDCGBP: [], USDTGBP: [] };
  const book: Record<string, { bids: string[][]; asks: string[][] }> = {
    USDCGBP: served["/products/USDCGBP/book?level=2"] as { bids: string[][]; asks: string[][] },
    USDTGBP: served["/products/USDTGBP/book?level=2"] as { bids: string[][]; asks: string[][] },
  };
  const v = { hist, book, fail: new Set<string>(), calls: [] as Array<{ method: string; url: string; auth: boolean }>, latencyMs: 120 };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const h = new Headers(init?.headers);
    v.calls.push({ method: init?.method ?? "GET", url, auth: h.has("authorization") || h.has("apikey") });
    await new Promise((r) => setTimeout(r, 0));
    t += v.latencyMs;
    const u = new URL(url);
    if (u.origin !== CJ_DATA) return new Response("wrong host", { status: 400 });
    const [, , product, kind] = u.pathname.split("/");
    if (v.fail.has(product)) return new Response("{}", { status: 500 });
    if (kind === "book") return Response.json(book[product]);
    const after = Number(u.searchParams.get("after")), limit = Math.min(Number(u.searchParams.get("limit")), CJ_PAGE);
    const page = hist[product].filter((p) => secondOf(p.ts) >= after).slice(0, limit)
      .map((p) => ({ tid: p.tid, price: p.price.toFixed(8), size: p.size.toFixed(6), value: p.value.toFixed(2), taker_side: p.taker_side, timestamp: p.ts }));
    return Response.json(page);
  }) as typeof fetch;
  return { v, fetchImpl, clock: () => t, advance: (ms: number) => { t += ms; } };
}

let nextTid = 37_000_000;
/** `n` prints of a book, `perSecond` to a second, from unix second `s`; their tids rise across both books, as CoinJar's. */
function addPrints(hist: CjPrint[], product: CjProduct, s: number, n: number, perSecond = 1) {
  for (let i = 0; i < n; i++) {
    const sec = s + Math.floor(i / perSecond);
    hist.push({ product, tid: nextTid++, ts: new Date(sec * 1000 + 100 + Math.floor((i % perSecond) * 800 / perSecond)).toISOString().replace("Z", "123Z"), price: 0.758, size: 10, value: 7.58, taker_side: i % 2 ? "sell" : "buy" });
  }
}

const tids = (rows: Row[], p: string) => rows.filter((r) => r.product === p).map((r) => Number(r.tid));
const FROM_S = secondOf(CJ_FROM_ISO);

Deno.test("runCjRec: the first minute reads each book's history from CJ_FROM_ISO, each print once; the next adds only new ones", async () => {
  const t0 = Date.UTC(2026, 9, 9, 18, 30, 0);
  const cj = coinjar(t0);
  addPrints(cj.v.hist.USDCGBP, "USDCGBP", FROM_S - 50, 10);          // before the start: never read
  addPrints(cj.v.hist.USDCGBP, "USDCGBP", FROM_S, 1500, 1);            // two pages
  addPrints(cj.v.hist.USDTGBP, "USDTGBP", FROM_S + 7, 300, 3);         // three to a second
  const { db, tables } = memDb({ cj_rec_state: [{ id: 1, state: {}, updated_at: null, last_error: null }] }, { now: () => t0 });
  const r1 = await runCjRec({ db, now: t0, fetchImpl: cj.fetchImpl, clock: cj.clock });
  assertEquals(r1.errors, []);
  assertEquals(r1.report, false);
  assertEquals([r1.books.USDCGBP!.prints, r1.books.USDCGBP!.pages, r1.books.USDCGBP!.behind], [1500, 2, false]);
  assertEquals([r1.books.USDTGBP!.prints, r1.books.USDTGBP!.pages, r1.books.USDTGBP!.behind], [300, 1, false]);
  assertEquals(tids(tables.cj_trades, "USDCGBP"), cj.v.hist.USDCGBP.slice(10).map((p) => p.tid));
  assertEquals(tids(tables.cj_trades, "USDTGBP"), cj.v.hist.USDTGBP.map((p) => p.tid));
  assertEquals(tables.cj_trades[0], { ...cj.v.hist.USDCGBP[10] });
  // A minute with nothing new stores nothing; then prints in the cursor's own second and after it come in once each.
  cj.advance(60e3);
  const r2 = await runCjRec({ db, now: t0 + 60e3, fetchImpl: cj.fetchImpl, clock: cj.clock });
  assertEquals([r2.books.USDCGBP!.prints, r2.books.USDTGBP!.prints], [0, 0]);
  const last = cj.v.hist.USDTGBP.at(-1)!;
  cj.v.hist.USDTGBP.push({ ...last, tid: nextTid++, ts: new Date(secondOf(last.ts) * 1000 + 900).toISOString().replace("Z", "000Z") });   // its second, later
  addPrints(cj.v.hist.USDTGBP, "USDTGBP", secondOf(last.ts) + 30, 4);
  cj.advance(60e3);
  const r3 = await runCjRec({ db, now: t0 + 120e3, fetchImpl: cj.fetchImpl, clock: cj.clock });
  assertEquals(r3.books.USDTGBP!.prints, 5);
  assertEquals(tids(tables.cj_trades, "USDTGBP"), cj.v.hist.USDTGBP.map((p) => p.tid));
  assertEquals(new Set(tables.cj_trades.map((r) => `${r.product}/${r.tid}`)).size, tables.cj_trades.length);
  // Only GETs to CoinJar's data host, none with a credential, a minute's book and prints a book.
  assert(cj.v.calls.every((c) => c.method === "GET" && c.url.startsWith(`${CJ_DATA}/products/`) && !c.auth));
  assertEquals(r3.books.USDTGBP!.cursor, new Date((secondOf(last.ts) + 33) * 1000).toISOString());
});

Deno.test("runCjRec: a history longer than CJ_PAGES_MAX pages is caught up over minutes, and a second fuller than a page moves on", async () => {
  const t0 = Date.UTC(2026, 9, 9, 18, 30, 0);
  const cj = coinjar(t0);
  const n = CJ_PAGE * (CJ_PAGES_MAX + 2) + 17;
  addPrints(cj.v.hist.USDCGBP, "USDCGBP", FROM_S, n, 2);
  const { db, tables } = memDb({}, { now: () => t0 });
  const r1 = await runCjRec({ db, now: t0, fetchImpl: cj.fetchImpl, clock: cj.clock });
  assertEquals([r1.books.USDCGBP!.pages, r1.books.USDCGBP!.behind], [CJ_PAGES_MAX, true]);
  const r2 = await runCjRec({ db, now: t0 + 60e3, fetchImpl: cj.fetchImpl, clock: cj.clock });
  assertEquals(r2.books.USDCGBP!.behind, false);
  assertEquals(tids(tables.cj_trades, "USDCGBP"), cj.v.hist.USDCGBP.map((p) => p.tid));
  // 1,200 prints in one second: a page of them is read, the second is passed, and the minute says so.
  const cj2 = coinjar(t0);
  addPrints(cj2.v.hist.USDTGBP, "USDTGBP", FROM_S + 5, CJ_PAGE + 200, CJ_PAGE + 200);
  addPrints(cj2.v.hist.USDTGBP, "USDTGBP", FROM_S + 9, 3);
  const m2 = memDb({}, { now: () => t0 });
  const r3 = await runCjRec({ db: m2.db, now: t0, fetchImpl: cj2.fetchImpl, clock: cj2.clock });
  assertEquals(r3.books.USDTGBP!.skipped, 1);
  assertEquals(tids(m2.tables.cj_trades, "USDTGBP").length, CJ_PAGE + 3);
  assert(r3.errors.includes("USDTGBP prints: a second held more than a page"));
});

Deno.test("runCjRec: a book is stored when it changes and its row extended when it does not", async () => {
  const t0 = Date.UTC(2026, 9, 9, 18, 30, 0);
  const cj = coinjar(t0);
  const { db, tables } = memDb({}, { now: () => t0 });
  const r1 = await runCjRec({ db, now: t0, fetchImpl: cj.fetchImpl, clock: cj.clock });
  assertEquals([r1.books.USDCGBP!.book, r1.books.USDTGBP!.book], ["recorded", "recorded"]);
  const first = tables.cj_book.find((r) => r.product === "USDCGBP")!;
  assertEquals(first.bids, parseBook(cj.v.book.USDCGBP)!.bids);
  assertEquals([first.reads, first.seen_until === first.ts], [1, true]);
  cj.advance(60e3);
  const r2 = await runCjRec({ db, now: t0 + 60e3, fetchImpl: cj.fetchImpl, clock: cj.clock });
  assertEquals(r2.books.USDCGBP!.book, "unchanged");
  assertEquals(tables.cj_book.length, 2);
  assertEquals(first.reads, 2);
  assert(Date.parse(String(first.seen_until)) >= t0 + 60e3);
  // A level beyond the band changes nothing stored; one inside it is a new row.
  cj.v.book.USDCGBP = { bids: [...cj.v.book.USDCGBP.bids.slice(0, -1), ["0.50000000", "9.000000"]], asks: cj.v.book.USDCGBP.asks };
  cj.advance(60e3);
  assertEquals((await runCjRec({ db, now: t0 + 120e3, fetchImpl: cj.fetchImpl, clock: cj.clock })).books.USDCGBP!.book, "unchanged");
  cj.v.book.USDCGBP = { bids: [[cj.v.book.USDCGBP.bids[0][0], "1.000000"], ...cj.v.book.USDCGBP.bids.slice(1)], asks: cj.v.book.USDCGBP.asks };
  cj.advance(60e3);
  assertEquals((await runCjRec({ db, now: t0 + 180e3, fetchImpl: cj.fetchImpl, clock: cj.clock })).books.USDCGBP!.book, "recorded");
  assertEquals(tables.cj_book.filter((r) => r.product === "USDCGBP").length, 2);
});

Deno.test("runCjRec: a book that fails is named and the other recorded; the fault is reported at once, then hourly", async () => {
  const t0 = Date.UTC(2026, 9, 9, 18, 30, 0);
  const cj = coinjar(t0);
  addPrints(cj.v.hist.USDCGBP, "USDCGBP", FROM_S, 3);
  addPrints(cj.v.hist.USDTGBP, "USDTGBP", FROM_S, 3);
  cj.v.fail.add("USDTGBP");
  const { db, tables } = memDb({ cj_rec_state: [{ id: 1, state: {}, updated_at: null, last_error: null }] }, { now: () => t0 });
  const run = (m: number) => runCjRec({ db, now: t0 + m * 60e3, fetchImpl: cj.fetchImpl, clock: cj.clock });
  const r1 = await run(0);
  assertEquals(r1.errors, ["USDTGBP book: 500 {}", "USDTGBP prints: 500 {}"]);
  assertEquals([r1.report, r1.books.USDCGBP!.prints, r1.books.USDCGBP!.book], [true, 3, "recorded"]);
  assertEquals(tables.cj_rec_state[0].last_error, "USDTGBP book: 500 {} | USDTGBP prints: 500 {}");
  assertEquals((await run(1)).report, false);
  assertEquals((await run(59)).report, false);
  assertEquals((await run(60)).report, true);
  cj.v.fail.clear();
  const ok = await run(61);
  assertEquals([ok.report, ok.errors, ok.books.USDTGBP!.prints], [false, [], 3]);
  assertEquals([tables.cj_rec_state[0].last_error, tables.cj_rec_state[0].state], [null, {}]);
  // A new fault after it is reported at once.
  cj.v.fail.add("USDCGBP");
  assertEquals((await run(62)).report, true);
});

Deno.test("runCjRec starts no read past CJ_READS_UNTIL_MS: a slow host leaves the rest for the next minute", async () => {
  const t0 = Date.UTC(2026, 9, 9, 18, 30, 0);
  const cj = coinjar(t0);
  cj.v.latencyMs = 7_000;
  addPrints(cj.v.hist.USDCGBP, "USDCGBP", FROM_S, CJ_PAGE * 3, 1);
  const { db } = memDb({}, { now: () => t0 });
  const r = await runCjRec({ db, now: t0, fetchImpl: cj.fetchImpl, clock: cj.clock });
  assertEquals(r.books.USDCGBP!.behind, true);
  assert(r.books.USDCGBP!.pages < 3);
  // Both books read concurrently on the fake clock, so the run's span is the slower book's requests.
  assert(r.ms <= CJ_READS_UNTIL_MS + 2 * cj.v.latencyMs, `${r.ms}`);
});
