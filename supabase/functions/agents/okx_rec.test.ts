// OKX's recorder (okx_rec.ts, 0150): OKX's public payloads read as served (the shapes of 2026-10-27's reads), every print
// stored once by its trade id with the TAKER's side kept as the aggressor, a burst paged back with the history endpoint and
// kept as a hole until closed (coverage stays meanwhile), the best five levels a side a row a minute, and nothing but GETs to
// OKX's public market-data host.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  OKX_API, OKX_BOOKS, OKX_COVER_MARGIN_MS, OKX_HISTORY_PAGE, OKX_PAGE, OKX_PAGES_MAX, type OkxBook, type OkxPrint, okxData, parseOkxBook, parseOkxTrades, runOkxRec,
  stepOkxCursor,
} from "./okx_rec.ts";
import { memDb, type Row } from "./testing.ts";

Deno.test("okxData opens OKX's envelope and refuses any code but \"0\"", () => {
  assertEquals(okxData({ code: "0", msg: "", data: [1] }), [1]);
  assertThrows(() => okxData({ code: "51001", msg: "Instrument ID does not exist", data: [] }), Error, "51001");
  assertThrows(() => okxData("nope"), Error, "okx: code");
});

Deno.test("parseOkxTrades keeps the taker's side as the aggressor, newest first, and drops what it cannot store", () => {
  // As served 2026-10-27 05:20 UTC (`/api/v5/market/trades?instId=USDG-EUR`).
  const served = [
    { instId: "USDG-EUR", tradeId: "55477", px: "0.8958", sz: "11.1756", side: "buy", ts: "1793081035173", source: "0" },
    { instId: "USDG-EUR", tradeId: "55476", px: "0.8948", sz: "3", side: "sell", ts: "1793081000000", source: "0" },
  ];
  const got = parseOkxTrades([served[1], served[0]], "USDG-EUR");
  assertEquals(got.dropped, 0);
  assertEquals(got.prints, [
    { book: "USDG-EUR", trade_id: 55477, ts: 1793081035173, price: 0.8958, size: 11.1756, side: "buy" },
    { book: "USDG-EUR", trade_id: 55476, ts: 1793081000000, price: 0.8948, size: 3, side: "sell" },
  ]);
  const ok = served[0];
  const bad = [{ ...ok, instId: "EURC-USDC" }, { ...ok, tradeId: "x" }, { ...ok, px: "0" }, { ...ok, sz: "" }, { ...ok, side: "maker" }, { ...ok, ts: "-1" }, null];
  assertEquals(parseOkxTrades([...bad, ok], "USDG-EUR").dropped, bad.length);
});

Deno.test("parseOkxBook keeps the best five levels a side and the touch; an empty side is null", () => {
  const lv = (p: number, n: number) => Array.from({ length: n }, (_, i) => [String(p + i * 0.0001), "100", "0", "1"]);
  const b = parseOkxBook([{ asks: lv(0.8958, 7), bids: lv(0.8948, 7).map((l, i) => [String(0.8948 - i * 0.0001), ...l.slice(1)]), ts: "1" }])!;
  assertEquals([b.bid, b.ask, b.bids.length, b.asks.length, b.bid_size], [0.8948, 0.8958, 5, 5, 100]);
  assertEquals(parseOkxBook([{ asks: [], bids: lv(0.8948, 1) }]), null);
});

const P = (id: number): OkxPrint => ({ book: "EURC-USDC", trade_id: id, ts: 1_000_000 + id, price: 1.118, size: 1, side: "buy" });
const page = (hi: number, lo: number) => Array.from({ length: hi - lo + 1 }, (_, i) => P(hi - i));

Deno.test("stepOkxCursor: the first page starts the record; a page reaching what is stored completes it; a gap is a hole", () => {
  const a = stepOkxCursor(null, page(110, 101), true, 50_000);
  assertEquals(a.cur, { from: 101, hi: 110, top: 110, topAt: 50_000, hole: null, coveredTo: 50_000 - OKX_COVER_MARGIN_MS });
  const b = stepOkxCursor(a.cur, page(115, 106), true, 110_000);
  assertEquals([b.store.map((p) => p.trade_id), b.cur.top, b.cur.coveredTo, b.next], [[115, 114, 113, 112, 111], 115, 110_000 - OKX_COVER_MARGIN_MS, null]);
  // A gap: the newest page starts above 116; its oldest is the hole's `after`, coverage stays.
  const c = stepOkxCursor(b.cur, page(130, 121), true, 170_000);
  assertEquals([c.cur.hole, c.cur.coveredTo, c.next], [{ after: 121 }, b.cur.coveredTo, 121]);
  const d = stepOkxCursor(c.cur, page(120, 111), false, 171_000);
  assertEquals([d.store.map((p) => p.trade_id), d.cur.hole, d.cur.hi, d.cur.coveredTo], [[120, 119, 118, 117, 116], null, 130, 170_000 - OKX_COVER_MARGIN_MS]);
  // Before any print: an empty first page waits for one.
  assertEquals(stepOkxCursor(null, [], true, 5).cur.top, 0);
});

