// Pin the pure helpers of overnight-record. The Deno.serve handler is
// behind `if (import.meta.main)` so importing here binds no port.
import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as sharedTickers from "../_shared/t212_tickers.ts";
import {
  bucketTimeIso,
  isOvernightWindow,
  isWeekendDeadZone,
  isHolidaySession,
  shouldRecord,
  t212TickerToYahoo,
  hasOvernightSession,
  extractOvernightPrices,
  handle,
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

// The map's own pins are `_shared/t212_tickers.test.ts`. Pinned here: this recorder reads that one map. The identity
// fails if a copy of the function comes back, and the table-driven case the moment a copy of the tables drifts.
Deno.test("t212TickerToYahoo: is the shared map's function, not a copy of it", () => {
  assertStrictEquals(t212TickerToYahoo, sharedTickers.t212TickerToYahoo);
});

Deno.test("extractOvernightPrices: every code in the shared tables goes through the shared map, then the session filter", () => {
  const codes = Object.keys({ ...sharedTickers.T212_DCA_ETFS, ...sharedTickers.T212_ALIASES });
  const positions = codes.map((ticker, i) => ({ instrument: { ticker }, currentPrice: 10 + i }));
  const want: Record<string, number> = {};
  codes.forEach((code, i) => {
    const yahoo = sharedTickers.t212TickerToYahoo(code);
    if (yahoo && hasOvernightSession(yahoo)) want[yahoo] = 10 + i;
  });
  assertEquals(extractOvernightPrices(positions), want);
  assertEquals(Object.keys(want).sort(), ["COHR", "GOOG", "META", "NBIS", "NVTS", "RKLB"]);
});

Deno.test("extractOvernightPrices: a share class is a US equity with an overnight tape (this recorder's old copy dropped it)", () => {
  assertEquals(extractOvernightPrices([{ instrument: { ticker: "BRK_B_US_EQ" }, currentPrice: 10 }]), { "BRK-B": 10 });
  // 2DG.SG maps now as well, and stays out: a German listing has no US overnight session.
  assertEquals(extractOvernightPrices([{ instrument: { ticker: "2DGd_EQ" }, currentPrice: 10 }]), {});
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

Deno.test("handle: the bearer, then the call's beat, then the recording; a wrong bearer writes no beat (0075)", async () => {
  const order: string[] = [];
  const deps = {
    cronSecret: "s3cret",
    beat: (key: string) => { order.push(`beat ${key}`); return Promise.resolve(true); },
    run: (_now: Date) => { order.push("run"); return Promise.resolve(new Response("{}", { status: 200 })); },
  };
  const url = "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/overnight-record";
  assertEquals((await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), deps)).status, 200);
  assertEquals(order, ["beat overnight-record", "run"]);
  order.length = 0;
  assertEquals((await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer nope" } }), deps)).status, 403);
  assertEquals(order, []);
  const r = await handle(new Request(url, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), { ...deps, beat: () => Promise.reject(new Error("db down")) });
  assertEquals([r.status, order], [200, ["run"]]);
});
