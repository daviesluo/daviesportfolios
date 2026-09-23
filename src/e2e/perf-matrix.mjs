// Browser matrix against the PRODUCTION bundle.
//
// Serves the built site exactly as Cloudflare Pages does (index.html +
// the committed hashed assets, no dev server, no source transform),
// intercepts every network call with fixtures whose right answer is
// arithmetic, and reads the numbers back out of the DOM.
//
// The fixture is deliberately tiny so every expected figure can be done
// on paper:
//
//   ACME  10 shares, bought 2026-01-02 at $200
//   CASH  $500
//
//   window bars   200 -> 220 -> 240
//   value         2500 -> 2700 -> 2900     (10 x price + 500 cash)
//   deposited     2500 flat                (10 x 200 + 500 cash)
//   value move    (2900-2500)/2500 = +16.00%
//   deposit move  +0.00%
//   ^GSPC bars    5000 -> 5100 -> 5200  ->  +4.00% over the window
//   portfolio %   value/basis where basis is the Jan-1 close 200:
//                 (2900-2500)/2500 = +16.00%, rebased from its own first
//                 point which is already 0.
//
// A hard CI gate since 2026-09-23 (check.yml's matrix step). Its clock is
// pinned below, so it gives the same answer at any hour, and it refuses an
// instant its fixture cannot serve. Run it from src/ after a chart change:
//
//   npm run build && npm run verify:perf
//
// Usage: node e2e/perf-matrix.mjs [path to dist/]; the default is the
// repository's dist/. Chromium comes from Playwright, or from
// PLAYWRIGHT_CHROMIUM_PATH, as in app-sweep.mjs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// ---- the clock ------------------------------------------------------
//
// The app reads the clock (the market phase decides where a window starts
// and which bars count), so a matrix on the real clock can pass at one
// hour and fail at another. The instant is pinned in BOTH places that read
// a clock, as in app-sweep.mjs: the fixture's bar dates (here, in Node)
// and the page's own `Date` (`page.clock.setFixedTime`). They must be the
// same instant, or the app reasons about bars from another day.
// PERF_MATRIX_CLOCK (any instant `Date` parses) moves it to probe an hour.
const CLOCK = new Date(process.env.PERF_MATRIX_CLOCK || '2026-09-17T23:00:00Z');
const NOW_MS = CLOCK.getTime();
if (!Number.isFinite(NOW_MS)) throw new Error(`PERF_MATRIX_CLOCK is not a date: ${process.env.PERF_MATRIX_CLOCK}`);

// Absolute, always: the path-traversal guard below compares the resolved
// file against ROOT with `startsWith`.
const ROOT = path.resolve(
  process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'dist'));
const PORT = 8931;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
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

