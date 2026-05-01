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
import { fetchParamsFor, filterToLatestDay, filterToLast24h, RANGE_KEYS } from './ytd.js';

// Match each range's bar interval — same shape PerfChart and the
// TickerChartModal use. Past TTL the prefetch decides "stale" and
// refetches; under TTL it's a no-op (and downstream stale-while-
// revalidate handles the same range from cache).
const RANGE_TTL_MS = {
  '1D':  5  * 60 * 1000,
  '1W':  30 * 60 * 1000,
  '1M':  60 * 60 * 1000,
  '3M':  12 * 60 * 60 * 1000,
  'YTD': 12 * 60 * 60 * 1000,
};

const TICKER_CACHE_CAP = 200;

// Same predicate the TickerChartModal uses — CN mutual funds publish
// one NAV per trading day, and .PVT placeholders don't have intraday
// data on Yahoo. Both flip the prefetch to interval=1d so the cache
// row matches what the modal will subsequently read; otherwise the
// prefetch would land empty intraday rows and the modal would still
// pay a cold fetch on first open.
const DAILY_ONLY_RE = /^(?:\d{6}|.*\.PVT)$/i;

/**
 * @param {{ tickers: string[], spSymbol: string, extendedHours: boolean, phase: string }} opts
 */
export async function prefetchAllChartData({ tickers, spSymbol, extendedHours, phase }) {
  if (!tickers || tickers.length === 0) return;
  const year = new Date().getFullYear();
  const useExt = !!(extendedHours && phase && phase !== 'regular');
  const tickerVariantTag = useExt ? 'ext' : 'reg';
  const phaseTag = phase || '';
  const allSymbols = [spSymbol, ...tickers];

  // Split daily-only symbols (CN funds, .PVT) from intraday-friendly
  // ones so each group gets the right fetch params per range.
  const dailyOnlySet = new Set(allSymbols.filter(s => DAILY_ONLY_RE.test(s)));

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

    const isFresh = (entry) =>
      entry && entry.data && Array.isArray(entry.data) && entry.data.length >= 2 &&
      (Date.now() - (entry.ts || 0)) < ttl;

    const stale = allSymbols.filter((s) => {
      const inPerf = isFresh(perfEntries[s]);
      // tickerChart cache only covers portfolio tickers (modal never opens for spSymbol)
      const inTicker = s === spSymbol ? true : isFresh(tcAll.entries?.[tickerKey(s)]);
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
    let tcChanged = false;
    for (const t of tickers) {  // skip spSymbol — never opens in the modal
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
      // Soft LRU cap so the localStorage entry can't bloat unboundedly.
      const keys = Object.keys(tcAll.entries);
      if (keys.length > TICKER_CACHE_CAP) {
        const sorted = keys
          .map((k) => ({ k, ts: tcAll.entries[k]?.ts || 0 }))
          .sort((a, b) => b.ts - a.ts);
        /** @type {Record<string, {ts:number, data:any[]}>} */
        const trimmed = {};
        for (let i = 0; i < TICKER_CACHE_CAP; i++) trimmed[sorted[i].k] = tcAll.entries[sorted[i].k];
        tcAll.entries = trimmed;
      }
      Storage.saveTickerChart(tcAll);
    }
  }

  // P/E YTD prefetch — divides each ticker's freshly-cached YTD daily
  // closes by the current TTM EPS (one batched fetchFundamentals
  // call) to produce a P/E series for the ticker modal. Cached under
  // the same `${ticker}|PE|${variant}|${phase}` key shape the modal
  // reads. Skipped when every ticker already has a fresh PE entry,
  // so the auto-refresh tick (which doesn't call this function) and
  // back-to-back manual refreshes don't burn Finnhub quota.
  const peTtl = 12 * 60 * 60 * 1000; // 12 h, matches YTD's TTL
  const tcAll = Storage.loadTickerChart() || { entries: {} };
  const ytdNow = Storage.loadYtd();
  const ytdEntriesNow = ytdNow?.byRange?.['YTD:std']?.entries ?? {};
  const peKey = (t) => `${t}|PE|${tickerVariantTag}|${phaseTag}`;
  // Only consider tickers that (a) have a freshly-cached YTD daily
  // series we can divide, and (b) don't already have a fresh PE
  // entry. Indices / futures / .PVT / CN funds / crypto / forex
  // never get a PE entry from the Edge Function so they're naturally
  // skipped — fetchFundamentals filters them server-side too.
  const peCandidates = tickers.filter((t) => {
    const ytd = ytdEntriesNow[t];
    if (!ytd?.data || !Array.isArray(ytd.data) || ytd.data.length < 2) return false;
    const cached = tcAll.entries?.[peKey(t)];
    return !(cached && cached.data && (Date.now() - (cached.ts || 0)) < peTtl);
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
      const eps = fundamentals?.[t]?.eps;
      if (typeof eps !== 'number' || eps <= 0) continue;
      const ytdData = ytdEntriesNow[t].data;
      const peSeries = ytdData.map((p) => ({ date: p.date, close: p.close / eps }));
      tcAll.entries[peKey(t)] = { ts: now, data: peSeries };
      tcChanged = true;
    }
    if (tcChanged) {
      // Same LRU cap as the per-range writes above.
      const keys = Object.keys(tcAll.entries);
      if (keys.length > TICKER_CACHE_CAP) {
        const sorted = keys
          .map((k) => ({ k, ts: tcAll.entries[k]?.ts || 0 }))
          .sort((a, b) => b.ts - a.ts);
        /** @type {Record<string, {ts:number, data:any[]}>} */
        const trimmed = {};
        for (let i = 0; i < TICKER_CACHE_CAP; i++) trimmed[sorted[i].k] = tcAll.entries[sorted[i].k];
        tcAll.entries = trimmed;
      }
      Storage.saveTickerChart(tcAll);
    }
  }
}
