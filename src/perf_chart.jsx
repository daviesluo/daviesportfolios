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
import {
  fetchHistorical,
  fetchHistoricalBatch,
  usMarketHoursUtc,
} from './utils.js';
import { YtdStore } from './chart_store.js';
import {
  buildTickerSeries,
  computeAt,
  RANGES,
  RANGE_KEYS,
  anchorDateFor,
  fetchParamsFor,
  filterToLatestDay,
  filterToLast24h,
} from './ytd.js';
import { pointerToDataIndex } from './chart_geometry.js';
import { reportError } from './ops_error.js';

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
// `y${year}|${rangeKey}|${ticker}`. ytdSnapshot() rebuilds the
// nested {year, byRange:{rkey:{entries:{ticker:...}}}} shape that
// callers were used to.
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

// Parse a chart date string. Intraday strings come in as
// "YYYY-MM-DDTHH:MM" UTC without a Z; without that suffix `new Date`
// reads them as local. Append Z for the truncated UTC shape.
function parsePerfDate(d) {
  if (typeof d !== 'string') return new Date(d);
  if (d.length === 16 && d[10] === 'T') return new Date(d + 'Z');
  return new Date(d);
}

// YTD performance chart: portfolio % return vs S&P 500, computed from
// per-lot purchase history + historical closes (Yahoo Finance),
// normalised from the first trading day of the calendar year.
function PerfChart({ portfolio, marketData, extendedHours, phase }) {
  // Default to 1D so the chart opens on today's intraday view; YTD is a
  // single button-click away when the user wants the long view.
  const [rangeKey, setRangeKey] = React.useState('1D');
  // 1D's fetch params depend on the ext-hours toggle + market phase, so
  // include those in the cache key. Other ranges are insensitive.
  const variantKey = rangeKey === '1D'
    ? (extendedHours ? 'ext' : (phase === 'regular' ? 'reg' : 'closed'))
    : 'std';
  // The S&P 500 reference uses the futures contract (ES=F) whenever
  // the user has the extended-hours toggle on for 1D — even during
  // regular hours, since "ext on" is the user's signal that they want
  // to track futures pricing. The legend label flips to
  // "S&P 500 FUTURES" to match.
  const spSymbol = (rangeKey === '1D' && extendedHours) ? 'ES=F' : '^GSPC';
  const [hist,    setHist]    = React.useState(null);
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
    const params = fetchParamsFor(rangeKey, extendedHours, phase);
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
        if (data && params.variant === 'closed') data = filterToLatestDay(data);
        else if (data && (params.variant === 'reg' || params.variant === 'ext')) data = filterToLast24h(data);
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
    const symbols = [spSymbol, ...tickers];
    const others = RANGE_KEYS.filter(k => k !== rangeKey);
    let cancelled = false;
    (async () => {
      for (const rk of others) {
        if (cancelled) return;
        const otherVariant = rk === '1D'
          ? (extendedHours ? 'ext' : (phase === 'regular' ? 'reg' : 'closed'))
          : 'std';
        const cacheKey = `${rk}:${otherVariant}`;
        const ttl = PERF_CACHE_TTL_MS[rk] || PERF_CACHE_TTL_MS.YTD;
        const entries = loadPerfCache(year, cacheKey);
        const stale = symbols.filter(s => {
          const e = entries[s];
          return !(e && e.data && Array.isArray(e.data) && (Date.now() - (e.ts || 0)) < ttl);
        });
        if (stale.length === 0) continue;
        const params = fetchParamsFor(rk, extendedHours, phase);
        const batch = await fetchHistoricalBatch(stale, params.yahooRange, params.interval, params.includePrePost);
        if (cancelled) return;
        const newEntries = { ...entries };
        const now = Date.now();
        for (const s of stale) {
          let data = batch[s];
          if (data && params.variant === 'closed') data = filterToLatestDay(data);
          else if (data && (params.variant === 'reg' || params.variant === 'ext')) data = filterToLast24h(data);
          if (data) newEntries[s] = { ts: now, data };
        }
        savePerfCache(year, cacheKey, newEntries);
      }
    })();
    return () => { cancelled = true; };
  }, [tickerKey, rangeKey, variantKey, loading, error]);

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
  const allSpRaw = (hist[spSymbol] || [])
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
  //     dropping bars outside that window.
  const allSp = (rangeKey === '1D' && (spSymbol === '^GSPC' || spSymbol === 'ES=F'))
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
    const fallbackSeries = (hist[bestKey] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
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

  // S&P 500 baseline. 1D anchors at "the most recent 16:00 ET regular
  // close that has occurred":
  //   - regular hours → prevClose (yesterday's close from marketData)
  //   - ext-on AH/PM  → today's 16:00 ET bar from the fetched ES=F
  //                     window (= the bar at exactly closeHh:closeMm
  //                     UTC), so the chart's right-edge % is the move
  //                     since today's just-finished cash close. The
  //                     ticker-drill modal uses the same anchor and
  //                     the MC card's todayRegularClose field is filled
  //                     from the same bar lookup, so all three agree.
  // For daily ranges the basis is the last close strictly before anchorDate.
  let spBase;
  if (rangeKey === '1D') {
    if (useExt) {
      let closeIdx = -1;
      for (let i = spWindow.length - 1; i >= 0; i--) {
        const d = spWindow[i].date;
        if (d.length < 16) continue;
        const hh = parseInt(d.slice(11, 13), 10);
        const mm = parseInt(d.slice(14, 16), 10);
        // Strict closeHh:closeMm match — see the marker block below for
        // why a hh<closeHh fallback would mis-select a premarket bar.
        if (hh === mh.closeHh && mm === mh.closeMm) { closeIdx = i; break; }
      }
      const gspc = marketData?.['^GSPC'];
      spBase = closeIdx >= 0
        ? spWindow[closeIdx].close
        : (gspc && gspc.lastPrice && gspc.lastPrice > 0
            ? gspc.lastPrice
            : (marketData?.[spSymbol]?.prevClose ?? spWindow[0].close));
    } else {
      const md = marketData?.[spSymbol];
      spBase = (md && md.prevClose && md.prevClose > 0) ? md.prevClose : spWindow[0].close;
    }
  } else {
    const spPrior = hasSp ? allSp.filter(p => p.date < anchorDate) : [];
    spBase = spPrior.length > 0 ? spPrior[spPrior.length - 1].close : spWindow[0].close;
  }

  /** @type {Record<string, {date:string,close:number}[]>} */
  const histForTickers = {};
  for (const t of tickers) histForTickers[t] = hist[t] || [];
  const tickerSeries = buildTickerSeries(histForTickers, anchorDate, rangeKey, tickerMarketData, useExt);

  const liveAnchorDate = spWindow[spWindow.length - 1].date;
  const ytdOpts = {
    portfolio, tickerSeries, marketData: tickerMarketData,
    yearStart: anchorDate, yearStartDate, todayMs, liveAnchorDate, useExt, fxToUSD,
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
  const portNorm = portYtd;
  const spNorm   = hasSp ? spYtd.map(p => ({ date: p.date, pct: ((p.close - spBase) / spBase) * 100 })) : [];

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
      const d = parsePerfDate(dateStr);
      let label;
      if (rangeKey === '1D') {
        label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
    const d = parsePerfDate(dateStr);
    if (rangeKey === '1D') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
    if (cDateRect.current) cDateRect.current.setAttribute('x', String((x - 22).toFixed(1)));
    if (cDateText.current) { cDateText.current.setAttribute('x', String(x.toFixed(1))); cDateText.current.textContent = fmtCrosshairDate(p.date); }
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
            for (let i = spYtd.length - 1; i >= 0; i--) {
              const d = spYtd[i].date;
              if (d.length < 16) continue;
              const hh = parseInt(d.slice(11, 13), 10);
              const mm = parseInt(d.slice(14, 16), 10);
              // Strict closeHh:closeMm match. A looser hh<closeHh
              // fallback matches premarket bars after midnight UTC, so
              // the CLOSE marker would jump onto a 9:30 ET premarket
              // bar instead of yesterday's actual 16:00 ET close.
              if (hh === mh.closeHh && mm === mh.closeMm) { closeIdx = i; break; }
            }
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
function PerfPanel({ portfolio, marketData, extendedHours, phase, className }) {
  return (
    <section className={`panel ${className || ""}`.trim()}>
      <h3 className="panel-title">PERFORMANCE VS S&amp;P 500</h3>
      <PerfChart
        portfolio={portfolio}
        marketData={marketData}
        extendedHours={extendedHours}
        phase={phase}
      />
    </section>
  );
}

export { PerfChart, PerfPanel };
