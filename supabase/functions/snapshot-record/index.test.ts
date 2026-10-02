// Pin tests for snapshot-record's pure helpers. The function records
// PRICES, so what has to be pinned is which price it picks and which
// tickers it asks about — never a portfolio value, because it does not
// compute one (see the file header for why that matters).
import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as sharedTickers from "../_shared/t212_tickers.ts";
import {
  boardPricesOf,
  bucketTimeIso,
  buildPriceRow,
  extractT212Prices,
  handle,
  isUsOvernightSession,
  isUsRegularSession,
  mergePriceMaps,
  recordablePrice,
  recordsT212Price,
  t212TickerToYahoo,
  tickersToRecord,
  unitSkips,
  unitsDiffer,
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

// The map's own pins are `_shared/t212_tickers.test.ts`. Pinned here: this recorder reads that one map. The identity
// fails if a copy of the function comes back, and the table-driven case the moment a copy of the tables drifts.
Deno.test("t212TickerToYahoo — is the shared map's function, not a copy of it", () => {
  assertStrictEquals(t212TickerToYahoo, sharedTickers.t212TickerToYahoo);
});

Deno.test("extractT212Prices — every code in the shared tables goes through the shared map, then the board's rule", () => {
  const codes = Object.keys({ ...sharedTickers.T212_DCA_ETFS, ...sharedTickers.T212_ALIASES });
  const positions = codes.map((ticker, i) => ({ instrument: { ticker }, currentPrice: 10 + i }));
  const want: Record<string, number> = {};
  codes.forEach((code, i) => {
    const yahoo = sharedTickers.t212TickerToYahoo(code);
    if (yahoo && recordsT212Price(yahoo)) want[yahoo] = 10 + i;
  });
  assertEquals(extractT212Prices(positions), want);
  assertEquals(Object.keys(want).sort(), ["COHR", "GOOG", "META", "NBIS", "NVTS", "RKLB", "SAEM.L", "VUAA.L"]);
});

Deno.test("recordsT212Price — a US listing, a share class and the two ETFs the board prices from the broker; nothing else", () => {
  for (const ticker of ["AAPL", "BRK-B", "VUAA.L", "SAEM.L"]) assertEquals(recordsT212Price(ticker), true, ticker);
  for (const ticker of ["2DG.SG", "QQQ3.L", "CSPX.L", "XFAB.PA", "ABC.L"]) assertEquals(recordsT212Price(ticker), false, ticker);
});

Deno.test("buildPriceRow — the broker's price only where the board shows it, Yahoo's elsewhere, nothing from Yahoo overnight", () => {
  // Every position at 10 from the broker and 20 from Yahoo, so each recorded number names its source.
  const t212 = extractT212Prices(
    ["2DGd_EQ", "VUAAl_EQ", "AAPL_US_EQ", "BRK_B_US_EQ", "QQQ3l_EQ", "CSPX_EQ", "XFABp_EQ"]
      .map((ticker) => ({ instrument: { ticker }, currentPrice: 10 })),
  );
  const tickers = ["2DG.SG", "AAPL", "BRK-B", "CSPX.L", "QQQ3.L", "VUAA.L", "XFAB.PA"];
  const yahoo = Object.fromEntries(tickers.map((ticker) => [ticker, { lastPrice: 20 }]));
  const byDay = { "2DG.SG": 20, "AAPL": 10, "BRK-B": 10, "CSPX.L": 20, "QQQ3.L": 20, "VUAA.L": 10, "XFAB.PA": 20 };
  assertEquals(buildPriceRow(tickers, yahoo, t212, new Date("2026-10-01T09:00:00Z")), byDay); // 05:00 EDT
  assertEquals(buildPriceRow(tickers, yahoo, t212, new Date("2026-10-01T14:00:00Z")), byDay); // 10:00 EDT, the US session
  // In the US overnight session only the broker's quote is recorded, so 2DG.SG and the other Yahoo-priced listings
  // are absent, and the chart keeps to Yahoo's own bars for them, as the board does.
  assertEquals(
    buildPriceRow(tickers, yahoo, t212, new Date("2026-10-02T02:00:00Z")), // Thursday 22:00 EDT
    { "AAPL": 10, "BRK-B": 10, "VUAA.L": 10 },
  );
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

// ---- the overnight stale-quote bug -------------------------------
//
// Overnight, Yahoo publishes no tape: `lastPrice` / `extPrice` are a
// frozen carry of the last regular print. T212 is the only live source,
// and it is ONE fetch for the whole book — so when it times out, every
// holding in that sample fell back to the same stale number at once and
// the next sample lifted them all back. Live, on 2026-08-25, MSTR was
// recorded at 122.60 (its overnight open) at 01:05, 01:15, 01:20, 01:40,
// 01:45 and 02:15 while the overnight tape had it at 124.8-126.0 — and
// NVDA showed 208.80 at exactly the same six ticks. The 24H chart with
// Extended Hours on drew that as the portfolio tearing up and down by
// more than a percent, all night.
const OVERNIGHT = new Date("2026-08-25T01:05:00Z"); // 21:05 ET, mid-overnight
const AFTER_HOURS = new Date("2026-08-25T22:30:00Z"); // 18:30 ET
const REGULAR = new Date("2026-08-25T18:00:00Z"); // 14:00 ET

Deno.test("isUsOvernightSession spans midnight", () => {
  assert(isUsOvernightSession(OVERNIGHT));
  assert(isUsOvernightSession(new Date("2026-08-25T05:30:00Z"))); // 01:30 ET
  assert(!isUsOvernightSession(AFTER_HOURS));
  assert(!isUsOvernightSession(REGULAR));
});

Deno.test("recordablePrice: T212 is the overnight tape and still wins", () => {
  assertEquals(recordablePrice({ lastPrice: 122.6 }, 125.95, OVERNIGHT), 125.95);
});

Deno.test("recordablePrice: overnight with no T212 records NOTHING, not Yahoo's frozen close", () => {
  // The exact shape of the live bug: T212 missing for this sample,
  // Yahoo still offering the previous close.
  assertEquals(recordablePrice({ lastPrice: 122.6, extPrice: 122.6 }, undefined, OVERNIGHT), null);
});

Deno.test("recordablePrice: after-hours still takes Yahoo's ext print", () => {
  // Only the OVERNIGHT is unquotable by Yahoo — after-hours is a real
  // tape and must keep working, or the fix would blank 16:00-20:00 ET.
  assertEquals(recordablePrice({ lastPrice: 120, extPrice: 121.5 }, undefined, AFTER_HOURS), 121.5);
});

Deno.test("recordablePrice: regular session takes lastPrice", () => {
  assertEquals(recordablePrice({ lastPrice: 124, extPrice: 999 }, undefined, REGULAR), 124);
});

// ---- early closes ------------------------------------------------
//
// 2026-11-27, the Friday after Thanksgiving: the regular session ends at
// 13:00 ET (18:00 UTC in EST) and the late session trades to 17:00. Until
// 2026-09-30 the recorder took 13:00-16:00 as regular, so it recorded the
// frozen 13:00 close for any holding Yahoo priced, and a tick whose T212
// fetch failed dropped every US holding to that close.
const EARLY_CLOSE_LATE = new Date("2026-11-27T19:00:00Z"); // 14:00 EST

Deno.test("isUsRegularSession: an early close ends the session at 13:00 ET", () => {
  assertEquals(isUsRegularSession(new Date("2026-11-27T17:59:00Z")), true);  // 12:59 EST
  assertEquals(isUsRegularSession(new Date("2026-11-27T18:00:00Z")), false); // 13:00 EST
  assertEquals(isUsRegularSession(EARLY_CLOSE_LATE), false);
  assertEquals(isUsRegularSession(new Date("2026-12-24T19:00:00Z")), false); // Christmas Eve, a Thursday
  // The full days either side keep 16:00.
  assertEquals(isUsRegularSession(new Date("2026-11-25T19:00:00Z")), true);  // 14:00 EST, Wednesday
  assertEquals(isUsRegularSession(new Date("2026-12-23T20:59:00Z")), true);  // 15:59 EST
});

Deno.test("recordablePrice: after an early close the late session's print, not the frozen 13:00 close", () => {
  assertEquals(recordablePrice({ lastPrice: 180, extPrice: 181.2 }, undefined, EARLY_CLOSE_LATE), 181.2);
  assertEquals(recordablePrice({ lastPrice: 180, extPrice: 181.2 }, 181.4, EARLY_CLOSE_LATE), 181.4); // T212 still wins
});

Deno.test("handle: the bearer, then the call's beat, then the recording; a wrong bearer writes no beat (0075)", async () => {
  const order: string[] = [];
  const deps = {
    cronSecret: "s3cret",
    beat: (key: string) => { order.push(`beat ${key}`); return Promise.resolve(true); },
    run: (_now: Date) => { order.push("run"); return Promise.resolve(new Response("{}", { status: 200 })); },
  };
  const url = "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/snapshot-record";
  assertEquals((await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), deps)).status, 200);
  assertEquals(order, ["beat snapshot-record", "run"]);
  order.length = 0;
  assertEquals((await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer nope" } }), deps)).status, 403);
  assertEquals((await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), { ...deps, cronSecret: "" })).status, 403);
  assertEquals(order, []);
  // A beat that cannot be written stops nothing.
  const r = await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), { ...deps, beat: () => Promise.reject(new Error("db down")) });
  assertEquals([r.status, order], [200, ["run"]]);
});

