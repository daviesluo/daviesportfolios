// Agents — the crypto strategies page, opened from the ☰ menu below
// "Transaction history". One view of everything the `agents` Edge Function
// runs: the strategies (two rulebooks, each on Revolut X and on Kraken),
// what each holds and has made, the caps that bound them, the venues'
// health, and — per strategy — every decision with the words the model
// saw and every order with what the venue said.
//
// Nothing is computed here that could disagree with the server: positions
// and P&L arrive derived from fills (`runDashboard`), and the page only
// formats. Two tabs at the top, LIVE and TESTING, each with its own
// scoreboard, venues and table (Davies, 2026-09-24); a tab's headline is
// its realised G/L, the way the transaction history leads with the book's.
import React from 'react';
import { Modal } from '../board/modals.jsx';
import { fmtDayMonth, fmtMoney, maskDigits, pctColor } from '../app/formatters.js';
import { ukTzAbbr } from '../prices/market_hours.js';
import {
  AGENT_TABS, agentsErrorView, agentsTabsView, alertsFor, countdownText, dashboardInFlight, defaultAgentsTab, defaultChartSymbol, fetchAgentsChart, fetchAgentsDashboard, fetchAgentsLog, fmtBps, fmtCents, fmtFees, fmtPctSigned, fmtQuotePrice, fmtUsd, glText, historyLimitOf, lastChangeText, liveStateRows, newestWins, paperOnly, QUOTES_ROW_ID, quoteBookLabel, quoteLadderRows, quotesRow, quotesView, positionLines, readAgentsCache, readChartCache, RW_ROW_ID, rwBarTileKeys, rwHeldText, rwRow, rwShareText, rwTodayRow, rwView, scoreboardView, shareSegments, showFullHistory, sizeText, splitCents, splitStrategyRows, strategyName, strategyRows, strategyScoreboard, symbolOrderRows, tabStrategies, venueHue, venueLabel, venueRows,
} from './agents.js';
import {
  CHART_PAD, CHART_PAD_SM, chartGeometry, fmtChartPrice, fmtChartStamp, hoverPoint, markPath, plotLabelY, tooltipBox, windowText,
} from './agents_chart.js';

/** The abbreviation the site's own header clock shows — BST or GMT, whichever is in force. */
const UK_TZ = ukTzAbbr(new Date());

const REFRESH_MS = 60_000;

/**
 * Refresh, then close — the same pair on the list and on every page opened
 * over it (Davies, 2026-09-25). The minute's own refresh does not use this
 * button; a click does, and it asks again rather than joining a request
 * already on its way.
 * @param {{ onRefresh: () => void, onClose: () => void, loading: boolean, closeClass?: string }} props
 */
function PageActions({ onRefresh, onClose, loading, closeClass = '' }) {
  return (
    <div className="modal-head-actions">
      <button type="button" className="btn-ghost icon" onClick={onRefresh} disabled={loading} aria-label="Refresh" title="Refresh">{loading ? '…' : '↻'}</button>
      <button type="button" className={`btn-ghost icon${closeClass ? ` ${closeClass}` : ''}`} onClick={onClose} aria-label="Close">✕</button>
    </div>
  );
}
const TICK_MS = 20_000;
const SURFACE = '#0f1815';   // the modal's own background — the 2px ring every overlapping mark wears

/** A timestamp on this page, UK local like every other one. @param {string} iso */
const when = (iso) => fmtChartStamp(iso);
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
 * A scoreboard cell's label: its name, then each aside on a line of its own —
 * what its percent is of, what else it holds — so it never breaks into two
 * ragged columns on a phone.
 * @param {{ label: string, asides?: Array<string | null | false | undefined> }} props
 */
function SbLabel({ label, asides = [] }) {
  return (
    <div className="sb-label ag-sb-label">
      <span className="ag-sb-name">{label}</span>
      {asides.filter(Boolean).map((a, i) => <span key={i} className="ag-sb-aside">{a}</span>)}
    </div>
  );
}

/**
 * One cell of the scoreboard: a label, a signed amount, its percent — the home page's own shape. `aside` is what else
 * is in the figure (the fees on realised). A percent no longer names its base beside the title (Davies, 2026-09-24):
 * the number beside the dollars is enough. `split` is what the figure is made of, each part on its own line under it
 * (Davies, 2026-09-25): one running line wrapped through the amount.
 * @param {{ label: string, usd: number, pct: number | null, m: (s: string) => string, aside?: string | null, split?: Array<[string, number]> | null, cls?: string }} props
 */
