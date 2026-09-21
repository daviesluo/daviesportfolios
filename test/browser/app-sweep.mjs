// Whole-app browser sweep against the PRODUCTION bundle.
//
// `verify-perf-matrix.mjs` proves the performance panel's arithmetic.
// This one proves the rest of the app still works around it: the
// scoreboard total, the heat map, Top Movers, the transaction history,
// the ticker modal, the view switch, both breakpoints — plus two
// whole-run invariants that catch the class of bug no single assertion
// looks for:
//
//   * ZERO uncaught errors and zero console errors across every step;
//   * EVERY Edge Function call carries the app token.
//
// That second one is the pin for a real outage. The token-gate branch
// started sending `X-App-Token` to `prices` / `chart` / `fundamentals`
// while the deployed functions did not list it in
// `Access-Control-Allow-Headers`, so the browser's preflight killed all
// three. Each has its own quiet fallback, so nothing surfaced an error:
// live prices silently dropped to the CORS proxy chain and the
// scoreboard drifted, the market-conditions panel caught its own
// failure and stayed blank, and the historical series fell back to
// per-ticker proxies so the long ranges came back partial and
// disagreed with the short ones. Three symptoms, one missing header.
//
// Serves the repo root the way Cloudflare Pages does — committed
// index.html + hashed bundle, no dev server, no source transform — so
// what it exercises is the JS that actually ships.
//
// The fixture is small enough that every expected number is arithmetic:
//
//   ACME    10 bought @ 200, 4 sold @ 230  -> 6 @ 240 =  1440.00  USD
//   NOVA     5 bought @ 100                -> 5 @ 120 =   600.00  USD
//   BRIT.L 100 bought @ 2.00 GBP       -> 100 @ 2.50 =   250.00  GBP
//                                        x 1.25 GBPUSD =  312.50  USD
//   VUAA.L   3 bought @ 80 GBP           -> 3 @ 80    =   240.00  GBP
//                                        x 1.25 GBPUSD =  300.00  USD
//   CASH                                                  500.00  USD
//                                              TOTAL =  3152.50  USD
//
//   GONE    closed, no board row, exists only in the T212 fills, so it
//           must appear in the transaction history and nowhere else.
//
// Not part of the build or any gate — it needs Playwright, which the
// app does not depend on. Run it by hand after a UI change:
//
//   npm run build && rm -f assets/*.map sw.js.map workbox-*.js.map
//   mkdir -p /tmp/h && cd /tmp/h && echo '{"type":"module"}' > package.json
//   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright
//   cp /path/to/repo/scraps/verify-app-sweep.mjs . && node verify-app-sweep.mjs /path/to/repo

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// Absolute, always: the path-traversal guard on line ~69 compares the
// resolved file against ROOT with `startsWith`, so a relative ROOT like
// "." rejected every request and the page never loaded. Defaults to the
// repo containing this file, so `npm run verify:browser` works from any
// working directory.
const ROOT = path.resolve(
  process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..'));
const PORT = 8932;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// ---- fixture -------------------------------------------------------

// ---- the clock ------------------------------------------------------
//
// This sweep used to pass only after 20:00 UTC. The APP reads the real
// clock — `usMarketPhase` decides whether an after-hours print is a
// thing that can exist — so section 5's extended-hours assertions held
// during US after-hours and failed every other hour of the day. Same
// build, same code: 4 red at 16:31 UTC, all green at 20:15 UTC. A suite
// that only agrees with itself for four hours a day cannot gate
// anything.
//
// So the instant is pinned, in BOTH places that read a clock: the
// fixture's bar dates (here, in Node) and the page's own `Date`
// (`page.clock.setFixedTime`, in newPage). They have to be the same
// instant or the app is reasoning about bars from a different day.
//
// Thursday 2026-09-17 23:00 UTC = 19:00 ET: a weekday, inside US
// after-hours (16:00-20:00 ET), and late enough that both of ACME's
// after-hours bars (21:00 and 22:30 UTC) are already in the past.
const CLOCK = new Date('2026-09-17T23:00:00Z');
const NOW_MS = CLOCK.getTime();

const dayAgo = (n) => new Date(NOW_MS - n * 86400_000).toISOString().slice(0, 10);

const PORTFOLIO = {
  positions: {
    GK: { label: 'Keeper', subtitle: '', role: 'GK', tickers: ['CASH'] },
    CB: { label: 'Centre back', subtitle: '', role: 'DEF', tickers: ['BRIT.L', 'VUAA.L', '017731'] },
    CM: { label: 'Midfield', subtitle: '', role: 'MID', tickers: ['ACME'] },
    ST: { label: 'Striker', subtitle: '', role: 'FWD', tickers: ['NOVA'] },
  },
  holdings: {
    // A sold-down position: the transaction history must show both
    // sides, and the SELL row is the only one with a realised figure.
    ACME: {
      shares: 6, cost: 200, lastPrice: 240, prevClose: 238, dayPct: 0.84,
      currency: 'USD',
      lots: [{ date: dayAgo(60), shares: 10, cost: 200 }],
      sells: [{ date: dayAgo(40), shares: 4, price: 230 }],
    },
    // Deliberately BELOW the 0.005 flat threshold: it must read flat on
    // the heat map AND be absent from Top Movers. One number, one
    // verdict — a -0.004 % row used to be a dark "no change" tile and a
    // red LOSERS entry printing "-0.00%" at the same time.
    NOVA: {
      shares: 5, cost: 100, lastPrice: 120, prevClose: 120, dayPct: -0.004,
      currency: 'USD',
      lots: [{ date: dayAgo(55), shares: 5, cost: 100 }],
    },
    // Non-USD, so the scoreboard total can only be right if FX is applied.
    'BRIT.L': {
      shares: 100, cost: 2, lastPrice: 2.5, prevClose: 2.4, dayPct: 4.17,
      currency: 'GBP',
      lots: [{ date: dayAgo(50), shares: 100, cost: 2 }],
    },
    // Auto-DCA spare change: must be hidden from the transaction
    // history (155 fractional buys would bury every real decision) but
    // must still count in the scoreboard.
    'VUAA.L': {
      shares: 3, cost: 80, lastPrice: 80, prevClose: 79, dayPct: 1.27,
      currency: 'GBP',
      lots: [{ date: dayAgo(30), shares: 3, cost: 80 }],
    },
    // A CN fund. Its quote is a NAV published after its own close, so
    // the +9.9 % is a real number about a DIFFERENT day — it must count
    // in the scoreboard and appear on the heat map, but never rank in
    // TOP MOVERS - TODAY, where it would sit at the top of WINNERS
    // against stocks measured on today's tape.
    '017731': {
      shares: 200, cost: 1, lastPrice: 1.5, prevClose: 1.365, dayPct: 9.9,
      currency: 'CNY',
      lots: [{ date: dayAgo(45), shares: 200, cost: 1 }],
    },
    CASH: { shares: 1, cost: 0, lastPrice: 500, dayPct: 0, isCash: true },
  },
  depositFxRates: { USD: 1, GBP: 1.25, CNY: 0.1 },
};

//   017731 200 @ 1.50 CNY = 300.00 CNY x 0.10 USDCNY = 30.00 USD
const TOTAL_USD = 1440 + 600 + 312.5 + 300 + 30 + 500; // 3182.50

// A closed round trip the board no longer carries. Only the fills know
// it existed, which is the whole point: the history used to walk
// `holdings`, so a position taken off the board took its trades with it.
const T212_ORDERS = [
  { ticker: 'GONE', side: 'buy', shares: 8, price: 50, executed_at: `${dayAgo(120)}T14:30:00Z` },
  { ticker: 'GONE', side: 'sell', shares: 8, price: 65, executed_at: `${dayAgo(90)}T18:05:00Z` },
  // Two fills on ONE day, out of order, so the history's same-day sort
  // has something to get wrong: it must read 18:05 above 14:30.
  { ticker: 'ACME', side: 'buy', shares: 10, price: 200, executed_at: `${dayAgo(60)}T14:30:00Z` },
];

const QUOTES = {
  // A real after-hours print: 240 -> 247.20 is +3.00 %, and
  // `extPriceTrusted` says so outright so the +-5 % heuristic isn't
  // what the assertion depends on.
  ACME: {
    lastPrice: 240, prevClose: 238, currency: 'USD', dayPct: 0.84,
    extPrice: 247.2, extDayPct: 3, extPriceTrusted: true,
  },
  NOVA: { lastPrice: 120, prevClose: 120, currency: 'USD', dayPct: -0.004 },
  'BRIT.L': { lastPrice: 2.5, prevClose: 2.4, currency: 'GBP', dayPct: 4.17 },
  'VUAA.L': { lastPrice: 80, prevClose: 79, currency: 'GBP', dayPct: 1.27 },
  '^GSPC': { lastPrice: 5200, prevClose: 5150, currency: 'USD', dayPct: 0.97 },
  'GBPUSD=X': { lastPrice: 1.25, prevClose: 1.25, currency: 'USD', dayPct: 0 },
  // 10 CNY to the dollar, so the fund's 300 CNY is a clean $30.
  'USDCNY=X': { lastPrice: 10, prevClose: 10, currency: 'USD', dayPct: 0 },
  '017731': { lastPrice: 1.5, prevClose: 1.365, currency: 'CNY', dayPct: 9.9 },
};

// After-hours print per ticker. `extPriceIsRealAh` will not trust an
// ext quote unless the intraday series actually CONTAINS bars outside
// regular hours and its last close sits within 3 % of the quote — a
// series that stops at 19:55 UTC means "no after-hours tape", and the
// app is right to answer "nobody knows" rather than "unchanged".
const EXT_PRINT = { ACME: 247.2 };

// `sessions` is how many trading days of intraday bars to emit. The
// LAST one is always the three-bar base/mid/last shape the 1D checks
// read, plus its ext prints; earlier ones are flat at `base`, so a
// window opening on any of them opens at the same price the one-day
// fixture opened at and every percentage this harness asserts is
// unchanged. Only 3M asks for more than one: it draws on a four-hour
// grid now, and against a single day of bars it would have had six
// points to draw three months with.
// The session `barsFor` builds its intraday bars in, and that session's
// first bar — 14:00 UTC on it. Recorded rows stop here.
const SESSION_OPEN_MS = (() => {
  const d = new Date(NOW_MS);
  if (d.getUTCHours() < 20) d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(14, 0, 0, 0);
  return d.getTime();
})();

// Each ticker at the price `barsFor` holds it flat at before the current
// session, so a recorded row states exactly what the fetched bars
// already say and no drawn number can move.
const BASE_PRICES = {
  ACME: 200, NOVA: 100, 'BRIT.L': 2, 'VUAA.L': 80, '017731': 100, '^GSPC': 5000,
};

const barsFor = (t, daily, includePrePost = false, sessions = 1) => {
  const base = { ACME: 200, NOVA: 100, 'BRIT.L': 2, 'VUAA.L': 80, '^GSPC': 5000 }[t] ?? 100;
  const last = { ACME: 240, NOVA: 120, 'BRIT.L': 2.5, 'VUAA.L': 80, '^GSPC': 5200 }[t] ?? 100;
  const mid = (base + last) / 2;
  if (daily) {
    return [
      { date: dayAgo(60), close: base },
      { date: dayAgo(30), close: mid },
      { date: dayAgo(1), close: last },
    ];
  }
  const now = new Date(NOW_MS);
  const session = new Date(now);
  if (now.getUTCHours() < 20) session.setUTCDate(session.getUTCDate() - 1);
  const bars = [];
  for (let back = sessions - 1; back >= 0; back--) {
    const day = new Date(session);
    day.setUTCDate(day.getUTCDate() - back);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const at = (hh, mm) => {
      const d = new Date(day);
      d.setUTCHours(hh, mm, 0, 0);
      return d.toISOString().slice(0, 16);
    };
    if (back > 0) {
      bars.push({ date: at(14, 0), close: base });
      bars.push({ date: at(17, 0), close: base });
      bars.push({ date: at(19, 55), close: base });
      continue;
    }
    bars.push({ date: at(14, 0), close: base });
    bars.push({ date: at(17, 0), close: mid });
    bars.push({ date: at(19, 55), close: last });
    if (includePrePost && EXT_PRINT[t] != null) {
      bars.push({ date: at(21, 0), close: EXT_PRINT[t] });
      bars.push({ date: at(22, 30), close: EXT_PRINT[t] });
    }
  }
  return bars;
};

const b64url = (s) => Buffer.from(s).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `${b64url(JSON.stringify({ role: 'admin', exp: NOW_MS + 3600_000 }))}.sig`;

// ---- run -----------------------------------------------------------

/** Functions whose calls MUST carry the app token. */
const TOKEN_REQUIRED = ['/prices', '/chart', '/fundamentals', '/data', '/trading212', '/agents'];

/**
 * The Agents dashboard as the Edge Function shapes it (`runDashboard`):
 * the SEVEN rows migrations 0037-0040 leave active — four on Revolut X,
 * three on Kraken, the retired `dislocation-1m` absent because the
 * dashboard filters it out — with the 4-hour rows carrying the five
 * symbols they now trade, a per-strategy `todayUsd` and the `dayStart`
 * the page reads. One row is long BTC on Kraken with a fill on record, so
 * the page has a position, a decision and an order to draw. A fixture
 * that drifts from the payload tests nothing: this one is checked against
 * `supabase/migrations/0037_agents.sql` (+0038/0039/0040) and the shape
 * `dashboard()` builds in `supabase/functions/agents/index.ts`.
 */
const AGENTS_DASHBOARD = (() => {
  const at = new Date(CLOCK).toISOString();
  const dayStartMs = Math.floor(NOW_MS / 86400_000) * 86400_000;
  const KIND_NAME = { 'trend-4h': 'Trend 4h', 'trend-1h': 'Trend 1h', 'momentum-1d': 'Momentum 30d', 'rotation-1d': 'Rotation' };
  const MAJORS = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
  const TREND = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD', 'SUI/USD'];     // 0039 added AVAX, 0040 added SUI
  const BASKET = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD'];
  const MARK = { 'BTC/USD': 86000, 'ETH/USD': 2500, 'SOL/USD': 110, 'XRP/USD': 0.62, 'AVAX/USD': 17.4, 'SUI/USD': 1.29 };
  // The observation the tick writes every minute on the FORMING bar: the
  // same categorical words a decision would see. 40 s old, so every row
  // reads as running even though the last DECISION is 35 min behind.
  const seen = (symbol, over = {}) => ({
    ts: new Date(CLOCK - 40e3).toISOString(), barStart: new Date(CLOCK - 40e3 - 3600e3).toISOString(),
    state: { symbol, trend_4h: 'up', trend_strength: 'strong', breakout: 'inside_range', volatility: 'normal', momentum_30d: 'positive', position: 'flat', unrealised: 'none', time_in_position: 'none', ...over },
    numbers: { mark: MARK[symbol] ?? 100, close: (MARK[symbol] ?? 100) * 0.999 },
  });
  const flat = (symbol) => ({
    symbol, base: 0, avgCost: 0, mark: MARK[symbol] ?? 100, costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0,
    openedAt: null, highWater: null, fills: 0, observation: seen(symbol),
  });
  const strat = (id, kind, venue, symbols, capitalUsd, over = {}) => ({
    id, kind, venue, signalVenue: 'kraken', nextDecisionAt: new Date(NOW_MS + 2 * 3600e3 + 13 * 60e3).toISOString(),
    name: `${KIND_NAME[kind]} · ${venue === 'revx' ? 'Revolut X' : 'Kraken'}`,
    description: 'Fixture strategy.', symbols, mode: 'paper', capitalUsd,
    params: { fast: 20, slow: 100 }, updatedAt: at,
    costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0,
    positions: symbols.map(flat),
    openOrders: 0, ordersToday: 0, jev24h: { calls: 6, costUsd: 0.00011, avgLatencyMs: 480, providers: { openrouter: 6 } },
    lastDecision: { ts: new Date(CLOCK - 35 * 60e3).toISOString(), symbol: 'BTC/USD', action: 'hold', ruleAction: 'hold', reason: 'in position', provider: 'openrouter', riskAllowed: true, riskReason: 'hold' },
    backtest: null, recentDecisions: [], recentOrders: [], ...over,
  });
  // The one row with a book: long BTC since yesterday, +$0.42 of that move made today.
  const krakenTrend = strat('trend-4h-kraken', 'trend-4h', 'kraken', TREND, 100, {
    costUsd: 20, valueUsd: 21.5, unrealisedUsd: 1.5, realisedUsd: 12.34, feesUsd: 0.08, todayUsd: 0.42, ordersToday: 1,
    positions: [
      { symbol: 'BTC/USD', base: 0.00025, avgCost: 80000, mark: 86000, costUsd: 20, valueUsd: 21.5, unrealisedUsd: 1.5, realisedUsd: 12.34, feesUsd: 0.08, openedAt: CLOCK - 86400e3, highWater: 86500, fills: 3, observation: seen('BTC/USD', { position: 'long', unrealised: 'gain', time_in_position: 'days' }) },
      ...TREND.slice(1).map(flat),
    ],
    recentDecisions: [{
      id: 1, ts: new Date(CLOCK - 35 * 60e3).toISOString(), strategy_id: 'trend-4h-kraken', venue: 'kraken', symbol: 'BTC/USD', mode: 'paper',
      state: { trend_4h: 'up', breakout_4h: 'inside_range', volatility: 'normal', momentum_30d: 'positive', position: 'long' },
      answers: { healthy_trend: { type: 'noul', probability: 0.91 }, caution: { type: 'score', score: 0.1 }, _state: { type: 'choice', choice: 'BTC/USD' } },
      provider: 'openrouter', model: 'typesafe/jev-1.13-20260917', latency_ms: 470, cost_usd: 0.0000184,
      rule_action: 'hold', rule_reason: 'in position', final_action: 'hold', final_reason: 'in position [healthy=0.91]', risk_allowed: true, risk_reason: 'hold',
    }],
    recentOrders: [{
      id: 1, ts: new Date(CLOCK - 86400e3).toISOString(), strategy_id: 'trend-4h-kraken', venue: 'kraken', symbol: 'BTC/USD', mode: 'paper', side: 'buy',
      price: 80000, base_size: 0.00025, state: 'filled', filled_base: 0.00025, avg_fill_price: 80000, fee_usd: 0.08, filled_at: new Date(CLOCK - 86400e3 + 300e3).toISOString(),
    }],
  });
  const strategies = [
    strat('rotation-1d', 'rotation-1d', 'revx', BASKET, 60),
    strat('trend-4h', 'trend-4h', 'revx', TREND, 100),
    strat('trend-1h', 'trend-1h', 'revx', MAJORS, 40),
    strat('momentum-1d', 'momentum-1d', 'revx', MAJORS, 40),
    strat('rotation-1w-kraken', 'rotation-1d', 'kraken', BASKET, 60),
    strat('momentum-1d-kraken', 'momentum-1d', 'kraken', MAJORS, 40),
    krakenTrend,
  ];
  const zero = { costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0 };
  const book = { costUsd: 20, valueUsd: 21.5, unrealisedUsd: 1.5, realisedUsd: 12.34, feesUsd: 0.08, todayUsd: 0.42 };
  const totals = { ...book, byMode: { paper: { ...book }, live: { ...zero } } };
  return {
    at, dayStart: new Date(dayStartMs).toISOString(),
    risk: { id: 1, global_pause: false, max_order_usd: 20, max_exposure_usd: 100, paper_exposure_usd: 300, daily_loss_limit_usd: 5, max_orders_per_day: 40, live_confirmed_at: null, updated_at: at },
    totals,
    venues: [
      { id: 'revx', canTrade: true, feeBps: { maker: 0, taker: 9 }, balances: { USD: 100 }, note: null, marks: { 'BTC/USD': 86000 } },
      { id: 'kraken', canTrade: true, feeBps: { maker: 40, taker: 80 }, balances: { USD: 0, GBP: 75 }, note: null, marks: { 'BTC/USD': 86000 } },
    ],
    strategies, openOrders: [], jev24h: { calls: 24, costUsd: 0.00044, avgLatencyMs: 480, providers: { openrouter: 24 } },
    byVenue: {
      revx: { ...zero, capitalUsd: 240, strategies: 4, live: 0 },
      kraken: { ...book, capitalUsd: 200, strategies: 3, live: 0 },
    },
    basis: {
      'BTC/USD': { latest: 0.31, latestAt: at, n: 288, absP50: 0.4, absP95: 1.2, absMax: 2.1, over20: 0, over40: 0, over80: 0 },
      'ETH/USD': { latest: -0.12, latestAt: at, n: 288, absP50: 0.3, absP95: 1.1, absMax: 1.9, over20: 0, over40: 0, over80: 0 },
      'SOL/USD': { latest: 0.64, latestAt: at, n: 288, absP50: 0.7, absP95: 1.8, absMax: 3.4, over20: 0, over40: 0, over80: 0 },
    },
  };
})();

/**
 * `?action=chart` for one strategy x symbol: 40 hourly candles ending on the
 * current bar, one buy and one sell on record, an order still resting and the
 * decision that opened the position. Pinned to CLOCK like every other
 * fixture, so the chart draws the same picture at any hour of the day.
 */
const AGENTS_CHART = (() => {
  const interval = 3600e3, bars = 40;
  const start = NOW_MS - (bars - 1) * interval;
  const candles = [];
  for (let i = 0; i < bars; i++) {
    const t = start + i * interval;
    const close = 84000 + Math.round(Math.sin(i / 4) * 1500) + i * 40;
    candles.push([t, close - 20, close + 180, close - 200, close]);
  }
  const buy = candles[8], sell = candles[26], restingPrice = candles[bars - 1][4] - 600;
  return {
    strategyId: 'trend-4h-kraken', symbol: 'BTC/USD', venue: 'kraken', signalVenue: 'kraken', kind: 'trend-4h', mode: 'paper',
    intervalMin: 60, since: new Date(start).toISOString(), at: new Date(CLOCK).toISOString(),
    candles,
    fills: [
      { id: 11, ts: new Date(buy[0]).toISOString(), side: 'buy', price: buy[4], base: 0.00025, feeUsd: 0.08, venue: 'kraken', mode: 'paper', marketable: false, decisionId: 21 },
      { id: 12, ts: new Date(sell[0]).toISOString(), side: 'sell', price: sell[4], base: 0.0001, feeUsd: 0.03, venue: 'kraken', mode: 'paper', marketable: true, decisionId: 22 },
    ],
    orders: [
      { id: 11, ts: new Date(buy[0]).toISOString(), side: 'buy', price: buy[4], base: 0.00025, state: 'filled', venue: 'kraken', mode: 'paper', requotes: 0, marketable: false, filledAt: new Date(buy[0]).toISOString(), cancelledAt: null, decisionId: 21 },
      { id: 12, ts: new Date(sell[0]).toISOString(), side: 'sell', price: sell[4], base: 0.0001, state: 'filled', venue: 'kraken', mode: 'paper', requotes: 0, marketable: true, filledAt: new Date(sell[0]).toISOString(), cancelledAt: null, decisionId: 22 },
      { id: 13, ts: new Date(NOW_MS - 2 * interval).toISOString(), side: 'buy', price: restingPrice, base: 0.00015, state: 'new', venue: 'kraken', mode: 'paper', requotes: 1, marketable: false, filledAt: null, cancelledAt: null, decisionId: 23 },
    ],
    decisions: [{ id: 21, ts: new Date(buy[0]).toISOString(), barStart: new Date(buy[0]).toISOString(), action: 'enter', ruleAction: 'enter', reason: 'trend up; model agrees', provider: 'openrouter', riskAllowed: true, kind: 'bar', mark: buy[4] }],
    position: { base: 0.00015, avgCost: buy[4], realisedUsd: 12.34, feesUsd: 0.11, openedAt: new Date(buy[0]).toISOString() },
    observation: {
      ts: new Date(CLOCK - 40e3).toISOString(), barStart: new Date(CLOCK - 40e3 - interval).toISOString(),
      state: { symbol: 'BTC/USD', trend_4h: 'up', trend_strength: 'strong', breakout: 'inside_range', volatility: 'normal', momentum_30d: 'positive', position: 'long', unrealised: 'gain', time_in_position: 'days' },
      numbers: { mark: 86000, close: 85900 },
    },
  };
})();

/** What the dashboard returns before the agents migration has run. */
const AGENTS_NOT_READY = {
  at: new Date(CLOCK).toISOString(), notReady: true,
  reason: 'the agents tables are not in this database yet (migration 0037 runs on merge)',
};
/**
 * Flipped by the agents section to prove the page renders its other
 * states too: `notReady` (the tables are not there yet), `error` (the
 * function fell over: a 500 with the server's envelope), `paused` (the
 * dashboard with a global pause set and a venue reporting a fault).
 */
let agentsMode = /** @type {'ok' | 'notReady' | 'error' | 'paused'} */ ('ok');
/** `SWEEP_SHOTS=<dir>` saves a screenshot at the named points, per viewport — how the page is looked at, not only asserted. */
const SHOTS_DIR = process.env.SWEEP_SHOTS || '';
async function shot(page, name) {
  if (!SHOTS_DIR) return;
  const w = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `${SHOTS_DIR}/${w}-${name}.png`, fullPage: true }).catch(() => {});
}
const AGENTS_PAUSED = () => ({
  ...AGENTS_DASHBOARD,
  risk: { ...AGENTS_DASHBOARD.risk, global_pause: true },
  venues: AGENTS_DASHBOARD.venues.map((v) => (v.id === 'kraken' ? { ...v, note: 'balances: 403 EAPI:Invalid key' } : v)),
});

