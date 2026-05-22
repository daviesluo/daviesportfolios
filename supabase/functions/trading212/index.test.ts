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
  t212TickerToYahoo,
  unpackCache,
  mergeShaped,
  cacheIsFresh,
  basicAuthHeader,
  b64url,
  sign,
  verifyToken,
  constantTimeEqual,
} from "./index.ts";

Deno.test("mergeShaped — unions prices; passes through disjoint holdings (invest + ISA)", () => {
  const invest = {
    holdings: { "VUAA.L": { shares: 12, cost: 96 } },
    prices: { "VUAA.L": 98, "HOOD": 50 },
  };
  const isa = {
    holdings: {},
    prices: { "AAPL": 234, "TSLA": 412 },   // ISA stocks — only prices, no allow-list shares/cost
  };
  const out = mergeShaped(invest, isa);
  assertEquals(out.holdings, { "VUAA.L": { shares: 12, cost: 96 } });
  assertEquals(out.prices, { "VUAA.L": 98, "HOOD": 50, "AAPL": 234, "TSLA": 412 });
});

Deno.test("mergeShaped — a holding in BOTH accounts sums shares + weights cost", () => {
  const a = { holdings: { "VUAA.L": { shares: 10, cost: 100 } }, prices: { "VUAA.L": 110 } };
  const b = { holdings: { "VUAA.L": { shares: 30, cost: 120 } }, prices: { "VUAA.L": 110 } };
  const out = mergeShaped(a, b);
  // 40 shares; weighted cost = (10×100 + 30×120) / 40 = (1000+3600)/40 = 115.
  assertEquals(out.holdings["VUAA.L"].shares, 40);
  assertEquals(out.holdings["VUAA.L"].cost, 115);
  assertEquals(out.prices["VUAA.L"], 110);
});

Deno.test("mergeShaped — empty ISA side is a no-op (invest-only / ISA key absent)", () => {
  const invest = { holdings: { "VUAA.L": { shares: 5, cost: 90 } }, prices: { "VUAA.L": 92 } };
  const out = mergeShaped(invest, { holdings: {}, prices: {} });
  assertEquals(out, invest);
});

Deno.test("t212TickerToYahoo — allow-list, generic US, generic LSE, unknown", () => {
  assertEquals(t212TickerToYahoo("VUAAl_EQ"), "VUAA.L");   // allow-list
  assertEquals(t212TickerToYahoo("SAEMl_EQ"), "SAEM.L");   // allow-list
  assertEquals(t212TickerToYahoo("AAPL_US_EQ"), "AAPL");   // generic US
  assertEquals(t212TickerToYahoo("HOOD_US_EQ"), "HOOD");   // generic US
  assertEquals(t212TickerToYahoo("TSCOl_EQ"), "TSCO.L");   // generic LSE
  assertEquals(t212TickerToYahoo("SOMEd_DE_EQ"), null);    // other exchange → null
  assertEquals(t212TickerToYahoo(""), null);
});

Deno.test("t212TickerToYahoo — renamed / merged US tickers map to the CURRENT symbol", () => {
  // T212 keeps the pre-rename internal code forever, so the generic
  // `_US_EQ` rule would resolve these to the stale symbol (FB, YNDX, …)
  // which never matches the board → overnight price silently lost. The
  // alias table fixes the six the user actually holds.
  assertEquals(t212TickerToYahoo("FB_US_EQ"), "META");    // Facebook → Meta
  assertEquals(t212TickerToYahoo("YNDX_US_EQ"), "NBIS");  // Yandex → Nebius
  assertEquals(t212TickerToYahoo("IIVI_US_EQ"), "COHR");  // II-VI → Coherent
  assertEquals(t212TickerToYahoo("VACQ_US_EQ"), "RKLB");  // Vector Acq SPAC → Rocket Lab
  assertEquals(t212TickerToYahoo("LOKB_US_EQ"), "NVTS");  // Live Oak II SPAC → Navitas
  assertEquals(t212TickerToYahoo("GOOGL_US_EQ"), "GOOG"); // Alphabet class-A line → board's GOOG
});

