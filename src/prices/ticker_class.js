// Single source of truth for "what kind of ticker is this?" — was
// previously duplicated as bespoke regexes across modal / prefetch /
// header_sidebar / utils, which drifted (e.g. one place forgot CN
// funds in its "daily-only" check). All predicates here are pure and
// case-insensitive where the underlying convention permits.

/** @param {string} ticker */ export const isCrypto    = (ticker) => /-USD$/i.test(ticker);
/** @param {string} ticker */ export const isFutures   = (ticker) => /=F$/.test(ticker);
/** @param {string} ticker */ export const isForex     = (ticker) => /=X$/.test(ticker);
/** @param {string} ticker */ export const isIndex     = (ticker) => /^\^/.test(ticker);
/** @param {string} ticker */ export const isExchangeListed = (ticker) => /\.[A-Z]+$/.test(ticker);
/** @param {string} ticker */ export const isCnFund    = (ticker) => /^\d{6}$/.test(ticker);
/** @param {string} ticker */ export const isPvt       = (ticker) => /\.PVT$/i.test(ticker);

/**
 * Continental-European exchange listings (Yahoo suffixes) — the euro-zone
 * subset of isExchangeListed: Euronext (.PA Paris / .AS Amsterdam / .BR
 * Brussels / .LS Lisbon / .IR Dublin), the German venues (XETRA .DE,
 * Frankfurt .F, Stuttgart .SG, Berlin .BE, Düsseldorf .DU, Hamburg .HM,
 * Hanover .HA, Munich .MU), Milan (.MI), Madrid (.MC), Vienna (.VI),
 * Helsinki (.HE), Athens (.AT). Single source for the euro suffix list —
 * fx.detectCurrency maps the SAME set to the EUR currency. Like `.L`,
 * these venues have no US-style pre/after session, so computeMetrics uses
 * this to gate the ext-hours toggle to 0 while the local exchange is
 * closed. Deliberately excludes the non-euro European venues (.ST
 * Stockholm / .OL Oslo / .CO Copenhagen / .SW Switzerland) — different
 * currencies, no FX pair wired up.
 * @param {string} ticker
 */
export const isEuroExchange = (ticker) => /\.(PA|AS|BR|LS|IR|MI|MC|DE|F|SG|BE|DU|HM|HA|MU|VI|HE|AT)$/i.test(ticker || '');

/**
 * Tickers that only have a single daily NAV / close (no intraday
 * bars from Yahoo). CN mutual funds publish 1 NAV / trading day via
 * eastmoney; .PVT placeholders are user-defined holdings with no
 * market data at all. Both flip the modal and prefetch to a
 * daily-only fetch shape.
 * @param {string} ticker
 */
/**
 * How much of the week does this instrument actually trade?
 *
 *   'all'      — round the clock, seven days: crypto.
 *   'weekdays' — round the clock Monday to Friday, no nightly close:
 *                 futures and spot FX.
 *   'session'  — one session a day: indices, listed equities, funds.
 *
 * The 3M chart reads this to choose its x grid. `all` and `weekdays`
 * are drawn on the four-hour London grid — six samples per trading day,
 * every one of them a live price — over the days that instrument trades.
 * A `session` instrument is left on its hourly bars: on that grid it
 * would land on two live prices a day and carry the previous close
 * through the other four, which is a staircase, not a chart.
 *
 * @param {string} ticker
 * @returns {'all'|'weekdays'|'session'}
 */
export function tradingWeekOf(ticker) {
  if (isCrypto(ticker)) return 'all';
  if (isFutures(ticker) || isForex(ticker)) return 'weekdays';
  return 'session';
}

export const isDailyOnly = (ticker) => isCnFund(ticker) || isPvt(ticker);

/**
 * "Plain" US equity / ETF — no exchange suffix, no class marker.
 * Used by the VWAP overlay to pick the 9:30 ET reset anchor vs the
 * 00:00 UTC anchor that everything else uses.
 * @param {string} ticker
 */
export const isUsEquity = (ticker) =>
  !!ticker &&
  !isCrypto(ticker) &&
  !isFutures(ticker) &&
  !isForex(ticker) &&
  !isIndex(ticker) &&
  !isExchangeListed(ticker) &&
  !isCnFund(ticker) &&
  !isPvt(ticker);

// US-shaped tickers that have NO overnight ("night market") session —
// OTC ADRs like SoftBank (SFTBY) / Murata (MRAAY) quote only their
// regular US session, so T212 has no live overnight print for them.
// Without this exclusion the overnight heartbeat dot + T212 night-price
// override would surface a stale RTH/AH close as if it were a live
// overnight quote. Treated like the LSE ETFs: regular-session bars only.
// Compared upper-cased so case never matters. Add OTC ADRs here as they
// enter the book.
const NO_OVERNIGHT_SESSION = new Set(['SFTBY', 'MRAAY']);

/**
 * True for a US equity that ALSO trades a T212 overnight session — i.e.
 * eligible for the night-market heartbeat dot + T212 overnight price
 * override. Excludes OTC ADRs (e.g. SFTBY) that quote only their
 * regular session. Everything `isUsEquity` excludes (LSE/CN/crypto/…)
 * is excluded here too.
 * @param {string} ticker
 */
export const hasOvernightSession = (ticker) =>
  isUsEquity(ticker) && !NO_OVERNIGHT_SESSION.has((ticker || '').toUpperCase());

/**
 * True for tickers with NO US-style extended-hours (pre / post / overnight)
 * session: every foreign exchange listing (`.L` / `.HK` / euro suffixes —
 * isExchangeListed) AND the US-shaped OTC ADRs above. The chart modal uses
 * this to mark only the previous-session close on the 1D view (no OPEN
 * line), since "today's open" is just where the single daily session
 * resumes and the US-close-time marker doesn't match these markets.
 * @param {string} ticker
 */
export const isRegularSessionOnly = (ticker) =>
  isExchangeListed(ticker) || (isUsEquity(ticker) && !hasOvernightSession(ticker));

// Venue day-session frames for SPARSE-TAPE listings. Yahoo emits a 5-min
// bar only for buckets with an actual trade, so an illiquid venue listing
// charts as a line that dies at its last print (2DG.F traded to a 17:30
// last print on a day its venue was open to 21:00 UK). For these the 1D
// chart is rendered on a fixed session GRID — `fillVenueSessionGrid`
// (ytd.js) lays the Yahoo bars onto 5-min slots from `startMin` to
// `endMin` in the venue's wall-clock `tz` and carries the last close flat
// through the gaps, so the x-axis always spans the whole session.
// 2DG.F = Sivers Semiconductors' Frankfurt line; the user-visible session
// is 07:00–21:00 Europe/London.
const VENUE_SESSIONS = {
  '2DG.F': { tz: 'Europe/London', startMin: 7 * 60, endMin: 21 * 60 },
};

/**
 * The fixed 1D session frame for a sparse-tape venue listing, or null for
 * everything else (normal tickers keep Yahoo's own bar coverage).
 * @param {string} ticker
 * @returns {{tz: string, startMin: number, endMin: number} | null}
 */
export const venueSessionFor = (ticker) =>
  VENUE_SESSIONS[(ticker || '').toUpperCase()] || null;
