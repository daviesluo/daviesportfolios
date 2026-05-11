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
//   - Sequential by range (1D → 1W → 1M → 3M → YTD) — only one
//     in-flight HTTP request at a time, so we don't pin the browser
//     on five concurrent N-ticker batches.

import { Storage, fetchHistoricalBatch, fetchFundamentals } from './utils.js';
import { fetchParamsFor, maFetchParamsFor, filterToLatestDay, filterToLast24h, RANGE_KEYS } from './ytd.js';
import { RANGE_TTL_MS, MA_TTL_MS, PE_TTL_MS, isFresh, hasAnyNumericField, trimLru } from './cache.js';
import { isDailyOnly } from './ticker_class.js';

const TICKER_CACHE_CAP = 200;

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
  const tickerVariantTag = useExt ? 'ext' : 'reg';
  const phaseTag = phase || '';
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

  for (const rk of RANGE_KEYS) {
    const params = fetchParamsFor(rk, extendedHours, phase);
    const ttl = RANGE_TTL_MS[rk] || RANGE_TTL_MS.YTD;
    const perfVariant = rk === '1D'
      ? (extendedHours ? 'ext' : (phase === 'regular' ? 'reg' : 'closed'))
      : 'std';
    const perfKey = `${rk}:${perfVariant}`;

    // ---- Read both caches and pick out which symbols still need a fetch
    const ytdCur = Storage.loadYtd();
    const ytdYear = ytdCur && ytdCur.year === year && ytdCur.byRange ? ytdCur.byRange : {};
    const perfEntries = ytdYear[perfKey]?.entries || {};

    const tcAll = Storage.loadTickerChart() || { entries: {} };
    /** @param {string} t */
    const tickerKey = (t) => `${t}|${rk}|${tickerVariantTag}|${phaseTag}`;

    // 1D cache rows from before the volume-bearing Edge Function
    // shipped still satisfy the TTL but lack a `volume` field on
    // every bar — they'd suppress the modal's VWAP overlay
    // indefinitely. Treat such rows as stale so this prefetch pass
    // refetches them through the redeployed Edge Function.
    const extraValid = rk === '1D' ? hasAnyNumericField('volume') : undefined;
    const stale = allSymbols.filter((s) => {
      const inPerf = isFresh(perfEntries[s], ttl, extraValid);
      // tickerChart cache only covers portfolio tickers (modal never opens for spSymbol)
      const inTicker = s === spSymbol ? true : isFresh(tcAll.entries?.[tickerKey(s)], ttl, extraValid);
      return !(inPerf && inTicker);
    });
    if (stale.length === 0) continue;

    // Run two parallel batches when the stale list mixes intraday and
    // daily-only symbols — one with the range's normal interval, one
    // with `interval=1d` for the symbols Yahoo doesn't have intraday
    // data for. Without this split, prefetch returns empty rows for
    // SPAX.PVT / 6-digit CN funds and the modal then has to do a
    // cold fetch on first open even though prefetch supposedly ran.
    const ixStale  = stale.filter(s => !dailyOnlySet.has(s));
    const dlyStale = stale.filter(s =>  dailyOnlySet.has(s));
    /** @type {Record<string, any[]>} */
    let batch = {};
    try {
      const [ixBatch, dlyBatch] = await Promise.all([
        ixStale.length > 0
          ? fetchHistoricalBatch(ixStale, params.yahooRange, params.interval, params.includePrePost)
          : Promise.resolve({}),
        dlyStale.length > 0
          ? fetchHistoricalBatch(dlyStale, params.yahooRange, '1d', false)
          : Promise.resolve({}),
      ]);
      batch = { ...ixBatch, ...dlyBatch };
    } catch { continue; }

    // ---- Write back to dp.ytd (PerfChart cache)
    const now = Date.now();
    /** @type {Record<string, {ts:number, data:any[]}>} */
    const newPerfEntries = { ...perfEntries };
    for (const s of stale) {
      let data = batch[s];
      if (data && params.variant === 'closed') data = filterToLatestDay(data);
      else if (data && (params.variant === 'reg' || params.variant === 'ext')) data = filterToLast24h(data);
      if (data) newPerfEntries[s] = { ts: now, data };
    }
    ytdYear[perfKey] = { entries: newPerfEntries };
    Storage.saveYtd({ year, byRange: ytdYear });

    // ---- Write back to dp.tickerChart (TickerChartModal cache)
    // Covers portfolio tickers AND Market-Conditions tickers — modal
    // drilldown opens for both. Skip spSymbol (modal never opens for
    // the PerfChart benchmark).
    let tcChanged = false;
    for (const t of modalSymbols) {
      let data = batch[t];
      if (data && params.variant === 'closed') data = filterToLatestDay(data);
      else if (data && (params.variant === 'reg' || params.variant === 'ext')) data = filterToLast24h(data);
      if (data && data.length >= 2) {
        tcAll.entries = tcAll.entries || {};
        tcAll.entries[tickerKey(t)] = { ts: now, data };
        tcChanged = true;
      }
    }
    if (tcChanged) {
      trimLru(tcAll, TICKER_CACHE_CAP);
      Storage.saveTickerChart(tcAll);
    }
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
  const MA_CACHE_CAP = 240;
  for (const rk of RANGE_KEYS) {
    if (rk === '1D') continue; // MA overlay skips 1D (single-session view)
    const maStoreRead = Storage.loadMaCache() || { entries: {} };
    const maKey = (t) => `${t}|MA|${rk}`;
    // MA history is keyed by wider-history fetch; a single bar is
    // valid, so don't require the 2-bar floor isFresh applies.
    const isFreshMa = (entry) =>
      !!entry && Array.isArray(entry.data) && entry.data.length > 0 &&
      (Date.now() - (entry.ts || 0)) < MA_TTL_MS;

    const ixSymbols  = allSymbols.filter(s => !dailyOnlySet.has(s));
    const dlySymbols = allSymbols.filter(s =>  dailyOnlySet.has(s));
    const ixStaleMa  = ixSymbols.filter(s => !isFreshMa(maStoreRead.entries?.[maKey(s)]));
    const dlyStaleMa = dlySymbols.filter(s => !isFreshMa(maStoreRead.entries?.[maKey(s)]));
    if (ixStaleMa.length === 0 && dlyStaleMa.length === 0) continue;

    const ixParams  = maFetchParamsFor(rk, false);
    const dlyParams = maFetchParamsFor(rk, true);
    if (!ixParams && !dlyParams) continue;

    /** @type {Record<string, any[]>} */
    let maBatch = {};
    try {
      const [ixBatch, dlyBatch] = await Promise.all([
        ixStaleMa.length > 0 && ixParams
          ? fetchHistoricalBatch(ixStaleMa, ixParams.range, ixParams.interval, false)
          : Promise.resolve({}),
        dlyStaleMa.length > 0 && dlyParams
          ? fetchHistoricalBatch(dlyStaleMa, dlyParams.range, dlyParams.interval, false)
          : Promise.resolve({}),
      ]);
      maBatch = { ...ixBatch, ...dlyBatch };
    } catch { continue; }

    const maStore = Storage.loadMaCache() || { entries: {} };
    maStore.entries = maStore.entries || {};
    let maChanged = false;
    const now = Date.now();
    for (const t of [...ixStaleMa, ...dlyStaleMa]) {
      const data = maBatch[t];
      if (!Array.isArray(data) || data.length === 0) continue;
      const sorted = data
        .filter(p => typeof p.date === 'string' && isFinite(Number(p.close)) && p.close > 0)
        .slice()
        .sort((a, b) => a.date < b.date ? -1 : 1);
      if (sorted.length === 0) continue;
      maStore.entries[maKey(t)] = { ts: now, data: sorted };
      maChanged = true;
    }
    if (maChanged) {
      trimLru(maStore, MA_CACHE_CAP);
      Storage.saveMaCache(maStore);
    }
  }

  // P/E YTD prefetch — divides each ticker's freshly-cached YTD daily
  // closes by the current TTM EPS (one batched fetchFundamentals
  // call) to produce a P/E series for the ticker modal. Cached under
  // the same `${ticker}|PE|${variant}|${phase}` key shape the modal
  // reads. Skipped when every ticker already has a fresh PE entry,
  // so the auto-refresh tick (which doesn't call this function) and
  // back-to-back manual refreshes don't burn Finnhub quota.
  const tcAll = Storage.loadTickerChart() || { entries: {} };
  const ytdNow = Storage.loadYtd();
  const ytdEntriesNow = ytdNow?.byRange?.['YTD:std']?.entries ?? {};
  const peKey = (t) => `${t}|PE|${tickerVariantTag}|${phaseTag}`;
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
    return !isFresh(tcAll.entries?.[peKey(t)], PE_TTL_MS);
  });
  if (peCandidates.length > 0) {
    let fundamentals = {};
    try {
      fundamentals = await fetchFundamentals(peCandidates);
    } catch { /* fall through — leave fresh PE entries unwritten */ }
    tcAll.entries = tcAll.entries || {};
    let tcChanged = false;
    const now = Date.now();
    for (const t of peCandidates) {
      const row = fundamentals?.[t];
      let eps = row?.eps;
      const pe = row?.pe;
      const ytdData = ytdEntriesNow[t].data;
      // ETF-proxy tickers (^GSPC/^NDX/^RUT) come back with eps:0 —
      // reconstruct an implied EPS from the last close ÷ trailing P/E
      // so the historical series can still be divided into P/E values.
      if ((typeof eps !== 'number' || eps <= 0) && typeof pe === 'number' && pe > 0 && ytdData.length > 0) {
        eps = ytdData[ytdData.length - 1].close / pe;
      }
      if (typeof eps !== 'number' || eps <= 0) continue;
      const peSeries = ytdData.map((p) => ({ date: p.date, close: p.close / eps }));
      tcAll.entries[peKey(t)] = { ts: now, data: peSeries };
      tcChanged = true;
    }
    if (tcChanged) {
      trimLru(tcAll, TICKER_CACHE_CAP);
      Storage.saveTickerChart(tcAll);
    }
  }
}
