// Header + Sidebar components
const { fmtMoney: fmM, fmtPct: fmP, pctColor: pcC, londonTimeParts, usMarketPhase, formatAgo } = window.Utils;

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
        <div className="brand-mark">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 2.5 L14.5 5.5 L13 9 L10 9 L8.5 5.5 Z" />
            <path d="M12 14 L17 17.5 L15 22 L9 22 L7 17.5 Z" opacity="0.6" />
            <path d="M2.5 12 L6 10 L9 12 L8 15.5 L5 16" opacity="0.4" />
            <path d="M21.5 12 L18 10 L15 12 L16 15.5 L19 16" opacity="0.4" />
          </svg>
        </div>
        <div>
          <div className="brand-title">My Portfolios</div>
          <div className="brand-sub">Tactics Board</div>
          <div className="brand-formation mono">Formation {formation} · {metrics.tickerCount} tickers</div>
        </div>
      </div>

      <div className="scoreboard">
        <div className="scoreboard-cell">
          <div className="sb-label">
            TIME <span className="phase-dot" style={{ background: phaseInfo.color }} title={phaseInfo.label} />
          </div>
          <div className="sb-value mono">
            {t.hh}:{t.mm}:{t.ss}
            <span className="sb-suffix"> London</span>
          </div>
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
            {fmM(metrics.dayChange, { signed: true })} <span style={{ color: pcC(metrics.dayPct), opacity: 0.85 }}>({fmP(metrics.dayPct)})</span>
          </div>
        </div>
        <div className="scoreboard-divider" />
        <div className="scoreboard-cell">
          <div className="sb-label">UNREALIZED G/L</div>
          <div className="sb-value mono" style={{ color: pcC(metrics.unrlPct) }}>
            {fmM(metrics.unrlGL, { signed: true })} <span style={{ color: pcC(metrics.unrlPct), opacity: 0.85 }}>({fmP(metrics.unrlPct)})</span>
          </div>
        </div>
      </div>

      <div className="header-actions">
        <button
          className={`btn-toggle ${extendedHours ? "on" : ""}`}
          onClick={onToggleExtended}
          title="Toggle extended hours prices (pre-market / after-hours vs previous close)"
        >
          {extendedHours ? "24 Hour Market" : "Market Hour"}
        </button>
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
  const winners = [...allPlayers].sort((a, b) => (b.dayPct ?? 0) - (a.dayPct ?? 0)).slice(0, 5);
  const losers  = [...allPlayers].sort((a, b) => (a.dayPct ?? 0) - (b.dayPct ?? 0)).slice(0, 5);

  const positionList = Object.entries(metrics.positions)
    .filter(([_, p]) => p.players.length > 0)
    .sort(([, a], [, b]) => b.marketValue - a.marketValue);

  return (
    <aside className="sidebar">
      <section className="panel">
        <h3 className="panel-title">HOLDINGS SUMMARY</h3>
        <div className="panel-grid">
          <StatRow label="Market Value" value={fmM(metrics.marketValue)} mono />
          <StatRow label="Total Cost" value={fmM(metrics.totalCost)} mono dim />
          <StatRow
            label="Day Change"
            value={`${fmM(metrics.dayChange, { signed: true })} (${fmP(metrics.dayPct)})`}
            mono color={pcC(metrics.dayPct)}
          />
          <StatRow
            label="Unrealized G/L"
            value={`${fmM(metrics.unrlGL, { signed: true })} (${fmP(metrics.unrlPct)})`}
            mono color={pcC(metrics.unrlPct)}
          />
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
                  <span className="mono" style={{ color: pcC(p.dayPct) }}>{fmP(p.dayPct)} today</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

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

      <div className="sidebar-foot">
        <div className="foot-kv"><span>Source</span><span className="mono">{source === "live" ? "Yahoo Finance" : source === "sim" ? "Simulated" : "—"}</span></div>
        <div className="foot-kv"><span>Refresh</span><span className="mono">30s</span></div>
        <div className="foot-kv"><span>Stored</span><span className="mono">localStorage</span></div>
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

Object.assign(window, { Header, Sidebar, StatRow });
