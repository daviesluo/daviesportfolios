# Davies' Portfolios

A personal portfolio tracker rendered as a football tactics board. Live
prices and FX are pulled in real time, holdings are arranged by role
(GK / DEF / MID / FWD), and the same data is available as a heatmap or
a "Performance vs S&P 500" chart with 1D / 1W / 1M / 3M / YTD ranges.

Deployed at [daviesluo.com](https://daviesluo.com) (admin / read-only
modes via different password).
+ Vite client bundled to static files on Cloudflare Pages, plus a
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
- **Hide values toggle** — masks dollar amounts with `*` so the page
  is screenshot-safe; percentages stay visible.
- **Background chart prefetch** — every successful price refresh
  (initial load + manual Refresh click) silently warms every chart
  range × ticker into `localStorage`, so opening any ticker modal or
  flipping PerfChart range buttons hits cache instead of paying the
  Edge Function round-trip. TTL-aligned per range (5 m / 30 m / 1 h /
  12 h / 12 h); auto-refresh ticks skip the prefetch since they'd
  re-fetch with nothing fresh to show.
- **PWA** — installable on iOS / Android home screen, offline-capable
  via Workbox precache, in-app "new version available" banner.
- **HMAC-signed token auth** — passwords never leave the Edge Function;
  failed-attempt lockout is server-side per-IP (3 wrong → 24 h).
- **Client-side error reporter** — render crashes, fetch failures, auth
  flakes log to a Supabase table so the next debug session starts with
  data, not screenshots.

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
| `utils.js` | `computeMetrics`, FX helpers, `fetchTickers` (live snapshot), `fetchHistorical` / `fetchHistoricalBatch` (race Edge Function vs. CORS-proxy chain, abort losers), formatters, `Storage` namespace, schema-version migration. |
| `data.js` | `INITIAL_PORTFOLIO` seed for first-load demo state. |
| `ytd.js` | Pure chart math. `buildTickerSeries`, `computeAt`, `lotsFor`, `closeOn`, `RANGES`, `fetchParamsFor`, `filterToLatestDay`. Decoupled from React so it's unit-testable. |
| `ytd.test.js` | 19 cases pinning the YTD formula behaviors (pre-year lot, year lot, mixed, missing janPrice, 1D ext mode, intraday date comparison, etc.). |
| `utils.test.js` | 5 cases pinning `fetchHistoricalBatch`'s race behavior (Edge fast path, partial fill, CN-fund proxy bypass, empty input, dedup). |
| `header_sidebar.jsx` | `<Header>` (scoreboard + extended-hours toggle + hide-values eye), `<Sidebar>` (top movers + formation value + perf chart), `<PerfPanel>` (Performance vs S&P 500 chart with range buttons + crosshair), `<MarketConditions>` (8 index/forex cards). |
| `pitch.jsx` | Football-pitch SVG rendering. Position dots, captain armband, hot-mover ball, drag/drop in edit mode. |
| `heatmap.jsx` | One tile per holding, sized by market value, colored by day-change. |
| `modals.jsx` | `<PositionDrillModal>`, `<EditTickerModal>` (incl. lot editor), `<AddTickerModal>`, `<CashModal>`. |
| `ticker_chart_modal.jsx` | Single-ticker price-history modal. Same range buttons as PerfPanel, DOM-ref crosshair (no React rerender on hover), persistent localStorage cache + stale-while-revalidate, 6-digit CN funds restricted to 1M / 3M / YTD. |
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
| `chart` | `?tickers=…&range=1mo&interval=60m&includePrePost=true` → `{ ticker: [{ date, close }, …] }`. Routes CN funds to a 3-tier eastmoney fallback (pingzhongdata → lsjz JSON → danjuanapp), everything else to Yahoo. |
| `ops-error` | `POST { kind, symbol?, message?, context? }` → inserts into `ops_errors`. No auth; size + length capped; per-row IP captured server-side. |

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

| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all | Provided automatically by Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | `data`, `auth`, `ops-error` | From dashboard Settings → API. |
| `APP_AUTH_SECRET` | `auth`, `data` | Long random string (`openssl rand -hex 32`). |
| `APP_ADMIN_PASSWORD` | `auth` | Your admin password. |
| `APP_RO_PASSWORD` | `auth` | Your read-only / shareable password. |

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
