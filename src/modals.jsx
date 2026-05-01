// Modals: position drill-in, edit ticker, add ticker
import React from 'react';
import {
  fmtMoney as fmtMo,
  fmtPct as fmtPe,
  fmtPrice as fmtPri,
  pctColor as pctClo,
  currencySymbol as curSym,
  detectCurrency,
} from './utils.js';

function Modal({ children, onClose, size = "md" }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const downOnBackdrop = React.useRef(false);

  return (
    <div className="modal-backdrop"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={() => { if (downOnBackdrop.current) onClose(); }}
    >
      <div className={`modal size-${size}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// Same digit-mask helper used everywhere — replaces digits with `*`,
// keeping currency symbols / signs / punctuation so the placeholder is the
// same visual width as the real number.
// Bullet (•) instead of asterisk so masked rows stay vertically centered
// — see the comment on `mask()` in header_sidebar.jsx.
const maskDigits = (s) => typeof s === 'string' ? s.replace(/\d/g, '•') : s;

function PositionDrillModal({ posKey, position, captainTicker, hotMoverTicker, flashTickers, editMode, isReadOnly, onClose, onEditTicker, onViewChart, onAddTicker, onRemoveTicker, onUpdatePosition, hideValues }) {
  if (!position) return null;

  const sorted = [...position.players].sort((a, b) => b.marketValue - a.marketValue);
  const m = (s) => hideValues ? maskDigits(s) : s;

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
            <span>{m(fmtMo(position.marketValue))} Value</span>
            <span style={{ color: pctClo(position.dayPct) }}>{m(fmtMo(position.dayChange, { signed: true }))} ({fmtPe(position.dayPct)}) today</span>
            <span style={{ color: pctClo(position.unrlPct) }}>{m(fmtMo(position.unrlGL, { signed: true }))} ({fmtPe(position.unrlPct)}) G/L</span>
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
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PlayerCard({ player, isCaptain, isHot, flash, onClick, onRemove, showRemove, hideValues }) {
  const pctC = pctClo(player.dayPct);
  // AC and live price stay in native currency (¥/£/$ — what the user typed/sees in their broker).
  // Cost / Value / G/L convert to USD using the per-player FX rate populated by computeMetrics,
  // so the football-board total is always in one comparable currency.
  const sym = curSym(player.currency);
  const fx  = player.fx ?? 1;
  const unrlPct   = player.cost > 0 ? ((player.lastPrice - player.cost) / player.cost) * 100 : 0;
  const unrlGlUSD = player.shares * (player.lastPrice - player.cost) * fx;
  const costUSD   = player.shares * player.cost * fx;
  const m = (s) => hideValues ? maskDigits(s) : s;
  return (
    <div className={`player-card ${flash ? "flash-" + flash : ""} ${isHot ? "hot" : ""}`} onClick={onClick}>
      {isCaptain && <div className="armband small">C</div>}
      {isHot && <div className="hot-badge">⚽</div>}
      <div className="pc-top">
        <span className="pc-ticker mono">{player.ticker}</span>
        <span className="pc-day mono" style={{ color: pctC }}>
          {m(fmtMo(player.dayChange ?? 0, { signed: true }))} ({fmtPe(player.dayPct)})
        </span>
      </div>
      <div className="pc-price mono">{m(`${sym}${fmtPri(player.lastPrice)}`)}</div>
      <div className="pc-rows">
        <div className="pc-row"><span className="dim">Shares</span><span className="mono">{m(String(player.shares))}</span></div>
        <div className="pc-row"><span className="dim">AC</span><span className="mono">{m(`${sym}${fmtPri(player.cost)}`)}</span></div>
        <div className="pc-row"><span className="dim">Cost</span><span className="mono">{m(fmtMo(costUSD))}</span></div>
        <div className="pc-row"><span className="dim">Value</span><span className="mono">{m(fmtMo(player.marketValue))}</span></div>
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

// Per-lot editor. Each row is a single purchase batch; total shares and
// weighted-average cost are derived from the rows on save and become the
// holding's `shares`/`cost` (lots are the source of truth for the YTD chart).
function EditTickerModal({ ticker, holding, onClose, onSave, onDelete }) {
  const today = new Date().toISOString().slice(0, 10);
  const seed = (Array.isArray(holding.lots) && holding.lots.length > 0)
    ? holding.lots
    : [{ date: today, shares: holding.shares || 0, cost: holding.cost || 0 }];

  /** @type {[Array<{date:string,shares:string|number,cost:string|number}>, Function]} */
  const [lots, setLots] = React.useState(seed.map(l => ({
    date: l.date || today,
    shares: String(l.shares ?? ''),
    cost: String(l.cost ?? ''),
  })));

  const sym = curSym(holding.currency);
  const acHint = holding.currency && holding.currency !== "USD"
    ? `Costs are in ${holding.currency} (${sym}). Board values use live FX to convert to USD.`
    : null;

  const updateLot = (idx, patch) => {
    setLots(/** @param {any[]} ls */ ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLot = (idx) => {
    setLots(/** @param {any[]} ls */ ls => ls.filter((_, i) => i !== idx));
  };
  const addLot = () => {
    setLots(/** @param {any[]} ls */ ls => [...ls, { date: today, shares: '', cost: '' }]);
  };

  const totalShares = lots.reduce((s, l) => s + (Number(l.shares) || 0), 0);
  const weightedCost = totalShares > 0
    ? lots.reduce((s, l) => s + (Number(l.shares) || 0) * (Number(l.cost) || 0), 0) / totalShares
    : 0;

  const save = () => {
    const cleaned = lots
      .filter(l => Number(l.shares) > 0 && l.date)
      .map(l => ({
        date: l.date,
        shares: Number(l.shares) || 0,
        cost: Number(l.cost) || 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    onSave({ lots: cleaned });
  };

  return (
    <Modal onClose={onClose} size="md">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">EDIT HOLDING</div>
          <h2 className="modal-title mono">{ticker}</h2>
        </div>
        <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="modal-body">
        <div className="lot-summary">
          <div><span className="lot-summary-label mono">TOTAL SHARES</span><span className="lot-summary-val mono">{totalShares.toFixed(2)}</span></div>
          <div><span className="lot-summary-label mono">AVG COST ({sym})</span><span className="lot-summary-val mono">{weightedCost.toFixed(2)}</span></div>
        </div>
        {acHint && <div className="lot-hint mono dim">{acHint}</div>}

        <div className="lot-grid">
          <div className="lot-grid-head mono">
            <span>Date</span>
            <span>Shares</span>
            <span>Cost / share ({sym})</span>
            <span />
          </div>
          {lots.length === 0 && (
            <div className="lot-empty mono dim">No lots — click "Add lot" to record a purchase.</div>
          )}
          {lots.map((l, i) => (
            <div key={i} className="lot-grid-row">
              <input className="inp mono" type="date" value={l.date}
                     onChange={(e) => updateLot(i, { date: e.target.value })} />
              <input className="inp mono" inputMode="decimal" value={l.shares}
                     onChange={(e) => updateLot(i, { shares: e.target.value })} placeholder="0" />
              <input className="inp mono" inputMode="decimal" value={l.cost}
                     onChange={(e) => updateLot(i, { cost: e.target.value })} placeholder="0" />
              <button className="btn-ghost icon" onClick={() => removeLot(i)} aria-label="Remove lot" title="Remove lot">✕</button>
            </div>
          ))}
          <button className="btn-ghost lot-add" onClick={addLot}>+ Add lot</button>
        </div>
      </div>

      <footer className="modal-foot">
        <button className="btn-danger" onClick={onDelete}>Delete holding</button>
        <div className="spacer" />
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save}>Save</button>
      </footer>
    </Modal>
  );
}

function CashModal({ amount, onClose, onSave }) {
  const [val, setVal] = React.useState(String(amount || 0));
  const save = () => { onSave(Number(val) || 0); };
  return (
    <Modal onClose={onClose} size="sm">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">GOALKEEPER · CASH</div>
          <h2 className="modal-title">Cash on hand</h2>
        </div>
        <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <div className="modal-body form">
        <FormRow label="Amount (USD)">
          <input className="inp mono" autoFocus value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" />
        </FormRow>
      </div>
      <footer className="modal-foot">
        <div className="spacer" />
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save}>Save</button>
      </footer>
    </Modal>
  );
}

function AddTickerModal({ posKey, position, onClose, onAdd }) {
  const [ticker, setTicker] = React.useState("");
  const [shares, setShares] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [lastPrice, setLastPrice] = React.useState("");
  const [buyDate, setBuyDate] = React.useState(() => new Date().toISOString().slice(0, 10));

  // Currency follows the ticker the user is typing — 6-digit → ¥, .L → £, else $.
  const cur = detectCurrency(ticker.trim());
  const sym = curSym(cur);
  const costHint = cur === "USD"
    ? "In USD"
    : `In ${cur} (${sym}) — values on the board are converted to USD using live FX`;

  const submit = () => {
    if (!ticker.trim()) return;
    onAdd(ticker, shares, cost, lastPrice || cost, buyDate);
  };

  return (
    <Modal onClose={onClose} size="sm">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">SIGN PLAYER · {posKey}</div>
          <h2 className="modal-title">
            {position.label}
            {position.subtitle && <span className="modal-sub"> · {position.subtitle}</span>}
          </h2>
        </div>
        <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="modal-body form">
        <FormRow label="Ticker" hint="e.g. NVDA · BTC-USD · 017731 (CN fund) · VUAG.L (London)"><input className="inp mono upper" autoFocus value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} /></FormRow>
        <FormRow label="Shares"><input className="inp mono" value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" /></FormRow>
        <FormRow label={`Avg cost (${sym})`} hint={costHint}><input className="inp mono" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" /></FormRow>
        <FormRow label={`Last price (${sym})`} hint="Leave blank to use avg cost until first live refresh">
          <input className="inp mono" value={lastPrice} onChange={(e) => setLastPrice(e.target.value)} inputMode="decimal" />
        </FormRow>
        <FormRow label="Buy date" hint="Used by the YTD performance chart to compute historical portfolio value">
          <input type="date" className="inp mono" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
        </FormRow>
      </div>

      <footer className="modal-foot">
        <div className="spacer" />
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={!ticker.trim()}>Sign</button>
      </footer>
    </Modal>
  );
}

function FormRow({ label, hint = null, children }) {
  return (
    <label className="form-row">
      <div className="form-lbl">
        <span>{label}</span>
        {hint && <span className="form-hint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export { Modal, PositionDrillModal, PlayerCard, EditTickerModal, AddTickerModal, CashModal, FormRow };
