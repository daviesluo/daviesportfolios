// Portfolio Performance chart — `<PerfChart>` (the chart itself) and
// `<PerfPanel>` (the chrome wrapper used by both the desktop left
// column and the mobile sidebar). Extracted from `header_sidebar.jsx`
// because it had grown to ~750 lines on its own — by far the bulk of
// that file — and the React-error-#310 hook-ordering bug we shipped
// once was partly because the surrounding noise made hook order hard
// to spot at a glance.
//
// Public API: `<PerfPanel>` (default surface) and `<PerfChart>` (raw
// chart) are both exported. Renderers in app.jsx import only PerfPanel.
import React from 'react';
import { fxToUSD } from './fx.js';
import { InvestmentChart, rangeStartMs, mergeSeries, deriveSeries } from './investment_chart.jsx';
import { readCachedSnapshots, refreshSnapshots } from './portfolio_snapshots.js';
import { fetchHistorical, fetchHistoricalBatch } from './historical.js';
import { usMarketHoursUtc } from './market_hours.js';
import { YtdStore } from './chart_store.js';
import {
  buildTickerSeries,
  computeAt,
  RANGES,
  RANGE_KEYS,
  anchorDateFor,
  fetchParamsFor,
  applyVariantFilter,
} from './ytd.js';
import { pointerToDataIndex, parseChartDateUTC, findRegularCloseIdx, crosshairFormatFor } from './chart_geometry.js';
import { reportError } from './ops_error.js';
import {
  mergeOvernightSeries,
  fetchOvernightSeries,
  getOvernightSeries,
  OVERNIGHT_FETCH_EVENT,
} from './overnight_intraday.js';
import { NIGHT_BAR_INTERVAL_MS } from './ticker_chart_helpers.js';

// ---- Range-sensitive wiring helpers (pure, exported for unit pins).
//
// The S&P reference symbol: ES=F (futures) whenever the ext-hours toggle
// is on for an intraday range (1D / 1W). The cash index ^GSPC is RTH-only
// — it can't carry pre/post-market or the overnight session — so any
// "night market" view of the benchmark has to ride the future. The legend
// flips to "S&P 500 FUTURES" to match.
export function spSymbolFor(rangeKey, extendedHours) {
  return ((rangeKey === '1D' || rangeKey === '1W') && extendedHours) ? 'ES=F' : '^GSPC';
}

// Cache-variant discriminator (part of the per-(range) cache key). 1D
// has reg / ext / closed sub-modes; 1W now splits ext vs std so the
// prepost-bearing week doesn't collide with the RTH-only one. Other
// ranges are session-insensitive.
export function perfVariantKey(rangeKey, extendedHours, phase) {
  if (rangeKey === '1D') return extendedHours ? 'ext' : (phase === 'regular' ? 'reg' : 'closed');
  if (rangeKey === '1W') return extendedHours ? 'ext' : 'std';
  return 'std';
}

// Fetch params. 1W gains pre/post-market bars when the ext toggle is on
// (paired with ES=F on the S&P side + the recorded-overnight merge below,
// this is what puts the night session into the week view). Both 1W
// variants are trimmed to the trailing 168 h by applyVariantFilter — the
// fetch is a MONTH because Yahoo has no range between `5d` (five trading
// sessions = 4.3 days, less than the week the button claims) and `1mo`.
// Every other case defers to the shared fetchParamsFor.
export function perfFetchParams(rangeKey, extendedHours, phase) {
  if (rangeKey === '1W' && extendedHours) {
    const r = RANGES['1W'];
    return { yahooRange: r.yahooRange, interval: r.interval, includePrePost: true, variant: '1w-ext' };
  }
  return fetchParamsFor(rangeKey, extendedHours, phase);
}

// The range→crosshair-label mapping now lives in chart_geometry.js —
// the Investment Performance chart labels the same five ranges, and a
// pill that read "Jun 29" on one view and "Jun 29 14:30" on the other
// would be a swap-visible inconsistency. Re-exported here so the
// existing import site (and its pin test) keep working.
export { crosshairFormatFor } from './chart_geometry.js';

// Tiny placeholder shell so the loading / error / range-button row
// renders the same chrome as the full chart — keeps the layout from
// jumping when the user flips between ranges.
function renderShell(child, rangeKey, setRangeKey) {
  return (
    <div className="perf-chart-wrap">
      {child}
      <RangeButtons rangeKey={rangeKey} onChange={setRangeKey} />
    </div>
  );
}

function RangeButtons({ rangeKey, onChange }) {
  return (
    <div className="perf-range-row">
      {RANGE_KEYS.map(k => (
        <button
          key={k}
          type="button"
          className={`perf-range-btn mono${k === rangeKey ? ' on' : ''}`}
          onClick={() => onChange(k)}
        >{RANGES[k].label}</button>
      ))}
    </div>
  );
}

// Cache TTLs aligned to each range's bar interval so we don't re-fetch
// faster than Yahoo can publish a new bar:
//   1D   → 5  m bars  →  5 m TTL
//   1W   → 30 m bars  → 30 m TTL
//   1M   → 60 m bars  →  1 h TTL
//   3M   →  1 d bars  → 12 h TTL
//   YTD  →  1 d bars  → 12 h TTL
// Stale-while-revalidate (below) renders the chart instantly past TTL
// while a fresh fetch runs silently in background — these caps just
// govern when the silent refetch fires.
const PERF_CACHE_TTL_MS = {
  '1D':  5  * 60 * 1000,
  '1W':  30 * 60 * 1000,
  '1M':  60 * 60 * 1000,
  '3M':  12 * 60 * 60 * 1000,
  'YTD': 12 * 60 * 60 * 1000,
};

// PerfChart cache reads/writes go through `YtdStore` (chart_store.js,
// IndexedDB-backed). One IDB row per (year, rangeKey, ticker) keyed
// `y${year}|${rangeKey}|${ticker}`; `loadPerfCache` filters the flat
// keyspace back down to one (year, range) bucket on demand.
function loadPerfCache(year, rangeKey) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of YtdStore.keys()) {
    const m = /^y(\d+)\|([^|]+)\|(.+)$/.exec(k);
    if (!m) continue;
    if (parseInt(m[1], 10) !== year || m[2] !== rangeKey) continue;
    const v = YtdStore.get(k);
    if (v) out[m[3]] = v;
  }
  return out;
}
/**
 * Whatever price history is already cached for these tickers at this
 * (range, variant) — the bucket PerfChart writes and the background
 * prefetch warms. Synchronous (IndexedDB with an in-memory mirror), so
 * the Investment panel can paint its derived half on its FIRST render
 * instead of showing an empty state until a fetch returns. Stale rows
 * are included on purpose: a stale chart now, replaced when the
 * revalidation lands, beats a spinner.
 *
 * @param {string[]} tickers
 * @param {string} rangeKey
 * @param {string} variantKey
 */
function readWarmHistory(tickers, rangeKey, variantKey) {
  /** @type {Record<string, any[]>} */
  const out = {};
  const prefix = `y${new Date().getFullYear()}|${rangeKey}:${variantKey}|`;
  for (const t of tickers) {
    const e = YtdStore.get(`${prefix}${t}`);
    if (e && Array.isArray(e.data) && e.data.length > 0) out[t] = e.data;
  }
  return out;
}

