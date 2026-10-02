// Pin tests for the Revolut X client (`_shared/revx.ts`). The signing
// string is pinned against the reference's OWN example byte for byte, the
// key loader against every shape a private key gets pasted in, and the
// request builder against a stubbed fetch — nothing here touches the
// venue.
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  loadPrivateKey, orderViewProblem, privateKeyDer, publicCandles, publicTickers, quotesForRegion, REVX_BASE, REVX_REGION, revxFetch, revxVenue, signingMessage, signMessage, splitPath,
  toCandle, toOrderView, toPathSymbol, toSlashSymbol, type VenueOrder,
} from "../_shared/revx.ts";

Deno.test("signingMessage — the reference's literal example, byte for byte", () => {
  // revolut-x-api-for-llm.md, "Example message to sign".
  const body = '{"client_order_id":"3b364427-1f4f-4f66-9935-86b6fb115d26","symbol":"BTC-USD","side":"BUY","order_configuration":{"limit":{"base_size":"0.1","price":"90000.1"}}}';
  assertEquals(
    signingMessage(1765360896219, "post", "/api/1.0/orders", "", body),
    "1765360896219POST/api/1.0/orders" + body,
  );
  // The Python example: query string WITHOUT the "?", straight after the path.
  assertEquals(
    signingMessage(1765360896219, "GET", "/api/1.0/orders/active", "order_states=new,partially_filled&limit=10"),
    "1765360896219GET/api/1.0/orders/activeorder_states=new,partially_filled&limit=10",
  );
});

Deno.test("splitPath — the '?' is dropped from what gets signed, and only the first one splits", () => {
  assertEquals(splitPath("/api/1.0/balances"), { path: "/api/1.0/balances", query: "" });
  assertEquals(splitPath("/api/1.0/candles/BTC-USD?interval=240&since=1&until=2"),
    { path: "/api/1.0/candles/BTC-USD", query: "interval=240&since=1&until=2" });
});

Deno.test("symbols — dash on the way out, slash on the way back", () => {
  assertEquals(toPathSymbol("BTC/USD"), "BTC-USD");
  assertEquals(toSlashSymbol("BTC-USD"), "BTC/USD");
  assertEquals(toCandle({ start: 5, open: "1.5", high: "2", low: "1", close: "1.75", volume: "0.25" }),
    { start: 5, open: 1.5, high: 2, low: 1, close: 1.75, volume: 0.25 });
});

/** A fresh Ed25519 key, exported in every shape a person might paste into the secrets store. */
async function keyShapes() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  assertEquals(der.length, 48);
  const b64 = btoa(String.fromCharCode(...der));
  const seed = der.slice(16);
  const seedB64 = btoa(String.fromCharCode(...seed));
  const seedHex = [...seed].map((b) => b.toString(16).padStart(2, "0")).join("");
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { kp, der, pem, pemEscaped: pem.replace(/\n/g, "\\n"), b64, seedB64, seedHex };
}

Deno.test("privateKeyDer — PEM (real or escaped newlines), bare PKCS#8 base64, seed as base64 or hex → the same DER", async () => {
  const k = await keyShapes();
  for (const [form, text] of [["pem", k.pem], ["pem", k.pemEscaped], ["pkcs8-b64", k.b64], ["seed-b64", k.seedB64], ["seed-hex", k.seedHex]] as const) {
    const got = privateKeyDer(text);
    assertEquals(got.form, form);
    assertEquals(got.der, k.der);
  }
  // "not a key!" — the "!" puts it outside every accepted alphabet. ("not a key" minus its
  // spaces is valid base64 text and is rejected one step later, for its length.)
  assertThrows(() => privateKeyDer("not a key!"), Error, "not PEM, base64 or hex");
  assertThrows(() => privateKeyDer("not a key"), Error, "expected 48");
  assertThrows(() => privateKeyDer(btoa("too short")), Error, "expected 48");
});

Deno.test("loadPrivateKey + signMessage — a signature the matching public key verifies", async () => {
  const k = await keyShapes();
  const { key, form } = await loadPrivateKey(k.pemEscaped);
  assertEquals(form, "pem");
  const msg = signingMessage(1765360896219, "GET", "/api/1.0/balances");
  const sigB64 = await signMessage(key, msg);
  const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
  assertEquals(sig.length, 64);
  const msgBuf = new TextEncoder().encode(msg).slice().buffer as ArrayBuffer;
  assert(await crypto.subtle.verify({ name: "Ed25519" }, k.kp.publicKey, sig.slice().buffer as ArrayBuffer, msgBuf));
  await assertRejects(() => loadPrivateKey("garbage"));
});

