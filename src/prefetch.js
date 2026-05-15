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

import { fetchHistoricalBatch, fetchFundamentals } from './utils.js';
import { fetchParamsFor, maFetchParamsFor, filterToLatestDay, filterToLast24h, RANGE_KEYS } from './ytd.js';
import { RANGE_TTL_MS, MA_TTL_MS, PE_TTL_MS, tickerChartCacheKey, isFresh, hasAnyNumericField } from './cache.js';
import { isDailyOnly } from './ticker_class.js';
import { priceDividedByTtmEps } from './indicators.js';
import { ChartStore, MaStore, YtdStore, hydrateAllChartStores } from './chart_store.js';

// All chart cache I/O goes through `ChartStore` / `MaStore` /
// `YtdStore` (chart_store.js) — IndexedDB-backed, synchronous
// in-memory mirror, no per-entry localStorage trim. The previous
// localStorage-only implementation regularly hit the per-origin
// 5-10 MB quota when a portfolio had ~30 tickers × all ranges ×
// multiple variants, at which point every Storage.saveTickerChart
// silently failed. With IDB the prefetch can warm everything for
// every (ticker × range × variant × phase) without trim-thrashing.

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
  // Make sure the IDB-backed in-memory mirror is hydrated before we
  // do any sync staleness checks — without this the very first
  // prefetch on a hard-refresh page-load might think every entry is
  // stale (mirror still empty) and re-fetch everything from scratch
  // even when persisted IDB data was perfectly fresh.
  await hydrateAllChartStores();
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
  // Phase B can run concurrently. ChartStore / YtdStore reads are
  // sync against the in-memory IDB mirror.

  /** @typedef {{
   *   rk: string,
   *   perfKey: string,
   *   ytdKey: (t: string) => string,
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
    /** @param {string} t */
    const tickerKey = (t) => tickerChartCacheKey(t, rk, useExt, phase);
    /** @param {string} t */
    const ytdKey = (t) => `y${year}|${perfKey}|${t}`;
    // 1D cache rows from before the volume-bearing Edge Function
    // shipped still satisfy the TTL but lack a `volume` field on
    // every bar — they'd suppress the modal's VWAP overlay
    // indefinitely. Treat such rows as stale so this prefetch pass
    // refetches them through the redeployed Edge Function.
    const extraValid = rk === '1D' ? hasAnyNumericField('volume') : undefined;
    const stale = allSymbols.filter((s) => {
      const inPerf = isFresh(YtdStore.get(ytdKey(s)), ttl, extraValid);
      // tickerChart cache only covers portfolio tickers (modal never opens for spSymbol)
      const inTicker = s === spSymbol ? true : isFresh(ChartStore.get(tickerKey(s)), ttl, extraValid);
      return !(inPerf && inTicker);
    });
    rangeMeta.push({ rk, perfKey, ytdKey, params, tickerKey, stale });
  }

  // Phase B: parallel fetches across all stale ranges, with each
  // range writing its OWN chunk of dp.ytd / dp.tickerChart as soon
  // as its fetch resolves. Earlier the writes were coalesced into a
  // single Phase C after `Promise.all` — but Promise.all waits for
  // the SLOWEST range (1M intraday with `range=3mo, interval=60m` is
  // usually it; that's ~1k bars × 20 tickers from Yahoo), so a 15-20s
  // 1M response was leaving the user's cache empty for every range
  // until then. Writing per-range means 1D/3M/YTD land in localStorage
  // within a couple of seconds even while 1M is still in flight.
  //
  // Race safety: JS is single-threaded — every `.then()` callback
  // below runs atomically wrt the others (load → mutate → save is
  // one synchronous block), so two near-simultaneous range
  // resolutions can't interleave their localStorage writes.
  await Promise.all(rangeMeta.map(async (meta) => {
    if (meta.stale.length === 0) return;
    const ixStale  = meta.stale.filter(s => !dailyOnlySet.has(s));
    const dlyStale = meta.stale.filter(s =>  dailyOnlySet.has(s));
    /** @type {Record<string, any[]>} */
    let batch = {};
    try {
      const [ixBatch, dlyBatch] = await Promise.all([
        ixStale.length > 0
          ? fetchHistoricalBatch(ixStale, meta.params.yahooRange, meta.params.interval, meta.params.includePrePost)
          : Promise.resolve(/** @type {Record<string, any[]>} */ ({})),
        dlyStale.length > 0
          ? fetchHistoricalBatch(dlyStale, meta.params.yahooRange, '1d', false)
          : Promise.resolve(/** @type {Record<string, any[]>} */ ({})),
      ]);
      batch = { ...ixBatch, ...dlyBatch };
    } catch {
      return;  // leave caches alone on a network error
    }
    // ---- Write this range's chunk to YtdStore + ChartStore.
    // Per-entry sets — IDB has no quota concern so we don't merge
    // into a single big object then trim.
    const now = Date.now();
    for (const s of meta.stale) {
      let data = batch[s];
      if (data && meta.params.variant === 'closed') data = filterToLatestDay(data);
      else if (data && (meta.params.variant === 'reg' || meta.params.variant === 'ext')) data = filterToLast24h(data);
      if (data) {
        YtdStore.set(meta.ytdKey(s), { ts: now, data });
      }
    }
    for (const t of modalSymbols) {
      let data = batch[t];
      if (data && meta.params.variant === 'closed') data = filterToLatestDay(data);
      else if (data && (meta.params.variant === 'reg' || meta.params.variant === 'ext')) data = filterToLast24h(data);
      if (data && data.length >= 2) {
        ChartStore.set(meta.tickerKey(t), { ts: now, data });
      }
    }
  }));

  // ---- Moving-average history prefetch (writes to MaStore /
  // dp.maCache via IDB). Same parallel-immediate-write pattern as
  // the chart-range loop. 1D excluded — MA overlay isn't drawn on
  // the single-session view.
  const isFreshMa = (entry) =>
    !!entry && Array.isArray(entry.data) && entry.data.length > 0 &&
    (Date.now() - (entry.ts || 0)) < MA_TTL_MS;
  const maRangeMeta = RANGE_KEYS
    .filter(rk => rk !== '1D')
    .map(rk => {
      const maKey = (t) => `${t}|MA|${rk}`;
      const ixSymbols  = allSymbols.filter(s => !dailyOnlySet.has(s));
      const dlySymbols = allSymbols.filter(s =>  dailyOnlySet.has(s));
      const ixStaleMa  = ixSymbols.filter(s => !isFreshMa(MaStore.get(maKey(s))));
      const dlyStaleMa = dlySymbols.filter(s => !isFreshMa(MaStore.get(maKey(s))));
      return {
        rk, maKey, ixStaleMa, dlyStaleMa,
        ixParams: maFetchParamsFor(rk, false),
        dlyParams: maFetchParamsFor(rk, true),
      };
    });
  await Promise.all(maRangeMeta.map(async (meta) => {
    if (meta.ixStaleMa.length === 0 && meta.dlyStaleMa.length === 0) return;
    if (!meta.ixParams && !meta.dlyParams) return;
    /** @type {Record<string, any[]>} */
    let batch = {};
    try {
      const [ixBatch, dlyBatch] = await Promise.all([
        meta.ixStaleMa.length > 0 && meta.ixParams
          ? fetchHistoricalBatch(meta.ixStaleMa, meta.ixParams.range, meta.ixParams.interval, false)
          : Promise.resolve(/** @type {Record<string, any[]>} */ ({})),
        meta.dlyStaleMa.length > 0 && meta.dlyParams
          ? fetchHistoricalBatch(meta.dlyStaleMa, meta.dlyParams.range, meta.dlyParams.interval, false)
          : Promise.resolve(/** @type {Record<string, any[]>} */ ({})),
      ]);
      batch = { ...ixBatch, ...dlyBatch };
    } catch { return; }
    const now = Date.now();
    for (const t of [...meta.ixStaleMa, ...meta.dlyStaleMa]) {
      const data = batch[t];
      if (!Array.isArray(data) || data.length === 0) continue;
      const sorted = data
        .filter(p => typeof p.date === 'string' && isFinite(Number(p.close)) && p.close > 0)
        .slice()
        .sort((a, b) => a.date < b.date ? -1 : 1);
      if (sorted.length === 0) continue;
      MaStore.set(meta.maKey(t), { ts: now, data: sorted });
    }
  }));

  // P/E YTD prefetch — two writes per eligible ticker:
  //
  //   1. `${ticker}|FUND|v2` — the raw fundamentals row (eps / pe /
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
  // Reads come from the in-memory mirror (sync), so the per-range
  // pass's writes above are already visible here.
  const fundKey = (t) => `${t}|FUND|v2`;
  const peKey   = (t) => tickerChartCacheKey(t, 'PE', useExt, phase);
  const psKey   = (t) => tickerChartCacheKey(t, 'PS', useExt, phase);
  const ytdEntryFor = (t) => YtdStore.get(`y${year}|YTD:std|${t}`);
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
    if (!isFresh(ytdEntryFor(t), PE_TTL_MS)) return false;
    // Refetch when FUND is stale OR the ticker has neither a fresh
    // PE nor a fresh PS series — we write whichever applies in the
    // same pass so freshness is in lockstep, but profitable tickers
    // get a PE row and loss-makers get a PS row, never both.
    const fundEntry = ChartStore.get(fundKey(t));
    const fundFresh = !!fundEntry && (Date.now() - (fundEntry.ts || 0)) < PE_TTL_MS;
    const ratioFresh = isFresh(ChartStore.get(peKey(t)), PE_TTL_MS)
                     || isFresh(ChartStore.get(psKey(t)), PE_TTL_MS);
    return !(fundFresh && ratioFresh);
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
    const peNow = Date.now();
    for (const t of peCandidates) {
      const row = fundamentals?.[t];
      if (!row) continue;
      // (1) Cache the row itself for the modal's first-render gate.
      ChartStore.set(fundKey(t), { ts: peNow, data: row });
      // (2) Compute the TTM-aware PE series for the modal's
      // P/E YTD chart. ETF-proxy tickers (^GSPC/^NDX/^RUT) come
      // back with eps:0 — reconstruct an implied EPS from the last
      // close ÷ trailing P/E so the const-EPS fallback inside
      // priceDividedByTtmEps still produces drawable values.
      // Always derive USD eps from `lastClose / pe` whenever the
      // Edge Function shipped a pe — FMP's reported eps for ADRs
      // is in the underlying foreign currency, which would
      // re-introduce the original TSM=1.22 / SFTBY=0.07 / ASML=63
      // bug. The implied USD EPS that pe was computed against is
      // the only field guaranteed to be in the same unit as the
      // USD price points the chart is going to divide.
      let eps = row.eps;
      const pe = row.pe;
      const ytdEntry = ytdEntryFor(t);
      const ytdData = ytdEntry?.data || [];
      if (typeof pe === 'number' && pe > 0 && ytdData.length > 0) {
        eps = ytdData[ytdData.length - 1].close / pe;
      }
      if (typeof eps === 'number' && eps > 0) {
        const peSeries = priceDividedByTtmEps(ytdData, row.ttmEpsHistory, eps);
        ChartStore.set(peKey(t), { ts: peNow, data: peSeries });
      } else if (typeof row.ps === 'number' && row.ps > 0 && ytdData.length > 0) {
        // (3) Loss-maker fallback: no usable EPS but the Edge Function
        // shipped a `ps` — precompute the P/S YTD series so clicking
        // P/S YTD in the modal hits cache instantly. Derive
        // sales-per-share from lastClose / ps for the same
        // ADR-currency-safe reason as the EPS path above, and pass
        // `ttmSalesHistory` so the curve steps on earnings — matching
        // the modal's own transform. Passing null here (the old
        // behaviour) wrote a const-denominator series that masked the
        // real one until the 12 h TTL expired, so the P/S YTD chart
        // stayed a 1:1 rescale of the price line.
        const salesPerShare = ytdData[ytdData.length - 1].close / row.ps;
        if (salesPerShare > 0) {
          const psSeries = priceDividedByTtmEps(ytdData, row.ttmSalesHistory, salesPerShare);
          ChartStore.set(psKey(t), { ts: peNow, data: psSeries });
        }
      }
    }
  }
}
