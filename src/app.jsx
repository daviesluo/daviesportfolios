// Main portfolio tactics board app
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fmtMoney, fmtPct, fmtPrice, pctColor } from './formatters.js';
import { detectCurrency, fxToUSD } from './fx.js';
import { computeMetrics, detectFormation } from './metrics.js';
import {
  refreshPrices,
  fetchTickers,
  fetchTodayRegularClose,
  fetchHistoricalBatch,
  usMarketPhase,
  usMarketHoursUtc,
  isWeekendDeadZone,
  Storage,
  POSITION_COORDS,
} from './utils.js';
import { INITIAL_PORTFOLIO } from './data.js';
import { collectPassword, decodeAppToken, getAppToken, authenticate } from './auth.js';
import { loadPortfolioRemote, savePortfolioRemote, portfolioUserFingerprint, PORTFOLIO_BROADCAST_CHANNEL } from './portfolio_remote.js';
import { prefetchAllChartData } from './prefetch.js';
import { hydrateAllChartStores } from './chart_store.js';
import { Header, Sidebar, MarketConditions, PerfPanel, SidebarFoot, UpcomingEarnings } from './header_sidebar.jsx';
import { useIsDesktop } from './ops_error_badge.jsx';
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
import { extPriceIsRealAh } from './indicators.js';
import { isUsEquity } from './ticker_class.js';
import { fetchTrading212Holdings, applyTrading212, applyTrading212NightPrice } from './trading212.js';

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

// 30 s during the trading day (regular session + pre / after-hours),
// Auto-refresh cadence. 30 s through the trading week — INCLUDING
// weekday overnights, so the T212 overnight quote for US holdings
// stays live without a manual refresh (the T212 call is still capped
// at ≤1 / 30 s by the Edge Function's cache + atomic claim, so the
// night cadence can't trip T212's rate limit). The ONLY slow window
// is the weekend dead zone — Fri 20:00 ET (after-hours close) through
// Sun 20:00 ET (overnight reopen) — where nothing trades, not even
// the 24/5 overnight session, so 5 min avoids burning Yahoo's per-IP
// budget on round-trips with nothing fresh to show.
const REFRESH_MS = 30 * 1000;
const REFRESH_MS_WEEKEND = 5 * 60 * 1000;

// USDCNY=X is a hidden FX fetch used only for CNY→USD conversion of holdings
// (not shown in the market-conditions column). GBPUSD=X doubles as both a
// displayed card and the rate we use to convert GBP holdings to USD.
const MC_TICKERS = ["^GSPC", "^NDX", "^RUT", "^SOX", "^VIX", "BZ=F", "^TNX", "GBPUSD=X", "GBPCNY=X", "USDCNY=X", "USDHKD=X", "ES=F", "NQ=F", "RTY=F"];
// sessionStorage key for the pending-save draft mirror. Per-tab
// (sessionStorage, not localStorage) so two tabs can't replay each
// other's drafts; survives reload-in-same-tab (which is what a
// browser crash + relaunch typically does for the tab).
const PENDING_SAVE_KEY = 'dp.pendingSave';

