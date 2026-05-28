// Pin the pure helpers exported by sftby-fetch/index.ts.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { londonDateIso, shapeResponse } from "./index.ts";

Deno.test("londonDateIso: BST summer → London-local YYYY-MM-DD", () => {
  // 2026-05-28T23:30:00Z falls on 2026-05-29 in London (BST = UTC+1)
  // because 23:30 UTC = 00:30 BST next day.
  assertEquals(londonDateIso(new Date(Date.UTC(2026, 4, 28, 23, 30, 0))), "2026-05-29");
  // Same UTC instant earlier in the day stays on 2026-05-28.
  assertEquals(londonDateIso(new Date(Date.UTC(2026, 4, 28, 12, 0, 0))), "2026-05-28");
});

Deno.test("londonDateIso: GMT winter → no offset effect mid-day", () => {
  // 2026-01-15 is in GMT (UK matches UTC).
  assertEquals(londonDateIso(new Date(Date.UTC(2026, 0, 15, 14, 0, 0))), "2026-01-15");
});

Deno.test("shapeResponse: splits today vs prior, picks last-prior as prevClose", () => {
  const now = new Date(Date.UTC(2026, 4, 28, 19, 0, 0)); // UK 20:00 BST Thu
  const rows = [
    { bucket_time: "2026-05-27T19:55:00.000Z", price: 24.72 }, // Wed close (prev)
    { bucket_time: "2026-05-28T12:00:00.000Z", price: 22.80 }, // today open
    { bucket_time: "2026-05-28T18:55:00.000Z", price: 22.85 }, // today late
  ];
  const out = shapeResponse(rows, now);
  assertEquals(out.series.length, 2);
  assertEquals(out.series[0].close, 22.80);
  assertEquals(out.series[1].close, 22.85);
  assertEquals(out.prevClose, 24.72);
  assertEquals(out.prevCloseDate, "2026-05-27");
});

Deno.test("shapeResponse: no prior data → prevClose is null", () => {
  const now = new Date(Date.UTC(2026, 4, 28, 19, 0, 0));
  const out = shapeResponse([
    { bucket_time: "2026-05-28T12:00:00.000Z", price: 22.80 },
  ], now);
  assertEquals(out.series.length, 1);
  assertEquals(out.prevClose, null);
  assertEquals(out.prevCloseDate, null);
});

Deno.test("shapeResponse: handles numeric-string price (PostgREST returns NUMERIC as string)", () => {
  const now = new Date(Date.UTC(2026, 4, 28, 19, 0, 0));
  const out = shapeResponse([
    { bucket_time: "2026-05-27T19:55:00.000Z", price: "24.72" },
    { bucket_time: "2026-05-28T12:00:00.000Z", price: "22.80" },
  ], now);
  assertEquals(out.series[0].close, 22.80);
  assertEquals(out.prevClose, 24.72);
});

Deno.test("shapeResponse: series is empty when only prior-day points exist", () => {
  const now = new Date(Date.UTC(2026, 4, 28, 19, 0, 0));
  const out = shapeResponse([
    { bucket_time: "2026-05-27T19:55:00.000Z", price: 24.72 },
  ], now);
  assertEquals(out.series, []);
  assertEquals(out.prevClose, 24.72);
});
