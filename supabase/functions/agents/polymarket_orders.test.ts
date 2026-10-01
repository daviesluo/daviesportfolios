// Pins for Polymarket's order module (`_shared/polymarket_orders.ts`): the CLOB V2 order against Polymarket's own
// clients, byte for byte, and the wire that sends nothing but a GET while `PM_ORDER_SENDS_ENABLED` is false.
//
// The vectors are docs/agents/backtests/pmlive/vectors/vectors.json: eight orders the official TypeScript client
// (@polymarket/clob-client-v2 1.2.0) built, hashed and signed offline with Hardhat's published test key #0 — BUY and
// SELL, the standard and the neg-risk exchange, all six tick sizes — with their POST bodies and L2 signatures, and 24
// rounding cases through the client's own functions. check_py_out.txt beside them shows the official Python client
// gives the same eight hashes and signatures. One more vector comes from the official repository's own test file.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import vectors from "../../../docs/agents/backtests/pmlive/vectors/vectors.json" with { type: "json" };
import { polyHmacSignature } from "../_shared/polymarket.ts";
import {
  asTickSize, buildOrder, cancelOrderBody, decimalPlaces, domainSeparator, exchangeFor, loadPmLiveEnv, newSalt, orderAmounts, orderHash, orderProblems,
  orderStructHash, PM_EXCHANGE, PM_ORDER_ROUTES, PM_ORDER_SENDS_ENABLED, PmL2Creds, pmOrderCall, PmOrderKey, pmVenue, postOrderBody, recoverSigner,
  toBaseUnits, type PmOrderStruct,
} from "../_shared/polymarket_orders.ts";

const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// ------------------------------------------------------------------ the order, against the official clients

Deno.test("the vectors were made by the official client at the versions they name, for chain 137, with the published test key", () => {
  assertEquals(vectors.client["@polymarket/clob-client-v2"], "1.2.0");
  assertEquals([vectors.chainId, vectors.signerAddress], [137, TEST_ADDRESS]);
  assertEquals(new PmOrderKey(TEST_KEY).address(), TEST_ADDRESS);
  assertEquals(vectors.orders.length, 8);
  // BUY and SELL; both exchanges; all six tick sizes.
  assertEquals(new Set(vectors.orders.map((o) => o.input.side)), new Set(["BUY", "SELL"]));
  assertEquals(new Set(vectors.orders.map((o) => o.exchange)), new Set([PM_EXCHANGE.standard, PM_EXCHANGE.negRisk]));
  assertEquals(new Set(vectors.orders.map((o) => o.input.tickSize)).size, 6);
});

for (const v of vectors.orders) {
  Deno.test(`order ${v.name}: amounts, exchange, domain, struct hash, order hash, signature, recovery, POST body and L2 signature equal the official client's`, async () => {
    const b = buildOrder({
      tokenId: v.input.tokenId, side: v.input.side as "BUY" | "SELL", price: v.input.price, size: v.input.size, tick: asTickSize(v.input.tickSize)!,
      negRisk: v.input.negRisk, maker: vectors.maker, signer: vectors.signerAddress, salt: v.order.salt, timestampMs: v.input.nowMs, expiration: v.input.expiration,
    });
    assertEquals(b.order, v.order);                                     // every field, the amounts in base units included
    assertEquals(b.exchange, v.exchange);
    assertEquals(domainSeparator(b.exchange), v.domainSeparator);
    assertEquals(orderStructHash(b.order), v.structHash);
    assertEquals(b.hash, v.hash);
    const signature = new PmOrderKey(TEST_KEY).signDigest(b.hash);
    assertEquals(signature, v.signature);                               // deterministic (RFC 6979, low s): byte for byte
    assertEquals(recoverSigner(v.hash, v.signature), vectors.signerAddress);
    const body = postOrderBody({ ...b.order, signature }, vectors.owner, "GTD", true);
    assertEquals(body, v.body);                                          // the exact string the L2 signature covers
    assertEquals(new PmL2Creds(vectors.owner, vectors.l2Secret, vectors.l2Passphrase).orderBody({ ...b.order, signature }, "GTD", true), v.body);
    const h = await new PmL2Creds(vectors.owner, vectors.l2Secret, vectors.l2Passphrase).headers(vectors.signerAddress, "POST", "/order", v.l2.timestamp, body);
    assertEquals([h.POLY_ADDRESS, h.POLY_SIGNATURE], [v.l2.POLY_ADDRESS, v.l2.POLY_SIGNATURE]);
  });
}

