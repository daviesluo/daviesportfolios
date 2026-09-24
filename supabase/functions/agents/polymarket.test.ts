// Pins for the read-only Polymarket client (`_shared/polymarket.ts`): the L2 signature against the official clients'
// own vector, the EOA derivation against the official clients' published test key, EIP-55 against the EIP's own test
// cases, a key that is refused without being quoted, a secrets loader that keeps every secret out of what it returns,
// a wire that cannot be pointed anywhere but its reads, and the book summary. Reference §2d.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  addressFromPrivateKey, checksumState, loadPolymarketEnv, pickBookMarket, pmGet, polyHmacSignature, POLYMARKET_READS, redact, summariseBook,
  toChecksumAddress,
} from "../_shared/polymarket.ts";

// Polymarket/clob-client-v2 tests/signing/hmac.test.ts and py-clob-client-v2 tests/signing/test_hmac.py, verbatim.
const HMAC_VECTOR = {
  secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", timestamp: 1000000, method: "test-sign", path: "/orders", body: '{"hash": "0x123"}',
  signature: "ZwAdJKvoYRlEKDkNMwd5BuwNNtg93kNaR_oU2HrfVvc=",
};

Deno.test("polyHmacSignature reproduces the official clients' vector byte for byte", async () => {
  const v = HMAC_VECTOR;
  assertEquals(await polyHmacSignature(v.secret, v.timestamp, v.method, v.path, v.body), v.signature);
});

Deno.test("polyHmacSignature agrees with the official Python implementation on a GET and on a url-safe secret", async () => {
  // Both computed with py-clob-client-v2's own build_hmac_signature (py_clob_client_v2/signing/hmac.py, commit 215fc63):
  // a GET has no body, and its path is signed WITHOUT the query; the second secret is all `-` and `_`, the url-safe
  // alphabet the secret is issued in, so a decoder that knew only standard base64 would fail it.
  assertEquals(await polyHmacSignature(HMAC_VECTOR.secret, 1790216208, "GET", "/balance-allowance"), "pFHYLCJ8eT2sqHi7opSuOmo03GaX8OgzJGj1JqNrXZw=");
  assertEquals(await polyHmacSignature("-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-__v8=", "1790216208", "GET", "/data/orders"), "4DFwBLzJ5KLbwi-jAV_VGEPx71SWXHPrFYw3eWZOAvI=");
  await polyHmacSignature("!!not base64!!", 1, "GET", "/time").then(() => assert(false, "a bad secret must throw"), (e) => assertEquals(e.message, "the L2 secret is not base64"));
});

// The key the official clients' own tests call "publicly known" (clob-client-v2 tests/signing/signer.test.ts: PRIVATE_KEY
// and EXPECTED_ADDRESS). It is a published test key, never the account's.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

Deno.test("addressFromPrivateKey derives the published address of the published test key, in any pasted shape", () => {
  assertEquals(addressFromPrivateKey(TEST_KEY), TEST_ADDRESS);
  assertEquals(addressFromPrivateKey(TEST_KEY.slice(2)), TEST_ADDRESS);
  assertEquals(addressFromPrivateKey(`  ${TEST_KEY.toUpperCase().replace("0X", "0x")}\n`), TEST_ADDRESS);
});

Deno.test("a key that is not a secp256k1 scalar is refused with a fixed message that quotes none of it", () => {
  const n = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";   // the group order: one past the last key
  for (const bad of ["00".repeat(32), n, "ff".repeat(32)]) {
    const e = assertThrows(() => addressFromPrivateKey(bad));
    assertEquals(e instanceof Error ? e.message : "", "not a valid secp256k1 private key");
  }
  for (const bad of ["0x1234", `${TEST_KEY}00`, `0x${"zz".repeat(32)}`]) {
    const e = assertThrows(() => addressFromPrivateKey(bad));
    assertEquals(e instanceof Error ? e.message : "", "not a 32-byte hex private key");
  }
});

// eips.ethereum.org/EIPS/eip-55, "Test Cases", verbatim: every one is its own checksummed form, the all-caps and
// all-lower ones included.
const EIP55 = [
  "0x52908400098527886E0F7030069857D2E4169EE7", "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
  "0xde709f2102306220921060314715629080e2fb77", "0x27b1fdb04752bbc536007a920d24acb045561c26",
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
];

