// Price-series data hook for TickerChartModal — the five fetch effects
// (main range fetch, MA-overlay history, background other-range
// prefetch, 1D live polling, overnight recorded-points) plus their
// state, lifted verbatim out of the 1400-line component. The modal now
// just consumes `{ series, loading, error, noPe, maHistory, overnightPts }`
// and keeps the geometry + render. Behaviour is byte-for-byte the same;
// this is purely a structural split of the most regression-prone block.
//
// Inputs are the modal-owned values the effects close over: the current
// `rangeKey` (modal state, since the buttons live in the render),
// `useExt` / `phase` / `extendedHours` (the ext-hours context),
// `dailyOnly` (CN-fund / .PVT routing), `isRatioRange` (PE/PS y-axis),
// and `visibleRangeKeys` (which the fundamentals hook feeds, so the
// other-range prefetch knows what to warm).

import React from 'react';
import { fetchHistoricalBatch } from './historical.js';
import { fetchFundamentals } from './yahoo_fetch.js';
import { fetchParamsFor, maFetchParamsFor, applyVariantFilter, filterToLastHours } from './ytd.js';
import { MA_TTL_MS, tickerChartCacheKey } from './cache.js';
import { ChartStore, MaStore } from './chart_store.js';
import { priceDividedByTtmEps } from './indicators.js';
import { getOvernightSeries, fetchOvernightSeries, OVERNIGHT_FETCH_EVENT } from './overnight_intraday.js';
import { hasOvernightSession, isCrypto } from './ticker_class.js';
import { reportError } from './ops_error.js';
import { modalTtl, modalCacheGet, modalCacheSet } from './ticker_chart_helpers.js';

/**
 * @param {{
 *   ticker: string, rangeKey: string, useExt: boolean, phase: string,
 *   dailyOnly: boolean, isRatioRange: boolean, extendedHours: boolean,
 *   visibleRangeKeys: string[],
 * }} args
 * @returns {{
 *   series: Array<{date:string,close:number,volume?:number}>|null,
 *   loading: boolean, error: boolean, noPe: boolean,
 *   maHistory: Array<{date:string,close:number}>|null,
 *   overnightPts: Array<{date:string,close:number}>,
 * }}
 */
