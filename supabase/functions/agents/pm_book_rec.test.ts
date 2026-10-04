// Pins for the Polymarket book recorder (pm_book_rec.ts): every pure helper on a book whose answer is worked out by hand,
// the frames as a reader decodes them, whole runs of both calls against fakes of the CLOB, the data API and Gamma on the
// shared in-memory database (held to 0092's keys, NOT NULLs, CHECKs, identity and generated phase), the lease, the time
// budget, the archive into a fake Storage, and that the recorder touches nothing but its own tables.
import { assert, assertAlmostEquals, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gunzipSync } from "node:zlib";
import {
  archivePath, bookLine, bookSummary, byteaBytes, byteaHex, concatBytes, dumpPath, faultKey, frameText, gammaRow, gzip, listingDiff, minuteQueries, newPrints, p4,
  phaseOf, planMinute, PM_REC_BOOKS_STALE_MS, PM_REC_FIELDS, PM_REC_LEASE_MS, PM_REC_MIN_RATE, PM_REC_OURS_SOURCES, PM_REC_PHASES, PM_REC_READS_UNTIL_MS,
  PM_REC_REPORT_EVERY_MS, PM_REC_SCALE, PM_REC_TABLES, type PmRecBookReply, type PmRecRow, type PmRecStorage, type PmRecTableRow, readFrames, reportDue, runPmRec,
  runPmRecMeta, s100, tapeRow, universeLine, windowLadder,
} from "./pm_book_rec.ts";
import { summarize } from "./pmrw.ts";
import { pmVenue } from "../_shared/polymarket_orders.ts";
import { memDb, onlyTables, type Row } from "./testing.ts";

const cond = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const CA = cond(0xa), CB = cond(0xb), CC = cond(0xc), CD = cond(0xd), CE = cond(0xe);
/** The first minute at or after 2026-10-04 18:00 UTC whose phase is `k`. */
const minuteOfPhase = (k: number) => { let m = Date.UTC(2026, 9, 4, 18, 0); while (phaseOf(m) !== k) m += 60e3; return m; };
const M0 = minuteOfPhase(0);

// A book as the CLOB served it on 2026-10-04 (bids low to high, asks high to low), with two levels that are not levels.
const bookA = (minute: number): PmRecBookReply => ({
  asset_id: "1001", timestamp: String(minute + 1234), hash: "h", tick_size: "0.01", min_order_size: "5", last_trade_price: "0.46", neg_risk: false,
  bids: [{ price: "0.0", size: "5" }, { price: "0.30", size: "500" }, { price: "0.34", size: "50" }, { price: "0.40", size: "0" }, { price: "0.44", size: "10" }, { price: "0.45", size: "100" }],
  asks: [{ price: "0.60", size: "1000" }, { price: "0.57", size: "30" }, { price: "0.48", size: "200" }, { price: "0.47", size: "20" }],
});

// --------------------------------------------------------------------------------------------------- the line

Deno.test("windowLadder keeps each side's levels within 10 ¢ of its best, best first, and only real levels", () => {
  const l = windowLadder(bookA(M0));
  // Bids: 0.45 is the best, so 0.35 is the floor; 0.34 and 0.30 fall outside, 0.0 and a size of 0 are not levels.
  assertEquals(l.bids, [[0.45, 100], [0.44, 10]]);
  // Asks: 0.47 is the best, so 0.57 is the ceiling, kept (inclusive); 0.60 falls outside.
  assertEquals(l.asks, [[0.47, 20], [0.48, 200], [0.57, 30]]);
  assertEquals([l.tick, l.ts, l.ltp, l.minOrder, l.allBids, l.allAsks], [0.01, M0 + 1234, 0.46, 5, 4, 4]);
  assertEquals(windowLadder({ asset_id: "x", bids: [], asks: [{ price: "0.5", size: "1" }] }).bids, []);
  assertEquals(windowLadder({ asset_id: "x" }), { tick: null, ts: null, ltp: null, minOrder: null, bids: [], asks: [], allBids: 0, allAsks: 0 });
});

Deno.test("bookSummary is RW's summarize of the ladder, with the depth within v of the size-cutoff midpoint worked out by hand", () => {
  const l = windowLadder(bookA(M0)), p = { v: 3, minSize: 50 };
  const s = bookSummary(l, p), row = summarize(l.bids, l.asks, 3, 50)!;
  assertEquals([s.bb, s.ba, s.ab, s.aa, s.q1, s.q2], [row[0], row[1], row[2], row[3], row[4], row[5]]);
  // By hand: the size-cutoff touch is 0.45 (100 ≥ 50) and 0.48 (200; 20 at 0.47 is under 50), so m = 0.465. A bid at
  // 0.45 is 1.5 ¢ from m: ((3 − 1.5) / 3)² × 100 = 25; an ask at 0.48 likewise × 200 = 50. 0.44 holds 10 < 50: no score.
  assertEquals([s.ab, s.aa], [0.45, 0.48]);
  assertAlmostEquals(s.q1!, 25, 1e-9);
  assertAlmostEquals(s.q2!, 50, 1e-9);
  // Within 3 ¢ of 0.465, any size: bids 0.45 (1.5 ¢) and 0.44 (2.5 ¢) = 110; asks 0.47 (0.5 ¢) and 0.48 (1.5 ¢) = 220.
  assertEquals([s.dvBid, s.dvAsk, s.d10Bid, s.d10Ask, s.nBid, s.nAsk], [110, 220, 110, 250, 2, 3]);
  // One-sided: no size-cutoff touch, no scores, no depth within v.
  const one = bookSummary({ bids: [[0.4, 10]], asks: [] }, p);
  assertEquals([one.bb, one.ba, one.ab, one.aa, one.q1, one.q2, one.dvBid, one.d10Bid], [0.4, null, null, null, null, null, null, 10]);
});

Deno.test("bookLine and universeLine: prices in 0.0001, sizes in hundredths, the book's time from the minute, field for field", () => {
  const l = windowLadder(bookA(M0));
  const b = bookLine(7, M0, l, { minSize: 50 });
  assertEquals(b, [7, 1234, 100, [4500, 4400], [10000, 1000], [4700, 4800, 5700], [2000, 20000, 3000], 4500, 4800, 0.46]);
  assertEquals(b.length, PM_REC_FIELDS.books.length);
  const s = bookSummary(l, { v: 3, minSize: 50 });
  const u = universeLine(7, M0, l, { rate: 12, v: 3, minSize: 50 }, { vol24h: 1234.567, liquidity: 99.999 });
  assertEquals(u, [7, 1234, 12, 3, 50, 100, 4500, 4700, 4500, 4800, s.q1, s.q2, 110, 220, 110, 250, 2, 3, 0.46, 5, 1234.57, 100]);
  assertEquals(u.length, PM_REC_FIELDS.universe.length);
  // Every tick Polymarket uses is whole in 0.0001; a size in hundredths survives binary floats.
  assertEquals([p4(0.0025), p4(0.001), p4(0.29), p4(0.005), s100(1234.56), s100(20376186), s100(0.01)], [25, 10, 2900, 50, 123456, 2037618600, 1]);
});

