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
  '1D':  { yahooRange: '1d',  interval: '5m', label: '1D'  },
  '1W':  { yahooRange: '5d',  interval: '1d', label: '1W'  },
  '1M':  { yahooRange: '1mo', interval: '1d', label: '1M'  },
  '3M':  { yahooRange: '3mo', interval: '1d', label: '3M'  },
  'YTD': { yahooRange: 'ytd', interval: '1d', label: 'YTD' },
};
export const RANGE_KEYS = ['1D', '1W', '1M', '3M', 'YTD'];

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
 *   - 1D  → marketData[ticker].prevClose (yesterday's regular session close)
 *   - YTD → last close strictly before yearStart (prior-year-end close,
 *           Yahoo's YTD baseline)
 *   - 1W/1M/3M → last close strictly before anchorDate, else first close
 *           inside the fetched window
 *
 * @param {Record<string, {date:string, close:number}[]>} hist
 * @param {string} anchorDate    — chart's leftmost cutoff (YYYY-MM-DD)
 * @param {string} rangeKey      — '1D' | '1W' | '1M' | '3M' | 'YTD'
 * @param {Record<string, {prevClose?:number, lastPrice?:number}>} [marketData]
 * @returns {Record<string, {series:{date:string,close:number}[], map:Record<string,number>, janPrice:number|null}>}
 */
export function buildTickerSeries(hist, anchorDate, rangeKey = 'YTD', marketData = {}) {
  /** @type {Record<string, {series:{date:string,close:number}[], map:Record<string,number>, janPrice:number|null}>} */
  const out = {};
  for (const [t, raw] of Object.entries(hist || {})) {
    const series = (raw || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    /** @type {Record<string, number>} */
    const map = {};
    for (const p of series) map[p.date] = p.close;

    let janPrice = null;
    if (rangeKey === '1D') {
      // 1D's anchor is yesterday's regular close — comes from the live
      // marketData snapshot since intraday history doesn't include it.
      const md = marketData[t];
      if (md && typeof md.prevClose === 'number' && md.prevClose > 0) {
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
 *   portfolio: { holdings: Record<string, any> },
 *   tickerSeries: ReturnType<typeof buildTickerSeries>,
 *   marketData?: Record<string, { lastPrice?: number, extPrice?: number | null }>,
 *   yearStart: string,
 *   yearStartDate: string,
 *   todayMs: number,
 *   liveAnchorDate: string,
 *   useExt: boolean,
 *   fxToUSD: (currency: string | undefined, marketData: any) => number,
 * }} opts
 * @returns {{ value: number, basis: number }}
 */
export function computeAt(opts) {
  const {
    date, portfolio, tickerSeries, marketData,
    yearStart, yearStartDate, todayMs, liveAnchorDate, useExt, fxToUSD,
  } = opts;
  const useLive = date === liveAnchorDate;
  let value = 0, basis = 0;

  for (const [ticker, h] of Object.entries(portfolio.holdings)) {
    if (h.isCash || ticker === 'CASH') continue;
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
      if (lot.date > date) continue; // not yet held

      // Basis price for this lot
      let basisPrice;
      if (lot.date < yearStartDate) {
        if (janPrice == null) continue; // skip — no Jan 1 baseline available
        basisPrice = janPrice;
      } else {
        basisPrice = lot.cost;
      }

      // Current price at date — prefer live for the latest chart point
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

      value += lot.shares * priceAtD * fx;
      basis += lot.shares * basisPrice * fx;
    }
  }
  return { value, basis };
}

/**
 * Convenience: compute YTD% from value/basis. Returns 0 when basis is
 * non-positive (degenerate portfolio).
 */
export function ytdPct({ value, basis }) {
  return basis > 0 ? ((value - basis) / basis) * 100 : 0;
}
