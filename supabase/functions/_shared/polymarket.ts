// Polymarket (prediction markets) CLOB client for the agents feature. READ-ONLY: this phase verifies the stored
// credentials and nothing else. docs/agents/reference.md §2d has every verified fact it rests on.
//
// The account is a legacy Magic ("email login") one: an EOA whose Magic-exported key signs, and a Polymarket proxy
// wallet (signature type 1, POLY_PROXY) that holds the funds. The CLOB has been V2 since 2026-04-28 (new exchange
// contracts, pUSD as collateral); its API authentication did not change.
//
// Authentication has two levels. L1 is an EIP-712 `ClobAuth` signature by the EOA, which creates or derives the L2
// credentials. They exist already, so nothing here signs one. L2 authenticates each private request with five
// headers: POLY_ADDRESS (the EOA), POLY_TIMESTAMP (Unix seconds), POLY_API_KEY, POLY_PASSPHRASE and
//   POLY_SIGNATURE = url-safe base64, padding kept, of HMAC-SHA256( key = the base64-decoded secret,
//                                                                 message = timestamp + METHOD + path [+ body] )
// where the path carries NO query string ("the query parameters are not part of the signed path"). The official
// clients' own vector, and two more from their Python implementation, are pinned in agents/polymarket.test.ts.
//
// Nothing in this file can place, cancel or sign an order, or create or delete a key. `pmGet` is its only network
// call: it sends GET and nothing else, refuses any URL that is not in POLYMARKET_READS, sends the L2 headers to the
// CLOB host only, and follows no redirect (a redirect would carry those headers wherever it pointed). The host is the
// documented one, never POLYMARKET_HOST: a changed secret must not be able to send the passphrase somewhere else.
//
// The private key is read for one purpose: deriving the EOA's address, so the probe can compare it with the stored
// signer address. No function returns, logs or throws a byte of it. The key and the L2 credentials live in private
// fields that serialise and print as "[redacted]", and the probe's report is scrubbed of every secret value before it
// is returned, because an upstream error that echoed a request header would otherwise carry one out.
//
// secp256k1 and keccak-256 (WebCrypto has neither) come from @noble/curves 2.0.1 and @noble/hashes 2.0.1 on npm, at
// exact versions: both published 2025-09-22 with provenance, and nothing else resolved (curves pins hashes 2.0.1 and
// hashes has no dependencies). noble-curves' secp256k1 and weierstrass modules were in Trail of Bits' 2023 audit, and
// noble-hashes' sha3 was in Cure53's 2022 one. @noble/secp256k1 is not used: its own README says its current version
// has not been independently audited. The integrity hashes are in the reference.

import { secp256k1 } from "npm:@noble/curves@2.0.1/secp256k1.js";
import { keccak_256 } from "npm:@noble/hashes@2.0.1/sha3.js";
import { b64ToBytes, bytesToB64, hexToBytes, toArrayBuffer } from "./bytes.ts";

export const POLYMARKET_CLOB_HOST = "https://clob.polymarket.com";
export const POLYMARKET_GAMMA_HOST = "https://gamma-api.polymarket.com";
/** On polymarket.com itself, not the API hosts. It answers for the address the request comes from. */
export const POLYMARKET_GEOBLOCK_URL = "https://polymarket.com/api/geoblock";
export const POLYGON_CHAIN_ID = 137;

/** The CLOB reads that need L2 headers. */
export const POLYMARKET_L2_PATHS = ["/auth/api-keys", "/auth/ban-status/closed-only", "/balance-allowance", "/data/orders"] as const;
export type PolymarketL2Path = (typeof POLYMARKET_L2_PATHS)[number];

/** Every URL this client may call, each a GET, compared without its query. A test fails if the probe asks for anything else. */
export const POLYMARKET_READS: readonly string[] = [
  `${POLYMARKET_CLOB_HOST}/time`,
  ...POLYMARKET_L2_PATHS.map((p) => `${POLYMARKET_CLOB_HOST}${p}`),
  `${POLYMARKET_CLOB_HOST}/book`,
  `${POLYMARKET_GAMMA_HOST}/markets/keyset`,
  `${POLYMARKET_GAMMA_HOST}/public-profile`,
  POLYMARKET_GEOBLOCK_URL,
];

