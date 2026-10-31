// Coinbase Advanced Trade REST client (api.coinbase.com/api/v3/brokerage), for "Stablecoin quotes with Euros - 2"'s live
// path (agents/cb_live.ts; docs/agents/reviews/2026-10-29-cb-live-design.md). Read from Coinbase's own documentation on
// 2026-10-29 (docs.cdp.coinbase.com: "API Key Authentication", "Create Order", "List Orders", "List Fills", "Cancel
// Orders"); the design doc quotes what each call relies on.
//
// AUTHENTICATION. Every request carries `Authorization: Bearer <JWT>`, a fresh JWT per request:
//   header  { alg: "ES256" | "EdDSA", kid: <key name>, nonce: <random hex>, typ: "JWT" }
//   claims  { sub: <key name>, iss: "cdp", nbf: now, exp: now + 120, uri: "<METHOD> api.coinbase.com<path>" }
// The key name is `organizations/{org_id}/apiKeys/{key_id}` (or a bare key id). The private key is either kind a CDP key
// comes in (`cbKeyKind`, `importCbSigner`):
//   * "pem-ec": an ECDSA P-256 key, a SEC1 PEM ("-----BEGIN EC PRIVATE KEY-----") or an EC PKCS#8 PEM, with real newlines
//     or literal "\n"; signed ES256 (the raw r || s WebCrypto gives, JOSE's form; randomised, so pins verify, not compare).
//   * "ed25519": CDP's default since 2025, base64 of 64 bytes (the 32-byte seed, then its 32-byte public key, which must
//     match) or of the 32-byte seed alone; signed EdDSA (Ed25519, deterministic). Coinbase's "JWT Authentication" page
//     (docs.cdp.coinbase.com/get-started/authentication/jwt-authentication, read 2026-10-29) gives Ed25519 samples with these
//     claims (some samples add `aud: ["cdp_service"]`, Java's does not; this sends none, as the ES256 samples). Its Coinbase
//     App page says an Ed25519 key "may fail"; whether Advanced Trade REST accepts it is the probe's answer.
//   * anything else is "unknown" and refused, its text never echoed.
// `uri` names the path WITHOUT its query string, as the official samples build it. The probe (agents/cb_live_probe.ts) says
// which kind each secret is (`cbKeyForm`) without its value.
//
// WHAT NEVER LEAVES. The private key is read from the function's secrets, imported as a non-extractable CryptoKey and
// never logged, returned or stored; an error names a secret, never its value. A failed request's error carries the
// status and at most 300 characters of Coinbase's body, never a header.

import { b64ToBytes, toArrayBuffer } from "./bytes.ts";

export const CB_ADV_HOST = "api.coinbase.com";
export const CB_ADV_BASE = `https://${CB_ADV_HOST}`;
export const CB_ADV_PATH = "/api/v3/brokerage";
/** The order preview (`POST …/orders/preview`): it places nothing, and is the one POST a read-only client may send. */
export const CB_PREVIEW_PATH = `${CB_ADV_PATH}/orders/preview`;
/** The secrets' names (Supabase Edge Function secrets, as Davies stored them on 2026-10-29). */
export const CB_KEY_NAME_SECRET = "COINBASE_API_KEY_NAME";
export const CB_PRIVATE_KEY_SECRET = "COINBASE_API_PRIVATE_KEY";
/** A JWT lives two minutes (Coinbase's "expires after 2 minutes"). */
export const CB_JWT_TTL_S = 120;
export const CB_TIMEOUT_MS = 8_000;

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));

