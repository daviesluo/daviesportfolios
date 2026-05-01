// Main portfolio tactics board app
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  fmtMoney,
  fmtPct,
  fmtPrice,
  pctColor,
  computeMetrics,
  detectFormation,
  refreshPrices,
  fetchTickers,
  usMarketPhase,
  detectCurrency,
  fxToUSD,
  Storage,
  POSITION_COORDS,
} from './utils.js';
import { INITIAL_PORTFOLIO } from './data.js';
import { collectPassword, decodeAppToken, getAppToken, authenticate } from './auth.js';
import { loadPortfolioRemote, savePortfolioRemote } from './portfolio_remote.js';
import { prefetchAllChartData } from './prefetch.js';
import { Header, Sidebar, MarketConditions, PerfPanel, SidebarFoot } from './header_sidebar.jsx';
import { Pitch } from './pitch.jsx';
import { Heatmap } from './heatmap.jsx';
import {
  PositionDrillModal,
  EditTickerModal,
  AddTickerModal,
  CashModal,
} from './modals.jsx';
import { TickerChartModal } from './ticker_chart_modal.jsx';
import { ServiceWorkerBanner } from './sw-banner.jsx';
import { reportError } from './ops_error.js';

// Catches any render-time crash and shows a readable error instead of a blank page.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  componentDidCatch(error, info) {
    reportError('render.crash', {
      message: String(error?.message || error),
      context: { stack: String(error?.stack || '').slice(0, 1500), componentStack: String(info?.componentStack || '').slice(0, 800) },
    });
  }
  render() {
    if (this.state.err) {
      return React.createElement('div', {
        style: { color: '#fff', background: '#0c1310', padding: '32px', fontFamily: 'monospace', minHeight: '100vh' }
      },
        React.createElement('div', { style: { color: '#f55', marginBottom: '12px', letterSpacing: '0.15em' } }, 'RENDER ERROR'),
        React.createElement('pre', { style: { color: '#aaa', fontSize: '12px', whiteSpace: 'pre-wrap', marginBottom: '20px' } }, String(this.state.err)),
        React.createElement('button', {
          onClick: () => window.location.reload(),
          style: { background: '#2a2a2a', color: '#fff', border: '1px solid #444', padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace' }
        }, 'Reload')
      );
    }
    return this.props.children;
  }
}

const REFRESH_MS = 30 * 1000;

// USDCNY=X is a hidden FX fetch used only for CNY→USD conversion of holdings
// (not shown in the market-conditions column). GBPUSD=X doubles as both a
// displayed card and the rate we use to convert GBP holdings to USD.
const MC_TICKERS = ["^GSPC", "^NDX", "^RUT", "^SOX", "^VIX", "BZ=F", "^TNX", "GBPUSD=X", "GBPCNH=X", "USDCNY=X", "ES=F", "NQ=F", "RTY=F"];

