// US equity market (NYSE / Nasdaq) calendar — full closures and early closes — the single
// source shared by every Edge Function that gates on "is the US market
// trading" (the price function's session anchoring and extended-hours scan,
// the overnight and snapshot recorders).
//
// Rule-based, NOT a hand-maintained date list: every holiday is a fixed
// date (with the standard NYSE weekend-observance shift) or an nth-weekday,
// and Good Friday derives from Easter — so it auto-computes for ANY year
// with zero annual upkeep AND no chance of a typo marking a REAL trading
// day closed. Anything not in the computed set falls through to the normal
// "open" path, so a missing holiday is merely "polls on a closed day"
// (harmless), never the reverse.
//
// Early closes are here too, since 2026-09-30 (improvement plan item 14):
// on at most three days a year the regular session ends at 13:00 ET and the
// late session runs to 17:00. Those ARE trading days, so they are not in the
// holiday set; `usRegularCloseMin` gives the close, and the snapshot recorder
// and the price function's extended-hours scan read it, so a sample from
// 13:00 is the late session's print and never the frozen 13:00 close carried
// as live. Crypto's US-session anchor keeps the 16:00-ET bar on every trading
// day, and so does the board, whose anchors all read 16:00-ET bars.
//
// The browser client keeps a byte-equivalent copy of the HOLIDAY rules in
// `src/prices/market_hours.js` (`isUsMarketHoliday`) — different runtime, so the
// two can't literally share a module. KEEP THEM IN SYNC: a change here
// should be mirrored there (and vice-versa). The early closes have no client
// copy: the board keeps 16:00 on those days by decision (see that file).
// Pinned by `us_market_calendar.test.ts`, which also records the next several
// years' closures and early closes so a regression in the rules is caught.

/** UTC day-of-week (0=Sun…6=Sat) for a calendar Y-M-D. */
function dowUTC(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** Day-of-month of the nth (1-based; -1 = last) weekday `wd` (0=Sun) in month m. */
function nthWeekday(y: number, m: number, wd: number, nth: number): number {
  if (nth > 0) {
    const offset = (wd - dowUTC(y, m, 1) + 7) % 7;
    return 1 + offset + (nth - 1) * 7;
  }
  const lastDom = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDom - ((dowUTC(y, m, lastDom) - wd + 7) % 7);
}
/** Easter Sunday {month,day} via the Anonymous Gregorian algorithm. */
function easterSunday(y: number): { month: number; day: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mo = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mo + 114) / 31);
  const day = ((h + l - 7 * mo + 114) % 31) + 1;
  return { month, day };
}
/**
 * Observed `M-D` for a fixed-date holiday. NYSE shifts a Saturday holiday
 * to the Friday before and a Sunday holiday to the Monday after — except
 * New Year's Day, which is never pulled onto the prior Friday (shiftSat=false).
 */
function observedMD(y: number, m: number, d: number, shiftSat: boolean): string {
  const dow = dowUTC(y, m, d);
  if (dow === 6 && shiftSat) return `${m}-${d - 1}`;  // Sat → Fri
  if (dow === 0) return `${m}-${d + 1}`;               // Sun → Mon
  return `${m}-${d}`;
}
const _holidayCache = new Map<number, Set<string>>();
function holidaySetFor(y: number): Set<string> {
  const set = new Set<string>();
  set.add(observedMD(y, 1, 1, false));                       // New Year's (Sun→Mon only)
  set.add(`1-${nthWeekday(y, 1, 1, 3)}`);                    // MLK — 3rd Mon Jan
  set.add(`2-${nthWeekday(y, 2, 1, 3)}`);                    // Presidents — 3rd Mon Feb
  const e = easterSunday(y);                                 // Good Friday — Easter − 2
  const gf = new Date(Date.UTC(y, e.month - 1, e.day - 2));
  set.add(`${gf.getUTCMonth() + 1}-${gf.getUTCDate()}`);
  set.add(`5-${nthWeekday(y, 5, 1, -1)}`);                   // Memorial — last Mon May
  set.add(observedMD(y, 6, 19, true));                       // Juneteenth
  set.add(observedMD(y, 7, 4, true));                        // Independence Day
  set.add(`9-${nthWeekday(y, 9, 1, 1)}`);                    // Labor — 1st Mon Sep
  set.add(`11-${nthWeekday(y, 11, 4, 4)}`);                  // Thanksgiving — 4th Thu Nov
  set.add(observedMD(y, 12, 25, true));                      // Christmas
  return set;
}

