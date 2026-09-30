// The US overnight session as the overnight recorder records it: 20:00-04:00 ET, outside the weekend dead zone and
// any session that belongs to a US market holiday. Moved here from `overnight-record/index.ts` on 2026-09-30 so the
// snapshot recorder can work out which five-minute buckets the overnight recorder owes (`recorder_watch.ts`); the
// overnight recorder imports it and re-exports it for its pins.

import { isUsMarketHolidayAt } from "./us_market_calendar.ts";

/**
 * ET hour-of-week helpers via Intl so DST is resolved by the runtime
 * (no hand-coded offset table). Returns { weekday: 0-6 (Sun=0),
 * minutes: 0-1439 } in America/New_York local time.
 */
function etParts(at: Date): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const wdStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "", 10);
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = WD[wdStr] ?? 0;
  // Intl can emit "24" for midnight in some runtimes; normalise.
  const hour = hh === 24 ? 0 : hh;
  return { weekday, minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(mm) ? mm : 0) };
}

/**
 * Is `at` inside the US overnight session window (20:00-04:00 ET)?
 * 20:00→23:59 OR 00:00→03:59 ET. Day-of-week agnostic here — the
 * weekend dead zone is a separate gate (a Friday-night 20:00 is in
 * the overnight window by clock but excluded by isWeekendDeadZone).
 */
export function isOvernightWindow(at: Date): boolean {
  const { minutes } = etParts(at);
  return minutes >= 20 * 60 || minutes < 4 * 60;
}

/**
 * Weekend dead zone: Fri 20:00 ET → Sun 20:00 ET. US equities incl.
 * the 24/5 overnight session don't trade then, so T212's quote can't
 * move and there's nothing to record. Mirrors src/prices/market_hours.js
 * `isWeekendDeadZone`.
 */
export function isWeekendDeadZone(at: Date): boolean {
  const { weekday, minutes } = etParts(at);
  if (weekday === 6) return true;                 // all Saturday ET
  if (weekday === 5) return minutes >= 20 * 60;   // Fri from 20:00 ET
  if (weekday === 0) return minutes < 20 * 60;    // Sun until 20:00 ET
  return false;
}

/**
 * Is this overnight timestamp part of a session that belongs to a US market
 * HOLIDAY? The overnight session 20:00 ET (D-1) → 04:00 ET (D) belongs to
 * trading day D, so an evening bar (≥20:00 ET) keys off TOMORROW and the
 * 00:00-04:00 tail keys off today. The overnight ATS is shut on full
 * holidays (like the weekend), so T212 returns a frozen close — recording
 * it would draw a flat carry-forward line (the "MSTR flat on July 3" bug).
 * Weekends are the separate isWeekendDeadZone gate. Uses the shared
 * rule-based calendar (`isUsMarketHolidayAt`).
 */
export function isHolidaySession(at: Date): boolean {
  const { minutes } = etParts(at);
  const sessionAt = minutes >= 20 * 60 ? new Date(at.getTime() + 24 * 3_600_000) : at;
  return isUsMarketHolidayAt(sessionAt);
}

/** True when we should be recording right now. */
export function shouldRecord(at: Date): boolean {
  return isOvernightWindow(at) && !isWeekendDeadZone(at) && !isHolidaySession(at);
}
