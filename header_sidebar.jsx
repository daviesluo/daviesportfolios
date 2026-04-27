// Header + Sidebar components
const { fmtMoney: fmM, fmtPct: fmP, fmtPrice: fmtPr, pctColor: pcC, londonTimeParts, usMarketPhase, formatAgo } = window.Utils;

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

function Header({ metrics, source, lastUpdated, isRefreshing, onRefresh, editMode, setEditMode, isReadOnly, extendedHours, onToggleExtended, histDate, viewMode, onToggleView }) {
  const now = useClock(1000);
  const t = londonTimeParts(now);
  const phase = usMarketPhase(now);
  const phaseInfo = PHASE[phase] || PHASE.overnight;
  const dayClr = pcC(metrics.dayPct);

  const agoMs = lastUpdated ? (now - lastUpdated) : null;
  const agoText = lastUpdated ? formatAgo(agoMs) : "—";

  // Scoreboard flash: detect value changes on price refresh
  const prevMetrics = React.useRef(null);
  const [sbFlash, setSbFlash] = React.useState({});
  React.useEffect(() => {
    if (!prevMetrics.current) { prevMetrics.current = metrics; return; }
    const prev = prevMetrics.current;
    const eps = 0.01;
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
            style={{ "--ext-on-color": phaseInfo.color }}
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
            style={{ "--ext-on-color": phaseInfo.color }}
            title={extendedHours ? "Showing extended-hours prices — click to switch off" : "Click to show pre-market / after-hours prices"}
          >
            <span className="ext-switch-label mono">EXTENDED HOURS</span>
            <input type="checkbox" className="ext-checkbox" checked={extendedHours} onChange={onToggleExtended} />
            <span className="ext-track"><span className="ext-thumb" /></span>
          </label>
        </div>
        <div className="scoreboard-divider scoreboard-divider-time" />
        <div className="scoreboard-cell">
          <div className="sb-label">PORTFOLIO</div>
          <div className={`sb-value sb-value-lg mono${sbFlash.mv ? " sb-flash-" + sbFlash.mv : ""}`}>{fmM(metrics.marketValue)}</div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">DAY CHANGE</div>
          <div className={`sb-value mono sb-change-row${sbFlash.day ? " sb-flash-" + sbFlash.day : ""}`} style={{ color: pcC(metrics.dayPct) }}>
            <span>{fmM(metrics.dayChange, { signed: true })}</span>
            <span className="sb-pct">({fmP(metrics.dayPct)})</span>
          </div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">UNREALIZED G/L</div>
          <div className={`sb-value mono sb-change-row${sbFlash.unrl ? " sb-flash-" + sbFlash.unrl : ""}`} style={{ color: pcC(metrics.unrlPct) }}>
            <span>{fmM(metrics.unrlGL, { signed: true })}</span>
            <span className="sb-pct">({fmP(metrics.unrlPct)})</span>
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

// YTD performance chart: portfolio % return vs S&P 500, normalised from a common start.
// We cache historical closes per-ticker in localStorage so partial fetch failures
// don't break the chart — when today's fetch misses a ticker, we keep using the
// most recent cached series for that ticker (Jan-1 close never changes anyway).
// Each entry is timestamped; we refetch any entry older than the TTL.
const YTD_CACHE_KEY = 'ytd-perf-cache-v12';
const YTD_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function loadYtdCache(year) {
  try {
    const raw = localStorage.getItem(YTD_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed.year !== year || !parsed.entries) return {};
    return parsed.entries; // { ticker: { ts, data: [{date,close}, …] } }
  } catch (_) { return {}; }
}
function saveYtdCache(year, entries) {
  try {
    localStorage.setItem(YTD_CACHE_KEY, JSON.stringify({ year, entries }));
  } catch (_) {}
}

// YTD performance chart: portfolio % return vs S&P 500, computed from per-lot
// purchase history + historical closes (Yahoo Finance), normalised from the
// first trading day of the calendar year.
function PerfChart({ portfolio, marketData, extendedHours, phase }) {
  const [hist,    setHist]    = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error,   setError]   = React.useState(false);

  // Tickers we need historical data for. We send all non-cash holdings to the
  // chart Edge Function — it routes 6-digit CN fund codes to eastmoney's
  // pingzhongdata endpoint and everything else (including .PVT) to Yahoo. A
  // ticker that's unsupported on either backend just returns null and falls
  // back to linear interpolation between cost and lastPrice.
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

    // Read per-ticker cache; populate hist immediately with whatever's still fresh.
    const entries = loadYtdCache(year);
    const fresh = {};
    const stale = [];
    for (const s of symbols) {
      const e = entries[s];
      if (e && e.data && Array.isArray(e.data) && (Date.now() - (e.ts || 0)) < YTD_CACHE_TTL_MS) {
        fresh[s] = e.data;
      } else {
        stale.push(s);
      }
    }

    // Show whatever's already in cache while we refresh stale entries in the background.
    if (Object.keys(fresh).length > 0 && fresh['^GSPC']) {
      setHist({ ...fresh });
      setLoading(false);
    } else {
      setLoading(true);
    }

    if (stale.length === 0) return;

    // Fetch range=1y so we have data from the last trading day of the previous
    // year — that close is the YTD baseline (matches Yahoo Finance's anchor).
    (async () => {
      const batch = await window.Utils.fetchHistoricalBatch(stale, '1y', '1d');
      if (cancelled) return;
      // ^GSPC anchors the X axis. If the batch missed it (Edge Function down,
      // CORS proxies rate-limited, etc.) try a few more direct fetches before
      // giving up — better to wait an extra second than show "Couldn't load".
      if (!batch['^GSPC']) {
        for (let i = 0; i < 3 && !batch['^GSPC']; i++) {
          await new Promise(r => setTimeout(r, 800 * (i + 1)));
          if (cancelled) return;
          const retry = await window.Utils.fetchHistorical('^GSPC', '1y', '1d').catch(() => null);
          if (retry) batch['^GSPC'] = retry;
        }
      }
      // Merge new fetches into both the live state and persistent cache. Tickers
      // that failed today fall back to whatever the previous cached entry was.
      const merged = { ...fresh };
      const newEntries = { ...entries };
      const now = Date.now();
      for (const s of stale) {
        if (batch[s]) {
          merged[s] = batch[s];
          newEntries[s] = { ts: now, data: batch[s] };
        } else if (entries[s] && entries[s].data) {
          merged[s] = entries[s].data; // keep prior cached series rather than dropping the ticker
        }
      }
      saveYtdCache(year, newEntries);
      // We need SOMETHING to anchor the X axis. Prefer ^GSPC; otherwise pick
      // the longest portfolio-ticker series so the chart still renders even if
      // the S&P 500 line is missing today.
      const hasAnchor = merged['^GSPC'] || Object.values(merged).some(s => Array.isArray(s) && s.length >= 2);
      if (!hasAnchor) {
        setError(true);
        setLoading(false);
        return;
      }
      setHist(merged);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tickerKey]);

  if (!portfolio) return <div className="sparkline-empty dim mono">Loading…</div>;
  if (loading)    return <div className="sparkline-empty dim mono">Computing YTD…</div>;
  if (error)      return <div className="sparkline-empty dim mono">Couldn't load history</div>;

  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;

  // S&P 500 trading dates within YTD anchor the chart's x-axis. We fetch
  // range=1y so we also have data from BEFORE yearStart — the close from the
  // last trading day of the previous year is what Yahoo uses as the YTD
  // baseline (so stocks that gap up on Jan 2 already show a positive YTD).
  // If ^GSPC is unavailable we fall back to the longest portfolio-ticker
  // series so the chart still renders (without an S&P 500 line).
  const allSp = (hist['^GSPC'] || [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  let spYtd = allSp.filter(p => p.date >= yearStart);
  let hasSp = spYtd.length >= 2;
  if (!hasSp) {
    let bestKey = null, bestLen = 0;
    for (const [k, s] of Object.entries(hist || {})) {
      if (k === '^GSPC' || !Array.isArray(s)) continue;
      const ytdSlice = s.filter(p => p.date >= yearStart);
      if (ytdSlice.length > bestLen) { bestLen = ytdSlice.length; bestKey = k; }
    }
    if (!bestKey || bestLen < 2) return <div className="sparkline-empty dim mono">No YTD data yet</div>;
    spYtd = (hist[bestKey] || [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter(p => p.date >= yearStart);
  }
  const yearStartDate = spYtd[0].date;
  const todayMs = Date.now();

  // S&P 500 baseline = last close strictly before yearStart (Dec 31 of prior year).
  // Falls back to first YTD close if no prior-year data is available.
  // Only meaningful when hasSp; otherwise we'll skip drawing the S&P 500 line.
  const spPriorYear = hasSp ? allSp.filter(p => p.date < yearStart) : [];
  const spBase = spPriorYear.length > 0 ? spPriorYear[spPriorYear.length - 1].close : spYtd[0].close;

  // Per-ticker sorted series + map + Jan-1 baseline price.
  // Baseline = close on the last trading day BEFORE yearStart (matches Yahoo).
  const tickerSeries = {};
  for (const t of tickers) {
    const series = (hist[t] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const map = {};
    for (const p of series) map[p.date] = p.close;
    const priorYear = series.filter(p => p.date < yearStart);
    let janPrice = null;
    if (priorYear.length > 0) {
      janPrice = priorYear[priorYear.length - 1].close;
    } else {
      const ytdSeries = series.filter(p => p.date >= yearStartDate);
      janPrice = ytdSeries.length > 0 ? ytdSeries[0].close : null;
    }
    tickerSeries[t] = { series, map, janPrice };
  }

  // Get close for ticker on a date — exact match, or last known close ≤ date.
  const closeOn = (ticker, date) => {
    const tm = tickerSeries[ticker];
    if (!tm) return null;
    if (tm.map[date] != null) return tm.map[date];
    let lo = 0, hi = tm.series.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tm.series[mid].date <= date) { best = tm.series[mid].close; lo = mid + 1; }
      else hi = mid - 1;
    }
    return best;
  };

  // Resolve which lots to use for a holding. Prefer h.lots (manual edits + persisted
  // state) when its share total matches; else fall back to seed; else single lot
  // dated yearStart. This keeps the chart correct even if migration hasn't run.
  const lotsFor = (ticker, h) => {
    const sumShares = (lots) => lots.reduce((s, l) => s + (l.shares || 0), 0);
    if (Array.isArray(h.lots) && h.lots.length > 0
        && Math.abs(sumShares(h.lots) - h.shares) < 0.0001) {
      return h.lots;
    }
    const seed = window.INITIAL_LOTS && window.INITIAL_LOTS[ticker];
    if (Array.isArray(seed) && Math.abs(sumShares(seed) - h.shares) < 0.0001) {
      return seed;
    }
    return [{ date: yearStart, shares: h.shares, cost: h.lastPrice || 0 }];
  };

  // Yahoo's YTD formula:
  //   - Pre-year lot:  basis = shares × Jan-1 market price; value(d) = shares × close(d)
  //   - Year lot:      basis = shares × cost;               value(d) = shares × close(d)
  //   - YTD%(d) = (Σ value − Σ basis) / Σ basis × 100
  // For the LAST chart point we substitute live marketData prices for value(d)
  // so the displayed YTD% matches what the rest of the app shows in real time
  // and updates when the user clicks refresh. When extended-hours mode is on
  // outside regular hours we use extPrice (futures-like or pre/post-market)
  // instead of lastPrice — same convention the header total uses.
  const useExt = !!(extendedHours && phase && phase !== "regular");
  const liveAnchorDate = spYtd[spYtd.length - 1].date;
  const computeAt = (date) => {
    const useLive = date === liveAnchorDate;
    let value = 0, basis = 0;
    for (const [ticker, h] of Object.entries(portfolio.holdings)) {
      if (h.isCash || ticker === 'CASH') continue;
      const lots = lotsFor(ticker, h);
      const fx = (h.currency && h.currency !== 'USD')
        ? window.Utils.fxToUSD(h.currency, marketData)
        : 1;
      const ts = tickerSeries[ticker];
      const janPrice = ts ? ts.janPrice : null;
      const lastPrice = h.lastPrice;
      const md = marketData?.[ticker];
      const livePrice = useLive
        ? ((useExt && md?.extPrice != null && md.extPrice > 0) ? md.extPrice
           : (md?.lastPrice ?? lastPrice))
        : null;

      for (const lot of lots) {
        if (lot.date > date) continue; // not yet held

        // Basis price for this lot
        let basisPrice;
        if (lot.date < yearStartDate) {
          // Pre-year lot needs Jan-1 market price. If we don't have one, skip
          // this lot entirely — including it with a guessed basis would either
          // over-attribute (cost) or zero out (lastPrice) the contribution and
          // distort the percentage. Better to compute YTD% over the holdings
          // we do have data for than to include misleading numbers.
          if (janPrice == null) continue;
          basisPrice = janPrice;
        } else {
          // Year lot: basis = cost (always known)
          basisPrice = lot.cost;
        }

        // Current price at date — prefer live for the latest chart point so the
        // endpoint matches the rest of the app (and Yahoo) in real time.
        let priceAtD = (useLive && livePrice != null && livePrice > 0)
          ? livePrice
          : (ts ? closeOn(ticker, date) : null);
        if (priceAtD == null) {
          // No historical data (e.g. SPAX.PVT, 017731): linearly interpolate
          // from cost on lot.date to current lastPrice on today, so the chart
          // ends at the truthful current value without an ugly endpoint step.
          const lotMs = new Date(lot.date).getTime();
          const dMs = new Date(date).getTime();
          const tgtPrice = (lastPrice != null && lastPrice > 0) ? lastPrice : lot.cost;
          if (todayMs <= lotMs || dMs >= todayMs) priceAtD = tgtPrice;
          else if (dMs <= lotMs) priceAtD = lot.cost;
          else {
            const t = (dMs - lotMs) / (todayMs - lotMs);
            priceAtD = lot.cost + (tgtPrice - lot.cost) * t;
          }
        }

        value += lot.shares * priceAtD * fx;
        basis += lot.shares * basisPrice * fx;
      }
    }
    return { value, basis };
  };

  const portYtd = spYtd.map(p => {
    const { value, basis } = computeAt(p.date);
    const pct = basis > 0 ? ((value - basis) / basis) * 100 : 0;
    return { date: p.date, pct };
  });
  if (portYtd.length < 2) return <div className="sparkline-empty dim mono">Insufficient data</div>;

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
    </div>
  );
}

// Standalone YTD panel — same panel chrome as TOP MOVERS / FORMATION VALUE,
// rendered separately so we can place it in the desktop left column instead
// of the sidebar. The Sidebar still renders its own copy on tablet/mobile.
function PerfPanel({ portfolio, marketData, extendedHours, phase, className }) {
  return (
    <section className={`panel ${className || ""}`.trim()}>
      <h3 className="panel-title">YTD PERFORMANCE</h3>
      <PerfChart
        portfolio={portfolio}
        marketData={marketData}
        extendedHours={extendedHours}
        phase={phase}
      />
    </section>
  );
}

function Sidebar({ metrics, source, portfolio, marketData, extendedHours, phase }) {
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
                  <span className="fr-val mono">{fmM(p.marketValue)}</span>
                </div>
                <div className="fr-bar">
                  <div className="fr-bar-fill" style={{ width: pct + "%" }} />
                </div>
                <div className="fr-meta">
                  <span className="mono dim">{pct.toFixed(1)}%</span>
                  <span className="mono" style={{ color: pcC(p.unrlPct) }}>{fmM(p.unrlGL, { signed: true })} ({fmP(p.unrlPct)})</span>
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

Object.assign(window, { Header, Sidebar, SidebarFoot, StatRow, MarketConditions, PerfPanel });
