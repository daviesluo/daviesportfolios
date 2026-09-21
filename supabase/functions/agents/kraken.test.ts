// Pins for the Kraken client: the signature against the venue's own
// published test vector, the wire-shape translations, and the order
// state mapping the tick settles on.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formBody, fromKrakenAsset, fromKrakenPair, krakenNonce, krakenSign, krakenVenue, makeNonce, toAltname, toCandles, toOrderView, toPairConfig,
  type KrakenOrder,
} from "../_shared/kraken.ts";

// docs.kraken.com/api/docs/guides/spot-rest-auth — "Examples", verbatim.
const VECTOR = {
  secret: "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==",
  nonce: "1616492376594",
  body: "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25",
  path: "/0/private/AddOrder",
  sign: "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==",
};

Deno.test("krakenSign reproduces the documented test vector byte for byte", async () => {
  assertEquals(await krakenSign(VECTOR.path, VECTOR.nonce, VECTOR.body, VECTOR.secret), VECTOR.sign);
});

Deno.test("formBody puts the nonce first and encodes the rest; the vector's body is reproduced from its parts", () => {
  const body = formBody("1616492376594", { ordertype: "limit", pair: "XBTUSD", price: "37500", type: "buy", volume: "1.25" });
  assertEquals(body, VECTOR.body);
  assertEquals(formBody("1", { validate: true, skip: undefined, pair: "XBTUSD,ETHUSD" }), "nonce=1&validate=true&pair=XBTUSD%2CETHUSD");
});

Deno.test("makeNonce only ever goes up, even inside one microsecond", () => {
  const next = makeNonce(1_000_000);
  const a = BigInt(next()), b = BigInt(next()), c = BigInt(next());
  assert(a < b && b < c, `${a} ${b} ${c}`);
  assert(a >= 1_000_000n);
});

Deno.test("symbol translation both ways, and only for the pairs we trade", () => {
  assertEquals(toAltname("BTC/USD"), "XBTUSD");
  assertEquals(fromKrakenPair("XXBTZUSD"), "BTC/USD");
  assertEquals(fromKrakenPair("XETHZUSD"), "ETH/USD");
  assertEquals(fromKrakenPair("SOLUSD"), "SOL/USD");
  assertEquals(fromKrakenPair("XBT/USD"), "BTC/USD");
  assertEquals(fromKrakenPair("DOGEUSD"), null);
  assertEquals(fromKrakenAsset("XXBT"), "BTC");
  assertEquals(fromKrakenAsset("ZUSD"), "USD");
  assertEquals(fromKrakenAsset("SOL"), "SOL");
  let threw = false;
  try { toAltname("DOGE/USD"); } catch { threw = true; }
  assert(threw);
});

Deno.test("toPairConfig turns lot_decimals / tick_size / ordermin / costmin into the sizing config", () => {
  const cfg = toPairConfig({
    altname: "XBTUSD", wsname: "XBT/USD", base: "XXBT", quote: "ZUSD", pair_decimals: 1, lot_decimals: 8, cost_decimals: 5,
    ordermin: "0.00005", costmin: "0.5", tick_size: "0.1", status: "online",
  });
  assertEquals(cfg, { base_step: "0.00000001", quote_step: "0.1", min_order_size: "0.00005", min_order_size_quote: "0.5" });
});

Deno.test("toCandles: seconds → ms, strings → numbers, volume from column 6", () => {
  const [c] = toCandles([[1789862400, "81234.9", "81302.8", "80101.0", "80461.0", "80702.1", "329.02517906", 13945]]);
  assertEquals(c, { start: 1789862400000, open: 81234.9, high: 81302.8, low: 80101.0, close: 80461.0, volume: 329.02517906 });
});

const order = (over: Partial<KrakenOrder>): KrakenOrder => ({
  status: "open", vol: "0.001", vol_exec: "0", cost: "0", fee: "0", price: "0",
  descr: { pair: "XBTUSD", type: "buy", ordertype: "limit", price: "80000.0", order: "buy 0.00100000 XBTUSD @ limit 80000.0" }, opentm: 1, ...over,
});

