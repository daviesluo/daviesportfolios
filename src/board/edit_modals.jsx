// The editors a click opens on the board, out of the main bundle (batch 5's size budget, 2026-10-08): the lot editor
// (EditTickerModal), adding a holding (AddTickerModal) and cash on hand (CashModal). Only an admin reaches them, always
// from a click, so the app loads this chunk after its first paint (`prefetchModalChunks`) instead of in front of it. The
// frame they draw in, `Modal`, and the themed confirm stay in modals.jsx, which the board itself uses.
import React from 'react';
import { fmtSharesFor as fmtShFor, pctColor as pctClo, normalizeDecimalInput } from '../app/formatters.js';
import { currencySymbol as curSym, detectCurrency } from '../portfolio/fx.js';
import { cleanLots } from '../portfolio/lots.js';
import { ledgerProvenance, SRC_OTHER } from '../portfolio/t212_fills.js';
import { cleanSells, netPosition, realizedGain, toLedgerRows, fromLedgerRows } from '../portfolio/transactions.js';
import { Modal, useConfirm } from './modals.jsx';

// Shared options for the "Discard unsaved changes?" confirm reused by the
// edit / cash modals' close + move paths.
const DISCARD_CONFIRM = /** @type {const} */ ({
  title: 'UNSAVED CHANGES', message: 'Discard unsaved changes?',
  confirmLabel: 'Discard', danger: true,
});

