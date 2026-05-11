// Background chart-data prefetch. Triggered on initial portfolio load
// and on the user's explicit Refresh click ONLY — NOT on the 30 s
// auto-refresh tick (auto-ticks would re-do the same fetches well
// inside each range's TTL with no fresh data to show for it). Walks
// every (range × ticker) combo and writes into both:
//
//   - dp.ytd (PerfChart's per-(range, variant) cache)
//   - dp.tickerChart (TickerChartModal's per-(ticker, range, variant,
//     phase) cache)
//
// so both charts hit cache instantly the next time the user opens
// them. Fire-and-forget — the caller never awaits this; if the user
// closes the tab mid-prefetch the partial writes that landed are
// still useful.
//
// Cost control:
//   - Reads each ticker's TTL from RANGE_TTL_MS before fetching.
//     Ranges whose every ticker is fresh are skipped entirely.
//   - Per-range fetches run in parallel (Promise.all over RANGE_KEYS),
//     then MA + PE run after. Earlier the loop was sequential and
//     the whole prefetch took 30-60 s — long enough that opening a
//     ticker right after Refresh missed the cache on most ranges.
//     The Edge Function batches each range into one HTTP request, so
//     5 concurrent calls (one per range) is well under what Yahoo /
//     Cloudflare will queue.

import { Storage, fetchHistoricalBatch, fetchFundamentals } from './utils.js';
import { fetchParamsFor, maFetchParamsFor, filterToLatestDay, filterToLast24h, RANGE_KEYS } from './ytd.js';
import { RANGE_TTL_MS, MA_TTL_MS, PE_TTL_MS, TICKER_CACHE_CAP, MA_CACHE_CAP, tickerChartCacheKey, isFresh, hasAnyNumericField, trimLru } from './cache.js';
import { isDailyOnly } from './ticker_class.js';
import { priceDividedByTtmEps } from './indicators.js';

// TICKER_CACHE_CAP + MA_CACHE_CAP imported from cache.js so the
// modal's cache writer (modalCacheSet) uses the same value — a
// previous version had 200 hard-coded here and 200 hard-coded
// there; bumping one without the other halved the prefetch's
// headroom on the next modal write.

// Indices we surface a P/E YTD chart for. The fundamentals Edge Function
// maps these to ETF proxies (SPY/QQQ/IWM/SOXX) and serves a cached
// trailing P/E from Alpha Vantage; everything else under MC (^VIX,
// ^TNX, BZ=F, FX pairs) has no meaningful EPS so we don't include it
// in the PE-prefetch candidate list.
const PE_PROXIED_INDICES = new Set(['^GSPC', '^NDX', '^RUT', '^SOX']);

/**
 * @param {{
 *   tickers: string[],
 *   spSymbol: string,
 *   extendedHours: boolean,
 *   phase: string,
 *   mcTickers?: string[],
 * }} opts
 */
