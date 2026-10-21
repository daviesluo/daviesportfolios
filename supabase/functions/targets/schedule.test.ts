// Pins when the analyst-target job runs (schedule.ts; Davies, 2026-10-21): 04:00, 09:30 and the close ET on a US trading
// day (13:00 on an early close), 09:30 ET on a weekend or a holiday, across both 2026 DST switches (Sunday 8 March and
// Sunday 1 November), and which slot a call owes.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dueSlot, etClock, etWallToUtc, isTradingDayYmd, slotLabel, slotsOf } from "./schedule.ts";

const iso = (ms: number[]) => ms.map((t) => new Date(t).toISOString().slice(0, 16));

Deno.test("a normal trading day: 04:00, 09:30 and 16:00 ET (EDT: UTC−4)", () => {
  assertEquals(iso(slotsOf(2026, 10, 21)), ["2026-10-21T08:00", "2026-10-21T13:30", "2026-10-21T20:00"]);
});

Deno.test("a weekend: one run, at 09:30 ET", () => {
  assertEquals(iso(slotsOf(2026, 10, 24)), ["2026-10-24T13:30"]);
  assertEquals(iso(slotsOf(2026, 10, 25)), ["2026-10-25T13:30"]);
});

Deno.test("a holiday: one run at 09:30 ET (Thanksgiving; Independence Day observed on Friday 3 July; Christmas)", () => {
  assertEquals(iso(slotsOf(2026, 11, 26)), ["2026-11-26T14:30"]);
  assertEquals(isTradingDayYmd(2026, 7, 3), false);
  assertEquals(iso(slotsOf(2026, 7, 3)), ["2026-07-03T13:30"]);
  assertEquals(iso(slotsOf(2026, 12, 25)), ["2026-12-25T14:30"]);
});

Deno.test("an early close: the third run at the real close, 13:00 ET (the day after Thanksgiving, Christmas Eve)", () => {
  assertEquals(iso(slotsOf(2026, 11, 27)), ["2026-11-27T09:00", "2026-11-27T14:30", "2026-11-27T18:00"]);
  assertEquals(iso(slotsOf(2026, 12, 24)), ["2026-12-24T09:00", "2026-12-24T14:30", "2026-12-24T18:00"]);
});

Deno.test("both DST switches: the wall-clock times hold, the UTC instants move by an hour", () => {
  // Spring forward on Sunday 8 March 2026: the weekend run at 09:30 EDT; Friday before and Monday after.
  assertEquals(iso(slotsOf(2026, 3, 6)), ["2026-03-06T09:00", "2026-03-06T14:30", "2026-03-06T21:00"]);
  assertEquals(iso(slotsOf(2026, 3, 8)), ["2026-03-08T13:30"]);
  assertEquals(iso(slotsOf(2026, 3, 9)), ["2026-03-09T08:00", "2026-03-09T13:30", "2026-03-09T20:00"]);
  // Fall back on Sunday 1 November 2026.
  assertEquals(iso(slotsOf(2026, 10, 30)), ["2026-10-30T08:00", "2026-10-30T13:30", "2026-10-30T20:00"]);
  assertEquals(iso(slotsOf(2026, 11, 1)), ["2026-11-01T14:30"]);
  assertEquals(iso(slotsOf(2026, 11, 2)), ["2026-11-02T09:00", "2026-11-02T14:30", "2026-11-02T21:00"]);
  assertEquals(etWallToUtc(2026, 11, 1, 9 * 60 + 30), Date.parse("2026-11-01T14:30:00Z"));
  assertEquals(etClock(Date.parse("2026-11-01T14:30:00Z")).minutes, 9 * 60 + 30);
});

Deno.test("dueSlot: the newest slot come and not done, once; before the day's first, yesterday's last", () => {
  const at = (s: string) => Date.parse(s);
  // 09:31 ET on a trading day, the 04:00 run done: 09:30 is due; once done, nothing until the close.
  assertEquals(dueSlot(at("2026-10-21T13:31:00Z"), at("2026-10-21T08:00:00Z")), at("2026-10-21T13:30:00Z"));
  assertEquals(dueSlot(at("2026-10-21T13:31:00Z"), at("2026-10-21T13:30:00Z")), null);
  assertEquals(dueSlot(at("2026-10-21T19:59:00Z"), at("2026-10-21T13:30:00Z")), null);
  assertEquals(dueSlot(at("2026-10-21T20:00:00Z"), at("2026-10-21T13:30:00Z")), at("2026-10-21T20:00:00Z"));
  // Missed slots run once, as the newest: a call at 17:00 ET with nothing done since yesterday runs the close.
  assertEquals(dueSlot(at("2026-10-21T21:00:00Z"), at("2026-10-20T20:00:00Z")), at("2026-10-21T20:00:00Z"));
  // 03:00 ET: today has no slot yet; yesterday's close is the newest, and it was done.
  assertEquals(dueSlot(at("2026-10-21T07:00:00Z"), at("2026-10-20T20:00:00Z")), null);
  assertEquals(dueSlot(at("2026-10-21T07:00:00Z"), null), at("2026-10-20T20:00:00Z"));
  // A Saturday before 09:30: Friday's close; after it, Saturday's one run.
  assertEquals(dueSlot(at("2026-10-24T12:00:00Z"), at("2026-10-23T20:00:00Z")), null);
  assertEquals(dueSlot(at("2026-10-24T13:30:00Z"), at("2026-10-23T20:00:00Z")), at("2026-10-24T13:30:00Z"));
  assertEquals([slotLabel(at("2026-10-24T13:30:00Z")), slotLabel(at("2026-11-27T18:00:00Z"))], ["09:30 ET", "13:00 ET"]);
});
