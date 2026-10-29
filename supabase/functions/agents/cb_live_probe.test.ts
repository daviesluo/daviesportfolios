// The Coinbase key's probe (cb_live_probe.ts). Pins: it reads Davies' two secrets by their stored names; it sends GETs only
// (a stub that fails the test on anything else) and every one carries a JWT for its own path; it answers the key's
// permissions, a loud warning when the key can transfer, the GBP, USDC and EUR balances, USDC-GBP's product, the touch, the
// fees and the resting orders; a 401 reads as a rejected JWT; missing secrets name the secret; and no answer carries the key.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { b64ToBytes } from "../_shared/bytes.ts";
import { CB_KEY_NAME_SECRET, CB_PRIVATE_KEY_SECRET } from "../_shared/coinbase.ts";
import { permissionWarnings, runCbLiveProbe } from "./cb_live_probe.ts";

const KEY_NAME = "organizations/test-org/apiKeys/test-key";
const derLen = (n: number) => (n < 0x80 ? [n] : [0x81, n]);
const tlv = (tag: number, b: number[]) => [tag, ...derLen(b.length), ...b];
async function freshSec1(): Promise<string> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const j = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const oid = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
  const sec1 = tlv(0x30, [0x02, 0x01, 0x01, ...tlv(0x04, [...b64ToBytes(j.d!)]), ...tlv(0xa0, oid), ...tlv(0xa1, tlv(0x03, [0x00, 0x04, ...b64ToBytes(j.x!), ...b64ToBytes(j.y!)]))]);
  let s = ""; for (const b of sec1) s += String.fromCharCode(b);
  return `-----BEGIN EC PRIVATE KEY-----\\n${btoa(s)}\\n-----END EC PRIVATE KEY-----`;      // literal "\n", as a secret often is
}

function venue(o: { perms?: Record<string, unknown>; status?: number } = {}) {
  const calls: Array<{ method: string; path: string; uri: string }> = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const u = new URL(url), method = init.method ?? "GET";
    if (method !== "GET") throw new Error(`the probe sent ${method} ${u.pathname}`);
    const jwt = new Headers(init.headers).get("authorization")!.replace(/^Bearer /, "");
    calls.push({ method, path: u.pathname, uri: JSON.parse(new TextDecoder().decode(b64ToBytes(jwt.split(".")[1]))).uri });
    if (o.status) return Promise.resolve(new Response('{"error":"unauthorized"}', { status: o.status }));
    const p = u.pathname.replace("/api/v3/brokerage", "");
    const body = p === "/key_permissions" ? (o.perms ?? { can_view: true, can_trade: true, can_transfer: false, portfolio_uuid: "p-1", portfolio_type: "DEFAULT" })
      : p === "/accounts" ? { accounts: [
        { currency: "GBP", available_balance: { value: "10.5", currency: "GBP" }, hold: { value: "0", currency: "GBP" } },
        { currency: "USDC", available_balance: { value: "20", currency: "USDC" }, hold: { value: "1", currency: "USDC" } },
        { currency: "BTC", available_balance: { value: "0", currency: "BTC" } }], has_next: false }
      : p === "/products/USDC-GBP" ? { product_id: "USDC-GBP", base_increment: "0.01", quote_increment: "0.0001", base_min_size: "1", status: "online", trading_disabled: false }
      : p === "/best_bid_ask" ? { pricebooks: [{ product_id: "USDC-GBP", bids: [{ price: "0.7512" }], asks: [{ price: "0.7513" }] }] }
      : p === "/transaction_summary" ? { fee_tier: { pricing_tier: "Advanced 1", maker_fee_rate: "0.004", taker_fee_rate: "0.006" } }
      : p === "/orders/historical/batch" ? { orders: [{ order_id: "o1", client_order_id: "c1", product_id: "USDC-GBP", side: "BUY", status: "OPEN" }], has_next: false }
      : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

Deno.test("the probe: GETs alone, each signed for its path; permissions, balances, product, touch, fees, resting orders; no key in the answer", async () => {
  const pem = await freshSec1();
  const env: Record<string, string> = { [CB_KEY_NAME_SECRET]: KEY_NAME, [CB_PRIVATE_KEY_SECRET]: pem };
  assertEquals([CB_KEY_NAME_SECRET, CB_PRIVATE_KEY_SECRET], ["COINBASE_API_KEY_NAME", "COINBASE_API_PRIVATE_KEY"]);
  const v = venue();
  const r = await runCbLiveProbe((n) => env[n], v.fetchImpl, () => Date.UTC(2026, 9, 29, 12));
  assertEquals([r.ok, r.jwt], [true, "accepted"]);
  // The account's own tier as per cent; a maker fee above 0 % is a warning (the study assumed 0 % on the stable pair), not a failure.
  assertEquals(r.fees, { tier: "Advanced 1", makerPct: 0.4, takerPct: 0.6, scope: "the account's spot tier; stable pairs may be priced apart" });
  assertEquals((r.warnings as string[]).length, 1);
  assert((r.warnings as string[])[0].startsWith("the account's spot tier charges makers 0.4 %"));
  assertEquals(r.secrets, { name: "organizations-path", key: "pem-sec1", escapedNewlines: true });
  assertEquals(r.permissions, { can_view: true, can_trade: true, can_transfer: false, portfolio_type: "DEFAULT", portfolio_uuid: "p-1" });
  assertEquals(r.balances, { GBP: { available: 10.5, hold: 0, accounts: 1 }, USDC: { available: 20, hold: 1, accounts: 1 }, EUR: { available: 0, hold: 0, accounts: 0 } });
  assertEquals((r.product as Record<string, unknown>).base_increment, "0.01");
  assertEquals(r.touch, { bid: 0.7512, ask: 0.7513 });
  assertEquals(r.openOrders, 1);
  assert(v.calls.every((c) => c.method === "GET" && c.uri === `GET api.coinbase.com${c.path}`));
  assertEquals(new Set(v.calls.map((c) => c.path)).size, 6);
  const text = JSON.stringify(r);
  assert(!text.includes("PRIVATE KEY") && !text.includes(pem.split("\\n")[1].slice(0, 20)));
});

Deno.test("a key that can transfer is a loud warning and not ok; a 401 is a rejected JWT; missing secrets name the secret", async () => {
  const pem = await freshSec1();
  const env: Record<string, string> = { [CB_KEY_NAME_SECRET]: KEY_NAME, [CB_PRIVATE_KEY_SECRET]: pem };
  const t = await runCbLiveProbe((n) => env[n], venue({ perms: { can_view: true, can_trade: true, can_transfer: true } }).fetchImpl);
  assertEquals(t.ok, false);
  assert((t.warnings as string[])[0].startsWith("WARNING: this key can TRANSFER"));
  const u = await runCbLiveProbe((n) => env[n], venue({ status: 401 }).fetchImpl);
  assertEquals(u.ok, false);
  assert(String(u.jwt).startsWith("rejected (401)"));
  const m = await runCbLiveProbe((n) => (n === CB_KEY_NAME_SECRET ? KEY_NAME : undefined), venue().fetchImpl);
  assertEquals([m.ok, m.why], [false, "COINBASE_API_PRIVATE_KEY is not set"]);
  assertEquals(permissionWarnings({ can_view: true, can_trade: false, can_transfer: false }), ["the key cannot trade: the probe works, the live path would not"]);
});