Deno.test("revxFetch — three auth headers, the URL keeps its '?', the body goes minified, errors carry the venue's message", async () => {
  const k = await keyShapes();
  const { key } = await loadPrivateKey(k.pem);
  const env = { apiKey: "K".repeat(64), privateKey: key };
  const seen: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const u = String(url);
    if (u.endsWith("/api/1.0/balances")) return new Response(JSON.stringify([{ currency: "USD", available: "100.00", reserved: "0", total: "100.00" }]), { status: 200 });
    if (u.includes("/api/1.0/orders/abc")) return new Response(null, { status: 204 });
    if (u.endsWith("/api/1.0/orders")) return new Response(JSON.stringify({ message: "Insufficient funds", error_id: "x", timestamp: 1 }), { status: 400 });
    return new Response("<html>", { status: 200 });
  }) as unknown as typeof fetch;

  const b = await revxFetch<{ currency: string }[]>(env, "GET", "/api/1.0/balances", undefined, f);
  assert(b.ok && b.data[0].currency === "USD");
  const h = seen[0].init.headers as Record<string, string>;
  assertEquals(h["X-Revx-API-Key"], env.apiKey);
  assert(/^\d{13}$/.test(h["X-Revx-Timestamp"]));
  assert(h["X-Revx-Signature"].length > 80);
  assertEquals(seen[0].url, `${REVX_BASE}/api/1.0/balances`);
  assertEquals(seen[0].init.body, undefined);

  const order = { client_order_id: "id", symbol: "BTC-USD", side: "buy" as const, order_configuration: { limit: { base_size: "0.1", price: "1", execution_instructions: ["post_only" as const] } } };
  const p = await revxFetch(env, "POST", "/api/1.0/orders", order, f);
  assertEquals(p.ok, false);
  if (!p.ok) { assertEquals(p.status, 400); assertEquals(p.error, "Insufficient funds"); }
  assertEquals(seen[1].init.body, JSON.stringify(order));           // minified, exactly what was signed
  assertEquals((seen[1].init.headers as Record<string, string>)["Content-Type"], "application/json");

  const d = await revxFetch(env, "DELETE", "/api/1.0/orders/abc", undefined, f);
  assert(d.ok && d.data === null && d.status === 204);

  const q = await revxFetch(env, "GET", "/api/1.0/candles/BTC-USD?interval=240&since=1&until=2", undefined, f);
  assertEquals(seen[3].url, `${REVX_BASE}/api/1.0/candles/BTC-USD?interval=240&since=1&until=2`);
  assertEquals(q.ok, false);                                          // "<html>" is not JSON
  if (!q.ok) assertEquals(q.error, "non-JSON body");
});

Deno.test("revxPublic — a 429 on the public bucket is waited out and retried, twice at most, then reported", async () => {
  const { revxPublic, PUBLIC_RETRIES, PUBLIC_RETRY_MS } = await import("../_shared/revx.ts");
  const waits: number[] = [];
  const pause = (ms: number) => { waits.push(ms); return Promise.resolve(); };
  let calls = 0;
  const flaky: typeof fetch = () => { calls++; return Promise.resolve(new Response(calls < 3 ? "{\"message\":\"Too Many Requests\"}" : "{\"data\":[]}", { status: calls < 3 ? 429 : 200 })); };
  const ok = await revxPublic<{ data: unknown[] }>("/api/1.0/public/tickers?symbols=BTC-USD", flaky, 1_000, pause);
  assertEquals([ok.ok, ok.status, calls], [true, 200, 3]);
  assertEquals(waits, [PUBLIC_RETRY_MS, 2 * PUBLIC_RETRY_MS]);            // the second wait is longer
  calls = 0;
  const always429: typeof fetch = () => { calls++; return Promise.resolve(new Response("{\"message\":\"Too Many Requests\"}", { status: 429 })); };
  const bad = await revxPublic("/api/1.0/public/tickers?symbols=BTC-USD", always429, 1_000, pause);
  assertEquals([bad.ok, bad.status, calls], [false, 429, PUBLIC_RETRIES + 1]);
  assertEquals(!bad.ok && bad.error, "Too Many Requests");
});

// ── Two books per pair: the account's region, never the other one ─────────
// Measured 2026-09-21 01:48 UTC: without `region` the tickers endpoint
// returns a UK and an EEA row per symbol in arbitrary order, and the loop
// had been keeping whichever came last. That night the EEA SOL/USD book was
// 111.865 / 112.371 while the UK book, the one this account trades, was
// 112.180 / 112.181; a paper rule lifted an EEA ask (reference §3.5).

