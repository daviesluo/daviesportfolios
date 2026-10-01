// Polymarket CLOB V2 orders for the agents feature: the EIP-712 order, its hash (which is the order's id), its
// signature, the request bodies, and the one function through which the order path talks to Polymarket. It was built
// INERT on 2026-10-01 (Option 1 of docs/agents/reviews/2026-10-01-polymarket-live-prestudy.md, on Davies' word); the
// design is docs/agents/reviews/2026-10-01-polymarket-order-path.md, and reference §2d holds every verified fact.
//
// READY, LOCKED BY ITS CONFIG (2026-10-01, docs/agents/reviews/2026-10-01-polymarket-live-calibration.md): Davies asked
// for the path to be made ready for a live test of what Polymarket's rewards really pay. `PM_ORDER_SENDS_ENABLED` is
// now true and the action loads the signing key, so what keeps every order at home is the config row: `dry_run` on and
// `live_confirmed_at` null (migration 0076 sets both), behind every gate `agents/pm_live.ts` runs. Going live is one
// statement on his word. The wire's own rules stand whatever the config says: a request outside `PM_ORDER_ROUTES` is
// refused, a POST from any region but eu-west-1 is refused, and L2 headers go to the CLOB only.
//
// The order, read 2026-10-01 from docs.polymarket.com (trading/place-orders) and from the official clients' source
// (Polymarket/clob-client-v2 @ 8046a89, npm @polymarket/clob-client-v2 1.2.0; Polymarket/py-clob-client-v2 @ 292c110,
// PyPI 1.2.0):
//   domain   { name: "Polymarket CTF Exchange", version: "2", chainId: 137, verifyingContract: the exchange }, where
//            the exchange is the CTF Exchange, or the Neg Risk CTF Exchange for a book whose `neg_risk` is true;
//   struct   Order(uint256 salt, address maker, address signer, uint256 tokenId, uint256 makerAmount,
//                  uint256 takerAmount, uint8 side, uint8 signatureType, uint256 timestamp, bytes32 metadata,
//                  bytes32 builder) — side 0 for a BUY and 1 for a SELL, timestamp in milliseconds;
//   expiration is NOT signed: it rides in the POST body beside the signed fields, Unix seconds, "0" for GTC.
// For signature type 1 (POLY_PROXY, this account) the maker is the proxy wallet that holds the funds and the signer
// is the EOA that signs. The id the CLOB gives an order is this struct's EIP-712 digest, so it is known before the
// POST. vectors.json in docs/agents/backtests/pmlive/vectors/ holds eight orders the official TypeScript client built,
// hashed and signed offline, and agents/polymarket_orders.test.ts pins every byte of them here.
//
// secp256k1 and keccak-256 come from the same two exact npm versions `polymarket.ts` imports, and nothing else.

import { secp256k1 } from "npm:@noble/curves@2.0.1/secp256k1.js";
import { keccak_256 } from "npm:@noble/hashes@2.0.1/sha3.js";
import { b64ToBytes, hexToBytes } from "./bytes.ts";
import {
  addressFromPrivateKey, isAddress, polyHmacSignature, POLYMARKET_CLOB_HOST, POLYMARKET_ENV_NAMES, POLYMARKET_GAMMA_HOST,
  POLYMARKET_GEOBLOCK_URL, redact, secretForms, toChecksumAddress,
} from "./polymarket.ts";

/**
 * The code's switch. While it is false, `pmOrderCall` sends nothing but GETs: no order, no cancel, nothing that writes,
 * whatever a config row or a caller says. It was false while the path was built (2026-10-01) and was set true the same
 * day in the reviewed change that made the path ready for its live calibration: from then the locks are the config's
 * `dry_run` and `live_confirmed_at`, the loaded key matching the stored signer, the region, and every gate. Setting it
 * false again is the code's own kill switch: a deploy, and no order or cancel can leave.
 */
export const PM_ORDER_SENDS_ENABLED: boolean = true;
/** Orders leave only from Supabase's Ireland region, and the POST path reads the runtime's own `SB_REGION` to know it. */
export const PM_ORDER_REGION = "eu-west-1";
export const PM_CHAIN_ID = 137;
/** The two exchanges an order can be signed for (docs: resources/contracts and trading/place-orders, 2026-10-01). */
export const PM_EXCHANGE = {
  standard: "0xE111180000d2663C0091e4f400237545B87B996B",
  negRisk: "0xe2222d279d744050d28e00520010520000310F59",
} as const;
export const PM_DOMAIN = { name: "Polymarket CTF Exchange", version: "2" } as const;
export const PM_ORDER_TYPE =
  "Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)";
const DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
/** Signature type 1: an EOA that owns a Polymarket proxy wallet signs; the proxy wallet is the maker. */
export const PM_POLY_PROXY = 1;
export const PM_BYTES32_ZERO = `0x${"0".repeat(64)}`;
/** "the expiration must be at least 3 minutes in the future — orders expiring sooner are rejected" (trading/place-orders). */
export const PM_GTD_MIN_LEAD_S = 180;
/** "GTD orders expire one minute before their stated expiration as a security threshold" (the same page). */
export const PM_GTD_EARLY_S = 60;

