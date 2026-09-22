// Revolut X REST client for the agents feature.
//
// Base https://revx.revolut.com, paths under /api/1.0. Every authenticated
// request carries three headers — X-Revx-API-Key (the 64-char key id),
// X-Revx-Timestamp (epoch ms) and X-Revx-Signature (base64 Ed25519 over
// `timestamp + METHOD + path-from-/api + query + minified-body`, no
// separators). The private half of the key pair is the secret; the key id
// alone signs nothing. Money values are strings on the wire and stay
// strings here; symbols are BTC-USD in requests and BTC/USD in responses.
// docs/agents/reference.md §2 has the verified detail and the limits — the
// one that shapes everything is the place-order endpoint's 1,000-per-day
// token bucket.
//
// Signing runs on WebCrypto's native Ed25519 (checked on Deno 2.9.6). The
// private key may arrive from the secrets store in any of the shapes a
// person pastes: a PEM with real newlines, a PEM with literal "\n", the
// bare base64 of the 48-byte PKCS#8 DER, or a 32-byte seed as base64 or
// hex. `loadPrivateKey` accepts all four and reports which, never the key.
//
// The signed string, per the official reference (revolut-x-api-for-llm.md,
// "Signing Algorithm"): timestamp, then the METHOD, then the path from
// `/api`, then the query string WITHOUT its leading "?", then the minified
// body — no separators anywhere. So `/api/1.0/orders/active?limit=10`
// is signed as `…GET/api/1.0/orders/activelimit=10`, while the request
// itself still goes to the URL with the "?". `signingMessage` takes the
// path and the query separately so that cannot be got wrong by accident.

import { b64ToBytes, bytesToB64, concatBytes as concat, hexToBytes, toArrayBuffer } from "./bytes.ts";
import type { PairConfig as SizingConfig } from "./agents_strategy.ts";
import type { OrderView, PlaceResult, Quote, Venue } from "./venue.ts";

export const REVX_BASE = "https://revx.revolut.com";

const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420"; // 16 bytes before the 32-byte seed

export type KeyForm = "pem" | "pkcs8-b64" | "seed-b64" | "seed-hex";

/**
 * Pure: the PKCS#8 DER bytes for whatever shape the secret is in, and
 * which shape that was. Throws on anything it cannot read.
 */
export function privateKeyDer(secret: string): { der: Uint8Array; form: KeyForm } {
  const raw = secret.trim().replace(/\\n/g, "\n");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) {
    const body = raw.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    const der = b64ToBytes(body);
    if (der.length !== 48) throw new Error(`PEM decodes to ${der.length} bytes, expected a 48-byte Ed25519 PKCS#8`);
    return { der, form: "pem" };
  }
  const compact = raw.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]{64}$/.test(compact)) {
    return { der: concat(hexToBytes(PKCS8_ED25519_PREFIX), hexToBytes(compact)), form: "seed-hex" };
  }
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    const bytes = b64ToBytes(compact);
    if (bytes.length === 48) return { der: bytes, form: "pkcs8-b64" };
    if (bytes.length === 32) return { der: concat(hexToBytes(PKCS8_ED25519_PREFIX), bytes), form: "seed-b64" };
    throw new Error(`base64 decodes to ${bytes.length} bytes, expected 48 (PKCS#8) or 32 (seed)`);
  }
  throw new Error("private key is not PEM, base64 or hex");
}



export async function loadPrivateKey(secret: string): Promise<{ key: CryptoKey; form: KeyForm }> {
  const { der, form } = privateKeyDer(secret);
  const key = await crypto.subtle.importKey("pkcs8", toArrayBuffer(der), { name: "Ed25519" }, false, ["sign"]);
  return { key, form };
}

/**
 * Pure: the exact string the venue expects to be signed. `path` starts at
 * `/api` and carries no query; `query` is everything after the "?" (or
 * empty). Matches the reference's own example byte for byte — see
 * revx.test.ts.
 */
export function signingMessage(timestampMs: number, method: string, path: string, query = "", body = ""): string {
  return `${timestampMs}${method.toUpperCase()}${path}${query}${body}`;
}