Deno.test("quotesForRegion — the other region's row is dropped whatever its position, a region-less row is trusted", () => {
  const rows = [
    { symbol: "SOL/USD", bid: "111.865", ask: "112.371", mid: "112.118", last_price: "111.865", region: "EEA" },
    { symbol: "BTC/USD", bid: "81330.26", ask: "81379.08", mid: "81354.67", last_price: "81354.67", region: "UK" },
    { symbol: "SOL/USD", bid: "112.180", ask: "112.181", mid: "112.180", last_price: "112.181", region: "UK" },
    { symbol: "BTC/USD", bid: "81336.37", ask: "81525.84", mid: "81431.10", last_price: "81525.86", region: "EEA" },
    { symbol: "ETH/USD", bid: "2680.0", ask: "2680.01", mid: "2680.00", last_price: "2680.01" },
  ];
  assertEquals(REVX_REGION, "UK");
  assertEquals(quotesForRegion(rows), {
    "SOL/USD": { bid: 112.18, ask: 112.181 },
    "BTC/USD": { bid: 81330.26, ask: 81379.08 },
    "ETH/USD": { bid: 2680, ask: 2680.01 },
  });
  // The same list read for the other region gives the other book — the choice is the account's, not the row order's.
  assertEquals(quotesForRegion(rows, "EEA")["SOL/USD"], { bid: 111.865, ask: 112.371 });
  assertEquals(quotesForRegion([], "UK"), {});
});

