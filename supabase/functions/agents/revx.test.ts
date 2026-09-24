// Pin tests for the Revolut X client (`_shared/revx.ts`). The signing
// string is pinned against the reference's OWN example byte for byte, the
// key loader against every shape a private key gets pasted in, and the
// request builder against a stubbed fetch — nothing here touches the
// venue.
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  loadPrivateKey, orderViewProblem, privateKeyDer, publicCandles, publicTickers, quotesForRegion, REVX_BASE, REVX_REGION, revxFetch, revxVenue, signingMessage, signMessage, splitPath,
  toCandle, toOrderView, toPathSymbol, toSlashSymbol,
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
  if (r.ok) assertEquals([r.view.state, r.view.filledBase, r.view.avgPrice, r.view.feeUsd], ["filled", 0.002, 119990, 0.22]);
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
