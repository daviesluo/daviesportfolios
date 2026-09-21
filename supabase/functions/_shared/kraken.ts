// Kraken (Kraken Pro) spot REST client for the agents feature.
//
// Base https://api.kraken.com, API version 0. Public endpoints are plain
// GETs under /0/public and need no key. Private endpoints are POSTs under
// /0/private with a form-encoded body that starts with an always-increasing
// `nonce`, and two headers: `API-Key` (the public half) and `API-Sign` =
// base64( HMAC-SHA512( key = base64-decoded secret,
//                      message = path + SHA256(nonce + body) ) ).
// The documented test vector is pinned in kraken.test.ts, so the signing
// cannot drift silently. docs/agents/reference.md §2b has every verified
// fact about the venue, and the two that shape the design: maker fee
// 0.40 % / taker 0.80 % at the lowest volume tier (TradeVolume reports the
// account's own), and the OHLC endpoint's 720-candle ceiling.
//
// Naming: requests take the pair's `altname` (XBTUSD, ETHUSD, SOLUSD);
// responses are keyed by the pair's primary id (XXBTZUSD, XETHZUSD,
// SOLUSD) and balances by asset codes (XXBT, XETH, SOL, ZUSD). This module
// speaks the site's slash symbols (BTC/USD) at its edges and translates at
// the wire, both ways.
//
// Every response is `{ error: string[], result?: … }` with HTTP 200 even
// for a refused request; a non-empty `error` is the failure. `EOrder:…`,
// `EAPI:…`, `EGeneral:…`, `EService:…` prefixes tell severity/category.

import { b64ToBytes, bytesToB64, concatBytes, toArrayBuffer } from "./bytes.ts";
import type { Candle, PairConfig } from "./agents_strategy.ts";
import type { OrderView, PlaceResult, Quote, Venue, VenueOrderState } from "./venue.ts";

export const KRAKEN_BASE = "https://api.kraken.com";

/** Lowest volume tier of the published schedule, 2026-09-20. TradeVolume overrides at run time. */
export const KRAKEN_DEFAULT_FEE_BPS = { maker: 40, taker: 80 };

/** Slash symbol → request altname. Only the pairs the agents trade (reference §2b); anything else throws on purpose. */
export const KRAKEN_ALTNAME: Record<string, string> = { "BTC/USD": "XBTUSD", "ETH/USD": "ETHUSD", "SOL/USD": "SOLUSD", "XRP/USD": "XRPUSD", "AVAX/USD": "AVAXUSD", "SUI/USD": "SUIUSD" };
/** Slash symbol → the primary id responses are keyed by. */
export const KRAKEN_PAIR_ID: Record<string, string> = { "BTC/USD": "XXBTZUSD", "ETH/USD": "XETHZUSD", "SOL/USD": "SOLUSD", "XRP/USD": "XXRPZUSD", "AVAX/USD": "AVAXUSD", "SUI/USD": "SUIUSD" };   // AVAX joined trend-4h with 0039 (§3.7), SUI with 0040 (§3.8)
/** Asset code on the wire → the currency the site names. */
export const KRAKEN_ASSET: Record<string, string> = {
  XXBT: "BTC", XBT: "BTC", XETH: "ETH", ETH: "ETH", SOL: "SOL", XXRP: "XRP", XRP: "XRP", AVAX: "AVAX", SUI: "SUI",
  ZUSD: "USD", USD: "USD", ZGBP: "GBP", GBP: "GBP", ZEUR: "EUR", EUR: "EUR", USDC: "USDC", USDT: "USDT",
};

export function toAltname(symbol: string): string {
  const a = KRAKEN_ALTNAME[symbol];
  if (!a) throw new Error(`no Kraken altname for ${symbol}`);
  return a;
}

/** Does this venue trade the symbol? A batch call (quotes, pairs, fees) drops what it does not know rather than failing whole. */
export const krakenSupports = (symbol: string): boolean => symbol in KRAKEN_ALTNAME;

/** A response key (XXBTZUSD / XBTUSD / XBT/USD) → the slash symbol, or null when it is not one of ours. */
export function fromKrakenPair(key: string): string | null {
  for (const [sym, id] of Object.entries(KRAKEN_PAIR_ID)) if (id === key) return sym;
  for (const [sym, alt] of Object.entries(KRAKEN_ALTNAME)) if (alt === key || alt === key.replace("/", "")) return sym;
  return null;
}

export function fromKrakenAsset(code: string): string {
  return KRAKEN_ASSET[code] ?? code;
}

// ---------------------------------------------------------------- signing

/**
 * Pure: the API-Sign header for one private call. `path` is the URI path
 * from `/0/private`, `postData` the exact form-encoded body that will be
 * sent (nonce included), `secretB64` the base64 private key as issued.
 */
