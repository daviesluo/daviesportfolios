// Pin the pure helpers exported by sftby-record/index.ts. The Deno.serve
// handler is wrapped in `if (import.meta.main)` so importing the module
// for tests doesn't bind a port.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bucketTimeIso, isSftbySessionOpen, pickSftbyCurrentPrice } from "./index.ts";

Deno.test("bucketTimeIso: rounds DOWN to the 5-min boundary", () => {
  // 2026-05-28T12:03:27Z → 2026-05-28T12:00:00.000Z
  const t = Date.UTC(2026, 4, 28, 12, 3, 27);
  assertEquals(bucketTimeIso(t), "2026-05-28T12:00:00.000Z");
});

Deno.test("bucketTimeIso: bucket boundary lands exactly on its own start", () => {
  const t = Date.UTC(2026, 4, 28, 12, 5, 0);
  assertEquals(bucketTimeIso(t), "2026-05-28T12:05:00.000Z");
});

Deno.test("isSftbySessionOpen: open inside UK 13:00-21:00 weekdays", () => {
  // 2026-05-28 is a Thursday. BST: UK 13:00 == UTC 12:00.
  assertEquals(isSftbySessionOpen(new Date(Date.UTC(2026, 4, 28, 12, 0, 0))), true);
  assertEquals(isSftbySessionOpen(new Date(Date.UTC(2026, 4, 28, 19, 55, 0))), true);
});

Deno.test("isSftbySessionOpen: closed exactly at 21:00 (hh < 21)", () => {
  assertEquals(isSftbySessionOpen(new Date(Date.UTC(2026, 4, 28, 20, 0, 0))), false);
});

Deno.test("isSftbySessionOpen: closed before 13:00 BST", () => {
  // UK 12:59 BST = UTC 11:59
  assertEquals(isSftbySessionOpen(new Date(Date.UTC(2026, 4, 28, 11, 59, 0))), false);
});

Deno.test("isSftbySessionOpen: closed on Saturday during the window", () => {
  // 2026-05-30 is a Saturday.
  assertEquals(isSftbySessionOpen(new Date(Date.UTC(2026, 4, 30, 14, 0, 0))), false);
});

Deno.test("pickSftbyCurrentPrice: flat-ticker shape", () => {
  const positions = [
    { ticker: "AAPL_US_EQ", currentPrice: 200 },
    { ticker: "SFTBY_US_EQ", currentPrice: 22.85 },
    { ticker: "GOOG_US_EQ", currentPrice: 250 },
  ];
  assertEquals(pickSftbyCurrentPrice(positions), 22.85);
});

Deno.test("pickSftbyCurrentPrice: nested-instrument shape", () => {
  const positions = [
    { instrument: { ticker: "SFTBY_US_EQ" }, currentPrice: 22.85 },
  ];
  assertEquals(pickSftbyCurrentPrice(positions), 22.85);
});

Deno.test("pickSftbyCurrentPrice: returns null when SFTBY missing", () => {
  const positions = [{ ticker: "AAPL_US_EQ", currentPrice: 200 }];
  assertEquals(pickSftbyCurrentPrice(positions), null);
});

Deno.test("pickSftbyCurrentPrice: rejects non-positive prices", () => {
  assertEquals(pickSftbyCurrentPrice([{ ticker: "SFTBY_US_EQ", currentPrice: 0 }]), null);
  assertEquals(pickSftbyCurrentPrice([{ ticker: "SFTBY_US_EQ", currentPrice: -1 }]), null);
  assertEquals(pickSftbyCurrentPrice([{ ticker: "SFTBY_US_EQ", currentPrice: "abc" }]), null);
});

Deno.test("pickSftbyCurrentPrice: handles non-array / empty / garbage input", () => {
  assertEquals(pickSftbyCurrentPrice(null), null);
  assertEquals(pickSftbyCurrentPrice([]), null);
  assertEquals(pickSftbyCurrentPrice([null, 42, "x"]), null);
});
