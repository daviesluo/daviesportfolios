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
  backtestRows, basisRows, decisionView, defaultChartSymbol, fetchAgentsChart, fetchAgentsDashboard, fetchAgentsLog, fillRows, fillsSummary,
  fmtBps, fmtFees, fmtFrac, fmtPctSigned, fmtUsd, kindLabel, liveStateRows, nextDecisionText, observationView,
  orderView, rotationBacktestRows, strategyRows, totalsView, venueHue, venueLabel, venueRows, dislocationBacktestRows,
} from './agents.js';
import {
  CHART_PAD, CHART_PAD_SM, chartGeometry, fmtChartPrice, fmtChartStamp, hoverPoint, markPath, tooltipBox, windowText,
} from './agents_chart.js';
import backtestSummary from '../docs/agents/backtests/summary.json';

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

function StrategyTable({ rows, m, onOpen }) {
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
              <td className="hl-left dim ag-next">{r.nextText}</td>
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
    <section className="ag-section ag-positions">
      <div className="ag-section-title mono">POSITIONS <span className="dim">· marked at {venueLabel(s.venue)}'s mid</span></div>
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

/** The dislocation rule earned its seed from the 1-minute study, not the 4h backtester: say so, with the halves beside the headline. */
function DislocationBacktest() {
  const d = /** @type {any} */ (backtestSummary).dislocation;
  const rows = dislocationBacktestRows(backtestSummary);
  if (!d || !rows.length) return null;
  const bps = (/** @type {number | null} */ v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);
  return (
    <section className="ag-section">
      <div className="ag-section-title mono">BACKTEST <span className="dim">· 1-minute study, {rows[0].days ?? '—'} days · entry {d.params?.entryBps} bps, {d.params?.maxHoldMin} min, stop {d.params?.stopBps} bps</span></div>
      <div className="hl-scroll">
        <table className="hl-table ag-table mono">
          <thead><tr>
            <th className="hl-th hl-left">Symbol</th><th className="hl-th hl-right">Trades</th><th className="hl-th hl-right">/ day</th>
            <th className="hl-th hl-right">Avg bps</th><th className="hl-th hl-right">Win</th><th className="hl-th hl-right">Worst</th>
            <th className="hl-th hl-right">1st half</th><th className="hl-th hl-right">2nd half</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td className="hl-left hl-strong">{r.symbol}</td>
                <td className="hl-right dim">{r.trades}</td>
                <td className="hl-right dim">{r.perDay ?? '—'}</td>
                <td className="hl-right" style={{ color: pctColor(r.avgBps) }}>{bps(r.avgBps)}</td>
                <td className="hl-right dim">{r.win == null ? '—' : `${r.win}%`}</td>
                <td className="hl-right dim">{r.worst ?? '—'}</td>
                <td className="hl-right" style={{ color: pctColor(r.firstHalfAvg) }}>{bps(r.firstHalfAvg)}</td>
                <td className="hl-right" style={{ color: pctColor(r.secondHalfAvg) }}>{bps(r.secondHalfAvg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ag-note dim">
        {d.source}. A resting bid at the same moment is {d.restingBid}. Seeded {d.seeded}: BTC and ETH carry the edge,
        SOL and XRP do not (their own spread is wider than it), and the second half of the sample is the weaker one — this
        rule is paper until its own fills say otherwise (reference §3.5 names the bar).
      </p>
    </section>
  );
}

function Backtest({ kind, venue }) {
  if (kind === 'rotation-1d') return <RotationBacktest venue={venue} />;
  if (kind === 'dislocation-1m') return <DislocationBacktest />;
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
            <th className="hl-th hl-right">Size</th><th className="hl-th hl-right">Notional</th><th className="hl-th hl-right">Fee</th>
            <th className="hl-th hl-left">Venue</th><th className="hl-th hl-left">Liquidity</th>
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
                <td className="hl-right dim">{m(fmtUsd(f.feeUsd))}</td>
                <td className="hl-left"><VenueBadge id={f.venue ?? venue} /></td>
                <td className="hl-left dim">{f.liquidity}</td>
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
  const [chart, setChart] = React.useState(/** @type {any} */ (null));
  const [error, setError] = React.useState(/** @type {string | null} */ (null));
  const [loading, setLoading] = React.useState(true);
  const held = new Map((s.positions ?? []).map((p) => [p.symbol, p]));

  // A new pair empties the card; the dashboard's own minute refresh (`at`)
  // only refetches — the frame stays, the way a live chart should.
  React.useEffect(() => { setChart(null); setError(null); setLoading(true); }, [s.id, symbol]);
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
      <div className="ag-section-title mono">PRICE &amp; FILLS <span className="dim">· {venueLabel(chart?.signalVenue ?? s.signalVenue ?? s.venue)}'s candles, this strategy's own orders</span></div>
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
      {error && <div className="ag-chart-blank"><div className="ag-chart-blank-title mono">Chart unavailable</div><p className="dim">{error}</p></div>}
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
        WHAT THE RULE SEES <span className="dim">· the forming bar, read every minute — not a decision</span>
      </div>
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

function Detail({ s, dash, m, onBack, nowMs }) {
  const [more, setMore] = React.useState(/** @type {{ decisions: any[], orders: any[] } | null} */ (null));
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
        <button className="btn-ghost ag-back" onClick={onBack}>← All strategies</button>
        <ModeBadge mode={s.mode} />
        <StatusDot status={status} />
      </div>
      <h3 className="ag-detail-title mono">{s.name}</h3>
      <div className="ag-kv mono">
        <span className="ag-kv-kind">{kindLabel(s.kind)}</span><VenueBadge id={s.venue} signal={s.signalVenue} />
        <span className="dim">{s.symbols.join(' · ')}</span>
        <span className="dim">next decision <span className="hl-strong">{nextDecisionText(s.kind, s.nextDecisionAt, nowMs)}</span></span>
        <span className="dim">capital <span className="hl-strong">{m(fmtUsd(Number(s.capitalUsd)))}</span></span>
        {params.map(([k, v]) => <span key={k} className="dim">{k} <span className="hl-strong">{String(v)}</span></span>)}
      </div>
      <p className="ag-desc">{s.description}</p>
      <div className="txn-realized ag-totals ag-totals-sm">
        <div>
          <span className="lot-summary-label mono">REALIZED G/L (USD)</span>
          <div className="ag-subline mono">
            <span>cost <span>{m(fmtUsd(s.costUsd))}</span></span>
            <span>value <span>{m(fmtUsd(s.valueUsd))}</span></span>
            <span>unrealised <Money v={s.unrealisedUsd} m={m} /></span>
            <span>fees <span className="dim">{m(fmtUsd(s.feesUsd))}</span></span>
            <span>Jev 24h <span className="dim">{s.jev24h?.calls ?? 0} calls · {fmtUsd(s.jev24h?.costUsd ?? 0)}</span></span>
          </div>
        </div>
        <span className="txn-realized-val mono" style={{ color: pctColor(s.realisedUsd) }}>{m(fmtUsd(s.realisedUsd, true))}</span>
      </div>
      <LiveState s={s} nowMs={nowMs} selected={symbol} onSelect={setSymbol} />
      <SymbolChart s={s} symbol={symbol} onSelect={setSymbol} m={m} nowMs={nowMs} at={dash?.at} />
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
    // The data comes once a minute; the CLOCK moves faster, so "seen 40 s
    // ago" creeps instead of jumping a minute at a time.
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [load]);

  const rows = React.useMemo(() => strategyRows(dash, now), [dash, now]);
  const current = selected ? (dash?.strategies ?? []).find((s) => s.id === selected) ?? null : null;
  const notReady = !!dash?.notReady;

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
        {notReady && <NotReady dash={dash} />}
        {dash && !notReady && !current && (
          <>
            <Totals dash={dash} m={m} />
            <VenueSplit dash={dash} m={m} />
            <VenueStrip dash={dash} m={m} />
            <section className="ag-section ag-strategies">
              <div className="ag-section-title mono">STRATEGIES <span className="dim">· one rulebook per venue · a row opens its chart, its fills and its log</span></div>
              <StrategyTable rows={rows} m={m} onOpen={setSelected} />
            </section>
            <div className="ag-updated dim mono">as of {when(dash.at)} UTC · refreshes every minute</div>
            <Basis dash={dash} />
            <HowItWorks />
          </>
        )}
        {dash && !notReady && current && <Detail s={current} dash={dash} m={m} onBack={() => setSelected(null)} nowMs={now} />}
      </div>
    </Modal>
  );
}

export { AgentsModal };
