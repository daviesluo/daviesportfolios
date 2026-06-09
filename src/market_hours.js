// Date / market-time helpers. No external deps inside this repo —
// everything goes through the platform's Intl. Split out of the
// since-retired utils.js barrel so the header_sidebar clock + the
// chart-modal regular-close lookup
// share one location instead of an undifferentiated 933-line module.

// Returns { hh, mm, ss } of Europe/London right now. Used by the
// header clock and the time-chip components.
export function londonTimeParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour")   parts.hh = p.value;
    if (p.type === "minute") parts.mm = p.value;
    if (p.type === "second") parts.ss = p.value;
  }
  return parts;
}

// Hour / minute / weekday in America/New_York. Shared by usMarketPhase
// + isWeekendDeadZone so both read the exact same ET clock (and DST is
// resolved by Intl). `wd` is the en-US short weekday ("Mon"…"Sun").
function etHourMinuteWeekday(now) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  let hh = 0, mm = 0, wd = "Mon";
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour")    hh = parseInt(p.value, 10) % 24;
    if (p.type === "minute")  mm = parseInt(p.value, 10);
    if (p.type === "weekday") wd = p.value;
  }
  return { hh, mm, wd };
}

// ---- US market holiday calendar (NYSE / Nasdaq full closures) ----
// Rule-based rather than a hand-maintained date list: every holiday is
// either a fixed date (with the standard NYSE weekend-observance shift)
// or an nth-weekday, and Good Friday is derived from Easter. This means
// no annual upkeep AND — the property that matters most — no chance of a
// typo'd date marking a REAL trading day as closed, which would mis-paint
// the scoreboard. Anything NOT in the computed set just falls through to
// the normal phase logic (the pre-fix behaviour), so a missing holiday is
// merely "polls on a closed day" (harmless), never the reverse.
//
// NOT modelled: the ~3 early-close half-days a year (day after
// Thanksgiving, July-3 / Christmas-Eve when on a weekday) — those ARE
// open trading days, just until 13:00 ET, so leaving them as 'regular'
// is correct; only the 16:00 close anchor is ~3h off on those days.

/** UTC day-of-week (0=Sun…6=Sat) for a calendar Y-M-D. */
function dowUTC(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }

/** Day-of-month of the nth (1-based; -1 = last) weekday `wd` (0=Sun) in month m. */
function nthWeekday(y, m, wd, nth) {
  if (nth > 0) {
    const offset = (wd - dowUTC(y, m, 1) + 7) % 7;
    return 1 + offset + (nth - 1) * 7;
  }
  const lastDom = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDom - ((dowUTC(y, m, lastDom) - wd + 7) % 7);
}

/** Easter Sunday {month,day} via the Anonymous Gregorian algorithm. */
function easterSunday(y) {
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
 * Observed `M-D` for a fixed-date holiday. NYSE shifts a Saturday
 * holiday to the Friday before and a Sunday holiday to the Monday after
 * — EXCEPT New Year's Day, which is never pulled back onto the prior
 * Friday (the market simply stays open), so it passes shiftSat=false.
 */
function observedMD(y, m, d, shiftSat) {
  const dow = dowUTC(y, m, d);
  if (dow === 6 && shiftSat) return `${m}-${d - 1}`;  // Sat → Fri (same month for Jun19/Jul4/Dec25)
  if (dow === 0)             return `${m}-${d + 1}`;   // Sun → Mon
  return `${m}-${d}`;
}

const _holidayCache = new Map();
function holidaySetFor(y) {
  const set = new Set();
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

/** ET calendar { y, m, d } for `now` (en-CA short date is YYYY-MM-DD). */
function etDateParts(now) {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  return { y, m, d };
}

/** True when `now` lands on a full-day US market holiday (ET calendar). */
export function isUsMarketHoliday(now = new Date()) {
  const { y, m, d } = etDateParts(now);
  let set = _holidayCache.get(y);
  if (!set) { set = holidaySetFor(y); _holidayCache.set(y, set); }
  return set.has(`${m}-${d}`);
}

// US market phase, based on NY local time.
// RTH: 09:30–16:00, Premarket: 04:00–09:30, Afterhours: 16:00–20:00, Overnight: 20:00–04:00.
// Weekends AND full-day holidays → overnight (market closed; same bucket
// every other surface already treats as "outside RTH, nothing trading").
export function usMarketPhase(now = new Date()) {
  const { hh, mm, wd } = etHourMinuteWeekday(now);
  const mins = hh * 60 + mm;
  if (wd === "Sat" || wd === "Sun") return "overnight";
  if (isUsMarketHoliday(now)) return "overnight";
  if (mins >= 570 && mins < 960) return "regular";      // 9:30–16:00
  if (mins >= 240 && mins < 570) return "premarket";    // 4:00–9:30
  if (mins >= 960 && mins < 1200) return "afterhours";  // 16:00–20:00
  return "overnight";                                     // 20:00–4:00
}

// "Weekend dead zone" — Friday after-hours close (20:00 ET) through
// Sunday's overnight reopen (20:00 ET). US equities, including the
// 24/5 overnight session, don't trade in this window, so the T212
// overnight quote can't move and there's nothing fresh to pull. The
// auto-refresh stays slow (5 min) here while weekday overnights run
// the fast 30 s cadence that keeps live overnight prices current.
// Boundaries line up with the overnight session: Fri 20:00 ET in,
// Sun 20:00 ET out.
export function isWeekendDeadZone(now = new Date()) {
  const { hh, mm, wd } = etHourMinuteWeekday(now);
  const mins = hh * 60 + mm;
  if (wd === "Sat") return true;
  if (wd === "Fri") return mins >= 1200;  // 20:00 ET onward
  if (wd === "Sun") return mins < 1200;   // before 20:00 ET
  return false;
}

// UK time-zone short name ('GMT' or 'BST') for the given moment.
// Uses Intl so DST transitions (last Sun Mar / last Sun Oct) are
// resolved by the runtime — no manual cutover dates to maintain.
export function ukTzAbbr(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    timeZoneName: 'short',
  }).formatToParts(now);
  const tz = parts.find(p => p.type === 'timeZoneName')?.value;
  return tz === 'BST' || tz === 'GMT' ? tz : 'GMT';
}

