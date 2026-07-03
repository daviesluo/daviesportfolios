// Pins for the shared US market holiday calendar. The rules auto-compute
// ANY year, but these hardcoded expectations for the next several years
// are the "record" of upcoming NYSE full closures — so a regression in the
// rule-based computation (a broken Easter calc, a bad weekend-shift, etc.)
// is caught before it ships and quietly marks a trading day open (or a real
// holiday closed). Verified against the published NYSE holiday calendar.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isUsMarketHolidayYmd, isUsTradingDay, isUsMarketHolidayAt } from "./us_market_calendar.ts";

const EDT = -14400, EST = -18000;
const tsOf = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

// Each list is the EXACT set the rules produce for that year (observed
// `M-D` keys). A fixed holiday that lands on a Saturday stays on the
// Saturday (e.g. 2028 New Year) — the market's shut that weekend day
// anyway; the observed Friday/Monday is what the market actually keys off.
const HOLIDAYS: Record<number, string[]> = {
  2026: ["1-1", "1-19", "2-16", "4-3", "5-25", "6-19", "7-3", "9-7", "11-26", "12-25"],
  2027: ["1-1", "1-18", "2-15", "3-26", "5-31", "6-18", "7-5", "9-6", "11-25", "12-24"],
  2028: ["1-1", "1-17", "2-21", "4-14", "5-29", "6-19", "7-4", "9-4", "11-23", "12-25"],
  2029: ["1-1", "1-15", "2-19", "3-30", "5-28", "6-19", "7-4", "9-3", "11-22", "12-25"],
  2030: ["1-1", "1-21", "2-18", "4-19", "5-27", "6-19", "7-4", "9-2", "11-28", "12-25"],
};

Deno.test("us_market_calendar: exact NYSE full-closure set for 2026-2030 (whole-year sweep)", () => {
  for (const [yStr, mds] of Object.entries(HOLIDAYS)) {
    const y = Number(yStr);
    const set = new Set(mds);
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= dim; d++) {
        assertEquals(isUsMarketHolidayYmd(y, m, d), set.has(`${m}-${d}`), `${y}-${m}-${d}`);
      }
    }
  }
});

Deno.test("isUsTradingDay: weekday true, weekend false, full-day holiday false", () => {
  assertEquals(isUsTradingDay(tsOf("2026-07-02T12:00:00-04:00"), EDT), true);   // Thu — trading
  assertEquals(isUsTradingDay(tsOf("2026-07-03T12:00:00-04:00"), EDT), false);  // Fri — Independence Day observed (Jul 4 = Sat)
  assertEquals(isUsTradingDay(tsOf("2026-07-04T12:00:00-04:00"), EDT), false);  // Sat — weekend
  assertEquals(isUsTradingDay(tsOf("2026-07-05T12:00:00-04:00"), EDT), false);  // Sun — weekend
  assertEquals(isUsTradingDay(tsOf("2026-06-19T12:00:00-04:00"), EDT), false);  // Fri — Juneteenth
  assertEquals(isUsTradingDay(tsOf("2026-11-26T12:00:00-05:00"), EST), false);  // Thanksgiving (EST)
});

Deno.test("isUsMarketHolidayAt: Date form reads the America/New_York calendar day", () => {
  assertEquals(isUsMarketHolidayAt(new Date("2026-07-03T17:00:00Z")), true);   // Jul 3 ET — holiday
  assertEquals(isUsMarketHolidayAt(new Date("2026-07-02T17:00:00Z")), false);  // Jul 2 ET — trading
  // 02:00Z on Jul 3 = 22:00 ET on Jul 2 → still Jul 2 (the UTC→ET date rollback).
  assertEquals(isUsMarketHolidayAt(new Date("2026-07-03T02:00:00Z")), false);
});
