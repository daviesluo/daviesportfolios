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
//
// `bin/gates.sh` runs it in shards at once instead: each process takes one
// viewport (`SWEEP_VIEWPORT`) and some of the sweep's parts (`SWEEP_PART`,
// named in PARTS below), on a port the system has free (`SWEEP_PORT=0`).
// CI runs it the same way, a runner a shard (check.yml's sweep job).
// Unset, one process runs every part at both widths.

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
/**
 * `SWEEP_VIEWPORT=desktop` or `=phone` runs that breakpoint's checks alone, and `SWEEP_PORT` serves the bundle on a port
 * of its own, so `bin/gates.sh` runs the two at once (Davies, 2026-09-27: the gates were still slow), and CI on
 * runners of their own. Unset, both run, one after the other. A check at one fixed width runs with that breakpoint.
 */
const ONLY = process.env.SWEEP_VIEWPORT || '';
if (ONLY && ONLY !== 'desktop' && ONLY !== 'phone') throw new Error(`SWEEP_VIEWPORT is desktop or phone, not ${ONLY}`);
const runs = (/** @type {string} */ name) => !ONLY || ONLY === name;
const VIEWPORTS = [{ name: 'desktop', width: 1400, height: 1000 }, { name: 'phone', width: 390, height: 844 }].filter((vp) => runs(vp.name));
/**
 * `SWEEP_PART` runs some of the sweep's parts and not the others, so `bin/gates.sh` can run it as several processes at
 * once (Davies, 2026-10-01: "还有没有可以一起并行跑的内容"): a run is nine tenths waiting on its pages, not working the
 * CPU, so processes side by side finish in the time of the longest. The parts are the sections that open pages of their
 * own, named below in the order they run; `main` is sections 1–8, which share one page per viewport. A comma-separated
 * list runs the parts named; `-name` leaves one out, so a list of `-` names alone runs every part but those (the shard
 * that takes what the others do not, a part added later included). Unset, every part runs; CI splits it as gates.sh
 * does. A part leaves the module's switches (`agentsMode`, `SP_BUMP`, `holdMs`, …) at rest when it ends, so it checks the
 * same thing whatever ran before it.
 */
const PARTS = ['frame', 'recovery', 'perf-refresh', 'save-retry', 'perf-live-edge', 'reload', 'banner-reload', 'agents-reload', 'surfaces', 'quote-band', 'main', 'viewer'];
const PICKED = (process.env.SWEEP_PART || '').split(',').map((s) => s.trim()).filter(Boolean);
for (const p of PICKED) if (!PARTS.includes(p.replace(/^-/, ''))) throw new Error(`SWEEP_PART names ${p}; the parts are ${PARTS.join(', ')}`);
const part = (/** @type {string} */ name) => !PICKED.includes(`-${name}`) && (PICKED.every((p) => p.startsWith('-')) || PICKED.includes(name));
/** The viewports a part's section runs at: every one this run has, or none when the part is not picked. */
const viewports = (/** @type {string} */ name) => (part(name) ? VIEWPORTS : []);
/**
 * The port the bundle is served on. `SWEEP_PORT=0` takes one the system has free, read back once the server listens, so
 * runs side by side never ask for the same one: gates.sh's shards do, and a fixed pair collided whenever two gate runs,
 * or a gate run and a sweep by hand, shared a machine.
 */
let PORT = process.env.SWEEP_PORT === '0' ? 0 : Number(process.env.SWEEP_PORT) || 8932;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

/**
 * A new deploy, as the service worker sees one: while set, `/sw.js` is served with this comment appended, so its bytes
 * differ from the worker a page installed and the page's update check finds a new one waiting (section 0c').
 */
let SW_DEPLOY = '';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  if (SW_DEPLOY && url.pathname === '/sw.js') {
    res.end(`${fs.readFileSync(file, 'utf8')}\n// ${SW_DEPLOY}\n`);
    return;
  }
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

/** The benchmark's last intraday bar, times this: the refresh checks move it after the page has settled (0b'). */
let SP_BUMP = 1;
/**
 * Section 0b'': while set, ES=F's intraday bars are a futures session still trading, its newest print ten minutes
 * before the clock (Yahoo's CME prices are ten minutes late), at 5,200 times this, from 5,000 three hours back.
 */
let ES_LIVE = 0;
const barsFor = (t, daily, includePrePost = false, sessions = 1) => {
  if (!daily && t === 'ES=F' && ES_LIVE > 0) {
    const at = (ms) => new Date(ms).toISOString().slice(0, 16);
    return [
      { date: at(NOW_MS - 180 * 60e3), close: 5000 },
      { date: at(NOW_MS - 60 * 60e3), close: 5100 },
      { date: at(NOW_MS - 10 * 60e3), close: 5200 * ES_LIVE },
    ];
  }
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
    bars.push({ date: at(19, 55), close: t === '^GSPC' ? last * SP_BUMP : last });
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
  tExit: new Date(NOW_MS - minsAgo * 60e3).toISOString(), entry, exit, how, notionalUsd: 99.8, qty: Number((99.8 / 1.35 / entry).toFixed(4)), pnlUsd });
const QUOTE_TRIPS = [
  quoteTrip(20, 'USDT-GBP', 'ask', 0.002, 0.7564, 0.7550, 'maker', 0.10), quoteTrip(50, 'USDC-GBP', 'bid', 0.001, 0.7542, 0.7549, 'maker', 0.07),
  quoteTrip(90, 'USDT-GBP', 'bid', 0.003, 0.7525, 0.7521, 'taker', -0.05), quoteTrip(1500, 'USDC-GBP', 'ask', 0.002, 0.7566, 0.7558, 'maker', 0.08),
  quoteTrip(1560, 'USDT-GBP', 'bid', 0.001, 0.7540, 0.7549, 'maker', 0.07), quoteTrip(1620, 'USDC-GBP', 'bid', 0.003, 0.7527, 0.7535, 'maker', 0.06),
  quoteTrip(1700, 'USDC-GBP', 'ask', 0.001, 0.7559, 0.7550, 'maker', 0.09),
];

/**
 * The pounds the dashboard sends beside a quote summary's dollars (`quotesSummary`, Davies 2026-10-01: the stablecoin
 * quotes' pages and rows are in pounds), at its books' rate. These fixtures were written in dollars, so each figure in
 * pounds is its dollars over 1.32: every sum that held in dollars holds in pounds. Deployed is `quotesDeployed`'s: each
 * quoting rung its share of the capital (capital ÷ rungs) and what the held rungs hold.
 * @param {any} q
 */
const inPounds = (q) => {
  const x = q.books.find((b) => b.lastX > 0)?.lastX ?? null;
  const g = (usd) => (usd == null || x == null ? null : usd / x);
  const rungs = q.books.reduce((a, b) => a + b.rungs.length, 0), quoting = q.books.reduce((a, b) => a + b.quoting, 0);
  const deployedUsd = q.books.reduce((a, b) => a + b.openUsd, 0) + (rungs > 0 ? (quoting * q.capitalUsd) / rungs : 0);
  return {
    ...q, x, capitalGbp: g(q.capitalUsd), realisedGbp: g(q.realisedUsd), todayGbp: g(q.todayUsd), openGbp: g(q.openUsd) ?? 0, unrealisedGbp: g(q.unrealisedUsd),
    deployedUsd, deployedGbp: g(deployedUsd),
    books: q.books.map((b) => ({
      ...b, rungCount: b.rungs.length, realisedGbp: g(b.realisedUsd), openGbp: g(b.openUsd) ?? 0, unrealisedGbp: g(b.unrealisedUsd),
      rungs: b.rungs.map((r) => ({ ...r, valueGbp: g(r.valueUsd), unrealisedGbp: g(r.unrealisedUsd) })),
    })),
    recent: q.recent.map((t) => ({ ...t, pnlGbp: g(t.pnlUsd) })),
    days: q.days.map((d) => ({ ...d, realisedGbp: g(d.realisedUsd) })),
  };
};

/**
 * "Stablecoin quotes - variant" (Davies, 2026-09-28): PR5's rule with nine rungs a side on four keys, replayed from the
 * quote test's own minutes, in the quote test's summary shape. Consistent with itself: $100 a rung over 36 rungs is its
 * $3,600; one bid held on USDC/GBP's 0.075 % rung (+$0.05 marked); two round trips, +$0.05 today on the 0.075 % bid and
 * +$0.04 yesterday on USDT/GBP's 0.03 % ask, which add up to realised +$0.09 and are the two days.
 */
const QUOTESV_KS = [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003];
const quotesvRungs = (fair, held = {}) => ['bid', 'ask'].flatMap((side) => QUOTESV_KS.map((k) => {
  const px = side === 'bid' ? Math.floor(fair * (1 - k) * 1e4) / 1e4 : Math.ceil(fair * (1 + k) * 1e4) / 1e4;
  const h = held[`${side}:${k}`];
  return h ? quoteRung(side, k, 'position', px, h) : quoteRung(side, k, 'quote', px);
}));
const QUOTESV_TRIPS = [
  quoteTrip(20, 'USDC-GBP', 'bid', 0.00075, 0.7545, 0.7551, 'maker', 0.05), quoteTrip(1500, 'USDT-GBP', 'ask', 0.0003, 0.7551, 0.7547, 'maker', 0.04),
];
const AGENTS_QUOTESD = (at) => inPounds({
  startedAt: new Date(NOW_MS - 20 * 3600e3).toISOString(), lastMinute: at, lagMinutes: 1, running: true, lastError: null, capitalUsd: 3600,
  realisedUsd: 0.12, realisedPct: 0.0033, todayUsd: 0.07, todayPct: 0.0019, trips: 1, won: 1, open: 0, openUsd: 0, unrealisedUsd: 0,
  ordersToday: 80, fillsToday: 1, arm: 'd', checkMaxUsd: 0.02, checkDays: 1,
  postsToday: { 'USDC-GBP/bid': 10, 'USDC-GBP/ask': 10, 'USDT-GBP/bid': 10, 'USDT-GBP/ask': 10 },
  governor: { entryAt: 900, stopAt: 950 },
  books: [
    { book: 'USDC-GBP', lastX: 1.32, lastPrice: 0.7550, lastPrintAt: new Date(NOW_MS - 60e3).toISOString(), fair: 0.75505, quoting: 18, held: 0, openUsd: 0, unrealisedUsd: 0, trips: 1, won: 1, realisedUsd: 0.12, rungs: quotesvRungs(0.75505) },
    { book: 'USDT-GBP', lastX: 1.32, lastPrice: 0.7548, lastPrintAt: new Date(NOW_MS - 90e3).toISOString(), fair: 0.75482, quoting: 18, held: 0, openUsd: 0, unrealisedUsd: 0, trips: 0, won: 0, realisedUsd: 0, rungs: quotesvRungs(0.75482) },
  ],
  recent: [quoteTrip(40, 'USDC-GBP', 'ask', 0.0003, 0.7552, 0.7546, 'maker', 0.12)],
  days: [{ day: '2026-09-17', orders: 80, fills: 1, trips: 1, won: 1, realisedUsd: 0.12, today: true }],
});
const AGENTS_QUOTESV = (at) => inPounds({
  startedAt: new Date(NOW_MS - 20 * 3600e3).toISOString(), lastMinute: at, lagMinutes: 1, running: true, lastError: null, capitalUsd: 3600,
  realisedUsd: 0.09, realisedPct: 0.0025, todayUsd: 0.05, todayPct: 0.0014, trips: 2, won: 2, open: 1, openUsd: 99.9, unrealisedUsd: 0.05,
  ordersToday: 350, fillsToday: 3,
  books: [
    { book: 'USDC-GBP', lastX: 1.32, lastPrice: 0.7550, lastPrintAt: new Date(NOW_MS - 60e3).toISOString(), fair: 0.75505, quoting: 17, held: 1, openUsd: 99.9, unrealisedUsd: 0.05, trips: 1, won: 1, realisedUsd: 0.05,
      rungs: quotesvRungs(0.75505, { 'bid:0.00075': { entry: 0.7545, heldSince: new Date(NOW_MS - 10 * 60e3).toISOString(), valueUsd: 99.9, unrealisedUsd: 0.05 } }) },
    { book: 'USDT-GBP', lastX: 1.32, lastPrice: 0.7548, lastPrintAt: new Date(NOW_MS - 90e3).toISOString(), fair: 0.75482, quoting: 18, held: 0, openUsd: 0, unrealisedUsd: 0, trips: 1, won: 1, realisedUsd: 0.04,
      rungs: quotesvRungs(0.75482) },
  ],
  recent: QUOTESV_TRIPS,
  days: [
    { day: '2026-09-17', orders: 350, fills: 3, trips: 1, won: 1, realisedUsd: 0.05, today: true },
    { day: '2026-09-16', orders: 612, fills: 4, trips: 1, won: 1, realisedUsd: 0.04, today: false },
  ],
});

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
    capitalUsd: 296, fundedUsd: 1000, totalUsd: 41, stressUsd: 17.2, rewardUsd: 41.6, fillsPnlUsd: -0.6, realisedUsd: 42, unrealisedUsd: -1, mismatchUsd: 0,
    // What its quotes resting now tie up (`quotedUsd`, RW's own capital for a quote): A, B and C each quote N 20 at a
    // 2¢ spread, a bid at b and an ask's No at 1 − a, 20 × 0.98 = 19.60 a market, 58.80; D is held, not quoted.
    todayUsd: 12.5, heldUsd: 14.4, quotedUsd: 58.8, open: 2, fills: 5, quoting: 3, bestMarketUsd: 18.6,
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
    capitalUsd: 235, fundedUsd: 1000, totalUsd: 22.4, stressUsd: 12.1, rewardUsd: 23.2, fillsPnlUsd: -0.8, realisedUsd: 23.6, unrealisedUsd: -1.2, mismatchUsd: 0,
    // RW-E does not quote A today: B's and C's quotes tie up 19.60 each, 39.20.
    todayUsd: 7.5, heldUsd: 5.6, quotedUsd: 39.2, open: 1, fills: 3, quoting: 2, bestMarketUsd: 14.1,
    markets: rw.markets.filter((m) => m.cond !== '0xa1'),
    days: [
      { day: iso(dayStartMs - D).slice(0, 10), phase: 'run', totalUsd: 7.1, stressUsd: 4.4, rewardUsd: 7.4, fills: 1, capitalUsd: 231.2, markets: 13, runningUsd: 14.9 },
      { day: iso(dayStartMs - 2 * D).slice(0, 10), phase: 'run', totalUsd: 7.8, stressUsd: 3.1, rewardUsd: 8.2, fills: 0, capitalUsd: 226.5, markets: 14, runningUsd: 7.8 },
    ],
    recent: rw.recent.filter((f) => f.cond !== '0xa1'),
  };
};

/**
 * RW-E's variants as rows of their own (Davies, 2026-09-27): `rwx`, one entry per variant on the page in `rwe`'s shape,
 * as `rwxArmSummaries` builds them. A variant is RW-E until its own rule first leaves something out, so each carries
 * RW-E's figures to the cent (AGENTS_RWE) under its own id and name, with both of the replay's checks holding. Since
 * 2026-10-02 they are x1 ("variant-2") and x4 and x5 ("variant-3" and "variant-4", x1 with its quotes moved); x2 and x3
 * are not among them: the replay still runs both, the dashboard does not send them.
 */
const AGENTS_RWX = (dayStartMs) => [
  ['x1', 'Reward quotes variant-2'], ['x4', 'Reward quotes variant-3'], ['x5', 'Reward quotes variant-4'],
].map(([id, name]) => ({ ...AGENTS_RWE(dayStartMs), id, name, startedAt: new Date(NOW_MS - (20 * 60 + 30) * 60e3).toISOString(), checks: { rwMaxUsd: 0, eMaxUsd: 0, eDays: 2, ok: true } }));

/**
 * RW-C (`0069`), RW's engine run again on 2026-10-09 → 10-23 UTC, as `rwcSummary` returns it in its warm-up before its
 * engine has a state: its fourteen days' dates, its $1,000, nothing of its own, and when it starts. Before the warm-up
 * (2026-10-08 00:00 UTC; the pinned clock is before it) the dashboard sends no `rwc` at all (Davies, 2026-09-28), so this
 * is served only in the `rwc-warmup` mode.
 */
const AGENTS_RWC_WAITING = () => ({
  phase: 'warm-up', runStart: '2026-10-09T00:00:00.000Z', runEnd: '2026-10-23T00:00:00.000Z', dayOfRun: null,
  lastMinute: null, lagMinutes: null, lastError: null, running: true, finished: false, fundedUsd: 1000,
  catchingUp: false, notStarted: true, startsAt: '2026-10-09T00:00:00.000Z', startedAt: null,
  capitalUsd: 0, totalUsd: 0, stressUsd: 0, rewardUsd: 0, fillsPnlUsd: 0, realisedUsd: 0, unrealisedUsd: 0, mismatchUsd: 0,
  todayUsd: 0, heldUsd: 0, open: 0, fills: 0, quoting: 0, bestMarketUsd: null, markets: [], days: [], recent: [],
});
/**
 * RW-C running, in the pinned clock's world: RW's summary of its own engine run, which starts flat at its first minute,
 * so its days are its fourteen days' only. Its figures are RW-E's fixture's (AGENTS_RWE, consistent with itself: three
 * markets, three fills, two closed days, no warm-up), its last minute two minutes old.
 */
