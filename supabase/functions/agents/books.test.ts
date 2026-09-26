// The stablecoin books' recorder (books.ts): the public book read as the venue serves it, best level first, a book
// stored only when it changed, and the public bucket (about a token a second) never asked for two books at once.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bookLevels, bookOrder, BOOK_SYMBOLS, BOOKS_BUDGET_MS, BOOKS_GAP_MS, BOOKS_START_MS, booksDelayMs, runBooks, sameBook } from "./books.ts";
import { memDb } from "./testing.ts";

// USDC-USD as the public endpoint served it on 2026-09-26 (levels trimmed), with the asks' order shuffled.
const served = (bid: string) => ({
  data: {
    asks: [{ price: "1.0002", quantity: "5000.45004", count: 1 }, { price: "1.0001", quantity: "2096.23035", count: 2 }],
    bids: [{ price: bid, quantity: "717.36349", count: 1 }, { price: "0.9998", quantity: "11496.9413", count: 2 }],
  },
  metadata: { region: "UK", timestamp: 1790445914507 },
});

/**
 * A venue on a fake clock: each request takes `latencyMs`, `status(book)` decides its answer, and it counts how many
 * requests are in flight at once and when each one started.
 */
function venue(t0: number, status: (book: string) => number = () => 200, latencyMs = 150) {
  let t = t0, inFlight = 0;
  const v = { bid: "0.9999", maxInFlight: 0, calls: [] as Array<{ book: string; at: number }>, pauses: [] as number[] };
  const clock = () => t;
  const pause = (ms: number) => { v.pauses.push(ms); t += ms; return Promise.resolve(); };
  const fetchImpl = (async (input: string | URL | Request) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const book = u.pathname.split("/").at(-1)!;
    if (u.host !== "revx.revolut.com" || u.searchParams.get("region") !== "UK") return new Response("wrong host", { status: 400 });
    v.calls.push({ book, at: t });
    inFlight++;
    v.maxInFlight = Math.max(v.maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 0));     // a real request yields: anything sent alongside it is in flight now
    t += latencyMs;
    inFlight--;
    const s = status(book);
    return new Response(s === 200 ? JSON.stringify(served(v.bid)) : "no", { status: s });
  }) as typeof fetch;
  return { v, clock, pause, fetchImpl, advance: (ms: number) => { t += ms; } };
}

Deno.test("bookLevels reads the public book best level first, with each level's orders", () => {
  assertEquals(bookLevels(served("0.9999")), {
    bids: [[0.9999, 717.36349, 1], [0.9998, 11496.9413, 2]],
    asks: [[1.0001, 2096.23035, 2], [1.0002, 5000.45004, 1]],
  });
  assertEquals(bookLevels({ data: { bids: "x" } }), null);
  assertEquals(bookLevels(null), null);
  assertEquals(sameBook(bookLevels(served("0.9999")), bookLevels(served("0.9999"))), true);
  assertEquals(sameBook(bookLevels(served("0.9999")), bookLevels(served("0.9997"))), false);
});

Deno.test("runBooks stores a book when it changes, extends the row while it stands still, and a book it cannot read skips alone", async () => {
  const { db, tables } = memDb({ agent_book_levels: [] }, { now: () => Date.now() });
  const t0 = Date.UTC(2026, 8, 27, 10, 0, 40);
  let down = "";
  const w = venue(t0, (b) => (b === down ? 503 : 200));
  const run = () => runBooks({ db, clock: w.clock, pause: w.pause, fetchImpl: w.fetchImpl });
  const r1 = await run();
  assertEquals([r1.recorded, r1.unchanged, r1.errors, r1.skipped], [4, 0, [], []]);
  w.advance(60e3);
  const r2 = await run();
  assertEquals([r2.recorded, r2.unchanged], [0, 4]);
  w.advance(60e3);
  w.v.bid = "0.9997"; down = "USDT-GBP";
  const r3 = await run();
  assertEquals([r3.recorded, r3.unchanged, r3.errors], [3, 0, ["USDT-GBP: 503"]]);
  assertEquals(tables.agent_book_levels.length, 7);
  // USDC-USD, by hand: 10:00 is a minute divisible by four, so it goes first (read at :40.000, answered at :40.150).
  // Run 2 starts where run 1 ended (:43.900) plus a minute; 10:01 turns the order by one, so USDC-USD goes fourth,
  // three gaps later: 10:01:47.650, answered at :47.800. Run 3 starts at 10:02:47.800 and reads it third: :50.450.
  const usdc = tables.agent_book_levels.filter((r) => r.book === "USDC-USD");
  assertEquals(usdc.map((r) => [r.ts, r.seen_until, r.reads]), [
    ["2026-09-27T10:00:40.150Z", "2026-09-27T10:01:47.800Z", 2],
    ["2026-09-27T10:02:50.450Z", "2026-09-27T10:02:50.450Z", 1],
  ]);
  // USDT-GBP could not be read at 10:02: its row still ends where it was last seen.
  assertEquals(tables.agent_book_levels.filter((r) => r.book === "USDT-GBP").map((r) => r.reads), [2]);
  assertEquals(BOOK_SYMBOLS.length, 4);
});