// MC symbols whose CARDS are clickable. The futures alternates
// (ES=F / NQ=F / RTY=F) only appear on the card face during
// ext-hours, but `<MarketConditions>`'s `onCardClick` passes
// the ACTIVE ticker (= futures during ext-on for indices that
// have a futures alt), so prefetch needs to warm both canonical
// and futures tickers — otherwise clicking ^GSPC card in ext
// mode opens an ES=F chart whose cache is cold.
const MC_PREFETCH_TICKERS = ["^GSPC", "^NDX", "^RUT", "^SOX", "^VIX", "BZ=F", "^TNX", "GBPUSD=X", "GBPCNY=X", "USDCNY=X", "USDHKD=X", "ES=F", "NQ=F", "RTY=F"];

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
  const [extendedHours, setExtendedHours] = useState(false);
  // Conflict banner: set when a save round-trip returned 412 — another
  // tab / device wrote between our load and this save. We don't
  // auto-overwrite; the user picks via the banner (Reload to discard
  // the in-flight edits and adopt the latest server state, or Keep
  // editing and let the next debounce retry — the save effect
  // re-cached the server's current version on the 412 reply so a
  // retry against the same row will go through).
  const [saveConflict, setSaveConflict] = useState(false);
  // Mount only one MarketConditions tree (desktop OR mobile) instead
  // of both — the previous "render both, CSS-hide one" pattern paid
  // the full render cost for ten market cards on every refresh in
  // the unused viewport.
  const isDesktop = useIsDesktop();
  // Seed marketData with last-known FX rates from localStorage so the
  // first metrics compute uses real cross-rates (~yesterday's, well
  // inside a percent of live) instead of fxRateToUSD's silent 1:1
  // fallback. Before this, on cold start CNY-denominated holdings
  // briefly showed at native × 1.0 USD = ~7× inflated (and GBP at
  // native × 1.0 = ~20 % deflated), then corrected on the first
  // live tick — the user reported the portfolio total flashing
  // $156 k before settling at $146 k. Storage.loadFxCache returns
  // `{}` when the cache is missing or older than 7 days, so callers
  // that need to detect "no FX yet" still can.
  const [marketData, setMarketData] = useState(() => Storage.loadMarketCache());
  // "Has the first successful fetchTickers reply landed yet?" — used
  // by Header to delay rendering the red FX MISSING pill until we've
  // actually had a market-data tick. Otherwise every cold start
  // flashes "FX MISSING N tickers" for ~500 ms before the first
  // fetch fills marketData and the pill unmounts.
  const [marketDataReady, setMarketDataReady] = useState(false);
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

  // Global keyboard shortcuts (advertised in the sidebar foot):
  //   r → refresh prices (everyone)
  //   e → toggle edit mode (admin only)
  //   x → toggle extended-hours pricing (everyone)
  // Skipped while typing in an input/textarea/contenteditable, while
  // any modifier (Ctrl/Cmd/Alt) is held, and while any modal is open
  // — Ctrl+R still reloads the page, the EditTickerModal still types
  // an 'e' or 'r' into a shares field without firing the shortcut.
  useEffect(() => {
    const anyModalOpen = () =>
      drillPos != null || editingTicker != null || viewingTicker != null
      || addingToPos != null || editingCash;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (anyModalOpen()) return;
      const tgt = /** @type {HTMLElement | null} */ (e.target);
      const tag = tgt?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (tgt?.isContentEditable) return;
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        doRefreshRef.current?.();
      } else if (e.key === 'e' || e.key === 'E') {
        if (isReadOnly) return;
        e.preventDefault();
        setEditMode(v => !v);
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        setExtendedHours(v => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isReadOnly, drillPos, editingTicker, viewingTicker, addingToPos, editingCash]);

  // Initial load from Supabase (never throws — falls back to INITIAL_PORTFOLIO on any error)
  useEffect(() => {
    let cancelled = false;
    loadPortfolioRemote().then(p => { if (!cancelled) setPortfolio(p); });
    return () => { cancelled = true; };
  }, []);

  // Debounced persist to Supabase — admin only.
  // Compares against a STRING FINGERPRINT of just the user-edited
  // subset (positions + shares/cost/lots/currency) instead of object-
  // identity on the whole portfolio. The 30 s / 5 min price-refresh
  // tick mutates `holdings[t].lastPrice` etc., which used to create
  // a new portfolio reference and trigger an unnecessary save. A
  // backgrounded tab serialising its stale-shares-with-fresh-prices
  // snapshot back to the server is exactly how an edit made in
  // another tab gets silently reverted — fingerprint-equality
  // short-circuits the save when only ephemeral fields changed.
  const lastSavedFingerprintRef = useRef(null);
  useEffect(() => {
    if (!portfolio) return;
    if (isReadOnly) return;
    // Don't persist the seeded demo portfolio over the user's Supabase
    // row. The DemoBanner below gives them an explicit choice (Reset
    // to empty / Keep these positions); both clear `_isDemo` so saves
    // resume. Without this gate, opening the site once + entering
    // edit mode (even just toggling without actual data changes) was
    // enough to silently lock the user into Davies's 33-ticker book.
    if (portfolio._isDemo) return;
    const fp = portfolioUserFingerprint(portfolio);
    if (lastSavedFingerprintRef.current === null) {
      lastSavedFingerprintRef.current = fp;
      // Cold-mount: if a previous tab crashed mid-edit (or the
      // browser killed the tab in the 600ms debounce window), the
      // pending draft is still in sessionStorage. Replay it now so
      // the user sees their unsaved changes instead of the
      // server's last-saved blob.
      try {
        const raw = sessionStorage.getItem(PENDING_SAVE_KEY);
        if (raw) {
          const pending = JSON.parse(raw);
          if (pending && pending.fp && pending.fp !== fp && pending.portfolio) {
            setPortfolio(pending.portfolio);
            // setPortfolio will re-fire this effect on the next render,
            // at which point fp will differ from
            // lastSavedFingerprintRef and the normal debounce + save
            // path will pick up the draft.
          }
        }
      } catch { /* private mode etc. */ }
      return;
    }
    if (lastSavedFingerprintRef.current === fp) return;
    // Mirror the about-to-be-saved portfolio to sessionStorage
    // BEFORE the 600 ms debounce. If the browser dies in that
    // window the next cold mount replays it; if the save succeeds
    // the .then() below clears the mirror so the next cold mount
    // sees nothing pending. Per-tab (sessionStorage) so two tabs
    // can't accidentally replay each other's drafts.
    try {
      sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ fp, portfolio, ts: Date.now() }));
    } catch { /* swallow — best-effort */ }
    const id = setTimeout(() => {
      lastSavedFingerprintRef.current = fp;
      savePortfolioRemote(portfolio).then((result) => {
        if (result && result.ok === true) {
          try { sessionStorage.removeItem(PENDING_SAVE_KEY); } catch { /* ignore */ }
          return;
        }
        if (result && result.ok === false && result.conflict === true) {
          // Another tab/device wrote between our last load and this
          // save. Don't clear the pending-draft mirror — the user
          // should resolve the conflict explicitly via the banner
          // (Reload to discard local + see latest, or Keep editing
          // to retry; the next save attempt with the freshly-cached
          // version may go through cleanly).
          setSaveConflict(true);
        }
      });
    }, 600);
    return () => clearTimeout(id);
  }, [portfolio, isReadOnly]);

  // Cross-tab sync: when any other tab on this origin successfully
  // persists a new portfolio (via savePortfolioRemote's broadcast),
  // re-fetch ours so the UI doesn't sit on a stale copy that the
  // user will then "edit" against an out-of-date baseline. We update
  // the fingerprint ref BEFORE setPortfolio so the next render's
  // auto-save effect sees a no-op delta and doesn't re-save the data
  // we just received.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    let cancelled = false;
    let bc;
    try { bc = new BroadcastChannel(PORTFOLIO_BROADCAST_CHANNEL); }
    catch { return undefined; }
    const handler = (e) => {
      if (cancelled) return;
      if (e?.data?.kind !== 'portfolio-saved') return;
      loadPortfolioRemote().then((p) => {
        if (cancelled || !p) return;
        lastSavedFingerprintRef.current = portfolioUserFingerprint(p);
        setPortfolio(p);
      }).catch(() => { /* network blip — next tick retries via own load path */ });
    };
    bc.addEventListener('message', handler);
    return () => {
      cancelled = true;
      try { bc.removeEventListener('message', handler); } catch { /* ignore */ }
      try { bc.close(); } catch { /* ignore */ }
    };
  }, []);

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
    // Parallel fetches:
    //   - live prices for portfolio holdings
    //   - live snapshots for the MC index/futures cards
    //   - today's 16:00 ET close for *every* MC ticker so ext-on cards
    //     all share the same "since the last 16:00 ET close" anchor as
    //     the per-ticker drill modal. Yahoo's prevClose is yesterday's
    //     settle/close which doesn't match the modal's anchor; fetching
    //     the actual 16:00 ET bar lines them up. Indices (^VIX / ^TNX
    //     / ^SOX) that don't move in AH end up showing ~0% in ext
    //     mode — same as the modal — which is the expected reading.
    //   - (outside RTH) today's intraday bars for the US-equity
    //     holdings, so each `extPrice` can be validated against the
    //     real pre/post bars the same way the chart modal does. The
    //     position cards used to lean on a ±5% quote-only heuristic
    //     that disagreed with the modal on genuine >5% AH moves (the
    //     CBRS card-vs-modal bug); this gives both the same verdict.
    //     Fetched whenever we're outside RTH regardless of toggle
    //     state — pre-populates `extPriceTrusted` so toggling ext on
    //     doesn't have to fall back to the ±5% heuristic for the
    //     window before the next auto-refresh (the user explicitly
    //     asked the toggle to not trigger a refresh). When ext is
    //     off computeMetrics ignores the verdict anyway, so the
    //     extra fetch costs network but never affects display.
    const refreshPhase = usMarketPhase(new Date());
    const wantsExtSeries = refreshPhase !== "regular";
    const extHoldingTickers = wantsExtSeries
      ? Object.keys(portfolio.holdings).filter(
          (t) => t !== "CASH" && !portfolio.holdings[t]?.isCash && isUsEquity(t),
        )
      : [];
    const [{ updates, source: src }, mcResult, todayCloses, extSeries, t212Holdings] = await Promise.all([
      refreshPrices(portfolio, "live"),
      fetchTickers(MC_TICKERS),
      fetchTodayRegularClose(MC_TICKERS),
      extHoldingTickers.length > 0
        ? fetchHistoricalBatch(extHoldingTickers, "1d", "5m", true).catch(() => ({}))
        : Promise.resolve({}),
      // Trading 212 sync. Server-cached at 30 s (in lockstep with the
      // regular-hours auto-refresh) and gated by an atomic Postgres
      // claim so multi-device refreshes share a single upstream call —
      // at most one T212 hit per 30 s window, within T212's
      // 1-req-per-30-s limit. Returns `{ holdings, prices }` (or null
      // when the key/secret aren't configured / upstream errored):
      // `holdings` drives the VUAA.L / SAEM.L shares-cost auto-sync,
      // `prices` feeds the overnight US-equity quote overlay below.
      fetchTrading212Holdings(),
    ]);
    if (mcResult) {
      for (const [t, c] of Object.entries(todayCloses || {})) {
        if (mcResult[t]) mcResult[t].todayRegularClose = c;
      }
      setMarketData(mcResult);
      setMarketDataReady(true);
      // Persist this tick's FX rates so the next cold start can seed
      // marketData with them instead of falling back to 1:1.
      Storage.saveMarketCache(mcResult);
    }
    setSource(src);
    // Open/close minutes for the ext-hours verdict below — computed
    // once per refresh, not per holding.
    const extMh = usMarketHoursUtc(new Date());
    const extOpenMins  = extMh.openHh  * 60 + extMh.openMm;
    const extCloseMins = extMh.closeHh * 60 + extMh.closeMm;
    setPortfolio(prev => {
      if (!prev) return prev;
      const next = { ...prev, holdings: { ...prev.holdings } };
      const flashes = {};
      for (const [t, u] of Object.entries(updates)) {
        if (!next.holdings[t]) continue;
        const old = next.holdings[t].lastPrice;
        const oldExt = next.holdings[t].extPrice ?? null;
        // Respect the Edge response's `extPrice` verbatim — including
        // an explicit null. The previous `?? prev` fallback was
        // intended for the case where a refresh tick briefly omitted
        // the field, but Edge always populates it (number | null per
        // the PriceResult type), so the fallback only ever served to
        // keep a STALE extPrice alive when Edge correctly told us to
        // clear it (e.g. an LSE ticker after the prices fix below).
        const extPriceVal = u.extPrice ?? null;
        // Real-AH verdict from the intraday series fetched above —
        // the same check the chart modal runs, so the position card
        // and the modal agree. Computed whenever the series is
        // available, regardless of toggle state, so toggling ext on
        // doesn't have to wait for the next auto-refresh to revalidate
        // — computeMetrics ignores the verdict when ext is off. null
        // when no series (regular hours or fetch failed), so the
        // metrics layer falls back to the lightweight ±5% quote
        // heuristic.
        const extSer = extSeries[t];
        const extPriceTrusted = (Array.isArray(extSer) && extSer.length > 0)
          ? extPriceIsRealAh(extSer, extPriceVal, extOpenMins, extCloseMins)
          : null;
        next.holdings[t] = {
          ...next.holdings[t],
          lastPrice: u.lastPrice,
          extPrice: extPriceVal,
          prevClose: u.prevClose ?? next.holdings[t].prevClose,
          dayPct: u.dayPct ?? next.holdings[t].dayPct,
          // Mirror the extPriceVal logic above: Edge response is the
          // source of truth, no stale fallback.
          extDayPct: (u.extPrice != null && u.lastPrice > 0) ? ((u.extPrice - u.lastPrice) / u.lastPrice) * 100 : null,
          extPriceTrusted,
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
      // Trading 212 overlays — both run AFTER the live-prices merge so
      // they see the Yahoo lastPrice/prevClose just set.
      //   1. Holdings auto-sync: shares/cost/lots for the allow-list
      //      ETFs (VUAA.L, SAEM.L). Price untouched — these LSE ETFs
      //      keep the Yahoo quote.
      //   2. Overnight price: only during the overnight window
      //      (20:00–04:00 ET) with the Extended Hours toggle on, swap
      //      in T212's `currentPrice` as the extended-hours quote for
      //      any US equity the user also holds in T212. Regular / pre /
      //      after-hours keep the original Yahoo logic untouched.
      // When the API key isn't set or the upstream errored,
      // t212Holdings is null → both calls no-op.
      applyTrading212(next.holdings, t212Holdings?.holdings);
      // Apply T212's overnight price into holdings.extPrice whenever
      // it's the overnight window — NOT gated on the Extended Hours
      // toggle. Mirrors the Yahoo extPrice / extSeries fetch above
      // (see the `wantsExtSeries = refreshPhase !== "regular"`
      // comment): the data is pre-populated regardless of the toggle
      // so flipping ext ON shows the overnight price instantly
      // instead of stale lastPrice until the user manually hits
      // Refresh. computeMetrics ignores extPrice when the toggle is
      // off (`trustExt = ext && …`), so writing it unconditionally is
      // inert until the toggle flips. The previous `&& extendedHours`
      // gate was the bug behind "open during ext hours, toggle on,
      // scoreboard + cards + pitch all stay stale until I Refresh —
      // and re-entering the page repeats it": every load resets the
      // toggle to off, so the mount refresh ran with nightActive=false
      // and never wrote the night price.
      const nightActive = refreshPhase === 'overnight';
      applyTrading212NightPrice(next.holdings, t212Holdings?.prices, nightActive);
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
          mcTickers: MC_PREFETCH_TICKERS,
          spSymbol: sp,
          extendedHours,
          phase: phaseNow,
        });
        // Outside the regular session, ALSO pre-warm the opposite
        // ext-toggle state's 1D cache so flipping the Extended Hours
        // switch is a cache hit instead of a 1-2 s cold fetch. The
        // 1D cache key includes `useExt`, so this writes to a
        // distinct row from the call above; harmless during regular
        // hours (toggle is a no-op then) so we skip the second call.
        if (phaseNow !== "regular") {
          const altSp = !extendedHours ? "ES=F" : "^GSPC";
          prefetchAllChartData({
            tickers: tickerList,
            mcTickers: MC_PREFETCH_TICKERS,
            spSymbol: altSp,
            extendedHours: !extendedHours,
            phase: phaseNow,
          });
        }
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
    // Initial mount triggers prefetch (default). Subsequent ticks skip
    // it — TTLs run in minutes/hours so the auto-refresh would re-fetch
    // chart data with no fresh bars to show. The user's explicit
    // Refresh click also triggers prefetch (it goes through doRefresh
    // directly, with the synthetic React event arg which is truthy but
    // not { prefetch: false } so the default applies).
    //
    // Self-rearming setTimeout (not setInterval) so the cadence can
    // adapt to the market phase each cycle — 30 s during the trading
    // day, 5 min through the overnight / weekend dead window. Tick at
    // the current phase's interval; phase transitions take effect on
    // the next tick (good enough; no precise edge-trigger needed).
    doRefreshRef.current();
    // Pre-warm the OPPOSITE extended-hours state's chart cache so the
    // toggle is a cache-hit instead of a 1-2 s cold fetch. The 1D
    // cache key carries a `reg` / `ext` variant tag (the fetched
    // window differs by includePrePost), so without this the user
    // had to hit Refresh after every toggle. The initial doRefresh
    // above already covered the current state; this covers the other.
    // Fire-and-forget; the prefetch short-circuits any range whose
    // cache is already fresh.
    {
      const oppPhase = usMarketPhase(new Date());
      const oppTickers = Object.keys(portfolio.holdings)
        .filter((t) => t !== "CASH" && !portfolio.holdings[t]?.isCash);
      const oppSp = (!extendedHours && oppPhase !== "regular") ? "ES=F" : "^GSPC";
      prefetchAllChartData({
        tickers: oppTickers,
        mcTickers: MC_PREFETCH_TICKERS,
        spSymbol: oppSp,
        extendedHours: !extendedHours,
        phase: oppPhase,
      });
    }
    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;
    // Track the wall-clock of the last completed refresh so the
    // visibility-resume path can decide whether a catch-up fetch is
    // actually warranted (returning to the tab 3 s after backgrounding
    // shouldn't fire a redundant call).
    let lastRefreshMs = Date.now();
    const schedule = () => {
      if (cancelled) return;
      // Re-evaluated each tick so the cadence flips automatically at the
      // Fri 20:00 / Sun 20:00 ET weekend-dead-zone boundaries.
      const intervalMs = isWeekendDeadZone(new Date()) ? REFRESH_MS_WEEKEND : REFRESH_MS;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        // Skip the network round-trip while the tab is backgrounded /
        // the phone is locked — keep re-arming so the cadence is intact
        // the instant the user returns, but don't burn battery / Edge
        // Function quota / the T212 rate-limit window polling a screen
        // nobody's looking at. The visibilitychange handler below fires
        // an immediate catch-up when the tab becomes visible again.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          schedule();
          return;
        }
        doRefreshRef.current({ prefetch: false });
        lastRefreshMs = Date.now();
        schedule();
      }, intervalMs);
    };
    // Catch-up on return-to-foreground: if the tab was hidden long
    // enough that the data is now staler than one refresh interval,
    // fetch immediately instead of making the user wait up to 30 s
    // (or 5 min in the weekend dead zone) for the next scheduled tick.
    const onVisibility = () => {
      if (cancelled) return;
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      const intervalMs = isWeekendDeadZone(new Date()) ? REFRESH_MS_WEEKEND : REFRESH_MS;
      if (Date.now() - lastRefreshMs >= intervalMs) {
        doRefreshRef.current({ prefetch: false });
        lastRefreshMs = Date.now();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    schedule();
    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [portfolio !== null]);

  // Never substitute extended-hours prices during the regular session — the
  // toggle only takes effect outside RTH so the displayed value stays consistent.
  // Computed before the loading early-return below so the FX-reporting
  // useEffect that watches `metrics.fxMissingTickers` runs every render
  // — hooks must appear in the same order on first load (portfolio
  // null) and post-load (portfolio populated), otherwise React throws
  // "Rendered more hooks than during the previous render".
  const currentPhase = usMarketPhase(new Date());
  // Memoize the metrics compute so it only re-runs when one of its
  // actual inputs changes — NOT on every render. The Board re-renders
  // on each refresh tick for peripheral reasons (isRefreshing flip,
  // lastUpdated clock, recentlyUpdated flash, flashTickers) on top of
  // the actual data change; without the memo, computeMetrics ran the
  // full portfolio aggregate on every one of those. `currentPhase` is
  // a stable string within a market phase so it doesn't defeat the
  // memo; `marketData` is a fresh object only on a real price tick, so
  // the memo recomputes exactly when prices move and not otherwise.
  const metrics = useMemo(
    () => (portfolio
      ? computeMetrics(portfolio, { extended: extendedHours && currentPhase !== "regular", marketData })
      : null),
    [portfolio, extendedHours, currentPhase, marketData],
  );
  // Stable handler for the Heatmap's tile click — useCallback so the
  // Heatmap's React.memo (heatmap.jsx) isn't defeated by a fresh
  // closure each Board render. Declared here (above the loading
  // early-return) so its hook slot is unconditional. In edit mode the
  // heatmap doubles as a per-ticker shortcut into EditTickerModal
  // (same as a Pitch chip); otherwise it opens the chart modal.
  // Heatmap filters CASH out itself, so no isCash guard needed.
  const handleTileClick = useCallback((t) => {
    if (editMode && !isReadOnly) setEditingTicker(t);
    else setViewingTicker(t);
  }, [editMode, isReadOnly]);

  // FX-rate-missing is already surfaced by the red "FX MISSING N
  // tickers" pill in the header (see Header.jsx, populated from
  // metrics.fxMissingTickers). The user sees a missed FX pair
  // immediately, so the previous ops-error reporter just duplicated
  // a signal already visible to the user — 6+ noise rows per (kind,
  // symbol) on every chronic outage. The header badge stays as the
  // sole surface; any sustained outage is one click of Refresh away
  // from re-resolving, which is the action the badge title spells
  // out anyway.

  if (!portfolio || !metrics) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1310' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#aaa', fontFamily: 'monospace', letterSpacing: '0.2em', fontSize: '12px', marginBottom: '8px' }}>LOADING…</div>
          <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '11px' }}>Fetching board from cloud.</div>
        </div>
      </div>
    );
  }

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
      const existing = p.holdings[ticker];
      const newLast = Number(lastPrice) || Number(cost) || 0;
      // `.PVT` holdings are never price-refreshed (the prices Edge
      // Function skips them), so this re-add is their only price-update
      // path. Carry the OLD price into `prevClose` when the price
      // actually changes, so the day change shows (today's price vs the
      // previous update) instead of a flat 0 — the behaviour the user
      // wants for SPAX.PVT, which they revalue daily. New holdings (no
      // prior) seed prevClose = newLast → 0 % on day one. Fetched
      // tickers ignore this seed (the next refresh overwrites prevClose).
      const prevClose = (ticker.endsWith('.PVT')
          && existing && typeof existing.lastPrice === 'number'
          && existing.lastPrice > 0 && existing.lastPrice !== newLast)
        ? existing.lastPrice
        : newLast;
      const holdings = {
        ...p.holdings,
        [ticker]: {
          shares: Number(shares) || 0,
          cost: Number(cost) || 0,
          lastPrice: newLast,
          prevClose,
          dayPct: prevClose > 0 ? ((newLast - prevClose) / prevClose) * 100 : 0,
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
  const updatePosition = guard((posKey, patch) => {
    setPortfolio(p => ({ ...p, positions: { ...p.positions, [posKey]: { ...p.positions[posKey], ...patch } } }));
  });

  // Demo-data banner — shown when loadPortfolioRemote fell back to the
  // seeded INITIAL_PORTFOLIO (no row in Supabase yet, or the load
  // failed). Two paths out:
  //   Reset to empty: replace each position's tickers with [] (GK
  //     keeps CASH), holdings → just CASH. Saves immediately.
  //   Keep these: clears the _isDemo flag, save effect resumes; the
  //     demo positions become the user's portfolio on the next edit.
  // Both clear `_isDemo`, which unblocks the save effect.
  const onResetDemo = () => {
    if (!window.confirm("Reset to an empty board? The demo positions will be replaced with a blank pitch (just the Cash slot kept).")) return;
    setPortfolio((p) => {
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        positions[k] = { ...pos, tickers: k === 'GK' ? ['CASH'] : [] };
      }
      const next = {
        positions,
        holdings: {
          CASH: { shares: 1, cost: 0, lastPrice: 0, prevClose: 0, dayPct: 0, isCash: true, currency: 'USD' },
        },
      };
      return next; // _isDemo dropped
    });
  };
  const onKeepDemo = () => {
    setPortfolio((p) => {
      const next = { ...p };
      delete next._isDemo;
      return next;
    });
  };

  return (
    <div className="app">
      {portfolio?._isDemo && !isReadOnly && (
        <div className="demo-banner">
          <span className="demo-banner-msg mono">
            DEMO DATA — these are seeded example positions, not your portfolio yet.
          </span>
          <button className="demo-banner-btn primary" onClick={onResetDemo}>Reset to empty</button>
          <button className="demo-banner-btn" onClick={onKeepDemo}>Keep these</button>
        </div>
      )}
      {saveConflict && !isReadOnly && (
        <div className="demo-banner">
          <span className="demo-banner-msg mono">
            CONFLICT — another tab or device saved newer changes. Reload to see them (your current in-tab edits will be discarded).
          </span>
          <button
            className="demo-banner-btn primary"
            onClick={() => { try { sessionStorage.removeItem(PENDING_SAVE_KEY); } catch { /* ignore */ } window.location.reload(); }}
          >Reload</button>
          <button className="demo-banner-btn" onClick={() => setSaveConflict(false)}>Keep editing</button>
        </div>
      )}
      <Header
        metrics={metrics}
        marketData={marketData}
        marketDataReady={marketDataReady}
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
          {isDesktop && (
            <MarketConditions
              marketData={marketData}
              extendedHours={extendedHours}
              phase={currentPhase}
              onCardClick={setViewingTicker}
            />
          )}
          {isDesktop && <UpcomingEarnings portfolio={portfolio} />}
        </div>
        {viewMode === 'heatmap' ? (
          <Heatmap
            metrics={metrics}
            extendedHours={extendedHours && currentPhase !== "regular"}
            onTileClick={handleTileClick}
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
            which is display:none on mobile. matchMedia-gated so it
            doesn't mount/render at all on desktop. */}
        {!isDesktop && (
          <MarketConditions
            marketData={marketData}
            extendedHours={extendedHours}
            phase={currentPhase}
            className="market-conditions-mobile"
            onCardClick={setViewingTicker}
          />
        )}
        {!isDesktop && <UpcomingEarnings portfolio={portfolio} className="earnings-panel-mobile" />}
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

      {viewingTicker && (
        <TickerChartModal
          ticker={viewingTicker}
          holding={portfolio.holdings[viewingTicker] ?? null}
          marketData={marketData}
          extendedHours={extendedHours}
          phase={currentPhase}
          portfolioTotalValue={metrics.marketValue}
          hideValues={hideValues}
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
