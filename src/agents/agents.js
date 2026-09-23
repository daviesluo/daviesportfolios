// Agents page — the pure half. Fetches the dashboard the `agents` Edge
// Function computes (positions and P&L are derived server-side from fills,
// in one place) and turns it into the rows the modal renders. Nothing here
// touches the DOM; `agents.test.js` pins the shaping.
import { SB_ANON, EDGE_AGENTS_URL } from '../app/supabase_config.js';
import { getAppToken } from '../app/auth.js';
import { fmtMoney, formatAgo } from '../app/formatters.js';

// Kraken keeps its label, not a place on the page: it is the signal venue every rule reads candles from, and nothing
// trades there since `0046`. VENUES shows Revolut X, where the loop executes, and Binance, the account it may use next.
export const VENUE_LABELS = { revx: 'Revolut X', binance: 'Binance', kraken: 'Kraken' };
export const KIND_LABELS = { 'trend-4h': 'Trend 4h', 'trend-1h': 'Trend 1h', 'momentum-1d': 'Momentum 30d', 'rotation-1d': 'Rotation', 'dislocation-1m': 'Dislocation' };
/** The two venue hues the badges, the share bar and the detail chart all share. Binance's is its own yellow, which is why PAPER is not gold any more. */
export const VENUE_HUES = { revx: '#8ec5ff', binance: '#f0b90b' };

/** @param {string} id */
export const venueLabel = (id) => VENUE_LABELS[id] ?? id;
/** The region the dashboard runs in: London, where Binance answers and the database lives. */
export const DASHBOARD_REGION = 'eu-west-2';
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
  const seq = dashGuard.start();
  // Pinned to London: the dashboard reads the Binance account, and Binance refuses the US regions a call routed by
  // distance could land in (451). A query parameter, not the `x-region` header, so the CORS preflight is unchanged.
  const res = await fetchImpl(`${EDGE_AGENTS_URL}?action=dashboard&forceFunctionRegion=${DASHBOARD_REGION}`, { headers: headers() });
  const text = await res.text();
  if (!res.ok) throw agentsFetchError('dashboard', res.status, text);
  const dash = JSON.parse(text);
  // The cache holds the NEWEST request's answer, whatever order the answers arrive in: the minute's refresh and a click
  // can be in flight together, and a slow older answer must not become what the next page opens on.
  if (dashGuard.isLatest(seq)) agentsCache = { at: Date.now(), dash };
  return dash;
}

/**
 * A request-ordering guard. Each `start()` is a newer request and only the
 * newest request's answer may be applied (`isLatest`). Two refreshes in
 * flight otherwise resolve in ARRIVAL order, and a slow older one would
 * overwrite a newer one on screen and in the cache.
 */
export function newestWins() {
  let latest = 0;
  return { start() { return ++latest; }, /** @param {number} id */ isLatest(id) { return id === latest; } };
}
const dashGuard = newestWins();

/**
 * A position, order or fill SIZE for a cell: six decimals, and masked with
 * the money when values are hidden — a size beside a mark is the value.
 * @param {number} base @param {(s: string) => string} [m]
 */
export function sizeText(base, m = (s) => s) { return m(Number(base).toFixed(6)); }

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
 * @returns {{ label: 'live' | 'paper' | 'paused', running: boolean, tone: 'running' | 'stale' | 'paused', detail: string }}
 */
