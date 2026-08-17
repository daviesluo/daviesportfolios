// Pure portfolio-performance chart math, extracted from PerfChart so it's
// unit-testable independently of React rendering, network fetches and DOM
// state. Supports five time ranges (1D / 1W / 1M / 3M / YTD); the formula
// is the same for all of them, only the anchor price (chart's leftmost
// "starting value") differs.
//
// Range catalogue:

/**
 * @typedef {'1D'|'1W'|'1M'|'3M'|'YTD'} RangeKey
 */
export const RANGES = {
  // Intraday intervals on 1W / 1M so a 5-day or 30-day chart has enough
  // points to read at a glance (was 5 / 22 daily bars; now ~65 / ~150).
  // Yahoo limits 30m bars to 60 days and 60m bars to 730 days, both well
  // within these ranges.
  '1D':  { yahooRange: '1d',  interval: '5m',  label: '1D'  },
  // 1W fetches a MONTH and trims to the trailing 168 h (see
  // fetchParamsFor / applyVariantFilter). Yahoo's `5d` is five TRADING
  // sessions, which spans Mon→Fri — 4.3 days, not a week — so the "1W"
  // button was showing noticeably less than it claimed. There is no
  // Yahoo range between `5d` and `1mo`, so the week has to be cut out of
  // the month client-side. `60m` keeps that download the same shape the
  // 1M range already pulls rather than doubling it at 30m.
  '1W':  { yahooRange: '1mo', interval: '60m', label: '1W'  },
  '1M':  { yahooRange: '1mo', interval: '60m', label: '1M'  },
  '3M':  { yahooRange: '3mo', interval: '1d',  label: '3M'  },
  'YTD': { yahooRange: 'ytd', interval: '1d',  label: 'YTD' },
  // 1Y (trailing 12 months) is a ticker-MODAL-only range — deliberately
  // NOT in RANGE_KEYS below, so the portfolio PerfChart (whose math
  // anchors a Jan-1 cost basis and has no trailing-12-month basis model)
  // doesn't sprout a 1Y button it can't compute. The chart modal
  // composes its own button row as [...RANGE_KEYS, '1Y', …]; the chart
  // Edge Function already accepts range='1y'.
  '1Y':  { yahooRange: '1y',  interval: '1d',  label: '1Y'  },
};
// PerfChart + the perf-side prefetch iterate this; the modal adds '1Y'
// (and PE/PS) on top of it for its own range row.
export const RANGE_KEYS = ['1D', '1W', '1M', '3M', 'YTD'];

/**
 * Pick (yahooRange, interval, includePrePost) for a given chart range.
 * 1D has three sub-modes per the user spec:
 *   - phase === 'regular' (market is open) → fetch 5d / 5m / prepost,
 *                                            then slice client-side to
 *                                            the last 24 h. Yahoo's
 *                                            `1d` range only ever
 *                                            returns the current
 *                                            session even with prepost,
 *                                            so to get yesterday's
 *                                            close visible we need a
 *                                            wider window.
 *   - extendedHours ON + phase != 'regular' → past 24 h with pre/post
 *                                            included; chart draws a
 *                                            vertical CLOSE line at the
 *                                            last regular close.
 *   - extendedHours OFF + market closed     → previous regular trading
 *                                            day's intraday only (we
 *                                            fetch a 5-day window then
 *                                            keep the most recent
 *                                            calendar day's points).
 *
 * @param {string} rangeKey
 * @param {boolean} extendedHours
 * @param {string} phase  — 'regular' | 'premarket' | 'afterhours' | 'overnight'
 * @returns {{ yahooRange: string, interval: string, includePrePost: boolean, variant: string }}
 */
export function fetchParamsFor(rangeKey, extendedHours, phase) {
  const r = RANGES[rangeKey] || RANGES.YTD;
  if (rangeKey === '1W') return { yahooRange: r.yahooRange, interval: r.interval, includePrePost: false, variant: 'w1' };
  if (rangeKey !== '1D') return { yahooRange: r.yahooRange, interval: r.interval, includePrePost: false, variant: 'std' };
  if (phase === 'regular') return { yahooRange: '5d', interval: '5m', includePrePost: true,  variant: 'reg' };
  if (extendedHours)       return { yahooRange: '5d', interval: '5m', includePrePost: true,  variant: 'ext' };
  return                     { yahooRange: '5d', interval: '5m', includePrePost: false, variant: 'closed' };
}

/**
 * Fetch params for the moving-average overlay's wider history series.
 * Same shape as fetchParamsFor but tuned for "MA window prior to the
 * leftmost displayed bar". 1D and PE return null (no MA overlay).
 * dailyOnly tickers (CN funds / .PVT) override interval to 1d at every
 * range — Yahoo has no intraday for them and the eastmoney path
 * returns daily NAVs only.
 *
 * @param {string} rangeKey
 * @param {boolean} [dailyOnly]
 * @returns {{ range: string, interval: string } | null}
 */