// Per-lot editor. Each row is a single purchase batch; total shares and
// weighted-average cost are derived from the rows on save and become the
// holding's `shares`/`cost` (lots are the source of truth for the YTD chart).
function EditTickerModal({ ticker, holding, positions, t212Orders = /** @type {any[]} */ ([]), t212OrdersComplete = false, dividends = /** @type {any[]} */ ([]), onClose, onSave, onDelete, onMove }) {
  const today = new Date().toISOString().slice(0, 10);
  // ONE list, newest at the top, buys and sells together — a holding's
  // history read in the order it happened, which is how it reads on the
  // broker's own statement. Two grids was fine for four hand-typed rows
  // and unusable for a hundred synced fills.
  //
  // Sorted once, at mount. Re-sorting on every keystroke would make a row
  // jump out from under the cursor the moment its date changed.
  /** @type {[Array<{kind:'buy'|'sell',date:string,shares:string,price:string,ts?:number,src?:string}>, Function]} */
  const [rows, setRows] = React.useState(() => {
    const seeded = toLedgerRows(holding);
    return seeded.length > 0 ? seeded : [{
      kind: /** @type {const} */ ('buy'),
      date: today,
      shares: String(holding.shares || 0),
      price: String(holding.cost || 0),
    }];
  });
  // The rest of the app stores `{ lots, sells }`; the editor is the only
  // place they're one list. Derived rather than duplicated so there is no
  // second copy to keep in step.
  const { lots, sells } = React.useMemo(() => fromLedgerRows(rows), [rows]);

  // Snapshot the initial rows once at mount so we can detect "dirty"
  // state on close. Without this, an outside-click on the backdrop
  // (or a stray Cancel/✕) silently discards everything the user just
  // typed — and the symptom only shows up at the next refresh when
  // the user notices old numbers.
  const [initialJSON] = React.useState(() => JSON.stringify(rows));
  const isDirty = React.useMemo(
    () => JSON.stringify(rows) !== initialJSON,
    [rows, initialJSON],
  );
  const { confirm, element: confirmEl } = useConfirm();
  const safeClose = React.useCallback(async () => {
    if (isDirty && !(await confirm(DISCARD_CONFIRM))) return;
    onClose();
  }, [isDirty, onClose, confirm]);

  const sym = curSym(holding.currency);
  const acHint = holding.currency && holding.currency !== "USD"
    ? `Costs are in ${holding.currency} (${sym}). Board values use live FX to convert to USD.`
    : null;

  const updateRow = (idx, patch) => {
    setRows(/** @param {any[]} rs */ rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };
  const removeRow = (idx) => {
    setRows(/** @param {any[]} rs */ rs => rs.filter((_, i) => i !== idx));
  };
  // New rows go to the TOP, where the newest belong, and carry
  // `src: 'other'` — a trade made somewhere Trading 212 can't see.
  // Without that mark the next refresh would rebuild the ledger from the
  // broker's fills and this row would vanish. `ts` keeps same-day rows in
  // the order they were entered.
  const addRow = (kind) => {
    setRows(/** @param {any[]} rs */ rs => [
      { kind, date: today, shares: '', price: '', ts: Date.now(), src: SRC_OTHER },
      ...rs,
    ]);
  };

  // Preview NET position / AC reflects only rows that survive cleanLots /
  // cleanSells on save (same coercion), so the on-screen summary can't
  // disagree with what gets stored. netPosition folds realized P&L into
  // the basis (net-cash model — see transactions.js); realizedGain is the
  // banked profit on this ticker, surfaced only once a sale exists.
  const validLots = cleanLots(lots);
  const validSells = cleanSells(sells);
  // Dividends this ticker has paid come off the average cost and count in
  // what it realized, as on the board and in the Transaction history. They
  // are the broker's record, not rows of this editor, and saving stores the
  // rows' own cost: the board takes the dividends off again when it shows it.
  const net = netPosition(lots, sells, dividends);
  const weightedCost = net.avgCost;
  const realized = realizedGain(lots, sells, dividends);
  const hasSells = validSells.length > 0;
  const dividendTotal = dividends.reduce((sum, d) => sum + (Number(d?.amount) || 0), 0);
  // Future-dated rows get dropped on save. The date input's max=today
  // blocks the picker, but a paste / typed value still gets through — and
  // used to vanish on Save with no feedback. Only future dates are flagged
  // (every row starts at date=today, so a future date looks deliberate);
  // half-typed shares/price rows are normal mid-edit states a warning
  // would nag on. Counts buy + sell rows.
  const futureCount = rows.filter(
    (r) => typeof r?.date === 'string' && r.date.trim() > today,
  ).length;

  // Where the rows above came from. The refresh tick rebuilds a synced
  // holding's ledger out of the broker's own fills (t212_fills.js), so
  // most of the time the answer is simply "these ARE the trades" — worth
  // saying once, because the ledger used to be whatever was last typed
  // in and looked stale for months at a time.
  //
  // Memoised on the state arrays, not the cleaned copies — those are
  // fresh objects every render, and this walks the whole order table.
  const provenance = React.useMemo(
    () => ledgerProvenance({ ...holding, lots, sells }, t212Orders, ticker, t212OrdersComplete),
    [holding, lots, sells, t212Orders, ticker, t212OrdersComplete],
  );

  // Saving rewrites `shares` from the rows above (updateHolding →
  // netPosition), and on this book the ledger is routinely SHORT of the
  // board: 16 of 26 holdings carry lots that don't add up to what's
  // held, because shares bought elsewhere were never typed in. Saving
  // such a holding silently deletes the difference — the exact loss a
  // T212 sync caused on SPCX / RKLB / HOOD. Say so before it happens
  // rather than after.
  const boardShares = Number(holding.shares);
  const shortfall = Number.isFinite(boardShares) && boardShares > 0
    ? boardShares - net.shares
    : 0;
  const willShrink = shortfall > 1e-6;

  // `cleanLots` / `cleanSells` are the single source of truth for which
  // rows are kept and how values are coerced (shares > 0, cost/price ≥ 0,
  // YYYY-MM-DD date), pinned in lots.test.js / transactions.test.js. The
  // net-0 close (drop from the board, keep the history) is handled in
  // updateHolding once these land.
  const save = () => onSave({ lots: cleanLots(lots), sells: cleanSells(sells) });

  // "Move holding" — relocate this ticker to a different tactics-board
  // position. The picker is a two-step reveal (button → select + Move)
  // so an accidental tap can't relocate the holding. Targets exclude
  // GK (the cash-only keeper slot) and the position the ticker already
  // sits in. Moving applies the position change only (like Delete, it
  // doesn't persist unsaved lot edits) and closes.
  const [showMove, setShowMove] = React.useState(false);
  /** @type {React.MutableRefObject<HTMLDivElement | null>} */
  const moveRowRef = React.useRef(null);
  const posMap = positions && typeof positions === 'object' ? positions : {};
  const currentPosKey = Object.keys(posMap).find(
    (k) => Array.isArray(posMap[k].tickers) && posMap[k].tickers.includes(ticker),
  );
  const moveTargets = Object.keys(posMap).filter((k) => k !== 'GK' && k !== currentPosKey);
  const [moveTarget, setMoveTarget] = React.useState(moveTargets[0] || '');
  const posLabel = (k) => {
    const pos = posMap[k] || {};
    return pos.subtitle ? `${pos.label} · ${pos.subtitle}` : (pos.label || k);
  };
  const canMove = typeof onMove === 'function' && moveTargets.length > 0;
  // Move applies the position change only and closes — so if the user
  // typed lot edits first, those would be silently dropped. Gate it
  // with the SAME discard-confirm as Cancel/✕/backdrop (safeClose):
  // unlike Delete (where the whole holding goes anyway), Move keeps
  // the holding, so losing the edits without a prompt is a surprise.
  const doMove = async () => {
    if (!moveTarget) return;
    if (isDirty && !(await confirm(DISCARD_CONFIRM))) return;
    onMove(moveTarget);
  };
  // The picker is the last child of the scrollable .modal-body while the
  // "Move holding" button lives in the fixed .modal-foot. For a holding
  // with a long lot/sell history the body already overflows, so the
  // freshly-revealed row mounts below the fold and the click reads as
  // "Move holding did nothing" (the toggle fired, the reveal was just
  // off-screen). Pull it on-screen whenever it opens.
  React.useEffect(() => {
    if (showMove) moveRowRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [showMove]);

  return (
    <Modal onClose={safeClose} size="md">
      {confirmEl}
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">EDIT HOLDING</div>
          <h2 className="modal-title mono">{ticker}</h2>
        </div>
        <button className="btn-ghost icon" onClick={safeClose} aria-label="Close">✕</button>
      </header>

      <div className="modal-body">
        <div className="lot-summary">
          <div><span className="lot-summary-label mono">NET SHARES</span><span className="lot-summary-val mono">{fmtShFor(net.shares, ticker)}</span></div>
          <div><span className="lot-summary-label mono">AVG COST ({sym})</span><span className="lot-summary-val mono">{weightedCost.toFixed(2)}</span></div>
          {hasSells && (
            <div><span className="lot-summary-label mono">REALIZED G/L ({sym})</span>
              <span className="lot-summary-val mono" style={{ color: pctClo(realized) }}>
                {(realized >= 0 ? '+' : '') + realized.toFixed(2)}
              </span>
            </div>
          )}
        </div>
        {acHint && <div className="lot-hint mono dim">{acHint}</div>}
        {dividends.length > 0 && (
          <div className="lot-hint mono dim">
            {`Avg cost is net of ${dividends.length} dividend${dividends.length === 1 ? '' : 's'} received (${sym}${dividendTotal.toFixed(2)}).`}
          </div>
        )}
        {futureCount > 0 && (
          <div className="lot-warn mono" role="alert">
            {futureCount === 1
              ? '1 entry is dated in the future and will be dropped on save.'
              : `${futureCount} entries are dated in the future and will be dropped on save.`}
          </div>
        )}
        {net.shares < 0 && (
          <div className="lot-warn mono" role="alert">
            Sales exceed purchases by {fmtShFor(-net.shares, ticker)} shares — check the numbers.
          </div>
        )}
        {net.shares === 0 && validLots.length > 0 && (
          <div className="lot-hint mono dim">Net position is 0 — Save closes this holding (its history stays in Transaction history).</div>
        )}
        {willShrink && net.shares > 0 && (
          <div className="lot-warn mono" role="alert">
            These rows add up to {fmtShFor(net.shares, ticker)} shares, not the{' '}
            {fmtShFor(boardShares, ticker)} you hold. Saving now drops the other{' '}
            {fmtShFor(shortfall, ticker)}.
          </div>
        )}

        <div className="lot-grid">
          <div className="lot-grid-head mono">
            <span />
            <span>Date</span>
            <span>Shares</span>
            <span>Price ({sym})</span>
            <span />
          </div>
          {rows.length === 0 && (
            <div className="lot-empty mono dim">No trades yet — click "Add buy" to record one.</div>
          )}
          {rows.map((r, i) => (
            <div key={i} className="lot-grid-row">
              <button
                className={`txn-badge txn-${r.kind} kind-toggle`}
                onClick={() => updateRow(i, { kind: r.kind === 'buy' ? 'sell' : 'buy' })}
                title="Switch between buy and sell"
                aria-label={`${r.kind === 'buy' ? 'Buy' : 'Sell'} — click to switch`}
              >{r.kind === 'buy' ? 'BUY' : 'SELL'}</button>
              <input className="inp mono" type="date" value={r.date} max={today}
                     onChange={(e) => updateRow(i, { date: e.target.value })} />
              <input className="inp mono" inputMode="decimal" value={r.shares}
                     onChange={(e) => updateRow(i, { shares: normalizeDecimalInput(e.target.value) })} placeholder="0" />
              <input className="inp mono" inputMode="decimal" value={r.price}
                     onChange={(e) => updateRow(i, { price: normalizeDecimalInput(e.target.value) })} placeholder="0" />
              <button className="btn-ghost icon" onClick={() => removeRow(i)} aria-label="Remove row" title="Remove row">✕</button>
            </div>
          ))}
        </div>

        <div className="lot-add-row">
          <button className="btn-ghost lot-add" onClick={() => addRow('buy')}>+ Add buy</button>
          <button className="btn-ghost lot-add" onClick={() => addRow('sell')}>+ Add sell</button>
        </div>

        {provenance.state === 'synced' && (
          <div className="ledger-src mono dim">
            Synced from Trading 212
            {provenance.other > 0 ? ', plus your Robinhood buys.' : '.'}
          </div>
        )}
        {provenance.state === 'pending' && (
          <div className="ledger-src mono dim">
            Still loading from Trading 212.
          </div>
        )}

        {showMove && canMove && (
          <div className="move-row" ref={moveRowRef}>
            <span className="lot-summary-label mono">MOVE TO</span>
            <select
              className="inp mono move-select"
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              aria-label="Move holding to position"
            >
              {moveTargets.map((k) => (
                <option key={k} value={k}>{posLabel(k)}</option>
              ))}
            </select>
            <button className="btn-primary" onClick={doMove} disabled={!moveTarget}>Move</button>
            <button className="btn-ghost" onClick={() => setShowMove(false)}>Cancel</button>
          </div>
        )}
      </div>

      <footer className="modal-foot">
        <button className="btn-danger" onClick={onDelete}>Delete holding</button>
        {canMove && (
          <button className="btn-ghost" onClick={() => setShowMove(v => !v)}>Move holding</button>
        )}
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
  const { confirm, element: confirmEl } = useConfirm();
  const safeClose = React.useCallback(async () => {
    if (isDirty && !(await confirm(DISCARD_CONFIRM))) return;
    onClose();
  }, [isDirty, onClose, confirm]);
  const save = () => { onSave(Number(val) || 0); };
  return (
    <Modal onClose={safeClose} size="sm">
      {confirmEl}
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">GOALKEEPER · CASH</div>
          <h2 className="modal-title">Cash on hand</h2>
        </div>
        <button className="btn-ghost icon" onClick={safeClose} aria-label="Close">✕</button>
      </header>
      <div className="modal-body form">
        <FormRow label="Amount (USD)">
          <input className="inp mono" autoFocus value={val} onChange={(e) => setVal(normalizeDecimalInput(e.target.value))} inputMode="decimal" />
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

  // Currency follows the ticker the user is typing — 6-digit → ¥, .L → £,
  // euro-zone suffix (.PA/.AS/.DE/…) → €, else $.
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
        <FormRow label="Shares"><input className="inp mono" value={shares} onChange={(e) => setShares(normalizeDecimalInput(e.target.value))} inputMode="decimal" /></FormRow>
        <FormRow label={`Avg cost (${sym})`} hint={costHint}><input className="inp mono" value={cost} onChange={(e) => setCost(normalizeDecimalInput(e.target.value))} inputMode="decimal" /></FormRow>
        <FormRow label={`Last price (${sym})`} hint="Leave blank to use avg cost until first live refresh">
          <input className="inp mono" value={lastPrice} onChange={(e) => setLastPrice(normalizeDecimalInput(e.target.value))} inputMode="decimal" />
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

/** @param {{ label: string, hint?: string | null, children: any }} props */
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

export { EditTickerModal, AddTickerModal, CashModal, FormRow };