const YEAR = CLOCK.getUTCFullYear();
// Daily bars, placed relative to today so they land inside EVERY range's
// window — a fixed Jan/Mar/Jun triple falls outside 3M and draws the
// empty state, which is a fixture bug, not an app one.
const dayAgo = (n) => new Date(NOW_MS - n * 86400_000).toISOString().slice(0, 10);
const D = (m, d) => `${YEAR}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const PORTFOLIO = {
  positions: {
    ST: { label: 'Striker', subtitle: '', role: 'FWD', tickers: ['ACME', 'CASH'] },
  },
  holdings: {
    ACME: {
      shares: 10, cost: 200, lastPrice: 240, prevClose: 220, dayPct: 9.09,
      currency: 'USD', lots: [{ date: D(1, 2), shares: 10, cost: 200 }],
    },
    CASH: { shares: 1, cost: 0, lastPrice: 500, dayPct: 0, isCash: true },
  },
  depositFxRates: { USD: 1 },
};

// The same book after a sale, to exercise the half of `computeAt` the
// original fixture never reaches. The ledger is the broker's executed
// fills now, so a position sold down is the ordinary case rather than
// an edge one — and until this the matrix only ever proved that buys
// still worked.
//
// The sale is dated before EVERY window opens, deliberately: a sale
// inside the window prices its basis at the proceeds and one outside it
// at the anchor, so putting it outside keeps a single expected figure
// across all five ranges instead of one per range.
//
//   ACME   10 bought at 200, 4 sold at 230 -> 6 held
//   value  6 x 240 + 500 cash = 1940
//   basis  6 x 200 + 500 cash = 1700   (both sides at the window anchor)
//   move   (1940-1700)/1700 = +14.12%
const PORTFOLIO_SOLD = {
  ...PORTFOLIO,
  holdings: {
    ...PORTFOLIO.holdings,
    ACME: {
      shares: 6, cost: 180, lastPrice: 240, prevClose: 220, dayPct: 9.09,
      currency: 'USD',
      lots: [{ date: D(1, 2), shares: 10, cost: 200 }],
      sells: [{ date: D(2, 1), shares: 4, price: 230 }],
    },
  },
};

// Which book the fixture server hands out, and what it should read.
const BOOKS = [
  { name: 'buys-only', portfolio: PORTFOLIO, move: '+16.00%' },
  { name: 'sold-down', portfolio: PORTFOLIO_SOLD, move: '+14.12%' },
];
let book = BOOKS[0];

// Daily bars for the daily ranges, intraday for the short ones. Both
// end at 240 so the live right edge and the last bar agree.
const dailyBars = (t) => {
  const closes = t === '^GSPC' ? [5000, 5100, 5200] : [200, 220, 240];
  return [
    { date: dayAgo(60), close: closes[0] },
    { date: dayAgo(30), close: closes[1] },
    { date: dayAgo(1), close: closes[2] },
  ];
};

// Intraday bars land inside the most recent US cash session (13:30-20:00
// UTC), because the ^GSPC series is clipped to regular hours — bars
// outside it are dropped and the benchmark falls back to another ticker.
const intradayBars = (t) => {
  const closes = t === '^GSPC' ? [5000, 5100, 5200] : [200, 220, 240];
  const now = new Date(NOW_MS);
  const session = new Date(now);
  const past2000 = now.getUTCHours() >= 20;
  if (!past2000) session.setUTCDate(session.getUTCDate() - 1);
  const at = (hh, mm) => {
    const d = new Date(session);
    d.setUTCHours(hh, mm, 0, 0);
    return d.toISOString().slice(0, 16);
  };
  return [
    { date: at(14, 0), close: closes[0] },
    { date: at(17, 0), close: closes[1] },
    { date: at(19, 55), close: closes[2] },
  ];
};

// ---- where the fixture holds ------------------------------------------
//
// The expected figures hold only where the bars above land the way they
// were written to. Probed at 21 pinned instants on 2026-09-23: every
// failure this matrix ever reported sits in one of the cases below, and in
// each the app was right about the data it was given.
//   - After 14:00 and up to 17:00 UTC the 24H window keeps two of the
//     previous session's three bars (it falls back to the whole day only
//     below two), so 24H reads +7.41 %. These were the 18 failures this
//     harness reported for months.
//   - A session day on a weekend: the 3M grid samples weekdays only, so 3M
//     draws flat or empty.
//   - London off British Summer Time: the 3M grid's 17:00 London slot is
//     17:00 UTC, the second bar's own time, so 3M starts a bar late.
//   - Within 60 days of the sold-down book's 1 February sale: the sale
//     falls inside the drawn series and that book's figures move.
// An instant in any of them is refused rather than run, so a failure here
// is always the app's.
const zoneName = (tz, at, locale) => new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' })
  .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;

function fixtureProblem(at) {
  const minuteOfDay = at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
  if (minuteOfDay > 14 * 60 && minuteOfDay <= 17 * 60) {
    return 'after 14:00 and up to 17:00 UTC the 24H window keeps only two of the three bars';
  }
  const session = new Date(at);
  if (at.getUTCHours() < 20) session.setUTCDate(session.getUTCDate() - 1);
  if (session.getUTCDay() === 0 || session.getUTCDay() === 6) {
    return `the fixture's session day (${session.toISOString().slice(0, 10)}) is a weekend, which the 3M grid skips`;
  }
  if (zoneName('Europe/London', session, 'en-GB') !== 'BST') {
    return 'London is not on British Summer Time, so the 3M grid samples the second bar instead of the first';
  }
  if (dayAgo(60) <= D(2, 1)) {
    return "the sold-down book's 1 February sale falls inside the drawn series";
  }
  return null;
}