Deno.test("frames: a header naming the fields, a JSON line each, gzip'd, as a bytea in hex; an hour's members concatenated read back whole", async () => {
  const t1 = frameText({ v: 1, kind: "books", n: 1 }, [[1, 2, [3]]]), t2 = frameText({ v: 1, kind: "books", n: 0 }, []);
  assertEquals(t1, '{"v":1,"kind":"books","n":1}\n[1,2,[3]]\n');
  const [g1, g2] = [await gzip(t1), await gzip(t2)];
  assertEquals(byteaBytes(byteaHex(g1)), g1);
  assert(/^\\x([0-9a-f]{2})+$/.test(byteaHex(g1)));
  // node:zlib (and Python's gzip, and zcat) read every member of a concatenation; the archive's objects are exactly that.
  assertEquals(new TextDecoder().decode(gunzipSync(concatBytes([g1, g2]))), t1 + t2);
  assertThrows(() => byteaBytes("1f8b"), Error, "not a bytea in hex");
  assertThrows(() => byteaBytes("\\x1f8"), Error, "not a bytea in hex");
  assertThrows(() => byteaBytes("\\x1g"), Error, "not a bytea in hex");
  assertEquals(byteaBytes("\\x00FFa0"), new Uint8Array([0, 255, 160]));
});

Deno.test("readFrames: an hour's object back as its frames, each line named by its header's fields and scaled back to dollars and shares", async () => {
  // The scale names only fields its kind records.
  for (const k of Object.keys(PM_REC_SCALE) as Array<keyof typeof PM_REC_SCALE>) {
    for (const f of Object.keys(PM_REC_SCALE[k])) assert((PM_REC_FIELDS[k] as readonly string[]).includes(f), `${k}.${f}`);
  }
  const head = (kind: "books" | "prints", n: number) => ({ v: 1, kind, minute: new Date(M0).toISOString(), fields: PM_REC_FIELDS[kind], scale: PM_REC_SCALE[kind], n });
  const tiny = windowLadder({ asset_id: "x", bids: [{ price: "0.0025", size: "0.01" }] });
  const big = windowLadder({ asset_id: "y", tick_size: "0.001", asks: [{ price: "0.29", size: "20376186" }] });
  const books = frameText(head("books", 3), [bookLine(7, M0, windowLadder(bookA(M0)), { minSize: 50 }), bookLine(8, M0, tiny, { minSize: 0.01 }), bookLine(9, M0, big, { minSize: 5 })]);
  const prints = frameText(head("prints", 1), [[7, 1759600000, "SELL", 1, 0.53, 4.5]]);
  const dump = frameText({ v: 1, kind: "markets", day: "2026-10-04", n: 1 }, [{ id: 7, cond: CA, rate: 12 }]);
  // An hour's object is its frames' gzip members end to end; gunzipped whole, it reads as every frame it holds.
  const fr = readFrames(new TextDecoder().decode(gunzipSync(concatBytes([await gzip(books), await gzip(prints), await gzip(dump)]))));
  assertEquals(fr.map((f) => [f.header.kind, f.header.n, f.rows.length]), [["books", 3, 3], ["prints", 1, 1], ["markets", 1, 1]]);
  assertEquals(fr[0].rows[0], { id: 7, dt: 1234, tick: 0.01, bid_px: [0.45, 0.44], bid_sz: [100, 10], ask_px: [0.47, 0.48, 0.57], ask_sz: [20, 200, 30], ab: 0.45, aa: 0.48, ltp: 0.46 });
  // The smallest tick and size, and the largest size served, come back exactly; a side with no level is empty, its touch null.
  assertEquals(fr[0].rows[1], { id: 8, dt: null, tick: null, bid_px: [0.0025], bid_sz: [0.01], ask_px: [], ask_sz: [], ab: 0.0025, aa: null, ltp: null });
  assertEquals(fr[0].rows[2], { id: 9, dt: null, tick: 0.001, bid_px: [], bid_sz: [], ask_px: [0.29], ask_sz: [20376186], ab: null, aa: 0.29, ltp: null });
  // A print is recorded as served (no scale); the dump's markets are objects, returned as they are.
  assertEquals(fr[1].rows, [{ id: 7, ts: 1759600000, side: "SELL", oi: 1, price: 0.53, size: 4.5 }]);
  assertEquals(fr[2].rows, [{ id: 7, cond: CA, rate: 12 }]);
  assertThrows(() => readFrames("[1,2]\n"), Error, "a line before any header");
  assertEquals(readFrames(""), []);
});

// --------------------------------------------------------------------------------------------- the minute's markets

Deno.test("the universe's phase is the minute's index modulo 15, and the queries read the market's", () => {
  assertEquals(PM_REC_PHASES, 15);
  assertEquals([0, 1, 14, 15].map((k) => phaseOf(M0 + k * 60e3)), [0, 1, 14, 0]);
  assertEquals(phaseOf(M0 + 59_999), 0);
  // A market's phase is 0092's generated column, id % 15, from the same modulus: `src/cron_jobs.test.js` reads the
  // migration against this module (a run of this suite may read no file), and the double computes it the same way.
  assertEquals(minuteQueries(3, "2026-10-04T18:00:00.000Z"), {
    listed: "select=i:id,c:cond,y:yes,r:rate,v:max_spread,m:min_size,u:volume24hr,l:liquidity,o:ours_until&delisted_at=is.null&or=(rate.gte.10,phase.eq.3)&order=id.asc",
    ours: "select=i:id,c:cond,y:yes,r:rate,v:max_spread,m:min_size,u:volume24hr,l:liquidity,o:ours_until&ours_until=gt.2026-10-04T18%3A00%3A00.000Z&order=id.asc",
  });
});

const row = (i: number, c: string, y: string, r: number, extra: Partial<PmRecRow> = {}): PmRecRow => ({ i, c, y, r, v: 3, m: 50, u: null, l: null, o: null, ...extra });

