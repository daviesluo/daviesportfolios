// Agents — the crypto strategies page, opened from the ☰ menu below
// "Transaction history". One view of everything the `agents` Edge Function
// runs: the strategies (two rulebooks, each on Revolut X and on Kraken),
// what each holds and has made, the caps that bound them, the venues'
// health, and — per strategy — every decision with the words the model
// saw and every order with what the venue said.
//
// Nothing is computed here that could disagree with the server: positions
// and P&L arrive derived from fills (`runDashboard`), and the page only
// formats. Headline: the total realised G/L across every strategy, the
// way the transaction history leads with the book's.
import React from 'react';
import { Modal } from './modals.jsx';
import { fmtMoney, maskDigits, pctColor } from './formatters.js';
import {
  agentsAlerts, agentsErrorView, balanceLines, countdownText, decisionView, defaultChartSymbol, fetchAgentsChart, fetchAgentsDashboard, fetchAgentsLog, fillRows, fillsSummary, fmtBps, fmtFees, fmtFrac, fmtPctSigned, fmtUsd, glText, kindLabel, liveStateRows, observationView, orderView, positionLines, readAgentsCache, readChartCache, scoreboardView, shareSegments, strategyRows, strategyScoreboard, totalsView, venueHue, venueLabel, venueRows,
} from './agents.js';
import {
  CHART_PAD, CHART_PAD_SM, chartGeometry, fmtChartPrice, fmtChartStamp, hoverPoint, markPath, plotLabelY, tooltipBox, windowText,
} from './agents_chart.js';

const REFRESH_MS = 60_000;
const TICK_MS = 20_000;
const SURFACE = '#0f1815';   // the modal's own background — the 2px ring every overlapping mark wears

/** @param {string} iso */
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toISOString().slice(5, 16).replace('T', ' ');
};
/** The server writes its reasons in lower case; a paragraph starts with a capital. @param {string} t */
const sentence = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
/** @param {number | null} ms */
const ago = (ms) => (ms == null ? '—' : ms < 3600e3 ? `${Math.max(0, Math.floor(ms / 60e3))}m ago` : ms < 86400e3 ? `${Math.floor(ms / 3600e3)}h ago` : `${Math.floor(ms / 86400e3)}d ago`);

/**
 * Is this the phone layout? The same 760 px the stylesheet breaks at, so
 * the table and the cards can never both be the wrong one: below it the
 * twelve-column table is replaced by a card per strategy rather than
 * clipped down to two columns and a horizontal scroll.
 * @param {string} query
 */
