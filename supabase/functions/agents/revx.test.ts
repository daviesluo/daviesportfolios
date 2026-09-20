// Pin tests for the Revolut X client (`_shared/revx.ts`). The signing
// string is pinned against the reference's OWN example byte for byte, the
// key loader against every shape a private key gets pasted in, and the
// request builder against a stubbed fetch — nothing here touches the
// venue.
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  loadPrivateKey, privateKeyDer, REVX_BASE, revxFetch, signingMessage, signMessage, splitPath,
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