Deno.test("planMinute: the held and quoted first, then the books set by rate; the fifteenth of the listed; caps count what they cut", () => {
  const listed = [row(30, CA, "a", 12), row(45, CB, "b", 2), row(15, CC, "c", 8), row(60, CE, "e", 1), row(31, cond(31), "f", 50), row(33, cond(33), "", 20)];
  const ours = [row(15, CC, "c", 8), row(90, CD, "d", 0)];    // C is listed too; D is not (delisted) but held
  const p = planMinute(listed, ours, 0);
  // Books: the two held or quoted (C, D: ours, by rate), then the listed at $10 or more by rate (31 at $50, A at $12); 33
  // has no YES token and is dropped everywhere.
  assertEquals(p.books.map((r) => r.i), [15, 90, 31, 30]);
  assertEquals(p.ours, 2);
  // The fifteenth: listed, id % 15 = 0 (30, 45, 15, 60, never 90), by rate.
  assertEquals(p.shard.map((r) => r.i), [30, 15, 45, 60]);
  assertEquals(p.cut, { books: 0, booksBelowRate: null, shard: 0, shardBelowRate: null });
  const capped = planMinute(listed, ours, 0, { books: 3, shard: 2 });
  assertEquals(capped.books.map((r) => r.i), [15, 90, 31]);
  assertEquals(capped.cut, { books: 1, booksBelowRate: 12, shard: 2, shardBelowRate: 2 });
  assertEquals(PM_REC_MIN_RATE, 10);
});

// ------------------------------------------------------------------------------------------------------- prints

const tape = (o: Partial<Record<string, unknown>>) => ({
  proxy_wallet: "0xw", side: "BUY", token_id: "1001", condition_id: CA, size: 10, price: 0.46, timestamp: 1_000, transaction_hash: "0xt", ...o,
});

Deno.test("newPrints takes what the last run did not have, of the books set only, oldest first, and moves the boundary to the newest second", () => {
  const rows = [
    tape({ transaction_hash: "0x1", timestamp: 1_000 }),                     // at the boundary, already had
    tape({ transaction_hash: "0x2", timestamp: 1_000, side: "SELL" }),        // at the boundary, new
    tape({ transaction_hash: "0x3", timestamp: 999 }),                       // before it
    tape({ transaction_hash: "0x4", timestamp: 1_005, token_id: "1002" }),    // the market's other token: oi 1
    tape({ transaction_hash: "0x5", timestamp: 1_005, condition_id: cond(0x99) }), // a market outside the books set
    tape({ transaction_hash: "0x4", timestamp: 1_005, token_id: "1002" }),    // the same print on two pages
  ].map(tapeRow).filter((x) => x !== null);
  const first = rows[0]!;
  const books = new Map([[CA, { id: 7, yes: "1001" }]]);
  const r = newPrints(rows, { ts: 1_000, keys: [first.key] }, 0, books);
  assertEquals(r.lines, [[7, 1_000, "SELL", 0, 0.46, 10], [7, 1_005, "BUY", 1, 0.46, 10]]);
  // The next boundary is the newest second read, of any market, and every print of it.
  assertEquals(r.next?.ts, 1_005);
  assertEquals(r.next?.keys.length, 2);
  // Run again on the same tape with that boundary: nothing new.
  assertEquals(newPrints(rows, r.next, 0, books).lines, []);
  // No boundary yet: a minute back.
  assertEquals(newPrints(rows, null, 1_001, books).lines, [[7, 1_005, "BUY", 1, 0.46, 10]]);
  assertEquals(tapeRow({ side: "X", timestamp: 1, price: 1, size: 1, condition_id: CA }), null);
});

// ------------------------------------------------------------------------------------------------------ reports

Deno.test("a fault is reported when it first appears or changes, then at most hourly; digits do not make a fault new", () => {
  const k1 = faultKey(["books: 503 at 18:01"]), k2 = faultKey(["books: 503 at 18:02"]);
  assertEquals(k1, k2);
  assert(reportDue(null, k1, 0));
  assert(!reportDue({ key: k1, at: 0 }, k2, PM_REC_REPORT_EVERY_MS - 1));
  assert(reportDue({ key: k1, at: 0 }, k2, PM_REC_REPORT_EVERY_MS));
  assert(reportDue({ key: k1, at: 0 }, faultKey(["prints: 429"]), 1));
  assert(!reportDue({ key: k1, at: 0 }, "", 1));
  assertEquals(archivePath("books", Date.UTC(2026, 9, 4, 7)), "books/2026-10-04/07.jsonl.gz");
  assertEquals(dumpPath(Date.UTC(2026, 9, 4)), "markets/2026-10-04.jsonl.gz");
});

// ----------------------------------------------------------------------------------------------------- the meta's

Deno.test("listingDiff: new markets, changed programmes grouped by what they become, a market listed again, and one the listing dropped", () => {
  const listing = new Map([
    [CA, { rate: 12, v: 3, minSize: 50 }], [CB, { rate: 3, v: 4.5, minSize: 20 }], [CC, { rate: 3, v: 4.5, minSize: 20 }], [CE, { rate: 1, v: 4.5, minSize: 20 }],
    [cond(0x77), { rate: 5, v: 3, minSize: 10 }],
  ]);
  const table: PmRecTableRow[] = [
    { id: 1, cond: CA, rate: "12", max_spread: "3", min_size: "50", delisted_at: null },     // unchanged
    { id: 2, cond: CB, rate: 2, max_spread: 4.5, min_size: 20, delisted_at: null },          // rate 2 → 3
    { id: 3, cond: CC, rate: 8, max_spread: 4.5, min_size: 20, delisted_at: null },          // rate 8 → 3: the same group
    { id: 4, cond: CD, rate: 50, max_spread: 3, min_size: 50, delisted_at: null },           // gone from the listing
    { id: 5, cond: CE, rate: 1, max_spread: 4.5, min_size: 20, delisted_at: "2026-10-03T00:00:00Z" }, // listed again
  ];
  const d = listingDiff(listing, table);
  assertEquals(d.newConds, [cond(0x77)]);
  assertEquals(d.changes, [
    { patch: { rate: 3, max_spread: 4.5, min_size: 20, relist: false }, ids: [2, 3] },
    { patch: { rate: 1, max_spread: 4.5, min_size: 20, relist: true }, ids: [5] },
  ]);
  assertEquals(d.delist, [4]);
});