const QUOTES = {
  ACME: { lastPrice: 240, prevClose: 220, currency: 'USD', dayPct: 9.09 },
  '^GSPC': { lastPrice: 5200, prevClose: 5150, currency: 'USD', dayPct: 0.97 },
};

// A fake but well-formed app token: the client only DECODES it (the
// signature is checked server-side, and every server call here is
// intercepted).
const b64url = (s) => Buffer.from(s).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `${b64url(JSON.stringify({ role: 'admin', exp: NOW_MS + 3600_000 }))}.sig`;

// ---- run -----------------------------------------------------------

const RANGES = ['1D', '1W', '1M', '3M', 'YTD'];

/** @param {'none'|'sparse'|'full'} snapshotMode */
function snapshotRows(mode) {
  if (mode === 'none') return [];
  const now = NOW_MS;
  const rows = [];
  const n = mode === 'sparse' ? 2 : 24;
  for (let i = n; i >= 1; i--) {
    rows.push({
      ts: new Date(now - i * 5 * 60_000).toISOString(),
      prices: { ACME: 240 },
    });
  }
  return rows;
}

async function run() {
  const problem = fixtureProblem(CLOCK);
  if (problem) {
    console.error(`Refusing ${CLOCK.toISOString()}: ${problem}. Pick another instant.`);
    process.exit(2);
  }
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
    args: ['--no-sandbox'],
  });
  const results = [];
  let failures = 0;

  for (const bk of BOOKS) {
  book = bk;
  for (const snapshotMode of ['none', 'sparse', 'full']) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.addInitScript(([token]) => {
      sessionStorage.setItem('dp.token', token);
    }, [TOKEN]);
    const page = await ctx.newPage();
    // Timers still run, so refreshes and polls behave normally; only
    // "what time is it" is fixed.
    await page.clock.setFixedTime(CLOCK);

    await page.route('**/functions/v1/**', async (route) => {
      const url = route.request().url();
      const json = (body) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      });
      if (url.includes('/data?') && url.includes('action=load')) {
        return json({ data: book.portfolio, version: 1 });
      }
      if (url.includes('action=price-snapshots')) {
        return json({ rows: snapshotRows(snapshotMode) });
      }
      if (url.includes('/data?')) return json({ ok: true, version: 2 });
      if (url.includes('/chart?')) {
        const u = new URL(url);
        const tickers = (u.searchParams.get('tickers') || '').split(',').filter(Boolean);
        const interval = u.searchParams.get('interval') || '1d';
        const daily = /^\d+(d|wk|mo)$/.test(interval);
        const out = {};
        for (const t of tickers) out[t] = daily ? dailyBars(t) : intradayBars(t);
        return json(out);
      }
      if (url.includes('/prices?')) {
        const u = new URL(url);
        const tickers = (u.searchParams.get('tickers') || '').split(',').filter(Boolean);
        const out = {};
        for (const t of tickers) if (QUOTES[t]) out[t] = QUOTES[t];
        return json(out);
      }
      if (url.includes('/trading212')) return json({ source: 'disabled' });
      if (url.includes('/fundamentals')) return json({});
      if (url.includes('/overnight-fetch')) return json({});
      if (url.includes('/ops-error')) return json({ ok: true });
      return json({});
    });
    // Everything else (Yahoo direct, the CORS proxies, fonts) fails fast
    // rather than hanging the page for its timeout.
    // Registered LAST, so Playwright runs it FIRST. `fallback()` — not
    // `continue()` — is what hands a request on to the fixture handler
    // above; `continue()` sends it to the real network instead, which is
    // how the first version of this harness silently bypassed every mock.
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(`http://localhost:${PORT}`)) return route.continue();
      if (u.includes('/functions/v1/')) return route.fallback();
      return route.abort();
    });

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.perf-chart-wrap svg', { timeout: 20_000 });

    for (const view of ['sp', 'investment']) {
      if (view === 'investment') {
        await page.click('.left-col #perf-tab-inv');
        await page.waitForTimeout(150);
      }
      for (const rangeKey of RANGES) {
        const label = rangeKey === '1D' ? '24H' : rangeKey;
        await page.click(`.left-col .perf-range-btn:text-is("${label}")`);
        await page.waitForTimeout(400);
        const read = await page.evaluate(() => {
          const panel = document.querySelector('.left-col .panel');
          if (!panel) return null;
          const svg = panel.querySelector('svg');
          const paths = [...panel.querySelectorAll('svg path[d^="M"]')]
            .map((p) => ({
              d: p.getAttribute('d'),
              dash: p.getAttribute('stroke-dasharray'),
              opacity: p.getAttribute('opacity'),
              points: (p.getAttribute('d') || '').split('L').length,
            }));
          return {
            tabOn: panel.querySelector('.view-tab.is-on')?.textContent || '',
            empty: !!panel.querySelector('.sparkline-empty'),
            labels: [...panel.querySelectorAll('.perf-lbl')].map((e) => e.textContent),
            values: [...panel.querySelectorAll('.perf-val')].map((e) => e.textContent),
            ticks: [...(svg?.querySelectorAll('text') || [])].map((e) => e.textContent),
            paths,
          };
        });
        const row = { book: bk.name, snapshotMode, view, rangeKey, ...read };
        results.push(row);

        // ---- assertions
        const fail = (msg) => { failures++; console.log(`  FAIL [${bk.name}/${snapshotMode}/${view}/${rangeKey}] ${msg}`); };
        if (!read) { fail('panel missing'); continue; }
        if (read.empty) fail('drew the Insufficient-data empty state');
        if (read.paths.length < 2) fail(`only ${read.paths.length} line(s) drawn`);
        // The switch has to agree with the lines actually drawn: the
        // active tab IS the panel heading now, so a mismatch would put
        // one view's title over the other view's chart.
        const wantTab = view === 'investment' ? 'INVESTMENT' : 'VS S&P';
        if (!(read.tabOn || '').includes(wantTab)) fail(`active tab "${read.tabOn}" (want ${wantTab})`);
        if (view === 'investment') {
          if (read.labels.join(',') !== 'VALUE,DEPOSITED') fail(`legend labels ${read.labels}`);
          if (read.values[0] !== book.move) fail(`value move ${read.values[0]} (want ${book.move})`);
          if (read.values[1] !== '+0.00%') fail(`deposit move ${read.values[1]} (want +0.00%)`);
          const dashed = read.paths.filter((p) => p.dash);
          if (dashed.length !== 1) fail(`expected 1 dashed deposit line, got ${dashed.length}`);
          const ys = (dashed[0]?.d || '').replace('M', '').split('L').map((s) => Number(s.split(',')[1]));
          if (new Set(ys.map((y) => y.toFixed(1))).size !== 1) fail('deposit line is not flat');
          if (!read.ticks.some((t) => /^\$/.test(t || ''))) fail('no dollar axis ticks');
        } else {
          if (read.labels[0] !== 'PORTFOLIO') fail(`legend labels ${read.labels}`);
          if (read.values[0] !== book.move) fail(`portfolio move ${read.values[0]} (want ${book.move})`);
          if (read.values[1] !== '+4.00%') fail(`S&P move ${read.values[1]} (want +4.00%)`);
          // Both lines rebased: same first y.
          const firstY = read.paths.map((p) => Number((p.d || '').replace('M', '').split(',')[1]));
          if (Math.abs(firstY[0] - firstY[1]) > 0.2) fail(`lines start apart: ${firstY[0]} vs ${firstY[1]}`);
        }
      }
      if (view === 'investment') {
        await page.click('.left-col #perf-tab-sp');
        await page.waitForTimeout(150);
      }
    }
    await ctx.close();
  }
  }

  await browser.close();
  server.close();

  console.log('\n=== matrix ===');
  for (const r of results) {
    console.log(
      `${r.book.padEnd(10)} ${r.snapshotMode.padEnd(6)} ${r.view.padEnd(11)} ${r.rangeKey.padEnd(4)}`
      + ` lines=${r.paths?.length ?? 0} pts=${r.paths?.[0]?.points ?? 0}`
      + ` legend=${(r.values || []).join(' / ')}`
      + (r.empty ? '  EMPTY' : ''),
    );
  }
  console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILURES'} across ${results.length} cases at ${CLOCK.toISOString()}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); server.close(); process.exit(2); });