export async function krakenSign(path: string, nonce: string, postData: string, secretB64: string): Promise<string> {
  const enc = new TextEncoder();
  const inner = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(enc.encode(nonce + postData))));
  const message = concatBytes(enc.encode(path), inner);
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(b64ToBytes(secretB64)), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, toArrayBuffer(message));
  return bytesToB64(new Uint8Array(mac));
}

/**
 * Nonces must only ever go up for a key. Microseconds since the epoch,
 * bumped by one when two calls land in the same microsecond, so a burst
 * inside one isolate stays strictly increasing. (A fresh isolate starts
 * from the clock again, which is later than anything the last one sent.)
 */
export function makeNonce(start = Date.now() * 1000): () => string {
  let last = start - 1;
  return () => { last = Math.max(Date.now() * 1000, last + 1); return String(last); };
}

/** Form-encode with `nonce` first, the way the reference examples do. */
export function formBody(nonce: string, params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  p.set("nonce", nonce);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}

export type KrakenEnv = { apiKey: string; secret: string; nonce: () => string };

export type KrakenResponse<T> = { ok: true; status: number; data: T; raw: string } | { ok: false; status: number; error: string; raw: string };

function parseEnvelope<T>(status: number, raw: string): KrakenResponse<T> {
  let j: { error?: unknown; result?: T };
  try { j = JSON.parse(raw); } catch { return { ok: false, status, error: `non-JSON body (${status})`, raw }; }
  const errs = Array.isArray(j?.error) ? j.error.map(String) : [];
  if (errs.length) return { ok: false, status, error: errs.join(" | "), raw };
  if (status < 200 || status >= 300) return { ok: false, status, error: `HTTP ${status}`, raw };
  return { ok: true, status, data: j.result as T, raw };
}

export async function krakenPublic<T = unknown>(
  method: string, params: Record<string, string | number> = {}, fetchImpl: typeof fetch = fetch, timeoutMs = 8_000,
): Promise<KrakenResponse<T>> {
  const q = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString();
  const res = await fetchImpl(`${KRAKEN_BASE}/0/public/${method}${q ? `?${q}` : ""}`, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs),
  });
  return parseEnvelope<T>(res.status, await res.text());
}

