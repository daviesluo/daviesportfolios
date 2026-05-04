# Davies' Portfolios

[![CI](https://github.com/daviesluo/daviesportfolios/actions/workflows/check.yml/badge.svg)](https://github.com/daviesluo/daviesportfolios/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A personal portfolio tracker rendered as a football tactics board. Live
prices and FX are pulled in real time, holdings are arranged by role
(GK / DEF / MID / FWD), and the same data is available as a heatmap or
a "Performance vs S&P 500" chart with 1D / 1W / 1M / 3M / YTD ranges.

Deployed at [daviesluo.com](https://daviesluo.com) (admin / read-only
modes via different password).

Vite client bundled to static files on Cloudflare Pages, plus a
handful of Supabase Edge Functions that hide the data and 3rd-party
secrets server-side.

---

## Highlights

- **Live prices** — Yahoo Finance via a Supabase Edge Function. Browser
  never touches Yahoo directly, so no CORS or rate-limit-by-IP issues.
- **Multi-currency holdings** — USD / GBP / CNY / HKD with live FX
  conversion against `GBPUSD=X` / `USDCNY=X` / `USDHKD=X`.
- **Chinese mutual funds** — 6-digit fund codes route to eastmoney's
  `pingzhongdata` endpoint, with `api.fund.eastmoney.com/f10/lsjz`
  and `danjuanapp.com` (Snowball) as JSON fallbacks.
- **Yahoo-Finance-equivalent YTD chart math** — per-lot purchase
  history, Jan-1 close as the basis for pre-year lots, lot.cost as
  the basis for in-year lots; pinned by a vitest suite so the formula
  can't quietly regress.
- **Three views** — football tactics board (default), heatmap (one tile
  per holding, sized by market value, colored by day-change), and a
  PERFORMANCE VS S&P 500 chart with Yahoo-style range buttons.
- **Extended-hours toggle** — switches indices to their futures
  contracts (`^GSPC` → `ES=F` etc.) and recomputes day change against
  the regular-session close so post-market moves show up correctly.
  Whenever the toggle is on, the perf-chart legend dot flips to
  `S&P 500 FUTURES` so the benchmark is unambiguous (panel title
  stays "PERFORMANCE VS S&P 500" — futures track the S&P).
- **1D chart spans 24 h** — both in-session and ext-hours views show
  the trailing 24 h. In-session uses Yahoo `range=5d` + a client-side
  `filterToLast24h` cut (Yahoo's `range=1d` only ever covers the
  current session, so yesterday's close was unreachable that way).
  Vertical dashed CLOSE line marks the previous regular close (= the
  prevClose anchor); in-session view also renders an OPEN line at
  today's open. The displayed % is "since previous close" in both
  modes, so it always agrees with the scoreboard's DAY CHANGE and
  every heatmap tile. DST-aware: open / close UTC hours flip between
  EDT and EST so the markers don't drift Nov–Mar.
- **Live 1D updates** — opening the ticker modal on 1D starts a
  back-to-back polling loop (5 s minimum gap) so intraday bars trickle
  in without needing a manual refresh. Previous bars stay on screen
  during each fetch — no spinner flicker.
- **P/E YTD view** — sixth range button on the ticker chart modal
  for stocks with positive trailing EPS, plus the three big US
  indices (`^GSPC`, `^NDX`, `^RUT`) via an ETF-proxy lookup
  (SPY / QQQ / IWM). Plots `price ÷ EPS` over YTD via Finnhub
  fundamentals, with a horizontal dashed line at the 3-year-average
  P/E for context. Const-EPS approximation (the curve's shape
  mirrors price within a quarter); the y-axis swaps to bare P/E
  values and the modal header shifts to "P/E RATIO" so the basis is
  unambiguous. For the index proxies Finnhub's free tier only
  returns the trailing P/E (no aggregate EPS), so the client
  reconstructs an implied EPS from `lastClose / pe` and divides the
  YTD series through that — the y-axis still anchors at the
  Finnhub-quoted current P/E. ETFs / futures / non-major indices /
  crypto / forex / loss-makers hide the button automatically since
  Finnhub returns no usable P/E or EPS for them.
- **DST-aware scoreboard label** — the "GMT TIME" label flips to
  "BST TIME" automatically during British Summer Time (last Sun Mar →
  last Sun Oct). All chart UTC-string parsing appends an explicit `Z`
  so intraday timestamps render in the user's local zone correctly
  (was off by one hour for non-UTC users).
- **Heatmap drilldown** — clicking any heatmap tile opens the
  per-ticker chart modal (mirrors the tactics-board view's drilldown).
- **Market Conditions drilldown** — every card in the indices /
  commodities / FX column is clickable. Opens the same 1D / 1W / 1M /
  3M / YTD modal used for individual stocks; `^GSPC`, `^NDX` and
  `^RUT` additionally show a P/E YTD chart with a 3-year-average
  reference line, sourced via the fundamentals Edge Function's
  index → ETF proxy (SPY / QQQ / IWM publish a trailing P/E that
  stands in for the underlying basket).
- **Hide values toggle** — masks dollar amounts with `*` so the page
  is screenshot-safe; percentages stay visible.
- **Background chart prefetch** — every successful price refresh
  (initial load + manual Refresh click) silently warms every chart
  range × ticker into `localStorage`, so opening any ticker modal or
  flipping PerfChart range buttons hits cache instead of paying the
  Edge Function round-trip. Coverage spans the portfolio holdings,
  the S&P benchmark AND every Market-Conditions card (^GSPC, ^NDX,
  ^RUT, ^SOX, ^VIX, BZ=F, ^TNX, GBPUSD=X, GBPCNH=X, USDCNY=X) — plus
  P/E YTD for the three ETF-proxied indices. TTL-aligned per range
  (5 m / 30 m / 1 h / 12 h / 12 h); auto-refresh ticks skip the
  prefetch since they'd re-fetch with nothing fresh to show.
- **PWA** — installable on iOS / Android home screen, offline-capable
  via Workbox precache, in-app "new version available" banner.
- **HMAC-signed token auth** — passwords never leave the Edge Function;
  failed-attempt lockout is server-side per-IP (3 wrong → 24 h).
- **Client-side error reporter** — render crashes, fetch failures, auth
  flakes log to a Supabase table so the next debug session starts with
  data, not screenshots.

---

## Using the board

A short tour of the interactive surface. (Engineering details are
covered further down.)

### Sign in

Two passwords gate the app, each granting a different role:

- `?pwd=<admin>` — full edit mode. Add / remove tickers, edit lots,
  drag holdings between positions, adjust cash.
- `?pwd=<readonly>` — view-only "share" link. Same data, no editing
  controls. The header shows a `VIEWER` badge instead of the
  `EDIT` toggle.

The password is consumed and stripped from the URL on first load
(it never lingers in browser history). The signed token lives in
`sessionStorage` and is reused across reloads, so a service-worker
update — or any other mid-session refresh — won't bounce you back
to the prompt.

### Header / scoreboard

- **Time + market phase** — local UK time (auto-flips between BST
  and GMT) plus a coloured dot for the current US market phase
  (green = open, gold = pre-market, purple = after-hours, blue =
  overnight).
- **Extended hours toggle** — when off, the scoreboard reflects the
  regular session. When on, indices switch to their futures
  contracts (`^GSPC` → `ES=F`, etc.) and the day-change recomputes
  against today's regular close so post-market moves show up.
- **Hide-values eye** — masks dollar amounts with `*` so the page is
  screenshot-safe; percentages stay visible. Sticky across reloads.
- **Tactics Board ↔ Heat Map** — switch the central panel between
  the football-pitch view and a treemap heatmap.
- **Refresh** — manually triggers a price fetch + a background
  prefetch of every chart range. The page also auto-refreshes prices
  every 30 s.

### Tactics board view

- Each card shows a position (GK / CB / CDM / CM / LW / ST / RW …)
  with the holdings assigned to it. The largest position by USD
  value gets the captain's armband; the position with the biggest
  intraday move gets a "hot mover" ball.
- **Tap a card** in non-edit mode → drilldown modal listing every
  holding in that position, sorted by market value.
- **Tap a ticker** in non-edit mode → opens the ticker chart modal.
- **Edit mode** (admin only) — long-press / drag a ticker to a
  different position card; tap a card to add a new ticker; tap the
  GK card to adjust cash.

### Heatmap view

- One tile per non-cash holding, sized by USD market value, coloured
  by today's % change (green up, red down, deeper = larger move).
- **Tap a tile** → opens the same ticker chart modal.

### Ticker chart modal

- **Range buttons**: 1D / 1W / 1M / 3M / YTD plus an optional
  **P/E YTD** for stocks with positive trailing EPS and the three
  big US indices (`^GSPC` / `^NDX` / `^RUT`, via ETF-proxy P/E).
  CN funds (6-digit codes) and `.PVT` private holdings only show the
  daily ranges (1M / 3M / YTD) since they don't trade intraday on
  Yahoo. ETFs / futures / non-major indices / crypto / forex /
  loss-makers don't show the P/E button (Finnhub returns no usable
  EPS for them).
- **Opens for any board surface** — clicking a tactics-board player,
  a heatmap tile, or a Market Conditions card all route through the
  same modal. Indices / futures / forex / yield tickers render with
  a context-appropriate y-axis label (no currency prefix; `%` suffix
  for `^TNX`; 4-decimal places for FX pairs); the modal title shows
  a friendly name (e.g. "S&P 500 ^GSPC") for non-equity tickers.
- **1D view** spans the trailing 24 h with two dashed markers:
  `CLOSE` at the previous regular close and `OPEN` at today's open.
  The displayed % is "since previous close", matching the
  scoreboard's DAY CHANGE and every heatmap tile. While the modal is
  open the chart polls back-to-back (5 s minimum gap) so intraday
  bars trickle in without a manual refresh.
- **P/E YTD view** uses the same YTD daily price series but divides
  every bar by the ticker's current TTM EPS (from Finnhub) to
  produce a P/E-ratio chart. Const-EPS approximation — the shape
  mirrors price within a quarter, becomes inaccurate after an
  earnings report. Modal header swaps "PRICE / Last $price" for
  "P/E RATIO / P/E ratio (price ÷ TTM EPS)" so the basis is explicit.
  A horizontal dashed gray line at the 3-year average P/E (mean of
  the three most-recent annual P/E values from Finnhub) gives a
  cycle-aware reference; the value is labelled in the right margin
  outside the plot area so it never crosses the price line.
- **Hover** anywhere on the chart for a crosshair: dashed lines down
  to both axes, a tooltip showing the price at that bar, and the %
  change from the anchor.
- **Other ranges** (1W / 1M / 3M / YTD) are pre-fetched in the
  background after every refresh, so range-button clicks usually
  hit the cache and render instantly.

### Performance vs S&P 500 panel

A two-line chart comparing the portfolio's % return against the
S&P 500 over the same range buttons. 1D ext-on swaps `^GSPC` for
`ES=F` (S&P futures) so post-market moves are visible — the legend
dot flips to `S&P 500 FUTURES` while the panel header stays
"PERFORMANCE VS S&P 500" (futures track the index). The 1D view
draws an `OPEN` dashed marker at today's regular open in both
sub-modes; ext-on additionally renders a `CLOSE` marker at today's
regular close so the user can see the boundary between RTH and
after-hours. ES=F bars are clipped to extended trading hours
(4 AM – 8 PM ET) so the chart doesn't include Asia-overnight bars
where stocks aren't trading; ^GSPC bars are clipped to RTH only.
Hover the chart for a crosshair: vertical dashed line, dots on both
lines, per-series % chips next to each dot, and a date pill at the
bottom.

### Market Conditions

The left column's grid of indices / commodities / FX cards is fully
clickable — tap any card to open the same chart modal individual
stocks use, with the full 1D / 1W / 1M / 3M / YTD range row. `^GSPC`,
`^NDX` and `^RUT` additionally surface a **P/E YTD** button (sourced
from the matching ETF's trailing P/E via Finnhub) with a 3-year-
average dashed reference line. Yields render with a `%` suffix, FX
pairs at four decimals, and indices / futures without a currency
prefix so the y-axis matches each instrument's natural scale.

### Sidebar

- **Top Movers · Today** — the five largest winners and losers by %
  change.
- **Formation Value** — every position's USD weight as a horizontal
  bar plus its day P/L.

### Mobile layout

Below the 1020 px breakpoint the page collapses into a single column
in this order: Header → Pitch / Heatmap → Sidebar → Market Conditions
(3 × 3 grid: indices / commodities + yield / FX) → footer.

The PWA update banner is safe-area-aware on iOS so it doesn't crash
into the notch / status bar; the hide-values mask uses a vertically-
centered bullet (`•`) instead of `*` so masked rows stay flush with
neighbouring real numbers on the same line.

### Install as a PWA

The app is a PWA — on iOS / Android, "Add to Home Screen" gives a
full-screen launcher with the proper icon. When a new version is
deployed, a top-of-screen banner offers a `RELOAD` button; the SW
won't auto-reload mid-session.

---

## Stack

- **Frontend** — React 18 + Vite 5, JSX with `checkJs` + JSDoc for type
  safety (no `.tsx`). Bundle output to repo root (`/assets/*.js`),
  served by Cloudflare Pages.
- **Backend** — Supabase (Postgres + Edge Functions, Deno runtime).
  Five functions: `auth`, `data`, `prices`, `chart`, `ops-error`. Two
  migrations: `auth_attempts`, `ops_errors`.
- **Build / CI** — Vite production bundle, vitest for unit tests, tsc
  in `--noEmit` mode for typechecking. GitHub Actions workflow runs
  all three on every push to `main`.
- **Hosting** — Cloudflare Pages auto-deploys from `main`. `_headers`
  pins cache rules so iOS PWA can't get stuck on a stale `index.html`
  pointing at deleted hashed bundles.

---

## File map

### `src/` — client

| File | What it does |
|---|---|
| `main.jsx` | React entry point. Mounts `<App>` + service-worker registration. |
| `app.jsx` | `<App>` (auth gate) + `<Board>` (the actual UI). Owns portfolio state, `doRefresh` loop, modal coordination. |
| `auth.js` | Password → HMAC token flow. `collectPassword` (URL `?pwd=` or `window.prompt`), `authenticate` (POSTs to `/auth`), `decodeAppToken` (skip prompt if a valid sessionStorage token already exists). |
| `portfolio_remote.js` | `loadPortfolioRemote` / `savePortfolioRemote` against the `data` Edge Function. Includes `migrate(p)` for legacy portfolio shapes (CB → CB1/CB2 split, BRK-B move, currency backfill, lots backfill). |
| `supabase_config.js` | Shared `SB_URL`, `SB_ANON`, `EDGE_AUTH_URL`, `EDGE_DATA_URL`. |
| `utils.js` | `computeMetrics`, FX helpers, `fetchTickers` (live snapshot), `fetchHistorical` / `fetchHistoricalBatch` (race Edge Function vs. CORS-proxy chain, abort losers), formatters, `Storage` namespace, schema-version migration, DST-aware helpers (`ukTzAbbr`, `usMarketHoursUtc`). |
| `data.js` | `INITIAL_PORTFOLIO` seed for first-load demo state. |
| `ytd.js` | Pure chart math. `buildTickerSeries`, `computeAt`, `lotsFor`, `closeOn`, `RANGES`, `fetchParamsFor`, `filterToLatestDay`, `filterToLast24h`. Decoupled from React so it's unit-testable. |
| `ytd.test.js` | 19 cases pinning the YTD formula behaviors (pre-year lot, year lot, mixed, missing janPrice, 1D ext mode, intraday date comparison, etc.). |
| `utils.test.js` | 5 cases pinning `fetchHistoricalBatch`'s race behavior (Edge fast path, partial fill, CN-fund proxy bypass, empty input, dedup). |
| `header_sidebar.jsx` | `<Header>` (scoreboard + extended-hours toggle + hide-values eye), `<Sidebar>` (top movers + formation value + perf chart), `<MarketConditions>` (10 cards desktop, 9 cards mobile in a 3 × 3 grid; SOX dropped on mobile). Re-exports `<PerfPanel>` from `perf_chart.jsx` so `app.jsx` keeps its existing import. |
| `perf_chart.jsx` | `<PerfChart>` (the chart) + `<PerfPanel>` (chrome wrapper). 5 ranges, dual fetch effect (S&P alone + portfolio batch in parallel), background prefetch effect for the other ranges, DOM-ref crosshair, CLOSE/OPEN markers in 1D, ^GSPC RTH filter + ES=F ETH filter. |
| `pitch.jsx` | Football-pitch SVG rendering. Position dots, captain armband, hot-mover ball, drag/drop in edit mode. |
| `heatmap.jsx` | One tile per holding, sized by market value, colored by day-change. |
| `modals.jsx` | `<PositionDrillModal>`, `<EditTickerModal>` (incl. lot editor), `<AddTickerModal>`, `<CashModal>`. |
| `ticker_chart_modal.jsx` | Single-ticker price-history modal. Same range buttons as PerfPanel + an optional `P/E YTD` button for stocks with positive TTM EPS. DOM-ref crosshair (no React rerender on hover), persistent localStorage cache + stale-while-revalidate, 6-digit CN funds and `.PVT` private holdings restricted to 1M / 3M / YTD, ETFs / loss-makers hide the P/E button. |
| `sw-banner.jsx` | "New version available — RELOAD" banner. Uses `useRegisterSW` from `vite-plugin-pwa`. |
| `ops_error.js` | `reportError(kind, opts)`. Per-`(kind, symbol)` cooldown + per-load cap. POSTs to the `ops-error` Edge Function with `keepalive: true` so render-crash reports survive the user's Reload click. |
| `prefetch.js` | `prefetchAllChartData(opts)`. Fired from `doRefresh` on initial load + manual Refresh click (skipped on the 30 s auto-refresh tick). Walks every (range × ticker) combo, skips ranges that are fully fresh under their TTL, and writes results into both the PerfChart cache (`dp.ytd`) and the TickerChartModal cache (`dp.tickerChart`) so the next chart open is instant. |
| `types.d.ts` | JSDoc-friendly type definitions. |
| `styles.css` | All app styles (single sheet). |
| `index.html` | Vite root. References `/assets/index-<hash>.js`. |

### `supabase/functions/` — Edge Functions (Deno)

| Function | What it does |
|---|---|
| `auth` | `POST { password }` → `{ token, role }` on success, `429 { lockoutUntil }` after 3 wrong attempts from the same IP. Tokens are `<base64url(payload)>.<base64url(sig)>` where payload is `{ role, exp }`, signed HMAC-SHA256 with `APP_AUTH_SECRET`. |
| `data` | `?action=load` / `?action=save`. Validates the `X-App-Token` header (re-derives HMAC + checks exp + checks role) before reading / writing `board_data`. Service-role key never leaves the function. |
| `prices` | `?tickers=NVDA,017731,GBPUSD=X,…` → `{ ticker: { lastPrice, extPrice?, prevClose, currency, dayPct, extDayPct? } }`. Routes 6-digit codes to eastmoney's `fundgz.1234567.com.cn`, everything else to Yahoo Finance v8. |
| `chart` | `?tickers=…&range=1mo&interval=60m&includePrePost=true` → `{ ticker: [{ date, close }, …] }`. Routes CN funds to a 3-tier eastmoney fallback (pingzhongdata → lsjz JSON → danjuanapp), everything else to Yahoo. `.PVT` placeholders fall back to the bare symbol when Yahoo 404s the literal. |
| `fundamentals` | `?tickers=NVDA,GOOG,…` → `{ NVDA: { pe, eps }, … }`. Powers the ticker-modal "P/E YTD" view via the Finnhub free tier. Skips ETFs / loss-makers / non-stock symbols server-side. |
| `ops-error` | Two modes. `POST { kind, symbol?, message?, context? }` → inserts into `ops_errors` (no auth; size + length capped; per-row IP captured server-side). `GET ?action=summary&hours=24` with header `x-app-token: <admin token>` → `{ hours, total, byKind, bySymbol }` aggregate over the last N hours, so triage doesn't require a Supabase dashboard login. |

### `supabase/migrations/`

| File | Contents |
|---|---|
| `0001_auth_attempts.sql` | `auth_attempts` table + `bump_auth_attempt` RPC for atomic increment-or-lock. |
| `0002_ops_errors.sql` | `ops_errors` table with timestamped indexes; RLS-deny default. |

### Build / config

| File | What it does |
|---|---|
| `vite.config.js` | React plugin, PWA plugin (Workbox precache + runtime caches for fonts), build output to repo root. |
| `tsconfig.json` | `checkJs: true` so JSDoc annotations get type-checked by `tsc --noEmit`. |
| `_headers` | Cloudflare Pages cache rules. `index.html` / `sw.js` always revalidate; `/assets/*` cached for a year (filenames are content-hashed). |
| `manifest.webmanifest` | PWA install metadata (name, icons, theme color). |
| `.github/workflows/check.yml` | CI: typecheck → vitest → build, on every push. |
| `CLAUDE.md` | Conventions for Claude Code sessions working on this repo. |

---

## Data flow

```
                                Browser
       ┌─────────────────────────┴──────────────────────────┐
       │  React app  ──┬── reads/writes via /functions/v1/data
       │              ├── live prices via /functions/v1/prices
       │              ├── chart bars via /functions/v1/chart
       │              ├── auth via /functions/v1/auth (gets HMAC token)
       │              └── error reports via /functions/v1/ops-error
       │  localStorage (dp.* namespace)
       │    ├── dp.token    (sessionStorage — wiped on tab close)
       │    ├── dp.ytd      (per-range historical close cache)
       │    ├── dp.tickerChart (single-ticker modal cache)
       │    ├── dp.prefs    (hide-values toggle, etc.)
       │    └── dp.schema   (single integer; bumps drive Storage.migrate)
       └────────────────────────────────────────────────────┘
                                  │
                                  ▼
              Supabase (Edge Functions + Postgres)
       ┌──────────────────────────────────────────────────┐
       │  auth        ─→ HMAC-signs a { role, exp } token │
       │  data        ─→ board_data row (RLS: service_role only) │
       │  prices      ─→ Yahoo / eastmoney → live prices  │
       │  chart       ─→ Yahoo / eastmoney → bars         │
       │  ops-error   ─→ ops_errors table (RLS: write-only via service role) │
       └──────────────────────────────────────────────────┘
```

The Edge Functions hide:
1. The Supabase service-role key (data CRUD).
2. The app's two passwords (`auth` checks them and signs tokens).
3. The Yahoo / eastmoney URL patterns and User-Agent headers.

The browser carries:
1. The Supabase **anon** key (safe — it's the `anon public` key from the
   dashboard, gated by the Edge Function's own auth).
2. A short-lived HMAC token in sessionStorage.

---

## Local development

Requirements: Node 20+, Supabase project, Cloudflare Pages account
(optional, only for deploys).

```sh
git clone https://github.com/daviesluo/daviesportfolios
cd daviesportfolios
npm install
npm run dev           # Vite dev server at http://localhost:5173
npm test              # vitest (currently 24 cases)
npm run typecheck     # tsc --noEmit with checkJs
npm run build         # production bundle to repo root
```

The dev server hits the deployed Edge Functions by default. To point
at a local Supabase, edit `src/supabase_config.js` (`SB_URL` /
`SB_ANON`).

---

## Forking / re-using this project

This is a personal tracker, but the architecture is generic. Steps to
stand up your own:

### 1. Create a new Supabase project

[supabase.com](https://supabase.com) → New project. Note the project
URL and the `anon public` API key (Settings → API).

### 2. Run the migrations

In Supabase dashboard → SQL Editor, paste and run:

- `supabase/migrations/0001_auth_attempts.sql`
- `supabase/migrations/0002_ops_errors.sql`

Then create the `board_data` table:

```sql
create table public.board_data (
  id   bigint primary key,
  data jsonb not null
);
alter table public.board_data enable row level security;
-- No policies → only service-role (used by the data function) can read/write.
insert into public.board_data (id, data) values (1, '{}'::jsonb);
```

### 3. Deploy the Edge Functions

For each directory under `supabase/functions/*`, copy the contents into
a new function in Supabase dashboard → Edge Functions, then Deploy.

Required environment variables (Edge Functions → Settings):

A copy-pasteable shape of the three app-level vars lives at
[`.env.example`](./.env.example).

| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all | Provided automatically by Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | `data`, `auth`, `ops-error` | From dashboard Settings → API. |
| `APP_AUTH_SECRET` | `auth`, `data` | Long random string (`openssl rand -hex 32`). |
| `APP_ADMIN_PASSWORD` | `auth` | Your admin password. |
| `APP_RO_PASSWORD` | `auth` | Your read-only / shareable password. |
| `FINNHUB_API_KEY` | `fundamentals` | Free key from finnhub.io. Powers the ticker-modal "P/E YTD" view; without it the P/E button stays hidden and everything else still works. |

### 4. Wire the client

Edit `src/supabase_config.js` to point at your project:

```js
export const SB_URL  = "https://<your-project>.supabase.co";
export const SB_ANON = "<your anon public key>";
```

Edit `src/data.js` to seed your initial portfolio (positions, holdings,
shares, cost). On first load, the migration code in
`portfolio_remote.js` will rehydrate from this seed if the DB row is
empty.

### 5. Deploy the client

Cloudflare Pages → Connect to Git → pick your fork → set:

- Build command: `npm run build`
- Build output directory: `/`

Cloudflare Pages will auto-deploy on every push to `main`.

### 6. Visit

- `https://<your-domain>?pwd=<APP_ADMIN_PASSWORD>` for full edit mode.
- `https://<your-domain>?pwd=<APP_RO_PASSWORD>` for a read-only share
  link.

---

## Working conventions

See [`CLAUDE.md`](./CLAUDE.md) for repo conventions (push directly to
`main`, run tests + typecheck + build before every push, manual
deploys for `supabase/functions/*`, schema-version migrations under
`Storage.migrate()` in `utils.js`).