function useMediaQuery(query) {
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  const [on, setOn] = React.useState(read);
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setOn(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return on;
}

function ModeBadge({ mode }) {
  return <span className={`ag-badge ag-badge-${mode}`}>{mode.toUpperCase()}</span>;
}

/** The venue, as a coloured badge: every position and every order says where it is. */
function VenueBadge({ id, signal = null }) {
  return (
    <span className={`ag-venue ag-venue-${id}`} title={signal && signal !== id ? `signals from ${venueLabel(signal)}` : undefined}>
      {venueLabel(id)}{signal && signal !== id ? <span className="ag-venue-signal"> ← {venueLabel(signal)}</span> : null}
    </span>
  );
}

function StatusDot({ status }) {
  return (
    <span className={`ag-status${status.running ? ' is-running' : ''}`} title={status.detail}>
      <span className="ag-dot" />
      <span className="ag-status-text">{status.running ? 'running' : status.detail}</span>
    </span>
  );
}

function Money({ v, signed = true, m }) {
  return <span className="mono" style={{ color: pctColor(v) }}>{m(fmtUsd(v, signed))}</span>;
}

/**
 * One cell of the scoreboard: a label, a signed amount, its percent — the home page's own shape.
 * @param {{ label: string, usd: number, pct: number | null, m: (s: string) => string, note?: string | null, cls?: string }} props
 */
function GlCell({ label, usd, pct, m, note = null, cls = '' }) {
  return (
    <div className={`ag-sb-cell ${cls}`}>
      <div className="sb-label">{label}</div>
      <div className="sb-value mono sb-change-row" style={{ color: pctColor(usd) }}>
        <span className="ag-sb-usd">{m(fmtMoney(usd ?? 0, { signed: true, compact: false }))}</span>
        {pct != null && Number.isFinite(pct) ? <span className="sb-pct">({fmtPctSigned(pct, 2)})</span> : null}
      </div>
      {note ? <div className="ag-sb-note mono dim">{note}</div> : null}
    </div>
  );
}

/**
 * The agents' scoreboard, in the home scoreboard's cells: what is deployed,
 * today's change (the UTC day), the total, unrealised and realised.
 */
function Scoreboard({ dash, m }) {
  const v = scoreboardView(dash);
  return (
    <>
    <div className="ag-scoreboard">
      <div className="ag-sb-cell ag-sb-cell-main">
        <div className="sb-label">DEPLOYED</div>
        <div className="sb-value sb-value-lg mono">{m(fmtUsd(v.valueUsd))}</div>
      </div>
      <div className="ag-sb-divider" />
      <GlCell label="TODAY" usd={v.todayUsd} pct={v.todayPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="TOTAL G/L" usd={v.totalUsd} pct={v.totalPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="UNREALIZED G/L" usd={v.unrealisedUsd} pct={v.unrealisedPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="REALIZED G/L" usd={v.realisedUsd} pct={v.realisedPct} m={m} cls="ag-sb-realised" />
    </div>
    <div className="ag-sb-under mono dim">
      {m(fmtUsd(v.capitalUsd))} paper capital · today since 00:00 UTC · percentages on capital, unrealised on the cost of what is held · fees {m(fmtUsd(v.feesUsd))}
    </div>
    </>
  );
}

/** The same cells for one strategy, at the top of its page. */
function StrategyScoreboard({ s, m }) {
  const v = strategyScoreboard(s);
  return (
    <>
    <div className="ag-scoreboard ag-scoreboard-sm">
      <div className="ag-sb-cell ag-sb-cell-main">
        <div className="sb-label">DEPLOYED</div>
        <div className="sb-value sb-value-lg mono">{m(fmtUsd(v.valueUsd))}</div>
      </div>
      <div className="ag-sb-divider" />
      <GlCell label="TODAY" usd={v.todayUsd} pct={v.todayPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="TOTAL G/L" usd={v.totalUsd} pct={v.totalPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="UNREALIZED G/L" usd={v.unrealisedUsd} pct={v.unrealisedPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="REALIZED G/L" usd={v.realisedUsd} pct={v.realisedPct} m={m} />
    </div>
    <div className="ag-sb-under mono dim">of {m(fmtUsd(v.capitalUsd))} capital · today since 00:00 UTC · fees {m(fmtUsd(v.feesUsd))}</div>
    </>
  );
}

function VenueSplit({ dash, m }) {
  const rows = venueRows(dash);
  const segments = shareSegments(rows);
  return (
    <section className="ag-venues">
      <div className="ag-section-title mono">VENUES</div>
      <div className="ag-share-bar">
        {segments.map((s) => (
          <span key={s.id} className={`ag-share ag-share-${s.id}`} style={{ width: `${s.widthPct}%` }} title={s.title}>
            {s.text}
          </span>
        ))}
      </div>
      <div className="ag-venue-cards">
        {rows.map((r) => (
          <div key={r.id} className={`ag-venue-card ag-venue-card-${r.id}${r.note ? ' is-warn' : ''}`}>
            <div className="ag-venue-head">
              <VenueBadge id={r.id} />
              <div className="dim mono ag-venue-meta">{r.strategies} strategies · {r.live} live · maker/taker {fmtFees(r.feeBps)}</div>
            </div>
            <div className="ag-venue-grid mono">
              <span className="dim">funded</span>
              <span className="ag-funded">{r.canTrade ? (balanceLines(r.balances).length ? balanceLines(r.balances).map((b) => <span key={b.code} className="ag-funded-line">{m(b.text)}</span>) : '—') : 'no key'}</span>
              <span className="dim">deployed</span><span className="hl-strong">{m(fmtUsd(r.valueUsd))}</span>
              <span className="dim" title="the notional each paper strategy may deploy; paper money, so the sum can exceed the real balance">paper capital</span><span>{m(fmtUsd(r.capitalUsd))}</span>
              <span className="dim">today</span><span className="ag-gl" style={{ color: pctColor(r.todayUsd) }}>{m(glText(r.todayUsd, r.capitalUsd > 0 ? (r.todayUsd / r.capitalUsd) * 100 : null))}</span>
              <span className="dim">total G/L</span><span className="ag-gl" style={{ color: pctColor(r.unrealisedUsd + r.realisedUsd) }}>{m(glText(r.unrealisedUsd + r.realisedUsd, r.capitalUsd > 0 ? ((r.unrealisedUsd + r.realisedUsd) / r.capitalUsd) * 100 : null))}</span>
              <span className="dim">fees</span><span className="dim">{m(fmtUsd(r.feesUsd))}</span>
            </div>
            {r.note && <div className="ag-warn-line">{r.note}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}


// Status and return first: the two facts that say whether a strategy is
// alive and making money sit right after its name at every width. The
// money detail (cost, value, unrealised, orders, last decision) hides
// under 760 px — it is all on the detail page — so a phone sees a whole
// row without scrolling.
const COLUMNS = [
  { id: 'name', label: 'Strategy', cls: 'hl-left' },
  { id: 'venue', label: 'Venue', cls: 'hl-left' },
  { id: 'mode', label: 'Mode', cls: 'hl-left' },
  { id: 'status', label: 'Status', cls: 'hl-left' },
  { id: 'unrealised', label: 'Unrealised G/L', cls: 'hl-right' },
  { id: 'realised', label: 'Realised G/L', cls: 'hl-right' },
  { id: 'next', label: 'Next', cls: 'hl-left' },
];

function StrategyCell({ id, r, m, onOpen }) {
  switch (id) {
    case 'name': return (
      <>
        <button type="button" className="ag-name-btn ag-name" onClick={() => onOpen(r.id)}>{r.name}</button>
        <span className="hl-sub dim">{r.openPositions} open · {m(fmtUsd(r.capitalUsd))} cap</span>
      </>
    );
    case 'venue': return <VenueBadge id={r.venueId} />;
    case 'mode': return <ModeBadge mode={r.mode} />;
    case 'status': return <StatusDot status={r.status} />;
    case 'unrealised': return <span className="ag-gl" style={{ color: pctColor(r.unrealisedUsd) }}>{m(glText(r.unrealisedUsd, r.unrealisedPct))}</span>;
    case 'realised': return <span className="ag-gl" style={{ color: pctColor(r.realisedUsd) }}>{m(glText(r.realisedUsd, r.realisedPct))}</span>;
    case 'next': return <span className="dim ag-next">{r.nextText}</span>;
    default: return null;
  }
}

function StrategyTable({ rows, m, onOpen }) {
  return (
    <div className="hl-scroll">
      <table className="hl-table ag-table mono">
        <thead>
          <tr>{COLUMNS.map((c) => <th key={c.id} className={`hl-th ${c.cls} ag-col-${c.id}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={COLUMNS.length}>No strategies yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="ag-row" onClick={() => onOpen(r.id)}>
              {COLUMNS.map((c) => (
                <td key={c.id} className={`${c.cls} ag-col-${c.id}${c.id === 'name' ? ' ag-name-cell' : ''}`}>
                  <StrategyCell id={c.id} r={r} m={m} onOpen={onOpen} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A phone gets a card per strategy instead of a seven-column table: the same facts, stacked. */
function StrategyCards({ rows, m, onOpen }) {
  if (!rows.length) return <div className="ag-empty dim">No strategies yet.</div>;
  return (
    <div className="ag-cards">
      {rows.map((r) => (
        <div key={r.id} className="ag-card-strategy ag-row" onClick={() => onOpen(r.id)}>
          <div className="ag-card-head ag-name-cell">
            <button type="button" className="ag-name-btn ag-name" onClick={() => onOpen(r.id)}>{r.name}</button>
            <span className="hl-sub dim">{r.openPositions} open · {m(fmtUsd(r.capitalUsd))} cap</span>
          </div>
          <div className="ag-card-badges"><VenueBadge id={r.venueId} /><ModeBadge mode={r.mode} /><StatusDot status={r.status} /></div>
          <div className="ag-card-gl mono">
            <span className="dim">unrealised</span><span className="ag-gl" style={{ color: pctColor(r.unrealisedUsd) }}>{m(glText(r.unrealisedUsd, r.unrealisedPct))}</span>
            <span className="dim">realised</span><span className="ag-gl" style={{ color: pctColor(r.realisedUsd) }}>{m(glText(r.realisedUsd, r.realisedPct))}</span>
            <span className="dim">next</span><span className="ag-next">{r.nextText}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** What stops everything trading, said out loud above the table: a global pause, a venue fault, a live venue with no key. */
function Alerts({ dash }) {
  const alerts = agentsAlerts(dash);
  if (!alerts.length) return null;
  return (
    <div className="ag-alerts">
      {alerts.map((a) => (
        <div key={a.id} className={`ag-alert is-${a.tone}`} role="status">
          <span className="ag-alert-icon" aria-hidden="true">{a.tone === 'stop' ? '⏸' : '⚠'}</span>
          <span className="ag-alert-label mono">{a.label}</span>
          <span className="ag-alert-text">{a.text}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A failure in words, with the way back: what kind of failure, one plain
 * sentence, the server's own message shortened, a retry, and the raw text
 * folded away for whoever needs it. The sibling of `NotReady`.
 */
/** @param {{ err: any, onRetry?: (() => void | Promise<void>) | null, compact?: boolean }} props */
function AgentsError({ err, onRetry = null, compact = false }) {
  const v = agentsErrorView(err);
  return (
    <div className={`ag-errorcard${compact ? ' is-compact' : ''}`} role="alert">
      <div className="ag-errorcard-title mono">{v.title}</div>
      <p className="ag-errorcard-text">{v.sentence}{v.short ? <> <span className="dim">{v.short}</span></> : null}</p>
      <div className="ag-errorcard-actions">
        {onRetry ? <button type="button" className="btn-ghost ag-retry" onClick={onRetry}>Try again</button> : <span className="dim">Retries with the next refresh.</span>}
        <details className="ag-errorcard-details"><summary className="dim mono">details</summary><pre className="mono">{v.detail}</pre></details>
      </div>
    </div>
  );
}


function Positions({ s, m }) {
  const rows = (s.positions ?? []).filter((p) => p.base > 0 || p.fills > 0);
  return (
    <section className="ag-section ag-positions">
      <div className="ag-section-title mono">POSITIONS</div>
      <div className="hl-scroll">
        <table className="hl-table ag-table mono">
          <thead><tr>
            <th className="hl-th hl-left">Symbol</th><th className="hl-th hl-left ag-ph">Venue</th><th className="hl-th hl-right">Size</th><th className="hl-th hl-right">Avg cost</th>
            <th className="hl-th hl-right ag-ph">Mark</th><th className="hl-th hl-right">Value</th><th className="hl-th hl-right">Unrealised</th>
            <th className="hl-th hl-right ag-ph">Realised</th><th className="hl-th hl-right ag-ph">Fees</th><th className="hl-th hl-right ag-ph">Fills</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={10}>Flat — nothing held yet.</td></tr>}
            {rows.map((p) => (
              <tr key={p.symbol}>
                <td className="hl-left hl-strong">{p.symbol}</td>
                <td className="hl-left ag-ph"><VenueBadge id={s.venue} /></td>
                <td className="hl-right">{p.base > 0 ? p.base.toFixed(6) : <span className="dim">flat</span>}</td>
                <td className="hl-right">{p.base > 0 ? m(fmtUsd(p.avgCost)) : '—'}</td>
                <td className="hl-right ag-ph">{m(fmtUsd(p.mark))}</td>
                <td className="hl-right hl-strong">{m(fmtUsd(p.valueUsd))}</td>
                <td className="hl-right"><Money v={p.unrealisedUsd} m={m} /></td>
                <td className="hl-right ag-ph"><Money v={p.realisedUsd} m={m} /></td>
                <td className="hl-right dim ag-ph">{m(fmtUsd(p.feesUsd))}</td>
                <td className="hl-right dim ag-ph">{p.fills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Decisions({ rows }) {
  return (
    <section className="ag-section">
      <div className="ag-section-title mono">DECISIONS</div>
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th hl-left">When (UTC)</th><th className="hl-th hl-left">Symbol</th><th className="hl-th hl-left">State</th>
            <th className="hl-th hl-left">Rule</th><th className="hl-th hl-left">Final</th><th className="hl-th hl-right ag-ph">P(healthy)</th>
            <th className="hl-th hl-right ag-ph">Caution</th><th className="hl-th hl-left ag-ph">Model</th><th className="hl-th hl-left ag-ph">Risk</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={9}>No decisions yet — the first comes at the next closed bar.</td></tr>}
            {rows.map((d) => (
              <tr key={d.id} title={d.reason}>
                <td className="hl-left dim">{when(d.ts)}</td>
                <td className="hl-left hl-strong">{d.symbol}</td>
                <td className="hl-left ag-state">{d.stateText}</td>
                <td className="hl-left"><span className={`ag-action ag-action-${d.ruleAction}`}>{d.ruleAction}</span></td>
                <td className="hl-left"><span className={`ag-action ag-action-${d.finalAction}`}>{d.finalAction}</span></td>
                <td className="hl-right ag-ph">{d.healthy == null ? <span className="dim">—</span> : d.healthy.toFixed(2)}</td>
                <td className="hl-right ag-ph">{d.caution == null ? <span className="dim">—</span> : d.caution.toFixed(2)}</td>
                <td className="hl-left dim ag-ph">{d.provider}{d.latencyMs ? ` · ${d.latencyMs} ms` : ''}</td>
                <td className="hl-left ag-ph">{d.allowed ? <span className="dim">ok</span> : <span className="ag-blocked" title={d.riskReason}>blocked</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Orders({ rows, m, venue }) {
  return (
    <section className="ag-section">
      <div className="ag-section-title mono">ORDERS</div>
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th hl-left">When (UTC)</th><th className="hl-th hl-left">Symbol</th><th className="hl-th hl-left ag-ph">Venue</th><th className="hl-th hl-left">Side</th>
            <th className="hl-th hl-right">Price</th><th className="hl-th hl-right ag-ph">Size</th><th className="hl-th hl-right ag-ph">Notional</th>
            <th className="hl-th hl-left">State</th><th className="hl-th hl-right ag-ph">Fill</th><th className="hl-th hl-right ag-ph">Fee</th><th className="hl-th hl-left ag-ph">Mode</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={11}>No orders yet.</td></tr>}
            {rows.map((o) => (
              <tr key={o.id} className={`txn-row txn-row-${o.side}`}>
                <td className="hl-left dim">{when(o.ts)}</td>
                <td className="hl-left hl-strong">{o.symbol}</td>
                <td className="hl-left ag-ph"><VenueBadge id={o.venue ?? venue} /></td>
                <td className="hl-left"><span className={`txn-badge txn-${o.side}`}>{o.side.toUpperCase()}</span></td>
                <td className="hl-right">{m(fmtUsd(o.price))}</td>
                <td className="hl-right ag-ph">{o.base.toFixed(6)}</td>
                <td className="hl-right ag-ph">{m(fmtUsd(o.notionalUsd))}</td>
                <td className="hl-left"><span className={`ag-state-pill ag-state-${o.state}`}>{o.state.replace('_', ' ')}</span></td>
                <td className="hl-right ag-ph">{o.fillPrice != null ? m(fmtUsd(o.fillPrice)) : <span className="dim">—</span>}</td>
                <td className="hl-right dim ag-ph">{m(fmtUsd(o.feeUsd))}</td>
                <td className="hl-left ag-ph"><ModeBadge mode={o.mode} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}




// ── The detail chart ────────────────────────────────────────────────────
// One strategy × symbol: the signal venue's closes, the strategy's own fills
// as buy and sell marks, any resting order as a dashed segment and the
// average cost as a dotted line. Geometry lives in `agents_chart.js`; this
// half only paints it.

/** The container's width, tracked — the modal is 880px on a desk and ~358px on a phone. */
function useMeasuredWidth() {
  const ref = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW((prev) => (prev === el.clientWidth ? prev : el.clientWidth));
    read();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return /** @type {const} */ ([ref, w]);
}

/**
 * A label inside the plot: it carries a surface-coloured backing so it stays
 * legible where it crosses the line.
 * @param {{ x: number, y: number, anchor?: 'start' | 'end', text: string }} props
 */
function PlotLabel({ x, y, anchor = 'start', text }) {
  const w = text.length * 5.4 + 8;
  return (
    <g>
      <rect x={(anchor === 'end' ? x - w + 4 : x - 4).toFixed(1)} y={(y - 9).toFixed(1)} width={w.toFixed(1)} height="12" rx="2" fill={SURFACE} opacity="0.85" />
      <text className={`ag-axis${anchor === 'end' ? ' ag-axis-resting' : ''}`} x={x.toFixed(1)} y={y.toFixed(1)} textAnchor={anchor}>{text}</text>
    </g>
  );
}

function LegendMark({ kind, side = 'buy' }) {
  return (
    <svg className="ag-legend-mark" width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
      {kind === 'fill'
        ? <path d={markPath(side, 7, 6, 4.5)} fill={side === 'buy' ? 'var(--gain)' : 'var(--loss)'} stroke={SURFACE} strokeWidth="1.5" strokeLinejoin="round" />
        : <line x1="1" y1="6" x2="13" y2="6" stroke={kind === 'resting' ? '#d9c37a' : 'var(--chalk-dim)'} strokeWidth="2"
            strokeDasharray={kind === 'resting' ? '4,3' : '1,2.5'} strokeLinecap="round" />}
    </svg>
  );
}

/**
 * The price chart. One series, so no legend for the line itself — the card's
 * header names it; the legend row below names the two MARK kinds, which is
 * the case a legend is for.
 */
function PriceChart({ chart, nowMs, hue }) {
  const [wrapRef, width] = useMeasuredWidth();
  const [hover, setHover] = React.useState(/** @type {any} */ (null));
  const compact = width > 0 && width < 520;
  const height = compact ? 190 : 230;
  const geo = React.useMemo(() => chartGeometry({
    candles: chart?.candles ?? [], fills: chart?.fills ?? [], orders: chart?.orders ?? [], position: chart?.position ?? null,
    intervalMin: chart?.intervalMin ?? 60, width: width || 640, height, nowMs, pad: compact ? CHART_PAD_SM : CHART_PAD,
  }), [chart, width, height, nowMs, compact]);

  const onMove = React.useCallback((e) => {
    const svg = e.currentTarget;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    if (clientX == null) return;
    setHover(hoverPoint(geo, (clientX - box.left) * (geo.width / box.width)));
  }, [geo]);

  const span = geo.priceSpan || 0;
  const tip = hover ? (() => {
    const lines = [`${fmtChartStamp(hover.t)} UTC`, `close  ${fmtChartPrice(hover.close, span)}`];
    for (const f of hover.fills) lines.push(`${f.side === 'buy' ? 'bought' : 'sold'} ${f.base.toFixed(6)} @ ${fmtChartPrice(f.price, span)}`);
    return { lines, box: tooltipBox(geo, hover.x, hover.y, lines) };
  })() : null;

  return (
    <div className="ag-chart" ref={wrapRef}>
      {geo.hasData && width > 0 && (
        <svg className="ag-chart-svg" viewBox={`0 0 ${geo.width} ${geo.height}`} width="100%" height={geo.height}
          style={{ display: 'block', touchAction: 'none' }} role="img"
          aria-label={`${chart.symbol} close, ${chart.fills?.length ?? 0} fills marked`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={onMove} onTouchMove={onMove}
        >
          {geo.yTicks.map((t) => (
            <g key={t.v}>
              <line x1={geo.x0} x2={geo.x1} y1={t.y.toFixed(1)} y2={t.y.toFixed(1)} stroke="var(--line-2)" strokeWidth="1" />
              <text className="ag-axis" x={geo.x0 - 7} y={t.y.toFixed(1)} textAnchor="end" dominantBaseline="middle">{t.label}</text>
            </g>
          ))}
          {geo.xTicks.map((t, i) => (
            <text key={t.t} className="ag-axis" x={t.x.toFixed(1)} y={geo.y1 + 15}
              textAnchor={i === 0 ? 'start' : i === geo.xTicks.length - 1 ? 'end' : 'middle'}>{t.label}</text>
          ))}
          <path d={geo.bandPath} fill={hue} opacity="0.1" />
          {geo.avgCost && (
            <g>
              <line x1={geo.x0} x2={geo.x1} y1={geo.avgCost.y.toFixed(1)} y2={geo.avgCost.y.toFixed(1)}
                stroke="var(--chalk-dim)" strokeWidth="1" strokeDasharray="1,3" />
              <PlotLabel x={geo.x0 + 5} y={geo.avgCost.y - 5} text={`avg cost ${fmtChartPrice(geo.avgCost.price, span)}`} />
            </g>
          )}
          {geo.restingLines.map((o) => (
            <g key={`rest-${o.id}`}>
              <line x1={o.xa.toFixed(1)} x2={o.xb.toFixed(1)} y1={o.y.toFixed(1)} y2={o.y.toFixed(1)}
                stroke="#d9c37a" strokeWidth="2" strokeDasharray="5,4" strokeLinecap="round" opacity="0.9" />
              <PlotLabel x={o.xb - 2} y={o.y - 6} anchor="end" text={`resting ${o.side}`} />
            </g>
          ))}
          <path d={geo.linePath} fill="none" stroke={hue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {geo.fillMarks.map((f) => (
            <path key={`fill-${f.id}`} className={`ag-fill-mark ag-fill-${f.side}`} d={markPath(f.side, f.x, f.y, 5)}
              fill={f.side === 'buy' ? 'var(--gain)' : 'var(--loss)'} stroke={SURFACE} strokeWidth="2" strokeLinejoin="round">
              <title>{`${f.side === 'buy' ? 'bought' : 'sold'} ${f.base.toFixed(6)} @ ${fmtChartPrice(f.price, span)} · ${fmtChartStamp(f.ts)} UTC`}</title>
            </path>
          ))}
          {hover && tip && (
            <g className="ag-cross" pointerEvents="none">
              <line x1={hover.x.toFixed(1)} x2={hover.x.toFixed(1)} y1={geo.y0} y2={geo.y1} stroke="var(--chalk-mute)" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx={hover.x.toFixed(1)} cy={hover.y.toFixed(1)} r="4" fill={hue} stroke={SURFACE} strokeWidth="2" />
              <rect x={tip.box.x.toFixed(1)} y={tip.box.y.toFixed(1)} width={tip.box.w.toFixed(1)} height={tip.box.h.toFixed(1)} rx="3"
                fill="#0c1310" stroke="var(--line)" />
              {tip.lines.map((l, i) => (
                <text key={i} className={`ag-tip${i === 0 ? ' ag-tip-head' : ''}`} x={tip.box.textX.toFixed(1)} y={(tip.box.firstY + i * tip.box.lineH).toFixed(1)}>{l}</text>
              ))}
            </g>
          )}
        </svg>
      )}
      {!geo.hasData && width > 0 && (
        <div className="ag-chart-blank">
          <div className="ag-chart-blank-title mono">No candles cached yet</div>
          <p className="dim">The loop fills this table every minute — the chart draws itself as soon as the first bars land.</p>
        </div>
      )}
      <div className="ag-chart-legend mono">
        <span className="ag-legend-item"><LegendMark kind="fill" side="buy" />buy fill</span>
        <span className="ag-legend-item"><LegendMark kind="fill" side="sell" />sell fill</span>
        {geo.restingLines.length > 0 && <span className="ag-legend-item"><LegendMark kind="resting" />resting order</span>}
        {geo.avgCost && <span className="ag-legend-item"><LegendMark kind="avg" />average cost</span>}
        <span className="ag-legend-hint dim">hover for the close</span>
      </div>
    </div>
  );
}

/** The fills the chart marks, as rows — the same events, read rather than seen. */
function Fills({ chart, m, venue }) {
  const rows = fillRows(chart);
  const sum = fillsSummary(chart);
  return (
    <div className="ag-fills">
      <div className="hl-scroll">
        <table className="hl-table ag-table mono">
          <thead><tr>
            <th className="hl-th hl-left">When (UTC)</th><th className="hl-th hl-left">Side</th><th className="hl-th hl-right">Price</th>
            <th className="hl-th hl-right">Size</th><th className="hl-th hl-right">Notional</th><th className="hl-th hl-right ag-ph">Fee</th>
            <th className="hl-th hl-left ag-ph">Venue</th><th className="hl-th hl-left ag-ph">Liquidity</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={8}>No fills on this pair in the window.</td></tr>}
            {rows.map((f) => (
              <tr key={f.id} className={`ag-fill-row ag-fill-row-${f.side}`}>
                <td className="hl-left dim">{fmtChartStamp(f.ts)}</td>
                <td className="hl-left">
                  <span className={`ag-side ag-side-${f.side}`}><span className="ag-side-mark" aria-hidden="true" />{f.side}</span>
                </td>
                <td className="hl-right hl-strong">{m(fmtUsd(f.price))}</td>
                <td className="hl-right">{f.base.toFixed(6)}</td>
                <td className="hl-right">{m(fmtUsd(f.notionalUsd))}</td>
                <td className="hl-right dim ag-ph">{m(fmtUsd(f.feeUsd))}</td>
                <td className="hl-left ag-ph"><VenueBadge id={f.venue ?? venue} /></td>
                <td className="hl-left dim ag-ph">{f.liquidity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ag-fills-sum mono dim">
        <span>{sum.count} fill{sum.count === 1 ? '' : 's'} <span className="dim">· {sum.buys} buy · {sum.sells} sell</span></span>
        <span>realised <Money v={sum.realisedUsd} m={m} /></span>
        <span>fees <span className="hl-strong">{m(fmtUsd(sum.feesUsd))}</span></span>
        {sum.openOrders > 0 && <span>{sum.openOrders} resting</span>}
        <span>{sum.decisions} decision{sum.decisions === 1 ? '' : 's'} in the window</span>
      </div>
    </div>
  );
}

/** The chart card: symbol tabs, the chart for the one selected, and its fills. */
function SymbolChart({ s, symbol, onSelect, m, nowMs, at }) {
  const [chart, setChart] = React.useState(/** @type {any} */ (() => readChartCache(s.id, symbol)?.chart ?? null));
  const [error, setError] = React.useState(/** @type {string | null} */ (null));
  const [loading, setLoading] = React.useState(() => !readChartCache(s.id, symbol));
  const held = new Map((s.positions ?? []).map((p) => [p.symbol, p]));

  // A new pair empties the card; the dashboard's own minute refresh (`at`)
  // only refetches — the frame stays, the way a live chart should.
  React.useEffect(() => { const c = readChartCache(s.id, symbol); setChart(c?.chart ?? null); setError(null); setLoading(!c); }, [s.id, symbol]);
  React.useEffect(() => {
    if (!symbol) return undefined;
    let alive = true;
    (async () => {
      try {
        const c = await fetchAgentsChart(s.id, symbol);
        if (!alive) return;
        if (c?.error) { setError(String(c.error)); setChart(null); } else { setChart(c); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [s.id, symbol, at]);

  const hue = venueHue(chart?.signalVenue ?? s.signalVenue ?? s.venue);
  // The chart's own position, so the header and the dotted average-cost
  // line can never disagree; the dashboard's row is the fallback.
  const book = chart?.position ?? held.get(symbol) ?? null;
  return (
    <section className="ag-section ag-chart-card">
      <div className="ag-section-title mono">PRICE &amp; FILLS</div>
      <div className="ag-tabs" role="tablist" aria-label="Symbols">
        {(s.symbols ?? []).map((sym) => {
          const p = held.get(sym);
          return (
            <button key={sym} type="button" role="tab" aria-selected={sym === symbol}
              className={`ag-sym-tab${sym === symbol ? ' is-on' : ''}`} onClick={() => onSelect(sym)}>
              {sym}
              {p && p.base > 0 ? <span className="ag-held" title="in position" /> : null}
            </button>
          );
        })}
      </div>
      <div className="ag-chart-head mono">
        <span className="ag-chart-sym hl-strong">{symbol}</span>
        {chart && <span className="dim">{windowText(chart.intervalMin, Date.parse(chart.at) - Date.parse(chart.since))}</span>}
        {chart?.candles?.length ? <span className="dim">last <span className="hl-strong">{fmtChartPrice(chart.candles[chart.candles.length - 1][4], Math.abs(chart.candles[chart.candles.length - 1][4]) * 0.05)}</span></span> : null}
        {book && book.base > 0
          ? <span className="dim">holding <span className="hl-strong">{m(book.base.toFixed(6))}</span> @ {m(fmtUsd(book.avgCost))}</span>
          : <span className="dim">flat</span>}
        {loading && !chart && <span className="dim">loading…</span>}
      </div>
      {error && <AgentsError err={error} compact />}
      {!error && !chart && loading && <div className="ag-chart-skeleton" aria-hidden="true" />}
      {!error && chart && (
        <>
          <PriceChart chart={chart} nowMs={nowMs} hue={hue} />
          <Fills chart={chart} m={m} venue={chart.venue ?? s.venue} />
        </>
      )}
    </section>
  );
}

/** The words the rule is reading right now, one row per symbol, refreshed with the dashboard. */
function LiveState({ s, nowMs, selected, onSelect }) {
  const rows = liveStateRows(s, nowMs);
  const any = rows.some((r) => r.observation);
  return (
    <section className="ag-section ag-live">
      <div className="ag-section-title mono">
        LIVE STATE</div>
      {!any && <div className="ag-live-empty dim">No reading yet. The loop writes one a minute for each symbol; the first lands within the minute.</div>}
      {any && rows.map((r) => (
        <button key={r.symbol} type="button" aria-pressed={r.symbol === selected}
          className={`ag-live-row${r.symbol === selected ? ' is-on' : ''}`} onClick={() => onSelect(r.symbol)}>
          <span className="ag-live-sym mono">{r.symbol}{r.base > 0 ? <span className="ag-held" title="in position" /> : null}</span>
          {r.observation ? (
            <span className="ag-pills">
              {r.observation.pills.map((p) => (
                <span key={p.key} className={`ag-pill ag-pill-${p.tone}`}>
                  <span className="ag-pill-k">{p.label}</span><span className="ag-pill-v">{p.value}</span>
                </span>
              ))}
            </span>
          ) : <span className="ag-pills dim">no reading yet</span>}
          <span className="ag-live-age mono">
            {r.observation?.basisBps != null && <span className="ag-live-basis" style={{ color: pctColor(r.observation.basisBps) }}>{fmtBps(r.observation.basisBps)}</span>}
            <span className={r.observation?.fresh ? 'ag-live-fresh' : 'dim'}>{r.observation ? r.observation.ageText : '—'}</span>
          </span>
        </button>
      ))}
    </section>
  );
}

/**
 * The database has no agents tables yet — the state the dashboard returns
 * before migration 0037 runs. Calm, and explicit about why.
 */
function NotReady({ dash }) {
  return (
    <div className="ag-notready">
      <span className="ag-notready-dot" aria-hidden="true" />
      <h3 className="ag-notready-title mono">Not deployed yet</h3>
      <p className="ag-notready-reason">{sentence(dash.reason || 'the agents tables are not in this database yet')}</p>
      <p className="ag-notready-note dim">
        Every strategy, order, decision and candle lives in tables the agents migration creates, and they arrive the first
        time that migration runs against this database. Until then the loop has nothing to read and nothing to write:
        nothing is running, and no money is at risk.
      </p>
      <div className="ag-notready-foot mono dim">checked {when(dash.at)} UTC</div>
    </div>
  );
}

function PositionTiles({ s, m, nowMs }) {
  const lines = positionLines(s);
  if (!lines.length) return null;
  return (
    <div className="ag-postiles">
      {lines.map((p) => (
        <div key={p.symbol} className={`ag-postile ${p.unrealisedUsd >= 0 ? 'is-up' : 'is-down'}`}>
          <div className="ag-postile-head mono">
            <span className="ag-postile-sym">{p.symbol}</span>
            <span className="ag-postile-ret" style={{ color: pctColor(p.returnPct) }}>{m(fmtPctSigned(p.returnPct, 2))}</span>
          </div>
          <div className="ag-postile-size mono">{m(p.base.toFixed(6))} <span className="dim">{p.symbol.split('/')[0]}</span></div>
          <div className="ag-postile-grid mono">
            <span className="dim">avg cost</span><span>{m(fmtUsd(p.avgCost))}</span>
            <span className="dim">mark</span><span>{m(fmtUsd(p.mark))}</span>
            <span className="dim">value</span><span>{m(fmtUsd(p.valueUsd))}</span>
            <span className="dim">unrealised</span><Money v={p.unrealisedUsd} m={m} />
          </div>
          {p.openedAt != null && <div className="ag-postile-held dim mono">held {ago(nowMs - p.openedAt)}</div>}
        </div>
      ))}
    </div>
  );
}

function Detail({ s, dash, m, nowMs }) {
  const [more, setMore] = React.useState(/** @type {{ decisions: any[], orders: any[] } | null} */ (null));
  // The countdown moves every second; everything else keeps the modal's slower clock.
  const [sec, setSec] = React.useState(() => Date.now());
  React.useEffect(() => { const id = setInterval(() => setSec(Date.now()), 1000); return () => clearInterval(id); }, []);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [symbol, setSymbol] = React.useState(() => defaultChartSymbol(s));
  React.useEffect(() => { setSymbol(defaultChartSymbol(s)); }, [s.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const decisions = (more?.decisions ?? s.recentDecisions ?? []).map(decisionView);
  const orders = (more?.orders ?? s.recentOrders ?? []).map(orderView);
  const status = strategyRows({ ...dash, strategies: [s] }, nowMs)[0].status;
  const params = Object.entries(s.params ?? {});
  const loadMore = async () => {
    setLoadingMore(true);
    try { setMore(await fetchAgentsLog(s.id, 300)); } catch { /* keep what we have */ } finally { setLoadingMore(false); }
  };
  return (
    <div className="ag-detail">
      <div className="ag-detail-head">
        <ModeBadge mode={s.mode} />
        <StatusDot status={status} />
        <span className="ag-countdown mono" title={s.nextDecisionAt ? `${new Date(s.nextDecisionAt).toISOString().replace('T', ' ').slice(0, 19)} UTC` : undefined}>
          <span className="dim">{s.kind === 'dislocation-1m' ? 'next read' : 'next decision'}</span> <span className="ag-countdown-val">{countdownText(s.nextDecisionAt, sec)}</span>
        </span>
      </div>
      <h3 className="ag-detail-title mono sr-only">{s.name}</h3>
      <div className="ag-kv mono">
        <span className="ag-kv-kind">{kindLabel(s.kind)}</span><VenueBadge id={s.venue} signal={s.signalVenue} />
        <span className="dim">{s.symbols.join(' · ')}</span>
        <span className="dim">capital <span className="hl-strong">{m(fmtUsd(Number(s.capitalUsd)))}</span></span>
        {params.map(([k, v]) => <span key={k} className="dim">{k} <span className="hl-strong">{String(v)}</span></span>)}
      </div>
      <StrategyScoreboard s={s} m={m} />
      <PositionTiles s={s} m={m} nowMs={nowMs} />
      <LiveState s={s} nowMs={nowMs} selected={symbol} onSelect={setSymbol} />
      <SymbolChart s={s} symbol={symbol} onSelect={setSymbol} m={m} nowMs={nowMs} at={dash?.at} />
      <Positions s={s} m={m} />
      <Decisions rows={decisions} />
      <Orders rows={orders} m={m} venue={s.venue} />
      {!more && (
        <button className="btn-ghost ag-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load full history'}</button>
      )}
    </div>
  );
}

/**
 * @param {{ hideValues: boolean, onClose: () => void }} props
 */
function AgentsModal({ hideValues, onClose }) {
  // Opens on the copy the app fetched at start (or the last refresh), then refreshes.
  const [dash, setDash] = React.useState(/** @type {any} */ (() => readAgentsCache()?.dash ?? null));
  const [error, setError] = React.useState(/** @type {string | null} */ (null));
  const [loading, setLoading] = React.useState(() => !readAgentsCache());
  const [selected, setSelected] = React.useState(/** @type {string | null} */ (null));
  const [now, setNow] = React.useState(() => Date.now());
  const m = React.useCallback((s) => (hideValues ? maskDigits(s) : s), [hideValues]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try { setDash(await fetchAgentsDashboard()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); setNow(Date.now()); }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    // The data comes once a minute; the CLOCK moves faster, so "seen 40 s
    // ago" creeps instead of jumping a minute at a time.
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [load]);

  const rows = React.useMemo(() => strategyRows(dash, now), [dash, now]);
  const phone = useMediaQuery('(max-width: 760px)');
  const current = selected ? (dash?.strategies ?? []).find((s) => s.id === selected) ?? null : null;
  const notReady = !!dash?.notReady;

  return (
    <>
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">AGENTS · CRYPTO</div>
          <h2 className="modal-title mono">Agents</h2>
        </div>
        <div className="modal-head-actions">
          <button className="btn-ghost icon" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh">{loading ? '…' : '↻'}</button>
          <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>
      <div className="modal-body ag-body">
        {error && !dash && <AgentsError err={error} onRetry={load} />}
        {error && dash && <AgentsError err={error} onRetry={load} compact />}
        {!dash && !error && <div className="ag-empty dim">Loading…</div>}
        {notReady && <NotReady dash={dash} />}
        {dash && !notReady && (
          <>
            <Scoreboard dash={dash} m={m} />
            <VenueSplit dash={dash} m={m} />
            <Alerts dash={dash} />
            <section className="ag-section ag-strategies">
              <div className="ag-section-title mono">STRATEGIES</div>
              {phone ? <StrategyCards rows={rows} m={m} onOpen={setSelected} /> : <StrategyTable rows={rows} m={m} onOpen={setSelected} />}
            </section>
            <div className="ag-updated dim mono">as of {when(dash.at)} UTC · refreshes every minute</div>
          </>
        )}
      </div>
    </Modal>
    {current && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <div className="modal-eyebrow mono">AGENTS · {kindLabel(current.kind).toUpperCase()}</div>
            <h2 className="modal-title mono">{current.name}</h2>
          </div>
          <div className="modal-head-actions">
            <button className="btn-ghost icon ag-detail-close" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
        </header>
        <div className="modal-body ag-body">
          <Detail s={current} dash={dash} m={m} nowMs={now} />
        </div>
      </Modal>
    )}
    </>
  );
}

export { AgentsModal };
