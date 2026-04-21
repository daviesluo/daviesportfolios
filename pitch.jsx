// The tactics-board pitch with position chips placed on it
const { fmtMoney: fmtM, fmtPct: fmtPc, fmtPrice: fmtPr, pctColor: pctClr } = window.Utils;

function Pitch({ metrics, captainTicker, hotMoverTicker, hotMoverPosKey, flashTickers, editMode, isReadOnly, dragging, setDragging, onDrop, onOpenPosition, onAddToPosition, onUpdatePosition, isRefreshing, recentlyUpdated }) {
  const coords = window.Utils.POSITION_COORDS;

  return (
    <div className="pitch-wrap">
      <div className="pitch">
        <PitchLines />

        {/* Position chips */}
        {Object.entries(metrics.positions).map(([k, pos]) => {
          const coord = coords[k];
          if (!coord) return null;
          return (
            <PositionChip
              key={k}
              posKey={k}
              position={pos}
              coord={coord}
              captainTicker={captainTicker}
              hotMoverTicker={hotMoverTicker}
              flashTickers={flashTickers}
              editMode={editMode}
              isReadOnly={isReadOnly}
              onOpen={() => onOpenPosition(k)}
              onAdd={() => onAddToPosition(k)}
              onDragStart={(ticker) => setDragging({ ticker, fromPos: k })}
              onDrop={(e) => onDrop(e, k)}
              isDropTarget={dragging && dragging.fromPos !== k}
              onUpdatePosition={(patch) => onUpdatePosition(k, patch)}
              isRefreshing={isRefreshing}
              recentlyUpdated={recentlyUpdated}
            />
          );
        })}

        {/* Ball at hot mover */}
        {hotMoverPosKey && coords[hotMoverPosKey] && (
          <Ball coord={coords[hotMoverPosKey]} ticker={hotMoverTicker} />
        )}
      </div>

      {/* Legend */}
      <div className="pitch-legend">
        <LegendItem swatch="captain" label="Captain · largest holding" />
          <LegendItem swatch="ball" label="Hot ball · biggest mover" />
          <LegendItem swatch="gain" label="Gaining today" />
          <LegendItem swatch="loss" label="Losing today" />
      </div>
    </div>
  );
}

function LegendItem({ swatch, label }) {
  return (
    <div className="legend-item">
      <span className={`legend-sw sw-${swatch}`} />
      <span>{label}</span>
    </div>
  );
}

function PitchLines() {
  // SVG overlay with thin chalk lines + center circle + penalty areas + goals
  return (
    <svg className="pitch-lines" viewBox="0 0 1000 1500" preserveAspectRatio="none">
      <defs>
        <filter id="chalk" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="1.2" />
        </filter>
      </defs>
      <g stroke="rgba(244,239,227,0.55)" strokeWidth="2" fill="none" filter="url(#chalk)">
        {/* Outer boundary */}
        <rect x="40" y="40" width="920" height="1420" />
        {/* Halfway line */}
        <line x1="40" y1="750" x2="960" y2="750" />
        {/* Center circle + spot */}
        <circle cx="500" cy="750" r="110" />
        <circle cx="500" cy="750" r="4" fill="rgba(244,239,227,0.7)" />
        {/* Top penalty area (opponent) */}
        <rect x="220" y="40" width="560" height="200" />
        <rect x="360" y="40" width="280" height="80" />
        {/* Top penalty arc */}
        <path d="M 410 240 A 110 110 0 0 0 590 240" />
        <circle cx="500" cy="175" r="3" fill="rgba(244,239,227,0.7)" />
        {/* Bottom penalty area (home) */}
        <rect x="220" y="1260" width="560" height="200" />
        <rect x="360" y="1380" width="280" height="80" />
        <path d="M 410 1260 A 110 110 0 0 1 590 1260" />
        <circle cx="500" cy="1325" r="3" fill="rgba(244,239,227,0.7)" />
        {/* Corner arcs */}
        <path d="M 40 60 A 20 20 0 0 1 60 40" />
        <path d="M 960 60 A 20 20 0 0 0 940 40" />
        <path d="M 40 1440 A 20 20 0 0 0 60 1460" />
        <path d="M 960 1440 A 20 20 0 0 1 940 1460" />
      </g>
    </svg>
  );
}

