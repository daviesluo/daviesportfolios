// Single-ticker price-history modal. X axis = time, Y axis = price.
// Hover crosshair shows the price/time/% at the cursor's nearest data
// point with dashed lines down to both axes. Same range buttons as the
// portfolio chart (1D / 1W / 1M / 3M / YTD). Used when the user taps a
// player in non-edit mode — edit mode keeps opening the EditTickerModal.
import React from 'react';
import { Modal } from './modals.jsx';
import { fetchHistoricalBatch, fetchFundamentals, Storage, usMarketHoursUtc } from './utils.js';
import { fxToUSD } from './fx.js';
import { fmtPrice as fmtPr, fmtPct as fmP, fmtMoney as fmtMo, pctColor as pcC, maskDigits } from './formatters.js';
import { RANGES, RANGE_KEYS, fetchParamsFor, maFetchParamsFor, filterToLatestDay, filterToLast24h } from './ytd.js';
import { isCnFund as isCnFundT, isPvt as isPvtT, isDailyOnly as isDailyOnlyT } from './ticker_class.js';
import { MA_TTL_MS, tickerChartCacheKey, isFresh as cacheIsFresh, hasAnyNumericField } from './cache.js';
import { ChartStore, MaStore } from './chart_store.js';
import {
  maBarsFor, maLabelDaysFor, computeMaSeries,
  vwapSessionResetFor, vwapSessionKeyOf, computeVwap,
  priceDividedByTtmEps, extPriceIsRealAh, isPriceAxis,
} from './indicators.js';
import { reportError } from './ops_error.js';

const SYMBOL_BY_CUR = { USD: '$', GBP: '£', CNY: '¥', HKD: 'HK$' };

// Friendly modal-title names for non-stock tickers. Stocks just show
// the ticker symbol since the company name isn't carried anywhere in
// the holdings shape; indices/futures/forex/yields all have ASCII
// tickers that mean nothing to a human and benefit from a label.
const TICKER_DISPLAY_NAMES = {
  '^GSPC':    'S&P 500',
  '^NDX':     'NASDAQ 100',
  '^RUT':     'Russell 2000',
  '^SOX':     'PHLX SOX',
  '^VIX':     'VIX',
  '^TNX':     'US 10Y Yield',
  'BZ=F':     'Brent Oil',
  'ES=F':     'S&P Futures',
  'NQ=F':     'Nasdaq Futures',
  'RTY=F':    'R2K Futures',
  'GBPUSD=X': 'GBP/USD',
  'GBPCNY=X': 'GBP/CNY',
  'USDCNY=X': 'USD/CNY',
};

// Indices we still surface a P/E YTD chart for, via the fundamentals
// Edge Function's INDEX_ETF_PROXY mapping (^GSPC→SPY, ^NDX→QQQ,
// ^RUT→IWM, ^SOX→SOXX). Other ^-prefixed tickers (^VIX, ^TNX) don't
// have a meaningful EPS so the button stays hidden.
const INDEX_PE_ALLOWED = new Set(['^GSPC', '^NDX', '^RUT', '^SOX']);

const FX_4DP = new Set(['GBPUSD=X', 'GBPCNY=X', 'USDCNY=X']);

// Per-ticker price formatter. Indices / futures / forex / yields don't
// carry a currency symbol; yields are rendered as percentages; the two
// FX pairs the app shows always need 4 dp. Stocks fall through to the
// currency-prefixed format the modal had before.
function fmtTickerPrice(price, ticker, sym) {
  if (price == null || !isFinite(price)) return '—';
  if (ticker === '^TNX') return price.toFixed(2) + '%';
  if (FX_4DP.has(ticker)) return price.toFixed(4);
  if (/=X$/.test(ticker)) return price.toFixed(4);
  if (/^\^/.test(ticker) || /=F$/.test(ticker)) return fmtPr(price);
  return `${sym}${fmtPr(price)}`;
}

// Persistent fetch cache so re-opening the modal — even after a page
// reload — is instant. The previous in-memory Map reset on every load,
// so cold starts always paid the full Edge Function + proxy round-trip
// even when the user had viewed the same ticker minutes earlier.
// TTL is matched to each range's bar interval so we don't refetch faster
// than the source can publish a new bar:
//   1D   → 5  m bars  →  5 m TTL
//   1W   → 30 m bars  → 30 m TTL
//   1M   → 60 m bars  →  1 h TTL
//   3M   →  1 d bars  → 12 h TTL
//   YTD  →  1 d bars  → 12 h TTL
function modalTtl(rangeKey) {
  if (rangeKey === '1D') return  5 * 60 * 1000;
  if (rangeKey === '1W') return 30 * 60 * 1000;
  if (rangeKey === '1M') return 60 * 60 * 1000;
  return                       12 * 60 * 60 * 1000;
}
// Cache I/O routes through `ChartStore` (chart_store.js), which is
// IndexedDB-backed via idb-keyval with a synchronous in-memory
// mirror. Reads stay sync (the modal's useState initializer needs
// them on the first paint); writes update the mirror immediately
// and persist to IDB in the background. localStorage's ~5 MB quota
// no longer applies — the prefetch can warm everything for every
// portfolio + MC ticker × every range × every variant without
// thrashing.
function modalCacheGet(key) {
  return ChartStore.get(key); // { ts, data } | null
}
function modalCacheSet(key, data) {
  ChartStore.set(key, { ts: Date.now(), data });
}

// Ticker classification predicates moved to `src/ticker_class.js` so
// the modal, prefetch, header_sidebar, etc. all share one definition
// of "CN fund" / ".PVT" / "daily-only". CN funds publish one NAV per
// trading day so 1D / 1W (5 m / 30 m intraday) ranges have no
// meaningful data; .PVT placeholders aren't on Yahoo at all. Both
// restrict the modal to daily buttons.

