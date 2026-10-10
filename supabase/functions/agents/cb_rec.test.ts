// Coinbase's recorder (cb_rec.ts, 0112): Coinbase's public payloads read as served (a fixture recorded 2026-10-10), the
// aggressor flipped from the maker's side Coinbase serves, every print stored once by its trade id, the cursor that pages
// back to what it holds and keeps a burst it could not finish as a hole, coverage moving only when no id is missing, and
// the touch a row a minute. Nothing but GETs to Coinbase's public market-data host, and no credential.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import fixture from "../../../docs/agents/backtests/cbrec/fixture_2026-10-10.json" with { type: "json" };
import {
  CB_API, CB_COVER_MARGIN_MS, CB_PAGE, CB_PAGES_MAX, CB_PRODUCTS, type CbCursor, type CbPrint, type CbProduct, parseCbTouch, parseCbTrades, runCbRec, stepCursor,
} from "./cb_rec.ts";
import { memDb, type Row } from "./testing.ts";

const served = fixture.requests as Record<string, unknown>;

Deno.test("parseCbTrades reads Coinbase's page newest first and keeps the AGGRESSOR, the other side from the maker's it serves", () => {
  const raw = served["/products/USDC-GBP/trades?limit=5"] as Array<Record<string, unknown>>;
  const got = parseCbTrades(raw, "USDC-GBP")!;
  assertEquals(got.dropped, 0);
  assertEquals(got.prints.length, 5);
  for (let i = 1; i < got.prints.length; i++) assertEquals(got.prints[i].trade_id, got.prints[i - 1].trade_id - 1);
  const r = raw[0];
  assertEquals(got.prints[0], { product: "USDC-GBP", trade_id: r.trade_id, ts: r.time, price: Number(r.price), size: Number(r.size), side: r.side === "sell" ? "buy" : "sell" });
  // `after=N` serves the ids just below N, newest first: the page before the newest one.
  const back = parseCbTrades(served["/products/USDC-GBP/trades?limit=5&after=7319009"], "USDC-GBP")!.prints;
  assertEquals(back.map((p) => p.trade_id), [7319008, 7319007, 7319006, 7319005, 7319004]);
  // `before=N` serves the NEWEST page above N, not the one nearest it: the recorder never pages forward with it.
  const fwd = parseCbTrades(served["/products/USDC-GBP/trades?limit=5&before=7318909"], "USDC-GBP")!.prints;
  assert(fwd[0].trade_id >= 7319013, `${fwd[0].trade_id}`);
  // USDT-EUR's prices have five places.
  assert(parseCbTrades(served["/products/USDT-EUR/trades?limit=3"], "USDT-EUR")!.prints.every((p) => Math.round(p.price * 1e5) === p.price * 1e5));
});

Deno.test("parseCbTrades drops what it cannot store and counts it; a page that is not a list is null", () => {
  const ok = { trade_id: 5, side: "buy", size: "10.5", price: "0.758", time: "2026-10-10T00:00:00.000001Z" };
  const bad = [{ ...ok, trade_id: "5" }, { ...ok, trade_id: 0 }, { ...ok, price: "0" }, { ...ok, size: "" }, { ...ok, side: "maker" }, { ...ok, time: "never" }, null];
  const got = parseCbTrades([...bad, ok], "USDT-GBP")!;
  assertEquals(got.dropped, bad.length);
  assertEquals(got.prints, [{ product: "USDT-GBP", trade_id: 5, ts: ok.time, price: 0.758, size: 10.5, side: "sell" }]);
  assertEquals(parseCbTrades({ message: "NotFound" }, "USDC-GBP"), null);
});

Deno.test("parseCbTouch reads the best bid and ask of each book's level-1 book, as served", () => {
  for (const b of CB_PRODUCTS) {
    const raw = served[`/products/${b}/book?level=1`] as { bids: string[][]; asks: string[][] };
    const t = parseCbTouch(raw)!;
    assertEquals([t.bid, t.ask, t.bid_size, t.ask_size], [Number(raw.bids[0][0]), Number(raw.asks[0][0]), Number(raw.bids[0][1]), Number(raw.asks[0][1])]);
    assert(t.ask > t.bid);
  }
  assertEquals(parseCbTouch({ bids: [], asks: [["1", "2", 1]] }), null);
});

