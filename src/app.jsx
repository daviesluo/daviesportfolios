// Main portfolio tactics board app
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fmtMoney, fmtPct, fmtPrice, pctColor } from './formatters.js';
import { fxToUSD } from './fx.js';
import { netDepositNow } from './ytd.js';
import { saveSnapshot, SNAPSHOT_INTERVAL_MS } from './portfolio_snapshots.js';
import { createPortfolioEditHandlers } from './portfolio_edits.js';
import { computeMetrics, detectFormation } from './metrics.js';
import { refreshPrices, fetchTickers } from './yahoo_fetch.js';
import { fetchTodayRegularClose, fetchHistoricalBatch } from './historical.js';
import { usMarketPhase, usMarketHoursUtc, isWeekendDeadZone } from './market_hours.js';
import { Storage } from './storage.js';
import { POSITION_COORDS } from './positions.js';
import { INITIAL_PORTFOLIO } from './data.js';
import { consumeUrlPassword, decodeAppToken, getAppToken, authenticate } from './auth.js';
import { loadPortfolioRemote, savePortfolioRemote, portfolioUserFingerprint, PORTFOLIO_BROADCAST_CHANNEL, TAB_ID } from './portfolio_remote.js';
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
  useConfirm,
} from './modals.jsx';
import { TickerChartModal } from './ticker_chart_modal.jsx';
import { HoldingsListModal } from './holdings_list.jsx';
import { SectorsListModal } from './sectors_list.jsx';
import { TransactionHistoryModal } from './transaction_history.jsx';
import { ServiceWorkerBanner } from './sw-banner.jsx';
import { reportError } from './ops_error.js';
import { extPriceIsRealAh } from './indicators.js';
import { isUsEquity } from './ticker_class.js';
import { fetchTrading212Holdings, fetchTrading212Orders, syncTrading212Orders, applyTrading212, applyTrading212NightPrice } from './trading212.js';
import { fetchOvernightSeries } from './overnight_intraday.js';

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

// USDCNY=X / USDHKD=X / EURUSD=X are hidden FX fetches used only for
// holding currency→USD conversion (not shown in the market-conditions
// column). GBPUSD=X doubles as both a displayed card and the rate we use
// to convert GBP holdings to USD.
const MC_TICKERS = ["^GSPC", "^NDX", "^RUT", "^SOX", "^VIX", "BZ=F", "^TNX", "GBPUSD=X", "GBPCNY=X", "USDCNY=X", "USDHKD=X", "EURUSD=X", "ES=F", "NQ=F", "RTY=F"];
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
const MC_PREFETCH_TICKERS = ["^GSPC", "^NDX", "^RUT", "^SOX", "^VIX", "BZ=F", "^TNX", "GBPUSD=X", "GBPCNY=X", "USDCNY=X", "USDHKD=X", "EURUSD=X", "ES=F", "NQ=F", "RTY=F"];