export function maFetchParamsFor(rangeKey, dailyOnly = false) {
  const intraday = {
    '1W':  { range: '1mo', interval: '30m' },
    '1M':  { range: '3mo', interval: '60m' },
    '3M':  { range: '6mo', interval: '1d'  },
    'YTD': { range: '1y',  interval: '1d'  },
    // 1Y view draws a 200-day MA, so the overlay needs ~200 trading
    // days of lead-in BEFORE the leftmost (12-months-ago) display bar.
    // 2y of daily bars (~504 td) minus the 1y display window (~252 td)
    // leaves ~252 td of history ahead of the leftmost bar — comfortably
    // ≥ 200, so the MA200 is fully populated to the chart's left edge
    // (a freshly-listed name with < 200 td of prior history correctly
    // shows the MA line starting where its window first fits).
    '1Y':  { range: '2y',  interval: '1d'  },
  }[rangeKey];
  if (!intraday) return null;
  if (dailyOnly && (rangeKey === '1W' || rangeKey === '1M')) {
    return { range: intraday.range, interval: '1d' };
  }
  return intraday;
}

/**
 * Keep only the bars within the trailing `hours` window. Generalises
 * `filterToLast24h` — crypto 1D keeps a wider (multi-day) window so the
 * modal can slice a full close-to-close day for the ext-OFF market-closed
 * view (windowBetweenLastTwoUsCloses) while ext ON still trims to 24 h.
 * Bars are tagged with a UTC timestamp string ("YYYY-MM-DDTHH:MM");
 * without the trailing Z `new Date()` would parse them as local, so append
 * it explicitly.
 * @template {{date:string}} T
 * @param {T[]} points
 * @param {number} hours
 * @returns {T[]}
 */