Deno.test("public market data names the region on every call, and the venue's quotes are the region's rows only", async () => {
  const seen: string[] = [];
  const f: typeof fetch = (input) => {
    const url = String(input); seen.push(url);
    const body = url.includes("/tickers")
      ? { data: [
          { symbol: "BTC/USD", bid: "1", ask: "2", mid: "1.5", last_price: "1", region: "EEA" },
          { symbol: "BTC/USD", bid: "3", ask: "4", mid: "3.5", last_price: "3", region: "UK" },
        ] }
      : { data: [{ start: 60_000, open: "1", high: "2", low: "0.5", close: "1.5", volume: "1" }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  await publicTickers(["BTC/USD", "SOL/USD"], f);
  await publicCandles("SOL/USD", 1, 1, 2, f);
  assertEquals(seen[0], `${REVX_BASE}/api/1.0/public/tickers?symbols=BTC-USD,SOL-USD&region=UK`);
  assertEquals(seen[1], `${REVX_BASE}/api/1.0/public/candles/SOL-USD?interval=1&since=1&until=2&region=UK`);
  const v = revxVenue(null, f);
  assertEquals(await v.quotes(["BTC/USD"]), { "BTC/USD": { bid: 3, ask: 4 } });   // the EEA row came first and is not the answer
  assertEquals(seen[2], `${REVX_BASE}/api/1.0/public/tickers?symbols=BTC-USD&region=UK`);
  const c = await v.candles("SOL/USD", 1, 1, 2);
  assertEquals(c.length, 1);
  assert(seen[3].endsWith("&region=UK"));
});

Deno.test("orderViewProblem — a filled order whose reply lacks the settlement fields is an error, never a fill at fee 0", () => {
  const ok = { venue_order_id: "V1", symbol: "BTC-USD", side: "buy" as const, state: "filled", filled_size: "0.001", average_fill_price: "80000", fees: "0.072" };
  assertEquals(orderViewProblem(ok), null);
  assertEquals(orderViewProblem({ ...ok, state: "new", filled_size: "0", fees: undefined }), null);             // nothing filled: nothing to read yet
  // No fee field at all — the venue shows `total_fee` "only when present" — is settled with the fee the schedule charges,
  // never at 0: a taker's 9 bps here, since nothing on this reply says the order rested (go-live audit D8; golive.test.ts).
  const noFee = { venue_order_id: "V1", symbol: "BTC-USD", side: "buy" as const, state: "filled", filled_size: "0.001", average_fill_price: "80000" };
  assertEquals(orderViewProblem(noFee), null);
  assertEquals([toOrderView(noFee).feeUsd, toOrderView(noFee).feeDerived?.bps], [0.072, 9]);
  const noFill = orderViewProblem({ venue_order_id: "V2", symbol: "BTC-USD", side: "sell", state: "filled" });
  assert(noFill?.includes("no filled_quantity/filled_size, average_fill_price (fields present: venue_order_id, symbol, side, state)"), String(noFill));
  // A partial fill is a fill: the same fields are required of it. (`partially_filled` is the venue's own word for it.)
  assert(orderViewProblem({ venue_order_id: "V3", symbol: "BTC-USD", side: "buy", state: "partially_filled", filled_size: "0.0004" })?.includes("no average_fill_price ("));
});

Deno.test("orderViewProblem — a reply that says filled while reporting filled_size 0 is a problem, and an ABSENT field is still reported as absent", () => {
  // `tick.ts` falls back to `base_size` when `filledBase` is 0, so a venue quirk here would book the whole order
  // and the next exit would try to sell coins that are not there. Zero is a field saying the opposite of filled.
  const zero = orderViewProblem({ venue_order_id: "V9", symbol: "BTC-USD", side: "buy", state: "filled", filled_size: "0", average_fill_price: "80000", fees: "0" });
  assert(zero?.includes("filled_size 0"), String(zero));
  // Absent is not zero: that case keeps naming the fields it could not find (the fee is not among them: it is derived, D8).
  assert(orderViewProblem({ venue_order_id: "V10", symbol: "BTC-USD", side: "buy", state: "filled" })?.includes("no filled_quantity/filled_size, average_fill_price ("));
});

// ── the order path at the client, over a fake HTTP venue (2026-09-22) ────────────────────────────────
// Until 2026-09-22 nothing here exercised placeLimit / order / cancel / activeOrders at all, and the tick's tests used a
// stub that handed the loop a finished OrderView — so neither `orderViewProblem` nor `toOrderView` ever met a reply in the
// loop. These drive the REAL client with the shapes Revolut X documents (revolut-x-api-for-llm.md, developer.revolut.com).

/** A fake Revolut X that answers the order endpoints with whatever the test gives it. */
async function fakeVenue(routes: Record<string, (init: RequestInit) => Response>) {
  const k = await keyShapes();
  const { key } = await loadPrivateKey(k.pem);
  const seen: { method: string; path: string; body: unknown }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = (init?.method ?? "GET").toUpperCase();
    seen.push({ method, path: u.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    const h = routes[`${method} ${u.pathname}`];
    return h ? h(init ?? {}) : new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  }) as unknown as typeof fetch;
  return { venue: revxVenue({ apiKey: "K".repeat(64), privateKey: key }, f), seen };
}
const json = (body: unknown, status = 200) => () => new Response(body === null ? null : JSON.stringify(body), { status });
/** The documented GET /orders/{id} body (developer.revolut.com, "Get order by ID"), filled. */
const documentedFilled = {
  id: "7a52e92e-8639-4fe1-abaa-68d3a2d5234b", client_order_id: "984a4d8a-2a9b-4950-822f-2a40037f02bd",
  symbol: "BTC/USD", side: "buy", type: "limit", quantity: "0.002", filled_quantity: "0.002", leaves_quantity: "0",
  amount: "240.00", filled_amount: "239.98", price: "120000.00", average_fill_price: "119990.00", total_fee: "0.22",
  status: "filled", time_in_force: "ioc", fee_currency: "USD", execution_instructions: ["allow_taker"], created_date: 1785309833816, updated_date: 1785313433816,
};

Deno.test("order() settles the DOCUMENTED reply — id, status, filled_quantity, total_fee — which the client used to read as 'new, nothing filled'", async () => {
  const { venue } = await fakeVenue({ [`GET /api/1.0/orders/${documentedFilled.id}`]: json({ data: documentedFilled }) });
  const r = await venue.order(documentedFilled.id);
  assert(r.ok, JSON.stringify(r));
  // The price is the reply's own filled_amount over its quantity (239.98 / 0.002, which floating point puts a hair under
  // the documented 119990.00): what the account moved, as every live fill showed (see below).
  if (r.ok) assertEquals([r.view.state, r.view.filledBase, r.view.avgPrice, r.view.feeUsd, r.view.filledBase * r.view.avgPrice!], ["filled", 0.002, 239.98 / 0.002, 0.22, 239.98]);
  // The assumed vocabulary still settles, so whichever the venue sends on the first live order is read.
  const { venue: v2 } = await fakeVenue({ "GET /api/1.0/orders/V1": json({ data: { venue_order_id: "V1", symbol: "BTC/USD", side: "buy", state: "filled", filled_size: "0.002", average_fill_price: "119990", fees: "0.22" } }) });
  const r2 = await v2.order("V1");
  assert(r2.ok && r2.view.state === "filled" && r2.view.feeUsd === 0.22, JSON.stringify(r2));
});

Deno.test("order() refuses a state it does not know — never 'new with nothing filled' — and a number that is not a number", async () => {
  for (const data of [
    { ...documentedFilled, status: "completed" },                                            // a word the venue does not document
    { symbol: "BTC/USD", side: "buy", id: "X", quantity: "0.002" },                          // no state at all
    { ...documentedFilled, status: "replaced" },                                             // the loop never replaces: not settleable here
    { ...documentedFilled, total_fee: "0.22 USD" },                                          // present, but Number() of it is NaN
    { ...documentedFilled, fee_currency: "EUR" },                                            // neither side of the pair
  ]) {
    const { venue } = await fakeVenue({ "GET /api/1.0/orders/X": json({ data }) });
    const r = await venue.order("X");
    assertEquals(r.ok, false, JSON.stringify(data));
  }
  // The pure guard says the same, in the assumed names too.
  assert(orderViewProblem({ venue_order_id: "V", symbol: "BTC-USD", side: "buy", state: "filled", filled_size: "0.001", average_fill_price: "80000", fees: "0.072 USD" })?.includes("not a number"));
  assert(orderViewProblem({ venue_order_id: "V", symbol: "BTC-USD", side: "buy", state: "open" })?.includes("does not know"));
});

Deno.test("a fee the venue takes in the COIN is settled in dollars at the fill price", async () => {
  const { venue } = await fakeVenue({ "GET /api/1.0/orders/X": json({ data: { ...documentedFilled, total_fee: "0.0000018", fee_currency: "BTC" } }) });
  const r = await venue.order("X");
  assert(r.ok, JSON.stringify(r));
  if (r.ok) assertEquals(Math.round(r.view.feeUsd * 1e6) / 1e6, Math.round(0.0000018 * 119990 * 1e6) / 1e6);
});

// ── a fill is booked at what the account moved (2026-10-02) ──────────────────────────────────────────────────────────
// Revolut X moves the quote currency in whole hundredths, a sell's credit floored and a buy's debit rounded up, reports that
// as `filled_amount`, and derives `average_fill_price` from it at the pair's price step. Booked at that average, fill 1184
// was £0.00055 short of the £9.99 credited. These are every live fill to 2026-10-02, each the venue's read-back exactly
// as its row stores it (`agent_quote_live_orders.response`, `agent_orders.response`).
const LIVE_REPLIES: Record<string, VenueOrder> = {
  "PR5 1154, USDT conversion (taker)": { "id": "b061f38e-eb6d-e207-0040-3e38f501a293", "side": "buy", "type": "limit", "price": "0.7607", "status": "filled", "symbol": "USDT/GBP", "quantity": "39.61965", "total_fee": "0.03566", "created_date": 1790872308961, "fee_currency": "USDT", "updated_date": 1790872308961, "filled_amount": "30", "time_in_force": "ioc", "client_order_id": "684e2b8f-ec02-420c-95e4-bf03ef7d12cd", "filled_quantity": "39.61965", "leaves_quantity": "0", "average_fill_price": "0.7572", "execution_instructions": ["allow_taker"] },
  "PR5 1158, USDC conversion (taker)": { "id": "cf4e0596-6e72-e29a-0040-3e77b817cd16", "side": "buy", "type": "limit", "price": "0.7614", "status": "filled", "symbol": "USDC/GBP", "quantity": "39.58305", "total_fee": "0.03563", "created_date": 1790872369792, "fee_currency": "USDC", "updated_date": 1790872369792, "filled_amount": "30", "time_in_force": "ioc", "client_order_id": "31bb6ae6-c3b4-4712-850b-4d32afd52371", "filled_quantity": "39.58305", "leaves_quantity": "0", "average_fill_price": "0.7579", "execution_instructions": ["allow_taker"] },
  "PR5 1184, ask entry (maker sell)": { "id": "b6b72f25-f4fb-e2ef-0040-3e4e4208b70f", "side": "sell", "type": "limit", "price": "0.7584", "status": "filled", "symbol": "USDT/GBP", "quantity": "13.18565", "total_fee": "0", "created_date": 1790872952325, "fee_currency": "GBP", "updated_date": 1790873717883, "filled_amount": "9.99", "time_in_force": "gtc", "client_order_id": "02dcf199-2040-4c9f-ad32-223f3be8bf68", "filled_quantity": "13.18565", "leaves_quantity": "0", "average_fill_price": "0.7576", "execution_instructions": ["post_only"] },
  "PR5 1186, its exit (maker buy)": { "id": "03ce10a8-f996-e210-0040-3ef91290fa5f", "side": "buy", "type": "limit", "price": "0.7578", "status": "filled", "symbol": "USDT/GBP", "quantity": "13.18565", "total_fee": "0", "created_date": 1790873729871, "fee_currency": "USDT", "updated_date": 1790875437202, "filled_amount": "10", "time_in_force": "gtc", "client_order_id": "b01a4cc4-8e04-462f-8576-5fb9284970b7", "filled_quantity": "13.18565", "leaves_quantity": "0", "average_fill_price": "0.7584", "execution_instructions": ["post_only"] },
  "PR5 1309, ask entry (maker sell)": { "id": "e66461e7-8dfc-e2e7-0040-3e08053368d8", "side": "sell", "type": "limit", "price": "0.758", "status": "filled", "symbol": "USDT/GBP", "quantity": "13.19262", "total_fee": "0", "created_date": 1790883096008, "fee_currency": "GBP", "updated_date": 1790889033461, "filled_amount": "10", "time_in_force": "gtc", "client_order_id": "f9b7ebbc-b8dd-4360-90ae-fddab5ecface", "filled_quantity": "13.19262", "leaves_quantity": "0", "average_fill_price": "0.758", "execution_instructions": ["post_only"] },
  "PR5 1314, its exit (maker buy)": { "id": "f842ed10-94ee-e23d-0040-3ea39bbc6db1", "side": "buy", "type": "limit", "price": "0.7573", "status": "filled", "symbol": "USDT/GBP", "quantity": "13.1916", "total_fee": "0", "created_date": 1790891670111, "fee_currency": "USDT", "updated_date": 1790896009553, "filled_amount": "9.99", "time_in_force": "gtc", "client_order_id": "2f73517b-5902-4f1e-961a-fbf64d768500", "filled_quantity": "13.1916", "leaves_quantity": "0", "average_fill_price": "0.7573", "execution_instructions": ["post_only"] },
  "trend-4h-live 37, SOL buy (taker)": { "id": "092b2034-85fb-46a5-80f5-c9f0843ef62d", "side": "buy", "type": "limit", "price": "121.02", "status": "filled", "symbol": "SOL/USD", "quantity": "0.206799", "total_fee": "0.000187", "created_date": 1790337607898, "fee_currency": "SOL", "updated_date": 1790337607898, "filled_amount": "25.01", "time_in_force": "ioc", "client_order_id": "5884d8a3-a496-4412-9146-a3de6bdd3420", "filled_quantity": "0.206799", "leaves_quantity": "0", "average_fill_price": "120.94", "execution_instructions": ["allow_taker"] },
  "trend-4h-live 44, SOL sell (taker)": { "id": "a0fb8a56-0a2e-48c1-8047-40f1e0f35ebc", "side": "sell", "type": "limit", "price": "117.41", "status": "filled", "symbol": "SOL/USD", "quantity": "0.206612", "total_fee": "0.03", "created_date": 1790582404733, "fee_currency": "USD", "updated_date": 1790582404733, "filled_amount": "24.38", "time_in_force": "ioc", "client_order_id": "aa1db6de-ddab-41fd-9b99-30227f41edba", "filled_quantity": "0.206612", "leaves_quantity": "0", "average_fill_price": "118", "execution_instructions": ["allow_taker"] },
};
/** What a settled view books in the quote currency: a buy's cost (coins held and the coin fee's value, or a quote fee), a sell's proceeds net of its fee. */
const bookedQuote = (side: "buy" | "sell", v: { filledBase: number; avgPrice: number | null; feeUsd: number }) =>
  side === "buy" ? v.filledBase * v.avgPrice! + v.feeUsd : v.filledBase * v.avgPrice! - v.feeUsd;

Deno.test("a fill is booked at what the account moved — filled_amount over the gross quantity: fill 1184 at the £9.99 credited, where its 0.7576 average booked £9.98945", () => {
  const sold = toOrderView(LIVE_REPLIES["PR5 1184, ask entry (maker sell)"]);
  assertEquals([sold.state, sold.filledBase, sold.feeUsd], ["filled", 13.18565, 0]);
  assertEquals(sold.filledBase * sold.avgPrice!, 9.99);                    // 0.7576 × 13.18565 = 9.98944844
  // Its buy-back was debited the penny above, £10.00 for 13.18565 at 0.7578 (£9.9920856): the book pays £10.00.
  const bought = toOrderView(LIVE_REPLIES["PR5 1186, its exit (maker buy)"]);
  assertEquals([bought.filledBase, bought.filledBase * bought.avgPrice!], [13.18565, 10]);   // 0.7584 × 13.18565 = 9.99999696
  // So the first round trip is the −£0.01 the account lost, not the −£0.0105 the averages made of it.
  assertEquals(Math.round((sold.filledBase * sold.avgPrice! - bought.filledBase * bought.avgPrice!) * 1e8) / 1e8, -0.01);
});

Deno.test("every live fill to 2026-10-02 books exactly the quote currency its reply says the account moved, a fee included", () => {
  for (const [name, reply] of Object.entries(LIVE_REPLIES)) {
    assertEquals(orderViewProblem(reply), null, name);
    const v = toOrderView(reply);
    const amount = Number(reply.filled_amount), quote = reply.symbol.split("/")[1];
    // A buy pays `filled_amount` (its fee in the coin, never on top in pounds or dollars); a sell receives it less a fee
    // the venue took in the quote currency.
    const moved = reply.side === "buy" ? amount : amount - (reply.fee_currency === quote ? Number(reply.total_fee) : 0);
    const off = Math.abs(bookedQuote(reply.side, v) - moved);
    assert(off < 1e-12, `${name}: booked ${bookedQuote(reply.side, v)}, the account moved ${moved}`);
    // The reply's own average is not what moved: each of the eight is off by a fraction of a penny or a cent.
    const atAverage = bookedQuote(reply.side, { ...v, avgPrice: Number(reply.average_fill_price), feeUsd: reply.fee_currency === quote ? v.feeUsd : Number(reply.total_fee) * Number(reply.average_fill_price) });
    assert(Math.abs(atAverage - moved) > 1e-7, `${name}: the venue's average books ${atAverage} against ${moved}`);
  }
});

Deno.test("a buy's coin fee is still booked net (D4), and valued at what the account paid a coin: the coins held and the fee cost the debit", () => {
  // The live row's SOL buy: 0.206799 bought, 0.000187 of it taken as the fee, $25.01 debited for 0.206799 × 120.899 ($25.0018).
  const sol = toOrderView(LIVE_REPLIES["trend-4h-live 37, SOL buy (taker)"]);
  assertEquals(sol.filledBase, 0.206612);                                   // 0.206799 − 0.000187: what reached the account
  assertEquals(sol.avgPrice, 25.01 / 0.206799);                             // per GROSS coin
  assertEquals(sol.feeUsd, 0.000187 * (25.01 / 0.206799));
  assert(Math.abs(sol.filledBase * sol.avgPrice! + sol.feeUsd - 25.01) < 1e-12, String(sol.filledBase * sol.avgPrice! + sol.feeUsd));
  // PR5's USDT conversion: 39.61965 bought, 0.03566 taken, £30.00 debited for £29.99999898 at 0.7572.
  const usdt = toOrderView(LIVE_REPLIES["PR5 1154, USDT conversion (taker)"]);
  assertEquals(usdt.filledBase, 39.58399);
  assert(Math.abs(usdt.filledBase * usdt.avgPrice! + usdt.feeUsd - 30) < 1e-12, String(usdt.filledBase * usdt.avgPrice! + usdt.feeUsd));
});

Deno.test("no usable filled_amount: the price is the venue's average_fill_price, exactly as before", () => {
  const base = LIVE_REPLIES["PR5 1184, ask entry (maker sell)"];
  // Absent, as in the documented post-only example and the assumed vocabulary; zero; not a number; negative.
  for (const filled_amount of [undefined, "0", "9.99 GBP", "-9.99"]) {
    const v = toOrderView({ ...base, filled_amount });
    assertEquals([v.state, v.filledBase, v.avgPrice], ["filled", 13.18565, 0.7576], String(filled_amount));
  }
  assertEquals(toOrderView({ venue_order_id: "V1", symbol: "BTC-USD", side: "buy", state: "filled", filled_size: "0.002", average_fill_price: "119990", fees: "0.22" }).avgPrice, 119990);
  // Nothing filled: no price at all, whatever the reply carries.
  assertEquals(toOrderView({ ...base, status: "new", filled_quantity: "0", leaves_quantity: "13.18565", filled_amount: "0", average_fill_price: "0" }).avgPrice, null);
  // And a fill whose reply lacks average_fill_price is still refused, filled_amount or not: the guard is unchanged.
  assert(orderViewProblem({ ...base, average_fill_price: undefined })?.includes("no average_fill_price ("));
});

Deno.test("placeLimit: a marketable order is an IOC limit that may take; a resting one is post-only GTC; the reply's data is read as an object OR an array", async () => {
  const placed = { venue_order_id: "7a52e92e-8639-4fe1-abaa-68d3a2d5234b", client_order_id: "c", state: "filled" };
  // The documented schema: `data` is a single object. The client read only `data[0]`, so this reply was "no venue_order_id".
  const { venue, seen } = await fakeVenue({ "POST /api/1.0/orders": json({ data: placed }) });
  const r = await venue.placeLimit({ clientOrderId: "c", symbol: "BTC/USD", side: "buy", base: "0.00016", price: "120050.00", marketable: true });
  assert(r.ok && r.venueOrderId === placed.venue_order_id && r.state === "filled", JSON.stringify(r));
  assertEquals(seen[0].body, { client_order_id: "c", symbol: "BTC-USD", side: "buy", order_configuration: { limit: { base_size: "0.00016", price: "120050.00", execution_instructions: ["allow_taker"], time_in_force: "ioc" } } });
  // The documented sample: an array of one.
  const { venue: v2, seen: s2 } = await fakeVenue({ "POST /api/1.0/orders": json({ data: [{ ...placed, state: "new" }] }) });
  const r2 = await v2.placeLimit({ clientOrderId: "d", symbol: "BTC/USD", side: "sell", base: "0.00016", price: "120100.00" });
  assert(r2.ok && r2.state === "new", JSON.stringify(r2));
  assertEquals((s2[0].body as { order_configuration: { limit: Record<string, unknown> } }).order_configuration.limit, { base_size: "0.00016", price: "120100.00", execution_instructions: ["post_only"], time_in_force: "gtc" });
  // A refusal is the venue's message, never an order.
  const { venue: v3 } = await fakeVenue({ "POST /api/1.0/orders": json({ message: "Insufficient balance", error_id: "e", timestamp: 1 }, 400) });
  const r3 = await v3.placeLimit({ clientOrderId: "e", symbol: "BTC/USD", side: "sell", base: "1", price: "1.00", marketable: true });
  assert(!r3.ok && r3.status === 400 && r3.error === "Insufficient balance", JSON.stringify(r3));
});

Deno.test("cancel and activeOrders: 204 is a cancel, anything else is not; the active list is read in the documented names and keyed by OUR client id", async () => {
  const { venue } = await fakeVenue({
    "DELETE /api/1.0/orders/A": json(null, 204),
    "DELETE /api/1.0/orders/B": json({ message: "Order not found" }, 404),
    "GET /api/1.0/orders/active": json({ data: [
      { id: "V-1", client_order_id: "mine", symbol: "BTC/USD", side: "buy", type: "limit", quantity: "0.002", filled_quantity: "0.0005", leaves_quantity: "0.0015", price: "98745", average_fill_price: "98740", total_fee: "0.04", status: "partially_filled" },
      { id: "V-2", client_order_id: "weird", symbol: "BTC/USD", side: "buy", quantity: "0.002", status: "suspended" },   // unreadable: left out
    ], metadata: { timestamp: 1 } }),
  });
  assertEquals(await venue.cancel("A"), { ok: true });
  assertEquals((await venue.cancel("B")).ok, false);
  const a = await venue.activeOrders();
  assert(a.ok, JSON.stringify(a));
  if (a.ok) {
    assertEquals(Object.keys(a.byClientId), ["mine"]);
    assertEquals([a.byClientId.mine.venueOrderId, a.byClientId.mine.view.state, a.byClientId.mine.view.filledBase], ["V-1", "partially_filled", 0.0005]);
  }
});

Deno.test("findOrder measures the history's week from the venue client's clock, so a test fixture's date never expires", async () => {
  // Measured from the machine's clock, the tick tests' orders (dated 2026-09-23) fell out of the window on 2026-09-30,
  // and a green suite turned red with no change to the code. Production passes no clock and keeps the machine's.
  const { key } = await loadPrivateKey((await keyShapes()).pem);
  const urls: URL[] = [];
  const f = (async (url: string | URL | Request) => {
    urls.push(new URL(String(url)));
    return new Response(JSON.stringify({ data: [], metadata: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  const clock = Date.parse("2026-09-23T04:07:00Z"), since = Date.parse("2026-09-23T04:05:00Z");
  const venue = revxVenue({ apiKey: "K".repeat(64), privateKey: key }, f, REVX_REGION, () => clock);
  assertEquals(await venue.findOrder!("c-1", "BTC/USD", since), { ok: true, found: null });
  const q = urls[0].searchParams;
  assertEquals([urls[0].pathname, q.get("symbols"), Number(q.get("start_date")), Number(q.get("end_date"))], ["/api/1.0/orders/historical", "BTC-USD", since - 60e3, clock]);
  // At most a week back, from that clock.
  await venue.findOrder!("c-1", "BTC/USD", clock - 30 * 86400e3);
  assertEquals(Number(urls[1].searchParams.get("start_date")), clock - 7 * 86400e3 + 60e3);
  // No clock passed: the machine's.
  const before = Date.now();
  await revxVenue({ apiKey: "K".repeat(64), privateKey: key }, f).findOrder!("c-1", "BTC/USD", before - 60e3);
  const end = Number(urls[2].searchParams.get("end_date"));
  assert(end >= before && end <= Date.now(), `${end} outside [${before}, now]`);
});
