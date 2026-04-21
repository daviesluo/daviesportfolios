// Main portfolio tactics board app
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { fmtMoney, fmtPct, fmtPrice, pctColor, computeMetrics, detectFormation, refreshPrices, POSITION_COORDS } = window.Utils;

const STORAGE_KEY = "portfolio-tactics-board-v1";
const REFRESH_MS = 30 * 1000;

// Load / save ------------------------------------------------------------
function loadPortfolio() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {}
  return JSON.parse(JSON.stringify(window.INITIAL_PORTFOLIO));
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
  // v2 → v3: refresh labels + default subtitles from INITIAL_PORTFOLIO for untouched slots.
  // Also prune any position keys not in the current schema (legacy leftovers).
  const validKeys = new Set(Object.keys(window.INITIAL_PORTFOLIO.positions));
  for (const k of Object.keys(p.positions)) {
    if (!validKeys.has(k)) delete p.positions[k];
  }
  // - Label: any stored label that differs from the current short code (or is the old long name) gets refreshed.
  //   Heuristic: if the stored label is >4 chars it's a legacy long name ("Box-to-Box", "Left Winger", etc).
  //   Also refresh if it simply differs from the current default — short codes are stable (GK/LB/CB/CM/LW/ST/RW/CDM).
  // - Subtitle: if empty OR matches a prior legacy default, overwrite with the current default.
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
function savePortfolio(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) {}
}

// Main app ---------------------------------------------------------------
function App() {
  const [portfolio, setPortfolio] = useState(() => loadPortfolio());
  const [drillPos, setDrillPos] = useState(null);       // position key to drill into
  const [editMode, setEditMode] = useState(false);
  const [editingTicker, setEditingTicker] = useState(null); // ticker string
  const [addingToPos, setAddingToPos] = useState(null);  // position key to add to
  const [editingCash, setEditingCash] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [source, setSource] = useState("—");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recentlyUpdated, setRecentlyUpdated] = useState(false);
  const [flashTickers, setFlashTickers] = useState({});   // ticker -> "up"|"down"
  const [dragging, setDragging] = useState(null);         // { ticker, fromPos }

  // persist on change
  useEffect(() => { savePortfolio(portfolio); }, [portfolio]);

  // Price refresh loop
  const doRefresh = useCallback(async () => {
    setIsRefreshing(true);
    const { updates, source: src } = await refreshPrices(portfolio, "live");
    setSource(src);
    setPortfolio(prev => {
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
    // If failed, try again shortly
    if (src === "error") {
      setTimeout(() => { doRefresh(); }, 3000);
    }
  }, [portfolio.holdings]); // only re-bind when holdings change

  useEffect(() => {
    doRefresh();
    const id = setInterval(doRefresh, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, []);

  const metrics = useMemo(() => computeMetrics(portfolio), [portfolio]);
  const formation = useMemo(() => detectFormation(portfolio), [portfolio]);

  // Identify special tickers
  const captainTicker = useMemo(() => {
    let best = null, bestMV = 0;
    for (const [t, h] of Object.entries(portfolio.holdings)) {
      const mv = h.shares * h.lastPrice;
      if (mv > bestMV) { bestMV = mv; best = t; }
    }
    return best;
  }, [portfolio.holdings]);

  const hotMoverTicker = useMemo(() => {
    let best = null, bestAbs = 0;
    for (const [t, h] of Object.entries(portfolio.holdings)) {
      const abs = Math.abs(h.dayPct ?? 0);
      if (abs > bestAbs) { bestAbs = abs; best = t; }
    }
    return best;
  }, [portfolio.holdings]);

  const hotMoverPosKey = useMemo(() => {
    for (const [k, pos] of Object.entries(portfolio.positions)) {
      if (pos.tickers.includes(hotMoverTicker)) return k;
    }
    return null;
  }, [portfolio.positions, hotMoverTicker]);

  // Edit handlers
  const updateHolding = (ticker, patch) => {
    setPortfolio(p => ({
      ...p,
      holdings: { ...p.holdings, [ticker]: { ...p.holdings[ticker], ...patch } },
    }));
  };
  const removeHolding = (ticker) => {
    setPortfolio(p => {
      const holdings = { ...p.holdings }; delete holdings[ticker];
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        positions[k] = { ...pos, tickers: pos.tickers.filter(t => t !== ticker) };
      }
      return { ...p, holdings, positions };
    });
  };
  const addHolding = (posKey, ticker, shares, cost, lastPrice) => {
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
  };
  const movePlayer = (ticker, toPos) => {
    setPortfolio(p => {
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        const tickers = pos.tickers.filter(t => t !== ticker);
        if (k === toPos) tickers.push(ticker);
        positions[k] = { ...pos, tickers };
      }
      return { ...p, positions };
    });
  };

  const updatePosition = (posKey, patch) => {
    setPortfolio(p => ({
      ...p,
      positions: { ...p.positions, [posKey]: { ...p.positions[posKey], ...patch } },
    }));
  };

  const handleDrop = (e, toPos) => {
    e.preventDefault();
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
      />

      <main className="main">
        <Pitch
          metrics={metrics}
          captainTicker={captainTicker}
          hotMoverTicker={hotMoverTicker}
          hotMoverPosKey={hotMoverPosKey}
          flashTickers={flashTickers}
          editMode={editMode}
          dragging={dragging}
          setDragging={setDragging}
          onDrop={handleDrop}
          onOpenPosition={(k) => { if (k === "GK") setEditingCash(true); else setDrillPos(k); }}
          onAddToPosition={(k) => { if (k === "GK") setEditingCash(true); else setAddingToPos(k); }}
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
          onClose={() => setDrillPos(null)}
          onEditTicker={(t) => setEditingTicker(t)}
          onAddTicker={() => setAddingToPos(drillPos)}
          onRemoveTicker={(t) => { if (confirm(`Remove ${t}?`)) removeHolding(t); }}
          onUpdatePosition={(patch) => updatePosition(drillPos, patch)}
        />
      )}

      {editingTicker && portfolio.holdings[editingTicker] && (
        <EditTickerModal
          ticker={editingTicker}
          holding={portfolio.holdings[editingTicker]}
          onClose={() => setEditingTicker(null)}
          onSave={(patch) => { updateHolding(editingTicker, patch); setEditingTicker(null); }}
          onDelete={() => { if (confirm(`Remove ${editingTicker}?`)) { removeHolding(editingTicker); setEditingTicker(null); } }}
        />
      )}

      {addingToPos && (
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

      {editingCash && (
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
