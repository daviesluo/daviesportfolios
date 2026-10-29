// CXBOT's reads of the outside world: PUBLIC market data only, keyless, from a fixed list of hosts (the audit's §6.1). The
// guard refuses any other host, any method but GET (and POST to Hyperliquid's read-only `/info`) before `fetch`, so no
// path here can sign, send an order or carry a credential. Phase 1 holds no key of any venue (prereg §0); nothing here
// reads a secret.
//
// The tape is read from ONE venue at a time (`cxbot_config.venue`): Hyperliquid by default; Binance USDⓈ-M, then OKX, only
// if a migration says so after `reach` (audit §2.2). A venue that refuses this function's region is never routed round.

import type { Coin, Minute } from "./rules.ts";

/** Every host this function may call, and the paths each may take. */
export const CXBOT_HOSTS: Record<string, RegExp> = {
  "api.hyperliquid.xyz": /^\/info$/,
  "fapi.binance.com": /^\/fapi\/v1\/(ping|klines|premiumIndex|openInterest|depth)$/,
  "data-api.binance.vision": /^\/api\/v3\/(ping|ticker\/bookTicker)$/,
  "api.bybit.com": /^\/v5\/market\/(time|tickers)$/,
  "www.okx.com": /^\/api\/v5\/(public\/(time|mark-price|funding-rate|open-interest|liquidation-orders)|market\/(candles|books))$/,
  "www.deribit.com": /^\/api\/v2\/public\/(get_time|get_index_price|get_volatility_index_data|get_book_summary_by_currency|get_instruments)$/,
  "gamma-api.polymarket.com": /^\/events$/,
  "community-api.coinmetrics.io": /^\/v4\/timeseries\/asset-metrics$/,
  "stablecoins.llama.fi": /^\/stablecoincharts\/all$/,
  "api.elections.kalshi.com": /^\/trade-api\/v2\/events$/,
};

export class CxbotRefused extends Error {}

/** The guard: refuses any URL off the list, and any method but GET (or a POST to Hyperliquid's `/info`), before `fetch`. */
export function assertCxbotAllowed(url: string, method = "GET"): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new CxbotRefused(`not a URL: ${url.slice(0, 80)}`); }
  if (u.protocol !== "https:") throw new CxbotRefused(`https only: ${u.host}`);
  const re = CXBOT_HOSTS[u.host];
  if (!re || !re.test(u.pathname)) throw new CxbotRefused(`not on CXBOT's list: ${u.host}${u.pathname}`);
  const post = u.host === "api.hyperliquid.xyz" && u.pathname === "/info";
  if (method !== "GET" && !(method === "POST" && post)) throw new CxbotRefused(`${method} is not allowed to ${u.host}`);
  if (post && method !== "POST") throw new CxbotRefused("Hyperliquid's /info takes POST");
  return u;
}

export type Fetch = typeof fetch;
export type Reader = { get: (url: string) => Promise<unknown>; hl: (body: Record<string, unknown>) => Promise<unknown>; calls: () => number };

