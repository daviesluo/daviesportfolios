// Header + Sidebar + Market-Conditions components. The Performance vs
// S&P 500 chart used to live here too — it's been extracted into
// `src/perf_chart.jsx`. We re-export PerfPanel from this file so
// existing imports in app.jsx (`import { ... PerfPanel } from
// './header_sidebar.jsx'`) keep working.
import React from 'react';
import {
  fmtMoney as fmM,
  fmtPct as fmP,
  fmtPrice as fmtPr,
  pctColor as pcC,
  formatAgo,
  maskDigits as mask,
  displayTicker,
  pctIsFlat,
} from './formatters.js';
import { londonTimeParts, usMarketPhase, ukTzAbbr } from './market_hours.js';
import { isCnFund } from './ticker_class.js';
import { Storage } from './storage.js';
import { fetchFundamentals } from './yahoo_fetch.js';
import { isIndex } from './ticker_class.js';
import { PerfPanel } from './perf_chart.jsx';
import { MOVER_WINDOWS, rangeKeyForWindow, rankMovers, barWidthPct, holdingMoveOver } from './movers.js';
import { loadRangeCache, CHARTS_UPDATED_EVENT } from './cache.js';
import { buildTickerSeries, anchorDateFor } from './ytd.js';
import { OpsErrorBadge, useIsDesktop } from './ops_error_badge.jsx';

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
// (No icon component for the currency cycle — it renders the 💱
// emoji as plain text content so OS-native font sizing handles it.
// Grayscale + opacity filter in CSS keeps it on-tone with the eye.)
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

// Time chip + extended-hours toggle. Owns its own 1 Hz clock so the
// parent Header doesn't re-render every second — only this leaf and
// the sibling HeaderStatusPill (which tracks "ago" the same way) do.
// Rendered both inside `.brand-time` (mobile) and `.scoreboard-cell-time`
// (desktop) — `phaseInfo` and `tzLabel` derive from the same `now`.
function HeaderTime({ extendedHours, onToggleExtended }) {
  const now = useClock(1000);
  const t = londonTimeParts(now);
  const phase = usMarketPhase(now);
  const phaseInfo = PHASE[phase] || PHASE.overnight;
  const tzLabel = `${ukTzAbbr(now)} TIME`;
  return (
    <>
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
    </>
  );
}

// Live/STALE/Refreshing status pill in the header-actions row. The
// "ago" text + STALE-after-5-min flip depend on the clock so this
// leaf owns its own useClock. Status label / title-attribute logic
// is identical to the old inline version; moved here so the parent
// Header doesn't pay the per-second re-render cost.
function HeaderStatusPill({ lastUpdated, source, isRefreshing }) {
  const now = useClock(1000);
  const agoMs = lastUpdated ? (now.getTime() - lastUpdated.getTime()) : null;
  const agoText = lastUpdated ? formatAgo(agoMs) : "—";
  // Stale-price detection — when the last successful fetch was more
  // than this many minutes ago, the live-pill flips to "STALE Nm"
  // even when `source === "live"`. Auto-refresh runs every 30 s, so
  // > 5 min without an update means several consecutive ticks failed
  // and the user should know the displayed numbers are out of date.
  const STALE_PRICE_MS = 5 * 60 * 1000;
  const stalePrices = agoMs != null && agoMs > STALE_PRICE_MS;
  const statusLabel =
    isRefreshing       ? "REFRESHING…"
    : source === "error" ? "RETRYING…"
    : stalePrices       ? `STALE ${formatAgo(agoMs)}`
    : source === "live"  ? "LIVE"
    : "…";
  return (
    <div className={`live-pill ${isRefreshing ? "refreshing" : ""} ${(source === "error" || stalePrices) ? "err" : ""}`}
         title={
           source === "error" ? "Retrying price fetch…" :
           stalePrices ? `No successful price update in ${formatAgo(agoMs)}; auto-retry running` :
           source === "live" ? "Yahoo Finance" : "Connecting"
         }>
      <span className={`live-dot ${isRefreshing ? "pulse" : ""} ${(source === "error" || stalePrices) ? "err" : ""}`} />
      <div className="live-col">
        <span className="live-txt">{statusLabel}</span>
        <span className="live-ago mono">Last updated {agoText}</span>
      </div>
    </div>
  );
}

// Hidden-values mask: imported from formatters.js as `maskDigits`,
// aliased to `mask` here so the original short name keeps reading
// naturally inside the JSX.

// Currency cycle for the mobile scoreboard. Order is USD → GBP → CNY,
// wrapping back to USD. The user requested ephemeral state — every
// fresh page load starts on USD — so this lives in component state
// (not `Storage`) and survives only within the current React mount.
const CCY_CYCLE = /** @type {const} */ (['USD', 'GBP', 'CNY']);
/** @type {Record<'USD'|'GBP'|'CNY', string>} */
const CCY_SYMBOL = { USD: '$', GBP: '£', CNY: '¥' };

/**
 * Resolve the multiplier that converts a USD figure (the canonical
 * portfolio currency that `metrics.marketValue` / `dayChange` /
 * `unrlGL` are computed in) into the target cycle currency.
 *
 * Sourced from the same `marketData` map the Market Conditions cards
 * read, so the scoreboard never disagrees with the FX cards visible
 * lower in the page. Falls back to 1 (USD identity) on any missing
 * pair — the cycle button keeps cycling but the displayed digits
 * stay USD-numerically until the next FX refresh lands. The
 * SYMBOL still follows the cycle so the user has a clear visual
 * cue that the rate didn't land yet.
 *
 * @param {'USD'|'GBP'|'CNY'} ccy
 * @param {Record<string, {lastPrice?: number}>} marketData
 */