/**
 * Is the ET-calendar `y-m-d` (m,d 1-based) a full-day US market holiday?
 * The pure core — exported for tests. Note: for a fixed holiday that lands
 * on a Saturday this returns true for the SATURDAY (the market is shut that
 * calendar day anyway) as well as the observed Friday, since the set holds
 * the shifted date.
 */
export function isUsMarketHolidayYmd(y: number, m: number, d: number): boolean {
  let set = _holidayCache.get(y);
  if (!set) { set = holidaySetFor(y); _holidayCache.set(y, set); }
  return set.has(`${m}-${d}`);
}

/**
 * Is the ET calendar day of `utcSec` (shifted by `etOff` seconds) a US
 * TRADING day — not a weekend and not a full-day holiday? Unix-seconds
 * form; shifting the epoch by the ET offset and reading UTC components
 * decodes the ET wall-clock date. Used by the prices crypto anchoring.
 */
export function isUsTradingDay(utcSec: number, etOff: number): boolean {
  const et = new Date((utcSec + etOff) * 1000);
  const wd = et.getUTCDay();
  if (wd === 0 || wd === 6) return false;                    // Sun / Sat
  return !isUsMarketHolidayYmd(et.getUTCFullYear(), et.getUTCMonth() + 1, et.getUTCDate());
}

/**
 * Is `at` a full-day US market holiday (America/New_York calendar)? `Date`
 * form (Intl-derived ET date), used by the overnight recorder. Weekends
 * are a separate gate at the caller.
 */
export function isUsMarketHolidayAt(at: Date): boolean {
  const [y, m, d] = etYmd(at);
  return isUsMarketHolidayYmd(y, m, d);
}

/** The America/New_York calendar day of `at`, as [y, m, d] (m, d 1-based). */
function etYmd(at: Date): [number, number, number] {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return [y, m, d];
}

/** The regular session's close in ET minutes of the day: 16:00, and 13:00 on an early close. */
export const US_REGULAR_CLOSE_MIN = 16 * 60;
export const US_EARLY_CLOSE_MIN = 13 * 60;

/**
 * Does the regular session on the ET-calendar `y-m-d` end at 13:00 ET? The
 * Friday after Thanksgiving always; July 3 and December 24 when they fall
 * Monday to Thursday. On a Friday each is the observed Independence Day or
 * Christmas, a full closure (`isUsMarketHolidayYmd`), and on a weekend there
 * is no session to shorten. NYSE Group's published calendars for 2025–2028
 * name exactly these days; the rule carries the same pattern forward.
 */
export function isUsEarlyCloseYmd(y: number, m: number, d: number): boolean {
  if (m === 11) return d === nthWeekday(y, 11, 4, 4) + 1;
  if ((m === 7 && d === 3) || (m === 12 && d === 24)) {
    const dow = dowUTC(y, m, d);
    return dow >= 1 && dow <= 4;
  }
  return false;
}

/**
 * The regular session's close, in ET minutes of the day, on the ET calendar
 * day of `utcSec` (shifted by `etOff` seconds, as `isUsTradingDay` reads it).
 * Used by the price function's extended-hours scan, per candle.
 */
export function usRegularCloseMin(utcSec: number, etOff: number): number {
  const et = new Date((utcSec + etOff) * 1000);
  return isUsEarlyCloseYmd(et.getUTCFullYear(), et.getUTCMonth() + 1, et.getUTCDate())
    ? US_EARLY_CLOSE_MIN
    : US_REGULAR_CLOSE_MIN;
}

/** `Date` form of the same: the regular close on `at`'s ET calendar day. Used by the snapshot recorder. */
export function usRegularCloseMinAt(at: Date): number {
  const [y, m, d] = etYmd(at);
  return isUsEarlyCloseYmd(y, m, d) ? US_EARLY_CLOSE_MIN : US_REGULAR_CLOSE_MIN;
}
