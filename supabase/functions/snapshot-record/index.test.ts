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
  snapshotDepositFxMissing,
  historyLedgerFor,
  depositLedgerForHolding,
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

Deno.test("snapshotMarketValue: leftover closed lots still count toward Value", () => {
  const rth = new Date(Date.UTC(2026, 4, 28, 14, 0));
  const leftover = {
    positions: { FWD: { tickers: ["NVDA"] } },
    holdings: {
      NVDA: { currency: "USD", shares: 10, lastPrice: 100 },
      NET: {
        currency: "USD",
        shares: 0,
        closed: true,
        lastPrice: 300,
        lots: [{ date: "2025-01-02", shares: 3.5, cost: 100 }],
      },
    },
  };
  const needed = quoteTickersNeeded(leftover);
  assertEquals(needed.includes("NET"), true);
  const v = snapshotMarketValue(
    leftover,
    { NVDA: { lastPrice: 100 }, NET: { lastPrice: 300 } },
    {},
    rth,
  );
  assertEquals(v.value, 10 * 100 + 3.5 * 300);
  assertEquals(v.missingPrice, false);
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

Deno.test("skipReason: zero is valid; negative/non-finite is not", () => {
  assertEquals(skipReason({ value: 0, fxMissing: false, missingPrice: false }), null);
  assertEquals(skipReason({ value: -1, fxMissing: false, missingPrice: false }), "no-value");
  assertEquals(skipReason({ value: 1, fxMissing: false, missingPrice: false }), null);
});

Deno.test("snapshotDeposit: actual fills and board cash, never T212 card top-ups", () => {
  const quotes = {};
  assertEquals(snapshotDeposit(board, quotes, null), 10 * 70 + 1000);
  const t212 = {
    complete: true,
    orders: [
      { ticker: "NVDA", executed_at: "2026-01-15T00:00:00Z", side: "buy", shares: 10, price: 70 },
    ],
    transactions: [{ type: "deposit", amount: 4000, currency: "USD" }],
  };
  assertEquals(snapshotDeposit(board, quotes, t212), 10 * 70 + 1000);
});

Deno.test("snapshotDeposit: incomplete order history keeps the board ledger", () => {
  const t212 = {
    complete: false,
    orders: [
      { ticker: "NVDA", executed_at: "2026-01-15T00:00:00Z", side: "buy", shares: 1, price: 999 },
    ],
    transactions: [{ type: "deposit", amount: 4000, currency: "USD" }],
  };
  assertEquals(snapshotDeposit(board, {}, t212), 10 * 70 + 1000);
});

Deno.test("snapshotDeposit: missing frozen FX is unrecordable, never 1:1", () => {
  const gbpBoard = {
    positions: { FWD: { tickers: ["VUAA.L"] } },
    holdings: {
      "VUAA.L": { currency: "GBP", shares: 10, lots: [{ date: "2026-01-05", shares: 10, cost: 80 }] },
    },
  };
  const low = { "GBPUSD=X": { lastPrice: 1.25 } };
  const high = { "GBPUSD=X": { lastPrice: 1.40 } };
  assertEquals(snapshotDepositFxMissing(gbpBoard), true);
  assertEquals(Number.isNaN(snapshotDeposit(gbpBoard, low, null)), true);
  assertEquals(Number.isNaN(snapshotDeposit(gbpBoard, high, null)), true);
  const t212 = {
    complete: true,
    orders: [{ ticker: "VUAA.L" }],
    transactions: [{ type: "deposit", amount: 800, currency: "GBP" }],
  };
  assertEquals(Number.isNaN(snapshotDeposit(gbpBoard, high, t212)), true);
});

Deno.test("snapshotDeposit: persisted deposit FX converts once and stays fixed", () => {
  const gbpBoard = {
    depositFxRates: { GBP: 1.25 },
    positions: { FWD: { tickers: ["VUAA.L"] } },
    holdings: {
      "VUAA.L": {
        currency: "GBP",
        shares: 10,
        cost: 80,
        lots: [{ date: "2026-01-05", shares: 10, cost: 80 }],
      },
    },
  };
  assertEquals(snapshotDepositFxMissing(gbpBoard), false);
  assertEquals(snapshotDeposit(gbpBoard, { "GBPUSD=X": { lastPrice: 1.40 } }, null), 1000);
});

Deno.test("snapshotDeposit: mixed ticker keeps its other-platform money", () => {
  const mixed = {
    positions: { FWD: { tickers: ["NVDA"] } },
    holdings: {
      NVDA: {
        currency: "USD",
        shares: 10,
        cost: 176,
        lots: [
          { date: "2025-06-01", shares: 6, cost: 200 },
          { date: "2026-01-08", shares: 4, cost: 140 },
        ],
      },
    },
  };
  const t212 = {
    complete: true,
    orders: [
      { ticker: "NVDA", executed_at: "2026-01-08T00:00:00Z", side: "buy", shares: 4, price: 140 },
    ],
    transactions: [{ type: "deposit", amount: 4000, currency: "USD" }],
  };
  assertEquals(snapshotDeposit(mixed, {}, t212), 4 * 140 + 6 * 200);
});

Deno.test("snapshotDeposit: short machine ledger keeps known lots and appends residual", () => {
  const short = {
    positions: { FWD: { tickers: ["NVDA"] } },
    holdings: {
      NVDA: {
        currency: "USD",
        shares: 10,
        cost: 150,
        lots: [{ date: "2026-08-10", shares: 4, cost: 140 }],
      },
    },
  };
  assertEquals(snapshotDeposit(short, {}, null), 10 * 150);
  const repaired = historyLedgerFor(short.holdings.NVDA);
  assertEquals(repaired.lots, [
    { date: "2026-08-10", shares: 4, cost: 140 },
    { date: "1970-01-01", shares: 6, cost: (1500 - 560) / 6, source: "opening-residual" },
  ]);
  assertEquals(repaired.sells, []);
});

Deno.test("snapshotDeposit: August other-broker step survives beside a January T212 fill", () => {
  const mixed = {
    positions: { FWD: { tickers: ["ETF"] } },
    holdings: {
      ETF: {
        currency: "USD",
        shares: 10,
        cost: 75,
        t212Shares: 4,
        t212Cost: 50,
        lots: [{ date: "2026-08-10", shares: 4, cost: 100 }],
      },
    },
  };
  const t212 = {
    complete: true,
    orders: [
      { ticker: "ETF", executed_at: "2026-01-15T00:00:00Z", side: "buy", shares: 4, price: 50 },
    ],
  };
  assertEquals(snapshotDeposit(mixed, {}, t212), 750);
  const ledger = depositLedgerForHolding(mixed.holdings.ETF, {
    lots: [{ date: "2026-01-15", shares: 4, cost: 50 }],
    sells: [],
  });
  assertEquals(ledger.lots, [
    { date: "2026-08-10", shares: 4, cost: 100 },
    { date: "2026-01-15", shares: 4, cost: 50 },
    { date: "1970-01-01", shares: 2, cost: 75, source: "opening-residual" },
  ]);
});

Deno.test("snapshotDeposit: mixed cost split uses remembered T212 AC", () => {
  const mixed = {
    positions: { FWD: { tickers: ["ETF"] } },
    holdings: {
      ETF: {
        currency: "USD",
        shares: 10,
        cost: 90,
        t212Shares: 4,
        t212Cost: 80,
        lots: [{ date: "2025-01-01", shares: 10, cost: 90 }],
      },
    },
  };
  const t212 = {
    orders: [
      { ticker: "ETF", executed_at: "2025-02-01T00:00:00Z", side: "buy", shares: 5, price: 100 },
      { ticker: "ETF", executed_at: "2025-03-01T00:00:00Z", side: "sell", shares: 1, price: 120 },
    ],
    transactions: [],
    complete: true,
  };
  assertEquals(snapshotDeposit(mixed, {}, t212), 580 + 380);
});

Deno.test("snapshotDeposit: closed other-broker history survives beside T212", () => {
  const closed = {
    positions: {},
    holdings: {
      OLD: {
        currency: "USD",
        shares: 0,
        cost: 0,
        closed: true,
        lots: [
          { date: "2025-01-01", shares: 5, cost: 100 },
          { date: "2025-02-01", shares: 2, cost: 50 },
        ],
        sells: [
          { date: "2025-03-01", shares: 5, price: 120 },
          { date: "2025-04-01", shares: 2, price: 60 },
        ],
      },
    },
  };
  const t212 = {
    complete: true,
    orders: [
      { ticker: "OLD", executed_at: "2025-02-01T10:00:00Z", side: "buy", shares: 2, price: 50 },
      { ticker: "OLD", executed_at: "2025-04-01T10:00:00Z", side: "sell", shares: 2, price: 60 },
    ],
  };
  assertEquals(snapshotDeposit(closed, {}, t212), -120);
});

Deno.test("snapshotDeposit: closed legacy synthetic lot is not double-counted", () => {
  const closed = {
    positions: {},
    holdings: {
      OLD: {
        currency: "USD",
        shares: 0,
        cost: 0,
        closed: true,
        lots: [{ date: "1970-01-01", shares: 4, cost: 80 }],
        sells: [],
      },
    },
  };
  const t212 = {
    complete: true,
    orders: [
      { ticker: "OLD", executed_at: "2025-02-01T10:00:00Z", side: "buy", shares: 4, price: 80 },
      { ticker: "OLD", executed_at: "2025-04-01T10:00:00Z", side: "sell", shares: 4, price: 95 },
    ],
  };
  assertEquals(snapshotDeposit(closed, {}, t212), -60);
});

Deno.test("snapshotDeposit: synthetic residue drops without losing other round trip", () => {
  const closed = {
    positions: {},
    holdings: {
      OLD: {
        currency: "USD", shares: 0, cost: 0, closed: true,
        lots: [
          { date: "2026-01-01", shares: 4, cost: 80, source: "t212-synthetic" },
          { date: "2024-01-01", shares: 1, cost: 100 },
        ],
        sells: [{ date: "2024-02-01", shares: 1, price: 120 }],
      },
    },
  };
  const t212 = {
    complete: true,
    orders: [
      { ticker: "OLD", executed_at: "2025-02-01T10:00:00Z", side: "buy", shares: 4, price: 80 },
      { ticker: "OLD", executed_at: "2025-04-01T10:00:00Z", side: "sell", shares: 4, price: 95 },
    ],
  };
  assertEquals(snapshotDeposit(closed, {}, t212), -80);
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
