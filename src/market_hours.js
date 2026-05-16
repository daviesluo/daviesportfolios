// Date / market-time helpers. No external deps inside this repo —
// everything goes through the platform's Intl. Split out of utils.js
// so the header_sidebar clock + the chart-modal regular-close lookup
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

// US market phase, based on NY local time.
// RTH: 09:30–16:00, Premarket: 04:00–09:30, Afterhours: 16:00–20:00, Overnight: 20:00–04:00.
// Weekends → overnight.
export function usMarketPhase(now = new Date()) {
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
  const mins = hh * 60 + mm;
  if (wd === "Sat" || wd === "Sun") return "overnight";
  if (mins >= 570 && mins < 960) return "regular";      // 9:30–16:00
  if (mins >= 240 && mins < 570) return "premarket";    // 4:00–9:30
  if (mins >= 960 && mins < 1200) return "afterhours";  // 16:00–20:00
  return "overnight";                                     // 20:00–4:00
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
