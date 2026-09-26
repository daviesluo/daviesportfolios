// Agents page — the pure half. Fetches the dashboard the `agents` Edge
// Function computes (positions and P&L are derived server-side from fills,
// in one place) and turns it into the rows the modal renders. Nothing here
// touches the DOM; `agents.test.js` pins the shaping.
import { SB_ANON, EDGE_AGENTS_URL } from '../app/supabase_config.js';
import { getAppToken } from '../app/auth.js';
import { dropDot00, fmtMoney, formatAgo } from '../app/formatters.js';
import { Storage } from '../app/storage.js';

// Kraken keeps its label, not a place on the page: it is the signal venue every rule reads candles from, and nothing
// trades there since `0046`. VENUES shows Revolut X, where the loop executes, and Binance, the account it may use next.
// Polymarket is the venue of RW's paper test, a row of TESTING STRATEGIES; it has no card in VENUES.
export const VENUE_LABELS = { revx: 'Revolut X', binance: 'Binance', kraken: 'Kraken', polymarket: 'Polymarket' };
export const KIND_LABELS = { 'trend-4h': 'Trend 4h', 'trend-1h': 'Trend 1h', 'momentum-1d': 'Momentum 30d', 'rotation-1d': 'Rotation', 'dislocation-1m': 'Dislocation' };
/**
 * The venue hues the badges, the share bar and the detail chart all share. Binance's is its own yellow, which is why
 * PAPER is not gold any more. Polymarket's is its own blue, lifted for the dark page: ΔE 15.6 from Revolut X's with full
 * colour vision and 15.7 under deuteranopia, and further from Binance's, the gain green and the loss red (checked with
 * the dataviz validator, 2026-09-24). Every badge also says the venue's name.
 */
export const VENUE_HUES = { revx: '#8ec5ff', binance: '#f0b90b', polymarket: '#7d8bff' };

/** @param {string} id */
export const venueLabel = (id) => VENUE_LABELS[id] ?? id;
/** The region the dashboard runs in: London, where Binance answers and the database lives. */
export const DASHBOARD_REGION = 'eu-west-2';
/** @param {string} kind */
export const kindLabel = (kind) => KIND_LABELS[kind] ?? kind;
/** @param {string} id */
export const venueHue = (id) => VENUE_HUES[id] ?? 'rgba(244,239,227,0.6)';

/** Signed USD. A whole number of dollars is an integer ("$100", "$0"); cents stay ("+$1.50"). */
export const fmtUsd = (n, signed = false) => dropDot00(fmtMoney(n, { signed, compact: false }));

/** @param {number | null | undefined} n */
export const fmtPctSigned = (n, precision = 1) => (n == null || isNaN(n) ? '—' : dropDot00((n > 0 ? '+' : '') + n.toFixed(precision) + '%'));

/** Unsigned percent, two places, ".00" dropped when the rounded value is whole: 25 → "25%", 21.5 → "21.50%". @param {number | null | undefined} n */
export const fmtPct2 = (n) => (n == null || isNaN(n) ? '—' : dropDot00(Number(n).toFixed(2) + '%'));

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
  const request = (async () => {
    // Pinned to London: the dashboard reads the Binance account, and Binance refuses the US regions a call routed by
    // distance could land in (451). A query parameter, not the `x-region` header, so the CORS preflight is unchanged.
    const res = await fetchImpl(`${EDGE_AGENTS_URL}?action=dashboard&forceFunctionRegion=${DASHBOARD_REGION}`, { headers: headers() });
    const text = await res.text();
    if (!res.ok) throw agentsFetchError('dashboard', res.status, text);
    const dash = JSON.parse(text);
    // The cache holds the NEWEST request's answer, whatever order the answers arrive in: the minute's refresh and a click
    // can be in flight together, and a slow older answer must not become what the next page opens on.
    if (dashGuard.isLatest(seq)) { agentsCache = { at: Date.now(), dash }; keepPage(); }
    return dash;
  })();
  dashInFlight = request;
  try { return await request; } finally { if (dashInFlight === request) dashInFlight = null; }
}

/**
 * The newest dashboard request still on its way, or null. The page opening
 * while the app's own after-paint fetch is out joins it rather than asking
 * the slow dashboard call a second time.
 */
export function dashboardInFlight() { return dashInFlight; }
/** @type {Promise<any> | null} */
let dashInFlight = null;

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
//
// Memory alone left the first open after every reload on "Loading…" — the
// dashboard call is slow, and memory starts empty — and a click while the
// app's own fetch was still out asked a second time. So the page as it last
// drew is also kept in this browser (Storage.saveAgentsCache: the dashboard
// and the chart each strategy opens on), read back the first time anything
// asks, and a request already out is joined (`dashboardInFlight`). The kept
// copy is raw numbers; hide-values masks them at render like any other.
/** @type {{ at: number, dash: any } | null} */
let agentsCache = null;
/** @type {Map<string, { at: number, chart: any }>} */
const chartCache = new Map();
const chartKey = (strategyId, symbol) => `${strategyId}|${symbol}`;

// Read the kept copy into memory once, under anything fresher already there.
let keptRead = false;
function readKept() {
  if (keptRead) return;
  keptRead = true;
  const kept = Storage.loadAgentsCache();
  if (!kept) return;
  if (!agentsCache) agentsCache = { at: kept.at, dash: kept.dash };
  for (const [k, v] of Object.entries(kept.charts)) if (!chartCache.has(k)) chartCache.set(k, v);
}

