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
// Serves the built site (`dist/`) the way Cloudflare Pages does — the
// committed index.html + hashed bundle, no dev server, no source
// transform — so what it exercises is the JS that actually ships.
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
// A hard CI gate since 2026-09-17 (check.yml's browser-sweep step). Run
// it from src/ after a UI change, against the bundle you are about to
// commit:
//
//   npm run build && npm run verify:browser
//
// It needs Chromium once per machine (`npx playwright install chromium`);
// a container that ships its own can set PLAYWRIGHT_CHROMIUM_PATH instead.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// Absolute, always: the path-traversal guard on line ~69 compares the
// resolved file against ROOT with `startsWith`, so a relative ROOT like
// "." rejected every request and the page never loaded. Defaults to the
// built site (`dist/`) of the repo containing this file, so the sweep works
// from any working directory.
const ROOT = path.resolve(
  process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'dist'));
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

// The quote test's two books: six rungs each, 0.1 / 0.2 / 0.3 % either side of fair; USDC's 0.1 % bid holds what it filled.
const quoteRung = (side, k, mode, price, held = {}) => ({ side, k, mode, price, entry: null, heldSince: null, valueUsd: null, unrealisedUsd: null, ...held });
const QUOTE_BOOKS = [
  { book: 'USDC-GBP', lastX: 1.32, lastPrice: 0.7550, lastPrintAt: new Date(NOW_MS - 60e3).toISOString(), fair: 0.75505, quoting: 5, held: 1, openUsd: 99.75, unrealisedUsd: 0.14, trips: 4, won: 4, realisedUsd: 0.30,
    rungs: [quoteRung('bid', 0.001, 'position', 0.7550, { entry: 0.7542, heldSince: new Date(NOW_MS - 40 * 60e3).toISOString(), valueUsd: 99.75, unrealisedUsd: 0.14 }),
      quoteRung('bid', 0.002, 'quote', 0.7535), quoteRung('bid', 0.003, 'quote', 0.7527),
      quoteRung('ask', 0.001, 'quote', 0.7559), quoteRung('ask', 0.002, 'quote', 0.7566), quoteRung('ask', 0.003, 'quote', 0.7574)] },
  { book: 'USDT-GBP', lastX: 1.32, lastPrice: 0.7548, lastPrintAt: new Date(NOW_MS - 90e3).toISOString(), fair: 0.75482, quoting: 6, held: 0, openUsd: 0, unrealisedUsd: 0, trips: 3, won: 2, realisedUsd: 0.12,
    rungs: [quoteRung('bid', 0.001, 'quote', 0.7540), quoteRung('bid', 0.002, 'quote', 0.7533), quoteRung('bid', 0.003, 'quote', 0.7525),
      quoteRung('ask', 0.001, 'quote', 0.7556), quoteRung('ask', 0.002, 'quote', 0.7564), quoteRung('ask', 0.003, 'quote', 0.7571)] },
];
const quoteTrip = (minsAgo, book, side, k, entry, exit, how, pnlUsd) => ({ book, side, k, tEntry: new Date(NOW_MS - (minsAgo + 30) * 60e3).toISOString(),
  tExit: new Date(NOW_MS - minsAgo * 60e3).toISOString(), entry, exit, how, notionalUsd: 99.8, pnlUsd });
const QUOTE_TRIPS = [
  quoteTrip(20, 'USDT-GBP', 'ask', 0.002, 0.7564, 0.7550, 'maker', 0.10), quoteTrip(50, 'USDC-GBP', 'bid', 0.001, 0.7542, 0.7549, 'maker', 0.07),
  quoteTrip(90, 'USDT-GBP', 'bid', 0.003, 0.7525, 0.7521, 'taker', -0.05), quoteTrip(1500, 'USDC-GBP', 'ask', 0.002, 0.7566, 0.7558, 'maker', 0.08),
  quoteTrip(1560, 'USDT-GBP', 'bid', 0.001, 0.7540, 0.7549, 'maker', 0.07), quoteTrip(1620, 'USDC-GBP', 'bid', 0.003, 0.7527, 0.7535, 'maker', 0.06),
  quoteTrip(1700, 'USDC-GBP', 'ask', 0.001, 0.7559, 0.7550, 'maker', 0.09),
];

const b64url = (s) => Buffer.from(s).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `${b64url(JSON.stringify({ role: 'admin', exp: NOW_MS + 3600_000 }))}.sig`;
// The read-only password's token: the same board, no editing, and since
// 2026-09-23 no transaction history and no Investment view.
const RO_TOKEN = `${b64url(JSON.stringify({ role: 'ro', exp: NOW_MS + 3600_000 }))}.sig`;

// ---- run -----------------------------------------------------------

/** Functions whose calls MUST carry the app token. */
const TOKEN_REQUIRED = ['/prices', '/chart', '/fundamentals', '/data', '/trading212', '/agents'];

/**
 * RW's paper test on Polymarket (`0053`, reference §4 item 36): a row of TESTING STRATEGIES since 2026-09-24, with a
 * page of its own. Day 3 of the fourteen on the pinned clock. Consistent with itself, as `rwSummary` would build it:
 * three markets chosen today and one held from an earlier day; the markets' rewards (41.60) and fill P&L (−0.60) are the
 * totals; realised is the rewards and C's round trip (+0.40), unrealised is A's 20 Yes bought at 43¢ marked at 44¢
 * (+0.20) and D's 20 No — 20 Yes sold at 66¢ — marked at 72¢ (−1.20), so the two sum to the total; today is the total
 * less 26 Sep's running total; the five fills are the markets' five.
 */
const AGENTS_RW = (dayStartMs) => {
  const D = 86400e3, runStart = dayStartMs - 2 * D;
  const iso = (ms) => new Date(ms).toISOString();
  const mk = (cond, rank, q, rate, over) => ({ cond, q, cat: 'weather', rank, quoting: rank != null, ratePerDay: rate, endDate: null,
    net: 0, avgCost: null, mark: 0.5, settled: null, rewardUsd: 0, fillsPnlUsd: 0, totalUsd: 0, fills: 0, capitalUsd: 19, bid: null, ask: null, share: null, ...over });
  return {
    phase: 'run', runStart: iso(runStart), runEnd: iso(runStart + 14 * D), dayOfRun: 3, startedAt: iso(runStart - 5 * 3600e3),
    lastMinute: iso(NOW_MS - 2 * 60e3), lagMinutes: 2, lastError: null, running: true, finished: false,
    capitalUsd: 296, totalUsd: 41, stressUsd: 17.2, rewardUsd: 41.6, fillsPnlUsd: -0.6, realisedUsd: 42, unrealisedUsd: -1, mismatchUsd: 0,
    todayUsd: 12.5, heldUsd: 14.4, open: 2, fills: 5, quoting: 3, bestMarketUsd: 18.6,
    markets: [
      mk('0xa1', 1, 'Will the highest temperature in Los Angeles be between 78-79°F on September 17?', 205,
        { net: 20, avgCost: 0.43, mark: 0.44, rewardUsd: 18.4, fillsPnlUsd: 0.2, totalUsd: 18.6, fills: 2, bid: 0.43, ask: 0.45, share: 0.97 }),
      mk('0xb2', 2, 'Will "Avengers: Endgame Encore" be #1 Box Office this weekend?', 162,
        { mark: 0.13, rewardUsd: 14.1, totalUsd: 14.1, bid: 0.12, ask: 0.14, share: 0.88 }),
      mk('0xc3', 3, 'Will the Bank of Canada make no change to the target for the overnight rate?', 103,
        { mark: 0.45, rewardUsd: 3.1, fillsPnlUsd: 0.4, totalUsd: 3.5, fills: 2, bid: 0.44, ask: 0.46, share: 0.5 }),
      mk('0xd4', null, 'Will Zelenskyy post 100-119 posts from September 10 to September 17?', 90,
        { net: -20, avgCost: 0.66, mark: 0.72, rewardUsd: 6, fillsPnlUsd: -1.2, totalUsd: 4.8, fills: 1 }),
    ],
    days: [
      { day: iso(dayStartMs - D).slice(0, 10), phase: 'run', totalUsd: 15.2, stressUsd: 6.1, rewardUsd: 15.5, fills: 2, capitalUsd: 290.4, markets: 15, runningUsd: 28.5 },
      { day: iso(dayStartMs - 2 * D).slice(0, 10), phase: 'run', totalUsd: 13.3, stressUsd: 5, rewardUsd: 13.6, fills: 1, capitalUsd: 288.2, markets: 16, runningUsd: 13.3 },
      { day: iso(dayStartMs - 3 * D).slice(0, 10), phase: 'warm-up', totalUsd: 9.8, stressUsd: 3.7, rewardUsd: 10.1, fills: 1, capitalUsd: 280.1, markets: 16, runningUsd: 9.8 },
    ],
    // RW-E beside it (pmrw_view.ts's rweSummary): the same replay's two arms since the day before this one.
    e: {
      since: iso(dayStartMs - D), started: true, lastMinute: iso(NOW_MS - 7 * 60e3), lagMinutes: 7, lastError: null, running: true,
      rw: { totalUsd: 27.7, stressUsd: -3.1, rewardUsd: 60, fills: 40, capitalUsd: 290 }, e: { totalUsd: 31.4, stressUsd: 9.5, rewardUsd: 38, fills: 12, capitalUsd: 180 },
      excludedToday: [{ cond: '0xa1', q: 'Will the highest temperature in Los Angeles be between 78-79°F on September 17?', endDate: iso(dayStartMs + 20 * 3600e3) }],
      diverged: 0, check: { days: 2, maxUsd: 0.002, ok: true },
    },
    recent: [
      { ts: iso(NOW_MS - 20 * 60e3), minute: iso(NOW_MS - 21 * 60e3), cond: '0xc3', q: 'Will the Bank of Canada make no change to the target for the overnight rate?', side: 'ask', price: 0.46, size: 20.129 },
      { ts: iso(NOW_MS - 50 * 60e3), minute: iso(NOW_MS - 51 * 60e3), cond: '0xc3', q: 'Will the Bank of Canada make no change to the target for the overnight rate?', side: 'bid', price: 0.44, size: 20 },
      { ts: iso(NOW_MS - 2 * 3600e3), minute: iso(NOW_MS - 2 * 3600e3 - 60e3), cond: '0xa1', q: 'Will the highest temperature in Los Angeles be between 78-79°F on September 17?', side: 'bid', price: 0.43, size: 10 },
      { ts: iso(NOW_MS - 3 * 3600e3), minute: iso(NOW_MS - 3 * 3600e3 - 60e3), cond: '0xa1', q: 'Will the highest temperature in Los Angeles be between 78-79°F on September 17?', side: 'bid', price: 0.43, size: 10 },
      { ts: iso(NOW_MS - 26 * 3600e3), minute: iso(NOW_MS - 26 * 3600e3 - 60e3), cond: '0xd4', q: 'Will Zelenskyy post 100-119 posts from September 10 to September 17?', side: 'ask', price: 0.66, size: 20 },
    ],
  };
};

/**
 * RW-E as a row of its own (Davies, 2026-09-26): `rwe`, RW's shape read from the replay's own arm. Consistent with
 * AGENTS_RW, as `rweArmSummary` would build it: 0xa1 ends today, so RW-E does not quote it today, made none of its fills
 * (both are today's) and holds none of it; the other three markets are RW's to the cent. So rewards are 14.10 + 3.10 +
 * 6 = 23.20 and fill P&L 0.40 − 1.20 = −0.80, total 22.40; realised is the rewards and C's round trip (23.60),
 * unrealised is D's −1.20; D's 20 No held at 72¢ is 5.60 deployed; its three fills are C's two and D's one; its closed
 * days are the fourteen days' only (the replay starts with them), 7.80 then 7.10, so today is 22.40 − 14.90 = 7.50.
 */
const AGENTS_RWE = (dayStartMs) => {
  const D = 86400e3, rw = AGENTS_RW(dayStartMs);
  const iso = (ms) => new Date(ms).toISOString();
  return {
    ...rw, startedAt: rw.runStart, lastMinute: iso(NOW_MS - 7 * 60e3), lagMinutes: 7,
    capitalUsd: 235, totalUsd: 22.4, stressUsd: 12.1, rewardUsd: 23.2, fillsPnlUsd: -0.8, realisedUsd: 23.6, unrealisedUsd: -1.2, mismatchUsd: 0,
    todayUsd: 7.5, heldUsd: 5.6, open: 1, fills: 3, quoting: 2, bestMarketUsd: 14.1,
    markets: rw.markets.filter((m) => m.cond !== '0xa1'),
    days: [
      { day: iso(dayStartMs - D).slice(0, 10), phase: 'run', totalUsd: 7.1, stressUsd: 4.4, rewardUsd: 7.4, fills: 1, capitalUsd: 231.2, markets: 13, runningUsd: 14.9 },
      { day: iso(dayStartMs - 2 * D).slice(0, 10), phase: 'run', totalUsd: 7.8, stressUsd: 3.1, rewardUsd: 8.2, fills: 0, capitalUsd: 226.5, markets: 14, runningUsd: 7.8 },
    ],
    recent: rw.recent.filter((f) => f.cond !== '0xa1'),
  };
};

