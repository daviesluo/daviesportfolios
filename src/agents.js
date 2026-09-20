// Agents page — the pure half. Fetches the dashboard the `agents` Edge
// Function computes (positions and P&L are derived server-side from fills,
// in one place) and turns it into the rows the modal renders. Nothing here
// touches the DOM; `agents.test.js` pins the shaping.
import { SB_ANON, EDGE_AGENTS_URL } from './supabase_config.js';
import { getAppToken } from './auth.js';
import { fmtMoney, formatAgo } from './formatters.js';

export const VENUE_LABELS = { revx: 'Revolut X', kraken: 'Kraken' };
export const KIND_LABELS = { 'trend-4h': 'Trend 4h', 'trend-1h': 'Trend 1h', 'momentum-1d': 'Momentum 30d', 'rotation-1d': 'Rotation' };

/** @param {string} id */
export const venueLabel = (id) => VENUE_LABELS[id] ?? id;
/** @param {string} kind */
export const kindLabel = (kind) => KIND_LABELS[kind] ?? kind;

/** Signed USD with cents — the whole book is a couple of hundred dollars, so "$1.23K" would hide the movement. */
export const fmtUsd = (n, signed = false) => fmtMoney(n, { signed, compact: false });

/** @param {number | null | undefined} n */
export const fmtPctSigned = (n, precision = 1) => (n == null || isNaN(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(precision) + '%');

function headers() {
  return { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, 'X-App-Token': getAppToken() };
}

/**
 * The dashboard payload. Throws with the server's message on anything but
 * a 200, so the modal can show it instead of an empty table.
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchAgentsDashboard(fetchImpl = fetch) {
  const res = await fetchImpl(`${EDGE_AGENTS_URL}?action=dashboard`, { headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`agents dashboard: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/**
 * More history for one strategy: `{ strategyId, decisions, orders }`, newest first.
 * @param {string} strategyId
 * @param {number} [limit]
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchAgentsLog(strategyId, limit = 200, fetchImpl = fetch) {
  const res = await fetchImpl(`${EDGE_AGENTS_URL}?action=log&strategy=${encodeURIComponent(strategyId)}&limit=${limit}`, { headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`agents log: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const FOUR_H = 4 * 3600e3, ONE_D = 86400e3;

/**
 * Is the loop still deciding for this strategy? It decides once per closed
 * bar, so a 4h strategy that has gone two bars without a decision, or a
 * daily one that has gone two days, is not running whatever its row says.
 * @param {{ mode: string, kind: string, lastDecision: { ts: string } | null }} s
 * @param {{ global_pause?: boolean } | null} risk
 * @param {number} nowMs
 * @returns {{ label: 'live' | 'paper' | 'paused', running: boolean, detail: string }}
 */
export function strategyStatus(s, risk, nowMs) {
  const label = /** @type {'live' | 'paper' | 'paused'} */ (s.mode === 'live' ? 'live' : s.mode === 'paused' ? 'paused' : 'paper');
  if (s.mode === 'paused') return { label, running: false, detail: 'paused' };
  if (risk?.global_pause) return { label, running: false, detail: 'global pause' };
  if (!s.lastDecision) return { label, running: false, detail: 'no decision yet' };
  const age = nowMs - Date.parse(s.lastDecision.ts);
  const stale = s.kind === 'momentum-1d' ? 2 * ONE_D : 2 * FOUR_H;
  if (age > stale) return { label, running: false, detail: `last decision ${formatAgo(age)} ago` };
  return { label, running: true, detail: `decided ${formatAgo(age)} ago` };
}

/**
 * One row per strategy for the overview table.
 * @param {any} dash  the dashboard payload
 * @param {number} nowMs
 */
export function strategyRows(dash, nowMs) {
  return (dash?.strategies ?? []).map((s) => {
    const totalPnlUsd = (s.unrealisedUsd ?? 0) + (s.realisedUsd ?? 0);
    const capital = Number(s.capitalUsd) || 0;
    return {
      id: s.id,
      name: s.name,
      venue: venueLabel(s.venue),
      venueId: s.venue,
      signalVenue: s.signalVenue ?? s.venue,
      nextDecisionAt: s.nextDecisionAt ?? null,
      kind: kindLabel(s.kind),
      mode: s.mode,
      capitalUsd: capital,
      costUsd: s.costUsd ?? 0,
      valueUsd: s.valueUsd ?? 0,
      unrealisedUsd: s.unrealisedUsd ?? 0,
      realisedUsd: s.realisedUsd ?? 0,
      feesUsd: s.feesUsd ?? 0,
      totalPnlUsd,
      returnPct: capital > 0 ? (totalPnlUsd / capital) * 100 : null,
      openPositions: (s.positions ?? []).filter((p) => p.base > 0).length,
      openOrders: s.openOrders ?? 0,
      ordersToday: s.ordersToday ?? 0,
      lastAction: s.lastDecision?.action ?? null,
      lastSymbol: s.lastDecision?.symbol ?? null,
      lastAgeMs: s.lastDecision ? nowMs - Date.parse(s.lastDecision.ts) : null,
      status: strategyStatus(s, dash?.risk ?? null, nowMs),
    };
  });
}

/**
 * The headline block: realised across everything, and how it splits.
 * @param {any} dash
 */
export function totalsView(dash) {
  const t = dash?.totals ?? {};
  return {
    realisedUsd: t.realisedUsd ?? 0,
    unrealisedUsd: t.unrealisedUsd ?? 0,
    valueUsd: t.valueUsd ?? 0,
    costUsd: t.costUsd ?? 0,
    feesUsd: t.feesUsd ?? 0,
    liveRealisedUsd: t.byMode?.live?.realisedUsd ?? 0,
    paperRealisedUsd: t.byMode?.paper?.realisedUsd ?? 0,
  };
}

/**
 * A decision row as the detail table shows it: the words the model saw,
 * what the rule said, what was done, and the model's vote.
 * @param {any} d
 */
export function decisionView(d) {
  const st = d?.state ?? {};
  const a = d?.answers ?? {};
  const healthy = a.healthy_trend?.type === 'noul' ? a.healthy_trend.probability : null;
  const caution = a.caution?.type === 'score' ? a.caution.score : null;
  return {
    id: d.id,
    ts: d.ts,
    symbol: d.symbol,
    stateText: [st.trend_4h && `trend ${st.trend_4h}`, st.breakout_4h, st.volatility && `vol ${st.volatility}`, st.momentum_30d && `mom ${st.momentum_30d}`, st.position]
      .filter(Boolean).join(' · '),
    ruleAction: d.rule_action,
    finalAction: d.final_action,
    healthy,
    caution,
    provider: d.provider,
    allowed: !!d.risk_allowed,
    reason: d.final_reason,
    riskReason: d.risk_reason,
    costUsd: Number(d.cost_usd ?? 0),
    latencyMs: d.latency_ms ?? null,
  };
}

/** @param {any} o */
export function orderView(o) {
  const price = Number(o.avg_fill_price ?? o.price), base = Number(o.filled_base || o.base_size);
  return {
    id: o.id, ts: o.ts, symbol: o.symbol, side: o.side, mode: o.mode, state: o.state,
    price: Number(o.price), base: Number(o.base_size),
    fillPrice: o.avg_fill_price != null ? Number(o.avg_fill_price) : null,
    notionalUsd: price * base,
    feeUsd: Number(o.fee_usd ?? 0),
    filledAt: o.filled_at ?? null,
  };
}

/**
 * The walk-forward figures for one rulebook on one venue, per symbol, from
 * `docs/agents/backtests/summary.json`.
 * @param {any} summary
 * @param {string} kind
 * @param {string} venue
 */
export function backtestRows(summary, kind, venue) {
  const out = [];
  for (const [symbol, r] of Object.entries(summary?.results ?? {})) {
    const k = /** @type {any} */ (r)[kind]?.[venue];
    if (!k) continue;
    out.push({
      symbol,
      oosRet: k.outOfSample?.ret ?? null, oosDD: k.outOfSample?.maxDD ?? null, oosTrades: k.outOfSample?.trades ?? null,
      fullRet: k.fullPeriod?.ret ?? null, fullDD: k.fullPeriod?.maxDD ?? null,
      buyHoldOos: /** @type {any} */ (r).buyHoldOutOfSample ?? null,
      chosen: kind === 'trend-4h' ? /** @type {any} */ (r)['trend-4h']?.chosen ?? null : null,
    });
  }
  return out;
}

/** Fraction → signed percent string, one decimal. @param {number | null} f */
export const fmtFrac = (f) => (f == null ? '—' : fmtPctSigned(f * 100, 1));

/** @param {{ maker: number, taker: number } | undefined} bps */
export const fmtFees = (bps) => (bps ? `${bps.maker / 100}% / ${bps.taker / 100}%` : '—');

/** Signed basis points with two decimals, the way the basis reads. @param {number | null | undefined} n */
export const fmtBps = (n) => (n == null || isNaN(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)} bps`);

/**
 * "in 2h 13m" until an ISO time, "due" once it has passed — the next bar
 * close a strategy will decide on.
 * @param {string | null | undefined} iso
 * @param {number} nowMs
 */
export function untilText(iso, nowMs) {
  if (!iso) return '—';
  const ms = Date.parse(iso) - nowMs;
  if (isNaN(ms)) return '—';
  if (ms <= 0) return 'due';
  const m = Math.ceil(ms / 60e3);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return `in ${h}h ${String(rm).padStart(2, '0')}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * One row per venue for the split: what each account holds, has made and
 * is funded with, and its share of the book. Shares are of deployed value
 * when anything is deployed, else of allotted capital, so the bar always
 * says something.
 * @param {any} dash
 */
export function venueRows(dash) {
  const ids = ['revx', 'kraken'];
  const by = dash?.byVenue ?? {};
  const venues = Object.fromEntries((dash?.venues ?? []).map((v) => [v.id, v]));
  const totalValue = ids.reduce((a, id) => a + (by[id]?.valueUsd ?? 0), 0);
  const totalCapital = ids.reduce((a, id) => a + (by[id]?.capitalUsd ?? 0), 0);
  const useValue = totalValue > 0;
  return ids.map((id) => {
    const b = by[id] ?? {};
    const v = venues[id] ?? {};
    const value = b.valueUsd ?? 0, capital = b.capitalUsd ?? 0;
    return {
      id, label: venueLabel(id),
      capitalUsd: capital, valueUsd: value, costUsd: b.costUsd ?? 0, unrealisedUsd: b.unrealisedUsd ?? 0, realisedUsd: b.realisedUsd ?? 0, feesUsd: b.feesUsd ?? 0,
      strategies: b.strategies ?? 0, live: b.live ?? 0,
      balanceUsd: v.balances?.USD ?? null, canTrade: !!v.canTrade, feeBps: v.feeBps ?? null, note: v.note ?? null,
      share: useValue ? (totalValue > 0 ? value / totalValue : 0) : (totalCapital > 0 ? capital / totalCapital : 0),
      shareOf: useValue ? 'value' : 'capital',
    };
  });
}

/**
 * The cross-venue basis per symbol over the last 24 h, plus the verdict the
 * fees impose: an arbitrage needs the basis to clear Kraken's taker fee
 * (or its maker fee with a resting hedge), and the counts say how often it did.
 * @param {any} dash
 */
export function basisRows(dash) {
  const b = dash?.basis ?? {};
  return Object.keys(b).sort().map((symbol) => ({ symbol, ...b[symbol] }));
}

/**
 * The rotation backtest is a basket, not a symbol: one row per variant on
 * the venue asked for, with the other venue's out-of-sample figure beside
 * it and the equal-weight buy-and-hold line for scale.
 * @param {any} summary
 * @param {string} venue
 */
export function rotationBacktestRows(summary, venue) {
  const basket = summary?.basket;
  if (!basket) return { rows: [], buyHoldOos: null, buyHoldFull: null, symbols: [] };
  const other = venue === 'revx' ? 'kraken' : 'revx';
  const labels = { default: 'top 2, bear filter on', noBearFilter: 'bear filter off (always in)', minHold7: '7-day minimum hold', top1: 'top 1', top3: 'top 3', lookback60: '60-day lookback' };
  const rows = Object.entries(basket.variants ?? {}).map(([name, v]) => {
    const mine = /** @type {any} */ (v)[venue] ?? {};
    const theirs = /** @type {any} */ (v)[other] ?? {};
    return {
      name, label: labels[name] ?? name,
      oosRet: mine.outOfSample?.ret ?? null, oosDD: mine.outOfSample?.maxDD ?? null, exposure: mine.outOfSample?.exposure ?? null, turnover: mine.outOfSample?.turnover ?? null,
      fullRet: mine.fullPeriod?.ret ?? null, otherOosRet: theirs.outOfSample?.ret ?? null,
    };
  });
  return { rows, buyHoldOos: basket.buyHoldEqualWeightOutOfSample ?? null, buyHoldFull: basket.buyHoldEqualWeightFull ?? null, symbols: basket.symbols ?? [] };
}