export function TickerChartModal({ ticker, holding, marketData, extendedHours, phase, onClose, portfolioTotalValue, hideValues }) {
  const isCnFund = isCnFundT(ticker);
  const isPvt    = isPvtT(ticker);
  const dailyOnly = isDailyOnlyT(ticker);
  // 'PE' is a synthetic range button — same YTD daily prices but the
  // y-axis becomes a P/E ratio (price ÷ current TTM EPS). Two-stage
  // filter:
  //   1. Cheap pattern check rules out tickers that obviously can't
  //      have a meaningful EPS (CN funds, .PVT, futures, indices,
  //      crypto, forex). Keeps the button-render initial state stable.
  //   2. Async fundamentals fetch on modal open. ETFs / loss-makers /
  //      anything Yahoo doesn't have a positive trailingEps for set
  //      `peSupported` to false and the button stays hidden.
  // ^GSPC / ^NDX / ^RUT are supported via the Edge Function's index→ETF
  // proxy (Finnhub doesn't carry indices, but SPY/QQQ/IWM publish a
  // trailing P/E that's a reasonable stand-in for the underlying basket).
  // Other ^-prefixed tickers (VIX, SOX, TNX) and futures / forex are
  // ruled out at the pattern stage.
  const supportsPePattern = !dailyOnly
    && (!/^\^/.test(ticker) || INDEX_PE_ALLOWED.has(ticker))
    && !/=F$/.test(ticker)
    && !/=X$/.test(ticker)
    && !/[-]USD$/i.test(ticker);
  // Read the prefetched fundamentals row from dp.tickerChart (key
  // `${ticker}|FUND|v2`) synchronously so the P/E YTD button can
  // appear on the very first paint instead of "popping in" 1-2 s
  // after the modal opens. Background revalidate still runs below
  // to refresh the row when stale. Returns null on cache miss.
  /** @returns {{ eps?: number, pe?: number, pe3yAvg?: number|null, ps?: number, ps3yAvg?: number|null, peg?: number, ttmEpsHistory?: any[], ttmSalesHistory?: any[] } | null} */
  const readFundCache = () => {
    const row = ChartStore.get(`${ticker}|FUND|v2`)?.data;
    return row && typeof row === 'object' ? row : null;
  };
  const fundCached = supportsPePattern ? readFundCache() : null;
  const cachedHasEps = typeof fundCached?.eps === 'number' && fundCached.eps > 0;
  const cachedHasPe  = typeof fundCached?.pe  === 'number' && fundCached.pe  > 0;
  const cachedHasPs  = typeof fundCached?.ps  === 'number' && fundCached.ps  > 0;
  const [peSupported, setPeSupported] = React.useState(cachedHasEps || cachedHasPe);
  // P/S YTD button is shown for loss-makers — profitable tickers
  // (eps > 0) keep the P/E view since price-to-earnings is the
  // standard valuation metric there. Mutually exclusive with PE.
  const [psSupported, setPsSupported] = React.useState(!cachedHasEps && !cachedHasPe && cachedHasPs);
  // pe3yAvg / ps3yAvg drive the dashed reference line on the
  // P/E YTD / P/S YTD charts respectively. Either can come back
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
  React.useEffect(() => {
    if (!supportsPePattern) {
      setPeSupported(false); setPe3yAvg(null);
      setPsSupported(false); setPs3yAvg(null);
      setPeg(null);
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
      setPe3yAvg(typeof peAvg === 'number' && isFinite(peAvg) && peAvg > 0 ? peAvg : null);
      setPs3yAvg(typeof psAvg === 'number' && isFinite(psAvg) && psAvg > 0 ? psAvg : null);
      setPeg(typeof pegV === 'number' && isFinite(pegV) && pegV > 0 ? pegV : null);
      // Write back to the FUND cache so a subsequent modal open hits
      // synchronously even when the prefetch pass didn't cover this
      // particular ticker (drilldown into an MC card the prefetch
      // didn't include, etc.).
      ChartStore.set(`${ticker}|FUND|v2`, { ts: Date.now(), data: row });
    });
    return () => { cancelled = true; };
  }, [ticker, supportsPePattern]);
  // P/E and P/S are mutually exclusive — append whichever applies.
  const valuationRange = peSupported ? ['PE'] : (psSupported ? ['PS'] : []);
  const visibleRangeKeys = dailyOnly
    ? ['1M', '3M', 'YTD']
    : [...RANGE_KEYS, ...valuationRange];
  // CN funds publish 1 NAV / day; .PVT placeholders don't trade on
  // public exchanges. Both default to 1M so the user sees something
  // immediately rather than landing on an intraday view that's empty.
  const [rangeKey, setRangeKey] = React.useState(dailyOnly ? '1M' : '1D');
  // Convenience flag for renderers that share behaviour across the
  // two ratio views (axis label, 3Y AVG reference line, header copy).
  const isRatioRange = rangeKey === 'PE' || rangeKey === 'PS';
  // Seed series + loading state from the localStorage cache up front
  // so a warm-cache open doesn't flash a spinner. Reading on first
  // paint means the chart paints from cache on the very first render
  // — without this the useEffect below runs after the first render
  // and React shows the spinner for one frame (long enough to feel
  // like "loading 一段时间" on a phone). The useEffect still runs to
  // background-revalidate when stale, so this is purely a paint
  // latency improvement.
  const initialRangeKey = dailyOnly ? '1M' : '1D';
  // useExt is computed below; inline the same expression here so we
  // don't fight the TDZ ordering — they're cheap.
  const initialUseExt   = !!(extendedHours && phase && phase !== 'regular');
  const initialCacheKey = tickerChartCacheKey(ticker, initialRangeKey, initialUseExt, phase);
  const initialCached   = (() => {
    const row = ChartStore.get(initialCacheKey);
    return row && Array.isArray(row.data) && row.data.length >= 2 ? row : null;
  })();
  const [series, setSeries]     = React.useState(
    /** @type {Array<{date:string,close:number,volume?:number}>|null} */
    (initialCached ? initialCached.data : null),
  );
  const [loading, setLoading]   = React.useState(!initialCached);
  const [error, setError]       = React.useState(false);
  // Distinct from `error`: this is the legitimate "this ticker has
  // no positive trailing P/E to chart" state — loss-makers (NBIS,
  // any pre-profit IPO), ETF proxies where Finnhub has no
  // aggregate EPS, etc. Different copy than the network-failure
  // error panel, and we don't fire ops-error for it (it's not a bug).
  const [noPe, setNoPe]         = React.useState(false);
  // Wider sister-fetch for the moving-average overlay. Same Yahoo
  // interval as the chart's display fetch so timestamps line up
  // bar-for-bar — the MA at each display bar is then a Map lookup
  // and not a daily-resample. Wider in time so the rolling window
  // is satisfied even at the chart's leftmost bar.
  // Stored sorted ascending as `[{date, close}, …]`.
  const [maHistory, setMaHistory] = React.useState(/** @type {Array<{date:string,close:number}>|null} */ (null));

  const useExt = !!(extendedHours && phase && phase !== 'regular');

  // Pick (yahooRange, interval, includePrePost) based on the user's choice.
  // Single-ticker fetch params are now shared with the portfolio chart
  // via fetchParamsFor() in ytd.js — both charts now use intraday
  // intervals on 1W (30 m) and 1M (60 m) so the line has enough bars
  // to read at a glance, and 1D's three sub-modes (ext OFF + open,
  // ext OFF + closed, ext ON) live in one place rather than duplicated
  // here.
  // Override fetchParamsFor's intraday interval to '1d' for tickers
  // that only have daily data (CN funds publish 1 NAV / day; .PVT
  // private tickers don't have intraday bars on Yahoo, so a 1mo/60m
  // request returns empty and the chart shows "Couldn't load history"
  // even when daily data exists for the same range). 'PE' uses YTD
  // daily prices under the hood — the y-axis transformation happens
  // after fetch.
  const fetchParams = (rk) => {
    if (rk === 'PE' || rk === 'PS') {
      const p = fetchParamsFor('YTD', extendedHours, phase);
      return { ...p, interval: '1d', includePrePost: false };
    }
    const p = fetchParamsFor(rk, extendedHours, phase);
    return dailyOnly ? { ...p, interval: '1d', includePrePost: false } : p;
  };

  React.useEffect(() => {
    let cancelled = false;
    const { yahooRange, interval, includePrePost } = fetchParams(rangeKey);
    // Cache key shape lives in cache.js (`tickerChartCacheKey`) so the
    // prefetch can't drift. Non-1D / non-PE ranges drop variant +
    // phase from the key — the fetched data is identical across
    // phase/toggle combos for those ranges, and including phase used
    // to invalidate the whole prefetched cache at every 16:00 ET
    // boundary.
    const cacheKey = tickerChartCacheKey(ticker, rangeKey, useExt, phase);
    const ttl = modalTtl(rangeKey);
    const cached = modalCacheGet(cacheKey);

    // Stale-while-revalidate: if there's any cached data, paint it
    // immediately. Within TTL we trust it and stop. Stale entries get
    // shown but a background refetch updates them in place — no spinner.
    let needsFresh = !cached;
    if (cached && Array.isArray(cached.data) && cached.data.length >= 2) {
      setSeries(cached.data);
      setLoading(false);
      setError(false);
      setNoPe(false);
      const ageMs = Date.now() - (cached.ts || 0);
      if (ageMs >= ttl) needsFresh = true;
      // Volume was added to intraday bars after this app shipped.
      // Old 1D cache rows that pre-date the redeploy still satisfy
      // the freshness window but have no `volume` field on any bar,
      // so the VWAP overlay silently disappears. Detect that and
      // force a refetch — the fresh response from the redeployed
      // Edge Function carries volume and the overlay re-appears.
      if (rangeKey === '1D' && !cached.data.some(p => typeof p.volume === 'number')) {
        needsFresh = true;
      }
    } else {
      setLoading(true);
      setError(false);
      setNoPe(false);
    }
    if (!needsFresh) return;

    (async () => {
      // Yahoo's CORS-proxy chain plus the Edge Function path together
      // are flaky enough that one fetch can drop where a quick retry
      // succeeds. 3 attempts with short backoff catches the recoverable
      // cases without making the spinner feel endless when the symbol
      // really is unfetchable.
      let data = null;
      for (let attempt = 0; attempt < 3 && !data; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 250 * attempt));
        if (cancelled) return;
        const out = await fetchHistoricalBatch([ticker], yahooRange, interval, includePrePost);
        if (cancelled) return;
        if (out[ticker] && out[ticker].length >= 2) data = out[ticker];
      }
      if (!data) {
        reportError('fetch.histsingle', {
          symbol: ticker,
          message: 'all attempts returned no data',
          context: { range: yahooRange, interval, includePrePost, attempts: 3 },
        });
        // Only surface the error if we have nothing to show. If we're
        // revalidating a stale cache hit, keep the chart on screen.
        if (!cached) {
          setError(true);
          setLoading(false);
        }
        return;
      }
      const params = fetchParamsFor(isRatioRange ? 'YTD' : rangeKey, extendedHours, phase);
      if (params.variant === 'closed') data = filterToLatestDay(data);
      else if (params.variant === 'reg' || params.variant === 'ext') data = filterToLast24h(data);
      // 'PE' / 'PS' transform: divide each historical close by the
      // rolling TTM per-share denominator as of that price date so
      // the chart actually *moves* on earnings days instead of being
      // a 1:1 scale of the price chart. The Edge Function returns
      // both histories from Yahoo's fundamentals-timeseries —
      // `ttmEpsHistory` (trailing diluted EPS) for P/E and
      // `ttmSalesHistory` (trailing revenue, rescaled to USD
      // sales-per-share) for P/S — each an already-summed TTM value
      // at every quarter end, 5+ years deep. For each price date we
      // pick the latest entry whose `quarterEnd + 45-day report lag`
      // is <= the price date. Falls back to the const current-ratio
      // path when (a) Yahoo didn't return a history (rate limit or
      // sparse coverage), (b) the price date predates the earliest
      // reported quarter, or (c) the Edge Function is on an older
      // version that doesn't yet emit the history field.
      if (isRatioRange) {
        // Mirror the 3-attempt retry policy fetchHistoricalBatch uses
        // a few lines up: the fundamentals chain (FMP → Yahoo
        // quoteSummary → Yahoo chart → Finnhub) is just as flaky
        // single-shot, and a single Yahoo / FMP burp would otherwise
        // drop the whole modal into the "Couldn't load history" state
        // AND fire fetch.pe.network-drop in ops-error. Most of those
        // turned out to be transient when checked manually.
        let row;
        for (let attempt = 0; attempt < 3 && !row; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 250 * attempt));
          if (cancelled) return;
          const fundamentals = await fetchFundamentals([ticker], { ttmEpsHistory: true });
          if (cancelled) return;
          row = fundamentals?.[ticker];
        }
        // Three terminal states for this branch:
        //   (a) `row` absent — the Edge Function dropped this ticker
        //       entirely (5xx, network drop, Yahoo/FMP/Finnhub all
        //       returned null). REAL infra failure worth logging in
        //       ops-error so chronic backend instability surfaces in
        //       the admin badge. UI shows the standard error panel.
        //   (b) `row` present but the active ratio (pe / ps) ≤ 0 —
        //       legitimate "this ticker has no positive trailing
        //       ratio" case (loss-makers, ETF proxies where Finnhub
        //       has no aggregate EPS, brand-new IPOs with no revenue
        //       history). NOT a bug — fire no ops-error and show a
        //       softer "P/X not available" copy instead of the red
        //       error panel.
        //   (c) row carries a usable ratio — happy path: derive the
        //       per-share denominator from `lastClose / ratio` and
        //       run priceDividedByTtmEps.
        //
        // Force-derive the denominator from `lastClose / ratio`
        // whenever a ratio is available. For P/E that's how we dodge
        // FMP's ADR eps-currency mismatch (TSM 30.79 USD pe ÷ 74.38
        // TWD eps was the original 1.22 bug); for P/S it's how we
        // stay USD-correct without re-pulling revenue figures.
        if (!row || typeof row !== 'object') {
          // (a) — infra failure.
          reportError('fetch.pe.network-drop', {
            symbol: ticker,
            message: 'fundamentals Edge Function returned no row for this ticker',
            context: { ratio: rangeKey },
          });
          if (!cached) { setError(true); setLoading(false); }
          return;
        }
        const isPe = rangeKey === 'PE';
        const ratio = isPe ? row.pe : row.ps;
        let denom = isPe ? row.eps : null;  // PS has no published denominator field
        if (typeof ratio === 'number' && ratio > 0 && data.length > 0) {
          denom = data[data.length - 1].close / ratio;
        }
        if (!denom || denom <= 0) {
          // (b) — legitimate no-ratio state. Soft UI, no ops-error.
          if (!cached) {
            setNoPe(true);
            setError(false);
            setSeries([]);
            setLoading(false);
          }
          return;
        }
        // priceDividedByTtmEps steps the ratio at each earnings date
        // when given a TTM history, else falls back to `denom` for
        // every bar. P/E gets ttmEpsHistory, P/S gets ttmSalesHistory
        // (both from the Edge Function); a null/absent history → the
        // const-denominator path, same as before the field existed.
        data = priceDividedByTtmEps(data, isPe ? row.ttmEpsHistory : row.ttmSalesHistory, denom);
      }
      modalCacheSet(cacheKey, data);
      setSeries(data);
      setLoading(false);
      setError(false);
      setNoPe(false);
    })();
    return () => { cancelled = true; };
  }, [ticker, rangeKey, useExt, phase]);

  // Background prefetch the other ranges once the user's chosen range has
  // landed. Range-button clicks then hit the in-memory cache for an
  // instant swap. Sequential, fire-and-forget — failures just leave the
  // MA-history fetch — SAME interval as the chart's display fetch
  // (so timestamps line up exactly), wider time range so the rolling
  // window is satisfied at every displayed bar. Centralised in
  // `maFetchParamsFor` so the modal and the background prefetch
  // agree on which (range, interval) tuple to fetch + cache under.
  // 1D and PE skip (no MA overlay).
  //
  // Cache layer (`dp.tickerChart` under key `${ticker}|MA|${range}`):
  // stale-while-revalidate, 12 h TTL. If a cache row is present it
  // paints immediately (no spinner); under TTL we skip the network
  // entirely; over TTL we still paint the stale data and refetch
  // silently in the background. Background prefetch warms this same
  // cache on initial app load and on Refresh, so opening the modal
  // is normally instant — the per-ticker MA fetches no longer pile
  // up on first interaction.
  React.useEffect(() => {
    const params = maFetchParamsFor(rangeKey, dailyOnly);
    if (!params) { setMaHistory(null); return; }
    const cacheKey = `${ticker}|MA|${rangeKey}`;
    // MA cache lives in `MaStore` (dp.maCache via IndexedDB) so its
    // ~12 h-TTL rows can persist independently of the chart-display
    // cache; previously this mattered because both shared a tight
    // localStorage LRU, but with IDB capacity is no longer an issue.
    const cached = MaStore.get(cacheKey);
    let isFresh = false;
    if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
      setMaHistory(cached.data);
      isFresh = (Date.now() - (cached.ts || 0)) < MA_TTL_MS;
    } else {
      setMaHistory(null);
    }
    if (isFresh) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const out = await fetchHistoricalBatch([ticker], params.range, params.interval, false);
        if (cancelled) return;
        const data = out?.[ticker];
        if (!Array.isArray(data) || data.length === 0) return;
        const sorted = data
          .filter(p => typeof p.date === 'string' && isFinite(Number(p.close)) && p.close > 0)
          .slice()
          .sort((a, b) => a.date < b.date ? -1 : 1);
        if (sorted.length === 0) return;
        setMaHistory(sorted);
        MaStore.set(cacheKey, { ts: Date.now(), data: sorted });
      } catch { /* leave the stale cached series in place */ }
    })();
    return () => { cancelled = true; };
  }, [ticker, rangeKey, dailyOnly]);

  // cache untouched and the next click pays the normal fetch cost.
  // Per-modal range prefetch: as soon as the current range has
  // rendered (loading=false, error=false, series set), kick off
  // PARALLEL fetches for every OTHER range so subsequent range
  // clicks hit cache instead of paying a cold fetch. Each fetch
  // short-circuits if its cache entry is still fresh, so the
  // typical post-global-prefetch case is mostly no-ops.
  //
  // Previously this loop was sequential — clicking a ticker that
  // the global prefetch missed meant the user could click 1W
  // before the modal had fetched it, paying a fresh load. Going
  // parallel lets all 4-5 ranges (1W / 1M / 3M / YTD / PE) settle
  // in roughly the time of the slowest one (~1-3 s) instead of
  // summing them serially (~5-15 s).
  React.useEffect(() => {
    if (loading || error || !series) return;
    const others = visibleRangeKeys.filter(k => k !== rangeKey);
    let cancelled = false;
    Promise.all(others.map(async (rk) => {
      if (cancelled) return;
      let yahooRange, interval, includePrePost, variant;
      const isPeRk = rk === 'PE';
      const isPsRk = rk === 'PS';
      const isRatioRk = isPeRk || isPsRk;
      if (isRatioRk) {
        const p = fetchParamsFor('YTD', extendedHours, phase);
        yahooRange = p.yahooRange; interval = '1d'; includePrePost = false; variant = p.variant;
      } else {
        const baseParams = fetchParamsFor(rk, extendedHours, phase);
        ({ yahooRange, interval, includePrePost, variant } = dailyOnly
          ? { ...baseParams, interval: '1d', includePrePost: false }
          : baseParams);
      }
      const cacheKey = tickerChartCacheKey(ticker, rk, useExt, phase);
      const ttl = modalTtl(rk);
      const c = modalCacheGet(cacheKey);
      if (c && Array.isArray(c.data) && (Date.now() - (c.ts || 0)) < ttl) return;
      const out = await fetchHistoricalBatch([ticker], yahooRange, interval, includePrePost);
      if (cancelled) return;
      let data = out[ticker];
      if (!data || data.length < 2) return;
      if (variant === 'closed') data = filterToLatestDay(data);
      else if (variant === 'reg' || variant === 'ext') data = filterToLast24h(data);
      if (isRatioRk) {
        const f = await fetchFundamentals([ticker], { ttmEpsHistory: true });
        if (cancelled) return;
        const row = f?.[ticker];
        // See main effect above — derive the per-share denominator
        // from lastClose / ratio so the ADR currency mismatch in
        // FMP's `eps` field doesn't poison the P/E chart, and so the
        // P/S chart uses a USD-correct sales-per-share regardless of
        // which upstream supplied `ps`.
        const ratio = isPeRk ? row?.pe : row?.ps;
        let denom = isPeRk ? row?.eps : null;
        if (typeof ratio === 'number' && ratio > 0 && data.length > 0) {
          denom = data[data.length - 1].close / ratio;
        }
        if (!denom || denom <= 0) return;
        // For PE pass ttmEpsHistory, for PS pass ttmSalesHistory, so
        // both curves step on earnings dates instead of tracking
        // price 1:1. null/absent history → const-denominator path.
        data = priceDividedByTtmEps(data, isPeRk ? row?.ttmEpsHistory : row?.ttmSalesHistory, denom);
      }
      modalCacheSet(cacheKey, data);
    })).catch(() => { /* per-range failures stay quiet */ });
    return () => { cancelled = true; };
  }, [ticker, rangeKey, useExt, phase, loading, error]);

  // Continuous polling for the 1D view — re-fetch back-to-back so the
  // chart tracks intraday moves without needing a manual refresh. New
  // data swaps `series` in place; the previous bars stay on screen
  // during the next fetch (no spinner flicker). 5 s minimum gap between
  // polls in case fetchHistoricalBatch returns instantly from a hot
  // cache, so the loop can't pin the network. Tears down on rangeKey
  // change or modal close.
  React.useEffect(() => {
    if (rangeKey !== '1D' || !series) return;
    let cancelled = false;
    let timer = null;
    const POLL_MIN_MS = 5000;
    async function tick() {
      if (cancelled) return;
      try {
        const params = fetchParamsFor(rangeKey, extendedHours, phase);
        const out = await fetchHistoricalBatch(
          [ticker], params.yahooRange, params.interval, params.includePrePost,
        );
        if (cancelled) return;
        let data = out[ticker];
        if (data && data.length >= 2) {
          if (params.variant === 'closed') data = filterToLatestDay(data);
          else if (params.variant === 'reg' || params.variant === 'ext') data = filterToLast24h(data);
          const cacheKey = `${ticker}|${rangeKey}|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
          modalCacheSet(cacheKey, data);
          setSeries(data);
        }
      } catch { /* keep prior data on screen */ }
      if (!cancelled) timer = setTimeout(tick, POLL_MIN_MS);
    }
    timer = setTimeout(tick, POLL_MIN_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [ticker, rangeKey, useExt, phase, series === null]);

  // US market hours in UTC for today. Dynamic so EST winter sessions
  // (close 21:00 UTC) still find their bars — hard-coding 20:00 would
  // silently miss the close marker Nov–Mar.
  const mh = usMarketHoursUtc(new Date());

  // In ext-on AH/PM mode the chart's right-edge price needs to be the
  // current after-hours quote so the % return matches the scoreboard's
  // DAY CHANGE (which in the same mode is computed against today's
  // regular close). Outside ext-AH we use lastPrice (today's regular
  // session price during the day, or yesterday's close after hours).
  //
  // marketData only carries the MC index/futures/forex snapshots —
  // portfolio stocks come in via the `holding` prop, so we look in
  // BOTH places for extPrice / lastPrice. Without the holding
  // fallback an in-portfolio stock (e.g. GOOG) in ext mode would
  // show holding.lastPrice as the modal's "Last" while the home
  // card showed holding.extPrice; user reported this for GOOG.
  //
  // OTC ADR caveat: Yahoo populates a `postMarketPrice` for tickers
  // that don't actually trade after-hours (e.g. SFTBY = SoftBank
  // Pink Sheets, no real AH session). The reported value is often
  // a stale or computed number (today's open price for SFTBY), and
  // blindly substituting it for the chart's right edge produces a
  // fake spike + a misleading "+8 %" headline. Detect "no extended-
  // hours activity" by checking whether the fetched intraday series
  // has any bar outside the regular session window (pre-market or
  // AH bars). If not, the ticker has no real AH and we ignore
  // `extPrice`, falling back to `lastPrice` (= last real trade).
  const md = marketData?.[ticker];
  const extPriceLive  = md?.extPrice  ?? holding?.extPrice  ?? null;
  const lastPriceLive = md?.lastPrice ?? holding?.lastPrice ?? null;
  const openMinsUtc   = mh.openHh  * 60 + mh.openMm;
  const closeMinsUtc  = mh.closeHh * 60 + mh.closeMm;
  // hasExtendedBars — "is `extPrice` a real AH quote for this
  // ticker?". Prefer the verdict the home page already computed for
  // this holding (`holding.extPriceTrusted`, from its ext-hours
  // validation fetch) so the modal and the position card never
  // disagree — that's the CBRS card-vs-modal bug. Fall back to
  // validating the modal's own intraday series (extPriceIsRealAh:
  // real pre/post bars AND extPrice tracking them) for tickers with
  // no holding — MC index cards opened from Market Conditions — or
  // before the home page's verdict has landed. Drives both the
  // chart's right-edge substitution and the anchor logic, so
  // SFTBY's bogus +8 % headline disappears.
  const hasExtendedBars = (typeof holding?.extPriceTrusted === 'boolean')
    ? holding.extPriceTrusted
    : extPriceIsRealAh(series, extPriceLive, openMinsUtc, closeMinsUtc);
  const liveLast = (
    (useExt && hasExtendedBars && typeof extPriceLive === 'number' && extPriceLive > 0)
      ? extPriceLive
      : lastPriceLive
  ) || null;

  // Most-recent regular-close bar inside the series. Walk backwards
  // from the end and pick the first bar whose UTC time-of-day matches
  // close time:
  //   - In ext mode (market is currently closed) the most recent close
  //     bar is TODAY's close — anchor / line render as "today's session
  //     just ended, ext-hours moves are vs. that".
  //   - In regular mode (market is currently open) the most recent
  //     close bar is YESTERDAY's close (today's close hasn't happened
  //     yet) — used purely as a visual marker; the % anchor still
  //     comes from md.prevClose so it matches the scoreboard exactly.
  let regularCloseIdx = -1;
  if (rangeKey === '1D' && (useExt || phase === 'regular') && series && series.length > 0) {
    for (let i = series.length - 1; i >= 0; i--) {
      const hh = parseInt(series[i].date.slice(11, 13), 10);
      const mm = parseInt(series[i].date.slice(14, 16), 10);
      // Match the bar at exactly closeHh:closeMm UTC (= 20:00 EDT /
      // 21:00 EST). Strict equality only — a looser "hh < closeHh"
      // fallback would match overnight / premarket bars after midnight
      // UTC and pin the anchor to the latest premarket tick instead of
      // yesterday's 16:00 ET close, leaving the modal showing ~0% on
      // any pre-open holding chart. If the exact bar is missing from
      // the data the anchor block falls through to lastPrice instead.
      if (hh === mh.closeHh && mm === mh.closeMm) { regularCloseIdx = i; break; }
    }
  }

  // First-regular-open bar in the data — used to draw the OPEN dashed
  // line during the in-session view. Visual context only; the % basis
  // pivots at prevClose so it agrees with the scoreboard / heatmap.
  // We scope the search to TODAY's calendar date because the 24-h
  // window includes yesterday's afternoon bars whose UTC hours also
  // satisfy hh >= openHh — without the day filter, regularOpenIdx
  // would land on yesterday's first afternoon bar (= chart's left
  // edge) instead of today's actual open.
  let regularOpenIdx = -1;
  if (rangeKey === '1D' && phase === 'regular' && series && series.length > 0) {
    const todayDay = series[series.length - 1].date.slice(0, 10);
    for (let i = 0; i < series.length; i++) {
      const d = series[i].date;
      if (d.slice(0, 10) !== todayDay) continue;
      const hh = parseInt(d.slice(11, 13), 10);
      const mm = parseInt(d.slice(14, 16), 10);
      // First bar at-or-after openHh:openMm UTC on today's date.
      if ((hh === mh.openHh && mm >= mh.openMm) || hh > mh.openHh) { regularOpenIdx = i; break; }
    }
  }

  // Anchor for % calculation. 1D anchors at "the most recent 16:00 ET
  // regular close that has occurred":
  //   - regular hours → prevClose
  //   - ext-on AH/PM, ticker that actually trades in pre / AH (has
  //     bars outside the regular session window in `series`) →
  //     today's 16:00 ET bar, with lastPrice as a fallback (Yahoo
  //     pins lastPrice to the 16:00 ET print once the market
  //     closes), and prevClose as the final fallback.
  //   - ext-on AH/PM, ticker that doesn't have extended-hours bars
  //     in the fetched series (^VIX / ^TNX / OTC ADRs like SFTBY) →
  //     prevClose. Yahoo populates a bogus `postMarketPrice` for
  //     these (often today's open or stale value), so anchoring at
  //     today's close would print "0.00%" or wildly fake numbers;
  //     anchoring at yesterday's close gives the standard
  //     "since prev close" % which IS the meaningful headline.
  // marketData only carries the MC indices/futures/forex; portfolio
  // stocks are passed in via `holding`, so we look in BOTH places
  // for the ticker's price metadata.
  const lastPriceAny = md?.lastPrice ?? holding?.lastPrice ?? null;
  const prevCloseAny = md?.prevClose ?? holding?.prevClose ?? null;
  let anchorClose = null;
  if (series && series.length > 0) {
    if (rangeKey === '1D') {
      if (useExt) {
        // Ext mode: the headline % is "move since today's 16:00 ET
        // close". Anchor at today's close bar — or lastPrice, which
        // Yahoo pins to the 16:00 print — regardless of whether this
        // ticker has real AH bars. A non-AH-trading name (SFTBY, an
        // OTC ADR; ^VIX) then reads ~0%, not yesterday's stale
        // regular-session move.
        if (regularCloseIdx >= 0) {
          anchorClose = series[regularCloseIdx].close;
        } else if (lastPriceAny && lastPriceAny > 0) {
          anchorClose = lastPriceAny;
        } else if (prevCloseAny && prevCloseAny > 0) {
          anchorClose = prevCloseAny;
        } else {
          anchorClose = series[0].close;
        }
      } else if (prevCloseAny && prevCloseAny > 0) {
        anchorClose = prevCloseAny;
      } else {
        anchorClose = series[0].close;
      }
    } else {
      anchorClose = series[0].close;
    }
  }

  // Display series: substitute live price into the last point so the
  // chart tail tracks the rest of the app in real time. `isPriceAxis`
  // gates this on the y-axis units — true for the price ranges
  // (1D/1W/1M/3M/YTD), false for the ratio ranges (PE/PS). Mixing a
  // raw price into a ratio series would draw a vertical cliff
  // between the second-to-last bar and today, which the user hit on
  // NET / SATS / NVTS / SOUN before this gate was extended to PS.
  const points = series ? series.map((p, i) => (
    isPriceAxis(rangeKey) && i === series.length - 1 && liveLast ? { ...p, close: liveLast } : p
  )) : [];

  const lastClose = points.length > 0 ? points[points.length - 1].close : null;
  const pctNow = (anchorClose && lastClose) ? ((lastClose - anchorClose) / anchorClose) * 100 : 0;
  const cur = holding?.currency || 'USD';
  const sym = SYMBOL_BY_CUR[cur] || '$';

  // Chart geometry
  const W = 600, H = 280;
  // Right padding is wider in PE mode so the "3Y AVG 25.20" label
  // can sit OUTSIDE the chart's plot area (between the right edge of
  // the dashed line and the SVG's right side) instead of floating
  // inside the chart and getting crossed by the price line. Same
  // treatment for the MA overlay (1W/1M/3M/YTD) — the "MA 50" label
  // sits in the right margin at the level of the latest MA value.
  const showMa = ['1W', '1M', '3M', 'YTD'].includes(rangeKey);
  // 1D has no MA line but may have a VWAP overlay — same right-margin
  // label treatment, so it needs the same widened padR.
  const showVwap = rangeKey === '1D';
  const padL = 56, padT = 18, padB = 38;
  const padR = isRatioRange ? 96 : (showMa || showVwap ? 56 : 16);
  const cW = W - padL - padR, cH = H - padT - padB;

  // Intraday rolling SMA — what TradingView calls "5/10/20/50-day MA"
  // on an intraday chart. Strictly causal: at every bar i in the
  // wider series, MA = avg of bars (i - N + 1) … i (trailing N
  // including the current bar; no future data; no smoothing). N is
  // the number of *bars* equivalent to the requested day count at
  // the chart's interval, so on 30m the line updates every 30 min
  // and on 60m every 60 min — no flat day-long plateaus.
  // Moving-average overlay — pure math lives in `src/indicators.js`.
  // Combined-source SMA so the line spans the full chart even when
  // maHistory's 12 h cache lags the freshly fetched display data.
  // Bars-per-day scaling on intraday ranges (5d × 13 bars/day at 30m,
  // 10d × 7 at 60m) is encapsulated in `maBarsFor`; dailyOnly tickers
  // (CN funds / .PVT) take the plain day count via the same call.
  const MA_BARS = maBarsFor(rangeKey, dailyOnly);
  const MA_DAYS = maLabelDaysFor(rangeKey);
  const maSeries = MA_BARS > 0 ? computeMaSeries(points, maHistory, MA_BARS) : null;

  // Volume-weighted average price (1D only). Per-asset reset anchor —
  //   - US equity: 09:30 ET when ext off; 04:00 ET pre-market open
  //     when ext on so the VWAP spans pre / regular / AH as one ramp.
  //   - Crypto (`-USD`): 00:00 UTC anchored-VWAP convention for 24/7
  //     markets.
  //   - Other 24h-or-non-US markets: 00:00 UTC fallback.
  // Forward-fills sparse-volume bars (BTC-USD's hourly-only volume on
  // Yahoo) so the line stays smooth instead of stair-stepping.
  // Bars before any real session volume return null — strict
  // volume-weighted only, no TWAP fudge.
  const vwapResetCfg = vwapSessionResetFor(ticker, extendedHours, mh);
  /** @param {string} d */
  const sessionKeyOf = (d) => vwapSessionKeyOf(d, vwapResetCfg);
  const vwapSeries = (rangeKey === '1D' && points.length > 0)
    ? computeVwap(points, sessionKeyOf)
    : null;

  const hasData = points.length >= 2 && anchorClose;
  // X positioning is INDEX-based, not time-based. Treating each bar as one
  // equally-spaced step removes the ugly weekend / overnight gaps a real
  // time scale would draw, and matches the convention every brokerage
  // chart uses (Yahoo, Robinhood, T212 etc.) — they all collapse non-
  // trading time into a single step. xOfIdx(i) takes the data-array index.
  let xOfIdx = (_i) => padL, yOf = (_p) => padT + cH / 2;
  let yMin = 0, yMax = 0, ticksY = [], ticksX = [];
  if (hasData) {
    const denom = Math.max(1, points.length - 1);
    xOfIdx = (i) => padL + (i / denom) * cW;
    const allP = points.map(p => p.close);
    // PE / PS charts include the 3-year-average reference line in
    // the y-range so the dashed marker is always on-screen, even when
    // the current ratio has drifted far from the historical average.
    if (rangeKey === 'PE' && typeof pe3yAvg === 'number' && pe3yAvg > 0) {
      allP.push(pe3yAvg);
    }
    if (rangeKey === 'PS' && typeof ps3yAvg === 'number' && ps3yAvg > 0) {
      allP.push(ps3yAvg);
    }
    // MA values too — without this the line could overflow the
    // chart bounds on the leftmost bars where MA reflects a much
    // older (lower) average than the current price. User reported
    // it as "MA 线溢出图表".
    if (maSeries) {
      for (const v of maSeries) {
        if (typeof v === 'number' && isFinite(v)) allP.push(v);
      }
    }
    // Same containment treatment for VWAP — without it the overlay
    // could clip at the top/bottom of the plot area on volatile days.
    if (vwapSeries) {
      for (const v of vwapSeries) {
        if (typeof v === 'number' && isFinite(v)) allP.push(v);
      }
    }
    const rawMin = Math.min(...allP), rawMax = Math.max(...allP);
    const yPad = Math.max(0.001, (rawMax - rawMin) * 0.08);
    yMin = rawMin - yPad; yMax = rawMax + yPad;
    const yRange = yMax - yMin || 1;
    yOf = (p) => padT + ((yMax - p) / yRange) * cH;
    // Y ticks — pick a step that gives ~5 ticks
    const r = yMax - yMin;
    const niceStep = (r) => {
      const exp = Math.pow(10, Math.floor(Math.log10(r)));
      const norm = r / exp;
      if (norm < 1.5) return 0.2 * exp;
      if (norm < 3) return 0.5 * exp;
      if (norm < 7) return 1 * exp;
      return 2 * exp;
    };
    const step = niceStep(r);
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) ticksY.push(v);
    // X ticks — pick equally-spaced INDICES (not times) so labels track
    // actual data points rather than calendar gaps. Each tick records
    // both the chart-x coord and the date string at that index.
    const ticksToShow = rangeKey === '1D' ? 5 : 4;
    for (let i = 0; i <= ticksToShow; i++) {
      const idx = Math.round((points.length - 1) * (i / ticksToShow));
      const safeIdx = Math.max(0, Math.min(points.length - 1, idx));
      ticksX.push({ x: xOfIdx(safeIdx), date: points[safeIdx].date });
    }
  }

  // Crosshair hover label — keeps minute precision on 1W/1M so the user
  // can read the exact bar's timestamp. Intraday strings from the chart
  // Edge Function are UTC ISO truncated to "YYYY-MM-DDTHH:MM" with NO
  // 'Z' suffix; without that suffix `new Date(...)` parses the value as
  // *local* time — for a London/BST user that mis-rendered every
  // intraday bar an hour earlier than it actually was (US market open
  // 13:30 UTC showed as 1:30 PM instead of 2:30 PM BST). Append the Z
  // ourselves so the engine treats it as UTC.
  function parseChartDate(dateStr) {
    if (typeof dateStr !== 'string') return new Date(dateStr);
    if (dateStr.length === 16 && dateStr[10] === 'T') return new Date(dateStr + 'Z');
    return new Date(dateStr);
  }
  function fmtDate(dateStr) {
    const d = parseChartDate(dateStr);
    if (rangeKey === '1D') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (rangeKey === '1W' || rangeKey === '1M') {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  // X-axis tick labels — bare date on 1W/1M (5–6 samples across the row,
  // intraday timestamps would just clutter without adding info).
  function fmtAxisDate(dateStr) {
    const d = parseChartDate(dateStr);
    if (rangeKey === '1D') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Hover crosshair is updated via direct DOM-ref manipulation — NOT React
  // state. Setting state on every mousemove caused the whole SVG (including
  // the path with up to 150 points) to reconcile, which was the root of
  // the lag the user kept hitting. Here we keep the index in a ref and
  // imperatively update the crosshair group's child attributes inside a
  // requestAnimationFrame, leaving everything else in the chart untouched.
  const svgRef = React.useRef(null);
  const crossRef = React.useRef(/** @type {SVGGElement | null} */ (null));
  const cVlineRef = React.useRef(/** @type {SVGLineElement | null} */ (null));
  const cHlineRef = React.useRef(/** @type {SVGLineElement | null} */ (null));
  const cDotRef = React.useRef(/** @type {SVGCircleElement | null} */ (null));
  const cXRectRef = React.useRef(/** @type {SVGRectElement | null} */ (null));
  const cXTextRef = React.useRef(/** @type {SVGTextElement | null} */ (null));
  const cYRectRef = React.useRef(/** @type {SVGRectElement | null} */ (null));
  const cYTextRef = React.useRef(/** @type {SVGTextElement | null} */ (null));
  const cPctRectRef = React.useRef(/** @type {SVGRectElement | null} */ (null));
  const cPctTextRef = React.useRef(/** @type {SVGTextElement | null} */ (null));
  const rafRef = React.useRef(0);
  const pendingIdxRef = React.useRef(/** @type {number|null} */ (null));

  // Crosshair x-axis label box width depends on the formatted text — 1W/1M
  // emit "Mon DD HH:MM" (~12 chars at fontSize 9.5) which doesn't fit the
  // 64 px box that's enough for "HH:MM" or "Mon DD". Sized per range so
  // the box snugly fits the longest possible label without leaving big
  // gaps on shorter ones.
  const xRectWidth = (rangeKey === '1W' || rangeKey === '1M') ? 96 : 64;

  function paintCrosshair() {
    rafRef.current = 0;
    const idx = pendingIdxRef.current;
    const g = crossRef.current;
    if (!g) return;
    if (idx == null || !points[idx]) {
      g.style.display = 'none';
      return;
    }
    g.style.display = '';
    const p = points[idx];
    const x = xOfIdx(idx);
    const y = yOf(p.close);
    const pct = anchorClose ? ((p.close - anchorClose) / anchorClose) * 100 : 0;

    if (cVlineRef.current) { cVlineRef.current.setAttribute('x1', String(x)); cVlineRef.current.setAttribute('x2', String(x)); }
    if (cHlineRef.current) { cHlineRef.current.setAttribute('y1', String(y)); cHlineRef.current.setAttribute('y2', String(y)); }
    if (cDotRef.current)   { cDotRef.current.setAttribute('cx', String(x)); cDotRef.current.setAttribute('cy', String(y));
                             cDotRef.current.setAttribute('fill', pct >= 0 ? 'var(--gain)' : 'var(--loss)'); }
    if (cXRectRef.current) cXRectRef.current.setAttribute('x', String(x - xRectWidth / 2));
    if (cXTextRef.current) { cXTextRef.current.setAttribute('x', String(x)); cXTextRef.current.textContent = fmtDate(p.date); }
    if (cYRectRef.current) cYRectRef.current.setAttribute('y', String(y - 9));
    if (cYTextRef.current) {
      cYTextRef.current.setAttribute('y', String(y));
      cYTextRef.current.textContent = isRatioRange ? p.close.toFixed(2) : fmtTickerPrice(p.close, ticker, sym);
    }
    if (cPctRectRef.current) {
      cPctRectRef.current.setAttribute('x', String(x + 6));
      cPctRectRef.current.setAttribute('y', String(y - 16));
      cPctRectRef.current.setAttribute('fill', pct >= 0 ? 'rgba(70,160,90,0.85)' : 'rgba(190,60,70,0.85)');
    }
    if (cPctTextRef.current) {
      cPctTextRef.current.setAttribute('x', String(x + 34));
      cPctTextRef.current.setAttribute('y', String(y - 5));
      cPctTextRef.current.textContent = fmP(pct);
    }
  }

  function handleMove(e) {
    if (!hasData || !svgRef.current) return;
    // Support both mouse events (desktop) and touch events (mobile).
    // Touch events expose pointer coords on `e.touches[0]`; the SVG
    // also has `touch-action: none` set so finger drags don't fight
    // the page scroller for ownership.
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    if (clientX == null) return;
    const rect = svgRef.current.getBoundingClientRect();
    // The SVG uses the default preserveAspectRatio="xMidYMid meet", which
    // letterboxes the viewBox content when the rendered element's aspect
    // ratio differs from W/H (e.g. wide desktop view). Compute the actual
    // content-area offset+size so the cursor → chart-x mapping is exact
    // right up to the edge of the visible chart, not the SVG element.
    const vbRatio = W / H;
    const elRatio = rect.width / rect.height;
    let contentW, contentH, offX, offY;
    if (elRatio > vbRatio) {
      contentH = rect.height; contentW = contentH * vbRatio;
      offX = (rect.width - contentW) / 2; offY = 0;
    } else {
      contentW = rect.width;  contentH = contentW / vbRatio;
      offX = 0; offY = (rect.height - contentH) / 2;
    }
    const sx = ((clientX - rect.left - offX) / contentW) * W;
    // Clamp the cursor's chart-space x to [padL, W-padR] so the crosshair
    // pins to the first / last data point when the mouse drifts into the
    // axis padding instead of "snapping off".
    const clampedSx = Math.max(padL, Math.min(W - padR, sx));
    const denom = Math.max(1, points.length - 1);
    const frac = (clampedSx - padL) / cW;
    const i = Math.round(frac * denom);
    pendingIdxRef.current = Math.max(0, Math.min(points.length - 1, i));
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(paintCrosshair);
  }
  function handleLeave() {
    pendingIdxRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (crossRef.current) crossRef.current.style.display = 'none';
  }
  React.useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);
  // Re-hide the crosshair whenever the data swaps (e.g. range change).
  React.useEffect(() => {
    if (crossRef.current) crossRef.current.style.display = 'none';
  }, [series]);

  // Path is built once per render of the chart (when data / geometry
  // changes). It does NOT depend on hover, so the rAF crosshair paints
  // don't trigger a path recompute.
  const path = points.length > 0
    ? 'M' + points.map((p, i) => `${xOfIdx(i).toFixed(1)},${yOf(p.close).toFixed(1)}`).join('L')
    : '';
  const lineColor = pctNow >= 0 ? 'var(--gain)' : 'var(--loss)';

  // (MA series itself is computed earlier — before the y-range
  // calculation — so MA values can participate in yMin/yMax.)
  const maPath = maSeries
    ? (() => {
        const start = maSeries.findIndex(v => v != null);
        if (start < 0) return '';
        const segs = [];
        for (let i = start; i < maSeries.length; i++) {
          if (maSeries[i] == null) continue;
          segs.push(`${xOfIdx(i).toFixed(1)},${yOf(maSeries[i]).toFixed(1)}`);
        }
        return segs.length >= 2 ? 'M' + segs.join('L') : '';
      })()
    : '';
  const maLastValue = maSeries
    ? (() => {
        for (let i = maSeries.length - 1; i >= 0; i--) {
          if (maSeries[i] != null) return maSeries[i];
        }
        return null;
      })()
    : null;

  // VWAP path + last-value label. Unlike MA, VWAP resets at every
  // session boundary inside the displayed window (9:30 ET for US
  // equities, 00:00 UTC for crypto). Emit a fresh `M` at each new
  // session so the SVG doesn't draw a misleading straight segment
  // from the prior session's final VWAP down to the new session's
  // first.
  const vwapPath = vwapSeries
    ? (() => {
        let out = '';
        let openSegment = false;
        let prevSession = '';
        for (let i = 0; i < vwapSeries.length; i++) {
          if (vwapSeries[i] == null) { openSegment = false; continue; }
          const sk = sessionKeyOf(points[i].date);
          const cmd = (openSegment && sk === prevSession) ? 'L' : 'M';
          out += `${cmd}${xOfIdx(i).toFixed(1)},${yOf(vwapSeries[i]).toFixed(1)}`;
          openSegment = true;
          prevSession = sk;
        }
        return out;
      })()
    : '';
  const vwapLastValue = vwapSeries
    ? (() => {
        for (let i = vwapSeries.length - 1; i >= 0; i--) {
          if (vwapSeries[i] != null) return vwapSeries[i];
        }
        return null;
      })()
    : null;

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">{
            rangeKey === 'PE' ? 'P/E RATIO' : rangeKey === 'PS' ? 'P/S RATIO' : 'PRICE'
          }</div>
          <h2 className="modal-title mono">
            {TICKER_DISPLAY_NAMES[ticker]
              ? <>{TICKER_DISPLAY_NAMES[ticker]} <span className="dim" style={{ fontSize: '0.7em' }}>{ticker}</span></>
              : ticker}
          </h2>
          <div className="modal-meta">
            <span className="mono dim">{
              rangeKey === 'PE' ? 'P/E' : rangeKey === 'PS' ? 'P/S' : 'Last'
            }</span>
            <span className="mono">{
              lastClose != null
                ? (isRatioRange ? lastClose.toFixed(2) : fmtTickerPrice(lastClose, ticker, sym))
                : '—'
            }</span>
            <span className="mono" style={{ color: pcC(pctNow) }}>{fmP(pctNow)}</span>
            {/* In 1D the chart's % is anchored at the previous regular
                close (vertical CLOSE line) so it matches the scoreboard
                / heatmap's DAY CHANGE. Make the basis explicit so the
                user can see what the % is relative to. */}
            {rangeKey === '1D' && (useExt || phase === 'regular') && (
              <span className="mono dim" style={{ fontSize: 10 }}>(since previous close)</span>
            )}
            {rangeKey === 'PE' && (
              <span className="mono dim" style={{ fontSize: 10 }}>(price ÷ TTM EPS)</span>
            )}
            {rangeKey === 'PS' && (
              <span className="mono dim" style={{ fontSize: 10 }}>(price ÷ TTM sales per share)</span>
            )}
          </div>
          {/* PEG on its own line below the P/E row — secondary
              valuation metric, only renders when Yahoo published
              BOTH a forward P/E and a usable forward EPS-growth rate
              (the blended 2y forward growth from computeForwardGrowth
              in the fundamentals Edge Function). Hidden on the PS
              view (PEG pairs with earnings, not sales) and on the
              price ranges. */}
          {rangeKey === 'PE' && peg != null && peg > 0 && (
            <div className="modal-meta">
              <span className="mono dim">PEG</span>
              <span className="mono">{peg.toFixed(2)}</span>
              <span className="mono dim" style={{ fontSize: 10 }}>(forward P/E ÷ 2y fwd EPS growth %)</span>
            </div>
          )}
          {/* Holding-stats line — shares / AC / Cost / Value / G/L,
              same set the position-drill PlayerCard shows. AC stays in
              native currency (matches the broker print the user typed
              in); Cost / Value / G/L convert to USD via the per-holding
              fx rate. Value gets a "(X.X% of portfolio)" parenthesis
              so the user can see this position's weight in the book at
              a glance, without bouncing back to the home page. */}
          {rangeKey !== 'PE' && holding && holding.shares != null && (() => {
            const hCur = holding.currency || 'USD';
            const hSym = SYMBOL_BY_CUR[hCur] || '$';
            const fx        = fxToUSD(hCur, marketData);
            // OTC ADR guard: Yahoo's bogus postMarketPrice for tickers
            // like SFTBY shows up as today's open and makes Value /
            // G/L lie. The chart's right edge already falls back to
            // lastPrice when `hasExtendedBars` is false, but that
            // signal only works on the 1D range (it inspects the
            // intraday series). For 1W/1M/3M/YTD the series is daily
            // bars with no intraday timestamps to inspect, so applying
            // the gate there would silently fall back to lastPrice
            // for legit AH movers (NVDA up 10 % on earnings, etc.)
            // when the user is on a non-1D view. Only apply the gate
            // when we have the data to validate it.
            const trustExtPrice = rangeKey !== '1D' || hasExtendedBars;
            const livePrice = (useExt && trustExtPrice && holding.extPrice != null && holding.extPrice > 0)
                                ? holding.extPrice
                                : holding.lastPrice;
            const valueUsd  = holding.shares * livePrice * fx;
            const costUsd   = holding.shares * holding.cost * fx;
            const glUsd     = valueUsd - costUsd;
            const glPct     = costUsd > 0 ? (glUsd / costUsd) * 100 : 0;
            const portShare = portfolioTotalValue > 0 ? (valueUsd / portfolioTotalValue) * 100 : null;
            // Mask raw shares + dollar amounts under the privacy toggle —
            // matches what PlayerCard does for the same fields. Percentages
            // (G/L %, portfolio share) stay visible since they don't reveal
            // portfolio size.
            const m = (s) => hideValues ? maskDigits(s) : s;
            return (
              <div className="modal-meta">
                <span className="mono dim">{m(String(holding.shares))} shares</span>
                <span className="mono dim">·</span>
                <span className="mono dim">AC <span className="mono">{m(`${hSym}${fmtPr(holding.cost)}`)}</span></span>
                <span className="mono dim">·</span>
                <span className="mono dim">Cost <span className="mono">{m(fmtMo(costUsd))}</span></span>
                <span className="mono dim">·</span>
                <span className="mono dim">Value <span className="mono">{m(fmtMo(valueUsd))}</span>{portShare != null && (
                  <span className="mono dim" style={{ fontSize: 10 }}> ({portShare.toFixed(2)}%)</span>
                )}</span>
                <span className="mono dim">·</span>
                <span className="mono dim">G/L <span className="mono" style={{ color: pcC(glPct) }}>{m(fmtMo(glUsd, { signed: true }))} ({fmP(glPct)})</span></span>
              </div>
            );
          })()}
        </div>
        <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="modal-body">
        <div className="ticker-chart-wrap">
          {loading && <div className="sparkline-empty dim mono">Loading…</div>}
          {!loading && error && <div className="sparkline-empty dim mono">Couldn't load history</div>}
          {!loading && !error && noPe && <div className="sparkline-empty dim mono">P/E not available — N/A</div>}
          {!loading && !error && !noPe && !hasData && <div className="sparkline-empty dim mono">No data for this range</div>}
          {!loading && !error && !noPe && hasData && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width="100%" height={H}
              // touchAction:none lets the chart claim horizontal finger
              // drags for crosshair updates instead of the browser
              // interpreting them as page-scroll / pinch-zoom gestures.
              // Mobile users can still scroll the modal by putting their
              // finger above or below the chart.
              style={{ display: 'block', touchAction: 'none' }}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
              onTouchStart={handleMove}
              onTouchMove={handleMove}
            >
              {/* Y-axis grid + labels */}
              {ticksY.map((v, i) => (
                <g key={`y${i}`}>
                  <line x1={padL} y1={yOf(v).toFixed(1)} x2={W - padR} y2={yOf(v).toFixed(1)}
                        stroke="var(--line-2)" strokeWidth="0.5" strokeDasharray="2,3" />
                  <text x={padL - 6} y={yOf(v).toFixed(1)} textAnchor="end" dominantBaseline="middle"
                        fontSize="9.5" fill="rgba(244,239,227,0.55)" fontFamily="var(--font-mono)">
                    {isRatioRange ? v.toFixed(2) : fmtTickerPrice(v, ticker, sym)}
                  </text>
                </g>
              ))}
              {/* X-axis labels — index-based, so weekend / non-trading
                  gaps don't open up empty stretches under the chart. */}
              {ticksX.map((tk, i) => (
                <text key={`x${i}`} x={tk.x} y={H - padB + 14}
                      textAnchor={i === 0 ? 'start' : (i === ticksX.length - 1 ? 'end' : 'middle')}
                      fontSize="9.5" fill="rgba(244,239,227,0.55)" fontFamily="var(--font-mono)">
                  {fmtAxisDate(tk.date)}
                </text>
              ))}
              {/* P/E YTD: 3-year-average reference line. Dashed gray
                  horizontal line spanning the plot area with the
                  value labeled in the right margin (outside the
                  plot) so the price line never crosses through it.
                  Comes from Finnhub's series.annual.pe (last 3
                  entries averaged). */}
              {(() => {
                // Same dashed reference line for both ratio views —
                // pick whichever 3Y average matches the active range
                // and render in the right margin.
                const avg = rangeKey === 'PE' ? pe3yAvg : rangeKey === 'PS' ? ps3yAvg : null;
                if (typeof avg !== 'number' || avg <= 0) return null;
                const y = yOf(avg);
                return (
                  <g>
                    <line x1={padL} y1={y.toFixed(1)} x2={W - padR} y2={y.toFixed(1)}
                          stroke="rgba(244,239,227,0.55)" strokeWidth="0.8" strokeDasharray="4,3" />
                    <text x={W - padR + 4} y={y.toFixed(1)} textAnchor="start" dominantBaseline="middle"
                          fontSize="9" fill="rgba(244,239,227,0.7)" fontFamily="var(--font-mono)">
                      3Y AVG {avg.toFixed(2)}
                    </text>
                  </g>
                );
              })()}
              {/* Vertical dashed CLOSE line. In ext mode this is today's
                  close; in regular mode it's yesterday's close (= the
                  prevClose the % anchors at). */}
              {regularCloseIdx >= 0 && (() => {
                const x = xOfIdx(regularCloseIdx).toFixed(1);
                return (
                  <g>
                    <line x1={x} y1={padT} x2={x} y2={H - padB}
                          stroke="var(--chalk-dim)" strokeWidth="0.8" strokeDasharray="3,4" opacity="0.6" />
                    <text x={x} y={padT - 4} textAnchor="middle"
                          fontSize="8.5" fill="var(--chalk-dim)" fontFamily="var(--font-mono)">
                      CLOSE
                    </text>
                  </g>
                );
              })()}
              {/* Vertical dashed line at today's regular open (1D in
                  regular session). Mirror of the CLOSE marker for the
                  ext-AH case — the chart now always fetches with
                  prepost when phase==='regular', so the OPEN bar is
                  somewhere in the middle of the data, not at index 0. */}
              {regularOpenIdx >= 0 && (() => {
                const x = xOfIdx(regularOpenIdx).toFixed(1);
                return (
                  <g>
                    <line x1={x} y1={padT} x2={x} y2={H - padB}
                          stroke="var(--chalk-dim)" strokeWidth="0.8" strokeDasharray="3,4" opacity="0.6" />
                    <text x={x} y={padT - 4} textAnchor="middle"
                          fontSize="8.5" fill="var(--chalk-dim)" fontFamily="var(--font-mono)">
                      OPEN
                    </text>
                  </g>
                );
              })()}
              {/* VWAP overlay (1D only, when bar volume is available).
                  Drawn before the price path so the active price line
                  stays on top. Same gray + label-in-right-margin
                  treatment as the MA overlays on other ranges. */}
              {vwapPath && (
                <path d={vwapPath} fill="none" stroke="#6b7280" strokeWidth="1.0"
                      strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
              )}
              {vwapLastValue != null && (
                <text x={W - padR + 4} y={yOf(vwapLastValue).toFixed(1)}
                      textAnchor="start" dominantBaseline="middle"
                      fontSize="9" fill="rgba(244,239,227,0.7)" fontFamily="var(--font-mono)">
                  VWAP
                </text>
              )}
              {/* Moving-average overlay (1W → 5d, 1M → 10d, 3M → 20d,
                  YTD → 50d). Drawn before the price path so the active
                  price line stays on top. Same gray as the PerfChart
                  S&P comparison line. Label sits in the right margin
                  at the y of the latest MA value, mirroring the PE
                  chart's 3Y AVG label position. */}
              {maPath && (
                <path d={maPath} fill="none" stroke="#6b7280" strokeWidth="1.0"
                      strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
              )}
              {maLastValue != null && (
                <text x={W - padR + 4} y={yOf(maLastValue).toFixed(1)}
                      textAnchor="start" dominantBaseline="middle"
                      fontSize="9" fill="rgba(244,239,227,0.7)" fontFamily="var(--font-mono)">
                  MA {MA_DAYS}
                </text>
              )}
              {/* Price path */}
              <path d={path} fill="none" stroke={lineColor} strokeWidth="1.6"
                    strokeLinejoin="round" strokeLinecap="round" />
              {/* End-of-line dot */}
              {points.length > 0 && (() => {
                const last = points[points.length - 1];
                return <circle cx={xOfIdx(points.length - 1).toFixed(1)} cy={yOf(last.close).toFixed(1)}
                               r="3" fill={lineColor} stroke="#0c1310" strokeWidth="1.5" />;
              })()}
              {/* Hover crosshair — rendered once with refs, hidden by
                  default. handleMove updates these elements directly via
                  setAttribute inside a rAF, so the rest of the SVG (path,
                  axes) doesn't reconcile every frame. */}
              <g ref={crossRef} style={{ display: 'none' }}>
                <line ref={cVlineRef} x1={padL} y1={padT} x2={padL} y2={H - padB}
                      stroke="rgba(244,239,227,0.5)" strokeWidth="0.7" strokeDasharray="3,3" />
                <line ref={cHlineRef} x1={padL} y1={padT} x2={W - padR} y2={padT}
                      stroke="rgba(244,239,227,0.5)" strokeWidth="0.7" strokeDasharray="3,3" />
                <rect ref={cXRectRef} x={padL} y={H - padB + 1} width={xRectWidth} height={18}
                      fill="#0c1310" stroke="var(--chalk-dim)" />
                <text ref={cXTextRef} x={padL} y={H - padB + 13} textAnchor="middle"
                      fontSize="9.5" fill="var(--chalk)" fontFamily="var(--font-mono)" />
                <rect ref={cYRectRef} x={padL - 56} y={padT} width={52} height={18}
                      fill="#0c1310" stroke="var(--chalk-dim)" />
                <text ref={cYTextRef} x={padL - 6} y={padT} textAnchor="end" dominantBaseline="middle"
                      fontSize="9.5" fill="var(--chalk)" fontFamily="var(--font-mono)" />
                <circle ref={cDotRef} cx={padL} cy={padT} r="3.5"
                        fill="var(--gain)" stroke="#0c1310" strokeWidth="1.5" />
                <rect ref={cPctRectRef} x={padL} y={padT} width={56} height={16} rx={2}
                      fill="rgba(70,160,90,0.85)" />
                <text ref={cPctTextRef} x={padL} y={padT} textAnchor="middle"
                      fontSize="10" fill="#fff" fontFamily="var(--font-mono)" fontWeight="600" />
              </g>
            </svg>
          )}
        </div>

        <div className="perf-range-row">
          {visibleRangeKeys.map(k => (
            <button
              key={k}
              type="button"
              className={`perf-range-btn mono${k === rangeKey ? ' on' : ''}`}
              onClick={() => setRangeKey(k)}
            >{k === 'PE' ? 'P/E YTD' : k === 'PS' ? 'P/S YTD' : RANGES[k].label}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
