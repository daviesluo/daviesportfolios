// Pin isWeekendDeadZone's ET boundaries — the auto-refresh cadence
// flips on these, so a regression would either spam Yahoo through the
// weekend (boundary too late) or stop refreshing live overnight prices
// on a weekday night (boundary too early). Times are constructed in
// UTC and asserted against the America/New_York interpretation; we use
// a fixed winter date (EST = UTC-5) so the offset is deterministic.

import { describe, it, expect } from 'vitest';
import {
  isWeekendDeadZone, usMarketPhase, isUsMarketHoliday, isUsTradingDateStr,
  LONDON_SLOT_HOURS, londonHourUtcMs, usCloseUtcMs, fourHourSlots,
} from './market_hours.js';

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

describe('isUsTradingDateStr — date-string trading-day check (crypto 1D window picker)', () => {
  it('true for a weekday trading day, false for weekend + full holiday', () => {
    expect(isUsTradingDateStr('2026-07-02')).toBe(true);   // Thu — trading
    expect(isUsTradingDateStr('2026-07-03')).toBe(false);  // Fri — Independence Day observed
    expect(isUsTradingDateStr('2026-07-04')).toBe(false);  // Sat
    expect(isUsTradingDateStr('2026-07-05')).toBe(false);  // Sun
    expect(isUsTradingDateStr('2026-07-06')).toBe(true);   // Mon — trading
    expect(isUsTradingDateStr('2026-11-26')).toBe(false);  // Thanksgiving
  });
  it('accepts a longer ISO string (reads the date part) and is permissive on junk', () => {
    expect(isUsTradingDateStr('2026-07-02T20:00')).toBe(true);
    expect(isUsTradingDateStr('2026-07-04T20:00')).toBe(false);
    expect(isUsTradingDateStr('')).toBe(true);        // malformed → permissive
    expect(isUsTradingDateStr(/** @type {any} */ (null))).toBe(true);
  });
});

// ---------------------------------------------------------------------
// The four-hour London sampling grid (3M)
// ---------------------------------------------------------------------

/** UTC HH:MM of every slot on one calendar day, in order. */
const slotTimes = (day) => [
  ...LONDON_SLOT_HOURS.map(h => londonHourUtcMs(day, h)),
  usCloseUtcMs(day),
].map(ms => new Date(ms).toISOString().slice(11, 16));

describe('londonHourUtcMs / usCloseUtcMs — the grid across all four DST regimes', () => {
  // The whole point of pinning the sixth slot to the close rather than
  // writing 21:00 down: for ~3 weeks in March and ~1 week around the
  // start of November the UK and the US are in DIFFERENT regimes, and
  // the US close lands at 20:00 London, not 21:00.
  it('UK and US both on standard time: London 01/05/09/13/17 + a 21:00 close', () => {
    expect(slotTimes('2026-01-15'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '21:00']);
    expect(slotTimes('2026-11-03'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '21:00']);
  });

  it('UK and US both on summer time: the same London hours, an hour earlier in UTC', () => {
    // BST, so 00:00 UTC IS 01:00 London and the 20:00 UTC close IS
    // 21:00 London — a perfect four-hour grid either way.
    expect(slotTimes('2026-07-15'))
      .toEqual(['00:00', '04:00', '08:00', '12:00', '16:00', '20:00']);
  });

  it('US on summer time, UK not: the close moves to 20:00 London', () => {
    // US switches 2nd Sun March (2026-03-08), UK the last (2026-03-29).
    expect(slotTimes('2026-03-16'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '20:00']);
    expect(slotTimes('2026-03-26'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '20:00']);
    // UK switches back last Sun Oct (2026-10-25), US 1st Sun Nov
    // (2026-11-01) — the same mismatch, the other way round the year.
    expect(slotTimes('2026-10-26'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '20:00']);
    expect(slotTimes('2026-10-30'))
      .toEqual(['01:00', '05:00', '09:00', '13:00', '17:00', '20:00']);
  });

  it('the first five slots are always four hours apart, in London time', () => {
    for (const day of ['2026-01-15', '2026-03-16', '2026-07-15', '2026-10-26', '2026-11-03']) {
      const ms = LONDON_SLOT_HOURS.map(h => londonHourUtcMs(day, h));
      for (let i = 1; i < ms.length; i++) expect(ms[i] - ms[i - 1]).toBe(4 * 3600_000);
    }
  });
});

