// Pin the pure helpers of overnight-fetch.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseTickers, groupRows, paginateRows } from "./index.ts";

Deno.test("parseTickers: splits, trims, dedupes, validates charset", () => {
  assertEquals(parseTickers("NVDA,AAPL, GOOG"), ["NVDA", "AAPL", "GOOG"]);
  assertEquals(parseTickers("NVDA,NVDA,NVDA"), ["NVDA"]);          // dedupe
  assertEquals(parseTickers("BRK-B,^GSPC"), ["BRK-B", "^GSPC"]);   // dash + caret ok
  assertEquals(parseTickers("AAPL,DROP TABLE,bad;x"), ["AAPL"]);   // garbage dropped
  assertEquals(parseTickers(""), []);
  assertEquals(parseTickers(null), []);
});

Deno.test("parseTickers: caps the list length", () => {
  const many = Array.from({ length: 250 }, (_, i) => `T${i}`).join(",");
  assertEquals(parseTickers(many).length, 100);
});

Deno.test("groupRows: groups by ticker, minute-truncates date, coerces NUMERIC string", () => {
  const rows = [
    { ticker: "AAPL", bucket_time: "2026-05-29T01:00:00.000Z", price: "200.5" },
    { ticker: "AAPL", bucket_time: "2026-05-29T01:05:00.000Z", price: 201 },
    { ticker: "NVDA", bucket_time: "2026-05-29T01:00:00.000Z", price: "175.25" },
  ];
  const out = groupRows(rows);
  assertEquals(out.AAPL, [
    { date: "2026-05-29T01:00", close: 200.5, volume: 0 },
    { date: "2026-05-29T01:05", close: 201, volume: 0 },
  ]);
  assertEquals(out.NVDA, [{ date: "2026-05-29T01:00", close: 175.25, volume: 0 }]);
});

Deno.test("groupRows: skips malformed rows / non-array", () => {
  assertEquals(groupRows([]), {});
  // @ts-expect-error testing runtime guard
  assertEquals(groupRows(null), {});
  const out = groupRows([
    { ticker: "AAPL", bucket_time: "2026-05-29T01:00:00.000Z", price: "nope" }, // NaN dropped
    { ticker: "AAPL", bucket_time: "2026-05-29T01:05:00.000Z", price: 201 },
  ]);
  assertEquals(out.AAPL, [{ date: "2026-05-29T01:05", close: 201, volume: 0 }]);
});

Deno.test("paginateRows: concatenates pages until a short page stops the loop", async () => {
  // Three pages: 1000, 1000, 600 — should stop after the third
  // (rows.length < pageSize) and return 2600 in order.
  const pages = [
    Array.from({ length: 1000 }, (_, i) => ({ i })),
    Array.from({ length: 1000 }, (_, i) => ({ i: 1000 + i })),
    Array.from({ length: 600 },  (_, i) => ({ i: 2000 + i })),
  ];
  /** @type {Array<{offset:number,limit:number}>} */
  const calls: Array<{ offset: number; limit: number }> = [];
  const out = await paginateRows<{ i: number }>(async (offset, limit) => {
    calls.push({ offset, limit });
    return pages[calls.length - 1] ?? [];
  });
  assertEquals(out.length, 2600);
  assertEquals(out[0].i, 0);
  assertEquals(out[2599].i, 2599);
  assertEquals(calls, [
    { offset: 0,    limit: 1000 },
    { offset: 1000, limit: 1000 },
    { offset: 2000, limit: 1000 },
  ]);
});

Deno.test("paginateRows: stops on an empty page", async () => {
  let calls = 0;
  const out = await paginateRows<{ k: number }>(async () => {
    calls++;
    return calls === 1 ? Array.from({ length: 1000 }, (_, i) => ({ k: i })) : [];
  });
  assertEquals(out.length, 1000);
  assertEquals(calls, 2);
});

Deno.test("paginateRows: hard maxPages cap prevents infinite loops", async () => {
  // pageFetcher always returns a full page → would loop forever
  // without a cap. With pageSize=10 / maxPages=3 we expect exactly
  // 30 rows back and 3 calls.
  let calls = 0;
  const out = await paginateRows<{ k: number }>(async () => {
    calls++;
    return Array.from({ length: 10 }, (_, i) => ({ k: i }));
  }, 10, 3);
  assertEquals(out.length, 30);
  assertEquals(calls, 3);
});

Deno.test("paginateRows: tolerates a non-array response (treats as end of pages)", async () => {
  const out = await paginateRows<{ k: number }>(async () => {
    // Cast: pretend the upstream sent us garbage (object instead of array).
    return ({ not: "an array" } as unknown) as { k: number }[];
  });
  assertEquals(out, []);
});
