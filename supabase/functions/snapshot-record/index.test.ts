// Pin the pure helpers of snapshot-record. Deno.serve is behind
// `if (import.meta.main)` so importing here binds no port.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bucketTimeIso,
  isUsRegularSession,
  t212TickerToYahoo,
  extractT212Prices,
  mergePriceMaps,
  detectCurrency,
  fxRateToUSD,
  pickLivePrice,
  quoteTickersNeeded,
  snapshotMarketValue,
  snapshotDeposit,
  t212CashIsReady,
  skipReason,
  lastPerBucket,
  pruneSnapshotTimestamps,
  SNAPSHOT_KEEP_5M_MS,
  SNAPSHOT_KEEP_30M_MS,
} from "./index.ts";

Deno.test("bucketTimeIso: floors to the 5-min boundary", () => {
  assertEquals(bucketTimeIso(Date.UTC(2026, 7, 18, 4, 32, 10)), "2026-08-18T04:30:00.000Z");
  assertEquals(bucketTimeIso(Date.UTC(2026, 7, 18, 4, 35, 0)), "2026-08-18T04:35:00.000Z");
});

Deno.test("isUsRegularSession: weekday RTH only, holiday excluded", () => {
  // Thu 2026-05-28 10:00 ET = 14:00 UTC (EDT)
  assertEquals(isUsRegularSession(new Date(Date.UTC(2026, 4, 28, 14, 0))), true);
  // Thu 17:00 ET = 21:00 UTC — after hours
  assertEquals(isUsRegularSession(new Date(Date.UTC(2026, 4, 28, 21, 0))), false);
  // Sat midday
  assertEquals(isUsRegularSession(new Date(Date.UTC(2026, 4, 30, 16, 0))), false);
  // Fri 2026-07-03 Independence Day observed, 10:00 ET
  assertEquals(isUsRegularSession(new Date(Date.UTC(2026, 6, 3, 14, 0))), false);
});

Deno.test("t212TickerToYahoo: US, LSE, aliases", () => {
  assertEquals(t212TickerToYahoo("AAPL_US_EQ"), "AAPL");
  assertEquals(t212TickerToYahoo("VUAAl_EQ"), "VUAA.L");
  assertEquals(t212TickerToYahoo("FB_US_EQ"), "META");
  assertEquals(t212TickerToYahoo("WEIRD"), null);
});

Deno.test("extractT212Prices: nested + flat, every recognised ticker not just overnight US", () => {
  const prices = extractT212Prices([
    { instrument: { ticker: "AAPL_US_EQ" }, currentPrice: 200 },
    { ticker: "VUAAl_EQ", currentPrice: 98.4 },
    { ticker: "HOOD_US_EQ", currentPrice: 0 },
    { ticker: "SKIPME", currentPrice: 1 },
  ]);
  assertEquals(prices["AAPL"], 200);
  assertEquals(prices["VUAA.L"], 98.4);
  assertEquals("HOOD" in prices, false);
  assertEquals("SKIPME" in prices, false);
});

Deno.test("mergePriceMaps: first argument wins ties", () => {
  assertEquals(mergePriceMaps({ A: 1, B: 2 }, { B: 9, C: 3 }), { A: 1, B: 2, C: 3 });
});

Deno.test("detectCurrency: holding currency wins; VUAA.L is USD not GBP", () => {
  assertEquals(detectCurrency("VUAA.L"), "USD");
  assertEquals(detectCurrency("VUAG.L"), "GBP");
  assertEquals(detectCurrency("017731"), "CNY");
  assertEquals(detectCurrency("NVDA", "USD"), "USD");
  assertEquals(detectCurrency("FOO.L", "USD"), "USD");
  assertEquals(detectCurrency("2DG.SG"), "EUR");
});

Deno.test("fxRateToUSD: live pair, invert CNY, missing flags 1:1", () => {
  assertEquals(fxRateToUSD("USD", {}), { rate: 1, missing: false });
  assertEquals(fxRateToUSD("GBP", { "GBPUSD=X": { lastPrice: 1.25 } }), { rate: 1.25, missing: false });
  assertEquals(fxRateToUSD("GBP", {}), { rate: 1, missing: true });
  assertEquals(fxRateToUSD("CNY", { "USDCNY=X": { lastPrice: 7 } }), { rate: 1 / 7, missing: false });
});

