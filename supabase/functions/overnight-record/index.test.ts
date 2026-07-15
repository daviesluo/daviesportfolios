// Pin the pure helpers of overnight-record. The Deno.serve handler is
// behind `if (import.meta.main)` so importing here binds no port.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bucketTimeIso,
  isOvernightWindow,
  isWeekendDeadZone,
  isHolidaySession,
  shouldRecord,
  ukParts,
  isDaySessionWindow,
  isDaySessionTicker,
  t212TickerToYahoo,
  hasOvernightSession,
  extractOvernightPrices,
  extractPricesFor,
  resolveRowYahoo,
  rawInstrumentCodes,
  mergePriceMaps,
} from "./index.ts";

Deno.test("bucketTimeIso: floors to the 5-min boundary", () => {
  assertEquals(bucketTimeIso(Date.UTC(2026, 4, 28, 1, 3, 27)), "2026-05-28T01:00:00.000Z");
  assertEquals(bucketTimeIso(Date.UTC(2026, 4, 28, 1, 5, 0)), "2026-05-28T01:05:00.000Z");
});

Deno.test("isOvernightWindow: true 20:00-04:00 ET, false midday", () => {
  // 2026-05-28 is a Thursday. EDT = UTC-4.
  // 21:00 ET = 01:00 UTC → overnight
  assertEquals(isOvernightWindow(new Date(Date.UTC(2026, 4, 29, 1, 0))), true);
  // 02:00 ET = 06:00 UTC → overnight
  assertEquals(isOvernightWindow(new Date(Date.UTC(2026, 4, 29, 6, 0))), true);
  // 10:00 ET = 14:00 UTC → NOT overnight (RTH)
  assertEquals(isOvernightWindow(new Date(Date.UTC(2026, 4, 28, 14, 0))), false);
  // 19:00 ET = 23:00 UTC → after-hours, NOT overnight
  assertEquals(isOvernightWindow(new Date(Date.UTC(2026, 4, 28, 23, 0))), false);
});

Deno.test("isWeekendDeadZone: Fri 20:00 ET → Sun 20:00 ET", () => {
  // Fri 2026-05-29 21:00 ET = Sat 01:00 UTC → dead zone
  assertEquals(isWeekendDeadZone(new Date(Date.UTC(2026, 4, 30, 1, 0))), true);
  // Sat midday ET → dead zone
  assertEquals(isWeekendDeadZone(new Date(Date.UTC(2026, 4, 30, 18, 0))), true);
  // Sun 2026-05-31 21:00 ET = Mon 01:00 UTC → reopened, NOT dead
  assertEquals(isWeekendDeadZone(new Date(Date.UTC(2026, 5, 1, 1, 0))), false);
  // Sun 2026-05-31 18:00 ET = 22:00 UTC → still dead (before 20:00 ET)
  assertEquals(isWeekendDeadZone(new Date(Date.UTC(2026, 4, 31, 22, 0))), true);
  // Thursday overnight → NOT dead
  assertEquals(isWeekendDeadZone(new Date(Date.UTC(2026, 4, 29, 1, 0))), false);
});

Deno.test("shouldRecord: overnight AND not weekend-dead-zone", () => {
  // Thu 21:00 ET → record
  assertEquals(shouldRecord(new Date(Date.UTC(2026, 4, 29, 1, 0))), true);
  // Thu 10:00 ET → no (RTH)
  assertEquals(shouldRecord(new Date(Date.UTC(2026, 4, 28, 14, 0))), false);
  // Sat overnight → no (dead zone)
  assertEquals(shouldRecord(new Date(Date.UTC(2026, 4, 30, 6, 0))), false);
});