// US regular-market open / close in UTC for the given moment, accounting
// for whether the date lands in EDT (UTC-4, March 2nd Sun → Nov 1st Sun)
// or EST (UTC-5). Returned as hh/mm pairs so the chart code can compare
// against the UTC-string slice of each intraday bar.
//
//   EDT: open 13:30 UTC (= 9:30 ET), close 20:00 UTC (= 16:00 ET)
//   EST: open 14:30 UTC,             close 21:00 UTC
//
// Detection: ask the runtime for the NY hour, compare to the UTC hour;
// the offset is 4 (EDT) or 5 (EST). Avoids hard-coded DST cutover
// dates.
export function usMarketHoursUtc(now = new Date()) {
  const utcHour = now.getUTCHours();
  const nyHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).format(now), 10) % 24;
  let diff = utcHour - nyHour;
  if (diff > 12)  diff -= 24;
  if (diff < -12) diff += 24;
  const edt = diff === 4;
  return edt
    ? { openHh: 13, openMm: 30, closeHh: 20, closeMm: 0, edt: true }
    : { openHh: 14, openMm: 30, closeHh: 21, closeMm: 0, edt: false };
}

// LSE regular session: 08:00 - 16:30 London time (Mon-Fri). Returns
// true when the given moment falls inside that window. Weekends and
// public holidays are NOT modelled — Yahoo simply doesn't return new
// bars then, and the dayPct stays at the previous trading day's
// close, so a "Saturday show 0" guard is redundant. Used by
// computeMetrics to gate the ext-hours toggle's display for .L
// tickers: LSE has no US-style pre/after session, so the toggle
// should read 0 outside LSE trading hours and the live intraday
// pct only when LSE is actually open (i.e. during US pre-market
// where LSE has been trading for ~1-6h and is genuinely moving).
export function lseIsOpen(now = new Date()) {
  const parts = londonTimeParts(now);
  const hh = parseInt(parts.hh, 10);
  const mm = parseInt(parts.mm, 10);
  if (!isFinite(hh) || !isFinite(mm)) return false;
  const mins = hh * 60 + mm;
  return mins >= 8 * 60 && mins < 16 * 60 + 30;
}

// Returns { hh, mm, ss } of Europe/Paris (Central European Time, CET/CEST
// — DST resolved by Intl) right now. Mirrors londonTimeParts; used by
// euroExchangeIsOpen to gate the ext-hours toggle for euro-zone tickers.
export function centralEuropeTimeParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour")   parts.hh = p.value;
    if (p.type === "minute") parts.mm = p.value;
    if (p.type === "second") parts.ss = p.value;
  }
  return parts;
}

// Continental-European exchange CORE regular session, 09:00 - 17:30
// Central European Time (Mon-Fri). Euronext (Paris/Amsterdam/Brussels/
// Lisbon/Dublin), XETRA + Frankfurt, Milan, Madrid and Vienna all run this
// window; Helsinki's 10:00-18:30 EET maps onto the same 09:00-17:30 CET,
// and Athens (10:30-17:00 EET → 09:30-16:00 CET) sits inside it. The
// German RETAIL venues (Stuttgart .SG, Berlin .BE, Munich .MU, … —
// 08:00-22:00 CET) trade wider than this, so 09:00-17:30 is intentionally
// the conservative core session: the gate only has to be right during the
// US ext-hours overlap (after-hours / overnight, when every German venue
// is also shut), where it correctly reads closed. Same role as lseIsOpen:
// these venues have no US-style pre/after session, so the ext-hours toggle
// should read 0 outside local trading hours and the live intraday pct only
// while the exchange is open. Weekends / holidays aren't modelled (Yahoo
// returns no new bars then, so the pct stays at the prior close — the
// "Saturday show 0" guard is redundant), matching lseIsOpen.
export function euroExchangeIsOpen(now = new Date()) {
  const parts = centralEuropeTimeParts(now);
  const hh = parseInt(parts.hh, 10);
  const mm = parseInt(parts.mm, 10);
  if (!isFinite(hh) || !isFinite(mm)) return false;
  const mins = hh * 60 + mm;
  return mins >= 9 * 60 && mins < 17 * 60 + 30;
}