/** Split a wire path into the signed path and the signed query (no "?"). */
export function splitPath(pathWithQuery: string): { path: string; query: string } {
  const i = pathWithQuery.indexOf("?");
  return i < 0 ? { path: pathWithQuery, query: "" } : { path: pathWithQuery.slice(0, i), query: pathWithQuery.slice(i + 1) };
}

export async function signMessage(key: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, toArrayBuffer(new TextEncoder().encode(message)));
  return bytesToB64(new Uint8Array(sig));
}

export type RevxEnv = { apiKey: string; privateKey: CryptoKey };

export type RevxResponse<T> = { ok: true; status: number; data: T; raw: string } | { ok: false; status: number; error: string; raw: string };

/**
 * One authenticated call. `path` is the wire path from `/api`, search
 * included (e.g. `/api/1.0/candles/BTC-USD?interval=240&since=…`); the
 * query is signed without its "?" as the venue requires. The body, when
 * present, is sent exactly as signed (JSON.stringify — minified).
 */
export async function revxFetch<T = unknown>(
  env: RevxEnv,
  method: "GET" | "POST" | "DELETE" | "PUT",
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<RevxResponse<T>> {
  const ts = Date.now();
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const { path: signedPath, query } = splitPath(path);
  const signature = await signMessage(env.privateKey, signingMessage(ts, method, signedPath, query, bodyText));
  const res = await fetchImpl(`${REVX_BASE}${path}`, {
    method,
    headers: {
      "X-Revx-API-Key": env.apiKey,
      "X-Revx-Timestamp": String(ts),
      "X-Revx-Signature": signature,
      "Accept": "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : bodyText,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) {
    let msg = raw.slice(0, 300);
    try { const j = JSON.parse(raw); if (typeof j?.message === "string") msg = j.message; } catch { /* keep raw */ }
    return { ok: false, status: res.status, error: msg, raw };
  }
  if (res.status === 204 || raw === "") return { ok: true, status: res.status, data: null as T, raw };
  try {
    return { ok: true, status: res.status, data: JSON.parse(raw) as T, raw };
  } catch {
    return { ok: false, status: res.status, error: "non-JSON body", raw };
  }
}

// ------------------------------------------------------------- endpoints

export type Balance = { currency: string; available: string; reserved: string; total: string; staked?: string };
export type PairConfig = {
  base: string; quote: string; base_step: string; quote_step: string;
  min_order_size: string; max_order_size: string; min_order_size_quote: string; max_order_size_quote: string;
  status: string; slippage?: number;
};
export type VenueCandle = { start: number; open: string; high: string; low: string; close: string; volume: string };
export type Ticker = { symbol: string; bid: string; ask: string; mid: string; last_price: string; region?: string };
export type OrderPlacement = { venue_order_id: string; client_order_id: string; state: string };
/**
 * A Revolut X order as the venue returns it. TWO vocabularies are read, the documented one first.
 *
 * Documented (GET /1.0/orders/{id}, /orders/active and /orders/historical, in both `revolut-x-api-for-llm.md` from
 * revolut-engineering/revolut-x-api and developer.revolut.com, fetched 2026-09-20): `id`, `status`, `filled_quantity`,
 * `average_fill_price`, `total_fee` with `fee_currency`. Assumed (what this client was written against before any order
 * had been read back): `venue_order_id`, `state`, `filled_size`, `fees`.
 *
 * Reading only the assumed names, a reply in the documented names carried no `state` and no `filled_size`, so a FILLED
 * order read as "new, nothing filled": the missing-field guard (B4) never fired, the floor saw no position, and an hour
 * later the too-old cancel settled real coins as `cancelled` and freed the pair to buy them again. Both are read until
 * the first live read-back shows which one the venue sends; nothing is ever inferred from a field that is absent.
 */
export type VenueOrder = {
  id?: string; venue_order_id?: string; client_order_id?: string; symbol: string; side: "buy" | "sell";
  status?: string; state?: string; type?: string; order_type?: string;
  price?: string; quantity?: string; base_size?: string; quote_size?: string; leaves_quantity?: string;
  filled_quantity?: string; filled_size?: string; average_fill_price?: string;
  total_fee?: string; fees?: string; fee_currency?: string;
  created_date?: number; updated_date?: number; created_at?: number; updated_at?: number;
};

/** The order states Revolut X documents. Any other value — or none — is a reply this client cannot read. */
export const REVX_ORDER_STATES = ["pending_new", "new", "partially_filled", "filled", "cancelled", "rejected", "replaced"] as const;

/** One order in the client's terms: each documented field first, the assumed name as the fallback. */
export function readOrder(vo: VenueOrder) {
  return {
    id: vo.id ?? vo.venue_order_id,
    state: vo.status ?? vo.state,
    filled: vo.filled_quantity ?? vo.filled_size,
    avg: vo.average_fill_price,
    fee: vo.total_fee ?? vo.fees,
    feeCurrency: vo.fee_currency,
  };
}
const baseAssetOf = (symbol: string) => symbol.split(/[/-]/)[0];
const quoteAssetOf = (symbol: string) => symbol.split(/[/-]/)[1];

/** BTC/USD → BTC-USD (requests use the dash form). */
export const toPathSymbol = (s: string) => s.replace("/", "-");
/** BTC-USD → BTC/USD (responses use the slash form). */
export const toSlashSymbol = (s: string) => s.replace("-", "/");

export const balances = (env: RevxEnv, f?: typeof fetch) =>
  revxFetch<Balance[]>(env, "GET", "/api/1.0/balances", undefined, f);

export const pairs = (env: RevxEnv, f?: typeof fetch) =>
  revxFetch<Record<string, PairConfig>>(env, "GET", "/api/1.0/configuration/pairs", undefined, f);


/** `interval` in MINUTES (1,5,15,30,60,240,1440,…); at most 1,000 candles per call. */
export const candles = (env: RevxEnv, symbol: string, intervalMin: number, sinceMs: number, untilMs: number, f?: typeof fetch) =>
  revxFetch<{ data: VenueCandle[] }>(env, "GET",
    `/api/1.0/candles/${toPathSymbol(symbol)}?interval=${intervalMin}&since=${Math.floor(sinceMs)}&until=${Math.floor(untilMs)}`, undefined, f);

/**
 * `time_in_force` at placement takes `gtc` or `ioc` only, and `post_only` never goes with `ioc`. The venue's own
 * TypeScript client says so (revolut-engineering/revolut-x-api, `api/src/types/orders.ts`: `PlaceTimeInForce = "gtc" |
 * "ioc"`, sent as `order_configuration.limit.time_in_force`; its zod schema refuses anything else) and so does its CLI
 * (`--time-in-force gtc|ioc  # Limit orders only, gtc by default`; `--post-only … cannot combine with ioc`), all read
 * 2026-09-22. The same repository's `revolut-x-api-for-llm.md` says the field "cannot be set during order placement";
 * the client and the CLI, which place orders, are taken over the prose. `fok` exists only on an order READ back.
 */
export type PlaceTimeInForce = "gtc" | "ioc";
export type LimitOrderRequest = {
  client_order_id: string;
  symbol: string;              // dash form
  side: "buy" | "sell";
  order_configuration: {
    limit: { base_size: string; price: string; execution_instructions: ("post_only" | "allow_taker")[]; time_in_force?: PlaceTimeInForce };
  };
};
export type MarketOrderRequest = {
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  order_configuration: { market: { base_size: string } | { quote_size: string } };
};

/** The placement reply's `data` is an OBJECT in the documented schema and an ARRAY in the documented sample; both are read. */
export const placeOrder = (env: RevxEnv, order: LimitOrderRequest | MarketOrderRequest, f?: typeof fetch) =>
  revxFetch<{ data: OrderPlacement[] | OrderPlacement }>(env, "POST", "/api/1.0/orders", order, f);

export const cancelOrder = (env: RevxEnv, venueOrderId: string, f?: typeof fetch) =>
  revxFetch<null>(env, "DELETE", `/api/1.0/orders/${venueOrderId}`, undefined, f);

export const getOrder = (env: RevxEnv, venueOrderId: string, f?: typeof fetch) =>
  revxFetch<{ data: VenueOrder }>(env, "GET", `/api/1.0/orders/${venueOrderId}`, undefined, f);

export const activeOrders = (env: RevxEnv, f?: typeof fetch) =>
  revxFetch<{ data: VenueOrder[] }>(env, "GET", "/api/1.0/orders/active", undefined, f);



/** Venue candle (strings) → the numeric candle the strategy maths reads. */
export function toCandle(c: VenueCandle): { start: number; open: number; high: number; low: number; close: number; volume: number } {
  return { start: c.start, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume) };
}

// ----------------------------------------------------------- keyless reads

/** The market-data endpoints under /public need no key. Same envelope handling as the signed calls. */
/** How long a 429 on the public bucket (about one token a second, reference §2) is waited out before the retry. */
export const PUBLIC_RETRY_MS = 1_100;
export const PUBLIC_RETRIES = 2;

/**
 * A keyless public call. The one-minute loop makes half a dozen of these
 * in a row each turn, and the public bucket refills at about a token a
 * second, so a 429 is waited out and retried (twice at most) rather than
 * reported as the venue being down.
 */
export async function revxPublic<T = unknown>(
  path: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8_000, pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<RevxResponse<T>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${REVX_BASE}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    const raw = await res.text();
    if (res.status === 429 && attempt < PUBLIC_RETRIES) { await pause(PUBLIC_RETRY_MS * (attempt + 1)); continue; }
    if (!res.ok) {
      let msg = raw.slice(0, 300);
      try { const j = JSON.parse(raw); if (typeof j?.message === "string") msg = j.message; } catch { /* keep raw */ }
      return { ok: false, status: res.status, error: msg, raw };
    }
    try { return { ok: true, status: res.status, data: JSON.parse(raw) as T, raw }; }
    catch { return { ok: false, status: res.status, error: "non-JSON body", raw }; }
  }
}

/**
 * Revolut X publishes TWO books per pair, one per region (`UK` / `EEA`),
 * and an account trades on its own region's — decided by the account,
 * not the request (reference §2.2). This account is UK. The public
 * tickers and candles take `region`; without it the tickers return both
 * rows in arbitrary order and the candles are the EEA book's. Measured
 * 2026-09-21 01:48 UTC: UK SOL/USD 112.180 / 112.181, EEA 111.865 /
 * 112.371 — and the loop had been keeping whichever row came last, so a
 * paper rule lifted an EEA ask this account cannot trade (§3.5). Every
 * market-data call names the region, and a ticker row from another
 * region is dropped rather than trusted.
 */
export type RevxRegion = "UK" | "EEA";
export const REVX_REGION: RevxRegion = "UK";

export const publicCandles = (symbol: string, intervalMin: number, sinceMs: number, untilMs: number, f?: typeof fetch, region: RevxRegion = REVX_REGION) =>
  revxPublic<{ data: VenueCandle[] }>(`/api/1.0/public/candles/${toPathSymbol(symbol)}?interval=${intervalMin}&since=${Math.floor(sinceMs)}&until=${Math.floor(untilMs)}&region=${region}`, f);

export const publicTickers = (symbols: string[], f?: typeof fetch, region: RevxRegion = REVX_REGION) =>
  revxPublic<{ data: Ticker[] }>(`/api/1.0/public/tickers?symbols=${symbols.map(toPathSymbol).join(",")}&region=${region}`, f);

/**
 * One region's quotes out of a ticker list. A row naming another region
 * is dropped; a row naming none is trusted (the filtered endpoint omits
 * nothing, but a client that forgot the parameter used to get both).
 */
export function quotesForRegion(rows: Ticker[], region: RevxRegion = REVX_REGION): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const t of rows) {
    if (t.region && t.region !== region) continue;
    out[t.symbol] = { bid: Number(t.bid), ask: Number(t.ask) };
  }
  return out;
}

