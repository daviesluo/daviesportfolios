// Header + Sidebar components
import React from 'react';
import {
  fmtMoney as fmM,
  fmtPct as fmP,
  fmtPrice as fmtPr,
  pctColor as pcC,
  londonTimeParts,
  usMarketPhase,
  ukTzAbbr,
  usMarketHoursUtc,
  formatAgo,
  fxToUSD,
  fetchHistorical,
  fetchHistoricalBatch,
  Storage,
} from './utils.js';
import { buildTickerSeries, computeAt, ytdPct, RANGES, RANGE_KEYS, anchorDateFor, fetchParamsFor, filterToLatestDay, filterToLast24h } from './ytd.js';
import { reportError } from './ops_error.js';

// Tiny placeholder shell so the loading / error / range-button row renders
// the same chrome as the full chart — keeps the layout from jumping when
// the user flips between ranges.
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

// Eye icons for the "hide values" toggle in the scoreboard. Inline SVG so
// they inherit currentColor and don't need an extra HTTP request.
function EyeOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeClosedIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a18.55 18.55 0 0 1-3.06 4.05" />
      <path d="M6.61 6.61A18.66 18.66 0 0 0 2 12s3.5 7 10 7a10.94 10.94 0 0 0 5.39-1.39" />
      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
    </svg>
  );
}

// Phase → color mapping
const PHASE = {
  regular:    { color: "var(--gain)",   label: "Market Open" },
  premarket:  { color: "var(--gold)",   label: "Pre-market" },
  afterhours: { color: "#b779ff",       label: "After-hours" },
  overnight:  { color: "#5b6fb8",       label: "Overnight" },
};

function useClock(intervalMs = 1000) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Hidden-values mask. When the user has the eye toggle closed we replace
// each digit with a bullet (•) — bullet is vertically centered in most
// fonts so masked rows stay flat ("$•••,•••.••" reads as a clean line).
// Asterisks drifted toward the top of the x-height in our mono font and
// made the masked numbers look like they were floating at different
// heights compared to unmasked text on the same page.
function mask(s) { return typeof s === 'string' ? s.replace(/\d/g, '•') : s; }