function GlCell({ label, usd, pct, m, aside = null, split = null, cls = '' }) {
  const hasPct = pct != null && Number.isFinite(pct);
  return (
    <div className={`ag-sb-cell ${cls}`}>
      <SbLabel label={label} asides={[aside]} />
      <div className="sb-value mono sb-change-row" style={{ color: pctColor(usd) }}>
        <span className="ag-sb-usd">{m(fmtMoney(usd ?? 0, { signed: true, compact: false }))}</span>
        {hasPct ? <span className="sb-pct">({fmtPctSigned(pct, 2)})</span> : null}
      </div>
      <div className="ag-sb-extra">
        {split && split.length > 0 ? (
          <span className="ag-sb-split mono">
            {split.map(([k, v]) => (
              <span key={k} className="ag-sb-split-line">
                <span className="dim">{k}</span>{' '}<span className="ag-sb-split-v" style={{ color: pctColor(v) }}>{m(fmtMoney(v, { signed: true, compact: false }))}</span>
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The scoreboard's first two cells (Davies, 2026-09-24): what the strategies are funded with, then what they have
 * deployed of it, as a percent beside the figure. On a tab, FUNDED also says how many strategies the board adds up.
 * @param {{ fundedUsd: number, deployedUsd: number, m: (s: string) => string, aside?: string | null }} props
 */
function FundedCells({ fundedUsd, deployedUsd, m, aside = null }) {
  const pct = fundedUsd > 0 ? (deployedUsd / fundedUsd) * 100 : null;
  const hasPct = pct != null && Number.isFinite(pct);
  return (
    <>
      <div className="ag-sb-cell ag-sb-cell-main ag-sb-cell-funded">
        <SbLabel label="FUNDED" asides={[aside]} />
        <div className="sb-value sb-value-lg mono">{m(fmtUsd(fundedUsd))}</div>
        <div className="ag-sb-extra" />
      </div>
      <div className="ag-sb-divider" />
      <div className="ag-sb-cell ag-sb-cell-main ag-sb-cell-deployed">
        <SbLabel label="DEPLOYED" />
        <div className="sb-value sb-value-lg mono">
          {m(fmtUsd(deployedUsd))}{hasPct ? <span className="ag-sb-deployed-pct">({pct.toFixed(2)}%)</span> : null}
        </div>
        <div className="ag-sb-extra" />
      </div>
    </>
  );
}

/**
 * A tab's scoreboard, in the home scoreboard's cells: what its strategies
 * are funded with and have deployed, today's change (the UTC day),
 * unrealised and realised — no total, by the owner's choice. TESTING adds
 * the paper tests as well (Davies, 2026-09-24).
 * @param {{ dash: any, tab: 'live' | 'testing', m: (s: string) => string, tests?: any[] }} props
 */
function Scoreboard({ dash, tab, m, tests = [] }) {
  const v = scoreboardView(dash, tab, tests);
  return (
    <div className="ag-scoreboard">
      <FundedCells fundedUsd={v.capitalUsd} deployedUsd={v.valueUsd} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="TODAY" usd={v.todayUsd} pct={v.todayPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="UNREALIZED G/L" usd={v.unrealisedUsd} pct={v.unrealisedPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="REALIZED G/L" usd={v.realisedUsd} pct={v.realisedPct} m={m} cls="ag-sb-realised" aside={`(incl. fees ${m(fmtUsd(v.feesUsd))})`} />
    </div>
  );
}

/** The same cells for one strategy, at the top of its page. */
function StrategyScoreboard({ s, m }) {
  const v = strategyScoreboard(s);
  return (
    <div className="ag-scoreboard ag-scoreboard-sm">
      <FundedCells fundedUsd={v.capitalUsd} deployedUsd={v.valueUsd} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="TODAY" usd={v.todayUsd} pct={v.todayPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="UNREALIZED G/L" usd={v.unrealisedUsd} pct={v.unrealisedPct} m={m} />
      <div className="ag-sb-divider" />
      <GlCell label="REALIZED G/L" usd={v.realisedUsd} pct={v.realisedPct} m={m} cls="ag-sb-realised" aside={`(incl. fees ${m(fmtUsd(v.feesUsd))})`} />
    </div>
  );
}

/**
 * A figure's label in a card: its name, and — when the figure has a percent — what the percent is of, on a small line
 * of its own under it.
 * @param {{ name: string, pct?: number | null, of?: string | null, title?: string }} props
 */
function FigLabel({ name, pct = null, of = null, title }) {
  return (
    <span className="dim ag-fig-label" title={title}>
      <span className="ag-fig-name">{name}</span>
      {of && pct != null && Number.isFinite(pct) ? <>{' '}<span className="ag-fig-base">% of {of}</span></> : null}
    </span>
  );
}

/**
 * One slice of the share bar. The full label ("Polymarket 14%") is what the
 * slice says when it fits; a slice too narrow for that shows the percent
 * alone, measured against the slice rather than a fixed share (Davies,
 * 2026-09-25). A cutoff of 12% still painted the middle of "Polymarket".
 * @param {{ s: { id: string, widthPct: number, title: string, text: string, short: string } }} props
 */
function ShareSegment({ s }) {
  const ref = React.useRef(/** @type {HTMLSpanElement | null} */ (null));
  const [narrow, setNarrow] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !s.text) { setNarrow(false); return undefined; }
    const fit = () => {
      const probe = document.createElement('span');
      const cs = getComputedStyle(el);
      probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing};`;
      probe.textContent = s.text;
      el.appendChild(probe);
      const tooNarrow = probe.offsetWidth > el.clientWidth + 1;
      probe.remove();
      setNarrow((prev) => (prev === tooNarrow ? prev : tooNarrow));
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [s.text]);
  return (
    <span ref={ref} className={`ag-share ag-share-${s.id}`} style={{ width: `${s.widthPct}%` }} title={s.title}>
      {narrow ? s.short : s.text}
    </span>
  );
}

/**
 * A tab's venues: a card per venue its rows trade on, and the share bar
 * when there is more than one venue to share between. The tab names the
 * mode, so a card no longer counts its live rows. A card adds up the tab's
 * strategies on its venue and any paper test that trades there; a venue
 * reached only through a test (Polymarket) is that test's card (`venueRows`).
 * @param {{ dash: any, tab: 'live' | 'testing', m: (s: string) => string, tests?: any[] }} props
 */
function VenueSplit({ dash, tab, m, tests = [] }) {
  const rows = venueRows(dash, tab, tests);
  const segments = shareSegments(rows);
  const onTab = tabStrategies(dash, tab);
  if (!rows.length) return null;
  const gl = (/** @type {number} */ usd, /** @type {number | null} */ pct) => <span className="ag-gl" style={{ color: pctColor(usd) }}>{m(glText(usd, pct))}</span>;
  return (
    <section className="ag-venues">
      <div className="ag-section-title mono">VENUES</div>
      {rows.length > 1 && (
        <div className="ag-share-bar">
          {segments.map((s) => (
            <ShareSegment key={s.id} s={s} />
          ))}
        </div>
      )}
      <div className={`ag-venue-cards is-${rows.length === 1 ? 'single' : rows.length === 2 ? 'two' : 'three'}`}>
        {rows.map((r) => {
          const n = r.strategies + (r.tests || 0);
          return (
          <div key={r.id} className={`ag-venue-card ag-venue-card-${r.id}${r.note ? ' is-warn' : ''}`}>
            <div className="ag-venue-head">
              <VenueBadge id={r.id} />
              <div className="dim mono ag-venue-meta">
                {`${n} ${n === 1 ? 'strategy' : 'strategies'}${r.feeBps ? ` · maker/taker ${fmtFees(r.feeBps)}` : ''}`}
              </div>
            </div>
            <div className="ag-venue-grid mono">
              {/* Funded is the capital the venue's strategies on this tab are allotted, not the account's balance: a
                  real balance here only misled while every row traded paper (Davies, 2026-09-23). */}
              <FigLabel name={`funded${r.test || paperOnly(onTab, r.id) ? ' (Paper)' : ''}`} title="the capital this venue's strategies are allotted" /><span>{m(fmtUsd(r.capitalUsd))}</span>
              <FigLabel name="deployed" />
              <span className="hl-strong">{m(fmtUsd(r.valueUsd))}{r.deployedPct != null ? <span className="dim ag-fig-pct"> ({r.deployedPct.toFixed(2)}%)</span> : null}</span>
              <FigLabel name="today" />{gl(r.todayUsd, r.todayPct)}
              <FigLabel name="unrealised" />{gl(r.unrealisedUsd, r.unrealisedPct)}
              <FigLabel name="realised" />{gl(r.realisedUsd, r.realisedPct)}
              {r.test?.rewards ? (
                <>
                  <span className="dim ag-fig-sub">rewards</span><span className="ag-gl ag-fig-sub" style={{ color: pctColor(r.test.rewards.realisedUsd) }}>{m(fmtMoney(r.test.rewards.realisedUsd, { signed: true, compact: false }))}</span>
                  <span className="dim ag-fig-sub">orders</span><span className="ag-gl ag-fig-sub" style={{ color: pctColor(r.test.orders.realisedUsd) }}>{m(fmtMoney(r.test.orders.realisedUsd, { signed: true, compact: false }))}</span>
                </>
              ) : null}
              {r.feesUsd != null ? <><FigLabel name="fees" /><span className="dim">{m(fmtUsd(r.feesUsd))}</span></> : null}
            </div>
            {r.note && <div className="ag-warn-line">{r.note}</div>}
          </div>
          );
        })}
      </div>
    </section>
  );
}



/** One side of a rung in the ladder: idle, the price it quotes, or what it holds and has made at the last print. */
function LadderCell({ c, m }) {
  if (c.state === 'idle') return <span className="dim">idle</span>;
  if (c.state === 'quoting') return <span>{m(fmtQuotePrice(c.price))}</span>;
  return (
    <span className="ag-qheld">
      <span className="ag-state-pill ag-state-filled">held</span> {m(fmtQuotePrice(c.price))}
      {c.unrealisedUsd != null && <span className="ag-gl" style={{ color: pctColor(c.unrealisedUsd) }}> {m(fmtMoney(c.unrealisedUsd, { signed: true, compact: false }))}</span>}
    </span>
  );
}

/**
 * PR5's quotes on paper (reference §4 item 31), opened from their row in TESTING STRATEGIES: the strategy page's
 * header and scoreboard, then what differs — two books of six rungs instead of coins and a chart, and the round trips
 * instead of the orders. Its cards use the quote classes, which share the venue cards' rules without being venue
 * cards: the sweep finds a venue card by its class.
 */
function QuotesDetail({ q, m, at }) {
  const v = quotesView(q);
  const row = quotesRow(q);
  if (!v || !row) return null;
  const recent = q.recent ?? [];
  return (
    <div className="ag-detail ag-quotes-detail">
      <div className="ag-detail-head">
        <ModeBadge mode="paper" />
        <StatusDot status={row.status} />
      </div>
      <h3 className="ag-detail-title mono sr-only">Stablecoin quotes</h3>
      <div className="ag-scoreboard ag-scoreboard-sm">
        <FundedCells fundedUsd={row.capitalUsd} deployedUsd={row.valueUsd} m={m} />
        <div className="ag-sb-divider" />
        <GlCell label="TODAY" usd={row.todayUsd} pct={row.todayPct} m={m} />
        <div className="ag-sb-divider" />
        <GlCell label="UNREALIZED G/L" usd={row.unrealisedUsd} pct={row.unrealisedPct} m={m} />
        <div className="ag-sb-divider" />
        <GlCell label="REALIZED G/L" usd={row.realisedUsd} pct={row.realisedPct} m={m} />
      </div>
      {!v.running && <div className="ag-warn-line">{v.stoppedText}</div>}
      <section className="ag-section ag-quote-books">
        <div className="ag-section-title mono">BOOKS</div>
        <div className="ag-quotes-cards">
          {(q.books ?? []).map((b) => (
            <div key={b.book} className="ag-quotes-card">
              <div className="ag-quotes-head">
                <span className="hl-strong mono">{quoteBookLabel(b.book)}</span>
                <span className="dim mono ag-venue-meta">last trade {m(fmtQuotePrice(b.lastPrice))}{b.fair != null ? ` · fair ${m(fmtQuotePrice(b.fair))}` : ''}</span>
              </div>
              <table className="ag-ladder mono">
                <thead><tr><th className="dim">Rung</th><th className="dim">Bid</th><th className="dim">Ask</th></tr></thead>
                <tbody>
                  {quoteLadderRows(b).map((r) => (
                    <tr key={r.k}><td className="dim">{r.label}</td><td><LadderCell c={r.bid} m={m} /></td><td><LadderCell c={r.ask} m={m} /></td></tr>
                  ))}
                </tbody>
              </table>
              <div className="ag-quotes-grid mono">
                <span className="dim">round trips</span><span>{b.trips ? `${b.trips} · ${Math.round((100 * b.won) / b.trips)} % won` : '0'}</span>
                <span className="dim">realised</span><span className="ag-gl" style={{ color: pctColor(b.realisedUsd) }}>{m(fmtMoney(b.realisedUsd ?? 0, { signed: true, compact: false }))}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="ag-section ag-quote-trips">
        <div className="ag-section-title mono">ROUND TRIPS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr>
              <th className="hl-th">Closed ({UK_TZ})</th><th className="hl-th">Book</th><th className="hl-th">First</th><th className="hl-th ag-ph">Rung</th>
              <th className="hl-th">Entry</th><th className="hl-th">Exit</th><th className="hl-th ag-ph">Exit as</th><th className="hl-th">P&amp;L</th>
            </tr></thead>
            <tbody>
              {recent.length === 0 && <tr><td className="hl-empty dim" colSpan={8}>No round trip yet.</td></tr>}
              {recent.map((t) => (
                <tr key={`${t.book}|${t.side}|${t.k}|${t.tEntry}`} className={`txn-row txn-row-${t.side === 'bid' ? 'buy' : 'sell'}`}>
                  <td className="dim">{when(t.tExit)}</td>
                  <td className="hl-strong">{quoteBookLabel(t.book)}</td>
                  <td><span className={`ag-side ag-side-${t.side === 'bid' ? 'buy' : 'sell'}`}><span className="ag-side-mark" aria-hidden="true" />{t.side === 'bid' ? 'bought' : 'sold'}</span></td>
                  <td className="ag-ph dim">{t.k != null ? `${+(t.k * 100).toFixed(2)} %` : '—'}</td>
                  <td>{m(fmtQuotePrice(t.entry))}</td>
                  <td>{m(fmtQuotePrice(t.exit))}</td>
                  <td className="ag-ph dim">{t.how ?? '—'}</td>
                  <td className="ag-gl" style={{ color: pctColor(t.pnlUsd) }}>{m(fmtMoney(t.pnlUsd, { signed: true, compact: false }))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="ag-updated dim mono ag-quotes-foot">as of {when(at)} {UK_TZ} · refreshes every minute</div>
    </div>
  );
}

/** A closed UTC day as the page names it: "25 Sep", in the site's own month table (en-GB alone writes "Sept"). @param {string} day */
const dayLabel = (day) => fmtDayMonth(new Date(`${day}T00:00:00Z`), { locale: 'en-GB', timeZone: 'UTC' });

/**
 * RW's status: the pessimistic total, the largest market's share of it, how many markets are being quoted today,
 * and how many positions are still held. No line under the titles (Davies, 2026-09-25).
 * @param {{ v: NonNullable<ReturnType<typeof rwView>>, r: any, usd: (x: number | null | undefined) => string }} props
 */
function RwBar({ v, r, usd }) {
  const quoting = Number(r.quoting) || 0;
  const open = Number(r.open) || 0;
  const tiles = {
    'WORST CASE': { text: usd(r.stressUsd), color: pctColor(r.stressUsd) },
    'TOP SHARE': { text: v.bestShareText },
    'QUOTING TODAY': { text: String(quoting) },
    'POSITIONS STILL HELD': { text: String(open) },
  };
  return (
    <section className={`ag-section ag-rw-bar is-${v.phase}`}>
      <div className="ag-section-title mono">STATUS</div>
      <div className="ag-rw-tiles">
        {rwBarTileKeys(v.phase).map((k) => (
          <div key={k} className="ag-rw-tile">
            <div className="ag-rw-tile-k mono">{k}</div>
            <div className="ag-rw-tile-v mono" style={tiles[k].color ? { color: tiles[k].color } : undefined}>{tiles[k].text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * RW's paper test (reference §4 item 36), opened from its row in TESTING STRATEGIES: the strategy page's header and
 * scoreboard, then what differs — the bar's running figures, the closed days, today's quotes (each market, its
 * bid and ask, our share of the pool), and the fills with the prints that proved them.
 */
function RwDetail({ r, m, at }) {
  const row = rwRow(r);
  const v = rwView(r);
  if (!row || !v) return null;
  const markets = r.markets ?? [], days = r.days ?? [], recent = r.recent ?? [];
  const today = rwTodayRow(r, at);
  const dayRows = today ? [today, ...days] : days;
  /** @param {number | null | undefined} x */
  const usd = (x) => m(fmtMoney(Number(x) || 0, { signed: true, compact: false }));
  return (
    <div className="ag-detail ag-rw-detail">
      <div className="ag-detail-head">
        <ModeBadge mode="paper" />
        <StatusDot status={row.status} />
      </div>
      <h3 className="ag-detail-title mono sr-only">Reward quotes</h3>
      {/* Realised's rewards and orders (rwRow) and the bar's total, rewards and orders (rwView) come to the cent from
          one split of one total (rwSplit). Unrealised is the figure alone: its split is not shown (Davies, 2026-09-24). */}
      <div className="ag-scoreboard ag-scoreboard-sm">
        <FundedCells fundedUsd={row.capitalUsd} deployedUsd={row.valueUsd} m={m} />
        <div className="ag-sb-divider" />
        <GlCell label="TODAY" usd={row.todayUsd} pct={row.todayPct} m={m} />
        <div className="ag-sb-divider" />
        <GlCell label="UNREALIZED G/L" usd={row.unrealisedUsd} pct={row.unrealisedPct} m={m} />
        <div className="ag-sb-divider" />
        <GlCell label="REALIZED G/L" usd={row.realisedUsd} pct={row.realisedPct} m={m}
          split={[['rewards', row.rewards.realisedUsd], ['orders', row.orders.realisedUsd]]} />
      </div>
      {v.stoppedText && <div className="ag-warn-line">{v.stoppedText}</div>}
      {v.mismatch && <div className="ag-warn-line">its fills and its total differ by {usd(r.mismatchUsd)}</div>}
      <RwBar v={v} r={r} usd={usd} />

      <section className="ag-section ag-rw-days">
        <div className="ag-section-title mono">DAYS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr>
              <th className="hl-th">Day (UTC)</th><th className="hl-th">Costs</th><th className="hl-th ag-ph">Fills</th><th className="hl-th ag-ph">WORST CASE</th><th className="hl-th">Rewards</th><th className="hl-th">Total</th>
            </tr></thead>
            <tbody>
              {dayRows.length === 0 && <tr><td className="hl-empty dim" colSpan={6}>No day yet.</td></tr>}
              {dayRows.map((d) => (
                <tr key={d.live ? 'today' : d.day} className={d.phase === 'warm-up' ? 'ag-rw-warmup-day' : undefined}>
                  <td className="dim">{dayLabel(d.day)}{d.phase === 'warm-up' ? ' · warm-up' : ''}{d.live ? ' · today' : ''}</td>
                  <td>{m(fmtUsd(d.capitalUsd))}</td>
                  <td className="ag-ph">{d.fills}</td>
                  <td className="ag-ph ag-gl" style={{ color: pctColor(d.stressUsd) }}>{usd(d.stressUsd)}</td>
                  <td className="ag-gl" style={{ color: pctColor(d.rewardUsd) }}>{usd(d.rewardUsd)}</td>
                  <td className="ag-gl" style={{ color: pctColor(d.totalUsd) }}>{usd(d.totalUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ag-section ag-rw-markets">
        <div className="ag-section-title mono">QUOTES</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr>
              <th className="hl-th">Market</th><th className="hl-th ag-ph">Pool/day</th><th className="hl-th ag-ph">Quote</th><th className="hl-th ag-ph">Share</th>
              <th className="hl-th">Held</th><th className="hl-th ag-ph">Rewards</th><th className="hl-th ag-ph">Orders</th><th className="hl-th">Total</th>
            </tr></thead>
            <tbody>
              {markets.length === 0 && <tr><td className="hl-empty dim" colSpan={8}>No market chosen today yet.</td></tr>}
              {markets.map((x) => {
                const s = splitCents(Number(x.totalUsd) || 0, [Number(x.rewardUsd) || 0, Number(x.fillsPnlUsd) || 0]);
                const c = { total: s.total, a: s.parts[0], b: s.parts[1] };
                return (
                  <tr key={x.cond}>
                    <td className="hl-strong ag-rw-market"><span className="ag-rw-q" title={x.q}>{x.q || x.cond}</span>{x.quoting ? null : <span className="hl-sub dim">held from an earlier day</span>}</td>
                    <td className="ag-ph">{x.ratePerDay != null ? m(fmtUsd(x.ratePerDay)) : '—'}</td>
                    <td className="ag-ph">{x.bid != null || x.ask != null ? `${m(fmtCents(x.bid))} / ${m(fmtCents(x.ask))}` : '—'}</td>
                    <td className="ag-ph">{x.share != null ? `${Math.round(x.share * 100)} %` : '—'}</td>
                    <td>{m(rwHeldText(x.net))}</td>
                    <td className="ag-ph ag-gl" style={{ color: pctColor(c.a) }}>{usd(c.a)}</td>
                    <td className="ag-ph ag-gl" style={{ color: pctColor(c.b) }}>{usd(c.b)}</td>
                    <td className="ag-gl" style={{ color: pctColor(c.total) }}>{usd(c.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ag-section ag-rw-fills">
        <div className="ag-section-title mono">FILLS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr>
              <th className="hl-th">When ({UK_TZ})</th><th className="hl-th">Market</th><th className="hl-th">Side</th><th className="hl-th ag-col-shares">Shares</th><th className="hl-th ag-col-price">Price</th>
            </tr></thead>
            <tbody>
              {recent.length === 0 && <tr><td className="hl-empty dim" colSpan={5}>No fill yet.</td></tr>}
              {recent.map((f) => (
                <tr key={`${f.cond}|${f.minute}|${f.ts}|${f.side}|${f.price}|${f.size}`} className={`txn-row txn-row-${f.side === 'bid' ? 'buy' : 'sell'}`}>
                  <td className="dim">{when(f.ts)}</td>
                  <td className="hl-strong"><span className="ag-rw-q" title={f.q}>{f.q || f.cond}</span></td>
                  <td><span className={`ag-side ag-side-${f.side === 'bid' ? 'buy' : 'sell'}`}><span className="ag-side-mark" aria-hidden="true" />{f.side === 'bid' ? 'bought Yes' : 'sold Yes'}</span></td>
                  <td className="ag-col-shares">{m(rwShareText(f.size))}</td>
                  <td className="ag-col-price">{m(fmtCents(f.price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="ag-updated dim mono ag-rw-foot">as of {when(at)} {UK_TZ} · refreshes every minute</div>
    </div>
  );
}

// Status and return first: the two facts that say whether a strategy is
// alive and making money sit right after its name at every width. The
// money detail (cost, value, unrealised, orders, last decision) hides
// under 760 px — it is all on the detail page — so a phone sees a whole
// row without scrolling.
// No Mode column: the tab says LIVE or TESTING (Davies, 2026-09-24). The heading is the column's name alone —
// the "% of …" line under Today, Unrealised and Realised is gone (Davies, 2026-09-25). Deployed, beside Venue,
// is the same dollars the scoreboard calls DEPLOYED (`valueUsd`) — what the row holds.
const COLUMNS = [
  { id: 'name', label: 'Strategy', cls: 'hl-left' },
  { id: 'venue', label: 'Venue', cls: 'hl-left' },
  { id: 'deployed', label: 'Deployed', cls: 'hl-right' },
  { id: 'today', label: 'Today', cls: 'hl-right' },
  { id: 'unrealised', label: 'Unrealised G/L', cls: 'hl-right' },
  { id: 'realised', label: 'Realised G/L', cls: 'hl-right' },
  { id: 'next', label: 'Next', cls: 'hl-left' },
];

/**
 * The status as a coloured dot beside the name — green running, amber stale, grey paused — with the words in its
 * title.
 */
function NameCell({ r, m, onOpen }) {
  return (
    <div className="ag-name-wrap">
      <span className={`ag-dot ag-dot-${r.status.tone}`} title={r.status.detail} role="img" aria-label={r.status.detail} />
      <button type="button" className="ag-name-btn ag-name" onClick={() => onOpen(r.id)}>{r.name}</button>
      <span className="hl-sub dim">{r.openPositions} open · {m(fmtUsd(r.capitalUsd))} cap</span>
    </div>
  );
}

/** A row's unrealised. A row whose percent is not on cost still says so under the figure. */
function UnrealisedCell({ r, m }) {
  return (
    <>
      <span className="ag-gl" style={{ color: pctColor(r.unrealisedUsd) }}>{m(glText(r.unrealisedUsd, r.unrealisedPct))}</span>
      {r.unrealisedOf && r.unrealisedPct != null && Number.isFinite(r.unrealisedPct) ? <span className="ag-cell-base dim">% of {r.unrealisedOf}</span> : null}
    </>
  );
}

function StrategyCell({ id, r, m, onOpen }) {
  switch (id) {
    case 'name': return <NameCell r={r} m={m} onOpen={onOpen} />;
    case 'venue': return <VenueBadge id={r.venueId} />;
    case 'deployed': return <span className="ag-deployed">{m(fmtUsd(r.valueUsd))}</span>;
    case 'today': return <span className="ag-gl" style={{ color: pctColor(r.todayUsd) }}>{m(glText(r.todayUsd, r.todayPct))}</span>;
    case 'unrealised': return <UnrealisedCell r={r} m={m} />;
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

/** A phone gets a card per strategy instead of the table: the same facts, stacked. */
function StrategyCards({ rows, m, onOpen }) {
  if (!rows.length) return <div className="ag-empty dim">No strategies yet.</div>;
  return (
    <div className="ag-cards">
      {rows.map((r) => (
        <div key={r.id} className="ag-card-strategy ag-row" onClick={() => onOpen(r.id)}>
          <div className="ag-card-head ag-name-cell">
            <NameCell r={r} m={m} onOpen={onOpen} />
          </div>
          <div className="ag-card-badges"><VenueBadge id={r.venueId} /></div>
          <div className="ag-card-gl mono">
            <FigLabel name="deployed" /><span className="ag-deployed">{m(fmtUsd(r.valueUsd))}</span>
            <FigLabel name="today" pct={r.todayPct} of="cap" /><span className="ag-gl ag-card-today" style={{ color: pctColor(r.todayUsd) }}>{m(glText(r.todayUsd, r.todayPct))}</span>
            <FigLabel name="unrealised" pct={r.unrealisedPct} of={r.unrealisedOf ?? 'cost'} /><span className="ag-gl" style={{ color: pctColor(r.unrealisedUsd) }}>{m(glText(r.unrealisedUsd, r.unrealisedPct))}</span>
            <FigLabel name="realised" pct={r.realisedPct} of="cap" /><span className="ag-gl" style={{ color: pctColor(r.realisedUsd) }}>{m(glText(r.realisedUsd, r.realisedPct))}</span>
            <FigLabel name="next" /><span className="ag-next">{r.nextText}</span>
          </div>
        </div>
      ))}
    </div>
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
function PriceChart({ chart, nowMs, hue, m = (s) => s }) {
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
    const lines = [`${fmtChartStamp(hover.t)} ${UK_TZ}`, `close  ${fmtChartPrice(hover.close, span)}`];
    for (const f of hover.fills) lines.push(`${f.side === 'buy' ? 'bought' : 'sold'} ${sizeText(f.base, m)} @ ${fmtChartPrice(f.price, span)}`);
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
              <title>{`${f.side === 'buy' ? 'bought' : 'sold'} ${sizeText(f.base, m)} @ ${fmtChartPrice(f.price, span)} · ${fmtChartStamp(f.ts)} ${UK_TZ}`}</title>
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

/** What stops a tab's strategies trading, said out loud above its table: a global pause, a venue fault, a live venue with no key. */
function Alerts({ dash, tab }) {
  const alerts = alertsFor(dash, tab);
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

/**
 * The ORDERS table, exactly as it was at the bottom of the page, moved up
 * under the chart and scoped to the pair the chart is drawing. Two things
 * differ from the old one and nothing else: the SIDE wears the arrow the
 * chart marks a fill with, so a row and a mark on the plot read as one
 * thing, and the notional is called Cost, which is what it is. Times are UK
 * local, the clock in the site's header.
 * @param {{ chart: any, more: any, symbol: string | null, m: (s: string) => string, venue: string }} props
 */
function SymbolOrders({ chart, more, symbol, m, venue }) {
  const rows = symbolOrderRows(chart, more, symbol);
  return (
    <div className="ag-fills">
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th">When ({UK_TZ})</th><th className="hl-th">Symbol</th><th className="hl-th ag-ph">Venue</th><th className="hl-th">Side</th>
            <th className="hl-th">Price</th><th className="hl-th ag-ph">Size</th><th className="hl-th ag-ph">Cost</th>
            <th className="hl-th">State</th><th className="hl-th ag-ph">Fill</th><th className="hl-th ag-ph">Fee</th><th className="hl-th ag-ph">Mode</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={11}>No orders on this pair in the window.</td></tr>}
            {rows.map((o) => (
              <tr key={o.id} className={`txn-row txn-row-${o.side}`}>
                <td className="dim">{fmtChartStamp(o.ts)}</td>
                <td className="hl-strong">{symbol}</td>
                <td className="ag-ph"><VenueBadge id={o.venue ?? venue} /></td>
                <td>
                  <span className={`ag-side ag-side-${o.side}`}><span className="ag-side-mark" aria-hidden="true" />{o.side}</span>
                </td>
                <td>{m(fmtUsd(o.price))}</td>
                <td className="ag-ph">{sizeText(o.base, m)}</td>
                <td className="ag-ph">{m(fmtUsd(o.costUsd))}</td>
                <td><span className={`ag-state-pill ag-state-${o.state}`}>{o.state.replace('_', ' ')}</span></td>
                <td className="ag-ph">{o.fillPrice != null ? m(fmtUsd(o.fillPrice)) : <span className="dim">—</span>}</td>
                <td className="dim ag-ph">{m(fmtUsd(o.feeUsd))}</td>
                <td className="ag-ph"><ModeBadge mode={o.mode} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The chart card: symbol tabs, the chart for the one selected, and its fills. */
function SymbolChart({ s, symbol, onSelect, m, nowMs, at, gen, more, loadingMore, onLoadMore }) {
  const [chart, setChart] = React.useState(/** @type {any} */ (() => readChartCache(s.id, symbol)?.chart ?? null));
  const [error, setError] = React.useState(/** @type {string | null} */ (null));
  const [loading, setLoading] = React.useState(() => !readChartCache(s.id, symbol));
  const held = new Map((s.positions ?? []).map((p) => [p.symbol, p]));

  // A new pair empties the card. Each dashboard refresh (`gen`) — the
  // minute's, or the button on this page — refetches without clearing the
  // frame, the way a live chart should. `at` alone is not enough: two
  // answers can share a timestamp, and a click must still redraw.
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
  }, [s.id, symbol, at, gen]);

  // The row's own venue, like its badge: the candles are Kraken's, but Kraken is not a venue on the page any more.
  const hue = venueHue(chart?.venue ?? s.venue);
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
        {loading && !chart && <span className="dim">loading…</span>}
      </div>
      {error && <AgentsError err={error} compact />}
      {!error && !chart && loading && <div className="ag-chart-skeleton" aria-hidden="true" />}
      {!error && chart && (
        <>
          <PriceChart m={m} chart={chart} nowMs={nowMs} hue={hue} />
          <SymbolOrders chart={chart} more={more} symbol={symbol} m={m} venue={chart.venue ?? s.venue} />
          {showFullHistory(chart, more) && (
            <button type="button" className="btn-ghost ag-more" onClick={() => onLoadMore(historyLimitOf(chart))} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load full history'}</button>
          )}
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
            <span className={r.observation?.fresh ? 'ag-live-fresh' : 'dim'}>{lastChangeText(r.observation ? r.observation.ageMs : null)}</span>
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
      <div className="ag-notready-foot mono dim">checked {when(dash.at)} {UK_TZ}</div>
    </div>
  );
}

/**
 * LIVE and TESTING, at the top of the page (Davies, 2026-09-24): one tab
 * each, switched by a click or the arrow keys. A tab says how many rows it
 * lists and what money is on it. LIVE's mark is green once armed, amber
 * while it awaits arming, grey under the global pause or while its rows
 * only wind real coins down, and an empty ring while nothing is live;
 * TESTING's is PAPER's dashed ring.
 * @param {{ view: ReturnType<typeof agentsTabsView>, tab: 'live' | 'testing', onSelect: (t: 'live' | 'testing') => void }} props
 */
function ModeTabs({ view, tab, onSelect }) {
  /** @param {React.KeyboardEvent<HTMLDivElement>} e */
  const onKey = (e) => {
    const i = AGENT_TABS.indexOf(tab), n = AGENT_TABS.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onSelect(AGENT_TABS[to]);
    /** @type {HTMLElement | null} */ (e.currentTarget.querySelector(`#ag-modetab-${AGENT_TABS[to]}`))?.focus();
  };
  return (
    <div className="ag-modebar" role="tablist" aria-label="Live and testing strategies" onKeyDown={onKey}>
      {AGENT_TABS.map((id) => {
        const t = view[id], on = id === tab;
        return (
          <button key={id} type="button" role="tab" id={`ag-modetab-${id}`} aria-selected={on} aria-controls={on ? 'ag-modepanel' : undefined}
            tabIndex={on ? 0 : -1} className={`ag-modetab ag-modetab-${id} is-${t.tone}${on ? ' is-on' : ''}`} onClick={() => onSelect(id)}>
            <span className="ag-modetab-top">
              <span className="ag-modetab-mark" aria-hidden="true" />
              <span className="ag-modetab-label mono">{t.label}</span>
              <span className="ag-modetab-count mono" aria-label={`${t.count} ${t.count === 1 ? 'row' : 'rows'}`}>{t.count}</span>
            </span>
            <span className="ag-modetab-text">{t.text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** LIVE with nothing on it: said once, calmly, with where everything is instead. */
function LiveEmpty() {
  return (
    <div className="ag-nolive">
      <span className="ag-nolive-ring" aria-hidden="true" />
      <h3 className="ag-nolive-title mono">Nothing is live</h3>
      <p className="ag-nolive-text dim">No strategy trades real money right now. Every strategy runs on paper, under TESTING.</p>
    </div>
  );
}

/**
 * What the strategy is holding, as the SAME card the tactics board opens for
 * a ticker: one structure and one stylesheet for "here is a position", so a
 * person reading the agents page is not learning a second layout. Clicking a
 * card points the chart at that pair, the way the board's card opens a chart.
 * @param {{ s: any, m: (s: string) => string, nowMs: number, selected: string | null, onSelect: (sym: string) => void }} props
 */
function PositionTiles({ s, m, nowMs, selected, onSelect }) {
  const lines = positionLines(s);
  if (!lines.length) return null;
  return (
    <div className="player-grid ag-poscards">
      {lines.map((p) => (
        <div key={p.symbol} role="button" tabIndex={0}
          className={`player-card ag-poscard${p.symbol === selected ? ' is-on' : ''}`}
          onClick={() => onSelect(p.symbol)}
          onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.symbol); } }}>
          <div className="pc-top">
            <span className="pc-ticker mono">{p.symbol}</span>
            <span className="pc-day mono" style={{ color: pctColor(p.returnPct) }}>
              {m(fmtMoney(p.unrealisedUsd ?? 0, { signed: true, compact: false }))} ({fmtPctSigned(p.returnPct, 2)})
            </span>
          </div>
          <div className="pc-price mono">{m(fmtUsd(p.mark))}</div>
          <div className="pc-rows">
            <div className="pc-row"><span className="dim">Size</span><span className="mono">{sizeText(p.base, m)}</span></div>
            <div className="pc-row"><span className="dim">Avg cost</span><span className="mono">{m(fmtUsd(p.avgCost))}</span></div>
            <div className="pc-row"><span className="dim">Cost</span><span className="mono">{m(fmtUsd(p.costUsd))}</span></div>
            <div className="pc-row"><span className="dim">Value</span><span className="mono">{m(fmtUsd(p.valueUsd))}</span></div>
            <div className="pc-row"><span className="dim">Held</span><span className="mono">{p.openedAt != null ? ago(nowMs - p.openedAt) : '—'}</span></div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The countdown to the next decision, to the second. It owns its one-second
 * clock so that only these few characters re-render each second — the chart,
 * the tables and the tiles around it keep the modal's slower clock.
 * @param {{ at: string | null, label: string }} props
 */
function Countdown({ at, label }) {
  const [sec, setSec] = React.useState(() => Date.now());
  React.useEffect(() => { const id = setInterval(() => setSec(Date.now()), 1000); return () => clearInterval(id); }, []);
  return (
    <span className="ag-countdown mono" title={at ? `${fmtChartStamp(at)} ${UK_TZ}` : undefined}>
      <span className="dim">{label}</span> <span className="ag-countdown-val">{countdownText(at, sec)}</span>
    </span>
  );
}

function Detail({ s, dash, m, nowMs, gen }) {
  const [more, setMore] = React.useState(/** @type {{ decisions: any[], orders: any[] } | null} */ (null));
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [symbol, setSymbol] = React.useState(() => defaultChartSymbol(s));
  React.useEffect(() => { setSymbol(defaultChartSymbol(s)); }, [s.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const status = strategyRows({ ...dash, strategies: [s] }, nowMs)[0].status;
  const loadMore = async (limit) => {
    setLoadingMore(true);
    try { setMore(await fetchAgentsLog(s.id, limit)); } catch { /* keep what we have */ } finally { setLoadingMore(false); }
  };
  return (
    <div className="ag-detail">
      <div className="ag-detail-head">
        <ModeBadge mode={s.mode} />
        <StatusDot status={status} />
        <Countdown at={s.nextDecisionAt} label={s.kind === 'dislocation-1m' ? 'next read' : 'next decision'} />
      </div>
      <h3 className="ag-detail-title mono sr-only">{strategyName(s)}</h3>
      <StrategyScoreboard s={s} m={m} />
      <PositionTiles s={s} m={m} nowMs={nowMs} selected={symbol} onSelect={setSymbol} />
      <LiveState s={s} nowMs={nowMs} selected={symbol} onSelect={setSymbol} />
      <SymbolChart s={s} symbol={symbol} onSelect={setSymbol} m={m} nowMs={nowMs} at={dash?.at} gen={gen} more={more} loadingMore={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}

/**
 * @param {{ hideValues: boolean, onClose: () => void }} props
 */
function AgentsModal({ hideValues, onClose }) {
  // Opens on the copy the app fetched at start (or the last refresh, or —
  // straight after a reload — the one this browser kept), then refreshes.
  const [dash, setDash] = React.useState(/** @type {any} */ (() => readAgentsCache()?.dash ?? null));
  const [error, setError] = React.useState(/** @type {string | null} */ (null));
  const [loading, setLoading] = React.useState(() => !readAgentsCache());
  const [selected, setSelected] = React.useState(/** @type {string | null} */ (null));
  const [now, setNow] = React.useState(() => Date.now());
  // Bumps on every dashboard answer, including one whose `at` did not move,
  // so the open chart refetches with the rest of the page.
  const [gen, setGen] = React.useState(0);
  const m = React.useCallback((s) => (hideValues ? maskDigits(s) : s), [hideValues]);

  // Two refreshes can be in flight together (the minute's interval and a click): only the NEWEST request's answer is
  // applied, whatever order the answers arrive in, and nothing is applied once the page is gone.
  const guard = React.useRef(newestWins());
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);
  /** @param {boolean} [manual] a click shows the button working; the minute's own refresh does not flip it */
  const load = React.useCallback(async (manual = false) => {
    const seq = guard.current.start();
    if (manual || !readAgentsCache()) setLoading(true);
    try {
      // A click asks anew; anything else joins a request already on its way — the app's own fetch after first paint,
      // which a page opened straight after a reload would otherwise duplicate.
      const next = await ((!manual && dashboardInFlight()) || fetchAgentsDashboard());
      if (!alive.current || !guard.current.isLatest(seq)) return;
      setDash(next); setError(null); setGen((g) => g + 1);
    } catch (e) {
      if (!alive.current || !guard.current.isLatest(seq)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current && guard.current.isLatest(seq)) { setLoading(false); setNow(Date.now()); }
    }
  }, []);

  React.useEffect(() => {
    // One clock for every agents page. The list and the pages opened over
    // it are this one modal, so a strategy, the quote test or Reward quotes
    // keeps the same minute (Davies, 2026-09-25). A hidden tab does not call
    // out; coming back after a minute does, at once.
    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    let last = 0;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const fire = () => {
      if (cancelled || hidden()) return;
      load();
      last = Date.now();
    };
    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => { fire(); schedule(); }, REFRESH_MS);
    };
    const onVisibility = () => {
      if (cancelled || hidden()) return;
      if (Date.now() - last >= REFRESH_MS) {
        if (timer) clearTimeout(timer);
        fire();
        schedule();
      }
    };
    fire();
    schedule();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    // The data comes once a minute; the CLOCK moves faster, so "seen 40 s
    // ago" creeps instead of jumping a minute at a time.
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(tick);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const rows = React.useMemo(() => strategyRows(dash, now), [dash, now]);
  const split = React.useMemo(() => splitStrategyRows(rows), [rows]);
  // The quote test is a row of TESTING STRATEGIES (Davies, 2026-09-23), after the strategies; it runs on paper only.
  const quotes = React.useMemo(() => quotesRow(dash?.quotes), [dash]);
  // RW's paper test on Polymarket joins it (Davies, 2026-09-24), after the quote test; paper only too.
  const rw = React.useMemo(() => rwRow(dash?.rw), [dash]);
  // The two paper tests are listed on TESTING and added into no total: the tab's count, its venue cards and their own
  // rows say so.
  const tests = React.useMemo(() => [...(quotes ? [quotes] : []), ...(rw ? [rw] : [])], [quotes, rw]);
  const testing = React.useMemo(() => [...split.testing, ...tests], [split, tests]);
  const tabsView = React.useMemo(() => agentsTabsView(dash, tests.length), [dash, tests]);
  // The page opens on LIVE while anything trades real money, else on TESTING, and follows the data until a tab is
  // clicked; from then on the click holds, through every refresh and every page opened over the list.
  const [tabChoice, setTabChoice] = React.useState(/** @type {'live' | 'testing' | null} */ (null));
  const tab = tabChoice ?? defaultAgentsTab(dash);
  const phone = useMediaQuery('(max-width: 760px)');
  const current = selected ? (dash?.strategies ?? []).find((s) => s.id === selected) ?? null : null;
  const quotesOpen = selected === QUOTES_ROW_ID && !!dash?.quotes;
  const rwOpen = selected === RW_ROW_ID && !!dash?.rw;
  const notReady = !!dash?.notReady;
  const tabRows = tab === 'live' ? split.live : testing;

  return (
    <>
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div>
          <h2 className="modal-title mono">Agents (beta)</h2>
        </div>
        <PageActions onRefresh={() => load(true)} onClose={onClose} loading={loading} />
      </header>
      {dash && !notReady && <ModeTabs view={tabsView} tab={tab} onSelect={setTabChoice} />}
      <div className="modal-body ag-body">
        {error && !dash && <AgentsError err={error} onRetry={load} />}
        {error && dash && <AgentsError err={error} onRetry={load} compact />}
        {!dash && !error && <div className="ag-empty dim">Loading…</div>}
        {notReady && <NotReady dash={dash} />}
        {dash && !notReady && (
          <div className={`ag-modepanel ag-modepanel-${tab}`} role="tabpanel" id="ag-modepanel" aria-labelledby={`ag-modetab-${tab}`}>
            {tab === 'live' && split.live.length === 0 ? (
              <>
                <Alerts dash={dash} tab={tab} />
                <LiveEmpty />
              </>
            ) : (
              <>
                <Scoreboard dash={dash} tab={tab} m={m} tests={tab === 'testing' ? tests : []} />
                <VenueSplit dash={dash} tab={tab} m={m} tests={tab === 'testing' ? tests : []} />
                <Alerts dash={dash} tab={tab} />
                <section className={`ag-section ag-strategies ag-strategies-${tab}`}>
                  <div className="ag-section-title mono">{tab === 'live' ? 'LIVE STRATEGIES' : 'TESTING STRATEGIES'}</div>
                  {phone ? <StrategyCards rows={tabRows} m={m} onOpen={setSelected} /> : <StrategyTable rows={tabRows} m={m} onOpen={setSelected} />}
                </section>
              </>
            )}
            <div className="ag-updated dim mono">as of {when(dash.at)} {UK_TZ} · refreshes every minute</div>
          </div>
        )}
      </div>
    </Modal>
    {current && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono">{strategyName(current)}</h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <Detail s={current} dash={dash} m={m} nowMs={now} gen={gen} />
        </div>
      </Modal>
    )}
    {quotesOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono">Stablecoin quotes</h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <QuotesDetail q={dash.quotes} m={m} at={dash.at} />
        </div>
      </Modal>
    )}
    {rwOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono">Reward quotes</h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <RwDetail r={dash.rw} m={m} at={dash.at} />
        </div>
      </Modal>
    )}
    </>
  );
}

export { AgentsModal };
