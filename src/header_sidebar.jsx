// Header + Sidebar components
import React from 'react';
import {
  fmtMoney as fmM,
  fmtPct as fmP,
  fmtPrice as fmtPr,
  pctColor as pcC,
  londonTimeParts,
  usMarketPhase,
  formatAgo,
  fxToUSD,
  fetchHistorical,
  fetchHistoricalBatch,
  Storage,
} from './utils.js';
import { buildTickerSeries, computeAt, ytdPct, RANGES, RANGE_KEYS, anchorDateFor } from './ytd.js';

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

// Hidden-values placeholder. Used everywhere a portfolio dollar amount
// would otherwise show, so the user can hand the screen to someone next
// to them without revealing absolute sizes — percentages stay readable.
const VALUE_MASK = "•••••";

function Header({ metrics, source, lastUpdated, isRefreshing, onRefresh, editMode, setEditMode, isReadOnly, extendedHours, onToggleExtended, histDate, viewMode, onToggleView, hideValues, onToggleHideValues }) {
  const now = useClock(1000);
  const t = londonTimeParts(now);
  const phase = usMarketPhase(now);
  const phaseInfo = PHASE[phase] || PHASE.overnight;
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
            <span className="sb-label-inline mono">GMT TIME</span>
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
            <span className="sb-label-inline mono">GMT TIME</span>
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
          <div className={`sb-value sb-value-lg mono${sbFlash.mv ? " sb-flash-" + sbFlash.mv : ""}`}>{hideValues ? VALUE_MASK : fmM(metrics.marketValue)}</div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">DAY CHANGE</div>
          <div className={`sb-value mono sb-change-row${sbFlash.day ? " sb-flash-" + sbFlash.day : ""}`} style={{ color: pcC(metrics.dayPct) }}>
            {!hideValues && <span>{fmM(metrics.dayChange, { signed: true })}</span>}
            <span className="sb-pct">{hideValues ? fmP(metrics.dayPct) : `(${fmP(metrics.dayPct)})`}</span>
          </div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">UNREALIZED G/L</div>
          <div className={`sb-value mono sb-change-row${sbFlash.unrl ? " sb-flash-" + sbFlash.unrl : ""}`} style={{ color: pcC(metrics.unrlPct) }}>
            {!hideValues && <span>{fmM(metrics.unrlGL, { signed: true })}</span>}
            <span className="sb-pct">{hideValues ? fmP(metrics.unrlPct) : `(${fmP(metrics.unrlPct)})`}</span>
          </div>
        </div>
      </div>

      <div className="header-actions">
        {histDate ? (
          <div className="live-pill" title="Viewing historical snapshot">
            <span className="live-dot" style={{ background: "var(--gold)" }} />
            <div className="live-col">
              <span className="live-txt" style={{ color: "var(--gold)" }}>SNAPSHOT</span>
              <span className="live-ago mono">{histDate.slice(5).replace("-", "/")}</span>
            </div>
          </div>
        ) : (
          <div className={`live-pill ${isRefreshing ? "refreshing" : ""} ${source === "error" ? "err" : ""}`}
               title={source === "live" ? "Yahoo Finance" : source === "error" ? "Retrying…" : "Connecting"}>
            <span className={`live-dot ${isRefreshing ? "pulse" : ""} ${source === "error" ? "err" : ""}`} />
            <div className="live-col">
              <span className="live-txt">{statusLabel}</span>
              <span className="live-ago mono">Last updated {agoText}</span>
            </div>
          </div>
        )}
        {!histDate && (
          <button className="btn-ghost" onClick={onRefresh} disabled={isRefreshing} title="Refresh prices">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
                 className={isRefreshing ? "spin" : ""}>
              <path d="M3 12a9 9 0 1 1 3 6.7" />
              <path d="M3 20v-5h5" />
            </svg>
            {isRefreshing ? "Refreshing" : "Refresh"}
          </button>
        )}
        {!histDate && (isReadOnly ? (
          <span className="ro-badge mono" title="Read-only viewer">VIEWER</span>
        ) : (
          <button className={`btn-toggle ${editMode ? "on" : ""}`} onClick={() => setEditMode(v => !v)}>
            {editMode ? "✓ EDIT MODE" : "EDIT"}
          </button>
        ))}
      </div>
    </header>
  );
}

