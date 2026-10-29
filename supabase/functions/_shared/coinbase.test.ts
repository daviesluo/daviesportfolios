// The Coinbase Advanced Trade client (coinbase.ts). Pins: (1) the JWT is Coinbase's documented shape — header alg ES256,
// kid the key name, a nonce, typ JWT; claims sub, iss "cdp", nbf, exp + 120 s, uri "METHOD api.coinbase.com/path" without
// the query — byte for byte the header and claims of a vector signed by OpenSSL (`openssl dgst -sha256 -sign`, a throwaway
// P-256 key generated for this test on 2026-10-29, its private half never committed: only its public key is), and that
// vector's signature verifies under WebCrypto as this client's own signatures are encoded (JOSE r || s); (2) a SEC1 PEM
// ("BEGIN EC PRIVATE KEY", as Coinbase hands it out), with real or literal "\n" newlines, imports and signs, and its
// signature verifies; a PKCS#8 PEM too; anything else is refused without its text in the error; (3) a read-only client
// refuses a POST before any request; (4) the query string's arrays; (5) the secrets' forms, never their values.
// On 2026-10-29 OpenSSL also verified a token this signer made with the same throwaway key ("Verified OK").

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { b64ToBytes } from "./bytes.ts";
import { cbClient, cbJwt, cbKeyForm, cbQuery, importCbKey, jwtParts, jwtUri, pemDer, sec1ToPkcs8 } from "./coinbase.ts";

const KEY_NAME = "organizations/test-org/apiKeys/test-key";
const NOW = Date.UTC(2026, 9, 29, 12);
const NONCE = "00112233445566778899aabbccddeeff";
/** The throwaway key's public half (`openssl ec -pubout`). */
const VECTOR_PUBLIC = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE8KqjAN4C0uoOsEUoO37W+jmFXYp+Mv5Kgn+wtYEGAjfFVGKk79A+AtW39ZpHDXo4uUENJx9avRbr/naziWuMlg==";
/** OpenSSL's signature over the header and claims below, as a JWT. */
const VECTOR =
  "eyJhbGciOiJFUzI1NiIsImtpZCI6Im9yZ2FuaXphdGlvbnMvdGVzdC1vcmcvYXBpS2V5cy90ZXN0LWtleSIsIm5vbmNlIjoiMDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmYiLCJ0eXAiOiJKV1QifQ" +
  ".eyJzdWIiOiJvcmdhbml6YXRpb25zL3Rlc3Qtb3JnL2FwaUtleXMvdGVzdC1rZXkiLCJpc3MiOiJjZHAiLCJuYmYiOjE3OTMyNzUyMDAsImV4cCI6MTc5MzI3NTMyMCwidXJpIjoiR0VUIGFwaS5jb2luYmFzZS5jb20vYXBpL3YzL2Jyb2tlcmFnZS9hY2NvdW50cyJ9" +
  ".yuYWb37L2F3D86I7bj9N19MgdJ-6u7MH5m_QTbyWwZ96cFiXy1Bp5u6Gvrx57Y-i6hkdAO3NIInWL51aAM_U_w";

const dec = (s: string) => JSON.parse(new TextDecoder().decode(b64ToBytes(s)));
const verify = async (pub: CryptoKey, jwt: string) => {
  const [h, c, s] = jwt.split(".");
  return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64ToBytes(s), new TextEncoder().encode(`${h}.${c}`));
};
const derLen = (n: number) => (n < 0x80 ? [n] : [0x81, n]);
const tlv = (tag: number, b: number[]) => [tag, ...derLen(b.length), ...b];
/** A fresh P-256 key as Coinbase hands one out: a SEC1 PEM, built from the key's JWK (d, x, y). */
async function freshSec1(): Promise<{ pem: string; pub: CryptoKey }> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const j = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const d = [...b64ToBytes(j.d!)], x = [...b64ToBytes(j.x!)], y = [...b64ToBytes(j.y!)];
  const oid = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
  const sec1 = tlv(0x30, [0x02, 0x01, 0x01, ...tlv(0x04, d), ...tlv(0xa0, oid), ...tlv(0xa1, tlv(0x03, [0x00, 0x04, ...x, ...y]))]);
  let s = ""; for (const b of sec1) s += String.fromCharCode(b);
  const body = btoa(s).match(/.{1,64}/g)!.join("\n");
  return { pem: `-----BEGIN EC PRIVATE KEY-----\n${body}\n-----END EC PRIVATE KEY-----\n`, pub: kp.publicKey };
}