export function filterToLastHours(points, hours) {
  if (!Array.isArray(points) || points.length === 0) return points;
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const out = points.filter(p => {
    const isUtcIso = typeof p.date === 'string' && p.date.length === 16 && p.date[10] === 'T';
    const t = new Date(p.date + (isUtcIso ? 'Z' : '')).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  // Defensive: if the filter wiped everything (e.g. clock skew or all
  // bars older than the window because the market was closed for a long
  // weekend), fall back to the most recent calendar day so the chart
  // still has data to draw rather than going blank.
  return out.length >= 2 ? out : filterToLatestDay(points);
}

/**
 * For the "1D regular" variant the fetch returns up to 5 trading days
 * worth of bars; we only want the last 24 hours so the chart matches
 * the user's "past 24 hours" expectation.
 * @template {{date:string}} T
 * @param {T[]} points
 * @returns {T[]}
 */
export function filterToLast24h(points) {
  return filterToLastHours(points, 24);
}

/**
 * For the "1D + ext OFF + market closed" variant the fetched series spans
 * 5 days; we want only the most recent calendar day's bars. Returns the
 * filtered array (or the input untouched for other variants).
 */
export function filterToLatestDay(points) {
  if (!Array.isArray(points) || points.length === 0) return points;
  const lastDate = points[points.length - 1].date.slice(0, 10);
  return points.filter(p => p.date.startsWith(lastDate));
}

/**
 * BTC-style US-session window for a 24/7 crypto's 1D chart when the
 * Extended Hours toggle is OFF: keep bars from the most recent US regular
 * close (the last bar at `mh.closeHh:mh.closeMm` UTC = 16:00 ET) through
 * the end, so the chart runs "from the previous US close to now" like a US
 * stock's 1D instead of a rolling 24 h. Crypto trades straight through the
 * close so the series has a bar there; falls back to the input unchanged
 * when no exact-close bar is present (holiday / gap). `mh` =
 * `usMarketHoursUtc()` (its closeHh/closeMm are UTC, DST-aware).
 * `isTradingDay(dateStr)` (optional) rejects a 16:00-ET bar whose date is a
 * weekend / holiday — crypto has one EVERY day, and over a long holiday
 * weekend keying off a non-trading day's bar picks a fake "close".
 * @template {{date:string}} T
 * @param {T[]|null} points
 * @param {{closeHh:number, closeMm:number}|null} mh
 * @param {(dateStr:string)=>boolean} [isTradingDay]
 * @returns {T[]|null}
 */
export function windowSinceLastUsClose(points, mh, isTradingDay) {
  if (!Array.isArray(points) || points.length === 0 || !mh) return points;
  const ok = typeof isTradingDay === 'function' ? isTradingDay : () => true;
  for (let i = points.length - 1; i >= 0; i--) {
    const d = points[i] && points[i].date;
    if (typeof d !== 'string' || d.length < 16 || d[10] !== 'T') continue;
    const hh = parseInt(d.slice(11, 13), 10);
    const mm = parseInt(d.slice(14, 16), 10);
    if (hh === mh.closeHh && mm === mh.closeMm && ok(d)) return points.slice(i);
  }
  return points;
}

/**
 * BTC-style US-session window for a 24/7 crypto's 1D chart when the
 * Extended Hours toggle is OFF **and the US market is closed** (pre-market
 * / after-hours / overnight): show the last COMPLETE close-to-close trading
 * day — from the previous US regular close (16:00 ET) through the most
 * recent one, ending AT that close, NOT at "now". So, like a US stock's 1D
 * after hours, the chart stops at the regular close and hides the current
 * extended-hours / overnight move (which is exactly what "ext hours on's
 * start time" — the moment the current after-hours session began — marks).
 * Crypto trades straight through the close so both close bars exist; the
 * data hook keeps enough trailing history (see `applyChartWindow`) for the
 * previous close to be present. `mh.closeHh:closeMm` are UTC, DST-aware.
 * Fallbacks: one close bar → start→that close (still ends at a close);
 * none (holiday / gap / no mh / empty) → the input unchanged.
 * `isTradingDay(dateStr)` (optional) skips a 16:00-ET bar on a weekend /
 * holiday — crypto has one every day, so over a long holiday weekend the
 * "last two closes" would otherwise be weekend bars, not real US sessions.
 * @template {{date:string}} T
 * @param {T[]|null} points
 * @param {{closeHh:number, closeMm:number}|null} mh
 * @param {(dateStr:string)=>boolean} [isTradingDay]
 * @returns {T[]|null}
 */
export function windowBetweenLastTwoUsCloses(points, mh, isTradingDay) {
  if (!Array.isArray(points) || points.length === 0 || !mh) return points;
  const ok = typeof isTradingDay === 'function' ? isTradingDay : () => true;
  /** @type {number[]} */
  const closeIdxs = [];
  for (let i = points.length - 1; i >= 0 && closeIdxs.length < 2; i--) {
    const d = points[i] && points[i].date;
    if (typeof d !== 'string' || d.length < 16 || d[10] !== 'T') continue;
    const hh = parseInt(d.slice(11, 13), 10);
    const mm = parseInt(d.slice(14, 16), 10);
    if (hh === mh.closeHh && mm === mh.closeMm && ok(d)) closeIdxs.push(i);
  }
  // Scanned back-to-front: closeIdxs = [lastCloseIdx, prevCloseIdx].
  if (closeIdxs.length === 2) return points.slice(closeIdxs[1], closeIdxs[0] + 1);
  if (closeIdxs.length === 1) return points.slice(0, closeIdxs[0] + 1);
  return points;
}

/**
 * Lay a sparse Yahoo intraday series onto a FIXED venue-session grid —
 * 5-min slots from `session.startMin` to `session.endMin` in the venue's
 * wall-clock `tz` — carrying the last known close flat through slots with
 * no bar. Illiquid venue listings (2DG.F) only get a Yahoo bar for buckets
 * with an actual trade, so their 1D line died at the day's last print
 * (e.g. 17:30) even though the venue trades to 21:00 UK; on the grid the
 * chart always spans the whole session ("一定要从7:00显示到21:00").
 *
 *   - One grid per venue-local calendar day present in the input; days
 *     iterate in order, so a multi-day window (the 'reg'/'ext' 24 h
 *     variants) gets each day's session frame back to back.
 *   - Real bars pass through as-is; gap slots are synthesised as
 *     `{date, close: <carried>, volume: 0}` (zero volume keeps the VWAP
 *     overlay's forward-fill honest — no phantom traded volume).
 *   - Leading slots before the day's first bar carry the previous day's
 *     last value, or (first day) backfill flat at the first bar's close.
 *   - The LIVE day's grid is capped at the last completed 5-min slot, so
 *     the line ends at "now", not at a future-flat 21:00.
 *   - Bars outside the frame (pre-07:00 auction prints etc.) are dropped —
 *     the frame owns the day.
 * DST-safe: the tz offset is sampled per day at local noon via Intl (the
 * session is nowhere near the 01:00–02:00 transition window).
 * Falls back to the input untouched on empty/malformed input.
 *
 * @param {Array<{date: string, close: number, volume?: number}> | null} points
 * @param {{tz: string, startMin: number, endMin: number} | null} session
 * @param {number} [nowMs]
 * @returns {Array<{date: string, close: number, volume?: number}> | null}
 */
export function fillVenueSessionGrid(points, session, nowMs = Date.now()) {
  if (!Array.isArray(points) || points.length === 0 || !session) return points;
  const STEP = 5 * 60_000;
  const bars = points.filter((p) => p && typeof p.date === 'string'
    && p.date.length === 16 && p.date[10] === 'T' && typeof p.close === 'number');
  if (bars.length === 0) return points;
  const byKey = new Map(bars.map((p) => [p.date, p]));
  const toMs = (d) => new Date(d + 'Z').getTime();
  const fmtUtc = (ms) => new Date(ms).toISOString().slice(0, 16);
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: session.tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const hourFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: session.tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  // Venue-local calendar days present in the input, ascending.
  const days = [...new Set(bars.map((p) => dayFmt.format(toMs(p.date))))].sort();
  const out = [];
  let carry = bars[0].close;   // leading slots of day 1 backfill flat at the first bar
  for (const day of days) {
    const [y, m, d] = day.split('-').map(Number);
    // tz offset for this day, sampled at local noon (DST-safe for a
    // 07:00–21:00 frame — transitions happen 01:00–02:00 local).
    const probe = Date.UTC(y, m - 1, d, 12, 0);
    const parts = hourFmt.format(probe).split(':').map(Number);
    const offMs = ((parts[0] * 60 + parts[1]) - 12 * 60) * 60_000;
    const midnightUtc = Date.UTC(y, m - 1, d) - offMs;
    const startMs = midnightUtc + session.startMin * 60_000;
    let endMs = midnightUtc + session.endMin * 60_000;
    if (endMs > nowMs) endMs = Math.floor(nowMs / STEP) * STEP;   // live day → cap at now
    for (let t = startMs; t <= endMs; t += STEP) {
      const key = fmtUtc(t);
      const real = byKey.get(key);
      if (real) { carry = real.close; out.push(real); }
      else out.push({ date: key, close: carry, volume: 0 });
    }
  }
  return out.length >= 2 ? out : points;
}

// Apply the 1D fetch-variant's display window to a fetched series:
//   'closed' → trim to the latest available trading day
//   'reg' / 'ext' → trim to the trailing 24 h
//   anything else (daily ranges) → unchanged
// Single source for the if/else-if that was inlined identically at 8
// call sites across perf_chart.jsx, use_ticker_chart_data.js, and
// prefetch.js. Falsy `data` passes straight through so callers don't
// each need their own `data &&` guard.
export function applyVariantFilter(data, variant) {
  if (!data) return data;
  // 1W: cut the trailing week out of the fetched month. Both variants
  // trim — `1w-ext` (PerfChart's ext-on week, which additionally pulls
  // pre/post bars) used to pass through untouched because the fetch was
  // already a 5-day window; now that 1W fetches a MONTH to cover a real
  // week, letting it through would draw a month under a "1W" button.
  if (variant === 'w1' || variant === '1w-ext') return filterToLastHours(data, 24 * 7);
  // Every 1D variant is the same trailing 24 h. `closed` used to take
  // the latest CALENDAR day instead, so with the Extended Hours toggle
  // off the "1D" window silently changed length depending on the phase
  // — a few hours just after the open, a full session later on — and
  // disagreed with what the same button showed with the toggle on. The
  // benchmark and whether pre/post bars are included still follow the
  // toggle; only the window length is now the same either way.
  if (variant === 'closed' || variant === 'reg' || variant === 'ext') {
    return filterToLast24h(data);
  }
  return data;
}

/** Computes the date string the chart's leftmost edge should sit at, given
 *  a range. For 1D the anchor is "now" so we use today's date with the
 *  earliest practical timestamp; for daily ranges it's a pure YYYY-MM-DD. */
export function anchorDateFor(rangeKey, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (rangeKey === '1D')  return today;
  if (rangeKey === 'YTD') return `${now.getFullYear()}-01-01`;
  // Approximate calendar-day cutoffs. The chart's actual leftmost data
  // point is whatever the fetched series starts at; this only affects the
  // pre-anchor / in-range classification of lots, so daily granularity
  // is fine.
  const days = rangeKey === '1W' ? 7 : rangeKey === '1M' ? 31 : rangeKey === '3M' ? 93 : 0;
  const cutoff = new Date(now.getTime() - days * 86400_000);
  return cutoff.toISOString().slice(0, 10);
}

// The Yahoo-Finance-equivalent YTD formula:
//
//   For each lot (date, shares, cost) in each non-cash holding:
//
//     basis_price = (lot.date < yearStartDate) ? <Jan-1 close>          // pre-year lot
//                                              : lot.cost                // year lot
//     value_price = close(ticker, d)                                     // historical close
//                  | live marketData price (only on the chart's last point)
//                  | linear interp cost → lastPrice (no historical data)
//
//   YTD%(d) = (Σ shares × value_price − Σ shares × basis_price)
//             ────────────────────────────────────────────────── × 100
//                       Σ shares × basis_price
//
// Pre-year lots whose ticker has no Jan-1 close are SKIPPED (we don't guess
// a basis), so the chart shows YTD% over the holdings we actually have data
// for rather than including a misleading number.

/**
 * Build per-ticker historical series + anchor price from a raw hist map
 * (the shape returned by fetchHistoricalBatch). Each series is sorted
 * ascending by date string (which works for both `YYYY-MM-DD` and
 * `YYYY-MM-DDTHH:MM` formats since both sort lexicographically).
 *
 * Anchor price by range:
 *   - 1D + useExt → marketData[ticker].lastPrice (today's regular close).
 *           Pivots the chart's basis at the regular close so the right-
 *           edge % matches the scoreboard's DAY CHANGE %, which in ext-on
 *           AH/PM mode is computed as (extPrice − lastPrice) / lastPrice.
 *   - 1D otherwise → marketData[ticker].prevClose (yesterday's regular
 *           session close)
 *   - YTD → last close strictly before yearStart (prior-year-end close,
 *           Yahoo's YTD baseline)
 *   - 1W/1M/3M → last close strictly before anchorDate, else first close
 *           inside the fetched window
 *
 * @param {Record<string, {date:string, close:number}[]>} hist
 * @param {string} anchorDate    — chart's leftmost cutoff (YYYY-MM-DD)
 * @param {string} rangeKey      — '1D' | '1W' | '1M' | '3M' | 'YTD'
 * @param {Record<string, {prevClose?:number, lastPrice?:number}>} [marketData]
 * @param {boolean} [useExt]     - extendedHours and phase not 'regular'
 * @returns {Record<string, {series:{date:string,close:number}[], map:Record<string,number>, janPrice:number|null}>}
 */
export function buildTickerSeries(hist, anchorDate, rangeKey = 'YTD', marketData = {}, useExt = false) {
  /** @type {Record<string, {series:{date:string,close:number}[], map:Record<string,number>, janPrice:number|null}>} */
  const out = {};
  for (const [t, raw] of Object.entries(hist || {})) {
    const series = (raw || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    /** @type {Record<string, number>} */
    const map = {};
    for (const p of series) map[p.date] = p.close;

    let janPrice = null;
    if (rangeKey === '1D') {
      // 1D anchors at "the most recent 16:00 ET regular close that has
      // occurred". During regular hours that's yesterday's close (=
      // marketData.prevClose). In ext-on AH/PM that's today's regular
      // close (= marketData.lastPrice — Yahoo updates lastPrice to the
      // 16:00 ET print once the market closes). Same anchor as the
      // ticker-drill modal and the perf chart's S&P legend so the three
      // surfaces report the same %.
      const md = marketData[t];
      const ref = useExt ? md?.lastPrice : md?.prevClose;
      if (typeof ref === 'number' && ref > 0) {
        janPrice = ref;
      } else if (md && typeof md.prevClose === 'number' && md.prevClose > 0) {
        // Fallback: useExt requested but lastPrice missing — better to plot
        // against prevClose than render an empty chart.
        janPrice = md.prevClose;
      }
    } else {
      // Daily ranges: the close on the last trading day strictly before
      // anchorDate. Fall back to the first close inside the window for
      // tickers that started trading after the anchor.
      const prior = series.filter(p => p.date < anchorDate);
      if (prior.length > 0) {
        janPrice = prior[prior.length - 1].close;
      } else {
        const inRange = series.filter(p => p.date >= anchorDate);
        janPrice = inRange.length > 0 ? inRange[0].close : null;
      }
    }
    out[t] = { series, map, janPrice };
  }
  return out;
}

/**
 * Get the close for `ticker` on `date`. Falls back to the most recent close
 * on or before `date` (binary search), or null if the ticker is unknown /
 * has no data on or before `date`.
 *
 * @param {ReturnType<typeof buildTickerSeries>} tickerSeries
 * @param {string} ticker
 * @param {string} date
 * @returns {number | null}
 */
export function closeOn(tickerSeries, ticker, date) {
  const tm = tickerSeries[ticker];
  if (!tm) return null;
  if (tm.map[date] != null) return tm.map[date];
  let lo = 0, hi = tm.series.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tm.series[mid].date <= date) { best = tm.series[mid].close; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

/**
 * Decide which lots to use for a holding. Lots are the source of truth
 * (managed via the lot editor in EditTickerModal); we only fall back to a
 * single yearStart-dated lot if h.lots is empty or its share total has
 * drifted from h.shares (which shouldn't happen but is defensible).
 *
 * @param {{shares:number, lastPrice?:number, lots?:Array<{date:string,shares:number,cost:number}>}} h
 * @param {string} yearStart
 * @returns {Array<{date:string,shares:number,cost:number}>}
 */
export function lotsFor(h, yearStart) {
  const sumShares = (lots) => lots.reduce((s, l) => s + (l.shares || 0), 0);
  if (Array.isArray(h.lots) && h.lots.length > 0
      && Math.abs(sumShares(h.lots) - h.shares) < 0.0001) {
    return h.lots;
  }
  return [{ date: yearStart, shares: h.shares, cost: h.lastPrice || 0 }];
}

/**
 * Compute (Σ value_USD, Σ basis_USD) for the portfolio at a given date,
 * applying the YTD-formula rules per-lot.
 *
 * @param {{
 *   date: string,
 *   portfolio: { holdings: Record<string, any>, positions?: Record<string, { tickers?: string[] }> },
 *   tickerSeries: ReturnType<typeof buildTickerSeries>,
 *   marketData?: Record<string, { lastPrice?: number, extPrice?: number | null, prevClose?: number }>,
 *   yearStart: string,
 *   yearStartDate: string,
 *   todayMs: number,
 *   liveAnchorDate: string,
 *   useExt: boolean,
 *   fxToUSD: (currency: string | undefined, marketData: any) => number,
 *   prevCloseBasis?: boolean,
 * }} opts
 * @returns {{ value: number, basis: number }}
 */
export function computeAt(opts) {
  const {
    date, portfolio, tickerSeries, marketData,
    yearStart, yearStartDate, todayMs, liveAnchorDate, useExt, fxToUSD,
    prevCloseBasis = false,
  } = opts;
  const useLive = date === liveAnchorDate;
  // Lot dates are always YYYY-MM-DD (no intraday precision). The chart's
  // `date` and `yearStartDate` strings can be either YYYY-MM-DD (daily
  // ranges) or YYYY-MM-DDTHH:MM (1D intraday). Comparing "2026-04-28"
  // against "2026-04-28T13:30" naively returns true (the 10-char string
  // is lexicographically < the 16-char one because '' < 'T'), which would
  // misclassify a lot bought today as pre-anchor in the 1D range. Slice
  // the chart-side dates to YYYY-MM-DD before comparing with lot dates.
  const dateDay = (date || '').slice(0, 10);
  const anchorDay = (yearStartDate || '').slice(0, 10);
  let value = 0, basis = 0;

  // Match the scoreboard's scope. computeMetrics iterates
  // positions → tickers → holdings[t], so only holdings actually placed
  // on the board count toward its DAY CHANGE / market value. A holding
  // left in `holdings` but not referenced by any position (orphaned by
  // an edit) would otherwise be summed by the chart but not the
  // scoreboard, splitting the two numbers for reasons unrelated to the
  // basis. Restrict to positioned tickers so the chart's PORTFOLIO line
  // is computed over exactly the same set.
  const positioned = new Set();
  for (const pos of Object.values(portfolio.positions || {})) {
    if (pos && Array.isArray(pos.tickers)) for (const t of pos.tickers) positioned.add(t);
  }
  // No positions at all (e.g. unit-test fixtures) → don't filter; count
  // every holding. In production there are always positions, so the
  // board-scope restriction below applies.
  const scopeAll = positioned.size === 0;

  for (const [ticker, h] of Object.entries(portfolio.holdings)) {
    if (h.isCash || ticker === 'CASH') continue;
    if (!scopeAll && !positioned.has(ticker)) continue; // orphaned holding — not on the board
    const lots = lotsFor(h, yearStart);
    const fx = (h.currency && h.currency !== 'USD') ? fxToUSD(h.currency, marketData) : 1;
    const ts = tickerSeries[ticker];
    const janPrice = ts ? ts.janPrice : null;
    const lastPrice = h.lastPrice;
    const md = marketData?.[ticker];
    const livePrice = useLive
      ? ((useExt && md?.extPrice != null && md.extPrice > 0) ? md.extPrice
         : (md?.lastPrice ?? lastPrice))
      : null;

    for (const lot of lots) {
      if (lot.date > dateDay) continue; // not yet held

      // Current price at date — prefer live for the latest chart point.
      // Computed first so the prevCloseBasis flat-fallback can reuse it.
      let priceAtD = (useLive && livePrice != null && livePrice > 0)
        ? livePrice
        : (ts ? closeOn(tickerSeries, ticker, date) : null);
      if (priceAtD == null) {
        // No historical data: linearly interpolate from cost @ lot.date to
        // current lastPrice @ today.
        const lotMs = new Date(lot.date).getTime();
        const dMs = new Date(date).getTime();
        const tgtPrice = (lastPrice != null && lastPrice > 0) ? lastPrice : lot.cost;
        if (todayMs <= lotMs || dMs >= todayMs) priceAtD = tgtPrice;
        else if (dMs <= lotMs) priceAtD = lot.cost;
        else {
          const t = (dMs - lotMs) / (todayMs - lotMs);
          priceAtD = lot.cost + (tgtPrice - lot.cost) * t;
        }
      }

      // Basis price for this lot.
      let basisPrice;
      if (prevCloseBasis) {
        // 1D day-change mode: the basis is ALWAYS the day anchor (janPrice
        // = prevClose in regular hours / today's regular close in ext)
        // for EVERY held lot, regardless of when it was bought — a "day
        // change" is measured vs yesterday's close, never the purchase
        // cost. Flat (basis = current price) when prevClose is missing,
        // so the holding still lands in the denominator instead of being
        // dropped. This mirrors computeMetrics' baselinePrice = prevClose
        // ?? currentPrice exactly, so the 1D right-edge % equals the
        // scoreboard DAY CHANGE. Without it, T212-synced lots (re-dated
        // `today` every refresh) and any same-/prior-day buy used
        // lot.cost as the basis, leaking the position's TOTAL gain into
        // the day %.
        basisPrice = (janPrice != null && janPrice > 0) ? janPrice : priceAtD;
      } else if (lot.date < anchorDay) {
        if (janPrice == null) continue; // skip — no Jan 1 baseline available
        basisPrice = janPrice;
      } else {
        basisPrice = lot.cost;
      }

      value += lot.shares * priceAtD * fx;
      basis += lot.shares * basisPrice * fx;
    }
  }

  // Cash (isCash holdings) — a constant balance that doesn't move with
  // the market. The header's DAY CHANGE % counts cash in its
  // denominator (computeMetrics: marketValue includes cash, so
  // dayPct = dayChange / yesterday's TOTAL incl. cash), so the chart's
  // PORTFOLIO line must too. Without it the line showed the
  // invested-only return and overstated the move whenever the book
  // holds meaningful cash — e.g. chart +4.27 % vs scoreboard +2.32 %.
  // Added to BOTH value and basis at every point: cash contributes
  // equally to numerator and denominator, diluting the % toward the
  // true account return. Mirrors computeMetrics' cash handling
  // (mv = lastPrice, treated USD) so the 1D live point matches the
  // scoreboard exactly during regular hours. Historical points use the
  // current balance as a constant (we don't track past cash balances)
  // — exact intraday for 1D, a reasonable held-constant approximation
  // for the longer ranges.
  let cashUSD = 0;
  for (const [ticker, h] of Object.entries(portfolio.holdings)) {
    if (!(h.isCash || ticker === 'CASH')) continue;
    if (!scopeAll && !positioned.has(ticker)) continue; // same board-scope as above
    if (typeof h.lastPrice === 'number' && h.lastPrice > 0) cashUSD += h.lastPrice;
  }
  value += cashUSD;
  basis += cashUSD;
  return { value, basis };
}

/**
 * Convenience: compute YTD% from value/basis. Returns 0 when basis is
 * non-positive (degenerate portfolio).
 */
export function ytdPct({ value, basis }) {
  return basis > 0 ? ((value - basis) / basis) * 100 : 0;
}

/**
 * One point of the Investment Performance chart: what the scoreboard's
 * PORTFOLIO cell actually read at `date`, and how much had been paid in
 * by then.
 *
 * Deliberately NOT `computeAt`. That one is board-scoped and counts a
 * holding's full bought quantity, which is right for the vs-S&P chart's
 * basis maths but wrong for reconstructing history here:
 *
 *   - It skips holdings that aren't referenced by a position, and a
 *     sold-out name is removed from every position while its ledger is
 *     kept. So a stock you held for two years and sold last month would
 *     contribute nothing to ANY past point — the line would show a
 *     portfolio you never had.
 *   - It doesn't subtract sells, so a partially-sold position would keep
 *     counting shares you no longer owned at that date.
 *
 * Here every holding participates — closed ones included — and the share
 * count at `date` is buys minus sells up to that date.
 *
 * `netDeposit` is money in, not cost basis: cumulative buy cash minus
 * sale proceeds. When you sell at a profit it drops by more than the
 * cost of what you sold, which is the point — the gap between the two
 * lines is what the account actually made.
 *
 * Cash is added to BOTH lines (the chosen "match the scoreboard"
 * reading): the scoreboard's PORTFOLIO includes it, and money sitting in
 * cash was deposited too, so it lifts value and deposit equally instead
 * of showing as profit. It has no history of its own — the current
 * balance is carried back as a constant, exact for today and an
 * approximation further back, same assumption `computeAt` already makes.
 *
 * @param {{
 *   portfolio: {holdings: Record<string, any>, positions?: Record<string, any>},
 *   tickerSeries: Record<string, any>,
 *   date: string,
 *   marketData?: Record<string, any>,
 *   liveAnchorDate?: string,
 *   useExt?: boolean,
 *   fxToUSD: (currency: string | undefined, marketData: any) => number,
 * }} opts
 * @returns {{ value: number, netDeposit: number }}
 */
export function investmentPointAt(opts) {
  const {
    portfolio, tickerSeries, date, marketData = {},
    liveAnchorDate, useExt = false, fxToUSD,
  } = opts;
  // Lot / sell dates are plain YYYY-MM-DD; chart dates can carry a time
  // on intraday ranges. Compare day-to-day or "2026-04-28" reads as
  // BEFORE "2026-04-28T13:30" (10 chars sort under 16) and a lot bought
  // today would count as not-yet-owned.
  const day = (date || '').slice(0, 10);
  const useLive = !!liveAnchorDate && date === liveAnchorDate;
  // Cash follows the same BOARD scope computeMetrics uses (only a cash
  // holding referenced by a position counts), so this line and the
  // scoreboard's PORTFOLIO agree on it. Securities deliberately do NOT:
  // a sold-out position is off the board but its money moved, and that
  // history is the point. With no positions at all (unit fixtures) the
  // scope opens up, matching computeAt's own escape hatch.
  const positioned = new Set();
  for (const pos of Object.values(portfolio?.positions || {})) {
    for (const t of (pos?.tickers || [])) positioned.add(t);
  }
  const scopeAllCash = positioned.size === 0;

  let value = 0;
  let netDeposit = 0;
  let cashUSD = 0;

  for (const [ticker, h] of Object.entries(portfolio?.holdings || {})) {
    if (h?.isCash || ticker === 'CASH') {
      if (!scopeAllCash && !positioned.has(ticker)) continue;
      if (typeof h?.lastPrice === 'number' && h.lastPrice > 0) cashUSD += h.lastPrice;
      continue;
    }
    const fx = (h?.currency && h.currency !== 'USD') ? fxToUSD(h.currency, marketData) : 1;

    let shares = 0;
    for (const l of (Array.isArray(h?.lots) ? h.lots : [])) {
      const d = String(l?.date || '').slice(0, 10);
      const n = Number(l?.shares);
      const c = Number(l?.cost);
      if (!d || d > day || !isFinite(n) || n <= 0) continue;
      shares += n;
      if (isFinite(c)) netDeposit += n * c * fx;
    }
    for (const sl of (Array.isArray(h?.sells) ? h.sells : [])) {
      const d = String(sl?.date || '').slice(0, 10);
      const n = Number(sl?.shares);
      const px = Number(sl?.price);
      if (!d || d > day || !isFinite(n) || n <= 0) continue;
      shares -= n;
      if (isFinite(px)) netDeposit -= n * px * fx;
    }
    // Float dust from fractional lots (T212 DCA quantities) — the same
    // snap transactions.netPosition applies, so a fully-sold position
    // reads as exactly flat instead of ±5e-17 shares' worth of value.
    if (Math.abs(shares) < 1e-9) shares = 0;
    if (shares <= 0) continue;

    const md = marketData?.[ticker];
    const live = useLive
      ? ((useExt && md?.extPrice != null && md.extPrice > 0) ? md.extPrice : md?.lastPrice)
      : null;
    const price = (typeof live === 'number' && live > 0)
      ? live
      : closeOn(tickerSeries, ticker, date);
    // No price for that date (a ticker whose history didn't reach back
    // this far) → contribute nothing rather than guess. Its deposit
    // still counts: the money did leave the account.
    if (typeof price !== 'number' || !(price > 0)) continue;
    value += shares * price * fx;
  }

  return { value: value + cashUSD, netDeposit: netDeposit + cashUSD };
}

/**
 * Net deposited as of right now — cumulative buys minus sale proceeds,
 * plus cash. What the 5-minute sampler records alongside the portfolio
 * value.
 *
 * Runs the same pass as `investmentPointAt` with the date cutoff opened
 * all the way, so the two can't drift apart in how they treat a lot, a
 * sale or a currency. Prices aren't needed — deposits are cash amounts —
 * so no ticker series is passed and the returned value is discarded.
 */
export function netDepositNow({ portfolio, marketData = {}, fxToUSD }) {
  return investmentPointAt({
    portfolio, tickerSeries: {}, date: '9999-12-31', marketData, fxToUSD,
  }).netDeposit;
}