// Portfolio Performance chart: portfolio % return vs S&P 500, with a range
// selector (1D / 1W / 1M / 3M / YTD). We cache historical closes per
// (range, ticker) in localStorage so switching between ranges is instant
// once they've been fetched once. Cache TTL is short for 1D (intraday data
// becomes stale fast) and longer for daily ranges.
const PERF_CACHE_TTL_MS = {
  '1D': 5 * 60 * 1000,           // 5 min — intraday, churns
  '1W': 4 * 60 * 60 * 1000,
  '1M': 4 * 60 * 60 * 1000,
  '3M': 4 * 60 * 60 * 1000,
  'YTD': 4 * 60 * 60 * 1000,
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
function PerfChart({ portfolio, marketData, extendedHours, phase }) {
  const [rangeKey, setRangeKey] = React.useState('YTD');
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
    const symbols = ['^GSPC', ...tickers];
    const ranges = RANGES[rangeKey] || RANGES.YTD;
    const ttl = PERF_CACHE_TTL_MS[rangeKey] || PERF_CACHE_TTL_MS.YTD;

    // Read per-ticker cache for THIS range; show fresh entries immediately
    // and refetch anything stale in the background.
    const entries = loadPerfCache(year, rangeKey);
    /** @type {Record<string, any[]>} */
    const fresh = {};
    const stale = [];
    for (const s of symbols) {
      const e = entries[s];
      if (e && e.data && Array.isArray(e.data) && (Date.now() - (e.ts || 0)) < ttl) {
        fresh[s] = e.data;
      } else {
        stale.push(s);
      }
    }

    if (Object.keys(fresh).length > 0 && fresh['^GSPC']) {
      setHist({ ...fresh });
      setLoading(false);
    } else {
      setLoading(true);
    }

    if (stale.length === 0) return;

    (async () => {
      const batch = await fetchHistoricalBatch(stale, ranges.yahooRange, ranges.interval);
      if (cancelled) return;
      // ^GSPC anchors the X axis. Retry if the batch missed it.
      if (!batch['^GSPC']) {
        for (let i = 0; i < 3 && !batch['^GSPC']; i++) {
          await new Promise(r => setTimeout(r, 800 * (i + 1)));
          if (cancelled) return;
          const retry = await fetchHistorical('^GSPC', ranges.yahooRange, ranges.interval).catch(() => null);
          if (retry) batch['^GSPC'] = retry;
        }
      }
      const merged = { ...fresh };
      const newEntries = { ...entries };
      const now = Date.now();
      for (const s of stale) {
        if (batch[s]) {
          merged[s] = batch[s];
          newEntries[s] = { ts: now, data: batch[s] };
        } else if (entries[s] && entries[s].data) {
          merged[s] = entries[s].data;
        }
      }
      savePerfCache(year, rangeKey, newEntries);
      const hasAnchor = merged['^GSPC'] || Object.values(merged).some(s => Array.isArray(s) && s.length >= 2);
      if (!hasAnchor) {
        setError(true);
        setLoading(false);
        return;
      }
      setError(false);
      setHist(merged);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tickerKey, rangeKey]);

  if (!portfolio) return renderShell(<div className="sparkline-empty dim mono">Loading…</div>, rangeKey, setRangeKey);
  if (loading)    return renderShell(<div className="sparkline-empty dim mono">Computing…</div>, rangeKey, setRangeKey);
  if (error)      return renderShell(<div className="sparkline-empty dim mono">Couldn't load history</div>, rangeKey, setRangeKey);

  const year = new Date().getFullYear();
  const anchorDate = anchorDateFor(rangeKey);

  // S&P 500 trading dates within the selected window anchor the chart's
  // x-axis. We use range-specific cutoffs (anchorDate). If ^GSPC is
  // unavailable, fall back to the longest portfolio-ticker series.
  const allSp = (hist['^GSPC'] || [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  let spWindow = allSp.filter(p => p.date >= anchorDate);
  let hasSp = spWindow.length >= 2;
  if (!hasSp) {
    let bestKey = null, bestLen = 0;
    for (const [k, s] of Object.entries(hist || {})) {
      if (k === '^GSPC' || !Array.isArray(s)) continue;
      const slice = s.filter(p => p.date >= anchorDate);
      if (slice.length > bestLen) { bestLen = slice.length; bestKey = k; }
    }
    if (!bestKey || bestLen < 2) {
      return renderShell(<div className="sparkline-empty dim mono">No data for this range</div>, rangeKey, setRangeKey);
    }
    spWindow = (hist[bestKey] || [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter(p => p.date >= anchorDate);
  }
  const yearStartDate = spWindow[0].date;
  const todayMs = Date.now();

  // S&P 500 baseline. For 1D this is the prevClose of ^GSPC (from
  // marketData). For daily ranges it's the last close strictly before
  // anchorDate. Falls back to the first window close.
  let spBase;
  if (rangeKey === '1D') {
    const md = marketData?.['^GSPC'];
    spBase = (md && md.prevClose && md.prevClose > 0) ? md.prevClose : spWindow[0].close;
  } else {
    const spPrior = hasSp ? allSp.filter(p => p.date < anchorDate) : [];
    spBase = spPrior.length > 0 ? spPrior[spPrior.length - 1].close : spWindow[0].close;
  }

  /** @type {Record<string, {date:string,close:number}[]>} */
  const histForTickers = {};
  for (const t of tickers) histForTickers[t] = hist[t] || [];
  const tickerSeries = buildTickerSeries(histForTickers, anchorDate, rangeKey, marketData);

  const useExt = !!(extendedHours && phase && phase !== "regular");
  const liveAnchorDate = spWindow[spWindow.length - 1].date;
  const ytdOpts = {
    portfolio, tickerSeries, marketData,
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

  const t0 = new Date(d0).getTime();
  const tSpan = Math.max(new Date(d1).getTime() - t0, 86400000);
  const xOf = d => padL + ((new Date(d).getTime() - t0) / tSpan) * cW;

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

  // Month labels for X axis
  const months = [];
  {
    const d0Date = new Date(d0);
    const d1Date = new Date(d1);
    for (
      let m = new Date(d0Date.getUTCFullYear(), d0Date.getUTCMonth(), 1);
      m <= d1Date;
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1)
    ) {
      const iso = m.toISOString().slice(0, 10);
      if (iso < d0) continue;
      const x = xOf(iso);
      if (x < padL + 10 || x > W - padR - 8) continue;
      months.push({ x, label: m.toLocaleString('default', { month: 'short' }) });
    }
  }

  // SVG paths
  const toPath = norm => {
    if (norm.length === 0) return '';
    return 'M' + norm.map(p => `${xOf(p.date).toFixed(1)},${yOf(p.pct).toFixed(1)}`).join('L');
  };
  const portPath = toPath(portNorm);
  const spPath   = toPath(spNorm);

  const portCurrent = portNorm.length > 0 ? portNorm[portNorm.length - 1].pct : null;
  const spCurrent   = spNorm.length   > 0 ? spNorm[spNorm.length - 1].pct   : null;
  const portColor = portCurrent != null && portCurrent >= 0 ? 'var(--gain)' : 'var(--loss)';
  const spColor   = '#6b7280';
  const zeroY = yOf(0);

  const fmtP1 = n => (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

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
          <span className="mono dim perf-lbl">S&amp;P 500</span>
          {spCurrent != null && (
            <span className="mono perf-val" style={{ color: spColor }}>{fmtP1(spCurrent)}</span>
          )}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
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
          return <circle cx={xOf(last.date).toFixed(1)} cy={yOf(last.pct).toFixed(1)}
                         r="3" fill={portColor} stroke="#0c1310" strokeWidth="1.5" />;
        })()}
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
      <h3 className="panel-title">PORTFOLIO PERFORMANCE</h3>
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
                  <span className="fr-val mono">{hideValues ? VALUE_MASK : fmM(p.marketValue)}</span>
                </div>
                <div className="fr-bar">
                  <div className="fr-bar-fill" style={{ width: pct + "%" }} />
                </div>
                <div className="fr-meta">
                  <span className="mono dim">{pct.toFixed(1)}%</span>
                  <span className="mono" style={{ color: pcC(p.unrlPct) }}>
                    {!hideValues && <>{fmM(p.unrlGL, { signed: true })} </>}({fmP(p.unrlPct)})
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
// Eight cards laid out as a 4-row × 2-column grid on desktop (column-major):
//   col 1 → S&P 500, NASDAQ 100, Russell 2000, VIX
//   col 2 → Brent Oil, US 10Y Treasury Yield, GBP/USD, GBP/CNY
// Mobile keeps the previous 6-card layout (10Y + GBP/CNY hidden) so the
// mobile MC strip stays compact. Cards flagged hideMobile carry the
// `mc-hide-mobile` class which is display:none on the mobile breakpoint.
const MC_INDICES = [
  { ticker: "^GSPC",    name: "S&P 500",      nameB: "S&P",    nameN: "500",  ftTicker: "ES=F",  ftName: "S&P Futures"    },
  { ticker: "^NDX",     name: "NASDAQ 100",   nameB: "NASDAQ", nameN: "100",  ftTicker: "NQ=F",  ftName: "Nasdaq Futures" },
  { ticker: "^RUT",     name: "Russell 2000", nameB: "Russell",nameN: "2000", ftTicker: "RTY=F", ftName: "R2K Futures"    },
  { ticker: "^VIX",     name: "VIX"          },
  { ticker: "BZ=F",     name: "Brent Oil"    },
  { ticker: "^TNX",     name: "US 10Y Yield", nameB: "US 10Y", nameN: "Yield", hideMobile: true },
  { ticker: "GBPUSD=X", name: "GBP/USD"      },
  { ticker: "GBPCNH=X", name: "GBP/CNY",      hideMobile: true },
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

function MarketConditions({ marketData, extendedHours, phase }) {
  const useExt = extendedHours && phase !== "regular";
  return (
    <aside className="market-conditions">
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
              <span className="mono dim" style={{ fontSize: '10px' }}>{activeTicker}</span>
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