Deno.test("the cancel bodies and their L2 signatures equal the official client's: DELETE /order with its id, DELETE /cancel-all with none", async () => {
  const creds = new PmL2Creds(vectors.owner, vectors.l2Secret, vectors.l2Passphrase);
  for (const c of vectors.cancels) {
    const body = c.path === "/order" ? cancelOrderBody(vectors.orders[0].hash) : undefined;
    assertEquals(body ?? null, c.body);
    const h = await creds.headers(vectors.signerAddress, c.method, c.path, c.timestamp, body);
    assertEquals(h.POLY_SIGNATURE, c.POLY_SIGNATURE);
  }
});

Deno.test("the domain separator and the struct hash reproduce the official repository's own test vector (py-clob-client-v2, Amoy)", () => {
  // Polymarket/py-clob-client-v2 tests/order_utils/test_exchange_order_builder_v2.py (commit 292c110, read 2026-10-01):
  // EXPECTED_POLY_1271_SIGNATURE for a signature-type-3 order on Amoy (80002) against the CTF Exchange V2. A type-3
  // signature carries, after its 65-byte inner signature, the exchange's domain separator and the order's struct hash.
  const EXPECTED_POLY_1271_SIGNATURE = "0xa3a093c83b6c20c83355c16ce94c92e6e9fcbdeb840618cc74f6c57a42ad145b"
    + "2b98db73d2c73cbf1f2b6af288566ae81960ddbc3a13921027358a8bff3be6ff1c"
    + "a440cbd865bc0c6243d7a8df9a8bf48a8827b0a4abbb61c30e96d305423af148"
    + "d23d42d3ad94e65d78258cecaf8dcbaddac0f73dc085040f2c12bb595dd83804";
  const hex = EXPECTED_POLY_1271_SIGNATURE.slice(2);
  const order: PmOrderStruct = {
    salt: "479249096354", maker: "0x1111111111111111111111111111111111111111", signer: "0x1111111111111111111111111111111111111111", tokenId: "1234",
    makerAmount: "100000000", takerAmount: "50000000", side: "BUY", signatureType: 3, timestamp: "1710000000000",
    metadata: `0x${"0".repeat(64)}`, builder: `0x${"0".repeat(64)}`,
  };
  assertEquals(domainSeparator(PM_EXCHANGE.standard, 80002), `0x${hex.slice(130, 194)}`);
  assertEquals(orderStructHash(order), `0x${hex.slice(194, 258)}`);
});

Deno.test("the amounts: the official client's rounding on all 24 cases, including where a binary float lands off the decimal", () => {
  for (const r of vectors.rounding) {
    assertEquals(orderAmounts(r.side as "BUY" | "SELL", r.size, r.price, asTickSize(r.tickSize)!), { makerAmount: r.makerAmount, takerAmount: r.takerAmount }, JSON.stringify(r));
  }
  // The docs' own example (trading/place-orders): a BUY of 10 at 0.52 is makerAmount 5200000, takerAmount 10000000.
  assertEquals(orderAmounts("BUY", 10, 0.52, "0.01"), { makerAmount: "5200000", takerAmount: "10000000" });
  // Where the two official clients disagree (check_py_out.txt), this module follows the TypeScript one: 19.99 shares stay
  // 19.99 (Python's float floor makes 19.98), and 0.29 stays 0.29.
  assertEquals(orderAmounts("SELL", 19.99, 0.57, "0.01").makerAmount, "19990000");
  assertEquals(orderAmounts("SELL", 0.29, 0.995, "0.005").makerAmount, "290000");
  assertEquals([toBaseUnits("5.2"), toBaseUnits("0.0000005"), toBaseUnits("1.9999995"), toBaseUnits("12")], ["5200000", "1", "2000000", "12000000"]);
  assertThrows(() => toBaseUnits("1e-7"));
  assertEquals([decimalPlaces(0.1 * 3), decimalPlaces(19.99), decimalPlaces(5)], [17, 2, 0]);
  assertEquals([asTickSize("0.001"), asTickSize(0.01), asTickSize("0.02"), asTickSize(null)], ["0.001", "0.01", null, null]);
});

