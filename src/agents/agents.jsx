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
import { SurfaceBoundary } from '../app/surface_boundary.jsx';
import { fmtDayMonth, maskDigits, pctColor } from '../app/formatters.js';
import { ukTzAbbr } from '../prices/market_hours.js';
import {
  AGENT_TABS, FXW_ROW_ID, fmtFx, fxwAudRow, fxwTiles, GROKPM_ROW_ID, GROKPM_ROW_NAME, grokPmRow, grokTestRow, grokTestOf, grokTestTiles, grokTestLayerCells, grokPmModeTag, grokPmTiles, grokPmStopText, grokPmMismatchText, grokPmDayCells, grokPmJournalView, fmtProb, LP_LIVE_ROW_ID, LP_R_TILE, lpStopRoomText, lpEstimateTexts, lpLiveDayCells, lpLiveStatus, liveExtraRows, lpLiveRow, agentsErrorView, agentsTabsView, alertsFor, countdownText, dashboardInFlight, defaultAgentsTab, defaultChartSymbol, fetchAgentsChart, fetchAgentsDashboard, fetchAgentsLog, fmtBps, fmtCents, fmtFees, fmtFeeGbp4, fmtFeeIn4, fmtGbp, fmtGbp4, fmtIn, fmtIn4, quotesDetailInCcy, fmtPct2, fmtPctSigned, fmtQuotePrice, fmtQuoteQty, fmtUsd, glText, glTextIn, historyLimitOf, lastChangeText, liveStateRows, newestWins, quoteBookLabel, quoteLadderRows, quoteRungLabel, orderStateText, quotesLiveBooks, quotesLiveInventory, QUOTES_COINBASE_HOLD_ROW_ID, QUOTES_COINBASE_USDC_ROW_ID, quotesPageFor, quotesOkxName, quotesOkxOf, quotesOkxRow, positionLines, readAgentsCache, readChartCache, quoteDaysAnnualPct, quoteDaysRecent, QUOTE_DAYS_ANNUAL_LABEL, QUOTE_DAYS_ANNUAL_TITLE, quotesLiveRow, quotesTwinLines, quotesTwinOf, quotesTwinRow, quotesCoinbaseRow, rowMoney, rwBarTileKeys, rwFillView, lpLiveQuoteRows, rwHeldOf, rwShareText, scoreboardView, shareSegments, showFullHistory, sizeText, splitCents, splitStrategyRows, strategyName, strategyNameParts, strategyRows, strategyScoreboard, symbolOrderRows, testedForText, venueHue, venueLabel, venueRows, paperTestRows,
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

/**
 * The status as a dot and its words, and after them how long the strategy has been under test, to the hour (Davies,
 * 2026-09-28): "running · tested 3d 14h", "live 3d 2h" on the live row. `since` is when its test began. `toned` colours
 * the dot as the strategy list colours it (`ag-dot-<tone>`: amber for a stale or dry-run row), so a page's head and its
 * row in the list show one light (GROKPM's, Davies 2026-10-17).
 * @param {{ status: any, since?: string | null, until?: string | null, nowMs?: number, live?: boolean, toned?: boolean }} props
 */
function StatusDot({ status, since = null, until = null, nowMs = Date.now(), live = false, toned = false }) {
  const tested = testedForText(since, nowMs, until);
  return (
    <span className={`ag-status${status.running ? ' is-running' : ''}`}>
      <span className={toned && status.tone ? `ag-dot ag-dot-${status.tone}` : 'ag-dot'} />
      <span className="ag-status-text" title={status.detail}>{status.running ? 'running' : status.detail}</span>
      {tested && <span className="ag-tested" title={`since ${when(String(since))} ${UK_TZ}`}>{live ? 'live' : 'tested'} {tested}</span>}
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
 * @param {{ label: string, asides?: Array<string | null | false | undefined>, notes?: Array<string | null | false | undefined> }} props
 */
function SbLabel({ label, asides = [], notes = [] }) {
  return (
    <div className="sb-label ag-sb-label">
      <span className="ag-sb-name">{label}</span>
      {asides.filter(Boolean).map((a, i) => <span key={i} className="ag-sb-aside">{a}</span>)}
      {/* A longer line (a Reward quotes page's estimated rebates) goes under the name and wraps, inside the cell. */}
      {notes.filter(Boolean).map((a, i) => <span key={`n${i}`} className="ag-sb-aside ag-sb-note">{a}</span>)}
    </div>
  );
}

/**
 * One cell of the scoreboard: a label, a signed amount, its percent — the home page's own shape. `aside` is what else
 * is in the figure (the fees on realised). A percent no longer names its base beside the title (Davies, 2026-09-24):
 * the number beside the dollars is enough. `split` is what the figure is made of, each part on its own line under it
 * (Davies, 2026-09-25): one running line wrapped through the amount.
 * `ccy` is the figure's currency: dollars, or pounds on the stablecoin quotes' pages (Davies, 2026-10-01).
 * `aside` may be several: the first beside the name, the rest each a line of its own under it (a Reward quotes page's fees,
 * then its estimated rebates).
 * @param {{ label: string, usd: number, pct: number | null, m: (s: string) => string, aside?: string | string[] | null, split?: Array<[string, number]> | null, cls?: string, ccy?: string }} props
 */
function GlCell({ label, usd, pct, m, aside = null, split = null, cls = '', ccy = 'USD' }) {
  const hasPct = pct != null && Number.isFinite(pct);
  return (
    <div className={`ag-sb-cell ${cls}`}>
      <SbLabel label={label} asides={Array.isArray(aside) ? aside.slice(0, 1) : [aside]} notes={Array.isArray(aside) ? aside.slice(1) : []} />
      <div className="sb-value mono sb-change-row" style={{ color: pctColor(usd) }}>
        <span className="ag-sb-usd">{m(fmtIn(usd ?? 0, ccy, true))}</span>
        {hasPct ? <span className="sb-pct">({fmtPctSigned(pct, 2)})</span> : null}
      </div>
      <div className="ag-sb-extra">
        {split && split.length > 0 ? (
          <span className="ag-sb-split mono">
            {split.map(([k, v]) => (
              <span key={k} className="ag-sb-split-line">
                <span className="dim">{k}</span>{' '}<span className="ag-sb-split-v" style={{ color: pctColor(v) }}>{m(fmtIn(v, ccy, true))}</span>
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
 * `known` false shows FUNDED as a dash (LIVE's Reward quotes before its money put in is read: never its cap).
 * @param {{ fundedUsd: number, deployedUsd: number, m: (s: string) => string, aside?: string | null, ccy?: string, known?: boolean }} props
 */
function FundedCells({ fundedUsd, deployedUsd, m, aside = null, ccy = 'USD', known = true }) {
  const pct = fundedUsd > 0 ? (deployedUsd / fundedUsd) * 100 : null;
  const hasPct = pct != null && Number.isFinite(pct);
  return (
    <>
      <div className="ag-sb-cell ag-sb-cell-main ag-sb-cell-funded">
        <SbLabel label="FUNDED" asides={[aside]} />
        <div className="sb-value sb-value-lg mono">{known ? m(fmtIn(fundedUsd, ccy)) : '—'}</div>
        <div className="ag-sb-extra" />
      </div>
      <div className="ag-sb-divider" />
      <div className="ag-sb-cell ag-sb-cell-main ag-sb-cell-deployed">
        <SbLabel label="DEPLOYED" />
        <div className="sb-value sb-value-lg mono">
          {m(fmtIn(deployedUsd, ccy))}{hasPct ? <span className="ag-sb-deployed-pct">({fmtPct2(pct)})</span> : null}
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
 * A figure's label in a card: its name alone. The small "% of cap" / "% of cost" line a strategy card carried under
 * its today, unrealised and realised went on Davies' word (2026-09-27), as the table's had (2026-09-25).
 * @param {{ name: string, title?: string }} props
 */
function FigLabel({ name, title }) {
  return (
    <span className="dim ag-fig-label" title={title}>
      <span className="ag-fig-name">{name}</span>
    </span>
  );
}

/**
 * One slice of the share bar. The full label ("Polymarket 14%") is what the
 * slice says when it fits; a slice too narrow for that shows the percent
 * alone, measured against the slice rather than a fixed share (Davies,
 * 2026-09-25). A cutoff of 12% still painted the middle of "Polymarket".
 * A slice too narrow even for its percent says nothing, and its title still
 * does: a 2% slice on a phone painted the middle of "2%" (2026-10-01, once
 * the stablecoin quotes' deployed counted every rung at work).
 * @param {{ s: { id: string, widthPct: number, title: string, text: string, short: string } }} props
 */
function ShareSegment({ s }) {
  const ref = React.useRef(/** @type {HTMLSpanElement | null} */ (null));
  const [shown, setShown] = React.useState(/** @type {'full' | 'short' | 'none'} */ ('full'));
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !s.text) { setShown('full'); return undefined; }
    const fit = () => {
      const probe = document.createElement('span');
      const cs = getComputedStyle(el);
      probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing};`;
      el.appendChild(probe);
      const fits = (/** @type {string} */ t) => { probe.textContent = t; return probe.offsetWidth <= el.clientWidth + 1; };
      /** @type {'full' | 'short' | 'none'} */
      const next = fits(s.text) ? 'full' : fits(s.short) ? 'short' : 'none';
      probe.remove();
      setShown((prev) => (prev === next ? prev : next));
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [s.text, s.short]);
  return (
    <span ref={ref} className={`ag-share ag-share-${s.id}`} style={{ width: `${s.widthPct}%` }} title={s.title}>
      {shown === 'full' ? s.text : shown === 'short' ? s.short : ''}
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
                {`${n} ${n === 1 ? 'strategy' : 'strategies'}${r.feeBps ? ` · ${fmtFees(r.feeBps)}` : ''}`}
              </div>
            </div>
            {/* Two groups (Davies, 2026-09-27): what the venue holds — funded, deployed, today — and what it has made —
                unrealised, realised and the lines set in under it. A card with the width to itself shows them side by
                side; any other, one under the other, in the same order. */}
            <div className="ag-venue-grid mono">
              <div className="ag-venue-col">
                {/* Funded is the capital the venue's strategies on this tab are allotted, not the account's balance: a
                    real balance here only misled while every row traded paper (Davies, 2026-09-23). */}
                <FigLabel name={`funded${r.paper ? ' (Paper)' : ''}`} title="the capital this venue's strategies are allotted" /><span>{m(fmtUsd(r.capitalUsd))}</span>
                <FigLabel name="deployed" />
                <span className="hl-strong">{m(fmtUsd(r.valueUsd))}{r.deployedPct != null ? <span className="dim ag-fig-pct"> ({fmtPct2(r.deployedPct)})</span> : null}</span>
                <FigLabel name="today" />{gl(r.todayUsd, r.todayPct)}
              </div>
              <div className="ag-venue-col">
                <FigLabel name="unrealised" />{gl(r.unrealisedUsd, r.unrealisedPct)}
                <FigLabel name="realised" />{gl(r.realisedUsd, r.realisedPct)}
                {r.test?.rewards ? (
                  <>
                    <span className="dim ag-fig-sub">rewards</span><span className="ag-gl ag-fig-sub" style={{ color: pctColor(r.test.rewards.realisedUsd) }}>{m(fmtUsd(r.test.rewards.realisedUsd, true))}</span>
                    <span className="dim ag-fig-sub">orders</span><span className="ag-gl ag-fig-sub" style={{ color: pctColor(r.test.orders.realisedUsd) }}>{m(fmtUsd(r.test.orders.realisedUsd, true))}</span>
                  </>
                ) : null}
                {/* Fees are part of realised, as rewards and orders are: a line under it, set in (Davies, 2026-09-27). */}
                {r.feesUsd != null ? <><span className="dim ag-fig-sub">fees</span><span className="ag-fig-sub"><span className="dim">{m(fmtUsd(r.feesUsd))}</span></span></> : null}
              </div>
            </div>
            {r.note && <div className="ag-warn-line">{r.note}</div>}
          </div>
          );
        })}
      </div>
    </section>
  );
}



/** One side of a rung in the ladder: idle, the price it quotes, or what it holds and has made at the last print, in the row's currency. */
function LadderCell({ c, m, book = null, ccy = 'GBP' }) {
  if (c.state === 'idle') return <span className="dim">idle</span>;
  if (c.state === 'quoting') return <span>{m(fmtQuotePrice(c.price, book))}</span>;
  return (
    <span className="ag-qheld">
      <span className="ag-state-pill ag-state-filled">held</span> {m(fmtQuotePrice(c.price, book))}
      {c.unrealisedGbp != null && <span className="ag-gl" style={{ color: pctColor(c.unrealisedGbp) }}> {m(fmtIn4(c.unrealisedGbp, ccy))}</span>}
    </span>
  );
}

/**
 * The quote pages' BOOKS: a card per book, its last trade, fair and index price, its ladder of rungs (`quoteLadderRows`),
 * its round trips and what it has realised, in pounds. A held rung's P&L is at the index price while one is fresh, as
 * Revolut X values coins, else at the last trade. The paper page and the live page show the same section (Davies,
 * 2026-10-01: the paper page's BOOKS read more clearly than the live page's RUNGS).
 * @param {{ books: any[], m: (s: string) => string, empty?: string | null, ccy?: string }} props
 */
function QuoteBooks({ books, m, empty = null, ccy = 'GBP' }) {
  return (
    <section className="ag-section ag-quote-books">
      <div className="ag-section-title mono">BOOKS</div>
      {books.length === 0 && empty && <div className="ag-empty dim">{empty}</div>}
      <div className="ag-quotes-cards">
        {books.map((b) => (
          <div key={b.book} className="ag-quotes-card">
            <div className="ag-quotes-head">
              <span className="hl-strong mono">{quoteBookLabel(b.book)}</span>
              <span className="dim mono ag-venue-meta">last trade {m(fmtQuotePrice(b.lastPrice, b.book))}{b.fair != null ? ` · fair ${m(fmtQuotePrice(b.fair, b.book))}` : ''}{b.index != null ? ` · index ${m(fmtQuotePrice(b.index, b.book))}` : ''}</span>
            </div>
            <table className="ag-ladder mono">
              <thead><tr><th className="dim">Rung</th><th className="dim">Bid</th><th className="dim">Ask</th></tr></thead>
              <tbody>
                {quoteLadderRows(b).map((r) => (
                  <tr key={r.k}><td className="dim">{r.label}</td><td><LadderCell c={r.bid} m={m} book={b.book} ccy={ccy} /></td><td><LadderCell c={r.ask} m={m} book={b.book} ccy={ccy} /></td></tr>
                ))}
              </tbody>
            </table>
            <div className="ag-quotes-grid mono">
              <span className="dim">round trips</span><span>{b.trips ? `${b.trips} · ${Math.round((100 * b.won) / b.trips)} % won` : '0'}</span>
              <span className="dim">realised</span><span className="ag-gl" style={{ color: pctColor(b.realisedGbp) }}>{m(fmtIn4(b.realisedGbp ?? 0, ccy))}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The quote pages' DAYS, newest first (Davies, 2026-09-28; on the live page under INVENTORY, 2026-10-01): each UTC day's
 * orders, entry fills, the round trips that closed and what it realised, in pounds. The days add up to REALIZED. Beside
 * its heading, the last seven closed days' realised a year, over the capital (`quoteDaysAnnualPct`; Davies, 2026-10-09),
 * named for what it is (`QUOTE_DAYS_ANNUAL_LABEL`, its tooltip `QUOTE_DAYS_ANNUAL_TITLE`; 2026-10-26). By default only
 * today's open row and the seven closed days the figure sums show (`quoteDaysRecent`, its own window; Davies, 2026-10-28), with "Load full history" under the
 * table for the rest and "Show last 7 days" to fold it back. Every Stablecoin quotes page (live, twins, Coinbase, OKX) draws it.
 * In the row's currency (`ccy`; its days' `realisedGbp` are in it, `quotesDetailInCcy`), the capital in the same.
 * @param {{ days: any[], m: (s: string) => string, empty?: string | null, capitalGbp?: number | null, nowMs?: number, ccy?: string }} props
 */
export function QuoteDaysTable({ days, m, empty = null, capitalGbp = null, nowMs = Date.now(), ccy = 'GBP' }) {
  const annual = quoteDaysAnnualPct(days, capitalGbp, nowMs);
  const [full, setFull] = React.useState(false);
  const recent = quoteDaysRecent(days, nowMs);
  const shown = full ? days : recent;
  return (
    <section className="ag-section ag-quote-days">
      <div className="ag-section-title mono">DAYS{annual != null && (
        <span className="ag-quote-days-annual" title={QUOTE_DAYS_ANNUAL_TITLE}> - {QUOTE_DAYS_ANNUAL_LABEL} <span style={{ color: pctColor(annual) }}>{fmtPctSigned(annual, 1)}</span></span>
      )}</div>
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th">Day (UTC)</th><th className="hl-th ag-ph">Orders</th><th className="hl-th ag-ph">Fills</th>
            <th className="hl-th">Round trips</th><th className="hl-th">Realised</th>
          </tr></thead>
          <tbody>
            {days.length === 0 && <tr><td className="hl-empty dim" colSpan={5}>{empty ?? 'No day yet.'}</td></tr>}
            {shown.map((d) => (
              <tr key={d.day}>
                <td className="dim">{dayLabel(d.day)}{d.today ? ' · today' : ''}</td>
                <td className="ag-ph">{d.orders}</td>
                <td className="ag-ph">{d.fills}</td>
                <td>{d.trips ? `${d.trips} · ${Math.round((100 * d.won) / d.trips)} % won` : '0'}</td>
                <td className="ag-gl" style={{ color: pctColor(d.realisedGbp) }}>{m(fmtIn4(d.realisedGbp, ccy))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recent.length < days.length && (
        <button type="button" className="btn-ghost ag-more" onClick={() => setFull((f) => !f)}>{full ? 'Show last 7 days' : 'Load full history'}</button>
      )}
    </section>
  );
}

/** A closed UTC day as the page names it: "25 Sep", in the site's own month table (en-GB alone writes "Sept"). @param {string} day */
const dayLabel = (day) => fmtDayMonth(new Date(`${day}T00:00:00Z`), { locale: 'en-GB', timeZone: 'UTC' });

/** A rung or an order's side, the way the round trips write it: bid green, ask red. @param {{ side: string | null, children?: any }} props */
function RungSide({ side, children = null }) {
  const cls = side === 'bid' || side === 'buy' ? 'buy' : 'sell';
  return <span className={`ag-side ag-side-${cls}`}><span className="ag-side-mark" aria-hidden="true" />{children ?? side}</span>;
}

/*
 * The live page's round trips and orders keep every column on a phone, Size included (Davies, 2026-10-01): there a time
 * stacks its date over its time, a book is its coin, and a size its number (`.ag-ql-tables` in styles.css). The text is
 * the same at every width; only what a phone shows of it differs.
 */
/** A market as the page names it: its question, never its id (a 66-character hex string reads as noise). @param {unknown} q */
const marketName = (q) => (typeof q === 'string' && q.trim() && !/^0x[0-9a-f]{16,}$/i.test(q.trim()) ? q : 'Market name not recorded');

/** A time, its date and its clock in two parts a phone stacks. @param {{ iso: string }} props */
function Stamp({ iso }) {
  const s = when(iso), i = s.lastIndexOf(' ');
  return i < 0 ? <>{s}</> : <><span className="ag-stamp-d">{s.slice(0, i)}</span> <span className="ag-stamp-t">{s.slice(i + 1)}</span></>;
}
/** A book, "USDT/GBP": a phone shows its coin. @param {{ book: string }} props */
function BookName({ book }) {
  const [coin, quote] = quoteBookLabel(book).split('/');
  return <>{coin}{quote ? <span className="ag-book-quote">/{quote}</span> : null}</>;
}
/** A size in coins, "132.00 USDT": a phone shows the number, its book's coin beside it. @param {{ qty: any, book: string, m: (s: string) => string }} props */
function Qty({ qty, book, m }) {
  const s = fmtQuoteQty(qty, book), i = s.indexOf(' ');
  return i < 0 ? <>{m(s)}</> : <>{m(s.slice(0, i))}<span className="ag-qty-unit"> {s.slice(i + 1)}</span></>;
}

/**
 * One of the live page's two order tables, its exits or its entries (Davies, 2026-10-01): each order's rung, its side on
 * the venue, buy or sell and nothing more, its price and size, and its state, with its reason on a line of its own under
 * its row — a sentence, which in a column of its own wrapped five deep and ran out of the table. A 24-hour stop says so
 * under its time, as its round trip does.
 * @param {{ title: string, cls: string, orders: any[], m: (s: string) => string, empty: string | null }} props
 */
function LiveOrdersTable({ title, cls, orders, m, empty }) {
  return (
    <section className={`ag-section ${cls} ag-ql-tables`}>
      <div className="ag-section-title mono">{title}</div>
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th">Sent ({UK_TZ})</th><th className="hl-th">Book</th><th className="hl-th ag-ph">Rung</th><th className="hl-th">Side</th>
            <th className="hl-th">Price</th><th className="hl-th">Size</th><th className="hl-th">State</th>
          </tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td className="hl-empty dim" colSpan={7}>{empty ?? 'No order yet.'}</td></tr>}
            {orders.map((o) => (
              <React.Fragment key={o.id}>
                <tr className={`txn-row txn-row-${o.venueSide ?? 'buy'}${o.reason ? ' ag-ql-has-sub' : ''}`}>
                  <td className="dim"><Stamp iso={o.ts} />{o.leg === 'stop' ? <>{' '}<span className="hl-sub dim">24-hour stop</span></> : null}</td>
                  <td className="hl-strong"><BookName book={o.book} /></td>
                  <td className="ag-ph dim">{`${o.side} ${quoteRungLabel(o.k)}`}</td>
                  <td><RungSide side={o.venueSide}>{o.venueSide ?? '—'}</RungSide></td>
                  <td>{m(fmtQuotePrice(o.price, o.book))}</td>
                  <td><Qty qty={o.base} book={o.book} m={m} /></td>
                  <td><span className={`ag-state-pill ag-state-${o.state}`}>{orderStateText(o.state)}</span></td>
                </tr>
                {o.reason && <tr className="ag-ql-sub-row"><td colSpan={7}><span className="ag-ql-sub">{m(o.reason)}</span></td></tr>}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * PR5's live executor, opened from its row in LIVE STRATEGIES (Davies, 2026-10-01: "改成它单独的" — it opened the paper
 * test's page): the real-money book on its own Revolut X sub-account and nothing of the paper engine's record, in
 * pounds, the book's own currency. The scoreboard is its LIVE row's own (`quotesLiveRow`), so the two read the same
 * figures; then the paper page's BOOKS (each rung's live order or holding), the account's coins with their unrealised,
 * its DAYS, its round trips (each carrying the conversion fee of the coins it sold) and its newest orders, all from the
 * dashboard's `quotes.live.detail` (`quotesLiveDetail`). Davies took its STATUS tiles, the inventory's note, its
 * conversions, fills and events off the page, and a cancel that filled nothing out of ORDERS (2026-10-01).
 *
 * A realistic twin's page is the same page (`twin`; Davies, 2026-10-02: the twins are laid out as the live executor's),
 * on its simulated account and its TESTING row (`quotesTwinRow`), PAPER, its name for a title, and a line under its
 * scoreboard for what it is and for each book whose asks wait for their coin. Each page has a container of its own: the
 * sweep tells them apart by it. "Stablecoin quotes with Euros" (`coinbase`, 0112) opens the same page as a twin, on
 * Coinbase: a paper test with no account and no coin of its own, so no INVENTORY, and each EUR book's prices in euros. The OKX
 * twins (`okx`, 0150) open it the same way, on OKX.
 * @param {{ q: any, m: (s: string) => string, at: any, nowMs: number, twin?: boolean, coinbase?: boolean, okx?: boolean }} props
 */
function QuotesLiveDetail({ q, m, at, nowMs, twin = false, coinbase: cbOnly = false, okx = false }) {
  const coinbase = cbOnly || okx;
  const row = okx ? quotesOkxRow(q) : coinbase ? quotesCoinbaseRow(q) : twin ? quotesTwinRow(q) : quotesLiveRow(q);
  if (!row) return null;
  const lines = twin || coinbase ? quotesTwinLines(q, m) : null;
  const x = rowMoney(row);
  // A row in dollars (the OKX and Coinbase rows, 2026-10-29) draws its detail's dollars (`quotesDetailInCcy`).
  const qc = quotesDetailInCcy(q);
  const d = qc.detail ?? null;
  const inv = quotesLiveInventory(q, m);
  const trips = d?.trips ?? [], orders = d?.orders ?? [];
  const exitOrders = orders.filter((/** @type {any} */ o) => o.leg === 'exit' || o.leg === 'stop');
  const entryOrders = orders.filter((/** @type {any} */ o) => o.leg === 'entry');
  const empty = d ? null : 'Not in this answer: the next refresh brings it.';
  return (
    <div className={`ag-detail ${okx ? 'ag-quotes-okx-detail' : coinbase ? 'ag-quotes-cb-detail' : twin ? 'ag-quotes-twin-detail' : 'ag-quotes-live-detail'}`}>
      <div className="ag-detail-head">
        <ModeBadge mode={twin || coinbase ? 'paper' : 'live'} />
        <VenueBadge id={okx ? 'okx' : coinbase ? 'coinbase' : 'revx'} />
        <StatusDot status={row.status} since={twin || coinbase ? q.twin?.startedAt ?? null : q.armed ? q.armedAt : null} nowMs={nowMs} live={!twin && !coinbase} />
      </div>
      <h3 className="ag-detail-title mono sr-only">{row.name}</h3>
      <div className="ag-scoreboard ag-scoreboard-sm">
        <FundedCells fundedUsd={x.capital} deployedUsd={x.value} m={m} ccy={x.ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="TODAY" usd={x.today} pct={x.todayPct} m={m} ccy={x.ccy} aside={q.lossStopGbp != null ? `(loss stop ${m(fmtGbp(q.lossStopGbp))})` : null} />
        <div className="ag-sb-divider" />
        <GlCell label="UNREALIZED G/L" usd={x.unrealised} pct={x.unrealisedPct} m={m} ccy={x.ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="REALIZED G/L" usd={x.realised} pct={x.realisedPct} m={m} ccy={x.ccy} cls="ag-sb-realised" aside={`(incl. fees ${m(fmtIn(x.fees, x.ccy))})`} />
      </div>
      {lines?.waiting.map((w) => <div key={w} className="ag-twin-line ag-twin-waiting dim">{w}</div>)}
      {!q.running && <div className="ag-warn-line">{row.status.detail}</div>}
      {q.lastError && <div className="ag-warn-line">last turn: {m(String(q.lastError))}</div>}
      <QuoteBooks books={quotesLiveBooks(qc)} m={m} empty={empty} ccy={x.ccy} />
      {!coinbase && <section className="ag-section ag-ql-inventory">
        <div className="ag-section-title mono">INVENTORY</div>
        {inv ? (
          <div className="ag-ql-card ag-ql-balances">
            <div className="ag-ql-grid mono">
              {inv.rows.map((a) => (
                <React.Fragment key={a.asset}>
                  <span className="dim">{a.asset}</span>
                  <span>
                    {a.amount}{a.gbp ? <span className="dim"> · {a.gbp}</span> : null}
                    {a.price ? <span className="dim" title={a.priceFrom === 'index' ? "Revolut X's index price, as its account page values the coin" : "the book's last trade: no fresh index price"}> at {a.price}</span> : null}
                    {a.unrealisedGbp != null ? <span className="ag-gl" style={{ color: pctColor(a.unrealisedGbp) }}> {m(fmtGbp4(a.unrealisedGbp))}</span> : null}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : <div className="ag-empty dim">{empty ?? 'Its last turn could not read the account.'}</div>}
      </section>}
      <QuoteDaysTable days={d?.days ?? []} m={m} empty={empty} capitalGbp={x.capital} nowMs={nowMs} ccy={x.ccy} />
      <section className="ag-section ag-ql-trips ag-ql-tables">
        <div className="ag-section-title mono">ROUND TRIPS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr>
              <th className="hl-th">Closed ({UK_TZ})</th><th className="hl-th">Book</th><th className="hl-th">First</th><th className="hl-th ag-ph">Rung</th>
              <th className="hl-th">Entry</th><th className="hl-th">Exit</th><th className="hl-th">Size</th><th className="hl-th ag-ph">Fees</th><th className="hl-th">P&amp;L</th>
            </tr></thead>
            <tbody>
              {trips.length === 0 && <tr><td className="hl-empty dim" colSpan={9}>{empty ?? 'No round trip yet.'}</td></tr>}
              {trips.map((t) => (
                <tr key={`${t.book}|${t.side}|${t.k}|${t.tEntry}`} className={`txn-row txn-row-${t.side === 'bid' ? 'buy' : 'sell'}`}>
                  <td className="dim"><Stamp iso={t.tExit} />{t.how === 'stop' ? <>{' '}<span className="hl-sub dim">24-hour stop</span></> : null}</td>
                  <td className="hl-strong"><BookName book={t.book} /></td>
                  <td><RungSide side={t.side}>{t.side === 'bid' ? 'bought' : 'sold'}</RungSide></td>
                  <td className="ag-ph dim">{quoteRungLabel(t.k)}</td>
                  <td>{m(fmtQuotePrice(t.entry, t.book))}</td>
                  <td>{m(fmtQuotePrice(t.exit, t.book))}</td>
                  <td className="dim"><Qty qty={t.qty} book={t.book} m={m} /></td>
                  <td className="ag-ph dim">{m(fmtFeeIn4(t.feesGbp, x.ccy))}</td>
                  <td className="ag-gl" style={{ color: pctColor(t.pnlGbp) }}>{m(fmtIn4(t.pnlGbp, x.ccy))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {/* Exits first, and only when there are any; then the entries (Davies, 2026-10-01). The conversions that bought the
          asks' coins are neither, and are not listed. */}
      {exitOrders.length > 0 && <LiveOrdersTable title="EXIT ORDERS" cls="ag-ql-exits" orders={exitOrders} m={m} empty={empty} />}
      <LiveOrdersTable title="ENTRY ORDERS" cls="ag-ql-entries" orders={entryOrders} m={m} empty={empty} />
      <div className="ag-updated dim mono ag-ql-foot">as of {when(at)} {UK_TZ} · refreshes every minute</div>
    </div>
  );
}

/**
 * "Reward quotes live-prep"'s real-money book, LIVE's "Reward quotes", opened from its row over the list in the same window,
 * as PR5's live executor's page is (Davies, 2026-10-09: "网站的agents live页怎么看不到这个上线"). Its scoreboard is its LIVE
 * row's own (`lpLiveRow`), so the two read the same figures. Under it, the TESTING page's STATUS (`RwBar`), R (PAID ÷ FORMULA) in
 * place of the worst case; then the live page's own tables, DAYS first: the days Polymarket has paid against the formula
 * (R); then the TESTING page's QUOTES (each market's quote, share,
 * what it holds of each token, and its part of the total; its HELD table went, Davies 2026-10-09: "QUOTES表里已经有了", and its
 * STOP AND GATES the same day: "stopandgates那部分也删掉"; a tripped stop still says so above STATUS) and
 * FILLS (an unconfirmed one listed, marked and not counted). Everything is the dashboard's `lpLive`, read from the order path's live rows alone
 * (`pm_lp_live_view.ts`); none of its paper layer's record is here.
 * @param {{ l: any, m: (s: string) => string, at: any, nowMs: number }} props
 */
function LpLiveDetail({ l, m, at, nowMs }) {
  const row = lpLiveRow(l);
  if (!row) return null;
  /** @param {number | null | undefined} x */
  const usd = (x) => m(fmtUsd(Number(x) || 0, true));
  const fills = l.recentFills ?? [], days = l.days ?? [];
  const status = lpLiveStatus(l);
  return (
    <div className="ag-detail ag-lp-live-detail">
      <div className="ag-detail-head">
        <ModeBadge mode="live" />
        <VenueBadge id="polymarket" />
        <StatusDot status={row.status} since={l.liveSince ?? null} nowMs={nowMs} live />
      </div>
      <h3 className="ag-detail-title mono sr-only">{row.name}</h3>
      <div className="ag-scoreboard ag-scoreboard-sm">
        <FundedCells fundedUsd={row.capitalUsd} deployedUsd={row.valueUsd} m={m} known={row.fundedKnown} />
        <div className="ag-sb-divider" />
        <GlCell label="TODAY" usd={row.todayUsd} pct={row.todayPct} m={m} />
        <div className="ag-sb-divider" />
        <GlCell label="UNREALIZED G/L" usd={row.unrealisedUsd} pct={row.unrealisedPct} m={m} />
        <div className="ag-sb-divider" />
        <GlCell label="REALIZED G/L" usd={row.realisedUsd} pct={row.realisedPct} m={m} cls="ag-sb-realised" aside={`(incl. fees ${m(fmtUsd(row.feesUsd))})`}
          split={[['rewards paid', row.rewards.realisedUsd], ['orders', row.orders.realisedUsd]]} />
      </div>
      {!l.running && <div className="ag-warn-line">{row.status.detail}</div>}
      {l.lastError && <div className="ag-warn-line">last turn: {m(String(l.lastError))}</div>}
      {l.stop?.trippedAt && <div className="ag-warn-line">its total loss stop has tripped: it only sells what it holds</div>}
      {/* The stop's room (Addendum 18): the stop judges the page's TOTAL, so the two are one number. */}
      {lpStopRoomText(l, m) && <div className="ag-lpl-room dim mono">{lpStopRoomText(l, m)}</div>}
      {/* Below the scoreboard, the TESTING page's STATUS (Davies, 2026-10-09: "子页面中scoreboard以下的内容全部改为testing页面中
          Reward quotes live-prep的设计…WORST CASE部分改为实际R值"), then the live page's own tables, DAYS first ("表格部分还是用现在的
          live页里的设计吧，只是把RECENT ORDERS表删了，DAYS表放在所有表最上面"). */}
      <RwBar v={status} r={status} usd={usd} rText={status.rText} rNotes={status.rNotes} est={lpEstimateTexts(status.est, m)} />
      <section className="ag-section ag-lpl-days ag-ql-tables">
        <div className="ag-section-title mono">DAYS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            {/* Orders (Davies, 2026-10-11): the day's fills marked to market, rewards not counted (`lpLiveDayCells`); the days'
                Orders add up to the orders' part of REALIZED G/L plus UNREALIZED G/L. */}
            <thead><tr>
              <th className="hl-th">Day (UTC)</th><th className="hl-th">Markets</th><th className="hl-th">Orders</th><th className="hl-th">Formula</th><th className="hl-th">Paid</th>
              <th className="hl-th">R</th><th className="hl-th">Rebates</th>
            </tr></thead>
            <tbody>
              {days.length === 0 && <tr><td className="hl-empty dim" colSpan={7}>No day read yet: Polymarket's payouts are read an hour after each UTC day.</td></tr>}
              {days.map((d) => {
                const c = lpLiveDayCells(d, m);
                return (
                  <tr key={d.day}>
                    <td className="dim">{dayLabel(d.day)}{d.today ? ' · today' : ''}</td>
                    <td>{c.markets}</td>
                    <td className="ag-gl" style={{ color: pctColor(c.ordersUsd) }}>{c.orders}</td>
                    <td>{c.formula}</td>
                    <td className="ag-gl" style={c.paidUsd == null ? undefined : { color: pctColor(c.paidUsd) }}>{c.paid}</td>
                    <td>{c.r}</td>
                    <td>{c.rebates}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {/* QUOTES and FILLS are the TESTING page's tables, from the live book (Davies, 2026-10-09: "RESTING ORDERS表格还是改为
          testing页的QUOTES表格吧，fills也一样"). */}
      <RwQuotesTable markets={lpLiveQuoteRows(l.quotes)} m={m} usd={usd} live waiting="Nothing resting and nothing held right now." />
      <RwFillsTable recent={fills} m={m} />
      <div className="ag-updated dim mono ag-lpl-foot">as of {when(at)} {UK_TZ} · refreshes every minute</div>
    </div>
  );
}

/**
 * "FXW-AUD weekend", the frozen FXW-AUD rule on paper on IG's recorded live quotes (Davies, 2026-10-29:
 * "在testing列表中把IG Trader和澳元策略都上线…确保模拟一切真实"; `supabase/functions/ig/fxw.ts`): its head (PAPER, IG, the list's
 * light), the quotes pages' scoreboard from its LIST row (`rowMoney(fxwAudRow(f))`) so the row and the page read the same
 * figures (REALIZED G/L net of funding), STATUS (equity, trades, open position, stake), then WEEKENDS, newest
 * first: each weekend's Friday mid and the quote it came from, Sunday's decision quote and the gap, the entry and the exit
 * with the bid and offer each filled against, why it closed, funding and P&L. Money in pounds.
 * @param {{ f: any, m: (s: string) => string, at: any, nowMs: number }} props
 */
function FxwDetail({ f, m, at, nowMs }) {
  const row = fxwAudRow(f);
  if (!row) return null;
  const money = rowMoney(row);
  const gbp = (/** @type {unknown} */ x) => (x == null ? '—' : m(fmtGbp(Number(x), true)));
  /** @param {unknown} bid @param {unknown} offer */
  const quote = (bid, offer) => `${m(fmtFx(/** @type {number} */ (bid)))} / ${m(fmtFx(/** @type {number} */ (offer)))}`;
  const rows = f.rows ?? [];
  return (
    <div className="ag-detail ag-fxw-detail">
      <div className="ag-detail-head">
        <ModeBadge mode="paper" />
        <VenueBadge id="ig" />
        <StatusDot status={row.status} since={f.started ? f.startAt : null} nowMs={nowMs} toned />
      </div>
      <h3 className="ag-detail-title mono sr-only">{row.name}</h3>
      <div className="ag-scoreboard ag-scoreboard-sm">
        <FundedCells fundedUsd={money.capital} deployedUsd={money.value} m={m} ccy={money.ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="TODAY" usd={money.today} pct={money.todayPct} m={m} ccy={money.ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="UNREALIZED G/L" usd={money.unrealised} pct={money.unrealisedPct} m={m} ccy={money.ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="REALIZED G/L" usd={money.realised} pct={money.realisedPct} m={m} ccy={money.ccy} cls="ag-sb-realised" aside={`(incl. funding ${m(fmtIn(money.fees ?? 0, money.ccy))})`} />
      </div>
      {!row.status.running && <div className="ag-warn-line">{row.status.detail}</div>}
      {f.lastError && <div className="ag-warn-line">run: {String(f.lastError)}</div>}
      <section className="ag-section ag-rw-bar ag-fxw-bar">
        <div className="ag-section-title mono">STATUS</div>
        <div className="ag-rw-tiles">
          {fxwTiles(f, m).map((t) => (
            <div key={t.k} className="ag-rw-tile">
              <div className="ag-rw-tile-k mono">{t.k}</div>
              <div className="ag-rw-tile-v mono">{t.v}</div>
              {t.note ? <div className="ag-rw-tile-note dim mono">{t.note}</div> : null}
            </div>
          ))}
        </div>
      </section>
      <section className="ag-section ag-fxw-weekends">
        <div className="ag-section-title mono">WEEKENDS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr>
              <th className="hl-th">Friday</th><th className="hl-th">Friday mid</th><th className="hl-th">Sunday quote</th><th className="hl-th">Entry</th><th className="hl-th">Exit</th><th className="hl-th">Net</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={6}>No weekend yet: the first starts {when(f.startAt)} {UK_TZ}.</td></tr>}
              {rows.map((/** @type {any} */ w) => (
                <tr key={w.friday}>
                  <td className="dim">{w.friday}<span className="hl-sub dim">{w.status === 'no_trade' ? 'no trade' : w.status}</span></td>
                  <td>{w.friMid == null ? '—' : m(fmtFx(w.friMid))}{w.friTs ? <span className="hl-sub dim">{quote(w.friBid, w.friOffer)} · {when(w.friTs)}</span> : null}</td>
                  <td>{w.gapBps == null ? '—' : `${w.gapBps > 0 ? '+' : ''}${Number(w.gapBps).toFixed(1)} bps`}{w.decTs ? <span className="hl-sub dim">{quote(w.decBid, w.decOffer)} · {when(w.decTs)}</span> : null}</td>
                  <td>{w.entryPrice == null ? <span className="dim">{w.reason ?? '—'}</span> : <>{w.side} {m(fmtFx(w.entryPrice))}<span className="hl-sub dim">{m(fmtGbp(Number(w.stakeGbp) || 0))} a pip · margin {m(fmtGbp(Number(w.marginGbp) || 0))}</span></>}</td>
                  <td>{w.exitPrice != null
                    ? <>{m(fmtFx(w.exitPrice))}<span className="hl-sub dim">{quote(w.exitBid, w.exitOffer)} · {when(w.exitTs)} · {w.exitReason}</span></>
                    : w.status === 'open' ? <>open<span className="hl-sub dim">mark {m(fmtFx(w.markPrice))} · {when(w.markTs)}</span></> : '—'}</td>
                  <td className="ag-gl" style={w.netGbp == null ? undefined : { color: pctColor(Number(w.netGbp)) }}>{gbp(w.netGbp)}{w.fundingGbp ? <span className="hl-sub dim">funding {m(fmtGbp(Number(w.fundingGbp)))}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="ag-updated dim mono">as of {when(at)} {UK_TZ} · its run every five minutes</div>
    </div>
  );
}

/**
 * "Polymarket analyst", GROKPM's page over LIVE (Davies, 2026-10-15: "网站中live页也加上策略和子策略页面（仿照之前rewards
 * 策略来做）"), laid out as the Reward quotes live page: its head (DRY-RUN until the order path is armed, then LIVE, and the
 * list's own status light), its scoreboard the stablecoin quotes' live page's, cell for cell (Davies, 2026-10-17: "这个策略的
 * 页面score board请做的和stablecoin quote的live策略子页面的一样"): FUNDED (its $100 budget) and DEPLOYED (what it holds at cost),
 * TODAY, UNREALIZED G/L, REALIZED G/L "(incl. fees …)", from its LIST row (`rowMoney(grokPmRow(g))`), so the row and the page
 * read the same figures; the stops' room under it, a red line when the agent's own numbers differ from the record by more
 * than $1, STATUS (open positions, cash, Brier against the market, resolved), then POSITIONS from the record, DAYS (the
 * record's P&L beside its summary), and the agent's JOURNAL last (each entry a head line, its market linked to Polymarket,
 * p against the market, its words and its sources as links named by their domain). DAYS above JOURNAL: "底下live放在journal
 * 上面" (the same day). Everything is the dashboard's `grokPm` (`grokpm_view.ts`).
 * @param {{ g: any, m: (s: string) => string, at: any, nowMs: number }} props
 */
/**
 * An outside-Grok test's page (CXBOT "Crypto analyst", IGBOT "IG Trader"; Davies, 2026-10-29), in the Grok rows' style: its
 * head (DRY-RUN until the test starts, then PAPER or DEMO, and the list's own status light), the scoreboard from its LIST
 * row (`rowMoney(grokTestRow(g))`, so the row and the page read the same figures), STATUS (mode, trades, open,
 * equity against the budget), POSITIONS with their stop and limit, and SCORES per layer: the agent's Brier against the
 * baseline's and D, positive when the agent is better. Everything is the dashboard's `cxbot` or `igbot` (`grok_tests_view.ts`).
 * @param {{ g: any, m: (s: string) => string, nowMs: number }} props
 */
function GrokTestDetail({ g, m, nowMs }) {
  const row = grokTestRow(g);
  if (!row) return null;
  const money = rowMoney(row);
  const ccy = money.ccy;
  const positions = g.positions ?? [], layers = g.layers ?? [];
  const px = (/** @type {unknown} */ x) => (x == null ? '—' : m(String(+Number(x).toPrecision(8))));
  return (
    <div className="ag-detail ag-gpm-detail ag-grok-detail">
      <div className="ag-detail-head">
        <ModeBadge mode={g.mode === 'dry_run' && !(g.id === 'cxbot' && g.startedAt) ? 'dry-run' : 'paper'} />
        <VenueBadge id={g.venueId} />
        <StatusDot status={row.status} since={g.startedAt ?? null} nowMs={nowMs} toned />
      </div>
      <h3 className="ag-detail-title mono sr-only">{row.name}</h3>
      <div className="ag-scoreboard ag-scoreboard-sm">
        <FundedCells fundedUsd={money.capital} deployedUsd={money.value} m={m} ccy={ccy} known={row.fundedKnown} />
        <div className="ag-sb-divider" />
        <GlCell label="TODAY" usd={money.today} pct={money.todayPct} m={m} ccy={ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="UNREALIZED G/L" usd={money.unrealised} pct={money.unrealisedPct} m={m} ccy={ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="REALIZED G/L" usd={money.realised} pct={money.realisedPct} m={m} ccy={ccy} cls="ag-sb-realised" aside={g.id === 'cxbot' ? `(incl. fees ${m(fmtIn(money.fees ?? 0, ccy))})` : null} />
      </div>
      {g.mode !== 'dry_run' && !g.running && <div className="ag-warn-line">{row.status.detail}</div>}
      {g.stops?.totalHit && <div className="ag-warn-line">its total stop is reached: close-only to the end</div>}
      <section className="ag-section ag-rw-bar ag-gpm-bar">
        <div className="ag-section-title mono">STATUS</div>
        <div className="ag-rw-tiles">
          {grokTestTiles(g, m).map((t) => (
            <div key={t.k} className="ag-rw-tile">
              <div className="ag-rw-tile-k mono">{t.k}</div>
              <div className="ag-rw-tile-v mono">{t.v}</div>
              {t.note ? <div className="ag-rw-tile-note dim mono">{t.note}</div> : null}
            </div>
          ))}
        </div>
      </section>
      <section className="ag-section ag-grok-positions">
        <div className="ag-section-title mono">POSITIONS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr>
              <th className="hl-th">Market</th><th className="hl-th">Side</th><th className="hl-th">Size</th><th className="hl-th">Entry</th><th className="hl-th">Stop</th><th className="hl-th">Limit</th><th className="hl-th">Unrealised</th>
            </tr></thead>
            <tbody>
              {positions.length === 0 && <tr><td className="hl-empty dim" colSpan={7}>Nothing open.</td></tr>}
              {positions.map((/** @type {any} */ x, /** @type {number} */ i) => (
                <tr key={`${x.market}-${x.openedAt}-${i}`}>
                  <td className="hl-strong">{x.market}</td>
                  <td>{x.direction}</td>
                  <td>{m(String(+Number(x.size).toFixed(5)))}</td>
                  <td>{px(x.entry)}</td>
                  <td>{px(x.stop)}</td>
                  <td>{px(x.limit)}</td>
                  <td className="ag-gl" style={x.pnl == null ? undefined : { color: pctColor(Number(x.pnl)) }}>{x.pnl == null ? '—' : m(fmtIn(Number(x.pnl), ccy, true))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ag-section ag-grok-scores">
        <div className="ag-section-title mono">SCORES</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr><th className="hl-th">Layer</th><th className="hl-th">Scored</th><th className="hl-th">Brier agent / baseline</th><th className="hl-th">Baseline</th><th className="hl-th">D</th></tr></thead>
            <tbody>
              {layers.map((/** @type {any} */ l) => {
                const c = grokTestLayerCells(l);
                return (
                  <tr key={l.key}>
                    <td className="hl-strong">{c.label}</td>
                    <td>{c.scored}</td>
                    <td>{c.brier}</td>
                    <td className="dim">{c.base}</td>
                    <td className="ag-gl" style={c.dTone ? { color: pctColor(c.dTone === 'gain' ? 1 : -1) } : undefined}>{c.d}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="dim mono ag-grok-note">D = Brier of the baseline less Brier of the agent: positive means the agent forecast better. A bracket that neither side ends, or that is closed early, scores where its price stands between stop and limit.</div>
      </section>
    </div>
  );
}

function GrokPmDetail({ g, m, at, nowMs }) {
  const row = grokPmRow(g);
  if (!row) return null;
  /** @param {number | null | undefined} x */
  const usd = (x) => m(fmtUsd(Number(x) || 0, true));
  const money = rowMoney(row);
  const stop = grokPmStopText(g, m), mismatch = grokPmMismatchText(g, m);
  const positions = g.positions ?? [], journal = g.journal ?? [], days = g.days ?? [];
  return (
    <div className="ag-detail ag-gpm-detail">
      <div className="ag-detail-head">
        <ModeBadge mode={grokPmModeTag(g)} />
        <VenueBadge id="polymarket" />
        <StatusDot status={row.status} since={g.startedAt ?? null} nowMs={nowMs} live toned />
      </div>
      <h3 className="ag-detail-title mono sr-only">{row.name}</h3>
      <div className="ag-scoreboard ag-scoreboard-sm">
        <FundedCells fundedUsd={money.capital} deployedUsd={money.value} m={m} ccy={money.ccy} known={row.fundedKnown} />
        <div className="ag-sb-divider" />
        <GlCell label="TODAY" usd={money.today} pct={money.todayPct} m={m} ccy={money.ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="UNREALIZED G/L" usd={money.unrealised} pct={money.unrealisedPct} m={m} ccy={money.ccy} />
        <div className="ag-sb-divider" />
        <GlCell label="REALIZED G/L" usd={money.realised} pct={money.realisedPct} m={m} ccy={money.ccy} cls="ag-sb-realised" aside={`(incl. fees ${m(fmtIn(money.fees ?? 0, money.ccy))})`} />
      </div>
      {g.started && !g.running && <div className="ag-warn-line">{row.status.detail}</div>}
      {g.lastError && <div className="ag-warn-line">record: {m(String(g.lastError))}</div>}
      {mismatch && <div className="ag-warn-line ag-gpm-mismatch">{mismatch}</div>}
      {stop && <div className="ag-lpl-room ag-gpm-stop dim mono">{stop}</div>}
      <section className="ag-section ag-rw-bar ag-gpm-bar">
        <div className="ag-section-title mono">STATUS</div>
        <div className="ag-rw-tiles">
          {grokPmTiles(g, m).map((t) => (
            <div key={t.k} className="ag-rw-tile">
              <div className="ag-rw-tile-k mono">{t.k}</div>
              <div className="ag-rw-tile-v mono">{t.v}</div>
              {t.note ? <div className="ag-rw-tile-note dim mono">{t.note}</div> : null}
            </div>
          ))}
        </div>
      </section>
      <section className="ag-section ag-gpm-positions">
        <div className="ag-section-title mono">POSITIONS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr>
              <th className="hl-th">Market</th><th className="hl-th">Held</th><th className="hl-th">Avg</th><th className="hl-th">Mark</th><th className="hl-th">Value</th><th className="hl-th">Unrealised</th>
            </tr></thead>
            <tbody>
              {positions.length === 0 && <tr><td className="hl-empty dim" colSpan={6}>Nothing held.</td></tr>}
              {positions.map((/** @type {any} */ x) => (
                <tr key={x.asset}>
                  <td className="hl-strong ag-rw-market"><span className="ag-rw-q" title={x.title}>{marketName(x.title)}</span>{x.redeemable ? <span className="hl-sub dim">resolved · to redeem</span> : null}</td>
                  <td>{m(String(+Number(x.size).toFixed(2)))} {x.outcome ?? ''}</td>
                  <td>{m(fmtProb(x.avgPrice))}</td>
                  <td>{m(fmtProb(x.mark))}</td>
                  <td>{m(fmtUsd(Number(x.valueUsd) || 0))}</td>
                  <td className="ag-gl" style={{ color: pctColor(Number(x.unrealisedUsd) || 0) }}>{usd(x.unrealisedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ag-section ag-gpm-days">
        <div className="ag-section-title mono">DAYS</div>
        <div className="hl-scroll">
          <table className="hl-table ag-table ag-log mono">
            <thead><tr><th className="hl-th">Day (UTC)</th><th className="hl-th">Trades</th><th className="hl-th">Agent says</th><th className="hl-th">Record</th><th className="hl-th" aria-label="mismatch" /></tr></thead>
            <tbody>
              {days.length === 0 && <tr><td className="hl-empty dim" colSpan={5}>No day yet: the first starts when the funding arrives.</td></tr>}
              {days.map((/** @type {any} */ d) => {
                const c = grokPmDayCells(d, m);
                return (
                  <tr key={d.day}>
                    <td className="dim">{dayLabel(d.day)}{d.today ? ' · today' : ''}</td>
                    <td>{c.trades}</td>
                    <td>{c.agent}</td>
                    <td className="ag-gl" style={c.recordUsd == null ? undefined : { color: pctColor(c.recordUsd) }}>{c.record}</td>
                    <td className="ag-gpm-flag">{c.flag}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ag-section ag-gpm-journal">
        <div className="ag-section-title mono">JOURNAL</div>
        {journal.length === 0 && <div className="hl-empty dim ag-gpm-empty">Nothing reported yet.</div>}
        <ol className="ag-gpm-entries">
          {journal.map((/** @type {any} */ j) => {
            const v = grokPmJournalView(j, m);
            return (
              <li key={j.id} className={`ag-gpm-entry is-${v.tone}`}>
                <div className="ag-gpm-entry-head mono">
                  <span className="ag-gpm-time">{v.time}</span>
                  <span className={`ag-gpm-chip ag-gpm-chip-${v.tone}`}>{v.action}</span>
                  {(v.category || v.side || v.trade) && (
                    <span className="ag-gpm-what">
                      {v.category && <span className="ag-gpm-meta">{v.category}</span>}
                      {v.side && <span className="ag-gpm-meta">{v.side}</span>}
                      {v.trade && <span className="ag-gpm-meta ag-gpm-trade">{v.trade}</span>}
                    </span>
                  )}
                </div>
                {v.market && (v.market.href
                  ? <a className="ag-gpm-market" href={v.market.href} target="_blank" rel="noopener noreferrer nofollow">{v.market.text}</a>
                  : <div className={`ag-gpm-market${v.market.pending ? ' is-pending' : ''}`}>{v.market.text}</div>)}
                {v.probs && <div className="ag-gpm-probs mono">{v.probs}</div>}
                {v.reason && <p className="ag-gpm-reason">{v.reason}</p>}
                {v.invalidation && <p className="ag-gpm-wrong">wrong if {v.invalidation}</p>}
                {v.sources.length > 0 && (
                  <div className="ag-gpm-sources mono">
                    {v.sources.map((x) => <a key={x.href} href={x.href} target="_blank" rel="noopener noreferrer nofollow" title={x.href}>{x.text}</a>)}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
      <div className="ag-updated dim mono ag-gpm-foot">as of {when(at)} {UK_TZ} · {g.mode === 'live' ? 'armed' : 'dry-run'} · read every 5 min · refreshes every minute</div>
    </div>
  );
}

/**
 * RW's status: the pessimistic total, the largest market's share of it, how many markets are being quoted today,
 * and how many positions are still held. No line under the titles (Davies, 2026-09-25).
 * A real-money book's (LIVE's "Reward quotes") opens on its actual R (`rText`) where a paper test's opens on its worst case.
 * LIVE's has no TOP SHARE and ends on today's rewards, estimated (`est`, `lpEstimateTexts`: the range so far, in green).
 * Under its R, `rNotes` (empty since Davies, 2026-10-11, asked for the R alone).
 * @param {{ v: { phase: string, bestShareText?: string }, r: any, usd: (x: number | null | undefined) => string, rText?: string | null, rNotes?: string[], est?: { text: string, color: string | null } | null }} props
 */
function RwBar({ v, r, usd, rText = null, rNotes = [], est = null }) {
  const quoting = Number(r.quoting) || 0;
  const open = Number(r.open) || 0;
  // A real-money book's first tile is its actual R (`rText`, LIVE's "Reward quotes"); a paper test's, its worst case.
  const live = rText != null;
  /** @type {Record<string, { text: string, color?: string, notes?: string[] }>} */
  const tiles = {
    [LP_R_TILE]: { text: rText ?? '—', notes: rNotes },
    'REWARDS TODAY (EST.)': { text: est?.text ?? '—', color: est?.color ?? undefined },
    'WORST CASE': { text: usd(r.stressUsd), color: pctColor(r.stressUsd) },
    'TOP SHARE': { text: v.bestShareText ?? '—' },
    'QUOTING TODAY': { text: String(quoting) },
    'POSITIONS STILL HELD': { text: String(open) },
  };
  return (
    <section className={`ag-section ag-rw-bar is-${v.phase}`}>
      <div className="ag-section-title mono">STATUS</div>
      <div className="ag-rw-tiles">
        {rwBarTileKeys(v.phase, live).map((k) => (
          <div key={k} className="ag-rw-tile">
            <div className="ag-rw-tile-k mono">{k}</div>
            <div className="ag-rw-tile-v mono" style={tiles[k].color ? { color: tiles[k].color } : undefined}>{tiles[k].text}</div>
            {(tiles[k].notes ?? []).map((t) => <div key={t} className="ag-rw-tile-note dim mono">{t}</div>)}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The Reward quotes pages' QUOTES: each market quoted today, then each still held from an earlier day, with its pool, its
 * quote, our share of the pool, what it holds and what it has made, its rewards and its orders adding up to its total to
 * the cent. TESTING's pages draw it from their paper; LIVE's "Reward quotes" from its live book (Davies, 2026-10-09:
 * "RESTING ORDERS表格还是改为testing页的QUOTES表格吧"). LIVE's (`live`) shows no Share; its Rewards (est.) is what Polymarket
 * paid plus the days not yet read at each market's point R, and its Total (est.) that plus the orders (Davies, 2026-10-09:
 * "avg cost列删了，换成Rewards(est.)，用最新数据的最合理r来估算…之后的Total也改成Total(est.)"). The scoreboard counts paid money only.
 * @param {{ markets: any[], m: (s: string) => string, usd: (x: number | null | undefined) => string, waiting?: string | null, live?: boolean }} props
 */
function RwQuotesTable({ markets, m, usd, waiting = null, live = false }) {
  return (
    <section className="ag-section ag-rw-markets">
      <div className="ag-section-title mono">QUOTES</div>
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th">Market</th><th className="hl-th">Pool/day</th><th className="hl-th">Quote</th>{!live && <th className="hl-th">Share</th>}
            <th className="hl-th">Held</th><th className="hl-th">{live ? 'Rewards (est.)' : 'Rewards'}</th><th className="hl-th">Orders</th><th className="hl-th">{live ? 'Total (est.)' : 'Total'}</th>
          </tr></thead>
          <tbody>
            {markets.length === 0 && <tr><td className="hl-empty dim" colSpan={live ? 7 : 8}>{waiting ?? 'No market chosen today yet.'}</td></tr>}
            {markets.map((x) => {
              // LIVE's: what was paid plus the days not yet read at the market's point R, and the total with it (Davies,
              // 2026-10-09: "avg cost列删了，换成Rewards(est.)…之后的Total也改成Total(est.)"); TESTING's: its paper's own.
              const s = live
                ? splitCents(Number(x.totalEstUsd) || 0, [Number(x.rewardEstUsd) || 0, Number(x.fillsPnlUsd) || 0])
                : splitCents(Number(x.totalUsd) || 0, [Number(x.rewardUsd) || 0, Number(x.fillsPnlUsd) || 0]);
              const c = { total: s.total, a: s.parts[0], b: s.parts[1] };
              return (
                <tr key={x.cond}>
                  <td className="hl-strong ag-rw-market"><span className="ag-rw-q" title={x.q}>{marketName(x.q)}</span>{x.quoting ? null : <span className="hl-sub dim">held from an earlier day</span>}</td>
                  <td>{x.ratePerDay != null ? m(fmtUsd(x.ratePerDay)) : '—'}</td>
                  {/* A paper layer's market whose resting orders are not RW's quote says why: none rest, or they differ. */}
                  <td>{x.bid != null || x.ask != null ? `${m(fmtCents(x.bid))} / ${m(fmtCents(x.ask))}` : x.cls === 'diverged' ? 'not RW’s quote' : '—'}</td>
                  {!live && <td>{x.share != null ? `${Math.round(x.share * 100)} %` : '—'}</td>}
                  <td>{m(rwHeldOf(x))}</td>
                  <td className="ag-gl" style={{ color: pctColor(c.a) }}>{usd(c.a)}</td>
                  <td className="ag-gl" style={{ color: pctColor(c.b) }}>{usd(c.b)}</td>
                  <td className="ag-gl" style={{ color: pctColor(c.total) }}>{usd(c.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The Reward quotes pages' FILLS, newest first: when, the market, what was done, shares and price. A fill the venue has
 * not yet confirmed (LIVE's book lists it, `counted: false`) says so under its time and is counted in no figure.
 * @param {{ recent: any[], m: (s: string) => string, waiting?: string | null }} props
 */
function RwFillsTable({ recent, m, waiting = null }) {
  return (
    <section className="ag-section ag-rw-fills">
      <div className="ag-section-title mono">FILLS</div>
      <div className="hl-scroll">
        <table className="hl-table ag-table ag-log mono">
          <thead><tr>
            <th className="hl-th">When ({UK_TZ})</th><th className="hl-th">Market</th><th className="hl-th">Side</th><th className="hl-th ag-col-shares">Shares</th><th className="hl-th ag-col-price">Price</th>
          </tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td className="hl-empty dim" colSpan={5}>{waiting ?? 'No fill yet.'}</td></tr>}
            {recent.map((f) => {
              const fv = rwFillView(f);
              return (
                <tr key={f.tradeId ?? `${f.cond}|${f.minute}|${f.ts}|${f.side}|${f.price}|${f.size}`} className={`txn-row txn-row-${fv.buy ? 'buy' : 'sell'}${f.counted === false ? ' ag-fill-unconfirmed' : ''}`}>
                  <td className="dim">{when(f.ts)}{f.counted === false ? <>{' '}<span className="hl-sub dim" title="not counted until Polymarket confirms it">not confirmed</span></> : null}</td>
                  <td className="hl-strong"><span className="ag-rw-q" title={f.q}>{marketName(f.q)}</span></td>
                  <td><span className={`ag-side ag-side-${fv.buy ? 'buy' : 'sell'}`}><span className="ag-side-mark" aria-hidden="true" />{fv.text}</span></td>
                  <td className="ag-col-shares">{m(rwShareText(f.size))}</td>
                  <td className="ag-col-price">{m(fmtCents(fv.price))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
/** A name on two lines when it has a qualifier: the variant's "variant-N", or a bracketed one. */
function NameText({ name }) {
  const { head, qual, twoLines } = strategyNameParts(name);
  if (!qual) return <>{name}</>;
  if (twoLines) return <><span className="ag-name-head">{head}</span> <span className="ag-name-qual">{qual}</span></>;
  return <>{head} <span className="ag-name-qual">{qual}</span></>;
}

function NameCell({ r, m, onOpen }) {
  return (
    <div className="ag-name-wrap">
      <span className={`ag-dot ag-dot-${r.status.tone}`} title={r.status.detail} role="img" aria-label={r.status.detail} />
      <button type="button" className="ag-name-btn ag-name" onClick={() => onOpen(r.id)}><NameText name={r.name} /></button>
      <span className="hl-sub dim">{r.openPositions} open · {m(fmtIn(rowMoney(r).capital, rowMoney(r).ccy))} cap</span>
    </div>
  );
}

/** A row's unrealised. A row whose percent is not on cost still says so under the figure. */
function UnrealisedCell({ r, m }) {
  const x = rowMoney(r);
  return (
    <>
      <span className="ag-gl" style={{ color: pctColor(x.unrealised) }}>{m(glTextIn(x.unrealised, x.unrealisedPct, x.ccy))}</span>
      {r.unrealisedOf && r.unrealisedPct != null && Number.isFinite(r.unrealisedPct) ? <span className="ag-cell-base dim">% of {r.unrealisedOf}</span> : null}
    </>
  );
}

// A row's money is in its own currency (`rowMoney`): the stablecoin quotes' in pounds (Davies, 2026-10-01).
function StrategyCell({ id, r, m, onOpen }) {
  const x = rowMoney(r);
  switch (id) {
    case 'name': return <NameCell r={r} m={m} onOpen={onOpen} />;
    case 'venue': return <VenueBadge id={r.venueId} />;
    case 'deployed': return <span className="ag-deployed">{m(fmtIn(x.value, x.ccy))}</span>;
    case 'today': return <span className="ag-gl" style={{ color: pctColor(x.today) }}>{m(glTextIn(x.today, x.todayPct, x.ccy))}</span>;
    case 'unrealised': return <UnrealisedCell r={r} m={m} />;
    case 'realised': return <span className="ag-gl" style={{ color: pctColor(x.realised) }}>{m(glTextIn(x.realised, x.realisedPct, x.ccy))}</span>;
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
      {rows.map((r) => { const x = rowMoney(r); return (
        <div key={r.id} className="ag-card-strategy ag-row" onClick={() => onOpen(r.id)}>
          <div className="ag-card-head ag-name-cell">
            <NameCell r={r} m={m} onOpen={onOpen} />
          </div>
          <div className="ag-card-badges"><VenueBadge id={r.venueId} /></div>
          <div className="ag-card-gl mono">
            <FigLabel name="deployed" /><span className="ag-deployed">{m(fmtIn(x.value, x.ccy))}</span>
            <FigLabel name="today" /><span className="ag-gl ag-card-today" style={{ color: pctColor(x.today) }}>{m(glTextIn(x.today, x.todayPct, x.ccy))}</span>
            <FigLabel name="unrealised" /><span className="ag-gl" style={{ color: pctColor(x.unrealised) }}>{m(glTextIn(x.unrealised, x.unrealisedPct, x.ccy))}</span>
            <FigLabel name="realised" /><span className="ag-gl" style={{ color: pctColor(x.realised) }}>{m(glTextIn(x.realised, x.realisedPct, x.ccy))}</span>
            <FigLabel name="next" /><span className="ag-next">{r.nextText}</span>
          </div>
        </div>
      ); })}
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
            <th className="hl-th">When ({UK_TZ})</th><th className="hl-th">Symbol</th><th className="hl-th ag-ph">Venue</th><th className="hl-th ag-ph">Mode</th>
            <th className="hl-th">Side</th><th className="hl-th">Price</th><th className="hl-th ag-ph">Size</th><th className="hl-th ag-ph">Cost</th>
            <th className="hl-th">State</th><th className="hl-th ag-ph">Fill</th><th className="hl-th ag-ph">Fee</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="hl-empty dim" colSpan={11}>No orders on this pair in the window.</td></tr>}
            {rows.map((o) => (
              <tr key={o.id} className={`txn-row txn-row-${o.side}`}>
                <td className="dim">{fmtChartStamp(o.ts)}</td>
                <td className="hl-strong">{symbol}</td>
                <td className="ag-ph"><VenueBadge id={o.venue ?? venue} /></td>
                <td className="ag-ph"><ModeBadge mode={o.mode} /></td>
                <td>
                  <span className={`ag-side ag-side-${o.side}`}><span className="ag-side-mark" aria-hidden="true" />{o.side}</span>
                </td>
                <td>{m(fmtUsd(o.price))}</td>
                <td className="ag-ph">{sizeText(o.base, m)}</td>
                <td className="ag-ph">{m(fmtUsd(o.costUsd))}</td>
                <td><span className={`ag-state-pill ag-state-${o.state}`}>{orderStateText(o.state)}</span></td>
                <td className="ag-ph">{o.fillPrice != null ? m(fmtUsd(o.fillPrice)) : <span className="dim">—</span>}</td>
                <td className="dim ag-ph">{m(fmtUsd(o.feeUsd))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The chart card: symbol tabs, the chart for the one selected, and its fills. */
function SymbolChart({ s, symbol, onSelect, m, nowMs, at, gen, clicks, more, loadingMore, onLoadMore }) {
  const [chart, setChart] = React.useState(/** @type {any} */ (() => readChartCache(s.id, symbol)?.chart ?? null));
  const [error, setError] = React.useState(/** @type {string | null} */ (null));
  const [loading, setLoading] = React.useState(() => !readChartCache(s.id, symbol));
  const held = new Map((s.positions ?? []).map((p) => [p.symbol, p]));

  // A new pair empties the card. Each dashboard refresh (`gen`) — the
  // minute's, or the button on this page — refetches without clearing the
  // frame, the way a live chart should. `at` alone is not enough: two
  // answers can share a timestamp, and a click must still redraw.
  React.useEffect(() => { const c = readChartCache(s.id, symbol); setChart(c?.chart ?? null); setError(null); setLoading(!c); }, [s.id, symbol]);
  // The click count this card last fetched for: a run of the effect that finds it moved is a click's refresh.
  const clicksSeen = React.useRef(clicks);
  React.useEffect(() => {
    if (!symbol) return undefined;
    let alive = true;
    const fresh = clicks !== clicksSeen.current;
    clicksSeen.current = clicks;
    (async () => {
      try {
        const c = await fetchAgentsChart(s.id, symbol, undefined, fresh);
        if (!alive) return;
        if (c?.error) { setError(String(c.error)); setChart(null); } else { setChart(c); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [s.id, symbol, at, gen, clicks]);

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
              {m(fmtUsd(p.unrealisedUsd ?? 0, true))} ({fmtPctSigned(p.returnPct, 2)})
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

function Detail({ s, dash, m, nowMs, gen, clicks }) {
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
        <VenueBadge id={s.venue} />
        <StatusDot status={status} since={s.createdAt} until={s.retiredAt} nowMs={nowMs} live={s.mode === 'live'} />
        <Countdown at={s.nextDecisionAt} label={s.kind === 'dislocation-1m' ? 'next read' : 'next decision'} />
      </div>
      <h3 className="ag-detail-title mono sr-only">{strategyName(s)}</h3>
      <StrategyScoreboard s={s} m={m} />
      <PositionTiles s={s} m={m} nowMs={nowMs} selected={symbol} onSelect={setSymbol} />
      <LiveState s={s} nowMs={nowMs} selected={symbol} onSelect={setSymbol} />
      <SymbolChart s={s} symbol={symbol} onSelect={setSymbol} m={m} nowMs={nowMs} at={dash?.at} gen={gen} clicks={clicks} more={more} loadingMore={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}

/**
 * A page opened over the list (a strategy, a quote test, Reward quotes), inside a boundary of its own: a throw there
 * says so in the page's body with a Retry, and the list under it, the Agents page and the board stay up. Each
 * dashboard answer (`gen`) draws a failed page again.
 * @param {{ gen: number, children?: React.ReactNode }} props
 */
function PageGuard({ gen, children }) {
  return <SurfaceBoundary name="agents-page" what="page" className="ag-failed" resetKey={gen}>{children}</SurfaceBoundary>;
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
  // Bumps with `gen` when the answer is a click's: the open chart then asks anew rather than joining a request of its
  // pair already on its way (`fetchAgentsChart`'s `fresh`).
  const [clicks, setClicks] = React.useState(0);
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
      if (manual) setClicks((c) => c + 1);
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
  // TESTING's paper tests after its strategies, in the page's order (`paperTestRows`; Davies, 2026-09-24: its scoreboard
  // and venue cards add them in; LIVE never does): the realistic twins of the live executor (2026-10-02) and Coinbase's
  // two paper tests. Every paper Reward quotes row left it with 0120 (Davies, 2026-10-13), their calls stopped and their
  // payload no longer sent; mini-pool's had left with 0103. A page opens its row only as the list has it, so a payload
  // from an older function deploy opens none of them.
  const tests = React.useMemo(() => paperTestRows(dash), [dash]);
  const testing = React.useMemo(() => [...split.testing, ...tests], [split, tests]);
  // PR5's live executor is a row of LIVE once it trades real money (Davies, 2026-09-26), in LIVE's scoreboard and its
  // Revolut X card; its twin is on TESTING.
  // Live-prep's real-money book is one too since it went live (Davies, 2026-10-09), in LIVE's scoreboard and its Polymarket
  // card (`liveExtraRows`); TESTING has no Polymarket row since 0120.
  const liveExtras = React.useMemo(() => liveExtraRows(dash), [dash]);
  const liveRows = React.useMemo(() => [...split.live, ...liveExtras], [split, liveExtras]);
  const tabsView = React.useMemo(() => agentsTabsView(dash, tests.length), [dash, tests]);
  // The page opens on LIVE while anything trades real money, else on TESTING, and follows the data until a tab is
  // clicked; from then on the click holds, through every refresh and every page opened over the list.
  const [tabChoice, setTabChoice] = React.useState(/** @type {'live' | 'testing' | null} */ (null));
  const tab = tabChoice ?? defaultAgentsTab(dash);
  const phone = useMediaQuery('(max-width: 760px)');
  const current = selected ? (dash?.strategies ?? []).find((s) => s.id === selected) ?? null : null;
  // LIVE's "Stablecoin quotes" opens the live executor's own page (Davies, 2026-10-01: it opened the paper test's), a
  // twin's row its twin's, laid out as the live executor's (Davies, 2026-10-02).
  const quotesPage = quotesPageFor(selected, dash);
  const quotesLiveOpen = quotesPage === 'live';
  const twinOpen = quotesPage === 'twin' ? quotesTwinOf(selected, dash) : null;
  const coinbaseOpen = quotesPage === 'coinbase'
    ? (selected === QUOTES_COINBASE_HOLD_ROW_ID ? dash.quotesCoinbaseHold : selected === QUOTES_COINBASE_USDC_ROW_ID ? dash.quotesCoinbaseUsdc : dash.quotesCoinbase)
    : null;
  const okxOpen = quotesPage === 'okx' ? quotesOkxOf(selected, dash) : null;
  const lpLiveOpen = selected === LP_LIVE_ROW_ID && !!lpLiveRow(dash?.lpLive);
  const grokPmOpen = selected === GROKPM_ROW_ID && !!grokPmRow(dash?.grokPm);
  const fxwOpen = selected === FXW_ROW_ID && !!fxwAudRow(dash?.fxwAud);
  const grokTestOpen = grokTestOf(selected, dash);
  const notReady = !!dash?.notReady;
  const tabRows = tab === 'live' ? liveRows : testing;

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
            <SurfaceBoundary name="agents-list" what="page" className="ag-failed" resetKey={`${gen}|${tab}`}>
            {tab === 'live' && liveRows.length === 0 ? (
              <>
                <Alerts dash={dash} tab={tab} />
                <LiveEmpty />
              </>
            ) : (
              <>
                <Scoreboard dash={dash} tab={tab} m={m} tests={tab === 'testing' ? tests : liveExtras} />
                <VenueSplit dash={dash} tab={tab} m={m} tests={tab === 'testing' ? tests : liveExtras} />
                <Alerts dash={dash} tab={tab} />
                <section className={`ag-section ag-strategies ag-strategies-${tab}`}>
                  <div className="ag-section-title mono">{tab === 'live' ? 'LIVE STRATEGIES' : 'TESTING STRATEGIES'}</div>
                  {phone ? <StrategyCards rows={tabRows} m={m} onOpen={setSelected} /> : <StrategyTable rows={tabRows} m={m} onOpen={setSelected} />}
                </section>
              </>
            )}
            </SurfaceBoundary>
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
          <PageGuard gen={gen}><Detail s={current} dash={dash} m={m} nowMs={now} gen={gen} clicks={clicks} /></PageGuard>
        </div>
      </Modal>
    )}
    {quotesLiveOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono">Stablecoin quotes</h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <PageGuard gen={gen}><QuotesLiveDetail q={dash.quotes.live} m={m} at={dash.at} nowMs={now} /></PageGuard>
        </div>
      </Modal>
    )}
    {lpLiveOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono ag-title-wraps">Reward quotes</h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <PageGuard gen={gen}><LpLiveDetail l={dash.lpLive} m={m} at={dash.at} nowMs={now} /></PageGuard>
        </div>
      </Modal>
    )}
    {grokPmOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono ag-title-wraps">{GROKPM_ROW_NAME}</h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <PageGuard gen={gen}><GrokPmDetail g={dash.grokPm} m={m} at={dash.at} nowMs={now} /></PageGuard>
        </div>
      </Modal>
    )}
    {grokTestOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono ag-title-wraps">{String(grokTestOpen.name)}</h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <PageGuard gen={gen}><GrokTestDetail g={grokTestOpen} m={m} nowMs={now} /></PageGuard>
        </div>
      </Modal>
    )}
    {fxwOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono"><NameText name={String(dash.fxwAud.name)} /></h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <PageGuard gen={gen}><FxwDetail f={dash.fxwAud} m={m} at={dash.at} nowMs={now} /></PageGuard>
        </div>
      </Modal>
    )}
    {twinOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono"><NameText name={String(twinOpen.twin.name)} /></h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <PageGuard gen={gen}><QuotesLiveDetail q={twinOpen} m={m} at={dash.at} nowMs={now} twin /></PageGuard>
        </div>
      </Modal>
    )}
    {coinbaseOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono"><NameText name={String(coinbaseOpen.twin.name)} /></h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <PageGuard gen={gen}><QuotesLiveDetail q={coinbaseOpen} m={m} at={dash.at} nowMs={now} coinbase /></PageGuard>
        </div>
      </Modal>
    )}
    {okxOpen && (
      <Modal onClose={() => setSelected(null)} size="lg">
        <header className="modal-head">
          <div>
            <h2 className="modal-title mono"><NameText name={quotesOkxName(okxOpen.twin)} /></h2>
          </div>
          <PageActions onRefresh={() => load(true)} onClose={() => setSelected(null)} loading={loading} closeClass="ag-detail-close" />
        </header>
        <div className="modal-body ag-body">
          <PageGuard gen={gen}><QuotesLiveDetail q={okxOpen} m={m} at={dash.at} nowMs={now} okx /></PageGuard>
        </div>
      </Modal>
    )}
    </>
  );
}

export { AgentsModal };
