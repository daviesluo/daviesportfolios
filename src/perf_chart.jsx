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
  panelRangeLabel,
} from './ytd.js';
import { pointerToDataIndex, parseChartDateUTC, findRegularCloseIdx } from './chart_geometry.js';
import { depositSeries } from './deposit_series.js';
import {
  readCachedPriceSnapshots, refreshPriceSnapshots, mergeRecordedBars,
  recordedFromMs, rangeStartMs,
} from './price_snapshots.js';
import {
  moneyTicks, fmtAxisMoney, fmtChipMoney, windowPct, provenanceSplitIndex,
} from './investment_view.js';
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
// variants download a MONTH and are trimmed back to the trailing 168 h by
// applyVariantFilter — `1w-ext` used to pass through untouched, which was
// harmless while the fetch was five sessions and would now draw a month
// under a 1W button. Every other case defers to the shared
// fetchParamsFor.
export function perfFetchParams(rangeKey, extendedHours, phase) {
  if (rangeKey === '1W' && extendedHours) {
    const r = RANGES['1W'];
    return { yahooRange: r.yahooRange, interval: r.interval, includePrePost: true, variant: '1w-ext' };
  }
  return fetchParamsFor(rangeKey, extendedHours, phase);
}

// Which crosshair-label format a range uses: bare time for the single
// intraday day (1D); date + time for the multi-day intraday ranges (1W
// 30m / 1M 60m) so the pill pins the exact bar — incl. the overnight
// session — not just the calendar day; date-only for the daily ranges
// (3M / YTD). Exported so the range→format mapping is pinned by
// perf_chart.test.jsx.
export function crosshairFormatFor(rangeKey) {
  if (rangeKey === '1D') return 'time';
  if (rangeKey === '1W' || rangeKey === '1M') return 'datetime';
  return 'date';
}

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
        >{panelRangeLabel(k)}</button>
      ))}
    </div>
  );
}