export async function prefetchAllChartData({ tickers, spSymbol, extendedHours, phase, mcTickers }) {
  const portfolioTickers = tickers || [];
  const mcList = mcTickers || [];
  if (portfolioTickers.length === 0 && mcList.length === 0) return;
  const year = new Date().getFullYear();
  const useExt = !!(extendedHours && phase && phase !== 'regular');
  // Fetched/cached symbols cover three roles, deduped:
  //   - spSymbol  → benchmark for PerfChart (only the perf cache cares)
  //   - portfolio → both PerfChart series and modal drilldown
  //   - mc        → modal drilldown only (clicking a Market Conditions
  //                 card opens the same TickerChartModal)
  const allSymbols = Array.from(new Set([spSymbol, ...portfolioTickers, ...mcList].filter(Boolean)));
  // Modal-clickable subset — everything except spSymbol (the perf
  // benchmark; modal never opens for it). Used to gate which symbols
  // get written into the dp.tickerChart cache.
  const modalSymbols = new Set(allSymbols.filter(s => s !== spSymbol));

  // Split daily-only symbols (CN funds, .PVT) from intraday-friendly
  // ones so each group gets the right fetch params per range.
  const dailyOnlySet = new Set(allSymbols.filter(s => isDailyOnly(s)));

  // Phase A: build per-range metadata + stale lists from the current
  // cache state. Done up front, before any network calls, so all
  // ranges agree on which symbols are stale and the fetches in
  // Phase B can run concurrently without re-reading storage.
  const ytdCur = Storage.loadYtd();
  const ytdYearStart = ytdCur && ytdCur.year === year && ytdCur.byRange ? ytdCur.byRange : {};
  const tcAllStart = Storage.loadTickerChart() || { entries: {} };

  /** @typedef {{
   *   rk: string,
   *   perfKey: string,
   *   params: any,
   *   tickerKey: (t: string) => string,
   *   stale: string[],
   * }} RangeMeta */
  /** @type {RangeMeta[]} */
  const rangeMeta = [];
  for (const rk of RANGE_KEYS) {
    const params = fetchParamsFor(rk, extendedHours, phase);
    const ttl = RANGE_TTL_MS[rk] || RANGE_TTL_MS.YTD;
    const perfVariant = rk === '1D'
      ? (extendedHours ? 'ext' : (phase === 'regular' ? 'reg' : 'closed'))
      : 'std';
    const perfKey = `${rk}:${perfVariant}`;
    const perfEntries = ytdYearStart[perfKey]?.entries || {};
    /** @param {string} t */
    const tickerKey = (t) => tickerChartCacheKey(t, rk, useExt, phase);
    // 1D cache rows from before the volume-bearing Edge Function
    // shipped still satisfy the TTL but lack a `volume` field on
    // every bar — they'd suppress the modal's VWAP overlay
    // indefinitely. Treat such rows as stale so this prefetch pass
    // refetches them through the redeployed Edge Function.
    const extraValid = rk === '1D' ? hasAnyNumericField('volume') : undefined;
    const stale = allSymbols.filter((s) => {
      const inPerf = isFresh(perfEntries[s], ttl, extraValid);
      // tickerChart cache only covers portfolio tickers (modal never opens for spSymbol)
      const inTicker = s === spSymbol ? true : isFresh(tcAllStart.entries?.[tickerKey(s)], ttl, extraValid);
      return !(inPerf && inTicker);
    });
    rangeMeta.push({ rk, perfKey, params, tickerKey, stale });
  }

  // Phase B: parallel fetches across all stale ranges. The Edge
  // Function batches each range into one HTTP request (per
  // intraday/daily group), so 5 concurrent calls is well under what
  // Yahoo / Cloudflare will queue. Replaces the previous sequential
  // loop that took 30-60 s for a full warm; now closer to 5-10 s.
  const fetchResults = await Promise.all(rangeMeta.map(async (meta) => {
    if (meta.stale.length === 0) return { meta, batch: /** @type {Record<string, any[]>} */ ({}) };
    // Split daily-only symbols (CN funds, .PVT) so each group gets
    // the right interval — without this, prefetch returns empty rows
    // for SPAX.PVT / 6-digit CN funds and the modal then has to do
    // a cold fetch on first open.
    const ixStale  = meta.stale.filter(s => !dailyOnlySet.has(s));
    const dlyStale = meta.stale.filter(s =>  dailyOnlySet.has(s));
    try {
      const [ixBatch, dlyBatch] = await Promise.all([
        ixStale.length > 0
          ? fetchHistoricalBatch(ixStale, meta.params.yahooRange, meta.params.interval, meta.params.includePrePost)
          : Promise.resolve(/** @type {Record<string, any[]>} */ ({})),
        dlyStale.length > 0
          ? fetchHistoricalBatch(dlyStale, meta.params.yahooRange, '1d', false)
          : Promise.resolve(/** @type {Record<string, any[]>} */ ({})),
      ]);
      return { meta, batch: { ...ixBatch, ...dlyBatch } };
    } catch {
      return { meta, batch: /** @type {Record<string, any[]>} */ ({}) };
    }
  }));

  // Phase C: merge all range results into a single dp.ytd write and
  // a single dp.tickerChart write. The serial structure of localStorage
  // means we can't do concurrent writes safely (load → mutate → save
  // would race), so we coalesce.
  const ytdYear = { ...ytdYearStart };
  const tcAll = tcAllStart;
  tcAll.entries = tcAll.entries || {};
  const now = Date.now();
  let tcChanged = false;
  let ytdChanged = false;
  for (const { meta, batch } of fetchResults) {
    if (meta.stale.length === 0) continue;
    const perfEntries = ytdYear[meta.perfKey]?.entries || {};
    /** @type {Record<string, {ts:number, data:any[]}>} */
    const newPerfEntries = { ...perfEntries };
    for (const s of meta.stale) {
      let data = batch[s];
      if (data && meta.params.variant === 'closed') data = filterToLatestDay(data);
      else if (data && (meta.params.variant === 'reg' || meta.params.variant === 'ext')) data = filterToLast24h(data);
      if (data) {
        newPerfEntries[s] = { ts: now, data };
        ytdChanged = true;
      }
    }
    ytdYear[meta.perfKey] = { entries: newPerfEntries };
    for (const t of modalSymbols) {
      let data = batch[t];
      if (data && meta.params.variant === 'closed') data = filterToLatestDay(data);
      else if (data && (meta.params.variant === 'reg' || meta.params.variant === 'ext')) data = filterToLast24h(data);
      if (data && data.length >= 2) {
        tcAll.entries[meta.tickerKey(t)] = { ts: now, data };
        tcChanged = true;
      }
    }
  }
  if (ytdChanged) Storage.saveYtd({ year, byRange: ytdYear });
  if (tcChanged) {
    trimLru(tcAll, TICKER_CACHE_CAP);
    Storage.saveTickerChart(tcAll);
  }

  // ---- Moving-average history prefetch
  // The TickerChartModal's MA overlay reads a separate, wider series
  // than the displayed chart (1mo/30m for 1W, 3mo/60m for 1M, 6mo/1d
  // for 3M, 1y/1d for YTD; dailyOnly tickers override interval=1d
  // at every range). Without warming this cache, opening any modal
  // triggered a cold network fetch for the MA history — visible as a
  // late-rendering gray line. Walk the same (range × ticker) grid
  // and warm `${ticker}|MA|${range}` so the modal hits cache
  // instantly. spSymbol included so MC modals (^GSPC etc.) opened
  // from the home page are also instant.
  //
  // MA rows live in their OWN dp.maCache LRU — a separate
  // localStorage entry from dp.tickerChart. Otherwise this loop
  // (which runs after the display-range loop and writes newer
  // timestamps) would push the freshly warmed display rows out of
  // the shared 200-entry LRU and the next modal open would still
  // pay a cold fetch. Per-cache cap below sized for ~50 modal
  // tickers × 4 MA ranges = 200 entries.
  // MA_CACHE_CAP imported from cache.js.
  const maStoreStart = Storage.loadMaCache() || { entries: {} };
  // MA history is keyed by wider-history fetch; a single bar is
  // valid, so don't require the 2-bar floor isFresh applies.
  const isFreshMa = (entry) =>
    !!entry && Array.isArray(entry.data) && entry.data.length > 0 &&
    (Date.now() - (entry.ts || 0)) < MA_TTL_MS;
  // Parallel fetches across the 4 MA ranges (1W / 1M / 3M / YTD;
  // 1D is excluded). Same pattern as the per-range loop above —
  // pulls 4 → 1 HTTP round-trip widths to ~1, then merges writes.
  const maRangeMeta = RANGE_KEYS
    .filter(rk => rk !== '1D')
    .map(rk => {
      const maKey = (t) => `${t}|MA|${rk}`;
      const ixSymbols  = allSymbols.filter(s => !dailyOnlySet.has(s));
      const dlySymbols = allSymbols.filter(s =>  dailyOnlySet.has(s));
      const ixStaleMa  = ixSymbols.filter(s => !isFreshMa(maStoreStart.entries?.[maKey(s)]));
      const dlyStaleMa = dlySymbols.filter(s => !isFreshMa(maStoreStart.entries?.[maKey(s)]));
      return {
        rk, maKey, ixStaleMa, dlyStaleMa,
        ixParams: maFetchParamsFor(rk, false),
        dlyParams: maFetchParamsFor(rk, true),
      };
    });
  const maFetchResults = await Promise.all(maRangeMeta.map(async (meta) => {
    if (meta.ixStaleMa.length === 0 && meta.dlyStaleMa.length === 0) {
      return { meta, batch: /** @type {Record<string, any[]>} */ ({}) };
    }
    if (!meta.ixParams && !meta.dlyParams) {
      return { meta, batch: /** @type {Record<string, any[]>} */ ({}) };
    }
    try {
      const [ixBatch, dlyBatch] = await Promise.all([
        meta.ixStaleMa.length > 0 && meta.ixParams
          ? fetchHistoricalBatch(meta.ixStaleMa, meta.ixParams.range, meta.ixParams.interval, false)
          : Promise.resolve(/** @type {Record<string, any[]>} */ ({})),
        meta.dlyStaleMa.length > 0 && meta.dlyParams
          ? fetchHistoricalBatch(meta.dlyStaleMa, meta.dlyParams.range, meta.dlyParams.interval, false)
          : Promise.resolve(/** @type {Record<string, any[]>} */ ({})),
      ]);
      return { meta, batch: { ...ixBatch, ...dlyBatch } };
    } catch {
      return { meta, batch: /** @type {Record<string, any[]>} */ ({}) };
    }
  }));
  const maStore = maStoreStart;
  maStore.entries = maStore.entries || {};
  let maChanged = false;
  const maNow = Date.now();
  for (const { meta, batch } of maFetchResults) {
    for (const t of [...meta.ixStaleMa, ...meta.dlyStaleMa]) {
      const data = batch[t];
      if (!Array.isArray(data) || data.length === 0) continue;
      const sorted = data
        .filter(p => typeof p.date === 'string' && isFinite(Number(p.close)) && p.close > 0)
        .slice()
        .sort((a, b) => a.date < b.date ? -1 : 1);
      if (sorted.length === 0) continue;
      maStore.entries[meta.maKey(t)] = { ts: maNow, data: sorted };
      maChanged = true;
    }
  }
  if (maChanged) {
    trimLru(maStore, MA_CACHE_CAP);
    Storage.saveMaCache(maStore);
  }

  // P/E YTD prefetch — two writes per eligible ticker:
  //
  //   1. `${ticker}|FUND|v1` — the raw fundamentals row (eps / pe /
  //      pe3yAvg / ttmEpsHistory). Modal first-render reads this
  //      synchronously to decide whether to show the P/E YTD button
  //      and to fill in pe3yAvg, so the button stops "popping in"
  //      a couple of seconds after the modal opens.
  //
  //   2. `${ticker}|PE|v3|${variant}|${phase}` — the TTM-aware P/E
  //      series. Same key shape the modal reads (the previous
  //      prefetch wrote `|PE|${variant}|${phase}` without the v3
  //      suffix, so the cache was actually dead). priceDividedByTtmEps
  //      uses each quarter-end TTM EPS as the denominator instead of
  //      a single constant, matching the on-modal computation.
  //
  // Skipped when every ticker already has a fresh PE+FUND entry so
  // the auto-refresh tick (which doesn't call this function) and
  // back-to-back manual refreshes don't burn Finnhub quota.
  // Re-load here (instead of reusing the per-range pass's `tcAll`)
  // so the PE block sees the chart entries the per-range Phase C
  // just wrote — needed by the YTD-fresh check before fetching.
  const tcAllPe = Storage.loadTickerChart() || { entries: {} };
  const ytdNow = Storage.loadYtd();
  const ytdEntriesNow = ytdNow?.byRange?.['YTD:std']?.entries ?? {};
  const fundKey = (t) => `${t}|FUND|v1`;
  const peKey   = (t) => tickerChartCacheKey(t, 'PE', useExt, phase);
  // Only consider tickers that (a) have a freshly-cached YTD daily
  // series we can divide, and (b) don't already have a fresh PE
  // entry. Portfolio tickers come from `tickers`; the four big US
  // indices (^GSPC/^NDX/^RUT/^SOX) come in via `mcTickers` and are
  // gated by PE_PROXIED_INDICES. Other MC symbols (^VIX/^TNX/BZ=F/
  // forex) have no EPS so they're filtered server-side too.
  const peEligible = Array.from(new Set([
    ...portfolioTickers,
    ...mcList.filter(t => PE_PROXIED_INDICES.has(t)),
  ]));
  const peCandidates = peEligible.filter((t) => {
    if (!isFresh(ytdEntriesNow[t], PE_TTL_MS)) return false;
    // Refetch when either cache row is stale — we always write both
    // in the same pass, so freshness is in lockstep in practice.
    const fundFresh = isFresh(
      /** @type {any} */ ({ ts: tcAllPe.entries?.[fundKey(t)]?.ts || 0, data: [1, 2] }),
      PE_TTL_MS,
    );
    const peFresh = isFresh(tcAllPe.entries?.[peKey(t)], PE_TTL_MS);
    return !(fundFresh && peFresh);
  });
  if (peCandidates.length > 0) {
    let fundamentals = {};
    try {
      // ttmEpsHistory=true asks the Edge Function for the rolling
      // quarter-end TTM-EPS array Yahoo's fundamentals-timeseries
      // returns; without it the modal's PE chart would have to do
      // its own second fetchFundamentals call on first open.
      fundamentals = await fetchFundamentals(peCandidates, { ttmEpsHistory: true });
    } catch { /* fall through — leave fresh PE entries unwritten */ }
    tcAllPe.entries = tcAllPe.entries || {};
    let peTcChanged = false;
    const peNow = Date.now();
    for (const t of peCandidates) {
      const row = fundamentals?.[t];
      if (!row) continue;
      // (1) Cache the row itself for the modal's first-render gate.
      tcAllPe.entries[fundKey(t)] = { ts: peNow, data: row };
      peTcChanged = true;
      // (2) Compute the TTM-aware PE series for the modal's
      // P/E YTD chart. ETF-proxy tickers (^GSPC/^NDX/^RUT) come
      // back with eps:0 — reconstruct an implied EPS from the last
      // close ÷ trailing P/E so the const-EPS fallback inside
      // priceDividedByTtmEps still produces drawable values.
      let eps = row.eps;
      const pe = row.pe;
      const ytdData = ytdEntriesNow[t].data;
      if ((typeof eps !== 'number' || eps <= 0) && typeof pe === 'number' && pe > 0 && ytdData.length > 0) {
        eps = ytdData[ytdData.length - 1].close / pe;
      }
      if (typeof eps !== 'number' || eps <= 0) continue;
      const peSeries = priceDividedByTtmEps(ytdData, row.ttmEpsHistory, eps);
      tcAllPe.entries[peKey(t)] = { ts: peNow, data: peSeries };
    }
    if (peTcChanged) {
      trimLru(tcAllPe, TICKER_CACHE_CAP);
      Storage.saveTickerChart(tcAllPe);
    }
  }
}