const P = (id: number, ms = 1_000_000 + id): CbPrint => ({ product: "USDC-GBP", trade_id: id, ts: new Date(ms).toISOString(), price: 0.7556, size: 1, side: "buy" });
const page = (hi: number, lo: number) => Array.from({ length: hi - lo + 1 }, (_, i) => P(hi - i));

Deno.test("stepCursor: the first page starts the record; a newest page reaching what is stored completes it to that instant", () => {
  const a = stepCursor(null, page(110, 101), true, 50_000);
  assertEquals(a.cur, { from: 101, fromTs: P(101).ts, hi: 110, top: 110, topAt: 50_000, hole: null, coveredTo: 50_000 - CB_COVER_MARGIN_MS });
  assertEquals(a.store.length, 10);
  // Five new prints, the page reaching back past the newest stored: only the new are stored, coverage to the new instant.
  const b = stepCursor(a.cur, page(115, 106), true, 110_000);
  assertEquals(b.store.map((p) => p.trade_id), [115, 114, 113, 112, 111]);
  assertEquals([b.cur.hi, b.cur.top, b.cur.hole, b.cur.coveredTo, b.next], [115, 115, null, 110_000 - CB_COVER_MARGIN_MS, null]);
  // Nothing new: coverage still moves.
  const c = stepCursor(b.cur, page(115, 106), true, 170_000);
  assertEquals([c.store.length, c.cur.coveredTo], [0, 170_000 - CB_COVER_MARGIN_MS]);
});

Deno.test("stepCursor: a burst past a page is a hole paged back by `after`, and coverage waits until it closes", () => {
  const cur: CbCursor = { from: 1, fromTs: P(1).ts, hi: 100, top: 100, topAt: 0, hole: null, coveredTo: 1_000 };
  // The newest page is 131..140: 101..130 are missing.
  const a = stepCursor(cur, page(140, 131), true, 60_000);
  assertEquals([a.cur.hi, a.cur.top, a.cur.hole, a.cur.coveredTo, a.next], [100, 140, { after: 131 }, 1_000, 131]);
  const b = stepCursor(a.cur, page(130, 121), false, 61_000);
  assertEquals([b.cur.hole, b.next, b.cur.coveredTo], [{ after: 121 }, 121, 1_000]);
  // A newest page read while a hole is open changes nothing: one hole at a time.
  assertEquals(stepCursor(b.cur, page(150, 141), true, 62_000), { store: [], cur: b.cur, next: null });
  // The page that reaches what was stored closes it: every id to `top` is held, coverage to when `top` was read.
  const c = stepCursor(b.cur, page(120, 96), false, 63_000);
  assertEquals(c.store.map((p) => p.trade_id), Array.from({ length: 20 }, (_, i) => 120 - i));
  assertEquals([c.cur.hi, c.cur.top, c.cur.hole, c.cur.coveredTo, c.next], [140, 140, null, 60_000 - CB_COVER_MARGIN_MS, null]);
});

/** A fake Coinbase: books of consecutive prints from `base`, `n` of them, served as the venue pages them; every request kept. */
function fakeCoinbase(n: Record<string, number>, base = 7_000_000) {
  const urls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    assertEquals(init?.method ?? "GET", "GET");
    assert(!new Headers(init?.headers).has("authorization"));
    const u = new URL(url);
    const m = /^\/products\/([A-Z]+-[A-Z]+)\/(trades|book)$/.exec(u.pathname)!;
    const book = m[1];
    if (m[2] === "book") return new Response(JSON.stringify(served[`/products/${book}/book?level=1`]), { status: 200 });
    const limit = Number(u.searchParams.get("limit")), after = u.searchParams.get("after");
    const newest = base + n[book] - 1;
    const hi = after ? Number(after) - 1 : newest;
    const rows = [];
    for (let id = hi; id >= base && rows.length < limit; id--) rows.push({ trade_id: id, side: id % 2 ? "buy" : "sell", size: "1.00", price: "0.75560000", time: new Date(Date.UTC(2026, 9, 10) + (id - base) * 1000).toISOString() });
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
  return { f, urls };
}