export function useTickerChartData({
  ticker, rangeKey, useExt, phase, dailyOnly, isRatioRange, extendedHours, visibleRangeKeys,
}) {
  // Seed series + loading from cache up front so a warm-cache open
  // doesn't flash a spinner. On mount `rangeKey` equals this default,
  // so seeding from it reads the same row the modal used to.
  const initialRangeKey = dailyOnly ? '1M' : '1D';
  const initialCacheKey = tickerChartCacheKey(ticker, initialRangeKey, useExt, phase);
  const initialCached = (() => {
    const row = ChartStore.get(initialCacheKey);
    return row && Array.isArray(row.data) && row.data.length >= 2 ? row : null;
  })();
  const [series, setSeries] = React.useState(
    /** @type {Array<{date:string,close:number,volume?:number}>|null} */
    (initialCached ? initialCached.data : null),
  );
  const [loading, setLoading] = React.useState(!initialCached);
  const [error, setError] = React.useState(false);
  // Distinct from `error`: the legitimate "no positive trailing P/E to
  // chart" state (loss-makers, ETF proxies). Softer copy, no ops-error.
  const [noPe, setNoPe] = React.useState(false);
  // Wider sister-fetch for the MA overlay, same interval as the display
  // fetch so bars line up. Stored sorted ascending as `[{date,close},…]`.
  const [maHistory, setMaHistory] = React.useState(/** @type {Array<{date:string,close:number}>|null} */ (null));

  // Pick (yahooRange, interval, includePrePost) for the current range.
  // Daily-only tickers (CN funds / .PVT) force the 1d interval; PE/PS
  // ride on the trailing-1Y daily price series.
  const fetchParams = (rk) => {
    if (rk === 'PE' || rk === 'PS') {
      const p = fetchParamsFor('1Y', extendedHours, phase);
      return { ...p, interval: '1d', includePrePost: false };
    }
    const p = fetchParamsFor(rk, extendedHours, phase);
    return dailyOnly ? { ...p, interval: '1d', includePrePost: false } : p;
  };

  // Chart display-window dispatch. Crypto 1D BYPASSES the generic variant
  // filter — applyVariantFilter's 'closed' path trims a 24/7 asset to the
  // UTC calendar day, which would strip the previous US close BEFORE the
  // modal ever sees it — and instead keeps the trailing ~60 h of raw bars.
  // The modal then slices that per toggle/phase into the US-session view:
  // ext ON → rolling 24 h; ext OFF + market open → "since the last 16:00-ET
  // close" (windowSinceLastUsClose); ext OFF + market closed → the last
  // complete close-to-close day (windowBetweenLastTwoUsCloses). 60 h
  // guarantees the *previous* US close (up to ~42 h back in pre-market) is
  // present so the close-to-close slice always has both ends. Everyone else
  // takes the normal variant dispatch.
  const applyChartWindow = (data, rk, variant) => (
    isCrypto(ticker) && rk === '1D' && Array.isArray(data)
      ? filterToLastHours(data, 60)
      : applyVariantFilter(data, variant)
  );

  // ---- Main range fetch (stale-while-revalidate + PE/PS transform).
  React.useEffect(() => {
    let cancelled = false;
    const { yahooRange, interval, includePrePost } = fetchParams(rangeKey);
    const cacheKey = tickerChartCacheKey(ticker, rangeKey, useExt, phase);
    const ttl = modalTtl(rangeKey);
    const cached = modalCacheGet(cacheKey);

    let needsFresh = !cached;
    if (cached && Array.isArray(cached.data) && cached.data.length >= 2) {
      setSeries(cached.data);
      setLoading(false);
      setError(false);
      setNoPe(false);
      const ageMs = Date.now() - (cached.ts || 0);
      if (ageMs >= ttl) needsFresh = true;
      // Old 1D rows that pre-date per-bar volume satisfy the TTL but
      // lack `volume`, silently suppressing VWAP — force a refetch.
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
      // 3 attempts with short backoff — the Yahoo proxy chain is flaky
      // enough that one fetch can drop where a quick retry succeeds.
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
        if (!cached) {
          setError(true);
          setLoading(false);
        }
        return;
      }
      const params = fetchParamsFor(isRatioRange ? '1Y' : rangeKey, extendedHours, phase);
      data = applyChartWindow(data, rangeKey, params.variant);
      // PE/PS: divide each close by the rolling TTM per-share denominator
      // as of that date so the line steps on earnings instead of being a
      // 1:1 scale of price. Same 3-attempt retry on the fundamentals
      // fetch (its chain is just as flaky single-shot).
      if (isRatioRange) {
        let row;
        for (let attempt = 0; attempt < 3 && !row; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 250 * attempt));
          if (cancelled) return;
          const fundamentals = await fetchFundamentals([ticker], { ttmEpsHistory: true });
          if (cancelled) return;
          row = fundamentals?.[ticker];
        }
        // (a) infra failure → ops-error + red panel; (b) ratio ≤ 0 →
        // soft "P/X not available"; (c) usable ratio → derive the
        // per-share denominator from lastClose/ratio (ADR-currency safe).
        if (!row || typeof row !== 'object') {
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
          if (!cached) {
            setNoPe(true);
            setError(false);
            setSeries([]);
            setLoading(false);
          }
          return;
        }
        data = priceDividedByTtmEps(data, isPe ? row.ttmEpsHistory : row.ttmSalesHistory, denom);
      }
      modalCacheSet(cacheKey, data);
      setSeries(data);
      setLoading(false);
      setError(false);
      setNoPe(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, rangeKey, useExt, phase]);

  // ---- MA-overlay wider-history fetch (MaStore, 12h TTL, SWR).
  React.useEffect(() => {
    const params = maFetchParamsFor(rangeKey, dailyOnly);
    if (!params) { setMaHistory(null); return; }
    const cacheKey = `${ticker}|MA|${rangeKey}`;
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

  // ---- Background prefetch of every OTHER range (parallel) so range-
  // button clicks hit cache. Each fetch short-circuits if fresh.
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
        const p = fetchParamsFor('1Y', extendedHours, phase);
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
      data = applyChartWindow(data, rk, variant);
      if (isRatioRk) {
        const f = await fetchFundamentals([ticker], { ttmEpsHistory: true });
        if (cancelled) return;
        const row = f?.[ticker];
        const ratio = isPeRk ? row?.pe : row?.ps;
        let denom = isPeRk ? row?.eps : null;
        if (typeof ratio === 'number' && ratio > 0 && data.length > 0) {
          denom = data[data.length - 1].close / ratio;
        }
        if (!denom || denom <= 0) return;
        data = priceDividedByTtmEps(data, isPeRk ? row?.ttmEpsHistory : row?.ttmSalesHistory, denom);
      }
      modalCacheSet(cacheKey, data);
    })).catch(() => { /* per-range failures stay quiet */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, rangeKey, useExt, phase, loading, error]);

  // ---- Is the page actually being looked at? A modal left open in a
  // background tab kept polling every 5 s forever; over a weekend that is
  // tens of thousands of Edge calls and a measurable amount of the
  // phone's battery, for a chart nobody can see. `visibilitychange` is
  // the only signal that separates "open" from "being read".
  const [docVisible, setDocVisible] = React.useState(
    () => (typeof document === 'undefined' ? true : !document.hidden));
  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVis = () => setDocVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ---- 1D continuous polling so the chart tracks intraday moves.
  React.useEffect(() => {
    if (rangeKey !== '1D' || !series) return;
    // Nothing to track when nothing is trading. Crypto runs 24/7; a US
    // name moves in pre / regular / after; in the overnight window only
    // the names that carry a T212 overnight session can print. Outside
    // those the poll was re-fetching an unchanged series every 5 s all
    // night and all weekend. The effect re-runs when `phase` changes, so
    // the open modal picks the tape back up by itself.
    const tapeCouldMove = isCrypto(ticker)
      || phase !== 'overnight'
      || hasOvernightSession(ticker);
    if (!docVisible || !tapeCouldMove) return;
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
          data = applyChartWindow(data, rangeKey, params.variant);
          const cacheKey = `${ticker}|${rangeKey}|${useExt ? 'ext' : 'reg'}|${phase || ''}`;
          modalCacheSet(cacheKey, data);
          setSeries(data);
        }
      } catch { /* keep prior data on screen */ }
      if (!cancelled) timer = setTimeout(tick, POLL_MIN_MS);
    }
    timer = setTimeout(tick, POLL_MIN_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, rangeKey, useExt, phase, series === null, docVisible]);

  // ---- Overnight recorded points (read sync for first paint, re-read
  // on the `overnight:fetched` event, fetch this ticker on open).
  const [overnightPts, setOvernightPts] = React.useState(() => getOvernightSeries(ticker));
  React.useEffect(() => {
    const read = () => setOvernightPts(getOvernightSeries(ticker));
    read(); // paint from cache immediately (if warm)
    // Fetch whenever the ext toggle is on (any phase) — not just live in
    // the overnight session — so last night's recorded line is available
    // during the day too. The server keeps the points for 26h.
    if (extendedHours && hasOvernightSession(ticker)) {
      fetchOvernightSeries([ticker]);
    }
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(OVERNIGHT_FETCH_EVENT, read);
    return () => window.removeEventListener(OVERNIGHT_FETCH_EVENT, read);
  }, [ticker, phase, extendedHours]);

  return { series, loading, error, noPe, maHistory, overnightPts };
}