/** DER length bytes. */
function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) { out.unshift(n & 0xff); n >>= 8; }
  return [0x80 | out.length, ...out];
}
const der = (tag: number, body: Uint8Array) => new Uint8Array([tag, ...derLen(body.length), ...body]);
/** AlgorithmIdentifier { id-ecPublicKey, prime256v1 }. */
const EC_P256_ALG = new Uint8Array([0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);

/** Pure: a SEC1 ECPrivateKey (P-256) wrapped as PKCS#8, which WebCrypto imports. */
export function sec1ToPkcs8(sec1: Uint8Array): Uint8Array {
  if (sec1[0] !== 0x30) throw new Error("the EC private key is not DER");
  const body = new Uint8Array([0x02, 0x01, 0x00, ...EC_P256_ALG, ...der(0x04, sec1)]);
  return der(0x30, body);
}

/** Pure: the DER bytes of a PEM secret and its kind, with real newlines or literal "\n"s. Throws without echoing it. */
export function pemDer(secret: string): { der: Uint8Array; kind: "sec1" | "pkcs8" } {
  const s = secret.replace(/\\n/g, "\n").trim();
  const m = /-----BEGIN (EC |)PRIVATE KEY-----([\s\S]*?)-----END (EC |)PRIVATE KEY-----/.exec(s);
  if (!m) throw new Error(`${CB_PRIVATE_KEY_SECRET} is not a PEM private key ("-----BEGIN EC PRIVATE KEY-----")`);
  return { der: b64ToBytes(m[2]), kind: m[1] ? "sec1" : "pkcs8" };
}

/** The signing key of an EC PEM, non-extractable (ES256). */
export async function importCbKey(secret: string): Promise<CryptoKey> {
  const { der, kind } = pemDer(secret);
  const pkcs8 = kind === "sec1" ? sec1ToPkcs8(der) : der;
  try {
    return await crypto.subtle.importKey("pkcs8", toArrayBuffer(pkcs8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  } catch {
    throw new Error(`${CB_PRIVATE_KEY_SECRET} is not an ECDSA P-256 key (create the CDP key with the ECDSA signature algorithm)`);
  }
}

export type CbAlg = "ES256" | "EdDSA";
export type CbKeyKind = "pem-ec" | "ed25519" | "unknown";
/** A key ready to sign: its JWT algorithm and the non-extractable CryptoKey. */
export type CbSigner = { alg: CbAlg; key: CryptoKey };
/** PKCS#8's 16 bytes before an Ed25519 seed (RFC 8410). */
const ED25519_PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const startsWith = (b: Uint8Array, p: Uint8Array) => b.length >= p.length && p.every((x, i) => b[i] === x);

/** Pure: the Ed25519 secret's bytes (seed, and the public key when it carries one), or null when it is not one. */
export function ed25519Bytes(secret: string): { seed: Uint8Array; pub: Uint8Array | null } | null {
  const t = secret.replace(/\\n/g, "\n").trim();
  if (t.includes("-----BEGIN")) {
    try {
      const { der, kind } = pemDer(t);
      return kind === "pkcs8" && der.length === 48 && startsWith(der, ED25519_PKCS8_PREFIX) ? { seed: der.slice(16), pub: null } : null;
    } catch { return null; }
  }
  const b = t.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b)) return null;
  let bytes: Uint8Array;
  try { bytes = b64ToBytes(b); } catch { return null; }
  if (bytes.length === 64) return { seed: bytes.slice(0, 32), pub: bytes.slice(32) };
  if (bytes.length === 32) return { seed: bytes, pub: null };
  return null;
}

/** Pure: which kind a private-key secret is, from its shape alone. */
export function cbKeyKind(secret: string): CbKeyKind {
  if (ed25519Bytes(secret)) return "ed25519";
  try { pemDer(secret); return "pem-ec"; } catch { return "unknown"; }
}

/**
 * The signer for whichever kind the secret is: ES256 for an EC PEM, EdDSA for an Ed25519 secret (a 64-byte one's public half
 * must be its seed's). Throws on an unknown kind, naming the secret, never its value.
 */
export async function importCbSigner(secret: string): Promise<CbSigner> {
  const kind = cbKeyKind(secret);
  if (kind === "pem-ec") return { alg: "ES256", key: await importCbKey(secret) };
  if (kind === "unknown") throw new Error(`${CB_PRIVATE_KEY_SECRET} is neither an EC PEM nor an Ed25519 secret (base64 of 64 or 32 bytes)`);
  const { seed, pub } = ed25519Bytes(secret)!;
  const pkcs8 = new Uint8Array([...ED25519_PKCS8_PREFIX, ...seed]);
  try {
    if (pub) {
      const probe = await crypto.subtle.importKey("pkcs8", toArrayBuffer(pkcs8), { name: "Ed25519" }, true, ["sign"]);
      const x = (await crypto.subtle.exportKey("jwk", probe)).x ?? "";
      if (b64url(pub) !== x) throw new Error("mismatch");
    }
    return { alg: "EdDSA", key: await crypto.subtle.importKey("pkcs8", toArrayBuffer(pkcs8), { name: "Ed25519" }, false, ["sign"]) };
  } catch {
    throw new Error(`${CB_PRIVATE_KEY_SECRET} is not a consistent Ed25519 secret (its last 32 bytes must be its seed's public key)`);
  }
}

/** Pure: the `uri` claim, method and host and path, no query string. */
export function jwtUri(method: string, path: string): string {
  return `${method.toUpperCase()} ${CB_ADV_HOST}${path.split("?")[0]}`;
}

/** Pure: the JWT's header and claims for one request at `nowS` (seconds). */
export function jwtParts(keyName: string, method: string, path: string, nowS: number, nonce: string, alg: CbAlg = "ES256") {
  return {
    header: { alg, kid: keyName, nonce, typ: "JWT" },
    claims: { sub: keyName, iss: "cdp", nbf: nowS, exp: nowS + CB_JWT_TTL_S, uri: jwtUri(method, path) },
  };
}

/** One request's JWT. ES256: the raw r || s signature WebCrypto gives, which is JOSE's form; EdDSA: the 64-byte Ed25519 signature. */
export async function cbJwt(key: CryptoKey, keyName: string, method: string, path: string, nowMs: number, nonce?: string, alg: CbAlg = "ES256"): Promise<string> {
  const n = nonce ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const { header, claims } = jwtParts(keyName, method, path, Math.floor(nowMs / 1000), n, alg);
  const input = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const params = alg === "EdDSA" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
  const sig = new Uint8Array(await crypto.subtle.sign(params, key, enc.encode(input)));
  return `${input}.${b64url(sig)}`;
}

// ------------------------------------------------------------------------------------------------------------ shapes

export type CbSide = "BUY" | "SELL";
/** An order's configuration as this path sends it: post-only GTC or GTD limits, and the IOC limit of the 24-hour stop. */
export type CbOrderConfig =
  | { limit_limit_gtc: { base_size: string; limit_price: string; post_only: boolean } }
  | { limit_limit_gtd: { base_size: string; limit_price: string; end_time: string; post_only: boolean } }
  | { sor_limit_ioc: { base_size: string; limit_price: string } };
export type CbCreateBody = { client_order_id: string; product_id: string; side: CbSide; order_configuration: CbOrderConfig };
export type CbCreateResult = {
  success: boolean;
  success_response?: { order_id: string; product_id?: string; side?: string; client_order_id?: string };
  error_response?: { error?: string; message?: string; error_details?: string; preview_failure_reason?: string; new_order_failure_reason?: string };
};
export type CbOrderStatus = "PENDING" | "OPEN" | "FILLED" | "CANCELLED" | "EXPIRED" | "FAILED" | "UNKNOWN_ORDER_STATUS" | "QUEUED" | "CANCEL_QUEUED" | "EDIT_QUEUED";
export type CbOrder = {
  order_id: string; client_order_id: string; product_id: string; side: CbSide; status: CbOrderStatus;
  filled_size?: string; average_filled_price?: string; total_fees?: string; created_time?: string; reject_reason?: string; reject_message?: string; cancel_message?: string;
};
export type CbFill = {
  entry_id: string; trade_id: string; order_id: string; trade_time: string; trade_type?: string; price: string; size: string; commission: string;
  product_id: string; liquidity_indicator?: string; side: CbSide;
};
export type CbAccount = { uuid?: string; currency: string; available_balance?: { value: string; currency: string }; hold?: { value: string; currency: string } };
export type CbProductInfo = {
  product_id: string; base_increment: string; quote_increment: string; base_min_size: string; base_max_size?: string; quote_min_size?: string;
  status?: string; trading_disabled?: boolean; cancel_only?: boolean; limit_only?: boolean; post_only?: boolean; price?: string;
};
/** A product's book as `productBook` reads it: levels [price, size], best first, and the time Coinbase gives the read. */
export type CbProductBook = { bids: Array<[number, number]>; asks: Array<[number, number]>; time: string | null };
/** An order's state ends here: no fill can follow. */
export const CB_DONE: readonly CbOrderStatus[] = ["FILLED", "CANCELLED", "EXPIRED", "FAILED"];
export type CbKeyPermissions = { can_view?: boolean; can_trade?: boolean; can_transfer?: boolean; portfolio_uuid?: string; portfolio_type?: string };
/** Statuses an order may still rest or fill in. */
export const CB_ALIVE: readonly CbOrderStatus[] = ["PENDING", "OPEN", "QUEUED", "CANCEL_QUEUED", "EDIT_QUEUED"];

export class CbHttpError extends Error {
  constructor(readonly status: number, readonly method: string, readonly path: string, body: string) {
    super(`coinbase ${method} ${path.split("?")[0]} → ${status}: ${body.slice(0, 300)}`);
  }
}

/** Pure: a GET's query string, arrays as repeated keys (`product_ids=A&product_ids=B`), as the API reads them. */
export function cbQuery(q: Record<string, string | number | readonly string[] | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v == null) continue;
    for (const x of Array.isArray(v) ? v : [v]) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(x))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/** The authenticated client. `fetchImpl` and `now` are seams for the tests; `post` false refuses every non-GET. */