// ── tick sizes and the official client's rounding ────────────────────────────────────────────────────────────────────

export type PmTickSize = "0.1" | "0.01" | "0.005" | "0.0025" | "0.001" | "0.0001";
/**
 * The decimals a price, a size and a USD amount may carry at each tick: the official clients' ROUNDING_CONFIG, and the
 * table in trading/place-orders ("Calculate the Order Amounts"), which agree.
 */
export const PM_ROUNDING: Record<PmTickSize, { price: number; size: number; amount: number }> = {
  "0.1": { price: 1, size: 2, amount: 3 },
  "0.01": { price: 2, size: 2, amount: 4 },
  "0.005": { price: 3, size: 2, amount: 5 },
  "0.0025": { price: 4, size: 2, amount: 6 },
  "0.001": { price: 3, size: 2, amount: 5 },
  "0.0001": { price: 4, size: 2, amount: 6 },
};

/** A book's `tick_size` as the client's key, or null for one the clients do not know. */
export function asTickSize(x: unknown): PmTickSize | null {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return (Object.keys(PM_ROUNDING) as PmTickSize[]).find((t) => Math.abs(Number(t) - n) < 1e-12) ?? null;
}

// The four helpers below are clob-client-v2's `src/utilities.ts`, line for line. They round binary floats by their
// decimal string, which is what makes 19.99 stay 19.99 where py-clob-client-v2's `round_down` floors it to 19.98: the
// two official clients disagree on such sizes (vectors/check_py_out.txt), and this module follows the TypeScript one.
export function decimalPlaces(num: number): number {
  if (Number.isInteger(num)) return 0;
  const arr = num.toString().split(".");
  if (arr.length <= 1) return 0;
  return arr[1].length;
}
function roundNormal(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num;
  return Math.round((num + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
}
function roundDown(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num;
  return Math.floor(num * 10 ** decimals) / 10 ** decimals;
}
function roundUp(num: number, decimals: number): number {
  if (decimalPlaces(num) <= decimals) return num;
  return Math.ceil(num * 10 ** decimals) / 10 ** decimals;
}

/** viem 2.46.3's `parseUnits(value, 6)`, line for line: a decimal string to six-decimal base units (pUSD and shares). */
export function toBaseUnits(value: string): string {
  const decimals = 6;
  if (!/^(-?)([0-9]*)\.?([0-9]*)$/.test(value)) throw new Error(`not a decimal number: ${value}`);
  let [integer, fraction = "0"] = value.split(".");
  const negative = integer.startsWith("-");
  if (negative) integer = integer.slice(1);
  fraction = fraction.replace(/(0+)$/, "");
  if (fraction.length > decimals) {
    const [left, unit, right] = [fraction.slice(0, decimals - 1), fraction.slice(decimals - 1, decimals), fraction.slice(decimals)];
    const rounded = Math.round(Number(`${unit}.${right}`));
    if (rounded > 9) fraction = `${BigInt(left) + 1n}0`.padStart(left.length + 1, "0");
    else fraction = `${left}${rounded}`;
    if (fraction.length > decimals) {
      fraction = fraction.slice(1);
      integer = `${BigInt(integer) + 1n}`;
    }
    fraction = fraction.slice(0, decimals);
  } else {
    fraction = fraction.padEnd(decimals, "0");
  }
  return BigInt(`${negative ? "-" : ""}${integer}${fraction}`).toString();
}

/**
 * The order's two amounts in base units: clob-client-v2's `getOrderRawAmounts` and `buildOrderCreationArgs`. A BUY
 * gives price × size USD for size shares; a SELL gives size shares for price × size USD. The price is rounded to the
 * tick's decimals, the size DOWN to two, and a USD amount with more decimals than the table allows is rounded up to
 * four more and then down to the allowed number.
 */
export function orderAmounts(side: "BUY" | "SELL", size: number, price: number, tick: PmTickSize): { makerAmount: string; takerAmount: string } {
  const rc = PM_ROUNDING[tick];
  const rawPrice = roundNormal(price, rc.price);
  const shares = roundDown(size, rc.size);
  let usd = shares * rawPrice;
  if (decimalPlaces(usd) > rc.amount) {
    usd = roundUp(usd, rc.amount + 4);
    if (decimalPlaces(usd) > rc.amount) usd = roundDown(usd, rc.amount);
  }
  const [maker, taker] = side === "BUY" ? [usd, shares] : [shares, usd];
  return { makerAmount: toBaseUnits(maker.toString()), takerAmount: toBaseUnits(taker.toString()) };
}

/**
 * What the CLOB refuses an order for, checked before anything is recorded or sent: a price off the market's tick or
 * outside [tick, 1 − tick] ("breaks minimum tick size rule"), a size under the market's minimum in shares or with more
 * than two decimals ("Size … lower than the minimum"), and a GTD expiration under three minutes ahead ("invalid
 * expiration"). Empty when the venue would take it on these counts.
 */
export function orderProblems(o: { price: number; size: number; expiration: number }, r: { tick: PmTickSize; minSize: number; nowS: number }): string[] {
  const out: string[] = [];
  const t = Number(r.tick);
  const steps = o.price / t;
  if (!(Math.abs(steps - Math.round(steps)) < 1e-6)) out.push(`price ${o.price} is not on the tick ${r.tick}`);
  if (!(o.price >= t - 1e-12 && o.price <= 1 - t + 1e-12)) out.push(`price ${o.price} is outside [${r.tick}, ${1 - t}]`);
  if (!(o.size >= r.minSize - 1e-9)) out.push(`size ${o.size} is under the market's minimum ${r.minSize}`);
  if (decimalPlaces(o.size) > 2) out.push(`size ${o.size} has more than two decimals`);
  if (o.expiration !== 0 && !(o.expiration >= r.nowS + PM_GTD_MIN_LEAD_S)) out.push(`expiration ${o.expiration} is less than ${PM_GTD_MIN_LEAD_S} s ahead`);
  return out;
}

// ── EIP-712 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The fields the exchange signs, in the struct's order. Integers are decimal strings, as the official clients keep them. */
export type PmOrderStruct = {
  salt: string; maker: string; signer: string; tokenId: string; makerAmount: string; takerAmount: string;
  side: "BUY" | "SELL"; signatureType: number; timestamp: string; metadata: string; builder: string;
};
/** The struct plus the expiration, which the POST body carries and the signature does not cover. */
export type PmOrder = PmOrderStruct & { expiration: string };
export type PmSignedOrder = PmOrder & { signature: string };

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const ORDER_TYPE_HASH = keccak_256(utf8(PM_ORDER_TYPE));
const DOMAIN_TYPE_HASH = keccak_256(utf8(DOMAIN_TYPE));
const U256_MAX = (1n << 256n) - 1n;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function uintWord(v: string | number | bigint, max = U256_MAX): Uint8Array {
  const s = String(v);
  if (!/^\d+$/.test(s)) throw new Error(`not an unsigned integer: ${s.slice(0, 80)}`);
  let x = BigInt(s);
  if (x > max) throw new Error(`out of range: ${s.slice(0, 80)}`);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
function addressWord(a: string): Uint8Array {
  if (!isAddress(a)) throw new Error("not a 20-byte hex address");
  const out = new Uint8Array(32);
  out.set(hexToBytes(a.slice(2).toLowerCase()), 12);
  return out;
}
function bytes32Word(h: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("not 32 bytes of hex");
  return hexToBytes(h.slice(2).toLowerCase());
}

/** The exchange's EIP-712 domain separator, 0x-prefixed lower-case hex. */
export function domainSeparator(exchange: string, chainId: number = PM_CHAIN_ID): string {
  return hex(keccak_256(concat([
    DOMAIN_TYPE_HASH, keccak_256(utf8(PM_DOMAIN.name)), keccak_256(utf8(PM_DOMAIN.version)), uintWord(chainId), addressWord(exchange),
  ])));
}

/** hashStruct(Order): every field ABI-encoded as one 32-byte word, after the type's own hash. */
export function orderStructHash(o: PmOrderStruct): string {
  if (o.side !== "BUY" && o.side !== "SELL") throw new Error("side is BUY or SELL");
  return hex(keccak_256(concat([
    ORDER_TYPE_HASH, uintWord(o.salt), addressWord(o.maker), addressWord(o.signer), uintWord(o.tokenId), uintWord(o.makerAmount),
    uintWord(o.takerAmount), uintWord(o.side === "BUY" ? 0 : 1, 255n), uintWord(o.signatureType, 255n), uintWord(o.timestamp),
    bytes32Word(o.metadata), bytes32Word(o.builder),
  ])));
}

/** The digest the signer signs, keccak256(0x1901 ‖ domain separator ‖ struct hash): the CLOB's order id. */
export function orderHash(o: PmOrderStruct, exchange: string, chainId: number = PM_CHAIN_ID): string {
  return hex(keccak_256(concat([
    new Uint8Array([0x19, 0x01]), hexToBytes(domainSeparator(exchange, chainId).slice(2)), hexToBytes(orderStructHash(o).slice(2)),
  ])));
}

// ── the order ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PmOrderInput = {
  tokenId: string; side: "BUY" | "SELL"; price: number; size: number; tick: PmTickSize; negRisk: boolean;
  /** The proxy wallet (the funder): the order's maker for signature type 1. */
  maker: string;
  /** The EOA that signs. */
  signer: string;
  salt: string;
  timestampMs: number;
  /** Unix seconds; 0 for GTC. */
  expiration: number;
};

/** The exchange an order for this book is signed against. */
export function exchangeFor(negRisk: boolean): string {
  return negRisk ? PM_EXCHANGE.negRisk : PM_EXCHANGE.standard;
}

/**
 * An order as clob-client-v2's `createOrder` builds it for signature type 1, with its exchange and its hash. Nothing
 * here signs: the hash is the id, and a dry-run records it without any key.
 */
export function buildOrder(i: PmOrderInput): { order: PmOrder; exchange: string; hash: string } {
  if (!/^\d+$/.test(i.tokenId)) throw new Error("token id is a decimal uint256");
  if (!/^\d+$/.test(i.salt) || BigInt(i.salt) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("salt is a safe integer (the body carries it as a JSON number)");
  const { makerAmount, takerAmount } = orderAmounts(i.side, i.size, i.price, i.tick);
  const order: PmOrder = {
    salt: i.salt, maker: toChecksumAddress(i.maker), signer: toChecksumAddress(i.signer), tokenId: i.tokenId, makerAmount, takerAmount,
    side: i.side, signatureType: PM_POLY_PROXY, timestamp: String(Math.trunc(i.timestampMs)), metadata: PM_BYTES32_ZERO, builder: PM_BYTES32_ZERO,
    expiration: String(Math.trunc(i.expiration)),
  };
  const exchange = exchangeFor(i.negRisk);
  return { order, exchange, hash: orderHash(order, exchange) };
}

/** A random salt below 2^48: the official client's is round(random × now), under Number.MAX_SAFE_INTEGER as the body needs. */
export function newSalt(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return String(x === 0n ? 1n : x);
}

/**
 * The POST /order body, byte for byte as clob-client-v2's `orderToJsonV2` serialises it (the key order matters: the L2
 * signature covers the exact body). The salt goes as a JSON number, the side as "BUY" / "SELL", `owner` is the API key.
 */
export function postOrderBody(o: PmSignedOrder, owner: string, orderType: "GTC" | "GTD", postOnly: boolean): string {
  return JSON.stringify({
    deferExec: false,
    postOnly,
    order: {
      salt: parseInt(o.salt, 10), maker: o.maker, signer: o.signer, tokenId: o.tokenId, makerAmount: o.makerAmount, takerAmount: o.takerAmount,
      side: o.side, signatureType: o.signatureType, timestamp: o.timestamp, expiration: o.expiration, metadata: o.metadata, builder: o.builder,
      signature: o.signature,
    },
    owner,
    orderType,
  });
}

/** DELETE /order's body, as the client signs it. */
export function cancelOrderBody(id: string): string {
  return JSON.stringify({ orderID: id });
}

// ── the signing key ──────────────────────────────────────────────────────────────────────────────────────────────────

const KEY_HEX = /^(0x)?([0-9a-fA-F]{64})$/;
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** What signs an order's digest: its address, and a 65-byte signature. The dry-run passes none. */
export interface PmSigner {
  address(): string;
  signDigest(digest: string): string;
}

/**
 * The EOA's private key, held where nothing can print it, as `PolymarketKey` holds it. It signs a 32-byte digest the
 * way the official clients' signers do (deterministic RFC 6979, low s) and writes r ‖ s ‖ v with v = 27 + recovery.
 * Every error is a fixed string: noble's own can quote what they rejected.
 */
export class PmOrderKey implements PmSigner {
  readonly #hex: string;
  constructor(raw: string) {
    const m = KEY_HEX.exec(raw.trim());
    if (!m) throw new Error("not a 32-byte hex private key");
    this.#hex = m[2];
  }
  address(): string {
    return addressFromPrivateKey(this.#hex);
  }
  signDigest(digest: string): string {
    if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) throw new Error("the digest is 32 bytes of hex");
    const sk = hexToBytes(this.#hex);
    try {
      const rec = secp256k1.sign(hexToBytes(digest.slice(2)), sk, { prehash: false, lowS: true, format: "recovered" });
      return `${hex(rec.subarray(1, 65))}${(27 + rec[0]).toString(16)}`;
    } catch {
      throw new Error("could not sign the digest");
    } finally {
      sk.fill(0);   // best effort, as polymarket.ts says of its own copy
    }
  }
  toJSON(): string {
    return "[redacted]";
  }
  [Symbol.for("Deno.customInspect")](): string {
    return "PmOrderKey [redacted]";
  }
}

/**
 * The address a 65-byte signature over `digest` recovers to, EIP-55 cased, or null. As strict as the exchange's
 * OpenZeppelin ECDSA: v must be 27 or 28 and s in the lower half of the order.
 */
export function recoverSigner(digest: string, signature: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  const sig = hexToBytes(signature.slice(2));
  const v = sig[64];
  if (v !== 27 && v !== 28) return null;
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  if (s === 0n || s > SECP256K1_N / 2n) return null;
  try {
    const recovered = concat([new Uint8Array([v - 27]), sig.subarray(0, 64)]);
    const pub = secp256k1.recoverPublicKey(recovered, hexToBytes(digest.slice(2)), { prehash: false });
    const full = secp256k1.Point.fromBytes(pub).toBytes(false);
    return toChecksumAddress(hex(keccak_256(full.subarray(1)).subarray(12)));
  } catch {
    return null;
  }
}

// ── the stored account, without its private key ──────────────────────────────────────────────────────────────────────

/**
 * The CLOB's L2 credentials in private fields. They sign a request's headers and write the API key into a POST body's
 * `owner`, and nothing else ever leaves them. They print and serialise as "[redacted]".
 */
export class PmL2Creds {
  readonly #key: string;
  readonly #secret: string;
  readonly #passphrase: string;
  constructor(key: string, secret: string, passphrase: string) {
    this.#key = key;
    this.#secret = secret;
    this.#passphrase = passphrase;
  }
  async headers(address: string, method: string, requestPath: string, timestampS: number, body?: string): Promise<Record<string, string>> {
    return {
      POLY_ADDRESS: address,
      POLY_SIGNATURE: await polyHmacSignature(this.#secret, timestampS, method, requestPath, body),
      POLY_TIMESTAMP: String(timestampS),
      POLY_API_KEY: this.#key,
      POLY_PASSPHRASE: this.#passphrase,
    };
  }
  /** The POST /order body with this key as its `owner`. */
  orderBody(o: PmSignedOrder, orderType: "GTC" | "GTD", postOnly: boolean): string {
    return postOrderBody(o, this.#key, orderType, postOnly);
  }
  toJSON(): string {
    return "[redacted]";
  }
  [Symbol.for("Deno.customInspect")](): string {
    return "PmL2Creds [redacted]";
  }
}

export type PmLiveEnv = {
  creds: PmL2Creds | null;
  /** The EOA the API key belongs to (POLY_ADDRESS, and an order's signer), EIP-55 cased. */
  signer: string | null;
  /** The proxy wallet that holds the funds: an order's maker. */
  funder: string | null;
  sigType: number | null;
  /**
   * The signing key, held where nothing can print it, and only when the address it controls IS the stored signer: a
   * key for any other address could sign nothing the venue would take, and the path stays a dry-run.
   */
  key: PmOrderKey | null;
  /** Why no key was loaded, in words that quote none of it; null when one was. */
  keyProblem: string | null;
  /** Which names were read and set, and every problem, in names only. */
  check: { read: string[]; problems: string[] };
  /** `x` with every stored credential and the key, in every spelling it could come back in, replaced by "[redacted]". */
  scrub: <T>(x: T) => T;
};

/**
 * What the order path needs from the secrets store: the L2 credentials (for its reads of the account and its writes),
 * the signer and funder addresses (for order hashes), the signature type, and the signing key. The key is read once,
 * into a `PmOrderKey` (a private field; it prints and serialises as "[redacted]"), its every spelling is added to what
 * `scrub` removes BEFORE anything is derived from it, and it is kept only when the address it controls is the stored
 * POLYMARKET_SIGNER_ADDRESS; otherwise `key` is null and `keyProblem` says why, and the path stays a dry-run. It never
 * throws.
 */
export function loadPmLiveEnv(read: (name: string) => string | undefined = (n) => Deno.env.get(n)): PmLiveEnv {
  const asked: string[] = [];
  const get = (n: string) => { asked.push(n); return read(n)?.trim() || null; };
  const first = (names: readonly string[]) => { for (const n of names) { const v = get(n); if (v) return v; } return null; };
  const problems: string[] = [];
  const secrets: string[] = [];
  const cred = (field: "apiKey" | "secret" | "passphrase") => {
    const v = first(POLYMARKET_ENV_NAMES[field]);
    if (v) secrets.push(...secretForms(v)); else problems.push(`${POLYMARKET_ENV_NAMES[field].join(" / ")} missing`);
    return v;
  };
  const apiKey = cred("apiKey"), secret = cred("secret"), passphrase = cred("passphrase");
  let secretOk = false;
  if (secret) { try { secretOk = b64ToBytes(secret).length > 0; } catch { problems.push("the L2 secret is not base64"); } }
  const address = (name: "funder" | "signer") => {
    const v = first(POLYMARKET_ENV_NAMES[name]);
    if (!v) { problems.push(`${POLYMARKET_ENV_NAMES[name][0]} missing`); return null; }
    if (!isAddress(v)) { problems.push(`${POLYMARKET_ENV_NAMES[name][0]} is not a 20-byte hex address`); return null; }
    return toChecksumAddress(v);
  };
  const funder = address("funder"), signer = address("signer");
  const st = first(POLYMARKET_ENV_NAMES.sigType);
  const sigType = st !== null && /^[0-3]$/.test(st) ? Number(st) : null;
  if (sigType !== PM_POLY_PROXY) problems.push(`POLYMARKET_SIG_TYPE is ${st ?? "missing"}; this order path signs for type ${PM_POLY_PROXY} (POLY_PROXY) only`);
  // The key: its spellings go into the scrub list first, then it is held in a private field, and kept only if it is
  // the stored signer's. Every message below is a fixed string: none quotes a character of it.
  let key: PmOrderKey | null = null, keyProblem: string | null = null;
  const raw = get(POLYMARKET_ENV_NAMES.privateKey[0]);
  if (!raw) keyProblem = "POLYMARKET_PRIVATE_KEY missing: no order can be signed";
  else {
    secrets.push(...secretForms(raw));
    try {
      const k = new PmOrderKey(raw);
      const derived = k.address();
      if (!signer) keyProblem = "no valid POLYMARKET_SIGNER_ADDRESS to check the key against: no order can be signed";
      else if (derived.toLowerCase() !== signer.toLowerCase()) keyProblem = "the private key's address is not POLYMARKET_SIGNER_ADDRESS: no order can be signed";
      else key = k;
    } catch {
      keyProblem = "POLYMARKET_PRIVATE_KEY is not a valid 32-byte secp256k1 key: no order can be signed";
    }
  }
  if (keyProblem) problems.push(keyProblem);
  return {
    creds: apiKey && secret && passphrase && secretOk ? new PmL2Creds(apiKey, secret, passphrase) : null,
    signer, funder, sigType, key, keyProblem,
    check: { read: [...new Set(asked)], problems },
    scrub: <T>(x: T) => redact(x, secrets),
  };
}

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────────────────────────

type Route = { method: "GET" | "POST" | "DELETE"; url: string; l2: boolean };
/**
 * Every request the order path may make, and nothing else. `{id}` is an order id, 0x and 64 hex digits. The writes are
 * three: an order, the cancel of one order, and the kill switch that cancels them all. The reward reads (2026-10-01,
 * the live calibration) are GETs, read from docs.polymarket.com's API reference and the CLOB OpenAPI and called the same
 * way by both official clients (clob-client-v2 `getEarningsForUserForDay`, `getTotalEarningsForUserForDay`,
 * `getRewardPercentages`, `isOrderScoring`; py-clob-client-v2 the same, snake-cased): what the account earned per market
 * on a day (`/rewards/user`, paged), its day's total (`/rewards/user/total`), its live share of each market's pool
 * (`/rewards/user/percentages`), whether one order is scoring (`/order-scoring`), all L2; and the maker rebates paid to
 * an address on a day (`/rebates/current`, keyless, which neither client wraps).
 */
export const PM_ORDER_ROUTES: readonly Route[] = [
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/book`, l2: false },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/rewards/markets/current`, l2: false },
  { method: "GET", url: `${POLYMARKET_GAMMA_HOST}/markets/keyset`, l2: false },
  { method: "GET", url: POLYMARKET_GEOBLOCK_URL, l2: false },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/rebates/current`, l2: false },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/auth/ban-status/closed-only`, l2: true },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/balance-allowance`, l2: true },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/data/order/{id}`, l2: true },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/data/trades`, l2: true },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/order-scoring`, l2: true },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/rewards/user`, l2: true },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/rewards/user/total`, l2: true },
  { method: "GET", url: `${POLYMARKET_CLOB_HOST}/rewards/user/percentages`, l2: true },
  { method: "POST", url: `${POLYMARKET_CLOB_HOST}/order`, l2: true },
  { method: "DELETE", url: `${POLYMARKET_CLOB_HOST}/order`, l2: true },
  { method: "DELETE", url: `${POLYMARKET_CLOB_HOST}/cancel-all`, l2: true },
];
const ORDER_ID = /^0x[0-9a-f]{64}$/;

function routeOf(method: string, u: URL): Route | null {
  const target = `${u.origin}${u.pathname}`;
  for (const r of PM_ORDER_ROUTES) {
    if (r.method !== method) continue;
    if (r.url.endsWith("/{id}")) {
      const base = r.url.slice(0, -"{id}".length);
      if (target.startsWith(base) && ORDER_ID.test(target.slice(base.length))) return r;
    } else if (target === r.url) return r;
  }
  return null;
}

export type PmReply<T = any> = {
  ok: boolean; status: number; ms: number; data?: T; error?: string;
  /** Seconds the venue asked us to wait (Retry-After, or a body's `retry_after_seconds`). */
  retryAfterS?: number | null;
  /** Refused here, before any request left: which rule refused it. */
  refused?: "route" | "region" | "sends-disabled" | "no-credentials";
};

export type PmWireOpts = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  creds?: PmL2Creds | null;
  /** POLY_ADDRESS for the L2 requests: the signer EOA. */
  address?: string | null;
  /** Applied to an upstream error's text before it is cut, as `pmGet` does. */
  scrub?: (s: string) => string;
  /** False keeps every POST and DELETE at home, as `PM_ORDER_SENDS_ENABLED` false would. It can only lower: never raise. */
  sendsEnabled?: boolean;
};