Deno.test("gammaRow: Gamma's market as the table's metadata, its two tokens, Postgres-style times read, and nothing without them", () => {
  const g = gammaRow({
    conditionId: CA.toUpperCase().replace("0X", "0x"), clobTokenIds: '["1001","1002"]', question: "Q?", slug: "q", events: [{ slug: "ev" }], feeType: "politics_fees",
    negRisk: true, endDate: "2026-11-04T04:59:00Z", gameStartTime: "2026-10-05 03:05:00+00", volume24hr: 40.1, volumeNum: 1470.32, liquidityNum: 15040.8,
    competitive: 0.88, enableOrderBook: true, acceptingOrders: true, closed: false,
  }, Date.UTC(2026, 9, 4, 18));
  assertEquals(g, {
    cond: CA, yes: "1001", no: "1002", question: "Q?", slug: "q", event_slug: "ev", category: null, fee_type: "politics_fees", neg_risk: true,
    end_date: "2026-11-04T04:59:00.000Z", game_start: "2026-10-05T03:05:00.000Z", volume24hr: 40.1, volume: 1470.32, liquidity: 15040.8, competitive: 0.88,
    accepting: true, closed: false, gamma_at: "2026-10-04T18:00:00.000Z",
  });
  assertEquals(gammaRow({ conditionId: CA, clobTokenIds: '["1001"]' }, 0), null);
  assertEquals(gammaRow({ conditionId: "0x12", clobTokenIds: '["1","2"]' }, 0), null);
});

// ----------------------------------------------------------------------------------------- fakes of the venues

type Listed = { cond: string; yes: string; no: string; rate: number; v: number; minSize: number };
/** The CLOB, the data API and Gamma, as the recorder reads them: POST /books, the tape by cursor, the listing, the short list, keyset. */
function fakeVenue(o: { books: Map<string, PmRecBookReply>; tape?: Array<Record<string, unknown>>; tapePage?: number; listing?: Listed[]; failBooks?: number; shortListLacks?: Set<string> }) {
  const v = { posts: 0, tapeReads: 0, listingReads: 0, gammaReads: 0, simpleReads: 0, failBooks: o.failBooks ?? 0, tokensAsked: [] as string[] };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const gammaOf = (l: Listed) => ({
    conditionId: l.cond, clobTokenIds: JSON.stringify([l.yes, l.no]), question: `Q ${l.cond.slice(-2)}`, slug: "s", events: [{ slug: "e" }], feeType: "sports_fees",
    negRisk: false, endDate: "2026-12-01T00:00:00Z", volume24hr: 100, volumeNum: 1000, liquidityNum: 500, competitive: 0.5, enableOrderBook: true, acceptingOrders: true, closed: false,
  });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    if (u.host === "clob.polymarket.com" && u.pathname === "/books" && method === "POST") {
      v.posts++;
      if (v.failBooks > 0) { v.failBooks--; return new Response("upstream", { status: 503 }); }
      const asked = (JSON.parse(String(init?.body)) as Array<{ token_id: string }>).map((x) => x.token_id);
      v.tokensAsked.push(...asked);
      return json(asked.map((t) => o.books.get(t)).filter(Boolean));
    }
    if (u.host === "data-api.polymarket.com" && u.pathname === "/v2/trades" && method === "GET") {
      v.tapeReads++;
      assert(u.searchParams.get("_"), "every tape read carries its own millisecond");
      const all = o.tape ?? [], size = o.tapePage ?? 1000, at = Number(u.searchParams.get("cursor") ?? 0);
      const page = all.slice(at, at + size);
      return json({ data: page, pagination: { limit: size, offset: at, has_more: at + size < all.length, next_cursor: at + size < all.length ? String(at + size) : "" } });
    }
    if (u.host === "clob.polymarket.com" && u.pathname === "/rewards/markets/current") {
      v.listingReads++;
      const rows = u.searchParams.get("sponsored") === "true" ? [] : (o.listing ?? []).map((l) => ({
        condition_id: l.cond, rewards_max_spread: l.v, rewards_min_size: l.minSize, native_daily_rate: l.rate, total_daily_rate: l.rate,
      }));
      return json({ data: rows, next_cursor: "LTE=", limit: 500, count: rows.length });
    }
    if (u.host === "clob.polymarket.com" && u.pathname === "/sampling-simplified-markets") {
      v.simpleReads++;
      return json({ data: (o.listing ?? []).filter((l) => !o.shortListLacks?.has(l.cond)).map((l) => ({ condition_id: l.cond, tokens: [{ token_id: l.yes }, { token_id: l.no }] })), next_cursor: "LTE=" });
    }
    if (u.host === "gamma-api.polymarket.com" && u.pathname === "/markets/keyset") {
      v.gammaReads++;
      const want = new Set(u.searchParams.getAll("condition_ids"));
      return json({ markets: (o.listing ?? []).filter((l) => want.has(l.cond)).map(gammaOf) });
    }
    return new Response(`no such route: ${method} ${u.href}`, { status: 404 });
  }) as typeof fetch;
  return { v, fetchImpl };
}

/** A store in memory, Supabase Storage's double: an upload replaces, a sign answers every path it holds. */
function fakeStorage(o: { failUploads?: number; noBucket?: boolean } = {}) {
  const s = { objects: new Map<string, Uint8Array>(), uploads: 0, buckets: 0, failUploads: o.failUploads ?? 0, bucket: !o.noBucket };
  const storage: PmRecStorage = {
    upload: (path, bytes) => {
      s.uploads++;
      if (!s.bucket) return Promise.resolve({ ok: false, status: 400, error: '{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}' });
      if (s.failUploads > 0) { s.failUploads--; return Promise.resolve({ ok: false, status: 500, error: "upstream" }); }
      s.objects.set(path, bytes);
      return Promise.resolve({ ok: true, status: 200 });
    },
    sign: (paths) => Promise.resolve(new Map(paths.filter((p) => s.objects.has(p)).map((p) => [p, `https://sb.example/storage/v1/object/sign/pm-rec/${p}?token=t`]))),
    createBucket: () => { s.buckets++; s.bucket = true; return Promise.resolve({ ok: true, status: 200 }); },
  };
  return { s, storage };
}