function fakeOkx(n: Record<OkxBook, number>) {
  const urls: string[] = [];
  const base = 7_000_000;
  const f = (async (u: string | URL | Request) => {
    const url = String(u);
    urls.push(url);
    const q = new URL(url);
    const book = q.searchParams.get("instId") as OkxBook;
    if (q.pathname === "/api/v5/market/books") {
      return new Response(JSON.stringify({ code: "0", msg: "", data: [{ asks: [["1.119", "500", "0", "2"]], bids: [["1.117", "400", "0", "1"]], ts: "1" }] }));
    }
    const limit = Number(q.searchParams.get("limit")), after = q.searchParams.get("after");
    const newest = base + n[book] - 1;
    const hi = after ? Number(after) - 1 : newest;
    const data = [];
    for (let id = hi; id >= base && data.length < limit; id--) data.push({ instId: book, tradeId: String(id), px: "1.118", sz: "2", side: id % 2 ? "buy" : "sell", ts: String(Date.UTC(2026, 9, 27) + (id - base) * 1000), source: "0" });
    return new Response(JSON.stringify({ code: "0", msg: "", data }));
  }) as typeof fetch;
  return { f, urls };
}

Deno.test("runOkxRec stores every print once with no gap across a burst it pages back over two minutes, and reads only OKX's public host", async () => {
  const now0 = Date.UTC(2026, 9, 27, 6, 0);
  const { db } = memDb({ okx_rec_state: [{ id: 1, state: {} } as Row], okx_trades: [], okx_books: [] }, { now: () => now0 });
  const n: Record<OkxBook, number> = { "USDG-EUR": 800, "EURC-USDC": 10 };
  const okx = fakeOkx(n);
  const r1 = await runOkxRec({ db, now: now0, fetchImpl: okx.f, clock: () => now0 });
  assertEquals([r1.errors, r1.reached], [[], true]);
  const ids = async (b: string) => (await db.selectAll<{ trade_id: number }>("okx_trades", `book=eq.${b}&select=trade_id&order=book.asc,trade_id.asc`)).map((r) => Number(r.trade_id));
  assertEquals((await ids("USDG-EUR")).length, OKX_PAGE);
  // A burst of 1,200 on USDG-EUR: the newest page (500), then five history pages of 100 at most, so a hole stays.
  n["USDG-EUR"] += 1_200;
  const r2 = await runOkxRec({ db, now: now0 + 60e3, fetchImpl: okx.f, clock: () => now0 + 60e3 });
  assertEquals(r2.books["USDG-EUR"]!.pages, OKX_PAGES_MAX);
  assert(r2.books["USDG-EUR"]!.hole);
  assertEquals(r2.state.cursors!["USDG-EUR"]!.coveredTo, r1.state.cursors!["USDG-EUR"]!.coveredTo);
  const r3 = await runOkxRec({ db, now: now0 + 120e3, fetchImpl: okx.f, clock: () => now0 + 120e3 });
  const r4 = await runOkxRec({ db, now: now0 + 180e3, fetchImpl: okx.f, clock: () => now0 + 180e3 });
  assert(!r3.books["USDG-EUR"]!.hole || !r4.books["USDG-EUR"]!.hole);
  const got = await ids("USDG-EUR");
  const first = 7_000_000 + 800 - OKX_PAGE;
  assertEquals(got, Array.from({ length: 7_000_000 + 2000 - first }, (_, i) => first + i));
  assertEquals(r4.state.cursors!["USDG-EUR"]!.coveredTo, now0 + 180e3 - OKX_COVER_MARGIN_MS);
  assertEquals((await ids("EURC-USDC")).length, 10);
  // A book row each book each minute; only OKX's public market-data paths were asked, the history one only into the hole.
  assertEquals((await db.select("okx_books", "select=book,ts&order=book.asc,ts.asc")).length, 8);
  assert(okx.urls.every((u) => u.startsWith(`${OKX_API}/api/v5/market/`)));
  assert(okx.urls.some((u) => u.includes(`/history-trades?instId=USDG-EUR&type=1&after=`) && u.endsWith(`&limit=${OKX_HISTORY_PAGE}`)));
  // The aggressor is the taker's side, as served.
  const [one] = await db.select<{ side: string }>("okx_trades", "book=eq.EURC-USDC&trade_id=eq.7000001&select=side");
  assertEquals(one.side, "buy");
  assertEquals([...OKX_BOOKS], ["USDG-EUR", "EURC-USDC"]);
});

Deno.test("runOkxRec names a book it cannot read and goes on with the other; a fault is reported once, not every minute", async () => {
  const now0 = Date.UTC(2026, 9, 27, 7, 0);
  const { db } = memDb({ okx_rec_state: [{ id: 1, state: {} } as Row], okx_trades: [], okx_books: [] }, { now: () => now0 });
  const okx = fakeOkx({ "USDG-EUR": 3, "EURC-USDC": 3 });
  const f = ((u: string | URL | Request, i?: RequestInit) => String(u).includes("EURC-USDC") ? Promise.resolve(new Response("busy", { status: 429 })) : okx.f(u, i)) as typeof fetch;
  const r = await runOkxRec({ db, now: now0, fetchImpl: f, clock: () => now0 });
  assertEquals(r.errors, ["EURC-USDC book: 429 busy", "EURC-USDC prints: 429 busy"]);
  assert(r.report && r.reached);
  assertEquals(Object.keys(r.state.cursors!), ["USDG-EUR"]);
  const again = await runOkxRec({ db, now: now0 + 60e3, fetchImpl: f, clock: () => now0 + 60e3 });
  assertEquals(again.report, false);
});