// Main app ---------------------------------------------------------------
function App() {
  // Auth lifecycle:
  //   bootState  one-shot init that runs Storage.migrate, decides whether
  //              we already have a still-valid sessionStorage token (skip
  //              prompt entirely) or need to collect a password
  //   pwInput    raw password from URL or window.prompt; null when we're
  //              reusing an existing token
  //   auth       result of the async Edge Function check; undefined while
  //              in flight, then { isReadOnly } | { locked } | null
  // Reusing the existing token is what stops the "page reloads 1-2 s
  // after entering ?pwd= and re-prompts for password" issue: when the SW
  // (or anything else) reloads the tab, the URL pwd is gone but session-
  // Storage still holds a valid token from the pre-reload login.
  const [bootState] = useState(() => {
    Storage.migrate();
    const existing = decodeAppToken(getAppToken());
    if (existing) {
      // Still consume the URL ?pwd if present so it doesn't linger in
      // browser history; we just don't need its result.
      const params = new URLSearchParams(window.location.search);
      if (params.has("pwd")) {
        params.delete("pwd");
        const newSearch = params.toString();
        history.replaceState(null, "",
          window.location.pathname + (newSearch ? "?" + newSearch : "") + window.location.hash);
      }
      return { pwInput: null, initialAuth: { isReadOnly: existing.role === "ro" } };
    }
    return { pwInput: collectPassword(), initialAuth: undefined };
  });
  const pwInput = bootState.pwInput;
  const [auth, setAuth] = useState(bootState.initialAuth);

  useEffect(() => {
    if (auth !== undefined) return;            // already authed via existing token
    if (pwInput == null) { setAuth(null); return; }
    let cancelled = false;
    authenticate(pwInput).then(result => {
      if (!cancelled) setAuth(result);
    });
    return () => { cancelled = true; };
  }, [pwInput, auth]);

  if (auth === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1310' }}>
        <div style={{ color: '#888', fontFamily: 'monospace', letterSpacing: '0.2em', fontSize: '12px' }}>AUTHENTICATING…</div>
      </div>
    );
  }

  if (auth && auth.locked) {
    const hoursLeft = Math.ceil((auth.lockUntil - Date.now()) / 1000 / 60 / 60);
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1310' }}>
        <div style={{ textAlign: 'center', padding: '40px', border: '1px solid #2a2a2a', borderRadius: '4px' }}>
          <div style={{ color: '#f55', fontFamily: 'monospace', letterSpacing: '0.2em', fontSize: '14px', marginBottom: '8px' }}>ACCESS LOCKED</div>
          <div style={{ color: '#888', fontFamily: 'monospace', fontSize: '12px' }}>Too many incorrect attempts.</div>
          <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '12px', marginTop: '6px' }}>Try again in {hoursLeft}h.</div>
        </div>
      </div>
    );
  }

  if (!auth) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1310' }}>
        <div style={{ textAlign: 'center', padding: '40px', border: '1px solid #2a2a2a', borderRadius: '4px' }}>
          <div style={{ color: '#f55', fontFamily: 'monospace', letterSpacing: '0.2em', fontSize: '14px', marginBottom: '8px' }}>ACCESS DENIED</div>
          <div style={{ color: '#888', fontFamily: 'monospace', fontSize: '12px', marginBottom: '20px' }}>Incorrect password.</div>
          <button style={{ background: '#1e2d28', color: '#ccc', border: '1px solid #3a3a3a', padding: '8px 20px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', borderRadius: '2px' }} onClick={() => window.location.reload()}>Try again</button>
        </div>
      </div>
    );
  }
  return (
    <ErrorBoundary>
      <ServiceWorkerBanner />
      <Board isReadOnly={auth.isReadOnly} />
    </ErrorBoundary>
  );
}