// Write the page as it now stands: the dashboard, and for each strategy the
// chart its detail opens on. Batched, since the prefetch lands a chart every
// 200 ms.
/** @type {ReturnType<typeof setTimeout> | null} */
let keepTimer = null;
function keepPage() {
  if (keepTimer) return;
  keepTimer = setTimeout(() => {
    keepTimer = null;
    if (!agentsCache?.dash) return;
    /** @type {Record<string, { at: number, chart: any }>} */
    const charts = {};
    for (const st of agentsCache.dash.strategies ?? []) {
      const sym = defaultChartSymbol(st);
      const c = sym ? chartCache.get(chartKey(st.id, sym)) : null;
      if (c) charts[chartKey(st.id, sym)] = c;
    }
    Storage.saveAgentsCache({ at: agentsCache.at, dash: agentsCache.dash, charts });
  }, 250);
}

export function readAgentsCache() { readKept(); return agentsCache; }
/** @param {string} strategyId @param {string} symbol */
export function readChartCache(strategyId, symbol) { readKept(); return chartCache.get(chartKey(strategyId, symbol)) ?? null; }
/** Test hook: forget memory and read the kept copy again, as a reload would. */
export function _reloadAgentsCache() { agentsCache = null; chartCache.clear(); keptRead = false; dashInFlight = null; chartsInFlight.clear(); }

/**
 * Warm the page: the dashboard, then one chart per strategy 250 ms apart.
 * Never throws — before login the call is a 401 and the cache stays empty.
 * @param {typeof fetch} [fetchImpl]
 * @param {(fn: () => void, ms: number) => unknown} [later]
 */
export async function prefetchAgentsDashboard(fetchImpl = fetch, later = (fn, ms) => setTimeout(fn, ms)) {
  let dash;
  try { dash = await (dashboardInFlight() ?? fetchAgentsDashboard(fetchImpl)); } catch { return null; }
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
/**
 * How many newest orders "Load full history" asks for. The chart's `ordersMore`
 * is computed against this same count (`FULL_HISTORY_LIMIT` in `agents/index.ts`).
 */
export const FULL_HISTORY_LIMIT = 300;

/**
 * The button under the orders table. It is there only when the chart says the
 * log would add a row (`ordersMore`). An older server that does not say leaves
 * the button up. Once the log has been fetched, the button is gone.
 * @param {any} chart @param {any} more
 */
export function showFullHistory(chart, more) {
  if (more || !chart) return false;
  return chart.ordersMore !== false;
}

/** The limit the chart named, else {@link FULL_HISTORY_LIMIT}. @param {any} chart */
export function historyLimitOf(chart) {
  const n = Number(chart?.historyLimit);
  return Number.isFinite(n) && n > 0 ? Math.min(500, Math.floor(n)) : FULL_HISTORY_LIMIT;
}

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
  const key = chartKey(strategyId, symbol);
  // The same pair already on its way (the prefetch, or last minute's refresh) is joined, not asked again.
  const pending = chartsInFlight.get(key);
  if (pending) return pending;
  const request = (async () => {
    const res = await fetchImpl(
      `${EDGE_AGENTS_URL}?action=chart&strategy=${encodeURIComponent(strategyId)}&symbol=${encodeURIComponent(symbol)}`,
      { headers: headers() });
    const text = await res.text();
    if (!res.ok) throw agentsFetchError('chart', res.status, text);
    const chart = JSON.parse(text);
    if (chart && !chart.error) { chartCache.set(key, { at: Date.now(), chart }); keepPage(); }
    return chart;
  })();
  chartsInFlight.set(key, request);
  try { return await request; } finally { if (chartsInFlight.get(key) === request) chartsInFlight.delete(key); }
}
/** @type {Map<string, Promise<any>>} */
const chartsInFlight = new Map();

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
 * A strategy's name as the page writes it. The tab it sits on says LIVE, so a live row's name does not carry
 * " · live" as well (Davies, 2026-09-24); the row keeps its name in the database.
 * @param {{ name?: string, id?: string } | null | undefined} s
 */
export const strategyName = (s) => String(s?.name ?? s?.id ?? '').replace(/\s*·\s*live\s*$/i, '');

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
      name: strategyName(s),
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
      tab: strategyTab(s),
    };
  });
}

// ── The page's two tabs ──────────────────────────────────────────────────
// Davies, 2026-09-24: once a strategy trades real money, the page opens on two tabs at the top, LIVE and TESTING,
// with the live strategies and their figures kept apart from the ones still being measured. Everything a tab shows
// is worked out from the rows on that tab and nothing else, so its scoreboard, its venue cards and its table always
// add up to each other, and the two tabs together add up to the server's totals.

/** @typedef {'live' | 'testing'} AgentsTab */
/** The tabs, in the order the page draws them. @type {readonly AgentsTab[]} */
export const AGENT_TABS = /** @type {const} */ (['live', 'testing']);

/**
 * Whether a row has traded real money at all: a live-book line with fills, open or closed. A row's dollars add up
 * every book it has, so a live row that is paused or relabelled once flat still carries real realised dollars and
 * fees, and they are LIVE's; on TESTING they would be summed into the paper totals.
 * @param {{ positions?: any[], otherBooks?: any[] } | null | undefined} s
 */
const tradedLive = (s) => [...(s?.positions ?? []), ...(s?.otherBooks ?? [])].some((l) => l?.book === 'live' && Number(l?.fills) > 0);

/**
 * The tab a strategy row sits on. LIVE is real money: a row labelled live, one still holding real coins under
 * another label (`holdsLive`, the tick's own book rule — real coins outrank the label), or one that has traded real
 * money (`tradedLive`). Everything else, a paused row included, is being measured, and sits on TESTING.
 * @param {{ mode?: string, holdsLive?: boolean, positions?: any[], otherBooks?: any[] } | null | undefined} s
 * @returns {AgentsTab}
 */
