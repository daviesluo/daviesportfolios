// Single-ticker price-history modal. X axis = time, Y axis = price.
// Hover crosshair shows the price/time/% at the cursor's nearest data
// point with dashed lines down to both axes. Same range buttons as the
// portfolio chart (1D / 1W / 1M / 3M / YTD). Used when the user taps a
// player in non-edit mode — edit mode keeps opening the EditTickerModal.
import React from 'react';
import { Modal } from './modals.jsx';
import { fetchHistoricalBatch, fetchFundamentals, Storage, usMarketHoursUtc, fxToUSD, maskDigits } from './utils.js';
import { RANGES, RANGE_KEYS, fetchParamsFor, filterToLatestDay, filterToLast24h } from './ytd.js';
import { fmtPrice as fmtPr, fmtPct as fmP, fmtMoney as fmtMo, pctColor as pcC } from './utils.js';
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
function modalCacheGet(key) {
  const all = Storage.loadTickerChart();
  return all?.entries?.[key] ?? null; // { ts, data } | null
}
function modalCacheSet(key, data) {
  const all = Storage.loadTickerChart() || { entries: {} };
  all.entries = { ...(all.entries || {}), [key]: { ts: Date.now(), data } };
  // Soft-cap at ~200 keys so the localStorage entry can't bloat unboundedly.
  const keys = Object.keys(all.entries);
  if (keys.length > 200) {
    const sorted = keys
      .map(k => ({ k, ts: all.entries[k]?.ts || 0 }))
      .sort((a, b) => b.ts - a.ts);
    /** @type {Record<string, {ts:number, data:any}>} */
    const trimmed = {};
    for (let i = 0; i < 200; i++) trimmed[sorted[i].k] = all.entries[sorted[i].k];
    all.entries = trimmed;
  }
  Storage.saveTickerChart(all);
}

// 6-digit numeric codes are CN mutual funds (天天基金). They only publish
// one NAV per trading day, so 1D / 1W (5 m / 30 m intraday) ranges have
// no meaningful data — restrict the visible range buttons to the daily
// ones for these tickers.
const CN_FUND_RE = /^\d{6}$/;
// .PVT suffix is the convention this app uses for private/un-listed
// holdings (e.g. SPAX.PVT). Yahoo doesn't carry them, so intraday
// ranges always fail. Keep them on the daily buttons only and surface
// a clear "no public history" message instead of a generic error.
const PVT_RE = /\.PVT$/i;