/**
 * The Agents dashboard as the Edge Function shapes it (`dashboard()`): the
 * THREE rows that run since `0046`, all on Revolut X and all reading
 * Kraken's candles, with the 4-hour row carrying its five symbols, a
 * per-strategy `todayUsd` and the `dayStart` the page reads. The 4-hour
 * row is long BTC with a fill on record, so the page has a position, a
 * decision and an order to draw. VENUES is Revolut X and Binance
 * (2026-09-23): Binance's card is its account, read-only. A fixture that
 * drifts from the payload tests nothing: this one is checked against the
 * migrations up to `0048` and the shape `dashboard()` builds in
 * `supabase/functions/agents/index.ts`.
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
    name: `${KIND_NAME[kind]} · ${({ revx: 'Revolut X', binance: 'Binance', kraken: 'Kraken' })[venue]}`,
    description: 'Fixture strategy.', symbols, mode: 'paper', capitalUsd,
    params: { fast: 20, slow: 100 }, updatedAt: at,
    costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0,
    positions: symbols.map(flat),
    openOrders: 0, ordersToday: 0, jev24h: { calls: 6, costUsd: 0.00011, avgLatencyMs: 480, providers: { openrouter: 6 } },
    lastDecision: { ts: new Date(CLOCK - 35 * 60e3).toISOString(), symbol: 'BTC/USD', action: 'hold', ruleAction: 'hold', reason: 'in position', provider: 'openrouter', riskAllowed: true, riskReason: 'hold' },
    backtest: null, recentDecisions: [], recentOrders: [], ...over,
  });
  // The one row with a book: long BTC since yesterday, +$0.42 of that move made today. It used to be
  // `trend-4h-kraken`, which `0046` deleted — so the book moved to the live candidate, where production
  // keeps it, and Kraken now has ZERO execution rows. That is the shape the page must handle: a venue
  // that still supplies every rule's candles (`signal_venue`) and executes nothing.
  const revxTrend = strat('trend-4h', 'trend-4h', 'revx', TREND, 100, {
    costUsd: 20, valueUsd: 21.5, unrealisedUsd: 1.5, realisedUsd: 12.34, feesUsd: 0.08, todayUsd: 0.42, ordersToday: 1,
    positions: [
      { symbol: 'BTC/USD', base: 0.00025, avgCost: 80000, mark: 86000, costUsd: 20, valueUsd: 21.5, unrealisedUsd: 1.5, realisedUsd: 12.34, feesUsd: 0.08, openedAt: CLOCK - 86400e3, highWater: 86500, fills: 3, observation: seen('BTC/USD', { position: 'long', unrealised: 'gain', time_in_position: 'days' }) },
      ...TREND.slice(1).map(flat),
    ],
    recentDecisions: [{
      id: 1, ts: new Date(CLOCK - 35 * 60e3).toISOString(), strategy_id: 'trend-4h', venue: 'revx', symbol: 'BTC/USD', mode: 'paper',
      state: { trend_4h: 'up', breakout_4h: 'inside_range', volatility: 'normal', momentum_30d: 'positive', position: 'long' },
      answers: { healthy_trend: { type: 'noul', probability: 0.91 }, caution: { type: 'score', score: 0.1 }, _state: { type: 'choice', choice: 'BTC/USD' } },
      provider: 'openrouter', model: 'typesafe/jev-1.13-20260917', latency_ms: 470, cost_usd: 0.0000184,
      rule_action: 'hold', rule_reason: 'in position', final_action: 'hold', final_reason: 'in position [healthy=0.91]', risk_allowed: true, risk_reason: 'hold',
    }],
    recentOrders: [{
      id: 1, ts: new Date(CLOCK - 86400e3).toISOString(), strategy_id: 'trend-4h', venue: 'revx', symbol: 'BTC/USD', mode: 'paper', side: 'buy',
      price: 80000, base_size: 0.00025, state: 'filled', filled_base: 0.00025, avg_fill_price: 80000, fee_usd: 0.018, filled_at: new Date(CLOCK - 86400e3 + 300e3).toISOString(),
    }],
  });
  // The THREE rows that survive `0046` (reference §3.17, §4.22). `0043` retired three and `0044`
  // deleted them; `0046` deleted the Kraken twin, which made no decision of its own — 50 of 50 paired
  // decisions matched this row exactly — so no strategy executes on Kraken any more.
  // …and, since `0049`, their paper twins on Binance (Davies, 2026-09-23: the same strategies shown there): the
  // same rules, coins and capital, filled at Binance's touch. Flat here, as they start in production.
  const strategies = [
    revxTrend,
    strat('trend-1h', 'trend-1h', 'revx', MAJORS, 40),
    strat('momentum-1d', 'momentum-1d', 'revx', MAJORS, 40),
    strat('trend-4h-binance', 'trend-4h', 'binance', TREND, 100),
    strat('trend-1h-binance', 'trend-1h', 'binance', MAJORS, 40),
    strat('momentum-1d-binance', 'momentum-1d', 'binance', MAJORS, 40),
  ];
  const zero = { costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0 };
  const book = { costUsd: 20, valueUsd: 21.5, unrealisedUsd: 1.5, realisedUsd: 12.34, feesUsd: 0.08, todayUsd: 0.42 };
  const totals = { ...book, byMode: { paper: { ...book }, live: { ...zero } } };
  return {
    at, dayStart: new Date(dayStartMs).toISOString(),
    risk: { id: 1, global_pause: false, max_exposure_usd: 100, paper_exposure_usd: 300, daily_loss_limit_usd: 5, max_orders_per_day: 40, live_confirmed_at: null, updated_at: at },
    totals,
    venues: [
      { id: 'revx', canTrade: true, feeBps: { maker: 0, taker: 9 }, balances: { USD: 100 }, note: null, marks: { 'BTC/USD': 86000 } },
      // Binance holds money and executes nothing: the dashboard reads its account, read-only, for this card (`binanceCard`).
      { id: 'binance', canTrade: true, feeBps: { maker: 10, taker: 10 }, balances: { USDT: 50, BNB: 0.012 }, note: null, marks: {} },
    ],
    strategies, openOrders: [], jev24h: { calls: 24, costUsd: 0.00044, avgLatencyMs: 480, providers: { openrouter: 24 } },
    // PR5's quotes on paper (`0051`): a row of TESTING STRATEGIES since 2026-09-23, with a page of its own. Consistent
    // with itself: the books' trips (4 + 3) and realised (0.30 + 0.12) are the totals, the one held rung is `open`, and
    // `recent` is every trip, newest first.
    quotes: { startedAt: '2026-09-23T15:09:00.000Z', lastMinute: at, lagMinutes: 1, running: true, lastError: null, capitalUsd: 1200,
      realisedUsd: 0.42, realisedPct: 0.035, todayUsd: 0.12, todayPct: 0.01, trips: 7, won: 6, open: 1, openUsd: 99.75, unrealisedUsd: 0.14,
      ordersToday: 205, fillsToday: 8, books: QUOTE_BOOKS, recent: QUOTE_TRIPS,
      // Its live executor (`0052`) in dry-run, as quotesLiveSummary shapes it: no money, what it would have sent today.
      live: { dryRun: true, armed: false, armedAt: null, entryBook: 'dry_run', why: '', running: true, lagMinutes: 0, lastError: null,
        postsToday: { dryRun: 12, live: 0 }, lossStopped: false, capitalGbp: 50, x: 1.35, capitalUsd: 67.5, tradedLive: false,
        openOrders: 0, heldRungs: 0, unmarked: 0, pending: [], fills: 0, realisedUsd: 0, todayUsd: 0, unrealisedUsd: 0, costUsd: 0, valueUsd: 0, feesUsd: 0 } },
    rw: AGENTS_RW(dayStartMs),
    rwe: AGENTS_RWE(dayStartMs),
    byVenue: {
      revx: { ...book, capitalUsd: 180, strategies: 3, live: 0 },     // 100 + 40 + 40, and the only book there is
      binance: { ...zero, capitalUsd: 180, strategies: 3, live: 0 },  // the twins' capital, nothing held yet. Kraken is the signal venue only.
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
 * dashboard with a global pause set and a venue reporting a fault),
 * `live` / `live-unarmed` (a row trading real money, armed or not), and
 * `rw-cents` (RW's figures where each part rounds on its own).
 */
let agentsMode = /** @type {'ok' | 'notReady' | 'error' | 'paused' | 'live' | 'live-unarmed' | 'rw-cents' | 'pr5-live'} */ ('ok');
/**
 * The reload section's levers: the book the `data` function hands back (a
 * server row's prices are those of its last SAVE, not what the page showed),
 * how long every Edge Function answer is held back, and what was answered
 * while held.
 */