export const publicPairs = (f?: typeof fetch) =>
  revxPublic<Record<string, PairConfig>>("/api/1.0/public/configuration/pairs", f);

// ----------------------------------------------------------------- venue

/** Fees verified in docs/agents/reference.md §2: 0 % maker, 0.09 % taker. */
export const REVX_FEE_BPS = { maker: 0, taker: 9 };

/**
 * A filled order whose reply lacks the fields settlement reads is an ERROR,
 * not a zero. `filled_size`, `average_fill_price` and `fees` are the names
 * the client expects; until a live order has been read back they are
 * unverified (reference §2 documents neither order read), and a fee
 * recorded as 0 because the field was called something else would flatter
 * every live P&L and the daily loss breaker with it. The message names the
 * fields the reply DID carry, so the first live order tells us the truth.
 */
export function orderViewProblem(vo: VenueOrder): string | null {
  const o = readOrder(vo);
  const present = `fields present: ${Object.keys(vo).join(", ")}`;
  // An unknown state — or none — is not "new with nothing filled". Read that way, a filled order whose reply used other
  // names looked like a resting one, and the too-old cancel later settled it as cancelled with the coins still bought.
  if (!o.state || !(REVX_ORDER_STATES as readonly string[]).includes(o.state)) {
    return `order ${o.id} has state ${JSON.stringify(o.state ?? null)}, which this client does not know (${present}); not settled`;
  }
  // The loop never replaces an order, so a replaced one is not a state it can settle: its fills live on its successor.
  if (o.state === "replaced") return `order ${o.id} was replaced (${present}); not settled`;
  if (o.filled != null && !Number.isFinite(Number(o.filled))) return `order ${o.id} is ${o.state} but filled_quantity/filled_size ${JSON.stringify(o.filled)} is not a number; not settled`;
  const filled = o.state === "filled" || Number(o.filled ?? 0) > 0;
  if (!filled) return null;
  // A reply that says `filled` while reporting nothing filled is a venue quirk, not a fill: `tick.ts` falls back to
  // `base_size` when `filledBase` is 0, so this would book the WHOLE order and the next exit would try to sell coins
  // that are not there. Absent fields are checked below; zero is a present field saying the opposite.
  if (o.state === "filled" && o.filled != null && Number(o.filled) === 0) {
    return `order ${o.id} is filled but its reply says filled_size 0; not settled`;
  }
  const fields = [["filled_quantity/filled_size", o.filled], ["average_fill_price", o.avg], ["total_fee/fees", o.fee]] as const;
  const missing = fields.filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length) return `order ${o.id} is ${o.state} but its reply has no ${missing.join(", ")} (${present}); not settled`;
  // Present is not enough: `Number("0.072 USD")` is NaN, which JSON writes as null, which `fee_usd NOT NULL` refuses —
  // the settle would throw every minute and the fill would never reach the book.
  const bad = fields.filter(([, v]) => !Number.isFinite(Number(v))).map(([k]) => k);
  if (bad.length) return `order ${o.id} is ${o.state} but its ${bad.join(", ")} ${bad.length > 1 ? "are" : "is"} not a number (${present}); not settled`;
  if (o.feeCurrency && o.feeCurrency !== quoteAssetOf(vo.symbol) && o.feeCurrency !== baseAssetOf(vo.symbol)) {
    return `order ${o.id} charged its fee in ${o.feeCurrency}, neither side of ${vo.symbol}; not settled`;
  }
  return null;
}