Deno.test("pickLivePrice: T212 wins; RTH uses lastPrice; off-session prefers extPrice", () => {
  const rth = new Date(Date.UTC(2026, 4, 28, 14, 0)); // 10:00 ET Thursday
  const ah = new Date(Date.UTC(2026, 4, 28, 21, 0));  // 17:00 ET
  const quote = { lastPrice: 100, extPrice: 104 };
  assertEquals(pickLivePrice(quote, 111, 90, ah), 111);
  assertEquals(pickLivePrice(quote, undefined, 90, rth), 100);
  assertEquals(pickLivePrice(quote, undefined, 90, ah), 104);
  assertEquals(pickLivePrice({ lastPrice: 100 }, undefined, 90, ah), 100);
  assertEquals(pickLivePrice({}, undefined, 90, rth), 90);
  assertEquals(pickLivePrice({}, undefined, undefined, rth), null);
});

const board = {
  positions: { FWD: { tickers: ["NVDA", "CASH"] } },
  holdings: {
    NVDA: { currency: "USD", shares: 10, lastPrice: 80, lots: [{ date: "2026-01-15", shares: 10, cost: 70 }] },
    CASH: { isCash: true, lastPrice: 1000 },
  },
};

Deno.test("quoteTickersNeeded: board-scoped, skips cash, asks for FX pairs", () => {
  const gbpBoard = {
    positions: { FWD: { tickers: ["VUAG.L"] } },
    holdings: { "VUAG.L": { currency: "GBP", shares: 1 } },
  };
  const needed = quoteTickersNeeded(gbpBoard);
  assertEquals(needed.includes("VUAG.L"), true);
  assertEquals(needed.includes("GBPUSD=X"), true);
  assertEquals(quoteTickersNeeded(board).includes("CASH"), false);
});

Deno.test("snapshotMarketValue: shares × price + cash, USD", () => {
  const rth = new Date(Date.UTC(2026, 4, 28, 14, 0));
  const v = snapshotMarketValue(board, { NVDA: { lastPrice: 100 } }, {}, rth);
  // 10×100 + 1000 cash
  assertEquals(v.value, 2000);
  assertEquals(v.fxMissing, false);
  assertEquals(v.missingPrice, false);
});

Deno.test("snapshotMarketValue: GBP × live FX; missing FX flags the tick", () => {
  const rth = new Date(Date.UTC(2026, 4, 28, 14, 0));
  const gbpBoard = {
    positions: { FWD: { tickers: ["VUAG.L"] } },
    holdings: { "VUAG.L": { currency: "GBP", shares: 10, lastPrice: 80 } },
  };
  const ok = snapshotMarketValue(
    gbpBoard,
    { "VUAG.L": { lastPrice: 80 }, "GBPUSD=X": { lastPrice: 1.25 } },
    {},
    rth,
  );
  assertEquals(ok.value, 10 * 80 * 1.25);
  assertEquals(ok.fxMissing, false);
  const miss = snapshotMarketValue(gbpBoard, { "VUAG.L": { lastPrice: 80 } }, {}, rth);
  assertEquals(miss.fxMissing, true);
  assertEquals(skipReason(miss), "fx-missing");
});

Deno.test("snapshotMarketValue: T212 overlay values an overnight US name", () => {
  const overnight = new Date(Date.UTC(2026, 4, 29, 1, 0)); // 21:00 ET Thu
  const v = snapshotMarketValue(
    board,
    { NVDA: { lastPrice: 100, extPrice: 102 } },
    { NVDA: 110 },
    overnight,
  );
  assertEquals(v.value, 10 * 110 + 1000);
});

Deno.test("snapshotMarketValue: a positioned ticker with no print is unrecordable", () => {
  const rth = new Date(Date.UTC(2026, 4, 28, 14, 0));
  const empty = {
    positions: { FWD: { tickers: ["NVDA"] } },
    holdings: { NVDA: { currency: "USD", shares: 10 } },
  };
  const v = snapshotMarketValue(empty, {}, {}, rth);
  assertEquals(v.missingPrice, true);
  assertEquals(skipReason(v), "no-price");
});

Deno.test("skipReason: refuse a zero / non-finite book", () => {
  assertEquals(skipReason({ value: 0, fxMissing: false, missingPrice: false }), "no-value");
  assertEquals(skipReason({ value: 1, fxMissing: false, missingPrice: false }), null);
});