export function TickerChartModal({ ticker, holding, marketData, extendedHours, phase, onClose, portfolioTotalValue, hideValues }) {
  const isCnFund = CN_FUND_RE.test(ticker);
  const isPvt    = PVT_RE.test(ticker);
  const dailyOnly = isCnFund || isPvt;
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
  const [peSupported, setPeSupported] = React.useState(false);
  // pe3yAvg drives the dashed reference line on the P/E YTD chart.
  // Comes back null when Finnhub's annual PE series is empty (very
  // new IPOs, or tickers where Finnhub couldn't retrieve historicals)
  // — in that case the chart renders without the reference line
  // instead of erroring.
  const [pe3yAvg, setPe3yAvg] = React.useState(/** @type {number|null} */ (null));
  React.useEffect(() => {
    if (!supportsPePattern) { setPeSupported(false); setPe3yAvg(null); return; }
    let cancelled = false;
    fetchFundamentals([ticker]).then(f => {
      if (cancelled) return;
      const row = f?.[ticker];
      const eps = row?.eps;
      const pe  = row?.pe;
      // ETF proxies (^GSPC/^NDX/^RUT → SPY/QQQ/IWM) have no aggregate
      // EPS in Finnhub's free tier; the Edge Function returns eps:0
      // there. Treat the row as "supported" if EITHER eps > 0 OR
      // pe > 0 — the client reconstructs an implied EPS from the
      // last close ÷ pe so the P/E series is still drawable.
      const hasEps = typeof eps === 'number' && eps > 0;
      const hasPe  = typeof pe  === 'number' && pe  > 0;
      setPeSupported(hasEps || hasPe);
      const avg = row?.pe3yAvg;
      setPe3yAvg(typeof avg === 'number' && isFinite(avg) && avg > 0 ? avg : null);
    });
    return () => { cancelled = true; };
  }, [ticker, supportsPePattern]);
  const visibleRangeKeys = dailyOnly
    ? ['1M', '3M', 'YTD']
    : (peSupported ? [...RANGE_KEYS, 'PE'] : RANGE_KEYS);
  // CN funds publish 1 NAV / day; .PVT placeholders don't trade on
  // public exchanges. Both default to 1M so the user sees something
  // immediately rather than landing on an intraday view that's empty.
  const [rangeKey, setRangeKey] = React.useState(dailyOnly ? '1M' : '1D');
  const [series, setSeries]     = React.useState(/** @type {Array<{date:string,close:number}>|null} */ (null));
  const [loading, setLoading]   = React.useState(true);
  const [error, setError]       = React.useState(false);

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
    if (rk === 'PE') {
      const p = fetchParamsFor('YTD', extendedHours, phase);
      return { ...p, interval: '1d', includePrePost: false };
    }
    const p = fetchParamsFor(rk, extendedHours, phase);
    return dailyOnly ? { ...p, interval: '1d', includePrePost: false } : p;
  };

  React.useEffect(() => {
    let cancelled = false;
    const { yahooRange, interval, includePrePost } = fetchParams(rangeKey);
    // PE cache key gets an algorithm-version suffix so old caches that
    // hold const-EPS-divided P/E series get invalidated when we ship
    // the rolling-TTM-EPS computation. Bump the suffix again any time
    // the PE math changes shape.
    const cacheKey = rangeKey === 'PE'
      ? `${ticker}|PE|v3|${useExt ? 'ext' : 'reg'}|${phase || ''}`
      : `${ticker}|${rangeKey}|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
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
      const ageMs = Date.now() - (cached.ts || 0);
      if (ageMs >= ttl) needsFresh = true;
    } else {
      setLoading(true);
      setError(false);
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
      const params = fetchParamsFor(rangeKey === 'PE' ? 'YTD' : rangeKey, extendedHours, phase);
      if (params.variant === 'closed') data = filterToLatestDay(data);
      else if (params.variant === 'reg' || params.variant === 'ext') data = filterToLast24h(data);
      // 'PE' transform: divide each historical close by the rolling
      // TTM diluted EPS as of that price date so the chart actually
      // *moves* on earnings days instead of being a 1:1 scale of the
      // price chart. Edge Function returns `ttmEpsHistory` from
      // Yahoo's fundamentals-timeseries — already-summed TTM at each
      // quarter end, 5+ years of history. For each price date we just
      // pick the latest entry whose `quarterEnd + 45-day report lag`
      // is <= the price date. Falls back to the const current-TTM-EPS
      // path when (a) Yahoo didn't return a history (rate limit or
      // sparse coverage), (b) the price date predates the earliest
      // reported quarter, or (c) the Edge Function is on the older
      // version that doesn't yet emit `ttmEpsHistory`.
      if (rangeKey === 'PE') {
        const fundamentals = await fetchFundamentals([ticker], { ttmEpsHistory: true });
        if (cancelled) return;
        const row = fundamentals?.[ticker];
        // ETF-proxy tickers (^GSPC/^NDX/^RUT) typically come back with
        // eps:0 — Finnhub doesn't aggregate EPS at the index/ETF
        // level. Reconstruct an implied EPS from the most recent close
        // and the published trailing P/E (eps_implied = lastClose / pe)
        // so the historical series can still be divided into P/E
        // values that match the labelled y-axis.
        let eps = row?.eps;
        const pe = row?.pe;
        if ((!eps || eps <= 0) && typeof pe === 'number' && pe > 0 && data.length > 0) {
          eps = data[data.length - 1].close / pe;
        }
        if (!eps || eps <= 0) {
          reportError('fetch.pe.no-eps', {
            symbol: ticker,
            message: 'fundamentals returned no usable EPS',
          });
          if (!cached) { setError(true); setLoading(false); }
          return;
        }
        const REPORT_LAG_MS = 45 * 86400000;
        const epsHist = Array.isArray(row?.ttmEpsHistory) ? row.ttmEpsHistory : [];
        const reportEvents = epsHist
          .map(e => ({ ttm: Number(e.eps), reportMs: new Date(e.date).getTime() + REPORT_LAG_MS }))
          .filter(e => isFinite(e.ttm) && isFinite(e.reportMs) && e.ttm > 0)
          .sort((a, b) => a.reportMs - b.reportMs);
        data = data.map(p => {
          const dMs = new Date(p.date).getTime();
          let ttmEps = eps;
          for (let i = reportEvents.length - 1; i >= 0; i--) {
            if (reportEvents[i].reportMs <= dMs) { ttmEps = reportEvents[i].ttm; break; }
          }
          return { date: p.date, close: ttmEps > 0 ? p.close / ttmEps : 0 };
        });
      }
      modalCacheSet(cacheKey, data);
      setSeries(data);
      setLoading(false);
      setError(false);
    })();
    return () => { cancelled = true; };
  }, [ticker, rangeKey, useExt, phase]);

  // Background prefetch the other ranges once the user's chosen range has
  // landed. Range-button clicks then hit the in-memory cache for an
  // instant swap. Sequential, fire-and-forget — failures just leave the
  // cache untouched and the next click pays the normal fetch cost.
  React.useEffect(() => {
    if (loading || error || !series) return;
    const others = visibleRangeKeys.filter(k => k !== rangeKey);
    let cancelled = false;
    (async () => {
      for (const rk of others) {
        if (cancelled) return;
        // PE uses YTD daily data + a price ÷ EPS transform; everything
        // else uses fetchParamsFor's normal output (with the dailyOnly
        // override for CN funds + .PVT).
        let yahooRange, interval, includePrePost, variant;
        if (rk === 'PE') {
          const p = fetchParamsFor('YTD', extendedHours, phase);
          yahooRange = p.yahooRange; interval = '1d'; includePrePost = false; variant = p.variant;
        } else {
          const baseParams = fetchParamsFor(rk, extendedHours, phase);
          ({ yahooRange, interval, includePrePost, variant } = dailyOnly
            ? { ...baseParams, interval: '1d', includePrePost: false }
            : baseParams);
        }
        const cacheKey = rk === 'PE'
          ? `${ticker}|PE|v3|${useExt ? 'ext' : 'reg'}|${phase || ''}`
          : `${ticker}|${rk}|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
        const ttl = modalTtl(rk);
        const c = modalCacheGet(cacheKey);
        if (c && Array.isArray(c.data) && (Date.now() - (c.ts || 0)) < ttl) continue;
        const out = await fetchHistoricalBatch([ticker], yahooRange, interval, includePrePost);
        if (cancelled) return;
        let data = out[ticker];
        if (data && data.length >= 2) {
          if (variant === 'closed') data = filterToLatestDay(data);
          else if (variant === 'reg' || variant === 'ext') data = filterToLast24h(data);
          if (rk === 'PE') {
            const f = await fetchFundamentals([ticker], { ttmEpsHistory: true });
            if (cancelled) return;
            const row = f?.[ticker];
            let eps = row?.eps;
            const pe = row?.pe;
            // Same implied-EPS fallback as the main fetch above —
            // index proxies don't have aggregate EPS in Finnhub.
            if ((!eps || eps <= 0) && typeof pe === 'number' && pe > 0 && data.length > 0) {
              eps = data[data.length - 1].close / pe;
            }
            if (!eps || eps <= 0) continue;
            const REPORT_LAG_MS = 45 * 86400000;
            const epsHist = Array.isArray(row?.ttmEpsHistory) ? row.ttmEpsHistory : [];
            const reportEvents = epsHist
              .map(e => ({ ttm: Number(e.eps), reportMs: new Date(e.date).getTime() + REPORT_LAG_MS }))
              .filter(e => isFinite(e.ttm) && isFinite(e.reportMs) && e.ttm > 0)
              .sort((a, b) => a.reportMs - b.reportMs);
            data = data.map(p => {
              const dMs = new Date(p.date).getTime();
              let ttmEps = eps;
              for (let i = reportEvents.length - 1; i >= 0; i--) {
                if (reportEvents[i].reportMs <= dMs) { ttmEps = reportEvents[i].ttm; break; }
              }
              return { date: p.date, close: ttmEps > 0 ? p.close / ttmEps : 0 };
            });
          }
          modalCacheSet(cacheKey, data);
        }
      }
    })();
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

  // In ext-on AH/PM mode the chart's right-edge price needs to be the
  // current after-hours quote so the % return matches the scoreboard's
  // DAY CHANGE (which in the same mode is computed against today's
  // regular close). Outside ext-AH we use lastPrice (today's regular
  // session price during the day, or yesterday's close after hours).
  const md = marketData?.[ticker];
  const liveLast = (
    (useExt && md?.extPrice != null && md.extPrice > 0) ? md.extPrice
    : (md?.lastPrice ?? holding?.lastPrice)
  ) || null;

  // US market hours in UTC for today. Dynamic so EST winter sessions
  // (close 21:00 UTC) still find their bars — hard-coding 20:00 would
  // silently miss the close marker Nov–Mar.
  const mh = usMarketHoursUtc(new Date());

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
  //   - ext-on AH/PM → today's 16:00 ET bar in the fetched series,
  //     with lastPrice as a fallback (Yahoo pins lastPrice to the
  //     16:00 ET print once the market closes), and prevClose as the
  //     final fallback if neither is available.
  // Same anchor for every ticker so the modal % always matches the
  // MC card's todayRegularClose-based pct. Tickers with no AH
  // activity (^VIX / ^TNX / ^SOX) end up reading ~0% in ext mode —
  // expected, since the latest bar IS the 16:00 ET bar.
  // marketData only carries the MC indices/futures/forex; portfolio
  // stocks are passed in via `holding`, so we look in BOTH places
  // for the ticker's price metadata.
  const lastPriceAny = md?.lastPrice ?? holding?.lastPrice ?? null;
  const prevCloseAny = md?.prevClose ?? holding?.prevClose ?? null;
  let anchorClose = null;
  if (series && series.length > 0) {
    if (rangeKey === '1D') {
      if (useExt && regularCloseIdx >= 0) {
        anchorClose = series[regularCloseIdx].close;
      } else if (useExt && lastPriceAny && lastPriceAny > 0) {
        anchorClose = lastPriceAny;
      } else if (prevCloseAny && prevCloseAny > 0) {
        anchorClose = prevCloseAny;
      } else {
        anchorClose = series[0].close;
      }
    } else {
      anchorClose = series[0].close;
    }
  }

  // Display series: substitute live price into the last point so the chart
  // tail tracks the rest of the app in real time. Skipped for the PE
  // view since the cached series is already in P/E units; substituting
  // a raw price would tank the last bar.
  const points = series ? series.map((p, i) => (
    rangeKey !== 'PE' && i === series.length - 1 && liveLast ? { date: p.date, close: liveLast } : p
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
  const padL = 56, padT = 18, padB = 38;
  const padR = rangeKey === 'PE' ? 96 : (showMa ? 56 : 16);
  const cW = W - padL - padR, cH = H - padT - padB;

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
    // PE chart includes the 3-year-average reference line in the
    // y-range so the dashed marker is always on-screen, even when
    // current P/E has drifted far from the historical average.
    if (rangeKey === 'PE' && typeof pe3yAvg === 'number' && pe3yAvg > 0) {
      allP.push(pe3yAvg);
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
      cYTextRef.current.textContent = rangeKey === 'PE' ? p.close.toFixed(2) : fmtTickerPrice(p.close, ticker, sym);
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

  // Moving-average overlay. 1W → MA 5d, 1M → MA 10d, 3M → MA 20d,
  // YTD → MA 50d. 1D and PE skip the overlay (1D is single-session
  // intraday; PE has its own 3Y AVG dashed line).
  //
  // Daily semantics: the user asked for "5日 / 10日 / 20日 / 50日"
  // moving averages. 1W and 1M fetch *intraday* bars (30m / 60m per
  // ytd.js), so a naive N-bar window over `points` would average a
  // few hours of price action, not N trading days. Resample to one
  // close per UTC calendar date (last bar wins), compute the trailing
  // SMA on the daily series, then map each intraday bar back to its
  // day's MA so the line still spans the chart visually. For ranges
  // already at daily granularity (3M / YTD) this resample is a no-op.
  const MA_WINDOW = { '1W': 5, '1M': 10, '3M': 20, 'YTD': 50 }[rangeKey] || 0;
  let maSeries = null;
  if (MA_WINDOW > 0 && points.length > 0) {
    const byDate = new Map();
    for (const p of points) {
      if (typeof p.date !== 'string' || p.date.length < 10) continue;
      byDate.set(p.date.slice(0, 10), p.close); // last close of each day wins
    }
    const days = Array.from(byDate.keys()).sort();
    if (days.length >= MA_WINDOW) {
      const dayMa = new Map();
      let sum = 0;
      for (let i = 0; i < days.length; i++) {
        sum += byDate.get(days[i]);
        if (i >= MA_WINDOW) sum -= byDate.get(days[i - MA_WINDOW]);
        if (i >= MA_WINDOW - 1) dayMa.set(days[i], sum / MA_WINDOW);
      }
      maSeries = points.map(p => {
        const day = (typeof p.date === 'string' && p.date.length >= 10) ? p.date.slice(0, 10) : '';
        return dayMa.has(day) ? dayMa.get(day) : null;
      });
    }
  }
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

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">{rangeKey === 'PE' ? 'P/E RATIO' : 'PRICE'}</div>
          <h2 className="modal-title mono">
            {TICKER_DISPLAY_NAMES[ticker]
              ? <>{TICKER_DISPLAY_NAMES[ticker]} <span className="dim" style={{ fontSize: '0.7em' }}>{ticker}</span></>
              : ticker}
          </h2>
          <div className="modal-meta">
            <span className="mono dim">{rangeKey === 'PE' ? 'P/E' : 'Last'}</span>
            <span className="mono">{
              lastClose != null
                ? (rangeKey === 'PE' ? lastClose.toFixed(2) : fmtTickerPrice(lastClose, ticker, sym))
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
          </div>
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
            const livePrice = (useExt && holding.extPrice != null && holding.extPrice > 0)
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
          {!loading && !error && !hasData && <div className="sparkline-empty dim mono">No data for this range</div>}
          {!loading && !error && hasData && (
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
                    {rangeKey === 'PE' ? v.toFixed(2) : fmtTickerPrice(v, ticker, sym)}
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
              {rangeKey === 'PE' && typeof pe3yAvg === 'number' && pe3yAvg > 0 && (() => {
                const y = yOf(pe3yAvg);
                return (
                  <g>
                    <line x1={padL} y1={y.toFixed(1)} x2={W - padR} y2={y.toFixed(1)}
                          stroke="rgba(244,239,227,0.55)" strokeWidth="0.8" strokeDasharray="4,3" />
                    <text x={W - padR + 4} y={y.toFixed(1)} textAnchor="start" dominantBaseline="middle"
                          fontSize="9" fill="rgba(244,239,227,0.7)" fontFamily="var(--font-mono)">
                      3Y AVG {pe3yAvg.toFixed(2)}
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
                  MA {MA_WINDOW}
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
            >{k === 'PE' ? 'P/E YTD' : RANGES[k].label}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
