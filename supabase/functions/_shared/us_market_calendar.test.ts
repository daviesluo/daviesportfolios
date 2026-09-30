// Pins for the shared US market holiday calendar. The rules auto-compute
// ANY year, but these hardcoded expectations for the next several years
// are the "record" of upcoming NYSE full closures — so a regression in the
// rule-based computation (a broken Easter calc, a bad weekend-shift, etc.)
// is caught before it ships and quietly marks a trading day open (or a real
// holiday closed). Verified against the published NYSE holiday calendar.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isUsEarlyCloseYmd, isUsMarketHolidayAt, isUsMarketHolidayYmd, isUsTradingDay, usRegularCloseMin, usRegularCloseMinAt,
} from "./us_market_calendar.ts";

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

// Early closes: the regular session ends at 13:00 ET. 2025-2028 are the days NYSE Group's
// published calendars name (its 2024 and 2025 announcements); 2029 and 2030 are the rule
// carried forward, and move to the published list when NYSE announces them.
const EARLY_CLOSES: Record<number, string[]> = {
  2025: ["7-3", "11-28", "12-24"],
  2026: ["11-27", "12-24"],          // July 3 is Independence Day observed
  2027: ["11-26"],                   // July 3 is a Saturday; December 24 is Christmas observed
  2028: ["7-3", "11-24"],            // December 24 is a Sunday
  2029: ["7-3", "11-23", "12-24"],
  2030: ["7-3", "11-29", "12-24"],
};

Deno.test("us_market_calendar: exact early-close set for 2025-2030 (whole-year sweep)", () => {
  for (const [yStr, mds] of Object.entries(EARLY_CLOSES)) {
    const y = Number(yStr);
    const set = new Set(mds);
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= dim; d++) {
        assertEquals(isUsEarlyCloseYmd(y, m, d), set.has(`${m}-${d}`), `${y}-${m}-${d}`);
      }
    }
  }
});

Deno.test("an early close is always a trading day: a weekday and never a full holiday (2000-2100)", () => {
  for (let y = 2000; y <= 2100; y++) {
    for (const [m, d] of [[7, 3], [12, 24], [11, 22], [11, 23], [11, 24], [11, 25], [11, 26], [11, 27], [11, 28], [11, 29]]) {
      if (!isUsEarlyCloseYmd(y, m, d)) continue;
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      assertEquals(dow >= 1 && dow <= 5, true, `${y}-${m}-${d} weekday`);
      assertEquals(isUsMarketHolidayYmd(y, m, d), false, `${y}-${m}-${d} not a holiday`);
    }
  }
});

Deno.test("usRegularCloseMin: 13:00 ET on an early close, 16:00 otherwise, by the ET calendar day", () => {
  assertEquals(usRegularCloseMin(tsOf("2026-11-27T12:00:00-05:00"), EST), 13 * 60);
  assertEquals(usRegularCloseMin(tsOf("2026-12-24T12:00:00-05:00"), EST), 13 * 60);
  assertEquals(usRegularCloseMin(tsOf("2026-11-25T12:00:00-05:00"), EST), 16 * 60);
  assertEquals(usRegularCloseMin(tsOf("2025-07-03T12:00:00-04:00"), EDT), 13 * 60);
  assertEquals(usRegularCloseMin(tsOf("2025-07-02T12:00:00-04:00"), EDT), 16 * 60);
});

Deno.test("usRegularCloseMinAt: the Date form reads the America/New_York day", () => {
  assertEquals(usRegularCloseMinAt(new Date("2026-11-27T19:00:00Z")), 13 * 60);  // 14:00 EST, Nov 27
  // 03:00Z on Nov 28 is 22:00 EST on Nov 27: still the early-close day.
  assertEquals(usRegularCloseMinAt(new Date("2026-11-28T03:00:00Z")), 13 * 60);
  // 04:00Z on Nov 27 is 23:00 EST on Thanksgiving: not.
  assertEquals(usRegularCloseMinAt(new Date("2026-11-27T04:00:00Z")), 16 * 60);
});