Deno.test("toOrderView maps the venue's statuses onto the tick's states", () => {
  assertEquals(toOrderView(order({ status: "pending" })).state, "new");
  assertEquals(toOrderView(order({ status: "open" })).state, "new");
  assertEquals(toOrderView(order({ status: "open", vol_exec: "0.0004", price: "79990.0" })).state, "partially_filled");
  const filled = toOrderView(order({ status: "closed", vol_exec: "0.001", price: "79990.0", fee: "0.32" }));
  assertEquals(filled, { state: "filled", filledBase: 0.001, avgPrice: 79990, feeUsd: 0.32, raw: filled.raw });
  assertEquals(toOrderView(order({ status: "canceled" })).state, "cancelled");
  assertEquals(toOrderView(order({ status: "canceled", vol_exec: "0.0005", price: "79990.0" })).state, "filled");
  assertEquals(toOrderView(order({ status: "expired" })).state, "cancelled");
});

Deno.test("krakenVenue without credentials serves public data and refuses to trade", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("/0/public/Ticker")) {
      return Promise.resolve(new Response(JSON.stringify({ error: [], result: { XXBTZUSD: { a: ["80459.4", "1", "1.000"], b: ["80459.3", "1", "1.000"], c: ["80461.6", "0.1"], v: ["1", "2"], p: ["1", "1"], t: [1, 1], l: ["1", "1"], h: ["1", "1"], o: "1" } } })));
    }
    if (url.includes("/0/public/OHLC")) {
      return Promise.resolve(new Response(JSON.stringify({ error: [], result: { XXBTZUSD: [[1789848000, "1", "2", "0.5", "1.5", "1", "3", 1], [1789862400, "1", "2", "0.5", "1.5", "1", "3", 1]], last: 1789848000 } })));
    }
    assert(!init || init.method !== "POST", "no private call should be made without credentials");
    return Promise.resolve(new Response(JSON.stringify({ error: ["EGeneral:Unexpected"] })));
  };
  const v = krakenVenue(null, fetchImpl);
  assertEquals(v.canTrade, false);
  assertEquals(v.feeBps, { maker: 40, taker: 80 });
  assertEquals(await v.quotes(["BTC/USD"]), { "BTC/USD": { bid: 80459.3, ask: 80459.4 } });
  const c = await v.candles("BTC/USD", 240, 1789862400000, 1789876500000);
  assertEquals(c.map((x) => x.start), [1789862400000]);      // the row before `since` is dropped
  const placed = await v.placeLimit({ clientOrderId: "x", symbol: "BTC/USD", side: "buy", base: "0.0001", price: "10000.0" });
  assertEquals(placed.ok, false);
  assertEquals(await v.balances(), {});
  assert(seen.every((u) => u.includes("/0/public/")));
});

Deno.test("krakenVenue signs private calls: API-Key/API-Sign headers, form body with nonce first, post-only GTC limit", async () => {
  let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
  const fetchImpl: typeof fetch = (input, init) => {
    captured = { url: String(input), headers: init?.headers as Record<string, string>, body: String(init?.body) };
    return Promise.resolve(new Response(JSON.stringify({ error: [], result: { descr: { order: "buy 0.00010000 XBTUSD @ limit 10000.0" }, txid: ["OABC-123"] } })));
  };
  const v = krakenVenue({ apiKey: "key-id", secret: VECTOR.secret, nonce: makeNonce(5_000_000) }, fetchImpl);
  const r = await v.placeLimit({ clientOrderId: "6d1b345e-2821-40e2-ad83-4ecb18a06876", symbol: "BTC/USD", side: "buy", base: "0.0001", price: "10000.0" });
  assert(r.ok && r.venueOrderId === "OABC-123");
  const c = captured!;
  assertEquals(c.url, "https://api.kraken.com/0/private/AddOrder");
  assertEquals(c.headers["API-Key"], "key-id");
  assert(c.headers["API-Sign"].length > 60);
  assert(/^nonce=\d{16,}&/.test(c.body), c.body);          // microseconds, never below the clock
  assert(c.body.includes("pair=XBTUSD&type=buy&ordertype=limit&volume=0.0001&price=10000.0&oflags=post&timeinforce=GTC&cl_ord_id=6d1b345e-2821-40e2-ad83-4ecb18a06876"), c.body);
  assert(!c.body.includes("validate"));
  // The signature is over exactly the body sent.
  const nonce = c.body.match(/^nonce=(\d+)/)![1];
  assertEquals(c.headers["API-Sign"], await krakenSign("/0/private/AddOrder", nonce, c.body, VECTOR.secret));
});

