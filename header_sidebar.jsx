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

function Header({ metrics, formation, source, lastUpdated, isRefreshing, onRefresh, editMode, setEditMode, isReadOnly, extendedHours, onToggleExtended }) {
  const now = useClock(1000);
  const t = londonTimeParts(now);
  const phase = usMarketPhase(now);
  const phaseInfo = PHASE[phase] || PHASE.overnight;
  const dayClr = pcC(metrics.dayPct);

  const agoMs = lastUpdated ? (now - lastUpdated) : null;
  const agoText = lastUpdated ? formatAgo(agoMs) : "—";

  const statusLabel =
    isRefreshing ? "REFRESHING…" :
    source === "live" ? "LIVE" :
    source === "error" ? "RETRYING…" : "…";

  return (
    <header className="header">
      <div className="brand">
        <div>
          <div className="brand-title">Davies' Portfolios</div>
          <div className="brand-sub">Tactics Board</div>
          <div className="brand-formation mono">Formation {formation} · {metrics.tickerCount} tickers</div>
        </div>
      </div>

      <div className="scoreboard">
        <div className="scoreboard-cell">
          <div className="sb-label">
            GMT TIME <span className="phase-dot" style={{ background: phaseInfo.color }} title={phaseInfo.label} />
          </div>
          <div className="sb-value mono">{t.hh}:{t.mm}:{t.ss}</div>
          <label
            className="ext-switch"
            style={{ "--ext-on-color": phaseInfo.color }}
            title={extendedHours ? "Showing extended-hours prices — click to switch off" : "Click to show pre-market / after-hours prices"}
          >
            <input type="checkbox" className="ext-checkbox" checked={extendedHours} onChange={onToggleExtended} />
            <span className="ext-track"><span className="ext-thumb" /></span>
            <span className="ext-switch-label mono">Extended Hours</span>
          </label>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">PORTFOLIO</div>
          <div className="sb-value sb-value-lg mono">{fmM(metrics.marketValue)}</div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">DAY CHANGE</div>
          <div className="sb-value mono" style={{ color: pcC(metrics.dayPct) }}>
            <div>{fmM(metrics.dayChange, { signed: true })}</div>
            <div style={{ fontSize: '10px', opacity: 0.75 }}>({fmP(metrics.dayPct)})</div>
          </div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">UNREALIZED G/L</div>
          <div className="sb-value mono" style={{ color: pcC(metrics.unrlPct) }}>
            <div>{fmM(metrics.unrlGL, { signed: true })}</div>
            <div style={{ fontSize: '10px', opacity: 0.75 }}>({fmP(metrics.unrlPct)})</div>
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

function Sidebar({ metrics, source }) {
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

      <div className="sidebar-foot">
        <div className="foot-kv"><span>Source</span><span className="mono">{source === "live" ? "Yahoo Finance" : source === "sim" ? "Simulated" : "—"}</span></div>
        <div className="foot-kv"><span>Auto Refresh</span><span className="mono">30s</span></div>
        <div className="foot-kv"><span>Stored</span><span className="mono">Supabase</span></div>
      </div>
    </aside>
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
const MC_INDICES = [
  { ticker: "^GSPC",    name: "S&P 500"      },
  { ticker: "^NDX",     name: "NASDAQ 100"   },
  { ticker: "^RUT",     name: "Russell 2000" },
  { ticker: "^VIX",     name: "VIX"          },
  { ticker: "BZ=F",     name: "Brent Oil"    },
  { ticker: "GBPUSD=X", name: "GBP/USD"      },
  { ticker: "GBPCNH=X", name: "GBP/CNH"      },
];

function fmtChg(n) {
  if (n == null || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  const abs  = Math.abs(n);
  if (abs >= 1000) return sign + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100)  return sign + n.toFixed(0);
  return sign + n.toFixed(2);
}

function MarketConditions({ marketData, extendedHours, phase }) {
  const useExt = extendedHours && phase !== "regular";
  return (
    <aside className="market-conditions">
      {MC_INDICES.map(({ ticker, name }) => {
        const d = marketData[ticker];
        const price     = d ? ((useExt && d.extPrice   != null) ? d.extPrice   : d.lastPrice)       : null;
        const pct       = d ? ((useExt && d.extDayPct  != null) ? d.extDayPct  : (d.dayPct ?? 0))   : null;
        const prevClose = d ? (d.prevClose ?? d.lastPrice) : null;
        const dayChange = (price != null && prevClose != null) ? price - prevClose : null;
        return (
          <section key={ticker} className="panel mc-card">
            <div className="mc-card-head">
              <h3 className="panel-title" style={{ margin: 0 }}>{name}</h3>
              <span className="mono dim" style={{ fontSize: '10px' }}>{ticker}</span>
            </div>
            <div className="mc-price mono">
              {price != null ? fmtPr(price) : "—"}
            </div>
            <div className="mc-footer">
              <span className="mono" style={{ color: pcC(pct), fontSize: '11px' }}>{fmtChg(dayChange)}</span>
              <span className="mono" style={{ color: pcC(pct), fontSize: '11px' }}>{pct != null ? fmP(pct) : "—"}</span>
            </div>
          </section>
        );
      })}
    </aside>
  );
}

Object.assign(window, { Header, Sidebar, StatRow, MarketConditions });