function runtimeRegion(): string | null {
  try { return Deno.env.get("SB_REGION") ?? null; } catch { return null; }
}

/**
 * The order path's one network call. In order: the request must be one of `PM_ORDER_ROUTES`; a POST must come from a
 * runtime whose `SB_REGION` is eu-west-1 (a cancel may come from anywhere, so the kill switch never depends on a
 * region); and nothing but a GET leaves while `PM_ORDER_SENDS_ENABLED` is false. Each refusal is returned before a
 * header is built or a request is made. L2 headers go to the CLOB host only, a redirect is never followed, and every
 * call times out.
 */
export async function pmOrderCall(method: "GET" | "POST" | "DELETE", url: string, body: string | undefined, o: PmWireOpts = {}): Promise<PmReply> {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, status: 0, ms: 0, error: "not a URL", refused: "route" }; }
  const route = routeOf(method, u);
  if (!route) return { ok: false, status: 0, ms: 0, error: `not an order-path route: ${method} ${u.origin}${u.pathname}`, refused: "route" };
  if (method === "POST" && runtimeRegion() !== PM_ORDER_REGION) {
    return { ok: false, status: 0, ms: 0, error: `SB_REGION is ${runtimeRegion() ?? "unset"}, not ${PM_ORDER_REGION}: no order leaves`, refused: "region" };
  }
  if (method !== "GET" && !(PM_ORDER_SENDS_ENABLED && o.sendsEnabled !== false)) {
    return { ok: false, status: 0, ms: 0, error: "sends are disabled: nothing but a GET leaves", refused: "sends-disabled" };
  }
  let headers: Record<string, string> = { Accept: "application/json" };
  if (route.l2) {
    if (!o.creds || !o.address) return { ok: false, status: 0, ms: 0, error: "no L2 credentials", refused: "no-credentials" };
    if (u.origin !== POLYMARKET_CLOB_HOST) return { ok: false, status: 0, ms: 0, error: `L2 headers go to ${POLYMARKET_CLOB_HOST} only`, refused: "route" };
    try {
      headers = { ...headers, ...(await o.creds.headers(o.address, method, u.pathname, Math.floor((o.now ?? Date.now)() / 1000), body)) };
    } catch {
      return { ok: false, status: 0, ms: 0, error: "could not sign the request", refused: "no-credentials" };
    }
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const clean = (s: string) => (o.scrub ?? ((x: string) => x))(s).slice(0, 200);
  const t0 = Date.now();
  try {
    const res = await (o.fetchImpl ?? fetch)(u.href, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(o.timeoutMs ?? 5_000) });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: the text is the error below */ }
    const ms = Date.now() - t0;
    const ra = Number(res.headers.get("retry-after") ?? data?.retry_after_seconds);
    const retryAfterS = Number.isFinite(ra) && ra >= 0 ? ra : null;
    if (!res.ok) return { ok: false, status: res.status, ms, error: clean(typeof data?.error === "string" ? data.error : text), retryAfterS };
    return { ok: true, status: res.status, ms, data, retryAfterS };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: clean(e instanceof Error ? e.message : String(e)) };
  }
}

