// The stablecoin books' recorder (books.ts): the public book read as the venue serves it, best level first, and a book
// stored only when it changed.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bookLevels, BOOK_SYMBOLS, runBooks, sameBook } from "./books.ts";
import { memDb } from "./testing.ts";

// USDC-USD as the public endpoint served it on 2026-09-26 (levels trimmed), with the asks' order shuffled.
const served = (bid: string) => ({
  data: {
    asks: [{ price: "1.0002", quantity: "5000.45004", count: 1 }, { price: "1.0001", quantity: "2096.23035", count: 2 }],
    bids: [{ price: bid, quantity: "717.36349", count: 1 }, { price: "0.9998", quantity: "11496.9413", count: 2 }],
  },
  metadata: { region: "UK", timestamp: 1790445914507 },
});

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

Deno.test("runBooks stores a book the minute it changes and not while it stands still, and a book it cannot read skips alone", async () => {
  const { db, tables } = memDb({ agent_book_levels: [] }, { now: () => Date.now() });
  let bid = "0.9999", down = "";
  const fetchImpl = (async (input: string | URL | Request) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const b = u.pathname.split("/").at(-1)!;
    if (u.host !== "revx.revolut.com" || u.searchParams.get("region") !== "UK") return new Response("wrong host", { status: 400 });
    if (b === down) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify(served(bid)), { status: 200 });
  }) as typeof fetch;
  const t0 = Date.UTC(2026, 8, 27, 10, 0, 5);
  const r1 = await runBooks({ db, now: t0, fetchImpl });
  assertEquals([r1.recorded, r1.unchanged, r1.errors], [4, 0, []]);
  const r2 = await runBooks({ db, now: t0 + 60e3, fetchImpl });
  assertEquals([r2.recorded, r2.unchanged], [0, 4]);
  bid = "0.9997"; down = "USDT-GBP";
  const r3 = await runBooks({ db, now: t0 + 120e3, fetchImpl });
  assertEquals([r3.recorded, r3.unchanged, r3.errors.length], [3, 0, 1]);
  assertEquals(tables.agent_book_levels.length, 7);
  assertEquals(tables.agent_book_levels.filter((r) => r.book === "USDC-USD").map((r) => r.ts), ["2026-09-27T10:00:00.000Z", "2026-09-27T10:02:00.000Z"]);
  assertEquals(BOOK_SYMBOLS.length, 4);
});