Deno.test("toChecksumAddress reproduces EIP-55's own test cases; checksumState tells a valid, a missing and a broken checksum apart", () => {
  for (const a of EIP55) {
    assertEquals(toChecksumAddress(a.toLowerCase()), a);
    assertEquals(checksumState(a), "eip55");
  }
  assertEquals(checksumState("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), "none");
  assertEquals(checksumState("0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED"), "none");
  assertEquals(checksumState("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"), "invalid");   // one letter's case flipped
  assertThrows(() => toChecksumAddress("0x1234"));
});

/** Every secret the loader could meet, planted where a leak would show. */
const PLANTED = {
  POLYMARKET_PRIVATE_KEY: TEST_KEY,
  POLYMARKET_CLOB_API_KEY: "0f0e0d0c-1111-4222-8333-444455556666", POLYMARKET_API_KEY: "0f0e0d0c-1111-4222-8333-444455556666",
  POLYMARKET_CLOB_SECRET: btoa("PLANTED-L2-SECRET-32-BYTES-LONG!").replace(/\+/g, "-").replace(/\//g, "_"),
  POLYMARKET_API_SECRET: btoa("PLANTED-L2-SECRET-32-BYTES-LONG!").replace(/\+/g, "-").replace(/\//g, "_"),
  POLYMARKET_CLOB_PASSPHRASE: "planted-passphrase-0c1d2e3f", POLYMARKET_API_PASSPHRASE: "planted-passphrase-0c1d2e3f",
  POLYMARKET_FUNDER_ADDRESS: "0x00000000000000000000000000000000000000f1",
  POLYMARKET_SIGNER_ADDRESS: TEST_ADDRESS,
  POLYMARKET_SIG_TYPE: "1", POLYMARKET_HOST: "https://clob.polymarket.com", POLYMARKET_CHAIN_ID: "137",
} as Record<string, string>;
const SECRET_VALUES = [PLANTED.POLYMARKET_PRIVATE_KEY, PLANTED.POLYMARKET_PRIVATE_KEY.slice(2), PLANTED.POLYMARKET_CLOB_SECRET, PLANTED.POLYMARKET_CLOB_PASSPHRASE, PLANTED.POLYMARKET_CLOB_API_KEY];

Deno.test("loadPolymarketEnv reads every stored name and alias, and nothing it returns can serialise or print a secret", () => {
  const env = loadPolymarketEnv((n) => PLANTED[n]);
  assertEquals(env.config, { funder: PLANTED.POLYMARKET_FUNDER_ADDRESS, signer: TEST_ADDRESS, sigType: 1, host: "https://clob.polymarket.com", chainId: 137 });
  assertEquals(env.check.problems, []);
  assertEquals(env.check.aliasesAgree, { apiKey: true, secret: true, passphrase: true });
  assertEquals(env.check.privateKeyForm, "0x-hex");
  assertEquals(env.check.secretBytes, 32);
  assertEquals(env.check.signerChecksum, "eip55");
  assert(Object.values(env.check.set).every(Boolean));
  assert(env.creds && env.key);
  assertEquals(env.key.address(), TEST_ADDRESS);
  for (const text of [JSON.stringify(env), Deno.inspect(env, { depth: 10, showHidden: true })]) {
    for (const s of SECRET_VALUES) assert(!text.includes(s), `a secret leaked into ${text.slice(0, 60)}…`);
  }
});

Deno.test("loadPolymarketEnv names what is missing, disagreeing or malformed, and quotes none of it", () => {
  const env = loadPolymarketEnv((n) => ({
    ...PLANTED,
    POLYMARKET_API_KEY: "a-different-key-id-000", POLYMARKET_CLOB_SECRET: "", POLYMARKET_API_SECRET: "",
    POLYMARKET_PRIVATE_KEY: "0xnot-a-key-but-long-enough-to-be-scrubbed", POLYMARKET_SIG_TYPE: "7", POLYMARKET_HOST: "https://evil.example", POLYMARKET_CHAIN_ID: "80002",
  } as Record<string, string>)[n]);
  assertEquals(env.creds, null);                                  // no secret: no credentials, so no L2 call can be made
  assertEquals(env.key, null);
  assertEquals(env.check.aliasesAgree.apiKey, false);
  assertEquals(env.check.privateKeyForm, "invalid");
  assertEquals(env.config.sigType, null);
  for (const p of ["POLYMARKET_CLOB_API_KEY and POLYMARKET_API_KEY differ", "POLYMARKET_CLOB_SECRET / POLYMARKET_API_SECRET missing", "POLYMARKET_PRIVATE_KEY is not 32 bytes of hex", "POLYMARKET_SIG_TYPE", "POLYMARKET_HOST", "POLYMARKET_CHAIN_ID"]) {
    assert(env.check.problems.some((x) => x.startsWith(p)), `${p} in ${JSON.stringify(env.check.problems)}`);
  }
  const text = JSON.stringify(env.check);
  assert(!text.includes("not-a-key") && !text.includes("a-different-key-id-000"), text);
  assertEquals(env.scrub({ echo: "key 0xnot-a-key-but-long-enough-to-be-scrubbed and a-different-key-id-000" }), { echo: "key [redacted] and [redacted]" });
});

Deno.test("redact replaces a secret anywhere — nested strings, arrays and keys — and leaves short strings alone", () => {
  const s = "S3CRET-VALUE-123";
  const dirty: Record<string, unknown> = { a: [`x ${s} y`, { [s]: s }], n: 5, short: "abc" };
  assertEquals(redact(dirty, [s, "abc"]), { a: ["x [redacted] y", { "[redacted]": "[redacted]" }], n: 5, short: "abc" });
});

Deno.test("pmGet calls nothing but its GET reads, sends L2 headers to the CLOB host only, and follows no redirect", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return Promise.resolve(new Response("1790216208", { status: 200 }));
  }) as typeof fetch;
  for (const url of ["https://clob.polymarket.com/order", "https://clob.polymarket.com/orders", "https://clob.polymarket.com/cancel-all", "https://clob.polymarket.com/auth/api-key", "https://clob.polymarket.com/auth/derive-api-key", "https://clob.polymarket.com/book/../order", "https://relayer-v2.polymarket.com/submit", "https://evil.example/time"]) {
    const r = await pmGet(url, { fetchImpl });
    assert(!r.ok && String(r.error).startsWith("not a read path"), `${url}: ${JSON.stringify(r)}`);
  }
  const l2 = await pmGet("https://gamma-api.polymarket.com/markets/keyset", { fetchImpl, headers: { POLY_PASSPHRASE: "x" } });
  assert(!l2.ok && String(l2.error).includes("L2 headers"), JSON.stringify(l2));
  assertEquals(seen.length, 0);                                    // refused before any request left
  const ok = await pmGet("https://clob.polymarket.com/time", { fetchImpl });
  assertEquals([ok.ok, ok.data], [true, 1790216208]);
  assertEquals([seen[0].init?.method, seen[0].init?.redirect], ["GET", "manual"]);
  assert(POLYMARKET_READS.every((u) => u.startsWith("https://")));
});

Deno.test("pickBookMarket takes the first open two-sided market and parses Gamma's JSON-encoded lists", () => {
  const markets = [
    { enableOrderBook: false, acceptingOrders: true, clobTokenIds: '["1","2"]', outcomePrices: '["0.5","0.5"]' },
    { enableOrderBook: true, acceptingOrders: true, clobTokenIds: '["3","4"]', outcomePrices: '["0.0005","0.9995"]', outcomes: '["A","B"]' },
    { enableOrderBook: true, acceptingOrders: true, clobTokenIds: '["5","6"]', outcomePrices: '["0.335","0.665"]', outcomes: '["Yes","No"]', question: "Q" },
  ];
  const pick = pickBookMarket(markets);
  assertEquals([pick?.tokenId, pick?.outcome, pick?.market.question], ["5", "Yes", "Q"]);
  assertEquals(pickBookMarket(markets.slice(0, 2))?.tokenId, "3");   // nothing two-sided: the first open one
  assertEquals(pickBookMarket([]), null);
  assertEquals(pickBookMarket("nonsense"), null);
});

Deno.test("summariseBook finds the touch in the CLOB's order (bids low to high, asks high to low, as measured)", () => {
  const s = summariseBook({
    asset_id: "5", timestamp: "1790216237628", tick_size: "0.01", min_order_size: "5", neg_risk: true, last_trade_price: "0.340",
    bids: [{ price: "0.01", size: "100" }, { price: "0.32", size: "700" }, { price: "0.33", size: "87" }],
    asks: [{ price: "0.99", size: "20" }, { price: "0.35", size: "112" }, { price: "0.34", size: "84" }],
  });
  assertEquals(s.bestBid, { price: 0.33, size: 87 });
  assertEquals(s.bestAsk, { price: 0.34, size: 84 });
  assertEquals([s.mid, s.spread, s.levels], [0.335, 0.01, { bids: 3, asks: 3 }]);
  assertEquals(s.at, new Date(1790216237628).toISOString());
  assertEquals(summariseBook({ bids: [], asks: [] }).bestBid, null);
});