function Header({ metrics, source, lastUpdated, isRefreshing, onRefresh, editMode, setEditMode, isReadOnly, extendedHours, onToggleExtended, viewMode, onToggleView, hideValues, onToggleHideValues }) {
  const now = useClock(1000);
  const t = londonTimeParts(now);
  const phase = usMarketPhase(now);
  const phaseInfo = PHASE[phase] || PHASE.overnight;
  // Scoreboard time label flips between BST (Mar–Oct) and GMT (Oct–Mar)
  // automatically, since the displayed hh:mm is `Europe/London` from
  // londonTimeParts and the user expects the abbreviation to match.
  const tzLabel = `${ukTzAbbr(now)} TIME`;
  const dayClr = pcC(metrics.dayPct);

  const agoMs = lastUpdated ? (now.getTime() - lastUpdated.getTime()) : null;
  const agoText = lastUpdated ? formatAgo(agoMs) : "—";

  // Scoreboard flash: detect value changes on price refresh
  /** @type {React.MutableRefObject<import('./types').PortfolioMetrics | null>} */
  const prevMetrics = React.useRef(null);
  /** @type {[Record<string, 'up' | 'down'>, (f: Record<string, 'up' | 'down'>) => void]} */
  const [sbFlash, setSbFlash] = React.useState({});
  React.useEffect(() => {
    if (!prevMetrics.current) { prevMetrics.current = metrics; return; }
    const prev = prevMetrics.current;
    const eps = 0.01;
    /** @type {Record<string, 'up' | 'down'>} */
    const f = {};
    if (Math.abs((metrics.marketValue ?? 0) - (prev.marketValue ?? 0)) > eps)
      f.mv   = metrics.marketValue  > prev.marketValue  ? "up" : "down";
    if (Math.abs((metrics.dayChange ?? 0) - (prev.dayChange ?? 0)) > eps)
      f.day  = metrics.dayChange    > prev.dayChange    ? "up" : "down";
    if (Math.abs((metrics.unrlGL ?? 0) - (prev.unrlGL ?? 0)) > eps)
      f.unrl = metrics.unrlGL       > prev.unrlGL       ? "up" : "down";
    prevMetrics.current = metrics;
    if (Object.keys(f).length) {
      setSbFlash(f);
      setTimeout(() => setSbFlash({}), 1400);
    }
  }, [metrics]);

  const statusLabel =
    isRefreshing ? "REFRESHING…" :
    source === "live" ? "LIVE" :
    source === "error" ? "RETRYING…" : "…";

  return (
    <header className="header">
      <div className="brand">
        <div>
          <div className="brand-title">Davies' Portfolios</div>
          <div className="view-toggle">
            <span className={`view-lbl mono${viewMode !== 'heatmap' ? ' view-lbl-on' : ''}`}>TACTICS BOARD</span>
            <label className="view-switch" title="Switch view">
              <input type="checkbox" className="ext-checkbox"
                     checked={viewMode === 'heatmap'}
                     onChange={() => onToggleView(viewMode === 'heatmap' ? 'tactics' : 'heatmap')} />
              <span className="ext-track"><span className="ext-thumb" /></span>
            </label>
            <span className={`view-lbl mono${viewMode === 'heatmap' ? ' view-lbl-on' : ''}`}>HEAT MAP</span>
          </div>
          <div className="brand-formation mono">{metrics.tickerCount} tickers</div>
        </div>
        {/* Mobile only: time + toggle lives here instead of in scrolling scoreboard */}
        <div className="brand-time">
          <div className="sb-time-line">
            <span className="sb-label-inline mono">{tzLabel}</span>
            <span className="phase-dot" style={{ background: phaseInfo.color }} title={phaseInfo.label} />
            <span className="sb-value mono">{t.hh}:{t.mm}:{t.ss}</span>
          </div>
          <label
            className="ext-switch"
            style={/** @type {React.CSSProperties} */ ({ "--ext-on-color": phaseInfo.color })}
            title={extendedHours ? "Showing extended-hours prices — click to switch off" : "Click to show pre-market / after-hours prices"}
          >
            <span className="ext-switch-label mono">EXTENDED HOURS</span>
            <input type="checkbox" className="ext-checkbox" checked={extendedHours} onChange={onToggleExtended} />
            <span className="ext-track"><span className="ext-thumb" /></span>
          </label>
        </div>
      </div>

      <div className="scoreboard">
        <div className="scoreboard-cell scoreboard-cell-time">
          <div className="sb-time-line">
            <span className="sb-label-inline mono">{tzLabel}</span>
            <span className="phase-dot" style={{ background: phaseInfo.color }} title={phaseInfo.label} />
            <span className="sb-value mono">{t.hh}:{t.mm}:{t.ss}</span>
          </div>
          <label
            className="ext-switch"
            style={/** @type {React.CSSProperties} */ ({ "--ext-on-color": phaseInfo.color })}
            title={extendedHours ? "Showing extended-hours prices — click to switch off" : "Click to show pre-market / after-hours prices"}
          >
            <span className="ext-switch-label mono">EXTENDED HOURS</span>
            <input type="checkbox" className="ext-checkbox" checked={extendedHours} onChange={onToggleExtended} />
            <span className="ext-track"><span className="ext-thumb" /></span>
          </label>
        </div>
        <div className="scoreboard-divider scoreboard-divider-time" />
        <div className="scoreboard-cell">
          <div className="sb-label sb-label-row">
            <span>PORTFOLIO</span>
            <button
              type="button"
              className="hide-eye"
              onClick={onToggleHideValues}
              aria-label={hideValues ? "Show values" : "Hide values"}
              title={hideValues ? "Click to show values" : "Click to hide values"}
            >
              {hideValues ? <EyeClosedIcon /> : <EyeOpenIcon />}
            </button>
          </div>
          <div className={`sb-value sb-value-lg mono${sbFlash.mv ? " sb-flash-" + sbFlash.mv : ""}`}>{hideValues ? mask(fmM(metrics.marketValue)) : fmM(metrics.marketValue)}</div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">DAY CHANGE</div>
          <div className={`sb-value mono sb-change-row${sbFlash.day ? " sb-flash-" + sbFlash.day : ""}`} style={{ color: pcC(metrics.dayPct) }}>
            <span>{hideValues ? mask(fmM(metrics.dayChange, { signed: true })) : fmM(metrics.dayChange, { signed: true })}</span>
            <span className="sb-pct">({fmP(metrics.dayPct)})</span>
          </div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">UNREALIZED G/L</div>
          <div className={`sb-value mono sb-change-row${sbFlash.unrl ? " sb-flash-" + sbFlash.unrl : ""}`} style={{ color: pcC(metrics.unrlPct) }}>
            <span>{hideValues ? mask(fmM(metrics.unrlGL, { signed: true })) : fmM(metrics.unrlGL, { signed: true })}</span>
            <span className="sb-pct">({fmP(metrics.unrlPct)})</span>
          </div>
        </div>
      </div>

      <div className="header-actions">
        <div className={`live-pill ${isRefreshing ? "refreshing" : ""} ${source === "error" ? "err" : ""}`}
             title={source === "live" ? "Yahoo Finance" : source === "error" ? "Retrying…" : "Connecting"}>
          <span className={`live-dot ${isRefreshing ? "pulse" : ""} ${source === "error" ? "err" : ""}`} />
          <div className="live-col">
            <span className="live-txt">{statusLabel}</span>
            <span className="live-ago mono">Last updated {agoText}</span>
          </div>
        </div>
        <button className="btn-ghost" onClick={onRefresh} disabled={isRefreshing} title="Refresh prices">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
               className={isRefreshing ? "spin" : ""}>
            <path d="M3 12a9 9 0 1 1 3 6.7" />
            <path d="M3 20v-5h5" />
          </svg>
          {isRefreshing ? "Refreshing" : "Refresh"}
        </button>
        {isReadOnly ? (
          <span className="ro-badge mono" title="Read-only viewer">VIEWER</span>
        ) : (
          <button className={`btn-toggle ${editMode ? "on" : ""}`} onClick={() => setEditMode(v => !v)}>
            {editMode ? "✓ EDIT MODE" : "EDIT"}
          </button>
        )}
      </div>
    </header>
  );
}