const book = (token: string, bid: number, ask: number, minute: number): PmRecBookReply => ({
  asset_id: token, timestamp: String(minute - 5_000), tick_size: "0.01", min_order_size: "5", last_trade_price: String(bid),
  bids: [{ price: String(bid), size: "100" }], asks: [{ price: String(ask), size: "100" }],
});
/** The recorder's tables, seeded as Postgres would hold them: rows with their ids and phases, the two leases, the state rows. */
function world(markets: Row[], now: number, extra: Record<string, Row[]> = {}) {
  const seed: Record<string, Row[]> = {
    agent_locks: [{ name: "pm-rec", lease_until: "1970-01-01T00:00:00.000Z", holder: null }, { name: "pm-rec-meta", lease_until: "1970-01-01T00:00:00.000Z", holder: null }],
    pm_rec_state: [{ id: 1, state: {}, updated_at: new Date(now).toISOString() }, { id: 2, state: {}, updated_at: new Date(now).toISOString() }],
    pm_rec_markets: markets.map((m) => ({
      rate: 0, max_spread: 3, min_size: 50, delisted_at: null, ours_until: null, gamma_at: "1970-01-01T00:00:00.000Z", volume24hr: null, liquidity: null,
      first_seen: new Date(now).toISOString(), ...m, phase: Number(m.id) % 15,
    })),
    pm_rec_frames: [], pm_rec_archive: [], ...extra,
  };
  for (const s of PM_REC_OURS_SOURCES) seed[s.table] ??= [];
  return memDb(seed, { now: () => now });
}
/** A frame as a reader sees it: its header and its lines. */
const decode = (f: Row) => {
  const text = new TextDecoder().decode(gunzipSync(byteaBytes(String(f.data))));
  const [head, ...lines] = text.trimEnd().split("\n").map((l) => JSON.parse(l));
  return { head, lines: lines as unknown[][] };
};
/** The tables the recorder may touch: its own, its leases, and the Reward quotes paths' (read only). */
const allowed = [...PM_REC_TABLES, "agent_locks", ...PM_REC_OURS_SOURCES.map((s) => s.table)];

// The minute's world: A ≥ $10 listed; B and E in phase 0 under $10; C held or quoted (and listed, $8); D at $50 but
// delisted and not held: recorded nowhere.
const T0 = M0 + 500;
const MARKETS = [
  { id: 1003, cond: CA, yes: "1001", no: "1002", rate: 12, max_spread: 3, min_size: 50 },
  { id: 1005, cond: CB, yes: "2001", no: "2002", rate: 2, max_spread: 4.5, min_size: 20, volume24hr: 99.5, liquidity: 10 },
  { id: 1010, cond: CC, yes: "3001", no: "3002", rate: 8, ours_until: new Date(T0 + 600e3).toISOString() },
  { id: 1020, cond: CD, yes: "4001", no: "4002", rate: 50, delisted_at: "2026-10-03T00:00:00.000Z" },
  { id: 1035, cond: CE, yes: "5001", no: "5002", rate: 1 },
];
const BOOKS = new Map([["1001", bookA(M0)], ["2001", book("2001", 0.2, 0.25, M0)], ["3001", book("3001", 0.6, 0.62, M0)], ["4001", book("4001", 0.1, 0.9, M0)]]);
const TAPE = [   // newest first, as the data API serves it
  tape({ transaction_hash: "0xa3", timestamp: Math.floor(T0 / 1e3) - 2, condition_id: CA, token_id: "1002", side: "SELL", price: 0.53, size: 4 }),
  tape({ transaction_hash: "0xz1", timestamp: Math.floor(T0 / 1e3) - 3, condition_id: CD, token_id: "4001" }),
  tape({ transaction_hash: "0xc1", timestamp: Math.floor(T0 / 1e3) - 10, condition_id: CC, token_id: "3001", price: 0.61, size: 7 }),
  tape({ transaction_hash: "0xa1", timestamp: Math.floor(T0 / 1e3) - 30, condition_id: CA, token_id: "1001", price: 0.46, size: 12 }),
  tape({ transaction_hash: "0xold", timestamp: Math.floor(T0 / 1e3) - 90, condition_id: CA, token_id: "1001" }),
];

Deno.test("runPmRec: one minute, its three frames as a reader decodes them, the boundary of its prints, and its lease given back", async () => {
  const { db, tables } = world(MARKETS, T0);
  const f = fakeVenue({ books: BOOKS, tape: TAPE, tapePage: 2 });
  const guarded = onlyTables(db, allowed, {});
  const r = await runPmRec({ db: guarded, now: T0, holder: "h1", fetchImpl: f.fetchImpl, clock: () => T0 + 2_000 });
  assertEquals(r.errors, []);
  assertEquals([r.phase, r.books.set, r.books.ours, r.books.read, r.books.lines, r.universe.shard, r.universe.lines, r.books.requests], [0, 2, 1, 3, 2, 2, 1, 1]);
  // One POST of the four tokens: A and C (the books set), B and E (phase 0); E has no book, D is asked for by nobody.
  assertEquals(f.v.tokensAsked.sort(), ["1001", "2001", "3001", "5001"]);
  assertEquals(tables.pm_rec_frames.map((x) => x.kind).sort(), ["books", "prints", "universe"]);
  const fr = (k: string) => decode(tables.pm_rec_frames.find((x) => x.kind === k)!);
  const books = fr("books");
  assertEquals(books.head.fields, PM_REC_FIELDS.books);
  assertEquals([books.head.v, books.head.kind, books.head.minute, books.head.n], [1, "books", new Date(M0).toISOString(), 2]);
  assertEquals(books.lines.find((l) => l[0] === 1003), [1003, 1234, 100, [4500, 4400], [10000, 1000], [4700, 4800, 5700], [2000, 20000, 3000], 4500, 4800, 0.46]);
  assertEquals(books.lines.find((l) => l[0] === 1010), [1010, -5000, 100, [6000], [10000], [6200], [10000], 6000, 6200, 0.6]);
  // B by hand: the size-cutoff touch is its touch (100 ≥ 20 each side), m = 0.225, each level 2.5 ¢ from it inside
  // v = 4.5: ((4.5 − 2.5) / 4.5)² × 100 = 19.7530…, RW's four decimals 19.7531, on both sides.
  const uni = fr("universe");
  assertEquals(uni.lines, [[1005, -5000, 2, 4.5, 20, 100, 2000, 2500, 2000, 2500, 19.7531, 19.7531, 100, 100, 100, 100, 1, 1, 0.2, 5, 99.5, 10]]);
  // Each header carries its kind's scale, and the archive's reader turns the frame back into dollars and shares.
  assertEquals([books.head.scale, uni.head.scale], [PM_REC_SCALE.books, PM_REC_SCALE.universe]);
  const read = readFrames(new TextDecoder().decode(gunzipSync(byteaBytes(String(tables.pm_rec_frames.find((x) => x.kind === "universe")!.data)))));
  assertEquals(read[0].rows, [{
    id: 1005, dt: -5000, rate: 2, v: 4.5, min_size: 20, tick: 0.01, bb: 0.2, ba: 0.25, ab: 0.2, aa: 0.25, q1: 19.7531, q2: 19.7531,
    dv_bid: 100, dv_ask: 100, d10_bid: 100, d10_ask: 100, n_bid: 1, n_ask: 1, ltp: 0.2, min_order: 5, vol24h: 99.5, liquidity: 10,
  }]);
  // Prints: the books set's, within the minute back (no boundary yet), oldest first, the NO token's as oi 1; D's is not
  // recorded and the 90-s-old one is before the window. Two pages of two were enough to reach back past it.
  const prints = fr("prints");
  assertEquals(prints.lines, [
    [1003, Math.floor(T0 / 1e3) - 30, "BUY", 0, 0.46, 12], [1010, Math.floor(T0 / 1e3) - 10, "BUY", 0, 0.61, 7], [1003, Math.floor(T0 / 1e3) - 2, "SELL", 1, 0.53, 4],
  ]);
  assertEquals(f.v.tapeReads, 3);
  const st = tables.pm_rec_state.find((s) => s.id === 1)!;
  assertEquals((st.state as Row).prints, { ts: Math.floor(T0 / 1e3) - 2, keys: [tapeRow(TAPE[0])!.key] });
  assertEquals(st.last_minute, new Date(M0).toISOString());
  assertEquals(st.last_error, null);
  const lock = tables.agent_locks.find((l) => l.name === "pm-rec")!;
  assertEquals([lock.holder, lock.lease_until], [null, new Date(T0 + 2_000).toISOString()]);
  // It wrote only its own tables and read nothing else.
  assertEquals([...guarded.touched].sort(), ["agent_locks", "pm_rec_frames", "pm_rec_markets", "pm_rec_state"]);
});