// ── the venue, as the executor sees it ───────────────────────────────────────────────────────────────────────────────

/** GET /book's levels (strings), as served. */
export type PmBookReply = {
  asset_id?: string; timestamp?: string; hash?: string; bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }>;
  min_order_size?: string; tick_size?: string; neg_risk?: boolean;
};
/** GET /data/order/{id} (the OpenAPI's `OpenOrder`): sizes in shares as decimal strings, status LIVE / MATCHED / CANCELED / …. */
export type PmOpenOrder = {
  id?: string; status?: string; market?: string; asset_id?: string; side?: string; original_size?: string; size_matched?: string;
  price?: string; expiration?: string; order_type?: string; associate_trades?: string[]; created_at?: number;
};
/** One trade of GET /data/trades, with the maker orders it filled. */
export type PmTrade = {
  id?: string; status?: string; match_time?: string; transaction_hash?: string; asset_id?: string; side?: string; price?: string;
  maker_orders?: Array<{ order_id?: string; matched_amount?: string; price?: string; asset_id?: string; side?: string }>;
};
export type PmCancelReply = { canceled?: string[]; not_canceled?: Record<string, string> };
export type PmSendReply = {
  success?: boolean; errorMsg?: string; orderID?: string; status?: string; makingAmount?: string; takingAmount?: string;
  tradeIDs?: string[]; transactionsHashes?: string[];
};
/** One market's earnings on a day (GET /rewards/user's `UserEarning`): in the reward asset, `asset_rate` its rate to USD. */
export type PmUserEarning = { date?: string; condition_id?: string; asset_address?: string; maker_address?: string; earnings?: number; asset_rate?: number };
/** One day's maker rebate in one market (GET /rebates/current's `RebatedFees`): USDC as a decimal string. */
export type PmRebate = { date?: string; condition_id?: string; asset_address?: string; maker_address?: string; rebated_fees_usdc?: string };