describe('fourHourSlots — the grid a 3M chart samples on', () => {
  const iso = (ms) => new Date(ms).toISOString().slice(0, 16);

  it('six points a weekday, ascending, inside the window', () => {
    const start = Date.UTC(2026, 8, 14);            // Mon 14 Sep
    const end   = Date.UTC(2026, 8, 17, 22, 45);    // Thu 17 Sep 22:45
    const slots = fourHourSlots(start, end);
    expect(slots.map(iso)).toEqual([
      '2026-09-14T00:00', '2026-09-14T04:00', '2026-09-14T08:00',
      '2026-09-14T12:00', '2026-09-14T16:00', '2026-09-14T20:00',
      '2026-09-15T00:00', '2026-09-15T04:00', '2026-09-15T08:00',
      '2026-09-15T12:00', '2026-09-15T16:00', '2026-09-15T20:00',
      '2026-09-16T00:00', '2026-09-16T04:00', '2026-09-16T08:00',
      '2026-09-16T12:00', '2026-09-16T16:00', '2026-09-16T20:00',
      '2026-09-17T00:00', '2026-09-17T04:00', '2026-09-17T08:00',
      '2026-09-17T12:00', '2026-09-17T16:00', '2026-09-17T20:00',
      '2026-09-17T22:00',   // the live edge, quantised to the hour
    ]);
    for (let i = 1; i < slots.length; i++) expect(slots[i]).toBeGreaterThan(slots[i - 1]);
  });

  it('skips the weekend rather than drawing two flat days', () => {
    // Fri 18 Sep 18:00 -> Mon 21 Sep 10:00. The x axis is index-based,
    // so twelve flat weekend points would spend real chart width on a
    // stretch where every venue in the book is shut.
    const slots = fourHourSlots(Date.UTC(2026, 8, 18, 18, 0), Date.UTC(2026, 8, 21, 10, 0))
      .map(iso);
    expect(slots).toEqual([
      '2026-09-18T20:00',   // Friday's US close
      '2026-09-21T00:00', '2026-09-21T04:00', '2026-09-21T08:00',
      '2026-09-21T10:00',   // live edge
    ]);
    expect(slots.some(d => d.startsWith('2026-09-19') || d.startsWith('2026-09-20'))).toBe(false);
  });

  it('the live edge dedupes when the hour is already a slot', () => {
    // 20:00 UTC on a September weekday is both the US close and the
    // current hour; it must appear once.
    const slots = fourHourSlots(Date.UTC(2026, 8, 17, 12), Date.UTC(2026, 8, 17, 20, 30));
    expect(slots.map(iso)).toEqual(['2026-09-17T12:00', '2026-09-17T16:00', '2026-09-17T20:00']);
  });

  it('returns the same array identity within the hour, so the chart memo holds', () => {
    const a = fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 17, 22, 10));
    const b = fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 17, 22, 50));
    expect(b).toBe(a);
    const c = fourHourSlots(Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 17, 23, 10));
    expect(c).not.toBe(a);
  });

  it('an empty or inverted window is empty', () => {
    expect(fourHourSlots(Date.UTC(2026, 8, 17), Date.UTC(2026, 8, 17))).toEqual([]);
    expect(fourHourSlots(Date.UTC(2026, 8, 17), Date.UTC(2026, 8, 16))).toEqual([]);
  });

  it('a 93-day window holds ~6 points a weekday — the density the daily grid lacked', () => {
    const end = Date.UTC(2026, 8, 17, 20, 0);
    const slots = fourHourSlots(end - 93 * 86400_000, end);
    // 93 days spans 66 weekdays here; the old daily-close grid drew one
    // point per TRADING day, ~65 for the whole window.
    expect(slots.length).toBeGreaterThan(380);
    expect(slots.length).toBeLessThan(410);
  });
});