Deno.test("runPmRec: a run that holds the lease keeps a second out; the second, in the same minute, replaces the frames and repeats no print", async () => {
  const { db, tables } = world(MARKETS, T0);
  const f = fakeVenue({ books: BOOKS, tape: TAPE });
  // Another run holds the lease into the minute: this one reads and writes nothing.
  tables.agent_locks.find((l) => l.name === "pm-rec")!.lease_until = new Date(T0 + PM_REC_LEASE_MS - 1_000).toISOString();
  tables.agent_locks.find((l) => l.name === "pm-rec")!.holder = "other";
  const clock = () => T0 + 1_000;
  const blocked = await runPmRec({ db, now: T0, holder: "h2", fetchImpl: f.fetchImpl, clock });
  assertEquals(blocked.skipped, "another run holds the pm-rec lease");
  assertEquals([f.v.posts, f.v.tapeReads, tables.pm_rec_frames.length], [0, 0, 0]);
  // Two runs at once: exactly one reads.
  tables.agent_locks.find((l) => l.name === "pm-rec")!.lease_until = "1970-01-01T00:00:00.000Z";
  const [a, b] = await Promise.all([runPmRec({ db, now: T0, holder: "x", fetchImpl: f.fetchImpl, clock }), runPmRec({ db, now: T0, holder: "y", fetchImpl: f.fetchImpl, clock })]);
  assertEquals([a.skipped ?? null, b.skipped ?? null].filter((s) => s !== null), ["another run holds the pm-rec lease"]);
  assertEquals(f.v.posts, 1);
  // A second run in the same minute (the watchdog's, once the first gave the lease back): the minute's three frames are
  // replaced, not added to, and its prints frame holds nothing the first had.
  const again = await runPmRec({ db, now: T0 + 13_000, holder: "z", fetchImpl: f.fetchImpl, clock: () => T0 + 14_000 });
  assertEquals(again.errors, []);
  assertEquals(tables.pm_rec_frames.length, 3);
  assertEquals(decode(tables.pm_rec_frames.find((x) => x.kind === "prints")!).lines, []);
});

Deno.test("runPmRec: past its deadline no read starts, and the minute is still recorded as read by nothing", async () => {
  const { db, tables } = world(MARKETS, T0);
  const f = fakeVenue({ books: BOOKS, tape: TAPE });
  const r = await runPmRec({ db, now: T0, holder: "h", fetchImpl: f.fetchImpl, clock: () => T0 + PM_REC_READS_UNTIL_MS + 1 });
  assertEquals([f.v.posts, f.v.tapeReads], [0, 0]);
  assertEquals([r.books.lines, r.universe.lines, r.prints.lines], [0, 0, 0]);
  const books = tables.pm_rec_frames.find((x) => x.kind === "books")!;
  assertEquals([books.n, (books.detail as Row).skipped, (books.detail as Row).set], [0, 4, 2]);
});

Deno.test("runPmRec: a POST of books that fails is tried once more, then skipped and said; the rest is recorded", async () => {
  const { db, tables } = world(MARKETS, T0);
  const retried = fakeVenue({ books: BOOKS, tape: TAPE, failBooks: 1 });
  const r1 = await runPmRec({ db, now: T0, holder: "h", fetchImpl: retried.fetchImpl, pause: () => Promise.resolve(), clock: () => T0 + 1_000 });
  assertEquals([r1.books.requests, r1.books.failed, r1.books.lines, r1.errors], [2, 0, 2, []]);
  const failing = fakeVenue({ books: BOOKS, tape: TAPE, failBooks: 2 });
  const r2 = await runPmRec({ db, now: T0 + 60e3, holder: "h", fetchImpl: failing.fetchImpl, pause: () => Promise.resolve(), clock: () => T0 + 61e3 });
  // A minute later the phase is 1, which none of these markets is in: the POST asks for A and C alone, and both are lost.
  assertEquals([r2.phase, r2.books.requests, r2.books.failed, r2.books.lines, r2.prints.complete], [1, 2, 2, 0, true]);
  assertEquals(r2.errors, ["books: 503 upstream"]);
  assert(r2.report);
  assertEquals(tables.pm_rec_frames.filter((x) => x.kind === "books").map((x) => x.n), [2, 0]);
});

Deno.test("runPmRec: with no market recorded yet it writes nothing, and a meta call silent past its limit is reported", async () => {
  const { db, tables } = world([], T0);
  const f = fakeVenue({ books: BOOKS, tape: TAPE });
  const r = await runPmRec({ db, now: T0, holder: "h", fetchImpl: f.fetchImpl, clock: () => T0 + 1_000 });
  assertEquals([r.skipped, r.errors, f.v.posts, tables.pm_rec_frames.length], ["no market recorded yet: the meta call fills pm_rec_markets from the reward listing", [], 0, 0]);
  tables.pm_rec_state.find((s) => s.id === 2)!.updated_at = new Date(T0 - 31 * 60e3).toISOString();
  const late = await runPmRec({ db, now: T0 + 60e3, holder: "h", fetchImpl: f.fetchImpl, clock: () => T0 + 61e3 });
  assertEquals(late.errors, [`the meta call has not finished a run since ${new Date(T0 - 31 * 60e3).toISOString()}`]);
  assert(late.report);
});

// ---------------------------------------------------------------------------------------------- the meta call

