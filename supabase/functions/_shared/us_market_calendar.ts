// US equity market (NYSE / Nasdaq) full-closure calendar — the single
// source shared by every Edge Function that gates on "is the US market
// trading" (prices' crypto US-session anchoring, the overnight recorder).
//
// Rule-based, NOT a hand-maintained date list: every holiday is a fixed
// date (with the standard NYSE weekend-observance shift) or an nth-weekday,
// and Good Friday derives from Easter — so it auto-computes for ANY year
// with zero annual upkeep AND no chance of a typo marking a REAL trading
// day closed. Anything not in the computed set falls through to the normal
// "open" path, so a missing holiday is merely "polls on a closed day"
// (harmless), never the reverse.
//
// Full-day closures only. The ~3 early-close half-days a year (day after
// Thanksgiving, July-3 / Christmas-Eve when they land on a weekday) are NOT
// modelled — those ARE trading days, just to 13:00 ET, so leaving them
// "regular" is correct; only the 16:00 close anchor is ~3 h off on them.
//
// The browser client keeps a byte-equivalent copy of these rules in
// `src/prices/market_hours.js` (`isUsMarketHoliday`) — different runtime, so the
// two can't literally share a module. KEEP THEM IN SYNC: a change here
// should be mirrored there (and vice-versa). Pinned by
// `us_market_calendar.test.ts`, which also records the next several years'
// closures so a regression in the rules is caught.

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
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return isUsMarketHolidayYmd(y, m, d);
}
