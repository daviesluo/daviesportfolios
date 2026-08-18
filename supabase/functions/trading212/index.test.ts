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

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  shapeT212Portfolio,
  shapeT212Order,
  shapeT212Transaction,
  flattenT212OrderItem,
  t212OrderItemRecognized,
  ordersPageShapeMismatch,
  nextHistoryKind,
  pickAccountTopUp,
  nextOrdersCursor,
  nextTransactionsCursor,
  transactionsPageUrl,
  T212_TRANSACTIONS_URL,
  ordersItemsOf,
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

// ---------------------------------------------------------------------
// Executed-fill history. The positions endpoint reports a POSITION with
// no dates, which is why the lot ledger has been guessing; these rows
// are the real purchase history.

Deno.test("shapeT212Order — a plain buy becomes a lot-shaped row", () => {
  const out = shapeT212Order({
    id: 123, fillId: 987, ticker: "AAPL_US_EQ", status: "FILLED",
    filledQuantity: 3, fillPrice: 210.5, fillCost: 631.5,
    dateExecuted: "2025-04-01T13:45:00.000+00:00",
  }, "invest");
  assertEquals(out?.id, "invest:987");
  assertEquals(out?.ticker, "AAPL");
  assertEquals(out?.t212_ticker, "AAPL_US_EQ");
  assertEquals(out?.side, "buy");
  assertEquals(out?.shares, 3);
  assertEquals(out?.price, 210.5);
  assertEquals(out?.executed_at, "2025-04-01T13:45:00.000Z");
});

Deno.test("shapeT212Order — a negative quantity is a sale, stored positive", () => {
  // T212 signs a sale's quantity negative; `side` carries the direction
  // so the ledger doesn't have to re-derive it from a sign.
  const out = shapeT212Order({
    fillId: 5, ticker: "VUAAl_EQ", status: "FILLED",
    filledQuantity: -2.5, fillPrice: 100, dateExecuted: "2025-06-01T08:00:00Z",
  }, "isa");
  assertEquals(out?.side, "sell");
  assertEquals(out?.shares, 2.5);
  assertEquals(out?.ticker, "VUAA.L");
  assertEquals(out?.id, "isa:5");
});

Deno.test("shapeT212Order — keys on the FILL, so a part-filled order keeps both halves", () => {
  const base = { id: 42, ticker: "AAPL_US_EQ", status: "FILLED", fillPrice: 10,
                 dateExecuted: "2025-01-01T00:00:00Z" };
  const a = shapeT212Order({ ...base, fillId: 1, filledQuantity: 4 }, "invest");
  const b = shapeT212Order({ ...base, fillId: 2, filledQuantity: 6 }, "invest");
  // Keying on the ORDER id would collapse these into one row and lose
  // six shares.
  assert(a!.id !== b!.id);
});

Deno.test("shapeT212Order — derives the price from cost when no fill price is given", () => {
  const out = shapeT212Order({
    fillId: 7, ticker: "AAPL_US_EQ", filledQuantity: 4, fillCost: 88,
    dateExecuted: "2025-01-01T00:00:00Z",
  }, "invest");
  assertEquals(out?.price, 22);
});

Deno.test("shapeT212Order — drops orders that never moved any money", () => {
  const base = { fillId: 1, ticker: "AAPL_US_EQ", filledQuantity: 1, fillPrice: 10,
                 dateExecuted: "2025-01-01T00:00:00Z" };
  assertEquals(shapeT212Order({ ...base, status: "CANCELLED" }, "invest"), null);
  assertEquals(shapeT212Order({ ...base, status: "REJECTED" }, "invest"), null);
  assertEquals(shapeT212Order({ ...base, filledQuantity: 0 }, "invest"), null);
  assertEquals(shapeT212Order({ ...base, fillPrice: 0, fillCost: 0 }, "invest"), null);
  assertEquals(shapeT212Order({ ...base, dateExecuted: "not a date", dateCreated: undefined }, "invest"), null);
  assertEquals(shapeT212Order({ ...base, ticker: "" }, "invest"), null);
  assertEquals(shapeT212Order(null, "invest"), null);
});