const LISTED: Listed[] = [
  { cond: CA, yes: "1001", no: "1002", rate: 12, v: 3, minSize: 50 },
  { cond: CB, yes: "2001", no: "2002", rate: 2, v: 4.5, minSize: 20 },
  { cond: CC, yes: "3001", no: "3002", rate: 8, v: 3, minSize: 50 },
];
const venueOf = (f: typeof fetch) => pmVenue({ sigType: 1, creds: null, address: null, timeoutMs: 5_000, sendsEnabled: false, fetchImpl: f });

Deno.test("runPmRecMeta: the first run fills the table from the listing and Gamma; a held market is named; the next archives each closed hour", async () => {
  const t1 = Date.UTC(2026, 9, 4, 18, 0, 1);
  const { db, tables } = world([], t1, { pm_live_minutes: [{ mode: "dry_run", minute: new Date(t1 - 60e3).toISOString(), cond: CC }] });
  const f = fakeVenue({ books: BOOKS, tape: [], listing: LISTED });
  const st = fakeStorage();
  const guarded = onlyTables(db, allowed, { readOnly: PM_REC_OURS_SOURCES.map((s) => s.table) });
  const r1 = await runPmRecMeta({ db: guarded, now: t1, holder: "m1", venue: venueOf(f.fetchImpl), storage: st.storage, clock: () => t1 + 3_000 });
  assertEquals(r1.errors, []);
  // C was held (mini-pool's minute) before the listing ran: added from Gamma first, as delisted; the listing then finds
  // it known and lists it again (a change), and adds A and B.
  assertEquals([r1.listing.read, r1.listing.added, r1.listing.changed, r1.listing.tokensBy, r1.ours.conds, r1.ours.ids, r1.ours.added], [true, 2, 1, "gamma", 1, 1, 1]);
  assertEquals(tables.pm_rec_markets.map((m) => [m.cond, m.yes, m.no, m.rate, m.max_spread, m.min_size, m.delisted_at, m.fee_type, Number(m.id) % 15 === m.phase]).sort(), [
    [CA, "1001", "1002", 12, 3, 50, null, "sports_fees", true], [CB, "2001", "2002", 2, 4.5, 20, null, "sports_fees", true], [CC, "3001", "3002", 8, 3, 50, null, "sports_fees", true],
  ]);
  const c = tables.pm_rec_markets.find((m) => m.cond === CC)!;
  assertEquals([c.ours_until, c.delisted_at], [new Date(t1 + 12 * 60e3).toISOString(), null]);
  assertEquals(r1.archive, []);                                    // a listing run archives nothing (its CPU is the run's)
  // A minute's frames in the 18:00 hour, then the meta call after 19:02: the hour is archived, kind by kind.
  const m1 = Date.UTC(2026, 9, 4, 18, 30);
  const fm = fakeVenue({ books: new Map([["1001", bookA(m1)], ["2001", book("2001", 0.2, 0.25, m1)], ["3001", book("3001", 0.6, 0.62, m1)]]), tape: [] });
  assertEquals((await runPmRec({ db, now: m1 + 500, holder: "x", fetchImpl: fm.fetchImpl, clock: () => m1 + 1_500 })).errors, []);
  const before = tables.pm_rec_frames.map((x) => ({ kind: x.kind, data: x.data }));
  const t2 = Date.UTC(2026, 9, 4, 19, 5);
  tables.pm_rec_state.find((s) => s.id === 2)!.state = { ...(tables.pm_rec_state.find((s) => s.id === 2)!.state as Row), listingAt: t2 };
  const r2 = await runPmRecMeta({ db: guarded, now: t2, holder: "m2", venue: venueOf(f.fetchImpl), storage: st.storage, clock: () => t2 + 1_000 });
  // Its one fault is the truth of this world: the minute call ran once, at 18:30, and the table has had markets since 18:00.
  assertEquals(r2.errors, ["the minute call has written no books frame since 2026-10-04T18:30:00.000Z"]);
  assertEquals(r2.archive.map((a) => [a.hour, a.kind, a.frames]), [
    ["2026-10-04T18:00:00.000Z", "books", 1], ["2026-10-04T18:00:00.000Z", "prints", 1], ["2026-10-04T18:00:00.000Z", "universe", 1],
  ]);
  // Each object is the frame's own gzip member, byte for byte, and its row names it, its size, its sha256 and a signed URL.
  for (const k of ["books", "prints", "universe"]) {
    const obj = st.s.objects.get(`${k}/2026-10-04/18.jsonl.gz`)!;
    assertEquals(obj, byteaBytes(String(before.find((x) => x.kind === k)!.data)));
    const a = tables.pm_rec_archive.find((x) => x.kind === k)!;
    assertEquals([a.path, a.bytes, a.frames, a.url_expires], [`${k}/2026-10-04/18.jsonl.gz`, obj.length, 1, new Date(t2 + 365 * 86400e3).toISOString()]);
    assertEquals(a.url, `https://sb.example/storage/v1/object/sign/pm-rec/${k}/2026-10-04/18.jsonl.gz?token=t`);
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", obj))].map((x) => x.toString(16).padStart(2, "0")).join("");
    assertEquals(a.sha256, digest);
  }
  // The frames keep their counts and lose their data.
  assertEquals(tables.pm_rec_frames.map((x) => [x.data, x.archived_at, x.lost]), [[null, new Date(t2).toISOString(), false], [null, new Date(t2).toISOString(), false], [null, new Date(t2).toISOString(), false]]);
  // The day's dump came on the same run: every market, a line each, read back whole.
  assertEquals(r2.dump?.rows, 3);
  const dump = new TextDecoder().decode(gunzipSync(st.s.objects.get("markets/2026-10-04.jsonl.gz")!)).trimEnd().split("\n");
  assertEquals([dump.length, JSON.parse(dump[1]).cond], [4, tables.pm_rec_markets[0].cond]);
  // Run again: nothing left to archive, the URLs not yet due.
  const r3 = await runPmRecMeta({ db: guarded, now: t2 + 300e3, holder: "m3", venue: venueOf(f.fetchImpl), storage: st.storage, clock: () => t2 + 301e3 });
  assertEquals([r3.archive, r3.resigned, r3.dump], [[], 0, null]);
  // It read the paths' tables and wrote only its own.
  assert(guarded.touched.has("pm_live_minutes"));
});

