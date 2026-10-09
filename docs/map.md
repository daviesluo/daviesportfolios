# System map

The detailed map behind the [README](README.md): the engineering
notes behind each decision, the stack, every file, the data flow, local
development, how to fork it, and the working conventions. It is updated
in the same commit as the change it describes.

## Engineering notes

How the less obvious parts work, and why they are built the way they are.

- **Live prices** — Yahoo Finance through the `prices` Edge Function,
  which also prices Chinese funds from Eastmoney. Only when the function
  drops a ticker does the client fall back, for that ticker alone, to a
  race across public CORS proxies.
- **Agents (crypto, paper first)** — the Agents page behind the ☰ menu.
  Three strategies run today, all in paper, all reading Kraken's candles
  for their signals, each on Revolut X and, as a paper twin shown for the
  same decisions at Binance's price, on Binance (the page's VENUES shows
  Revolut X and Binance, each card the paper book of that venue's
  strategies; no real balance is shown, and Binance's paper venue reads
  only its public market data, which it serves to any address): 4-hour trend following
  on BTC, ETH, SOL, AVAX and SUI (the candidate for real money), its
  1-hour variant, and 30-day momentum, both on BTC, ETH and SOL. The loop
  runs every minute: quotes, order management, a protective floor under
  cost checked against the bid, and the state on the forming bar (shown
  live on the page); entries wait for closed bars. TypeSafe's **Jev
  1.13** decision model is asked on entries only and can veto one; a
  deterministic risk gate, its limits held in the database, has the last
  word. The basis between the two venues is recorded as the loop runs:
  there is no arbitrage in it, and the record keeps saying so. Positions
  and P&L are derived from fills in one place (the `agents` Edge
  Function). The page has two tabs at the top, LIVE (real money: a row
  labelled live, one still holding real coins, or one that has traded
  them) and TESTING (paper),
  each leading with its own scoreboard (funded, deployed, today since
  00:00 UTC, unrealised and realised G/L; fees on realised),
  venue cards and table. LIVE is that tab's strategy rows. TESTING adds
  the paper tests: the stablecoin quotes' realistic twins (the live
  executor's code on a simulated account) on the Revolut X card, Reward
  quotes as the Polymarket card, all in the scoreboard, so the cards
  still add up to it;
  it opens each strategy in a
  stacked modal with its own scoreboard, a price chart with its fills
  marked, the live state per symbol, its decisions (what the model saw
  and answered, what the rule said), fills and orders. A live order needs
  the row switched to live, an explicit confirmation recorded and the
  gate. `docs/agents/reference.md` holds the verified facts and the
  measurements behind every design rule, including the ones that rule
  out anything faster than an hour (§3.6) and the bar a coin has to clear
  to join a rule (§3.7, tightened to two walk-forward windows in §3.8).
- **Fast cold start** — a cache-primed `portfolio` (`storage.js`'s
  `dp.portfolioCache`, written after every load/save) lets the board
  render and fire its first live-price refresh immediately using the
  last-known holdings, instead of waiting on the portfolio's own network
  round trip. Paired with an Edge Function keep-warm ping
  (`.github/workflows/healthcheck.yml`, every 10 min), a
  parallel-race CORS-proxy fallback in `yahoo_fetch.js` (was a
  sequential loop that could take up to ~40 s per ticker on a fully
  cold session), and a fully **backgrounded CN-fund proxy fallback**.
  That last one was the actual root cause of "the first refresh after
  opening takes ~20 s, in-page refreshes are fast, reopening is slow
  again": the prices Edge Function's `fundgz` upstream gets
  geo-blocked from Deno egress IPs, every response then omitted the
  portfolio's CN fund, and the client walked the proxy list
  sequentially (8 s timeout each, Western proxies rarely reach
  eastmoney at all) while the whole refresh awaited it — fast in-page
  only because the failed proxies were benched in-memory, slow again
  on reopen because that backoff resets with the page. The refresh now
  returns the quotes it has immediately; the missing fund's proxy
  fetch runs in the background and merges into the next tick, and the
  Edge Function itself gained lsjz / danjuanapp NAV fallbacks so the
  fund rarely goes missing in the first place.
- **Multi-currency holdings** — USD / GBP / EUR / CNY / HKD with live FX
  conversion against `GBPUSD=X` / `EURUSD=X` / `USDCNY=X` / `USDHKD=X`.
  Euro-zone tickers are detected by exchange suffix (`.PA` Paris, `.AS`
  Amsterdam, `.DE` XETRA, `.MI` Milan, `.MC` Madrid, …). Only the price
  and avg-cost render in the native currency; everything else converts
  to USD.
- **Chinese mutual funds** — 6-digit fund codes route to eastmoney:
  history via `pingzhongdata`, live NAV via `fundgz`, each with
  `api.fund.eastmoney.com/f10/lsjz` and `danjuanapp.com` (Snowball)
  as JSON fallbacks (the prices path takes the latest two official
  NAVs when the intraday-estimate endpoint is geo-blocked).
- **Yahoo-Finance-equivalent YTD chart math** — per-lot purchase
  history, Jan-1 close as the basis for pre-year lots, lot.cost as
  the basis for in-year lots. The performance panel anchors every
  window at its own first point (both lines from 0 %), except 24H with
  extended hours off: that is the latest regular session measured from
  its previous close, the book from the scoreboard's own previous-close
  value and the S&P from the Market Conditions card's anchor, so its
  ends are the scoreboard's DAY CHANGE and the card (2026-10-07). The
  basis is one number both tabs share, not the per-lot
  `prevCloseBasis` flag that once made the panel read +14.81 % where the
  Investment view of the same window read +16.00 %. Pinned by a vitest
  suite and the perf matrix so the formula can't quietly regress.
- **Two views, one panel** — the centre switches between the football
  tactics board (default) and a heatmap (one tile per holding, sized by
  market value, colored by day-change); beside it the performance panel
  carries two tabs, VS S&P 500 and INVESTMENT, with Yahoo-style range
  buttons.
- **Extended-hours toggle** — switches indices to their futures
  contracts (`^GSPC` → `ES=F` etc.) and recomputes day change against
  the regular-session close so post-market moves show up correctly.
  Non-AH-trading indices (`^VIX`, `^TNX`, `^SOX`) stay on `lastPrice`
  even when Yahoo ships a synthetic `extPrice` for them, so the MC
  cards always match the drill modal. The initial-load prefetch
  pre-warms **both** ext-states' 1D chart caches, so toggling the
  switch is a cache-hit instead of a 1-2 s cold fetch — no manual
  refresh needed. Whenever the toggle is on, the perf-chart legend
  dot flips to `S&P 500 FUTURES` and the panel title says S&P FUT
  (VS S&P FUT on the signed-in tabs; PERFORMANCE VS S&P FUT for a
  read-only viewer, whose title is PERFORMANCE VS S&P 500 otherwise).
- **1D chart spans 24 h** — both in-session and ext-hours views show
  the trailing 24 h. In-session uses Yahoo `range=5d` + a client-side
  `filterToLast24h` cut (Yahoo's `range=1d` only ever covers the
  current session, so yesterday's close was unreachable that way).
  Vertical dashed CLOSE line marks the previous regular close;
  in-session view also renders an OPEN line at today's open. The
  displayed % is "since previous close" in both modes, anchored at the
  **official** regular close (Yahoo `regularMarketPrice` = the same
  `h.lastPrice` `computeMetrics` divides `extDayPct` by) rather than
  the last 5-min intraday bar — so it always agrees with the
  scoreboard's DAY CHANGE and every heatmap tile, ext-on included.
  (The 5-min bar misses the closing-auction cross, which used to make
  the modal read e.g. AVGO +3.85% while the heatmap read +4.12%.)
  DST-aware: open / close UTC hours flip between EDT and EST so the
  markers don't drift Nov–Mar.
- **Live 1D updates** — opening the ticker modal on 1D starts a
  back-to-back polling loop (5 s minimum gap) so intraday bars trickle
  in without needing a manual refresh. Previous bars stay on screen
  during each fetch — no spinner flicker.
- **Overnight line chart** — Yahoo has no overnight bars and T212
  returns only one realtime point, so the overnight session (20:00–
  04:00 ET) used to show a single heartbeat dot. A server-side
  recorder (`overnight-record` Edge Function on pg_cron, every 5 min)
  samples T212's `currentPrice` for every US-equity holding into
  `overnight_intraday_points`; the modal splices those points onto the
  Yahoo series to draw a real overnight **line** on 1D / 1W / 1M, with
  the rightmost point tracking the live price. The merge step-samples
  the recorded 5-min points to match each range's bar cadence — 1D
  keeps every point, 1W keeps every 3rd (= 15 min), 1M keeps every
  12th (= 60 min) plus the live tail — so today's ~130 overnight
  points don't dwarf the multi-day axis on 1W / 1M (without this they
  occupied the right ~50% / 25% of the chart). The recorded points are
  warmed into `dp.overnight.cache` as part of the **same preload wave**
  as prices / MC / chart series — fired in parallel on page-entry +
  manual Refresh AND **awaited** before "Last updated" flips, so when
  the user sees the refresh complete the cache is guaranteed hot and a
  modal click shows the full overnight line immediately (no on-demand
  fetch flash). Re-fired on every 30 s overnight auto-tick to keep an
  already-open modal live. Runs even with no browser open; falls back
  to the single dot until ≥2 points exist.
  One-time setup: enable `pg_cron`/`pg_net` and store the function's
  `CRON_SECRET` in Supabase Vault as `cron_secret` (migration `0021`).
- **1Y range** — trailing-12-month price button, sits right after YTD
  on every ticker / market-conditions modal (a modal-only range; the
  portfolio PerfChart keeps its Jan-1-anchored YTD and isn't given a
  1Y button it has no cost-basis model for). 1y of daily Yahoo bars
  under a 200-day moving average drawn from a two-year daily fetch.