// Portfolio Performance chart: portfolio % return vs S&P 500, with a range
// selector (1D / 1W / 1M / 3M / YTD). We cache historical closes per
// (range, ticker) in localStorage so switching between ranges is instant
// once they've been fetched once. Cache TTL is short for 1D (intraday data
// becomes stale fast) and longer for daily ranges.
// TTL is matched to each range's bar interval so we don't refetch
// faster than Yahoo can publish a new bar:
//   1D   → 5  m bars  →  5 m TTL
//   1W   → 30 m bars  → 30 m TTL
//   1M   → 60 m bars  →  1 h TTL
//   3M   →  1 d bars  → 12 h TTL
//   YTD  →  1 d bars  → 12 h TTL
// stale-while-revalidate (above) means even past TTL the cached chart
// renders instantly while the next fetch runs silently in background.
const PERF_CACHE_TTL_MS = {
  '1D':  5  * 60 * 1000,
  '1W':  30 * 60 * 1000,
  '1M':  60 * 60 * 1000,
  '3M':  12 * 60 * 60 * 1000,
  'YTD': 12 * 60 * 60 * 1000,
};

function loadPerfCache(year, rangeKey) {
  const parsed = Storage.loadYtd();
  if (!parsed || parsed.year !== year || !parsed.byRange) return {};
  return parsed.byRange[rangeKey]?.entries || {};
}
function savePerfCache(year, rangeKey, entries) {
  const cur = Storage.loadYtd();
  const byRange = (cur && cur.year === year && cur.byRange) ? cur.byRange : {};
  byRange[rangeKey] = { entries };
  Storage.saveYtd({ year, byRange });
}

// YTD performance chart: portfolio % return vs S&P 500, computed from per-lot
// purchase history + historical closes (Yahoo Finance), normalised from the
// first trading day of the calendar year.
// Parse a chart date string. Intraday strings come in as
// "YYYY-MM-DDTHH:MM" UTC without a Z; without that suffix `new Date`
// reads them as local. Append Z for the truncated UTC shape.
function parsePerfDate(d) {
  if (typeof d !== 'string') return new Date(d);
  if (d.length === 16 && d[10] === 'T') return new Date(d + 'Z');
  return new Date(d);
}