Deno.test("shapeT212Portfolio — a renamed ticker surfaces its price under the CURRENT symbol", () => {
  // FB_US_EQ is Meta on T212; its currentPrice must land under META so
  // the board's META holding picks up the overnight quote.
  const raw = [
    { instrument: { ticker: "FB_US_EQ", name: "Meta Platforms Inc" }, quantity: 4, averagePricePaid: 300, currentPrice: 512.3 },
    { instrument: { ticker: "VACQ_US_EQ", name: "Rocket Lab" }, quantity: 100, averagePricePaid: 5, currentPrice: 22.7 },
  ];
  const { holdings, prices } = shapeT212Portfolio(raw);
  assertEquals(prices["META"], 512.3);
  assertEquals(prices["RKLB"], 22.7);
  // Renamed tickers are NOT in the shares/cost allow-list (price-only).
  assertEquals("META" in holdings, false);
  assertEquals("RKLB" in holdings, false);
});

Deno.test("shapeT212Portfolio — holdings = allow-list shares/cost (USD per share)", () => {
  // T212's averagePrice for VUAA.L / SAEM.L is USD per share — these
  // are USD-denominated UCITS ETFs on LSE and T212 reports in the
  // instrument's settle currency. cost is per-share AC everywhere
  // (metrics.js multiplies h.shares * h.cost for total cost).
  const raw = [
    { ticker: "VUAAl_EQ", quantity: 12.5, averagePrice: 96.00, currentPrice: 98 },
    { ticker: "SAEMl_EQ", quantity: 30,   averagePrice: 12.345, currentPrice: 13 },
  ];
  const { holdings } = shapeT212Portfolio(raw);
  assertEquals(holdings["VUAA.L"], { shares: 12.5, cost: 96.00 });
  assertEquals(holdings["SAEM.L"], { shares: 30, cost: 12.345 });
  // No `price` key on holdings — price lives in the separate map now.
  assertEquals("price" in holdings["VUAA.L"], false);
});

Deno.test("shapeT212Portfolio — prices = EVERY recognised holding's currentPrice (generic map)", () => {
  const raw = [
    { ticker: "VUAAl_EQ", quantity: 12.5, averagePrice: 96.00, currentPrice: 98.42 },
    { ticker: "AAPL_US_EQ", quantity: 3, averagePrice: 200, currentPrice: 234.5 },
    { ticker: "HOOD_US_EQ", quantity: 9, averagePrice: 30, currentPrice: 0 },   // non-positive → no price
  ];
  const { holdings, prices } = shapeT212Portfolio(raw);
  // Price map carries the allow-list ETF AND the US stock.
  assertEquals(prices["VUAA.L"], 98.42);
  assertEquals(prices["AAPL"], 234.5);
  assertEquals("HOOD" in prices, false);  // 0 currentPrice dropped
  // But holdings (shares/cost sync) is still allow-list only — AAPL is
  // priced but NOT shares/cost-synced.
  assertEquals(Object.keys(holdings), ["VUAA.L"]);
  assertEquals("AAPL" in holdings, false);
});

Deno.test("shapeT212Portfolio — non-positive quantity / averagePrice drop the allow-list holding (price may still surface)", () => {
  const raw = [
    { ticker: "VUAAl_EQ", quantity: 0,   averagePrice: 96, currentPrice: 98 },
    { ticker: "VUAAl_EQ", quantity: 10,  averagePrice: 0,  currentPrice: 98 },
  ];
  const { holdings, prices } = shapeT212Portfolio(raw);
  assertEquals(holdings, {});         // no valid shares/cost
  assertEquals(prices["VUAA.L"], 98); // price still recognised
});