export function strategyTab(s) {
  return s?.mode === 'live' || !!s?.holdsLive || tradedLive(s) ? 'live' : 'testing';
}

/** The dashboard's strategies on one tab, in the payload's order. @param {any} dash @param {AgentsTab} tab */
export function tabStrategies(dash, tab) {
  return (dash?.strategies ?? []).filter((/** @type {any} */ s) => strategyTab(s) === tab);
}

/** The tab the page opens on: LIVE while anything trades real money, else TESTING. @param {any} dash @returns {AgentsTab} */
export function defaultAgentsTab(dash) {
  return tabStrategies(dash, 'live').length > 0 ? 'live' : 'testing';
}

/**
 * Whether the live rows may buy. `live_confirmed_at` is one switch in `agent_risk` for every row labelled live: set,
 * the loop may open live positions (armed); unset, it refuses every live entry and the exits still run. A LIVE row
 * that is not labelled live can never buy, whatever the switch says: it is winding its real coins down, or, flat,
 * it is a record of real money that has stopped. The global pause outranks all of it, and is reported beside them
 * rather than folded in. `holding` says whether any LIVE row still holds real coins, which the exits will sell.
 * @param {any} dash
 * @returns {{ state: 'none' | 'winding' | 'stopped' | 'armed' | 'unarmed', since: string | null, paused: boolean, count: number, holding: boolean }}
 */
export function liveArming(dash) {
  const onLive = tabStrategies(dash, 'live');
  const labelled = onLive.filter((/** @type {any} */ s) => s?.mode === 'live').length;
  const holding = onLive.some((/** @type {any} */ s) => !!s?.holdsLive);
  const since = labelled > 0 ? dash?.risk?.live_confirmed_at ?? null : null;
  const state = onLive.length === 0 ? 'none' : labelled === 0 ? (holding ? 'winding' : 'stopped') : since ? 'armed' : 'unarmed';
  return { state, since, paused: !!dash?.risk?.global_pause, count: onLive.length, holding };
}

/** "1 strategy", "6 strategies". @param {number} n @param {string} one @param {string} many */
const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The tab bar's two entries: how many rows each tab lists and the one line that says what kind of money is on it.
 * TESTING's count takes in the paper tests' rows as well. Every row is called a strategy (Davies, 2026-09-25).
 * @param {any} dash
 * @param {number} tests  rows TESTING lists beyond the strategies: the paper tests (quotes, RW)
 */
export function agentsTabsView(dash, tests = 0) {
  const strategies = tabStrategies(dash, 'testing').length;
  const arming = liveArming(dash);
  // Plain words, for anyone reading the page (Davies, 2026-09-24): "armed" and "awaiting arming" were the loop's.
  // Unarmed, a row that holds coins is still selling them: its floor and its rule's exit run whatever the switch says.
  const liveWords = arming.state === 'none' ? 'Nothing is live'
    : arming.paused ? 'Real money · paused'
      : arming.state === 'stopped' ? 'Real money · stopped'
        : arming.state === 'winding' || (arming.state === 'unarmed' && arming.holding) ? 'Real money · selling what it holds'
          : arming.state === 'armed' ? 'Real money · trading' : 'Real money · not trading yet';
  const tone = arming.state === 'none' ? 'none' : arming.paused || arming.state === 'stopped' ? 'paused' : arming.state;
  return {
    live: { id: /** @type {AgentsTab} */ ('live'), label: 'LIVE', count: arming.count, text: liveWords, tone },
    testing: {
      id: /** @type {AgentsTab} */ ('testing'), label: 'TESTING', count: strategies + tests,
      text: `Paper · ${counted(strategies + tests, 'strategy', 'strategies')}`, tone: 'paper',
    },
  };
}

/**
 * What a percentage is of, in the words its label carries: "% of $360 capital". The same gain reads a different
 * percentage on a row, a venue card and a scoreboard, because each is on its own capital; the label says which.
 * @param {number} usd  the base
 * @param {string} what  "capital", "cost", "held"
 * @param {(s: string) => string} [m]  the page's mask
 */
export const pctOf = (usd, what, m = (s) => s) => `% of ${m(fmtUsd(usd))} ${what}`;

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
export const fmtBps = (n) => (n == null || isNaN(n) ? '—' : dropDot00(`${n > 0 ? '+' : ''}${n.toFixed(2)} bps`));

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
  const money = fmtUsd(usd ?? 0, true);
  return pct == null || !Number.isFinite(pct) ? money : `${money} (${fmtPctSigned(pct, 2)})`;
}

/**
 * What a set of strategy rows adds up to, summed in the payload's order — the sum `dashboard()` makes over the same
 * rows for its `totals` and `byVenue`, so over every row it is the server's figure to the last bit.
 * @param {any[]} strategies
 */
function sumRows(strategies) {
  const t = { capitalUsd: 0, costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0 };
  for (const s of strategies) {
    t.capitalUsd += Number(s.capitalUsd) || 0;
    t.costUsd += s.costUsd ?? 0;
    t.valueUsd += s.valueUsd ?? 0;
    t.unrealisedUsd += s.unrealisedUsd ?? 0;
    t.realisedUsd += s.realisedUsd ?? 0;
    t.feesUsd += s.feesUsd ?? 0;
    t.todayUsd += s.todayUsd ?? 0;
  }
  return t;
}