Deno.test("shapeT212Order — an unfamiliar status is kept, not silently dropped", () => {
  // A status field only rules a row OUT. Dropping every row of a shape
  // we don't recognise would produce an empty history rather than an
  // error anyone would notice.
  const out = shapeT212Order({
    fillId: 9, ticker: "AAPL_US_EQ", filledQuantity: 1, fillPrice: 10,
    dateExecuted: "2025-01-01T00:00:00Z",
  }, "invest");
  assert(out !== null);
});

Deno.test("shapeT212Order — an unmapped listing is stored with a null ticker", () => {
  // The broker symbol is kept either way, so a mapping that's wrong
  // today can be re-derived later without re-fetching the history.
  const out = shapeT212Order({
    fillId: 3, ticker: "ASML_NL_EQ", filledQuantity: 1, fillPrice: 600,
    dateExecuted: "2025-01-01T00:00:00Z",
  }, "invest");
  assertEquals(out?.ticker, null);
  assertEquals(out?.t212_ticker, "ASML_NL_EQ");
});

Deno.test("shapeT212Order — the published nested {fill, order} payload becomes a lot-shaped row", () => {
  // docs.trading212.com/api/historical-events/orders_1. The first
  // shaper expected a flat ticker/filledQuantity row; production sent
  // this envelope, every page parsed to 0, and the cursor still advanced.
  const out = shapeT212Order({
    fill: {
      id: 987,
      price: 210.5,
      quantity: 3,
      filledAt: "2025-04-01T13:45:00.000+00:00",
    },
    order: {
      id: 123,
      status: "FILLED",
      side: "BUY",
      ticker: "AAPL_US_EQ",
      instrument: { ticker: "AAPL_US_EQ" },
      filledQuantity: 3,
      filledValue: 631.5,
      createdAt: "2025-04-01T13:40:00.000+00:00",
    },
  }, "invest");
  assertEquals(out?.id, "invest:987");
  assertEquals(out?.ticker, "AAPL");
  assertEquals(out?.t212_ticker, "AAPL_US_EQ");
  assertEquals(out?.side, "buy");
  assertEquals(out?.shares, 3);
  assertEquals(out?.price, 210.5);
  assertEquals(out?.executed_at, "2025-04-01T13:45:00.000Z");
});

Deno.test("shapeT212Order — nested SELL with a positive fill quantity is still a sale", () => {
  const out = shapeT212Order({
    fill: { id: 5, price: 100, quantity: 2.5, filledAt: "2025-06-01T08:00:00Z" },
    order: {
      status: "FILLED", side: "SELL", ticker: "VUAAl_EQ",
      instrument: { ticker: "VUAAl_EQ" },
    },
  }, "isa");
  assertEquals(out?.side, "sell");
  assertEquals(out?.shares, 2.5);
  assertEquals(out?.ticker, "VUAA.L");
});

Deno.test("flattenT212OrderItem — a flat payload passes through unchanged", () => {
  const flat = { ticker: "AAPL_US_EQ", filledQuantity: 1, fillPrice: 10 };
  assertEquals(flattenT212OrderItem(flat)?.ticker, "AAPL_US_EQ");
  assertEquals(flattenT212OrderItem(null), null);
});

Deno.test("shapeT212Order — order-only (no fill) still becomes a lot-shaped row", () => {
  // ISA history pages arrived as `{ order: … }` with no fill. The
  // shaper treated that as unreadable, parsed 0 of 50, and froze the
  // cursor — cash history never started. Quantity, value and createdAt
  // live on the order; that's enough.
  const out = shapeT212Order({
    order: {
      id: 123,
      status: "FILLED",
      side: "BUY",
      ticker: "AAPL_US_EQ",
      instrument: { ticker: "AAPL_US_EQ" },
      quantity: 3,
      filledQuantity: 3,
      filledValue: 631.5,
      createdAt: "2025-04-01T13:40:00.000+00:00",
    },
  }, "isa");
  assertEquals(out?.ticker, "AAPL");
  assertEquals(out?.shares, 3);
  assertEquals(out?.price, 210.5);
  assertEquals(out?.side, "buy");
});