function usdToCcyRate(ccy, marketData) {
  if (ccy === 'USD') return 1;
  if (ccy === 'GBP') {
    // GBPUSD=X = "how many USD per 1 GBP" → invert for USD→GBP.
    const gbpusd = marketData?.['GBPUSD=X']?.lastPrice;
    return (typeof gbpusd === 'number' && gbpusd > 0) ? 1 / gbpusd : 1;
  }
  if (ccy === 'CNY') {
    // USDCNY=X = "how many CNY per 1 USD" → direct multiplier.
    const usdcny = marketData?.['USDCNY=X']?.lastPrice;
    return (typeof usdcny === 'number' && usdcny > 0) ? usdcny : 1;
  }
  return 1;
}

function Header({ metrics, marketData, marketDataReady, source, lastUpdated, isRefreshing, onRefresh, editMode, setEditMode, isReadOnly, extendedHours, onToggleExtended, viewMode, onToggleView, hideValues, onToggleHideValues, onOpenHoldingsList, onOpenSectorsList, onOpenTransactionHistory, onOpenAgents }) {
  // Currency cycle for the scoreboard's PORTFOLIO number. Ephemeral
  // by design — every cold load starts on USD per the user's spec.
  // The button itself renders on every breakpoint; the
  // `.scoreboard-cell-portfolio` CSS grid relocates it across
  // breakpoints — mobile slots it row 2 col 2 (under the eye, right
  // of the $value), desktop slots it row 1 col 3 (right of the eye
  // in the label row).
  const [ccy, setCcy] = React.useState(/** @type {'USD'|'GBP'|'CNY'} */ ('USD'));
  // Mobile-only precision drop on DAY CHANGE's dollar amount. Sub-
  // \$1000 swings would otherwise read as "+\$50.30" on the narrow
  // viewport — the user prefers the integer rounding ("+\$50") to
  // free up horizontal real estate. The percentage stays at the
  // 2-decimal default ("+0.37 %"); the user wants its precision
  // preserved for nuance even on mobile.
  const isDesktop = useIsDesktop();
  const dayPrec = isDesktop ? 2 : 0;
  const cycleCcy = React.useCallback(() => {
    setCcy((cur) => CCY_CYCLE[(CCY_CYCLE.indexOf(cur) + 1) % CCY_CYCLE.length]);
  }, []);
  const ccyRate   = usdToCcyRate(ccy, marketData);
  const ccySym    = CCY_SYMBOL[ccy];
  /** Wraps the existing fmM() with the cycle's rate + symbol so the
   *  3 scoreboard numbers stay in lockstep without sprinkling the
   *  conversion at every call site. */
  const fmCcy = React.useCallback(
    /** @param {number | null | undefined} n @param {{signed?: boolean, precision?: number}} [opts] */
    (n, opts) => fmM(typeof n === 'number' ? n * ccyRate : n, {
      ...opts, symbol: ccySym,
      // `compact: false` — the scoreboard expands M/B/T to full
      // digits so e.g. a $159 K portfolio doesn't read as "¥1.08M"
      // after the CNY cycle, but as the actual ¥1,079,451. Tier
      // collapse applies app-wide everywhere else (sidebar /
      // cards / modal) where the smaller font would otherwise
      // overflow.
      compact: false,
    }),
    [ccyRate, ccySym],
  );

  // Mobile scoreboard gap auto-tunes to the DAY CHANGE amount's digit
  // count (the cell whose width swings most — and the ext-hours toggle
  // changes the day-change basis, so the digit count can flip when it's
  // toggled). Uses the DISPLAYED magnitude (currency-converted), since
  // a CNY cycle makes the number ~7× bigger. Buckets → CSS picks the
  // gap via `[data-daygap]` inside the mobile media query (desktop is
  // unaffected). <100 → 15px, 100-999 → 12px, ≥1000 → 10px.
  const dayChangeShown = Math.abs((metrics.dayChange || 0) * ccyRate);
  const dayDigits = dayChangeShown >= 1 ? Math.floor(Math.log10(dayChangeShown)) + 1 : 1;
  const dayGapBucket = dayDigits >= 4 ? 'lg' : dayDigits === 3 ? 'md' : 'sm';

  // Scoreboard flash: detect value changes on price refresh
  /** @type {React.MutableRefObject<import('./types').PortfolioMetrics | null>} */
  const prevMetrics = React.useRef(null);
  /** @type {[Record<string, 'up' | 'down'>, (f: Record<string, 'up' | 'down'>) => void]} */
  const [sbFlash, setSbFlash] = React.useState({});
  /** @type {React.MutableRefObject<ReturnType<typeof setTimeout> | null>} */
  const sbFlashTimerRef = React.useRef(null);
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
      if (sbFlashTimerRef.current) clearTimeout(sbFlashTimerRef.current);
      sbFlashTimerRef.current = setTimeout(() => setSbFlash({}), 1400);
    }
  }, [metrics]);
  // Clear a pending scoreboard-flash reset if Header unmounts mid-window.
  React.useEffect(() => () => {
    if (sbFlashTimerRef.current) clearTimeout(sbFlashTimerRef.current);
  }, []);

  // FX badge — surface any holding whose native-USD conversion fell
  // back to 1:1 this tick (the FX pair for its currency was missing
  // from marketData). Without this badge a GBP holding silently
  // values at 1:1 USD and the portfolio undercounts by ~20%.
  /** @type {string[]} */
  const fxMissing = (metrics && /** @type {any} */ (metrics).fxMissingTickers) || [];

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
          <HeaderTime extendedHours={extendedHours} onToggleExtended={onToggleExtended} />
        </div>
      </div>

      <div className="scoreboard" data-daygap={dayGapBucket}>
        <div className="scoreboard-cell scoreboard-cell-time">
          <HeaderTime extendedHours={extendedHours} onToggleExtended={onToggleExtended} />
        </div>
        <div className="scoreboard-divider scoreboard-divider-time" />
        {/* PORTFOLIO cell uses a 2-column × 2-row CSS grid so the eye
            (row 1 col 2) and the currency-cycle (row 2 col 2) line
            up at the same right edge regardless of how wide the
            "$xxx,xxx" value renders. Flex couldn't pin them to a
            shared column because the cell's intrinsic width was
            set by content and `justify-content: space-between`
            had no extra space to distribute. */}
        <div className="scoreboard-cell scoreboard-cell-portfolio">
          <span className="sb-label">PORTFOLIO</span>
          <button
            type="button"
            className="hide-eye"
            onClick={onToggleHideValues}
            aria-label={hideValues ? "Show values" : "Hide values"}
            title={hideValues ? "Click to show values" : "Click to hide values"}
          >
            {hideValues ? <EyeClosedIcon /> : <EyeOpenIcon />}
          </button>
          <div className={`sb-value sb-value-lg mono${sbFlash.mv ? " sb-flash-" + sbFlash.mv : ""}`}>{hideValues ? mask(fmCcy(metrics.marketValue)) : fmCcy(metrics.marketValue)}</div>
          <button
            type="button"
            className="ccy-cycle"
            onClick={cycleCcy}
            aria-label={`Currency: ${ccy} (click to cycle USD / GBP / CNY)`}
            title={`Currency: ${ccy} — click to cycle USD / GBP / CNY`}
          >💱</button>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">DAY CHANGE</div>
          <div className={`sb-value mono sb-change-row${sbFlash.day ? " sb-flash-" + sbFlash.day : ""}`} style={{ color: pcC(metrics.dayPct) }}>
            <span>{hideValues ? mask(fmCcy(metrics.dayChange, { signed: true, precision: dayPrec })) : fmCcy(metrics.dayChange, { signed: true, precision: dayPrec })}</span>
            <span className="sb-pct">({fmP(metrics.dayPct)})</span>
          </div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">UNREALIZED G/L</div>
          <div className={`sb-value mono sb-change-row${sbFlash.unrl ? " sb-flash-" + sbFlash.unrl : ""}`} style={{ color: pcC(metrics.unrlPct) }}>
            <span>{hideValues ? mask(fmCcy(metrics.unrlGL, { signed: true })) : fmCcy(metrics.unrlGL, { signed: true })}</span>
            <span className="sb-pct">({fmP(metrics.unrlPct)})</span>
          </div>
        </div>
      </div>

      <div className="header-actions">
        <HeaderStatusPill lastUpdated={lastUpdated} source={source} isRefreshing={isRefreshing} />
        {marketDataReady && fxMissing.length > 0 && (
          <div
            className="live-pill err"
            title={`Live FX rate missing for ${fxMissing.join(", ")} — these holdings are valued at 1:1 USD until the FX pair refreshes. Click Refresh.`}
          >
            <span className="live-dot err" />
            <div className="live-col">
              <span className="live-txt">FX MISSING</span>
              <span className="live-ago mono">{fxMissing.length} {fxMissing.length === 1 ? "ticker" : "tickers"}</span>
            </div>
          </div>
        )}
        <OpsErrorBadge isReadOnly={isReadOnly} />
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
        <HeaderMenu onOpenHoldingsList={onOpenHoldingsList} onOpenSectorsList={onOpenSectorsList} onOpenTransactionHistory={onOpenTransactionHistory} onOpenAgents={onOpenAgents} />
      </div>
    </header>
  );
}