Deno.test("runPmRecMeta: an upload the store refuses leaves the frames as they were; a missing bucket is created and the upload made again", async () => {
  const t1 = Date.UTC(2026, 9, 4, 18, 30, 0, 500);
  const { db, tables } = world(MARKETS, t1);
  const fm = fakeVenue({ books: BOOKS, tape: TAPE });
  await runPmRec({ db, now: t1, holder: "x", fetchImpl: fm.fetchImpl, clock: () => t1 + 1_000 });
  const t2 = Date.UTC(2026, 9, 4, 19, 5);
  tables.pm_rec_state.find((s) => s.id === 2)!.state = { listingAt: t2, dumpDay: "2026-10-04" };
  const failing = fakeStorage({ failUploads: 99 });
  const r = await runPmRecMeta({ db, now: t2, holder: "m", venue: venueOf(fakeVenue({ books: BOOKS, listing: [] }).fetchImpl), storage: failing.storage, clock: () => t2 + 1_000 });
  assertEquals(r.archive, []);
  assert(r.errors[0].startsWith("archive: upload books/2026-10-04/18.jsonl.gz: 500"));
  assertEquals(tables.pm_rec_frames.every((x) => typeof x.data === "string" && x.archived_at === null), true);
  assertEquals(tables.pm_rec_archive, []);
  const fresh = fakeStorage({ noBucket: true });
  const again = await runPmRecMeta({ db, now: t2 + 300e3, holder: "m", venue: venueOf(fakeVenue({ books: BOOKS, listing: [] }).fetchImpl), storage: fresh.storage, clock: () => t2 + 301e3 });
  assertEquals([again.archive.length, fresh.s.buckets], [3, 1]);
  assertEquals(tables.pm_rec_frames.every((x) => x.data === null && x.archived_at !== null), true);
});

Deno.test("runPmRecMeta: past its limit with no books frame it says so, and not before the table has had markets that long", async () => {
  const t1 = Date.UTC(2026, 9, 4, 18, 0, 1);
  const { db, tables } = world(MARKETS, t1);
  const f = fakeVenue({ books: BOOKS, listing: LISTED });
  tables.pm_rec_state.find((s) => s.id === 2)!.state = { listingAt: t1, firstListingAt: t1 - PM_REC_BOOKS_STALE_MS + 60e3, dumpDay: "2026-10-04" };
  const early = await runPmRecMeta({ db, now: t1, holder: "m", venue: venueOf(f.fetchImpl), storage: fakeStorage().storage, clock: () => t1 });
  assertEquals(early.errors, []);
  tables.pm_rec_state.find((s) => s.id === 2)!.state = { listingAt: t1, firstListingAt: t1 - PM_REC_BOOKS_STALE_MS - 60e3, dumpDay: "2026-10-04" };
  const stale = await runPmRecMeta({ db, now: t1 + 1, holder: "m", venue: venueOf(f.fetchImpl), storage: fakeStorage().storage, clock: () => t1 + 1 });
  assertEquals(stale.errors, ["the minute call has written no books frame since it began"]);
  assert(stale.report);
});

Deno.test("runPmRecMeta: more new markets than Gamma is asked for take their tokens from the CLOB's short list; one it lacks is looked for at the next listing", async () => {
  const t1 = Date.UTC(2026, 9, 4, 18, 0, 1);
  const many: Listed[] = Array.from({ length: 300 }, (_, i) => ({ cond: cond(0x1000 + i), yes: String(10_000 + 2 * i), no: String(10_001 + 2 * i), rate: (i % 20) + 1, v: 3, minSize: 20 }));
  const { db, tables } = world([], t1);
  const f = fakeVenue({ books: new Map(), listing: many, shortListLacks: new Set(many.slice(-5).map((l) => l.cond)) });
  const r = await runPmRecMeta({ db, now: t1, holder: "m", venue: venueOf(f.fetchImpl), pm: { fetchImpl: f.fetchImpl }, storage: fakeStorage().storage, clock: () => t1 + 2_000 });
  assertEquals(r.errors, []);
  // Five listed markets the short list does not name: not added, and counted.
  assertEquals([r.listing.added, r.listing.noTokens, r.listing.tokensBy, f.v.simpleReads, tables.pm_rec_markets.length], [295, 5, "clob", 1, 295]);
  // Then Gamma's metadata, the 250 never read first (gamma_at 'epoch'), five reads of fifty.
  assertEquals([r.gamma.asked, r.gamma.found, f.v.gammaReads], [250, 250, 5]);
  assertEquals(tables.pm_rec_markets.filter((m) => m.gamma_at === "1970-01-01T00:00:00.000Z").length, 45);
  // The next listing, 15 minutes on: the five are new again, few enough to ask Gamma, which names their tokens.
  const t2 = t1 + 15 * 60e3;
  const r2 = await runPmRecMeta({ db, now: t2, holder: "m", venue: venueOf(f.fetchImpl), pm: { fetchImpl: f.fetchImpl }, storage: fakeStorage().storage, clock: () => t2 + 2_000 });
  assertEquals([r2.listing.added, r2.listing.noTokens, r2.listing.tokensBy, f.v.simpleReads, tables.pm_rec_markets.length], [5, 0, "gamma", 1, 300]);
  // No minute call runs in this world, and the table has had markets for 15 minutes: said.
  assertEquals(r2.errors, ["the minute call has written no books frame since it began"]);
});

Deno.test("the double holds the recorder's tables to 0092: no write names the identity or the phase, and an upsert names the key", async () => {
  const { db } = world([], T0);
  let refused = "";
  try { await db.upsert("pm_rec_markets", [{ cond: CA, yes: "1", no: "2", phase: 3 }], "cond"); } catch (e) { refused = String(e); }
  assert(refused.includes('cannot insert a non-DEFAULT value into column "phase"'));
  refused = "";
  try { await db.upsert("pm_rec_markets", [{ cond: CA, yes: "1", no: "2" }], "id"); } catch (e) { refused = String(e); }
  assert(refused.includes("no unique or exclusion constraint"));
  refused = "";
  try { await db.upsert("pm_rec_frames", [{ minute: "2026-10-04T18:00:00Z", kind: "book", n: 0, bytes: 0 }], "minute,kind"); } catch (e) { refused = String(e); }
  assert(refused.includes("pm_rec_frames_kind_check"));
  refused = "";
  try { await db.update("pm_rec_markets", "id=eq.1", { id: 2 }); } catch (e) { refused = String(e); }
  assert(refused.includes('column "id" can only be updated to DEFAULT'));
  // And a null compares to nothing, as SQL's: `ours_until=gt.<now>` does not match a market no path holds.
  await db.upsert("pm_rec_markets", [{ cond: CA, yes: "1", no: "2" }], "cond");
  assertEquals(await db.select("pm_rec_markets", "ours_until=gt.2026-10-04T18%3A00%3A00.000Z&select=id"), []);
});
