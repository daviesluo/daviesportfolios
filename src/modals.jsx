// Modals: position drill-in, edit ticker, add ticker
import React from 'react';
import {
  fmtMoney as fmtMo,
  fmtPct as fmtPe,
  fmtPrice as fmtPri,
  pctColor as pctClo,
  maskDigits,
} from './formatters.js';
import { currencySymbol as curSym, detectCurrency } from './fx.js';
import { cleanLots } from './lots.js';

// Ref-counted body scroll lock. PositionDrill can stack on top of the
// chart/edit/add modal, so two Modal instances can be mounted at once.
// If each captured/restored body.overflow independently, the second one
// to mount would capture 'hidden' from the first and restore that on
// unmount, leaving the page locked after every modal closes. Count
// active modals and only flip body styles at the 0↔1 boundary.
//
// On iOS Safari, `overflow: hidden` on <body> alone does NOT stop the
// page underneath from scrolling — the user's screenshot showed two
// scrollbars (the modal-body's *and* the home page's) and dragging the
// modal area still scrolled the home page in the background. The only
// reliable lock is `position: fixed` on <body> with the saved scroll
// offset pinned via `top`, restored on release. This trick is also
// what Bootstrap / Material-UI ship for the same reason.
let bodyLockCount = 0;
let savedScrollY = 0;
let savedBodyStyles = { position: '', top: '', left: '', right: '', width: '', overflow: '' };
function acquireBodyLock() {
  if (bodyLockCount === 0) {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    const s = document.body.style;
    savedBodyStyles = {
      position: s.position, top: s.top, left: s.left, right: s.right,
      width: s.width, overflow: s.overflow,
    };
    s.position = 'fixed';
    s.top = `-${savedScrollY}px`;
    s.left = '0';
    s.right = '0';
    s.width = '100%';
    s.overflow = 'hidden';
  }
  bodyLockCount += 1;
}
function releaseBodyLock() {
  bodyLockCount -= 1;
  if (bodyLockCount === 0) {
    const s = document.body.style;
    s.position = savedBodyStyles.position;
    s.top = savedBodyStyles.top;
    s.left = savedBodyStyles.left;
    s.right = savedBodyStyles.right;
    s.width = savedBodyStyles.width;
    s.overflow = savedBodyStyles.overflow;
    window.scrollTo(0, savedScrollY);
  }
}

function Modal({ children, onClose, size = "md" }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while any modal is mounted so iOS Safari's bouncy
  // overscroll can't drag the underlying page. See acquireBodyLock for
  // why `position: fixed` rather than just `overflow: hidden`.
  React.useEffect(() => {
    acquireBodyLock();
    return releaseBodyLock;
  }, []);

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
// `maskDigits` is imported from utils.js — single source of truth shared
// across header_sidebar / modals / pitch.

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

  // Snapshot the initial lots once at mount so we can detect "dirty"
  // state on close. Without this, an outside-click on the backdrop
  // (or a stray Cancel/✕) silently discards everything the user just
  // typed — and the symptom only shows up at the next refresh when
  // the user notices old numbers.
  const [initialLotsJSON] = React.useState(() => JSON.stringify(lots));
  const isDirty = React.useMemo(
    () => JSON.stringify(lots) !== initialLotsJSON,
    [lots, initialLotsJSON],
  );
  const safeClose = React.useCallback(() => {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }, [isDirty, onClose]);

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

  // Preview total / weighted AC reflects only rows that would survive
  // `cleanLots()` on save — otherwise the user could see e.g. a
  // negative-cost row pulling the weighted average down here and
  // then get a different number after pressing Save (where the bad
  // row gets dropped silently).
  const validLots = cleanLots(lots);
  const totalShares = validLots.reduce((s, l) => s + l.shares, 0);
  const weightedCost = totalShares > 0
    ? validLots.reduce((s, l) => s + l.shares * l.cost, 0) / totalShares
    : 0;

  // `cleanLots` (lots.js) is the single source of truth for which
  // lots are kept and how their values are coerced. Centralised so
  // the EditTicker save path and the YTD chart's lot iterator can't
  // disagree on what counts as a valid lot — and so the per-row
  // rules (shares > 0, cost ≥ 0, YYYY-MM-DD date) are pinned by
  // lots.test.js instead of living inline here.
  const save = () => onSave({ lots: cleanLots(lots) });

  return (
    <Modal onClose={safeClose} size="md">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">EDIT HOLDING</div>
          <h2 className="modal-title mono">{ticker}</h2>
        </div>
        <button className="btn-ghost icon" onClick={safeClose} aria-label="Close">✕</button>
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
              <input className="inp mono" type="date" value={l.date} max={today}
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
        <button className="btn-ghost" onClick={safeClose}>Cancel</button>
        <button className="btn-primary" onClick={save}>Save</button>
      </footer>
    </Modal>
  );
}

function CashModal({ amount, onClose, onSave }) {
  const [val, setVal] = React.useState(String(amount || 0));
  // Same dirty-flag confirm as EditTickerModal — typing a new cash
  // figure then bumping the backdrop / ✕ used to silently discard.
  const [initialVal] = React.useState(String(amount || 0));
  const isDirty = val !== initialVal;
  const safeClose = React.useCallback(() => {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }, [isDirty, onClose]);
  const save = () => { onSave(Number(val) || 0); };
  return (
    <Modal onClose={safeClose} size="sm">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">GOALKEEPER · CASH</div>
          <h2 className="modal-title">Cash on hand</h2>
        </div>
        <button className="btn-ghost icon" onClick={safeClose} aria-label="Close">✕</button>
      </header>
      <div className="modal-body form">
        <FormRow label="Amount (USD)">
          <input className="inp mono" autoFocus value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" />
        </FormRow>
      </div>
      <footer className="modal-foot">
        <div className="spacer" />
        <button className="btn-ghost" onClick={safeClose}>Cancel</button>
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
        <FormRow label="Ticker" hint="e.g. NVDA · BTC-USD · 017731 (CN fund) · VUAA.L (London)">
          <input className="inp mono upper" autoFocus value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        </FormRow>
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