Deno.test("shapeT212Order — a cancelled order-only row is skipped, not a shape bug", () => {
  assertEquals(shapeT212Order({
    order: {
      status: "CANCELLED", ticker: "AAPL_US_EQ", quantity: 1,
      createdAt: "2025-04-01T13:40:00.000+00:00",
    },
  }, "isa"), null);
  assertEquals(t212OrderItemRecognized({
    order: { status: "CANCELLED", ticker: "AAPL_US_EQ" },
  }), true);
});

Deno.test("t212OrderItemRecognized — nested order, nested fill, flat ticker", () => {
  assertEquals(t212OrderItemRecognized({ order: { ticker: "AAPL_US_EQ" } }), true);
  assertEquals(t212OrderItemRecognized({ fill: { quantity: 1 }, order: {} }), true);
  assertEquals(t212OrderItemRecognized({ ticker: "AAPL_US_EQ", filledQuantity: 1 }), true);
  assertEquals(t212OrderItemRecognized({ foo: 1 }), false);
  assertEquals(t212OrderItemRecognized(null), false);
});

Deno.test("ordersPageShapeMismatch — a populated page that parsed to nothing must not advance", () => {
  // Advancing here is how the nested payload walked the history into
  // the void: fetched stayed 0, cursor became the next page anyway.
  assertEquals(ordersPageShapeMismatch(50, 0), true);
  assertEquals(ordersPageShapeMismatch(0, 0), false);
  assertEquals(ordersPageShapeMismatch(50, 3), false);
});

Deno.test("ordersPageShapeMismatch — recognised order-only skips must advance", () => {
  // ISA parked on a page of `{ order }` with no fill (cancelled /
  // never filled). All 50 recognised, 0 stored — that is not an
  // unknown envelope, and freezing it blocked transactions forever.
  assertEquals(ordersPageShapeMismatch(50, 0, 50), false);
  assertEquals(ordersPageShapeMismatch(50, 0, 49), true);
  assertEquals(ordersPageShapeMismatch(50, 2, 50), false);
});

Deno.test("nextHistoryKind — a finished account yields the slot while another is still walking", () => {
  // Invest orders are done; ISA is not. Invest must start cash history
  // rather than re-read page one of fills, and must not wait for ISA.
  assertEquals(nextHistoryKind(false, false, true), "orders");
  assertEquals(nextHistoryKind(true, false, true), "transactions");
  assertEquals(nextHistoryKind(true, true, true), "skip");
  assertEquals(nextHistoryKind(true, true, false), "topup");
});

Deno.test("pickAccountTopUp — the staler stream goes next", () => {
  assertEquals(pickAccountTopUp("2026-08-18T00:00:00Z", "2026-08-18T01:00:00Z"), "orders");
  assertEquals(pickAccountTopUp("2026-08-18T02:00:00Z", "2026-08-18T01:00:00Z"), "transactions");
});

Deno.test("nextOrdersCursor — pulls the cursor out of the path T212 returns", () => {
  assertEquals(
    nextOrdersCursor({ nextPagePath: "/api/v0/equity/history/orders?cursor=abc123&limit=50" }),
    "abc123",
  );
  assertEquals(nextOrdersCursor({ nextPagePath: { path: "/x?limit=50&cursor=z%2F9" } }), "z/9");
  // No next page is what latches the backfill complete.
  assertEquals(nextOrdersCursor({ items: [] }), null);
  assertEquals(nextOrdersCursor({ nextPagePath: "/x?limit=50" }), null);
  assertEquals(nextOrdersCursor(null), null);
});

