// Pin the pure helpers of overnight-fetch.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseTickers, groupRows } from "./index.ts";

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