Deno.test("t212CashIsReady: complete + at least one deposit/withdraw", () => {
  assertEquals(t212CashIsReady({ complete: true, transactions: [{ type: "deposit" }] }), true);
  assertEquals(t212CashIsReady({ complete: false, transactions: [{ type: "deposit" }] }), false);
  assertEquals(t212CashIsReady({ complete: true, transactions: [{ type: "fee" }] }), false);
  assertEquals(t212CashIsReady({ complete: true, transactions: [] }), false);
});

Deno.test("snapshotDeposit: lots + cash until T212 cash history is complete", () => {
  const quotes = {};
  assertEquals(snapshotDeposit(board, quotes, null), 10 * 70 + 1000);
  const t212 = {
    complete: true,
    orders: [{ ticker: "NVDA" }],
    transactions: [{ type: "deposit", amount: 4000, currency: "USD" }],
  };
  // 4000 money-in; do not also add lot cost or idle cash.
  assertEquals(snapshotDeposit(board, quotes, t212), 4000);
});

Deno.test("snapshotDeposit: unfinished T212 walk keeps the ledger formula", () => {
  const t212 = {
    complete: false,
    orders: [{ ticker: "NVDA" }],
    transactions: [{ type: "deposit", amount: 4000, currency: "USD" }],
  };
  assertEquals(snapshotDeposit(board, {}, t212), 10 * 70 + 1000);
});

Deno.test("snapshotDeposit: a non-T212 holding still counts from its lots", () => {
  const mixed = {
    positions: { FWD: { tickers: ["NVDA", "PVT"] } },
    holdings: {
      NVDA: { currency: "USD", shares: 10, lots: [{ date: "2026-01-15", shares: 10, cost: 70 }] },
      PVT: { currency: "USD", shares: 1, lots: [{ date: "2026-01-10", shares: 1, cost: 500 }] },
    },
  };
  const t212 = {
    complete: true,
    orders: [{ ticker: "NVDA" }],
    transactions: [{ type: "deposit", amount: 4000, currency: "USD" }],
  };
  assertEquals(snapshotDeposit(mixed, {}, t212), 4000 + 500);
});

Deno.test("lastPerBucket: keeps the last sample in each slice", () => {
  const t0 = Date.parse("2026-08-18T00:00:00Z");
  const pts = [t0, t0 + 5 * 60_000, t0 + 10 * 60_000, t0 + 30 * 60_000];
  assertEquals(lastPerBucket(pts, 30 * 60), [t0 + 10 * 60_000, t0 + 30 * 60_000]);
});

Deno.test("pruneSnapshotTimestamps: 24H keeps every 5-min point; older bands coarsen", () => {
  const now = Date.parse("2026-08-18T12:00:00Z");
  const min5 = 5 * 60_000;
  // 12 hours of 5-min samples — all inside 26 h, all kept.
  const recent: number[] = [];
  for (let t = now - 12 * 3600_000; t < now; t += min5) recent.push(t);
  const keptRecent = pruneSnapshotTimestamps(recent, now);
  assertEquals(keptRecent.length, recent.length);

  // One day of 5-min samples from 3 days ago → last-per-30-min = 48.
  const threeDaysAgo = now - 3 * 24 * 3600_000;
  const oldDay: number[] = [];
  for (let t = threeDaysAgo; t < threeDaysAgo + 24 * 3600_000; t += min5) oldDay.push(t);
  const keptOld = pruneSnapshotTimestamps(oldDay, now);
  assertEquals(keptOld.length, 48);
  // And nothing older than 400 days survives.
  assertEquals(pruneSnapshotTimestamps([now - 500 * 24 * 3600_000], now), []);
});

Deno.test("pruneSnapshotTimestamps: 26 h boundary still 5-min; 8-day band is hourly", () => {
  const now = Date.parse("2026-08-18T12:00:00Z");
  const inside = now - (SNAPSHOT_KEEP_5M_MS - 5 * 60_000);
  const justOutside = now - (SNAPSHOT_KEEP_5M_MS + 5 * 60_000);
  const kept = pruneSnapshotTimestamps([inside, justOutside], now);
  assertEquals(kept.includes(inside), true);
  // justOutside is in the 30-min band; a lone point is the last in its bucket.
  assertEquals(kept.includes(justOutside), true);
  // A neighbour 5 min earlier in the same 30-min bucket is dropped.
  const neighbour = justOutside - 5 * 60_000;
  const coarsened = pruneSnapshotTimestamps([neighbour, justOutside], now);
  assertEquals(coarsened, [justOutside]);
  assertEquals(SNAPSHOT_KEEP_30M_MS > SNAPSHOT_KEEP_5M_MS, true);
});