Deno.test("the JWT is the documented shape, byte for byte OpenSSL's vector; the vector's signature verifies as this client encodes its own", async () => {
  const { header, claims } = jwtParts(KEY_NAME, "GET", "/api/v3/brokerage/accounts?limit=1", NOW / 1000, NONCE);
  assertEquals(header, { alg: "ES256", kid: KEY_NAME, nonce: NONCE, typ: "JWT" });
  assertEquals(claims, { sub: KEY_NAME, iss: "cdp", nbf: NOW / 1000, exp: NOW / 1000 + 120, uri: "GET api.coinbase.com/api/v3/brokerage/accounts" });
  const [vh, vc] = VECTOR.split(".");
  assertEquals([dec(vh), dec(vc)], [header, claims]);
  const pub = await crypto.subtle.importKey("spki", b64ToBytes(VECTOR_PUBLIC), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert(await verify(pub, VECTOR));
  // A fresh key: this client's token has the vector's first two parts for the same inputs, and its signature verifies.
  const k = await freshSec1();
  const mine = await cbJwt(await importCbKey(k.pem), KEY_NAME, "GET", "/api/v3/brokerage/accounts?limit=1", NOW, NONCE);
  assertEquals(mine.split(".").slice(0, 2), [vh, vc]);
  assert(await verify(k.pub, mine));
  const tampered = mine.slice(0, -4) + (mine.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert(!(await verify(k.pub, tampered)));
  assertEquals(jwtUri("post", "/api/v3/brokerage/orders"), "POST api.coinbase.com/api/v3/brokerage/orders");
});

Deno.test("a SEC1 PEM with real or literal \\n newlines imports and signs; PKCS#8 too; anything else is refused without its text", async () => {
  const k = await freshSec1();
  for (const pem of [k.pem, k.pem.replace(/\n/g, "\\n")]) {
    const jwt = await cbJwt(await importCbKey(pem), KEY_NAME, "POST", "/api/v3/brokerage/orders", NOW);
    assert(await verify(k.pub, jwt));
    assertEquals(dec(jwt.split(".")[0]).nonce.length, 32);
  }
  assertEquals(pemDer(k.pem).kind, "sec1");
  const pk8 = sec1ToPkcs8(pemDer(k.pem).der);
  let s = ""; for (const b of pk8) s += String.fromCharCode(b);
  const pkcs8Pem = `-----BEGIN PRIVATE KEY-----\n${btoa(s)}\n-----END PRIVATE KEY-----`;
  assertEquals(pemDer(pkcs8Pem).kind, "pkcs8");
  assert(await verify(k.pub, await cbJwt(await importCbKey(pkcs8Pem), KEY_NAME, "GET", "/x", NOW)));
  const secret = "c2VjcmV0LXNlZWQtYnl0ZXMtdGhhdC1tdXN0LW5vdC1sZWFr";
  const e = await assertRejects(() => importCbKey(secret));
  assert(!String((e as Error).message).includes(secret));
});

Deno.test("a read-only client refuses a POST before any request; a GET carries a bearer JWT and the query string", async () => {
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", auth: new Headers(init.headers).get("authorization") });
    return Promise.resolve(new Response(JSON.stringify({ accounts: [], has_next: false }), { status: 200 }));
  }) as unknown as typeof fetch;
  const k = await freshSec1();
  const c = cbClient({ key: await importCbKey(k.pem), keyName: KEY_NAME, fetchImpl, now: () => NOW, post: false });
  await assertRejects(() => c.create({ client_order_id: "x", product_id: "USDC-GBP", side: "BUY", order_configuration: { limit_limit_gtc: { base_size: "1", limit_price: "0.75", post_only: true } } }), Error, "read-only");
  await assertRejects(() => c.cancel(["id"]), Error, "read-only");
  assertEquals(calls.length, 0);
  await c.accounts();
  assertEquals(calls.map((x) => [x.method, x.url]), [["GET", "https://api.coinbase.com/api/v3/brokerage/accounts?limit=250"]]);
  const jwt = calls[0].auth!.replace(/^Bearer /, "");
  assertEquals(dec(jwt.split(".")[1]).uri, "GET api.coinbase.com/api/v3/brokerage/accounts");
  assert(await verify(k.pub, jwt));
  assertEquals(cbQuery({ product_ids: ["USDC-GBP", "USDT-GBP"], order_status: ["OPEN"], limit: 5, cursor: undefined }), "?product_ids=USDC-GBP&product_ids=USDT-GBP&order_status=OPEN&limit=5");
});

Deno.test("the secrets' forms say nothing of their values", async () => {
  const k = await freshSec1();
  assertEquals(cbKeyForm(KEY_NAME, k.pem), { name: "organizations-path", key: "pem-sec1", escapedNewlines: false });
  assertEquals(cbKeyForm("3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6a7b", k.pem.replace(/\n/g, "\\n")), { name: "bare-id", key: "pem-sec1", escapedNewlines: true });
  assertEquals(cbKeyForm(undefined, "not a key"), { name: "missing", key: "not-pem", escapedNewlines: false });
  assert(!JSON.stringify(cbKeyForm(KEY_NAME, k.pem)).includes("BEGIN"));
});
