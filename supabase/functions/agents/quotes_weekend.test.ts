// PR5-W's weekend rule as the twins and an executor instance apply it (quotes_weekend.ts): the closures fixed in UTC, and the
// three cases of the X a minute is decided on, each against the pre-registration's own words.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inQuoteClosure, weekendInputs, weekendX } from "./quotes_weekend.ts";

const at = (s: string) => Date.parse(s);
const RULE = { from: at("2026-10-23T21:00:00Z") };

// 2025: 24 and 31 December are Wednesdays, so the holiday closures stand apart from the weekly one.
Deno.test("the closures: Friday 21:00 to Sunday 21:00 UTC, and 24-25 and 31 December - 1 January, 21:00 to 21:00", () => {
  const cases: Array<[string, boolean]> = [
    ["2026-10-23T20:59:00Z", false], ["2026-10-23T21:00:00Z", true], ["2026-10-24T12:00:00Z", true], ["2026-10-25T20:59:00Z", true],
    ["2026-10-25T21:00:00Z", false], ["2026-10-26T00:00:00Z", false], ["2026-10-22T23:00:00Z", false],
    ["2025-12-24T20:59:00Z", false], ["2025-12-24T21:00:00Z", true], ["2025-12-25T20:59:00Z", true], ["2025-12-25T21:00:00Z", false],
    ["2025-12-31T20:59:00Z", false], ["2025-12-31T21:00:00Z", true], ["2026-01-01T20:59:00Z", true], ["2026-01-01T21:00:00Z", false],
  ];
  for (const [t, want] of cases) assertEquals(inQuoteClosure(at(t)), want, t);
});

Deno.test("weekendX: live X stands (case 1); dark inside a closure from the rule's instant takes the last X (case 2); dark otherwise (case 3); no rule is PR5's", () => {
  const sat = at("2026-10-24T03:00:00Z");
  assertEquals(weekendX(sat, 1.33, 1.32, RULE), 1.33);                                   // case 1, a stray live bar
  assertEquals(weekendX(sat, null, 1.32, RULE), 1.32);                                   // case 2
  assertEquals(weekendX(at("2026-10-25T21:00:00Z"), null, 1.32, RULE), null);            // case 3: the closure ended at 21:00
  assertEquals(weekendX(at("2026-10-22T12:00:00Z"), null, 1.32, RULE), null);            // case 3: a weekday gap stays dark
  assertEquals(weekendX(at("2026-10-17T03:00:00Z"), null, 1.32, RULE), null);            // before the rule's instant
  assertEquals(weekendX(sat, null, null, RULE), null);                                   // nothing taken yet to hold
  assertEquals(weekendX(sat, null, 1.32, null), null);                                   // no rule: PR5's
});

Deno.test("weekendInputs: a dark closure minute's fair is the USD book's fair over the held X; anything else is left as it was", () => {
  const dark = { f: null, fairU: 1.0004, x: null, usdLast: 1.0001, usdHourEnd: at("2026-10-24T03:00:00Z") };
  const T = at("2026-10-24T03:05:00Z");
  assertEquals(weekendInputs(dark, T, 1.3238, RULE), { ...dark, x: 1.3238, f: 1.0004 / 1.3238 });
  assertEquals(weekendInputs(dark, T, 1.3238, null), dark);
  assertEquals(weekendInputs(dark, at("2026-10-26T03:05:00Z"), 1.3238, RULE), dark);
  const live = { ...dark, x: 1.33, f: 1.0004 / 1.33 };
  assertEquals(weekendInputs(live, T, 1.3238, RULE), live);
});