// ---- a price in other units than the board's is not recorded (improvement plan item 6) ----
//
// The prices function hands the board pounds for a London listing (Yahoo's pence divided by 100); the broker quotes a
// London stock in pence. The recorder prefers the broker, so a London stock held at Trading 212 would have gone into
// price_snapshots 100 times its board price, for good. None has yet: on 2026-10-02 the table's 44,911 consecutive pairs
// over 26 tickers moved at most +23.1 % / -18.5 %, and both London holdings are USD lines whose broker and Yahoo prices
// agree. Each case is worked by hand.

Deno.test("unitsDiffer: one price about 100 times the other, either way, and nothing else", () => {
  assert(unitsDiffer(250, 2.5));
  assert(unitsDiffer(2.5, 250));
  assert(unitsDiffer(175, 2.5));                     // 70 times
  assert(unitsDiffer(2.5, 350));                     // 1/140
  assert(!unitsDiffer(112.25, 112.1));               // a USD line, broker and Yahoo
  assert(!unitsDiffer(1.3, 1));                      // dollars against pounds is not a unit slip
  assert(!unitsDiffer(121, 1210));                   // a 10:1 split is 10 times, not 100
  assert(!unitsDiffer(0, 2.5));
  assert(!unitsDiffer(-250, 2.5));
});

