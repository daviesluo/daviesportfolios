// Pin isWeekendDeadZone's ET boundaries — the auto-refresh cadence
// flips on these, so a regression would either spam Yahoo through the
// weekend (boundary too late) or stop refreshing live overnight prices
// on a weekday night (boundary too early). Times are constructed in
// UTC and asserted against the America/New_York interpretation; we use
// a fixed winter date (EST = UTC-5) so the offset is deterministic.

import { describe, it, expect } from 'vitest';
import { isWeekendDeadZone, usMarketPhase, isUsMarketHoliday } from './market_hours.js';

// Helper: a Date at the given UTC wall-clock. In January (EST, UTC-5)
// ET = UTC - 5h.
const utc = (iso) => new Date(iso);

describe('isWeekendDeadZone (EST / January)', () => {
  it('Friday before 20:00 ET → NOT dead zone (after-hours still trading)', () => {
    // Fri 2026-01-09 19:59 ET = 00:59 UTC Sat. Use 19:00 ET = 00:00 UTC Sat.
    // 2026-01-10T00:00Z is Fri 19:00 ET.
    expect(isWeekendDeadZone(utc('2026-01-10T00:00:00Z'))).toBe(false);
  });

  it('Friday at/after 20:00 ET → dead zone', () => {
    // Fri 20:00 ET = 2026-01-10T01:00Z.
    expect(isWeekendDeadZone(utc('2026-01-10T01:00:00Z'))).toBe(true);
    // Fri 23:00 ET = 2026-01-10T04:00Z.
    expect(isWeekendDeadZone(utc('2026-01-10T04:00:00Z'))).toBe(true);
  });

  it('Saturday (any time) → dead zone', () => {
    // Sat 2026-01-10 12:00 ET = 17:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-10T17:00:00Z'))).toBe(true);
    // Sat 02:00 ET = 07:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-10T07:00:00Z'))).toBe(true);
  });

  it('Sunday before 20:00 ET → dead zone', () => {
    // Sun 2026-01-11 19:00 ET = 2026-01-12T00:00Z.
    expect(isWeekendDeadZone(utc('2026-01-12T00:00:00Z'))).toBe(true);
    // Sun 10:00 ET = 15:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-11T15:00:00Z'))).toBe(true);
  });

  it('Sunday at/after 20:00 ET → NOT dead zone (overnight session reopens → fast cadence)', () => {
    // Sun 20:00 ET = 2026-01-12T01:00Z.
    expect(isWeekendDeadZone(utc('2026-01-12T01:00:00Z'))).toBe(false);
    // Sun 22:00 ET = 2026-01-12T03:00Z.
    expect(isWeekendDeadZone(utc('2026-01-12T03:00:00Z'))).toBe(false);
  });

  it('weekday overnight (Tue 02:00 ET) → NOT dead zone (fast cadence for live overnight prices)', () => {
    // Tue 2026-01-13 02:00 ET = 07:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-13T07:00:00Z'))).toBe(false);
    // sanity: usMarketPhase agrees it's overnight
    expect(usMarketPhase(utc('2026-01-13T07:00:00Z'))).toBe('overnight');
  });

  it('weekday regular session (Wed 10:00 ET) → NOT dead zone', () => {
    // Wed 2026-01-14 10:00 ET = 15:00 UTC.
    expect(isWeekendDeadZone(utc('2026-01-14T15:00:00Z'))).toBe(false);
  });
});

describe('isUsMarketHoliday — NYSE full-day closures', () => {
  // Asserted at a mid-session ET moment (15:00 UTC ≈ 10:00 ET) so a tz
  // slip would surface. Cross-checked against the published NYSE
  // holiday calendars for 2026 / 2027 / 2028.
  const atNoonET = (ymd) => new Date(`${ymd}T16:00:00Z`); // ~11-12 ET year-round

  it('flags the fixed-date + nth-weekday holidays (2026)', () => {
    const days = [
      '2026-01-01', // New Year's (Thu)
      '2026-01-19', // MLK — 3rd Mon Jan
      '2026-02-16', // Presidents — 3rd Mon Feb
      '2026-04-03', // Good Friday
      '2026-05-25', // Memorial — last Mon May
      '2026-06-19', // Juneteenth (Fri)
      '2026-07-03', // Independence observed (Jul 4 = Sat → Fri 3rd)
      '2026-09-07', // Labor — 1st Mon Sep
      '2026-11-26', // Thanksgiving — 4th Thu Nov
      '2026-12-25', // Christmas (Fri)
    ];
    for (const d of days) expect(isUsMarketHoliday(atNoonET(d)), d).toBe(true);
  });

  it('handles weekend-observance shifts (2027)', () => {
    expect(isUsMarketHoliday(atNoonET('2027-06-18'))).toBe(true); // Juneteenth Jun19=Sat → Fri 18
    expect(isUsMarketHoliday(atNoonET('2027-07-05'))).toBe(true); // July 4 = Sun → Mon 5
    expect(isUsMarketHoliday(atNoonET('2027-12-24'))).toBe(true); // Christmas Dec25=Sat → Fri 24
    expect(isUsMarketHoliday(atNoonET('2027-03-26'))).toBe(true); // Good Friday
  });

  it("does NOT pull New Year's back onto the prior Friday (Jan 1 2028 = Sat → market open Dec 31 2027)", () => {
    expect(isUsMarketHoliday(atNoonET('2027-12-31'))).toBe(false); // real trading day
    expect(isUsMarketHoliday(atNoonET('2028-01-17'))).toBe(true);  // MLK 2028 (3rd Mon)
  });

  it('does NOT flag ordinary trading days', () => {
    for (const d of ['2026-07-02', '2026-07-06', '2026-11-25', '2026-11-27', '2026-12-24', '2026-01-02']) {
      expect(isUsMarketHoliday(atNoonET(d)), d).toBe(false);
    }
  });

  it('usMarketPhase returns "overnight" (closed) during what would be RTH on a holiday', () => {
    // July 3 2026 (observed Independence Day), 14:00 UTC ≈ 10:00 ET.
    expect(usMarketPhase(new Date('2026-07-03T14:00:00Z'))).toBe('overnight');
    // Sanity: the SAME wall-clock on a normal weekday is 'regular'.
    expect(usMarketPhase(new Date('2026-07-06T14:00:00Z'))).toBe('regular'); // Mon
  });
});