/** The CLOB's cursor pages (`/data/orders`): the first cursor, and the one that says there is no next page. */
export const POLYMARKET_FIRST_CURSOR = "MA==";
export const POLYMARKET_END_CURSOR = "LTE=";

/** 2^256 − 1: an unlimited ERC-20 allowance. */
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/** The Polygon contracts an allowance can name, from docs.polymarket.com/resources/contracts (read 2026-09-24). */
export const POLYMARKET_CONTRACTS: Record<string, string> = {
  "0xe111180000d2663c0091e4f400237545b87b996b": "CTF Exchange",
  "0xe2222d279d744050d28e00520010520000310f59": "Neg Risk CTF Exchange",
  "0xd91e80cf2e7be2e162c6513ced06f1dd0da35296": "Neg Risk Adapter (CLOB v1, deprecated)",
  "0x4d97dcd97ec945f40cf65f87097ace5ea0476045": "Conditional Tokens (CTF)",
  "0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb": "pUSD (CollateralToken)",
  "0x93070a847efef7f70739046a929d47a521f5b8ee": "CollateralOnramp",
  "0x2957922eb93258b93368531d39facca3b4dc5854": "CollateralOfframp",
  "0xada100db00ca00073811820692005400218fce1f": "CtfCollateralAdapter",
  "0xada2005600dec949baf300f4c6120000bdb6eaab": "NegRiskCtfCollateralAdapter",
};

// ── addresses and the key ────────────────────────────────────────────────────────────────────────────────────────────

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const KEY_HEX = /^(0x)?([0-9a-fA-F]{64})$/;