/** Everything the executor asks of Polymarket. The production one is `pmVenue`; the tests' double implements the same. */
export interface PmVenue {
  geoblock(): Promise<PmReply<{ blocked?: boolean; country?: string; region?: string; ip?: string }>>;
  book(tokenId: string): Promise<PmReply<PmBookReply>>;
  /** One page of `/rewards/markets/current`; `cursor` is the venue's: base64 of the row offset ("" for the first page). */
  rewardsPage(sponsored: boolean, cursor: string): Promise<PmReply<{ data?: Array<Record<string, unknown>>; next_cursor?: string; limit?: number; count?: number }>>;
  /** Gamma's records of up to fifty markets by condition id, open ones (`closed` false) or closed ones. */
  gammaByConditions(conds: string[], closed: boolean): Promise<PmReply<{ markets?: Array<Record<string, unknown>>; next_cursor?: string }>>;
  closedOnly(): Promise<PmReply<{ closed_only?: boolean }>>;
  /** The account's pUSD, in base units (GET /balance-allowance?asset_type=COLLATERAL, L2): the proxy wallet's for type 1. */
  collateral(): Promise<PmReply<{ balance?: string }>>;
  conditionalBalance(tokenId: string): Promise<PmReply<{ balance?: string }>>;
  order(id: string): Promise<PmReply<PmOpenOrder>>;
  trade(id: string): Promise<PmReply<{ data?: PmTrade[] }>>;
  /** Is this order of ours scoring for the liquidity rewards now (GET /order-scoring, L2)? */
  orderScoring(id: string): Promise<PmReply<{ scoring?: boolean }>>;
  /** The account's live share of each market's pool, in percent, by condition id (GET /rewards/user/percentages, L2). */
  rewardPercentages(): Promise<PmReply<Record<string, number>>>;
  /** One page of what the account earned per market on a UTC day (GET /rewards/user, L2); sponsored true: sponsored only. */
  userEarnings(date: string, sponsored: boolean, cursor: string): Promise<PmReply<{ data?: PmUserEarning[]; next_cursor?: string }>>;
  /** The account's total for a UTC day, by reward asset (GET /rewards/user/total, L2); sponsored true: native and sponsored. */
  userEarningsTotal(date: string, sponsored: boolean): Promise<PmReply<PmUserEarning[]>>;
  /** The maker rebates paid to `maker` for a UTC day, by market (GET /rebates/current, keyless; null when there are none). */
  rebates(date: string, maker: string): Promise<PmReply<PmRebate[] | null>>;
  postOrder(o: PmSignedOrder, orderType: "GTD", postOnly: true): Promise<PmReply<PmSendReply>>;
  cancelOrder(id: string): Promise<PmReply<PmCancelReply>>;
  cancelAll(): Promise<PmReply<PmCancelReply>>;
}