Deno.test("ordersItemsOf — tolerates the envelope names wrappers use", () => {
  assertEquals(ordersItemsOf({ items: [1, 2] }), [1, 2]);
  assertEquals(ordersItemsOf({ data: [3] }), [3]);
  assertEquals(ordersItemsOf({ transactions: [6] }), [6]);
  assertEquals(ordersItemsOf([4, 5]), [4, 5]);
  assertEquals(ordersItemsOf({}), []);
  assertEquals(ordersItemsOf(null), []);
});

Deno.test("shapeT212Transaction — published deposit/withdraw rows round-trip", () => {
  const dep = shapeT212Transaction({
    amount: 1000, currency: "GBP", dateTime: "2025-04-01T12:00:00Z",
    reference: "dep-1", type: "DEPOSIT",
  }, "invest");
  assertEquals(dep?.id, "invest:dep-1");
  assertEquals(dep?.type, "deposit");
  assertEquals(dep?.amount, 1000);
  assertEquals(dep?.currency, "GBP");
  assertEquals(dep?.occurred_at, "2025-04-01T12:00:00.000Z");

  const wd = shapeT212Transaction({
    amount: 250, currency: "USD", dateTime: "2025-05-01T08:00:00Z",
    reference: "wd-1", type: "WITHDRAW",
  }, "isa");
  assertEquals(wd?.type, "withdraw");
  assertEquals(wd?.id, "isa:wd-1");
  assertEquals(wd?.amount, 250);
});

Deno.test("shapeT212Transaction — keeps fee/interest/transfer rather than dropping them", () => {
  // The deposit line ignores these, but dropping them at ingest would
  // mean a later reading has to re-walk the history.
  const fee = shapeT212Transaction({
    amount: 1.5, currency: "USD", dateTime: "2025-04-02T00:00:00Z",
    reference: "fee-1", type: "FEE",
  }, "invest");
  assertEquals(fee?.type, "fee");
  const interest = shapeT212Transaction({
    amount: 0.4, currency: "USD", dateTime: "2025-04-03T00:00:00Z",
    reference: "int-1", type: "INTEREST_ON_FREE_CASH",
  }, "invest");
  assertEquals(interest?.type, "interest_on_free_cash");
});

Deno.test("shapeT212Transaction — drops rows that never moved any money", () => {
  const base = { amount: 10, currency: "USD", dateTime: "2025-01-01T00:00:00Z", reference: "x", type: "DEPOSIT" };
  assertEquals(shapeT212Transaction({ ...base, amount: 0 }, "invest"), null);
  assertEquals(shapeT212Transaction({ ...base, type: "" }, "invest"), null);
  assertEquals(shapeT212Transaction({ ...base, dateTime: "not a date" }, "invest"), null);
  assertEquals(shapeT212Transaction(null, "invest"), null);
});

Deno.test("nextTransactionsCursor — keeps cursorId and time together", () => {
  const path = "/api/v0/equity/history/transactions?cursorId=abc&time=2025-01-01T00:00:00Z&limit=50";
  assertEquals(nextTransactionsCursor({ nextPagePath: path }), path);
  assertEquals(nextTransactionsCursor({ items: [] }), null);
});

Deno.test("transactionsPageUrl — full path passes through; a bare leftover cursor starts at page one", () => {
  const path = "/api/v0/equity/history/transactions?cursorId=abc&time=2025-01-01T00:00:00Z";
  assertEquals(transactionsPageUrl(path), `https://live.trading212.com${path}`);
  // The orders shaper stored only `cursor=`. Replaying that is the 400
  // "Both or none of cursorId and time must be provided".
  const first = transactionsPageUrl("tx99");
  assertEquals(first.startsWith(T212_TRANSACTIONS_URL), true);
  assertEquals(first.includes("cursor="), false);
  assertEquals(first.includes("cursorId="), false);
  assertEquals(transactionsPageUrl(null).includes("limit=50"), true);
});
