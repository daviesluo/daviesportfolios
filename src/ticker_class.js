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
 * Tickers that only have a single daily NAV / close (no intraday
 * bars from Yahoo). CN mutual funds publish 1 NAV / trading day via
 * eastmoney; .PVT placeholders are user-defined holdings with no
 * market data at all. Both flip the modal and prefetch to a
 * daily-only fetch shape.
 * @param {string} ticker
 */
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
// OTC ADRs like SoftBank (SFTBY) quote only their regular US session,
// so T212 has no live overnight print for them. Without this exclusion
// the overnight heartbeat dot + T212 night-price override would surface
// a stale RTH/AH close as if it were a live overnight quote. Treated
// like the LSE ETFs: regular-session bars only. Compared upper-cased so
// case never matters.
const NO_OVERNIGHT_SESSION = new Set(['SFTBY']);

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
