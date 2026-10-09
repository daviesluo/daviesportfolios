// A position's drill-in and its player cards, out of the main bundle (batch 5's size budget, 2026-10-08): the board
// draws its position cards itself (pitch.jsx), and this opens on a click, so the app loads it after its first paint
// (`prefetchModalChunks`) instead of in front of it. It draws in modals.jsx's `Modal`.
import React from 'react';
import {
  fmtMoney as fmtMo,
  fmtPct as fmtPe,
  fmtPrice as fmtPri,
  fmtSharesFor as fmtShFor,
  pctColor as pctClo,
  maskDigits,
} from '../app/formatters.js';
import { currencySymbol as curSym } from '../portfolio/fx.js';
import { Modal } from './modals.jsx';

// Same digit-mask helper used everywhere — replaces digits with `*`,
// keeping currency symbols / signs / punctuation so the placeholder is the
// same visual width as the real number.
// `maskDigits` is imported from formatters.js — single source of truth
// shared across header_sidebar / modals / pitch.

/**
 * `fxPending` (metrics.js's `fxPendingOf`): the exchange rates have not loaded, so a holding priced in another
 * currency is valued at 1:1. Its dollar figures, and the position's totals with them, wait with a dash, as the
 * scoreboard and the position's card do.
 */
function PositionDrillModal({ posKey, position, captainTicker, hotMoverTicker, flashTickers, editMode, isReadOnly, onClose, onEditTicker, onViewChart, onAddTicker, onRemoveTicker, onUpdatePosition, hideValues, fxPending = false }) {
  if (!position) return null;

  const sorted = [...position.players].sort((a, b) => b.marketValue - a.marketValue);
  const m = (s) => hideValues ? maskDigits(s) : s;
  const waiting = fxPending && position.players.some((p) => p.fxMissing);
  const w = (/** @type {number | null | undefined} */ v) => (waiting ? null : v);

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">POSITION · SECTOR</div>
          <h2 className="modal-title">
            {position.label}
            {position.subtitle && <span className="modal-sub"> · {position.subtitle}</span>}
          </h2>
          <div className="modal-meta mono">
            <span>{m(fmtMo(w(position.marketValue)))} Value</span>
            <span style={{ color: waiting ? undefined : pctClo(position.dayPct) }}>{m(fmtMo(w(position.dayChange), { signed: true }))} ({fmtPe(w(position.dayPct))}) today</span>
            <span style={{ color: waiting ? undefined : pctClo(position.unrlPct) }}>{m(fmtMo(w(position.unrlGL), { signed: true }))} ({fmtPe(w(position.unrlPct))}) G/L</span>
            <span className="dim">{position.players.length} {position.players.length === 1 ? "ticker" : "tickers"}</span>
          </div>
        </div>
        <div className="modal-head-actions">
          {!isReadOnly && <button className="btn-primary" onClick={onAddTicker}>+ Add Player</button>}
          <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>

      <div className="modal-body">
        {sorted.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">○</div>
            <div>No players at this position</div>
            {!isReadOnly && <button className="btn-primary" onClick={onAddTicker}>Add one</button>}
          </div>
        ) : (
          <div className="player-grid">
            {sorted.map(p => (
              <PlayerCard
                key={p.ticker}
                player={p}
                isCaptain={p.ticker === captainTicker}
                isHot={p.ticker === hotMoverTicker}
                flash={flashTickers[p.ticker]}
                onClick={
                  // Edit mode (non-read-only) → open the lot editor.
                  // Otherwise → open the ticker price chart modal.
                  (editMode && !isReadOnly)
                    ? () => onEditTicker(p.ticker)
                    : (onViewChart ? () => onViewChart(p.ticker) : undefined)
                }
                onRemove={() => onRemoveTicker(p.ticker)}
                showRemove={editMode && !isReadOnly}
                hideValues={hideValues}
                fxPending={fxPending && !!p.fxMissing}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PlayerCard({ player, isCaptain, isHot, flash, onClick, onRemove, showRemove, hideValues, fxPending = false }) {
  const pctC = pctClo(player.dayPct);
  // AC and live price stay in native currency (¥/£/$ — what the user typed/sees in their broker).
  // Cost / Value / G/L convert to USD using the per-player FX rate populated by computeMetrics,
  // so the football-board total is always in one comparable currency. `fxPending`: that rate has
  // not loaded yet (it would be 1:1), so the dollar figures wait with a dash; the native ones stand.
  const sym = curSym(player.currency);
  const fx  = fxPending ? NaN : (player.fx ?? 1);
  const unrlPct   = player.cost > 0 ? ((player.lastPrice - player.cost) / player.cost) * 100 : 0;
  const unrlGlUSD = player.shares * (player.lastPrice - player.cost) * fx;
  const costUSD   = player.shares * player.cost * fx;
  const m = (s) => hideValues ? maskDigits(s) : s;
  return (
    <div
      className={`player-card ${flash ? "flash-" + flash : ""} ${isHot ? "hot" : ""}`}
      onClick={onClick}
      // Only focusable + keyboard-activatable when there's actually a
      // click action (edit mode → lot editor, otherwise → chart). When
      // onClick is undefined the card is inert, so it stays out of the
      // tab order. target === currentTarget keeps the remove button's
      // Enter/Space from bubbling up and double-firing.
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      } : undefined}
    >
      {isCaptain && <div className="armband small">C</div>}
      {isHot && <div className="hot-badge">⚽</div>}
      <div className="pc-top">
        <span className="pc-ticker mono">{player.ticker}</span>
        <span className="pc-day mono" style={{ color: pctC }}>
          {m(fmtMo(fxPending ? null : (player.dayChange ?? 0), { signed: true }))} ({fmtPe(player.dayPct)})
        </span>
      </div>
      <div className="pc-price mono">{m(`${sym}${fmtPri(player.lastPrice)}`)}</div>
      <div className="pc-rows">
        <div className="pc-row"><span className="dim">Shares</span><span className="mono">{m(fmtShFor(player.shares, player.ticker))}</span></div>
        <div className="pc-row"><span className="dim">AC</span><span className="mono">{m(`${sym}${fmtPri(player.cost)}`)}</span></div>
        <div className="pc-row"><span className="dim">Cost</span><span className="mono">{m(fmtMo(costUSD))}</span></div>
        <div className="pc-row"><span className="dim">Value</span><span className="mono">{m(fmtMo(fxPending ? null : player.marketValue))}</span></div>
        <div className="pc-row"><span className="dim">G/L</span>
          <span className="mono" style={{ color: pctClo(unrlPct) }}>{m(fmtMo(unrlGlUSD, { signed: true }))} ({fmtPe(unrlPct)})</span>
        </div>
      </div>
      {showRemove && (
        <button className="pc-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove">✕</button>
      )}
    </div>
  );
}

export { PositionDrillModal, PlayerCard };