Deno.test("XRP/USD is a Kraken pair too (XRPUSD / XXRPZUSD / XXRP), and a batch call drops unknown symbols instead of failing whole", async () => {
  const { KRAKEN_ALTNAME, KRAKEN_PAIR_ID, KRAKEN_ASSET, fromKrakenPair, krakenSupports, krakenVenue } = await import("../_shared/kraken.ts");
  assertEquals([KRAKEN_ALTNAME["XRP/USD"], KRAKEN_PAIR_ID["XRP/USD"], KRAKEN_ASSET.XXRP], ["XRPUSD", "XXRPZUSD", "XRP"]);
  assertEquals([KRAKEN_ASSET.ZGBP, KRAKEN_ASSET.ZEUR, KRAKEN_ASSET.USDC], ["GBP", "EUR", "USDC"]);   // a UK deposit arrives as ZGBP and must be named, not dropped
  assertEquals(fromKrakenPair("XXRPZUSD"), "XRP/USD");
  assertEquals([krakenSupports("XRP/USD"), krakenSupports("DOGE/USD")], [true, false]);
  // AVAX/USD joined the 4-hour trend rule with migration 0039 (reference §3.7): Kraken's pair id is its altname, the asset code is plain.
  assertEquals([KRAKEN_ALTNAME["AVAX/USD"], KRAKEN_PAIR_ID["AVAX/USD"], KRAKEN_ASSET.AVAX, fromKrakenPair("AVAXUSD"), krakenSupports("AVAX/USD")], ["AVAXUSD", "AVAXUSD", "AVAX", "AVAX/USD", true]);
  // SUI/USD joined with migration 0040 (reference §3.8): the same plain naming on Kraken's side.
  assertEquals([KRAKEN_ALTNAME["SUI/USD"], KRAKEN_PAIR_ID["SUI/USD"], KRAKEN_ASSET.SUI, fromKrakenPair("SUIUSD"), krakenSupports("SUI/USD")], ["SUIUSD", "SUIUSD", "SUI", "SUI/USD", true]);
  const urls: string[] = [];
  const f: typeof fetch = (url) => {
    urls.push(String(url));
    return Promise.resolve(new Response(JSON.stringify({ error: [], result: { XXRPZUSD: { a: ["0.5001", "1", "1"], b: ["0.5000", "1", "1"] } } })));
  };
  const v = krakenVenue(null, f);
  const q = await v.quotes(["XRP/USD", "DOGE/USD"]);                     // DOGE is not ours: filtered, not thrown
  assertEquals(Object.keys(q), ["XRP/USD"]);
  assert(urls[0].includes("pair=XRPUSD") && !urls[0].includes("DOGE"), urls[0]);
  assertEquals(await v.quotes(["DOGE/USD"]), {});                        // nothing known: no call at all
  assertEquals(urls.length, 1);
});

Deno.test("a marketable Kraken order drops the post-only flag and is immediate-or-cancel; a resting one stays post-only GTC", async () => {
  const { krakenVenue } = await import("../_shared/kraken.ts");
  const bodies: string[] = [];
  const f: typeof fetch = async (_url, init) => {
    bodies.push(String(init?.body));
    return new Response(JSON.stringify({ error: [], result: { txid: ["T-1"], descr: { order: "x" } } }));
  };
  const env = { apiKey: "k", secret: btoa("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), nonce: () => "1" };
  const v = krakenVenue(env, f);
  await v.placeLimit({ clientOrderId: "c1", symbol: "BTC/USD", side: "sell", base: "0.001", price: "50000.0", marketable: true });
  await v.placeLimit({ clientOrderId: "c2", symbol: "BTC/USD", side: "sell", base: "0.001", price: "50000.0" });
  assert(bodies[0].includes("timeinforce=IOC") && !bodies[0].includes("oflags=post"), bodies[0]);
  assert(bodies[1].includes("timeinforce=GTC") && bodies[1].includes("oflags=post"), bodies[1]);
});

Deno.test("the isolate has ONE nonce sequence: concurrent private calls cannot mint the same nonce", () => {
  // Two generators seeded from the same millisecond clock collide; the shared one cannot.
  const a = makeNonce(1_700_000_000_000_000), b = makeNonce(1_700_000_000_000_000);
  assertEquals(a(), b());                                              // the bug, reproduced: two generators, one nonce
  const seq = [krakenNonce(), krakenNonce(), krakenNonce()].map(Number);
  assert(seq[1] > seq[0] && seq[2] > seq[1], seq.join(","));
  assert(seq.every((n) => Number.isInteger(n) && n > 1.7e15), seq.join(","));   // microseconds since the epoch, as Kraken expects
});
