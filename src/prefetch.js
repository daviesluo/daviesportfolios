// Background chart-data prefetch. Triggered after every successful
// price refresh (manual Refresh click + auto-refresh tick + initial
// load). Walks every (range × ticker) combo and writes into both:
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
//     Ranges whose every ticker is fresh are skipped entirely
//     (zero-network ticks under the auto-refresh interval).
//   - Sequential by range (1D → 1W → 1M → 3M → YTD) with a 200 ms
//     pause between each, so the browser isn't pinned on network
//     IO with 5 concurrent N-ticker batches.

import { Storage, fetchHistoricalBatch } from './utils.js';
import { fetchParamsFor, filterToLatestDay, RANGE_KEYS } from './ytd.js';

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

    let batch;
    try {
      batch = await fetchHistoricalBatch(
        stale, params.yahooRange, params.interval, params.includePrePost,
      );
    } catch { continue; }

    // ---- Write back to dp.ytd (PerfChart cache)
    const now = Date.now();
    /** @type {Record<string, {ts:number, data:any[]}>} */
    const newPerfEntries = { ...perfEntries };
    for (const s of stale) {
      let data = batch[s];
      if (data && params.variant === 'closed') data = filterToLatestDay(data);
      if (data) newPerfEntries[s] = { ts: now, data };
    }
    ytdYear[perfKey] = { entries: newPerfEntries };
    Storage.saveYtd({ year, byRange: ytdYear });

    // ---- Write back to dp.tickerChart (TickerChartModal cache)
    let tcChanged = false;
    for (const t of tickers) {  // skip spSymbol — never opens in the modal
      let data = batch[t];
      if (data && params.variant === 'closed') data = filterToLatestDay(data);
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

    // Tiny pause so the auto-refresh tick doesn't pin the browser on network IO
    await new Promise((r) => setTimeout(r, 200));
  }
}
