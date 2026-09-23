// Binance (binance.com) spot REST, READ-ONLY. Nothing in this file can place, cancel or withdraw: it exists so the
// agents probe can tell what a key is allowed to do before anything depends on it (reference §6). Signed endpoints
// take `timestamp` (and `recvWindow`) in the query and an HMAC-SHA256 of the whole query string, as lower-case hex, in
// `signature`; the key id goes in `X-MBX-APIKEY`. The documented example is pinned in binance.test.ts.
//
// The probe reports permissions, fee rates, symbol rules and WHICH assets hold a balance — never an amount, and never
// a byte of either key. Nothing else signs a call: the page no longer shows the account (Davies, 2026-09-23 — every row
// trades paper), and the paper venue below reads public market data only.

import type { Candle, PairConfig } from "../_shared/agents_strategy.ts";
import type { Quote, Venue } from "../_shared/venue.ts";

export const BINANCE_BASE = "https://api.binance.com";

/** Every path the probe may call. A test fails if the probe asks for anything else. */
export const BINANCE_READ_PATHS = ["/api/v3/time", "/api/v3/account", "/sapi/v1/account/apiRestrictions", "/sapi/v1/asset/tradeFee", "/api/v3/exchangeInfo"] as const;

export type BinanceEnv = { apiKey: string; secret: string; base?: string; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number };
type Reply = { ok: boolean; status: number; data?: any; error?: string };

