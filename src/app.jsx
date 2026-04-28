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

// Catches any render-time crash and shows a readable error instead of a blank page.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
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

// Data access — proxied through the `data` Edge Function. The browser never
// sees the Supabase service-role key; every request carries the HMAC token
// the `auth` function issued at login. SB_ANON is still required by the
// Supabase Edge runtime for invocation auth, but it's separate from the
// app-level token that gates row access.
const SB_URL  = "https://flmvxigozjuizpckllvk.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsbXZ4aWdvemp1aXpwY2tsbHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODM3MjgsImV4cCI6MjA5MjM1OTcyOH0.vFqe6PNsPbVkg7NJmQJBsVECX1S58vAvv5MOjf63Xck";
const EDGE_AUTH_URL = `${SB_URL}/functions/v1/auth`;
const EDGE_DATA_URL = `${SB_URL}/functions/v1/data`;
const APP_TOKEN_KEY = "dp.token"; // sessionStorage — wiped on tab close

function getAppToken() { return sessionStorage.getItem(APP_TOKEN_KEY) || ""; }
function setAppToken(t) {
  if (t) sessionStorage.setItem(APP_TOKEN_KEY, t);
  else   sessionStorage.removeItem(APP_TOKEN_KEY);
}

function dataHeaders() {
  return {
    "apikey": SB_ANON,
    "Authorization": `Bearer ${SB_ANON}`,
    "X-App-Token": getAppToken(),
    "Content-Type": "application/json",
  };
}

async function loadPortfolioRemote() {
  try {
    const res = await fetch(`${EDGE_DATA_URL}?action=load`, { headers: dataHeaders() });
    if (!res.ok) {
      console.error("[data] load failed:", res.status, await res.text());
      return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
    }
    const { data } = await res.json();
    if (data) {
      const loaded = migrate(data);
      if (!loaded.holdings || Object.keys(loaded.holdings).length === 0) {
        return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
      }
      return loaded;
    }
    return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
  } catch (e) {
    console.error("[data] load error:", e);
    return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
  }
}

async function savePortfolioRemote(p) {
  if (!p || !p.holdings || Object.keys(p.holdings).length === 0) return;
  try {
    const res = await fetch(`${EDGE_DATA_URL}?action=save`, {
      method: "POST",
      headers: dataHeaders(),
      body: JSON.stringify(p),
    });
    if (!res.ok) console.error("[data] save failed:", res.status, await res.text());
  } catch (e) {
    console.error("[data] save error:", e);
  }
}

// Migrate old saved shapes to current schema.
function migrate(p) {
  if (!p || typeof p !== "object") return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
  if (!p.positions) p.positions = {};
  if (!p.holdings)  p.holdings  = {};
  // v1 → v2: split single "CB" into "CB1" + "CB2"
  if (p.positions.CB && !p.positions.CB1) {
    const old = p.positions.CB;
    const tickers = old.tickers || [];
    const mid = Math.ceil(tickers.length / 2);
    p.positions = {
      GK: p.positions.GK,
      CB1: { label: "Centerback", subtitle: old.subtitle || "", role: "DEF", tickers: tickers.slice(0, mid) },
      CB2: { label: "Centerback", subtitle: "", role: "DEF", tickers: tickers.slice(mid) },
      ...Object.fromEntries(Object.entries(p.positions).filter(([k]) => k !== "GK" && k !== "CB")),
    };
  }
  // v2 → v3 (BRK-B): move BRK-B from RB to CB2 and sync its shares/cost
  if (p.positions.RB?.tickers?.includes("BRK-B") && !(p.positions.CB2?.tickers || []).includes("BRK-B")) {
    p.positions.RB.tickers = p.positions.RB.tickers.filter(t => t !== "BRK-B");
    if (p.positions.CB2) p.positions.CB2.tickers = [...(p.positions.CB2.tickers || []), "BRK-B"];
    if (p.holdings["BRK-B"]) {
      if (p.holdings["BRK-B"].shares === 5)      p.holdings["BRK-B"].shares = 5.25;
      if (p.holdings["BRK-B"].cost   === 469.99) p.holdings["BRK-B"].cost   = 469.94;
    }
  }
  // Add snapshots array if missing
  if (!p.snapshots) p.snapshots = [];
  if (p.snapshots.length > 30) p.snapshots = p.snapshots.slice(-30);

  // Backfill currency on holdings that pre-date the multi-currency migration.
  // detectCurrency is purely ticker-pattern based, so this is safe to run on
  // every load without overwriting an explicitly-set currency.
  for (const [t, h] of Object.entries(p.holdings)) {
    if (h.currency || h.isCash || t === "CASH") continue;
    h.currency = detectCurrency(t);
  }

  // Backfill `lots` (per-purchase history) on any holding that's missing it
  // (legacy data from before the lot editor existed). Just stamps a single
  // lot dated 2025-01-01 with current shares + avg cost — the user can then
  // refine via the EditTickerModal lot editor. Lots are the source of truth
  // for the YTD chart, so post-migration nothing else should mutate them
  // outside that modal.
  for (const [t, h] of Object.entries(p.holdings)) {
    if (h.isCash || t === "CASH") continue;
    if (Array.isArray(h.lots) && h.lots.length > 0) continue;
    h.lots = [{ date: "2025-01-01", shares: h.shares, cost: h.cost }];
  }

  // v2 → v3: refresh labels + default subtitles from INITIAL_PORTFOLIO for untouched slots.
  const validKeys = new Set(Object.keys(INITIAL_PORTFOLIO.positions));
  for (const k of Object.keys(p.positions)) {
    if (!validKeys.has(k)) delete p.positions[k];
  }
  const LEGACY_SUBTITLES = new Set(["", "Cash reserves", "Growth", "Value", "Speculative"]);
  for (const [k, defaults] of Object.entries(INITIAL_PORTFOLIO.positions)) {
    const cur = p.positions[k];
    if (!cur) { p.positions[k] = JSON.parse(JSON.stringify(defaults)); continue; }
    if (!cur.label || cur.label.length > 4 || cur.label !== defaults.label) cur.label = defaults.label;
    if (cur.subtitle == null || LEGACY_SUBTITLES.has(cur.subtitle)) cur.subtitle = defaults.subtitle || "";
    if (!cur.role) cur.role = defaults.role;
  }
  return p;
}

