// Pins for the read-only Binance client: the signature against Binance's own documented example, and a probe that
// asks only for the read paths it lists, signs exactly the private ones, and reports no key and no amount.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BINANCE_READ_PATHS, binanceAccount, binanceAccountView, binanceProbe, binanceSignature, symbolRules } from "./binance.ts";

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

Deno.test("binanceAccountView: the fee in bps from Binance's fractions, the coins held (free + locked), and whether the key may trade", () => {
  const v = binanceAccountView({
    canTrade: true, commissionRates: { maker: "0.00100000", taker: "0.00075000" },
    balances: [{ asset: "USDT", free: "100.5", locked: "20" }, { asset: "BTC", free: "0.00000000", locked: "0.00000000" }, { asset: "BNB", free: "0.01", locked: "0" }],
  });
  assertEquals(v, { canTrade: true, feeBps: { maker: 10, taker: 7.5 }, balances: { USDT: 120.5, BNB: 0.01 } });
  // A fee the reply does not carry is unknown, never 0; a flag that is not `true` is not permission.
  assertEquals(binanceAccountView({ canTrade: "yes", commissionRates: { maker: "0.001" }, balances: "none" }), { canTrade: false, feeBps: null, balances: {} });
});

Deno.test("binanceAccount signs ONE read of the account, and a refused region comes back as the card's note, not a throw", async () => {
  const v = venue();
  const r = await binanceAccount({ apiKey: "KEY-ID-abc", secret: "SECRET-xyz", fetchImpl: v.fetchImpl, now: () => 1_700_000_000_000 });
  assertEquals(v.seen.map((s) => [s.path, s.signed, s.query.get("omitZeroBalances")]), [["/api/v3/account", true, "true"]]);
  assert(r.ok && r.view.balances.USDT === 123.45 && r.view.feeBps?.maker === 10, JSON.stringify(r));
  const refused = await binanceAccount({ apiKey: "k", secret: "s", fetchImpl: venue(451).fetchImpl });
  assertEquals(refused, { ok: false, error: "account 451: 0 Service unavailable from a restricted location" });
});