Deno.test("recordablePrice: a broker quote in pence for a holding the board keeps in pounds is skipped for Yahoo's", () => {
  // In session: the broker's 252.4p, Yahoo's £2.52, the board's last saved £2.50.
  assertEquals(recordablePrice({ lastPrice: 2.52 }, 252.4, REGULAR, 2.5), 2.52);
  // After hours, Yahoo's own late print in pounds.
  assertEquals(recordablePrice({ lastPrice: 2.52, extPrice: 2.53 }, 252.4, AFTER_HOURS, 2.5), 2.53);
  // Overnight the broker is the only tape: in the wrong units, nothing is recorded.
  assertEquals(recordablePrice({ lastPrice: 2.52 }, 252.4, OVERNIGHT, 2.5), null);
  // With no board price the prices function's own price sets the units.
  assertEquals(recordablePrice({ lastPrice: 2.52 }, 252.4, REGULAR), 2.52);
});

Deno.test("recordablePrice: a Yahoo price 100 times the board's is not recorded; the broker's in the board's units is", () => {
  assertEquals(recordablePrice({ lastPrice: 252 }, undefined, REGULAR, 2.5), null);
  assertEquals(recordablePrice({ lastPrice: 252 }, 2.51, REGULAR, 2.5), 2.51);
  assertEquals(recordablePrice({ lastPrice: 2.52, extPrice: 253 }, undefined, AFTER_HOURS, 2.5), 2.52);
});

Deno.test("recordablePrice: every real price still goes in — a USD line, a big move, a split, a new holding", () => {
  // VUAA.L as the book holds it: the broker's dollars beside Yahoo's.
  assertEquals(recordablePrice({ lastPrice: 112.1 }, 112.25, REGULAR, 112), 112.25);
  // A 40 % day and a 10:1 split against a stale board price.
  assertEquals(recordablePrice({ lastPrice: 60 }, undefined, REGULAR, 100), 60);
  assertEquals(recordablePrice({ lastPrice: 121 }, undefined, REGULAR, 1200), 121);
  // A holding the board has no price for yet, and one Yahoo does not quote.
  assertEquals(recordablePrice({ lastPrice: 40 }, undefined, REGULAR), 40);
  assertEquals(recordablePrice(null, 7.5, OVERNIGHT), 7.5);
});

Deno.test("buildPriceRow and unitSkips: the row keeps the board's units, and the skip is named", () => {
  const quotes = { "BARC.L": { lastPrice: 2.52 }, "VUAA.L": { lastPrice: 112.1 }, AAPL: { lastPrice: 231.5 } };
  const t212 = { "BARC.L": 252.4, "VUAA.L": 112.25 };
  const board = boardPricesOf({ holdings: { "BARC.L": { lastPrice: 2.5 }, "VUAA.L": { lastPrice: 112 }, AAPL: { lastPrice: 0 } } }, ["BARC.L", "VUAA.L", "AAPL"]);
  assertEquals(board, { "BARC.L": 2.5, "VUAA.L": 112 });
  assertEquals(buildPriceRow(["BARC.L", "VUAA.L", "AAPL"], quotes, t212, REGULAR, board), { "BARC.L": 2.52, "VUAA.L": 112.25, AAPL: 231.5 });
  assertEquals(unitSkips(["BARC.L", "VUAA.L", "AAPL"], quotes, t212, board), [{ ticker: "BARC.L", t212: 252.4, yahoo: 2.52, board: 2.5 }]);
  // Overnight the same book records nothing for BARC.L and the broker's dollars for VUAA.L.
  assertEquals(buildPriceRow(["BARC.L", "VUAA.L"], quotes, t212, OVERNIGHT, board), { "VUAA.L": 112.25 });
});