function Board({ isReadOnly }) {
  const [portfolio, setPortfolio] = useState(null);      // null = still loading
  const [drillPos, setDrillPos] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editingTicker, setEditingTicker] = useState(null);
  const [viewingTicker, setViewingTicker] = useState(null);
  const [addingToPos, setAddingToPos] = useState(null);
  const [editingCash, setEditingCash] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [source, setSource] = useState("—");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recentlyUpdated, setRecentlyUpdated] = useState(false);
  const [flashTickers, setFlashTickers] = useState({});
  const [dragging, setDragging] = useState(null);
  const [extendedHours, setExtendedHours] = useState(false);
  const [marketData, setMarketData] = useState({});
  const [viewMode, setViewMode] = useState('tactics');

  // "Hide values" toggle — replaces dollar amounts with bullets so the
  // user can show the page to someone next to them without revealing
  // absolute portfolio sizes. Percentages stay visible. Persisted across
  // reloads in the unified `dp.prefs` storage slot.
  const [hideValues, setHideValues] = useState(() => Storage.loadPrefs().hideValues === true);
  const toggleHideValues = useCallback(() => {
    setHideValues(v => {
      const next = !v;
      Storage.savePrefs({ ...Storage.loadPrefs(), hideValues: next });
      return next;
    });
  }, []);
  // In read-only mode or history mode, force-disable edit mode.
  useEffect(() => { if (isReadOnly && editMode) setEditMode(false); }, [isReadOnly, editMode]);

  // Initial load from Supabase (never throws — falls back to INITIAL_PORTFOLIO on any error)
  useEffect(() => {
    let cancelled = false;
    loadPortfolioRemote().then(p => { if (!cancelled) setPortfolio(p); });
    return () => { cancelled = true; };
  }, []);

  // Debounced persist to Supabase — admin only. Skip the initial null-to-loaded transition.
  const lastSavedRef = useRef(null);
  useEffect(() => {
    if (!portfolio) return;
    if (isReadOnly) return;
    if (lastSavedRef.current === null) { lastSavedRef.current = portfolio; return; }
    if (lastSavedRef.current === portfolio) return;
    const id = setTimeout(() => {
      lastSavedRef.current = portfolio;
      savePortfolioRemote(portfolio);
    }, 600);
    return () => clearTimeout(id);
  }, [portfolio, isReadOnly]);

  // Price refresh loop
  // `doRefresh(opts)` always fetches the live-prices snapshot. The
  // optional opts.prefetch flag (default true) controls whether we ALSO
  // kick off the background chart-data prefetch afterwards. The 30 s
  // auto-refresh interval passes prefetch:false so it doesn't re-do
  // the same fetches well inside each range's TTL.
  const doRefresh = useCallback(async (opts) => {
    if (!portfolio) return;
    // Defaults to true so the manual Refresh button (which forwards a
    // click event as the first arg, not an opts object) still triggers
    // the prefetch.
    const shouldPrefetch =
      opts && typeof opts === 'object' && opts.prefetch === false ? false : true;
    setIsRefreshing(true);
    const [{ updates, source: src }, mcResult] = await Promise.all([
      refreshPrices(portfolio, "live"),
      fetchTickers(MC_TICKERS),
    ]);
    if (mcResult) setMarketData(mcResult);
    setSource(src);
    setPortfolio(prev => {
      if (!prev) return prev;
      const next = { ...prev, holdings: { ...prev.holdings } };
      const flashes = {};
      for (const [t, u] of Object.entries(updates)) {
        if (!next.holdings[t]) continue;
        const old = next.holdings[t].lastPrice;
        const oldExt = next.holdings[t].extPrice ?? null;
        next.holdings[t] = {
          ...next.holdings[t],
          lastPrice: u.lastPrice,
          extPrice: u.extPrice ?? next.holdings[t].extPrice ?? null,
          prevClose: u.prevClose ?? next.holdings[t].prevClose,
          dayPct: u.dayPct ?? next.holdings[t].dayPct,
          extDayPct: (u.extPrice != null && u.lastPrice > 0) ? ((u.extPrice - u.lastPrice) / u.lastPrice) * 100 : next.holdings[t].extDayPct ?? null,
          // Carry currency from the price fetch if present; otherwise keep what's
          // already stored (from detectCurrency at add time).
          currency: u.currency ?? next.holdings[t].currency,
        };
        const newExt = u.extPrice ?? null;
        const priceChanged = Math.abs(u.lastPrice - old) > 0.0001;
        const extChanged = newExt != null && oldExt != null && Math.abs(newExt - oldExt) > 0.0001;
        if (priceChanged || extChanged) {
          const newRef = newExt ?? u.lastPrice;
          const oldRef = oldExt ?? old;
          flashes[t] = newRef > oldRef ? "up" : "down";
        }
      }
      if (Object.keys(flashes).length) {
        setFlashTickers(flashes);
        setTimeout(() => setFlashTickers({}), 1200);
      }
      return next;
    });
    setLastUpdated(new Date());
    setIsRefreshing(false);
    if (src === "live") {
      setRecentlyUpdated(true);
      setTimeout(() => setRecentlyUpdated(false), 1600);
      // Background prefetch every (range × ticker) chart payload after the
      // live-prices UI has settled. Fire-and-forget — the cache writes that
      // land before the user navigates away are still useful. Skipped on
      // the 30 s auto-refresh tick (shouldPrefetch=false) since cache TTLs
      // (5 m / 30 m / 1 h / 12 h) mean those would refetch with nothing
      // fresh to show.
      if (shouldPrefetch) {
        const phaseNow = usMarketPhase(new Date());
        const tickerList = Object.keys(portfolio?.holdings || {})
          .filter((t) => t !== "CASH" && !portfolio.holdings[t]?.isCash);
        const sp = (extendedHours && phaseNow !== "regular") ? "ES=F" : "^GSPC";
        prefetchAllChartData({
          tickers: tickerList,
          spSymbol: sp,
          extendedHours,
          phase: phaseNow,
        });
      }
    }
    if (src === "error") {
      setTimeout(() => doRefreshRef.current(), 3000);
    }
  }, [portfolio, extendedHours]);

  const doRefreshRef = useRef(doRefresh);
  useEffect(() => { doRefreshRef.current = doRefresh; }, [doRefresh]);

  // Kick off the refresh loop once the portfolio is loaded.
  useEffect(() => {
    if (!portfolio) return;
    // Initial mount triggers prefetch (default). The 30 s tick skips it
    // — TTLs run in minutes/hours so the auto-refresh would re-fetch
    // chart data with no fresh bars to show. The user's explicit
    // Refresh click also triggers prefetch (it goes through doRefresh
    // directly, with the synthetic React event arg which is truthy but
    // not { prefetch: false } so the default applies).
    doRefreshRef.current();
    const id = setInterval(() => doRefreshRef.current({ prefetch: false }), REFRESH_MS);
    return () => clearInterval(id);
  }, [portfolio !== null]);

  if (!portfolio) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1310' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#aaa', fontFamily: 'monospace', letterSpacing: '0.2em', fontSize: '12px', marginBottom: '8px' }}>LOADING…</div>
          <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '11px' }}>Fetching board from cloud.</div>
        </div>
      </div>
    );
  }

  // Never substitute extended-hours prices during the regular session — the
  // toggle only takes effect outside RTH so the displayed value stays consistent.
  const currentPhase = usMarketPhase(new Date());
  const metrics = computeMetrics(portfolio, { extended: extendedHours && currentPhase !== "regular", marketData });
  const formation = detectFormation(portfolio);

  // Captain is the single largest position by USD market value — convert native
  // currency to USD so a CNY or GBP holding is ranked correctly against USD ones.
  let captainTicker = null, captainMV = 0;
  for (const [t, h] of Object.entries(portfolio.holdings)) {
    const fx = fxToUSD(h.currency, marketData);
    const mv = h.shares * h.lastPrice * fx;
    if (mv > captainMV) { captainMV = mv; captainTicker = t; }
  }
  // hotMoverTicker: biggest individual mover, used for the hot-badge inside drill modals
  let hotMoverTicker = null, hotTickAbs = 0;
  for (const [t, h] of Object.entries(portfolio.holdings)) {
    const abs = Math.abs(h.dayPct ?? 0);
    if (abs > hotTickAbs) { hotTickAbs = abs; hotMoverTicker = t; }
  }
  // hotMoverPosKey: position (card) with the highest |dayPct| — determines where the ball sits
  let hotMoverPosKey = null, hotPosAbs = 0;
  for (const [k, pos] of Object.entries(metrics.positions)) {
    if (!pos.players.length) continue;
    const abs = Math.abs(pos.dayPct ?? 0);
    if (abs > hotPosAbs) { hotPosAbs = abs; hotMoverPosKey = k; }
  }

  // Edit handlers — all no-ops when read-only.
  const guard = (fn) => (...args) => { if (isReadOnly) return; fn(...args); };

  const updateHolding = guard((ticker, patch) => {
    setPortfolio(p => {
      const cur = p.holdings[ticker];
      if (!cur) return p;
      const next = { ...cur, ...patch };
      // When the modal saves an explicit `lots` array we recompute total shares
      // and weighted-average cost from it, so the lots stay the source of truth.
      if (Array.isArray(patch.lots)) {
        const totalShares = patch.lots.reduce((s, l) => s + (Number(l.shares) || 0), 0);
        const totalCost   = patch.lots.reduce((s, l) => s + (Number(l.shares) || 0) * (Number(l.cost) || 0), 0);
        next.shares = totalShares;
        next.cost   = totalShares > 0 ? totalCost / totalShares : 0;
      }
      return { ...p, holdings: { ...p.holdings, [ticker]: next } };
    });
  });
  const removeHolding = guard((ticker) => {
    setPortfolio(p => {
      const holdings = { ...p.holdings }; delete holdings[ticker];
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        positions[k] = { ...pos, tickers: pos.tickers.filter(t => t !== ticker) };
      }
      return { ...p, holdings, positions };
    });
  });
  const addHolding = guard((posKey, ticker, shares, cost, lastPrice, buyDate) => {
    ticker = ticker.toUpperCase().trim();
    if (!ticker) return;
    const currency = detectCurrency(ticker);
    const today = new Date().toISOString().slice(0, 10);
    const lotDate = buyDate || today;
    setPortfolio(p => {
      const holdings = {
        ...p.holdings,
        [ticker]: {
          shares: Number(shares) || 0,
          cost: Number(cost) || 0,
          lastPrice: Number(lastPrice) || Number(cost) || 0,
          prevClose: Number(lastPrice) || Number(cost) || 0,
          dayPct: 0,
          currency,
          lots: [{ date: lotDate, shares: Number(shares) || 0, cost: Number(cost) || 0 }],
        },
      };
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        const tickers = pos.tickers.filter(t => t !== ticker);
        if (k === posKey) tickers.push(ticker);
        positions[k] = { ...pos, tickers };
      }
      return { ...p, holdings, positions };
    });
  });
  const movePlayer = guard((ticker, toPos) => {
    setPortfolio(p => {
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        const tickers = pos.tickers.filter(t => t !== ticker);
        if (k === toPos) tickers.push(ticker);
        positions[k] = { ...pos, tickers };
      }
      return { ...p, positions };
    });
  });
  const updatePosition = guard((posKey, patch) => {
    setPortfolio(p => ({ ...p, positions: { ...p.positions, [posKey]: { ...p.positions[posKey], ...patch } } }));
  });

  const handleDrop = (e, toPos) => {
    e.preventDefault();
    if (isReadOnly) { setDragging(null); return; }
    if (dragging && dragging.fromPos !== toPos) movePlayer(dragging.ticker, toPos);
    setDragging(null);
  };

  return (
    <div className="app">
      <Header
        metrics={metrics}
        source={source}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
        onRefresh={doRefresh}
        editMode={editMode}
        setEditMode={setEditMode}
        isReadOnly={isReadOnly}
        extendedHours={extendedHours}
        onToggleExtended={() => setExtendedHours(v => !v)}
        viewMode={viewMode}
        onToggleView={setViewMode}
        hideValues={hideValues}
        onToggleHideValues={toggleHideValues}
      />

      <main className="main">
        <div className="left-col">
          <PerfPanel
            portfolio={portfolio}
            marketData={marketData}
            extendedHours={extendedHours}
            phase={currentPhase}
            className="perf-in-left"
          />
          <MarketConditions
            marketData={marketData}
            extendedHours={extendedHours}
            phase={currentPhase}
          />
        </div>
        {viewMode === 'heatmap' ? (
          <Heatmap
            metrics={metrics}
            extendedHours={extendedHours && currentPhase !== "regular"}
            onTileClick={(t) => setViewingTicker(t)}
          />
        ) : (
          <Pitch
            metrics={metrics}
            captainTicker={captainTicker}
            hotMoverTicker={hotMoverTicker}
            hotMoverPosKey={hotMoverPosKey}
            flashTickers={flashTickers}
            editMode={editMode}
            isReadOnly={isReadOnly}
            dragging={dragging}
            setDragging={isReadOnly ? () => {} : setDragging}
            onDrop={handleDrop}
            onOpenPosition={(k) => {
              if (k === "GK") { if (!isReadOnly) setEditingCash(true); return; }
              setDrillPos(k);
            }}
            onAddToPosition={(k) => {
              if (isReadOnly) return;
              if (k === "GK") setEditingCash(true); else setAddingToPos(k);
            }}
            onUpdatePosition={updatePosition}
            isRefreshing={isRefreshing}
            recentlyUpdated={recentlyUpdated}
            hideValues={hideValues}
          />
        )}
        <Sidebar
          metrics={metrics}
          source={source}
          portfolio={portfolio}
          marketData={marketData}
          extendedHours={extendedHours}
          phase={currentPhase}
          hideValues={hideValues}
        />
        {/* Mobile-only Market Conditions strip — rendered as a separate
            sibling because the desktop instance lives inside .left-col,
            which is display:none on mobile. CSS hides this one above
            the mobile breakpoint. */}
        <MarketConditions
          marketData={marketData}
          extendedHours={extendedHours}
          phase={currentPhase}
          className="market-conditions-mobile"
        />
        <SidebarFoot source={source} />
      </main>

      {drillPos && (
        <PositionDrillModal
          posKey={drillPos}
          position={metrics.positions[drillPos]}
          captainTicker={captainTicker}
          hotMoverTicker={hotMoverTicker}
          flashTickers={flashTickers}
          editMode={editMode}
          isReadOnly={isReadOnly}
          onClose={() => setDrillPos(null)}
          onEditTicker={(t) => { if (isReadOnly) return; setEditingTicker(t); }}
          onViewChart={(t) => setViewingTicker(t)}
          onAddTicker={() => { if (isReadOnly) return; setAddingToPos(drillPos); }}
          onRemoveTicker={(t) => { if (isReadOnly) return; if (confirm(`Remove ${t}?`)) removeHolding(t); }}
          onUpdatePosition={(patch) => updatePosition(drillPos, patch)}
          hideValues={hideValues}
        />
      )}

      {viewingTicker && portfolio.holdings[viewingTicker] && (
        <TickerChartModal
          ticker={viewingTicker}
          holding={portfolio.holdings[viewingTicker]}
          marketData={marketData}
          extendedHours={extendedHours}
          phase={currentPhase}
          onClose={() => setViewingTicker(null)}
        />
      )}

      {editingTicker && !isReadOnly && portfolio.holdings[editingTicker] && (
        <EditTickerModal
          ticker={editingTicker}
          holding={portfolio.holdings[editingTicker]}
          onClose={() => setEditingTicker(null)}
          onSave={(patch) => { updateHolding(editingTicker, patch); setEditingTicker(null); }}
          onDelete={() => { if (confirm(`Remove ${editingTicker}?`)) { removeHolding(editingTicker); setEditingTicker(null); } }}
        />
      )}

      {addingToPos && !isReadOnly && (
        <AddTickerModal
          posKey={addingToPos}
          position={portfolio.positions[addingToPos]}
          onClose={() => setAddingToPos(null)}
          onAdd={(ticker, shares, cost, lastPrice) => {
            addHolding(addingToPos, ticker, shares, cost, lastPrice);
            setAddingToPos(null);
          }}
        />
      )}

      {editingCash && !isReadOnly && (
        <CashModal
          amount={portfolio.holdings.CASH ? portfolio.holdings.CASH.lastPrice : 0}
          onClose={() => setEditingCash(false)}
          onSave={(amt) => {
            setPortfolio(p => ({
              ...p,
              holdings: {
                ...p.holdings,
                CASH: { shares: 1, cost: amt, lastPrice: amt, prevClose: amt, dayPct: 0, isCash: true },
              },
              positions: {
                ...p.positions,
                GK: { ...p.positions.GK, tickers: ["CASH"] },
              },
            }));
            setEditingCash(false);
          }}
        />
      )}
    </div>
  );
}

// Expose to window
export default App;
