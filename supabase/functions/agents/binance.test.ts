// Pins for the Binance client: the signature against Binance's own documented example; a probe that asks only for the
// read paths it lists, signs exactly the private ones, and reports no key and no amount; and the paper venue, which reads
// public market data only and can never place an order.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BINANCE_PUBLIC_BASE, BINANCE_PUBLIC_PATHS, BINANCE_READ_PATHS, binancePairConfig, binancePaperVenue, binanceProbe, binanceSignature, fromBinanceSymbol, symbolRules, toBinanceSymbol, trimStep,
} from "./binance.ts";

// developers.binance.com, "Request security" → "SIGNED Endpoint Examples" (HMAC keys), verbatim; openssl agrees.
const EXAMPLE = {
  secret: "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j",
  query: "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559",
  signature: "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71",
};

Deno.test("binanceSignature reproduces the documented HMAC example byte for byte", async () => {
  assertEquals(await binanceSignature(EXAMPLE.query, EXAMPLE.secret), EXAMPLE.signature);
});

type Seen = { path: string; key: string | null; signed: boolean; query: URLSearchParams };
function venue(status = 200) {
  const seen: Seen[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    seen.push({ path: u.pathname, key: new Headers(init?.headers).get("X-MBX-APIKEY"), signed: u.searchParams.has("signature"), query: u.searchParams });
    if (status !== 200) return Promise.resolve(new Response(JSON.stringify({ code: 0, msg: "Service unavailable from a restricted location" }), { status }));
    const body = u.pathname === "/api/v3/time" ? { serverTime: 1_700_000_000_500 }
      : u.pathname === "/api/v3/account"
      ? { accountType: "SPOT", canTrade: true, canWithdraw: false, canDeposit: true, permissions: ["SPOT"], commissionRates: { maker: "0.00100000", taker: "0.00100000" }, balances: [{ asset: "USDT", free: "123.45", locked: "0" }, { asset: "BTC", free: "0.00000000", locked: "0.00000000" }] }
      : u.pathname === "/sapi/v1/account/apiRestrictions" ? { ipRestrict: false, enableReading: true, enableSpotAndMarginTrading: false, enableWithdrawals: false }
      : u.pathname === "/sapi/v1/asset/tradeFee" ? [{ symbol: "BTCUSDT", makerCommission: "0.001", takerCommission: "0.001" }]
      : { symbols: [{ symbol: "BTCUSDT", status: "TRADING", orderTypes: ["LIMIT", "LIMIT_MAKER"], filters: [{ filterType: "LOT_SIZE", stepSize: "0.00001000", minQty: "0.00001000" }, { filterType: "PRICE_FILTER", tickSize: "0.01000000" }, { filterType: "NOTIONAL", minNotional: "5.00000000" }] }] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  return { seen, fetchImpl };
}

Deno.test("binanceProbe reads only, signs exactly the private reads, and reports no key, no secret and no amount", async () => {
  const v = venue();
  const out = await binanceProbe({ apiKey: "KEY-ID-abc", secret: "SECRET-xyz", fetchImpl: v.fetchImpl, now: () => 1_700_000_000_000 }, ["BTCUSDT"]);
  assertEquals(v.seen.map((s) => s.path), [...BINANCE_READ_PATHS]);
  for (const s of v.seen) assertEquals(s.signed, s.key === "KEY-ID-abc", `${s.path}: signed exactly when keyed`);
  assertEquals(v.seen.filter((s) => s.signed).map((s) => s.path), ["/api/v3/account", "/sapi/v1/account/apiRestrictions", "/sapi/v1/asset/tradeFee"]);
  for (const s of v.seen.filter((x) => x.signed)) assert(s.query.has("timestamp") && s.query.has("recvWindow"), s.path);
  const text = JSON.stringify(out);
  assert(!text.includes("SECRET-xyz") && !text.includes("KEY-ID-abc"), "no key material in the report");
  assert(!text.includes("123.45"), "no balance amount in the report");
  assertEquals((out.account as Record<string, unknown>).assetsHeld, ["USDT"]);
  assertEquals((out.reachable as Record<string, unknown>).clockSkewMs, 500);
  assertEquals(((out.symbols as Record<string, Record<string, Record<string, unknown>>>).rules.BTCUSDT).minNotional, "5.00000000");
});

Deno.test("binanceProbe stops at a refused region and says so, before the key is ever sent", async () => {
  const v = venue(451);
  const out = await binanceProbe({ apiKey: "k", secret: "s", fetchImpl: v.fetchImpl }, ["BTCUSDT"]);
  assertEquals(v.seen.map((s) => s.path), ["/api/v3/time"]);
  assertEquals(v.seen[0].key, null);
  assertEquals((out.reachable as Record<string, unknown>).status, 451);
  assert(String((out.reachable as Record<string, unknown>).error).includes("restricted location"));
});

Deno.test("symbolRules reads the order filters, NOTIONAL or the older MIN_NOTIONAL", () => {
  assertEquals(symbolRules({ status: "TRADING", filters: [{ filterType: "MIN_NOTIONAL", minNotional: "10" }] }).minNotional, "10");
  assertEquals(symbolRules(null).status, null);
});

// ── the paper venue (Davies, 2026-09-23: Binance runs the same strategies, on paper, for the page) ───────────────────

/** A fake of Binance's public market-data host: answers the three public paths from fixtures and records every URL. */
function publicHost(reply: Record<string, (q: URLSearchParams) => unknown>, status = 200) {
  const urls: URL[] = [];
  const fetchImpl = ((input: string | URL | Request) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    urls.push(u);
    const body = reply[u.pathname]?.(u.searchParams);
    return Promise.resolve(new Response(body === undefined ? "{\"code\":-1121,\"msg\":\"Invalid symbol.\"}" : JSON.stringify(body), { status: body === undefined ? 400 : status }));
  }) as typeof fetch;
  return { urls, fetchImpl };
}
const BTC_RULES = {
  symbol: "BTCUSDT", status: "TRADING",
  filters: [
    { filterType: "PRICE_FILTER", minPrice: "0.01000000", maxPrice: "1000000.00000000", tickSize: "0.01000000" },
    { filterType: "LOT_SIZE", minQty: "0.00001000", maxQty: "9000.00000000", stepSize: "0.00001000" },
    { filterType: "NOTIONAL", minNotional: "5.00000000", applyMinToMarket: true },
  ],
};

Deno.test("a row's dollar symbol is Binance's USDT pair, and nothing else maps", () => {
  assertEquals([toBinanceSymbol("BTC/USD"), toBinanceSymbol("SUI/USD"), toBinanceSymbol("BTC/GBP"), toBinanceSymbol("btc/usd")], ["BTCUSDT", "SUIUSDT", null, null]);
  assertEquals([fromBinanceSymbol("AVAXUSDT"), fromBinanceSymbol("BTCUSDC"), fromBinanceSymbol("USDT")], ["AVAX/USD", null, null]);
});

Deno.test("Binance's eight-decimal steps become the step itself, which the loop rounds to", () => {
  assertEquals(["0.00001000", "0.01000000", "1.00000000", "10.00000000", "5", "0.1"].map(trimStep), ["0.00001", "0.01", "1", "10", "5", "0.1"]);
  // The rounding the tick applies reads the step's decimals: eight zeros of padding would have been harmless there, but
  // the trimmed step is what every other venue hands it, so one code path sizes every order.
  assertEquals(binancePairConfig(BTC_RULES), { base_step: "0.00001", quote_step: "0.01", min_order_size: "0.00001", min_order_size_quote: "5" });
  assertEquals(binancePairConfig({ ...BTC_RULES, status: "BREAK" }), null);        // a pair that is not trading sizes no order
});

Deno.test("binancePaperVenue reads Binance's public book from the market-data host, one call for every pair", async () => {
  const host = publicHost({
    "/api/v3/ticker/bookTicker": (q) => {
      assertEquals(JSON.parse(q.get("symbols")!), ["BTCUSDT", "ETHUSDT"]);
      return [{ symbol: "BTCUSDT", bidPrice: "85813.60", bidQty: "1", askPrice: "85813.61", askQty: "4" }, { symbol: "ETHUSDT", bidPrice: "0.00", bidQty: "0", askPrice: "0.00", askQty: "0" }];
    },
  });
  const v = binancePaperVenue(host.fetchImpl);
  // A symbol with no Binance pair is skipped, not asked for; an empty book side is no quote, never a mark of 0.
  assertEquals(await v.quotes(["BTC/USD", "ETH/USD", "BTC/GBP"]), { "BTC/USD": { bid: 85813.6, ask: 85813.61 } });
  assertEquals(host.urls.map((u) => `${u.origin}${u.pathname}`), ["https://data-api.binance.vision/api/v3/ticker/bookTicker"]);
  assertEquals(await v.quotes(["BTC/GBP"]), {});
  assertEquals(host.urls.length, 1);                                                     // nothing to ask, no call
});

Deno.test("binancePaperVenue sizes by the pair's own rules and reads klines on the loop's intervals", async () => {
  const host = publicHost({
    "/api/v3/exchangeInfo": () => ({ symbols: [BTC_RULES, { ...BTC_RULES, symbol: "LUNAUSDT", status: "BREAK" }] }),
    "/api/v3/klines": (q) => {
      assertEquals([q.get("symbol"), q.get("interval"), q.get("startTime"), q.get("endTime")], ["BTCUSDT", "1m", "1000", "240000"]);
      return [[0, "1", "2", "0.5", "1.5", "10", 59_999], [60_000, "1.5", "3", "1", "2", "20", 119_999]];
    },
  });
  const v = binancePaperVenue(host.fetchImpl);
  assertEquals(await v.pairs(["BTC/USD", "LUNA/USD"]), { "BTC/USD": { base_step: "0.00001", quote_step: "0.01", min_order_size: "0.00001", min_order_size_quote: "5" } });
  // A kline that opened before `since` is dropped, as the other venues drop it.
  assertEquals(await v.candles("BTC/USD", 1, 1_000, 240_000), [{ start: 60_000, open: 1.5, high: 3, low: 1, close: 2, volume: 20 }]);
  await assertRejects(() => v.candles("BTC/USD", 7, 0, 1), Error, "no Binance kline interval for 7 minutes");
});

Deno.test("binancePaperVenue can never trade: no key, every order call refused, and nothing is sent anywhere", async () => {
  const host = publicHost({});
  const v = binancePaperVenue(host.fetchImpl);
  assertEquals([v.id, v.canTrade, v.feeBps], ["binance", false, { maker: 10, taker: 10 }]);
  const placed = await v.placeLimit({ clientOrderId: "c", symbol: "BTC/USD", side: "buy", base: "0.001", price: "85000", marketable: true });
  assert(!placed.ok && /paper rows only/.test(placed.error), JSON.stringify(placed));
  assert(!(await v.cancel("x")).ok && !(await v.order("x")).ok && !(await v.activeOrders()).ok);
  assertEquals(await v.balances(), {});
  assertEquals(host.urls.length, 0);
  // Every path it may call is public market data on the public host.
  assertEquals([...BINANCE_PUBLIC_PATHS], ["/api/v3/ticker/bookTicker", "/api/v3/exchangeInfo", "/api/v3/klines"]);
  assertEquals(BINANCE_PUBLIC_BASE, "https://data-api.binance.vision");
});

Deno.test("a refusal from Binance is a thrown error the tick reports, never an empty book read as prices", async () => {
  const v = binancePaperVenue(publicHost({ "/api/v3/ticker/bookTicker": () => ({ code: 0, msg: "restricted" }) }, 451).fetchImpl);
  await assertRejects(() => v.quotes(["BTC/USD"]), Error, "binance /api/v3/ticker/bookTicker 451");
});