export function strategyStatus(s, risk, nowMs) {
  const label = /** @type {'live' | 'paper' | 'paused'} */ (s.mode === 'live' ? 'live' : s.mode === 'paused' ? 'paused' : 'paper');
  // `tone` is the colour of the dot beside the name: green running, amber stale, grey paused. The words are in `detail`.
  if (s.mode === 'paused') return { label, running: false, tone: 'paused', detail: 'paused' };
  if (risk?.global_pause) return { label, running: false, tone: 'paused', detail: 'global pause' };
  const obs = observationAgeMs(s, nowMs);
  if (obs != null && obs < OBSERVATION_FRESH_MS) return { label, running: true, tone: 'running', detail: `watching · changed ${formatAgo(obs)} ago` };
  if (!s.lastDecision) return { label, running: false, tone: 'stale', detail: obs == null ? 'no decision yet' : `last reading ${formatAgo(obs)} ago` };
  const age = nowMs - Date.parse(s.lastDecision.ts);
  const stale = DECISION_STALE_MS[s.kind] ?? 2 * FOUR_H;
  if (age > stale) return { label, running: false, tone: 'stale', detail: `last decision ${formatAgo(age)} ago` };
  return { label, running: true, tone: 'running', detail: `decided ${formatAgo(age)} ago` };
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
  const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
  return {
    capitalUsd: capital, valueUsd: value, costUsd: cost, feesUsd: t.feesUsd ?? 0,
    todayUsd: today, todayPct: pct(today, capital),
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
 * The age of a reading as the LIVE STATE row prints it, one phrasing for
 * every row: "Last change: 3 mins ago". The dot's tooltip keeps the longer
 * wording; this is the one the eye scans down a column.
 * @param {number | null | undefined} ms
 */
export function lastChangeText(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return 'No reading yet';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `Last change: ${sec} secs ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `Last change: ${min} min${min === 1 ? '' : 's'} ago`;
  const h = Math.floor(min / 60);
  return `Last change: ${h}h ${String(min % 60).padStart(2, '0')}m ago`;
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

/**
 * The overview table, split the way the money is: what is trading real
 * money and what is only being measured. A paused row is being measured
 * too — it is not live — so it sits with the testing rows. Rendering an
 * empty half would be noise, so the page renders only the halves that
 * have rows in them, and with nothing live that is one table saying
 * TESTING, which is the honest headline.
 * @param {any[]} rows
 */
export function splitStrategyRows(rows) {
  const all = rows ?? [];
  return { live: all.filter((r) => r?.mode === 'live'), testing: all.filter((r) => r?.mode !== 'live') };
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
 * The orders under the chart, newest first — every order on THIS pair, which
 * is the one table that answers "what did it actually do and what did it
 * cost". It replaced a fills table and a decisions table that said the same
 * things twice over (2026-09-21). `more` is the full history the button
 * fetches: raw rows from `?action=log`, merged in and de-duplicated by id, so
 * loading it widens this table rather than opening another one.
 * @param {any} chart @param {{ orders?: any[] } | null} more @param {string | null} symbol
 */
export function symbolOrderRows(chart, more, symbol) {
  const byId = new Map();
  for (const o of chart?.orders ?? []) {
    byId.set(o.id, {
      id: o.id, ts: o.ts, side: o.side, state: o.state, price: Number(o.price), base: Number(o.base),
      fillPrice: null, costUsd: Number(o.price) * Number(o.base), feeUsd: 0,
      venue: o.venue, mode: o.mode, liquidity: o.marketable ? 'taker' : 'maker', filledAt: o.filledAt ?? null,
    });
  }
  // The fills carry what the order actually paid; the order rows do not.
  for (const f of chart?.fills ?? []) {
    const row = byId.get(f.id);
    if (!row) continue;
    row.fillPrice = Number(f.price);
    row.costUsd = Number(f.price) * Number(f.base);
    row.feeUsd = Number(f.feeUsd ?? 0);
  }
  for (const o of more?.orders ?? []) {
    if (symbol && o.symbol !== symbol) continue;
    if (byId.has(o.id)) continue;
    const v = orderView(o);
    byId.set(o.id, {
      id: v.id, ts: v.ts, side: v.side, state: v.state, price: v.price, base: v.base,
      fillPrice: v.fillPrice, costUsd: v.notionalUsd, feeUsd: v.feeUsd,
      venue: o.venue, mode: v.mode, liquidity: o.request?.marketable ? 'taker' : 'maker', filledAt: v.filledAt,
    });
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

/**
 * One row per venue for the split: what each account holds, has made and
 * is funded with, and its share of the book. Shares are of deployed value
 * when anything is deployed, else of allotted capital, so the bar always
 * says something.
 * @param {any} dash
 */
export function venueRows(dash) {
  const ids = ['revx', 'binance'];
  const by = dash?.byVenue ?? {};
  const venues = Object.fromEntries((dash?.venues ?? []).map((v) => [v.id, v]));
  const totalValue = ids.reduce((a, id) => a + (by[id]?.valueUsd ?? 0), 0);
  const totalCapital = ids.reduce((a, id) => a + (by[id]?.capitalUsd ?? 0), 0);
  const useValue = totalValue > 0;
  return ids.map((id) => {
    const b = by[id] ?? {};
    const v = venues[id] ?? {};
    const value = b.valueUsd ?? 0, capital = b.capitalUsd ?? 0, cost = b.costUsd ?? 0;
    const unrealised = b.unrealisedUsd ?? 0, realised = b.realisedUsd ?? 0, today = b.todayUsd ?? 0;
    const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
    return {
      id, label: venueLabel(id),
      capitalUsd: capital, valueUsd: value, costUsd: cost, unrealisedUsd: unrealised, realisedUsd: realised, feesUsd: b.feesUsd ?? 0,
      // The same bases as the scoreboard: unrealised on the cost of what is held, realised and today on the venue's paper capital.
      unrealisedPct: pct(unrealised, cost), realisedPct: pct(realised, capital), todayPct: pct(today, capital),
      strategies: b.strategies ?? 0, live: b.live ?? 0, todayUsd: today,
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
/** A live order written before the venue was called and unheard-of this long needs a person (reference §4.17, B1). */
export const PENDING_ALERT_MS = 2 * 60e3;

/**
 * @param {any} dash
 * @param {number} [now]
 */
export function agentsAlerts(dash, now = Date.now()) {
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
  const strategies = dash?.strategies ?? [];
  // A row trading real money, or still holding real coins under another label (`holdsLive`, the tick's book rule).
  const liveRows = strategies.filter((s) => s?.mode === 'live' || s?.holdsLive);
  if (liveRows.length && dash?.risk && !dash.risk.live_confirmed_at) {
    // Since 2026-09-22 the confirmation gates ENTRIES only: clearing it is how the buying is stopped, and the exits — the
    // floor and the rule's own — keep running. This used to say every live order was refused, which was once true and
    // would have left real coins with no way out; it must not tell the owner the exits are off when they are on.
    out.push({
      id: 'live-unconfirmed', tone: 'fault', label: 'Live not confirmed',
      text: `${liveRows.length} live ${liveRows.length === 1 ? 'row' : 'rows'}: live_confirmed_at is not set, so the loop refuses every live ENTRY until it is. The exits — the floor and the rule's own — still run.`,
    });
  }
  for (const s of strategies) {
    // A retired row that still holds something is WINDING DOWN, not stuck: since 2026-09-22 the tick
    // keeps running its floor and its rulebook's own exit and refuses every entry, and the dashboard
    // keeps it on the page until it is flat. Worth saying, because a row that has been switched off
    // and still holds money is not a state to leave unnoticed — but it is not a fault, and the text
    // said it was, back when a paused row really did get no stop at all.
    // Any row the tick is winding down — retired, paused, or relabelled away from coins it still holds (real ones
    // included) — plus a paused row the payload does not vouch for, which is the fault below.
    if (s?.mode !== 'paused' && !s?.windingDown) continue;
    const held = (s.positions ?? []).filter((p) => p?.base > 0).map((p) => p.symbol);
    if (!held.length) continue;
    const how = s.retiredAt ? 'Retired' : s.mode === 'paused' ? 'Paused' : `Set to ${s.mode}`;
    out.push(s.windingDown
      ? {
        id: `winding-down-${s.id}`, tone: 'paused', label: `${s.name ?? s.id} is winding down`,
        text: `${how} while holding ${held.join(', ')}. Its floor and its rule's own exit still run every minute and it can never buy again, so the position leaves when the rule or the floor says so. It stays on this page until it is flat.`,
      }
      : {
        // No `windingDown` flag: an older payload, or a paused row the tick is not covering. Treat it
        // as the fault it would be, rather than assuming the protection that flag is the evidence of.
        id: `paused-long-${s.id}`, tone: 'fault', label: `${s.name ?? s.id} is paused with a position`,
        text: `Holding ${held.join(', ')} while paused, and this payload does not say the loop is winding it down. Check that the tick is covering it; otherwise unwind it or unpause it.`,
      });
  }
  for (const s of strategies) {
    const stuck = (s?.recentOrders ?? []).filter((o) => o?.state === 'pending' && o?.mode === 'live' && now - Date.parse(o.ts) > PENDING_ALERT_MS);
    if (!stuck.length) continue;
    out.push({
      id: `pending-${s.id}`, tone: 'fault', label: `${s.name ?? s.id}: a live order needs a person`,
      text: `${stuck.length} live ${stuck.length === 1 ? 'order was' : 'orders were'} written before the venue was called and never heard back, and the venue does not list ${stuck.length === 1 ? 'it' : 'them'}: the outcome is unknown. Settle from the venue's own history — write the fill in, or mark it rejected. The loop will not guess.`,
    });
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
      costUsd: Number(p.costUsd) || 0,
      unrealisedUsd: Number(p.unrealisedUsd) || 0,
      returnPct: Number(p.costUsd) > 0 ? (Number(p.unrealisedUsd) / Number(p.costUsd)) * 100 : null,
      openedAt: p.openedAt != null ? Number(p.openedAt) : null,
    }));
}

/**
 * Whether what is shown is paper money only: every strategy (on `venue`, if one is named) is paper and holds no
 * live coins. A paused row keeps the book it traded in, so a paused row still holding live coins is not paper.
 * A venue card labels its funded figure "(Paper)" only while this holds, so the label cannot outlive the day a
 * row goes live. Deployed carries no label: one on funded says it (Davies, 2026-09-23).
 * @param {Array<{ venue?: string, mode?: string, holdsLive?: boolean }> | null | undefined} strategies
 * @param {string} [venue]
 */
export function paperOnly(strategies, venue) {
  return !(strategies ?? []).some((s) => (venue == null || s.venue === venue) && (s.mode === 'live' || !!s.holdsLive));
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