/**
 * A tab's scoreboard: what its strategies hold and have made, today and
 * in total, in the home scoreboard's cells. "Today" is the UTC calendar
 * day — realised since 00:00 plus the change in unrealised from the day's
 * opening price, the same figure the loop's daily loss limit reads.
 * Percentages are on the capital allotted (today, realised) or on the
 * cost of what is held (unrealised), and each cell says which. TESTING
 * also adds the paper tests (Davies, 2026-09-24: they count). A test's
 * unrealised is on what it has deployed, not on a cost, so that cell's
 * base is the strategies' cost plus the tests' deployed value, and the
 * label names both. Without a tab, and with no tests passed, it is every
 * strategy row, which is the server's `totals`.
 * @param {any} dash
 * @param {AgentsTab | null} [tab]
 * @param {any[]} [tests]  paper-test rows; counted only on TESTING
 */
export function scoreboardView(dash, tab = null, tests = []) {
  const rows = tab ? tabStrategies(dash, tab) : (dash?.strategies ?? []);
  const extra = tab === 'testing' ? tests : [];
  const t = sumRows([...rows, ...extra]);
  const capital = t.capitalUsd;
  const unrealised = t.unrealisedUsd, realised = t.realisedUsd, today = t.todayUsd, cost = t.costUsd, value = t.valueUsd;
  const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
  const unrealisedBase = cost + extra.reduce((a, s) => a + (s?.unrealisedOf === 'deployed' || s?.scoreDeployed ? (Number(s.valueUsd) || 0) : (Number(s.costUsd) || 0)), 0);
  return {
    strategies: rows.length, tests: extra.length,
    capitalUsd: capital, valueUsd: value, costUsd: cost, feesUsd: t.feesUsd,
    todayUsd: today, todayPct: pct(today, capital),
    unrealisedUsd: unrealised, unrealisedPct: pct(unrealised, extra.length ? unrealisedBase : cost),
    unrealisedBase, unrealisedOf: extra.length ? 'cost and deployed' : 'cost',
    realisedUsd: realised, realisedPct: pct(realised, capital),
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
 * The overview table, split the way the money is — one half per tab: what
 * is trading real money and what is only being measured (`strategyTab`).
 * A paused row is being measured too, so it sits with the testing rows,
 * unless it still holds real coins.
 * @param {any[]} rows  `strategyRows`' rows, which carry their tab
 */
export function splitStrategyRows(rows) {
  const all = rows ?? [];
  const tabOf = (/** @type {any} */ r) => r?.tab ?? strategyTab(r);
  return { live: all.filter((r) => tabOf(r) === 'live'), testing: all.filter((r) => tabOf(r) !== 'live') };
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

/** The venues VENUES draws a card for, in its order: Kraken is the signal venue only, and Polymarket has RW's row alone. */
const VENUE_CARD_IDS = ['revx', 'binance'];

/**
 * One card per venue a tab trades on: what its rows there hold, have made
 * and are allotted, and the venue's share of the tab. The figures are the
 * tab's rows summed by venue — the sum `dashboard()` makes for `byVenue`,
 * over this tab's rows alone — so a tab's cards add up to its scoreboard.
 * Shares are of deployed value when anything is deployed, else of
 * allotted capital, so the bar always says something. A venue the tab
 * reaches only through a paper test — Polymarket, through RW — gets a card
 * too (Davies, 2026-09-24), and that card is the test's own row. A test on
 * a venue that already has strategies is added to that card (Davies,
 * 2026-09-24: Stablecoin quotes counts on Revolut X). Reward quotes stays
 * on Polymarket: it is not Revolut X's money, and the cards still add up
 * to the scoreboard.
 * @param {any} dash
 * @param {AgentsTab | null} [tab]  null: every row, which is the server's `byVenue`
 * @param {any[]} [tests]  the paper tests' rows the tab lists (`quotesRow`, `rwRow`)
 */
export function venueRows(dash, tab = null, tests = []) {
  const rows = tab ? tabStrategies(dash, tab) : (dash?.strategies ?? []);
  const ids = VENUE_CARD_IDS.filter((id) => rows.some((/** @type {any} */ s) => s?.venue === id));
  const by = Object.fromEntries(ids.map((id) => {
    const on = rows.filter((/** @type {any} */ s) => s?.venue === id);
    const folded = tests.filter((t) => t?.venueId === id);
    const cost = on.reduce((a, s) => a + (s.costUsd ?? 0), 0);
    const deployed = folded.reduce((a, s) => a + (Number(s.valueUsd) || 0), 0);
    return [id, {
      ...sumRows([...on, ...folded]), strategies: on.length, tests: folded.length,
      live: on.filter((/** @type {any} */ s) => s.mode === 'live').length,
      unrealisedBase: folded.length ? cost + deployed : cost,
      unrealisedOf: folded.length ? 'cost and deployed' : 'cost',
    }];
  }));
  const venues = Object.fromEntries((dash?.venues ?? []).map((v) => [v.id, v]));
  const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
  const cards = ids.map((id) => {
    const b = by[id] ?? {};
    const v = venues[id] ?? {};
    const value = b.valueUsd ?? 0, capital = b.capitalUsd ?? 0, cost = b.costUsd ?? 0;
    const unrealised = b.unrealisedUsd ?? 0, realised = b.realisedUsd ?? 0, today = b.todayUsd ?? 0;
    return {
      id, label: venueLabel(id), test: /** @type {any} */ (null),
      capitalUsd: capital, valueUsd: value, costUsd: cost, unrealisedUsd: unrealised, realisedUsd: realised, feesUsd: /** @type {number | null} */ (b.feesUsd ?? 0),
      // The same bases as the scoreboard: unrealised on the cost of what is held, realised and today on the venue's capital on the tab.
      unrealisedPct: pct(unrealised, b.unrealisedBase ?? cost), realisedPct: pct(realised, capital), todayPct: pct(today, capital), deployedPct: pct(value, capital),
      unrealisedOf: b.unrealisedOf ?? 'cost',
      strategies: b.strategies ?? 0, tests: b.tests ?? 0, live: b.live ?? 0, todayUsd: today,
      apart: [],
      balanceUsd: v.balances?.USD ?? null, balances: v.balances ?? null, canTrade: !!v.canTrade, feeBps: v.feeBps ?? null, note: v.note ?? null,
    };
  });
  for (const t of tests) {
    if (!t?.venueId || ids.includes(t.venueId) || cards.some((c) => c.id === t.venueId)) continue;
    const capital = Number(t.capitalUsd) || 0, value = Number(t.valueUsd) || 0;
    cards.push({
      id: t.venueId, label: venueLabel(t.venueId), test: t,
      capitalUsd: capital, valueUsd: value, costUsd: 0, unrealisedUsd: t.unrealisedUsd ?? 0, realisedUsd: t.realisedUsd ?? 0, feesUsd: null,
      unrealisedPct: t.unrealisedPct ?? null, realisedPct: t.realisedPct ?? null, todayPct: t.todayPct ?? null, deployedPct: pct(value, capital),
      unrealisedOf: t.unrealisedOf ?? 'deployed',
      strategies: 0, tests: 1, live: 0, todayUsd: t.todayUsd ?? 0, apart: [],
      balanceUsd: null, balances: null, canTrade: false, feeBps: null, note: null,
    });
  }
  const totalValue = cards.reduce((a, c) => a + c.valueUsd, 0);
  const totalCapital = cards.reduce((a, c) => a + c.capitalUsd, 0);
  const useValue = totalValue > 0;
  return cards.map((c) => ({
    ...c,
    share: useValue ? c.valueUsd / totalValue : (totalCapital > 0 ? c.capitalUsd / totalCapital : 0),
    shareOf: useValue ? 'value' : 'capital',
  }));
}

/**
 * The share bar's segments. `text` is the venue and its share; the bar
 * itself drops the name when that line does not fit the slice and shows
 * the percent alone (Davies, 2026-09-25). A fixed cutoff clipped
 * "Polymarket" in the middle once the slice was still a bit wider than
 * the cutoff. Nothing at all stays blank. What the share is OF — deployed
 * value, or allotted capital while nothing is deployed — lives in the
 * title only.
 * @param {ReturnType<typeof venueRows>} rows
 */
export function shareSegments(rows) {
  const basis = rows?.[0]?.shareOf === 'capital' ? 'allotted capital' : 'deployed value';
  return (rows ?? []).map((r) => {
    const pct = Math.round(r.share * 100);
    const widthPct = Math.max(0, Math.min(100, r.share * 100));
    const full = pct <= 0 ? '' : `${r.label} ${pct}%`;
    return {
      id: r.id, label: r.label, pct, widthPct,
      text: full,
      short: pct <= 0 ? '' : `${pct}%`,
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
 * Each banner also names the tabs it belongs on (`tabs`): the global pause holds both; a venue fault shows wherever
 * that venue has a row; a live venue's missing key and a live order nobody heard back from are LIVE's; a row winding
 * down is on its own row's tab. The "live trading is not on yet" line is not a banner (Davies, 2026-09-25).
 * @param {any} dash
 * @param {number} [now]
 * @returns {Array<{ id: string, tone: string, label: string, text: string, tabs: AgentsTab[] }>}
 */
export function agentsAlerts(dash, now = Date.now()) {
  /** @type {Array<{ id: string, tone: string, label: string, text: string, tabs: AgentsTab[] }>} */
  const out = [];
  const strategies = dash?.strategies ?? [];
  /** @param {string} venue @returns {AgentsTab[]} */
  const venueTabs = (venue) => {
    const on = AGENT_TABS.filter((t) => strategies.some((/** @type {any} */ s) => s?.venue === venue && strategyTab(s) === t));
    return on.length ? on : [...AGENT_TABS];
  };
  if (dash?.risk?.global_pause) {
    out.push({
      id: 'global-pause', tone: 'stop', label: 'Global pause',
      text: 'Every strategy is held. The loop keeps reading and recording; it places no order, on either venue, until the pause is lifted.',
      tabs: [...AGENT_TABS],
    });
  }
  for (const v of dash?.venues ?? []) {
    if (!v?.id) continue;
    if (v.note) {
      out.push({ id: `venue-${v.id}`, tone: 'fault', label: `${venueLabel(v.id)} fault`, text: String(v.note), tabs: venueTabs(v.id) });
    } else if (v.canTrade === false && strategies.some((s) => s?.venue === v.id && s?.mode === 'live')) {
      // Paper needs no key; a LIVE row on a venue without one is the fault worth a banner.
      out.push({
        id: `nokey-${v.id}`, tone: 'fault', label: `${venueLabel(v.id)} has no key`,
        text: `Nothing can trade on ${venueLabel(v.id)}: this deployment has no signing key for it, so its live strategies can only watch.`,
        tabs: ['live'],
      });
    }
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
        id: `winding-down-${s.id}`, tone: 'paused', label: `${strategyName(s)} is winding down`,
        text: `${how} while holding ${held.join(', ')}. Its floor and its rule's own exit still run every minute and it can never buy again, so the position leaves when the rule or the floor says so. It stays on this page until it is flat.`,
        tabs: [strategyTab(s)],
      }
      : {
        // No `windingDown` flag: an older payload, or a paused row the tick is not covering. Treat it
        // as the fault it would be, rather than assuming the protection that flag is the evidence of.
        id: `paused-long-${s.id}`, tone: 'fault', label: `${strategyName(s)} is paused with a position`,
        text: `Holding ${held.join(', ')} while paused, and this payload does not say the loop is winding it down. Check that the tick is covering it; otherwise unwind it or unpause it.`,
        tabs: [strategyTab(s)],
      });
  }
  for (const s of strategies) {
    const stuck = (s?.recentOrders ?? []).filter((o) => o?.state === 'pending' && o?.mode === 'live' && now - Date.parse(o.ts) > PENDING_ALERT_MS);
    if (!stuck.length) continue;
    out.push({
      id: `pending-${s.id}`, tone: 'fault', label: `${strategyName(s)}: a live order needs a person`,
      text: `${stuck.length} live ${stuck.length === 1 ? 'order was' : 'orders were'} written before the venue was called and never heard back, and the venue does not list ${stuck.length === 1 ? 'it' : 'them'}: the outcome is unknown. Settle from the venue's own history — write the fill in, or mark it rejected. The loop will not guess.`,
      // Real money in an unknown state is shown whichever tab is open: the row it is on can be either.
      tabs: [...AGENT_TABS],
    });
  }
  return out;
}

/** The banners one tab shows. @param {any} dash @param {AgentsTab} tab @param {number} [now] */
export function alertsFor(dash, tab, now = Date.now()) {
  return agentsAlerts(dash, now).filter((a) => a.tabs.includes(tab));
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
 * The paper quote test's card (reference §4 item 31): PR5's 0 % quotes around interbank on Revolut X's USDC/GBP and
 * USDT/GBP books, run on paper from their own cron job. `q` is the dashboard's `quotes`; null keeps the card off the
 * page (its tables are not there yet, or it has never run).
 * @param {any} q
 */
export function quotesView(q) {
  if (!q) return null;
  const trips = Number(q.trips) || 0;
  return {
    running: !!q.running,
    stoppedText: q.running ? '' : `not running: its last decided minute is ${q.lagMinutes} min old`,
    since: q.startedAt ?? null,
    capitalUsd: q.capitalUsd, realisedUsd: q.realisedUsd, realisedPct: q.realisedPct, todayUsd: q.todayUsd, todayPct: q.todayPct,
    tripsText: trips ? `${trips} · ${Math.round((100 * (Number(q.won) || 0)) / trips)} % won` : '0',
    open: Number(q.open) || 0, openUsd: q.openUsd,
    ordersText: `${q.ordersToday} of 1,000 · ${q.fillsToday} filled`,
  };
}

/** The quote test's id among the table's rows. No strategy id starts with "__", so it cannot collide with one. */
export const QUOTES_ROW_ID = '__quotes';

/**
 * The quote test as a row of TESTING STRATEGIES (Davies, 2026-09-23), in the cells a strategy's row has. Its capital
 * is the $1,200 its quotes would lock; unrealised is its held rungs marked at each book's last print, as a percent of
 * what they hold (the strategies' base: the cost of what is held). null keeps it off the table.
 * @param {any} q  the dashboard's `quotes`
 */
export function quotesRow(q) {
  if (!q) return null;
  const openUsd = Number(q.openUsd) || 0;
  const unrealised = q.unrealisedUsd == null ? null : Number(q.unrealisedUsd);
  const v = /** @type {NonNullable<ReturnType<typeof quotesView>>} */ (quotesView(q));
  return {
    id: QUOTES_ROW_ID,
    name: 'Stablecoin quotes',
    venue: venueLabel('revx'),
    venueId: 'revx',
    mode: 'paper',
    // The scoreboard still folds what this test has deployed. The row does not
    // say "% of deployed": the other strategies' unrealised cells don't, and
    // the heading no longer carries a base either (Davies, 2026-09-25).
    scoreDeployed: true,
    capitalUsd: Number(q.capitalUsd) || 0,
    valueUsd: openUsd,
    todayUsd: q.todayUsd ?? 0, todayPct: q.todayPct ?? null,
    unrealisedUsd: unrealised ?? 0, unrealisedPct: unrealised != null && openUsd > 0 ? (unrealised / openUsd) * 100 : null,
    realisedUsd: q.realisedUsd ?? 0, realisedPct: q.realisedPct ?? null,
    nextText: 'every minute',
    openPositions: v.open,
    status: q.running
      ? { label: 'paper', running: true, tone: 'running', detail: `quoting · last minute decided ${Number(q.lagMinutes) || 0} min ago` }
      : { label: 'paper', running: false, tone: 'stale', detail: v.stoppedText },
  };
}

/** A price in GBP a coin, as the book quotes it: four places. @param {number | null | undefined} p */
export const fmtQuotePrice = (p) => (p == null || !Number.isFinite(Number(p)) ? '—' : `£${Number(p).toFixed(4)}`);

/**
 * One book's ladder for the quote test's page: a row per rung distance (0.1 / 0.2 / 0.3 % from interbank), its bid
 * and its ask. A rung is idle, quoting at a price, or holding what it filled (its entry, and its P&L at the last print).
 * @param {any} book  one of the dashboard's `quotes.books`
 */
export function quoteLadderRows(book) {
  const rungs = book?.rungs ?? [];
  const ks = [...new Set(rungs.map((r) => Number(r.k)).filter((k) => Number.isFinite(k)))].sort((a, b) => a - b);
  /** @param {any} r */
  const cell = (r) => {
    if (!r || r.mode === 'idle') return { state: 'idle', price: null, unrealisedUsd: null, heldSince: null };
    if (r.mode === 'position') return { state: 'held', price: r.entry ?? null, unrealisedUsd: r.unrealisedUsd ?? null, heldSince: r.heldSince ?? null };
    return { state: 'quoting', price: r.price ?? null, unrealisedUsd: null, heldSince: null };
  };
  return ks.map((k) => ({
    k,
    label: `${+(k * 100).toFixed(2)} %`,
    bid: cell(rungs.find((r) => r.side === 'bid' && Number(r.k) === k)),
    ask: cell(rungs.find((r) => r.side === 'ask' && Number(r.k) === k)),
  }));
}

/** A book's name as the page writes a pair: "USDC-GBP" → "USDC/GBP". @param {string} b */
export const quoteBookLabel = (b) => String(b ?? '').replace('-', '/');

/** RW's paper test's id among the table's rows. No strategy id starts with "__", so it cannot collide with one. */
export const RW_ROW_ID = '__rw';

/** A Polymarket price in cents, as the venue writes one: "49¢", "4.5¢". @param {number | null | undefined} p */
export function fmtCents(p) {
  if (p == null || !Number.isFinite(Number(p))) return '—';
  const c = Math.round(Number(p) * 1000) / 10;
  return `${Number.isInteger(c) ? c.toFixed(0) : c.toFixed(1)}¢`;
}

/**
 * A fill's shares on the Reward quotes page, to two decimal places. A whole
 * number is an integer ("20", not "20.00"). The venue's size is a long
 * float; the fills table does not print it raw.
 * @param {number | null | undefined} size
 */
export function rwShareText(size) {
  if (size == null) return '—';
  const n = Number(size);
  if (!Number.isFinite(n)) return '—';
  return dropDot00(n.toFixed(2));
}

/** What a market's inventory is, as a holder reads it: YES shares, or NO shares for a short YES. @param {number | null | undefined} net */
export function rwHeldText(net) {
  const x = Number(net) || 0;
  if (x === 0) return '—';
  const size = Math.abs(x);
  return `${dropDot00(size.toFixed(2))} ${x > 0 ? 'Yes' : 'No'}`;
}

/**
 * A total and the parts it is made of, to the cent, so that the parts as printed add up to the total as printed.
 * Each is rounded to the cent, and when the rounded parts miss the rounded total, each missing cent goes to the part
 * rounding moved furthest the other way (largest remainder): 55.754 + −21.527 = 34.227 prints 55.76 + −21.53 = 34.23,
 * where rounding each alone printed 55.75 and −21.53 beside 34.23. Only a rounding gap is closed: parts that miss their
 * total by half a cent or more are printed as they are, so a real disagreement still shows. Cents are what `fmtUsd`
 * prints below $1,000, which RW's figures stay far under.
 * @param {number} total
 * @param {number[]} parts  they add up to `total`, up to float
 * @returns {{ total: number, parts: number[] }}  dollars, each a whole number of cents
 */
export function splitCents(total, parts) {
  // Rounded by the formatter `fmtMoney` prints with, so a cent here is the cent on the page. Nothing else agrees with it:
  // `x * 100` rounds in binary first (283.965 × 100 = 28396.4999…), `toFixed` rounds the exact binary value (257.945 is
  // 257.94499…, "257.94") where `toLocaleString` rounds the shortest decimal ("257.95"), and Math.round takes −0.125 to
  // −0.12 where the page writes −0.13.
  const cents = (/** @type {number} */ x) => Math.sign(x) * Math.round(
    Number(Math.abs(x).toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 })) * 100);
  const T = cents(total);
  const c = parts.map(cents);
  const sum = (/** @type {number[]} */ xs) => xs.reduce((s, x) => s + x, 0);
  if (Math.abs(sum(parts) - total) < 0.005) {
    for (let d = T - sum(c); d !== 0; d = T - sum(c)) {
      const s = Math.sign(d);
      let k = 0;
      for (let i = 1; i < c.length; i++) if (s * (parts[i] * 100 - c[i]) > s * (parts[k] * 100 - c[k])) k = i;
      c[k] += s;
    }
  }
  return { total: T / 100, parts: c.map((x) => x / 100) };
}

/**
 * RW's P&L as its page and its row print it: the total, and both ways it splits — rewards and orders, realised and
 * unrealised — to the cent, from ONE split of the total into its three pieces: the rewards (all realised), what
 * closed orders made, and what open orders hold. So every printed part adds up to every printed total.
 * @param {any} r  the dashboard's `rw`
 */
export function rwSplit(r) {
  const reward = Number(r?.rewardUsd) || 0, realised = Number(r?.realisedUsd) || 0, unrealised = Number(r?.unrealisedUsd) || 0;
  const s = splitCents(Number(r?.totalUsd) || 0, [reward, realised - reward, unrealised]);
  const [rw, closed, open] = s.parts.map((x) => Math.round(x * 100));
  return {
    totalUsd: s.total, rewardUsd: rw / 100, ordersUsd: (closed + open) / 100,
    realisedUsd: (rw + closed) / 100, realisedOrdersUsd: closed / 100, unrealisedUsd: open / 100,
  };
}

/** Tiles under RW's status: the pessimistic total, how concentrated it is, markets quoting today, positions still held. @param {string} [_phase] */
export function rwBarTileKeys(_phase) {
  return ['WORST CASE', 'TOP SHARE', 'QUOTING TODAY', 'POSITIONS STILL HELD'];
}

/**
 * The UTC day still in progress, in the same columns as a closed day. Closed days are each the change since the
 * previous close of the same phase; this row is the snapshot minus those changes, so it does not repeat them.
 * Its total is the scoreboard's today (`todayUsd`). Costs are the capital at work now, a level, as on a closed day.
 * @param {any} r  the dashboard's `rw`
 * @param {string | number | null | undefined} [at]  when the page was read; the day's label
 */
export function rwTodayRow(r, at) {
  if (!r) return null;
  const phase = r.phase;
  const closed = (r.days ?? []).filter((d) => d.phase === phase);
  const sum = (/** @type {string} */ k) => closed.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const stamp = at || r.lastMinute || new Date().toISOString();
  const ms = Date.parse(String(stamp));
  const day = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  return {
    day, phase, live: true,
    totalUsd: Number(r.todayUsd) || 0,
    stressUsd: (Number(r.stressUsd) || 0) - sum('stressUsd'),
    rewardUsd: (Number(r.rewardUsd) || 0) - sum('rewardUsd'),
    fills: (Number(r.fills) || 0) - sum('fills'),
    capitalUsd: Number(r.capitalUsd) || 0,
  };
}

/**
 * Cost of RW's open inventory, the same base a strategy's unrealised percent uses. A long Yes is shares × its
 * average Yes price; a short Yes is long No, so its cost is shares × (1 − that price).
 * @param {any[] | null | undefined} markets
 */
export function rwInventoryCost(markets) {
  let cost = 0;
  for (const x of markets ?? []) {
    const net = Number(x?.net) || 0;
    const avg = Number(x?.avgCost);
    if (!net || !Number.isFinite(avg)) continue;
    cost += net > 0 ? net * avg : -net * (1 - avg);
  }
  return cost;
}

/**
 * RW's paper test (reference §4 item 36): minimum-size quotes on both sides of Polymarket's rewarded markets, a
 * portfolio re-chosen each UTC day, run on paper for fourteen days after a warm-up. `r` is the dashboard's `rw`; null
 * keeps it off the page (its tables are not there yet, or it has no state). The total, its rewards and its orders
 * come from `rwSplit`, the same split `rwRow` prints realised and unrealised from.
 * @param {any} r
 */
export function rwView(r) {
  if (!r) return null;
  const total = Number(r.totalUsd) || 0, best = r.bestMarketUsd == null ? null : Number(r.bestMarketUsd);
  const s = rwSplit(r);
  const days = r.runStart && r.runEnd ? Math.round((Date.parse(r.runEnd) - Date.parse(r.runStart)) / 86400e3) : 14;
  return {
    totalUsd: s.totalUsd, rewardUsd: s.rewardUsd, ordersUsd: s.ordersUsd,
    dayOfRun: r.phase === 'run' ? Number(r.dayOfRun) || null : null, days,
    phase: r.phase,
    phaseText: r.phase === 'warm-up' ? 'warm-up, counted nowhere' : r.phase === 'run' ? `day ${r.dayOfRun} of 14` : 'the fourteen days are over',
    runStart: r.runStart, runEnd: r.runEnd, since: r.startedAt ?? null,
    stoppedText: r.finished ? 'the fourteen days are over' : r.running ? '' : `not running: its last decided minute is ${r.lagMinutes} min old`,
    fillsText: `${Number(r.fills) || 0} of 100`,
    bestShareText: best != null && total > 0 ? `${Math.round((100 * best) / total)} %` : '—',
    mismatch: Math.abs(Number(r.mismatchUsd) || 0) > 0.01,
  };
}

/**
 * RW as a row of TESTING STRATEGIES (Davies, 2026-09-24), in the cells a strategy's row has. Its capital is what its
 * markets have at work today (each market's first quote and its largest inventory, the spec's capital); unrealised is
 * the open inventory at the adjusted mid against its average cost, as a percent of what it holds; realised is the
 * rewards and what closed trades made. Realised and unrealised come to the cent from `rwSplit`, against the total
 * RW's page prints beside them, so wherever the two show they add up to it; the split is on the row too, for the page's
 * rewards-and-orders lines and the Polymarket card. null keeps it off the table.
 * @param {any} r  the dashboard's `rw`
 */
export function rwRow(r) {
  if (!r) return null;
  const capital = Number(r.capitalUsd) || 0, held = Number(r.heldUsd) || 0;
  const pct = (usd, base) => (base > 0 ? (Number(usd) / base) * 100 : null);
  const quoting = Number(r.quoting) || 0;
  const split = rwSplit(r);
  return {
    id: RW_ROW_ID,
    name: 'Reward quotes',
    venue: venueLabel('polymarket'),
    venueId: 'polymarket',
    mode: 'paper',
    // The scoreboard still folds what this test has deployed. The row's own percent is of inventory cost, like every
    // other strategy's unrealised (Davies, 2026-09-25).
    scoreDeployed: true,
    capitalUsd: capital,
    valueUsd: held,
    todayUsd: r.todayUsd ?? 0, todayPct: pct(r.todayUsd ?? 0, capital),
    unrealisedUsd: split.unrealisedUsd, unrealisedPct: pct(split.unrealisedUsd, rwInventoryCost(r.markets)),
    realisedUsd: split.realisedUsd, realisedPct: pct(split.realisedUsd, capital),
    rewards: { realisedUsd: split.rewardUsd, unrealisedUsd: 0 },
    orders: { realisedUsd: split.realisedOrdersUsd, unrealisedUsd: split.unrealisedUsd },
    nextText: r.finished ? 'finished' : 'every minute',
    openPositions: Number(r.open) || 0,
    status: r.finished
      ? { label: 'paper', running: false, tone: 'paused', detail: 'the fourteen days are over' }
      : r.running
        ? { label: 'paper', running: true, tone: 'running', detail: `quoting ${quoting} market${quoting === 1 ? '' : 's'} · last minute decided ${Number(r.lagMinutes) || 0} min ago` }
        : { label: 'paper', running: false, tone: 'stale', detail: `not running: its last decided minute is ${r.lagMinutes} min old` },
  };
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