/** The venue over HTTP, every call through `pmOrderCall`. */
export function pmVenue(o: PmWireOpts & { sigType: number }): PmVenue {
  const C = POLYMARKET_CLOB_HOST;
  const get = (path: string, q: Record<string, string> | Array<[string, string]> = {}) => {
    const qs = new URLSearchParams(q).toString();
    return pmOrderCall("GET", `${path}${qs ? `?${qs}` : ""}`, undefined, o);
  };
  const sig = String(o.sigType);
  return {
    geoblock: () => get(POLYMARKET_GEOBLOCK_URL),
    book: (tokenId) => get(`${C}/book`, { token_id: tokenId }),
    rewardsPage: (sponsored, cursor) => get(`${C}/rewards/markets/current`, cursor ? { sponsored: String(sponsored), next_cursor: cursor } : { sponsored: String(sponsored) }),
    gammaByConditions: (conds, closed) => get(`${POLYMARKET_GAMMA_HOST}/markets/keyset`, [["limit", "100"], ["closed", String(closed)], ...conds.map((c): [string, string] => ["condition_ids", c])]),
    closedOnly: () => get(`${C}/auth/ban-status/closed-only`),
    collateral: () => get(`${C}/balance-allowance`, { asset_type: "COLLATERAL", signature_type: sig }),
    orderScoring: (id) => get(`${C}/order-scoring`, { order_id: id }),
    rewardPercentages: () => get(`${C}/rewards/user/percentages`, { signature_type: sig }),
    userEarnings: (date, sponsored, cursor) => get(`${C}/rewards/user`, { date, signature_type: sig, ...(sponsored ? { sponsored: "true" } : {}), ...(cursor ? { next_cursor: cursor } : {}) }),
    userEarningsTotal: (date, sponsored) => get(`${C}/rewards/user/total`, { date, signature_type: sig, ...(sponsored ? { sponsored: "true" } : {}) }),
    rebates: (date, maker) => get(`${C}/rebates/current`, { date, maker_address: maker }),
    conditionalBalance: (tokenId) => get(`${C}/balance-allowance`, { asset_type: "CONDITIONAL", token_id: tokenId, signature_type: String(o.sigType) }),
    order: (id) => get(`${C}/data/order/${id}`),
    trade: (id) => get(`${C}/data/trades`, { id }),
    postOrder: (order, orderType, postOnly) => {
      if (!o.creds) return Promise.resolve({ ok: false, status: 0, ms: 0, error: "no L2 credentials", refused: "no-credentials" as const });
      return pmOrderCall("POST", `${C}/order`, o.creds.orderBody(order, orderType, postOnly), o);
    },
    cancelOrder: (id) => pmOrderCall("DELETE", `${C}/order`, cancelOrderBody(id), o),
    cancelAll: () => pmOrderCall("DELETE", `${C}/cancel-all`, undefined, o),
  };
}