// Cache TTLs aligned to each range's bar interval so we don't re-fetch
// faster than Yahoo can publish a new bar:
//   1D   → 5  m bars  →  5 m TTL
//   1W   → 15 m bars  → 15 m TTL
//   1M   → 60 m bars  →  1 h TTL
//   3M   →  1 d bars  → 12 h TTL
//   YTD  →  1 d bars  → 12 h TTL
// Stale-while-revalidate (below) renders the chart instantly past TTL
// while a fresh fetch runs silently in background — these caps just
// govern when the silent refetch fires.
const PERF_CACHE_TTL_MS = {
  '1D':  5  * 60 * 1000,
  '1W':  15 * 60 * 1000,
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
 * `view` picks WHICH pair of lines the shared pipeline draws:
 *   'sp'         — portfolio % vs S&P 500 %, both rebased to 0 %.
 *   'investment' — portfolio value in dollars vs net deposited.
 *
 * Both views run the exact same fetch, the exact same grid and the exact
 * same `computeAt` call; only the drawing differs. That is deliberate
 * and structural: the value line IS the vs-S&P panel's portfolio series,
 * so the two panels cannot report different numbers for the same book on
 * the same day. Writing the second panel its own reconstruction is what
 * put two different portfolios on one screen last time.
 *
 * @param {{ portfolio: any, marketData: any, extendedHours: boolean, phase: string,
 *   rangeKey?: string|null, setRangeKey?: ((k: string) => void)|null,
 *   view?: 'sp'|'investment', hideValues?: boolean,
 *   t212Orders?: {rows: any[], complete: boolean}|null }} props
 */
function PerfChart({ portfolio, marketData, extendedHours, phase, rangeKey: rangeKeyProp = null, setRangeKey: setRangeKeyProp = null, view = 'sp', hideValues = false, t212Orders = null }) {
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
  // Server-recorded 5-minute prices for this range. Seeded SYNCHRONOUSLY
  // from the chart store — the background prefetch warms every range, so
  // opening the panel or switching ranges paints recorded density on the
  // first render rather than after a round trip. The fetch below then
  // revalidates behind an already-drawn chart.
  const [recorded, setRecorded] = React.useState(
    () => /** @type {Array<{ts: string, prices: Record<string, number>}>} */ (
      readCachedPriceSnapshots(rangeKey) || []
    ),
  );
  React.useEffect(() => {
    let cancelled = false;
    const cached = readCachedPriceSnapshots(rangeKey);
    if (cached) setRecorded(cached);
    refreshPriceSnapshots(rangeKey, rangeStartMs(rangeKey, Date.now())).then((rows) => {
      // An empty read is ambiguous (nothing recorded yet vs a failed
      // request), so it never replaces a drawn series.
      if (!cancelled && rows.length > 0) setRecorded(rows);
    });
    return () => { cancelled = true; };
    // Keyed on the range only: the window start moves with the clock, so
    // including it would refetch on every render.
  }, [rangeKey]);

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

  // Cache for the expensive series build below. It has to be a ref, not
  // a `useMemo`, because the computation cannot run until after the
  // guards on the next three lines — and a hook after an early return is
  // how this component shipped React error #310 once already. The HOOK
  // is here, unconditional; only the cache LOOKUP happens down there,
  // and a lookup is not a hook.
  const seriesCacheRef = React.useRef(
    /** @type {{deps: any[], val: {portYtd: any[], recordedFrom: number|null}}|null} */ (null));

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
  // ---- The expensive half of this render, memoised.
  //
  // Everything from here to `portYtd` walks every ticker's bars and then
  // calls `computeAt` once per point — on a 150-bar range that is 150
  // valuations of the whole book, and it sat in the render body. A
  // single 30-second refresh tick re-renders this panel four or five
  // times (clock leaf, flash set, hover state, the parent's own tick),
  // so the same 150 valuations ran four or five times for one new price.
  // On a phone that is the difference between a smooth toggle and a
  // visibly janky one.
  //
  // Deps are the inputs that can change the answer. `Date.now()` is read
  // inside (via `rangeStartMs`) and deliberately NOT a dep: the window
  // start only matters at the granularity of a refresh, and `marketData`
  // changes on every one of those, so the memo already re-runs then.
  //
  // MUST sit above the `portYtd.length < 2` early return below — this
  // component has shipped React error #310 once by putting a hook after
  // one. Nothing here is conditional.
  // Identity for the props and state that genuinely gate the answer, plus
  // a SIGNATURE for `spWindow` — it is rebuilt by `.filter()` on every
  // render, so its identity always differs and keying on it made the
  // cache miss every time (measured: 3 valuations became 15 across five
  // renders). Length + both ends + the right-edge close move whenever
  // the window really moves; anything subtler is followed by a
  // `marketData` change on the same 30-second tick anyway.
  //
  // `todayMs` is deliberately NOT a dep: it is `Date.now()`, so it
  // changes on every render by construction and would defeat the cache
  // outright. It is read for day-granularity comparisons, and the cached
  // value is at most one refresh tick old. `yearStartDate` is
  // `spWindow[0].date`, already covered by the signature.
  const spEnd = spWindow[spWindow.length - 1];
  const seriesDeps = [portfolio, marketData, extendedHours, phase, tickers, hist,
    overnight, recorded, rangeKey, anchorDate, fxToUSD,
    spWindow.length, spWindow[0]?.date, spEnd?.date, spEnd?.close];
  let series = seriesCacheRef.current;
  if (!series
      || series.deps.length !== seriesDeps.length
      || seriesDeps.some((d, i) => !Object.is(d, /** @type {any} */ (series).deps[i]))) {
    series = { deps: seriesDeps, val: (() => {
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
    // Fold in this account's own recorded prints. They go into the same
    // per-ticker bar arrays Yahoo's history arrives in, so `computeAt`
    // treats a recorded bar and a fetched bar identically and there is
    // still exactly one valuation of the book. A recorded bar wins a tie:
    // it is our own observation of the tape, not a vendor number that can
    // be revised later.
    const windowStartMs = rangeStartMs(rangeKey, Date.now());
    const histWithRecorded = mergeRecordedBars(histForTickers, recorded, rangeKey, windowStartMs);
    const recordedFrom = recordedFromMs(recorded);
    // `true` = anchor every range, 24H included, at the window's own first
    // bar. See buildTickerSeries: without it the shortest window reports
    // its move against yesterday's close, which is a different quantity
    // from the one the Investment view of the same window reports.
    const tickerSeries = buildTickerSeries(histWithRecorded, anchorDate, rangeKey, tickerMarketData, useExt, true);

    const liveAnchorDate = spWindow[spWindow.length - 1].date;
    const ytdOpts = {
      portfolio, tickerSeries, marketData: tickerMarketData,
      yearStart: anchorDate, yearStartDate, todayMs, liveAnchorDate, useExt, fxToUSD,
      // No forced previous-close basis, on any range.
      //
      // It existed to make 1D match the scoreboard's DAY CHANGE, and that
      // reading is gone: the shortest window is a trailing 24 h measured
      // from its own first point. Keeping it actively broke that promise.
      // On every OTHER range a pre-window lot's basis is the window-start
      // close, so the basis at the first point already equals the value at
      // the first point, the rebase is a no-op, and the reported figure is
      // exactly the window's move. Forcing prevClose on 1D made the basis
      // yesterday's close instead — measured on a fixture whose book went
      // 2500 -> 2900 (a clean +16.00 %), the panel reported +14.81 % while
      // the Investment view of the same window reported +16.00 %. Two
      // numbers for one quantity, on one screen.
      //
      // The leak it was guarding against — a lot dated TODAY using its own
      // cost as basis and dragging the position's whole gain into a day
      // window — was a symptom of the T212 sync re-dating every synced lot
      // to today on every refresh. That is fixed at the source. A lot
      // genuinely bought inside the window SHOULD use its cost: it
      // contributes nothing at the moment of purchase and its move counts
      // from there, which is what stops money paid in reading as a gain.
    };

    const portYtd = spWindow.map(p => {
      const { value, basis } = computeAt({ ...ytdOpts, date: p.date });
      const pct = basis > 0 ? ((value - basis) / basis) * 100 : 0;
      // `value` is the book in dollars at this point — the Investment view
      // draws exactly this, so it is by construction the same number the
      // vs-S&P view turns into a percentage.
      return { date: p.date, pct, value };
    });
    return { portYtd, recordedFrom };
    })() };
    seriesCacheRef.current = series;
  }
  const { portYtd, recordedFrom } = series.val;

  if (portYtd.length < 2) {
    return renderShell(<div className="sparkline-empty dim mono">Insufficient data</div>, rangeKey, setRangeKey);
  }

  // Re-binding for downstream rendering code that still uses
  // spYtd / yearStart names.
  const spYtd = spWindow;

  // BOTH lines start the window at 0 %, on EVERY range including the
  // shortest. What the panel answers is "how did these two move against
  // each other over the window I'm looking at", and that question only
  // has an unambiguous answer when both are measured from the same
  // instant — the window's own first point. Anchoring the S&P on a
  // previous close (or a prior-year-end close) while the portfolio starts
  // at 0 puts a step into one line that the other never sees, so the gap
  // between them at the right edge was not the relative performance it
  // appeared to be.
  //
  // Rebasing only subtracts a constant from every point of a series, so
  // it cannot change a line's SHAPE — just where the zero line sits. On
  // every range the portfolio's basis at the window's first point now
  // equals its value there, so the subtraction is a no-op and the
  // reported figure IS the window's move. The S&P's old previous-close /
  // prior-year-end anchor is gone with it: the benchmark has no baseline
  // other than its own first bar in the window.
  const portBase = portYtd[0].pct;
  const portNorm = portYtd.map(p => ({ date: p.date, v: p.pct - portBase }));
  const spOpen   = hasSp && spYtd.length > 0 ? spYtd[0].close : 0;
  const spNorm   = (hasSp && spOpen > 0)
    ? spYtd.map(p => ({ date: p.date, v: ((p.close - spOpen) / spOpen) * 100 }))
    : [];

  // ---- Which pair of lines this view draws.
  //
  // `lineA` is the emphasised one (portfolio, either way), `lineB` the
  // reference (the index, or money paid in). Both carry `{date, v}`; the
  // unit of `v` is what `isInv` decides, and every formatter below reads
  // it through `fmtSeriesVal` / the axis formatter rather than assuming.
  const isInv = view === 'investment';
  // Money in, evaluated on the SAME dates the value line is sampled at.
  // Null when a currency has no frozen deposit rate yet (see
  // deposit_series.js) — the value line still draws.
  const depositLine = isInv
    ? depositSeries({
        portfolio, dates: portYtd.map(p => p.date),
        fxRates: portfolio?.depositFxRates,
        // Real fill dates for the broker-synced slice. Safe to use
        // mid-backfill: the stand-in absorbs whatever the fills don't
        // cover, so a half-walked history adds dated steps without ever
        // changing the total.
        t212Orders: t212Orders?.rows || null,
      })
    : null;
  const lineA = isInv ? portYtd.map(p => ({ date: p.date, v: p.value })) : portNorm;
  const lineB = isInv ? (depositLine || []) : spNorm;

  // SVG coordinate helpers. The dollar axis needs a wider left gutter:
  // "$167k" does not fit where "+20%" did.
  const W = 300, H = 106;
  const padL = isInv ? 44 : 34, padR = 8, padT = 10, padB = 20;
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
  const portIdxOf = new Map(lineA.map((p, i) => [p.date, i]));
  const spIdxOf   = new Map(lineB.map((p, i) => [p.date, i]));
  const totalLen  = Math.max(lineA.length, lineB.length, 2);
  const xOfPort = (date) => padL + ((portIdxOf.get(date) ?? 0) / Math.max(1, totalLen - 1)) * cW;
  const xOfSp   = (date) => padL + ((spIdxOf.get(date)   ?? 0) / Math.max(1, totalLen - 1)) * cW;

  // Y range. The percentage view always includes 0 — zero IS the
  // comparison there. The dollar view must NOT: a $167k book against a
  // $129k deposit line would spend 77 % of the chart's height getting
  // down to $0 and flatten both lines into the top edge.
  const allVals = isInv
    ? [...lineA.map(p => p.v), ...lineB.map(p => p.v)]
    : [...lineA.map(p => p.v), ...lineB.map(p => p.v), 0];
  const rawMin  = allVals.length > 0 ? Math.min(...allVals) : 0;
  const rawMax  = allVals.length > 0 ? Math.max(...allVals) : 0;
  const yPad    = isInv
    ? Math.max(Math.abs(rawMax) * 0.002, (rawMax - rawMin) * 0.12)
    : Math.max(1.5, (rawMax - rawMin) * 0.12);
  const yMin = rawMin - yPad;
  const yMax = rawMax + yPad;
  const yRange = yMax - yMin || 1;
  const yOf = p => padT + ((yMax - p) / yRange) * cH;

  // Nice Y ticks. Percentages come off a fixed ladder; dollars have to
  // be derived, because the same axis has to read well for a $900 book
  // and a $9M one.
  /** @type {number[]} */
  let ticks = [];
  if (isInv) {
    ticks = moneyTicks(yMin, yMax, 4);
  } else {
    const tickStep = (() => {
      const r = yMax - yMin;
      if (r <= 8)  return 2;
      if (r <= 20) return 5;
      if (r <= 50) return 10;
      return 20;
    })();
    for (let t = Math.ceil(yMin / tickStep) * tickStep; t <= yMax; t += tickStep) ticks.push(t);
  }

  // X-axis labels. With index-based positioning we can't pin labels
  // to calendar months any more (each step is a data point, not a
  // wall-clock step), so we sample a handful of equally-spaced
  // indices and let the formatter decide what's most useful: HH:MM
  // for 1D intraday, "Mon DD" for 1W/1M (intraday bars are
  // distinguishable from the curve itself — the user found
  // "Mon DD HH:MM" too noisy), and bare month for 3M/YTD.
  const months = [];
  if (lineA.length > 0) {
    const denom = Math.max(1, lineA.length - 1);
    const labelCount = rangeKey === '1D' ? 4 : 5;
    for (let i = 0; i <= labelCount; i++) {
      const idx = Math.round((lineA.length - 1) * (i / labelCount));
      const safeIdx = Math.max(0, Math.min(lineA.length - 1, idx));
      const dateStr = lineA[safeIdx].date;
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
  const toPath = (norm, xFn, from = 0, to = norm.length) => {
    const seg = norm.slice(from, to);
    if (seg.length === 0) return '';
    return 'M' + seg.map(p => `${xFn(p.date).toFixed(1)},${yOf(p.v).toFixed(1)}`).join('L');
  };
  // Provenance: on the Investment view the stretch to the left of the
  // first RECORDED sample is a reconstruction from the ledger and Yahoo's
  // bars, not something anyone wrote down at the time. Draw it faded,
  // with a dotted rule at the handover, and mark its crosshair readings
  // with a `~`. -1 means the whole window is one or the other.
  const splitIdx = isInv ? provenanceSplitIndex(lineA, recordedFrom, (d) => parseChartDateUTC(d).getTime()) : -1;
  const hasDerivedHead = splitIdx > 0;
  // The two segments overlap by one point so the line has no visual gap
  // at the handover.
  const portPath = hasDerivedHead ? toPath(lineA, xOfPort, splitIdx) : toPath(lineA, xOfPort);
  const derivedPath = hasDerivedHead ? toPath(lineA, xOfPort, 0, splitIdx + 1) : '';
  const spPath   = toPath(lineB, xOfSp);

  const portCurrent = lineA.length > 0 ? lineA[lineA.length - 1].v : null;
  const spCurrent   = lineB.length > 0 ? lineB[lineB.length - 1].v : null;
  // In the dollar view the emphasis colour tracks the WINDOW's move, not
  // the sign of an absolute balance — every balance is positive.
  const portWindowPct = windowPct(lineA);
  const depWindowPct  = windowPct(lineB);
  const portColor = isInv
    ? ((portWindowPct ?? 0) >= 0 ? 'var(--gain)' : 'var(--loss)')
    : (portCurrent != null && portCurrent >= 0 ? 'var(--gain)' : 'var(--loss)');
  const spColor   = '#6b7280';
  const zeroY = yOf(0);

  // Two-decimal precision matches the ticker drill modal's per-row %
  // (`fmtPct` from utils) so the legend and crosshair chips read at
  // the same precision as the rest of the app.
  const fmtP1 = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  // What a chip / legend value reads. Percentages in the vs-S&P view,
  // money in the Investment one — masked when the user has values hidden.
  const fmtSeriesVal = (n) => (isInv ? (hideValues ? '••••' : fmtChipMoney(n)) : fmtP1(n));

  // Hover crosshair — DOM-ref based for the same reasons as the
  // ticker modal: setting React state on every mousemove would
  // reconcile the whole SVG (path with up to ~150 points) on every
  // frame. Refs + setAttribute inside a rAF keeps everything else in
  // the chart untouched while the cursor moves. The refs + their
  // useEffect cleanups live above the early returns so the hook
  // count stays stable; only the closures-over-render-vars (paint
  // helper, mouse handlers) live here.

  // Lookup tables for crosshair index→data.
  const portByIdx = lineA;
  const spByIdx   = lineB.length === lineA.length ? lineB : null; // aligned in 1D / YTD
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
    const portY = yOf(p.v);
    if (cVlineRef.current) { cVlineRef.current.setAttribute('x1', String(x.toFixed(1))); cVlineRef.current.setAttribute('x2', String(x.toFixed(1))); }
    if (cPortDot.current) { cPortDot.current.setAttribute('cx', String(x.toFixed(1))); cPortDot.current.setAttribute('cy', String(portY.toFixed(1))); }
    const sp = spByIdx?.[idx] ?? null;
    if (sp && cSpDot.current) {
      cSpDot.current.setAttribute('cx', String(x.toFixed(1)));
      cSpDot.current.setAttribute('cy', String(yOf(sp.v).toFixed(1)));
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
      // Chip colour: sign of the percentage in the vs-S&P view; in the
      // dollar view every balance is positive, so it follows the
      // window's own direction instead.
      const chipPositive = isInv ? ((portWindowPct ?? 0) >= 0) : (p.v >= 0);
      cPortRect.current.setAttribute('fill', chipPositive ? 'rgba(70,160,90,0.85)' : 'rgba(190,60,70,0.85)');
      cPortText.current.setAttribute('y', String((portY).toFixed(1)));
      cPortText.current.textContent =
        (hasDerivedHead && idx < splitIdx ? '~' : '') + fmtSeriesVal(p.v);
    }
    if (cSpRect.current && cSpText.current) {
      if (sp) {
        const spY = yOf(sp.v);
        cSpRect.current.style.display = '';
        cSpText.current.style.display = '';
        cSpRect.current.setAttribute('y', (spY - 8).toFixed(1));
        cSpText.current.setAttribute('y', String((spY).toFixed(1)));
        cSpText.current.textContent =
          (hasDerivedHead && idx < splitIdx ? '~' : '') + fmtSeriesVal(sp.v);
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
          <span className="mono dim perf-lbl">{isInv ? 'VALUE' : 'PORTFOLIO'}</span>
          {/* The Investment legend reports each line's OWN move across
              the window, which is what was asked for in place of the
              difference-between-the-lines figure that used to sit here:
              that number was a gain, and a gain is not what either line
              measures. */}
          {isInv
            ? (portWindowPct != null && (
                <span className="mono perf-val" style={{ color: portColor }}>{fmtP1(portWindowPct)}</span>
              ))
            : (portCurrent != null && (
                <span className="mono perf-val" style={{ color: portColor }}>{fmtP1(portCurrent)}</span>
              ))}
        </span>
        <span className="perf-legend-item">
          <span className="perf-dot" style={{ background: spColor }} />
          <span className="mono dim perf-lbl">
            {isInv ? 'DEPOSITED' : (spSymbol === 'ES=F' ? 'S&P 500 FUTURES' : 'S&P 500')}
          </span>
          {isInv
            ? (depWindowPct != null && (
                <span className="mono perf-val" style={{ color: spColor }}>{fmtP1(depWindowPct)}</span>
              ))
            : (spCurrent != null && (
                <span className="mono perf-val" style={{ color: spColor }}>{fmtP1(spCurrent)}</span>
              ))}
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
              {isInv ? (hideValues ? '••' : fmtAxisMoney(t)) : `${t >= 0 ? '+' : ''}${t}%`}
            </text>
          </g>
        ))}
        {/* Zero line (stronger). Only in the percentage view — on a
            dollar axis that doesn't span zero it would be drawn off the
            plot, and where it does it means nothing. */}
        {!isInv && (
          <line x1={padL} y1={zeroY.toFixed(1)} x2={W - padR} y2={zeroY.toFixed(1)}
                stroke="var(--line)" strokeWidth="0.8" />
        )}
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
        {/* Deposit / S&P reference line. Money paid in is a step
            function, so the Investment view draws it as one instead of
            sloping between the dates money actually moved. */}
        {spPath && (
          <path d={spPath} fill="none" stroke={spColor} strokeWidth="1.2" opacity="0.75"
                strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray={isInv ? '3,2' : undefined} />
        )}
        {/* The reconstructed stretch, and the rule where the recorded
            samples take over. */}
        {derivedPath && (
          <path d={derivedPath} fill="none" stroke={portColor} strokeWidth="1.6" opacity="0.4"
                strokeLinejoin="round" strokeLinecap="round" />
        )}
        {hasDerivedHead && (() => {
          const x = xOfPort(lineA[splitIdx].date).toFixed(1);
          return (
            <g>
              <line x1={x} y1={padT} x2={x} y2={H - padB}
                    stroke="rgba(244,239,227,0.35)" strokeWidth="0.7" strokeDasharray="2,3" />
              <text x={x} y={padT - 2} textAnchor="middle"
                    fontSize="6.5" fill="rgba(244,239,227,0.45)" fontFamily="var(--font-mono)">
                RECORDED
              </text>
            </g>
          );
        })()}
        {/* Portfolio line */}
        {portPath && (
          <path d={portPath} fill="none" stroke={portColor} strokeWidth="1.6"
                strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Dot at last portfolio point */}
        {lineA.length > 0 && (() => {
          const last = lineA[lineA.length - 1];
          return <circle cx={xOfPort(last.date).toFixed(1)} cy={yOf(last.v).toFixed(1)}
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
/**
 * @param {{ portfolio: any, marketData: any, extendedHours: boolean, phase: string,
 *   className?: string, hideValues?: boolean,
 *   t212Orders?: {rows: any[], complete: boolean}|null }} props
 */
function PerfPanel({ portfolio, marketData, extendedHours, phase, className, hideValues = false, t212Orders = null }) {
  // Own the range here so the title can name the actual benchmark: ES=F
  // (ext-on 1D / 1W) → "S&P FUTURES", the cash index otherwise → "S&P 500".
  // The legend dot inside the chart flips the same way (spSymbolFor).
  const [rangeKey, setRangeKey] = React.useState('1D');
  // One panel slot, two charts. The range carries across the swap: the
  // user is looking at one window and asking two questions about it, so
  // flipping the view must not reset which window that is.
  const [view, setView] = React.useState(/** @type {'sp'|'investment'} */ ('sp'));
  const isInv = view === 'investment';
  const benchmarksFutures = spSymbolFor(rangeKey, extendedHours) === 'ES=F';
  // Arrow keys move between tabs and take focus with them — with
  // `tabIndex={-1}` on the inactive tab (roving tabindex, so Tab treats
  // the pair as ONE stop) arrows are the only way to reach it from the
  // keyboard. Home/End included because a two-tab list still gets them
  // from muscle memory.
  const onTabKey = React.useCallback((/** @type {React.KeyboardEvent} */ e) => {
    const k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
    e.preventDefault();
    const next = (k === 'ArrowRight' || k === 'End') ? 'investment' : 'sp';
    setView(next);
    const el = document.getElementById(next === 'sp' ? 'perf-tab-sp' : 'perf-tab-inv');
    if (el) el.focus();
  }, []);
  return (
    <section className={`panel ${className || ""}`.trim()}>
      {/* The heading IS the switch. A `⇄` button beside a title says
          only that something swaps — not what to, and not what you are
          looking at now; the sole feedback was the title rewriting
          itself after the click. Two tabs at title scale name both
          destinations, mark the current one, and cost no extra row. */}
      <div className="panel-title-row">
        <div className="view-tabs" role="tablist" aria-label="Performance view">
          <button
            type="button" role="tab" id="perf-tab-sp"
            aria-selected={!isInv} tabIndex={isInv ? -1 : 0}
            className={`view-tab mono${isInv ? '' : ' is-on'}`}
            onClick={() => setView('sp')}
            onKeyDown={onTabKey}
          >VS {benchmarksFutures ? <>S&amp;P FUT</> : <>S&amp;P 500</>}</button>
          <span className="view-tab-sep" aria-hidden="true" />
          <button
            type="button" role="tab" id="perf-tab-inv"
            aria-selected={isInv} tabIndex={isInv ? 0 : -1}
            className={`view-tab mono${isInv ? ' is-on' : ''}`}
            onClick={() => setView('investment')}
            onKeyDown={onTabKey}
          >INVESTMENT</button>
        </div>
      </div>
      <PerfChart
        portfolio={portfolio}
        marketData={marketData}
        extendedHours={extendedHours}
        phase={phase}
        rangeKey={rangeKey}
        setRangeKey={setRangeKey}
        view={view}
        hideValues={hideValues}
        t212Orders={t212Orders}
      />
    </section>
  );
}

export { PerfChart, PerfPanel };
