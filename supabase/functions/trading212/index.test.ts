// Pin the pure helpers in `trading212/index.ts`. The `Deno.serve(...)`
// entrypoint is guarded by `if (import.meta.main)` so importing the
// module here doesn't bind a port.
//
//   - `shapeT212Portfolio` — ticker allow-list + per-row finiteness
//     guard + cost-is-per-share-AC contract.
//   - `cacheIsFresh` — TTL predicate independent of system clock.
//   - `basicAuthHeader` — T212's two-key HTTP Basic encoding.
//   - `sign` / `verifyToken` — HMAC-signed app-token gate. Duplicated
//     across functions (no shared modules in Supabase Edge Runtime);
//     pinned here so a refactor of `data/index.ts`'s copy doesn't
//     silently desync this one.

import { assert, assertEquals } from "https://deno.land/std@0.218.0/assert/mod.ts";
import {
  shapeT212Portfolio,
  cacheIsFresh,
  basicAuthHeader,
  b64url,
  sign,
  verifyToken,
} from "./index.ts";

Deno.test("shapeT212Portfolio — VUAGl_EQ / SEGMl_EQ map to Yahoo tickers; cost is per-share GBP", () => {
  // T212's averagePrice for VUAG.L / SEGM.L is GBP per share (NOT
  // pence) — these are GBP-denominated UCITS ETFs and T212 reports
  // in the instrument's settle currency. The Edge Function passes
  // averagePrice through unchanged; lot.cost / h.cost is per-share
  // AC everywhere in the app (metrics.js multiplies h.shares * h.cost
  // for total cost; weightedAvgCost does shares * cost).
  const raw = [
    { ticker: "VUAGl_EQ", quantity: 12.5, averagePrice: 96.00 },
    { ticker: "SEGMl_EQ", quantity: 30,   averagePrice: 12.345 },
  ];
  const out = shapeT212Portfolio(raw);
  assertEquals(out["VUAG.L"].shares, 12.5);
  assertEquals(out["VUAG.L"].cost, 96.00);
  assertEquals(out["SEGM.L"].shares, 30);
  assertEquals(out["SEGM.L"].cost, 12.345);
});

Deno.test("shapeT212Portfolio — non-allowlisted tickers are dropped", () => {
  const raw = [
    { ticker: "AAPL_US_EQ", quantity: 10, averagePrice: 150 },
    { ticker: "VUAGl_EQ", quantity: 5,    averagePrice: 90.00 },
  ];
  const out = shapeT212Portfolio(raw);
  assert(!("AAPL" in out));
  assert(!("AAPL_US_EQ" in out));
  assertEquals(Object.keys(out), ["VUAG.L"]);
});

Deno.test("shapeT212Portfolio — non-positive quantity / averagePrice are dropped", () => {
  const raw = [
    { ticker: "VUAGl_EQ", quantity: 0,   averagePrice: 96 },
    { ticker: "VUAGl_EQ", quantity: -1,  averagePrice: 96 },
    { ticker: "VUAGl_EQ", quantity: 10,  averagePrice: 0 },
    { ticker: "VUAGl_EQ", quantity: 10,  averagePrice: -50 },
    { ticker: "VUAGl_EQ", quantity: NaN, averagePrice: 96 },
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
  assert(cacheIsFresh(fiveSecAgo, now, 120_000));
});

Deno.test("cacheIsFresh — beyond TTL is stale", () => {
  const now = 1_700_000_000_000;
  const twoMinAgo = new Date(now - 130_000).toISOString();
  assert(!cacheIsFresh(twoMinAgo, now, 120_000));
});

Deno.test("cacheIsFresh — null / malformed timestamps are stale", () => {
  const now = 1_700_000_000_000;
  assert(!cacheIsFresh(null, now, 120_000));
  assert(!cacheIsFresh("not-a-date", now, 120_000));
  assert(!cacheIsFresh("", now, 120_000));
});

Deno.test("basicAuthHeader — base64(keyId:secret) with `Basic ` prefix", () => {
  // T212's HTTP Basic uses the API key id as username and the API
  // secret as password, joined with a single colon and base64-encoded.
  assertEquals(basicAuthHeader("user", "pass"), "Basic dXNlcjpwYXNz");
  assertEquals(
    basicAuthHeader("abc123", "secret-with-dashes"),
    "Basic " + btoa("abc123:secret-with-dashes"),
  );
});

Deno.test("verifyToken — admin token roundtrip with same secret", async () => {
  const secret = "t212-test-secret";
  const payload = b64url(JSON.stringify({ role: "admin", exp: Date.now() + 60_000 }));
  const signature = await sign(payload, secret);
  const v = await verifyToken(`${payload}.${signature}`, secret);
  assertEquals(v?.role, "admin");
});

Deno.test("verifyToken — ro token also accepted (RO viewers see synced holdings)", async () => {
  const secret = "t212-test-secret";
  const payload = b64url(JSON.stringify({ role: "ro", exp: Date.now() + 60_000 }));
  const signature = await sign(payload, secret);
  const v = await verifyToken(`${payload}.${signature}`, secret);
  assertEquals(v?.role, "ro");
});

Deno.test("verifyToken — rejects expired token", async () => {
  const secret = "t212-test-secret";
  const payload = b64url(JSON.stringify({ role: "admin", exp: Date.now() - 1 }));
  const signature = await sign(payload, secret);
  assertEquals(await verifyToken(`${payload}.${signature}`, secret), null);
});

Deno.test("verifyToken — rejects bad signature", async () => {
  const secret = "t212-test-secret";
  const payload = b64url(JSON.stringify({ role: "admin", exp: Date.now() + 60_000 }));
  const signature = await sign(payload, "different-secret");
  assertEquals(await verifyToken(`${payload}.${signature}`, secret), null);
});

Deno.test("verifyToken — rejects missing dot / empty / malformed", async () => {
  const secret = "t212-test-secret";
  assertEquals(await verifyToken("", secret), null);
  assertEquals(await verifyToken("no-dot", secret), null);
  assertEquals(await verifyToken(".sig-only", secret), null);
  assertEquals(await verifyToken("payload-only.", secret), null);
});