Deno.test("isHolidaySession / shouldRecord: US HOLIDAY overnight is not recorded (the July-3 flat-line bug)", () => {
  // Fri 2026-07-03 is the observed Independence Day full closure.
  // Evening of the holiday EVE (Thu Jul 2, 21:00 ET = Jul 3 01:00 UTC) —
  // that overnight session runs INTO Jul 3, so it belongs to the holiday.
  const eve = new Date(Date.UTC(2026, 6, 3, 1, 0));
  assertEquals(isHolidaySession(eve), true);
  assertEquals(shouldRecord(eve), false);
  // Early morning DURING the holiday (Fri Jul 3, 02:00 ET = Jul 3 06:00 UTC).
  const morn = new Date(Date.UTC(2026, 6, 3, 6, 0));
  assertEquals(isHolidaySession(morn), true);
  assertEquals(shouldRecord(morn), false);
  // Control: a normal weekday overnight (Tue Jul 7, 02:00 ET) still records.
  const normal = new Date(Date.UTC(2026, 6, 7, 6, 0));
  assertEquals(isHolidaySession(normal), false);
  assertEquals(shouldRecord(normal), true);
});

Deno.test("t212TickerToYahoo: US suffix, LSE suffix, aliases", () => {
  assertEquals(t212TickerToYahoo("AAPL_US_EQ"), "AAPL");
  assertEquals(t212TickerToYahoo("VUAAl_EQ"), "VUAA.L");
  assertEquals(t212TickerToYahoo("FB_US_EQ"), "META");
  assertEquals(t212TickerToYahoo("GOOGL_US_EQ"), "GOOG");
  assertEquals(t212TickerToYahoo("WEIRD_SHAPE"), null);
  // Deutsche Börse `d` venue suffix → Yahoo Frankfurt `.F` (digits-leading
  // codes like 2DG must map — the day-session recording depends on it).
  assertEquals(t212TickerToYahoo("2DGd_EQ"), "2DG.F");
  assertEquals(t212TickerToYahoo("SAPd_EQ"), "SAP.F");
});

Deno.test("isDaySessionWindow: 07:00-21:00 Europe/London, weekdays only (DST-safe)", () => {
  // BST (summer, UK = UTC+1): Wed 2026-07-15.
  assertEquals(isDaySessionWindow(new Date(Date.UTC(2026, 6, 15, 6, 0))), true);   // 07:00 UK — opens
  assertEquals(isDaySessionWindow(new Date(Date.UTC(2026, 6, 15, 5, 55))), false); // 06:55 UK — before
  assertEquals(isDaySessionWindow(new Date(Date.UTC(2026, 6, 15, 19, 55))), true); // 20:55 UK — still in
  assertEquals(isDaySessionWindow(new Date(Date.UTC(2026, 6, 15, 20, 0))), false); // 21:00 UK — closed
  // GMT (winter, UK = UTC): Wed 2026-01-14.
  assertEquals(isDaySessionWindow(new Date(Date.UTC(2026, 0, 14, 7, 0))), true);   // 07:00 UK
  assertEquals(isDaySessionWindow(new Date(Date.UTC(2026, 0, 14, 21, 0))), false); // 21:00 UK
  // Weekend: Sat 2026-07-18 midday.
  assertEquals(isDaySessionWindow(new Date(Date.UTC(2026, 6, 18, 12, 0))), false);
});

Deno.test("resolveRowYahoo: ISIN+currency resolves the day-session instrument regardless of the T212 code", () => {
  // Nested shape with an UNKNOWN internal code — ISIN (Sivers) + EUR wins.
  assertEquals(resolveRowYahoo({ instrument: { ticker: "WHATEVER_XX", isin: "SE0003917798", currencyCode: "EUR" } }), "2DG.F");
  // Same ISIN but the SEK Stockholm line must NOT map (11x currency gap).
  assertEquals(resolveRowYahoo({ instrument: { ticker: "SIVEs_EQ", isin: "SE0003917798", currencyCode: "SEK" } }), null);
  // ISIN with no currency on the row → trust the ISIN (single-listing rows).
  assertEquals(resolveRowYahoo({ instrument: { ticker: "X", isin: "se0003917798" } }), "2DG.F");
  // No ISIN → falls through to the code-suffix rules.
  assertEquals(resolveRowYahoo({ ticker: "AAPL_US_EQ" }), "AAPL");
  assertEquals(resolveRowYahoo({ instrument: { ticker: "2DGd_EQ" } }), "2DG.F");
  assertEquals(resolveRowYahoo({}), null);
});