/** A venue order → the settlement view the tick acts on. A cancelled order with fills counts as filled for that volume. */
export function toOrderView(vo: VenueOrder): OrderView {
  const o = readOrder(vo);
  const filledBase = Number(o.filled ?? 0);
  const state = o.state === "filled" ? "filled"
    : o.state === "cancelled" ? (filledBase > 0 ? "filled" : "cancelled")
    : o.state === "rejected" ? "rejected"
    : filledBase > 0 ? "partially_filled" : "new";
  const avgPrice = filledBase > 0 ? Number(o.avg ?? NaN) || null : null;
  // A fee taken in the coin is a fee in dollars at the fill price; `orderViewProblem` refuses any other currency.
  const fee = Number(o.fee ?? 0);
  const feeUsd = o.feeCurrency && o.feeCurrency === baseAssetOf(vo.symbol) ? (avgPrice ? fee * avgPrice : 0) : fee;
  return { state, filledBase, avgPrice, feeUsd, raw: vo };
}

/**
 * The Revolut X venue for the tick. Market data comes from the keyless
 * public endpoints whether or not a key is loaded — the same data, and it
 * spends none of the signed-call budget. The key is only for balances and
 * orders.
 */
export function revxVenue(env: RevxEnv | null, fetchImpl: typeof fetch = fetch, region: RevxRegion = REVX_REGION): Venue {
  return {
    id: "revx",
    canTrade: !!env,
    feeBps: { ...REVX_FEE_BPS },
    async candles(symbol, intervalMin, sinceMs, untilMs) {
      const r = await publicCandles(symbol, intervalMin, sinceMs, untilMs, fetchImpl, region);
      if (!r.ok) throw new Error(`revx candles ${intervalMin}m → ${r.status} ${r.error}`);
      return (r.data?.data ?? []).map(toCandle).sort((a, b) => a.start - b.start);
    },
    async quotes(symbols) {
      const r = await publicTickers(symbols, fetchImpl, region);
      if (!r.ok) throw new Error(`revx tickers → ${r.status} ${r.error}`);
      return quotesForRegion(r.data?.data ?? [], region);
    },
    async pairs(symbols) {
      const r = await publicPairs(fetchImpl);
      if (!r.ok) throw new Error(`revx pairs → ${r.status} ${r.error}`);
      const out: Record<string, SizingConfig> = {};
      for (const s of symbols) {
        const p = r.data?.[s];
        if (p) out[s] = { base_step: p.base_step, quote_step: p.quote_step, min_order_size: p.min_order_size, min_order_size_quote: p.min_order_size_quote };
      }
      return out;
    },
    async placeLimit(o): Promise<PlaceResult> {
      if (!env) return { ok: false, status: 0, error: "no Revolut X credentials", response: null };
      const request: LimitOrderRequest = {
        client_order_id: o.clientOrderId, symbol: toPathSymbol(o.symbol), side: o.side,
        order_configuration: { limit: { base_size: o.base, price: o.price, execution_instructions: [o.marketable ? "allow_taker" : "post_only"], time_in_force: o.marketable ? "ioc" : "gtc" } },
      };
      const r = await placeOrder(env, request, fetchImpl);
      if (!r.ok) return { ok: false, status: r.status, error: r.error, response: { request, raw: r.raw.slice(0, 500) } };
      const d0 = r.data?.data;
      const first = Array.isArray(d0) ? d0[0] : d0;
      if (!first?.venue_order_id) return { ok: false, status: r.status, error: "no venue_order_id in reply", response: { request, result: r.data } };
      return { ok: true, venueOrderId: first.venue_order_id, state: first.state === "filled" ? "filled" : "new", response: { request, result: r.data } };
    },
    async cancel(venueOrderId) {
      if (!env) return { ok: false, error: "no Revolut X credentials" };
      const r = await cancelOrder(env, venueOrderId, fetchImpl);
      return r.ok ? { ok: true } : { ok: false, error: `${r.status} ${r.error}` };
    },
    async order(venueOrderId) {
      if (!env) return { ok: false, error: "no Revolut X credentials" };
      const r = await getOrder(env, venueOrderId, fetchImpl);
      if (!r.ok) return { ok: false, error: `${r.status} ${r.error}` };
      if (!r.data?.data) return { ok: false, error: "empty order reply" };
      const problem = orderViewProblem(r.data.data);
      if (problem) return { ok: false, error: problem };
      return { ok: true, view: toOrderView(r.data.data) };
    },
    async balances() {
      if (!env) return {};
      const r = await balances(env, fetchImpl);
      if (!r.ok) throw new Error(`revx balances → ${r.status} ${r.error}`);
      const out: Record<string, number> = {};
      for (const b of r.data ?? []) out[b.currency] = Number(b.total);
      return out;
    },
    async activeOrders() {
      if (!env) return { ok: false, error: "no Revolut X credentials" };
      const r = await activeOrders(env, fetchImpl);
      if (!r.ok) return { ok: false, error: `${r.status} ${r.error}` };
      const byClientId: Record<string, { venueOrderId: string; view: OrderView }> = {};
      for (const vo of r.data?.data ?? []) {
        const id = readOrder(vo).id;
        // An entry this client cannot read is left out: its `pending` row then stays pending, reported, for a person —
        // never reconciled from a guess.
        if (vo.client_order_id && id && !orderViewProblem(vo)) byClientId[vo.client_order_id] = { venueOrderId: id, view: toOrderView(vo) };
      }
      return { ok: true, byClientId };
    },
  };
}
