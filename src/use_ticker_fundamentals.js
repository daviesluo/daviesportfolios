// Valuation-metadata hook for TickerChartModal, lifted out of the
// 1400-line component. Owns the P/E + P/S support flags, the 3-year-
// average reference values, PEG, and shares-outstanding — everything
// the modal's fundamentals fetch produces. Kept separate from the
// price-series hook because it's a distinct concern AND it feeds
// `visibleRangeKeys` (which the price-series hook in turn consumes), so
// the modal calls this first, derives the button row, then the data
// hook.
//
// Stale-while-revalidate: the `${ticker}|FUND|v3` ChartStore row seeds
// every value synchronously on first render (so the P/E button + Mkt
// Cap line don't pop in a second late), then the Edge Function fetch
// refreshes them and writes the row back. A missing/transient response
// is left alone so it never clobbers a good prefetched value.

import React from 'react';
import { ChartStore } from './chart_store.js';
import { fetchFundamentals } from './yahoo_fetch.js';

/**
 * @param {string} ticker
 * @param {boolean} supportsPePattern  cheap pattern gate (non-fund, non-
 *   index-except-proxied, non-futures/forex/crypto) computed by the modal
 * @returns {{
 *   peSupported: boolean, psSupported: boolean,
 *   pe3yAvg: number|null, ps3yAvg: number|null,
 *   peg: number|null, sharesOut: number|null,
 * }}
 */
