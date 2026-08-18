// Modals: position drill-in, edit ticker, add ticker
import React from 'react';
import { createPortal } from 'react-dom';
import {
  fmtMoney as fmtMo,
  fmtPct as fmtPe,
  fmtPrice as fmtPri,
  fmtSharesFor as fmtShFor,
  pctColor as pctClo,
  maskDigits,
} from './formatters.js';
import { currencySymbol as curSym, detectCurrency } from './fx.js';
import { cleanLots } from './lots.js';
import { reconcileFills, withFillsApplied } from './t212_fills.js';
import { cleanSells, netPosition, realizedGain } from './transactions.js';

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

/**
 * Themed confirm dialog — the in-app replacement for window.confirm
 * (whose bare system chrome sat outside the dark theme and looked like an
 * OS error in the iOS PWA). Portaled to <body> so it stacks above any
 * modal it's invoked from: the other modals sit under a backdrop-filtered
 * `.modal-backdrop`, which establishes a containing block that would
 * otherwise trap a nested fixed dialog. Reached via useConfirm(), never
 * rendered directly. `danger` tints the action button red for
 * destructive confirms (delete / discard / reset).
 * @param {{ title?: string, message: string, detail?: string,
 *   confirmLabel?: string, cancelLabel?: string, danger?: boolean,
 *   onConfirm: () => void, onCancel: () => void }} props
 */
function ConfirmModal({ title, message, detail, confirmLabel, cancelLabel, danger, onConfirm, onCancel }) {
  return createPortal(
    <Modal onClose={onCancel} size="sm">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">{title || 'CONFIRM'}</div>
          <h2 className="modal-title">{message}</h2>
        </div>
      </header>
      {detail && (
        <div className="modal-body">
          <p className="confirm-detail">{detail}</p>
        </div>
      )}
      <footer className="modal-foot">
        <button className="btn-ghost" onClick={onCancel}>{cancelLabel || 'Cancel'}</button>
        <span className="spacer" />
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
          {confirmLabel || 'Confirm'}
        </button>
      </footer>
    </Modal>,
    document.body,
  );
}

/**
 * Themed window.confirm. Returns `{ confirm, element }`: `await confirm(opts)`
 * resolves to true (confirmed) / false (cancelled or backdrop / Esc), and
 * `element` must be rendered somewhere in the component so the dialog can
 * mount (it portals to <body>, so where doesn't matter). `opts` is a
 * message string or `{ title, message, detail, confirmLabel, cancelLabel,
 * danger }`. An object (not a tuple) so the destructured types survive the
 * import into app.jsx. Self-contained per component — no provider to wire.
 */
export function useConfirm() {
  const [state, setState] = React.useState(/** @type {any} */ (null));
  const confirm = React.useCallback((/** @type {string | object} */ opts) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise((resolve) => setState({ ...o, resolve }));
  }, []);
  const element = state ? (
    <ConfirmModal
      title={state.title}
      message={state.message}
      detail={state.detail}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      onConfirm={() => { state.resolve(true); setState(null); }}
      onCancel={() => { state.resolve(false); setState(null); }}
    />
  ) : null;
  return { confirm, element };
}

// Shared options for the "Discard unsaved changes?" confirm reused by the
// edit / cash modals' close + move paths.
const DISCARD_CONFIRM = /** @type {const} */ ({
  title: 'UNSAVED CHANGES', message: 'Discard unsaved changes?',
  confirmLabel: 'Discard', danger: true,
});