function savePerfCache(year, rangeKey, entries) {
  // Replace the entire (year, rangeKey) bucket — drop any existing
  // entries first so a ticker removed from `entries` doesn't linger.
  const prefix = `y${year}|${rangeKey}|`;
  for (const k of YtdStore.keys()) {
    if (k.startsWith(prefix)) YtdStore.del(k);
  }
  for (const [ticker, entry] of Object.entries(entries)) {
    YtdStore.set(`${prefix}${ticker}`, /** @type {any} */ (entry));
  }
}


// YTD performance chart: portfolio % return vs S&P 500, computed from
// per-lot purchase history + historical closes (Yahoo Finance),
// normalised from the first trading day of the calendar year.
/**
 * @param {{ portfolio: any, marketData: any, extendedHours: boolean, phase: string,
 *   rangeKey?: string|null, setRangeKey?: ((k: string) => void)|null }} props
 */
function PerfChart({ portfolio, marketData, extendedHours, phase, rangeKey: rangeKeyProp = null, setRangeKey: setRangeKeyProp = null }) {
  // `rangeKey` can be CONTROLLED by PerfPanel (so the panel title can flip to
  // "S&P FUTURES" when the active range benchmarks against ES=F) or fall back
  // to internal state when PerfChart is rendered standalone (tests). The
  // range buttons drive whichever setter is in play. Defaults to 1D — today's
  // intraday view; YTD is a click away.
  const [rangeKeyState, setRangeKeyState] = React.useState('1D');
  const rangeKey = rangeKeyProp ?? rangeKeyState;
  const setRangeKey = setRangeKeyProp ?? setRangeKeyState;
  // 1D's and (ext-on) 1W's fetch params depend on the ext-hours toggle +
  // market phase, so they go into the cache key. Other ranges are
  // session-insensitive. See perfVariantKey.
  const variantKey = perfVariantKey(rangeKey, extendedHours, phase);
  // The S&P 500 reference uses the futures contract (ES=F) whenever the
  // user has the extended-hours toggle on for an intraday range (1D / 1W)
  // — even during regular hours, since "ext on" is the user's signal that
  // they want to track futures pricing. The legend label flips to
  // "S&P 500 FUTURES" to match.
  const spSymbol = spSymbolFor(rangeKey, extendedHours);
  const [hist,    setHist]    = React.useState(/** @type {Record<string, any[]> | null} */ (null));
  const [loading, setLoading] = React.useState(true);
  const [error,   setError]   = React.useState(false);

  // Tickers we need historical data for. We send all non-cash holdings
  // to the chart Edge Function — it routes 6-digit CN fund codes to
  // eastmoney's pingzhongdata endpoint and everything else (including
  // .PVT) to Yahoo.
  const tickers = React.useMemo(() => {
    if (!portfolio) return [];
    const out = new Set();
    for (const [t, h] of Object.entries(portfolio.holdings || {})) {
      if (h.isCash || t === 'CASH') continue;
      out.add(t);
    }
    return Array.from(out).sort();
  }, [portfolio]);
  const tickerKey = tickers.join(',');

  React.useEffect(() => {
    if (!portfolio) return;
    let cancelled = false;
    const year = new Date().getFullYear();
    const symbols = [spSymbol, ...tickers];
    const params = perfFetchParams(rangeKey, extendedHours, phase);
    const ttl = PERF_CACHE_TTL_MS[rangeKey] || PERF_CACHE_TTL_MS.YTD;
    const cacheKey = `${rangeKey}:${variantKey}`;

    // Read per-ticker cache for THIS range/variant. Render whatever's
    // there first (fresh OR stale) so the chart appears immediately on
    // subsequent visits even if the cache has aged past TTL — the
    // background revalidate below replaces it once fresh data lands.
    const entries = loadPerfCache(year, cacheKey);
    /** @type {Record<string, any[]>} */
    const fresh = {};
    const stale = [];
    /** @type {Record<string, any[]>} */
    const staleData = {};
    for (const s of symbols) {
      const e = entries[s];
      if (e && e.data && Array.isArray(e.data)) {
        if ((Date.now() - (e.ts || 0)) < ttl) {
          fresh[s] = e.data;
        } else {
          stale.push(s);
          staleData[s] = e.data;
        }
      } else {
        stale.push(s);
      }
    }

    // Stale-while-revalidate: show whatever we have (fresh + stale)
    // instantly. The user sees "Computing…" only on a true cold cache.
    const initial = { ...fresh, ...staleData };
    if (initial[spSymbol]) {
      setHist(initial);
      setLoading(false);
    } else {
      setLoading(true);
    }

    if (stale.length === 0) return;

    // Split the cold/stale batch into TWO parallel calls:
    //   - S&P alone (1 ticker — Edge Function returns in ~300 ms when warm)
    //   - The rest of the portfolio (N tickers — slowest one gates it)
    // As soon as S&P returns we can paint the chart; the bulk fetch
    // updates it in place when it lands. Total time ≈ slowest single
    // ticker, but the user perceives the chart appearing the moment
    // the S&P anchor data arrives.
    const staleSp = stale.includes(spSymbol) ? [spSymbol] : [];
    const staleTickers = stale.filter(s => s !== spSymbol);

    /** @type {Record<string, any[]>} */
    const merged = { ...initial };
    const newEntries = { ...entries };

    const applyBatch = (batch) => {
      const now = Date.now();
      for (const s of stale) {
        let data = batch[s];
        data = applyVariantFilter(data, params.variant);
        if (data) {
          merged[s] = data;
          newEntries[s] = { ts: now, data };
        }
      }
      savePerfCache(year, cacheKey, newEntries);
      if (cancelled) return;
      const hasAnchor = merged[spSymbol] || Object.values(merged).some(s => Array.isArray(s) && s.length >= 2);
      if (!hasAnchor) {
        if (Object.keys(initial).length === 0) {
          setError(true);
          setLoading(false);
        }
        return;
      }
      setError(false);
      setHist({ ...merged });
      setLoading(false);
    };

    const spPromise = staleSp.length > 0
      ? fetchHistoricalBatch(staleSp, params.yahooRange, params.interval, params.includePrePost)
          .then(b => { if (!cancelled) applyBatch(b); return b; })
      : Promise.resolve({});
    const tickersPromise = staleTickers.length > 0
      ? fetchHistoricalBatch(staleTickers, params.yahooRange, params.interval, params.includePrePost)
          .then(b => { if (!cancelled) applyBatch(b); return b; })
      : Promise.resolve({});

    (async () => {
      const [spBatch] = await Promise.all([spPromise, tickersPromise]);
      if (cancelled) return;
      // After both batches resolve: if S&P is still missing, do up to
      // 3 proxy retries for it specifically — the chart won't render
      // without an anchor series.
      if (!merged[spSymbol] && !spBatch[spSymbol]) {
        for (let i = 0; i < 3 && !merged[spSymbol]; i++) {
          await new Promise(r => setTimeout(r, 600 * (i + 1)));
          if (cancelled) return;
          const retry = await fetchHistorical(spSymbol, params.yahooRange, params.interval, params.includePrePost).catch(() => null);
          if (retry) {
            merged[spSymbol] = retry;
            newEntries[spSymbol] = { ts: Date.now(), data: retry };
            savePerfCache(year, cacheKey, newEntries);
            applyBatch({ [spSymbol]: retry });
          }
        }
      }
      // Final state — if still no anchor and we haven't shown anything
      // yet, surface an error.
      if (!cancelled && !merged[spSymbol] && Object.keys(initial).length === 0) {
        reportError('fetch.perfchart.anchor', {
          symbol: spSymbol,
          message: 'S&P / fallback anchor never resolved after batch + retries',
          context: { rangeKey, variantKey, tickerCount: tickers.length },
        });
        setError(true);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tickerKey, rangeKey, variantKey]);

  // Background prefetch the other ranges once the user's chosen range
  // has loaded so subsequent range-button clicks are instant.
  // Sequential (not parallel) to avoid hammering the Edge Function
  // with five concurrent batched fetches every time the chart mounts.
  // Skips ranges already covered by fresh per-ticker entries in the
  // cache.
  React.useEffect(() => {
    if (!portfolio || loading || error || !hist) return;
    const year = new Date().getFullYear();
    const others = RANGE_KEYS.filter(k => k !== rangeKey);
    let cancelled = false;
    (async () => {
      for (const rk of others) {
        if (cancelled) return;
        const otherVariant = perfVariantKey(rk, extendedHours, phase);
        // The benchmark symbol is per-range (ES=F for ext-on 1D/1W, else
        // ^GSPC), so warm the row the main effect will actually read when
        // that range becomes active.
        const symbols = [spSymbolFor(rk, extendedHours), ...tickers];
        const cacheKey = `${rk}:${otherVariant}`;
        const ttl = PERF_CACHE_TTL_MS[rk] || PERF_CACHE_TTL_MS.YTD;
        const entries = loadPerfCache(year, cacheKey);
        const stale = symbols.filter(s => {
          const e = entries[s];
          return !(e && e.data && Array.isArray(e.data) && (Date.now() - (e.ts || 0)) < ttl);
        });
        if (stale.length === 0) continue;
        const params = perfFetchParams(rk, extendedHours, phase);
        const batch = await fetchHistoricalBatch(stale, params.yahooRange, params.interval, params.includePrePost);
        if (cancelled) return;
        const newEntries = { ...entries };
        const now = Date.now();
        for (const s of stale) {
          let data = batch[s];
          data = applyVariantFilter(data, params.variant);
          if (data) newEntries[s] = { ts: now, data };
        }
        savePerfCache(year, cacheKey, newEntries);
      }
    })();
    return () => { cancelled = true; };
  }, [tickerKey, rangeKey, variantKey, loading, error]);

  // Server-recorded overnight points (T212, 20:00-04:00 ET) for the
  // portfolio tickers. Recorded even with no tab open (overnight-record
  // pg_cron) and read here so the PerfChart's 1D / 1W lines carry a real
  // overnight curve — the same source the ticker modal draws. Only runs
  // in the overnight phase with the ext toggle on (the merge below is a
  // no-op otherwise, so there's nothing to fetch). Re-reads on the
  // `overnight:fetched` event a fetch fires. Above the early returns so
  // the hook count stays stable.
  const [overnight, setOvernight] = React.useState(/** @type {Record<string, any[]>} */ ({}));
  React.useEffect(() => {
    // Whenever the ext toggle is on (any phase) — not just the live
    // overnight session — so last night's recorded curve is fetched and
    // drawn through the next trading day. Overnight data is static during
    // the day (recorded only at night), so one fetch on mount is enough;
    // during the live session the app-level 30s refresh + OVERNIGHT_FETCH_EVENT
    // keep it current via the listener below.
    if (!extendedHours) { setOvernight({}); return undefined; }
    const read = () => {
      /** @type {Record<string, any[]>} */
      const map = {};
      for (const t of tickers) map[t] = getOvernightSeries(t);
      setOvernight(map);
    };
    read();                       // paint from cache immediately (if warm)
    fetchOvernightSeries(tickers); // refresh all portfolio tickers in one call
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(OVERNIGHT_FETCH_EVENT, read);
    return () => window.removeEventListener(OVERNIGHT_FETCH_EVENT, read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey, extendedHours, phase]);

  // Crosshair refs + effects must run on EVERY render (including the
  // early-return placeholder ones below) so React's hook count stays
  // stable across the loading → loaded transition. Otherwise we get
  // minified error #310 ("Rendered more hooks than during the
  // previous render"). Keep them above the early returns.
  const svgRef     = React.useRef(/** @type {SVGSVGElement|null} */ (null));
  const crossRef   = React.useRef(/** @type {SVGGElement|null}   */ (null));
  const cVlineRef  = React.useRef(/** @type {SVGLineElement|null}*/ (null));
  const cPortDot   = React.useRef(/** @type {SVGCircleElement|null}*/ (null));
  const cSpDot     = React.useRef(/** @type {SVGCircleElement|null}*/ (null));
  const cDateRect  = React.useRef(/** @type {SVGRectElement|null} */ (null));
  const cDateText  = React.useRef(/** @type {SVGTextElement|null} */ (null));
  const cPortRect  = React.useRef(/** @type {SVGRectElement|null} */ (null));
  const cPortText  = React.useRef(/** @type {SVGTextElement|null} */ (null));
  const cSpRect    = React.useRef(/** @type {SVGRectElement|null} */ (null));
  const cSpText    = React.useRef(/** @type {SVGTextElement|null} */ (null));
  const rafRef        = React.useRef(0);
  const pendingIdxRef = React.useRef(/** @type {number|null} */ (null));
  React.useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);
  React.useEffect(() => {
    if (crossRef.current) crossRef.current.style.display = 'none';
  }, [rangeKey, hist]);

  // Native non-passive touchmove listener for the crosshair drag.
  // React's synthetic onTouchMove is registered passive at the root,
  // so `e.preventDefault()` there is a no-op and the only thing
  // stopping the page from scrolling mid-drag is the SVG's inline
  // `touch-action: none`. iOS Safari ignores `touch-action` on an
  // inline <svg> when an ancestor is scrollable — which is exactly
  // this chart's situation on mobile (it lives in the scrollable
  // `.sidebar`, unlike the TickerChartModal which sits in a
  // scroll-locked overlay, which is why the modal's identical setup
  // worked and this one didn't: finger drags scrolled the page
  // instead of moving the crosshair). A native { passive: false }
  // listener lets preventDefault actually cancel the scroll.
  //
  // `handleMoveRef` holds the latest render's handleMove so the
  // listener (attached once per SVG mount via the callback ref) always
  // sees current geometry without re-binding on every render.
  const handleMoveRef = React.useRef(/** @type {(e: TouchEvent) => void} */ (() => {}));
  const touchCleanupRef = React.useRef(/** @type {(() => void) | null} */ (null));
  const setSvgNode = React.useCallback((/** @type {SVGSVGElement | null} */ node) => {
    if (touchCleanupRef.current) { touchCleanupRef.current(); touchCleanupRef.current = null; }
    svgRef.current = node;
    if (node) {
      const onTouchMove = (/** @type {TouchEvent} */ e) => {
        e.preventDefault();
        handleMoveRef.current(e);
      };
      node.addEventListener('touchmove', onTouchMove, { passive: false });
      touchCleanupRef.current = () => node.removeEventListener('touchmove', onTouchMove);
    }
  }, []);

  if (!portfolio) return renderShell(<div className="sparkline-empty dim mono">Loading…</div>, rangeKey, setRangeKey);
  if (loading)    return renderShell(<div className="sparkline-empty dim mono">Computing…</div>, rangeKey, setRangeKey);
  if (error)      return renderShell(<div className="sparkline-empty dim mono">Couldn't load history</div>, rangeKey, setRangeKey);

  // US market hours in UTC for today, used here for the ^GSPC RTH
  // filter and below for CLOSE / OPEN marker detection. Hoisted above
  // the first allSp use so the filter can reach it.
  const mh = usMarketHoursUtc(new Date());

  // S&P reference series — sorted, sliced to the selected window. For
  // 1D we DON'T filter by anchorDateFor("today") because in
  // closed-market mode the data spans yesterday, and using "today"
  // would empty the window. For daily ranges we still filter by the
  // calendar cutoff.
  const allSpRaw = (hist?.[spSymbol] || [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  // 1D session-window filter:
  //   - ^GSPC: drop bars outside 9:30-16:00 ET (RTH only — Yahoo's
  //     prepost=true sometimes slips spurious low-volume bars in,
  //     which would render as a "data between close and open"
  //     artifact).
  //   - ES=F: futures trade ~23 h, so a 24-h slice would include
  //     Asia-overnight bars where stocks aren't open. Match the rest
  //     of the app (which only has data 4 AM ET → 8 PM ET) by
  //     dropping bars outside that window — EXCEPT when ext is on, where
  //     keeping the 20:00-04:00 ET bars is the whole point: the futures
  //     line, and the portfolio overnight curve sampled at its
  //     timestamps, run continuously through the night so last night's
  //     overnight shows during the next trading day too (not just live in
  //     the overnight session). filterToLast24h bounds the window upstream.
  //
  // Toggle-gated (not phase-gated) ON PURPOSE: the anchor (`useExt`
  // below) stays phase-aware, so during regular hours the basis is
  // prevClose — which is the correct baseline for the WHOLE 24 h window
  // INCLUDING last night's overnight (the overnight happened after that
  // close). The portfolio is sampled via closeOn() against each ticker's
  // overnight-merged series, so overnight timestamps return the real
  // recorded price, not a flat prevClose. Holdings that don't trade
  // overnight just hold flat through the night.
  const keepOvernightFutures = extendedHours && spSymbol === 'ES=F';
  const allSp = (!keepOvernightFutures && rangeKey === '1D' && (spSymbol === '^GSPC' || spSymbol === 'ES=F'))
    ? allSpRaw.filter(p => {
        if (typeof p.date !== 'string' || p.date.length < 16 || p.date[10] !== 'T') return true;
        const utcMins = parseInt(p.date.slice(11, 13), 10) * 60 + parseInt(p.date.slice(14, 16), 10);
        if (spSymbol === '^GSPC') {
          return utcMins >= mh.openHh * 60 + mh.openMm
              && utcMins <= mh.closeHh * 60 + mh.closeMm;
        }
        // ES=F: keep bars whose ET time-of-day is in [04:00, 20:00)
        // (= pre-market start through after-hours end). Convert UTC
        // to ET via the DST-aware offset embedded in mh.edt.
        const offsetMins = (mh.edt ? 4 : 5) * 60;
        let etMins = utcMins - offsetMins;
        if (etMins < 0) etMins += 24 * 60;
        return etMins >= 4 * 60 && etMins < 20 * 60;
      })
    : allSpRaw;

  // 1D's anchor date is whatever calendar day the fetched data
  // actually covers — the latest UTC date in the series. Yesterday
  // for closed markets, today for open markets.
  let anchorDate;
  if (rangeKey === '1D') {
    anchorDate = allSp.length > 0
      ? allSp[allSp.length - 1].date.slice(0, 10)
      : anchorDateFor(rangeKey);
  } else {
    anchorDate = anchorDateFor(rangeKey);
  }

  let spWindow = rangeKey === '1D'
    ? allSp                                  // already trimmed at fetch time
    : allSp.filter(p => p.date >= anchorDate);
  let hasSp = spWindow.length >= 2;
  if (!hasSp) {
    let bestKey = null, bestLen = 0;
    for (const [k, s] of Object.entries(hist || {})) {
      if (k === spSymbol || !Array.isArray(s)) continue;
      const slice = rangeKey === '1D' ? s : s.filter(p => p.date >= anchorDate);
      if (slice.length > bestLen) { bestLen = slice.length; bestKey = k; }
    }
    if (!bestKey || bestLen < 2) {
      return renderShell(<div className="sparkline-empty dim mono">No data for this range</div>, rangeKey, setRangeKey);
    }
    const fallbackSeries = (hist?.[bestKey] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    spWindow = rangeKey === '1D' ? fallbackSeries : fallbackSeries.filter(p => p.date >= anchorDate);
  }
  const yearStartDate = spWindow[0].date;
  const todayMs = Date.now();

  // marketData (parent state) only carries indices / forex tickers
  // (^GSPC, ES=F, GBPUSD=X, …). Per-stock prices live on
  // portfolio.holdings[t]. The chart math (1D anchor pricing, live-
  // price substitution at the right edge) needs prevClose / lastPrice
  // / extPrice for EVERY ticker, so merge them into a single map.
  // Without this, marketData[<stock>] was undefined and the 1D
  // chart's basis collapsed to null → chart drew a flat 0% line, not
  // matching the scoreboard's DAY CHANGE.
  /** @type {Record<string, {prevClose?:number, lastPrice?:number, extPrice?:number|null, dayPct?:number}>} */
  const tickerMarketData = { ...marketData };
  for (const [t, h] of Object.entries(portfolio.holdings || {})) {
    if (h.isCash || t === 'CASH') continue;
    tickerMarketData[t] = {
      prevClose: h.prevClose,
      lastPrice: h.lastPrice,
      extPrice: h.extPrice ?? null,
      dayPct: h.dayPct,
    };
  }

  const useExt = !!(extendedHours && phase && phase !== "regular");

  // (The S&P line no longer needs a basis picked from OUTSIDE the
  // window — prevClose, today's 16:00 ET bar, the last close before the
  // anchor. Both lines are rebased to the window's own first point
  // further down, so the old per-range basis selection went with it.)

  /** @type {Record<string, {date:string,close:number}[]>} */
  const histForTickers = {};
  // Splice each ticker's server-recorded overnight points onto its Yahoo
  // bars so closeOn() returns a real 20:00-04:00 ET price at the ES=F
  // overnight timestamps the portfolio line is sampled at — the same
  // merge the ticker modal uses. No-op (returns the Yahoo series
  // untouched) unless ext is on, the ticker trades overnight, the range
  // is 1D / 1W / 1M, and there are >= 2 recorded points in-window. Gated
  // on the toggle, NOT the live overnight phase, so last night's curve
  // shows during the day too. barIntervalMs matches the recorded-point
  // density to each range's bar cadence (5 / 30 / 60 min) so 1W isn't
  // swallowed by today's ~130 five-minute samples.
  const nightBarMs = NIGHT_BAR_INTERVAL_MS[rangeKey];
  for (const t of tickers) {
    // Sort before merging — mergeOvernightSeries keys its window off
    // series[0].date, so it must be the earliest bar (buildTickerSeries
    // re-sorts the merged result, so this isn't redundant work there).
    const base = (hist?.[t] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    // `?? base` only satisfies the Point[]|null return type — the merge
    // returns its `series` arg (= base, non-null) in every no-op path.
    histForTickers[t] = mergeOvernightSeries(base, overnight[t] || [], {
      rangeKey, extendedHours, ticker: t, barIntervalMs: nightBarMs,
    }) ?? base;
  }
  const tickerSeries = buildTickerSeries(histForTickers, anchorDate, rangeKey, tickerMarketData, useExt);

  const liveAnchorDate = spWindow[spWindow.length - 1].date;
  const ytdOpts = {
    portfolio, tickerSeries, marketData: tickerMarketData,
    yearStart: anchorDate, yearStartDate, todayMs, liveAnchorDate, useExt, fxToUSD,
    // 1D = a day-change view: force every holding's basis to prevClose
    // (today's regular close in ext), matching the scoreboard DAY CHANGE,
    // instead of the per-lot cost that leaked T212-synced lots' total
    // gains into the day %. Longer ranges keep the per-lot Jan-1/cost
    // basis (a YTD/1W/etc. return genuinely is measured from cost for
    // in-period buys).
    prevCloseBasis: rangeKey === '1D',
  };

  const portYtd = spWindow.map(p => {
    const { value, basis } = computeAt({ ...ytdOpts, date: p.date });
    const pct = basis > 0 ? ((value - basis) / basis) * 100 : 0;
    return { date: p.date, pct };
  });
  if (portYtd.length < 2) {
    return renderShell(<div className="sparkline-empty dim mono">Insufficient data</div>, rangeKey, setRangeKey);
  }

  // Re-binding for downstream rendering code that still uses
  // spYtd / yearStart names.
  const spYtd = spWindow;

  // S&P 500 normalised from prior-year-end close (computed earlier as
  // spBase). Empty when hasSp is false; downstream rendering already
  // guards against empty spNorm arrays via .length checks.
  // Both lines are REBASED to 0 % at the window's first point, on every
  // range. Previously each was measured against a basis that sat OUTSIDE
  // the window — the S&P against the last close before it, the portfolio
  // against cost / prevClose — so a chart of "the last week" opened at
  // whatever the move happened to be at that moment (often several
  // percent) and the two lines started at different heights. You could
  // not read "who is ahead over this window" off the left edge, which is
  // the entire point of an indexed comparison chart.
  //
  // Rebasing is a shift, not a reshape: every point keeps the same
  // spacing it had, so nothing about the underlying basis maths changes
  // — including how in-period buys are handled (`computeAt` still folds
  // their cost into the basis; a mid-window purchase does not read as
  // performance). It just moves the origin onto the left edge.
  //
  // For 1D this is also what makes the reading a genuine trailing-24 h
  // change rather than the scoreboard's day change: the right edge is
  // now "since this point 24 h ago", not "since the previous close".
  const portBase = portYtd[0].pct;
  const portNorm = portYtd.map(p => ({ date: p.date, pct: p.pct - portBase }));
  const spOpen   = hasSp && spYtd.length > 0 ? spYtd[0].close : 0;
  const spNorm   = (hasSp && spOpen > 0)
    ? spYtd.map(p => ({ date: p.date, pct: ((p.close - spOpen) / spOpen) * 100 }))
    : [];

  // SVG coordinate helpers
  const W = 300, H = 106;
  const padL = 34, padR = 8, padT = 10, padB = 20;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  // X positioning is INDEX-based (each data point = one
  // equally-spaced step), not time-based:
  //   1. Closed-market 1D used to clamp tSpan to a 1-day minimum,
  //      stuffing the actual 6.5-hour intraday data into the first
  //      ~27 % of the chart and leaving the rest blank. Index-based
  //      positioning fills the full width regardless of how short the
  //      time span is.
  //   2. Weekend / overnight gaps don't draw empty stretches under
  //      the line — same convention every brokerage chart uses
  //      (Yahoo, Robinhood, T212).
  const portIdxOf = new Map(portNorm.map((p, i) => [p.date, i]));
  const spIdxOf   = new Map(spNorm.map((p, i) => [p.date, i]));
  const totalLen  = Math.max(portNorm.length, spNorm.length, 2);
  const xOfPort = (date) => padL + ((portIdxOf.get(date) ?? 0) / Math.max(1, totalLen - 1)) * cW;
  const xOfSp   = (date) => padL + ((spIdxOf.get(date)   ?? 0) / Math.max(1, totalLen - 1)) * cW;

  // Y range — always include 0
  const allPcts = [...portNorm.map(p => p.pct), ...spNorm.map(p => p.pct), 0];
  const rawMin  = Math.min(...allPcts);
  const rawMax  = Math.max(...allPcts);
  const yPad    = Math.max(1.5, (rawMax - rawMin) * 0.12);
  const yMin = rawMin - yPad;
  const yMax = rawMax + yPad;
  const yRange = yMax - yMin || 1;
  const yOf = p => padT + ((yMax - p) / yRange) * cH;

  // Nice Y ticks
  const tickStep = (() => {
    const r = yMax - yMin;
    if (r <= 8)  return 2;
    if (r <= 20) return 5;
    if (r <= 50) return 10;
    return 20;
  })();
  const ticks = [];
  for (let t = Math.ceil(yMin / tickStep) * tickStep; t <= yMax; t += tickStep) ticks.push(t);

  // X-axis labels. With index-based positioning we can't pin labels
  // to calendar months any more (each step is a data point, not a
  // wall-clock step), so we sample a handful of equally-spaced
  // indices and let the formatter decide what's most useful: HH:MM
  // for 1D intraday, "Mon DD" for 1W/1M (intraday bars are
  // distinguishable from the curve itself — the user found
  // "Mon DD HH:MM" too noisy), and bare month for 3M/YTD.
  const months = [];
  if (portNorm.length > 0) {
    const denom = Math.max(1, portNorm.length - 1);
    const labelCount = rangeKey === '1D' ? 4 : 5;
    for (let i = 0; i <= labelCount; i++) {
      const idx = Math.round((portNorm.length - 1) * (i / labelCount));
      const safeIdx = Math.max(0, Math.min(portNorm.length - 1, idx));
      const dateStr = portNorm[safeIdx].date;
      const x = padL + (safeIdx / denom) * cW;
      if (x < padL + 10 || x > W - padR - 8) continue;
      const d = parseChartDateUTC(dateStr);
      let label;
      if (rangeKey === '1D') {
        label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      } else if (rangeKey === '1W' || rangeKey === '1M') {
        label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      } else {
        label = d.toLocaleString('default', { month: 'short' });
      }
      months.push({ x, label });
    }
  }

  // SVG paths — each series uses its own index map so portfolio and
  // S&P align even when the two series have slightly different point
  // counts (e.g. one ticker missed today's data).
  const toPath = (norm, xFn) => {
    if (norm.length === 0) return '';
    return 'M' + norm.map(p => `${xFn(p.date).toFixed(1)},${yOf(p.pct).toFixed(1)}`).join('L');
  };
  const portPath = toPath(portNorm, xOfPort);
  const spPath   = toPath(spNorm,   xOfSp);

  const portCurrent = portNorm.length > 0 ? portNorm[portNorm.length - 1].pct : null;
  const spCurrent   = spNorm.length   > 0 ? spNorm[spNorm.length - 1].pct   : null;
  const portColor = portCurrent != null && portCurrent >= 0 ? 'var(--gain)' : 'var(--loss)';
  const spColor   = '#6b7280';
  const zeroY = yOf(0);

  // Two-decimal precision matches the ticker drill modal's per-row %
  // (`fmtPct` from utils) so the legend and crosshair chips read at
  // the same precision as the rest of the app.
  const fmtP1 = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

  // Hover crosshair — DOM-ref based for the same reasons as the
  // ticker modal: setting React state on every mousemove would
  // reconcile the whole SVG (path with up to ~150 points) on every
  // frame. Refs + setAttribute inside a rAF keeps everything else in
  // the chart untouched while the cursor moves. The refs + their
  // useEffect cleanups live above the early returns so the hook
  // count stays stable; only the closures-over-render-vars (paint
  // helper, mouse handlers) live here.

  // Lookup tables for crosshair index→data.
  const portByIdx = portNorm;
  const spByIdx   = spNorm.length === portNorm.length ? spNorm : null; // aligned in 1D / YTD
  const fmtCrosshairDate = (dateStr) => {
    const d = parseChartDateUTC(dateStr);
    const date = () => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = () => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const fmt = crosshairFormatFor(rangeKey);
    if (fmt === 'time') return time();
    if (fmt === 'datetime') return `${date()} ${time()}`;
    return date();
  };
  function paintCrosshair() {
    rafRef.current = 0;
    const idx = pendingIdxRef.current;
    const g = crossRef.current;
    if (!g) return;
    if (idx == null || !portByIdx[idx]) { g.style.display = 'none'; return; }
    g.style.display = '';
    const p = portByIdx[idx];
    const x = xOfPort(p.date);
    const portY = yOf(p.pct);
    if (cVlineRef.current) { cVlineRef.current.setAttribute('x1', String(x.toFixed(1))); cVlineRef.current.setAttribute('x2', String(x.toFixed(1))); }
    if (cPortDot.current) { cPortDot.current.setAttribute('cx', String(x.toFixed(1))); cPortDot.current.setAttribute('cy', String(portY.toFixed(1))); }
    const sp = spByIdx?.[idx] ?? null;
    if (sp && cSpDot.current) {
      cSpDot.current.setAttribute('cx', String(x.toFixed(1)));
      cSpDot.current.setAttribute('cy', String(yOf(sp.pct).toFixed(1)));
      cSpDot.current.style.display = '';
    } else if (cSpDot.current) {
      cSpDot.current.style.display = 'none';
    }
    // Date pill: wider for 1W / 1M (they show "MMM D HH:MM"); clamp the
    // centre so the pill never spills past the chart edges — at the far
    // right (the live point, as in the 1W "Jun 29" case) it nudges left
    // to stay inside instead of overflowing.
    const datePillW = crosshairFormatFor(rangeKey) === 'datetime' ? 80 : 44;
    const dpHalf = datePillW / 2;
    const dpCx = Math.max(padL + dpHalf, Math.min(W - padR - dpHalf, x));
    if (cDateRect.current) {
      cDateRect.current.setAttribute('x', (dpCx - dpHalf).toFixed(1));
      cDateRect.current.setAttribute('width', String(datePillW));
    }
    if (cDateText.current) { cDateText.current.setAttribute('x', dpCx.toFixed(1)); cDateText.current.textContent = fmtCrosshairDate(p.date); }
    if (cPortRect.current && cPortText.current) {
      const yTop = (portY - 8).toFixed(1);
      cPortRect.current.setAttribute('y', yTop);
      cPortRect.current.setAttribute('fill', p.pct >= 0 ? 'rgba(70,160,90,0.85)' : 'rgba(190,60,70,0.85)');
      cPortText.current.setAttribute('y', String((portY).toFixed(1)));
      cPortText.current.textContent = fmtP1(p.pct);
    }
    if (cSpRect.current && cSpText.current) {
      if (sp) {
        const spY = yOf(sp.pct);
        cSpRect.current.style.display = '';
        cSpText.current.style.display = '';
        cSpRect.current.setAttribute('y', (spY - 8).toFixed(1));
        cSpText.current.setAttribute('y', String((spY).toFixed(1)));
        cSpText.current.textContent = fmtP1(sp.pct);
      } else {
        cSpRect.current.style.display = 'none';
        cSpText.current.style.display = 'none';
      }
    }
  }
  function handleMove(e) {
    // pointerToDataIndex (chart_geometry.js) handles the mouse-vs-touch
    // coords + SVG letterbox correction + clamp-into-padding logic that
    // was previously duplicated almost verbatim between this chart and
    // the ticker-modal chart. The SVG sets `touch-action: none` so
    // finger drags don't compete with the browser's scroll/zoom.
    const idx = pointerToDataIndex(
      e, svgRef.current, { W, H, padL, padR, cW }, portByIdx.length,
    );
    if (idx == null) return;
    pendingIdxRef.current = idx;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(paintCrosshair);
  }
  // Keep the native touchmove listener (attached in setSvgNode)
  // pointing at the current render's handleMove closure.
  handleMoveRef.current = handleMove;
  function handleLeave() {
    pendingIdxRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (crossRef.current) crossRef.current.style.display = 'none';
  }

  return (
    <div className="perf-chart-wrap">
      <div className="perf-legend">
        <span className="perf-legend-item">
          <span className="perf-dot" style={{ background: portColor }} />
          <span className="mono dim perf-lbl">PORTFOLIO</span>
          {portCurrent != null && (
            <span className="mono perf-val" style={{ color: portColor }}>{fmtP1(portCurrent)}</span>
          )}
        </span>
        <span className="perf-legend-item">
          <span className="perf-dot" style={{ background: spColor }} />
          <span className="mono dim perf-lbl">{spSymbol === 'ES=F' ? 'S&P 500 FUTURES' : 'S&P 500'}</span>
          {spCurrent != null && (
            <span className="mono perf-val" style={{ color: spColor }}>{fmtP1(spCurrent)}</span>
          )}
        </span>
      </div>

      <svg
        ref={setSvgNode}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        // touchAction:none claims horizontal finger drags for the
        // crosshair instead of the browser scroll/zoom gestures.
        // Vertical scrolling outside the chart still works. On iOS
        // this alone isn't enough for an inline <svg> inside a
        // scrollable ancestor, so the actual crosshair-drag is driven
        // by the native non-passive touchmove listener attached in
        // setSvgNode (see the comment there). onTouchStart still
        // handles the initial tap-to-place.
        style={{ display: 'block', touchAction: 'none' }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onTouchStart={handleMove}
      >
        {/* Y-axis ticks + grid lines */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} y1={yOf(t).toFixed(1)} x2={W - padR} y2={yOf(t).toFixed(1)}
                  stroke="var(--line-2)" strokeWidth="0.5"
                  strokeDasharray={t === 0 ? undefined : "2,3"} />
            <text x={padL - 3} y={yOf(t).toFixed(1)} textAnchor="end" dominantBaseline="middle"
                  fontSize="7.5" fill="rgba(244,239,227,0.38)" fontFamily="var(--font-mono)">
              {t >= 0 ? '+' : ''}{t}%
            </text>
          </g>
        ))}
        {/* Zero line (stronger) */}
        <line x1={padL} y1={zeroY.toFixed(1)} x2={W - padR} y2={zeroY.toFixed(1)}
              stroke="var(--line)" strokeWidth="0.8" />
        {/* Month grid lines + labels */}
        {months.map((m, i) => (
          <g key={i}>
            <line x1={m.x.toFixed(1)} y1={padT} x2={m.x.toFixed(1)} y2={H - padB}
                  stroke="var(--line-2)" strokeWidth="0.4" />
            <text x={m.x.toFixed(1)} y={H - padB + 9} textAnchor="middle"
                  fontSize="7.5" fill="rgba(244,239,227,0.38)" fontFamily="var(--font-mono)">
              {m.label}
            </text>
          </g>
        ))}
        {/* Vertical dashed markers for the 1D session views.
            - 'reg' (market open, ext-off): only OPEN. The CLOSE bar
              would land 1 index slot to the left of OPEN, which the
              user perceived as a confusing "5-min gap"; dropping the
              CLOSE line in this variant cleans that up.
            - 'ext' (ext-on, futures view): both OPEN + CLOSE. Useful
              context when the chart includes pre-market / RTH /
              after-hours of one full session.
            Same x-fallback as the legacy block: spIdxOf may be empty
            when S&P fetch fell back to another ticker, so use the
            portfolio index map as backup. */}
        {rangeKey === '1D' && (variantKey === 'reg' || variantKey === 'ext') && (() => {
          let openIdx = -1, closeIdx = -1;
          // OPEN is scoped to the most-recent calendar date in the
          // data so a yesterday-afternoon bar (whose UTC hour also
          // satisfies hh > openHh) doesn't steal the match.
          const lastDay = spYtd.length > 0 ? spYtd[spYtd.length - 1].date.slice(0, 10) : null;
          for (let i = 0; i < spYtd.length; i++) {
            const d = spYtd[i].date;
            if (d.length < 16) continue;
            if (lastDay && d.slice(0, 10) !== lastDay) continue;
            const hh = parseInt(d.slice(11, 13), 10);
            const mm = parseInt(d.slice(14, 16), 10);
            if (openIdx < 0 && ((hh === mh.openHh && mm >= mh.openMm) || hh > mh.openHh)) {
              openIdx = i;
            }
          }
          // CLOSE only matters in 'ext' mode — walk backwards and
          // find the bar whose timestamp is the regular close itself
          // (e.g. 20:00 UTC for EDT). Previously we allowed +5 min of
          // slack, which meant a 20:05 bar would steal the marker —
          // user saw "CLOSE" rendered at 9:05pm BST instead of 9:00pm.
          // Falls through to the latest bar strictly before close if
          // the exact-close bar is missing.
          if (variantKey === 'ext') {
            closeIdx = findRegularCloseIdx(spYtd, mh);
          }
          const renderMarker = (idx, label) => {
            if (idx < 0) return null;
            const date = spYtd[idx].date;
            const idxInChart = spIdxOf.get(date) ?? portIdxOf.get(date) ?? 0;
            const x = (padL + (idxInChart / Math.max(1, totalLen - 1)) * cW).toFixed(1);
            return (
              <g key={label}>
                <line x1={x} y1={padT} x2={x} y2={H - padB}
                      stroke="rgba(244,239,227,0.45)" strokeWidth="0.8" strokeDasharray="3,3" />
                <text x={x} y={padT - 2} textAnchor="middle"
                      fontSize="7" fill="rgba(244,239,227,0.5)" fontFamily="var(--font-mono)">
                  {label}
                </text>
              </g>
            );
          };
          return (
            <>
              {renderMarker(closeIdx, 'CLOSE')}
              {renderMarker(openIdx,  'OPEN')}
            </>
          );
        })()}
        {/* S&P 500 line */}
        {spPath && (
          <path d={spPath} fill="none" stroke={spColor} strokeWidth="1.2" opacity="0.75"
                strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Portfolio line */}
        {portPath && (
          <path d={portPath} fill="none" stroke={portColor} strokeWidth="1.6"
                strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Dot at last portfolio point */}
        {portNorm.length > 0 && (() => {
          const last = portNorm[portNorm.length - 1];
          return <circle cx={xOfPort(last.date).toFixed(1)} cy={yOf(last.pct).toFixed(1)}
                         r="3" fill={portColor} stroke="#0c1310" strokeWidth="1.5" />;
        })()}
        {/* Hover crosshair — vertical line + per-line dots + a tiny
            date label under the chart and per-series % chips next
            to each dot. Hidden by default; updated imperatively on
            mousemove. */}
        <g ref={crossRef} style={{ display: 'none' }}>
          <line ref={cVlineRef} x1={padL} y1={padT} x2={padL} y2={H - padB}
                stroke="rgba(244,239,227,0.5)" strokeWidth="0.6" strokeDasharray="2,2" />
          <circle ref={cPortDot} cx={padL} cy={padT} r="2.5"
                  fill={portColor} stroke="#0c1310" strokeWidth="1" />
          <circle ref={cSpDot}   cx={padL} cy={padT} r="2.5"
                  fill={spColor}   stroke="#0c1310" strokeWidth="1" />
          {/* Date pill under the chart */}
          <rect ref={cDateRect} x={padL} y={H - padB + 1} width={44} height={11}
                fill="#0c1310" stroke="var(--chalk-dim)" strokeWidth="0.5" />
          <text ref={cDateText} x={padL} y={H - padB + 9} textAnchor="middle"
                fontSize="7.5" fill="var(--chalk)" fontFamily="var(--font-mono)" />
          {/* PORTFOLIO % chip — drawn left of the dot */}
          <rect ref={cPortRect} x={padL + 4} width={32} height={11} rx={1.5}
                fill="rgba(70,160,90,0.85)" />
          <text ref={cPortText} x={padL + 20} dominantBaseline="middle" textAnchor="middle"
                fontSize="7.5" fill="#fff" fontFamily="var(--font-mono)" fontWeight="600" />
          {/* S&P % chip */}
          <rect ref={cSpRect} x={padL + 4} width={32} height={11} rx={1.5}
                fill="rgba(107,114,128,0.85)" />
          <text ref={cSpText} x={padL + 20} dominantBaseline="middle" textAnchor="middle"
                fontSize="7.5" fill="#fff" fontFamily="var(--font-mono)" fontWeight="600" />
        </g>
      </svg>

      <RangeButtons rangeKey={rangeKey} onChange={setRangeKey} />
    </div>
  );
}

// Standalone PerfChart panel — same panel chrome as TOP MOVERS /
// FORMATION VALUE, rendered separately so we can place it in the
// desktop left column instead of the sidebar. The Sidebar still
// renders its own copy on tablet/mobile.
// Data side of the Investment Performance view: stored 5-minute samples
// for the recent window, ledger-derived points for everything older.
//
// The derived half deliberately uses the price history the vs-S&P chart
// has already cached for the board's tickers. It will not have history
// for a ticker sold long ago — which is exactly why the samples are
// recorded — so before the first sample the line reflects what can still
// be priced. Once samples cover the window, they are the whole line.
function InvestmentPanelBody({ portfolio, marketData, rangeKey, setRangeKey, hideValues = false, extendedHours = false, phase = 'regular' }) {
  // Seed from the prefetch's cache so the FIRST render already has a
  // line — the background prefetch warms every range, so opening the
  // panel or switching ranges is a cache hit rather than an empty state
  // waiting on a request. Then revalidate in the background.
  const [snapshots, setSnapshots] = React.useState(
    () => /** @type {any[]} */ (readCachedSnapshots(rangeKey) || []),
  );
  const nowMs = Date.now();
  const startMs = rangeStartMs(rangeKey, nowMs);

  React.useEffect(() => {
    let cancelled = false;
    const cached = readCachedSnapshots(rangeKey);
    if (cached) setSnapshots(cached);
    refreshSnapshots(rangeKey, rangeStartMs(rangeKey, Date.now())).then((rows) => {
      // Keep the cached line rather than blanking on an empty read — an
      // empty result is ambiguous (no samples yet, or a failed request).
      if (!cancelled && rows.length > 0) setSnapshots(rows);
    });
    return () => { cancelled = true; };
    // Keyed on the range only: `startMs` moves with the clock, so
    // including it would refetch on every render.
  }, [rangeKey]);

  // Price history for the derived half. Fetched here rather than read
  // out of the vs-S&P chart's cache: that bucket only exists if THAT
  // chart has already run for this exact (year, range, variant), which
  // depends on render order, the ext toggle and the market phase — so
  // the panel would show an empty state whenever it happened to open
  // first. The prefetch has usually warmed the same upstream request, so
  // this is typically a fast repeat rather than a cold fetch.
  //
  // Covers sold-out names: the ticker list walks every holding and only
  // skips cash, and a closed position keeps its holding row, so the
  // history needed to price a stock no longer owned is included.
  const histTickers = React.useMemo(
    () => Object.entries(portfolio?.holdings || {})
      .filter(([t, h]) => !(/** @type {any} */ (h)?.isCash) && t !== 'CASH')
      .map(([t]) => t)
      .sort(),
    [portfolio],
  );
  const histKey = histTickers.join(',');
  const variantKey = perfVariantKey(rangeKey, extendedHours, phase);
  // Price history for the derived half, read from the SAME per-ticker
  // bucket the vs-S&P chart and the background prefetch fill. Seeding
  // synchronously from it is what stops the panel loading every single
  // time it's opened: the fetch below still runs to revalidate, but it
  // now replaces a drawn chart instead of an empty state.
  const [hist, setHist] = React.useState(
    () => /** @type {Record<string, any[]>} */ (readWarmHistory(histTickers, rangeKey, variantKey)),
  );
  React.useEffect(() => {
    if (histTickers.length === 0) return undefined;
    let cancelled = false;
    const warm = readWarmHistory(histTickers, rangeKey, variantKey);
    if (Object.keys(warm).length > 0) setHist(warm);
    const p = perfFetchParams(rangeKey, extendedHours, phase);
    fetchHistoricalBatch(histTickers, p.yahooRange, p.interval, p.includePrePost)
      .then((batch) => {
        if (cancelled || !batch) return;
        // Trim to the range's display window exactly as PerfChart does,
        // so the two charts hold the same bars for the same key and
        // whichever runs first warms the other.
        /** @type {Record<string, any[]>} */
        const trimmed = {};
        const now = Date.now();
        for (const t of histTickers) {
          const data = applyVariantFilter(/** @type {any} */ (batch)[t], p.variant);
          if (!Array.isArray(data) || data.length === 0) continue;
          trimmed[t] = data;
          // Write per-ticker rather than through savePerfCache, which
          // REPLACES the whole (year, range, variant) bucket — that
          // would drop the S&P anchor row the other chart depends on.
          YtdStore.set(`y${new Date().getFullYear()}|${rangeKey}:${variantKey}|${t}`, { ts: now, data });
        }
        if (Object.keys(trimmed).length > 0) setHist(trimmed);
      })
      .catch(() => { /* the seeded cache stays on screen */ });
    return () => { cancelled = true; };
  }, [histKey, rangeKey, variantKey, extendedHours, phase]);

  // Ledger-derived points for everything OLDER than the first sample —
  // which, until the sampler has been running a while, is the entire
  // chart. Built from the per-ticker price history the vs-S&P chart and
  // the background prefetch have already cached for this range, so this
  // costs no extra request; when a ticker isn't in the cache its value
  // is simply absent from those points rather than guessed.
  //
  // `loadPerfCache` covers sold-out names too: PerfChart's ticker list
  // walks every holding and only skips cash, and a closed position keeps
  // its holding row, so the history needed to price a stock you no
  // longer own is already there.
  const derived = React.useMemo(() => {
    const dates = Object.values(hist)
      .flat()
      .map((p) => /** @type {any} */ (p).date)
      .filter(Boolean);
    if (dates.length === 0) return [];
    const uniqueDates = Array.from(new Set(dates)).sort();
    // `marketData` (parent state) only carries indices / forex — per-stock
    // prices live on the holdings. The vs-S&P chart merges the two before
    // it computes anything, and the value here is the same computation, so
    // it has to see the same map: without the merge every stock's
    // prevClose / lastPrice reads undefined, which changes the 1D anchor
    // and the live right-edge point.
    /** @type {Record<string, any>} */
    const tickerMarketData = { ...marketData };
    for (const [t, h] of Object.entries(portfolio?.holdings || {})) {
      const hh = /** @type {any} */ (h);
      if (hh?.isCash || t === 'CASH') continue;
      tickerMarketData[t] = {
        prevClose: hh?.prevClose, lastPrice: hh?.lastPrice,
        extPrice: hh?.extPrice ?? null, dayPct: hh?.dayPct,
      };
    }
    const useExt = !!(extendedHours && phase && phase !== 'regular');
    const tickerSeries = buildTickerSeries(hist, uniqueDates[0], rangeKey, tickerMarketData, useExt);
    return deriveSeries({
      portfolio, tickerSeries, marketData: tickerMarketData, fxToUSD,
      dates: uniqueDates, useExt, rangeKey,
    });
  }, [portfolio, marketData, rangeKey, hist, extendedHours, phase]);

  const series = React.useMemo(
    () => mergeSeries(snapshots, derived, startMs),
    [snapshots, derived, startMs],
  );

  return (
    <InvestmentChart
      series={series}
      rangeKey={rangeKey}
      setRangeKey={setRangeKey}
      hideValues={hideValues}
    />
  );
}

function PerfPanel({ portfolio, marketData, extendedHours, phase, className, hideValues = false }) {
  // Own the range here so the title can name the actual benchmark: ES=F
  // (ext-on 1D / 1W) → "S&P FUTURES", the cash index otherwise → "S&P 500".
  // The legend dot inside the chart flips the same way (spSymbolFor).
  const [rangeKey, setRangeKey] = React.useState('1D');
  // Two charts share this slot: the vs-S&P view (relative, in percent)
  // and Investment Performance (absolute, in dollars). The range carries
  // across the swap so flipping the view doesn't also change the period
  // you were looking at.
  const [view, setView] = React.useState(/** @type {'sp'|'investment'} */ ('sp'));
  const benchmarksFutures = spSymbolFor(rangeKey, extendedHours) === 'ES=F';
  const isSp = view === 'sp';
  return (
    <section className={`panel ${className || ""}`.trim()}>
      <div className="panel-title-row">
        <h3 className="panel-title">
          {isSp
            ? <>PERFORMANCE VS {benchmarksFutures ? <>S&amp;P FUTURES</> : <>S&amp;P 500</>}</>
            : <>INVESTMENT PERFORMANCE</>}
        </h3>
        <button
          type="button"
          className="panel-swap mono"
          onClick={() => setView(isSp ? 'investment' : 'sp')}
          title={isSp ? 'Show portfolio value vs net deposited' : 'Show performance vs the S&P'}
          aria-label={isSp ? 'Switch to Investment Performance' : 'Switch to Performance vs S&P'}
        >⇄</button>
      </div>
      {isSp ? (
        <PerfChart
          portfolio={portfolio}
          marketData={marketData}
          extendedHours={extendedHours}
          phase={phase}
          rangeKey={rangeKey}
          setRangeKey={setRangeKey}
        />
      ) : (
        <InvestmentPanelBody
          portfolio={portfolio}
          marketData={marketData}
          rangeKey={rangeKey}
          setRangeKey={setRangeKey}
          hideValues={hideValues}
          extendedHours={extendedHours}
          phase={phase}
        />
      )}
    </section>
  );
}

export { PerfChart, PerfPanel };