// Auth gate --------------------------------------------------------------
// Two-stage flow. Synchronous part collects the password (URL ?pwd= or
// window.prompt). Async part posts it to the `auth` Edge Function, which
// validates the value server-side and returns a signed token if it
// matches. The token is stashed in sessionStorage (wiped on tab close) and
// included as `X-App-Token` on every Supabase data call. Failed-attempt
// rate limiting is now done server-side per IP — the client just relays
// the function's 401 / 429 responses to the user-facing UI.
//   ?pwd=7119 / typing 7119 → admin (full edit)
//   ?pwd=8848 / typing 8848 → read-only (shareable view)

// Synchronous: collect the password and clean up the URL bar. Returns the
// raw string the user supplied, or null if they cancelled the prompt.
function collectPassword() {
  const params = new URLSearchParams(window.location.search);
  const urlPwd = params.get("pwd");
  if (urlPwd != null) {
    params.delete("pwd");
    const newSearch = params.toString();
    history.replaceState(null, "",
      window.location.pathname + (newSearch ? "?" + newSearch : "") + window.location.hash);
    return urlPwd;
  }
  const typed = window.prompt("Enter password:");
  return typed; // may be null if user cancels
}

// Async: hit the auth Edge Function. Resolves to:
//   { isReadOnly }            — successful login, token already stored
//   { locked: true, lockUntil } — too many failed attempts
//   null                       — wrong password (caller decides what to do)
// The auth Edge Function does its own IP-keyed lockout server-side
// (auth_attempts table, 3 wrong → 24h), so the client just relays its
// verdict. Returns:
//   { isReadOnly }                    — successful login, token already stored
//   { locked: true, lockUntil }       — server says this IP is currently locked
//   null                              — wrong password / cancelled prompt
async function authenticate(pw) {
  if (pw == null || pw === "") return null;

  try {
    const res = await fetch(EDGE_AUTH_URL, {
      method: "POST",
      headers: {
        "apikey": SB_ANON,
        "Authorization": `Bearer ${SB_ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: pw }),
    });

    if (res.ok) {
      const { token, role } = await res.json();
      if (token && role) {
        setAppToken(token);
        return { isReadOnly: role === "ro" };
      }
    }

    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const lockUntil = Number(body?.lockoutUntil) || (Date.now() + 24 * 60 * 60 * 1000);
      return { locked: true, lockUntil };
    }

    if (res.status === 401) return null;

    // 5xx, network blip — treat as transient, don't pretend to lock out.
    console.error("[auth] unexpected:", res.status);
    return null;
  } catch (e) {
    console.error("[auth] error:", e);
    return null;
  }
}

// USDCNY=X is a hidden FX fetch used only for CNY→USD conversion of holdings
// (not shown in the market-conditions column). GBPUSD=X doubles as both a
// displayed card and the rate we use to convert GBP holdings to USD.
const MC_TICKERS = ["^GSPC", "^NDX", "^RUT", "^VIX", "BZ=F", "^TNX", "GBPUSD=X", "GBPCNH=X", "USDCNY=X", "ES=F", "NQ=F", "RTY=F"];

// Main app ---------------------------------------------------------------
function App() {
  // Auth lifecycle:
  //   pwInput   collected synchronously on first render (URL ?pwd= or
  //             window.prompt) and never re-read afterwards
  //   auth      result of the async Edge Function check; null while in
  //             flight, then either { isReadOnly } / { locked } / 'denied'
  // Storage migration runs in the same initial useState callback so
  // persisted state has the right shape before anything else reads it.
  const [pwInput] = useState(() => {
    Storage.migrate();
    return collectPassword();
  });
  const [auth, setAuth] = useState(undefined); // undefined = pending, null = denied

  useEffect(() => {
    if (pwInput == null) { setAuth(null); return; }
    let cancelled = false;
    authenticate(pwInput).then(result => {
      if (!cancelled) setAuth(result);
    });
    return () => { cancelled = true; };
  }, [pwInput]);

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

function applyHistPrices(portfolio, histSnap) {
  if (!histSnap?.prices) return portfolio;
  const snaps = portfolio.snapshots || [];
  const histIdx = snaps.findIndex(s => s.date === histSnap.date);
  const prevSnap = histIdx > 0 ? snaps[histIdx - 1] : null;
  const holdings = {};
  for (const [t, h] of Object.entries(portfolio.holdings)) {
    const hp = histSnap.prices[t];
    const prevHp = prevSnap?.prices?.[t];
    if (hp != null) {
      holdings[t] = {
        ...h, lastPrice: hp, extPrice: null,
        prevClose: prevHp ?? hp,
        dayPct: (prevHp != null && prevHp > 0) ? ((hp - prevHp) / prevHp) * 100 : 0,
        extDayPct: null,
      };
    } else {
      holdings[t] = h;
    }
  }
  return { ...portfolio, holdings };
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
  const [histSnap, setHistSnap] = useState(null);
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
  useEffect(() => { if ((isReadOnly || histSnap) && editMode) setEditMode(false); }, [isReadOnly, histSnap, editMode]);

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
  const doRefresh = useCallback(async () => {
    if (!portfolio) return;
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

      // Daily snapshot: save once per day when live prices arrive
      if (src === "live") {
        const today = new Date().toISOString().slice(0, 10);
        const existing = next.snapshots || [];
        if (!existing.some(s => s.date === today)) {
          const m = computeMetrics(next, { extended: false, marketData });
          if (m.marketValue > 0) {
            next.snapshots = [...existing, { date: today, value: Math.round(m.marketValue * 100) / 100 }]
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(-30);
          }
        }
      }

      return next;
    });
    setLastUpdated(new Date());
    setIsRefreshing(false);
    if (src === "live") {
      setRecentlyUpdated(true);
      setTimeout(() => setRecentlyUpdated(false), 1600);
    }
    if (src === "error") {
      setTimeout(() => doRefreshRef.current(), 3000);
    }
  }, [portfolio]);

  const doRefreshRef = useRef(doRefresh);
  useEffect(() => { doRefreshRef.current = doRefresh; }, [doRefresh]);

  // Kick off the refresh loop once the portfolio is loaded.
  useEffect(() => {
    if (!portfolio) return;
    doRefreshRef.current();
    const id = setInterval(() => doRefreshRef.current(), REFRESH_MS);
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

  const displayPortfolio = histSnap ? applyHistPrices(portfolio, histSnap) : portfolio;
  const displayMetrics   = histSnap ? computeMetrics(displayPortfolio, { extended: false, marketData }) : metrics;

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
        metrics={displayMetrics}
        source={source}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
        onRefresh={doRefresh}
        editMode={editMode}
        setEditMode={setEditMode}
        isReadOnly={isReadOnly}
        extendedHours={extendedHours}
        onToggleExtended={() => { if (!histSnap) setExtendedHours(v => !v); }}
        histDate={histSnap?.date ?? null}
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
            metrics={displayMetrics}
            extendedHours={extendedHours && currentPhase !== "regular"}
          />
        ) : (
          <Pitch
            metrics={displayMetrics}
            captainTicker={captainTicker}
            hotMoverTicker={hotMoverTicker}
            hotMoverPosKey={hotMoverPosKey}
            flashTickers={histSnap ? {} : flashTickers}
            editMode={editMode}
            isReadOnly={isReadOnly || !!histSnap}
            dragging={histSnap ? null : dragging}
            setDragging={isReadOnly || histSnap ? () => {} : setDragging}
            onDrop={histSnap ? () => {} : handleDrop}
            onOpenPosition={(k) => {
              if (histSnap) { setDrillPos(k); return; }
              if (k === "GK") { if (!isReadOnly) setEditingCash(true); return; }
              setDrillPos(k);
            }}
            onAddToPosition={(k) => {
              if (isReadOnly || histSnap) return;
              if (k === "GK") setEditingCash(true); else setAddingToPos(k);
            }}
            onUpdatePosition={updatePosition}
            isRefreshing={isRefreshing && !histSnap}
            recentlyUpdated={recentlyUpdated && !histSnap}
            hideValues={hideValues}
          />
        )}
        <Sidebar
          metrics={displayMetrics}
          source={source}
          portfolio={portfolio}
          marketData={marketData}
          extendedHours={extendedHours}
          phase={currentPhase}
          hideValues={hideValues}
        />
        <SidebarFoot source={source} />
      </main>

      {drillPos && (
        <PositionDrillModal
          posKey={drillPos}
          position={displayMetrics.positions[drillPos]}
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
