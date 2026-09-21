// Agents page — the pure half. Fetches the dashboard the `agents` Edge
// Function computes (positions and P&L are derived server-side from fills,
// in one place) and turns it into the rows the modal renders. Nothing here
// touches the DOM; `agents.test.js` pins the shaping.
import { SB_ANON, EDGE_AGENTS_URL } from './supabase_config.js';
import { getAppToken } from './auth.js';
import { fmtMoney, formatAgo } from './formatters.js';

export const VENUE_LABELS = { revx: 'Revolut X', kraken: 'Kraken' };
export const KIND_LABELS = { 'trend-4h': 'Trend 4h', 'trend-1h': 'Trend 1h', 'momentum-1d': 'Momentum 30d', 'rotation-1d': 'Rotation', 'dislocation-1m': 'Dislocation' };
/** The two venue hues the badges, the share bar and the detail chart all share. */
export const VENUE_HUES = { revx: '#8ec5ff', kraken: '#c4b5fd' };

/** @param {string} id */
export const venueLabel = (id) => VENUE_LABELS[id] ?? id;
/** @param {string} kind */
export const kindLabel = (kind) => KIND_LABELS[kind] ?? kind;
/** @param {string} id */
export const venueHue = (id) => VENUE_HUES[id] ?? 'rgba(244,239,227,0.6)';

/** Signed USD with cents — the whole book is a couple of hundred dollars, so "$1.23K" would hide the movement. */
export const fmtUsd = (n, signed = false) => fmtMoney(n, { signed, compact: false });

/** @param {number | null | undefined} n */
export const fmtPctSigned = (n, precision = 1) => (n == null || isNaN(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(precision) + '%');

function headers() {
  return { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, 'X-App-Token': getAppToken() };
}

// ── What a failure says ─────────────────────────────────────────────────
// The Edge Function answers a failure as JSON — `{ error, message }` — and
// a stack of proxies can answer it as anything at all. The page must never
// show either verbatim: a reader wants to know what broke, whether their
// money is affected and how to try again, and `{"code":"57014"}` answers
// none of those. So the fetchers keep the whole reply on the error object
// and `agentsErrorView` turns it into the four things the card renders.

/**
 * The server's own sentence out of a failed reply: `message`, else `error`,
 * else whatever the body was. Never throws on a body that is not JSON.
 * @param {string} text
 */
export function parseAgentsErrorBody(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === 'object') {
      for (const k of ['message', 'error']) {
        const v = /** @type {any} */ (body)[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (v && typeof v === 'object' && typeof v.message === 'string' && v.message.trim()) return v.message.trim();
      }
    }
    if (typeof body === 'string' && body.trim()) return body.trim();
  } catch { /* not JSON: the body is all there is */ }
  return raw;
}

/** The error a failed agents call throws: the status and the body ride along. @param {string} scope @param {number} status @param {string} text */
function agentsFetchError(scope, status, text) {
  const message = parseAgentsErrorBody(text);
  const err = /** @type {any} */ (new Error(`agents ${scope}: ${status} ${message.slice(0, 200)}`));
  err.status = status;
  err.body = String(text ?? '');
  err.scope = scope;
  err.serverMessage = message;
  return err;
}

/**
 * The dashboard payload. Throws with the server's message on anything but
 * a 200, so the modal can show it instead of an empty table.
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchAgentsDashboard(fetchImpl = fetch) {
  const res = await fetchImpl(`${EDGE_AGENTS_URL}?action=dashboard`, { headers: headers() });
  const text = await res.text();
  if (!res.ok) throw agentsFetchError('dashboard', res.status, text);
  const dash = JSON.parse(text);
  agentsCache = { at: Date.now(), dash };
  return dash;
}

// The page must open the way the rest of the site does: on what is already
// here. The app fetches the dashboard once after first paint and the modal
// paints that copy at once, then refreshes; each strategy's default chart
// is fetched behind it, spaced out, so a detail opens drawn.
/** @type {{ at: number, dash: any } | null} */
let agentsCache = null;
/** @type {Map<string, { at: number, chart: any }>} */
const chartCache = new Map();
const chartKey = (strategyId, symbol) => `${strategyId}|${symbol}`;

export function readAgentsCache() { return agentsCache; }
/** @param {string} strategyId @param {string} symbol */
export function readChartCache(strategyId, symbol) { return chartCache.get(chartKey(strategyId, symbol)) ?? null; }