export function useTickerFundamentals(ticker, supportsPePattern) {
  // Read the prefetched fundamentals row from dp.tickerChart (key
  // `${ticker}|FUND|v3`) synchronously so the P/E 1Y button + Mkt
  // Cap line can appear on the very first paint instead of "popping
  // in" 1-2 s after the modal opens. Background revalidate still
  // runs below to refresh the row when stale. Returns null on cache
  // miss.
  /** @returns {{ eps?: number, pe?: number, pe3yAvg?: number|null, ps?: number, ps3yAvg?: number|null, peg?: number, ttmEpsHistory?: any[], ttmSalesHistory?: any[], sharesOutstanding?: number } | null} */
  const readFundCache = () => {
    const row = ChartStore.get(`${ticker}|FUND|v3`)?.data;
    return row && typeof row === 'object' ? row : null;
  };
  const fundCached = supportsPePattern ? readFundCache() : null;
  const cachedHasEps = typeof fundCached?.eps === 'number' && fundCached.eps > 0;
  const cachedHasPe  = typeof fundCached?.pe  === 'number' && fundCached.pe  > 0;
  const cachedHasPs  = typeof fundCached?.ps  === 'number' && fundCached.ps  > 0;
  const [peSupported, setPeSupported] = React.useState(cachedHasEps || cachedHasPe);
  // P/S 1Y button is shown for loss-makers — profitable tickers
  // (eps > 0) keep the P/E view since price-to-earnings is the
  // standard valuation metric there. Mutually exclusive with PE.
  const [psSupported, setPsSupported] = React.useState(!cachedHasEps && !cachedHasPe && cachedHasPs);
  // pe3yAvg / ps3yAvg drive the dashed reference line on the
  // P/E 1Y / P/S 1Y charts respectively. Either can come back
  // null when Finnhub's annual series for that ratio is empty
  // (very new IPOs, or tickers where Finnhub couldn't retrieve
  // historicals) — in that case the chart renders without the
  // reference line instead of erroring.
  const [pe3yAvg, setPe3yAvg] = React.useState(
    /** @type {number|null} */ (
      typeof fundCached?.pe3yAvg === 'number' && fundCached.pe3yAvg > 0
        ? fundCached.pe3yAvg
        : null
    ),
  );
  const [ps3yAvg, setPs3yAvg] = React.useState(
    /** @type {number|null} */ (
      typeof fundCached?.ps3yAvg === 'number' && fundCached.ps3yAvg > 0
        ? fundCached.ps3yAvg
        : null
    ),
  );
  // PEG — forward P/E ÷ analyst-consensus 5y EPS-growth CAGR (in
  // percent). Optional sibling of the P/E line in the modal header.
  // Computed server-side from Yahoo's forwardPE + earningsTrend
  // (see computePeg). Null when either input is missing or the
  // growth rate is non-positive (negative growth makes PEG itself
  // meaningless and most data vendors hide it in that case).
  const [peg, setPeg] = React.useState(
    /** @type {number|null} */ (
      typeof fundCached?.peg === 'number' && isFinite(fundCached.peg) && fundCached.peg > 0
        ? fundCached.peg
        : null
    ),
  );
  // Shares outstanding (server-derived as Yahoo's marketCap ÷ price,
  // so it's price-consistent for ADRs). The modal header multiplies
  // it by the live price for a price-synced market cap. null for
  // non-stocks / when Yahoo publishes no market cap.
  const [sharesOut, setSharesOut] = React.useState(
    /** @type {number|null} */ (
      typeof fundCached?.sharesOutstanding === 'number' && fundCached.sharesOutstanding > 0
        ? fundCached.sharesOutstanding
        : null
    ),
  );
  React.useEffect(() => {
    if (!supportsPePattern) {
      setPeSupported(false); setPe3yAvg(null);
      setPsSupported(false); setPs3yAvg(null);
      setPeg(null); setSharesOut(null);
      return;
    }
    let cancelled = false;
    // Stale-while-revalidate: synchronous cache read above already
    // seeded peSupported / psSupported / pe3yAvg / ps3yAvg, so the
    // buttons are visible (or hidden) at first paint. This fetch
    // refreshes the values from the Edge Function in the background
    // and falls through silently on failure — never clobbers a usable
    // cache with a no-op.
    fetchFundamentals([ticker]).then(f => {
      if (cancelled) return;
      const row = f?.[ticker];
      // Guard against a missing / transient-failure response: if the
      // Edge Function timed out, rate-limited, or returned `{}`, `row`
      // is undefined. Writing an empty FUND cache row here would
      // overwrite a perfectly good prefetched value AND fool the next
      // prefetch's freshness check (which keys off ts, not contents)
      // into skipping the repair. Bail silently — the prefetched
      // values that seeded the state above stay intact.
      if (!row || typeof row !== 'object') return;
      const eps = row.eps;
      const pe  = row.pe;
      const ps  = row.ps;
      // ETF proxies (^GSPC/^NDX/^RUT → SPY/QQQ/IWM) have no aggregate
      // EPS in Finnhub's free tier; the Edge Function returns eps:0
      // there. Treat the row as "PE supported" if EITHER eps > 0 OR
      // pe > 0 — the client reconstructs an implied EPS from the
      // last close ÷ pe so the P/E series is still drawable.
      // P/S only fires when neither pe nor eps is usable (loss-maker)
      // AND ps is present, so the two buttons don't both show up.
      const hasEps = typeof eps === 'number' && eps > 0;
      const hasPe  = typeof pe  === 'number' && pe  > 0;
      const hasPs  = typeof ps  === 'number' && ps  > 0;
      const peOk = hasEps || hasPe;
      setPeSupported(peOk);
      setPsSupported(!peOk && hasPs);
      const peAvg = row.pe3yAvg;
      const psAvg = row.ps3yAvg;
      const pegV  = row.peg;
      const shrV  = row.sharesOutstanding;
      setPe3yAvg(typeof peAvg === 'number' && isFinite(peAvg) && peAvg > 0 ? peAvg : null);
      setPs3yAvg(typeof psAvg === 'number' && isFinite(psAvg) && psAvg > 0 ? psAvg : null);
      setPeg(typeof pegV === 'number' && isFinite(pegV) && pegV > 0 ? pegV : null);
      setSharesOut(typeof shrV === 'number' && isFinite(shrV) && shrV > 0 ? shrV : null);
      // Write back to the FUND cache so a subsequent modal open hits
      // synchronously even when the prefetch pass didn't cover this
      // particular ticker (drilldown into an MC card the prefetch
      // didn't include, etc.).
      ChartStore.set(`${ticker}|FUND|v3`, { ts: Date.now(), data: row });
    });
    return () => { cancelled = true; };
  }, [ticker, supportsPePattern]);

  return { peSupported, psSupported, pe3yAvg, ps3yAvg, peg, sharesOut };
}