function PositionChip({ posKey, position, coord, captainTicker, hotMoverTicker, flashTickers, editMode, isReadOnly, onOpen, onAdd, onDragStart, onDrop, isDropTarget, onUpdatePosition, isRefreshing, recentlyUpdated }) {
  const hasPlayers = position.players.length > 0;
  const pctClass = position.dayPct > 0 ? "gain" : position.dayPct < 0 ? "loss" : "flat";

  const hasCaptain = captainTicker && position.tickers.includes(captainTicker);
  const hasHot = hotMoverTicker && position.tickers.includes(hotMoverTicker);

  const flashesInPos = position.players.some(p => flashTickers[p.ticker]);

  const [dragOver, setDragOver] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);

  const onDragOverChip = (e) => {
    if (isReadOnly) return;
    if (isDropTarget) { e.preventDefault(); setDragOver(true); }
  };
  const onDragLeaveChip = () => setDragOver(false);
  const onDropChip = (e) => { setDragOver(false); onDrop(e); };

  const commitName = (v) => {
    onUpdatePosition && onUpdatePosition({ subtitle: v.trim() });
    setEditingName(false);
  };

  // Show per-chip status overlay during refresh / just after
  const statusOverlay = isRefreshing ? "refreshing" : recentlyUpdated ? "updated" : null;

  return (
    <div
      className={`pos-chip role-${position.role.toLowerCase()} ${!hasPlayers ? "empty" : ""} ${hasHot ? "hot" : ""} ${flashesInPos ? "flash" : ""} ${dragOver ? "drag-over" : ""}`}
      style={{ left: coord.x + "%", top: coord.y + "%" }}
      onClick={(e) => { if (editingName) return; hasPlayers ? onOpen() : onAdd(); }}
      onDragOver={onDragOverChip}
      onDragLeave={onDragLeaveChip}
      onDrop={onDropChip}
      role="button"
      tabIndex={0}
    >
      {hasCaptain && (
        <div className="armband" title="Captain — largest holding">C</div>
      )}

      <div className="chip-inner">
        <div className="chip-label">
          <span className="chip-pos-code">{position.label}</span>
          {hasPlayers && <span className={`chip-pct mono ${pctClass}`}>{fmtPc(position.dayPct)}</span>}
        </div>
        {editingName ? (
          <input
            className="chip-name-input"
            autoFocus
            defaultValue={position.subtitle || position.label || ""}
            placeholder="Group name"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.target.blur(); }
              if (e.key === "Escape") { setEditingName(false); }
            }}
          />
        ) : (
          <div className="chip-name-row">
            <span className="chip-name" title={position.subtitle || position.label}>
              {position.subtitle || position.label}
            </span>
            {editMode && (
              <button
                className="chip-edit-btn"
                title="Rename group"
                onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
              >
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M11.5 2.5 L13.5 4.5 L5 13 L2.5 13.5 L3 11 Z" />
                </svg>
              </button>
            )}
          </div>
        )}
        {hasPlayers && (
          <div className="chip-mv mono">{fmtM(position.marketValue)}</div>
        )}
        {hasPlayers ? (
          <div className="chip-tickers">
            {position.players.slice(0, 3).map(p => (
              <span key={p.ticker} className="chip-ticker mono">{p.ticker}</span>
            ))}
            {position.players.length > 3 && (
              <span className="chip-ticker more mono">+{position.players.length - 3}</span>
            )}
          </div>
        ) : (
          <div className="chip-empty mono dim">tap to add</div>
        )}
      </div>

      {editMode && (
        <button
          className="chip-add"
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          title="Add ticker to this position"
        >+</button>
      )}

      {statusOverlay && false && (
        <div className={`chip-status ${statusOverlay}`}>
          {statusOverlay === "refreshing" ? (
            <><span className="chip-status-spinner" /> Refreshing…</>
          ) : (
            <>✓ Updated</>
          )}
        </div>
      )}
    </div>
  );
}

function Ball({ coord, ticker }) {
  return (
    <div className="ball" style={{ left: coord.x + "%", top: coord.y + "%" }} title={`Hot ball · ${ticker}`}>
      <span className="ball-emoji" aria-hidden="true">⚽</span>
    </div>
  );
}

Object.assign(window, { Pitch });