export function isAddress(s: unknown): s is string {
  return typeof s === "string" && ADDRESS.test(s);
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** EIP-55: a letter is upper-case where the keccak-256 of the lower-case hex has a nibble of 8 or more at its place. */
export function toChecksumAddress(address: string): string {
  if (!isAddress(address)) throw new Error("not a 20-byte hex address");
  const lower = address.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

/** "eip55" when the address is exactly its checksummed form, "none" when it is one case throughout (nothing to check), "invalid" otherwise. */
export function checksumState(address: string): "eip55" | "none" | "invalid" {
  if (toChecksumAddress(address) === address) return "eip55";
  const hex = address.slice(2);
  return hex === hex.toLowerCase() || hex === hex.toUpperCase() ? "none" : "invalid";
}

/**
 * The address an EOA private key controls: keccak-256 of the uncompressed public key without its 0x04 prefix, last 20
 * bytes, EIP-55 cased. Both errors are fixed strings: noble's own messages can quote the scalar they rejected, so none
 * of them is passed on.
 */
export function addressFromPrivateKey(privateKeyHex: string): string {
  const m = KEY_HEX.exec(privateKeyHex.trim());
  if (!m) throw new Error("not a 32-byte hex private key");
  const sk = hexToBytes(m[2]);
  try {
    if (!secp256k1.utils.isValidSecretKey(sk)) throw new Error("out of range");
    const pub = secp256k1.getPublicKey(sk, false);          // 0x04 ‖ X ‖ Y, 65 bytes
    return toChecksumAddress(`0x${bytesToHex(keccak_256(pub.subarray(1)).subarray(12))}`);
  } catch {
    throw new Error("not a valid secp256k1 private key");
  } finally {
    sk.fill(0);   // best effort: a JS runtime promises nothing about the copies it made
  }
}

/** The EOA's private key, held where nothing can print it. It answers one question: which address it controls. */
export class PolymarketKey {
  readonly #hex: string;
  /** How the key was pasted: with or without its 0x. Never any of its characters. */
  readonly form: "0x-hex" | "hex";
  constructor(raw: string) {
    const m = KEY_HEX.exec(raw.trim());
    if (!m) throw new Error("not a 32-byte hex private key");
    this.#hex = m[2];
    this.form = m[1] ? "0x-hex" : "hex";
  }
  address(): string {
    return addressFromPrivateKey(this.#hex);
  }
  toJSON(): string {
    return "[redacted]";
  }
  [Symbol.for("Deno.customInspect")](): string {
    return "PolymarketKey [redacted]";
  }
}

// ── L2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The L2 signature: url-safe base64 with its padding kept, over timestamp + METHOD + path (no query) + body. */
export async function polyHmacSignature(secret: string, timestamp: number | string, method: string, requestPath: string, body?: string): Promise<string> {
  let keyBytes: Uint8Array;
  try { keyBytes = b64ToBytes(secret); } catch { throw new Error("the L2 secret is not base64"); }
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const message = `${timestamp}${method}${requestPath}${body ?? ""}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return bytesToB64(sig).replace(/\+/g, "-").replace(/\//g, "_");
}

/** The L2 credentials, in private fields. Only the five headers of one request ever leave, and only to the CLOB host. */
export class PolymarketCreds {
  readonly #key: string;
  readonly #secret: string;
  readonly #passphrase: string;
  constructor(key: string, secret: string, passphrase: string) {
    this.#key = key;
    this.#secret = secret;
    this.#passphrase = passphrase;
  }
  /** Is `id` this API key? The probe counts the account's keys without printing any of them. */
  is(id: unknown): boolean {
    return typeof id === "string" && id === this.#key;
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
  toJSON(): string {
    return "[redacted]";
  }
  [Symbol.for("Deno.customInspect")](): string {
    return "PolymarketCreds [redacted]";
  }
}

// ── the secrets store ────────────────────────────────────────────────────────────────────────────────────────────────

/** The names the secrets were stored under (2026-09-24). The first that is set wins; a second spelling must agree. */
export const POLYMARKET_ENV_NAMES = {
  privateKey: ["POLYMARKET_PRIVATE_KEY"],
  apiKey: ["POLYMARKET_CLOB_API_KEY", "POLYMARKET_API_KEY"],
  secret: ["POLYMARKET_CLOB_SECRET", "POLYMARKET_API_SECRET"],
  passphrase: ["POLYMARKET_CLOB_PASSPHRASE", "POLYMARKET_API_PASSPHRASE"],
  funder: ["POLYMARKET_FUNDER_ADDRESS"],
  signer: ["POLYMARKET_SIGNER_ADDRESS"],
  sigType: ["POLYMARKET_SIG_TYPE"],
  host: ["POLYMARKET_HOST"],
  chainId: ["POLYMARKET_CHAIN_ID"],
} as const;

export type PolymarketConfig = { funder: string | null; signer: string | null; sigType: number | null; host: string | null; chainId: number | null };

export type PolymarketEnv = {
  /** Non-secret configuration, as stored. */
  config: PolymarketConfig;
  /** What was found, in names and booleans only: which names are set, whether two spellings agree, every problem. */
  check: {
    set: Record<string, boolean>;
    aliasesAgree: Record<"apiKey" | "secret" | "passphrase", boolean | null>;
    privateKeyForm: "0x-hex" | "hex" | "invalid" | null;
    secretBytes: number | null;
    signerChecksum: "eip55" | "none" | "invalid" | null;
    problems: string[];
  };
  creds: PolymarketCreds | null;
  key: PolymarketKey | null;
  /** `x` with every stored secret value, in every spelling it could come back in, replaced by "[redacted]". */
  scrub: <T>(x: T) => T;
};

/** `x` with every occurrence of each secret, in every string and key at any depth, replaced by "[redacted]". */
export function redact<T>(x: T, secrets: readonly string[]): T {
  const list = [...new Set(secrets.filter((s) => s.length >= 8))].sort((a, b) => b.length - a.length);
  const clean = (s: string) => list.reduce((acc, sec) => acc.split(sec).join("[redacted]"), s);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return clean(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, w]) => [clean(k), walk(w)]));
    return v;
  };
  return walk(x) as T;
}

/**
 * Every form a stored secret could be echoed back in: as stored, trimmed, both base64 alphabets, unpadded,
 * percent-encoded, and a hex key in both cases.
 */
function secretForms(raw: string): string[] {
  const t = raw.trim();
  const std = t.replace(/-/g, "+").replace(/_/g, "/"), url = t.replace(/\+/g, "-").replace(/\//g, "_");
  const hex = KEY_HEX.exec(t)?.[2];
  const forms = [raw, t, std, url, std.replace(/=+$/, ""), url.replace(/=+$/, ""), ...(hex ? [hex, hex.toLowerCase(), hex.toUpperCase(), `0x${hex.toLowerCase()}`, `0x${hex.toUpperCase()}`] : [])];
  return [...forms, ...forms.map(encodeURIComponent)];
}

/**
 * The account's configuration from the secrets store. It never throws and never copies a secret into anything it
 * returns but the two private-field holders; `check` says what is missing or malformed by name.
 */
export function loadPolymarketEnv(read: (name: string) => string | undefined = (n) => Deno.env.get(n)): PolymarketEnv {
  const problems: string[] = [];
  const set: Record<string, boolean> = {};
  const secrets: string[] = [];
  for (const names of Object.values(POLYMARKET_ENV_NAMES)) for (const n of names) set[n] = !!read(n)?.trim();
  const first = (names: readonly string[]) => {
    for (const n of names) { const v = read(n)?.trim(); if (v) return v; }
    return null;
  };
  // A credential under two names: the first set wins, and the probe says whether the other spelling agrees.
  const secretPair = (field: "apiKey" | "secret" | "passphrase") => {
    const names = POLYMARKET_ENV_NAMES[field];
    const values = names.map((n) => read(n)?.trim() || null);
    for (const v of values) if (v) secrets.push(...secretForms(v));
    const present = values.filter((v): v is string => !!v);
    if (!present.length) problems.push(`${names.join(" / ")} missing`);
    const agree = present.length < 2 ? null : present.every((v) => v === present[0]);
    if (agree === false) problems.push(`${names.join(" and ")} differ; ${names[0]} is used`);
    return { value: present[0] ?? null, agree };
  };
  const apiKey = secretPair("apiKey"), secret = secretPair("secret"), passphrase = secretPair("passphrase");

  let secretBytes: number | null = null;
  if (secret.value) {
    try { secretBytes = b64ToBytes(secret.value).length; } catch { problems.push(`${POLYMARKET_ENV_NAMES.secret.join(" / ")} is not base64`); }
  }
  const creds = apiKey.value && secret.value && passphrase.value && secretBytes ? new PolymarketCreds(apiKey.value, secret.value, passphrase.value) : null;

  let key: PolymarketKey | null = null;
  let privateKeyForm: PolymarketEnv["check"]["privateKeyForm"] = null;
  const pk = read("POLYMARKET_PRIVATE_KEY");
  if (pk?.trim()) {
    secrets.push(...secretForms(pk));
    try { key = new PolymarketKey(pk); privateKeyForm = key.form; } catch { privateKeyForm = "invalid"; problems.push("POLYMARKET_PRIVATE_KEY is not 32 bytes of hex"); }
  } else {
    problems.push("POLYMARKET_PRIVATE_KEY missing");
  }

  const address = (name: "funder" | "signer") => {
    const v = first(POLYMARKET_ENV_NAMES[name]);
    if (v === null) { problems.push(`${POLYMARKET_ENV_NAMES[name][0]} missing`); return null; }
    if (!isAddress(v)) problems.push(`${POLYMARKET_ENV_NAMES[name][0]} is not a 20-byte hex address`);
    return v;
  };
  const funder = address("funder"), signer = address("signer");

  const sigTypeRaw = first(POLYMARKET_ENV_NAMES.sigType);
  const sigType = sigTypeRaw !== null && /^[0-3]$/.test(sigTypeRaw) ? Number(sigTypeRaw) : null;
  if (sigTypeRaw === null) problems.push("POLYMARKET_SIG_TYPE missing");
  else if (sigType === null) problems.push("POLYMARKET_SIG_TYPE is not 0, 1, 2 or 3");

  const host = first(POLYMARKET_ENV_NAMES.host);
  if (host !== null && host.replace(/\/+$/, "") !== POLYMARKET_CLOB_HOST) problems.push(`POLYMARKET_HOST is not ${POLYMARKET_CLOB_HOST}; the client uses the documented host only`);

  const chainRaw = first(POLYMARKET_ENV_NAMES.chainId);
  const chainId = chainRaw !== null && /^\d+$/.test(chainRaw) ? Number(chainRaw) : null;
  if (chainRaw !== null && chainId !== POLYGON_CHAIN_ID) problems.push(`POLYMARKET_CHAIN_ID is not ${POLYGON_CHAIN_ID} (Polygon)`);

  return {
    config: { funder, signer, sigType, host, chainId },
    check: {
      set,
      aliasesAgree: { apiKey: apiKey.agree, secret: secret.agree, passphrase: passphrase.agree },
      privateKeyForm,
      secretBytes,
      signerChecksum: isAddress(signer) ? checksumState(signer) : null,
      problems,
    },
    creds,
    key,
    scrub: <T>(x: T) => redact(x, secrets),
  };
}

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PmOpts = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /**
   * Applied to an upstream error's text BEFORE it is cut to length: cut first, a secret straddling the cut would leave
   * a prefix that no longer matches it, and the report's final scrub would pass it.
   */
  redactText?: (s: string) => string;
};
export type PmReply = { ok: boolean; status: number; ms: number; data?: any; error?: string };

/** The one network call. GET only, listed URLs only, L2 headers to the CLOB host only, no redirect followed. */
export async function pmGet(url: string, opts: PmOpts & { headers?: Record<string, string> } = {}): Promise<PmReply> {
  const clean = (s: string) => (opts.redactText ?? ((x: string) => x))(s).slice(0, 200);
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, status: 0, ms: 0, error: "not a URL" }; }
  const target = `${u.origin}${u.pathname}`;
  if (!POLYMARKET_READS.includes(target)) return { ok: false, status: 0, ms: 0, error: `not a read path: ${target}` };
  const headers = opts.headers ?? {};
  if (Object.keys(headers).some((h) => h.toUpperCase().startsWith("POLY_")) && u.origin !== POLYMARKET_CLOB_HOST) {
    return { ok: false, status: 0, ms: 0, error: `L2 headers go to ${POLYMARKET_CLOB_HOST} only` };
  }
  const t0 = Date.now();
  try {
    const res = await (opts.fetchImpl ?? fetch)(u.href, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: the text is the error below */ }
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, ms, error: clean(typeof data?.error === "string" ? data.error : text) };
    return { ok: true, status: res.status, ms, data };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: clean(e instanceof Error ? e.message : String(e)) };
  }
}

/** One L2-authenticated read: the path signed without its query, a fresh timestamp for each request. */
export async function pmL2Get(creds: PolymarketCreds, address: string, path: PolymarketL2Path, params: Record<string, string>, opts: PmOpts = {}): Promise<PmReply> {
  const ts = Math.floor((opts.now ?? Date.now)() / 1000);
  let headers: Record<string, string>;
  try { headers = await creds.headers(address, "GET", path, ts); } catch (e) { return { ok: false, status: 0, ms: 0, error: e instanceof Error ? e.message : "could not sign" }; }
  const q = new URLSearchParams(params).toString();
  return pmGet(`${POLYMARKET_CLOB_HOST}${path}${q ? `?${q}` : ""}`, { ...opts, headers });
}

// ── market data, for the probe's one order book ──────────────────────────────────────────────────────────────────────

function jsonList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}

/**
 * The market whose book the probe reads: the first that takes orders and is still two-sided (its first outcome
 * priced between 5 and 95 cents), else the first that takes orders at all. Gamma sends `clobTokenIds`,
 * `outcomes` and `outcomePrices` as JSON-encoded strings.
 */
export function pickBookMarket(markets: unknown): { market: Record<string, any>; tokenId: string; outcome: string | null } | null {
  const open = (Array.isArray(markets) ? markets : [])
    .filter((m): m is Record<string, any> => !!m && typeof m === "object")
    .filter((m) => m.enableOrderBook === true && m.acceptingOrders === true && typeof jsonList(m.clobTokenIds)[0] === "string");
  const live = open.find((m) => { const p = Number(jsonList(m.outcomePrices)[0]); return p >= 0.05 && p <= 0.95; });
  const m = live ?? open[0];
  if (!m) return null;
  const outcome = jsonList(m.outcomes)[0];
  return { market: m, tokenId: jsonList(m.clobTokenIds)[0] as string, outcome: typeof outcome === "string" ? outcome : null };
}

/** A book's touch and shape. The CLOB lists bids low to high and asks high to low, so the best of each is found, not assumed. */
export function summariseBook(book: any): Record<string, unknown> {
  const levels = (xs: unknown) => (Array.isArray(xs) ? xs : [])
    .map((l: any) => ({ price: Number(l?.price), size: Number(l?.size) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size));
  const bids = levels(book?.bids), asks = levels(book?.asks);
  const bestBid = bids.reduce<{ price: number; size: number } | null>((b, l) => (!b || l.price > b.price ? l : b), null);
  const bestAsk = asks.reduce<{ price: number; size: number } | null>((b, l) => (!b || l.price < b.price ? l : b), null);
  const ts = Number(book?.timestamp);
  return {
    tokenId: book?.asset_id ?? null,
    bestBid, bestAsk,
    mid: bestBid && bestAsk ? Math.round(((bestBid.price + bestAsk.price) / 2) * 1e6) / 1e6 : null,
    spread: bestBid && bestAsk ? Math.round((bestAsk.price - bestBid.price) * 1e6) / 1e6 : null,
    levels: { bids: bids.length, asks: asks.length },
    tickSize: book?.tick_size ?? null,
    minOrderSize: book?.min_order_size ?? null,
    negRisk: book?.neg_risk ?? null,
    lastTradePrice: book?.last_trade_price ?? null,
    at: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null,
  };
}

// ── the probe ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What the stored account can do, read-only: the configuration as stored, whether the private key controls the stored
 * signer address, the CLOB's clock against ours, the geoblock's answer for the caller's own address, and with L2 the
 * account's API keys, whether it is in closed-only mode, its collateral balance and allowances for the stored signature
 * type, and its open orders; then whether Polymarket's public profile of the signer names the stored funder as its
 * proxy wallet, and one public order book. It places nothing and reports no key, secret, passphrase or key id.
 */
export async function polymarketProbe(env: PolymarketEnv, given: PmOpts = {}): Promise<Record<string, unknown>> {
  const opts: PmOpts = { ...given, redactText: (s) => env.scrub(s) };   // every upstream error is scrubbed before it is cut
  const now = opts.now ?? Date.now;
  const out: Record<string, unknown> = { config: { ...env.config, ...env.check } };

  // The key against the stored signer address, compared as addresses (case is only a checksum).
  let derived: string | null = null;
  if (env.key) {
    try {
      derived = env.key.address();
      out.signer = { derived, stored: env.config.signer, matches: isAddress(env.config.signer) ? derived.toLowerCase() === env.config.signer.toLowerCase() : null };
    } catch (e) {
      out.signer = { error: e instanceof Error ? e.message : "could not derive the address" };
    }
  } else {
    out.signer = { error: "no usable POLYMARKET_PRIVATE_KEY" };
  }

  // The server's clock: L2 signatures carry a timestamp, and "expired timestamp" is one of the documented 401s.
  const t0 = now();
  const tm = await pmGet(`${POLYMARKET_CLOB_HOST}/time`, opts);
  const t1 = now();
  const serverS = tm.ok && (typeof tm.data === "number" || typeof tm.data === "string") ? Number(tm.data) : NaN;   // a bare integer of Unix seconds
  out.clock = Number.isFinite(serverS) && serverS > 1e9
    ? { status: tm.status, serverS, localS: Math.round((t0 + t1) / 2000), skewS: Math.round((serverS - (t0 + t1) / 2000) * 10) / 10, rttMs: t1 - t0, note: "the server answers in whole seconds" }
    : { status: tm.status, error: tm.error ?? `unexpected reply: ${String(JSON.stringify(tm.data)).slice(0, 80)}` };

  const geo = await pmGet(POLYMARKET_GEOBLOCK_URL, opts);
  out.geoblock = geo.ok
    ? { status: geo.status, blocked: geo.data?.blocked ?? null, country: geo.data?.country ?? null, region: geo.data?.region ?? null, ip: geo.data?.ip ?? null }
    : { status: geo.status, error: geo.error };

  // L2 reads, as the stored signer (EIP-55 cased, as the official clients send it), or as the derived one if none is stored.
  const address = isAddress(env.config.signer) ? toChecksumAddress(env.config.signer) : derived;
  if (!env.creds || !address) {
    const why = !env.creds ? "no complete L2 credentials" : "no signer address";
    for (const k of ["apiKeys", "closedOnly", "collateral", "openOrders"]) out[k] = { skipped: why };
  } else {
    const creds = env.creds;
    out.l2 = { address, from: isAddress(env.config.signer) ? "POLYMARKET_SIGNER_ADDRESS" : "derived from POLYMARKET_PRIVATE_KEY" };

    const ak = await pmL2Get(creds, address, "/auth/api-keys", {}, opts);
    const keys: unknown[] | null = ak.ok && Array.isArray(ak.data?.apiKeys) ? ak.data.apiKeys : null;
    out.apiKeys = keys
      ? { status: ak.status, count: keys.length, includesConfigured: keys.some((k: any) => creds.is(typeof k === "string" ? k : k?.apiKey ?? k?.key)) }
      : { status: ak.status, error: ak.error ?? "no apiKeys list in the reply" };

    const co = await pmL2Get(creds, address, "/auth/ban-status/closed-only", {}, opts);
    out.closedOnly = co.ok ? { status: co.status, closedOnly: co.data?.closed_only ?? null } : { status: co.status, error: co.error };

    if (env.config.sigType === null) {
      out.collateral = { skipped: "no valid POLYMARKET_SIG_TYPE" };
    } else {
      const ba = await pmL2Get(creds, address, "/balance-allowance", { asset_type: "COLLATERAL", signature_type: String(env.config.sigType) }, opts);
      if (ba.ok) {
        const balance = String(ba.data?.balance ?? "");
        out.collateral = {
          status: ba.status,
          asset: "pUSD",
          signatureType: env.config.sigType,
          balance,
          pusd: /^\d+$/.test(balance) ? Number(balance) / 1e6 : null,          // pUSD has 6 decimals
          allowances: Object.entries(ba.data?.allowances ?? {}).map(([spender, v]) => ({
            spender, contract: POLYMARKET_CONTRACTS[spender.toLowerCase()] ?? null, allowance: String(v) === MAX_UINT256 ? "max" : String(v),
          })),
        };
      } else {
        out.collateral = { status: ba.status, error: ba.error };
      }
    }

    // Open orders, every page: the cursor starts at MA== and LTE= says there is no next page.
    let cursor = POLYMARKET_FIRST_CURSOR, count = 0, pages = 0;
    out.openOrders = { skipped: "not read" };
    while (pages < 20) {
      const oo = await pmL2Get(creds, address, "/data/orders", { next_cursor: cursor }, opts);
      pages++;
      if (!oo.ok) { out.openOrders = { status: oo.status, error: oo.error, pages }; break; }
      count += Array.isArray(oo.data?.data) ? oo.data.data.length : 0;
      const next = typeof oo.data?.next_cursor === "string" ? oo.data.next_cursor : POLYMARKET_END_CURSOR;
      out.openOrders = { status: oo.status, count, pages, ...(pages === 20 && next !== POLYMARKET_END_CURSOR ? { truncated: true } : {}) };
      if (next === POLYMARKET_END_CURSOR || next === cursor) break;
      cursor = next;
    }
  }

  // Does Polymarket's own public profile of the signer name the stored funder as its proxy wallet? The balance above is
  // the proxy the SERVER derives from the key's owner; this says whether that proxy is the funder the secrets name.
  if (address && isAddress(env.config.funder)) {
    const pp = await pmGet(`${POLYMARKET_GAMMA_HOST}/public-profile?address=${address}`, opts);
    const proxy = pp.ok && typeof pp.data?.proxyWallet === "string" ? pp.data.proxyWallet : null;
    out.funderProfile = pp.ok
      ? { status: pp.status, proxyWallet: proxy, matchesFunder: proxy ? proxy.toLowerCase() === env.config.funder.toLowerCase() : null }
      : { status: pp.status, error: pp.error };
  }

  // One public order book, for an active market: the busiest by 24-hour volume that is still two-sided.
  const mk = await pmGet(`${POLYMARKET_GAMMA_HOST}/markets/keyset?closed=false&limit=20&order=volume24hr&ascending=false`, opts);
  const pick = mk.ok ? pickBookMarket(mk.data?.markets) : null;
  if (!pick) {
    out.book = mk.ok ? { error: "no open market with an order book in the first page" } : { status: mk.status, error: mk.error };
  } else {
    const m = pick.market;
    const bk = await pmGet(`${POLYMARKET_CLOB_HOST}/book?token_id=${encodeURIComponent(pick.tokenId)}`, opts);
    out.book = {
      market: {
        question: m.question ?? null, slug: m.slug ?? null, conditionId: m.conditionId ?? null, outcome: pick.outcome,
        volume24hr: m.volume24hr ?? null, negRisk: m.negRisk ?? null, orderMinSize: m.orderMinSize ?? null,
        tickSize: m.orderPriceMinTickSize ?? null, feeSchedule: m.feeSchedule ?? null,
      },
      ...(bk.ok ? { status: bk.status, ms: bk.ms, ...summariseBook(bk.data) } : { status: bk.status, error: bk.error }),
    };
  }

  return env.scrub(out);
}
