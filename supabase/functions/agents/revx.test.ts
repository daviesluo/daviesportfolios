// Pin tests for the Revolut X client (`_shared/revx.ts`). The signing
// string is pinned against the reference's OWN example byte for byte, the
// key loader against every shape a private key gets pasted in, and the
// request builder against a stubbed fetch — nothing here touches the
// venue.
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  loadPrivateKey, privateKeyDer, publicCandles, publicTickers, quotesForRegion, REVX_BASE, REVX_REGION, revxFetch, revxVenue, signingMessage, signMessage, splitPath,
  toCandle, toPathSymbol, toSlashSymbol,
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
