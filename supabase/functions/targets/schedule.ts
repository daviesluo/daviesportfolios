// When the analyst-target job runs (Davies, 2026-10-21): on a US trading day three times, when pre-market starts
// (04:00 ET), at the open (09:30 ET) and at the regular close (16:00 ET, 13:00 ET on an early close); on a weekend or a
// full-day US market holiday once, at 09:30 ET. Every time is America/New_York wall clock, so DST is the runtime's (Intl),
// never a hand-kept offset; trading days, holidays and early closes are `_shared/us_market_calendar.ts`'s, the one
// calendar every function shares.
//
// The job is called every minute (`edge_calls`); a call runs only when a slot has come and its run has not been done
// (`dueSlot`), so a late or missed minute still runs the slot once, at the next call.

import { isUsEarlyCloseYmd, isUsMarketHolidayYmd, US_EARLY_CLOSE_MIN, US_REGULAR_CLOSE_MIN } from "../_shared/us_market_calendar.ts";

export const PREMARKET_MIN = 4 * 60;
export const OPEN_MIN = 9 * 60 + 30;

/** The America/New_York calendar day and wall-clock minutes of an instant. */
export function etClock(ms: number): { y: number; m: number; d: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ms));
  const n = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const hour = n("hour") === 24 ? 0 : n("hour");
  return { y: n("year"), m: n("month"), d: n("day"), minutes: hour * 60 + n("minute") };
}

/** The instant of an America/New_York wall-clock time on a calendar day (DST resolved by the runtime). */
export function etWallToUtc(y: number, m: number, d: number, minutes: number): number {
  // Start from the UTC reading of the wall time, then correct by the ET offset found at that guess; a second pass settles
  // a guess that fell on the other side of a DST switch. None of the slots falls in a switch's missing or repeated hour.
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const c = etClock(t);
    const seen = Date.UTC(c.y, c.m - 1, c.d, Math.floor(c.minutes / 60), c.minutes % 60);
    t += wall - seen;
  }
  return t;
}

/** Whether an ET calendar day is a US trading day: a weekday and no full-day holiday. */
export function isTradingDayYmd(y: number, m: number, d: number): boolean {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow !== 0 && dow !== 6 && !isUsMarketHolidayYmd(y, m, d);
}

/** The day's run times as instants, in order: [04:00, 09:30, close] on a trading day, [09:30] otherwise. */
export function slotsOf(y: number, m: number, d: number): number[] {
  if (!isTradingDayYmd(y, m, d)) return [etWallToUtc(y, m, d, OPEN_MIN)];
  const close = isUsEarlyCloseYmd(y, m, d) ? US_EARLY_CLOSE_MIN : US_REGULAR_CLOSE_MIN;
  return [PREMARKET_MIN, OPEN_MIN, close].map((min) => etWallToUtc(y, m, d, min));
}

/**
 * The slot a call at `nowMs` owes, or null: the newest of today's (ET) slots at or before now, when the last slot done is
 * older than it. Before today's first slot, yesterday's last one is the newest, and it was done yesterday or is done now.
 */
export function dueSlot(nowMs: number, lastDoneMs: number | null): number | null {
  const c = etClock(nowMs);
  let latest = slotsOf(c.y, c.m, c.d).filter((t) => t <= nowMs).at(-1) ?? null;
  if (latest === null) {
    const prev = etClock(etWallToUtc(c.y, c.m, c.d, 12 * 60) - 24 * 3600e3);
    latest = slotsOf(prev.y, prev.m, prev.d).at(-1) ?? null;
  }
  if (latest === null) return null;
  return lastDoneMs !== null && lastDoneMs >= latest ? null : latest;
}

/** "09:30 ET": a slot as the page names it. */
export function slotLabel(ms: number): string {
  const c = etClock(ms);
  return `${String(Math.floor(c.minutes / 60)).padStart(2, "0")}:${String(c.minutes % 60).padStart(2, "0")} ET`;
}
