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
import { maskDigits, pctColor } from './formatters.js';
import {
  backtestRows, basisRows, decisionView, fetchAgentsDashboard, fetchAgentsLog, fmtBps, fmtFees, fmtFrac, fmtPctSigned, fmtUsd, kindLabel,
  orderView, rotationBacktestRows, strategyRows, totalsView, untilText, venueLabel, venueRows,
} from './agents.js';
import backtestSummary from '../docs/agents/backtests/summary.json';

const REFRESH_MS = 60_000;

/** @param {string} iso */
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toISOString().slice(5, 16).replace('T', ' ');
};
/** @param {number | null} ms */
const ago = (ms) => (ms == null ? '—' : ms < 3600e3 ? `${Math.max(0, Math.floor(ms / 60e3))}m ago` : ms < 86400e3 ? `${Math.floor(ms / 3600e3)}h ago` : `${Math.floor(ms / 86400e3)}d ago`);

function ModeBadge({ mode }) {
  return <span className={`ag-badge ag-badge-${mode}`}>{mode.toUpperCase()}</span>;
}

/** The venue, as a coloured badge: every position and every order says where it is. */
function VenueBadge({ id, signal = null }) {
  return (
    <span className={`ag-venue ag-venue-${id}`} title={signal && signal !== id ? `signals from ${venueLabel(signal)}` : undefined}>
      {venueLabel(id)}{signal && signal !== id ? <span className="ag-venue-signal"> ← {venueLabel(signal)} signals</span> : null}
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

function Totals({ dash, m }) {
  const t = totalsView(dash);
  return (
    <div className="txn-realized ag-totals">
      <div>
        <span className="lot-summary-label mono">TOTAL REALIZED G/L (USD)</span>
        <div className="ag-subline mono">
          <span>live <Money v={t.liveRealisedUsd} m={m} /></span>
          <span>paper <Money v={t.paperRealisedUsd} m={m} /></span>
          <span>unrealised <Money v={t.unrealisedUsd} m={m} /></span>
          <span>fees <span className="dim">{m(fmtUsd(t.feesUsd))}</span></span>
        </div>
      </div>
      <span className="txn-realized-val mono ag-total-val" style={{ color: pctColor(t.realisedUsd) }}>
        {m(fmtUsd(t.realisedUsd, true))}
      </span>
    </div>
  );
}

function VenueStrip({ dash, m }) {
  return (
    <div className="ag-strip">
      {(dash.venues ?? []).map((v) => {
        const usd = v.balances?.USD;
        return (
          <div key={v.id} className={`ag-chip${v.note ? ' is-warn' : ''}`} title={v.note ?? ''}>
            <span className="ag-chip-name">{venueLabel(v.id)}</span>
            <span className="dim">maker/taker {fmtFees(v.feeBps)}</span>
            <span className="dim">{v.canTrade ? (usd != null ? `${m(fmtUsd(usd))} USD` : 'funded: —') : 'no key'}</span>
            {v.note && <span className="ag-warn">!</span>}
          </div>
        );
      })}
      {dash.risk && (
        <div className={`ag-chip${dash.risk.global_pause ? ' is-warn' : ''}`}>
          <span className="ag-chip-name">Caps</span>
          <span className="dim">order ≤ {fmtUsd(Number(dash.risk.max_order_usd))}</span>
          <span className="dim">exposure ≤ {fmtUsd(Number(dash.risk.max_exposure_usd))}/venue</span>
          <span className="dim">day loss ≤ {fmtUsd(Number(dash.risk.daily_loss_limit_usd))}</span>
          <span className="dim">{dash.risk.global_pause ? 'GLOBAL PAUSE' : dash.risk.live_confirmed_at ? 'live confirmed' : 'live not yet confirmed'}</span>
        </div>
      )}
      {dash.jev24h && (
        <div className="ag-chip">
          <span className="ag-chip-name">Jev 24h</span>
          <span className="dim">{dash.jev24h.calls} calls</span>
          <span className="dim">{fmtUsd(dash.jev24h.costUsd)}</span>
          <span className="dim">{dash.jev24h.avgLatencyMs != null ? `${dash.jev24h.avgLatencyMs} ms` : '—'}</span>
        </div>
      )}
    </div>
  );
}

/** Each account's slice of the book, with a share bar — the split Davies asked to see. */
function VenueSplit({ dash, m }) {
  const rows = venueRows(dash);
  return (
    <section className="ag-venues">
      <div className="ag-share-bar" title={`share of ${rows[0]?.shareOf ?? 'value'}`}>
        {rows.map((r) => (
          <span key={r.id} className={`ag-share ag-share-${r.id}`} style={{ width: `${Math.max(0, Math.min(100, r.share * 100))}%` }}>
            {r.share >= 0.12 ? `${r.label} ${(r.share * 100).toFixed(0)}%` : ''}
          </span>
        ))}
      </div>
      <div className="ag-venue-cards">
        {rows.map((r) => (
          <div key={r.id} className={`ag-venue-card ag-venue-card-${r.id}${r.note ? ' is-warn' : ''}`}>
            <div className="ag-venue-head">
              <VenueBadge id={r.id} />
              <span className="dim mono">{r.strategies} strategies · {r.live} live · maker/taker {fmtFees(r.feeBps)}</span>
            </div>
            <div className="ag-venue-grid mono">
              <span className="dim">funded</span><span>{r.canTrade ? (r.balanceUsd != null ? `${m(fmtUsd(r.balanceUsd))} USD` : '—') : 'no key'}</span>
              <span className="dim">deployed</span><span className="hl-strong">{m(fmtUsd(r.valueUsd))}</span>
              <span className="dim">allotted</span><span>{m(fmtUsd(r.capitalUsd))}</span>
              <span className="dim">unrealised</span><Money v={r.unrealisedUsd} m={m} />
              <span className="dim">realised</span><Money v={r.realisedUsd} m={m} />
              <span className="dim">fees</span><span className="dim">{m(fmtUsd(r.feesUsd))}</span>
            </div>
            {r.note && <div className="ag-warn-line">{r.note}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The cross-venue basis over the last 24 h: the arbitrage question, answered by the record rather than by opinion. */
function Basis({ dash }) {
  const rows = basisRows(dash);
  if (!rows.length) return null;
  const maxAbs = Math.max(...rows.map((r) => r.absMax ?? 0));
  const over40 = rows.reduce((a, r) => a + (r.over40 ?? 0), 0);
  return (
    <section className="ag-section ag-basis">
      <div className="ag-section-title mono">CROSS-VENUE BASIS <span className="dim">· Revolut X mid vs Kraken mid, last 24 h · Kraken taker 80 bps / maker 40 bps</span></div>
      <div className="hl-scroll">
        <table className="hl-table ag-table mono">
          <thead><tr>
            <th className="hl-th hl-left">Symbol</th><th className="hl-th hl-right">Now</th><th className="hl-th hl-right">|basis| p50</th>
            <th className="hl-th hl-right">p95</th><th className="hl-th hl-right">max</th><th className="hl-th hl-right">&gt; 20 bps</th>
            <th className="hl-th hl-right">&gt; 40</th><th className="hl-th hl-right">&gt; 80</th><th className="hl-th hl-right">samples</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="ag-basis-row">
                <td className="hl-left hl-strong">{r.symbol}</td>
                <td className="hl-right" style={{ color: pctColor(r.latest) }}>{fmtBps(r.latest)}</td>
                <td className="hl-right">{r.absP50 == null ? '—' : r.absP50.toFixed(2)}</td>
                <td className="hl-right">{r.absP95 == null ? '—' : r.absP95.toFixed(2)}</td>
                <td className="hl-right">{r.absMax == null ? '—' : r.absMax.toFixed(2)}</td>
                <td className="hl-right dim">{r.over20 ?? 0}</td>
                <td className="hl-right dim">{r.over40 ?? 0}</td>
                <td className="hl-right dim">{r.over80 ?? 0}</td>
                <td className="hl-right dim">{r.n ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ag-note dim">
        An arbitrage between the two accounts has to clear Kraken's fee on the hedge leg. In the last 24 h the widest basis was
        {' '}{maxAbs.toFixed(1)} bps and {over40} samples exceeded 40 bps — {over40 === 0 ? 'nothing to cross.' : 'rare, and still under the taker fee.'}
        {' '}What the gap does show is which venue moves first: Kraken, by seconds — so the Revolut X strategies read Kraken's candles.
      </p>
    </section>
  );
}

const COLUMNS = [
  { id: 'name', label: 'Strategy', cls: 'hl-left' },
  { id: 'venue', label: 'Venue', cls: 'hl-left' },
  { id: 'mode', label: 'Mode', cls: 'hl-left' },
  { id: 'cost', label: 'Cost', cls: 'hl-right' },
  { id: 'value', label: 'Value', cls: 'hl-right' },
  { id: 'unrealised', label: 'Unrealised', cls: 'hl-right' },
  { id: 'realised', label: 'Realised', cls: 'hl-right' },
  { id: 'return', label: 'Return', cls: 'hl-right' },
  { id: 'orders', label: 'Orders today', cls: 'hl-right' },
  { id: 'last', label: 'Last decision', cls: 'hl-left' },
  { id: 'next', label: 'Next', cls: 'hl-left' },
  { id: 'status', label: 'Status', cls: 'hl-left' },
];

function StrategyTable({ rows, m, onOpen, nowMs }) {
  return (
    <div className="hl-scroll">
      <table className="hl-table ag-table mono">
        <thead>
          <tr>{COLUMNS.map((c) => <th key={c.id} className={`hl-th ${c.cls}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={COLUMNS.length}>No strategies yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="ag-row" onClick={() => onOpen(r.id)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.id); } }}>
              <td className="hl-left ag-name-cell">
                <span className="ag-name">{r.name}</span>
                <span className="hl-sub dim">{r.kind} · {r.openPositions} open · {m(fmtUsd(r.capitalUsd))} cap</span>
              </td>
              <td className="hl-left"><VenueBadge id={r.venueId} signal={r.signalVenue} /></td>
              <td className="hl-left"><ModeBadge mode={r.mode} /></td>
              <td className="hl-right">{m(fmtUsd(r.costUsd))}</td>
              <td className="hl-right hl-strong">{m(fmtUsd(r.valueUsd))}</td>
              <td className="hl-right"><Money v={r.unrealisedUsd} m={m} /></td>
              <td className="hl-right"><Money v={r.realisedUsd} m={m} /></td>
              <td className="hl-right" style={{ color: pctColor(r.returnPct) }}>{m(fmtPctSigned(r.returnPct, 2))}</td>
              <td className="hl-right">{r.ordersToday}{r.openOrders ? <span className="dim"> · {r.openOrders} open</span> : null}</td>
              <td className="hl-left">
                {r.lastAction ? <><span className={`ag-action ag-action-${r.lastAction}`}>{r.lastAction}</span> <span className="dim">{r.lastSymbol} · {ago(r.lastAgeMs)}</span></> : <span className="dim">—</span>}
              </td>
              <td className="hl-left dim ag-next">{untilText(r.nextDecisionAt, nowMs)}</td>
              <td className="hl-left"><StatusDot status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="ag-how">
      <div className="ag-section-title mono">HOW IT WORKS</div>
      <p>
        Every five minutes the loop reads each strategy's own venue — closed 4-hour and daily candles, the touch,
        the pair limits — and turns the numbers into a dozen words: trend, breakout, volatility, momentum, position,
        drawdown. <b>The rulebook decides from the numbers.</b> <b>Jev</b>, TypeSafe's decision model, sees only the
        words and answers two typed questions — is this a healthy trend, how much caution — and can veto an entry or
        advise an exit, never open a position on its own. A deterministic <b>risk gate</b> (per-order cap, per-venue
        exposure, daily loss limit, order count, global pause) has the last word, and every decision is stored with
        what the model saw, what it answered, what the rule said and what was done.
      </p>
      <p>
        <b>Two venues, each for what it is good at.</b> Kraken's book is a hundred times tighter, so the Revolut X strategies
        read Kraken's candles and rest their orders on Revolut X, where the maker fee is 0 %; Kraken runs the slow rules and
        paper twins whose fills pay its real 0.40 %. The basis between the two is recorded every turn (above): it never comes
        near Kraken's fee, so there is no arbitrage to run, and the record keeps saying so. Orders rest <b>post-only at the
        touch</b>. Every strategy starts in <b>paper</b>; live needs its row flipped, an explicit confirmation recorded, and
        the gate — three switches, none of them the model's. Backtests are walk-forward: parameters chosen on two years,
        the third year reported out of sample, buy-and-hold beside it, and the same rule priced on both venues.
      </p>
    </div>
  );
}

function Positions({ s, m }) {
  const rows = (s.positions ?? []).filter((p) => p.base > 0 || p.fills > 0);
  return (
    <section className="ag-section">
      <div className="ag-section-title mono">POSITIONS</div>
      <div className="hl-scroll">
        <table className="hl-table ag-table mono">
          <thead><tr>
            <th className="hl-th hl-left">Symbol</th><th className="hl-th hl-left">Venue</th><th className="hl-th hl-right">Size</th><th className="hl-th hl-right">Avg cost</th>
            <th className="hl-th hl-right">Mark</th><th className="hl-th hl-right">Value</th><th className="hl-th hl-right">Unrealised</th>
            <th className="hl-th hl-right">Realised</th><th className="hl-th hl-right">Fees</th><th className="hl-th hl-right">Fills</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={10}>Flat — nothing held yet.</td></tr>}
            {rows.map((p) => (
              <tr key={p.symbol}>
                <td className="hl-left hl-strong">{p.symbol}</td>
                <td className="hl-left"><VenueBadge id={s.venue} /></td>
                <td className="hl-right">{p.base > 0 ? p.base.toFixed(6) : <span className="dim">flat</span>}</td>
                <td className="hl-right">{p.base > 0 ? m(fmtUsd(p.avgCost)) : '—'}</td>
                <td className="hl-right">{m(fmtUsd(p.mark))}</td>
                <td className="hl-right hl-strong">{m(fmtUsd(p.valueUsd))}</td>
                <td className="hl-right"><Money v={p.unrealisedUsd} m={m} /></td>
                <td className="hl-right"><Money v={p.realisedUsd} m={m} /></td>
                <td className="hl-right dim">{m(fmtUsd(p.feesUsd))}</td>
                <td className="hl-right dim">{p.fills}</td>
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
      <div className="ag-section-title mono">DECISIONS <span className="dim">· newest first · what the model saw, what the rule said, what was done</span></div>
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th hl-left">When (UTC)</th><th className="hl-th hl-left">Symbol</th><th className="hl-th hl-left">State</th>
            <th className="hl-th hl-left">Rule</th><th className="hl-th hl-left">Final</th><th className="hl-th hl-right">P(healthy)</th>
            <th className="hl-th hl-right">Caution</th><th className="hl-th hl-left">Model</th><th className="hl-th hl-left">Risk</th>
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
                <td className="hl-right">{d.healthy == null ? <span className="dim">—</span> : d.healthy.toFixed(2)}</td>
                <td className="hl-right">{d.caution == null ? <span className="dim">—</span> : d.caution.toFixed(2)}</td>
                <td className="hl-left dim">{d.provider}{d.latencyMs ? ` · ${d.latencyMs} ms` : ''}</td>
                <td className="hl-left">{d.allowed ? <span className="dim">ok</span> : <span className="ag-blocked" title={d.riskReason}>blocked</span>}</td>
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
      <div className="ag-section-title mono">ORDERS <span className="dim">· resting post-only limits at the touch</span></div>
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th hl-left">When (UTC)</th><th className="hl-th hl-left">Symbol</th><th className="hl-th hl-left">Venue</th><th className="hl-th hl-left">Side</th>
            <th className="hl-th hl-right">Price</th><th className="hl-th hl-right">Size</th><th className="hl-th hl-right">Notional</th>
            <th className="hl-th hl-left">State</th><th className="hl-th hl-right">Fill</th><th className="hl-th hl-right">Fee</th><th className="hl-th hl-left">Mode</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={11}>No orders yet.</td></tr>}
            {rows.map((o) => (
              <tr key={o.id} className={`txn-row txn-row-${o.side}`}>
                <td className="hl-left dim">{when(o.ts)}</td>
                <td className="hl-left hl-strong">{o.symbol}</td>
                <td className="hl-left"><VenueBadge id={o.venue ?? venue} /></td>
                <td className="hl-left"><span className={`txn-badge txn-${o.side}`}>{o.side.toUpperCase()}</span></td>
                <td className="hl-right">{m(fmtUsd(o.price))}</td>
                <td className="hl-right">{o.base.toFixed(6)}</td>
                <td className="hl-right">{m(fmtUsd(o.notionalUsd))}</td>
                <td className="hl-left"><span className={`ag-state-pill ag-state-${o.state}`}>{o.state.replace('_', ' ')}</span></td>
                <td className="hl-right">{o.fillPrice != null ? m(fmtUsd(o.fillPrice)) : <span className="dim">—</span>}</td>
                <td className="hl-right dim">{m(fmtUsd(o.feeUsd))}</td>
                <td className="hl-left"><ModeBadge mode={o.mode} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RotationBacktest({ venue }) {
  const { rows, buyHoldOos, buyHoldFull, symbols } = rotationBacktestRows(backtestSummary, venue);
  const other = venue === 'revx' ? 'kraken' : 'revx';
  return (
    <section className="ag-section">
      <div className="ag-section-title mono">BACKTEST <span className="dim">· walk-forward on the {symbols.join(' / ')} basket, {backtestSummary.ran_at.slice(0, 10)}</span></div>
      <div className="hl-scroll">
        <table className="hl-table ag-table mono">
          <thead><tr>
            <th className="hl-th hl-left">Variant</th><th className="hl-th hl-right">Out of sample</th><th className="hl-th hl-right">Max DD</th>
            <th className="hl-th hl-right">Invested</th><th className="hl-th hl-right">Turnover</th><th className="hl-th hl-right">Full 3y</th><th className="hl-th hl-right">on {venueLabel(other)}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="hl-left hl-strong">{r.label}</td>
                <td className="hl-right" style={{ color: pctColor(r.oosRet) }}>{fmtFrac(r.oosRet)}</td>
                <td className="hl-right dim">{r.oosDD == null ? '—' : `${(r.oosDD * 100).toFixed(0)}%`}</td>
                <td className="hl-right dim">{r.exposure == null ? '—' : `${(r.exposure * 100).toFixed(0)}%`}</td>
                <td className="hl-right dim">{r.turnover == null ? '—' : `${r.turnover.toFixed(0)}×/y`}</td>
                <td className="hl-right" style={{ color: pctColor(r.fullRet) }}>{fmtFrac(r.fullRet)}</td>
                <td className="hl-right dim">{fmtFrac(r.otherOosRet)}</td>
              </tr>
            ))}
            <tr>
              <td className="hl-left dim">equal-weight buy &amp; hold</td>
              <td className="hl-right" style={{ color: pctColor(buyHoldOos) }}>{fmtFrac(buyHoldOos)}</td>
              <td className="hl-right dim">—</td><td className="hl-right dim">100%</td><td className="hl-right dim">—</td>
              <td className="hl-right" style={{ color: pctColor(buyHoldFull) }}>{fmtFrac(buyHoldFull)}</td><td className="hl-right dim">—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ag-note dim">
        Rank the basket by 30-day return at each daily close, hold the top two equal-weighted while each sits above its 100-day
        average. The out-of-sample year is a bear market: the bear filter is what kept the loss at a third of buy-and-hold, at the
        price of being invested a third of the time. With the filter off the rule is always invested and follows the market down.
        Fills at the next day's open with {venueLabel(venue)}'s fees and half-spread; the model is not in the backtest.
      </p>
    </section>
  );
}

function Backtest({ kind, venue }) {
  if (kind === 'rotation-1d') return <RotationBacktest venue={venue} />;
  const rows = backtestRows(backtestSummary, kind, venue);
  const other = venue === 'revx' ? 'kraken' : 'revx';
  const otherRows = backtestRows(backtestSummary, kind, other);
  if (!rows.length) {
    return (
      <section className="ag-section">
        <div className="ag-section-title mono">BACKTEST</div>
        <p className="ag-note dim">Not run on {venueLabel(venue)}'s costs: this rule trades too often for a 0.40 % maker fee, which is why it is paper-only there.</p>
      </section>
    );
  }
  return (
    <section className="ag-section">
      <div className="ag-section-title mono">BACKTEST <span className="dim">· walk-forward, {backtestSummary.ran_at.slice(0, 10)}</span></div>
      <div className="hl-scroll">
        <table className="hl-table ag-table mono">
          <thead><tr>
            <th className="hl-th hl-left">Symbol</th><th className="hl-th hl-right">Out of sample</th><th className="hl-th hl-right">Max DD</th>
            <th className="hl-th hl-right">Trades</th><th className="hl-th hl-right">Buy &amp; hold</th><th className="hl-th hl-right">Full 3y</th>
            <th className="hl-th hl-right">on {venueLabel(other)}</th><th className="hl-th hl-left">Params</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const o = otherRows.find((x) => x.symbol === r.symbol);
              return (
                <tr key={r.symbol}>
                  <td className="hl-left hl-strong">{r.symbol}</td>
                  <td className="hl-right" style={{ color: pctColor(r.oosRet) }}>{fmtFrac(r.oosRet)}</td>
                  <td className="hl-right dim">{r.oosDD == null ? '—' : `${(r.oosDD * 100).toFixed(0)}%`}</td>
                  <td className="hl-right dim">{r.oosTrades ?? '—'}</td>
                  <td className="hl-right" style={{ color: pctColor(r.buyHoldOos) }}>{fmtFrac(r.buyHoldOos)}</td>
                  <td className="hl-right" style={{ color: pctColor(r.fullRet) }}>{fmtFrac(r.fullRet)}</td>
                  <td className="hl-right dim">{o ? fmtFrac(o.oosRet) : '—'}</td>
                  <td className="hl-left dim">{r.chosen ? `fast ${r.chosen.fast} · slow ${r.chosen.slow} · stop ${r.chosen.atrStop}×ATR` : kind === 'trend-1h' ? 'default, 1h bars' : 'lookback 30d'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ag-note dim">
        Three years of Coinbase hourly candles (the venues' own 4h closes sit within a median 1.6–2.7 bps of them),
        resampled to 4h and daily. Parameters were chosen on the first two years and the last year — a bear market —
        is reported out of sample; the full-period figure is in-sample and never the headline. Fills at the next
        bar's open with {venueLabel(venue)}'s fees and half-spread. The model is not in the backtest: its vote is measured live, in paper.
      </p>
    </section>
  );
}

function Detail({ s, dash, m, onBack }) {
  const [more, setMore] = React.useState(/** @type {{ decisions: any[], orders: any[] } | null} */ (null));
  const [loadingMore, setLoadingMore] = React.useState(false);
  const decisions = (more?.decisions ?? s.recentDecisions ?? []).map(decisionView);
  const orders = (more?.orders ?? s.recentOrders ?? []).map(orderView);
  const status = strategyRows({ ...dash, strategies: [s] }, Date.now())[0].status;
  const params = Object.entries(s.params ?? {});
  const loadMore = async () => {
    setLoadingMore(true);
    try { setMore(await fetchAgentsLog(s.id, 300)); } catch { /* keep what we have */ } finally { setLoadingMore(false); }
  };
  return (
    <div className="ag-detail">
      <div className="ag-detail-head">
        <button className="btn-ghost ag-back" onClick={onBack}>← All strategies</button>
        <ModeBadge mode={s.mode} />
        <StatusDot status={status} />
      </div>
      <h3 className="ag-detail-title mono">{s.name}</h3>
      <div className="ag-kv mono">
        <span>{kindLabel(s.kind)}</span><VenueBadge id={s.venue} signal={s.signalVenue} /><span>{s.symbols.join(' · ')}</span>
        <span className="dim">next decision {untilText(s.nextDecisionAt, Date.now())}</span>
        <span>capital {m(fmtUsd(Number(s.capitalUsd)))}</span>
        {params.map(([k, v]) => <span key={k} className="dim">{k} {String(v)}</span>)}
      </div>
      <p className="ag-desc">{s.description}</p>
      <div className="txn-realized ag-totals ag-totals-sm">
        <div className="ag-subline mono">
          <span>cost <span>{m(fmtUsd(s.costUsd))}</span></span>
          <span>value <span>{m(fmtUsd(s.valueUsd))}</span></span>
          <span>unrealised <Money v={s.unrealisedUsd} m={m} /></span>
          <span>fees <span className="dim">{m(fmtUsd(s.feesUsd))}</span></span>
          <span>Jev 24h <span className="dim">{s.jev24h?.calls ?? 0} calls · {fmtUsd(s.jev24h?.costUsd ?? 0)}</span></span>
        </div>
        <span className="txn-realized-val mono" style={{ color: pctColor(s.realisedUsd) }}>{m(fmtUsd(s.realisedUsd, true))}</span>
      </div>
      <Positions s={s} m={m} />
      <Decisions rows={decisions} />
      <Orders rows={orders} m={m} venue={s.venue} />
      {!more && (
        <button className="btn-ghost ag-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load full history'}</button>
      )}
      <Backtest kind={s.kind} venue={s.venue} />
    </div>
  );
}

/**
 * @param {{ hideValues: boolean, onClose: () => void }} props
 */
function AgentsModal({ hideValues, onClose }) {
  const [dash, setDash] = React.useState(/** @type {any} */ (null));
  const [error, setError] = React.useState(/** @type {string | null} */ (null));
  const [loading, setLoading] = React.useState(true);
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
    return () => clearInterval(id);
  }, [load]);

  const rows = React.useMemo(() => strategyRows(dash, now), [dash, now]);
  const current = selected ? (dash?.strategies ?? []).find((s) => s.id === selected) ?? null : null;

  return (
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
        {error && <div className="ag-error mono">{error}</div>}
        {!dash && !error && <div className="ag-empty dim">Loading…</div>}
        {dash && !current && (
          <>
            <Totals dash={dash} m={m} />
            <VenueSplit dash={dash} m={m} />
            <VenueStrip dash={dash} m={m} />
            <StrategyTable rows={rows} m={m} onOpen={setSelected} nowMs={now} />
            <div className="ag-updated dim mono">as of {when(dash.at)} UTC · refreshes every minute</div>
            <Basis dash={dash} />
            <HowItWorks />
          </>
        )}
        {dash && current && <Detail s={current} dash={dash} m={m} onBack={() => setSelected(null)} />}
      </div>
    </Modal>
  );
}

export { AgentsModal };
