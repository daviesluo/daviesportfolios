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
const TOKEN_REQUIRED = ['/prices', '/chart', '/fundamentals', '/data', '/trading212'];

let failures = 0;
const log = [];
const fail = (scope, msg) => { failures++; const s = `  FAIL [${scope}] ${msg}`; log.push(s); console.log(s); };
const ok = (scope, msg) => { const s = `  ok   [${scope}] ${msg}`; log.push(s); console.log(s); };
const near = (a, b, eps = 0.51) => Math.abs(a - b) <= eps;
const money = (s) => Number(String(s || '').replace(/[^0-9.-]/g, ''));

async function newPage(browser, { width, height }, errors, tokenMisses) {
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

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    // Playwright reports an aborted request as a console error; those
    // are this harness's own `route.abort()` on third-party hosts, not
    // the app misbehaving.
    if (/Failed to load resource|net::ERR_FAILED/.test(txt)) return;
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
    if (url.includes('action=price-snapshots')) return json({ rows: [] });
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
    if (url.includes('/ops-error')) return json({ ok: true });
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
    // Still on $. Over a month the fixture's daily series opens at
    // `base` and the live quote closes it, so:
    //   ACME    6 x (240 - 200) x 1        = +$240
    //   NOVA    5 x (120 - 100) x 1        = +$100
    //   BRIT.L  100 x (2.5 - 2) x 1.25     =  +$63
    //   VUAA.L  opens and closes at 80     — flat, so it does not rank
    // A different list, in a different order, from TODAY's
    // BRIT > ACME > VUAA. A window control that changed the label and
    // not the ranking would still pass every check above this one.
    const windows = await page.locator('.movers-window .view-tab:visible').allTextContents();
    if (windows.join(',') === 'TODAY,1W,1M') {
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
      .filter((/** @type {string} */ n) => /\/assets\/(ticker_chart_modal|transaction_history|holdings_list|sectors_list)-/.test(n))
      .map((/** @type {string} */ n) => (n.split('/').pop() || '').replace(/-[a-f0-9]+\.js$/, ''));
    const want = ['ticker_chart_modal', 'transaction_history', 'holdings_list', 'sectors_list'];
    const missing = want.filter((w) => !requestedChunks.includes(w));
    if (missing.length === 0) ok(S('chunks'), 'all four modal chunks prefetched before any click');
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