Deno.test("orderProblems: what the CLOB refuses — off the tick, outside [tick, 1 − tick], under the minimum size, more than two decimals, a GTD under three minutes ahead", () => {
  const rules = { tick: "0.01" as const, minSize: 5, nowS: 1_790_000_000 };
  assertEquals(orderProblems({ price: 0.45, size: 5, expiration: rules.nowS + 180 }, rules), []);
  assertEquals(orderProblems({ price: 0.45, size: 5, expiration: 0 }, rules), []);                          // GTC
  assert(orderProblems({ price: 0.455, size: 5, expiration: 0 }, rules)[0].includes("not on the tick"));
  assert(orderProblems({ price: 0.995, size: 5, expiration: 0 }, { ...rules, tick: "0.005" }).length === 0);
  assert(orderProblems({ price: 1, size: 5, expiration: 0 }, rules).some((p) => p.includes("outside")));
  assert(orderProblems({ price: 0.45, size: 4.99, expiration: 0 }, rules)[0].includes("minimum"));
  assert(orderProblems({ price: 0.45, size: 5.001, expiration: 0 }, rules)[0].includes("two decimals"));
  assert(orderProblems({ price: 0.45, size: 5, expiration: rules.nowS + 179 }, rules)[0].includes("180 s"));
});

Deno.test("buildOrder signs for the right exchange, writes addresses EIP-55 cased, and refuses a salt the body could not carry as a number", () => {
  const base = { tokenId: "12", side: "BUY" as const, price: 0.5, size: 5, tick: "0.01" as const, maker: "0x1111111111111111111111111111111111111111", signer: TEST_ADDRESS.toLowerCase(), salt: "1", timestampMs: 1, expiration: 0 };
  assertEquals([buildOrder({ ...base, negRisk: false }).exchange, buildOrder({ ...base, negRisk: true }).exchange], [PM_EXCHANGE.standard, PM_EXCHANGE.negRisk]);
  assertEquals(exchangeFor(true), "0xe2222d279d744050d28e00520010520000310F59");
  assertEquals(buildOrder({ ...base, negRisk: false }).order.signer, TEST_ADDRESS);
  assert(buildOrder({ ...base, negRisk: false }).hash !== buildOrder({ ...base, negRisk: true }).hash);   // the domain is part of the id
  assertThrows(() => buildOrder({ ...base, negRisk: false, salt: String(Number.MAX_SAFE_INTEGER + 2) }));
  assertThrows(() => buildOrder({ ...base, negRisk: false, tokenId: "0xabc" }));
  // The expiration is not signed: the same order with another expiration has the same id (trading/place-orders).
  assertEquals(buildOrder({ ...base, negRisk: false, expiration: 1790000360 }).hash, buildOrder({ ...base, negRisk: false }).hash);
  const s = newSalt();
  assert(/^\d+$/.test(s) && BigInt(s) > 0n && BigInt(s) < 2n ** 48n, s);
});

// ------------------------------------------------------------------ the key and the stored account

Deno.test("PmOrderKey: the key never serialises or prints; errors quote none of it; recovery is as strict as the exchange (v 27/28, low s)", () => {
  const k = new PmOrderKey(TEST_KEY);
  for (const text of [JSON.stringify({ k }), Deno.inspect(k, { depth: 5, showHidden: true }), String(Object.keys(k))]) {
    assert(!text.includes(TEST_KEY.slice(2, 20)), text);
  }
  assertThrows(() => new PmOrderKey("0x1234"), Error, "not a 32-byte hex private key");
  assertThrows(() => k.signDigest("0x1234"), Error, "the digest is 32 bytes of hex");
  const zero = new PmOrderKey("00".repeat(32));
  const e = assertThrows(() => zero.signDigest(vectors.orders[0].hash));
  assertEquals((e as Error).message, "could not sign the digest");
  const v = vectors.orders[0];
  assertEquals(recoverSigner(v.hash, v.signature), TEST_ADDRESS);
  assertEquals(recoverSigner(v.hash, `${v.signature.slice(0, 130)}02`), null);                              // v must be 27 or 28
  // The same signature with s replaced by n − s (and v flipped) recovers the same key in plain ECDSA; the exchange refuses it.
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const s = BigInt(`0x${v.signature.slice(66, 130)}`);
  const high = `${v.signature.slice(0, 66)}${(n - s).toString(16).padStart(64, "0")}${v.signature.slice(130) === "1b" ? "1c" : "1b"}`;
  assertEquals(recoverSigner(v.hash, high), null);
  assertEquals(recoverSigner(v.hash, "0x00"), null);
  assert(recoverSigner(vectors.orders[1].hash, v.signature) !== TEST_ADDRESS);                              // another digest: another key
});