function PerfChart({ portfolio, marketData, extendedHours, phase }) {
  const [rangeKey, setRangeKey] = React.useState('YTD');
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

  // Tickers we need historical data for. We send all non-cash holdings to the
  // chart Edge Function — it routes 6-digit CN fund codes to eastmoney's
  // pingzhongdata endpoint and everything else (including .PVT) to Yahoo.
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
    // ticker, but the user perceives the chart appearing the moment the
    // S&P anchor data arrives.
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
      const [spBatch, tickersBatch] = await Promise.all([spPromise, tickersPromise]);
      if (cancelled) return;
      // After both batches resolve: if S&P is still missing, do up to 3
      // proxy retries for it specifically — the chart won't render
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
      // Final state — if still no anchor and we haven't shown anything yet,
      // surface an error.
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

  // Background prefetch the other ranges once the user's chosen range has
  // loaded so subsequent range-button clicks are instant. Sequential (not
  // parallel) to avoid hammering the Edge Function with five concurrent
  // batched fetches every time the chart mounts. Skips ranges already
  // covered by fresh per-ticker entries in the cache.
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

  if (!portfolio) return renderShell(<div className="sparkline-empty dim mono">Loading…</div>, rangeKey, setRangeKey);
  if (loading)    return renderShell(<div className="sparkline-empty dim mono">Computing…</div>, rangeKey, setRangeKey);
  if (error)      return renderShell(<div className="sparkline-empty dim mono">Couldn't load history</div>, rangeKey, setRangeKey);

  const year = new Date().getFullYear();
  // US market hours in UTC for today, used here for the ^GSPC RTH filter
  // and below for CLOSE / OPEN marker detection. Hoisted above the
  // first allSp use so the filter can reach it.
  const mh = usMarketHoursUtc(new Date());

  // S&P reference series — sorted, sliced to the selected window. For 1D
  // we DON'T filter by anchorDateFor("today") because in closed-market
  // mode the data spans yesterday, and using "today" would empty the
  // window. For daily ranges we still filter by the calendar cutoff.
  // For ^GSPC specifically, drop any bars outside regular trading hours
  // — Yahoo's prepost=true sometimes returns spurious low-volume bars
  // around the 16:00 ET close, and any of those that survive would
  // appear visually as a "data between close and open" artifact in
  // the 24-h chart.
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

  // 1D's anchor date is whatever calendar day the fetched data actually
  // covers — the latest UTC date in the series. Yesterday for closed
  // markets, today for open markets.
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
  // portfolio.holdings[t]. The chart math (1D anchor pricing, live-price
  // substitution at the right edge) needs prevClose / lastPrice /
  // extPrice for EVERY ticker, so merge them into a single map. Without
  // this, marketData[<stock>] was undefined and the 1D chart's basis
  // collapsed to null → chart drew a flat 0% line, not matching the
  // scoreboard's DAY CHANGE.
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

  // S&P 500 baseline. For 1D this is the prevClose of the S&P reference
  // (^GSPC during regular hours, ES=F in ext mode) from marketData. In
  // 1D + ext-on AH/PM we pivot to today's regular close instead so the
  // S&P line crosses 0% at the same vertical CLOSE marker the portfolio
  // line does (and matches scoreboard semantics). We locate the bar at
  // or just before 20:00 UTC (= 16:00 ET) inside the fetched ES=F window.
  // For daily ranges it's the last close strictly before anchorDate.
  let spBase;
  if (rangeKey === '1D') {
    if (useExt) {
      let closeIdx = -1;
      for (let i = spWindow.length - 1; i >= 0; i--) {
        const d = spWindow[i].date;
        if (d.length < 16) continue;
        const hh = parseInt(d.slice(11, 13), 10);
        const mm = parseInt(d.slice(14, 16), 10);
        if (hh < mh.closeHh || (hh === mh.closeHh && mm <= mh.closeMm + 5)) { closeIdx = i; break; }
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

  // Re-binding for downstream rendering code that still uses spYtd / yearStart
  const spYtd = spWindow;
  const yearStart = anchorDate;

  // S&P 500 normalised from prior-year-end close (computed earlier as spBase).
  // Empty when hasSp is false; downstream rendering already guards against
  // empty spNorm arrays via .length checks.
  const portNorm = portYtd;
  const spNorm   = hasSp ? spYtd.map(p => ({ date: p.date, pct: ((p.close - spBase) / spBase) * 100 })) : [];

  const allDates = [...portNorm.map(p => p.date), ...spNorm.map(p => p.date)].sort();
  const d0 = allDates[0];
  const d1 = allDates[allDates.length - 1];

  // SVG coordinate helpers
  const W = 300, H = 106;
  const padL = 34, padR = 8, padT = 10, padB = 20;
  const cW = W - padL - padR;
  const cH = H - padT - padB;

  // X positioning is INDEX-based (each data point = one equally-spaced
  // step), not time-based. Two reasons:
  //   1. Closed-market 1D used to clamp tSpan to a 1-day minimum, which
  //      stuffed the actual 6.5-hour intraday data into the first ~27 %
  //      of the chart, leaving the rest blank ("前半段" bug the user
  //      flagged on PR #49). Index-based positioning fills the full
  //      width regardless of how short the time span is.
  //   2. Weekend / overnight gaps don't draw empty stretches under the
  //      line — same convention every brokerage chart uses (Yahoo,
  //      Robinhood, T212).
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

  // X-axis labels. With index-based positioning we can't pin labels to
  // calendar months any more (each step is a data point, not a wall-clock
  // step), so we sample a handful of equally-spaced indices and let the
  // formatter decide what's most useful: HH:MM for 1D intraday, "Mon DD"
  // for 1W/1M (intraday bars are distinguishable from the curve itself —
  // the user found "Mon DD HH:MM" too noisy), and bare month for 3M/YTD.
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
      // Intraday strings come in as "YYYY-MM-DDTHH:MM" (UTC) without a Z
      // suffix; without that suffix `new Date(...)` parses as LOCAL,
      // shifting every label by the user's TZ offset (BST users saw
      // 1:30 PM where US market open should have read 2:30 PM).
      const isIntraday = typeof dateStr === 'string' && dateStr.length === 16 && dateStr[10] === 'T';
      const d = new Date(isIntraday ? dateStr + 'Z' : dateStr);
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

  // SVG paths — each series uses its own index map so portfolio and S&P
  // align even when the two series have slightly different point counts
  // (e.g. one ticker missed today's data).
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

  const fmtP1 = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

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
    if (!svgRef.current || portByIdx.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const vbRatio = W / H, elRatio = rect.width / rect.height;
    let contentW, contentH, offX, offY;
    if (elRatio > vbRatio) {
      contentH = rect.height; contentW = contentH * vbRatio;
      offX = (rect.width - contentW) / 2; offY = 0;
    } else {
      contentW = rect.width;  contentH = contentW / vbRatio;
      offX = 0; offY = (rect.height - contentH) / 2;
    }
    const sx = ((e.clientX - rect.left - offX) / contentW) * W;
    const clampedSx = Math.max(padL, Math.min(W - padR, sx));
    const denom = Math.max(1, portByIdx.length - 1);
    const frac = (clampedSx - padL) / cW;
    const i = Math.round(frac * denom);
    pendingIdxRef.current = Math.max(0, Math.min(portByIdx.length - 1, i));
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(paintCrosshair);
  }
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
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: 'block' }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
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
          // CLOSE only matters in 'ext' mode — walk backwards and find
          // the most recent close-hour bar.
          if (variantKey === 'ext') {
            for (let i = spYtd.length - 1; i >= 0; i--) {
              const d = spYtd[i].date;
              if (d.length < 16) continue;
              const hh = parseInt(d.slice(11, 13), 10);
              const mm = parseInt(d.slice(14, 16), 10);
              if (hh === mh.closeHh && mm <= mh.closeMm + 5) { closeIdx = i; break; }
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
        {/* Hover crosshair — vertical line + per-line dots + a tiny date
            label under the chart and per-series % chips next to each
            dot. Hidden by default; updated imperatively on mousemove. */}
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

// Standalone YTD panel — same panel chrome as TOP MOVERS / FORMATION VALUE,
// rendered separately so we can place it in the desktop left column instead
// of the sidebar. The Sidebar still renders its own copy on tablet/mobile.
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

function Sidebar({ metrics, source, portfolio, marketData, extendedHours, phase, hideValues }) {
  // top movers: by |dayPct|, both winners and losers, split
  const allPlayers = [];
  for (const pos of Object.values(metrics.positions)) {
    for (const p of pos.players) allPlayers.push({ ...p, pos: pos.label });
  }
  const movable = allPlayers.filter(p => !p.isCash && p.ticker !== "CASH");
  const winners = [...movable].sort((a, b) => (b.dayPct ?? 0) - (a.dayPct ?? 0)).slice(0, 5);
  const losers  = [...movable].sort((a, b) => (a.dayPct ?? 0) - (b.dayPct ?? 0)).slice(0, 5);

  const positionList = Object.entries(metrics.positions)
    .filter(([_, p]) => p.players.length > 0)
    .sort(([, a], [, b]) => b.marketValue - a.marketValue);

  return (
    <aside className="sidebar">
      <section className="panel">
        <h3 className="panel-title">TOP MOVERS · TODAY</h3>
        <div className="movers-grid">
          <div>
            <div className="movers-heading gain">↑ WINNERS</div>
            {winners.map(p => (
              <div key={p.ticker} className="mover-row">
                <span className="mover-ticker mono">{p.ticker}</span>
                <span className="mono" style={{ color: "var(--gain)" }}>{fmP(p.dayPct)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="movers-heading loss">↓ LOSERS</div>
            {losers.map(p => (
              <div key={p.ticker} className="mover-row">
                <span className="mover-ticker mono">{p.ticker}</span>
                <span className="mono" style={{ color: "var(--loss)" }}>{fmP(p.dayPct)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">FORMATION VALUE</h3>
        <div className="formation-list">
          {positionList.map(([k, p]) => {
            const pct = metrics.marketValue > 0 ? (p.marketValue / metrics.marketValue) * 100 : 0;
            return (
              <div key={k} className="formation-row">
                <div className="fr-top">
                  <span className="fr-label">{p.label}{p.subtitle && <span className="fr-sub"> · {p.subtitle}</span>}</span>
                  <span className="fr-val mono">{hideValues ? mask(fmM(p.marketValue)) : fmM(p.marketValue)}</span>
                </div>
                <div className="fr-bar">
                  <div className="fr-bar-fill" style={{ width: pct + "%" }} />
                </div>
                <div className="fr-meta">
                  <span className="mono dim">{pct.toFixed(1)}%</span>
                  <span className="mono" style={{ color: pcC(p.unrlPct) }}>
                    {hideValues ? mask(fmM(p.unrlGL, { signed: true })) : fmM(p.unrlGL, { signed: true })} ({fmP(p.unrlPct)})
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <PerfPanel
        portfolio={portfolio}
        marketData={marketData}
        extendedHours={extendedHours}
        phase={phase}
        className="perf-in-sidebar"
      />

      <div className="sidebar-foot sidebar-foot-desktop">
        <div className="foot-kv"><span>Source</span><span className="mono">{source === "live" ? "Yahoo Finance" : source === "sim" ? "Simulated" : "—"}</span></div>
        <div className="foot-kv"><span>Auto Refresh</span><span className="mono">30s</span></div>
        <div className="foot-kv"><span>Stored</span><span className="mono">Supabase</span></div>
      </div>
    </aside>
  );
}

function SidebarFoot({ source }) {
  return (
    <div className="sidebar-foot sidebar-foot-mobile">
      <div className="foot-kv"><span>Source</span><span className="mono">{source === "live" ? "Yahoo Finance" : source === "sim" ? "Simulated" : "—"}</span></div>
      <div className="foot-kv"><span>Auto Refresh</span><span className="mono">30s</span></div>
      <div className="foot-kv"><span>Stored</span><span className="mono">Supabase</span></div>
    </div>
  );
}

function StatRow({ label, value, mono, dim, color }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${mono ? "mono" : ""} ${dim ? "dim" : ""}`} style={color ? { color } : {}}>{value}</span>
    </div>
  );
}

// ---- Market Conditions column ----
// Ten cards laid out as a 5-row × 2-column grid on desktop (column-major):
//   col 1 → S&P 500, NASDAQ 100, Russell 2000, VIX
//   col 2 → Brent Oil, US 10Y Treasury Yield, GBP/USD, GBP/CNY
// Mobile keeps the previous 6-card layout (10Y + GBP/CNY hidden) so the
// mobile MC strip stays compact. Cards flagged hideMobile carry the
// `mc-hide-mobile` class which is display:none on the mobile breakpoint.
const MC_INDICES = [
  // Mobile renders a 3 × 3 grid (one less card than desktop, SOX dropped)
  // in the order GSPC / NDX / RUT — VIX / BZ=F / TNX — GBPUSD / GBPCNH /
  // USDCNY. The grid-auto-flow:row CSS on the mobile container means the
  // visible cards fill row-by-row in this array order.
  { ticker: "^GSPC",    name: "S&P 500",      nameB: "S&P",    nameN: "500",  ftTicker: "ES=F",  ftName: "S&P Futures"    },
  { ticker: "^NDX",     name: "NASDAQ 100",   nameB: "NASDAQ", nameN: "100",  ftTicker: "NQ=F",  ftName: "Nasdaq Futures" },
  { ticker: "^RUT",     name: "Russell 2000", nameB: "Russell",nameN: "2000", ftTicker: "RTY=F", ftName: "R2K Futures"    },
  { ticker: "^SOX",     name: "PHLX SOX",     nameB: "PHLX",   nameN: "SOX",  hideMobile: true },
  { ticker: "^VIX",     name: "VIX"          },
  { ticker: "BZ=F",     name: "Brent Oil"    },
  { ticker: "^TNX",     name: "US 10Y Yield", nameB: "US 10Y", nameN: "Yield" },
  { ticker: "GBPUSD=X", name: "GBP/USD"      },
  { ticker: "GBPCNH=X", name: "GBP/CNY"      },
  { ticker: "USDCNY=X", name: "USD/CNY"      },
];

function fmtChg(n, baseTicker) {
  if (n == null || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  if (baseTicker === "^TNX")               return sign + n.toFixed(2) + "%";
  if (baseTicker && FX_4DP.has(baseTicker)) return sign + n.toFixed(4);
  const abs  = Math.abs(n);
  if (abs >= 1000) return sign + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100)  return sign + n.toFixed(0);
  return sign + n.toFixed(2);
}

const FX_4DP = new Set(["GBPUSD=X", "GBPCNH=X"]);
function fmtMcPrice(price, baseTicker) {
  if (price == null || isNaN(price)) return "—";
  if (baseTicker === "^TNX") return price.toFixed(2) + "%";
  if (FX_4DP.has(baseTicker)) return price.toFixed(4);
  return fmtPr(price);
}

function vixRegime(price) {
  if (price == null) return null;
  if (price < 15) return { color: "var(--gain)",     label: "LOW VOL" };
  if (price < 25) return { color: "var(--chalk-dim)", label: "NORMAL" };
  if (price < 30) return { color: "var(--gold)",      label: "ELEVATED" };
  return           { color: "var(--loss)",             label: "FEAR" };
}

function MarketConditions({ marketData, extendedHours, phase, className = '' }) {
  const useExt = extendedHours && phase !== "regular";
  return (
    <aside className={`market-conditions${className ? " " + className : ""}`}>
      {MC_INDICES.map(({ ticker, name, nameB, nameN, ftTicker, ftName, hideMobile }) => {
        const activeTicker = (useExt && ftTicker) ? ftTicker : ticker;
        const activeName   = (useExt && ftName)   ? ftName   : name;
        const d         = marketData[activeTicker];
        const price     = d ? d.lastPrice : null;
        const pct       = d ? (d.dayPct ?? 0) : null;
        const prevClose = d ? (d.prevClose ?? d.lastPrice) : null;
        const dayChange = (price != null && prevClose != null) ? price - prevClose : null;
        return (
          <section key={activeTicker} className={`panel mc-card${hideMobile ? " mc-hide-mobile" : ""}`}>
            <div className="mc-card-head">
              <h3 className="panel-title" style={{ margin: 0 }}>
                {(nameB && nameN && !useExt) ? (
                  <>
                    <span className="mc-name-full">{activeName}</span>
                    <span className="mc-name-split">{nameB}<br />{nameN}</span>
                  </>
                ) : activeName}
              </h3>
              <span className="mono dim mc-card-ticker" style={{ fontSize: '10px' }}>{activeTicker}</span>
            </div>
            <div className="mc-price-row">
              <div className="mc-price mono" style={ticker === "^VIX" && price != null ? { color: vixRegime(price).color } : {}}>
                {fmtMcPrice(price, ticker)}
              </div>
              {ticker === "^VIX" && price != null && (
                <span className="mc-vix-regime mono" style={{ color: vixRegime(price).color }}>{vixRegime(price).label}</span>
              )}
            </div>
            <div className="mc-footer">
              <span className="mono" style={{ color: pcC(pct), fontSize: '11px' }}>{fmtChg(dayChange, ticker)}</span>
              <span className="mono" style={{ color: pcC(pct), fontSize: '11px' }}>{pct != null ? fmP(pct) : "—"}</span>
            </div>
          </section>
        );
      })}
    </aside>
  );
}

export { Header, Sidebar, SidebarFoot, StatRow, MarketConditions, PerfPanel };