export type CbClient = ReturnType<typeof cbClient>;
export function cbClient(o: { key: CryptoKey; keyName: string; alg?: CbAlg; fetchImpl?: typeof fetch; now?: () => number; post: boolean }) {
  const f = o.fetchImpl ?? fetch, now = o.now ?? Date.now;
  const call = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    // A read-only client sends GETs and one POST, the order preview, which places nothing.
    if (method !== "GET" && !o.post && path !== CB_PREVIEW_PATH) throw new Error(`coinbase ${method} ${path} refused: this client is read-only (dry-run or probe)`);
    const jwt = await cbJwt(o.key, o.keyName, method, path, now(), undefined, o.alg ?? "ES256");
    const res = await f(`${CB_ADV_BASE}${path}`, {
      method, headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json", accept: "application/json" },
      body: body == null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(CB_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new CbHttpError(res.status, method, path, text);
    return (text ? JSON.parse(text) : {}) as T;
  };
  const P = CB_ADV_PATH;
  return {
    accounts: async (): Promise<CbAccount[]> => {
      const out: CbAccount[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const r = await call<{ accounts?: CbAccount[]; has_next?: boolean; cursor?: string }>("GET", `${P}/accounts${cbQuery({ limit: 250, cursor })}`);
        out.push(...(r.accounts ?? []));
        if (!r.has_next || !r.cursor) break;
        cursor = r.cursor;
      }
      return out;
    },
    /** What the key may do and which portfolio it sees (`view` is enough to ask). */
    keyPermissions: () => call<CbKeyPermissions>("GET", `${P}/key_permissions`),
    product: (id: string) => call<CbProductInfo>("GET", `${P}/products/${encodeURIComponent(id)}`),
    bestBidAsk: async (id: string): Promise<{ bid: number | null; ask: number | null }> => {
      const r = await call<{ pricebooks?: Array<{ product_id: string; bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }> }>("GET", `${P}/best_bid_ask${cbQuery({ product_ids: [id] })}`);
      const b = (r.pricebooks ?? []).find((x) => x.product_id === id);
      const px = (s?: string) => (s != null && Number(s) > 0 ? Number(s) : null);
      return { bid: px(b?.bids?.[0]?.price), ask: px(b?.asks?.[0]?.price) };
    },
    /**
     * The product's book with its sizes (`GET …/product_book`, "Get Product Book": `product_id`, `limit` levels a side): each
     * side's levels best first as [price, size] in numbers, and Coinbase's `time` of the read. A GET, so a read-only client may.
     */
    productBook: async (id: string, limit = 50): Promise<CbProductBook> => {
      const r = await call<{ pricebook?: { product_id?: string; bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }>; time?: string } }>(
        "GET", `${P}/product_book${cbQuery({ product_id: id, limit })}`);
      const lv = (xs?: Array<{ price: string; size: string }>) => (xs ?? []).map((x) => [Number(x.price), Number(x.size)] as [number, number]).filter(([p, q]) => p > 0 && q >= 0);
      return { bids: lv(r.pricebook?.bids), asks: lv(r.pricebook?.asks), time: r.pricebook?.time ?? null };
    },
    feeTier: (product_type = "SPOT") => call<{ fee_tier?: { pricing_tier?: string; maker_fee_rate?: string; taker_fee_rate?: string } }>("GET", `${P}/transaction_summary${cbQuery({ product_type })}`),
    getOrder: async (orderId: string): Promise<CbOrder> => (await call<{ order: CbOrder }>("GET", `${P}/orders/historical/${encodeURIComponent(orderId)}`)).order,
    /** Orders of a product created at or after `since` (ms), every page; or those OPEN when `open`. */
    listOrders: async (productId: string, opt: { since?: number; open?: boolean }): Promise<CbOrder[]> => {
      const out: CbOrder[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const q = cbQuery({ product_ids: [productId], order_status: opt.open ? ["OPEN"] : undefined, start_date: opt.since != null ? new Date(opt.since).toISOString() : undefined, limit: 250, cursor });
        const r = await call<{ orders?: CbOrder[]; has_next?: boolean; cursor?: string }>("GET", `${P}/orders/historical/batch${q}`);
        out.push(...(r.orders ?? []));
        if (!r.has_next || !r.cursor) break;
        cursor = r.cursor;
      }
      return out;
    },
    fills: async (orderIds: string[]): Promise<CbFill[]> => {
      const out: CbFill[] = [];
      for (let i = 0; i < orderIds.length; i += 50) {
        let cursor: string | undefined;
        for (let p = 0; p < 20; p++) {
          const r = await call<{ fills?: CbFill[]; cursor?: string }>("GET", `${P}/orders/historical/fills${cbQuery({ order_ids: orderIds.slice(i, i + 50), limit: 250, cursor })}`);
          out.push(...(r.fills ?? []));
          if (!r.cursor || !(r.fills ?? []).length) break;
          cursor = r.cursor;
        }
      }
      return out;
    },
    create: (body: CbCreateBody) => call<CbCreateResult>("POST", `${P}/orders`, body),
    /** What Coinbase would say to an order, placing nothing (`errs`: the failure reasons it would have). */
    preview: (body: Omit<CbCreateBody, "client_order_id">) => call<{ errs?: string[]; warning?: string[]; preview_id?: string; order_total?: string; commission_total?: string }>("POST", CB_PREVIEW_PATH, body),
    cancel: async (orderIds: string[]) => (await call<{ results?: Array<{ success: boolean; order_id: string; failure_reason?: string }> }>("POST", `${P}/orders/batch_cancel`, { order_ids: orderIds })).results ?? [],
  };
}

/**
 * The client from the function's secrets, or why there is none (naming the secret, never its value). `post` false (dry-run,
 * the probe) gives a client that cannot send anything but a GET.
 */
export async function cbClientFromEnv(read: (n: string) => string | undefined, post: boolean, fetchImpl?: typeof fetch, now?: () => number):
  Promise<{ client: CbClient | null; why: string | null; form: CbKeyForm }> {
  const keyName = read(CB_KEY_NAME_SECRET)?.trim(), pem = read(CB_PRIVATE_KEY_SECRET);
  const form = cbKeyForm(keyName, pem);
  if (!keyName || !pem) return { client: null, why: `${!keyName ? CB_KEY_NAME_SECRET : CB_PRIVATE_KEY_SECRET} is not set`, form };
  try {
    const signer = await importCbSigner(pem);
    return { client: cbClient({ key: signer.key, alg: signer.alg, keyName, fetchImpl, now, post }), why: null, form };
  } catch (e) {
    return { client: null, why: e instanceof Error ? e.message : "the private key could not be read", form };
  }
}

/** What the secrets look like, with nothing of their values: the key name's form and the private key's. */
export type CbKeyForm = { name: "organizations-path" | "bare-id" | "missing" | "other"; key: CbKeyKind | "missing"; escapedNewlines: boolean };
/** Pure. */
export function cbKeyForm(keyName: string | undefined, pem: string | undefined): CbKeyForm {
  const n = keyName?.trim();
  const name = !n ? "missing" : /^organizations\/[^/\s]+\/apiKeys\/[^/\s]+$/.test(n) ? "organizations-path" : /^[0-9a-f-]{20,}$/i.test(n) ? "bare-id" : "other";
  const key: CbKeyForm["key"] = pem ? cbKeyKind(pem) : "missing";
  return { name, key, escapedNewlines: !!pem && pem.includes("\\n") };
}
