// Pin tests for snapshot-record's pure helpers. The function records
// PRICES, so what has to be pinned is which price it picks and which
// tickers it asks about — never a portfolio value, because it does not
// compute one (see the file header for why that matters).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bucketTimeIso,
  buildPriceRow,
  extractT212Prices,
  isUsRegularSession,
  mergePriceMaps,
  recordablePrice,
  t212TickerToYahoo,
  tickersToRecord,
} from "./index.ts";

Deno.test("bucketTimeIso floors to the 5-minute bucket", () => {
  assertEquals(bucketTimeIso(Date.UTC(2026, 7, 18, 14, 3, 59, 999)), "2026-08-18T14:00:00.000Z");
  assertEquals(bucketTimeIso(Date.UTC(2026, 7, 18, 14, 5, 0, 0)), "2026-08-18T14:05:00.000Z");
  assertEquals(bucketTimeIso(Date.UTC(2026, 7, 18, 14, 9, 59, 0)), "2026-08-18T14:05:00.000Z");
});

Deno.test("isUsRegularSession — inside, outside, weekend, holiday", () => {
  // 2026-08-18 is a Tuesday. 14:00 UTC = 10:00 EDT → in session.
  assertEquals(isUsRegularSession(new Date("2026-08-18T14:00:00Z")), true);
  // 12:00 UTC = 08:00 EDT → premarket.
  assertEquals(isUsRegularSession(new Date("2026-08-18T12:00:00Z")), false);
  // 21:00 UTC = 17:00 EDT → after hours.
  assertEquals(isUsRegularSession(new Date("2026-08-18T21:00:00Z")), false);
  // Saturday.
  assertEquals(isUsRegularSession(new Date("2026-08-22T14:00:00Z")), false);
  // Independence Day, observed Friday 2026-07-03.
  assertEquals(isUsRegularSession(new Date("2026-07-03T14:00:00Z")), false);
});

Deno.test("t212TickerToYahoo — LSE suffix, US suffix, renames, junk", () => {
  assertEquals(t212TickerToYahoo("VUAAl_EQ"), "VUAA.L");
  assertEquals(t212TickerToYahoo("AAPL_US_EQ"), "AAPL");
  assertEquals(t212TickerToYahoo("YNDX_US_EQ"), "NBIS");
  assertEquals(t212TickerToYahoo("nonsense"), null);
  assertEquals(t212TickerToYahoo(""), null);
});

Deno.test("extractT212Prices — flat and nested shapes, bad rows dropped", () => {
  assertEquals(
    extractT212Prices([
      { ticker: "AAPL_US_EQ", currentPrice: 231.5 },
      { instrument: { ticker: "VUAAl_EQ" }, currentPrice: 112.25 },
      { ticker: "AAPL_US_EQ" }, // no price
      { ticker: "ZZZ", currentPrice: 1 }, // unmappable
      null,
    ]),
    { AAPL: 231.5, "VUAA.L": 112.25 },
  );
  assertEquals(extractT212Prices("not an array"), {});
});

Deno.test("mergePriceMaps — the first map wins", () => {
  assertEquals(mergePriceMaps({ A: 1 }, { A: 2, B: 3 }), { A: 1, B: 3 });
});

Deno.test("tickersToRecord — board scope, cash excluded", () => {
  const portfolio = {
    holdings: {
      AAPL: { shares: 10 },
      NVDA: { shares: 5 },
      ORPHAN: { shares: 1 },
      CASH: { shares: 1, isCash: true, lastPrice: 500 },
    },
    positions: { A: { tickers: ["AAPL", "CASH"] }, B: { tickers: ["NVDA"] } },
  };
  // ORPHAN isn't on the board, so the scoreboard doesn't count it and
  // neither does the chart — recording it would be recording a price
  // nothing reads.
  assertEquals(tickersToRecord(portfolio), ["AAPL", "NVDA"]);
  // No positions at all (a fixture): the scope opens up, matching
  // computeAt's own escape hatch.
  assertEquals(
    tickersToRecord({ holdings: { AAPL: { shares: 1 } } }),
    ["AAPL"],
  );
  assertEquals(tickersToRecord(null), []);
});

Deno.test("recordablePrice — broker print wins, then session-correct Yahoo", () => {
  const rth = new Date("2026-08-18T14:00:00Z");   // 10:00 EDT
  const ah = new Date("2026-08-18T22:00:00Z");    // 18:00 EDT

  // The broker's own quote beats Yahoo in either session.
  assertEquals(recordablePrice({ lastPrice: 100, extPrice: 101 }, 99, rth), 99);

  // In session, the live tape — NOT last night's ext print.
  assertEquals(recordablePrice({ lastPrice: 100, extPrice: 90 }, undefined, rth), 100);

  // Out of session, the ext print is the current one.
  assertEquals(recordablePrice({ lastPrice: 100, extPrice: 101 }, undefined, ah), 101);
  // …falling back to the regular close when there's no ext print.
  assertEquals(recordablePrice({ lastPrice: 100 }, undefined, ah), 100);

  // No quote at all → nothing to record. Deliberately does not reach for
  // the holding's stored lastPrice: that is whatever the browser last
  // wrote to board_data and could be days old, and stamping it with a
  // fresh timestamp would turn stale data into fake history.
  assertEquals(recordablePrice(null, undefined, rth), null);
  assertEquals(recordablePrice({ lastPrice: 0 }, undefined, rth), null);
});

Deno.test("buildPriceRow — only the tickers that could be priced", () => {
  const at = new Date("2026-08-18T14:00:00Z");
  assertEquals(
    buildPriceRow(
      ["AAPL", "NVDA", "017731"],
      { AAPL: { lastPrice: 231.5 }, NVDA: { lastPrice: 0 } },
      { "017731": 1.63 },
      at,
    ),
    { AAPL: 231.5, "017731": 1.63 },
  );
});