const PLANTED: Record<string, string> = {
  POLYMARKET_PRIVATE_KEY: TEST_KEY,
  POLYMARKET_CLOB_API_KEY: "0f0e0d0c-1111-4222-8333-444455556666",
  POLYMARKET_API_SECRET: btoa("PLANTED-L2-SECRET-32-BYTES-LONG!").replace(/\+/g, "-").replace(/\//g, "_"),
  POLYMARKET_CLOB_PASSPHRASE: "planted-passphrase-0c1d2e3f",
  POLYMARKET_FUNDER_ADDRESS: "0x00000000000000000000000000000000000000f1", POLYMARKET_SIGNER_ADDRESS: TEST_ADDRESS.toLowerCase(), POLYMARKET_SIG_TYPE: "1",
};

Deno.test("loadPmLiveEnv never reads POLYMARKET_PRIVATE_KEY: no key is loaded in this phase; it reads the L2 credentials and addresses and leaks none", () => {
  const asked: string[] = [];
  const env = loadPmLiveEnv((n) => { asked.push(n); return PLANTED[n]; });
  assert(!asked.includes("POLYMARKET_PRIVATE_KEY"), asked.join());
  assertEquals(env.check.read.includes("POLYMARKET_PRIVATE_KEY"), false);
  assertEquals([env.signer, env.funder, env.sigType, env.check.problems], [TEST_ADDRESS, "0x00000000000000000000000000000000000000F1".replace("F1", "f1"), 1, []]);
  assert(env.creds);
  for (const text of [JSON.stringify(env), Deno.inspect(env, { depth: 10, showHidden: true })]) {
    for (const s of [PLANTED.POLYMARKET_CLOB_API_KEY, PLANTED.POLYMARKET_API_SECRET, PLANTED.POLYMARKET_CLOB_PASSPHRASE]) assert(!text.includes(s), text.slice(0, 80));
  }
  assertEquals(env.scrub({ e: `echo ${PLANTED.POLYMARKET_CLOB_PASSPHRASE} and ${PLANTED.POLYMARKET_API_SECRET.replace(/=+$/, "")}` }), { e: "echo [redacted] and [redacted]" });
  const bad = loadPmLiveEnv((n) => ({ ...PLANTED, POLYMARKET_SIG_TYPE: "3", POLYMARKET_SIGNER_ADDRESS: "nope", POLYMARKET_CLOB_PASSPHRASE: "" } as Record<string, string>)[n]);
  assertEquals([bad.creds, bad.signer], [null, null]);
  for (const p of ["POLYMARKET_CLOB_PASSPHRASE / POLYMARKET_API_PASSPHRASE missing", "POLYMARKET_SIGNER_ADDRESS is not", "POLYMARKET_SIG_TYPE is 3"]) {
    assert(bad.check.problems.some((x) => x.startsWith(p)), `${p} in ${bad.check.problems}`);
  }
});

// ------------------------------------------------------------------ the wire

type Seen = { url: string; method: string; headers: Record<string, string>; body?: string; redirect?: string };
function recorder(reply: (s: Seen) => Response = () => new Response("{}", { status: 200 })) {
  const seen: Seen[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const s = { url: String(input), method: String(init?.method), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined, redirect: init?.redirect };
    seen.push(s);
    return Promise.resolve(reply(s));
  }) as typeof fetch;
  return { seen, fetchImpl };
}
const CREDS = () => new PmL2Creds("0f0e0d0c-1111-4222-8333-444455556666", btoa("PLANTED-L2-SECRET-32-BYTES-LONG!"), "planted-passphrase");
async function withRegion<T>(region: string | null, f: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get("SB_REGION");
  if (region === null) Deno.env.delete("SB_REGION"); else Deno.env.set("SB_REGION", region);
  try { return await f(); } finally { if (prev === undefined) Deno.env.delete("SB_REGION"); else Deno.env.set("SB_REGION", prev); }
}