Deno.test("shapeT212Portfolio — malformed input returns empty maps (not throws)", () => {
  assertEquals(shapeT212Portfolio(null), { holdings: {}, prices: {} });
  assertEquals(shapeT212Portfolio(undefined), { holdings: {}, prices: {} });
  assertEquals(shapeT212Portfolio({}), { holdings: {}, prices: {} });
  assertEquals(shapeT212Portfolio("nope"), { holdings: {}, prices: {} });
  assertEquals(shapeT212Portfolio([null, undefined, "x", 42]), { holdings: {}, prices: {} });
  assertEquals(shapeT212Portfolio([{ ticker: 42 }, { quantity: 5 }]), { holdings: {}, prices: {} });
});

Deno.test("shapeT212Portfolio — /equity/positions nested instrument shape (ticker + averagePricePaid)", () => {
  // The current endpoint nests the ticker under an `instrument` object
  // and names the cost field `averagePricePaid`; the old
  // `/equity/portfolio` used flat `ticker` + `averagePrice`. Both must
  // shape identically so the endpoint swap is invisible downstream.
  const raw = [
    {
      instrument: { ticker: "VUAAl_EQ", name: "Vanguard S&P 500 ETF", isin: "IE00BFMXXD54", currency: "USD" },
      quantity: 12.5, averagePricePaid: 96.0, currentPrice: 98.42,
    },
    {
      instrument: { ticker: "AAPL_US_EQ", name: "Apple Inc", isin: "US0378331005", currency: "USD" },
      quantity: 3, averagePricePaid: 200, currentPrice: 234.5,
    },
  ];
  const { holdings, prices } = shapeT212Portfolio(raw);
  // Allow-list ETF: shares/cost synced from quantity + averagePricePaid.
  assertEquals(holdings["VUAA.L"], { shares: 12.5, cost: 96.0 });
  // AAPL is priced (US-equity night-market quote) but NOT shares/cost-synced.
  assertEquals("AAPL" in holdings, false);
  assertEquals(prices["VUAA.L"], 98.42);
  assertEquals(prices["AAPL"], 234.5);
});

Deno.test("shapeT212Portfolio — instrument as a bare ticker string is also accepted", () => {
  // Defensive: a couple of community wrappers flatten `instrument` to the
  // bare ticker string rather than the documented object.
  const raw = [
    { instrument: "SAEMl_EQ", quantity: 30, averagePricePaid: 12.345, currentPrice: 13 },
  ];
  const { holdings, prices } = shapeT212Portfolio(raw);
  assertEquals(holdings["SAEM.L"], { shares: 30, cost: 12.345 });
  assertEquals(prices["SAEM.L"], 13);
});

Deno.test("shapeT212Portfolio — malformed nested instrument is skipped (not thrown)", () => {
  const raw = [
    { instrument: { ticker: 42 }, quantity: 5, averagePricePaid: 9 },   // non-string ticker
    { instrument: null, quantity: 5, averagePricePaid: 9 },             // null instrument
    { instrument: {}, quantity: 5, averagePricePaid: 9 },               // no ticker key
  ];
  assertEquals(shapeT212Portfolio(raw), { holdings: {}, prices: {} });
});

Deno.test("unpackCache — new {holdings, prices} shape passes through", () => {
  const data = { holdings: { "VUAA.L": { shares: 1, cost: 90 } }, prices: { "AAPL": 234 } };
  assertEquals(unpackCache(data), data);
});

Deno.test("unpackCache — legacy holdings-map shape is treated as holdings with empty prices", () => {
  // Pre-this-version cache rows stored the holdings map directly.
  const legacy = { "VUAA.L": { shares: 1, cost: 90 } };
  assertEquals(unpackCache(legacy), { holdings: legacy, prices: {} });
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

Deno.test("constantTimeEqual: identical / non-identical / length-mismatched", () => {
  assert(constantTimeEqual("abc", "abc"));
  assert(!constantTimeEqual("abc", "abd"));
  assert(!constantTimeEqual("abc", "abcd"));
});