Deno.test("runCbRec stores every print once with no gap across a burst it pages back over two minutes, and reads only Coinbase's public host", async () => {
  const now0 = Date.UTC(2026, 9, 10, 1, 0);
  const { db } = memDb({ cb_rec_state: [{ id: 1, state: {} } as Row], cb_trades: [], cb_touch: [] }, { now: () => now0 });
  const n: Record<CbProduct, number> = { "USDC-GBP": 1500, "USDT-GBP": 10, "USDC-EUR": 10, "USDT-EUR": 10 };
  const cb = fakeCoinbase(n);
  const r1 = await runCbRec({ db, now: now0, fetchImpl: cb.f, clock: () => now0 });
  assertEquals([r1.errors, r1.reached], [[], true]);
  // The first minute stores the newest page alone: the record starts there.
  const ids = async (b: string) => (await db.selectAll<{ trade_id: number }>("cb_trades", `product=eq.${b}&select=trade_id&order=product.asc,trade_id.asc`)).map((r) => Number(r.trade_id));
  assertEquals((await ids("USDC-GBP")).length, CB_PAGE);
  // A burst of 6,500 on USDC-GBP before the next minute: more than its six pages. The next minute pages back as far as it
  // may, keeps the rest as a hole, and coverage stays; the one after closes it.
  n["USDC-GBP"] += 6_500;
  const r2 = await runCbRec({ db, now: now0 + 60e3, fetchImpl: cb.f, clock: () => now0 + 60e3 });
  assertEquals(r2.books["USDC-GBP"]!.pages, CB_PAGES_MAX);
  assert(r2.books["USDC-GBP"]!.hole);
  assertEquals(r2.state.cursors!["USDC-GBP"]!.coveredTo, r1.state.cursors!["USDC-GBP"]!.coveredTo);
  const r3 = await runCbRec({ db, now: now0 + 120e3, fetchImpl: cb.f, clock: () => now0 + 120e3 });
  assert(!r3.books["USDC-GBP"]!.hole);
  const got = await ids("USDC-GBP");
  const first = 7_000_000 + 1500 - CB_PAGE;
  assertEquals(got, Array.from({ length: 7_000_000 + 8000 - first }, (_, i) => first + i));
  // The hole closed, the same minute read the newest page again and found nothing new: coverage to that instant.
  assertEquals(r3.state.cursors!["USDC-GBP"]!.coveredTo, now0 + 120e3 - CB_COVER_MARGIN_MS);
  assertEquals((await ids("USDT-EUR")).length, 10);
  // A touch row each book each minute; only Coinbase's public host was asked.
  assertEquals((await db.select("cb_touch", "select=product,ts&order=product.asc,ts.asc")).length, 12);
  assert(cb.urls.every((u) => u.startsWith(`${CB_API}/products/`)));
  // The aggressor is the other side from the maker's served: an odd id was served "buy" (a maker bid hit by a seller).
  const [one] = await db.select<{ side: string }>("cb_trades", `product=eq.USDT-EUR&trade_id=eq.7000001&select=side`);
  assertEquals(one.side, "sell");
});

Deno.test("runCbRec names a book it cannot read and goes on with the rest; the state row keeps what was last reported", async () => {
  const now0 = Date.UTC(2026, 9, 10, 2, 0);
  const { db } = memDb({ cb_rec_state: [{ id: 1, state: {} } as Row], cb_trades: [], cb_touch: [] }, { now: () => now0 });
  const cb = fakeCoinbase({ "USDC-GBP": 3, "USDT-GBP": 3, "USDC-EUR": 3, "USDT-EUR": 3 });
  const f = ((u: string | URL | Request, i?: RequestInit) => String(u).includes("USDT-GBP") ? Promise.resolve(new Response("busy", { status: 429 })) : cb.f(u, i)) as typeof fetch;
  const r = await runCbRec({ db, now: now0, fetchImpl: f, clock: () => now0 });
  assertEquals(r.errors, ["USDT-GBP prints: 429 busy", "USDT-GBP touch: 429 busy"]);
  assert(r.report);
  assertEquals(Object.keys(r.state.cursors!).sort(), ["USDC-EUR", "USDC-GBP", "USDT-EUR"]);
  const [st] = await db.select<{ last_error: string; state: { fault?: unknown } }>("cb_rec_state", "id=eq.1&select=last_error,state");
  assertEquals(st.last_error, "USDT-GBP prints: 429 busy | USDT-GBP touch: 429 busy");
  assert(st.state.fault);
  // The same fault a minute later is not reported again.
  const again = await runCbRec({ db, now: now0 + 60e3, fetchImpl: f, clock: () => now0 + 60e3 });
  assertEquals(again.report, false);
});
