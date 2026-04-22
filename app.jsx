// Main portfolio tactics board app
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { fmtMoney, fmtPct, fmtPrice, pctColor, computeMetrics, detectFormation, refreshPrices, POSITION_COORDS } = window.Utils;

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

// Supabase — direct PostgREST REST calls, no SDK required. ---------------
const SB_URL  = "https://flmvxigozjuizpckllvk.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsbXZ4aWdvemp1aXpwY2tsbHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODM3MjgsImV4cCI6MjA5MjM1OTcyOH0.vFqe6PNsPbVkg7NJmQJBsVECX1S58vAvv5MOjf63Xck";
const SB_HEADERS = {
  "apikey": SB_ANON,
  "Authorization": `Bearer ${SB_ANON}`,
  "Content-Type": "application/json",
};

async function loadPortfolioRemote() {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/board_data?id=eq.1&select=data`,
      { headers: SB_HEADERS }
    );
    if (!res.ok) {
      console.error("[supabase] load failed:", res.status, await res.text());
      return JSON.parse(JSON.stringify(window.INITIAL_PORTFOLIO));
    }
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0 && rows[0].data) {
      return migrate(rows[0].data);
    }
    // No row yet — seed with initial portfolio.
    return JSON.parse(JSON.stringify(window.INITIAL_PORTFOLIO));
  } catch (e) {
    console.error("[supabase] load error:", e);
    return JSON.parse(JSON.stringify(window.INITIAL_PORTFOLIO));
  }
}

async function savePortfolioRemote(p) {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/board_data`,
      {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: 1, data: p }),
      }
    );
    if (!res.ok) console.error("[supabase] save failed:", res.status, await res.text());
  } catch (e) {
    console.error("[supabase] save error:", e);
  }
}

// Migrate old saved shapes to current schema.
function migrate(p) {
  if (!p || !p.positions) return p;
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
  // v2 → v3: refresh labels + default subtitles from INITIAL_PORTFOLIO for untouched slots.
  const validKeys = new Set(Object.keys(window.INITIAL_PORTFOLIO.positions));
  for (const k of Object.keys(p.positions)) {
    if (!validKeys.has(k)) delete p.positions[k];
  }
  const LEGACY_SUBTITLES = new Set(["", "Cash reserves", "Growth", "Value", "Speculative"]);
  for (const [k, defaults] of Object.entries(window.INITIAL_PORTFOLIO.positions)) {
    const cur = p.positions[k];
    if (!cur) { p.positions[k] = JSON.parse(JSON.stringify(defaults)); continue; }
    if (!cur.label || cur.label.length > 4 || cur.label !== defaults.label) cur.label = defaults.label;
    if (cur.subtitle == null || LEGACY_SUBTITLES.has(cur.subtitle)) cur.subtitle = defaults.subtitle || "";
    if (!cur.role) cur.role = defaults.role;
  }
  return p;
}

// Auth gate --------------------------------------------------------------
function promptForAuth() {
  const pw = window.prompt("Enter password:");
  if (pw === "8888") return { isReadOnly: true  };
  if (pw === "7119") return { isReadOnly: false };
  return null;
}

// Main app ---------------------------------------------------------------
function App() {
  // Prompt synchronously on first render so there's no flash of content.
  const [auth] = useState(() => promptForAuth());

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
      <Board isReadOnly={auth.isReadOnly} />
    </ErrorBoundary>
  );
}

function Board({ isReadOnly }) {
  const [portfolio, setPortfolio] = useState(null);      // null = still loading
  const [drillPos, setDrillPos] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editingTicker, setEditingTicker] = useState(null);
  const [addingToPos, setAddingToPos] = useState(null);
  const [editingCash, setEditingCash] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [source, setSource] = useState("—");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recentlyUpdated, setRecentlyUpdated] = useState(false);
  const [flashTickers, setFlashTickers] = useState({});
  const [dragging, setDragging] = useState(null);

  // In read-only mode, force-disable edit mode.
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
  const doRefresh = useCallback(async () => {
    if (!portfolio) return;
    setIsRefreshing(true);
    const { updates, source: src } = await refreshPrices(portfolio, "live");
    setSource(src);
    setPortfolio(prev => {
      if (!prev) return prev;
      const next = { ...prev, holdings: { ...prev.holdings } };
      const flashes = {};
      for (const [t, u] of Object.entries(updates)) {
        if (!next.holdings[t]) continue;
        const old = next.holdings[t].lastPrice;
        next.holdings[t] = {
          ...next.holdings[t],
          lastPrice: u.lastPrice,
          prevClose: u.prevClose ?? next.holdings[t].prevClose,
          dayPct: u.dayPct ?? next.holdings[t].dayPct,
        };
        if (Math.abs(u.lastPrice - old) > 0.0001) {
          flashes[t] = u.lastPrice > old ? "up" : "down";
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

  const metrics = computeMetrics(portfolio);
  const formation = detectFormation(portfolio);

  let captainTicker = null, captainMV = 0;
  for (const [t, h] of Object.entries(portfolio.holdings)) {
    const mv = h.shares * h.lastPrice;
    if (mv > captainMV) { captainMV = mv; captainTicker = t; }
  }
  let hotMoverTicker = null, hotAbs = 0;
  for (const [t, h] of Object.entries(portfolio.holdings)) {
    const abs = Math.abs(h.dayPct ?? 0);
    if (abs > hotAbs) { hotAbs = abs; hotMoverTicker = t; }
  }
  let hotMoverPosKey = null;
  for (const [k, pos] of Object.entries(portfolio.positions)) {
    if (pos.tickers.includes(hotMoverTicker)) { hotMoverPosKey = k; break; }
  }

  // Edit handlers — all no-ops when read-only.
  const guard = (fn) => (...args) => { if (isReadOnly) return; fn(...args); };

  const updateHolding = guard((ticker, patch) => {
    setPortfolio(p => ({ ...p, holdings: { ...p.holdings, [ticker]: { ...p.holdings[ticker], ...patch } } }));
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
  const addHolding = guard((posKey, ticker, shares, cost, lastPrice) => {
    ticker = ticker.toUpperCase().trim();
    if (!ticker) return;
    setPortfolio(p => {
      const holdings = {
        ...p.holdings,
        [ticker]: {
          shares: Number(shares) || 0,
          cost: Number(cost) || 0,
          lastPrice: Number(lastPrice) || Number(cost) || 0,
          prevClose: Number(lastPrice) || Number(cost) || 0,
          dayPct: 0,
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
        formation={formation}
        source={source}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
        onRefresh={doRefresh}
        editMode={editMode}
        setEditMode={setEditMode}
        isReadOnly={isReadOnly}
      />

      <main className="main">
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
        />
        <Sidebar metrics={metrics} source={source} />
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
          onAddTicker={() => { if (isReadOnly) return; setAddingToPos(drillPos); }}
          onRemoveTicker={(t) => { if (isReadOnly) return; if (confirm(`Remove ${t}?`)) removeHolding(t); }}
          onUpdatePosition={(patch) => updatePosition(drillPos, patch)}
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
window.App = App;