Deno.test("rawInstrumentCodes: surfaces code/isin/currency for the unmapped diagnostic", () => {
  const positions = [
    { ticker: "AAPL_US_EQ", currentPrice: 200 },
    { instrument: { ticker: "2DGx_EQ", isin: "SE0003917798", currencyCode: "EUR" }, currentPrice: 3.8 },
    null, 42,
  ];
  assertEquals(rawInstrumentCodes(positions), ["AAPL_US_EQ", "2DGx_EQ/SE0003917798/EUR"]);
  assertEquals(rawInstrumentCodes(null), []);
});

Deno.test("isDaySessionTicker + extractPricesFor: 2DG.F recorded via the day predicate, not the overnight one", () => {
  assertEquals(isDaySessionTicker("2DG.F"), true);
  assertEquals(isDaySessionTicker("AAPL"), false);
  const positions = [
    { ticker: "2DGd_EQ", currentPrice: 3.8 },
    { ticker: "AAPL_US_EQ", currentPrice: 200 },
  ];
  // Day predicate alone → only 2DG.F.
  assertEquals(extractPricesFor(positions, isDaySessionTicker), { "2DG.F": 3.8 });
  // Overnight predicate alone → only AAPL (unchanged behaviour).
  assertEquals(extractOvernightPrices(positions), { AAPL: 200 });
  // Union (what the handler builds when both windows are open).
  assertEquals(
    extractPricesFor(positions, (y) => hasOvernightSession(y) || isDaySessionTicker(y)),
    { "2DG.F": 3.8, AAPL: 200 },
  );
});

Deno.test("hasOvernightSession: US equities only, SFTBY excluded", () => {
  assertEquals(hasOvernightSession("AAPL"), true);
  assertEquals(hasOvernightSession("NVDA"), true);
  assertEquals(hasOvernightSession("SFTBY"), false); // OTC ADR, NO_OVERNIGHT
  assertEquals(hasOvernightSession("VUAA.L"), false); // LSE
  assertEquals(hasOvernightSession("^GSPC"), false);  // index
  assertEquals(hasOvernightSession("ES=F"), false);   // futures
  assertEquals(hasOvernightSession("BTC-USD"), false); // crypto
});

Deno.test("extractOvernightPrices: maps eligible US equities, drops the rest", () => {
  const positions = [
    { ticker: "AAPL_US_EQ", currentPrice: 200 },
    { instrument: { ticker: "NVDA_US_EQ" }, currentPrice: 175.5 },
    { ticker: "SFTBY_US_EQ", currentPrice: 22.8 },     // excluded (NO_OVERNIGHT)
    { ticker: "VUAAl_EQ", currentPrice: 98 },           // excluded (.L)
    { ticker: "AAPL_US_EQ", currentPrice: 0 },          // dropped (non-positive) — but first AAPL already set
    { ticker: "GOOGL_US_EQ", currentPrice: 250 },       // alias → GOOG
  ];
  const out = extractOvernightPrices(positions);
  assertEquals(out.AAPL, 200);
  assertEquals(out.NVDA, 175.5);
  assertEquals(out.GOOG, 250);
  assertEquals("SFTBY" in out, false);
  assertEquals("VUAA.L" in out, false);
});

Deno.test("extractOvernightPrices: non-array / empty → {}", () => {
  assertEquals(extractOvernightPrices(null), {});
  assertEquals(extractOvernightPrices([]), {});
  assertEquals(extractOvernightPrices([null, 42, "x"]), {});
});

Deno.test("mergePriceMaps: invest (a) wins ties over isa (b)", () => {
  assertEquals(mergePriceMaps({ AAPL: 200 }, { AAPL: 201, NVDA: 175 }), { AAPL: 200, NVDA: 175 });
});
