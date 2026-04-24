// Modals: position drill-in, edit ticker, add ticker
const { fmtMoney: fmtMo, fmtPct: fmtPe, fmtPrice: fmtPri, pctColor: pctClo } = window.Utils;

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

function PositionDrillModal({ posKey, position, captainTicker, hotMoverTicker, flashTickers, editMode, isReadOnly, onClose, onEditTicker, onAddTicker, onRemoveTicker }) {
  if (!position) return null;

  const sorted = [...position.players].sort((a, b) => b.marketValue - a.marketValue);

  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">{posKey} · POSITION</div>
          <h2 className="modal-title">
            {position.label}
            {position.subtitle && <span className="modal-sub"> · {position.subtitle}</span>}
          </h2>
          <div className="modal-meta mono">
            <span>{fmtMo(position.marketValue)} Value</span>
            <span style={{ color: pctClo(position.dayPct) }}>{fmtMo(position.dayChange, { signed: true })} ({fmtPe(position.dayPct)}) today</span>
            <span style={{ color: pctClo(position.unrlPct) }}>{fmtMo(position.unrlGL, { signed: true })} ({fmtPe(position.unrlPct)}) G/L</span>
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
                onClick={isReadOnly ? undefined : () => onEditTicker(p.ticker)}
                onRemove={() => onRemoveTicker(p.ticker)}
                showRemove={editMode && !isReadOnly}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PlayerCard({ player, isCaptain, isHot, flash, onClick, onRemove, showRemove }) {
  const pctC = pctClo(player.dayPct);
  const unrlPct = player.cost > 0 ? ((player.lastPrice - player.cost) / player.cost) * 100 : 0;
  const unrlGl = player.shares * (player.lastPrice - player.cost);
  return (
    <div className={`player-card ${flash ? "flash-" + flash : ""} ${isHot ? "hot" : ""}`} onClick={onClick}>
      {isCaptain && <div className="armband small">C</div>}
      {isHot && <div className="hot-badge">⚽</div>}
      <div className="pc-top">
        <span className="pc-ticker mono">{player.ticker}</span>
        <span className={`pc-pct mono`} style={{ color: pctC }}>{fmtPe(player.dayPct)}</span>
      </div>
      <div className="pc-price mono">${fmtPri(player.lastPrice)}</div>
      <div className="pc-rows">
        <div className="pc-row"><span className="dim">Shares</span><span className="mono">{player.shares}</span></div>
        <div className="pc-row"><span className="dim">AC</span><span className="mono">${fmtPri(player.cost)}</span></div>
        <div className="pc-row"><span className="dim">Cost</span><span className="mono">{fmtMo(player.shares * player.cost)}</span></div>
        <div className="pc-row"><span className="dim">Value</span><span className="mono">{fmtMo(player.marketValue)}</span></div>
        <div className="pc-row"><span className="dim">G/L</span>
          <span className="mono" style={{ color: pctClo(unrlPct) }}>{fmtMo(unrlGl, { signed: true })} ({fmtPe(unrlPct)})</span>
        </div>
      </div>
      {showRemove && (
        <button className="pc-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Remove">✕</button>
      )}
    </div>
  );
}

function EditTickerModal({ ticker, holding, onClose, onSave, onDelete }) {
  const [shares, setShares] = React.useState(String(holding.shares));
  const [cost, setCost] = React.useState(String(holding.cost));

  const save = () => {
    onSave({
      shares: Number(shares) || 0,
      cost: Number(cost) || 0,
    });
  };

  return (
    <Modal onClose={onClose} size="sm">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">EDIT HOLDING</div>
          <h2 className="modal-title mono">{ticker}</h2>
        </div>
        <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <div className="modal-body form">
        <FormRow label="Shares"><input className="inp mono" value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" /></FormRow>
        <FormRow label="Avg cost" hint="Price refreshes automatically from live data"><input className="inp mono" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" /></FormRow>
      </div>

      <footer className="modal-foot">
        <button className="btn-danger" onClick={onDelete}>Delete</button>
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

  const submit = () => {
    if (!ticker.trim()) return;
    onAdd(ticker, shares, cost, lastPrice || cost);
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
        <FormRow label="Ticker" hint="e.g. NVDA, BTC-USD"><input className="inp mono upper" autoFocus value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} /></FormRow>
        <FormRow label="Shares"><input className="inp mono" value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" /></FormRow>
        <FormRow label="Avg cost"><input className="inp mono" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" /></FormRow>
        <FormRow label="Last price" hint="Leave blank to use avg cost until first live refresh">
          <input className="inp mono" value={lastPrice} onChange={(e) => setLastPrice(e.target.value)} inputMode="decimal" />
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

function FormRow({ label, hint, children }) {
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

Object.assign(window, { Modal, PositionDrillModal, PlayerCard, EditTickerModal, AddTickerModal, CashModal, FormRow });