/**
 * Warm the page: the dashboard, then one chart per strategy 250 ms apart.
 * Never throws — before login the call is a 401 and the cache stays empty.
 * @param {typeof fetch} [fetchImpl]
 * @param {(fn: () => void, ms: number) => unknown} [later]
 */
export async function prefetchAgentsDashboard(fetchImpl = fetch, later = (fn, ms) => setTimeout(fn, ms)) {
  let dash;
  try { dash = await fetchAgentsDashboard(fetchImpl); } catch { return null; }
  if (!dash || dash.notReady) return dash ?? null;
  // Every pair of every strategy, the held one first, 200 ms apart: a detail then opens drawn whichever tab is clicked.
  const wanted = [];
  for (const st of dash.strategies ?? []) {
    const first = defaultChartSymbol(st);
    for (const sym of [first, ...(st.symbols ?? []).filter((x) => x !== first)]) if (sym) wanted.push([st.id, sym]);
  }
  wanted.forEach(([id, sym], i) => { later(() => { fetchAgentsChart(id, sym, fetchImpl).catch(() => {}); }, 200 * (i + 1)); });
  return dash;
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
  if (!res.ok) throw agentsFetchError('log', res.status, text);
  return JSON.parse(text);
}

/**
 * More history for one strategy × symbol, for the detail chart: the signal
 * venue's candles over the rule's window, the fills, every order, the
 * decisions and the latest observation.
 * @param {string} strategyId
 * @param {string} symbol
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchAgentsChart(strategyId, symbol, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${EDGE_AGENTS_URL}?action=chart&strategy=${encodeURIComponent(strategyId)}&symbol=${encodeURIComponent(symbol)}`,
    { headers: headers() });
  const text = await res.text();
  if (!res.ok) throw agentsFetchError('chart', res.status, text);
  const chart = JSON.parse(text);
  if (chart && !chart.error) chartCache.set(chartKey(strategyId, symbol), { at: Date.now(), chart });
  return chart;
}

/** What each class of failure is called and what it means, in one plain sentence each. */
const ERROR_WORDS = {
  offline: {
    title: 'Could not reach the server',
    sentence: 'The request never got a reply, so the page has nothing to show — the strategies keep running on the server either way.',
  },
  auth: {
    title: 'Signed out',
    sentence: 'This browser is no longer signed in, so the server would not answer — reload the page and sign in again.',
  },
  missing: {
    title: 'Nothing there to read',
    sentence: 'The server has no record to answer this with, which usually means it has not been written yet.',
  },
  busy: {
    title: 'Too many requests',
    sentence: 'The server is being asked for too much at once — wait a moment and try again.',
  },
  server: {
    title: 'The server could not answer',
    sentence: 'The server failed while answering, so nothing could be read; this is the page failing to read, not the loop failing to run.',
  },
  client: {
    title: 'The request was refused',
    sentence: 'The server refused the request, so nothing was read.',
  },
};