// Same digit-mask helper used everywhere — replaces digits with `*`,
// keeping currency symbols / signs / punctuation so the placeholder is the
// same visual width as the real number.
// `maskDigits` is imported from formatters.js — single source of truth
// shared across header_sidebar / modals / pitch.

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
          {m(fmtMo(player.dayChange ?? 0, { signed: true }))} ({fmtPe(player.dayPct)})
        </span>
      </div>
      <div className="pc-price mono">{m(`${sym}${fmtPri(player.lastPrice)}`)}</div>
      <div className="pc-rows">
        <div className="pc-row"><span className="dim">Shares</span><span className="mono">{m(fmtShFor(player.shares, player.ticker))}</span></div>
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
function EditTickerModal({ ticker, holding, positions, t212Orders = /** @type {any[]} */ ([]), onClose, onSave, onDelete, onMove }) {
  const today = new Date().toISOString().slice(0, 10);
  const seed = (Array.isArray(holding.lots) && holding.lots.length > 0)
    ? holding.lots
    : [{ date: today, shares: holding.shares || 0, cost: holding.cost || 0 }];

  /** @type {[Array<{date:string,shares:string|number,cost:string|number,ts?:number}>, Function]} */
  const [lots, setLots] = React.useState(seed.map(l => ({
    date: l.date || today,
    shares: String(l.shares ?? ''),
    cost: String(l.cost ?? ''),
    // Preserve an existing entry timestamp so re-saving a holding doesn't
    // strip it (which would lose the Transaction History's same-day order).
    ...(typeof l.ts === 'number' ? { ts: l.ts } : {}),
  })));
  // Sell records — the SALES side of the ledger. Net position = buys −
  // sells under the net-cash model (transactions.js); on save these feed
  // the Transaction History too.
  /** @type {[Array<{date:string,shares:string|number,price:string|number,ts?:number}>, Function]} */
  const [sells, setSells] = React.useState(
    (Array.isArray(holding.sells) ? holding.sells : []).map(s => ({
      date: s.date || today,
      shares: String(s.shares ?? ''),
      price: String(s.price ?? ''),
      ...(typeof s.ts === 'number' ? { ts: s.ts } : {}),
    })),
  );

  // Snapshot the initial rows once at mount so we can detect "dirty"
  // state on close. Without this, an outside-click on the backdrop
  // (or a stray Cancel/✕) silently discards everything the user just
  // typed — and the symptom only shows up at the next refresh when
  // the user notices old numbers.
  const [initialJSON] = React.useState(() => JSON.stringify({ lots, sells }));
  const isDirty = React.useMemo(
    () => JSON.stringify({ lots, sells }) !== initialJSON,
    [lots, sells, initialJSON],
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

  const updateLot = (idx, patch) => {
    setLots(/** @param {any[]} ls */ ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLot = (idx) => {
    setLots(/** @param {any[]} ls */ ls => ls.filter((_, i) => i !== idx));
  };
  const addLot = () => {
    // Stamp the record time so the Transaction History can order multiple
    // same-day entries by when they were actually added, not alphabetically.
    setLots(/** @param {any[]} ls */ ls => [...ls, { date: today, shares: '', cost: '', ts: Date.now() }]);
  };
  const updateSell = (idx, patch) => {
    setSells(/** @param {any[]} ss */ ss => ss.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };
  const removeSell = (idx) => {
    setSells(/** @param {any[]} ss */ ss => ss.filter((_, i) => i !== idx));
  };
  const addSell = () => {
    setSells(/** @param {any[]} ss */ ss => [...ss, { date: today, shares: '', price: '', ts: Date.now() }]);
  };

  // Preview NET position / AC reflects only rows that survive cleanLots /
  // cleanSells on save (same coercion), so the on-screen summary can't
  // disagree with what gets stored. netPosition folds realized P&L into
  // the basis (net-cash model — see transactions.js); realizedGain is the
  // banked profit on this ticker, surfaced only once a sale exists.
  const validLots = cleanLots(lots);
  const validSells = cleanSells(sells);
  const net = netPosition(lots, sells);
  const weightedCost = net.avgCost;
  const realized = realizedGain(lots, sells);
  const hasSells = validSells.length > 0;
  // Future-dated rows get dropped on save. The date input's max=today
  // blocks the picker, but a paste / typed value still gets through — and
  // used to vanish on Save with no feedback. Only future dates are flagged
  // (every row starts at date=today, so a future date looks deliberate);
  // half-typed shares/price rows are normal mid-edit states a warning
  // would nag on. Counts buy + sell rows.
  const futureCount = [...lots, ...sells].filter(
    (r) => typeof r?.date === 'string' && r.date.trim() > today,
  ).length;

  // The broker's own record of what it executed for this ticker, matched
  // row by row against what's typed above. This is the answer to "why
  // does the history stop months ago": nothing has ever written to the
  // ledger except the owner, so a holding bought since the last manual
  // edit shows no trades at all. Read-only until "Add" is pressed —
  // folding them in is the owner's call, not a sync's.
  // Memoised on the state arrays, not on the cleaned copies — those are
  // fresh objects every render, and this walks the whole order table.
  const fills = React.useMemo(
    () => reconcileFills(t212Orders, ticker, { lots, sells }),
    [t212Orders, ticker, lots, sells],
  );
  const missingCount = fills.missingLots.length + fills.missingSells.length;
  const addMissingFills = () => {
    const next = withFillsApplied({ lots, sells }, fills.missingLots, fills.missingSells);
    setLots(next.lots.map(l => ({
      date: l.date, shares: String(l.shares ?? ''), cost: String(l.cost ?? ''),
      ...(typeof l.ts === 'number' ? { ts: l.ts } : {}),
    })));
    setSells(next.sells.map(sl => ({
      date: sl.date, shares: String(sl.shares ?? ''), price: String(sl.price ?? ''),
      ...(typeof sl.ts === 'number' ? { ts: sl.ts } : {}),
    })));
  };

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
            The board holds {fmtShFor(boardShares, ticker)} shares but these rows only account for{' '}
            {fmtShFor(net.shares, ticker)}. Saving drops the other {fmtShFor(shortfall, ticker)} —
            add the missing purchases first if they were bought elsewhere.
          </div>
        )}

        <div className="lot-grid">
          <div className="lot-grid-head mono">
            <span>Bought</span>
            <span>Shares</span>
            <span>Cost / share ({sym})</span>
            <span />
          </div>
          {lots.length === 0 && (
            <div className="lot-empty mono dim">No purchases — click "Add lot" to record a buy.</div>
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
        </div>

        {sells.length > 0 && (
          <div className="lot-grid sell-grid">
            <div className="lot-grid-head mono">
              <span>Sold</span>
              <span>Shares</span>
              <span>Sell price ({sym})</span>
              <span />
            </div>
            {sells.map((s, i) => (
              <div key={i} className="lot-grid-row">
                <input className="inp mono" type="date" value={s.date} max={today}
                       onChange={(e) => updateSell(i, { date: e.target.value })} />
                <input className="inp mono" inputMode="decimal" value={s.shares}
                       onChange={(e) => updateSell(i, { shares: e.target.value })} placeholder="0" />
                <input className="inp mono" inputMode="decimal" value={s.price}
                       onChange={(e) => updateSell(i, { price: e.target.value })} placeholder="0" />
                <button className="btn-ghost icon" onClick={() => removeSell(i)} aria-label="Remove sale" title="Remove sale">✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="lot-add-row">
          <button className="btn-ghost lot-add" onClick={addLot}>+ Add lot</button>
          <button className="btn-ghost lot-add" onClick={addSell}>+ Sell</button>
        </div>

        {fills.rows.length > 0 && (
          <div className="t212-fills">
            <div className="t212-fills-head">
              <span className="lot-summary-label mono">TRADING 212 FILLS</span>
              {missingCount > 0 && (
                <button className="btn-ghost lot-add" onClick={addMissingFills}>
                  + Add {missingCount} missing
                </button>
              )}
              {missingCount === 0 && (
                <span className="lot-hint mono dim">All recorded above.</span>
              )}
            </div>
            <div className="t212-fills-scroll">
              {fills.rows.map((f, i) => (
                <div key={`${f.date}-${f.kind}-${i}`} className={`t212-fill-row mono${f.known ? ' is-known' : ''}`}>
                  <span>{f.date}</span>
                  <span className={`txn-badge txn-${f.kind}`}>{f.kind === 'buy' ? 'BUY' : 'SELL'}</span>
                  <span className="t212-fill-num">{fmtShFor(f.shares, ticker)}</span>
                  <span className="t212-fill-num">{sym}{f.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="t212-fill-flag dim">{f.known ? '✓' : 'new'}</span>
                </div>
              ))}
            </div>
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

export { Modal, PositionDrillModal, PlayerCard, EditTickerModal, AddTickerModal, CashModal, FormRow };