export async function krakenPrivate<T = unknown>(
  env: KrakenEnv, method: string, params: Record<string, string | number | boolean | undefined> = {},
  fetchImpl: typeof fetch = fetch, timeoutMs = 8_000,
): Promise<KrakenResponse<T>> {
  const path = `/0/private/${method}`;
  const nonce = env.nonce();
  const body = formBody(nonce, params);
  const sign = await krakenSign(path, nonce, body, env.secret);
  const res = await fetchImpl(`${KRAKEN_BASE}${path}`, {
    method: "POST",
    headers: { "API-Key": env.apiKey, "API-Sign": sign, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return parseEnvelope<T>(res.status, await res.text());
}

// -------------------------------------------------------------- endpoints

export type KrakenPairInfo = {
  altname: string; wsname: string; base: string; quote: string;
  pair_decimals: number; lot_decimals: number; cost_decimals: number;
  ordermin: string; costmin: string; tick_size: string; status: string;
};
export type KrakenTicker = { a: string[]; b: string[]; c: string[]; v: string[]; p: string[]; t: number[]; l: string[]; h: string[]; o: string };
export type KrakenOhlcRow = [number, string, string, string, string, string, string, number];
export type KrakenOrder = {
  status: "pending" | "open" | "closed" | "canceled" | "expired"; vol: string; vol_exec: string; cost: string; fee: string; price: string;
  descr: { pair: string; type: "buy" | "sell"; ordertype: string; price: string; order: string }; opentm: number; closetm?: number;
  reason?: string | null; oflags?: string; cl_ord_id?: string; userref?: number;
};
export type KrakenFeeInfo = { fee: string; minfee: string; maxfee: string; nextfee: string | null; tiervolume: string; nextvolume: string | null };
export type KrakenTradeVolume = { currency: string; volume: string; fees?: Record<string, KrakenFeeInfo>; fees_maker?: Record<string, KrakenFeeInfo> };

export const assetPairs = (symbols: string[], f?: typeof fetch) =>
  krakenPublic<Record<string, KrakenPairInfo>>("AssetPairs", { pair: symbols.map(toAltname).join(",") }, f);

export const ticker = (symbols: string[], f?: typeof fetch) =>
  krakenPublic<Record<string, KrakenTicker>>("Ticker", { pair: symbols.map(toAltname).join(",") }, f);

/** `interval` in MINUTES (1,5,15,30,60,240,1440,10080,21600). At most the 720 most recent candles, whatever `since` says. */
export const ohlc = (symbol: string, intervalMin: number, sinceSec?: number, f?: typeof fetch) =>
  krakenPublic<Record<string, KrakenOhlcRow[] | number>>("OHLC", { pair: toAltname(symbol), interval: intervalMin, ...(sinceSec ? { since: Math.floor(sinceSec) } : {}) }, f);

export const balance = (env: KrakenEnv, f?: typeof fetch) => krakenPrivate<Record<string, string>>(env, "Balance", {}, f);

export const balanceEx = (env: KrakenEnv, f?: typeof fetch) =>
  krakenPrivate<Record<string, { balance: string; hold_trade: string }>>(env, "BalanceEx", {}, f);

export const tradeVolume = (env: KrakenEnv, symbols: string[], f?: typeof fetch) =>
  krakenPrivate<KrakenTradeVolume>(env, "TradeVolume", { pair: symbols.map(toAltname).join(","), "fee-info": true }, f);

export const openOrders = (env: KrakenEnv, f?: typeof fetch) =>
  krakenPrivate<{ open: Record<string, KrakenOrder> }>(env, "OpenOrders", {}, f);
/** The account's closed orders (most recent page). Read-only; the probe uses it to see the settled shape a live order will have. */
export const closedOrders = (env: KrakenEnv, f?: typeof fetch) =>
  krakenPrivate<{ closed: Record<string, KrakenOrder>; count: number }>(env, "ClosedOrders", {}, f);

export const queryOrders = (env: KrakenEnv, txids: string[], f?: typeof fetch) =>
  krakenPrivate<Record<string, KrakenOrder>>(env, "QueryOrders", { txid: txids.join(",") }, f);

export type AddOrderRequest = {
  pair: string; type: "buy" | "sell"; ordertype: "limit"; volume: string; price: string;
  oflags?: "post"; timeinforce?: "GTC" | "IOC" | "GTD" | "FOK"; cl_ord_id?: string; validate?: boolean;
};
export type AddOrderResult = { descr: { order: string; close?: string }; txid?: string[] };

/** `validate: true` checks the request and places NOTHING — the way to test a key's trading permission without an order. */
export const addOrder = (env: KrakenEnv, req: AddOrderRequest, f?: typeof fetch) =>
  krakenPrivate<AddOrderResult>(env, "AddOrder", req, f);

export const cancelOrder = (env: KrakenEnv, txid: string, f?: typeof fetch) =>
  krakenPrivate<{ count: number; pending?: boolean }>(env, "CancelOrder", { txid }, f);

// ------------------------------------------------------------ normalisers

/** OHLC rows (seconds, strings) → the numeric candles the strategy maths reads. The LAST row is the still-open candle. */
export function toCandles(rows: KrakenOhlcRow[]): Candle[] {
  return rows.map((r) => ({ start: r[0] * 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[6]) }));
}

/** The venue's pair record → the sizing config `sizeBase` reads. */
export function toPairConfig(p: KrakenPairInfo): PairConfig {
  const baseStep = (10 ** -Number(p.lot_decimals)).toFixed(Number(p.lot_decimals));
  const quoteStep = p.tick_size ?? (10 ** -Number(p.pair_decimals)).toFixed(Number(p.pair_decimals));
  return { base_step: baseStep, quote_step: quoteStep, min_order_size: String(p.ordermin), min_order_size_quote: String(p.costmin) };
}

/** A venue order → the settlement view the tick acts on. A cancelled order with executed volume counts as filled for that volume. */
export function toOrderView(o: KrakenOrder): OrderView {
  const filledBase = Number(o.vol_exec || 0);
  let state: VenueOrderState;
  if (o.status === "closed") state = "filled";
  else if (o.status === "canceled" || o.status === "expired") state = filledBase > 0 ? "filled" : "cancelled";
  else if (o.status === "open") state = filledBase > 0 ? "partially_filled" : "new";
  else state = "new";
  return { state, filledBase, avgPrice: filledBase > 0 ? Number(o.price) : null, feeUsd: Number(o.fee || 0), raw: o };
}

// ----------------------------------------------------------------- venue

/**
 * The Kraken venue for the tick. Public data works with `env: null`; the
 * private half (balances, orders) needs the key pair. `feeBps` starts on
 * the published lowest tier and is refreshed from TradeVolume when a
 * probe or a tick asks (`refreshFees`).
 */
export function krakenVenue(env: KrakenEnv | null, fetchImpl: typeof fetch = fetch): Venue & { refreshFees: () => Promise<void> } {
  const feeBps = { ...KRAKEN_DEFAULT_FEE_BPS };
  const v: Venue & { refreshFees: () => Promise<void> } = {
    id: "kraken",
    canTrade: !!env,
    feeBps,
    async candles(symbol, intervalMin, sinceMs) {
      const r = await ohlc(symbol, intervalMin, Math.floor(sinceMs / 1000) - 1, fetchImpl);
      if (!r.ok) throw new Error(`kraken OHLC ${intervalMin}m → ${r.error}`);
      const key = Object.keys(r.data).find((k) => k !== "last");
      const rows = key ? (r.data[key] as KrakenOhlcRow[]) : [];
      return toCandles(rows).filter((c) => c.start >= sinceMs).sort((a, b) => a.start - b.start);
    },
    async quotes(symbols) {
      const known = symbols.filter(krakenSupports);
      if (!known.length) return {};
      const r = await ticker(known, fetchImpl);
      if (!r.ok) throw new Error(`kraken Ticker → ${r.error}`);
      const out: Record<string, Quote> = {};
      for (const [key, t] of Object.entries(r.data)) {
        const sym = fromKrakenPair(key);
        if (sym) out[sym] = { bid: Number(t.b[0]), ask: Number(t.a[0]) };
      }
      return out;
    },
    async pairs(symbols) {
      const known = symbols.filter(krakenSupports);
      if (!known.length) return {};
      const r = await assetPairs(known, fetchImpl);
      if (!r.ok) throw new Error(`kraken AssetPairs → ${r.error}`);
      const out: Record<string, PairConfig> = {};
      for (const [key, p] of Object.entries(r.data)) {
        const sym = fromKrakenPair(key) ?? fromKrakenPair(p.altname);
        if (sym) out[sym] = toPairConfig(p);
      }
      return out;
    },
    async placeLimit(o): Promise<PlaceResult> {
      if (!env) return { ok: false, status: 0, error: "no Kraken credentials", response: null };
      // Resting: post-only, good till cancelled. Marketable (a stop that must fill): no post-only flag and
      // immediate-or-cancel, so it takes what is there at the price and the rest is cancelled, never left resting.
      const req: AddOrderRequest = o.marketable
        ? { pair: toAltname(o.symbol), type: o.side, ordertype: "limit", volume: o.base, price: o.price, timeinforce: "IOC", cl_ord_id: o.clientOrderId }
        : { pair: toAltname(o.symbol), type: o.side, ordertype: "limit", volume: o.base, price: o.price, oflags: "post", timeinforce: "GTC", cl_ord_id: o.clientOrderId };
      const r = await addOrder(env, req, fetchImpl);
      if (!r.ok) return { ok: false, status: r.status, error: r.error, response: { request: req, raw: r.raw.slice(0, 500) } };
      const txid = r.data?.txid?.[0];
      if (!txid) return { ok: false, status: r.status, error: "no txid in AddOrder reply", response: { request: req, result: r.data } };
      return { ok: true, venueOrderId: txid, state: "new", response: { request: req, result: r.data } };
    },
    async cancel(venueOrderId) {
      if (!env) return { ok: false, error: "no Kraken credentials" };
      const r = await cancelOrder(env, venueOrderId, fetchImpl);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    async order(venueOrderId) {
      if (!env) return { ok: false, error: "no Kraken credentials" };
      const r = await queryOrders(env, [venueOrderId], fetchImpl);
      if (!r.ok) return { ok: false, error: r.error };
      const o = r.data?.[venueOrderId];
      if (!o) return { ok: false, error: `order ${venueOrderId} not in QueryOrders reply` };
      return { ok: true, view: toOrderView(o) };
    },
    async balances() {
      if (!env) return {};
      const r = await balance(env, fetchImpl);
      if (!r.ok) throw new Error(`kraken Balance → ${r.error}`);
      const out: Record<string, number> = {};
      for (const [code, amt] of Object.entries(r.data ?? {})) out[fromKrakenAsset(code)] = (out[fromKrakenAsset(code)] ?? 0) + Number(amt);
      return out;
    },
    async activeOrders() {
      if (!env) return { ok: false, error: "no Kraken credentials" };
      const r = await openOrders(env, fetchImpl);
      if (!r.ok) return { ok: false, error: r.error };
      const byClientId: Record<string, { venueOrderId: string; view: OrderView }> = {};
      for (const [txid, o] of Object.entries(r.data?.open ?? {})) if (o.cl_ord_id) byClientId[o.cl_ord_id] = { venueOrderId: txid, view: toOrderView(o) };
      return { ok: true, byClientId };
    },
    async refreshFees() {
      if (!env) return;
      const r = await tradeVolume(env, ["BTC/USD"], fetchImpl);
      if (!r.ok) return;
      const key = Object.keys(r.data?.fees ?? {})[0];
      const taker = key ? Number(r.data.fees?.[key]?.fee) : NaN;
      const maker = key ? Number(r.data.fees_maker?.[key]?.fee) : NaN;
      if (Number.isFinite(taker)) feeBps.taker = taker * 100;   // the venue reports percent
      if (Number.isFinite(maker)) feeBps.maker = maker * 100;
    },
  };
  return v;
}