Deno.test("PM_ORDER_SENDS_ENABLED is false in this build. Flipping it is the reviewed commit that turns the order path on, and changes this pin", () => {
  assertEquals(PM_ORDER_SENDS_ENABLED, false);
});

Deno.test("pmOrderCall sends no POST and no DELETE while sends are off: a POST outside eu-west-1 is refused for its region first; a cancel from any region only for the switch; nothing reaches fetch", async () => {
  const { seen, fetchImpl } = recorder();
  const o = { fetchImpl, creds: CREDS(), address: TEST_ADDRESS };
  const body = postOrderBody({ ...(vectors.orders[0].order as PmOrderStruct & { expiration: string }), signature: vectors.orders[0].signature }, vectors.owner, "GTD", true);
  for (const region of ["eu-west-2", null]) {
    const r = await withRegion(region, () => pmOrderCall("POST", "https://clob.polymarket.com/order", body, o));
    assertEquals([r.ok, r.refused], [false, "region"]);
  }
  const fromIreland = await withRegion("eu-west-1", () => pmOrderCall("POST", "https://clob.polymarket.com/order", body, o));
  assertEquals([fromIreland.ok, fromIreland.refused], [false, "sends-disabled"]);
  for (const region of ["eu-west-2", "eu-west-1", null]) {
    const del = await withRegion(region, () => pmOrderCall("DELETE", "https://clob.polymarket.com/order", cancelOrderBody(vectors.orders[0].hash), o));
    assertEquals(del.refused, "sends-disabled");                         // never "region": the kill switch depends on none
    assertEquals((await withRegion(region, () => pmOrderCall("DELETE", "https://clob.polymarket.com/cancel-all", undefined, o))).refused, "sends-disabled");
  }
  assertEquals(seen.length, 0);
  // The venue's own writes go through the same call: refused, and nothing leaves.
  const v = pmVenue({ ...o, sigType: 1 });
  await withRegion("eu-west-1", async () => {
    assertEquals((await v.postOrder({ ...vectors.orders[0].order, signature: vectors.orders[0].signature } as never, "GTD", true)).refused, "sends-disabled");
    assertEquals((await v.cancelOrder(vectors.orders[0].hash)).refused, "sends-disabled");
    assertEquals((await v.cancelAll()).refused, "sends-disabled");
  });
  assertEquals(seen.length, 0);
});