/** The one-liner the card shows: the server's sentence with any JSON cut off it. @param {string} m */
export function shortErrorMessage(m) {
  const cut = String(m ?? '').split(/[{[]/)[0].trim().replace(/[\s:,\-–—]+$/, '');
  if (!cut) return '';
  return cut.length > 120 ? `${cut.slice(0, 119)}…` : cut;
}

/**
 * A failed agents call, as the error card reads it: what to call it, one
 * sentence a person can act on, the server's own line with the JSON cut
 * off, and the whole raw reply for the `<details>` underneath.
 *
 * Takes anything a `catch` can hand it — the error the fetchers throw, a
 * bare `Error`, a string, `null` — because a page that cannot show its
 * failure is worse than the failure.
 * @param {unknown} err
 * @returns {{ status: number | null, kind: keyof typeof ERROR_WORDS, title: string, sentence: string, message: string, short: string, detail: string }}
 */
export function agentsErrorView(err) {
  const e = /** @type {any} */ (err ?? {});
  const text = typeof err === 'string' ? err : String(e?.message ?? (err == null ? '' : err));
  const fromErr = Number(e?.status);
  const inText = /\b(\d{3})\b/.exec(text);
  const status = Number.isFinite(fromErr) && fromErr >= 100 ? fromErr : inText ? Number(inText[1]) : null;
  const body = typeof e?.body === 'string' ? e.body : '';
  const message = (typeof e?.serverMessage === 'string' && e.serverMessage)
    || parseAgentsErrorBody(body) || text || 'No details came back.';
  const kind = /** @type {keyof typeof ERROR_WORDS} */ (
    status == null ? 'offline'
      : status === 401 || status === 403 ? 'auth'
        : status === 404 ? 'missing'
          : status === 429 ? 'busy'
            : status >= 500 ? 'server' : 'client');
  const words = ERROR_WORDS[kind];
  return {
    status, kind, title: words.title, sentence: words.sentence, message,
    short: shortErrorMessage(message),
    detail: [text, body && body !== text ? body : null].filter(Boolean).join('\n'),
  };
}

const ONE_H = 3600e3, FOUR_H = 4 * 3600e3, ONE_D = 86400e3;

/** How long a strategy may go without a decision before its row stops claiming to run — two of its own bars, and a quarter of an hour for the minute rule, which holds far more bars than it trades. */
export const DECISION_STALE_MS = {
  'trend-4h': 2 * FOUR_H, 'trend-1h': 2 * ONE_H, 'momentum-1d': 2 * ONE_D, 'rotation-1d': 2 * ONE_D, 'dislocation-1m': 15 * 60e3,
};
/** An observation is written every minute; three minutes without one means the loop stopped. */
export const OBSERVATION_FRESH_MS = 3 * 60e3;

/**
 * The age of the newest thing the strategy has SEEN, across its symbols.
 * Observations land every minute on the forming bar, so this is the liveness
 * signal — a rule can legitimately go hours between decisions.
 * @param {any} s  a strategy from the dashboard payload
 * @param {number} nowMs
 */
export function observationAgeMs(s, nowMs) {
  let newest = null;
  for (const p of s?.positions ?? []) {
    const t = p?.observation?.ts ? Date.parse(p.observation.ts) : NaN;
    if (!isNaN(t) && (newest == null || t > newest)) newest = t;
  }
  return newest == null ? null : Math.max(0, nowMs - newest);
}

/**
 * Is the loop still running this strategy? A fresh observation says yes
 * outright: the tick writes one every minute whether or not the rule acts.
 * Without observations — an older row, or a database that has none yet — it
 * falls back to the decision clock, which allows two of the rule's own bars.
 * @param {{ mode: string, kind: string, lastDecision: { ts: string } | null, positions?: any[] }} s  the strategy row
 * @param {{ global_pause?: boolean } | null} risk
 * @param {number} nowMs
 * @returns {{ label: 'live' | 'paper' | 'paused', running: boolean, detail: string }}
 */
export function strategyStatus(s, risk, nowMs) {
  const label = /** @type {'live' | 'paper' | 'paused'} */ (s.mode === 'live' ? 'live' : s.mode === 'paused' ? 'paused' : 'paper');
  if (s.mode === 'paused') return { label, running: false, detail: 'paused' };
  if (risk?.global_pause) return { label, running: false, detail: 'global pause' };
  const obs = observationAgeMs(s, nowMs);
  if (obs != null && obs < OBSERVATION_FRESH_MS) return { label, running: true, detail: `watching · changed ${formatAgo(obs)} ago` };
  if (!s.lastDecision) return { label, running: false, detail: obs == null ? 'no decision yet' : `last reading ${formatAgo(obs)} ago` };
  const age = nowMs - Date.parse(s.lastDecision.ts);
  const stale = DECISION_STALE_MS[s.kind] ?? 2 * FOUR_H;
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
      nextText: nextDecisionText(s.kind, s.nextDecisionAt, nowMs),
      kindId: s.kind,
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
      unrealisedPct: Number(s.costUsd) > 0 ? ((s.unrealisedUsd ?? 0) / Number(s.costUsd)) * 100 : null,   // on the cost of what is held — the same base as the position tiles
      realisedPct: capital > 0 ? ((s.realisedUsd ?? 0) / capital) * 100 : null,                              // on the strategy's capital
      todayUsd: s.todayUsd ?? 0,
      todayPct: capital > 0 ? ((s.todayUsd ?? 0) / capital) * 100 : null,
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
 * What the "next" column says. A minute rule is always about to decide, so a
 * countdown to the next minute is noise — it decides every minute.
 * @param {string} kind
 * @param {string | null | undefined} iso
 * @param {number} nowMs
 */
export function nextDecisionText(kind, iso, nowMs) {
  return kind === 'dislocation-1m' ? 'every minute' : untilText(iso, nowMs).replace(/^in /, '');
}

/**
 * A gain or loss the way the home scoreboard writes one: "+$1,521 (+0.86%)".
 * The percent is omitted when there is no base to put it on.
 * @param {number | null | undefined} usd
 * @param {number | null | undefined} pct
 */
export function glText(usd, pct) {
  const money = fmtMoney(usd ?? 0, { signed: true, compact: false });
  return pct == null || !Number.isFinite(pct) ? money : `${money} (${fmtPctSigned(pct, 2)})`;
}

/**
 * The page's scoreboard: what the agents hold and have made, today and
 * in total, in the home scoreboard's cells. "Today" is the UTC calendar
 * day — realised since 00:00 plus the change in unrealised from the day's
 * opening price, the same figure the loop's daily loss limit reads.
 * Percentages are on the capital allotted (today, total, realised) or on
 * the cost of what is held (unrealised), and each cell says which.
 * @param {any} dash
 */
export function scoreboardView(dash) {
  const t = dash?.totals ?? {};
  const capital = (dash?.strategies ?? []).reduce((a, s) => a + (Number(s.capitalUsd) || 0), 0);
  const unrealised = t.unrealisedUsd ?? 0, realised = t.realisedUsd ?? 0, today = t.todayUsd ?? 0, cost = t.costUsd ?? 0, value = t.valueUsd ?? 0;
  const total = unrealised + realised;
  const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
  return {
    capitalUsd: capital, valueUsd: value, costUsd: cost, feesUsd: t.feesUsd ?? 0,
    todayUsd: today, todayPct: pct(today, capital),
    totalUsd: total, totalPct: pct(total, capital),
    unrealisedUsd: unrealised, unrealisedPct: pct(unrealised, cost),
    realisedUsd: realised, realisedPct: pct(realised, capital),
    liveRealisedUsd: t.byMode?.live?.realisedUsd ?? 0, paperRealisedUsd: t.byMode?.paper?.realisedUsd ?? 0,
    deployedPct: pct(value, capital),
    dayStart: dash?.dayStart ?? null,
  };
}

/** The same cells for one strategy. @param {any} s */
export function strategyScoreboard(s) {
  const capital = Number(s?.capitalUsd) || 0, cost = Number(s?.costUsd) || 0;
  const unrealised = s?.unrealisedUsd ?? 0, realised = s?.realisedUsd ?? 0, today = s?.todayUsd ?? 0, value = s?.valueUsd ?? 0;
  const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
  return {
    capitalUsd: capital, valueUsd: value, costUsd: cost, feesUsd: s?.feesUsd ?? 0,
    todayUsd: today, todayPct: pct(today, capital),
    totalUsd: unrealised + realised, totalPct: pct(unrealised + realised, capital),
    unrealisedUsd: unrealised, unrealisedPct: pct(unrealised, cost),
    realisedUsd: realised, realisedPct: pct(realised, capital),
    deployedPct: pct(value, capital),
  };
}

// ── What the rule is looking at right now ────────────────────────────────
// The tick writes one observation per strategy × symbol every minute: the
// same categorical words the decision would see, on the FORMING bar. It is
// what makes a 4-hour rule visibly alive between its decisions.

const STATE_LABELS = {
  trend_4h: 'trend 4h', trend_1h: 'trend 1h', trend: 'trend', trend_strength: 'strength',
  breakout: 'breakout', breakout_4h: 'breakout', volatility: 'volatility', momentum_30d: 'momentum 30d',
  position: 'position', unrealised: 'unrealised', time_in_position: 'held', drawdown: 'drawdown',
  basis: 'basis', basis_size: 'basis size', reference_move_5m: 'reference 5m', rank: 'rank',
};
const UP_WORDS = new Set(['up', 'positive', 'above_range', 'revx_cheap', 'long', 'gain']);
const DOWN_WORDS = new Set(['down', 'negative', 'below_range', 'revx_rich', 'loss']);
const WARN_WORDS = new Set(['high', 'extreme', 'sharp_up', 'sharp_down', 'large', 'wide']);

/** @param {string} k */
export const stateLabel = (k) => STATE_LABELS[k] ?? k.replace(/_/g, ' ');
/** @param {string} v */
export const stateTone = (v) => (UP_WORDS.has(v) ? 'up' : DOWN_WORDS.has(v) ? 'down' : WARN_WORDS.has(v) ? 'warn' : 'flat');

/** "seen 40 s ago" — the observation clock, which runs in seconds, not the decision clock. @param {number | null} ms */
export function observationAgeText(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return 'no reading yet';
  const s = Math.round(ms / 1000);
  if (s < 90) return `changed ${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `unchanged for ${m} min`;
  const h = Math.floor(m / 60);
  return `unchanged for ${h} h ${String(m % 60).padStart(2, '0')} min`;
}

/**
 * One observation as the detail renders it: the state words as pills, how old
 * the reading is, and the numbers behind it.
 * @param {{ ts: string, barStart?: string, state?: Record<string, unknown>, numbers?: Record<string, unknown> } | null | undefined} obs
 * @param {number} nowMs
 */
export function observationView(obs, nowMs) {
  if (!obs) return null;
  const t = Date.parse(obs.ts);
  const ageMs = isNaN(t) ? null : Math.max(0, nowMs - t);
  const pills = Object.entries(obs.state ?? {})
    .filter(([k, v]) => k !== 'symbol' && typeof v === 'string' && v !== '')
    .map(([k, v]) => ({ key: k, label: stateLabel(k), value: String(v).replace(/_/g, ' '), tone: stateTone(String(v)) }));
  const numbers = /** @type {Record<string, any>} */ (obs.numbers ?? {});
  return {
    ts: obs.ts, barStart: obs.barStart ?? null, ageMs, ageText: observationAgeText(ageMs),
    fresh: ageMs != null && ageMs < OBSERVATION_FRESH_MS, pills, numbers,
    basisBps: typeof numbers.basisBps === 'number' ? numbers.basisBps : null,
    mark: typeof numbers.mark === 'number' ? numbers.mark : typeof numbers.close === 'number' ? numbers.close : null,
  };
}

/** One live-state row per symbol, in the strategy's own symbol order. @param {any} s @param {number} nowMs */
export function liveStateRows(s, nowMs) {
  const bySymbol = new Map((s?.positions ?? []).map((p) => [p.symbol, p]));
  return (s?.symbols ?? []).map((symbol) => {
    const p = bySymbol.get(symbol) ?? null;
    return { symbol, base: p?.base ?? 0, observation: observationView(p?.observation ?? null, nowMs) };
  });
}

/** The symbol the detail opens on: what is held, else what has traded, else the first. @param {any} s */
export function defaultChartSymbol(s) {
  const positions = s?.positions ?? [];
  const held = positions.find((p) => Number(p.base) > 0);
  if (held) return held.symbol;
  const traded = positions.find((p) => Number(p.fills) > 0);
  if (traded) return traded.symbol;
  return (s?.symbols ?? [])[0] ?? null;
}

/**
 * The fills under the chart, newest first — the same events the chart marks,
 * read as a table.
 * @param {any} chart
 */
export function fillRows(chart) {
  return (chart?.fills ?? [])
    .map((f) => ({
      id: f.id, ts: f.ts, side: f.side, price: Number(f.price), base: Number(f.base),
      notionalUsd: Number(f.price) * Number(f.base), feeUsd: Number(f.feeUsd ?? 0),
      venue: f.venue, mode: f.mode, liquidity: f.marketable ? 'taker' : 'maker', decisionId: f.decisionId ?? null,
    }))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

/** The line under the fills table: how many, what they cost, what they made. @param {any} chart */
export function fillsSummary(chart) {
  const fills = chart?.fills ?? [];
  const buys = fills.filter((f) => f.side === 'buy').length;
  const pos = chart?.position ?? null;
  return {
    count: fills.length, buys, sells: fills.length - buys,
    feesUsd: fills.reduce((a, f) => a + Number(f.feeUsd ?? 0), 0),
    realisedUsd: Number(pos?.realisedUsd ?? 0),
    base: Number(pos?.base ?? 0), avgCost: Number(pos?.avgCost ?? 0),
    openOrders: (chart?.orders ?? []).filter((o) => o.state === 'new' || o.state === 'pending' || o.state === 'partially_filled').length,
    decisions: (chart?.decisions ?? []).length,
  };
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
      strategies: b.strategies ?? 0, live: b.live ?? 0, todayUsd: b.todayUsd ?? 0,
      balanceUsd: v.balances?.USD ?? null, balances: v.balances ?? null, canTrade: !!v.canTrade, feeBps: v.feeBps ?? null, note: v.note ?? null,
      share: useValue ? (totalValue > 0 ? value / totalValue : 0) : (totalCapital > 0 ? capital / totalCapital : 0),
      shareOf: useValue ? 'value' : 'capital',
    };
  });
}

/**
 * The share bar's segments. The visible label is the venue and its share
 * (a sliver carries no words); what the share is OF — deployed value, or
 * allotted capital while nothing is deployed — lives in the title only,
 * by the owner's choice.
 * @param {ReturnType<typeof venueRows>} rows
 */
export function shareSegments(rows) {
  const basis = rows?.[0]?.shareOf === 'capital' ? 'allotted capital' : 'deployed value';
  return (rows ?? []).map((r) => {
    const pct = Math.round(r.share * 100);
    const widthPct = Math.max(0, Math.min(100, r.share * 100));
    return {
      id: r.id, label: r.label, pct, widthPct,
      text: r.share < 0.12 ? '' : `${r.label} ${pct}%`,
      title: `${r.label}: ${pct}% of ${basis}`,
    };
  });
}

/**
 * Everything that stops an order being placed, as banner rows. A global
 * pause and a venue fault both mean NOTHING can trade, and neither may be
 * whispered in the same grey as a fee.
 * @param {any} dash
 */
export function agentsAlerts(dash) {
  const out = [];
  if (dash?.risk?.global_pause) {
    out.push({
      id: 'global-pause', tone: 'stop', label: 'Global pause',
      text: 'Every strategy is held. The loop keeps reading and recording; it places no order, on either venue, until the pause is lifted.',
    });
  }
  for (const v of dash?.venues ?? []) {
    if (!v?.id) continue;
    if (v.note) {
      out.push({ id: `venue-${v.id}`, tone: 'fault', label: `${venueLabel(v.id)} fault`, text: String(v.note) });
    } else if (v.canTrade === false && (dash?.strategies ?? []).some((s) => s?.venue === v.id && s?.mode === 'live')) {
      // Paper needs no key; a LIVE row on a venue without one is the fault worth a banner.
      out.push({
        id: `nokey-${v.id}`, tone: 'fault', label: `${venueLabel(v.id)} has no key`,
        text: `Nothing can trade on ${venueLabel(v.id)}: this deployment has no signing key for it, so its live strategies can only watch.`,
      });
    }
  }
  return out;
}

/**
 * What a strategy is actually holding, for the line under its realised
 * figure: a number in the header must not be the only live fact on a page
 * about a position.
 * @param {any} s
 */
export function positionLines(s) {
  return (s?.positions ?? [])
    .filter((p) => Number(p?.base) > 0)
    .map((p) => ({
      symbol: p.symbol,
      base: Number(p.base) || 0,
      avgCost: Number(p.avgCost) || 0,
      mark: Number(p.mark) || 0,
      valueUsd: Number(p.valueUsd) || 0,
      unrealisedUsd: Number(p.unrealisedUsd) || 0,
      returnPct: Number(p.costUsd) > 0 ? (Number(p.unrealisedUsd) / Number(p.costUsd)) * 100 : null,
      openedAt: p.openedAt != null ? Number(p.openedAt) : null,
    }));
}

const CURRENCY_SIGN = { USD: '$', GBP: '£', EUR: '€' };
/**
 * What an account holds, every currency the venue reported, non-zero
 * only, money first: a UK deposit that arrived as pounds must read as
 * pounds, not as a blank where dollars were expected.
 * @param {Record<string, number> | null | undefined} balances
 */
export function balanceLines(balances) {
  const order = (c) => (c === 'USD' ? 0 : c in CURRENCY_SIGN ? 1 : 2);
  /** @type {{ code: string, amount: number }[]} */
  const held = Object.entries(balances ?? {}).map(([code, v]) => ({ code: String(code), amount: Number(v) }));
  return held
    .filter((b) => Number.isFinite(b.amount) && Math.abs(b.amount) >= (b.code in CURRENCY_SIGN || /^USD[CT]$/.test(b.code) ? 0.005 : 1e-8))   // a fraction of a coin is money
    .sort((a, b) => order(a.code) - order(b.code) || a.code.localeCompare(b.code))
    .map((b) => {
      const sign = CURRENCY_SIGN[b.code];
      const text = sign ? `${sign}${b.amount.toFixed(2)} ${b.code}` : `${b.amount.toFixed(Math.abs(b.amount) >= 1 ? 4 : 6)} ${b.code}`;
      return { code: b.code, amount: b.amount, text };
    });
}

/**
 * A countdown to the second, for the detail page's header: "1h 12m 05s",
 * "12m 05s", "5s"; "due" once the moment has passed.
 * @param {string | null | undefined} iso
 * @param {number} nowMs
 */
export function countdownText(iso, nowMs) {
  if (!iso) return '—';
  const ms = Date.parse(iso) - nowMs;
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'due';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${two(mm)}m ${two(ss)}s`;
  if (mm > 0) return `${mm}m ${two(ss)}s`;
  return `${ss}s`;
}