/** A reader: every call through the guard, with a timeout; an answer that is not 2xx JSON is an error naming its host. */
export function makeReader(fetchImpl: Fetch = fetch, timeoutMs = 8_000): Reader {
  let n = 0;
  const call = async (url: string, init?: RequestInit) => {
    const u = assertCxbotAllowed(url, init?.method ?? "GET");
    n++;
    const res = await fetchImpl(u.toString(), { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${u.host} ${res.status}: ${text.slice(0, 120)}`);
    try { return JSON.parse(text); } catch { throw new Error(`${u.host}: not JSON`); }
  };
  return {
    get: (url) => call(url),
    hl: (body) => call("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    calls: () => n,
  };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => {
  const v = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(v) ? v : null;
};

/** One coin's state as every venue reader returns it: funding normalised to a rate per hour. */
export type CoinCtx = { mark: number | null; index: number | null; funding: number | null; predicted: number | null; oi: number | null; premium: number | null };
export type Book = { bids: Array<[number, number]>; asks: Array<[number, number]>; tick: number };
export type MinuteBar = Minute & { v: number | null; n: number | null };

export type TapeVenue = {
  candles: (coin: Coin, fromMs: number, toMs: number) => Promise<MinuteBar[]>;
  ctx: () => Promise<Record<Coin, CoinCtx>>;
  book: (coin: Coin) => Promise<Book>;
  hourCloses: (coin: Coin, hours: number) => Promise<number[]>;
};

const tickOf = (bids: Array<[number, number]>, asks: Array<[number, number]>) => {
  const xs = [...bids, ...asks].map(([p]) => p).sort((a, b) => a - b);
  let t = Infinity;
  for (let i = 1; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; if (d > 1e-12 && d < t) t = d; }
  return Number.isFinite(t) ? t : 0;
};

/** Hyperliquid (`/info`): 1-minute candles (5,000 at most, about 3.5 days), `metaAndAssetCtxs`, `l2Book`, `predictedFundings`. */
export function hyperliquidTape(r: Reader): TapeVenue {
  return {
    async candles(coin, fromMs, toMs) {
      const a = await r.hl({ type: "candleSnapshot", req: { coin, interval: "1m", startTime: fromMs, endTime: toMs } });
      return (Array.isArray(a) ? a : []).filter(isObj).map((c) => ({ t: Number(c.t), o: num(c.o)!, h: num(c.h)!, l: num(c.l)!, c: num(c.c)!, v: num(c.v), n: num(c.n) }))
        .filter((c) => Number.isFinite(c.t) && [c.o, c.h, c.l, c.c].every((x) => x !== null));
    },
    async ctx() {
      const [a, pf] = await Promise.all([r.hl({ type: "metaAndAssetCtxs" }), r.hl({ type: "predictedFundings" }).catch(() => [])]);
      const out = {} as Record<Coin, CoinCtx>;
      const uni = Array.isArray(a) && isObj(a[0]) && Array.isArray(a[0].universe) ? a[0].universe as Obj[] : [];
      const ctxs = Array.isArray(a) && Array.isArray(a[1]) ? a[1] as Obj[] : [];
      const pred = new Map<string, number | null>();
      for (const row of Array.isArray(pf) ? pf : []) {
        if (!Array.isArray(row) || !Array.isArray(row[1])) continue;
        const hl = (row[1] as unknown[]).find((v) => Array.isArray(v) && v[0] === "HlPerp") as [string, Obj] | undefined;
        if (hl && isObj(hl[1])) { const f = num(hl[1].fundingRate), h = num(hl[1].fundingIntervalHours) ?? 1; pred.set(String(row[0]), f === null ? null : f / h); }
      }
      uni.forEach((u, i) => {
        const coin = String(u.name) as Coin;
        const c = ctxs[i];
        if (!isObj(c) || !["BTC", "ETH", "SOL"].includes(coin)) return;
        out[coin] = { mark: num(c.markPx), index: num(c.oraclePx), funding: num(c.funding), predicted: pred.get(coin) ?? null, oi: num(c.openInterest), premium: num(c.premium) };
      });
      return out;
    },
    async book(coin) {
      const b = await r.hl({ type: "l2Book", coin });
      const lv = isObj(b) && Array.isArray(b.levels) ? b.levels as unknown[] : [[], []];
      const side = (x: unknown) => (Array.isArray(x) ? x : []).filter(isObj).map((l) => [num(l.px)!, num(l.sz)!] as [number, number]).filter(([p, s]) => p > 0 && s > 0);
      const bids = side(lv[0]), asks = side(lv[1]);
      return { bids, asks, tick: tickOf(bids, asks) };
    },
    async hourCloses(coin, hours) {
      const now = Date.now();
      const a = await r.hl({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: now - (hours + 1) * 3600e3, endTime: now } });
      return (Array.isArray(a) ? a : []).filter(isObj).map((c) => num(c.c)).filter((x): x is number => x !== null);
    },
  };
}

const BINANCE: Record<Coin, string> = { BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT" };
/** Binance USDⓈ-M (the fallback venue): klines, premiumIndex (mark, index, the 8-hour rate), openInterest, depth. */
export function binanceTape(r: Reader): TapeVenue {
  const base = "https://fapi.binance.com/fapi/v1";
  return {
    async candles(coin, fromMs, toMs) {
      const a = await r.get(`${base}/klines?symbol=${BINANCE[coin]}&interval=1m&startTime=${fromMs}&endTime=${toMs}&limit=1000`);
      return (Array.isArray(a) ? a : []).filter(Array.isArray).map((k) => ({ t: Number(k[0]), o: num(k[1])!, h: num(k[2])!, l: num(k[3])!, c: num(k[4])!, v: num(k[5]), n: num(k[8]) }))
        .filter((c) => [c.o, c.h, c.l, c.c].every((x) => x !== null));
    },
    async ctx() {
      const out = {} as Record<Coin, CoinCtx>;
      for (const coin of ["BTC", "ETH", "SOL"] as Coin[]) {
        const [p, oi] = await Promise.all([r.get(`${base}/premiumIndex?symbol=${BINANCE[coin]}`), r.get(`${base}/openInterest?symbol=${BINANCE[coin]}`).catch(() => null)]);
        const pi = isObj(p) ? p : {};
        const mark = num(pi.markPrice), index = num(pi.indexPrice), f = num(pi.lastFundingRate);
        out[coin] = { mark, index, funding: f === null ? null : f / 8, predicted: f === null ? null : f / 8, oi: isObj(oi) ? num(oi.openInterest) : null, premium: mark && index ? mark / index - 1 : null };
      }
      return out;
    },
    async book(coin) {
      const b = await r.get(`${base}/depth?symbol=${BINANCE[coin]}&limit=100`);
      const side = (x: unknown) => (Array.isArray(x) ? x : []).filter(Array.isArray).map((l) => [num(l[0])!, num(l[1])!] as [number, number]).filter(([p, s]) => p > 0 && s > 0);
      const bids = side(isObj(b) ? b.bids : []), asks = side(isObj(b) ? b.asks : []);
      return { bids, asks, tick: tickOf(bids, asks) };
    },
    async hourCloses(coin, hours) {
      const a = await r.get(`${base}/klines?symbol=${BINANCE[coin]}&interval=1h&limit=${Math.min(1000, hours + 1)}`);
      return (Array.isArray(a) ? a : []).filter(Array.isArray).map((k) => num(k[4])).filter((x): x is number => x !== null);
    },
  };
}

const OKX: Record<Coin, { inst: string; ctVal: number }> = { BTC: { inst: "BTC-USDT-SWAP", ctVal: 0.01 }, ETH: { inst: "ETH-USDT-SWAP", ctVal: 0.1 }, SOL: { inst: "SOL-USDT-SWAP", ctVal: 1 } };
/** OKX swaps (the second fallback; the one venue measured reachable from our Edge, audit §2.2). */
export function okxTape(r: Reader): TapeVenue {
  const base = "https://www.okx.com/api/v5";
  const data = (x: unknown) => (isObj(x) && Array.isArray(x.data) ? x.data : []);
  return {
    async candles(coin, fromMs, toMs) {
      const a = data(await r.get(`${base}/market/candles?instId=${OKX[coin].inst}&bar=1m&limit=300&before=${fromMs - 1}&after=${toMs + 1}`));
      return a.filter(Array.isArray).filter((k) => k[8] === "1").map((k) => ({ t: Number(k[0]), o: num(k[1])!, h: num(k[2])!, l: num(k[3])!, c: num(k[4])!, v: num(k[5]), n: null }))
        .filter((c) => [c.o, c.h, c.l, c.c].every((x) => x !== null)).sort((x, y) => x.t - y.t);
    },
    async ctx() {
      const out = {} as Record<Coin, CoinCtx>;
      for (const coin of ["BTC", "ETH", "SOL"] as Coin[]) {
        const [mp, fr, oi] = await Promise.all([
          r.get(`${base}/public/mark-price?instType=SWAP&instId=${OKX[coin].inst}`), r.get(`${base}/public/funding-rate?instId=${OKX[coin].inst}`),
          r.get(`${base}/public/open-interest?instType=SWAP&instId=${OKX[coin].inst}`).catch(() => null),
        ]);
        const m = data(mp)[0], f = data(fr)[0], o = data(oi)[0];
        const rate = isObj(f) ? num(f.fundingRate) : null, next = isObj(f) ? num(f.nextFundingRate) : null;
        out[coin] = { mark: isObj(m) ? num(m.markPx) : null, index: null, funding: rate === null ? null : rate / 8, predicted: next === null ? (rate === null ? null : rate / 8) : next / 8, oi: isObj(o) ? num(o.oiCcy) : null, premium: null };
      }
      return out;
    },
    async book(coin) {
      const b = data(await r.get(`${base}/market/books?instId=${OKX[coin].inst}&sz=100`))[0];
      const side = (x: unknown) => (Array.isArray(x) ? x : []).filter(Array.isArray).map((l) => [num(l[0])!, num(l[1])! * OKX[coin].ctVal] as [number, number]).filter(([p, s]) => p > 0 && s > 0);
      const bids = side(isObj(b) ? b.bids : []), asks = side(isObj(b) ? b.asks : []);
      return { bids, asks, tick: tickOf(bids, asks) };
    },
    async hourCloses(coin, hours) {
      const a = data(await r.get(`${base}/market/candles?instId=${OKX[coin].inst}&bar=1H&limit=${Math.min(300, hours + 1)}`));
      return a.filter(Array.isArray).map((k) => num(k[4])).filter((x): x is number => x !== null).reverse();
    },
  };
}

export const tapeOf = (venue: string, r: Reader): TapeVenue => venue === "binance" ? binanceTape(r) : venue === "okx" ? okxTape(r) : hyperliquidTape(r);

/** The `reach` probe's list: each venue's and source's public endpoint, one read each (audit §2.2). */
export const REACH_TARGETS: Array<{ target: string; url: string; body?: Record<string, unknown> }> = [
  { target: "hyperliquid", url: "https://api.hyperliquid.xyz/info", body: { type: "meta" } },
  { target: "binance_futures", url: "https://fapi.binance.com/fapi/v1/ping" },
  { target: "binance_futures_data", url: "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT" },
  { target: "binance_spot_data", url: "https://data-api.binance.vision/api/v3/ping" },
  { target: "bybit", url: "https://api.bybit.com/v5/market/time" },
  { target: "bybit_data", url: "https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT" },
  { target: "okx", url: "https://www.okx.com/api/v5/public/time" },
  { target: "deribit", url: "https://www.deribit.com/api/v2/public/get_time" },
  { target: "polymarket", url: "https://gamma-api.polymarket.com/events?limit=1" },
  { target: "coinmetrics", url: "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=FlowInExUSD&frequency=1d&page_size=1" },
  { target: "defillama", url: "https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=1" },
  { target: "kalshi", url: "https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXCPI&status=open&limit=1" },
];

/** One read of each target: its status, time and a short note; never retried, never routed elsewhere. */
export async function reachAll(fetchImpl: Fetch = fetch, now: () => number = Date.now) {
  const out: Array<{ target: string; url: string; status: number | null; ms: number; ok: boolean; note: string | null }> = [];
  for (const t of REACH_TARGETS) {
    const t0 = now();
    try {
      const u = assertCxbotAllowed(t.url, t.body ? "POST" : "GET");
      const res = await fetchImpl(u.toString(), t.body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t.body), signal: AbortSignal.timeout(8000) } : { signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      out.push({ target: t.target, url: t.url, status: res.status, ms: now() - t0, ok: res.ok, note: res.ok ? null : text.slice(0, 160) });
    } catch (e) {
      out.push({ target: t.target, url: t.url, status: null, ms: now() - t0, ok: false, note: (e as Error).message.slice(0, 160) });
    }
  }
  return out;
}
