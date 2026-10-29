// Agents page — the pure half. Fetches the dashboard the `agents` Edge
// Function computes (positions and P&L are derived server-side from fills,
// in one place) and turns it into the rows the modal renders. Nothing here
// touches the DOM; `agents.test.js` pins the shaping.
import { SB_ANON, EDGE_AGENTS_URL } from '../app/supabase_config.js';
import { getAppToken, noteAuthStatus } from '../app/auth.js';
import { dropDot00, fmtMoney, formatAgo } from '../app/formatters.js';
import { Storage } from '../app/storage.js';
import { ukTzAbbr } from '../prices/market_hours.js';
import { fmtChartStamp } from './agents_chart.js';

// Kraken keeps its label, not a place on the page: it is the signal venue every rule reads candles from, and nothing
// trades there since `0046`. VENUES shows Revolut X, where the loop executes, and Binance, the account it may use next.
// Polymarket is the venue of RW's paper test, a row of TESTING STRATEGIES; it has no card in VENUES.
export const VENUE_LABELS = { revx: 'Revolut X', binance: 'Binance', kraken: 'Kraken', polymarket: 'Polymarket', coinbase: 'Coinbase', okx: 'OKX', ig: 'IG', hyperliquid: 'Hyperliquid' };
export const KIND_LABELS = { 'trend-4h': 'Trend 4h', 'trend-1h': 'Trend 1h', 'momentum-1d': 'Momentum 30d', 'rotation-1d': 'Rotation', 'dislocation-1m': 'Dislocation' };
/**
 * The venue hues the badges, the share bar and the detail chart all share. Binance's is its own yellow, which is why
 * PAPER is not gold any more. Polymarket's is its own blue, lifted for the dark page: ΔE 15.6 from Revolut X's with full
 * colour vision and 15.7 under deuteranopia, and further from Binance's, the gain green and the loss red (checked with
 * the dataviz validator, 2026-09-24). Every badge also says the venue's name. Coinbase's is its blue, deeper than
 * Revolut X's, and Hyperliquid's its own mint (Davies, 2026-10-29: "hyperliquid ... 应该是他们的主题绿才对 ... Coinbase应该改成他们的主题蓝").
 * Coinbase's brand #0052ff is 3.3:1 on the page, too dark for its badge's text (and the 35 % slice it was drawn as only 1.5:1), so its
 * hue is that blue lifted to 4.5:1, #4d8bff. The share bar's slices are these hues at one alpha, 0.35 (styles.css).
 */
export const VENUE_HUES = { revx: '#8ec5ff', binance: '#f0b90b', polymarket: '#7d8bff', coinbase: '#4d8bff', okx: '#dfe3ea', ig: '#d6a2e8', hyperliquid: '#97fce4' };

/** @param {string} id */
export const venueLabel = (id) => VENUE_LABELS[id] ?? id;
/** The region the dashboard runs in: London, where the database lives (and where Binance answers, for a Binance row). */
export const DASHBOARD_REGION = 'eu-west-2';
/** @param {string} kind */
export const kindLabel = (kind) => KIND_LABELS[kind] ?? kind;
/** @param {string} id */
export const venueHue = (id) => VENUE_HUES[id] ?? 'rgba(244,239,227,0.6)';

/** Signed USD. A whole number of dollars is an integer ("$100", "$0"); cents stay ("+$1.50"). */
export const fmtUsd = (n, signed = false) => dropDot00(fmtMoney(n, { signed, compact: false }));

/**
 * Signed USD to four places, for one trip's or one rung's P&L on the quote pages, where the price beside it has four
 * too (Davies, 2026-09-26: a $1.72 round trip that made +$0.0023 read "$0" to the cent). Zero is still "$0".
 * @param {number | null | undefined} n
 */
export const fmtUsd4 = (n) => {
  const s = fmtMoney(n, { signed: true, compact: false, precision: 4 });
  return /^[+-]?\$0[.,]0000$/.test(s) ? '$0' : s;
};

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

/**
 * The error a failed agents call throws: the status and the body ride along. A 401 is this browser's token lapsing,
 * which signs it out and returns the app to its login form rather than showing an error card (Davies, 2026-09-27).
 * @param {string} scope @param {number} status @param {string} text
 */
