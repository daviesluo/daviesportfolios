// Pin the pure helpers in `trading212/index.ts`. The `Deno.serve(...)`
// entrypoint is guarded by `if (import.meta.main)` so importing the
// module here doesn't bind a port.
//
//   - `shapeT212Portfolio` — ticker allow-list + pence/GBX → GBP
//     normalization + the per-row finiteness guard.
//   - `cacheIsFresh` — TTL predicate independent of system clock.

import { assert, assertEquals } from "https://deno.land/std@0.218.0/assert/mod.ts";
import { shapeT212Portfolio, cacheIsFresh } from "./index.ts";

Deno.test("shapeT212Portfolio — VUAGl_EQ / SEGMl_EQ get mapped + pence-normalized; cost is per-share", () => {
  const raw = [
    { ticker: "VUAGl_EQ", quantity: 12.5, averagePrice: 9600 },   // 96.00 GBP per share
    { ticker: "SEGMl_EQ", quantity: 30,   averagePrice: 1234.5 }, // 12.345 GBP per share
  ];
  const out = shapeT212Portfolio(raw);
  assertEquals(out["VUAG.L"].shares, 12.5);
  // cost is PER-SHARE AC, not total — lot.cost / h.cost is the per-share
  // value the rest of the app multiplies by shares (see metrics.js
  // `h.shares * h.cost * fx` and lots.js `weightedAvgCost`'s shares*cost).
  assertEquals(out["VUAG.L"].cost, 96.00);
  assertEquals(out["SEGM.L"].shares, 30);
  assertEquals(out["SEGM.L"].cost, 12.345);
});

Deno.test("shapeT212Portfolio — non-allowlisted tickers are dropped", () => {
  const raw = [
    { ticker: "AAPL_US_EQ", quantity: 10, averagePrice: 150 },
    { ticker: "VUAGl_EQ", quantity: 5,    averagePrice: 9000 },
  ];
  const out = shapeT212Portfolio(raw);
  assert(!("AAPL" in out));
  assert(!("AAPL_US_EQ" in out));
  assertEquals(Object.keys(out), ["VUAG.L"]);
});

Deno.test("shapeT212Portfolio — non-positive quantity / averagePrice are dropped", () => {
  const raw = [
    { ticker: "VUAGl_EQ", quantity: 0,   averagePrice: 9600 },
    { ticker: "VUAGl_EQ", quantity: -1,  averagePrice: 9600 },
    { ticker: "VUAGl_EQ", quantity: 10,  averagePrice: 0 },
    { ticker: "VUAGl_EQ", quantity: 10,  averagePrice: -50 },
    { ticker: "VUAGl_EQ", quantity: NaN, averagePrice: 9600 },
  ];
  const out = shapeT212Portfolio(raw);
  assertEquals(out, {});
});

Deno.test("shapeT212Portfolio — malformed input returns empty map (not throws)", () => {
  assertEquals(shapeT212Portfolio(null), {});
  assertEquals(shapeT212Portfolio(undefined), {});
  assertEquals(shapeT212Portfolio({}), {});
  assertEquals(shapeT212Portfolio("nope"), {});
  assertEquals(shapeT212Portfolio([null, undefined, "x", 42]), {});
  assertEquals(shapeT212Portfolio([{ ticker: 42 }, { quantity: 5 }]), {});
});

Deno.test("cacheIsFresh — within TTL is fresh", () => {
  const now = 1_700_000_000_000;
  const fiveSecAgo = new Date(now - 5_000).toISOString();
  assert(cacheIsFresh(fiveSecAgo, now, 30_000));
});

Deno.test("cacheIsFresh — beyond TTL is stale", () => {
  const now = 1_700_000_000_000;
  const oneMinAgo = new Date(now - 60_000).toISOString();
  assert(!cacheIsFresh(oneMinAgo, now, 30_000));
});

Deno.test("cacheIsFresh — null / malformed timestamps are stale", () => {
  const now = 1_700_000_000_000;
  assert(!cacheIsFresh(null, now, 30_000));
  assert(!cacheIsFresh("not-a-date", now, 30_000));
  assert(!cacheIsFresh("", now, 30_000));
});