let failures = 0;
const log = [];
const fail = (scope, msg) => { failures++; const s = `  FAIL [${scope}] ${msg}`; log.push(s); console.log(s); };
const ok = (scope, msg) => { const s = `  ok   [${scope}] ${msg}`; log.push(s); console.log(s); };
const near = (a, b, eps = 0.51) => Math.abs(a - b) <= eps;
const money = (s) => Number(String(s || '').replace(/[^0-9.-]/g, ''));

async function newPage(browser, { width, height }, errors, tokenMisses, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(([token]) => { sessionStorage.setItem('dp.token', token); }, [TOKEN]);
  const page = await ctx.newPage();
  // Freeze `Date` for the page at the same instant the fixture's bars
  // were generated for. Timers still run, so the app's 30 s refresh and
  // the chart's poll behave normally — only "what time is it" is fixed.
  await page.clock.setFixedTime(CLOCK);

  // Every URL the page asks for, recorded OUTSIDE the page. The obvious
  // in-page check — `performance.getEntriesByType('resource')` — reads
  // empty once the clock is pinned, because Playwright's clock takes
  // over the Performance timeline along with `Date`.
  /** @type {string[]} */
  const requested = [];
  page.on('request', (r) => requested.push(r.url()));
  /** @type {any} */ (page).__requested = requested;
  /** @type {any} */ (page).__reported = [];

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    // Playwright reports an aborted request as a console error; those
    // are this harness's own `route.abort()` on third-party hosts, not
    // the app misbehaving.
    if (/Failed to load resource|net::ERR_FAILED/.test(txt)) return;
    // A module the harness answered with HTML on purpose (the poisoned-chunk pass) fails loudly in the console
    // by design; the pass asserts the app's recovery, not the browser's silence.
    if (opts.allowModuleErrors && /not a valid JavaScript MIME type|Failed to fetch dynamically imported module|Failed to load module script|Importing a module script failed|error loading dynamically imported module/.test(txt)) return;
    errors.push(`console.error: ${txt}`);
  });

  await page.route('**/functions/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const hdrs = await req.allHeaders();
    const fn = TOKEN_REQUIRED.find((f) => url.includes(`/functions/v1${f}`));
    if (fn && !hdrs['x-app-token']) tokenMisses.push(fn);

    const json = (body) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
    if (url.includes('/data?') && url.includes('action=load')) return json({ data: PORTFOLIO, version: 1 });
    if (url.includes('/agents?') && url.includes('action=dashboard')) {
      if (agentsMode === 'notReady') return json(AGENTS_NOT_READY);
      if (agentsMode === 'paused') return json(AGENTS_PAUSED());
      if (agentsMode === 'error') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'agents crashed', message: 'db GET agent_strategies → 500: {"code":"57014","message":"canceling statement due to statement timeout"}' }) });
      }
      return json(AGENTS_DASHBOARD);
    }
    if (url.includes('/agents?') && url.includes('action=chart')) {
      const u = new URL(url);
      // The same series whichever pair is asked for — what the checks are
      // about is the drawing, not the prices.
      return json({ ...AGENTS_CHART, strategyId: u.searchParams.get('strategy'), symbol: u.searchParams.get('symbol') });
    }
    if (url.includes('/agents?') && url.includes('action=log')) return json({ strategyId: 'trend-4h', decisions: [], orders: [] });
    if (url.includes('action=price-snapshots')) {
      // Recording began 30 days ago, as it really did (2026-08-19).
      // That is long before the 24H window opens and part-way into the
      // 3-month one, which is exactly what makes the panel's RECORDED
      // rule worth checking: it should have walked all the way left on
      // 24H and should still show a handover on 3M.
      //
      // Every row stops BEFORE the current session's first bar, so
      // these can never change a drawn value — `mergeRecordedBars` is
      // pinned in price_snapshots.test.js and is not what this fixture
      // is for. What it exercises is the PROVENANCE width: the fetch,
      // `recordedFromMs`, `provenanceSplitIndex` and the rendering.
      const u = new URL(url);
      const since = Number(u.searchParams.get('since')) || 0;
      const bucketMs = (Number(u.searchParams.get('bucket')) || 300) * 1000;
      const from = Math.max(since, NOW_MS - 30 * 86400_000);
      const rows = [];
      for (let t = Math.ceil(from / bucketMs) * bucketMs; t <= SESSION_OPEN_MS; t += bucketMs) {
        rows.push({ ts: new Date(t).toISOString(), prices: BASE_PRICES });
      }
      return json({ rows });
    }
    if (url.includes('/data?')) return json({ ok: true, version: 2 });
    if (url.includes('/chart?')) {
      const u = new URL(url);
      const interval = u.searchParams.get('interval') || '1d';
      const daily = /^\d+(d|wk|mo)$/.test(interval);
      const pp = u.searchParams.get('includePrePost') === 'true';
      // Only the 3-month window gets a multi-day intraday series, and
      // it starts exactly where the DAILY fixture starts (60 days
      // back) — so the 3M chart covers the same span, over the same
      // lots, that it did when it drew daily bars, and every existing
      // assertion about it still measures what it measured. Every
      // other range keeps its single session.
      const range = u.searchParams.get('range') || '1d';
      const sessions = range === '3mo' ? 61 : 1;
      const out = {};
      for (const t of (u.searchParams.get('tickers') || '').split(',').filter(Boolean)) {
        out[t] = barsFor(t, daily, pp, sessions);
      }
      return json(out);
    }
    if (url.includes('/prices?')) {
      const u = new URL(url);
      const out = {};
      for (const t of (u.searchParams.get('tickers') || '').split(',').filter(Boolean)) {
        if (QUOTES[t]) out[t] = QUOTES[t];
      }
      return json(out);
    }
    if (url.includes('/trading212')) return json({ source: 'orders', orders: T212_ORDERS, complete: true });
    if (url.includes('/fundamentals')) return json({});
    if (url.includes('/overnight-fetch')) return json({});
    if (url.includes('/ops-error')) {
      // What the app reports is part of what the sweep checks: a healed chunk must arrive as `chunk.load`, never `render.crash`.
      try { const body = req.postDataJSON(); if (body?.kind) /** @type {any} */ (page).__reported.push(String(body.kind)); } catch { /* not JSON */ }
      return json({ ok: true });
    }
    return json({});
  });
  // Registered LAST so Playwright runs it FIRST. `fallback()`, never
  // `continue()` — `continue()` goes to the real network, which is how
  // an earlier harness silently bypassed every mock it had installed.
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`)) return route.continue();
    if (u.includes('/functions/v1/')) return route.fallback();
    return route.abort();
  });

  // A caller's route goes on LAST so Playwright runs it FIRST — the catch-all above `continue()`s
  // every localhost asset, and a route registered before it would never be reached.
  if (opts.beforeGoto) await opts.beforeGoto(page);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.scoreboard-cell-portfolio .sb-value-lg', { timeout: 20_000 });
  return { ctx, page };
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  // Let Playwright resolve its own browser (what CI does after
  // `playwright install chromium`). A container that ships a prebuilt
  // Chromium instead can point at it with PLAYWRIGHT_CHROMIUM_PATH —
  // hardcoding one container's path here made this unrunnable anywhere
  // else, which is part of why it lived in `scraps/` and ran by hand.
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
    args: ['--no-sandbox'],
  });

  const errors = [];
  const tokenMisses = [];

  // ---- 0. a menu page shows its own frame while its code is still arriving ----
  // The agents chunk is held back 700 ms. Clicking Agents at once must put up
  // the page's frame (backdrop, title, close) — never a blank frame that
  // shows the home page through — and the real page must replace it.
  {
    const hold = async (page) => {
      await page.route('**/assets/agents-*.js', async (route) => { await new Promise((r) => setTimeout(r, 700)); await route.continue(); });
    };
    const { ctx, page } = await newPage(browser, { width: 1400, height: 1000 }, errors, tokenMisses, { beforeGoto: hold });
    await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
    await page.waitForTimeout(100);
    const agentsBtn = page.locator('.header-menu-item:text-is("Agents")');
    if (await agentsBtn.count()) {
      await agentsBtn.first().click();
      const frameTitle = await page.locator('.modal .modal-title').first().textContent({ timeout: 300 }).catch(() => '');
      const earlyBoard = await page.locator('.ag-scoreboard').count();
      if (frameTitle.trim() === 'Agents' && earlyBoard === 0) ok('desktop/agents', 'clicking Agents before its code has arrived shows the page\'s own frame, not the home page');
      else fail('desktop/agents', `early frame title "${frameTitle}", scoreboards ${earlyBoard}`);
      const arrived = await page.waitForSelector('.ag-scoreboard', { timeout: 10_000 }).then(() => true).catch(() => false);
      const modalsAfter = await page.locator('.modal').count();
      if (arrived && modalsAfter === 1) ok('desktop/agents', 'the real page replaces the frame in the same modal');
      else fail('desktop/agents', `page arrived ${arrived}, modals ${modalsAfter}`);
    } else fail('desktop/agents', 'no Agents entry in the menu');
    await ctx.close();
  }

  // ---- 0b. a chunk that comes back as the HTML shell heals itself ----------
  // What production did on 2026-09-21: a chunk that did not exist yet was
  // answered with index.html, status 200 and a one-year immutable header, and
  // the browser (then the service worker) kept it. The first request for the
  // holdings chunk is answered exactly that way here. The app must reload
  // itself once (after refreshing the chunk and dropping its caches), report
  // `chunk.load` and never `render.crash`, show no RENDER ERROR screen, and
  // open the page after the reload.
  {
    let poisonedOnce = false;
    const poison = async (page) => {
      await page.route('**/assets/holdings_list-*.js', async (route) => {
        if (!poisonedOnce) {
          poisonedOnce = true;
          return route.fulfill({
            status: 200, contentType: 'text/html; charset=utf-8',
            headers: { 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
            body: '<!DOCTYPE html><html><head><title>shell</title></head><body>the app shell, where a chunk should be</body></html>',
          });
        }
        return route.fallback();
      });
    };
    const { ctx, page } = await newPage(browser, { width: 1400, height: 1000 }, errors, tokenMisses, { beforeGoto: poison, allowModuleErrors: true });
    const reloaded = page.waitForEvent('load', { timeout: 8_000 }).then(() => true).catch(() => false);
    await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
    await page.waitForTimeout(150);
    await page.locator('.header-menu-item:text-is("Holding list")').first().click();
    const didReload = await reloaded;
    const crashScreens = await page.locator('text=RENDER ERROR').count().catch(() => 0);
    if (didReload && poisonedOnce && crashScreens === 0) ok('desktop/recovery', 'a chunk answered with HTML makes the app heal and reload once, with no RENDER ERROR screen');
    else fail('desktop/recovery', `poisoned ${poisonedOnce}, reloaded ${didReload}, crash screens ${crashScreens}`);
    await page.waitForSelector('.scoreboard-cell-portfolio .sb-value-lg', { timeout: 20_000 }).catch(() => {});
    await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
    await page.waitForTimeout(150);
    await page.locator('.header-menu-item:text-is("Holding list")').first().click().catch(() => {});
    const opened = await page.locator('.modal .modal-title:text-is("Holding list")').first().waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
    const rowsAfter = await page.locator('.modal .hl-table tbody tr').first().waitFor({ timeout: 8_000 }).then(() => page.locator('.modal .hl-table tbody tr').count()).catch(() => 0);
    if (opened && rowsAfter > 0) ok('desktop/recovery', `after the reload the page opens on the real chunk (${rowsAfter} rows)`);
    else fail('desktop/recovery', `after the reload: opened ${opened}, rows ${rowsAfter}`);
    const reported = /** @type {any} */ (page).__reported;
    if (reported.includes('chunk.load') && !reported.includes('render.crash')) ok('desktop/recovery', `the failure was reported as chunk.load and not as a crash (${reported.join(', ')})`);
    else fail('desktop/recovery', `reports: ${reported.join(', ') || 'none'}`);
    await ctx.close();
  }

  for (const vp of [{ name: 'desktop', width: 1400, height: 1000 },
                    { name: 'phone', width: 390, height: 844 }]) {
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses);
    const S = (n) => `${vp.name}/${n}`;

    // ---- 1. scoreboard totals the book, with FX applied -------------
    await page.waitForTimeout(1200);
    const sb = money(await page.textContent('.scoreboard-cell-portfolio .sb-value-lg'));
    if (near(sb, TOTAL_USD)) ok(S('scoreboard'), `$${sb} = arithmetic ${TOTAL_USD}`);
    else fail(S('scoreboard'), `reads ${sb}, arithmetic says ${TOTAL_USD} (FX applied?)`);

    // ---- 2. no horizontal overflow at this width --------------------
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over <= 1) ok(S('layout'), 'no horizontal overflow');
    else fail(S('layout'), `page scrolls ${over}px horizontally`);

    // ---- 3. the view switch -----------------------------------------
    // Scoped to the PERFORMANCE tablist by its aria-label: TOP MOVERS
    // carries a `.view-tabs` of its own (%/$) and, in the sidebar,
    // renders above this panel — an unscoped first-match reads that
    // one and reports the perf switch broken while it is working.
    const perfTabs = '.view-tabs[aria-label="Performance view"]';
    const tabSel = `${perfTabs} .view-tab`;
    const tabCount = await page.locator(tabSel).count();
    if (tabCount >= 2) {
      const labels = [...new Set(await page.locator(tabSel).allTextContents())];
      // Both destinations are named at all times — the old ⇄ named neither.
      if (labels.some((l) => /VS S&P/.test(l)) && labels.some((l) => /INVESTMENT/.test(l))) {
        ok(S('view-tabs'), `labels ${JSON.stringify(labels)}`);
      } else fail(S('view-tabs'), `labels ${JSON.stringify(labels)}`);

      const onBefore = await page.locator(`${perfTabs} .view-tab.is-on:visible`).first().textContent();
      await page.locator('#perf-tab-inv:visible').first().click();
      await page.waitForTimeout(400);
      const onAfter = await page.locator(`${perfTabs} .view-tab.is-on:visible`).first().textContent();
      const legend = await page.locator('.perf-lbl:visible').allTextContents();
      if (/INVESTMENT/.test(onAfter || '') && legend.slice(0, 2).join(',') === 'VALUE,DEPOSITED') {
        ok(S('view-tabs'), `switch marks "${onAfter}" and draws ${legend.slice(0, 2)}`);
      } else {
        fail(S('view-tabs'), `after switch tab="${onAfter}" legend=${legend.slice(0, 2)}`);
      }
      // The tabs must not wrap onto a second line at any width. The
      // panel is rendered TWICE — desktop left column and sidebar — so
      // this measures each container separately; comparing tops across
      // both would "find" a wrap that is just two panels.
      const wrapped = await page.evaluate(() =>
        [...document.querySelectorAll('.view-tabs')]
          .filter((c) => c.getBoundingClientRect().width > 0)
          .map((c) => new Set([...c.querySelectorAll('.view-tab')]
            .map((e) => Math.round(e.getBoundingClientRect().top))).size)
          .filter((n) => n !== 1).length);
      if (wrapped === 0) ok(S('view-tabs'), 'both tabs on one line in every panel');
      else fail(S('view-tabs'), `${wrapped} panel(s) wrapped the tabs`);

      // Keyboard: arrows move between them (roving tabindex).
      await page.locator('#perf-tab-inv:visible').first().focus();
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(300);
      const onKb = await page.locator(`${perfTabs} .view-tab.is-on:visible`).first().textContent();
      if (/VS S&P/.test(onKb || '')) ok(S('view-tabs'), 'ArrowLeft returns to vs-S&P');
      else fail(S('view-tabs'), `ArrowLeft left it on "${onKb}" (was "${onBefore}")`);
    } else fail(S('view-tabs'), `found ${tabCount} tabs`);

    // ---- 4. every panel range draws, on both views ------------------
    const seen = { sp: {}, investment: {} };
    for (const view of ['sp', 'investment']) {
      await page.locator(view === 'sp' ? '#perf-tab-sp:visible' : '#perf-tab-inv:visible').first().click();
      await page.waitForTimeout(250);
      for (const label of ['24H', '1W', '1M', '3M', 'YTD']) {
        await page.locator(`.perf-range-btn:visible:text-is("${label}")`).first().click();
        await page.waitForTimeout(350);
        const state = await page.evaluate(() => {
          // The VISIBLE panel — the left column on desktop, the sidebar
          // copy on phone. Reading the hidden one gives a chart that
          // was never laid out, so every path has zero width.
          const panel = [...document.querySelectorAll('.perf-chart-wrap')]
            .find((w) => w.getBoundingClientRect().width > 0)?.closest('.panel');
          const paths = [...(panel?.querySelectorAll('svg path[d^="M"]') || [])];
          return {
            empty: !!panel?.querySelector('.sparkline-empty'),
            lines: paths.length,
            pts: Math.max(0, ...paths.map((p) => (p.getAttribute('d') || '').split(/[ML]/).length - 1)),
            vals: [...(panel?.querySelectorAll('.perf-val') || [])].map((e) => e.textContent),
          };
        });
        if (state.empty) fail(S(`range/${view}/${label}`), 'Insufficient data');
        else if (state.lines < 2) fail(S(`range/${view}/${label}`), `${state.lines} line(s)`);
        else ok(S(`range/${view}/${label}`), `${state.lines} lines, ${state.pts} pts, legend ${state.vals.join(' / ')}`);
        // 3M draws on the four-hour London grid: six points per weekday
        // rather than one per trading day. The fixture serves 40
        // sessions of intraday bars, so ~6 x 40 is the floor here; a
        // regression to a daily grid would put this at ~40.
        if (label === '3M' && !state.empty) {
          if (state.pts >= 150) ok(S(`grid/${view}/3M`), `${state.pts} points — four-hour grid`);
          else fail(S(`grid/${view}/3M`), `${state.pts} points, expected the ~6-a-weekday grid`);
        }
        seen[view][label] = state.vals.map((v) => Number(String(v).replace('%', '')));
        // Provenance: the Investment view fades the stretch it had to
        // RECONSTRUCT from the ledger and Yahoo's bars, and rules off
        // where this account's own recorded samples take over. With
        // recording running for 30 days the 24H window is wholly
        // recorded — no rule at all — while 3M still straddles the
        // start of recording and must show one.
        //
        // The two checks are evidence only TOGETHER, and the 3M one is
        // what carries it. A window with nothing recorded also draws no
        // rule, so "no rule on 24H" passes vacuously against an empty
        // feed — verified by running this suite against `rows: []`,
        // where 24H still passed and 3M failed. 3M passing is what says
        // recorded data reached the panel at all; 24H passing then
        // means its window really is wholly on the recorded side.
        if (view === 'investment' && (label === '24H' || label === '3M')) {
          const ruled = await page.evaluate(() => {
            const panel = [...document.querySelectorAll('.perf-chart-wrap')]
              .find((w) => w.getBoundingClientRect().width > 0)?.closest('.panel');
            return [...(panel?.querySelectorAll('svg text') || [])]
              .some((t) => (t.textContent || '').trim() === 'RECORDED');
          });
          const want = label === '3M';
          if (ruled === want) {
            ok(S(`provenance/${label}`), want
              ? 'RECORDED rule marks the handover'
              : 'no rule — the whole window is recorded');
          } else {
            fail(S(`provenance/${label}`), want
              ? 'no RECORDED rule, but the window starts before recording did'
              : 'a RECORDED rule is still drawn inside a wholly recorded window');
          }
        }
      }
    }

    // The two views answer the same question in different units, so
    // they have to reconcile: the value line's raw move divided by the
    // move in money paid in IS the portfolio's performance. They are
    // only the SAME number when nothing was bought inside the window,
    // which is why asserting equality (as the perf matrix can, with
    // every lot dated before every window) would be too weak here.
    //
    //   (1 + value%) / (1 + deposited%) == 1 + portfolio%
    for (const label of ['24H', '1W', '1M', '3M', 'YTD']) {
      const inv = seen.investment[label], sp = seen.sp[label];
      if (!inv || !sp) continue;
      const lhs = (1 + inv[0] / 100) / (1 + inv[1] / 100);
      const rhs = 1 + sp[0] / 100;
      if (Math.abs(lhs - rhs) < 0.0005) {
        ok(S(`reconcile/${label}`), `value ${inv[0]}% net of deposits ${inv[1]}% = portfolio ${sp[0]}%`);
      } else {
        fail(S(`reconcile/${label}`),
          `value ${inv[0]}% / deposits ${inv[1]}% implies ${((lhs - 1) * 100).toFixed(2)}%,`
          + ` but vs-S&P reports ${sp[0]}%`);
      }
    }

    // ---- 5. heat map, with extended hours off and then on -----------
    await page.locator('.view-toggle .view-switch:visible').first().click();
    await page.waitForTimeout(700);
    const readTiles = () => page.evaluate(() =>
      [...document.querySelectorAll('.hm-tile')].map((t) => ({
        ticker: t.querySelector('.hm-ticker')?.textContent || '',
        pct: t.querySelector('.hm-pct')?.textContent || '',
      })));

    const hm = await readTiles();
    if (hm.length >= 5) ok(S('heatmap'), `${hm.length} tiles`);
    else fail(S('heatmap'), `only ${hm.length} tiles`);
    if (hm.some((x) => x.ticker === '017731')) {
      ok(S('heatmap'), 'the CN fund is still a tile — excluded from ranking, not from the book');
    } else fail(S('heatmap'), 'the CN fund vanished from the heat map');
    const nonZero = hm.filter((t) => t.pct && !/^[+-]?0\.00%$/.test(t.pct) && t.pct !== '—');
    if (nonZero.length > 0) ok(S('heatmap'), `${nonZero.length} tiles show a real move`);
    else fail(S('heatmap'), 'every tile reads 0.00% — the all-zero board is back');
    const novaTile = hm.find((t) => t.ticker === 'NOVA');
    if (novaTile && /^[+-]?0\.00%$/.test(novaTile.pct)) {
      ok(S('heatmap'), `NOVA (-0.004%) renders "${novaTile.pct}" — under the flat threshold`);
    } else if (novaTile) {
      fail(S('heatmap'), `NOVA renders "${novaTile.pct}"`);
    }

    // Extended hours ON. This whole board once went to +0.00% at once,
    // because the T212 sync had widened past its two DCA'd ETFs and
    // overwritten `lastPrice` with the broker's quote — so the ext
    // comparison was the broker's number against itself. The two
    // halves of the contract:
    //   ACME has a trusted after-hours print -> its OWN ext move;
    //   NOVA has none               -> an em dash, NOT a flat 0.00%,
    //                                  because "nobody knows yet" is
    //                                  not the same fact as "unchanged".
    await page.locator('.ext-switch:visible').first().click();
    await page.waitForTimeout(900);
    const hmExt = await readTiles();
    const allFlat = hmExt.length > 0
      && hmExt.every((t) => !t.pct || /^[+-]?0\.00%$/.test(t.pct));
    if (!allFlat) ok(S('heatmap/ext'), `tiles ${hmExt.map((t) => `${t.ticker} ${t.pct}`).join(', ')}`);
    else fail(S('heatmap/ext'), 'every tile reads 0.00% with extended hours on');
    const acmeExt = hmExt.find((t) => t.ticker === 'ACME');
    if (acmeExt && /\+3\.00%/.test(acmeExt.pct)) {
      ok(S('heatmap/ext'), `ACME shows its after-hours move ${acmeExt.pct}`);
    } else if (acmeExt) {
      fail(S('heatmap/ext'), `ACME shows "${acmeExt.pct}" (want +3.00%)`);
    }
    const novaExt = hmExt.find((t) => t.ticker === 'NOVA');
    if (novaExt && novaExt.pct === '—') {
      ok(S('heatmap/ext'), 'NOVA has no ext print and reads an em dash, not 0.00%');
    } else if (novaExt) {
      fail(S('heatmap/ext'), `NOVA reads "${novaExt.pct}" with no ext data (want —)`);
    }
    await page.locator('.ext-switch:visible').first().click();
    await page.waitForTimeout(700);

    // Back to the tactics board.
    await page.locator('.view-toggle .view-switch:visible').first().click();
    await page.waitForTimeout(500);

    // ---- 6. Top Movers agrees with that same threshold --------------
    const movers = await page.evaluate(() =>
      [...document.querySelectorAll('.sidebar .mover-row, .mover-row')]
        .map((r) => r.textContent || ''));
    const zeroMover = movers.find((m) => /[+-]0\.00%/.test(m));
    if (!zeroMover) ok(S('top-movers'), `${movers.length} rows, none reading ±0.00%`);
    else fail(S('top-movers'), `a flat row ranked as a mover: ${zeroMover}`);
    // The CN fund's +9.90 % would top WINNERS outright, and it is not a
    // move that happened today.
    const cnMover = movers.find((m) => /017731/.test(m));
    if (!cnMover) ok(S('top-movers'), 'the CN fund does not rank, despite a +9.90% NAV print');
    else fail(S('top-movers'), `CN fund ranked in TODAY: ${cnMover}`);

    // ---- 6b. the %/$ switch reorders on a DIFFERENT metric ----------
    // Closed-form from the fixture, regular session (ext is back off):
    //   dayChange = shares x (lastPrice - prevClose) x fx
    //   BRIT.L  100 x 0.10 x 1.25 GBPUSD = +$12.50   dayPct +4.17
    //   ACME      6 x 2.00 x 1           = +$12.00   dayPct +0.84
    //   VUAA.L    3 x 1.00 x 1.25        = + $3.75   dayPct +1.27
    // So the two rankings are NOT the same list in a different skin —
    // ACME and VUAA trade places. A panel that showed one order in both
    // modes would be ranking on one metric and mislabelling the other.
    const readMovers = () => page.evaluate(() => {
      const col = [...document.querySelectorAll('.movers-grid')]
        .find((g) => g.getBoundingClientRect().width > 0)?.children[0];
      return {
        tickers: [...(col?.querySelectorAll('.mover-ticker') || [])].map((e) => e.textContent),
        vals: [...(col?.querySelectorAll('.mover-val') || [])].map((e) => e.textContent),
        bars: [...(col?.querySelectorAll('.mover-bar') || [])].map((e) => parseFloat(e.style.width)),
      };
    });
    const byPct = await readMovers();
    if (byPct.tickers.join(',') === 'BRIT,VUAA,ACME') {
      ok(S('top-movers'), `% ranks ${byPct.tickers.join(' > ')} (${byPct.vals.join(' ')})`);
    } else fail(S('top-movers'), `% ranks ${byPct.tickers.join(',')} (want BRIT,VUAA,ACME)`);

    await page.locator('#movers-tab-usd:visible').first().click();
    await page.waitForTimeout(350);
    const byUsd = await readMovers();
    if (byUsd.tickers.join(',') === 'BRIT,ACME,VUAA') {
      ok(S('top-movers'), `$ ranks ${byUsd.tickers.join(' > ')} (${byUsd.vals.join(' ')})`);
    } else fail(S('top-movers'), `$ ranks ${byUsd.tickers.join(',')} (want BRIT,ACME,VUAA)`);
    // Every figure is money, signed, and the column's sign is uniform.
    if (byUsd.vals.length && byUsd.vals.every((v) => /^\+\$[\d,]+$/.test(v || ''))) {
      ok(S('top-movers'), `$ figures ${byUsd.vals.join(' ')}`);
    } else fail(S('top-movers'), `$ figures malformed: ${byUsd.vals.join(' ')}`);
    // The leader fills the row; the rest are proportional to it, not to
    // their own neighbours.
    const barsOk = byUsd.bars.length === 3
      && Math.abs(byUsd.bars[0] - 100) < 0.5
      && byUsd.bars[0] > byUsd.bars[1] && byUsd.bars[1] > byUsd.bars[2];
    if (barsOk) ok(S('top-movers'), `bars ${byUsd.bars.map((b) => b.toFixed(0) + '%').join(' ')}`);
    else fail(S('top-movers'), `bars ${JSON.stringify(byUsd.bars)}`);

    // ---- 6b-2. the WINDOW row re-ranks, and leaves the chart alone --
    // Still on $. A longer window measures the HOLDING period, not the
    // stock: a lot bought before the window opens carries the
    // window-start close as its basis, one bought inside it carries its
    // own cost. Every lot in this fixture predates the 1M window AND was
    // bought at that window's opening price, so the two readings give
    // the same numbers here — the case where they DIVERGE is pinned
    // closed-form in movers.test.js and header_sidebar.test.jsx
    // (a position bought two days ago reads +7.14 %, not the +50.00 %
    // the stock itself did). What this checks is that the window
    // control drives the panel at all.
    //
    //   ACME    6 x (240 - 200) x 1        = +$240
    //   NOVA    5 x (120 - 100) x 1        = +$100
    //   BRIT.L  100 x (2.5 - 2) x 1.25     =  +$63
    //   VUAA.L  opens and closes at 80     — flat, so it does not rank
    const windows = await page.locator('.movers-window .view-tab:visible').allTextContents();
    if (windows.join(',') === 'TODAY,1W,1M,3M') {
      ok(S('movers-window'), `offers ${windows.join(' ')}`);
    } else fail(S('movers-window'), `window row reads ${windows.join(',')}`);

    const activeChartRange = () => page.evaluate(() => {
      const row = [...document.querySelectorAll('.perf-range-row')]
        .find((r) => r.getBoundingClientRect().width > 0);
      return row?.querySelector('.perf-range-btn.on')?.textContent || '';
    });
    const chartRangeBefore = await activeChartRange();
    await page.locator('.movers-window .view-tab:visible:text-is("1M")').first().click();
    await page.waitForTimeout(500);
    const overMonth = await readMovers();


    if (overMonth.tickers.join(',') === 'ACME,NOVA,BRIT'
        && overMonth.vals.join(' ') === '+$240 +$100 +$63') {
      ok(S('movers-window'), `1M ranks ${overMonth.tickers.join(' > ')} (${overMonth.vals.join(' ')})`);
    } else {
      fail(S('movers-window'),
        `1M ranks ${overMonth.tickers.join(',')} ${overMonth.vals.join(' ')}`
        + ' (want ACME,NOVA,BRIT +$240 +$100 +$63)');
    }
    // The movers window switch and the chart's range row both answer to
    // a "1M" label. They must not answer to one SELECTOR: the window
    // buttons once carried `.perf-range-btn` too, and a
    // `:text-is("1M")` click landed on whichever came first in the DOM
    // — the chart on desktop, the sidebar on a phone. The panels
    // disagreed by breakpoint.
    const chartRangeAfter = await activeChartRange();
    if (chartRangeAfter === chartRangeBefore) {
      ok(S('movers-window'), `the chart stayed on ${chartRangeAfter || '(none)'}`);
    } else {
      fail(S('movers-window'),
        `picking a movers window moved the chart from ${chartRangeBefore} to ${chartRangeAfter}`);
    }

    // Back to TODAY / % so the rest of the run sees the default state.
    await page.locator('.movers-window .view-tab:visible:text-is("TODAY")').first().click();
    await page.waitForTimeout(250);
    await page.locator('#movers-tab-pct:visible').first().click();
    await page.waitForTimeout(250);

    // ---- 6c. the split modal chunks are PREFETCHED, not fetched on click
    // The four modals live in their own chunks so the main bundle stays
    // under budget. That is only acceptable if the code is already in
    // memory when the user clicks: a panel that has to fetch itself
    // first is the same defect as one that paints an empty state and
    // fills in afterwards. Nothing below has opened a modal yet, so a
    // resource entry here can only have come from the prefetch.
    const requestedChunks = (/** @type {any} */ (page).__requested || [])
      .filter((/** @type {string} */ n) => /\/assets\/(ticker_chart_modal|transaction_history|holdings_list|sectors_list|agents)-/.test(n))
      .map((/** @type {string} */ n) => (n.split('/').pop() || '').replace(/-[a-f0-9]+\.js$/, ''));
    const want = ['ticker_chart_modal', 'transaction_history', 'holdings_list', 'sectors_list', 'agents'];
    const missing = want.filter((w) => !requestedChunks.includes(w));
    if (missing.length === 0) ok(S('chunks'), 'all five modal chunks prefetched before any click');
    else fail(S('chunks'), `not prefetched: ${missing.join(', ')}`);

    // ---- 7. transaction history -------------------------------------
    await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
    await page.waitForTimeout(200);
    const histBtn = page.locator('.header-menu-item:text-is("Transaction history")');
    if (await histBtn.count()) {
      await histBtn.first().click();
      await page.waitForSelector('.txn-table', { timeout: 10_000 });
      const tx = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.txn-row')];
        return {
          headers: [...document.querySelectorAll('.txn-table .hl-th')].map((e) => e.textContent?.trim()),
          symbols: rows.map((r) => r.querySelector('[data-col="symbol"]')?.textContent?.trim()),
          kinds: rows.map((r) => r.className.includes('txn-row-sell') ? 'sell' : 'buy'),
          realised: rows.map((r) => r.querySelector('[data-col="realised"]')?.textContent?.trim() ?? ''),
        };
      });
      const syms = new Set(tx.symbols);
      if (!syms.has('VUAA.L') && !syms.has('SAEM.L')) ok(S('history'), 'auto-DCA tickers hidden');
      else fail(S('history'), `auto-DCA ticker listed: ${[...syms].join(',')}`);
      if (syms.has('GONE')) ok(S('history'), 'closed position GONE is in the record');
      else fail(S('history'), `closed position missing; saw ${[...syms].join(',')}`);
      if (syms.has('ACME')) ok(S('history'), 'ACME buy + sell present');
      else fail(S('history'), 'ACME missing');
      // Realised G/L belongs to sells only.
      const buyWithRealised = tx.kinds
        .map((k, i) => (k === 'buy' && tx.realised[i] ? tx.symbols[i] : null)).filter(Boolean);
      if (buyWithRealised.length === 0) ok(S('history'), 'BUY rows leave Realised G/L blank');
      else fail(S('history'), `BUY rows carry a realised figure: ${buyWithRealised.join(',')}`);

      // Every column sorts, and the cycle returns to where it started.
      // On phone the `<th>` row is deliberately hidden and the chip bar
      // is the sort control instead, so drive whichever is on screen —
      // a probe that only knows the desktop header would report the
      // phone layout as broken sorting rather than as a different UI.
      const hdrs = (await page.locator('.txn-table .hl-th-sortable:visible').count())
        ? page.locator('.txn-table .hl-th-sortable:visible')
        : page.locator('.txn-sort-chip:visible');
      const n = await hdrs.count();
      let sortFails = 0;
      for (let i = 0; i < n; i++) {
        const before = await page.evaluate(() =>
          [...document.querySelectorAll('.txn-row')].map((r) => r.textContent).join('|'));
        await hdrs.nth(i).click(); await page.waitForTimeout(120);
        const desc = await page.evaluate(() =>
          [...document.querySelectorAll('.txn-row')].map((r) => r.textContent).join('|'));
        await hdrs.nth(i).click(); await page.waitForTimeout(120);
        const asc = await page.evaluate(() =>
          [...document.querySelectorAll('.txn-row')].map((r) => r.textContent).join('|'));
        await hdrs.nth(i).click(); await page.waitForTimeout(120);
        const back = await page.evaluate(() =>
          [...document.querySelectorAll('.txn-row')].map((r) => r.textContent).join('|'));
        if (back !== before) { sortFails++; fail(S('history'), `header ${i} did not return to default order`); }
        if (desc === asc && desc === before) { sortFails++; fail(S('history'), `header ${i} never reordered anything`); }
      }
      if (sortFails === 0) ok(S('history'), `all ${n} sort controls cycle desc -> asc -> default`);

      // A symbol still on the board opens its chart.
      const acme = page.locator('.txn-sym-btn:visible:text-is("ACME")');
      if (await acme.count()) {
        await acme.first().click();
        await page.waitForTimeout(800);
        const modal = await page.locator('.modal-title').first().textContent().catch(() => '');
        if (/ACME/.test(modal || '')) ok(S('history'), 'symbol opens the ticker modal');
        else fail(S('history'), `symbol click left modal title "${modal}"`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else fail(S('history'), 'ACME symbol is not clickable');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else fail(S('history'), 'Transaction history menu item not found');

    // ---- 8. agents ----------------------------------------------------
    // The page is the Edge Function's dashboard, formatted: the headline
    // must be the fixture's realised total, every strategy a row, and a
    // row must open the detail with the position and the decision the
    // fixture carries. The mask toggle is not exercised here; it reuses
    // maskDigits, which the transaction history already proves.
    await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
    await page.waitForTimeout(200);
    const agentsBtn = page.locator('.header-menu-item:text-is("Agents")');
    if (await agentsBtn.count()) {
      await agentsBtn.first().click();
      await page.waitForSelector('.ag-scoreboard', { timeout: 10_000 });
      const head = await page.locator('.ag-sb-realised .ag-sb-usd').first().textContent().catch(() => '');
      await shot(page, 'agents-list');
      if (money(head) === 12.34 && /^\+/.test((head || '').trim())) ok(S('agents'), `headline is the realised total (${(head || '').trim()})`);
      else fail(S('agents'), `headline read "${head}", wanted +$12.34`);
      const rows = await page.locator('.ag-row').count();
      if (rows === 7) ok(S('agents'), 'seven strategy rows — the active seeds, the retired one absent');
      else fail(S('agents'), `expected 7 strategy rows, got ${rows}`);
      // Every row's last DECISION is 35 min old — two of the trend rule's
      // bars would call that stale. What keeps them running is the
      // observation the tick wrote 40 s ago.
      const running = await page.locator('.ag-row .ag-name-wrap .ag-dot-running').count();
      const statusCol = await page.locator('.ag-strategies .ag-col-status, .ag-row .ag-status').count();
      if (running === rows && statusCol === 0) ok(S('agents'), 'a 40 s-old observation keeps every row\'s dot green, beside the name, with no status column');
      else fail(S('agents'), `running dots: ${running} of ${rows}, status cells ${statusCol}`);
      const watching = await page.locator('.ag-row .ag-name-wrap .ag-dot').first().getAttribute('title');
      if (/watching · changed \d+s ago/.test(watching || '')) ok(S('agents'), `the dot's title says what it is doing ("${watching}")`);
      else fail(S('agents'), `dot title reads "${watching}"`);
      const eyebrows = await page.locator('.modal-eyebrow').count();
      if (eyebrows === 0) ok(S('agents'), 'no small-caps eyebrow above the page title');
      else fail(S('agents'), `${eyebrows} eyebrow lines`);
      const howCount = await page.locator('.ag-how').count();
      const titleNotes = await page.locator('.ag-section-title .dim').count();
      if (howCount === 0 && titleNotes === 0) ok(S('agents'), 'no explainer and no annotation beside any section title');
      else fail(S('agents'), `explainer blocks ${howCount}, annotated titles ${titleNotes}`);
      const nameBtns = await page.locator('.ag-row .ag-name-btn').count();
      if (nameBtns === rows) ok(S('agents'), 'every strategy name is a real button');
      else fail(S('agents'), `name buttons ${nameBtns} of ${rows}`);
      const vpWidth = page.viewportSize()?.width ?? 0;
      const tableN = await page.locator('.ag-strategies table.ag-table').count();
      const cardN = await page.locator('.ag-card-strategy').count();
      const glCells = await page.locator('.ag-strategies .ag-gl').allTextContents();
      if (vpWidth <= 760 ? (tableN === 0 && cardN === rows) : (tableN === 1 && cardN === 0)) {
        ok(S('agents'), vpWidth <= 760 ? `a phone gets a card per strategy (${cardN})` : 'a desktop gets the table');
      } else fail(S('agents'), `layout at ${vpWidth}px: tables ${tableN}, cards ${cardN}`);
      if (glCells.length === rows * 3 && glCells.every((g) => /^[+-]?\$[\d,.]+( \([+-]?[\d.]+%\))?$/.test(g.trim()))) {
        ok(S('agents'), `today, unrealised and realised read like the scoreboard ("${glCells[0].trim()}")`);
      } else fail(S('agents'), `G/L cells: ${glCells.join(' | ')}`);
      const todayHead = await page.locator('.ag-strategies th.ag-col-today').count();
      if (vpWidth <= 760 ? true : todayHead === 1) ok(S('agents'), vpWidth <= 760 ? 'the card carries today' : 'the table has a Today column');
      else fail(S('agents'), `Today header cells: ${todayHead}`);
      // Today is the one cell a fixture of all zeros cannot test: the payload carries +$0.42 on the row with a book.
      const sbToday = await page.locator('.ag-scoreboard .ag-sb-cell', { has: page.locator('.sb-label:text-is("TODAY")') }).locator('.ag-sb-usd').textContent().catch(() => '');
      const rowToday = (await page.locator(vpWidth <= 760 ? '.ag-card-strategy .ag-gl' : 'td.ag-col-today .ag-gl').allTextContents()).map((t) => t.trim());
      const signedToday = rowToday.filter((t) => /^\+\$0\.42/.test(t)).length;
      if (money(sbToday) === 0.42 && /^\+/.test((sbToday || '').trim()) && signedToday === 1) {
        ok(S('agents'), `today is a signed number on the scoreboard (${(sbToday || '').trim()}) and on the row that has a book`);
      } else fail(S('agents'), `scoreboard today "${sbToday}", row today cells ${rowToday.join(' | ')}`);
      const badgeTexts = await page.locator('.ag-strategies .ag-venue').allTextContents();
      if (badgeTexts.length === rows && badgeTexts.every((b) => /^(Revolut X|Kraken)$/.test(b.trim()))) ok(S('agents'), 'the venue badge is the venue name alone');
      else fail(S('agents'), `badges: ${badgeTexts.join(' | ')}`);
      // The badge fits its cell: a cell that clips draws the first dot of an ellipsis after the badge — the
      // "small white dot" beside Revolut X the owner saw — so overflow must be zero, not just invisible.
      const clippedVenue = vpWidth > 760
        ? await page.locator('.ag-strategies td.ag-col-venue').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth || getComputedStyle(el).textOverflow === 'ellipsis').length)
        : 0;
      if (clippedVenue === 0) ok(S('agents'), vpWidth > 760 ? 'every venue badge fits its cell, nothing clipped or ellipsised' : 'no venue column on a phone');
      else fail(S('agents'), `${clippedVenue} venue cells clip their badge`);
      const sectionTitle = (await page.locator('.ag-strategies .ag-section-title').allTextContents()).map((t) => t.trim());
      const liveTables = await page.locator('.ag-strategies-live').count();
      if (sectionTitle.length === 1 && /^TESTING STRATEGIES/.test(sectionTitle[0]) && liveTables === 0) {
        ok(S('agents'), `nothing is live, so the page says so once ("${sectionTitle[0]}") and shows no live table`);
      } else fail(S('agents'), `strategy sections: ${sectionTitle.join(' | ')}, live tables ${liveTables}`);
      if (vpWidth > 760) {
        const nameAlign = await page.locator('.ag-strategies td.ag-col-name').first().evaluate((el) => getComputedStyle(el).textAlign);
        if (nameAlign === 'left') ok(S('agents'), 'the strategy name reads from the left, under the dot beside it');
        else fail(S('agents'), `name column text-align ${nameAlign}`);
      }
      const sbCells = await page.locator('.ag-scoreboard .sb-label').allTextContents();
      if (sbCells.join('|') === 'DEPLOYED|TODAY|UNREALIZED G/L|REALIZED G/L (incl. fees $0.08)') {
        ok(S('agents'), 'four cells, no total, and the fees ride on the realised label');
      } else fail(S('agents'), `scoreboard cells: ${sbCells.join(' | ')}`);
      const under = await page.locator('.ag-sb-under').count();
      if (under === 0) ok(S('agents'), 'no explanatory line under the scoreboard');
      else fail(S('agents'), `${under} sub-lines under the scoreboard`);
      const cardLabels = await page.locator('.ag-venue-card-kraken .ag-venue-grid > .dim').allTextContents();
      if (cardLabels.includes('unrealised') && cardLabels.includes('realised') && !cardLabels.some((t) => /total/.test(t))) ok(S('agents'), 'a venue card shows unrealised and realised, no total');
      else fail(S('agents'), `venue card rows: ${cardLabels.join(' | ')}`);
      const stripN = await page.locator('.ag-chip').count();
      const basisN = await page.locator('.ag-basis').count();
      if (stripN === 0 && basisN === 0) ok(S('agents'), 'no caps / Jev strip and no basis table on the overview');
      else fail(S('agents'), `strip chips ${stripN}, basis sections ${basisN}`);
      const alertsAtRest = await page.locator('.ag-alert').count();
      if (alertsAtRest === 0) ok(S('agents'), 'no banner when nothing blocks trading');
      else fail(S('agents'), `${alertsAtRest} alert banners on a healthy dashboard`);
      // Every row says where it trades; the split says how the book divides.
      const badges = await page.locator('.ag-row .ag-venue').allTextContents();
      const revxRows = badges.filter((b) => b.startsWith('Revolut X')).length, krakenRows = badges.filter((b) => b.startsWith('Kraken')).length;
      if (revxRows === 4 && krakenRows === 3) ok(S('agents'), 'venue badge on every row: 4 Revolut X, 3 Kraken');
      else fail(S('agents'), `venue badges: ${badges.join(' | ')}`);
      const shares = await page.locator('.ag-share').allTextContents();
      if (shares.some((t) => /Kraken 100%/.test(t))) ok(S('agents'), 'share bar: all deployed value sits on Kraken');
      else fail(S('agents'), `share bar reads ${shares.join(' | ')}`);
      const cards = await page.locator('.ag-venue-card').count();
      if (cards === 2) ok(S('agents'), 'one venue card per account');
      else fail(S('agents'), `venue cards ${cards}`);
      const funded = await page.locator('.ag-venue-card-revx .ag-venue-grid').textContent().catch(() => '');
      if (/\$100\.00 USD/.test(funded || '')) ok(S('agents'), 'the Revolut X card shows its funding');
      else fail(S('agents'), `revx card reads "${funded}"`);
      const krFunded = await page.locator('.ag-venue-card-kraken .ag-funded').textContent().catch(() => '');
      if (/£75\.00 GBP/.test(krFunded || '')) ok(S('agents'), 'the Kraken card names a GBP balance as pounds');
      else fail(S('agents'), `kraken funded reads "${krFunded}"`);
      // Four rules count down to a bar close; the minute rule decides every
      // minute, which is a rhythm, not a countdown.
      const nexts = await page.locator('.ag-row .ag-next').allTextContents();
      if (nexts.length === rows && nexts.every((t) => t === '2h 13m')) ok(S('agents'), 'every rule counts down to its next bar close');
      else fail(S('agents'), `next column: ${nexts.join(' | ')}`);
      const names = await page.locator('.ag-row .ag-name-btn').allTextContents();
      const subs = await page.locator('.ag-row .ag-name-cell .hl-sub').allTextContents();
      const named = ['Rotation · Revolut X', 'Trend 4h · Revolut X', 'Trend 1h · Revolut X', 'Momentum 30d · Revolut X', 'Rotation · Kraken', 'Momentum 30d · Kraken', 'Trend 4h · Kraken'];
      if (named.every((n) => names.some((t) => t.trim() === n)) && !names.some((t) => /Dislocation/.test(t)) && subs.length === names.length && subs.every((t) => /^\d+ open · /.test(t))) {
        ok(S('agents'), 'every live rulebook is named on its row, once, with the sub-line under it — and the retired one is not on the page');
      } else fail(S('agents'), `names ${names.join(' | ')}; sub-lines ${subs.join(' | ')}`);
      const tableScroll = vpWidth > 760 ? await page.locator('.ag-strategies .hl-scroll').evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => 0) : 0;
      if (tableScroll <= 0) ok(S('agents'), vpWidth > 760 ? `the strategy table fits its width on desktop (overflow ${tableScroll}px)` : 'no table to overflow on a phone');
      else fail(S('agents'), `the strategy table overflows by ${tableScroll}px at ${vpWidth}px`);
      // By NAME, not by index: a migration that adds a row must not silently point this at a different strategy.
      await page.locator('.ag-row', { has: page.locator('.ag-name-btn:text-is("Trend 4h · Kraken")') }).first().click();
      await page.waitForSelector('.ag-detail', { timeout: 5_000 });
      const title = await page.locator('.ag-detail-title').first().textContent().catch(() => '');
      if (/Trend 4h · Kraken/.test(title || '')) ok(S('agents'), `the row with a book opens its detail (${(title || '').trim()})`);
      else fail(S('agents'), `detail title "${title}"`);
      // One table on the detail, not three: the positions table and the decisions table said the same
      // things the cards and the live-state row already say, and the orders table now lives under the chart.
      // The orders table keeps its own class and is now inside the chart card; what must be gone is the positions
      // table, the decisions table, and any SECOND log table at the bottom of the page.
      const posTables = await page.locator('.ag-positions').count();
      const logTables = await page.locator('.ag-log').count();
      const logsInChart = await page.locator('.ag-chart-card .ag-log').count();
      const posCards = await page.locator('.ag-poscard').count();
      if (posTables === 0 && logTables === 1 && logsInChart === 1 && posCards === 1) {
        ok(S('agents'), 'one position card, one orders table, and it sits under the chart — no positions or decisions table');
      } else fail(S('agents'), `positions tables ${posTables}, log tables ${logTables} (${logsInChart} under the chart), position cards ${posCards}`);
      const cardRows = await page.locator('.ag-poscard .pc-row .dim').allTextContents();
      if (cardRows.join('|') === 'Size|Avg cost|Cost|Value|Held') ok(S('agents'), 'the position card is the board\'s own card, row for row');
      else fail(S('agents'), `card rows: ${cardRows.join(' | ')}`);
      // ---- the detail chart --------------------------------------
      // Symbol tabs, the chart for the one selected, its fills as rows, and
      // the words the rule is reading on the forming bar.
      // A missing chart is a FAIL like any other, not a thrown timeout that
      // takes the rest of the run (and both invariants) down with it — which
      // is what a stale committed bundle would otherwise do.
      const chartUp = await page.waitForSelector('.ag-chart-svg', { timeout: 5_000 }).then(() => true).catch(() => false);
      if (!chartUp) fail(S('agents'), 'the detail never drew its chart svg');
      const tabs = await page.locator('.ag-sym-tab').allTextContents();
      const tabOn = await page.locator('.ag-sym-tab.is-on').allTextContents();
      if (tabs.length === 5 && tabOn.length === 1 && /^BTC\/USD/.test(tabOn[0] || '')) {
        ok(S('agents'), 'one symbol tab per pair — five since AVAX and SUI joined — opening on the one that is held');
      } else fail(S('agents'), `tabs ${tabs.join(' | ')}, selected ${tabOn.join(' | ')}`);
      const marks = await page.locator('.ag-chart-svg .ag-fill-mark').count();
      const buyMarks = await page.locator('.ag-chart-svg .ag-fill-buy').count();
      const sellMarks = await page.locator('.ag-chart-svg .ag-fill-sell').count();
      if (marks === 2 && buyMarks === 1 && sellMarks === 1) ok(S('agents'), 'the chart marks both fills, buy and sell apart');
      else fail(S('agents'), `fill marks: ${marks} (${buyMarks} buy, ${sellMarks} sell)`);
      const gridlines = await page.locator('.ag-chart-svg text.ag-axis').count();
      if (gridlines >= 4) ok(S('agents'), `the chart is labelled on both axes (${gridlines} axis labels)`);
      else fail(S('agents'), `only ${gridlines} axis labels`);
      const legend = await page.locator('.ag-chart-legend .ag-legend-item').allTextContents();
      if (legend.includes('buy fill') && legend.includes('sell fill') && legend.includes('resting order')) {
        ok(S('agents'), 'the two mark kinds and the resting order are named in words');
      } else fail(S('agents'), `legend: ${legend.join(' | ')}`);
      const ordRowsN = await page.locator('.ag-fills tbody tr').count();
      const sides = await page.locator('.ag-fills .ag-side').allTextContents();
      const heads = (await page.locator('.ag-fills thead th').allTextContents()).map((t) => t.trim());
      if (ordRowsN === 3 && sides.join(',') === 'buy,sell,buy') ok(S('agents'), 'every order on the pair, newest first, the resting one included');
      else fail(S('agents'), `orders table: ${ordRowsN} rows, sides ${sides.join(' | ')}`);
      // It IS the old ORDERS table, moved: same eleven columns in the same order, with two changes — Cost for
      // Notional, and the side wearing the chart's arrow instead of a word badge.
      const want = ['When', 'Symbol', 'Venue', 'Side', 'Price', 'Size', 'Cost', 'State', 'Fill', 'Fee', 'Mode'];
      const arrows = await page.locator('.ag-fills tbody .ag-side .ag-side-mark').count();
      const oldSideBadges = await page.locator('.ag-fills tbody .txn-badge').count();
      if (heads.length === 11 && heads.slice(1).join(',') === want.slice(1).join(',') && /^When \((BST|GMT)\)$/.test(heads[0] || '') && arrows === ordRowsN && oldSideBadges === 0) {
        ok(S('agents'), `the ORDERS table, moved under the chart: Cost for Notional, the chart's arrow for the side badge, UK local time ("${heads[0]}")`);
      } else fail(S('agents'), `order table headers: ${heads.join(' | ')}; arrows ${arrows}, old badges ${oldSideBadges}`);
      const restingState = await page.locator('.ag-fills tbody tr').first().locator('.ag-state-pill').textContent().catch(() => '');
      if ((restingState || '').trim() === 'new') ok(S('agents'), 'the resting order is on the table with its state');
      else fail(S('agents'), `first row state "${restingState}"`);
      // Every cell centred, header and body: these tables are read down a column.
      const offCentre = await page.locator('.ag-detail .ag-table th, .ag-detail .ag-table td')
        .evaluateAll((els) => els.filter((el) => getComputedStyle(el).textAlign !== 'center').length);   // the detail has no name column
      if (offCentre === 0) ok(S('agents'), 'every cell in the detail\'s table is centred');
      else fail(S('agents'), `${offCentre} cells are not centred`);
      const liveRows = await page.locator('.ag-live-row').count();
      const pills = await page.locator('.ag-live-row .ag-pill').count();
      const firstPills = await page.locator('.ag-live-row').first().locator('.ag-pill').allTextContents();
      if (liveRows === 5 && pills >= 15 && firstPills.some((t) => /trend4hup/.test(t.replace(/\s+/g, '')))) {
        ok(S('agents'), `the live state renders as pills, one row per symbol (${pills} pills over ${liveRows} symbols)`);
      } else fail(S('agents'), `live state: ${liveRows} rows, ${pills} pills, first ${firstPills.join(' | ')}`);
      const ages = await page.locator('.ag-live-row .ag-live-age').allTextContents();
      // `.every` on an empty list is vacuously true, so the length is part of the check.
      if (ages.length === 5 && ages.every((t) => /^Last change: \d+ (secs|mins?) ago$/.test(t.trim()))) ok(S('agents'), `each reading says when its words last changed, one phrasing ("${(ages[0] || '').trim()}")`);
      else fail(S('agents'), `observation ages: ${ages.join(' | ')}`);
      const countdown = await page.locator('.ag-countdown-val').textContent().catch(() => '');
      if (/^\d+h \d{2}m \d{2}s$/.test((countdown || '').trim())) ok(S('agents'), `the detail counts down to the next decision to the second (${(countdown || '').trim()})`);
      else fail(S('agents'), `countdown reads "${countdown}"`);
      const tiles = await page.locator('.ag-poscard').count();
      const tileSym = await page.locator('.ag-poscard .pc-ticker').first().textContent().catch(() => '');
      if (tiles === 1 && /BTC\/USD/.test(tileSym || '')) ok(S('agents'), 'the held position is a card under the headline');
      else fail(S('agents'), `position cards ${tiles}, first "${tileSym}"`);
      const desc = await page.locator('.ag-desc').count();
      if (desc === 0) ok(S('agents'), 'no description paragraph on the detail');
      else fail(S('agents'), `${desc} description paragraphs`);
      // A second pair swaps the chart without leaving the detail.
      await page.locator('.ag-sym-tab').nth(1).click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(400);
      const swapped = await page.locator('.ag-chart-sym').textContent().catch(() => '');
      if (/ETH\/USD/.test(swapped || '')) ok(S('agents'), 'a tab swaps the pair the chart draws');
      else fail(S('agents'), `after the tab click the chart reads "${swapped}"`);
      await page.locator('.ag-sym-tab').first().click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(300);

      const btN = await page.locator('.ag-detail .ag-section-title:text-is("BACKTEST")').count();
      if (btN === 0) ok(S('agents'), 'no backtest section on a strategy page');
      else fail(S('agents'), `${btN} backtest sections`);
      await shot(page, 'agents-detail');
      const stacked = await page.locator('.modal').count();
      const backBtn = await page.locator('.ag-back').count();
      if (stacked === 2 && backBtn === 0) ok(S('agents'), 'the detail is its own modal over the list, closed by its ✕, no back button');
      else fail(S('agents'), `modals ${stacked}, back buttons ${backBtn}`);
      await page.locator('.ag-detail-close').click();
      await page.waitForTimeout(300);
      const listBack = await page.locator('.ag-strategies .ag-row').count();
      if (listBack === rows) ok(S('agents'), 'closing the detail returns to the list as it was');
      else fail(S('agents'), `after close: ${listBack} rows`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // ---- hide values, on the agents page -------------------------
      // The mask is a privacy overlay for showing the screen to someone
      // else, so a POSITION SIZE has to go under it too: a size beside an
      // unmasked mark one column over is the value spelled out.
      await page.locator('.hide-eye').first().click();
      await page.waitForTimeout(200);
      await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
      await page.waitForTimeout(200);
      await page.locator('.header-menu-item:text-is("Agents")').first().click();
      await page.waitForSelector('.ag-scoreboard', { timeout: 10_000 });
      await page.locator('.ag-row', { has: page.locator('.ag-name-btn:text-is("Trend 4h · Kraken")') }).first().click();
      await page.waitForSelector('.ag-poscard', { timeout: 5_000 });
      const hasDigits = (/** @type {string} */ t) => /\d/.test(t);
      const cardVals = (await page.locator('.ag-poscard .pc-row span:last-child').allTextContents()).map((t) => t.trim());
      const sizeCell = cardVals[0] || '', costCell = cardVals[1] || '';
      const orderSizes = await page.locator('.ag-fills tbody tr td:nth-child(4)').allTextContents();
      if (!hasDigits(sizeCell) && !hasDigits(costCell) && orderSizes.length > 0 && !orderSizes.some(hasDigits)) {
        ok(S('agents'), `hide-values masks the position size as well as the money (size reads "${sizeCell}")`);
      } else fail(S('agents'), `under the mask: size "${sizeCell}", avg cost "${costCell}", order sizes ${orderSizes.join(' | ')}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.locator('.hide-eye').first().click();                       // back to values shown for everything after this
      await page.waitForTimeout(200);

      // ---- the same page before the migration has run ------------
      // `runDashboard` answers 200 with `{ notReady, reason }` while the
      // agents tables do not exist. That has to be a designed state, not
      // an error: a fresh database is the normal first minute of a deploy.
      agentsMode = 'notReady';
      await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
      await page.waitForTimeout(200);
      await page.locator('.header-menu-item:text-is("Agents")').first().click();
      await page.waitForSelector('.ag-notready', { timeout: 10_000 }).catch(() => {});
      const nr = await page.locator('.ag-notready').textContent().catch(() => '');
      const nrErrors = await page.locator('.ag-error').count();
      const nrTables = await page.locator('.ag-table').count();
      if (/Not deployed yet/.test(nr || '') && /migration 0037/.test(nr || '') && nrErrors === 0 && nrTables === 0) {
        ok(S('agents'), 'a notReady dashboard renders the designed empty state, not an error');
      } else fail(S('agents'), `not-ready state: errors ${nrErrors}, tables ${nrTables}, text "${(nr || '').trim().slice(0, 80)}"`);
      agentsMode = 'ok';
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // ---- the function falling over ------------------------------
      // A 500 is words, a retry and a fold — never the raw envelope in
      // the body of the page. The retry is proven: the stub recovers and
      // the table appears without leaving the modal.
      agentsMode = 'error';
      await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
      await page.waitForTimeout(200);
      await page.locator('.header-menu-item:text-is("Agents")').first().click();
      await page.waitForSelector('.ag-errorcard', { timeout: 10_000 }).catch(() => {});
      const ecTitle = await page.locator('.ag-errorcard-title').textContent().catch(() => '');
      const ecText = await page.locator('.ag-errorcard-text').textContent().catch(() => '');
      const ecRaw = await page.locator('.ag-error').count();
      const ecRetry = await page.locator('.ag-retry').count();
      const ecDetails = await page.locator('.ag-errorcard-details pre').textContent().catch(() => '');
      if ((ecTitle || '').trim() && !/[{]/.test(ecText || '') && ecRaw === 0 && ecRetry === 1 && /57014/.test(ecDetails || '')) {
        ok(S('agents'), `a 500 renders as words with a retry ("${(ecTitle || '').trim()}"), the envelope folded away`);
      } else fail(S('agents'), `error state: title "${ecTitle}", text "${(ecText || '').trim().slice(0, 60)}", raw ${ecRaw}, retry ${ecRetry}`);
      agentsMode = 'ok';
      await page.locator('.ag-retry').first().click({ timeout: 2_000 }).catch(() => {});
      const recovered = await page.waitForSelector('.ag-scoreboard', { timeout: 5_000 }).then(() => true).catch(() => false);
      if (recovered) ok(S('agents'), 'Try again reloads the dashboard in place');
      else fail(S('agents'), 'Try again did not bring the table back');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // ---- a global pause and a venue fault --------------------------
      agentsMode = 'paused';
      await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
      await page.waitForTimeout(200);
      await page.locator('.header-menu-item:text-is("Agents")').first().click();
      await page.waitForSelector('.ag-alert', { timeout: 10_000 }).catch(() => {});
      const stopBanner = await page.locator('.ag-alert.is-stop .ag-alert-label').textContent().catch(() => '');
      const faultBanner = await page.locator('.ag-alert.is-fault .ag-alert-text').textContent().catch(() => '');
      if (/Global pause/i.test(stopBanner || '') && /403/.test(faultBanner || '')) ok(S('agents'), 'a global pause and a venue fault are banners above the table, each with its label and words');
      else fail(S('agents'), `banners: stop "${stopBanner}", fault "${faultBanner}"`);
      agentsMode = 'ok';
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else fail(S('agents'), 'Agents menu item not found');

    await ctx.close();
  }

  await browser.close();
  server.close();

  // ---- whole-run invariants ----------------------------------------
  console.log('\n=== whole-run invariants ===');
  if (tokenMisses.length === 0) {
    ok('token', 'every Edge Function call carried X-App-Token');
  } else {
    fail('token', `calls without X-App-Token: ${[...new Set(tokenMisses)].join(', ')}`);
  }
  if (errors.length === 0) {
    ok('errors', 'no uncaught errors and no console errors');
  } else {
    for (const e of [...new Set(errors)]) fail('errors', e);
  }

  console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILURES'}`
    + ` — ${log.filter((l) => l.startsWith('  ok')).length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); server.close(); process.exit(2); });