// ☰ overflow menu to the right of EDIT. Click to toggle a dropdown;
// click-away / Escape closes it. Items: "Holding list", "Sectors list" +
// "Transaction history", then "Agents" (the crypto strategies page).
// Available in both view + edit mode, read-only included (every page
// behind the menu is view-only).
function HeaderMenu({ onOpenHoldingsList, onOpenSectorsList, onOpenTransactionHistory, onOpenAgents }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="header-menu" ref={ref}>
      <button
        className={`btn-ghost icon header-menu-btn${open ? ' on' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-label="Menu" aria-haspopup="menu" aria-expanded={open}
        title="Menu"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" />
        </svg>
      </button>
      {open && (
        <div className="header-menu-dropdown" role="menu">
          <button
            className="header-menu-item"
            role="menuitem"
            onClick={() => { setOpen(false); onOpenHoldingsList && onOpenHoldingsList(); }}
          >Holding list</button>
          <button
            className="header-menu-item"
            role="menuitem"
            onClick={() => { setOpen(false); onOpenSectorsList && onOpenSectorsList(); }}
          >Sectors list</button>
          <button
            className="header-menu-item"
            role="menuitem"
            onClick={() => { setOpen(false); onOpenTransactionHistory && onOpenTransactionHistory(); }}
          >Transaction history</button>
          <button
            className="header-menu-item"
            role="menuitem"
            onClick={() => { setOpen(false); onOpenAgents && onOpenAgents(); }}
          >Agents</button>
        </div>
      )}
    </div>
  );
}


/**
 * TOP MOVERS — one set of names, ranked two ways, over a window you pick.
 *
 * `%` answers "what moved"; `$` answers "what moved the BOOK". They are
 * different questions about the same window, and the answers genuinely
 * differ: a 7.9 % pop on a small position tops the percentage list and
 * sits nowhere near the top of the dollar one, while a 1 % drift on the
 * largest holding is the real drag. Showing only percentages hid that
 * half.
 *
 * TODAY reads the SAME fields metrics.js already computes for every
 * player — `dayPct` and `dayChange` (mv − prevMV in USD, measured from
 * the same baseline the heat map and the tactics chip use) — so the two
 * lists cannot drift from each other or from the tile for the same
 * ticker. The longer windows are priced from the per-range history the
 * performance panel already prefetches, anchored at the window's first
 * bar by `buildTickerSeries(..., anchorAtWindowStart = true)`: the same
 * function, the same anchor rule and the same cached rows the chart
 * draws, so "NVDA over 1M" means one thing in this sidebar.
 *
 * The window row sits at the FOOT of the panel, where the performance
 * panel's range row sits, rather than above the lists: one more control
 * strip stacked over the content would push the names — the thing the
 * panel is for — below the fold on a phone.
 *
 * @param {{
 *   metrics: any,
 *   hideValues?: boolean,
 * }} props
 */
function TopMovers({ metrics, hideValues = false }) {
  // Both controls persist in the same `dp.prefs` bag as hideValues: the
  // choice of question, and of window, is a preference rather than a
  // per-visit mode, and re-picking it on every reload is exactly the
  // kind of friction that makes a control go unused. `loadPrefs`
  // defaults a missing key, so no schema bump is needed to add one.
  const [metric, setMetric] = React.useState(
    () => /** @type {'pct'|'usd'} */ (
      Storage.loadPrefs().moversMetric === 'usd' ? 'usd' : 'pct'));
  const [window_, setWindow] = React.useState(() => {
    const saved = Storage.loadPrefs().moversWindow;
    return MOVER_WINDOWS.includes(saved) ? saved : 'TODAY';
  });
  const pickMetric = React.useCallback((/** @type {'pct'|'usd'} */ next) => {
    setMetric(next);
    Storage.savePrefs({ ...Storage.loadPrefs(), moversMetric: next });
  }, []);
  const pickWindow = React.useCallback((/** @type {string} */ next) => {
    setWindow(next);
    Storage.savePrefs({ ...Storage.loadPrefs(), moversWindow: next });
  }, []);

  // The cached history this panel reads has no fetch of its own — the
  // background prefetch fills it. Without this the first switch to 1M
  // on a cold start would show an empty window until the next 30-second
  // refresh happened to re-render the sidebar.
  const [cacheTick, setCacheTick] = React.useState(0);
  React.useEffect(() => {
    const onUpdate = () => setCacheTick(t => t + 1);
    window.addEventListener(CHARTS_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(CHARTS_UPDATED_EVENT, onUpdate);
  }, []);

  // How a longer window measures one holding, or null on TODAY (which
  // keeps metrics.js's own day figures). Memoised on the window and the
  // cache tick — NOT on `metrics`, which changes every refresh and
  // would otherwise rebuild every ticker's series four times a minute
  // for an answer that only moves when a new bar lands.
  const moveOf = React.useMemo(() => {
    const rangeKey = rangeKeyForWindow(window_);
    if (!rangeKey) return null;
    const entries = loadRangeCache(new Date().getFullYear(), `${rangeKey}:std`);
    /** @type {Record<string, any[]>} */
    const hist = {};
    for (const [ticker, entry] of Object.entries(entries)) {
      if (Array.isArray(entry?.data) && entry.data.length > 0) hist[ticker] = entry.data;
    }
    const anchorDate = anchorDateFor(rangeKey);
    const tickerSeries = buildTickerSeries(hist, anchorDate, rangeKey, {}, false, true);
    const todayDate = new Date().toISOString().slice(0, 10);
    const ctx = { tickerSeries, anchorDate, todayDate };
    return (/** @type {any} */ player) => holdingMoveOver(player, ctx);
  }, [window_, cacheTick]);

  // Memoised on metrics + the two controls so the per-tick refresh
  // churn (clock, flash) doesn't re-flatten every position's players
  // and re-sort the book on every render.
  const { winners, losers, scale, priced } = React.useMemo(() => {
    const allPlayers = [];
    for (const pos of Object.values(metrics.positions)) {
      for (const p of /** @type {any} */ (pos).players) allPlayers.push(p);
    }
    return rankMovers(allPlayers, { window: window_, metric, moveOf });
  }, [metrics, metric, window_, moveOf]);

  // Arrow keys move between tabs and take focus with them — with
  // `tabIndex={-1}` on every inactive tab (roving tabindex, so Tab
  // treats each group as ONE stop) arrows are the only way to reach
  // them from the keyboard. Matches the performance panel's view
  // switch. One handler for both groups: they are the same control
  // twice, and two copies would let one grow a Home/End the other
  // lacks.
  const tabKeyHandler = (/** @type {readonly string[]} */ values,
                         /** @type {string} */ current,
                         /** @type {(v: any) => void} */ pick,
                         /** @type {(v: string) => string} */ idOf) =>
    (/** @type {React.KeyboardEvent} */ e) => {
      const k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      const i = Math.max(0, values.indexOf(current));
      const next = k === 'Home' ? values[0]
        : k === 'End' ? values[values.length - 1]
        : values[Math.min(values.length - 1, Math.max(0, i + (k === 'ArrowRight' ? 1 : -1)))];
      pick(next);
      const el = document.getElementById(idOf(next));
      if (el) el.focus();
    };
  const onMetricKey = tabKeyHandler(
    ['pct', 'usd'], metric, pickMetric, v => `movers-tab-${v}`);
  const onWindowKey = tabKeyHandler(
    MOVER_WINDOWS, window_, pickWindow, v => `movers-win-${v}`);

  const isUsd = metric === 'usd';
  /** The figure this row leads with, already formatted and masked. */
  const lead = (/** @type {any} */ p) => isUsd
    ? (hideValues
        ? mask(fmM(p.moveUsd, { signed: true, precision: 0 }))
        : fmM(p.moveUsd, { signed: true, precision: 0 }))
    : fmP(p.movePct);
  // The other measure, on hover. It costs no layout and answers the
  // question each list leaves open — "+7.94 % of how much?" one way,
  // "+$462 off what move?" the other.
  const bothOf = (/** @type {any} */ p) => {
    const usd = hideValues
      ? mask(fmM(p.moveUsd, { signed: true, precision: 0 }))
      : fmM(p.moveUsd, { signed: true, precision: 0 });
    return `${displayTicker(p.ticker)} · ${fmP(p.movePct)} · ${usd} · ${window_}`;
  };

  // A window with no priced names at all is not the same as a window
  // where nothing moved, and saying so is the difference between "the
  // market was quiet" and "your cache is still filling".
  const waiting = priced === 0 && rangeKeyForWindow(window_) !== null;

  const column = (/** @type {any[]} */ rows, /** @type {'gain'|'loss'} */ side) => (
    <div>
      <div className={`movers-heading ${side}`}>
        {side === 'gain' ? '↑ WINNERS' : '↓ LOSERS'}
      </div>
      {rows.map(p => (
        <div key={p.ticker} className="mover-row" title={bothOf(p)}>
          {/* Magnitude behind the row, not beside it: the ranking
              becomes visible at a glance and the panel does not grow a
              single pixel taller. */}
          <span
            className={`mover-bar ${side}`}
            style={{ width: barWidthPct(isUsd ? p.moveUsd : p.movePct, scale) + "%" }}
            aria-hidden="true"
          />
          <span className="mover-ticker mono">{displayTicker(p.ticker)}</span>
          <span className="mono mover-val" style={{ color: `var(--${side})` }}>{lead(p)}</span>
        </div>
      ))}
      {rows.length === 0 && (
        <div className="mover-row mono dim">{waiting ? 'loading…' : '—'}</div>
      )}
    </div>
  );

  return (
    <section className="panel">
      <div className="panel-title-row">
        {/* The WINDOW sits against the heading, where the old
            "· TODAY" suffix did, because it finishes the panel's name:
            this is TOP MOVERS, over this window. The MEASURE stays at
            the far right where the performance panel keeps its view
            switch. Grouping both on the right crowded two unrelated
            choices into one clump and left the heading looking
            unfinished. */}
        <div className="movers-title">
          <h3 className="panel-title">TOP MOVERS</h3>
          <div className="view-tabs movers-window" role="tablist" aria-label="Top movers window">
            {MOVER_WINDOWS.map((w, i) => (
              <React.Fragment key={w}>
                {i > 0 && <span className="view-tab-sep" aria-hidden="true" />}
                <button
                  type="button" role="tab" id={`movers-win-${w}`}
                  aria-selected={w === window_} tabIndex={w === window_ ? 0 : -1}
                  aria-label={`Rank movers over ${w === 'TODAY' ? 'today' : w}`}
                  className={`view-tab mono${w === window_ ? ' is-on' : ''}`}
                  onClick={() => pickWindow(w)}
                  onKeyDown={onWindowKey}
                >{w}</button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="view-tabs movers-metric" role="tablist" aria-label="Top movers ranking">
          <button
            type="button" role="tab" id="movers-tab-pct"
            aria-selected={!isUsd} tabIndex={isUsd ? -1 : 0}
            aria-label="Rank by percent move"
            className={`view-tab mono${isUsd ? '' : ' is-on'}`}
            onClick={() => pickMetric('pct')}
            onKeyDown={onMetricKey}
          >%</button>
          <span className="view-tab-sep" aria-hidden="true" />
          <button
            type="button" role="tab" id="movers-tab-usd"
            aria-selected={isUsd} tabIndex={isUsd ? 0 : -1}
            aria-label="Rank by value change"
            className={`view-tab mono${isUsd ? ' is-on' : ''}`}
            onClick={() => pickMetric('usd')}
            onKeyDown={onMetricKey}
          >$</button>
        </div>
      </div>
      <div className="movers-grid">
        {column(winners, 'gain')}
        {column(losers, 'loss')}
      </div>
    </section>
  );
}

function Sidebar({ metrics, source, portfolio, marketData, extendedHours, phase, hideValues }) {
  // The by-value position list. Memoised on metrics so the per-tick
  // refresh churn (clock, flash) doesn't re-sort the book on every
  // render. Top movers moved into TopMovers, which owns its own
  // ranking because the metric it ranks by is user state.
  const positionList = React.useMemo(() => (
    Object.entries(metrics.positions)
      .filter(([_, p]) => /** @type {any} */ (p).players.length > 0)
      .sort(([, a], [, b]) => /** @type {any} */ (b).marketValue - /** @type {any} */ (a).marketValue)
  ), [metrics]);

  return (
    <aside className="sidebar">
      <TopMovers metrics={metrics} hideValues={hideValues} />

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
        <div className="foot-kv"><span>Source</span><span className="mono">{sourceLabel(source)}</span></div>
        {/* Same diagnostics as the mobile foot — see SidebarFoot. */}
        <div className="foot-kv"><span>Auto Refresh</span><span className="mono">30s</span></div>
        <div className="foot-kv"><span>Stored</span><span className="mono">Supabase</span></div>
        {/* Shortcuts row is desktop-only — the r/e/x keys don't exist
            on touch and the row was visual noise on phones. */}
        <div className="foot-kv"><span>Shortcuts</span><span className="mono">R (refresh) · E (edit) · X (ext)</span></div>
      </div>
    </aside>
  );
}

// Multi-source label for the Source row. The Source column conflates
// live-price provenance ("Yahoo Finance" / "Simulated") with the
// broader question of "which upstream services feed the dashboard?";
// the user wants the full list since several providers are quietly
// integrated:
//
//   Yahoo Finance — prices, intraday chart bars, quoteSummary
//                   fundamentals, fundamentals-timeseries (TTM EPS /
//                   revenue history). Primary source for almost
//                   everything price-related.
//   Eastmoney     — CN-fund daily NAV (6-digit tickers Yahoo
//                   doesn't cover); both server-side via the chart
//                   Edge Function and as a CORS-proxy fallback
//                   client-side.
//   Finnhub       — secondary stock fundamentals (ps3yAvg /
//                   pe3yAvg series); whole-row fallback when
//                   Yahoo's crumb handshake fails.
//   Alpha Vantage — index P/E for ^GSPC / ^NDX / ^RUT / ^SOX via
//                   their ETF proxies (SPY/QQQ/IWM/SOXX).
//   Trading 212   — read-only mirror of the owner's holdings via
//                   /equity/portfolio.
function sourceLabel(source) {
  if (source === "sim") return "Simulated";
  if (source !== "live") return "—";
  // Compact list (mobile foot has limited width). "AV" = Alpha
  // Vantage, "T212" = Trading 212 — both standard abbreviations.
  return "Yahoo · Eastmoney · Finnhub · AV · T212";
}

function SidebarFoot({ source }) {
  // Source / Auto Refresh / Stored only. `Quotes` (how many holdings got
  // a price this tick) and `Build` (which bundle is running) used to sit
  // here as always-visible diagnostics; the owner reads them as noise on
  // his own dashboard. The build stamp still travels with every ops-error
  // report (`ops_error.js`), so "which bundle produced this" stays
  // answerable from the table rather than from the screen.
  return (
    <div className="sidebar-foot sidebar-foot-mobile">
      <div className="foot-kv"><span>Source</span><span className="mono">{sourceLabel(source)}</span></div>
      <div className="foot-kv"><span>Auto Refresh</span><span className="mono">30s</span></div>
      <div className="foot-kv"><span>Stored</span><span className="mono">Supabase</span></div>
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
  // in the order GSPC / NDX / RUT — VIX / BZ=F / TNX — GBPUSD / GBPCNY /
  // USDCNY. The grid-auto-flow:row CSS on the mobile container means the
  // visible cards fill row-by-row in this array order.
  { ticker: "^GSPC",    name: "S&P 500",      nameB: "S&P",    nameN: "500",  ftTicker: "ES=F",  ftName: "S&P Futures"    },
  { ticker: "^NDX",     name: "NASDAQ 100",   nameB: "NASDAQ", nameN: "100",  ftTicker: "NQ=F",  ftName: "NQ Futures" },
  { ticker: "^RUT",     name: "Russell 2000", nameB: "Russell",nameN: "2000", ftTicker: "RTY=F", ftName: "R2K Futures"    },
  { ticker: "^SOX",     name: "PHLX SOX",     nameB: "PHLX",   nameN: "SOX",  hideMobile: true },
  { ticker: "^VIX",     name: "VIX"          },
  { ticker: "BZ=F",     name: "Brent Oil"    },
  { ticker: "^TNX",     name: "US 10Y Yield", nameB: "US 10Y", nameN: "Yield" },
  { ticker: "GBPUSD=X", name: "GBP/USD"      },
  { ticker: "GBPCNY=X", name: "GBP/CNY"      },
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

const FX_4DP = new Set(["GBPUSD=X", "GBPCNY=X"]);
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

function MarketConditions({ marketData, extendedHours, phase, className = '', onCardClick }) {
  const useExt = extendedHours && phase !== "regular";
  return (
    <aside className={`market-conditions${className ? " " + className : ""}`}>
      {MC_INDICES.map(({ ticker, name, nameB, nameN, ftTicker, ftName, hideMobile }) => {
        const activeTicker = (useExt && ftTicker) ? ftTicker : ticker;
        const activeName   = (useExt && ftName)   ? ftName   : name;
        const d         = marketData[activeTicker];
        // Price displayed: in ext mode prefer extPrice when present —
        // EXCEPT for indices (^VIX / ^TNX / ^SOX …), which don't
        // actually trade after hours. Yahoo still ships a synthetic
        // `extPrice` for them; using it made the ^VIX card read
        // ~18.05 / +4.4% while the drill modal — which validates
        // against the intraday series and falls back to lastPrice for
        // non-AH-trading tickers — read ~17.26 / ~0%. Gating on
        // isIndex keeps the card on lastPrice (today's regular close)
        // for indices, matching the modal. Futures (ES=F, the
        // ext-mode S&P proxy) do trade ~24h, so they keep extPrice.
        const price = d
          ? ((useExt && !isIndex(activeTicker) && d.extPrice != null && d.extPrice > 0) ? d.extPrice : d.lastPrice)
          : null;
        // Anchor for "since the most recent 16:00 ET close that has
        // occurred". In ext mode every MC ticker has todayRegularClose
        // populated by app.jsx (same bar the modal looks up via
        // regularCloseIdx). When that lookup misses (cold weekend, fetch
        // hiccup), fall back to lastPrice — matches the modal's
        // useExt+regularCloseIdx<0 fallback so the card still reports
        // the same number as the modal even on the unhappy path. In
        // regular hours we use prevClose, also matching the modal.
        let anchor = null;
        if (d) {
          if (useExt && typeof d.todayRegularClose === 'number' && d.todayRegularClose > 0) {
            anchor = d.todayRegularClose;
          } else if (useExt && d.lastPrice && d.lastPrice > 0) {
            anchor = d.lastPrice;
          } else {
            anchor = d.prevClose ?? d.lastPrice ?? null;
          }
        }
        const pct       = (price != null && anchor != null && anchor > 0)
                            ? ((price - anchor) / anchor) * 100
                            : (d ? (d.dayPct ?? 0) : null);
        const dayChange = (price != null && anchor != null) ? price - anchor : null;
        // Card click opens whichever ticker the card is currently
        // *displaying* — so in ext mode the S&P card opens the ES=F
        // futures chart and the modal's pct matches what the card
        // showed. (Previously it always opened the canonical ^GSPC so
        // the modal could keep its P/E button, but that meant the
        // modal's pct was for ^GSPC's prevClose while the card's pct
        // was for ES=F's prevClose — different numbers for the same
        // tap. Toggle ext off if you want the index P/E view.)
        const handleClick = onCardClick ? () => onCardClick(activeTicker) : undefined;
        return (
          <section
            key={activeTicker}
            className={`panel mc-card${hideMobile ? " mc-hide-mobile" : ""}${onCardClick ? " mc-card-clickable" : ""}`}
            onClick={handleClick}
            onKeyDown={onCardClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardClick(activeTicker); } } : undefined}
            role={onCardClick ? "button" : undefined}
            tabIndex={onCardClick ? 0 : undefined}
            title={onCardClick ? `Open ${name} chart` : undefined}
          >
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
              <div className="mc-price mono" style={ticker === "^VIX" && price != null ? { color: vixRegime(price)?.color } : {}}>
                {fmtMcPrice(price, ticker)}
              </div>
              {ticker === "^VIX" && price != null && (
                <span className="mc-vix-regime mono" style={{ color: vixRegime(price)?.color }}>{vixRegime(price)?.label}</span>
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

// UPCOMING EARNINGS panel — shows the next 3 future earnings dates
// across the user's holdings. On mount + when the holding list
// changes, fetches /functions/v1/fundamentals which now includes
// `earningsDate` (Unix seconds) and `earningsTime` ("before market
// open" / "after market close" / etc) from Yahoo's calendarEvents
// module. Cached server-side for 2 h per the stock_fundamentals_cache
// so the call is cheap.
//
// Render slot:
//   - Desktop: in the left column under MarketConditions, same width
//     as PerfPanel (PERFORMANCE VS S&P 500).
//   - Mobile: as a sibling after the mobile MarketConditions, same
//     width as TOP MOVERS (the .panel default in the sidebar grid).
// Two render sites in app.jsx, one matchMedia-gated to each.
function UpcomingEarnings({ portfolio, className = '' }) {
  /** @type {[Record<string, any>, Function]} */
  const [byTicker, setByTicker] = React.useState({});
  // Bucket the portfolio tickers into a stable join-string for the
  // deps array, so reordering / mutation doesn't trigger a refetch.
  //
  // BOARD-scoped, not `Object.keys(holdings)`: selling a position out
  // removes it from every position's `tickers` but deliberately KEEPS
  // the holding row so its buy/sell ledger survives (`closed: true`),
  // so keying off holdings kept listing earnings for stocks the user
  // no longer owns. Same scope `computeMetrics` counts tickers by, so
  // this panel and the header's "N tickers" always agree.
  const tickerJoin = React.useMemo(() => {
    if (!portfolio?.positions || !portfolio?.holdings) return '';
    const onBoard = new Set();
    for (const pos of Object.values(portfolio.positions)) {
      for (const t of pos?.tickers || []) {
        const h = portfolio.holdings[t];
        if (!h || h.isCash || t === 'CASH') continue;
        onBoard.add(t);
      }
    }
    return [...onBoard].sort().join(',');
  }, [portfolio]);
  React.useEffect(() => {
    if (!tickerJoin) return undefined;
    const tickers = tickerJoin.split(',').filter(Boolean);
    if (tickers.length === 0) return undefined;
    let cancelled = false;
    fetchFundamentals(tickers).then((data) => {
      if (!cancelled && data && typeof data === 'object') setByTicker(data);
    }).catch(() => { /* best effort — panel just stays empty */ });
    return () => { cancelled = true; };
  }, [tickerJoin]);

  // Recomputed every render (one Intl format — negligible) and fed into
  // the memo's deps, so the list re-evaluates within a refresh tick of
  // London midnight instead of freezing whatever day the panel mounted
  // on. A PWA left open overnight would otherwise keep yesterday's row.
  const todayKey = londonDayKey(Math.floor(Date.now() / 1000));

  const upcoming = React.useMemo(() => {
    // Re-filter against the CURRENT board on every render, not just at
    // fetch time: `byTicker` holds the previous response until a new
    // one lands (and keeps it entirely if that fetch fails), so without
    // this a stock sold out mid-session would linger in the panel.
    const onBoard = new Set(tickerJoin.split(',').filter(Boolean));
    /** @type {{ticker: string, ts: number, time: string | null, fq: string | null}[]} */
    const rows = [];
    for (const [ticker, f] of Object.entries(byTicker || {})) {
      if (!onBoard.has(ticker)) continue;
      const ts = Number(/** @type {any} */ (f)?.earningsDate);
      if (!isFinite(ts) || ts <= 0) continue;
      // Keep a report for the WHOLE of its day. Comparing against the
      // instant dropped it the moment the scheduled time passed, so a
      // 21:00 report vanished at 21:00 even though the numbers land
      // right then and that's exactly when you want the row. Now it
      // only leaves once the London day itself is over.
      if (londonDayKey(ts) < todayKey) continue;
      rows.push({
        ticker,
        ts,
        time: /** @type {any} */ (f)?.earningsTime || null,
        // "FY26Q2" — which fiscal quarter this report covers. Derived
        // server-side from the company's own fiscal calendar (Yahoo's
        // own quarter labels are calendar quarters, so they'd read
        // FY26Q2 for NVDA's FY27Q2). Absent for tickers where Yahoo
        // didn't publish the inputs; the suffix is just omitted then.
        fq: /** @type {any} */ (f)?.fiscalQuarter || null,
      });
    }
    rows.sort((a, b) => a.ts - b.ts);
    return rows.slice(0, 3);
  }, [byTicker, tickerJoin, todayKey]);

  return (
    <section className={`panel earnings-panel ${className}`}>
      <h3 className="panel-title">UPCOMING EARNINGS</h3>
      <div className="earnings-list">
        {upcoming.length === 0 ? (
          <div className="earnings-empty mono dim">No scheduled earnings.</div>
        ) : upcoming.map(row => (
          <div key={row.ticker} className="earnings-row">
            <span className="earnings-ticker mono">
              {row.ticker}
              {row.fq && <span className="earnings-fq"> {row.fq}</span>}
            </span>
            <span className="earnings-date mono">{fmtEarningsDate(row.ts)}</span>
            <span className="earnings-time mono dim">{fmtEarningsTime(row.ts, row.time)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// "03 Jun" — day + short month name in Europe/London tz. Matches the
// scoreboard clock so the date agrees with the time chip above, and
// reads more naturally than the previous numeric MM/DD which forced
// the eye to map 06 → June.
// London calendar day as `YYYY-MM-DD`, for comparing "is this report's
// day already over?". Sortable as a plain string. London because that's
// the timezone the row's date and time are rendered in — the entry
// should disappear when the day the user is LOOKING at rolls over, not
// when some other zone's midnight passes.
const LONDON_DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
function londonDayKey(unixSec) {
  return LONDON_DAY_FMT.format(new Date(unixSec * 1000));
}

function fmtEarningsDate(unixSec) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit', month: 'short',
  }).formatToParts(new Date(unixSec * 1000));
  let dd = '', mo = '';
  for (const p of parts) {
    if (p.type === 'day') dd = p.value;
    if (p.type === 'month') mo = p.value;
  }
  return `${dd} ${mo}`;
}

// Prefer Yahoo's labelled time ("before market open" → "BMO") when
// available — more meaningful than the raw timestamp for US-listed
// companies whose earnings calls run BMO or AMC. Falls back to
// London-tz HH:MM (same tz as the scoreboard clock) when Yahoo's
// time-name field is empty / "time as supplied".
function fmtEarningsTime(unixSec, timeName) {
  if (typeof timeName === 'string' && timeName.length > 0) {
    const lower = timeName.toLowerCase();
    if (lower.includes('before')) return 'BMO';
    if (lower.includes('after'))  return 'AMC';
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(unixSec * 1000));
  let hh = '00', mm = '00';
  for (const p of parts) {
    if (p.type === 'hour') hh = p.value;
    if (p.type === 'minute') mm = p.value;
  }
  return `${hh}:${mm}`;
}

export { Header, Sidebar, SidebarFoot, MarketConditions, PerfPanel, UpcomingEarnings };