- **P/E 1Y view** — valuation range button on the ticker chart modal
  for stocks with positive trailing EPS plus four big US indices
  (`^GSPC`, `^NDX`, `^RUT`, `^SOX`) via Alpha Vantage `OVERVIEW`
  against ETF proxies (SPY / QQQ / IWM / SOXX), with a 24 h
  Supabase-table cache so we hit AV at most 4× per day no matter
  how many clients refresh. **Per-stock P/E + EPS** comes from
  Yahoo `quoteSummary` (`summaryDetail.trailingPE` /
  `defaultKeyStatistics.trailingEps`), with Finnhub `/stock/metric`
  as the fallback when Yahoo's crumb handshake fails or it's
  rate-limited. Yahoo's quoteSummary now requires a crumb token
  (cookie → `/v1/test/getcrumb` → `&crumb=…`); see `getYahooCrumb`,
  handshake once per Edge Function worker, cached in module scope.
  FMP was the primary source through the ADR-currency-fix saga but
  retired its `/v3/` endpoints and paywalled the `/stable/`
  replacements, so the whole FMP layer was removed — Yahoo's
  quoteSummary ratios are USD-correct for ADRs anyway (the
  consumer site has to show coherent numbers), unlike Finnhub's
  `peTTM` which divides the USD ADR price by the foreign-currency
  reported EPS (TSM ≈ 1.22 / SFTBY ≈ 0.07 / ASML ≈ 63 — the bug
  the whole saga was about). The 3-year-average reference line
  draws from Finnhub's annual P/E series. **Trailing TTM EPS
  history** comes from Yahoo's `fundamentals-timeseries` endpoint
  (`trailingDilutedEPS`, 5+ years of pre-summed quarter-end TTM
  EPS) so the chart re-anchors at every earnings report —
  `price ÷ TTM EPS` using the TTM as-of that bar's date, not a
  single constant. P/E visibly steps on report days instead of
  being a 1:1 scale of the price chart. For ADRs the history is
  reported in the underlying foreign currency (TSM in TWD, SFTBY
  in JPY, ASML in EUR), so the Edge Function rescales it to USD
  via `normalizeEpsHistoryToUsd` using a **USD-anchor cascade**:
  Yahoo quoteSummary `price/pe` → Yahoo `/v8/finance/chart`
  `meta.regularMarketPrice ÷ trailingPE` (the no-crumb endpoint,
  what Yahoo's own consumer site uses). The client never
  re-scales — doing it client-side leaks client/server
  price-timing skew into the chart even for already-correct US
  stocks. Y-axis swaps to bare P/E values, modal header shifts to
  "P/E RATIO". A secondary **PEG** line renders on its own row
  below the P/E value when Yahoo published Forward P/E
  (`summaryDetail.forwardPE`). The math is forward-over-forward
  (`forwardPE ÷ (growth × 100)`) so the numerator's horizon
  matches the denominator's — pairing trailing P/E with forward
  growth is the classic PEG misuse and we deliberately avoid it.
  Growth is the **blended 2y forward EPS growth** — `computeForwardGrowth`
  averages Yahoo's `earningsTrend.trend[0y].growth` (current FY)
  and `[+1y].growth` (next FY) consensus rates. Yahoo retired its
  `+5y` long-term-growth bucket (confirmed gone in the May-2026
  prod probe), so the two near-term annual buckets are the only
  free forward-CAGR left; averaging them is steadier than any
  single year for the cyclical tech / semi names where one fiscal
  year can land on a cycle peak or trough. Buckets with
  non-positive growth are dropped before averaging. Hidden
  whenever the growth row is missing, zero, or negative (negative
  growth makes PEG itself negative, and most data vendors hide it
  in that case rather than render a number that doesn't fit the
  "~1 = fair value" interpretation). For ETF-proxied indices the client
  reconstructs an implied EPS from `lastClose / pe` (Finnhub
  returns no aggregate EPS at the index level) and stays on
  const-EPS. Futures / other indices (`^VIX`, `^TNX`) / crypto /
  forex stay button-less. **Pre-profit loss-makers** get the
  parallel P/S 1Y button below instead.
- **P/S 1Y view** — same range-button slot for **loss-makers**
  (pre-profit companies where Yahoo / Finnhub publish no trailing
  P/E because EPS ≤ 0). Mutually exclusive with the P/E button:
  profitable tickers see P/E 1Y, unprofitable tickers see P/S
  1Y, never both. Source chain: Yahoo
  `summaryDetail.priceToSalesTrailing12Months` as primary
  (USD-correct for ADRs since Yahoo reports the ADR-side number
  directly) with Finnhub's `psTTM` as fallback. The 3-year-average
  reference line averages the 3 most recent entries of Finnhub's
  `series.annual.ps` and draws as a dashed gray line the same way
  the P/E view does. The series math reuses
  `priceDividedByTtmEps` with a TTM-sales-per-share history when
  Yahoo published quarterly revenues: the Edge Function pulls
  `quarterlyTotalRevenue` from `fundamentals-timeseries`, runs
  `rollingTtmFromRawQuarterly` to sum each set of 4 consecutive
  quarters into a TTM series, rescales the absolute revenue to
  per-share via `normalizeEpsHistoryToUsd(salesHist, usdPrice / ps)`
  so the latest entry anchors to the live `lastClose / ps`, and
  returns it as `ttmSalesHistory`. Earlier the code tried
  `trailingTotalRevenue` from the same endpoint, but the May-2026
  prod probe showed Yahoo only publishes 2 (often-stale,
  often-inconsistent) annual points there — useless as a TTM
  series. When `ttmSalesHistory` is missing the chart falls back
  to `history = null` (const current sales-per-share, every bar
  flat at today's ratio) instead of erroring — preserves the YTD
  view for tickers without quarterly history. Header copy swaps to
  "P/S RATIO" and the basis chip reads "(price ÷ TTM sales per
  share)". When neither pe/eps nor ps is usable (very rare —
  IPOs that haven't published a revenue figure yet), the modal
  renders the soft "P/E not available — N/A" panel instead of
  an error, since that's a legitimate financial state not a bug
  to log.
- **Moving-average overlays** — every multi-day chart (1W / 1M /
  3M / YTD / 1Y) gets a gray N-day SMA drawn under the price line,
  labelled `MA 5` / `MA 10` / `MA 20` / `MA 50` / `MA 200` in the right
  margin (same position style as the P/E view's 3Y AVG marker).
  Computed bar-based on a same-interval wider history fetch
  (1mo/15m for 1W, 3mo/60m for 1M, 6mo/60m for 3M, 1y/1d for YTD,
  2y/1d for 1Y)
  so the line updates every bar — no day-boundary stair-stepping
  on intraday views — and is strictly causal (no future data).
  CN funds / `.PVT` placeholders override the bar count to plain
  N-day SMA on the daily-only data they get. Display series and
  the wider history are combined + deduped by timestamp so the
  line spans the full chart even when the wider history cache
  drifts behind the live display fetch.
- **VWAP overlay on 1D** — Volume-Weighted Average Price drawn as
  a gray line on every 1D chart that has per-bar volume (US
  equities, crypto, futures, LSE/HK names; skipped on forex /
  yields / `^VIX` / CN funds since they have no usable per-bar
  volume). Strictly causal cumulative `Σ(close × volume) / Σ(volume)`
  per session; per-asset anchor — US equities reset at the trading
  open (09:30 ET when the ext-hours toggle is off, **04:00 ET
  pre-market open when it's on** so the VWAP spans pre / regular /
  AH as one ramp); crypto (`-USD`) at 00:00 UTC; other markets
  (LSE / HK / futures) at 00:00 UTC. Forward-fills sparse-volume
  bars (BTC-USD's hourly-only volume on Yahoo) with the last seen
  volume in the session so the line stays smooth instead of
  stair-stepping. Path breaks at every session reset (no ghost
  segment across the boundary). Label `VWAP` sits in the right
  margin.
- **Holding stats in the chart modal** — when the modal opens on
  a holding (not an MC ticker), a second line under the price
  shows `Shares · AC · Cost · Value (X.XX% of portfolio) · G/L`
  in the same format as the position-drill card. Honours the
  hide-values privacy toggle (digits masked, percentages stay).
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
  `^RUT` additionally show a P/E 1Y chart with a 3-year-average
  reference line, sourced via the fundamentals Edge Function's
  index → ETF proxy (SPY / QQQ / IWM publish a trailing P/E that
  stands in for the underlying basket).
- **Hide values toggle** — masks every digit of money, prices and share
  counts with `•` so the page is screenshot-safe; percentages stay
  visible.
- **FX-missing badge + stale-price indicator** — when a multi-currency
  holding's FX pair (GBPUSD=X / EURUSD=X / USDCNY=X / USDHKD=X) is missing from
  the live quote, the header surfaces a red `FX MISSING N tickers`
  pill instead of silently valuing the holding at 1:1 USD (which was
  understating GBP portfolios by ~20 % during brief Yahoo FX
  outages). Render is gated on a `marketDataReady` flag that flips
  true only after the first successful `fetchTickers` reply, so the
  cold-start window (where `marketData` would otherwise be the empty
  default and every non-USD holding briefly "looks" FX-missing)
  doesn't flash the pill for half a second on every page load.
  The cold-start window is also seeded from `dp.marketCache` (see
  `Storage.loadMarketCache` in storage.js — the full last-tick MC +
  FX snapshot, max age 7 days), so the **portfolio total prints
  the right number from the first paint** instead of the previous
  "1:1-USD-fallback flashes high, then snaps to real after
  the live tick" behaviour for CNY-denominated holdings. The
  underlying `metrics.fxMissingTickers` detection is unchanged —
  a genuine later-tick outage (marketData populated for everything
  except the FX pair) still triggers the pill. Same row: a
  `STALE Nm` pill appears whenever the last successful price fetch
  is more than 5 min old, so a dead Edge Function can't quietly
  leave the scoreboard stuck on old numbers while the auto-retry
  loop churns in the background.
- **Admin error-triage badge** (desktop only) — admin viewers get a
  red `N ERRORS / last 24h` pill in the header that polls
  `/functions/v1/ops-error?action=summary&hours=24` every 60 s.
  Click opens a modal with the byKind / bySymbol breakdown, so
  routine triage doesn't require opening the Supabase SQL editor.
  An **Acknowledge** button in the modal's header stores the newest
  error's timestamp in this browser (`dp.opsErrorAck`) and hides the
  badge until an error newer than that arrives — nothing is changed on
  the server, which keeps every row for the 30-day retention sweep.
  Lets the admin clear known-resolved noise (e.g. an upstream Yahoo
  outage already triaged) without losing the record. The whole component is gated on
  `matchMedia('(min-width: 761px)')` — the mobile header layout
  (≤ 760 px) has no room for an extra pill and the earlier
  CSS-only hide still mounted, polled and flashed for a couple of
  seconds before the layout collapsed it. Now on phones the badge
  never mounts, never fetches, never paints; only desktop viewers
  carry the polling weight. Hidden for read-only sessions; the
  underlying endpoint also rejects non-admin tokens server-side.
- **Background chart prefetch (IndexedDB-backed)** — every successful
  price refresh (initial load + manual Refresh click) silently
  warms every chart range × ticker into IndexedDB via
  [`idb-keyval`](https://github.com/jakearchibald/idb-keyval),
  so opening any ticker modal or flipping PerfChart range buttons
  hits cache instead of paying the Edge Function round-trip. Coverage
  spans the portfolio holdings, the S&P benchmark AND every
  Market-Conditions card including the futures alternates (`^GSPC` /
  `ES=F`, `^NDX` / `NQ=F`, `^RUT` / `RTY=F`, `^SOX`, `^VIX`, `BZ=F`,
  `^TNX`, `GBPUSD=X`, `GBPCNY=X`, `USDCNY=X`) — plus the FUND row
  (eps / pe / pe3yAvg / ttmEpsHistory) and the TTM-aware P/E 1Y
  series for every eligible ticker, plus the MA overlay's wider
  history series for every chart range. **Storage moved off
  localStorage to IndexedDB in 2026-05** because the previous chart
  cache regularly hit the per-origin ~5 MB localStorage quota at
  ~30 tickers × all ranges × variants, after which every save
  silently failed (the user reported "switch ranges and back, still
  has to reload"). IDB has 100+ MB of quota and no realistic ceiling
  for our workload, so the prefetch can be as thorough as it wants
  without trim-thrashing. A synchronous in-memory mirror is
  hydrated from IDB at module load so the modal's `useState`
  initializer can paint a warm-cache chart on the very first render
  with no spinner flash. Per-range writes happen immediately as each
  fetch resolves (parallel `Promise.all`) so fast ranges (1D / 1W /
  YTD) land in cache without waiting on the slow ones (the two
  60-minute `3mo` pulls behind 1M's MA history and 3M's own bars).
  TTL-aligned per range (5 m / 15 m / 1 h / 1 h / 12 h), a chart
  range's row aged from when its fetch was asked, not when the
  answer landed (an answer that lands after a gap is not new); auto-refresh
  ticks skip the prefetch since they'd re-fetch with nothing fresh
  to show.
- **PWA** — installable on iOS / Android home screen, offline-capable
  via Workbox precache, in-app "new version available" banner.
- **HMAC-signed token auth** — passwords never leave the Edge Function;
  failed-attempt lockout is server-side per-IP (3 wrong → 24 h).
- **Client-side error reporter** — render crashes, fetch failures, auth
  flakes log to a Supabase table so the next debug session starts with
  data, not screenshots.

---

## Stack

- **Frontend** — React 19 + Vite 8, plain JSX type-checked with
  `checkJs` + JSDoc (no `.tsx`). The production bundle is built into
  `dist/` and committed; `dist/` is the only directory Cloudflare Pages
  serves. Four runtime dependencies (`react`, `react-dom`, `idb-keyval`,
  `html2canvas-pro`); the heavy one, `html2canvas-pro` (chart-modal
  screenshots), is `import()`-ed lazily so it never lands in the main
  bundle.
- **Backend** — Supabase (Postgres + Edge Functions on Deno). Fourteen
  functions: `auth`, `data`, `prices`, `chart`, `fundamentals`,
  `ops-error`, `trading212`, `overnight-fetch`, `agents` and `weather`;
  two recorders that `pg_cron` calls, `snapshot-record` (every board price,
  every five minutes) and `overnight-record` (Trading 212's overnight
  quotes); `edge-watchdog`, which runs a call of the minute job again when
  its worker never started; and `monitor`, which the Cloudflare Worker below
  calls. Shared Deno modules live in `supabase/functions/_shared/`.
  Migrations `0001`–`0053`, plus four timestamped records of changes that
  were first applied out of band (`supabase/migrations/README.md`);
  `0005`/`0006` are a historical create/drop pair for the retired
  `analyst_estimates_cache` table.
- **Build / CI** — Vite production bundle; Vitest for unit and component
  tests (`jsdom` + `@testing-library/react`); `tsc --noEmit` for
  type-checking; ESLint; knip; size-limit; Playwright for the browser
  sweep. Seven GitHub Actions workflows: `check.yml` (every push:
  type-check, lint, unit tests, a build that must reproduce the committed
  `dist/` byte for byte, dead-code scan, dependency audit, and on that
  committed bundle the browser sweep, the perf matrix and the size budget;
  the source checks, the sweep's four shards and the perf matrix with the
  size budget run as jobs at once),
  `edge-functions.yml` (`deno check` + `deno test`, then on push to main
  an auto-deploy of every function whose folder changed since the
  workflow's last successful run, or of all of them when
  `supabase/functions/_shared/` changed),
  `migrations.yml` (PR-time SQL lint; on main, `supabase db push` applies
  any new migration against production's `schema_migrations`),
  `pages-deploy.yml` (on a `dist/` change to `main` once `check.yml` has
  passed on that commit, or by hand: Wrangler Direct Upload of the
  committed `dist/`, no Pages Git clone),
  `healthcheck.yml` (asks for every 10 minutes, which GitHub's scheduler
  treats as best effort: pings the production functions and checks the live
  site's shell and chunks), `monitor-deploy.yml` (on a change to
  `workers/monitor/`, or by hand: deploys the monitor Worker, and sets
  `MONITOR_SECRET` on both sides when asked or missing) and
  `monitor-alert.yml` (started by the monitor Worker: opens or comments on
  the issue labelled `monitor`). Each opens or bumps a GitHub issue when it
  fails.
- **Monitoring** — a Cloudflare Worker, `daviesportfolios-monitor`
  (`workers/monitor/`), runs every minute on Cloudflare's clock, outside
  both GitHub's scheduler and Supabase's `pg_cron` (on 2026-10-02 the
  database stalled for 80 minutes and nothing alerted: GitHub had run the
  10-minute health check 9 times in 48 hours). It checks the live site's
  shell and app chunk, Supabase's minute loop (the `monitor` function's
  read-only health action: the tick's beat and finished turn, PR5's
  executor, the newest decision) and PR5's dead-man switch, which cancels
  every resting order on PR5's Revolut X sub-account when its executor has
  missed three turns, or when its state cannot be read and no read in the
  last three minutes found it fresh (the Worker remembers that read in a
  Durable Object, since a stall makes the database unreadable). A check
  that fails two minutes running alerts, and
  again when it recovers, two ways: a row in the site's errors box
  (`ops_errors`, kinds `monitor.*`) and a GitHub issue labelled `monitor`
  (`monitor-alert.yml`, opened by github-actions, so its owner is notified).
  Its state is one Workers KV key, written only when it changes; a report
  Supabase cannot take waits there until it can.
- **Hosting** — Cloudflare Pages publishes `dist/` from `main`. `_headers`
  pins cache rules so iOS PWA can't get stuck on a stale `index.html`
  pointing at deleted hashed bundles. **A chunk that fails to load never
  takes the app down** (found the hard way on 2026-09-21): Pages answers a
  path that does not exist with the HTML shell, and while the `/assets/*`
  rule said "immutable for a year" that fallback was cached under any chunk
  name a browser asked for a moment before a deploy had propagated — the
  service worker then precached the same HTML, and every sub-page died with
  "'text/html' is not a valid JavaScript MIME type" until the next deploy.
  Three defences, each pinned: (1) no long-lived `Cache-Control` on
  `/assets/*` (Pages' default revalidates with ETags) and a `404.html`
  built beside `index.html`, so a missing chunk is a 404 the worker refuses
  to precache; (2) `src/app/chunk_recovery.js` — a page chunk that fails to
  load refreshes the browser's copy, drops every service worker and cache,
  reloads once and reports `chunk.load`, and each page has its own
  boundary that shows the page's frame with the words instead of a
  whole-app RENDER ERROR (since 2026-10-02 every panel and modal has one,
  `src/app/surface_boundary.jsx`); (3) the sweep answers a chunk with the poisoned
  response and asserts the heal, and the scheduled health check fetches
  the live shell, verifies every chunk it references is JavaScript and
  that a chunk that does not exist is a 404 without an immutable header.

---

## File map

One line per file: what it is for. Why a file is built the way it is
lives in its own comments; what happened to it lives in `docs/LEDGER.md` and
git. Until 2026-09-23 each row here told its file's whole story, and
that longer text is still in git (`git show 75cd4e1:docs/map.md`).

### `src/` — the web app

An npm project of its own, sorted by what each part of the page does.
Tests sit beside the module they cover, as `<name>.test.js` or
`<name>.test.jsx`; the two browser tests are in `e2e/`.

#### The top of `src/`

The npm project's own files (`package.json` and the rest are under "Build, CI and docs" below), the page, and the static files.

| File | What it does |
|---|---|
| `index.html` | The page Vite builds from; it loads `app/main.jsx` and preloads the two Latin font files. |
| `public/_headers`, `public/robots.txt` | Copied into `dist/` as they are: Cloudflare's cache and security headers, and a site-wide noindex. |
| `vite.config.js` | The build: React, the PWA service worker, output to `dist/`, the build stamp (a hash of the source, so a build is reproducible), and Vitest's settings. |
| `build_stamp.js` | The build's stamp: a hash of the app's source as git would commit it, never the clock, so a commit's bundle rebuilds byte for byte. |
| `eslint.config.js`, `test_setup.js` | The lint rules for `src/`, and the Vitest setup that adds the DOM matchers and refuses any fetch beyond this machine. |

#### `app/` — the shell

Startup, the root component, sign-in, what the browser keeps, error reports, and what every view shares: styles, formats, types and icons.

| File | What it does |
|---|---|
| `app/main.jsx` | Mounts `<App>` and registers the service worker. |
| `app/app.jsx` | `<App>`, the password gate, and `<Board>`, the whole UI: portfolio state, the refresh loop, which modal is open. The first paint is the cached portfolio at the prices it last showed; the server's copy replaces the book, the live quotes the prices. |
| `app/auth.js` | Turns a password into a signed token: reads `?pwd=` once and strips it, calls the `auth` function, reuses a valid token from the session. |
| `app/supabase_config.js` | The Supabase URL, the public anon key and each Edge Function's URL. |
| `app/storage.js` | Everything the browser keeps under `dp.*`, with one schema version and its migrations, including the portfolio, prices, dividends and 24H chart a reload paints first. |
| `app/sw-banner.jsx` | The "new version available" banner. It checks every minute and whenever the tab comes back. |
| `app/chunk_recovery.js` | Loads each page's code: a page already fetched opens at once; one whose code fails to load after a deploy is fetched fresh, the service worker and caches dropped, the app reloaded once and the failure reported. |
| `app/surface_boundary.jsx` | One error boundary per surface (each panel, the header, the board, the sidebar, every modal and Agents page): a throw shows "failed to load" with a Retry in that surface's place and is reported under its name. |
| `app/ops_error.js`, `app/ops_error_badge.jsx` | Sends client errors to `ops-error`, rate-limited; the admin-only header badge groups the last 24 hours. |
| `app/version.js` | The build stamp (minute-precision CalVer) that every error report carries. |
| `app/types.d.ts`, `app/ambient.d.ts` | Shared JSDoc types, and declarations for the build stamp and CSS imports. |
| `app/styles.css` | Every style, in one sheet. |
| `app/fonts.css` | The two typefaces, Inter and JetBrains Mono, served from this site out of `app/fonts/` (with their licences), not from Google Fonts. |
| `app/formatters.js` | Money, percent, price and share formats, the one month table, and the names shown for tickers. |
| `app/icons.jsx` | The small inline icons. |

#### `portfolio/` — the book and its ledger

| File | What it does |
|---|---|
| `portfolio/data.js` | A demo portfolio with made-up share counts, shown only when the real one cannot load. |
| `portfolio/portfolio_remote.js` | Loads and saves the portfolio through the `data` function, and upgrades older saved shapes. |
| `portfolio/portfolio_saver.js` | Sends the board's saves one at a time, counts a change saved only when the server takes it, retries a failed save with a bounded backoff, and decides whether a reload replays an unsaved draft or raises the conflict bar. |
| `portfolio/shown_prices.js` | The prices each holding last showed, drawn over the book after a reload until the live quotes land, and never saved. |
| `portfolio/portfolio_edits.js` | The board's edits: change, add, move or remove a holding, swap two positions, rename one. |
| `portfolio/positions.js` | Where the 11 positions sit on the pitch. |
| `portfolio/metrics.js` | The per-position totals behind the scoreboard, the heat map and the drill-downs, and the day-change bases the 24H chart shares with them. |
| `portfolio/lots.js` | Cleans and sums the buy lots the editor collects. |
| `portfolio/transactions.js` | Sales, the net position and realised gain from a holding's buys, sells and dividends. |
| `portfolio/fx.js` | Which currency a ticker trades in, and its rate to USD. |
| `portfolio/trading212.js` | The client half of the broker sync: positions, live prices, the fill history in each fill's own currency and the dividends, applied without touching shares held at another platform; a slice sold out at the broker comes off only when every account answered and its fills net to zero. |
| `portfolio/t212_fills.js` | Rebuilds a holding's lots from the broker's fills, keeping the lots bought elsewhere; turns its dividends into the ledger's events and the average cost the site shows. |

#### `prices/` — prices, history and the caches

| File | What it does |
|---|---|
| `prices/yahoo_fetch.js` | Live prices: the `prices` function first, a public CORS proxy only for a ticker the function dropped; each quote tagged with its source, and a held one asked of the other. |
| `prices/quote_band.js` | The plausibility band at the write: a holding's quote that cannot be the same instrument in the same units as its last good one is held (the last good price stays), reported, and believed once a second source agrees. |
| `prices/proxy_chain.js` | The public CORS proxies, each backed off for a while after it fails. |
| `prices/historical.js` | Chart bars: the `chart` function first, proxies only when it fails outright; Chinese fund history; today's regular close. |
| `prices/market_hours.js` | Time helpers that know about daylight saving: US, London and euro-zone market hours, US holidays, and the 3M chart's four-hour grid. |
| `prices/ticker_class.js` | What kind of instrument a ticker is (crypto, future, FX, index, Chinese fund, …) and how much of the week it trades. |
| `prices/cache.js` | How long each kind of chart data stays fresh, and the cache keys. |
| `prices/chart_store.js` | The IndexedDB chart cache — one database holding all three stores — with an in-memory copy for instant reads. |
| `prices/prefetch.js` | Warms every chart range in the background after a load or a manual refresh. |
| `prices/overnight_intraday.js` | Reads the recorded overnight quotes for US stocks and splices them onto the chart. |
| `prices/price_snapshots.js` | Reads the server's five-minute price records and merges them into the chart's bars. |

#### `charts/` — the performance panel, the ticker chart and their maths

| File | What it does |
|---|---|
| `charts/ytd.js` | The portfolio's value and cost basis at any moment, from lots and sales: the one function every performance number goes through. |
| `charts/deposit_series.js` | Money paid in over time, from the broker's fills and the ledger, for the Investment chart. |
| `charts/investment_view.js` | The Investment chart's axis steps, labels and legend arithmetic. |
| `charts/indicators.js` | Moving averages, VWAP, and the P/E and P/S series. |
| `charts/chart_geometry.js` | SVG helpers both chart components share: pointer to data point, the line's path, where each regular session opens and closes. |
| `charts/chart_modal_geometry.js` | The ticker chart's scales, anchor price and axis ticks. |
| `charts/perf_chart.jsx` | The performance panel: the S&P comparison and the Investment chart in one slot. |
| `charts/ticker_chart_modal.jsx` | The chart for one ticker, 1D to 1Y, with its overlays and holding stats. |
| `charts/ticker_chart_helpers.js` | The chart modal's constants, display names, price formats and cache wrappers. |
| `charts/use_ticker_chart_data.js` | The chart modal's price data: the fetches, the live 1D poll and the overnight points. |
| `charts/use_ticker_fundamentals.js` | The chart modal's P/E, P/S, PEG and share-count data. |
| `charts/screenshot.js`, `charts/screenshot_actions.jsx` | Copy or save a chart as an image. |

#### `board/` — the home page

| File | What it does |
|---|---|
| `board/movers.js` | Who counts as a top mover, over which window, ranked how. |
| `board/header_sidebar.jsx` | The scoreboard, Top Movers, Market Conditions, Upcoming Earnings and the rest of the sidebar. |
| `board/pitch.jsx` | The tactics board, with drag-to-swap in edit mode. |
| `board/heatmap.jsx` | The heat map: one tile per holding, sized by value. |
| `board/modals.jsx` | The frame every modal draws in and the confirm dialog. On a phone the top modal is the page itself, so it fills the strip under the toolbar. |
| `board/position_drill.jsx` | The sector drill-down and its player cards, a chunk loaded after the first paint. |
| `board/edit_modals.jsx` | The lot and sale editor and the add-ticker and cash dialogs, a chunk loaded after the first paint. |

#### `tables/` — the three tables and their export

| File | What it does |
|---|---|
| `tables/holdings_list.jsx` | The sortable holding list. |
| `tables/sectors_list.jsx` | The same list grouped by sector. |
| `tables/transaction_history.jsx` | Every buy, sale and dividend, closed positions included. |
| `tables/table_export.jsx`, `tables/holdings_export.js` | Copy and Excel export for the three tables, formatted exactly as the tables show them. |

#### `agents/` — the Agents page

| File | What it does |
|---|---|
| `agents/agents.jsx`, `agents/agents.js`, `agents/agents_chart.js` | The Agents page: LIVE and TESTING tabs, each with its own scoreboard, venue cards and table; each strategy's status, deployed amount, positions, orders and chart, the paper tests' rows and pages, and the live stablecoin quotes' row and page, read from the `agents` function and kept in the browser so it opens drawn. |

### `supabase/functions/` — the server

Deno. Each function's tests sit beside it as `index.test.ts`.

| Function | What it does |
|---|---|
| `auth` | Checks a password and returns a signed token; locks an IP out after three wrong tries, for longer each time. |
| `data` | Loads and saves the portfolio, refusing a save from a stale tab, and serves the recorded prices. |
| `prices` | Live quotes for every holding and market card from Yahoo, and Chinese funds from Eastmoney. |
| `chart` | Price bars for the charts, from Yahoo or Eastmoney. |
| `fundamentals` | P/E, P/S, EPS history and market cap from Yahoo, Finnhub and Alpha Vantage, cached; one file per source (`_yahoo.ts`, `_finnhub.ts`, `_alphavantage.ts`) plus `_caches.ts`, `_math.ts` and `_shared.ts`. |
| `trading212` | The broker's positions and prices, cached to respect its one-call-a-second limit and saying whether every account answered (its refusals reach the errors box), its fill history with each fill's currency, and the dividends both accounts received, walked by the one-minute job every ten minutes as well as by the admin page. |
| `snapshot-record` | Run by pg_cron every five minutes: records one price per board ticker, in the board's units (a price 100 times the board's own is never written). |
| `overnight-record` | Run by pg_cron through the US overnight session: records Trading 212's overnight quotes. |
| `overnight-fetch` | Serves the recorded overnight quotes to the chart. |
| `ops-error` | Stores error reports and serves the admin summary. |
| `agents` | The crypto loop and its page (below). |
| `weather` | The keyed weather feeds behind Polymarket's temperature markets, read-only: its probe checks the Météo-France key (`meteofrance.ts`) and the FAA's SWIM subscription (`faa_swim.ts`, through Solace's client in `solace.ts` and the Deno TLS shim in `solace_tls.ts`); `probe.ts` handles the request. Run by the scheduler's bearer only. |
| `edge-watchdog` | A row of the one-minute job: 13 s into its minute it runs again, once, each due call that wrote no beat because the platform never started its worker, and records what each retry answered. Run by the scheduler's bearer only. |
| `monitor` | The monitor Worker's half inside Supabase, called every minute by the Worker with `MONITOR_SECRET`: PR5's dead-man switch (`deadman.ts`), the minute loop's read-only health readings and the database's size beside them (`health.ts`), and the Worker's alerts into the errors box. Imports nothing of `agents`. |

#### `agents/` and `_shared/`

| File | What it does |
|---|---|
| `agents/index.ts` | The entry point: the minute's tick, the paper quote test's minute and its live executor's, PR5V's replay and rule D's, the realistic twins' minute, RW's paper minute and daily selection, Polymarket's order path and its mid-pool instance with their paper layers, the one-off stablecoin conversion, the page's dashboard, log and chart reads, and the read-only `probe` (`?only=` picks its parts) and `jev` checks. |
| `agents/binance.ts`, `agents/deribit.ts` | Read-only clients for the Binance and Deribit keys (the probe's checks, Deribit's volatility index), and Binance's paper venue, which reads public market data for its paper rows. Nothing in them can trade. |
| `agents/youtube.ts` | A read-only YouTube Data API client for the public view counts behind Polymarket's view-count markets, with the probe's `youtube` part. The key goes in a header, never a URL. |
| `agents/views.ts` | Records Polymarket's view-count markets and the YouTube counters they resolve on: every minute, and every second around each market's deadline, stored when they change. Reads only. |
| `agents/tick.ts` | One turn of the loop: quotes, open orders, stops, then a decision on each newly closed bar. |
| `agents/quotes.ts` | The paper test of PR5's quotes on Revolut X's GBP stablecoin books: the frozen rule one minute at a time, run every minute, storing every input beside every outcome, and since `0055` the X and fair each decided minute read. Off the page since 2026-10-02: its realistic twin is TESTING's "Stablecoin quotes". |
| `agents/pm_live.ts` | Polymarket's order path for the live calibration of liquidity rewards: every minute from eu-west-1, RW's quotes on the day's rewarded markets from $6 to under $10, each minute's formula reward against the book with our quotes in it and, once a day, what Polymarket paid for the markets that path quoted live; a dry-run until its config row is unlocked. It runs as an instance (its tables, lease, band and its selection's exclusion or book-quality rule); mini-pool's is the default with its book-quality rule. |
| `agents/quotes_live.ts` | Carries the paper quote test's decisions to PR5's own Revolut X sub-account, order for order, under the design's hard limits, and quotes no entry while the dead-man switch has not run for five minutes; in dry-run until two settings say live. It runs as an instance (its tables, lease, rungs, exit re-price and governed keys), the live account by default. |
| `agents/quotes_live_frozen.ts` | The live executor as it was before it became an instance, byte for byte, run only by `quotes_live_instance.test.ts` beside today's default instance. |
| `agents/quotes_live_instance.test.ts` | Runs the executor's default instance beside the frozen one over six simulated hours, turn by turn, and finds every table, the account and every report the same. |
| `agents/quotes_twin.ts` | The realistic twins, TESTING's "Stablecoin quotes" rows: each a row of `agent_quote_twin_specs`, the live executor's code on a simulated Revolut X account carrying out its engine's paper decisions (PR5's or rule D's) at its size, minute by minute, with its replica of the engine checked against that engine's record, and the loader of their backfills. |
| `agents/revx_sim.ts` | A simulated Revolut X account for the twins: it answers the live client's calls from memory, fills a resting order only by the public prints strictly through it, a take against the book recorder's read after it, and moves money as the venue moves it. |
| `agents/quotes_twin.test.ts`, `agents/revx_sim.test.ts`, `agents/quotes_take.test.ts` | Pin the simulated account's rules with figures worked out by hand, the twins' start, dead-man, operator's conversions, replica, day tally and backfill load in a world built by hand, and TAKE's taker entry rule by rule. |
| `agents/quotes_variant.ts` | PR5V on paper ("Stablecoin quotes variant-1" until 2026-10-02, off the page since): PR5's stored minutes replayed through PR5V's rule (nine rungs a side, one volume cap a side, four governed keys) in two arms, into tables of its own. |
| `agents/quotes_variant.test.ts` | Replays PR5V's golden windows trip for trip and POST for POST, and pins the variant's driver on the in-memory database. |
| `agents/quotes_ruled.ts` | Rule D on paper ("Stablecoin quotes variant-2" until 2026-10-02, off the page since; its arm `d`'s realistic twin is TESTING's "Stablecoin quotes variant-3", variant-1 until 2026-10-03): the same decision function on PR5V's rate with rule D on entries, in tables of its own. |
| `agents/quotes_ruled.test.ts` | Pins rule D's band, that both arms decide on PR5's stored rate with no feed read, and that the driver writes none of variant-1's tables. |
| `agents/pm_prep.ts` | The order path's paper layer, first mini-pool's: its dry-run orders filled on paper from Polymarket's public prints by RW's rule, two minutes behind, with the path's own P&L, stops and settlement, into its own tables; nothing of the path's written. One instance beside each instance of the path; live-prep's fills the path's sells too and keeps no stop of its own. |
| `agents/pm_prep_view.ts` | The order path's paper layers ("Reward quotes mid-pool" and "live-prep" on the Agents page; mini-pool's still in the payload, off the page since `0103`) in RW's shape: each row and its Reward quotes page, every figure from its layer's own records by the functions that made them. |
| `agents/pm_prep_stress.ts` | The paper layers' worst case at the start of each UTC day, so their DAYS table shows one for every day and today's live: the layer's own state when it rests at 23:59, its first day at 0, and a day it missed replayed from the day before's row and the day's records. |
| `agents/pm_prep_stress.test.ts` | Pins the replay by hand, the recorder's three sources and their order, and that the replay is the layer: mini-pool's over RW's golden record across midnight and live-prep's path and layer together, minute by minute and in catch-up runs. |
| `agents/pm_live_frozen.ts`, `agents/pm_prep_frozen.ts` | The order path and its paper layer as mini-pool's pre-registration (`2026-10-01-polymarket-live-prep-prereg.md`, its first name) froze them, byte for byte, run only by `pm_instance.test.ts` beside today's default instances. |
| `agents/pm_instance.test.ts` | Runs the default instances of the path and the layer, on the day stop the frozen code had, beside the frozen code over the same simulated days, minute by minute, and finds every table, request and report the same but the fields the formula of 2026-10-04 makes; and the day stop of 2026-10-07 the one other difference. |
| `agents/pm_live_mid_frozen.ts`, `agents/pm_prep_mid_frozen.ts` | The order path and its paper layer as mid-pool's pre-registration froze them, byte for byte, run only by `pm_mid_formula.test.ts` beside today's mid-pool instances. |
| `agents/pm_mid_formula.test.ts` | Runs mid-pool through today's path and layer, on the day stop it froze, beside the code its pre-registration froze, minute by minute, and finds every decision the same and only the formula's fields changed; and the day stop of 2026-10-07 the one other difference. |
| `agents/pm_daystop.test.ts` | Pins by hand the day stop that counts only the day's change since 00:00 UTC, on the order path and on its paper layer, each against the rule it replaced. |
| `agents/pm_payouts.test.ts` | Pins what Polymarket pays told apart per path: mid-pool through today's path beside the path its pre-registration froze, minute by minute, and the two paths on one account each booking only the markets it quoted live. |
| `agents/pm_mid.ts` | "Reward quotes mid-pool": the order path and its paper layer as a second instance, on rewarded markets of $10 to under $50, the same real order path as mini-pool held in dry-run by its config row; its selection first recomputes RW's frozen selection from public data and leaves out what that takes or nearly takes, keeping only a count. |
| `agents/pm_lp.ts` | "Reward quotes live-prep": the order path and its paper layer as a third instance, on every rewarded market of $10 a day and over, with its own rules (a sell of what is held before a buy, 5N, x2's pause, TB1's skip of a one-tick touch, exits from markets it carries, no end-date horizon, no weather market, $100 a market, a total stop on the fills and what was paid); in dry-run it decides on its paper's holdings. |
| `agents/pm_lp.test.ts` | Pins live-prep's instance and each of its rules against the code it extends, and simulated days of its path and layer together: the sells, 5N, the caps on what the paper holds, the pause, a carried market's exits, the stop in its own mode, no day stop, and armed, the account's holdings and the live stop. |
| `agents/pm_lp_live_view.ts` | "Reward quotes live-prep"'s real-money book as LIVE's "Reward quotes" row and its page: funded its cap, deployed its resting buys and holdings at cost, P&L from its CONFIRMED live fills at the last turn's mids plus what Polymarket paid, R, STATUS, QUOTES, fills, its stop and its gates, from the path's live rows alone. |
| `agents/pm_lp_live_view.test.ts` | Pins the live book against a record worked out by hand (the sweep's fixture is its answer), that it reads no dry-run row and nothing of the paper layer, its stop and a settlement. |
| `agents/pm_fees.ts` | What Polymarket charges a fill and pays a maker back, from its docs and client: the taker formula, each fee type's schedule, a paper record's fees and estimated rebates, and a live fill's fee from its trade record. |
| `agents/pm_fees.test.ts` | Pins the fee formula against the docs' own example and fills worked by hand, maker and taker at two prices, the rebate estimate and the live record's fee. |
| `agents/pm_mid.test.ts` | Pins mid-pool's instance: RW's selection recomputed is RW's own, the margin at its boundary, none of RW's picks among mid-pool's, its own tables only, its action wired as mini-pool's with its config row the lock, and never both configs armed. |
| `agents/pmrw.ts` | The paper test of RW, quotes for Polymarket's liquidity rewards, and of RW-C, the same engine again on its own tables and days: the day's portfolio, then the frozen rule one minute at a time from public reads, storing every input beside every outcome. |
| `agents/pm_book_rec.ts` | Records Polymarket's rewarded markets for research: every minute the books (each side within 10 ¢ of its best) of every market paying $10 a day or more and of every market a Reward quotes path holds or quotes, a fifteenth of every rewarded market as one summary line each, and the prints of the first set, as one gzip'd frame per kind and minute; its housekeeping call keeps the markets from the reward listing and Gamma and moves each closed hour of frames to Supabase Storage with a signed URL. Keyless reads only. |
| `agents/books.ts` | Revolut X's four stablecoin order books, their top levels read once a minute from the public book and stored when they change, for a queue model; and the two GBP books' index prices, for the quote pages. |
| `agents/pmrw_e.ts` | RW-E beside RW, and beside RW-C: the run's stored minutes replayed in two arms, the run itself (checked against its own days) and it without the markets that end on the day they are quoted. |
| `agents/pmrw_x.ts` | Variants of RW-E replayed from RW's stored record — an inventory cap, a pause after the mid jumps, categories left out, where the quotes rest, and what to do on a touch one tick wide (TB1) — the research that picked the first three on RW's days before RW-E's twelve, and the forward replay of the arms it tracks, on RW's minutes and on RW-C's. |
| `agents/pmrw_view.ts` | "Reward quotes" and its variants' rows as the Agents page shows them, each read from RW's run and its replays until RW-C's first minute and from RW-C's, its round 2, from then: from the engine's own state and records by the engine's own functions. |
| `agents/jev_rows.ts` | Each rulebook's own wording of the model's entry question, asked only when the row's params name it. |
| `agents/jev_bands.ts` | The measured range of the model's answers for every entry state, which JEV-DRIFT checks each entry's answer against; a flagged answer vetoes its entry on a gated row. |
| `agents/db.ts` | The loop's database access, over PostgREST. |
| `agents/testing.ts` | Test doubles that refuse whatever the real database, Revolut X or Polymarket's order book refuses. |
| `agents/backtest.ts` | The walk-forward backtester: the loop's own rule functions run over history at the venue's costs. |
| `agents/backtest_*.ts` | One study each: allocation, Binance's costs, Binance cross-sectional momentum and its second search (reversal, low volatility), execution, fills, rule ideas, the Jev veto, the paper rows' Jev gates and each row's own Jev question, Kraken (three), maker-only rules on Revolut X, portfolio, set, sizing and entry gates, SUI, tape, testing set, a third window. Results go to `docs/agents/backtests/`, write-ups to `docs/agents/reviews/`. |
| `_shared/agents_strategy.ts` | The rulebooks, the market state, the Jev questions and the risk gate. Every number the loop acts on, with no network or clock; the loop and the backtester share it. |
| `_shared/revx.ts`, `_shared/kraken.ts`, `_shared/venue.ts` | The Revolut X and Kraken clients (signing, candles, quotes, orders) behind one venue interface, which Binance's paper venue also implements. |
| `_shared/jev.ts` | The TypeSafe Jev client: typed questions in, probabilities out. |
| `_shared/polymarket.ts` | A read-only Polymarket client for the probe: the stored credentials, request signing, the private key's address, and the account checks. Nothing in it can trade. |
| `_shared/polymarket_orders.ts` | Polymarket's CLOB V2 orders: the EIP-712 order, its hash (the order id) and signature, pinned to the official client's vectors; the loader that keeps the signing key only for the stored signer; and the one call that may reach the CLOB, by a fixed list of routes, a POST only from eu-west-1. |
| `_shared/polymarket_public.ts` | Keyless reads of Polymarket's public endpoints (reward programme, markets, events, books, prints) for RW's paper test and the view recorder. It reads no credential and cannot trade. |
| `_shared/token.ts`, `_shared/ip.ts` | App-token checks, and which header names the caller's IP. |
| `_shared/ops.ts` | Server-side error reports into `ops_errors`. |
| `_shared/beats.ts` | A cron call's beat, the first thing it writes: its function and action and the minute, which `edge-watchdog` reads to find a call whose worker never started. |
| `_shared/us_market_calendar.ts` | US market holidays and early closes, worked out by rule for any year. |
| `_shared/us_overnight_session.ts` | The US overnight session the overnight recorder records: 20:00-04:00 ET, less the weekend and holiday sessions. |
| `_shared/recorder_watch.ts` | The price recorders' daily audit of each other: buckets owed by the calendar against buckets written, reported to `ops_errors` when short. |
| `_shared/t212_positions.ts` | Trading 212's positions read for the two price recorders, tried once more when its one-call-a-second limit refused it. |
| `_shared/t212_tickers.ts` | Trading 212's instrument codes mapped to the board's Yahoo tickers: the one map `trading212` and both price recorders read. |
| `_shared/bytes.ts` | Byte and base64 helpers for request signing. |
| `.env.example` | Every secret the functions read, by name. The values live only in Supabase. |

### `supabase/migrations/`

Applied in order by `migrations.yml` on every push to `main`. Read
[`supabase/migrations/README.md`](../supabase/migrations/README.md)
before touching migration state.

| File | What it does |
|---|---|
| `0001_auth_attempts.sql` | Failed sign-ins per IP, with an atomic count-or-lock. |
| `0002_ops_errors.sql` | The error-report table. |
| `0003_index_fundamentals_cache.sql` | A 24-hour cache of index P/E from Alpha Vantage. |
| `0004_ops_errors_retention.sql` | Deletes error reports older than 30 days, daily. |
| `0005_analyst_estimates_cache.sql` | A cache for analyst growth estimates, removed again by `0006`. |
| `0006_drop_analyst_estimates_cache.sql` | Drops it; PEG comes from Yahoo's forward growth. |
| `0007_trading212_cache.sql` | A one-row cache of the broker's positions. |
| `0008_trading212_claim_refresh_rpc.sql` | Lets only one worker refresh that cache at a time. |
| `0009_board_data.sql` | The one-row store for the portfolio. |
| `0010_stock_fundamentals_cache.sql` | A two-hour cache of stock fundamentals. |
| `0011_auth_attempts_search_path_escalation.sql` | Hardens the sign-in lockout, and doubles it on each repeat up to 30 days. |
| `0012_av_quota.sql` | A daily counter that keeps Alpha Vantage inside its free quota. |
| `0013_board_data_version.sql` | A version number on the portfolio, so a stale tab's save is refused. |
| `0014_stock_fundamentals_cache_retention.sql` | Drops fundamentals cache rows older than 90 days. |
| `0015_overnight_intraday_points.sql` | The table of recorded overnight quotes. |
| `0016_overnight_cron.sql` | Schedules the overnight recorder and a 30-day prune. |
| `0017_revoke_bump_auth_attempt_from_public.sql` | Stops the public API roles calling the lockout function. |
| `0018_revoke_overnight_anon_read.sql` | Stops the public API roles reading the overnight table, which would list held tickers. |
| `0019_day_session_record_window.sql` | Ran the overnight recorder all day; reverted by `0020`. |
| `0020_revert_day_session_record_window.sql` | The revert. |
| `0021_cron_secret_via_vault.sql` | Moves the cron job's secret into Supabase Vault. |
| `0022_portfolio_snapshots.sql` | Recorded portfolio values; replaced by recorded prices in `0029`. |
| `0023_t212_orders.sql` | The broker's executed fills, and the backfill cursor. |
| `0024_reset_t212_orders_sync.sql` | Restarts that backfill after a parser fix. |
| `0025_t212_transactions.sql` | The broker's cash movements, walked until 2026-08-18 and never charted; nothing reads or writes the table since 2026-10-08, and it stays. |
| `0026_snapshot_record_cron.sql` | Schedules the five-minute recorder, and thins old rows by age instead of deleting them. |
| `0028_restore_pltr_position.sql` | One-off repair: restores a position a bug deleted. |
| `0029_price_snapshots.sql` | Records prices instead of values, thinned the same way. |
| `0030_restore_multiplatform_shares.sql` | One-off repair: restores shares held at another platform that a sync removed. |
| `0031_rklb_other_platform_lot.sql` | One-off: adds a purchase made at another platform. |
| `0032_map_stored_fill_tickers.sql` | Fills in the Yahoo ticker on stored fills whose broker code had none. |
| `0033_mark_other_platform_lots.sql` | Marks the lots the broker has no record of, so the fill rebuild leaves them alone. |
| `0034_map_remaining_fill_tickers.sql` | The same fix as `0032` for the last three broker codes. |
| `0035_drop_overnight_yahoo_snapshots.sql` | Deletes stale overnight prices the recorder once stored. |
| `0036_price_snapshot_15m_band.sql` | Keeps 15-minute density where the 1W chart needs it. |
| `0037_agents.sql` | The crypto loop's schema: strategies, risk caps, decisions, orders, fills, observations, candles, the basis, the lock. |
| `0038_drop_dislocation_seed.sql` | Retires the one-minute dislocation rule. |
| `0039_trend4h_adds_avax.sql` | Adds AVAX to the four-hour trend rule. |
| `0040_trend4h_adds_sui.sql` | Adds SUI to it. |
| `0041_one_order_per_decision_attempt.sql` | One order per attempt at a decision, so a retry cannot double an order. |
| `0042_maker_probes.sql` | Records where a resting order would have sat, to measure what taking the touch costs. |
| `0043_retire_three_testing_rows.sql` | Retires three paper strategies. |
| `0044_delete_retired_rows.sql` | Deletes the four retired strategies and their records. |
| `0045_maker_probe_cascade.sql` | Deletes a strategy's probes along with it. |
| `0046_delete_kraken_twin.sql` | Deletes the Kraken paper twin of the four-hour rule. |
| `0047_jev_question_v2.sql` | Sets the Jev entry threshold to 0.45 for the new question. |
| `0048_drop_max_order_usd.sql` | Drops the fixed per-order cap: an entry is its row's slot. |
| `0049_binance_paper_rows.sql` | Adds Binance's paper rows, the Revolut X strategies' twins, and keeps any Binance row off live. |
| `0050_maker_probes_trade_proven.sql` | Records the minute that proved a maker probe's fill, and corrects the three probes resolved on minutes with no trade. |
| `0051_paper_quotes.sql` | Adds the paper quote test's tables (state, prints, inputs, events, trips) and its once-a-minute cron job. |
| `0052_live_quotes.sql` | Adds the live quote executor's tables (config, orders, events, state) and its lease; the config goes in in dry-run and unarmed. |
| `0053_pm_rw_paper.sql` | Adds RW's paper test: its tables (state, selection, minutes, prints, fills, days, settlements), its two leases and its two cron jobs. |
| `0054_go_live.sql` | Adds the first live row, `trend-4h-live` (Revolut X, BTC/ETH/SOL/AVAX, four equal slots), unarmed, and sets the live caps for its first round trip. |
| `0055_quote_minutes.sql` | Adds PR5's per-minute record of the inputs each decided minute read: GBP/USD, the USD book's median, and the prints. |
| `0056_pm_rw_e.sql` | Adds RW-E's replay beside RW: its state and day tables, its lease and its cron job. |
| `0057_book_levels.sql` | Adds the stablecoin books' record: its table, its minute job and its 35-day prune. |
| `0058_book_levels_timing.sql` | Moves the books' reads to 40 s into the minute, and lets a row say how long its book stood still. |
| `0059_jev_shadow_paper_rows.sql` | Puts the Jev gate of `trend-1h`, `momentum-1d` and their Binance twins in shadow: asked and recorded, no veto. |
| `0060_pmrw_e_every_minute.sql` | Runs RW-E's replay every minute instead of every five. |
| `0061_strategy_names_without_venue.sql` | Drops the venue from every strategy's name; the page's venue column and tag say it. |
| `0062_view_markets_recorder.sql` | Adds the view-count recorder's tables (channels, uploads, counters, view markets, their books, the key's daily units) and its minute job. |
| `0063_one_minute_batch.sql` | Replaces the nine jobs that each queued an Edge call with one that queues every call due in its minute in one statement, so pg_net takes them as one batch. |
| `0064_pm_rw_x.sql` | Adds the forward replay of RW-E's three variants: its state and day tables, its lease, and its call in the one-minute job. |
| `0065_delete_binance_twins.sql` | Deletes the three Binance paper twins and their records: they decided nothing of their own and filled no better. |
| `0066_paper_rows_x10.sql` | Puts the three paper strategy rows at ten times their size, their paper book with them, and gives paper books their own exposure and daily loss limits. |
| `0067_paper_rows_x2_5.sql` | Puts `trend-1h` and `momentum-1d` at $1,000 as `trend-4h` is, their paper book with them, and moves the paper caps with the paper capital. |
| `0068_maker_probes_after_open.sql` | Corrects the two maker probes the fill test resolved on a minute that began before they were written. |
| `0069_pm_rwc.sql` | Adds RW-C, RW's engine run again on 2026-10-09 → 10-23 with RW-E's and the variants' replays on its minutes: its eleven tables (RW's, named `pm_rwc_…`), its four leases, and its four calls in the one-minute job. |
| `0070_quote_days.sql` | A view, `agent_quote_days`: each UTC day of the stablecoin quote test's orders, fills and closed round trips, for its page's DAYS table. |
| `0071_quotes_variant.sql` | Adds the quote variant's tables (state, minute records, events, trips), its per-arm days view, the function that wipes them for a new code version, its lease, and its call in the one-minute job. |
| `0072_quotes_ruled.sql` | Adds variant-2's tables, its days view, the function that wipes them, its lease, and its call beside the variant's in the one-minute job. |
| `0073_quoted_truefx_before_turn.sql` | Records when variant-2's TrueFX snapshot was read (while it read one), and refuses a TrueFX minute read at or after the minute it prices. |
| `0074_pm_live.sql` | Adds Polymarket's order path in dry-run: its config (dry-run, unarmed, Davies' standing Ireland attestation, the capped limits), the day's markets, its orders, fills, events and state, its lease, and its call in the one-minute job from eu-west-1. |
| `0075_edge_call_watchdog.sql` | Moves the one-minute job's list into a table (`edge_calls`: 0074's rows unchanged, which calls may run again, and the watchdog's row), adds each call's beat (`edge_call_beats`, kept two days) and the watchdog's record of its retries (`edge_call_retries`), and points the job at the table. |
| `0076_pm_live_calibration.sql` | Readies Polymarket's order path for its live calibration, left in dry-run and unarmed: the day's market count and budget, the live test's caps, the markets keyed by market, each minute's formula reward, the daily reward readout and settled markets. |
| `0077_pm_live_prep.sql` | "Reward quotes mini-pool"'s tables (named live-prep then) (state, prints, market-minutes, fills, days, settlements, events), its lease and its row of the one-minute job. |
| `0078_quote_tickers.sql` | Revolut X's USDC/GBP and USDT/GBP tickers (`agent_quote_tickers`, a row a book), whose index price the stablecoin quote pages value coins at, as the account does. |
| `0079_live_fill_prices.sql` | Re-prices the live fills booked before 2026-10-02 at what each one's stored venue reply says the account moved, as fills are priced since. |
| `0080_pm_live_full_size.sql` | Polymarket's order path at the $400 deposit's full size in its dry-run (eight markets a day, $160 of first quotes, under the $320 cap), today's markets chosen again at that size; it goes live only on Davies' word. |
| `0081_pm_mid.sql` | "Reward quotes mid-pool"'s tables, the path's and the layer's shapes as `pm_mid_*` and `pm_midprep_*` with a $10–$50 band and a config and orders that refuse anything but a dry-run, its config at the $400 sizes, its two leases and its two rows of the one-minute job. |
| `0082_anon_key_opens_nothing.sql` | Takes every privilege in `public` from `anon` and `authenticated` (tables, views, sequences, functions, and the defaults for what is created later), drops `board_data`'s three dashboard-made anon policies, and leaves the service role as it was: the page's anon key opens nothing in the database. |
| `0083_cron_run_details_prune.sql` | A daily job keeping seven days of pg_cron's run history (`cron.job_run_details`), which nothing pruned before. |
| `0084_pm_mid_order_path.sql` | Lets mid-pool's config leave dry-run and its orders be live, as mini-pool's always could, and adds a trigger on both Polymarket configs that refuses arming either while the other is armed: the two paths trade one account. |
| `0085_pm_rw_x_rest_arms.sql` | Lets the variants' day tables, RW's and RW-C's, take the two arms on x1 that move where the quotes rest (x4, x5). |
| `0097_http_response_prune.sql` | Replaces 0093's truncate with a job deleting pg_net responses over ten minutes old at :05, :15, …, so it never locks the table while the one-minute batch writes to it. |
| `0098_board_data_history.sql` | Keeps the portfolio's earlier versions: each change to `board_data` first copies the version it replaces into `board_data_history` (service role only), pruned at 90 days. |
| `0099_edge_calls_select_timeout.sql` | The two daily Polymarket selections wait 55 s in the one-minute job instead of 290 s, so no minute's pg_net batch holds the next minute's calls. |
| `0100_t212_orders_sync_call.sql` | Runs the Trading 212 history walk (`trading212?action=orders-sync`) from the one-minute job every ten minutes, so fills reach the database without an admin page open. |
| `0101_pm_paths_retention.sql` | Keeps the three Polymarket order paths' dry-run minutes and ended dry-run orders, and their paper layers' minutes, 14 days (`pm_paths_prune`, daily); indexes the paper layers' ended-orders read; the database's size for the monitor and a daily watch past 4 GB. |
| `0103_retire_after_rw.sql` | Takes mini-pool's two calls (`pmlive`, `pmprep`) off the one-minute job at once, and RW's four (`pmrw`, `pmrw-select`, `pmrw-e`, `pmrw-x`) once the last day their readings read is closed (`retire_after_rw`, run every five minutes by a job that then unschedules itself); nothing deleted. |
| `0104_edge_calls_active_from.sql` | A call the one-minute job gains is first made 15 minutes after its row is written (`edge_calls.active_from`), so its function's deploy lands first; the job and the watchdog read the instant. |
| `0105_pm_lp_posts_12000.sql` | Lets live-prep's config allow 12,000 POSTs a UTC day and sets its row there; mini-pool's and mid-pool's stay at 6,000. |
| `0096_pm_rw_x_tb1_arms.sql` | Lets the variants' day tables, RW's and RW-C's, take TB1's two arms on x1 (tb1-skip, tb1-back). |
| `0086_quote_live_deadman.sql` | Adds the kind `deadman` to `agent_quote_live_events`, for the row the monitor's dead-man switch writes when it cancels PR5's resting orders. |
| `0087_quote_twins.sql` | The realistic twins' tables (each the live executor's four, a replica's and a simulated account's), their config rows and leases, and the one call that runs them. |
| `0088_quote_twin_specs.sql` | The twins as rows (`agent_quote_twin_specs`), the function that makes a twin's tables from 0087's statement, and p50 ("Stablecoin quotes variant-1") the first twin made that way. |
| `0089_quote_twin_take50.sql` | TAKE's twin as a row and its tables: "Stablecoin quotes variant-2" (`take50`), variant-1 with a taker entry from 2026-10-05. |
| `0090_take50_from_now.sql` | Moves TAKE's start (`take50`'s `rules.take.from`) to 2026-10-04 16:00 UTC, its pre-registration's Addendum 1. |
| `0091_pm_lp.sql` | "Reward quotes live-prep"'s tables, the path's and the layer's shapes as `pm_lp_*` and `pm_lpprep_*` with a band of $10 and over, $100 a market and no day stop, its config unarmed in dry-run, its two leases and two rows of the one-minute job; and the one-armed trigger on all three Polymarket configs. |
| `0092_pm_book_recorder.sql` | The Polymarket book recorder's tables (its markets, its frames, its archive's index, its two state rows), its two leases, its two rows of the one-minute job (every minute and every fifth, both run again by the watchdog), and its hourly prune: data the archive has not taken in six hours dropped, frames' counts after seven days, markets a week after the listing dropped them. |
| `0093_http_response_truncate.sql` | A job emptying pg_net's response table every ten minutes, whose own six-hour pruning leaves dead space no vacuum reclaims (the 10-07 stall); replaced by 0097. |
| `0094_pm_prep_stress_days.sql` | The three paper layers' worst case at each UTC day's start, a row a layer and a day, with the accounts it sums and how it was made. |
| `0095_t212_fill_currency_dividends.sql` | Each broker fill's trading currency (`t212_orders.currency`, GBX kept), and the dividends both accounts received with their walk's cursor (`t212_dividends`, `t212_dividends_sync`). |
| `20260817034719_portfolio_snapshots_out_of_band.sql`, `20260818044126_t212_orders_out_of_band.sql`, `20260818044956_drop_aug17_fx_spike_snapshot.sql` | Empty records of changes applied outside CI, so `db push` keeps working. |
| `20260818083328_strict_t212_fills.sql` | Clears order rows built from unfilled orders and restarts the fill backfill. |

### Build, CI and docs

| File | What it does |
|---|---|
| `src/package.json` | The web app's npm project: scripts, dependencies, and the knip and size-limit settings. Every npm command runs in `src/`. |
| `src/tsconfig.json` | Type-checks the JavaScript through JSDoc (`checkJs`, `strictNullChecks`). |
| `src/.nvmrc` | Node 22. |
| `src/e2e/app-sweep.mjs` | The browser test CI runs: the real bundle in Chromium at desktop and phone widths, every network call faked, the clock pinned, over 640 checks. |
| `src/e2e/browser.mjs` | Which Chromium both browser tests launch: Playwright's full one, never its headless shell, or the one `PLAYWRIGHT_CHROMIUM_PATH` names. |
| `src/e2e/prep_fixture.json` | "Reward quotes mini-pool"'s page as the dashboard serves it for a record worked out by hand: the browser test shows it, and the view's test proves it is that function's own answer. |
| `src/e2e/mid_fixture.json` | "Reward quotes mid-pool"'s page the same way, for a record of its $10–$50 band worked out by hand. |
| `src/e2e/lp_fixture.json` | "Reward quotes live-prep"'s page the same way, for a record of its own with a $120 pool and a sell of what its paper held. |
| `src/e2e/lp_live_fixture.json` | "Reward quotes live-prep"'s LIVE row and page as the dashboard serves them for a synthetic live record worked out by hand: the browser test shows it, and the `agents` function's test proves it is that function's own answer. |
| `src/e2e/quotes_live_fixture.json` | The live stablecoin quotes' page as the dashboard serves it for a synthetic book worked out by hand: the browser test shows it, and the `agents` function's test proves it is that function's own answer. |
| `src/e2e/quotes_twin_fixture.json` | The realistic twins' rows as the dashboard serves them for that book run as each twin's, made from the spec rows by the twins' fixture generator: the browser test shows them, and the `agents` function's test proves they are that function's own answer. |
| `src/e2e/perf-matrix.mjs` | The second browser test CI runs: the performance panel in two views, five ranges, three data states and two books (60 cases), and 24H at four instants with extended hours off and on (16), against answers worked out by hand, clocks pinned. |
| `wrangler.jsonc` | Tells Cloudflare Pages to publish `dist/` and nothing else. |
| `dist/` | The built site, committed and published as it is. |
| `bin/setup.sh` | One-time setup for a clone: the ledger hook, the ledger path, `npm ci` in `src/`. |
| `bin/gates.sh` | The CI gates a change can break, chosen by the paths it touches (`--full`: every gate), the independent ones at once, the bundle's freshness among them. |
| `bin/edge-changed.sh` | The functions a push to main deploys: those changed since the deploy workflow's last successful run. |
| `bin/knip-edge.sh`, `supabase/knip.json` | knip for the Edge Functions. knip reads only code under the folder holding its `package.json`, which is `src/`, so the functions are checked in a scratch copy against their own settings. |
| `bin/hooks/pre-commit` | The ledger's commit hook: the ledger moves with the work, a history section opens with a source header, and the ledger stays under 80 KiB. |
| `.github/workflows/check.yml` | On every push: type-check, lint, tests, a build that must reproduce the committed bundle byte for byte, both browser tests and the size budget on that committed bundle, dead code, the audit, as parallel jobs. |
| `.github/workflows/edge-functions.yml` | Checks and tests the functions, and deploys the ones that changed since its last successful run. |
| `.github/workflows/migrations.yml` | Lints migrations, and applies new ones on `main`. |
| `.github/workflows/healthcheck.yml` | Asks for every 10 minutes (GitHub runs it when it can): pings the functions to keep them warm and checks the live site's code; opens an issue when something is down. |
| `.github/workflows/pages-deploy.yml` | On a `dist/` change to `main`, once `check.yml` has passed on that commit, or by hand: uploads the committed `dist/` to Cloudflare Pages with Wrangler (no Git clone on their builders). |
| `.github/workflows/monitor-deploy.yml` | On a change to `workers/monitor/`, or by hand: tests and deploys the monitor Worker with a pinned wrangler, and sets `MONITOR_SECRET` on the Worker and in Supabase when asked or missing. |
| `.github/workflows/monitor-alert.yml` | Started by the monitor Worker: opens the one issue labelled `monitor`, or comments on it. |
| `workers/monitor/wrangler.jsonc` | The monitor Worker's configuration: its one-minute cron, its KV namespace, the dead-man's memory (a Durable Object), the public addresses it checks. |
| `workers/monitor/src/index.js` | The monitor Worker's entry: the cron's minute, a GET answering its health output, and the `DeadmanMemory` class it exports. |
| `workers/monitor/src/monitor.js` | What a minute of the monitor does: the three checks, the alert after two failing minutes and the recovery, the queue in KV, the GitHub dispatch, and the dead-man's memory of its last fresh read. |
| `.github/SECURITY.md`, `CODEOWNERS`, `dependabot.yml`, `pull_request_template.md` | How to report a vulnerability, who reviews what, dependency updates, the PR layout. |
| `docs/README.md` | The front page GitHub shows on the repository's home page: what the project is, screenshots, how it is built. |
| `docs/guide.md` | How to use each part of the site. |
| `docs/map.md` | This file. |
| `docs/architecture.svg`, `docs/screenshots/` | The README's diagram and screenshots. |
| `docs/agents/reference.md` | Every verified fact the crypto loop rests on: the Jev model, both exchange APIs, the measurements and the backtests. |
| `docs/agents/go-live.md` | The case for the first live strategy. |
| `docs/agents/venue-survey.md` | Other exchanges, brokers and data sources, for the UK, the US and Hong Kong. |
| `docs/agents/reviews/` | The code review before going live, and one write-up per study. |
| `docs/agents/backtests/` | The studies' results, as JSON, and in `inputs/` the public data a study read that cannot be fetched again unchanged. |
| `docs/agents/backtests/polymarket/` | The fourth search, on Polymarket: its scripts, inputs and results, listed in `MANIFEST.json`; `scripts/rw_golden.py` cuts the paper engine's replay fixture from RW's input and result; `drawx/` is DRAW-X's run, hashed in its own `drawx.json`. |
| `docs/agents/backtests/pmlate/` | PMLATE, the informed taker on Polymarket's same-day temperature and post-count markets: its scripts, phase 1's results, and the USLATE test's inputs, results and checks, listed in `MANIFEST.json`. |
| `docs/agents/backtests/fp6/` | fp6, the fourth Binance search, on its derivatives: the keyless fetch scripts and pull manifest, the pre-registered rules' decision code, the phase-1 counts, and phase 2's scorers and results (`phase2_run.py` runs them all). |
| `docs/agents/backtests/harvest/` | HARVEST phase 1, the other side of Polymarket's book after a public source confirms the result, in five kinds of market: the keyless pull scripts, the committed universe, split, inputs and confirmation sources, and the results (`scripts/run_all.py` re-runs them), listed in `MANIFEST.json`. |
| `docs/agents/backtests/speed/` | SPEED, how fast the loop could act and what speed is worth: live latency polls of the keyless weather sources and Polymarket's post tracker, the socket and REST probes, the edge left at each reaction time, each architecture's cost, and USLATE-FAST's evaluator, listed in `MANIFEST.json`. |
| `docs/agents/backtests/views/` | VIEWS phase 1, on Polymarket's YouTube view-count markets: the keyless pull scripts, the committed universe, split and exploration inputs, and the results (`scripts/run_all.py` re-runs them), listed in `MANIFEST.json`. |
| `docs/agents/backtests/wxsrc/` | WXSRC, the fastest source of each temperature city's deciding observation and the weather models against the price: the per-city source table, the live latency poll, the Hong Kong archive study, the keyless and keyed candidates' exploration, and the HRRR intraday scoring, listed in `MANIFEST.json`. |
| `docs/agents/backtests/cap/` | CAP, the live row's exposure cap priced with the house rule functions, and Revolut X's UK books on 30 days of daily candles: the pulls, the scripts, and `results/queries.sql` with every read and its output, listed in `MANIFEST.json`. |
| `docs/agents/backtests/twins/` | The realistic twins' backfills: the inputs read from production, the builder that runs the production code on them (any twin of the spec rows), the files the `agents` function loads, listed in `MANIFEST.json`, and the generator of the browser test's twins fixture; `size/` replays PR5's rule at other rung sizes and checks the twin's refusals against the recorded books. |
| `docs/agents/backtests/take/` | TAKE: a taker entry when the GBP stablecoin book rests through a rung, simulated on the recorded books with the live executor's rules; the reads (`queries.sql`), their outputs, `study.py` and its `results.json`, listed in `MANIFEST.json`. |
| `docs/agents/backtests/pmlive/` | Polymarket's first live step, a read-only pre-study: the reward universe's keyless aggregates, the power of an actual-to-formula reward ratio, the bridge's quotes and the live calibration's selection timed through the order path's own code, listed in `MANIFEST.json`; `vectors/` regenerates the order path's signing vectors from Polymarket's official clients; `prep_check*.sql` are mini-pool's pre-registration's checks, and `mid_*.sql` mid-pool's check, readout and overlap audit, beside its margin's and its selection's measurements and `scripts/one_armed_check.mjs`, both go-time statements and the one-armed trigger run on PGlite, and `scripts/mid_live_check.mjs`, mid-pool's go-time statement on every migration; `scripts/mini_books.ts` samples mini-pool's universe's books once a minute and `scripts/mini_books_read.ts` replays them through the path's code for its book-quality rule, beside its own record's market-days (`scripts/mini_history_days.sql`). |
| `docs/agents/backtests/pmlp/` | "Reward quotes live-prep"'s evidence and checks, listed in `MANIFEST.json`: Phase A's replay of RW's record at the account's size (`scripts/sim.ts`, fifteen rounds, their outputs in `results/`, the inputs gzipped in `data/`), the universe's keyless read and its tracking; its pre-registration's day-1 check and live readout (`lp_check.sql`, `lp_readout.sql`); and `scripts/lp_live_check.mjs`, its go-time statement and the one-armed trigger on three configs run on PGlite over every migration. |
| `docs/agents/backtests/pmrec/` | The Polymarket book recorder's evidence, keyless and read-only: `scripts/design.ts` (the universe by rate, the $10 set's books read three times a minute apart, four encodings of a frame, the global print tape against each market's own feed), `scripts/measure.ts` (both calls run on the shared in-memory database against the public API, timed, and the hour archived into a store and read back), `scripts/archive_hour.ts` (a full hour archived at the measured sizes, its CPU), `scripts/retention_check.mjs` (the migration and its hourly prune on PGlite, the sizes the budget rests on, and the shape not taken), `scripts/read.ts` (an archive object's frames, as a study reads them), their outputs in `results/`. |
| `docs/agents/backtests/rwexit/` | EXIT: selling a Reward quotes fill at once, on a stop or on a timer, priced against holding on RW's paper fills and mini-pool's: the read-only queries, their results and the markets' fee fields, listed in `MANIFEST.json`. |
| `docs/agents/backtests/rwcounts/` | COUNTS: RW-X's own replay (a three-line copy with a skip hook) of x1, x4, x5 and RW without post-count, view-count, live-counter, finance or general markets, and late-window cuts; the classes frozen before the arms ran, the scripts and every arm per day and market. |
| `docs/agents/backtests/rwc_opt/` | RWC-OPT: live-prep's Phase A simulator with TB1's tight-touch option, the 65-arm search on RW's record (both fill models, walk-forward, reality check), and the frozen arms C1–C3 with the RW-C loader, the pull statements and the bar read on RW-C's record after 10-23, listed in `MANIFEST.json`; beside them, unfrozen, TB1-SELLS (`scripts/tb1s_*`, `results/tb1_sells.txt`) and EXPENSIVE-SIDE (`scripts/exp_*`, `sql/exp_paper.sql`, `results/expensive_side.txt`). |
| `docs/agents/backtests/rwverdict/` | RW's verdict of 2026-10-09: the bars of RW, RW-E, RW-X1–X3 and RW-X4/X5's Test 1 and RW-NEXT Part 1 (`scripts/verdict.py`), the `stepRw` replay against every fill (`scripts/replay.ts`), every quoted market's prints pulled again (`scripts/pull_prints.ts`) and `rw_test.py` beside it, their reads and outputs, listed in `MANIFEST.json`. |
| `docs/agents/backtests/lpself/` | LPSELF: live-prep against itself, every change to its rule on RW's record and on a full-universe record built from the pm-rec archive (`scripts/fetch.py`, `scripts/build.ts`), both fill models, the adoption rule, walk-forward and reality check, listed in `MANIFEST.json`. |
| `docs/agents/backtests/lpresel6/` | LPRESEL6: live-prep's rule against the same rule choosing its markets again every six hours, frozen to be read on the pm-rec whole-universe record of 10-09 → 10-23 (the builder with its window, the arms, the runner and the bar), listed in `MANIFEST.json`. |
| `docs/agents/pending/` | Code built, reviewed and tested but kept off `main` until Davies' word: each a `git am` patch, with what it waits for and how to land it in its `README.md` (none at present). |
| `docs/agents/backtests/fp7/` | fp7, the seventh search: Revolut X's UK book census, the coin/USDC books as maker quotes, and Polymarket's reward-pool aggregates; its scripts run from the folder, listed in `MANIFEST.json`. |
| `docs/agents/backtests/equity2/` | EQ2, US strategies at Trading 212 (USD Invest and GBP ISA): screens cut at 2015-12-31 as they are parsed (month-end windows, settlement eras, industry seasonality, the Treasury auction cycle, the S&P 500 survivorship hole) and the power checks, listed in `MANIFEST.json`. |
| `docs/agents/backtests/equity/` | EQ1, US equities at Trading 212: the screen on Ken French's files cut at 2015-12-31, the power checks, and the earnings filings' times on EDGAR, listed in `MANIFEST.json`. |
| `docs/agents/backtests/dat/` | DAT, treasury companies against their coins: MSTR's point-in-time mNAV from its SEC filings and the screen cut at 2024-12-31, BMNR and the 2025–2026 discount-closing events described, and a held-out pull that refuses to run, listed in `MANIFEST.json`. |
| `docs/agents/backtests/pr5_live/` | PR5's live path: the design study (`pr5_live_design.py`), the first evening's reconciliation and replay fixture, and the go-live study (`go_live_120.py`: every executor setting, the governor, the paper-test interaction and the inventory, with the day's public books in `inputs/public_2026-10-01.json.gz`). |
| `docs/agents/backtests/mx1/` | MX-1's data: `cstar/` measures its constant C* before the freeze; `tape/` holds each Monday's keyless UK prints for the events' windows (`<date>.json.gz`) beside the windows statement A gave the pull (`<date>.windows.json`), and `basis/` each Monday's stand-in touches (statement B). |
| `docs/agents/scripts/agents-baseline-backtest.py` | The first baseline backtest, in Python. |
| `docs/agents/scripts/xsmom/list_symbols.py`, `fetch_klines.py`, `qa_data.py`, `verify_xsmom.py`, `verify_xsrev.py` | The Binance cross-sectional studies' data: every USDT pair's daily klines from the keyless bulk archive, checked and hashed; a data check; and an independent re-implementation of each study. |
| `docs/agents/scripts/first_principles/quote_sim.py`, `pr1_revx_stable_quotes.py`, `pr2_binance_stable_quotes.py`, `pr3_revx_gbp_stable_touch.py`, `pr4_revx_usd_stable_touch.py` | The first-principles search's four pre-registered tests on Revolut X's and Binance's stablecoin books, and the quote simulator the first two share. |
| `docs/agents/scripts/pr5/pr5_sim.py`, `test_sim_logic.py`, `posthoc_new_regime.py`, `pull_trades.py`, `extract_trades.py`, `pull_fx.py`, `fx_build.py`, `pull_candles.py`, `check_completeness.py`, `fair_check.py`, `diagnostics.py`, `tables.py` | PR5: PR3's rule on nine months of public prints — the frozen simulator, its test, the post-change check, and the data pipeline that pulled and checked the tape. |
| `docs/agents/scripts/pr5w/pull_coin_candles.py` | PR5-W's arm 3a: Revolut X's keyless hourly coin candles against USD and GBP, pulled once and committed under `backtests/inputs/pr5w_2026-09-28/`. |
| `docs/agents/scripts/cap/clean_week.sql`, `book_30d.py` | The live row's clean-week checks before its four-slot step (read-only, from the moment the cap went to $60), and AVAX's 30-day median UK book from the public daily candles. |
| `docs/agents/scripts/mx1/weekly.sql`, `pull_tape.py` | MX-1's weekly pull: the read-only statements for the windows, the stand-in touches and the eligible count, and the keyless UK tape pull into `backtests/mx1/tape/`. |
| `docs/agents/scripts/pr5v/pr5v_sim.py` | PR5v: PR5's frozen rule generalised (rungs, re-price step, shared volume cap, cadence and latency, the order governor), importing the frozen simulator unchanged. |
| `docs/agents/scripts/pr5v/check_repro.py` | PR5v: proves the generalised simulator reproduces the frozen one trip for trip and order for order at PR5's settings. |
| `docs/agents/scripts/pr5v/test_pr5v.py` | PR5v: synthetic checks of what the generalised simulator adds (random-time twins, the shared cap, a 1 s loop, stale quotes, the governor). |
| `docs/agents/scripts/pr5v/pull_fresh.py` | PR5v: the keyless UK prints, USD-book hours and Yahoo GBP/USD minutes of 2026-09-22 → 09-28, committed under `backtests/inputs/pr5v_2026-09-28/`. |
| `docs/agents/scripts/pr5v/study.py` | PR5v: the rung, re-price, cadence, account and size study for "Stablecoin quotes - variant", writing `backtests/pr5v/pr5v_study.json`. |
| `docs/agents/scripts/pr5v/ref_timing.py` | PR5v: the chosen configuration priced at PR5's own minute beside the study's 1 s loop, and paired with the frozen rule by day (`backtests/pr5v/ref_timing.json`). |
| `docs/agents/scripts/pr5v/golden_variant.py` | PR5V: cuts the golden windows the variant's engine must replay from the reference simulator, at the pre-registered settings. |
| `docs/agents/backtests/pr5v/golden_variant.json` | PR5V's golden windows: each book's prints with their ids, each minute's X and fairU, and the reference's trips and POSTs in both arms. |
| `docs/agents/scripts/pr5v/fastx.py`, `fastx_sim.py`, `test_fastx.py`, `fastx_tables.py`, `pull_ticks.py`, `live_fx_measure.py`, `live_fx_analyze.py`, `wsmini.py` | PR5V fast X: what a faster GBP/USD (Dukascopy's keyless ticks) and more Revolut X keys are worth to the variant, and a live measurement of keyless GBP/USD sources (`backtests/pr5v/fastx.json`, `fastx_live.json`; inputs under `backtests/inputs/pr5v_fastx_2026-09-28/`). |
| `docs/agents/scripts/pr5v/lookahead.py` | PR5V: what variant-2's first engine gained by pricing a turn with GBP/USD from two minutes after it, on the study's days (`backtests/pr5v/lookahead.json`). |
| `docs/agents/scripts/fp2/t12_revx_uk_quotes.py`, `t3_binance_lst_wicks.py`, `m1_live_spreads_crosses.py`, `m2_budget_ranking.py`, `m3_is_descriptives.py`, `m3_is_descriptives_longtail.py`, `m4_is_markout_by_depth.py`, `m6_weekend_tokens.py`, `m7_crash_2025_10_10.py`, `m8_stock_tokens_overnight.py`, `m9_lst_wicks.py`, `m10_t1_is_fill_markouts.py`, `m11_crash_lag_duration.py`, `m12_dust_prints.py`, `pull_revx_prints.py`, `pull_yahoo.py`, `binance_bulk.py`, `build_manifest.py`, `netlib.py` | The second first-principles search: its three pre-registered tests, its measurements, and the pullers (they read a research folder named by `FP_ROOT`). |
| `docs/agents/scripts/fp3/zf_test.py`, `cb_test.py`, `dl_test.py`, `zf_check_trips.py`, `cb_check_trips.py`, `cb_check_screen.py`, `cb_day_20251010.py`, `cb_posthoc.py`, `m_funding_hours.py`, `m_listing_drift.py`, `m_price_range_wicks.py`, `m_thin_quote_wicks.py`, `m_u_books_h_sigma.py`, `universe.py`, `cb_screen.py`, `fetch_archive.py`, `fetch_days_1m.py`, `fetch_aggtrades.py`, `run_aggtrades.sh`, `pull_announcements.py`, `ann_text.py`, `launchpool_yield.py`, `build_manifest.py`, `netlib.py` | The third first-principles search, Binance first: its three pre-registered tests, their checks, its measurements, and the pullers (they read a research folder named by `FP_ROOT`). |
| `docs/agents/scripts/bitget/sample_books.py`, `analyze_samples.py`, `pull_history.py`, `pull_binance_ref.sh`, `analyze_tapes.py`, `analyze_depth.py`, `depth_shares.py` | The Bitget feasibility study: its books sampled, a year of their prints and depth, and Binance's reference rates; results and sources in `backtests/bitget/`. |
| `docs/improvement-plan.md` | The whole-repository review of 2026-09-05, as a plan. |
| `docs/LEDGER.md`, `docs/handover.md` | The live work log, and its archive. |
| `.claude/`, `.cursor/`, `.agents/` | Instructions for the AI coding agents, in one file (`.claude/CLAUDE.md`; Cursor's rule points there) with the agents feature's rules in `docs/agents/CLAUDE.md` (pointed at from `supabase/functions/agents/` and `src/agents/`, and by Cursor's `agents.mdc`), the two sub-agents they may open (`.claude/agents/`), and the ledger protocol they follow (`.agents/skills/ledger/`). |

---

## Data flow

```
Browser (React PWA)
 ├─ /functions/v1/auth             password → HMAC-signed { role, exp } token
 ├─ /functions/v1/data             portfolio load / save, recorded price snapshots
 ├─ /functions/v1/prices           live quotes (Yahoo, Eastmoney)
 ├─ /functions/v1/chart            chart bars (Yahoo, Eastmoney)
 ├─ /functions/v1/fundamentals     P/E, P/S, EPS history, earnings dates
 ├─ /functions/v1/trading212       broker positions, fills and overnight quotes
 ├─ /functions/v1/overnight-fetch  recorded overnight points
 ├─ /functions/v1/agents           crypto dashboard, chart and log
 └─ /functions/v1/ops-error        error reports; admin summary + acknowledge
 Browser state
 ├─ sessionStorage   dp.token (signed token; gone when the tab closes)
 ├─ localStorage     dp.auth (lockout), dp.prefs (hide-values, choices),
 │                   dp.marketCache (last tick's market + FX, ≤ 7 days),
 │                   dp.portfolioCache (first-paint board), dp.schema
 └─ IndexedDB        chart_store.js: chart series, MA history, YTD cache

pg_cron → pg_net → Edge Functions (no browser needed; one job queues every call due in a minute from edge_calls, in one statement)
 ├─ every call below   its first act   its beat: the function and action, the minute → edge_call_beats
 ├─ edge-watchdog      every minute, at :13   a due call with no beat (its worker never started) run again, once → edge_call_retries
 ├─ snapshot-record    every 5 min   board prices → price_snapshots
 ├─ overnight-record   every 5 min, 00:00–09:55 UTC   T212 quotes → overnight_intraday_points
 ├─ agents ?action=tick  every minute   quotes, orders, stops, decisions → agent_* tables
 ├─ agents ?action=quotes  every minute   PR5's paper quotes → agent_quote_*, then its live executor → agent_quote_live_*
 ├─ agents ?action=quotesv  every minute   PR5's stored minutes replayed through the variant's rule, two arms → agent_quotev_*
 ├─ agents ?action=pmrw  every minute   RW's paper quotes on Polymarket (public reads) → pm_rw_*
 ├─ agents ?action=pmrw-select  every 5 min   the day's portfolio for RW, once a UTC day → pm_rw_selection
 ├─ agents ?action=pmrw-e  every minute   RW's stored minutes replayed, RW and RW-E → pm_rw_e_*
 ├─ agents ?action=pmrw-x  every minute   RW's stored minutes replayed, RW-E's variants → pm_rw_x_*
 ├─ agents ?action=pmrwc  every minute, from 2026-10-08   RW-C, RW's paper quotes again on 10-09 → 10-23 (public reads) → pm_rwc_*
 ├─ agents ?action=pmrwc-select  every 5 min, from 2026-10-08   the day's portfolio for RW-C, once a UTC day → pm_rwc_selection
 ├─ agents ?action=pmrwc-e / pmrwc-x  every minute, from 10-09 00:02   RW-C's stored minutes replayed, RW-E and its variants → pm_rwc_e_* / pm_rwc_x_*
 ├─ agents ?action=books  every minute, from :40   Revolut X's four stablecoin books, one at a time, when they change → agent_book_levels
 ├─ agents ?action=pmlive  every minute, from eu-west-1   Polymarket's order path (a dry-run until armed): RW's quotes, each minute's formula, the daily readout → pm_live_*
 ├─ agents ?action=pmprep  every minute   mini-pool's paper layer: the path's dry-run orders filled from public prints, two minutes behind → pm_prep_*
 ├─ agents ?action=pmmid  every minute, from eu-west-1   mid-pool, the path again on $10–$50 pools, a dry-run its config row holds → pm_mid_*
 ├─ agents ?action=pmmidprep  every minute   mid-pool's paper layer → pm_midprep_*
 ├─ agents ?action=pmlp  every minute, from eu-west-1   live-prep, the path on $10 and over with its own rules, a dry-run its config row holds → pm_lp_*
 ├─ agents ?action=pmlpprep  every minute   live-prep's paper layer → pm_lpprep_*
 ├─ agents ?action=views  every minute, every second near a deadline   YouTube's view counters and their markets' books, when they change → yt_* / pm_view_*
 └─ daily prunes / retention   snapshots, overnight points, agents, ops_errors, fundamentals cache, call beats

Cloudflare Worker daviesportfolios-monitor (its own cron, every minute: outside GitHub and pg_cron)
 ├─ daviesluo.com                    the shell 200, and the app-*.js it names 200 JavaScript
 ├─ monitor ?action=health           the minute loop's readings (tick beat and turn, PR5's executor, newest decision), read-only
 ├─ monitor ?action=deadman          PR5's executor quiet > 3 min, or unreadable with no fresh read in 3 min (DeadmanMemory) → every resting order on its sub-account cancelled → agent_quote_live_events, ops_errors
 ├─ monitor ?action=report           its alerts and recoveries → ops_errors (the errors box); queued in KV while Supabase is down
 └─ GitHub workflow_dispatch         monitor-alert.yml → the issue labelled monitor (opened, or commented on)
```

The Edge Functions hold:
1. The Supabase service-role key (all table access).
2. The app's two passwords (`auth` checks them and signs tokens).
3. Every third-party credential: Trading 212, Finnhub, Alpha Vantage,
   Revolut X, Kraken and the decision model's keys.

The browser carries:
1. The Supabase **anon** key (safe: it is the public key from the
   dashboard, and every function that serves the portfolio or a paid
   upstream also checks the app's own token, `overnight-fetch` among
   them since 2026-10-08).
2. A short-lived HMAC token in sessionStorage.

---

## Local development

Requirements: Node 20.19+ or 22.12+ (CI uses 22), a Supabase project,
and a Cloudflare Pages account (optional, only for deploys).

```sh
git clone https://github.com/daviesluo/daviesportfolios
cd daviesportfolios
sh bin/setup.sh          # the ledger hook, the ledger path, npm ci in src/
sh bin/gates.sh          # the gates below this change can break (--full: all)

cd src                   # the web app is an npm project here
npm run dev              # Vite dev server at http://localhost:5173
npm test                 # Vitest: unit and component tests (jsdom)
npm run typecheck        # tsc --noEmit with checkJs + strictNullChecks
npm run lint             # ESLint (react-hooks bug rules)
npm run build            # production bundle into dist/
npx playwright install --no-shell chromium   # once: the full Chromium the two below launch
npm run verify:browser   # browser sweep of the built bundle
npm run verify:perf      # the performance panel's 60-case matrix
npx knip                 # dead code and unused exports, the web app
sh ../bin/knip-edge.sh   # the same for the Edge Functions
npx size-limit           # gzipped main-bundle budget
npm audit --audit-level=high --omit=dev   # supply-chain check on shipped deps

# Edge Functions (Deno 1.x, as CI), from the root; CI runs the same (its deno test adds --no-check)
cd ..
deno check --quiet supabase/functions/
deno test --allow-env supabase/functions/
```

The dev server hits the deployed Edge Functions by default. To point
at a local Supabase, edit `src/app/supabase_config.js` (`SB_URL` /
`SB_ANON`).

---

## Forking / re-using this project

This is a personal tracker, but the architecture is generic. Steps to
stand up your own:

### 1. Create a new Supabase project

[supabase.com](https://supabase.com) → New project. Note the project
URL and the `anon public` API key (Settings → API).

### 2. Run the migrations

**Recommended path** (after PR #158): set `SUPABASE_DB_PASSWORD` in
the `production` GitHub Environment alongside the existing
`SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF`. The `migrations.yml`
workflow auto-runs `supabase db push --include-all` on every push to
main that touches `supabase/migrations/**`, applying files not already
in prod's `supabase_migrations.schema_migrations` table.

For a fresh project, let `migrations.yml` apply every file in
`supabase/migrations/` in numeric order (or run `supabase db push
--include-all` yourself). Do not paste migrations into the dashboard's
SQL Editor: it records nothing in `supabase_migrations.schema_migrations`,
and every later push then fails with *Remote migration versions not
found in local migrations directory* (see `supabase/migrations/README.md`).

`0005` / `0006` are a historical create/drop pair (the retired
`analyst_estimates_cache` table) — a fresh setup nets nothing from
them and can skip both.

> Both T212 migrations are gated together: if you apply 0008 without
> 0007 (or `0007` was rolled back at some point) the function silently
> returns empty holdings because every claim RPC call hits
> `42P01: relation "public.trading212_cache" does not exist`. The
> Edge Function logs that specific code prominently to Supabase
> Functions logs to point you at the missing migration.

### 3. Deploy the Edge Functions

Two options:

- **Automatic (recommended)** — set `SUPABASE_ACCESS_TOKEN` (account-level
  PAT from `https://supabase.com/dashboard/account/tokens`) and
  `SUPABASE_PROJECT_REF` (the project's ref id) as repo secrets. The
  `edge-functions.yml` workflow deploys every function whose folder
  changed since its last successful run (all of them when `_shared/`
  changed) on every push to `main`, after `deno check` and `deno test`
  pass, so a run cancelled by a newer push loses nothing.
- **Manual** — for each directory under `supabase/functions/*`, copy
  the contents into a new function in Supabase dashboard → Edge
  Functions, then Deploy. Use this for the first-time bootstrap or
  when you don't want to grant CI a PAT.

Required environment variables (Edge Functions → Settings):

A copy-pasteable shape of the app-level vars lives at
[`supabase/functions/.env.example`](../supabase/functions/.env.example).

| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all | Provided automatically by Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | every function | Injected automatically by Supabase (Settings → API shows it). |
| `APP_AUTH_SECRET` | `auth` and every token verifier (`_shared/token.ts`) | Long random string (`openssl rand -hex 32`). |
| `APP_ADMIN_PWD` | `auth` | Your admin password. (The function reads this exact name — `APP_ADMIN_PASSWORD` leaves auth unconfigured.) |
| `APP_RO_PWD` | `auth` | Your read-only / shareable password. |
| `FINNHUB_API_KEY` | `fundamentals` | Free key from finnhub.io (60 calls / min). Source of `pe3yAvg` / `ps3yAvg` (3-year averages — Yahoo doesn't expose historical-annual ratios on the free tier) and the whole-row fallback for current pe/eps/ps when Yahoo's crumb handshake fails or it's rate-limited. Without it the P/E / P/S 1Y buttons still work for tickers Yahoo covers, but the dashed 3Y AVG reference line is hidden and a Yahoo outage drops the chart entirely. *(There used to be an `FMP_API_KEY` here — FMP retired its `/v3/` endpoints and paywalled the `/stable/` replacements in 2026, so the FMP layer was removed and Yahoo `quoteSummary` + a crumb handshake is now the primary source. No FMP key is needed.)* |
| `ALPHAVANTAGE_API_KEY` | `fundamentals` | Free key from alphavantage.co (25 calls / day). Powers index P/E for `^GSPC` / `^NDX` / `^RUT` / `^SOX` via their ETF proxies, with a 24 h server-side cache so the daily quota is never strained. Without it the function falls back to hardcoded constants — chart still draws but the printed values stop auto-refreshing. |
| `T212_API_KEY` | `trading212`, `overnight-record`, `snapshot-record` | Optional. API key from Trading 212 → Settings → Account & Personal → API Settings. Powers every position, the executed fills and the overnight quotes — without it `trading212` returns `source: 'disabled'` + empty holdings and the client keeps whatever the user last typed into EditTickerModal. |
| `T212_API_SECRET` | `trading212`, `overnight-record`, `snapshot-record` | Optional, for T212's two-key accounts. When set, the functions go straight to `Basic base64(key:secret)` and keep the raw key only as a 401 fallback; leave unset for a single-key account. |
| `T212_ISA_API_KEY` | `trading212` | Optional. API key for a SECOND T212 account (the ISA). T212 scopes its public API per account, so ISA holdings + their live overnight prices are only reachable with this key. When set, the function fetches the ISA portfolio in parallel and merges it with the invest account (prices union'd; allow-list shares/cost summed if held in both). Without it, only the invest account (`T212_API_KEY`) is synced. |
| `T212_ISA_API_SECRET` | `trading212` | Optional two-key Basic-Auth fallback for the ISA account, same role as `T212_API_SECRET` but for `T212_ISA_API_KEY`. |
| `MONITOR_SECRET` | `monitor` | The shared secret the monitor Worker sends in `x-monitor-secret`; without it every call is refused. Generated and set on both sides (this and the Worker's secret of the same name) by `monitor-deploy.yml`, never by hand: run it with `rotate_secret` to change it. |
| `CRON_SECRET` | `overnight-record`, `snapshot-record`, `agents`, `weather`, `edge-watchdog`, `trading212` (its read-only `probe` and `orders-sync` only) | Bearer secret the pg_cron jobs present (these functions deploy `--no-verify-jwt`, so it is their auth gate; `edge-watchdog` also sends it when it runs a call again). pg_cron reads the same value from Supabase Vault as `cron_secret` (migration `0021`). `openssl rand -hex 32`. |
| `REVOLUT_X_API_KEY`, `REVOLUT_X_PRIVATE_KEY` | `agents` | Optional. Revolut X key id and its Ed25519 private key; without them Revolut X shows as not configured and nothing trades live there. |
| `REVOLUT_X_API_KEY_2`, `REVOLUT_X_PRIVATE_KEY_2` | `agents`, `monitor` | Optional. A second Revolut X sub-account's key, for the stablecoin quotes alone: the probe reads it, and so does their live executor. Without it that executor's dry-run assumes its capital in GBP, and nothing can go live. `monitor`'s dead-man switch reads it by the same names, only to cancel that account's resting orders. |
| `KRAKEN_PRO_API_KEY`, `KRAKEN_PRO_PRIVATE_KEY` | `agents` | Optional. Kraken key and its base64 secret (fee tier, balances, the probe; candles need no key). |
| `OPENROUTER_API_KEY`, `TYPESAFE_API_KEY` | `agents` | Optional. The Jev decision model through OpenRouter, with TypeSafe's own endpoint as the fallback; without either the model is not asked and entries hold. |
| `POLYMARKET_PRIVATE_KEY`, `POLYMARKET_CLOB_API_KEY`, `POLYMARKET_CLOB_SECRET`, `POLYMARKET_CLOB_PASSPHRASE` (each also read as `POLYMARKET_API_*`), `POLYMARKET_FUNDER_ADDRESS`, `POLYMARKET_SIGNER_ADDRESS`, `POLYMARKET_SIG_TYPE`, `POLYMARKET_HOST`, `POLYMARKET_CHAIN_ID` | `agents` | Optional. A Polymarket account, read by the probe (`?action=probe&only=polymarket`): the signing key, the CLOB's API credentials, and the account's addresses and settings. The order path (`?action=pmlive`) reads the API credentials, the two addresses and the signing key, kept only when it is the stored signer's; it places nothing until its config row is unlocked. Its mid-pool and live-prep instances (`?action=pmmid`, `?action=pmlp`) read the same, signing key included. |

### 4. Wire the client

Edit `src/app/supabase_config.js` to point at your project:

```js
export const SB_URL  = "https://<your-project>.supabase.co";
export const SB_ANON = "<your anon public key>";
```

Edit `src/portfolio/data.js` to seed your initial portfolio (positions, holdings,
shares, cost). On first load, the migration code in
`portfolio_remote.js` will rehydrate from this seed if the DB row is
empty.

### 5. Deploy the client

Cloudflare Pages → Connect to Git → pick your fork → set:

- Build command: **(leave empty)**
- Build output directory: `dist` — but set in `wrangler.jsonc`, not the
  dashboard (`"pages_build_output_dir": "./dist"`).

This repo commits its built output to `dist/` (see `.gitignore`'s note),
so Cloudflare serves that directory **as-is** with no build step. You run
`npm run build` in `src/` and commit the result before pushing (CI's bundle
check, below, fails the build if you forget). Don't set a CF build command
— if CF rebuilt on its own it would produce a third, possibly-divergent
copy of the bundle.

**`pages_build_output_dir` is load-bearing, not tidiness.** Without it
Pages falls back to its default output directory — the repository root —
and publishes the WHOLE REPO: `handover.md`, `LEDGER.md`, all of `src/`,
every `supabase/functions/*` source and the migrations, each returning
200 to an unauthenticated fetch with `Access-Control-Allow-Origin: *`.
That was this project's state until 2026-09-18. Two earlier fixes failed
because they reached for Workers mechanisms (`assets.directory` in
`wrangler.jsonc`, `.assetsignore`) that a Pages project ignores, or for
`_redirects`, which cannot beat a real static asset.

A push that changes `dist/` is published two ways, until one is turned
off: Cloudflare's Git-connected builder (set its Build watch paths
Include to `dist/*` so a non-site push builds nothing there; a `dist/`
push still clones the repository) and `.github/workflows/pages-deploy.yml`,
which waits for `check.yml` to pass on the commit, then Direct-Uploads the
committed folder with Wrangler and does not clone. The Git-connected
builder waits for nothing: while it is connected, a `dist/` push reaches
the site whether or not CI passed. Disconnecting it makes the workflow the
only publisher, and so a red commit never published; the workflow does not
change that dashboard setting.

### 6. Visit

- `https://<your-domain>?pwd=<APP_ADMIN_PWD>` for full edit mode.
- `https://<your-domain>?pwd=<APP_RO_PWD>` for a read-only share
  link.

---

## Working conventions

See [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) for repo conventions (push directly to
`main`, `sh bin/gates.sh` before every push, schema-version migrations
under `Storage.migrate()` in `storage.js`). Edge Functions auto-deploy
via `.github/workflows/edge-functions.yml` on every push to `main` that
changes a function's folder (all of them when `_shared/` changes), gated
by `deno test`; manual paste-into-dashboard is only needed when the
deploy secrets are missing. The committed `dist/` is Direct-Uploaded by
`.github/workflows/pages-deploy.yml` when that folder (or `wrangler.jsonc`)
changes on `main` and `check.yml` has passed on the commit; it needs
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets.

When a PR is open, its description is maintained with the branch: every
push that changes the diff rewrites the summary in the same step, and
the summary covers only what the PR would add to `main` right now.
Cloudflare Pages gives each branch a preview at
`https://<branch-slug>.daviesportfolios.pages.dev` (branch name
lowercased, non-alphanumeric runs collapsed to `-`, truncated to 28
characters) — that link belongs in the description.