Deno.test("pmOrderCall reaches only its routes: every other path, method, host or id is refused before fetch", async () => {
  const { seen, fetchImpl } = recorder();
  const o = { fetchImpl, creds: CREDS(), address: TEST_ADDRESS };
  for (const [method, url] of [
    ["POST", "https://clob.polymarket.com/orders"], ["DELETE", "https://clob.polymarket.com/orders"], ["DELETE", "https://clob.polymarket.com/cancel-market-orders"],
    ["POST", "https://clob.polymarket.com/auth/api-key"], ["GET", "https://clob.polymarket.com/auth/derive-api-key"], ["POST", "https://clob.polymarket.com/books"],
    ["GET", "https://clob.polymarket.com/data/order/0x1234"], ["GET", `https://clob.polymarket.com/data/order/${vectors.orders[0].hash.toUpperCase().replace("0X", "0x")}`],
    ["GET", "https://clob.polymarket.com/book/../order"], ["GET", "https://evil.example/book"], ["GET", "http://clob.polymarket.com/book"],
    ["POST", "https://gamma-api.polymarket.com/markets/keyset"], ["GET", "https://relayer-v2.polymarket.com/submit"], ["GET", "not a url"],
  ] as Array<["GET" | "POST" | "DELETE", string]>) {
    const r = await withRegion("eu-west-1", () => pmOrderCall(method, url, method === "GET" ? undefined : "{}", o));
    assertEquals(r.refused, "route", `${method} ${url}`);
  }
  assertEquals(seen.length, 0);
  assertEquals(PM_ORDER_ROUTES.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`), [
    "POST https://clob.polymarket.com/order", "DELETE https://clob.polymarket.com/order", "DELETE https://clob.polymarket.com/cancel-all",
  ]);
  // Every route that carries L2 headers is on the CLOB host, so the credentials can reach nothing else; the call checks
  // the host again before it signs, a second guard that only a new route elsewhere would reach.
  assertEquals(PM_ORDER_ROUTES.filter((r) => r.l2 && !r.url.startsWith("https://clob.polymarket.com/")), []);
});

Deno.test("a GET goes out as a GET, follows no redirect, carries L2 headers only on the account's routes and only to the CLOB, signed without its query", async () => {
  const { seen, fetchImpl } = recorder((s) => new Response(JSON.stringify(s.url.includes("geoblock") ? { blocked: true, country: "IE" } : { balance: "0" }), { status: 200 }));
  const creds = CREDS();
  const v = pmVenue({ fetchImpl, creds, address: TEST_ADDRESS, sigType: 1, now: () => 1_790_000_000_000 });
  await v.geoblock();
  await v.book("123");
  await v.conditionalBalance("456");
  await v.order(vectors.orders[0].hash);
  await v.trade("trade-9");
  await v.closedOnly();
  await v.rewardsPage(true, "Mg==");
  await v.gammaMarkets("Ng==");
  assertEquals(seen.map((s) => [s.method, s.redirect]).every(([m, r]) => m === "GET" && r === "manual"), true);
  assertEquals(seen.map((s) => s.url), [
    "https://polymarket.com/api/geoblock",
    "https://clob.polymarket.com/book?token_id=123",
    "https://clob.polymarket.com/balance-allowance?asset_type=CONDITIONAL&token_id=456&signature_type=1",
    `https://clob.polymarket.com/data/order/${vectors.orders[0].hash}`,
    "https://clob.polymarket.com/data/trades?id=trade-9",
    "https://clob.polymarket.com/auth/ban-status/closed-only",
    "https://clob.polymarket.com/rewards/markets/current?sponsored=true&next_cursor=Mg%3D%3D",
    "https://gamma-api.polymarket.com/markets/keyset?closed=false&limit=100&order=volume24hr&ascending=false&after_cursor=Ng%3D%3D",
  ]);
  const l2 = seen.map((s) => Object.keys(s.headers).some((k) => k.startsWith("POLY_")));
  assertEquals(l2, [false, false, true, true, true, true, false, false]);
  const bal = seen[2].headers;
  assertEquals([bal.POLY_ADDRESS, bal.POLY_TIMESTAMP], [TEST_ADDRESS, "1790000000"]);
  assertEquals(bal.POLY_SIGNATURE, await polyHmacSignature(btoa("PLANTED-L2-SECRET-32-BYTES-LONG!"), 1790000000, "GET", "/balance-allowance"));
  // Without credentials an account route is refused here, and the public ones still go.
  const none = recorder();
  const anon = pmVenue({ fetchImpl: none.fetchImpl, creds: null, address: null, sigType: 1 });
  assertEquals((await anon.closedOnly()).refused, "no-credentials");
  assertEquals((await anon.book("1")).ok, true);
  assertEquals(none.seen.length, 1);
});

Deno.test("a reply's error is scrubbed before it is cut, and a 425's Retry-After is read", async () => {
  const secret = "planted-passphrase-0c1d2e3f-and-more";
  const { fetchImpl } = recorder(() => new Response(JSON.stringify({ error: `${"x".repeat(190)}${secret}` }), { status: 425, headers: { "retry-after": "3" } }));
  const r = await pmOrderCall("GET", "https://clob.polymarket.com/book?token_id=1", undefined, { fetchImpl, scrub: (s) => s.split(secret).join("[redacted]") });
  assertEquals([r.ok, r.status, r.retryAfterS], [false, 425, 3]);
  assert(!String(r.error).includes(secret.slice(0, 12)) && String(r.error).endsWith("[redacted]"), r.error);
  const slow = await pmOrderCall("GET", "https://clob.polymarket.com/book?token_id=1", undefined, {
    fetchImpl: ((_i: unknown, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("Signal timed out.", "TimeoutError"))))) as typeof fetch,
    timeoutMs: 20,
  });
  assertEquals([slow.ok, slow.status], [false, 0]);                      // every call times out
  assertEquals(orderHash(vectors.orders[0].order as PmOrderStruct, vectors.orders[0].exchange), vectors.orders[0].hash);
});