function agentsFetchError(scope, status, text) {
  noteAuthStatus(status);
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
    // Pinned to London, beside the database it reads. It once read the Binance account too, which refuses the US
    // regions a call routed by distance could land in (451); since `0065` it holds no Binance key and asks Binance only
    // for the marks of a Binance row, and there is none. A query parameter, not the `x-region` header, so the CORS
    // preflight is unchanged.
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
export function _reloadAgentsCache() { agentsCache = null; chartCache.clear(); keptRead = false; dashInFlight = null; chartsInFlight.clear(); chartSeq.clear(); }

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

/**
 * "Polymarket analyst"'s JOURNAL, ten entries a click (Davies, 2026-10-29: "…JOURNAL也默认只显示前10条，然后加个和上面days类似的按钮叫"Load
 * more"，然后每点一次多加载10条"): the page shows this many at first and this many more a click.
 */
export const GROKPM_JOURNAL_STEP = 10;
/**
 * Older journal entries than the page holds, from the server (`?action=grokpmjournal`, `readGrokPmJournal`): those at or
 * before `before` less the ids the page already has at that instant (`skip`), newest first, at most `limit`.
 * @param {string} before
 * @param {string[]} skip
 * @param {number} [limit]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ journal: any[], more: boolean }>}
 */
export async function fetchGrokPmJournal(before, skip, limit = GROKPM_JOURNAL_STEP, fetchImpl = fetch) {
  const q = `action=grokpmjournal&before=${encodeURIComponent(before)}&skip=${skip.map(encodeURIComponent).join(',')}&limit=${limit}`;
  const res = await fetchImpl(`${EDGE_AGENTS_URL}?${q}`, { headers: headers() });
  const text = await res.text();
  if (!res.ok) throw agentsFetchError('grokpmjournal', res.status, text);
  const body = JSON.parse(text);
  if (!Array.isArray(body?.journal)) throw agentsFetchError('grokpmjournal', res.status, text);
  return { journal: body.journal, more: !!body.more };
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
 * @param {boolean} [fresh] a click on the page's refresh: ask anew, never join a request sent before the click
 */
export async function fetchAgentsChart(strategyId, symbol, fetchImpl = fetch, fresh = false) {
  const key = chartKey(strategyId, symbol);
  // The same pair already on its way (the prefetch, a tab's first draw, or last minute's refresh) is joined, not asked
  // again — except by a click, which asks anew, as the dashboard's does (`load(true)` in agents.jsx). Joining there
  // answered the click with a request sent before it, and asked the server nothing (2026-10-08: the sweep's refresh
  // check read "chart 25→25" whenever the chart a tab had asked for was still on its way when the dashboard answered).
  const pending = fresh ? null : chartsInFlight.get(key);
  if (pending) return pending;
  const seq = (chartSeq.get(key) ?? 0) + 1;
  chartSeq.set(key, seq);
  const request = (async () => {
    const res = await fetchImpl(
      `${EDGE_AGENTS_URL}?action=chart&strategy=${encodeURIComponent(strategyId)}&symbol=${encodeURIComponent(symbol)}`,
      { headers: headers() });
    const text = await res.text();
    if (!res.ok) throw agentsFetchError('chart', res.status, text);
    const chart = JSON.parse(text);
    // Only the newest request for the pair writes the cache: the one a click overtook may answer after it.
    if (chart && !chart.error && chartSeq.get(key) === seq) { chartCache.set(key, { at: Date.now(), chart }); keepPage(); }
    return chart;
  })();
  chartsInFlight.set(key, request);
  try { return await request; } finally { if (chartsInFlight.get(key) === request) chartsInFlight.delete(key); }
}
/** @type {Map<string, Promise<any>>} */
const chartsInFlight = new Map();
/** The newest request sent for each pair, by count. @type {Map<string, number>} */
const chartSeq = new Map();

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
  return tabStrategies(dash, 'live').length > 0 || liveExtraRows(dash).length > 0 ? 'live' : 'testing';
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

/**
 * The tab bar's two entries: how many rows each tab lists and the one line that says what kind of money is on it.
 * TESTING's count takes in the paper tests' rows as well. Every row is called a strategy (Davies, 2026-09-25).
 * @param {any} dash
 * @param {number} tests  rows TESTING lists beyond the strategies: the paper tests (quotes, RW)
 */
export function agentsTabsView(dash, tests = 0) {
  const strategies = tabStrategies(dash, 'testing').length;
  const arming = liveArming(dash);
  // PR5's live executor and live-prep's live book are LIVE rows of their own once they trade real money
  // (`liveExtraRows`); with no strategy on LIVE, their own switches and what they hold say what kind of money is on the tab.
  const extras = liveExtraRows(dash);
  // Plain words, for anyone reading the page (Davies, 2026-09-24): "armed" and "awaiting arming" were the loop's.
  // Unarmed, a row that holds coins is still selling them: its floor and its rule's exit run whatever the switch says.
  const extraState = !extras.length ? 'none' : extras.some((r) => r.armed) ? 'armed' : extras.some((r) => r.holdsLive) ? 'winding' : 'unarmed';
  const state = arming.state === 'none' ? extraState : arming.state;
  const holding = arming.state === 'none' ? extras.some((r) => r.holdsLive) : arming.holding;
  const liveWords = state === 'none' ? 'Nothing is live'
    : arming.paused ? 'Real money · paused'
      : state === 'stopped' ? 'Real money · stopped'
        : state === 'winding' || (state === 'unarmed' && holding) ? 'Real money · selling what it holds'
          : state === 'armed' ? 'Real money · trading' : 'Real money · not trading yet';
  const tone = state === 'none' ? 'none' : arming.paused || state === 'stopped' ? 'paused' : state;
  return {
    live: { id: /** @type {AgentsTab} */ ('live'), label: 'LIVE', count: arming.count + extras.length, text: liveWords, tone },
    testing: {
      // The count is beside the label, so the line is the kind of money alone (Davies, 2026-09-27: "上面已经有9了").
      id: /** @type {AgentsTab} */ ('testing'), label: 'TESTING', count: strategies + tests, text: 'Paper', tone: 'paper',
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
/** A venue's fees, each named (Davies, 2026-09-27): "maker 0% / taker 0.09%". @param {{ maker: number, taker: number } | null | undefined} bps */
export const fmtFees = (bps) => (bps ? `maker ${bps.maker / 100}% / taker ${bps.taker / 100}%` : '—');

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
 * Money in a row's own currency (Davies, 2026-10-01: the stablecoin quotes trade pounds, so their pages and rows are in
 * pounds; a tab's scoreboard and the venue cards add every row up in dollars). "USD" unless the row says "GBP".
 * @param {number | null | undefined} n @param {string | undefined} ccy @param {boolean} [signed]
 */
export const fmtIn = (n, ccy, signed = false) => (ccy === 'GBP' ? fmtGbp(n, signed) : fmtUsd(n, signed));

/** `glText` in a row's own currency: "+£1.52 (+0.13%)". @param {number | null | undefined} n @param {number | null | undefined} pct @param {string | undefined} ccy */
export function glTextIn(n, pct, ccy) {
  const money = fmtIn(n ?? 0, ccy, true);
  return pct == null || !Number.isFinite(pct) ? money : `${money} (${fmtPctSigned(pct, 2)})`;
}

/**
 * What a row shows, in its own currency: its capital, deployed, today, unrealised and realised with their percents, and
 * its fees. A row in pounds carries them as `gbp`; every other row shows its dollars, which are also what the tab's
 * scoreboard adds up for every row.
 * @param {any} r
 */
/**
 * The Stablecoin quotes pages' DAYS heading figure (Davies, 2026-10-09: "在每个stablecoin quotes子页面（live+testings）的days
 * 表格标题days旁边加上近七天平均年化收益率"): what the seven calendar days before today realised, over the row's capital, a year
 * of them. Calendar days, not rows: a day with no order has no row (a weekend, an outage) and earned nothing, so seven
 * rows could span nine days and overstate the rate by 9/7 (it did, 2026-10-09). A row younger than seven days is read over
 * the days since its first. Each day is read over the capital it ran on, where its row carries one (`capitalGbp`, LIVE's
 * since 0145: Davies, 2026-10-27, LIVE £120 → £600), and over the row's capital where it does not: the mean of the days'
 * returns, so a week at £120 is not divided by £600. null without a closed day or a capital.
 * @param {Array<{ day: string, realisedGbp: number, capitalGbp?: number | null }>} days  the page's rows, any order
 * @param {number | null | undefined} capitalGbp
 * @param {number} nowMs
 * @returns {number | null} percent a year
 */
export function quoteDaysAnnualPct(days, capitalGbp, nowMs) {
  const cap = Number(capitalGbp);
  if (!(cap > 0) || !days?.length) return null;
  const DAY = 86400e3, todayMs = Math.floor(nowMs / DAY) * DAY;
  const { from, today } = quoteDaysWindow(nowMs);
  const first = days.reduce((m, d) => (d.day < m ? d.day : m), days[0].day);
  const start = first > from ? first : from;
  const n = Math.round((todayMs - Date.parse(`${start}T00:00:00Z`)) / DAY);
  if (!(n > 0)) return null;
  const capOf = (d) => (Number(d.capitalGbp) > 0 ? Number(d.capitalGbp) : cap);
  const sum = days.filter((d) => d.day >= start && d.day < today).reduce((s, d) => s + (Number(d.realisedGbp) || 0) / capOf(d), 0);
  return sum * (365 / n) * 100;
}

/**
 * The seven closed UTC days `quoteDaysAnnualPct` reads, as the day strings that bound them: a row is in the window when
 * `from <= day < today`. One definition, so DAYS' default rows (`quoteDaysRecent`) and its heading figure always agree.
 * @param {number} nowMs
 * @returns {{ from: string, today: string }}
 */
export function quoteDaysWindow(nowMs) {
  const DAY = 86400e3, todayMs = Math.floor(nowMs / DAY) * DAY;
  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(todayMs - 7 * DAY), today: iso(todayMs) };
}

/**
 * The rows DAYS shows by default (Davies, 2026-10-28: "DAYS ... 只显示最近7天", then "keep today's open row visible"): today's
 * open row, which he reads daily, and exactly the closed rows the 7-day figure sums, in the page's order. "Load full
 * history" shows the rest. A page with no closed row in the window (a young row, a long outage) shows all of them.
 * @template {{ day: string }} D
 * @param {D[]} days
 * @param {number} nowMs
 * @returns {D[]}
 */
export function quoteDaysRecent(days, nowMs) {
  const { from, today } = quoteDaysWindow(nowMs);
  const recent = days.filter((d) => d.day >= from && d.day <= today);
  return recent.some((d) => d.day < today) ? recent : days;
}

/**
 * What DAYS' heading figure is called, and what its tooltip says it measures (Davies, 2026-10-26: "网页显示“7-day annualised
 * +64.9%”，怎么这么高？是有问题吗？"). The figure (`quoteDaysAnnualPct`) is the round trips realised, simple-annualised: the coins
 * a book holds are not marked into it, so a week whose GBP/USD moved against them reads higher than the account grew, and
 * a strong week (the first live weekend, 2026-10-23 → 25) reads as a year of such weeks. It was labelled "7-day annualised",
 * which reads as the account's return; the label now names it, and the tooltip says the rest.
 */
export const QUOTE_DAYS_ANNUAL_LABEL = '7-day realised, annualised';
/**
 * "Polymarket analyst"'s DAYS heading figure (Davies, 2026-10-29: "Polymarket analyst策略页面里的days和Stablecoin quotes的live页面一样在days
 * 旁边加上…"): the same helper and window as the quote pages (`quoteDaysAnnualPct`), over each day's realised from the record
 * (`grokpm_view.ts`: the day's P&L less the change in what its open positions are marked at) and FUNDED, the $100 budget, as
 * LIVE's is over its capital, the money put in, not its equity. Null before the start.
 * @param {any} g  the dashboard's `grokPm`
 * @param {number} nowMs
 */
export function grokPmDaysAnnualPct(g, nowMs) {
  if (!g?.started) return null;
  return quoteDaysAnnualPct(grokPmDaysRealised(g.days), g.fundedUsd, nowMs);
}
/**
 * GROKPM's days in the quote helpers' shape: each day's realised as `realisedGbp`, which those helpers read in the row's own
 * currency (dollars here). A day the record cannot split yet (null) counts nothing.
 * @param {any[] | null | undefined} days
 */
export function grokPmDaysRealised(days) {
  return (days ?? []).map((d) => ({ ...d, realisedGbp: d.realisedUsd ?? 0 }));
}
export const GROKPM_DAYS_ANNUAL_TITLE = 'Realised over the last seven closed UTC days (its trades closed and its markets resolved), over FUNDED, times 365 / 7 (simple). '
  + 'What it still holds is not marked into it (UNREALIZED G/L shows it), and one week is a short sample.';
export const QUOTE_DAYS_ANNUAL_TITLE = 'Round trips realised over the last seven closed UTC days, each over the capital it ran on, times 365 / 7 (simple). '
  + 'The coins held are not marked into it (UNREALIZED G/L shows them), and one week is a short sample.';

export function rowMoney(r) {
  if (r?.ccy === 'GBP' && r.gbp) return { ccy: 'GBP', ...r.gbp };
  return {
    ccy: 'USD', capital: r.capitalUsd, value: r.valueUsd, today: r.todayUsd, todayPct: r.todayPct, unrealised: r.unrealisedUsd,
    unrealisedPct: r.unrealisedPct, realised: r.realisedUsd, realisedPct: r.realisedPct, fees: r.feesUsd ?? null,
  };
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
  // The rows a tab adds beyond its strategies: TESTING's paper tests, LIVE's live executor. Only the caller knows which.
  const extra = tab ? tests : [];
  const t = sumRows([...rows, ...extra]);
  const capital = t.capitalUsd;
  const unrealised = t.unrealisedUsd, realised = t.realisedUsd, today = t.todayUsd, cost = t.costUsd, value = t.valueUsd;
  const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
  // A paper test's unrealised is on what it holds (`heldUsd`: the stablecoin quotes' deployed also counts their quoting
  // rungs, Davies 2026-10-01) or else on what it has deployed; a row with a cost of its own (the live executor) is on its
  // cost, which `cost` already holds.
  const unrealisedBase = cost + extra.reduce((a, s) => a + (s?.unrealisedOf === 'deployed' || s?.scoreDeployed ? (Number(s.heldUsd ?? s.valueUsd) || 0) - (Number(s.costUsd) || 0) : 0), 0);
  return {
    strategies: rows.length, tests: extra.length,
    capitalUsd: capital, valueUsd: value, costUsd: cost, feesUsd: t.feesUsd,
    todayUsd: today, todayPct: pct(today, capital),
    unrealisedUsd: unrealised, unrealisedPct: pct(unrealised, extra.length ? unrealisedBase : cost),
    unrealisedBase, unrealisedOf: extra.some((s) => s?.unrealisedOf === 'deployed' || s?.scoreDeployed) ? 'cost and deployed' : 'cost',
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
 * @param {any[]} [tests]  the paper tests' rows the tab lists (`quotesTwinRow`, `rwRow`)
 */
export function venueRows(dash, tab = null, tests = []) {
  const rows = tab ? tabStrategies(dash, tab) : (dash?.strategies ?? []);
  const ids = VENUE_CARD_IDS.filter((id) => rows.some((/** @type {any} */ s) => s?.venue === id));
  const by = Object.fromEntries(ids.map((id) => {
    const on = rows.filter((/** @type {any} */ s) => s?.venue === id);
    const folded = tests.filter((t) => t?.venueId === id);
    // As the scoreboard: a paper test's unrealised is on what it has deployed, a row with a cost of its own on its cost.
    const isDeployed = (/** @type {any} */ t) => t?.unrealisedOf === 'deployed' || !!t?.scoreDeployed;
    const cost = [...on, ...folded.filter((t) => !isDeployed(t))].reduce((a, s) => a + (Number(s.costUsd) || 0), 0);
    const deployed = folded.filter(isDeployed).reduce((a, s) => a + (Number(s.heldUsd ?? s.valueUsd) || 0), 0);
    return [id, {
      ...sumRows([...on, ...folded]), strategies: on.length, tests: folded.length,
      live: [...on, ...folded].filter((/** @type {any} */ s) => s.mode === 'live').length,
      // Paper only while no row on it, a strategy or a folded book, trades real money (`paperOnly`).
      paper: paperOnly(on, id) && folded.every((t) => t?.mode !== 'live'),
      unrealisedBase: cost + deployed,
      unrealisedOf: folded.some(isDeployed) ? 'cost and deployed' : 'cost',
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
      id, label: venueLabel(id), test: /** @type {any} */ (null), paper: !!b.paper,
      capitalUsd: capital, valueUsd: value, costUsd: cost, unrealisedUsd: unrealised, realisedUsd: realised, feesUsd: /** @type {number | null} */ (b.feesUsd ?? 0),
      // The same bases as the scoreboard: unrealised on the cost of what is held, realised and today on the venue's capital on the tab.
      unrealisedPct: pct(unrealised, b.unrealisedBase ?? cost), realisedPct: pct(realised, capital), todayPct: pct(today, capital), deployedPct: pct(value, capital),
      unrealisedOf: b.unrealisedOf ?? 'cost',
      strategies: b.strategies ?? 0, tests: b.tests ?? 0, live: b.live ?? 0, todayUsd: today,
      apart: [],
      balanceUsd: v.balances?.USD ?? null, balances: v.balances ?? null, canTrade: !!v.canTrade, feeBps: v.feeBps ?? null, note: v.note ?? null,
    };
  });
  // A venue no strategy trades on is its paper tests' card, every test on it summed: Polymarket carries RW and RW-E
  // since 2026-09-26, and its card must read what TESTING's scoreboard adds for it (the first version kept the first
  // test's card and dropped the second). On LIVE it is the card of the real-money books folded there (live-prep's on
  // Polymarket since 2026-10-09): not paper, its cost and fees its own.
  for (const id of [...new Set(tests.map((t) => t?.venueId).filter((x) => x && !ids.includes(x)))]) {
    const ts = tests.filter((t) => t?.venueId === id);
    const sum = (/** @type {(t: any) => unknown} */ f) => ts.reduce((a, t) => a + (Number(f(t)) || 0), 0);
    const live = ts.filter((t) => t?.mode === 'live');
    const capital = sum((t) => t.capitalUsd), value = sum((t) => t.valueUsd);
    const unrealised = sum((t) => t.unrealisedUsd), realised = sum((t) => t.realisedUsd), today = sum((t) => t.todayUsd);
    // Each test's unrealised percent is on its own base (RW's: what its inventory cost); the card's, on those summed.
    const base = sum((t) => t.unrealisedBaseUsd);
    const test = ts.length === 1 ? ts[0] : {
      venueId: id,
      ...(ts.every((t) => t.rewards && t.orders) ? {
        rewards: { realisedUsd: sum((t) => t.rewards.realisedUsd), unrealisedUsd: sum((t) => t.rewards.unrealisedUsd) },
        orders: { realisedUsd: sum((t) => t.orders.realisedUsd), unrealisedUsd: sum((t) => t.orders.unrealisedUsd) },
      } : {}),
    };
    cards.push({
      id, label: venueLabel(id), test, paper: live.length === 0,
      capitalUsd: capital, valueUsd: value, costUsd: live.reduce((a, t) => a + (Number(t.costUsd) || 0), 0), unrealisedUsd: unrealised, realisedUsd: realised,
      // Its fees line, as LIVE's card has it, once any row on it says what its fills paid: the rows' fees summed.
      feesUsd: ts.some((t) => t?.feesUsd != null) ? sum((t) => t.feesUsd) : null,
      unrealisedPct: ts.length === 1 ? ts[0].unrealisedPct ?? null : pct(unrealised, base), realisedPct: pct(realised, capital), todayPct: pct(today, capital),
      deployedPct: pct(value, capital),
      unrealisedOf: ts[0]?.unrealisedOf ?? 'deployed',
      strategies: 0, tests: ts.length, live: live.length, todayUsd: today, apart: [],
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
  const ql = dash?.quotes?.live;
  if (ql?.pending?.length) {
    const n = ql.pending.length;
    out.push({
      id: 'pending-quotes-live', tone: 'fault', label: 'Stablecoin quotes: a live order needs a person',
      text: `${n} live ${n === 1 ? 'order was' : 'orders were'} written before Revolut X was called and never heard back, and the venue does not list ${n === 1 ? 'it' : 'them'}: the outcome is unknown. Settle from the venue's own history — write the fill in, or mark it rejected. The executor will not guess, and that rung places nothing until then.`,
      tabs: [...AGENT_TABS],
    });
  }
  if (ql?.tradedLive && ql?.lossStopped) {
    out.push({
      id: 'loss-stop-quotes-live', tone: 'paused', label: 'Stablecoin quotes stopped for the day',
      text: "Today's loss reached its limit (1 % of its capital): no new live quotes until 00:00 UTC. What it holds is still sold by its exits and its 24-hour stop.",
      tabs: ['live'],
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
 * A strategy name split for the table. "Stablecoin quotes variant-N" is two lines, the first the whole of
 * "Stablecoin quotes". A trailing parenthetical, "Reward quotes (no same-day)", stays on its own second line.
 * Anything else, including "Reward quotes variant-1", is one line.
 * @param {string} name
 * @returns {{ head: string, qual: string | null, twoLines: boolean }}
 */
export function strategyNameParts(name) {
  // The stablecoin quotes' variants, Coinbase's "with Euros" (Davies, 2026-10-10) and the LIVE twin (0136, 2026-10-21), on two
  // lines in the same run.
  const variant = /^(Stablecoin quotes) (variant-\d+|with Euros(?: - \d+)?|LIVE twin)$/.exec(name);
  if (variant) return { head: variant[1], qual: variant[2], twoLines: true };
  const q = /^(.*\S)\s+(\([^()]*\))$/.exec(name);
  if (q) return { head: q[1], qual: q[2], twoLines: false };
  return { head: name, qual: null, twoLines: false };
}

/**
 * The cells a book of the live executor's code has on a strategy row: the live account's (`quotesLiveRow`) and each
 * realistic twin's (`quotesTwinRow`), the one reading of `quotesLiveSummary`. Its fills per rung, in USD at the paper
 * books' last GBP/USD for the scoreboard; unrealised on the cost of what it holds, realised and today on its capital
 * (today is the figure its own daily loss stop reads); and the same in pounds, the book's own, which its row and page show.
 * @param {any} q  `quotes.live`, or one of `quotesTwins`
 */
function quoteBookCells(q) {
  const capital = Number(q.capitalUsd) || 0, cost = Number(q.costUsd) || 0;
  /** @param {unknown} usd @param {number} base */
  const pct = (usd, base) => (base > 0 && usd != null ? (Number(usd) / base) * 100 : null);
  return {
    capitalUsd: capital, costUsd: cost, valueUsd: Number(q.valueUsd) || 0, feesUsd: Number(q.feesUsd) || 0,
    todayUsd: Number(q.todayUsd) || 0, todayPct: pct(q.todayUsd, capital),
    unrealisedUsd: Number(q.unrealisedUsd) || 0, unrealisedPct: pct(q.unrealisedUsd, cost),
    realisedUsd: Number(q.realisedUsd) || 0, realisedPct: pct(q.realisedUsd, capital),
    // In pounds, as every stablecoin row, unless the payload says dollars (Davies, 2026-10-29: "C，coinbase的也是改用美元": the
    // OKX and Coinbase rows, `ccy` "USD"); its dollars are the fields above.
    ccy: q.ccy === 'USD' ? 'USD' : 'GBP',
    gbp: {
      capital: Number(q.capitalGbp) || 0, value: Number(q.valueGbp) || 0,
      today: Number(q.todayGbp) || 0, todayPct: pct(q.todayGbp, Number(q.capitalGbp) || 0),
      unrealised: Number(q.unrealisedGbp) || 0, unrealisedPct: pct(q.unrealisedGbp, Number(q.costGbp) || 0),
      realised: Number(q.realisedGbp) || 0, realisedPct: pct(q.realisedGbp, Number(q.capitalGbp) || 0),
      fees: Number(q.feesGbp) || 0,
    },
    nextText: 'every minute',
    openPositions: Number(q.heldRungs) || 0, openOrders: Number(q.openOrders) || 0,
  };
}

/** A trip's, a rung's or a day's P&L to four places in a row's currency (`fmtGbp4`, `fmtUsd4`). @param {number | null | undefined} n @param {string | undefined} ccy */
export const fmtIn4 = (n, ccy) => (ccy === 'USD' ? fmtUsd4(n) : fmtGbp4(n));
/** A fee to four places in a row's currency (`fmtFeeGbp4`; dollars unsigned the same way). @param {number | null | undefined} n @param {string | undefined} ccy */
export const fmtFeeIn4 = (n, ccy) => {
  if (ccy !== 'USD') return fmtFeeGbp4(n);
  const s = fmtMoney(n, { compact: false, precision: 4 });
  return /^\$0[.,]0000$/.test(s) ? '$0' : s;
};

/**
 * A quote page's detail in its row's currency: for a row in dollars (`ccy` "USD", the OKX and Coinbase rows since 2026-10-29),
 * each money figure its pages draw from `*Gbp` fields (a book's realised, a held rung's unrealised, a day's realised, a trip's
 * P&L and fees) is replaced by the payload's dollars beside it, so the pages draw one field in the row's currency; a row in
 * pounds comes back as it is. Prices, sizes and counts are never touched.
 * @param {any} q  a quote row's payload (`quotes.live`, a twin, a Coinbase or OKX arm)
 */
export function quotesDetailInCcy(q) {
  if (q?.ccy !== 'USD' || !q.detail) return q;
  const d = q.detail;
  const pick = (/** @type {unknown} */ usd, /** @type {unknown} */ gbp) => (usd != null ? usd : gbp);
  return {
    ...q,
    detail: {
      ...d,
      books: (d.books ?? []).map((/** @type {any} */ b) => ({ ...b, realisedGbp: pick(b.realisedUsd, b.realisedGbp) })),
      rungs: (d.rungs ?? []).map((/** @type {any} */ r) => (r.held ? { ...r, held: { ...r.held, unrealisedGbp: pick(r.held.unrealisedUsd, r.held.unrealisedGbp), costGbp: pick(r.held.costUsd, r.held.costGbp) } } : r)),
      days: (d.days ?? []).map((/** @type {any} */ x) => ({ ...x, realisedGbp: pick(x.realisedUsd, x.realisedGbp) })),
      trips: (d.trips ?? []).map((/** @type {any} */ t) => ({ ...t, pnlGbp: pick(t.pnlUsd, t.pnlGbp), feesGbp: pick(t.feesUsd, t.feesGbp) })),
    },
  };
}

/** A realistic twin's id among TESTING's rows: this, and its own id (`pr5`, `p50`, `d`). */
export const QUOTES_TWIN_ROW_PREFIX = '__quotes_twin_';

/**
 * A realistic twin of the live executor as a row of TESTING (`quotes_twin.ts`, 0087; Davies, 2026-10-02: "确保一致，确保
 * 真实"): the live executor's own code on a simulated Revolut X account, carrying out the decisions of one paper engine
 * at the twin's size, read and summed exactly as the live account is. "Stablecoin quotes" follows PR5's rule;
 * "Stablecoin quotes variant-1" PR5's rule at £50 a rung (`p50`, 0088, 2026-10-03); "Stablecoin quotes variant-3" rule
 * D's arm d (Davies, 2026-10-03: "…原来的variant-1改名为variant-3"). Paper money, so on TESTING. null keeps it off the
 * table (its record not loaded yet).
 * @param {any} t  one of the dashboard's `quotesTwins`
 */
export function quotesTwinRow(t) {
  if (!t?.twin) return null;
  const tw = t.twin;
  return {
    id: `${QUOTES_TWIN_ROW_PREFIX}${tw.id}`,
    name: String(tw.name),
    venue: venueLabel('revx'),
    venueId: 'revx',
    mode: 'paper',
    ...quoteBookCells(t),
    status: t.running
      ? { label: 'paper', running: true, tone: 'running', detail: `the live code on a simulated account · last turn ${Number(t.lagMinutes) || 0} min ago` }
      : { label: 'paper', running: false, tone: 'stale', detail: tw.mode === 'catch-up' && tw.lastTurn ? `catching up: its record stands at ${fmtChartStamp(tw.lastTurn)}` : `its last turn was ${t.lagMinutes ?? '?'} min ago` },
  };
}

/** The twins' rows, in the payload's order. @param {any} dash */
export const quotesTwinRows = (dash) => (dash?.quotesTwins ?? []).map(quotesTwinRow).filter(Boolean);

/** The base Coinbase test's id among TESTING's rows ("Stablecoin quotes with Euros" until 2026-10-29, when it left the page:
 * the dashboard no longer sends it, Davies: "coinbase quotes with euros删了吧…"; "Stablecoin quotes Coinbase" until 2026-10-10). */
export const QUOTES_COINBASE_ROW_ID = '__quotes_coinbase';
/** The weekend variant's id among TESTING's rows (`cb_hold.ts`, 0118): "Stablecoin quotes with Euros" since 2026-10-29 ("- 2", then "- 1", before). */
export const QUOTES_COINBASE_HOLD_ROW_ID = '__quotes_coinbase_hold';
/** The twin id the weekend variant's payload carries (`CB_HOLD_ID` in `cb_hold.ts`). */
const COINBASE_HOLD_TWIN_ID = 'coinbasehold';
/** The USDC arm's id among TESTING's rows (`cb_usdc.ts`, 0142): "Stablecoin quotes with Euros - 1" since 2026-10-29 ("- 2" before). */
export const QUOTES_COINBASE_USDC_ROW_ID = '__quotes_coinbase_usdc';
/** The twin id the USDC arm's payload carries (`CB_USDC_ID` in `cb_usdc.ts`). */
const COINBASE_USDC_TWIN_ID = 'coinbaseusdc';
/** The nudged USDC-GBP arm's id among TESTING's rows (`cb_nudge.ts`, 0168): "Stablecoin quotes with Euros - 2" since 2026-10-29 ("- 3" before). */
export const QUOTES_COINBASE_NUDGE_ROW_ID = '__quotes_coinbase_nudge';
/** The twin id its payload carries (`CB_NUDGE_ID` in `cb_nudge.ts`). */
const COINBASE_NUDGE_TWIN_ID = 'coinbasenudge';

/**
 * "Stablecoin quotes with Euros" as a row of TESTING (`cb_quotes.ts`, 0112; Davies, 2026-10-10: "先建起来吧，并且和Revolute X
 * 对比看哪个更好", and its name, place and size: "测试名字就叫Stablecoin quotes - with Euro吧，列表里放在Stablecoin quotes
 * variant-3 后面，每一档100磅/100欧元", then "策略名字也改为Stablecoin quotes with Euros"): PR5's rule on paper on Coinbase's four GBP and EUR stablecoin books, from its
 * recorder's prints, in a twin's shape and in pounds (£1,200 + €1,200), so it reads beside the twins and LIVE on Revolut X;
 * `paperTestRows` puts it right after the last twin, "Stablecoin quotes variant-3". null before it has decided a minute.
 * "Stablecoin quotes with Euros - 2" (`cb_hold.ts`, 0118; Davies, 2026-10-13: "周末变体写预注册然后上线paper trading 策略with Euros
 * - 2") is the same row for the weekend variant: the same test with the interbank rates held through a closure, right after
 * the first (`paperTestRows`), the dashboard's `quotesCoinbaseHold`, `twin.id` `coinbasehold`; "with Euros - 1" since 0142.
 * "Stablecoin quotes with Euros - 2" since 0142 (`cb_usdc.ts`; Davies, 2026-10-26: "…-2改为你说的这个新策略在-1（含周末）的基础上做")
 * is the same row for the USDC arm, right after "- 1": the weekend variant's rule on the two USDC books at 25 a rung, the
 * dashboard's `quotesCoinbaseUsdc`, `twin.id` `coinbaseusdc` ($50 a rung since its Deviation 2). "Stablecoin quotes with Euros - 3"
 * (`cb_nudge.ts`, 0168; Davies, 2026-10-29: "建USDC 那个线索，在with euro-2的基础上开-3，只做300美元的USDC-GBP") is the same row right
 * after "- 2": its rule on USDC-GBP alone at $50 a rung, the fair nudged by Revolut X's book, `quotesCoinbaseNudge`, `coinbasenudge`.
 * @param {any} q  the dashboard's `quotesCoinbase`, `quotesCoinbaseHold`, `quotesCoinbaseUsdc` or `quotesCoinbaseNudge`
 */
export function quotesCoinbaseRow(q) {
  if (!q?.twin) return null;
  const hold = q.twin.id === COINBASE_HOLD_TWIN_ID, usdc = q.twin.id === COINBASE_USDC_TWIN_ID, nudge = q.twin.id === COINBASE_NUDGE_TWIN_ID;
  return {
    id: nudge ? QUOTES_COINBASE_NUDGE_ROW_ID : usdc ? QUOTES_COINBASE_USDC_ROW_ID : hold ? QUOTES_COINBASE_HOLD_ROW_ID : QUOTES_COINBASE_ROW_ID,
    name: String(q.twin.name),
    venue: venueLabel('coinbase'),
    venueId: 'coinbase',
    mode: 'paper',
    ...quoteBookCells(q),
    status: q.running
      ? { label: 'paper', running: true, tone: 'running', detail: `PR5's rule on Coinbase's recorded prints${usdc ? ', the USDC books at $50 a rung' : ''}${nudge ? ', USDC-GBP at $50 a rung, its fair nudged by Revolut X\'s book in FX closures' : ''}${hold || usdc || nudge ? ', the interbank rates held through a closure' : ''} · last minute ${Number(q.lagMinutes) || 0} min ago` }
      : { label: 'paper', running: false, tone: 'stale', detail: `its last decided minute was ${q.lagMinutes ?? '?'} min ago` },
  };
}

/** The OKX twins' ids among TESTING's rows: this prefix and the twin's id (`okxusdg`, `okxeurc`; okx_quotes.ts, 0150). */
export const QUOTES_OKX_ROW_PREFIX = '__quotes_okx_';

/**
 * What the page calls the OKX twins (Davies, 2026-10-29: "“Stablecoin quotes OKX USDG”改名为Stablecoin quotes USDG/EUR，“Stablecoin quotes
 * OKX EURC”改名为Stablecoin quotes EURC/USDC"), by the twin's id. The server still sends "Stablecoin quotes OKX USDG" and "… OKX EURC"
 * (`OKX_SPEC` in okx_quotes.ts): that file's sha256 is named in the frozen pre-registration (okx_prereg.test.js), so the name is
 * changed here, for display only; a twin the table does not know keeps the server's name.
 */
const QUOTES_OKX_NAMES = /** @type {Record<string, string>} */ ({ okxusdg: 'Stablecoin quotes USDG/EUR', okxusdgb: 'Stablecoin quotes USDG/EUR - 1', okxeurc: 'Stablecoin quotes EURC/USDC' });
/** The name of an OKX twin on the page. @param {any} twin  a dashboard `quotesOkx` item's `twin` */
export const quotesOkxName = (twin) => QUOTES_OKX_NAMES[String(twin?.id)] ?? String(twin?.name);

/**
 * "Stablecoin quotes USDG/EUR" and "Stablecoin quotes EURC/USDC" as rows of TESTING (okx_quotes.ts, 0150; Davies, 2026-10-27:
 * "…可以的话就加盘口记录器和开testings策略（目前live的rules？）"): PR5's rule as LIVE carries it out, on paper, on OKX's USDG-EUR and
 * EURC-USDC from its recorder's prints, a twin a book in Coinbase's shape and in pounds (€50 or 50 USDC a rung), on a card of
 * OKX's own. `paperTestRows` puts them after Coinbase's. null before the record has decided a minute. "Stablecoin quotes USDG/EUR - 1"
 * (`okxusdgb`, okx_basis.ts, 0171) is the USDG/EUR rule with its fair moved half-way to the book's trailing 24-hour basis; the
 * server places it right after the USDG/EUR row.
 * @param {any} q  one of the dashboard's `quotesOkx`
 */
export function quotesOkxRow(q) {
  if (!q?.twin) return null;
  return {
    id: `${QUOTES_OKX_ROW_PREFIX}${q.twin.id}`,
    name: quotesOkxName(q.twin),
    venue: venueLabel('okx'),
    venueId: 'okx',
    mode: 'paper',
    ...quoteBookCells(q),
    status: q.running
      ? { label: 'paper', running: true, tone: 'running', detail: `PR5's rule as LIVE runs it, on OKX's recorded prints${q.twin.id === 'okxusdgb' ? ", its fair moved half-way to the book's 24-hour basis" : ''} · last minute ${Number(q.lagMinutes) || 0} min ago` }
      : { label: 'paper', running: false, tone: 'stale', detail: `its last decided minute was ${q.lagMinutes ?? '?'} min ago` },
  };
}

/** "FXW-AUD weekend"'s id among TESTING's rows (0162). */
export const FXW_ROW_ID = '__fxw_aud';

/**
 * "FXW-AUD weekend" as a row of TESTING (Davies, 2026-10-29: "在testing列表中把IG Trader和澳元策略都上线，funded金额按照你推荐的来定，
 * 确保模拟一切真实"): the frozen FXW-AUD rule on paper on the live IG recorder's quotes, a GBP 1,000 spread-bet account at
 * GBP 1.50 a pip (`supabase/functions/ig/fxw.ts`, the dashboard's `fxwAud` from `agents/fxw_view.ts`). In pounds, the
 * account's own; dollars at the books' last GBP/USD for the scoreboard and IG's card. Deployed is the open position's
 * margin, and unrealised's percent is on it; realised is net of funding (the row's fees). `paperTestRows` puts it after
 * OKX's. null before the run has written its terms.
 * @param {any} f  the dashboard's `fxwAud`
 */
export function fxwAudRow(f) {
  if (!f || f.capitalGbp == null) return null;
  /** @param {unknown} x @param {number} base */
  const pct = (x, base) => (base > 0 && x != null ? (Number(x) / base) * 100 : null);
  const g = (/** @type {unknown} */ x) => Number(x) || 0;
  return {
    id: FXW_ROW_ID,
    name: String(f.name),
    venue: venueLabel('ig'),
    venueId: 'ig',
    mode: 'paper',
    capitalUsd: g(f.capitalUsd), costUsd: g(f.costUsd), valueUsd: g(f.valueUsd), feesUsd: g(f.feesUsd),
    todayUsd: g(f.todayUsd), todayPct: pct(f.todayUsd, g(f.capitalUsd)),
    unrealisedUsd: g(f.unrealisedUsd), unrealisedPct: pct(f.unrealisedUsd, g(f.costUsd)),
    realisedUsd: g(f.realisedUsd), realisedPct: pct(f.realisedUsd, g(f.capitalUsd)),
    ccy: 'GBP',
    gbp: {
      capital: g(f.capitalGbp), value: g(f.valueGbp),
      today: g(f.todayGbp), todayPct: pct(f.todayGbp, g(f.capitalGbp)),
      unrealised: g(f.unrealisedGbp), unrealisedPct: pct(f.unrealisedGbp, g(f.costGbp)),
      realised: g(f.realisedGbp), realisedPct: pct(f.realisedGbp, g(f.capitalGbp)),
      fees: g(f.feesGbp),
    },
    nextText: String(f.nextText ?? ''),
    openPositions: f.open ? 1 : 0, openOrders: 0,
    status: !f.running
      ? { label: 'paper', running: false, tone: 'stale', detail: `its last run was ${f.lagMinutes ?? '?'} min ago` }
      : f.started
        ? { label: 'paper', running: true, tone: 'running', detail: `the frozen rule on IG's recorded live quotes · last run ${Number(f.lagMinutes) || 0} min ago` }
        : { label: 'paper', running: false, tone: 'paused', detail: `starts ${fmtChartStamp(Date.parse(String(f.startAt)))} UK, the first weekend on IG's live quotes` },
  };
}

/** A price of AUD/USD as IG quotes it, to five places. @param {number | null | undefined} p */
export const fmtFx = (p) => (p == null || !Number.isFinite(Number(p)) ? '—' : Number(p).toFixed(5));

/**
 * The STATUS tiles of "FXW-AUD weekend"'s page: its equity, trades and open position, then its stake and
 * margin rule. Money in pounds.
 * @param {any} f  the dashboard's `fxwAud`
 * @param {(s: string) => string} [m]
 */
export function fxwTiles(f, m = (s) => s) {
  const o = f?.open;
  return [
    { k: 'EQUITY', v: m(fmtGbp(Number(f?.equityGbp) || 0)), note: `funded ${m(fmtGbp(Number(f?.capitalGbp) || 0))}` },
    { k: 'TRADES', v: String(Number(f?.trades) || 0), note: `${Number(f?.weekends) || 0} weekend${Number(f?.weekends) === 1 ? '' : 's'}` },
    {
      k: 'OPEN POSITION',
      v: o ? `${o.side} @ ${m(fmtFx(o.entryPrice))}` : 'none',
      note: o ? `mark ${m(fmtFx(o.markPrice))} · margin ${m(fmtGbp(Number(o.marginGbp) || 0))}` : null,
    },
    { k: 'STAKE', v: `${m(fmtGbp(Number(f?.stakeGbp) || 0))} a pip`, note: 'no stop · margin 5 %' },
  ];
}

/** The OKX twins' rows, in the payload's order. @param {any} dash */
export const quotesOkxRows = (dash) => (dash?.quotesOkx ?? []).map(quotesOkxRow).filter(Boolean);

/** The OKX twin a row opens, or null. @param {string | null} selected @param {any} dash */
export function quotesOkxOf(selected, dash) {
  if (!selected || !selected.startsWith(QUOTES_OKX_ROW_PREFIX)) return null;
  return (dash?.quotesOkx ?? []).find((/** @type {any} */ q) => q?.twin && `${QUOTES_OKX_ROW_PREFIX}${q.twin.id}` === selected) ?? null;
}

/** The twin a row opens, or null. @param {string | null} selected @param {any} dash */
export function quotesTwinOf(selected, dash) {
  if (!selected || !selected.startsWith(QUOTES_TWIN_ROW_PREFIX)) return null;
  return (dash?.quotesTwins ?? []).find((/** @type {any} */ t) => t?.twin && `${QUOTES_TWIN_ROW_PREFIX}${t.twin.id}` === selected) ?? null;
}

/**
 * What a twin's page says under its scoreboard: one line for each book whose asks wait for the coin a resting
 * conversion is buying (Davies, 2026-10-02: the conversions are makers, and an ask has no coin until its conversion
 * fills). The lines saying what the twin is, and how far its replica differs from its engine, were taken off on
 * Davies' word (2026-10-04).
 * @param {any} t  one of the dashboard's `quotesTwins`
 * @param {(s: string) => string} [m]
 * @returns {{ waiting: string[] }}
 */
export function quotesTwinLines(t, m = (s) => s) {
  const tw = t?.twin ?? {};
  const waiting = (tw.converting ?? []).map((/** @type {any} */ c) =>
    `${quoteBookLabel(c.book).split('/')[0]} asks wait for their coin: a maker conversion rests at ${m(fmtQuotePrice(c.price))}, ${m(Number(c.filledBase).toFixed(2))} of ${m(Number(c.base).toFixed(2))} filled`);
  return { waiting };
}

/** PR5's live executor's id among LIVE's rows. */
export const QUOTES_LIVE_ROW_ID = '__quotes_live';

/**
 * PR5's live executor as a row of LIVE (Davies, 2026-09-26: its real-money trades must show there before it leaves
 * dry-run). From its first real order, or once entries go to its live book, it is real money: its fills per rung, in
 * USD at the paper books' last GBP/USD, unrealised on the cost of what it holds, realised and today on its capital
 * (today is the figure its own daily loss stop reads). null while it is dry-run only.
 * @param {any} q  the dashboard's `quotes.live`
 */
export function quotesLiveRow(q) {
  if (!q || !(q.tradedLive || q.entryBook === 'live')) return null;
  return {
    id: QUOTES_LIVE_ROW_ID,
    name: 'Stablecoin quotes',
    venue: venueLabel('revx'),
    venueId: 'revx',
    mode: 'live',
    ...quoteBookCells(q),
    holdsLive: (Number(q.heldRungs) || 0) > 0, armed: !!q.armed,
    status: q.running
      ? { label: 'live', running: true, tone: 'running', detail: q.armed ? 'quoting real money' : 'buying off · its exits still run' }
      : { label: 'live', running: false, tone: 'stale', detail: `its last turn was ${q.lagMinutes ?? '?'} min ago` },
  };
}

/**
 * Which quotes page a row opens (Davies, 2026-10-01: LIVE's "Stablecoin quotes" opened the paper test's page): LIVE's row
 * the live executor's own, a TESTING twin's row its twin's (`quotesTwinOf`). Null for any other row, or a page with
 * nothing to show: the live page needs its LIVE row (`quotesLiveRow`), a twin's page its twin.
 * @param {string | null} selected  the row opened
 * @param {any} dash
 * @returns {'live' | 'twin' | 'coinbase' | 'okx' | null}
 */
export function quotesPageFor(selected, dash) {
  if (selected === QUOTES_LIVE_ROW_ID) return quotesLiveRow(dash?.quotes?.live) ? 'live' : null;
  if (selected === QUOTES_COINBASE_ROW_ID) return quotesCoinbaseRow(dash?.quotesCoinbase) ? 'coinbase' : null;
  if (selected === QUOTES_COINBASE_HOLD_ROW_ID) return quotesCoinbaseRow(dash?.quotesCoinbaseHold) ? 'coinbase' : null;
  if (selected === QUOTES_COINBASE_USDC_ROW_ID) return quotesCoinbaseRow(dash?.quotesCoinbaseUsdc) ? 'coinbase' : null;
  if (selected === QUOTES_COINBASE_NUDGE_ROW_ID) return quotesCoinbaseRow(dash?.quotesCoinbaseNudge) ? 'coinbase' : null;
  if (selected?.startsWith(QUOTES_OKX_ROW_PREFIX)) return quotesOkxRow(quotesOkxOf(selected, dash)) ? 'okx' : null;
  return quotesTwinRow(quotesTwinOf(selected, dash)) ? 'twin' : null;
}

/** "Stablecoin quotes USDC/GBP"'s id among LIVE's rows: the Coinbase live executor (cb_live.ts, 0177). */
export const CB_LIVE_ROW_ID = '__cb_live';

/**
 * "Stablecoin quotes USDC/GBP" as a row of LIVE (Davies, 2026-10-29: "…上线后live策略名字叫Stablecoin quotes USDC/GBP"): the
 * Coinbase live executor carrying "Stablecoin quotes with Euros - 2"'s decisions with £120 of real money; the paper arm keeps
 * its own row on TESTING. The dashboard's `cbLive`, read from its own tables alone: in pounds, its money, and in dollars at
 * the paper arm's last GBP/USD for the scoreboard. null while it is neither armed nor has sent a live order (built dry-run).
 * @param {any} c  the dashboard's `cbLive`
 */
export function cbLiveRow(c) {
  if (!c || !(c.tradedLive || c.armed)) return null;
  const x = Number(c.gbpUsd) > 0 ? Number(c.gbpUsd) : 0;
  const g = { capital: Number(c.capitalGbp) || 0, cost: Number(c.costGbp) || 0, fees: Number(c.feesGbp) || 0, today: Number(c.todayGbp) || 0,
    unrealised: Number(c.unrealisedGbp) || 0, realised: Number(c.realisedGbp) || 0 };
  const value = g.capital + g.realised + g.unrealised;
  const cells = quoteBookCells({
    capitalUsd: g.capital * x, costUsd: g.cost * x, valueUsd: value * x, feesUsd: g.fees * x, todayUsd: g.today * x, unrealisedUsd: g.unrealised * x, realisedUsd: g.realised * x,
    capitalGbp: g.capital, costGbp: g.cost, valueGbp: value, feesGbp: g.fees, todayGbp: g.today, unrealisedGbp: g.unrealised, realisedGbp: g.realised,
    heldRungs: c.heldRungs, openOrders: c.openOrders,
  });
  return {
    id: CB_LIVE_ROW_ID,
    name: c.name || 'Stablecoin quotes USDC/GBP',
    venue: venueLabel('coinbase'),
    venueId: 'coinbase',
    mode: 'live',
    ...cells,
    holdsLive: (Number(c.heldRungs) || 0) > 0, armed: !!c.armed,
    status: !c.running
      ? { label: 'live', running: false, tone: 'stale', detail: c.lagMinutes == null ? 'it has not turned yet' : `its last turn was ${c.lagMinutes} min ago` }
      : c.lossStopped
        ? { label: 'live', running: true, tone: 'stale', detail: "its daily loss stop has tripped: no entries until tomorrow, its exits still run" }
        : c.armed
          ? { label: 'live', running: true, tone: 'running', detail: 'quoting real money' }
          : { label: 'live', running: true, tone: 'stale', detail: 'disarmed · its exits still run' },
  };
}

/** "Reward quotes live-prep"'s real-money book's id among LIVE's rows (its paper layer's TESTING row is `LP_ROW_ID`). */
export const LP_LIVE_ROW_ID = '__lp_live';

/**
 * "Reward quotes live-prep"'s real-money book as a row of LIVE (Davies, 2026-10-09: "网站的agents live页怎么看不到这个上
 * 线", the morning it went live), as PR5's live executor is one (`quotesLiveRow`): the dashboard's `lpLive`, made by the
 * server from the order path's live rows alone (`pm_lp_live_view.ts`), so nothing of its paper layer, whose row stays on
 * TESTING, is in it. Funded is the money Davies put in (`fundedUsd`, Addendum 10), as booked or as read, never the cap (a dash when unknown); deployed what its resting buys tie up and what it holds at cost;
 * today and realised are on what is funded, unrealised on what its holdings cost; realised is its fills' and settlements' plus what
 * Polymarket paid (rewards and maker rebates), split for the Polymarket card into rewards and orders, to the cent. Its
 * name carries no " · live", as no LIVE row's does, and on LIVE it is "Reward quotes". null while it has never been armed
 * nor sent a live order.
 * @param {any} l  the dashboard's `lpLive`
 */
export function lpLiveRow(l) {
  if (!l || !(l.tradedLive || l.armed)) return null;
  // FUNDED is the money put in, booked or as read; never the cap (Davies, 2026-10-10). Unknown, the page shows a dash.
  const fundedKnown = l.fundedUsd != null && Number.isFinite(Number(l.fundedUsd));
  const capital = fundedKnown ? Number(l.fundedUsd) : 0, cost = Number(l.costUsd) || 0;
  /** @param {number} usd @param {number} base */
  const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
  const realised = Number(l.realisedUsd) || 0, unrealised = Number(l.unrealisedUsd) || 0, today = Number(l.todayUsd) || 0;
  const rewards = (Number(l.paidUsd) || 0) + (Number(l.rebateUsd) || 0);
  const split = splitCents(realised, [rewards, Number(l.realisedFillsUsd) || 0]);
  const stopped = !!l.stop?.trippedAt;
  return {
    id: LP_LIVE_ROW_ID,
    // "Reward quotes" on LIVE (Davies, 2026-10-09: "live页里"Reward quotes live-prep"改名为"Reward quotes""); its id
    // keeps it apart from TESTING's "Reward quotes" (RW's, `RW_ROW_ID`) and its paper row (`LP_ROW_ID`).
    name: 'Reward quotes',
    venue: venueLabel('polymarket'),
    venueId: 'polymarket',
    mode: 'live',
    capitalUsd: capital, fundedKnown, valueUsd: Number(l.valueUsd) || 0, costUsd: cost, feesUsd: Number(l.feesUsd) || 0,
    todayUsd: today, todayPct: pct(today, capital),
    unrealisedUsd: unrealised, unrealisedPct: pct(unrealised, cost),
    realisedUsd: realised, realisedPct: pct(realised, capital),
    rewards: { realisedUsd: split.parts[0], unrealisedUsd: 0 },
    orders: { realisedUsd: split.parts[1], unrealisedUsd: unrealised },
    nextText: 'every minute',
    // "N open" is the markets it is at work in, as a Reward quotes row's (its resting orders' and what it holds).
    openPositions: Number(l.markets) || 0, openOrders: Number(l.openOrders) || 0,
    holdsLive: cost > 0, armed: !!l.armed,
    status: !l.running
      ? { label: 'live', running: false, tone: 'stale', detail: l.lagMinutes == null ? 'it has not turned yet' : `its last turn was ${l.lagMinutes} min ago` }
      : stopped
        ? { label: 'live', running: true, tone: 'stale', detail: 'its total loss stop has tripped: it only sells what it holds' }
        : l.armed
          ? { label: 'live', running: true, tone: 'running', detail: `quoting real money in ${Number(l.markets) || 0} market${Number(l.markets) === 1 ? '' : 's'}` }
          : { label: 'live', running: true, tone: 'stale', detail: 'disarmed · its sells of what it holds still run' },
  };
}

/**
 * LIVE's rows beyond its strategies, in the order the table lists them: PR5's live executor (`quotesLiveRow`) once it
 * trades real money, the Coinbase live executor (`cbLiveRow`) once armed or once it has sent a live order, live-prep's live book (`lpLiveRow`) only while it is armed, and the Polymarket analyst
 * (`grokPmRow`). LIVE's scoreboard and venue cards add each once; TESTING never does.
 *
 * Live-prep disarmed is off LIVE (Davies, 2026-10-17: "你的其他问题都按你推荐的来", on taking it off): it was liquidated and
 * 0125 disarmed it, and the account it funded is the one the analyst's $100 comes from, so its funded figure and the
 * analyst's would count the same pUSD twice. Its record, its tables and its page stay; armed again, it is LIVE's row again,
 * since a book trading real money is always on LIVE.
 * @param {any} dash
 */
export function liveExtraRows(dash) {
  return [quotesLiveRow(dash?.quotes?.live), cbLiveRow(dash?.cbLive), dash?.lpLive?.armed ? lpLiveRow(dash.lpLive) : null, grokPmRow(dash?.grokPm)].filter((r) => !!r);
}

/** "Polymarket analyst"'s id among LIVE's rows (GROKPM, 0124). */
export const GROKPM_ROW_ID = '__grokpm';
/**
 * Its name on LIVE and on its page (Davies, 2026-10-15: "网站中live页也加上策略和子策略页面"; 2026-10-17: "“Polymarket analyst
 * (Grok)”策略改为“Polymarket analyst“").
 */
export const GROKPM_ROW_NAME = 'Polymarket analyst';

/**
 * "Polymarket analyst" as a row of LIVE: the dashboard's `grokPm` (`grokpm_view.ts`), every dollar from the independent
 * record of the agent's own trades on the project's Polymarket account (Deviation D2: it trades through this project's
 * server, never holding a key), never its own report. Funded is its $100 budget (`configuredFundedUsd`), shown and added to
 * LIVE's FUNDED from now, before the go as after it (Davies, 2026-10-17: "明确目前funded就是100美元"); until the go its
 * today, unrealised and realised are 0 and nothing is deployed. Deployed is what it holds at cost; today and realised on
 * what is funded, unrealised on its cost. Its fees (`feesUsd`, its own fills' from the go) are inside realised, whose cash
 * is net of them: the page says "(incl. fees …)" as the stablecoin quotes' live page does. While it is a dry-run its status is the amber "dry-run" one, on the row and its page alike. null until the
 * account is configured.
 * @param {any} g  the dashboard's `grokPm`
 */
export function grokPmRow(g) {
  if (!g) return null;
  const configured = Number(g.configuredFundedUsd ?? g.fundedUsd);
  const funded = Number.isFinite(configured) && configured > 0 ? configured : 0, cost = Number(g.costUsd) || 0;
  /** @param {number} usd @param {number} base */
  const pct = (usd, base) => (base > 0 ? (usd / base) * 100 : null);
  const today = Number(g.todayUsd) || 0, unrealised = Number(g.unrealisedUsd) || 0, realised = Number(g.realisedUsd) || 0;
  const open = Number(g.status?.open) || 0;
  return {
    id: GROKPM_ROW_ID, name: GROKPM_ROW_NAME, venue: venueLabel('polymarket'), venueId: 'polymarket', mode: 'live',
    capitalUsd: funded, fundedKnown: funded > 0, valueUsd: cost, costUsd: cost, feesUsd: Number(g.feesUsd) || 0,
    todayUsd: today, todayPct: pct(today, funded), unrealisedUsd: unrealised, unrealisedPct: pct(unrealised, cost), realisedUsd: realised, realisedPct: pct(realised, funded),
    nextText: 'record every 5 min', openPositions: open, openOrders: 0, holdsLive: cost > 0, armed: !!g.started && !g.stop?.totalTripped,
    status: !g.started
      ? (g.mode === 'live'
        ? { label: 'live', running: false, tone: 'stale', detail: 'armed: its record has not read its first trade yet' }
        : { label: 'dry-run', running: false, tone: 'stale', detail: 'dry-run: its orders are checked and journalled, none is sent' })
      : !g.running
        ? { label: 'live', running: false, tone: 'stale', detail: g.lagMinutes == null ? 'its record has not read the account yet' : `its record last read the account ${g.lagMinutes} min ago` }
        : g.stop?.totalTripped
          ? { label: 'live', running: true, tone: 'stale', detail: 'its total stop is reached: by its rules it may only close' }
          : { label: 'live', running: true, tone: 'running', detail: `an outside agent trading real money · ${open} position${open === 1 ? '' : 's'} open` },
  };
}

/**
 * The mode tag of its page's head: LIVE once the order path is armed (`mode` live), else DRY-RUN, so the head never says
 * LIVE while the list's dot is amber for a dry-run (Davies, 2026-10-17: "agent页策略列表里显示的黄灯怎么子页面点开现实的是live的tag").
 * @param {any} g  the dashboard's `grokPm`
 * @returns {'live' | 'dry-run'}
 */
export const grokPmModeTag = (g) => (g?.mode === 'live' ? 'live' : 'dry-run');

/** A probability or a price as cents, "82¢"; a dash without one. @param {number | null | undefined} x */
export const fmtProb = (x) => (x == null || !Number.isFinite(Number(x)) ? '—' : `${+(Number(x) * 100).toFixed(1)}¢`);
/** A Brier score to three places; a dash without one. @param {number | null | undefined} x */
export const fmtBrier = (x) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(3));

/**
 * The STATUS tiles of its page: open positions, the cash the record read (through `m`, the hide-values mask), the Brier
 * scores of the agent and of the market on the same resolved entries, and how many of its entries have resolved.
 * @param {any} g  the dashboard's `grokPm` @param {(s: string) => string} m
 */
export function grokPmTiles(g, m) {
  const s = g?.status ?? {};
  return [
    { k: 'OPEN POSITIONS', v: String(Number(s.open) || 0) },
    { k: 'CASH', v: g?.cashUsd == null ? '—' : m(fmtUsd(Number(g.cashUsd))) },
    { k: 'BRIER YOU / MARKET', v: Number(s.scored) > 0 ? `${fmtBrier(s.brierAgent)} / ${fmtBrier(s.brierMarket)}` : '—' },
    { k: 'RESOLVED', v: String(Number(s.resolved) || 0) },
  ];
}

/**
 * The stops' room under its scoreboard, every dollar through `m`: the total stop and the day's, as the agent's rules state
 * them. The page shows them; nothing here can stop the agent. Null before the money arrives.
 * @param {any} g @param {(s: string) => string} m
 */
export function grokPmStopText(g, m) {
  const st = g?.stop;
  if (!g?.started || !st || st.totalRoomUsd == null || st.dayRoomUsd == null) return null;
  const total = st.totalTripped ? 'total stop reached: close only' : `total stop at ${m(fmtUsd(-Number(st.totalLimitUsd), true))}: ${m(fmtUsd(Number(st.totalRoomUsd)))} of room`;
  const day = st.dayTripped ? 'day stop reached' : `day stop at ${m(fmtUsd(-Number(st.dayLimitUsd), true))}: ${m(fmtUsd(Number(st.dayRoomUsd)))} of room`;
  return `${total} · ${day}`;
}

/**
 * The mismatch line (a reported figure more than $1 from the record's), every dollar through `m`; null when they agree.
 * @param {any} g @param {(s: string) => string} m
 */
export function grokPmMismatchText(g, m) {
  if (!g?.mismatch) return null;
  const parts = [];
  const c = g.cycle;
  if (c?.mismatch) {
    parts.push(`its ${String(c.ts).slice(11, 16)} UTC report says ${m(fmtUsd(Number(c.agentEquityUsd)))} (${m(fmtUsd(Number(c.agentPnlUsd), true))}), the record ${m(fmtUsd(Number(c.recordEquityUsd)))} (${m(fmtUsd(Number(c.recordPnlUsd), true))})`);
  }
  const days = (g.days ?? []).filter((/** @type {any} */ d) => d.mismatch).map((/** @type {any} */ d) => d.day.slice(5));
  if (days.length) parts.push(`its daily summary differs on ${days.join(', ')}`);
  return `the agent's numbers differ from the record by more than $1: ${parts.join('; ')}`;
}

/**
 * A row of its DAYS, every dollar through `m`: the record's P&L and the agent's own summary's beside it.
 * @param {any} d @param {(s: string) => string} m
 */
export function grokPmDayCells(d, m) {
  const rec = d?.recordUsd == null ? null : Number(d.recordUsd), agent = d?.agentUsd == null ? null : Number(d.agentUsd);
  return {
    record: rec === null ? '—' : m(fmtUsd(rec, true)), recordUsd: rec,
    agent: agent === null ? '—' : m(fmtUsd(agent, true)), agentUsd: agent,
    trades: d?.trades == null ? '—' : String(d.trades),
    flag: d?.mismatch ? 'differs' : '',
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** An instant as "16 Oct 15:38 UTC"; empty when it is not one. @param {unknown} ts */
export function utcStamp(ts) {
  const t = Date.parse(String(ts ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t), two = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** A source's text on the page: its domain, "actionforex.com" for https://www.actionforex.com/…; null when it is no http(s) link. @param {unknown} u */
export function linkDomain(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return null;
  try { return new URL(u).hostname.replace(/^www\./i, '') || null; } catch { return null; }
}

/** The market's link on polymarket.com, only in the shape the server builds (`grokpm_view.ts`' `marketUrl`). */
const MARKET_HREF = /^https:\/\/polymarket\.com\/market\/[a-z0-9][a-z0-9-]*$/i;

/**
 * One journal entry as its page lists it (Davies, 2026-10-17: "JOURNAL部分做的更美观和清晰一些，内容也展示的更简约些，比如链接可以
 * 直接用link（下划线）作为超链接可以点…“0xdf9bf27e…”这种乱码"): a head line (its time in UTC, what it did as a chip, its
 * category, the side and outcome, size @ price through `m`), the market as a link to its page on Polymarket (the server's
 * title; unlinked without a slug; "market title pending" when no title is known yet — never the condition id), the agent's
 * p against the market's price it saw and the edge in points, its words, what would prove it wrong, and its sources as
 * links named by their domain. A link is kept only when it is http(s): the server already dropped any other.
 * @param {any} j @param {(s: string) => string} m
 */
export function grokPmJournalView(j, m) {
  const trade = !!j?.side && j?.price != null && j?.size != null;
  const action = String(j?.action ?? '');
  const verb = { open: 'open', close: 'close', cancel: 'cancel', no_action: 'no action' }[action] ?? action.replace(/_/g, ' ');
  const side = j?.side === 'BUY' ? 'buy' : j?.side === 'SELL' ? 'sell' : '';
  const num = (/** @type {unknown} */ x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  const p = num(j?.p), mk = num(j?.m);
  const edge = p !== null && mk !== null ? Math.round((p - mk) * 1000) / 10 : null;
  const edgeText = edge === null ? '' : edge > 0 ? `+${edge.toFixed(1)}` : edge < 0 ? `\u2212${Math.abs(edge).toFixed(1)}` : '0';
  const title = typeof j?.title === 'string' && j.title.trim() ? j.title.trim() : null;
  const href = title && typeof j?.url === 'string' && MARKET_HREF.test(j.url) ? j.url : null;
  return {
    time: utcStamp(j?.ts),
    action: verb, tone: action === 'open' || action === 'close' ? action : 'quiet',
    category: j?.category ? `cat ${j.category}` : '',
    side: side || j?.outcome ? `${side} ${j?.outcome ?? ''}`.trim() : '',
    trade: trade ? `${m(String(+Number(j.size).toFixed(2)))} @ ${m(fmtProb(j.price))}` : '',
    market: title || j?.marketId ? { text: title ?? 'market title pending', href, pending: !title } : null,
    probs: p !== null && mk !== null ? `p ${fmtProb(p)} vs market ${fmtProb(mk)} (edge ${edgeText})` : p !== null ? `p ${fmtProb(p)}` : mk !== null ? `market ${fmtProb(mk)}` : '',
    reason: String(j?.reason ?? ''), invalidation: j?.invalidation ? String(j.invalidation) : '',
    sources: (Array.isArray(j?.sources) ? j.sources : []).flatMap((/** @type {unknown} */ u) => {
      const text = linkDomain(u);
      return text ? [{ href: /** @type {string} */ (u), text }] : [];
    }),
  };
}

/** R, what Polymarket paid over what the formula gave, to two places; a dash without a formula figure. @param {number | null | undefined} r */
export const fmtR = (r) => (r == null || !Number.isFinite(Number(r)) ? '—' : Number(r).toFixed(2));

/** The first tile of LIVE's "Reward quotes" STATUS: its R, named by what it is (LP-OBS-DEEP, 2026-10-11; "R (ACTUAL)" before). */
export const LP_R_TILE = 'R (PAID ÷ FORMULA)';

/**
 * The STATUS block of LIVE's "Reward quotes" page, the TESTING page's (`RwBar`) from the live book: its R in place of
 * the worst case, "—" until a payout is read; the markets chosen today; the markets still holding tokens; and today's
 * rewards, estimated, in place of TOP SHARE (Davies, 2026-10-09: "TOP SHARE这个框删了…最右边的那个空余的框显示预估今日rewards收益，
 * 可以给个范围（最低-最优）"): the dashboard's `estimate` (`lpRewardEstimate`), what the formula has given today's quotes so far
 * at R's low and high ends, and under it the whole day's and R's band.
 * @param {any} l  the dashboard's `lpLive`
 */
export function lpLiveStatus(l) {
  const e = l?.estimate;
  const n = (/** @type {unknown} */ x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  // One R (LP-OBS-DEEP, `reviews/2026-10-11-lp-observations-deep.md`, item 4c): what Polymarket paid over the whole
  // formula, every live quoted minute, 10-09 like for like (`rWhole`, the pre-registration's R and the end rule's). Nothing
  // under it (Davies, 2026-10-11: "第一个数字底下的小字部分全删了，第一个数字用一个最能表示的就行").
  return {
    phase: 'run', rText: fmtR(l?.rWhole), rNotes: /** @type {string[]} */ ([]),
    quoting: Number(l?.status?.quoting) || 0, open: Number(l?.status?.held) || 0,
    est: e ? {
      lowUsd: n(e.soFar?.lowUsd), highUsd: n(e.soFar?.highUsd), dayLowUsd: n(e.fullDay?.lowUsd), dayHighUsd: n(e.fullDay?.highUsd),
      rBand: `${fmtR(e.r?.low)}–${fmtR(e.r?.high)}`, rDays: Number(e.r?.days) || 0,
    } : null,
  };
}

/**
 * The total stop's room on LIVE's "Reward quotes" page, under its scoreboard (Addendum 18, LP-OBS-DEEP item 5): the stop
 * judges the page's TOTAL (fills marked + rewards paid + rebates − fees, `stop.basisUsd`), so the line reads the limit,
 * the room left before it (`stop.roomUsd`) and that total, every dollar through `m` (the hide-values mask). Null when the
 * stop has tripped (its own red line says so) or its figures are not in the payload. Since Addendum 19, once Davies' go
 * restarts the stop (`stop.since`), it counts from that minute, so the line says from when and calls its figure what it
 * is: what the book made since then, not the page's TOTAL.
 * @param {any} l  the dashboard's `lpLive` @param {(s: string) => string} m
 */
export function lpStopRoomText(l, m) {
  const s = l?.stop;
  const n = (/** @type {unknown} */ x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  const limit = n(s?.limitUsd), room = n(s?.roomUsd), basis = n(s?.basisUsd);
  if (!s || s.trippedAt || limit === null || room === null || basis === null) return null;
  const since = typeof s.since === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.since) ? `${s.since.slice(5, 10)} ${s.since.slice(11, 16)} UTC` : null;
  if (since) return `total stop at ${m(fmtUsd(-limit, true))} since ${since}: ${m(fmtUsd(room))} of room (since then ${m(fmtUsd(basis, true))})`;
  return `total stop at ${m(fmtUsd(-limit, true))}: ${m(fmtUsd(room))} of room (total ${m(fmtUsd(basis, true))})`;
}

/**
 * A row of DAYS on LIVE's "Reward quotes" page, as its cells read, every dollar through `m` (the hide-values mask): the
 * markets the readout read, the day's Orders (the fills' P&L marked to market, rewards not counted, `lpDayOrders`;
 * Davies, 2026-10-11: "days表格中在合适的位置加上orders列展示orders的盈亏"), then the whole formula, what Polymarket paid, R and
 * the rebates. Orders sits beside the rewards' columns, so a row reads what its orders made and what it was paid; a day
 * not yet read (today, and yesterday until its payout is read) has its Orders alone, a dash in each of the readout's cells.
 * @param {any} d  a day of the dashboard's `lpLive.days` @param {(s: string) => string} m
 */
export function lpLiveDayCells(d, m) {
  const read = !!d?.read;
  const orders = Number(d?.ordersUsd) || 0;
  return {
    markets: read ? String(Number(d.markets) || 0) : '—',
    orders: m(fmtUsd(orders, true)), ordersUsd: orders,
    // The whole formula and R over it (LP-OBS-DEEP, 2026-10-11): the STATUS tile's basis, so a day's R and the tile are one R.
    formula: read ? m(fmtUsd(Number(d.formulaWholeUsd) || 0)) : '—',
    paid: read ? m(fmtUsd(Number(d.paidUsd) || 0, true)) : '—', paidUsd: read ? Number(d.paidUsd) || 0 : null,
    r: fmtR(d?.rWhole),
    rebates: read ? m(fmtUsd(Number(d.rebateUsd) || 0)) : '—',
  };
}

/**
 * The REWARDS TODAY (EST.) tile's value, every dollar through `m` (the hide-values mask): "$a – $b" so far today, in the
 * page's gain colour; a dash without an estimate. Nothing under it (Davies, 2026-10-09: "数字的字体改成绿色的，底下"day …"删掉不显示").
 * @param {ReturnType<typeof lpLiveStatus>['est']} est @param {(s: string) => string} m
 */
export function lpEstimateTexts(est, m) {
  if (!est || est.lowUsd == null || est.highUsd == null) return { text: '—', color: null };
  const usd = (/** @type {number | null} */ x) => m(fmtUsd(x ?? 0));
  return { text: `${usd(est.lowUsd)} – ${usd(est.highUsd)}`, color: 'var(--gain)' };
}

/**
 * Pounds, the stablecoin quotes' own currency: their capital, P&L, loss stop and balances (Davies, 2026-10-01). Written
 * as `fmtUsd` writes dollars: "£1,200", "-£12", "+£0.23".
 * @param {number | null | undefined} n @param {boolean} [signed]
 */
export const fmtGbp = (n, signed = false) => dropDot00(fmtMoney(n, { signed, compact: false, symbol: '£' }));

/** Signed pounds to four places, as `fmtUsd4` writes dollars: a trip's, a rung's or a day's P&L. Zero is "£0". @param {number | null | undefined} n */
export const fmtGbp4 = (n) => {
  const s = fmtMoney(n, { signed: true, compact: false, precision: 4, symbol: '£' });
  return /^[+-]?£0[.,]0000$/.test(s) ? '£0' : s;
};

/**
 * A fee to four places, beside a trip's P&L to four, and unsigned, since a fee only ever costs: "£0.0900". None is "£0".
 * @param {number | null | undefined} n
 */
export const fmtFeeGbp4 = (n) => {
  const s = fmtMoney(n, { compact: false, precision: 4, symbol: '£' });
  return /^£0[.,]0000$/.test(s) ? '£0' : s;
};

/**
 * An order's state as the pages write it. The venue's "new" is an order it accepted that rests on the book, and the
 * pages call it "open" (Davies, 2026-10-02); "partially_filled" reads "partially filled"; the others as they are.
 * @param {string | null | undefined} state
 */
export const orderStateText = (state) => (state === 'new' ? 'open' : String(state ?? '—').replace('_', ' '));

/**
 * The live page's BOOKS (Davies, 2026-10-01: the paper test's BOOKS, clearer than its RUNGS): each book's card in the
 * paper page's shape, so `quoteLadderRows` lays out its six rungs as the paper's: a rung holding coins is held at its
 * average entry, with what it has made at the book's last trade; one with an order resting quotes that order's price
 * (its exit, when it holds nothing); any other is idle. Pounds, the book's own currency.
 * @param {any} q  the dashboard's `quotes.live`
 */
export function quotesLiveBooks(q) {
  const d = q?.detail;
  if (!d) return [];
  return (d.books ?? []).map((/** @type {any} */ b) => ({
    book: b.book, lastPrice: b.lastPrice, fair: b.fair, index: b.index ?? null, trips: Number(b.trips) || 0, won: Number(b.won) || 0,
    realisedGbp: Number(b.realisedGbp) || 0,
    rungs: (d.rungs ?? []).filter((/** @type {any} */ r) => r.book === b.book).map((/** @type {any} */ r) => (r.held
      ? { side: r.side, k: r.k, mode: 'position', entry: r.held.avgEntry, heldSince: r.held.since, unrealisedGbp: r.held.unrealisedGbp ?? null }
      : r.order ? { side: r.side, k: r.k, mode: 'quote', price: r.order.price } : { side: r.side, k: r.k, mode: 'idle' })),
  }));
}

/**
 * The live page's INVENTORY: the account's pounds and coins as the executor last read them (balances, so what rests in
 * orders is included), each coin also in pounds at the price it is valued at — its ticker's index price, as Revolut X's
 * account page values it, or its book's last trade while no fresh index is to hand — and with its unrealised against
 * what it cost (Davies, 2026-10-01: his account page shows it), which add up to the scoreboard's. Null when the turn
 * could not read them.
 * @param {any} q  the dashboard's `quotes.live`
 * @param {(s: string) => string} [m]
 */
export function quotesLiveInventory(q, m = (s) => s) {
  const inv = q?.detail?.inventory;
  if (!inv?.assets) return null;
  return {
    at: inv.at ? fmtChartStamp(inv.at) : null,
    rows: inv.assets.map((/** @type {any} */ a) => ({
      asset: a.asset,
      amount: a.asset === 'GBP' ? m(fmtGbp(a.amount)) : m(fmtQuoteQty(a.amount, a.asset)),
      gbp: a.asset === 'GBP' || a.gbp == null ? null : m(fmtGbp(a.gbp)),
      price: a.asset === 'GBP' || a.price == null ? null : m(fmtQuotePrice(a.price)),
      priceFrom: a.asset === 'GBP' ? null : a.priceFrom ?? null,
      unrealisedGbp: a.asset === 'GBP' || a.unrealisedGbp == null ? null : Number(a.unrealisedGbp),
    })),
  };
}

/**
 * A price a coin, as its book quotes it: pounds to four places; a EUR book's in euros, USDT-EUR's to five (Coinbase's step,
 * "Stablecoin quotes with Euros"); a dollar book's in dollars (OKX's EURC-USDC, 0150). @param {number | null | undefined} p @param {string | null} [book]
 */
export const fmtQuotePrice = (p, book = null) => {
  if (p == null || !Number.isFinite(Number(p))) return '—';
  const b = String(book ?? '');
  const sign = /EUR$/.test(b) ? '€' : /USDC?$/.test(b) ? '$' : '£';
  return `${sign}${Number(p).toFixed(book === 'USDT-EUR' ? 5 : 4)}`;
};

/**
 * A round trip's size, in coins of its book: "99.30 USDC". It replaced the "exit as" column (Davies, 2026-09-28), which
 * read "maker" on every trip: the rule exits as a taker only at its 24-hour stop, which no trip has reached.
 * @param {number | string | null | undefined} qty @param {string | null | undefined} book
 */
export const fmtQuoteQty = (qty, book) =>
  (qty == null || !Number.isFinite(Number(qty)) ? '—' : `${Number(qty).toFixed(2)} ${String(book ?? '').split(/[-/]/)[0]}`.trim());

/**
 * How long a strategy has been under test, to the hour, for the words beside its status at the top of its page (Davies,
 * 2026-09-28): "3d 14h", "14h", "under 1h". `untilIso` stops the clock where a test ended. Null when the start is
 * unknown or still to come.
 * @param {string | null | undefined} sinceIso @param {number} nowMs @param {string | null | undefined} [untilIso]
 */
export function testedForText(sinceIso, nowMs, untilIso = null) {
  const since = Date.parse(String(sinceIso ?? ''));
  if (!Number.isFinite(since) || !Number.isFinite(nowMs)) return null;
  const end = Date.parse(String(untilIso ?? ''));
  const until = Number.isFinite(end) ? Math.min(nowMs, end) : nowMs;
  if (until < since) return null;
  const h = Math.floor((until - since) / 3600e3);
  if (h < 1) return 'under 1h';
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

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
    if (!r || r.mode === 'idle') return { state: 'idle', price: null, unrealisedUsd: null, unrealisedGbp: null, heldSince: null };
    if (r.mode === 'position') return { state: 'held', price: r.entry ?? null, unrealisedUsd: r.unrealisedUsd ?? null, unrealisedGbp: r.unrealisedGbp ?? null, heldSince: r.heldSince ?? null };
    return { state: 'quoting', price: r.price ?? null, unrealisedUsd: null, unrealisedGbp: null, heldSince: null };
  };
  return ks.map((k) => ({
    k,
    label: quoteRungLabel(k),
    bid: cell(rungs.find((r) => r.side === 'bid' && Number(r.k) === k)),
    ask: cell(rungs.find((r) => r.side === 'ask' && Number(r.k) === k)),
  }));
}

/**
 * A rung's distance from fair as the page writes it: 0.001 → "0.1 %", 0.00075 → "0.075 %". Three decimals, because the
 * variant quotes at 0.075 % and 0.125 %, which two would print as 0.07 % and 0.13 %.
 * @param {number} k
 */
export const quoteRungLabel = (k) => `${+(Number(k) * 100).toFixed(3)} %`;

/** A book's name as the page writes a pair: "USDC-GBP" → "USDC/GBP". @param {string} b */
export const quoteBookLabel = (b) => String(b ?? '').replace('-', '/');

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
 * Tiles under RW's status: the pessimistic total, how concentrated it is, markets quoting today, positions still held. A
 * real-money book (LIVE's "Reward quotes") has no worst case: its first tile is the actual R, what Polymarket paid over
 * what the formula gave (Davies, 2026-10-09: "STATUS里WORST CASE部分改为实际R值").
 * @param {string} [_phase] @param {boolean} [live]
 */
export function rwBarTileKeys(_phase, live = false) {
  // LIVE's has no TOP SHARE: its two right-hand tiles move left one and its last is today's rewards, estimated (Davies,
  // 2026-10-09). TESTING's pages keep theirs.
  // Its R is named by what it is since LP-OBS-DEEP (2026-10-11): paid over the whole formula (`lpLiveStatus`).
  return live ? [LP_R_TILE, 'QUOTING TODAY', 'POSITIONS STILL HELD', 'REWARDS TODAY (EST.)'] : ['WORST CASE', 'TOP SHARE', 'QUOTING TODAY', 'POSITIONS STILL HELD'];
}

/**
 * What a Reward quotes market holds, as a holder reads it. RW's paper nets its fills into YES shares (`net`; a short YES
 * is long NO). The order path's paper layers (mini-pool's and mid-pool's) book the path's tokens, which buys NO where
 * RW sells YES and nets nothing, so they can hold both: "5 Yes · 4 No".
 * @param {{ net?: number | null, yes?: number | null, no?: number | null }} x  one of the page's markets
 */
export function rwHeldOf(x) {
  if (x.yes == null && x.no == null) return rwHeldText(x.net);
  const yes = Number(x.yes) || 0, no = Number(x.no) || 0;
  const parts = [...(yes > 0 ? [`${dropDot00(yes.toFixed(2))} Yes`] : []), ...(no > 0 ? [`${dropDot00(no.toFixed(2))} No`] : [])];
  return parts.length ? parts.join(' · ') : '—';
}

/**
 * LIVE's QUOTES rows: only the markets with an order resting now or a token held (Davies, 2026-10-09: "只看正在挂单或有持仓的
 * 市场"). A chosen market the rule is not quoting this minute (TB1's one-tick skip, the pause, no adjusted midpoint, the
 * caps) and holding nothing has no row; QUOTING TODAY still counts it, and its money stays in the totals.
 * @param {any[] | null | undefined} quotes  the dashboard's `lpLive.quotes`
 */
export function lpLiveQuoteRows(quotes) {
  return (quotes ?? []).filter((x) => x.bid != null || x.ask != null || (Number(x.yes) || 0) > 0 || (Number(x.no) || 0) > 0);
}

/**
 * A fill as the Reward quotes pages list it: what was done, and at what price. RW's are in its one YES book (a bid bought
 * YES, an ask sold it); the order path's paper layers' are the path's own token trades, "bought No" at the NO price, as
 * the venue would list them.
 * @param {{ side?: string, price?: number, tokenSide?: string, outcome?: string, tokenPrice?: number }} f
 * @returns {{ buy: boolean, text: string, price: number }}
 */
export function rwFillView(f) {
  if (f.tokenSide) {
    const buy = f.tokenSide === 'BUY';
    return { buy, text: `${buy ? 'bought' : 'sold'} ${f.outcome === 'yes' ? 'Yes' : 'No'}`, price: Number(f.tokenPrice) };
  }
  const buy = f.side === 'bid';
  return { buy, text: buy ? 'bought Yes' : 'sold Yes', price: Number(f.price) };
}

/**
 * TESTING's paper tests, the rows its scoreboard and venue cards add after its strategies, in the page's order: the
 * realistic twins and Coinbase's two paper tests. Each is one run's row, added once.
 *
 * No paper Reward quotes row is on TESTING since 0120 (Davies, 2026-10-13: "目前paper testing里的reward quotes全关了吧？感觉都不赚钱
 * 没什么意义？如果你实在觉得还有用的话就转到后台记录，不用在网站上显示了"; none moved to the background): "Reward quotes" (RW-C's run),
 * its variant-1 and variants 2–4 (RW-E's and RW-X's replays of it) and mid-pool left the page with their calls, as
 * mini-pool did with 0103 and live-prep's paper layer on 2026-10-10. Their makers (`rwRow`, `rweRow`, `rwxRows`,
 * `midRow`, `lpRow`) stay for the record and its tests, and a dashboard from a function deployed before 0120 that still
 * carries `rw`, `rwe`, `rwx`, `prep`, `prepMid` or `prepLp` adds nothing for them. LIVE's "Reward quotes" (live-prep's
 * real money, `lpLiveRow`) is LIVE's, never TESTING's, and stays.
 * @param {any} dash
 */
export function paperTestRows(dash) {
  const one = (/** @type {any} */ row) => (row ? [row] : []);
  return [
    ...quotesTwinRows(dash), ...one(quotesCoinbaseRow(dash?.quotesCoinbase)), ...one(quotesCoinbaseRow(dash?.quotesCoinbaseHold)), ...one(quotesCoinbaseRow(dash?.quotesCoinbaseUsdc)), ...one(quotesCoinbaseRow(dash?.quotesCoinbaseNudge)),
    ...quotesOkxRows(dash), ...grokTestRows(dash), ...one(fxwAudRow(dash?.fxwAud)),
  ];
}

/** The outside-Grok test rows' ids among TESTING's rows: this prefix and the test's id (`cxbot`, `igbot`). */
export const GROK_TEST_ROW_PREFIX = '__grok_';

/**
 * "Crypto analyst" (CXBOT, paper on Hyperliquid's public tape, 0161) and "IG Trader" (IGBOT, spread bets on IG's demo, 0157)
 * as rows of TESTING (Davies, 2026-10-29: "在testing列表中把IG Trader…都上线"; `grok_tests_view.ts`): funded is the test's
 * budget ($1,000; £1,000), the money its equity against it (IG Trader's the demo account's change since its arm, never the
 * account's balance), deployed its margin. Before the go its status is the amber "dry-run". null until its table exists.
 * @param {any} g  the dashboard's `cxbot` or `igbot`
 */
export function grokTestRow(g) {
  if (!g?.id) return null;
  const fx = g.ccy === 'GBP' ? Number(g.usdPerUnit) || 0 : 1;
  const budget = Number(g.budget) || 0, deployed = Number(g.deployed) || 0;
  const today = Number(g.today) || 0, unrealised = Number(g.unrealised) || 0, realised = Number(g.realised) || 0, fees = Number(g.fees) || 0;
  /** @param {number} x @param {number} base */
  const pct = (x, base) => (base > 0 ? (x / base) * 100 : null);
  const open = (g.positions ?? []).length;
  const dry = g.mode === 'dry_run';
  // Back in dry-run after a start: the test has ended (its money stays the paper engine's), not "dry-run".
  const ended = dry && g.id === 'cxbot' && !!g.startedAt;
  const where = g.id === 'igbot' ? "IG's demo" : 'paper';
  return {
    id: `${GROK_TEST_ROW_PREFIX}${g.id}`, name: String(g.name), venue: venueLabel(g.venueId), venueId: g.venueId, mode: 'paper',
    capitalUsd: budget * fx, fundedKnown: fx > 0, valueUsd: deployed * fx, costUsd: 0, feesUsd: fees * fx, unrealisedOf: 'deployed',
    todayUsd: today * fx, todayPct: pct(today, budget), unrealisedUsd: unrealised * fx, unrealisedPct: pct(unrealised, deployed),
    realisedUsd: realised * fx, realisedPct: pct(realised, budget),
    ...(g.ccy === 'GBP' ? {
      ccy: 'GBP',
      gbp: { capital: budget, value: deployed, today, todayPct: pct(today, budget), unrealised, unrealisedPct: pct(unrealised, deployed), realised, realisedPct: pct(realised, budget), fees },
    } : {}),
    nextText: 'every minute', openPositions: open, openOrders: Number(g.resting) || 0,
    status: ended
      ? { label: 'ended', running: false, tone: 'stale', detail: `the test has ended after ${g.daysRun ?? 0} days: no new open; anything still held runs to its stop, limit or close` }
      : dry
      ? { label: 'dry-run', running: false, tone: 'stale', detail: g.id === 'igbot' ? "dry-run on IG's demo: orders checked and journalled, none sent" : 'dry-run: the market recorded; orders checked and journalled, none booked; the test starts on Davies\u2019 word' }
      : !g.running
        ? { label: 'paper', running: false, tone: 'stale', detail: g.lagMinutes == null ? 'its record has not read the market yet' : `its record last read the market ${g.lagMinutes} min ago` }
        : g.stops?.totalHit
          ? { label: 'paper', running: true, tone: 'stale', detail: 'its total stop is reached: by its rules it may only close' }
          : { label: 'paper', running: true, tone: 'running', detail: `an outside Grok agent on ${where} · day ${g.daysRun ?? 0}${g.shakedown ? ' (shakedown)' : ''} · ${open} open` },
  };
}

/** The outside-Grok rows, CXBOT's then IGBOT's. @param {any} dash */
export const grokTestRows = (dash) => [dash?.cxbot, dash?.igbot].map(grokTestRow).filter(Boolean);

/** The outside-Grok test a row opens, or null. @param {string | null} selected @param {any} dash */
export function grokTestOf(selected, dash) {
  if (!selected || !selected.startsWith(GROK_TEST_ROW_PREFIX)) return null;
  const id = selected.slice(GROK_TEST_ROW_PREFIX.length);
  const g = id === 'cxbot' ? dash?.cxbot : id === 'igbot' ? dash?.igbot : null;
  return g?.id ? g : null;
}

/**
 * The STATUS tiles of an outside-Grok test's page: the mode, trades, open positions, and the equity against its
 * budget (through `m`, the hide-values mask).
 * @param {any} g @param {(s: string) => string} m
 */
export function grokTestTiles(g, m) {
  const fmt = (/** @type {number} */ x) => (g.ccy === 'GBP' ? fmtGbp(x) : fmtUsd(x));
  return [
    { k: 'MODE', v: g.mode === 'dry_run' ? (g.id === 'cxbot' && g.startedAt ? 'ENDED' : 'DRY-RUN') : g.id === 'igbot' ? 'DEMO' : 'PAPER', note: g.shakedown ? 'shakedown' : null },
    { k: 'TRADES', v: String(Number(g.trades) || 0) },
    { k: 'OPEN', v: String((g.positions ?? []).length), note: Number(g.resting) ? `${g.resting} resting` : null },
    { k: 'EQUITY', v: m(fmt(Number(g.equity) || 0)), note: `of ${m(fmt(Number(g.budget) || 0))}` },
  ];
}

/**
 * A layer's cells on its page: how many brackets are scored (and, for the assigned ones, issued and answered), the agent's
 * Brier and the baseline's, and D = Brier(baseline) − Brier(agent), positive when the agent is better.
 * @param {any} l
 */
export function grokTestLayerCells(l) {
  const f = (/** @type {unknown} */ x) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(3));
  const d = l?.d == null ? null : Number(l.d);
  return {
    label: String(l?.label ?? ''), scored: l?.issued != null ? `${Number(l.scored) || 0} of ${Number(l.answered) || 0} answered, ${Number(l.issued) || 0} issued` : String(Number(l?.scored) || 0),
    brier: l?.brierP == null ? '—' : `${f(l.brierP)} / ${f(l.brierBase)}`, base: String(l?.base ?? ''),
    d: d === null ? '—' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(3)}`, dTone: d === null ? null : d > 0 ? 'gain' : d < 0 ? 'loss' : null,
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