Deno.test("runBooks never asks for two books at once, and spaces its reads a little more than a token a second", async () => {
  // Pins the fix of 2026-09-26: the first version sent all four at :00 and lost three of them to 429 every minute.
  const { db } = memDb({ agent_book_levels: [] }, { now: () => Date.now() });
  const w = venue(Date.UTC(2026, 8, 27, 10, 3, 40));
  const r = await runBooks({ db, clock: w.clock, pause: w.pause, fetchImpl: w.fetchImpl });
  assertEquals(r.recorded, 4);
  assertEquals(w.v.maxInFlight, 1);
  assertEquals(w.v.calls.map((c) => c.book), bookOrder(Date.UTC(2026, 8, 27, 10, 3, 40)));
  const gaps = w.v.calls.slice(1).map((c, i) => c.at - w.v.calls[i].at);
  assertEquals(gaps, [BOOKS_GAP_MS, BOOKS_GAP_MS, BOOKS_GAP_MS]);
});

Deno.test("a 429 ends the minute's reads, and the next minute starts at another book", async () => {
  const { db, tables } = memDb({ agent_book_levels: [] }, { now: () => Date.now() });
  const t0 = Date.UTC(2026, 8, 27, 10, 0, 40);
  let busy = true;
  const w = venue(t0, () => (busy ? 429 : 200));
  const first = bookOrder(t0);
  const r1 = await runBooks({ db, clock: w.clock, pause: w.pause, fetchImpl: w.fetchImpl });
  assertEquals([r1.recorded, r1.errors, r1.skipped], [0, [`${first[0]}: 429`], first.slice(1)]);
  assertEquals(w.v.calls.length, 1);                    // nothing more was asked of the bucket that minute
  assertEquals(tables.agent_book_levels.length, 0);
  busy = false;
  w.advance(60e3);
  const r2 = await runBooks({ db, clock: w.clock, pause: w.pause, fetchImpl: w.fetchImpl });
  assertEquals(r2.recorded, 4);
  assertEquals(w.v.calls[1].book, first[1]);            // turned by one: the book after the refused one goes first
});

Deno.test("a slow venue stops the reads once the budget is spent, so a run ends inside its cron call", async () => {
  const { db } = memDb({ agent_book_levels: [] }, { now: () => Date.now() });
  const w = venue(Date.UTC(2026, 8, 27, 10, 5, 40), () => 200, 5_000);
  const r = await runBooks({ db, clock: w.clock, pause: w.pause, fetchImpl: w.fetchImpl });
  // Reads start at 0, 5 and 10 s; the fourth would start at 15 s, past the 12 s budget.
  assertEquals([r.recorded, r.skipped.length], [3, 1]);
  assertEquals(BOOKS_BUDGET_MS, 12e3);
});

Deno.test("the cron call waits until 40 s into the minute, and not at all past it", () => {
  const m = Date.UTC(2026, 8, 27, 10, 7);
  assertEquals(BOOKS_START_MS, 40e3);
  assertEquals(booksDelayMs(m), 40e3);
  assertEquals(booksDelayMs(m + 1_200), 38_800);
  assertEquals(booksDelayMs(m + 40e3), 0);
  assertEquals(booksDelayMs(m + 55e3), 0);
  // Each minute turns the order by one book, back to the start every four.
  assertEquals(bookOrder(m).length, 4);
  assertEquals(bookOrder(m + 60e3)[0], bookOrder(m)[1]);
  assertEquals(bookOrder(m + 4 * 60e3), bookOrder(m));
});