// Themed in-page password screen — replaces the old `window.prompt` over a
// blank page (unstyled, off-theme, especially clunky in the iOS PWA). Same
// dark monospace look as the AUTHENTICATING / ACCESS DENIED screens.
// Autofocuses the field; Enter or the button submits the typed password.
function PasswordPrompt({ onSubmit }) {
  const [pw, setPw] = useState('');
  /** @type {React.CSSProperties} */
  const screen = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1310' };
  /** @type {React.CSSProperties} */
  const card = { display: 'flex', flexDirection: 'column', gap: '13px', width: '258px', padding: '34px 30px', border: '1px solid #2a2a2a', borderRadius: '4px' };
  return (
    <div style={screen}>
      <form style={card} onSubmit={(e) => { e.preventDefault(); if (pw) onSubmit(pw); }}>
        <div style={{ color: '#ccc', fontFamily: 'monospace', letterSpacing: '0.18em', fontSize: '13px', textAlign: 'center' }}>DAVIES&rsquo; PORTFOLIOS</div>
        <div style={{ color: '#666', fontFamily: 'monospace', fontSize: '11px', textAlign: 'center', marginBottom: '3px' }}>Enter password to continue</div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          style={{ background: '#0f1815', color: '#eee', border: '1px solid #2a3a33', borderRadius: '3px', padding: '9px 11px', fontFamily: 'monospace', fontSize: '13px', outline: 'none' }}
        />
        <button
          type="submit"
          disabled={!pw}
          style={{ background: pw ? '#1e3a30' : '#16211d', color: pw ? '#dfe9e4' : '#4a5a52', border: '1px solid #2e4a3e', borderRadius: '3px', padding: '9px', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.1em', cursor: pw ? 'pointer' : 'default' }}
        >ENTER</button>
      </form>
    </div>
  );
}

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
    // Consume + strip any ?pwd= either way so it never lingers in history.
    const urlPwd = consumeUrlPassword();
    if (existing) {
      return { pwInput: null, initialAuth: { isReadOnly: existing.role === "ro" } };
    }
    // No token: authenticate the URL pwd if it was present, else null —
    // which renders the themed password form, whose submit sets pwInput.
    return { pwInput: urlPwd, initialAuth: undefined };
  });
  // pwInput is state now (was derived): the in-page password form sets it.
  const [pwInput, setPwInput] = useState(bootState.pwInput);
  const [auth, setAuth] = useState(/** @type {import('./types').AppAuth | undefined} */ (bootState.initialAuth));

  useEffect(() => {
    if (auth !== undefined) return;            // already authed via existing token
    if (pwInput == null) return;               // no password yet — waiting for the form
    let cancelled = false;
    authenticate(pwInput)
      .then(result => { if (!cancelled) setAuth(result); })
      // A rejection (network blip on the auth call) shouldn't leave the UI
      // stuck on AUTHENTICATING forever — fall through to ACCESS DENIED.
      .catch(() => { if (!cancelled) setAuth(null); });
    return () => { cancelled = true; };
  }, [pwInput, auth]);

  // No token, no URL password, nothing typed yet → themed login form.
  if (auth === undefined && pwInput == null) {
    return <PasswordPrompt onSubmit={(pw) => setPwInput(pw)} />;
  }

  if (auth === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1310' }}>
        <div style={{ color: '#888', fontFamily: 'monospace', letterSpacing: '0.2em', fontSize: '12px' }}>AUTHENTICATING…</div>
      </div>
    );
  }

  if (auth && auth.locked) {
    const hoursLeft = Math.ceil(((auth.lockUntil ?? 0) - Date.now()) / 1000 / 60 / 60);
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
          <button style={{ background: '#1e2d28', color: '#ccc', border: '1px solid #3a3a3a', padding: '8px 20px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', borderRadius: '2px' }} onClick={() => { setAuth(undefined); setPwInput(null); }}>Try again</button>
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
  // Themed confirm dialog (replaces window.confirm for destructive actions
  // — reset board / remove holding). confirmEl is rendered near the other
  // modals below; it portals to <body>.
  const { confirm: askConfirm, element: confirmEl } = useConfirm();
  // Seed with the last-known full portfolio (Storage.loadPortfolioCache —
  // written after every successful load/save) so first paint shows the
  // user's real board instantly instead of a blank "Fetching board from
  // cloud." screen. Returns null when there's no usable cache (first-ever
  // visit, private browsing, cache older than 30 days, or a seeded demo
  // row — savePortfolioCache never persists one), so that case is
  // byte-for-byte today's "still loading" behaviour. The mount effect
  // below's loadPortfolioRemote() call ALWAYS runs regardless and
  // overwrites this the moment it resolves — this is a pre-render seed,
  // never a substitute for the real fetch.
  const [portfolio, setPortfolio] = useState(() => Storage.loadPortfolioCache());      // null = still loading
  const [drillPos, setDrillPos] = useState(/** @type {string | null} */ (null));
  const [editMode, setEditMode] = useState(false);
  const [editingTicker, setEditingTicker] = useState(/** @type {string | null} */ (null));
  const [viewingTicker, setViewingTicker] = useState(/** @type {string | null} */ (null));
  const [showHoldingsList, setShowHoldingsList] = useState(false);
  const [showSectorsList, setShowSectorsList] = useState(false);
  const [showTransactionHistory, setShowTransactionHistory] = useState(false);
  const [addingToPos, setAddingToPos] = useState(/** @type {string | null} */ (null));
  const [editingCash, setEditingCash] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(/** @type {Date | null} */ (null));
  const [source, setSource] = useState("—");
  // Holdings that actually got a quote on the last tick — shown in the
  // sidebar footer so a board full of 0.00 % can be told apart from a
  // fetch that quietly came back nearly empty.
  const [quoteCoverage, setQuoteCoverage] = useState(/** @type {{got:number,wanted:number}|null} */ (null));
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
      || addingToPos != null || editingCash || showHoldingsList
      || showSectorsList || showTransactionHistory;
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
  }, [isReadOnly, drillPos, editingTicker, viewingTicker, addingToPos, editingCash, showHoldingsList, showSectorsList, showTransactionHistory]);

  // True once the REAL loadPortfolioRemote() reply has landed (demo or
  // not) — as opposed to `portfolio` merely being non-null because the
  // cache-primed useState initializer above seeded it. The debounced
  // auto-save effect below reads this to stay a no-op until the
  // authoritative server answer is in, so it can never fingerprint-seed,
  // replay a pending draft, or save against the optimistic cached
  // snapshot — only ever against the same real data it always ran
  // against before the cache-priming existed.
  const hasRealLoadRef = useRef(false);
  // Was `portfolio` already non-null on the very first render (i.e. did
  // the cache-primed useState initializer seed it)? Captured once — a
  // ref's initial-value expression only takes effect on first render.
  // Read by the mount-load effect below to decide whether it needs to
  // force an extra doRefresh once the real data lands (see that
  // effect's comment for why the refresh-loop effect alone can't be
  // relied on to do this in the cache-primed case).
  const hadCachedPortfolioRef = useRef(portfolio !== null);
  // Bumped once (by the mount-load effect below) when the real load lands
  // AFTER a cache-primed first paint — a plain boolean-style trigger for
  // the effect declared right after doRefreshRef's sync effect (see that
  // effect's comment). Not consumed anywhere else.
  const [realLoadArrived, setRealLoadArrived] = useState(false);
  // Initial load from Supabase (never throws — falls back to INITIAL_PORTFOLIO on any error)
  useEffect(() => {
    let cancelled = false;
    loadPortfolioRemote().then(p => {
      if (cancelled) return;
      // A genuine load failure (or a truly-empty server row) resolves to
      // the seeded demo portfolio. If a real, cache-primed portfolio is
      // already on screen, keep showing it rather than replacing actual
      // (if briefly stale) holdings with someone else's demo book — the
      // DemoBanner only makes sense when there was nothing better to
      // show in the first place. Bail out BEFORE opening the save gate
      // in that case: this failed load never touched portfolio_remote's
      // `lastKnownVersion`, so a save from here would skip the If-Match
      // check and could silently clobber newer data written by another
      // device (Codex #201 P1) — the cached portfolio stays read-only
      // until a real load actually succeeds.
      if (p && p._isDemo && hadCachedPortfolioRef.current) return;
      hasRealLoadRef.current = true;
      setPortfolio(p);
      // The refresh-loop effect below keys off `[portfolio !== null]` —
      // a stable BOOLEAN, deliberately, so a fresh portfolio object from
      // every 30 s price tick doesn't re-fire the whole effect (cancel +
      // reschedule the timer, re-run doRefresh) on every single refresh.
      // But that means when the cache-primed initializer already made
      // `portfolio !== null` true on the very first render, the boolean
      // never FLIPS once this real load lands — so the refresh-loop
      // effect won't automatically notice and re-run doRefresh against
      // the just-loaded real holdings. Without this, any ticker only
      // present in the real data (e.g. edited from another device since
      // the cache was written) wouldn't get a live price until the next
      // 30 s auto-tick. Firing it explicitly here closes that gap.
      if (hadCachedPortfolioRef.current) setRealLoadArrived(true);
    });
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
  const lastSavedFingerprintRef = useRef(/** @type {string | null} */ (null));
  // Fire-and-forget UI timers (flash clear, recently-updated reset,
  // error-retry). Tracked in refs so a refresh that lands inside the
  // previous timer's window clears it first (no stacking / premature
  // clears), and so none of them fire a setState after unmount. The
  // effect below clears whatever is pending when the Board unmounts.
  /** @type {React.MutableRefObject<ReturnType<typeof setTimeout> | null>} */
  const flashTimerRef = useRef(null);
  /** @type {React.MutableRefObject<ReturnType<typeof setTimeout> | null>} */
  const recentTimerRef = useRef(null);
  /** @type {React.MutableRefObject<ReturnType<typeof setTimeout> | null>} */
  const errorRetryTimerRef = useRef(null);
  // Cache of the MC tickers' "today's 16:00-ET close" (the ext-on anchor).
  // fetchTodayRegularClose pulls 5d/5m bars for all 15 MC symbols — a big
  // egress hit — yet the value only changes once a day at 16:00 ET. So we
  // fetch it at most every 30 min (and only outside the regular session,
  // where it's the ext-on anchor — preloaded regardless of the toggle so
  // flipping ext on is instant), then reuse the cached map on the
  // in-between ticks.
  /** @type {React.MutableRefObject<{ ts: number, data: Record<string, number> }>} */
  const todayClosesRef = useRef({ ts: 0, data: {} });
  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
    if (errorRetryTimerRef.current) clearTimeout(errorRetryTimerRef.current);
  }, []);
  useEffect(() => {
    if (!portfolio) return;
    // Stay a no-op until the REAL loadPortfolioRemote() reply has
    // landed — see hasRealLoadRef's own comment. Without this, a
    // cache-primed cold start would fingerprint-seed (and replay any
    // pending sessionStorage draft) against the optimistic snapshot
    // instead of the server's authoritative copy, and could read a
    // change made from another device after the cache was written as
    // a spurious "local edit" once the real load lands and diverges.
    if (!hasRealLoadRef.current) return;
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
      // Ignore our OWN save broadcast. BroadcastChannel delivers a
      // tab's post to its other channel objects (the listener here is a
      // different object than savePortfolioRemote's poster), so without
      // this guard the saving tab reloads from the server right after
      // saving — and an edit made during that round-trip gets clobbered
      // by the one-behind server copy. Other tabs (different TAB_ID)
      // still reload to stay in sync.
      if (e?.data?.sender === TAB_ID) return;
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
    // try/finally so the spinner is always cleared — even if one of the
    // awaited fetches below were to reject (they return error sentinels
    // today, but a future throw shouldn't strand isRefreshing=true and
    // wedge the Refresh button). Body indentation left as-is to keep
    // this a minimal, reviewable diff.
    try {
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
    // Overnight intraday line — warm the server-recorded 5-min points
    // for the US-equity holdings BEFORE setLastUpdated fires, so by
    // the time the user sees "Last updated" the cache is hot and the
    // chart modal splices in a real overnight LINE the instant it
    // opens. Fired here so it runs in parallel with the price / MC /
    // chart-series fetches below, then explicitly AWAITED after the
    // main Promise.all (not part of the destructure — its return value
    // isn't used here) so refresh doesn't claim "done" until the cache
    // write has landed. Previously this was fire-and-forget: refresh
    // completed first, the fetch was still in flight, and a user who
    // clicked a tile in those next few seconds saw the dot → line
    // flash. `extHoldingTickers` is a superset of the modal's
    // `hasOvernightSession` set, so coverage is complete; on every
    // overnight refresh (incl. the 30 s auto-tick) any open modal's
    // line stays live via OVERNIGHT_FETCH_EVENT.
    const overnightPromise = (refreshPhase === 'overnight' && extHoldingTickers.length > 0)
      ? fetchOvernightSeries(extHoldingTickers).catch(() => null)
      : Promise.resolve(null);
    // Preload the MC "today's 16:00-ET close" anchor whenever we're
    // OUTSIDE the regular session — gated on phase, NOT on the Extended
    // Hours toggle (mirrors wantsExtSeries above). The toggle deliberately
    // doesn't trigger a refresh, so gating this fetch on `extendedHours`
    // left every MC card anchored to its own live price (a flat 0.00 %)
    // from the moment the user flipped ext on until the next 30 s tick
    // finally fetched the anchor. Phase-gating fetches it before the
    // toggle is ever touched, so ext-on shows real numbers immediately.
    // Still only outside RTH (its sole consumer is the ext-on anchor;
    // regular hours use prevClose), and the 30-min throttle keeps the
    // 5d/5m pull for 15 symbols off every tick.
    const wantTodayCloses = refreshPhase !== "regular"
      && (Date.now() - todayClosesRef.current.ts > 30 * 60 * 1000);
    const [{ updates, source: src, coverage }, mcResult, todayClosesFresh, extSeries, t212Holdings, t212Orders] = await Promise.all([
      refreshPrices(portfolio),
      fetchTickers(MC_TICKERS),
      wantTodayCloses ? fetchTodayRegularClose(MC_TICKERS) : Promise.resolve(null),
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
      // Executed-fill history, for real purchase dates on the synced
      // tickers. Cached client-side for ten minutes — the history is
      // immutable, so this costs nothing on the 30-second tick.
      fetchTrading212Orders(),
    ]);
    // Refresh the cache when we fetched this tick; otherwise reuse it. Apply
    // whichever map we have so the MC ext-on anchor stays populated even on
    // the throttled ticks.
    if (todayClosesFresh) todayClosesRef.current = { ts: Date.now(), data: todayClosesFresh };
    if (mcResult) {
      for (const [t, c] of Object.entries(todayClosesRef.current.data)) {
        if (mcResult[t]) mcResult[t].todayRegularClose = c;
      }
      setMarketData(mcResult);
      setMarketDataReady(true);
      // Persist this tick's FX rates so the next cold start can seed
      // marketData with them instead of falling back to 1:1.
      Storage.saveMarketCache(mcResult);
    }
    setSource(src);
    if (coverage) setQuoteCoverage(coverage);
    // Open/close minutes for the ext-hours verdict below — computed
    // once per refresh, not per holding.
    const extMh = usMarketHoursUtc(new Date());
    const extOpenMins  = extMh.openHh  * 60 + extMh.openMm;
    const extCloseMins = extMh.closeHh * 60 + extMh.closeMm;
    setPortfolio(prev => {
      if (!prev) return prev;
      const next = { ...prev, holdings: { ...prev.holdings } };
      for (const [t, u] of Object.entries(updates)) {
        if (!next.holdings[t]) continue;
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
      }
      // Trading 212 overlays — both run AFTER the live-prices merge so
      // they see the Yahoo lastPrice/prevClose just set.
      //   1. Holdings auto-sync: shares/cost/lots for the allow-list
      //      ETFs (VUAA.L, SAEM.L) — AND their regular-session price.
      //      These LSE ETFs sit on Yahoo's ~15-20 min-delayed free feed
      //      (stale right after the 08:00 UK open), so we take the
      //      broker's own live `currentPrice` (USD) as lastPrice, in
      //      lockstep with the shares, on every refresh. dayPct is
      //      recomputed against the just-set Yahoo prevClose so the tile
      //      % stays consistent.
      //   2. Overnight price: only during the overnight window
      //      (20:00–04:00 ET) with the Extended Hours toggle on, swap
      //      in T212's `currentPrice` as the extended-hours quote for
      //      any US equity the user also holds in T212. Regular / pre /
      //      after-hours keep the original Yahoo logic untouched.
      // When the API key isn't set or the upstream errored,
      // t212Holdings is null → both calls no-op.
      applyTrading212(next.holdings, t212Holdings?.holdings, t212Holdings?.prices, undefined, t212Orders);
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
      // ...but NOT during the weekend dead zone (Fri 20:00 → Sun 20:00 ET):
      // the 24/5 market is closed, so T212's quote is a frozen Friday-close
      // price. Don't overlay it as a live overnight quote — matches the
      // overnight-record cron, which also skips recording on weekends. The
      // overnight overlay (and the chart's night dot) resume at the Sun
      // 20:00 ET reopen.
      const nightActive = refreshPhase === 'overnight' && !isWeekendDeadZone(new Date());
      applyTrading212NightPrice(next.holdings, t212Holdings?.prices, nightActive);
      // Up/down flash — computed AFTER all overlays (Yahoo merge + both
      // T212 overlays) so a T212-priced allow-list ETF flashes on its real
      // broker-price move, not the spurious Yahoo-vs-T212 gap that comparing
      // against the in-loop Yahoo value would flash on every tick (Yahoo's
      // stale LSE quote ≠ the T212 lastPrice we store). Compares the
      // pre-refresh holding (prev) against the final one (next); ext price
      // wins as the reference when present (overnight US names), else
      // lastPrice. Untouched holdings share the prev ref → skipped.
      const flashes = {};
      for (const t of Object.keys(next.holdings)) {
        const oldH = prev.holdings[t];
        const newH = next.holdings[t];
        if (!oldH || !newH || oldH === newH) continue;
        const old = oldH.lastPrice;
        const oldExt = oldH.extPrice ?? null;
        const nw = newH.lastPrice;
        const newExt = newH.extPrice ?? null;
        const priceChanged = typeof nw === 'number' && typeof old === 'number' && Math.abs(nw - old) > 0.0001;
        const extChanged = newExt != null && oldExt != null && Math.abs(newExt - oldExt) > 0.0001;
        if (priceChanged || extChanged) {
          const newRef = newExt ?? nw;
          const oldRef = oldExt ?? old;
          flashes[t] = newRef > oldRef ? "up" : "down";
        }
      }
      if (Object.keys(flashes).length) {
        setFlashTickers(flashes);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlashTickers({}), 1200);
      }
      return next;
    });
    // Make sure the overnight cache write has landed before we mark
    // the refresh "done" — so a user who clicks a tile right after
    // "Last updated" appears sees the dotted overnight line already
    // spliced in instead of waiting on a still-in-flight fetch.
    await overnightPromise;
    setLastUpdated(new Date());
    if (src === "live") {
      setRecentlyUpdated(true);
      if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
      recentTimerRef.current = setTimeout(() => setRecentlyUpdated(false), 1600);
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
      if (errorRetryTimerRef.current) clearTimeout(errorRetryTimerRef.current);
      errorRetryTimerRef.current = setTimeout(() => doRefreshRef.current(), 3000);
    }
    } finally {
      // Always clear the spinner, success or throw.
      setIsRefreshing(false);
    }
  }, [portfolio, extendedHours]);

  const doRefreshRef = useRef(doRefresh);
  useEffect(() => { doRefreshRef.current = doRefresh; }, [doRefresh]);

  // Fires the "real load landed after a cache-primed first paint" extra
  // refresh queued by the mount-load effect above (see its comment).
  // Declared textually AFTER the doRefreshRef sync effect immediately
  // above so React runs them in that order within the same commit —
  // `setPortfolio(realData)` and `setRealLoadArrived(true)` land in the
  // same batch, so by the time THIS effect's callback runs, `doRefresh`
  // has already been recreated closing over the real portfolio (its own
  // `[portfolio, extendedHours]` deps changed) and the sync effect above
  // has already pointed `doRefreshRef.current` at it — calling
  // doRefreshRef.current?.() here (instead of directly in the mount-load
  // effect's .then()) is what guarantees that ordering; calling it
  // immediately in the .then() would still see the STALE
  // cache-portfolio-closing doRefresh, since setPortfolio doesn't apply
  // synchronously inside a promise callback.
  useEffect(() => {
    if (!realLoadArrived) return;
    doRefreshRef.current?.();
  }, [realLoadArrived]);

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
  // Latest metrics + net deposit for the 5-minute sampler below. Held in
  // a ref so the interval reads current numbers without being torn down
  // and re-armed on every price tick (which would reset its phase and
  // could starve the sample entirely on a busy board).
  const metricsRef = useRef(/** @type {{marketValue:number, netDeposit:number, fxMissing:boolean}|null} */ (null));
  metricsRef.current = metrics
    ? {
        marketValue: metrics.marketValue,
        netDeposit: netDepositNow({ portfolio, marketData, fxToUSD }),
        // A pair Yahoo didn't return means `fxRateToUSD` fell back to
        // 1:1 for that currency. Both figures above then convert a
        // non-USD holding at the wrong rate — and in the direction that
        // matters here, a CNY position at 1.0 instead of ~0.14 is SEVEN
        // TIMES its real size. Recording that writes a spike into a
        // permanent table which then "corrects" itself on the next tick,
        // which is exactly what a stray step in the deposit line is.
        fxMissing: (metrics.fxMissingTickers || []).length > 0,
      }
    : null;

  // The same two figures for the Investment Performance chart's right
  // edge, so its legend reads the scoreboard's PORTFOLIO rather than a
  // sample up to five minutes old. Held as primitives so the identity
  // only changes when the numbers do — the chart memoises on it. Null
  // while an FX pair is missing, for the same reason the sampler skips.
  const liveMV = metricsRef.current && !metricsRef.current.fxMissing ? metricsRef.current.marketValue : null;
  const liveND = metricsRef.current && !metricsRef.current.fxMissing ? metricsRef.current.netDeposit : null;
  const liveInvestment = useMemo(
    () => (liveMV != null && liveND != null && liveMV > 0 ? { marketValue: liveMV, netDeposit: liveND } : null),
    [liveMV, liveND],
  );

  // Trading 212 order-history backfill.
  //
  // The positions endpoint reports a POSITION with no dates, which is
  // why every synced ticker has carried a single synthetic lot whose
  // date could only ever be a guess. The history endpoint has the real
  // fills — but it's rate limited to a handful of calls a minute, so it
  // has to be walked a page at a time rather than pulled in one go.
  //
  // Self-completing: pages every 20 s until the server reports the walk
  // finished, then stops. `complete` latches server-side, so on every
  // later session this is a single request that tops up any new fills
  // and ends. Admin only — it writes, and it spends a rate-limited
  // upstream budget a read-only viewer has no business spending.
  useEffect(() => {
    if (isReadOnly) return undefined;
    let cancelled = false;
    let timer = /** @type {any} */ (null);
    const step = async () => {
      if (cancelled) return;
      const res = await syncTrading212Orders();
      if (cancelled || !res) return;
      const accounts = Array.isArray(res.accounts) ? res.accounts : [];
      // A key without T212's History scope authenticates fine and then
      // refuses this endpoint. No amount of retrying fixes that, so say
      // so once and stop rather than grinding against it every 20 s.
      const denied = accounts.filter((a) => a && a.scopeDenied);
      if (denied.length > 0) {
        reportError('t212.orders.scope', {
          message: 'Trading 212 API key lacks the History scope — regenerate it in '
            + 'Trading 212 with History enabled to backfill real purchase dates.',
          context: { accounts: denied.map((a) => a.account) },
        });
        return;
      }
      if (res.complete) return;
      timer = setTimeout(step, 20000);
    };
    // A beat after load so the backfill never competes with the first
    // paint or the opening price refresh.
    timer = setTimeout(step, 8000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [isReadOnly]);

  // Investment Performance sampler. Records the portfolio's USD value and
  // net deposited every 5 minutes so the chart has a real recorded series
  // for the tickers you no longer hold — a sold-out position leaves the
  // board and the app stops fetching its price history, so a truthful
  // past value would otherwise mean re-fetching history for every symbol
  // ever owned.
  //
  // Admin only (a read-only viewer must not write to the owner's book),
  // and skipped while the tab is hidden — a backgrounded phone has
  // nothing new to record and the next tick is only five minutes away.
  // Fire-and-forget: this is a background observation, never something
  // the user waits on, so a failure is dropped rather than retried.
  useEffect(() => {
    if (isReadOnly || !portfolio) return undefined;
    let cancelled = false;
    const sample = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const m = metricsRef.current;
      if (!m || !(m.marketValue > 0)) return;
      // Skip the tick entirely rather than record a figure converted at
      // a fallback 1:1 rate. The next tick is five minutes away and the
      // FX pair is usually back by then; a bad row, by contrast, is
      // permanent.
      if (m.fxMissing) return;
      saveSnapshot(m.marketValue, m.netDeposit);
    };
    // One immediately so a session that never lasts five minutes still
    // leaves a point behind, then on the interval.
    sample();
    const id = setInterval(sample, SNAPSHOT_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [isReadOnly, portfolio !== null]);

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

  // Derived board annotations — formation + the three "who's the
  // captain / hot mover" scans. Memoised so the per-tick refresh churn
  // (flash flips, the 1 Hz clock, isRefreshing) doesn't re-walk the
  // whole holdings map / positions on every render — the same reason
  // `metrics` above is memoised. Declared before the loading
  // early-return so the hook slots stay unconditional; each guards for
  // the null-portfolio / null-metrics case the early-return then
  // handles.
  const formation = useMemo(
    () => (portfolio ? detectFormation(portfolio) : null),
    [portfolio],
  );
  // Captain = single largest position by USD market value (native →
  // USD so a CNY / GBP holding ranks correctly against USD ones).
  const captainTicker = useMemo(() => {
    if (!portfolio) return null;
    let ticker = null, best = 0;
    for (const [t, h] of Object.entries(portfolio.holdings)) {
      const mv = h.shares * h.lastPrice * fxToUSD(h.currency, marketData);
      if (mv > best) { best = mv; ticker = t; }
    }
    return ticker;
  }, [portfolio, marketData]);
  // Biggest individual mover by the day-change AS DISPLAYED — the
  // ext-adjusted per-player pct from `metrics` (the same value the tiles /
  // scoreboard / Top Movers show), so during extended hours the ball tracks
  // the biggest AFTER-HOURS move, not the stale regular-session one. (The old
  // code ranked the ticker off the raw `h.dayPct`, which is always the regular
  // session.) Drives the ball's position + ticker label and the hot-badge in
  // the drill modals — and the two stay consistent because both come from the
  // single winning player.
  const { hotMoverTicker, hotMoverPosKey } = useMemo(() => {
    if (!metrics) return { hotMoverTicker: null, hotMoverPosKey: null };
    let ticker = null, posKey = null, best = 0;
    for (const [k, pos] of Object.entries(metrics.positions)) {
      for (const p of pos.players) {
        if (p.isCash || p.ticker === 'CASH') continue;
        const abs = Math.abs(p.dayPct ?? 0);
        if (abs > best) { best = abs; ticker = p.ticker; posKey = k; }
      }
    }
    return { hotMoverTicker: ticker, hotMoverPosKey: posKey };
  }, [metrics]);

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

  // Edit handlers — extracted to portfolio_edits.js (app.jsx was past
  // 1100 lines). Created per render, same as before: they close over
  // the stable `setPortfolio` and the current `isReadOnly` (each is a
  // no-op in read-only mode).
  const { updateHolding, removeHolding, swapPositions, moveHolding, addHolding, updatePosition } =
    createPortfolioEditHandlers({ setPortfolio, isReadOnly });

  // Demo-data banner — shown when loadPortfolioRemote fell back to the
  // seeded INITIAL_PORTFOLIO (no row in Supabase yet, or the load
  // failed). Two paths out:
  //   Reset to empty: replace each position's tickers with [] (GK
  //     keeps CASH), holdings → just CASH. Saves immediately.
  //   Keep these: clears the _isDemo flag, save effect resumes; the
  //     demo positions become the user's portfolio on the next edit.
  // Both clear `_isDemo`, which unblocks the save effect.
  const onResetDemo = async () => {
    if (!(await askConfirm({
      title: 'RESET BOARD',
      message: 'Reset to an empty board?',
      detail: 'The demo positions will be replaced with a blank pitch (just the Cash slot kept).',
      confirmLabel: 'Reset', danger: true,
    }))) return;
    setPortfolio((p) => {
      if (!p) return p;
      /** @type {Record<string, any>} */
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
      return /** @type {import('./types').Portfolio} */ (next); // _isDemo dropped
    });
  };
  const onKeepDemo = () => {
    setPortfolio((p) => {
      if (!p) return p;
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
        onOpenHoldingsList={() => setShowHoldingsList(true)}
        onOpenSectorsList={() => setShowSectorsList(true)}
        onOpenTransactionHistory={() => setShowTransactionHistory(true)}
      />

      <main className="main">
        <div className="left-col">
          <PerfPanel
            portfolio={portfolio}
            marketData={marketData}
            extendedHours={extendedHours}
            phase={currentPhase}
            className="perf-in-left"
            hideValues={hideValues}
            live={liveInvestment}
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
            onSwapPositions={swapPositions}
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
          coverage={quoteCoverage}
          live={liveInvestment}
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
        <SidebarFoot source={source} coverage={quoteCoverage} />
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
          onRemoveTicker={async (t) => { if (isReadOnly) return; if (await askConfirm({ title: 'REMOVE HOLDING', message: `Remove ${t}?`, confirmLabel: 'Remove', danger: true })) removeHolding(t); }}
          onUpdatePosition={(patch) => updatePosition(drillPos, patch)}
          hideValues={hideValues}
        />
      )}

      {/* Holdings list renders BEFORE the ticker modal so that when a
          symbol is tapped from the list, the ticker modal stacks ON
          TOP (later in the DOM wins at equal z-index) and the list
          stays mounted behind it — closing the ticker modal returns
          to the list, not all the way home. */}
      {showHoldingsList && (
        <HoldingsListModal
          metrics={metrics}
          hideValues={hideValues}
          onTickerClick={(t) => setViewingTicker(t)}
          onClose={() => setShowHoldingsList(false)}
        />
      )}

      {showSectorsList && (
        <SectorsListModal
          metrics={metrics}
          hideValues={hideValues}
          onTickerClick={(t) => setViewingTicker(t)}
          onClose={() => setShowSectorsList(false)}
        />
      )}

      {showTransactionHistory && (
        <TransactionHistoryModal
          holdings={portfolio.holdings}
          marketData={marketData}
          hideValues={hideValues}
          onClose={() => setShowTransactionHistory(false)}
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
          positions={portfolio.positions}
          onClose={() => setEditingTicker(null)}
          onSave={(patch) => { updateHolding(editingTicker, patch); setEditingTicker(null); }}
          onDelete={async () => { if (await askConfirm({ title: 'REMOVE HOLDING', message: `Remove ${editingTicker}?`, confirmLabel: 'Remove', danger: true })) { removeHolding(editingTicker); setEditingTicker(null); } }}
          onMove={(toPosKey) => { moveHolding(editingTicker, toPosKey); setEditingTicker(null); }}
        />
      )}

      {addingToPos && !isReadOnly && (
        <AddTickerModal
          posKey={addingToPos}
          position={portfolio.positions[addingToPos]}
          onClose={() => setAddingToPos(null)}
          onAdd={async (ticker, shares, cost, lastPrice, buyDate) => {
            const key = String(ticker || '').toUpperCase().trim();
            const existing = portfolio.holdings[key];
            // Re-adding a ticker you already hold is ambiguous — "I
            // bought more" vs "let me restate this position" — and the
            // old code silently picked restate, wiping every prior lot,
            // sell and the closed flag along with it. Ask instead.
            //
            // Three outcomes, not two: BOTH named actions write, so
            // Cancel / Esc / backdrop has to mean "do nothing". A binary
            // confirm would have had to fold those onto one of the
            // writes — and it folded them onto `replace`, the more
            // destructive one, so dismissing the dialog silently
            // restated the position.
            let mode = 'replace';
            if (existing) {
              const choice = await askConfirm({
                title: `${key} already in your book`,
                message: 'Record this as an additional purchase, or replace the existing position?',
                detail: 'Adding keeps every earlier lot and sell and recalculates your total shares and average cost. Replacing makes this the only buy lot; earlier sales stay on the ledger, so the position still nets against them.',
                confirmLabel: 'Add purchase',
                altLabel: 'Replace position',
                cancelLabel: 'Cancel',
              });
              // Dismissed — leave the book untouched AND leave the Add
              // dialog open so the entry isn't lost.
              if (choice === false) return;
              mode = choice === 'alt' ? 'replace' : 'append';
            }
            // `buyDate` matters: lots are the YTD chart's basis, so
            // dropping it silently dated every add today.
            addHolding(addingToPos, ticker, shares, cost, lastPrice, buyDate, mode);
            setAddingToPos(null);
          }}
        />
      )}

      {editingCash && !isReadOnly && (
        <CashModal
          amount={portfolio.holdings.CASH ? portfolio.holdings.CASH.lastPrice : 0}
          onClose={() => setEditingCash(false)}
          onSave={(amt) => {
            setPortfolio(p => {
              if (!p) return p;
              return {
                ...p,
                holdings: {
                  ...p.holdings,
                  CASH: { shares: 1, cost: amt, lastPrice: amt, prevClose: amt, dayPct: 0, isCash: true, currency: /** @type {const} */ ('USD') },
                },
                positions: {
                  ...p.positions,
                  GK: { ...p.positions.GK, tickers: ["CASH"] },
                },
              };
            });
            setEditingCash(false);
          }}
        />
      )}

      {/* Themed confirm dialog for reset-board / remove-holding — portals
          to <body> so it stacks above whatever modal triggered it. */}
      {confirmEl}
    </div>
  );
}

// Expose to window
export default App;
