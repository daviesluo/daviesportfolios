// The tactics-board pitch with position chips placed on it
import React from 'react';
import {
  fmtMoney as fmtM,
  fmtPct as fmtPc,
  fmtPrice as fmtPr,
  pctColor as pctClr,
  maskDigits,
  displayTicker,
  pctIsFlat,
} from './formatters.js';
import { POSITION_COORDS } from './positions.js';

function Pitch({ metrics, captainTicker, hotMoverTicker, hotMoverPosKey, flashTickers, editMode, isReadOnly, onOpenPosition, onAddToPosition, onUpdatePosition, onSwapPositions, hideValues }) {
  const coords = POSITION_COORDS;

  // Edit-mode drag-to-swap. Pointer Events (mouse + touch) rather than
  // HTML5 DnD, which never fires on touch. Handled imperatively (direct
  // style.transform + classList on the dragged / drop-target DOM nodes)
  // so each pointermove doesn't trigger a React re-render of all the
  // chips — only the final swap goes through React. `clickGuardRef`
  // suppresses the chip's click-to-open that would otherwise fire after
  // a drag's pointerup. All three handlers are stable (useCallback []),
  // reading live state off `dragRef`, so a mid-drag re-render (refresh
  // tick) can't strand the window listeners on stale closures.
  const dragRef = React.useRef(/** @type {any} */ (null));
  const clickGuardRef = React.useRef(false);
  const onSwapRef = React.useRef(onSwapPositions);
  React.useEffect(() => { onSwapRef.current = onSwapPositions; }, [onSwapPositions]);

  const endDrag = React.useCallback(() => {
    const st = dragRef.current;
    if (!st) return;
    if (st.el) { st.el.style.transform = ''; st.el.style.zIndex = ''; st.el.classList.remove('dragging'); }
    if (st.overEl) st.overEl.classList.remove('drop-target');
    window.removeEventListener('pointermove', st.onMove);
    window.removeEventListener('pointerup', st.onUp);
    window.removeEventListener('pointercancel', st.onUp);
    dragRef.current = null;
  }, []);

  const onChipPointerDown = React.useCallback((posKey, e) => {
    if (e.button != null && e.button !== 0) return; // primary / touch only
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    const onMove = (ev) => {
      const st = dragRef.current;
      if (!st) return;
      const dx = ev.clientX - st.startX, dy = ev.clientY - st.startY;
      if (!st.dragging && Math.hypot(dx, dy) < 8) return; // movement threshold
      if (!st.dragging) { st.dragging = true; clickGuardRef.current = true; el.classList.add('dragging'); el.style.zIndex = '50'; }
      // The chip's base CSS centres it with translate(-50%,-50%); keep
      // that and add the drag delta on top, or it'd jump on first move.
      el.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const chip = under && under.closest ? under.closest('.pos-chip[data-poskey]') : null;
      const overKey = chip ? chip.getAttribute('data-poskey') : null;
      const newOverEl = (overKey && overKey !== st.fromKey) ? /** @type {HTMLElement} */ (chip) : null;
      if (newOverEl !== st.overEl) {
        if (st.overEl) st.overEl.classList.remove('drop-target');
        if (newOverEl) newOverEl.classList.add('drop-target');
        st.overEl = newOverEl;
        st.overKey = newOverEl ? overKey : null;
      }
    };
    const onUp = () => {
      const st = dragRef.current;
      if (!st) return;
      const { fromKey, overKey, dragging } = st;
      endDrag();
      if (dragging && overKey && overKey !== fromKey) onSwapRef.current?.(fromKey, overKey);
      // Release the click guard after the synthetic click (which fires
      // post-pointerup) has been swallowed.
      if (dragging) setTimeout(() => { clickGuardRef.current = false; }, 0);
    };
    dragRef.current = { fromKey: posKey, el, startX: e.clientX, startY: e.clientY, dragging: false, overEl: null, overKey: null, onMove, onUp };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [endDrag]);

  // Clean up a drag-in-progress if the Pitch unmounts mid-gesture.
  React.useEffect(() => endDrag, [endDrag]);

  const dragEnabled = editMode && !isReadOnly && typeof onSwapPositions === 'function';

  return (
    <div className="pitch-wrap">
      <div className={`pitch${dragEnabled ? ' editing' : ''}`}>
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
              hotMoverPosKey={hotMoverPosKey}
              flashTickers={flashTickers}
              editMode={editMode}
              isReadOnly={isReadOnly}
              dragEnabled={dragEnabled}
              onDragStart={onChipPointerDown}
              clickGuardRef={clickGuardRef}
              onOpen={() => onOpenPosition(k)}
              onAdd={() => onAddToPosition(k)}
              onUpdatePosition={(patch) => onUpdatePosition(k, patch)}
              hideValues={hideValues}
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

function PositionChip({ posKey, position, coord, captainTicker, hotMoverPosKey, flashTickers, editMode, isReadOnly, dragEnabled, onDragStart, clickGuardRef, onOpen, onAdd, onUpdatePosition, hideValues }) {
  const hasPlayers = position.players.length > 0;
  // Same flat threshold as the heatmap tile and Top Movers, so a
  // sub-0.005 % move reads as "flat" on every surface at once.
  const pctClass = pctIsFlat(position.dayPct) ? "flat" : position.dayPct > 0 ? "gain" : "loss";

  const hasCaptain = captainTicker && position.tickers.includes(captainTicker);
  const hasHot = posKey === hotMoverPosKey;

  const flashesInPos = position.players.some(p => flashTickers[p.ticker]);

  const [editingName, setEditingName] = React.useState(false);

  const commitName = (v) => {
    onUpdatePosition && onUpdatePosition({ subtitle: v.trim() });
    setEditingName(false);
  };

  return (
    <div
      className={`pos-chip role-${position.role.toLowerCase()} ${!hasPlayers ? "empty" : ""} ${hasHot ? "hot" : ""} ${flashesInPos ? "flash" : ""}${dragEnabled ? " draggable" : ""}`}
      style={{ left: coord.x + "%", top: coord.y + "%" }}
      data-poskey={posKey}
      onPointerDown={dragEnabled ? (e) => onDragStart(posKey, e) : undefined}
      onClick={(e) => {
        if (editingName) return;
        // Swallow the click that fires right after a drag's pointerup so
        // a swap doesn't also open the drill modal.
        if (clickGuardRef && clickGuardRef.current) return;
        hasPlayers ? onOpen() : onAdd();
      }}
      // Keyboard activation for the role="button" — Enter / Space open
      // the drill (or add) the same way a click does, so the chip isn't
      // focusable-but-inert for keyboard users. The editingName guard
      // lets the inline rename input own its own keys; the target ===
      // currentTarget guard keeps a keypress on an inner button (rename /
      // add) from also bubbling up and double-firing the open.
      onKeyDown={(e) => {
        if (editingName) return;
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          hasPlayers ? onOpen() : onAdd();
        }
      }}
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
              if (e.key === "Enter") { /** @type {HTMLElement} */ (e.target).blur(); }
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
          <div className="chip-mv mono">{hideValues ? maskDigits(fmtM(position.marketValue)) : fmtM(position.marketValue)}</div>
        )}
        {hasPlayers ? (
          <div className="chip-tickers">
            {position.players.slice(0, 3).map(p => (
              <span key={p.ticker} className="chip-ticker mono">{displayTicker(p.ticker)}</span>
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

// NB: deliberately NOT React.memo'd. Pitch takes `metrics` (rebuilt by
// app.jsx's useMemo on every price tick) + `flashTickers` (the flash
// map, repopulated each refresh) + fresh inline `onOpenPosition` /
// `onAddToPosition` closures, so at least one prop changes identity
// every tick by design — a memo wrapper would compare-then-render-
// anyway, paying the shallow-compare cost for no skipped render. The
// Heatmap (which has none of those per-tick props) is the one that
// benefits from memo; see heatmap.jsx.
export { Pitch };