/** HMAC-SHA256 of the query string, hex: Binance's `signature`. */
export async function binanceSignature(query: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(query)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function call(env: BinanceEnv, path: string, params: Record<string, string>, signed: boolean): Promise<Reply> {
  if (!(BINANCE_READ_PATHS as readonly string[]).includes(path)) return { ok: false, status: 0, error: `not a read path: ${path}` };
  let q = new URLSearchParams(params).toString();
  if (signed) {
    q = new URLSearchParams({ ...params, recvWindow: "10000", timestamp: String((env.now ?? Date.now)()) }).toString();
    q += `&signature=${await binanceSignature(q, env.secret)}`;
  }
  try {
    const res = await (env.fetchImpl ?? fetch)(`${env.base ?? BINANCE_BASE}${path}${q ? `?${q}` : ""}`, {
      headers: signed ? { "X-MBX-APIKEY": env.apiKey } : {},
      signal: AbortSignal.timeout(env.timeoutMs ?? 10_000),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: keep the text below */ }
    if (!res.ok) return { ok: false, status: res.status, error: typeof data?.msg === "string" ? `${data.code ?? ""} ${data.msg}`.trim() : text.slice(0, 200) };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The filters an order would have to respect, from one exchangeInfo symbol. */
export function symbolRules(s: any): Record<string, unknown> {
  const f = (t: string) => (s?.filters ?? []).find((x: any) => x.filterType === t) ?? null;
  const lot = f("LOT_SIZE"), price = f("PRICE_FILTER"), notional = f("NOTIONAL") ?? f("MIN_NOTIONAL");
  return {
    status: s?.status ?? null,
    stepSize: lot?.stepSize ?? null, minQty: lot?.minQty ?? null,
    tickSize: price?.tickSize ?? null,
    minNotional: notional?.minNotional ?? null,
    orderTypes: s?.orderTypes ?? null,
  };
}

/** What a key may do and at what price, read-only. `symbols` in Binance's form (`BTCUSDT`). */
export async function binanceProbe(env: BinanceEnv, symbols: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  // Reachability first, with no key: a 451 or 403 here is the REGION being refused, not the key.
  const t = await call(env, "/api/v3/time", {}, false);
  out.reachable = t.ok ? { status: t.status, clockSkewMs: Number(t.data?.serverTime) - (env.now ?? Date.now)() } : { status: t.status, error: t.error };
  if (!t.ok) return out;
  const a = await call(env, "/api/v3/account", { omitZeroBalances: "true" }, true);
  out.account = a.ok
    ? {
      status: a.status, accountType: a.data?.accountType ?? null, canTrade: a.data?.canTrade ?? null,
      canWithdraw: a.data?.canWithdraw ?? null, canDeposit: a.data?.canDeposit ?? null,
      permissions: a.data?.permissions ?? null, commissionRates: a.data?.commissionRates ?? null,
      assetsHeld: (a.data?.balances ?? []).filter((b: any) => Number(b.free) + Number(b.locked) > 0).map((b: any) => b.asset),
    }
    : { status: a.status, error: a.error };
  const r = await call(env, "/sapi/v1/account/apiRestrictions", {}, true);
  out.restrictions = r.ok ? { status: r.status, ...r.data } : { status: r.status, error: r.error };
  const fee = await call(env, "/sapi/v1/asset/tradeFee", { symbol: symbols[0] ?? "BTCUSDT" }, true);
  out.tradeFee = fee.ok ? { status: fee.status, rows: fee.data } : { status: fee.status, error: fee.error };
  const ex = await call(env, "/api/v3/exchangeInfo", { symbols: JSON.stringify(symbols) }, false);
  if (ex.ok) {
    const rules: Record<string, unknown> = {};
    for (const s of ex.data?.symbols ?? []) rules[s.symbol] = symbolRules(s);
    out.symbols = { status: ex.status, rules };
  } else {
    out.symbols = { status: ex.status, error: ex.error };
  }
  return out;
}

// ── The paper venue ──────────────────────────────────────────────────────────────────────────────────────────────────
// Binance runs PAPER rows only (Davies, 2026-09-23: the same strategies as Revolut X, on the page for people to see). A
// paper fill is simulated at Binance's own touch plus its fee, so the book those rows keep is the one Binance would have
// given them. Everything this venue reads is PUBLIC market data from Binance's market-data host: api.binance.com answers
// 451 to a US address and the tick runs wherever Supabase routes the cron call, while data-api.binance.vision serves the
// same public endpoints from anywhere (measured 2026-09-23 from a US address: 451 there, 200 here). It cannot place,
// cancel or read an order — `canTrade` is false, so the tick refuses a live order on it before any venue call — and
// migration 0049 lets a Binance row be paper or paused, never live.

export const BINANCE_PUBLIC_BASE = "https://data-api.binance.vision";
/** Every path the paper venue may call; a test fails if it asks for anything else. */
export const BINANCE_PUBLIC_PATHS = ["/api/v3/ticker/bookTicker", "/api/v3/exchangeInfo", "/api/v3/klines"] as const;
/** This account's measured spot rate (reference §4.27): 0.10 % a side, no BNB discount assumed. */
export const BINANCE_PAPER_FEE_BPS = { maker: 10, taker: 10 } as const;
const PAPER_ONLY = "Binance runs paper rows only here: no order is ever sent";

/** A row's dollar symbol trades against USDT at Binance: `BTC/USD` → `BTCUSDT`. Anything else has no pair here. */
export function toBinanceSymbol(sym: string): string | null {
  const m = /^([A-Z0-9]+)\/USD$/.exec(sym);
  return m ? `${m[1]}USDT` : null;
}

/** `BTCUSDT` → `BTC/USD`, the inverse of `toBinanceSymbol`. */
export function fromBinanceSymbol(s: string): string | null {
  const m = /^([A-Z0-9]+)USDT$/.exec(s);
  return m ? `${m[1]}/USD` : null;
}

/** Binance writes steps with eight decimals (`0.00001000`); the loop's rounding wants the step itself (`0.00001`). */
export function trimStep(step: string): string {
  if (!/^\d+\.\d+$/.test(step)) return step;
  const t = step.replace(/0+$/, "").replace(/\.$/, "");
  return t === "" ? "0" : t;
}

/** One exchangeInfo symbol as the loop sizes and prices an order: lot step, tick, minimum size and minimum notional. */
export function binancePairConfig(s: any): PairConfig | null {
  const r = symbolRules(s) as { stepSize: string | null; minQty: string | null; tickSize: string | null; minNotional: string | null; status: string | null };
  if (r.status !== "TRADING" || !r.stepSize || !r.tickSize) return null;
  return { base_step: trimStep(r.stepSize), quote_step: trimStep(r.tickSize), min_order_size: trimStep(r.minQty ?? "0"), min_order_size_quote: trimStep(r.minNotional ?? "0") };
}

const KLINE_INTERVAL: Record<number, string> = { 1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d" };

/** A kline row (`[openTime, open, high, low, close, volume, closeTime, …]`) as the loop's candle. */
export function binanceKlineToCandle(k: unknown[]): Candle {
  return { start: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) };
}

/** The paper-only venue. `canTrade` is false and every order call is refused; market data is public. */
export function binancePaperVenue(fetchImpl: typeof fetch = fetch, timeoutMs = 8_000): Venue {
  const get = async (path: (typeof BINANCE_PUBLIC_PATHS)[number], params: Record<string, string>): Promise<any> => {
    if (!(BINANCE_PUBLIC_PATHS as readonly string[]).includes(path)) throw new Error(`not a public path: ${path}`);
    const q = new URLSearchParams(params).toString();
    const res = await fetchImpl(`${BINANCE_PUBLIC_BASE}${path}${q ? `?${q}` : ""}`, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) throw new Error(`binance ${path} ${res.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  };
  const known = (symbols: string[]) => symbols.map((sym) => [sym, toBinanceSymbol(sym)] as const).filter((x): x is readonly [string, string] => x[1] != null);
  return {
    id: "binance",
    canTrade: false,
    feeBps: { ...BINANCE_PAPER_FEE_BPS },
    async candles(symbol, intervalMin, sinceMs, untilMs) {
      const pair = toBinanceSymbol(symbol), interval = KLINE_INTERVAL[intervalMin];
      if (!pair) throw new Error(`no Binance pair for ${symbol}`);
      if (!interval) throw new Error(`no Binance kline interval for ${intervalMin} minutes`);
      const rows = await get("/api/v3/klines", { symbol: pair, interval, startTime: String(Math.floor(sinceMs)), endTime: String(Math.floor(untilMs)), limit: "1000" });
      return (Array.isArray(rows) ? rows : []).map(binanceKlineToCandle).filter((c) => c.start >= sinceMs).sort((a, b) => a.start - b.start);
    },
    async quotes(symbols) {
      const pairs = known(symbols);
      if (!pairs.length) return {};
      const rows = await get("/api/v3/ticker/bookTicker", { symbols: JSON.stringify(pairs.map(([, b]) => b)) });
      const out: Record<string, Quote> = {};
      for (const t of Array.isArray(rows) ? rows : []) {
        const sym = fromBinanceSymbol(String(t?.symbol ?? "")), bid = Number(t?.bidPrice), ask = Number(t?.askPrice);
        if (sym && bid > 0 && ask >= bid) out[sym] = { bid, ask };   // an empty side reads 0: no quote rather than a mark of 0
      }
      return out;
    },
    async pairs(symbols) {
      const pairs = known(symbols);
      if (!pairs.length) return {};
      const info = await get("/api/v3/exchangeInfo", { symbols: JSON.stringify(pairs.map(([, b]) => b)) });
      const out: Record<string, PairConfig> = {};
      for (const s of info?.symbols ?? []) {
        const sym = fromBinanceSymbol(String(s?.symbol ?? "")), cfg = binancePairConfig(s);
        if (sym && cfg) out[sym] = cfg;
      }
      return out;
    },
    async placeLimit() { return { ok: false, status: 0, error: PAPER_ONLY, response: null }; },
    async cancel() { return { ok: false, error: PAPER_ONLY }; },
    async order() { return { ok: false, error: PAPER_ONLY }; },
    async balances() { return {}; },
    async activeOrders() { return { ok: false, error: PAPER_ONLY }; },
  };
}