const AGENTS_RWC_RUNNING = (dayStartMs) => {
  const e = AGENTS_RWE(dayStartMs);
  return { ...e, startedAt: e.runStart, lastMinute: new Date(NOW_MS - 2 * 60e3).toISOString(), lagMinutes: 2, running: true };
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
/**
 * The realistic twins (`quotes_twin.ts`, 0087; Davies, 2026-10-02): the dashboard's own answer (`readQuotesTwin`) for the
 * live fixture's book run as each twin's tables (`quotes_twin_fixture.json`, which the agents function's test proves is
 * that function's answer): "Stablecoin quotes" at its £1,200, every figure the live fixture's (below, at
 * QUOTES_LIVE_FIXTURE); "Stablecoin quotes variant-1" at its £1,800 ($2,376 at 1.32), the same fills on three of its
 * nine rungs a side, so the same money and its own capital. Their starts are moved before this sweep's clock: tested
 * 1d 7h and 20h.
 */
const QUOTES_TWIN_FIXTURE = JSON.parse(fs.readFileSync(new URL('./quotes_twin_fixture.json', import.meta.url), 'utf8'));
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
    // No venue in the name since 0061 (Davies, 2026-09-26): the table's venue column and the page's tag say it.
    name: KIND_NAME[kind],
    description: 'Fixture strategy.', symbols, mode: 'paper', capitalUsd,
    // Created 3 d 5 h 20 min before the clock: its page says "tested 3d 5h".
    params: { fast: 20, slow: 100 }, createdAt: new Date(NOW_MS - ((3 * 24 + 5) * 60 + 20) * 60e3).toISOString(), updatedAt: at,
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
  // same rules, coins and capital, filled at Binance's touch. Flat here, as they started in production. `0065` deleted
  // them (2026-09-27); the fixture keeps them so a venue with rows of its own beside Revolut X, and Binance's card, stay
  // tested for the day a strategy of Binance's own returns. The paper rows' sizes are the ones before `0066`: the page
  // reads any capital the same way.
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
    quotes: inPounds({ startedAt: '2026-09-16T15:09:00.000Z', lastMinute: at, lagMinutes: 1, running: true, lastError: null, capitalUsd: 1200,
      realisedUsd: 0.42, realisedPct: 0.035, todayUsd: 0.12, todayPct: 0.01, trips: 7, won: 6, open: 1, openUsd: 99.75, unrealisedUsd: 0.14,
      ordersToday: 205, fillsToday: 8, books: QUOTE_BOOKS, recent: QUOTE_TRIPS,
      // Its days (`0070`, as quoteDays shapes them), newest first, from the same round trips: today's three make +$0.12
      // (TODAY), the four of 16 Sep +$0.30, and the two add up to REALIZED's +$0.42.
      days: [
        { day: '2026-09-17', orders: 205, fills: 8, trips: 3, won: 2, realisedUsd: 0.12, today: true },
        { day: '2026-09-16', orders: 120, fills: 5, trips: 4, won: 4, realisedUsd: 0.30, today: false },
      ],
      // Its live executor (`0052`) in dry-run, as quotesLiveSummary shapes it: no money, what it would have sent today.
      live: { dryRun: true, armed: false, armedAt: null, entryBook: 'dry_run', why: '', running: true, lagMinutes: 0, lastError: null,
        postsToday: { dryRun: 12, live: 0 }, lossStopped: false, capitalGbp: 50, x: 1.35, capitalUsd: 67.5, tradedLive: false,
        openOrders: 0, heldRungs: 0, unmarked: 0, pending: [], fills: 0, realisedUsd: 0, todayUsd: 0, unrealisedUsd: 0, costUsd: 0, valueUsd: 0, feesUsd: 0 } }),
    // The twins: the stablecoin rows of TESTING since 2026-10-02, in place of the paper test above, its variants and rule D.
    quotesTwins: QUOTES_TWIN_FIXTURE.twins,
    rw: AGENTS_RW(dayStartMs),
    rwe: AGENTS_RWE(dayStartMs),
    rwx: AGENTS_RWX(dayStartMs),
    // RW-C before its warm-up (0069; Davies, 2026-09-28): not on the page.
    rwc: null,
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
 * `rw-cents` (RW's figures where each part rounds on its own), `rwc-warmup` (RW-C in its warm-up, saying when it
 * starts), `rwc-running` (RW-C inside its fourteen days) and `quotesv` (the quote test's variant beside it).
 */
let agentsMode = /** @type {'ok' | 'notReady' | 'error' | 'paused' | 'live' | 'live-unarmed' | 'rw-cents' | 'pr5-live' | 'pr5-live-noexit' | 'rwx-waiting' | 'rwc-warmup' | 'rwc-running' | 'quotesv' | 'prep' | 'mid'} */ ('ok');
/**
 * The reload section's levers: the book the `data` function hands back (a
 * server row's prices are those of its last SAVE, not what the page showed),
 * how long every Edge Function answer is held back, and what was answered
 * while held.
 */
let loadOverride = /** @type {any} */ (null);
// The save-retry section (0c): how many saves to refuse next, and what the page asked for. `loadFails` answers every load
// with a 503, as a failed load does, so the cross-tab reload is seen taking what a failed load returns.
let saveFailures = 0, saveCalls = 0, loadCalls = 0, loadFails = false;
let holdMs = 0;
/**
 * The band's part (0f): tickers the price function leaves out of its answer, quotes it answers in place of `QUOTES`, what
 * the public proxies answer (a Yahoo chart body per symbol; a fund's JSONP for any fund while `PROXY_FUND` is set), and
 * whether the ops-error summary the errors badge polls is served from what the page reported.
 */
let EDGE_OMIT = new Set(), EDGE_QUOTES = /** @type {Record<string, any>} */ ({}), PROXY_CHART = /** @type {Record<string, { price: number, prev: number, currency: string }>} */ ({});
let PROXY_FUND = /** @type {Record<string, string> | null} */ (null), OPS_SUMMARY = false;
/** The five public proxies (src/prices/proxy_chain.js), which every other part's catch-all aborts. */
const PROXY_HOSTS = /^https:\/\/(api\.cors\.lol|corsproxy\.io|api\.allorigins\.win|api\.codetabs\.com|cors\.eu\.org)\//;
/**
 * Answers the proxies for the band's part: the chart body `PROXY_CHART` names, the fund's JSONP, or a 404 — not a 503,
 * which the app reads as a proxy that is down and benches for ten minutes, on a clock this sweep has stopped.
 * @param {import('playwright').Page} page
 */
async function routeProxies(page) {
  await page.route(PROXY_HOSTS, (route) => {
    const u = decodeURIComponent(route.request().url());
    const m = u.match(/\/v8\/finance\/chart\/([^?&]+)/);
    const sym = m ? decodeURIComponent(m[1]) : null;
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (sym && PROXY_CHART[sym]) {
      const { price, prev, currency } = PROXY_CHART[sym];
      const meta = { symbol: sym, currency, regularMarketPrice: price, previousClose: prev, gmtoffset: -14400 };
      return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ chart: { result: [{ meta, timestamp: [], indicators: { quote: [{ close: [] }] } }], error: null } }) });
    }
    if (PROXY_FUND && u.includes('fundgz.1234567.com.cn')) {
      const body = { name: 'another fund', jzrq: '2026-09-16', gszzl: '1.79', gztime: '2026-09-17 15:00', ...PROXY_FUND };
      return route.fulfill({ status: 200, contentType: 'application/javascript', headers, body: `jsonpgz(${JSON.stringify(body)});` });
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', headers, body: 'not found' });
  });
}
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
/** Opens the Agents page from the menu and waits for its tab bar, and for the page to finish rising in. */
async function openAgentsPage(page) {
  await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
  await page.waitForTimeout(200);
  await page.locator('.header-menu-item:text-is("Agents (beta)")').first().click();
  await page.waitForSelector('.ag-modebar', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(150);
  // A desktop modal rises in over 0.22 s (`modal-in`, a transform), and a position read before the rise ends is up to
  // 12 px low. `tabs/none` compares the venue cards' positions read before and after a tab round trip: it failed once
  // with a full gate run beside it (2026-10-01), and fails every time with the rise slowed to 2 s, its first read 9 px
  // low. The rise is the only animation on a `.modal` itself (a phone's has none), so none running is the page at rest.
  await page.waitForFunction(() => [...document.querySelectorAll('.modal')].every((m) => m.getAnimations().length === 0), null, { timeout: 5_000 }).catch(() => {});
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
        const cells = [...c.querySelectorAll('.ag-venue-col > span')];
        // Each group's labels, and where each group starts: side by side on a card with the width to itself.
        const groups = [...c.querySelectorAll('.ag-venue-col')].map((g) => ({
          labels: [...g.querySelectorAll(':scope > span:nth-child(odd)')].map((x) => txt(x.querySelector('.ag-fig-name') ?? x)),
          left: Math.round(g.getBoundingClientRect().left), top: Math.round(g.getBoundingClientRect().top),
        }));
        /** @type {Record<string, string>} */
        const pairs = {}, bases = {};
        for (let i = 0; i + 1 < cells.length; i += 2) {
          const key = txt(cells[i].querySelector('.ag-fig-name') ?? cells[i]);
          pairs[key] = txt(cells[i + 1]);
          if (cells[i].querySelector('.ag-fig-base')) bases[key] = txt(cells[i].querySelector('.ag-fig-base'));
        }
        // The lines set in under realised (rewards and orders, fees), each with how far its words start inside its cell
        // (a label's cell may sit in another column from realised's on a wide card).
        const textLeft = (/** @type {Element} */ el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().left; };
        const subs = cells.filter((x, i) => i % 2 === 0 && x.classList.contains('ag-fig-sub'))
          .map((x) => `${txt(x)}+${Math.round(textLeft(x) - x.getBoundingClientRect().left)}`);
        return { id: ([...c.classList].find((x) => /^ag-venue-card-/.test(x)) || '').replace('ag-venue-card-', ''), meta: txt(c.querySelector('.ag-venue-meta')), pairs, bases, subs, groups, apart: txt(c.querySelector('.ag-venue-apart')) };
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
 * PR5's live executor trading real money (Davies, 2026-09-26), nothing else live: armed, two rungs holding. Its
 * `quotes.live` is the dashboard's own answer for a book worked out by hand (`quotes_live_fixture.json`, whose rows the
 * agents function's test turns into exactly this): £1,200 at £100 a rung, GBP/USD 1.32, so funded $1,584; held B 132
 * USDC sold at £0.7591 and E 132 USDT bought at £0.7565; the coins are valued at Revolut X's index price, £0.7575 and
 * £0.7570, as the account values them (Davies, 2026-10-01).
 *   deployed: the coins, 263.6436 × 0.7575 + 527.6436 × 0.757 = £599.14, and the pounds in four resting buys, £400.00:
 *     £999.14, 83.26 % of £1,200 ($1,318.86 at 1.32)
 *   today: the executor's loss stop's reading, £0.227106 (+$0.30); its loss stop 1 % of £1,200 = −£12
 *   unrealised: the coins at the index against their cost, −£0.1330 (−$0.18), −0.02 % of that cost
 *   realised: the three trips, −£0.0345 (−$0.05), with £0.1797 of fees ($0.24)
 */
const QUOTES_LIVE_FIXTURE = JSON.parse(fs.readFileSync(new URL('./quotes_live_fixture.json', import.meta.url), 'utf8'));
/**
 * "Reward quotes mini-pool" (`0077`): the dashboard's own answer (`prepSummary`) for a record worked out by hand at this
 * sweep's clock (`prep_fixture.json`; pm_prep_view.test.ts pins that its `output` is the function's answer for its
 * `input`): capital $320, held $8.77 at the mids against $8.35, today +$1.47 (the total +$2.37 less 16 Sep's +$0.90),
 * unrealised +$0.42, realised +$1.95 = rewards +$1.70 + orders +$0.25; the fills' P&L +$0.67; RW's worst case +$1.00.
 * Served only in the `prep` mode.
 */
const PREP_FIXTURE = JSON.parse(fs.readFileSync(new URL('./prep_fixture.json', import.meta.url), 'utf8'));
/**
 * "Reward quotes mid-pool" (`0081`): the same summary's answer for a record of its band worked out by hand at this sweep's
 * clock (`mid_fixture.json`; pm_prep_view.test.ts pins that its `output` is the function's answer for its `input`):
 * capital $320, held $11.20 at the mids against $10.80, quotes tying up $29.20, so deployed $40.40; today +$4.60 (the
 * total +$9.40 less 16 Sep's +$4.80), unrealised +$0.40, realised +$9.00 of rewards; RW's worst case +$4.20. Served,
 * with mini-pool's, only in the `mid` mode.
 */
const MID_FIXTURE = JSON.parse(fs.readFileSync(new URL('./mid_fixture.json', import.meta.url), 'utf8'));
const AGENTS_PR5_LIVE = () => {
  const d = AGENTS_DASHBOARD;
  return { ...d, quotes: { ...d.quotes, live: QUOTES_LIVE_FIXTURE.live } };
};
/** The same book's newest orders with none of its exits among them: its page then has no EXIT ORDERS at all. */
const AGENTS_PR5_LIVE_NO_EXIT = () => {
  const d = AGENTS_PR5_LIVE(), live = d.quotes.live;
  return { ...d, quotes: { ...d.quotes, live: { ...live, detail: { ...live.detail, orders: live.detail.orders.filter((/** @type {any} */ o) => o.leg !== 'exit' && o.leg !== 'stop') } } } };
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
/**
 * RW-E's variants before their first minute (Davies, 2026-09-27: a variant shows only what it did under its own rules):
 * x1's 2026-09-28 00:00 UTC, x4's and x5's 2026-10-03 00:00 UTC. Each summary is `notStarted`, with nothing in it, as
 * `rwSummary` returns one until the replay has reached that minute and kept its accounts.
 */
const AGENTS_RWX_WAITING = () => ({
  ...AGENTS_DASHBOARD,
  rwx: AGENTS_DASHBOARD.rwx.map((x) => ({
    ...x, notStarted: true, startsAt: x.id === 'x1' ? '2026-09-28T00:00:00.000Z' : '2026-10-03T00:00:00.000Z', startedAt: null,
    capitalUsd: 0, totalUsd: 0, stressUsd: 0, rewardUsd: 0, fillsPnlUsd: 0, realisedUsd: 0, unrealisedUsd: 0, mismatchUsd: 0,
    todayUsd: 0, heldUsd: 0, quotedUsd: 0, open: 0, fills: 0, quoting: 0, bestMarketUsd: null, markets: [], days: [], recent: [],
  })),
});
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
    ...paperRow, id: 'trend-4h-live', name: 'Trend 4h · live', mode: 'live', capitalUsd: 50, symbols,
    createdAt: new Date(NOW_MS - ((24 + 2) * 60 + 10) * 60e3).toISOString(),   // "live 1d 2h" on its page
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
/**
 * A strategy row's name button, by its WHOLE name. `:text-is("Reward quotes")` also matches the button of "Reward
 * quotes (no same-day)", whose bracket is a block of its own, and `:text-is` of the longer name matches nothing
 * (measured 2026-09-26), so a name is matched on the button's whole text instead.
 * @param {import('playwright').Page} page @param {string} name
 */
/**
 * A quotes book's page as the page shows it, the live executor's (`.ag-quotes-live-detail`) or a realistic twin's
 * (`.ag-quotes-twin-detail`): its head, scoreboard, sections, BOOKS, INVENTORY, DAYS, round trips and orders as text.
 * @param {import('playwright').Page} page @param {string} rootSel
 */
const readQuotesBookPage = (page, rootSel) => page.evaluate((rootSel) => {
    const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector(rootSel);
    if (!root) return null;
    const tds = (/** @type {Element} */ tr) => [...tr.querySelectorAll('td')];
    // A row and, joined to it, the line of its own under it (an order's reason, an event's words).
    const rows = (/** @type {string} */ sel) => {
      /** @type {string[]} */
      const out = [];
      for (const tr of root.querySelectorAll(`${sel} tbody tr`)) {
        const t = tds(tr).map(txt).join(' | ');
        if (tr.classList.contains('ag-ql-sub-row') && out.length) out[out.length - 1] += ` | ${t}`;
        else out.push(t);
      }
      return out;
    };
    const subs = [...root.querySelectorAll('.ag-ql-sub')].map((el) => el.getBoundingClientRect());
    const titles = document.querySelectorAll('.modal .modal-title');
    return {
      title: txt(titles[titles.length - 1]), modals: document.querySelectorAll('.modal').length,
      head: [...root.querySelectorAll('.ag-detail-head .ag-badge, .ag-detail-head .ag-venue')].map(txt).join(' '),
      status: txt(root.querySelector('.ag-detail-head .ag-status-text')), tested: txt(root.querySelector('.ag-detail-head .ag-tested')),
      scoreboard: [...root.querySelectorAll(':scope > .ag-scoreboard .ag-sb-cell')].map((c) => {
        const asides = [...c.querySelectorAll('.ag-sb-aside')].map(txt);
        return `${txt(c.querySelector('.ag-sb-name'))}${asides.length ? ` [${asides.join('; ')}]` : ''}=${txt(c.querySelector('.sb-value'))}`;
      }).join(' | '),
      sections: [...root.querySelectorAll('.ag-section > .ag-section-title')].map(txt),
      tiles: [...root.querySelectorAll('.ag-ql-tile')].map((t) => [txt(t.querySelector('.ag-ql-tile-k')), txt(t.querySelector('.ag-ql-tile-v')), txt(t.querySelector('.ag-ql-tile-note'))].join(' | ')),
      guards: [...root.querySelectorAll('.ag-ql-guard')].map((g) => `${txt(g)}${g.classList.contains('is-warn') ? ' [amber]' : ''}`),
      // BOOKS, as the paper page draws them (Davies, 2026-10-01): a card per book, its ladder, its trips and realised.
      cards: [...root.querySelectorAll('.ag-quote-books .ag-quotes-card')].map((c) => ({
        head: txt(c.querySelector('.ag-quotes-head .hl-strong')), meta: txt(c.querySelector('.ag-quotes-head .ag-venue-meta')),
        ladder: [...c.querySelectorAll('.ag-ladder tbody tr')].map((tr) => tds(tr).map(txt).join(' | ')),
        grid: [...c.querySelectorAll('.ag-quotes-grid > span')].map(txt),
      })),
      oldRungs: root.querySelectorAll('.ag-ql-rungs, tr.ag-ql-rung').length,
      balances: [...root.querySelectorAll('.ag-ql-balances .ag-ql-grid > span')].map(txt),
      days: rows('.ag-quote-days'),
      conversions: rows('.ag-ql-conversions'), trips: rows('.ag-ql-trips'), fills: rows('.ag-ql-fills'), events: rows('.ag-ql-events'),
      exits: rows('.ag-ql-exits'), entries: rows('.ag-ql-entries'), oldOrders: root.querySelectorAll('.ag-ql-orders').length,
      // Size is shown at every width, in the round trips and in both order tables (Davies, 2026-10-01).
      sizeShown: ['.ag-ql-trips', '.ag-ql-exits', '.ag-ql-entries'].map((sel) => {
        const th = [...root.querySelectorAll(`${sel} thead th`)].find((x) => txt(x) === 'Size');
        return !!th && getComputedStyle(th).display !== 'none';
      }),
      // How far the round trips' and the two order tables run past their boxes: inside the screen at every width.
      liveTablesOverflow: Math.max(0, ...['.ag-ql-trips', '.ag-ql-exits', '.ag-ql-entries'].map((sel) => {
        const el = root.querySelector(`${sel} .hl-scroll`);
        return el ? el.scrollWidth - el.clientWidth : 0;
      })),
      // Each order table's column widths as drawn, Side's beside the rest (Davies: no wider than the others).
      colWidths: ['.ag-ql-exits', '.ag-ql-entries'].map((sel) => [...root.querySelectorAll(`${sel} thead th`)]
        .filter((x) => getComputedStyle(x).display !== 'none').map((x) => [txt(x), Math.round(x.getBoundingClientRect().width)])),
      notes: root.querySelectorAll('.ag-ql-note').length,
      foot: txt(root.querySelector('.ag-ql-foot')), overflow: root.scrollWidth - root.clientWidth,
      // How far the widest table runs past its box, and the reasons' lines: each inside the screen.
      tableOverflow: Math.max(0, ...[...root.querySelectorAll('.hl-scroll')].map((el) => el.scrollWidth - el.clientWidth)),
      subs: subs.length, subsOff: subs.filter((r) => r.left < 0 || r.right > document.documentElement.clientWidth + 1).length,
      paperPage: document.querySelectorAll('.ag-quotes-detail').length,
      // The live executor's page and the twins' are each its own container: which are open.
      livePages: document.querySelectorAll('.ag-quotes-live-detail').length, twinPages: document.querySelectorAll('.ag-quotes-twin-detail').length,
      twinLines: [...root.querySelectorAll('.ag-twin-line')].map(txt), warns: [...root.querySelectorAll(':scope > .ag-warn-line')].map(txt),
    };
}, rootSel);

const nameBtn = (page, name) => page.locator('.ag-name-btn', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
/**
 * The reports the page has sent that `match`, waiting up to 3 s for one: a report is a fetch the page sends after it
 * draws, so on a loaded machine it can land a moment after what it reports is on the screen.
 * @param {import('playwright').Page} page @param {(r: { kind: string, symbol: string, message: string }) => boolean} match
 */
async function reportsOf(page, match) {
  const by = Date.now() + 3000;
  let got = /** @type {any} */ (page).__reports.filter(match);
  while (got.length === 0 && Date.now() < by) { await page.waitForTimeout(50); got = /** @type {any} */ (page).__reports.filter(match); }
  return got;
}
/** A strategy name's text lines, and whether its last line ends inside the cell (a row or a phone card) that holds it. */
const nameGeometry = (el) => el.locator('.ag-name-btn').first().evaluate((b) => {
  const range = document.createRange();
  range.selectNodeContents(b);
  const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
  const cell = b.closest('td, .ag-card-strategy')?.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  return { lines: tops.size, fits: !!cell && r.right <= cell.right + 1, qual: b.querySelectorAll('.ag-name-qual').length };
}).catch(() => ({ lines: 0, fits: false, qual: -1 }));

async function newPage(browser, { width, height }, errors, tokenMisses, opts = {}) {
  // `blockServiceWorkers`: a page that RELOADS is controlled by the app's
  // service worker from then on, and the worker's own fetches never pass
  // through `page.route` — every mocked Edge call would go to the real
  // network instead. The reload section blocks it; nothing it checks is
  // the worker's.
  const ctx = await browser.newContext({ viewport: { width, height }, ...(opts.blockServiceWorkers ? { serviceWorkers: 'block' } : {}) });
  await ctx.addInitScript(([token]) => { sessionStorage.setItem('dp.token', token); }, [opts.token || TOKEN]);
  // The surfaces this page is to fail from its first render (section 0e): the bundle reads `window.__dpSweepFail` in
  // each surface's boundary (src/app/surface_boundary.jsx). Nothing else sets it.
  if (opts.failSurfaces) await ctx.addInitScript((names) => { /** @type {any} */ (window).__dpSweepFail = names; }, opts.failSurfaces);
  // A tab that died mid-edit: its unsaved board, which the app replays on mount and saves.
  if (opts.draft) await ctx.addInitScript((d) => { sessionStorage.setItem('dp.pendingSave', d); }, JSON.stringify(opts.draft));
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
  /** Every report's kind and symbol, as the ops-error function would store it. @type {{ kind: string, symbol: string, message: string }[]} */
  /** @type {any} */ (page).__reports = [];

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
    if (url.includes('/data?') && url.includes('action=load')) {
      loadCalls += 1;
      if (loadFails) return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"unavailable"}' });
      return json({ data: loadOverride ?? PORTFOLIO, version: 1 });
    }
    if (url.includes('/data?') && url.includes('action=save')) {
      saveCalls += 1;
      if (saveFailures > 0) {
        saveFailures -= 1;
        return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"unavailable"}' });
      }
      return json({ ok: true, version: 2 });
    }
    if (url.includes('/agents?') && url.includes('action=dashboard')) {
      if (agentsMode === 'notReady') return json(AGENTS_NOT_READY);
      if (agentsMode === 'paused') return json(AGENTS_PAUSED());
      if (agentsMode === 'live' || agentsMode === 'live-unarmed') return json(AGENTS_LIVE(agentsMode === 'live'));
      if (agentsMode === 'rw-cents') return json(AGENTS_RW_CENTS());
      if (agentsMode === 'pr5-live') return json(AGENTS_PR5_LIVE());
      if (agentsMode === 'pr5-live-noexit') return json(AGENTS_PR5_LIVE_NO_EXIT());
      if (agentsMode === 'rwx-waiting') return json(AGENTS_RWX_WAITING());
      if (agentsMode === 'rwc-warmup') return json({ ...AGENTS_DASHBOARD, rwc: AGENTS_RWC_WAITING() });
      if (agentsMode === 'rwc-running') return json({ ...AGENTS_DASHBOARD, rwc: AGENTS_RWC_RUNNING(Math.floor(NOW_MS / 86400_000) * 86400_000) });
      if (agentsMode === 'quotesv') return json({ ...AGENTS_DASHBOARD, quotesVariant: AGENTS_QUOTESV(AGENTS_DASHBOARD.at), quotesRuled: AGENTS_QUOTESD(AGENTS_DASHBOARD.at) });
      if (agentsMode === 'prep') return json({ ...AGENTS_DASHBOARD, prep: PREP_FIXTURE.output });
      if (agentsMode === 'mid') return json({ ...AGENTS_DASHBOARD, prep: PREP_FIXTURE.output, prepMid: MID_FIXTURE.output });
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
        if (EDGE_OMIT.has(t)) continue;
        const q = EDGE_QUOTES[t] ?? QUOTES[t];
        if (q) out[t] = q;
      }
      return json(out);
    }
    if (url.includes('/trading212')) return json({ source: 'orders', orders: T212_ORDERS, complete: true });
    if (url.includes('/fundamentals')) return json({});
    if (url.includes('/overnight-fetch')) return json({});
    if (url.includes('/ops-error') && url.includes('action=summary') && OPS_SUMMARY) {
      // The errors badge's poll, answered as the ops-error function would from what this page has reported.
      /** @type {{ kind: string, symbol: string, message: string }[]} */
      const reps = /** @type {any} */ (page).__reports;
      const at = new Date(NOW_MS).toISOString();
      /** @type {Record<string, any>} */
      const byKind = {}, bySymbol = {};
      for (const r of reps) {
        (byKind[r.kind] ||= { kind: r.kind, count: 0, latestMessage: r.message }).count += 1;
        (bySymbol[`${r.symbol}|${r.kind}`] ||= { symbol: r.symbol || null, kind: r.kind, count: 0, latestMessage: r.message, latestAt: at }).count += 1;
      }
      return json({ hours: 24, total: reps.length, latestAt: at, byKind: Object.values(byKind), bySymbol: Object.values(bySymbol) });
    }
    if (url.includes('/ops-error')) {
      // What the app reports is part of what the sweep checks: a healed chunk must arrive as `chunk.load`, never `render.crash`.
      try {
        const body = req.postDataJSON();
        if (body?.kind) {
          /** @type {any} */ (page).__reported.push(String(body.kind));
          /** @type {any} */ (page).__reports.push({ kind: String(body.kind), symbol: String(body.symbol ?? ''), message: String(body.message ?? '') });
        }
      } catch { /* not JSON */ }
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
  // A page whose header is made to fail has no scoreboard to wait for: it names what it waits for instead, and the
  // checks after it say what is missing when that never comes (a bundle without the header's boundary).
  if (opts.readySelector) await page.waitForSelector(opts.readySelector, { timeout: 10_000 }).catch(() => {});
  else await page.waitForSelector('.scoreboard-cell-portfolio .sb-value-lg', { timeout: 20_000 });
  return { ctx, page };
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  PORT = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
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
  if (runs('desktop') && part('frame')) {
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
  if (runs('desktop') && part('recovery')) {
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

  // ---- 0b'. the performance panel follows a refresh -------------------------
  // Davies (2026-09-28): the vs-S&P panel moved with neither the clock nor the
  // refresh button — its bars were fetched once, when its window was first
  // drawn, and nothing asked again. Here the benchmark's last bar moves after
  // the page has settled: the button must bring it in at once, and the app's
  // own refresh must once the 24H window's five minutes have passed (driven
  // through its return-to-the-tab catch-up, the tick's own code path).
  for (const vp of viewports('perf-refresh')) {
    const S = (n) => `${vp.name}/perf-refresh/${n}`;
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses, { blockServiceWorkers: true });
    const spReading = () => page.evaluate(() => {
      const wrap = [...document.querySelectorAll('.perf-chart-wrap')].find((w) => w.getBoundingClientRect().width > 0);
      const item = wrap && [...wrap.querySelectorAll('.perf-legend-item')].find((n) => /S&P/.test(n.textContent || ''));
      return item ? (item.textContent || '').replace(/\s+/g, ' ').trim() : null;
    });
    const readingEnds = async (want, ms = 8000) => {
      const t0 = Date.now();
      let got = null;
      while (Date.now() - t0 < ms) {
        got = await spReading().catch(() => null);
        if (got && got.endsWith(want)) break;
        await page.waitForTimeout(100);
      }
      return got;
    };
    // `:visible`, here and in the sections after: the panel is drawn twice, and on a phone the first copy in the page is
    // the desktop column's, never shown, so a wait for the first `.perf-legend-item` to show ran out its 15 s every time.
    await page.waitForSelector('.perf-legend-item:visible', { state: 'visible', timeout: 15_000 }).catch(() => {});
    const before = await readingEnds('+4.00%');
    SP_BUMP = 1.01;                                    // 5000 → 5252: +5.04 %
    await page.locator('button[title="Refresh prices"]').first().click({ timeout: 5_000 }).catch(() => {});
    const pressed = await readingEnds('+5.04%');
    if (before?.endsWith('+4.00%') && pressed?.endsWith('+5.04%')) ok(S('button'), `the refresh button brings the benchmark's new bar in at once: ${before} → ${pressed}`);
    else fail(S('button'), `after the refresh button the panel reads "${pressed}" (before "${before}"), wanted +5.04 %`);
    SP_BUMP = 1.02;                                    // 5000 → 5304: +6.08 %
    await page.clock.setFixedTime(new Date(NOW_MS + 6 * 60e3));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    // The misses this check had while every gate ran at once (two on 2026-10-01, desktop, one on 09-30, phone, each
    // passing alone) were a race in the app, not slowness: the reading came in within about a second or never, and the
    // 20 s it was then given changed nothing. The button's refresh also prefetches the window, and under load that
    // prefetch's 24H batch, asked at 23:00, landed after the clock above moved and was stamped 23:06; the catch-up then
    // found every row fresh and fetched nothing. A row's age now counts from when it was asked for (perf_chart.jsx,
    // PERF_CACHE_TTL_MS): this section cut out and run under load failed 10 of 100 times before, 0 of 100 run beside
    // them after. The wait ends the moment the reading arrives; the time it took is printed, so a drift toward the limit
    // shows before it fails.
    const tickT0 = Date.now();
    const ticked = await readingEnds('+6.08%', 20_000);
    const tickS = ((Date.now() - tickT0) / 1000).toFixed(1);
    if (ticked?.endsWith('+6.08%')) ok(S('tick'), `the app's own refresh brings it in once the 24H bars are five minutes old: ${ticked} (${tickS} s)`);
    else fail(S('tick'), `after the app's refresh six minutes on the panel reads "${ticked}", wanted +6.08 %`);
    SP_BUMP = 1;
    await ctx.close();
  }

  // ---- 0c. a save the server refuses is said and tried again; a failed cross-tab load never swaps in the demo ----
  // Improvement plan items 4 and 5 (2026-09-30). The save effect marked a change saved before its request resolved and
  // dropped a failed one without a word, so the board looked saved while the server never had the change; and the
  // cross-tab reload took whatever the load answered, which on a failed load is the demo book. The change here arrives
  // as it does after a tab died mid-edit: a draft in sessionStorage, replayed on mount and saved.
  for (const vp of viewports('save-retry')) {
    const S = (n) => `${vp.name}/save-retry/${n}`;
    const draft = JSON.parse(JSON.stringify(PORTFOLIO));
    draft.holdings.NOVA.shares = 6;
    draft.holdings.NOVA.lots = [{ date: dayAgo(55), shares: 6, cost: 100 }];
    saveCalls = 0; loadCalls = 0; saveFailures = 2; loadFails = false;
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses, { draft: { fp: 'a draft', portfolio: draft, ts: NOW_MS } });
    const waitFor = async (fn, ms = 8000) => {
      const by = Date.now() + ms;
      while (Date.now() < by) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(50); }
      return false;
    };
    const banner = async () => ((await page.locator('.save-failing-banner').textContent().catch(() => null)) || '').replace(/\s+/g, ' ').trim();
    await waitFor(async () => saveCalls >= 1);
    await waitFor(async () => /trying again in 5 s/.test(await banner()));
    const first = await banner();
    if (saveCalls === 1 && /^NOT SAVED/.test(first) && /trying again in 5 s/.test(first)) ok(S('said'), `the refused save is said at once: "${first}"`);
    else fail(S('said'), `after ${saveCalls} save(s), one refused, the page reads "${first}"`);
    await page.clock.fastForward(5_000);
    await waitFor(async () => saveCalls >= 2 && /trying again in 15 s/.test(await banner()));
    const second = await banner();
    if (saveCalls === 2 && /trying again in 15 s/.test(second)) ok(S('retried'), `tried again after 5 s and refused again: "${second}"`);
    else fail(S('retried'), `5 s on: ${saveCalls} save(s), the page reads "${second}"`);
    await page.clock.fastForward(15_000);
    await waitFor(async () => saveCalls >= 3 && (await page.locator('.save-failing-banner').count()) === 0);
    const draftLeft = await page.evaluate(() => sessionStorage.getItem('dp.pendingSave'));
    const reported = /** @type {any} */ (page).__reported.filter((k) => k === 'data.save.failed').length;
    await page.clock.fastForward(60_000);
    await page.waitForTimeout(300);
    // Reported once: the ops client folds a kind's repeats within a minute (ops_error.js, COOLDOWN_MS).
    if (saveCalls === 3 && (await page.locator('.save-failing-banner').count()) === 0 && draftLeft === null && reported === 1) {
      ok(S('saved'), 'the third attempt is taken: the banner goes, the draft is cleared, the refusal was reported, and nothing more is sent');
    } else fail(S('saved'), `saves ${saveCalls}, banner ${await page.locator('.save-failing-banner').count()}, draft ${draftLeft === null ? 'cleared' : 'left'}, reported ${reported}`);

    // Another tab saves; this tab reloads, and the load fails.
    const S2 = (n) => `${vp.name}/cross-tab/${n}`;
    loadFails = true;
    const loadsBefore = loadCalls;
    await page.evaluate(() => { const bc = new BroadcastChannel('dp.portfolio'); bc.postMessage({ kind: 'portfolio-saved', sender: 'another tab', ts: Date.now() }); bc.close(); });
    await waitFor(async () => loadCalls > loadsBefore);
    await page.waitForTimeout(600);
    const demo = await page.locator('.demo-banner', { hasText: 'DEMO DATA' }).count();
    loadFails = false;
    if (loadCalls > loadsBefore && demo === 0) ok(S2('no-demo'), 'the reload another tab\'s save asks for fails, and the board on screen stays: no demo book');
    else fail(S2('no-demo'), `loads ${loadCalls - loadsBefore}, demo banners ${demo}`);
    await ctx.close();
  }

  // ---- 0b''. the 24H panel reaches the clock while the futures trade late ----
  // Davies (2026-09-28): once it refreshed, the panel still ran about ten
  // minutes behind the clock. Its x grid is the benchmark's bars, and the
  // futures reach us ten minutes late (Yahoo carries CME's delayed feed:
  // measured, the newest ES=F minute 10 min before the clock), while the
  // book's prices are live. The book now has a point of its own at the
  // current minute and the futures' line ends at its last print; and the
  // futures are asked for again after a minute, not five.
  for (const vp of viewports('perf-live-edge')) {
    const S = (n) => `${vp.name}/perf-live-edge/${n}`;
    ES_LIVE = 1;
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses, { blockServiceWorkers: true });
    await page.waitForSelector('.perf-legend-item:visible', { state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.locator('#perf-tab-sp:visible').first().click().catch(() => {});
    await page.locator('.ext-switch:visible').first().click().catch(() => {});
    await page.waitForTimeout(900);
    await page.locator('.perf-range-btn:visible:text-is("24H")').first().click().catch(() => {});
    const spLegend = () => page.evaluate(() => {
      const wrap = [...document.querySelectorAll('.perf-chart-wrap')].find((w) => w.getBoundingClientRect().width > 0);
      const item = wrap && [...wrap.querySelectorAll('.perf-legend-item')].find((n) => /S&P/.test(n.textContent || ''));
      return item ? (item.textContent || '').replace(/\s+/g, ' ').trim() : null;
    });
    const legendEnds = async (want, ms = 8000) => {
      const t0 = Date.now();
      let got = null;
      while (Date.now() - t0 < ms) {
        got = await spLegend().catch(() => null);
        if (got && got.endsWith(want)) break;
        await page.waitForTimeout(100);
      }
      return got;
    };
    const first = await legendEnds('+4.00%');
    // The two lines' points, and where the book's last two sit on the screen.
    const geo = await page.evaluate(() => {
      const wrap = [...document.querySelectorAll('.perf-chart-wrap')].find((w) => w.getBoundingClientRect().width > 0);
      const svg = wrap?.querySelector('svg');
      if (!svg) return null;
      const pts = (p) => (p?.getAttribute('d') || '').replace(/^M/, '').split('L').filter(Boolean).map((q) => q.split(',').map(Number));
      const book = pts([...svg.querySelectorAll('path')].find((n) => n.getAttribute('stroke-width') === '1.6' && !n.getAttribute('opacity')));
      const bench = pts([...svg.querySelectorAll('path')].find((n) => n.getAttribute('stroke-width') === '1.2'));
      const toScreen = ([x, y]) => {
        const pt = svg.createSVGPoint();
        pt.x = x; pt.y = y;
        const m = svg.getScreenCTM();
        const r = m ? pt.matrixTransform(m) : { x: 0, y: 0 };
        return [r.x, r.y];
      };
      return { book: book.length, bench: bench.length, last: toScreen(book[book.length - 1] || [0, 0]), prev: toScreen(book[book.length - 2] || [0, 0]) };
    });
    // Hover a point and read the crosshair: its time, and whether the benchmark has a chip there.
    const hoverAt = async ([x, y]) => {
      await page.mouse.move(x, y);
      await page.waitForTimeout(120);
      return page.evaluate(() => {
        const wrap = [...document.querySelectorAll('.perf-chart-wrap')].find((w) => w.getBoundingClientRect().width > 0);
        const g = [...(wrap?.querySelectorAll('svg g') || [])].find((n) => n.querySelector('line[stroke-dasharray="2,2"]') && n.querySelectorAll('text').length === 3);
        if (!g) return null;
        const [date, book, bench] = [...g.querySelectorAll('text')];
        return { time: (date.textContent || '').trim(), book: (book.textContent || '').trim(), bench: bench.style.display === 'none' ? null : (bench.textContent || '').trim() };
      });
    };
    const clockAt = (ms) => page.evaluate((t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), ms);
    const atEdge = geo ? await hoverAt(geo.last) : null;
    const atPrint = geo ? await hoverAt(geo.prev) : null;
    const [nowLabel, printLabel] = [await clockAt(NOW_MS), await clockAt(NOW_MS - 10 * 60e3)];
    if (/FUTURES/.test(first || '') && first?.endsWith('+4.00%') && geo && geo.book === geo.bench + 1) {
      ok(S('points'), `the book has one point more than the futures (${geo.book} and ${geo.bench}): its own, at the current minute`);
    } else fail(S('points'), `legend "${first}", points ${JSON.stringify(geo && { book: geo.book, bench: geo.bench })}`);
    if (atEdge && atEdge.time === nowLabel && atEdge.bench === null && atEdge.book) {
      ok(S('edge'), `the right edge reads the clock, ${atEdge.time}, with the book (${atEdge.book}) and no futures chip`);
    } else fail(S('edge'), `at the right edge the crosshair reads ${JSON.stringify(atEdge)}, wanted ${nowLabel} with no futures chip`);
    if (atPrint && atPrint.time === printLabel && atPrint.bench === '+4.00%') {
      ok(S('print'), `a step left, the futures' last print: ${atPrint.time}, futures +4.00%, book ${atPrint.book}`);
    } else fail(S('print'), `at the futures' last print the crosshair reads ${JSON.stringify(atPrint)}, wanted ${printLabel} and +4.00%`);
    await page.mouse.move(2, 2);
    // A minute and a half on, the futures' new print arrives with the app's own refresh; at five minutes it did not.
    ES_LIVE = 1.01;                                    // 5000 → 5252: +5.04 %
    await page.clock.setFixedTime(new Date(NOW_MS + 90e3));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const later = await legendEnds('+5.04%');
    if (later?.endsWith('+5.04%')) ok(S('minute'), `ninety seconds on, the app's refresh brings the futures' new print in: ${later}`);
    else fail(S('minute'), `ninety seconds on the futures read "${later}", wanted +5.04 %`);
    // 1W the same (Davies, 2026-09-28): the book to the current minute, the futures to their last print, and the
    // futures asked for again after a minute, not after its fifteen.
    await page.locator('.perf-range-btn:visible:text-is("1W")').first().click().catch(() => {});
    const weekFirst = await legendEnds('+5.04%');
    await page.waitForTimeout(300);
    const wGeo = await page.evaluate(() => {
      const wrap = [...document.querySelectorAll('.perf-chart-wrap')].find((w) => w.getBoundingClientRect().width > 0);
      const svg = wrap?.querySelector('svg');
      if (!svg) return null;
      const pts = (p) => (p?.getAttribute('d') || '').replace(/^M/, '').split('L').filter(Boolean).map((q) => q.split(',').map(Number));
      const book = pts([...svg.querySelectorAll('path')].find((n) => n.getAttribute('stroke-width') === '1.6' && !n.getAttribute('opacity')));
      const bench = pts([...svg.querySelectorAll('path')].find((n) => n.getAttribute('stroke-width') === '1.2'));
      const toScreen = ([x, y]) => {
        const pt = svg.createSVGPoint();
        pt.x = x; pt.y = y;
        const m = svg.getScreenCTM();
        const r = m ? pt.matrixTransform(m) : { x: 0, y: 0 };
        return [r.x, r.y];
      };
      return { book: book.length, bench: bench.length, last: toScreen(book[book.length - 1] || [0, 0]), prev: toScreen(book[book.length - 2] || [0, 0]) };
    });
    const wEdge = wGeo ? await hoverAt(wGeo.last) : null;
    const wPrint = wGeo ? await hoverAt(wGeo.prev) : null;
    const wNow = await clockAt(NOW_MS + 90e3);
    if (weekFirst?.endsWith('+5.04%') && wGeo && wGeo.book === wGeo.bench + 1 && wEdge && wEdge.time.endsWith(wNow) && wEdge.bench === null
      && wPrint && wPrint.time.endsWith(printLabel) && wPrint.bench === '+5.04%') {
      ok(S('1W'), `1W too: ${wGeo.book} points to the futures' ${wGeo.bench}, the right edge "${wEdge.time}" with no futures chip, a step left "${wPrint.time}" at +5.04%`);
    } else fail(S('1W'), `1W: legend "${weekFirst}", points ${JSON.stringify(wGeo && { book: wGeo.book, bench: wGeo.bench })}, edge ${JSON.stringify(wEdge)}, print ${JSON.stringify(wPrint)}`);
    await page.mouse.move(2, 2);
    ES_LIVE = 1.02;                                    // 5000 → 5304: +6.08 %
    await page.clock.setFixedTime(new Date(NOW_MS + 180e3));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const weekLater = await legendEnds('+6.08%');
    if (weekLater?.endsWith('+6.08%')) ok(S('1W-minute'), `on 1W, ninety seconds on, the futures' new print comes in: ${weekLater}`);
    else fail(S('1W-minute'), `on 1W ninety seconds on the futures read "${weekLater}", wanted +6.08 %`);
    ES_LIVE = 0;
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
  for (const vp of viewports('reload')) {
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
    await page.waitForSelector('.perf-legend-item:visible', { state: 'visible', timeout: 15_000 }).catch(() => {});
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

  // ---- 0c'. the NEW VERSION banner's reload paints what was on screen too --
  // Davies (2026-09-28): a refresh painted what the page last showed (0c), but
  // the banner's RELOAD still showed older numbers for a second or two first.
  // Its purge cleared localStorage, where every copy a reload paints from lives
  // (the book, the prices last shown, the 24H bars), and the prefs with them.
  // 0c blocks the service worker, so it never went down this path. Here the
  // page installs the worker, the server then serves a changed one, the page's
  // own update check finds it waiting, and RELOAD is pressed — with the server
  // row's prices at 0.95x, every answer held back 1.5 s and a non-default pref.
  for (const vp of viewports('banner-reload')) {
    const S = (n) => `${vp.name}/banner-reload/${n}`;
    loadOverride = storedAt(0.9);
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses);
    const read = () => page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
      const pf = txt(document.querySelector('.scoreboard-cell-portfolio .sb-value-lg'));
      let day = null;
      for (const c of document.querySelectorAll('.scoreboard-cell')) if (txt(c.querySelector('.sb-label')) === 'DAY CHANGE') day = txt(c.querySelector('.sb-value'));
      const wrap = [...document.querySelectorAll('.perf-chart-wrap')].find((w) => w.getBoundingClientRect().width > 0);
      let chart = null;
      if (wrap) {
        const empty = txt(wrap.querySelector('.sparkline-empty'));
        chart = empty ? `[${empty}]` : [...wrap.querySelectorAll('.perf-legend-item')].map(txt).join(' | ');
      }
      return { old: !!(/** @type {any} */ (window)).__beforeBanner, pf, day, chart };
    });
    await page.waitForFunction((want) => Math.abs(Number((document.querySelector('.scoreboard-cell-portfolio .sb-value-lg')?.textContent || '').replace(/[^0-9.-]/g, '')) - want) < 1, TOTAL_USD, { timeout: 15_000 }).catch(() => {});
    await page.waitForSelector('.perf-legend-item:visible', { state: 'visible', timeout: 15_000 }).catch(() => {});
    const installed = await page.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        const r = await navigator.serviceWorker.getRegistration();
        if (r && r.active) return true;
        await new Promise((res) => setTimeout(res, 50));
      }
      return false;
    }).catch(() => false);
    await page.waitForTimeout(2500);
    const prefs = JSON.stringify({ hideValues: false, moversMetric: 'usd' });
    await page.evaluate((p) => { localStorage.setItem('dp.prefs', p); (/** @type {any} */ (window)).__beforeBanner = true; }, prefs);
    const before = await read();
    SW_DEPLOY = 'a new deploy';
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update())).catch(() => {});
    const banner = await page.waitForSelector('button:text-is("RELOAD")', { timeout: 10_000 }).then(() => true, () => false);
    if (installed && banner) ok(S('banner'), 'the page installed its service worker, and a changed one on the server put up the NEW VERSION banner');
    else fail(S('banner'), `worker installed ${installed}, banner shown ${banner}`);
    loadOverride = storedAt(0.95);
    holdMs = 1500;
    heldAnswers.length = 0;
    await page.clock.setFixedTime(new Date(NOW_MS + 6 * 60e3));
    const seen = [];
    if (banner) {
      await page.locator('button:text-is("RELOAD")').first().click({ timeout: 5_000 }).catch(() => {});
      const t0 = Date.now();
      while (Date.now() - t0 < 9000) {
        const snap = await read().catch(() => null);
        if (snap && !snap.old && snap.pf) seen.push({ t: Date.now() - t0, ...snap });
        if (seen.length > 0 && Date.now() - t0 - seen[0].t > 3200) break;
        await page.waitForTimeout(15);
      }
    }
    holdMs = 0;
    loadOverride = null;
    SW_DEPLOY = '';
    const answered = heldAnswers.some((a) => a.includes('action=load')) && heldAnswers.some((a) => a.startsWith('/prices'));
    const first = seen[0];
    const same = (x) => x.pf === before.pf && x.day === before.day && x.chart === before.chart;
    if (!before.chart || before.chart.startsWith('[')) fail(S('first-paint'), `the page never settled before the banner: chart ${before.chart}`);
    else if (first && same(first)) ok(S('first-paint'), `the first paint after RELOAD is what was on screen: ${first.pf}, ${first.day}, ${first.chart}`);
    else fail(S('first-paint'), `first paint after RELOAD ${first ? `${first.pf} | ${first.day} | ${first.chart}` : 'never'}; before it ${before.pf} | ${before.day} | ${before.chart}`);
    const moved = seen.find((x) => !same(x));
    if (!answered) fail(S('steady'), `the held answers never landed after the reload (${heldAnswers.join(', ') || 'none'})`);
    else if (seen.length > 0 && !moved) ok(S('steady'), `${seen.length} reads through the held book and quotes landing: nothing moved`);
    else fail(S('steady'), moved ? `at ${moved.t} ms it read ${moved.pf} | ${moved.day} | ${moved.chart}` : 'no read after the reload');
    const kept = await page.evaluate(() => localStorage.getItem('dp.prefs')).catch(() => null);
    if (kept === prefs) ok(S('prefs'), `the prefs survive the banner's reload: ${kept}`);
    else fail(S('prefs'), `dp.prefs after the banner's reload is ${kept}, was ${prefs}`);
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
  for (const vp of viewports('agents-reload')) {
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
        if (first && !bad && first.realised === '+$148.65' && asks === 1) {
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

  // ---- 0e. one surface that throws becomes its own message; the rest of the board keeps working ----
  // Improvement plan item 20 (2026-10-02). The app had one error boundary, at its root, so a throw in any panel replaced
  // the whole board with RENDER ERROR. Every surface now has one of its own (src/app/surface_boundary.jsx). Here each is
  // made to throw in turn — the bundle fails the surfaces named in `window.__dpSweepFail`, which only this sweep sets —
  // and the page is read back: that surface shows "failed to load" with a Retry in its own place, the scoreboard still
  // totals the book, every other panel is still drawn, the throw is reported under the surface's name, and Retry draws
  // the surface again once nothing makes it throw. Modals and the Agents page's own pages are opened with their name
  // set, the same way. The part's console errors are the throws it asked for, each React's report of a caught error,
  // and nothing else (checked here; anything else goes to the whole-run invariant).
  for (const vp of viewports('surfaces')) {
    const S = (n) => `${vp.name}/surfaces/${n}`;
    const MARK = 'made to fail by the browser sweep';
    /** @type {string[]} */
    const own = [];
    // The scoreboard shows the book in whole dollars on the page ($3,183); compared as a number, as section 1 does.
    const totalOk = (/** @type {string | null | undefined} */ s) => !!s && near(money(s), TOTAL_USD);
    /** What the board shows right now, surface by surface, and which surfaces show they failed. */
    const readBoard = (page) => page.evaluate(() => {
      const shown = (/** @type {Element | null} */ el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const any = (/** @type {string} */ sel) => [...document.querySelectorAll(sel)].some(shown);
      const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        portfolio: txt(document.querySelector('.scoreboard-cell-portfolio .sb-value-lg')) || null,
        perf: any('.perf-range-btn'),
        board: any('.pitch') || any('.heatmap-canvas'),
        movers: any('.movers-heading'),
        formation: any('.formation-list'),
        market: [...document.querySelectorAll('.mc-card')].filter(shown).length,
        earnings: [...document.querySelectorAll('.earnings-panel')].some((el) => shown(el) && !el.classList.contains('surface-failed')),
        renderError: (document.body.textContent || '').includes('RENDER ERROR'),
        failed: [...document.querySelectorAll('.surface-failed')].filter(shown).map((el) => ({
          name: el.getAttribute('data-surface'), text: txt(el), retry: !!el.querySelector('button.surface-failed-retry'),
        })),
      };
    });
    // Each surface of the board: what it is called, what else it takes with it (its own panels inside it), and how to
    // tell it is drawn again after Retry.
    const phone = vp.name === 'phone';
    const SURFACES = [
      { name: 'header', gone: ['portfolio'], back: (b) => totalOk(b.portfolio) },
      { name: 'perf', gone: ['perf'], back: (b) => b.perf },
      { name: 'market', gone: ['market'], back: (b) => b.market > 0 },
      { name: 'earnings', gone: ['earnings'], back: (b) => b.earnings },
      { name: 'board', gone: ['board'], back: (b) => b.board },
      // The sidebar holds Top Movers and FORMATION VALUE, and on a phone the performance panel too.
      { name: 'sidebar', gone: ['movers', 'formation', ...(phone ? ['perf'] : [])], back: (b) => b.movers && b.formation },
      { name: 'movers', gone: ['movers'], back: (b) => b.movers },
    ];
    const ALL = ['portfolio', 'perf', 'board', 'movers', 'formation', 'market', 'earnings'];
    const present = (b, k) => (k === 'portfolio' ? totalOk(b.portfolio) : k === 'market' ? b.market > 0 : !!b[k]);
    const waitBoard = async (page, ok, ms = 8000) => {
      const by = Date.now() + ms;
      let b = await readBoard(page);
      while (!ok(b) && Date.now() < by) { await page.waitForTimeout(100); b = await readBoard(page); }
      return b;
    };
    for (const sf of SURFACES) {
      const { ctx, page } = await newPage(browser, vp, own, tokenMisses, { failSurfaces: [sf.name], readySelector: `.surface-failed[data-surface="${sf.name}"]`, blockServiceWorkers: true });
      // Everything this page can draw is drawn once the panels that wait on data have it.
      const others = ALL.filter((k) => !sf.gone.includes(k));
      const b = await waitBoard(page, (x) => others.every((k) => present(x, k)));
      await shot(page, `surface-${sf.name}`);
      const mine = b.failed.filter((f) => f.name === sf.name);
      const missing = others.filter((k) => !present(b, k));
      const stillShown = sf.gone.filter((k) => present(b, k));
      if (mine.length === 1 && /failed to load/.test(mine[0].text) && mine[0].retry && b.failed.length === 1 && missing.length === 0 && stillShown.length === 0 && !b.renderError) {
        ok(S(sf.name), `"${mine[0].text}" in its own place; the rest is drawn (${others.join(', ')}${others.includes('portfolio') ? ` ${b.portfolio}` : ''})`);
      } else fail(S(sf.name), `failed ${JSON.stringify(b.failed)}, missing ${JSON.stringify(missing)}, still shown ${JSON.stringify(stillShown)}, RENDER ERROR ${b.renderError}, scoreboard ${b.portfolio}`);
      const reports = await reportsOf(page, (r) => r.symbol === sf.name);
      if (reports.length >= 1 && reports.every((r) => r.kind === 'render.crash' && r.message.includes(MARK))) ok(S(`${sf.name}/report`), `reported as render.crash under "${sf.name}"`);
      else fail(S(`${sf.name}/report`), `reports ${JSON.stringify(/** @type {any} */ (page).__reports)}`);
      // Nothing makes it throw any more: Retry draws it again.
      await page.evaluate(() => { /** @type {any} */ (window).__dpSweepFail = []; });
      await page.locator(`.surface-failed[data-surface="${sf.name}"] button.surface-failed-retry:visible`).first().click({ timeout: 5_000 }).catch(() => {});
      const after = await waitBoard(page, (x) => sf.back(x) && x.failed.length === 0);
      if (sf.back(after) && after.failed.length === 0) ok(S(`${sf.name}/retry`), 'Retry draws it again');
      else fail(S(`${sf.name}/retry`), `after Retry: failed ${JSON.stringify(after.failed)}, ${JSON.stringify(after)}`);
      await ctx.close();
    }

    // The modals and pages, one page for all of them: each is opened with its name set, read, and closed.
    const { ctx, page } = await newPage(browser, vp, own, tokenMisses, { blockServiceWorkers: true });
    await waitBoard(page, (x) => ALL.every((k) => present(x, k)));
    const setFail = (names) => page.evaluate((n) => { /** @type {any} */ (window).__dpSweepFail = n; }, names);
    const menu = async (item) => {
      await page.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
      await page.waitForTimeout(150);
      await page.locator(`.header-menu-item:text-is("${item}")`).first().click({ timeout: 5_000 }).catch(() => {});
    };
    /** The top modal's title and whether it says its page failed, and the board behind it. */
    const readTop = () => page.evaluate(() => {
      const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const modals = [...document.querySelectorAll('.modal')];
      const top = modals[modals.length - 1];
      return {
        modals: modals.length, title: txt(top?.querySelector('.modal-title')),
        failed: txt(top?.querySelector('.modal-failed, .surface-failed')),
        retry: !!top?.querySelector('.modal-failed-retry, .surface-failed-retry'),
        portfolio: txt(document.querySelector('.scoreboard-cell-portfolio .sb-value-lg')),
      };
    });
    const waitTop = async (ok, ms = 8000) => {
      const by = Date.now() + ms;
      let t = await readTop();
      while (!ok(t) && Date.now() < by) { await page.waitForTimeout(80); t = await readTop(); }
      return t;
    };
    const closeTop = async () => {
      const before = (await readTop()).modals;
      await page.locator('.modal').last().locator('button[aria-label="Close"]').first().click({ timeout: 5_000 }).catch(() => {});
      await waitTop((t) => t.modals < before, 5000);
    };
    /** Opens one modal with its name set, reads its frame, and leaves it open. */
    const failedModal = async (name, title, open) => {
      await setFail([name]);
      await open().catch(() => {});
      const t = await waitTop((x) => x.failed !== '' && x.title === title);
      await shot(page, `surface-modal-${name}`);
      await setFail([]);
      if (t.title === title && /This page failed to load\./.test(t.failed) && t.retry && totalOk(t.portfolio)) {
        ok(S(`modal/${name}`), `"${title}" opens on its own frame: "${t.failed}"; the scoreboard behind it reads ${t.portfolio}`);
      } else fail(S(`modal/${name}`), `top modal ${JSON.stringify(t)}, wanted "${title}" saying it failed, scoreboard $${TOTAL_USD}`);
      const reported = (await reportsOf(page, (r) => r.symbol === name && r.kind === 'render.crash')).length > 0;
      if (!reported) fail(S(`modal/${name}`), `no render.crash reported under "${name}": ${JSON.stringify(/** @type {any} */ (page).__reports)}`);
      return t;
    };
    // The menu's pages. The holding list also proves Retry: with nothing making it throw, it draws its table.
    await failedModal('holdings-list', 'Holding list', () => menu('Holding list'));
    await page.locator('.modal').last().locator('.modal-failed-retry').click({ timeout: 5_000 }).catch(() => {});
    const rows = await page.locator('.modal .hl-table tbody tr').first().waitFor({ timeout: 8_000 }).then(() => page.locator('.modal .hl-table tbody tr').count()).catch(() => 0);
    if (rows > 0) ok(S('modal/retry'), `Retry draws the holding list again (${rows} rows)`);
    else fail(S('modal/retry'), 'the holding list did not draw after Retry');
    await closeTop();
    await failedModal('sectors-list', 'Sectors list', () => menu('Sectors list'));
    await closeTop();
    await failedModal('transaction-history', 'Transaction history', () => menu('Transaction history'));
    await closeTop();
    await failedModal('agents', 'Agents (beta)', () => menu('Agents (beta)'));
    await closeTop();
    // The Agents page's own two layers: the list inside its tabs, and a page opened over it.
    await setFail(['agents-list']);
    await menu('Agents (beta)');
    const list = await waitTop((x) => x.failed !== '' && x.title === 'Agents (beta)');
    const tabsShown = await page.locator('.ag-modebar .ag-modetab').count();
    await setFail([]);
    if (/This page failed to load\./.test(list.failed) && tabsShown > 0 && totalOk(list.portfolio)) ok(S('agents-list'), `the Agents page keeps its title and ${tabsShown} tabs; its list says "${list.failed}"`);
    else fail(S('agents-list'), `${JSON.stringify(list)}, tabs ${tabsShown}`);
    await page.locator('.modal').last().locator('.surface-failed-retry').click({ timeout: 5_000 }).catch(() => {});
    const listBack = await page.locator('.ag-strategies .ag-name-btn').first().waitFor({ timeout: 8_000 }).then(() => true).catch(() => false);
    if (listBack) ok(S('agents-list/retry'), 'Retry draws the list again');
    else fail(S('agents-list/retry'), 'the list did not draw after Retry');
    await setFail(['agents-page']);
    const rowName = ((await page.locator('.ag-strategies .ag-name-btn').first().textContent().catch(() => '')) || '').trim();
    await page.locator('.ag-strategies .ag-name-btn').first().click().catch(() => {});
    const detail = await waitTop((x) => x.modals >= 2 && x.failed !== '');
    await setFail([]);
    const listUnder = await page.locator('.ag-strategies .ag-name-btn').count();
    if (detail.modals >= 2 && /This page failed to load\./.test(detail.failed) && listUnder > 0 && totalOk(detail.portfolio)) ok(S('agents-page'), `"${rowName}" opens over the list with "${detail.failed}"; the list (${listUnder} rows) stays under it`);
    else fail(S('agents-page'), `${JSON.stringify(detail)}, list rows ${listUnder}`);
    await page.locator('.modal').last().locator('.ag-detail-close, button[aria-label="Close"]').first().click().catch(() => {});
    await waitTop((x) => x.modals === 1, 5000);
    await closeTop();
    // The chart modal, from a market card.
    await failedModal('ticker-chart', '^GSPC', () => page.locator('.mc-card-clickable:visible').first().click());
    await closeTop();
    // The tactics board's modals: a position, cash, and in edit mode a holding, a new holding and the confirm dialog.
    // A position's frame is titled as its own page is: the title is read off the page drawn whole first.
    await page.locator('.pos-chip[data-poskey="CM"]').first().click().catch(() => {});
    const cm = (await waitTop((x) => x.modals === 1 && x.title !== '')).title;
    await closeTop();
    await failedModal('position', cm, () => page.locator('.pos-chip[data-poskey="CM"]').first().click());
    await closeTop();
    await failedModal('cash', 'Cash on hand', () => page.locator('.pos-chip[data-poskey="GK"]').first().click());
    await closeTop();
    await page.locator('.btn-toggle').first().click().catch(() => {});
    await page.locator('.pos-chip[data-poskey="CM"]').first().click().catch(() => {});
    await waitTop((x) => x.modals === 1 && x.title.startsWith(cm));
    await failedModal('edit-holding', 'ACME', () => page.locator('.modal .player-card').first().click());
    await closeTop();
    await failedModal('add-holding', cm, () => page.locator('.modal button.btn-primary:text-is("+ Add Player")').first().click());
    await closeTop();
    await failedModal('confirm', 'Confirm', () => page.locator('.modal .player-card .pc-remove').first().click());
    await closeTop();
    // Closing the failed dialog was its Cancel: nothing was removed.
    const still = await page.locator('.modal .player-card').count();
    if (still === 1) ok(S('modal/confirm-cancel'), 'closing the failed confirm dialog removes nothing: ACME is still in Midfield');
    else fail(S('modal/confirm-cancel'), `Midfield has ${still} players after the failed dialog closed`);
    await closeTop();
    await page.locator('.btn-toggle').first().click().catch(() => {});
    // A page whose code does not load at all — healed once already, inside the window — still says so in its own
    // frame (the lazy pages' path through the same boundary), and the board stays up.
    await ctx.close();
    const { ctx: c2, page: p2 } = await newPage(browser, vp, own, tokenMisses, {
      blockServiceWorkers: true, allowModuleErrors: true,
      beforeGoto: async (pg) => {
        // A heal already ran a moment ago, so this failure is shown, not healed again (chunk_recovery.js, shouldHeal).
        await pg.addInitScript((t) => { sessionStorage.setItem('dp.chunkRecovery', String(t)); }, NOW_MS);
        await pg.route('**/assets/sectors_list-*.js', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><body>the app shell</body></html>' }));
      },
    });
    await p2.locator('.header-menu-btn, .header-menu button').first().click().catch(() => {});
    await p2.waitForTimeout(150);
    await p2.locator('.header-menu-item:text-is("Sectors list")').first().click({ timeout: 5_000 }).catch(() => {});
    const chunkFrame = await p2.locator('.modal .modal-failed').first().waitFor({ timeout: 8_000 }).then(() => p2.locator('.modal .modal-failed').first().textContent()).catch(() => '');
    const chunkTitle = ((await p2.locator('.modal .modal-title').first().textContent().catch(() => '')) || '').trim();
    const chunkBoard = ((await p2.locator('.scoreboard-cell-portfolio .sb-value-lg').first().textContent().catch(() => '')) || '').trim();
    const chunkReports = (await reportsOf(p2, (r) => r.symbol === 'sectors-list')).map((r) => r.kind);
    if (chunkTitle === 'Sectors list' && /code did not load/.test(chunkFrame || '') && totalOk(chunkBoard) && chunkReports.includes('chunk.load') && !chunkReports.includes('render.crash')) {
      ok(S('chunk'), `a page whose code does not load says so in its own frame ("${(chunkFrame || '').replace(/\s+/g, ' ').trim().slice(0, 40)}…"), reported as chunk.load; the scoreboard reads ${chunkBoard}`);
    } else fail(S('chunk'), `title "${chunkTitle}", frame "${chunkFrame}", scoreboard ${chunkBoard}, reports ${JSON.stringify(chunkReports)}`);
    await c2.close();

    // This part's console errors are the throws it asked for, and the failed chunk's own; anything else is the app's.
    const expected = own.filter((e) => e.includes(MARK) || /sectors_list-[^ ]*\.js|Failed to fetch dynamically imported module|not a valid JavaScript MIME type/.test(e));
    const other = own.filter((e) => !expected.includes(e));
    if (expected.length > 0 && other.length === 0) ok(S('console'), `${expected.length} console errors, every one a throw this part asked for`);
    else { fail(S('console'), `${other.length} other console errors`); errors.push(...other); }
  }

  // ---- 0f. a quote the band cannot believe is held; a real move is shown ----
  // Improvement plan item 6 (2026-10-02). Nothing checked a quote between the fetch and the board: a quote in pence
  // where pounds were, or a proxy's body for something else, was shown and added into every total. The band
  // (src/prices/quote_band.js) holds such a quote — the board keeps its last good price — reports it, and believes it
  // once the other source agrees. Each phase is one press of Refresh, read back from the scoreboard (compared as a
  // number) and the board's position cards against totals worked by hand.
  //
  // The book is the fixture's without its CN fund: with a fund in the book the app asks the proxies for the fund alone
  // (yahoo_fetch.js), so a stock the price function leaves out would not reach them. ACME 1,440 + NOVA 600 + BRIT.L
  // 312.50 + VUAA.L 300 + CASH 500 = $3,152.50.
  //   A  the price function leaves BRIT.L and NOVA out; the proxies answer BRIT.L 250 in a GBP body (pence for pounds)
  //      and NOVA 84 on its 120 close (-30 %): BRIT.L is held at 2.50 and NOVA shown, $2,972.50 (unbanded: $33,910)
  //   B  the function answers BRIT.L 2.55 (taken; the hold goes), NOVA 84, and ACME 24 on a 23.80 close, a 10:1 split's
  //      shape: ACME is held at 240, $2,978.75 (unbanded: $1,682.75)
  //   C  the function says ACME 24 again and the proxies, asked for a second opinion, say 24 too: ACME shown, $1,682.75
  // Then the fund, on the whole book: the function leaves 017731 out and its own proxy path answers another fund's NAV
  // (2.85 on 2.80): held at 1.50, so the total stays $3,182.50 (unbanded: 200 × 2.85 × 0.10 = $57, $3,209.50).
  for (const vp of viewports('quote-band')) {
    const S = (n) => `${vp.name}/quote-band/${n}`;
    const noFund = JSON.parse(JSON.stringify(PORTFOLIO));
    delete noFund.holdings['017731'];
    for (const p of Object.values(noFund.positions)) p.tickers = p.tickers.filter((t) => t !== '017731');
    loadOverride = noFund;
    EDGE_OMIT = new Set(); EDGE_QUOTES = {}; PROXY_CHART = {}; PROXY_FUND = null; OPS_SUMMARY = true;
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses, { blockServiceWorkers: true, beforeGoto: routeProxies });
    const totalNow = () => page.locator('.scoreboard-cell-portfolio .sb-value-lg').first().textContent().then((s) => money(s)).catch(() => NaN);
    const cards = () => page.evaluate(() => [...document.querySelectorAll('.pos-chip')].map((c) => ({
      tickers: [...c.querySelectorAll('.chip-ticker')].map((x) => (x.textContent || '').trim()),
      mv: (c.querySelector('.chip-mv')?.textContent || '').trim(),
    })).filter((c) => c.tickers.length > 0));
    const cardOf = async (ticker) => (await cards()).find((c) => c.tickers.includes(ticker))?.mv ?? null;
    /** Presses Refresh and waits until the total reads `want` (or 8 s); returns what it read. */
    const refreshTo = async (want) => {
      await page.locator('button[title="Refresh prices"]').first().click({ timeout: 5_000 }).catch(() => {});
      const by = Date.now() + 8000;
      let got = await totalNow();
      while (!near(got, want) && Date.now() < by) { await page.waitForTimeout(100); got = await totalNow(); }
      await page.waitForTimeout(300);
      return totalNow();
    };
    const reports = () => /** @type {any} */ (page).__reports.filter((r) => r.kind === 'quote.held');
    await page.waitForFunction((w) => Math.abs(Number((document.querySelector('.scoreboard-cell-portfolio .sb-value-lg')?.textContent || '').replace(/[^0-9.-]/g, '')) - w) < 1, 3152.5, { timeout: 15_000 }).catch(() => {});
    const start = await totalNow();
    if (near(start, 3152.5)) ok(S('start'), `the book without its fund totals $3,152.50 (reads ${start})`);
    else fail(S('start'), `the book reads ${start}, wanted 3152.50`);

    // A: a pence-for-pounds body and a real -30 % move, both from the proxies.
    EDGE_OMIT = new Set(['BRIT.L', 'NOVA']);
    PROXY_CHART = {
      'BRIT.L': { price: 250, prev: 240, currency: 'GBP' },
      NOVA: { price: 84, prev: 120, currency: 'USD' },
    };
    const a = await refreshTo(2972.5);
    const [britA, novaA] = [await cardOf('BRIT'), await cardOf('NOVA')];
    // BRIT.L's card: 100 × 2.50 × 1.25 = $312.50, with VUAA.L's $300 when the two share a position.
    const britWith = (await cards()).find((x) => x.tickers.includes('BRIT'))?.tickers ?? [];
    const britWant = 312.5 + (britWith.includes('VUAA') ? 300 : 0);
    const heldA = reports().find((r) => r.symbol === 'BRIT.L');
    if (near(a, 2972.5) && near(money(britA), britWant, 0.006) && near(money(novaA), 420, 0.006)) {
      ok(S('held'), `BRIT.L at 250 from a proxy (pence for pounds) is held: its card (${britWith.join(', ')}) still reads ${britA}, BRIT.L at 2.50; NOVA's real -30 % is shown, ${novaA}; total ${a}`);
    } else fail(S('held'), `total ${a} (wanted 2972.50; unbanded 33910), BRIT.L's card (${britWith.join(', ')}) ${britA} (wanted ${britWant}), NOVA's ${novaA} (wanted $420.00)`);
    if (heldA && /250 from a proxy against 2\.5 \(×100, 100× off: pence for pounds\)/.test(heldA.message) && !reports().some((r) => r.symbol === 'NOVA')) {
      ok(S('report'), `reported as quote.held under BRIT.L: "${heldA.message}"; nothing for NOVA`);
    } else fail(S('report'), `reports ${JSON.stringify(/** @type {any} */ (page).__reports)}`);
    if (vp.name === 'desktop') {
      // The errors badge polls the summary every minute: the report is on the page a minute on.
      await page.clock.fastForward(61_000);
      const badge = await page.locator('.live-pill.err:has-text("ERRORS")').first().waitFor({ timeout: 8_000 }).then(() => true).catch(() => false);
      let rows = [];
      if (badge) {
        await page.locator('.live-pill.err:has-text("ERRORS")').first().click().catch(() => {});
        rows = await page.locator('.modal tr').allTextContents().catch(() => []);
        await page.keyboard.press('Escape');
      }
      if (badge && rows.some((r) => r.includes('BRIT.L') && r.includes('quote.held'))) ok(S('badge'), 'the errors badge lists it: BRIT.L · quote.held');
      else fail(S('badge'), `badge ${badge}, rows ${JSON.stringify(rows)}`);
      const still = await totalNow();
      if (near(still, 2972.5)) ok(S('still-held'), `two more refreshes from the same proxy a minute on: still held, total ${still}`);
      else fail(S('still-held'), `a minute on the total reads ${still}, wanted 2972.50`);
    }

    // B: the function comes back with BRIT.L in pounds, and ACME in a split's shape.
    EDGE_OMIT = new Set();
    EDGE_QUOTES = {
      'BRIT.L': { lastPrice: 2.55, prevClose: 2.4, currency: 'GBP', dayPct: 6.25 },
      NOVA: { lastPrice: 84, prevClose: 120, currency: 'USD', dayPct: -30 },
      ACME: { lastPrice: 24, prevClose: 23.8, currency: 'USD', dayPct: 0.84 },
    };
    PROXY_CHART = {};
    const b = await refreshTo(2978.75);
    const acmeB = await cardOf('ACME');
    if (near(b, 2978.75) && near(money(acmeB), 1440, 0.006) && reports().some((r) => r.symbol === 'ACME')) {
      ok(S('split-held'), `BRIT.L's pounds are taken and ACME at 24 on a 23.80 close is held at 240 (${acmeB}); total ${b}`);
    } else fail(S('split-held'), `total ${b} (wanted 2978.75; unbanded 1682.75), ACME's card ${acmeB}, reports ${JSON.stringify(reports().map((r) => r.symbol))}`);

    // C: the proxies, asked for a second opinion on ACME, agree with the function.
    PROXY_CHART = { ACME: { price: 24, prev: 23.8, currency: 'USD' } };
    const c = await refreshTo(1682.75);
    const acmeC = await cardOf('ACME');
    const asked = /** @type {any} */ (page).__requested.some((u) => /chart%2FACME|chart\/ACME/.test(u) && !u.includes('/functions/v1/'));
    if (near(c, 1682.75) && near(money(acmeC), 144, 0.006) && asked) ok(S('second-source'), `the proxies were asked about ACME and agree: 24 is shown (${acmeC}); total ${c}`);
    else fail(S('second-source'), `total ${c} (wanted 1682.75), ACME's card ${acmeC}, proxies asked ${asked}`);
    await ctx.close();

    // The fund: its own proxy path answers another fund's body.
    loadOverride = null;
    EDGE_OMIT = new Set(); EDGE_QUOTES = {}; PROXY_CHART = {}; PROXY_FUND = null;
    const { ctx: c2, page: p2 } = await newPage(browser, vp, errors, tokenMisses, { blockServiceWorkers: true, beforeGoto: routeProxies });
    await p2.waitForFunction((w) => Math.abs(Number((document.querySelector('.scoreboard-cell-portfolio .sb-value-lg')?.textContent || '').replace(/[^0-9.-]/g, '')) - w) < 1, TOTAL_USD, { timeout: 15_000 }).catch(() => {});
    EDGE_OMIT = new Set(['017731']);
    PROXY_FUND = { fundcode: '110011', dwjz: '2.8000', gsz: '2.8500' };
    const fundReports = () => /** @type {any} */ (p2).__reports.filter((r) => r.kind === 'quote.held' && r.symbol === '017731');
    // The first refresh starts the fund's background fetch; the second takes what it brought.
    for (let i = 0; i < 2; i++) {
      const n = /** @type {any} */ (p2).__requested.filter((u) => u.includes('/functions/v1/prices')).length;
      await p2.locator('button[title="Refresh prices"]').first().click({ timeout: 5_000 }).catch(() => {});
      const by = Date.now() + 8000;
      while (Date.now() < by && /** @type {any} */ (p2).__requested.filter((u) => u.includes('/functions/v1/prices')).length <= n) await p2.waitForTimeout(50);
      await p2.waitForTimeout(1200);
    }
    const by = Date.now() + 5000;
    while (Date.now() < by && fundReports().length === 0) await p2.waitForTimeout(100);
    const fundTotal = money(await p2.locator('.scoreboard-cell-portfolio .sb-value-lg').first().textContent().catch(() => ''));
    const fundAsked = /** @type {any} */ (p2).__requested.some((u) => u.includes('fundgz.1234567.com.cn') && !u.includes('/functions/v1/'));
    if (fundAsked && fundReports().length === 1 && near(fundTotal, TOTAL_USD)) {
      ok(S('fund'), `017731 from its proxy at another fund's 2.85 is held at 1.50; the total stays ${fundTotal}; reported "${fundReports()[0].message}"`);
    } else fail(S('fund'), `proxy asked ${fundAsked}, reports ${JSON.stringify(fundReports())}, total ${fundTotal} (wanted ${TOTAL_USD}; unbanded 3209.50)`);
    await c2.close();
    EDGE_OMIT = new Set(); EDGE_QUOTES = {}; PROXY_CHART = {}; PROXY_FUND = null; OPS_SUMMARY = false;
  }

  for (const vp of viewports('main')) {
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
      // The strategies' 12.34, RW's 42, RW-E's 23.60 and the three variants on the page each realising RW-E's 23.60 (Davies,
      // 2026-09-27; since 2026-10-02 x1, x4 and x5), and the two realistic twins (2026-10-02) each the live fixture's
      // -£0.0345066 at 1.32, -$0.0455487: 12.34 + 42 + 4 × 23.60 - 2 × 0.0455487 = 148.6489. RW-C is not a row before its warm-up.
      if (money(head) === 148.65 && /^\+/.test((head || '').trim())) ok(S('agents'), `headline is the realised total, strategies plus the seven tests (${(head || '').trim()})`);
      else fail(S('agents'), `headline read "${head}", wanted +$148.65`);
      const rows = await page.locator('.ag-row').count();
      // Three since `0046` deleted the Kraken twin (§4.22): `0043` retired the two rotations and the
      // Kraken momentum twin, `0044` deleted them, and the twin made no decision of its own. The rows
      // those migrations removed are off the page because none of them still holds anything here.
      // Plus the two realistic twins of the live executor (Davies, 2026-10-02: in place of the quote test, its variant and
      // rule D), RW's paper test on Polymarket since 2026-09-24, RW-E since 2026-09-26, and three of its variants
      // (variant-2 since 2026-09-27; variant-3 and -4, x1 with its quotes moved, since 2026-10-02, Davies). RW-C (0069) is
      // not a row before its warm-up begins, 2026-10-08 (Davies, 2026-09-28).
      if (rows === 13) ok(S('agents'), 'thirteen rows — the three 0046 leaves, their Binance twins (0049), the two realistic twins, RW, RW-E and three variants; no RW-C before its warm-up, the deleted ones absent');
      else fail(S('agents'), `expected 13 rows (six strategies, two twins, RW, RW-E and three variants), got ${rows}`);
      // Every row's last DECISION is 35 min old — two of the trend rule's
      // bars would call that stale. What keeps them running is the
      // observation the tick wrote 40 s ago.
      const running = await page.locator('.ag-row .ag-name-wrap .ag-dot-running').count();
      const statusCol = await page.locator('.ag-strategies .ag-col-status, .ag-row .ag-status').count();
      const offPage = await page.locator('.ag-row', { has: page.locator('.ag-name-btn', { hasText: /^Reward quotes confirmation$/ }) }).count();
      if (running === rows && offPage === 0 && statusCol === 0) ok(S('agents'), 'a 40 s-old observation keeps every row\'s dot green, beside the name, with no status column; RW-C is not a row');
      else fail(S('agents'), `running dots: ${running} of ${rows}, RW-C rows ${offPage}, status cells ${statusCol}`);
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
      // No "% of cap" / "% of cost" line on a strategy's card or row (Davies, 2026-09-27; the table's went 2026-09-25).
      const pctOfLines = await page.locator('.ag-strategies .ag-row').evaluateAll((els) => els.filter((el) => /% of /.test(el.textContent || '')).length);
      if (pctOfLines === 0) ok(S('agents'), 'no strategy card or row carries a "% of …" line');
      else fail(S('agents'), `${pctOfLines} strategy rows still say "% of …"`);
      // The stablecoin twins' rows are in pounds, their books' own (Davies, 2026-10-01): their three cells, and only those.
      // Each is the live fixture's book: today £0.227106 (0.02 % of £1,200, 0.01 % of £1,800), unrealised -£0.1330 (-0.02 %
      // of the £599.27 its coins cost), realised -£0.0345 (-0.003 % of £1,200, -0.002 % of £1,800: 0 % to two places).
      const poundCells = glCells.filter((g) => /£/.test(g)).map((g) => g.trim());
      if (glCells.length === rows * 3 && glCells.every((g) => /^[+-]?[$£][\d,.]+( \([+-]?[\d.]+%\))?$/.test(g.trim()))
        && poundCells.join(' | ') === '+£0.23 (+0.02%) | -£0.13 (-0.02%) | -£0.03 (0%) | +£0.23 (+0.01%) | -£0.13 (-0.02%) | -£0.03 (0%)') {
        ok(S('agents'), `today, unrealised and realised read like the scoreboard ("${glCells[0].trim()}"), the stablecoin quotes' in pounds (${poundCells.join(', ')})`);
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
      // A row in pounds (a stablecoin twin's) counts at its dollars, the $0.29978 the scoreboard adds (£0.227106 at 1.32):
      // its £0.23 is rounded. 0.42 + 2 × 0.29978 + 12.50 + 4 × 7.50 = 43.52.
      const poundToday = rowToday.filter((t) => /£/.test(t));
      const rowTodaySum = Math.round((rowToday.filter((t) => !/£/.test(t)).reduce((a, t) => a + money(String(t).split('(')[0]), 0)
        + (poundToday.join(' | ') === '+£0.23 (+0.02%) | +£0.23 (+0.01%)' ? 2 * 0.227106 * 1.32 : NaN)) * 100);
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
      // The fees: the strategy's $0.08 and each twin's £0.1797 at 1.32 ($0.2372), $0.55.
      if (sbCells.join(' | ') === 'FUNDED | DEPLOYED | TODAY | UNREALIZED G/L | REALIZED G/L / (incl. fees $0.55)' && sbFit.overflow <= 1 && sbFit.outside.length === 0 && sbFit.labelH > 0 && sbFit.titlesMatch && sbFit.feesSmaller && sbFit.sameLine) {
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
      // The realistic twins of the live executor are the stablecoin rows of TESTING STRATEGIES (Davies, 2026-10-02), after
      // the strategies, in a strategy's cells and in pounds: "Stablecoin quotes" (PR5's rule) at £1,200 and "Stablecoin
      // quotes variant-1" (rule D) at £1,800, each the live fixture's book (QUOTES_TWIN_FIXTURE): 2 open (B's short and
      // E's long), deployed £999.14 (the coins at the index and the pounds in four resting buys), today +£0.23, unrealised
      // -£0.13, realised -£0.03. The paper test, PR5V and rule D, which the payload still carries, are no rows.
      const twinRow = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Stablecoin quotes') });
      const twinDRow = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Stablecoin quotes variant-1') });
      const twinText = (await twinRow.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const twinDText = (await twinDRow.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const testingNames = (await page.locator('.ag-strategies-testing .ag-row .ag-name-btn').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const oldCard = await page.locator('.ag-quotes .ag-section-title').count() + await page.locator('text=STABLECOIN QUOTES — PAPER TEST').count();
      const twinAt = testingNames.indexOf('Stablecoin quotes');
      const dHead = ((await twinDRow.first().locator('.ag-name-head').textContent().catch(() => '')) || '').trim();
      const dQual = ((await twinDRow.first().locator('.ag-name-qual').textContent().catch(() => '')) || '').trim();
      if (await twinRow.count() === 1 && await twinDRow.count() === 1 && twinAt === 6 && testingNames[7] === 'Stablecoin quotes variant-1' && testingNames.filter((n) => /^Stablecoin quotes/.test(n)).length === 2
        && /Revolut X/.test(twinText) && /2 open · £1,200 cap/.test(twinText) && / £999\.14 /.test(twinText) && /\+£0\.23 \(\+0\.02%\)/.test(twinText) && /-£0\.13 \(-0\.02%\)/.test(twinText) && /-£0\.03 \(0%\)/.test(twinText) && /every minute/.test(twinText)
        && /Revolut X/.test(twinDText) && /2 open · £1,800 cap/.test(twinDText) && / £999\.14 /.test(twinDText) && /\+£0\.23 \(\+0\.01%\)/.test(twinDText) && /-£0\.13 \(-0\.02%\)/.test(twinDText) && /-£0\.03 \(0%\)/.test(twinDText)
        && dHead === 'Stablecoin quotes' && dQual === 'variant-1' && !/\$/.test(twinText + twinDText) && oldCard === 0) {
        ok(S('agents'), 'the two twins are the testing rows after the strategies, in pounds: "Stablecoin quotes" at £1,200 and "Stablecoin quotes variant-1" (on two lines) at £1,800, each 2 open, deployed £999.14, today +£0.23, unrealised -£0.13, realised -£0.03; no paper test row, no card below');
      } else fail(S('agents'), `twin rows "${twinText}" / "${twinDText}" at ${twinAt} of ${testingNames.join(' | ')}, variant name "${dHead}" + "${dQual}", old card sections ${oldCard}`);
      const quotesInVenues = await page.locator('.ag-venue-cards .ag-quotes-card, .ag-quotes-cards .ag-venue-card').count();
      if (quotesInVenues === 0) ok(S('agents'), 'no quote card is a venue card, and no venue selector reaches one');
      else fail(S('agents'), `${quotesInVenues} quotes/venue cards cross-classed`);
      // Its page is the live executor's page (Davies, 2026-10-02), PAPER, on its simulated account: the same figures as the
      // live fixture's page (the pr5-page checks work them by hand), and a line saying what it is.
      await twinRow.first().click();
      await page.waitForSelector('.ag-quotes-twin-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const tp = await readQuotesBookPage(page, '.ag-quotes-twin-detail');
      await shot(page, 'agents-quotes-twin');
      const TWIN_DAYS = ['17 Sep · today | 18 | 3 | 2 · 50 % won | -£0.0633', '16 Sep | 6 | 2 | 1 · 100 % won | +£0.0288'];
      const TWIN_TRIPS = ['17 Sep 21:00 24-hour stop | USDT/GBP | bought | 0.3 % | £0.7556 | £0.7550 | 132.00 USDT | £0.0897 | -£0.1689',
        '17 Sep 11:30 | USDC/GBP | bought | 0.1 % | £0.7568 | £0.7576 | 132.00 USDC | £0 | +£0.1056',
        '16 Sep 14:00 | USDT/GBP | sold | 0.1 % | £0.7580 | £0.7571 | 132.00 USDT | £0.0900 | +£0.0288'];
      if (tp && tp.title === 'Stablecoin quotes' && tp.modals === 2 && tp.head === 'PAPER Revolut X' && tp.status === 'running' && tp.tested === 'tested 1d 7h' && tp.livePages === 0 && tp.paperPage === 0
        && tp.scoreboard === 'FUNDED=£1,200 | DEPLOYED=£999.14(83.26%) | TODAY [(loss stop -£12)]=+£0.23(+0.02%) | UNREALIZED G/L=-£0.13(-0.02%) | REALIZED G/L [(incl. fees £0.18)]=-£0.03(0%)'
        && tp.twinLines.join(' / ') === '3 rungs a side at £100 · the live code on a simulated Revolut X account: an order fills only by trades through its price' && tp.warns.length === 0
        && tp.sections.join(',') === 'BOOKS,INVENTORY,DAYS,ROUND TRIPS,EXIT ORDERS,ENTRY ORDERS' && tp.cards.length === 2 && tp.cards.every((c) => c.ladder.length === 3)
        && tp.cards[0].ladder.join(' / ') === '0.1 % | £0.7569 | £0.7585 / 0.2 % | £0.7561 | held £0.7591 +£0.2112 / 0.3 % | £0.7553 | £0.7600'
        && tp.balances.join('|') === 'GBP|£600.70|USDC|263.64 USDC · £199.71 at £0.7575 -£0.0192|USDT|527.64 USDT · £399.43 at £0.7570 -£0.1138'
        && JSON.stringify(tp.days) === JSON.stringify(TWIN_DAYS) && JSON.stringify(tp.trips) === JSON.stringify(TWIN_TRIPS) && tp.exits.length === 2 && tp.entries.length === 8
        && /^as of \d{1,2} \w{3} \d{2}:\d{2} [A-Z]+ · refreshes every minute$/.test(tp.foot) && tp.overflow <= 1) {
        ok(S('agents'), "the twin's page is the live executor's, PAPER: running · tested 1d 7h, FUNDED £1,200 … REALIZED -£0.03 (incl. fees £0.18), its line (3 rungs a side at £100, the live code on a simulated account), BOOKS of three rungs, INVENTORY, DAYS 18 and 6 orders, 3 round trips, 2 exits and 8 entries");
      } else fail(S('agents'), `twin page ${JSON.stringify(tp && { ...tp, cards: tp.cards.map((c) => c.ladder.join(' / ')) })}`);
      const qHeads = await page.locator('.modal').last().locator('.modal-head-actions button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      if (qHeads.join(',') === 'Refresh,Close') ok(S('agents'), 'the twin page has the same refresh button beside close');
      else fail(S('agents'), `twin page actions ${qHeads.join(',')}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      // Rule D's twin: its own title on two lines, nine rungs a side, £1,800 and its loss stop of 1 % of it, £18.
      await twinDRow.first().click();
      await page.waitForSelector('.ag-quotes-twin-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const tdp = await readQuotesBookPage(page, '.ag-quotes-twin-detail');
      await shot(page, 'agents-quotes-twin-d');
      const RULED_LADDER = ['0.03 % | idle | idle', '0.05 % | idle | idle', '0.075 % | idle | idle', '0.1 % | £0.7569 | £0.7585', '0.125 % | idle | idle', '0.15 % | idle | idle',
        '0.2 % | £0.7561 | held £0.7591 +£0.2112', '0.25 % | idle | idle', '0.3 % | £0.7553 | £0.7600'];
      if (tdp && tdp.title === 'Stablecoin quotes variant-1' && tdp.head === 'PAPER Revolut X' && tdp.tested === 'tested 20h'
        && tdp.scoreboard === 'FUNDED=£1,800 | DEPLOYED=£999.14(55.51%) | TODAY [(loss stop -£18)]=+£0.23(+0.01%) | UNREALIZED G/L=-£0.13(-0.02%) | REALIZED G/L [(incl. fees £0.18)]=-£0.03(0%)'
        && tdp.twinLines.join(' / ') === '9 rungs a side at £50 · the live code on a simulated Revolut X account: an order fills only by trades through its price'
        && tdp.cards.length === 2 && tdp.cards.every((c) => c.ladder.length === 9) && tdp.cards[0].ladder.join(' / ') === RULED_LADDER.join(' / ') && tdp.overflow <= 1) {
        ok(S('agents'), "rule D's twin's page: \"Stablecoin quotes variant-1\", PAPER, tested 20h, FUNDED £1,800 (deployed 55.51 % of it, loss stop -£18), nine rungs a side (0.03 % … 0.3 %), the same book on its 0.1, 0.2 and 0.3 % rungs");
      } else fail(S('agents'), `rule D twin page ${JSON.stringify(tdp && { ...tdp, cards: tdp.cards.map((c) => c.ladder.join(' / ')) })}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-quotes-twin-detail').count() === 0 && await page.locator('.ag-strategies .ag-row').count() === 13) ok(S('agents'), 'closing a twin page returns to the list');
      else fail(S('agents'), 'the twin page did not close back to the list');
      // RW's paper test on Polymarket (Davies, 2026-09-24): a row of TESTING STRATEGIES, in a strategy's cells, with its
      // own badge, before RW-E and three of its variants; the fixture's figures are rwSummary's own (AGENTS_RW).
      const rwRowEl = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes') });
      const rwRowText = (await rwRowEl.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const testNames = (await page.locator('.ag-strategies-testing .ag-row .ag-name-btn').allTextContents()).map((t) => t.trim());
      const rwBadge = await rwRowEl.first().locator('.ag-venue-polymarket').count();
      if (await rwRowEl.count() === 1 && testNames.slice(-5).join('|') === 'Reward quotes|Reward quotes variant-1|Reward quotes variant-2|Reward quotes variant-3|Reward quotes variant-4' && rwBadge === 1 && /Polymarket/.test(rwRowText) && !/not in the scoreboard/.test(rwRowText)
        && /2 open · \$1,000 cap/.test(rwRowText) && /\+\$12\.50 \(\+1\.25%\)/.test(rwRowText) && /-\$1(?!\d)/.test(rwRowText) && /\+\$42 \(\+4\.20%\)/.test(rwRowText) && /every minute/.test(rwRowText)) {
        ok(S('agents'), 'RW is the testing row before RW-E and its three variants, the last rows: Polymarket, 2 open of its $1,000 cap, counted in the scoreboard, today +$12.50 (+1.25%), unrealised -$1, realised +$42 (+4.20%), every minute');
      } else fail(S('agents'), `RW row "${rwRowText}", testing rows ${testNames.join(' | ')}, Polymarket badges ${rwBadge}`);
      // RW-E, the row after RW (Davies, 2026-09-26): RW's cells read from the replay's arm, by the fixture's own figures —
      // today 7.50 on its $1,000 cap (+0.75%), unrealised −1.20 on D's No, which cost 20 × 0.34 (−17.65%), realised 23.60
      // (+2.36%). $235 is what it has at work today, in its days table, not its cap (Davies, 2026-09-26).
      // Its name is "Reward quotes variant-1", on one line, the rule it follows not on the site (Davies, 2026-09-27), and its
      // replay runs every minute (0060), as RW does.
      const rweRowEl = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes variant-1') });
      const rweRowText = (await rweRowEl.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const rweName = await nameGeometry(rweRowEl.first());
      if (await rweRowEl.count() === 1 && await rweRowEl.first().locator('.ag-venue-polymarket').count() === 1 && /1 open · \$1,000 cap/.test(rweRowText)
        && rweName.lines === 1 && rweName.fits && rweName.qual === 0
        && /\+\$7\.50 \(\+0\.75%\)/.test(rweRowText) && /-\$1\.20 \(-17\.65%\)/.test(rweRowText) && /\+\$23\.60 \(\+2\.36%\)/.test(rweRowText) && /every minute/.test(rweRowText)) {
        ok(S('agents'), 'RW-E is the testing row after RW: "Reward quotes variant-1" on one line, Polymarket, 1 open of its $1,000 cap, today +$7.50 (+0.75%), unrealised -$1.20 (-17.65%), realised +$23.60 (+2.36%), every minute');
      } else fail(S('agents'), `RW-E row "${rweRowText}", name ${JSON.stringify(rweName)}`);
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
      const rWhen = (await page.locator('.ag-rw-bar .ag-rw-when').allTextContents()).join(' ').trim();   // absent: no 30 s wait
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
        && rSections.join(',') === 'STATUS,DAYS,QUOTES,FILLS' && rMarkets === 4 && /Los Angeles/.test(rFirst) && /20 Yes/.test(rFirst)
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
      // RW-E has a row and a page of its own, so its section beside RW went (Davies, 2026-09-26), although the fixture's
      // RW still carries the replay's figures.
      const eGone = await page.locator('.ag-rw-detail .ag-rw-e').count() === 0
        && !/WITHOUT SAME-DAY|same-day markets|pre-registered as RW-E/i.test(await page.locator('.ag-rw-detail').innerText().catch(() => ''));
      if (eGone) ok(S('agents'), "RW's page has no RW-E section and no word of it");
      else fail(S('agents'), "RW's page still shows the RW-E section");
      const rHeads = await page.locator('.modal').last().locator('.modal-head-actions button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
      if (rHeads.join(',') === 'Refresh,Close') ok(S('agents'), 'the reward page has the same refresh button beside close');
      else fail(S('agents'), `reward page actions ${rHeads.join(',')}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-rw-detail').count() === 0 && await page.locator('.ag-strategies .ag-row').count() === 13) ok(S('agents'), 'closing the RW page returns to the list');
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
      if (eTitle === 'Reward quotes variant-1' && eLabels.join(',') === 'FUNDED,DEPLOYED,TODAY,UNREALIZED G/L,REALIZED G/L'
        && eSplit.join('|') === 'rewards +$23.20|orders +$0.40' && eSections.join(',') === 'STATUS,DAYS,QUOTES,FILLS'
        && eDays.length === 3 && /· today$/.test(eDays[0]) && !eDays.some((d) => /warm-up/.test(d)) && /\+\$7\.50/.test(eFirstDay)
        && eMarkets === 3 && eFills === 3 && eWarn === 0) {
        ok(S('agents'), "RW-E's page is RW's page read from its arm: its own title, realised = rewards +$23.20 + orders +$0.40, today and two closed days (no warm-up), 3 markets, 3 fills");
      } else fail(S('agents'), `RW-E page: title "${eTitle}", labels ${eLabels.join(',')}, split ${eSplit.join('|')}, sections ${eSections.join(',')}, days ${eDays.join(' | ')} (first "${eFirstDay}"), markets ${eMarkets}, fills ${eFills}, warnings ${eWarn}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-rw-detail').count() === 0 && await page.locator('.ag-strategies .ag-row').count() === 13) ok(S('agents'), 'closing the RW-E page returns to the list');
      else fail(S('agents'), 'the RW-E page did not close back to the list');
      // RW-E's variants (Davies, 2026-09-27), the last rows (x1, x4 and x5 since 2026-10-02): RW's cells read from each
      // variant's arm, here RW-E's figures to the cent (AGENTS_RWX), each name "Reward quotes variant-N" on one line.
      const xRows = [];
      for (const name of ['Reward quotes variant-2', 'Reward quotes variant-3', 'Reward quotes variant-4']) {
        const el = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, name) });
        const text = (await el.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
        const geo = await nameGeometry(el.first());
        xRows.push({ name, n: await el.count(), pm: await el.first().locator('.ag-venue-polymarket').count(), text, ...geo });
      }
      await page.locator('.ag-strategies-testing .ag-row').last().scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, 'agents-rwx-rows');
      if (xRows.every((x) => x.n === 1 && x.pm === 1 && x.lines === 1 && x.fits && x.qual === 0 && /1 open · \$1,000 cap/.test(x.text)
        && /\+\$7\.50 \(\+0\.75%\)/.test(x.text) && /-\$1\.20 \(-17\.65%\)/.test(x.text) && /\+\$23\.60 \(\+2\.36%\)/.test(x.text) && /every minute/.test(x.text))) {
        ok(S('agents'), 'RW-E\'s variants are testing rows: "Reward quotes variant-2", "-3" and "-4", each on one line, on Polymarket, 1 open of its $1,000 cap, RW-E\'s figures, every minute');
      } else fail(S('agents'), `variant rows ${JSON.stringify(xRows)}`);
      // A variant's page is RW's page read from its arm: its title, RW-E's figures, no warning while both checks hold.
      await page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes variant-3') }).first().click().catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      const xTitle = ((await page.locator('.modal .modal-title').last().textContent().catch(() => '')) || '').trim();
      const xSplit = (await page.locator('.ag-rw-detail .ag-scoreboard-sm .ag-sb-split-line').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const xSections = (await page.locator('.ag-rw-detail .ag-section-title').allTextContents()).map((t) => t.trim());
      const xMarkets = await page.locator('.ag-rw-markets tbody tr').count();
      const xFills = await page.locator('.ag-rw-fills tbody tr').count();
      const xWarn = await page.locator('.ag-rw-detail .ag-warn-line').count();
      const xOverflow = await page.locator('.ag-rw-detail').evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => -1);
      await shot(page, 'agents-rwx');
      if (xTitle === 'Reward quotes variant-3' && xSplit.join('|') === 'rewards +$23.20|orders +$0.40' && xSections.join(',') === 'STATUS,DAYS,QUOTES,FILLS'
        && xMarkets === 3 && xFills === 3 && xWarn === 0 && xOverflow >= 0 && xOverflow <= 1) {
        ok(S('agents'), "a variant's page is RW's page read from its arm: its own title, realised = rewards +$23.20 + orders +$0.40, 3 markets, 3 fills, no warning");
      } else fail(S('agents'), `variant page: title "${xTitle}", split ${xSplit.join('|')}, sections ${xSections.join(',')}, markets ${xMarkets}, fills ${xFills}, warnings ${xWarn}, overflow ${xOverflow}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-rw-detail').count() === 0 && await page.locator('.ag-strategies .ag-row').count() === 13) ok(S('agents'), "closing a variant's page returns to the list");
      else fail(S('agents'), "a variant's page did not close back to the list");
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
      // Five Revolut X: the three strategies and the two realistic twins; then RW, RW-E and its three variants on the page on Polymarket, last.
      if (revxRows === 5 && binanceRows === 3 && badges.slice(-7, -5).join('|') === 'Revolut X|Revolut X' && badges.slice(-5).join('|') === Array(5).fill('Polymarket').join('|')) ok(S('agents'), 'venue badge on every row: 3 Revolut X strategies, their 3 paper twins on Binance, the two realistic twins on Revolut X, and RW, RW-E and its three variants on Polymarket');
      else fail(S('agents'), `venue badges: ${badges.join(' | ')}`);
      // Deployed value, by card: Revolut X $2,659.23 (its strategy, $21.50, plus each twin's every pound at work, £999.14
      // at 1.32, $1,318.86: Davies, 2026-10-01) and RW, RW-E and its three variants on Polymarket $252.40 (what each holds
      // and its quotes tie up: 73.20 + 4 × 44.80) — 91 % and 9 % of $2,911.63 (91.3 % and 8.7 %, each to the nearest whole).
      // The bar shows the venue and its percent when that line fits the slice, the percent alone when only that fits, and
      // nothing when not even the percent does (the title still says it). A fixed cutoff left the middle of "Polymarket"
      // on a slice that was still a bit wider than the cutoff, and a 2 % slice on a phone the middle of "2%".
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
        && shareGeom[1].text === '' && /Revolut X: 91%/.test(shareGeom[0].title) && /Polymarket: 9%/.test(shareGeom[2].title)
        && shareGeom.filter((g) => g.text).every((g) => g.lines === 1 && g.textW <= g.box + 1);
      if (shareOk) ok(S('agents'), `share bar fits its slices (${shareGeom.map((g) => g.text || '·').join(' | ')})`);
      else fail(S('agents'), `share bar ${JSON.stringify(shareGeom)}`);
      // A slice squeezed narrower than its name drops the name. The old cutoff still painted "Revolut X 89%" at 48px.
      const squeeze = await page.addStyleTag({ content: '.ag-share-revx{width:48px!important;max-width:48px!important;flex:0 0 48px!important;}' });
      const squeezed = await page.waitForFunction(() => (document.querySelector('.ag-share-revx')?.textContent || '').trim() === '91%', { timeout: 2000 }).then(() => true).catch(() => false);
      const squeezedFit = await page.locator('.ag-share-revx').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()];
        return { text: (el.textContent || '').trim(), w: rects.reduce((m, r) => Math.max(m, r.width), 0), box: el.clientWidth, lines: rects.length };
      }).catch(() => ({ text: '', w: 0, box: 0, lines: 0 }));
      await squeeze.evaluate((el) => el.remove());
      if (squeezed && squeezedFit.text === '91%' && squeezedFit.lines === 1 && squeezedFit.w <= squeezedFit.box + 1) ok(S('agents'), 'a slice too narrow for its name shows the percent alone, and that percent fits');
      else fail(S('agents'), `squeezed share ${JSON.stringify(squeezedFit)}`);
      // A slice too narrow even for its percent paints nothing, and its title still gives it.
      const pinch = await page.addStyleTag({ content: '.ag-share-polymarket{width:6px!important;max-width:6px!important;flex:0 0 6px!important;}' });
      const pinched = await page.waitForFunction(() => (document.querySelector('.ag-share-polymarket')?.textContent || '').trim() === '', { timeout: 2000 }).then(() => true).catch(() => false);
      const pinchedTitle = await page.locator('.ag-share-polymarket').getAttribute('title').catch(() => '');
      await pinch.evaluate((el) => el.remove());
      if (pinched && pinchedTitle === 'Polymarket: 9% of deployed value') ok(S('agents'), 'a slice too narrow for its percent paints nothing, and its title still says Polymarket: 9%');
      else fail(S('agents'), `pinched share: blank ${pinched}, title "${pinchedTitle}"`);
      const cards = await page.locator('.ag-venue-card').count();
      if (cards === 3) ok(S('agents'), 'one venue card per venue TESTING trades on: Revolut X, Binance, Polymarket');
      else fail(S('agents'), `venue cards ${cards}`);
      // Polymarket's card is its tests summed (Davies, 2026-09-24: Polymarket in TESTING's venues; 2026-09-26: RW-E is a
      // row of its own; 2026-09-27: so are its variants, three of them on the page since 2026-10-02; RW-C is not a row
      // before its warm-up), so it reads what TESTING's scoreboard adds for it: funded their five $1,000 caps; deployed,
      // what each holds and its quotes tie up (Davies, 2026-10-01), 14.40 + 58.80 + 4 × (5.60 + 39.20) = 252.40 (5.05 % of
      // 5,000); today 12.50 + 4 × 7.50 = 42.50 (0.85 %); unrealised −1 − 4 × 1.20 = −5.80 on the
      // inventories' cost, 15.40 of RW's (A's 20 Yes at 43¢, D's 20 No at 34¢) and 6.80 of each of the four after it (D's):
      // −5.80 on 42.60; realised 42 + 4 × 23.60 = 136.40 (2.73 %) = rewards 41.60 + 4 × 23.20 and orders 0.40 + 4 × 0.40.
      // The first version kept RW's card and dropped RW-E's.
      const pm = await readAgentsPanel(page).then((p) => p.venues.find((v) => v.id === 'polymarket'));
      if (pm && pm.meta === '5 strategies' && pm.pairs['funded (Paper)'] === '$5,000' && pm.pairs.deployed === '$252.40 (5.05%)'
        && pm.pairs.today === '+$42.50 (+0.85%)' && pm.pairs.unrealised === '-$5.80 (-13.62%)' && pm.pairs.realised === '+$136.40 (+2.73%)' && !pm.bases.unrealised
        && pm.pairs.rewards === '+$134.40' && pm.pairs.orders === '+$2' && !('fees' in pm.pairs) && pm.subs.join('|') === 'rewards+12|orders+12') {
        ok(S('agents'), "Polymarket's card is RW, RW-E and its three variants summed: funded (Paper) $5,000, deployed $252.40 (5.05%), today +$42.50 (+0.85%), unrealised -$5.80 (-13.62%), realised +$136.40 (+2.73%) = rewards +$134.40 + orders +$2");
      } else fail(S('agents'), `Polymarket card ${JSON.stringify(pm)}`);
      const revxApart = await page.locator('.ag-venue-card-revx .ag-venue-apart').count();
      if (revxApart === 0) ok(S('agents'), 'the Revolut X card no longer leaves Stablecoin quotes out');
      else fail(S('agents'), `Revolut X card still has an apart note (${revxApart})`);
      // Funded (Paper) is the capital the venue's rows are allotted — 100 + 40 + 40 of strategies, plus the twins' £1,200
      // and £1,800 at 1.32, $1,584 and $2,376 — and the accounts' real balances are NOT shown.
      const funded = await page.locator('.ag-venue-card-revx .ag-venue-grid').textContent().catch(() => '');
      const fundedCell = await page.locator('.ag-venue-card-revx .ag-venue-col > span:has-text("funded (Paper)") + span').textContent().catch(() => '');
      if (money(fundedCell) === 4140 && !/\$100\.00 USD/.test(funded || '')) ok(S('agents'), 'the Revolut X card is funded with its strategies plus the two twins ($4,140), not the account balance');
      else fail(S('agents'), `revx funded cell "${fundedCell}", card reads "${funded}"`);
      const bnCard = await page.locator('.ag-venue-card-binance .ag-venue-grid').textContent().catch(() => '');
      const bnFundedCell = await page.locator('.ag-venue-card-binance .ag-venue-col > span:has-text("funded (Paper)") + span').textContent().catch(() => '');
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
      if (nexts.length === rows && nexts.filter((t) => t === '2h 13m').length === rows - 7 && nexts.slice(rows - 7).every((t) => t === 'every minute')) ok(S('agents'), 'every rule counts down to its next bar close; the two twins, RW, RW-E and its three variants decide every minute');
      else fail(S('agents'), `next column: ${nexts.join(' | ')}`);
      const names = await page.locator('.ag-row .ag-name-btn').allTextContents();
      const subs = await page.locator('.ag-row .ag-name-cell .hl-sub').allTextContents();
      // A name no longer says its venue (Davies, 2026-09-26): each rulebook is its name on Revolut X and on Binance, and
      // the venue column tells the two apart.
      const named = await page.locator('.ag-row').evaluateAll((els) => els.map((r) => [
        (r.querySelector('.ag-name-btn')?.textContent || '').trim(), (r.querySelector('.ag-venue')?.textContent || '').trim()]));
      const wantNamed = ['Trend 4h', 'Trend 1h', 'Momentum 30d'].flatMap((n) => [[n, 'Revolut X'], [n, 'Binance']]);
      const gone = /Dislocation|Rotation|Kraken/;
      const venueInName = /·\s*(Revolut X|Binance|Kraken|Polymarket)/;
      if (wantNamed.every(([n, v]) => named.filter(([a, b]) => a === n && b === v).length === 1) && !named.some(([a]) => gone.test(a) || venueInName.test(a))
        && subs.length === names.length && subs.every((t) => /^\d+ open · /.test(t))) {
        ok(S('agents'), 'every running rulebook is named on its row, once a venue, with no venue in the name and its sub-line — and every retired one is off the page');
      } else fail(S('agents'), `names ${JSON.stringify(named)}; sub-lines ${subs.join(' | ')}`);
      // Deployed, immediately right of Venue, is the scoreboard's DEPLOYED in dollars: the rows add up to it.
      const depSel = vpWidth > 760 ? 'td.ag-col-deployed .ag-deployed' : '.ag-card-strategy .ag-deployed';
      const depHeads = vpWidth > 760 ? (await page.locator('.ag-strategies thead th').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()) : [];
      const depCells = (await page.locator(depSel).allTextContents()).map((t) => t.trim());
      // A row in pounds (a stablecoin twin's, £999.14) adds its dollars, $1,318.86: its pounds are its dollars over 1.32.
      // The reward rows' cells are what each holds and its quotes tie up: RW $73.20, RW-E and its two variants $44.80.
      const depSum = Math.round(depCells.reduce((a, t) => a + (/£/.test(t) ? (t === '£999.14' ? 999.139417255 * 1.32 : NaN) : money(t)), 0) * 100);
      const sbDep = await page.locator('.ag-modepanel > .ag-scoreboard .ag-sb-cell-deployed .sb-value').textContent().catch(() => '');
      const sbDepUsd = Math.round(money(String(sbDep).split('(')[0]) * 100);
      // From $1,000 the scoreboard writes whole dollars, so there the sum is compared to the dollar.
      const depSumShown = sbDepUsd >= 100000 ? Math.round(depSum / 100) * 100 : depSum;
      const depHeadOk = vpWidth <= 760 || (depHeads[1] === 'Venue' && depHeads[2] === 'Deployed');
      if (vpWidth > 760) {
        const thBases = await page.locator('.ag-strategies .ag-th-base').count();
        const headLine = depHeads.join('|');
        const wantHeads = 'Strategy|Venue|Deployed|Today|Unrealised G/L|Realised G/L|Next';
        if (thBases === 0 && headLine === wantHeads) ok(S('agents'), 'the strategy table heading is the column name alone, with no "% of …" under it');
        else fail(S('agents'), `heading bases ${thBases}, heads ${headLine}`);
      }
      const trendDep = (await page.locator('.ag-row', { has: nameBtn(page, 'Trend 4h') }).filter({ has: page.locator('.ag-venue-revx') }).locator('.ag-deployed').first().textContent().catch(() => '')).trim();
      if (depHeadOk && depCells.length === rows && depSumShown === sbDepUsd && trendDep === '$21.50') {
        ok(S('agents'), `Deployed sits beside Venue and adds up to the scoreboard ($${(sbDepUsd / 100).toFixed(2)}); Trend 4h is $21.50`);
      } else fail(S('agents'), `deployed heads ${depHeads.join(' | ')}, cells ${depCells.join(' | ')} (sum ${depSum}) vs scoreboard ${sbDepUsd}, trend "${trendDep}"`);
      const tableScroll = vpWidth > 760 ? await page.locator('.ag-strategies .hl-scroll').evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => 0) : 0;
      if (tableScroll <= 0) ok(S('agents'), vpWidth > 760 ? `the strategy table fits its width on desktop (overflow ${tableScroll}px)` : 'no table to overflow on a phone');
      else fail(S('agents'), `the strategy table overflows by ${tableScroll}px at ${vpWidth}px`);
      // By NAME, not by index: a migration that adds a row must not silently point this at a different strategy.
      await page.locator('.ag-row', { has: nameBtn(page, 'Trend 4h') }).filter({ has: page.locator('.ag-venue-revx') }).first().click();
      await page.waitForSelector('.ag-detail', { timeout: 5_000 });
      const title = await page.locator('.ag-detail-title').first().textContent().catch(() => '');
      if ((title || '').trim() === 'Trend 4h') ok(S('agents'), `the row with a book opens its detail (${(title || '').trim()})`);
      else fail(S('agents'), `detail title "${title}"`);
      // Its venue is a tag beside PAPER (Davies, 2026-09-26), in the venue's own colours, as on its row.
      const headTags = await page.locator('.ag-detail .ag-detail-head').first().evaluate((h) => [...h.children].slice(0, 2).map((c) => [c.className, (c.textContent || '').trim()])).catch(() => []);
      if (headTags.length === 2 && /ag-badge-paper/.test(headTags[0][0]) && /ag-venue-revx/.test(headTags[1][0]) && headTags[1][1] === 'Revolut X') {
        ok(S('agents'), 'the strategy page says PAPER, then Revolut X in its colours');
      } else fail(S('agents'), `strategy page head ${JSON.stringify(headTags)}`);
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
      // Mode beside Venue (Davies, 2026-09-27).
      const want = ['When', 'Symbol', 'Venue', 'Mode', 'Side', 'Price', 'Size', 'Cost', 'State', 'Fill', 'Fee'];
      const arrows = await page.locator('.ag-fills tbody .ag-side .ag-side-mark').count();
      const oldSideBadges = await page.locator('.ag-fills tbody .txn-badge').count();
      // The row's fourth cell holds the mode badge, beside the venue's.
      const modeBeside = await page.locator('.ag-fills tbody tr').first().locator('td').nth(3).locator('.ag-badge').count();
      if (heads.length === 11 && heads.slice(1).join(',') === want.slice(1).join(',') && /^When \((BST|GMT)\)$/.test(heads[0] || '') && arrows === ordRowsN && oldSideBadges === 0 && modeBeside === 1) {
        ok(S('agents'), `the ORDERS table, moved under the chart: Cost for Notional, the chart's arrow for the side badge, UK local time ("${heads[0]}")`);
      } else fail(S('agents'), `order table headers: ${heads.join(' | ')}; arrows ${arrows}, old badges ${oldSideBadges}, mode beside venue ${modeBeside}`);
      const restingState = await page.locator('.ag-fills tbody tr').first().locator('.ag-state-pill').textContent().catch(() => '');
      // The venue's "new" reads "open" (Davies, 2026-10-02).
      if ((restingState || '').trim() === 'open') ok(S('agents'), 'the resting order is on the table with its state, "open"');
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
      await page.locator('.ag-row', { has: nameBtn(page, 'Trend 4h') }).filter({ has: page.locator('.ag-venue-revx') }).first().click();
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
      await page.locator('.ag-row', { has: nameBtn(page, 'Reward quotes') }).first().click({ timeout: 5_000 }).catch(() => {});
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
      // RW-E (Davies, 2026-09-26) adds its fixture's figures to TESTING: 5.60 deployed, +7.50 today, −1.20 unrealised, +23.60
      // realised; and each Reward quotes row is funded $1,000 (the same day). The three variants on the page (x1 since
      // 2026-09-27, x4 and x5 since 2026-10-02) add RW-E's figures three times more; RW-C is not a row before its warm-up.
      // The two realistic twins (2026-10-02) are the live fixture's book at 1.32 each: funded $1,584 and $2,376, deployed
      // $1,318.86, today +$0.29978, unrealised -$0.17550 on a cost of $791.04, realised -$0.04555, fees $0.23721.
      // Funded 360 + 1,584 + 2,376 + 5,000 = $9,320; deployed every dollar at work (Davies, 2026-10-01), the strategy's
      // 21.50, the twins' 2 × 1,318.86 and the reward rows' holdings and quotes, 252.40: 2,911.63 (31.24 %). Today 0.42 +
      // 0.60 + 12.50 + 4 × 7.50 = 43.52 is 0.47 %; realised 12.34 - 0.09 + 42 + 4 × 23.60 = 148.65 is 1.59 %; unrealised
      // 1.50 - 0.35 - 1 - 4 × 1.20 = -4.65 is on the strategies' and twins' cost and what the reward tests hold, 20 +
      // 1,582.07 + 14.40 + 4 × 5.60 = 1,638.87 (-0.28 %); fees 0.08 + 2 × 0.23721 = 0.55.
      const PAPER_SB = 'FUNDED=$9,320 | DEPLOYED=$2,912(31.24%) | TODAY=+$43.52(+0.47%) | UNREALIZED G/L=-$4.65(-0.28%) | REALIZED G/L [(incl. fees $0.55)]=+$148.65(+1.59%)';
      const LIVE_SB = 'FUNDED=$50 | DEPLOYED=$12.50(25%) | TODAY=+$0.20(+0.40%) | UNREALIZED G/L=+$0.50(+4.17%) | REALIZED G/L [(incl. fees $0.03)]=+$0.30(+0.60%)';
      const TESTING_BAR = 'TESTING 13 Paper paper';
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
      if (n2.rows.length === 13 && sbText(n2) === sbText(n0) && JSON.stringify(n2.venues) === JSON.stringify(n0.venues)) ok(T('none'), 'a click back: TESTING\'s 13 rows, scoreboard and venue cards as they were');
      else fail(T('none'), `TESTING after the round trip: ${n2.rows.length} rows, ${sbText(n2)}`);
      if (n1.modalHeight === winH && n2.modalHeight === winH) ok(T('size'), `LIVE and TESTING keep one window, ${winH}px tall, empty or full`);
      else fail(T('size'), `window ${n1.modalHeight}px on LIVE, ${n2.modalHeight}px on TESTING, wanted ${winH}px`);
      // How long each has been under test, to the hour, on the pinned clock: the fixture's own starts (a row's creation, the
      // quotes' first minute, RW's first day, a variant's first minute). RW-C's, in its warm-up, is its own mode's check.
      const TESTED = { 'Trend 4h': 'tested 3d 5h', 'Stablecoin quotes': 'tested 1d 7h', 'Stablecoin quotes variant-1': 'tested 20h', 'Reward quotes': 'tested 2d 23h', 'Reward quotes variant-1': 'tested 2d 23h', 'Reward quotes variant-3': 'tested 20h' };
      const listTags = await page.evaluate(() => [...document.querySelectorAll('.ag-modepanel .ag-badge, .ag-modepanel .ag-venue')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => Math.round(r.height * 10) / 10));
      if (listTags.length >= 1 && Math.max(...listTags) - Math.min(...listTags) <= 0.5) ok(T('tags'), `the list's ${listTags.length} tags are all ${listTags[0]}px tall`);
      else fail(T('tags'), `the list's tag heights ${listTags.join(',')}`);
      for (const [name, venue, sel] of [['Trend 4h', 'revx', '.ag-detail'], ['Stablecoin quotes', 'revx', '.ag-quotes-twin-detail'], ['Stablecoin quotes variant-1', 'revx', '.ag-quotes-twin-detail'], ['Reward quotes', 'polymarket', '.ag-rw-detail'], ['Reward quotes variant-1', 'polymarket', '.ag-rw-detail'], ['Reward quotes variant-3', 'polymarket', '.ag-rw-detail']]) {
        await page.locator('.ag-modepanel .ag-row', { has: nameBtn(page, name) }).filter({ has: page.locator(`.ag-venue-${venue}`) }).first().click();
        await page.waitForSelector(sel, { timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(350);
        const h = await topModalHeight();
        if (h === winH) ok(T('size'), `${name}'s page opens in the same window, ${h}px`);
        else fail(T('size'), `${name}'s page is ${h}px tall, the list ${winH}px`);
        // Every page carries its venue's tag beside its PAPER badge (Davies, 2026-09-26).
        const tags = await page.locator(`${sel} .ag-detail-head`).last().evaluate((hd) => [...hd.children].slice(0, 2).map((c) => c.className)).catch(() => []);
        if (tags.length === 2 && /ag-badge-paper/.test(tags[0]) && tags[1].includes(`ag-venue-${venue}`)) ok(T('venue-tag'), `${name}'s page: PAPER, then its venue`);
        else fail(T('venue-tag'), `${name}'s page head ${JSON.stringify(tags)}`);
        // How long it has been under test, after "running", on the status's own line and inside the page (Davies, 2026-09-28).
        const head = await page.locator(`${sel} .ag-detail-head`).last().evaluate((hd) => {
          const st = hd.querySelector('.ag-status-text'), t = hd.querySelector('.ag-tested');
          if (!st || !t) return { text: t ? (t.textContent || '').trim() : null };
          const a = st.getBoundingClientRect(), b = t.getBoundingClientRect();
          return { text: (t.textContent || '').trim(), status: (st.textContent || '').trim(), dy: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2), gap: b.left - a.right, right: b.right, vw: document.documentElement.clientWidth };
        }).catch(() => ({ text: null }));
        if (head.text === TESTED[name] && head.status === 'running' && head.dy < 2 && head.gap >= 4 && head.gap <= 24 && head.right <= head.vw) ok(T('tested'), `${name}'s page: "running · ${head.text}" on one line`);
        else fail(T('tested'), `${name}'s page: ${JSON.stringify(head)}, wanted "${TESTED[name]}"`);
        // Every mode tag and venue tag on the page, the head's and the tables', is one height.
        const tagH = await page.evaluate((scope) => [...document.querySelectorAll(`${scope} .ag-badge, ${scope} .ag-venue`)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => Math.round(r.height * 10) / 10), sel);
        if (tagH.length >= 2 && Math.max(...tagH) - Math.min(...tagH) <= 0.5) ok(T('tags'), `${name}'s page: its ${tagH.length} mode and venue tags are all ${tagH[0]}px tall`);
        else fail(T('tags'), `${name}'s page: tag heights ${tagH.join(',')}`);
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
      if (a0.rows.length === 1 && lr.name === 'Trend 4h' && lr.badges === 0 && lr.venue === 'Revolut X' && lr.sub === '1 open · $50 cap'
        && lr.gl.join(' | ') === '+$0.20 (+0.40%) | +$0.50 (+4.17%) | +$0.30 (+0.60%)' && sbText(a0) === LIVE_SB && a0.sections.join('|') === 'LIVE STRATEGIES') {
        ok(T('armed'), `LIVE is the live row alone, named without " · live", and its scoreboard is that row's figures (${sbText(a0)})`);
      } else fail(T('armed'), `LIVE: rows ${JSON.stringify(a0.rows)}, scoreboard ${sbText(a0)}, sections ${a0.sections.join('|')}`);
      const lv = a0.venues[0];
      if (a0.venues.length === 1 && lv.id === 'revx' && lv.meta === '1 strategy · maker 0% / taker 0.09%' && lv.pairs.funded === '$50' && lv.pairs.deployed === '$12.50 (25%)'
        && lv.pairs.today === '+$0.20 (+0.40%)' && lv.pairs.unrealised === '+$0.50 (+4.17%)' && lv.pairs.realised === '+$0.30 (+0.60%)' && lv.pairs.fees === '$0.03'
        // Fees are set in under realised, as Polymarket's rewards and orders are, and the card's two groups (Davies,
        // 2026-09-27): funded, deployed, today; unrealised, realised, fees — side by side on a desktop's wide card, one
        // under the other on a phone.
        && lv.subs.join('|') === 'fees+12'
        && lv.groups.map((g) => g.labels.join(',')).join(' | ') === 'funded,deployed,today | unrealised,realised,fees'
        && (vp.name === 'desktop' ? lv.groups[1].left > lv.groups[0].left && lv.groups[1].top === lv.groups[0].top : lv.groups[1].left === lv.groups[0].left && lv.groups[1].top > lv.groups[0].top)
        && Object.keys(lv.bases).length === 0 && a0.shareBar === 0) {
        ok(T('armed'), 'one venue card, Revolut X: funded $50 with no (Paper), maker 0% / taker 0.09%, funded, deployed and today beside unrealised, realised and fees set in under it, no percent badges, and no share bar for one venue');
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
      if (a1.rows.length === 13 && !a1.rows.some((r) => / · live$/.test(r.name) || r.badges > 0) && sbText(a1) === PAPER_SB && a1.sections.join('|') === 'TESTING STRATEGIES' && !a1.arming && a1.alerts.length === 0) {
        ok(T('armed'), `TESTING is the paper rows alone (13, none live), and its scoreboard is theirs (${sbText(a1)})`);
      } else fail(T('armed'), `TESTING: ${a1.rows.length} rows (${a1.rows.map((r) => `${r.name} ${r.badges}`).join(', ')}), scoreboard ${sbText(a1)}, armed "${a1.arming}", banners ${a1.alerts.length}`);
      const rv = a1.venues.find((v) => v.id === 'revx'), bn = a1.venues.find((v) => v.id === 'binance');
      // Revolut X on TESTING: its three strategies and the two twins, funded 180 + 1,584 + 2,376 = $4,140, deployed 21.50 +
      // 2 × 1,318.86 = 2,659.23 (64.23 %), realised 12.34 - 2 × 0.04555 = 12.25 (0.30 %).
      if (a1.venues.length === 3 && rv && bn && rv.meta === '5 strategies · maker 0% / taker 0.09%' && rv.pairs['funded (Paper)'] === '$4,140' && rv.pairs.deployed === '$2,659 (64.23%)'
        && rv.pairs.realised === '+$12.25 (+0.30%)' && rv.apart === '' && bn.pairs['funded (Paper)'] === '$180' && a1.shareBar === 1) {
        ok(T('armed'), 'TESTING\'s Revolut X card includes the two twins (funded (Paper) $4,140, deployed $2,659.23, 64.23%), beside Binance\'s and Polymarket\'s');
      } else fail(T('armed'), `TESTING venues ${JSON.stringify(a1.venues)}, share bars ${a1.shareBar}`);
      const cents = (s) => Math.round(money(String(s).split('(')[0]) * 100);
      const both = a0.scoreboard.map((c, i) => cents(c.value) + cents(a1.scoreboard[i]?.value));
      // TESTING's deployed, $2,911.63 since every dollar at work counts (Davies, 2026-10-01), is shown to the dollar from
      // $1,000: LIVE's $12.50 and the $2,912 shown make 2,924.50; funded 50 + 9,320, today 0.20 + 43.52, unrealised 0.50 -
      // 4.65, realised 0.30 + 148.65.
      if (both.join(',') === '937000,292450,4372,-415,14895') ok(T('armed'), 'LIVE and TESTING add up to every strategy plus the seven tests: $9,370.00 funded, $2,924.50 deployed as shown ($12.50 + $2,912, $2,911.63 to the cent), +$43.72 today, -$4.15 unrealised, +$148.95 realised');
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
      const dTested = ((await page.locator('.ag-detail .ag-detail-head .ag-tested').first().textContent().catch(() => '')) || '').trim();
      if (dTested === 'live 1d 2h') ok(T('tested'), 'the live row\'s page says how long it has been live: live 1d 2h');
      else fail(T('tested'), `the live row's page says "${dTested}"`);
      const dSb = (await page.locator('.ag-detail .ag-scoreboard-sm .sb-value').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const dCard = ((await page.locator('.ag-detail .ag-poscard .pc-ticker').first().textContent().catch(() => '')) || '').trim();
      const dH = await topModalHeight();
      await shot(page, 'agents-tabs-live-detail');
      if (dTitle === 'Trend 4h' && dMode === 'LIVE' && dSb.join(' | ') === '$50 | $12.50(25%) | +$0.20(+0.40%) | +$0.50(+4.17%) | +$0.30(+0.60%)' && dCard === 'ETH/USD' && dH === a0.modalHeight) {
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
      if (u1.alerts.length === 0 && sbText(u1) === PAPER_SB && u1.rows.length === 13) ok(T('unarmed'), 'TESTING carries no banner either');
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
      // AGENTS_PR5_LIVE's figures, worked by hand there.
      if (opened(p0) === 'live' && barText(p0) === `LIVE 1 Real money · trading armed / ${TESTING_BAR}` && pNames.join(',') === 'Stablecoin quotes'
        // In dollars, LIVE's adding up: £999.14 at work (£599.14 of coins at the index and £400.00 in buys), £0.227106
        // today, -£0.1330 unrealised, -£0.0345 realised with £0.1797 of fees, at 1.32.
        && sb0 === 'FUNDED=$1,584 | DEPLOYED=$1,319(83.26%) | TODAY=+$0.30(+0.02%) | UNREALIZED G/L=-$0.18(-0.02%) | REALIZED G/L [(incl. fees $0.24)]=-$0.05(0%)') {
        ok(T('pr5-live'), `PR5 trading real money is LIVE's row, and LIVE opens on it: ${sb0}`);
      } else fail(T('pr5-live'), `open ${opened(p0)}, bar ${barText(p0)}, rows ${pNames.join(',')}, scoreboard ${sb0}`);

      // ---- LIVE's "Stablecoin quotes" opens a page of its own (Davies, 2026-10-01: it opened the paper test's) -------
      // The live executor's real-money book and nothing of the paper engine's record, every figure the fixture's, worked by
      // hand (AGENTS_PR5_LIVE); its scoreboard is its LIVE row's own. A phone keeps each table's story columns.
      const readLivePage = () => readQuotesBookPage(page, '.ag-quotes-live-detail');
      const liveRowEl = page.locator('.ag-strategies-live .ag-row', { has: nameBtn(page, 'Stablecoin quotes') });
      const liveRowGl = p0.rows[0]?.gl ?? [];
      await liveRowEl.first().click();
      await page.waitForSelector('.ag-quotes-live-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const lp = await readLivePage();
      await shot(page, 'agents-quotes-live');
      // Its round trips and exits, then its entries, scrolled into view (a modal scrolls inside itself).
      for (const [sel, name] of [['.ag-ql-trips', 'agents-quotes-live-trips'], ['.ag-ql-entries', 'agents-quotes-live-entries']]) {
        await page.locator(`.ag-quotes-live-detail ${sel}`).first().scrollIntoViewIfNeeded().catch(() => {});
        await shot(page, name);
      }
      const phoneView = vpWidth <= 760;
      // Opened from LIVE, the page is the live executor's, and the paper test's is not open anywhere.
      if (lp && lp.paperPage === 0 && lp.title === 'Stablecoin quotes' && lp.modals === 2 && lp.head === 'LIVE Revolut X' && lp.status === 'running' && lp.tested === 'live 1d 14h') {
        ok(T('pr5-page'), "LIVE's Stablecoin quotes opens its own page over the list: LIVE, Revolut X, running · live 1d 14h, and the paper test's page is not open");
      } else fail(T('pr5-page'), `LIVE's Stablecoin quotes opened ${lp ? `the live page with the paper page ${lp.paperPage}× beside it, title "${lp.title}", ${lp.modals} modals, head "${lp.head}", status "${lp.status}" "${lp.tested}"` : 'no live page'}`);
      // Its scoreboard is the LIVE row's, in pounds (Davies, 2026-10-01): the same today, unrealised and realised as the
      // row it was opened from. The fixture by hand: deployed is every pound at work (Davies, 2026-10-01: "每一笔钱都quote
      // 出去了"), the coins at the index, 263.6436 USDC at £0.7575 and 527.6436 USDT at £0.7570 (£599.14), and the pounds in
      // the four resting buys (£400.00), £999.14, 83.26 % of £1,200; today is the executor's loss stop's £0.227106;
      // realised is the three trips, -£0.0345, its fees the stop's £0.0897 and D's share of the USDT conversion's fee,
      // 132 / 395.6436 of £0.2698 (£0.0900); unrealised is the coins at the index against their cost, -£0.1330.
      const sameAsRow = !!lp && liveRowGl.length === 3 && /TODAY[^=]*=([^|]+)/.exec(lp.scoreboard)?.[1].trim() === liveRowGl[0].replace(/\s+/g, '')
        && /UNREALIZED G\/L=([^|]+)/.exec(lp.scoreboard)?.[1].trim() === liveRowGl[1].replace(/\s+/g, '') && /\| REALIZED G\/L[^=]*=(.+)$/.exec(lp.scoreboard)?.[1].trim() === liveRowGl[2].replace(/\s+/g, '');
      if (lp?.scoreboard === 'FUNDED=£1,200 | DEPLOYED=£999.14(83.26%) | TODAY [(loss stop -£12)]=+£0.23(+0.02%) | UNREALIZED G/L=-£0.13(-0.02%) | REALIZED G/L [(incl. fees £0.18)]=-£0.03(0%)' && sameAsRow) {
        ok(T('pr5-page'), `its scoreboard is its LIVE row's figures, in pounds, the conversion fee D used among its fees: ${lp.scoreboard}`);
      } else fail(T('pr5-page'), `live page scoreboard "${lp?.scoreboard}", LIVE row ${JSON.stringify(liveRowGl)}`);
      // Davies, 2026-10-01: no STATUS tiles, guard lines, inventory note, conversions, FILLS or EVENTS; the paper page's
      // BOOKS in place of RUNGS, and DAYS under INVENTORY.
      if (lp && lp.sections.join(',') === 'BOOKS,INVENTORY,DAYS,ROUND TRIPS,EXIT ORDERS,ENTRY ORDERS' && lp.tiles.length === 0 && lp.guards.length === 0
        && lp.events.length === 0 && lp.notes === 0 && lp.conversions.length === 0 && lp.fills.length === 0 && lp.oldRungs === 0 && lp.oldOrders === 0) {
        ok(T('pr5-page'), 'its sections are BOOKS, INVENTORY, DAYS, ROUND TRIPS, EXIT ORDERS and ENTRY ORDERS: no STATUS, RUNGS, conversions, FILLS or EVENTS');
      } else fail(T('pr5-page'), `sections ${lp?.sections.join(',')}, tiles ${lp?.tiles.length}, guards ${lp?.guards.length}, events ${lp?.events.length}, notes ${lp?.notes}, conversions ${lp?.conversions.length}, fills ${lp?.fills.length}, rungs ${lp?.oldRungs}, one ORDERS table ${lp?.oldOrders}`);
      // BOOKS: each rung's live order, or what it holds at its entry with what that has made in pounds at the index, as the
      // account marks it: B sold 132 USDC at £0.7591 (+£0.2112 at £0.7575), E bought 132 USDT at £0.7565 (+£0.0660 at
      // £0.7570); USDT/GBP's guard withdrew its entries. Each book's realised: A's +£0.1056; C's -£0.1689 and D's +£0.0288.
      const [cUsdc, cUsdt] = lp?.cards ?? [];
      if (lp && lp.cards.length === 2 && cUsdc.head === 'USDC/GBP' && cUsdc.meta === 'last trade £0.7576 · fair £0.7577 · index £0.7575'
        && cUsdc.ladder.join(' / ') === '0.1 % | £0.7569 | £0.7585 / 0.2 % | £0.7561 | held £0.7591 +£0.2112 / 0.3 % | £0.7553 | £0.7600'
        && cUsdc.grid.join('|') === 'round trips|1 · 100 % won|realised|+£0.1056'
        && cUsdt.head === 'USDT/GBP' && cUsdt.meta === 'last trade £0.7572 · fair £0.7573 · index £0.7570'
        && cUsdt.ladder.join(' / ') === '0.1 % | held £0.7565 +£0.0660 | idle / 0.2 % | idle | idle / 0.3 % | idle | idle'
        && cUsdt.grid.join('|') === 'round trips|2 · 50 % won|realised|-£0.1401') {
        ok(T('pr5-page'), 'BOOKS: the paper page\'s ladders, each rung\'s live order or holding at the index (+£0.2112, +£0.0660), and each book\'s realised in pounds');
      } else fail(T('pr5-page'), `books ${JSON.stringify(lp?.cards)}`);
      // INVENTORY: each coin in pounds at the index and against its cost. USDC: B's +£0.2112 and the conversion's 395.6436
      // × (0.7575 − 0.7574) less its £0.2699 fee, -£0.0192; USDT: E's +£0.0660 and 395.6436 × (0.7570 − 0.7570) less the
      // £0.1798 of its fee D has not taken, -£0.1138. Together the scoreboard's UNREALIZED, -£0.1330.
      if (lp && lp.balances.join('|') === 'GBP|£600.70|USDC|263.64 USDC · £199.71 at £0.7575 -£0.0192|USDT|527.64 USDT · £399.43 at £0.7570 -£0.1138') {
        ok(T('pr5-page'), 'INVENTORY: £600.70, 263.64 USDC (£199.71 at the index £0.7575, -£0.0192) and 527.64 USDT (£399.43 at £0.7570, -£0.1138), each coin against what it cost');
      } else fail(T('pr5-page'), `balances ${JSON.stringify(lp?.balances)}`);
      // DAYS: today 18 orders, 3 entry fills, A and C closed (-£0.0633); 16 Sep 6 orders (the conversions among them), 2
      // entry fills, D (+£0.0288). They add up to REALIZED, -£0.0345.
      const DAYS = ['17 Sep · today | 18 | 3 | 2 · 50 % won | -£0.0633', '16 Sep | 6 | 2 | 1 · 100 % won | +£0.0288'];
      if (lp && JSON.stringify(lp.days) === JSON.stringify(DAYS)) ok(T('pr5-page'), `DAYS under INVENTORY: ${lp.days.join(' / ')}, which add up to REALIZED`);
      else fail(T('pr5-page'), `days ${JSON.stringify(lp?.days)}`);
      // ROUND TRIPS: D's fees are its share of the USDT conversion's fee and its P&L carries it (+£0.1188 − £0.0900).
      const TRIPS = ['17 Sep 21:00 24-hour stop | USDT/GBP | bought | 0.3 % | £0.7556 | £0.7550 | 132.00 USDT | £0.0897 | -£0.1689',
        '17 Sep 11:30 | USDC/GBP | bought | 0.1 % | £0.7568 | £0.7576 | 132.00 USDC | £0 | +£0.1056',
        '16 Sep 14:00 | USDT/GBP | sold | 0.1 % | £0.7580 | £0.7571 | 132.00 USDT | £0.0900 | +£0.0288'];
      const tripsSum = (lp?.trips ?? []).reduce((a, r) => a + Number(/([+-])£([\d.]+)$/.exec(r)?.slice(1).join('') ?? NaN), 0);
      if (lp && JSON.stringify(lp.trips) === JSON.stringify(TRIPS) && Math.abs(tripsSum - -0.0345) < 1e-9) {
        ok(T('pr5-page'), `ROUND TRIPS in pounds, D's conversion fee in its fees and its P&L; they add up to REALIZED's -£0.03 (${tripsSum.toFixed(4)})`);
      } else fail(T('pr5-page'), `round trips ${JSON.stringify(lp?.trips)}, sum ${tripsSum}`);
      // EXIT ORDERS above ENTRY ORDERS (Davies, 2026-10-01), less the orders of the three round trips already closed
      // (2026-10-02: they are in ROUND TRIPS): the exits B and E have resting, then the eight entries left, B's and E's
      // filled ones among them, newest first; the two conversions in neither; each side buy or sell alone; a resting order
      // "open"; its six cancels that filled nothing left out where they are read. Times are UK (BST).
      const EXITS = ['17 Sep 23:01 | USDT/GBP | bid 0.1 % | sell | £0.7573 | 132.00 USDT | open',
        '17 Sep 21:01 | USDC/GBP | ask 0.2 % | buy | £0.7576 | 132.00 USDC | open'];
      const order114 = '17 Sep 23:30 | USDC/GBP | bid 0.1 % | buy | £0.7570 | 132.10 USDC | rejected | refused by the venue: post-only order would cross the book';
      const order119 = '17 Sep 23:31 | USDC/GBP | ask 0.3 % | sell | £0.7600 | 131.58 USDC | open';
      const ENTRY_HELD = ['17 Sep 22:30 | USDT/GBP | bid 0.1 % | buy | £0.7565 | 132.00 USDT | filled', '17 Sep 20:30 | USDC/GBP | ask 0.2 % | sell | £0.7591 | 132.00 USDC | filled'];
      const orderSides = [...(lp?.exits ?? []), ...(lp?.entries ?? [])].map((r) => r.split(' | ')[3]);
      // Side is no wider than the widest of the table's other columns.
      const sideFits = (lp?.colWidths ?? []).every((cols) => {
        const side = cols.find((c) => c[0] === 'Side')?.[1] ?? Infinity;
        return side <= Math.max(...cols.filter((c) => c[0] !== 'Side').map((c) => c[1]));
      });
      if (lp && JSON.stringify(lp.exits) === JSON.stringify(EXITS) && lp.entries.length === 8 && lp.entries[0] === order119 && lp.entries.includes(order114)
        && JSON.stringify(lp.entries.slice(-2)) === JSON.stringify(ENTRY_HELD) && !lp.entries.some((r) => / \| new$/.test(r))
        && orderSides.every((x) => x === 'buy' || x === 'sell') && ![...lp.exits, ...lp.entries].some((r) => /conversion|convert/.test(r))
        && !lp.entries.some((r) => / \| cancelled( \||$)/.test(r)) && lp.sizeShown.join(',') === 'true,true,true' && sideFits && lp.liveTablesOverflow <= 1
        && /^as of \d{1,2} \w{3} \d{2}:\d{2} [A-Z]+ · refreshes every minute$/.test(lp.foot) && lp.overflow <= 1
        // The refusal's reason, a line of its own inside the screen; on a desk no table runs past its box.
        && lp.subs === 1 && lp.subsOff === 0 && (phoneView || lp.tableOverflow <= 1)) {
        ok(T('pr5-page'), `EXIT ORDERS (B's and E's resting exits) above ENTRY ORDERS (8: no closed trip's order, no empty cancel, no conversion), a resting order "open", each side buy or sell alone and no wider than the other columns (${JSON.stringify(lp.colWidths[1])}); Size shown in both and in ROUND TRIPS, all three inside the screen; the refusal's reason under it; nothing wider than the page${phoneView ? '' : ' or than its table\'s box'}`);
      } else fail(T('pr5-page'), `exits ${JSON.stringify(lp?.exits)}, entries ${lp?.entries.length} first "${lp?.entries[0]}" has 114 ${lp?.entries.includes(order114)}, sides ${JSON.stringify([...new Set(orderSides)])}, size shown ${lp?.sizeShown}, trips and orders past their boxes by ${lp?.liveTablesOverflow}px, widths ${JSON.stringify(lp?.colWidths)}, foot "${lp?.foot}", overflow ${lp?.overflow}, tables ${lp?.tableOverflow}, reasons ${lp?.subs} (${lp?.subsOff} off screen)`);
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-quotes-live-detail').count() === 0 && await page.locator('.ag-strategies-live .ag-row').count() === 1) ok(T('pr5-page'), 'closing it returns to LIVE');
      else fail(T('pr5-page'), 'the live page did not close back to LIVE');
      // With no exit order among its newest, the page has no EXIT ORDERS at all: ENTRY ORDERS follows ROUND TRIPS.
      agentsMode = 'pr5-live-noexit';
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await openAgentsPage(page);
      await waitFor(async () => (await page.locator('#ag-modetab-live .ag-modetab-count').textContent()) === '1');
      await page.locator('.ag-strategies-live .ag-row', { has: nameBtn(page, 'Stablecoin quotes') }).first().click();
      await page.waitForSelector('.ag-quotes-live-detail', { timeout: 5_000 }).catch(() => {});
      await waitFor(async () => (await page.locator('.ag-quotes-live-detail .ag-ql-exits').count()) === 0);
      const ln = await readLivePage();
      if (ln && ln.sections.join(',') === 'BOOKS,INVENTORY,DAYS,ROUND TRIPS,ENTRY ORDERS' && ln.exits.length === 0 && ln.entries.length === 8) {
        ok(T('pr5-page'), 'with no exit order, no EXIT ORDERS: its entries alone, under ROUND TRIPS');
      } else fail(T('pr5-page'), `no exits: sections ${ln?.sections.join(',')}, exits ${ln?.exits.length}, entries ${ln?.entries.length}`);
      agentsMode = 'pr5-live';
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(300);

      await clickTab('testing');
      const p1 = await readAgentsPanel(page);
      if (p1.rows.length === 13 && sbText(p1) === PAPER_SB) ok(T('pr5-live'), "its twin stays on TESTING, whose totals do not take the live book");
      else fail(T('pr5-live'), `TESTING rows ${p1.rows.length}, scoreboard ${sbText(p1)}`);
      // TESTING's "Stablecoin quotes" opens its twin's page (Davies, 2026-10-02), never the live executor's: PAPER, its
      // own container, its line, its two books of three rungs and the fixture's three round trips.
      await page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Stablecoin quotes') }).first().click();
      await page.waitForSelector('.ag-quotes-twin-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const pp = await readQuotesBookPage(page, '.ag-quotes-twin-detail');
      if (pp && pp.livePages === 0 && pp.twinPages === 1 && pp.head === 'PAPER Revolut X' && pp.cards.map((c) => c.head).join(',') === 'USDC/GBP,USDT/GBP' && pp.cards.every((c) => c.ladder.length === 3)
        && pp.trips.length === 3 && /^3 rungs a side at £100 · the live code on a simulated Revolut X account/.test(pp.twinLines[0] ?? '')) {
        ok(T('pr5-page'), "TESTING's Stablecoin quotes opens its twin's page, not the live executor's: PAPER, its two books of three rungs, 3 round trips, and its line");
      } else fail(T('pr5-page'), `TESTING's Stablecoin quotes: ${JSON.stringify(pp && { live: pp.livePages, twin: pp.twinPages, head: pp.head, books: pp.cards.map((c) => c.head), trips: pp.trips.length, lines: pp.twinLines })}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Under hide-values, every money figure, price and size on the live page is masked; its counts and times are not.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.locator('.hide-eye').first().click();
      await page.waitForTimeout(200);
      await openAgentsPage(page);
      await waitFor(async () => (await page.locator('#ag-modetab-live .ag-modetab-count').textContent()) === '1');
      await page.locator('.ag-strategies-live .ag-row', { has: nameBtn(page, 'Stablecoin quotes') }).first().click();
      await page.waitForSelector('.ag-quotes-live-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const hp = await readLivePage();
      const digits = (/** @type {string} */ t) => /\d/.test(t);
      const cellsAt = (/** @type {string[]} */ rows, /** @type {number[]} */ at) => rows.flatMap((r) => at.map((i) => r.split(' | ')[i] ?? ''));
      const hiddenOk = !!hp && /^FUNDED=£•,••• \| DEPLOYED=£•••\.••\(83\.26%\)/.test(hp.scoreboard) && !/[$£]\d/.test(hp.scoreboard)
        && hp.scoreboard.includes('TODAY [(loss stop -£••)]') && hp.tiles.length === 0 && hp.events.length === 0
        && !cellsAt(hp.cards.flatMap((c) => c.ladder), [1, 2]).some(digits) && !hp.cards.flatMap((c) => c.grid.slice(3)).some(digits)
        && !hp.balances.filter((_, i) => i % 2).some(digits) && !cellsAt(hp.days, [4]).some(digits)
        && !cellsAt(hp.trips, [4, 5, 6, 7, 8]).some(digits) && !cellsAt([...hp.exits, ...hp.entries], [4, 5]).some(digits) && hp.exits.length === 2
        && hp.days.length === 2 && cellsAt(hp.days, [1]).join(',') === '18,6';
      if (hiddenOk) ok(T('pr5-page'), "hide-values masks the live page's money, prices and sizes, the loss stop in its scoreboard included, and keeps its counts and times");
      else fail(T('pr5-page'), `under the mask: scoreboard "${hp?.scoreboard}", ladder ${JSON.stringify(hp?.cards?.[0]?.ladder)}, balances ${JSON.stringify(hp?.balances)}, days ${JSON.stringify(hp?.days)}, trip ${JSON.stringify(hp?.trips?.[0])}`);
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.locator('.hide-eye').first().click();                       // values shown again for everything after this
      await page.waitForTimeout(200);

      agentsMode = 'rw-cents';
      await openAgentsPage(page);
      const rwRowC = page.locator('.ag-modepanel .ag-row', { has: nameBtn(page, 'Reward quotes') });
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

      // RW-E's variants before 2026-09-28 00:00 UTC (AGENTS_RWX_WAITING): a row with nothing of its own yet has its start,
      // in UK time, where "every minute" was — two lines at most in the table's column — on a grey dot whose words say
      // "starts …"; its name stays on one line and the words fit.
      agentsMode = 'rwx-waiting';
      await openAgentsPage(page);
      await waitFor(async () => /3 Oct 01:00 BST/.test((await page.locator('.ag-strategies-testing').first().innerText().catch(() => '')) || ''));
      await page.waitForTimeout(150);
      const waitRows = [];
      const STARTS = { 'Reward quotes variant-2': '28 Sep 01:00 BST', 'Reward quotes variant-3': '3 Oct 01:00 BST', 'Reward quotes variant-4': '3 Oct 01:00 BST' };
      for (const name of Object.keys(STARTS)) {
        const el = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, name) }).first();
        const text = (await el.innerText().catch(() => '')).replace(/\s+/g, ' ');
        // A row's status is its dot: grey (paused) here, its words in its title.
        const dot = await el.locator('.ag-dot').first().evaluate((d) => ({ title: d.getAttribute('title') || '', grey: d.classList.contains('ag-dot-paused') }))
          .catch(() => ({ title: '', grey: false }));
        const next = await el.locator('.ag-next').first().evaluate((n) => {
          const range = document.createRange();
          range.selectNodeContents(n);
          return {
            text: (n.textContent || '').trim(), lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
            fits: n.scrollWidth <= n.clientWidth + 1 && n.getBoundingClientRect().right <= (n.closest('td, .ag-row')?.getBoundingClientRect().right ?? 0) + 1,
          };
        }).catch(() => ({ text: '', lines: 0, fits: false }));
        waitRows.push({ name, text, dot, next, ...(await nameGeometry(el)) });
      }
      await page.locator('.ag-strategies-testing .ag-row').last().scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, 'agents-rwx-waiting');
      if (waitRows.length === 3 && waitRows.every((x) => x.next.text === STARTS[x.name] && x.next.lines >= 1 && x.next.lines <= 2 && x.next.fits
        && x.dot.grey && x.dot.title === `starts ${STARTS[x.name]}`
        && !/every minute/.test(x.text) && x.lines === 1 && x.fits && !/\+\$7\.50|\+\$23\.60|1 open/.test(x.text))) {
        ok(T('rwx-waiting'), 'a variant before its first minute has NEXT its start ("28 Sep 01:00 BST" for variant-2, "3 Oct 01:00 BST" for variant-3 and -4; two lines at most) on a grey dot that says "starts …", none of RW-E\'s figures, and fits its row');
      } else fail(T('rwx-waiting'), `waiting rows ${JSON.stringify(waitRows)}`);
      await page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes variant-3') }).first().click().catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const wEmpty = (await page.locator('.ag-rw-detail .hl-empty').allTextContents()).map((t) => t.trim());
      const wOverflow = await page.locator('.ag-rw-detail').evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => -1);
      await shot(page, 'agents-rwx-waiting-page');
      if (wEmpty.join('|') === 'Starts 3 Oct 01:00 BST.|Starts 3 Oct 01:00 BST.|Starts 3 Oct 01:00 BST.' && wOverflow >= 0 && wOverflow <= 1) {
        ok(T('rwx-waiting'), "its page's days, quotes and fills each say when it starts, and nothing else");
      } else fail(T('rwx-waiting'), `waiting page: empty rows ${JSON.stringify(wEmpty)}, overflow ${wOverflow}`);
      agentsMode = 'ok';
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // RW-C (0069) in its warm-up (from 2026-10-08 00:00 UTC; before it the dashboard sends none, Davies 2026-09-28): the
      // last row, RW's engine again on 2026-10-09 → 10-23 UTC. Before its first minute it has nothing of its own
      // (AGENTS_RWC_WAITING), so its row is its $1,000 cap and when it starts — NEXT "9 Oct 01:00 BST", two lines at most,
      // beside a grey dot that says so — and its name fits its row: two lines on a desktop's table, one on a phone's card.
      agentsMode = 'rwc-warmup';
      await openAgentsPage(page);
      await waitFor(async () => (await page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes confirmation') }).count()) === 1);
      await page.waitForTimeout(150);
      const rwcRowEl = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes confirmation') });
      const rwcText = (await rwcRowEl.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const rwcName = await nameGeometry(rwcRowEl.first());
      const rwcDot = await rwcRowEl.first().locator('.ag-dot').first().evaluate((d) => ({ title: d.getAttribute('title') || '', grey: d.classList.contains('ag-dot-paused') }))
        .catch(() => ({ title: '', grey: false }));
      const rwcNext = await rwcRowEl.first().locator('.ag-next').first().evaluate((n) => {
        const range = document.createRange();
        range.selectNodeContents(n);
        return {
          text: (n.textContent || '').trim(), lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
          fits: n.scrollWidth <= n.clientWidth + 1 && n.getBoundingClientRect().right <= (n.closest('td, .ag-row')?.getBoundingClientRect().right ?? 0) + 1,
        };
      }).catch(() => ({ text: '', lines: 0, fits: false }));
      const lastName = (await page.locator('.ag-strategies-testing .ag-row .ag-name-btn').allTextContents()).map((t) => t.trim()).at(-1);
      await rwcRowEl.first().scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, 'agents-rwc-row');
      if (await rwcRowEl.count() === 1 && lastName === 'Reward quotes confirmation' && await rwcRowEl.first().locator('.ag-venue-polymarket').count() === 1
        && /0 open · \$1,000 cap/.test(rwcText) && rwcName.fits && rwcName.qual === 0 && rwcName.lines === (narrow ? 1 : 2)
        && rwcNext.text === '9 Oct 01:00 BST' && rwcNext.lines >= 1 && rwcNext.lines <= 2 && rwcNext.fits
        && rwcDot.grey && rwcDot.title === 'starts 9 Oct 01:00 BST' && !/every minute/.test(rwcText)) {
        ok(T('rwc-warmup'), `RW-C is the last testing row: "Reward quotes confirmation" (${rwcName.lines} line${rwcName.lines === 1 ? '' : 's'}, inside its ${narrow ? 'card' : 'cell'}), Polymarket, 0 open of its $1,000 cap, NEXT "9 Oct 01:00 BST" on a grey dot that says it starts then`);
      } else fail(T('rwc-warmup'), `RW-C row "${rwcText}" (last "${lastName}"), name ${JSON.stringify(rwcName)}, dot ${JSON.stringify(rwcDot)}, next ${JSON.stringify(rwcNext)}`);
      // Its page is RW's page read from its own summary: its title, the same scoreboard on its $1,000, the same sections,
      // and each table saying when it starts; no warning, nothing wider than the page.
      await rwcRowEl.first().click().catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const cTitle = ((await page.locator('.modal .modal-title').last().textContent().catch(() => '')) || '').trim();
      const cLabels = (await page.locator('.ag-rw-detail .ag-scoreboard-sm .ag-sb-name').allTextContents()).map((t) => t.trim());
      const cFunded = ((await page.locator('.ag-rw-detail .ag-sb-cell-funded .sb-value').textContent().catch(() => '')) || '').trim();
      const cSections = (await page.locator('.ag-rw-detail .ag-section-title').allTextContents()).map((t) => t.trim());
      const cEmpty = (await page.locator('.ag-rw-detail .hl-empty').allTextContents()).map((t) => t.trim());
      const cWarn = await page.locator('.ag-rw-detail .ag-warn-line').count();
      const cOverflow = await page.locator('.ag-rw-detail').evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => -1);
      // Its title reads whole: 8 px too wide for a 390 px phone's title line, it breaks between its words there instead of
      // losing "on" to the ellipsis, and stays one line on a desktop.
      const cTitleFit = await page.locator('.modal .modal-title').last().evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return { clipped: el.scrollWidth > el.clientWidth + 1, lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size };
      }).catch(() => ({ clipped: true, lines: 0 }));
      const cTested = await page.locator('.ag-rw-detail .ag-detail-head .ag-tested').count();
      if (cTested === 0) ok(T('rwc-warmup'), "RW-C's page says no test time before its fourteen days begin");
      else fail(T('rwc-warmup'), `RW-C's page shows ${cTested} test time(s) before its fourteen days begin`);
      await shot(page, 'agents-rwc');
      if (cTitle === 'Reward quotes confirmation' && !cTitleFit.clipped && cTitleFit.lines === (narrow ? 2 : 1)
        && cLabels.join(',') === 'FUNDED,DEPLOYED,TODAY,UNREALIZED G/L,REALIZED G/L' && cFunded === '$1,000'
        && cSections.join(',') === 'STATUS,DAYS,QUOTES,FILLS' && cEmpty.join('|') === Array(3).fill('Starts 9 Oct 01:00 BST.').join('|') && cWarn === 0
        && cOverflow >= 0 && cOverflow <= 1) {
        ok(T('rwc-warmup'), `RW-C's page before its first minute: its own title, whole (${cTitleFit.lines} line${cTitleFit.lines === 1 ? '' : 's'}), FUNDED $1,000, STATUS, DAYS, QUOTES and FILLS each saying it starts 9 Oct 01:00 BST, no warning`);
      } else fail(T('rwc-warmup'), `RW-C page: title "${cTitle}" ${JSON.stringify(cTitleFit)}, labels ${cLabels.join(',')}, funded "${cFunded}", sections ${cSections.join(',')}, empty ${JSON.stringify(cEmpty)}, warnings ${cWarn}, overflow ${cOverflow}`);
      await page.locator('.ag-detail-close').click().catch(() => {});
      await page.waitForTimeout(300);
      if (await page.locator('.ag-rw-detail').count() === 0 && await page.locator('.ag-strategies .ag-row').count() === 14) ok(T('rwc-warmup'), "closing RW-C's page returns to the list");
      else fail(T('rwc-warmup'), "RW-C's page did not close back to the list");
      agentsMode = 'ok';
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // RW-C inside its fourteen days (AGENTS_RWC_RUNNING, RW-E's fixture figures from RW-C's own summary): its row reads
      // them in RW's cells on its $1,000, every minute on a green dot, and its page is RW's page with its days only —
      // today and two closed days, no warm-up.
      agentsMode = 'rwc-running';
      await openAgentsPage(page);
      const rcRow = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes confirmation') });
      await waitFor(async () => /every minute/.test((await rcRow.first().innerText().catch(() => '')) || ''));
      await page.waitForTimeout(150);
      const rcText = (await rcRow.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const rcGreen = await rcRow.first().locator('.ag-dot-running').count();
      // Deployed: D's No held, $5.60, and B's and C's quotes, $39.20 (Davies, 2026-10-01: every dollar at work).
      if (/1 open · \$1,000 cap/.test(rcText) && / \$44\.80 /.test(rcText) && /\+\$7\.50 \(\+0\.75%\)/.test(rcText) && /-\$1\.20 \(-17\.65%\)/.test(rcText) && /\+\$23\.60 \(\+2\.36%\)/.test(rcText)
        && /every minute/.test(rcText) && !/9 Oct/.test(rcText) && rcGreen === 1) {
        ok(T('rwc-running'), 'RW-C running: 1 open of its $1,000 cap, deployed $44.80, today +$7.50 (+0.75%), unrealised -$1.20 (-17.65%), realised +$23.60 (+2.36%), every minute, green');
      } else fail(T('rwc-running'), `RW-C row "${rcText}", green dots ${rcGreen}`);
      await rcRow.first().click().catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const rcTitle = ((await page.locator('.modal .modal-title').last().textContent().catch(() => '')) || '').trim();
      const rcSplit = (await page.locator('.ag-rw-detail .ag-scoreboard-sm .ag-sb-split-line').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const rcDays = (await page.locator('.ag-rw-days tbody tr td:first-child').allTextContents()).map((t) => t.trim());
      const rcMarkets = await page.locator('.ag-rw-markets tbody tr').count();
      const rcFills = await page.locator('.ag-rw-fills tbody tr').count();
      const rcWarn = await page.locator('.ag-rw-detail .ag-warn-line').count();
      const rcOverflow = await page.locator('.ag-rw-detail').evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => -1);
      await shot(page, 'agents-rwc-running');
      if (rcTitle === 'Reward quotes confirmation' && rcSplit.join('|') === 'rewards +$23.20|orders +$0.40' && rcDays.length === 3 && /· today$/.test(rcDays[0])
        && !rcDays.some((d) => /warm-up/.test(d)) && rcMarkets === 3 && rcFills === 3 && rcWarn === 0 && rcOverflow >= 0 && rcOverflow <= 1) {
        ok(T('rwc-running'), "its page: its own title, realised = rewards +$23.20 + orders +$0.40, today and two closed days (no warm-up), 3 markets, 3 fills, no warning");
      } else fail(T('rwc-running'), `RW-C page: title "${rcTitle}", split ${rcSplit.join('|')}, days ${rcDays.join(' | ')}, markets ${rcMarkets}, fills ${rcFills}, warnings ${rcWarn}, overflow ${rcOverflow}`);
      agentsMode = 'ok';
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // "Reward quotes mini-pool" (0077; Davies, 2026-10-01; live-prep, then small-pool, until 2026-10-02): the order path's own
      // dry-run filled on paper, the last row of
      // TESTING, on the Polymarket card, with a page of its own (PREP_FIXTURE: its figures worked out by hand). TESTING's
      // scoreboard and the Polymarket card add exactly its figures to what they read without it.
      agentsMode = 'ok';
      await openAgentsPage(page);
      await waitFor(async () => (await page.locator('.ag-strategies-testing .ag-row').count()) > 0);
      await page.waitForTimeout(150);
      const prepBefore = await readAgentsPanel(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      agentsMode = 'prep';
      await openAgentsPage(page);
      const prRow = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes mini-pool') });
      await waitFor(async () => (await prRow.count()) === 1);
      await page.waitForTimeout(150);
      const prText = (await prRow.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const prGreen = await prRow.first().locator('.ag-dot-running').count();
      const prNames = (await page.locator('.ag-strategies-testing .ag-row .ag-name-btn').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const prAfter = await readAgentsPanel(page);
      // Today is the change since 16 Sep's close, as RW's: the total 2.37 less that day's 0.90, +$1.47, 0.46 % of $320.
      if (prNames.at(-1) === 'Reward quotes mini-pool' && !prNames.some((n) => /live-prep|small-pool/.test(n)) && /Polymarket/.test(prText) && /2 open · \$320 cap/.test(prText) && /\+\$1\.47 \(\+0\.46%\)/.test(prText)
        && /\+\$0\.42 \(\+5\.03%\)/.test(prText) && /\+\$1\.95 \(\+0\.61%\)/.test(prText) && /every minute/.test(prText) && prGreen === 1) {
        ok(T('prep'), 'the last testing row is "Reward quotes mini-pool" (no row named live-prep or small-pool) on Polymarket: 2 open of its $320 cap, today +$1.47 (+0.46%), unrealised +$0.42 (+5.03%), realised +$1.95 (+0.61%), every minute, green');
      } else fail(T('prep'), `mini-pool row "${prText}" (last of ${prNames.join(' | ')}), green dots ${prGreen}`);
      // What it adds, read off the page with and without it: exactly its own figures, on the scoreboard and on the card.
      const prAmount = (/** @type {string | undefined} */ v) => { const x = /([+-]?)\$([\d,]+(?:\.\d+)?)/.exec(v || ''); return x ? (x[1] === '-' ? -1 : 1) * Number(x[2].replace(/,/g, '')) : NaN; };
      const prCell = (/** @type {any} */ p, /** @type {string} */ name) => p.scoreboard.find((/** @type {any} */ c) => c.name === name)?.value;
      const prSbDiff = ['FUNDED', 'DEPLOYED', 'TODAY', 'UNREALIZED G/L', 'REALIZED G/L'].map((k) => Math.round((prAmount(prCell(prAfter, k)) - prAmount(prCell(prepBefore, k))) * 100) / 100);
      const pmB = prepBefore.venues.find((v) => v.id === 'polymarket'), pmA = prAfter.venues.find((v) => v.id === 'polymarket');
      const prCardDiff = ['funded (Paper)', 'deployed', 'today', 'unrealised', 'realised', 'rewards', 'orders'].map((k) => Math.round((prAmount(pmA?.pairs[k]) - prAmount(pmB?.pairs[k])) * 100) / 100);
      // Its deployed is what it holds, $8.77, and what its quotes tie up, $24.34 (Davies, 2026-10-01): $33.11. The
      // scoreboard's DEPLOYED is shown to the dollar from $1,000: $2,911.63 + $33.11 = $2,944.74 reads $2,912 then $2,945,
      // 33 more. The card, under $1,000, adds $33.11.
      if (prSbDiff.join(',') === '320,33,1.47,0.42,1.95' && prCardDiff.join(',') === '320,33.11,1.47,0.42,1.95,1.7,0.25' && pmA?.meta === '6 strategies') {
        ok(T('prep'), "TESTING's scoreboard and the Polymarket card add exactly its figures: funded $320, deployed $33.11 ($8.77 held and $24.34 its quotes tie up; $2,912 to $2,945 on the scoreboard, shown to the dollar), today +$1.47, unrealised +$0.42, realised +$1.95 (rewards +$1.70, orders +$0.25); the card counts 6");
      } else fail(T('prep'), `scoreboard adds ${prSbDiff.join(',')}, card adds ${prCardDiff.join(',')} (meta "${pmA?.meta}")`);
      await prRow.first().click().catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      // Its page is RW's (Davies, 2026-10-01: "the same as the other Reward quotes pages"), read the way RW's is.
      const prRead = () => page.evaluate(() => {
        const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
        const d = document.querySelector('.ag-rw-detail');
        const rows = (/** @type {string} */ sel) => [...(d?.querySelectorAll(`${sel} tbody tr`) ?? [])].map((tr) => [...tr.querySelectorAll('td')].map(txt));
        return {
          title: txt([...document.querySelectorAll('.modal .modal-title')].at(-1)),
          labels: [...(d?.querySelectorAll('.ag-scoreboard-sm .ag-sb-name') ?? [])].map(txt),
          funded: txt(d?.querySelector('.ag-scoreboard-sm .sb-value')),
          deployed: txt(d?.querySelector('.ag-scoreboard-sm .ag-sb-cell-deployed .sb-value')),
          sb: [...(d?.querySelectorAll('.ag-scoreboard-sm .sb-value, .ag-scoreboard-sm .ag-sb-split-line') ?? [])].map(txt),
          split: [...(d?.querySelectorAll('.ag-scoreboard-sm .ag-sb-split-line') ?? [])].map(txt),
          sections: [...(d?.querySelectorAll('.ag-section-title') ?? [])].map(txt),
          tiles: [...(d?.querySelectorAll('.ag-rw-tile') ?? [])].map((t) => `${txt(t.querySelector('.ag-rw-tile-k'))}=${txt(t.querySelector('.ag-rw-tile-v'))}`),
          days: rows('.ag-rw-days'), markets: rows('.ag-rw-markets'), fills: rows('.ag-rw-fills'),
          warn: d?.querySelectorAll('.ag-warn-line').length ?? -1,
          overflow: d ? d.scrollWidth - d.clientWidth : -1,
        };
      });
      const prp = await prRead();
      await shot(page, 'agents-prep');
      // Days: today 4.90 + 19.44 of quotes, two fills, +$0.50 of rewards and +$1.47 in all; 16 Sep 4.90 + 19.40, two fills,
      // +$1.20 and +$0.90 (its fills −$0.30). The layer keeps no worst case for a day, so both read a dash, never $0.00.
      const prDayOk = prp.days.length === 2 && /· today$/.test(prp.days[0][0]) && prp.days[0].slice(1).join('|') === '$24.34|2|—|+$0.50|+$1.47'
        && /^16 Sep/.test(prp.days[1][0]) && prp.days[1].slice(1).join('|') === '$24.30|2|—|+$1.20|+$0.90';
      // Quotes: each market's pool, RW's bid / ask, its share of the pool at the last minute, what it holds by token, and
      // its rewards and orders adding up to its total: A 1.00 + 0.39 = 1.39, B 0.70 + 0.28 = 0.98.
      const prMktOk = prp.markets.map((r) => r.join('|')).join(' / ')
        === 'Will A happen?|$8|46¢ / 48¢|4 %|5 Yes · 4 No|+$1|+$0.39|+$1.39 / Will B happen?|$7|20.1¢ / 22.9¢|3 %|20 Yes|+$0.70|+$0.28|+$0.98';
      const prFillOk = prp.fills.map((r) => r.slice(1).join('|')).join(' / ') === 'Will A happen?|sold Yes|5|50¢ / Will B happen?|bought Yes|20|20.1¢ / Will A happen?|bought No|4|52¢ / Will A happen?|bought Yes|10|45¢';
      // DEPLOYED: $8.77 held and $24.34 its quotes tie up, $33.11, 10.35 % of its $320 (Davies, 2026-10-01). STATUS: RW's
      // worst case on the two accounts, +$1.00; the best market's share of the total, 1.39 / 2.37 = 59 %.
      if (prp.title === 'Reward quotes mini-pool' && prp.labels.join(',') === 'FUNDED,DEPLOYED,TODAY,UNREALIZED G/L,REALIZED G/L' && /^\$320/.test(prp.funded)
        && prp.deployed === '$33.11(10.35%)'
        && prp.split.join('|') === 'rewards +$1.70|orders +$0.25' && prp.sections.join(',') === 'STATUS,DAYS,QUOTES,FILLS'
        && prp.tiles.join('|') === 'WORST CASE=+$1|TOP SHARE=59 %|QUOTING TODAY=2|POSITIONS STILL HELD=2'
        && prDayOk && prMktOk && prFillOk && prp.warn === 0 && prp.overflow >= 0 && prp.overflow <= 1) {
        ok(T('prep'), "its page is RW's: FUNDED $320, realised = rewards +$1.70 + orders +$0.25; STATUS worst case +$1, top share 59 %, 2 quoting, 2 held; today +$1.47 and 16 Sep +$0.90 adding up to the total, a dash where no worst case is kept; each market's share, holdings by token and parts adding up; the four fills newest first");
      } else fail(T('prep'), `mini-pool page: ${JSON.stringify(prp)}`);
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(300);
      // Under hide-values every amount, price and holding on its page is masked; counts, shares, days and times are not.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.locator('.hide-eye').first().click();
      await page.waitForTimeout(200);
      await openAgentsPage(page);
      await page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes mini-pool') }).first().click().catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const prh = await prRead();
      const prDig = (/** @type {string} */ t) => /\d/.test(t);
      const prMasked = prh.sb.length > 0 && !prh.sb.some((t) => /\$\d/.test(t))
        && prh.tiles.length === 4 && /^WORST CASE=/.test(prh.tiles[0]) && !prDig(prh.tiles[0]) && prh.tiles.slice(1).every((t) => prDig(t.split('=')[1] ?? ''))
        && prh.days.length === 2 && prh.days.every((r) => prDig(r[0]) && !prDig(r[1]) && prDig(r[2]) && !r.slice(3).some(prDig))
        && prh.markets.length === 2 && !prh.markets.some((r) => r.filter((_, i) => i !== 3).slice(1).some(prDig)) && prh.markets.every((r) => prDig(r[3]))
        && prh.fills.length === 4 && !prh.fills.some((r) => r.slice(3).some(prDig)) && prh.fills.every((r) => prDig(r[0]));
      if (prMasked) ok(T('prep'), `hide-values masks its page's amounts, prices and holdings and keeps its days, counts, shares and times (held reads "${prh.markets[0]?.[4]}")`);
      else fail(T('prep'), `under the mask: ${JSON.stringify(prh)}`);
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.locator('.hide-eye').first().click();                       // values shown again for everything after this
      await page.waitForTimeout(200);
      agentsMode = 'ok';

      // "Reward quotes mid-pool" (0081; Davies, 2026-10-02): the order path again on $10–$50 pools, filled on paper by the
      // same layer, the last row of TESTING right after mini-pool's, on the Polymarket card, with RW's page (MID_FIXTURE:
      // its figures worked out by hand). What it adds to TESTING's scoreboard and the card is read against the page with
      // mini-pool alone.
      agentsMode = 'prep';
      await openAgentsPage(page);
      await waitFor(async () => (await page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes mini-pool') }).count()) === 1);
      await page.waitForTimeout(150);
      const midBefore = await readAgentsPanel(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      agentsMode = 'mid';
      await openAgentsPage(page);
      const mdRow = page.locator('.ag-strategies-testing .ag-row', { has: nameBtn(page, 'Reward quotes mid-pool') });
      await waitFor(async () => (await mdRow.count()) === 1);
      await page.waitForTimeout(150);
      const mdText = (await mdRow.first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      const mdGreen = await mdRow.first().locator('.ag-dot-running').count();
      const mdNames = (await page.locator('.ag-strategies-testing .ag-row .ag-name-btn').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const mdAfter = await readAgentsPanel(page);
      // Today is the change since 16 Sep's close: 9.40 less 4.80, +$4.60, 1.44 % of $320; unrealised +$0.40 on its $10.80
      // of cost, 3.70 %; realised its rewards, $9.00, 2.81 % of $320, shown as whole dollars are, +$9.
      if (mdNames.slice(-2).join(' | ') === 'Reward quotes mini-pool | Reward quotes mid-pool' && /Polymarket/.test(mdText) && /2 open · \$320 cap/.test(mdText)
        && /\+\$4\.60 \(\+1\.44%\)/.test(mdText) && /\+\$0\.40 \(\+3\.70%\)/.test(mdText) && /\+\$9 \(\+2\.81%\)/.test(mdText) && /every minute/.test(mdText) && mdGreen === 1) {
        ok(T('mid'), 'the last two testing rows are "Reward quotes mini-pool" then "Reward quotes mid-pool", on Polymarket: 2 open of its $320 cap, today +$4.60 (+1.44%), unrealised +$0.40 (+3.70%), realised +$9 (+2.81%), every minute, green');
      } else fail(T('mid'), `mid-pool row "${mdText}" (rows ${mdNames.join(' | ')}), green dots ${mdGreen}`);
      const mdCell = (/** @type {any} */ p, /** @type {string} */ name) => p.scoreboard.find((/** @type {any} */ c) => c.name === name)?.value;
      const mdAmount = (/** @type {string | undefined} */ v) => { const x = /([+-]?)\$([\d,]+(?:\.\d+)?)/.exec(v || ''); return x ? (x[1] === '-' ? -1 : 1) * Number(x[2].replace(/,/g, '')) : NaN; };
      const mdSbDiff = ['FUNDED', 'DEPLOYED', 'TODAY', 'UNREALIZED G/L', 'REALIZED G/L'].map((k) => Math.round((mdAmount(mdCell(mdAfter, k)) - mdAmount(mdCell(midBefore, k))) * 100) / 100);
      const mdPmB = midBefore.venues.find((v) => v.id === 'polymarket'), mdPmA = mdAfter.venues.find((v) => v.id === 'polymarket');
      const mdCardDiff = ['funded (Paper)', 'deployed', 'today', 'unrealised', 'realised', 'rewards', 'orders'].map((k) => Math.round((mdAmount(mdPmA?.pairs[k]) - mdAmount(mdPmB?.pairs[k])) * 100) / 100);
      // Deployed: $11.20 held and $29.20 its quotes tie up, $40.40. The scoreboard shows it to the dollar from $1,000:
      // $2,944.74 with mini-pool reads $2,945, and $2,985.14 with mid-pool $2,985, 40 more; the card adds $40.40.
      if (mdSbDiff.join(',') === '320,40,4.6,0.4,9' && mdCardDiff.join(',') === '320,40.4,4.6,0.4,9,9,0' && mdPmA?.meta === '7 strategies') {
        ok(T('mid'), "TESTING's scoreboard and the Polymarket card add exactly its figures: funded $320, deployed $40.40 ($11.20 held and $29.20 its quotes tie up; $2,945 to $2,985 on the scoreboard, shown to the dollar), today +$4.60, unrealised +$0.40, realised +$9.00 (rewards +$9.00, orders $0); the card counts 7");
      } else fail(T('mid'), `scoreboard adds ${mdSbDiff.join(',')}, card adds ${mdCardDiff.join(',')} (meta "${mdPmA?.meta}")`);
      await mdRow.first().click().catch(() => {});
      await page.waitForSelector('.ag-rw-detail', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const mdp = await page.evaluate(() => {
        const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
        const d = document.querySelector('.ag-rw-detail');
        const rows = (/** @type {string} */ sel) => [...(d?.querySelectorAll(`${sel} tbody tr`) ?? [])].map((tr) => [...tr.querySelectorAll('td')].map(txt));
        return {
          title: txt([...document.querySelectorAll('.modal .modal-title')].at(-1)),
          labels: [...(d?.querySelectorAll('.ag-scoreboard-sm .ag-sb-name') ?? [])].map(txt),
          funded: txt(d?.querySelector('.ag-scoreboard-sm .sb-value')),
          deployed: txt(d?.querySelector('.ag-scoreboard-sm .ag-sb-cell-deployed .sb-value')),
          split: [...(d?.querySelectorAll('.ag-scoreboard-sm .ag-sb-split-line') ?? [])].map(txt),
          sections: [...(d?.querySelectorAll('.ag-section-title') ?? [])].map(txt),
          tiles: [...(d?.querySelectorAll('.ag-rw-tile') ?? [])].map((t) => `${txt(t.querySelector('.ag-rw-tile-k'))}=${txt(t.querySelector('.ag-rw-tile-v'))}`),
          days: rows('.ag-rw-days'), markets: rows('.ag-rw-markets'), fills: rows('.ag-rw-fills'),
          warn: d?.querySelectorAll('.ag-warn-line').length ?? -1,
          overflow: d ? d.scrollWidth - d.clientWidth : -1,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      await shot(page, 'agents-mid');
      // Days: today $29.20 of quotes, one fill, +$4 of rewards and +$4.60 in all; 16 Sep $29.20, one fill, +$5 and +$4.80
      // (its fills −$0.20). No worst case kept for a day: a dash.
      const mdDayOk = mdp.days.length === 2 && /· today$/.test(mdp.days[0][0]) && mdp.days[0].slice(1).join('|') === '$29.20|1|—|+$4|+$4.60'
        && /^16 Sep/.test(mdp.days[1][0]) && mdp.days[1].slice(1).join('|') === '$29.20|1|—|+$5|+$4.80';
      // Quotes: C $20 a day at 40¢ / 43¢, 18 % of its pool, 20 Yes, +$3.50 + $0.30 = +$3.80; D $36 at 70¢ / 72¢, 24 %,
      // 10 No, +$5.50 + $0.10 = +$5.60.
      const mdMktOk = mdp.markets.map((r) => r.join('|')).join(' / ')
        === 'Will C happen?|$20|40¢ / 43¢|18 %|20 Yes|+$3.50|+$0.30|+$3.80 / Will D happen?|$36|70¢ / 72¢|24 %|10 No|+$5.50|+$0.10|+$5.60';
      const mdFillOk = mdp.fills.map((r) => r.slice(1).join('|')).join(' / ') === 'Will D happen?|bought No|10|28¢ / Will C happen?|bought Yes|20|40¢';
      // DEPLOYED $40.40, 12.63 % of $320. STATUS: RW's worst case on its two accounts, 1.55 + 2.65 = $4.20; the best
      // market's share of the total, 5.60 / 9.40 = 60 %.
      if (mdp.title === 'Reward quotes mid-pool' && mdp.labels.join(',') === 'FUNDED,DEPLOYED,TODAY,UNREALIZED G/L,REALIZED G/L' && /^\$320/.test(mdp.funded)
        && mdp.deployed === '$40.40(12.63%)' && mdp.split.join('|') === 'rewards +$9|orders $0'
        && mdp.sections.join(',') === 'STATUS,DAYS,QUOTES,FILLS'
        && mdp.tiles.join('|') === 'WORST CASE=+$4.20|TOP SHARE=60 %|QUOTING TODAY=2|POSITIONS STILL HELD=2'
        && mdDayOk && mdMktOk && mdFillOk && mdp.warn === 0 && mdp.overflow >= 0 && mdp.overflow <= 1 && mdp.docOverflow <= 0) {
        ok(T('mid'), "its page is RW's, as mini-pool's: FUNDED $320, DEPLOYED $40.40 (12.63%), realised = rewards +$9 + orders $0; STATUS worst case +$4.20, top share 60 %, 2 quoting, 2 held; today +$4.60 and 16 Sep +$4.80 adding up to the total; each market's share, holdings by token and parts adding up; its two fills newest first; nothing wider than the screen");
      } else fail(T('mid'), `mid-pool page: ${JSON.stringify(mdp)}`);
      await page.locator('.ag-detail-close').last().click().catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      agentsMode = 'ok';

      // The paper tests the twins replaced keep running and the payload still carries them (`quotes`, `quotesVariant`,
      // `quotesRuled`), but they are no rows (Davies, 2026-10-02: "这个variant-2上线testing后改名为variant-1"): TESTING's
      // stablecoin rows are the two twins alone, "Stablecoin quotes" and "Stablecoin quotes variant-1" (rule D's twin), and
      // its Revolut X card counts the twins' capital and nothing of the paper tests'.
      agentsMode = 'quotesv';
      await openAgentsPage(page);
      await waitFor(async () => (await page.locator('.ag-strategies-testing .ag-row').count()) === 13);
      await page.waitForTimeout(150);
      const qvNames = (await page.locator('.ag-strategies-testing .ag-row .ag-name-btn').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const qvPanel = await readAgentsPanel(page);
      const qvRevx = qvPanel.venues.find((v) => v.id === 'revx');
      await shot(page, 'agents-testing-twins');
      if (qvNames.filter((n) => /^Stablecoin quotes/.test(n)).join(' | ') === 'Stablecoin quotes | Stablecoin quotes variant-1' && !qvNames.includes('Stablecoin quotes variant-2')
        && qvRevx?.pairs['funded (Paper)'] === '$4,140' && qvRevx?.pairs.deployed === '$2,659 (64.23%)') {
        ok(T('quotesv'), 'with the paper tests in the payload, TESTING still has the two twins alone ("Stablecoin quotes", "Stablecoin quotes variant-1"), and its Revolut X card counts the twins ($4,140 funded, $2,659 deployed)');
      } else fail(T('quotesv'), `stablecoin rows ${qvNames.join(' | ')}; Revolut X ${JSON.stringify(qvRevx?.pairs)}`);
      agentsMode = 'ok';
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
  for (const vp of viewports('viewer')) {
    const { ctx, page } = await newPage(browser, vp, errors, tokenMisses, { token: RO_TOKEN });
    const S = (n) => `${vp.name}/viewer/${n}`;
    await page.waitForSelector('.scoreboard-cell-portfolio .sb-value-lg', { timeout: 20_000 }).catch(() => {});
    await page.waitForSelector('.perf-lbl:visible', { state: 'visible', timeout: 10_000 }).catch(() => {});
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
