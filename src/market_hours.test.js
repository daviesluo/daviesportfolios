// Pin isWeekendDeadZone's ET boundaries — the auto-refresh cadence
// flips on these, so a regression would either spam Yahoo through the
// weekend (boundary too late) or stop refreshing live overnight prices
// on a weekday night (boundary too early). Times are constructed in
// UTC and asserted against the America/New_York interpretation; we use
// a fixed winter date (EST = UTC-5) so the offset is deterministic.

import { describe, it, expect } from 'vitest';
import { isWeekendDeadZone, usMarketPhase } from './market_hours.js';

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