let loadOverride = /** @type {any} */ (null);
let holdMs = 0;
/** @type {string[]} */
const heldAnswers = [];
/** The fixture's book as a row saved when every price stood at `k` times today's. */
const storedAt = (k) => ({
  ...PORTFOLIO,
  holdings: Object.fromEntries(Object.entries(PORTFOLIO.holdings).map(([t, h]) => [t, /** @type {any} */ (h).isCash ? h
    : { ...h, lastPrice: Number((/** @type {any} */ (h).lastPrice * k).toFixed(4)), prevClose: Number((/** @type {any} */ (h).prevClose * k).toFixed(4)) }])),
});
/** `SWEEP_SHOTS=<dir>` saves a screenshot at the named points, per viewport — how the page is looked at, not only asserted. */
const SHOTS_DIR = process.env.SWEEP_SHOTS || '';
async function shot(page, name) {
  if (!SHOTS_DIR) return;
  // A modal rises in over 0.22 s (`modal-in`): taken at once, a page opened over another shows the one beneath it.
  await page.waitForTimeout(300);
  const w = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `${SHOTS_DIR}/${w}-${name}.png`, fullPage: true }).catch(() => {});
}
/** Opens the Agents page from the menu and waits for its tab bar. */
async function openAgentsPage(page) {
  await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
  await page.waitForTimeout(200);
  await page.locator('.header-menu-item:text-is("Agents (beta)")').first().click();
  await page.waitForSelector('.ag-modebar', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(150);
}
/**
 * What the Agents page shows right now, read out of the DOM as text: the tab bar, and the open tab's scoreboard,
 * venue cards, banners, armed line, empty state and rows — so two tabs, or two bundles, compare figure for figure.
 */
function readAgentsPanel(page) {
  return page.evaluate(() => {
    const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const panel = document.querySelector('.ag-modepanel');
    const all = (/** @type {string} */ sel) => [...(panel?.querySelectorAll(sel) ?? [])];
    return {
      tabs: [...document.querySelectorAll('.ag-modebar .ag-modetab')].map((b) => ({
        id: b.id.replace('ag-modetab-', ''), on: b.getAttribute('aria-selected') === 'true',
        label: txt(b.querySelector('.ag-modetab-label')), count: txt(b.querySelector('.ag-modetab-count')), text: txt(b.querySelector('.ag-modetab-text')),
        tone: ([...b.classList].find((c) => /^is-(armed|unarmed|paused|winding|none|paper)$/.test(c)) || '').replace('is-', ''),
      })),
      tabsOutsideBody: !!document.querySelector('.modal > .ag-modebar') && !document.querySelector('.modal-body .ag-modebar'),
      modalHeight: Math.round(document.querySelector('.modal')?.getBoundingClientRect().height ?? 0),
      // A scoreboard cell: its name, the lines under the name (what its percent is of, what else is in it), its figure,
      // and the lines under the figure (RW's rewards and orders).
      scoreboard: all(':scope > .ag-scoreboard .ag-sb-cell').map((c) => ({
        name: txt(c.querySelector('.ag-sb-name')), asides: [...c.querySelectorAll('.ag-sb-aside')].map(txt),
        value: txt(c.querySelector('.sb-value')), split: [...c.querySelectorAll('.ag-sb-split')].map(txt),
      })),
      venues: all('.ag-venue-card').map((c) => {
        const cells = [...c.querySelectorAll('.ag-venue-grid > span')];
        /** @type {Record<string, string>} */
        const pairs = {}, bases = {};
        for (let i = 0; i + 1 < cells.length; i += 2) {
          const key = txt(cells[i].querySelector('.ag-fig-name') ?? cells[i]);
          pairs[key] = txt(cells[i + 1]);
          if (cells[i].querySelector('.ag-fig-base')) bases[key] = txt(cells[i].querySelector('.ag-fig-base'));
        }
        return { id: ([...c.classList].find((x) => /^ag-venue-card-/.test(x)) || '').replace('ag-venue-card-', ''), meta: txt(c.querySelector('.ag-venue-meta')), pairs, bases, apart: txt(c.querySelector('.ag-venue-apart')) };
      }),
      shareBar: all('.ag-share-bar').length,
      shares: all('.ag-share').map(txt),
      arming: txt(panel?.querySelector('.ag-arming')),
      alerts: all('.ag-alert').map((a) => ({ label: txt(a.querySelector('.ag-alert-label')), text: txt(a.querySelector('.ag-alert-text')), tone: [...a.classList].find((x) => /^is-/.test(x)) || '' })),
      empty: txt(panel?.querySelector('.ag-nolive')),
      sections: all('.ag-strategies .ag-section-title').map(txt),
      heads: all('.ag-strategies thead th').map((th) => [txt(th.firstChild ?? th), txt(th.querySelector('.ag-th-base'))].filter(Boolean).join(' / ')),
      rows: all('.ag-strategies .ag-row').map((r) => ({
        name: txt(r.querySelector('.ag-name-btn')), sub: txt(r.querySelector('.ag-name-cell .hl-sub')), apart: txt(r.querySelector('.ag-name-apart')),
        venue: txt(r.querySelector('.ag-venue')), badges: r.querySelectorAll('.ag-badge').length,
        gl: [...r.querySelectorAll('.ag-gl')].map(txt), bases: [...r.querySelectorAll('.ag-cell-base')].map(txt), next: txt(r.querySelector('.ag-next')),
      })),
      updated: txt(panel?.querySelector('.ag-updated')),
    };
  });
}
/**
 * RW with figures of the shape the ops read on production (2026-09-24), where each part rounds on its own as it did:
 * total 34.227 prints $34.23 while realised 55.754 and unrealised −21.527 print 55.75 and −21.53, and rewards 48.7149
 * and orders −14.4879 print 48.71 and −14.49; and a market whose rewards 18.4049 and orders 0.2049 print 18.40 and 0.20
 * beside its total 18.6098, $18.61. Worked by hand (largest remainder, `rwSplit`): rewards $48.72, closed orders
 * +$7.04, open orders −$21.53, so realised +$55.76, orders −$14.49, total +$34.23; the market $18.41 + $0.20 = $18.61.
 */
/**
 * PR5's live executor trading real money (Davies, 2026-09-26), nothing else live: armed, one rung holding.
 *   capital £50 × 1.35 = $67.50; cost $50.00, marked $50.40: unrealised +$0.40 (+0.80 % on cost);
 *   realised +$0.27 (+0.40 % of $67.50), today +$0.54 (+0.80 % of $67.50)
 */
const AGENTS_PR5_LIVE = () => {
  const d = AGENTS_DASHBOARD;
  return {
    ...d,
    quotes: { ...d.quotes, live: { ...d.quotes.live, dryRun: false, armed: true, armedAt: '2026-09-17T09:00:00.000Z', entryBook: 'live', postsToday: { dryRun: 0, live: 31 },
      tradedLive: true, openOrders: 5, heldRungs: 1, fills: 4, realisedUsd: 0.27, todayUsd: 0.54, unrealisedUsd: 0.4, costUsd: 50, valueUsd: 50.4, feesUsd: 0 } },
  };
};

const AGENTS_RW_CENTS = () => {
  const d = AGENTS_DASHBOARD, rw = d.rw;
  return {
    ...d,
    rw: {
      ...rw, totalUsd: 34.227, rewardUsd: 48.7149, fillsPnlUsd: 34.227 - 48.7149, realisedUsd: 55.754, unrealisedUsd: -21.527, mismatchUsd: 0,
      markets: rw.markets.map((x, i) => (i === 0 ? { ...x, rewardUsd: 18.4049, fillsPnlUsd: 0.2049, totalUsd: 18.6098 } : x)),
    },
  };
};
const AGENTS_PAUSED = () => ({
  ...AGENTS_DASHBOARD,
  risk: { ...AGENTS_DASHBOARD.risk, global_pause: true },
  // Binance's likeliest fault: a dashboard call routed to a US region is refused by address (the page pins London).
  venues: AGENTS_DASHBOARD.venues.map((v) => (v.id === 'binance' ? { ...v, canTrade: false, balances: null, note: 'account 451: 0 Service unavailable from a restricted location' } : v)),
});
/**
 * The dashboard the day a row goes live: the six paper rows above, plus the go-live draft's `trend-4h-live`
 * (reference §3.31) — Revolut X, BTC/ETH/SOL/AVAX, $50 — long ETH on the live book. `armed` is the one statement run
 * on Davies' word (`live_confirmed_at` set, at 14:02 UTC); unarmed is the state the migration leaves. `totals`,
 * `byMode` and `byVenue` are summed from the rows the way `dashboard()` sums them, so the fixture cannot describe a
 * book other than its rows. Worked by hand:
 *
 *   live row   ETH 0.005 @ 2400 = $12.00 cost, marked at 2500 = $12.50: unrealised +$0.50 (+4.17 % on cost);
 *              realised +$0.30 (+0.60 % of $50), fees $0.03, today +$0.20 (+0.40 % of $50)
 *   paper rows as AGENTS_DASHBOARD: deployed $21.50, today +$0.42 (+0.12 % of $360), unrealised +$1.50 (+7.50 %),
 *              realised +$12.34 (+3.43 % of $360), fees $0.08
 *   every row  deployed $34.00, today +$0.62, unrealised +$2.00, realised +$12.64, fees $0.11 — the one scoreboard
 *              the page had before its two tabs
 */
const AGENTS_LIVE = (armed) => {
  const D = AGENTS_DASHBOARD;
  const paperRow = D.strategies.find((s) => s.id === 'trend-4h');
  const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD'];
  const like = (symbol, state) => {
    const p = paperRow.positions.find((x) => x.symbol === symbol);
    return { ...p, book: 'live', base: 0, avgCost: 0, costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, openedAt: null, highWater: null, fills: 0,
      observation: { ...p.observation, state: { ...p.observation.state, position: 'flat', unrealised: 'none', time_in_position: 'none', ...state } } };
  };
  const eth = { ...like('ETH/USD', { position: 'long', unrealised: 'gain', time_in_position: 'hours' }),
    base: 0.005, avgCost: 2400, mark: 2500, costUsd: 12, valueUsd: 12.5, unrealisedUsd: 0.5, realisedUsd: 0.3, feesUsd: 0.03, todayUsd: 0.2,
    openedAt: NOW_MS - 6 * 3600e3, highWater: 2520, fills: 3 };
  const liveRow = {
    ...paperRow, id: 'trend-4h-live', name: 'Trend 4h · Revolut X · live', mode: 'live', capitalUsd: 50, symbols,
    holdsLive: true, windingDown: false, todayByBook: { paper: 0, live: 0.2 }, otherBooks: [],
    costUsd: 12, valueUsd: 12.5, unrealisedUsd: 0.5, realisedUsd: 0.3, feesUsd: 0.03, todayUsd: 0.2, ordersToday: 1,
    positions: symbols.map((s) => (s === 'ETH/USD' ? eth : like(s, {}))),
    recentDecisions: [], recentOrders: [{
      id: 91, ts: new Date(NOW_MS - 6 * 3600e3).toISOString(), strategy_id: 'trend-4h-live', venue: 'revx', symbol: 'ETH/USD', mode: 'live', side: 'buy',
      price: 2400, base_size: 0.005, state: 'filled', filled_base: 0.005, avg_fill_price: 2400, fee_usd: 0.01, filled_at: new Date(NOW_MS - 6 * 3600e3 + 5e3).toISOString(),
    }],
  };
  const strategies = [...D.strategies, liveRow];
  const keys = ['costUsd', 'valueUsd', 'unrealisedUsd', 'realisedUsd', 'feesUsd', 'todayUsd'];
  const sum = (rows) => Object.fromEntries(keys.map((k) => [k, rows.reduce((a, s) => a + s[k], 0)]));
  const onVenue = (v) => strategies.filter((s) => s.venue === v);
  const venueBook = (v) => ({ ...sum(onVenue(v)), capitalUsd: onVenue(v).reduce((a, s) => a + s.capitalUsd, 0), strategies: onVenue(v).length, live: onVenue(v).filter((s) => s.mode === 'live').length });
  return {
    ...D,
    risk: { ...D.risk, max_exposure_usd: 15, live_confirmed_at: armed ? '2026-09-17T14:02:00.000Z' : null },
    strategies,
    totals: { ...sum(strategies), byMode: { paper: sum(D.strategies), live: sum([liveRow]) } },
    byVenue: { revx: venueBook('revx'), binance: venueBook('binance') },
  };
};

let failures = 0;
const log = [];
const fail = (scope, msg) => { failures++; const s = `  FAIL [${scope}] ${msg}`; log.push(s); console.log(s); };
const ok = (scope, msg) => { const s = `  ok   [${scope}] ${msg}`; log.push(s); console.log(s); };
const near = (a, b, eps = 0.51) => Math.abs(a - b) <= eps;
const money = (s) => Number(String(s || '').replace(/[^0-9.-]/g, ''));

async function newPage(browser, { width, height }, errors, tokenMisses, opts = {}) {
  // `blockServiceWorkers`: a page that RELOADS is controlled by the app's
  // service worker from then on, and the worker's own fetches never pass
  // through `page.route` — every mocked Edge call would go to the real
  // network instead. The reload section blocks it; nothing it checks is
  // the worker's.
  const ctx = await browser.newContext({ viewport: { width, height }, ...(opts.blockServiceWorkers ? { serviceWorkers: 'block' } : {}) });
  await ctx.addInitScript(([token]) => { sessionStorage.setItem('dp.token', token); }, [opts.token || TOKEN]);
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

    // Held back for the reload section; an answer to a page that has since
    // reloaded has nowhere to go, and that is not the app's error.
    const held = holdMs;
    if (held > 0) await new Promise((r) => setTimeout(r, held));
    const json = (body) => {
      const done = route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      });
      if (held > 0) { heldAnswers.push(url.replace(/^.*\/functions\/v1/, '').split('&')[0]); return done.catch(() => {}); }
      return done;
    };
    if (url.includes('/data?') && url.includes('action=load')) return json({ data: loadOverride ?? PORTFOLIO, version: 1 });
    if (url.includes('/agents?') && url.includes('action=dashboard')) {
      if (agentsMode === 'notReady') return json(AGENTS_NOT_READY);
      if (agentsMode === 'paused') return json(AGENTS_PAUSED());
      if (agentsMode === 'live' || agentsMode === 'live-unarmed') return json(AGENTS_LIVE(agentsMode === 'live'));
      if (agentsMode === 'rw-cents') return json(AGENTS_RW_CENTS());
      if (agentsMode === 'pr5-live') return json(AGENTS_PR5_LIVE());
      if (agentsMode === 'error') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'agents crashed', message: 'db GET agent_strategies → 500: {"code":"57014","message":"canceling statement due to statement timeout"}' }) });
      }
      return json(AGENTS_DASHBOARD);
    }
    if (url.includes('/agents?') && url.includes('action=chart')) {
      const u = new URL(url);
      // The same series whichever pair is asked for — what the checks are
      // about is the drawing, not the prices.
      const symbol = u.searchParams.get('symbol');
      // ETH is the pair the sweep opens second: its chart says the log would add a row, so the button is there.
      // Every other pair already shows every order, so the button is not.
      return json({ ...AGENTS_CHART, strategyId: u.searchParams.get('strategy'), symbol, ordersMore: symbol === 'ETH/USD', historyLimit: 300 });
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
  // The agents chunk is held back until the click has been answered. Clicking
  // Agents then must put up the page's frame (backdrop, title, close) — never
  // a blank frame that shows the home page through — and the real page must
  // replace it. Held until released, not for a fixed 700 ms: the hold starts
  // when the board first mounts, and a page whose code has already arrived is
  // drawn at once (lazyPage) — which is right, and not what this checks.
  {
    /** @type {() => void} */
    let releaseCode = () => {};
    const codeHeld = new Promise((r) => { releaseCode = r; });
    const hold = async (page) => {
      await page.route('**/assets/agents-*.js', async (route) => { await codeHeld; await route.continue(); });
    };
    const { ctx, page } = await newPage(browser, { width: 1400, height: 1000 }, errors, tokenMisses, { beforeGoto: hold });
    await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
    await page.waitForTimeout(100);
    const agentsBtn = page.locator('.header-menu-item:text-is("Agents (beta)")');
    if (await agentsBtn.count()) {
      await agentsBtn.first().click();
      const frameTitle = await page.locator('.modal .modal-title').first().textContent({ timeout: 300 }).catch(() => '');
      const earlyBoard = await page.locator('.ag-scoreboard').count();
      if (frameTitle.trim() === 'Agents (beta)' && earlyBoard === 0) ok('desktop/agents', 'clicking Agents (beta) before its code has arrived shows the page\'s own frame, titled as the page is, not the home page');
      else fail('desktop/agents', `early frame title "${frameTitle}", scoreboards ${earlyBoard}`);
      releaseCode();
      const arrived = await page.waitForSelector('.ag-scoreboard', { timeout: 10_000 }).then(() => true).catch(() => false);
      const modalsAfter = await page.locator('.modal').count();
      if (arrived && modalsAfter === 1) ok('desktop/agents', 'the real page replaces the frame in the same modal');
      else fail('desktop/agents', `page arrived ${arrived}, modals ${modalsAfter}`);
    } else fail('desktop/agents', 'no Agents entry in the menu');
    releaseCode();
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

  // ---- 0c. a reload paints what the page last showed ----------------------
  // Davies (2026-09-23): every open or refresh first showed different
  // numbers, the vs-S&P chart said "Computing…", then drew a flat line, and
  // a second or two later everything jumped to the latest. Three causes: the
  // first paint was valued at the prices frozen in the cached book, then at
  // the server row's own (portfolio/shown_prices.js); the chart's IndexedDB
  // store had never persisted (prices/chart_store.js); and the benchmark's
  // batch was drawn before the holdings' (perf_chart.jsx). Here the server
  // row's stored prices differ from what was on screen — first 0.9x, then
  // 0.95x — every Edge Function answer is held back 1.5 s, and the page is
  // read every frame from the reload on. Nothing may differ from what was
  // on screen before it: not the first paint, not after the answers land.
  for (const vp of [{ name: 'desktop', width: 1400, height: 1000 },
                    { name: 'phone', width: 390, height: 844 }]) {
    const S = (n) => `${vp.name}/reload/${n}`;
    loadOverride = storedAt(0.9);
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses, { blockServiceWorkers: true });
    const read = () => page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const pf = txt(document.querySelector('.scoreboard-cell-portfolio .sb-value-lg'));
      let day = null;
      for (const c of document.querySelectorAll('.scoreboard-cell')) if (txt(c.querySelector('.sb-label')) === 'DAY CHANGE') day = txt(c.querySelector('.sb-value'));
      const wrap = [...document.querySelectorAll('.perf-chart-wrap')].find((w) => w.getBoundingClientRect().width > 0);
      let chart = null;
      let flat = null;
      if (wrap) {
        const empty = txt(wrap.querySelector('.sparkline-empty'));
        chart = empty ? `[${empty}]` : [...wrap.querySelectorAll('.perf-legend-item')].map(txt).join(' | ');
        const line = [...wrap.querySelectorAll('svg path')].find((n) => n.getAttribute('stroke-width') === '1.6' && !n.getAttribute('opacity'));
        const ys = (line?.getAttribute('d') || '').replace(/^M/, '').split('L').filter(Boolean).map((p) => Number(p.split(',')[1]));
        flat = ys.length > 1 ? Math.max(...ys) - Math.min(...ys) < 0.05 : null;
      }
      return { pf, day, chart, flat };
    });
    await page.waitForFunction((want) => (document.querySelector('.scoreboard-cell-portfolio .sb-value-lg')?.textContent || '').replace(/[^0-9.]/g, '') !== '' && Math.abs(Number((document.querySelector('.scoreboard-cell-portfolio .sb-value-lg')?.textContent || '').replace(/[^0-9.-]/g, '')) - want) < 1, TOTAL_USD, { timeout: 15_000 }).catch(() => {});
    await page.waitForSelector('.perf-legend-item', { state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const before = await read();
    const stores = await page.evaluate(() => new Promise((res) => {
      const rq = indexedDB.open('dp-charts');
      rq.onsuccess = () => {
        const db = rq.result;
        const names = [...db.objectStoreNames].sort();
        if (!names.includes('ytd')) { db.close(); res({ names, rows24h: 0 }); return; }
        const k = db.transaction('ytd').objectStore('ytd').getAllKeys();
        k.onsuccess = () => { res({ names, rows24h: k.result.filter((x) => String(x).includes('|1D:')).length }); db.close(); };
      };
      rq.onerror = () => res({ names: [], rows24h: 0 });
    }));
    if (JSON.stringify(stores.names) === JSON.stringify(['maCache', 'tickerChart', 'ytd']) && stores.rows24h > 0) {
      ok(S('store'), `the chart store holds all three object stores and ${stores.rows24h} rows of the 24H window after a session`);
    } else fail(S('store'), `stores ${JSON.stringify(stores)} — the vs-S&P chart's bars would not survive a reload`);

    loadOverride = storedAt(0.95);
    holdMs = 1500;
    heldAnswers.length = 0;
    // Six minutes on, past the 24H window's five-minute freshness, so the
    // chart asks the network again as well.
    await page.clock.setFixedTime(new Date(NOW_MS + 6 * 60e3));
    await page.reload({ waitUntil: 'commit' });
    const seen = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 3200) {
      const snap = await read().catch(() => null);
      if (snap && snap.pf) seen.push({ t: Date.now() - t0, ...snap });
      await page.waitForTimeout(15);
    }
    holdMs = 0;
    loadOverride = null;
    const first = seen[0];
    const same = (x) => x.pf === before.pf && x.day === before.day && x.chart === before.chart && x.flat === before.flat;
    if (!before.chart || before.chart.startsWith('[') || before.flat !== false) {
      fail(S('first-paint'), `the page never settled before the reload: chart ${before.chart}, flat ${before.flat}`);
    } else if (first && same(first)) {
      ok(S('first-paint'), `the first paint (${first.t} ms) is what was on screen: ${first.pf}, ${first.day}, ${first.chart}`);
    } else {
      fail(S('first-paint'), `first paint ${first ? `${first.t} ms: ${first.pf} | ${first.day} | ${first.chart} | flat ${first.flat}` : 'never'}; before the reload ${before.pf} | ${before.day} | ${before.chart}`);
    }
    const moved = seen.find((x) => !same(x));
    const answered = heldAnswers.some((a) => a.includes('action=load')) && heldAnswers.some((a) => a.startsWith('/prices'));
    if (!answered) fail(S('steady'), `the held answers never landed inside the window (${heldAnswers.join(', ') || 'none'})`);
    else if (!moved) ok(S('steady'), `${seen.length} reads over 3.2 s, through the book and the quotes landing at 1.5 s: nothing moved, no "Computing…", no flat line`);
    else fail(S('steady'), `at ${moved.t} ms it read ${moved.pf} | ${moved.day} | ${moved.chart} | flat ${moved.flat} (was ${before.pf} | ${before.day} | ${before.chart})`);
    await ctx.close();
  }

  // ---- 0d. the Agents page opens drawn, the first time after a reload too --
  // Davies (2026-09-23): "every time I open it I have to wait for loading".
  // Two waits, measured: the page's data lived in memory only, so the first
  // open after a reload said "Loading…" for the length of the dashboard call
  // (and asked for it a second time while the app's own fetch was out); and
  // its CODE, although fetched after first paint, went through React.lazy,
  // which suspends a first render whatever is in memory — ~290 ms of frame
  // even when opened long after the chunk arrived. Here every answer is held
  // back 1.5 s, the page is opened the moment the board paints, and it must
  // be drawn from the first read — with values hidden too, where the kept
  // copy must be masked like everything else.
  for (const vp of [{ name: 'desktop', width: 1400, height: 1000 },
                    { name: 'phone', width: 390, height: 844 }]) {
    const S = (n) => `${vp.name}/agents-reload/${n}`;
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses, { blockServiceWorkers: true });
    const openAgents = async () => {
      await page.locator('.header-menu-btn, .header-menu button').first().click();
      await page.locator('.header-menu-item:text-is("Agents (beta)")').first().click();
    };
    const readModal = () => page.evaluate(() => {
      const modal = document.querySelector('.modal');
      if (!modal) return null;
      const text = modal.textContent || '';
      const usd = [...modal.querySelectorAll('.ag-scoreboard .ag-sb-usd')].map((n) => (n.textContent || '').trim());
      return { drawn: !!modal.querySelector('.ag-scoreboard'), loading: /loading…/i.test(text), realised: (modal.querySelector('.ag-sb-realised .ag-sb-usd')?.textContent || '').trim(), usd };
    });
    // The page's code: every agents chunk the reload asked for, finished.
    const chunk = /\/assets\/agents-[^/]+\.js$/;
    const chunks = { started: new Set(), done: new Set() };
    page.on('request', (r) => { if (chunk.test(r.url())) chunks.started.add(r.url()); });
    page.on('requestfinished', (r) => { if (chunk.test(r.url())) chunks.done.add(r.url()); });
    await openAgents();
    await page.waitForSelector('.ag-scoreboard', { timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    for (const hidden of [false, true]) {
      if (hidden) {
        await page.locator('.hide-eye').first().click();
        await page.waitForTimeout(200);
      }
      holdMs = 1500;
      heldAnswers.length = 0;
      await page.clock.setFixedTime(new Date(NOW_MS + (hidden ? 12 : 6) * 60e3));
      chunks.started.clear();
      chunks.done.clear();
      await page.reload({ waitUntil: 'commit' });
      await page.waitForSelector('.scoreboard-cell-portfolio .sb-value-lg', { timeout: 20_000 });
      // Opened as soon as its code has arrived — tens of milliseconds after the
      // board paints, long before any held answer can land. A click that beats
      // the code itself gets the page's frame, and section 0 pins that frame.
      const codeBy = Date.now() + 5000;
      while (Date.now() < codeBy && !(chunks.started.size > 0 && [...chunks.started].every((u) => chunks.done.has(u)))) await page.waitForTimeout(10);
      await page.waitForTimeout(50);
      await openAgents();
      const t0 = Date.now();
      const reads = [];
      while (Date.now() - t0 < 2600) {
        const r = await readModal().catch(() => null);
        if (r) reads.push({ t: Date.now() - t0, ...r });
        await page.waitForTimeout(15);
      }
      holdMs = 0;
      const first = reads[0];
      const bad = reads.find((r) => !r.drawn || r.loading);
      const asks = heldAnswers.filter((a) => a.includes('action=dashboard')).length;
      if (!hidden) {
        if (first && !bad && first.realised === '+$78.36' && asks === 1) {
          ok(S('open'), `opened as soon as its code arrived: drawn from the first read (realised ${first.realised}), never "Loading…" through the held answer, one dashboard request`);
        } else fail(S('open'), `first read ${JSON.stringify(first)}; first undrawn/loading read ${JSON.stringify(bad)}; dashboard requests ${asks}`);
      } else {
        const digits = reads.filter((r) => r.usd.some((u) => /\d/.test(u)));
        if (first && !bad && first.usd.length > 0 && digits.length === 0) {
          ok(S('hidden'), `with values hidden the kept copy is drawn masked from the first read (${first.usd.slice(0, 2).join(', ')})`);
        } else fail(S('hidden'), `first read ${JSON.stringify(first)}; undrawn/loading ${JSON.stringify(bad)}; reads with digits ${digits.length}`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await page.locator('.hide-eye').first().click().catch(() => {});
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

    // ---- 4b. 24H with extended hours: an OPEN only where the open is --
    // The futures chart marks the regular session's OPEN and CLOSE. The
    // fixture's session starts at 14:00 UTC, after the 13:30 open, with
    // no bar before it, so this window does not contain the open and
    // nothing may be labelled OPEN. The first build put "OPEN" on the
    // window's first point whenever it came after the open: on Saturday
    // 2026-09-26 it labelled Friday 20:50 BST, the first bar of a window
    // that held Friday's last hour of futures (Davies' screenshot).
    await page.locator('#perf-tab-sp:visible').first().click();
    await page.locator('.ext-switch:visible').first().click();
    await page.waitForTimeout(900);
    await page.locator('.perf-range-btn:visible:text-is("24H")').first().click();
    await page.waitForTimeout(500);
    const marks = await page.evaluate(() => {
      const panel = [...document.querySelectorAll('.perf-chart-wrap')]
        .find((w) => w.getBoundingClientRect().width > 0)?.closest('.panel');
      return {
        futures: /FUT/.test(panel?.querySelector('.view-tab.is-on')?.textContent || ''),
        texts: [...(panel?.querySelectorAll('svg text') || [])].map((t) => (t.textContent || '').trim()),
      };
    });
    if (!marks.futures) fail(S('markers/24H-ext'), 'extended hours did not switch the panel to the futures view');
    else if (marks.texts.includes('OPEN')) fail(S('markers/24H-ext'), `"OPEN" drawn in a window that starts after the open (${marks.texts.join(' ')})`);
    else ok(S('markers/24H-ext'), 'no OPEN in a futures window that starts after the open');
    await page.locator('.ext-switch:visible').first().click();
    await page.waitForTimeout(700);

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
    const agentsBtn = page.locator('.header-menu-item:text-is("Agents (beta)")');
    if (await agentsBtn.count()) {
      await agentsBtn.first().click();
      await page.waitForSelector('.ag-scoreboard', { timeout: 10_000 });
      const head = await page.locator('.ag-sb-realised .ag-sb-usd').first().textContent().catch(() => '');
      await shot(page, 'agents-list');
      if (money(head) === 78.36 && /^\+/.test((head || '').trim())) ok(S('agents'), `headline is the realised total, strategies plus the three tests (${(head || '').trim()})`);
      else fail(S('agents'), `headline read "${head}", wanted +$78.36`);
      const rows = await page.locator('.ag-row').count();
      // Three since `0046` deleted the Kraken twin (§4.22): `0043` retired the two rotations and the
      // Kraken momentum twin, `0044` deleted them, and the twin made no decision of its own. The rows
      // those migrations removed are off the page because none of them still holds anything here.
      // Plus the quote test, a row of TESTING STRATEGIES since 2026-09-23 (Davies), and RW's paper test on Polymarket
      // since 2026-09-24 (Davies).
      if (rows === 9) ok(S('agents'), 'nine rows — the three 0046 leaves, their Binance twins (0049), the quote test, RW and RW-E, the deleted ones absent');
      else fail(S('agents'), `expected 9 rows (six strategies, the quote test, RW and RW-E), got ${rows}`);
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
      // NEXT reads whole on every row. The quote test's "every minute" needs 93 px where the table gives the column
      // 66, and was ellipsised to "every mi…" (Davies, 2026-09-23); it now breaks between its words inside the row.
      const nextCells = await page.evaluate(() => [...document.querySelectorAll('.ag-strategies .ag-row')].map((row) => {
        const span = row.querySelector('.ag-next');
        const cell = row.querySelector('td.ag-col-next') || span;
        return { name: (row.querySelector('.ag-name-btn')?.textContent || '').trim(), text: (span?.textContent || '').trim(), scroll: cell ? cell.scrollWidth : -1, client: cell ? cell.clientWidth : -1 };
      }));
      const quotesNext = nextCells.find((c) => c.name === 'Stablecoin quotes');
      const clippedNext = nextCells.filter((c) => c.scroll > c.client + 0.5);
      if (quotesNext && quotesNext.text === 'every minute' && clippedNext.length === 0) {
        ok(S('agents'), `every NEXT cell reads whole, the quote test's "${quotesNext.text}" included (${quotesNext.scroll} of ${quotesNext.client} px)`);
      } else fail(S('agents'), `NEXT cells cut off: ${JSON.stringify(clippedNext)}; the quote test's reads ${JSON.stringify(quotesNext)}`);
      const todayHead = await page.locator('.ag-strategies th.ag-col-today').count();
      if (vpWidth <= 760 ? true : todayHead === 1) ok(S('agents'), vpWidth <= 760 ? 'the card carries today' : 'the table has a Today column');
      else fail(S('agents'), `Today header cells: ${todayHead}`);
      // Today is the one cell a fixture of all zeros cannot test: the payload carries +$0.42 on the row with a book.
      const sbToday = await page.locator('.ag-scoreboard .ag-sb-cell', { has: page.locator('.ag-sb-name:text-is("TODAY")') }).locator('.ag-sb-usd').textContent().catch(() => '');
      const rowToday = (await page.locator(vpWidth <= 760 ? '.ag-card-strategy .ag-card-today' : 'td.ag-col-today .ag-gl').allTextContents()).map((t) => t.trim());
      const signedToday = rowToday.filter((t) => /^\+\$0\.42/.test(t)).length;
      const rowTodaySum = Math.round(rowToday.reduce((a, t) => a + money(String(t).split('(')[0]), 0) * 100);
      if (rowTodaySum === Math.round(money(sbToday) * 100) && /^\+/.test((sbToday || '').trim()) && signedToday === 1) {
        ok(S('agents'), `today on the scoreboard (${(sbToday || '').trim()}) is the rows' today added up, and the row with a book still reads +$0.42`);
      } else fail(S('agents'), `scoreboard today "${sbToday}", row today cells ${rowToday.join(' | ')}`);
      const badgeTexts = await page.locator('.ag-strategies .ag-venue').allTextContents();
      if (badgeTexts.length === rows && badgeTexts.every((b) => /^(Revolut X|Binance|Polymarket)$/.test(b.trim()))) ok(S('agents'), 'the venue badge is the venue name alone');
      else fail(S('agents'), `badges: ${badgeTexts.join(' | ')}`);
      // The badge fits its cell: a cell that clips draws the first dot of an ellipsis after the badge — the
      // "small white dot" beside Revolut X the owner saw — so overflow must be zero, not just invisible.
      const clippedVenue = vpWidth > 760
        ? await page.locator('.ag-strategies td.ag-col-venue').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth || getComputedStyle(el).textOverflow === 'ellipsis').length)
        : 0;
      if (clippedVenue === 0) ok(S('agents'), vpWidth > 760 ? 'every venue badge fits its cell, nothing clipped or ellipsised' : 'no venue column on a phone');
      else fail(S('agents'), `${clippedVenue} venue cells clip their badge`);
      // Nothing is live: the page opens on TESTING, whose one table is this list, and it is the LIVE tab that says so.
      const sectionTitle = (await page.locator('.ag-strategies .ag-section-title').allTextContents()).map((t) => t.trim());
      const liveTables = await page.locator('.ag-strategies-live').count();
      const liveTabText = ((await page.locator('#ag-modetab-live .ag-modetab-text').textContent().catch(() => '')) || '').trim();
      if (sectionTitle.join('|') === 'TESTING STRATEGIES' && liveTables === 0 && liveTabText === 'Nothing is live') {
        ok(S('agents'), `nothing is live, so the LIVE tab says so ("${liveTabText}") and the page opens on TESTING's one table`);
      } else fail(S('agents'), `strategy sections: ${sectionTitle.join(' | ')}, live tables ${liveTables}, LIVE tab "${liveTabText}"`);
      if (vpWidth > 760) {
        const nameAlign = await page.locator('.ag-strategies td.ag-col-name').first().evaluate((el) => getComputedStyle(el).textAlign);
        if (nameAlign === 'left') ok(S('agents'), 'the strategy name reads from the left, under the dot beside it');
        else fail(S('agents'), `name column text-align ${nameAlign}`);
      }
      // Five cells since 2026-09-24 (Davies): FUNDED before DEPLOYED, DEPLOYED as a percent of it; no total.
      // REALIZED's title matches the other cells; the fees are smaller and in parentheses (Davies, 2026-09-25).
      const boardFits = (sel) => page.locator(sel).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const label = el.querySelector('.ag-sb-realised .ag-sb-label');
        const outside = [...el.querySelectorAll('.ag-sb-name, .ag-sb-aside, .ag-sb-usd, .sb-pct, .ag-sb-deployed-pct')].filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.right > box.right + 1.5;
        }).map((n) => (n.textContent || '').trim());
        const names = [...el.querySelectorAll('.ag-sb-name')];
        const sizes = names.map((n) => getComputedStyle(n).fontSize);
        const tracks = names.map((n) => getComputedStyle(n).letterSpacing);
        const aside = el.querySelector('.ag-sb-aside');
        const asideSize = aside ? parseFloat(getComputedStyle(aside).fontSize) : null;
        const nameSize = names[0] ? parseFloat(getComputedStyle(names[0]).fontSize) : 0;
        const nameEl = el.querySelector('.ag-sb-realised .ag-sb-name');
        const asideEl = el.querySelector('.ag-sb-realised .ag-sb-aside');
        const nr = nameEl?.getBoundingClientRect();
        const ar = asideEl?.getBoundingClientRect();
        // A smaller fee sits on the title's baseline, so its top is a few pixels lower.
        // Wrapped, it starts back at the left, under the title. Beside means it starts at
        // the title's right edge and the two boxes still overlap vertically.
        const sameLine = !!(nr && ar && ar.left >= nr.right - 1 && ar.top < nr.bottom && nr.top < ar.bottom);
        return {
          overflow: Math.round(el.scrollWidth - el.clientWidth), outside,
          labelH: label ? Math.round(label.getBoundingClientRect().height) : 0,
          titlesMatch: sizes.length >= 2 && sizes.every((s) => s === sizes[0]) && tracks.every((t) => t === tracks[0]),
          feesSmaller: asideSize != null && asideSize < nameSize - 0.1,
          sameLine,
        };
      });
      const sbCells = await page.locator('.ag-modepanel > .ag-scoreboard .ag-sb-cell').evaluateAll((els) => els.map((c) =>
        [c.querySelector('.ag-sb-name')?.textContent, ...[...c.querySelectorAll('.ag-sb-aside')].map((a) => a.textContent)].map((t) => (t || '').trim()).join(' / ')));
      const sbFit = await boardFits('.ag-modepanel > .ag-scoreboard');
      if (sbCells.join(' | ') === 'FUNDED | DEPLOYED | TODAY | UNREALIZED G/L | REALIZED G/L / (incl. fees $0.08)' && sbFit.overflow <= 1 && sbFit.outside.length === 0 && sbFit.labelH > 0 && sbFit.titlesMatch && sbFit.feesSmaller && sbFit.sameLine) {
        ok(S('agents'), 'five cells, FUNDED first, no total; REALIZED\'s title matches the others and the fees sit beside it on one line, smaller, in parentheses, inside the frame');
      } else fail(S('agents'), `scoreboard cells: ${sbCells.join(' | ')}; fit ${JSON.stringify(sbFit)}`);
      const meters = await page.locator('.ag-sb-meter').count();
      if (meters === 0) ok(S('agents'), 'DEPLOYED has no progress bar');
      else fail(S('agents'), `${meters} deployed meters`);
      const under = await page.locator('.ag-sb-under').count();
      if (under === 0) ok(S('agents'), 'no explanatory line under the scoreboard');
      else fail(S('agents'), `${under} sub-lines under the scoreboard`);
      const cardLabels = (await page.locator('.ag-venue-card-binance .ag-venue-grid .ag-fig-name').allTextContents()).map((t) => t.trim());
      if (cardLabels.includes('unrealised') && cardLabels.includes('realised') && !cardLabels.some((t) => /total/.test(t))) ok(S('agents'), 'a venue card shows unrealised and realised, no total');
      else fail(S('agents'), `venue card rows: ${cardLabels.join(' | ')}`);
      // Davies, 2026-09-23: funded says "(Paper)" and deployed does not — one label is enough — and the paper capital
      // row is gone: its figure IS the funding now, and the accounts' real balances are not on the page (every row
      // trades paper; they only misled).
      const revxLabels = (await page.locator('.ag-venue-card-revx .ag-venue-grid .ag-fig-name').allTextContents()).map((t) => t.trim());
      if (['funded (Paper)', 'deployed'].every((l) => revxLabels.includes(l) && cardLabels.includes(l)) && ![...revxLabels, ...cardLabels].some((t) => /paper capital|deployed \(Paper\)/.test(t))) ok(S('agents'), 'both cards read funded (Paper) and a bare deployed, with no paper capital row');
      else fail(S('agents'), `card labels: revx ${revxLabels.join(' | ')} / binance ${cardLabels.join(' | ')}`);
      // "funded (Paper)" is one line on every card, Polymarket included: the third card used to break it after "funded".
      const fundedLines = await page.locator('.ag-venue-card .ag-fig-name').evaluateAll((els) => els.filter((el) => /funded/.test(el.textContent || '')).map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const card = el.closest('.ag-venue-card')?.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return { text: (el.textContent || '').trim(), lines: range.getClientRects().length, outside: !!(card && box.right > card.right + 1) };
      }));
      if (fundedLines.length >= 2 && fundedLines.every((x) => x.lines === 1 && x.text === 'funded (Paper)' && !x.outside)) ok(S('agents'), `funded (Paper) is one line on every venue card (${fundedLines.length})`);
      else fail(S('agents'), `funded labels: ${JSON.stringify(fundedLines)}`);
      // PR5's quotes on paper are a row of TESTING STRATEGIES (Davies, 2026-09-23), last, in a strategy's cells; the card
      // they had below the table is gone.
      const quoteRow = page.locator('.ag-strategies-testing .ag-row', { has: page.locator('.ag-name-btn:text-is("Stablecoin quotes")') });
      const quoteRowText = (await quoteRow.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const oldCard = await page.locator('.ag-quotes .ag-section-title').count() + await page.locator('text=STABLECOIN QUOTES — PAPER TEST').count();
      if (await quoteRow.count() === 1 && /Revolut X/.test(quoteRowText) && !/not in the scoreboard/.test(quoteRowText) && /1 open · \$1,200 cap/.test(quoteRowText)
        && /\+\$0\.42/.test(quoteRowText) && /\+\$0\.12/.test(quoteRowText) && /\+\$0\.14 \(\+0\.14%\)/.test(quoteRowText) && !/% of deployed/.test(quoteRowText) && oldCard === 0) {
        ok(S('agents'), 'the quote test is a testing row: Revolut X, 1 open of $1,200, counted in the scoreboard, today +$0.12, unrealised +$0.14 with no "% of deployed", realised +$0.42; no card below');
      } else fail(S('agents'), `quote row "${quoteRowText}", old card sections ${oldCard}`);
      const quotesInVenues = await page.locator('.ag-venue-cards .ag-quotes-card, .ag-quotes-cards .ag-venue-card').count();
      if (quotesInVenues === 0) ok(S('agents'), 'no quote card is a venue card, and no venue selector reaches one');
      else fail(S('agents'), `${quotesInVenues} quotes/venue cards cross-classed`);
      // Its page: the strategy page's header and scoreboard, then two books of six rungs and the round trips.
      await quoteRow.first().click();
      await page.waitForSelector('.ag-quotes-detail', { timeout: 5_000 }).catch(() => {});
      const qTitle = ((await page.locator('.modal .modal-title').last().textContent().catch(() => '')) || '').trim();
      // Its scoreboard's names; its head keeps the mode and the status, and lost its line of detail (Davies, 2026-09-24).
      const qLabels = (await page.locator('.ag-quotes-detail .ag-scoreboard-sm .ag-sb-name').allTextContents()).map((t) => t.trim());
      const qHeadMeta = await page.locator('.ag-quotes-detail .ag-detail-head .ag-venue-meta').count();
      const qAside = ((await page.locator('.ag-quotes-detail .ag-quotes-foot').textContent().catch(() => '')) || '').trim();
      const qBooks = (await page.locator('.ag-quotes-detail .ag-quotes-card .ag-quotes-head .hl-strong').allTextContents()).map((t) => t.trim());
      const qRungs = await page.locator('.ag-quotes-detail .ag-ladder tbody tr').count();
      const qHeld = (await page.locator('.ag-quotes-detail .ag-ladder .ag-qheld').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const qTrips = await page.locator('.ag-quotes-detail .ag-quote-trips tbody tr').count();
      const qFirst = ((await page.locator('.ag-quotes-detail .ag-quote-trips tbody tr').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const qLive = ((await page.locator('.ag-quotes-detail .ag-quotes-live-line').textContent().catch(() => '')) || '').trim();
      await shot(page, 'agents-quotes');
      const qStacked = await page.locator('.modal').count();
      if (qLive === 'Live path: dry run · 12 orders it would have sent today') ok(S('agents'), `its live path says it is dry-run: "${qLive}"`);
      else fail(S('agents'), `quote page live line "${qLive}"`);
      if (qTitle === 'Stablecoin quotes' && qLabels.join(',') === 'FUNDED,DEPLOYED,TODAY,UNREALIZED G/L,REALIZED G/L' && qHeadMeta === 0 && /^as of \d{1,2} \w{3} \d{2}:\d{2} [A-Z]+ · refreshes every minute$/.test(qAside) && qBooks.join(',') === 'USDC/GBP,USDT/GBP'
        && qRungs === 6 && qHeld.length === 1 && /held £0\.7542 \+\$0\.1400$/.test(qHeld[0]) && qTrips === 7 && /USDT\/GBP sold £0\.7564 £0\.7550/.test(qFirst.replace(/0\.2 % /, '').replace(/ maker/, ''))
        && /\+\$0\.1000$/.test(qFirst.trim()) && qStacked === 2) {
        ok(S('agents'), 'its page opens over the list: FUNDED first on its scoreboard, no line of detail in its head, USDC/GBP and USDT/GBP with three rungs a side, the held bid at £0.7542 (+$0.1400), and all 7 round trips, newest first, each P&L to four places like its prices');
      } else fail(S('agents'), `quote page: title "${qTitle}", labels ${qLabels.join(',')} (${qAside}), head meta ${qHeadMeta}, books ${qBooks.join(',')}, rungs ${qRungs}, held ${qHeld.join(' | ')}, trips ${qTrips}, first "${qFirst}", modals ${qStacked}`);
      const qHeads = await page.locator('.modal').last().locator('.modal-head-actions button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      if (qHeads.join(',') === 'Refresh,Close') ok(S('agents'), 'the quote page has the same refresh button beside close');
      else fail(S('agents'), `quote page actions ${qHeads.join(',')}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-quotes-detail').count() === 0 && await page.locator('.ag-strategies .ag-row').count() === 9) ok(S('agents'), 'closing the quote page returns to the list');
      else fail(S('agents'), 'the quote page did not close back to the list');
      // RW's paper test on Polymarket (Davies, 2026-09-24): the last row of TESTING STRATEGIES, in a strategy's cells,
      // with its own badge; the fixture's figures are rwSummary's own (AGENTS_RW).
      const rwRowEl = page.locator('.ag-strategies-testing .ag-row', { has: page.locator('.ag-name-btn:text-is("Reward quotes")') });
      const rwRowText = (await rwRowEl.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const testNames = (await page.locator('.ag-strategies-testing .ag-row .ag-name-btn').allTextContents()).map((t) => t.trim());
      const rwBadge = await rwRowEl.first().locator('.ag-venue-polymarket').count();
      if (await rwRowEl.count() === 1 && testNames.slice(-2).join('|') === 'Reward quotes|Reward quotes · no same-day' && rwBadge === 1 && /Polymarket/.test(rwRowText) && !/not in the scoreboard/.test(rwRowText)
        && /2 open · \$296 cap/.test(rwRowText) && /\+\$12\.50/.test(rwRowText) && /-\$1(?!\d)/.test(rwRowText) && /\+\$42(?!\d)/.test(rwRowText) && /every minute/.test(rwRowText)) {
        ok(S('agents'), 'RW is the testing row before RW-E: Polymarket, 2 open of $296, counted in the scoreboard, today +$12.50, unrealised -$1, realised +$42, every minute');
      } else fail(S('agents'), `RW row "${rwRowText}", testing rows ${testNames.join(' | ')}, Polymarket badges ${rwBadge}`);
      // RW-E, the last row (Davies, 2026-09-26): RW's cells read from the replay's arm, by the fixture's own figures —
      // today 7.50 on $235 (+3.19%), unrealised −1.20 on D's No, which cost 20 × 0.34 (−17.65%), realised 23.60 (+10.04%).
      const rweRowEl = page.locator('.ag-strategies-testing .ag-row', { has: page.locator('.ag-name-btn:text-is("Reward quotes · no same-day")') });
      const rweRowText = (await rweRowEl.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (await rweRowEl.count() === 1 && await rweRowEl.first().locator('.ag-venue-polymarket').count() === 1 && /1 open · \$235 cap/.test(rweRowText)
        && /\+\$7\.50 \(\+3\.19%\)/.test(rweRowText) && /-\$1\.20 \(-17\.65%\)/.test(rweRowText) && /\+\$23\.60 \(\+10\.04%\)/.test(rweRowText) && /every 5 minutes/.test(rweRowText)) {
        ok(S('agents'), 'RW-E is the last testing row: Polymarket, 1 open of $235, today +$7.50 (+3.19%), unrealised -$1.20 (-17.65%), realised +$23.60 (+10.04%), every 5 minutes');
      } else fail(S('agents'), `RW-E row "${rweRowText}"`);
      // Its page: the strategy page's header and scoreboard, the bar so far, today's markets, the closed days and the fills.
      await rwRowEl.first().click();
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      const rTitle = ((await page.locator('.modal .modal-title').last().textContent().catch(() => '')) || '').trim();
      // Its scoreboard, name by name, and the rewards-and-orders lines under realised and unrealised (Davies, 2026-09-24).
      const rLabels = (await page.locator('.ag-rw-detail .ag-scoreboard-sm .ag-sb-name').allTextContents()).map((t) => t.trim());
      // Rewards and orders each take a line, and neither wraps through its amount (Davies, 2026-09-25).
      const rSplitLines = await page.locator('.ag-rw-detail .ag-scoreboard-sm .ag-sb-split-line').evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        const cell = el.closest('.ag-sb-cell')?.getBoundingClientRect();
        return {
          text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          top: r.top,
          oneLine: el.getClientRects().length === 1,
          fits: !!cell && r.left >= cell.left - 1 && r.right <= cell.right + 1,
        };
      }));
      const rSections = (await page.locator('.ag-rw-detail .ag-section-title').allTextContents()).map((t) => t.trim());
      const rMarkets = await page.locator('.ag-rw-markets tbody tr').count();
      const rHeldRow = ((await page.locator('.ag-rw-markets tbody tr').last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const rFirst = ((await page.locator('.ag-rw-markets tbody tr').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const rDays = (await page.locator('.ag-rw-days tbody tr td:first-child').allTextContents()).map((t) => t.trim());
      const rDayHeads = (await page.locator('.ag-rw-days thead th').allTextContents()).map((t) => t.trim());
      const rFirstDay = ((await page.locator('.ag-rw-days tbody tr').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const rFills = await page.locator('.ag-rw-fills tbody tr').count();
      const rFillHeads = (await page.locator('.ag-rw-fills thead th').allTextContents()).map((t) => t.trim());
      const rFirstFill = ((await page.locator('.ag-rw-fills tbody tr').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const narrow = vpWidth <= 760;
      const rFillEq = narrow ? 0 : await page.locator('.ag-rw-fills').evaluate((el) => {
        const heads = [...el.querySelectorAll('thead th')];
        const shares = heads.find((h) => /Shares/.test(h.textContent || ''));
        const price = heads.find((h) => /^Price/.test((h.textContent || '').trim()));
        if (!shares || !price) return -1;
        return Math.abs(shares.getBoundingClientRect().width - price.getBoundingClientRect().width);
      }).catch(() => -1);
      const rBar = ((await page.locator('.ag-rw-bar').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      // The head's line of detail and the formula's note are gone (Davies, 2026-09-24); where the run is, is the bar's line.
      const rNote = await page.locator('.ag-rw-note').count();
      const rFoot = ((await page.locator('.ag-rw-foot').textContent().catch(() => '')) || '').trim();
      const rMeta = await page.locator('.ag-rw-detail .ag-detail-head .ag-venue-meta').count();
      const rWhen = ((await page.locator('.ag-rw-bar .ag-rw-when').textContent().catch(() => '')) || '').trim();
      const rTiles = (await page.locator('.ag-rw-bar .ag-rw-tile-k').allTextContents()).map((t) => t.trim());
      const rWarn = await page.locator('.ag-rw-detail .ag-warn-line').count();
      // A market is its question: the first one reads to its date, in two lines on a desk and four on a phone.
      const rQ = await page.locator('.ag-rw-markets tbody tr').first().locator('.ag-rw-q').evaluate((el) => ({ clipped: el.scrollHeight > el.clientHeight + 1, lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)) })).catch(() => ({ clipped: true, lines: 0 }));
      await shot(page, 'agents-rw');
      const rPh = await page.locator('.ag-rw-detail th.ag-ph').evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== 'none').length);
      const rOverflow = await page.locator('.ag-rw-detail').evaluate((el) => el.scrollWidth - el.clientWidth);
      if (rTitle === 'Reward quotes' && rLabels.join(',') === 'FUNDED,DEPLOYED,TODAY,UNREALIZED G/L,REALIZED G/L'
        && rSplitLines.length === 2 && rSplitLines[0].text === 'rewards +$41.60' && rSplitLines[1].text === 'orders +$0.40'
        && rSplitLines.every((l) => l.oneLine && l.fits) && rSplitLines[1].top > rSplitLines[0].top + 2
        && rSections.join(',') === 'STATUS,DAYS,WITHOUT SAME-DAY MARKETS,QUOTES,FILLS' && rMarkets === 4 && /Los Angeles/.test(rFirst) && /20 Yes/.test(rFirst)
        && (narrow || /43¢ \/ 45¢/.test(rFirst)) && /held from an earlier day/.test(rHeldRow) && /20 No/.test(rHeldRow)
        && rDayHeads.join(',') === 'Day (UTC),Costs,Fills,WORST CASE,Rewards,Total'
        && rDays.length === 4 && /· today$/.test(rDays[0]) && /^\d{1,2} Sep$/.test(rDays[1]) && /warm-up$/.test(rDays[3])
        && /\$296(?!\d)/.test(rFirstDay) && /\+\$12\.50/.test(rFirstDay) && (narrow || (/\b2\b/.test(rFirstDay) && /\+\$6\.10/.test(rFirstDay)))
        && /^When \([A-Z]+\),Market,Side,Shares,Price$/.test(rFillHeads.join(',')) && rFillEq < 1.5
        && rFills === 5 && /Bank of Canada/.test(rFirstFill) && /sold Yes/.test(rFirstFill) && /46¢/.test(rFirstFill) && rFirstFill.indexOf('20.13') < rFirstFill.indexOf('46¢') && !/20\.129/.test(rFirstFill)
        && rTiles.join(',') === 'WORST CASE,TOP SHARE,QUOTING TODAY,POSITIONS STILL HELD' && /WORST CASE \+\$17\.20/.test(rBar) && /45 %/.test(rBar) && /QUOTING TODAY/.test(rBar) && /POSITIONS STILL HELD/.test(rBar) && !/if rewards were halved/.test(rBar)
        && rNote === 0 && rMeta === 0 && rWhen === '' && !/Day \d+ of 14/.test(rBar) && await page.locator('.ag-rw-run').count() === 0
        && /^as of \d{1,2} \w{3} \d{2}:\d{2} [A-Z]+ · refreshes every minute$/.test(rFoot) && rWarn === 0
        && (narrow ? rPh === 0 : rPh > 0) && rOverflow <= 1 && !rQ.clipped && rQ.lines <= (narrow ? 4 : 2)) {
        ok(S('agents'), `its page: FUNDED first, realised stays inside its cell, STATUS is worst case, top share, quoting today and positions still held, the open day leads the days, 4 quotes, 4 days, 5 fills; ${narrow ? 'the phone drops the side columns' : 'every column'}`);
      } else fail(S('agents'), `RW page: title "${rTitle}", labels ${rLabels.join(',')}, split ${JSON.stringify(rSplitLines)}, sections ${rSections.join(',')}, markets ${rMarkets} ("${rFirst}" / "${rHeldRow}"), days ${rDayHeads.join(',')} / ${rDays.join('|')} / "${rFirstDay}", fills ${rFills} heads ${rFillHeads.join(',')} eq ${rFillEq} ("${rFirstFill}"), tiles ${rTiles.join(',')}, bar "${rBar}", note ${rNote}, meta ${rMeta}, when "${rWhen}", foot "${rFoot}", warnings ${rWarn}, side columns shown ${rPh}, overflow ${rOverflow}, question ${JSON.stringify(rQ)}`);
      // RW-E beside RW (Davies, 2026-09-26): both arms of one replay since RW-E's first day, what is left out today, the check.
      const eRows = (await page.locator('.ag-rw-e tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      const eHead = ((await page.locator('.ag-rw-e thead th').first().textContent().catch(() => '')) || '').trim();
      const eLines = (await page.locator('.ag-rw-e .ag-rw-e-line').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      if (eRows.length === 2 && /^Every market \+\$27\.70 -\$3\.10/.test(eRows[0]) && /^Without same-day markets \+\$31\.40 \+\$9\.50/.test(eRows[1])
        && /^Since \d{1,2} Sep$/.test(eHead) && eLines.some((l) => l === "1 of today's markets end today and are left out · the replay matches RW's own 2 days")
        && await page.locator('.ag-rw-e .ag-warn-line').count() === 0) {
        ok(S('agents'), 'RW-E beside RW: every market +$27.70 (worst case -$3.10) against without same-day markets +$31.40 (+$9.50), one left out today, the replay matching RW');
      } else fail(S('agents'), `RW-E section: head "${eHead}", rows ${JSON.stringify(eRows)}, lines ${JSON.stringify(eLines)}`);
      const rHeads = await page.locator('.modal').last().locator('.modal-head-actions button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      if (rHeads.join(',') === 'Refresh,Close') ok(S('agents'), 'the reward page has the same refresh button beside close');
      else fail(S('agents'), `reward page actions ${rHeads.join(',')}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-rw-detail').count() === 0 && await page.locator('.ag-strategies .ag-row').count() === 9) ok(S('agents'), 'closing the RW page returns to the list');
      else fail(S('agents'), 'the RW page did not close back to the list');
      // RW-E's page is RW's page read from the replay's arm: its title, the same scoreboard and sections, today and its two
      // closed days (the replay starts with the fourteen days: no warm-up row), the three markets it has, and its fills.
      await rweRowEl.first().click().catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      const eTitle = ((await page.locator('.modal .modal-title').last().textContent().catch(() => '')) || '').trim();
      const eLabels = (await page.locator('.ag-rw-detail .ag-scoreboard-sm .ag-sb-name').allTextContents()).map((t) => t.trim());
      const eSplit = (await page.locator('.ag-rw-detail .ag-scoreboard-sm .ag-sb-split-line').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const eSections = (await page.locator('.ag-rw-detail .ag-section-title').allTextContents()).map((t) => t.trim());
      const eDays = (await page.locator('.ag-rw-days tbody tr td:first-child').allTextContents()).map((t) => t.trim());
      const eFirstDay = ((await page.locator('.ag-rw-days tbody tr').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const eMarkets = await page.locator('.ag-rw-markets tbody tr').count();
      const eFills = await page.locator('.ag-rw-fills tbody tr').count();
      const eWarn = await page.locator('.ag-rw-detail .ag-warn-line').count();
      await shot(page, 'agents-rwe');
      if (eTitle === 'Reward quotes · no same-day' && eLabels.join(',') === 'FUNDED,DEPLOYED,TODAY,UNREALIZED G/L,REALIZED G/L'
        && eSplit.join('|') === 'rewards +$23.20|orders +$0.40' && eSections.join(',') === 'STATUS,DAYS,WITHOUT SAME-DAY MARKETS,QUOTES,FILLS'
        && eDays.length === 3 && /· today$/.test(eDays[0]) && !eDays.some((d) => /warm-up/.test(d)) && /\+\$7\.50/.test(eFirstDay)
        && eMarkets === 3 && eFills === 3 && eWarn === 0) {
        ok(S('agents'), "RW-E's page is RW's page read from its arm: its own title, realised = rewards +$23.20 + orders +$0.40, today and two closed days (no warm-up), 3 markets, 3 fills");
      } else fail(S('agents'), `RW-E page: title "${eTitle}", labels ${eLabels.join(',')}, split ${eSplit.join('|')}, sections ${eSections.join(',')}, days ${eDays.join(' | ')} (first "${eFirstDay}"), markets ${eMarkets}, fills ${eFills}, warnings ${eWarn}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-rw-detail').count() === 0 && await page.locator('.ag-strategies .ag-row').count() === 9) ok(S('agents'), 'closing the RW-E page returns to the list');
      else fail(S('agents'), 'the RW-E page did not close back to the list');
      // The menu entry was found above by its exact text, "Agents (beta)"; the page's own title must say the same.
      const pageTitle = await page.locator('.modal .modal-title').first().textContent().catch(() => '');
      if ((pageTitle || '').trim() === 'Agents (beta)') ok(S('agents'), 'the page is titled Agents (beta), as the menu entry that opened it');
      else fail(S('agents'), `page title "${pageTitle}"`);
      const stripN = await page.locator('.ag-chip').count();
      const basisN = await page.locator('.ag-basis').count();
      if (stripN === 0 && basisN === 0) ok(S('agents'), 'no caps / Jev strip and no basis table on the overview');
      else fail(S('agents'), `strip chips ${stripN}, basis sections ${basisN}`);
      const alertsAtRest = await page.locator('.ag-alert').count();
      if (alertsAtRest === 0) ok(S('agents'), 'no banner when nothing blocks trading');
      else fail(S('agents'), `${alertsAtRest} alert banners on a healthy dashboard`);
      // Every row says where it trades; the split says how the book divides.
      const badges = await page.locator('.ag-row .ag-venue').allTextContents();
      const revxRows = badges.filter((b) => b.startsWith('Revolut X')).length, binanceRows = badges.filter((b) => b.startsWith('Binance')).length;
      // Four Revolut X: the three strategies and the quote test; then RW and RW-E on Polymarket, last.
      if (revxRows === 4 && binanceRows === 3 && badges[badges.length - 3].startsWith('Revolut X') && badges.slice(-2).join('|') === 'Polymarket|Polymarket') ok(S('agents'), 'venue badge on every row: 3 Revolut X strategies, their 3 paper twins on Binance, the quote test on Revolut X, and RW and RW-E on Polymarket');
      else fail(S('agents'), `venue badges: ${badges.join(' | ')}`);
      // Deployed value, by card: Revolut X $121.25 (its strategy plus the quote test) and RW and RW-E on Polymarket $20.00
      // (14.40 + 5.60) — 86 % and 14 %.
      // The bar shows the venue and its percent when that line fits the slice, and the percent alone when it does not.
      // A fixed cutoff left the middle of "Polymarket" on a slice that was still a bit wider than the cutoff.
      const shareGeom = await page.locator('.ag-share').evaluateAll((els) => els.map((el) => {
        const text = (el.textContent || '').trim();
        const range = document.createRange();
        if (text) range.selectNodeContents(el);
        const rects = text ? [...range.getClientRects()] : [];
        const textW = rects.reduce((m, r) => Math.max(m, r.width), 0);
        return {
          id: [...el.classList].find((c) => c.startsWith('ag-share-') && c !== 'ag-share') || '',
          text, title: el.getAttribute('title') || '', textW, box: el.clientWidth, lines: rects.length,
        };
      }));
      const shareOk = shareGeom.length === 3 && shareGeom[0].id === 'ag-share-revx' && shareGeom[1].id === 'ag-share-binance' && shareGeom[2].id === 'ag-share-polymarket'
        && shareGeom[1].text === '' && /Revolut X: 86%/.test(shareGeom[0].title) && /Polymarket: 14%/.test(shareGeom[2].title)
        && shareGeom.filter((g) => g.text).every((g) => g.lines === 1 && g.textW <= g.box + 1);
      if (shareOk) ok(S('agents'), `share bar fits its slices (${shareGeom.map((g) => g.text || '·').join(' | ')})`);
      else fail(S('agents'), `share bar ${JSON.stringify(shareGeom)}`);
      // A slice squeezed narrower than its name drops the name. The old cutoff still painted "Revolut X 89%" at 48px.
      const squeeze = await page.addStyleTag({ content: '.ag-share-revx{width:48px!important;max-width:48px!important;flex:0 0 48px!important;}' });
      const squeezed = await page.waitForFunction(() => (document.querySelector('.ag-share-revx')?.textContent || '').trim() === '86%', { timeout: 2000 }).then(() => true).catch(() => false);
      const squeezedFit = await page.locator('.ag-share-revx').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()];
        return { text: (el.textContent || '').trim(), w: rects.reduce((m, r) => Math.max(m, r.width), 0), box: el.clientWidth, lines: rects.length };
      }).catch(() => ({ text: '', w: 0, box: 0, lines: 0 }));
      await squeeze.evaluate((el) => el.remove());
      if (squeezed && squeezedFit.text === '86%' && squeezedFit.lines === 1 && squeezedFit.w <= squeezedFit.box + 1) ok(S('agents'), 'a slice too narrow for its name shows the percent alone, and that percent fits');
      else fail(S('agents'), `squeezed share ${JSON.stringify(squeezedFit)}`);
      const cards = await page.locator('.ag-venue-card').count();
      if (cards === 3) ok(S('agents'), 'one venue card per venue TESTING trades on: Revolut X, Binance, Polymarket');
      else fail(S('agents'), `venue cards ${cards}`);
      // Polymarket's card is its two tests summed (Davies, 2026-09-24: Polymarket in TESTING's venues; 2026-09-26: RW-E is a
      // row of its own), so it reads what TESTING's scoreboard adds for it: funded 296 + 235; deployed 14.40 + 5.60 (3.77 %
      // of 531); today 12.50 + 7.50; unrealised −1 − 1.20 on the two inventories' cost, 15.40 of RW's (A's 20 Yes at 43¢,
      // D's 20 No at 34¢) and 6.80 of RW-E's (D's): −2.20 on 22.20; realised 42 + 23.60 = rewards 41.60 + 23.20 and
      // orders 0.40 + 0.40. The first version kept RW's card and dropped RW-E's.
      const pm = await readAgentsPanel(page).then((p) => p.venues.find((v) => v.id === 'polymarket'));
      if (pm && pm.meta === '2 strategies' && pm.pairs['funded (Paper)'] === '$531' && pm.pairs.deployed === '$20 (3.77%)'
        && pm.pairs.today === '+$20 (+3.77%)' && pm.pairs.unrealised === '-$2.20 (-9.91%)' && pm.pairs.realised === '+$65.60 (+12.35%)' && !pm.bases.unrealised
        && pm.pairs.rewards === '+$64.80' && pm.pairs.orders === '+$0.80' && !('fees' in pm.pairs)) {
        ok(S('agents'), "Polymarket's card is RW and RW-E summed: funded (Paper) $531, deployed $20 (3.77%), today +$20, unrealised -$2.20 (-9.91%), realised +$65.60 = rewards +$64.80 + orders +$0.80");
      } else fail(S('agents'), `Polymarket card ${JSON.stringify(pm)}`);
      const revxApart = await page.locator('.ag-venue-card-revx .ag-venue-apart').count();
      if (revxApart === 0) ok(S('agents'), 'the Revolut X card no longer leaves Stablecoin quotes out');
      else fail(S('agents'), `Revolut X card still has an apart note (${revxApart})`);
      // Funded (Paper) is the capital the venue's rows are allotted — 100 + 40 + 40 of strategies, plus the quote
      // test's $1,200 — and the accounts' real balances are NOT shown.
      const funded = await page.locator('.ag-venue-card-revx .ag-venue-grid').textContent().catch(() => '');
      const fundedCell = await page.locator('.ag-venue-card-revx .ag-venue-grid > span:has-text("funded (Paper)") + span').textContent().catch(() => '');
      if (money(fundedCell) === 1380 && !/\$100\.00 USD/.test(funded || '')) ok(S('agents'), 'the Revolut X card is funded with its strategies plus the quote test ($1,380), not the account balance');
      else fail(S('agents'), `revx funded cell "${fundedCell}", card reads "${funded}"`);
      const bnCard = await page.locator('.ag-venue-card-binance .ag-venue-grid').textContent().catch(() => '');
      const bnFundedCell = await page.locator('.ag-venue-card-binance .ag-venue-grid > span:has-text("funded (Paper)") + span').textContent().catch(() => '');
      if (!/USDT|BNB/.test(bnCard || '') && money(bnFundedCell) === 180) ok(S('agents'), 'the Binance card is funded with its twins\' paper capital ($180) and shows no account balance');
      else fail(S('agents'), `binance funded cell "${bnFundedCell}", card reads "${bnCard}"`);
      // Davies, 2026-09-23: Kraken off VENUES, Binance on, and PAPER must not read as Binance's yellow. The colours
      // are read back from the page, not from the stylesheet: a rule that never applies would pass a source check.
      const venuesText = await page.locator('.ag-venues').textContent().catch(() => '');
      const cardIds = await page.locator('.ag-venue-card').evaluateAll((els) => els.map((el) => [...el.classList].find((c) => /^ag-venue-card-/.test(c))));
      if (!/Kraken/.test(venuesText || '') && cardIds.join(',') === 'ag-venue-card-revx,ag-venue-card-binance,ag-venue-card-polymarket') ok(S('agents'), 'VENUES is Revolut X, Binance, then Polymarket; Kraken is not on it');
      else fail(S('agents'), `VENUES cards ${cardIds.join(',')}, text mentions Kraken: ${/Kraken/.test(venuesText || '')}`);
      const binanceInk = await page.locator('.ag-venue-card-binance .ag-venue-binance').first().evaluate((el) => getComputedStyle(el).color).catch(() => '');
      if (binanceInk === 'rgb(240, 185, 11)') ok(S('agents'), 'Binance wears its yellow');
      else fail(S('agents'), `binance badge ${binanceInk}`);
      // No Mode column (Davies, 2026-09-24): the tab says LIVE or TESTING, so a row carries no mode badge.
      const modeCols = await page.locator('.ag-strategies th.ag-col-mode, .ag-strategies td.ag-col-mode').count();
      const rowBadges = await page.locator('.ag-strategies .ag-row .ag-badge').count();
      if (modeCols === 0 && rowBadges === 0) ok(S('agents'), 'no Mode column and no mode badge on a row');
      else fail(S('agents'), `mode cells ${modeCols}, mode badges on rows ${rowBadges}`);
      // Four rules count down to a bar close; the minute rule decides every
      // minute, which is a rhythm, not a countdown.
      const nexts = await page.locator('.ag-row .ag-next').allTextContents();
      if (nexts.length === rows && nexts.filter((t) => t === '2h 13m').length === rows - 3 && nexts[rows - 3] === 'every minute' && nexts[rows - 2] === 'every minute' && nexts[rows - 1] === 'every 5 minutes') ok(S('agents'), 'every rule counts down to its next bar close; the quote test and RW decide every minute, and RW-E, last, replays every five');
      else fail(S('agents'), `next column: ${nexts.join(' | ')}`);
      const names = await page.locator('.ag-row .ag-name-btn').allTextContents();
      const subs = await page.locator('.ag-row .ag-name-cell .hl-sub').allTextContents();
      const named = ['Trend 4h · Revolut X', 'Trend 1h · Revolut X', 'Momentum 30d · Revolut X', 'Trend 4h · Binance', 'Trend 1h · Binance', 'Momentum 30d · Binance'];
      const gone = /Dislocation|Rotation|Momentum 30d · Kraken|Trend 4h · Kraken/;
      if (named.every((n) => names.some((t) => t.trim() === n)) && !names.some((t) => gone.test(t)) && subs.length === names.length && subs.every((t) => /^\d+ open · /.test(t))) {
        ok(S('agents'), 'every running rulebook is named on its row, once, with its sub-line — and every retired one is off the page');
      } else fail(S('agents'), `names ${names.join(' | ')}; sub-lines ${subs.join(' | ')}`);
      // Deployed, immediately right of Venue, is the scoreboard's DEPLOYED in dollars: the rows add up to it.
      const depSel = vpWidth > 760 ? 'td.ag-col-deployed .ag-deployed' : '.ag-card-strategy .ag-deployed';
      const depHeads = vpWidth > 760 ? (await page.locator('.ag-strategies thead th').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()) : [];
      const depCells = (await page.locator(depSel).allTextContents()).map((t) => t.trim());
      const depSum = Math.round(depCells.reduce((a, t) => a + money(t), 0) * 100);
      const sbDep = await page.locator('.ag-modepanel > .ag-scoreboard .ag-sb-cell-deployed .sb-value').textContent().catch(() => '');
      const sbDepUsd = Math.round(money(String(sbDep).split('(')[0]) * 100);
      const depHeadOk = vpWidth <= 760 || (depHeads[1] === 'Venue' && depHeads[2] === 'Deployed');
      if (vpWidth > 760) {
        const thBases = await page.locator('.ag-strategies .ag-th-base').count();
        const headLine = depHeads.join('|');
        const wantHeads = 'Strategy|Venue|Deployed|Today|Unrealised G/L|Realised G/L|Next';
        if (thBases === 0 && headLine === wantHeads) ok(S('agents'), 'the strategy table heading is the column name alone, with no "% of …" under it');
        else fail(S('agents'), `heading bases ${thBases}, heads ${headLine}`);
      }
      const trendDep = (await page.locator('.ag-row', { has: page.locator('.ag-name-btn:text-is("Trend 4h · Revolut X")') }).locator('.ag-deployed').first().textContent().catch(() => '')).trim();
      if (depHeadOk && depCells.length === rows && depSum === sbDepUsd && trendDep === '$21.50') {
        ok(S('agents'), `Deployed sits beside Venue and adds up to the scoreboard ($${(sbDepUsd / 100).toFixed(2)}); Trend 4h is $21.50`);
      } else fail(S('agents'), `deployed heads ${depHeads.join(' | ')}, cells ${depCells.join(' | ')} (sum ${depSum}) vs scoreboard ${sbDepUsd}, trend "${trendDep}"`);
      const tableScroll = vpWidth > 760 ? await page.locator('.ag-strategies .hl-scroll').evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => 0) : 0;
      if (tableScroll <= 0) ok(S('agents'), vpWidth > 760 ? `the strategy table fits its width on desktop (overflow ${tableScroll}px)` : 'no table to overflow on a phone');
      else fail(S('agents'), `the strategy table overflows by ${tableScroll}px at ${vpWidth}px`);
      // By NAME, not by index: a migration that adds a row must not silently point this at a different strategy.
      await page.locator('.ag-row', { has: page.locator('.ag-name-btn:text-is("Trend 4h · Revolut X")') }).first().click();
      await page.waitForSelector('.ag-detail', { timeout: 5_000 });
      const title = await page.locator('.ag-detail-title').first().textContent().catch(() => '');
      if (/Trend 4h · Revolut X/.test(title || '')) ok(S('agents'), `the row with a book opens its detail (${(title || '').trim()})`);
      else fail(S('agents'), `detail title "${title}"`);
      // A strategy's own scoreboard leads with FUNDED, then DEPLOYED as a percent of it, no "(Paper)": that label lives on
      // the venue card's funded row. Its PAPER badge is neutral and dashed, never Binance's yellow.
      const detailSb = (await page.locator('.ag-detail .ag-scoreboard-sm .ag-sb-name').allTextContents()).map((t) => t.trim());
      const detailVals = (await page.locator('.ag-detail .ag-scoreboard-sm .sb-value').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const paperInk = await page.locator('.ag-detail .ag-detail-head .ag-badge-paper').first().evaluate((el) => { const cs = getComputedStyle(el); return [cs.color, cs.borderTopStyle]; }).catch(() => ['', '']);
      const detailFit = await boardFits('.ag-detail .ag-scoreboard-sm');
      if (detailSb.join(',') === 'FUNDED,DEPLOYED,TODAY,UNREALIZED G/L,REALIZED G/L' && detailVals.slice(0, 2).join(' | ') === '$100 | $21.50(21.50%)'
        && paperInk[0] === 'rgb(232, 228, 218)' && paperInk[1] === 'dashed' && detailFit.overflow <= 1 && detailFit.outside.length === 0 && detailFit.labelH > 0 && detailFit.titlesMatch && detailFit.feesSmaller && detailFit.sameLine) {
        ok(S('agents'), 'the strategy scoreboard reads FUNDED $100, then DEPLOYED $21.50 (21.50% of it), without (Paper); PAPER is neutral and dashed; REALIZED\'s title matches the others and stays inside the frame');
      } else fail(S('agents'), `strategy scoreboard ${detailSb.join(',')} = ${detailVals.join(' | ')}, paper badge ${paperInk.join(' ')}, fit ${JSON.stringify(detailFit)}`);
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
      // The chart fixture already holds every order, so the button must not sit under an empty tail.
      const moreOnHeld = await page.locator('.ag-detail .ag-more').count();
      if (moreOnHeld === 0) ok(S('agents'), 'Load full history is hidden when the orders table has nothing left to add');
      else fail(S('agents'), `Load full history is showing on the held pair (${moreOnHeld})`);
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
      await page.locator('.ag-detail .ag-more').waitFor({ timeout: 5_000 }).catch(() => {});
      const moreOnEth = ((await page.locator('.ag-detail .ag-more').textContent().catch(() => '')) || '').trim();
      const ethOrders = await page.locator('.ag-fills tbody tr').count();
      if (moreOnEth === 'Load full history' && ethOrders === 3) ok(S('agents'), 'Load full history appears when the chart says this pair has older orders');
      else fail(S('agents'), `ETH history button "${moreOnEth}", order rows ${ethOrders}`);
      await page.locator('.ag-detail .ag-more').click();
      await page.waitForTimeout(300);
      const afterMore = await page.locator('.ag-detail .ag-more').count();
      const afterRows = await page.locator('.ag-fills tbody tr').count();
      if (afterMore === 0 && afterRows === 3) ok(S('agents'), 'once the log is loaded the button goes, and a log with nothing new adds no row');
      else fail(S('agents'), `after Load full history: button ${afterMore}, rows ${afterRows}`);
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
      const dHeads = await page.locator('.modal').last().locator('.modal-head-actions button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      const asked = (part) => (/** @type {string[]} */ (page.__requested) || []).filter((u) => u.includes(part)).length;
      const dash0 = asked('action=dashboard');
      const chart0 = asked('action=chart');
      await page.locator('.modal').last().locator('button[aria-label="Refresh"]').click();
      await page.waitForTimeout(400);
      const clicked = dHeads.join(',') === 'Refresh,Close' && asked('action=dashboard') > dash0 && asked('action=chart') > chart0;
      if (clicked) ok(S('agents'), 'the strategy page refreshes from the button beside close: the dashboard and the open chart are asked again');
      else fail(S('agents'), `strategy actions ${dHeads.join(',')}, dashboard ${dash0}→${asked('action=dashboard')}, chart ${chart0}→${asked('action=chart')}`);
      // The minute keeps running on the page that is open, not only on the list underneath.
      const dash1 = asked('action=dashboard');
      await page.clock.fastForward(61_000);
      await page.waitForTimeout(200);
      if (asked('action=dashboard') > dash1) ok(S('agents'), 'a minute on the strategy page refreshes it again');
      else fail(S('agents'), `dashboard requests stayed at ${dash1} after a minute on the strategy page`);
      await page.clock.setFixedTime(CLOCK);
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
      await page.locator('.header-menu-item:text-is("Agents (beta)")').first().click();
      await page.waitForSelector('.ag-scoreboard', { timeout: 10_000 });
      await page.locator('.ag-row', { has: page.locator('.ag-name-btn:text-is("Trend 4h · Revolut X")') }).first().click();
      await page.waitForSelector('.ag-poscard', { timeout: 5_000 });
      const hasDigits = (/** @type {string} */ t) => /\d/.test(t);
      const cardVals = (await page.locator('.ag-poscard .pc-row span:last-child').allTextContents()).map((t) => t.trim());
      const sizeCell = cardVals[0] || '', costCell = cardVals[1] || '';
      const orderSizes = await page.locator('.ag-fills tbody tr td:nth-child(4)').allTextContents();
      if (!hasDigits(sizeCell) && !hasDigits(costCell) && orderSizes.length > 0 && !orderSizes.some(hasDigits)) {
        ok(S('agents'), `hide-values masks the position size as well as the money (size reads "${sizeCell}")`);
      } else fail(S('agents'), `under the mask: size "${sizeCell}", avg cost "${costCell}", order sizes ${orderSizes.join(' | ')}`);
      await page.locator('.ag-detail-close').click().catch(() => {});        // the strategy page closes to the list
      await page.waitForTimeout(200);
      // RW's page under the mask: what is held, every amount and every price, in the markets and the fills.
      await page.locator('.ag-row', { has: page.locator('.ag-name-btn:text-is("Reward quotes")') }).first().click({ timeout: 5_000 }).catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      const rwCells = await page.locator('.ag-rw-markets tbody tr').first().locator('td').evaluateAll((tds) => tds.slice(4).map((td) => (td.textContent || '').trim()));
      const rwFillCells = await page.locator('.ag-rw-fills tbody tr').first().locator('td').evaluateAll((tds) => [tds[3], tds[4]].map((td) => (td?.textContent || '').trim()));
      const rwSb = (await page.locator('.ag-rw-detail .ag-sb-usd').allTextContents()).map((t) => t.trim());
      if (rwCells.length === 4 && !rwCells.some(hasDigits) && !rwFillCells.some(hasDigits) && rwSb.length === 3 && !rwSb.some(hasDigits)) {
        ok(S('agents'), `hide-values masks RW's holdings, amounts and prices (held reads "${rwCells[0]}", a fill's price "${rwFillCells[0]}")`);
      } else fail(S('agents'), `RW under the mask: market cells ${rwCells.join(' | ')}, fill cells ${rwFillCells.join(' | ')}, scoreboard ${rwSb.join(' | ')}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
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
      await page.locator('.header-menu-item:text-is("Agents (beta)")').first().click();
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
      await page.locator('.header-menu-item:text-is("Agents (beta)")').first().click();
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
      await page.locator('.header-menu-item:text-is("Agents (beta)")').first().click();
      await page.waitForSelector('.ag-alert', { timeout: 10_000 }).catch(() => {});
      const stopBanner = await page.locator('.ag-alert.is-stop .ag-alert-label').textContent().catch(() => '');
      const faultBanner = await page.locator('.ag-alert.is-fault .ag-alert-text').textContent().catch(() => '');
      const faultLabel = await page.locator('.ag-alert.is-fault .ag-alert-label').textContent().catch(() => '');
      if (/Global pause/i.test(stopBanner || '') && /451/.test(faultBanner || '') && /^Binance fault$/.test((faultLabel || '').trim())) ok(S('agents'), 'a global pause and a venue fault are banners above the table, each with its label and words');
      else fail(S('agents'), `banners: stop "${stopBanner}", fault "${faultLabel}: ${faultBanner}"`);
      // A banner is on the tabs it concerns: the pause holds both; Binance's fault is TESTING's, where its rows are.
      await page.locator('#ag-modetab-live').click().catch(() => {});
      await page.waitForTimeout(200);
      const pausedLive = await readAgentsPanel(page);
      if (pausedLive.alerts.map((a) => a.label).join('|') === 'Global pause' && /Nothing is live/.test(pausedLive.empty) && pausedLive.tabs[0]?.text === 'Nothing is live') {
        ok(S('agents'), 'on LIVE the global pause is still said and Binance\'s fault is not: Binance has no live row');
      } else fail(S('agents'), `LIVE under the pause: banners ${JSON.stringify(pausedLive.alerts)}, empty "${pausedLive.empty}", tab "${pausedLive.tabs[0]?.text}"`);
      agentsMode = 'ok';
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // ---- LIVE and TESTING, the two tabs at the top (Davies, 2026-09-24) --------------------------------------
      // Three payloads: nothing live (the list above), a live row armed, and the same row awaiting arming. What each
      // tab shows is read back out of the page and held to AGENTS_LIVE's hand-worked figures: LIVE is the live row
      // alone, TESTING the paper rows alone, and the two add up to the one scoreboard the page had before its tabs.
      // A figure on both tabs — the bar itself, the as-of line — reads the same on both.
      const T = (n) => S(`tabs/${n}`);
      const waitFor = async (fn, ms = 5000) => {
        const by = Date.now() + ms;
        while (Date.now() < by) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(50); }
        return false;
      };
      const clickTab = async (id) => {
        await page.locator(`#ag-modetab-${id}`).click();
        await waitFor(async () => (await page.locator(`#ag-modetab-${id}`).getAttribute('aria-selected')) === 'true');
        await page.waitForTimeout(100);
      };
      const opened = (p) => p.tabs.find((t) => t.on)?.id;
      const sbText = (p) => p.scoreboard.map((c) => `${c.name}${c.asides.length ? ` [${c.asides.join('; ')}]` : ''}=${c.value}`).join(' | ');
      const barText = (p) => p.tabs.map((t) => `${t.label} ${t.count} ${t.text} ${t.tone}`).join(' / ');
      // RW-E (Davies, 2026-09-26) adds its fixture's figures to TESTING: $235, 5.60 deployed, +7.50 today, −1.20 unrealised, +23.60 realised.
      const PAPER_SB = 'FUNDED=$2,091 | DEPLOYED=$141.25(6.76%) | TODAY=+$20.54(+0.98%) | UNREALIZED G/L=-$0.56(-0.40%) | REALIZED G/L [(incl. fees $0.08)]=+$78.36(+3.75%)';
      const LIVE_SB = 'FUNDED=$50 | DEPLOYED=$12.50(25%) | TODAY=+$0.20(+0.40%) | UNREALIZED G/L=+$0.50(+4.17%) | REALIZED G/L [(incl. fees $0.03)]=+$0.30(+0.60%)';
      const TESTING_BAR = 'TESTING 9 Paper · 9 strategies paper';
      const topModalHeight = () => page.evaluate(() => { const ms = document.querySelectorAll('.modal'); return Math.round(ms[ms.length - 1]?.getBoundingClientRect().height ?? 0); });

      agentsMode = 'ok';
      await openAgentsPage(page);
      const n0 = await readAgentsPanel(page);
      if (n0.tabsOutsideBody && opened(n0) === 'testing' && barText(n0) === `LIVE 0 Nothing is live none / ${TESTING_BAR}` && sbText(n0) === PAPER_SB) {
        ok(T('none'), `two tabs above the page, outside its scroll (${barText(n0)}); with nothing live it opens on TESTING, the list above`);
      } else fail(T('none'), `bar ${barText(n0)}, open ${opened(n0)}, outside the body ${n0.tabsOutsideBody}, scoreboard ${sbText(n0)}`);
      await clickTab('live');
      const n1 = await readAgentsPanel(page);
      await shot(page, 'agents-tabs-live-empty');
      if (opened(n1) === 'live' && /^Nothing is live/.test(n1.empty) && n1.scoreboard.length === 0 && n1.rows.length === 0 && n1.venues.length === 0 && n1.alerts.length === 0 && barText(n1) === barText(n0)) {
        ok(T('none'), `a click opens LIVE on its empty state ("${n1.empty.slice(0, 40)}…"): no scoreboard, venue, banner or row, and the bar reads as it did`);
      } else fail(T('none'), `LIVE: open ${opened(n1)}, empty "${n1.empty}", scoreboard ${n1.scoreboard.length}, rows ${n1.rows.length}, venues ${n1.venues.length}, banners ${n1.alerts.length}, bar ${barText(n1)}`);
      // One window size for every agents page (Davies, 2026-09-24): an empty LIVE is as tall as a full TESTING.
      const winH = vpWidth > 760 ? Math.round(0.85 * (page.viewportSize()?.height ?? 0)) : (page.viewportSize()?.height ?? 0);
      await clickTab('testing');
      const n2 = await readAgentsPanel(page);
      if (n2.rows.length === 9 && sbText(n2) === sbText(n0) && JSON.stringify(n2.venues) === JSON.stringify(n0.venues)) ok(T('none'), 'a click back: TESTING\'s 9 rows, scoreboard and venue cards as they were');
      else fail(T('none'), `TESTING after the round trip: ${n2.rows.length} rows, ${sbText(n2)}`);
      if (n1.modalHeight === winH && n2.modalHeight === winH) ok(T('size'), `LIVE and TESTING keep one window, ${winH}px tall, empty or full`);
      else fail(T('size'), `window ${n1.modalHeight}px on LIVE, ${n2.modalHeight}px on TESTING, wanted ${winH}px`);
      for (const [name, sel] of [['Trend 4h · Revolut X', '.ag-detail'], ['Stablecoin quotes', '.ag-quotes-detail'], ['Reward quotes', '.ag-rw-detail']]) {
        await page.locator('.ag-modepanel .ag-row', { has: page.locator(`.ag-name-btn:text-is("${name}")`) }).first().click();
        await page.waitForSelector(sel, { timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(350);
        const h = await topModalHeight();
        if (h === winH) ok(T('size'), `${name}'s page opens in the same window, ${h}px`);
        else fail(T('size'), `${name}'s page is ${h}px tall, the list ${winH}px`);
        await page.locator('.ag-detail-close').last().click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      agentsMode = 'live';
      await openAgentsPage(page);
      await waitFor(async () => (await page.locator('#ag-modetab-live .ag-modetab-count').textContent()) === '1');
      await page.waitForTimeout(150);
      const a0 = await readAgentsPanel(page);
      await shot(page, 'agents-tabs-live-armed');
      if (opened(a0) === 'live' && barText(a0) === `LIVE 1 Real money · trading armed / ${TESTING_BAR}`) ok(T('armed'), `a live row opens the page on LIVE (${barText(a0)})`);
      else fail(T('armed'), `bar ${barText(a0)}, open ${opened(a0)}`);
      const lr = a0.rows[0];
      // Its name without " · live" (Davies, 2026-09-24): the tab says it. No mode badge either.
      if (a0.rows.length === 1 && lr.name === 'Trend 4h · Revolut X' && lr.badges === 0 && lr.venue === 'Revolut X' && lr.sub === '1 open · $50 cap'
        && lr.gl.join(' | ') === '+$0.20 (+0.40%) | +$0.50 (+4.17%) | +$0.30 (+0.60%)' && sbText(a0) === LIVE_SB && a0.sections.join('|') === 'LIVE STRATEGIES') {
        ok(T('armed'), `LIVE is the live row alone, named without " · live", and its scoreboard is that row's figures (${sbText(a0)})`);
      } else fail(T('armed'), `LIVE: rows ${JSON.stringify(a0.rows)}, scoreboard ${sbText(a0)}, sections ${a0.sections.join('|')}`);
      const lv = a0.venues[0];
      if (a0.venues.length === 1 && lv.id === 'revx' && lv.meta === '1 strategy · maker/taker 0% / 0.09%' && lv.pairs.funded === '$50' && lv.pairs.deployed === '$12.50 (25%)'
        && lv.pairs.today === '+$0.20 (+0.40%)' && lv.pairs.unrealised === '+$0.50 (+4.17%)' && lv.pairs.realised === '+$0.30 (+0.60%)' && lv.pairs.fees === '$0.03'
        && Object.keys(lv.bases).length === 0 && a0.shareBar === 0) {
        ok(T('armed'), 'one venue card, Revolut X: funded $50 with no (Paper), the row\'s figures, no percent badges, and no share bar for one venue');
      } else fail(T('armed'), `LIVE venues ${JSON.stringify(a0.venues)}, share bars ${a0.shareBar}`);
      const liveFit = await page.locator('.ag-modepanel-live .ag-scoreboard').evaluate((el) => {
        const box = el.getBoundingClientRect();
        const outside = [...el.querySelectorAll('.ag-sb-name, .ag-sb-aside, .ag-sb-usd, .sb-pct')].filter((n) => n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().right > box.right + 1.5).map((n) => (n.textContent || '').trim());
        return { overflow: Math.round(el.scrollWidth - el.clientWidth), outside };
      }).catch(() => ({ overflow: -1, outside: ['missing'] }));
      const liveEdge = await page.locator('.ag-modepanel-live .ag-scoreboard').evaluate((el) => getComputedStyle(el).borderLeftWidth).catch(() => '');
      if (!a0.arming && a0.alerts.length === 0 && liveEdge !== '3px' && liveFit.overflow <= 1 && liveFit.outside.length === 0) {
        ok(T('armed'), 'no live-trading box, no banner, and the scoreboard has no green edge and stays inside its frame');
      } else fail(T('armed'), `armed line "${a0.arming}", banners ${JSON.stringify(a0.alerts)}, border ${liveEdge}, fit ${JSON.stringify(liveFit)}`);
      await clickTab('testing');
      const a1 = await readAgentsPanel(page);
      await shot(page, 'agents-tabs-testing');
      if (a1.rows.length === 9 && !a1.rows.some((r) => / · live$/.test(r.name) || r.badges > 0) && sbText(a1) === PAPER_SB && a1.sections.join('|') === 'TESTING STRATEGIES' && !a1.arming && a1.alerts.length === 0) {
        ok(T('armed'), `TESTING is the paper rows alone (8, none live), and its scoreboard is theirs (${sbText(a1)})`);
      } else fail(T('armed'), `TESTING: ${a1.rows.length} rows (${a1.rows.map((r) => `${r.name} ${r.badges}`).join(', ')}), scoreboard ${sbText(a1)}, armed "${a1.arming}", banners ${a1.alerts.length}`);
      const rv = a1.venues.find((v) => v.id === 'revx'), bn = a1.venues.find((v) => v.id === 'binance');
      if (a1.venues.length === 3 && rv && bn && rv.meta === '4 strategies · maker/taker 0% / 0.09%' && rv.pairs['funded (Paper)'] === '$1,380' && rv.pairs.deployed === '$121.25 (8.79%)'
        && rv.pairs.realised === '+$12.76 (+0.92%)' && rv.apart === '' && bn.pairs['funded (Paper)'] === '$180' && a1.shareBar === 1) {
        ok(T('armed'), 'TESTING\'s Revolut X card includes Stablecoin quotes (funded (Paper) $1,380.00, deployed $121.25, 8.79%), beside Binance\'s and Polymarket\'s');
      } else fail(T('armed'), `TESTING venues ${JSON.stringify(a1.venues)}, share bars ${a1.shareBar}`);
      const cents = (s) => Math.round(money(String(s).split('(')[0]) * 100);
      const both = a0.scoreboard.map((c, i) => cents(c.value) + cents(a1.scoreboard[i]?.value));
      if (both.join(',') === '214100,15375,2074,-6,7866') ok(T('armed'), 'LIVE and TESTING add up to every strategy plus the three tests: $2,141.00 funded, $153.75 deployed, +$20.74 today, -$0.06 unrealised, +$78.66 realised');
      else fail(T('armed'), `LIVE + TESTING in cents: ${both.join(', ')}`);
      if (barText(a1) === barText(a0) && a1.updated === a0.updated && /^as of /.test(a0.updated) && a1.modalHeight === a0.modalHeight) ok(T('armed'), 'the tab bar, the as-of line and the window read the same on both tabs');
      else fail(T('armed'), `bar ${barText(a0)} → ${barText(a1)}; as of "${a0.updated}" → "${a1.updated}"; window ${a0.modalHeight} → ${a1.modalHeight}`);
      await page.locator('#ag-modetab-testing').focus();
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(150);
      const keyed = await readAgentsPanel(page);
      const focused = await page.evaluate(() => document.activeElement?.id || '');
      if (opened(keyed) === 'live' && focused === 'ag-modetab-live' && sbText(keyed) === LIVE_SB) ok(T('armed'), 'ArrowLeft on TESTING selects and focuses LIVE');
      else fail(T('armed'), `after ArrowLeft: open ${opened(keyed)}, focus "${focused}"`);
      await page.locator('.ag-modepanel .ag-row').first().click();
      await page.waitForSelector('.ag-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(350);
      const dTitle = ((await page.locator('.modal .modal-title').last().textContent().catch(() => '')) || '').trim();
      const dMode = ((await page.locator('.ag-detail .ag-detail-head .ag-badge').first().textContent().catch(() => '')) || '').trim();
      const dSb = (await page.locator('.ag-detail .ag-scoreboard-sm .sb-value').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const dCard = ((await page.locator('.ag-detail .ag-poscard .pc-ticker').first().textContent().catch(() => '')) || '').trim();
      const dH = await topModalHeight();
      await shot(page, 'agents-tabs-live-detail');
      if (dTitle === 'Trend 4h · Revolut X' && dMode === 'LIVE' && dSb.join(' | ') === '$50 | $12.50(25%) | +$0.20(+0.40%) | +$0.50(+4.17%) | +$0.30(+0.60%)' && dCard === 'ETH/USD' && dH === a0.modalHeight) {
        ok(T('armed'), 'the live row opens its own page, titled without " · live", in the same window: LIVE, FUNDED $50, the same figures as its row and LIVE\'s scoreboard, its ETH position');
      } else fail(T('armed'), `live detail: title "${dTitle}", mode "${dMode}", scoreboard ${dSb.join(' | ')}, card "${dCard}", window ${dH} of ${a0.modalHeight}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      const back = await readAgentsPanel(page);
      if (opened(back) === 'live' && back.rows.length === 1 && sbText(back) === LIVE_SB) ok(T('armed'), 'closing that page returns to LIVE as it was');
      else fail(T('armed'), `after closing: open ${opened(back)}, rows ${back.rows.length}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      agentsMode = 'live-unarmed';
      await openAgentsPage(page);
      await waitFor(async () => /selling what it holds/.test((await page.locator('#ag-modetab-live .ag-modetab-text').textContent()) || ''));
      await page.waitForTimeout(150);
      const u0 = await readAgentsPanel(page);
      await shot(page, 'agents-tabs-live-unarmed');
      // In plain words, and amber: not a fault (Davies, 2026-09-24). Unarmed stops buys only, and this row holds ETH, which
      // its floor and its rule's exit still sell — so the tab says that, not "not trading yet" (a flat row's words).
      if (opened(u0) === 'live' && barText(u0) === `LIVE 1 Real money · selling what it holds unarmed / ${TESTING_BAR}` && !u0.arming && sbText(u0) === LIVE_SB && u0.alerts.length === 0) {
        ok(T('unarmed'), 'buying off while it holds coins: the LIVE tab says it is still selling them, with no banner and no live-trading box');
      } else fail(T('unarmed'), `bar ${barText(u0)}, armed "${u0.arming}", banners ${JSON.stringify(u0.alerts)}, scoreboard ${sbText(u0)}`);
      await clickTab('testing');
      const u1 = await readAgentsPanel(page);
      if (u1.alerts.length === 0 && sbText(u1) === PAPER_SB && u1.rows.length === 9) ok(T('unarmed'), 'TESTING carries no banner either');
      else fail(T('unarmed'), `TESTING banners ${JSON.stringify(u1.alerts)}, scoreboard ${sbText(u1)}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // ---- RW's parts add up to the total printed beside them (the ops read, 2026-09-24) ----------------------
      // AGENTS_RW_CENTS: figures whose parts, each rounded alone, missed their total by a cent.
      // PR5's live executor trading real money, and nothing else live (Davies, 2026-09-26): a LIVE row of its own, in
      // LIVE's totals and its Revolut X card; the page opens on LIVE; its paper test stays on TESTING.
      agentsMode = 'pr5-live';
      await openAgentsPage(page);
      await waitFor(async () => (await page.locator('#ag-modetab-live .ag-modetab-count').textContent()) === '1');
      await page.waitForTimeout(150);
      const p0 = await readAgentsPanel(page);
      const pNames = (await page.locator('.ag-strategies-live .ag-row .ag-name-btn').allTextContents()).map((t) => t.trim());
      const sb0 = sbText(p0);
      if (opened(p0) === 'live' && barText(p0) === `LIVE 1 Real money · trading armed / ${TESTING_BAR}` && pNames.join(',') === 'Stablecoin quotes'
        && /^FUNDED=\$67\.50 \| DEPLOYED=\$50\.40\(74\.67%\) \| TODAY=\+\$0\.54\(\+0\.80%\) \| UNREALIZED G\/L=\+\$0\.40\(\+0\.80%\)/.test(sb0) && /REALIZED G\/L[^=]*=\+\$0\.27\(\+0\.40%\)$/.test(sb0)) {
        ok(T('pr5-live'), `PR5 trading real money is LIVE's row, and LIVE opens on it: ${sb0}`);
      } else fail(T('pr5-live'), `open ${opened(p0)}, bar ${barText(p0)}, rows ${pNames.join(',')}, scoreboard ${sb0}`);
      await clickTab('testing');
      const p1 = await readAgentsPanel(page);
      if (p1.rows.length === 9 && sbText(p1) === PAPER_SB) ok(T('pr5-live'), "its paper test stays on TESTING, whose totals do not take the live book");
      else fail(T('pr5-live'), `TESTING rows ${p1.rows.length}, scoreboard ${sbText(p1)}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      agentsMode = 'rw-cents';
      await openAgentsPage(page);
      const rwRowC = page.locator('.ag-modepanel .ag-row', { has: page.locator('.ag-name-btn:text-is("Reward quotes")') });
      await waitFor(async () => /55\.7/.test((await rwRowC.first().innerText()) || ''));
      await page.waitForTimeout(150);
      const rowGl = (await rwRowC.first().locator('.ag-gl').allTextContents()).map((t) => t.trim().split(' (')[0]);
      await rwRowC.first().click();
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const rc = await page.evaluate(() => {
        const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
        const d = document.querySelector('.ag-rw-detail');
        const cell = (/** @type {string} */ name) => [...(d?.querySelectorAll('.ag-scoreboard-sm .ag-sb-cell') ?? [])].find((x) => txt(x.querySelector('.ag-sb-name')) === name);
        const lines = (/** @type {Element | null | undefined} */ el, /** @type {string} */ sel) => [...(el?.querySelectorAll(sel) ?? [])].map((s) => txt(s.lastElementChild || s));
        const r = cell('REALIZED G/L'), u = cell('UNREALIZED G/L');
        const tds = [...(d?.querySelector('.ag-rw-markets tbody tr')?.querySelectorAll('td') ?? [])].map(txt);
        return {
          realised: txt(r?.querySelector('.ag-sb-usd')), unrealised: txt(u?.querySelector('.ag-sb-usd')),
          realisedSplit: lines(r, '.ag-sb-split-v'), unrealisedSplit: lines(u, '.ag-sb-split-v'),
          market: tds.slice(5, 8),
        };
      });
      const c2 = (s) => Math.round(money(s) * 100);
      const sumC = (xs) => xs.reduce((a, s) => a + c2(s), 0);
      const addsUp = sumC(rc.realisedSplit) === c2(rc.realised) && rc.unrealisedSplit.length === 0 && sumC(rc.market.slice(0, 2)) === c2(rc.market[2]);
      if (addsUp && rc.realised === '+$55.76' && rc.unrealised === '-$21.53'
        && rc.realisedSplit.join(' | ') === '+$48.72 | +$7.04' && rc.market.join(' | ') === '+$18.41 | +$0.20 | +$18.61' && rowGl[1] === rc.unrealised && rowGl[2] === rc.realised) {
        ok(T('rw-cents'), `realised ${rc.realised} = ${rc.realisedSplit.join(' ')}; a market ${rc.market[0]} ${rc.market[1]} = ${rc.market[2]}; the row reads the page's`);
      } else fail(T('rw-cents'), `RW parts: ${JSON.stringify(rc)}, row ${rowGl.join(' | ')}`);
      agentsMode = 'ok';
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else fail(S('agents'), 'Agents menu item not found');

    // A phone subpage is ordinary flow, as tall as the screen, not a fixed
    // or absolute layer. iOS 26 clips both of those above the toolbar, and
    // a layer taller than the screen slid the title off the top (Davies,
    // 2026-09-25 and 2026-09-26, iPhone 16 Pro). The body must not be
    // position:fixed either. The board is out of the document, and the
    // header does not shrink — a shrinking header clipped the title down
    // to the bottoms of the letters. Headless Chrome has no toolbar, so a
    // second pin stretches the backdrop past the viewport and requires the
    // modal to meet it.
    if (vp.name === 'phone') {
      const phoneFills = async (title) => {
        const anchored = await page.evaluate(() => {
          const bds = [...document.querySelectorAll('.modal-backdrop')];
          const bd = bds[bds.length - 1];
          const modal = bd?.querySelector('.modal');
          const titleEl = modal?.querySelector('.modal-title');
          const head = modal?.querySelector('.modal-head');
          if (!bd || !modal || !titleEl || !head) return null;
          const br = bd.getBoundingClientRect();
          const tr = titleEl.getBoundingClientRect();
          const cs = getComputedStyle(bd);
          const vh = window.innerHeight;
          return {
            position: cs.position,
            top: bd.classList.contains('is-top'),
            bodyPos: getComputedStyle(document.body).position,
            root: getComputedStyle(document.getElementById('root')).display,
            headShrink: getComputedStyle(head).flexShrink,
            covers: br.top <= 1 && br.bottom >= vh - 1 && br.height >= vh - 1,
            titleIn: tr.height >= 16 && tr.top >= 0 && tr.top < 140 && tr.bottom <= br.bottom + 1,
          };
        });
        const pageFlow = anchored?.position === 'relative' && anchored.top && anchored.bodyPos !== 'fixed'
          && anchored.root === 'none' && anchored.headShrink === '0' && anchored.covers && anchored.titleIn;
        if (pageFlow) ok(S('modal'), `${title} fills the screen in page flow and its title stays on it`);
        else fail(S('modal'), `${title} anchor ${JSON.stringify(anchored)}`);
        const tag = await page.addStyleTag({ content: '.modal-backdrop{height:940px!important;min-height:940px!important;bottom:auto!important;}' });
        await page.waitForTimeout(80);
        const geom = await page.evaluate(() => {
          const bds = [...document.querySelectorAll('.modal-backdrop')];
          const bd = bds[bds.length - 1];
          const modal = bd?.querySelector('.modal');
          const body = modal?.querySelector('.modal-body');
          if (!bd || !modal) return null;
          const b = bd.getBoundingClientRect();
          const m = modal.getBoundingClientRect();
          return {
            title: (modal.querySelector('.modal-title')?.textContent || '').replace(/\s+/g, ' ').trim(),
            bTop: Math.round(b.top), bBot: Math.round(b.bottom), bH: Math.round(b.height),
            mTop: Math.round(m.top), mBot: Math.round(m.bottom), mH: Math.round(m.height),
            minH: body ? getComputedStyle(body).minHeight : '',
          };
        });
        await tag.evaluate((el) => el.remove());
        const filled = !!geom && geom.bH >= 939 && Math.abs(geom.mTop - geom.bTop) <= 1 && Math.abs(geom.mBot - geom.bBot) <= 1 && geom.minH === '0px';
        if (filled) ok(S('modal'), `${title} fills a backdrop taller than the screen (${geom.mH}px)`);
        else fail(S('modal'), `${title} ${JSON.stringify(geom)}`);
      };
      const openMenuItem = async (item, title) => {
        await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
        await page.waitForTimeout(200);
        await page.locator(`.header-menu-item:text-is("${item}")`).first().click();
        await page.locator(`.modal .modal-title:text-is("${title}")`).first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(350);
      };
      await openMenuItem('Holding list', 'Holding list');
      await phoneFills('Holding list');
      const tickerBtn = page.locator('.modal .hl-ticker-btn').first();
      if (await tickerBtn.count()) {
        const ticker = ((await tickerBtn.locator('.hl-ticker').textContent()) || '').trim();
        await tickerBtn.click();
        await page.locator('.modal .modal-title').last().waitFor({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(350);
        await phoneFills(ticker || 'ticker');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else fail(S('modal'), 'Holding list has no ticker to open');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      for (const item of ['Sectors list', 'Transaction history', 'Agents (beta)']) {
        await openMenuItem(item, item);
        await phoneFills(item);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    await ctx.close();
  }

  // ---- the read-only viewer, at both breakpoints ---------------------
  // Its password is shared publicly (Davies, 2026-09-23). A viewer gets the
  // board and the vs-S&P chart, but not the transaction history (every buy
  // and sell with its date and price) nor the Investment view (the book in
  // dollars against the money paid in). The phone matters on its own: the
  // panel there is the sidebar's copy, a separate mount of the same code.
  for (const vp of [{ name: 'desktop', width: 1400, height: 1000 },
                    { name: 'phone', width: 390, height: 844 }]) {
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses, { token: RO_TOKEN });
    const S = (n) => `${vp.name}/viewer/${n}`;
    await page.waitForSelector('.scoreboard-cell-portfolio .sb-value-lg', { timeout: 20_000 }).catch(() => {});
    await page.waitForSelector('.perf-lbl', { state: 'visible', timeout: 10_000 }).catch(() => {});
    const badge = await page.locator('.ro-badge:visible').count();
    const invTabs = await page.locator('#perf-tab-inv').count();
    const title = ((await page.locator('.panel:has(.perf-range-btn) .panel-title:visible').first().textContent().catch(() => '')) || '').trim();
    const legend = await page.locator('.perf-lbl:visible').allTextContents();
    if (badge === 1 && invTabs === 0 && /^PERFORMANCE VS S&P/.test(title) && legend.length > 0 && !legend.some((l) => /VALUE|DEPOSITED/.test(l))) {
      ok(S('perf'), `VIEWER badge; the panel is "${title}" alone, legend ${JSON.stringify(legend.slice(0, 2))}, no Investment tab`);
    } else fail(S('perf'), `badge ${badge}, Investment tabs ${invTabs}, title "${title}", legend ${JSON.stringify(legend)}`);
    await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
    await page.waitForTimeout(200);
    const items = (await page.locator('.header-menu-item').allTextContents()).map((t) => t.trim());
    if (JSON.stringify(items) === JSON.stringify(['Holding list', 'Sectors list', 'Agents (beta)'])) ok(S('menu'), `menu ${JSON.stringify(items)}: no Transaction history`);
    else fail(S('menu'), `menu ${JSON.stringify(items)}`);
    await page.keyboard.press('Escape');
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
